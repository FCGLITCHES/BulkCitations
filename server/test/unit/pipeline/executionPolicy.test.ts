import { describe, expect, it } from 'vitest';

import { createPipelineContext } from '../../../src/pipeline/context.js';
import { normalizePipelineOptions, resolvePipelineExecutionPolicy } from '../../../src/pipeline/executionPolicy.js';

describe('pipeline execution policy', () => {
  it('resolves core_parse_fast as a provider-free, llm-free policy', () => {
    expect(resolvePipelineExecutionPolicy('core_parse_fast')).toMatchObject({
      parseProfile: 'core_parse_fast',
      providers: 'off',
      llmFallback: 'off',
      styleDetectionMl: 'off',
      authorDisambiguationMl: 'off',
      extractionMl: 'off',
      typeClassificationMl: 'off',
      renderMode: 'structured',
      dedupMode: 'exact_canonical',
      healthMode: 'minimal',
      debugMode: 'off',
    });
  });

  it('normalizes legacy booleans under core_parse_full without allowing provider mutation', () => {
    const normalized = normalizePipelineOptions({
      parseProfile: 'core_parse_full',
      enrich: true,
      llmFallback: true,
      authorityValidation: true,
      debug: true,
    });

    expect(normalized.executionPolicy.parseProfile).toBe('core_parse_full');
    expect(normalized.options.enrich).toBe(false);
    expect(normalized.options.llmFallback).toBe(false);
    expect(normalized.options.authorityValidation).toBe(true);
    expect(normalized.options.debug).toBe(true);
  });

  it('defaults missing parseProfile to current_runtime', () => {
    const normalized = normalizePipelineOptions({
      dedup: false,
    });

    expect(normalized.executionPolicy.parseProfile).toBe('current_runtime');
    expect(normalized.options.parseProfile).toBe('current_runtime');
    expect(normalized.options.dedup).toBe(false);
  });

  it('keeps core_parse_full site_default on the primary extraction lane with deterministic helper phases', () => {
    const ctx = createPipelineContext({
      options: { parseProfile: 'core_parse_full' },
      runtimeProfile: 'site_default',
    });

    expect(ctx.executionPolicy).toMatchObject({
      parseProfile: 'core_parse_full',
      extractionMl: 'routed',
      styleDetectionMl: 'off',
      authorDisambiguationMl: 'off',
      typeClassificationMl: 'off',
    });
  });
});
