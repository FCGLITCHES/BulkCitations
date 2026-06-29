import { randomUUID } from "node:crypto";

import { listApprovedTruth } from "../../runtime/persistence.js";
import type {
  StoredApprovedTruth,
  TruthDatasetSplit,
  TruthTaskCertification,
  TruthTrustLevel,
} from "../../runtime/store.js";
import type {
  BulkTruthUpdateInput,
  CertifyTruthInput,
  TruthBackgroundBulkOperation,
  TruthBackgroundPageRangeInput,
  TruthBulkFilterInput,
} from "./schemas.js";
import { withLegacyCertification } from "../../training/truthCertification.js";

const TRUTH_SCAN_LIMIT = 50_000;
const TRUTH_BACKGROUND_JOB_RETENTION_LIMIT = 24;
const TRUTH_BACKGROUND_CROSSREF_CONCURRENCY = 4;

export type ApprovedTruthListFilters = {
  trustLevel?: TruthTrustLevel;
  datasetSplit?: TruthDatasetSplit;
  rowStatus?: StoredApprovedTruth["rowStatus"];
  datasetVersion?: string;
  goldKind?: StoredApprovedTruth["goldKind"];
  expectedStyle?: string;
  adversarialPair?: string;
  styleEvaluationSuite?: StoredApprovedTruth["styleEvaluationSuite"];
  certificationView?: "pending" | "certified";
};

export type TruthPrefillRowResult = {
  id: string;
  status: "updated" | "unchanged" | "quarantined" | "failed";
  fieldCount: number;
  message?: string;
};

export type TruthCrossrefRowResult = {
  id: string;
  status: "updated" | "quarantined" | "skipped" | "failed";
  fieldCount: number;
  doi?: string | null;
  message?: string;
};

export type TruthDeleteRowResult = {
  id: string;
  status: "deleted" | "failed";
  message?: string;
};

export type TruthCertifyRowResult = {
  id: string;
  status: "certified" | "quarantined" | "failed";
  packTarget?: string | undefined;
  stagedBundleId?: string | undefined;
  message?: string | undefined;
};

export type TruthUpdateRowResult = {
  id: string;
  status: "updated" | "unchanged" | "quarantined" | "failed";
  message?: string;
};

export type TruthBackgroundRowResult =
  | TruthPrefillRowResult
  | TruthCrossrefRowResult
  | TruthDeleteRowResult
  | TruthCertifyRowResult
  | TruthUpdateRowResult;

export type TruthBackgroundJobStatus = "pending" | "running" | "completed" | "failed";

export type TruthBackgroundJob = {
  id: string;
  operation: TruthBackgroundBulkOperation;
  status: TruthBackgroundJobStatus;
  filters: ApprovedTruthListFilters;
  certify: CertifyTruthInput | null;
  update: BulkTruthUpdateInput | null;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  completedRows: number;
  completedPages: number;
  updatedCount: number;
  unchangedCount: number;
  deletedCount: number;
  certifiedCount: number;
  quarantinedCount: number;
  skippedCount: number;
  failedCount: number;
  results: TruthBackgroundRowResult[];
  recentResults: TruthBackgroundRowResult[];
  recentCompletedPage: number | null;
  recentCompletedAt: string | null;
  rowIds: string[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export const truthBackgroundJobs = new Map<string, TruthBackgroundJob>();

export type TruthBackgroundQueueJobData = {
  operation: TruthBackgroundBulkOperation;
  filters: ApprovedTruthListFilters;
  certify: CertifyTruthInput | null;
  update: BulkTruthUpdateInput | null;
  pageSize: number;
  rowIds: string[];
  createdAt: string;
};

export function normalizeApprovedTruthFilters(filters: TruthBulkFilterInput): ApprovedTruthListFilters {
  return {
    ...(filters.trustLevel ? { trustLevel: filters.trustLevel } : {}),
    ...(filters.datasetSplit ? { datasetSplit: filters.datasetSplit } : {}),
    ...(filters.rowStatus ? { rowStatus: filters.rowStatus } : {}),
    ...(filters.datasetVersion ? { datasetVersion: filters.datasetVersion } : {}),
    ...(filters.goldKind ? { goldKind: filters.goldKind } : {}),
    ...(filters.expectedStyle ? { expectedStyle: filters.expectedStyle } : {}),
    ...(filters.adversarialPair ? { adversarialPair: filters.adversarialPair } : {}),
    ...(filters.styleEvaluationSuite ? { styleEvaluationSuite: filters.styleEvaluationSuite } : {}),
    ...(filters.certificationView ? { certificationView: filters.certificationView } : {}),
  };
}

export async function loadApprovedTruthRowsForFilters(
  filters: ApprovedTruthListFilters,
): Promise<StoredApprovedTruth[]> {
  let rows = await listApprovedTruth({
    ...(filters.trustLevel ? { trustLevel: filters.trustLevel } : {}),
    ...(filters.datasetSplit ? { datasetSplit: filters.datasetSplit } : {}),
    ...(filters.rowStatus ? { rowStatus: filters.rowStatus } : {}),
    ...(filters.datasetVersion ? { datasetVersion: filters.datasetVersion } : {}),
    limit: TRUTH_SCAN_LIMIT,
  });

  if (filters.goldKind) {
    rows = rows.filter((row) => row.goldKind === filters.goldKind);
  }
  if (filters.expectedStyle) {
    rows = rows.filter((row) => row.expectedStyle === filters.expectedStyle);
  }
  if (filters.adversarialPair) {
    rows = rows.filter((row) => row.adversarialPair === filters.adversarialPair);
  }
  if (filters.styleEvaluationSuite) {
    rows = rows.filter((row) => row.styleEvaluationSuite === filters.styleEvaluationSuite);
  }
  if (filters.certificationView) {
    rows = rows.filter((row) => {
      const normalized = withLegacyCertification(row);
      const hasCertifiedTask = (normalized.taskCertifications ?? []).some(
        (certification) => certification.status === "certified",
      );
      return filters.certificationView === "certified" ? hasCertifiedTask : !hasCertifiedTask;
    });
  }

  return rows;
}

export function sliceApprovedTruthRowsForPageRange(
  rows: StoredApprovedTruth[],
  pageSize: number,
  pageRange: TruthBackgroundPageRangeInput | null | undefined,
): StoredApprovedTruth[] {
  if (!pageRange || rows.length === 0) {
    return rows;
  }

  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.ceil(rows.length / safePageSize);
  const startPage = Math.min(Math.max(pageRange.startPage, 1), totalPages);
  const endPage = Math.min(Math.max(pageRange.endPage, startPage), totalPages);
  const startIndex = (startPage - 1) * safePageSize;
  const endIndex = Math.min(rows.length, endPage * safePageSize);

  return rows.slice(startIndex, endIndex);
}

export function summarizeTruthBackgroundJob(job: TruthBackgroundJob) {
  return {
    jobId: job.id,
    operation: job.operation,
    status: job.status,
    filters: job.filters,
    pageSize: job.pageSize,
    totalRows: job.totalRows,
    totalPages: job.totalPages,
    completedRows: job.completedRows,
    completedPages: job.completedPages,
    updatedCount: job.updatedCount,
    unchangedCount: job.unchangedCount,
    deletedCount: job.deletedCount,
    certifiedCount: job.certifiedCount,
    quarantinedCount: job.quarantinedCount,
    skippedCount: job.skippedCount,
    failedCount: job.failedCount,
    results: job.status === "completed" || job.status === "failed" ? job.results : [],
    recentResults: job.recentResults,
    recentCompletedPage: job.recentCompletedPage,
    recentCompletedAt: job.recentCompletedAt,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  };
}

export function pruneTruthBackgroundJobs(): void {
  const completedJobs = [...truthBackgroundJobs.values()]
    .filter((job) => job.status === "completed" || job.status === "failed")
    .sort((left, right) => {
      const leftTime = left.finishedAt ?? left.createdAt;
      const rightTime = right.finishedAt ?? right.createdAt;
      return rightTime.localeCompare(leftTime);
    });

  for (const staleJob of completedJobs.slice(TRUTH_BACKGROUND_JOB_RETENTION_LIMIT)) {
    truthBackgroundJobs.delete(staleJob.id);
  }
}

export function truthBackgroundOperationConcurrency(operation: TruthBackgroundBulkOperation): number {
  if (operation === "crossref") {
    return TRUTH_BACKGROUND_CROSSREF_CONCURRENCY;
  }
  return 1;
}

export function applyTruthBackgroundJobCounts(
  job: TruthBackgroundJob,
  result: TruthBackgroundRowResult,
): void {
  if (job.operation === "prefill") {
    if (result.status === "updated") {
      job.updatedCount += 1;
      return;
    }
    if (result.status === "unchanged") {
      job.unchangedCount += 1;
      return;
    }
    if (result.status === "quarantined") {
      job.quarantinedCount += 1;
      return;
    }
    job.failedCount += 1;
    return;
  }

  if (job.operation === "crossref") {
    if (result.status === "updated") {
      job.updatedCount += 1;
      return;
    }
    if (result.status === "unchanged") {
      job.unchangedCount += 1;
      return;
    }
    if (result.status === "quarantined") {
      job.quarantinedCount += 1;
      return;
    }
    if (result.status === "skipped") {
      job.skippedCount += 1;
      return;
    }
    job.failedCount += 1;
    return;
  }

  if (job.operation === "delete") {
    if (result.status === "deleted") {
      job.deletedCount += 1;
      return;
    }
    job.failedCount += 1;
    return;
  }

  if (job.operation === "update") {
    if (result.status === "updated") {
      job.updatedCount += 1;
      return;
    }
    if (result.status === "unchanged") {
      job.unchangedCount += 1;
      return;
    }
    if (result.status === "quarantined") {
      job.quarantinedCount += 1;
      return;
    }
    job.failedCount += 1;
    return;
  }

  if (result.status === "certified") {
    job.certifiedCount += 1;
    return;
  }
  if (result.status === "quarantined") {
    job.quarantinedCount += 1;
    return;
  }
  job.failedCount += 1;
}

export async function mapTruthBackgroundPageResults<TInput, TResult>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) {
          return;
        }
        results[currentIndex] = await worker(items[currentIndex] as TInput, currentIndex);
      }
    }),
  );

  return results;
}

export function createTruthBackgroundJob(
  operation: TruthBackgroundBulkOperation,
  filters: ApprovedTruthListFilters,
  pageSize: number,
  rowIds: string[],
  certify: CertifyTruthInput | null,
  update: BulkTruthUpdateInput | null,
  overrides?: {
    id?: string;
    createdAt?: string;
  },
): TruthBackgroundJob {
  const createdAt = overrides?.createdAt ?? new Date().toISOString();

  return {
    id: overrides?.id ?? randomUUID(),
    operation,
    status: "pending",
    filters,
    certify,
    update,
    pageSize,
    totalRows: rowIds.length,
    totalPages: rowIds.length === 0 ? 0 : Math.ceil(rowIds.length / pageSize),
    completedRows: 0,
    completedPages: 0,
    updatedCount: 0,
    unchangedCount: 0,
    deletedCount: 0,
    certifiedCount: 0,
    quarantinedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    results: [],
    recentResults: [],
    recentCompletedPage: null,
    recentCompletedAt: null,
    rowIds,
    createdAt,
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

export function hydrateTruthBackgroundJobFromQueueData(
  jobId: string,
  data: TruthBackgroundQueueJobData,
): TruthBackgroundJob {
  return createTruthBackgroundJob(
    data.operation,
    data.filters,
    data.pageSize,
    data.rowIds,
    data.certify,
    data.update,
    {
      id: jobId,
      createdAt: data.createdAt,
    },
  );
}
