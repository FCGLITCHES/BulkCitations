import {
  CUREUS_DRUG_DISCOVERY_BATCH_INPUT,
  EXPECTED_CUREUS_DRUG_DISCOVERY_BATCH_BLOCK_COUNT,
} from './cureusDrugDiscoveryBatch.js';
import {
  EXPECTED_NUMBERED_MIXED_STYLE_REGRESSION_BLOCK_COUNT,
  NUMBERED_MIXED_STYLE_REGRESSION_INPUT,
} from './numberedMixedStyleRegressionBatch.js';

export const FIXED_SMOKE_CORPUS_SEGMENTS = [
  {
    id: 'cureus_drug_discovery',
    label: 'Cureus drug-discovery bibliography (Vancouver-style, PDF noise)',
    expectedCount: EXPECTED_CUREUS_DRUG_DISCOVERY_BATCH_BLOCK_COUNT,
    input: CUREUS_DRUG_DISCOVERY_BATCH_INPUT,
  },
  {
    id: 'numbered_mixed_style_regression',
    label: 'Numbered mixed-style regression batch (APA/IEEE/Vancouver/MLA/Chicago/Harvard)',
    expectedCount: EXPECTED_NUMBERED_MIXED_STYLE_REGRESSION_BLOCK_COUNT,
    input: NUMBERED_MIXED_STYLE_REGRESSION_INPUT,
  },
] as const;

export type FixedSmokeCorpusSegmentId = (typeof FIXED_SMOKE_CORPUS_SEGMENTS)[number]['id'];

export const FIXED_SMOKE_CORPUS_INPUT = FIXED_SMOKE_CORPUS_SEGMENTS
  .map((segment) => segment.input.trim())
  .join('\n\n');

export const FIXED_SMOKE_CORPUS_EXPECTED_COUNT = FIXED_SMOKE_CORPUS_SEGMENTS.reduce(
  (sum, segment) => sum + segment.expectedCount,
  0,
);

/**
 * Smoke gates for CI — update when intentional parser-quality changes land.
 * Baseline verified 2026-06-22: 112 refs, 87.5% ready, 12.5% needs_action, parseQuality 94.
 */
export const FIXED_SMOKE_CORPUS_GATES = {
  minReferenceCount: FIXED_SMOKE_CORPUS_EXPECTED_COUNT,
  maxDroppedCount: 0,
  minReadyPercent: 85,
  minParseQuality: 92,
  maxNeedsReviewPercent: 32,
  maxNeedsActionPercent: 13,
} as const;
