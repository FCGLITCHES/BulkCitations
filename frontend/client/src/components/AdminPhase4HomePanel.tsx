import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { adminFetch } from "@/lib/admin-api";

type Phase4ModeResponse = {
  mode: "heuristic" | "primary" | "default";
  envMode: "heuristic" | "shadow" | "primary";
  effectiveMode: "heuristic" | "shadow" | "primary";
  options?: Array<{ id: "1" | "2"; label: string; mode: "heuristic" | "primary" }>;
};

export default function AdminPhase4HomePanel() {
  const [phase4Mode, setPhase4Mode] = useState<Phase4ModeResponse | null>(null);
  const [isPending, setIsPending] = useState(false);
  const { isAdmin, isInitialized } = useAdminAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isInitialized || !isAdmin) {
      setPhase4Mode(null);
      return;
    }

    let cancelled = false;
    void adminFetch<Phase4ModeResponse>("/internal/admin/phase4-mode")
      .then((data) => {
        if (!cancelled) {
          setPhase4Mode(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPhase4Mode(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, isInitialized]);

  const handlePhase4ModeChange = async (mode: "heuristic" | "primary") => {
    setIsPending(true);
    try {
      const next = await adminFetch<Phase4ModeResponse>("/internal/admin/phase4-mode", {
        method: "PUT",
        body: JSON.stringify({ mode }),
      });
      setPhase4Mode(next);
      toast({
        title: "Phase 4 mode updated",
        description:
          next.effectiveMode === "primary"
            ? "Visible extraction now uses ML."
            : "Visible extraction now uses heuristics.",
      });
    } catch (error) {
      toast({
        title: "Phase 4 mode update failed",
        description:
          error instanceof Error ? error.message : "Failed to update Phase 4 mode.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  if (!isInitialized || !isAdmin || !phase4Mode) {
    return null;
  }

  const visibleMode = getPhase4VisibleMode(phase4Mode);

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => void handlePhase4ModeChange("heuristic")}
        disabled={isPending}
        aria-pressed={visibleMode === "heuristic"}
        className={`rounded border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
          visibleMode === "heuristic"
            ? "border-primary-container bg-primary-container text-white dark:border-blue-400 dark:bg-blue-500"
            : "border-outline-variant bg-surface-container-lowest text-slate-700 hover:border-primary-container/50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500/60"
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        Heuristics
      </button>
      <button
        type="button"
        onClick={() => void handlePhase4ModeChange("primary")}
        disabled={isPending}
        aria-pressed={visibleMode === "primary"}
        className={`rounded border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
          visibleMode === "primary"
            ? "border-primary-container bg-primary-container text-white dark:border-blue-400 dark:bg-blue-500"
            : "border-outline-variant bg-surface-container-lowest text-slate-700 hover:border-primary-container/50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500/60"
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        ML
      </button>
    </div>
  );
}

function getPhase4VisibleMode(
  phase4Mode: Phase4ModeResponse,
): "heuristic" | "primary" {
  return phase4Mode.effectiveMode === "primary" ? "primary" : "heuristic";
}
