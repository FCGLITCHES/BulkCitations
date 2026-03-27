import { describe, expect, it } from 'vitest';
import { processV2Conversion } from './pipeline.js';
import { regressionFixtures } from './regressionFixtures.js';

const STYLE_SOURCE_FIXTURE_IDS = new Set([
  'mla-book-source-type-regression',
  'mla-journal-style-regression',
  'mla-website-source-type-regression',
  'mla-book-chapter-source-type-regression',
  'chicago-book-style-regression',
  'chicago-journal-style-regression',
  'chicago-book-chapter-source-type-regression',
  'chicago-website-source-type-regression',
  'harvard-book-style-regression',
  'harvard-journal-style-regression',
  'harvard-website-source-type-regression',
  'ieee-book-source-type-regression',
  'ieee-conference-style-regression',
  'vancouver-report-source-type-regression',
]);

describe('v2 style/source regression fixtures', () => {
  it('keeps the reported style-detection and source-type cases stable', async () => {
    const fixtures = regressionFixtures.filter((fixture) => STYLE_SOURCE_FIXTURE_IDS.has(fixture.id));

    expect(fixtures.length).toBe(STYLE_SOURCE_FIXTURE_IDS.size);

    for (const fixture of fixtures) {
      const { response } = await processV2Conversion({
        sourceType: 'text',
        content: fixture.references.join('\n\n'),
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: false,
        group: false,
        debug: false,
      }, {
        executionMode: 'sync',
      });

      const activeCitation = response.citations.find((citation) => citation.status === 'active');
      expect(activeCitation, `${fixture.id} should produce an active citation`).toBeTruthy();

      if (fixture.expectedDetectedStyle) {
        expect(activeCitation?.detectedStyle.value).toBe(fixture.expectedDetectedStyle);
      }

      if (fixture.expectedReferenceType) {
        expect(activeCitation?.referenceType).toBe(fixture.expectedReferenceType);
      }

      if (fixture.expectedOutputIncludes?.length) {
        for (const snippet of fixture.expectedOutputIncludes) {
          expect(activeCitation?.rendered?.formatted ?? '').toContain(snippet);
        }
      }

      if (fixture.forbiddenOutputPatterns?.length) {
        const output = activeCitation?.rendered?.formatted ?? '';
        for (const pattern of fixture.forbiddenOutputPatterns) {
          expect(output).not.toMatch(pattern);
        }
      }
    }
  });
});
