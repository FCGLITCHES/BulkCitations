/**
 * shared/schema/reportTypes.ts
 *
 * Failure-reporting, admin review, truth store, and report lifecycle types.
 */

import type {
  AuthorityStatus,
  AssertionSummary,
  AssertionHighlight,
  ConfidenceResult,
  HealthState,
  ParsedReference,
  ReferenceType,
  TruthProvenance,
  TruthMatchType,
  TruthStalenessReason,
  ReferenceDebugEnvelope,
} from './types';

import type { CanonicalReferenceType, V2StageId, V2StageStatus, CanonicalAuthor } from './v2Types';

// ── Failure Reporting System ──

/** Where the failure report originated */
export type FailureSource = 'user' | 'auto' | 'user-edit';

/** Broad category of what went wrong */
export type FailureCategory =
  | 'author'
  | 'style-detection'
  | 'reference-type'
  | 'venue'
  | 'locator'
  | 'title'
  | 'year'
  | 'dedup'
  | 'validation'
  | 'normalization'
  | 'other';

/** Lifecycle status of a failure report */
export type ReportStatus = 'pending' | 'proposed' | 'accepted' | 'rejected' | 'duplicate';

/**
 * What kind of fix is needed.
 * - dynamic-pattern: can be applied to patterns.json (instant, no deploy)
 * - parser-logic: requires code change in citationParser.ts
 * - scoring-tweak: requires change in detectStyle() or clustering/confidence logic
 * - renderer-fix: requires cslConverter.ts or strictRenderer.ts change
 * - type-correction: correctly parsed but wrong reference type assigned
 * - other-fix: manual database fix or unique edge case
 */
export type FixType = 'dynamic-pattern' | 'parser-logic' | 'scoring-tweak' | 'renderer-fix' | 'type-correction' | 'other-fix';

/** A proposed dynamic pattern fix candidate */
export interface ProposedPattern {
  id: string;
  regex: string;
  fields: Record<string, number>;
  description: string;
  category?: string;
  priority?: number;
}

export interface StageBlameAlternative {
  stage: V2StageId | 'unknown';
  confidence: number;
}

export interface StageBlameSummary {
  likelyStage: V2StageId | 'unknown';
  confidence: number;
  evidence: string[];
  alternatives: StageBlameAlternative[];
}

export interface StageLogSummary {
  stageId: string;
  status: V2StageStatus | 'unknown';
  code?: string;
  message: string;
}

export interface ReportEngineSnapshot {
  engineVersion?: 'v1' | 'v2';
  processingPath?: {
    stagesRun?: string[];
    fallbacksUsed?: string[];
    extractorPathsUsed?: string[];
    partialResult?: boolean;
    partialReasons?: string[];
  };
  stageLogSummary?: StageLogSummary[];
  extractorPath?: 'deterministic' | 'grobid' | 'llm' | 'hybrid' | 'hybrid-v1';
  validationCodes?: string[];
  qualityFlags?: string[];
  splitContaminationFlags?: string[];
  inputProfile?: import('./v2Types').InputProfile;
  truthProvenance?: TruthProvenance;
}

export interface ReferenceReviewPayload {
  healthState: HealthState;
  healthReasons: string[];
  confidence?: ConfidenceResult;
  authorityStatus?: AuthorityStatus;
  assertionSummary?: AssertionSummary;
  assertionHighlights?: AssertionHighlight[];
  styleDetectionFailed: boolean;
  authorInitialsOnly: boolean;
  truthProvenance?: TruthProvenance;
}

export interface ReferenceAdminReviewPayload {
  warnings: string[];
  engineSnapshot?: ReportEngineSnapshot;
  debug?: ReferenceDebugEnvelope;
}

export interface ReferenceExportPayload {
  workKey?: string;
  outputStyle: string;
  referenceType: ReferenceType;
  convertedText: string;
  parsedData: ParsedReference;
}

export interface ReferenceAnalyticsPayload {
  engineVersion?: 'v1' | 'v2';
  healthState?: HealthState;
  confidenceScore?: number;
  warningCount: number;
  styleDetectionFailed: boolean;
  authorityStatus?: AuthorityStatus;
  partialResult: boolean;
  extractorPath?: 'deterministic' | 'grobid' | 'llm' | 'hybrid' | 'hybrid-v1';
  truthApplied: boolean;
}

export interface ReviewEvent {
  id: string;
  type: 'comment' | 'assign' | 'resolve' | 'duplicate' | 'reject' | 'truth_saved' | 'pattern_exported' | 'regression_generated';
  actor: string;
  createdAt: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ResolutionTrace {
  resolvedByCommit?: string;
  resolvedByVersion?: string;
  resolvedAt?: string;
  note?: string;
}

export interface PatternExportArtifact {
  filePath: string;
  content: string;
  generatedAt: string;
  generatedBy?: string;
}

export interface GeneratedRegressionFixtureMeta {
  id: string;
  generatedAt: string;
  generatedBy?: string;
  skipped?: boolean;
  skipReason?: string;
  storageKey?: string;
  exportArtifact?: PatternExportArtifact;
}

export interface TruthAlias {
  aliasType: import('./types').TruthAliasType;
  aliasValue: string;
}

export interface ApprovedCanonicalFields {
  authors?: CanonicalAuthor[];
  title?: string | null;
  year?: number | null;
  journal?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  doi?: string | null;
  publisher?: string | null;
  url?: string | null;
  conferenceTitle?: string | null;
  bookTitle?: string | null;
  institution?: string | null;
  edition?: string | null;
  editor?: string | null;
  referenceType?: CanonicalReferenceType | ReferenceType;
}

export interface FieldApprovalDecision {
  approved: boolean;
  value?: unknown;
  note?: string;
}

export type FieldApprovalMap = Partial<Record<
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
  FieldApprovalDecision
>>;

export interface ApprovedTruthEntry {
  truthId: string;
  truthFamilyId: string;
  fingerprint: string;
  originalText: string;
  outputStyle: string;
  validatedOutput: string;
  validatedBy: string;
  validatedAt: string;
  aliases?: TruthAlias[];
  sourceReportId?: string;
  correctedFields?: ApprovedCanonicalFields;
  fieldApproval?: FieldApprovalMap;
  failureTaxonomy?: string[];
  stageBlame?: string[];
  duplicateDecision?: 'not_applicable' | 'confirmed_duplicate' | 'confirmed_unique' | 'needs_review';
  resolvedByCommit?: string;
  resolvedByVersion?: string;
  staleAfterVersion?: string;
  staleReason?: TruthStalenessReason;
  originalEngineOutput?: {
    convertedText?: string;
    parsedData?: ParsedReference;
    referenceType?: ReferenceType;
    confidence?: number;
  };
}

/** Community-verified failure report */
export interface CitationReport {
  id: string;
  source: FailureSource;
  originalText: string;
  detectedStyle: string;
  outputStyle: string;
  parsedData?: ParsedReference;
  referenceType?: ReferenceType;
  convertedText: string;
  confidence?: number;
  failureCategory: FailureCategory;
  failureCategories?: FailureCategory[];
  userNote?: string;
  status: ReportStatus;
  fixType?: FixType;
  proposedPattern?: ProposedPattern;
  proposedStyleFix?: string;
  verifiedBy?: string;
  createdAt: string;
  resolvedAt?: string;
  /** SHA-256 fingerprint of normalized originalText for dedup */
  fingerprint?: string;
  /** Number of identical reports (incremented on dedup) */
  reportCount: number;
  /** Hashed IP for rate limiting (only stored, never exposed to admin UI) */
  ipHash?: string;
  /** Auto-queue trigger reasons */
  autoQueueReasons?: string[];
  correctedFields?: ApprovedCanonicalFields;
  fieldApproval?: FieldApprovalMap;
  finalApprovedOutput?: string;
  failureTaxonomy?: string[];
  stageBlame?: string[];
  duplicateDecision?: 'not_applicable' | 'confirmed_duplicate' | 'confirmed_unique' | 'needs_review';
  engineSnapshot?: ReportEngineSnapshot;
  likelyStageBlame?: StageBlameSummary;
  assigneeName?: string;
  reviewEvents?: ReviewEvent[];
  resolutionTrace?: ResolutionTrace;
  truthId?: string;
  patternExport?: PatternExportArtifact;
  regressionFixtureId?: string;
  resolvedByCommit?: string;
  resolvedByVersion?: string;
  originalEngineOutput?: {
    convertedText?: string;
    parsedData?: ParsedReference;
    referenceType?: ReferenceType;
    confidence?: number;
  };
}
