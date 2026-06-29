import { describe, expect, it } from 'vitest';
import {
  applySubmit,
  buildVerifiedRow,
  rankReviewQueue,
  reviewPriority,
  reviewRowId,
  validateSpans,
  type ReviewRow,
  type ReviewSubmission,
} from './bioReviewQueue.js';

const row = (raw: string, overrides: Partial<ReviewRow> = {}): ReviewRow => ({
  raw_text: raw,
  entity_fields: [],
  entity_starts: [],
  entity_ends: [],
  ...overrides,
});

describe('BIO review queue ranking', () => {
  it('prioritises needs_review and unresolved fields', () => {
    const clean = row('clean ref', { entity_fields: ['author', 'title', 'year'] });
    const flagged = row('flagged ref', { needs_review: true, unprojected_fields: ['publisher', 'journal'] });
    const ranked = rankReviewQueue([clean, flagged]);
    expect(ranked[0]!.raw_text).toBe('flagged ref');
    expect(ranked[0]!.priority).toBeGreaterThan(ranked[1]!.priority);
  });

  it('assigns a stable id from the raw text', () => {
    expect(reviewRowId({ raw_text: 'abc' })).toBe(reviewRowId({ raw_text: 'abc' }));
    expect(reviewPriority(row('x', { needs_review: true }))).toBeGreaterThanOrEqual(1000);
  });
});

describe('BIO review submission', () => {
  const raw = 'Smith J. A title. Journal. 2020.';
  const base: ReviewSubmission = {
    id: reviewRowId({ raw_text: raw }),
    decision: 'approve',
    raw_text: raw,
    entity_fields: ['author', 'title', 'year'],
    entity_starts: [0, 9, 27],
    entity_ends: [8, 16, 31],
    stratum: 'doi_heavy',
  };

  it('builds a verified gold row with texts sliced from offsets', () => {
    const verified = buildVerifiedRow(base);
    expect(verified.trust_level).toBe('gold');
    expect(verified.provenance).toBe('human_verified');
    expect(verified.entity_texts).toEqual([raw.slice(0, 8), raw.slice(9, 16), raw.slice(27, 31)]);
  });

  it('approve removes the row from the inbox and resolves it as gold', () => {
    const inbox = [row(raw, { needs_review: true }), row('other ref')];
    const result = applySubmit(inbox, base);
    expect(result.outcome).toBe('approved');
    expect(result.inbox).toHaveLength(1);
    expect(result.inbox[0]!.raw_text).toBe('other ref');
    expect(result.resolved?.trust_level).toBe('gold');
  });

  it('reject removes the row but keeps it for logging', () => {
    const inbox = [row(raw)];
    const result = applySubmit(inbox, { ...base, decision: 'reject' });
    expect(result.outcome).toBe('rejected');
    expect(result.inbox).toHaveLength(0);
    expect(result.resolved?.raw_text).toBe(raw);
  });

  it('reports not_found for an unknown id', () => {
    const result = applySubmit([row('a')], { ...base, id: 'nonexistent' });
    expect(result.outcome).toBe('not_found');
  });

  it('validateSpans rejects out-of-range and mismatched offsets', () => {
    expect(validateSpans(base)).toBeNull();
    expect(validateSpans({ ...base, entity_ends: [8, 16] })).toMatch(/length mismatch/);
    expect(validateSpans({ ...base, entity_starts: [0, 9, 999] })).toMatch(/invalid offsets/);
  });
});
