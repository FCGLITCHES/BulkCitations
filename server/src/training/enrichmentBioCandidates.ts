/**
 * Emit BIO-training candidate rows from pro enrichment recoveries.
 *
 * When enrichment auto-recovers a needs_action reference, the (input text → corrected fields) pair
 * is a useful supervision signal — but ONLY where the corrected value actually appears in the input,
 * because BIO labels are spans of the input, not canonical provider strings. So each candidate is
 * run through the same projection aligner the export uses; only projectable fields become labels,
 * and the row is tagged `provenance: 'enrichment_recovery'` + `needs_review: true` so it lands in the
 * review inbox for human certification and is NEVER trained on directly (avoids self-training on
 * unverified provider output — see the gold-vs-synthetic finding).
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { projectExpectedFields } from './bioSupervisionExport.js';
import { reviewPaths, type ReviewRow } from './bioReviewQueue.js';
import { hashInputForTruth } from './truthHash.js';
import type { ExtractedFields } from '../engine/types/citation.js';
import { EXTRACTED_FIELD_KEYS, hasFieldValue } from '../engine/utils/fields.js';
import { db } from '../db/connection.js';
import { bioCandidateSink } from '../db/schema.js';
import { runtimePersistenceBackend } from '../runtime/persistence.js';

export const ENRICHMENT_BIO_PROVENANCE = 'enrichment_recovery';

export interface EnrichmentBioCandidateInput {
  rawText: string;
  fields: ExtractedFields;
  expectedType?: string | null;
  stratum?: string;
}

/** Build a single inbox row, or null if nothing projects onto the input (not BIO-usable). */
export function buildEnrichmentBioCandidate(candidate: EnrichmentBioCandidateInput): ReviewRow | null {
  const expectedFields = toExpectedFields(candidate.fields);
  if (Object.keys(expectedFields).length === 0) return null;

  const projections = projectExpectedFields(candidate.rawText, expectedFields);
  const matched = projections.filter((projection) => projection.method !== 'unmatched');
  if (matched.length === 0) return null;
  const unmatched = projections.filter((projection) => projection.method === 'unmatched');

  return {
    raw_text: candidate.rawText,
    ...(candidate.stratum ? { stratum: candidate.stratum } : {}),
    expected_type: candidate.expectedType ?? null,
    entity_fields: matched.map((projection) => projection.label),
    entity_starts: matched.map((projection) => projection.start),
    entity_ends: matched.map((projection) => projection.end),
    entity_texts: matched.map((projection) => candidate.rawText.slice(projection.start, projection.end)),
    expected_fields: expectedFields,
    dataset_split: 'train',
    trust_level: 'draft',
    provenance: ENRICHMENT_BIO_PROVENANCE,
    needs_review: true,
    unprojected_fields: unmatched.map((projection) => projection.field),
  };
}

/**
 * Append enrichment-recovery candidates to the BIO review inbox. Best-effort: a write failure (e.g.
 * a read-only dataset path in production) must never fail the user's conversion — callers should
 * still wrap this, but it also swallows its own IO errors.
 */
export async function emitEnrichmentBioCandidates(
  candidates: EnrichmentBioCandidateInput[],
): Promise<{ emitted: number; skipped: number }> {
  const rows: ReviewRow[] = [];
  let skipped = 0;
  for (const candidate of candidates) {
    const row = buildEnrichmentBioCandidate(candidate);
    if (row) rows.push(row);
    else skipped += 1;
  }
  if (rows.length === 0) return { emitted: 0, skipped };

  // Durable DB sink (prod-safe) + JSONL review inbox (dev review pipeline) — both best-effort so a
  // write failure never affects the conversion.
  await persistBioCandidatesToDb(rows);
  await appendToReviewInbox(rows);
  return { emitted: rows.length, skipped };
}

async function persistBioCandidatesToDb(rows: ReviewRow[]): Promise<void> {
  if (runtimePersistenceBackend !== 'database') return;
  try {
    await db
      .insert(bioCandidateSink)
      .values(
        rows.map((row) => ({
          inputHash: hashInputForTruth(row.raw_text),
          rawText: row.raw_text,
          expectedType: row.expected_type ?? null,
          entityFields: row.entity_fields,
          entityStarts: row.entity_starts,
          entityEnds: row.entity_ends,
          expectedFields: row.expected_fields ?? null,
          unprojectedFields: row.unprojected_fields ?? [],
          datasetSplit: row.dataset_split ?? 'train',
          trustLevel: row.trust_level ?? 'draft',
          provenance: row.provenance ?? ENRICHMENT_BIO_PROVENANCE,
          needsReview: row.needs_review ?? true,
        })),
      )
      .onConflictDoNothing({ target: bioCandidateSink.inputHash });
  } catch {
    // best-effort durable sink
  }
}

async function appendToReviewInbox(rows: ReviewRow[]): Promise<void> {
  try {
    const path = reviewPaths().inbox;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  } catch {
    // best-effort dev review inbox
  }
}

function toExpectedFields(fields: ExtractedFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of EXTRACTED_FIELD_KEYS) {
    const field = fields[key];
    if (hasFieldValue(field)) out[key] = field.value;
  }
  return out;
}
