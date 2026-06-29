/**
 * Convert char-offset candidate/verified rows into trainable BIO gold rows
 * (bio_tokens + bio_tags), the format the Python trainer's loader consumes and
 * the Training tab lists. This is the bridge from the review/fetch pipeline to
 * an actual trainable dataset.
 */
import { hashInputForTruth } from './truthHash.js';

export interface SpanRow {
  raw_text: string;
  entity_fields: string[];
  entity_starts: number[];
  entity_ends: number[];
  expected_fields?: Record<string, unknown>;
  expected_type?: string | null;
  expected_style?: string | null;
  stratum?: string;
  dataset_split?: string;
  trust_level?: string;
  provenance?: string;
  needs_review?: boolean;
}

export interface BioGoldRow {
  raw_text: string;
  bio_tokens: string[];
  bio_tags: string[];
  expected_fields?: Record<string, unknown>;
  expected_type: string | null;
  expected_style: string | null;
  dataset_split: string;
  trust_level: string;
  provenance: string;
  input_hash: string;
  stratum?: string;
  label_schema_version: string;
  feature_version: string;
}

interface Tok { start: number; end: number; text: string }

function tokenize(raw: string): Tok[] {
  return [...raw.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

/** Convert a span row into a BIO gold row; null if it has no labelable tokens. */
export function candidateToBioRow(row: SpanRow): BioGoldRow | null {
  const tokens = tokenize(row.raw_text);
  if (tokens.length === 0) return null;

  const tags = tokens.map(() => 'O');
  const entities = row.entity_fields
    .map((field, index) => ({ field, start: row.entity_starts[index]!, end: row.entity_ends[index]! }))
    .filter((entity) => Number.isInteger(entity.start) && Number.isInteger(entity.end) && entity.end > entity.start)
    .sort((a, b) => a.start - b.start);

  const occupied = new Set<number>();
  for (const entity of entities) {
    const indexes = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token, index }) => !occupied.has(index) && token.start < entity.end && token.end > entity.start)
      .map(({ index }) => index)
      .sort((a, b) => a - b);
    indexes.forEach((tokenIndex, position) => {
      occupied.add(tokenIndex);
      tags[tokenIndex] = `${position === 0 ? 'B' : 'I'}-${entity.field}`;
    });
  }

  if (tags.every((tag) => tag === 'O')) return null;

  const out: BioGoldRow = {
    raw_text: row.raw_text,
    bio_tokens: tokens.map((token) => token.text),
    bio_tags: tags,
    expected_type: row.expected_type ?? null,
    expected_style: row.expected_style ?? null,
    dataset_split: row.dataset_split ?? 'train',
    trust_level: row.trust_level ?? 'gold',
    provenance: row.provenance ?? 'review_verified',
    input_hash: hashInputForTruth(row.raw_text),
    label_schema_version: 'citation-bio-v1',
    feature_version: 'plain-text-bio-v1',
  };
  if (row.expected_fields) out.expected_fields = row.expected_fields;
  if (row.stratum) out.stratum = row.stratum;
  return out;
}
