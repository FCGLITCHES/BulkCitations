import { describe, expect, it } from 'vitest';
import { analyzeParsedAuthorStrings } from './qualityRules.js';
import {
  fixUnicodeText,
  looksLikeSurnameGivenAlternatingArray,
  normalizeCanonicalAuthor,
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

  it('keeps repaired group authors intact during canonicalization', () => {
    const result = parseAuthorsForStyle(['SHOJI, Mamoru', 'Group, LHD Experiment'], 'apa');

    expect(result.authors.some((author) => author.literal === 'LHD Experiment Group')).toBe(true);
  });

  it('parses compact Vancouver authors with diacritic initials without inverting surname and initials', () => {
    const result = parseAuthorsForStyle(['Pérez-García F', 'López-Martín Á', 'Núñez D'], 'vancouver');

    expect(result.authors).toMatchObject([
      { last: 'Pérez-García', initials: 'F.' },
      { last: 'López-Martín', initials: 'Á.' },
      { last: 'Núñez', initials: 'D.' },
    ]);
  });

  it('treats acronym-led organizations as group authors', () => {
    const result = parseAuthorsForStyle(['UN Women', 'OpenAI'], 'auto');

    expect(result.authors).toMatchObject([
      { literal: 'UN Women', last: 'UN Women' },
      { literal: 'OpenAI', last: 'OpenAI' },
    ]);
  });

  it('splits full-name author blobs joined by and before canonicalization', () => {
    const result = parseAuthorsForStyle(['Reuben M. Baron and David A. Kenny'], 'ieee');

    expect(result.authors).toMatchObject([
      { last: 'Baron', first: 'Reuben M.', initials: 'R. M.' },
      { last: 'Kenny', first: 'David A.', initials: 'D. A.' },
    ]);
  });

  it('expands compact given names with glued trailing initials', () => {
    const result = parseAuthorsForStyle(['Baron, ReubenM. and Kenny, DavidA.'], 'harvard');

    expect(result.authors).toMatchObject([
      { last: 'Baron', first: 'Reuben M.', initials: 'R. M.' },
      { last: 'Kenny', first: 'David A.', initials: 'D. A.' },
    ]);
  });

  it('does not misclassify complete surnames as single-character tails', () => {
    const analysis = analyzeParsedAuthorStrings(['World Health Organization', 'OpenAI']);

    expect(analysis.singleCharacterTailCount).toBe(0);
  });

  it('still flags standalone trailing initials when they are present', () => {
    const analysis = analyzeParsedAuthorStrings(['Smith, J', 'Doe, A.']);

    expect(analysis.singleCharacterTailCount).toBe(2);
  });

  it('repairs common mojibake in author names and locators', () => {
    expect(fixUnicodeText('LÃ³pez')).toBe('López');
    expect(fixUnicodeText('MÃ¼ller')).toBe('Müller');
    expect(fixUnicodeText('Oâ€™Connor')).toBe("O'Connor");
    expect(fixUnicodeText('98â€“652')).toBe('98-652');
  });

  it('collapses split acronym-led group authors back into a literal institutional author', () => {
    const author = normalizeCanonicalAuthor({
      first: 'IBM',
      last: 'Research Team',
      initials: 'I. B. M.',
    });

    expect(author).toMatchObject({
      first: null,
      last: 'IBM Research Team',
      initials: null,
      literal: 'IBM Research Team',
    });
  });
});
