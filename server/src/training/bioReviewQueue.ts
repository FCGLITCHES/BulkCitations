/**
 * BIO review queue — the active-learning surface for P2.
 *
 * Candidate rows (auto-labelled by the fetcher/ingester, or flagged by the
 * projection/consensus pass) land in an inbox. The queue ranks them so the admin
 * spends attention where it matters: rows that need review first, then those
 * with the most unresolved fields. Approving a row writes verified gold;
 * rejecting logs it. Everything pure is unit-tested; only file IO touches disk.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashInputForTruth } from './truthHash.js';
import { resolveBioDatasetRoot } from '../runtime/artifactPaths.js';

export interface ReviewRow {
  raw_text: string;
  stratum?: string | undefined;
  expected_type?: string | null | undefined;
  entity_fields: string[];
  entity_starts: number[];
  entity_ends: number[];
  entity_texts?: string[];
  expected_fields?: Record<string, unknown>;
  dataset_split?: string | undefined;
  trust_level?: string;
  provenance?: string;
  needs_review?: boolean;
  unprojected_fields?: string[];
}

export interface RankedReviewItem extends ReviewRow {
  id: string;
  priority: number;
}

export interface ReviewSubmission {
  id: string;
  decision: 'approve' | 'reject';
  raw_text: string;
  entity_fields: string[];
  entity_starts: number[];
  entity_ends: number[];
  expected_type?: string | null | undefined;
  stratum?: string | undefined;
  dataset_split?: string | undefined;
}

export function reviewRowId(row: { raw_text: string }): string {
  return hashInputForTruth(row.raw_text);
}

/**
 * Active-learning priority: higher = review sooner. Rows explicitly needing
 * review rank first, then rows with more unresolved fields, then rows with
 * fewer confidently-placed spans (the model/projection had least to go on).
 */
export function reviewPriority(row: ReviewRow): number {
  const needsReview = row.needs_review ? 1000 : 0;
  const unresolved = (row.unprojected_fields?.length ?? 0) * 50;
  const sparseSpans = Math.max(0, 10 - row.entity_fields.length) * 5;
  return needsReview + unresolved + sparseSpans;
}

export function rankReviewQueue(rows: ReviewRow[]): RankedReviewItem[] {
  return rows
    .map((row) => ({ ...row, id: reviewRowId(row), priority: reviewPriority(row) }))
    .sort((a, b) => b.priority - a.priority || a.raw_text.localeCompare(b.raw_text));
}

/** Build a verified gold row from an approved submission (offsets → texts). */
export function buildVerifiedRow(submission: ReviewSubmission): ReviewRow {
  const entity_texts = submission.entity_starts.map((start, index) =>
    submission.raw_text.slice(start, submission.entity_ends[index] ?? start),
  );
  return {
    raw_text: submission.raw_text,
    stratum: submission.stratum,
    expected_type: submission.expected_type ?? null,
    entity_fields: submission.entity_fields,
    entity_starts: submission.entity_starts,
    entity_ends: submission.entity_ends,
    entity_texts,
    dataset_split: submission.dataset_split ?? 'train',
    trust_level: 'gold',
    provenance: 'human_verified',
    needs_review: false,
    unprojected_fields: [],
  };
}

/** Pure decision applier — removes the row from the inbox and yields the resolved row. */
export function applySubmit(
  inbox: ReviewRow[],
  submission: ReviewSubmission,
): { inbox: ReviewRow[]; resolved: ReviewRow | null; outcome: 'approved' | 'rejected' | 'not_found' } {
  const remaining: ReviewRow[] = [];
  let matched: ReviewRow | null = null;
  for (const row of inbox) {
    if (matched === null && reviewRowId(row) === submission.id) {
      matched = row;
      continue;
    }
    remaining.push(row);
  }
  if (matched === null) return { inbox, resolved: null, outcome: 'not_found' };
  if (submission.decision === 'reject') {
    return { inbox: remaining, resolved: matched, outcome: 'rejected' };
  }
  return { inbox: remaining, resolved: buildVerifiedRow(submission), outcome: 'approved' };
}

export function validateSpans(submission: ReviewSubmission): string | null {
  const { entity_fields, entity_starts, entity_ends, raw_text } = submission;
  if (!(entity_fields.length === entity_starts.length && entity_starts.length === entity_ends.length)) {
    return 'entity_fields/starts/ends length mismatch';
  }
  for (let i = 0; i < entity_starts.length; i += 1) {
    const start = entity_starts[i]!;
    const end = entity_ends[i]!;
    if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= raw_text.length)) {
      return `span ${i} has invalid offsets [${start}, ${end}]`;
    }
  }
  return null;
}

// --------------------------------------------------------------------------- #
// File IO (thin wrappers around the inbox / verified / rejected JSONL files).
// --------------------------------------------------------------------------- #

export function reviewPaths() {
  const root = resolveBioDatasetRoot();
  return {
    inbox: resolve(root, 'review', 'inbox.jsonl'),
    verified: resolve(root, 'review', 'verified.jsonl'),
    rejected: resolve(root, 'review', 'rejected.jsonl'),
  };
}

async function readJsonl(path: string): Promise<ReviewRow[]> {
  if (!existsSync(path)) return [];
  const content = await readFile(path, 'utf8');
  const rows: ReviewRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ReviewRow;
      if (typeof parsed.raw_text === 'string' && parsed.raw_text.trim()) rows.push(parsed);
    } catch {
      // skip malformed lines rather than failing the whole queue
    }
  }
  return rows;
}

export async function loadInbox(): Promise<ReviewRow[]> {
  return readJsonl(reviewPaths().inbox);
}

export async function getRankedQueue(limit: number): Promise<{ total: number; items: RankedReviewItem[] }> {
  const ranked = rankReviewQueue(await loadInbox());
  return { total: ranked.length, items: ranked.slice(0, Math.max(1, limit)) };
}

export async function persistSubmission(submission: ReviewSubmission): Promise<{ outcome: string; remaining: number }> {
  const paths = reviewPaths();
  const inbox = await loadInbox();
  const result = applySubmit(inbox, submission);
  if (result.outcome === 'not_found') return { outcome: 'not_found', remaining: inbox.length };

  await mkdir(dirname(paths.inbox), { recursive: true });
  await writeFile(paths.inbox, result.inbox.map((row) => JSON.stringify(row)).join('\n') + (result.inbox.length ? '\n' : ''), 'utf8');
  if (result.resolved) {
    const target = result.outcome === 'approved' ? paths.verified : paths.rejected;
    await appendFile(target, JSON.stringify(result.resolved) + '\n', 'utf8');
  }
  return { outcome: result.outcome, remaining: result.inbox.length };
}
