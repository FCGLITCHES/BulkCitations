import { describe, expect, it } from 'vitest';
import {
  looksLikeSurnameGivenAlternatingArray,
  parseAuthorsForStyle,
} from './utils.js';

describe('v2 author rescue utilities', () => {
  it('detects alternating surname/given token arrays before canonicalization', () => {
    const tokens = ['Baron', 'Reuben M.', 'Kenny', 'David A.'];
    expect(looksLikeSurnameGivenAlternatingArray(tokens)).toBe(true);
  });

  it('rescues alternating surname/given token arrays into canonical authors', () => {
    const result = parseAuthorsForStyle(['Baron', 'Reuben M.', 'Kenny', 'David A.'], 'auto');
    expect(result.parserMode).toBe('surname_given_pairs');
    expect(result.authors).toHaveLength(2);
    expect(result.authors[0]).toMatchObject({
      last: 'Baron',
      first: 'Reuben M.',
      initials: 'R. M.',
    });
    expect(result.authors[1]).toMatchObject({
      last: 'Kenny',
      first: 'David A.',
      initials: 'D. A.',
    });
  });
});
