import { env } from '../config.js';
import type {
  PipelineRuntimeProfile,
  PipelineRuntimeTuning,
} from '../engine/types/pipeline.js';

export type PipelineRuntimeProfileVariant = 'direct' | 'parallel';

export interface PipelineRuntimeProfileResolution {
  profile: PipelineRuntimeProfile;
  runtimeTuning: PipelineRuntimeTuning;
  warmupRefs: number;
  multicoreThreshold: number | null;
}

export interface ResolvePipelineRuntimeTuningInput {
  runtimeProfile?: PipelineRuntimeProfile;
  runtimeTuning?: Partial<PipelineRuntimeTuning>;
}

export function resolvePipelineRuntimeProfile(
  profile: PipelineRuntimeProfile,
  variant: PipelineRuntimeProfileVariant = 'direct',
): PipelineRuntimeProfileResolution {
  switch (profile) {
    case 'benchmark_5600h':
      return {
        profile,
        runtimeTuning: {
          profile,
          batchSize: variant === 'parallel' ? 256 : 192,
          maxConcurrency: variant === 'parallel' ? 11 : 7,
          fastLaneMulticoreMinRefs: 256,
        },
        warmupRefs: variant === 'parallel' ? 256 : 192,
        multicoreThreshold: 256,
      };
    case 'server_16c':
      return {
        profile,
        runtimeTuning: {
          profile,
          batchSize: 160,
          maxConcurrency: 15,
          fastLaneMulticoreMinRefs: 512,
        },
        warmupRefs: 320,
        multicoreThreshold: 512,
      };
    case 'site_default':
    default:
      return {
        profile: 'site_default',
        runtimeTuning: {
          profile: 'site_default',
          batchSize: env.PIPELINE_BATCH_SIZE,
          maxConcurrency: env.PIPELINE_MAX_CONCURRENCY,
          fastLaneMulticoreMinRefs: env.PIPELINE_FAST_MULTICORE_MIN_REFS,
        },
        warmupRefs: 0,
        multicoreThreshold: env.PIPELINE_FAST_MULTICORE_MIN_REFS,
      };
  }
}

export function resolvePipelineRuntimeTuning(
  input: ResolvePipelineRuntimeTuningInput = {},
): PipelineRuntimeTuning {
  const base = resolvePipelineRuntimeProfile(input.runtimeProfile ?? 'site_default').runtimeTuning;
  const fastLaneMulticoreMinRefs = input.runtimeTuning?.fastLaneMulticoreMinRefs
    ?? base.fastLaneMulticoreMinRefs;
  const profile = input.runtimeTuning?.profile ?? base.profile;

  return {
    batchSize: input.runtimeTuning?.batchSize ?? base.batchSize,
    maxConcurrency: input.runtimeTuning?.maxConcurrency ?? base.maxConcurrency,
    ...(profile ? { profile } : {}),
    ...(fastLaneMulticoreMinRefs == null ? {} : { fastLaneMulticoreMinRefs }),
  };
}

export function resolveSingleWorkerRuntimeTuning(
  runtimeTuning: PipelineRuntimeTuning | null,
): PipelineRuntimeTuning | null {
  if (!runtimeTuning) {
    return null;
  }

  return {
    ...runtimeTuning,
    maxConcurrency: 1,
  };
}
