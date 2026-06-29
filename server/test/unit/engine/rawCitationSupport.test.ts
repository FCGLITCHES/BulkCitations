import { describe, expect, it } from 'vitest';

import {
  buildRawCitationSupport,
  findBestYearMatch,
  normalizeExtractionInput,
} from '../../../src/engine/rawCitationSupport.js';

describe('rawCitationSupport', () => {
  it('normalizes raw text and strips trailing identifier tails once for downstream parsing', () => {
    const support = buildRawCitationSupport(
      '[1] Internet Engineering Task Force. “The WebSocket Protocol.” RFC Editor. https://www.rfc-editor.org/rfc/rfc6455 PMID: 32002124',
    );

    expect(support.normalizedRaw).toBe(
      '[1] Internet Engineering Task Force. "The WebSocket Protocol." RFC Editor. https://www.rfc-editor.org/rfc/rfc6455 PMID: 32002124',
    );
    expect(support.parseableRaw).toBe(
      '[1] Internet Engineering Task Force. "The WebSocket Protocol." RFC Editor',
    );
    expect(support.quotedTitle?.title).toBe('The WebSocket Protocol.');
  });

  it('prefers early parenthetical years for author-date citations', () => {
    const yearMatch = findBestYearMatch(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
      'author_date',
    );

    expect(yearMatch?.year).toBe(2020);
    expect(yearMatch?.index).toBeGreaterThan(0);
  });

  it('prefers trailing locator years for numeric citations', () => {
    const normalized = normalizeExtractionInput(
      '[1] Example study. Journal of Examples. 2021 Sep 12;16(4):949-959.',
    );
    const yearMatch = findBestYearMatch(normalized, 'numeric');

    expect(yearMatch?.year).toBe(2021);
  });
});
