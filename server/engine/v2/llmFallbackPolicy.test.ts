import { afterEach, describe, expect, it } from 'vitest';
import {
  applyClusterReuseFields,
  canRetryFallbackAttempt,
  computeFallbackCacheKey,
  computeFallbackClusterKey,
  getPersistedClusterReuse,
  recordAcceptedClusterReuse,
  resetLlmFallbackPolicyForTests,
} from './llmFallbackPolicy.js';

describe('llm fallback identity policy', () => {
  afterEach(() => {
    resetLlmFallbackPolicyForTests();
  });

  it('normalizes cache keys across Unicode form, whitespace, and casing', () => {
    const left = computeFallbackCacheKey('  Go\u006fdfellow, I.\r\n(2020)  ');
    const right = computeFallbackCacheKey('GOODFELLOW, I. (2020)');
    expect(left).toBe(right);
  });

  it('builds a stable cluster key from author, year, and first six title tokens', () => {
    const key = computeFallbackClusterKey({
      authors: ['Goodfellow, I.'],
      title: 'Reinforcement Learning: An Introduction for Modern Systems',
      year: '2020',
    });

    expect(key).toBe('goodfellow::2020::reinforcement learning an introduction for modern');
  });

  it('reuses only non-locator fields from cluster records', () => {
    const clusterKey = 'goodfellow::2020::reinforcement learning an introduction for modern systems';
    recordAcceptedClusterReuse(clusterKey, 'v2', 'apa', {
      authors: ['Goodfellow, I.', 'Bengio, Y.', 'Courville, A.'],
      title: 'Reinforcement Learning: An Introduction',
      year: '2020',
      publisher: 'Oxford University Press',
      volume: '171',
      pages: '1-2',
      doi: '10.1000/example',
      url: 'https://example.org/book',
    }, 'book');

    const reuse = getPersistedClusterReuse(clusterKey, 'v2', 'apa');
    const applied = applyClusterReuseFields({
      authors: [],
      title: undefined,
      year: undefined,
      publisher: undefined,
      volume: '999',
      pages: '88-99',
      doi: '10.2000/local',
      url: 'https://local.example',
    }, reuse);

    expect(applied.authors).toEqual(['Goodfellow, I.', 'Bengio, Y.', 'Courville, A.']);
    expect(applied.publisher).toBe('Oxford University Press');
    expect(applied.volume).toBe('999');
    expect(applied.pages).toBe('88-99');
    expect(applied.doi).toBe('10.2000/local');
    expect(applied.url).toBe('https://local.example');
  });

  it('invalidates persisted cluster reuse on engine version or style mismatch', () => {
    const clusterKey = 'commission::2022::artificial intelligence act regulatory framework proposal';
    recordAcceptedClusterReuse(clusterKey, 'v2', 'apa', {
      authors: ['European Commission'],
      title: 'Artificial intelligence act: Regulatory framework proposal',
      year: '2022',
      institution: 'European Commission',
    }, 'report');

    expect(getPersistedClusterReuse(clusterKey, 'v2', 'mla')).toBeNull();
    expect(getPersistedClusterReuse(clusterKey, 'v3', 'apa')).toBeNull();
  });

  it('allows retry only after unexpected runtime errors', () => {
    expect(canRetryFallbackAttempt({
      cacheKey: 'abc',
      accepted: false,
      completedAt: new Date().toISOString(),
      errorType: 'unexpected_runtime_error',
    })).toBe(true);
    expect(canRetryFallbackAttempt({
      cacheKey: 'abc',
      accepted: false,
      completedAt: new Date().toISOString(),
      errorType: 'timeout',
    })).toBe(false);
  });
});
