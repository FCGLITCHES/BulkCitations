import { describe, expect, it } from 'vitest';
import { ocrFoldKey, recoverDoi } from '../../../../src/engine/ingestion/ocrFold.js';

describe('ocrFoldKey', () => {
  it('produces the same key for an OCR-corrupted string and its clean form', () => {
    // m<->rn, o<->0, l<->1, e<->c
    expect(ocrFoldKey('Communication')).toBe(ocrFoldKey('Cornrnunication'));
    expect(ocrFoldKey('Journal of Biology')).toBe(ocrFoldKey('J0urna1 0f Bi0l0gy'));
  });

  it('collapses an OCR-damaged identifier to the clean key', () => {
    expect(ocrFoldKey('10.1353')).toBe(ocrFoldKey('1O.l353'));
  });

  it('drops punctuation and whitespace', () => {
    expect(ocrFoldKey('A, B.  C')).toBe(ocrFoldKey('ABC'));
  });
});

describe('recoverDoi', () => {
  it('returns an already-clean DOI verbatim', () => {
    expect(recoverDoi('See 10.1353/imp.2011.0081 for details')).toBe('10.1353/imp.2011.0081');
  });

  it('recovers a registrant corrupted by OCR (letters in digit positions)', () => {
    // "1O.l353" -> "10.1353"; clean suffix preserved
    expect(recoverDoi('1O.l353/imp.2011.0081')).toBe('10.1353/imp.2011.0081');
  });

  it('preserves a legitimate alphabetic suffix (does not over-fold)', () => {
    // Nature-style suffix "s41586-..." must stay intact (s is real, not OCR 5).
    expect(recoverDoi('10.1038/s41586-021-03491-6')).toBe('10.1038/s41586-021-03491-6');
  });

  it('strips trailing punctuation', () => {
    expect(recoverDoi('(10.1145/3292500).')).toBe('10.1145/3292500');
  });

  it('returns null when there is no DOI', () => {
    expect(recoverDoi('Smith, J. (2020). A title. Journal, 4(2), 1-10.')).toBeNull();
  });
});
