import { describe, expect, it, vi } from 'vitest';
import { buildStageConfig } from './config.js';
import type { ResolutionProviderAdapter } from './contracts.js';
import { createDedupStage } from './stages/dedup.js';
import { createEnrichStage } from './stages/enrich.js';
import { createValidateStage } from './stages/validate.js';
import { createEmptyCitation, createFieldValue } from './utils.js';

function makeContext(citations: any[], overrides: Partial<any> = {}) {
  const { request: requestOverrides, ...restOverrides } = overrides;
  return {
    request: {
      sourceType: 'text',
      content: citations.map((citation) => citation.raw).join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: true,
      dedup: true,
      group: false,
      debug: true,
      ...requestOverrides,
    },
    jobId: 'enrich-validate-dedup-test',
    receivedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    executionMode: 'sync',
    debugEnabled: true,
    rawItems: citations.map((citation) => citation.raw),
    citations,
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
    ...restOverrides,
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

describe('enrich + validate + dedup architecture', () => {
  it('treats verified authority corrections as applied fields instead of unresolved conflicts', async () => {
    const citation = {
      ...createEmptyCitation('Smith J, Doe A. Hybrid CNN transformer architectures for low-resource biomedical segmentation. Different Journal Name. 2021;40(12):3412-3424.'),
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'J.', last: 'Smith', initials: 'J.' },
      ], 'extracted', 0.55, 'extract'),
      title: createFieldValue('Hybrid CNN transformer architectures for low-resource biomedical segmentation', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2021, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Different Journal Name', 'extracted', 0.91, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    } as any;

    const provider = makeProvider({
      searchCrossrefByTitle: vi.fn(async () => [{
        provider: 'crossref',
        title: 'Hybrid CNN transformer architectures for low-resource biomedical segmentation',
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

    const enrichedContext = await createEnrichStage(provider, cache as any).run(makeContext([citation], {
      request: { dedup: false },
    }));
    const validatedContext = await createValidateStage().run(enrichedContext);
    const validated = validatedContext.citations[0];
    const issueCodes = validated.validationIssues.map((issue: any) => issue.code);

    expect(validated.resolution?.status).toBe('verified');
    expect(validated.resolution?.appliedFields).toEqual(expect.arrayContaining(['authors', 'journal', 'volume', 'issue', 'pages', 'doi']));
    expect(validated.journal.value).toBe('IEEE Transactions on Medical Imaging');
    expect(validated.authors.value).toHaveLength(3);
    expect(issueCodes).toContain('authority_fields_applied');
    expect(issueCodes).not.toContain('resolved_field_conflict');
  });

  it('keeps authority-corrected duplicate members as the canonical merged citation and revalidates the merge result', async () => {
    const weaker = {
      ...createEmptyCitation('Smith J, Doe A. Hybrid CNN transformer architectures for low-resource biomedical segmentation. Different Journal Name. 2021;40(12):3412-3424. 10.1109/TMI.2021.3098765'),
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'J.', last: 'Smith', initials: 'J.' },
      ], 'extracted', 0.52, 'extract'),
      title: createFieldValue('Hybrid CNN transformer architectures for low-resource biomedical segmentation', 'extracted', 0.93, 'extract'),
      year: createFieldValue(2021, 'extracted', 0.94, 'extract'),
      journal: createFieldValue('Different Journal Name', 'extracted', 0.82, 'extract'),
      volume: createFieldValue('40', 'extracted', 0.84, 'extract'),
      issue: createFieldValue('12', 'extracted', 0.82, 'extract'),
      pages: createFieldValue('3412-3424', 'extracted', 0.84, 'extract'),
      doi: createFieldValue('10.1109/TMI.2021.3098765', 'extracted', 0.9, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
      validationIssues: [],
    } as any;

    const verified = {
      ...createEmptyCitation('Smith, J., Doe, A., & Muller, T. (2021). Hybrid CNN transformer architectures for low-resource biomedical segmentation. IEEE Transactions on Medical Imaging, 40(12), 3412-3424. https://doi.org/10.1109/TMI.2021.3098765'),
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'Jane', last: 'Smith', initials: 'J.' },
        { first: 'Alex', last: 'Doe', initials: 'A.' },
        { first: 'Thomas', last: 'Muller', initials: 'T.' },
      ], 'authority', 0.98, 'enrich'),
      title: createFieldValue('Hybrid CNN transformer architectures for low-resource biomedical segmentation', 'authority', 0.97, 'enrich'),
      year: createFieldValue(2021, 'authority', 0.97, 'enrich'),
      journal: createFieldValue('IEEE Transactions on Medical Imaging', 'authority', 0.97, 'enrich'),
      volume: createFieldValue('40', 'authority', 0.97, 'enrich'),
      issue: createFieldValue('12', 'authority', 0.97, 'enrich'),
      pages: createFieldValue('3412-3424', 'authority', 0.97, 'enrich'),
      doi: createFieldValue('10.1109/TMI.2021.3098765', 'authority', 0.98, 'enrich'),
      resolution: {
        status: 'verified',
        resolvedAt: new Date().toISOString(),
        provider: 'crossref',
        matchStrategy: 'crossref_doi',
        candidateCount: 1,
        rejectedReasons: [],
        appliedFields: ['authors', 'journal', 'doi'],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 9,
          firstAuthorSurname: 'Smith',
          year: 2021,
          venue: 'IEEE Transactions on Medical Imaging',
          sourceType: 'journal',
        },
        acceptedCandidate: {
          provider: 'crossref',
          title: 'Hybrid CNN transformer architectures for low-resource biomedical segmentation',
          authors: ['Smith, Jane', 'Doe, Alex', 'Muller, Thomas'],
          year: 2021,
          venue: 'IEEE Transactions on Medical Imaging',
          volume: '40',
          issue: '12',
          pages: '3412-3424',
          doi: '10.1109/TMI.2021.3098765',
          url: 'https://doi.org/10.1109/TMI.2021.3098765',
          sourceType: 'journal-article',
        },
      },
      enrichment: {
        status: 'fetched',
        provider: 'crossref',
        sourceUsed: 'crossref_doi',
        cacheHit: false,
        doiFound: true,
        abstractFound: false,
        retractedFlag: false,
        matchedTitle: 'Hybrid CNN transformer architectures for low-resource biomedical segmentation',
        matchedAuthors: ['Smith, Jane', 'Doe, Alex', 'Muller, Thomas'],
        matchedYear: 2021,
        url: 'https://doi.org/10.1109/TMI.2021.3098765',
      },
      validationIssues: [],
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    } as any;

    const dedupedContext = await createDedupStage().run(makeContext([weaker, verified]));
    const merged = dedupedContext.citations.find((citation: any) => citation.status === 'merged');
    const duplicates = dedupedContext.citations.filter((citation: any) => citation.status === 'duplicate');

    expect(duplicates).toHaveLength(2);
    expect(merged).toBeTruthy();
    expect(merged?.raw).toBe(verified.raw);
    expect(merged?.journal.value).toBe('IEEE Transactions on Medical Imaging');
    expect(merged?.doi.value).toBe('10.1109/TMI.2021.3098765');
    expect(merged?.authors.value).toHaveLength(3);
    expect(merged?.resolution?.status).toBe('verified');
    expect(merged?.resolution?.appliedFields).toEqual(expect.arrayContaining(['authors', 'journal', 'doi']));
    expect(merged?.validationIssues.map((issue: any) => issue.code)).not.toContain('resolved_field_conflict');
  });

  it('does not structurally deduplicate citations that carry different explicit DOIs', async () => {
    const left = {
      ...createEmptyCitation('Smith J, Doe A. Hybrid CNN transformer architectures for low-resource biomedical segmentation. IEEE Transactions on Medical Imaging. 2021;40(12):3412-3424. 10.1109/TMI.2021.3098765'),
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'J.', last: 'Smith', initials: 'J.' },
        { first: 'A.', last: 'Doe', initials: 'A.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Hybrid CNN transformer architectures for low-resource biomedical segmentation', 'extracted', 0.94, 'extract'),
      year: createFieldValue(2021, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('IEEE Transactions on Medical Imaging', 'extracted', 0.95, 'extract'),
      volume: createFieldValue('40', 'extracted', 0.9, 'extract'),
      issue: createFieldValue('12', 'extracted', 0.88, 'extract'),
      pages: createFieldValue('3412-3424', 'extracted', 0.9, 'extract'),
      doi: createFieldValue('10.1109/TMI.2021.3098765', 'extracted', 0.96, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
      validationIssues: [],
    } as any;

    const right = {
      ...createEmptyCitation('Smith J, Doe A. Hybrid CNN transformer architectures for low-resource biomedical segmentation. IEEE Transactions on Medical Imaging. 2021;40(12):3412-3424. 10.1109/TMI.2021.3098766'),
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'J.', last: 'Smith', initials: 'J.' },
        { first: 'A.', last: 'Doe', initials: 'A.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Hybrid CNN transformer architectures for low-resource biomedical segmentation', 'extracted', 0.94, 'extract'),
      year: createFieldValue(2021, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('IEEE Transactions on Medical Imaging', 'extracted', 0.95, 'extract'),
      volume: createFieldValue('40', 'extracted', 0.9, 'extract'),
      issue: createFieldValue('12', 'extracted', 0.88, 'extract'),
      pages: createFieldValue('3412-3424', 'extracted', 0.9, 'extract'),
      doi: createFieldValue('10.1109/TMI.2021.3098766', 'extracted', 0.96, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
      validationIssues: [],
    } as any;

    const dedupedContext = await createDedupStage().run(makeContext([left, right]));

    expect(dedupedContext.duplicates).toHaveLength(0);
    expect(dedupedContext.citations.filter((citation: any) => citation.status === 'merged')).toHaveLength(0);
    expect(dedupedContext.citations.filter((citation: any) => citation.status === 'duplicate')).toHaveLength(0);
  });
});
