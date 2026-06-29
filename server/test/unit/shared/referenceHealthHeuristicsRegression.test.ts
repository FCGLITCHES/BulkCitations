import { describe, expect, it } from 'vitest';
import { hasMalformedAuthorShape } from '../../../../frontend/shared/referenceHealthHeuristics.js';

describe('reference health heuristics regression', () => {
  it('flags standalone ampersands in author values', () => {
    expect(hasMalformedAuthorShape(['Smith & Doe'])).toBe(true);
    expect(hasMalformedAuthorShape(['Smith, J. & Doe, A.'])).toBe(true);
  });

  it('keeps normal author values valid', () => {
    expect(hasMalformedAuthorShape(['Smith, J.', 'Doe, A.'])).toBe(false);
  });
});
