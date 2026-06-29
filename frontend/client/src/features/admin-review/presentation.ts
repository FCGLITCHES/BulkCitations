import type { BatchReviewSummary, QueueSource } from "@shared/admin-review";

export const adminReviewSurfaceClassName =
  "rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none";

export const adminReviewTableHeadClassName =
  "px-6 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500";

export const healthBadgeClassByLabel: Record<BatchReviewSummary["healthLabel"], string> = {
  Ready:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  Review:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  "Action Needed":
    "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

export const queueSourceBadgeClassBySource: Record<QueueSource, string> = {
  pipeline_only:
    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  reports_only:
    "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  both: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  none: "bg-slate-100/70 text-slate-500 dark:bg-slate-900 dark:text-slate-400",
};

export const adminReviewSelectClassName =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition focus:border-[#002147] focus:ring-2 focus:ring-[#002147]/15 dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-100 dark:focus:border-[#0f4fa8] dark:focus:ring-[#0f4fa8]/20";

export const adminReviewPaginationButtonClassName =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-[#002147] hover:text-[#002147] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-300 dark:hover:border-[#0f4fa8] dark:hover:text-sky-300";

export const adminReviewActionLinkClassName =
  "text-xs font-semibold text-[#002147] transition-colors hover:text-[#2f6df6] dark:text-sky-300 dark:hover:text-sky-200";

export function formatQueueSourceLabel(source: QueueSource): string {
  switch (source) {
    case "pipeline_only":
      return "Pipeline only";
    case "reports_only":
      return "Reports only";
    case "both":
      return "Pipeline + reports";
    case "none":
      return "No active flags";
  }
}

export function formatOwnerMeta(summary: BatchReviewSummary): string {
  switch (summary.ownerType) {
    case "institution":
      return "Institution";
    case "user":
      return "User";
    case "api_key":
      return "API key";
    case "guest":
    default:
      return "Guest";
  }
}

export function formatBatchCounts(summary: BatchReviewSummary): string {
  return `${summary.counts.needsAction} action • ${summary.counts.needsReview} review • ${summary.openReportCounts.total} open reports`;
}

export function formatCompactDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
