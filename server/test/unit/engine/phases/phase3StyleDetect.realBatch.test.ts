import { describe, expect, it } from 'vitest';
import { buildProfiledTextEnvelope } from '../../../../src/engine/phases/phase1Ingest.js';
import { phase2Split } from '../../../../src/engine/phases/phase2Split.js';
import { phase3StyleDetect } from '../../../../src/engine/phases/phase3StyleDetect.js';
import {
  CUREUS_DRUG_DISCOVERY_BATCH_INPUT,
  CUREUS_DRUG_DISCOVERY_BATCH_STYLE_EXPECTATIONS,
  EXPECTED_CUREUS_DRUG_DISCOVERY_BATCH_BLOCK_COUNT,
} from '../../../fixtures/cureusDrugDiscoveryBatch.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';

describe('phase3StyleDetect real-world biomedical batch corpus', () => {
  it('keeps representative Cureus batch citations stable through split and style detection', async () => {
    const ctx = createTestPipelineContext();
    const { envelope } = buildProfiledTextEnvelope('text', CUREUS_DRUG_DISCOVERY_BATCH_INPUT, {
      enableScoredDetection: true,
    });

    const split = await phase2Split.run(envelope, ctx);
    const carriers = await phase3StyleDetect.run(split.blocks, ctx);

    expect(split.blocks).toHaveLength(EXPECTED_CUREUS_DRUG_DISCOVERY_BATCH_BLOCK_COUNT);
    expect(carriers).toHaveLength(EXPECTED_CUREUS_DRUG_DISCOVERY_BATCH_BLOCK_COUNT);

    for (const expectation of CUREUS_DRUG_DISCOVERY_BATCH_STYLE_EXPECTATIONS) {
      const carrier = carriers.find((item) => item.raw.includes(expectation.snippet));

      expect(carrier, `missing block for ${expectation.snippet}`).toBeDefined();
      expect(carrier?.style.family).toBe(expectation.expectedFamily);
      expect(carrier?.style.primary.style).toBe(expectation.expectedStyle);
    }
  });
});
