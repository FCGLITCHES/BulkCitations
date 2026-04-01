import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import type { CitationReport, ReportStatus } from "@shared/schema";
import { adminFetch } from "@/lib/admin-api";
import { removeReportsFromGroupedCaches, type GroupedReport } from "@/lib/admin-report-cache";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SortKey = "freq" | "category" | "source" | "targetStyle";
type SortDirection = "asc" | "desc";

function getReportCategories(report: CitationReport, fallbackCategory: string): string[] {
  const values = report.failureCategories?.length
    ? report.failureCategories
    : report.failureCategory
      ? [report.failureCategory]
      : [fallbackCategory];

  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export default function AdminReportQueue() {
  const [statusFilter, setStatusFilter] = useState<ReportStatus>("pending");
  const [sortKey, setSortKey] = useState<SortKey>("freq");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedFingerprints, setSelectedFingerprints] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: groups, isLoading } = useQuery<GroupedReport[]>({
    queryKey: ["/api/reports/grouped", statusFilter],
    queryFn: async () => {
      return adminFetch<GroupedReport[]>(`/api/reports/grouped?status=${statusFilter}`);
    },
  });

  const stats = groups?.reduce((acc, g) => {
    acc.total += g.totalCount;
    acc.groups += 1;
    return acc;
  }, { total: 0, groups: 0 }) || { total: 0, groups: 0 };

  const sortedGroups = [...(groups ?? [])].sort((left, right) => {
    const leftLatest = left.reports[0];
    const rightLatest = right.reports[0];

    if (!leftLatest || !rightLatest) return 0;

    let comparison = 0;
    if (sortKey === "freq") {
      comparison = left.totalCount - right.totalCount;
    } else if (sortKey === "category") {
      comparison = left.category.localeCompare(right.category);
    } else if (sortKey === "source") {
      comparison = leftLatest.source.localeCompare(rightLatest.source);
    } else if (sortKey === "targetStyle") {
      comparison = leftLatest.outputStyle.localeCompare(rightLatest.outputStyle);
    }

    if (comparison === 0) {
      comparison = right.totalCount - left.totalCount;
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  const selectedReportIds = sortedGroups
    .filter((group) => selectedFingerprints.has(group.fingerprint))
    .flatMap((group) => group.reports.map((report) => report.id));

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      return adminFetch<{ success: true; deletedCount: number }>("/api/reports", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
    },
    onSuccess: (data, ids) => {
      setSelectedFingerprints(new Set());
      removeReportsFromGroupedCaches(queryClient, ids);
      toast({
        title: "Reports resolved",
        description: `Successfully resolved ${data.deletedCount} incident${data.deletedCount === 1 ? "" : "s"}.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Resolution failed",
        description: error instanceof Error ? error.message : "Failed to resolve selected reports.",
        variant: "destructive",
      });
    },
  });

  function handleResolve(ids: string[]) {
    if (ids.length === 0 || deleteMutation.isPending) return;
    deleteMutation.mutate(ids);
  }

  function toggleFingerprint(fingerprint: string) {
    setSelectedFingerprints((current) => {
      const next = new Set(current);
      if (next.has(fingerprint)) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#11161d] dark:text-slate-100">
      <AdminHeader />

      <main className="pt-24 max-w-screen-2xl mx-auto px-8 pb-24">
        {/* Header Section */}
        <section className="mb-12 flex flex-col md:flex-row justify-between items-end gap-6">
          <div>
            <h1 className="font-headline text-4xl font-bold text-primary-container mb-2 tracking-tight">Failure Queue</h1>
            <p className="text-on-surface-variant max-w-2xl leading-relaxed">
              Review and resolve citation parsing failures reported by the system and scholarly community. 
              Use these logs to calibrate ingestion algorithms and improve archival accuracy.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-outline-variant/30 p-1 bg-surface-container-low">
              {["pending", "proposed", "accepted", "rejected"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status as ReportStatus)}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all",
                    statusFilter === status 
                      ? "bg-primary-container text-white shadow-sm" 
                      : "text-on-surface-variant hover:bg-surface-container"
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Key Metrics Bento */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900">
            <div className="flex items-center gap-3 mb-4 text-slate-500 dark:text-slate-400">
              <span className="material-symbols-outlined text-lg">error</span>
              <span className="text-xs font-bold tracking-widest uppercase font-label">Total Failures</span>
            </div>
            <div className="font-headline text-4xl font-bold text-[#0f4fa8] dark:text-blue-300">
              {isLoading ? "..." : stats.total.toLocaleString()}
            </div>
            <div className="mt-2 text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">trending_down</span>
              <span>Overall trend stabilizing</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900">
            <div className="flex items-center gap-3 mb-4 text-slate-500 dark:text-slate-400">
              <span className="material-symbols-outlined text-lg">category</span>
              <span className="text-xs font-bold tracking-widest uppercase font-label">Unique Issues</span>
            </div>
            <div className="font-headline text-4xl font-bold text-[#0f4fa8] dark:text-blue-300">
              {isLoading ? "..." : stats.groups}
            </div>
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Categorized across {stats.groups > 0 ? Math.ceil(stats.groups / 5) : 0} workflows
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900">
            <div className="flex items-center gap-3 mb-4 text-slate-500 dark:text-slate-400">
              <span className="material-symbols-outlined text-lg">speed</span>
              <span className="text-xs font-bold tracking-widest uppercase font-label">Avg. Frequency</span>
            </div>
            <div className="font-headline text-4xl font-bold text-[#0f4fa8] dark:text-blue-300">
              {isLoading ? "..." : (stats.groups > 0 ? (stats.total / stats.groups).toFixed(1) : "0.0")}
            </div>
            <div className="mt-2 text-sm text-orange-600 dark:text-orange-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">priority_high</span>
              <span>Manual review recommended</span>
            </div>
          </div>
        </div>

        {/* Data Table Section */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest font-label cursor-pointer hover:text-[#0f4fa8] dark:hover:text-blue-300 transition-colors" onClick={() => {
                    setSortKey("freq");
                    setSortDirection(prev => prev === "desc" ? "asc" : "desc");
                  }}>
                    <div className="flex items-center gap-1">
                      Freq
                      {sortKey === "freq" && <span className="material-symbols-outlined text-sm">{sortDirection === "desc" ? "arrow_downward" : "arrow_upward"}</span>}
                    </div>
                  </th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest font-label">Category</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest font-label">Source</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest font-label">Original Citation</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest font-label">Target Style</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest font-label">Stage</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest font-label">Status</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest font-label text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-on-surface-variant italic">
                      Acquiring failure logs...
                    </td>
                  </tr>
                ) : sortedGroups.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-on-surface-variant italic">
                      No matching failures found for this filter.
                    </td>
                  </tr>
                ) : (
                  sortedGroups.map((group) => {
                    const latest = group.reports[0];
                    const categories = getReportCategories(latest, group.category);
                    const blame = latest.likelyStageBlame;

                    return (
                      <tr key={group.fingerprint} className={cn(
                        "hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group",
                        selectedFingerprints.has(group.fingerprint) && "bg-blue-50 dark:bg-blue-900/30"
                      )}>
                        <td className="px-6 py-5 font-bold text-[#0f4fa8] dark:text-blue-300">
                          {group.totalCount}
                        </td>
                        <td className="px-6 py-5">
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="inline-flex items-center cursor-help">
                                  <span className="bg-surface-container text-on-surface-variant px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight">
                                    {categories.length > 1 ? `${categories.length} Issues` : categories[0].replace("-", " ")}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="bg-primary-container text-white border-none p-3 shadow-xl">
                                <p className="text-[10px] font-bold uppercase tracking-widest mb-2 opacity-70">Identified Failures</p>
                                <ul className="space-y-1">
                                  {categories.map((c, i) => (
                                    <li key={i} className="text-xs font-medium flex items-center gap-2">
                                      <span className="h-1 w-1 rounded-full bg-secondary-fixed" />
                                      {c.replace("-", " ")}
                                    </li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        <td className="px-6 py-5">
                          {latest.source === "user" || latest.source === "user-edit" ? (
                            <span className="material-symbols-outlined text-on-surface-variant opacity-60" title={latest.source}>person</span>
                          ) : (
                            <span className="material-symbols-outlined text-on-surface-variant opacity-60" title="Automated System">smart_toy</span>
                          )}
                        </td>
                        <td className="px-6 py-5 max-w-xs">
                          <p className="text-sm truncate text-on-surface font-medium" title={latest.originalText}>
                            {latest.originalText}
                          </p>
                        </td>
                        <td className="px-6 py-5">
                          <span className="text-[10px] font-bold font-mono text-on-surface-variant uppercase bg-surface-container/50 px-1.5 py-0.5 rounded">
                            {latest.outputStyle}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-on-surface capitalize">
                              {blame?.likelyStage ?? "unassigned"}
                            </span>
                            {blame && (
                              <span className="text-[10px] text-on-surface-variant/70 font-bold">
                                {Math.round(blame.confidence * 100)}% Confidence
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-tight whitespace-nowrap",
                            latest.status === "pending" && "bg-error-container text-on-error-container",
                            latest.status === "proposed" && "bg-tertiary-fixed text-on-tertiary-fixed",
                            latest.status === "accepted" && "bg-secondary-container text-on-secondary-container",
                            latest.status === "rejected" && "bg-surface-container-high text-on-surface-variant"
                          )}>
                            {latest.status.replace("-", " ")}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Link href={`/admin/reports/${latest.id}`}>
                              <button className="text-[10px] font-bold uppercase tracking-widest text-primary-container hover:underline">View Details</button>
                            </Link>
                            <button 
                              onClick={() => handleResolve([latest.id])}
                              disabled={deleteMutation.isPending}
                              className={cn(
                                "bg-signature-cta text-white px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest hover:shadow-lg transition-all",
                                deleteMutation.isPending && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              Resolve
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          
          <div className="px-6 py-6 border-t border-outline-variant/10 flex items-center justify-between text-xs font-bold text-on-surface-variant uppercase tracking-widest">
            <span>Showing {sortedGroups.length} of {stats.groups} unique issues</span>
            <div className="flex gap-4">
              <button className="flex items-center gap-1 hover:text-primary-container transition-colors disabled:opacity-30" disabled>
                <span className="material-symbols-outlined text-sm">chevron_left</span> Previous
              </button>
              <button className="flex items-center gap-1 hover:text-primary-container transition-colors disabled:opacity-30" disabled>
                Next <span className="material-symbols-outlined text-sm">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* FAB Action - Positioned above ScrollToTop on the right */}
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button 
              onClick={() => setSelectedFingerprints(new Set(sortedGroups.map(g => g.fingerprint)))}
              className="fixed bottom-24 right-6 h-14 w-14 rounded-full bg-signature-cta text-white shadow-2xl flex items-center justify-center hover:scale-110 transition-transform z-50 group"
            >
              <span className="material-symbols-outlined transition-transform duration-300 group-hover:rotate-12" style={{ fontVariationSettings: "'FILL' 1" }}>
                library_add_check
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="bg-primary-container text-white font-bold uppercase tracking-widest text-[10px] border-none">
            Select All Visible
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Bulk Action Bar */}
      {selectedReportIds.length > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-primary-container text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-6 z-50 border border-on-primary/10 animate-in fade-in slide-in-from-bottom-4">
          <span className="text-xs font-bold uppercase tracking-widest">
            {selectedReportIds.length} incidents selected
          </span>
          <div className="h-4 w-px bg-on-primary/20" />
          <div className="flex gap-4">
            <button 
              onClick={() => setSelectedFingerprints(new Set())}
              className="text-[10px] font-bold uppercase tracking-widest hover:text-secondary-fixed transition-colors"
            >
              Deselect
            </button>
            <button 
              onClick={() => handleResolve(selectedReportIds)}
              disabled={deleteMutation.isPending}
              className="bg-error text-white px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-error/80 transition-all flex items-center gap-2"
            >
              {deleteMutation.isPending ? "Resolving..." : (
                <>
                  <span className="material-symbols-outlined text-sm">delete_sweep</span>
                  Bulk Resolve
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <AdminFooter />
    </div>
  );
}
