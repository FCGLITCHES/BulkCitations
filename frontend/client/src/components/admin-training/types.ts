export type TruthTrustLevel = "draft" | "reviewed" | "gold";
export type TruthDatasetSplit = "train" | "val" | "test" | "holdout";
export type TruthRowStatus = "draft" | "reviewed" | "quarantined";
export type TruthBlockedReason =
  | "source_conflict"
  | "inferability_conflict"
  | "canonicalization_unclear"
  | "split_leakage"
  | "identifier_invalid"
  | "evidence_missing"
  | "review_conflict"
  | "family_incompatible"
  | "provider_only_fact"
  | "needs_research";
export type TruthGoldKind =
  | "style_clean"
  | "style_adversarial"
  | "style_noisy"
  | "field_span"
  | "authority_seed"
  | "overlay_accept";
export type TruthApprovalSource = "manual" | "learning_queue" | "overlay_accept";
export type TruthAuditReasonCode =
  | "manual_correction"
  | "sync_expected_to_core"
  | "source_verification"
  | "crossref_alignment"
  | "engine_prefill_alignment"
  | "regression_fix"
  | "governance_metadata_update";
export type TruthTask = "style" | "field" | "authority_pack" | "overlay_learning";
export type TruthScope = "core" | "overlay";
export type TruthTaskCertificationStatus = "candidate" | "certified";
export type TrainingPackTarget =
  | "style_core_gold"
  | "approved_overlay_changes"
  | "citation_bio_supervision"
  | "authority_pack"
  | "render_variant_augmentation"
  | "regression_fixtures";
export type TruthInputProfile =
  | "doi_list"
  | "structured_clean"
  | "structured_noisy"
  | "pasted_pdf_copy"
  | "multiline_numbered"
  | "ocr_like";
export type TruthStyleInferabilityTier =
  | "tier1_exact_direct"
  | "tier2_exact_policy_resolved"
  | "tier3_family_only"
  | "tier4_not_inferable";
export type TruthStyleEvaluationSuite =
  | "supported_exact"
  | "supported_family_only"
  | "unsupported_exact"
  | "unknown_or_ood"
  | "not_citation_like";
export type TruthDifficultyTier = "low" | "medium" | "high" | "very_high";
export type TruthInferabilityTier = "raw_visible" | "local_authority_derivable" | "overlay_only";
export type TruthRenderVariantStyle =
  | "apa7"
  | "harvard-ctr"
  | "chicago-notes-bib"
  | "vancouver"
  | "ieee"
  | "mla9";
export type TruthRenderVariantSourceKind = "generated" | "admin_authored";
export type TruthRenderVariantApprovalStatus = "draft" | "reviewed" | "approved";
export type TruthScalar = string | number | boolean | null;
export type TruthFieldValue = TruthScalar | TruthScalar[];
export type TruthBulkResultStatus =
  | "updated"
  | "unchanged"
  | "quarantined"
  | "failed"
  | "skipped"
  | "deleted"
  | "certified";

export interface ExpectedFieldDefinition {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  multiline?: boolean;
}

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
  packTarget?: TrainingPackTarget | null;
  stagedBundleId?: string | null;
  stagedAt?: string | null;
}

export interface TruthDriftSummary {
  hasDrift: boolean;
  mismatchCount: number;
  missingInCore: string[];
  extraInCore: string[];
  valueMismatches: string[];
}

export interface ApprovedTruthRow {
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
  auditReasonCode?: TruthAuditReasonCode | null;
  truthDrift?: TruthDriftSummary | null;
  reviewedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedTruthListResponse {
  items: ApprovedTruthRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TruthPrefillResponse {
  expectedFields: Record<string, TruthFieldValue>;
  coreTruth: Record<string, TruthFieldValue>;
  expectedType: string | null;
  expectedStyle: string | null;
  pipelineMajor: number;
  publicStatus: string;
  renderedText: string;
  referenceCount: number;
  usedReferenceIndex: number;
  fieldCount: number;
  warnings: string[];
}

export interface TruthBulkPrefillResponse {
  requestedCount: number;
  updatedCount: number;
  unchangedCount: number;
  quarantinedCount: number;
  failedCount: number;
  results: Array<{
    id: string;
    status: "updated" | "unchanged" | "quarantined" | "failed";
    fieldCount: number;
    message?: string;
  }>;
}

export interface TruthBulkResultRecord {
  id: string;
  status: TruthBulkResultStatus;
  message?: string;
}

export interface TruthCrossrefPrefillResponse {
  expectedFields: Record<string, TruthFieldValue>;
  coreTruth: Record<string, TruthFieldValue>;
  expectedType: string | null;
  matchedDoi: string;
  fieldCount: number;
  warnings: string[];
}

export interface TruthRenderPreviewResponse {
  renderedText: string;
  expectedType: string | null;
  expectedStyle: string | null;
  warningCodes: string[];
  fieldCount: number;
}

export interface ApprovedTruthEditorDraftPayload {
  mode: "create" | "edit";
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
  datasetSplit: TruthDatasetSplit | "";
  trustLevel: TruthTrustLevel;
  rowStatus: TruthRowStatus;
  blockedReason: TruthBlockedReason | "";
  goldKind: TruthGoldKind | "";
  adversarialPair: string;
  noiseProfile: string;
  approvalSource: TruthApprovalSource | "";
  reviewedBy: string;
  auditReasonCode: TruthAuditReasonCode | "";
  notes: string;
}

export interface ApprovedTruthEditorDraftRecord {
  id: string;
  userId: string;
  payload: ApprovedTruthEditorDraftPayload;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedTruthRenderVariant {
  id: string;
  truthRowId: string;
  style: TruthRenderVariantStyle;
  generatedText: string;
  renderedText: string;
  sourceKind: TruthRenderVariantSourceKind;
  approvalStatus: TruthRenderVariantApprovalStatus;
  qualityTier: string;
  datasetLane: string;
  rendererVersion: string;
  stale: boolean;
  generatedAt: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TruthRenderVariantListResponse {
  truthRowId: string;
  items: ApprovedTruthRenderVariant[];
  styleOrder: TruthRenderVariantStyle[];
  rendererVersion: string;
}

export interface ApprovedTruthEditorDraftResponse {
  draft: ApprovedTruthEditorDraftRecord | null;
  persistenceBackend: "memory" | "database";
  durable: boolean;
}

export interface TruthBulkDeleteResponse {
  requestedCount: number;
  deletedCount: number;
  failedCount: number;
  results: Array<{
    id: string;
    status: "deleted" | "failed";
    message?: string;
  }>;
}

export interface TruthBulkCertifyResponse {
  requestedCount: number;
  certifiedCount: number;
  quarantinedCount: number;
  failedCount: number;
  results: Array<{
    id: string;
    status: "certified" | "quarantined" | "failed";
    packTarget?: TrainingPackTarget;
    stagedBundleId?: string;
    message?: string;
  }>;
}

export interface TruthBulkUpdateResponse {
  requestedCount: number;
  updatedCount: number;
  unchangedCount: number;
  quarantinedCount: number;
  failedCount: number;
  results: Array<{
    id: string;
    status: "updated" | "unchanged" | "quarantined" | "failed";
    message?: string;
  }>;
}

export interface ApprovedTruthBulkFilterPayload {
  trustLevel?: TruthTrustLevel;
  datasetSplit?: TruthDatasetSplit;
  rowStatus?: TruthRowStatus;
  goldKind?: TruthGoldKind;
  expectedStyle?: string;
  adversarialPair?: string;
  styleEvaluationSuite?: TruthStyleEvaluationSuite;
  certificationView?: "pending" | "certified";
}

export type TruthBackgroundBulkOperation = "prefill" | "crossref" | "delete" | "certify" | "update";
export type TruthBackgroundBulkJobStatus = "pending" | "running" | "completed" | "failed";

export interface TruthBackgroundBulkJobResponse {
  jobId: string;
  operation: TruthBackgroundBulkOperation;
  status: TruthBackgroundBulkJobStatus;
  filters: ApprovedTruthBulkFilterPayload;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  completedRows: number;
  completedPages: number;
  updatedCount: number;
  unchangedCount: number;
  deletedCount: number;
  certifiedCount: number;
  quarantinedCount: number;
  skippedCount: number;
  failedCount: number;
  results: TruthBulkResultRecord[];
  recentResults: TruthBulkResultRecord[];
  recentCompletedPage: number | null;
  recentCompletedAt?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
}

export interface TruthBackgroundOptimisticUpdate {
  trustLevel?: TruthTrustLevel;
  rowStatus?: TruthRowStatus;
  blockedReason?: TruthBlockedReason | null;
}

export interface ActiveTruthBackgroundJob {
  jobId: string;
  operation: TruthBackgroundBulkOperation;
  update?: TruthBackgroundOptimisticUpdate;
  pageProgress?: {
    pageStart: number;
    pageEnd: number;
    availableTotalPages: number;
  } | null;
}

export type TruthRowHighlightTone = "success" | "failure";

export interface TruthRowHighlight {
  tone: TruthRowHighlightTone;
  operation: TruthBackgroundBulkOperation;
  status: TruthBulkResultStatus;
  message?: string;
  expiresAt: number;
}

export interface AllFilteredTruthSelection {
  totalRows: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  availableTotalRows: number;
  availableTotalPages: number;
  pageSize: number;
}

export interface LearningQueueRow {
  id: string;
  citationId: string;
  jobId: string;
  source: "user_edit" | "user_report";
  priority: number;
  trainingData: Record<string, unknown>;
  processed: boolean;
  processedAt?: string | null;
  createdAt: string;
  promotedToTruthId?: string | null;
  duplicateCount?: number;
  groupedQueueIds?: string[];
  groupedSources?: Array<"user_edit" | "user_report">;
}

export interface LearningQueueBulkProcessResponse {
  requestedCount: number;
  processedCount: number;
  failedCount: number;
  results: Array<{
    id: string;
    status: "processed" | "failed";
    message?: string;
  }>;
}

export interface LearningQueueBulkRevertResponse {
  requestedCount: number;
  revertedCount: number;
  failedCount: number;
  results: Array<{
    id: string;
    status: "reverted" | "failed";
    message?: string;
  }>;
}

export interface LearningQueueBulkPromoteResponse {
  requestedCount: number;
  promotedCount: number;
  quarantinedCount: number;
  failedCount: number;
  results: Array<{
    id: string;
    status: "promoted" | "quarantined" | "failed";
    truthId?: string;
    message?: string;
  }>;
}

export interface TrainingStatusResponse {
  truth: {
    total: number;
    gold: number;
    reviewed: number;
    draft: number;
    quarantined: number;
    byTrustLevel: Record<string, number>;
    byRowStatus: Record<string, number>;
    byDatasetSplit: Record<string, number>;
    byStyle: Record<string, number>;
    byGoldKind: Record<string, number>;
    byAdversarialPair: Record<string, number>;
    byDatasetVersion: Record<string, number>;
    byStyleEvalSuite: Record<string, number>;
    byStyleInferabilityTier: Record<string, number>;
    byTaskScope: Record<string, number>;
  };
  authorityPack: {
    version: string;
    generatedAt: string | null;
    doiExactHints: number;
    journalIssnHints: number;
  };
  styleBundle: {
    current: {
      modelVersion: string | null;
      featureVersion?: string | null;
      generatedAt?: string | null;
      path?: string | null;
    } | null;
    stagedVersions: string[];
  };
  benchmark: {
    latestCanonicalParallel: {
      fileName: string;
      path: string;
      sourceKind: "median" | "latest" | "artifact";
      benchmarkVariant: string | null;
      profile: string | null;
      hardwareProfile: string | null;
      recordedAt: string | null;
      iterations: number | null;
      targetStatus: string | null;
      fieldHashStable: boolean | null;
      contractHashStable: boolean | null;
      medianRefsPerSec: number | null;
      bestRefsPerSec: number | null;
      worstRefsPerSec: number | null;
    } | null;
    availableArtifacts: Array<{
      fileName: string;
      path: string;
    }>;
  } | null;
  mlHealth: {
    healthy: boolean;
    mode: string;
    modelBundleVersion: string | null;
    checkedAt: string | null;
    error?: string | null;
  } | null;
}

export interface BioTrainingStatusResponse {
  datasets: {
    datasetRoot: string;
    processedRoot: string;
    availableDatasets: Array<{
      fileName: string;
      path: string;
      rowCount: number;
      sizeBytes: number;
      updatedAt: string;
    }>;
  };
  bundle: {
    modelRoot: string;
    current: {
      path: string;
      modelVersion: string | null;
      featureVersion: string | null;
      generatedAt: string | null;
      bundleType: string | null;
      bundleClass: string | null;
      datasetTrack: string | null;
      datasetSource: string | null;
      datasetStats: Record<string, unknown> | null;
      labels: string[];
    } | null;
    stagedVersions: string[];
    promotedVersions: string[];
  };
  mlHealth: {
    healthy?: boolean;
    mode?: string;
    modelBundleVersion?: string | null;
    checkedAt?: string | null;
    error?: string | null;
    status?: string;
    message?: string;
  } | null;
}

export interface BioReviewQueueItem {
  id: string;
  raw_text: string;
  stratum?: string;
  expected_type?: string | null;
  entity_fields: string[];
  entity_starts: number[];
  entity_ends: number[];
  unprojected_fields?: string[];
  needs_review?: boolean;
  dataset_split?: string;
  priority: number;
}

export interface BioReviewQueueResponse {
  ok: boolean;
  total: number;
  returned: number;
  items: BioReviewQueueItem[];
}

export interface BioReviewSubmitResponse {
  ok: boolean;
  outcome: "approved" | "rejected" | "not_found";
  remaining: number;
}

export interface BioReviewTriageResponse {
  ok: boolean;
  evaluated: number;
  autoPromoted: number;
  remaining: number;
  modelUnavailable: number;
}

export interface FrozenGoldDatasetManifest {
  datasetVersion: string;
  createdAt: string;
  includeHoldout: boolean;
  enforceDiversityGates: boolean;
  rowCount: number;
  manifestHash: string;
  composition: {
    styleClean: number;
    styleAdversarial: number;
    styleNoisy: number;
    total: number;
  };
}

export type ApprovedTruthListQueryKey = readonly [
  "/internal/admin/approved-truth",
  "" | TruthTrustLevel,
  "" | TruthDatasetSplit,
  "" | TruthRowStatus,
  string,
  "" | TruthGoldKind,
  string,
  "" | TruthStyleEvaluationSuite,
  boolean,
  number,
];
