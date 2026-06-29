import type { CitationStyle } from './citation.js';
import type { ErrorCode } from '../errors/codes.js';
import type { SplitQualityFlag } from './ingestion.js';
import type { ParseProfile } from './parseProfile.js';

export type PipelineStatus = 'success' | 'partial' | 'failed';
export type PhaseStatus = 'pending' | 'running' | 'success' | 'warning' | 'error' | 'skipped';

export type PhaseId =
  | 'ingestion'
  | 'pdf_cleanup_evaluation'
  | 'block_aggregation'
  | 'splitting'
  | 'style_detection'
  | 'extraction'
  | 'author_disambiguation'
  | 'structural_family_routing'
  | 'type_classification'
  | 'shared_repair'
  | 'llm_fallback'
  | 'normalization'
  | 'enrichment'
  | 'deduplication'
  | 'health_validation'
  | 'authority_validation'
  | 'rendering'
  | 'feedback'
  | 'feedback_loop'
  | 'detection_telemetry';

export interface StageRunRecord {
  stageId: string;
  contractVersion: number;
  phaseId: PhaseId;
  status: PhaseStatus;
  durationMs: number;
  inputHash?: string;
  outputHash?: string;
  message?: string;
  code?: ErrorCode;
  details?: Record<string, unknown>;
}

export interface CountAudit {
  inputEstimate: number;    // from Phase 1 profiling
  aggregatedCount: number;  // after block aggregation (Phase 2)
  splitCount: number;       // after hard split (Phase 2)
  delta: number;            // splitCount - inputEstimate
  needsActionCount: number; // uncertain blocks tagged needs_action
  droppedCount: number;     // MUST always be 0
}

export interface ProcessingPath {
  stagesRun: PhaseId[];
  fallbacksUsed: string[];
  durationMs: number;
  partialResult: boolean;
  batchConfig: { batchSize: number; maxConcurrency: number };
  stageTimings: Array<{
    phaseId: PhaseId;
    durationMs: number;
    status: PhaseStatus;
    budgetMs: number | null;
    withinBudget: boolean | null;
  }>;
}

export interface TenantContext {
  userId?: string;
  orgId?: string;
  apiKeyId?: string;
  isAdmin?: boolean;
  skipApprovedTruthOverlays?: boolean;
  tier: 'free' | 'pro' | 'b2b';
}

export interface ProviderUsage {
  crossrefCalls: number;
  openalexCalls: number;
  semanticScholarCalls: number;
  llmTokensUsed: number;
  llmRepairCalls: number;
  cacheHits: number;
}

export const PIPELINE_RUNTIME_PROFILES = [
  'site_default',
  'benchmark_5600h',
  'server_16c',
] as const;
export type PipelineRuntimeProfile = (typeof PIPELINE_RUNTIME_PROFILES)[number];

export interface PipelineRuntimeTuning {
  profile?: PipelineRuntimeProfile;
  batchSize: number;
  maxConcurrency: number;
  fastLaneMulticoreMinRefs?: number;
}

export interface PipelineExecutionPolicy {
  parseProfile: ParseProfile;
  providers: 'off' | 'overlay_only';
  llmFallback: 'off' | 'debug_only';
  styleDetectionMl: 'off' | 'hint_only';
  authorDisambiguationMl: 'off' | 'routed';
  extractionMl: 'off' | 'routed';
  typeClassificationMl: 'off' | 'routed';
  renderMode: 'structured' | 'full';
  dedupMode: 'exact_canonical' | 'full_local';
  healthMode: 'minimal' | 'full';
  debugMode: 'off' | 'sampled' | 'full';
  authorityValidation: 'off' | 'local_only';
  feedbackMode: 'off' | 'full';
}

export interface PipelineOptions {
  parseProfile: ParseProfile;
  enrich: boolean;
  dedup: boolean;
  groupDuplicates: boolean;
  debug: boolean;
  llmFallback: boolean;
  authorityValidation: boolean;
  feedbackLoop: boolean;
  retentionPolicy: 'default' | 'extended' | 'minimal';
  enableScoredDetection: boolean;
  enablePdfCleanup: boolean;
  pdfCleanupMode: 'off' | 'inspect_only' | 'full';
  /**
   * Pro-only: after health, attempt a verified enrichment lookup for each `needs_action`
   * reference and promote it to `ready` on a confident provider match. Set by the convert route
   * for pro/b2b tiers; off for everyone else.
   */
  enrichRecovery: boolean;
}

export interface EnrichmentRecoveryResult {
  /** needs_action references that spent a provider lookup. */
  attempted: number;
  /** references promoted out of needs_action by a verified match. */
  enriched: number;
  /** needs_action references left untouched (no match / mismatch / budget). */
  skipped: number;
  recoveredCarrierIds: string[];
}

export interface PipelineContext {
  jobId: string;
  pipelineMajor: 3;
  outputStyle: CitationStyle;
  options: PipelineOptions;
  executionPolicy: PipelineExecutionPolicy;
  runtimeTuning: PipelineRuntimeTuning;
  stageLog: StageRunRecord[];
  startedAt: number;
  performanceBudgets: Partial<Record<PhaseId, number>>;
  abortSignal?: AbortSignal;
  tenantContext: TenantContext;
  providerUsage: ProviderUsage;
  enrichmentRecovery?: EnrichmentRecoveryResult;
  detectionMeta?: {
    confidence: number;
    sampled: boolean;
    splitQualityFlag: SplitQualityFlag;
  };
}

/** Every pipeline stage must implement this interface */
export interface PipelineStage<TInput, TOutput> {
  readonly phaseId: PhaseId;
  readonly contractVersion: number;
  run(input: TInput, ctx: PipelineContext): Promise<TOutput>;
}

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  parseProfile: 'current_runtime',
  enrich: false,
  dedup: true,
  groupDuplicates: true,
  debug: false,
  llmFallback: false,
  authorityValidation: false,
  feedbackLoop: false,
  retentionPolicy: 'default',
  enableScoredDetection: false,
  enablePdfCleanup: false,
  pdfCleanupMode: 'off',
  enrichRecovery: false,
};
