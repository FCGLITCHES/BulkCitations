import type { FieldValue } from './field.js';
import type { InputCleanupInfo } from './ingestion.js';
import type { StageRunRecord } from './pipeline.js';
import type { ExtractionMeta } from './extractionMeta.js';

export type ReferenceType =
  | 'article-journal'
  | 'book'
  | 'book-chapter'
  | 'thesis'
  | 'conference-paper'
  | 'webpage'
  | 'report'
  | 'patent'
  | 'dataset'
  | 'preprint'
  | 'unknown';

export type CitationStyle =
  | 'apa7'
  | 'mla9'
  | 'chicago-author-date'
  | 'chicago-notes-bib'
  | 'vancouver'
  | 'ieee'
  | 'harvard-ctr'
  | 'ama'
  | 'acs'
  | 'unknown'
  | 'auto';

export type StyleFamily =
  | 'author_date'
  | 'numeric'
  | 'notes_bibliography'
  | 'web_accessed'
  | 'unknown';

export type StyleCertaintyTier = 'high' | 'medium' | 'low';

export const STYLE_SIGNAL_CODES = [
  'bracketed_enumerator',
  'numeric_dot_enumerator',
  'numeric_paren_enumerator',
  'parenthesized_enumerator',
  'author_surname_initials',
  'author_initials_surname',
  'author_lead_ambiguous',
  'quoted_title_lead',
  'author_year_lead',
  'has_et_al',
  'author_bucket_single',
  'author_bucket_few',
  'author_bucket_many',
  'author_separator_comma',
  'author_separator_semicolon',
  'author_separator_and',
  'author_separator_ampersand',
  'year_parenthesized_after_authors',
  'year_bare_after_authors',
  'year_repeated_conference',
  'year_end_position',
  'year_early_position',
  'year_late_position',
  // Author-date year placement without IEEE terminal year (disambiguates from IEEE)
  'ieee_incompatible_author_date_year_placement',
  'quoted_title',
  'title_followed_by_period',
  'title_followed_by_comma',
  'title_sentence_case',
  'title_title_case',
  'cue_in_container',
  'cue_conference',
  'cue_journal',
  'cue_book_publisher',
  'cue_web_access',
  'marker_editor',
  'marker_translator',
  'marker_edition',
  'locator_vol',
  'locator_no',
  'locator_pp',
  'locator_ieee_signature',
  'locator_semicolon_volume_issue_pages',
  'locator_volume_issue_pages',
  'locator_year_comma_volume_colon_pages',
  'locator_year_comma_volume_colon_identifier',
  'locator_page_range_only',
  'identifier_doi',
  'identifier_url',
  'identifier_at_end',
  'identifier_accessed_retrieved',
  'identifier_doi_tail_numeric',
  'cue_journal_abbrev',
  'capitalization_quoted_title_profile',
  'capitalization_heavy_titlecase',
  'capitalization_numeric_minimal',
  'punctuation_period_dense',
  'punctuation_comma_dense',
  'punctuation_mixed_cadence',
  'web_url_without_scholarly_locators',
  'web_host_like_container',
] as const;

export type StyleSignalCode = (typeof STYLE_SIGNAL_CODES)[number];

export interface StyleCandidateScore {
  style: CitationStyle;
  score: number;
}

export interface StyleFamilyCandidateScore {
  family: StyleFamily;
  score: number;
}

/** Styles with full acceptance testing and rendering guarantees */
export type GuaranteedStyle =
  | 'apa7'
  | 'mla9'
  | 'chicago-author-date'
  | 'vancouver'
  | 'ieee'
  | 'harvard-ctr';

export type EffectiveStyleSource = 'requested' | 'detected' | 'doi_fast_path' | 'default';

export interface CitationStyleResolution {
  requestedStyle: CitationStyle;
  detectedStyle: CitationStyle;
  effectiveStyle: CitationStyle;
  effectiveStyleSource: EffectiveStyleSource;
  rawDetectionConfidence: number;
  effectiveDetectionConfidence: number;
  inputStyleUncertain: boolean;
  effectiveStyleKnown: boolean;
}

export type DoiVerificationStatus = 'absent' | 'verified' | 'conflicted' | 'unverified';

export interface DoiVerificationResult {
  status: DoiVerificationStatus;
  reasons: string[];
}

export interface CanonicalAuthor {
  family: string;
  given: string | null;
  initials: string | null;
  literal?: string;       // for corporate/institutional authors
  orcid?: string;
  isCorporate: boolean;
}

export interface ExtractedFields {
  authors:            FieldValue<CanonicalAuthor[]>;
  title:              FieldValue<string | null>;
  year:               FieldValue<number | null>;
  journal:            FieldValue<string | null>;
  volume:             FieldValue<string | null>;
  issue:              FieldValue<string | null>;
  pages:              FieldValue<string | null>;
  doi:                FieldValue<string | null>;
  pmid:               FieldValue<string | null>;
  pmcid:              FieldValue<string | null>;
  arxiv:              FieldValue<string | null>;
  isbn:               FieldValue<string | null>;
  issn:               FieldValue<string | null>;
  handle:             FieldValue<string | null>;
  patent:             FieldValue<string | null>;
  publisher:          FieldValue<string | null>;
  placeOfPublication: FieldValue<string | null>;
  url:                FieldValue<string | null>;
  conferenceTitle:    FieldValue<string | null>;
  bookTitle:          FieldValue<string | null>;
  institution:        FieldValue<string | null>;
  edition:            FieldValue<string | null>;
  editors:            FieldValue<CanonicalAuthor[]>;
  thesisType:         FieldValue<string | null>;
  repository:         FieldValue<string | null>;
  articleNumber:      FieldValue<string | null>;
  accessedDate:       FieldValue<string | null>;
  siteName:           FieldValue<string | null>;
  database:           FieldValue<string | null>;
  reportNumber:       FieldValue<string | null>;
}

/** Public-facing status (what the user sees in the UI) */
export type PublicStatus = 'ready' | 'needs_review' | 'needs_action';

export type WarningSeverity = 'info' | 'review' | 'action';

export interface HealthWarning {
  code: string;
  severity: WarningSeverity;
  message?: string;
}

export interface HealthBreakdown {
  missingMandatory: string[];
  invalidMandatory: string[];
  lowConfidenceMandatory: string[];
  presentMandatory: string[];
}

export interface CitationHealth {
  publicStatus: PublicStatus;
  baseStatus: PublicStatus;
  reasons: string[];
  breakdown: HealthBreakdown;
  warnings: HealthWarning[];
  demotedBy: 'none' | 'authority' | 'render';
}

export type ParseOutcome =
  | 'high_confidence_parse'
  | 'partial_parse_with_abstentions'
  | 'needs_action';

export type FieldMoveAction = 'set' | 'clear' | 'mutate' | 'restore';

export interface FieldMoveLedgerEntry {
  phaseId: string;
  reasonCode: string;
  sourceField: keyof ExtractedFields | 'titleTail' | 'unknown';
  destinationField: keyof ExtractedFields | 'titleTail' | 'unknown';
  action: FieldMoveAction;
  previousValue: unknown;
  nextValue: unknown;
  beforeConfidence: number | null;
  afterConfidence: number | null;
}

export interface AuthorityFlag {
  type: 'retracted' | 'expression_of_concern' | 'author_conflict' | 'metadata_mismatch';
  source: string;
  date?: string;
  details?: string;
}

export interface ScorePenalty {
  code: string;
  points: number;
}

export interface ScoreBreakdown {
  fieldEvidenceScore: number;
  contentCorrectnessScore: number;
  cosmeticFormatScore: number;
  formatCorrectnessScore: number;
  structuralIntegrityScore: number;
  fieldEvidence: {
    completeness: number;
    avgMandatoryConfidence: number;
  };
  formatScoringPath: 'guaranteed' | 'fallback';
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
    volumeScore: number;
    issueScore: number;
    locatorScore: number;
    identifierScore: number;
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
  penalties: ScorePenalty[];
  authorityAdjustment: number;
  diagnostics: {
    splitQualityFlag: 'ok' | 'low' | 'sampled';
    detectionConfidence: number;
    rawDetectionConfidence: number;
    effectiveDetectionConfidence: number;
    formatScoringPathReason:
      | 'style_guaranteed'
      | 'style_fallback'
      | 'low_detection_confidence';
    rescoredAfterCorrection: boolean;
    scoreVersion: string;
  };
  rawScore: number;
  displayScore: number;
}

export interface ProcessedCitation {
  id: string;
  index: number;                         // original input position (preserved)
  raw: string;
  createdAt?: string;
  updatedAt?: string;
  outputLatencyMs: number;
  inputCleanup?: InputCleanupInfo;
  publicStatus: PublicStatus;
  parseOutcome: ParseOutcome;
  status: 'ok' | 'error';
  error?: {
    phase: string;
    code: string;
    message: string;
    recoverable: boolean;
  };
  partialData?: Partial<ExtractedFields>; // fields extracted before failure
  referenceType: ReferenceType;
  detectedStyleFamily: StyleFamily;
  detectedStyle: CitationStyle;
  familyConfidence: number;
  styleConfidence: number;
  familyMarginToRunnerUp: number;
  styleMarginToRunnerUp: number;
  certaintyTier: StyleCertaintyTier;
  familyCandidates: StyleFamilyCandidateScore[];
  styleCandidates: StyleCandidateScore[];
  styleSignals: StyleSignalCode[];
  conflictDampened: boolean;
  effectiveStyle: CitationStyle;
  effectiveStyleSource: EffectiveStyleSource;
  inputStyleUncertain: boolean;
  rawDetectionConfidence: number;
  effectiveDetectionConfidence: number;
  outputStyle: CitationStyle;
  styleResolution: CitationStyleResolution;
  doiVerification: DoiVerificationResult;
  fields: ExtractedFields;
  rawScore: number;                       // 0-100, before authority adjustments
  displayScore: number;                   // 0-100, after authority adjustments
  scoreBreakdown: ScoreBreakdown;
  healthReasons: string[];
  healthBreakdown: HealthBreakdown;
  healthWarnings: HealthWarning[];
  authorityFlags: AuthorityFlag[];
  renderedText: string;
  renderedWarnings: string[];
  extractionMeta?: ExtractionMeta;
  fieldMoveLedger: FieldMoveLedgerEntry[];
  /** True when this citation skipped Phases 2–8 core extraction via DOI resolution */
  doiFastPath?: boolean;
  duplicateOf?: string;                   // citation ID of the primary in its group
  isDuplicateCandidate?: boolean;
  normalizedHash?: string;
  canonicalWorkKey?: string | null;
  nearDupClusterId?: string;
  pipelineMajor: 3;
  stageLog: StageRunRecord[];
}
