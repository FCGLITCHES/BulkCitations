export type EngineSourceType = "text" | "doi_list";

export type EngineInspectSourceType =
  | "text"
  | "pdf"
  | "docx"
  | "txt"
  | "bib"
  | "ris"
  | "doi_list";

export type EngineOutputStyle =
  | "apa7"
  | "mla9"
  | "chicago-author-date"
  | "chicago-notes-bib"
  | "vancouver"
  | "ieee"
  | "harvard-ctr"
  | "ama"
  | "acs"
  | "unknown"
  | "auto";

export type EngineStyleFamily =
  | "author_date"
  | "numeric"
  | "notes_bibliography"
  | "web_accessed"
  | "unknown";

export type EngineStyleCertaintyTier = "high" | "medium" | "low";

export type EngineStyleSignalCode =
  | "bracketed_enumerator"
  | "numeric_dot_enumerator"
  | "numeric_paren_enumerator"
  | "parenthesized_enumerator"
  | "author_surname_initials"
  | "author_initials_surname"
  | "author_lead_ambiguous"
  | "quoted_title_lead"
  | "author_year_lead"
  | "has_et_al"
  | "author_bucket_single"
  | "author_bucket_few"
  | "author_bucket_many"
  | "author_separator_comma"
  | "author_separator_semicolon"
  | "author_separator_and"
  | "author_separator_ampersand"
  | "year_parenthesized_after_authors"
  | "year_bare_after_authors"
  | "year_repeated_conference"
  | "year_end_position"
  | "ieee_incompatible_author_date_year_placement"
  | "year_early_position"
  | "year_late_position"
  | "quoted_title"
  | "title_followed_by_period"
  | "title_followed_by_comma"
  | "title_sentence_case"
  | "title_title_case"
  | "cue_in_container"
  | "cue_conference"
  | "cue_journal"
  | "cue_book_publisher"
  | "cue_web_access"
  | "marker_editor"
  | "marker_translator"
  | "marker_edition"
  | "locator_vol"
  | "locator_no"
  | "locator_pp"
  | "locator_ieee_signature"
  | "locator_semicolon_volume_issue_pages"
  | "locator_volume_issue_pages"
  | "locator_page_range_only"
  | "identifier_doi"
  | "identifier_url"
  | "identifier_at_end"
  | "identifier_accessed_retrieved"
  | "capitalization_quoted_title_profile"
  | "capitalization_heavy_titlecase"
  | "capitalization_numeric_minimal"
  | "punctuation_period_dense"
  | "punctuation_comma_dense"
  | "punctuation_mixed_cadence"
  | "web_url_without_scholarly_locators"
  | "web_host_like_container";

export type EngineReferenceType =
  | "article-journal"
  | "book"
  | "book-chapter"
  | "thesis"
  | "conference-paper"
  | "webpage"
  | "report"
  | "dataset"
  | "preprint"
  | "unknown";

export type EnginePublicStatus = "ready" | "needs_review" | "needs_action";
export type EnginePipelineStatus = "success" | "partial" | "failed";
export type EngineJobStatus = "pending" | "processing" | "completed" | "partial" | "failed";
export type EngineExportFormat = "txt" | "bib" | "ris" | "csv" | "docx";
export type EngineParseProfile = "core_parse_fast" | "core_parse_full" | "pro_overlay_enrich" | "debug_full" | "current_runtime";
export type EngineParseOutcome =
  | "high_confidence_parse"
  | "partial_parse_with_abstentions"
  | "needs_action";

export type EngineDetectedFormat =
  | "doi_list"
  | "bibtex"
  | "ris"
  | "numbered_list"
  | "blank_line"
  | "hanging_indent"
  | "plain_text"
  | "unknown";

export type EngineIngestionStructure = "structured" | "semi_structured" | "unstructured" | "unknown";

export type EngineIngestCleanupHint =
  | "fixed_eol_hyphens"
  | "merged_soft_breaks"
  | "stripped_pdf_artifacts"
  | "cleanup_candidate_generated"
  | "cleanup_selected"
  | "cleanup_rejected";

export type EngineInputCleanupDecisionReason =
  | "quality_improved"
  | "equal_or_noise"
  | "format_change_without_quality_gain"
  | "block_count_divergence"
  | "not_pdf_like"
  | "cleanup_error";

export interface EngineInputCleanupInfo {
  lookedLikePdfCopy: boolean;
  cleanupApplied: boolean;
  finalUsed: "baseline" | "cleaned";
  hints: EngineIngestCleanupHint[];
  qualityDelta?: number;
  decisionReason?: EngineInputCleanupDecisionReason;
}

export interface EngineCanonicalAuthor {
  family: string;
  given: string | null;
  initials: string | null;
  literal?: string;
  orcid?: string;
  isCorporate: boolean;
}

export interface EngineFieldValue<T> {
  value: T;
  confidence: number;
  source: string;
  origin: "ml" | "authority" | "admin" | "user_consensus" | "heuristic" | "ingestion";
  stageId: string;
  uncertain: boolean;
  previousValue?: T;
  previousSource?: string;
  previousOrigin?: string;
}

export type EngineWarningSeverity = "info" | "review" | "action";

export interface EngineHealthWarning {
  code: string;
  severity: EngineWarningSeverity;
  message?: string;
}

export interface EngineHealthBreakdown {
  missingMandatory: string[];
  invalidMandatory: string[];
  lowConfidenceMandatory: string[];
  presentMandatory: string[];
}

export interface EngineScoreBreakdown {
  fieldEvidenceScore: number;
  contentCorrectnessScore: number;
  cosmeticFormatScore: number;
  formatCorrectnessScore: number;
  structuralIntegrityScore: number;
  fieldEvidence: {
    completeness: number;
    avgMandatoryConfidence: number;
  };
  formatScoringPath: "guaranteed" | "fallback";
  formatSubscores: {
    authorFormatScore: number;
    titleCaseScore: number;
    punctuationScore: number;
    fieldOrderScore: number;
    spacingScore: number;
    noDuplicatePunctScore: number;
    containerFormatScore: number;
  };
  semanticSegmentSubscores: {
    authorScore: number;
    titleScore: number;
    yearScore: number;
    containerScore: number;
    locatorOrIdentifierScore: number;
  };
  cosmeticSubscores: {
    titleCaseScore: number;
    spacingScore: number;
    noDuplicatePunctScore: number;
    punctuationScore: number;
  };
  structuralSubscores: {
    refTypeConfidenceScore: number;
    noDuplicateFieldsScore: number;
    noArtifactTokensScore: number;
    noCorruptedContainerScore: number;
    fieldBoundaryScore: number;
    noDuplicateAuthorScore: number;
    locatorConsistencyScore: number;
  };
  penalties: Array<{
    code: string;
    points: number;
  }>;
  authorityAdjustment: number;
  diagnostics: {
    splitQualityFlag: "ok" | "low" | "sampled";
    detectionConfidence: number;
    rawDetectionConfidence: number;
    effectiveDetectionConfidence: number;
    formatScoringPathReason:
      | "style_guaranteed"
      | "style_fallback"
      | "low_detection_confidence";
    rescoredAfterCorrection: boolean;
    scoreVersion: string;
  };
  rawScore: number;
  displayScore: number;
}

export interface EngineStyleCandidateScore {
  style: EngineOutputStyle;
  score: number;
}

export interface EngineStyleFamilyCandidateScore {
  family: EngineStyleFamily;
  score: number;
}

export interface EngineExtractedFields {
  authors: EngineFieldValue<EngineCanonicalAuthor[]>;
  title: EngineFieldValue<string | null>;
  year: EngineFieldValue<number | null>;
  journal: EngineFieldValue<string | null>;
  volume: EngineFieldValue<string | null>;
  issue: EngineFieldValue<string | null>;
  pages: EngineFieldValue<string | null>;
  doi: EngineFieldValue<string | null>;
  publisher: EngineFieldValue<string | null>;
  placeOfPublication: EngineFieldValue<string | null>;
  url: EngineFieldValue<string | null>;
  conferenceTitle: EngineFieldValue<string | null>;
  bookTitle: EngineFieldValue<string | null>;
  institution: EngineFieldValue<string | null>;
  edition: EngineFieldValue<string | null>;
  editors: EngineFieldValue<EngineCanonicalAuthor[]>;
  thesisType: EngineFieldValue<string | null>;
  repository: EngineFieldValue<string | null>;
  articleNumber: EngineFieldValue<string | null>;
  accessedDate: EngineFieldValue<string | null>;
  siteName: EngineFieldValue<string | null>;
  database: EngineFieldValue<string | null>;
  reportNumber: EngineFieldValue<string | null>;
}

export interface EngineAuthorityFlag {
  type: "retracted" | "expression_of_concern" | "author_conflict" | "metadata_mismatch";
  source: string;
  date?: string;
  details?: string;
}

export interface EngineStageRunRecord {
  stageId: string;
  contractVersion: number;
  phaseId: string;
  status: "pending" | "running" | "success" | "warning" | "error" | "skipped";
  durationMs: number;
  inputHash?: string;
  outputHash?: string;
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
}

/** Mirrors server ExtractionMeta — Phase 4 path disclosure for UI */
export interface EngineExtractionMeta {
  modelVersion: string | null;
  featureVersion: string | null;
  styleUsed: string;
  overallConfidence: number | null;
  fieldConfidences: Record<string, number>;
  uncertainFields: string[];
  runMode: "heuristic" | "shadow" | "ml";
  timestamp: string;
  mlError?: { code: string; message: string } | null;
}

export interface EngineCountAudit {
  inputEstimate: number;
  aggregatedCount: number;
  splitCount: number;
  delta: number;
  needsActionCount: number;
  droppedCount: number;
}

export interface EngineProcessingPath {
  stagesRun: string[];
  fallbacksUsed: string[];
  durationMs: number;
  partialResult: boolean;
  batchConfig: {
    batchSize: number;
    maxConcurrency: number;
  };
  stageTimings: Array<{
    phaseId: string;
    durationMs: number;
    status: string;
  }>;
}

export interface EngineProviderUsage {
  crossrefCalls: number;
  openalexCalls: number;
  semanticScholarCalls: number;
  llmTokensUsed: number;
  llmRepairCalls: number;
  cacheHits: number;
}

export interface EngineProcessedCitation {
  id: string;
  index: number;
  raw: string;
  outputLatencyMs: number;
  inputCleanup?: EngineInputCleanupInfo;
  publicStatus: EnginePublicStatus;
  parseOutcome: EngineParseOutcome;
  status: "ok" | "error";
  error?: {
    phase: string;
    code: string;
    message: string;
    recoverable: boolean;
  };
  partialData?: Partial<EngineExtractedFields>;
  referenceType: EngineReferenceType;
  detectedStyleFamily: EngineStyleFamily;
  detectedStyle: EngineOutputStyle;
  familyConfidence: number;
  styleConfidence: number;
  familyMarginToRunnerUp: number;
  styleMarginToRunnerUp: number;
  certaintyTier: EngineStyleCertaintyTier;
  familyCandidates: EngineStyleFamilyCandidateScore[];
  styleCandidates: EngineStyleCandidateScore[];
  styleSignals: EngineStyleSignalCode[];
  conflictDampened: boolean;
  effectiveStyle: EngineOutputStyle;
  effectiveStyleSource: "requested" | "detected" | "doi_fast_path" | "default";
  inputStyleUncertain: boolean;
  rawDetectionConfidence: number;
  effectiveDetectionConfidence: number;
  outputStyle: EngineOutputStyle;
  styleResolution: {
    requestedStyle: EngineOutputStyle;
    detectedStyle: EngineOutputStyle;
    effectiveStyle: EngineOutputStyle;
    effectiveStyleSource: "requested" | "detected" | "doi_fast_path" | "default";
    rawDetectionConfidence: number;
    effectiveDetectionConfidence: number;
    inputStyleUncertain: boolean;
    effectiveStyleKnown: boolean;
  };
  doiVerification: {
    status: "absent" | "verified" | "conflicted" | "unverified";
    reasons: string[];
  };
  fields: EngineExtractedFields;
  rawScore: number;
  displayScore: number;
  scoreBreakdown: EngineScoreBreakdown;
  healthReasons: string[];
  healthBreakdown: EngineHealthBreakdown;
  healthWarnings: EngineHealthWarning[];
  authorityFlags: EngineAuthorityFlag[];
  renderedText: string;
  renderedWarnings: string[];
  extractionMeta?: EngineExtractionMeta;
  fieldMoveLedger: Array<{
    phaseId: string;
    reasonCode: string;
    sourceField: string;
    destinationField: string;
    action: "set" | "clear" | "mutate" | "restore";
    previousValue: unknown;
    nextValue: unknown;
    beforeConfidence: number | null;
    afterConfidence: number | null;
  }>;
  /** Skipped core pipeline extraction — fields from DOI resolution */
  doiFastPath?: boolean;
  duplicateOf?: string;
  isDuplicateCandidate?: boolean;
  pipelineMajor: 3;
  stageLog: EngineStageRunRecord[];
}

export interface EngineDuplicateGroup {
  groupId: string;
  primaryId: string;
  memberIds: string[];
  method: "minhash_lsh" | "doi_exact";
  jaccardScore: number;
}

export interface EngineDetectionEnvelope {
  chosen: { format: string; score: number; evidence: string[] };
  secondBest: { format: string; score: number } | null;
  confidence: number;
  effectiveConfidence: number;
  method: "scored" | "forced";
  perBlockUsed: boolean;
  sampled: boolean;
}

export interface EngineBlockPreview {
  index: number;
  text: string;
  splitReason: string;
  blockFormat: string;
}

export interface EngineInspectResponse {
  estimatedCount: number;
  aggregatedCount: number;
  splitCount: number;
  countAudit: EngineCountAudit;
  detectedFormat: EngineDetectedFormat;
  detectedDois: string[];
  formatConfidence: number;
  structure: EngineIngestionStructure;
  styleHints: string[];
  needsActionCount: number;
  diagnostics?: EngineStageRunRecord[];
  detection?: EngineDetectionEnvelope;
  cleanup?: {
    mode: "off" | "inspect_only" | "full";
    lookedLikePdfCopy: boolean;
    candidateGenerated: boolean;
    baselineDetectedFormat: EngineDetectedFormat;
    cleanedDetectedFormat?: EngineDetectedFormat;
    baselineSplitQuality: number;
    cleanedSplitQuality?: number;
    qualityDelta?: number;
    wouldSelect: "baseline" | "cleaned";
    finalUsed: "baseline" | "cleaned";
    decisionReason?: EngineInputCleanupDecisionReason;
  };
  blocks?: EngineBlockPreview[];
}

export interface EngineConvertResponse {
  jobId: string;
  jobAccessToken?: string;
  status: EnginePipelineStatus;
  summary: {
    total: number;
    ready: number;
    needsReview: number;
    needsAction: number;
    failed: number;
    parseQuality: number;
  };
  references: EngineProcessedCitation[];
  failedIndices: number[];
  duplicateGroups: EngineDuplicateGroup[];
  exports: Array<{
    format: EngineExportFormat;
    available: boolean;
  }>;
  countAudit: EngineCountAudit;
  processingPath: EngineProcessingPath;
  providerUsage: EngineProviderUsage;
  retryPayload?: {
    inputs: string[];
    hint: string;
  };
  warnings: string[];
  diagnostics?: EngineStageRunRecord[];
}

export interface EngineJobCreatedResponse {
  jobId: string;
  jobAccessToken?: string;
  status: "pending";
  estimatedDuration: number;
}

export interface EngineJobStatusResponse {
  jobId: string;
  jobAccessToken?: string;
  status: EngineJobStatus;
  executionMode: "sync" | "async";
  progress?: {
    totalRefs: number;
    processedRefs: number;
    currentPhase: string | null;
    percentComplete: number;
  };
  summary?: EngineConvertResponse["summary"];
  countAudit?: EngineCountAudit;
  references?: EngineProcessedCitation[];
  exports?: Array<{
    format: EngineExportFormat;
    available: boolean;
  }>;
  warnings?: string[];
  diagnostics?: EngineStageRunRecord[];
  error?: {
    code: string;
    message: string;
  };
}

export interface EngineResultModel {
  jobId: string;
  jobAccessToken?: string;
  status: EnginePipelineStatus;
  summary: EngineConvertResponse["summary"];
  references: EngineProcessedCitation[];
  duplicateGroups: EngineDuplicateGroup[];
  exports: Array<{
    format: EngineExportFormat;
    available: boolean;
  }>;
  countAudit: EngineCountAudit;
  warnings: string[];
  diagnostics?: EngineStageRunRecord[];
  processingPath?: EngineProcessingPath;
  providerUsage?: EngineProviderUsage;
}

export const ENGINE_OUTPUT_STYLE_OPTIONS: Array<{ value: EngineOutputStyle; label: string }> = [
  { value: "apa7", label: "APA (7th Edition)" },
  { value: "mla9", label: "MLA (9th Edition)" },
  { value: "chicago-author-date", label: "Chicago Author-Date" },
  { value: "chicago-notes-bib", label: "Chicago Notes & Bibliography" },
  { value: "harvard-ctr", label: "Harvard CTR" },
  { value: "vancouver", label: "Vancouver" },
  { value: "ieee", label: "IEEE" },
  { value: "ama", label: "AMA" },
  { value: "acs", label: "ACS" },
];

export const ENGINE_INPUT_MODE_OPTIONS = [
  { value: "auto", label: "Auto profile" },
  { value: "text", label: "Text batch" },
  { value: "doi_list", label: "DOI list" },
] as const;

export type EngineInputMode = typeof ENGINE_INPUT_MODE_OPTIONS[number]["value"];

export const ENGINE_EXPORT_FORMAT_LABELS: Record<EngineExportFormat, string> = {
  txt: "TXT",
  bib: "BibTeX",
  ris: "RIS",
  csv: "CSV",
  docx: "DOCX",
};

export const ENGINE_REFERENCE_TYPE_LABELS: Record<EngineReferenceType, string> = {
  "article-journal": "Journal Article",
  book: "Book",
  "book-chapter": "Book Chapter",
  thesis: "Thesis",
  "conference-paper": "Conference Paper",
  webpage: "Website",
  report: "Report",
  dataset: "Dataset",
  preprint: "Preprint",
  unknown: "Unknown",
};

export function outputStyleLabel(style: EngineOutputStyle): string {
  return ENGINE_OUTPUT_STYLE_OPTIONS.find((option) => option.value === style)?.label ?? style;
}
