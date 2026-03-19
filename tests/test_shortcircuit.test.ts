import { describe, it, expect } from 'vitest';
import { detectStructuredInput } from '../server/engine/stages/detectStructuredInput';

describe('Stage 2: Structured Input Detection', () => {

  // ── DOI ──

  it('detects a bare DOI', () => {
    const result = detectStructuredInput('10.1038/s41586-021-03819-2');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('doi');
    expect(result!.payload).toBe('10.1038/s41586-021-03819-2');
  });

  it('detects a https://doi.org/ URL', () => {
    const result = detectStructuredInput('https://doi.org/10.1016/j.cell.2020.10.023');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('doi');
    expect(result!.payload).toBe('10.1016/j.cell.2020.10.023');
  });

  it('detects a dx.doi.org URL', () => {
    const result = detectStructuredInput('https://dx.doi.org/10.1145/3290605.3300400');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('doi');
  });

  it('does NOT treat a full citation with a DOI as a DOI-only input', () => {
    const fullCitation = 'Smith, J. A. (2021). Machine learning. Nature, 521, 436. https://doi.org/10.1038/nature14539';
    const result = detectStructuredInput(fullCitation);
    // Should be null — DOI is embedded, not the primary input
    expect(result).toBeNull();
  });

  it('strips trailing period from bare DOI', () => {
    const result = detectStructuredInput('10.1038/nature14539.');
    expect(result).not.toBeNull();
    expect(result!.payload).not.toMatch(/\.$/);
  });

  // ── PMID ──

  it('detects PMID: prefix', () => {
    const result = detectStructuredInput('PMID: 12345678');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pmid');
    expect(result!.payload).toBe('12345678');
  });

  it('detects PMID without space', () => {
    const result = detectStructuredInput('PMID:12345678');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pmid');
    expect(result!.payload).toBe('12345678');
  });

  it('detects PubMed ID prefix', () => {
    const result = detectStructuredInput('PubMed ID: 9999999');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pmid');
  });

  // ── BibTeX ──

  it('detects @article BibTeX', () => {
    const bibtex = '@article{smith2021,\n  title={Machine Learning},\n  author={Smith, J.},\n  year={2021}\n}';
    const result = detectStructuredInput(bibtex);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('bibtex');
  });

  it('detects @book BibTeX', () => {
    const bibtex = '@book{jones2019,\n  title={Research Methods},\n  author={Jones, B.},\n  year={2019},\n  publisher={Academic Press}\n}';
    const result = detectStructuredInput(bibtex);
    expect(result!.type).toBe('bibtex');
  });

  it('detects @inproceedings BibTeX', () => {
    const bibtex = '@inproceedings{vaswani2017,\n  title={Attention Is All You Need}\n}';
    const result = detectStructuredInput(bibtex);
    expect(result!.type).toBe('bibtex');
  });

  // ── RIS ──

  it('detects RIS format', () => {
    const ris = 'TY  - JOUR\nAU  - Smith, John\nTI  - Machine learning\nPY  - 2021\nER  - ';
    const result = detectStructuredInput(ris);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('ris');
  });

  it('detects RIS book type', () => {
    const ris = 'TY  - BOOK\nAU  - Jones, B.\nTI  - Research Methods\nPY  - 2019\nER  - ';
    const result = detectStructuredInput(ris);
    expect(result!.type).toBe('ris');
  });

  // ── CSL-JSON ──

  it('detects CSL-JSON object', () => {
    const csl = JSON.stringify({ type: 'article-journal', title: 'Machine Learning', author: [] });
    const result = detectStructuredInput(csl);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('csl-json');
  });

  it('detects CSL-JSON array', () => {
    const cslArray = JSON.stringify([{ type: 'article-journal', title: 'ML', id: 'ref1' }]);
    const result = detectStructuredInput(cslArray);
    expect(result!.type).toBe('csl-json');
  });

  it('does NOT treat a JSON without title as CSL-JSON', () => {
    const nonCsl = JSON.stringify({ key: 'value', other: 123 });
    const result = detectStructuredInput(nonCsl);
    expect(result).toBeNull();
  });

  // ── Negative cases ──

  it('returns null for a normal APA citation', () => {
    expect(detectStructuredInput('Smith, J. A. (2021). Title. Journal, 45(3), 123-145.')).toBeNull();
  });

  it('returns null for a Vancouver citation', () => {
    expect(detectStructuredInput('LeCun Y, Bengio Y. Deep learning. Nature. 2015;521:436-44.')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectStructuredInput('')).toBeNull();
  });

  it('returns null for very short string', () => {
    expect(detectStructuredInput('hi')).toBeNull();
  });

});
