import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChunkedReadyCorpus, READY_CORPUS_THRESHOLDS, READY_CORPUS_TOTAL, type ChunkedReadyMode } from './fixtures/chunkedReadyCorpus.js';
import { processV2Conversion } from './pipeline.js';

type AggregateResult = {
  total: number;
  readyCount: number;
  actionNeededCount: number;
};

async function runChunkedReadyCorpus(mode: ChunkedReadyMode): Promise<AggregateResult> {
  const chunks = buildChunkedReadyCorpus(mode);
  let total = 0;
  let readyCount = 0;
  let actionNeededCount = 0;

  for (const content of chunks) {
    const { response } = await processV2Conversion({
      sourceType: 'text',
      content,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    }, {
      executionMode: 'sync',
    });

    total += response.citations.length;
    readyCount += response.citations.filter((citation) => citation.quality?.bucket === 'ready').length;
    actionNeededCount += response.citations.filter((citation) => citation.quality?.bucket === 'action_needed').length;
  }

  return { total, readyCount, actionNeededCount };
}

describe('v2 chunked 1000-reference ready-rate corpuses', () => {
  afterEach(() => {
    delete process.env.ENABLE_LLM_EXTRACTOR;
    delete process.env.ENABLE_GROBID_EXTRACTOR;
    vi.unstubAllGlobals();
  });

  it.each([
    ['structured' as const],
    ['semi_structured' as const],
    ['raw_unstructured' as const],
  ])('meets the ready-rate floor for %s real-world chunked input', async (mode) => {
    process.env.ENABLE_LLM_EXTRACTOR = '0';
    process.env.ENABLE_GROBID_EXTRACTOR = '0';

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.crossref.org')) {
        return new Response('', { status: 404 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any);

    const aggregate = await runChunkedReadyCorpus(mode);
    const readyRate = aggregate.readyCount / Math.max(aggregate.total, 1);

    expect(aggregate.total).toBe(READY_CORPUS_TOTAL);
    expect(readyRate).toBeGreaterThanOrEqual(READY_CORPUS_THRESHOLDS[mode]);
    if (mode === 'structured') {
      expect(aggregate.actionNeededCount).toBe(0);
    }
  }, 180000);
});
