import { describe, expect, it } from 'vitest';
import { analyzeParsedAuthorStrings } from './qualityRules.js';
import { getRequirementProfile, normalizeLocatorValue } from './qualityRules.js';
import {
  fixUnicodeText,
  looksLikeSurnameGivenAlternatingArray,
  normalizeDoiValue,
  normalizeCanonicalAuthor,
  parseAuthorsForStyle,
} from './utils.js';
import { classifyLocatorToken } from '../shared/citationSemantics.js';
import { postCslCleanup } from './stages/render.js';

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

  it('does not collapse compact Vancouver author arrays into alternating surname-given pairs', () => {
    const result = parseAuthorsForStyle(['Skalic M', 'Jiménez J', 'Sabbadin D', 'De Fabritiis G'], 'auto');

    expect(result.authors).toMatchObject([
      { last: 'Skalic', initials: 'M.' },
      { last: 'Jiménez', initials: 'J.' },
      { last: 'Sabbadin', initials: 'D.' },
      { last: 'de Fabritiis', initials: 'G.' },
    ]);
  });

  it('expands compact given names with glued trailing initials', () => {
    const result = parseAuthorsForStyle(['Baron, ReubenM. and Kenny, DavidA.'], 'harvard');

    expect(result.authors).toMatchObject([
      { last: 'Baron', first: 'Reuben M.', initials: 'R. M.' },
      { last: 'Kenny', first: 'David A.', initials: 'D. A.' },
    ]);
  });

  it('expands compact initial clusters in inverted harvard author strings', () => {
    const result = parseAuthorsForStyle(['Ceci, SJ and Bruck, M'], 'harvard');

    expect(result.authors).toMatchObject([
      { last: 'Ceci', initials: 'S. J.' },
      { last: 'Bruck', initials: 'M.' },
    ]);
  });

  it('recombines comma-heavy inverted full-name author blobs before canonicalization', () => {
    const result = parseAuthorsForStyle([
      'Flanders, Corey E., Wright, Mya, Khandpur, Saachi, Kuhn, Sara, Anderson, RaeAnn E., Robinson, Margaret, VanKim, Nicole',
    ], 'apa');

    expect(result.authors).toMatchObject([
      { last: 'Flanders', first: 'Corey E.', initials: 'C. E.' },
      { last: 'Wright', first: 'Mya', initials: 'M.' },
      { last: 'Khandpur', first: 'Saachi', initials: 'S.' },
      { last: 'Kuhn', first: 'Sara', initials: 'S.' },
      { last: 'Anderson', first: 'RaeAnn E.', initials: 'R. E.' },
      { last: 'Robinson', first: 'Margaret', initials: 'M.' },
      { last: 'VanKim', first: 'Nicole', initials: 'N.' },
    ]);
  });

  it('does not misclassify complete surnames as single-character tails', () => {
    const analysis = analyzeParsedAuthorStrings(['World Health Organization', 'OpenAI']);

    expect(analysis.singleCharacterTailCount).toBe(0);
  });

  it('does not penalize compact Vancouver author lists as trailing single-character tails', () => {
    const analysis = analyzeParsedAuthorStrings(['Yang S', 'Hwang D', 'Lee S', 'Ryu S', 'Hwang SJ']);

    expect(analysis.singleCharacterTailCount).toBe(0);
    expect(analysis.compactVancouverCount).toBe(5);
    expect(analysis.contaminatedBlobCount).toBe(0);
  });

  it('still flags standalone trailing initials when they are present', () => {
    const analysis = analyzeParsedAuthorStrings(['Smith, J', 'Doe, A.']);

    expect(analysis.singleCharacterTailCount).toBe(2);
  });

  it('detects author blobs that leak title and source content into the author field', () => {
    const analysis = analyzeParsedAuthorStrings([
      'Skalic M, Jiménez J, Sabbadin D, De Fabritiis G: Shape-based generative modeling for de novo drug design. J Chem Inf Model. 2019, 59:1205-14. 10.1021/acs.jcim.8b00706',
    ]);

    expect(analysis.contaminatedBlobCount).toBe(1);
    expect(analysis.mergedBlobCount).toBeGreaterThanOrEqual(1);
  });

  it('strips DOI leakage from page locators before they reach downstream phases', () => {
    expect(normalizeLocatorValue('1205-14. 10.1021/acs.jcim.8b00706')).toBe('1205-14');
    expect(normalizeLocatorValue('pp. 659-668 doi:10.1080/14740338.2023.2228197')).toBe('659-668');
  });

  it('does not treat venue as a required field for journal citations', () => {
    expect(getRequirementProfile('journal').required).toEqual(['authors', 'title', 'year']);
    expect(getRequirementProfile('journal').expected).toContain('venue');
  });

  it('cleans repeated punctuation while preserving author initials followed by commas', () => {
    expect(postCslCleanup('Smith, J.,. Example title.. BMJ,, 2020;;')).toBe('Smith, J., Example title. BMJ, 2020;');
  });

  it('reorders obviously descending page ranges while preserving common shortened ranges', () => {
    expect(normalizeLocatorValue('120-90')).toBe('90-120');
    expect(normalizeLocatorValue('e148-e137')).toBe('e137-e148');
    expect(normalizeLocatorValue('355-62')).toBe('355-62');
    expect(normalizeLocatorValue('1947-99')).toBe('1947-99');
  });

  it('repairs common mojibake in author names and locators', () => {
    expect(fixUnicodeText('LÃ³pez')).toBe('López');
    expect(fixUnicodeText('MÃ¼ller')).toBe('Müller');
    expect(fixUnicodeText('Oâ€™Connor')).toBe("O'Connor");
    expect(fixUnicodeText('98â€“652')).toBe('98-652');
    expect(fixUnicodeText('2â€013')).toBe('2013');
    expect(fixUnicodeText('2020â€, 26:1351-6â€3.')).toBe('2020, 26:1351-63.');
    expect(fixUnicodeText('ADME￾Tox prediction')).toBe('ADMETox prediction');
  });

  it('keeps global unicode cleanup conservative while still fixing low-risk PDF-copy spacing artifacts', () => {
    expect(fixUnicodeText('Journal of Applied P sychology, 35(5), 307–311.')).toBe('Journal of Applied P sychology, 35(5), 307-311.');
    expect(fixUnicodeText('S pringer.')).toBe('S pringer.');
    expect(fixUnicodeText('h ttps://doi.org/10.1080/02678373.2010.50680')).toBe('https://doi.org/10.1080/02678373.2010.50680');
    expect(fixUnicodeText('The Lancet Psychiatry, 7, 8 40–841.')).toBe('The Lancet Psychiatry, 7, 840-841.');
    expect(fixUnicodeText('Cross- sectional and longitudinal predictions')).toBe('Cross-sectional and longitudinal predictions');
    expect(fixUnicodeText('Research methods for applied psychology (2nd e d., pp. 164–177).')).toBe('Research methods for applied psychology (2nd ed., pp. 164-177).');
    expect(fixUnicodeText('A guide to research practice')).toBe('A guide to research practice');
    expect(fixUnicodeText('T cells in adaptive immunity')).toBe('T cells in adaptive immunity');
    expect(fixUnicodeText('Nomofobia y el nivel productividad de las organizaciones')).toBe('Nomofobia y el nivel productividad de las organizaciones');
    expect(fixUnicodeText('DEVELOPING A MQL VALVE')).toBe('DEVELOPING A MQL VALVE');
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

  it('preserves valid DOI suffix parentheses in historical DOI formats', () => {
    expect(normalizeDoiValue('10.1016/0030-4018(76)90095-x')).toBe('10.1016/0030-4018(76)90095-x');
    expect(normalizeDoiValue('https://doi.org/10.1016/0030-4018(76)90095-x)')).toBe('10.1016/0030-4018(76)90095-x');
  });

  it('treats dotted alphanumeric proceedings and abstract locators as article numbers', () => {
    expect(classifyLocatorToken('FM2B.2')).toEqual({ kind: 'article-number', value: 'FM2B.2' });
    expect(classifyLocatorToken('chin.200104012')).toEqual({ kind: 'article-number', value: 'chin.200104012' });
    expect(classifyLocatorToken('V002T29A056')).toEqual({ kind: 'article-number', value: 'V002T29A056' });
  });

  it('keeps uppercase unicode surnames as surnames instead of exploding them into initials', () => {
    const result = parseAuthorsForStyle(['COŞKUN, D.'], 'apa');

    expect(result.authors).toMatchObject([
      { last: 'COŞKUN', initials: 'D.' },
    ]);
  });

  it('preserves particle surnames in inverted author strings', () => {
    const result = parseAuthorsForStyle(['da Silva, V. L.'], 'harvard');

    expect(result.authors).toMatchObject([
      { last: 'da Silva', initials: 'V. L.' },
    ]);
  });
});
