import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type {
  AdminReferenceArchiveResponse,
  CitationStorageStatus,
  OwnerType,
  ReviewHealthLabel,
  ReviewQueueCitationsResponse,
  ReviewQueueResponse,
} from "@shared/admin-review";
import { adminFetch } from "@/lib/admin-api";

export type ReviewQueueStatusFilter = "any_flagged" | "action_needed" | "review";
export type ReviewQueueSourceFilter = "all" | "pipeline_only" | "reports_only" | "both";
export type ReviewQueueSortBy =
  | "latestActionableAt"
  | "createdAt"
  | "flaggedCitationCount"
  | "totalCitations"
  | "ownerLabel";
export type ReviewQueueSortDirection = "asc" | "desc";

export interface ReviewQueueQueryState {
  page: number;
  limit: number;
  statusFilter: ReviewQueueStatusFilter;
  sourceFilter: ReviewQueueSourceFilter;
  sortBy: ReviewQueueSortBy;
  sortDirection: ReviewQueueSortDirection;
}

export interface AdminReferencesQueryState {
  page: number;
  limit: number;
  healthLabel: "all" | ReviewHealthLabel;
  storageStatus: "all" | CitationStorageStatus;
  ownerType: "all" | OwnerType;
  ownerQuery: string;
  jobQuery: string;
}

const REVIEW_QUEUE_KEY = "/internal/admin/review-queue";
const REVIEW_QUEUE_CITATIONS_KEY = "/internal/admin/review-queue/citations";
const ADMIN_REFERENCES_KEY = "/internal/admin/references";

export function reviewQueueQueryKey(state: ReviewQueueQueryState) {
  return [REVIEW_QUEUE_KEY, state] as const;
}

export function reviewQueueCitationsQueryKey(jobId: string) {
  return [REVIEW_QUEUE_CITATIONS_KEY, jobId] as const;
}

export function adminReferencesQueryKey(state: AdminReferencesQueryState) {
  return [ADMIN_REFERENCES_KEY, state] as const;
}

export async function fetchReviewQueue(state: ReviewQueueQueryState) {
  const params = new URLSearchParams({
    limit: state.limit.toString(),
    offset: String(state.page * state.limit),
    statusFilter: state.statusFilter,
    sourceFilter: state.sourceFilter,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
  });

  return adminFetch<ReviewQueueResponse>(`${REVIEW_QUEUE_KEY}?${params.toString()}`);
}

export async function fetchReviewQueueCitations(
  jobId: string,
  cursor?: number | null,
  limit = 25,
) {
  const params = new URLSearchParams({
    limit: limit.toString(),
  });

  if (cursor != null) {
    params.set("cursor", cursor.toString());
  }

  return adminFetch<ReviewQueueCitationsResponse>(
    `/internal/admin/review-queue/${jobId}/citations?${params.toString()}`,
  );
}

export async function fetchAdminReferences(state: AdminReferencesQueryState) {
  const params = new URLSearchParams({
    limit: state.limit.toString(),
    offset: String(state.page * state.limit),
  });

  if (state.healthLabel !== "all") {
    params.set("healthLabel", state.healthLabel);
  }

  if (state.storageStatus !== "all") {
    params.set("storageStatus", state.storageStatus);
  }

  if (state.ownerType !== "all") {
    params.set("ownerType", state.ownerType);
  }

  const ownerQuery = state.ownerQuery.trim();
  if (ownerQuery) {
    params.set("ownerQuery", ownerQuery);
  }

  const jobQuery = state.jobQuery.trim();
  if (jobQuery) {
    params.set("jobQuery", jobQuery);
  }

  return adminFetch<AdminReferenceArchiveResponse>(`${ADMIN_REFERENCES_KEY}?${params.toString()}`);
}

export function invalidateAdminReviewQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: [REVIEW_QUEUE_KEY] });
  void queryClient.invalidateQueries({ queryKey: [ADMIN_REFERENCES_KEY] });
  void queryClient.invalidateQueries({ queryKey: ["/internal/admin/analytics/summary"] });
}

export function removeDeletedReportFromCitationPages(
  queryClient: QueryClient,
  reportId: string,
) {
  const queries = queryClient.getQueriesData<InfiniteData<ReviewQueueCitationsResponse>>({
    queryKey: [REVIEW_QUEUE_CITATIONS_KEY],
  });

  for (const [queryKey, data] of queries) {
    if (!data) continue;
    queryClient.setQueryData<InfiniteData<ReviewQueueCitationsResponse>>(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        citations: page.citations
          .map((citation) => ({
            ...citation,
            linkedReports: citation.linkedReports.filter((report) => report.id !== reportId),
          }))
          .filter((citation) => {
            return citation.publicStatus !== "ready" || citation.linkedReports.length > 0;
          }),
      })),
    });
  }
}
