import { randomUUID } from 'node:crypto';
import type { StageDiagnostic, V2ConversionRequest, V2StageTiming, V3StageId } from '@shared/schema';
import { buildStageConfig } from '../v2/config.js';
import type { V2AdapterBundle, V2PipelineContext } from '../v2/contracts.js';
import { createDefaultAdapters } from '../v2/index.js';
import { createLlmBudget } from '../v2/llmConfig.js';
import { createStageDiagnostic, nowIso } from '../v2/utils.js';
import { V3_CONTRACT_VERSIONS, V3_STAGE_ORDER, upgradeV2ResponseToV3 } from './index.js';
import type { V3PipelineContext, V3Stage } from './contracts.js';
import { createV3AuthorityValidateAndAdjustStage } from './stages/authorityValidateAndAdjust.js';
import { createV3BaseScoreStage } from './stages/baseScore.js';
import { createV3ClassifyTypeStage } from './stages/classifyType.js';
import { createV3DedupStage } from './stages/dedup.js';
import { createV3DetectStyleStage } from './stages/detectStyle.js';
import { createV3EnrichStage } from './stages/enrich.js';
import { createV3ExtractFieldsStage } from './stages/extractFields.js';
import { createV3IngestStage } from './stages/ingest.js';
import { createV3LlmRepairStage } from './stages/llmRepair.js';
import { createV3NormalizeStage } from './stages/normalize.js';
import { createV3ParseAuthorsStage } from './stages/parseAuthors.js';
import { createV3RenderStage } from './stages/render.js';
import { createV3SplitStage } from './stages/split.js';

function createInitialV2Context(
  request: V2ConversionRequest,
  adapters: V2AdapterBundle,
  executionMode: 'sync' | 'async',
): V2PipelineContext {
  return {
    request,
    jobId: randomUUID(),
    receivedAt: nowIso(),
    startedAtMs: Date.now(),
    executionMode,
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
    llmBudget: createLlmBudget(executionMode),
    stageConfig: buildStageConfig(),
  };
}

function createStageMap(): Record<V3StageId, V3Stage> {
  return {
    ingest: createV3IngestStage(),
    split: createV3SplitStage(),
    detect_style: createV3DetectStyleStage(),
    extract_fields: createV3ExtractFieldsStage(),
    parse_authors: createV3ParseAuthorsStage(),
    classify_type: createV3ClassifyTypeStage(),
    normalize: createV3NormalizeStage(),
    enrich: createV3EnrichStage(),
    llm_repair: createV3LlmRepairStage(),
    dedup: createV3DedupStage(),
    base_score: createV3BaseScoreStage(),
    authority_validate_and_adjust: createV3AuthorityValidateAndAdjustStage(),
    render: createV3RenderStage(),
  };
}

function pushStageTiming(
  timings: V2StageTiming[],
  stageId: V3StageId,
  status: V2StageTiming['status'],
  durationMs: number,
): V2StageTiming[] {
  return [
    ...timings,
    {
      stageId,
      status,
      durationMs,
      workUnits: 1,
      timeoutMs: 0,
    },
  ];
}

function pushPipelineDiagnostic(
  diagnostics: StageDiagnostic[],
  stageId: V3StageId,
  status: 'success' | 'warning' | 'error',
  message: string,
  durationMs: number,
): StageDiagnostic[] {
  return [
    ...diagnostics,
    createStageDiagnostic(stageId, status, message, undefined, durationMs),
  ];
}

export async function processV3Conversion(
  request: V2ConversionRequest,
  options?: {
    adapters?: V2AdapterBundle;
    executionMode?: 'sync' | 'async';
  },
) {
  const adapters = options?.adapters ?? createDefaultAdapters();
  const executionMode = options?.executionMode ?? 'sync';
  const stageMap = createStageMap();

  let context: V3PipelineContext = {
    request,
    executionMode,
    debugEnabled: request.debug || process.env.V2_DEBUG_PIPELINE === '1',
    receivedAt: nowIso(),
    startedAtMs: Date.now(),
    documentStyleHint: null,
    adapters,
    v2: createInitialV2Context(request, adapters, executionMode),
    stagesRun: [],
    stageTimings: [],
    pipelineLog: [],
    fieldLocksByCitationId: {},
  };

  for (const stageId of V3_STAGE_ORDER) {
    const stageStartedAt = Date.now();
    context = {
      ...context,
      stagesRun: [...context.stagesRun, stageId],
    };

    try {
      context = await stageMap[stageId].run(context);
      const durationMs = Date.now() - stageStartedAt;
      context = {
        ...context,
        stageTimings: pushStageTiming(context.stageTimings, stageId, 'success', durationMs),
        pipelineLog: pushPipelineDiagnostic(
          context.pipelineLog,
          stageId,
          'success',
          `Completed v3 stage '${stageId}'.`,
          durationMs,
        ),
      };
    } catch (error) {
      const durationMs = Date.now() - stageStartedAt;
      context = {
        ...context,
        stageTimings: pushStageTiming(context.stageTimings, stageId, 'error', durationMs),
        pipelineLog: pushPipelineDiagnostic(
          context.pipelineLog,
          stageId,
          'error',
          error instanceof Error ? error.message : String(error),
          durationMs,
        ),
      };
      throw error;
    }
  }

  if (!context.v2.response) {
    throw new Error('v3 pipeline completed without producing a response envelope.');
  }

  const response = upgradeV2ResponseToV3(context.v2.response, request, {
    stagesRun: context.stagesRun,
    stageTimings: context.stageTimings,
    pipelineLog: context.pipelineLog,
    durationMs: Date.now() - context.startedAtMs,
    fallbacksUsed: context.v2.fallbacksUsed,
    partialResult: context.v2.partialResult,
    partialReasons: context.v2.partialReasons,
    contractVersions: V3_CONTRACT_VERSIONS,
  });

  return {
    response,
    adapters,
  };
}
