import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "./AdminShell";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

type ParseProfile =
  | "core_parse_fast"
  | "core_parse_full"
  | "current_runtime"
  | "pro_overlay_enrich"
  | "debug_full";

type RuntimeProfile = "site_default" | "benchmark_5600h" | "server_16c";

type DiagnosticRun = {
  wallClockMs: number;
  refsPerSecond: number;
  responseBytes: number;
  responseSha256: string;
  renderedTextSha256: string;
  referenceCount: number;
  coreParseLatencyMs: number;
  summary: {
    total: number;
    ready: number;
    needsReview: number;
    needsAction: number;
    failed: number;
    parseQuality: number;
  };
  providerUsage: {
    crossrefCalls: number;
    openalexCalls: number;
    semanticScholarCalls: number;
    llmTokensUsed: number;
    cacheHits: number;
  };
  stageTotalsMs: Record<string, number>;
  quality: {
    splitHash: string;
    fieldHash: string;
    renderedHash: string;
    semanticHash: string;
    contractHash: string;
    failedCount: number;
    emptyRenderedCount: number;
    needsReviewCount: number;
    needsActionCount: number;
    criticalFieldPresence: Record<string, number>;
  };
  slowestReferences: Array<{
    index: number;
    outputLatencyMs: number;
    publicStatus: string;
    referenceType: string;
    rawPreview: string;
  }>;
};

type DiagnosticReport = {
  id: string;
  generatedAt: string;
  input: {
    label: string;
    sha256: string;
    rawInputBytes: number;
    rawInputChars: number;
    lineCount: number;
    nonEmptyLineCount: number;
    numberedLineCount: number;
    inspectedReferenceCount: number;
    inspectedDetectedFormat: string;
    inspectedStructure: string;
    inspectedSplitQualityFlag: string;
  };
  config: {
    sourceType: "text" | "doi_list";
    outputStyle: string;
    parseProfile: ParseProfile;
    runtimeProfile: RuntimeProfile;
  };
  measuredRun: DiagnosticRun;
  baselineRun: DiagnosticRun;
  approvedTruth: {
    totalRowsScanned: number;
    loadedRows: number;
    reviewedRows: number;
    draftRows: number;
    quarantinedRows: number;
    certifiedCoreRows: number;
    certifiedOverlayRows: number;
    usableCoreRows: number;
    usableOverlayRows: number;
  };
  qualityComparison: {
    status: "pass" | "fail";
    hardFailures: string[];
    warnings: string[];
    diffs: string[];
  };
  performanceValid: boolean;
  conclusions: string[];
};

type LatestResponse = {
  latest: DiagnosticReport | null;
  reports: DiagnosticReport[];
};

type EvidenceMode =
  | "heuristics_only"
  | "raw_ml_independent_shadow"
  | "raw_bio_shadow"
  | "guarded_bio_shadow"
  | "hybrid_current"
  | "hybrid_with_bio_candidate_shadow"
  | "browser_site_default_current";

type EvidenceReadinessCard = {
  id: "quality" | "siteSpeed" | "trainingData" | "safeRollout";
  label: string;
  question: string;
  status: "pass" | "warning" | "fail" | "blocked" | "not_measured";
  plainSummary: string;
  blockingReasons: string[];
  advancedEvidence: string[];
};

type EvidenceBundleSummary = {
  schemaVersion: "parser_release_readiness.v1";
  title: "Parser Release Readiness";
  finalVerdict:
    | "not_ready"
    | "ready_for_shadow_testing"
    | "ready_for_limited_rollout"
    | "ready_for_live_promotion";
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
    decisionGateStatus: "pass" | "fail" | "insufficient_truth";
    throughputClaimStatus: "browser_measured" | "browser_not_measured" | "quality_invalid" | "below_target";
    bioPrimaryPromotionStatus: "safe_candidate" | "blocked" | "not_measured" | "insufficient_truth";
    browserTimingCount: number;
    modeRunCount: number;
    comparisonCount: number;
    datasetIds: string[];
    liveBehaviorChanged: false;
    hiddenTechnicalDetails: string[];
  };
};

type EvidenceReport = {
  id: string;
  generatedAt: string;
  adminSummary?: {
    overallStatus: "pass" | "fail" | "needs_investigation" | "insufficient_truth";
    qualityStatus: "pass" | "fail" | "needs_investigation" | "insufficient_truth";
    performanceStatus: "pass" | "fail" | "not_valid" | "not_measured";
    headline: string;
    whatRan: string[];
    quality: string[];
    bioImpact: string;
    mlImpact: string;
    siteLaneTruth: string;
    topRisks: string[];
    recommendedNextAction: string;
  };
  releaseReadiness?: EvidenceBundleSummary;
  evidenceBundle?: EvidenceBundleSummary;
  throughputSummary?: {
    targetRefsPerSecond: number;
    claimStatus: "browser_measured" | "browser_not_measured" | "quality_invalid" | "below_target";
    plainSummary: string;
    lanes: Array<{
      id:
        | "direct_engine"
        | "direct_engine_plus_report"
        | "backend_convert_route"
        | "queued_job_runtime"
        | "browser_submit_to_results"
        | "browser_first_paint"
        | "browser_all_rendered";
      label: string;
      category: "parser" | "backend" | "browser";
      measured: boolean;
      inputReferenceCount: number;
      parsedReferenceCount: number;
      wallMs: number | null;
      refsPerSecond: number | null;
      qualityGateStatus: string;
      performanceValid: boolean;
      parseProfile: string | null;
      runtimeProfile: string | null;
      whatThisNumberMeans: string;
      missingReason?: string;
    }>;
  };
  browserTimings?: Array<{
    source: "admin_diagnostics_evidence" | "site_convert";
    recordedAt: string;
    targetDatasetId: string | null;
    targetMode: EvidenceMode | null;
    inputReferenceCount: number;
    parsedReferenceCount: number;
    requestMs?: number;
    submitToResultsMs: number;
    firstPaintMs: number;
    allRenderedMs: number;
    submitToResultsRefsPerSecond: number | null;
    firstPaintRefsPerSecond: number | null;
    allRenderedRefsPerSecond: number | null;
    browserResultBytes?: number;
    rowsInitiallyRendered?: number;
    rowsEventuallyRendered?: number;
    virtualizationEnabled?: boolean;
    longTaskCount?: number;
    maxLongTaskMs?: number;
    plainSummary: string;
  }>;
  datasets: Array<{
    id: string;
    label: string;
    truthAvailable: boolean;
    rowCount: number;
    sha256: string;
  }>;
  bioPrimaryApplicability: Array<{
    phaseId: string;
    intendedRole: string;
    currentRole: string;
    currentStatus: "not_integrated" | "hint_only" | "shadow_only" | "selective_patch" | "primary_candidate";
    requiredBeforePromotion: string[];
  }>;
  modeRuns: Array<{
    mode: EvidenceMode;
    datasetId: string;
    layer: "component" | "product_path";
    effectivePolicy?: {
      laneLabel: string;
      whatThisLaneMeans: string;
      requestedParseProfile: string;
      effectiveParseProfile: string;
      requestedRuntimeProfile: string;
      effectiveRuntimeProfile: string;
      styleMl: string;
      authorMl: string;
      extractionMl: string;
      bioExtraction: string;
      typeMl: string;
      providers: string;
      llmFallback: string;
      batchSize: number;
      maxConcurrency: number;
      overrideReasons: string[];
    };
    throughputLanes?: {
      directEngineRefsPerSecond: number;
      directEnginePlusReportRefsPerSecond: number;
      backendConvertRouteRefsPerSecond: number | null;
      queuedJobRuntimeRefsPerSecond: number | null;
      browserSubmitToResultsRefsPerSecond: number | null;
      browserFirstPaintRefsPerSecond: number | null;
      browserAllRenderedRefsPerSecond: number | null;
    };
    referenceCount: number;
    refsPerSecond: number;
    wallClockMs: number;
    summary: DiagnosticRun["summary"];
    readiness: {
      ready: number;
      needsReview: number;
      needsAction: number;
      failed: number;
      falseReady: number;
      falseActionNeeded: number;
    };
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
    healthHotspotAudit?: {
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
    };
    duplicateAudit?: {
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
    };
    bioAttribution: {
      entityEmitted: number;
      entityStructurallyValid: number;
      entityGrounded: number;
      patchAttempted: number;
      patchAccepted: number;
      patchRejected: number;
      patchImprovedGoldScore: number;
      patchWorsenedGoldScore: number;
      blockedByDiagnostics: number;
      malformedBioAccepted?: number;
    };
    bioQuality?: {
      truthAvailable: boolean;
      bioWasActive: boolean;
      bioMode: string;
      refsWithBioOutput: number;
      bioAcceptedChanges: number;
      bioRejectedChanges: number;
      bioHelpedCount: number;
      bioHarmedAcceptedCount: number;
      bioBlockedUnsafeCount: number;
      bioNoOpCount: number;
      topRejectedReasons: Record<string, number>;
      plainSummary: string;
    };
    mlAttribution: {
      eligibleRefs: number;
      attemptedRefs: number;
      acceptedRefs: number;
      rejectedRefs: number;
      noOpRefs: number;
      malformedBioAccepted: number;
      acceptedPatchPrecision: number;
    };
    stageBottlenecks: Array<{
      phaseId: string;
      totalMs: number;
      p95Ms: number;
      count: number;
    }>;
    regressionExamples: Array<{
      index: number;
      rawPreview: string;
      kind: string;
      field?: string;
      candidate?: unknown;
      expected?: unknown;
    }>;
  }>;
  comparisons: Array<{
    datasetId: string;
    candidateMode: EvidenceMode;
    criticalFieldLossCount: number;
    wrongOverwriteCount: number;
    improved: number;
    regressed: number;
    newFalsePositive: number;
    newFalseNegative: number;
    fieldDiffExamples?: Array<{
      index: number;
      rawPreview: string;
      field: string;
      outcome: "helped" | "worsened" | "unchanged" | "needs_investigation";
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
      renderedTextDelta: "same" | "changed";
    }>;
    typeMlEvaluation?: {
      truthAvailable: boolean;
      helped: number;
      hurtIfAccepted: number;
      noDifference: number;
      heuristicCorrectMlWrong: number;
      heuristicWrongMlCorrect: number;
      finalTypeChanges: number;
      renderedChangedWithTypeChange: number;
      healthImpactCount: number;
      recommendation: "keep_shadow" | "test_guarded_override" | "insufficient_truth";
      plainSummary: string;
      examples: Array<{
        index: number;
        rawPreview: string;
        heuristicType: unknown;
        mlType: unknown;
        goldType: unknown;
        finalType: unknown;
        outcome: "helped" | "hurt" | "same" | "needs_investigation";
        healthImpact: string;
        renderedTextDelta: "same" | "changed";
      }>;
    };
  }>;
  decisionGates: {
    status: "pass" | "fail" | "insufficient_truth";
    checks: Array<{
      id: string;
      status: "pass" | "fail" | "not_applicable";
      message: string;
    }>;
  };
  bioPrimaryPromotionGate?: {
    status: "safe_candidate" | "blocked" | "not_measured" | "insufficient_truth";
    plainSummary: string;
    recommendation: string;
    checks: Array<{
      id: string;
      label: string;
      status: "pass" | "fail" | "warning" | "not_measured" | "not_applicable";
      plainReason: string;
    }>;
  };
  conclusions: string[];
};

type EvidenceLatestResponse = {
  latest: EvidenceReport | null;
  reports: EvidenceReport[];
};

type EvidenceRunTiming = {
  submitClickAt: number;
  requestSentAt: number;
  payloadReceivedAt: number;
  requestMs: number;
  submitToResultsMs: number;
};

const latestQueryKey = ["/internal/admin/diagnostics/performance/latest"];
const evidenceQueryKey = ["/internal/admin/diagnostics/ml-bio/latest"];
const storedReportKey = "bulkrefs.admin.performance.latest";
const storedEvidenceReportKey = "bulkrefs.admin.ml-bio.latest";

const cardClassName =
  "rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none";

const parseProfiles: ParseProfile[] = [
  "core_parse_full",
  "core_parse_fast",
  "current_runtime",
  "pro_overlay_enrich",
  "debug_full",
];

const runtimeProfiles: RuntimeProfile[] = ["site_default", "benchmark_5600h", "server_16c"];

function formatMs(value: number) {
  return `${Math.round(value).toLocaleString()}ms`;
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function shortHash(value: string) {
  return value.replace(/^sha256:/, "").slice(0, 16);
}

function readStoredReport(): DiagnosticReport | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(storedReportKey);
    return stored ? (JSON.parse(stored) as DiagnosticReport) : null;
  } catch {
    return null;
  }
}

function storeLatestReport(report: DiagnosticReport) {
  try {
    window.localStorage.setItem(storedReportKey, JSON.stringify(report));
  } catch {
    // The backend copy is still authoritative for the current server process.
  }
}

function readStoredEvidenceReport(): EvidenceReport | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(storedEvidenceReportKey);
    return stored ? (JSON.parse(stored) as EvidenceReport) : null;
  } catch {
    return null;
  }
}

function storeLatestEvidenceReport(report: EvidenceReport) {
  try {
    window.localStorage.setItem(storedEvidenceReportKey, JSON.stringify(report));
  } catch {
    // The backend copy is still authoritative for the current server process.
  }
}

function estimateReportBytes(report: EvidenceReport): number {
  const serialized = JSON.stringify(report);
  if (typeof Blob !== "undefined") {
    return new Blob([serialized]).size;
  }
  return serialized.length;
}

function evidenceTargetRun(report: EvidenceReport) {
  return report.modeRuns.find((run) => run.mode === "browser_site_default_current" && run.datasetId === "pasted_input")
    ?? report.modeRuns.find((run) => run.mode === "browser_site_default_current" && run.datasetId === "current_500_workload")
    ?? report.modeRuns.find((run) => run.mode === "browser_site_default_current");
}

function scheduleBrowserFrame(callback: () => void) {
  if (typeof window === "undefined") return;
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }
  window.setTimeout(callback, 0);
}

export default function AdminDiagnostics() {
  const queryClient = useQueryClient();
  const [content, setContent] = React.useState("");
  const [parseProfile, setParseProfile] = React.useState<ParseProfile>("core_parse_full");
  const [runtimeProfile, setRuntimeProfile] = React.useState<RuntimeProfile>("site_default");
  const evidenceRunTimingRef = React.useRef<{ submitClickAt: number } | null>(null);
  const storedReport = React.useMemo(() => readStoredReport(), []);
  const storedEvidenceReport = React.useMemo(() => readStoredEvidenceReport(), []);

  const latestQuery = useQuery<LatestResponse>({
    queryKey: latestQueryKey,
    queryFn: async () => adminFetch<LatestResponse>("/internal/admin/diagnostics/performance/latest"),
    placeholderData: (previousData) => previousData,
  });

  const runMutation = useMutation({
    mutationFn: async (payload: { content?: string }) =>
      adminFetch<DiagnosticReport>("/internal/admin/diagnostics/performance/run", {
        method: "POST",
        body: JSON.stringify({
          sourceType: "text",
          outputStyle: "apa7",
          parseProfile,
          runtimeProfile,
          ...payload,
        }),
      }),
    onSuccess: (report) => {
      storeLatestReport(report);
      queryClient.setQueryData<LatestResponse>(latestQueryKey, (previous) => ({
        latest: report,
        reports: [report, ...(previous?.reports ?? []).filter((item) => item.id !== report.id)].slice(0, 20),
      }));
    },
  });

  const evidenceQuery = useQuery<EvidenceLatestResponse>({
    queryKey: evidenceQueryKey,
    queryFn: async () => adminFetch<EvidenceLatestResponse>("/internal/admin/diagnostics/ml-bio/latest"),
    placeholderData: (previousData) => previousData,
  });

  const evidenceMutation = useMutation({
    mutationFn: async (payload: { content?: string }) => {
      const submitClickAt = evidenceRunTimingRef.current?.submitClickAt ?? performance.now();
      const requestSentAt = performance.now();
      const report = await adminFetch<EvidenceReport>("/internal/admin/diagnostics/ml-bio/run", {
        method: "POST",
        body: JSON.stringify({
          sourceType: "text",
          outputStyle: "apa7",
          runtimeProfile,
          ...payload,
        }),
      });
      const payloadReceivedAt = performance.now();
      return {
        report,
        timing: {
          submitClickAt,
          requestSentAt,
          payloadReceivedAt,
          requestMs: payloadReceivedAt - requestSentAt,
          submitToResultsMs: payloadReceivedAt - submitClickAt,
        },
      };
    },
    onSuccess: ({ report, timing }: { report: EvidenceReport; timing: EvidenceRunTiming }) => {
      storeLatestEvidenceReport(report);
      queryClient.setQueryData<EvidenceLatestResponse>(evidenceQueryKey, (previous) => ({
        latest: report,
        reports: [report, ...(previous?.reports ?? []).filter((item) => item.id !== report.id)].slice(0, 10),
      }));
      attachEvidenceBrowserTiming(report, timing);
    },
  });

  const attachEvidenceBrowserTiming = (report: EvidenceReport, timing: EvidenceRunTiming) => {
    if (typeof window === "undefined") return;
    scheduleBrowserFrame(() => {
      const firstPaintMs = performance.now() - timing.submitClickAt;
      scheduleBrowserFrame(() => {
        const allRenderedMs = performance.now() - timing.submitClickAt;
        const targetRun = evidenceTargetRun(report);
        const parsedReferenceCount = targetRun?.referenceCount ?? 0;
        void adminFetch<EvidenceReport>(`/internal/admin/diagnostics/ml-bio/${report.id}/browser-timing`, {
          method: "POST",
          body: JSON.stringify({
            source: "admin_diagnostics_evidence",
            inputReferenceCount: parsedReferenceCount,
            parsedReferenceCount,
            requestMs: timing.requestMs,
            submitToResultsMs: timing.submitToResultsMs,
            firstPaintMs,
            allRenderedMs,
            browserResultBytes: estimateReportBytes(report),
            rowsInitiallyRendered: report.modeRuns.length,
            rowsEventuallyRendered: report.modeRuns.length,
            virtualizationEnabled: false,
            longTaskCount: 0,
            maxLongTaskMs: 0,
          }),
        })
          .then((updatedReport) => {
            storeLatestEvidenceReport(updatedReport);
            queryClient.setQueryData<EvidenceLatestResponse>(evidenceQueryKey, (previous) => ({
              latest: updatedReport,
              reports: [updatedReport, ...(previous?.reports ?? []).filter((item) => item.id !== updatedReport.id)].slice(0, 10),
            }));
          })
          .catch(() => {
            // The report is still useful without browser timing; the UI will show that lane as not measured.
          });
      });
    });
  };

  const report = latestQuery.data?.latest ?? storedReport;
  const evidenceReport = evidenceQuery.data?.latest ?? storedEvidenceReport;
  const runError = runMutation.error instanceof Error ? runMutation.error.message : null;
  const evidenceError = evidenceMutation.error instanceof Error ? evidenceMutation.error.message : null;
  const latestError = latestQuery.error instanceof Error ? latestQuery.error.message : null;

  const runFixture = () => {
    runMutation.mutate({});
  };

  const runPastedInput = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    runMutation.mutate({ content: trimmed });
  };

  const runEvidence = () => {
    const trimmed = content.trim();
    evidenceRunTimingRef.current = { submitClickAt: performance.now() };
    evidenceMutation.mutate(trimmed ? { content: trimmed } : {});
  };

  return (
    <AdminShell
      title="Engine"
      subtitle="core_parse_full / site_default runs with quality parity gating."
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Performance report
            </h2>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Run fixtures or pasted input and compare against quality parity
              gates.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runFixture}
              disabled={runMutation.isPending}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#002147] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-[#002147]/90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0f4fa8] dark:text-white dark:hover:bg-[#0f4fa8]/90"
            >
              <span className="material-symbols-outlined text-base">speed</span>
              Run Fixture
            </button>
            <button
              type="button"
              onClick={runPastedInput}
              disabled={runMutation.isPending || !content.trim()}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-200 dark:hover:bg-white/5"
            >
              <span className="material-symbols-outlined text-base">play_arrow</span>
              Run Pasted
            </button>
            <button
              type="button"
              onClick={runEvidence}
              disabled={evidenceMutation.isPending}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#002147] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-[#002147]/90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0f4fa8] dark:text-white dark:hover:bg-[#0f4fa8]/90"
            >
              <span className="material-symbols-outlined text-base">biotech</span>
              Run ML/BIO Evidence
            </button>
          </div>
        </div>

        {latestError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            {latestError}
          </div>
        ) : null}
        {runError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {runError}
          </div>
        ) : null}
        {evidenceError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {evidenceError}
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Quality"
            value={report ? report.qualityComparison.status.toUpperCase() : "--"}
            tone={report?.qualityComparison.status === "pass" ? "success" : report ? "danger" : "neutral"}
          />
          <MetricCard
            label="Performance Valid"
            value={report ? (report.performanceValid ? "YES" : "NO") : "--"}
            tone={report?.performanceValid ? "success" : report ? "danger" : "neutral"}
          />
          <MetricCard
            label="Throughput"
            value={report ? `${formatNumber(report.measuredRun.refsPerSecond)} refs/s` : "--"}
          />
          <MetricCard
            label="Wall Time"
            value={report ? formatMs(report.measuredRun.wallClockMs) : "--"}
          />
          <MetricCard
            label="References"
            value={report ? report.measuredRun.referenceCount.toLocaleString() : "--"}
          />
          <MetricCard
            label="Certified Truth"
            value={report ? report.approvedTruth.usableCoreRows.toLocaleString() : "--"}
          />
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className={cardClassName}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Run input
              </h2>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Parse
                  <select
                    value={parseProfile}
                    onChange={(event) => setParseProfile(event.target.value as ParseProfile)}
                    className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800 dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-100"
                  >
                    {parseProfiles.map((profile) => (
                      <option key={profile} value={profile}>
                        {profile}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Runtime
                  <select
                    value={runtimeProfile}
                    onChange={(event) => setRuntimeProfile(event.target.value as RuntimeProfile)}
                    className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800 dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-100"
                  >
                    {runtimeProfiles.map((profile) => (
                      <option key={profile} value={profile}>
                        {profile}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              spellCheck={false}
              className="min-h-[20rem] w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-4 font-mono text-xs leading-5 text-slate-900 outline-none transition focus:border-[#002147] focus:bg-white dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-100 dark:focus:border-[#0f4fa8]"
              placeholder="Paste numbered references here"
            />
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span>{content.length.toLocaleString()} chars</span>
              <span className="text-right">{content.split(/\r?\n/u).filter((line) => line.trim()).length.toLocaleString()} non-empty lines</span>
            </div>
          </div>

          <div className={cardClassName}>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Latest report
            </h2>
            {runMutation.isPending ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <span className="material-symbols-outlined animate-pulse text-3xl text-slate-300 dark:text-slate-600">
                  monitoring
                </span>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  Running diagnostic…
                </p>
              </div>
            ) : report ? (
              <ReportSummary report={report} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500">
                  <span className="material-symbols-outlined">assessment</span>
                </span>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  No diagnostic report yet
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Run a fixture or paste references to generate one.
                </p>
              </div>
            )}
          </div>
        </section>

        {report ? <ReportDetails report={report} /> : null}
        <EvidenceSection report={evidenceReport} isPending={evidenceMutation.isPending} />
      </div>
    </AdminShell>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}) {
  return (
    <div className={cn(cardClassName, "p-5")}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 break-words text-2xl font-bold tabular-nums",
          tone === "success"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "danger"
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-900 dark:text-white",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ReportSummary({ report }: { report: DiagnosticReport }) {
  const measured = report.measuredRun;
  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <SummaryItem label="Generated" value={new Date(report.generatedAt).toLocaleString()} />
        <SummaryItem label="Input" value={report.input.label} />
        <SummaryItem label="Parse profile" value={report.config.parseProfile} />
        <SummaryItem label="Runtime profile" value={report.config.runtimeProfile} />
        <SummaryItem label="Response bytes" value={measured.responseBytes.toLocaleString()} />
        <SummaryItem label="Failed / empty" value={`${measured.quality.failedCount} / ${measured.quality.emptyRenderedCount}`} />
        <SummaryItem label="Needs review" value={measured.summary.needsReview.toLocaleString()} />
        <SummaryItem label="Needs action" value={measured.summary.needsAction.toLocaleString()} />
      </div>
      <div className="space-y-2">
        {report.conclusions.map((conclusion) => (
          <p key={conclusion} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-950 dark:text-slate-200">
            {conclusion}
          </p>
        ))}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-black text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

function ReportDetails({ report }: { report: DiagnosticReport }) {
  const run = report.measuredRun;
  const stageRows = Object.entries(run.stageTotalsMs)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12);
  const hashRows = [
    ["Input", report.input.sha256],
    ["Split", run.quality.splitHash],
    ["Fields", run.quality.fieldHash],
    ["Rendered", run.quality.renderedHash],
    ["Semantic", run.quality.semanticHash],
    ["Contract", run.quality.contractHash],
    ["Response", run.responseSha256],
  ];

  return (
    <section className="grid grid-cols-1 gap-8 xl:grid-cols-2">
      <div className={cardClassName}>
        <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
          Quality details
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {hashRows.map(([label, hash]) => (
            <SummaryItem key={label} label={`${label} hash`} value={shortHash(hash)} />
          ))}
          {Object.entries(run.quality.criticalFieldPresence).map(([field, count]) => (
            <SummaryItem key={field} label={field} value={count.toLocaleString()} />
          ))}
        </div>
        {report.qualityComparison.hardFailures.length > 0 ? (
          <div className="mt-5 space-y-2">
            {report.qualityComparison.hardFailures.map((failure) => (
              <p key={failure} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-800 dark:bg-red-950/30 dark:text-red-200">
                {failure}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <div className={cardClassName}>
        <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
          Runtime details
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SummaryItem label="CrossRef calls" value={run.providerUsage.crossrefCalls.toLocaleString()} />
          <SummaryItem label="OpenAlex calls" value={run.providerUsage.openalexCalls.toLocaleString()} />
          <SummaryItem label="Semantic calls" value={run.providerUsage.semanticScholarCalls.toLocaleString()} />
          <SummaryItem label="LLM tokens" value={run.providerUsage.llmTokensUsed.toLocaleString()} />
        </div>
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 dark:bg-slate-950">
              <tr>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {stageRows.map(([stage, duration]) => (
                <tr key={stage}>
                  <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{stage}</td>
                  <td className="px-3 py-2 text-right font-black text-slate-900 dark:text-slate-100">{formatMs(duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={cardClassName}>
        <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
          Approved truth
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SummaryItem label="Scanned rows" value={(report.approvedTruth.totalRowsScanned ?? report.approvedTruth.loadedRows).toLocaleString()} />
          <SummaryItem label="Primary loaded" value={report.approvedTruth.loadedRows.toLocaleString()} />
          <SummaryItem label="Reviewed rows" value={report.approvedTruth.reviewedRows.toLocaleString()} />
          <SummaryItem label="Quarantined rows" value={report.approvedTruth.quarantinedRows.toLocaleString()} />
          <SummaryItem label="Draft rows" value={report.approvedTruth.draftRows.toLocaleString()} />
          <SummaryItem label="Certified core" value={report.approvedTruth.certifiedCoreRows.toLocaleString()} />
          <SummaryItem label="Certified overlay" value={report.approvedTruth.certifiedOverlayRows.toLocaleString()} />
          <SummaryItem label="Usable core" value={report.approvedTruth.usableCoreRows.toLocaleString()} />
          <SummaryItem label="Usable overlay" value={report.approvedTruth.usableOverlayRows.toLocaleString()} />
        </div>
      </div>

      <div className={cardClassName}>
        <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
          Slowest references
        </h2>
        <div className="space-y-3">
          {run.slowestReferences.slice(0, 8).map((reference) => (
            <div key={`${reference.index}-${reference.outputLatencyMs}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <span>#{reference.index} · {reference.referenceType}</span>
                <span>{formatMs(reference.outputLatencyMs)}</span>
              </div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{reference.rawPreview}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={cardClassName}>
        <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
          Report JSON
        </h2>
        <pre className="max-h-[30rem] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
          {JSON.stringify(report, null, 2)}
        </pre>
      </div>
    </section>
  );
}

function AdminEvidencePlainSummary({ report }: { report: EvidenceReport }) {
  const summary = report.adminSummary ?? legacyEvidenceAdminSummary(report);
  const releaseReadiness = report.releaseReadiness ?? report.evidenceBundle ?? legacyEvidenceBundle(report);
  const goldRuns = report.modeRuns.filter((run) => run.datasetId === "gold_style_core");
  const bioCandidate = goldRuns.find((run) => run.mode === "hybrid_with_bio_candidate_shadow");
  const typeComparison = report.comparisons.find(
    (comparison) => comparison.datasetId === "gold_style_core" && comparison.candidateMode === "hybrid_with_bio_candidate_shadow",
  );
  const typeMlEvaluation = typeComparison?.typeMlEvaluation;
  const healthHotspotAudit = bioCandidate?.healthHotspotAudit;
  const duplicateAudit = bioCandidate?.duplicateAudit;
  const throughputSummary = report.throughputSummary;
  const bioPrimaryPromotion = report.bioPrimaryPromotionGate;
  const fieldDiffExamples = report.comparisons
    .flatMap((comparison) => comparison.fieldDiffExamples ?? [])
    .filter((example) => example.outcome === "worsened" || example.outcome === "helped" || example.outcome === "needs_investigation")
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <ReleaseReadinessSummary bundle={releaseReadiness} />

      <div className={cardClassName}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="font-label text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
              Plain summary
            </p>
            <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
              {summary.headline}
            </h3>
            <p className="mt-2 max-w-4xl text-sm font-semibold text-slate-600 dark:text-slate-300">
              {summary.recommendedNextAction}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[36rem]">
            <StatusTile label="Quality" status={summary.qualityStatus} />
            <StatusTile label="Speed" status={summary.performanceStatus} />
            <StatusTile label="Overall" status={summary.overallStatus} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-4">
          <PlainSummaryBlock title="BIO impact" text={summary.bioImpact} />
          <PlainSummaryBlock title="ML impact" text={summary.mlImpact} />
          <PlainSummaryBlock title="Site path truth" text={summary.siteLaneTruth} />
          <PlainSummaryBlock title="Throughput" text={throughputSummary?.plainSummary ?? "Throughput lanes were not available in this saved report."} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-4">
          <PlainSummaryBlock title="Type ML" text={typeMlEvaluation?.plainSummary ?? "Type ML comparison was not available in this report."} />
          <PlainSummaryBlock title="Action explanations" text={healthHotspotAudit?.plainSummary ?? "Health hotspot audit was not available in this report."} />
          <PlainSummaryBlock title="Duplicate audit" text={duplicateAudit?.plainSummary ?? "Duplicate precision audit was not available in this report."} />
          <PlainSummaryBlock title="BIO primary candidate" text={bioPrimaryPromotion?.plainSummary ?? "BIO-primary promotion gates were not available in this saved report."} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PlainListBlock title="Top risks" items={summary.topRisks} />
          <PlainListBlock title="Quality checks" items={summary.quality.slice(0, 6)} />
        </div>
      </div>

      <div className={cardClassName}>
        <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
          Throughput lanes
        </h3>
        {throughputSummary ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 dark:bg-slate-950">
                <tr>
                  <th className="px-3 py-2">Lane</th>
                  <th className="px-3 py-2">Meaning</th>
                  <th className="px-3 py-2 text-right">Refs/s</th>
                  <th className="px-3 py-2 text-right">Wall</th>
                  <th className="px-3 py-2 text-right">Valid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {throughputSummary.lanes.map((lane) => (
                  <tr key={lane.id}>
                    <td className="px-3 py-2 font-black text-slate-800 dark:text-slate-100">{lane.label}</td>
                    <td className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">
                      {lane.measured ? lane.whatThisNumberMeans : lane.missingReason ?? lane.whatThisNumberMeans}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{lane.refsPerSecond == null ? "Not measured" : formatNumber(lane.refsPerSecond)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{lane.wallMs == null ? "--" : formatMs(lane.wallMs)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{lane.performanceValid ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyAuditMessage text="Throughput lanes are not available in this saved report." />
        )}
      </div>

      {bioPrimaryPromotion ? (
        <div className={cardClassName}>
          <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
            BIO primary candidate gate
          </h3>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{bioPrimaryPromotion.recommendation}</p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {bioPrimaryPromotion.checks.map((check) => (
              <div
                key={check.id}
                className={cn(
                  "rounded-xl border px-4 py-3",
                  check.status === "pass"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
                    : check.status === "fail"
                      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
                )}
              >
                <p className="text-[10px] font-black uppercase tracking-widest">{check.label}</p>
                <p className="mt-1 text-xs font-black uppercase">{check.status.replace(/_/g, " ")}</p>
                <p className="mt-2 text-xs font-semibold">{check.plainReason}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className={cardClassName}>
        <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
          What actually ran
        </h3>
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 dark:bg-slate-950">
              <tr>
                <th className="px-3 py-2">Lane</th>
                <th className="px-3 py-2">BIO</th>
                <th className="px-3 py-2">Style ML</th>
                <th className="px-3 py-2">Author ML</th>
                <th className="px-3 py-2">Type ML</th>
                <th className="px-3 py-2 text-right">Refs/s</th>
                <th className="px-3 py-2 text-right">Ready</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {goldRuns.map((run) => (
                <tr key={`${run.datasetId}-${run.mode}`}>
                  <td className="px-3 py-2 font-black text-slate-800 dark:text-slate-100">
                    {run.effectivePolicy?.laneLabel ?? run.mode}
                  </td>
                  <td className="px-3 py-2 font-semibold">{prettySwitch(run.effectivePolicy?.bioExtraction)}</td>
                  <td className="px-3 py-2 font-semibold">{prettySwitch(run.effectivePolicy?.styleMl)}</td>
                  <td className="px-3 py-2 font-semibold">{prettySwitch(run.effectivePolicy?.authorMl)}</td>
                  <td className="px-3 py-2 font-semibold">{prettySwitch(run.effectivePolicy?.typeMl)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatNumber(run.refsPerSecond)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{run.summary.ready}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {fieldDiffExamples.length > 0 ? (
        <div className={cardClassName}>
          <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
            Examples to review
          </h3>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {fieldDiffExamples.map((example) => (
              <div
                key={`${example.index}-${example.field}-${example.outcome}`}
                className={cn(
                  "rounded-xl border p-4",
                  example.outcome === "worsened"
                    ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                    : example.outcome === "helped"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
                      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest">
                  <span>Reference {example.index + 1}</span>
                  <span>{example.outcome.replace(/_/g, " ")}</span>
                </div>
                <p className="mt-2 text-sm font-black">{example.field}</p>
                <p className="mt-1 text-xs font-semibold">{example.adminSummary}</p>
                <p className="mt-3 line-clamp-2 text-xs font-semibold opacity-80">{example.rawPreview}</p>
                <details className="mt-3">
                  <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest">
                    Engineering detail
                  </summary>
                  <dl className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                    <DiffItem label="Heuristic" value={example.heuristicValue} />
                    <DiffItem label="Raw ML" value={example.rawMlValue} />
                    <DiffItem label="Raw BIO" value={example.rawBioValue} />
                    <DiffItem label="Guarded BIO" value={example.guardedBioValue} />
                    <DiffItem label="Hybrid final" value={example.hybridFinalValue} />
                    <DiffItem label="Gold" value={example.goldValue} />
                    <DiffItem label="Accepted source" value={example.acceptedSource} />
                    <DiffItem label="Rejected reason" value={example.rejectedReason} />
                    <DiffItem label="Readiness" value={example.readinessDelta} />
                    <DiffItem label="Rendered text" value={example.renderedTextDelta} />
                  </dl>
                </details>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReleaseReadinessSummary({ bundle }: { bundle: EvidenceBundleSummary }) {
  const cards = [
    bundle.cards.quality,
    bundle.cards.siteSpeed,
    bundle.cards.trainingData,
    bundle.cards.safeRollout,
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="font-label text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
            Parser Release Readiness
          </p>
          <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
            {bundle.finalVerdictLabel}
          </h3>
          <p className="mt-2 max-w-4xl text-sm font-semibold text-slate-600 dark:text-slate-300">
            {bundle.promotionAllowed
              ? "All release checks passed. Promotion still needs a separate reviewed release action."
              : bundle.topBlockingReasons[0] ?? "Promotion is blocked until the release checks pass."}
          </p>
        </div>
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm font-black uppercase tracking-widest",
            bundle.promotionAllowed
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
          )}
        >
          {bundle.promotionAllowed ? "Promotion allowed" : "Promotion blocked"}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <ReleaseReadinessCard key={card.id} card={card} />
        ))}
      </div>

      <details className="rounded-lg border border-slate-200 bg-white/90 p-4 dark:border-slate-800 dark:bg-slate-900/80">
        <summary className="cursor-pointer font-label text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
          View technical details
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-2 xl:grid-cols-3">
          <DiffItem label="Decision gates" value={bundle.advanced.decisionGateStatus} />
          <DiffItem label="Speed claim" value={bundle.advanced.throughputClaimStatus} />
          <DiffItem label="BIO promotion gate" value={bundle.advanced.bioPrimaryPromotionStatus} />
          <DiffItem label="Browser timings" value={bundle.advanced.browserTimingCount} />
          <DiffItem label="Mode runs" value={bundle.advanced.modeRunCount} />
          <DiffItem label="Comparisons" value={bundle.advanced.comparisonCount} />
          <DiffItem label="Datasets" value={bundle.advanced.datasetIds.join(", ")} />
          <DiffItem label="Live behavior changed" value={bundle.advanced.liveBehaviorChanged ? "yes" : "no"} />
          <DiffItem label="Hidden by default" value={bundle.advanced.hiddenTechnicalDetails.join(", ")} />
        </div>
      </details>
    </section>
  );
}

function ReleaseReadinessCard({ card }: { card: EvidenceReadinessCard }) {
  return (
    <div className={cn("rounded-lg border p-4", releaseReadinessCardClassName(card.status))}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-75">{card.label}</p>
          <p className="mt-2 text-xs font-semibold opacity-80">{card.question}</p>
        </div>
        <p className="rounded-md bg-white/60 px-2 py-1 text-[10px] font-black uppercase tracking-widest dark:bg-slate-950/40">
          {card.status.replace(/_/g, " ")}
        </p>
      </div>
      <p className="mt-3 text-sm font-semibold">{card.plainSummary}</p>
      {card.blockingReasons.length > 0 ? (
        <div className="mt-3 space-y-2">
          {card.blockingReasons.slice(0, 2).map((reason) => (
            <p key={reason} className="rounded-md bg-white/60 px-3 py-2 text-xs font-semibold dark:bg-slate-950/40">
              {reason}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function releaseReadinessCardClassName(status: EvidenceReadinessCard["status"]) {
  if (status === "pass") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100";
  }
  if (status === "fail" || status === "blocked") {
    return "border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100";
  }
  if (status === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100";
  }
  return "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100";
}

function StatusTile({ label, status }: { label: string; status: string }) {
  const isGood = status === "pass";
  const isBad = status === "fail";
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        isGood
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
          : isBad
            ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
      )}
    >
      <p className="text-[10px] font-black uppercase tracking-widest">{label}</p>
      <p className="mt-1 text-sm font-black uppercase">{status.replace(/_/g, " ")}</p>
    </div>
  );
}

function PlainSummaryBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
      <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{text}</p>
    </div>
  );
}

function PlainListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <p key={item} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

function DiffItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-slate-950/60">
      <dt className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[11px]">{formatUnknown(value)}</dd>
    </div>
  );
}

function AuditExample({ label, text, preview }: { label: string; text: string; preview: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{text}</p>
      <p className="mt-2 line-clamp-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{preview}</p>
    </div>
  );
}

function EmptyAuditMessage({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
      {text}
    </p>
  );
}

function prettySwitch(value: string | undefined) {
  return value ? value.replace(/_/g, " ") : "--";
}

function formatUnknown(value: unknown) {
  if (value == null || value === "") return "--";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function legacyEvidenceBundle(report: EvidenceReport): EvidenceBundleSummary {
  const summary = report.adminSummary ?? legacyEvidenceAdminSummary(report);
  const status = summary.overallStatus === "pass" ? "pass" : summary.overallStatus === "fail" ? "fail" : "not_measured";
  const qualityStatus = summary.qualityStatus === "pass" ? "pass" : summary.qualityStatus === "fail" ? "fail" : "not_measured";
  const siteSpeedStatus = summary.performanceStatus === "pass"
    ? "pass"
    : summary.performanceStatus === "fail"
      ? "fail"
      : summary.performanceStatus === "not_valid"
        ? "blocked"
        : "not_measured";
  const finalVerdict = status === "pass" ? "ready_for_shadow_testing" : "not_ready";

  return {
    schemaVersion: "parser_release_readiness.v1",
    title: "Parser Release Readiness",
    finalVerdict,
    finalVerdictLabel: finalVerdict === "ready_for_shadow_testing" ? "Ready for shadow testing" : "Not ready",
    promotionAllowed: false,
    topBlockingReasons: summary.topRisks.slice(0, 3),
    cards: {
      quality: {
        id: "quality",
        label: "Parsing Quality",
        question: "Are parsed references still correct?",
        status: qualityStatus,
        plainSummary: summary.headline,
        blockingReasons: qualityStatus === "pass" ? [] : summary.quality.slice(0, 3),
        advancedEvidence: summary.quality,
      },
      siteSpeed: {
        id: "siteSpeed",
        label: "Real Site Speed",
        question: "How fast is the actual browser experience?",
        status: siteSpeedStatus,
        plainSummary: summary.siteLaneTruth,
        blockingReasons: siteSpeedStatus === "pass" ? [] : [summary.siteLaneTruth],
        advancedEvidence: [summary.siteLaneTruth],
      },
      trainingData: {
        id: "trainingData",
        label: "Training Data Health",
        question: "Is the model trained on trusted, clean data?",
        status: "not_measured",
        plainSummary: "Training data health was not captured in this saved report.",
        blockingReasons: ["Run a fresh ML/BIO evidence report to see training data readiness."],
        advancedEvidence: [],
      },
      safeRollout: {
        id: "safeRollout",
        label: "Safe Rollout",
        question: "Can this be released without changing live behavior unsafely?",
        status: status === "pass" ? "warning" : "blocked",
        plainSummary: summary.recommendedNextAction,
        blockingReasons: status === "pass" ? ["Live promotion still needs the new evidence bundle gates."] : [summary.recommendedNextAction],
        advancedEvidence: report.conclusions,
      },
    },
    advanced: {
      decisionGateStatus: report.decisionGates.status,
      throughputClaimStatus: report.throughputSummary?.claimStatus ?? "browser_not_measured",
      bioPrimaryPromotionStatus: report.bioPrimaryPromotionGate?.status ?? "not_measured",
      browserTimingCount: report.browserTimings?.length ?? 0,
      modeRunCount: report.modeRuns.length,
      comparisonCount: report.comparisons.length,
      datasetIds: report.datasets.map((dataset) => dataset.id),
      liveBehaviorChanged: false,
      hiddenTechnicalDetails: [
        "direct engine lane",
        "backend convert route lane",
        "queued job runtime lane",
        "BIO raw and guarded lanes",
      ],
    },
  };
}

function legacyEvidenceAdminSummary(report: EvidenceReport): NonNullable<EvidenceReport["adminSummary"]> {
  const status = report.decisionGates.status === "pass" ? "pass" : report.decisionGates.status === "insufficient_truth" ? "insufficient_truth" : "fail";
  return {
    overallStatus: status,
    qualityStatus: status,
    performanceStatus: "not_measured",
    headline: status === "pass" ? "Evidence gates passed." : "Evidence needs review.",
    whatRan: [],
    quality: report.decisionGates.checks.map((check) => `${check.status.toUpperCase()}: ${check.message}`),
    bioImpact: "This saved report was generated before the simplified BIO impact summary existed.",
    mlImpact: "This saved report was generated before the simplified ML impact summary existed.",
    siteLaneTruth: "This saved report was generated before the simplified site path summary existed.",
    topRisks: report.conclusions.slice(0, 3),
    recommendedNextAction: "Run a fresh ML/BIO evidence report to see the simplified admin summary.",
  };
}

function EvidenceSection({
  report,
  isPending,
}: {
  report: EvidenceReport | null;
  isPending: boolean;
}) {
  const goldRuns = report?.modeRuns.filter((run) => run.datasetId === "gold_style_core") ?? [];
  const bottlenecks = report?.modeRuns
    .flatMap((run) => run.stageBottlenecks.map((stage) => ({ run, stage })))
    .sort((left, right) => right.stage.totalMs - left.stage.totalMs)
    .slice(0, 12) ?? [];
  const bioCandidate = report?.modeRuns.find(
    (run) => run.datasetId === "gold_style_core" && run.mode === "hybrid_with_bio_candidate_shadow",
  );
  const typeComparison = report?.comparisons.find(
    (comparison) => comparison.datasetId === "gold_style_core" && comparison.candidateMode === "hybrid_with_bio_candidate_shadow",
  );
  const typeMlEvaluation = typeComparison?.typeMlEvaluation;
  const healthHotspotAudit = bioCandidate?.healthHotspotAudit;
  const duplicateAudit = bioCandidate?.duplicateAudit;
  const regressions = report?.comparisons
    .filter((comparison) => comparison.regressed > 0 || comparison.criticalFieldLossCount > 0)
    .slice(0, 10) ?? [];

  return (
    <section className="space-y-8">
      <div className="flex flex-col gap-2">
        <p className="font-label text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
          ML/BIO Evidence
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Phase comparison report
        </h2>
        <p className="max-w-4xl text-sm text-slate-600 dark:text-slate-300">
          Evidence-only lanes for heuristics, ML/BIO shadow output, current hybrid output, BIO-primary phase readiness, duplicate detection, health flags, and throughput.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Gate Status"
          value={isPending ? "RUNNING" : report ? report.decisionGates.status.toUpperCase() : "--"}
          tone={report?.decisionGates.status === "pass" ? "success" : report ? "danger" : "neutral"}
        />
        <MetricCard
          label="Datasets"
          value={report ? report.datasets.length.toLocaleString() : "--"}
        />
        <MetricCard
          label="Gold Modes"
          value={goldRuns.length.toLocaleString()}
        />
        <MetricCard
          label="BIO Entities"
          value={bioCandidate ? bioCandidate.bioAttribution.entityEmitted.toLocaleString() : "--"}
        />
        <MetricCard
          label="BIO Accepted"
          value={bioCandidate ? bioCandidate.bioAttribution.patchAccepted.toLocaleString() : "--"}
        />
      </div>

      {isPending ? (
        <div className={cn(cardClassName, "py-16 text-center font-headline text-2xl italic text-slate-500 dark:text-slate-400")}>
          Running ML/BIO evidence report...
        </div>
      ) : report ? (
        <>
          <AdminEvidencePlainSummary report={report} />

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
            <div className={cardClassName}>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Decision gates
              </h3>
              <div className="space-y-3">
                {report.decisionGates.checks.map((check) => (
                  <div
                    key={check.id}
                    className={cn(
                      "rounded-xl border px-4 py-3",
                      check.status === "pass"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
                        : check.status === "fail"
                          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                          : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-widest">{check.id.replace(/_/g, " ")}</p>
                      <p className="text-xs font-black">{check.status.toUpperCase()}</p>
                    </div>
                    <p className="mt-1 text-xs font-semibold">{check.message}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={cardClassName}>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Conclusions
              </h3>
              <div className="space-y-2">
                {report.conclusions.map((conclusion) => (
                  <p key={conclusion} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-950 dark:text-slate-200">
                    {conclusion}
                  </p>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                {report.datasets.map((dataset) => (
                  <SummaryItem
                    key={dataset.id}
                    label={dataset.truthAvailable ? `${dataset.id} truth` : dataset.id}
                    value={`${dataset.rowCount.toLocaleString()} rows`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className={cardClassName}>
            <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              BIO primary phase map
            </h3>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {report.bioPrimaryApplicability.map((phase) => (
                <div key={phase.phaseId} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                      {phase.phaseId.replace(/_/g, " ")}
                    </p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest",
                        phase.currentStatus === "primary_candidate"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                          : phase.currentStatus === "selective_patch"
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                            : "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
                      )}
                    >
                      {phase.currentStatus.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-200">{phase.intendedRole}</p>
                  <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{phase.currentRole}</p>
                  <div className="mt-3 space-y-2">
                    {phase.requiredBeforePromotion.map((item) => (
                      <p key={item} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
            <div className={cardClassName}>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Type ML audit
              </h3>
              {typeMlEvaluation ? (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {typeMlEvaluation.plainSummary}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <SummaryItem label="Helped" value={typeMlEvaluation.helped.toLocaleString()} />
                    <SummaryItem label="Hurt" value={typeMlEvaluation.hurtIfAccepted.toLocaleString()} />
                    <SummaryItem label="Type changes" value={typeMlEvaluation.finalTypeChanges.toLocaleString()} />
                    <SummaryItem label="Recommendation" value={typeMlEvaluation.recommendation.replace(/_/g, " ")} />
                  </div>
                  {typeMlEvaluation.examples.slice(0, 3).map((example) => (
                    <AuditExample
                      key={`type-${example.index}-${example.outcome}`}
                      label={`Reference ${example.index + 1} · ${example.outcome}`}
                      text={`${formatUnknown(example.heuristicType)} → ${formatUnknown(example.mlType)}; gold ${formatUnknown(example.goldType)}`}
                      preview={example.rawPreview}
                    />
                  ))}
                </div>
              ) : (
                <EmptyAuditMessage text="Type ML comparison is not available in this saved report." />
              )}
            </div>

            <div className={cardClassName}>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Action explanations
              </h3>
              {healthHotspotAudit ? (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {healthHotspotAudit.plainSummary}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <SummaryItem label="Needs action" value={healthHotspotAudit.needsAction.toLocaleString()} />
                    <SummaryItem label="Visible reasons" value={healthHotspotAudit.visibleReasons.toLocaleString()} />
                    <SummaryItem label="Missing visible reason" value={healthHotspotAudit.needsActionWithoutVisibleReason.toLocaleString()} />
                    <SummaryItem label="Cause types" value={Object.keys(healthHotspotAudit.topCauses).length.toLocaleString()} />
                  </div>
                  {healthHotspotAudit.examples.slice(0, 3).map((example) => (
                    <AuditExample
                      key={`health-${example.index}-${example.technicalReason}`}
                      label={`Reference ${example.index + 1} · ${example.technicalReason.replace(/_/g, " ")}`}
                      text={example.plainReason}
                      preview={example.rawPreview}
                    />
                  ))}
                </div>
              ) : (
                <EmptyAuditMessage text="Health hotspot audit is not available in this saved report." />
              )}
            </div>

            <div className={cardClassName}>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Duplicate audit
              </h3>
              {duplicateAudit ? (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {duplicateAudit.plainSummary}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <SummaryItem label="Candidate groups" value={duplicateAudit.candidateGroups.toLocaleString()} />
                    <SummaryItem label="Likely correct" value={duplicateAudit.likelyCorrectGroups.toLocaleString()} />
                    <SummaryItem label="Needs review" value={duplicateAudit.needsReviewGroups.toLocaleString()} />
                    <SummaryItem label="Likely false" value={duplicateAudit.likelyFalsePositiveGroups.toLocaleString()} />
                  </div>
                  {duplicateAudit.falseDuplicateExamples.slice(0, 2).map((example) => (
                    <AuditExample
                      key={`duplicate-${example.groupId}`}
                      label={`${example.method.replace(/_/g, " ")} · ${example.clusterSize} refs`}
                      text={example.rawPreviews.join(" / ")}
                      preview={duplicateAudit.mainFalsePositiveCause ? `Main cause: ${duplicateAudit.mainFalsePositiveCause.replace(/_/g, " ")}` : "No main false-positive cause reported."}
                    />
                  ))}
                </div>
              ) : (
                <EmptyAuditMessage text="Duplicate precision audit is not available in this saved report." />
              )}
            </div>
          </div>

          <div className={cardClassName}>
            <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Gold mode comparison
            </h3>
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 dark:bg-slate-950">
                  <tr>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2 text-right">Refs/s</th>
                    <th className="px-3 py-2 text-right">Ready</th>
                    <th className="px-3 py-2 text-right">Action</th>
                    <th className="px-3 py-2 text-right">False ready</th>
                    <th className="px-3 py-2 text-right">BIO entities</th>
                    <th className="px-3 py-2 text-right">ML attempted</th>
                    <th className="px-3 py-2 text-right">Dup groups</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {goldRuns.map((run) => (
                    <tr key={`${run.datasetId}-${run.mode}`}>
                      <td className="px-3 py-2 font-black text-slate-800 dark:text-slate-100">{run.mode}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatNumber(run.refsPerSecond)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{run.summary.ready}</td>
                      <td className="px-3 py-2 text-right font-semibold">{run.summary.needsAction}</td>
                      <td className="px-3 py-2 text-right font-semibold">{run.readiness.falseReady}</td>
                      <td className="px-3 py-2 text-right font-semibold">{run.bioAttribution.entityEmitted}</td>
                      <td className="px-3 py-2 text-right font-semibold">{run.mlAttribution.attemptedRefs}</td>
                      <td className="px-3 py-2 text-right font-semibold">{run.duplicateMetrics.predictedGroups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
            <div className={cardClassName}>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Bottlenecks
              </h3>
              <div className="space-y-3">
                {bottlenecks.map(({ run, stage }) => (
                  <div key={`${run.mode}-${run.datasetId}-${stage.phaseId}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <span>{stage.phaseId}</span>
                      <span>{formatMs(stage.totalMs)} · p95 {formatMs(stage.p95Ms)}</span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {run.mode} / {run.datasetId}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className={cardClassName}>
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                Regressions
              </h3>
              {regressions.length > 0 ? (
                <div className="space-y-3">
                  {regressions.map((comparison) => (
                    <div key={`${comparison.datasetId}-${comparison.candidateMode}`} className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                      <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest">
                        <span>{comparison.candidateMode}</span>
                        <span>{comparison.datasetId}</span>
                      </div>
                      <p className="mt-1 text-xs font-semibold">
                        Critical losses {comparison.criticalFieldLossCount}; wrong overwrites {comparison.wrongOverwriteCount}; regressed {comparison.regressed}; false positives {comparison.newFalsePositive}.
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  No regression comparisons reported.
                </p>
              )}
            </div>
          </div>

          <div className={cardClassName}>
            <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Evidence JSON
            </h3>
            <pre className="max-h-[34rem] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
              {JSON.stringify(report, null, 2)}
            </pre>
          </div>
        </>
      ) : (
        <div className={cn(cardClassName, "py-16 text-center font-headline text-2xl italic text-slate-500 dark:text-slate-400")}>
          No ML/BIO evidence report yet.
        </div>
      )}
    </section>
  );
}
