import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { registerAdminTruthRoutes } from './adminTruthRoutes.js';
import { z } from 'zod';
import {
  ensureBatchHealthSummaries,
  ensureBatchHealthSummary,
  enqueueBatchHealthSummaryRebuild,
  listFlaggedCitationLineItems,
} from '../admin/batchHealthSummary.js';
import {
  applyReportResolution,
  approveCorrection,
  reprocessCitation,
} from '../admin/workflows.js';
import { buildShadowReport } from '../admin/shadowReport.js';
import {
  getLatestAdminPerformanceDiagnostic,
  listAdminPerformanceDiagnostics,
  runAdminPerformanceDiagnostic,
} from '../admin/performanceDiagnostics.js';
import {
  attachMlBioEvidenceBrowserTiming,
  getLatestMlBioEvidenceReport,
  listMlBioEvidenceReports,
  runMlBioEvidenceReport,
} from '../admin/mlBioEvidenceReport.js';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import {
  engineCitationStyleSchema,
  engineConvertSourceTypeSchema,
  engineParseProfileSchema,
} from '../engine/types/runtime-enums.js';
import { CITATION_TEXT_INPUT_MAX_CHARS, JSON_BODY_LIMIT_BYTES } from './requestLimits.js';
import { env } from '../config.js';
import {
  getPhase4EffectiveLabel,
  getPhase4OverrideMode,
  setPhase4OverrideMode,
} from '../ml/phase4ModeOverride.js';
import { instrumentedFetch, mapOutboundFetchError } from '../services/instrumentedFetch.js';
import { enrichStoredReport } from '../admin/citationReportMapper.js';
import {
  deleteReports,
  getCorrection,
  getReport,
  listBatchHealthSummaries,
  listEgressDaily,
  listEgressMonthly,
  listCorrections,
  listShadowExtractionHistory,
  listJobs,
  listLearningQueue,
  listReports,
  updateCorrection,
  updateReport,
} from '../runtime/persistence.js';
import { PersistenceConflictError } from '../runtime/persistenceErrors.js';
import type {
  StoredFieldApprovalMap,
  StoredProposedPattern,
  StoredReport,
  StoredReportDuplicateDecision,
  StoredReviewEvent,
} from '../runtime/persistence.js';

const reportStatusSchema = z.object({
  status: z.enum(['pending', 'proposed', 'accepted', 'rejected', 'duplicate']),
});

const correctionStatusSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

const phase4ModeSchema = z.object({
  mode: z.enum(['heuristic', 'primary', 'default']),
  modelVersionPin: z.string().trim().min(1).max(200).nullable().optional(),
});

const performanceDiagnosticSchema = z.object({
  sourceType: engineConvertSourceTypeSchema.default('text'),
  content: z.string().max(CITATION_TEXT_INPUT_MAX_CHARS).optional(),
  fixture: z.enum(['numbered_mixed_style_smoke']).optional(),
  outputStyle: engineCitationStyleSchema.default('apa7'),
  parseProfile: engineParseProfileSchema.default('core_parse_full'),
  runtimeProfile: z.enum(['site_default', 'benchmark_5600h', 'server_16c']).default('site_default'),
});

const mlBioEvidenceSchema = z.object({
  sourceType: engineConvertSourceTypeSchema.default('text'),
  content: z.string().max(CITATION_TEXT_INPUT_MAX_CHARS).optional(),
  outputStyle: engineCitationStyleSchema.default('apa7'),
  runtimeProfile: z.enum(['site_default', 'benchmark_5600h', 'server_16c']).default('site_default'),
  maxGoldRows: z.coerce.number().int().min(1).optional(),
});

const mlBioEvidenceBrowserTimingSchema = z.object({
  source: z.enum(['admin_diagnostics_evidence', 'site_convert']).default('admin_diagnostics_evidence'),
  inputReferenceCount: z.coerce.number().int().min(0).max(100_000).optional(),
  parsedReferenceCount: z.coerce.number().int().min(0).max(100_000).optional(),
  requestMs: z.coerce.number().min(0).max(3_600_000).optional(),
  submitToResultsMs: z.coerce.number().min(0).max(3_600_000),
  firstPaintMs: z.coerce.number().min(0).max(3_600_000),
  allRenderedMs: z.coerce.number().min(0).max(3_600_000),
  browserResultBytes: z.coerce.number().int().min(0).max(100_000_000).optional(),
  rowsInitiallyRendered: z.coerce.number().int().min(0).max(100_000).optional(),
  rowsEventuallyRendered: z.coerce.number().int().min(0).max(100_000).optional(),
  virtualizationEnabled: z.boolean().optional(),
  longTaskCount: z.coerce.number().int().min(0).max(100_000).optional(),
  maxLongTaskMs: z.coerce.number().min(0).max(3_600_000).optional(),
});

const deleteReportsBodySchema = z.object({
  ids: z.array(z.string().min(1)),
});

const reviewQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  statusFilter: z.enum(['any_flagged', 'action_needed', 'review']).default('any_flagged'),
  sourceFilter: z.enum(['all', 'pipeline_only', 'reports_only', 'both']).default('all'),
  sortBy: z.enum(['latestActionableAt', 'createdAt', 'flaggedCitationCount', 'totalCitations', 'ownerLabel']).default('latestActionableAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

const reviewQueueCitationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.coerce.number().int().min(0).nullable().optional(),
});

const reportMutationBaseSchema = z.object({
  actor: z.string().trim().min(1).default('admin'),
  expectedUpdatedAt: z.string().datetime(),
});

const reportAssignSchema = reportMutationBaseSchema.extend({
  assigneeName: z.string().trim().max(200).optional(),
});

const reportCommentSchema = reportMutationBaseSchema.extend({
  message: z.string().trim().min(1).max(2_000),
});

const reportRejectSchema = reportMutationBaseSchema.extend({
  reason: z.string().trim().max(2_000).optional(),
});

const reportResolutionSchema = reportMutationBaseSchema.extend({
  fixType: z.enum([
    'dynamic-pattern',
    'parser-logic',
    'scoring-tweak',
    'renderer-fix',
    'type-correction',
    'other-fix',
  ]),
  referenceType: z.string().trim().max(100).optional(),
  proposedPattern: z.object({
    regex: z.string().trim().min(1),
    replacement: z.string().trim().optional(),
    description: z.string().trim().optional(),
    category: z.string().trim().optional(),
    priority: z.number().int().optional(),
    fields: z.record(z.string(), z.number().int()).optional(),
  }).optional(),
  proposedStyleFix: z.string().trim().optional(),
  saveAsTruth: z.boolean().default(false),
  correctedFields: z.record(z.string(), z.unknown()).optional(),
  fieldApproval: z.record(z.string(), z.object({
    approved: z.boolean(),
    value: z.unknown().optional(),
    note: z.string().trim().optional(),
  })).optional(),
  failureTaxonomy: z.array(z.string().trim().min(1)).default([]),
  stageBlame: z.array(z.string().trim().min(1)).default([]),
  duplicateDecision: z.enum([
    'not_applicable',
    'confirmed_duplicate',
    'confirmed_unique',
    'needs_review',
  ]).default('not_applicable'),
  resolvedByCommit: z.string().trim().optional(),
  resolvedByVersion: z.string().trim().optional(),
});

function sortableReviewQueueValue(
  row: Awaited<ReturnType<typeof listBatchHealthSummaries>>[number],
  sortBy: z.infer<typeof reviewQueueQuerySchema>['sortBy'],
): number | string {
  switch (sortBy) {
    case 'createdAt':
      return new Date(row.createdAt).getTime();
    case 'flaggedCitationCount':
      return row.flaggedCitationCount;
    case 'totalCitations':
      return row.totalCitations;
    case 'ownerLabel':
      return row.ownerLabel.toLowerCase();
    case 'latestActionableAt':
    default:
      return new Date(row.latestActionableAt ?? row.createdAt).getTime();
  }
}

function cloneReviewEvents(report: StoredReport): StoredReviewEvent[] {
  return structuredClone(report.reviewState?.reviewEvents ?? []);
}

function appendReviewEvent(report: StoredReport, event: StoredReviewEvent): void {
  const reviewState = report.reviewState ? structuredClone(report.reviewState) : {};
  reviewState.reviewEvents = [...cloneReviewEvents(report), event];
  report.reviewState = reviewState;
}

function cleanOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildResolutionTrace(report: StoredReport, overrides: {
  resolvedAt: string;
  resolvedByCommit?: string;
  resolvedByVersion?: string;
  note?: string;
}) {
  const next = {
    ...(report.resolutionTrace ?? {}),
    resolvedAt: overrides.resolvedAt,
    ...(overrides.resolvedByCommit ? { resolvedByCommit: overrides.resolvedByCommit } : {}),
    ...(overrides.resolvedByVersion ? { resolvedByVersion: overrides.resolvedByVersion } : {}),
    ...(overrides.note ? { note: overrides.note } : {}),
  };

  return next;
}

function handlePersistenceConflict(error: unknown): never {
  if (error instanceof PersistenceConflictError) {
    throw new AppError(409, ErrorCode.VALIDATION_ERROR, error.message, {
      currentUpdatedAt: error.currentUpdatedAt,
    });
  }
  throw error;
}

type MlRuntimeAdminState = {
  modelVersionPin: string | null;
  health?: {
    status?: string;
    backend?: string;
    warmupReady?: boolean;
    activeModelVersion?: string | null;
    featureVersion?: string | null;
    modelDir?: string;
  };
};

async function getMlRuntimeAdminState(): Promise<MlRuntimeAdminState | null> {
  try {
    const response = await instrumentedFetch({
      provider: 'ml',
      route: '/v1/ml/admin/runtime',
      method: 'GET',
      url: `${env.ML_SERVICE_URL.replace(/\/$/, '')}/v1/ml/admin/runtime`,
      headers: buildMlAdminHeaders(),
      timeoutMs: env.ML_SERVICE_TIMEOUT_MS,
      expectedContentTypes: ['application/json'],
    });
    if (!response.ok) {
      return null;
    }
    try {
      return (await response.json()) as MlRuntimeAdminState;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function setMlRuntimeAdminState(modelVersionPin: string | null): Promise<MlRuntimeAdminState> {
  try {
    const response = await instrumentedFetch({
      provider: 'ml',
      route: '/v1/ml/admin/runtime',
      method: 'PUT',
      url: `${env.ML_SERVICE_URL.replace(/\/$/, '')}/v1/ml/admin/runtime`,
      headers: {
        'Content-Type': 'application/json',
        ...buildMlAdminHeaders(),
      },
      body: { modelVersionPin },
      timeoutMs: env.ML_SERVICE_TIMEOUT_MS,
      expectedContentTypes: ['application/json'],
    });
    if (!response.ok) {
      throw new Error(`ML runtime override failed with status ${response.status}.`);
    }
    try {
      return (await response.json()) as MlRuntimeAdminState;
    } catch {
      throw new AppError(
        502,
        ErrorCode.ML_SERVICE_UNAVAILABLE,
        'ML runtime override response was not valid JSON.',
      );
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const mapped = mapOutboundFetchError(
      error,
      'ML runtime override failed.',
    );
    throw new AppError(
      mapped.statusCode,
      ErrorCode.ML_SERVICE_UNAVAILABLE,
      mapped.message,
      { upstreamCode: mapped.code },
    );
  }
}

function buildMlAdminHeaders(): Record<string, string> {
  return env.ML_ADMIN_SECRET
    ? { 'x-ml-admin-secret': env.ML_ADMIN_SECRET }
    : {};
}

export async function adminRoute(app: FastifyInstance): Promise<void> {
  app.get('/admin/diagnostics/performance/latest', async (_req, reply) => {
    return reply.status(200).send({
      latest: getLatestAdminPerformanceDiagnostic(),
      reports: listAdminPerformanceDiagnostics(),
    });
  });

  app.post('/admin/diagnostics/performance/run', { bodyLimit: JSON_BODY_LIMIT_BYTES }, async (req, reply) => {
    const parsed = performanceDiagnosticSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Performance diagnostic payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const report = await runAdminPerformanceDiagnostic(parsed.data);
    return reply.status(200).send(report);
  });

  app.get('/admin/diagnostics/ml-bio/latest', async (_req, reply) => {
    return reply.status(200).send({
      latest: getLatestMlBioEvidenceReport(),
      reports: listMlBioEvidenceReports(),
    });
  });

  app.post('/admin/diagnostics/ml-bio/run', { bodyLimit: JSON_BODY_LIMIT_BYTES }, async (req, reply) => {
    const parsed = mlBioEvidenceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'ML/BIO evidence payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const report = await runMlBioEvidenceReport(parsed.data);
    return reply.status(200).send(report);
  });

  app.post('/admin/diagnostics/ml-bio/:reportId/browser-timing', async (req, reply) => {
    const reportId = (req.params as { reportId?: string }).reportId;
    if (!reportId) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'ML/BIO evidence report id is required.');
    }
    const parsed = mlBioEvidenceBrowserTimingSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'ML/BIO browser timing payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const report = attachMlBioEvidenceBrowserTiming(reportId, parsed.data);
    if (!report) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'ML/BIO evidence report was not found.');
    }
    return reply.status(200).send(report);
  });

  app.get('/admin/egress/daily/:day', async (req, reply) => {
    const day = (req.params as { day: string }).day;
    return reply.status(200).send(await listEgressDaily(day));
  });

  app.get('/admin/egress/monthly/:month', async (req, reply) => {
    const month = (req.params as { month: string }).month;
    return reply.status(200).send(await listEgressMonthly(month));
  });

  app.get('/admin/phase4-mode', async (_req, reply) => {
    const overrideMode = await getPhase4OverrideMode();
    const envMode = env.ML_PHASE4_MODE;
    const effectiveMode = getPhase4EffectiveLabel(envMode, overrideMode);
    const mlRuntime = await getMlRuntimeAdminState();
    return reply.status(200).send({
      mode: overrideMode ?? 'default',
      envMode,
      effectiveMode,
      primaryFraction: env.ML_PHASE4_PRIMARY_FRACTION,
      shadowFraction: overrideMode ? 0 : env.ML_PHASE4_SHADOW_FRACTION,
      routingSource: overrideMode ? 'admin_override' : 'environment',
      modelVersionPin: mlRuntime?.modelVersionPin ?? null,
      mlHealthStatus: mlRuntime?.health?.status ?? null,
      mlBackend: mlRuntime?.health?.backend ?? null,
      mlWarmupReady: mlRuntime?.health?.warmupReady ?? null,
      activeModelVersion: mlRuntime?.health?.activeModelVersion ?? null,
      featureVersion: mlRuntime?.health?.featureVersion ?? null,
      modelDir: mlRuntime?.health?.modelDir ?? null,
      options: [
        { id: '1', label: 'heuristics', mode: 'heuristic' },
        { id: '2', label: 'ml', mode: 'primary' },
      ],
    });
  });

  app.put('/admin/phase4-mode', async (req, reply) => {
    const parsed = phase4ModeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Phase 4 mode payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const mode = parsed.data.mode === 'default' ? null : parsed.data.mode;
    const persistedMode = await setPhase4OverrideMode(mode);
    const effectiveMode = getPhase4EffectiveLabel(env.ML_PHASE4_MODE, persistedMode);
    const mlRuntime = parsed.data.modelVersionPin !== undefined
      ? await setMlRuntimeAdminState(parsed.data.modelVersionPin)
      : await getMlRuntimeAdminState();

    return reply.status(200).send({
      mode: persistedMode ?? 'default',
      envMode: env.ML_PHASE4_MODE,
      effectiveMode,
      primaryFraction: env.ML_PHASE4_PRIMARY_FRACTION,
      shadowFraction: persistedMode ? 0 : env.ML_PHASE4_SHADOW_FRACTION,
      routingSource: persistedMode ? 'admin_override' : 'environment',
      modelVersionPin: mlRuntime?.modelVersionPin ?? null,
      mlHealthStatus: mlRuntime?.health?.status ?? null,
      mlBackend: mlRuntime?.health?.backend ?? null,
      mlWarmupReady: mlRuntime?.health?.warmupReady ?? null,
      activeModelVersion: mlRuntime?.health?.activeModelVersion ?? null,
      featureVersion: mlRuntime?.health?.featureVersion ?? null,
      modelDir: mlRuntime?.health?.modelDir ?? null,
      options: [
        { id: '1', label: 'heuristics', mode: 'heuristic' },
        { id: '2', label: 'ml', mode: 'primary' },
      ],
    });
  });

  app.get('/admin/review-queue', async (req, reply) => {
    const parsed = reviewQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Review queue query is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    await ensureBatchHealthSummaries();
    const { limit, offset, sourceFilter, sortBy, sortDirection, statusFilter } = parsed.data;
    let rows = await listBatchHealthSummaries();

    rows = rows.filter((row) => row.inQueue);

    if (statusFilter === 'action_needed') {
      rows = rows.filter((row) => row.healthLabel === 'Action Needed');
    } else if (statusFilter === 'review') {
      rows = rows.filter((row) => row.healthLabel === 'Review');
    }

    if (sourceFilter !== 'all') {
      rows = rows.filter((row) => row.queueSource === sourceFilter);
    }

    rows = [...rows].sort((left, right) => {
      const leftValue = sortableReviewQueueValue(left, sortBy);
      const rightValue = sortableReviewQueueValue(right, sortBy);

      if (typeof leftValue === 'string' && typeof rightValue === 'string') {
        const comparison = leftValue.localeCompare(rightValue);
        return sortDirection === 'asc' ? comparison : -comparison;
      }

      const comparison = Number(leftValue) - Number(rightValue);
      if (comparison !== 0) {
        return sortDirection === 'asc' ? comparison : -comparison;
      }

      const fallback = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return sortDirection === 'asc' ? fallback : -fallback;
    });

    return reply.status(200).send({
      batches: rows.slice(offset, offset + limit),
      total: rows.length,
    });
  });

  app.get('/admin/review-queue/:jobId/citations', async (req, reply) => {
    const jobId = (req.params as { jobId: string }).jobId;
    const parsed = reviewQueueCitationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Review queue citations query is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const summary = await ensureBatchHealthSummary(jobId);
    if (!summary) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Batch ${jobId} was not found.`);
    }

    const payload = await listFlaggedCitationLineItems(
      jobId,
      parsed.data.cursor ?? null,
      parsed.data.limit,
    );

    return reply.status(200).send({
      jobId,
      ...payload,
    });
  });

  app.delete('/admin/reports', async (req, reply) => {
    const parsed = deleteReportsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Delete reports payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }
    const reports = await Promise.all(parsed.data.ids.map(async (id) => getReport(id)));
    const deletedCount = await deleteReports(parsed.data.ids);
    const affectedJobIds = new Set(
      reports
        .flatMap((report) => (report?.jobId ? [report.jobId] : [])),
    );
    await Promise.all([...affectedJobIds].map((jobId) => enqueueBatchHealthSummaryRebuild(jobId)));
    return reply.status(200).send({ success: true as const, deletedCount });
  });

  app.get('/admin/reports/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const report = await getReport(id);
    if (!report) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Report ${id} was not found.`);
    }
    return reply.status(200).send(await enrichStoredReport(report));
  });

  app.post('/admin/reports/:id/assign', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const report = await getReport(id);
    if (!report) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Report ${id} was not found.`);
    }
    const body = reportAssignSchema.safeParse(req.body);
    if (!body.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Assign payload is invalid.', {
        issues: body.error.flatten(),
      });
    }

    const assignedAt = new Date().toISOString();

    try {
      await updateReport(
        id,
        (current) => {
          const assigneeName = cleanOptionalString(body.data.assigneeName);
          const reviewState = current.reviewState ? structuredClone(current.reviewState) : {};
          if (assigneeName) {
            reviewState.assigneeName = assigneeName;
          } else {
            delete reviewState.assigneeName;
          }
          if (Object.keys(reviewState).length > 0) {
            current.reviewState = reviewState;
          } else {
            delete current.reviewState;
          }
          appendReviewEvent(current, {
            id: randomUUID(),
            type: 'assign',
            actor: body.data.actor,
            createdAt: assignedAt,
            ...(assigneeName
              ? { message: `Assigned to ${assigneeName}.` }
              : { message: 'Assignment cleared.' }),
          });
        },
        { expectedUpdatedAt: body.data.expectedUpdatedAt },
      );
    } catch (error) {
      handlePersistenceConflict(error);
    }

    return reply.status(200).send({
      report: await enrichStoredReport((await getReport(id))!),
    });
  });

  app.post('/admin/reports/:id/comments', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const report = await getReport(id);
    if (!report) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Report ${id} was not found.`);
    }
    const body = reportCommentSchema.safeParse(req.body);
    if (!body.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Comment payload is invalid.', {
        issues: body.error.flatten(),
      });
    }

    try {
      await updateReport(
        id,
        (current) => {
          appendReviewEvent(current, {
            id: randomUUID(),
            type: 'comment',
            actor: body.data.actor,
            createdAt: new Date().toISOString(),
            message: body.data.message,
          });
        },
        { expectedUpdatedAt: body.data.expectedUpdatedAt },
      );
    } catch (error) {
      handlePersistenceConflict(error);
    }

    return reply.status(200).send({
      report: await enrichStoredReport((await getReport(id))!),
    });
  });

  app.post('/admin/reports/:id/reject', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const report = await getReport(id);
    if (!report) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Report ${id} was not found.`);
    }
    const body = reportRejectSchema.safeParse(req.body);
    if (!body.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Reject payload is invalid.', {
        issues: body.error.flatten(),
      });
    }

    const rejectedAt = new Date().toISOString();

    try {
      await updateReport(
        id,
        (current) => {
          const note = cleanOptionalString(body.data.reason);
          current.status = 'rejected';
          current.resolutionTrace = buildResolutionTrace(current, {
            resolvedAt: rejectedAt,
            ...(note ? { note } : {}),
          });
          appendReviewEvent(current, {
            id: randomUUID(),
            type: 'reject',
            actor: body.data.actor,
            createdAt: rejectedAt,
            ...(note ? { message: note } : {}),
          });
        },
        { expectedUpdatedAt: body.data.expectedUpdatedAt },
      );
    } catch (error) {
      handlePersistenceConflict(error);
    }

    const updated = await getReport(id);
    if (updated?.jobId) {
      await enqueueBatchHealthSummaryRebuild(updated.jobId);
    }

    return reply.status(200).send({
      report: await enrichStoredReport(updated!),
    });
  });

  app.post('/admin/reports/:id/resolve', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const report = await getReport(id);
    if (!report) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Report ${id} was not found.`);
    }
    const body = reportResolutionSchema.safeParse(req.body);
    if (!body.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Resolve payload is invalid.', {
        issues: body.error.flatten(),
      });
    }

    const resolvedAt = new Date().toISOString();
    const nextStatus =
      body.data.duplicateDecision === 'confirmed_duplicate' ? ('duplicate' as const) : ('accepted' as const);

    let persistedReport: StoredReport | undefined;
    try {
      persistedReport = await updateReport(
        id,
        (current) => {
          current.status = nextStatus;
          if (body.data.correctedFields) {
            current.correctedFields = body.data.correctedFields;
          } else {
            delete current.correctedFields;
          }
          if (body.data.stageBlame.length > 0) {
            current.stageBlame = body.data.stageBlame;
          } else {
            delete current.stageBlame;
          }
          const resolvedByCommit = cleanOptionalString(body.data.resolvedByCommit);
          const resolvedByVersion = cleanOptionalString(body.data.resolvedByVersion);
          current.resolutionTrace = buildResolutionTrace(current, {
            resolvedAt,
            ...(resolvedByCommit ? { resolvedByCommit } : {}),
            ...(resolvedByVersion ? { resolvedByVersion } : {}),
          });

          const reviewState = current.reviewState ? structuredClone(current.reviewState) : {};
          reviewState.fixType = body.data.fixType;
          const referenceType = cleanOptionalString(body.data.referenceType);
          if (referenceType) {
            reviewState.referenceType = referenceType;
          } else {
            delete reviewState.referenceType;
          }
          const proposedPattern = body.data.proposedPattern
            ? (() => {
                const nextPattern: StoredProposedPattern = {
                  regex: body.data.proposedPattern.regex,
                };
                const replacement = cleanOptionalString(body.data.proposedPattern.replacement);
                if (replacement) {
                  nextPattern.replacement = replacement;
                }
                const description = cleanOptionalString(body.data.proposedPattern.description);
                if (description) {
                  nextPattern.description = description;
                }
                const category = cleanOptionalString(body.data.proposedPattern.category);
                if (category) {
                  nextPattern.category = category;
                }
                if (body.data.proposedPattern.priority != null) {
                  nextPattern.priority = body.data.proposedPattern.priority;
                }
                if (body.data.proposedPattern.fields) {
                  nextPattern.fields = body.data.proposedPattern.fields;
                }
                return nextPattern;
              })()
            : undefined;
          if (proposedPattern) {
            reviewState.proposedPattern = proposedPattern;
          } else {
            delete reviewState.proposedPattern;
          }
          const proposedStyleFix = cleanOptionalString(body.data.proposedStyleFix);
          if (proposedStyleFix) {
            reviewState.proposedStyleFix = proposedStyleFix;
          } else {
            delete reviewState.proposedStyleFix;
          }
          if (body.data.fieldApproval) {
            reviewState.fieldApproval = body.data.fieldApproval as StoredFieldApprovalMap;
          } else {
            delete reviewState.fieldApproval;
          }
          if (body.data.failureTaxonomy.length > 0) {
            reviewState.failureTaxonomy = body.data.failureTaxonomy;
          } else {
            delete reviewState.failureTaxonomy;
          }
          reviewState.duplicateDecision = body.data.duplicateDecision as StoredReportDuplicateDecision;
          if (resolvedByCommit) {
            reviewState.resolvedByCommit = resolvedByCommit;
          } else {
            delete reviewState.resolvedByCommit;
          }
          if (resolvedByVersion) {
            reviewState.resolvedByVersion = resolvedByVersion;
          } else {
            delete reviewState.resolvedByVersion;
          }
          current.reviewState = reviewState;
          appendReviewEvent(current, {
            id: randomUUID(),
            type: nextStatus === 'duplicate' ? 'duplicate' : 'resolve',
            actor: body.data.actor,
            createdAt: resolvedAt,
            ...(body.data.saveAsTruth ? { message: 'Resolved and saved as truth.' } : { message: 'Resolved without truth save.' }),
            metadata: {
              saveAsTruth: body.data.saveAsTruth,
              fixType: body.data.fixType,
              duplicateDecision: body.data.duplicateDecision,
            },
          });
        },
        { expectedUpdatedAt: body.data.expectedUpdatedAt },
      );
    } catch (error) {
      handlePersistenceConflict(error);
    }

    if (!persistedReport) {
      throw new AppError(500, ErrorCode.INTERNAL_ERROR, `Report ${id} could not be resolved.`);
    }

    if (body.data.saveAsTruth) {
      const resolutionInput = {
        saveAsTruth: true,
        ...(body.data.correctedFields ? { correctedFields: body.data.correctedFields } : {}),
        ...(body.data.fieldApproval
          ? { fieldApproval: body.data.fieldApproval as StoredFieldApprovalMap }
          : {}),
      } satisfies Parameters<typeof applyReportResolution>[1];
      await applyReportResolution(persistedReport, resolutionInput);
      const truthSavedAt = new Date().toISOString();
      try {
        persistedReport = await updateReport(
          id,
          (current) => {
            appendReviewEvent(current, {
              id: randomUUID(),
              type: 'truth_saved',
              actor: body.data.actor,
              createdAt: truthSavedAt,
              message: 'Approved truth was written from the validated resolution.',
            });
          },
          { expectedUpdatedAt: persistedReport.updatedAt },
        );
      } catch (error) {
        handlePersistenceConflict(error);
      }
    }

    const updated = await getReport(id);
    if (updated?.jobId) {
      await enqueueBatchHealthSummaryRebuild(updated.jobId);
    }

    return reply.status(200).send({
      report: await enrichStoredReport(updated!),
    });
  });

  app.post('/admin/reports/:id/add-to-stress', async (_req, reply) => {
    return reply.status(200).send({ ok: true as const });
  });

  app.get('/admin/reports', async (_req, reply) => {
    return reply.status(200).send(await listReports());
  });

  app.patch('/admin/reports/:id', async (req, reply) => {
    const parsed = reportStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Admin report update payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const id = (req.params as { id: string }).id;
    const report = await getReport(id);
    if (!report) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Report ${id} was not found.`);
    }

    await updateReport(id, (current) => {
      current.status = parsed.data.status;
    });
    if (report.jobId) {
      await enqueueBatchHealthSummaryRebuild(report.jobId);
    }
    return reply.status(200).send(await getReport(id));
  });

  app.get('/admin/corrections', async (_req, reply) => {
    return reply.status(200).send(await listCorrections());
  });

  app.patch('/admin/corrections/:id', async (req, reply) => {
    const parsed = correctionStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Admin correction update payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const id = (req.params as { id: string }).id;
    const correction = await getCorrection(id);
    if (!correction) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Correction ${id} was not found.`);
    }

    await updateCorrection(id, (current) => {
      current.status = parsed.data.status;
    });

    const updatedCorrection = (await getCorrection(id))!;
    const appliedCitation = parsed.data.status === 'approved'
      ? await approveCorrection(updatedCorrection)
      : undefined;

    return reply.status(200).send({
      correction: updatedCorrection,
      ...(appliedCitation ? { citation: appliedCitation } : {}),
    });
  });

  app.get('/admin/learning-queue', async (_req, reply) => {
    return reply.status(200).send(await listLearningQueue());
  });

  app.get('/admin/shadow-report', async (_req, reply) => {
    const [jobs, shadowRows] = await Promise.all([
      listJobs(),
      listShadowExtractionHistory(),
    ]);
    const citations = jobs.flatMap((job) => job.result?.references ?? []);

    return reply.status(200).send(buildShadowReport(citations, shadowRows));
  });

  app.get('/admin/stats', async (_req, reply) => {
    const jobs = await listJobs();
    const references = jobs.flatMap((job) => job.result?.references ?? []);
    const corrections = await listCorrections();

    return reply.status(200).send({
      jobs: {
        total: jobs.length,
        completed: jobs.filter((job) => job.status === 'completed').length,
        failed: jobs.filter((job) => job.status === 'failed').length,
        partial: jobs.filter((job) => job.status === 'partial').length,
        pending: jobs.filter((job) => job.status === 'pending' || job.status === 'processing').length,
      },
      citations: {
        total: references.length,
        ready: references.filter((reference) => reference.publicStatus === 'ready').length,
        needsReview: references.filter((reference) => reference.publicStatus === 'needs_review').length,
        needsAction: references.filter((reference) => reference.publicStatus === 'needs_action').length,
      },
      corrections: {
        pending: corrections.filter((correction) => correction.status === 'pending').length,
        approved: corrections.filter((correction) => correction.status === 'approved').length,
        rejected: corrections.filter((correction) => correction.status === 'rejected').length,
      },
      queue: {
        depth: jobs.filter((job) => job.status === 'pending' || job.status === 'processing').length,
      },
    });
  });

  registerAdminTruthRoutes(app);

  app.post('/admin/reprocess/:id', async (req, reply) => {
    const citationId = (req.params as { id: string }).id;
    const citation = await reprocessCitation(citationId);

    if (!citation) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `Citation ${citationId} was not found for reprocessing.`);
    }

    return reply.status(200).send(citation);
  });
}
