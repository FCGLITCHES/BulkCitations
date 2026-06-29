import type {
  ExtractedFields,
  PublicStatus,
  AuthorityFlag,
  CitationHealth,
  HealthWarning,
  FieldMoveLedgerEntry,
  ParseOutcome,
  ScoreBreakdown,
  CitationStyleResolution,
  DoiVerificationResult,
  StyleFamilyCandidateScore,
  StyleCandidateScore,
  StyleCertaintyTier,
  StyleFamily,
  StyleSignalCode,
} from './citation.js';
import type { MandatoryFieldAudit } from '../mandatory-fields.js';
import type { PhaseId, StageRunRecord } from './pipeline.js';
import type { InputCleanupInfo, SplitMeta, SplitQualityFlag } from './ingestion.js';
import type { ExtractionMeta } from './extractionMeta.js';

export interface CarrierDetection {
  confidence: number;
  splitQualityFlag: SplitQualityFlag;
  sampled: boolean;
}

export interface StyleDetectionResult {
  primary: { style: import('./citation.js').CitationStyle; confidence: number };
  secondary: { style: import('./citation.js').CitationStyle; confidence: number } | null;
  family: StyleFamily;
  familyConfidence: number;
  styleConfidence: number;
  familyMarginToRunnerUp: number;
  styleMarginToRunnerUp: number;
  certaintyTier: StyleCertaintyTier;
  familyCandidates: StyleFamilyCandidateScore[];
  styleCandidates: StyleCandidateScore[];
  signals: StyleSignalCode[];
  conflictDampened: boolean;
  isUnknown: boolean;    // true only when family is unknown
  isMultiStyle: boolean; // batch contains mixed styles
}

export interface TypeClassificationResult {
  type: import('./citation.js').ReferenceType;
  confidence: number;
  isUnknown: boolean; // confidence < 0.6
}

export interface EnrichmentResult {
  status: 'enriched' | 'partial' | 'skipped' | 'error';
  crossrefHit: boolean;
  openalexHit: boolean;
  semanticScholarHit: boolean;
  fieldsEnriched: string[];
  fieldsOverwritten: string[];
  cacheHits: number;
  /**
   * Set when a provider record was WITHHELD because it conflicted with the extracted
   * citation on a reference without an anchoring DOI (the no-fabrication guard). The
   * fields were not applied; Phase 10 surfaces this as a `review` warning.
   */
  mismatch?: {
    provider: 'crossref' | 'openalex' | 'semantic_scholar';
    reasons: string[];
  };
}

export interface ScoringResult {
  rawScore: number;                            // 0-100
  displayScore: number;                        // 0-100
  publicStatus: PublicStatus;
  breakdown: ScoreBreakdown;
}

export interface HealthEvidence {
  spans: Array<{
    field: keyof ExtractedFields;
    tokenStart: number;
    tokenEnd: number;
    text: string;
    confidence: number;
    valid: boolean;
  }>;
  validSpanFields: Array<keyof ExtractedFields>;
  invalidSpanFields: Array<keyof ExtractedFields>;
  parserWarnings: string[];
  warnings: HealthWarning[];
}

export interface AuthorityResult {
  checked: boolean;
  flags: AuthorityFlag[];
  scoreAdjustment: number;
  nextRecheckAt: Date;
}

export interface RenderFieldSuppression {
  key: keyof ExtractedFields;
  reason: string;
}

export interface RenderAudit {
  available: Array<keyof ExtractedFields>;
  rendered: Array<keyof ExtractedFields>;
  lost: Array<keyof ExtractedFields>;
  suppressed: RenderFieldSuppression[];
}

export interface RenderedResult {
  text: string;
  warnings: string[];
  assertionSummary?: {
    total: number;
    passed: number;
    failed: number;
  };
  audit?: RenderAudit;
}

export interface NormalizationRuleApplication {
  field: keyof ExtractedFields;
  before: unknown;
  after: unknown;
  rule: string;
}

export interface CandidateEnvelopeEntry {
  field: keyof ExtractedFields | 'titleTail';
  text: string;
  score: number;
  provenance: string;
  conflictFlags: string[];
}

export interface CandidateEnvelope {
  titleCoreCandidates: CandidateEnvelopeEntry[];
  titleTailCandidates: CandidateEnvelopeEntry[];
  journalCandidates: CandidateEnvelopeEntry[];
  conferenceCandidates: CandidateEnvelopeEntry[];
  bookTitleCandidates: CandidateEnvelopeEntry[];
  publisherCandidates: CandidateEnvelopeEntry[];
  institutionCandidates: CandidateEnvelopeEntry[];
  authorBlockCandidates: CandidateEnvelopeEntry[];
  editorCandidates: CandidateEnvelopeEntry[];
  identifierCandidates: CandidateEnvelopeEntry[];
}

export interface StickyInvariantSnapshot {
  lockedFields: Array<keyof ExtractedFields>;
  articleLocatorFields: Array<keyof ExtractedFields>;
  establishedArticleProfile: boolean;
}

export interface StructuralFamilyRoutingResult {
  type: import('./citation.js').ReferenceType;
  confidence: number;
  source: 'heuristic' | 'approved_truth' | 'authority_pack';
  reasonCodes: string[];
}

export interface SharedRepairShadowResult {
  proposedMoves: FieldMoveLedgerEntry[];
  proposedSuppressions: string[];
}

/**
 * Each reference flows through all phases as a ReferenceCarrier.
 * Failed references carry error metadata but are never dropped.
 * This is the "pipeline drain" pattern — droppedCount MUST always be 0.
 */
export interface ReferenceCarrier {
  id: string;
  index: number;              // original input position
  raw: string;
  semanticGroupKey?: string;
  outputLatencyMs: number;
  inputCleanup?: InputCleanupInfo;
  ingestionMeta?: {
    sourceType: string;
    structure: import('./ingestion.js').IngestionStructure;
    detectedFormat: import('./ingestion.js').DetectedFormat;
    formatConfidence: number;
  };
  publicStatus: PublicStatus;
  parseOutcome: ParseOutcome;
  status: 'ok' | 'error';
  error?: {
    phase: PhaseId;
    code: string;
    message: string;
    recoverable: boolean;
  };
  partialData?: Partial<ExtractedFields>;
  fields: ExtractedFields;
  // True when the source author span carried an "et al." truncation that was
  // stripped during parsing, so the stored author list is known-incomplete.
  // Downstream health surfaces this without lowering confidence to hide it.
  authorListIncomplete?: boolean;
  style: StyleDetectionResult;
  styleResolution: CitationStyleResolution;
  detection: CarrierDetection;
  doiVerification: DoiVerificationResult;
  type: TypeClassificationResult;
  enrichment: EnrichmentResult;
  scoring: ScoringResult;
  health: CitationHealth;
  healthEvidence: HealthEvidence;
  authority: AuthorityResult;
  rendered: RenderedResult;
  splitMeta: SplitMeta;
  stageLog: StageRunRecord[];
  fieldMoveLedger: FieldMoveLedgerEntry[];
  candidateEnvelope?: CandidateEnvelope;
  stickyInvariantSnapshot?: StickyInvariantSnapshot;
  structuralRouting?: StructuralFamilyRoutingResult;
  sharedRepairShadow?: SharedRepairShadowResult;
  doiFastPath: boolean;
  duplicateOf?: string;
  duplicateGroupId?: string;
  duplicateReason?: 'doi_exact' | 'normalized_hash' | 'canonical_work_key' | 'minhash_lsh';
  isDuplicateCandidate?: boolean;
  normalizedHash?: string;
  canonicalWorkKey?: string | null;
  nearDupClusterId?: string;
  extractionMeta?: ExtractionMeta;
  normalizationMeta?: {
    appliedRules: NormalizationRuleApplication[];
    mandatoryFieldCheck?: MandatoryFieldAudit;
  };
}
