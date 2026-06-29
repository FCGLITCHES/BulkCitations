/**
 * Centralized ErrorCode enum.
 * All pipeline phases and API routes use these codes in error responses.
 * Format: <PHASE_PREFIX>_<DESCRIPTION>
 */
export enum ErrorCode {
  // ---------------------------------------------------------------------------
  // Generic / Infrastructure
  // ---------------------------------------------------------------------------
  INTERNAL_ERROR            = 'INTERNAL_ERROR',
  NOT_FOUND                 = 'NOT_FOUND',
  UNAUTHORIZED              = 'UNAUTHORIZED',
  FORBIDDEN                 = 'FORBIDDEN',
  RATE_LIMIT_EXCEEDED       = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED            = 'QUOTA_EXCEEDED',
  VALIDATION_ERROR          = 'VALIDATION_ERROR',
  INPUT_VALIDATION_FAILED   = 'INPUT_VALIDATION_FAILED',
  IDEMPOTENCY_CONFLICT      = 'IDEMPOTENCY_CONFLICT',
  PHASE_TIMEOUT             = 'PHASE_TIMEOUT',
  PHASE_ERROR               = 'PHASE_ERROR',
  CIRCUIT_BREAKER_OPEN      = 'CIRCUIT_BREAKER_OPEN',
  CONCURRENT_JOB_LIMIT      = 'CONCURRENT_JOB_LIMIT',
  AUTH_AUDIENCE_MISMATCH    = 'AUTH_AUDIENCE_MISMATCH',
  AUTH_BACKEND_UNAVAILABLE  = 'AUTH_BACKEND_UNAVAILABLE',

  // ---------------------------------------------------------------------------
  // Job system
  // ---------------------------------------------------------------------------
  JOB_NOT_FOUND             = 'JOB_NOT_FOUND',
  JOB_ALREADY_COMPLETE      = 'JOB_ALREADY_COMPLETE',
  JOB_QUEUING_FAILED        = 'JOB_QUEUING_FAILED',
  JOB_TIMEOUT               = 'JOB_TIMEOUT',
  JOB_BATCH_FAILURE         = 'JOB_BATCH_FAILURE', // only for infrastructure-level errors
  JOB_EXPIRED               = 'JOB_EXPIRED',

  // ---------------------------------------------------------------------------
  // Phase 1: Ingestion
  // ---------------------------------------------------------------------------
  INGEST_EMPTY_INPUT        = 'INGEST_EMPTY_INPUT',
  INGEST_INPUT_TOO_LARGE    = 'INGEST_INPUT_TOO_LARGE',
  INGEST_FILE_TOO_LARGE     = 'INGEST_FILE_TOO_LARGE',
  INGEST_ENCODING_ERROR     = 'INGEST_ENCODING_ERROR',
  INGEST_UNSUPPORTED_FORMAT = 'INGEST_UNSUPPORTED_FORMAT',
  INGEST_PDF_EXTRACT_FAILED = 'INGEST_PDF_EXTRACT_FAILED',
  INGEST_DOCX_EXTRACT_FAILED= 'INGEST_DOCX_EXTRACT_FAILED',
  INGEST_BIB_PARSE_FAILED   = 'INGEST_BIB_PARSE_FAILED',
  INGEST_RIS_PARSE_FAILED   = 'INGEST_RIS_PARSE_FAILED',
  INGEST_DOI_LIST_INVALID   = 'INGEST_DOI_LIST_INVALID',
  INGEST_DOI_RESOLUTION_FAILED = 'INGEST_DOI_RESOLUTION_FAILED',
  INGEST_DOI_INCOMPLETE_METADATA = 'INGEST_DOI_INCOMPLETE_METADATA',

  // ---------------------------------------------------------------------------
  // Phase 2: Splitting
  // ---------------------------------------------------------------------------
  SPLIT_NO_BLOCKS_FOUND     = 'SPLIT_NO_BLOCKS_FOUND',
  SPLIT_COUNT_MISMATCH      = 'SPLIT_COUNT_MISMATCH', // droppedCount > 0 — hard invariant violation
  SPLIT_COUNT_AUDIT_DRIFT   = 'SPLIT_COUNT_AUDIT_DRIFT',
  SPLIT_ML_UNAVAILABLE      = 'SPLIT_ML_UNAVAILABLE',
  SPLIT_ML_CLASSIFIER_FAILED = 'SPLIT_ML_CLASSIFIER_FAILED',
  SPLIT_BLOCK_TOO_SHORT     = 'SPLIT_BLOCK_TOO_SHORT',
  SPLIT_BLOCK_TOO_LONG      = 'SPLIT_BLOCK_TOO_LONG',
  SPLIT_UNCERTAIN_BLOCK     = 'SPLIT_UNCERTAIN_BLOCK', // becomes needs_action, NOT dropped
  SPLIT_UNCERTAIN_BOUNDARY  = 'SPLIT_UNCERTAIN_BOUNDARY',

  // ---------------------------------------------------------------------------
  // Phase 3: Style Detection
  // ---------------------------------------------------------------------------
  STYLE_ML_UNAVAILABLE      = 'STYLE_ML_UNAVAILABLE',
  STYLE_LOW_CONFIDENCE      = 'STYLE_LOW_CONFIDENCE',
  STYLE_UNKNOWN             = 'STYLE_UNKNOWN',

  // ---------------------------------------------------------------------------
  // Phase 4: Field Extraction
  // ---------------------------------------------------------------------------
  EXTRACT_ML_UNAVAILABLE    = 'EXTRACT_ML_UNAVAILABLE',
  EXTRACT_TIMEOUT           = 'EXTRACT_TIMEOUT',
  EXTRACT_MANDATORY_MISSING = 'EXTRACT_MANDATORY_MISSING',
  EXTRACT_LOW_CONFIDENCE    = 'EXTRACT_LOW_CONFIDENCE',
  EXTRACT_PARSE_FAILED      = 'EXTRACT_PARSE_FAILED',

  // ---------------------------------------------------------------------------
  // Phase 5: Author Disambiguation
  // ---------------------------------------------------------------------------
  AUTHOR_ML_UNAVAILABLE     = 'AUTHOR_ML_UNAVAILABLE',
  AUTHOR_PARSE_FAILED       = 'AUTHOR_PARSE_FAILED',
  AUTHOR_AMBIGUOUS          = 'AUTHOR_AMBIGUOUS',

  // ---------------------------------------------------------------------------
  // Phase 6: Type Classification
  // ---------------------------------------------------------------------------
  TYPE_ML_UNAVAILABLE       = 'TYPE_ML_UNAVAILABLE',
  TYPE_LOW_CONFIDENCE       = 'TYPE_LOW_CONFIDENCE',
  TYPE_UNKNOWN              = 'TYPE_UNKNOWN',

  // ---------------------------------------------------------------------------
  // Phase 6.5: LLM Fallback
  // ---------------------------------------------------------------------------
  LLM_API_ERROR             = 'LLM_API_ERROR',
  LLM_TIMEOUT               = 'LLM_TIMEOUT',
  LLM_QUOTA_EXCEEDED        = 'LLM_QUOTA_EXCEEDED',
  LLM_PARSE_FAILED          = 'LLM_PARSE_FAILED',
  LLM_LOW_CONFIDENCE        = 'LLM_LOW_CONFIDENCE',

  // ---------------------------------------------------------------------------
  // Phase 7: Normalization
  // ---------------------------------------------------------------------------
  NORM_DOI_INVALID          = 'NORM_DOI_INVALID',
  NORM_YEAR_OUT_OF_RANGE    = 'NORM_YEAR_OUT_OF_RANGE',
  NORM_PAGES_INVALID        = 'NORM_PAGES_INVALID',
  NORM_URL_INVALID          = 'NORM_URL_INVALID',

  // ---------------------------------------------------------------------------
  // Phase 8: Enrichment
  // ---------------------------------------------------------------------------
  ENRICH_CROSSREF_ERROR     = 'ENRICH_CROSSREF_ERROR',
  ENRICH_CROSSREF_TIMEOUT   = 'ENRICH_CROSSREF_TIMEOUT',
  ENRICH_OPENALEX_ERROR     = 'ENRICH_OPENALEX_ERROR',
  ENRICH_OPENALEX_TIMEOUT   = 'ENRICH_OPENALEX_TIMEOUT',
  ENRICH_NO_DOI             = 'ENRICH_NO_DOI',
  ENRICH_OVERWRITE_BLOCKED  = 'ENRICH_OVERWRITE_BLOCKED', // provider tried to overwrite admin_confirmed

  // ---------------------------------------------------------------------------
  // Phase 9: Deduplication
  // ---------------------------------------------------------------------------
  DEDUP_MINHASH_FAILED      = 'DEDUP_MINHASH_FAILED',
  DEDUP_LSH_FAILED          = 'DEDUP_LSH_FAILED',

  // ---------------------------------------------------------------------------
  // Phase 10: Quality Scoring
  // ---------------------------------------------------------------------------
  SCORE_ML_UNAVAILABLE      = 'SCORE_ML_UNAVAILABLE',
  SCORE_HEURISTIC_USED      = 'SCORE_HEURISTIC_USED', // warning: ML down, heuristics used

  // ---------------------------------------------------------------------------
  // Phase 11: Authority Validation
  // ---------------------------------------------------------------------------
  AUTHORITY_RETRACTION_WATCH_ERROR   = 'AUTHORITY_RETRACTION_WATCH_ERROR',
  AUTHORITY_RETRACTION_WATCH_TIMEOUT = 'AUTHORITY_RETRACTION_WATCH_TIMEOUT',
  AUTHORITY_SEMANTIC_SCHOLAR_ERROR   = 'AUTHORITY_SEMANTIC_SCHOLAR_ERROR',
  AUTHORITY_RETRACTED                = 'AUTHORITY_RETRACTED',
  AUTHORITY_EXPRESSION_OF_CONCERN    = 'AUTHORITY_EXPRESSION_OF_CONCERN',

  // ---------------------------------------------------------------------------
  // Phase 12: Rendering
  // ---------------------------------------------------------------------------
  RENDER_CITEPROC_ERROR     = 'RENDER_CITEPROC_ERROR',
  RENDER_CSL_MAPPING_FAILED = 'RENDER_CSL_MAPPING_FAILED',
  RENDER_STYLE_UNSUPPORTED  = 'RENDER_STYLE_UNSUPPORTED',
  RENDER_EXPORT_FAILED      = 'RENDER_EXPORT_FAILED',

  // ---------------------------------------------------------------------------
  // Phase 13: Feedback / Corrections
  // ---------------------------------------------------------------------------
  CORRECTION_OVERWRITE_BLOCKED   = 'CORRECTION_OVERWRITE_BLOCKED', // user tried to overwrite admin_confirmed
  CORRECTION_ALREADY_RESOLVED    = 'CORRECTION_ALREADY_RESOLVED',
  REPORT_DUPLICATE               = 'REPORT_DUPLICATE',
  REPORT_INVALID_CATEGORY        = 'REPORT_INVALID_CATEGORY',
  LEARNING_QUEUE_FULL            = 'LEARNING_QUEUE_FULL',

  // ---------------------------------------------------------------------------
  // DOI fast-path
  // ---------------------------------------------------------------------------
  DOI_RESOLVE_FAILED        = 'DOI_RESOLVE_FAILED',
  DOI_INCOMPLETE_METADATA   = 'DOI_INCOMPLETE_METADATA',
  DOI_CONFLICT_FLAGGED      = 'DOI_CONFLICT_FLAGGED', // provider vs model mismatch

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  EXPORT_NOT_FOUND          = 'EXPORT_NOT_FOUND',
  EXPORT_FORMAT_UNSUPPORTED = 'EXPORT_FORMAT_UNSUPPORTED',
  EXPORT_GENERATION_FAILED  = 'EXPORT_GENERATION_FAILED',
  EXPORT_EXPIRED            = 'EXPORT_EXPIRED',

  // ---------------------------------------------------------------------------
  // ML service circuit breaker
  // ---------------------------------------------------------------------------
  ML_CIRCUIT_OPEN           = 'ML_CIRCUIT_OPEN',
  ML_SERVICE_UNAVAILABLE    = 'ML_SERVICE_UNAVAILABLE',
  ML_RESPONSE_INVALID       = 'ML_RESPONSE_INVALID',
}
