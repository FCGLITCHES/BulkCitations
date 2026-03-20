import { randomUUID } from 'node:crypto';
import type { V2ConversionRequest, V2StageId } from '@shared/schema';
import { createDefaultAdapters } from './adapters.js';
import { buildStageConfig, V2_STAGE_ORDER } from './config.js';
import type { V2AdapterBundle, V2PipelineContext, V2Stage } from './contracts.js';
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
import { createValidateStage } from './stages/validate.js';
import { createStageDiagnostic, nowIso } from './utils.js';

function createStageMap(adapters: V2AdapterBundle): Record<V2StageId, V2Stage> {
  return {
    ingest: createIngestStage(),
    split: createSplitStage(),
    extract: createExtractStage(adapters.extractor),
    validate: createValidateStage(),
    dedup: createDedupStage(),
    enrich: createEnrichStage(adapters.authorityLookup, adapters.cache),
    group: createGroupStage(),
    detect: createDetectStage(adapters.classifier),
    score: createScoreStage(),
    normalize: createNormalizeStage(),
    render: createRenderStage(),
    respond: createRespondStage(),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stageId: V2StageId): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Stage '${stageId}' timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
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
    stagesRun: [],
    fallbacksUsed: [],
    partialResult: false,
    partialReasons: [],
    jobDebug: {},
    stageConfig,
  };

  for (const stageId of V2_STAGE_ORDER) {
    const config = stageConfig[stageId];
    if (!config.enabled) {
      context = {
        ...context,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(stageId, 'skipped', `Stage '${stageId}' is disabled in the active v2 registry.`),
        ],
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            [stageId]: { status: 'skipped' },
          }
          : context.jobDebug,
      };
      continue;
    }

    const stage = stageMap[stageId];
    context = {
      ...context,
      stagesRun: [...context.stagesRun, stageId],
    };
    try {
      context = await withTimeout(stage.run(context), config.timeoutMs, stageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context = {
        ...context,
        partialResult: true,
        fallbacksUsed: [...context.fallbacksUsed, `${stageId}:stage-error`],
        partialReasons: [...context.partialReasons, `${stageId}:stage-error`],
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(stageId, 'error', message),
        ],
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            [stageId]: {
              status: 'error',
              message,
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

  return {
    response: {
      ...context.response,
      pipeline_log: context.pipelineLog,
    },
    adapters,
  };
}
