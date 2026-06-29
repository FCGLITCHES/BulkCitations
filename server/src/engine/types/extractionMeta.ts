import type { ExtractedFieldKey } from '../utils/fields.js';
import type { MLErrorCode } from '../../ml/errors.js';
import type { CitationFeatureRecallShadow } from './extractionFeatures.js';

export type ExtractionRunMode = 'heuristic' | 'shadow' | 'ml';

export interface ExtractionEntityDebug {
  field: ExtractedFieldKey;
  tokenStart: number;
  tokenEnd: number;
  text: string;
  confidence: number;
  valid: boolean;
}

export interface ExtractionBioEntityDebug extends ExtractionEntityDebug {
  label: string;
  charStart: number;
  charEnd: number;
  diagnostics?: string[];
}

export interface ExtractionBioDiagnostic {
  code: string;
  severity?: 'info' | 'review' | 'action';
  label?: string | null;
  field?: ExtractedFieldKey | string | null;
  tokenIndex?: number | null;
  message?: string | null;
}

export interface ExtractionBioDebug {
  tokens: string[];
  labels: string[];
  offsets: Array<[number, number]>;
  labelConfidences: number[];
  entities: ExtractionBioEntityDebug[];
  diagnostics: ExtractionBioDiagnostic[];
  labelSchemaVersion: string;
  featureVersion: string | null;
  modelVersion: string | null;
}

export type ShadowDiffStatus = 'same' | 'added' | 'removed' | 'changed';

export interface ShadowDiff {
  baselineFields: Record<string, unknown>;
  mlFields: Record<string, unknown>;
  perFieldDiff: Partial<Record<ExtractedFieldKey, ShadowDiffStatus>>;
  severityScore: number;
}

export interface ExtractionMetaError {
  code: MLErrorCode;
  message: string;
}

export interface ExtractionMeta {
  modelVersion: string | null;
  featureVersion: string | null;
  styleUsed: string;
  overallConfidence: number | null;
  fieldConfidences: Record<string, number>;
  uncertainFields: ExtractedFieldKey[];
  runMode: ExtractionRunMode;
  timestamp: string;
  entities?: ExtractionEntityDebug[];
  bio?: ExtractionBioDebug;
  shadowDiff?: ShadowDiff;
  candidateRecallShadow?: CitationFeatureRecallShadow;
  mlError?: ExtractionMetaError | null;
}

export interface CitationExtractionHistoryRow extends ExtractionMeta {
  id: string;
  citationId: string;
  jobId?: string;
}
