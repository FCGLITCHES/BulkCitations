import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildChunkedReadyCorpusPlan,
  READY_CORPUS_CHUNK_SIZE,
  READY_CORPUS_THRESHOLDS,
  READY_CORPUS_TOTAL,
  type ChunkedReadyMode,
} from './fixtures/chunkedReadyCorpus.js';
import { processV2Conversion } from './pipeline.js';

type ChunkResult = {
  chunkIndex: number;
  expectedCount: number;
  inputCount: number;
  actualCount: number;
  readyCount: number;
  worthReviewingCount: number;
  actionNeededCount: number;
  partialResult: boolean;
      nonReadySamples?: Array<{
        referenceType: string;
        raw: string;
        bucket: string | undefined;
        overall: number | undefined;
        reasons: string[] | undefined;
        title?: string | null;
        journal?: string | null;
        conferenceTitle?: string | null;
        bookTitle?: string | null;
        publisher?: string | null;
        institution?: string | null;
      }>;
};

type AggregateResult = {
  total: number;
  readyCount: number;
  worthReviewingCount: number;
  actionNeededCount: number;
  readyRate: number;
  chunks: ChunkResult[];
};

async function runChunkedReadyCorpus(mode: ChunkedReadyMode): Promise<AggregateResult> {
  const chunks = buildChunkedReadyCorpusPlan(mode);
  let total = 0;
  let readyCount = 0;
  let worthReviewingCount = 0;
  let actionNeededCount = 0;
  const chunkResults: ChunkResult[] = [];

  for (const chunk of chunks) {
    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: chunk.content,
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
    const chunkReadyCount = response.citations.filter((citation) => citation.quality?.bucket === 'ready').length;
    const chunkWorthReviewingCount = response.citations.filter((citation) => citation.quality?.bucket === 'worth_reviewing').length;
    const chunkActionNeededCount = response.citations.filter((citation) => citation.quality?.bucket === 'action_needed').length;

    readyCount += chunkReadyCount;
    worthReviewingCount += chunkWorthReviewingCount;
    actionNeededCount += chunkActionNeededCount;
    chunkResults.push({
      chunkIndex: chunk.chunkIndex,
      expectedCount: chunk.expectedCount,
      inputCount: response.stats.input_count,
      actualCount: response.citations.length,
      readyCount: chunkReadyCount,
      worthReviewingCount: chunkWorthReviewingCount,
      actionNeededCount: chunkActionNeededCount,
      partialResult: response.processingPath.partialResult ?? false,
      nonReadySamples: process.env.DEBUG_READY_CORPUS === '1'
        ? response.citations
          .filter((citation) => citation.quality?.bucket !== 'ready')
          .slice(0, 5)
          .map((citation) => ({
            referenceType: citation.referenceType,
            raw: citation.raw,
            bucket: citation.quality?.bucket,
            overall: citation.quality?.overall,
            reasons: citation.quality?.bucketReasons,
            title: citation.title.value,
            journal: citation.journal.value,
            conferenceTitle: citation.conferenceTitle.value,
            bookTitle: citation.bookTitle.value,
            publisher: citation.publisher.value,
            institution: citation.institution.value,
          }))
        : undefined,
    });
  }

  return {
    total,
    readyCount,
    worthReviewingCount,
    actionNeededCount,
    readyRate: readyCount / Math.max(total, 1),
    chunks: chunkResults,
  };
}

function installAuthorityMissStub(): void {
  process.env.ENABLE_LLM_EXTRACTOR = '0';
  process.env.ENABLE_GROBID_EXTRACTOR = '0';

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes('api.crossref.org')) {
      return new Response('', { status: 404 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any);
}

function expectAllChunksProcessed(aggregate: AggregateResult): void {
  expect(aggregate.total).toBe(READY_CORPUS_TOTAL);
  expect(aggregate.chunks).toHaveLength(Math.ceil(READY_CORPUS_TOTAL / READY_CORPUS_CHUNK_SIZE));

  for (const chunk of aggregate.chunks) {
    expect(chunk.expectedCount).toBeGreaterThan(0);
    expect(chunk.expectedCount).toBeLessThanOrEqual(READY_CORPUS_CHUNK_SIZE);
    expect(chunk.inputCount).toBe(chunk.expectedCount);
    expect(chunk.actualCount).toBe(chunk.expectedCount);
    expect(chunk.readyCount + chunk.worthReviewingCount + chunk.actionNeededCount).toBe(chunk.expectedCount);
    expect(chunk.partialResult).toBe(false);
  }

  if (process.env.DEBUG_READY_CORPUS === '1') {
    const sampleChunks = aggregate.chunks
      .filter((chunk) => (chunk.actionNeededCount + chunk.worthReviewingCount) > 0)
      .slice(0, 3)
      .map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        readyCount: chunk.readyCount,
        worthReviewingCount: chunk.worthReviewingCount,
        actionNeededCount: chunk.actionNeededCount,
        nonReadySamples: chunk.nonReadySamples,
      }));
    // Helpful for diagnosing cross-suite regressions without changing normal test output.
    console.log(JSON.stringify(sampleChunks, null, 2));
  }
}

describe('v2 chunked 1000-reference ready-rate corpuses', () => {
  afterEach(() => {
    delete process.env.ENABLE_LLM_EXTRACTOR;
    delete process.env.ENABLE_GROBID_EXTRACTOR;
    vi.unstubAllGlobals();
  });

  it('keeps structured 1000-reference chunks at 100% ready', async () => {
    installAuthorityMissStub();

    const aggregate = await runChunkedReadyCorpus('structured');

    expectAllChunksProcessed(aggregate);
    expect(aggregate.readyCount).toBe(READY_CORPUS_TOTAL);
    expect(aggregate.readyRate).toBe(READY_CORPUS_THRESHOLDS.structured);
    expect(aggregate.worthReviewingCount).toBe(0);
    expect(aggregate.actionNeededCount).toBe(0);
  }, 180000);

  it('keeps semi-structured 1000-reference chunks at or above 95% ready', async () => {
    installAuthorityMissStub();

    const aggregate = await runChunkedReadyCorpus('semi_structured');

    expectAllChunksProcessed(aggregate);
    expect(aggregate.readyRate).toBeGreaterThanOrEqual(READY_CORPUS_THRESHOLDS.semi_structured);
  }, 180000);

  it('keeps raw unstructured 1000-reference chunks at or above 95% ready', async () => {
    installAuthorityMissStub();

    const aggregate = await runChunkedReadyCorpus('raw_unstructured');

    expectAllChunksProcessed(aggregate);
    expect(aggregate.readyRate).toBeGreaterThanOrEqual(READY_CORPUS_THRESHOLDS.raw_unstructured);
  }, 180000);
});
