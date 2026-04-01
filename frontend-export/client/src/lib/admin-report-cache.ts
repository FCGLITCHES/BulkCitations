import type { QueryClient } from "@tanstack/react-query";
import type { CitationReport } from "@shared/schema";

export interface GroupedReport {
  fingerprint: string;
  reports: CitationReport[];
  totalCount: number;
  category: string;
}

const GROUPED_REPORTS_QUERY_KEY = "/api/reports/grouped";

function reportFingerprint(report: CitationReport): string {
  return report.fingerprint || report.id;
}

function reportMatchesStatus(report: CitationReport, statusFilter?: string): boolean {
  return !statusFilter || report.status === statusFilter;
}

function reportRecencyValue(report: CitationReport): number {
  return new Date(report.createdAt).getTime() || 0;
}

function sortReportsByRecency(reports: CitationReport[]): CitationReport[] {
  return [...reports].sort((left, right) => {
    const timeDifference = reportRecencyValue(right) - reportRecencyValue(left);
    if (timeDifference !== 0) {
      return timeDifference;
    }
    return right.id.localeCompare(left.id);
  });
}

function summarizeGroup(group: GroupedReport): GroupedReport {
  const reports = sortReportsByRecency(group.reports);
  return {
    fingerprint: group.fingerprint,
    reports,
    totalCount: reports.reduce((sum, report) => sum + (report.reportCount ?? 1), 0),
    category: reports[0]?.failureCategory ?? group.category ?? "other",
  };
}

function sortGroups(groups: GroupedReport[]): GroupedReport[] {
  return [...groups]
    .map(summarizeGroup)
    .sort((left, right) => {
      if (right.totalCount !== left.totalCount) {
        return right.totalCount - left.totalCount;
      }
      return reportRecencyValue(right.reports[0]) - reportRecencyValue(left.reports[0]);
    });
}

function removeReportFromGroups(groups: GroupedReport[], reportId: string): GroupedReport[] {
  return sortGroups(
    groups
      .map((group) => ({
        ...group,
        reports: group.reports.filter((report) => report.id !== reportId),
      }))
      .filter((group) => group.reports.length > 0),
  );
}

function upsertReportIntoGroups(groups: GroupedReport[], report: CitationReport): GroupedReport[] {
  const withoutPreviousEntry = removeReportFromGroups(groups, report.id);
  const fingerprint = reportFingerprint(report);
  const existingIndex = withoutPreviousEntry.findIndex((group) => group.fingerprint === fingerprint);

  if (existingIndex === -1) {
    return sortGroups([
      {
        fingerprint,
        reports: [report],
        totalCount: report.reportCount ?? 1,
        category: report.failureCategory,
      },
      ...withoutPreviousEntry,
    ]);
  }

  const nextGroups = [...withoutPreviousEntry];
  const existingGroup = nextGroups[existingIndex];
  nextGroups[existingIndex] = {
    ...existingGroup,
    reports: [report, ...existingGroup.reports],
  };
  return sortGroups(nextGroups);
}

function statusFromGroupedQueryKey(queryKey: readonly unknown[]): string | undefined {
  if (!Array.isArray(queryKey) || queryKey[0] !== GROUPED_REPORTS_QUERY_KEY) {
    return undefined;
  }
  return typeof queryKey[1] === "string" ? queryKey[1] : undefined;
}

export function updateGroupedReportCaches(
  queryClient: QueryClient,
  nextReport: CitationReport,
  previousReport?: CitationReport | null,
): void {
  const groupedQueries = queryClient.getQueriesData<GroupedReport[]>({
    queryKey: [GROUPED_REPORTS_QUERY_KEY],
  });

  for (const [queryKey, currentGroups] of groupedQueries) {
    const statusFilter = statusFromGroupedQueryKey(queryKey);
    let nextGroups = currentGroups ?? [];

    if (previousReport && reportMatchesStatus(previousReport, statusFilter)) {
      nextGroups = removeReportFromGroups(nextGroups, previousReport.id);
    }

    if (reportMatchesStatus(nextReport, statusFilter)) {
      nextGroups = upsertReportIntoGroups(nextGroups, nextReport);
    }

    queryClient.setQueryData(queryKey, nextGroups);
  }
}

export function removeReportsFromGroupedCaches(
  queryClient: QueryClient,
  reportIds: string[],
): void {
  if (reportIds.length === 0) return;

  const groupedQueries = queryClient.getQueriesData<GroupedReport[]>({
    queryKey: [GROUPED_REPORTS_QUERY_KEY],
  });

  for (const [queryKey, currentGroups] of groupedQueries) {
    let nextGroups = currentGroups ?? [];
    for (const reportId of reportIds) {
      nextGroups = removeReportFromGroups(nextGroups, reportId);
    }
    queryClient.setQueryData(queryKey, nextGroups);
  }
}
