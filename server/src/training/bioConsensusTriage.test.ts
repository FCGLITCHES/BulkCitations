import { describe, expect, it } from 'vitest';
import { triageRow, triageRows, truthSpansForRow } from './bioConsensusTriage.js';
import type { ConsensusSpan } from './bioConsensus.js';
import type { ReviewRow } from './bioReviewQueue.js';

const row = (overrides: Partial<ReviewRow> = {}): ReviewRow => ({
  raw_text: 'Smith J. A title. Journal. 2020.',
  entity_fields: ['author', 'title', 'journal', 'year'],
  entity_starts: [0, 9, 19, 28],
  entity_ends: [7, 16, 26, 32],
  ...overrides,
});

const spans = (r: ReviewRow): ConsensusSpan[] =>
  r.entity_fields.map((label, i) => ({ label, start: r.entity_starts[i]!, end: r.entity_ends[i]! }));

describe('consensus triage', () => {
  it('auto-promotes when the model agrees with the trusted projection', async () => {
    const r = row();
    const result = await triageRow(r, async (raw) => spans(row({ raw_text: raw })));
    expect(result.decision).toBe('auto_gold');
    expect(result.modelAvailable).toBe(true);
  });

  it('routes to review when the model disagrees', async () => {
    const r = row();
    const result = await triageRow(r, async () => [{ label: 'author', start: 0, end: 7 }]); // model missed 3 spans
    expect(result.decision).toBe('needs_review');
  });

  it('fail-safe: keeps rows in review when the model vote is unavailable', async () => {
    const result = await triageRow(row(), async () => null);
    expect(result.decision).toBe('needs_review');
    expect(result.modelAvailable).toBe(false);
  });

  it('can opt into promoting without a model vote', async () => {
    const result = await triageRow(row(), async () => null, undefined, { autoGoldWithoutModel: true });
    expect(result.decision).toBe('auto_gold');
  });

  it('partitions a batch and stamps auto-gold rows as consensus gold', async () => {
    const good = row({ raw_text: 'Doe A. Other. Venue. 2019.', entity_fields: ['author'], entity_starts: [0], entity_ends: [6] });
    const bad = row();
    const summary = await triageRows(
      [good, bad],
      async (raw) => (raw.startsWith('Doe') ? [{ label: 'author', start: 0, end: 6 }] : [{ label: 'author', start: 0, end: 7 }]),
    );
    expect(summary.autoGold).toHaveLength(1);
    expect(summary.needsReview).toHaveLength(1);
    expect(summary.autoGold[0]!.trust_level).toBe('gold');
    expect(summary.autoGold[0]!.provenance).toContain('consensus');
  });

  it('derives truth spans from entity arrays', () => {
    const result = truthSpansForRow(row());
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ label: 'author', start: 0, end: 7 });
  });
});
