import { describe, expect, it } from 'vitest';
import { createDefaultAdapters } from './adapters.js';
import { parseAuthorsForStyle } from './utils.js';

const extractor = createDefaultAdapters().extractor;

describe('default extractor institutional heuristics', () => {
  it('extracts corporate report references into title, year, and institution', async () => {
    const result = await extractor.extract(
      'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['World Health Organization']);
    expect(result.parsed.title).toBe('Global tuberculosis report 2023');
    expect(result.parsed.year).toBe('2023');
    expect(result.parsed.publisher).toBe('World Health Organization');
    expect(result.parsed.institution).toBe('World Health Organization');
    expect(result.fieldConfidence.authors).toBeGreaterThanOrEqual(0.9);
    expect(result.fieldConfidence.publisher).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps guideline identifiers out of the main title', async () => {
    const result = await extractor.extract(
      'National Institute for Health and Care Excellence. Depression in adults: treatment and management. NICE Guideline [NG222]. London: NICE; 2022.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.title).toBe('Depression in adults: treatment and management');
    expect(result.parsed.edition).toBe('NICE Guideline [NG222]');
    expect(result.parsed.publisher).toBe('NICE');
    expect(result.parsed.year).toBe('2022');
  });

  it('extracts website-like institutional references with available-from URLs', async () => {
    const result = await extractor.extract(
      'OpenAI. GPT-5.1 system card. 2026. Available from: https://openai.com/research/gpt-5-1.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('website');
    expect(result.parsed.authors).toEqual(['OpenAI']);
    expect(result.parsed.title).toBe('GPT-5.1 system card');
    expect(result.parsed.year).toBe('2026');
    expect(result.parsed.url).toBe('https://openai.com/research/gpt-5-1');
    expect(result.fieldConfidence.authors).toBeGreaterThanOrEqual(0.9);
  });

  it('treats title-led website references as titles instead of inventing corporate authors', async () => {
    const result = await extractor.extract(
      'Intelligent clinical trials. (2020). https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.parsed.title).toBe('Intelligent clinical trials');
    expect(result.parsed.year).toBe('2020');
    expect(result.parsed.url).toBe('https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-');
    expect(result.parsed.authors ?? []).toHaveLength(0);
  });

  it('extracts two-word institutional report authors instead of collapsing them into the title', async () => {
    const result = await extractor.extract(
      'United Nations. The sustainable development goals report 2023. New York: United Nations; 2023.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['United Nations']);
    expect(result.parsed.title).toBe('The sustainable development goals report 2023');
    expect(result.parsed.publisher).toBe('United Nations');
    expect(result.parsed.year).toBe('2023');
  });

  it('keeps guideline-like report titles as titles instead of misclassifying them as metadata', async () => {
    const result = await extractor.extract(
      'European Medicines Agency. Guideline on medical literature monitoring. Amsterdam: EMA; 2020.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.parsed.authors).toEqual(['European Medicines Agency']);
    expect(result.parsed.title).toBe('Guideline on medical literature monitoring');
    expect(result.parsed.publisher).toBe('EMA');
    expect(result.parsed.year).toBe('2020');
  });

  it('extracts acronym-led organizations and preserves their report titles', async () => {
    const result = await extractor.extract(
      'UN Women. Progress of the world’s women 2019–2020: families in a changing world. New York: UN Women; 2019.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['UN Women']);
    expect(result.parsed.title).toBe("Progress of the world's women 2019-2020: families in a changing world");
    expect(result.parsed.publisher).toBe('UN Women');
    expect(result.parsed.year).toBe('2019');
  });

  it('keeps version metadata separate from handbook titles in institutional book-like references', async () => {
    const result = await extractor.extract(
      'Cochrane Collaboration. Cochrane handbook for systematic reviews of interventions. Version 6.3; 2022.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('book');
    expect(result.parsed.authors).toEqual(['Cochrane Collaboration']);
    expect(result.parsed.title).toBe('Cochrane handbook for systematic reviews of interventions');
    expect(result.parsed.edition).toBe('Version 6.3');
    expect(result.parsed.year).toBe('2022');
  });

  it('repairs mojibake before extraction so diacritics and page ranges survive parsing', async () => {
    const result = await extractor.extract(
      'LÃ³pez, C., FernÃ¡ndez, J., & RamÃ­rez, E. (2010). Mrna vaccine technology: mechanisms and applications. Cell, 70(7), 113â€“730. https://doi.org/10.1007/s10994-021-06047-x',
      'auto',
      {},
    );

    const canonicalAuthors = parseAuthorsForStyle(result.parsed.authors ?? [], 'apa').authors;

    expect(canonicalAuthors).toMatchObject([
      { last: 'López', initials: 'C.' },
      { last: 'Fernández', initials: 'J.' },
      { last: 'Ramírez', initials: 'E.' },
    ]);
    expect(result.parsed.pages).toBe('113-730');
  });

  it('keeps acronym-led group authors intact after extractor pre-normalization', async () => {
    const result = await extractor.extract(
      'IBM Research Team (2019). Explainable artificial intelligence: a systematic review. Environmental Science & Technology, 63(3), 98â€“652. https://doi.org/10.1001/jama.2021.1234',
      'auto',
      {},
    );

    const canonicalAuthors = parseAuthorsForStyle(result.parsed.authors ?? [], 'apa').authors;

    expect(canonicalAuthors).toContainEqual(expect.objectContaining({
      literal: 'IBM Research Team',
      last: 'IBM Research Team',
    }));
    expect(result.parsed.pages).toBe('98-652');
  });

  it('rescues Vancouver-style author-colon-title references into structured journal metadata', async () => {
    const result = await extractor.extract(
      'Skalic M, Jiménez J, Sabbadin D, De Fabritiis G: Shape-based generative modeling for de novo drug design. J Chem Inf Model. 2019, 59:1205-14. 10.1021/acs.jcim.8b00706',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('journal');
    expect(result.parsed.authors).toEqual(['Skalic M', 'Jiménez J', 'Sabbadin D', 'De Fabritiis G']);
    expect(result.parsed.title).toBe('Shape-based generative modeling for de novo drug design');
    expect(result.parsed.journal).toBe('J Chem Inf Model');
    expect(result.parsed.year).toBe('2019');
    expect(result.parsed.volume).toBe('59');
    expect(result.parsed.pages).toBe('1205-14');
    expect(result.parsed.doi).toBe('10.1021/acs.jcim.8b00706');
  });

  it('prioritizes strong colon-led Vancouver detection even when the input is numbered and multiline', async () => {
    const result = await extractor.extract(
      '16. Skalic M, Jiménez J, Sabbadin D, De Fabritiis G: Shape-based generative modeling for de novo drug design . J\nChem Inf Model. 2019, 59:1205-14. 10.1021/acs.jcim.8b00706',
      'auto',
      {},
    );

    expect(result.parsed.authors).toEqual(['Skalic M', 'Jiménez J', 'Sabbadin D', 'De Fabritiis G']);
    expect(result.parsed.title).toBe('Shape-based generative modeling for de novo drug design');
    expect(result.parsed.journal).toBe('J Chem Inf Model');
    expect(result.parsed.year).toBe('2019');
    expect(result.fieldConfidence.authors).toBeGreaterThanOrEqual(0.88);
  });

  it('repairs broken year-volume tails and hyphen-wrapped DOIs before journal extraction', async () => {
    const natMed = await extractor.extract(
      'Cruz Rivera S, Liu X, Chan AW, Denniston AK, Calvert MJ: Guidelines for clinical trial protocols for interventions involving artificial intelligence: the SPIRIT-AI extension. Nat Med. 2020â€, 26:1351-6â€3. 10.1038/s41591-020-1037-7',
      'auto',
      {},
    );
    expect(natMed.referenceType).toBe('journal');
    expect(natMed.parsed.title).toBe('Guidelines for clinical trial protocols for interventions involving artificial intelligence: the SPIRIT-AI extension');
    expect(natMed.parsed.journal).toBe('Nat Med');
    expect(natMed.parsed.year).toBe('2020');
    expect(natMed.parsed.volume).toBe('26');
    expect(natMed.parsed.pages).toBe('1351-63');
    expect(natMed.parsed.doi).toBe('10.1038/s41591-020-1037-7');

    const splitDoi = await extractor.extract(
      'Rodríguez-Pérez R, Bajorath J: Evolution of support vector machine and regression modeling in chemoinformatics and drug discovery. J Comput Aided Mol Des. 2022, 36:355-62. 10.1007/s10822-022- 00442-9',
      'auto',
      {},
    );
    expect(splitDoi.referenceType).toBe('journal');
    expect(splitDoi.parsed.title).toBe('Evolution of support vector machine and regression modeling in chemoinformatics and drug discovery');
    expect(splitDoi.parsed.journal).toBe('J Comput Aided Mol Des');
    expect(splitDoi.parsed.year).toBe('2022');
    expect(splitDoi.parsed.volume).toBe('36');
    expect(splitDoi.parsed.pages).toBe('355-62');
    expect(splitDoi.parsed.doi).toBe('10.1007/s10822-022-00442-9');
  });
});
