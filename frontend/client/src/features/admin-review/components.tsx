import type { BatchReviewSummary, QueueSource } from "@shared/admin-review";
import { cn } from "@/lib/utils";
import {
  adminReviewSurfaceClassName,
  formatOwnerMeta,
  formatQueueSourceLabel,
  healthBadgeClassByLabel,
  queueSourceBadgeClassBySource,
} from "./presentation";

export function ReviewHealthBadge({
  label,
  className,
}: {
  label: BatchReviewSummary["healthLabel"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
        healthBadgeClassByLabel[label],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function ReviewQueueSourceBadge({
  source,
  className,
}: {
  source: QueueSource;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
        queueSourceBadgeClassBySource[source],
        className,
      )}
    >
      {formatQueueSourceLabel(source)}
    </span>
  );
}

export function ReviewOwnerSummary({ summary }: { summary: BatchReviewSummary }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{summary.ownerLabel}</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {formatOwnerMeta(summary)}
      </p>
    </div>
  );
}

export function ReviewMetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className={cn(adminReviewSurfaceClassName, "p-5")}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
      {detail ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{detail}</p>
      ) : null}
    </div>
  );
}
