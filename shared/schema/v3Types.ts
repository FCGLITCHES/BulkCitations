/**
 * shared/schema/v3Types.ts
 *
 * V3 engine contracts, field provenance, lock semantics,
 * score auditing, and response envelopes.
 */

import type {
  CanonicalCitation,
  CitationReviewBucket,
  InputProfile,
  StageDiagnostic,
  V2ConversionResponse,
  V2StageTiming,
} from './v2Types';
import type { V2ConversionRequest } from './validation';

export type V3StageId =
  | 'ingest'
  | 'split'
  | 'detect_style'
  | 'extract_fields'
  | 'parse_authors'
  | 'classify_type'
  | 'normalize'
  | 'enrich'
  | 'llm_repair'
  | 'dedup'
  | 'base_score'
  | 'authority_validate_and_adjust'
  | 'render';

export type V3LockClass = 'verified' | 'review_hold' | 'unlocked';

export type V3FieldProvenance =
  | 'model'
  | 'llm_fallback'
  | 'crossref'
  | 'openalex'
  | 'user_correction'
  | 'legacy_import'
  | 'legacy_import_unverified';

export interface V3StageContract {
  stageId: V3StageId;
  contractVersion: number;
}

export interface V3FieldLock {
  field: string;
  class: V3LockClass;
  source: V3FieldProvenance;
  locked: boolean;
  reason?: string;
}

export interface V3FieldProvenanceEntry {
  field: string;
  source: V3FieldProvenance;
  confidence: number;
  lockClass: V3LockClass;
  locked: boolean;
}

export interface V3MergeTraceEntry {
  field: string;
  winningCitationId: string;
  winningProvenance: V3FieldProvenance;
  losingCitationIds: string[];
  losingProvenances: V3FieldProvenance[];
  origin: 'direct' | 'dedup_merge';
  improvedByMerge: boolean;
}

export interface V3ScoreContribution {
  citationId: string;
  provenance: V3FieldProvenance;
  confidence: number;
  origin: 'direct' | 'dedup_merge';
}

export interface V3ScoreFieldOrigin {
  field: string;
  winningCitationId: string;
  winningProvenance: V3FieldProvenance;
  contributions: V3ScoreContribution[];
}

export interface V3AuthorityAdjustment {
  rawScore: number;
  rawGrade: 'A' | 'B' | 'C' | 'F';
  rawBucket: CitationReviewBucket;
  displayScore: number;
  displayGrade: 'A' | 'B' | 'C' | 'F';
  displayBucket: CitationReviewBucket;
  authorityFlags: string[];
  authorityCheckedAt?: string;
  authorityAdjusted: boolean;
  authorityAdjustmentReasons: string[];
}

export interface V3RenderMetadata {
  contractVersion: number;
  renderSource: 'truth' | 'csl' | 'fallback';
  sanitized: boolean;
  warnings: string[];
}

export interface V3Citation extends CanonicalCitation {
  contractVersion: number;
  stageContracts: V3StageContract[];
  fieldLocks: Record<string, V3FieldLock>;
  fieldProvenance: Record<string, V3FieldProvenanceEntry>;
  mergeTrace: Record<string, V3MergeTraceEntry>;
  rawScore: number;
  rawGrade: 'A' | 'B' | 'C' | 'F';
  rawBucket: CitationReviewBucket;
  displayScore: number;
  displayGrade: 'A' | 'B' | 'C' | 'F';
  displayBucket: CitationReviewBucket;
  scoreFieldOrigins: Record<string, V3ScoreFieldOrigin>;
  authorityFlags: string[];
  authorityCheckedAt?: string;
  authorityAdjusted: boolean;
  authorityAdjustmentReasons: string[];
  renderMetadata: V3RenderMetadata;
}

export interface V3ProcessingPath {
  stagesRun: V3StageId[];
  contractVersions: Record<V3StageId, number>;
  fallbacksUsed: string[];
  durationMs: number;
  partialResult: boolean;
  executionMode?: 'sync' | 'async';
  partialReasons?: string[];
  stageTimings?: V2StageTiming[];
  slowestStages?: V2StageTiming[];
}

export interface V3ConversionResponse extends Omit<V2ConversionResponse, 'citations' | 'processingPath'> {
  engineVersion: 'v3';
  request: V2ConversionRequest;
  citations: V3Citation[];
  inputProfile?: InputProfile;
  processingPath: V3ProcessingPath;
  pipeline_log: StageDiagnostic[];
}
