import { describe, expect, it } from 'vitest';
import {
  buildCandidateRow,
  degradeText,
  mapCrossrefItem,
  renderCitation,
  type NormalizedReference,
} from './referenceCorpus.js';

const CROSSREF_SAMPLE = {
  type: 'journal-article',
  author: [
    { family: 'Smith', given: 'Jane A.' },
    { family: 'Doe', given: 'Robert' },
  ],
  title: ['Deep learning for citation parsing'],
  'container-title': ['Journal of Machine Learning'],
  issued: { 'date-parts': [[2019, 5]] },
  volume: '12',
  issue: '3',
  page: '44-58',
  DOI: '10.1000/jml.2019.0044',
  publisher: 'Example Press',
};

describe('reference corpus building', () => {
  it('maps a Crossref item into a normalized reference', () => {
    const ref = mapCrossrefItem(CROSSREF_SAMPLE);
    expect(ref.authors).toEqual([
      { family: 'Smith', given: 'Jane A.' },
      { family: 'Doe', given: 'Robert' },
    ]);
    expect(ref.year).toBe('2019');
    expect(ref.journal).toBe('Journal of Machine Learning');
    expect(ref.pages).toBe('44-58');
    expect(ref.type).toBe('article-journal');
  });

  it('renders and auto-projects a clean candidate row with verified offsets', () => {
    const ref = mapCrossrefItem(CROSSREF_SAMPLE);
    const raw = renderCitation(ref, 0);
    const row = buildCandidateRow(raw, ref, { stratum: 'doi_heavy', split: 'train', provenance: 'crossref:test' });

    // Every emitted span's offsets must slice back to its text.
    row.entity_starts.forEach((start, i) => {
      expect(raw.slice(start, row.entity_ends[i]!)).toBe(row.entity_texts[i]);
    });
    expect(row.entity_fields).toContain('author');
    expect(row.entity_fields).toContain('title');
    expect(row.entity_fields).toContain('doi');
    // Two authors => two author spans.
    expect(row.entity_fields.filter((f) => f === 'author')).toHaveLength(2);
  });

  it('recovers most spans even after punctuation-stripping degradation', () => {
    const ref = mapCrossrefItem(CROSSREF_SAMPLE);
    const clean = renderCitation(ref, 1);
    const messy = degradeText(clean, 'strip_punct');
    const row = buildCandidateRow(messy, ref, { stratum: 'missing_punctuation', split: 'train', provenance: 'crossref:test' });

    expect(messy).not.toContain(';');
    // Title and journal survive punctuation stripping and still project.
    expect(row.entity_fields).toContain('title');
    row.entity_starts.forEach((start, i) => {
      expect(messy.slice(start, row.entity_ends[i]!)).toBe(row.entity_texts[i]);
    });
  });

  it('flags fields that cannot be projected instead of dropping them', () => {
    const ref: NormalizedReference = {
      authors: [{ family: 'Roe', given: 'B.' }],
      title: 'A study',
      publisher: 'Missing Publisher House',
    };
    // raw_text omits the publisher entirely.
    const row = buildCandidateRow('Roe B. A study.', ref, { stratum: 'books', split: 'train', provenance: 'unit' });
    expect(row.needs_review).toBe(true);
    expect(row.unprojected_fields).toContain('publisher');
  });

  it('pdf_wrap degradation injects a line break', () => {
    const out = degradeText('Smith J. A reasonably long citation title here. Journal. 2020.', 'pdf_wrap');
    expect(out).toContain('\n');
  });
});
