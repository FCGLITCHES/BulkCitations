/**
 * Stage 3: Pre-Deduplication + Canonical Selection
 * 
 * When multiple raw citation strings in a batch refer to the same work,
 * this stage groups them before parsing and selects a canonical representative
 * using the priority rules from the Pipeline spec:
 * 
 * Priority order for canonical selection:
 *   1. inputStyle === outputStyle           → fields already closest to correct
 *   2. inputStyle with highest confidence   → most complete / best-parsed
 *   3. inputStyle with most fields present  → most data to work with
 *   4. First encountered                    → fallback
 * 
 * The non-canonical duplicates are kept as `clusterAlternatives` on the
 * canonical entry for UI display (show "X similar references found").
 */

import type { ParsedReference } from '@shared/schema';

// ── Types ──

export interface DedupeInput {
  /** Zero-indexed position in the original input array */
  index: number;
  raw: string;
  /** Pre-normalized text (from Stage 0/0b) */
  normalized: string;
}

export interface DedupeGroup {
  /** The canonical representative (highest priority) */
  canonical: DedupeInput;
  /** Other inputs that were deduplicated to this group */
  alternatives: DedupeInput[];
  /** The shared normalized key for this group */
  key: string;
}

// ── Key generation ──

/** Minimum chars for a meaningful dedup key */
const MIN_KEY_LENGTH = 20;

/**
 * Generate a dedup key from a normalized citation string.
 * 
 * Strategy: extract a stable fingerprint from the title/year portion —
 * the part least affected by style formatting differences.
 * 
 * Falls back to the full normalized string lowercased + whitespace-collapsed.
 */
export function makeDedupKey(normalized: string): string {
  const s = normalized.toLowerCase().trim().replace(/\s+/g, ' ');

  // Extract year if present
  const yearMatch = s.match(/\b((?:19|20)\d{2}|n\.d\.)\b/);
  const year = yearMatch?.[1] ?? '';

  // Extract a title-like segment:
  // APA/Harvard: appears after year in parens or after first dot+space
  // Vancouver: appears as second "sentence" (after author.period.title.)
  // All: something between first and second period is usually the title

  const sentences = s.split(/\.\s+/);
  // The title is usually the 2nd segment (0=authors, 1=title for APA/Harvard)
  // or 1st segment content after colon/period for Vancouver
  const candidateTitle = sentences.length >= 2 ? sentences[1] : sentences[0];

  // Clean up candidate title: strip leading "In ", quotes, noise
  const titleCore = candidateTitle
    .replace(/^(?:in\s+|"|\u201c|\u2018)/i, '')
    .replace(/[""\u201d\u2019,.]$/g, '')
    .trim()
    .slice(0, 60); // take first 60 chars — enough to be unique

  const key = year && titleCore ? `${year}:${titleCore}` : (titleCore || s.slice(0, 80));
  return key.length >= MIN_KEY_LENGTH ? key : s.slice(0, 80);
}

// ── Grouping ──

/**
 * Group citations by their dedup key.
 * Returns groups with 2+ members (true duplicates) as well as singletons.
 */
export function groupByDedup(inputs: DedupeInput[]): DedupeGroup[] {
  const byKey = new Map<string, DedupeInput[]>();

  for (const input of inputs) {
    const key = makeDedupKey(input.normalized);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(input);
    } else {
      byKey.set(key, [input]);
    }
  }

  const groups: DedupeGroup[] = [];
  for (const [key, members] of byKey) {
    if (members.length === 1) {
      groups.push({ canonical: members[0], alternatives: [], key });
    } else {
      // Multiple members — canonical is first, alternatives are the rest
      // (Caller can re-rank after parsing with selectCanonical)
      groups.push({ canonical: members[0], alternatives: members.slice(1), key });
    }
  }

  return groups;
}

// ── Canonical selection (post-parse) ──

export interface ParsedCandidate {
  raw: string;
  parsed: ParsedReference;
  inputStyle: string;
  /** Confidence score 0-100 */
  confidenceScore: number;
}

/**
 * Select the best canonical candidate from a set of parsed duplicates.
 * 
 * Implements the priority rules from the pipeline spec:
 *   1. inputStyle === outputStyle
 *   2. Highest confidence score
 *   3. Most fields present
 *   4. First encountered
 */
export function selectCanonical(
  candidates: ParsedCandidate[],
  outputStyle: string
): { canonical: ParsedCandidate; alternatives: ParsedCandidate[] } {
  if (candidates.length === 0) throw new Error('selectCanonical: empty candidates');
  if (candidates.length === 1) return { canonical: candidates[0], alternatives: [] };

  // Score each candidate
  const scored = candidates.map((c, idx) => {
    let priority = 0;

    // Rule 1: inputStyle matches outputStyle
    if (c.inputStyle === outputStyle) priority += 1000;

    // Rule 2: confidence score (0-100)
    priority += c.confidenceScore;

    // Rule 3: field count
    const fieldCount = Object.values(c.parsed).filter(v =>
      v !== undefined && v !== null && v !== '' &&
      !(Array.isArray(v) && v.length === 0)
    ).length;
    priority += fieldCount * 5;

    // Rule 4: position (lower idx = encountered first, slight preference)
    priority -= idx * 0.1;

    return { candidate: c, priority, idx };
  });

  scored.sort((a, b) => b.priority - a.priority);

  return {
    canonical: scored[0].candidate,
    alternatives: scored.slice(1).map(s => s.candidate),
  };
}
