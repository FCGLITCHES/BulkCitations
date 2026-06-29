import { createHash } from 'node:crypto';
import { normalizeDoi } from '../engine/identifierUtils.js';
import type { TruthDatasetSplit } from '../runtime/store.js';

export interface StylePrecertPoolRow {
  raw_text: string;
  expected_style: string;
  expected_type?: string | null;
  gold_kind: 'style_clean' | 'style_adversarial' | 'style_noisy';
  adversarial_pair?: string | null;
  noise_profile?: string[] | null;
  pair_ambiguity_score?: number | null;
  pair_partner_score?: number | null;
  pair_partner_style?: string | null;
  source_filter?: string | null;
  source_prefix?: string | null;
  style_confidence?: number | null;
  family_confidence?: number | null;
  style_margin_to_runner_up?: number | null;
  canonical_work_key?: string | null;
  near_dup_cluster_id?: string | null;
  reference_doi?: string | null;
}

export interface StylePrecertPrepareOptions {
  datasetVersion: string;
}

export interface CrossrefEnrichmentAuthor {
  family: string;
  given?: string | null;
}

export interface CrossrefEnrichmentFields {
  title?: string | null;
  year?: number | null;
  journal?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  doi?: string | null;
  publisher?: string | null;
  url?: string | null;
  reference_type?: string | null;
  authors?: CrossrefEnrichmentAuthor[];
}

export interface CrossrefEnrichment {
  status: 'resolved_doi' | 'resolved_bibliographic' | 'unresolved' | 'error';
  match_confidence: 'high' | 'medium' | 'low' | 'none';
  fields: CrossrefEnrichmentFields | null;
  candidate_count?: number;
  matched_by?: 'reference_doi' | 'raw_text_doi' | 'bibliographic';
  match_notes?: string[];
  error?: string | null;
}

export interface StylePrecertLookupRequest {
  lookupKey: string;
  lookupKind: 'doi' | 'bibliographic';
  doi: string | null;
  queryText: string | null;
  representativeRecordId: string;
}

export interface PreparedStylePrecertRow extends StylePrecertPoolRow {
  record_id: string;
  dataset_version: string;
  source_line_number: number;
  cluster_key: string;
  lookup_key: string;
  suggested_dataset_split: TruthDatasetSplit;
  augmentation_source_record_id: string | null;
  exact_duplicate_group_id: string | null;
  normalized_duplicate_group_id: string | null;
}

export interface StylePrecertPreparationResult {
  rows: PreparedStylePrecertRow[];
  lookupRequests: StylePrecertLookupRequest[];
}

export type StylePrecertSuggestedAction =
  | 'keep'
  | 'drop_duplicate_noisy'
  | 'review_style'
  | 'review_type'
  | 'review_style_and_type'
  | 'review_confidence';

export interface AnnotatedStylePrecertRow extends PreparedStylePrecertRow {
  crossref_enrichment: CrossrefEnrichment;
  style_marker_flags: string[];
  issue_codes: string[];
  suggested_action: StylePrecertSuggestedAction;
  needs_admin_review: boolean;
  proposed_expected_style: string | null;
  proposed_expected_type: string | null;
}

export interface SanitizedStylePrecertRow {
  record_id: string;
  dataset_version: string;
  source_line_number: number;
  raw_text: string;
  expected_style: string;
  expected_type: string | null;
  gold_kind: StylePrecertPoolRow['gold_kind'];
  adversarial_pair: string | null;
  noise_profile: string[] | null;
  reference_doi: string | null;
  cluster_key: string;
  suggested_dataset_split: TruthDatasetSplit;
  augmentation_source_record_id: string | null;
  needs_admin_review: boolean;
  suggested_action: StylePrecertSuggestedAction;
  proposed_expected_style: string | null;
  proposed_expected_type: string | null;
}

export interface StylePrecertCertificationSummary {
  datasetVersion: string;
  totalRows: number;
  reviewQueueRows: number;
  sanitizedRows: number;
  droppedRows: number;
  clusterCount: number;
  lookupRequestCount: number;
  mappedNoisyRows: number;
  actionCounts: Record<string, number>;
  issueCounts: Record<string, number>;
  styleMarkerCounts: Record<string, number>;
  crossrefStatusCounts: Record<string, number>;
  leakageFieldsStripped: string[];
}

export interface StylePrecertCertificationResult {
  rows: AnnotatedStylePrecertRow[];
  reviewQueue: AnnotatedStylePrecertRow[];
  sanitizedRows: SanitizedStylePrecertRow[];
  summary: StylePrecertCertificationSummary;
}

interface RowComputationState {
  row: StylePrecertPoolRow;
  lineNumber: number;
  recordId: string;
  comparableKey: string;
  extractedDoi: string | null;
  exactDuplicateGroupId: string | null;
  normalizedDuplicateGroupId: string | null;
  augmentationSourceRecordId: string | null;
  clusterKey: string;
  lookupKey: string;
  suggestedDatasetSplit: TruthDatasetSplit;
}

const DOI_REGEX = /\b10\.\d{4,9}\/[^\s"'<>]+/iu;
const AUTHOR_DATE_STYLES = new Set(['apa7', 'harvard-ctr']);
const LEAKAGE_FIELDS = [
  'source_prefix',
  'source_filter',
  'canonical_work_key',
  'near_dup_cluster_id',
  'style_confidence',
  'family_confidence',
  'style_margin_to_runner_up',
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function squeezeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizeForComparison(value: string): string {
  return squeezeWhitespace(value).toLowerCase();
}

function normalizeForNoiseComparable(value: string): string {
  return squeezeWhitespace(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/_/gu, ' '),
  );
}

function extractDoiFromText(value: string): string | null {
  const matched = value.match(DOI_REGEX)?.[0] ?? null;
  return matched ? normalizeDoi(matched) : null;
}

function extractDoiFromCanonicalKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith('doi:')) {
    return normalizeDoi(value.slice(4));
  }
  if (value.startsWith('work-doi:')) {
    return normalizeDoi(value.slice('work-doi:'.length));
  }
  return null;
}

function buildRecordId(datasetVersion: string, lineNumber: number): string {
  return `style-precert:${datasetVersion}:${String(lineNumber).padStart(6, '0')}`;
}

function buildGroupId(prefix: string, value: string): string {
  return `${prefix}:${sha256(value).slice(0, 16)}`;
}

function clusterKeyFromRow(row: StylePrecertPoolRow, comparableKey: string, extractedDoi: string | null): string {
  const nearDup = row.near_dup_cluster_id?.trim();
  if (nearDup) {
    return nearDup;
  }
  const canonical = row.canonical_work_key?.trim();
  if (canonical) {
    return canonical;
  }
  const doi = normalizeDoi(
    row.reference_doi?.trim()
    || extractDoiFromCanonicalKey(row.canonical_work_key)
    || extractedDoi
    || '',
  );
  if (doi) {
    return `doi:${doi}`;
  }
  return `text:${sha256(comparableKey).slice(0, 24)}`;
}

function lookupKeyFromRow(
  row: StylePrecertPoolRow,
  extractedDoi: string | null,
  clusterKey: string,
): string {
  const doi = normalizeDoi(
    row.reference_doi?.trim()
    || extractDoiFromCanonicalKey(row.canonical_work_key)
    || extractedDoi
    || '',
  );
  if (doi) {
    return `doi:${doi}`;
  }
  return `cluster:${sha256(clusterKey).slice(0, 24)}`;
}

function splitFromClusterKey(clusterKey: string): TruthDatasetSplit {
  const bucket = Number.parseInt(sha256(clusterKey).slice(0, 2), 16) % 100;
  if (bucket < 80) {
    return 'train';
  }
  if (bucket < 90) {
    return 'val';
  }
  return 'test';
}

function countBy<T>(values: Iterable<T>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = String(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function compareRows(left: RowComputationState, right: RowComputationState): number {
  return left.lineNumber - right.lineNumber;
}

function buildDuplicateGroupIds(
  rows: Array<Pick<RowComputationState, 'row' | 'comparableKey'>>,
): {
  exactIds: Map<number, string>;
  normalizedIds: Map<number, string>;
} {
  const exactGroups = new Map<string, number[]>();
  const normalizedGroups = new Map<string, number[]>();

  rows.forEach((entry, index) => {
    const exactKey = entry.row.raw_text;
    const normalizedKey = normalizeForComparison(entry.row.raw_text);

    const exactList = exactGroups.get(exactKey) ?? [];
    exactList.push(index);
    exactGroups.set(exactKey, exactList);

    const normalizedList = normalizedGroups.get(normalizedKey) ?? [];
    normalizedList.push(index);
    normalizedGroups.set(normalizedKey, normalizedList);
  });

  const exactIds = new Map<number, string>();
  const normalizedIds = new Map<number, string>();

  for (const [exactKey, indices] of exactGroups) {
    if (indices.length < 2) {
      continue;
    }
    const groupId = buildGroupId('exact', exactKey);
    for (const index of indices) {
      exactIds.set(index, groupId);
    }
  }

  for (const [normalizedKey, indices] of normalizedGroups) {
    if (indices.length < 2) {
      continue;
    }
    const groupId = buildGroupId('normalized', normalizedKey);
    for (const index of indices) {
      normalizedIds.set(index, groupId);
    }
  }

  return { exactIds, normalizedIds };
}

function findNoisyAugmentationSources(states: RowComputationState[]): Map<string, string> {
  const nonNoisyByComparable = new Map<string, RowComputationState[]>();
  for (const state of states) {
    if (state.row.gold_kind === 'style_noisy') {
      continue;
    }
    const key = `${state.row.expected_style}\u0000${state.comparableKey}`;
    const list = nonNoisyByComparable.get(key) ?? [];
    list.push(state);
    nonNoisyByComparable.set(key, list);
  }

  const result = new Map<string, string>();
  for (const state of states) {
    if (state.row.gold_kind !== 'style_noisy') {
      continue;
    }
    const key = `${state.row.expected_style}\u0000${state.comparableKey}`;
    const matches = (nonNoisyByComparable.get(key) ?? []).sort(compareRows);
    if (matches.length === 0) {
      continue;
    }
    result.set(state.recordId, matches[0]!.recordId);
  }
  return result;
}

function resolveNumericStyleProposal(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (/^\[\d+\]\s*/u.test(trimmed)) {
    return 'ieee';
  }
  if (/^\d+[\].)]\s*/u.test(trimmed)) {
    return 'vancouver';
  }
  return null;
}

function detectStyleMarkerFlags(row: PreparedStylePrecertRow): {
  flags: string[];
  proposedStyle: string | null;
} {
  const flags: string[] = [];
  const numericProposal = resolveNumericStyleProposal(row.raw_text);
  const expectedStyle = row.expected_style.trim();
  const prefix = row.raw_text.trim();

  if (
    (expectedStyle === 'chicago-notes-bib' || expectedStyle === 'mla9')
    && /^\[\d+\]\s*/u.test(prefix)
  ) {
    flags.push(`${expectedStyle}_starts_ieee_bracket`);
  }

  if (
    AUTHOR_DATE_STYLES.has(expectedStyle)
    && (/^\[\d+\]\s*/u.test(prefix) || /^\d+[\].)]\s*/u.test(prefix))
  ) {
    flags.push(`${expectedStyle}_starts_numeric`);
  }

  if (
    (expectedStyle === 'chicago-notes-bib' || expectedStyle === 'mla9')
    && /^\d+[\].)]\s*/u.test(prefix)
  ) {
    flags.push(`${expectedStyle}_starts_numeric`);
  }

  if (
    expectedStyle === 'harvard-ctr'
    && !/\(\d{4}[a-z]?\)/iu.test(prefix.slice(0, 100))
  ) {
    flags.push('harvard_missing_parenthesized_year_near_start');
  }

  return {
    flags,
    proposedStyle:
      flags.length > 0 && numericProposal && expectedStyle !== numericProposal
        ? numericProposal
        : null,
  };
}

function enrichOrDefault(
  enrichments: ReadonlyMap<string, CrossrefEnrichment>,
  lookupKey: string,
): CrossrefEnrichment {
  return (
    enrichments.get(lookupKey) ?? {
      status: 'unresolved',
      match_confidence: 'none',
      fields: null,
    }
  );
}

function proposeExpectedType(
  row: PreparedStylePrecertRow,
  enrichment: CrossrefEnrichment,
): string | null {
  const crossrefType = enrichment.fields?.reference_type?.trim() ?? null;
  const currentType = row.expected_type?.trim() ?? null;
  if (!crossrefType) {
    return null;
  }
  if (enrichment.match_confidence === 'low' || enrichment.match_confidence === 'none') {
    return null;
  }
  if (crossrefType === currentType) {
    return null;
  }
  return crossrefType;
}

function determineSuggestedAction(input: {
  row: PreparedStylePrecertRow;
  issueCodes: string[];
  proposedStyle: string | null;
  proposedType: string | null;
  duplicateNoisy: boolean;
}): StylePrecertSuggestedAction {
  if (input.duplicateNoisy) {
    return 'drop_duplicate_noisy';
  }
  if (input.proposedStyle && input.proposedType) {
    return 'review_style_and_type';
  }
  if (input.proposedStyle) {
    return 'review_style';
  }
  if (input.proposedType) {
    return 'review_type';
  }
  if (input.issueCodes.length > 0) {
    return 'review_confidence';
  }
  return 'keep';
}

export function prepareStylePrecertPool(
  inputRows: StylePrecertPoolRow[],
  options: StylePrecertPrepareOptions,
): StylePrecertPreparationResult {
  const provisionalStates = inputRows.map<RowComputationState>((row, index) => {
    const lineNumber = index + 1;
    const recordId = buildRecordId(options.datasetVersion, lineNumber);
    const comparableKey = normalizeForNoiseComparable(row.raw_text);
    const extractedDoi = extractDoiFromText(row.raw_text);

    return {
      row,
      lineNumber,
      recordId,
      comparableKey,
      extractedDoi,
      exactDuplicateGroupId: null,
      normalizedDuplicateGroupId: null,
      augmentationSourceRecordId: null,
      clusterKey: '',
      lookupKey: '',
      suggestedDatasetSplit: 'train',
    };
  });

  const { exactIds, normalizedIds } = buildDuplicateGroupIds(provisionalStates);
  provisionalStates.forEach((state, index) => {
    state.exactDuplicateGroupId = exactIds.get(index) ?? null;
    state.normalizedDuplicateGroupId = normalizedIds.get(index) ?? null;
  });

  const augmentationSources = findNoisyAugmentationSources(provisionalStates);
  provisionalStates.forEach((state) => {
    state.augmentationSourceRecordId = augmentationSources.get(state.recordId) ?? null;
  });

  const byRecordId = new Map(provisionalStates.map((state) => [state.recordId, state]));

  for (const state of provisionalStates) {
    if (state.row.gold_kind === 'style_noisy' && state.augmentationSourceRecordId) {
      const source = byRecordId.get(state.augmentationSourceRecordId);
      if (source) {
        state.clusterKey = source.clusterKey || clusterKeyFromRow(source.row, source.comparableKey, source.extractedDoi);
        state.lookupKey = source.lookupKey || lookupKeyFromRow(source.row, source.extractedDoi, state.clusterKey);
      }
    }
    if (!state.clusterKey) {
      state.clusterKey = clusterKeyFromRow(state.row, state.comparableKey, state.extractedDoi);
    }
    if (!state.lookupKey) {
      state.lookupKey = lookupKeyFromRow(state.row, state.extractedDoi, state.clusterKey);
    }
    state.suggestedDatasetSplit = splitFromClusterKey(state.clusterKey);
  }

  const lookupRequestsByKey = new Map<string, StylePrecertLookupRequest>();
  for (const state of provisionalStates) {
    if (lookupRequestsByKey.has(state.lookupKey)) {
      continue;
    }
    const request: StylePrecertLookupRequest = state.lookupKey.startsWith('doi:')
      ? {
          lookupKey: state.lookupKey,
          lookupKind: 'doi',
          doi: state.lookupKey.slice(4),
          queryText: null,
          representativeRecordId: state.recordId,
        }
      : {
          lookupKey: state.lookupKey,
          lookupKind: 'bibliographic',
          doi: null,
          queryText: state.row.raw_text,
          representativeRecordId: state.recordId,
        };
    lookupRequestsByKey.set(state.lookupKey, request);
  }

  return {
    rows: provisionalStates.map((state) => ({
      ...state.row,
      record_id: state.recordId,
      dataset_version: options.datasetVersion,
      source_line_number: state.lineNumber,
      cluster_key: state.clusterKey,
      lookup_key: state.lookupKey,
      suggested_dataset_split: state.suggestedDatasetSplit,
      augmentation_source_record_id: state.augmentationSourceRecordId,
      exact_duplicate_group_id: state.exactDuplicateGroupId,
      normalized_duplicate_group_id: state.normalizedDuplicateGroupId,
    })),
    lookupRequests: [...lookupRequestsByKey.values()],
  };
}

export function certifyPreparedStylePrecertPool(
  prepared: StylePrecertPreparationResult,
  enrichments: ReadonlyMap<string, CrossrefEnrichment>,
): StylePrecertCertificationResult {
  const exactDuplicateGroups = new Map<string, PreparedStylePrecertRow[]>();
  const normalizedDuplicateGroups = new Map<string, PreparedStylePrecertRow[]>();

  for (const row of prepared.rows) {
    if (row.exact_duplicate_group_id) {
      const list = exactDuplicateGroups.get(row.exact_duplicate_group_id) ?? [];
      list.push(row);
      exactDuplicateGroups.set(row.exact_duplicate_group_id, list);
    }
    if (row.normalized_duplicate_group_id) {
      const list = normalizedDuplicateGroups.get(row.normalized_duplicate_group_id) ?? [];
      list.push(row);
      normalizedDuplicateGroups.set(row.normalized_duplicate_group_id, list);
    }
  }

  const annotatedRows = prepared.rows.map<AnnotatedStylePrecertRow>((row) => {
    const enrichment = enrichOrDefault(enrichments, row.lookup_key);
    const { flags, proposedStyle } = detectStyleMarkerFlags(row);
    const proposedType = proposeExpectedType(row, enrichment);
    const issueCodes: string[] = [];

    const exactGroup = row.exact_duplicate_group_id
      ? exactDuplicateGroups.get(row.exact_duplicate_group_id) ?? []
      : [];
    const normalizedGroup = row.normalized_duplicate_group_id
      ? normalizedDuplicateGroups.get(row.normalized_duplicate_group_id) ?? []
      : [];

    let duplicateNoisy = false;
    if (row.gold_kind === 'style_noisy' && exactGroup.some((entry) => entry.gold_kind !== 'style_noisy')) {
      issueCodes.push('duplicate_exact_clean_noisy');
      duplicateNoisy = true;
    } else if (
      row.gold_kind === 'style_noisy'
      && normalizedGroup.some((entry) => entry.gold_kind !== 'style_noisy' && entry.raw_text !== row.raw_text)
    ) {
      issueCodes.push('duplicate_normalized_clean_noisy');
      duplicateNoisy = true;
    }

    if ((row.style_confidence ?? 0) < 1) {
      issueCodes.push('style_confidence_below_1');
    }
    if ((row.style_margin_to_runner_up ?? 1) < 0.2) {
      issueCodes.push('style_margin_below_0_2');
    }
    if ((row.family_confidence ?? 1) < 0.9) {
      issueCodes.push('family_confidence_below_0_9');
    }

    if (flags.length > 0) {
      issueCodes.push('style_marker_conflict');
    }

    if (proposedType) {
      issueCodes.push('crossref_type_mismatch');
    }

    const suggestedAction = determineSuggestedAction({
      row,
      issueCodes,
      proposedStyle,
      proposedType,
      duplicateNoisy,
    });

    return {
      ...row,
      crossref_enrichment: enrichment,
      style_marker_flags: flags,
      issue_codes: issueCodes,
      suggested_action: suggestedAction,
      needs_admin_review: suggestedAction !== 'keep',
      proposed_expected_style: proposedStyle,
      proposed_expected_type: proposedType,
    };
  });

  const reviewQueue = annotatedRows.filter((row) => row.needs_admin_review);
  const sanitizedRows = annotatedRows
    .filter((row) => row.suggested_action !== 'drop_duplicate_noisy')
    .map<SanitizedStylePrecertRow>((row) => ({
      record_id: row.record_id,
      dataset_version: row.dataset_version,
      source_line_number: row.source_line_number,
      raw_text: row.raw_text,
      expected_style: row.expected_style,
      expected_type: row.expected_type ?? null,
      gold_kind: row.gold_kind,
      adversarial_pair: row.adversarial_pair ?? null,
      noise_profile: row.noise_profile ?? null,
      reference_doi: row.reference_doi ?? row.crossref_enrichment.fields?.doi ?? null,
      cluster_key: row.cluster_key,
      suggested_dataset_split: row.suggested_dataset_split,
      augmentation_source_record_id: row.augmentation_source_record_id,
      needs_admin_review: row.needs_admin_review,
      suggested_action: row.suggested_action,
      proposed_expected_style: row.proposed_expected_style,
      proposed_expected_type: row.proposed_expected_type,
    }));

  const summary: StylePrecertCertificationSummary = {
    datasetVersion: prepared.rows[0]?.dataset_version ?? 'unknown',
    totalRows: prepared.rows.length,
    reviewQueueRows: reviewQueue.length,
    sanitizedRows: sanitizedRows.length,
    droppedRows: prepared.rows.length - sanitizedRows.length,
    clusterCount: new Set(prepared.rows.map((row) => row.cluster_key)).size,
    lookupRequestCount: prepared.lookupRequests.length,
    mappedNoisyRows: prepared.rows.filter(
      (row) => row.gold_kind === 'style_noisy' && row.augmentation_source_record_id,
    ).length,
    actionCounts: countBy(annotatedRows.map((row) => row.suggested_action)),
    issueCounts: countBy(annotatedRows.flatMap((row) => row.issue_codes)),
    styleMarkerCounts: countBy(annotatedRows.flatMap((row) => row.style_marker_flags)),
    crossrefStatusCounts: countBy(annotatedRows.map((row) => row.crossref_enrichment.status)),
    leakageFieldsStripped: [...LEAKAGE_FIELDS],
  };

  return {
    rows: annotatedRows,
    reviewQueue,
    sanitizedRows,
    summary,
  };
}
