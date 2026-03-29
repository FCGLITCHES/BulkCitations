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
    stageTimings: [],
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

  it('does not require a dropped locator when a journal tail contains only volume and DOI', async () => {
    const citation = {
      ...createEmptyCitation('Li Y, Zhang L, Wang Y, et al. Generative deep learning enables the discovery of a potent and selective RIPK1 inhibitor. Nat Commun. 2022, 13: 10.1038/s41467-022-34692-w'),
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'Y.', last: 'Li', initials: 'Y.' },
        { first: 'L.', last: 'Zhang', initials: 'L.' },
        { first: 'Y.', last: 'Wang', initials: 'Y.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Generative deep learning enables the discovery of a potent and selective RIPK1 inhibitor', 'extracted', 0.94, 'extract'),
      year: createFieldValue(2022, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('Nat Commun', 'extracted', 0.93, 'extract'),
      volume: createFieldValue('13', 'extracted', 0.91, 'extract'),
      doi: createFieldValue('10.1038/s41467-022-34692-w', 'extracted', 0.96, 'extract'),
      resolution: {
        status: 'verified',
        resolvedAt: new Date().toISOString(),
        provider: 'crossref',
        matchStrategy: 'crossref_doi',
        candidateCount: 1,
        rejectedReasons: [],
        appliedFields: [],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 12,
          firstAuthorSurname: 'Li',
          year: 2022,
          venue: 'Nat Commun',
          sourceType: 'journal',
        },
        acceptedCandidate: {
          title: 'Generative deep learning enables the discovery of a potent and selective RIPK1 inhibitor',
        },
      },
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);
    const issueCodes = result.validationIssues.map((issue) => issue.code);

    expect(issueCodes).not.toContain('locator_missing_from_source');
    expect(result.quality?.bucket).toBe('ready');
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
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
        appliedFields: [],
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
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
  });

  it('allows short but valid report titles to stay ready when only provider errors remain', async () => {
    const citation = {
      ...createEmptyCitation('Australian Institute of Health and Welfare. Australia’s health 2020. Canberra: AIHW; 2020.'),
      referenceType: 'report',
      authors: createFieldValue([{ first: null, last: 'Australian Institute of Health and Welfare', initials: null, literal: 'Australian Institute of Health and Welfare' }], 'extracted', 0.9, 'extract'),
      title: createFieldValue("Australia's health 2020", 'extracted', 0.9, 'extract'),
      year: createFieldValue(2020, 'extracted', 0.92, 'extract'),
      institution: createFieldValue('Australian Institute of Health and Welfare', 'extracted', 0.9, 'extract'),
      publisher: createFieldValue('AIHW', 'extracted', 0.9, 'extract'),
      resolution: {
        status: 'provider_error',
        resolvedAt: new Date().toISOString(),
        provider: 'strict-network-resolution',
        matchStrategy: 'none',
        candidateCount: 0,
        rejectedReasons: ['resolution_execution_timeout'],
        appliedFields: [],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 3,
          groupAuthorLiteral: 'Australian Institute of Health and Welfare',
          year: 2020,
          venue: 'AIHW',
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
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
  });

  it('allows title-led websites with strong local evidence to reach ready without authors', async () => {
    const citation = {
      ...createEmptyCitation('Intelligent clinical trials. (2020). https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-.'),
      referenceType: 'website',
      authors: createFieldValue([], 'extracted', 0.1, 'extract'),
      title: createFieldValue('Intelligent clinical trials', 'extracted', 0.94, 'extract'),
      year: createFieldValue(2020, 'extracted', 0.96, 'extract'),
      url: createFieldValue('https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-', 'extracted', 0.95, 'extract'),
      resolution: {
        status: 'provider_no_coverage',
        resolvedAt: new Date().toISOString(),
        provider: 'strict-network-resolution',
        matchStrategy: 'none',
        candidateCount: 0,
        rejectedReasons: ['local_only_author_optional_reference'],
        appliedFields: [],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 3,
          year: 2020,
          venue: null,
          sourceType: 'website',
        },
      },
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);
    expect(result.quality?.bucket).toBe('ready');
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
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

  it('does not require authors for title-led website references', async () => {
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
    };

    const result = await validateAndScore(citation);
    const issueCodes = result.validationIssues.map((issue) => issue.code);

    expect(issueCodes).not.toContain('authors_missing');
    expect(issueCodes).not.toContain('author_structure_unstable');
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
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
  });

  it('allows clean duplicate citations with unresolved authority matches to stay ready when only benign resolution warnings remain', async () => {
    const citation = {
      ...makeJournalCitation(
        'Baron RM, Kenny DA. The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations. Journal of Personality and Social Psychology. 1986;51(6):1173-1182.',
      ),
      status: 'duplicate',
      duplicate: {
        status: 'duplicate',
        method: 'structural',
        duplicateOf: 'base-citation-id',
        mergeReason: 'structural_duplicate_group',
      },
      authors: createFieldValue([
        { first: 'R. M.', last: 'Baron', initials: 'R. M.' },
        { first: 'D. A.', last: 'Kenny', initials: 'D. A.' },
      ], 'extracted', 0.9, 'extract'),
      title: createFieldValue('The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations', 'extracted', 0.92, 'extract'),
      year: createFieldValue(1986, 'extracted', 0.92, 'extract'),
      journal: createFieldValue('Journal of Personality and Social Psychology', 'extracted', 0.82, 'extract'),
      volume: createFieldValue('51', 'extracted', 0.82, 'extract'),
      issue: createFieldValue('6', 'extracted', 0.8, 'extract'),
      pages: createFieldValue('1173-1182', 'extracted', 0.82, 'extract'),
      resolution: {
        status: 'ambiguous_match',
        resolvedAt: new Date().toISOString(),
        provider: 'strict-network-resolution',
        matchStrategy: 'none',
        candidateCount: 2,
        rejectedReasons: ['ambiguous_match'],
        appliedFields: [],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 13,
          firstAuthorSurname: 'Baron',
          year: 1986,
          venue: 'Journal of Personality and Social Psychology',
          sourceType: 'journal',
        },
      },
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);
    expect(result.quality?.bucket).toBe('ready');
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
  });

  it('allows clean conference citations with no exact provider match to stay ready when venue and title evidence remain strong', async () => {
    const citation = {
      ...createEmptyCitation('Sanger F, Nicklen S, Coulson AR. DNA sequencing with chain-terminating inhibitors. In Proceedings of the National Academy of Sciences 1977 (pp. 5463-5467). IEEE.'),
      referenceType: 'conference',
      authors: createFieldValue([
        { first: 'F.', last: 'Sanger', initials: 'F.' },
        { first: 'S.', last: 'Nicklen', initials: 'S.' },
        { first: 'A. R.', last: 'Coulson', initials: 'A. R.' },
      ], 'extracted', 0.97, 'extract'),
      title: createFieldValue('DNA sequencing with chain-terminating inhibitors', 'extracted', 0.9, 'extract'),
      year: createFieldValue(1977, 'extracted', 0.92, 'extract'),
      conferenceTitle: createFieldValue('Proceedings of the National Academy of Sciences 1977', 'extracted', 0.82, 'extract'),
      pages: createFieldValue('5463-5467', 'extracted', 0.82, 'extract'),
      resolution: {
        status: 'no_exact_match',
        resolvedAt: new Date().toISOString(),
        provider: 'strict-network-resolution',
        matchStrategy: 'none',
        candidateCount: 0,
        rejectedReasons: [],
        appliedFields: [],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 4,
          firstAuthorSurname: 'Sanger',
          year: 1977,
          venue: 'Proceedings of the National Academy of Sciences 1977',
          sourceType: 'conference',
        },
      },
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);
    expect(result.quality?.bucket).toBe('ready');
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
  });

  it('allows clean conference citations with provider errors to stay ready when local evidence remains strong', async () => {
    const citation = {
      ...createEmptyCitation('Deng J, Dong W, Socher R, Li LJ, Li K, Fei-Fei L. ImageNet: A large-scale hierarchical image database. In 2009 IEEE Conference on Computer Vision and Pattern Recognition 2009 (pp. 248-255). IEEE.'),
      referenceType: 'conference',
      authors: createFieldValue([
        { first: 'J.', last: 'Deng', initials: 'J.' },
        { first: 'W.', last: 'Dong', initials: 'W.' },
        { first: 'R.', last: 'Socher', initials: 'R.' },
        { first: 'L. J.', last: 'Li', initials: 'L. J.' },
        { first: 'K.', last: 'Li', initials: 'K.' },
        { first: 'L.', last: 'Fei-Fei', initials: 'L.' },
      ], 'extracted', 0.97, 'extract'),
      title: createFieldValue('ImageNet: A large-scale hierarchical image database', 'extracted', 0.9, 'extract'),
      year: createFieldValue(2009, 'extracted', 0.92, 'extract'),
      conferenceTitle: createFieldValue('2009 IEEE Conference on Computer Vision and Pattern Recognition 2009', 'extracted', 0.82, 'extract'),
      pages: createFieldValue('248-255', 'extracted', 0.82, 'extract'),
      resolution: {
        status: 'provider_error',
        resolvedAt: new Date().toISOString(),
        provider: 'strict-network-resolution',
        matchStrategy: 'none',
        candidateCount: 0,
        rejectedReasons: ['resolution_execution_timeout'],
        appliedFields: [],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 7,
          firstAuthorSurname: 'Deng',
          year: 2009,
          venue: '2009 IEEE Conference on Computer Vision and Pattern Recognition 2009',
          sourceType: 'conference',
        },
      },
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);
    expect(result.quality?.bucket).toBe('ready');
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
  });

  it('allows acronym venues like BMJ to stay ready when unresolved authority warnings are otherwise clean', async () => {
    const citation = {
      ...createEmptyCitation('PRISMA Working Group. Preferred reporting items for systematic reviews and meta-analyses (PRISMA) 2020 statement. BMJ. 2021;372:n71.'),
      referenceType: 'journal',
      authors: createFieldValue([{ first: null, last: 'PRISMA Working Group', initials: null, literal: 'PRISMA Working Group' }], 'extracted', 0.93, 'extract'),
      title: createFieldValue('Preferred reporting items for systematic reviews and meta-analyses (PRISMA) 2020 statement', 'extracted', 0.9, 'extract'),
      year: createFieldValue(2021, 'extracted', 0.92, 'extract'),
      journal: createFieldValue('BMJ', 'extracted', 0.9, 'extract'),
      volume: createFieldValue('372', 'extracted', 0.9, 'extract'),
      pages: createFieldValue('n71', 'extracted', 0.9, 'extract'),
      resolution: {
        status: 'no_exact_match',
        resolvedAt: new Date().toISOString(),
        provider: 'strict-network-resolution',
        matchStrategy: 'none',
        candidateCount: 0,
        rejectedReasons: [],
        appliedFields: [],
        conflictFields: [],
        yearToleranceApplied: false,
        queryEvidence: {
          titlePresent: true,
          titleTokenCount: 11,
          groupAuthorLiteral: 'PRISMA Working Group',
          year: 2021,
          venue: 'BMJ',
          sourceType: 'journal',
        },
      },
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);

    expect(result.quality?.bucket).toBe('ready');
    expect(result.quality?.bucketReasons).toContain('Citation passed readiness gates.');
  });

  it('routes repeated edition books into worth_reviewing instead of ready', async () => {
    const citation = {
      ...createEmptyCitation('Goodfellow, I., Bengio, Y., & Courville, A. (2020). Reinforcement Learning: An Introduction (2nd ed.)(2nd ed.). Oxford University Press.'),
      referenceType: 'book',
      authors: createFieldValue([
        { first: 'I.', last: 'Goodfellow', initials: 'I.' },
        { first: 'Y.', last: 'Bengio', initials: 'Y.' },
        { first: 'A.', last: 'Courville', initials: 'A.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Reinforcement Learning: An Introduction (2nd ed.)', 'extracted', 0.92, 'extract'),
      year: createFieldValue(2020, 'extracted', 0.96, 'extract'),
      publisher: createFieldValue('Oxford University Press', 'extracted', 0.91, 'extract'),
      edition: createFieldValue('2nd ed.', 'extracted', 0.9, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);

    expect(result.quality?.readyBlockers).toContain('edition_repeated');
    expect(result.quality?.bucket).toBe('worth_reviewing');
  });

  it('routes DOI leakage and duplicate link targets into action_needed instead of ready', async () => {
    const citation = {
      ...createEmptyCitation('Lee, C. W., Park, S. Y., & Kim, J. H. (2020). Artificial intelligence in medical diagnostics: A systematic review. The Lancet Digital Health, 2(8), e410-e419. https://doi.org/10.1016/S2589-7500(20)30134-3'),
      referenceType: 'journal',
      authors: createFieldValue([
        { first: 'C. W.', last: 'Lee', initials: 'C. W.' },
        { first: 'S. Y.', last: 'Park', initials: 'S. Y.' },
        { first: 'J. H.', last: 'Kim', initials: 'J. H.' },
      ], 'extracted', 0.95, 'extract'),
      title: createFieldValue('Artificial intelligence in medical diagnostics: A systematic review', 'extracted', 0.94, 'extract'),
      year: createFieldValue(2020, 'extracted', 0.96, 'extract'),
      journal: createFieldValue('The Lancet Digital Health', 'extracted', 0.93, 'extract'),
      volume: createFieldValue('2', 'extracted', 0.9, 'extract'),
      issue: createFieldValue('8', 'extracted', 0.9, 'extract'),
      pages: createFieldValue('e410-e419 https://doi.org/10.1016/S2589-7500(20)30134-3', 'extracted', 0.82, 'extract'),
      doi: createFieldValue('10.1016/S2589-7500(20)30134-3', 'extracted', 0.96, 'extract'),
      url: createFieldValue('https://doi.org/10.1016/S2589-7500(20)30134-3', 'extracted', 0.96, 'extract'),
      extraction: {
        method: 'deterministic',
        fallbackUsed: false,
      },
    };

    const result = await validateAndScore(citation);

    expect(result.quality?.readyBlockers).toEqual(expect.arrayContaining([
      'identifier_in_locator',
      'duplicate_link_target',
    ]));
    expect(result.quality?.bucket).toBe('action_needed');
  });
});
