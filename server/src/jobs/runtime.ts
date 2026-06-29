import { randomUUID } from 'node:crypto';
import { buildExportContent, contentTypeForFormat } from '../export/serializers.js';
import { ErrorCode } from '../engine/errors/index.js';
import type {
  ConvertRequest,
  ExportFormat,
  JobCreatedResponse,
  JobStatusResponse,
} from '../engine/types/api.js';
import { createPipelineDependencies } from '../pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline, type PipelineArtifacts } from '../pipeline/orchestrator.js';
import {
  appendJobEvent,
  claimAsyncJobForProcessing,
  getJob,
  getJobExport,
  listClaimableAsyncJobIds,
  saveJob,
  saveCitationExtractionHistoryBatch,
  saveJobExport,
  updateJob,
  type StoredExport,
  type StoredJob,
} from '../runtime/persistence.js';
import { issueJobAccessToken } from '../runtime/jobAccess.js';
import { runtimePersistenceBackend } from '../runtime/persistence.js';
import { finalizeExportDelivery, refreshSignedExport } from '../storage/exportDelivery.js';
import { enqueueBatchHealthSummaryRebuild } from '../admin/batchHealthSummary.js';
import { emitEnrichmentBioCandidates } from '../training/enrichmentBioCandidates.js';

const activeRuntimeJobIds = new Set<string>();
const ASYNC_JOB_STALE_MS = 10 * 60 * 1000;
const RUNTIME_JOB_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

const runtimeJobSnapshots = new Map<string, {
  expiresAt: number;
  job: StoredJob;
}>();
const runtimeJobSnapshotWaiters = new Map<string, Set<(job: StoredJob) => void>>();

export interface RuntimeJobOwner {
  userId?: string;
  orgId?: string;
  apiKeyId?: string;
  tier?: StoredJob['tier'];
}

interface StoreCompletedJobOptions {
  deferPersistence?: boolean;
}

export async function queueRuntimeJob(
  request: ConvertRequest,
  owner: RuntimeJobOwner = {},
): Promise<JobCreatedResponse> {
  const jobId = randomUUID();
  const createdAt = new Date().toISOString();

  await saveJob({
    id: jobId,
    request,
    ...(owner.userId ? { userId: owner.userId } : {}),
    ...(owner.orgId ? { orgId: owner.orgId } : {}),
    ...(owner.apiKeyId ? { apiKeyId: owner.apiKeyId } : {}),
    ...(owner.tier ? { tier: owner.tier } : {}),
    executionMode: 'async',
    status: 'pending',
    createdAt,
    progress: {
      totalRefs: 0,
      processedRefs: 0,
      currentPhase: null,
      percentComplete: 0,
    },
    exports: {},
    events: [],
  });

  await appendJobEvent(jobId, {
    event: 'queued',
    data: {
      status: 'pending',
      jobId,
    },
  });

  await dispatchRuntimeJob(jobId, request, owner);

  return {
    jobId,
    jobAccessToken: await issueJobAccessToken(jobId),
    status: 'pending',
    estimatedDuration: 5,
  };
}

export async function storeCompletedJob(
  request: ConvertRequest,
  artifacts: PipelineArtifacts,
  executionMode: 'sync' | 'async' = 'sync',
  owner: RuntimeJobOwner = {},
  options: StoreCompletedJobOptions = {},
): Promise<StoredJob> {
  const status = artifacts.response.status === 'success' ? 'completed' : 'partial';
  const existing = await getJob(artifacts.response.jobId);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const completedAt = new Date().toISOString();
  const references = artifacts.response.references.map((citation) => ({
    ...citation,
    createdAt: citation.createdAt ?? createdAt,
    updatedAt: citation.updatedAt ?? completedAt,
  }));
  const events = [...(existing?.events ?? [])];
  events.push({
    id: events.length + 1,
    event: 'complete',
    data: {
      status,
      jobId: artifacts.response.jobId,
    },
  });

  const job: StoredJob = {
    id: artifacts.response.jobId,
    request,
    ...(owner.userId ? { userId: owner.userId } : {}),
    ...(owner.orgId ? { orgId: owner.orgId } : {}),
    ...(owner.apiKeyId ? { apiKeyId: owner.apiKeyId } : {}),
    ...(owner.tier ? { tier: owner.tier } : {}),
    executionMode,
    status,
    createdAt,
    completedAt,
    progress: {
      totalRefs: artifacts.response.summary.total,
      processedRefs: artifacts.response.summary.total,
      currentPhase: 'rendering',
      percentComplete: 100,
    },
    result: {
      ...artifacts.response,
      references,
    },
    textExport: artifacts.textExport,
    exports: {
      txt: buildStoredExport(artifacts.response.jobId, 'txt', artifacts.textExport),
    },
    events,
  };

  cacheRuntimeJobSnapshot(job);
  const persist = async () => {
    const textExportArtifact = await finalizeExportDelivery(
      artifacts.response.jobId,
      buildStoredExport(artifacts.response.jobId, 'txt', artifacts.textExport),
    );
    job.exports = {
      txt: textExportArtifact,
    };
    cacheRuntimeJobSnapshot(job);
    await saveJob(job);
    cacheRuntimeJobSnapshot(job);
    await saveCitationExtractionHistoryBatch(buildCitationExtractionHistoryEntries(job.id, artifacts));
    await enqueueBatchHealthSummaryRebuild(job.id);
  };

  if (options.deferPersistence) {
    queueMicrotask(() => {
      void persist().catch((error) => {
        console.error('[runtime] deferred completed job persistence failed:', error);
      });
    });
    return job;
  }

  await persist();
  return job;
}

function buildCitationExtractionHistoryEntries(
  jobId: string,
  artifacts: PipelineArtifacts,
) {
  return artifacts.citations.flatMap((citation) => {
    if (!citation.extractionMeta) return [];
    return [{
      id: randomUUID(),
      citationId: citation.id,
      jobId,
      ...structuredClone(citation.extractionMeta),
    }];
  });
}

export function getRuntimeJobSnapshot(jobId: string): StoredJob | undefined {
  const snapshot = runtimeJobSnapshots.get(jobId);
  if (!snapshot) return undefined;
  if (snapshot.expiresAt <= Date.now()) {
    runtimeJobSnapshots.delete(jobId);
    return undefined;
  }
  return structuredClone(snapshot.job);
}

export async function getRuntimeOrPersistedJob(jobId: string): Promise<StoredJob | undefined> {
  const snapshot = getRuntimeJobSnapshot(jobId);
  if (snapshot) return snapshot;

  if (!activeRuntimeJobIds.has(jobId)) {
    return getJob(jobId);
  }

  const runtimeSnapshot = await waitForRuntimeJobSnapshot(jobId, 3_000);
  if (runtimeSnapshot) {
    return runtimeSnapshot;
  }

  return getJob(jobId);
}

function cacheRuntimeJobSnapshot(job: StoredJob): void {
  runtimeJobSnapshots.set(job.id, {
    expiresAt: Date.now() + RUNTIME_JOB_SNAPSHOT_TTL_MS,
    job: structuredClone(job),
  });
  const waiters = runtimeJobSnapshotWaiters.get(job.id);
  if (!waiters) return;
  runtimeJobSnapshotWaiters.delete(job.id);
  for (const resolve of waiters) {
    resolve(structuredClone(job));
  }
}

function waitForRuntimeJobSnapshot(jobId: string, timeoutMs: number): Promise<StoredJob | undefined> {
  return new Promise((resolve) => {
    const snapshot = getRuntimeJobSnapshot(jobId);
    if (snapshot) {
      resolve(snapshot);
      return;
    }

    const resolveAndCleanup = (job: StoredJob | undefined) => {
      clearTimeout(timeout);
      const waiters = runtimeJobSnapshotWaiters.get(jobId);
      waiters?.delete(resolveAndCleanup);
      if (waiters?.size === 0) {
        runtimeJobSnapshotWaiters.delete(jobId);
      }
      resolve(job);
    };
    const timeout = setTimeout(() => resolveAndCleanup(undefined), timeoutMs);
    const waiters = runtimeJobSnapshotWaiters.get(jobId) ?? new Set<(job: StoredJob) => void>();
    waiters.add(resolveAndCleanup);
    runtimeJobSnapshotWaiters.set(jobId, waiters);
  });
}

export function buildJobStatusResponse(job: StoredJob): JobStatusResponse {
  return {
    jobId: job.id,
    status: job.status,
    executionMode: job.executionMode,
    ...(job.progress ? { progress: job.progress } : {}),
    ...(job.result ? {
      executionProfile: job.result.executionProfile,
      coreParseLatencyMs: job.result.coreParseLatencyMs,
      summary: job.result.summary,
      countAudit: job.result.countAudit,
      references: job.result.references,
      exports: job.result.exports,
      overlay: job.result.overlay,
      warnings: job.result.warnings,
      diagnostics: job.result.diagnostics,
    } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

export async function ensureJobExport(jobId: string, format: ExportFormat): Promise<StoredExport | undefined> {
  const existing = await getJobExport(jobId, format);
  if (existing) {
    const refreshed = await refreshSignedExport(existing);
    if (refreshed !== existing) {
      await saveJobExport(jobId, refreshed);
    }
    return refreshed;
  }

  const job = await getJob(jobId);
  if (!job?.result) return undefined;

  const content = format === 'txt' && job.textExport
    ? job.textExport
    : await buildExportContent(format, job.result.references);
  const artifact = await finalizeExportDelivery(jobId, buildStoredExport(jobId, format, content));
  await saveJobExport(jobId, artifact);
  return artifact;
}

async function processRuntimeJob(jobId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - ASYNC_JOB_STALE_MS);
  const claimedJob = runtimePersistenceBackend === 'database'
    ? await claimAsyncJobForProcessing(jobId, staleBefore)
    : undefined;
  const job = claimedJob ?? await getJob(jobId);
  if (!job) return;
  if (runtimePersistenceBackend === 'database' && !claimedJob) {
    return;
  }

  await updateJob(jobId, (current) => {
    current.status = 'processing';
    current.progress = {
      totalRefs: 0,
      processedRefs: 0,
      currentPhase: 'ingestion',
      percentComplete: 5,
    };
  });
  await appendJobEvent(jobId, {
    event: 'processing',
    data: {
      status: 'processing',
      jobId,
    },
  });

  try {
    const ctx = createPipelineContext({
      jobId,
      outputStyle: job.request.outputStyle ?? 'apa7',
      ...(job.request.options ? { options: job.request.options } : {}),
      tenantContext: {
        tier: job.tier === 'pro' || job.tier === 'b2b' ? job.tier : 'free',
        ...(job.userId ? { userId: job.userId } : {}),
        ...(job.orgId ? { orgId: job.orgId } : {}),
        ...(job.apiKeyId ? { apiKeyId: job.apiKeyId } : {}),
      },
    });
    const artifacts = await runConvertPipeline(job.request, ctx, createPipelineDependencies());
    await storeCompletedJob(job.request, artifacts, 'async', {
      ...(job.userId ? { userId: job.userId } : {}),
      ...(job.orgId ? { orgId: job.orgId } : {}),
      ...(job.apiKeyId ? { apiKeyId: job.apiKeyId } : {}),
      ...(job.tier ? { tier: job.tier } : {}),
    });

    // Pro enrichment recovery (bulk path): collect BIO-training candidates for any references that
    // were auto-recovered, mirroring the inline convert route. Best-effort — never fails the job.
    const recoveredIds = new Set(ctx.enrichmentRecovery?.recoveredCarrierIds ?? []);
    if (recoveredIds.size > 0) {
      try {
        await emitEnrichmentBioCandidates(
          artifacts.response.references
            .filter((citation) => recoveredIds.has(citation.id))
            .map((citation) => ({
              rawText: citation.raw,
              fields: citation.fields,
              expectedType: citation.referenceType,
            })),
        );
      } catch {
        // best-effort
      }
    }

    for (const record of artifacts.response.diagnostics ?? []) {
      await appendJobEvent(jobId, {
        event: 'phase_complete',
        data: {
          phaseId: record.phaseId,
          status: record.status,
          durationMs: record.durationMs,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Async job failed.';

    await updateJob(jobId, (current) => {
      current.status = 'failed';
      current.completedAt = new Date().toISOString();
      current.error = {
        code: ErrorCode.PHASE_ERROR,
        message,
      };
      current.progress = {
        totalRefs: current.progress?.totalRefs ?? 0,
        processedRefs: current.progress?.processedRefs ?? 0,
        currentPhase: 'failed',
        percentComplete: current.progress?.percentComplete ?? 0,
      };
    });

    await appendJobEvent(jobId, {
      event: 'error',
      data: {
        code: ErrorCode.PHASE_ERROR,
        message,
      },
    });
  }
}

async function dispatchRuntimeJob(
  jobId: string,
  _request: ConvertRequest,
  _owner: RuntimeJobOwner,
): Promise<void> {
  scheduleRuntimeJobProcessing(jobId);
}

function scheduleRuntimeJobProcessing(jobId: string): void {
  if (activeRuntimeJobIds.has(jobId)) {
    return;
  }
  activeRuntimeJobIds.add(jobId);
  queueMicrotask(() => {
    void processRuntimeJob(jobId).finally(() => {
      activeRuntimeJobIds.delete(jobId);
    });
  });
}

export async function resumeRuntimeJobs(): Promise<void> {
  if (runtimePersistenceBackend !== 'database') {
    return;
  }
  const staleBefore = new Date(Date.now() - ASYNC_JOB_STALE_MS);
  const ids = await listClaimableAsyncJobIds(staleBefore, 25);
  for (const jobId of ids) {
    scheduleRuntimeJobProcessing(jobId);
  }
}

function buildStoredExport(jobId: string, format: ExportFormat, content: string | Buffer): StoredExport {
  return {
    format,
    content,
    contentType: contentTypeForFormat(format),
    fileName: `${jobId}.${format}`,
    generatedAt: new Date().toISOString(),
    delivery: 'inline',
    sizeBytes: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength,
  };
}
