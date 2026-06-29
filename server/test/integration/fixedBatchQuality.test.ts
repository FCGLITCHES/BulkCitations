import { describe, expect, it } from 'vitest';
import { buildFixedBatchQualityReport } from '../../src/diagnostics/fixedBatchQualityReport.js';
import {
  FIXED_SMOKE_CORPUS_EXPECTED_COUNT,
  FIXED_SMOKE_CORPUS_GATES,
  FIXED_SMOKE_CORPUS_INPUT,
  FIXED_SMOKE_CORPUS_SEGMENTS,
} from '../fixtures/fixedSmokeCorpus.js';

describe('fixed smoke corpus quality', () => {
  it('splits the combined fixed corpus into the expected reference count', async () => {
    const report = await buildFixedBatchQualityReport(FIXED_SMOKE_CORPUS_INPUT, {
      label: 'fixed_smoke_corpus_split',
      expectedCount: FIXED_SMOKE_CORPUS_EXPECTED_COUNT,
    });

    expect(report.referenceCount).toBe(FIXED_SMOKE_CORPUS_EXPECTED_COUNT);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.total).toBe(FIXED_SMOKE_CORPUS_EXPECTED_COUNT);
  });

  it('meets smoke gates on the full fixed corpus', async () => {
    const report = await buildFixedBatchQualityReport(FIXED_SMOKE_CORPUS_INPUT, {
      label: 'fixed_smoke_corpus_gates',
      expectedCount: FIXED_SMOKE_CORPUS_EXPECTED_COUNT,
    });

    expect(report.statusPercent.ready).toBeGreaterThanOrEqual(FIXED_SMOKE_CORPUS_GATES.minReadyPercent);
    expect(report.statusPercent.needs_review).toBeLessThanOrEqual(FIXED_SMOKE_CORPUS_GATES.maxNeedsReviewPercent);
    expect(report.statusPercent.needs_action).toBeLessThanOrEqual(FIXED_SMOKE_CORPUS_GATES.maxNeedsActionPercent);
    expect(report.parseQuality).toBeGreaterThanOrEqual(FIXED_SMOKE_CORPUS_GATES.minParseQuality);
  });

  it('reports segment-level readiness for Cureus and numbered mixed-style batches', async () => {
    const segmentReports = await Promise.all(
      FIXED_SMOKE_CORPUS_SEGMENTS.map((segment) => buildFixedBatchQualityReport(segment.input, {
        label: segment.id,
        expectedCount: segment.expectedCount,
      })),
    );

    const cureus = segmentReports.find((report) => report.label === 'cureus_drug_discovery');
    const numbered = segmentReports.find((report) => report.label === 'numbered_mixed_style_regression');

    expect(cureus?.referenceCount).toBe(FIXED_SMOKE_CORPUS_SEGMENTS[0].expectedCount);
    expect(numbered?.referenceCount).toBe(FIXED_SMOKE_CORPUS_SEGMENTS[1].expectedCount);

    expect(cureus?.statusCounts.ready ?? 0).toBeGreaterThan(0);
    expect(numbered?.statusCounts.ready ?? 0).toBeGreaterThan(0);
  });
});
