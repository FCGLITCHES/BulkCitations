import { describe, expect, it } from 'vitest';
import { candidateToBioRow, type SpanRow } from './bioRowConvert.js';

describe('candidate -> BIO gold conversion', () => {
  const row: SpanRow = {
    raw_text: 'Smith J, Doe A. A title. Journal. 2020.',
    entity_fields: ['author', 'author', 'title', 'journal', 'year'],
    entity_starts: [0, 9, 16, 25, 34],
    entity_ends: [7, 14, 23, 32, 38],
    expected_type: 'article-journal',
    stratum: 'doi_heavy',
  };

  it('produces aligned bio_tokens and bio_tags', () => {
    const bio = candidateToBioRow(row)!;
    expect(bio.bio_tokens.length).toBe(bio.bio_tags.length);
    expect(bio.bio_tags).toContain('B-author');
    expect(bio.bio_tags).toContain('B-title');
    expect(bio.label_schema_version).toBe('citation-bio-v1');
    expect(bio.input_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives each adjacent same-label span its own B- start', () => {
    const bio = candidateToBioRow(row)!;
    // Two separate authors => two B-author tags.
    expect(bio.bio_tags.filter((tag) => tag === 'B-author')).toHaveLength(2);
  });

  it('returns null when nothing is labelable', () => {
    expect(candidateToBioRow({ raw_text: '', entity_fields: [], entity_starts: [], entity_ends: [] })).toBeNull();
    expect(candidateToBioRow({ raw_text: 'no spans here', entity_fields: [], entity_starts: [], entity_ends: [] })).toBeNull();
  });
});
