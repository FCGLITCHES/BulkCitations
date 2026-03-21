import { describe, expect, it } from 'vitest';
import type { ConvertedReference } from '@shared/schema';
import { applyTruthToLegacyReference } from './truthResolver.js';
import { computeFingerprint } from '../../store/reportStore.js';
import { saveTruth } from '../../store/truthStore.js';

function baseReference(id: string, originalText: string, doi: string): ConvertedReference {
  return {
    id,
    originalText,
      convertedText: 'Broken output',
      referenceType: 'journal',
      parsedData: {
        authors: ['Smith, J.'],
        title: 'Broken title',
        year: '2020',
        journal: 'Broken Journal',
        pages: '10-12',
        doi,
      },
    inputStyle: 'apa',
    outputStyle: 'apa',
    confidence: {
      score: 41,
      breakdown: { rules: 41 },
      isSuspicious: false,
    },
  };
}

describe('truthResolver legacy application', () => {
  it('uses approved output text for exact style matches', async () => {
    const originalText = 'Smith, J. (2020). Broken title. Broken Journal, 1(1), 10-12. https://doi.org/10.5555/truth-legacy';
    await saveTruth({
      fingerprint: computeFingerprint(originalText),
      originalText,
      outputStyle: 'apa',
      validatedOutput: 'Smith, J. (2020). Approved title. Approved Journal, 1(1), 10-12.',
      validatedBy: 'tester',
      correctedFields: {
        title: 'Approved title',
        journal: 'Approved Journal',
        doi: '10.5555/truth-legacy',
      },
      fieldApproval: {
        title: { approved: true, value: 'Approved title' },
        journal: { approved: true, value: 'Approved Journal' },
        doi: { approved: true, value: '10.5555/truth-legacy' },
      },
      sourceReportId: 'truth-resolver-1',
      resolvedByVersion: '2.5.0',
    });

    const adjusted = await applyTruthToLegacyReference(baseReference('legacy-1', originalText, '10.5555/truth-legacy'), 'apa');
    expect(adjusted.convertedText).toBe('Smith, J. (2020). Approved title. Approved Journal, 1(1), 10-12.');
    expect(adjusted.truthProvenance?.truthApplied).toBe(true);
    expect(adjusted.truthProvenance?.usedValidatedOutput).toBe(true);
  });

  it('treats approved null as confirmed absence', async () => {
    const originalText = 'Doe, J. (2019). Something. Example Journal, 4(2), 44-48. https://doi.org/10.5555/truth-null';
    await saveTruth({
      fingerprint: computeFingerprint(originalText),
      originalText,
      outputStyle: 'apa',
      validatedOutput: 'Ignored stale text',
      validatedBy: 'tester',
      correctedFields: {
        year: null,
        doi: '10.5555/truth-null',
      },
      fieldApproval: {
        year: { approved: true, value: null },
        doi: { approved: true, value: '10.5555/truth-null' },
      },
      sourceReportId: 'truth-resolver-2',
      resolvedByVersion: '2.5.0',
      staleAfterVersion: '0.0.0',
      staleReason: 'manual',
    });

    const adjusted = await applyTruthToLegacyReference(baseReference('legacy-2', originalText, '10.5555/truth-null'), 'mla');
    expect(adjusted.parsedData.year).toBeUndefined();
    expect(adjusted.truthProvenance?.truthApplied).toBe(true);
    expect(adjusted.truthProvenance?.usedValidatedOutput).toBe(false);
    expect(adjusted.truthProvenance?.staleTruth).toBe(true);
  });
});
