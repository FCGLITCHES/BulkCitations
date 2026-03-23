import { randomUUID } from 'node:crypto';
import type { V2ConversionRequest, V2StageId, V2StageTiming } from '@shared/schema';
import { createDefaultAdapters } from './adapters.js';
import { buildStageConfig, V2_STAGE_ORDER } from './config.js';
import type { V2AdapterBundle, V2PipelineContext, V2Stage } from './contracts.js';
import { createLlmBudget, getOpenAiExtractTimeoutMs, getOpenAiSplitTimeoutMs } from './llmConfig.js';
import { createDedupStage } from './stages/dedup.js';
import { createDetectStage } from './stages/detect.js';
import { createEnrichStage } from './stages/enrich.js';
import { createExtractStage } from './stages/extract.js';
import { createGroupStage } from './stages/group.js';
import { createIngestStage } from './stages/ingest.js';
import { createNormalizeStage } from './stages/normalize.js';
import { createRenderStage } from './stages/render.js';
import { createRespondStage } from './stages/respond.js';
import { createScoreStage } from './stages/score.js';
import { createSplitStage } from './stages/split.js';
import { createTruthStage } from './stages/truth.js';
import { createValidateStage } from './stages/validate.js';
import { getStageIsolationConcurrency, getStageIsolationTimeoutMs } from './stageIsolation.js';
import { createStageDiagnostic, nowIso, runWithTimeout } from './utils.js';

function createStageMap(adapters: V2AdapterBundle): Record<V2StageId, V2Stage> {
  return {
    ingest: createIngestStage(),
    split: createSplitStage(),
    extract: createExtractStage(adapters.extractor),
    validate: createValidateStage(),
    truth: createTruthStage(),
    dedup: createDedupStage(),
    enrich: createEnrichStage(adapters.resolutionProvider, adapters.cache, adapters.extractor),
    group: createGroupStage(),
    detect: createDetectStage(adapters.classifier),
    score: createScoreStage(),
    normalize: createNormalizeStage(),
    render: createRenderStage(),
    respond: createRespondStage(),
  };
}

function stageWorkUnits(context: V2PipelineContext, stageId: V2StageId): number {
  const estimatedCount = context.inputProfile?.estimatedCount ?? 0;
  const citationCount = context.citations.length;
  const rawItemCount = context.rawItems.length;

  switch (stageId) {
    case 'split':
      return Math.max(rawItemCount, estimatedCount, 1);
    case 'ingest':
      return Math.max(rawItemCount, 1);
    case 'dedup':
      return Math.max(citationCount, estimatedCount, 1);
    case 'respond':
      return Math.max(citationCount, 1);
    default:
      return Math.max(citationCount, rawItemCount, estimatedCount, 1);
  }
}

function resolveStageTimeoutMs(
  context: V2PipelineContext,
  stageId: V2StageId,
  baseTimeoutMs: number,
): number {
  const llmEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_LLM_EXTRACTOR ?? '1') && Boolean(process.env.OPENAI_API_KEY);

  if (stageId === 'split') {
    const workUnits = stageWorkUnits(context, stageId);
    const concurrency = getStageIsolationConcurrency(stageId, 1);
    const batches = Math.ceil(workUnits / Math.max(concurrency, 1));
    const itemTimeoutMs = Math.max(baseTimeoutMs, llmEnabled ? getOpenAiSplitTimeoutMs() + 1_500 : baseTimeoutMs);
    return Math.max(
      baseTimeoutMs,
      itemTimeoutMs,
      (batches * itemTimeoutMs) + 1_500,
    );
  }

  if (stageId === 'enrich') {
    const citationCount = Math.max(
      context.citations.length,
      context.rawItems.length,
      context.inputProfile?.estimatedCount ?? 0,
      1,
    );
    const explicitTimeoutMs = Number.parseInt(process.env.V2_ENRICH_TIMEOUT_MS ?? '', 10);
    if (Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
      return Math.max(baseTimeoutMs, explicitTimeoutMs);
    }
    const configuredConcurrency = Number.parseInt(
      process.env.V2_ENRICH_CONCURRENCY ?? '3',
      10,
    );
    const concurrency = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
      ? configuredConcurrency
      : 3;
    const batches = Math.ceil(citationCount / Math.max(concurrency, 1));
    const perCitationBudgetMs = 1_800;
    const perBatchBudgetMs = 7_500;
    const overheadMs = 60_000;

    return Math.max(
      baseTimeoutMs,
      (citationCount * perCitationBudgetMs) + overheadMs,
      (batches * perBatchBudgetMs) + overheadMs,
    );
  }

  if (['detect', 'normalize', 'validate', 'truth', 'dedup', 'score', 'render'].includes(stageId)) {
    const workUnits = stageWorkUnits(context, stageId);
    const concurrency = getStageIsolationConcurrency(stageId);
    const itemTimeoutMs = getStageIsolationTimeoutMs(stageId, baseTimeoutMs);
    const batches = Math.ceil(workUnits / Math.max(concurrency, 1));
    const overheadMs = stageId === 'dedup' ? 4_000 : 2_000;

    return Math.max(
      baseTimeoutMs,
      (batches * itemTimeoutMs) + overheadMs,
    );
  }

  if (stageId !== 'extract') return baseTimeoutMs;

  const citationCount = Math.max(
    context.citations.length,
    context.rawItems.length,
    context.inputProfile?.estimatedCount ?? 0,
    1,
  );
  const grobidEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_GROBID_EXTRACTOR ?? '');
  const defaultConcurrency = grobidEnabled ? 1 : 6;
  const configuredConcurrency = Number.parseInt(
    process.env.V2_EXTRACT_CONCURRENCY ?? String(defaultConcurrency),
    10,
  );
  const concurrency = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : defaultConcurrency;
  const batches = Math.ceil(citationCount / Math.max(concurrency, 1));
  const perBatchBudgetMs = grobidEnabled ? 3_500 : 1_200;
  const overheadMs = grobidEnabled ? 4_000 : 2_000;
  const calculatedTimeoutMs = (batches * perBatchBudgetMs) + overheadMs;
  const llmCalculatedTimeoutMs = llmEnabled
    ? (batches * getOpenAiExtractTimeoutMs()) + 2_000
    : 0;

  return Math.max(baseTimeoutMs, calculatedTimeoutMs, llmCalculatedTimeoutMs);
}

function createStageTiming(
  stageId: V2StageId,
  status: V2StageTiming['status'],
  durationMs: number,
  workUnits: number,
  timeoutMs?: number,
): V2StageTiming {
  return {
    stageId,
    status,
    durationMs,
    workUnits,
    timeoutMs,
  };
}

export async function processV2Conversion(
  request: V2ConversionRequest,
  options?: {
    adapters?: V2AdapterBundle;
    executionMode?: 'sync' | 'async';
  },
) {
  const adapters = options?.adapters ?? createDefaultAdapters();
  const stageConfig = buildStageConfig();
  const stageMap = createStageMap(adapters);

  let context: V2PipelineContext = {
    request,
    jobId: randomUUID(),
    receivedAt: nowIso(),
    startedAtMs: Date.now(),
    executionMode: options?.executionMode ?? 'sync',
    debugEnabled: request.debug || process.env.V2_DEBUG_PIPELINE === '1',
    rawItems: [],
    inputProfile: undefined,
    citations: [],
    duplicates: [],
    groups: {},
    pipelineLog: [],
    stageTimings: [],
    stagesRun: [],
    fallbacksUsed: [],
    partialResult: false,
    partialReasons: [],
    jobDebug: {},
    workingChunkByCitationId: {},
    splitArtifactsByCitationId: {},
    llmBudget: createLlmBudget(options?.executionMode ?? 'sync'),
    stageConfig,
  };

  for (const stageId of V2_STAGE_ORDER) {
    const config = stageConfig[stageId];
    const workUnits = config.enabled ? stageWorkUnits(context, stageId) : 0;

    if (!config.enabled) {
      context = {
        ...context,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(stageId, 'skipped', `Stage '${stageId}' is disabled in the active v2 registry.`),
        ],
        stageTimings: [
          ...context.stageTimings,
          createStageTiming(stageId, 'skipped', 0, workUnits, 0),
        ],
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            [stageId]: {
              ...(context.jobDebug[stageId] ?? {}),
              status: 'skipped',
              durationMs: 0,
              workUnits,
              timeoutMs: 0,
            },
          }
          : context.jobDebug,
      };
      continue;
    }

    const stage = stageMap[stageId];
    const stageTimeoutMs = resolveStageTimeoutMs(context, stageId, config.timeoutMs);
    const stageStartedAtMs = Date.now();
    context = {
      ...context,
      stagesRun: [...context.stagesRun, stageId],
    };
    try {
      const nextContext = await runWithTimeout(
        `Stage '${stageId}'`,
        stage.run(context),
        stageTimeoutMs,
      );
      const durationMs = Date.now() - stageStartedAtMs;
      context = {
        ...nextContext,
        stageTimings: [
          ...nextContext.stageTimings,
          createStageTiming(stageId, 'success', durationMs, workUnits, stageTimeoutMs),
        ],
        jobDebug: nextContext.debugEnabled
          ? {
            ...nextContext.jobDebug,
            [stageId]: {
              ...(nextContext.jobDebug[stageId] ?? {}),
              status: nextContext.jobDebug[stageId]?.status ?? 'success',
              durationMs,
              workUnits,
              timeoutMs: stageTimeoutMs,
            },
          }
          : nextContext.jobDebug,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - stageStartedAtMs;
      context = {
        ...context,
        partialResult: true,
        fallbacksUsed: [...context.fallbacksUsed, `${stageId}:stage-error`],
        partialReasons: [...context.partialReasons, `${stageId}:stage-error`],
        stageTimings: [
          ...context.stageTimings,
          createStageTiming(stageId, 'error', durationMs, workUnits, stageTimeoutMs),
        ],
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(stageId, 'error', message),
        ],
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            [stageId]: {
              ...(context.jobDebug[stageId] ?? {}),
              status: 'error',
              message,
              durationMs,
              workUnits,
              timeoutMs: stageTimeoutMs,
            },
          }
          : context.jobDebug,
        citations: context.citations.map((citation) => ({
          ...citation,
          stageLog: [...citation.stageLog, createStageDiagnostic(stageId, 'error', message)],
        })),
      };

      if (config.fallback === 'fail') {
        throw error;
      }
    }
  }

  if (!context.response) {
    throw new Error('v2 pipeline completed without producing a response envelope.');
  }

  const stageTimings = [...context.stageTimings];
  const slowestStages = [...stageTimings].sort((left, right) => right.durationMs - left.durationMs);
  const durationMs = Date.now() - context.startedAtMs;

  return {
    response: {
      ...context.response,
      processingPath: {
        ...context.response.processingPath,
        durationMs,
        stageTimings,
        slowestStages,
      },
      pipeline_log: context.pipelineLog,
    },
    adapters,
  };
}
