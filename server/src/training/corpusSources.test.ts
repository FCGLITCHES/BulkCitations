import { describe, expect, it } from 'vitest';
import { mapOpenAlexItem, mapWikipediaArticle, STRATUM_PLAN } from './corpusSources.js';
import { buildCandidateRow, renderCitation } from './referenceCorpus.js';

describe('OpenAlex mapping', () => {
  it('maps an OpenAlex work into a normalized reference', () => {
    const ref = mapOpenAlexItem({
      type: 'article',
      title: 'Étude multilingue des citations',
      publication_year: 2021,
      language: 'fr',
      doi: 'https://doi.org/10.1234/abc',
      authorships: [
        { author: { display_name: 'Jean Pierre Dupont' } },
        { author: { display_name: 'Marie Claire' } },
      ],
      primary_location: { source: { display_name: 'Revue de Test' } },
      biblio: { volume: '5', issue: '2', first_page: '10', last_page: '20' },
    });
    expect(ref.authors).toEqual([
      { family: 'Dupont', given: 'Jean Pierre' },
      { family: 'Claire', given: 'Marie' },
    ]);
    expect(ref.year).toBe('2021');
    expect(ref.journal).toBe('Revue de Test');
    expect(ref.pages).toBe('10-20');
    expect(ref.doi).toBe('10.1234/abc');
    expect(ref.type).toBe('article-journal');
    expect(ref.title).toBe('Étude multilingue des citations');
  });

  it('declares a source plan for every documented stratum', () => {
    expect(STRATUM_PLAN.multilingual?.source).toBe('openalex');
    expect(STRATUM_PLAN.webpages?.source).toBe('wikipedia');
    expect(STRATUM_PLAN.missing_punctuation?.degrade).toBe('strip_punct');
    expect(STRATUM_PLAN.doi_heavy?.source).toBe('crossref');
  });
});

describe('Wikipedia webpage mapping', () => {
  const article = {
    normalizedtitle: 'Theory of relativity',
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Theory_of_relativity' } },
  };

  it('maps a Wikipedia article into a webpage reference', () => {
    const ref = mapWikipediaArticle(article, 'June 23, 2026');
    expect(ref.type).toBe('webpage');
    expect(ref.title).toBe('Theory of relativity');
    expect(ref.siteName).toBe('Wikipedia');
    expect(ref.accessedDate).toBe('June 23, 2026');
    expect(ref.url).toContain('en.wikipedia.org');
    expect(ref.authors).toHaveLength(0);
  });

  it('renders and projects a webpage row (no author) with verified offsets', () => {
    const ref = mapWikipediaArticle(article, 'June 23, 2026');
    const raw = renderCitation(ref);
    const row = buildCandidateRow(raw, ref, { stratum: 'webpages', split: 'holdout', provenance: 'wikipedia:test' });
    expect(row.entity_fields).toContain('site_name');
    expect(row.entity_fields).toContain('accessed_date');
    expect(row.entity_fields).toContain('url');
    row.entity_starts.forEach((start, i) => {
      expect(raw.slice(start, row.entity_ends[i]!)).toBe(row.entity_texts[i]);
    });
  });
});
