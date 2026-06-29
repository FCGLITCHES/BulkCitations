import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { CitationLineItem } from "@shared/admin-review";
import { Link } from "wouter";
import { Fragment, useState } from "react";
import { AdminFooter } from "./AdminFooter";
import { AdminHeader } from "./AdminHeader";
import { AdminSectionTabs } from "./AdminSectionTabs";
import {
  ReviewHealthBadge,
  ReviewMetricTile,
  ReviewOwnerSummary,
  ReviewQueueSourceBadge,
} from "@/features/admin-review/components";
import {
  fetchReviewQueue,
  fetchReviewQueueCitations,
  reviewQueueCitationsQueryKey,
  reviewQueueQueryKey,
  type ReviewQueueQueryState,
  type ReviewQueueSortBy,
} from "@/features/admin-review/query";
import {
  adminReviewActionLinkClassName,
  adminReviewPaginationButtonClassName,
  adminReviewSelectClassName,
  adminReviewSurfaceClassName,
  adminReviewTableHeadClassName,
  formatBatchCounts,
  formatCompactDate,
} from "@/features/admin-review/presentation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;
const CITATIONS_PAGE_SIZE = 25;

function ReviewQueueExpansion({ jobId }: { jobId: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: reviewQueueCitationsQueryKey(jobId),
      queryFn: ({ pageParam }) =>
        fetchReviewQueueCitations(
          jobId,
          (pageParam as number | null | undefined) ?? null,
          CITATIONS_PAGE_SIZE,
        ),
      initialPageParam: null as number | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    });

  const citations = data?.pages.flatMap((page) => page.citations) ?? [];
  const totalFlaggedCitations = data?.pages[0]?.totalFlaggedCitations ?? 0;

  if (isLoading) {
    return (
      <div className="px-6 py-6 text-sm text-slate-500 dark:text-slate-400">
        Loading flagged citations...
      </div>
    );
  }

  if (citations.length === 0) {
    return (
      <div className="px-6 py-6 text-sm text-slate-500 dark:text-slate-400">
        No flagged citations remain in this batch.
      </div>
    );
  }

  return (
    <div className="space-y-4 px-6 py-6">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
        Showing {citations.length} of {totalFlaggedCitations} flagged citations
      </p>
      <div className="space-y-3">
        {citations.map((citation) => (
          <CitationLine key={citation.citationId} citation={citation} />
        ))}
      </div>
      {hasNextPage ? (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="rounded-full border border-slate-200 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700 transition-colors hover:border-[#0f4fa8] hover:text-[#0f4fa8] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-blue-400 dark:hover:text-blue-300"
        >
          {isFetchingNextPage ? "Loading more..." : "Load more"}
        </button>
      ) : null}
    </div>
  );
}

function CitationLine({ citation }: { citation: CitationLineItem }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-700/80 dark:bg-slate-950/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white dark:bg-slate-100 dark:text-slate-950">
              Ref {citation.index + 1}
            </span>
            <ReviewHealthBadge
              label={
                citation.publicStatus === "needs_action"
                  ? "Action Needed"
                  : citation.publicStatus === "needs_review"
                    ? "Review"
                    : "Ready"
              }
            />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Updated {formatCompactDate(citation.latestTimestamp)}
            </span>
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {citation.originalText}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {citation.renderedPreview ?? "No rendered preview available yet."}
          </p>
        </div>
        <div className="min-w-[220px] space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Linked open reports
          </p>
          {citation.linkedReports.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No open reports.
            </p>
          ) : (
            <div className="space-y-2">
              {citation.linkedReports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      {report.status}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {report.failureCategories.join(", ")}
                    </p>
                  </div>
                  <Link href={`/admin/reports/${report.id}`}>
                    <button
                      type="button"
                      className={adminReviewActionLinkClassName}
                    >
                      Open
                    </button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminReportQueue() {
  const [queryState, setQueryState] = useState<ReviewQueueQueryState>({
    page: 0,
    limit: PAGE_SIZE,
    statusFilter: "any_flagged",
    sourceFilter: "all",
    sortBy: "latestActionableAt",
    sortDirection: "desc",
  });
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: reviewQueueQueryKey(queryState),
    queryFn: () => fetchReviewQueue(queryState),
    placeholderData: (previousData) => previousData,
  });

  const batches = data?.batches ?? [];
  const total = data?.total ?? 0;
  const totalFlagged = batches.reduce(
    (sum, batch) => sum + batch.flaggedCitationCount,
    0,
  );
  const totalOpenReports = batches.reduce(
    (sum, batch) => sum + batch.openReportCounts.total,
    0,
  );

  function toggleExpanded(jobId: string) {
    setExpandedJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  }

  function setSort(sortBy: ReviewQueueSortBy) {
    setQueryState((current) => ({
      ...current,
      sortBy,
      sortDirection:
        current.sortBy === sortBy && current.sortDirection === "desc"
          ? "asc"
          : "desc",
    }));
  }

  return (
    <div className="min-h-[100dvh] bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#11161d] dark:text-slate-100">
      <AdminHeader />

      <main className="mx-auto max-w-[1500px] px-6 pb-24 pt-28 md:px-8">
        <div className="mb-6">
          <AdminSectionTabs />
        </div>
        <section className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Administrative Console
            </p>
            <h1 className="font-headline text-4xl font-black tracking-tight text-[#0f4fa8] dark:text-blue-300">
              Review Queue
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Review batches with non-ready citations or open reports. Queue
              state is derived from citation health and linked report lifecycle,
              so batches only leave this view when the underlying issues are
              actually cleared.
            </p>
          </div>

          <div
            className={cn(
              adminReviewSurfaceClassName,
              "grid gap-3 p-4 md:grid-cols-4",
            )}
          >
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Health
              </span>
              <select
                value={queryState.statusFilter}
                onChange={(event) =>
                  setQueryState((current) => ({
                    ...current,
                    page: 0,
                    statusFilter: event.target
                      .value as ReviewQueueQueryState["statusFilter"],
                  }))
                }
                className={adminReviewSelectClassName}
              >
                <option value="any_flagged">All flagged</option>
                <option value="action_needed">Action needed</option>
                <option value="review">Review</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Source
              </span>
              <select
                value={queryState.sourceFilter}
                onChange={(event) =>
                  setQueryState((current) => ({
                    ...current,
                    page: 0,
                    sourceFilter: event.target
                      .value as ReviewQueueQueryState["sourceFilter"],
                  }))
                }
                className={adminReviewSelectClassName}
              >
                <option value="all">All sources</option>
                <option value="pipeline_only">Pipeline only</option>
                <option value="reports_only">Reports only</option>
                <option value="both">Pipeline + reports</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Sort by
              </span>
              <select
                value={queryState.sortBy}
                onChange={(event) =>
                  setQueryState((current) => ({
                    ...current,
                    page: 0,
                    sortBy: event.target.value as ReviewQueueSortBy,
                  }))
                }
                className={adminReviewSelectClassName}
              >
                <option value="latestActionableAt">Latest actionable</option>
                <option value="createdAt">Created at</option>
                <option value="flaggedCitationCount">Flagged citations</option>
                <option value="totalCitations">Total citations</option>
                <option value="ownerLabel">Owner</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Direction
              </span>
              <select
                value={queryState.sortDirection}
                onChange={(event) =>
                  setQueryState((current) => ({
                    ...current,
                    page: 0,
                    sortDirection: event.target
                      .value as ReviewQueueQueryState["sortDirection"],
                  }))
                }
                className={adminReviewSelectClassName}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
          </div>
        </section>

        <section className="mb-8 grid gap-6 md:grid-cols-3">
          <ReviewMetricTile
            label="Queued batches"
            value={isLoading ? "..." : total.toLocaleString()}
            detail="Batches currently matching queue rules."
          />
          <ReviewMetricTile
            label="Visible flagged citations"
            value={isLoading ? "..." : totalFlagged.toLocaleString()}
            detail="Flagged citations on the current results page."
          />
          <ReviewMetricTile
            label="Visible open reports"
            value={isLoading ? "..." : totalOpenReports.toLocaleString()}
            detail="Pending and proposed reports linked to visible batches."
          />
        </section>

        <section className={cn(adminReviewSurfaceClassName, "overflow-hidden")}>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <TableHead className={adminReviewTableHeadClassName}>
                  Batch
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Owner
                </TableHead>
                <TableHead
                  className={cn(
                    adminReviewTableHeadClassName,
                    "cursor-pointer transition-colors hover:text-[#0f4fa8] dark:hover:text-blue-300",
                  )}
                  onClick={() => setSort("latestActionableAt")}
                >
                  Latest Actionable
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Counts
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Health
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Source
                </TableHead>
                <TableHead
                  className={cn(adminReviewTableHeadClassName, "text-right")}
                >
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    Loading review queue...
                  </TableCell>
                </TableRow>
              ) : batches.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    No batches match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                batches.map((batch) => {
                  const expanded = expandedJobIds.has(batch.jobId);

                  return (
                    <Fragment key={batch.jobId}>
                      <TableRow className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                        <TableCell className="px-6 py-5 align-top">
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(batch.jobId)}
                              className="inline-flex items-center gap-2 text-left text-[10px] font-black uppercase tracking-widest text-[#0f4fa8] transition-colors hover:text-blue-500 dark:text-blue-300"
                            >
                              <span className="material-symbols-outlined text-sm">
                                {expanded ? "expand_less" : "expand_more"}
                              </span>
                              {expanded ? "Hide citations" : "View citations"}
                            </button>
                            <p className="font-mono text-xs font-black text-slate-800 dark:text-slate-100">
                              #{batch.jobId.slice(0, 8).toUpperCase()}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {batch.outputStyle?.toUpperCase() ?? "UNKNOWN"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top">
                          <ReviewOwnerSummary summary={batch} />
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top text-sm text-slate-700 dark:text-slate-200">
                          {formatCompactDate(
                            batch.latestActionableAt ?? batch.createdAt,
                          )}
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top">
                          <div className="space-y-1">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                              {batch.totalCitations} total
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {formatBatchCounts(batch)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top">
                          <ReviewHealthBadge label={batch.healthLabel} />
                        </TableCell>
                        <TableCell className="px-6 py-5 align-top">
                          <ReviewQueueSourceBadge source={batch.queueSource} />
                        </TableCell>
                        <TableCell className="px-6 py-5 text-right align-top">
                          <Link href="/admin/references">
                            <button
                              type="button"
                              className={adminReviewActionLinkClassName}
                            >
                              Open archive
                            </button>
                          </Link>
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={7}
                            className="bg-slate-50/70 p-0 dark:bg-slate-950/40"
                          >
                            <ReviewQueueExpansion jobId={batch.jobId} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Showing{" "}
              <span className="text-slate-900 dark:text-slate-100">
                {batches.length}
              </span>{" "}
              of{" "}
              <span className="text-slate-900 dark:text-slate-100">
                {total}
              </span>{" "}
              queued batches
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setQueryState((current) => ({
                    ...current,
                    page: Math.max(0, current.page - 1),
                  }))
                }
                disabled={queryState.page === 0}
                className={adminReviewPaginationButtonClassName}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() =>
                  setQueryState((current) => ({
                    ...current,
                    page: current.page + 1,
                  }))
                }
                disabled={(queryState.page + 1) * queryState.limit >= total}
                className={adminReviewPaginationButtonClassName}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>

      <AdminFooter />
    </div>
  );
}
