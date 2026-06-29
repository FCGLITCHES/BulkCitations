import { randomUUID } from 'node:crypto';
import { env } from '../config.js';
import type { CitationStyle } from '../engine/types/citation.js';
import type {
  PipelineContext,
  PipelineOptions,
  PipelineRuntimeProfile,
  PipelineRuntimeTuning,
  TenantContext,
} from '../engine/types/pipeline.js';
import { normalizePipelineOptions } from './executionPolicy.js';
import { createStageBudgets } from './performance.js';
import { resolvePipelineRuntimeTuning } from './runtimeProfiles.js';

export interface CreatePipelineContextInput {
  jobId?: string;
  outputStyle?: CitationStyle;
  options?: Partial<PipelineOptions>;
  runtimeProfile?: PipelineRuntimeProfile;
  runtimeTuning?: Partial<PipelineRuntimeTuning>;
  tenantContext?: Partial<TenantContext>;
  detectionMeta?: PipelineContext['detectionMeta'];
  abortSignal?: AbortSignal;
}

export function createPipelineContext(input: CreatePipelineContextInput = {}): PipelineContext {
  const normalized = normalizePipelineOptions({
    ...input.options,
    enableScoredDetection: input.options?.enableScoredDetection ?? env.FEATURE_SCORED_DETECTOR,
  });
  const runtimeTuning = resolvePipelineRuntimeTuning({
    ...(input.runtimeProfile ? { runtimeProfile: input.runtimeProfile } : {}),
    ...(input.runtimeTuning ? { runtimeTuning: input.runtimeTuning } : {}),
  });
  const executionPolicy = {
    ...normalized.executionPolicy,
    ...(runtimeTuning.profile === 'site_default'
      && normalized.executionPolicy.parseProfile === 'core_parse_full'
      ? {
          styleDetectionMl: 'off' as const,
          authorDisambiguationMl: 'off' as const,
          typeClassificationMl: 'off' as const,
        }
      : {}),
  };

  return {
    jobId: input.jobId ?? randomUUID(),
    pipelineMajor: 3,
    outputStyle: input.outputStyle ?? 'apa7',
    options: normalized.options,
    executionPolicy,
    runtimeTuning,
    stageLog: [],
    startedAt: Date.now(),
    performanceBudgets: createStageBudgets(),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    tenantContext: {
      tier: 'free',
      ...(input.tenantContext ?? {}),
    },
    providerUsage: {
      crossrefCalls: 0,
      openalexCalls: 0,
      semanticScholarCalls: 0,
      llmTokensUsed: 0,
      llmRepairCalls: 0,
      cacheHits: 0,
    },
    ...(input.detectionMeta ? { detectionMeta: structuredClone(input.detectionMeta) } : {}),
  };
}
