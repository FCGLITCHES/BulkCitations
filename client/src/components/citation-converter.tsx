import { Suspense, lazy, startTransition, useDeferredValue, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReferenceInput from "./reference-input";
import ProcessingStatus from "./processing-status";
import ErrorToast from "./error-toast";
import { ConvertedReference, ConversionResponse, DuplicateGroup } from "@/lib/types";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { FileText } from "lucide-react";

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

function readStoredEngineVersion(): "v1" | "v2" {
  if (typeof window === "undefined") return "v2";
  const saved = window.localStorage.getItem("bulkcitations_engine_version");
  return saved === "v1" ? "v1" : "v2";
}

export default function CitationConverter() {
  const [convertedReferences, setConvertedReferences] = useState<ConvertedReference[]>([]);
  const [clusters, setClusters] = useState<ConversionResponse["clusters"]>(undefined);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [groupDuplicates, setGroupDuplicates] = useState(true);
  const [isPro, setIsPro] = useState(true); // Pro by default for development; wire to auth when ready
  const [engineVersion, setEngineVersion] = useState<"v1" | "v2">(readStoredEngineVersion);
  const [lastEngineUsed, setLastEngineUsed] = useState<"v1" | "v2">(readStoredEngineVersion);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({ visible: false, title: "", message: "" });
  const [errorToast, setErrorToast] = useState({ visible: false, title: "", message: "", variant: "error" as "error" | "warning" });
  const [initialCaptureText, setInitialCaptureText] = useState(readCaptureBatch);
  const { toast } = useToast();
  const deferredConvertedReferences = useDeferredValue(convertedReferences);
  const deferredClusters = useDeferredValue(clusters);
  const deferredDuplicateGroups = useDeferredValue(duplicateGroups);

  useEffect(() => {
    if (!initialCaptureText) return;
    const n = initialCaptureText.split(/\n\s*\n/).filter(Boolean).length || 1;
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
        const n = text.split(/\n\s*\n/).filter(Boolean).length || 1;
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
    window.localStorage.setItem("bulkcitations_engine_version", engineVersion);
  }, [engineVersion]);

  useEffect(() => {
    if (isProcessing || convertedReferences.length > 0) {
      void loadReferenceOutput();
    }
  }, [convertedReferences.length, isProcessing]);

  const handleConversionResult = (response: ConversionResponse) => {
    startTransition(() => {
      setConvertedReferences(response.convertedReferences);
      setClusters(response.clusters ?? undefined);
      setDuplicateGroups(response.duplicateGroups ?? []);
      setLastEngineUsed(response.engineVersion ?? engineVersion);
    });

    // Save to local storage history
    if (response.convertedReferences && response.convertedReferences.length > 0) {
      try {
        const existingHistory = JSON.parse(localStorage.getItem('bulkcitations_history') || '[]');
        const newHistoryItems = response.convertedReferences
          .filter(r => !r.styleDetectionFailed && r.convertedText)
          .map(r => ({
            id: r.id + '-' + Date.now(),
            originalText: r.originalText,
            convertedText: r.convertedText,
            inputStyle: r.inputStyle,
            outputStyle: r.outputStyle,
            timestamp: new Date().toISOString()
          }));

        const combined = [...newHistoryItems, ...existingHistory].slice(0, 50); // Keep last 50
        localStorage.setItem('bulkcitations_history', JSON.stringify(combined));
      } catch (e) {
        console.warn("Could not save to local history", e);
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
    setIsProcessing(true);
    setProcessingStatus({
      visible: true,
      title: 'Converting References...',
      message: `Processing ${totalRefs} references`,
    });
  };

  const handleProcessingEnd = () => {
    setIsProcessing(false);
    setProcessingStatus({ visible: false, title: '', message: '' });
  };

  const handleError = (error: string) => {
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
    <div className="w-full max-w-[1700px] mx-auto overflow-x-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-10">
        {/* Input Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <Card className="shadow-lg border-border/50 hover:shadow-xl overflow-hidden bg-card h-full">
            <CardContent className="pt-6 sm:pt-8 px-4 sm:px-8">
              <div className="flex items-center justify-between mb-6 sm:mb-8 flex-wrap gap-3">
                <h3 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Input References</h3>
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Step 1
                </div>
              </div>

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

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Admin Engine
                  </Label>
                  <Select value={engineVersion} onValueChange={(value: "v1" | "v2") => setEngineVersion(value)}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="v1">v1 engine</SelectItem>
                      <SelectItem value="v2">v2 engine</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground sm:text-right">
                  <span className="font-semibold">Last run:</span>
                  <span className="ml-1">{lastEngineUsed.toUpperCase()}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Output Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="relative h-full"
        >
          <Card className="shadow-lg border-border/50 hover:shadow-xl overflow-hidden bg-card h-full">
            <CardContent className="pt-6 sm:pt-8 px-4 sm:px-8">
              <div className="flex items-center justify-between mb-6 sm:mb-8 flex-wrap gap-3">
                <h3 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Converted References</h3>
                <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-all duration-500 shadow-sm ${convertedReferences.length > 0 ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-muted/50 border-border/50 text-muted-foreground/60'}`}>
                  {convertedReferences.length > 0 ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                  )}
                  Step 2
                </div>
              </div>

              {deferredConvertedReferences.length > 0 ? (
                <Suspense
                  fallback={(
                    <div className="text-center py-12 text-muted-foreground">
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
                <div className="text-center py-12">
                  <div className="text-muted-foreground mb-4">
                    <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No converted references yet</p>
                    <p className="text-sm">Convert some references to see them here</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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
