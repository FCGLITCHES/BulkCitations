import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMaxExtractFallbackCallsForBatch } from './llmConfig.js';

describe('v2 llm fallback budget sizing', () => {
  beforeEach(() => {
    process.env.V2_EXTRACT_FALLBACK_MAX_CALLS_PER_BATCH = '10';
  });

  afterEach(() => {
    delete process.env.V2_EXTRACT_FALLBACK_MAX_CALLS_PER_BATCH;
  });

  it('caps extract fallback by the per-batch budget without exceeding the batch size', () => {
    expect(getMaxExtractFallbackCallsForBatch(1)).toBe(1);
    expect(getMaxExtractFallbackCallsForBatch(5)).toBe(5);
    expect(getMaxExtractFallbackCallsForBatch(15)).toBe(10);
  });
});
