import { describe, expect, it } from 'vitest';
import { mapV2ResponseToLegacyRecords } from './compat.js';
import { createValidateStage } from './stages/validate.js';
import { createScoreStage } from './stages/score.js';
import { createEmptyCitation, createFieldValue } from './utils.js';

function makeBaseContext(citation: any) {
  return {
    request: {
      sourceType: 'text',
      content: citation.raw,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    },
    jobId: 'validate-fp-test',
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
    stageConfig: {} as any,
  } as any;
}

function makeJournalCitation(raw: string, overrides?: Partial<any>) {
  const citation = createEmptyCitation(raw);
  return {
    ...citation,
    referenceType: 'journal',
    authors: createFieldValue([{ first: 'J.', last: 'Smith', initials: 'J.' }], 'extracted', 0.97, 'extract'),
    title: createFieldValue('Deep work matters', 'extracted', 0.95, 'extract'),
    year: createFieldValue(2021, 'extracted', 0.98, 'extract'),
    journal: createFieldValue('Example Journal', 'extracted', 0.94, 'extract'),
    volume: createFieldValue('10', 'extracted', 0.9, 'extract'),
    issue: createFieldValue('2', 'extracted', 0.88, 'extract'),
    pages: createFieldValue('33-44', 'extracted', 0.92, 'extract'),
    extraction: {
      method: 'deterministic',
      fallbackUsed: false,
    },
    ...overrides,
  };
}

async function validateAndScore(citation: any) {
  const validated = await createValidateStage().run(makeBaseContext(citation));
  const scored = await createScoreStage().run(validated);
  return scored.citations[0];
}

describe('v2 validation false-positive regression checks', () => {
  it('does not flag short but valid multi-word titles', async () => {
    const citation = makeJournalCitation(
      'Smith, J. (2021). Deep work matters. Example Journal, 10(2), 33-44.',
    );

    const result = await validateAndScore(citation);

    expect(result.validationIssues.map((issue) => issue.code)).not.toContain('title_short_or_missing');
  });

  it('does not flag preserved article locators as invalid or missing', async () => {
    const citation = makeJournalCitation(
      'Smith, J. (2021). Deep work matters. Example Journal, 10(2), e12345.',
      {
        pages: createFieldValue('e12345', 'extracted', 0.92, 'extract'),
      },
    );

    const result = await validateAndScore(citation);
    const issueCodes = result.validationIssues.map((issue) => issue.code);

    expect(issueCodes).not.toContain('pages_invalid_shape');
    expect(issueCodes).not.toContain('locator_missing_from_source');
  });

  it('still flags dropped locators when the input had them and the output lost them', async () => {
    const citation = makeJournalCitation(
      'Smith, J. (2021). Deep work matters. Example Journal, 10(2), pp. 33-44.',
      {
        pages: createFieldValue(null, 'extracted', 0.15, 'extract'),
      },
    );

    const result = await validateAndScore(citation);

    expect(result.validationIssues.map((issue) => issue.code)).toContain('locator_missing_from_source');
  });

  it('does not flag known conference acronyms as weak proceedings venues or downgrade legacy health', async () => {
    const citation = {
      ...createEmptyCitation('Smith, J. (2022). Robust transformers. NeurIPS, 120-130.'),
      referenceType: 'conference',
      authors: createFieldValue([{ first: 'J.', last: 'Smith', initials: 'J.' }], 'extracted', 0.97, 'extract'),
      title: createFieldValue('Robust transformers', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2022, 'extracted', 0.98, 'extract'),
      conferenceTitle: createFieldValue('NeurIPS', 'extracted', 0.94, 'extract'),
      pages: createFieldValue('120-130', 'extracted', 0.9, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const scored = await validateAndScore(citation);
    expect(scored.validationIssues.map((issue) => issue.code)).not.toContain('weak_proceedings_venue');

    const legacy = mapV2ResponseToLegacyRecords({
      job_id: 'job-1',
      processed_at: new Date().toISOString(),
      stats: {
        input_count: 1,
        unique_count: 1,
        duplicate_count: 0,
        enriched_count: 0,
        avg_confidence: scored.quality?.overall ?? 0,
        retracted_count: 0,
        llm_fallback_count: 0,
      },
      citations: [scored],
      groups: {},
      duplicates: [],
      exports: { txt: '', bib: '', ris: '', csv: '', docx: '' },
      processingPath: {
        stagesRun: ['validate', 'score'],
        fallbacksUsed: [],
        durationMs: 1,
        partialResult: false,
      },
      pipeline_log: [],
    }, {
      inputStyle: 'auto',
      outputStyle: 'apa',
    });

    expect(legacy[0]?.uiData.healthState).toBe('clean');
  });

  it('does not flag placeholder journal text when a stronger venue field already exists', async () => {
    const citation = {
      ...createEmptyCitation('Smith, J. (2020). Example chapter. In Handbook of Testing (pp. 10-20).'),
      referenceType: 'chapter',
      authors: createFieldValue([{ first: 'J.', last: 'Smith', initials: 'J.' }], 'extracted', 0.97, 'extract'),
      title: createFieldValue('Example chapter', 'extracted', 0.95, 'extract'),
      year: createFieldValue(2020, 'extracted', 0.98, 'extract'),
      journal: createFieldValue('Journal', 'extracted', 0.42, 'extract'),
      bookTitle: createFieldValue('Handbook of Testing', 'extracted', 0.95, 'extract'),
      pages: createFieldValue('10-20', 'extracted', 0.9, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const scored = await validateAndScore(citation);
    expect(scored.validationIssues.map((issue) => issue.code)).not.toContain('placeholder_journal');
  });

  it('does not treat protected title tokens as corrupted venue tokens when they belong in the title', async () => {
    const citation = makeJournalCitation(
      'Larsen P, von Stein J. Detecting BMJ-style article locators in hybrid reference corpora. Learned Publishing. 2021;34(4):521-533.',
      {
        authors: createFieldValue([
          { first: 'P.', last: 'Larsen', initials: 'P.' },
          { first: 'J.', last: 'von Stein', initials: 'J.' },
        ], 'extracted', 0.96, 'extract'),
        title: createFieldValue('Detecting BMJ-style article locators in hybrid reference corpora', 'extracted', 0.95, 'extract'),
        journal: createFieldValue('Learned Publishing', 'extracted', 0.94, 'extract'),
        year: createFieldValue(2021, 'extracted', 0.98, 'extract'),
        volume: createFieldValue('34', 'extracted', 0.9, 'extract'),
        issue: createFieldValue('4', 'extracted', 0.88, 'extract'),
        pages: createFieldValue('521-533', 'extracted', 0.92, 'extract'),
      },
    );

    const result = await validateAndScore(citation);
    expect(result.validationIssues.map((issue) => issue.code)).not.toContain('protected_venue_token_corrupted');
  });

  it('allows report citations with no exact provider match to reach ready when the local parse is high-confidence', async () => {
    const citation = {
      ...createEmptyCitation('World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.'),
      referenceType: 'report',
      authors: createFieldValue([{ first: null, last: 'World Health Organization', initials: null, literal: 'World Health Organization' }], 'extracted', 0.94, 'extract'),
      title: createFieldValue('Global tuberculosis report 2023', 'extracted', 0.93, 'extract'),
      year: createFieldValue(2023, 'extracted', 0.96, 'extract'),
      institution: createFieldValue('World Health Organization', 'extracted', 0.94, 'extract'),
      publisher: createFieldValue('World Health Organization', 'extracted', 0.94, 'extract'),
      resolution: {
        status: 'no_exact_match',
        resolvedAt: new Date().toISOString(),
        provider: 'strict-network-resolution',
        matchStrategy: 'none',
        candidateCount: 0,
        rejectedReasons: [],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 4,
          groupAuthorLiteral: 'World Health Organization',
          year: 2023,
          venue: 'World Health Organization',
          sourceType: 'report',
        },
      },
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);
    expect(result.quality?.bucket).toBe('ready');
    expect(result.quality?.bucketReasons).toContain('High-confidence local parse with no exact provider coverage.');
  });

  it('does not emit truncated_group_author for already-stable institutional authors', async () => {
    const citation = {
      ...createEmptyCitation('OpenAI. GPT-5.1 system card. 2026. Available from: https://openai.com/research/gpt-5-1.'),
      referenceType: 'website',
      authors: createFieldValue([{ first: null, last: 'OpenAI', initials: null, literal: 'OpenAI' }], 'extracted', 0.92, 'extract'),
      title: createFieldValue('GPT-5.1 system card', 'extracted', 0.92, 'extract'),
      year: createFieldValue(2026, 'extracted', 0.96, 'extract'),
      institution: createFieldValue('OpenAI', 'extracted', 0.92, 'extract'),
      url: createFieldValue('https://openai.com/research/gpt-5-1', 'extracted', 0.95, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);
    expect(result.validationIssues.map((issue) => issue.code)).not.toContain('truncated_group_author');
  });

  it('does not demote duplicate-family citations to review when confidence is above the duplicate ready threshold', async () => {
    const citation = {
      ...makeJournalCitation(
        'Smith, J. (2021). Deep work matters. Example Journal, 10(2), 33-44.',
      ),
      status: 'duplicate',
      duplicate: {
        status: 'duplicate',
        method: 'structural',
        duplicateOf: 'base-citation-id',
        mergeReason: 'structural_duplicate_group',
      },
      authors: createFieldValue([{ first: 'J.', last: 'Smith', initials: 'J.' }], 'extracted', 0.9, 'extract'),
      title: createFieldValue('Deep work matters', 'extracted', 0.9, 'extract'),
      year: createFieldValue(2021, 'extracted', 0.92, 'extract'),
      journal: createFieldValue('Example Journal', 'extracted', 0.82, 'extract'),
      volume: createFieldValue('10', 'extracted', 0.82, 'extract'),
      issue: createFieldValue('2', 'extracted', 0.8, 'extract'),
      pages: createFieldValue('33-44', 'extracted', 0.82, 'extract'),
    };

    const result = await validateAndScore(citation);
    expect(result.quality?.bucket).toBe('ready');
    expect(result.quality?.bucketReasons).toContain('High-confidence parse stayed ready even though the citation belongs to a duplicate family.');
  });
});
