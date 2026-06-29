import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import type { ConvertRequest, ConvertResponse } from '../engine/types/api.js';
import type {
  CitationStyle,
  ProcessedCitation,
  PublicStatus,
} from '../engine/types/citation.js';
import type { ParseProfile } from '../engine/types/parseProfile.js';
import type { PipelineExecutionPolicy, PipelineRuntimeProfile } from '../engine/types/pipeline.js';
import { createPipelineDependencies } from '../pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../pipeline/orchestrator.js';
import { resolvePipelineRuntimeProfile } from '../pipeline/runtimeProfiles.js';
import { compareField } from '../benchmark/evaluation.js';

type EvidenceDatasetId = 'gold_style_core' | 'current_500_workload' | 'pasted_input' | 'hard_regression';
type EvidenceModeId =
  | 'heuristics_only'
  | 'raw_ml_independent_shadow'
  | 'raw_bio_shadow'
  | 'guarded_bio_shadow'
  | 'hybrid_current'
  | 'hybrid_with_bio_candidate_shadow'
  | 'browser_site_default_current';

type FieldScore = {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
};

export type ExpectedRow = {
  id: string;
  rawText: string;
  expectedFields: Record<string, unknown>;
  expectedType?: string | null;
  expectedStyle?: string | null;
};

type DatasetInput = {
  id: EvidenceDatasetId;
  label: string;
  truthAvailable: boolean;
  rows: ExpectedRow[];
};

export interface MlBioEvidenceInput {
  content?: string | undefined;
  sourceType: ConvertRequest['sourceType'];
  outputStyle: CitationStyle;
  runtimeProfile: PipelineRuntimeProfile;
  maxGoldRows?: number | undefined;
}

export interface MlBioEvidenceReport {
  id: string;
  generatedAt: string;
  config: {
    sourceType: ConvertRequest['sourceType'];
    outputStyle: CitationStyle;
    runtimeProfile: PipelineRuntimeProfile;
    goldRows: 'all' | number;
  };
  datasets: EvidenceDatasetSummary[];
  adminSummary: EvidenceAdminSummary;
  releaseReadiness: EvidenceBundleSummary;
  evidenceBundle: EvidenceBundleSummary;
  throughputSummary: EvidenceThroughputSummary;
  browserTimings: EvidenceBrowserTiming[];
  modeRuns: EvidenceModeSummary[];
  comparisons: EvidenceComparison[];
  bioPrimaryApplicability: BioPrimaryApplicability[];
  bioPrimaryPromotionGate: BioPrimaryPromotionGate;
  decisionGates: EvidenceDecisionGates;
  conclusions: string[];
}

export interface EvidenceDatasetSummary {
  id: EvidenceDatasetId;
  label: string;
  truthAvailable: boolean;
  rowCount: number;
  sha256: string;
}

export interface EvidenceAdminSummary {
  overallStatus: 'pass' | 'fail' | 'needs_investigation' | 'insufficient_truth';
  qualityStatus: 'pass' | 'fail' | 'needs_investigation' | 'insufficient_truth';
  performanceStatus: 'pass' | 'fail' | 'not_valid' | 'not_measured';
  headline: string;
  whatRan: string[];
  quality: string[];
  bioImpact: string;
  mlImpact: string;
  siteLaneTruth: string;
  topRisks: string[];
  recommendedNextAction: string;
}

export type EvidenceReadinessCardStatus = 'pass' | 'warning' | 'fail' | 'blocked' | 'not_measured';

export type EvidenceReleaseVerdict =
  | 'not_ready'
  | 'ready_for_shadow_testing'
  | 'ready_for_limited_rollout'
  | 'ready_for_live_promotion';

export interface EvidenceReadinessCard {
  id: 'quality' | 'siteSpeed' | 'trainingData' | 'safeRollout';
  label: string;
  question: string;
  status: EvidenceReadinessCardStatus;
  plainSummary: string;
  blockingReasons: string[];
  advancedEvidence: string[];
}

export interface EvidenceBundleSummary {
  schemaVersion: 'parser_release_readiness.v1';
  title: 'Parser Release Readiness';
  finalVerdict: EvidenceReleaseVerdict;
  finalVerdictLabel: string;
  promotionAllowed: boolean;
  topBlockingReasons: string[];
  cards: {
    quality: EvidenceReadinessCard;
    siteSpeed: EvidenceReadinessCard;
    trainingData: EvidenceReadinessCard;
    safeRollout: EvidenceReadinessCard;
  };
  advanced: {
    decisionGateStatus: EvidenceDecisionGates['status'];
    throughputClaimStatus: EvidenceThroughputSummary['claimStatus'];
    bioPrimaryPromotionStatus: BioPrimaryPromotionGate['status'];
    browserTimingCount: number;
    modeRunCount: number;
    comparisonCount: number;
    datasetIds: EvidenceDatasetId[];
    liveBehaviorChanged: false;
    hiddenTechnicalDetails: string[];
  };
}

export type EvidenceThroughputLaneId =
  | 'direct_engine'
  | 'direct_engine_plus_report'
  | 'backend_convert_route'
  | 'queued_job_runtime'
  | 'browser_submit_to_results'
  | 'browser_first_paint'
  | 'browser_all_rendered';

export interface EvidenceThroughputLane {
  id: EvidenceThroughputLaneId;
  label: string;
  category: 'parser' | 'backend' | 'browser';
  measured: boolean;
  inputReferenceCount: number;
  parsedReferenceCount: number;
  wallMs: number | null;
  refsPerSecond: number | null;
  qualityGateStatus: EvidenceSimpleGate['status'] | EvidenceDecisionGates['status'];
  performanceValid: boolean;
  parseProfile: ParseProfile | null;
  runtimeProfile: PipelineRuntimeProfile | null;
  whatThisNumberMeans: string;
  missingReason?: string;
}

export interface EvidenceThroughputSummary {
  targetRefsPerSecond: number;
  claimStatus: 'browser_measured' | 'browser_not_measured' | 'quality_invalid' | 'below_target';
  plainSummary: string;
  lanes: EvidenceThroughputLane[];
}

export interface EvidenceBrowserTimingInput {
  source: 'admin_diagnostics_evidence' | 'site_convert';
  inputReferenceCount?: number | undefined;
  parsedReferenceCount?: number | undefined;
  requestMs?: number | undefined;
  submitToResultsMs: number;
  firstPaintMs: number;
  allRenderedMs: number;
  browserResultBytes?: number | undefined;
  rowsInitiallyRendered?: number | undefined;
  rowsEventuallyRendered?: number | undefined;
  virtualizationEnabled?: boolean | undefined;
  longTaskCount?: number | undefined;
  maxLongTaskMs?: number | undefined;
}

export interface EvidenceBrowserTiming extends EvidenceBrowserTimingInput {
  recordedAt: string;
  targetDatasetId: EvidenceDatasetId | null;
  targetMode: EvidenceModeId | null;
  submitToResultsRefsPerSecond: number | null;
  firstPaintRefsPerSecond: number | null;
  allRenderedRefsPerSecond: number | null;
  plainSummary: string;
}

export interface BioPrimaryPromotionGate {
  status: 'safe_candidate' | 'blocked' | 'not_measured' | 'insufficient_truth';
  plainSummary: string;
  recommendation: string;
  checks: Array<{
    id: string;
    label: string;
    status: 'pass' | 'fail' | 'warning' | 'not_measured' | 'not_applicable';
    plainReason: string;
  }>;
}

export interface EvidenceSimpleGate {
  status: 'pass' | 'fail' | 'warning' | 'not_applicable';
  plainReason: string;
  checks: Array<{
    id: string;
    label: string;
    status: 'pass' | 'fail' | 'warning' | 'not_applicable';
    plainReason: string;
    technicalReason?: string;
  }>;
}

export interface EvidencePolicySnapshot {
  laneLabel: string;
  whatThisLaneMeans: string;
  requestedParseProfile: ParseProfile;
  effectiveParseProfile: ParseProfile;
  requestedRuntimeProfile: PipelineRuntimeProfile;
  effectiveRuntimeProfile: PipelineRuntimeProfile;
  styleMl: 'off' | 'hint_only' | 'routed';
  authorMl: 'off' | 'routed';
  extractionMl: 'off' | 'routed';
  bioExtraction: 'off' | 'shadow_only' | 'guarded_shadow' | 'selective_patch' | 'candidate_primary';
  typeMl: 'off' | 'routed';
  providers: 'off' | 'overlay_only';
  llmFallback: 'off' | 'debug_only';
  batchSize: number;
  maxConcurrency: number;
  overrideReasons: string[];
}

export interface EvidenceBioQualitySummary {
  truthAvailable: boolean;
  bioWasActive: boolean;
  bioMode: EvidencePolicySnapshot['bioExtraction'];
  refsWithBioOutput: number;
  bioAcceptedChanges: number;
  bioRejectedChanges: number;
  bioHelpedCount: number;
  bioHarmedAcceptedCount: number;
  bioBlockedUnsafeCount: number;
  bioNoOpCount: number;
  topRejectedReasons: Record<string, number>;
  plainSummary: string;
}

export interface EvidenceFieldDiffExample {
  index: number;
  rawPreview: string;
  field: string;
  outcome: 'helped' | 'worsened' | 'unchanged' | 'needs_investigation';
  adminSummary: string;
  heuristicValue: unknown;
  rawMlValue: unknown;
  rawBioValue: unknown;
  guardedBioValue: unknown;
  hybridFinalValue: unknown;
  goldValue: unknown;
  acceptedSource: string | null;
  rejectedReason: string | null;
  readinessDelta: string;
  renderedTextDelta: 'same' | 'changed';
}

export interface EvidenceTypeMlEvaluation {
  truthAvailable: boolean;
  helped: number;
  hurtIfAccepted: number;
  noDifference: number;
  heuristicCorrectMlWrong: number;
  heuristicWrongMlCorrect: number;
  finalTypeChanges: number;
  renderedChangedWithTypeChange: number;
  healthImpactCount: number;
  recommendation: 'keep_shadow' | 'test_guarded_override' | 'insufficient_truth';
  plainSummary: string;
  examples: Array<{
    index: number;
    rawPreview: string;
    heuristicType: unknown;
    mlType: unknown;
    goldType: unknown;
    finalType: unknown;
    outcome: 'helped' | 'hurt' | 'same' | 'needs_investigation';
    healthImpact: string;
    renderedTextDelta: 'same' | 'changed';
  }>;
}

export interface EvidenceHealthHotspotAudit {
  needsAction: number;
  visibleReasons: number;
  needsActionWithoutVisibleReason: number;
  topCauses: Record<string, number>;
  plainSummary: string;
  examples: Array<{
    index: number;
    rawPreview: string;
    plainReason: string;
    technicalReason: string;
    visibleHotspotId: string | null;
  }>;
}

export interface EvidenceDuplicateAudit {
  truthAvailable: boolean;
  candidateGroups: number;
  likelyCorrectGroups: number;
  needsReviewGroups: number;
  likelyFalsePositiveGroups: number;
  mainFalsePositiveCause: string | null;
  pairPrecision: number;
  pairRecall: number;
  clusterPrecision: number;
  clusterRecall: number;
  falsePositiveByMethod: Record<string, number>;
  plainSummary: string;
  falseDuplicateExamples: Array<{
    groupId: string;
    method: string;
    clusterSize: number;
    rawPreviews: string[];
  }>;
  missedDuplicateExamples: Array<{
    pair: string;
    expectedKey: string;
    rawPreviews: string[];
  }>;
}

export interface BioPrimaryApplicability {
  phaseId: 'phase1_ingestion' | 'phase2_splitting' | 'phase3_style' | 'phase4_extraction';
  intendedRole: string;
  currentRole: string;
  currentStatus: 'not_integrated' | 'hint_only' | 'shadow_only' | 'selective_patch' | 'primary_candidate';
  requiredBeforePromotion: string[];
}

export interface EvidenceModeSummary {
  mode: EvidenceModeId;
  layer: 'component' | 'product_path';
  datasetId: EvidenceDatasetId;
  parseProfile: ParseProfile;
  runtimeProfile: PipelineRuntimeProfile;
  effectivePolicy: EvidencePolicySnapshot;
  referenceCount: number;
  wallClockMs: number;
  refsPerSecond: number;
  summary: ConvertResponse['summary'];
  throughputLanes: {
    directEngineRefsPerSecond: number;
    directEnginePlusReportRefsPerSecond: number;
    backendConvertRouteRefsPerSecond: number | null;
    queuedJobRuntimeRefsPerSecond: number | null;
    browserSubmitToResultsRefsPerSecond: number | null;
    browserFirstPaintRefsPerSecond: number | null;
    browserAllRenderedRefsPerSecond: number | null;
  };
  stageBottlenecks: Array<{
    phaseId: string;
    totalMs: number;
    p95Ms: number;
    count: number;
  }>;
  fieldScores: Record<string, FieldScore>;
  readiness: {
    ready: number;
    needsReview: number;
    needsAction: number;
    failed: number;
    falseReady: number;
    falseActionNeeded: number;
  };
  qualityGate: EvidenceSimpleGate;
  performanceGate: EvidenceSimpleGate;
  duplicateMetrics: {
    predictedGroups: number;
    predictedPairs: number;
    expectedPairs: number;
    pairPrecision: number;
    pairRecall: number;
    falseDuplicateGroups: number;
    missedDuplicatePairs: number;
    largestBadCluster: number;
    causeCounts: Record<string, number>;
    clusterPrecision: number;
    clusterRecall: number;
  };
  healthHotspotAudit: EvidenceHealthHotspotAudit;
  duplicateAudit: EvidenceDuplicateAudit;
  bioAttribution: BioAttribution;
  bioQuality: EvidenceBioQualitySummary;
  mlAttribution: MlAttribution;
  regressionExamples: EvidenceRegressionExample[];
}

export interface EvidenceComparison {
  datasetId: EvidenceDatasetId;
  candidateMode: EvidenceModeId;
  baselineMode: EvidenceModeId;
  readinessTransitions: Record<string, number>;
  criticalFieldLossCount: number;
  wrongOverwriteCount: number;
  improved: number;
  regressed: number;
  unchangedCorrect: number;
  unchangedWrong: number;
  noOp: number;
  newFalsePositive: number;
  newFalseNegative: number;
  examples: EvidenceRegressionExample[];
  fieldDiffExamples: EvidenceFieldDiffExample[];
  typeMlEvaluation: EvidenceTypeMlEvaluation;
  qualityGate: EvidenceSimpleGate;
  performanceGate: EvidenceSimpleGate;
}

export interface BioAttribution {
  entityEmitted: number;
  entityStructurallyValid: number;
  entityGrounded: number;
  fieldCandidateProduced: number;
  patchAttempted: number;
  patchAccepted: number;
  patchRejected: number;
  patchImprovedGoldScore: number;
  patchWorsenedGoldScore: number;
  patchNoOp: number;
  blockedByDiagnostics: number;
  blockedByMalformedSequence: number;
  blockedByOverlap: number;
  blockedBySpanIssue: number;
  blockedByGrounding: number;
  blockedByNonRegressionGuard: number;
  missingRequiredMlSpanWarnings: number;
  byLabel: Record<string, {
    entities: number;
    invalid: number;
    diagnostics: number;
  }>;
}

export interface MlAttribution {
  eligibleRefs: number;
  routedRefs: number;
  attemptedRefs: number;
  abstainedRefs: number;
  acceptedRefs: number;
  rejectedRefs: number;
  noOpRefs: number;
  rawMlOutputRefs: number;
  afterStructuralGuardsRefs: number;
  afterGroundingGuardsRefs: number;
  afterNonRegressionGuardsRefs: number;
  finalHybridRefs: number;
  malformedBioAccepted: number;
  acceptedPatchPrecision: number;
}

export interface EvidenceRegressionExample {
  index: number;
  rawPreview: string;
  mode: EvidenceModeId;
  kind: string;
  field?: string;
  baseline?: unknown;
  candidate?: unknown;
  expected?: unknown;
}

export interface EvidenceDecisionGates {
  status: 'pass' | 'fail' | 'insufficient_truth';
  checks: Array<{
    id: string;
    status: 'pass' | 'fail' | 'not_applicable';
    message: string;
  }>;
}

const reports: MlBioEvidenceReport[] = [];
const MAX_REPORTS = 10;
const PRODUCT_PATH_TARGET_REFS_PER_SECOND = 200;
const FIELD_ALIASES: Record<string, string> = {
  journalVenue: 'journal',
  venue: 'journal',
  referenceType: 'referenceType',
};
const CRITICAL_FIELDS = new Set(['authors', 'title', 'year', 'doi', 'url', 'renderedText', 'referenceType']);

type EvidenceModeRunResult = {
  summary: EvidenceModeSummary;
  references: ProcessedCitation[];
  rows: ExpectedRow[];
};

const HARD_REGRESSION_ROWS: ExpectedRow[] = [
  {
    id: 'hard:malformed-bio-author-punctuation',
    rawText: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. doi:10.1000/xyz123',
    expectedFields: {
      authors: 'Smith J',
      title: 'Example article',
      year: '2020',
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
      doi: '10.1000/xyz123',
    },
    expectedType: 'article-journal',
    expectedStyle: 'apa7',
  },
  {
    id: 'hard:duplicate-cluster-doi',
    rawText: 'Smith J. Example article. Journal of Examples. 2020;12(3):44-50. doi:10.1000/xyz123.',
    expectedFields: {
      authors: 'Smith J',
      title: 'Example article',
      year: '2020',
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
      doi: '10.1000/xyz123',
    },
    expectedType: 'article-journal',
    expectedStyle: 'vancouver',
  },
];

export function getLatestMlBioEvidenceReport(): MlBioEvidenceReport | null {
  return reports[0] ?? null;
}

export function listMlBioEvidenceReports(): MlBioEvidenceReport[] {
  return reports;
}

export function attachMlBioEvidenceBrowserTiming(
  reportId: string,
  input: EvidenceBrowserTimingInput,
): MlBioEvidenceReport | null {
  const report = reports.find((candidate) => candidate.id === reportId);
  if (!report) return null;

  const targetRun = selectBrowserTargetRun(report.modeRuns);
  const parsedReferenceCount = Math.max(
    0,
    Math.round(input.parsedReferenceCount ?? targetRun?.referenceCount ?? input.inputReferenceCount ?? 0),
  );
  const inputReferenceCount = Math.max(
    0,
    Math.round(input.inputReferenceCount ?? parsedReferenceCount),
  );
  const timing: EvidenceBrowserTiming = {
    ...input,
    inputReferenceCount,
    parsedReferenceCount,
    recordedAt: new Date().toISOString(),
    targetDatasetId: targetRun?.datasetId ?? null,
    targetMode: targetRun?.mode ?? null,
    submitToResultsRefsPerSecond: parsedReferenceCount > 0 ? throughput(parsedReferenceCount, input.submitToResultsMs) : null,
    firstPaintRefsPerSecond: parsedReferenceCount > 0 ? throughput(parsedReferenceCount, input.firstPaintMs) : null,
    allRenderedRefsPerSecond: parsedReferenceCount > 0 ? throughput(parsedReferenceCount, input.allRenderedMs) : null,
    plainSummary: browserTimingPlainSummary(input.source, parsedReferenceCount, input.allRenderedMs),
  };

  report.browserTimings = [timing, ...(report.browserTimings ?? [])].slice(0, 20);
  if (targetRun) {
    targetRun.throughputLanes.browserSubmitToResultsRefsPerSecond = timing.submitToResultsRefsPerSecond;
    targetRun.throughputLanes.browserFirstPaintRefsPerSecond = timing.firstPaintRefsPerSecond;
    targetRun.throughputLanes.browserAllRenderedRefsPerSecond = timing.allRenderedRefsPerSecond;
    targetRun.performanceGate = buildBrowserPerformanceGate(targetRun.qualityGate, timing.allRenderedRefsPerSecond);
  }
  refreshReportDerivedFields(report);
  return report;
}

export async function runMlBioEvidenceReport(input: MlBioEvidenceInput): Promise<MlBioEvidenceReport> {
  const maxGoldRows = input.maxGoldRows ? Math.max(1, input.maxGoldRows) : undefined;
  const datasets = await buildDatasets(input.content, maxGoldRows);
  const runResults: EvidenceModeRunResult[] = [];
  const runStarted = performance.now();

  for (const dataset of datasets) {
    for (const mode of evidenceModesForDataset(dataset)) {
      runResults.push(await runMode(dataset, mode, input));
    }
  }

  const modeRuns = runResults.map((result) => result.summary);
  for (const run of modeRuns) {
    run.throughputLanes.directEnginePlusReportRefsPerSecond = throughput(
      run.referenceCount,
      performance.now() - runStarted,
    );
  }

  const comparisons = buildComparisons(runResults);
  const decisionGates = evaluateDecisionGates(modeRuns, comparisons);
  const bioPrimaryApplicability = buildBioPrimaryApplicability();
  const browserTimings: EvidenceBrowserTiming[] = [];
  const throughputSummary = buildThroughputSummary(modeRuns, decisionGates, browserTimings);
  const bioPrimaryPromotionGate = buildBioPrimaryPromotionGate(modeRuns, comparisons, decisionGates, throughputSummary);
  const adminSummary = buildAdminSummary(modeRuns, comparisons, decisionGates, throughputSummary);
  const datasetSummaries = datasets.map((dataset) => ({
    id: dataset.id,
    label: dataset.label,
    truthAvailable: dataset.truthAvailable,
    rowCount: dataset.rows.length,
    sha256: sha256(dataset.rows.map((row) => row.rawText).join('\n')),
  }));
  const releaseReadiness = buildEvidenceBundle(
    modeRuns,
    comparisons,
    decisionGates,
    throughputSummary,
    bioPrimaryPromotionGate,
    datasetSummaries,
    browserTimings,
  );
  const report: MlBioEvidenceReport = {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    config: {
      sourceType: input.sourceType,
      outputStyle: input.outputStyle,
      runtimeProfile: input.runtimeProfile,
      goldRows: maxGoldRows ?? 'all',
    },
    datasets: datasetSummaries,
    adminSummary,
    releaseReadiness,
    evidenceBundle: releaseReadiness,
    throughputSummary,
    browserTimings,
    modeRuns,
    comparisons,
    bioPrimaryApplicability,
    bioPrimaryPromotionGate,
    decisionGates,
    conclusions: buildConclusions(modeRuns, comparisons, decisionGates, bioPrimaryApplicability, throughputSummary),
  };

  reports.unshift(report);
  reports.splice(MAX_REPORTS);
  return report;
}

function evidenceModes(): EvidenceModeId[] {
  return [
    'heuristics_only',
    'raw_ml_independent_shadow',
    'raw_bio_shadow',
    'guarded_bio_shadow',
    'hybrid_current',
    'hybrid_with_bio_candidate_shadow',
    'browser_site_default_current',
  ];
}

function evidenceModesForDataset(dataset: DatasetInput): EvidenceModeId[] {
  if (dataset.truthAvailable) return evidenceModes();
  return [
    'heuristics_only',
    'browser_site_default_current',
  ];
}

export function buildBioPrimaryApplicability(): BioPrimaryApplicability[] {
  return [
    {
      phaseId: 'phase1_ingestion',
      intendedRole: 'Use BIO/ML structural evidence to identify reference-like regions and source normalization hazards when the input is unstructured text.',
      currentRole: 'Phase 1 currently uses deterministic ingestion normalization and scored/legacy format detection. BIO is not called before splitting.',
      currentStatus: 'not_integrated',
      requiredBeforePromotion: [
        'Add an ML/BIO structure endpoint that can score raw multi-reference text before splitting.',
        'Measure estimate accuracy, missed-reference rate, and false candidate regions against gold and pasted workloads.',
        'Keep deterministic ingestion as a fallback when BIO structure confidence is low or the ML service is unavailable.',
      ],
    },
    {
      phaseId: 'phase2_splitting',
      intendedRole: 'Use BIO boundaries as the primary candidate splitter for raw pasted batches, with heuristic split as fallback and disagreement evidence.',
      currentRole: 'Phase 2 currently calls the heuristic splitter and PDF-cleanup evaluator. BIO spans are not used for block boundaries.',
      currentStatus: 'not_integrated',
      requiredBeforePromotion: [
        'Train or expose labels for reference-start/reference-end or citation-block spans across multi-reference inputs.',
        'Compare BIO split precision/recall and count drift against heuristic splitting on raw_unstructured, numbered, multiline, PDF-copy, and browser workloads.',
        'Report BIO/heuristic boundary disagreements with exact source offsets before allowing BIO-primary splitting.',
      ],
    },
    {
      phaseId: 'phase3_style',
      intendedRole: 'Use style ML as a routing signal while BIO field spans provide supporting evidence for style-family ambiguity.',
      currentRole: 'Phase 3 can use ML style hints, then deterministic family-first style scoring. BIO labels are not fed into style selection.',
      currentStatus: 'hint_only',
      requiredBeforePromotion: [
        'Measure whether BIO field patterns improve style-family or exact-style decisions beyond the current style classifier.',
        'Prevent BIO style evidence from overriding high-confidence deterministic style commits without paired regression proof.',
      ],
    },
    {
      phaseId: 'phase4_extraction',
      intendedRole: 'Use BIO token spans as the preferred field parser where grounded and valid, with heuristic extraction as repair/fallback and non-regression guard.',
      currentRole: 'Phase 4 receives BIO debug from ML extraction, blocks malformed sequences, and applies only selective ML patches over heuristic extraction.',
      currentStatus: 'selective_patch',
      requiredBeforePromotion: [
        'Promote a BIO-primary candidate lane that constructs fields directly from valid grounded BIO entities before heuristic repair.',
        'Measure author/title/year/container/identifier field exact F1, wrong overwrites, ready preservation, and latency against gold and hard regression sets.',
        'Keep author NER as repair only until BIO beats it on author boundaries, corporate authors, punctuation false positives, and latency.',
      ],
    },
  ];
}

async function buildDatasets(content: string | undefined, maxGoldRows?: number): Promise<DatasetInput[]> {
  const goldRows = await loadGoldRows(maxGoldRows);
  const datasets: DatasetInput[] = [
    {
      id: 'gold_style_core',
      label: maxGoldRows ? `style_gold:first_${maxGoldRows}` : 'style_gold:all',
      truthAvailable: true,
      rows: goldRows,
    },
    {
      id: 'hard_regression',
      label: 'hard_regression',
      truthAvailable: true,
      rows: HARD_REGRESSION_ROWS,
    },
  ];

  const current500 = await loadCurrent500Rows();
  if (current500.length > 0) {
    datasets.push({
      id: 'current_500_workload',
      label: 'current_500_workload',
      truthAvailable: false,
      rows: current500,
    });
  }

  const pasted = content?.trim();
  if (pasted) {
    datasets.push({
      id: 'pasted_input',
      label: 'pasted_input',
      truthAvailable: false,
      rows: rowsFromContent(pasted, 'pasted'),
    });
  }

  return datasets.filter((dataset) => dataset.rows.length > 0);
}

async function loadGoldRows(maxRows?: number): Promise<ExpectedRow[]> {
  const candidates = [
    resolve(process.cwd(), '..', 'ml-service', 'training', 'style_gold.jsonl'),
    resolve(process.cwd(), 'ml-service', 'training', 'style_gold.jsonl'),
    resolve(process.cwd(), '..', 'datasets', 'engine-v2', 'gold', 'style-core', 'exports', 'style_gold.jsonl'),
    resolve(process.cwd(), 'datasets', 'engine-v2', 'gold', 'style-core', 'exports', 'style_gold.jsonl'),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return [];
  const content = await readFile(path, 'utf8');
  const lines = content
    .split(/\r?\n/u)
    .filter(Boolean);
  return (maxRows ? lines.slice(0, maxRows) : lines)
    .flatMap((line, index) => {
      try {
        const parsed = JSON.parse(line) as {
          raw_text?: unknown;
          expected_fields?: unknown;
          expected_type?: unknown;
          expected_style?: unknown;
          variant_id?: unknown;
        };
        if (typeof parsed.raw_text !== 'string') return [];
        return [{
          id: typeof parsed.variant_id === 'string' ? parsed.variant_id : `gold:${index + 1}`,
          rawText: parsed.raw_text,
          expectedFields: isRecord(parsed.expected_fields) ? parsed.expected_fields : {},
          expectedType: typeof parsed.expected_type === 'string' ? parsed.expected_type : null,
          expectedStyle: typeof parsed.expected_style === 'string' ? parsed.expected_style : null,
        }];
      } catch {
        return [];
      }
    });
}

async function loadCurrent500Rows(): Promise<ExpectedRow[]> {
  const candidates = [
    resolve(process.cwd(), '..', '.codex-current-500-input.txt'),
    resolve(process.cwd(), '.codex-current-500-input.txt'),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return [];
  return rowsFromContent(await readFile(path, 'utf8'), 'current500');
}

function rowsFromContent(content: string, prefix: string): ExpectedRow[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((rawText, index) => ({
      id: `${prefix}:${index + 1}`,
      rawText,
      expectedFields: {},
    }));
}

async function runMode(
  dataset: DatasetInput,
  mode: EvidenceModeId,
  input: MlBioEvidenceInput,
): Promise<EvidenceModeRunResult> {
  const parseProfile = parseProfileForMode(mode);
  const requestedRuntimeProfile = input.runtimeProfile;
  const content = dataset.rows.map((row) => row.rawText).join('\n');
  const previousEnv = capturePhase4Env();
  applyPhase4EnvForMode(mode);
  const started = performance.now();
  try {
    const runtimeResolution = resolvePipelineRuntimeProfile(
      mode === 'browser_site_default_current' ? 'site_default' : input.runtimeProfile,
      input.runtimeProfile === 'benchmark_5600h' ? 'parallel' : 'direct',
    );
    const ctx = createPipelineContext({
      outputStyle: input.outputStyle,
      options: {
        parseProfile,
        debug: true,
        enrich: false,
        groupDuplicates: true,
        dedup: true,
      },
      runtimeTuning: runtimeResolution.runtimeTuning,
      tenantContext: { tier: 'pro', isAdmin: true, skipApprovedTruthOverlays: true },
    });
    applyPolicyForMode(ctx.executionPolicy, mode);
    const effectivePolicy = buildEffectivePolicySnapshot(
      mode,
      parseProfile,
      ctx.executionPolicy.parseProfile,
      requestedRuntimeProfile,
      runtimeResolution.profile,
      ctx.executionPolicy,
      ctx.runtimeTuning,
    );
    const artifacts = await withConsoleInfoMuted(() => runConvertPipeline({
      sourceType: input.sourceType,
      content,
      outputStyle: input.outputStyle,
      options: {
        parseProfile,
        debug: true,
        enrich: false,
        groupDuplicates: true,
        dedup: true,
      },
    }, ctx, createPipelineDependencies()));
    const wallClockMs = performance.now() - started;
    const reportStarted = performance.now();
    const fieldScores = dataset.truthAvailable
      ? computeFieldScores(dataset.rows, artifacts.response.references)
      : {};
    const duplicateEvaluation = computeDuplicateEvaluation(
      dataset.rows,
      artifacts.response,
      dataset.truthAvailable,
    );
    const bioAttribution = summarizeBioAttribution(dataset.rows, artifacts.response.references);
    const mlAttribution = summarizeMlAttribution(dataset.rows, artifacts.response.references, bioAttribution);
    const bioQuality = summarizeBioQuality(
      dataset.truthAvailable,
      effectivePolicy.bioExtraction,
      bioAttribution,
      artifacts.response.references.length,
    );
    const regressionExamples = dataset.truthAvailable
      ? buildGoldRegressionExamples(mode, dataset.rows, artifacts.response.references)
      : [];
    const reportCostMs = performance.now() - reportStarted;
    const qualityGate = buildRunQualityGate(
      artifacts.response.references,
      summarizeReadiness(dataset.rows, artifacts.response.references),
      mlAttribution,
    );
    const performanceGate = buildRunPerformanceGate(mode, qualityGate);

    const summary: EvidenceModeSummary = {
      mode,
      layer: mode === 'raw_ml_independent_shadow' || mode === 'raw_bio_shadow' ? 'component' : 'product_path',
      datasetId: dataset.id,
      parseProfile,
      runtimeProfile: mode === 'browser_site_default_current' ? 'site_default' : input.runtimeProfile,
      effectivePolicy,
      referenceCount: artifacts.response.references.length,
      wallClockMs: round(wallClockMs),
      refsPerSecond: throughput(artifacts.response.references.length, wallClockMs),
      summary: artifacts.response.summary,
      throughputLanes: {
        directEngineRefsPerSecond: throughput(artifacts.response.references.length, wallClockMs),
        directEnginePlusReportRefsPerSecond: throughput(artifacts.response.references.length, wallClockMs + reportCostMs),
        backendConvertRouteRefsPerSecond: null,
        queuedJobRuntimeRefsPerSecond: null,
        browserSubmitToResultsRefsPerSecond: null,
        browserFirstPaintRefsPerSecond: null,
        browserAllRenderedRefsPerSecond: null,
      },
      stageBottlenecks: summarizeBottlenecks(artifacts.response),
      fieldScores,
      readiness: summarizeReadiness(dataset.rows, artifacts.response.references),
      qualityGate,
      performanceGate,
      duplicateMetrics: duplicateEvaluation.metrics,
      healthHotspotAudit: summarizeHealthHotspotAudit(artifacts.response.references),
      duplicateAudit: duplicateEvaluation.audit,
      bioAttribution,
      bioQuality,
      mlAttribution,
      regressionExamples,
    };

    return { summary, references: artifacts.response.references, rows: dataset.rows };
  } finally {
    restorePhase4Env(previousEnv);
  }
}

function parseProfileForMode(mode: EvidenceModeId): ParseProfile {
  return mode === 'browser_site_default_current' ? 'core_parse_fast' : 'core_parse_full';
}

function applyPolicyForMode(policy: PipelineExecutionPolicy, mode: EvidenceModeId): void {
  if (mode === 'heuristics_only' || mode === 'browser_site_default_current') {
    policy.styleDetectionMl = 'off';
    policy.authorDisambiguationMl = 'off';
    policy.extractionMl = 'off';
    policy.typeClassificationMl = 'off';
    return;
  }

  policy.styleDetectionMl = 'hint_only';
  policy.authorDisambiguationMl = 'routed';
  policy.extractionMl = 'routed';
  policy.typeClassificationMl = 'routed';
}

function capturePhase4Env(): Record<string, string | undefined> {
  return {
    ML_PHASE4_MODE: process.env.ML_PHASE4_MODE,
    ML_PHASE4_PRIMARY_FRACTION: process.env.ML_PHASE4_PRIMARY_FRACTION,
    ML_PHASE4_SHADOW_FRACTION: process.env.ML_PHASE4_SHADOW_FRACTION,
  };
}

function applyPhase4EnvForMode(mode: EvidenceModeId): void {
  if (mode === 'heuristics_only') {
    process.env.ML_PHASE4_MODE = 'heuristic';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '0';
    process.env.ML_PHASE4_SHADOW_FRACTION = '0';
    return;
  }
  if (mode === 'hybrid_current' || mode === 'browser_site_default_current') {
    return;
  }
  if (mode === 'raw_ml_independent_shadow' || mode === 'raw_bio_shadow' || mode === 'guarded_bio_shadow') {
    process.env.ML_PHASE4_MODE = 'shadow';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '0';
    process.env.ML_PHASE4_SHADOW_FRACTION = '1';
    return;
  }
  process.env.ML_PHASE4_MODE = 'primary';
  process.env.ML_PHASE4_PRIMARY_FRACTION = '1';
  process.env.ML_PHASE4_SHADOW_FRACTION = '1';
}

function restorePhase4Env(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function buildEffectivePolicySnapshot(
  mode: EvidenceModeId,
  requestedParseProfile: ParseProfile,
  effectiveParseProfile: ParseProfile,
  requestedRuntimeProfile: PipelineRuntimeProfile,
  effectiveRuntimeProfile: PipelineRuntimeProfile,
  policy: PipelineExecutionPolicy,
  runtimeTuning: { batchSize: number; maxConcurrency: number },
): EvidencePolicySnapshot {
  const overrideReasons: string[] = [];
  if (requestedParseProfile !== effectiveParseProfile) {
    overrideReasons.push(`Parse profile resolved from ${requestedParseProfile} to ${effectiveParseProfile}.`);
  }
  if (requestedRuntimeProfile !== effectiveRuntimeProfile) {
    overrideReasons.push(`Runtime resolved from ${requestedRuntimeProfile} to ${effectiveRuntimeProfile}.`);
  }
  if (mode === 'browser_site_default_current') {
    overrideReasons.push('Site-default lane measures the current browser-facing policy, not the ML/BIO promotion candidate.');
  }
  if (mode === 'raw_bio_shadow' || mode === 'guarded_bio_shadow') {
    overrideReasons.push('BIO evidence is reported as shadow/guarded evidence; it is not promoted as the live parser in this lane.');
  }

  return {
    laneLabel: labelForMode(mode),
    whatThisLaneMeans: explanationForMode(mode),
    requestedParseProfile,
    effectiveParseProfile,
    requestedRuntimeProfile,
    effectiveRuntimeProfile,
    styleMl: policy.styleDetectionMl,
    authorMl: policy.authorDisambiguationMl,
    extractionMl: policy.extractionMl,
    bioExtraction: bioExtractionModeForMode(mode),
    typeMl: policy.typeClassificationMl,
    providers: policy.providers,
    llmFallback: policy.llmFallback,
    batchSize: runtimeTuning.batchSize,
    maxConcurrency: runtimeTuning.maxConcurrency,
    overrideReasons,
  };
}

function labelForMode(mode: EvidenceModeId): string {
  switch (mode) {
    case 'heuristics_only':
      return 'Heuristics baseline';
    case 'raw_ml_independent_shadow':
      return 'Raw ML shadow';
    case 'raw_bio_shadow':
      return 'Raw BIO shadow';
    case 'guarded_bio_shadow':
      return 'Guarded BIO shadow';
    case 'hybrid_current':
      return 'Current hybrid';
    case 'hybrid_with_bio_candidate_shadow':
      return 'BIO candidate';
    case 'browser_site_default_current':
      return 'Current site path';
  }
}

function explanationForMode(mode: EvidenceModeId): string {
  switch (mode) {
    case 'heuristics_only':
      return 'Baseline run with ML/BIO disabled so every candidate can be compared against current deterministic parsing.';
    case 'raw_ml_independent_shadow':
      return 'ML is routed for evidence, but this lane is not a production claim by itself.';
    case 'raw_bio_shadow':
      return 'BIO emits field spans in shadow mode so we can see what it would suggest.';
    case 'guarded_bio_shadow':
      return 'BIO suggestions are measured after structural and grounding guards.';
    case 'hybrid_current':
      return 'Current server hybrid policy using the selected runtime profile.';
    case 'hybrid_with_bio_candidate_shadow':
      return 'Candidate lane for BIO-primary extraction evidence, still blocked by quality gates.';
    case 'browser_site_default_current':
      return 'The current browser-facing site path. This is the lane admins feel in the UI.';
  }
}

function bioExtractionModeForMode(mode: EvidenceModeId): EvidencePolicySnapshot['bioExtraction'] {
  switch (mode) {
    case 'heuristics_only':
    case 'browser_site_default_current':
      return 'off';
    case 'raw_bio_shadow':
      return 'shadow_only';
    case 'guarded_bio_shadow':
      return 'guarded_shadow';
    case 'hybrid_with_bio_candidate_shadow':
      return 'candidate_primary';
    case 'hybrid_current':
      return 'selective_patch';
    case 'raw_ml_independent_shadow':
      return 'shadow_only';
  }
}

function buildRunQualityGate(
  references: ProcessedCitation[],
  readiness: EvidenceModeSummary['readiness'],
  mlAttribution: MlAttribution,
): EvidenceSimpleGate {
  const emptyRendered = references.filter((reference) => !reference.renderedText?.trim()).length;
  const checks: EvidenceSimpleGate['checks'] = [
    {
      id: 'false_ready_zero',
      label: 'False-ready risk',
      status: readiness.falseReady === 0 ? 'pass' : 'fail',
      plainReason: readiness.falseReady === 0
        ? 'No ready citation is known to disagree with gold truth.'
        : `${readiness.falseReady} ready citation(s) disagree with gold truth.`,
      technicalReason: `falseReady=${readiness.falseReady}`,
    },
    {
      id: 'failed_zero',
      label: 'Failed citations',
      status: readiness.failed === 0 ? 'pass' : 'fail',
      plainReason: readiness.failed === 0
        ? 'No citations failed.'
        : `${readiness.failed} citation(s) failed.`,
      technicalReason: `failed=${readiness.failed}`,
    },
    {
      id: 'empty_rendered_zero',
      label: 'Rendered citations',
      status: emptyRendered === 0 ? 'pass' : 'fail',
      plainReason: emptyRendered === 0
        ? 'Every citation produced rendered text.'
        : `${emptyRendered} citation(s) produced empty rendered text.`,
      technicalReason: `emptyRendered=${emptyRendered}`,
    },
    {
      id: 'malformed_bio_accepted_zero',
      label: 'Malformed BIO accepted',
      status: mlAttribution.malformedBioAccepted === 0 ? 'pass' : 'fail',
      plainReason: mlAttribution.malformedBioAccepted === 0
        ? 'No malformed BIO output was accepted.'
        : `${mlAttribution.malformedBioAccepted} malformed BIO output(s) were accepted.`,
      technicalReason: `malformedBioAccepted=${mlAttribution.malformedBioAccepted}`,
    },
  ];
  const failed = checks.filter((check) => check.status === 'fail');
  return {
    status: failed.length === 0 ? 'pass' : 'fail',
    plainReason: failed.length === 0
      ? 'The run passed standalone safety checks.'
      : failed.map((check) => check.plainReason).join(' '),
    checks,
  };
}

function buildRunPerformanceGate(
  mode: EvidenceModeId,
  qualityGate: EvidenceSimpleGate,
): EvidenceSimpleGate {
  if (mode !== 'browser_site_default_current' && mode !== 'hybrid_current') {
    return {
      status: 'not_applicable',
      plainReason: 'Performance target is only judged on product-path lanes.',
      checks: [],
    };
  }
  return buildBrowserPerformanceGate(qualityGate, null);
}

function summarizeBioQuality(
  truthAvailable: boolean,
  bioMode: EvidencePolicySnapshot['bioExtraction'],
  attribution: BioAttribution,
  referenceCount: number,
): EvidenceBioQualitySummary {
  const refsWithBioOutput = attribution.entityEmitted > 0
    ? Math.min(referenceCount, attribution.entityEmitted)
    : 0;
  const bioBlockedUnsafeCount = attribution.blockedByDiagnostics
    + attribution.blockedByGrounding
    + attribution.blockedByNonRegressionGuard;
  const topRejectedReasons = {
    diagnostics: attribution.blockedByDiagnostics,
    malformed_sequence: attribution.blockedByMalformedSequence,
    overlapping_spans: attribution.blockedByOverlap,
    span_issue: attribution.blockedBySpanIssue,
    grounding: attribution.blockedByGrounding,
    non_regression_guard: attribution.blockedByNonRegressionGuard,
  };
  const bioNoOpCount = Math.max(
    0,
    referenceCount - attribution.patchAccepted - attribution.patchRejected,
  );
  const plainSummary = attribution.entityEmitted === 0
    ? 'BIO did not produce field evidence in this lane.'
    : `BIO emitted ${attribution.entityEmitted} entity span(s), accepted ${attribution.patchAccepted} change(s), rejected ${attribution.patchRejected} change(s), and accepted ${attribution.patchWorsenedGoldScore} harmful change(s).`;

  return {
    truthAvailable,
    bioWasActive: attribution.entityEmitted > 0 || bioMode !== 'off',
    bioMode,
    refsWithBioOutput,
    bioAcceptedChanges: attribution.patchAccepted,
    bioRejectedChanges: attribution.patchRejected,
    bioHelpedCount: attribution.patchImprovedGoldScore,
    bioHarmedAcceptedCount: attribution.patchWorsenedGoldScore,
    bioBlockedUnsafeCount,
    bioNoOpCount,
    topRejectedReasons: Object.fromEntries(
      Object.entries(topRejectedReasons).filter(([, count]) => count > 0),
    ),
    plainSummary,
  };
}

export function computeFieldScores(rows: ExpectedRow[], references: ProcessedCitation[]): Record<string, FieldScore> {
  const counts = new Map<string, { tp: number; fp: number; fn: number }>();
  rows.forEach((row, index) => {
    const reference = references[index];
    if (!reference) return;
    const expected = normalizeExpectedFields(row);
    const predicted = fieldsToComparable(reference);
    for (const field of new Set([...Object.keys(expected), ...Object.keys(predicted)])) {
      if (field === 'renderedText') continue;
      const expectedValue = expected[field];
      const predictedValue = predicted[field];
      const current = counts.get(field) ?? { tp: 0, fp: 0, fn: 0 };
      const expectedHasValue = hasComparableValue(expectedValue);
      const predictedHasValue = hasComparableValue(predictedValue);
      if (expectedHasValue && compareField(field, predictedValue, expectedValue, 'soft', row.rawText)) {
        current.tp += 1;
      } else {
        if (predictedHasValue) current.fp += 1;
        if (expectedHasValue) current.fn += 1;
      }
      counts.set(field, current);
    }
  });

  return Object.fromEntries([...counts.entries()].map(([field, count]) => [field, score(count)]));
}

function summarizeReadiness(rows: ExpectedRow[], references: ProcessedCitation[]): EvidenceModeSummary['readiness'] {
  let falseReady = 0;
  let falseActionNeeded = 0;
  references.forEach((reference, index) => {
    const row = rows[index];
    if (!row || Object.keys(row.expectedFields).length === 0) return;
    const goldErrors = countGoldFieldErrors(row, reference);
    if (reference.publicStatus === 'ready' && goldErrors > 0) falseReady += 1;
    if (reference.publicStatus === 'needs_action' && goldErrors === 0) falseActionNeeded += 1;
  });
  return {
    ready: references.filter((reference) => reference.publicStatus === 'ready').length,
    needsReview: references.filter((reference) => reference.publicStatus === 'needs_review').length,
    needsAction: references.filter((reference) => reference.publicStatus === 'needs_action').length,
    failed: references.filter((reference) => reference.status === 'error').length,
    falseReady,
    falseActionNeeded,
  };
}

export function summarizeHealthHotspotAudit(references: ProcessedCitation[]): EvidenceHealthHotspotAudit {
  const topCauses: Record<string, number> = {};
  const examples: EvidenceHealthHotspotAudit['examples'] = [];
  let visibleReasons = 0;

  for (const reference of references) {
    if (reference.publicStatus !== 'needs_action') continue;
    const reason = firstHealthReason(reference);
    const visibleHotspotId = visibleHotspotForReference(reference);
    const cause = reason.technicalReason;
    topCauses[cause] = (topCauses[cause] ?? 0) + 1;
    if (visibleHotspotId) visibleReasons += 1;
    if (!visibleHotspotId && examples.length < 10) {
      examples.push({
        index: reference.index,
        rawPreview: preview(reference.raw),
        plainReason: reason.plainReason,
        technicalReason: reason.technicalReason,
        visibleHotspotId,
      });
    }
  }

  const needsAction = references.filter((reference) => reference.publicStatus === 'needs_action').length;
  const needsActionWithoutVisibleReason = Math.max(0, needsAction - visibleReasons);
  return {
    needsAction,
    visibleReasons,
    needsActionWithoutVisibleReason,
    topCauses,
    plainSummary: needsAction === 0
      ? 'No action-needed citations were reported.'
      : `${needsAction} citation(s) need action; ${visibleReasons} have visible reasons and ${needsActionWithoutVisibleReason} need hotspot investigation.`,
    examples,
  };
}

function firstHealthReason(reference: ProcessedCitation): {
  plainReason: string;
  technicalReason: string;
} {
  const warning = reference.healthWarnings[0];
  if (warning) {
    return {
      plainReason: warning.message || warning.code.replace(/_/gu, ' '),
      technicalReason: warning.code,
    };
  }
  const reason = reference.healthReasons.find((entry) => entry.trim());
  if (reason) {
    return {
      plainReason: reason,
      technicalReason: normalizeComparableText(reason).replace(/\s+/gu, '_') || 'health_reason',
    };
  }
  const error = reference.error;
  if (error) {
    return {
      plainReason: error.message,
      technicalReason: error.code || error.phase || 'reference_error',
    };
  }
  return {
    plainReason: 'Needs action but no explicit health reason was exposed.',
    technicalReason: 'missing_visible_health_reason',
  };
}

function visibleHotspotForReference(reference: ProcessedCitation): string | null {
  if (reference.healthWarnings.length > 0) return `health:${reference.healthWarnings[0]!.code}`;
  if (reference.healthReasons.length > 0) return 'health:reason';
  if (reference.error) return `error:${reference.error.code || reference.error.phase}`;
  if (reference.stageLog.some((entry) => entry.status === 'error' || entry.status === 'warning')) {
    const entry = reference.stageLog.find((record) => record.status === 'error' || record.status === 'warning');
    return entry ? `stage:${entry.stageId}` : 'stage:warning';
  }
  if (reference.isDuplicateCandidate) return 'dedupe:duplicate_candidate';
  return null;
}

export function summarizeBioAttribution(rows: ExpectedRow[], references: ProcessedCitation[]): BioAttribution {
  const attribution: BioAttribution = {
    entityEmitted: 0,
    entityStructurallyValid: 0,
    entityGrounded: 0,
    fieldCandidateProduced: 0,
    patchAttempted: 0,
    patchAccepted: 0,
    patchRejected: 0,
    patchImprovedGoldScore: 0,
    patchWorsenedGoldScore: 0,
    patchNoOp: 0,
    blockedByDiagnostics: 0,
    blockedByMalformedSequence: 0,
    blockedByOverlap: 0,
    blockedBySpanIssue: 0,
    blockedByGrounding: 0,
    blockedByNonRegressionGuard: 0,
    missingRequiredMlSpanWarnings: 0,
    byLabel: {},
  };

  references.forEach((reference, index) => {
    const row = rows[index];
    const bio = reference.extractionMeta?.bio;
    if (!bio) return;
    const diagnosticCodes = new Set(bio.diagnostics.map((diagnostic) => diagnostic.code));
    if (diagnosticCodes.size > 0) attribution.blockedByDiagnostics += 1;
    if (diagnosticCodes.has('unclosed_bio_sequence')) attribution.blockedByMalformedSequence += 1;
    if (diagnosticCodes.has('overlapping_spans')) attribution.blockedByOverlap += 1;
    if ([...diagnosticCodes].some((code) => code.includes('span') || code.includes('offset'))) {
      attribution.blockedBySpanIssue += 1;
    }
    if (reference.healthWarnings.some((warning) => warning.code === 'missing_required_ml_span')) {
      attribution.missingRequiredMlSpanWarnings += 1;
    }

    const fields = new Set<string>();
    for (const entity of bio.entities) {
      attribution.entityEmitted += 1;
      fields.add(entity.field);
      const bucket = attribution.byLabel[entity.label] ?? { entities: 0, invalid: 0, diagnostics: 0 };
      bucket.entities += 1;
      if (!entity.valid) bucket.invalid += 1;
      bucket.diagnostics += entity.diagnostics?.length ?? 0;
      attribution.byLabel[entity.label] = bucket;
      if (entity.valid) attribution.entityStructurallyValid += 1;
      if (reference.raw.includes(entity.text)) attribution.entityGrounded += 1;
      else attribution.blockedByGrounding += 1;
    }
    attribution.fieldCandidateProduced += fields.size;

    const diff = reference.extractionMeta?.shadowDiff;
    if (diff) {
      const changedFields = Object.entries(diff.perFieldDiff).filter(([, status]) => status !== 'same');
      attribution.patchAttempted += changedFields.length;
      attribution.patchAccepted += reference.extractionMeta?.runMode === 'ml' ? changedFields.length : 0;
      attribution.patchRejected += reference.extractionMeta?.runMode === 'ml' ? 0 : changedFields.length;
      attribution.blockedByNonRegressionGuard += reference.extractionMeta?.runMode === 'heuristic' ? changedFields.length : 0;

      if (row && Object.keys(row.expectedFields).length > 0) {
        for (const [field] of changedFields) {
          const before = compareField(field, diff.baselineFields[field], normalizeExpectedFields(row)[field], 'soft', row.rawText);
          const after = compareField(field, diff.mlFields[field], normalizeExpectedFields(row)[field], 'soft', row.rawText);
          if (!before && after) attribution.patchImprovedGoldScore += 1;
          else if (before && !after) attribution.patchWorsenedGoldScore += 1;
          else attribution.patchNoOp += 1;
        }
      } else {
        attribution.patchNoOp += changedFields.length;
      }
    }
  });

  return attribution;
}

function summarizeMlAttribution(
  rows: ExpectedRow[],
  references: ProcessedCitation[],
  bio: BioAttribution,
): MlAttribution {
  const withMeta = references.filter((reference) => reference.extractionMeta);
  const attempted = withMeta.filter((reference) => reference.extractionMeta?.runMode !== 'heuristic' || reference.extractionMeta?.shadowDiff);
  const accepted = withMeta.filter((reference) => reference.extractionMeta?.runMode === 'ml');
  const rejected = attempted.length - accepted.length;
  const improved = bio.patchImprovedGoldScore;
  const worsened = bio.patchWorsenedGoldScore;
  return {
    eligibleRefs: references.length,
    routedRefs: withMeta.length,
    attemptedRefs: attempted.length,
    abstainedRefs: Math.max(0, references.length - attempted.length),
    acceptedRefs: accepted.length,
    rejectedRefs: Math.max(0, rejected),
    noOpRefs: attempted.filter((reference) =>
      !reference.extractionMeta?.shadowDiff
      || Object.values(reference.extractionMeta.shadowDiff.perFieldDiff).every((status) => status === 'same')
    ).length,
    rawMlOutputRefs: attempted.length,
    afterStructuralGuardsRefs: attempted.filter((reference) =>
      !(reference.extractionMeta?.bio?.diagnostics ?? []).some((diagnostic) =>
        diagnostic.code === 'unclosed_bio_sequence'
        || diagnostic.code === 'overlapping_spans'
      )
    ).length,
    afterGroundingGuardsRefs: attempted.filter((reference) =>
      (reference.extractionMeta?.bio?.entities ?? []).every((entity) => reference.raw.includes(entity.text))
    ).length,
    afterNonRegressionGuardsRefs: Math.max(0, attempted.length - worsened),
    finalHybridRefs: references.length,
    malformedBioAccepted: accepted.filter((reference) =>
      (reference.extractionMeta?.bio?.diagnostics ?? []).some((diagnostic) =>
        diagnostic.code === 'unclosed_bio_sequence'
        || diagnostic.code === 'overlapping_spans'
      )
    ).length,
    acceptedPatchPrecision: improved + worsened > 0 ? round(improved / (improved + worsened), 4) : 0,
  };
}

export function computeDuplicateEvaluation(
  rows: ExpectedRow[],
  response: ConvertResponse,
  truthAvailable: boolean,
): {
  metrics: EvidenceModeSummary['duplicateMetrics'];
  audit: EvidenceDuplicateAudit;
} {
  const expectedKeys = rows.map(expectedDuplicateKey);
  const expectedPairs = pairSetFromKeys(expectedKeys);
  const expectedClusters = expectedDuplicateClusters(expectedKeys);
  const idToIndex = new Map(response.references.map((reference, index) => [reference.id, index]));
  const predictedPairs = new Set<string>();
  const causeCounts: Record<string, number> = {};
  const falsePositiveByMethod: Record<string, number> = {};
  let falseDuplicateGroups = 0;
  let largestBadCluster = 0;
  let likelyCorrectGroups = 0;
  const matchedExpectedClusterKeys = new Set<string>();
  const falseDuplicateExamples: EvidenceDuplicateAudit['falseDuplicateExamples'] = [];

  for (const group of response.duplicateGroups) {
    causeCounts[group.method] = (causeCounts[group.method] ?? 0) + 1;
    const indices = group.memberIds
      .map((id) => idToIndex.get(id))
      .filter((index): index is number => index != null)
      .sort((left, right) => left - right);
    let groupFalsePairs = 0;
    let groupPairCount = 0;
    for (let left = 0; left < indices.length; left += 1) {
      for (let right = left + 1; right < indices.length; right += 1) {
        const key = pairKey(indices[left]!, indices[right]!);
        groupPairCount += 1;
        predictedPairs.add(key);
        if (!expectedPairs.has(key)) groupFalsePairs += 1;
      }
    }
    if (groupFalsePairs > 0) {
      falseDuplicateGroups += 1;
      falsePositiveByMethod[group.method] = (falsePositiveByMethod[group.method] ?? 0) + 1;
      largestBadCluster = Math.max(largestBadCluster, indices.length);
      if (falseDuplicateExamples.length < 8) {
        falseDuplicateExamples.push({
          groupId: group.groupId,
          method: group.method,
          clusterSize: indices.length,
          rawPreviews: indices.slice(0, 4).map((index) => preview(rows[index]?.rawText ?? response.references[index]?.raw ?? '')),
        });
      }
    } else if (groupPairCount > 0) {
      likelyCorrectGroups += 1;
      const clusterKey = commonExpectedDuplicateKey(indices, expectedKeys);
      if (clusterKey) matchedExpectedClusterKeys.add(clusterKey);
    }
  }

  const tp = [...predictedPairs].filter((pair) => expectedPairs.has(pair)).length;
  const fp = predictedPairs.size - tp;
  const fn = [...expectedPairs].filter((pair) => !predictedPairs.has(pair)).length;
  const expectedClusterCount = expectedClusters.size;
  const clusterPrecision = response.duplicateGroups.length > 0
    ? round(likelyCorrectGroups / response.duplicateGroups.length, 4)
    : 0;
  const clusterRecall = expectedClusterCount > 0
    ? round(matchedExpectedClusterKeys.size / expectedClusterCount, 4)
    : 0;
  const missedDuplicateExamples: EvidenceDuplicateAudit['missedDuplicateExamples'] = [...expectedPairs]
    .filter((pair) => !predictedPairs.has(pair))
    .slice(0, 8)
    .map((pair) => {
      const [leftRaw, rightRaw] = pair.split(':');
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      const expectedKey = expectedKeys[left] ?? expectedKeys[right] ?? 'unknown';
      return {
        pair,
        expectedKey,
        rawPreviews: [left, right].map((index) => preview(rows[index]?.rawText ?? response.references[index]?.raw ?? '')),
      };
    });
  const mainFalsePositiveCause = Object.entries(falsePositiveByMethod)
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  const metrics: EvidenceModeSummary['duplicateMetrics'] = {
    predictedGroups: response.duplicateGroups.length,
    predictedPairs: predictedPairs.size,
    expectedPairs: expectedPairs.size,
    pairPrecision: tp + fp > 0 ? round(tp / (tp + fp), 4) : 0,
    pairRecall: tp + fn > 0 ? round(tp / (tp + fn), 4) : 0,
    falseDuplicateGroups,
    missedDuplicatePairs: fn,
    largestBadCluster,
    causeCounts,
    clusterPrecision,
    clusterRecall,
  };

  const audit: EvidenceDuplicateAudit = {
    truthAvailable,
    candidateGroups: response.duplicateGroups.length,
    likelyCorrectGroups: truthAvailable ? likelyCorrectGroups : 0,
    needsReviewGroups: truthAvailable ? falseDuplicateGroups : response.duplicateGroups.length,
    likelyFalsePositiveGroups: truthAvailable ? falseDuplicateGroups : 0,
    mainFalsePositiveCause,
    pairPrecision: metrics.pairPrecision,
    pairRecall: metrics.pairRecall,
    clusterPrecision,
    clusterRecall,
    falsePositiveByMethod,
    plainSummary: duplicateAuditSummary(truthAvailable, metrics, mainFalsePositiveCause),
    falseDuplicateExamples,
    missedDuplicateExamples,
  };

  return { metrics, audit };
}

function buildComparisons(runResults: EvidenceModeRunResult[]): EvidenceComparison[] {
  const comparisons: EvidenceComparison[] = [];
  const modeRuns = runResults.map((result) => result.summary);
  for (const run of modeRuns) {
    if (run.mode === 'heuristics_only') continue;
    const candidateResult = runResults.find((result) => result.summary === run);
    const baselineResult = runResults.find((candidate) =>
      candidate.summary.datasetId === run.datasetId
      && candidate.summary.mode === 'heuristics_only'
    );
    if (!baselineResult || !candidateResult) continue;
    const baseline = baselineResult.summary;
    const transitionKey = `${statusLabel(baseline.readiness)}->${statusLabel(run.readiness)}`;
    const criticalFieldLossCount = countCriticalFieldScoreLosses(baseline.fieldScores, run.fieldScores);
    const regressed = run.regressionExamples.length;
    const improved = Math.max(0, run.summary.ready - baseline.summary.ready);
    const fieldDiffExamples = buildFieldDiffExamples(
      run.mode,
      baselineResult.rows,
      baselineResult.references,
      candidateResult.references,
    );
    const typeMlEvaluation = buildTypeMlEvaluation(
      baselineResult.rows,
      baselineResult.references,
      candidateResult.references,
    );
    const qualityGate = buildComparisonQualityGate(baseline, run, criticalFieldLossCount);
    const performanceGate = buildComparisonPerformanceGate(run, qualityGate);
    comparisons.push({
      datasetId: run.datasetId,
      candidateMode: run.mode,
      baselineMode: baseline.mode,
      readinessTransitions: {
        [transitionKey]: run.referenceCount,
        'heuristic_ready->candidate_ready': Math.min(baseline.summary.ready, run.summary.ready),
        'heuristic_ready->candidate_non_ready': Math.max(0, baseline.summary.ready - run.summary.ready),
        'heuristic_non_ready->candidate_ready': Math.max(0, run.summary.ready - baseline.summary.ready),
      },
      criticalFieldLossCount,
      wrongOverwriteCount: run.regressionExamples.filter((example) => example.kind === 'wrong_overwrite').length,
      improved,
      regressed,
      unchangedCorrect: Math.max(0, run.referenceCount - improved - regressed),
      unchangedWrong: 0,
      noOp: run.mlAttribution.noOpRefs,
      newFalsePositive: run.readiness.falseReady - baseline.readiness.falseReady,
      newFalseNegative: run.readiness.falseActionNeeded - baseline.readiness.falseActionNeeded,
      examples: run.regressionExamples.slice(0, 25),
      fieldDiffExamples,
      typeMlEvaluation,
      qualityGate,
      performanceGate,
    });
  }
  return comparisons;
}

export function buildTypeMlEvaluation(
  rows: ExpectedRow[],
  baselineReferences: ProcessedCitation[],
  candidateReferences: ProcessedCitation[],
): EvidenceTypeMlEvaluation {
  let helped = 0;
  let hurtIfAccepted = 0;
  let noDifference = 0;
  let heuristicCorrectMlWrong = 0;
  let heuristicWrongMlCorrect = 0;
  let finalTypeChanges = 0;
  let renderedChangedWithTypeChange = 0;
  let healthImpactCount = 0;
  const examples: EvidenceTypeMlEvaluation['examples'] = [];
  const truthAvailable = rows.some((row) => Boolean(row.expectedType));

  rows.forEach((row, index) => {
    const baseline = baselineReferences[index];
    const candidate = candidateReferences[index];
    if (!baseline || !candidate) return;
    const goldType = row.expectedType ?? null;
    const heuristicType = baseline.referenceType;
    const mlType = candidate.referenceType;
    const changedType = heuristicType !== mlType;
    const renderedTextDelta = baseline.renderedText === candidate.renderedText ? 'same' : 'changed';
    const healthImpact = `${baseline.publicStatus}->${candidate.publicStatus}`;
    if (!changedType) {
      noDifference += 1;
      return;
    }

    finalTypeChanges += 1;
    if (renderedTextDelta === 'changed') renderedChangedWithTypeChange += 1;
    if (baseline.publicStatus !== candidate.publicStatus) healthImpactCount += 1;

    const heuristicCorrect = Boolean(goldType) && heuristicType === goldType;
    const mlCorrect = Boolean(goldType) && mlType === goldType;
    let outcome: EvidenceTypeMlEvaluation['examples'][number]['outcome'] = truthAvailable
      ? 'needs_investigation'
      : 'needs_investigation';
    if (heuristicCorrect && !mlCorrect) {
      hurtIfAccepted += 1;
      heuristicCorrectMlWrong += 1;
      outcome = 'hurt';
    } else if (!heuristicCorrect && mlCorrect) {
      helped += 1;
      heuristicWrongMlCorrect += 1;
      outcome = 'helped';
    } else if (heuristicCorrect === mlCorrect) {
      noDifference += 1;
      outcome = 'same';
    }

    if (examples.length < 12) {
      examples.push({
        index: candidate.index,
        rawPreview: preview(candidate.raw),
        heuristicType,
        mlType,
        goldType,
        finalType: candidate.referenceType,
        outcome,
        healthImpact,
        renderedTextDelta,
      });
    }
  });

  const recommendation: EvidenceTypeMlEvaluation['recommendation'] = !truthAvailable
    ? 'insufficient_truth'
    : hurtIfAccepted > 0 || heuristicCorrectMlWrong > 0
      ? 'keep_shadow'
      : helped > 0
        ? 'test_guarded_override'
        : 'keep_shadow';

  return {
    truthAvailable,
    helped,
    hurtIfAccepted,
    noDifference,
    heuristicCorrectMlWrong,
    heuristicWrongMlCorrect,
    finalTypeChanges,
    renderedChangedWithTypeChange,
    healthImpactCount,
    recommendation,
    plainSummary: typeMlPlainSummary(truthAvailable, helped, hurtIfAccepted, noDifference, recommendation),
    examples,
  };
}

function typeMlPlainSummary(
  truthAvailable: boolean,
  helped: number,
  hurtIfAccepted: number,
  noDifference: number,
  recommendation: EvidenceTypeMlEvaluation['recommendation'],
): string {
  if (!truthAvailable) return 'Type ML was compared, but this dataset has no gold type labels.';
  const recommendationText = recommendation === 'test_guarded_override'
    ? 'safe to test as a guarded override'
    : 'keep shadow-only for now';
  return `Type ML helped ${helped} reference(s), hurt ${hurtIfAccepted} if accepted, and made no useful difference on ${noDifference}. Recommendation: ${recommendationText}.`;
}

function buildComparisonQualityGate(
  baseline: EvidenceModeSummary,
  candidate: EvidenceModeSummary,
  criticalFieldLossCount: number,
): EvidenceSimpleGate {
  const readyLost = Math.max(0, baseline.summary.ready - candidate.summary.ready);
  const falseReadyIncrease = candidate.readiness.falseReady - baseline.readiness.falseReady;
  const failedIncrease = candidate.readiness.failed - baseline.readiness.failed;
  const wrongOverwriteCount = candidate.regressionExamples.filter((example) => example.kind === 'wrong_overwrite').length;
  const checks: EvidenceSimpleGate['checks'] = [
    {
      id: 'ready_not_lower',
      label: 'Ready citations',
      status: readyLost === 0 ? 'pass' : 'fail',
      plainReason: readyLost === 0
        ? 'Ready citation count did not decrease.'
        : `${readyLost} citation(s) stopped being ready.`,
      technicalReason: `baselineReady=${baseline.summary.ready}; candidateReady=${candidate.summary.ready}`,
    },
    {
      id: 'critical_fields_not_lost',
      label: 'Critical fields',
      status: criticalFieldLossCount === 0 ? 'pass' : 'fail',
      plainReason: criticalFieldLossCount === 0
        ? 'No critical field loss was detected.'
        : `${criticalFieldLossCount} critical field loss signal(s) were detected.`,
      technicalReason: `criticalFieldLossCount=${criticalFieldLossCount}`,
    },
    {
      id: 'wrong_overwrites_zero',
      label: 'Wrong overwrites',
      status: wrongOverwriteCount === 0 ? 'pass' : 'fail',
      plainReason: wrongOverwriteCount === 0
        ? 'No known-correct heuristic field was overwritten incorrectly.'
        : `${wrongOverwriteCount} known-correct heuristic field(s) were overwritten incorrectly.`,
      technicalReason: `wrongOverwriteCount=${wrongOverwriteCount}`,
    },
    {
      id: 'false_ready_not_higher',
      label: 'False-ready risk',
      status: falseReadyIncrease <= 0 ? 'pass' : 'fail',
      plainReason: falseReadyIncrease <= 0
        ? 'False-ready risk did not increase.'
        : `False-ready risk increased by ${falseReadyIncrease}.`,
      technicalReason: `baselineFalseReady=${baseline.readiness.falseReady}; candidateFalseReady=${candidate.readiness.falseReady}`,
    },
    {
      id: 'failed_not_higher',
      label: 'Failed citations',
      status: failedIncrease <= 0 ? 'pass' : 'fail',
      plainReason: failedIncrease <= 0
        ? 'Failed citation count did not increase.'
        : `Failed citation count increased by ${failedIncrease}.`,
      technicalReason: `baselineFailed=${baseline.readiness.failed}; candidateFailed=${candidate.readiness.failed}`,
    },
    {
      id: 'malformed_bio_accepted_zero',
      label: 'Malformed BIO accepted',
      status: candidate.mlAttribution.malformedBioAccepted === 0 ? 'pass' : 'fail',
      plainReason: candidate.mlAttribution.malformedBioAccepted === 0
        ? 'No malformed BIO output was accepted.'
        : `${candidate.mlAttribution.malformedBioAccepted} malformed BIO output(s) were accepted.`,
      technicalReason: `malformedBioAccepted=${candidate.mlAttribution.malformedBioAccepted}`,
    },
  ];
  const failed = checks.filter((check) => check.status === 'fail');
  return {
    status: failed.length === 0 ? 'pass' : 'fail',
    plainReason: failed.length === 0
      ? 'Candidate did not degrade the heuristic baseline on the core safety checks.'
      : failed.map((check) => check.plainReason).join(' '),
    checks,
  };
}

function buildComparisonPerformanceGate(
  candidate: EvidenceModeSummary,
  qualityGate: EvidenceSimpleGate,
): EvidenceSimpleGate {
  if (candidate.layer !== 'product_path') {
    return {
      status: 'not_applicable',
      plainReason: 'Performance target is not judged on component-only lanes.',
      checks: [],
    };
  }
  return buildBrowserPerformanceGate(
    qualityGate,
    candidate.throughputLanes.browserAllRenderedRefsPerSecond,
  );
}

function buildFieldDiffExamples(
  mode: EvidenceModeId,
  rows: ExpectedRow[],
  baselineReferences: ProcessedCitation[],
  candidateReferences: ProcessedCitation[],
): EvidenceFieldDiffExample[] {
  const examples: EvidenceFieldDiffExample[] = [];
  rows.forEach((row, index) => {
    const baseline = baselineReferences[index];
    const candidate = candidateReferences[index];
    if (!baseline || !candidate) return;
    const expected = normalizeExpectedFields(row);
    const baselineFields = fieldsToComparable(baseline);
    const candidateFields = fieldsToComparable(candidate);
    const fields = new Set([
      ...CRITICAL_FIELDS,
      ...Object.keys(expected),
      ...Object.keys(baselineFields),
      ...Object.keys(candidateFields),
    ]);

    for (const field of fields) {
      const heuristicValue = baselineFields[field] ?? null;
      const candidateValue = candidateFields[field] ?? null;
      const goldValue = expected[field] ?? null;
      const hasGold = hasComparableValue(goldValue);
      const changed = !sameComparableValue(field, heuristicValue, candidateValue, row.rawText);
      const baselineCorrect = hasGold && compareField(field, heuristicValue, goldValue, 'soft', row.rawText);
      const candidateCorrect = hasGold && compareField(field, candidateValue, goldValue, 'soft', row.rawText);

      if (!changed && baselineCorrect === candidateCorrect) continue;

      const outcome: EvidenceFieldDiffExample['outcome'] = hasGold
        ? !baselineCorrect && candidateCorrect
          ? 'helped'
          : baselineCorrect && !candidateCorrect
            ? 'worsened'
            : 'unchanged'
        : 'needs_investigation';
      const rejectedReason = inferRejectedReason(field, candidate);
      examples.push({
        index: candidate.index,
        rawPreview: preview(candidate.raw),
        field,
        outcome,
        adminSummary: fieldDiffAdminSummary(field, outcome, rejectedReason),
        heuristicValue,
        rawMlValue: mode === 'raw_ml_independent_shadow' ? candidateValue : null,
        rawBioValue: mode === 'raw_bio_shadow' ? candidateValue : null,
        guardedBioValue: mode === 'guarded_bio_shadow' || mode === 'hybrid_with_bio_candidate_shadow'
          ? candidateValue
          : null,
        hybridFinalValue: mode === 'hybrid_current' || mode === 'browser_site_default_current' || mode === 'hybrid_with_bio_candidate_shadow'
          ? candidateValue
          : null,
        goldValue,
        acceptedSource: sourceForField(field, candidate),
        rejectedReason,
        readinessDelta: `${baseline.publicStatus}->${candidate.publicStatus}`,
        renderedTextDelta: baseline.renderedText === candidate.renderedText ? 'same' : 'changed',
      });
    }
  });

  return examples
    .sort((left, right) => outcomePriority(left.outcome) - outcomePriority(right.outcome))
    .slice(0, 25);
}

function inferRejectedReason(field: string, reference: ProcessedCitation): string | null {
  const diagnostics = reference.extractionMeta?.bio?.diagnostics ?? [];
  if (diagnostics.some((diagnostic) => diagnostic.code === 'unclosed_bio_sequence')) return 'blocked_by_malformed_bio_sequence';
  if (diagnostics.some((diagnostic) => diagnostic.code === 'overlapping_spans')) return 'blocked_by_overlapping_bio_spans';
  if (diagnostics.length > 0) return 'blocked_by_bio_diagnostics';
  const shadowDiff = reference.extractionMeta?.shadowDiff;
  const perFieldDiff = shadowDiff?.perFieldDiff as Record<string, unknown> | undefined;
  if (perFieldDiff?.[field] && reference.extractionMeta?.runMode === 'heuristic') {
    return 'non_regression_guard_kept_heuristic';
  }
  return null;
}

function fieldDiffAdminSummary(
  field: string,
  outcome: EvidenceFieldDiffExample['outcome'],
  rejectedReason: string | null,
): string {
  if (outcome === 'helped') return `${field} improved against gold truth.`;
  if (outcome === 'worsened') return `${field} regressed against gold truth.`;
  if (rejectedReason) return `${field} change was blocked: ${rejectedReason.replace(/_/gu, ' ')}.`;
  if (outcome === 'needs_investigation') return `${field} changed without gold truth, so it needs review.`;
  return `${field} changed but did not improve or worsen the gold match.`;
}

function outcomePriority(outcome: EvidenceFieldDiffExample['outcome']): number {
  switch (outcome) {
    case 'worsened':
      return 0;
    case 'needs_investigation':
      return 1;
    case 'helped':
      return 2;
    case 'unchanged':
      return 3;
  }
}

function sourceForField(field: string, reference: ProcessedCitation): string | null {
  if (field === 'referenceType') return 'type_classifier_or_router';
  if (field === 'renderedText') return 'renderer';
  const fields = reference.fields as unknown as Record<string, { source?: string } | undefined>;
  return fields[field]?.source ?? null;
}

function sameComparableValue(field: string, left: unknown, right: unknown, rawText: string): boolean {
  if (!hasComparableValue(left) && !hasComparableValue(right)) return true;
  return compareField(field, left, right, 'soft', rawText);
}

export function evaluateDecisionGates(
  modeRuns: EvidenceModeSummary[],
  comparisons: EvidenceComparison[],
): EvidenceDecisionGates {
  const goldBaseline = modeRuns.find((run) => run.datasetId === 'gold_style_core' && run.mode === 'heuristics_only');
  const goldHybrid = modeRuns.find((run) => run.datasetId === 'gold_style_core' && run.mode === 'hybrid_with_bio_candidate_shadow');
  if (!goldBaseline || !goldHybrid) {
    return {
      status: 'insufficient_truth',
      checks: [{
        id: 'gold_truth_available',
        status: 'fail',
        message: 'Gold baseline and BIO candidate runs were not both available.',
      }],
    };
  }
  const candidateComparison = comparisons.find((comparison) =>
    comparison.datasetId === 'gold_style_core'
    && comparison.candidateMode === 'hybrid_with_bio_candidate_shadow'
  );
  const checks = [
    {
      id: 'ready_count_not_lower',
      status: goldHybrid.summary.ready >= goldBaseline.summary.ready ? 'pass' as const : 'fail' as const,
      message: `Candidate ready ${goldHybrid.summary.ready}; heuristic ready ${goldBaseline.summary.ready}.`,
    },
    {
      id: 'false_ready_not_higher',
      status: goldHybrid.readiness.falseReady <= goldBaseline.readiness.falseReady ? 'pass' as const : 'fail' as const,
      message: `Candidate false-ready ${goldHybrid.readiness.falseReady}; heuristic false-ready ${goldBaseline.readiness.falseReady}.`,
    },
    {
      id: 'critical_field_loss_zero',
      status: (candidateComparison?.criticalFieldLossCount ?? 0) === 0 ? 'pass' as const : 'fail' as const,
      message: `Critical field losses: ${candidateComparison?.criticalFieldLossCount ?? 0}.`,
    },
    {
      id: 'malformed_bio_accepted_zero',
      status: goldHybrid.mlAttribution.malformedBioAccepted === 0 ? 'pass' as const : 'fail' as const,
      message: `Malformed BIO accepted: ${goldHybrid.mlAttribution.malformedBioAccepted}.`,
    },
    {
      id: 'accepted_patch_precision',
      status: goldHybrid.mlAttribution.acceptedPatchPrecision === 0 || goldHybrid.mlAttribution.acceptedPatchPrecision >= 0.95
        ? 'pass' as const
        : 'fail' as const,
      message: `Accepted patch precision: ${goldHybrid.mlAttribution.acceptedPatchPrecision}.`,
    },
  ];

  return {
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks,
  };
}

function refreshReportDerivedFields(report: MlBioEvidenceReport): void {
  report.throughputSummary = buildThroughputSummary(report.modeRuns, report.decisionGates, report.browserTimings ?? []);
  report.bioPrimaryPromotionGate = buildBioPrimaryPromotionGate(
    report.modeRuns,
    report.comparisons,
    report.decisionGates,
    report.throughputSummary,
  );
  report.adminSummary = buildAdminSummary(
    report.modeRuns,
    report.comparisons,
    report.decisionGates,
    report.throughputSummary,
  );
  report.releaseReadiness = buildEvidenceBundle(
    report.modeRuns,
    report.comparisons,
    report.decisionGates,
    report.throughputSummary,
    report.bioPrimaryPromotionGate,
    report.datasets,
    report.browserTimings ?? [],
  );
  report.evidenceBundle = report.releaseReadiness;
  report.conclusions = buildConclusions(
    report.modeRuns,
    report.comparisons,
    report.decisionGates,
    report.bioPrimaryApplicability,
    report.throughputSummary,
  );
}

function selectBrowserTargetRun(modeRuns: EvidenceModeSummary[]): EvidenceModeSummary | undefined {
  return modeRuns.find((run) => run.mode === 'browser_site_default_current' && run.datasetId === 'pasted_input')
    ?? modeRuns.find((run) => run.mode === 'browser_site_default_current' && run.datasetId === 'current_500_workload')
    ?? modeRuns.find((run) => run.mode === 'browser_site_default_current');
}

function browserTimingPlainSummary(
  source: EvidenceBrowserTimingInput['source'],
  parsedReferenceCount: number,
  allRenderedMs: number,
): string {
  const sourceLabel = source === 'site_convert'
    ? 'site converter browser path'
    : 'admin evidence report browser path';
  return `${sourceLabel} rendered ${parsedReferenceCount} reference(s) in ${round(allRenderedMs)}ms.`;
}

export function buildThroughputSummary(
  modeRuns: EvidenceModeSummary[],
  decisionGates: EvidenceDecisionGates,
  browserTimings: EvidenceBrowserTiming[],
): EvidenceThroughputSummary {
  const targetRun = selectBrowserTargetRun(modeRuns);
  const browserTiming = browserTimings[0];
  const qualityValid = decisionGates.status === 'pass';
  const browserAllRendered = targetRun?.throughputLanes.browserAllRenderedRefsPerSecond ?? browserTiming?.allRenderedRefsPerSecond ?? null;
  const claimStatus: EvidenceThroughputSummary['claimStatus'] = !qualityValid
    ? 'quality_invalid'
    : browserAllRendered == null
      ? 'browser_not_measured'
      : browserAllRendered >= PRODUCT_PATH_TARGET_REFS_PER_SECOND
        ? 'browser_measured'
        : 'below_target';
  const plainSummary = throughputPlainSummary(claimStatus, targetRun, browserAllRendered);

  const baseRun = targetRun ?? modeRuns[0];
  const baseReferenceCount = baseRun?.referenceCount ?? browserTiming?.parsedReferenceCount ?? 0;
  const directReportRefsPerSecond = baseRun?.throughputLanes.directEnginePlusReportRefsPerSecond ?? null;
  const directReportWallMs = directReportRefsPerSecond && directReportRefsPerSecond > 0
    ? round(baseReferenceCount / directReportRefsPerSecond * 1000)
    : null;

  return {
    targetRefsPerSecond: PRODUCT_PATH_TARGET_REFS_PER_SECOND,
    claimStatus,
    plainSummary,
    lanes: [
      measuredLane({
        id: 'direct_engine',
        label: 'Direct engine',
        category: 'parser',
        run: baseRun,
        refsPerSecond: baseRun?.throughputLanes.directEngineRefsPerSecond ?? null,
        wallMs: baseRun?.wallClockMs ?? null,
        qualityGateStatus: baseRun?.qualityGate.status ?? decisionGates.status,
        performanceValid: Boolean(baseRun && baseRun.qualityGate.status !== 'fail'),
        whatThisNumberMeans: 'Parser execution inside the server process. This does not include route handling, queueing, network transfer, JSON parsing, or browser rendering.',
      }),
      measuredLane({
        id: 'direct_engine_plus_report',
        label: 'Direct engine + evidence report',
        category: 'parser',
        run: baseRun,
        refsPerSecond: directReportRefsPerSecond,
        wallMs: directReportWallMs,
        qualityGateStatus: baseRun?.qualityGate.status ?? decisionGates.status,
        performanceValid: Boolean(baseRun && baseRun.qualityGate.status !== 'fail'),
        whatThisNumberMeans: 'Direct server run plus report hashing, diffs, audits, and JSON preparation. This is still not a browser throughput claim.',
      }),
      missingLane('backend_convert_route', 'Backend convert route', 'backend', baseRun, 'The evidence runner has not yet replayed the normal /convert route as a measured lane.'),
      missingLane('queued_job_runtime', 'Queued job runtime', 'backend', baseRun, 'The evidence runner has not yet replayed the queued job path as a measured lane.'),
      browserLane({
        id: 'browser_submit_to_results',
        label: 'Browser submit to results',
        run: targetRun,
        timing: browserTiming,
        refsPerSecond: targetRun?.throughputLanes.browserSubmitToResultsRefsPerSecond ?? browserTiming?.submitToResultsRefsPerSecond ?? null,
        wallMs: browserTiming?.submitToResultsMs ?? null,
        whatThisNumberMeans: 'Elapsed browser time from admin submit to the returned report payload being available.',
      }),
      browserLane({
        id: 'browser_first_paint',
        label: 'Browser first paint',
        run: targetRun,
        timing: browserTiming,
        refsPerSecond: targetRun?.throughputLanes.browserFirstPaintRefsPerSecond ?? browserTiming?.firstPaintRefsPerSecond ?? null,
        wallMs: browserTiming?.firstPaintMs ?? null,
        whatThisNumberMeans: 'Elapsed browser time until the diagnostics page has had a frame to paint the returned report.',
      }),
      browserLane({
        id: 'browser_all_rendered',
        label: 'Browser all rendered',
        run: targetRun,
        timing: browserTiming,
        refsPerSecond: browserAllRendered,
        wallMs: browserTiming?.allRenderedMs ?? null,
        whatThisNumberMeans: 'Elapsed browser time until the diagnostics report has had a second frame to finish rendering visible report sections.',
      }),
    ],
  };
}

function throughputPlainSummary(
  claimStatus: EvidenceThroughputSummary['claimStatus'],
  run: EvidenceModeSummary | undefined,
  browserAllRendered: number | null,
): string {
  const direct = run?.throughputLanes.directEngineRefsPerSecond;
  if (claimStatus === 'quality_invalid') {
    return 'Speed is not counted because the quality gates failed.';
  }
  if (claimStatus === 'browser_not_measured') {
    return direct == null
      ? 'Browser throughput has not been measured yet.'
      : `Direct engine speed was ${direct} refs/sec, but browser throughput has not been measured yet.`;
  }
  if (claimStatus === 'below_target') {
    return `Browser all-rendered throughput was ${browserAllRendered} refs/sec; target is ${PRODUCT_PATH_TARGET_REFS_PER_SECOND}.`;
  }
  return `Browser all-rendered throughput was ${browserAllRendered} refs/sec and met the ${PRODUCT_PATH_TARGET_REFS_PER_SECOND} refs/sec target.`;
}

function measuredLane(input: {
  id: EvidenceThroughputLaneId;
  label: string;
  category: EvidenceThroughputLane['category'];
  run: EvidenceModeSummary | undefined;
  refsPerSecond: number | null;
  wallMs: number | null;
  qualityGateStatus: EvidenceThroughputLane['qualityGateStatus'];
  performanceValid: boolean;
  whatThisNumberMeans: string;
}): EvidenceThroughputLane {
  return {
    id: input.id,
    label: input.label,
    category: input.category,
    measured: input.refsPerSecond != null,
    inputReferenceCount: input.run?.referenceCount ?? 0,
    parsedReferenceCount: input.run?.referenceCount ?? 0,
    wallMs: input.wallMs,
    refsPerSecond: input.refsPerSecond,
    qualityGateStatus: input.qualityGateStatus,
    performanceValid: input.performanceValid,
    parseProfile: input.run?.parseProfile ?? null,
    runtimeProfile: input.run?.runtimeProfile ?? null,
    whatThisNumberMeans: input.whatThisNumberMeans,
  };
}

function missingLane(
  id: EvidenceThroughputLaneId,
  label: string,
  category: EvidenceThroughputLane['category'],
  run: EvidenceModeSummary | undefined,
  missingReason: string,
): EvidenceThroughputLane {
  return {
    id,
    label,
    category,
    measured: false,
    inputReferenceCount: run?.referenceCount ?? 0,
    parsedReferenceCount: run?.referenceCount ?? 0,
    wallMs: null,
    refsPerSecond: null,
    qualityGateStatus: 'not_applicable',
    performanceValid: false,
    parseProfile: run?.parseProfile ?? null,
    runtimeProfile: run?.runtimeProfile ?? null,
    whatThisNumberMeans: missingReason,
    missingReason,
  };
}

function browserLane(input: {
  id: EvidenceThroughputLaneId;
  label: string;
  run: EvidenceModeSummary | undefined;
  timing: EvidenceBrowserTiming | undefined;
  refsPerSecond: number | null;
  wallMs: number | null;
  whatThisNumberMeans: string;
}): EvidenceThroughputLane {
  const referenceCount = input.timing?.parsedReferenceCount ?? input.run?.referenceCount ?? 0;
  return {
    id: input.id,
    label: input.label,
    category: 'browser',
    measured: input.refsPerSecond != null,
    inputReferenceCount: input.timing?.inputReferenceCount ?? referenceCount,
    parsedReferenceCount: referenceCount,
    wallMs: input.wallMs,
    refsPerSecond: input.refsPerSecond,
    qualityGateStatus: input.run?.qualityGate.status ?? 'not_applicable',
    performanceValid: input.refsPerSecond != null && input.refsPerSecond >= PRODUCT_PATH_TARGET_REFS_PER_SECOND,
    parseProfile: input.run?.parseProfile ?? null,
    runtimeProfile: input.run?.runtimeProfile ?? null,
    whatThisNumberMeans: input.whatThisNumberMeans,
    ...(input.refsPerSecond == null ? { missingReason: 'No browser timing has been attached to this report yet.' } : {}),
  };
}

export function buildBioPrimaryPromotionGate(
  modeRuns: EvidenceModeSummary[],
  comparisons: EvidenceComparison[],
  decisionGates: EvidenceDecisionGates,
  throughputSummary: EvidenceThroughputSummary,
): BioPrimaryPromotionGate {
  const candidate = modeRuns.find((run) =>
    run.datasetId === 'gold_style_core'
    && run.mode === 'hybrid_with_bio_candidate_shadow'
  );
  const comparison = comparisons.find((item) =>
    item.datasetId === 'gold_style_core'
    && item.candidateMode === 'hybrid_with_bio_candidate_shadow'
  );
  const browserAllRendered = throughputSummary.lanes.find((lane) => lane.id === 'browser_all_rendered');
  const checks: BioPrimaryPromotionGate['checks'] = [
    {
      id: 'gold_decision_gates',
      label: 'Gold quality gates',
      status: decisionGates.status === 'pass'
        ? 'pass'
        : decisionGates.status === 'insufficient_truth'
          ? 'not_measured'
          : 'fail',
      plainReason: decisionGates.status === 'pass'
        ? 'Gold quality gates passed.'
        : decisionGates.status === 'insufficient_truth'
          ? 'Gold truth was not sufficient to evaluate promotion.'
          : 'One or more gold quality gates failed.',
    },
    {
      id: 'ready_count_preserved',
      label: 'Ready count preserved',
      status: decisionGates.checks.find((check) => check.id === 'ready_count_not_lower')?.status ?? 'not_measured',
      plainReason: decisionGates.checks.find((check) => check.id === 'ready_count_not_lower')?.message ?? 'Ready count was not measured.',
    },
    {
      id: 'critical_fields_preserved',
      label: 'Critical fields preserved',
      status: comparison
        ? comparison.criticalFieldLossCount === 0 ? 'pass' : 'fail'
        : 'not_measured',
      plainReason: comparison
        ? `Critical field losses: ${comparison.criticalFieldLossCount}.`
        : 'Critical field losses were not measured.',
    },
    {
      id: 'wrong_overwrites_zero',
      label: 'Wrong overwrites',
      status: comparison
        ? comparison.wrongOverwriteCount === 0 ? 'pass' : 'fail'
        : 'not_measured',
      plainReason: comparison
        ? `Wrong overwrites: ${comparison.wrongOverwriteCount}.`
        : 'Wrong overwrites were not measured.',
    },
    {
      id: 'accepted_patch_precision',
      label: 'Accepted patch precision',
      status: candidate
        ? candidate.mlAttribution.acceptedPatchPrecision === 0 || candidate.mlAttribution.acceptedPatchPrecision >= 0.95
          ? 'pass'
          : 'fail'
        : 'not_measured',
      plainReason: candidate
        ? `Accepted patch precision: ${candidate.mlAttribution.acceptedPatchPrecision}.`
        : 'Accepted patch precision was not measured.',
    },
    {
      id: 'browser_all_rendered_measured',
      label: 'Browser all-rendered measured',
      status: browserAllRendered?.refsPerSecond == null ? 'not_measured' : 'pass',
      plainReason: browserAllRendered?.refsPerSecond == null
        ? 'Browser all-rendered throughput has not been attached yet.'
        : `Browser all-rendered throughput: ${browserAllRendered.refsPerSecond} refs/sec.`,
    },
    {
      id: 'browser_all_rendered_target',
      label: 'Browser target',
      status: browserAllRendered?.refsPerSecond == null
        ? 'not_measured'
        : browserAllRendered.refsPerSecond >= PRODUCT_PATH_TARGET_REFS_PER_SECOND
          ? 'pass'
          : 'fail',
      plainReason: browserAllRendered?.refsPerSecond == null
        ? `Target is ${PRODUCT_PATH_TARGET_REFS_PER_SECOND} refs/sec, but browser all-rendered speed was not measured.`
        : `Browser all-rendered ${browserAllRendered.refsPerSecond} refs/sec; target ${PRODUCT_PATH_TARGET_REFS_PER_SECOND}.`,
    },
  ];

  const hasFail = checks.some((check) => check.status === 'fail');
  const hasNotMeasured = checks.some((check) => check.status === 'not_measured');
  const status: BioPrimaryPromotionGate['status'] = decisionGates.status === 'insufficient_truth'
    ? 'insufficient_truth'
    : hasFail
      ? 'blocked'
      : hasNotMeasured
        ? 'not_measured'
        : 'safe_candidate';

  return {
    status,
    plainSummary: bioPrimaryPromotionPlainSummary(status, candidate, comparison, browserAllRendered?.refsPerSecond ?? null),
    recommendation: bioPrimaryPromotionRecommendation(status),
    checks,
  };
}

function bioPrimaryPromotionPlainSummary(
  status: BioPrimaryPromotionGate['status'],
  candidate: EvidenceModeSummary | undefined,
  comparison: EvidenceComparison | undefined,
  browserAllRendered: number | null,
): string {
  if (status === 'insufficient_truth') return 'BIO-primary cannot be considered until certified gold truth is available in this run.';
  const helped = candidate?.bioQuality.bioHelpedCount ?? 0;
  const rejected = candidate?.bioQuality.bioRejectedChanges ?? 0;
  const regressions = comparison?.regressed ?? 0;
  if (status === 'safe_candidate') {
    return `BIO-primary shadow is safe to consider: helped ${helped}, rejected ${rejected}, regressions ${regressions}, browser ${browserAllRendered} refs/sec.`;
  }
  if (status === 'not_measured') {
    return `BIO-primary quality evidence is incomplete for promotion because browser all-rendered speed or a required quality check is not measured. Helped ${helped}; rejected ${rejected}; regressions ${regressions}.`;
  }
  return `BIO-primary is blocked: helped ${helped}, rejected ${rejected}, regressions ${regressions}. Fix failed gates before changing runtime behavior.`;
}

function bioPrimaryPromotionRecommendation(status: BioPrimaryPromotionGate['status']): string {
  switch (status) {
    case 'safe_candidate':
      return 'Review the field-level diffs, then open a separate promotion change with the same gates enforced at runtime.';
    case 'not_measured':
      return 'Run or attach browser all-rendered timing before considering BIO-primary promotion.';
    case 'insufficient_truth':
      return 'Run the report with certified gold truth before considering BIO-primary promotion.';
    case 'blocked':
    default:
      return 'Do not promote BIO-primary. Fix the failed quality or speed gates first.';
  }
}

export function buildBrowserPerformanceGate(
  qualityGate: EvidenceSimpleGate,
  browserAllRenderedRefsPerSecond: number | null,
): EvidenceSimpleGate {
  if (qualityGate.status === 'fail') {
    return {
      status: 'not_applicable',
      plainReason: 'Speed is not counted because quality failed.',
      checks: [],
    };
  }
  if (browserAllRenderedRefsPerSecond == null) {
    return {
      status: 'not_applicable',
      plainReason: 'Browser all-rendered throughput has not been measured for this report.',
      checks: [{
        id: 'browser_all_rendered_measured',
        label: 'Browser all-rendered measured',
        status: 'not_applicable',
        plainReason: 'No browser timing was attached.',
      }],
    };
  }
  const passed = browserAllRenderedRefsPerSecond >= PRODUCT_PATH_TARGET_REFS_PER_SECOND;
  return {
    status: passed ? 'pass' : 'fail',
    plainReason: passed
      ? `Browser all-rendered throughput met the ${PRODUCT_PATH_TARGET_REFS_PER_SECOND} refs/sec target.`
      : `Browser all-rendered throughput was ${browserAllRenderedRefsPerSecond} refs/sec, below the ${PRODUCT_PATH_TARGET_REFS_PER_SECOND} refs/sec target.`,
    checks: [{
      id: 'browser_all_rendered_target',
      label: 'Browser all-rendered target',
      status: passed ? 'pass' : 'fail',
      plainReason: `${browserAllRenderedRefsPerSecond} refs/sec measured; target is ${PRODUCT_PATH_TARGET_REFS_PER_SECOND}.`,
    }],
  };
}

export function buildEvidenceBundle(
  modeRuns: EvidenceModeSummary[],
  comparisons: EvidenceComparison[],
  decisionGates: EvidenceDecisionGates,
  throughputSummary: EvidenceThroughputSummary,
  bioPrimaryPromotionGate: BioPrimaryPromotionGate,
  datasets: EvidenceDatasetSummary[],
  browserTimings: EvidenceBrowserTiming[] = [],
): EvidenceBundleSummary {
  const quality = buildReleaseQualityCard(decisionGates, comparisons);
  const siteSpeed = buildReleaseSiteSpeedCard(quality, throughputSummary);
  const trainingData = buildReleaseTrainingDataCard(datasets);
  const safeRollout = buildReleaseSafeRolloutCard(quality, siteSpeed, trainingData, bioPrimaryPromotionGate);
  const cards = {
    quality,
    siteSpeed,
    trainingData,
    safeRollout,
  };
  const finalVerdict = releaseVerdictForCards(cards);
  const promotionAllowed = finalVerdict === 'ready_for_live_promotion';
  const topBlockingReasons = releaseBlockingReasons(cards);

  return {
    schemaVersion: 'parser_release_readiness.v1',
    title: 'Parser Release Readiness',
    finalVerdict,
    finalVerdictLabel: releaseVerdictLabel(finalVerdict),
    promotionAllowed,
    topBlockingReasons: topBlockingReasons.length > 0
      ? topBlockingReasons
      : ['All release readiness cards passed.'],
    cards,
    advanced: {
      decisionGateStatus: decisionGates.status,
      throughputClaimStatus: throughputSummary.claimStatus,
      bioPrimaryPromotionStatus: bioPrimaryPromotionGate.status,
      browserTimingCount: browserTimings.length,
      modeRunCount: modeRuns.length,
      comparisonCount: comparisons.length,
      datasetIds: datasets.map((dataset) => dataset.id),
      liveBehaviorChanged: false,
      hiddenTechnicalDetails: [
        'direct engine lane',
        'backend convert route lane',
        'queued job runtime lane',
        'BIO raw and guarded lanes',
        'field/entity metrics',
        'Phase 4 patch attribution',
        'health and duplicate audits',
        'field/render/semantic hashes',
      ],
    },
  };
}

function buildReleaseQualityCard(
  decisionGates: EvidenceDecisionGates,
  comparisons: EvidenceComparison[],
): EvidenceReadinessCard {
  const failedChecks = decisionGates.checks.filter((check) => check.status === 'fail');
  const criticalLosses = comparisons.reduce((sum, comparison) => sum + comparison.criticalFieldLossCount, 0);
  const wrongOverwrites = comparisons.reduce((sum, comparison) => sum + comparison.wrongOverwriteCount, 0);
  const status: EvidenceReadinessCardStatus = decisionGates.status === 'pass'
    ? 'pass'
    : decisionGates.status === 'insufficient_truth'
      ? 'not_measured'
      : 'fail';
  const blockingReasons = status === 'pass'
    ? []
    : failedChecks.length > 0
      ? failedChecks.map((check) => check.message)
      : ['Certified truth was not sufficient to evaluate parser quality.'];

  return {
    id: 'quality',
    label: 'Parsing Quality',
    question: 'Are parsed references still correct?',
    status,
    plainSummary: status === 'pass'
      ? 'Parsing quality gates passed against the measured truth sets.'
      : status === 'not_measured'
        ? 'Parsing quality cannot be approved until certified truth is available.'
        : 'Parsing quality regressed and must be fixed before promotion.',
    blockingReasons,
    advancedEvidence: [
      `decisionGateStatus=${decisionGates.status}`,
      `criticalFieldLosses=${criticalLosses}`,
      `wrongOverwrites=${wrongOverwrites}`,
      ...decisionGates.checks.map((check) => `${check.id}:${check.status}:${check.message}`),
    ],
  };
}

function buildReleaseSiteSpeedCard(
  quality: EvidenceReadinessCard,
  throughputSummary: EvidenceThroughputSummary,
): EvidenceReadinessCard {
  const status: EvidenceReadinessCardStatus = throughputSummary.claimStatus === 'browser_measured'
    ? 'pass'
    : throughputSummary.claimStatus === 'below_target'
      ? 'fail'
      : throughputSummary.claimStatus === 'quality_invalid' || quality.status === 'fail'
        ? 'blocked'
        : 'not_measured';
  const blockingReasons = status === 'pass'
    ? []
    : throughputSummary.claimStatus === 'browser_not_measured'
      ? ['Real site speed has not been measured.']
      : [throughputSummary.plainSummary];

  return {
    id: 'siteSpeed',
    label: 'Real Site Speed',
    question: 'How fast is the actual browser experience?',
    status,
    plainSummary: throughputSummary.plainSummary,
    blockingReasons,
    advancedEvidence: throughputSummary.lanes.map((lane) =>
      `${lane.id}:${lane.measured ? 'measured' : 'missing'}:${lane.refsPerSecond ?? 'not_measured'} refs/sec`
    ),
  };
}

function buildReleaseTrainingDataCard(datasets: EvidenceDatasetSummary[]): EvidenceReadinessCard {
  const truthRows = datasets
    .filter((dataset) => dataset.truthAvailable)
    .reduce((sum, dataset) => sum + dataset.rowCount, 0);
  const untrustedRows = datasets
    .filter((dataset) => !dataset.truthAvailable)
    .reduce((sum, dataset) => sum + dataset.rowCount, 0);

  return {
    id: 'trainingData',
    label: 'Training Data Health',
    question: 'Is the model trained on trusted, clean data?',
    status: 'not_measured',
    plainSummary: 'BIO training data health has not been audited yet, so live model promotion remains blocked.',
    blockingReasons: ['Training data audit has not been attached to this evidence bundle.'],
    advancedEvidence: [
      `truthRows=${truthRows}`,
      `nonTruthRows=${untrustedRows}`,
      'approvedRealSyntheticBreakdown=not_measured',
      'criticalFieldSpanLoss=not_measured',
      ...datasets.map((dataset) =>
        `${dataset.id}:rows=${dataset.rowCount}:truth=${dataset.truthAvailable}:sha256=${dataset.sha256}`
      ),
    ],
  };
}

function buildReleaseSafeRolloutCard(
  quality: EvidenceReadinessCard,
  siteSpeed: EvidenceReadinessCard,
  trainingData: EvidenceReadinessCard,
  bioPrimaryPromotionGate: BioPrimaryPromotionGate,
): EvidenceReadinessCard {
  const livePromotionMissing = siteSpeed.status !== 'pass' || trainingData.status !== 'pass';
  const status: EvidenceReadinessCardStatus = quality.status === 'fail' || quality.status === 'not_measured'
    ? 'blocked'
    : bioPrimaryPromotionGate.status === 'blocked'
      ? 'blocked'
      : livePromotionMissing || bioPrimaryPromotionGate.status !== 'safe_candidate'
        ? 'warning'
        : 'pass';
  const blockingReasons = status === 'pass'
    ? []
    : status === 'blocked'
      ? [bioPrimaryPromotionGate.plainSummary]
      : ['Live promotion is blocked until quality, real site speed, and training data health all pass.'];

  return {
    id: 'safeRollout',
    label: 'Safe Rollout',
    question: 'Can this be released without changing live behavior unsafely?',
    status,
    plainSummary: status === 'pass'
      ? 'All release gates passed. A separate promotion change can be reviewed.'
      : status === 'blocked'
        ? 'Safe rollout is blocked by failed or missing quality evidence.'
        : 'The candidate can stay in shadow evidence, but live promotion is not allowed yet.',
    blockingReasons,
    advancedEvidence: [
      `bioPrimaryPromotionStatus=${bioPrimaryPromotionGate.status}`,
      `promotionRecommendation=${bioPrimaryPromotionGate.recommendation}`,
      ...bioPrimaryPromotionGate.checks.map((check) => `${check.id}:${check.status}:${check.plainReason}`),
    ],
  };
}

function releaseVerdictForCards(cards: EvidenceBundleSummary['cards']): EvidenceReleaseVerdict {
  if (cards.quality.status !== 'pass' || cards.safeRollout.status === 'blocked') {
    return 'not_ready';
  }
  if (cards.quality.status === 'pass' && (cards.siteSpeed.status !== 'pass' || cards.trainingData.status !== 'pass')) {
    return 'ready_for_shadow_testing';
  }
  if (cards.safeRollout.status === 'warning') {
    return 'ready_for_limited_rollout';
  }
  return 'ready_for_live_promotion';
}

function releaseVerdictLabel(verdict: EvidenceReleaseVerdict): string {
  switch (verdict) {
    case 'ready_for_live_promotion':
      return 'Ready for live promotion';
    case 'ready_for_limited_rollout':
      return 'Ready for limited rollout';
    case 'ready_for_shadow_testing':
      return 'Ready for shadow testing';
    case 'not_ready':
    default:
      return 'Not ready';
  }
}

function releaseBlockingReasons(cards: EvidenceBundleSummary['cards']): string[] {
  return Object.values(cards)
    .filter((card) => card.status !== 'pass')
    .flatMap((card) => card.blockingReasons.map((reason) => `${card.label}: ${reason}`))
    .slice(0, 3);
}

function buildAdminSummary(
  modeRuns: EvidenceModeSummary[],
  comparisons: EvidenceComparison[],
  decisionGates: EvidenceDecisionGates,
  throughputSummary: EvidenceThroughputSummary,
): EvidenceAdminSummary {
  const browserRun = modeRuns.find((run) => run.mode === 'browser_site_default_current' && run.datasetId === 'pasted_input')
    ?? modeRuns.find((run) => run.mode === 'browser_site_default_current' && run.datasetId === 'current_500_workload')
    ?? modeRuns.find((run) => run.mode === 'browser_site_default_current');
  const bioCandidate = modeRuns.find((run) =>
    run.datasetId === 'gold_style_core'
    && run.mode === 'hybrid_with_bio_candidate_shadow'
  );
  const bioComparison = comparisons.find((comparison) =>
    comparison.datasetId === 'gold_style_core'
    && comparison.candidateMode === 'hybrid_with_bio_candidate_shadow'
  );
  const typeComparison = comparisons.find((comparison) =>
    comparison.datasetId === 'gold_style_core'
    && comparison.candidateMode === 'hybrid_with_bio_candidate_shadow'
  );
  const qualityStatus: EvidenceAdminSummary['qualityStatus'] = decisionGates.status === 'insufficient_truth'
    ? 'insufficient_truth'
    : decisionGates.status === 'pass'
      ? 'pass'
      : 'fail';
  const browserAllRenderedLane = throughputSummary.lanes.find((lane) => lane.id === 'browser_all_rendered');
  const browserAllRenderedRefsPerSecond = browserAllRenderedLane?.refsPerSecond ?? null;
  const performanceStatus: EvidenceAdminSummary['performanceStatus'] = qualityStatus !== 'pass'
    ? 'not_valid'
    : browserAllRenderedRefsPerSecond == null
      ? 'not_measured'
      : browserAllRenderedRefsPerSecond >= PRODUCT_PATH_TARGET_REFS_PER_SECOND
        ? 'pass'
        : 'fail';
  const overallStatus: EvidenceAdminSummary['overallStatus'] = qualityStatus === 'insufficient_truth'
    ? 'insufficient_truth'
    : qualityStatus === 'fail'
      ? 'fail'
      : performanceStatus === 'fail'
        ? 'needs_investigation'
        : 'pass';
  const topRisks = [
    ...(bioComparison && bioComparison.criticalFieldLossCount > 0
      ? [`BIO candidate has ${bioComparison.criticalFieldLossCount} critical field loss signal(s).`]
      : []),
    ...(bioComparison && bioComparison.wrongOverwriteCount > 0
      ? [`BIO candidate has ${bioComparison.wrongOverwriteCount} wrong overwrite(s).`]
      : []),
    ...(browserAllRenderedRefsPerSecond == null
      ? ['Browser all-rendered throughput is not measured yet; direct engine speed cannot be used as a site/browser claim.']
      : browserAllRenderedRefsPerSecond < PRODUCT_PATH_TARGET_REFS_PER_SECOND
        ? [`Browser all-rendered throughput is ${browserAllRenderedRefsPerSecond} refs/sec; target is ${PRODUCT_PATH_TARGET_REFS_PER_SECOND}.`]
        : []),
    ...(bioCandidate && bioCandidate.mlAttribution.malformedBioAccepted > 0
      ? [`${bioCandidate.mlAttribution.malformedBioAccepted} malformed BIO output(s) were accepted.`]
      : []),
    ...(bioCandidate && bioCandidate.healthHotspotAudit.needsActionWithoutVisibleReason > 0
      ? [`${bioCandidate.healthHotspotAudit.needsActionWithoutVisibleReason} action-needed citation(s) have no visible hotspot reason.`]
      : []),
    ...(bioCandidate && bioCandidate.duplicateAudit.likelyFalsePositiveGroups > 0
      ? [`${bioCandidate.duplicateAudit.likelyFalsePositiveGroups} duplicate group(s) look false-positive against gold truth.`]
      : []),
  ];

  return {
    overallStatus,
    qualityStatus,
    performanceStatus,
    headline: headlineForAdminStatus(overallStatus, qualityStatus, performanceStatus),
    whatRan: modeRuns
      .filter((run) => run.datasetId === 'gold_style_core' || run.datasetId === 'pasted_input')
      .slice(0, 10)
      .map((run) =>
        `${run.effectivePolicy.laneLabel}: BIO ${run.effectivePolicy.bioExtraction}, style ML ${run.effectivePolicy.styleMl}, author ML ${run.effectivePolicy.authorMl}, type ML ${run.effectivePolicy.typeMl}.`
      ),
    quality: decisionGates.checks.map((check) =>
      `${check.status.toUpperCase()}: ${check.message}`
    ),
    bioImpact: bioCandidate?.bioQuality.plainSummary ?? 'BIO candidate lane was not available.',
    mlImpact: bioCandidate
      ? `ML attempted ${bioCandidate.mlAttribution.attemptedRefs} reference(s), accepted ${bioCandidate.mlAttribution.acceptedRefs}, rejected ${bioCandidate.mlAttribution.rejectedRefs}, and left ${bioCandidate.mlAttribution.noOpRefs} unchanged. ${typeComparison?.typeMlEvaluation.plainSummary ?? ''}`.trim()
      : 'ML candidate lane was not available.',
    siteLaneTruth: browserRun
      ? `${throughputSummary.plainSummary} Site-default policy direct engine speed for the target run was ${browserRun.refsPerSecond} refs/sec; that number excludes browser rendering.`
      : 'Current site path policy run was not measured.',
    topRisks: topRisks.length > 0 ? topRisks : ['No top risks were detected by the current gates.'],
    recommendedNextAction: recommendedNextActionForAdmin(overallStatus, qualityStatus, performanceStatus),
  };
}

function headlineForAdminStatus(
  overallStatus: EvidenceAdminSummary['overallStatus'],
  qualityStatus: EvidenceAdminSummary['qualityStatus'],
  performanceStatus: EvidenceAdminSummary['performanceStatus'],
): string {
  if (overallStatus === 'insufficient_truth') return 'Not enough truth data to approve ML/BIO changes.';
  if (qualityStatus === 'fail') return 'Do not promote: quality regressed.';
  if (performanceStatus === 'fail') return 'Quality passed, but speed is below target.';
  if (performanceStatus === 'not_valid') return 'Speed is not counted because quality failed.';
  return 'Evidence gates passed for the measured lanes.';
}

function recommendedNextActionForAdmin(
  overallStatus: EvidenceAdminSummary['overallStatus'],
  qualityStatus: EvidenceAdminSummary['qualityStatus'],
  performanceStatus: EvidenceAdminSummary['performanceStatus'],
): string {
  if (overallStatus === 'insufficient_truth') return 'Run the report with certified gold rows before changing parser behavior.';
  if (qualityStatus === 'fail') return 'Fix the quality regressions before tuning speed or promoting BIO/ML behavior.';
  if (performanceStatus === 'fail') return 'Profile the current site path after confirming quality still passes.';
  return 'Keep behavior unchanged unless a planned promotion ticket passes the same gates.';
}

function buildGoldRegressionExamples(
  mode: EvidenceModeId,
  rows: ExpectedRow[],
  references: ProcessedCitation[],
): EvidenceRegressionExample[] {
  const examples: EvidenceRegressionExample[] = [];
  rows.forEach((row, index) => {
    const reference = references[index];
    if (!reference) return;
    const expected = normalizeExpectedFields(row);
    const predicted = fieldsToComparable(reference);
    for (const [field, expectedValue] of Object.entries(expected)) {
      const predictedValue = predicted[field];
      if (!hasComparableValue(expectedValue)) continue;
      if (compareField(field, predictedValue, expectedValue, 'soft', row.rawText)) continue;
      examples.push({
        index: reference.index,
        rawPreview: preview(reference.raw),
        mode,
        kind: CRITICAL_FIELDS.has(field) ? 'critical_field_mismatch' : 'field_mismatch',
        field,
        candidate: predictedValue ?? null,
        expected: expectedValue,
      });
      if (examples.length >= 30) return;
    }
  });
  return examples.slice(0, 30);
}

function countGoldFieldErrors(row: ExpectedRow, reference: ProcessedCitation): number {
  const expected = normalizeExpectedFields(row);
  const predicted = fieldsToComparable(reference);
  return Object.entries(expected).filter(([field, expectedValue]) =>
    hasComparableValue(expectedValue)
    && !compareField(field, predicted[field], expectedValue, 'soft', row.rawText)
  ).length;
}

function normalizeExpectedFields(row: ExpectedRow): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [rawField, value] of Object.entries(row.expectedFields)) {
    const field = FIELD_ALIASES[rawField] ?? rawField;
    normalized[field] = value;
  }
  if (row.expectedType) normalized.referenceType = row.expectedType;
  if (row.expectedStyle) normalized.detectedStyle = row.expectedStyle;
  return normalized;
}

function fieldsToComparable(reference: ProcessedCitation): Record<string, unknown> {
  const entries = Object.entries(reference.fields).map(([key, field]) => [key, field.value]);
  return {
    ...Object.fromEntries(entries),
    referenceType: reference.referenceType,
    detectedStyle: reference.detectedStyle,
    renderedText: reference.renderedText,
  };
}

function countCriticalFieldScoreLosses(
  baseline: Record<string, FieldScore>,
  candidate: Record<string, FieldScore>,
): number {
  let losses = 0;
  for (const field of CRITICAL_FIELDS) {
    const before = baseline[field];
    const after = candidate[field];
    if (!before || !after) continue;
    if (after.tp < before.tp || after.fp > before.fp || after.fn > before.fn) {
      losses += Math.abs(after.tp - before.tp) + Math.max(0, after.fp - before.fp) + Math.max(0, after.fn - before.fn);
    }
  }
  return losses;
}

function summarizeBottlenecks(response: ConvertResponse): EvidenceModeSummary['stageBottlenecks'] {
  const buckets = new Map<string, number[]>();
  for (const record of response.diagnostics ?? []) {
    const values = buckets.get(record.phaseId) ?? [];
    values.push(record.durationMs);
    buckets.set(record.phaseId, values);
  }
  if (buckets.size === 0) {
    for (const timing of response.processingPath.stageTimings) {
      buckets.set(timing.phaseId, [timing.durationMs]);
    }
  }
  return [...buckets.entries()]
    .map(([phaseId, values]) => {
      const sorted = [...values].sort((left, right) => left - right);
      return {
        phaseId,
        totalMs: round(values.reduce((sum, value) => sum + value, 0)),
        p95Ms: round(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0),
        count: values.length,
      };
    })
    .sort((left, right) => right.totalMs - left.totalMs)
    .slice(0, 12);
}

function expectedDuplicateKey(row: ExpectedRow): string | null {
  const fields = normalizeExpectedFields(row);
  const doi = normalizeComparableText(fields.doi);
  if (doi) return `doi:${doi}`;
  const title = normalizeComparableText(fields.title);
  const year = normalizeComparableText(fields.year);
  if (title && year) return `title-year:${title}:${year}`;
  const rawDoi = normalizeComparableText(row.rawText.match(/\b10\.\d{4,9}\/\S+/u)?.[0]);
  if (rawDoi) return `doi:${rawDoi}`;
  return null;
}

function pairSetFromKeys(keys: Array<string | null>): Set<string> {
  const pairs = new Set<string>();
  for (let left = 0; left < keys.length; left += 1) {
    for (let right = left + 1; right < keys.length; right += 1) {
      if (keys[left] && keys[left] === keys[right]) {
        pairs.add(pairKey(left, right));
      }
    }
  }
  return pairs;
}

function expectedDuplicateClusters(keys: Array<string | null>): Map<string, number[]> {
  const clusters = new Map<string, number[]>();
  keys.forEach((key, index) => {
    if (!key) return;
    const indices = clusters.get(key) ?? [];
    indices.push(index);
    clusters.set(key, indices);
  });
  for (const [key, indices] of [...clusters.entries()]) {
    if (indices.length < 2) clusters.delete(key);
  }
  return clusters;
}

function commonExpectedDuplicateKey(indices: number[], expectedKeys: Array<string | null>): string | null {
  const keys = new Set(indices.map((index) => expectedKeys[index]).filter((key): key is string => Boolean(key)));
  return keys.size === 1 ? [...keys][0]! : null;
}

function duplicateAuditSummary(
  truthAvailable: boolean,
  metrics: EvidenceModeSummary['duplicateMetrics'],
  mainFalsePositiveCause: string | null,
): string {
  if (!truthAvailable) {
    return `${metrics.predictedGroups} duplicate group(s) were detected, but this dataset has no gold duplicate truth; review groups manually.`;
  }
  if (metrics.predictedGroups === 0 && metrics.expectedPairs === 0) {
    return 'No duplicate groups were expected or detected.';
  }
  const falseCause = mainFalsePositiveCause
    ? ` Main false-positive cause: ${mainFalsePositiveCause.replace(/_/gu, ' ')}.`
    : '';
  return `Duplicate pair precision ${metrics.pairPrecision}, pair recall ${metrics.pairRecall}, cluster precision ${metrics.clusterPrecision}, cluster recall ${metrics.clusterRecall}.${falseCause}`;
}

function pairKey(left: number, right: number): string {
  return `${Math.min(left, right)}:${Math.max(left, right)}`;
}

function statusLabel(readiness: EvidenceModeSummary['readiness']): PublicStatus {
  if (readiness.needsAction > 0) return 'needs_action';
  if (readiness.needsReview > 0) return 'needs_review';
  return 'ready';
}

function buildConclusions(
  modeRuns: EvidenceModeSummary[],
  comparisons: EvidenceComparison[],
  gates: EvidenceDecisionGates,
  bioPrimaryApplicability: BioPrimaryApplicability[],
  throughputSummary: EvidenceThroughputSummary,
): string[] {
  const browserRuns = modeRuns.filter((run) => run.mode === 'browser_site_default_current');
  const slowest = modeRuns
    .flatMap((run) => run.stageBottlenecks.map((stage) => ({ run, stage })))
    .sort((left, right) => right.stage.totalMs - left.stage.totalMs)[0];
  const bioCandidate = modeRuns.find((run) =>
    run.datasetId === 'gold_style_core'
    && run.mode === 'hybrid_with_bio_candidate_shadow'
  );
  const candidateComparison = comparisons.find((comparison) =>
    comparison.datasetId === 'gold_style_core'
    && comparison.candidateMode === 'hybrid_with_bio_candidate_shadow'
  );
  const typeComparison = comparisons.find((comparison) =>
    comparison.datasetId === 'gold_style_core'
    && comparison.candidateMode === 'hybrid_with_bio_candidate_shadow'
  );
  const missingPrimaryPhases = bioPrimaryApplicability
    .filter((phase) => phase.currentStatus === 'not_integrated' || phase.currentStatus === 'hint_only')
    .map((phase) => phase.phaseId);
  return [
    `Decision gates: ${gates.status}.`,
    missingPrimaryPhases.length > 0
      ? `BIO is not yet a Phase 1-4 primary parser: ${missingPrimaryPhases.join(', ')} still lack BIO-primary integration.`
      : 'BIO-primary integration is available across the audited early phases.',
    throughputSummary.plainSummary,
    browserRuns.length > 0
      ? `Site-default policy direct engine median: ${round(average(browserRuns.map((run) => run.refsPerSecond)))} refs/sec. This is not browser throughput.`
      : 'Site-default policy lane was not available.',
    slowest
      ? `Largest measured phase bottleneck: ${slowest.stage.phaseId} in ${slowest.run.mode}/${slowest.run.datasetId} (${slowest.stage.totalMs}ms).`
      : 'No stage bottlenecks were reported.',
    bioCandidate
      ? `Current BIO evidence emitted ${bioCandidate.bioAttribution.entityEmitted} entities, accepted ${bioCandidate.bioAttribution.patchAccepted} selective extraction patches, and blocked ${bioCandidate.bioAttribution.blockedByDiagnostics} refs by diagnostics.`
      : 'BIO candidate lane was not available.',
    candidateComparison
      ? `BIO extraction-candidate critical losses: ${candidateComparison.criticalFieldLossCount}; wrong overwrites: ${candidateComparison.wrongOverwriteCount}.`
      : 'BIO candidate comparison was not available.',
    typeComparison
      ? typeComparison.typeMlEvaluation.plainSummary
      : 'Type ML comparison was not available.',
    bioCandidate
      ? bioCandidate.healthHotspotAudit.plainSummary
      : 'Health hotspot audit was not available.',
    bioCandidate
      ? bioCandidate.duplicateAudit.plainSummary
      : 'Duplicate precision audit was not available.',
  ];
}

function score(count: { tp: number; fp: number; fn: number }): FieldScore {
  const precision = count.tp + count.fp > 0 ? count.tp / (count.tp + count.fp) : 0;
  const recall = count.tp + count.fn > 0 ? count.tp / (count.tp + count.fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    tp: count.tp,
    fp: count.fp,
    fn: count.fn,
    precision: round(precision, 4),
    recall: round(recall, 4),
    f1: round(f1, 4),
  };
}

function hasComparableValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((entry) => hasComparableValue(entry));
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeComparableText(value: unknown): string {
  if (value == null) return '';
  return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function throughput(count: number, durationMs: number): number {
  return durationMs > 0 ? round(count / (durationMs / 1000)) : 0;
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number, places = 2): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function preview(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function withConsoleInfoMuted<T>(run: () => Promise<T>): Promise<T> {
  const originalInfo = console.info;
  console.info = () => {};
  try {
    return await run();
  } finally {
    console.info = originalInfo;
  }
}
