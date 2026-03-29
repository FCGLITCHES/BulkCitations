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

  it('starts a new citation when an APA thesis opener begins with a lowercase surname particle after a boundary', () => {
    const raw = [
      'Qiao, M., and D. L. Jindrich. "Compensations during Unsteady Locomotion." Integrative and Comparative Biology, vol. 54, no. 6, 2014, pp. 1109-1121. doi: 10.1093/icb/icu058',
      '',
      'de Oliveira, Wagner (2021). Simulação para a avaliação do desempenho do sistema de proteção de distância de uma linha de transmissão de 500 KV [Doctoral dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.2012.899614',
    ].join('\n');

    const chunks = splitRawReferenceBlock(raw, []);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.splitArtifact.cleanedChunk).toContain('de Oliveira, Wagner (2021)');
    expect(chunks[1]?.splitArtifact.cleanedChunk).toContain('Universidade Estadual de Campinas');
  });

  it('starts a new citation after a blank boundary when a publisher-led book is followed by a Vancouver author run', () => {
    const raw = [
      'Darwin C. On the origin of species by means of natural selection. London: John Murray; 1859.',
      '',
      'Page MJ, McKenzie JE, Bossuyt PM, Boutron I, Hoffmann TC, Mulrow CD, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ. 2021;372:n71. doi:10.1136/bmj.n71',
    ].join('\n');

    const chunks = splitRawReferenceBlock(raw, []);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.splitArtifact.cleanedChunk).toContain('On the origin of species');
    expect(chunks[1]?.splitArtifact.cleanedChunk).toContain('The PRISMA 2020 statement');
    expect(chunks[1]?.splitArtifact.cleanedChunk).not.toContain('John Murray');
  });
});
