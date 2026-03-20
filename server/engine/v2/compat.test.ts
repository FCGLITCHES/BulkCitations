import { describe, expect, it } from 'vitest';
import { mapV2ResponseToLegacyRecords } from './compat.js';

describe('legacy v2 compat health and confidence mapping', () => {
  it('does not force review citations to a synthetic 62 percent confidence', () => {
    const records = mapV2ResponseToLegacyRecords({
      job_id: 'job-1',
      created_at: new Date().toISOString(),
      citations: [
        {
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
          extraction: { method: 'deterministic', fallbackUsed: false },
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
          rendered: { formatted: 'McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020). Ensuring machine learning for healthcare works for all. BMJ Health & Care Informatics, 27(3).' },
          stageLog: [],
        } as any,
      ],
      duplicates: [],
      stats: {
        input_count: 1,
        unique_count: 1,
        duplicate_count: 0,
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
    } as any, {
      inputStyle: 'auto',
      outputStyle: 'apa',
    });

    expect(records).toHaveLength(1);
    expect(records[0].uiData.healthState).toBe('review');
    expect(records[0].uiData.confidence?.score).toBe(71);
  });
});
