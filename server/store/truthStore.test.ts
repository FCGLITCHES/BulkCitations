import { describe, expect, it } from 'vitest';
import { computeFingerprint, getTruth, saveTruth } from './truthStore.js';

describe('truthStore', () => {
  it('persists approved field-level truth metadata alongside final output', async () => {
    const originalText = 'Example Author. Example title. Example Journal. 2024.';
    const outputStyle = 'apa';
    const fingerprint = computeFingerprint(originalText);

    await saveTruth({
      fingerprint,
      originalText,
      outputStyle,
      validatedOutput: 'Example Author. (2024). Example title. Example Journal.',
      validatedBy: 'tester',
      correctedFields: {
        title: 'Example title',
        year: 2024,
        journal: 'Example Journal',
      },
      fieldApproval: {
        title: { approved: true, value: 'Example title' },
        year: { approved: true, value: 2024 },
      },
      failureTaxonomy: ['title_cleanup', 'year_missing'],
      stageBlame: ['extract', 'validate'],
      duplicateDecision: 'confirmed_unique',
      originalEngineOutput: {
        convertedText: 'Broken output',
        confidence: 41,
      },
      sourceReportId: 'report-1',
      resolvedByVersion: '2.4.1',
    });

    const truth = await getTruth(originalText, outputStyle);
    expect(truth).toBeTruthy();
    expect(truth?.truthId).toBeTruthy();
    expect(truth?.correctedFields?.title).toBe('Example title');
    expect(truth?.fieldApproval?.title?.approved).toBe(true);
    expect(truth?.failureTaxonomy).toContain('title_cleanup');
    expect(truth?.stageBlame).toContain('extract');
    expect(truth?.duplicateDecision).toBe('confirmed_unique');
  });
});
