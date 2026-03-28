/**
 * shared/schema/v2Types.ts
 *
 * V2 engine-specific types: pipeline stages, canonical citations,
 * field values, resolution, enrichment, quality scoring, and response envelopes.
 */

import type {
  AssertionSummary,
  AssertionHighlight,
  TruthProvenance,
} from './types';

import type { ApprovedCanonicalFields } from './reportTypes';

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
  selectorMode?: V2SelectorMode;
  selectionMode?: CandidateSelectionMode;
  winnerAdapterId?: string;
  winnerCandidateId?: string;
  typeResolutionReason?: string;
  authorParserMode?: string;
  rejectedCandidates?: string[];
  llmFallbackAttempted?: boolean;
  llmFallbackAccepted?: boolean;
  llmFallbackReason?: string;
  llmFallbackSkippedByBudget?: boolean;
  llmFallbackFieldsImproved?: string[];
  llmFallbackStrictPassDelta?: number;
  llmFallbackFirstAuthorConfidence?: number;
}

export interface ValidationMetadata {
  verificationAttempted: boolean;
  authoritySource?: string;
  mismatchFields: string[];
}

export interface InstitutionMappingMetadata {
  mapped: boolean;
  source: 'parsed_institution' | 'parsed_publisher' | 'authority_institution' | 'authority_publisher' | 'none';
  originalValue?: string | null;
}

export type V2SelectorMode = 'legacy_first_match' | 'multi_candidate';
export type CandidateSelectionMode = 'full_scoring' | 'single_survivor' | 'unanimous_diversity_guard';
export type ContainerKindHint = 'journal' | 'conference' | 'book' | 'report' | 'thesis' | 'website' | 'unknown';

export interface FieldPlausibilityAssessment {
  plausible: boolean;
  penalty: number;
  reason: string;
}

export interface ExtractionCandidatePlausibility {
  authors: FieldPlausibilityAssessment;
  title: FieldPlausibilityAssessment;
  venue: FieldPlausibilityAssessment;
  locator: FieldPlausibilityAssessment;
  publisher: FieldPlausibilityAssessment;
  year: FieldPlausibilityAssessment;
}

export interface ExtractionContainerHints {
  containerKindHint: ContainerKindHint;
  containerKindConfidence: number;
  venueContaminated: boolean;
  titleContainerBleed: boolean;
  publisherTailPresent: boolean;
  locatorInVenue: boolean;
  copyrightTailPresent: boolean;
  copyrightPublisherCandidate?: string | null;
}

export interface ExtractionCandidateNormalizedKeyFields {
  title: string | null;
  year: string | null;
  venue: string | null;
  doi: string | null;
}

export interface ExtractionCandidate {
  id: string;
  adapterId: string;
  claimedType: CanonicalReferenceType;
  parsed: Record<string, unknown>;
  normalizedKeyFields: ExtractionCandidateNormalizedKeyFields;
  containerHints: ExtractionContainerHints;
  plausibility: ExtractionCandidatePlausibility;
}

export interface CandidateScoreBreakdown {
  vetoed: boolean;
  vetoReasons: string[];
  requiredCoveredCount: number;
  expectedCoveredCount: number;
  optionalCoveredCount: number;
  contaminationPenalty: number;
  consensusScore: number;
  sourceTypeCoherence: number;
  doiYearConsistency: number;
  adapterPriority: number;
}

export interface AdapterFiringRegistryEntry {
  adapterId: string;
  candidateId?: string;
  attempted: boolean;
  producedCandidate: boolean;
  vetoed: boolean;
  vetoReasons: string[];
  coverageTuple: [number, number, number];
  contaminationPenalty: number;
  consensusScore: number;
  sourceTypeCoherence: number;
  doiYearConsistency: number;
  adapterPriority: number;
  selected: boolean;
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

export type FieldRepairConfidence = 'high' | 'medium' | 'low';

export interface AppliedRepairMetadata {
  field: string;
  source: string;
  before?: string;
  after?: string;
  confidence?: FieldRepairConfidence;
}

export interface RepairMissMetadata {
  field: string;
  brokenSpan: string;
  sourceSpan?: string;
  code?: string;
}

export interface ResidualArtifactMetadata {
  field: string;
  severity: 'high' | 'medium' | 'low';
  code: string;
  value: string;
}

export interface NormalizationMetadata {
  doiNormalized: boolean;
  unicodeRepairedFields: string[];
  titleCaseApplied: boolean;
  journalNormalizationHookAvailable: boolean;
  appliedRepairs?: AppliedRepairMetadata[];
  repairMisses?: RepairMissMetadata[];
  fieldRepairConfidence?: Record<string, FieldRepairConfidence>;
  citationRepairConfidence?: FieldRepairConfidence;
  residualArtifacts?: ResidualArtifactMetadata[];
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
  placeOfPublication: FieldValue<string | null>;
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
  institutionMapping?: InstitutionMappingMetadata;
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
