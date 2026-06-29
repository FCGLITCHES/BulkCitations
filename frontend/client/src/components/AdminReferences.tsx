import { useQuery } from "@tanstack/react-query";
import type {
  AdminReferenceArchiveItem,
  CitationStorageStatus,
  OwnerType,
  ReviewHealthLabel,
} from "@shared/admin-review";
import { useState } from "react";
import { Link } from "wouter";
import { AdminShell } from "./AdminShell";
import { ReviewHealthBadge } from "@/features/admin-review/components";
import {
  adminReferencesQueryKey,
  fetchAdminReferences,
  type AdminReferencesQueryState,
} from "@/features/admin-review/query";
import {
  adminReviewActionLinkClassName,
  adminReviewPaginationButtonClassName,
  adminReviewSelectClassName,
  adminReviewSurfaceClassName,
  adminReviewTableHeadClassName,
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

const PAGE_SIZE = 25;

const defaultQueryState: AdminReferencesQueryState = {
  page: 0,
  limit: PAGE_SIZE,
  healthLabel: "all",
  storageStatus: "all",
  ownerType: "all",
  ownerQuery: "",
  jobQuery: "",
};

const storageBadgeClassNames: Record<CitationStorageStatus, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  duplicate:
    "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
  failed: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

const ownerTypeLabelByValue: Record<OwnerType, string> = {
  institution: "Institution",
  user: "User",
  api_key: "API key",
  guest: "Guest",
};

function StorageStatusBadge({ status }: { status: CitationStorageStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
        storageBadgeClassNames[status],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

function ReferenceOwnerSummary({
  ownerLabel,
  ownerType,
}: {
  ownerLabel: string;
  ownerType: OwnerType;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
        {ownerLabel}
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {ownerTypeLabelByValue[ownerType]}
      </p>
    </div>
  );
}

function ReferencePreview({
  reference,
}: {
  reference: AdminReferenceArchiveItem;
}) {
  return (
    <div className="space-y-2">
      <p className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {reference.rawText}
      </p>
      <p className="line-clamp-2 text-xs text-slate-600 dark:text-slate-400">
        {reference.renderedText ??
          "No rendered output saved for this reference."}
      </p>
    </div>
  );
}

export default function AdminReferences() {
  const [queryState, setQueryState] =
    useState<AdminReferencesQueryState>(defaultQueryState);
  const [ownerQueryInput, setOwnerQueryInput] = useState(
    defaultQueryState.ownerQuery,
  );
  const [jobQueryInput, setJobQueryInput] = useState(
    defaultQueryState.jobQuery,
  );

  const { data, isLoading } = useQuery({
    queryKey: adminReferencesQueryKey(queryState),
    queryFn: () => fetchAdminReferences(queryState),
    placeholderData: (previousData) => previousData,
  });

  const references = data?.references ?? [];
  const total = data?.total ?? 0;

  function applyTextFilters() {
    setQueryState((current) => ({
      ...current,
      page: 0,
      ownerQuery: ownerQueryInput,
      jobQuery: jobQueryInput,
    }));
  }

  function resetFilters() {
    setOwnerQueryInput("");
    setJobQueryInput("");
    setQueryState(defaultQueryState);
  }

  return (
    <AdminShell
      title="History"
      subtitle="Stored reference archive across users and batches."
    >
      <div>
        <section className="mb-6">
          <div className="space-y-1">
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Reference archive
            </h2>
            <p className="max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              Every stored reference across users and batches — ready, review,
              action-needed, duplicate, and failed rows. The review queue stays
              separate and only tracks actionable batches.
            </p>
          </div>
        </section>

        <section
          className={cn(
            adminReviewSurfaceClassName,
            "mb-6 grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5",
          )}
        >
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Health
              </span>
              <select
                value={queryState.healthLabel}
                onChange={(event) =>
                  setQueryState((current) => ({
                    ...current,
                    page: 0,
                    healthLabel: event.target.value as
                      | "all"
                      | ReviewHealthLabel,
                  }))
                }
                className={adminReviewSelectClassName}
              >
                <option value="all">All health</option>
                <option value="Ready">Ready</option>
                <option value="Review">Review</option>
                <option value="Action Needed">Action needed</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Result
              </span>
              <select
                value={queryState.storageStatus}
                onChange={(event) =>
                  setQueryState((current) => ({
                    ...current,
                    page: 0,
                    storageStatus: event.target.value as
                      | "all"
                      | CitationStorageStatus,
                  }))
                }
                className={adminReviewSelectClassName}
              >
                <option value="all">All result states</option>
                <option value="active">Active</option>
                <option value="duplicate">Duplicate</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Owner type
              </span>
              <select
                value={queryState.ownerType}
                onChange={(event) =>
                  setQueryState((current) => ({
                    ...current,
                    page: 0,
                    ownerType: event.target.value as "all" | OwnerType,
                  }))
                }
                className={adminReviewSelectClassName}
              >
                <option value="all">All owners</option>
                <option value="institution">Institution</option>
                <option value="user">User</option>
                <option value="api_key">API key</option>
                <option value="guest">Guest</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                User or owner
              </span>
              <input
                value={ownerQueryInput}
                onChange={(event) => setOwnerQueryInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applyTextFilters();
                  }
                }}
                placeholder="Search owner label"
                className={adminReviewSelectClassName}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Batch
              </span>
              <input
                value={jobQueryInput}
                onChange={(event) => setJobQueryInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applyTextFilters();
                  }
                }}
                placeholder="Search batch id"
                className={adminReviewSelectClassName}
              />
            </label>

            <div className="flex items-end gap-2 md:col-span-5">
              <button
                type="button"
                onClick={applyTextFilters}
                className={adminReviewPaginationButtonClassName}
              >
                Apply filters
              </button>
              <button
                type="button"
                onClick={resetFilters}
                className={adminReviewPaginationButtonClassName}
              >
                Reset
              </button>
            </div>
        </section>

        <section className={cn(adminReviewSurfaceClassName, "overflow-hidden")}>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-200 hover:bg-transparent dark:border-slate-800 dark:hover:bg-transparent">
                <TableHead className={adminReviewTableHeadClassName}>
                  Reference
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Batch
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Owner
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Health
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Result
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Open Reports
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Latest Activity
                </TableHead>
                <TableHead className={adminReviewTableHeadClassName}>
                  Preview
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
                    colSpan={9}
                    className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    Loading archived references...
                  </TableCell>
                </TableRow>
              ) : references.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    No references match the current archive filters.
                  </TableCell>
                </TableRow>
              ) : (
                references.map((reference) => (
                  <TableRow
                    key={reference.citationId}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                  >
                    <TableCell className="px-6 py-5 align-top">
                      <div className="space-y-1">
                        <p className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {reference.citationId.slice(0, 8).toUpperCase()}
                        </p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          Ref {reference.referenceIndex + 1}
                        </p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {(reference.referenceType ?? "unknown").replace(
                            /-/g,
                            " ",
                          )}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-5 align-top">
                      <div className="space-y-1">
                        <p className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                          #{reference.jobId.slice(0, 8).toUpperCase()}
                        </p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {reference.outputStyle?.toUpperCase() ?? "UNKNOWN"}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Detected{" "}
                          {reference.detectedStyle?.toUpperCase() ?? "UNKNOWN"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-5 align-top">
                      <ReferenceOwnerSummary
                        ownerLabel={reference.ownerLabel}
                        ownerType={reference.ownerType}
                      />
                    </TableCell>
                    <TableCell className="px-6 py-5 align-top">
                      <ReviewHealthBadge label={reference.healthLabel} />
                    </TableCell>
                    <TableCell className="px-6 py-5 align-top">
                      <StorageStatusBadge status={reference.storageStatus} />
                    </TableCell>
                    <TableCell className="px-6 py-5 align-top">
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                          {reference.openReportCounts.total}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {reference.openReportCounts.pending} pending •{" "}
                          {reference.openReportCounts.proposed} proposed
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-5 align-top text-sm text-slate-700 dark:text-slate-200">
                      <div className="space-y-1">
                        <p>{formatCompactDate(reference.latestActivityAt)}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Batch {formatCompactDate(reference.batchCreatedAt)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[420px] px-6 py-5 align-top">
                      <ReferencePreview reference={reference} />
                    </TableCell>
                    <TableCell className="px-6 py-5 text-right align-top">
                      <Link href="/admin/reports">
                        <button
                          type="button"
                          className={adminReviewActionLinkClassName}
                        >
                          Review queue
                        </button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800/60">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Showing{" "}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {references.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {total}
              </span>{" "}
              references
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
      </div>
    </AdminShell>
  );
}
