import { Suspense, lazy, startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import ReferenceInput from "./reference-input";
import ProcessingStatus from "./processing-status";
import ErrorToast from "./error-toast";
import { ConvertedReference, ConversionResponse, DuplicateGroup } from "@/lib/types";
import { apiRequest } from "@/lib/queryClient";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { appendHistoryItems, ensureHistorySync, syncPendingHistory } from "@/lib/history-sync";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { countEngineLikeInputReferences } from "@shared/liveReferenceDetection";

const CAPTURE_BATCH_KEY = "bulkcitations_capture_batch";
const loadReferenceOutput = () => import("./reference-output");
const ReferenceOutput = lazy(loadReferenceOutput);

function readCaptureBatch(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(CAPTURE_BATCH_KEY);
    if (!raw) return "";
    const batch = JSON.parse(raw) as unknown;
    if (!Array.isArray(batch) || batch.length === 0) return "";
    localStorage.removeItem(CAPTURE_BATCH_KEY);
    return batch.map((s) => (typeof s === "string" ? s : String(s)).trim()).filter(Boolean).join("\n\n");
  } catch {
    localStorage.removeItem(CAPTURE_BATCH_KEY);
    return "";
  }
}

export default function CitationConverter() {
  const [convertedReferences, setConvertedReferences] = useState<ConvertedReference[]>([]);
  const [clusters, setClusters] = useState<ConversionResponse["clusters"]>(undefined);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [groupDuplicates, setGroupDuplicates] = useState(true);
  const [isPro, setIsPro] = useState(true); // Pro by default for development; wire to auth when ready
  const [engineVersion] = useState<"v2">("v2");
  const [lastEngineUsed, setLastEngineUsed] = useState<"v1" | "v2" | "v3">("v2");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({ visible: false, title: "", message: "" });
  const [errorToast, setErrorToast] = useState({ visible: false, title: "", message: "", variant: "error" as "error" | "warning" });
  const [initialCaptureText, setInitialCaptureText] = useState(readCaptureBatch);
  const lastRequestedBatchSizeRef = useRef(0);
  const conversionStartedAtRef = useRef<number | null>(null);
  const { toast } = useToast();
  const deferredConvertedReferences = useDeferredValue(convertedReferences);
  const deferredClusters = useDeferredValue(clusters);
  const deferredDuplicateGroups = useDeferredValue(duplicateGroups);

  useEffect(() => {
    ensureHistorySync();
    void syncPendingHistory();
  }, []);

  useEffect(() => {
    if (!initialCaptureText) return;
    const n = countEngineLikeInputReferences(initialCaptureText);
    toast({
      title: "Captured from browser",
      description: `${n} reference${n === 1 ? "" : "s"} loaded. Review and convert when ready.`,
    });
  }, [initialCaptureText, toast]);

  useEffect(() => {
    const onCaptureBatch = () => {
      const text = readCaptureBatch();
      if (text) {
        setInitialCaptureText(text);
        const n = countEngineLikeInputReferences(text);
        toast({
          title: "Captured from browser",
          description: `${n} reference${n === 1 ? "" : "s"} loaded. Review and convert when ready.`,
        });
      }
    };
    window.addEventListener("bulkcitations-capture-batch", onCaptureBatch);
    return () => window.removeEventListener("bulkcitations-capture-batch", onCaptureBatch);
  }, [toast]);

  useEffect(() => {
    if (isProcessing || convertedReferences.length > 0) {
      void loadReferenceOutput();
    }
  }, [convertedReferences.length, isProcessing]);

  const handleConversionResult = (response: ConversionResponse) => {
    const durationMs = conversionStartedAtRef.current != null
      ? Math.max(0, Date.now() - conversionStartedAtRef.current)
      : null;
    const reviewCount = response.convertedReferences.filter((reference) => (reference.analyticsPayload?.healthState ?? reference.healthState) === "review").length;
    const actionNeededCount = response.convertedReferences.filter((reference) => (reference.analyticsPayload?.healthState ?? reference.healthState) === "action_needed").length;
    const cleanCount = response.convertedReferences.filter((reference) => (reference.analyticsPayload?.healthState ?? reference.healthState) === "clean").length;
    const warningCount = response.convertedReferences.reduce(
      (total, reference) => total + (reference.analyticsPayload?.warningCount ?? reference.warnings?.length ?? 0),
      0,
    );
    const styleDetectionFailedCount = response.convertedReferences.filter(
      (reference) => reference.analyticsPayload?.styleDetectionFailed ?? reference.styleDetectionFailed,
    ).length;

    trackAnalyticsEvent("converter_completed", {
      citationCount: lastRequestedBatchSizeRef.current || response.convertedReferences.length,
      convertedCount: response.convertedReferences.length,
      duplicateGroups: response.duplicateGroups?.length ?? 0,
      engineVersion: response.engineVersion ?? engineVersion,
      conversionDurationMs: durationMs,
      cleanCount,
      reviewCount,
      actionNeededCount,
      warningCount,
      styleDetectionFailedCount,
    });
    startTransition(() => {
      setConvertedReferences(response.convertedReferences);
      setClusters(response.clusters ?? undefined);
      setDuplicateGroups(response.duplicateGroups ?? []);
      setLastEngineUsed(response.engineVersion ?? engineVersion);
    });

    if (response.convertedReferences && response.convertedReferences.length > 0) {
      const timestamp = new Date().toISOString();
      const newHistoryItems = response.convertedReferences
        .filter(r => !r.styleDetectionFailed && r.convertedText)
        .map(r => ({
          id: `${r.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          originalText: r.originalText,
          convertedText: r.convertedText,
          inputStyle: r.inputStyle,
          outputStyle: r.outputStyle,
          healthState: r.analyticsPayload?.healthState ?? r.healthState ?? 'clean',
          timestamp,
        }));

      if (newHistoryItems.length > 0) {
        void appendHistoryItems(newHistoryItems);
      }
    }

    const detectionFailedCount = response.convertedReferences?.filter((r) => r.styleDetectionFailed).length ?? 0;
    if (detectionFailedCount > 0) {
      setErrorToast({
        visible: true,
        title: 'Auto-detect uncertain',
        message: `Auto-detect uncertain for ${detectionFailedCount} reference${detectionFailedCount === 1 ? '' : 's'} — converted with best-guess (check highlighted ones).`,
        variant: 'warning',
      });
    } else if (response.errors && response.errors.length > 0) {
      setErrorToast({
        visible: true,
        title: 'Conversion Warnings',
        message: response.errors.join('. '),
        variant: 'error',
      });
    }
  };

  const handleRecheck = async (referenceId: string) => {
    try {
      const existingReference = convertedReferences.find((reference) => reference.id === referenceId);
      if (existingReference?.reportEngineSnapshot?.engineVersion === "v2") {
        toast({
          title: "Recheck unavailable",
          description: "v2 citations already use the strict resolution pipeline, so the legacy recheck would only make this result less reliable.",
        });
        return;
      }
      const res = await apiRequest("POST", "/api/recheck", { referenceId, force: true });
      const data = await res.json() as { authorityData?: ConvertedReference["authorityData"]; authorityStatus?: ConvertedReference["authorityStatus"]; confidence?: ConvertedReference["confidence"] };
      setConvertedReferences((prev) =>
        prev.map((r) =>
          r.id === referenceId
            ? {
                ...r,
                authorityData: data.authorityData,
                authorityStatus: data.authorityStatus,
                confidence: data.confidence,
              }
            : r
        )
      );
      toast({
        title: data.authorityStatus === "fetched" || data.authorityStatus === "cache_hit" ? "Recheck complete" : "Recheck finished",
        description:
          data.authorityStatus === "no_match"
            ? "No authority match was found for this citation."
            : data.authorityStatus === "error"
              ? "Authority lookup returned an error."
              : "Citation authority data was refreshed.",
      });
    } catch (e) {
      setErrorToast({
        visible: true,
        title: "Recheck failed",
        message: e instanceof Error ? e.message : "Could not revalidate",
        variant: "error",
      });
    }
  };

  const handleOutputStyleChange = async (newStyle: string) => {
    if (convertedReferences.length === 0) return;
    try {
      const payload = {
        references: convertedReferences.map(r => ({
          id: r.id,
          parsedData: r.parsedData,
          referenceType: r.referenceType,
          originalText: r.originalText,
          inputStyle: r.inputStyle,
        })),
        outputStyle: newStyle,
      };
      const res = await apiRequest("POST", "/api/reformat", payload);
      const data = await res.json() as { convertedReferences: ConvertedReference[] };
      if (data.convertedReferences) {
        startTransition(() => {
          setConvertedReferences(prev =>
            data.convertedReferences.map(newRef => {
              const orig = prev.find(p => p.id === newRef.id);
              return {
                ...newRef,
                authorityData: orig?.authorityData ?? newRef.authorityData,
                authorityStatus: orig?.authorityStatus ?? newRef.authorityStatus,
              };
            })
          );
        });
      }
    } catch (e) {
      console.warn("Style reformat failed:", e);
    }
  };


  const handleProcessingStart = (totalRefs: number) => {
    lastRequestedBatchSizeRef.current = totalRefs;
    conversionStartedAtRef.current = Date.now();
    trackAnalyticsEvent("converter_started", {
      citationCount: totalRefs,
      engineVersion,
    });
    setIsProcessing(true);
    setProcessingStatus({
      visible: true,
      title: 'Converting References...',
      message: `Processing ${totalRefs} references`,
    });
  };

  const handleProcessingEnd = () => {
    setIsProcessing(false);
    conversionStartedAtRef.current = null;
    setProcessingStatus({ visible: false, title: '', message: '' });
  };

  const handleError = (error: string) => {
    const durationMs = conversionStartedAtRef.current != null
      ? Math.max(0, Date.now() - conversionStartedAtRef.current)
      : null;
    trackAnalyticsEvent("converter_failed", {
      citationCount: lastRequestedBatchSizeRef.current,
      engineVersion,
      reason: error.slice(0, 120),
      conversionDurationMs: durationMs,
    });
    setErrorToast({
      visible: true,
      title: 'Conversion Error',
      message: error,
      variant: 'error',
    });
    handleProcessingEnd();
  };

  const dismissError = () => {
    setErrorToast({ visible: false, title: '', message: '', variant: 'error' });
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* Input Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-2xl sm:max-w-none"
        >
          <ReferenceInput
            onConversionResult={handleConversionResult}
            onProcessingStart={handleProcessingStart}
            onProcessingEnd={handleProcessingEnd}
            onError={handleError}
            isProcessing={isProcessing}
            isPro={isPro}
            onOutputStyleChange={handleOutputStyleChange}
            initialCaptureText={initialCaptureText || undefined}
            engineVersion={engineVersion}
            groupDuplicates={groupDuplicates}
            onGroupDuplicatesChange={setGroupDuplicates}
          />
        </motion.div>

        {/* Output Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col gap-6"
        >
          <div className="flex justify-between items-end px-1">
            <h3 className="font-headline text-2xl font-bold text-primary-container dark:text-blue-50">Converted Citations</h3>
            {convertedReferences.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-on-surface-variant dark:text-slate-400 uppercase tracking-widest hidden sm:inline">Target Style:</span>
                <span className="bg-primary-container dark:bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold shadow-sm uppercase">{convertedReferences[0]?.outputStyle}</span>
              </div>
            )}
          </div>

          {deferredConvertedReferences.length > 0 ? (
            <Suspense
              fallback={(
                <div className="text-center py-12 text-on-surface-variant dark:text-slate-400">
                  <p className="text-sm">Loading results view...</p>
                </div>
              )}
            >
              <ReferenceOutput
                convertedReferences={deferredConvertedReferences}
                clusters={deferredClusters}
                duplicateGroups={deferredDuplicateGroups}
                engineVersion={lastEngineUsed}
                groupDuplicates={groupDuplicates}
                onError={handleError}
                isPro={isPro}
                onRecheck={handleRecheck}
              />
            </Suspense>
          ) : (
            <div className="flex flex-col gap-4 overflow-y-auto custom-scrollbar max-h-[800px] pr-2">
              <div className="flex flex-col items-center justify-center min-h-[500px] bg-surface-container-low dark:bg-slate-800/50 border-2 border-dashed border-outline-variant/30 dark:border-slate-700/50 rounded-lg p-12 text-center">
                <div className="w-20 h-20 bg-surface-container-high dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 text-outline/40 dark:text-slate-500">
                  <span className="material-symbols-outlined text-4xl">folder_off</span>
                </div>
                <h4 className="font-headline text-xl font-bold text-primary-container dark:text-blue-50 mb-2">No converted references yet</h4>
                <p className="text-on-surface-variant dark:text-slate-400 max-w-xs">Convert some references to see them here.</p>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Processing Status */}
      <ProcessingStatus
        visible={processingStatus.visible}
        title={processingStatus.title}
        message={processingStatus.message}
      />

      {/* Error Toast */}
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
