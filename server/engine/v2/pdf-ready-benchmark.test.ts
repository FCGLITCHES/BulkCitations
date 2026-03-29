import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPdfReadyBenchmark } from './pdfReadyBenchmark.js';

type BaselineManifest = {
  corpusHash: string;
  corpusSize: number;
  snapshot: {
    countIntegrityPct: number;
    requiredFieldsPct: number;
    doiRetentionPct: number;
    nearReadyReviewPct: number;
    singleLinkPct: number;
    incompatibleFieldOverlapPct: number;
  };
};

function readBaseline(filePath: string): BaselineManifest {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BaselineManifest & {
    thresholds?: Partial<BaselineManifest['snapshot']> & { readyPct?: number };
    observed?: Partial<BaselineManifest['snapshot']>;
  };
  return {
    corpusHash: parsed.corpusHash,
    corpusSize: parsed.corpusSize,
    snapshot: parsed.snapshot ?? parsed.observed ?? {
      countIntegrityPct: parsed.thresholds?.countIntegrityPct ?? 0,
      requiredFieldsPct: parsed.thresholds?.requiredFieldsPct ?? 0,
      doiRetentionPct: parsed.thresholds?.doiRetentionPct ?? 0,
      nearReadyReviewPct: 0,
      singleLinkPct: 0,
      incompatibleFieldOverlapPct: 0,
    },
  };
}

const BASELINE_PATHS = {
  pdf_upload: path.resolve(process.cwd(), 'scripts', 'data', 'pdf-upload-baseline.json'),
  pdf_copy_paste: path.resolve(process.cwd(), 'scripts', 'data', 'pdf-copypaste-baseline.json'),
} as const;

describe('v2 PDF ready benchmark', () => {
  it('builds unique upload and copy-paste corpuses and stays above the frozen PDF floors', async () => {
    const report = await runPdfReadyBenchmark();

    expect(report.modes).toHaveLength(2);
    for (const mode of report.modes) {
      const baselinePath = BASELINE_PATHS[mode.mode];
      expect(fs.existsSync(baselinePath)).toBe(true);
      const baseline = readBaseline(baselinePath);

      expect(mode.corpusSize).toBeGreaterThan(0);
      expect(mode.duplicateInputCount).toBe(0);
      expect(mode.corpusHash).toBe(baseline.corpusHash);
      expect(mode.corpusSize).toBe(baseline.corpusSize);
      expect(mode.metrics.countIntegrityPct).toBeGreaterThanOrEqual(baseline.snapshot.countIntegrityPct);
      expect(mode.metrics.requiredFieldsPct).toBeGreaterThanOrEqual(baseline.snapshot.requiredFieldsPct);
      expect(mode.metrics.doiRetentionPct).toBeGreaterThanOrEqual(baseline.snapshot.doiRetentionPct);
      expect(mode.metrics.nearReadyReviewPct).toBeGreaterThanOrEqual(baseline.snapshot.nearReadyReviewPct);
      expect(mode.metrics.singleLinkPct).toBeGreaterThanOrEqual(baseline.snapshot.singleLinkPct);
      expect(mode.metrics.incompatibleFieldOverlapPct).toBeLessThanOrEqual(baseline.snapshot.incompatibleFieldOverlapPct);
      expect(mode.metrics.falseReadyPct).toBe(0);
      expect(mode.metrics.corruptReviewPct).toBe(0);
    }
  }, 300000);
});
