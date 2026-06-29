import { describe, expect, it } from 'vitest';
import {
  reconcileConsensus,
  spansFromExpectedFields,
  type ConsensusSpan,
} from './bioConsensus.js';

const span = (label: string, start: number, end: number): ConsensusSpan => ({ label, start, end });

describe('consensus reconciler', () => {
  it('auto-promotes when LLM and model agree on every span', () => {
    const spans = [span('author', 0, 8), span('year', 10, 14), span('title', 16, 30)];
    const result = reconcileConsensus({ llm: spans, model: spans });
    expect(result.decision).toBe('auto_gold');
    expect(result.conflicts).toHaveLength(0);
    expect(result.agreementScore).toBe(1);
    expect(result.agreedSpans).toHaveLength(3);
  });

  it('routes to review when the model misses a span the LLM found', () => {
    const result = reconcileConsensus({
      llm: [span('author', 0, 8), span('doi', 40, 55)],
      model: [span('author', 0, 8)],
    });
    expect(result.decision).toBe('needs_review');
    expect(result.conflicts.some((c) => c.kind === 'missing_in_model' && c.label === 'doi')).toBe(true);
  });

  it('flags a hard label conflict over the same region', () => {
    const result = reconcileConsensus({
      llm: [span('journal', 16, 34)],
      model: [span('book_title', 16, 34)],
    });
    expect(result.decision).toBe('needs_review');
    expect(result.conflicts.some((c) => c.kind === 'label_mismatch')).toBe(true);
  });

  it('tolerates minor boundary drift within threshold', () => {
    // 18/20 char overlap on a 20-char span => IoU ~0.9, above the 0.8 boundary bar.
    const result = reconcileConsensus({
      llm: [span('title', 0, 20)],
      model: [span('title', 0, 18)],
    });
    expect(result.decision).toBe('auto_gold');
    expect(result.conflicts).toHaveLength(0);
  });

  it('flags a boundary that drifts past tolerance', () => {
    const result = reconcileConsensus({
      llm: [span('title', 0, 20)],
      model: [span('title', 0, 11)], // IoU ~0.55, below 0.8
    });
    expect(result.decision).toBe('needs_review');
    expect(result.conflicts.some((c) => c.kind === 'boundary_mismatch')).toBe(true);
  });

  it('requires truth backing when a truth leg is present', () => {
    const agreed = [span('author', 0, 8), span('year', 10, 14)];
    // LLM+model agree, and truth backs both => auto_gold.
    const ok = reconcileConsensus({ llm: agreed, model: agreed, truth: agreed });
    expect(ok.decision).toBe('auto_gold');

    // Truth is missing the year span => the agreed-but-unbacked span is flagged.
    const mismatch = reconcileConsensus({ llm: agreed, model: agreed, truth: [span('author', 0, 8)] });
    expect(mismatch.decision).toBe('needs_review');
    expect(mismatch.conflicts.some((c) => c.kind === 'missing_in_truth')).toBe(true);
  });

  it('derives consensus spans from expected fields through the hardened aligner', () => {
    const raw = 'Smith J. Example study. J Examples. 2020;12(3):44-50.';
    const spans = spansFromExpectedFields(raw, {
      authors: 'Smith J',
      title: 'Example study',
      journal: 'J Examples',
      year: '2020',
      pages: '44-50',
    });
    const labels = spans.map((s) => s.label).sort();
    expect(labels).toContain('author');
    expect(labels).toContain('title');
    expect(labels).toContain('pages');
  });
});
