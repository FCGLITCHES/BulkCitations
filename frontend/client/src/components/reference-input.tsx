import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { SAMPLE_MIXED_REFERENCES } from "@/lib/sampleReferences";
import { formatEngineApiError } from "@/lib/engine-api-errors";
import {
  computeEngineJobWaitTimeoutMs,
  inspectEngineInput,
  resolveSourceTypeFromMode,
  startEngineConvert,
  waitForEngineJob,
} from "@/lib/engine-api";
import {
  ENGINE_INPUT_MODE_OPTIONS,
  ENGINE_OUTPUT_STYLE_OPTIONS,
  type EngineInputMode,
  type EngineInspectResponse,
  type EngineResultModel,
  type EngineDetectedFormat,
} from "@/lib/engine-types";
import { useToast } from "@/hooks/use-toast";
import { countEngineLikeInputReferences } from "@shared/liveReferenceDetection";

interface ReferenceInputProps {
  onConversionResult: (response: EngineResultModel) => void;
  onProcessingStart: (totalRefs: number) => void;
  onProcessingUpdate?: (title: string, message: string) => void;
  onProcessingEnd: () => void;
  onError: (error: string) => void;
  isProcessing: boolean;
  groupDuplicates?: boolean;
  onGroupDuplicatesChange?: (value: boolean) => void;
  autoCheckPro?: boolean;
  onAutoCheckProChange?: (value: boolean) => void;
  initialCaptureText?: string;
}

export default function ReferenceInput({
  onConversionResult,
  onProcessingStart,
  onProcessingUpdate,
  onProcessingEnd,
  onError,
  isProcessing,
  groupDuplicates = false,
  onGroupDuplicatesChange,
  autoCheckPro = false,
  onAutoCheckProChange,
  initialCaptureText = "",
}: ReferenceInputProps) {
  const [inputText, setInputText] = useState(initialCaptureText);
  const [inputMode, setInputMode] = useState<EngineInputMode>("auto");
  const [outputStyle, setOutputStyle] = useState("apa7");
  const [referenceCount, setReferenceCount] = useState(0);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const [inspectResult, setInspectResult] = useState<EngineInspectResponse | null>(null);
  const [showSplitPreview, setShowSplitPreview] = useState(false);
  const [inputCleanupOptions, setInputCleanupOptions] = useState<InputCleanupOptions>({
    removeDoi: false,
    removeUrls: false,
  });
  const { toast } = useToast();
  const preparedInputText = applyInputCleanupOptions(inputText, inputCleanupOptions);
  const preparedTrimmedInputText = preparedInputText.trim();

  const handleInputChange = (value: string) => {
    setInputText(value);

    if (!value.trim()) {
      setReferenceCount(0);
      setInspectResult(null);
      setShowSplitPreview(false);
      return;
    }

    setReferenceCount(countEngineLikeInputReferences(applyInputCleanupOptions(value, inputCleanupOptions)));
  };

  const processUploadedFile = async (file: File) => {
    const allowedTypes = ["text/plain", "application/x-research-info-systems", "application/xml"];
    const allowedExtensions = [".txt", ".ris", ".bib", ".csv"];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf("."));

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      onError("Please upload a text-based bibliography file such as .txt, .ris, .bib, or .csv");
      return;
    }

    setIsFileUploading(true);

    try {
      const text = await file.text();
      handleInputChange(text);

      toast({
        title: "File uploaded",
        description: `Loaded ${file.name} into the engine workspace.`,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to read file content");
    } finally {
      setIsFileUploading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await processUploadedFile(file);
    } finally {
      event.target.value = "";
    }
  };

  useEffect(() => {
    if (!initialCaptureText) return;
    handleInputChange(initialCaptureText);
  }, [initialCaptureText]);

  useEffect(() => {
    setReferenceCount(
      preparedTrimmedInputText ? countEngineLikeInputReferences(preparedInputText) : 0,
    );
  }, [preparedInputText, preparedTrimmedInputText]);

  useEffect(() => {
    const trimmed = preparedTrimmedInputText;

    if (!trimmed || isProcessing) {
      setInspectResult(null);
      return;
    }

    if (referenceCount >= 250 && !showSplitPreview) {
      setInspectResult(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const sourceType = resolveSourceTypeFromMode(inputMode, trimmed);

      void inspectEngineInput({
        sourceType,
        content: trimmed,
      })
        .then((result) => {
          setInspectResult(result);
          setReferenceCount(result.splitCount);
        })
        .catch(() => {
          setInspectResult(null);
        });
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [inputMode, isProcessing, preparedTrimmedInputText, referenceCount, showSplitPreview]);

  const handleConvert = async () => {
    const source = preparedTrimmedInputText;
    if (!source) {
      onError("Please enter some references to convert");
      return;
    }

    const sourceType = resolveSourceTypeFromMode(inputMode, source, inspectResult?.detectedFormat);
    const totalReferences = Math.max(inspectResult?.splitCount ?? referenceCount, 1);

    onProcessingStart(totalReferences);
    onProcessingUpdate?.(
      "Profiling complete",
      inspectResult
        ? `${inspectResult.splitCount} reference${inspectResult.splitCount === 1 ? "" : "s"} ready for conversion`
        : `Preparing ${totalReferences} reference${totalReferences === 1 ? "" : "s"}`,
    );

    try {
      const started = await startEngineConvert({
        sourceType,
        content: source,
        outputStyle,
        options: {
          parseProfile: "core_parse_fast",
          enrich: true,
          dedup: groupDuplicates,
          groupDuplicates,
          debug: false,
        },
      });

      if (started.kind === "completed") {
        onConversionResult(started.result);
        return;
      }

      onProcessingUpdate?.(
        "Batch queued",
        `Job ${started.job.jobId.slice(0, 8)} is running through the engine pipeline`,
      );

      const result = await waitForEngineJob(started.job.jobId, {
        timeoutMs: computeEngineJobWaitTimeoutMs(totalReferences),
        intervalMs: computeEngineJobPollIntervalMs(totalReferences),
        onUpdate: (job) => {
          const percent = job.progress?.percentComplete ?? 0;
          const phase = job.progress?.currentPhase ?? "processing";
          onProcessingUpdate?.(
            job.status === "pending" ? "Queued batch..." : "Processing citations...",
            `${phase.replace(/_/g, " ")}${percent > 0 ? ` • ${Math.round(percent)}%` : ""}`,
          );
        },
      });

      onConversionResult(result);
    } catch (error) {
      onError(normalizeConvertError(error));
    } finally {
      onProcessingEnd();
    }
  };

  const handleClear = () => {
    setInputText("");
    setInspectResult(null);
    setReferenceCount(0);
    setShowSplitPreview(false);
  };

  const splitPreview = showSplitPreview ? buildSplitPreview(preparedInputText, inspectResult) : null;
  const detection = inspectResult?.detection;
  const detectedFormat = inspectResult?.detectedFormat;
  const effectiveConfidence = detection?.effectiveConfidence ?? inspectResult?.formatConfidence ?? 0;
  const isDoiManualMismatch = inputMode === "doi_list" && inspectResult && inspectResult.detectedFormat !== "doi_list";
  const isLowConfidence = preparedTrimmedInputText.length > 0 && inspectResult && effectiveConfidence < 0.60;
  const isMediumConfidence = preparedTrimmedInputText.length > 0 && inspectResult && effectiveConfidence >= 0.60 && effectiveConfidence < 0.75;

  return (
    <section className="flex flex-col gap-6 w-full">
      <div className="flex justify-between items-end px-1">
        <h3 className="font-headline text-2xl font-bold text-primary-container dark:text-blue-50">Original Citations</h3>
        <div className="flex items-center gap-4">
          {detection && detectedFormat && inputText.trim().length > 0 && (
            <span className={`text-xs font-semibold px-2 py-1 rounded ${
              effectiveConfidence >= 0.75
                ? "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300 dark:bg-emerald-500/10"
                : effectiveConfidence >= 0.60
                  ? "text-amber-700 bg-amber-500/10 dark:text-amber-300 dark:bg-amber-500/10"
                  : "text-red-700 bg-red-500/10 dark:text-red-300 dark:bg-red-500/10"
            }`}>
              {FORMAT_LABELS[detectedFormat] ?? detectedFormat} {"\u00B7"} {Math.round(effectiveConfidence * 100)}%
            </span>
          )}
          <span className="text-xs font-semibold text-primary-container bg-primary-container/10 px-2 py-1 rounded">
            {referenceCount} reference{referenceCount !== 1 ? "s" : ""} detected
          </span>
          {referenceCount > 0 && (
            <button
              onClick={handleClear}
              className="text-xs font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-all"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between items-end px-1 -mt-2">
        <div className="flex flex-col gap-2 w-full sm:w-1/2">
          <label className="text-xs font-bold text-primary-container dark:text-slate-400 uppercase tracking-widest">Input Mode</label>
          <select
            value={inputMode}
            onChange={(event) => setInputMode(event.target.value as EngineInputMode)}
            className="w-full bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant dark:border-slate-700/50 rounded p-3 text-sm focus:ring-2 focus:ring-primary-container dark:text-slate-200 outline-none transition-all cursor-pointer"
          >
            {ENGINE_INPUT_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => handleInputChange(SAMPLE_MIXED_REFERENCES)}
          className="text-xs font-bold uppercase tracking-widest text-primary-container border border-primary-container/20 hover:bg-primary-container bg-primary-container/5 hover:text-white px-6 py-3 rounded transition-all sm:w-auto w-full text-center"
        >
          Load Sample
        </button>
      </div>

      <div className="grid gap-4">
        <div className="bg-surface-container-lowest dark:bg-slate-800 rounded p-6 sm:p-8 border border-outline-variant/60 dark:border-slate-700/50 relative overflow-hidden">
          <textarea
            className="w-full bg-transparent border-none focus:ring-0 text-on-surface dark:text-slate-200 placeholder:text-outline/50 dark:placeholder:text-slate-500 font-mono text-xs sm:text-sm leading-relaxed z-10 outline-none pr-4 sm:pr-6 custom-scrollbar min-h-[320px] sm:min-h-[420px] resize-y"
            placeholder={"Paste your raw citations here...\n\ne.g. Smith, J. (2023). Future of Archiving. Oxford Journal..."}
            value={inputText}
            onChange={(event) => handleInputChange(event.target.value)}
          />
        </div>

        <div
          className="rounded border-2 border-dashed border-outline-variant bg-surface-container-lowest px-6 py-8 transition-colors hover:border-primary-container dark:border-slate-700/50 dark:bg-slate-800 dark:hover:border-blue-400 sm:px-8 sm:py-10"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) {
              void processUploadedFile(file);
            }
          }}
        >
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-5 text-center sm:min-h-[180px]">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-container dark:bg-slate-900 text-outline/60 dark:text-slate-500">
              {isFileUploading ? (
                <RotateCw className="h-6 w-6 animate-spin" />
              ) : (
                <span className="material-symbols-outlined text-2xl">upload_file</span>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-base font-semibold text-primary-container dark:text-blue-50">
                Drag and drop a file here
              </div>
              <div className="text-xs text-on-surface-variant dark:text-slate-400 sm:text-sm">
                Or choose a file. Accepts <span className="font-mono">.txt</span>,{" "}
                <span className="font-mono">.ris</span>,{" "}
                <span className="font-mono">.bib</span>, and{" "}
                <span className="font-mono">.csv</span>.
              </div>
            </div>

            <div className="flex w-full justify-center">
              <input
                id="file-upload-new"
                type="file"
                accept=".txt,.ris,.bib,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => document.getElementById("file-upload-new")?.click()}
                disabled={isFileUploading || isProcessing}
                className="w-full rounded px-6 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-container transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto border border-primary-container/20 bg-primary-container/5 hover:bg-primary-container hover:text-white"
              >
                Choose file
              </button>
            </div>
          </div>
        </div>
      </div>

      {isDoiManualMismatch && (
        <div className="flex items-start gap-3 rounded border border-amber-400/30 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 -mt-2">
          <span className="text-amber-600 dark:text-amber-400 text-sm font-bold mt-0.5">!</span>
          <div className="flex-1 text-xs text-amber-800 dark:text-amber-300">
            <span className="font-bold">Manual mode: DOI list</span> — but content looks like{" "}
            <span className="font-semibold">{FORMAT_LABELS[inspectResult?.detectedFormat ?? "unknown"] ?? "unknown"}</span>.
            <div className="mt-2 flex gap-3">
              <button
                onClick={() => setInputMode("auto")}
                className="text-xs font-bold underline text-amber-700 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100"
              >
                Switch to Auto
              </button>
              <span className="text-amber-600/50 dark:text-amber-500/50">|</span>
              <span className="text-xs text-amber-600/70 dark:text-amber-400/70">Continue anyway</span>
            </div>
          </div>
        </div>
      )}

      {isLowConfidence && !isDoiManualMismatch && (
        <div className="flex items-start gap-3 rounded border border-red-400/30 bg-red-50/50 dark:bg-red-950/20 px-4 py-3 -mt-2">
          <span className="text-red-600 dark:text-red-400 text-sm font-bold mt-0.5">!</span>
          <div className="flex-1 text-xs text-red-800 dark:text-red-300">
            <span className="font-bold">Low detection confidence ({Math.round(effectiveConfidence * 100)}%).</span>{" "}
            The engine may not accurately split this input. Consider reformatting or selecting a specific input mode.
            {detection?.secondBest && (
              <span className="block mt-1 text-red-600/70 dark:text-red-400/70">
                Second best: {FORMAT_LABELS[detection.secondBest.format as EngineDetectedFormat] ?? detection.secondBest.format} ({Math.round(detection.secondBest.score * 100)}%)
              </span>
            )}
          </div>
        </div>
      )}

      {isMediumConfidence && !isDoiManualMismatch && !isLowConfidence && (
        <div className="flex items-center gap-2 rounded border border-amber-400/20 bg-amber-50/30 dark:bg-amber-950/10 px-4 py-2 -mt-2">
          <span className="text-amber-600 dark:text-amber-400 text-xs">~</span>
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Moderate detection confidence. Review the split preview before converting.
          </span>
        </div>
      )}

      {inspectResult?.cleanup && inspectResult.cleanup.mode !== "off" ? (
        <div className="rounded border border-outline-variant/30 bg-surface-container-low/50 px-4 py-3 -mt-2 dark:border-slate-700/60 dark:bg-slate-900/40">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            PDF-copy cleanup
          </div>
          <div className="mt-1 text-xs text-on-surface-variant dark:text-slate-300">
            {describeInspectCleanup(inspectResult)}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 px-1 -mt-2">
        <label className="flex items-center gap-2 cursor-pointer text-xs text-on-surface-variant dark:text-slate-400 uppercase font-bold tracking-widest group">
          <input
            type="checkbox"
            checked={showSplitPreview}
            onChange={(event) => setShowSplitPreview(event.target.checked)}
            disabled={!preparedTrimmedInputText}
            className="rounded border-outline-variant dark:border-slate-700 dark:bg-slate-800 text-primary-container focus:ring-primary-container dark:checked:bg-blue-600 h-3.5 w-3.5 disabled:opacity-50"
          />
          <span className="group-hover:text-primary-container dark:group-hover:text-blue-200 transition-colors">
            Preview split
          </span>
        </label>
        <details className="relative">
          <summary className="flex min-w-[180px] list-none cursor-pointer items-center justify-between rounded border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-slate-700 outline-none transition-all hover:border-primary-container/50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <span className="truncate font-semibold">
              {getInputCleanupSummary(inputCleanupOptions)}
            </span>
            <span aria-hidden="true" className="ml-3 text-xs text-slate-500 dark:text-slate-400">
              ▼
            </span>
          </summary>
          <div className="absolute right-0 top-full z-20 mt-2 min-w-[210px] rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-3">
              {INPUT_CLEANUP_OPTIONS.map((option) => (
                <label
                  key={option.key}
                  className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={inputCleanupOptions[option.key]}
                    onChange={(event) =>
                      setInputCleanupOptions((current) => ({
                        ...current,
                        [option.key]: event.target.checked,
                      }))
                    }
                    className="h-3.5 w-3.5 rounded border-outline-variant text-primary-container focus:ring-primary-container dark:border-slate-700 dark:bg-slate-800 dark:checked:bg-blue-600"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </details>
      </div>

      {splitPreview && (
        <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low/60 px-4 py-4 dark:bg-slate-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-widest text-primary-container dark:text-blue-50">
              Split preview
            </div>
            <div className="text-[10px] font-semibold text-on-surface-variant dark:text-slate-500">
              Showing {splitPreview.items.length} of {splitPreview.engineTotal} (engine)
            </div>
          </div>
          {splitPreview.heuristicTotal !== splitPreview.engineTotal && (
            <div className="mt-2 text-[11px] text-on-surface-variant dark:text-slate-400">
              Preview splitter found {splitPreview.heuristicTotal}; engine expects {splitPreview.engineTotal}. (Still safe to convert.)
            </div>
          )}
          <div className="mt-3 space-y-2">
            {splitPreview.items.map((item, index) => (
              <div
                key={`${index}-${item.text.slice(0, 12)}`}
                className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest/60 px-3 py-2 dark:bg-slate-900/40"
              >
                <div className="flex items-center gap-2">
                  <div className="text-[10px] font-semibold text-outline dark:text-slate-500">
                    #{index + 1}
                  </div>
                  {item.splitReason && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-container dark:bg-slate-800 text-on-surface-variant dark:text-slate-500">
                      {item.splitReason}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-on-surface dark:text-slate-200 whitespace-pre-wrap break-words">
                  {item.text}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-on-surface-variant dark:text-slate-400">
            This preview is generated in the browser and may not exactly match the engine’s final split.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-primary-container dark:text-slate-400 uppercase tracking-widest px-1">Target Citation Style</label>
        <select
          value={outputStyle}
          onChange={(event) => setOutputStyle(event.target.value)}
          className="w-full bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant dark:border-slate-700/50 rounded p-3 text-sm focus:ring-2 focus:ring-primary-container dark:text-slate-200 outline-none transition-all cursor-pointer"
        >
          {ENGINE_OUTPUT_STYLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => void handleConvert()}
        disabled={isProcessing || !inputText.trim()}
        className="w-full bg-primary-container py-4 rounded text-white font-bold tracking-wide flex items-center justify-center gap-3 shadow-lg shadow-primary-container/20 hover:bg-[#002f5f] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isProcessing ? (
          <RotateCw className="w-5 h-5 animate-spin" />
        ) : (
          <span className="material-symbols-outlined text-xl">auto_fix_high</span>
        )}
        {isProcessing ? "CONVERTING..." : "CONVERT"}
      </button>

      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-4 mt-2 px-1">
        <label
          title="Pro: after each conversion, automatically check every reference that still needs review or action against authoritative sources, and apply confident fixes."
          className="flex items-center gap-2 cursor-pointer text-xs text-on-surface-variant dark:text-slate-400 uppercase font-bold tracking-widest group"
        >
          <input
            type="checkbox"
            checked={autoCheckPro}
            onChange={(event) => onAutoCheckProChange?.(event.target.checked)}
            className="rounded border-outline-variant dark:border-slate-700 dark:bg-slate-800 text-primary-container focus:ring-primary-container dark:checked:bg-blue-600 h-3.5 w-3.5"
          />
          <span className="group-hover:text-primary-container dark:group-hover:text-blue-200 transition-colors flex items-center gap-1.5">
            Auto-check refs
            <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-bold tracking-wide text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">PRO</span>
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-xs text-on-surface-variant dark:text-slate-400 uppercase font-bold tracking-widest group">
          <input
            type="checkbox"
            checked={groupDuplicates}
            onChange={(event) => onGroupDuplicatesChange?.(event.target.checked)}
            className="rounded border-outline-variant dark:border-slate-700 dark:bg-slate-800 text-primary-container focus:ring-primary-container dark:checked:bg-blue-600 h-3.5 w-3.5"
          />
          <span className="group-hover:text-primary-container dark:group-hover:text-blue-200 transition-colors">Group Duplicates</span>
        </label>
      </div>
    </section>
  );
}

function normalizeConvertError(error: unknown): string {
  return formatEngineApiError(error);
}

interface SplitPreviewItem {
  text: string;
  splitReason?: string;
}

interface InputCleanupOptions {
  removeDoi: boolean;
  removeUrls: boolean;
}

const INPUT_CLEANUP_OPTIONS: Array<{
  key: keyof InputCleanupOptions;
  label: string;
}> = [
  { key: "removeDoi", label: "Remove DOI" },
  { key: "removeUrls", label: "Remove URLs" },
];

const FORMAT_LABELS: Record<string, string> = {
  doi_list: "DOI list",
  bibtex: "BibTeX",
  ris: "RIS",
  numbered_list: "Numbered list",
  blank_line: "Blank-line separated",
  hanging_indent: "Hanging indent",
  plain_text: "Plain text",
  unknown: "Unknown",
};

function buildSplitPreview(
  text: string,
  inspectResult: EngineInspectResponse | null,
): { engineTotal: number; heuristicTotal: number; items: SplitPreviewItem[] } {
  const trimmed = text.trim();
  if (!trimmed) return { engineTotal: 0, heuristicTotal: 0, items: [] };

  const maxItems = 5;

  if (inspectResult?.blocks && inspectResult.blocks.length > 0) {
    const engineBlocks = inspectResult.blocks;
    const preview = engineBlocks.slice(0, maxItems).map((block) => {
      const oneLine = block.text.replace(/\s+/g, " ").trim();
      return {
        text: oneLine.length > 280 ? `${oneLine.slice(0, 280)}\u2026` : oneLine,
        splitReason: block.splitReason,
      };
    });
    return {
      engineTotal: inspectResult.splitCount,
      heuristicTotal: engineBlocks.length,
      items: preview,
    };
  }

  const detected = inspectResult?.detectedFormat ?? "unknown";

  const splitByBlankLines = () =>
    trimmed
      .split(/\r?\n\s*\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean);

  const splitByNumbered = () => {
    const lines = trimmed.split(/\r?\n/);
    const items: string[] = [];
    let current: string[] = [];

    const flush = () => {
      const value = current.join("\n").trim();
      if (value) items.push(value);
      current = [];
    };

    for (const line of lines) {
      const isMarker = /^\s*(?:\[\d+\]|\d+[.)])\s+/.test(line);
      if (isMarker && current.length > 0) {
        flush();
      }
      current.push(line);
    }
    flush();
    return items;
  };

  const splitByDoiList = () =>
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^doi:\s*/i, ""))
      .filter(Boolean);

  const splitByBibtex = () => {
    const matches = trimmed.match(/@\w+\s*\{[\s\S]*?\n\}\s*/g);
    if (matches && matches.length > 0) return matches.map((item) => item.trim());
    return splitByBlankLines();
  };

  const splitByRis = () => {
    const items: string[] = [];
    const lines = trimmed.split(/\r?\n/);
    let current: string[] = [];

    const flush = () => {
      const value = current.join("\n").trim();
      if (value) items.push(value);
      current = [];
    };

    for (const line of lines) {
      current.push(line);
      if (/^\s*ER\s+-/i.test(line)) {
        flush();
      }
    }
    flush();
    return items;
  };

  let items: string[];
  switch (detected) {
    case "doi_list":
      items = splitByDoiList();
      break;
    case "bibtex":
      items = splitByBibtex();
      break;
    case "ris":
      items = splitByRis();
      break;
    case "numbered_list":
      items = splitByNumbered();
      break;
    case "blank_line":
      items = splitByBlankLines();
      break;
    default:
      items = splitByBlankLines();
      if (items.length <= 1) {
        items = splitByNumbered();
      }
      break;
  }

  const heuristicTotal = items.length;
  const engineTotal = inspectResult?.splitCount ?? heuristicTotal;
  const preview: SplitPreviewItem[] = items.slice(0, maxItems).map((item) => {
    const oneLine = item.replace(/\s+/g, " ").trim();
    return {
      text: oneLine.length > 280 ? `${oneLine.slice(0, 280)}\u2026` : oneLine,
    };
  });

  return { engineTotal, heuristicTotal, items: preview };
}

function computeEngineJobPollIntervalMs(referenceCount: number): number {
  if (referenceCount <= 1_000) return 250;
  if (referenceCount <= 5_000) return 500;
  return 800;
}

function applyInputCleanupOptions(
  text: string,
  options: InputCleanupOptions,
): string {
  if (!text) return text;

  let next = text;

  if (options.removeDoi) {
    next = removeDois(next);
  }

  if (options.removeUrls) {
    next = removeUrls(next);
  }

  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeDois(text: string): string {
  return text
    .replace(/\bhttps?:\/\/(?:dx\.)?doi\.org\/10\.\d{4,9}\/[^\s)\],;]+/gi, "")
    .replace(/\bdoi:\s*10\.\d{4,9}\/[^\s)\],;]+/gi, "")
    .replace(/\b10\.\d{4,9}\/[^\s)\],;]+/gi, "");
}

function removeUrls(text: string): string {
  return text.replace(/\b(?:https?:\/\/|www\.)[^\s)\],;]+/gi, "");
}

function getInputCleanupSummary(options: InputCleanupOptions): string {
  const selected = INPUT_CLEANUP_OPTIONS.filter((option) => options[option.key]).map(
    (option) => option.label,
  );

  if (selected.length === 0) {
    return "Input cleanup";
  }

  return selected.join(", ");
}

function describeInspectCleanup(inspectResult: EngineInspectResponse) {
  const cleanup = inspectResult.cleanup;
  if (!cleanup) return "Cleanup diagnostics unavailable.";
  if (!cleanup.lookedLikePdfCopy) {
    return "Skipped. Input does not look like PDF copy.";
  }

  const scoreDelta = cleanup.qualityDelta != null
    ? ` Split-quality delta: ${cleanup.qualityDelta >= 0 ? "+" : ""}${cleanup.qualityDelta.toFixed(2)}.`
    : "";

  if (cleanup.mode === "inspect_only" && cleanup.wouldSelect === "cleaned") {
    return `Would select cleaned path in full mode. Inspect mode kept baseline.${scoreDelta}`;
  }

  if (cleanup.finalUsed === "cleaned") {
    return `Cleaned path selected.${scoreDelta}`;
  }

  return `Baseline kept (${cleanup.decisionReason ?? "no meaningful gain"}).${scoreDelta}`;
}
