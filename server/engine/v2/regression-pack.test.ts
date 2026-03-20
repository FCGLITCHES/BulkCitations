import { describe, expect, it } from 'vitest';
import { processV2Conversion } from './pipeline.js';
import { regressionFixtures } from './regressionFixtures.js';

describe('v2 regression pack', () => {
  for (const fixture of regressionFixtures) {
    const runner = fixture.expectedToFail ? it.fails : it;
    runner(fixture.id, async () => {
      const { response } = await processV2Conversion({
        sourceType: 'text',
        content: fixture.references.join('\n\n'),
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: true,
        group: false,
        debug: false,
      });

      if (fixture.expectedDuplicateCount != null) {
        expect(response.stats.duplicate_count).toBe(fixture.expectedDuplicateCount);
        expect(response.duplicates).toHaveLength(fixture.expectedDuplicateCount);
      }

      if (fixture.expectedUniqueCount != null) {
        expect(response.stats.unique_count).toBe(fixture.expectedUniqueCount);
      }

      const merged = response.citations.find((citation) => citation.status === 'merged');
      expect(merged, `${fixture.id} should produce a merged citation`).toBeTruthy();

      if (fixture.expectedMergedTitle) {
        expect(merged?.title.value).toBe(fixture.expectedMergedTitle);
      }

      if (fixture.expectedMergedAuthors) {
        expect(merged?.authors.value.map((author) => author.last)).toEqual(fixture.expectedMergedAuthors);
      }

      if (fixture.forbiddenOutputPatterns?.length) {
        const formattedOutput = response.citations
          .map((citation) => citation.rendered?.formatted ?? '')
          .join('\n');
        for (const pattern of fixture.forbiddenOutputPatterns) {
          expect(formattedOutput).not.toMatch(pattern);
        }
      }
    });
  }
});
