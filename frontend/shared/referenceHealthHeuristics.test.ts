import { describe, expect, it } from 'vitest';
import { hasMalformedAuthorShape } from './referenceHealthHeuristics';

describe('hasMalformedAuthorShape', () => {
  it('flags standalone ampersand separators', () => {
    expect(hasMalformedAuthorShape(['Smith & Doe'])).toBe(true);
    expect(hasMalformedAuthorShape(['Smith, J. & Doe, A.'])).toBe(true);
  });

  it('does not flag normal author entries without malformed separators', () => {
    expect(hasMalformedAuthorShape(['Smith, J.', 'Doe, A.'])).toBe(false);
  });
});

