import { describe, it, expect } from 'vitest';
import { normaliseEncoding } from '../server/engine/stages/normaliseEncoding';

describe('Stage 0: Encoding Normalisation', () => {

  it('strips BOM from start of string', () => {
    const withBom = '\uFEFFSmith, J. (2020). Title. Journal, 5(2), 30-40.';
    expect(normaliseEncoding(withBom)).not.toMatch(/^\uFEFF/);
    expect(normaliseEncoding(withBom)).toMatch(/^Smith/);
  });

  it('NFC-normalises diacritics', () => {
    // "Müller" in NFD (M + combining umlaut U+0308) → NFC gives U+00FC (ü)
    const nfd = 'Mu\u0308ller, A. (2021). Title. Journal, 1(1), 1-5.';
    const result = normaliseEncoding(nfd);
    // After NFC: M + U+0308 → Ü (U+00FC)
    expect(result.includes('M\u00FCller') || result.includes('Mu\u0308ller')).toBe(true);
    expect(result).not.toContain('\u0308ller'); // combining character should be absorbed
  });

  it('expands \uFB01 ligature to fi', () => {
    const input = 'Smith, J. (2020). E\uFB01cient parsing. Journal, 5(2), 30-40.';
    const result = normaliseEncoding(input);
    expect(result).not.toContain('\uFB01');
    expect(result).toContain('fi');
  });

  it('expands ﬀ ligature to ff', () => {
    const input = 'A di\uFB00erent approach to citations.';
    expect(normaliseEncoding(input)).toContain('different');
  });

  it('expands ﬂ ligature to fl', () => {
    const input = 'In\uFB02uences on parsing accuracy.';
    expect(normaliseEncoding(input)).toContain('Influences');
  });

  it('expands ﬃ ligature to ffi', () => {
    const input = 'E\uFB03cient algorithms.';
    expect(normaliseEncoding(input)).toContain('Efficient');
  });

  it('replaces curly double quotes with straight double quotes', () => {
    expect(normaliseEncoding('\u201CMachine learning\u201D')).toBe('"Machine learning"');
    expect(normaliseEncoding('\u201ETitle\u201F')).toBe('"Title"');
  });

  it('replaces curly single quotes / apostrophes with straight apostrophe', () => {
    expect(normaliseEncoding('\u2018Exploring urban biodiversity\u2019')).toBe("'Exploring urban biodiversity'");
    expect(normaliseEncoding("O\u2019Brien")).toBe("O'Brien");
  });

  it('replaces en-dash with hyphen (page ranges)', () => {
    const input = 'Moore T. Atmospheric pressure. J. 2019;76(8):2341\u201358.';
    expect(normaliseEncoding(input)).toContain('2341-58');
    expect(normaliseEncoding(input)).not.toContain('\u2013');
  });

  it('replaces em-dash with hyphen', () => {
    const input = 'Title\u2014with em-dash formatting.';
    expect(normaliseEncoding(input)).toContain('Title-with');
    expect(normaliseEncoding(input)).not.toContain('\u2014');
  });

  it('replaces NBSP with regular space', () => {
    const input = 'Smith,\u00A0J.\u00A0(2020).';
    const result = normaliseEncoding(input);
    expect(result).not.toContain('\u00A0');
    expect(result).toContain('Smith, J. (2020).');
  });

  it('replaces zero-width space with regular space', () => {
    const input = 'Smith\u200BJ. (2020).';
    const result = normaliseEncoding(input);
    expect(result).not.toContain('\u200B');
  });

  it('removes soft hyphens', () => {
    const input = 'under\u00ADstanding citation formats.';
    const result = normaliseEncoding(input);
    expect(result).not.toContain('\u00AD');
    expect(result).toContain('understanding');
  });

  it('repairs OCR hard-hyphen line breaks in words', () => {
    const input = 'Smith J. (2018). Understand-\nstatement of the issue. Nature, 550, 46-53.';
    const result = normaliseEncoding(input);
    expect(result).toContain('Understandstatement');
    expect(result).not.toContain('-\n');
  });

  it('strips null bytes', () => {
    const input = 'Smith\x00, J. (2020). Title.';
    expect(normaliseEncoding(input)).not.toContain('\x00');
    expect(normaliseEncoding(input)).toContain('Smith');
  });

  it('strips C0 control characters but preserves newlines', () => {
    const input = 'Smith\x07, J. (2020).\nTitle.';
    const result = normaliseEncoding(input);
    expect(result).not.toContain('\x07');
    expect(result).toContain('\n'); // newlines preserved for preNormalize
  });

  it('handles empty string gracefully', () => {
    expect(normaliseEncoding('')).toBe('');
  });

  it('passes through clean ASCII citation unchanged', () => {
    const clean = 'Smith, J. A., & Doe, R. B. (2021). Machine learning. Journal, 45(3), 123-145.';
    expect(normaliseEncoding(clean)).toBe(clean);
  });

  it('full ugly-pdf pipeline: BOM + ligature + curly quotes + en-dash', () => {
    const ugly = '\uFEFFSmith, J. (2020). E\uFB01cient algorithms for \u201Ccitation\u201D finding. Journal, 5(2), 30\u201340.';
    const result = normaliseEncoding(ugly);
    expect(result).not.toMatch(/^\uFEFF/);
    expect(result).not.toContain('\uFB01'); // ligature expanded
    expect(result).toContain('fi');          // fi present
    expect(result).toContain('"citation"');  // curly → straight
    expect(result).toContain('30-40');        // en-dash → hyphen
  });

});
