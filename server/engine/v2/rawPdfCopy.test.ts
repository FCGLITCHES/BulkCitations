import { describe, expect, it } from 'vitest';
import { canonicalizePotentialDoi, pdfCopyAllowlistKeys } from './rawPdfCopy.js';

describe('raw PDF-copy helper contracts', () => {
  it('keeps the span-level PDF-copy allowlist keys unique', () => {
    const keys = pdfCopyAllowlistKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('canonicalizes DOI-like strings after spacing repair without decoding percent escapes', () => {
    expect(canonicalizePotentialDoi('10 .1080 /02678373.2010.50680')).toBe('10.1080/02678373.2010.50680');
    expect(canonicalizePotentialDoi('https://doi.org/10.1000/example%2Fencoded')).toBe('10.1000/example%2Fencoded');
  });
});
