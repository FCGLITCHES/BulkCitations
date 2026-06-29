import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LearningQueueItem, StoredApprovedTruth } from '../runtime/store.js';
import { hashInputForTruth } from './truthHash.js';

const LABEL_SCHEMA_VERSION = 'citation-bio-v1';
const FEATURE_VERSION = 'plain-text-bio-v1';

const BIO_FIELD_LABELS: Record<string, string> = {
  authors: 'author',
  editors: 'editors',
  year: 'year',
  title: 'title',
  journal: 'journal',
  conferenceTitle: 'conference_title',
  bookTitle: 'book_title',
  publisher: 'publisher',
  institution: 'institution',
  edition: 'edition',
  thesisType: 'thesis_type',
  repository: 'repository',
  articleNumber: 'article_number',
  accessedDate: 'accessed_date',
  siteName: 'site_name',
  database: 'database',
  reportNumber: 'report_number',
  placeOfPublication: 'place_of_publication',
  volume: 'volume',
  issue: 'issue',
  pages: 'pages',
  doi: 'doi',
  url: 'url',
};

// Labels whose values are long/semantic enough that an approximate (fuzzy)
// alignment is meaningful. Numeric / identifier fields must match exactly or be
// flagged — fuzzy-matching a DOI or a year invites silent corruption.
const FUZZY_ELIGIBLE_LABELS = new Set<string>([
  'author',
  'editors',
  'title',
  'journal',
  'conference_title',
  'book_title',
  'publisher',
  'institution',
  'site_name',
  'database',
  'repository',
  'place_of_publication',
]);

const FUZZY_MIN_CHARS = 8;
const FUZZY_THRESHOLD = 0.85;

export type ProjectionMethod = 'exact' | 'normalized' | 'fuzzy' | 'unmatched';
export type ProjectionStatus = 'ok' | 'partial' | 'failed';

export interface BioSupervisionRow {
  raw_text: string;
  bio_tokens: string[];
  bio_tags: string[];
  expected_fields: Record<string, unknown>;
  expected_type: string | null;
  expected_style: string | null;
  trust_level: string;
  dataset_split: string;
  input_hash: string;
  provenance: string;
  label_schema_version: string;
  feature_version: string;
  // Projection provenance — additive, ignored by the Python loader. Present so a
  // row whose fields could not be aligned is *flagged*, never silently dropped.
  projection_status?: ProjectionStatus;
  projection_methods?: Record<string, number>;
  unprojected_fields?: string[];
  needs_review?: boolean;
}

export interface StyleGoldBioSourceRow {
  raw_text: string;
  expected_fields: Record<string, unknown>;
  expected_type?: string | null;
  expected_style?: string | null;
  dataset_split?: string | null;
  trust_level?: string | null;
  input_hash?: string | null;
  provenance?: string | null;
  pipeline_major?: number | null;
  row_status?: string | null;
}

/** Per-field outcome of projecting an expected value onto the raw text. */
export interface FieldProjection {
  field: string;
  label: string;
  candidate: string;
  start: number;
  end: number;
  method: ProjectionMethod;
  score: number;
}

/** Aggregate report describing what an export run could and could not align. */
export interface ProjectionReport {
  totalRows: number;
  emittedRows: number;
  failedRows: number;
  partialRows: number;
  totalFieldValues: number;
  matchedFieldValues: number;
  unmatchedFieldValues: number;
  methodCounts: Record<ProjectionMethod, number>;
  unmatchedByField: Record<string, number>;
}

interface TokenOffset {
  token: string;
  start: number;
  end: number;
}

interface LabeledSpan {
  field: string;
  label: string;
  start: number;
  end: number;
  method: ProjectionMethod;
  score: number;
}

interface RowBuild {
  row: BioSupervisionRow | null;
  projections: FieldProjection[];
}

export async function writeBioSupervisionExport(input: {
  approvedTruthRows: StoredApprovedTruth[];
  learningQueueItems: LearningQueueItem[];
  outputPath: string;
}): Promise<{ outputPath: string; rowCount: number; skippedCount: number; report: ProjectionReport }> {
  const { rows, report } = buildBioSupervisionRowsWithDiagnostics(
    input.approvedTruthRows,
    input.learningQueueItems,
  );
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(
    input.outputPath,
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''),
    'utf8',
  );
  return {
    outputPath: input.outputPath,
    rowCount: rows.length,
    skippedCount: input.approvedTruthRows.length + input.learningQueueItems.length - rows.length,
    report,
  };
}

export function buildBioSupervisionRows(
  approvedTruthRows: StoredApprovedTruth[],
  learningQueueItems: LearningQueueItem[],
): BioSupervisionRow[] {
  return buildBioSupervisionRowsWithDiagnostics(approvedTruthRows, learningQueueItems).rows;
}

export function buildBioSupervisionRowsWithDiagnostics(
  approvedTruthRows: StoredApprovedTruth[],
  learningQueueItems: LearningQueueItem[],
): { rows: BioSupervisionRow[]; report: ProjectionReport } {
  const report = emptyReport();

  const truthBuilds = approvedTruthRows
    .filter((row) => row.rowStatus !== 'quarantined' && row.trustLevel !== 'draft')
    .map((row) => buildBioRow({
      rawText: row.rawText,
      expectedFields: row.coreTruth ?? row.expectedFields,
      expectedType: row.expectedType ?? null,
      expectedStyle: row.expectedStyle ?? null,
      trustLevel: row.trustLevel,
      datasetSplit: row.datasetSplit ?? 'train',
      inputHash: row.inputHash || hashInputForTruth(row.rawText),
      provenance: row.provenance ?? row.approvalSource ?? 'approved_truth',
    }));

  const learningBuilds = learningQueueItems
    .filter((item) => item.processed && item.trainingData?.eligibleForTraining === true)
    .map((item) => {
      const rawText = typeof item.trainingData.rawInput === 'string' ? item.trainingData.rawInput : '';
      const expectedFields = expectedFieldsFromLearningQueue(item);
      if (!rawText || Object.keys(expectedFields).length === 0) return null;
      return buildBioRow({
        rawText,
        expectedFields,
        expectedType: typeof item.trainingData.expectedType === 'string' ? item.trainingData.expectedType : null,
        expectedStyle: typeof item.trainingData.expectedStyle === 'string' ? item.trainingData.expectedStyle : null,
        trustLevel: 'reviewed',
        datasetSplit: 'train',
        inputHash: typeof item.trainingData.rawTextHash === 'string'
          ? item.trainingData.rawTextHash
          : hashInputForTruth(rawText),
        provenance: `learning_queue:${item.id}`,
      });
    })
    .filter((build): build is RowBuild => build !== null);

  const rowsByHash = new Map<string, BioSupervisionRow>();
  for (const build of [...truthBuilds, ...learningBuilds]) {
    accumulateReport(report, build);
    if (build.row) rowsByHash.set(build.row.input_hash, build.row);
  }
  report.emittedRows = rowsByHash.size;
  return { rows: [...rowsByHash.values()], report };
}

export function buildBioSupervisionRowsFromStyleGold(rows: StyleGoldBioSourceRow[]): BioSupervisionRow[] {
  return buildBioSupervisionRowsFromStyleGoldWithDiagnostics(rows).rows;
}

export function buildBioSupervisionRowsFromStyleGoldWithDiagnostics(
  rows: StyleGoldBioSourceRow[],
): { rows: BioSupervisionRow[]; report: ProjectionReport } {
  const report = emptyReport();
  const builds = rows
    .filter((row) => row.row_status !== 'quarantined' && row.trust_level !== 'draft')
    .map((row) => buildBioRow({
      rawText: row.raw_text,
      expectedFields: row.expected_fields,
      expectedType: row.expected_type ?? null,
      expectedStyle: row.expected_style ?? null,
      trustLevel: row.trust_level ?? 'gold',
      datasetSplit: row.dataset_split ?? 'train',
      inputHash: row.input_hash || hashInputForTruth(row.raw_text),
      provenance: row.provenance ?? 'style_gold_export',
    }));

  const rowsByHash = new Map<string, BioSupervisionRow>();
  for (const build of builds) {
    accumulateReport(report, build);
    if (build.row) rowsByHash.set(build.row.input_hash, build.row);
  }
  report.emittedRows = rowsByHash.size;
  return { rows: [...rowsByHash.values()], report };
}

function buildBioRow(input: {
  rawText: string;
  expectedFields: Record<string, unknown>;
  expectedType: string | null;
  expectedStyle: string | null;
  trustLevel: string;
  datasetSplit: string;
  inputHash: string;
  provenance: string;
}): RowBuild {
  const tokens = tokenizeWithOffsets(input.rawText);
  if (tokens.length === 0) return { row: null, projections: [] };

  const projections = projectFields(input.rawText, tokens, input.expectedFields);
  const matched = projections.filter((projection) => projection.method !== 'unmatched');
  const unmatched = projections.filter((projection) => projection.method === 'unmatched');

  const tags = tokens.map(() => 'O');
  const occupied = new Set<number>();
  const spans: LabeledSpan[] = matched
    .map((projection) => ({
      field: projection.field,
      label: projection.label,
      start: projection.start,
      end: projection.end,
      method: projection.method,
      score: projection.score,
    }))
    // Higher-confidence and longer spans win contested tokens; ties resolve left-to-right.
    .sort((left, right) => (
      right.score - left.score
      || (right.end - right.start) - (left.end - left.start)
      || left.start - right.start
    ));

  for (const span of spans) {
    const tokenIndexes = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token, index }) => (
        !occupied.has(index)
        && token.start < span.end
        && token.end > span.start
      ))
      .map(({ index }) => index)
      .sort((left, right) => left - right);
    if (tokenIndexes.length === 0) continue;

    for (const [position, tokenIndex] of tokenIndexes.entries()) {
      occupied.add(tokenIndex);
      tags[tokenIndex] = `${position === 0 ? 'B' : 'I'}-${span.label}`;
    }
  }

  const hasExpected = projections.length > 0;
  if (tags.every((tag) => tag === 'O')) {
    // No span could be placed. Never silently swallow a row that *had* expected
    // fields — surface it as a failed projection so it can be routed to review.
    return { row: null, projections };
  }

  const methodCounts = countMethods(matched);
  const status: ProjectionStatus = unmatched.length === 0
    ? 'ok'
    : hasExpected && matched.length === 0
      ? 'failed'
      : 'partial';

  const row: BioSupervisionRow = {
    raw_text: input.rawText,
    bio_tokens: tokens.map((token) => token.token),
    bio_tags: tags,
    expected_fields: input.expectedFields,
    expected_type: input.expectedType,
    expected_style: input.expectedStyle,
    trust_level: input.trustLevel,
    dataset_split: input.datasetSplit,
    input_hash: input.inputHash,
    provenance: input.provenance,
    label_schema_version: LABEL_SCHEMA_VERSION,
    feature_version: FEATURE_VERSION,
    projection_status: status,
    projection_methods: methodCounts,
  };
  if (unmatched.length > 0) {
    row.unprojected_fields = unmatched.map((projection) => projection.field);
    row.needs_review = true;
  }

  return { row, projections };
}

/**
 * Public entry to the hardened aligner: project a field map onto raw text and
 * return every per-field outcome (matched or unmatched). Reused by the consensus
 * reconciler to align both the LLM pre-label leg and the truth leg through the
 * exact same matcher the export uses.
 */
export function projectExpectedFields(
  rawText: string,
  expectedFields: Record<string, unknown>,
): FieldProjection[] {
  const tokens = tokenizeWithOffsets(rawText);
  if (tokens.length === 0) return [];
  return projectFields(rawText, tokens, expectedFields);
}

/**
 * Project every expected field value onto the raw text. List-valued fields
 * (authors/editors) are projected element-by-element so multi-author references
 * are fully covered. Every field — matched or not — is returned, so callers can
 * report coverage instead of losing failures.
 */
function projectFields(
  rawText: string,
  tokens: TokenOffset[],
  expectedFields: Record<string, unknown>,
): FieldProjection[] {
  const norm = normalizeForMatch(rawText);
  const rawLower = rawText.toLowerCase();
  const used: Array<{ start: number; end: number }> = [];
  const projections: FieldProjection[] = [];

  const project = (field: string, label: string, candidates: string[]): void => {
    const match = matchCandidates(rawText, rawLower, norm, tokens, label, candidates, used);
    if (match) {
      used.push({ start: match.start, end: match.end });
      projections.push({ field, label, candidate: match.candidate, start: match.start, end: match.end, method: match.method, score: match.score });
    } else {
      projections.push({ field, label, candidate: candidates[0] ?? '', start: -1, end: -1, method: 'unmatched', score: 0 });
    }
  };

  for (const [field, value] of Object.entries(expectedFields)) {
    const label = BIO_FIELD_LABELS[field];
    if (!label) continue;

    if ((field === 'authors' || field === 'editors') && Array.isArray(value)) {
      value.forEach((element, index) => {
        const candidates = fieldTextCandidates(element);
        if (candidates.length === 0) return;
        project(`${field}[${index}]`, label, candidates);
      });
      continue;
    }

    const candidates = fieldTextCandidates(value);
    if (candidates.length === 0) continue;
    project(field, label, candidates);
  }

  return projections;
}

interface SpanMatch {
  start: number;
  end: number;
  method: ProjectionMethod;
  score: number;
  candidate: string;
}

function matchCandidates(
  rawText: string,
  rawLower: string,
  norm: NormalizedText,
  tokens: TokenOffset[],
  label: string,
  candidates: string[],
  used: Array<{ start: number; end: number }>,
): SpanMatch | null {
  // Pass 1: exact (case-insensitive), preferring an occurrence that does not
  // collide with an already-placed span.
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const span = findExact(rawLower, trimmed.toLowerCase(), used);
    if (span) return { ...span, method: 'exact', score: 1, candidate: trimmed };
  }
  // Pass 2: normalized (dashes, quotes, collapsed whitespace, case).
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const span = findNormalized(norm, trimmed, used);
    if (span) return { ...span, method: 'normalized', score: 1, candidate: trimmed };
  }
  // Pass 3: fuzzy token-window — only for long, semantic fields.
  if (FUZZY_ELIGIBLE_LABELS.has(label)) {
    let best: SpanMatch | null = null;
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (trimmed.length < FUZZY_MIN_CHARS) continue;
      const span = findFuzzy(tokens, trimmed, used);
      if (span && (!best || span.score > best.score)) {
        best = { ...span, method: 'fuzzy', candidate: trimmed };
      }
    }
    if (best) return best;
  }
  return null;
}

function overlapsUsed(start: number, end: number, used: Array<{ start: number; end: number }>): boolean {
  return used.some((range) => start < range.end && end > range.start);
}

function findExact(
  rawLower: string,
  needle: string,
  used: Array<{ start: number; end: number }>,
): { start: number; end: number } | null {
  let fallback: { start: number; end: number } | null = null;
  let from = 0;
  while (from <= rawLower.length) {
    const index = rawLower.indexOf(needle, from);
    if (index < 0) break;
    const span = { start: index, end: index + needle.length };
    if (!overlapsUsed(span.start, span.end, used)) return span;
    if (!fallback) fallback = span;
    from = index + 1;
  }
  return fallback;
}

function findNormalized(
  norm: NormalizedText,
  candidate: string,
  used: Array<{ start: number; end: number }>,
): { start: number; end: number } | null {
  const candNorm = normalizeForMatch(candidate).normalized.trim();
  if (!candNorm) return null;
  let fallback: { start: number; end: number } | null = null;
  let from = 0;
  while (from <= norm.normalized.length) {
    const index = norm.normalized.indexOf(candNorm, from);
    if (index < 0) break;
    const start = norm.map[index] ?? 0;
    const end = norm.map[index + candNorm.length] ?? start + candNorm.length;
    const span = { start, end };
    if (!overlapsUsed(span.start, span.end, used)) return span;
    if (!fallback) fallback = span;
    from = index + 1;
  }
  return fallback;
}

function findFuzzy(
  tokens: TokenOffset[],
  candidate: string,
  used: Array<{ start: number; end: number }>,
): SpanMatch | null {
  const candNorm = normalizeForMatch(candidate).normalized.trim();
  if (!candNorm) return null;
  const wordCount = candNorm.split(' ').filter(Boolean).length || 1;
  const sizes = new Set<number>([
    Math.max(1, wordCount - 1),
    wordCount,
    wordCount + 1,
    wordCount + 2,
  ]);

  let best: SpanMatch | null = null;
  for (const size of sizes) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const windowTokens = tokens.slice(start, start + size);
      const spanStart = windowTokens[0]!.start;
      const spanEnd = windowTokens[windowTokens.length - 1]!.end;
      if (overlapsUsed(spanStart, spanEnd, used)) continue;
      const windowNorm = normalizeForMatch(
        windowTokens.map((token) => token.token).join(' '),
      ).normalized.trim();
      const score = diceCoefficient(windowNorm, candNorm);
      if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
        best = { start: spanStart, end: spanEnd, method: 'fuzzy', score: Number(score.toFixed(4)), candidate };
      }
    }
  }
  return best;
}

interface NormalizedText {
  normalized: string;
  /** map[i] = original index of normalized char i; map[length] = rawText.length. */
  map: number[];
}

const DASH_CHARS = /[‐‑‒–—―−]/;
const SINGLE_QUOTES = /[‘’‚‛′´`]/;
const DOUBLE_QUOTES = /[“”„‟″]/;

function unifyChar(ch: string): string {
  if (DASH_CHARS.test(ch)) return '-';
  if (SINGLE_QUOTES.test(ch)) return "'";
  if (DOUBLE_QUOTES.test(ch)) return '"';
  if (ch === ' ') return ' ';
  return ch;
}

function normalizeForMatch(text: string): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      out.push(' ');
      map.push(i);
      prevSpace = true;
      continue;
    }
    prevSpace = false;
    out.push(unifyChar(ch).toLowerCase());
    map.push(i);
  }
  map.push(text.length);
  return { normalized: out.join(''), map };
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  const cleaned = value.replace(/\s+/g, ' ');
  for (let i = 0; i < cleaned.length - 1; i++) {
    const gram = cleaned.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice coefficient over character bigrams; cheap and dependency-free. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const aGrams = bigramCounts(a);
  const bGrams = bigramCounts(b);
  let intersection = 0;
  let aTotal = 0;
  let bTotal = 0;
  for (const count of aGrams.values()) aTotal += count;
  for (const count of bGrams.values()) bTotal += count;
  for (const [gram, count] of aGrams) {
    const other = bGrams.get(gram);
    if (other) intersection += Math.min(count, other);
  }
  return (2 * intersection) / (aTotal + bTotal);
}

function tokenizeWithOffsets(rawText: string): TokenOffset[] {
  return [...rawText.matchAll(/\S+/g)].map((match) => ({
    token: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function fieldTextCandidates(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') {
    return [String(value).trim()].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap(fieldTextCandidates).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) return fieldTextCandidates(record.value);
    const literal = typeof record.literal === 'string' ? record.literal.trim() : '';
    const family = typeof record.family === 'string' ? record.family.trim() : '';
    const given = typeof record.given === 'string' ? record.given.trim() : '';
    const initial = given ? `${given.charAt(0)}.` : '';
    return [
      literal,
      family && given ? `${family}, ${given}` : '',
      family && given ? `${given} ${family}` : '',
      family && initial ? `${family}, ${initial}` : '',
      family && initial ? `${family} ${initial}` : '',
      family,
    ].filter(Boolean);
  }
  return [];
}

function expectedFieldsFromLearningQueue(item: LearningQueueItem): Record<string, unknown> {
  if (item.trainingData.corrections && typeof item.trainingData.corrections === 'object' && !Array.isArray(item.trainingData.corrections)) {
    return item.trainingData.corrections as Record<string, unknown>;
  }
  if (typeof item.trainingData.fieldName === 'string' && item.trainingData.newValue !== undefined) {
    return { [item.trainingData.fieldName]: item.trainingData.newValue };
  }
  return {};
}

function countMethods(matched: FieldProjection[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const projection of matched) {
    counts[projection.method] = (counts[projection.method] ?? 0) + 1;
  }
  return counts;
}

function emptyReport(): ProjectionReport {
  return {
    totalRows: 0,
    emittedRows: 0,
    failedRows: 0,
    partialRows: 0,
    totalFieldValues: 0,
    matchedFieldValues: 0,
    unmatchedFieldValues: 0,
    methodCounts: { exact: 0, normalized: 0, fuzzy: 0, unmatched: 0 },
    unmatchedByField: {},
  };
}

function accumulateReport(report: ProjectionReport, build: RowBuild): void {
  report.totalRows += 1;
  if (!build.row) report.failedRows += 1;
  else if (build.row.projection_status === 'partial') report.partialRows += 1;

  for (const projection of build.projections) {
    report.totalFieldValues += 1;
    report.methodCounts[projection.method] += 1;
    if (projection.method === 'unmatched') {
      report.unmatchedFieldValues += 1;
      const key = baseFieldName(projection.field);
      report.unmatchedByField[key] = (report.unmatchedByField[key] ?? 0) + 1;
    } else {
      report.matchedFieldValues += 1;
    }
  }
}

function baseFieldName(field: string): string {
  const bracket = field.indexOf('[');
  return bracket >= 0 ? field.slice(0, bracket) : field;
}
