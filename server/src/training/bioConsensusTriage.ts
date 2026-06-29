/**
 * Consensus triage — wires the live model in as a vote so agreements
 * auto-promote to gold and only disagreements reach the human review queue.
 *
 * For a candidate row, three independent signals are reconciled:
 *   - the row's own projection spans (trusted: derived from authoritative
 *     metadata or a human correction) — the `truth`/proposer leg,
 *   - the live model's prediction — the `model` leg (injected, so this stays
 *     transport-agnostic and unit-testable),
 *   - optionally the LLM pre-label — an extra backing leg.
 *
 * Agreement → the row is promoted to verified gold without a human. Conflict, or
 * an unavailable model vote, → it stays in the review queue (fail-safe: never
 * auto-promote without the model's confirmation).
 */
import { reconcileConsensus, spansFromExpectedFields, type ConsensusSpan } from './bioConsensus.js';
import type { ReviewRow } from './bioReviewQueue.js';

export type SpanProvider = (rawText: string) => Promise<ConsensusSpan[] | null>;

export interface TriageOptions {
  /** Promote to gold even when the model vote is unavailable. Default false (fail-safe). */
  autoGoldWithoutModel?: boolean;
}

export interface TriageResult {
  row: ReviewRow;
  decision: 'auto_gold' | 'needs_review';
  agreementScore: number;
  reasons: string[];
  modelAvailable: boolean;
}

export interface TriageSummary {
  autoGold: ReviewRow[];
  needsReview: ReviewRow[];
  results: TriageResult[];
}

/** The trusted/proposer spans for a row: its existing entity arrays, else its projected fields. */
export function truthSpansForRow(row: ReviewRow): ConsensusSpan[] {
  if (row.entity_fields.length && row.entity_fields.length === row.entity_starts.length) {
    return row.entity_fields.map((label, index) => ({
      label,
      start: row.entity_starts[index]!,
      end: row.entity_ends[index]!,
    }));
  }
  if (row.expected_fields) return spansFromExpectedFields(row.raw_text, row.expected_fields);
  return [];
}

export async function triageRow(
  row: ReviewRow,
  getModelSpans: SpanProvider,
  getLlmSpans?: SpanProvider,
  options: TriageOptions = {},
): Promise<TriageResult> {
  const truth = truthSpansForRow(row);
  const modelSpans = await safeSpans(getModelSpans, row.raw_text);
  const llmSpans = getLlmSpans ? await safeSpans(getLlmSpans, row.raw_text) : null;
  const modelAvailable = modelSpans !== null;

  if (!modelAvailable) {
    return {
      row,
      decision: options.autoGoldWithoutModel ? 'auto_gold' : 'needs_review',
      agreementScore: 0,
      reasons: ['model vote unavailable'],
      modelAvailable: false,
    };
  }

  // The trusted projection plays the proposer (`llm`) role; the live model is the
  // second voter; a real LLM pre-label, if present, must additionally back it.
  const consensus = reconcileConsensus({
    llm: truth,
    model: modelSpans,
    ...(llmSpans ? { truth: llmSpans } : {}),
  });

  return {
    row,
    decision: consensus.decision,
    agreementScore: consensus.agreementScore,
    reasons: consensus.reasons,
    modelAvailable: true,
  };
}

export async function triageRows(
  rows: ReviewRow[],
  getModelSpans: SpanProvider,
  getLlmSpans?: SpanProvider,
  options: TriageOptions = {},
): Promise<TriageSummary> {
  const results: TriageResult[] = [];
  for (const row of rows) {
    results.push(await triageRow(row, getModelSpans, getLlmSpans, options));
  }
  return {
    autoGold: results.filter((r) => r.decision === 'auto_gold').map((r) => promoteRow(r.row)),
    needsReview: results.filter((r) => r.decision === 'needs_review').map((r) => r.row),
    results,
  };
}

/** Stamp an auto-promoted row as verified gold via consensus. */
export function promoteRow(row: ReviewRow): ReviewRow {
  return {
    ...row,
    trust_level: 'gold',
    provenance: row.provenance ? `${row.provenance}+consensus` : 'consensus',
    needs_review: false,
    unprojected_fields: [],
  };
}

async function safeSpans(provider: SpanProvider, rawText: string): Promise<ConsensusSpan[] | null> {
  try {
    return await provider(rawText);
  } catch {
    return null;
  }
}
