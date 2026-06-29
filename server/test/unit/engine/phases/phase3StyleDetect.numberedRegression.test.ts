import { describe, expect, it } from 'vitest';
import { buildProfiledTextEnvelope } from '../../../../src/engine/phases/phase1Ingest.js';
import { phase2Split } from '../../../../src/engine/phases/phase2Split.js';
import { phase3StyleDetect } from '../../../../src/engine/phases/phase3StyleDetect.js';
import {
  EXPECTED_NUMBERED_MIXED_STYLE_REGRESSION_BLOCK_COUNT,
  NUMBERED_MIXED_STYLE_REGRESSION_CASES,
  NUMBERED_MIXED_STYLE_REGRESSION_INPUT,
} from '../../../fixtures/numberedMixedStyleRegressionBatch.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';

describe('phase3StyleDetect numbered mixed-style regression corpus', () => {
  it('keeps numbered cross-style journal references style-stable through split and detection', async () => {
    const ctx = createTestPipelineContext();
    const { envelope } = buildProfiledTextEnvelope('text', NUMBERED_MIXED_STYLE_REGRESSION_INPUT, {
      enableScoredDetection: true,
    });

    const split = await phase2Split.run(envelope, ctx);
    const carriers = await phase3StyleDetect.run(split.blocks, ctx);

    expect(split.blocks).toHaveLength(EXPECTED_NUMBERED_MIXED_STYLE_REGRESSION_BLOCK_COUNT);
    expect(carriers).toHaveLength(EXPECTED_NUMBERED_MIXED_STYLE_REGRESSION_BLOCK_COUNT);
    expect(carriers.every((carrier) => carrier.style.isMultiStyle)).toBe(true);

    for (const expectation of NUMBERED_MIXED_STYLE_REGRESSION_CASES) {
      const carrier = carriers.find((item) => item.raw === expectation.citation);

      expect(carrier, `missing block for ${expectation.citation}`).toBeDefined();
      expect(
        carrier?.style.family,
        `family mismatch for ${expectation.citation} (${expectation.failureMode})`,
      ).toBe(expectation.expectedFamily);
      expect(
        carrier?.style.primary.style,
        `style mismatch for ${expectation.citation} (${expectation.failureMode})`,
      ).toBe(expectation.expectedStyle);
    }
  });
});
