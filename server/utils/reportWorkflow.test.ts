import { describe, expect, it } from 'vitest';
import { buildGeneratedRegressionRecord, computeLikelyStageBlame } from './reportWorkflow.js';
import type { CitationReport } from '@shared/schema';

describe('report workflow helpers', () => {
  it('maps split contamination evidence to a strong split stage blame', () => {
    const blame = computeLikelyStageBlame({
      engineVersion: 'v2',
      validationCodes: ['header_bleed_confirmed'],
      qualityFlags: ['split_contamination_confirmed'],
      splitContaminationFlags: ['header_bleed_confirmed'],
      stageLogSummary: [],
    });

    expect(blame?.likelyStage).toBe('split');
    expect(blame?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(blame?.evidence.some((entry) => entry.includes('split'))).toBe(true);
  });

  it('skips generated fixtures for malformed DOI-orphan source reports', () => {
    const report: CitationReport = {
      id: 'report-fixture-1',
      source: 'user',
      originalText: '10.1000/example',
      detectedStyle: 'apa',
      outputStyle: 'apa',
      convertedText: 'Broken',
      failureCategory: 'validation',
      status: 'accepted',
      createdAt: new Date().toISOString(),
      reportCount: 1,
      engineSnapshot: {
        engineVersion: 'v2',
        splitContaminationFlags: ['doi_orphan'],
      },
    };

    const generated = buildGeneratedRegressionRecord(report, 'tester');
    expect(generated.skipped).toBe(true);
    expect(generated.skipReason).toContain('doi_orphan');
  });
});
