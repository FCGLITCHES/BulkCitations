import type { ExtractedFields } from './citation.js';

export type IngestionStructure = 'structured' | 'semi_structured' | 'unstructured' | 'unknown';

export type DetectedFormat =
  | 'doi_list'
  | 'bibtex'
  | 'ris'
  | 'numbered_list'
  | 'blank_line'
  | 'hanging_indent'
  | 'plain_text'
  | 'unknown';

export type RawBlockFlag = 'too_short' | 'too_long' | 'uncertain' | 'metadata_mismatch';

export type SplitQualityFlag = 'ok' | 'low' | 'sampled';

export type IngestCleanupHint =
  | 'fixed_eol_hyphens'
  | 'merged_soft_breaks'
  | 'stripped_pdf_artifacts'
  | 'repaired_ocr_artifacts'
  | 'cleanup_candidate_generated'
  | 'cleanup_selected'
  | 'cleanup_rejected';

export type InputCleanupDecisionReason =
  | 'quality_improved'
  | 'equal_or_noise'
  | 'format_change_without_quality_gain'
  | 'block_count_divergence'
  | 'not_pdf_like'
  | 'cleanup_error';

export interface IngestCleanupMeta {
  lookedLikePdfCopy: boolean;
  hints: IngestCleanupHint[];
  candidateText?: string;
}

export interface InputCleanupInfo {
  lookedLikePdfCopy: boolean;
  cleanupApplied: boolean;
  finalUsed: 'baseline' | 'cleaned';
  hints: IngestCleanupHint[];
  qualityDelta?: number;
  decisionReason?: InputCleanupDecisionReason;
}

export type DetectionProfile =
  | 'CLEAN_STRUCTURED'
  | 'OCR_HEAVY'
  | 'AMBIGUOUS_MIXED'
  | 'BIBLIOGRAPHIC_PLAIN'
  | 'WEAK_NON_BIBLIOGRAPHIC';

export interface NormalizationMeta {
  hadBom?: boolean;
  hadLineEndingNormalization?: boolean;
  hadTabs?: boolean;
  hadNbsp?: boolean;
  hadZeroWidth?: boolean;
  hadUnicodeNormalizationChange?: boolean;
  hadCompatibilityNormalization?: boolean;
  hadControlChars?: boolean;
  hadReplacementChars?: boolean;
}

export interface IngestionSignals {
  isPdfExtracted: boolean;
  isDocxExtracted: boolean;
  hasLineNumbers: boolean;
  hasHangingIndents: boolean;
  hasBibTexEntries: boolean;
  hasRisEntries: boolean;
  nonEmptyLineCount?: number;
  numberedLineCount?: number;
  numberedLineRatio?: number;
  blankBlockCount?: number;
  blankBlockRatio?: number;
  authorStartCount?: number;
  authorStartRatio?: number;
  footnoteMarkerCount?: number;
  footnoteMarkerRatio?: number;
  doiCount?: number;
  doiDensity?: number;
  bookTailCount?: number;
  bookTailRatio?: number;
  conferenceTailCount?: number;
  conferenceTailRatio?: number;
  ocrNoiseCount?: number;
  ocrNoiseRatio?: number;
  hangingIndentCount?: number;
  hangingIndentRatio?: number;
  averageIndentDelta?: number;
  averageIndentDeltaNorm?: number;
  mixedStyleMarkers?: boolean;
  doiLineCoverage?: number;
  bibtexSchemaCoverage?: number;
  risSchemaCoverage?: number;
  schemaCandidate?: 'doi_list' | 'bibtex' | 'ris' | null;
  profile?: DetectionProfile;
}

export interface DetectorResult {
  format: DetectedFormat;
  score: number;
  evidence: string[];
  blockCoverage: number;
}

export interface DetectionOutcome {
  chosen: DetectorResult;
  secondBest: DetectorResult | null;
  confidence: number;
  effectiveConfidence: number;
  method: 'scored' | 'forced';
  perBlockUsed: boolean;
  sampled: boolean;
}

export interface BatchEnvelope {
  pipelineMajor: 3;
  sourceType: string;
  provenanceKey?: string;
  structure: IngestionStructure;
  detectedFormat: DetectedFormat;
  formatConfidence: number;
  estimatedCount: number;
  hasDois: boolean;
  styleHints: string[];
  normalizedHash?: string;
  rawTextOriginal?: string;
  rawText: string;
  detectedDois: string[];
  ingestionSignals: IngestionSignals;
  normalizationMeta?: NormalizationMeta;
  detection?: DetectionOutcome;
  cleanupMeta?: IngestCleanupMeta;
}

export interface RawBlock {
  index: number;
  text: string;
  semanticGroupKey?: string;
  formatMeta?: {
    sourceType: string;
    structure: IngestionStructure;
    detectedFormat: DetectedFormat;
    formatConfidence: number;
  };
  splitMethod:
    | 'numbered'
    | 'hanging_indent'
    | 'blank_line'
    | 'ml_classifier'
    | 'bibtex_entry'
    | 'ris_entry'
    | 'doi_list'
    | 'doi_resolved'
    | 'uncertain';
  splitConfidence: number;
  isDoiResolved: boolean;
  resolvedFields?: ExtractedFields;
  flags: RawBlockFlag[];
  splitReason?: string;
  blockFormat?: DetectedFormat;
  boundarySignals?: string[];
  inputCleanup?: InputCleanupInfo;
}

export interface SplitMeta {
  method: string;
  confidence: number;
  blockLength: number;
  flags: RawBlockFlag[];
}
