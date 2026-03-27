import { describe, expect, it } from 'vitest';
import { canonicalizePotentialDoi, pdfCopyAllowlistKeys, splitRawReferenceBlock } from './rawPdfCopy.js';

describe('raw PDF-copy helper contracts', () => {
  it('keeps the span-level PDF-copy allowlist keys unique', () => {
    const keys = pdfCopyAllowlistKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('canonicalizes DOI-like strings after spacing repair without decoding percent escapes', () => {
    expect(canonicalizePotentialDoi('10 .1080 /02678373.2010.50680')).toBe('10.1080/02678373.2010.50680');
    expect(canonicalizePotentialDoi('https://doi.org/10.1000/example%2Fencoded')).toBe('10.1000/example%2Fencoded');
  });

  it('starts a new citation after a blank boundary for Vancouver-style author runs with Unicode names', () => {
    const raw = [
      'Wangerin, G, 1986. Darstellungsarten. In Bauaufnahme, pp.124-130. Vieweg+Teubner Verlag. https://doi.org/10.1007/978-3-322-89462-5_15',
      '',
      'Montagnon F, Saïd S, Lepine J. Lithium: poisonings and suicide prevention. European Psychiatry. 2002;17(2):92-95. doi:10.1016/S0924-9338(02)00633-8',
    ].join('\n');

    const chunks = splitRawReferenceBlock(raw, []);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.splitArtifact.cleanedChunk).toContain('Darstellungsarten');
    expect(chunks[1]?.splitArtifact.cleanedChunk).toContain('Lithium: poisonings and suicide prevention');
  });

  it('starts a new citation after a blank boundary for single-author publisher-led books', () => {
    const raw = [
      'Schlosser, M and Hartmann, J, 1976. 2-Alkenyl anions and their surprising endo preference. Journal of the American Chemical Society, 98(15), pp.4674-4676. https://doi.org/10.1021/ja00431a040',
      '',
      'Ackermann J. Abtastregelung. Springer Berlin Heidelberg; 1983. doi:10.1007/978-3-662-11022-5',
    ].join('\n');

    const chunks = splitRawReferenceBlock(raw, []);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.splitArtifact.cleanedChunk).toContain('Abtastregelung');
  });

  it('starts a new citation after a blank boundary for IEEE-style mixed author ordering', () => {
    const raw = [
      'Citerio G, Giussani C, Sax H, Pittet D, Wen X, Kellum JA, Mills AM, Panebianco NL, Flechner SM, Carlet J. Infectious Sources of Sepsis. In: Encyclopedia of Intensive Care Medicine. pp. 1230-1230. Springer Berlin Heidelberg; 2012. doi:10.1007/978-3-642-00418-6_1748',
      '',
      'W B Clee and P R Hunter, "Hepatitis B in general practice: epidemiology, clinical and serological features, and control.," BMJ, vol. 295, no. 6597, pp. 530-533, 1987, doi:10.1136/bmj.295.6597.530.',
    ].join('\n');

    const chunks = splitRawReferenceBlock(raw, []);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.splitArtifact.cleanedChunk).toContain('Hepatitis B in general practice');
  });
});
