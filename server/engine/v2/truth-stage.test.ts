import { describe, expect, it } from 'vitest';
import { processV2Conversion } from './pipeline.js';
import { computeFingerprint } from '../../store/reportStore.js';
import { saveTruth } from '../../store/truthStore.js';

describe('v2 truth stage', () => {
  it('applies approved truth before render and exposes provenance', async () => {
    const originalText = 'Smith, J. (2020). Broken title. Broken Journal, 1(1), 10-12. https://doi.org/10.5555/v2-truth-stage';
    await saveTruth({
      fingerprint: computeFingerprint(originalText),
      originalText,
      outputStyle: 'apa',
      validatedOutput: 'Smith, J. (2020). Approved title. Approved Journal, 1(1), 10-12.',
      validatedBy: 'tester',
      correctedFields: {
        title: 'Approved title',
        journal: 'Approved Journal',
        doi: '10.5555/v2-truth-stage',
      },
      fieldApproval: {
        title: { approved: true, value: 'Approved title' },
        journal: { approved: true, value: 'Approved Journal' },
        doi: { approved: true, value: '10.5555/v2-truth-stage' },
      },
      sourceReportId: 'v2-truth-stage-1',
      resolvedByVersion: '2.5.0',
    });

    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: originalText,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: true,
      group: false,
      debug: false,
    });

    const citation = response.citations.find((entry) => entry.status === 'active');
    expect(citation?.truth?.truthApplied).toBe(true);
    expect(citation?.truth?.usedValidatedOutput).toBe(true);
    expect(citation?.truth?.truthMatchType).toBe('fingerprint');
    expect(citation?.rendered?.formatted).toBe('Smith, J. (2020). Approved title. Approved Journal, 1(1), 10-12.');
  });
});
