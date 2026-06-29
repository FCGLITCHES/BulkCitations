import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PIPELINE_OPTIONS,
  type PipelineContext,
} from '../../src/engine/types/pipeline.js';
import { resolvePipelineExecutionPolicy } from '../../src/pipeline/executionPolicy.js';
import { createStageBudgets } from '../../src/pipeline/performance.js';

interface TestPipelineContextOverrides {
  outputStyle?: PipelineContext['outputStyle'];
  options?: Partial<PipelineContext['options']>;
  performanceBudgets?: Partial<PipelineContext['performanceBudgets']>;
  tenantContext?: Partial<PipelineContext['tenantContext']>;
  detectionMeta?: PipelineContext['detectionMeta'];
}

export function createTestPipelineContext(
  overrides: TestPipelineContextOverrides = {},
): PipelineContext {
  const performanceBudgets = {
    ...createStageBudgets(),
    ...overrides.performanceBudgets,
  };
  const options = {
    ...DEFAULT_PIPELINE_OPTIONS,
    ...overrides.options,
  };
  const executionPolicy = resolvePipelineExecutionPolicy(options.parseProfile);

  return {
    jobId: randomUUID(),
    pipelineMajor: 3,
    outputStyle: overrides.outputStyle ?? 'auto',
    options,
    executionPolicy,
    runtimeTuning: {
      batchSize: 32,
      maxConcurrency: 1,
    },
    stageLog: [],
    startedAt: Date.now(),
    performanceBudgets,
    tenantContext: {
      tier: 'free',
      ...overrides.tenantContext,
    },
    providerUsage: {
      crossrefCalls: 0,
      openalexCalls: 0,
      semanticScholarCalls: 0,
      llmTokensUsed: 0,
      llmRepairCalls: 0,
      cacheHits: 0,
    },
    ...(overrides.detectionMeta ? { detectionMeta: overrides.detectionMeta } : {}),
  };
}
