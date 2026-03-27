import { describe, expect, it } from 'vitest';
import type { CitationReport } from '@shared/schema';
import { deriveApprovedOutput } from './reports.js';

function buildReport(): CitationReport {
  return {
    id: 'report-output-test',
    source: 'user',
    originalText: 'Cox, D. R. (1972). Regression models and life-tables. Journal of the Royal Statistical Society, Series B 34(2):187-220.',
    detectedStyle: 'chicago',
    outputStyle: 'chicago-ad',
    parsedData: {
      authors: ['Cox, D. R.'],
      title: 'Regression models and life-tables',
      year: '1972',
      journal: 'Journal of the Royal Statistical Society, Series B 34(2):187-220',
      volume: '34',
      issue: '2',
      pages: '187-220',
    },
    referenceType: 'journal',
    convertedText: 'Broken output',
    confidence: 81,
    failureCategory: 'locator',
    status: 'pending',
    createdAt: new Date().toISOString(),
    fingerprint: 'report-output-test',
    reportCount: 1,
    reviewEvents: [],
    originalEngineOutput: {
      convertedText: 'Broken output',
      parsedData: {
        authors: ['Cox, D. R.'],
        title: 'Regression models and life-tables',
        year: '1972',
        journal: 'Journal of the Royal Statistical Society, Series B 34(2):187-220',
        volume: '34',
        issue: '2',
        pages: '187-220',
      },
      referenceType: 'journal',
      confidence: 81,
    },
  };
}

describe('report approved-output derivation', () => {
  it('drops stale embedded locator tails before rendering derived approved output', () => {
    const output = deriveApprovedOutput({
      correctedFields: {
        title: 'Regression models and life-tables',
        journal: 'Journal of the Royal Statistical Society, Series B',
        year: 1972,
        volume: '34',
        issue: '2',
        pages: '187-220',
      },
      fieldApproval: {
        title: { approved: true, value: 'Regression models and life-tables' },
        journal: { approved: true, value: 'Journal of the Royal Statistical Society, Series B' },
        year: { approved: true, value: 1972 },
        volume: { approved: true, value: '34' },
        issue: { approved: true, value: '2' },
        pages: { approved: true, value: '187-220' },
      },
      report: buildReport(),
    });

    expect(output).toContain('Journal of the Royal Statistical Society, Series B');
    expect(output).not.toContain('Series B 34(2):187-220');
    expect(output?.match(/187[-\u2013]220/g)).toHaveLength(1);
  });
});
