import type { PipelineRuntimeTuning } from '../engine/types/pipeline.js';
import type { BenchmarkHardwareProfile, BenchmarkVariant } from './types.js';
import { resolvePipelineRuntimeProfile } from '../pipeline/runtimeProfiles.js';

export interface BenchmarkHardwareProfileResolution {
  profile: BenchmarkHardwareProfile;
  runtimeTuning: PipelineRuntimeTuning | null;
  warmupRefs: number;
  multicoreThreshold: number | null;
}

export function resolveBenchmarkHardwareProfile(
  profile: BenchmarkHardwareProfile,
  benchmarkVariant: BenchmarkVariant = 'grobid_compare',
): BenchmarkHardwareProfileResolution {
  const runtimeVariant = benchmarkVariant === 'parallel' ? 'parallel' : 'direct';

  switch (profile) {
    case 'dev_default':
      return {
        profile,
        runtimeTuning: {
          profile: 'site_default',
          batchSize: 96,
          maxConcurrency: 3,
          fastLaneMulticoreMinRefs: 256,
        },
        warmupRefs: 0,
        multicoreThreshold: null,
      };
    case 'benchmark_5600h':
      return resolveNamedBenchmarkHardwareProfile(profile, runtimeVariant);
    case 'server_16c':
      return resolveNamedBenchmarkHardwareProfile(profile, runtimeVariant);
    case 'default':
    default:
      return {
        profile: 'default',
        runtimeTuning: null,
        warmupRefs: 0,
        multicoreThreshold: null,
      };
  }
}

function resolveNamedBenchmarkHardwareProfile(
  profile: Extract<BenchmarkHardwareProfile, 'benchmark_5600h' | 'server_16c'>,
  variant: 'direct' | 'parallel',
): BenchmarkHardwareProfileResolution {
  const resolved = resolvePipelineRuntimeProfile(profile, variant);
  return {
    profile,
    runtimeTuning: resolved.runtimeTuning,
    warmupRefs: resolved.warmupRefs,
    multicoreThreshold: resolved.multicoreThreshold,
  };
}
