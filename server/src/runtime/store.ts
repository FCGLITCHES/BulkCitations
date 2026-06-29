import type {
  ConvertRequest,
  ConvertResponse,
  ExportFormat,
  JobProgress,
} from '../engine/types/api.js';
import type { ProcessedCitation } from '../engine/types/citation.js';
import type { CitationExtractionHistoryRow } from '../engine/types/extractionMeta.js';
import { randomUUID } from 'node:crypto';
import { hashInputForTruth } from '../training/truthHash.js';
import type { TruthFieldValue } from '../training/truthFields.js';
import { PersistenceConflictError } from './persistenceErrors.js';
import { groupLearningQueueItems } from './learningQueueGroups.js';

export interface StoredEvent {
  id: number;
  event: string;
  data: unknown;
}

export type StoredJobStatus = 'pending' | 'processing' | 'completed' | 'partial' | 'failed';

export interface StoredExport {
  format: ExportFormat;
  content?: string | Buffer;
  contentType: string;
  fileName: string;
  generatedAt: string;
  delivery?: 'inline' | 'signed_url';
  storageKey?: string;
  downloadUrl?: string;
  expiresAt?: string;
  sizeBytes?: number;
}

export interface StoredJob {
  id: string;
  request: ConvertRequest;
  userId?: string;
  orgId?: string;
  apiKeyId?: string;
  tier?: 'anonymous' | 'free' | 'pro' | 'b2b';
  executionMode: 'sync' | 'async';
  status: StoredJobStatus;
  createdAt: string;
  completedAt?: string;
  progress?: JobProgress;
  result?: ConvertResponse;
  textExport?: string;
  exports: Partial<Record<ExportFormat, StoredExport>>;
  error?: {
    code: string;
    message: string;
  };
  events: StoredEvent[];
}

export interface StoredCorrection {
  id: string;
  jobId: string;
  citationId: string;
  userId?: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export interface StoredReviewEvent {
  id: string;
  type: 'comment' | 'assign' | 'resolve' | 'duplicate' | 'reject' | 'truth_saved' | 'pattern_exported' | 'regression_generated';
  actor: string;
  createdAt: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface StoredFieldApprovalDecision {
  approved: boolean;
  value?: unknown;
  note?: string;
}

export type StoredFieldApprovalMap = Partial<Record<
  | 'authors'
  | 'title'
  | 'year'
  | 'journal'
  | 'volume'
  | 'issue'
  | 'pages'
  | 'doi'
  | 'publisher'
  | 'url'
  | 'conferenceTitle'
  | 'bookTitle'
  | 'institution'
  | 'edition'
  | 'editor'
  | 'referenceType',
  StoredFieldApprovalDecision
>>;

export type StoredReportDuplicateDecision =
  | 'not_applicable'
  | 'confirmed_duplicate'
  | 'confirmed_unique'
  | 'needs_review';

export interface StoredReportResolutionTrace {
  resolvedByCommit?: string;
  resolvedByVersion?: string;
  resolvedAt?: string;
  note?: string;
}

export interface StoredProposedPattern {
  id?: string;
  regex: string;
  replacement?: string;
  description?: string;
  category?: string;
  priority?: number;
  fields?: Record<string, number>;
}

export interface StoredReportReviewState {
  assigneeName?: string;
  reviewEvents?: StoredReviewEvent[];
  fieldApproval?: StoredFieldApprovalMap;
  failureTaxonomy?: string[];
  duplicateDecision?: StoredReportDuplicateDecision;
  fixType?: 'dynamic-pattern' | 'parser-logic' | 'scoring-tweak' | 'renderer-fix' | 'type-correction' | 'other-fix';
  referenceType?: string;
  proposedPattern?: StoredProposedPattern;
  proposedStyleFix?: string;
  resolvedByCommit?: string;
  resolvedByVersion?: string;
}

export interface StoredReport {
  id: string;
  jobId: string;
  citationId: string;
  userId?: string;
  source?: 'user' | 'auto' | 'user-edit';
  failureCategory: string;
  failureCategories?: string[];
  userNote?: string;
  status: 'pending' | 'proposed' | 'accepted' | 'rejected' | 'duplicate';
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  correctedFields?: Record<string, unknown>;
  stageBlame?: string[];
  resolutionTrace?: StoredReportResolutionTrace;
  reviewState?: StoredReportReviewState;
  engineSnapshot?: Record<string, unknown>;
  fingerprint?: string;
  reportCount?: number;
}

export interface StoredMutationOptions {
  expectedUpdatedAt?: string;
}

export interface StoredApiKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  tier: 'free' | 'pro' | 'b2b';
  rawKey: string;
  createdAt: string;
}

export interface StoredCitationVersion {
  id: string;
  citationId: string;
  jobId: string;
  versionNumber: number;
  fields: ProcessedCitation['fields'];
  source: string;
  createdAt: string;
}

export interface StoredBatchHealthSummary {
  jobId: string;
  ownerLabel: string;
  ownerType: 'institution' | 'user' | 'api_key' | 'guest';
  outputStyle?: string | null;
  createdAt: string;
  latestActionableAt?: string | null;
  totalCitations: number;
  flaggedCitationCount: number;
  counts: {
    ready: number;
    needsReview: number;
    needsAction: number;
  };
  openReportCounts: {
    pending: number;
    proposed: number;
    total: number;
  };
  healthLabel: 'Ready' | 'Review' | 'Action Needed';
  queueSource: 'pipeline_only' | 'reports_only' | 'both' | 'none';
  inQueue: boolean;
  lastSyncedAt: string;
}

export type StoredAdminReferenceHealthLabel = StoredBatchHealthSummary['healthLabel'];
export type StoredAdminReferenceOwnerType = StoredBatchHealthSummary['ownerType'];
export type StoredAdminReferenceStorageStatus = 'active' | 'duplicate' | 'failed';

export interface StoredAdminReferenceArchiveItem {
  citationId: string;
  jobId: string;
  referenceIndex: number;
  ownerLabel: string;
  ownerType: StoredAdminReferenceOwnerType;
  outputStyle?: string | null;
  detectedStyle?: string | null;
  referenceType?: string | null;
  publicStatus: ProcessedCitation['publicStatus'];
  storageStatus: StoredAdminReferenceStorageStatus;
  healthLabel: StoredAdminReferenceHealthLabel;
  rawText: string;
  renderedText?: string | null;
  batchCreatedAt: string;
  createdAt: string;
  updatedAt: string;
  latestActivityAt: string;
  openReportCounts: {
    pending: number;
    proposed: number;
    total: number;
  };
}

export interface StoredAdminReferenceArchiveFilters {
  limit: number;
  offset: number;
  healthLabel?: StoredAdminReferenceHealthLabel;
  storageStatus?: StoredAdminReferenceStorageStatus;
  ownerType?: StoredAdminReferenceOwnerType;
  ownerQuery?: string;
  jobQuery?: string;
}

export interface StoredAdminReferenceArchiveResult {
  references: StoredAdminReferenceArchiveItem[];
  total: number;
}

export interface LearningQueueItem {
  id: string;
  citationId: string;
  jobId: string;
  source: 'user_edit' | 'user_report';
  priority: number;
  trainingData: Record<string, unknown>;
  processed: boolean;
  processedAt?: string | null;
  createdAt: string;
  promotedToTruthId?: string | null;
  duplicateCount?: number;
  groupedQueueIds?: string[];
  groupedSources?: Array<'user_edit' | 'user_report'>;
}

export type TruthDatasetSplit = 'train' | 'val' | 'test' | 'holdout';
export type TruthTrustLevel = 'draft' | 'reviewed' | 'gold';
export type TruthRowStatus = 'draft' | 'reviewed' | 'quarantined';
export type TruthGoldKind =
  | 'style_clean'
  | 'style_adversarial'
  | 'style_noisy'
  | 'field_span'
  | 'authority_seed'
  | 'overlay_accept';
export type TruthApprovalSource = 'manual' | 'learning_queue' | 'overlay_accept';
export type TruthAuditReasonCode =
  | 'manual_correction'
  | 'sync_expected_to_core'
  | 'source_verification'
  | 'crossref_alignment'
  | 'engine_prefill_alignment'
  | 'regression_fix'
  | 'governance_metadata_update';
export type TruthTask = 'style' | 'field' | 'authority_pack' | 'overlay_learning';
export type TruthScope = 'core' | 'overlay';
export type TruthTaskCertificationStatus = 'candidate' | 'certified';
export type TrainingPackTarget =
  | 'style_core_gold'
  | 'approved_overlay_changes'
  | 'citation_bio_supervision'
  | 'authority_pack'
  | 'render_variant_augmentation'
  | 'regression_fixtures';
export type TruthStyleInferabilityTier =
  | 'tier1_exact_direct'
  | 'tier2_exact_policy_resolved'
  | 'tier3_family_only'
  | 'tier4_not_inferable';
export type TruthDifficultyTier = 'low' | 'medium' | 'high' | 'very_high';
export type TruthStyleEvaluationSuite =
  | 'supported_exact'
  | 'supported_family_only'
  | 'unsupported_exact'
  | 'unknown_or_ood'
  | 'not_citation_like';
export type TruthInputProfile =
  | 'doi_list'
  | 'structured_clean'
  | 'structured_noisy'
  | 'pasted_pdf_copy'
  | 'multiline_numbered'
  | 'ocr_like';
export type TruthInferabilityTier = 'raw_visible' | 'local_authority_derivable' | 'overlay_only';
export type TruthRenderVariantStyle =
  | 'apa7'
  | 'harvard-ctr'
  | 'chicago-notes-bib'
  | 'vancouver'
  | 'ieee'
  | 'mla9';
export type TruthRenderVariantSourceKind = 'generated' | 'admin_authored';
export type TruthRenderVariantApprovalStatus = 'draft' | 'reviewed' | 'approved';
export type TruthRenderVariantQualityTier = 'gold';
export type TruthRenderVariantDatasetLane = 'augmentation';
export type TruthBlockedReason =
  | 'source_conflict'
  | 'inferability_conflict'
  | 'canonicalization_unclear'
  | 'split_leakage'
  | 'identifier_invalid'
  | 'evidence_missing'
  | 'review_conflict'
  | 'family_incompatible'
  | 'provider_only_fact'
  | 'needs_research';

export interface TruthTaskCertification {
  task: TruthTask;
  truthScope: TruthScope;
  status: TruthTaskCertificationStatus;
  certifiedAt?: string | null;
  certifiedBy?: string | null;
  requiredReviewPasses: number;
  completedReviewPasses: number;
  pass1Hash?: string | null;
  pass2Hash?: string | null;
  packTarget?: TrainingPackTarget | null | undefined;
  stagedBundleId?: string | null | undefined;
  stagedAt?: string | null | undefined;
}

export interface StoredApprovedTruth {
  id: string;
  inputHash: string;
  rawText: string;
  expectedFields: Record<string, TruthFieldValue>;
  coreTruth?: Record<string, TruthFieldValue> | null;
  overlayTruth?: Record<string, TruthFieldValue> | null;
  expectedType?: string | null;
  expectedStyle?: string | null;
  provenance?: string | null;
  pipelineMajor?: number | null;
  datasetSplit?: TruthDatasetSplit | null;
  trustLevel: TruthTrustLevel;
  rowStatus?: TruthRowStatus;
  blockedReason?: TruthBlockedReason | null;
  taskCertifications?: TruthTaskCertification[] | null;
  workId?: string | null;
  familyId?: string | null;
  variantId?: string | null;
  canonicalWorkKey?: string | null;
  nearDupClusterId?: string | null;
  datasetVersion?: string | null;
  inputProfile?: TruthInputProfile | null;
  styleInferabilityTier?: TruthStyleInferabilityTier | null;
  styleEvaluationSuite?: TruthStyleEvaluationSuite | null;
  isAdversarial?: boolean | null;
  difficultyTier?: TruthDifficultyTier | null;
  highImpact?: boolean | null;
  highImpactReason?: string | null;
  holdoutVersion?: string | null;
  inferabilityByField?: Record<string, TruthInferabilityTier> | null;
  goldKind?: TruthGoldKind | null;
  adversarialPair?: string | null;
  noiseProfile?: string[] | null;
  approvalSource?: TruthApprovalSource | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredApprovedTruthRenderVariant {
  id: string;
  truthRowId: string;
  style: TruthRenderVariantStyle;
  generatedText: string;
  renderedText: string;
  sourceKind: TruthRenderVariantSourceKind;
  approvalStatus: TruthRenderVariantApprovalStatus;
  qualityTier: TruthRenderVariantQualityTier;
  datasetLane: TruthRenderVariantDatasetLane;
  rendererVersion: string;
  stale: boolean;
  generatedAt: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedTruthEditorDraftPayload {
  mode: 'create' | 'edit';
  editingId?: string | null;
  rawText: string;
  expectedFieldValues: Record<string, string>;
  engineRenderedOutput: string;
  enginePreviewWarnings: string[];
  enginePreviewStale: boolean;
  expectedOutputDirty: boolean;
  expectedType: string;
  expectedStyle: string;
  provenance: string;
  pipelineMajor: string;
  datasetSplit: TruthDatasetSplit | '';
  trustLevel: TruthTrustLevel;
  rowStatus: TruthRowStatus;
  blockedReason: TruthBlockedReason | '';
  goldKind: TruthGoldKind | '';
  adversarialPair: string;
  noiseProfile: string;
  approvalSource: TruthApprovalSource | '';
  reviewedBy: string;
  auditReasonCode: TruthAuditReasonCode | '';
  notes: string;
}

export interface StoredApprovedTruthEditorDraft {
  id: string;
  userId: string;
  payload: ApprovedTruthEditorDraftPayload;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCitationExtractionHistory extends CitationExtractionHistoryRow {}

export interface StoredEgressEvent {
  id: string;
  correlationId: string;
  provider: string;
  route: string;
  method: string;
  status: number;
  requestBodyBytes: number;
  responseBodyBytes: number;
  latencyMs: number;
  cacheHit: boolean;
  createdAt: string;
}

export interface StoredEgressRollup {
  period: string; // YYYY-MM-DD (daily) or YYYY-MM (monthly)
  provider: string;
  route: string;
  calls: number;
  cacheHits: number;
  requestBodyBytes: number;
  responseBodyBytes: number;
}

const jobs = new Map<string, StoredJob>();
const corrections = new Map<string, StoredCorrection>();
const reports = new Map<string, StoredReport>();
const apiKeys = new Map<string, StoredApiKey>();
const citationVersions = new Map<string, StoredCitationVersion[]>();
const citationExtractionHistory = new Map<string, StoredCitationExtractionHistory[]>();
const learningQueue = new Map<string, LearningQueueItem>();
const approvedTruthById = new Map<string, StoredApprovedTruth>();
const approvedTruthRenderVariantsById = new Map<string, StoredApprovedTruthRenderVariant>();
const approvedTruthEditorDraftsByUserId = new Map<string, StoredApprovedTruthEditorDraft>();
const batchHealthSummaries = new Map<string, StoredBatchHealthSummary>();
const usageByDay = new Map<string, number>();
const egressEvents: StoredEgressEvent[] = [];
const egressDaily = new Map<string, StoredEgressRollup>();
const egressMonthly = new Map<string, StoredEgressRollup>();

export function saveJob(job: StoredJob): void {
  jobs.set(job.id, job);
}

export function getJob(id: string): StoredJob | undefined {
  return jobs.get(id);
}

export function listJobs(): StoredJob[] {
  return [...jobs.values()];
}

export function updateJob(id: string, updater: (job: StoredJob) => void): StoredJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  updater(job);
  jobs.set(id, job);
  return job;
}

export function appendJobEvent(jobId: string, event: Omit<StoredEvent, 'id'>): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const nextId = job.events.length + 1;
  job.events.push({ id: nextId, ...event });
}

export function saveJobExport(jobId: string, artifact: StoredExport): void {
  updateJob(jobId, (job) => {
    job.exports[artifact.format] = artifact;
  });
}

export function getJobExport(jobId: string, format: ExportFormat): StoredExport | undefined {
  return jobs.get(jobId)?.exports[format];
}

export function listJobExports(jobId: string): StoredExport[] {
  const job = jobs.get(jobId);
  if (!job) return [];
  return Object.values(job.exports).filter((artifact): artifact is StoredExport => artifact != null);
}

export function getCitation(jobId: string, citationId: string): ProcessedCitation | undefined {
  return jobs.get(jobId)?.result?.references.find((citation) => citation.id === citationId);
}

export function updateCitation(
  jobId: string,
  citationId: string,
  updater: (citation: ProcessedCitation) => void,
): ProcessedCitation | undefined {
  const job = jobs.get(jobId);
  if (!job?.result) return undefined;

  const index = job.result.references.findIndex((citation) => citation.id === citationId);
  if (index < 0) return undefined;

  const citation = structuredClone(job.result.references[index]!);
  updater(citation);
  const now = new Date().toISOString();
  citation.createdAt ??= now;
  citation.updatedAt = now;
  job.result.references[index] = citation;
  return citation;
}

export function saveCorrection(correction: StoredCorrection): void {
  corrections.set(correction.id, correction);
}

export function getCorrection(id: string): StoredCorrection | undefined {
  return corrections.get(id);
}

export function listCorrections(): StoredCorrection[] {
  return [...corrections.values()];
}

export function updateCorrection(
  id: string,
  updater: (correction: StoredCorrection) => void,
): StoredCorrection | undefined {
  const correction = corrections.get(id);
  if (!correction) return undefined;
  updater(correction);
  correction.updatedAt = new Date().toISOString();
  corrections.set(id, correction);
  return correction;
}

export function saveReport(report: StoredReport): void {
  reports.set(report.id, report);
}

export function getReport(id: string): StoredReport | undefined {
  return reports.get(id);
}

export function listReports(): StoredReport[] {
  return [...reports.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listReportsByJobId(jobId: string): StoredReport[] {
  return listReports().filter((report) => report.jobId === jobId);
}

export function updateReport(
  id: string,
  updater: (report: StoredReport) => void,
  options?: StoredMutationOptions,
): StoredReport | undefined {
  const report = reports.get(id);
  if (!report) return undefined;
  if (options?.expectedUpdatedAt && report.updatedAt !== options.expectedUpdatedAt) {
    throw new PersistenceConflictError(
      `Report ${id} has changed since it was loaded.`,
      report.updatedAt,
    );
  }
  updater(report);
  report.updatedAt = new Date().toISOString();
  if (report.status === 'accepted' || report.status === 'rejected' || report.status === 'duplicate') {
    report.resolvedAt ??= report.updatedAt;
  } else {
    delete report.resolvedAt;
  }
  reports.set(id, report);
  return report;
}

export function deleteReports(ids: string[]): number {
  let removed = 0;
  for (const id of ids) {
    if (reports.delete(id)) removed += 1;
  }
  return removed;
}

export function saveBatchHealthSummary(
  summary: StoredBatchHealthSummary,
  _options?: { logErrors?: boolean },
): StoredBatchHealthSummary {
  batchHealthSummaries.set(summary.jobId, summary);
  return summary;
}

export function getBatchHealthSummary(jobId: string): StoredBatchHealthSummary | undefined {
  return batchHealthSummaries.get(jobId);
}

export function listBatchHealthSummaries(): StoredBatchHealthSummary[] {
  return [...batchHealthSummaries.values()].sort((left, right) => {
    const leftTime = new Date(left.latestActionableAt ?? left.createdAt).getTime();
    const rightTime = new Date(right.latestActionableAt ?? right.createdAt).getTime();
    return rightTime - leftTime;
  });
}

function referenceHealthLabel(
  publicStatus: ProcessedCitation['publicStatus'],
  openReportTotal: number,
): StoredAdminReferenceHealthLabel {
  if (publicStatus === 'needs_action') {
    return 'Action Needed';
  }
  if (publicStatus === 'needs_review' || openReportTotal > 0) {
    return 'Review';
  }
  return 'Ready';
}

function referenceStorageStatus(
  citation: ProcessedCitation,
): StoredAdminReferenceStorageStatus {
  if (citation.status === 'error') {
    return 'failed';
  }
  if (citation.duplicateOf) {
    return 'duplicate';
  }
  return 'active';
}

function resolveStoredOwner(job: StoredJob): {
  ownerLabel: string;
  ownerType: StoredAdminReferenceOwnerType;
} {
  const requestOptions =
    job.request.options && typeof job.request.options === 'object'
      ? (job.request.options as Record<string, unknown>)
      : null;
  const institutionName =
    typeof requestOptions?.institutionName === 'string' && requestOptions.institutionName.trim()
      ? requestOptions.institutionName.trim()
      : null;

  if (institutionName) {
    return {
      ownerLabel: institutionName,
      ownerType: 'institution',
    };
  }

  if (job.orgId) {
    return {
      ownerLabel: `Institution ${job.orgId.slice(0, 8)}`,
      ownerType: 'institution',
    };
  }

  if (job.userId) {
    return {
      ownerLabel: `User ${job.userId.slice(0, 8)}`,
      ownerType: 'user',
    };
  }

  if (job.apiKeyId) {
    const apiKey = getApiKey(job.apiKeyId);
    return {
      ownerLabel: apiKey?.name.trim() || `API key ${apiKey?.prefix ?? job.apiKeyId.slice(0, 8)}`,
      ownerType: 'api_key',
    };
  }

  return {
    ownerLabel: 'Guest / Unknown',
    ownerType: 'guest',
  };
}

function matchesReferenceArchiveFilters(
  row: StoredAdminReferenceArchiveItem,
  filters: StoredAdminReferenceArchiveFilters,
): boolean {
  if (filters.healthLabel && row.healthLabel !== filters.healthLabel) {
    return false;
  }
  if (filters.storageStatus && row.storageStatus !== filters.storageStatus) {
    return false;
  }
  if (filters.ownerType && row.ownerType !== filters.ownerType) {
    return false;
  }

  const ownerQuery = filters.ownerQuery?.trim().toLowerCase();
  if (ownerQuery && !row.ownerLabel.toLowerCase().includes(ownerQuery)) {
    return false;
  }

  const jobQuery = filters.jobQuery?.trim().toLowerCase();
  if (jobQuery && !row.jobId.toLowerCase().includes(jobQuery)) {
    return false;
  }

  return true;
}

export function listAdminReferenceArchive(
  filters: StoredAdminReferenceArchiveFilters,
): StoredAdminReferenceArchiveResult {
  const openReportsByCitationId = new Map<
    string,
    {
      pending: number;
      proposed: number;
      total: number;
      latestUpdatedAt: string | null;
    }
  >();

  for (const report of listReports()) {
    if (report.status !== 'pending' && report.status !== 'proposed') {
      continue;
    }
    const current = openReportsByCitationId.get(report.citationId) ?? {
      pending: 0,
      proposed: 0,
      total: 0,
      latestUpdatedAt: null,
    };
    if (report.status === 'pending') {
      current.pending += 1;
    }
    if (report.status === 'proposed') {
      current.proposed += 1;
    }
    current.total += 1;
    if (
      !current.latestUpdatedAt ||
      new Date(report.updatedAt).getTime() > new Date(current.latestUpdatedAt).getTime()
    ) {
      current.latestUpdatedAt = report.updatedAt;
    }
    openReportsByCitationId.set(report.citationId, current);
  }

  const allReferences = listJobs().flatMap((job) => {
    const owner = resolveStoredOwner(job);
    return (job.result?.references ?? []).map<StoredAdminReferenceArchiveItem>((citation) => {
      const createdAt = citation.createdAt ?? job.createdAt;
      const updatedAt = citation.updatedAt ?? createdAt;
      const openReports = openReportsByCitationId.get(citation.id) ?? {
        pending: 0,
        proposed: 0,
        total: 0,
        latestUpdatedAt: null,
      };
      const latestActivityAt =
        openReports.latestUpdatedAt &&
        new Date(openReports.latestUpdatedAt).getTime() > new Date(updatedAt).getTime()
          ? openReports.latestUpdatedAt
          : updatedAt;

      return {
        citationId: citation.id,
        jobId: job.id,
        referenceIndex: citation.index,
        ownerLabel: owner.ownerLabel,
        ownerType: owner.ownerType,
        outputStyle: citation.outputStyle ?? null,
        detectedStyle: citation.detectedStyle ?? null,
        referenceType: citation.referenceType ?? null,
        publicStatus: citation.publicStatus,
        storageStatus: referenceStorageStatus(citation),
        healthLabel: referenceHealthLabel(citation.publicStatus, openReports.total),
        rawText: citation.raw,
        renderedText: citation.renderedText ?? null,
        batchCreatedAt: job.createdAt,
        createdAt,
        updatedAt,
        latestActivityAt,
        openReportCounts: {
          pending: openReports.pending,
          proposed: openReports.proposed,
          total: openReports.total,
        },
      };
    });
  });

  const filteredReferences = allReferences
    .filter((row) => matchesReferenceArchiveFilters(row, filters))
    .sort((left, right) => {
      const latestDifference =
        new Date(right.latestActivityAt).getTime() - new Date(left.latestActivityAt).getTime();
      if (latestDifference !== 0) {
        return latestDifference;
      }
      const createdDifference =
        new Date(right.batchCreatedAt).getTime() - new Date(left.batchCreatedAt).getTime();
      if (createdDifference !== 0) {
        return createdDifference;
      }
      return left.referenceIndex - right.referenceIndex;
    });

  return {
    references: filteredReferences.slice(filters.offset, filters.offset + filters.limit),
    total: filteredReferences.length,
  };
}

export function deleteBatchHealthSummary(jobId: string): boolean {
  return batchHealthSummaries.delete(jobId);
}

export function saveApiKey(apiKey: StoredApiKey): void {
  apiKeys.set(apiKey.id, apiKey);
}

export function getApiKey(id: string): StoredApiKey | undefined {
  return apiKeys.get(id);
}

export function listApiKeys(userId?: string): StoredApiKey[] {
  if (!userId) {
    return [...apiKeys.values()];
  }
  return [...apiKeys.values()].filter((apiKey) => apiKey.userId === userId);
}

export function deleteApiKey(id: string, userId?: string): boolean {
  const existing = apiKeys.get(id);
  if (!existing) return false;
  if (userId && existing.userId !== userId) {
    return false;
  }
  return apiKeys.delete(id);
}

export function getUserTier(_userId: string): 'free' | 'pro' | 'b2b' | null {
  return null;
}

export function saveCitationVersion(version: StoredCitationVersion): void {
  const existing = citationVersions.get(version.citationId) ?? [];
  existing.push(version);
  citationVersions.set(version.citationId, existing);
}

export function appendCitationVersion(
  input: Omit<StoredCitationVersion, 'versionNumber'>,
): StoredCitationVersion {
  const existing = citationVersions.get(input.citationId) ?? [];
  const nextVersionNumber = existing.reduce((maxVersion, current) => {
    return current.versionNumber > maxVersion ? current.versionNumber : maxVersion;
  }, 0) + 1;
  const nextVersion: StoredCitationVersion = {
    ...input,
    versionNumber: nextVersionNumber,
  };
  existing.push(nextVersion);
  citationVersions.set(input.citationId, existing);
  return structuredClone(nextVersion);
}

export function listCitationVersions(citationId: string): StoredCitationVersion[] {
  return structuredClone(citationVersions.get(citationId) ?? []);
}

export function saveCitationExtractionHistory(entry: StoredCitationExtractionHistory): void {
  const existing = citationExtractionHistory.get(entry.citationId) ?? [];
  existing.push(entry);
  citationExtractionHistory.set(entry.citationId, existing);
}

export function saveCitationExtractionHistoryBatch(entries: StoredCitationExtractionHistory[]): void {
  for (const entry of entries) {
    saveCitationExtractionHistory(entry);
  }
}

export function listCitationExtractionHistory(citationId: string): StoredCitationExtractionHistory[] {
  return structuredClone(citationExtractionHistory.get(citationId) ?? []);
}

export function listShadowExtractionHistory(): StoredCitationExtractionHistory[] {
  return structuredClone(
    [...citationExtractionHistory.values()]
      .flat()
      .filter((entry) => entry.runMode === 'shadow' && entry.shadowDiff),
  );
}

export function saveLearningQueueItem(item: LearningQueueItem): void {
  learningQueue.set(item.id, item);
}


export function updateLearningQueueItem(
  id: string,
  updater: (item: LearningQueueItem) => void,
): LearningQueueItem | undefined {
  const item = learningQueue.get(id);
  if (!item) return undefined;
  updater(item);
  learningQueue.set(id, item);
  return item;
}

export function listApprovedTruth(filters?: {
  trustLevel?: TruthTrustLevel;
  rowStatus?: TruthRowStatus;
  datasetSplit?: TruthDatasetSplit;
  datasetVersion?: string;
  limit?: number;
}): StoredApprovedTruth[] {
  let rows = [...approvedTruthById.values()];
  if (filters?.trustLevel) {
    rows = rows.filter((r) => r.trustLevel === filters.trustLevel);
  }
  if (filters?.rowStatus) {
    rows = rows.filter((r) => (r.rowStatus ?? (r.trustLevel === 'gold' ? 'reviewed' : r.trustLevel)) === filters.rowStatus);
  }
  if (filters?.datasetSplit) {
    rows = rows.filter((r) => r.datasetSplit === filters.datasetSplit);
  }
  if (filters?.datasetVersion) {
    rows = rows.filter((r) => r.datasetVersion === filters.datasetVersion);
  }
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const lim = filters?.limit ?? 500;
  return rows.slice(0, lim);
}

export function getApprovedTruth(id: string): StoredApprovedTruth | undefined {
  return approvedTruthById.get(id);
}

export function upsertApprovedTruth(row: StoredApprovedTruth): StoredApprovedTruth {
  for (const [id, prev] of approvedTruthById) {
    if (prev.inputHash === row.inputHash && id !== row.id) {
      for (const variant of approvedTruthRenderVariantsById.values()) {
        if (variant.truthRowId !== id) {
          continue;
        }
        const existingTarget = getApprovedTruthRenderVariant(row.id, variant.style);
        if (!existingTarget) {
          approvedTruthRenderVariantsById.set(variant.id, {
            ...variant,
            truthRowId: row.id,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      deleteApprovedTruthRenderVariantsForTruthRow(id);
      approvedTruthById.delete(id);
    }
  }
  approvedTruthById.set(row.id, row);
  return row;
}

export function listApprovedTruthRenderVariants(truthRowId: string): StoredApprovedTruthRenderVariant[] {
  return [...approvedTruthRenderVariantsById.values()]
    .filter((variant) => variant.truthRowId === truthRowId)
    .sort((left, right) => left.style.localeCompare(right.style));
}

export function getApprovedTruthRenderVariant(
  truthRowId: string,
  style: TruthRenderVariantStyle,
): StoredApprovedTruthRenderVariant | undefined {
  return [...approvedTruthRenderVariantsById.values()].find(
    (variant) => variant.truthRowId === truthRowId && variant.style === style,
  );
}

export function upsertApprovedTruthRenderVariant(
  variant: StoredApprovedTruthRenderVariant,
): StoredApprovedTruthRenderVariant {
  for (const [id, existing] of approvedTruthRenderVariantsById) {
    if (
      existing.truthRowId === variant.truthRowId
      && existing.style === variant.style
      && id !== variant.id
    ) {
      approvedTruthRenderVariantsById.delete(id);
    }
  }
  approvedTruthRenderVariantsById.set(variant.id, variant);
  return variant;
}

export function markApprovedTruthRenderVariantsStale(truthRowId: string): number {
  let updatedCount = 0;
  for (const variant of approvedTruthRenderVariantsById.values()) {
    if (variant.truthRowId !== truthRowId || variant.stale) {
      continue;
    }
    variant.stale = true;
    variant.updatedAt = new Date().toISOString();
    approvedTruthRenderVariantsById.set(variant.id, variant);
    updatedCount += 1;
  }
  return updatedCount;
}

export function deleteApprovedTruthRenderVariantsForTruthRow(truthRowId: string): number {
  let deletedCount = 0;
  for (const [id, variant] of approvedTruthRenderVariantsById) {
    if (variant.truthRowId !== truthRowId) {
      continue;
    }
    approvedTruthRenderVariantsById.delete(id);
    deletedCount += 1;
  }
  return deletedCount;
}

export function getApprovedTruthEditorDraft(userId: string): StoredApprovedTruthEditorDraft | undefined {
  return approvedTruthEditorDraftsByUserId.get(userId);
}

export function upsertApprovedTruthEditorDraft(
  draft: StoredApprovedTruthEditorDraft,
): StoredApprovedTruthEditorDraft {
  approvedTruthEditorDraftsByUserId.set(draft.userId, draft);
  return draft;
}

export function deleteApprovedTruthEditorDraft(userId: string): boolean {
  return approvedTruthEditorDraftsByUserId.delete(userId);
}


export function getLearningQueueItem(id: string): LearningQueueItem | undefined {
  return learningQueue.get(id);
}

export function promoteLearningQueueRowMem(
  queueId: string,
  truth: {
    id?: string;
    rawText: string;
    expectedFields: Record<string, TruthFieldValue>;
    coreTruth?: Record<string, TruthFieldValue> | null;
    overlayTruth?: Record<string, TruthFieldValue> | null;
    expectedType?: string | null;
    expectedStyle?: string | null;
    datasetSplit?: TruthDatasetSplit | null;
    trustLevel?: TruthTrustLevel;
    rowStatus?: TruthRowStatus;
    blockedReason?: TruthBlockedReason | null;
    taskCertifications?: TruthTaskCertification[] | null;
    workId?: string | null;
    familyId?: string | null;
    variantId?: string | null;
    canonicalWorkKey?: string | null;
    nearDupClusterId?: string | null;
    datasetVersion?: string | null;
    inputProfile?: TruthInputProfile | null;
    styleInferabilityTier?: TruthStyleInferabilityTier | null;
    styleEvaluationSuite?: TruthStyleEvaluationSuite | null;
    isAdversarial?: boolean | null;
    difficultyTier?: TruthDifficultyTier | null;
    highImpact?: boolean | null;
    highImpactReason?: string | null;
    holdoutVersion?: string | null;
    inferabilityByField?: Record<string, TruthInferabilityTier> | null;
    goldKind?: TruthGoldKind | null;
    adversarialPair?: string | null;
    noiseProfile?: string[] | null;
    approvalSource?: TruthApprovalSource | null;
    reviewedBy?: string | null;
    notes?: string | null;
    provenance?: string | null;
  },
): { truth: StoredApprovedTruth } | null {
  const item = learningQueue.get(queueId);
  if (!item) return null;
  const now = new Date().toISOString();
  const inputHash = hashInputForTruth(truth.rawText);
  let id: string = truth.id ?? randomUUID();
  for (const [existingId, r] of approvedTruthById) {
    if (r.inputHash === inputHash) {
      id = existingId;
      break;
    }
  }
  const row: StoredApprovedTruth = {
    id,
    inputHash,
    rawText: truth.rawText,
    expectedFields: truth.expectedFields,
    coreTruth: truth.coreTruth ?? truth.expectedFields,
    overlayTruth: truth.overlayTruth ?? null,
    expectedType: truth.expectedType ?? null,
    expectedStyle: truth.expectedStyle ?? null,
    provenance: truth.provenance ?? "learning_queue",
    pipelineMajor: null,
    datasetSplit: truth.datasetSplit ?? null,
    trustLevel: truth.trustLevel ?? "reviewed",
    rowStatus: truth.rowStatus ?? "reviewed",
    blockedReason: truth.blockedReason ?? null,
    taskCertifications: truth.taskCertifications ?? null,
    workId: truth.workId ?? null,
    familyId: truth.familyId ?? null,
    variantId: truth.variantId ?? null,
    canonicalWorkKey: truth.canonicalWorkKey ?? null,
    nearDupClusterId: truth.nearDupClusterId ?? null,
    datasetVersion: truth.datasetVersion ?? null,
    inputProfile: truth.inputProfile ?? null,
    styleInferabilityTier: truth.styleInferabilityTier ?? null,
    styleEvaluationSuite: truth.styleEvaluationSuite ?? null,
    isAdversarial: truth.isAdversarial ?? null,
    difficultyTier: truth.difficultyTier ?? null,
    highImpact: truth.highImpact ?? null,
    highImpactReason: truth.highImpactReason ?? null,
    holdoutVersion: truth.holdoutVersion ?? null,
    inferabilityByField: truth.inferabilityByField ?? null,
    goldKind: truth.goldKind ?? null,
    adversarialPair: truth.adversarialPair ?? null,
    noiseProfile: truth.noiseProfile ?? null,
    approvalSource: truth.approvalSource ?? "learning_queue",
    reviewedBy: truth.reviewedBy ?? null,
    reviewedAt: truth.reviewedBy ? now : null,
    notes: truth.notes ?? null,
    createdAt: approvedTruthById.get(id)?.createdAt ?? now,
    updatedAt: now,
  };
  upsertApprovedTruth(row);
  updateLearningQueueItem(queueId, (q) => {
    q.processed = true;
    q.processedAt = now;
    q.promotedToTruthId = id;
  });
  return { truth: row };
}

export function deleteApprovedTruth(id: string): boolean {
  deleteApprovedTruthRenderVariantsForTruthRow(id);
  return approvedTruthById.delete(id);
}

export function listLearningQueue(): LearningQueueItem[] {
  return groupLearningQueueItems([...learningQueue.values()]);
}

export function markLearningQueueItemsProcessed(
  ids: readonly string[],
  promotedToTruthId?: string | null,
): number {
  let updatedCount = 0;
  for (const id of ids) {
    const item = learningQueue.get(id);
    if (!item) {
      continue;
    }
    learningQueue.set(id, {
      ...item,
      processed: true,
      processedAt: new Date().toISOString(),
      promotedToTruthId: promotedToTruthId ?? null,
    });
    updatedCount += 1;
  }
  return updatedCount;
}

export function markLearningQueueItemsUnprocessed(ids: readonly string[]): number {
  let updatedCount = 0;
  for (const id of ids) {
    const item = learningQueue.get(id);
    if (!item) {
      continue;
    }
    learningQueue.set(id, {
      ...item,
      processed: false,
      processedAt: null,
      promotedToTruthId: null,
    });
    updatedCount += 1;
  }
  return updatedCount;
}

export function listActiveJobs(): StoredJob[] {
  return listJobs().filter((job) => job.status === 'pending' || job.status === 'processing');
}

function resolveNonB2bScopeKey(input: { userId?: string; apiKeyId?: string } | undefined): string {
  if (input?.userId) return `user:${input.userId}`;
  if (input?.apiKeyId) return `apiKey:${input.apiKeyId}`;
  return 'anonymous:shared';
}

function resolveB2bScopeKey(
  input: { userId?: string; orgId?: string; apiKeyId?: string } | undefined,
): string {
  if (input?.orgId) return `org:${input.orgId}`;
  if (input?.userId) return `user:${input.userId}`;
  if (input?.apiKeyId) return `apiKey:${input.apiKeyId}`;
  return 'b2b:unscoped';
}

export function countActiveJobsForNonB2bScope(
  tier: 'anonymous' | 'free' | 'pro',
  scope: { userId?: string; apiKeyId?: string },
): number {
  const scopeKey = resolveNonB2bScopeKey(scope);
  return listActiveJobs().filter((job) =>
    (job.tier ?? 'free') === tier && resolveNonB2bScopeKey(job) === scopeKey,
  ).length;
}

export function countActiveB2bJobsForScope(
  scope: { userId?: string; orgId?: string; apiKeyId?: string },
): number {
  const scopeKey = resolveB2bScopeKey(scope);
  return listActiveJobs().filter((job) =>
    (job.tier ?? 'free') === 'b2b' && resolveB2bScopeKey(job) === scopeKey,
  ).length;
}

export function countActiveB2bJobsGlobal(): number {
  return listActiveJobs().filter((job) => (job.tier ?? 'free') === 'b2b').length;
}

export function currentUsageDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface UsageScope {
  userId?: string;
  orgId?: string;
  apiKeyId?: string;
}

function usageScopeKey(dayKey: string, scope?: UsageScope): string {
  if (scope?.orgId) return `${dayKey}::org:${scope.orgId}`;
  if (scope?.userId) return `${dayKey}::user:${scope.userId}`;
  if (scope?.apiKeyId) return `${dayKey}::apiKey:${scope.apiKeyId}`;
  return `${dayKey}::global`;
}

export function getUsageForDay(dayKey = currentUsageDayKey(), scope?: UsageScope): number {
  return usageByDay.get(usageScopeKey(dayKey, scope)) ?? 0;
}

export function consumeUsage(refCount: number, dayKey = currentUsageDayKey(), scope?: UsageScope): number {
  const key = usageScopeKey(dayKey, scope);
  const nextValue = getUsageForDay(dayKey, scope) + refCount;
  usageByDay.set(key, nextValue);
  return nextValue;
}

export function resetUsage(dayKey = currentUsageDayKey(), scope?: UsageScope): void {
  usageByDay.delete(usageScopeKey(dayKey, scope));
}

// Separate per-day counter for Pro-feature enrichment uses on the free tier (kept distinct
// from the reference quota). In-memory namespaces via the day key; the DB store uses a
// dedicated enrich_count column.
export function getEnrichmentUsageForDay(dayKey = currentUsageDayKey(), scope?: UsageScope): number {
  return usageByDay.get(usageScopeKey(`enrich:${dayKey}`, scope)) ?? 0;
}

export function consumeEnrichmentUsage(amount = 1, dayKey = currentUsageDayKey(), scope?: UsageScope): number {
  const key = usageScopeKey(`enrich:${dayKey}`, scope);
  const nextValue = getEnrichmentUsageForDay(dayKey, scope) + amount;
  usageByDay.set(key, nextValue);
  return nextValue;
}

export function resetRuntimeStore(): void {
  jobs.clear();
  corrections.clear();
  reports.clear();
  apiKeys.clear();
  citationVersions.clear();
  citationExtractionHistory.clear();
  learningQueue.clear();
  approvedTruthById.clear();
  approvedTruthRenderVariantsById.clear();
  approvedTruthEditorDraftsByUserId.clear();
  batchHealthSummaries.clear();
  usageByDay.clear();
  egressEvents.length = 0;
  egressDaily.clear();
  egressMonthly.clear();
}

export function recordEgressEvent(event: StoredEgressEvent): void {
  egressEvents.push(event);
}

function rollupKey(period: string, provider: string, route: string): string {
  return `${period}::${provider}::${route}`;
}

export function rollupEgressDaily(delta: StoredEgressRollup): void {
  const key = rollupKey(delta.period, delta.provider, delta.route);
  const current = egressDaily.get(key) ?? {
    period: delta.period,
    provider: delta.provider,
    route: delta.route,
    calls: 0,
    cacheHits: 0,
    requestBodyBytes: 0,
    responseBodyBytes: 0,
  };
  current.calls += delta.calls;
  current.cacheHits += delta.cacheHits;
  current.requestBodyBytes += delta.requestBodyBytes;
  current.responseBodyBytes += delta.responseBodyBytes;
  egressDaily.set(key, current);
}

export function rollupEgressMonthly(delta: StoredEgressRollup): void {
  const key = rollupKey(delta.period, delta.provider, delta.route);
  const current = egressMonthly.get(key) ?? {
    period: delta.period,
    provider: delta.provider,
    route: delta.route,
    calls: 0,
    cacheHits: 0,
    requestBodyBytes: 0,
    responseBodyBytes: 0,
  };
  current.calls += delta.calls;
  current.cacheHits += delta.cacheHits;
  current.requestBodyBytes += delta.requestBodyBytes;
  current.responseBodyBytes += delta.responseBodyBytes;
  egressMonthly.set(key, current);
}

export function listEgressDaily(period: string): StoredEgressRollup[] {
  return [...egressDaily.values()].filter((r) => r.period === period);
}

export function listEgressMonthly(period: string): StoredEgressRollup[] {
  return [...egressMonthly.values()].filter((r) => r.period === period);
}
