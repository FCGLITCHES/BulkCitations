import { Worker } from 'node:worker_threads';
import { env } from '../config.js';
import { ErrorCode } from '../engine/errors/index.js';
import { phase1Ingest } from '../engine/phases/phase1Ingest.js';
import { phase2Split } from '../engine/phases/phase2Split.js';
import { phase6_5LLMFallback } from '../engine/phases/phase6_5LLMFallback.js';
import { phase6_8SharedRepair } from '../engine/phases/phase6_8SharedRepair.js';
import { phase7Normalize } from '../engine/phases/phase7Normalize.js';
import { Phase8Enrich } from '../engine/phases/phase8Enrich.js';
import { phase9Dedup } from '../engine/phases/phase9Dedup.js';
import { phase10Health } from '../engine/phases/phase10Health.js';
import { phase11Authority } from '../engine/phases/phase11Authority.js';
import { phase12Render } from '../engine/phases/phase12Render.js';
import { correctOcrInFields } from '../engine/ingestion/ocrCorrect.js';
import { stripDuplicatedContainerTail } from '../engine/fieldOverlap.js';
import { recoverNeedsActionCarriers } from '../engine/enrichmentRecovery.js';
import { lookupEnrichedReference, recordEnrichedReference } from '../runtime/enrichmentCacheStore.js';
import {
  applyCertifiedApprovedTruthOverlays,
  phase13FeedbackLoop,
} from '../engine/phases/phase13FeedbackLoop.js';
import { syncFieldUncertainty } from '../engine/fieldConfidence.js';
import {
  captureCarrierFieldSnapshot,
  deriveParseOutcome,
  enforceStickyInvariants,
  recordFieldMoves,
} from '../engine/reliability.js';
import { representativeStyleForFamily, styleFamilyForStyle } from '../engine/styleDetection.js';
import type { ReferenceCarrier, StyleDetectionResult } from '../engine/types/carrier.js';
import type { CitationStyle, ExtractedFields, ProcessedCitation, ReferenceType } from '../engine/types/citation.js';
import { fieldOf } from '../engine/types/field.js';
import type { BatchEnvelope, RawBlock, SplitQualityFlag } from '../engine/types/ingestion.js';
import type { ConvertRequest, ConvertResponse } from '../engine/types/api.js';
import {
  type CountAudit,
  type PipelineContext,
  type PipelineOptions,
  type PipelineRuntimeTuning,
  type StageRunRecord,
  type TenantContext,
} from '../engine/types/pipeline.js';
import { buildReferenceCarrier } from '../engine/utils/carriers.js';
import { parseAuthorSegment } from '../engine/utils/authors.js';
import { createEmptyExtractedFields, hasFieldValue, setExtractedField } from '../engine/utils/fields.js';
import { normalizeDoi } from '../engine/identifierUtils.js';
import type { CrossrefService } from '../services/crossref.js';
import { crossrefService } from '../services/crossref.js';
import { verifyDoiAgainstRecord } from '../engine/doiVerification.js';
import { createPipelineContext, type CreatePipelineContextInput } from './context.js';
import { runCorePipelineBatch } from './coreBatch.js';
import { createPipelineDependencies, type PipelineDependencies } from './dependencies.js';
import {
  initializeReliabilityState,
  mergeNormalizationStats,
  mergeSharedRepairStats,
  pushIntegratedFastLaneStageSummaries,
  runObservedMutationStage,
  runInlineFastLanePostProcessing,
  shouldInlineFastLanePostProcessing,
  type IntegratedFastLaneStageStats,
} from './fastLane.js';
import { toStageTimingSummary } from './performance.js';
import { chunkBlocksPreservingSemanticGroups } from './blockBatching.js';
import { createWeightedWorkerAssignments } from './workerScheduling.js';
import { listApprovedTruth } from '../runtime/persistence.js';
import type { StoredApprovedTruth } from '../runtime/store.js';
import { effectiveRowStatus, withLegacyCertification } from '../training/truthCertification.js';
import {
  lookupAuthorityDoiHints,
  type AuthorityDoiHintMatch,
} from '../engine/data/authorityPack.js';
import { reconcileIdentifierAuthorGroups } from '../engine/phases/phase5AuthorDisambig.js';
import type {
  CoreFastWorkerAssignment,
  CoreFastWorkerRequest,
  CoreFastWorkerResult,
} from './coreFastWorker.js';

export interface PipelineArtifacts {
  response: ConvertResponse;
  citations: ProcessedCitation[];
  textExport: string;
  countAudit: CountAudit;
}

export interface PresplitPipelineInput {
  sourceType: ConvertRequest['sourceType'];
  blocks: RawBlock[];
  countAudit?: CountAudit;
  detectionMeta?: {
    confidence: number;
    sampled: boolean;
    splitQualityFlag: SplitQualityFlag;
  };
}

interface BatchedCorePipelineResult {
  carriers: ReferenceCarrier[];
  integratedStageStats: IntegratedFastLaneStageStats | null;
}

interface PersistentCoreFastWorkerSlot {
  worker: Worker;
  ready: Promise<void>;
}

type CoreFastWorkerMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'result';
      payload: CoreFastWorkerResult;
      requestId?: number;
    }
  | {
      type: 'error';
      requestId?: number;
      error: {
        message: string;
        stack?: string;
      };
    };

let persistentCoreFastWorkerPool: PersistentCoreFastWorkerSlot[] = [];
let persistentCoreFastWorkerPoolBusy = false;
let persistentCoreFastWorkerRequestId = 0;
const CORE_FAST_WORKER_WARMUP_REFS_PER_WORKER = 16;

export { createPipelineContext, type CreatePipelineContextInput } from './context.js';

export interface PrecomputedIngest {
  envelope: BatchEnvelope;
  stageLog: StageRunRecord[];
}

export async function runConvertPipeline(
  request: ConvertRequest,
  ctx: PipelineContext,
  deps: Partial<PipelineDependencies> = {},
  precomputedIngest?: PrecomputedIngest,
): Promise<PipelineArtifacts> {
  const resolvedDeps = createPipelineDependencies(deps);
  // Reuse a phase-1 ingest result already computed for this request (e.g. the convert
  // preflight count estimate) instead of re-normalizing/re-detecting identical input.
  // The cached stage records are replayed onto this context so diagnostics are unchanged.
  let envelope: BatchEnvelope;
  if (precomputedIngest) {
    ctx.stageLog.push(...structuredClone(precomputedIngest.stageLog));
    envelope = structuredClone(precomputedIngest.envelope);
  } else {
    envelope = await phase1Ingest.run({
      sourceType: request.sourceType,
      content: request.content,
    }, ctx);
  }

  let carriers: ReferenceCarrier[];
  let countAudit: CountAudit;

  if (request.sourceType === 'doi_list') {
    carriers = await resolveDoiFastPath(envelope.detectedDois, ctx);
    carriers = await runDoiCorePipeline(carriers, ctx, resolvedDeps);
    const inlineFastLaneStats = shouldInlineFastLanePostProcessing(ctx)
      ? await runInlineFastLanePostProcessing(carriers, ctx)
      : null;
    carriers = inlineFastLaneStats?.carriers ?? carriers;
    if (inlineFastLaneStats) {
      pushIntegratedFastLaneStageSummaries(ctx, {
        sharedRepair: inlineFastLaneStats.sharedRepair,
        normalization: inlineFastLaneStats.normalization,
      });
    } else {
      initializeReliabilityState(carriers);
      carriers = await runObservedMutationStage(
        carriers,
        ctx,
        'shared_repair',
        () => phase6_8SharedRepair.run(carriers, ctx),
      );
      carriers = await runObservedMutationStage(
        carriers,
        ctx,
        'normalization',
        () => phase7Normalize.run(carriers, ctx),
      );
    }
    countAudit = {
      inputEstimate: envelope.estimatedCount,
      aggregatedCount: carriers.length,
      splitCount: carriers.length,
      delta: carriers.length - envelope.estimatedCount,
      needsActionCount: carriers.filter((carrier) => carrier.publicStatus === 'needs_action').length,
      droppedCount: 0,
    };
  } else {
    const splitResult = await phase2Split.run(envelope, ctx);
    countAudit = splitResult.countAudit;
    const resolvedEnvelope = splitResult.resolvedEnvelope;
    ctx.detectionMeta = {
      confidence: resolvedEnvelope.detection?.confidence ?? resolvedEnvelope.formatConfidence,
      sampled: resolvedEnvelope.detection?.sampled ?? false,
      splitQualityFlag: splitResult.splitQualityFlag,
    };
    carriers = await runNonDoiPipelineFromBlocks(splitResult.blocks, ctx, resolvedDeps);
  }

  return finalizePipelineArtifacts(carriers, countAudit, ctx);
}

export async function runConvertPipelineFromBlocks(
  input: PresplitPipelineInput,
  ctx: PipelineContext,
  deps: Partial<PipelineDependencies> = {},
): Promise<PipelineArtifacts> {
  const resolvedDeps = createPipelineDependencies(deps);
  ctx.detectionMeta = input.detectionMeta ?? {
    confidence: 1,
    sampled: false,
    splitQualityFlag: 'ok',
  };
  const carriers = await runNonDoiPipelineFromBlocks(input.blocks, ctx, resolvedDeps);
  const countAudit = input.countAudit ?? buildPresplitCountAudit(input.blocks.length);
  return finalizePipelineArtifacts(carriers, countAudit, ctx);
}

async function finalizePipelineArtifacts(
  carriers: ReferenceCarrier[],
  countAudit: CountAudit,
  ctx: PipelineContext,
): Promise<PipelineArtifacts> {
  carriers = await phase9Dedup.run(carriers, ctx);
  carriers = await phase10Health.run(carriers, ctx);
  if (ctx.options.enrichRecovery) {
    // Pro-only: verified enrichment recovery of needs_action references → ready. Bounded per batch;
    // mismatches are left in needs_action. Counts are surfaced to the user by the convert route.
    ctx.enrichmentRecovery = await recoverNeedsActionCarriers(carriers, ctx, {
      maxLookups: 100,
      cache: { lookup: lookupEnrichedReference, record: recordEnrichedReference },
    });
  }
  if (ctx.options.authorityValidation) {
    carriers = await phase11Authority.run(carriers, ctx);
  } else {
    ctx.stageLog.push({
      stageId: 'phase11_authority_validation',
      contractVersion: 1,
      phaseId: 'authority_validation',
      status: 'skipped',
      durationMs: 0,
      message: 'Phase 11 authority validation disabled by request options.',
    });
  }
  // OCR-correct word-bearing output fields (English-only, dictionary-gated). Runs post-extraction
  // so it never affects tagging/extraction — only cleans the final field values. Gated to PDF/OCR
  // cleanup mode, so clean single refs skip it entirely.
  if (ctx.options.enablePdfCleanup) {
    carriers = correctOcrInFields(carriers);
  }
  // Field-overlap guard: never let a structured value (pages/volume/issue/year) also remain inside a
  // container field, or the same value renders twice — e.g. journal "Journal, ?, 770-778" alongside a
  // separate pages field, when a non-numeric volume placeholder defeats the structured splitter.
  // Always on; only fires on a genuine trailing publication-detail duplication.
  carriers = stripDuplicatedContainerTail(carriers);
  carriers = await phase12Render.run(carriers, ctx);
  if (ctx.options.feedbackLoop) {
    carriers = await runObservedMutationStage(
      carriers,
      ctx,
      'feedback_loop',
      () => phase13FeedbackLoop.run(carriers, ctx),
    );
  } else if (ctx.tenantContext.skipApprovedTruthOverlays) {
    ctx.stageLog.push({
      stageId: 'phase13_feedback_loop',
      contractVersion: 1,
      phaseId: 'feedback_loop',
      status: 'skipped',
      durationMs: 0,
      message: 'Phase 13 approved truth overlays skipped for evidence-only run.',
    });
  } else {
    const feedbackStartedAt = Date.now();
    const appliedApprovedTruthOverlays = await applyCertifiedApprovedTruthOverlays(carriers, ctx);
    ctx.stageLog.push({
      stageId: 'phase13_feedback_loop',
      contractVersion: 1,
      phaseId: 'feedback_loop',
      status: appliedApprovedTruthOverlays > 0 ? 'success' : 'skipped',
      durationMs: Date.now() - feedbackStartedAt,
      message: appliedApprovedTruthOverlays > 0
        ? `Phase 13 applied ${appliedApprovedTruthOverlays} certified approved truth overlay(s) with full feedback loop disabled.`
        : 'Phase 13 feedback loop disabled by core-lane pipeline options.',
    });
  }

  carriers.sort((left, right) => left.index - right.index);

  const includeCarrierDiagnostics = shouldIncludeCarrierDiagnostics(ctx);
  const citations = carriers.map((carrier) =>
    toProcessedCitation(
      carrier,
      resolveOutputStyle(ctx.outputStyle, carrier.style.primary.style, carrier.style.family),
      includeCarrierDiagnostics,
    ),
  );
  const failedIndices = citations.filter((citation) => citation.status === 'error').map((citation) => citation.index);
  const diagnostics = structuredClone(ctx.stageLog);
  const totalDurationMs = Date.now() - ctx.startedAt;
  const warnings = [...new Set(
    diagnostics
      .filter((record) => record.status === 'warning' || record.status === 'error')
      .map((record) => record.message)
      .filter((message): message is string => Boolean(message)),
  )];
  const textExport = citations.map((citation) => citation.renderedText || citation.raw).join('\n');
  emitHealthTelemetry(carriers);

  return {
    response: {
      jobId: ctx.jobId,
      status: failedIndices.length > 0 ? 'partial' : 'success',
      executionProfile: ctx.executionPolicy.parseProfile,
      coreParseLatencyMs: totalDurationMs,
      summary: buildSummary(citations),
      references: citations,
      failedIndices,
      duplicateGroups: buildDuplicateGroups(carriers),
      exports: [
        { format: 'txt', available: true },
        { format: 'bib', available: false },
        { format: 'ris', available: false },
        { format: 'csv', available: false },
        { format: 'docx', available: false },
      ],
      countAudit,
      processingPath: {
        stagesRun: [...new Set(diagnostics.map((record) => record.phaseId))],
        fallbacksUsed: [...new Set(
          diagnostics
            .filter((record) => record.status === 'warning' && record.code)
            .map((record) => record.code as string),
        )],
        durationMs: totalDurationMs,
        partialResult: failedIndices.length > 0,
        batchConfig: {
          batchSize: ctx.runtimeTuning.batchSize,
          maxConcurrency: ctx.runtimeTuning.maxConcurrency,
        },
        stageTimings: toStageTimingSummary(ctx),
      },
      providerUsage: structuredClone(ctx.providerUsage),
      overlay: {
        status: 'not_requested',
        jobId: null,
        providerLatencyMs: null,
      },
      warnings,
      diagnostics,
    },
    citations,
    textExport,
    countAudit,
  };
}

async function runNonDoiPipelineFromBlocks(
  blocks: RawBlock[],
  ctx: PipelineContext,
  deps: PipelineDependencies,
): Promise<ReferenceCarrier[]> {
  const batchedCoreResult = await runBatchedCorePipeline(blocks, ctx, deps);
  let carriers = batchedCoreResult.carriers;

  if (batchedCoreResult.integratedStageStats) {
    pushIntegratedFastLaneStageSummaries(ctx, batchedCoreResult.integratedStageStats);
  } else {
    initializeReliabilityState(carriers);
    carriers = await runObservedMutationStage(
      carriers,
      ctx,
      'shared_repair',
      () => phase6_8SharedRepair.run(carriers, ctx),
    );
  }

  if (ctx.options.llmFallback) {
    carriers = await runObservedMutationStage(
      carriers,
      ctx,
      'llm_fallback',
      () => phase6_5LLMFallback.run(carriers, ctx),
    );
  } else {
    ctx.stageLog.push({
      stageId: 'phase6_5_llm_fallback',
      contractVersion: 1,
      phaseId: 'llm_fallback',
      status: 'skipped',
      durationMs: 0,
      message: 'Phase 6.5 LLM fallback disabled by request options.',
    });
  }

  if (!batchedCoreResult.integratedStageStats) {
    carriers = await runObservedMutationStage(
      carriers,
      ctx,
      'normalization',
      () => phase7Normalize.run(carriers, ctx),
    );
  }

  if (ctx.options.enrich) {
    const enrichment = deps.enrichmentPhase ?? new Phase8Enrich(deps.crossrefService ?? crossrefService);
    carriers = await runObservedMutationStage(
      carriers,
      ctx,
      'enrichment',
      () => enrichment.run(carriers, ctx),
    );
  } else {
    ctx.stageLog.push({
      stageId: 'phase8_enrich',
      contractVersion: 1,
      phaseId: 'enrichment',
      status: 'skipped',
      durationMs: 0,
      message: 'Phase 8 enrichment disabled by core-lane pipeline options.',
    });
  }

  return carriers;
}

async function runBatchedCorePipeline(
  blocks: RawBlock[],
  ctx: PipelineContext,
  deps: PipelineDependencies,
): Promise<BatchedCorePipelineResult> {
  const batches = chunkBlocksPreservingSemanticGroups(blocks, ctx.runtimeTuning.batchSize);
  if (shouldUseCoreFastWorkerThreads(ctx, blocks, batches.length)) {
    return runBatchedCorePipelineInWorkers(batches, ctx);
  }

  const results: ReferenceCarrier[][] = new Array(batches.length);
  const inlineFastLanePostProcessing = shouldInlineFastLanePostProcessing(ctx);
  const sharedRepairStatsByBatch: Array<IntegratedFastLaneStageStats['sharedRepair'] | undefined> = new Array(batches.length);
  const normalizationStatsByBatch: Array<IntegratedFastLaneStageStats['normalization'] | undefined> = new Array(batches.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const batchIndex = cursor;
      cursor += 1;

      if (batchIndex >= batches.length) return;

      const batch = batches[batchIndex];
      if (!batch) return;

      const result = await runCorePipelineBatch(batch, ctx, deps);
      if (inlineFastLanePostProcessing && result.integratedStageStats) {
        sharedRepairStatsByBatch[batchIndex] = result.integratedStageStats.sharedRepair;
        normalizationStatsByBatch[batchIndex] = result.integratedStageStats.normalization;
      }
      results[batchIndex] = result.carriers;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(ctx.runtimeTuning.maxConcurrency, batches.length)) },
      () => worker(),
    ),
  );

  return {
    carriers: finalizeBatchedCoreCarriers(results.flat(), ctx),
    integratedStageStats: inlineFastLanePostProcessing
      ? {
          sharedRepair: mergeSharedRepairStats(sharedRepairStatsByBatch),
          normalization: mergeNormalizationStats(normalizationStatsByBatch),
        }
      : null,
  };
}

function shouldUseCoreFastWorkerThreads(
  ctx: PipelineContext,
  blocks: RawBlock[],
  batchCount: number,
): boolean {
  if (!env.PIPELINE_FAST_WORKERS_ENABLED) {
    return false;
  }
  if (ctx.executionPolicy.parseProfile !== 'core_parse_fast') {
    return false;
  }
  if (ctx.runtimeTuning.maxConcurrency <= 1 || batchCount <= 1) {
    return false;
  }

  const threshold = ctx.runtimeTuning.fastLaneMulticoreMinRefs ?? env.PIPELINE_FAST_MULTICORE_MIN_REFS;
  return blocks.length >= threshold;
}

async function runBatchedCorePipelineInWorkers(
  batches: RawBlock[][],
  ctx: PipelineContext,
): Promise<BatchedCorePipelineResult> {
  const assignments = createCoreFastWorkerAssignments(
    batches,
    Math.max(1, Math.min(ctx.runtimeTuning.maxConcurrency, batches.length)),
  );
  if (assignments.length === 0) {
    return {
      carriers: [],
      integratedStageStats: shouldInlineFastLanePostProcessing(ctx)
        ? {
            sharedRepair: mergeSharedRepairStats([]),
            normalization: mergeNormalizationStats([]),
          }
        : null,
    };
  }

  const workerUrl = new URL('../../scripts/pipeline/core-fast-worker-bootstrap.mjs', import.meta.url);
  if (ctx.runtimeTuning.profile === 'site_default') {
    return runBatchedCorePipelineInPersistentWorkers(assignments, ctx, workerUrl);
  }
  return runBatchedCorePipelineInOneShotWorkers(assignments, ctx, workerUrl);
}

async function runBatchedCorePipelineInOneShotWorkers(
  assignments: CoreFastWorkerAssignment[][],
  ctx: PipelineContext,
  workerUrl: URL,
): Promise<BatchedCorePipelineResult> {
  const workers: Worker[] = [];
  const abortHandler = (): void => {
    for (const worker of workers) {
      void worker.terminate();
    }
  };
  ctx.abortSignal?.addEventListener('abort', abortHandler, { once: true });

  try {
    const workerResults = await Promise.all(
      assignments.map(async (assignment) => {
        const worker = new Worker(workerUrl, {
          workerData: {
            assignments: assignment,
            outputStyle: ctx.outputStyle,
            pipelineOptions: ctx.options,
            runtimeTuning: ctx.runtimeTuning,
            tenantContext: ctx.tenantContext,
            ...(ctx.detectionMeta ? { detectionMeta: ctx.detectionMeta } : {}),
          } satisfies CoreFastWorkerRequest,
        });
        workers.push(worker);
        return awaitCoreFastWorkerResult(worker);
      }),
    );

    return mergeCoreFastWorkerResults(workerResults, ctx);
  } finally {
    ctx.abortSignal?.removeEventListener('abort', abortHandler);
    await Promise.allSettled(workers.map((worker) => worker.terminate()));
  }
}

async function runBatchedCorePipelineInPersistentWorkers(
  assignments: CoreFastWorkerAssignment[][],
  ctx: PipelineContext,
  workerUrl: URL,
): Promise<BatchedCorePipelineResult> {
  if (persistentCoreFastWorkerPoolBusy) {
    return runBatchedCorePipelineInOneShotWorkers(assignments, ctx, workerUrl);
  }

  persistentCoreFastWorkerPoolBusy = true;
  try {
    const workers = ensurePersistentCoreFastWorkerPool(assignments.length, workerUrl);
    await Promise.all(workers.map((slot) => slot.ready));
    const workerResults = await Promise.all(
      assignments.map((assignment, index) =>
        runPersistentCoreFastWorkerRequest(workers[index]?.worker, {
          assignments: assignment,
          outputStyle: ctx.outputStyle,
          pipelineOptions: ctx.options,
          runtimeTuning: ctx.runtimeTuning,
          tenantContext: ctx.tenantContext,
          ...(ctx.detectionMeta ? { detectionMeta: ctx.detectionMeta } : {}),
        }),
      ),
    );
    return mergeCoreFastWorkerResults(workerResults, ctx);
  } finally {
    persistentCoreFastWorkerPoolBusy = false;
  }
}

function ensurePersistentCoreFastWorkerPool(
  count: number,
  workerUrl: URL,
): PersistentCoreFastWorkerSlot[] {
  if (persistentCoreFastWorkerPool.length === count) {
    return persistentCoreFastWorkerPool;
  }

  for (const slot of persistentCoreFastWorkerPool) {
    void slot.worker.terminate();
  }

  persistentCoreFastWorkerPool = Array.from({ length: count }, () => createPersistentCoreFastWorker(workerUrl));
  return persistentCoreFastWorkerPool;
}

function createPersistentCoreFastWorker(workerUrl: URL): PersistentCoreFastWorkerSlot {
  const worker = new Worker(workerUrl, {
    workerData: {
      mode: 'persistent',
    },
  });
  const ready = new Promise<void>((resolve, reject) => {
    const onMessage = (message: CoreFastWorkerMessage): void => {
      if (message.type !== 'ready') {
        return;
      }
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(new Error(`Persistent core fast worker failed to start: ${error.message}`));
    };
    const onExit = (code: number): void => {
      cleanup();
      reject(new Error(`Persistent core fast worker exited before ready with code ${code}.`));
    };
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
  });
  return { worker, ready };
}

async function runPersistentCoreFastWorkerRequest(
  worker: Worker | undefined,
  request: CoreFastWorkerRequest,
): Promise<CoreFastWorkerResult> {
  if (!worker) {
    throw new Error('Persistent core fast worker assignment did not have a worker slot.');
  }

  const requestId = ++persistentCoreFastWorkerRequestId;
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onMessage = (message: CoreFastWorkerMessage): void => {
      if (message.type === 'ready' || message.requestId !== requestId) {
        return;
      }
      if (message.type === 'error') {
        const error = new Error(message.error.message);
        if (message.error.stack) {
          error.stack = message.error.stack;
        }
        fail(error);
        return;
      }
      cleanup();
      resolve(message.payload);
    };
    const onError = (error: Error): void => {
      fail(new Error(`Persistent core fast worker crashed: ${error.message}`));
    };
    const onExit = (code: number): void => {
      fail(new Error(`Persistent core fast worker exited with code ${code}.`));
    };

    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.postMessage({
      requestId,
      request,
    });
  });
}

function mergeCoreFastWorkerResults(
  workerResults: CoreFastWorkerResult[],
  ctx: PipelineContext,
): BatchedCorePipelineResult {
  const mergedAssignments = workerResults
    .flatMap((result) => result.assignments)
    .sort((left, right) => left.batchIndex - right.batchIndex);
  const carriers = finalizeBatchedCoreCarriers(
    mergedAssignments.flatMap((assignment) => assignment.carriers),
    ctx,
  );

  for (const assignment of mergedAssignments) {
    ctx.stageLog.push(...assignment.stageLog);
    mergeProviderUsage(ctx.providerUsage, assignment.providerUsage);
  }

  const integratedStageStats = shouldInlineFastLanePostProcessing(ctx)
    ? {
        sharedRepair: mergeSharedRepairStats(
          mergedAssignments.map((assignment) => assignment.integratedStageStats?.sharedRepair),
        ),
        normalization: mergeNormalizationStats(
          mergedAssignments.map((assignment) => assignment.integratedStageStats?.normalization),
        ),
      }
    : null;

  return {
    carriers,
    integratedStageStats,
  };
}

function prewarmPersistentCoreFastWorkerPool(): void {
  if (process.env.NODE_ENV === 'test' || !env.PIPELINE_FAST_WORKERS_ENABLED) {
    return;
  }

  const workerCount = Math.max(1, Math.min(env.PIPELINE_MAX_CONCURRENCY, 16));
  const workerUrl = new URL('../../scripts/pipeline/core-fast-worker-bootstrap.mjs', import.meta.url);
  setTimeout(() => {
    try {
      const workers = ensurePersistentCoreFastWorkerPool(workerCount, workerUrl);
      void Promise.all(workers.map((slot) => slot.ready))
        .then(() =>
          Promise.all(
            workers.map((slot) =>
              runPersistentCoreFastWorkerRequest(slot.worker, createCoreFastWorkerWarmupRequest()),
            ),
          ),
        )
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Persistent core fast worker prewarm failed: ${message}`);
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Persistent core fast worker prewarm failed: ${message}`);
    }
  }, 0);
}

prewarmPersistentCoreFastWorkerPool();

function createCoreFastWorkerWarmupRequest(): CoreFastWorkerRequest {
  return {
    assignments: [
      {
        batchIndex: 0,
        blocks: Array.from({ length: CORE_FAST_WORKER_WARMUP_REFS_PER_WORKER }, (_, index) => ({
          index,
          text: `Smith, J. ${index + 1}, Doe, A., & Patel, R. (2020). Worker warmup reference ${index + 1}. Journal of Tests, 1(1), 1-2.`,
          formatMeta: {
            sourceType: 'text',
            structure: 'semi_structured',
            detectedFormat: 'numbered_list',
            formatConfidence: 1,
          },
          splitMethod: 'numbered',
          splitConfidence: 1,
          isDoiResolved: false,
          flags: [],
        })),
      },
    ],
    outputStyle: 'apa7',
    pipelineOptions: {
      parseProfile: 'core_parse_fast',
      enrich: false,
      dedup: false,
      groupDuplicates: false,
      debug: false,
      llmFallback: false,
      authorityValidation: false,
      feedbackLoop: false,
      retentionPolicy: 'minimal',
      enableScoredDetection: false,
      enablePdfCleanup: false,
      pdfCleanupMode: 'off',
      enrichRecovery: false,
    },
    runtimeTuning: {
      profile: 'site_default',
      batchSize: env.PIPELINE_BATCH_SIZE,
      maxConcurrency: env.PIPELINE_MAX_CONCURRENCY,
      fastLaneMulticoreMinRefs: env.PIPELINE_FAST_MULTICORE_MIN_REFS,
    },
    tenantContext: {
      tier: 'free',
    },
  };
}

function finalizeBatchedCoreCarriers(
  carriers: ReferenceCarrier[],
  ctx: PipelineContext,
): ReferenceCarrier[] {
  const finalized = carriers.sort((left, right) => left.index - right.index);
  if (ctx.executionPolicy.parseProfile === 'core_parse_fast') {
    reconcileIdentifierAuthorGroups(finalized);
    for (const carrier of finalized) {
      carrier.parseOutcome = deriveParseOutcome(carrier);
    }
  }
  return finalized;
}

function createCoreFastWorkerAssignments(
  batches: RawBlock[][],
  workerCount: number,
): CoreFastWorkerAssignment[][] {
  const indexedBatches = batches.map((blocks, batchIndex) => ({
    batchIndex,
    blocks,
    blockCount: blocks.length,
  }));

  return createWeightedWorkerAssignments(
    indexedBatches,
    workerCount,
    (batch) => batch.blockCount,
  ).map((assignment) =>
    assignment.items
      .map((batch) => ({
        batchIndex: batch.batchIndex,
        blocks: batch.blocks,
      }))
      .sort((left, right) => left.batchIndex - right.batchIndex),
  );
}

async function awaitCoreFastWorkerResult(worker: Worker): Promise<CoreFastWorkerResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let resultPayload: CoreFastWorkerResult | null = null;

    const cleanup = (): void => {
      worker.removeAllListeners('message');
      worker.removeAllListeners('error');
      worker.removeAllListeners('exit');
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    worker.on('message', (message: {
      type: 'result';
      payload: CoreFastWorkerResult;
    } | {
      type: 'error';
      error: {
        message: string;
        stack?: string;
      };
    }) => {
      if (settled) {
        return;
      }
      if (message.type === 'error') {
        const error = new Error(message.error.message);
        if (message.error.stack) {
          error.stack = message.error.stack;
        }
        fail(error);
        return;
      }
      resultPayload = message.payload;
      settled = true;
      cleanup();
      resolve(resultPayload);
    });

    worker.once('error', (error) => {
      fail(new Error(`Core fast worker crashed: ${error.message}`));
    });

    worker.once('exit', (code) => {
      if (settled) {
        return;
      }
      if (code !== 0) {
        fail(new Error(`Core fast worker exited with code ${code}.`));
        return;
      }
      if (!resultPayload) {
        fail(new Error('Core fast worker exited without sending results.'));
        return;
      }
      settled = true;
      cleanup();
      resolve(resultPayload);
    });
  });
}

function mergeProviderUsage(target: PipelineContext['providerUsage'], next: PipelineContext['providerUsage']): void {
  target.crossrefCalls += next.crossrefCalls;
  target.openalexCalls += next.openalexCalls;
  target.semanticScholarCalls += next.semanticScholarCalls;
  target.llmTokensUsed += next.llmTokensUsed;
  target.llmRepairCalls += next.llmRepairCalls;
  target.cacheHits += next.cacheHits;
}

async function runDoiCorePipeline(
  carriers: ReferenceCarrier[],
  ctx: PipelineContext,
  deps: PipelineDependencies,
): Promise<ReferenceCarrier[]> {
  let next = await deps.coreStages.structuralFamilyRouter.run(carriers, ctx);
  next = await deps.coreStages.typeClassify.run(next, ctx);
  return next;
}

async function resolveDoiFastPath(
  detectedDois: string[],
  ctx: PipelineContext,
): Promise<ReferenceCarrier[]> {
  const truthIndex = await buildApprovedTruthDoiIndex();
  const carriers: ReferenceCarrier[] = [];

  for (const [index, doi] of detectedDois.entries()) {
    const rawBlock: RawBlock = {
      index,
      text: doi,
      formatMeta: {
        sourceType: 'doi_list',
        structure: 'structured',
        detectedFormat: 'doi_list',
        formatConfidence: 1,
      },
      splitMethod: 'doi_resolved',
      splitConfidence: 1,
      isDoiResolved: true,
      flags: [],
    };
    const carrier = buildReferenceCarrier(rawBlock, fastPathStyle(ctx.outputStyle), undefined, ctx.outputStyle);
    const normalizedDoi = normalizeDoi(doi) ?? doi.trim().toLowerCase();
    const truth = truthIndex.get(normalizedDoi) ?? null;
    const authorityHint = truth
      ? null
      : lookupAuthorityDoiHints(normalizedDoi);

    if (truth) {
      carrier.fields = buildResolvedFieldsFromApprovedTruth(normalizedDoi, truth);
      carrier.doiVerification = {
        status: 'verified',
        reasons: ['approved_truth_cache'],
      };
      const trustedType = normalizeReferenceType(truth.expectedType);
      if (trustedType) {
        carrier.structuralRouting = {
          type: trustedType,
          confidence: 1,
          source: 'approved_truth',
          reasonCodes: ['approved_truth_doi_match'],
        };
      }
    } else {
      carrier.fields = buildPartialDoiFields(normalizedDoi, authorityHint);
      carrier.doiVerification = {
        status: 'absent',
        reasons: authorityHint?.typeHint
          ? ['approved_truth_cache_miss', ...authorityHint.reasonCodes]
          : ['approved_truth_cache_miss'],
      };
      if (authorityHint?.typeHint) {
        carrier.structuralRouting = {
          type: authorityHint.typeHint,
          confidence: authorityHint.confidence,
          source: 'authority_pack',
          reasonCodes: [
            ...authorityHint.reasonCodes,
            `authority_pack_version:${authorityHint.packVersion}`,
          ],
        };
      }
      carrier.publicStatus = 'needs_review';
      carrier.parseOutcome = 'partial_parse_with_abstentions';
    }

    carrier.stageLog.push({
      stageId: 'phase1_doi_local_cache',
      contractVersion: 1,
      phaseId: 'ingestion',
      status: truth ? 'success' : 'warning',
      durationMs: 0,
      ...(truth ? {} : { code: ErrorCode.INGEST_DOI_RESOLUTION_FAILED }),
      message: truth
        ? `DOI core lane resolved from reviewed local cache (${truth.trustLevel}).`
        : authorityHint?.typeHint
          ? 'DOI core lane emitted a partial parse using the reviewed local authority pack.'
          : 'DOI core lane found no reviewed local cache entry and emitted a partial DOI-only parse.',
      ...(authorityHint
        ? {
            details: {
              authorityPackVersion: authorityHint.packVersion,
              authorityHintType: authorityHint.typeHint,
              authorityReasonCodes: authorityHint.reasonCodes,
            },
          }
        : {}),
    });

    carriers.push(carrier);
  }

  return carriers;
}

function buildPartialDoiFields(
  doi: string,
  authorityHint: AuthorityDoiHintMatch | null = null,
): ExtractedFields {
  const fields = createEmptyExtractedFields('phase1_doi_local_cache', 'ingestion');
  fields.doi = fieldOf(doi, 'doi_resolution', 'phase1_doi_local_cache', 1);
  fields.url = fieldOf(`https://doi.org/${doi}`, 'doi_resolution', 'phase1_doi_local_cache', 1);
  if (authorityHint?.conferenceTitleHint) {
    fields.conferenceTitle = fieldOf(
      authorityHint.conferenceTitleHint,
      'doi_resolution',
      'phase1_doi_local_cache',
      authorityHint.confidence,
    );
  }
  if (authorityHint?.publisherHint) {
    fields.publisher = fieldOf(
      authorityHint.publisherHint,
      'doi_resolution',
      'phase1_doi_local_cache',
      authorityHint.confidence,
    );
  }
  syncFieldUncertainty(fields);
  return fields;
}

function buildResolvedFieldsFromApprovedTruth(
  doi: string,
  truth: StoredApprovedTruth,
): ExtractedFields {
  const fields = createEmptyExtractedFields('phase1_doi_local_cache', 'admin_confirmed');
  fields.doi = fieldOf(doi, 'admin_confirmed', 'phase1_doi_local_cache', 1);
  if (!hasFieldValue(fields.url)) {
    fields.url = fieldOf(`https://doi.org/${doi}`, 'admin_confirmed', 'phase1_doi_local_cache', 1);
  }

  for (const [rawKey, value] of Object.entries(truth.expectedFields)) {
    if (value == null) {
      continue;
    }

    const key = mapApprovedTruthFieldKey(rawKey);
    if (!key) {
      continue;
    }

    if ((key === 'authors' || key === 'editors') && Array.isArray(value)) {
      const authors = value
        .flatMap((entry) => typeof entry === 'string' ? parseAuthorSegment(entry) : [])
        .filter((entry) => entry.family || entry.literal);
      if (authors.length > 0) {
        fields[key] = fieldOf(authors, 'admin_confirmed', 'phase1_doi_local_cache', 1) as ExtractedFields[typeof key];
      }
      continue;
    }

    if (key === 'year') {
      const year = typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.match(/\b((?:1[6-9]|20)\d{2})\b/)?.[1] ?? Number.NaN)
          : Number.NaN;
      if (Number.isFinite(year)) {
        fields.year = fieldOf(year, 'admin_confirmed', 'phase1_doi_local_cache', 1);
      }
      continue;
    }

    if (typeof value === 'string' && value.trim()) {
      setExtractedField(
        fields,
        key,
        fieldOf(value.trim(), 'admin_confirmed', 'phase1_doi_local_cache', 1) as ExtractedFields[typeof key],
      );
    }
  }

  syncFieldUncertainty(fields);
  return fields;
}

function mapApprovedTruthFieldKey(rawKey: string): keyof ExtractedFields | null {
  if (rawKey === 'journal/venue' || rawKey === 'venue') {
    return 'journal';
  }

  const allowedKeys = new Set<keyof ExtractedFields>([
    'authors',
    'title',
    'year',
    'journal',
    'volume',
    'issue',
    'pages',
    'doi',
    'pmid',
    'arxiv',
    'isbn',
    'issn',
    'handle',
    'patent',
    'publisher',
    'placeOfPublication',
    'url',
    'conferenceTitle',
    'bookTitle',
    'institution',
    'edition',
    'editors',
    'thesisType',
    'repository',
    'articleNumber',
    'accessedDate',
    'siteName',
    'database',
    'reportNumber',
  ]);

  return allowedKeys.has(rawKey as keyof ExtractedFields)
    ? rawKey as keyof ExtractedFields
    : null;
}

async function buildApprovedTruthDoiIndex(): Promise<Map<string, StoredApprovedTruth>> {
  const rows = await listApprovedTruth({ limit: 5000 });
  const index = new Map<string, StoredApprovedTruth>();
  const precedence: Record<StoredApprovedTruth['trustLevel'], number> = {
    draft: 0,
    reviewed: 1,
    gold: 2,
  };

  for (const rawRow of rows) {
    const row = withLegacyCertification(rawRow);
    if (effectiveRowStatus(row) !== 'reviewed') {
      continue;
    }

    const doi = extractApprovedTruthDoi(row);
    if (!doi) {
      continue;
    }

    const existing = index.get(doi);
    if (
      !existing
      || precedence[row.trustLevel] > precedence[existing.trustLevel]
    ) {
      index.set(doi, row);
    }
  }

  return index;
}

function extractApprovedTruthDoi(row: StoredApprovedTruth): string | null {
  const fieldDoi = row.expectedFields.doi;
  if (typeof fieldDoi === 'string') {
    return normalizeDoi(fieldDoi);
  }
  if (Array.isArray(fieldDoi)) {
    const firstString = fieldDoi.find((value) => typeof value === 'string');
    if (typeof firstString === 'string') {
      return normalizeDoi(firstString);
    }
  }

  const fieldUrl = row.expectedFields.url;
  if (typeof fieldUrl === 'string') {
    const urlDoi = normalizeDoi(fieldUrl);
    if (urlDoi) {
      return urlDoi;
    }
  }

  return normalizeDoi(row.rawText);
}

function normalizeReferenceType(value: string | null | undefined): ReferenceType | null {
  switch (value) {
    case 'article-journal':
    case 'book':
    case 'book-chapter':
    case 'thesis':
    case 'conference-paper':
    case 'webpage':
    case 'report':
    case 'patent':
    case 'dataset':
    case 'preprint':
    case 'unknown':
      return value;
    default:
      return null;
  }
}

function fastPathStyle(outputStyle: CitationStyle): StyleDetectionResult {
  const style = outputStyle !== 'auto' && outputStyle !== 'unknown' ? outputStyle : 'apa7';
  const noFixedStyle = outputStyle === 'auto' || outputStyle === 'unknown';
  return {
    primary: { style, confidence: 1 },
    secondary: null,
    family: styleFamilyForStyle(style),
    familyConfidence: 1,
    styleConfidence: 1,
    familyMarginToRunnerUp: 1,
    styleMarginToRunnerUp: 1,
    certaintyTier: 'high',
    familyCandidates: noFixedStyle ? [] : [{ family: styleFamilyForStyle(style), score: 1 }],
    styleCandidates: noFixedStyle ? [] : [{ style, score: 1 }],
    signals: [],
    conflictDampened: false,
    isUnknown: false,
    isMultiStyle: false,
  };
}

function toProcessedCitation(
  carrier: ReferenceCarrier,
  outputStyle: CitationStyle,
  includeCarrierDiagnostics: boolean,
): ProcessedCitation {
  const parseOutcome = deriveParseOutcome(carrier);
  return {
    id: carrier.id,
    index: carrier.index,
    raw: carrier.raw,
    outputLatencyMs: carrier.outputLatencyMs,
    ...(carrier.inputCleanup ? { inputCleanup: structuredClone(carrier.inputCleanup) } : {}),
    publicStatus: carrier.publicStatus,
    parseOutcome,
    status: carrier.status,
    ...(carrier.error ? { error: carrier.error } : {}),
    ...(carrier.partialData ? { partialData: carrier.partialData } : {}),
    referenceType: carrier.type.type,
    detectedStyleFamily: carrier.style.family,
    detectedStyle: carrier.style.primary.style,
    familyConfidence: carrier.style.familyConfidence,
    styleConfidence: carrier.style.styleConfidence,
    familyMarginToRunnerUp: carrier.style.familyMarginToRunnerUp,
    styleMarginToRunnerUp: carrier.style.styleMarginToRunnerUp,
    certaintyTier: carrier.style.certaintyTier,
    familyCandidates: structuredClone(carrier.style.familyCandidates),
    styleCandidates: structuredClone(carrier.style.styleCandidates),
    styleSignals: structuredClone(carrier.style.signals),
    conflictDampened: carrier.style.conflictDampened,
    effectiveStyle: carrier.styleResolution.effectiveStyle,
    effectiveStyleSource: carrier.styleResolution.effectiveStyleSource,
    inputStyleUncertain: carrier.styleResolution.inputStyleUncertain,
    rawDetectionConfidence: carrier.styleResolution.rawDetectionConfidence,
    effectiveDetectionConfidence: carrier.styleResolution.effectiveDetectionConfidence,
    outputStyle,
    styleResolution: structuredClone(carrier.styleResolution),
    doiVerification: structuredClone(carrier.doiVerification),
    fields: structuredClone(carrier.fields),
    rawScore: carrier.scoring.rawScore,
    displayScore: carrier.scoring.displayScore,
    scoreBreakdown: structuredClone(carrier.scoring.breakdown),
    healthReasons: [...carrier.health.reasons],
    healthBreakdown: structuredClone(carrier.health.breakdown),
    healthWarnings: structuredClone(carrier.health.warnings),
    authorityFlags: structuredClone(carrier.authority.flags),
    renderedText: carrier.rendered.text,
    renderedWarnings: [...carrier.rendered.warnings],
    ...(carrier.extractionMeta ? { extractionMeta: structuredClone(carrier.extractionMeta) } : {}),
    fieldMoveLedger: structuredClone(carrier.fieldMoveLedger),
    ...(carrier.doiFastPath ? { doiFastPath: true } : {}),
    ...(carrier.duplicateOf ? { duplicateOf: carrier.duplicateOf } : {}),
    ...(carrier.isDuplicateCandidate ? { isDuplicateCandidate: carrier.isDuplicateCandidate } : {}),
    ...(carrier.normalizedHash ? { normalizedHash: carrier.normalizedHash } : {}),
    ...(carrier.canonicalWorkKey ? { canonicalWorkKey: carrier.canonicalWorkKey } : {}),
    ...(carrier.nearDupClusterId ? { nearDupClusterId: carrier.nearDupClusterId } : {}),
    pipelineMajor: 3,
    stageLog: includeCarrierDiagnostics ? structuredClone(carrier.stageLog) : [],
  };
}

function shouldIncludeCarrierDiagnostics(ctx: PipelineContext): boolean {
  return ctx.options.debug || ctx.executionPolicy.debugMode === 'full';
}

function emitHealthTelemetry(carriers: ReferenceCarrier[]): void {
  if (process.env.NODE_ENV === 'test') return;
  const emitPerCitationTelemetry = process.env.BULKREFERENCES_HEALTH_TELEMETRY_DETAIL === 'true';
  const emitSummaryTelemetry = process.env.BULKREFERENCES_HEALTH_TELEMETRY_SUMMARY === 'true';

  if (!emitPerCitationTelemetry && !emitSummaryTelemetry) {
    return;
  }

  const summary = {
    baseStatusCounts: { ready: 0, needs_review: 0, needs_action: 0 },
    finalStatusCounts: { ready: 0, needs_review: 0, needs_action: 0 },
    demotionCounts: { authority: 0, render: 0, none: 0 },
    topMissingFields: new Map<string, number>(),
    topInvalidFields: new Map<string, number>(),
    topReasonCodes: new Map<string, number>(),
    rawScoreByStyle: new Map<string, { count: number; total: number }>(),
    rawScoreByType: new Map<string, { count: number; total: number }>(),
    rawScoreByStatus: new Map<string, { count: number; total: number }>(),
    componentScoresByStyle: new Map<string, { count: number; field: number; format: number; structural: number }>(),
    componentScoresByType: new Map<string, { count: number; field: number; format: number; structural: number }>(),
    formatScoringPathCounts: new Map<string, number>(),
  };

  for (const carrier of carriers) {
    summary.baseStatusCounts[carrier.health.baseStatus] += 1;
    summary.finalStatusCounts[carrier.publicStatus] += 1;
    summary.demotionCounts[carrier.health.demotedBy] += 1;
    accumulateAverage(summary.rawScoreByStyle, carrier.style.primary.style, carrier.scoring.rawScore);
    accumulateAverage(summary.rawScoreByType, carrier.type.type, carrier.scoring.rawScore);
    accumulateAverage(summary.rawScoreByStatus, carrier.publicStatus, carrier.scoring.rawScore);
    accumulateComponents(summary.componentScoresByStyle, carrier.style.primary.style, carrier.scoring.breakdown);
    accumulateComponents(summary.componentScoresByType, carrier.type.type, carrier.scoring.breakdown);
    summary.formatScoringPathCounts.set(
      carrier.scoring.breakdown.formatScoringPath,
      (summary.formatScoringPathCounts.get(carrier.scoring.breakdown.formatScoringPath) ?? 0) + 1,
    );

    const healthReasonCodes = buildHealthReasonCodes(carrier);
    for (const field of carrier.health.breakdown.missingMandatory) {
      summary.topMissingFields.set(field, (summary.topMissingFields.get(field) ?? 0) + 1);
    }
    for (const field of carrier.health.breakdown.invalidMandatory) {
      summary.topInvalidFields.set(field, (summary.topInvalidFields.get(field) ?? 0) + 1);
    }
    for (const code of healthReasonCodes) {
      summary.topReasonCodes.set(code, (summary.topReasonCodes.get(code) ?? 0) + 1);
    }

    if (emitPerCitationTelemetry) {
      console.info(JSON.stringify({
        event: 'citation_health',
        citationId: carrier.id,
        baseStatus: carrier.health.baseStatus,
        finalStatus: carrier.publicStatus,
        demotedBy: carrier.health.demotedBy,
        missingMandatory: carrier.health.breakdown.missingMandatory,
        invalidMandatory: carrier.health.breakdown.invalidMandatory,
        lowConfidenceMandatory: carrier.health.breakdown.lowConfidenceMandatory,
        healthWarningCodes: carrier.health.warnings.map((warning) => warning.code),
        healthReasonCodes,
        rawScore: carrier.scoring.rawScore,
        displayScore: carrier.scoring.displayScore,
        fieldEvidenceScore: carrier.scoring.breakdown.fieldEvidenceScore,
        formatCorrectnessScore: carrier.scoring.breakdown.formatCorrectnessScore,
        structuralIntegrityScore: carrier.scoring.breakdown.structuralIntegrityScore,
        formatScoringPath: carrier.scoring.breakdown.formatScoringPath,
        detectedStyle: carrier.style.primary.style,
        referenceType: carrier.type.type,
      }));
    }
  }

  console.info(JSON.stringify({
    event: 'citation_health_summary',
    baseStatusCounts: summary.baseStatusCounts,
    finalStatusCounts: summary.finalStatusCounts,
    demotionCounts: summary.demotionCounts,
    topMissingFields: toSortedCounts(summary.topMissingFields),
    topInvalidFields: toSortedCounts(summary.topInvalidFields),
    topReasonCodes: toSortedCounts(summary.topReasonCodes),
    authorityReadyToReview: carriers.filter((carrier) => carrier.health.baseStatus === 'ready' && carrier.publicStatus === 'needs_review' && carrier.health.demotedBy === 'authority').length,
    authorityReadyToAction: carriers.filter((carrier) => carrier.health.baseStatus === 'ready' && carrier.publicStatus === 'needs_action' && carrier.health.demotedBy === 'authority').length,
    renderDemotions: carriers.filter((carrier) => carrier.health.demotedBy === 'render').length,
    rawScoreByStyle: toAverageStats(summary.rawScoreByStyle),
    rawScoreByType: toAverageStats(summary.rawScoreByType),
    rawScoreByStatus: toAverageStats(summary.rawScoreByStatus),
    componentScoresByStyle: toComponentStats(summary.componentScoresByStyle),
    componentScoresByType: toComponentStats(summary.componentScoresByType),
    formatScoringPathCounts: toSortedCounts(summary.formatScoringPathCounts),
  }));
}

function buildHealthReasonCodes(carrier: ReferenceCarrier): string[] {
  return [
    ...carrier.health.breakdown.missingMandatory.map((field) => `missing_${field}`),
    ...carrier.health.breakdown.invalidMandatory.map((field) => `invalid_${field}`),
    ...carrier.health.breakdown.lowConfidenceMandatory.map((field) => `low_confidence_${field}`),
    ...carrier.health.warnings
      .filter((warning) => warning.severity !== 'info')
      .map((warning) => warning.code),
  ];
}

function toSortedCounts(values: Map<string, number>): Array<{ code: string; count: number }> {
  return [...values.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([code, count]) => ({ code, count }));
}

function accumulateAverage(
  bucket: Map<string, { count: number; total: number }>,
  key: string,
  value: number,
): void {
  const current = bucket.get(key) ?? { count: 0, total: 0 };
  current.count += 1;
  current.total += value;
  bucket.set(key, current);
}

function accumulateComponents(
  bucket: Map<string, { count: number; field: number; format: number; structural: number }>,
  key: string,
  breakdown: ReferenceCarrier['scoring']['breakdown'],
): void {
  const current = bucket.get(key) ?? { count: 0, field: 0, format: 0, structural: 0 };
  current.count += 1;
  current.field += breakdown.fieldEvidenceScore;
  current.format += breakdown.formatCorrectnessScore;
  current.structural += breakdown.structuralIntegrityScore;
  bucket.set(key, current);
}

function toAverageStats(values: Map<string, { count: number; total: number }>): Array<{ code: string; count: number; average: number }> {
  return [...values.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .map(([code, entry]) => ({
      code,
      count: entry.count,
      average: entry.count === 0 ? 0 : Math.round((entry.total / entry.count) * 100) / 100,
    }));
}

function toComponentStats(
  values: Map<string, { count: number; field: number; format: number; structural: number }>,
): Array<{ code: string; count: number; field: number; format: number; structural: number }> {
  return [...values.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .map(([code, entry]) => ({
      code,
      count: entry.count,
      field: entry.count === 0 ? 0 : Math.round((entry.field / entry.count) * 1000) / 1000,
      format: entry.count === 0 ? 0 : Math.round((entry.format / entry.count) * 1000) / 1000,
      structural: entry.count === 0 ? 0 : Math.round((entry.structural / entry.count) * 1000) / 1000,
    }));
}

function buildSummary(citations: ProcessedCitation[]): ConvertResponse['summary'] {
  const total = citations.length;
  const ready = citations.filter((citation) => citation.publicStatus === 'ready').length;
  const needsReview = citations.filter((citation) => citation.publicStatus === 'needs_review').length;
  const needsAction = citations.filter((citation) => citation.publicStatus === 'needs_action').length;
  const failed = citations.filter((citation) => citation.status === 'error').length;
  const parseQuality = total === 0
    ? 0
    : Math.round(citations.reduce((sum, citation) => sum + citation.rawScore, 0) / total);

  return {
    total,
    ready,
    needsReview,
    needsAction,
    failed,
    parseQuality,
  };
}

function buildDuplicateGroups(
  carriers: ReferenceCarrier[],
): ConvertResponse['duplicateGroups'] {
  const groups = new Map<string, ReferenceCarrier[]>();

  for (const carrier of carriers) {
    if (!carrier.isDuplicateCandidate) continue;
    const groupId = carrier.duplicateGroupId ?? carrier.id;
    const current = groups.get(groupId) ?? [];
    current.push(carrier);
    groups.set(groupId, current);
  }

  return [...groups.entries()].map(([groupId, members]) => {
    const primary = members.find((carrier) => !carrier.duplicateOf) ?? members[0]!;
    const duplicate = members.find((carrier) => carrier.duplicateOf);
    const method = duplicate?.duplicateReason ?? 'minhash_lsh';
    const jaccardScore = method === 'doi_exact'
      ? 1
      : method === 'normalized_hash'
        ? 1
        : method === 'canonical_work_key'
          ? 0.98
          : 0.95;

    return {
      groupId,
      primaryId: primary.id,
      memberIds: members.map((member) => member.id),
      method,
      jaccardScore,
    };
  });
}

function resolveOutputStyle(
  requested: CitationStyle,
  detected: CitationStyle,
  family: ReferenceCarrier['style']['family'],
): CitationStyle {
  if (requested !== 'auto' && requested !== 'unknown') return requested;
  return detected !== 'auto' && detected !== 'unknown' ? detected : representativeStyleForFamily(family);
}

function buildPresplitCountAudit(blockCount: number): CountAudit {
  return {
    inputEstimate: blockCount,
    aggregatedCount: blockCount,
    splitCount: blockCount,
    delta: 0,
    needsActionCount: 0,
    droppedCount: 0,
  };
}
