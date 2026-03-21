import { describe, expect, it } from 'vitest';
import { mapV2ResponseToLegacyRecords } from './compat.js';

function buildBaseCitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'citation-1',
    raw: 'Example raw citation',
    status: 'active',
    referenceType: 'journal',
    authors: { value: [{ last: 'McCoy', first: 'L. G.', initials: 'L. G.' }], confidence: 0.94, source: 'extracted' },
    title: { value: 'Ensuring machine learning for healthcare works for all', confidence: 0.95, source: 'extracted' },
    year: { value: 2020, confidence: 0.95, source: 'extracted' },
    journal: { value: 'BMJ Health & Care Informatics', confidence: 0.93, source: 'extracted' },
    volume: { value: '27', confidence: 0.9, source: 'extracted' },
    issue: { value: '3', confidence: 0.9, source: 'extracted' },
    pages: { value: null, confidence: 0, source: 'missing' },
    doi: { value: null, confidence: 0, source: 'missing' },
    url: { value: null, confidence: 0, source: 'missing' },
    publisher: { value: null, confidence: 0, source: 'missing' },
    conferenceTitle: { value: null, confidence: 0, source: 'missing' },
    bookTitle: { value: null, confidence: 0, source: 'missing' },
    institution: { value: null, confidence: 0, source: 'missing' },
    edition: { value: null, confidence: 0, source: 'missing' },
    editor: { value: null, confidence: 0, source: 'missing' },
    detectedStyle: { value: 'apa', confidence: 0.91, source: 'detected' },
    extraction: { method: 'deterministic', fallbackUsed: false, extractorPath: 'deterministic' },
    split: { method: 'structural', confidence: 0.93, reasons: [], fallbackUsed: false },
    validationIssues: [],
    validation: {
      verificationAttempted: false,
      authoritySource: undefined,
      mismatchFields: [],
    },
    quality: {
      overall: 0.71,
      grade: 'C',
      fieldScores: {
        authors: 0.94,
        title: 0.95,
        year: 0.95,
        journal: 0.93,
        volume: 0.9,
        issue: 0.9,
        pages: 0,
        doi: 0,
        publisher: 0,
        url: 0,
      },
      flags: ['review'],
      missingRequired: [],
      missingOptional: ['doi', 'pages', 'url'],
    },
    rendered: {
      formatted: 'McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020). Ensuring machine learning for healthcare works for all. BMJ Health & Care Informatics, 27(3).',
    },
    stageLog: [],
    ...overrides,
  } as any;
}

function mapSingleCitation(citationOverrides: Record<string, unknown>, debug = false) {
  const records = mapV2ResponseToLegacyRecords({
    job_id: 'job-1',
    processed_at: new Date().toISOString(),
    citations: [buildBaseCitation(citationOverrides)],
    duplicates: [],
    groups: {},
    stats: {
      input_count: 1,
      unique_count: 1,
      duplicate_count: 0,
      enriched_count: 0,
      avg_confidence: 0.71,
      retracted_count: 0,
      llm_fallback_count: 0,
    },
    exports: {
      txt: '/api/v2/jobs/job-1/export?format=txt',
      ris: '/api/v2/jobs/job-1/export?format=ris',
      bib: '/api/v2/jobs/job-1/export?format=bib',
      csv: '/api/v2/jobs/job-1/export?format=csv',
      docx: '/api/v2/jobs/job-1/export?format=docx',
    },
    processingPath: {
      stagesRun: ['ingest', 'split', 'detect', 'extract', 'validate', 'normalize', 'score', 'render', 'respond'],
      fallbacksUsed: [],
      durationMs: 10,
      partialResult: false,
      executionMode: 'sync',
      extractorPathsUsed: ['deterministic'],
    },
    debug: debug
      ? {
          enabled: true,
          jobStages: {},
          citations: [],
        }
      : undefined,
    pipeline_log: [],
  } as any, {
    inputStyle: 'auto',
    outputStyle: 'apa',
  });

  expect(records).toHaveLength(1);
  return records[0];
}

describe('legacy v2 compat health and confidence mapping', () => {
  it('does not force review citations to a synthetic 62 percent confidence', () => {
    const record = mapSingleCitation({
      validationIssues: [
        {
          field: 'pages',
          severity: 'info',
          code: 'authority_mismatch',
          message: 'Extracted pages do not match Crossref metadata.',
        },
      ],
      validation: {
        verificationAttempted: true,
        authoritySource: 'crossref',
        mismatchFields: ['pages'],
      },
    });

    expect(record.uiData.healthState).toBe('review');
    expect(record.uiData.confidence?.score).toBe(71);
  });

  it('does not surface missing optional DOI as a health reason', () => {
    const record = mapSingleCitation({
      quality: {
        overall: 0.96,
        grade: 'A',
        fieldScores: {
          authors: 0.94,
          title: 0.95,
          year: 0.95,
          journal: 0.93,
          volume: 0.9,
          issue: 0.9,
          pages: 0.9,
          doi: 0,
          publisher: 0,
          url: 0,
        },
        flags: ['missing_doi'],
        missingRequired: [],
        missingOptional: ['doi'],
      },
    });

    expect(record.uiData.healthState).toBe('clean');
    expect(record.uiData.healthReasons ?? []).not.toContain('DOI missing');
  });

  it('does not surface info-only author recovery notes as review reasons', () => {
    const record = mapSingleCitation({
      validationIssues: [
        {
          field: 'authors',
          severity: 'info',
          code: 'alternating_surname_given_tokens',
          message: 'Author names were normalized from a compact alternating token pattern.',
        },
      ],
      quality: {
        overall: 0.96,
        grade: 'A',
        fieldScores: {
          authors: 0.9,
          title: 0.95,
          year: 0.95,
          journal: 0.93,
          volume: 0.9,
          issue: 0.9,
          pages: 0.9,
          doi: 0,
          publisher: 0,
          url: 0,
        },
        flags: [],
        missingRequired: [],
        missingOptional: [],
      },
    });

    expect(record.uiData.healthState).toBe('clean');
    expect(record.uiData.healthReasons ?? []).toEqual([]);
  });

  it('keeps incomplete source placeholders in review instead of action needed', () => {
    const record = mapSingleCitation({
      raw: 'Haynes, W. M. (2014). CRC Handbook of Chemistry and Physics. Journal, ?.',
      title: { value: 'CRC Handbook of Chemistry and Physics', confidence: 0.92, source: 'extracted' },
      journal: { value: 'Journal', confidence: 0.28, source: 'extracted' },
      volume: { value: '?', confidence: 0.1, source: 'extracted' },
      quality: {
        overall: 0.42,
        grade: 'F',
        fieldScores: {
          authors: 0.8,
          title: 0.92,
          year: 0.9,
          journal: 0.2,
          volume: 0.1,
          issue: 0,
          pages: 0,
          doi: 0,
          publisher: 0,
          url: 0,
        },
        flags: ['placeholder_fields', 'review'],
        missingRequired: ['venue'],
        missingOptional: ['doi', 'pages', 'url'],
      },
      validationIssues: [
        {
          field: 'journal',
          severity: 'warning',
          code: 'placeholder_journal',
          message: 'Journal/venue contains a placeholder value rather than a real source.',
        },
      ],
    });

    expect(record.uiData.healthState).toBe('review');
  });

  it('marks protected-token title corruption as action needed', () => {
    const record = mapSingleCitation({
      raw: 'Ronneberger, O., Fischer, P., and Brox, T. "U-Net: Convolutional Networks for Biomedical Image Segmentation."',
      title: { value: 'U-Convolutional Networks for Biomedical Image Segmentation', confidence: 0.61, source: 'extracted' },
      quality: {
        overall: 0.51,
        grade: 'F',
        fieldScores: {
          authors: 0.8,
          title: 0.61,
          year: 0.7,
          journal: 0,
          volume: 0,
          issue: 0,
          pages: 0,
          doi: 0,
          publisher: 0,
          url: 0,
        },
        flags: ['review'],
        missingRequired: [],
        missingOptional: [],
      },
    });

    expect(record.uiData.healthState).toBe('action_needed');
    expect(record.uiData.healthReasons).toContain('Protected title token U-Net was corrupted');
  });

  it('includes the debug envelope only when v2 debug is enabled', () => {
    const record = mapSingleCitation({
      extraction: {
        method: 'hybrid',
        fallbackUsed: true,
        extractorPath: 'llm',
        rejectedCandidates: ['llm_cap_reached'],
      },
      split: {
        method: 'llm',
        confidence: 0.67,
        reasons: ['llm_multi_citation_resplit'],
        fallbackUsed: true,
      },
      detectedStyle: { value: null, confidence: 0.2, source: 'detected' },
    }, true);

    expect(record.uiData.debug).toEqual({
      extractionPath: 'llm',
      splitMethod: 'llm',
      fallbacksUsed: ['split:fallback', 'extract:fallback', 'llm_cap_reached'],
      splitConfidence: 0.67,
      detectedStyle: 'unknown',
    });
  });
});
