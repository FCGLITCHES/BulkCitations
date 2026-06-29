import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AdminShell } from "./AdminShell";
import { AdminSectionTabs } from "./AdminSectionTabs";
import { AdminRequestError, adminFetch } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AdminTrainingHelpLabel as HelpLabel } from "./admin-training/AdminTrainingHelpLabel";
import { cardClass } from "./admin-training/constants";
import type { BioTrainingStatusResponse } from "./admin-training/types";
import { AdminBioReview } from "./admin-training/AdminBioReview";
import { cn } from "@/lib/utils";

type BioSubtabId = "tagging" | "training" | "runtime" | "review";
const GOLD_BIO_BUNDLE_VERSION = "GOLD-BIO-Tagging-Dataset";
const SELECTED_BIO_DATASET_STORAGE_KEY = "admin-bio-selected-dataset";

const BIO_SUBTABS: Array<{
  id: BioSubtabId;
  href: string;
  label: string;
  description: string;
}> = [
  {
    id: "tagging",
    href: "/admin/review/bio/tagging",
    label: "Tagging",
    description: "Processed BIO dataset artifacts and tagging inventory.",
  },
  {
    id: "training",
    href: "/admin/review/bio/training",
    label: "Training",
    description: "Stage and promote BIO bundles from the Review area.",
  },
  {
    id: "runtime",
    href: "/admin/review/bio/runtime",
    label: "Runtime",
    description:
      "Live BIO bundle metadata, staged versions, and runtime status.",
  },
  {
    id: "review",
    href: "/admin/review/bio/review",
    label: "Review",
    description:
      "Correct flagged references and approve verified rows to gold.",
  },
];

// Day-to-day admin work only needs Tagging (pick the gold dataset) + Review
// (correct flagged refs). Training/Runtime are ML-ops controls, hidden behind
// an "Advanced" toggle so the default surface stays simple.
const ESSENTIAL_BIO_SUBTAB_IDS: BioSubtabId[] = ["tagging", "review"];

function buildAutoBioBundleVersion(now = new Date()): string {
  void now;
  return GOLD_BIO_BUNDLE_VERSION;
}

type AvailableBioDataset =
  BioTrainingStatusResponse["datasets"]["availableDatasets"][number];

function canUseStorage(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function readStoredSelectedBioDataset(): string {
  if (!canUseStorage()) {
    return "";
  }

  try {
    return window.localStorage.getItem(SELECTED_BIO_DATASET_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredSelectedBioDataset(value: string): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    if (value) {
      window.localStorage.setItem(SELECTED_BIO_DATASET_STORAGE_KEY, value);
      return;
    }

    window.localStorage.removeItem(SELECTED_BIO_DATASET_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep the in-memory selection usable.
  }
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof AdminRequestError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed.";
}

function extractFileNameFromPath(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const parts = value.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function resolveDatasetRowCount(
  datasetStats: Record<string, unknown> | null | undefined,
): number | null {
  const rowsTotal = datasetStats?.rows_total;
  if (typeof rowsTotal === "number" && Number.isFinite(rowsTotal)) {
    return rowsTotal;
  }

  const total = datasetStats?.total;
  if (typeof total === "number" && Number.isFinite(total)) {
    return total;
  }

  return null;
}

function resolveSelectedDatasetFile(
  availableDatasets: AvailableBioDataset[],
  selectedDatasetFile: string,
  liveDatasetFile: string | null,
): string {
  if (
    selectedDatasetFile &&
    availableDatasets.some(
      (dataset) => dataset.fileName === selectedDatasetFile,
    )
  ) {
    return selectedDatasetFile;
  }

  if (
    liveDatasetFile &&
    availableDatasets.some((dataset) => dataset.fileName === liveDatasetFile)
  ) {
    return liveDatasetFile;
  }

  return availableDatasets[0]?.fileName ?? "";
}

export default function AdminBioTraining() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [promotionVersion, setPromotionVersion] = useState("");
  const [selectedDatasetFile, setSelectedDatasetFile] = useState(() =>
    readStoredSelectedBioDataset(),
  );

  const statusQuery = useQuery({
    queryKey: ["/internal/admin/bio-training-status"],
    queryFn: async () =>
      adminFetch<BioTrainingStatusResponse>(
        "/internal/admin/bio-training-status",
      ),
    placeholderData: (previousData) => previousData,
  });

  const status = statusQuery.data;
  const availableDatasets = status?.datasets.availableDatasets ?? [];
  const totalDatasetRows = availableDatasets.reduce(
    (sum, dataset) => sum + dataset.rowCount,
    0,
  );
  const liveBundle = status?.bundle.current;
  const liveDatasetRows = resolveDatasetRowCount(liveBundle?.datasetStats);
  const liveDatasetFile = extractFileNameFromPath(liveBundle?.datasetSource);
  const selectedDataset = resolveSelectedDatasetFile(
    availableDatasets,
    selectedDatasetFile,
    liveDatasetFile,
  );
  const stagedVersions = status?.bundle.stagedVersions ?? [];
  const promotedVersions = status?.bundle.promotedVersions ?? [];
  const effectivePromotionVersion =
    promotionVersion ||
    (stagedVersions.includes(GOLD_BIO_BUNDLE_VERSION)
      ? GOLD_BIO_BUNDLE_VERSION
      : stagedVersions[0] || "");
  const activeSubtab: BioSubtabId =
    location.startsWith("/admin/bio-training/review") ||
    location.startsWith("/admin/review/bio/review")
      ? "review"
      : location.startsWith("/admin/bio-training/training") ||
          location.startsWith("/admin/review/bio/training")
        ? "training"
        : location.startsWith("/admin/bio-training/runtime") ||
            location.startsWith("/admin/review/bio/runtime")
          ? "runtime"
          : "tagging";

  // Advanced (training + runtime) is hidden by default; auto-open it if the admin
  // deep-linked straight to one of those tabs so they still see what they navigated to.
  const [showAdvanced, setShowAdvanced] = useState(
    () => activeSubtab === "training" || activeSubtab === "runtime",
  );
  const visibleSubtabs = showAdvanced
    ? BIO_SUBTABS
    : BIO_SUBTABS.filter((tab) => ESSENTIAL_BIO_SUBTAB_IDS.includes(tab.id));

  const saveSelectedDataset = (datasetFile: string) => {
    setSelectedDatasetFile(datasetFile);
    writeStoredSelectedBioDataset(datasetFile);
  };

  const refreshStatus = () => {
    void queryClient.invalidateQueries({
      queryKey: ["/internal/admin/bio-training-status"],
    });
  };

  const buildMutation = useMutation({
    mutationFn: async () =>
      adminFetch<{
        version: string;
        datasetFile: string;
        trainer: { datasetStats?: { total?: number } };
      }>("/internal/admin/bio-bundle/build", {
        method: "POST",
        body: JSON.stringify({
          version: buildAutoBioBundleVersion(),
          datasetFile: selectedDataset || undefined,
        }),
      }),
    onSuccess: (payload) => {
      refreshStatus();
      saveSelectedDataset(payload.datasetFile);
      setPromotionVersion(payload.version);
      toast({
        title: "BIO bundle staged",
        description: `${payload.version} trained from ${payload.datasetFile}.`,
      });
    },
    onError: (error) => {
      toast({
        title: "BIO training failed",
        description: buildErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async () =>
      adminFetch<{ version: string }>("/internal/admin/bio-bundle/promote", {
        method: "POST",
        body: JSON.stringify({ version: effectivePromotionVersion }),
      }),
    onSuccess: (payload) => {
      refreshStatus();
      toast({
        title: "BIO bundle promoted",
        description: `${payload.version} is now the live BIO extractor bundle.`,
      });
    },
    onError: (error) => {
      toast({
        title: "BIO promotion failed",
        description: buildErrorMessage(error),
        variant: "destructive",
      });
    },
  });
  const trainingBusy = buildMutation.isPending || promoteMutation.isPending;
  const mlHealthLabel =
    status?.mlHealth?.healthy === true
      ? "healthy"
      : status?.mlHealth?.healthy === false
        ? "degraded"
        : (status?.mlHealth?.status ?? "unknown");

  return (
    <AdminShell
      title="BIO"
      subtitle="BIO tagging, bundle training, and runtime inspection."
    >
      <div className="flex flex-col gap-6">
        <AdminSectionTabs />
        <section className={cn(cardClass, "flex flex-col gap-5")}>
          <div className="space-y-1">
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              BIO review workflow
            </h2>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Tagging, bundle training, and runtime — all in one place.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800/60 dark:bg-[#0c111b]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Processed BIO datasets
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {availableDatasets.length}
              </div>
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {formatNumber(totalDatasetRows)} tagged rows across{" "}
                {availableDatasets.length} files
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800/60 dark:bg-[#0c111b]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Live BIO bundle
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                {liveBundle?.modelVersion ?? "not promoted"}
              </div>
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Labels: {formatNumber(liveBundle?.labels.length ?? null)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800/60 dark:bg-[#0c111b]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Runtime status
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                {mlHealthLabel}
              </div>
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Live rows: {formatNumber(liveDatasetRows ?? null)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-2 dark:border-slate-800/60 dark:bg-[#121826]">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                BIO workflow
              </span>
              <button
                type="button"
                onClick={() => setShowAdvanced((value) => !value)}
                className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {showAdvanced
                  ? "Hide advanced"
                  : "Show advanced (training & runtime)"}
              </button>
            </div>
            <div
              className={cn(
                "grid gap-2",
                showAdvanced ? "md:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2",
              )}
            >
              {visibleSubtabs.map((tab) => {
                const isActive = activeSubtab === tab.id;

                return (
                  <Link key={tab.id} href={tab.href}>
                    <button
                      type="button"
                      className={cn(
                        "flex h-full w-full flex-col items-start gap-1 rounded-xl px-4 py-3 text-left transition-colors",
                        isActive
                          ? "bg-[#002147] text-white dark:bg-[#0f4fa8]"
                          : "border border-slate-200/80 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800/60 dark:bg-[#0c111b] dark:text-slate-200 dark:hover:bg-slate-900",
                      )}
                    >
                      <span className="text-sm font-semibold">{tab.label}</span>
                      <span
                        className={cn(
                          "text-xs",
                          isActive
                            ? "text-white/80"
                            : "text-slate-500 dark:text-slate-400",
                        )}
                      >
                        {tab.description}
                      </span>
                    </button>
                  </Link>
                );
              })}
            </div>
          </div>

          {activeSubtab === "tagging" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/60 dark:bg-[#121826]">
                <div className="mb-3">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Processed BIO datasets
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Select the processed BIO dataset to use in Training.
                    Selection is saved immediately and does not trigger bundle
                    training or promotion by itself.
                  </p>
                </div>
                {availableDatasets.length ? (
                  <div className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                    {availableDatasets.map((dataset) => {
                      const isSelected = selectedDataset === dataset.fileName;
                      const isLiveGoldDataset =
                        liveDatasetFile === dataset.fileName &&
                        liveBundle?.modelVersion === GOLD_BIO_BUNDLE_VERSION;

                      return (
                        <button
                          key={dataset.fileName}
                          type="button"
                          className={cn(
                            "flex flex-col gap-2 rounded-xl border px-4 py-3 text-left transition-colors",
                            isLiveGoldDataset
                              ? "border-emerald-300 bg-emerald-50/90 dark:border-emerald-500/70 dark:bg-emerald-950/20"
                              : isSelected
                                ? "border-slate-300 bg-slate-100/90 dark:border-slate-500 dark:bg-slate-900/70"
                                : "border-slate-200/80 bg-slate-50 hover:bg-slate-100 dark:border-slate-800/60 dark:bg-[#0c111b] dark:hover:bg-slate-900/70",
                            trainingBusy ? "cursor-wait opacity-70" : "",
                          )}
                          disabled={trainingBusy}
                          onClick={() => {
                            saveSelectedDataset(dataset.fileName);
                            setPromotionVersion("");
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                              {dataset.fileName}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {formatTimestamp(dataset.updatedAt)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                            <span className="truncate">{dataset.path}</span>
                            <span>{`${dataset.rowCount} rows • ${formatNumber(dataset.sizeBytes)} bytes`}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em]">
                            {isLiveGoldDataset ? (
                              <span className="rounded-full bg-emerald-600 px-2 py-1 text-white dark:bg-emerald-500 dark:text-slate-950">
                                Live gold dataset
                              </span>
                            ) : null}
                            {isSelected && !isLiveGoldDataset ? (
                              <span className="rounded-full bg-slate-900 px-2 py-1 text-white dark:bg-slate-100 dark:text-slate-950">
                                Saved selection
                              </span>
                            ) : null}
                            <span className="text-slate-500 dark:text-slate-400">
                              Click to select for BIO training
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No processed BIO JSONL artifacts were found under the
                    citation-bio dataset track.
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/60 dark:bg-[#121826]">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Tagging scope
                </h2>
                <div className="mt-3 grid gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Saved selection
                    </div>
                    <div className="mt-2 break-all text-xs">
                      {selectedDataset || "n/a"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Gold bundle version
                    </div>
                    <div className="mt-2 break-all text-xs">
                      {GOLD_BIO_BUNDLE_VERSION}
                    </div>
                  </div>
                  {showAdvanced ? (
                    <>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          Dataset root
                        </div>
                        <div className="mt-2 break-all text-xs">
                          {status?.datasets.datasetRoot ?? "n/a"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          Processed root
                        </div>
                        <div className="mt-2 break-all text-xs">
                          {status?.datasets.processedRoot ?? "n/a"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          Ownership
                        </div>
                        <div className="mt-2 text-sm">
                          Tagging data, BIO bundle training, and BIO promotion stay
                          under this BIO tab so the main Training tab only handles
                          style models and benchmark rollout.
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeSubtab === "training" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
              <div className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/60 dark:bg-[#121826]">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="grid gap-1">
                    <HelpLabel
                      label="Gold BIO bundle version"
                      help="BIO admin training always stages the fixed gold bundle name used for engine rollout."
                    />
                    <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {GOLD_BIO_BUNDLE_VERSION}
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="bio-dataset-file"
                      label="Processed BIO dataset"
                      help="Choose a processed BIO JSONL artifact from the separate citation-span dataset track."
                    />
                    <select
                      id="bio-dataset-file"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={selectedDataset}
                      onChange={(event) => {
                        saveSelectedDataset(event.target.value);
                        setPromotionVersion("");
                      }}
                      disabled={availableDatasets.length === 0 || trainingBusy}
                    >
                      {availableDatasets.length === 0 ? (
                        <option value="">
                          No processed BIO datasets found
                        </option>
                      ) : null}
                      {availableDatasets.map((dataset) => (
                        <option key={dataset.fileName} value={dataset.fileName}>
                          {`${dataset.fileName} • ${dataset.rowCount} rows`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      label="Stage a BIO bundle"
                      help="Trains the ONNX token-classification bundle from the selected processed BIO dataset. Large BIO datasets can take several minutes."
                    />
                    <Button
                      type="button"
                      className="h-10 min-w-[180px]"
                      disabled={trainingBusy || !selectedDataset}
                      onClick={() => buildMutation.mutate()}
                    >
                      {buildMutation.isPending
                        ? "Training BIO bundle..."
                        : "Train BIO bundle"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="bio-promote-version"
                      label="Staged version to promote"
                      help="Promotes a staged BIO bundle into the live extractor slot."
                    />
                    <select
                      id="bio-promote-version"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={effectivePromotionVersion}
                      onChange={(event) =>
                        setPromotionVersion(event.target.value)
                      }
                      disabled={stagedVersions.length === 0}
                    >
                      {stagedVersions.length === 0 ? (
                        <option value="">No staged BIO bundles</option>
                      ) : null}
                      {stagedVersions.map((version) => (
                        <option key={version} value={version}>
                          {version}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      label="Promote to engine"
                      help="Copies the staged BIO bundle into the live model location used by extraction."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 min-w-[180px]"
                      disabled={trainingBusy || !effectivePromotionVersion}
                      onClick={() => promoteMutation.mutate()}
                    >
                      {promoteMutation.isPending
                        ? "Updating engine..."
                        : "Use in engine"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/60 dark:bg-[#121826]">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  BIO training flow
                </h2>
                <div className="mt-3 grid gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                    1. Tagging saves the processed dataset you want to train
                    next. It does not call the trainer or the engine.
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                    2. Train BIO bundle stages {GOLD_BIO_BUNDLE_VERSION} from
                    the saved dataset selection using the faster interactive
                    admin training budget.
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                    3. Large dataset training is expected to run for minutes,
                    but the request now stays open long enough for the bundle
                    job to finish before promotion.
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/60 dark:bg-[#0c111b]">
                    4. Use in engine promotes the staged gold bundle into the
                    live BIO runtime.
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeSubtab === "runtime" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 text-sm dark:border-slate-800/60 dark:bg-[#121826]">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Live bundle detail
                  </h2>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    Current promoted extractor metadata and runtime checks.
                  </p>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex items-center justify-between gap-3">
                    <span>Version</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {liveBundle?.modelVersion ?? "not promoted"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Feature version</span>
                    <span>{liveBundle?.featureVersion ?? "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Bundle type</span>
                    <span>{liveBundle?.bundleType ?? "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Dataset track</span>
                    <span>{liveBundle?.datasetTrack ?? "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Live source dataset</span>
                    <span>{liveDatasetFile ?? "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Generated</span>
                    <span>{formatTimestamp(liveBundle?.generatedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Runtime health</span>
                    <span>{mlHealthLabel}</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-xl border border-slate-200/80 bg-white p-3 text-xs text-slate-600 dark:border-slate-800/60 dark:bg-[#121826] dark:text-slate-300">
                  <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                    Staged BIO bundles
                  </div>
                  {stagedVersions.length ? (
                    stagedVersions.map((version) => (
                      <div key={version} className="py-1">
                        {version}
                      </div>
                    ))
                  ) : (
                    <div>None staged.</div>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-white p-3 text-xs text-slate-600 dark:border-slate-800/60 dark:bg-[#121826] dark:text-slate-300">
                  <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                    Promoted versions
                  </div>
                  {promotedVersions.length ? (
                    promotedVersions.map((version) => (
                      <div key={version} className="py-1">
                        {version}
                      </div>
                    ))
                  ) : (
                    <div>None promoted.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {activeSubtab === "review" ? <AdminBioReview /> : null}
        </section>
      </div>
    </AdminShell>
  );
}
