import { Suspense, lazy, useDeferredValue, useEffect, useState } from "react";
import ReferenceInput from "./reference-input";
import ProcessingStatus from "./processing-status";
import ErrorToast from "./error-toast";
import type { EngineResultModel } from "@/lib/engine-types";
import { appendHistoryItems, ensureHistorySync, syncPendingHistory } from "@/lib/history-sync";
import { useToast } from "@/hooks/use-toast";
import { countEngineLikeInputReferences } from "@shared/liveReferenceDetection";

const CAPTURE_BATCH_KEY = "bulkcitations_capture_batch";
const AUTO_CHECK_PRO_KEY = "bulkreferences_auto_check_pro";
const loadReferenceOutput = () => import("./reference-output");
const ReferenceOutput = lazy(loadReferenceOutput);

function publicWarningMessage(warnings: string[], status: EngineResultModel["status"]): string {
  const publicWarning = warnings.find((warning) => !isInternalDiagnosticWarning(warning));
  if (publicWarning) return publicWarning;

  if (status === "partial") {
    return "Some citations need review before export. Check the highlighted items in the output list.";
  }

  return "Conversion completed. Review highlighted citations before copying or exporting.";
}

function isInternalDiagnosticWarning(warning: string): boolean {
  return /phase\s+\d+|heuristic=|shadow=|primary=|mlfailures=/i.test(warning);
}

function scheduleAfterNextPaint(callback: () => void) {
  if (typeof window === "undefined") {
    callback();
    return;
  }
  window.requestAnimationFrame(() => {
    window.setTimeout(callback, 0);
  });
}

function appendResultHistory(nextResult: EngineResultModel) {
  if (nextResult.references.length === 0) return;

  const timestamp = new Date().toISOString();
  const historyItems = nextResult.references
    .filter((reference) => reference.renderedText.trim().length > 0)
    .map((reference) => ({
      id: `${reference.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      originalText: reference.raw,
      convertedText: reference.renderedText,
      inputStyle: reference.detectedStyle,
      outputStyle: reference.outputStyle,
      healthState:
        reference.publicStatus === "needs_action"
          ? "action_needed"
          : reference.publicStatus === "needs_review"
            ? "review"
            : "clean",
      timestamp,
    }));

  if (historyItems.length > 0) {
    void appendHistoryItems(historyItems);
  }
}

function ImmediateResultSummary({ result }: { result: EngineResultModel }) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded border border-outline-variant/50 bg-surface-container-lowest p-3 text-center text-xs font-bold uppercase tracking-widest text-on-surface-variant dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-300">
      <span>{result.summary.ready} ready</span>
      <span>{result.summary.needsReview} review</span>
      <span>{result.summary.needsAction} action needed</span>
    </div>
  );
}

function readCaptureBatch(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(CAPTURE_BATCH_KEY);
    if (!raw) return "";
    const batch = JSON.parse(raw) as unknown;
    if (!Array.isArray(batch) || batch.length === 0) return "";
    localStorage.removeItem(CAPTURE_BATCH_KEY);
    return batch.map((value) => (typeof value === "string" ? value : String(value)).trim()).filter(Boolean).join("\n\n");
  } catch {
    localStorage.removeItem(CAPTURE_BATCH_KEY);
    return "";
  }
}

function readAutoCheckPro(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTO_CHECK_PRO_KEY) === "true";
  } catch {
    return false;
  }
}

export default function CitationConverter() {
  const [result, setResult] = useState<EngineResultModel | null>(null);
  const [groupDuplicates, setGroupDuplicates] = useState(false);
  const [autoCheckPro, setAutoCheckPro] = useState(readAutoCheckPro);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({ visible: false, title: "", message: "" });
  const [errorToast, setErrorToast] = useState({ visible: false, title: "", message: "", variant: "error" as "error" | "warning" });
  const [initialCaptureText, setInitialCaptureText] = useState(readCaptureBatch);
  const { toast } = useToast();
  const deferredResult = useDeferredValue(result);

  useEffect(() => {
    ensureHistorySync();
    void syncPendingHistory();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(AUTO_CHECK_PRO_KEY, String(autoCheckPro));
    } catch {
      // Ignore persistence failures; the toggle still works for the current session.
    }
  }, [autoCheckPro]);

  useEffect(() => {
    if (!initialCaptureText) return;
    const count = countEngineLikeInputReferences(initialCaptureText);
    toast({
      title: "Captured from browser",
      description: `${count} reference${count === 1 ? "" : "s"} loaded. Review and convert when ready.`,
    });
  }, [initialCaptureText, toast]);

  useEffect(() => {
    const onCaptureBatch = () => {
      const text = readCaptureBatch();
      if (!text) return;
      setInitialCaptureText(text);
      const count = countEngineLikeInputReferences(text);
      toast({
        title: "Captured from browser",
        description: `${count} reference${count === 1 ? "" : "s"} loaded. Review and convert when ready.`,
      });
    };

    window.addEventListener("bulkcitations-capture-batch", onCaptureBatch);
    return () => window.removeEventListener("bulkcitations-capture-batch", onCaptureBatch);
  }, [toast]);

  useEffect(() => {
    if (isProcessing || result) {
      void loadReferenceOutput();
    }
  }, [isProcessing, result]);

  const handleConversionResult = (nextResult: EngineResultModel) => {
    setResult(nextResult);

    scheduleAfterNextPaint(() => appendResultHistory(nextResult));

    if (nextResult.status === "partial" || nextResult.warnings.length > 0) {
      setErrorToast({
        visible: true,
        title: nextResult.status === "partial" ? "Batch completed with review items" : "Conversion warnings",
        message: publicWarningMessage(nextResult.warnings, nextResult.status),
        variant: "warning",
      });
    }
  };

  const handleProcessingStart = (totalRefs: number) => {
    setIsProcessing(true);
    setProcessingStatus({
      visible: true,
      title: "Converting References...",
      message: `Preparing ${totalRefs} reference${totalRefs === 1 ? "" : "s"}`,
    });
  };

  const handleProcessingUpdate = (title: string, message: string) => {
    setProcessingStatus({
      visible: true,
      title,
      message,
    });
  };

  const handleProcessingEnd = () => {
    setIsProcessing(false);
    setProcessingStatus({ visible: false, title: "", message: "" });
  };

  const handleError = (error: string) => {
    setErrorToast({
      visible: true,
      title: "Conversion Error",
      message: error,
      variant: "error",
    });
    handleProcessingEnd();
  };

  const dismissError = () => {
    setErrorToast({ visible: false, title: "", message: "", variant: "error" });
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        <div className="w-full max-w-2xl sm:max-w-none">
          <ReferenceInput
            onConversionResult={handleConversionResult}
            onProcessingStart={handleProcessingStart}
            onProcessingUpdate={handleProcessingUpdate}
            onProcessingEnd={handleProcessingEnd}
            onError={handleError}
            isProcessing={isProcessing}
            initialCaptureText={initialCaptureText || undefined}
            groupDuplicates={groupDuplicates}
            onGroupDuplicatesChange={setGroupDuplicates}
            autoCheckPro={autoCheckPro}
            onAutoCheckProChange={setAutoCheckPro}
          />
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex justify-between items-end px-1">
            <h3 className="font-headline text-2xl font-bold text-primary-container dark:text-blue-50">Converted Citations</h3>
            {result && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-on-surface-variant dark:text-slate-400 uppercase tracking-widest hidden sm:inline">Target Style:</span>
                <span className="bg-primary-container dark:bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold shadow-sm uppercase">
                  {result.references[0]?.outputStyle ?? "pending"}
                </span>
              </div>
            )}
          </div>
          {result ? <ImmediateResultSummary result={result} /> : null}

          {deferredResult ? (
            <Suspense
              fallback={(
                <div className="text-center py-12 text-on-surface-variant dark:text-slate-400">
                  <p className="text-sm">Loading results view...</p>
                </div>
              )}
            >
              <ReferenceOutput
                result={deferredResult}
                groupDuplicates={groupDuplicates}
                autoCheckPro={autoCheckPro}
                onError={handleError}
              />
            </Suspense>
          ) : (
            <div className="flex flex-col gap-4 overflow-y-auto custom-scrollbar max-h-[800px] pr-2">
              <div className="flex flex-col items-center justify-center min-h-[320px] bg-surface-container-low dark:bg-slate-800/50 border-2 border-dashed border-outline-variant/30 dark:border-slate-700/50 rounded-lg p-8 text-center">
                <div className="w-16 h-16 bg-surface-container-high dark:bg-slate-800 rounded-full flex items-center justify-center mb-5 text-outline/40 dark:text-slate-500">
                  <span className="material-symbols-outlined text-3xl">folder_off</span>
                </div>
                <h4 className="font-headline text-xl font-bold text-primary-container dark:text-blue-50 mb-2">No converted references yet</h4>
                <p className="text-on-surface-variant dark:text-slate-400 max-w-sm">
                  Paste references or load the sample, then click Convert to preview the formatted output here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <ProcessingStatus
        visible={processingStatus.visible}
        title={processingStatus.title}
        message={processingStatus.message}
      />

      <ErrorToast
        visible={errorToast.visible}
        title={errorToast.title}
        message={errorToast.message}
        onDismiss={dismissError}
        variant={errorToast.variant}
      />
    </div>
  );
}
