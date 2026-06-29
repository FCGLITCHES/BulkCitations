import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, AdminRequestError } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BIO_LABELS,
  OUTSIDE,
  labelColor,
  spansToTokenLabels,
  tokenize,
  tokenLabelsToSpans,
} from "@/lib/bio-labeling";
import type {
  BioReviewQueueItem,
  BioReviewQueueResponse,
  BioReviewSubmitResponse,
  BioReviewTriageResponse,
} from "./types";

const QUEUE_KEY = ["/internal/admin/bio-review/queue"];

function errorMessage(error: unknown): string {
  if (error instanceof AdminRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed.";
}

/**
 * Active-learning span-correction surface. The admin only sees references the
 * consensus/projection pass flagged; they paint token labels and approve to
 * gold, or skip. Agreement never reaches this queue, so review stays scarce.
 */
export function AdminBioReview() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeLabel, setActiveLabel] = useState<string>(BIO_LABELS[0] ?? "author");
  const [tokenLabels, setTokenLabels] = useState<string[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () =>
      adminFetch<BioReviewQueueResponse>("/internal/admin/bio-review/queue?limit=50"),
    placeholderData: (previous) => previous,
  });

  const items = queueQuery.data?.items ?? [];
  const current: BioReviewQueueItem | undefined = items[0];

  const tokens = useMemo(
    () => (current ? tokenize(current.raw_text) : []),
    [current],
  );

  // Initialize editable labels when the active item changes.
  const labels = useMemo(() => {
    if (!current) return [];
    if (editingId === current.id && tokenLabels) return tokenLabels;
    return spansToTokenLabels(
      tokens,
      current.entity_fields,
      current.entity_starts,
      current.entity_ends,
    );
  }, [current, editingId, tokenLabels, tokens]);

  const setLabelAt = (index: number) => {
    if (!current) return;
    const base =
      editingId === current.id && tokenLabels
        ? [...tokenLabels]
        : spansToTokenLabels(tokens, current.entity_fields, current.entity_starts, current.entity_ends);
    base[index] = base[index] === activeLabel ? OUTSIDE : activeLabel;
    setEditingId(current.id);
    setTokenLabels(base);
  };

  const submitMutation = useMutation({
    mutationFn: async (decision: "approve" | "reject") => {
      if (!current) throw new Error("No item selected.");
      const spans = tokenLabelsToSpans(tokens, labels);
      return adminFetch<BioReviewSubmitResponse>("/internal/admin/bio-review/submit", {
        method: "POST",
        body: JSON.stringify({
          id: current.id,
          decision,
          raw_text: current.raw_text,
          entity_fields: spans.fields,
          entity_starts: spans.starts,
          entity_ends: spans.ends,
          expected_type: current.expected_type ?? null,
          stratum: current.stratum,
          dataset_split: current.dataset_split,
        }),
      });
    },
    onSuccess: (payload) => {
      setEditingId(null);
      setTokenLabels(null);
      void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
      toast({
        title: payload.outcome === "approved" ? "Saved to gold" : "Skipped",
        description: `${payload.remaining} item(s) left in the review queue.`,
      });
    },
    onError: (error) =>
      toast({ title: "Submit failed", description: errorMessage(error), variant: "destructive" }),
  });

  const triageMutation = useMutation({
    mutationFn: async () =>
      adminFetch<BioReviewTriageResponse>("/internal/admin/bio-review/triage", { method: "POST" }),
    onSuccess: (payload) => {
      setEditingId(null);
      setTokenLabels(null);
      void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
      toast({
        title: "Consensus triage complete",
        description: `${payload.autoPromoted} auto-promoted to gold • ${payload.remaining} left for review${payload.modelUnavailable ? ` • ${payload.modelUnavailable} had no model vote` : ""}.`,
      });
    },
    onError: (error) =>
      toast({ title: "Triage failed", description: errorMessage(error), variant: "destructive" }),
  });

  const busy = submitMutation.isPending || triageMutation.isPending;

  if (queueQuery.isLoading) {
    return <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/40">Loading review queue…</div>;
  }

  if (!current) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/40">
        <div className="text-base font-semibold text-slate-800 dark:text-slate-200">Review queue is empty</div>
        <p className="mx-auto mt-2 max-w-xl">
          Nothing needs human correction right now. Populate the queue by fetching real references
          (<code>fetch-reference-corpus</code> / <code>ingest-bibliography</code>) into{" "}
          <code>review/inbox.jsonl</code>, or by exporting consensus-flagged rows.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-950/40">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Correct the labels</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {queueQuery.data?.total ?? 0} flagged • stratum: {current.stratum ?? "n/a"} • priority {current.priority}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8"
              disabled={busy}
              onClick={() => triageMutation.mutate()}
              title="Run the live model as a third vote; agreements auto-promote to gold and leave the queue."
            >
              {triageMutation.isPending ? "Triaging…" : "Run consensus triage"}
            </Button>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              Needs review
            </span>
          </div>
        </div>

        {/* Token canvas */}
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 text-sm leading-7 dark:border-slate-700 dark:bg-slate-950/50">
          {tokens.map((token, index) => {
            const label = labels[index] ?? OUTSIDE;
            const colored = label !== OUTSIDE;
            return (
              <button
                key={`${token.start}-${index}`}
                type="button"
                disabled={busy}
                onClick={() => setLabelAt(index)}
                title={label === OUTSIDE ? "unlabeled" : label}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[13px] transition-colors",
                  colored ? "text-white" : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800",
                )}
                style={colored ? { backgroundColor: labelColor(label) } : undefined}
              >
                {token.text}
              </button>
            );
          })}
        </div>

        {/* Label palette */}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Active label — click tokens to paint
          </div>
          <div className="mb-2 text-[11px] leading-snug text-slate-400">
            Split a merged value (e.g. <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">98:25-25</code> →
            volume + pages, or <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">2004(3)</code> → volume + issue):
            pick the first label and click its number, then the second label and its number. The delimiter
            (<code>:</code>, <code>(</code>, <code>;</code>) is its own token — leave it unlabeled. Click a painted
            token again to clear it.
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveLabel(OUTSIDE)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                activeLabel === OUTSIDE
                  ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300",
              )}
            >
              O / clear
            </button>
            {BIO_LABELS.map((label) => {
              const isActive = activeLabel === label;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setActiveLabel(label)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    isActive ? "text-white" : "text-slate-700 hover:opacity-80 dark:text-slate-200",
                  )}
                  style={
                    isActive
                      ? { backgroundColor: labelColor(label), borderColor: labelColor(label) }
                      : { borderColor: labelColor(label) }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" disabled={busy} onClick={() => submitMutation.mutate("approve")} className="h-10 min-w-[180px]">
            {busy ? "Saving…" : "Approve & save to gold"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => submitMutation.mutate("reject")} className="h-10">
            Skip / reject
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => { setEditingId(null); setTokenLabels(null); }}
            className="h-10"
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Sidebar: raw + hints */}
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-950/40">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Raw reference</div>
          <div className="mt-2 break-words rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            {current.raw_text}
          </div>
        </div>
        {current.unprojected_fields && current.unprojected_fields.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
              Auto-labeling could not place
            </div>
            <ul className="mt-2 list-inside list-disc text-sm text-amber-800 dark:text-amber-200">
              {current.unprojected_fields.map((field) => (
                <li key={field}>{field} — locate it in the text and paint it</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-4 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
          Approve writes a verified gold row (<code>trust_level: gold</code>) to{" "}
          <code>review/verified.jsonl</code>. Train a bundle from it in the Training tab.
        </div>
      </div>
    </div>
  );
}
