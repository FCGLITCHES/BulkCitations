import { z } from 'zod';

// Citation style type - lowercase for internal use
// Internal names: harvard-ctr (Cite Them Right), chicago-ad (author-date), chicago-nb (notes-biblio)
export type CitationStyle = 'apa' | 'mla' | 'harvard' | 'chicago' | 'harvard-ctr' | 'chicago-ad' | 'chicago-nb' | 'ieee' | 'vancouver' | 'auto';

/** UI/API may send 'harvard' or 'chicago'; normalize to internal style for CSL and strict renderer. */
export function normalizeCitationStyle(style: string): CitationStyle {
  const s = (style || '').toLowerCase().trim();
  if (s === 'harvard') return 'harvard-ctr';
  if (s === 'chicago') return 'chicago-ad';
  if (['apa', 'mla', 'harvard-ctr', 'chicago-ad', 'chicago-nb', 'ieee', 'vancouver', 'auto'].includes(s)) {
    return s as CitationStyle;
  }
  return 'apa';
}

// Reference type
export type ReferenceType = 'journal' | 'book' | 'bookChapter' | 'conference' | 'website' | 'report' | 'thesis' | 'preprint' | 'other';

// Dynamic pattern hit (debugging + future learning)
export interface PatternHit {
  id: string;
  fields: string[];
  matched: string;
  category?: string;
}

// Authority Data Type
export interface AuthorityData {
  title: string;
  authors: string[];
  journal: string;
  year?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
}

// Confidence Score Breakdown
export interface ConfidenceResult {
  score: number; // 0-100
  breakdown: {
    journal?: number; // Match score for Journal
    fields?: number;  // Match score for specific fields (year, vol, pages)
    rules: number;    // Rules assertion score
  };
  isSuspicious: boolean; // Flag if authority title/authors completely mismatch input
}

// Individual assertion result
export interface AssertionDetail {
  id: string;
  description: string;
  severity: 'error' | 'warning';
  passed: boolean;
}

// Aggregate assertion summary (for badge: "APA: 9/10 ✓")
export interface AssertionSummary {
  total: number;
  passed: number;
  failed: number;
  failedCritical: number;   // severity=error
  failedFormatting: number; // severity=warning
  details: AssertionDetail[];
}

// Character-level highlight for inline annotation of failed assertions
export interface AssertionHighlight {
  start: number;
  end: number;
  ruleId: string;
  message: string;
  severity: 'error' | 'warning';
}

export type HealthState = 'clean' | 'review' | 'action_needed';

export interface ReferenceDebugEnvelope {
  extractionPath: 'deterministic' | 'grobid' | 'llm' | 'hybrid';
  splitMethod: 'structural' | 'llm' | 'hybrid';
  fallbacksUsed: string[];
  splitConfidence: number;
  detectedStyle: string;
}

// Citation Cluster
export interface Cluster {
  clusterId: string;
  members: ConvertedReference[];
  bestConfidenceScore?: number;
  bestMemberId?: string;
  warnings?: string[];
  winnerDiagnostics?: {
    chosenMemberId: string;
    chosenReasons: string[];
    memberDiagnostics: Array<{
      id: string;
      score: number;
      reasons: string[];
      referenceType?: ReferenceType;
      styleDetectionFailed?: boolean;
      hasEtAl?: boolean;
      hasAuthorityValidation?: boolean;
      hasYear?: boolean;
    }>;
  };
}

// Parsed reference data structure
export interface ParsedReference {
  authors?: string[];
  title?: string;
  year?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  'article-number'?: string;
  publisher?: string;
  placeOfPublication?: string;
  url?: string;
  accessed?: string;
  bookTitle?: string;
  conferenceTitle?: string;
  reportNumber?: string;
  institution?: string;
  edition?: string;
  editor?: string;
  /** Parse recovery/debug codes: invalid-year-recovered, merged-volume-issue, venue-unknown, etc. */
  parseWarnings?: string[];
  /** When multiple plausible years exist, for debugging */
  yearCandidates?: string[];
}

// Converted reference result
export interface ConvertedReference {
  id: string;
  originalText: string;
  convertedText: string;
  referenceType: ReferenceType;
  parsedData: ParsedReference;
  inputStyle: string;
  outputStyle: string;
  errors?: string[];
  warnings?: string[];
  confidence?: ConfidenceResult;
  authorityData?: AuthorityData; // strict metadata validation source, OPT IN
  clusterId?: string; // used if batched with similar citations
  patternHits?: PatternHit[];
  workKey?: string;
  authorityStatus?: AuthorityStatus;
  styleDetectionFailed?: boolean;
  assertionSummary?: AssertionSummary;
  assertionHighlights?: AssertionHighlight[];
  healthState?: HealthState;
  healthReasons?: string[];
  /** True when authors are initials-only (e.g. "Smith, J."); keep initials unless we have high-confidence metadata. */
  authorInitialsOnly?: boolean;
  /** True when full names were filled from DOI/metadata lookup (confidence-gated only). */
  authorsExpandedFromMetadata?: boolean;
  truthProvenance?: TruthProvenance;
  reportEngineSnapshot?: ReportEngineSnapshot;
  debug?: ReferenceDebugEnvelope;
  review?: ReferenceReviewPayload;
  adminReview?: ReferenceAdminReviewPayload;
  exportPayload?: ReferenceExportPayload;
  analyticsPayload?: ReferenceAnalyticsPayload;
}

// Authority lookup status (trust + analytics)
export type AuthorityStatus =
  | 'none'      // feature off
  | 'blocked'   // not Pro
  | 'skipped'   // pro but enrichWithAuthority=false or not eligible
  | 'cache_hit'
  | 'fetched'
  | 'no_match'
  | 'error';

// Conversion response
export interface ConversionResponse {
  convertedReferences: ConvertedReference[];
  clusters?: Cluster[];
  duplicateGroups?: DuplicateGroup[];
  engineVersion?: 'v1' | 'v2';
  errors?: string[];
}

export interface DuplicateGroup {
  groupId: string;
  primaryId: string;
  method: 'doi' | 'structural' | 'semantic';
  members: ConvertedReference[];
}

// Validation schemas
export const conversionRequestSchema = z.object({
  references: z.array(z.string().min(1)).optional(),
  content: z.string().min(1).optional(),
  inputStyle: z.string(),
  outputStyle: z.string(),
  enrichWithAuthority: z.boolean().optional().default(false),
  isPro: z.boolean().optional().default(false),
  engineVersion: z.enum(['v1', 'v2']).optional(),
}).superRefine((value, ctx) => {
  const hasReferences = Array.isArray(value.references) && value.references.some((reference) => reference.trim().length > 0);
  const hasContent = typeof value.content === 'string' && value.content.trim().length > 0;

  if (hasReferences || hasContent) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Either references or content must be provided.',
    path: ['references'],
  });
});

// In-memory storage types
export interface InsertReference {
  originalText: string;
  inputStyle: string;
  outputStyle: string;
  parsedData?: ParsedReference | null;
  convertedText?: string | null;
  referenceType?: string | null;
  confidenceScore?: number | null;
  workKey?: string | null;
  patternHits?: PatternHit[] | null;
  authorityStatus?: AuthorityStatus | null;
}

export interface Reference extends InsertReference {
  id: number;
  createdAt: Date;
}

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

export type TruthMatchType = 'fingerprint' | 'doi' | 'workKey';

export type TruthAliasType = TruthMatchType;

export type TruthStalenessReason =
  | 'engine_version_changed'
  | 'renderer_changed'
  | 'canonical_shape_changed'
  | 'csl_schema_changed'
  | 'manual';

export interface TruthProvenance {
  truthApplied: boolean;
  truthMatchType?: TruthMatchType;
  truthId?: string;
  appliedFields?: string[];
  usedValidatedOutput?: boolean;
  staleTruth?: boolean;
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
  inputProfile?: InputProfile;
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
  aliasType: TruthAliasType;
  aliasValue: string;
}

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

/** ── Contact & Feedback ── */

export const contactRequestSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email address"),
  subject: z.enum(["feature", "recommendation", "bug", "contact"]),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

export type ContactRequest = z.infer<typeof contactRequestSchema>;

export const waitlistRequestSchema = z.object({
  email: z.string().email("Invalid email address"),
  persona: z.enum(["student", "researcher", "educator", "developer", "team"]),
});

export type WaitlistRequest = z.infer<typeof waitlistRequestSchema>;

// ── v2 Canonical Engine Types ──

export type V2SourceType = 'text' | 'bib' | 'ris' | 'pdf_base64' | 'url' | 'doi_list';
export type V2FieldSource = 'extracted' | 'authority' | 'merged' | 'user' | 'normalized';
export type V2StageId =
  | 'ingest'
  | 'split'
  | 'extract'
  | 'validate'
  | 'truth'
  | 'dedup'
  | 'enrich'
  | 'group'
  | 'detect'
  | 'score'
  | 'normalize'
  | 'render'
  | 'respond';

export type V2StageStatus = 'success' | 'warning' | 'error' | 'skipped';
export type V2CitationStatus = 'active' | 'duplicate' | 'merged';

export interface V2StageTiming {
  stageId: V2StageId | string;
  status: V2StageStatus;
  durationMs: number;
  workUnits?: number;
  timeoutMs?: number;
}
export type CanonicalReferenceType =
  | 'journal'
  | 'book'
  | 'chapter'
  | 'conference'
  | 'thesis'
  | 'website'
  | 'report'
  | 'preprint'
  | 'unknown';

export interface FieldValue<T> {
  value: T;
  source: V2FieldSource;
  confidence: number;
  stageId: string;
  mergedFrom?: string[];
  conflictResolution?: string;
}

export interface CanonicalAuthor {
  first: string | null;
  last: string;
  initials: string | null;
  literal?: string;
  orcid?: string;
}

export interface StageDiagnostic {
  stageId: V2StageId | string;
  status: V2StageStatus;
  message: string;
  code?: string;
  timestamp: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface ValidationIssue {
  field?: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  extracted?: unknown;
  expected?: unknown;
}

export interface DuplicateMetadata {
  status?: V2CitationStatus;
  duplicateOf?: string | null;
  method?: 'doi' | 'structural' | 'semantic';
  mergedFrom?: string[];
  clusterKey?: string;
  mergeReason?: string;
  changedFields?: string[];
  confidencePenalty?: number;
}

export interface EnrichmentMetadata {
  status: 'skipped' | 'fetched' | 'no_match' | 'error';
  provider?: string;
  sourceUsed?: 'cache' | 'crossref_doi' | 'crossref_title_author' | 'semantic_scholar' | 'pubmed' | 'openalex' | 'timeout_fallback' | 'unverifiable' | 'skipped';
  cacheHit?: boolean;
  doiFound?: boolean;
  abstractFound?: boolean;
  retractedFlag?: boolean;
  timedOut?: boolean;
  confidencePenalty?: number;
  matchedTitle?: string;
  matchedAuthors?: string[];
  matchedYear?: number;
  abstract?: string;
  url?: string;
  raw?: Record<string, unknown>;
}

export type ResolutionStatus =
  | 'verified'
  | 'verified_with_year_tolerance'
  | 'no_exact_match'
  | 'ambiguous_match'
  | 'insufficient_evidence'
  | 'provider_no_coverage'
  | 'provider_error'
  | 'skipped_duplicate';

export type ResolutionMatchStrategy =
  | 'crossref_doi'
  | 'crossref_exact_title'
  | 'pubmed_exact_title'
  | 'openalex_exact_title'
  | 'none';

export interface ResolutionAcceptedCandidate {
  provider: string;
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  doi?: string;
  url?: string;
  sourceType?: string;
}

export interface ResolutionQueryEvidence {
  titlePresent: boolean;
  titleTokenCount: number;
  firstAuthorSurname?: string;
  groupAuthorLiteral?: string;
  year?: number | null;
  venue?: string | null;
  url?: string | null;
  sourceType?: CanonicalReferenceType;
}

export interface ResolutionMetadata {
  status: ResolutionStatus;
  resolvedAt?: string;
  provider?: string;
  matchStrategy?: ResolutionMatchStrategy;
  candidateCount: number;
  acceptedCandidate?: ResolutionAcceptedCandidate;
  rejectedReasons: string[];
  appliedFields: string[];
  conflictFields: string[];
  yearToleranceApplied: boolean;
  queryEvidence: ResolutionQueryEvidence;
}

export type CitationReviewBucket = 'ready' | 'worth_reviewing' | 'action_needed';

export interface CitationQualityScore {
  overall: number;
  grade: 'A' | 'B' | 'C' | 'F';
  fieldScores: Record<string, number>;
  flags: string[];
  missingRequired: string[];
  missingOptional: string[];
  bucket: CitationReviewBucket;
  bucketReasons: string[];
}

export interface SplitMetadata {
  confidence: number;
  reasons: string[];
  method: 'structural' | 'llm' | 'hybrid';
  fallbackUsed: boolean;
}

export interface ExtractionMetadata {
  method: 'deterministic' | 'llm' | 'hybrid';
  fallbackUsed: boolean;
  extractorPath?: 'deterministic' | 'grobid' | 'llm' | 'hybrid';
  selectedBranch?: 'deterministic_raw' | 'year_anchored_fallback_raw' | 'institutional_heuristic_raw' | 'in_source_heuristic_raw' | 'hybrid';
  selectionReason?: string;
  authorParserMode?: string;
  rejectedCandidates?: string[];
}

export interface ValidationMetadata {
  verificationAttempted: boolean;
  authoritySource?: string;
  mismatchFields: string[];
}

export interface InputProfile {
  structure: 'structured' | 'semi_structured' | 'unstructured' | 'unknown';
  confidence: number;
  inputType: 'bibtex' | 'ris' | 'numbered_list' | 'prose_footnotes' | 'mixed_styles' | 'doi_list' | 'plain_blob' | 'unknown';
  estimatedCount: number;
  hasDois: boolean;
  hasUrls: boolean;
  styleHints: string[];
  signals: string[];
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

export interface NormalizationMetadata {
  doiNormalized: boolean;
  unicodeRepairedFields: string[];
  titleCaseApplied: boolean;
  journalNormalizationHookAvailable: boolean;
}

export interface CitationRenderedOutput {
  outputStyle: string;
  formatted: string;
  warnings: string[];
  sanitized?: boolean;
  assertionSummary?: AssertionSummary;
  assertionHighlights?: AssertionHighlight[];
}

export interface V2CitationStageDebug {
  [stageId: string]: Record<string, unknown>;
}

export interface V2CitationDebugTrace {
  citationId: string;
  raw: string;
  status: V2CitationStatus;
  stages: V2CitationStageDebug;
}

export interface V2DebugPayload {
  enabled: boolean;
  jobStages: Record<string, Record<string, unknown>>;
  citations: V2CitationDebugTrace[];
}

export interface CanonicalCitation {
  id: string;
  raw: string;
  status: V2CitationStatus;
  referenceType: CanonicalReferenceType;
  authors: FieldValue<CanonicalAuthor[]>;
  title: FieldValue<string | null>;
  year: FieldValue<number | null>;
  journal: FieldValue<string | null>;
  volume: FieldValue<string | null>;
  issue: FieldValue<string | null>;
  pages: FieldValue<string | null>;
  doi: FieldValue<string | null>;
  publisher: FieldValue<string | null>;
  url: FieldValue<string | null>;
  conferenceTitle: FieldValue<string | null>;
  bookTitle: FieldValue<string | null>;
  institution: FieldValue<string | null>;
  edition: FieldValue<string | null>;
  editor: FieldValue<string | null>;
  detectedStyle: FieldValue<string | null>;
  split?: SplitMetadata;
  extraction?: ExtractionMetadata;
  validation?: ValidationMetadata;
  resolution?: ResolutionMetadata;
  normalization?: NormalizationMetadata;
  truth?: TruthProvenance & {
    resolvedCanonical?: ApprovedCanonicalFields;
    validatedOutput?: string;
  };
  validationIssues: ValidationIssue[];
  duplicate?: DuplicateMetadata | null;
  enrichment?: EnrichmentMetadata | null;
  quality?: CitationQualityScore;
  rendered?: CitationRenderedOutput;
  stageDebug?: V2CitationStageDebug;
  stageLog: StageDiagnostic[];
}

export interface V2DuplicateEntry {
  originalId: string;
  duplicateId: string;
  method: 'doi' | 'structural' | 'semantic';
  mergedId?: string;
}

export interface V2ConversionStats {
  input_count: number;
  unique_count: number;
  duplicate_count: number;
  enriched_count: number;
  avg_confidence: number;
  retracted_count: number;
  llm_fallback_count: number;
}

export interface V2Exports {
  txt: string;
  bib: string;
  ris: string;
  csv: string;
  docx: string;
}

export interface V2ProcessingPath {
  stagesRun: string[];
  fallbacksUsed: string[];
  durationMs: number;
  partialResult: boolean;
  executionMode?: 'sync' | 'async';
  extractorPathsUsed?: string[];
  partialReasons?: string[];
  stageTimings?: V2StageTiming[];
  slowestStages?: V2StageTiming[];
}

export interface V2ConversionResponse {
  job_id: string;
  processed_at: string;
  stats: V2ConversionStats;
  citations: CanonicalCitation[];
  groups: Record<string, string[]>;
  duplicates: V2DuplicateEntry[];
  exports: V2Exports;
  processingPath: V2ProcessingPath;
  debug?: V2DebugPayload;
  pipeline_log: StageDiagnostic[];
  inputProfile?: InputProfile;
}

export const v2ConversionRequestSchema = z.object({
  sourceType: z.enum(['text', 'bib', 'ris', 'pdf_base64', 'url', 'doi_list']),
  content: z.string().min(1),
  inputStyle: z.string().optional().default('auto'),
  outputStyle: z.string().optional().default('apa'),
  enrich: z.boolean().optional().default(true),
  dedup: z.boolean().optional().default(true),
  group: z.boolean().optional().default(false),
  debug: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type V2ConversionRequest = z.infer<typeof v2ConversionRequestSchema>;

export const v2ExportFormatSchema = z.enum(['txt', 'bib', 'ris', 'csv', 'docx']);
export type V2ExportFormat = z.infer<typeof v2ExportFormatSchema>;
