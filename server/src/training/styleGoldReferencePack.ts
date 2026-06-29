import { createHash } from 'node:crypto';
import type {
  TruthApprovalSource,
  StoredApprovedTruth,
  TruthBlockedReason,
  TruthDatasetSplit,
  TruthGoldKind,
  TruthRowStatus,
  TruthStyleEvaluationSuite,
  TruthStyleInferabilityTier,
  TruthTaskCertification,
  TruthTrustLevel,
} from '../runtime/store.js';

export interface GoldReferenceCurationReport {
  input_file?: string;
  curation_version?: string;
  curation_date?: string;
  gold_rows?: number;
  quarantine_rows?: number;
  dataset_version?: string;
  created_at_utc?: string;
  row_counts?: {
    input_rows?: number;
    gold_reference_rows?: number;
    quarantine_review_rows?: number;
    direct_import_rows?: number;
  };
  gold_kind_counts?: Record<string, number>;
  quarantine_kind_counts?: Record<string, number>;
}

export interface GoldReferenceSourceMetadata {
  gold_kind?: string | null;
  source_prefix?: string | null;
  canonical_work_key?: string | null;
  near_dup_cluster_id?: string | null;
  noise_profile?: string[] | null;
  adversarial_pair?: string | null;
}

export interface GoldReferenceGoldAuditRow {
  record_id: string;
  raw_text: string;
  expected_fields?: Record<string, unknown> | null;
  expected_style: string;
  expected_type: string;
  gold_decision: 'gold_reference';
  blocked_reason?: string | null;
  gold_reject_reasons?: string[];
  original_line_number?: number | null;
  dataset_split?: string | null;
  trust_level?: string | null;
  row_status?: string | null;
  approval_source?: string | null;
  pipeline_major?: number | null;
  dataset_version?: string | null;
  holdout_version?: string | null;
  gold_kind?: string | null;
  adversarial_pair?: string | null;
  noise_profile?: string[] | null;
  style_evaluation_suite?: string | null;
  style_inferability_tier?: string | null;
  provenance?: string | null;
  work_id?: string | null;
  family_id?: string | null;
  variant_id?: string | null;
  source_metadata?: GoldReferenceSourceMetadata | null;
}

export interface GoldReferenceQuarantineAuditRow {
  record_id: string;
  raw_text: string;
  expected_fields?: Record<string, unknown> | null;
  expected_style: null;
  expected_type: null;
  gold_decision: 'quarantine_review';
  blocked_reason?: string | null;
  gold_reject_reasons?: string[];
  original_line_number?: number | null;
  dataset_split?: string | null;
  trust_level?: string | null;
  row_status?: string | null;
  approval_source?: string | null;
  pipeline_major?: number | null;
  dataset_version?: string | null;
  holdout_version?: string | null;
  gold_kind?: string | null;
  adversarial_pair?: string | null;
  noise_profile?: string[] | null;
  style_evaluation_suite?: string | null;
  style_inferability_tier?: string | null;
  provenance?: string | null;
  work_id?: string | null;
  family_id?: string | null;
  variant_id?: string | null;
  source_metadata?: GoldReferenceSourceMetadata | null;
}

export interface GoldReferenceImportPayload {
  rawText: string;
  expectedFields: Record<string, unknown>;
  coreTruth: Record<string, unknown>;
  expectedType: string | null;
  expectedStyle: string | null;
  provenance: string;
  pipelineMajor: number | null;
  datasetSplit: TruthDatasetSplit | null;
  trustLevel: TruthTrustLevel;
  rowStatus: TruthRowStatus;
  blockedReason: TruthBlockedReason | null;
  taskCertifications: TruthTaskCertification[] | null;
  workId: string | null;
  familyId: string | null;
  canonicalWorkKey: string | null;
  nearDupClusterId: string | null;
  datasetVersion: string;
  holdoutVersion: string | null;
  styleInferabilityTier: TruthStyleInferabilityTier | null;
  styleEvaluationSuite: TruthStyleEvaluationSuite | null;
  goldKind: TruthGoldKind | null;
  adversarialPair: string | null;
  noiseProfile: string[] | null;
  isAdversarial: boolean | null;
  approvalSource: TruthApprovalSource | null;
  reviewedBy: string | null;
  notes: string | null;
  variantId: string | null;
}

export interface GoldReferenceManifestCandidateCounts {
  styleClean: number;
  styleAdversarial: number;
  styleNoisy: number;
}

export interface GoldReferenceManifest {
  datasetVersion: string;
  createdAt: string;
  includeHoldout: boolean;
  enforceDiversityGates: boolean;
  rowCount: number;
  rowIds: string[];
  inputHashes: string[];
  composition: {
    styleClean: number;
    styleAdversarial: number;
    styleNoisy: number;
    total: number;
    byStyle: Record<string, number>;
    byPair: Record<string, number>;
    byPairDirectional: Record<string, Record<string, number>>;
    byPairTypeDiversity: Record<string, number>;
    byStyleNoisyTagDiversity: Record<string, number>;
    bySource: Record<string, number>;
    byStyleCleanTypeDiversity: Record<string, number>;
  };
  candidates: GoldReferenceManifestCandidateCounts;
  manifestHash: string;
}

function trimString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value
    .map((entry) => trimString(entry))
    .filter((entry): entry is string => entry !== null);
  return normalized.length > 0 ? normalized : null;
}

function normalizeGoldKind(value: unknown): TruthGoldKind | null {
  const normalized = trimString(value);
  if (
    normalized === 'style_clean'
    || normalized === 'style_adversarial'
    || normalized === 'style_noisy'
    || normalized === 'field_span'
    || normalized === 'authority_seed'
    || normalized === 'overlay_accept'
  ) {
    return normalized;
  }
  return null;
}

function normalizeTrustLevel(value: unknown): TruthTrustLevel | null {
  const normalized = trimString(value);
  if (normalized === 'draft' || normalized === 'reviewed' || normalized === 'gold') {
    return normalized;
  }
  return null;
}

function normalizeRowStatus(value: unknown): TruthRowStatus | null {
  const normalized = trimString(value);
  if (normalized === 'draft' || normalized === 'reviewed' || normalized === 'quarantined') {
    return normalized;
  }
  return null;
}

function normalizeBlockedReason(value: unknown): TruthBlockedReason | null {
  const normalized = trimString(value);
  switch (normalized) {
    case 'source_conflict':
    case 'inferability_conflict':
    case 'canonicalization_unclear':
    case 'split_leakage':
    case 'identifier_invalid':
    case 'evidence_missing':
    case 'review_conflict':
    case 'family_incompatible':
    case 'provider_only_fact':
    case 'needs_research':
      return normalized;
    default:
      return null;
  }
}

function normalizeApprovalSource(value: unknown): TruthApprovalSource | null {
  const normalized = trimString(value);
  if (normalized === 'manual' || normalized === 'learning_queue' || normalized === 'overlay_accept') {
    return normalized;
  }
  return null;
}

function normalizeStyleInferabilityTier(value: unknown): TruthStyleInferabilityTier | null {
  const normalized = trimString(value);
  switch (normalized) {
    case 'tier1_exact_direct':
    case 'tier2_exact_policy_resolved':
    case 'tier3_family_only':
    case 'tier4_not_inferable':
      return normalized;
    default:
      return null;
  }
}

function normalizeStyleEvaluationSuite(value: unknown): TruthStyleEvaluationSuite | null {
  const normalized = trimString(value);
  switch (normalized) {
    case 'supported_exact':
    case 'supported_family_only':
    case 'unsupported_exact':
    case 'unknown_or_ood':
    case 'not_citation_like':
      return normalized;
    default:
      return null;
  }
}

function normalizePipelineMajor(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function normalizeExpectedFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

function hashManifest(
  manifest: Omit<GoldReferenceManifest, 'manifestHash'>,
): string {
  return createHash('sha256').update(stableStringify(manifest)).digest('hex');
}

function buildImportNote(input: {
  recordId: string;
  decision: 'gold_reference' | 'quarantine_review';
  lineNumber?: number | null | undefined;
  rejectReasons?: string[] | undefined;
  sourceProvenance?: string | null | undefined;
  storedProvenance?: string | null | undefined;
}): string {
  const parts = [`Imported from style core reference pack record ${input.recordId}`];
  parts.push(`decision=${input.decision}`);
  if (typeof input.lineNumber === 'number' && Number.isInteger(input.lineNumber) && input.lineNumber > 0) {
    parts.push(`source_line=${input.lineNumber}`);
  }
  const rejectReasons = (input.rejectReasons ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (rejectReasons.length > 0) {
    parts.push(`reject_reasons=${rejectReasons.join(',')}`);
  }
  if (
    input.sourceProvenance
    && input.storedProvenance
    && input.sourceProvenance !== input.storedProvenance
  ) {
    parts.push(`pack_provenance=${input.sourceProvenance}`);
  }
  return parts.join('; ');
}

function resolveProvenance(
  provenance: unknown,
  sourceMetadata?: GoldReferenceSourceMetadata | null,
): string {
  const direct = trimString(provenance);
  if (direct) {
    const firstSegment = direct.split(';').map((entry) => entry.trim()).find(Boolean) ?? null;
    if (firstSegment && firstSegment.length <= 50) {
      return firstSegment;
    }
  }
  const prefix = trimString(sourceMetadata?.source_prefix);
  if (prefix) {
    return `crossref:${prefix}`;
  }
  if (direct) {
    return direct.slice(0, 50);
  }
  return 'style_core_gold_reference_pack';
}

function blockedReasonForRejectReasons(rejectReasons: readonly string[]): TruthBlockedReason | null {
  const reasons = rejectReasons.map((entry) => entry.trim()).filter(Boolean);
  if (reasons.includes('duplicate_normalized_raw_text')) {
    return 'canonicalization_unclear';
  }
  if (reasons.length > 0) {
    return 'needs_research';
  }
  return null;
}

export function normalizeGoldReferenceDatasetSplit(
  value: string | null | undefined,
): TruthDatasetSplit | null {
  const normalized = trimString(value);
  switch (normalized) {
    case 'train':
      return 'train';
    case 'validation':
    case 'val':
      return 'val';
    case 'test':
      return 'test';
    case 'holdout':
      return 'holdout';
    default:
      return null;
  }
}

export function buildGoldReferenceStyleCertification(
  reviewedBy: string,
  certifiedAt: string,
): TruthTaskCertification[] {
  return [
    {
      task: 'style',
      truthScope: 'core',
      status: 'certified',
      certifiedAt,
      certifiedBy: reviewedBy,
      requiredReviewPasses: 1,
      completedReviewPasses: 1,
      pass1Hash: null,
      pass2Hash: null,
    },
  ];
}

export function goldReferenceManifestCandidateCounts(
  report: GoldReferenceCurationReport,
): GoldReferenceManifestCandidateCounts {
  const goldCounts = report.gold_kind_counts ?? {};
  const quarantineCounts = report.quarantine_kind_counts ?? {};
  return {
    styleClean: (goldCounts.style_clean ?? 0) + (quarantineCounts.style_clean ?? 0),
    styleAdversarial: (goldCounts.style_adversarial ?? 0) + (quarantineCounts.style_adversarial ?? 0),
    styleNoisy: (goldCounts.style_noisy ?? 0) + (quarantineCounts.style_noisy ?? 0),
  };
}

export function goldReferenceManifestCandidateCountsFromRows(
  rows: ReadonlyArray<{
    gold_kind?: string | null;
    source_metadata?: GoldReferenceSourceMetadata | null;
  }>,
): GoldReferenceManifestCandidateCounts {
  const counts: GoldReferenceManifestCandidateCounts = {
    styleClean: 0,
    styleAdversarial: 0,
    styleNoisy: 0,
  };

  for (const row of rows) {
    const goldKind = normalizeGoldKind(row.gold_kind ?? row.source_metadata?.gold_kind);
    if (goldKind === 'style_clean') {
      counts.styleClean += 1;
    } else if (goldKind === 'style_adversarial') {
      counts.styleAdversarial += 1;
    } else if (goldKind === 'style_noisy') {
      counts.styleNoisy += 1;
    }
  }

  return counts;
}

export function resolveGoldReferenceReportDatasetVersion(
  report: GoldReferenceCurationReport,
): string | null {
  return trimString(report.dataset_version) ?? trimString(report.curation_version);
}

export function resolveGoldReferenceReportInputFile(
  report: GoldReferenceCurationReport,
): string | null {
  return trimString(report.input_file);
}

export function resolveGoldReferenceReportCreatedAt(
  report: GoldReferenceCurationReport,
): string | null {
  return trimString(report.created_at_utc) ?? trimString(report.curation_date);
}

export function resolveGoldReferenceReportGoldRows(
  report: GoldReferenceCurationReport,
): number {
  if (typeof report.row_counts?.gold_reference_rows === 'number') {
    return report.row_counts.gold_reference_rows;
  }
  return typeof report.gold_rows === 'number' ? report.gold_rows : 0;
}

export function resolveGoldReferenceReportQuarantineRows(
  report: GoldReferenceCurationReport,
): number {
  if (typeof report.row_counts?.quarantine_review_rows === 'number') {
    return report.row_counts.quarantine_review_rows;
  }
  return typeof report.quarantine_rows === 'number' ? report.quarantine_rows : 0;
}

export function mapGoldReferenceGoldRowToApprovedTruth(
  row: GoldReferenceGoldAuditRow,
  options: {
    datasetVersion: string;
    reviewedBy: string;
    certifiedAt: string;
  },
): GoldReferenceImportPayload {
  const trustLevel = normalizeTrustLevel(row.trust_level) ?? 'gold';
  const goldKind = normalizeGoldKind(row.gold_kind ?? row.source_metadata?.gold_kind);
  const expectedFields = normalizeExpectedFields(row.expected_fields);
  const familyId = trimString(row.family_id);
  const workId = trimString(row.work_id);
  const sourceProvenance = trimString(row.provenance);
  const storedProvenance = resolveProvenance(sourceProvenance, row.source_metadata);
  return {
    rawText: row.raw_text.trim(),
    expectedFields,
    coreTruth: expectedFields,
    expectedType: row.expected_type.trim(),
    expectedStyle: row.expected_style.trim(),
    provenance: storedProvenance,
    pipelineMajor: normalizePipelineMajor(row.pipeline_major),
    datasetSplit: normalizeGoldReferenceDatasetSplit(row.dataset_split),
    trustLevel,
    rowStatus: normalizeRowStatus(row.row_status) ?? 'reviewed',
    blockedReason: normalizeBlockedReason(row.blocked_reason),
    taskCertifications:
      trustLevel === 'gold'
        ? buildGoldReferenceStyleCertification(options.reviewedBy, options.certifiedAt)
        : null,
    workId,
    familyId,
    canonicalWorkKey:
      trimString(row.source_metadata?.canonical_work_key)
      ?? familyId
      ?? workId,
    nearDupClusterId:
      trimString(row.source_metadata?.near_dup_cluster_id)
      ?? familyId
      ?? workId,
    datasetVersion: options.datasetVersion,
    holdoutVersion: trimString(row.holdout_version),
    styleInferabilityTier:
      normalizeStyleInferabilityTier(row.style_inferability_tier)
      ?? 'tier2_exact_policy_resolved',
    styleEvaluationSuite:
      normalizeStyleEvaluationSuite(row.style_evaluation_suite)
      ?? 'supported_exact',
    goldKind,
    adversarialPair: trimString(row.adversarial_pair ?? row.source_metadata?.adversarial_pair),
    noiseProfile: normalizeStringArray(row.noise_profile ?? row.source_metadata?.noise_profile),
    isAdversarial: goldKind === 'style_adversarial',
    approvalSource: normalizeApprovalSource(row.approval_source),
    reviewedBy: trustLevel === 'draft' ? null : options.reviewedBy,
    notes: buildImportNote({
      recordId: row.record_id,
      decision: row.gold_decision,
      lineNumber: row.original_line_number,
      rejectReasons: row.gold_reject_reasons,
      sourceProvenance,
      storedProvenance,
    }),
    variantId: trimString(row.variant_id) ?? row.record_id,
  };
}

export function mapGoldReferenceQuarantineRowToApprovedTruth(
  row: GoldReferenceQuarantineAuditRow,
  options: {
    datasetVersion: string;
    reviewedBy: string;
  },
): GoldReferenceImportPayload {
  const rejectReasons = (row.gold_reject_reasons ?? []).map((entry) => entry.trim()).filter(Boolean);
  const trustLevel = normalizeTrustLevel(row.trust_level) ?? 'reviewed';
  const goldKind = normalizeGoldKind(row.gold_kind ?? row.source_metadata?.gold_kind);
  const expectedFields = normalizeExpectedFields(row.expected_fields);
  const familyId = trimString(row.family_id);
  const workId = trimString(row.work_id);
  const sourceProvenance = trimString(row.provenance);
  const storedProvenance = resolveProvenance(sourceProvenance, row.source_metadata);
  return {
    rawText: row.raw_text.trim(),
    expectedFields,
    coreTruth: expectedFields,
    expectedType: null,
    expectedStyle: null,
    provenance: storedProvenance,
    pipelineMajor: normalizePipelineMajor(row.pipeline_major),
    datasetSplit: normalizeGoldReferenceDatasetSplit(row.dataset_split),
    trustLevel,
    rowStatus: normalizeRowStatus(row.row_status) ?? 'quarantined',
    blockedReason:
      normalizeBlockedReason(row.blocked_reason)
      ?? blockedReasonForRejectReasons(rejectReasons),
    taskCertifications: null,
    workId,
    familyId,
    canonicalWorkKey:
      trimString(row.source_metadata?.canonical_work_key)
      ?? familyId
      ?? workId,
    nearDupClusterId:
      trimString(row.source_metadata?.near_dup_cluster_id)
      ?? familyId
      ?? workId,
    datasetVersion: options.datasetVersion,
    holdoutVersion: trimString(row.holdout_version),
    styleInferabilityTier: normalizeStyleInferabilityTier(row.style_inferability_tier),
    styleEvaluationSuite: normalizeStyleEvaluationSuite(row.style_evaluation_suite),
    goldKind,
    adversarialPair: trimString(row.adversarial_pair ?? row.source_metadata?.adversarial_pair),
    noiseProfile: normalizeStringArray(row.noise_profile ?? row.source_metadata?.noise_profile),
    isAdversarial: goldKind === 'style_adversarial',
    approvalSource: normalizeApprovalSource(row.approval_source),
    reviewedBy: trustLevel === 'draft' ? null : options.reviewedBy,
    notes: buildImportNote({
      recordId: row.record_id,
      decision: row.gold_decision,
      lineNumber: row.original_line_number,
      rejectReasons,
      sourceProvenance,
      storedProvenance,
    }),
    variantId: trimString(row.variant_id) ?? row.record_id,
  };
}

function countRowsByStyle(rows: StoredApprovedTruth[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const style = trimString(row.expectedStyle);
    if (!style) {
      continue;
    }
    counts[style] = (counts[style] ?? 0) + 1;
  }
  return counts;
}

function countRowsByPair(rows: StoredApprovedTruth[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const pair = trimString(row.adversarialPair);
    if (!pair) {
      continue;
    }
    counts[pair] = (counts[pair] ?? 0) + 1;
  }
  return counts;
}

function countPairDirectional(rows: StoredApprovedTruth[]): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const pair = trimString(row.adversarialPair);
    const style = trimString(row.expectedStyle);
    if (!pair || !style) {
      continue;
    }
    counts[pair] ??= {};
    counts[pair]![style] = (counts[pair]![style] ?? 0) + 1;
  }
  return counts;
}

function countPairTypeDiversity(rows: StoredApprovedTruth[]): Record<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const pair = trimString(row.adversarialPair);
    const expectedType = trimString(row.expectedType);
    if (!pair || !expectedType) {
      continue;
    }
    seen.set(pair, seen.get(pair) ?? new Set<string>());
    seen.get(pair)!.add(expectedType);
  }
  const counts: Record<string, number> = {};
  for (const [pair, values] of seen) {
    counts[pair] = values.size;
  }
  return counts;
}

function countNoisyTagDiversity(rows: StoredApprovedTruth[]): Record<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const style = trimString(row.expectedStyle);
    if (!style) {
      continue;
    }
    seen.set(style, seen.get(style) ?? new Set<string>());
    for (const tag of row.noiseProfile ?? []) {
      const normalized = trimString(tag);
      if (normalized) {
        seen.get(style)!.add(normalized);
      }
    }
  }
  const counts: Record<string, number> = {};
  for (const [style, values] of seen) {
    counts[style] = values.size;
  }
  return counts;
}

function countSourceDistribution(rows: StoredApprovedTruth[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const source = trimString(row.provenance)?.toLowerCase() ?? 'unknown';
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

function countStyleCleanTypeDiversity(rows: StoredApprovedTruth[]): Record<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.goldKind !== 'style_clean') {
      continue;
    }
    const style = trimString(row.expectedStyle);
    const expectedType = trimString(row.expectedType);
    if (!style || !expectedType) {
      continue;
    }
    seen.set(style, seen.get(style) ?? new Set<string>());
    seen.get(style)!.add(expectedType);
  }
  const counts: Record<string, number> = {};
  for (const [style, values] of seen) {
    counts[style] = values.size;
  }
  return counts;
}

export function buildGoldReferenceManifest(
  rows: StoredApprovedTruth[],
  input: {
    datasetVersion: string;
    createdAt: string;
    candidates: GoldReferenceManifestCandidateCounts;
  },
): GoldReferenceManifest {
  const styleCleanRows = rows.filter((row) => row.goldKind === 'style_clean');
  const styleAdversarialRows = rows.filter((row) => row.goldKind === 'style_adversarial');
  const styleNoisyRows = rows.filter((row) => row.goldKind === 'style_noisy');

  const base: Omit<GoldReferenceManifest, 'manifestHash'> = {
    datasetVersion: input.datasetVersion,
    createdAt: input.createdAt,
    includeHoldout: false,
    enforceDiversityGates: false,
    rowCount: rows.length,
    rowIds: rows.map((row) => row.id).sort(),
    inputHashes: rows.map((row) => row.inputHash).sort(),
    composition: {
      styleClean: styleCleanRows.length,
      styleAdversarial: styleAdversarialRows.length,
      styleNoisy: styleNoisyRows.length,
      total: rows.length,
      byStyle: countRowsByStyle(rows),
      byPair: countRowsByPair(styleAdversarialRows),
      byPairDirectional: countPairDirectional(styleAdversarialRows),
      byPairTypeDiversity: countPairTypeDiversity(styleAdversarialRows),
      byStyleNoisyTagDiversity: countNoisyTagDiversity(styleNoisyRows),
      bySource: countSourceDistribution(rows),
      byStyleCleanTypeDiversity: countStyleCleanTypeDiversity(styleCleanRows),
    },
    candidates: input.candidates,
  };

  return {
    ...base,
    manifestHash: hashManifest(base),
  };
}
