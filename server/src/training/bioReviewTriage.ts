/**
 * Inbox triage runner — applies consensus triage (model as third vote) over the
 * review inbox, promoting agreements straight to verified gold and leaving only
 * disagreements for the human queue.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CitationStyle } from '../engine/types/citation.js';
import type { MLClient } from '../ml/client.js';
import type { ConsensusSpan } from './bioConsensus.js';
import { triageRows, type SpanProvider } from './bioConsensusTriage.js';
import { loadInbox, reviewPaths, type ReviewRow } from './bioReviewQueue.js';

/** Turn the live ML extractor into a span provider for the model vote. */
export function modelSpanProvider(client: MLClient, style: CitationStyle = 'apa7'): SpanProvider {
  return async (rawText: string): Promise<ConsensusSpan[] | null> => {
    const response = await client.extract([rawText], [style]);
    const result = response.results[0];
    if (!result?.bio) return null;
    return result.bio.entities.map((entity) => ({
      label: entity.label,
      start: entity.charStart,
      end: entity.charEnd,
    }));
  };
}

export interface InboxTriageResult {
  evaluated: number;
  autoPromoted: number;
  remaining: number;
  modelUnavailable: number;
}

/**
 * Run triage over the whole inbox: the model consensus PRE-LABELS each row (a third vote), but
 * EVERY row — including agreements — stays in the inbox and still requires human verification.
 * Nothing is auto-merged into the gold; a row becomes `verified.jsonl` gold only after a human
 * approves it. Agreements are listed first (fastest to confirm); conflicts follow.
 */
export async function runInboxTriage(
  client: MLClient,
  options: { style?: CitationStyle; llmSpanProvider?: SpanProvider } = {},
): Promise<InboxTriageResult> {
  const inbox = await loadInbox();
  const provider = modelSpanProvider(client, options.style ?? 'apa7');
  const summary = await triageRows(inbox, provider, options.llmSpanProvider, { autoGoldWithoutModel: false });

  const paths = reviewPaths();
  await mkdir(dirname(paths.inbox), { recursive: true });
  // Consensus agreements are pre-labeled but NOT promoted to gold — they remain in the inbox
  // for human verification (listed first). This is also how a model that wrongly MERGES labels
  // (e.g. volume+pages) is caught: a human confirms/splits it rather than it silently entering
  // the gold set.
  const pendingVerification = [...summary.autoGold, ...summary.needsReview];
  await writeFile(
    paths.inbox,
    pendingVerification.map((row: ReviewRow) => JSON.stringify(row)).join('\n') + (pendingVerification.length ? '\n' : ''),
    'utf8',
  );

  const modelUnavailable = summary.results.filter((result) => !result.modelAvailable).length;
  return {
    evaluated: inbox.length,
    // consensus-agreed rows — now pre-labeled and pending human verification, not promoted.
    autoPromoted: summary.autoGold.length,
    remaining: pendingVerification.length,
    modelUnavailable,
  };
}
