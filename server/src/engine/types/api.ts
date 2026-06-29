import type { CitationStyle, ProcessedCitation } from './citation.js';
import type { PipelineStatus, CountAudit, ProcessingPath, StageRunRecord } from './pipeline.js';
import type { ParseProfile } from './parseProfile.js';
import type {
  DetectedFormat,
  IngestionSignals,
  IngestionStructure,
  InputCleanupDecisionReason,
} from './ingestion.js';

export interface ConvertRequest {
  sourceType: 'text' | 'doi_list';
  content: string;
  outputStyle?: CitationStyle;
  options?: {
    parseProfile?: ParseProfile;
    enrich?: boolean;
    dedup?: boolean;
    groupDuplicates?: boolean;
    debug?: boolean;
    /** Server-set (pro/b2b): carry enrichment recovery into queued/async jobs. Not user-supplied. */
    enrichRecovery?: boolean;
  };
  idempotencyKey?: string;
}

export type ExportFormat = 'txt' | 'bib' | 'ris' | 'csv' | 'docx';

export interface InspectRequest {
  sourceType: 'text' | 'pdf' | 'docx' | 'txt' | 'bib' | 'ris' | 'doi_list';
  content: string;
}

export interface InspectDetectionEnvelope {
  chosen: { format: string; score: number; evidence: string[] };
  secondBest: { format: string; score: number } | null;
  confidence: number;
  effectiveConfidence: number;
  method: 'scored' | 'forced';
  perBlockUsed: boolean;
  sampled: boolean;
}

export interface InspectBlockPreview {
  index: number;
  text: string;
  splitReason: string;
  blockFormat: string;
}

export interface InspectResponse {
  estimatedCount: number;
  aggregatedCount: number;
  splitCount: number;
  countAudit: CountAudit;
  detectedFormat: DetectedFormat;
  detectedDois: string[];
  formatConfidence: number;
  structure: IngestionStructure;
  styleHints: string[];
  ingestionSignals?: IngestionSignals;
  needsActionCount: number;
  diagnostics?: StageRunRecord[];
  detection?: InspectDetectionEnvelope;
  cleanup?: {
    mode: 'off' | 'inspect_only' | 'full';
    lookedLikePdfCopy: boolean;
    candidateGenerated: boolean;
    baselineDetectedFormat: DetectedFormat;
    cleanedDetectedFormat?: DetectedFormat;
    baselineSplitQuality: number;
    cleanedSplitQuality?: number;
    qualityDelta?: number;
    wouldSelect: 'baseline' | 'cleaned';
    finalUsed: 'baseline' | 'cleaned';
    decisionReason?: InputCleanupDecisionReason;
  };
  blocks?: InspectBlockPreview[];
}

export interface ConvertResponse {
  jobId: string;
  jobAccessToken?: string;
  status: PipelineStatus;
  executionProfile: ParseProfile;
  coreParseLatencyMs: number;
  summary: {
    total: number;
    ready: number;
    needsReview: number;
    needsAction: number;
    failed: number;
    parseQuality: number; // average rawScore
  };
  references: ProcessedCitation[];
  failedIndices: number[];
  duplicateGroups: Array<{
    groupId: string;
    primaryId: string;
    memberIds: string[];
    method: 'minhash_lsh' | 'doi_exact' | 'normalized_hash' | 'canonical_work_key';
    jaccardScore: number;
  }>;
  exports: Array<{
    format: ExportFormat;
    available: boolean;
  }>;
  countAudit: CountAudit;
  processingPath: ProcessingPath;
  providerUsage: {
    crossrefCalls: number;
    openalexCalls: number;
    semanticScholarCalls: number;
    llmTokensUsed: number;
    llmRepairCalls: number;
    cacheHits: number;
  };
  retryPayload?: {
    inputs: string[];
    hint: string;
  };
  overlay: {
    status: 'not_requested' | 'running' | 'completed' | 'failed';
    jobId: string | null;
    providerLatencyMs: number | null;
  };
  warnings: string[];
  diagnostics?: StageRunRecord[];
}

export interface JobCreatedResponse {
  jobId: string;
  jobAccessToken?: string;
  status: 'pending';
  estimatedDuration: number; // seconds
}

export interface JobProgress {
  totalRefs: number;
  processedRefs: number;
  currentPhase: string | null;
  percentComplete: number;
}

export interface JobStatusResponse {
  jobId: string;
  jobAccessToken?: string;
  status: 'pending' | 'processing' | 'completed' | 'partial' | 'failed';
  executionMode: 'sync' | 'async';
  executionProfile?: ParseProfile;
  coreParseLatencyMs?: number;
  progress?: JobProgress;
  summary?: ConvertResponse['summary'];
  countAudit?: CountAudit;
  references?: ProcessedCitation[];
  exports?: Array<{
    format: ExportFormat;
    available: boolean;
  }>;
  overlay?: ConvertResponse['overlay'];
  warnings?: string[];
  diagnostics?: StageRunRecord[];
  error?: {
    code: string;
    message: string;
  };
}
