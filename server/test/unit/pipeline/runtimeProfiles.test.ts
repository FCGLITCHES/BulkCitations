import { describe, expect, it } from 'vitest';

import { env } from '../../../src/config.js';
import { createPipelineContext } from '../../../src/pipeline/context.js';
import {
  resolvePipelineRuntimeProfile,
  resolvePipelineRuntimeTuning,
  resolveSingleWorkerRuntimeTuning,
} from '../../../src/pipeline/runtimeProfiles.js';

describe('pipeline runtime profiles', () => {
  it('resolves the site default profile from the live environment defaults', () => {
    expect(resolvePipelineRuntimeProfile('site_default')).toEqual({
      profile: 'site_default',
      runtimeTuning: {
        profile: 'site_default',
        batchSize: env.PIPELINE_BATCH_SIZE,
        maxConcurrency: env.PIPELINE_MAX_CONCURRENCY,
        fastLaneMulticoreMinRefs: env.PIPELINE_FAST_MULTICORE_MIN_REFS,
      },
      warmupRefs: 0,
      multicoreThreshold: env.PIPELINE_FAST_MULTICORE_MIN_REFS,
    });
  });

  it('resolves named benchmark and server runtime profiles deterministically', () => {
    expect(resolvePipelineRuntimeProfile('benchmark_5600h')).toEqual({
      profile: 'benchmark_5600h',
      runtimeTuning: {
        profile: 'benchmark_5600h',
        batchSize: 192,
        maxConcurrency: 7,
        fastLaneMulticoreMinRefs: 256,
      },
      warmupRefs: 192,
      multicoreThreshold: 256,
    });
    expect(resolvePipelineRuntimeProfile('benchmark_5600h', 'parallel')).toEqual({
      profile: 'benchmark_5600h',
      runtimeTuning: {
        profile: 'benchmark_5600h',
        batchSize: 256,
        maxConcurrency: 11,
        fastLaneMulticoreMinRefs: 256,
      },
      warmupRefs: 256,
      multicoreThreshold: 256,
    });
    expect(resolvePipelineRuntimeProfile('server_16c')).toEqual({
      profile: 'server_16c',
      runtimeTuning: {
        profile: 'server_16c',
        batchSize: 160,
        maxConcurrency: 15,
        fastLaneMulticoreMinRefs: 512,
      },
      warmupRefs: 320,
      multicoreThreshold: 512,
    });
  });

  it('merges explicit tuning overrides on top of a named runtime profile', () => {
    expect(resolvePipelineRuntimeTuning({
      runtimeProfile: 'benchmark_5600h',
      runtimeTuning: {
        maxConcurrency: 6,
      },
    })).toEqual({
      profile: 'benchmark_5600h',
      batchSize: 192,
      maxConcurrency: 6,
      fastLaneMulticoreMinRefs: 256,
    });
  });

  it('forces nested worker runtime concurrency to one without dropping profile or thresholds', () => {
    expect(resolveSingleWorkerRuntimeTuning(null)).toBeNull();
    expect(resolveSingleWorkerRuntimeTuning({
      profile: 'benchmark_5600h',
      batchSize: 256,
      maxConcurrency: 11,
      fastLaneMulticoreMinRefs: 256,
    })).toEqual({
      profile: 'benchmark_5600h',
      batchSize: 256,
      maxConcurrency: 1,
      fastLaneMulticoreMinRefs: 256,
    });
  });

  it('lets createPipelineContext opt into a named runtime profile without changing parse semantics', () => {
    const ctx = createPipelineContext({
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeProfile: 'benchmark_5600h',
    });

    expect(ctx.executionPolicy.parseProfile).toBe('core_parse_fast');
    expect(ctx.runtimeTuning).toEqual({
      profile: 'benchmark_5600h',
      batchSize: 192,
      maxConcurrency: 7,
      fastLaneMulticoreMinRefs: 256,
    });
  });
});
