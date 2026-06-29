import { describe, expect, it } from 'vitest';
import {
  fixEndOfLineHyphens,
  looksLikePdfCopy,
  mergeSoftLineBreaks,
  phase1Ingest,
  stripPdfArtifacts,
} from '../../../../src/engine/phases/phase1Ingest.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';

describe('phase1Ingest', () => {
  it('profiles numbered text batches and detects DOIs', async () => {
    const ctx = createTestPipelineContext();
    const result = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
          '[2] Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
        ].join('\n'),
      },
      ctx,
    );

    expect(result.detectedFormat).toBe('numbered_list');
    expect(result.structure).toBe('semi_structured');
    expect(result.estimatedCount).toBe(2);
    expect(result.detectedDois).toEqual(['10.1000/xyz123']);
    expect(result.hasDois).toBe(true);
    expect(ctx.stageLog.at(-1)?.status).toBe('success');
  });

  it('treats explicit doi_list input as structured', async () => {
    const ctx = createTestPipelineContext();
    const result = await phase1Ingest.run(
      {
        sourceType: 'doi_list',
        content: ['10.1000/alpha', '10.1000/beta', '10.1000/gamma'].join('\n'),
      },
      ctx,
    );

    expect(result.detectedFormat).toBe('doi_list');
    expect(result.structure).toBe('structured');
    expect(result.estimatedCount).toBe(3);
    expect(result.detectedDois).toEqual(['10.1000/alpha', '10.1000/beta', '10.1000/gamma']);
  });

  it('accepts pdf source type and returns a file-upload marker envelope', async () => {
    const ctx = createTestPipelineContext();

    const result = await phase1Ingest.run(
      {
        sourceType: 'pdf',
        content: 'pretend pdf bytes',
      },
      ctx,
    );

    expect(result.sourceType).toBe('pdf');
    expect(result.structure).toBe('unknown');
    expect(result.ingestionSignals.isPdfExtracted).toBe(true);
  });

  it('recognizes bib source type as bibtex format', async () => {
    const ctx = createTestPipelineContext();
    const result = await phase1Ingest.run(
      {
        sourceType: 'bib',
        content: [
          '@article{gomes2022,',
          '  title = {Machine learning applied to healthcare: a conceptual review},',
          '}',
        ].join('\n'),
      },
      ctx,
    );

    expect(result.detectedFormat).toBe('bibtex');
    expect(result.structure).toBe('structured');
  });

  it('recognizes ris source type as ris format', async () => {
    const ctx = createTestPipelineContext();
    const result = await phase1Ingest.run(
      {
        sourceType: 'ris',
        content: [
          'TY  - JOUR',
          'TI  - Example title',
          'ER  -',
        ].join('\n'),
      },
      ctx,
    );

    expect(result.detectedFormat).toBe('ris');
    expect(result.structure).toBe('structured');
  });

  it('requires at least two PDF-ish signals before cleanup is considered', () => {
    const pdfLike = [
      'Smith, J. (2020). Example arti-',
      'cle. Journal of Examples,',
      '12(3), 44-50.',
      'Doe, A. (2021). Another arti-',
      'cle. Example Review,',
      '9(1), 1-10.',
    ].join('\n');
    const safe = [
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
      'Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
      'Brown, K. (2019). Third article. Science Today, 5(2), 12-18.',
      'Lee, P. (2018). Fourth article. Example Quarterly, 3(1), 1-5.',
    ].join('\n');

    expect(looksLikePdfCopy(pdfLike)).toBe(true);
    expect(looksLikePdfCopy(safe)).toBe(false);
  });

  it('repairs alphabetic line-end hyphenation but leaves identifier-like cases alone', () => {
    expect(fixEndOfLineHyphens('bench-\nmark').text).toBe('benchmark');
    expect(fixEndOfLineHyphens('COVID-\n19').text).toBe('COVID-\n19');
  });

  it('merges soft line breaks but preserves numbered citation boundaries', () => {
    const merged = mergeSoftLineBreaks([
      'Smith, J. (2020). Example article.',
      'Journal of Examples, 12(3), 44-50.',
      '[2] Doe, A. (2021). Another article.',
      'Example Review, 9(1), 1-10.',
    ].join('\n'));

    expect(merged.text).toContain('Example article. Journal of Examples');
    expect(merged.text).toContain('\n[2] Doe, A. (2021). Another article.');
  });

  it('strips only standalone PDF artifact lines', () => {
    const stripped = stripPdfArtifacts([
      '47',
      'Page 5',
      '•',
      'Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17',
      '17 of 17References',
      '[1] Smith, J. (2020). Example article.',
      '2024',
    ].join('\n'));

    expect(stripped.text).toContain('[1] Smith, J. (2020). Example article.');
    expect(stripped.text).toContain('2024');
    expect(stripped.text).not.toContain('47');
    expect(stripped.text).not.toContain('Page 5');
    expect(stripped.text).not.toContain('•');
    expect(stripped.text).not.toContain('Cureus 15(8)');
    expect(stripped.text).not.toContain('17 of 17References');
  });
});
