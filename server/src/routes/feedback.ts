import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { env } from '../config.js';
import { assertJobAccess } from '../runtime/jobAccess.js';
import { getCitation, getJob, saveCorrection, saveLearningQueueItem, saveReport } from '../runtime/persistence.js';
import { requestIsAdminBypassingLimits } from '../middleware/auth.js';
import { tryConsumeReportSlot } from '../services/reportIpLimiter.js';
import { enqueueBatchHealthSummaryRebuild } from '../admin/batchHealthSummary.js';
import { buildReportEngineSnapshot } from '../admin/citationReportMapper.js';
import { EXTRACTED_FIELD_KEYS } from '../engine/utils/fields.js';
import { hashInputForTruth } from '../training/truthHash.js';
import type { ExtractionMeta } from '../engine/types/extractionMeta.js';

const reportSchema = z.object({
  jobId: z.string().min(1),
  citationId: z.string().min(1),
  failureCategory: z.string().min(1),
  userNote: z.string().max(2_000).optional(),
  optInTraining: z.boolean().optional(),
});

const correctionSchema = z.object({
  jobId: z.string().min(1),
  citationId: z.string().min(1),
  fieldName: z.enum(EXTRACTED_FIELD_KEYS),
  newValue: z.unknown(),
  optInTraining: z.boolean().optional(),
});

function clientIp(req: FastifyRequest): string {
  return req.ip || 'unknown';
}

export async function feedbackRoute(app: FastifyInstance): Promise<void> {
  app.post('/reports', async (req, reply) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Report payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const allowed =
      requestIsAdminBypassingLimits(req)
      || (await tryConsumeReportSlot(clientIp(req), env.REPORT_LIMIT_PER_IP));
    if (!allowed) {
      throw new AppError(429, ErrorCode.RATE_LIMIT_EXCEEDED, 'Too many reports from this network. Try again tomorrow.');
    }

    const job = await getJob(parsed.data.jobId);
    if (!job) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, 'Citation was not found for this report.');
    }
    await assertJobAccess(req, job);

    const citation = await getCitation(parsed.data.jobId, parsed.data.citationId);
    if (!citation) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, 'Citation was not found for this report.');
    }

    const report = {
      id: randomUUID(),
      jobId: parsed.data.jobId,
      citationId: parsed.data.citationId,
      ...(typeof (req as { userId?: string }).userId === 'string' ? { userId: (req as { userId?: string }).userId } : {}),
      source: 'user' as const,
      failureCategory: parsed.data.failureCategory,
      failureCategories: [parsed.data.failureCategory],
      ...(parsed.data.userNote ? { userNote: parsed.data.userNote } : {}),
      status: 'pending' as const,
      engineSnapshot: buildReportEngineSnapshot(citation),
      reportCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveReport(report);
    await enqueueBatchHealthSummaryRebuild(parsed.data.jobId);
    await saveLearningQueueItem({
      id: randomUUID(),
      citationId: parsed.data.citationId,
      jobId: parsed.data.jobId,
      source: 'user_report',
      priority: 1,
      trainingData: {
        rawInput: citation.raw,
        rawTextHash: hashInputForTruth(citation.raw),
        failureCategory: parsed.data.failureCategory,
        eligibleForTraining: parsed.data.optInTraining === true,
        publicStatus: citation.publicStatus,
        engineSnapshot: {
          fieldsPredicted: citation.fields,
          extractionMeta: citation.extractionMeta ?? null,
          engineVersion: 'engine_3.0.0',
        },
      },
      processed: false,
      createdAt: new Date().toISOString(),
    });

    return reply.status(201).send(report);
  });

  app.post('/corrections', async (req, reply) => {
    const parsed = correctionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Correction payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const job = await getJob(parsed.data.jobId);
    if (!job) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, 'Citation was not found for this correction.');
    }
    await assertJobAccess(req, job);

    const citation = await getCitation(parsed.data.jobId, parsed.data.citationId);
    if (!citation) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, 'Citation was not found for this correction.');
    }

    const currentField = (citation.fields as unknown as Record<string, { value: unknown } | undefined>)[parsed.data.fieldName];
    const userId = (req as unknown as { userId?: string }).userId;
    const correction = {
      id: randomUUID(),
      jobId: parsed.data.jobId,
      citationId: parsed.data.citationId,
      ...(userId ? { userId } : {}),
      fieldName: parsed.data.fieldName,
      oldValue: currentField?.value ?? null,
      newValue: parsed.data.newValue,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveCorrection(correction);
    await saveLearningQueueItem({
      id: randomUUID(),
      citationId: parsed.data.citationId,
      jobId: parsed.data.jobId,
      source: 'user_edit',
      priority: 2,
      trainingData: {
        rawInput: citation.raw,
        rawTextHash: hashInputForTruth(citation.raw),
        fieldName: parsed.data.fieldName,
        newValue: parsed.data.newValue,
        oldValue: currentField?.value ?? null,
        corrections: {
          [parsed.data.fieldName]: parsed.data.newValue,
        },
        previousPrediction: currentField?.value ?? null,
        correctedSpan: findBioSpanForField(citation.extractionMeta, parsed.data.fieldName),
        eligibleForTraining: parsed.data.optInTraining === true,
        publicStatus: citation.publicStatus,
        engineSnapshot: {
          fieldsPredicted: citation.fields,
          extractionMeta: citation.extractionMeta ?? null,
          engineVersion: 'engine_3.0.0',
        },
      },
      processed: false,
      createdAt: new Date().toISOString(),
    });

    return reply.status(201).send(correction);
  });
}

function findBioSpanForField(
  extractionMeta: ExtractionMeta | undefined,
  fieldName: string,
): Record<string, unknown> | null {
  const match = extractionMeta?.bio?.entities?.find((entity) => entity.field === fieldName);
  return match ? structuredClone(match) as unknown as Record<string, unknown> : null;
}
