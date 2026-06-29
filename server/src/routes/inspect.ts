import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { phase1Ingest } from '../engine/phases/phase1Ingest.js';
import { phase2Split } from '../engine/phases/phase2Split.js';
import type { InspectResponse } from '../engine/types/api.js';
import { engineInspectSourceTypeSchema } from '../engine/types/runtime-enums.js';
import {
  DEFAULT_PIPELINE_OPTIONS,
  type PipelineContext,
} from '../engine/types/pipeline.js';
import { normalizePipelineOptions } from '../pipeline/executionPolicy.js';
import { createStageBudgets } from '../pipeline/performance.js';
import { CITATION_TEXT_INPUT_MAX_CHARS, JSON_BODY_LIMIT_BYTES } from './requestLimits.js';

const inspectRequestSchema = z.object({
  sourceType: engineInspectSourceTypeSchema,
  content: z.string().min(1).max(CITATION_TEXT_INPUT_MAX_CHARS),
});

export async function inspectRoute(app: FastifyInstance): Promise<void> {
  app.post('/inspect', { bodyLimit: JSON_BODY_LIMIT_BYTES }, async (req, reply) => {
    const parsed = inspectRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'Inspect request payload is invalid.',
        { issues: parsed.error.flatten() },
      );
    }

    const ctx = createInspectContext();
    const envelope = await phase1Ingest.run(parsed.data, ctx);
    const splitResult = await phase2Split.run(envelope, ctx);
    const { countAudit } = splitResult;
    const resolvedEnvelope = splitResult.resolvedEnvelope;

    const response: InspectResponse = {
      estimatedCount: resolvedEnvelope.estimatedCount,
      aggregatedCount: countAudit.aggregatedCount,
      splitCount: countAudit.splitCount,
      countAudit,
      detectedFormat: resolvedEnvelope.detectedFormat,
      detectedDois: resolvedEnvelope.detectedDois,
      formatConfidence: resolvedEnvelope.formatConfidence,
      structure: resolvedEnvelope.structure,
      styleHints: resolvedEnvelope.styleHints,
      ingestionSignals: resolvedEnvelope.ingestionSignals,
      needsActionCount: countAudit.needsActionCount,
      diagnostics: ctx.stageLog,
      ...(resolvedEnvelope.detection ? {
        detection: {
          chosen: resolvedEnvelope.detection.chosen,
          secondBest: resolvedEnvelope.detection.secondBest
            ? { format: resolvedEnvelope.detection.secondBest.format, score: resolvedEnvelope.detection.secondBest.score }
            : null,
          confidence: resolvedEnvelope.detection.confidence,
          effectiveConfidence: resolvedEnvelope.detection.effectiveConfidence,
          method: resolvedEnvelope.detection.method,
          perBlockUsed: resolvedEnvelope.detection.perBlockUsed,
          sampled: resolvedEnvelope.detection.sampled,
        },
      } : {}),
      cleanup: splitResult.cleanup,
      blocks: splitResult.blocks.map((block) => ({
        index: block.index,
        text: block.text.length > 300 ? block.text.slice(0, 300) + '...' : block.text,
        splitReason: block.splitReason ?? 'unknown',
        blockFormat: block.blockFormat ?? resolvedEnvelope.detectedFormat,
      })),
    };

    app.log.info({
      detectedFormat: resolvedEnvelope.detectedFormat,
      structure: resolvedEnvelope.structure,
      formatConfidence: resolvedEnvelope.formatConfidence,
      normalizationMeta: resolvedEnvelope.normalizationMeta,
      cleanup: splitResult.cleanup,
      countAudit,
      detectionTelemetry: ctx.stageLog
        .find((entry) => entry.phaseId === 'detection_telemetry')
        ?.details,
    }, 'Inspect ingest/split summary');

    return reply.status(200).send(response);
  });
}

function createInspectContext(): PipelineContext {
  const normalized = normalizePipelineOptions({
    ...DEFAULT_PIPELINE_OPTIONS,
    enableScoredDetection: env.FEATURE_SCORED_DETECTOR,
    enablePdfCleanup: env.FEATURE_PDF_CLEANUP,
    pdfCleanupMode: 'inspect_only',
  });

  return {
    jobId: randomUUID(),
    pipelineMajor: 3,
    outputStyle: 'auto',
    options: normalized.options,
    executionPolicy: normalized.executionPolicy,
    runtimeTuning: {
      batchSize: env.PIPELINE_BATCH_SIZE,
      maxConcurrency: env.PIPELINE_MAX_CONCURRENCY,
    },
    stageLog: [],
    startedAt: Date.now(),
    performanceBudgets: createStageBudgets(),
    tenantContext: {
      tier: 'free',
    },
    providerUsage: {
      crossrefCalls: 0,
      openalexCalls: 0,
      semanticScholarCalls: 0,
      llmTokensUsed: 0,
      llmRepairCalls: 0,
      cacheHits: 0,
    },
  };
}
