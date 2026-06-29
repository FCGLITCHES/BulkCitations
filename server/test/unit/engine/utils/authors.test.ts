import { describe, expect, it } from 'vitest';
import { parseAuthorSegment } from '../../../../src/engine/utils/authors.js';

describe('author parsing utilities', () => {
  it('splits Vancouver comma-delimited family-initial lists into multiple authors', () => {
    expect(parseAuthorSegment('Rebel A, Schell R')).toEqual([
      expect.objectContaining({ family: 'Rebel', given: 'A' }),
      expect.objectContaining({ family: 'Schell', given: 'R' }),
    ]);
  });

  it('keeps mixed chicago-style comma lists as separate authors instead of pairing adjacent full names', () => {
    expect(parseAuthorSegment('Poese, Matthew E., Robert M. Keolian, Robert W. Smith, Eric C. Mitchell, Cory M. Roberts')).toEqual([
      expect.objectContaining({ family: 'Poese', given: 'Matthew E.' }),
      expect.objectContaining({ family: 'Keolian', given: 'Robert M.' }),
      expect.objectContaining({ family: 'Smith', given: 'Robert W.' }),
      expect.objectContaining({ family: 'Mitchell', given: 'Eric C.' }),
      expect.objectContaining({ family: 'Roberts', given: 'Cory M.' }),
    ]);
  });

  it('keeps a leading inverted author followed by direct-order authors as separate people', () => {
    expect(parseAuthorSegment('Shoar, Kya, Erasmia Lyka, Constantin Coussios, and Robin Cleveland')).toEqual([
      expect.objectContaining({ family: 'Shoar', given: 'Kya' }),
      expect.objectContaining({ family: 'Lyka', given: 'Erasmia' }),
      expect.objectContaining({ family: 'Coussios', given: 'Constantin' }),
      expect.objectContaining({ family: 'Cleveland', given: 'Robin' }),
    ]);
  });

  it('splits direct-order initial lists with hyphenated initials into separate authors', () => {
    expect(parseAuthorSegment('C.-S. Chien, R. Waterhouse, and D. Lubman')).toEqual([
      expect.objectContaining({ family: 'Chien', given: 'C.-S.' }),
      expect.objectContaining({ family: 'Waterhouse', given: 'R.' }),
      expect.objectContaining({ family: 'Lubman', given: 'D.' }),
    ]);
  });

  it('splits direct-order initial lists with multi-initial given names into separate authors', () => {
    expect(parseAuthorSegment('R. Pillai, N. N. Valappil, and D. A. C. Parambil')).toEqual([
      expect.objectContaining({ family: 'Pillai', given: 'R.' }),
      expect.objectContaining({ family: 'Valappil', given: 'N N' }),
      expect.objectContaining({ family: 'Parambil', given: 'D A C' }),
    ]);
  });

  it('treats an organization name containing a comma as one literal author', () => {
    expect(
      parseAuthorSegment('World Health Organization, Department of Mental Health and Substance Abuse'),
    ).toEqual([
      expect.objectContaining({
        isCorporate: true,
        literal: 'World Health Organization, Department of Mental Health and Substance Abuse',
      }),
    ]);
  });

  it('splits a non-Latin (Cyrillic) inverted "Family, Given" name into family and given', () => {
    expect(parseAuthorSegment('Кирчанов, Максим')).toEqual([
      expect.objectContaining({ family: 'Кирчанов', given: 'Максим', isCorporate: false }),
    ]);
  });
});
