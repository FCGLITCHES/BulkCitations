/**
 * Consensus reconciler — the minimal-admin gate.
 *
 * Three independent signals vote on the BIO labelling of a reference:
 *   1. the LLM pre-label (GPT-5.4 nano),
 *   2. the live model's prediction,
 *   3. (optionally) existing human/approved truth.
 *
 * When the available signals agree on every span, the row is promoted to gold
 * automatically — no admin touch. Only genuine disagreement (a label conflict,
 * a span one signal saw and another missed, or a boundary that drifts past
 * tolerance) is routed to a human. This is what keeps human review scarce and
 * spent only where accuracy is actually at risk.
 */
import { projectExpectedFields } from './bioSupervisionExport.js';

export type ConsensusSource = 'llm' | 'model' | 'truth';

export interface ConsensusSpan {
  label: string;
  start: number;
  end: number;
}

export type ConflictKind =
  | 'label_mismatch'
  | 'boundary_mismatch'
  | 'missing_in_model'
  | 'missing_in_llm'
  | 'missing_in_truth'
  | 'extra_span';

export interface ConsensusConflict {
  kind: ConflictKind;
  label: string;
  start: number;
  end: number;
  detail: string;
}

export interface ConsensusResult {
  decision: 'auto_gold' | 'needs_review';
  agreementScore: number;
  agreedSpans: ConsensusSpan[];
  conflicts: ConsensusConflict[];
  reasons: string[];
  sources: ConsensusSource[];
}

export interface ConsensusOptions {
  /** Minimum IoU for two spans of the same label to be considered the same span. */
  overlapThreshold?: number;
  /** Spans must agree at/above this fraction for an automatic gold decision. */
  autoGoldThreshold?: number;
  /** A boundary that overlaps but falls below this IoU is flagged, not accepted. */
  boundaryThreshold?: number;
}

const DEFAULTS: Required<ConsensusOptions> = {
  overlapThreshold: 0.5,
  autoGoldThreshold: 1,
  boundaryThreshold: 0.8,
};

/** Convert hardened-projection output into consensus spans (matched only). */
export function spansFromExpectedFields(
  rawText: string,
  expectedFields: Record<string, unknown>,
): ConsensusSpan[] {
  return projectExpectedFields(rawText, expectedFields)
    .filter((projection) => projection.method !== 'unmatched')
    .map((projection) => ({ label: projection.label, start: projection.start, end: projection.end }));
}

function iou(a: ConsensusSpan, b: ConsensusSpan): number {
  const interStart = Math.max(a.start, b.start);
  const interEnd = Math.min(a.end, b.end);
  const intersection = Math.max(0, interEnd - interStart);
  if (intersection === 0) return 0;
  const union = (a.end - a.start) + (b.end - b.start) - intersection;
  return union > 0 ? intersection / union : 0;
}

interface MatchedPair {
  spanA: ConsensusSpan;
  spanB: ConsensusSpan;
  overlap: number;
}

/** Greedily pair same-label spans between two sets by descending overlap. */
function pairSpans(
  setA: ConsensusSpan[],
  setB: ConsensusSpan[],
  threshold: number,
): { pairs: MatchedPair[]; onlyA: ConsensusSpan[]; onlyB: ConsensusSpan[] } {
  const usedB = new Set<number>();
  const pairs: MatchedPair[] = [];
  const onlyA: ConsensusSpan[] = [];

  for (const spanA of setA) {
    let bestIndex = -1;
    let bestOverlap = 0;
    setB.forEach((spanB, index) => {
      if (usedB.has(index) || spanB.label !== spanA.label) return;
      const overlap = iou(spanA, spanB);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestOverlap >= threshold) {
      usedB.add(bestIndex);
      pairs.push({ spanA, spanB: setB[bestIndex]!, overlap: bestOverlap });
    } else {
      onlyA.push(spanA);
    }
  }

  const onlyB = setB.filter((_, index) => !usedB.has(index));
  return { pairs, onlyA, onlyB };
}

/** Detect a region claimed by both sets but with conflicting labels. */
function labelConflicts(setA: ConsensusSpan[], setB: ConsensusSpan[], threshold: number): ConsensusConflict[] {
  const conflicts: ConsensusConflict[] = [];
  for (const spanA of setA) {
    for (const spanB of setB) {
      if (spanA.label === spanB.label) continue;
      if (iou(spanA, spanB) >= threshold) {
        conflicts.push({
          kind: 'label_mismatch',
          label: `${spanA.label}≠${spanB.label}`,
          start: Math.min(spanA.start, spanB.start),
          end: Math.max(spanA.end, spanB.end),
          detail: `overlapping region labelled ${spanA.label} vs ${spanB.label}`,
        });
      }
    }
  }
  return conflicts;
}

/**
 * Reconcile the available signals. `truth` is optional — in the active-learning
 * cold-start there is no human truth yet, so consensus is LLM ↔ model only.
 */
export function reconcileConsensus(
  input: { llm: ConsensusSpan[]; model: ConsensusSpan[]; truth?: ConsensusSpan[] },
  options: ConsensusOptions = {},
): ConsensusResult {
  const config = { ...DEFAULTS, ...options };
  const sources: ConsensusSource[] = ['llm', 'model'];
  if (input.truth) sources.push('truth');

  const conflicts: ConsensusConflict[] = [];
  const reasons: string[] = [];

  // LLM vs model is the always-present axis.
  const llmModel = pairSpans(input.llm, input.model, config.overlapThreshold);
  conflicts.push(...labelConflicts(input.llm, input.model, config.overlapThreshold));

  for (const span of llmModel.onlyA) {
    conflicts.push({ kind: 'missing_in_model', label: span.label, start: span.start, end: span.end, detail: 'LLM labelled a span the model missed' });
  }
  for (const span of llmModel.onlyB) {
    conflicts.push({ kind: 'missing_in_llm', label: span.label, start: span.start, end: span.end, detail: 'model labelled a span the LLM missed' });
  }

  // Boundary drift on otherwise-agreed spans.
  const agreedSpans: ConsensusSpan[] = [];
  for (const pair of llmModel.pairs) {
    if (pair.overlap >= config.boundaryThreshold) {
      // Use the LLM span as the canonical boundary when both agree closely.
      agreedSpans.push(pair.spanA);
    } else {
      conflicts.push({
        kind: 'boundary_mismatch',
        label: pair.spanA.label,
        start: Math.min(pair.spanA.start, pair.spanB.start),
        end: Math.max(pair.spanA.end, pair.spanB.end),
        detail: `boundaries differ (IoU ${pair.overlap.toFixed(2)})`,
      });
    }
  }

  // If truth is present, every agreed span must also be backed by truth.
  let truthBackedSpans = agreedSpans;
  if (input.truth) {
    const vsTruth = pairSpans(agreedSpans, input.truth, config.overlapThreshold);
    truthBackedSpans = vsTruth.pairs
      .filter((pair) => pair.overlap >= config.boundaryThreshold)
      .map((pair) => pair.spanA);
    for (const span of vsTruth.onlyA) {
      conflicts.push({ kind: 'missing_in_truth', label: span.label, start: span.start, end: span.end, detail: 'LLM+model agreed on a span absent from truth' });
    }
    for (const span of vsTruth.onlyB) {
      conflicts.push({ kind: 'extra_span', label: span.label, start: span.start, end: span.end, detail: 'truth has a span neither LLM nor model agreed on' });
    }
  }

  const totalDistinctSpans = Math.max(
    input.llm.length,
    input.model.length,
    input.truth?.length ?? 0,
    truthBackedSpans.length,
  );
  const agreementScore = totalDistinctSpans === 0 ? 1 : truthBackedSpans.length / totalDistinctSpans;

  const hardConflict = conflicts.some((conflict) => conflict.kind === 'label_mismatch');
  const decision: ConsensusResult['decision'] =
    !hardConflict && agreementScore >= config.autoGoldThreshold ? 'auto_gold' : 'needs_review';

  if (decision === 'auto_gold') {
    reasons.push(`all ${sources.join('+')} signals agree on ${truthBackedSpans.length} span(s)`);
  } else {
    if (hardConflict) reasons.push('label conflict between signals');
    if (agreementScore < config.autoGoldThreshold) reasons.push(`agreement ${(agreementScore * 100).toFixed(0)}% below auto-gold bar`);
  }

  return {
    decision,
    agreementScore: Number(agreementScore.toFixed(4)),
    agreedSpans: truthBackedSpans,
    conflicts,
    reasons,
    sources,
  };
}
