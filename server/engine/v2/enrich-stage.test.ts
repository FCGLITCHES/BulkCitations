import { describe, expect, it, vi } from 'vitest';
import { buildStageConfig } from './config.js';
import { createEnrichStage } from './stages/enrich.js';
import { createEmptyCitation, createFieldValue } from './utils.js';
import type { ResolutionProviderAdapter } from './contracts.js';

function makeContext(citation: any, enrich = true) {
  return {
    request: {
      sourceType: 'text',
      content: citation.raw,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich,
      dedup: false,
      group: false,
      debug: false,
    },
    jobId: 'enrich-stage-test',
    receivedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    executionMode: 'sync',
    debugEnabled: false,
    rawItems: [citation.raw],
    citations: [citation],
    duplicates: [],
    groups: {},
    pipelineLog: [],
    stagesRun: [],
    fallbacksUsed: [],
    partialResult: false,
    partialReasons: [],
    jobDebug: {},
    workingChunkByCitationId: {},
    splitArtifactsByCitationId: {},
    llmBudget: {
      maxCalls: 0,
      totalCalls: 0,
      splitCalls: 0,
      extractCalls: 0,
      capReached: false,
    },
    stageConfig: buildStageConfig(),
  } as any;
}

function makeCitation(overrides: Record<string, unknown> = {}) {
  const citation = createEmptyCitation('Smith J, Doe A. Hybrid CNN transformer architectures for low-resource biomedical segmentation. IEEE Transactions on Medical Imaging. 2021;40(12):3412-3424.');
  return {
    ...citation,
    referenceType: 'journal',
    authors: createFieldValue([
      { first: 'J.', last: 'Smith', initials: 'J.' },
      { first: 'A.', last: 'Doe', initials: 'A.' },
      { first: 'T.', last: 'Muller', initials: 'T.' },
    ], 'extracted', 0.97, 'extract'),
    title: createFieldValue('Hybrid CNN transformer architectures for low-resource biomedical segmentation', 'extracted', 0.95, 'extract'),
    year: createFieldValue(2021, 'extracted', 0.96, 'extract'),
    journal: createFieldValue('IEEE Transactions on Medical Imaging', 'extracted', 0.93, 'extract'),
    doi: createFieldValue(null, 'extracted', 0.1, 'extract'),
    ...overrides,
  } as any;
}

function makeProvider(overrides: Partial<ResolutionProviderAdapter> = {}): ResolutionProviderAdapter {
  return {
    id: 'test-resolution-provider',
    lookupByDoi: vi.fn(async () => []),
    searchCrossrefByTitle: vi.fn(async () => []),
    searchPubmedByTitle: vi.fn(async () => []),
    searchOpenAlexByTitle: vi.fn(async () => []),
    ...overrides,
  };
}

const cache = {
  id: 'memory-cache',
  async get() {
    return null;
  },
  async set() {
    return undefined;
  },
};

describe('strict enrich stage', () => {
  it('skips provider calls when minimum evidence is missing', async () => {
    const citation = makeCitation({
      authors: createFieldValue([], 'extracted', 0.1, 'extract'),
    });
    const provider = makeProvider();

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));

    expect(provider.searchCrossrefByTitle).not.toHaveBeenCalled();
    expect(result.citations[0]?.resolution?.status).toBe('insufficient_evidence');
    expect(result.citations[0]?.resolution?.rejectedReasons).toContain('parse_too_sparse');
  });

  it('accepts an exact external title match and backfills missing fields', async () => {
    const citation = makeCitation();
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [{
        provider: 'crossref',
        title: citation.title.value ?? undefined,
        authors: ['Smith, J.', 'Doe, A.', 'Muller, T.'],
        year: 2021,
        venue: 'IEEE Transactions on Medical Imaging',
        volume: '40',
        issue: '12',
        pages: '3412-3424',
        doi: '10.1109/TMI.2021.3098765',
        url: 'https://doi.org/10.1109/TMI.2021.3098765',
        sourceType: 'journal-article',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(provider.searchCrossrefByTitle).toHaveBeenCalledWith(expect.objectContaining({
      title: citation.title.value,
      firstAuthorSurname: 'Smith',
      year: 2021,
      venue: 'IEEE Transactions on Medical Imaging',
      sourceType: 'journal',
    }), 5);
    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.matchStrategy).toBe('crossref_exact_title');
    expect(enriched?.doi.value).toBe('10.1109/TMI.2021.3098765');
    expect(enriched?.enrichment?.status).toBe('fetched');
  });

  it('marks tied accepted candidates as ambiguous and does not merge fields', async () => {
    const citation = makeCitation();
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [
        {
          provider: 'crossref',
          title: citation.title.value ?? undefined,
          authors: ['Smith, J.', 'Doe, A.', 'Muller, T.'],
          year: 2021,
          venue: 'IEEE Transactions on Medical Imaging',
          doi: '10.1109/TMI.2021.3098765',
          sourceType: 'journal-article',
        },
        {
          provider: 'crossref',
          title: citation.title.value ?? undefined,
          authors: ['Smith, J.', 'Doe, A.', 'Muller, T.'],
          year: 2021,
          venue: 'IEEE Transactions on Medical Imaging',
          doi: '10.1109/TMI.2021.3098766',
          sourceType: 'journal-article',
        },
      ]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('ambiguous_match');
    expect(enriched?.doi.value).toBeNull();
    expect(enriched?.enrichment?.status).toBe('no_match');
  });

  it('preserves conflicting extracted fields and records conflict fields', async () => {
    const citation = makeCitation({
      journal: createFieldValue('Different Journal Name', 'extracted', 0.93, 'extract'),
    });
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [{
        provider: 'crossref',
        title: citation.title.value ?? undefined,
        authors: ['Smith, J.', 'Doe, A.', 'Muller, T.'],
        year: 2021,
        venue: 'IEEE Transactions on Medical Imaging',
        doi: '10.1109/TMI.2021.3098765',
        sourceType: 'journal-article',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.conflictFields).toContain('journal');
    expect(enriched?.journal.value).toBe('Different Journal Name');
  });
});
