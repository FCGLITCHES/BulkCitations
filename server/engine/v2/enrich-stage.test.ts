import { describe, expect, it, vi } from 'vitest';
import { buildStageConfig } from './config.js';
import { createEnrichStage } from './stages/enrich.js';
import { createEmptyCitation, createFieldValue } from './utils.js';
import type { ResolutionProviderAdapter } from './contracts.js';

function makeContext(citationOrCitations: any | any[], enrich = true) {
  const citations = Array.isArray(citationOrCitations) ? citationOrCitations : [citationOrCitations];
  return {
    request: {
      sourceType: 'text',
      content: citations.map((citation) => citation.raw).join('\n\n'),
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
    rawItems: citations.map((citation) => citation.raw),
    citations,
    duplicates: [],
    groups: {},
    pipelineLog: [],
    stageTimings: [],
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

  it('allows author-optional website references to stay local-only without becoming insufficient-evidence failures', async () => {
    const citation = {
      ...createEmptyCitation('Intelligent clinical trials. (2020). https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-.'),
      referenceType: 'website',
      authors: createFieldValue([], 'extracted', 0.1, 'extract'),
      title: createFieldValue('Intelligent clinical trials', 'extracted', 0.94, 'extract'),
      year: createFieldValue(2020, 'extracted', 0.96, 'extract'),
      url: createFieldValue('https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-', 'extracted', 0.95, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    } as any;
    const provider = makeProvider();

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));

    expect(provider.searchOpenAlexByTitle).not.toHaveBeenCalled();
    expect(result.citations[0]?.resolution?.status).toBe('provider_no_coverage');
    expect(result.citations[0]?.resolution?.rejectedReasons).toContain('local_only_author_optional_reference');
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

  it('accepts provider author strings in given-name surname order when the surname still matches exactly', async () => {
    const citation = makeCitation({
      raw: 'He K, Zhang X, Ren S, Sun J. Deep Residual Learning for Image Recognition. Journal. 2016;?:770-778.',
      referenceType: 'unknown',
      authors: createFieldValue([
        { first: 'K.', last: 'He', initials: 'K.' },
        { first: 'X.', last: 'Zhang', initials: 'X.' },
        { first: 'S.', last: 'Ren', initials: 'S.' },
        { first: 'J.', last: 'Sun', initials: 'J.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Deep Residual Learning for Image Recognition', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2016, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Journal', 'extracted', 0.15, 'extract'),
    });
    const provider = makeProvider({
      searchOpenAlexByTitle: vi.fn(async () => [{
        provider: 'openalex',
        title: 'Deep Residual Learning for Image Recognition',
        authors: ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun'],
        year: 2016,
        venue: '2016 IEEE Conference on Computer Vision and Pattern Recognition',
        pages: '770-778',
        doi: '10.1109/CVPR.2016.90',
        url: 'https://doi.org/10.1109/CVPR.2016.90',
        sourceType: 'proceedings-article',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.referenceType).toBe('conference');
    expect(enriched?.doi.value).toBe('10.1109/CVPR.2016.90');
  });

  it('maps working-paper provider source types into preprint when the local citation is still unknown', async () => {
    const citation = makeCitation({
      raw: 'Smith J. Foundation models for triage. 2024.',
      referenceType: 'unknown',
      authors: createFieldValue([
        { first: 'J.', last: 'Smith', initials: 'J.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Foundation models for triage', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2024, 'extracted', 0.96, 'extract'),
      journal: createFieldValue(null, 'extracted', 0.1, 'extract'),
    });
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [{
        provider: 'crossref',
        title: 'Foundation models for triage',
        authors: ['Smith, J.'],
        year: 2024,
        publisher: 'NBER',
        url: 'https://example.test/working-paper',
        sourceType: 'working-paper',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.referenceType).toBe('preprint');
  });

  it('rejects protected-venue mismatches and keeps the matching venue candidate', async () => {
    const citation = {
      ...makeCitation({
        raw: 'Moher, David, Liberati, Alessandro, Tetzlaff, Jennifer, Altman, Douglas G., & Group, The PRISMA (2009). Preferred Reporting Items for Systematic Reviews and Meta-Analyses: The PRISMA Statement. PLoS Medicine, 6(7), e1000097.',
        title: createFieldValue('Preferred Reporting Items for Systematic Reviews and Meta-Analyses: The PRISMA Statement', 'extracted', 0.95, 'extract'),
        authors: createFieldValue([
          { first: 'David', last: 'Moher', initials: 'D.' },
          { first: 'Alessandro', last: 'Liberati', initials: 'A.' },
          { first: 'Jennifer', last: 'Tetzlaff', initials: 'J.' },
          { first: 'Douglas G.', last: 'Altman', initials: 'D. G.' },
        ], 'extracted', 0.95, 'extract'),
        year: createFieldValue(2009, 'extracted', 0.96, 'extract'),
        journal: createFieldValue('PLoS Medicine', 'extracted', 0.93, 'extract'),
        volume: createFieldValue('6', 'extracted', 0.9, 'extract'),
        issue: createFieldValue('7', 'extracted', 0.88, 'extract'),
        pages: createFieldValue('e1000097', 'extracted', 0.9, 'extract'),
      }),
    };
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [
        {
          provider: 'crossref',
          title: 'Preferred reporting items for systematic reviews and meta-analyses: the PRISMA statement',
          authors: ['Moher, David', 'Liberati, Alessandro', 'Tetzlaff, Jennifer', 'Altman, Douglas G.'],
          year: 2009,
          venue: 'BMJ',
          volume: '339',
          issue: 'jul21 1',
          pages: 'b2535-b2535',
          doi: '10.1136/bmj.b2535',
          url: 'https://doi.org/10.1136/bmj.b2535',
          sourceType: 'journal-article',
        },
        {
          provider: 'crossref',
          title: 'Preferred Reporting Items for Systematic Reviews and Meta-Analyses: The PRISMA Statement',
          authors: ['Moher, David', 'Liberati, Alessandro', 'Tetzlaff, Jennifer', 'Altman, Douglas G.'],
          year: 2009,
          venue: 'PLoS Medicine',
          volume: '6',
          issue: '7',
          pages: 'e1000097',
          doi: '10.1371/journal.pmed.1000097',
          url: 'https://doi.org/10.1371/journal.pmed.1000097',
          sourceType: 'journal-article',
        },
      ]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.journal.value).toBe('PLoS Medicine');
    expect(enriched?.doi.value).toBe('10.1371/journal.pmed.1000097');
  });

  it('uses locator compatibility to break otherwise equivalent resolution ties', async () => {
    const citation = {
      ...makeCitation({
        raw: 'Shannon CE. A Mathematical Theory of Communication. Bell System Technical Journal. 1948;27(3):379-423.',
        title: createFieldValue('A Mathematical Theory of Communication', 'extracted', 0.95, 'extract'),
        authors: createFieldValue([{ first: 'C. E.', last: 'Shannon', initials: 'C. E.' }], 'extracted', 0.95, 'extract'),
        year: createFieldValue(1948, 'extracted', 0.96, 'extract'),
        journal: createFieldValue('Bell System Technical Journal', 'extracted', 0.94, 'extract'),
        volume: createFieldValue('27', 'extracted', 0.9, 'extract'),
        issue: createFieldValue('3', 'extracted', 0.88, 'extract'),
        pages: createFieldValue('379-423', 'extracted', 0.92, 'extract'),
      }),
    };
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [
        {
          provider: 'crossref',
          title: 'A Mathematical Theory of Communication',
          authors: ['Shannon, C. E.'],
          year: 1948,
          venue: 'Bell System Technical Journal',
          volume: '27',
          issue: '3',
          pages: '623-656',
          doi: '10.1002/j.1538-7305.1948.tb00917.x',
          sourceType: 'journal-article',
        },
        {
          provider: 'crossref',
          title: 'A Mathematical Theory of Communication',
          authors: ['Shannon, C. E.'],
          year: 1948,
          venue: 'Bell System Technical Journal',
          volume: '27',
          issue: '3',
          pages: '379-423',
          doi: '10.1002/j.1538-7305.1948.tb01338.x',
          sourceType: 'journal-article',
        },
      ]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.matchStrategy).toBe('crossref_exact_title');
    expect(enriched?.pages.value).toBe('379-423');
    expect(enriched?.doi.value).toBe('10.1002/j.1538-7305.1948.tb01338.x');
  });

  it('marks tied accepted candidates as ambiguous and does not merge fields', async () => {
    const citation = makeCitation({
      referenceType: 'unknown',
      journal: createFieldValue(null, 'extracted', 0.1, 'extract'),
    });
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
          venue: 'Medical Image Analysis',
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

  it('corrects conflicting extracted core fields with verified authority data', async () => {
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
    expect(enriched?.resolution?.conflictFields).toEqual([]);
    expect(enriched?.resolution?.appliedFields).toContain('journal');
    expect(enriched?.journal.value).toBe('IEEE Transactions on Medical Imaging');
    expect(enriched?.journal.source).toBe('authority');
  });

  it('fills authority authors and upgrades unknown source types after a verified exact match', async () => {
    const citation = makeCitation({
      referenceType: 'unknown',
      authors: createFieldValue([
        { first: 'J.', last: 'Smith', initials: 'J.' },
      ], 'extracted', 0.58, 'extract'),
      journal: createFieldValue(null, 'extracted', 0.1, 'extract'),
    });
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [{
        provider: 'crossref',
        title: citation.title.value ?? undefined,
        authors: ['Smith, Jane', 'Doe, Alex', 'Muller, Thomas'],
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

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.appliedFields).toEqual(expect.arrayContaining(['authors', 'referenceType', 'journal', 'doi']));
    expect(enriched?.referenceType).toBe('journal');
    expect(enriched?.authors.source).toBe('authority');
    expect(enriched?.authors.value).toHaveLength(3);
    expect(enriched?.authors.value[0]?.last).toBe('Smith');
    expect(enriched?.authors.value[1]?.last).toBe('Doe');
  });

  it('reuses a single in-flight authority lookup across duplicate-style variants with the same resolution key', async () => {
    const left = makeCitation({
      raw: 'He K, Zhang X, Ren S, Sun J. Deep Residual Learning for Image Recognition. Journal. 2016;?:770-778.',
      referenceType: 'unknown',
      authors: createFieldValue([
        { first: 'K.', last: 'He', initials: 'K.' },
        { first: 'X.', last: 'Zhang', initials: 'X.' },
        { first: 'S.', last: 'Ren', initials: 'S.' },
        { first: 'J.', last: 'Sun', initials: 'J.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Deep Residual Learning for Image Recognition', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2016, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Journal', 'extracted', 0.2, 'extract'),
    });
    const right = makeCitation({
      raw: 'He, Kaiming, Xiangyu Zhang, Shaoqing Ren, and Jian Sun. \"Deep Residual Learning for Image Recognition.\" Journal, vol. ?, 2016, pp. 770-778.',
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'Kaiming', last: 'He', initials: 'K.' },
        { first: 'Xiangyu', last: 'Zhang', initials: 'X.' },
        { first: 'Shaoqing', last: 'Ren', initials: 'S.' },
        { first: 'Jian', last: 'Sun', initials: 'J.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Deep Residual Learning for Image Recognition', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2016, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Journal', 'extracted', 0.2, 'extract'),
    });
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [{
          provider: 'crossref',
          title: 'Deep Residual Learning for Image Recognition',
          authors: ['He, Kaiming', 'Zhang, Xiangyu', 'Ren, Shaoqing', 'Sun, Jian'],
          year: 2016,
          venue: '2016 IEEE Conference on Computer Vision and Pattern Recognition',
          pages: '770-778',
          doi: '10.1109/CVPR.2016.90',
          url: 'https://doi.org/10.1109/CVPR.2016.90',
          sourceType: 'proceedings-article',
        }];
      }),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext([left, right]));
    const enriched = result.citations;

    expect(provider.searchCrossrefByTitle).toHaveBeenCalledTimes(1);
    expect(enriched[0]?.resolution?.status).toBe('verified');
    expect(enriched[1]?.resolution?.status).toBe('verified');
    expect(enriched[0]?.referenceType).toBe('conference');
    expect(enriched[1]?.referenceType).toBe('conference');
  });

  it('degrades a stalled resolution attempt into a per-citation provider error instead of timing out the whole stage', async () => {
    const previousTimeout = process.env.V2_ENRICH_CITATION_TIMEOUT_MS;
    process.env.V2_ENRICH_CITATION_TIMEOUT_MS = '25';

    try {
      const citation = makeCitation();
      const provider = makeProvider({
        searchCrossrefByTitle: vi.fn(async () => new Promise<never>(() => {})),
      });

      const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
      const enriched = result.citations[0];

      expect(provider.searchCrossrefByTitle).toHaveBeenCalledTimes(1);
      expect(result.partialResult).toBe(true);
      expect(result.fallbacksUsed).toContain('enrich:resolution_timeout');
      expect(enriched?.resolution?.status).toBe('provider_error');
      expect(enriched?.resolution?.rejectedReasons).toContain('resolution_execution_timeout');
    } finally {
      if (previousTimeout == null) {
        delete process.env.V2_ENRICH_CITATION_TIMEOUT_MS;
      } else {
        process.env.V2_ENRICH_CITATION_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it('allows verified authority data to upgrade placeholder journal references into conference records', async () => {
    const citation = makeCitation({
      raw: 'He K, Zhang X, Ren S, Sun J. Deep Residual Learning for Image Recognition. Journal. 2016;?:770-778.',
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'K.', last: 'He', initials: 'K.' },
        { first: 'X.', last: 'Zhang', initials: 'X.' },
        { first: 'S.', last: 'Ren', initials: 'S.' },
        { first: 'J.', last: 'Sun', initials: 'J.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Deep Residual Learning for Image Recognition', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2016, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Journal', 'extracted', 0.15, 'extract'),
    });
    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [{
        provider: 'crossref',
        title: 'Deep Residual Learning for Image Recognition',
        authors: ['He, Kaiming', 'Zhang, Xiangyu', 'Ren, Shaoqing', 'Sun, Jian'],
        year: 2016,
        venue: '2016 IEEE Conference on Computer Vision and Pattern Recognition',
        pages: '770-778',
        doi: '10.1109/CVPR.2016.90',
        url: 'https://doi.org/10.1109/CVPR.2016.90',
        sourceType: 'proceedings-article',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.referenceType).toBe('conference');
    expect(enriched?.conferenceTitle.value).toBe('2016 IEEE Conference on Computer Vision and Pattern Recognition');
    expect(enriched?.resolution?.appliedFields).toContain('referenceType');
  });

  it('does not mark journal abbreviations and shortened page ranges as conflicts when they are semantically equivalent', async () => {
    const citation = makeCitation({
      raw: 'Dara S, Dhamercherla S, Jadav SS, Babu CM, Ahsan MJ. Machine learning in drug discovery: a review. Artif Intell Rev. 2022, 55:1947-99. 10.1007/s10462-021-10058-4',
      authors: createFieldValue([
        { first: 'S.', last: 'Dara', initials: 'S.' },
        { first: 'S.', last: 'Dhamercherla', initials: 'S.' },
        { first: 'S. S.', last: 'Jadav', initials: 'S. S.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Machine learning in drug discovery: a review', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2022, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Artif Intell Rev', 'extracted', 0.93, 'extract'),
      volume: createFieldValue('55', 'extracted', 0.92, 'extract'),
      pages: createFieldValue('1947-99', 'extracted', 0.92, 'extract'),
      doi: createFieldValue('10.1007/s10462-021-10058-4', 'extracted', 0.96, 'extract'),
    });
    const provider = makeProvider({
      lookupByDoi: vi.fn(async () => [{
        provider: 'crossref',
        title: 'Machine Learning in Drug Discovery: A Review',
        authors: ['Dara, Suresh', 'Dhamercherla, Swetha'],
        year: 2022,
        venue: 'Artificial Intelligence Review',
        volume: '55',
        issue: '3',
        pages: '1947-1999',
        doi: '10.1007/s10462-021-10058-4',
        url: 'https://doi.org/10.1007/s10462-021-10058-4',
        sourceType: 'article-journal',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.conflictFields).not.toContain('journal');
    expect(enriched?.resolution?.conflictFields).not.toContain('pages');
    expect(enriched?.issue.value).toBe('3');
    expect(enriched?.journal.value).toBe('Artif Intell Rev');
    expect(enriched?.pages.value).toBe('1947-99');
  });

  it('does not treat dash and apostrophe normalization differences in titles as hard conflicts', async () => {
    const citation = makeCitation({
      raw: "Bak M, Madai VI, Fritzsche MC, Mayrhofer MT, McLennan S. You can't have AI both ways: balancing health data privacy and access fairly. Front Genet. 2022, 13:10.3389/fgene.2022.929453",
      authors: createFieldValue([
        { first: 'M.', last: 'Bak', initials: 'M.' },
        { first: 'V. I.', last: 'Madai', initials: 'V. I.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue("You can't have AI both ways: balancing health data privacy and access fairly", 'extracted', 0.95, 'extract'),
      year: createFieldValue(2022, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Front Genet', 'extracted', 0.93, 'extract'),
      volume: createFieldValue('13', 'extracted', 0.92, 'extract'),
      doi: createFieldValue('10.3389/fgene.2022.929453', 'extracted', 0.96, 'extract'),
    });
    const provider = makeProvider({
      lookupByDoi: vi.fn(async () => [{
        provider: 'crossref',
        title: 'You Can’t Have AI Both Ways: Balancing Health Data Privacy and Access Fairly',
        authors: ['Bak, Marieke', 'Madai, Vince Istvan'],
        year: 2022,
        venue: 'Frontiers in Genetics',
        volume: '13',
        pages: '929453',
        doi: '10.3389/fgene.2022.929453',
        url: 'https://doi.org/10.3389/fgene.2022.929453',
        sourceType: 'article-journal',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.conflictFields).not.toContain('title');
  });

  it('does not treat electronic page prefixes as hard page conflicts when the numeric locator matches', async () => {
    const citation = makeCitation({
      raw: 'Syrowatka A, Song W, Amato MG, et al. Key use cases for artificial intelligence to reduce the frequency of adverse drug events: a scoping review. Lancet Digit Health. 2022, 4:137-48. 10.1016/S2589-7500(21)00229-6',
      authors: createFieldValue([
        { first: 'A.', last: 'Syrowatka', initials: 'A.' },
        { first: 'W.', last: 'Song', initials: 'W.' },
        { first: 'M. G.', last: 'Amato', initials: 'M. G.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Key use cases for artificial intelligence to reduce the frequency of adverse drug events: a scoping review', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2022, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Lancet Digit Health', 'extracted', 0.93, 'extract'),
      volume: createFieldValue('4', 'extracted', 0.92, 'extract'),
      pages: createFieldValue('137-48', 'extracted', 0.92, 'extract'),
      doi: createFieldValue('10.1016/S2589-7500(21)00229-6', 'extracted', 0.96, 'extract'),
    });
    const provider = makeProvider({
      lookupByDoi: vi.fn(async () => [{
        provider: 'crossref',
        title: 'Key use cases for artificial intelligence to reduce the frequency of adverse drug events: a scoping review',
        authors: ['Syrowatka, Ania', 'Song, Wenyu', 'Amato, Mary G'],
        year: 2022,
        venue: 'The Lancet Digital Health',
        volume: '4',
        issue: '2',
        pages: 'e137-e148',
        doi: '10.1016/S2589-7500(21)00229-6',
        url: 'https://doi.org/10.1016/S2589-7500(21)00229-6',
        sourceType: 'article-journal',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.conflictFields).not.toContain('pages');
  });

  it('does not treat article-number-like locators as hard page conflicts when the authority record has the normalized article number', async () => {
    const citation = makeCitation({
      raw: 'Fan B, Fan W, Smith C, Garner HS. Adverse drug event detection and extraction from open data: a deep learning approach. Inf Process Manag. 2020, 57:102131-10. 10.1016/j.ipm.2019.102131',
      authors: createFieldValue([
        { first: 'B.', last: 'Fan', initials: 'B.' },
        { first: 'W.', last: 'Fan', initials: 'W.' },
        { first: 'C.', last: 'Smith', initials: 'C.' },
        { first: 'H. S.', last: 'Garner', initials: 'H. S.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Adverse drug event detection and extraction from open data: a deep learning approach', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2020, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Inf Process Manag', 'extracted', 0.93, 'extract'),
      volume: createFieldValue('57', 'extracted', 0.92, 'extract'),
      pages: createFieldValue('102131-10', 'extracted', 0.92, 'extract'),
      doi: createFieldValue('10.1016/j.ipm.2019.102131', 'extracted', 0.96, 'extract'),
    });
    const provider = makeProvider({
      lookupByDoi: vi.fn(async () => [{
        provider: 'crossref',
        title: 'Adverse drug event detection and extraction from open data: A deep learning approach',
        authors: ['Fan, Brandon', 'Fan, Weiguo', 'Smith, Carly', 'Garner, Harold "Skip"'],
        year: 2020,
        venue: 'Information Processing & Management',
        volume: '57',
        issue: '1',
        pages: '102131',
        doi: '10.1016/j.ipm.2019.102131',
        url: 'https://doi.org/10.1016/j.ipm.2019.102131',
        sourceType: 'article-journal',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.conflictFields).not.toContain('pages');
  });

  it('does not treat parenthetical journal qualifiers as hard conflicts when the base title matches', async () => {
    const citation = makeCitation({
      raw: 'Barardo DG, Newby D, Thornton D, Ghafourian T, de Magalhães JP, Freitas AA. Machine learning for predicting lifespan-extending chemical compounds. Aging (Albany NY). 2017, 9:1721-37. 10.18632/aging.101264',
      authors: createFieldValue([
        { first: 'D. G.', last: 'Barardo', initials: 'D. G.' },
        { first: 'D.', last: 'Newby', initials: 'D.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Machine learning for predicting lifespan-extending chemical compounds', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2017, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Aging (Albany NY)', 'extracted', 0.93, 'extract'),
      volume: createFieldValue('9', 'extracted', 0.92, 'extract'),
      pages: createFieldValue('1721-37', 'extracted', 0.92, 'extract'),
      doi: createFieldValue('10.18632/aging.101264', 'extracted', 0.96, 'extract'),
    });
    const provider = makeProvider({
      lookupByDoi: vi.fn(async () => [{
        provider: 'crossref',
        title: 'Machine learning for predicting lifespan-extending chemical compounds',
        authors: ['Barardo, Diogo G.', 'Newby, Danielle'],
        year: 2017,
        venue: 'Aging',
        volume: '9',
        issue: '7',
        pages: '1721-1737',
        doi: '10.18632/aging.101264',
        url: 'https://doi.org/10.18632/aging.101264',
        sourceType: 'article-journal',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.conflictFields).not.toContain('journal');
  });

  it('promotes authority pages for DOI-verified online-first locators when the verified record supplies the missing volume', async () => {
    const citation = makeCitation({
      raw: 'Botsis T, Kreimeyer K. Improving drug safety with adverse event detection using natural language processing. Expert Opin Drug Saf. 2023, 1-10. 10.1080/14740338.2023.2228197',
      authors: createFieldValue([
        { first: 'T.', last: 'Botsis', initials: 'T.' },
        { first: 'K.', last: 'Kreimeyer', initials: 'K.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Improving drug safety with adverse event detection using natural language processing', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2023, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Expert Opin Drug Saf', 'extracted', 0.93, 'extract'),
      volume: createFieldValue(null, 'extracted', 0.1, 'extract'),
      issue: createFieldValue(null, 'extracted', 0.1, 'extract'),
      pages: createFieldValue('1-10', 'extracted', 0.82, 'extract'),
      doi: createFieldValue('10.1080/14740338.2023.2228197', 'extracted', 0.96, 'extract'),
    });
    const provider = makeProvider({
      lookupByDoi: vi.fn(async () => [{
        provider: 'crossref',
        title: 'Improving drug safety with adverse event detection using natural language processing',
        authors: ['Botsis, Taxiarchis', 'Kreimeyer, Kory'],
        year: 2023,
        venue: 'Expert Opinion on Drug Safety',
        volume: '22',
        issue: '8',
        pages: '659-668',
        doi: '10.1080/14740338.2023.2228197',
        url: 'https://doi.org/10.1080/14740338.2023.2228197',
        sourceType: 'article-journal',
      }]),
    });

    const result = await createEnrichStage(provider, cache as any).run(makeContext(citation));
    const enriched = result.citations[0];

    expect(enriched?.resolution?.status).toBe('verified');
    expect(enriched?.resolution?.conflictFields).not.toContain('pages');
    expect(enriched?.volume.value).toBe('22');
    expect(enriched?.issue.value).toBe('8');
    expect(enriched?.pages.value).toBe('659-668');
  });
});
