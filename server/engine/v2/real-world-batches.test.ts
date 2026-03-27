import { afterEach, describe, expect, it } from 'vitest';
import { REAL_WORLD_BATCH_FIXTURES } from './fixtures/realWorldBatchFixtures.js';
import { processV2Conversion } from './pipeline.js';

describe('v2 real-world batch regressions', () => {
  afterEach(() => {
    delete process.env.ENABLE_LLM_EXTRACTOR;
    delete process.env.ENABLE_GROBID_EXTRACTOR;
  });

  for (const fixture of REAL_WORLD_BATCH_FIXTURES) {
    it(`keeps ${fixture.label} structurally stable`, async () => {
      process.env.ENABLE_LLM_EXTRACTOR = '0';
      process.env.ENABLE_GROBID_EXTRACTOR = '0';

      const { response } = await processV2Conversion({
        sourceType: 'text',
        content: fixture.content,
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: false,
        group: false,
        debug: true,
      }, {
        executionMode: 'sync',
      });

      expect(response.stats.input_count).toBe(fixture.expectedCount);
      expect(response.citations).toHaveLength(fixture.expectedCount);
      expect(response.citations.every((citation) => citation.raw.trim().length > 0)).toBe(true);
      expect(response.citations.filter((citation) => (citation.rendered?.formatted ?? '').trim().length > 0)).toHaveLength(fixture.expectedCount);

      for (const expectation of fixture.expectations) {
        const citation = response.citations[expectation.citationIndex];
        expect(citation).toBeTruthy();
        if (expectation.rawStartsWith) {
          expect(citation?.raw).toMatch(new RegExp(`^${expectation.rawStartsWith.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        }
        if (expectation.renderedIncludes) {
          expect(citation?.rendered?.formatted).toContain(expectation.renderedIncludes);
        }
        if (expectation.referenceType) {
          expect(citation?.referenceType).toBe(expectation.referenceType);
        }
      }

      const splitDebug = response.debug?.citations.map((citation) => citation.stages.split).filter(Boolean) ?? [];
      expect(splitDebug.length).toBeGreaterThan(0);
    });
  }
});
