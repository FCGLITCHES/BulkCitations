import { describe, expect, it } from 'vitest';
import { createDefaultAdapters } from './adapters.js';

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
});
