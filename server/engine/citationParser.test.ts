import { describe, expect, it } from 'vitest';
import { CitationParser } from './citationParser.js';

describe('citation parser protected-token and group-author regressions', () => {
  const parser = new CitationParser();
  const parseAuthorList = (parser as any).parseAuthorList.bind(parser) as (authorString: string, style: string) => string[];
  const normalizeParsedReference = (parser as any).normalizeParsedReference.bind(parser) as (
    parsed: Record<string, unknown>,
    style: string,
    rawText?: string,
  ) => Record<string, unknown>;

  it('keeps The PRISMA Group intact in mixed APA-style author lists', () => {
    const authors = parseAuthorList(
      'Moher, D., Liberati, A., Tetzlaff, J., Altman, D. G., The PRISMA Group',
      'apa',
    );

    expect(authors).toContain('The PRISMA Group');
  });

  it('normalizes fragmented LHD group-author variants into one organization name', () => {
    const authors = parseAuthorList('SHOJI, Mamoru, Group, LHD Experiment', 'apa');

    expect(authors).toContain('LHD Experiment Group');
  });

  it('preserves protected title tokens such as U-Net during normalization', () => {
    const normalized = normalizeParsedReference(
      {
        title: 'U-Convolutional Networks for Biomedical Image Segmentation',
      },
      'mla',
      'Ronneberger, O., Fischer, P., and Brox, T. "U-Net: Convolutional Networks for Biomedical Image Segmentation."',
    );

    expect(normalized.title).toBe('U-Net: Convolutional Networks for Biomedical Image Segmentation');
  });

  it('promotes bare article locators into article-number instead of pages', () => {
    const normalized = normalizeParsedReference(
      {
        pages: 'n71',
      },
      'chicago',
      'Page, M. J. et al. The PRISMA 2020 statement. BMJ, vol. 372, 2021, pp. n71.',
    );

    expect(normalized['article-number']).toBe('n71');
    expect(normalized.pages).toBeUndefined();
  });

  it('normalizes protected venue names such as BMJ', () => {
    const normalized = normalizeParsedReference(
      {
        journal: 'British Medical Journal',
      },
      'chicago',
      'Moher, D. et al. Preferred reporting items for systematic reviews and meta-analyses: the PRISMA statement. BMJ, 339, b2535.',
    );

    expect(normalized.journal).toBe('BMJ');
  });
});
