import type { QueryClient } from "@tanstack/react-query";

import type {
  ActiveTruthBackgroundJob,
  ApprovedTruthBulkFilterPayload,
  ApprovedTruthListQueryKey,
  ApprovedTruthListResponse,
  ApprovedTruthRow,
  TruthBackgroundBulkJobResponse,
  TruthBackgroundBulkOperation,
  TruthBackgroundOptimisticUpdate,
  TruthBulkPrefillResponse,
  TruthBulkResultRecord,
  TruthBulkResultStatus,
  TruthBulkUpdateResponse,
  TruthRowHighlight,
  TruthRowHighlightTone,
  TruthRowStatus,
} from "./types";
import { TRUTH_ROW_HIGHLIGHT_DURATION_MS } from "./constants";

export { TRUTH_ROW_HIGHLIGHT_DURATION_MS };

export function effectiveApprovedTruthRowStatus(
  row: Pick<ApprovedTruthRow, "rowStatus" | "trustLevel">,
): TruthRowStatus {
  return row.rowStatus ?? (row.trustLevel === "draft" ? "draft" : "reviewed");
}

export function isApprovedTruthListQueryKey(
  queryKey: readonly unknown[],
): queryKey is ApprovedTruthListQueryKey {
  return (
    queryKey.length === 10 && queryKey[0] === "/internal/admin/approved-truth"
  );
}

export function approvedTruthFiltersFromQueryKey(
  queryKey: ApprovedTruthListQueryKey,
): ApprovedTruthBulkFilterPayload {
  const [
    ,
    trustLevel,
    datasetSplit,
    rowStatus,
    expectedStyle,
    goldKind,
    adversarialPair,
    styleEvaluationSuite,
  ] = queryKey;
  return {
    ...(trustLevel ? { trustLevel } : {}),
    ...(datasetSplit ? { datasetSplit } : {}),
    ...(rowStatus ? { rowStatus } : {}),
    ...(goldKind ? { goldKind } : {}),
    ...(expectedStyle.trim() ? { expectedStyle: expectedStyle.trim() } : {}),
    ...(adversarialPair.trim()
      ? { adversarialPair: adversarialPair.trim() }
      : {}),
    ...(styleEvaluationSuite ? { styleEvaluationSuite } : {}),
  };
}

export function approvedTruthFiltersEqual(
  left: ApprovedTruthBulkFilterPayload,
  right: ApprovedTruthBulkFilterPayload,
): boolean {
  return (
    (left.trustLevel ?? "") === (right.trustLevel ?? "") &&
    (left.datasetSplit ?? "") === (right.datasetSplit ?? "") &&
    (left.rowStatus ?? "") === (right.rowStatus ?? "") &&
    (left.goldKind ?? "") === (right.goldKind ?? "") &&
    (left.expectedStyle ?? "") === (right.expectedStyle ?? "") &&
    (left.adversarialPair ?? "") === (right.adversarialPair ?? "") &&
    (left.styleEvaluationSuite ?? "") === (right.styleEvaluationSuite ?? "")
  );
}

export function approvedTruthRowMatchesFilters(
  row: ApprovedTruthRow,
  filters: ApprovedTruthBulkFilterPayload,
): boolean {
  if (filters.trustLevel && row.trustLevel !== filters.trustLevel) {
    return false;
  }
  if (filters.datasetSplit && row.datasetSplit !== filters.datasetSplit) {
    return false;
  }
  if (
    filters.rowStatus &&
    effectiveApprovedTruthRowStatus(row) !== filters.rowStatus
  ) {
    return false;
  }
  if (filters.goldKind && (row.goldKind ?? "") !== filters.goldKind) {
    return false;
  }
  if (
    filters.expectedStyle &&
    (row.expectedStyle ?? "") !== filters.expectedStyle
  ) {
    return false;
  }
  if (
    filters.adversarialPair &&
    (row.adversarialPair ?? "") !== filters.adversarialPair
  ) {
    return false;
  }
  if (
    filters.styleEvaluationSuite &&
    (row.styleEvaluationSuite ?? "") !== filters.styleEvaluationSuite
  ) {
    return false;
  }
  return true;
}

export function applyTruthBackgroundUpdateToRow(
  row: ApprovedTruthRow,
  result: TruthBulkResultRecord,
  update?: TruthBackgroundOptimisticUpdate,
): ApprovedTruthRow {
  const nextTrustLevel = update?.trustLevel ?? row.trustLevel;

  if (result.status === "quarantined") {
    return {
      ...row,
      trustLevel: nextTrustLevel,
      rowStatus: "quarantined",
      blockedReason:
        update?.rowStatus === "quarantined"
          ? (update.blockedReason ?? null)
          : (row.blockedReason ?? null),
      updatedAt: new Date().toISOString(),
    };
  }

  if (result.status !== "updated") {
    return row;
  }

  const nextRowStatus =
    update?.rowStatus ??
    effectiveApprovedTruthRowStatus({
      rowStatus: row.rowStatus,
      trustLevel: nextTrustLevel,
    });
  const nextBlockedReason =
    update?.rowStatus === undefined
      ? (row.blockedReason ?? null)
      : update.rowStatus === "quarantined"
        ? (update.blockedReason ?? null)
        : null;

  return {
    ...row,
    trustLevel: nextTrustLevel,
    rowStatus: nextRowStatus,
    blockedReason: nextBlockedReason,
    updatedAt: new Date().toISOString(),
  };
}

export function countUpdatedTruthRowsLeavingFilters(
  rows: ApprovedTruthRow[],
  results: TruthBulkResultRecord[],
  filters: ApprovedTruthBulkFilterPayload,
  update?: TruthBackgroundOptimisticUpdate,
): number {
  const resultMap = new Map(results.map((result) => [result.id, result]));
  let leavingCount = 0;

  for (const row of rows) {
    const result = resultMap.get(row.id);
    if (!result) {
      continue;
    }
    const nextRow = applyTruthBackgroundUpdateToRow(row, result, update);
    if (
      approvedTruthRowMatchesFilters(row, filters) &&
      !approvedTruthRowMatchesFilters(nextRow, filters)
    ) {
      leavingCount += 1;
    }
  }

  return leavingCount;
}

export function reconcileApprovedTruthListCaches(
  queryClient: QueryClient,
  job: TruthBackgroundBulkJobResponse,
  options: { update?: TruthBackgroundOptimisticUpdate } = {},
): void {
  const resultMap = new Map(job.results.map((result) => [result.id, result]));
  if (resultMap.size === 0) {
    return;
  }

  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: ["/internal/admin/approved-truth"] })) {
    const queryKey = query.queryKey;
    if (!isApprovedTruthListQueryKey(queryKey)) {
      continue;
    }

    const filters = approvedTruthFiltersFromQueryKey(queryKey);
    queryClient.setQueryData<ApprovedTruthListResponse | undefined>(
      queryKey,
      (current) => {
        if (!current) {
          return current;
        }

        if (!approvedTruthFiltersEqual(filters, job.filters)) {
          return current;
        }

        const nextItems = current.items
          .map((row) => {
            const result = resultMap.get(row.id);
            if (!result) {
              return row;
            }
            if (job.operation === "delete" && result.status === "deleted") {
              return null;
            }
            return applyTruthBackgroundUpdateToRow(row, result, options.update);
          })
          .filter((row): row is ApprovedTruthRow => row !== null)
          .filter((row) => approvedTruthRowMatchesFilters(row, filters));

        const leavingCount =
          job.operation === "delete"
            ? current.items.filter(
                (row) => resultMap.get(row.id)?.status === "deleted",
              ).length
            : countUpdatedTruthRowsLeavingFilters(
                current.items,
                job.results,
                filters,
                options.update,
              );
        const nextTotal = Math.max(0, current.total - leavingCount);
        const nextTotalPages = Math.max(
          1,
          Math.ceil(nextTotal / current.limit),
        );

        return {
          ...current,
          items: nextItems,
          total: nextTotal,
          totalPages: nextTotalPages,
        };
      },
    );
  }
}

export function truthBackgroundOperationLabel(
  operation: TruthBackgroundBulkOperation,
): string {
  if (operation === "prefill") return "Engine refill";
  if (operation === "crossref") return "Crossref fill";
  if (operation === "delete") return "Bulk delete";
  if (operation === "certify") return "Bulk certification";
  return "Bulk update";
}

export function truthResultHighlightTone(
  operation: TruthBackgroundBulkOperation,
  status: TruthBulkResultStatus,
): TruthRowHighlightTone | null {
  if (operation === "prefill") {
    if (status === "updated" || status === "unchanged") return "success";
    if (status === "failed" || status === "quarantined") return "failure";
    return null;
  }
  if (operation === "crossref") {
    if (status === "updated" || status === "unchanged" || status === "skipped")
      return "success";
    if (status === "failed" || status === "quarantined") return "failure";
    return null;
  }
  if (operation === "delete") {
    return status === "deleted" ? "success" : "failure";
  }
  if (operation === "certify") {
    return status === "certified" ? "success" : "failure";
  }
  if (status === "updated" || status === "unchanged") return "success";
  if (status === "failed" || status === "quarantined") return "failure";
  return null;
}

export function formatTruthRowHighlightLabel(
  highlight: TruthRowHighlight,
): string {
  const prefix = truthBackgroundOperationLabel(highlight.operation);
  if (highlight.status === "unchanged") {
    return `${prefix}: no change`;
  }
  if (highlight.status === "updated") {
    return `${prefix}: updated`;
  }
  if (highlight.status === "quarantined") {
    return `${prefix}: quarantined`;
  }
  if (highlight.status === "skipped") {
    return `${prefix}: skipped`;
  }
  return `${prefix}: failed`;
}

export function buildTruthBackgroundProgressDescription(
  job: TruthBackgroundBulkJobResponse,
): string {
  if (job.totalPages === 0) {
    return `0 / 0 pages complete.`;
  }
  if (job.completedPages === 0) {
    return `Starting page 1 of ${job.totalPages}.`;
  }
  return `${job.completedPages} / ${job.totalPages} pages complete.`;
}

function formatTruthBackgroundAbsolutePageScope(
  pageProgress: NonNullable<ActiveTruthBackgroundJob["pageProgress"]>,
): string {
  if (pageProgress.pageStart === pageProgress.pageEnd) {
    return `page ${pageProgress.pageStart} of ${pageProgress.availableTotalPages}`;
  }
  return `pages ${pageProgress.pageStart}-${pageProgress.pageEnd} of ${pageProgress.availableTotalPages}`;
}

export function buildTruthBackgroundLastSuccessfulPageDescription(input: {
  lastSuccessfulPage: number;
  pageProgress?: ActiveTruthBackgroundJob["pageProgress"];
}): string {
  if (input.lastSuccessfulPage <= 0) {
    if (!input.pageProgress) {
      return "No pages completed before failure.";
    }
    return `No pages completed before failure in ${formatTruthBackgroundAbsolutePageScope(input.pageProgress)}.`;
  }

  if (!input.pageProgress) {
    return `Last successful page: ${input.lastSuccessfulPage}.`;
  }

  return `Last successful page: ${input.lastSuccessfulPage} of ${input.pageProgress.availableTotalPages}.`;
}

export function buildTruthBackgroundPageProgressDescription(
  job: TruthBackgroundBulkJobResponse,
  pageProgress?: ActiveTruthBackgroundJob["pageProgress"],
): string {
  if (!pageProgress) {
    return buildTruthBackgroundProgressDescription(job);
  }

  const selectedPageCount = Math.max(
    0,
    pageProgress.pageEnd - pageProgress.pageStart + 1,
  );
  if (selectedPageCount === 0) {
    return `0 / 0 selected pages complete.`;
  }

  if (job.completedPages === 0) {
    return `Working on ${formatTruthBackgroundAbsolutePageScope(pageProgress)}. Starting page ${pageProgress.pageStart} of ${pageProgress.availableTotalPages}.`;
  }

  const completedThroughPage = Math.min(
    pageProgress.pageEnd,
    pageProgress.pageStart + job.completedPages - 1,
  );
  return `Completed through page ${completedThroughPage} of ${pageProgress.availableTotalPages}. ${job.completedPages} / ${selectedPageCount} selected pages complete.`;
}

export function buildTruthBackgroundHighlightSummary(
  job: TruthBackgroundBulkJobResponse,
  pageProgress?: ActiveTruthBackgroundJob["pageProgress"],
): string | null {
  if (!pageProgress) {
    return null;
  }

  if (job.completedPages <= 0) {
    return `Waiting for ${formatTruthBackgroundAbsolutePageScope(pageProgress)} to finish its first page.`;
  }

  const completedThroughPage = Math.min(
    pageProgress.pageEnd,
    pageProgress.pageStart + job.completedPages - 1,
  );
  if (completedThroughPage <= pageProgress.pageStart) {
    return `Highlights cover page ${completedThroughPage} of ${pageProgress.availableTotalPages}.`;
  }

  return `Highlights cover pages ${pageProgress.pageStart}-${completedThroughPage} of ${pageProgress.availableTotalPages}.`;
}

export function buildTruthBackgroundCompletionDescription(
  job: TruthBackgroundBulkJobResponse,
  pageProgress?: ActiveTruthBackgroundJob["pageProgress"],
): string {
  const counts: string[] = [];
  if (
    job.operation === "prefill" ||
    job.operation === "crossref" ||
    job.operation === "update"
  ) {
    counts.push(`updated ${job.updatedCount}`);
    if (job.unchangedCount > 0) {
      counts.push(`unchanged ${job.unchangedCount}`);
    }
  }
  if (job.operation === "delete") {
    counts.push(`deleted ${job.deletedCount}`);
  }
  if (job.operation === "certify") {
    counts.push(`certified ${job.certifiedCount}`);
  }
  if (job.quarantinedCount > 0) {
    counts.push(`quarantined ${job.quarantinedCount}`);
  }
  if (job.skippedCount > 0) {
    counts.push(`skipped ${job.skippedCount}`);
  }
  if (job.failedCount > 0) {
    counts.push(`failed ${job.failedCount}`);
  }

  if (!pageProgress) {
    return `${job.completedPages} / ${job.totalPages} pages complete. ${counts.join(", ")}.`;
  }

  return `Completed ${formatTruthBackgroundAbsolutePageScope(pageProgress)}. ${counts.join(", ")}.`;
}

export function buildTruthBackgroundFailureDescription(input: {
  message: string;
  lastSuccessfulPage: number;
  pageProgress?: ActiveTruthBackgroundJob["pageProgress"];
}): string {
  const lastSuccessfulPageDescription =
    buildTruthBackgroundLastSuccessfulPageDescription({
      lastSuccessfulPage: input.lastSuccessfulPage,
      pageProgress: input.pageProgress,
    });
  return `${input.message} ${lastSuccessfulPageDescription}`;
}

export function buildTruthBackgroundCompletionTitle(
  job: TruthBackgroundBulkJobResponse,
): string {
  if (job.status === "failed") {
    return `${truthBackgroundOperationLabel(job.operation)} failed`;
  }
  if (
    (job.operation === "prefill" ||
      job.operation === "crossref" ||
      job.operation === "update") &&
    job.updatedCount === 0 &&
    job.unchangedCount > 0 &&
    job.failedCount === 0 &&
    job.quarantinedCount === 0
  ) {
    return `${truthBackgroundOperationLabel(job.operation)} found no changes`;
  }
  if (job.failedCount > 0 || job.quarantinedCount > 0 || job.skippedCount > 0) {
    return `${truthBackgroundOperationLabel(job.operation)} completed with issues`;
  }
  return `${truthBackgroundOperationLabel(job.operation)} complete`;
}

export function buildSelectedPrefillCompletionTitle(
  result: TruthBulkPrefillResponse,
): string {
  if (
    result.updatedCount === 0 &&
    result.unchangedCount > 0 &&
    result.failedCount === 0 &&
    result.quarantinedCount === 0
  ) {
    return "Engine refill found no changes";
  }
  if (result.failedCount > 0 || result.quarantinedCount > 0) {
    return "Bulk refill completed with issues";
  }
  return "Bulk refill complete";
}

export function buildSelectedPrefillCompletionDescription(
  result: TruthBulkPrefillResponse,
): string {
  const counts = [`updated ${result.updatedCount}`];
  if (result.unchangedCount > 0) {
    counts.push(`unchanged ${result.unchangedCount}`);
  }
  if (result.quarantinedCount > 0) {
    counts.push(`quarantined ${result.quarantinedCount}`);
  }
  if (result.failedCount > 0) {
    counts.push(`failed ${result.failedCount}`);
  }
  return `${result.requestedCount} row${result.requestedCount === 1 ? "" : "s"} processed. ${counts.join(", ")}.`;
}

export function buildBulkUpdateCompletionTitle(
  result: TruthBulkUpdateResponse,
): string {
  if (
    result.updatedCount === 0 &&
    result.unchangedCount > 0 &&
    result.failedCount === 0 &&
    result.quarantinedCount === 0
  ) {
    return "Bulk update found no changes";
  }
  if (result.failedCount > 0 || result.quarantinedCount > 0) {
    return "Bulk update completed with issues";
  }
  return "Bulk update complete";
}

export function buildBulkUpdateCompletionDescription(
  result: TruthBulkUpdateResponse,
): string {
  const counts = [`updated ${result.updatedCount}`];
  if (result.unchangedCount > 0) {
    counts.push(`unchanged ${result.unchangedCount}`);
  }
  if (result.quarantinedCount > 0) {
    counts.push(`quarantined ${result.quarantinedCount}`);
  }
  if (result.failedCount > 0) {
    counts.push(`failed ${result.failedCount}`);
  }
  return `${result.requestedCount} row${result.requestedCount === 1 ? "" : "s"} processed. ${counts.join(", ")}.`;
}
