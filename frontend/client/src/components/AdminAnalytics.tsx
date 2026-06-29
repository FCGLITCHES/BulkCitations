import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReviewQueueResponse } from "@shared/admin-review";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { AdminQueryFeedback } from "./AdminQueryFeedback";
import { CitationStatusPieChart } from "./CitationStatusPieChart";
import { SafeResponsiveChart } from "./SafeResponsiveChart";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import type { AnalyticsSummary } from "@/types/analytics";
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const cardClassName =
  "rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900";

function formatMs(value: number | null) {
  if (value == null) return "--";
  return `${Math.round(value)}ms`;
}

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  return `${Math.floor(diffInHours / 24)}d ago`;
}

export default function AdminAnalytics() {
  const [windowDays, setWindowDays] = useState(90);
  const {
    data: s,
    error: summaryError,
    isError: isSummaryError,
    isLoading,
    refetch: refetchSummary,
  } = useQuery<AnalyticsSummary>({
    queryKey: ["/internal/admin/analytics/summary", windowDays],
    queryFn: async () =>
      adminFetch<AnalyticsSummary>(`/internal/admin/analytics/summary?days=${windowDays}`),
    placeholderData: (previousData) => previousData,
  });

  const {
    data: recentQueue,
    error: recentQueueError,
    isError: isRecentQueueError,
    refetch: refetchRecentQueue,
  } = useQuery<ReviewQueueResponse>({
    queryKey: ["/internal/admin/review-queue", "analytics-alerts"],
    queryFn: async () =>
      adminFetch<ReviewQueueResponse>(
        "/internal/admin/review-queue?limit=5&offset=0&statusFilter=any_flagged&sourceFilter=all&sortBy=latestActionableAt&sortDirection=desc",
      ),
    placeholderData: (previousData) => previousData,
  });

  const recentAlerts = recentQueue?.batches ?? [];

  const pipeline = s?.pipeline;
  const quality = s?.quality;
  const providers = s?.providers;
  const egress = s?.egress;
  const ts = s?.timeSeries;

  const providerRows = s
    ? [
        {
          name: "CrossRef",
          calls: providers!.crossref.calls,
          cacheHit: `${(providers!.crossref.cacheHitRate * 100).toFixed(1)}%`,
          detail: `${(providers!.crossref.avgResponseBytes / 1024).toFixed(1)} KB avg`,
        },
        {
          name: "OpenAlex",
          calls: providers!.openalex.calls,
          cacheHit: `${(providers!.openalex.cacheHitRate * 100).toFixed(1)}%`,
          detail: `${(providers!.openalex.avgResponseBytes / 1024).toFixed(1)} KB avg`,
        },
        {
          name: "OpenAI",
          calls: providers!.openai.calls,
          cacheHit: "—",
          detail: `${(
            providers!.openai.promptTokens + providers!.openai.completionTokens
          ).toLocaleString()} tokens`,
        },
        {
          name: "ML",
          calls: providers!.ml.calls,
          cacheHit: "—",
          detail: `batch avg ${providers!.ml.avgBatchSize.toFixed(1)}`,
        },
      ]
    : [];

  return (
    <div className="min-h-[100dvh] bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#11161d] dark:text-slate-100">
      <AdminHeader />

      <main className="pt-24 pb-12 px-8 max-w-[1600px] mx-auto space-y-8">
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <h1 className="font-headline text-4xl font-extrabold tracking-tight text-[#0f4fa8] dark:text-blue-300">
              Analytics Overview
            </h1>
            <p className="max-w-2xl text-slate-600 dark:text-slate-300">
              Operational metrics from jobs, egress, and provider rollups.
            </p>
          </div>
          <div className="flex items-center rounded-lg border border-slate-200/80 bg-white/90 p-1 dark:border-slate-700/80 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setWindowDays(30)}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-medium transition-all",
                windowDays === 30
                  ? "bg-slate-900 font-bold text-white shadow-sm dark:bg-blue-500 dark:text-slate-950"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white",
              )}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => setWindowDays(90)}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-medium transition-all",
                windowDays === 90
                  ? "bg-slate-900 font-bold text-white shadow-sm dark:bg-blue-500 dark:text-slate-950"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white",
              )}
            >
              Last 90 Days
            </button>
          </div>
        </section>

        {isLoading && !s ? (
          <div className="py-24 text-center font-headline text-2xl italic text-slate-500 dark:text-slate-400">
            Synchronising archival metrics...
          </div>
        ) : isSummaryError && !s ? (
          <AdminQueryFeedback
            title="Analytics overview"
            error={summaryError}
            onRetry={() => void refetchSummary()}
          />
        ) : (
          <>
            {isSummaryError && s ? (
              <AdminQueryFeedback
                title="Analytics overview"
                error={summaryError}
                onRetry={() => void refetchSummary()}
                retryLabel="Refresh analytics"
                variant="warning"
              />
            ) : null}

            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className={cn(cardClassName, "border-l-4 border-l-[#0f4fa8] p-6")}>
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Jobs (window)
                </span>
                <div className="mt-2 text-3xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  {(pipeline?.totalJobs ?? 0).toLocaleString()}
                </div>
              </div>
              <div className={cn(cardClassName, "p-6")}>
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Citations
                </span>
                <div className="mt-2 text-3xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  {(pipeline?.totalCitations ?? 0).toLocaleString()}
                </div>
              </div>
              <div className={cn(cardClassName, "p-6")}>
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Avg job duration
                </span>
                <div className="mt-2 text-3xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  {formatMs(pipeline?.avgJobDurationMs ?? null)}
                </div>
              </div>
              <div className={cn(cardClassName, "p-6")}>
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  High confidence
                </span>
                <div className="mt-2 text-3xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  {quality != null ? `${(quality.highConfidenceRate * 100).toFixed(1)}%` : "—"}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className={cn(cardClassName, "p-8")}>
                <h3 className="mb-6 font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  Provider calls
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[10px] font-black uppercase text-slate-500 dark:border-slate-700">
                        <th className="py-2">Provider</th>
                        <th className="py-2">Calls</th>
                        <th className="py-2">Cache hit</th>
                        <th className="py-2">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providerRows.map((row) => (
                        <tr
                          key={row.name}
                          className="border-b border-slate-100 dark:border-slate-800"
                        >
                          <td className="py-3 font-bold text-slate-800 dark:text-slate-100">
                            {row.name}
                          </td>
                          <td className="py-3">{row.calls.toLocaleString()}</td>
                          <td className="py-3">{row.cacheHit}</td>
                          <td className="py-3 text-slate-600 dark:text-slate-400">{row.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={cn(cardClassName, "p-8")}>
                <h3 className="mb-6 font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  Egress (bytes / day)
                </h3>
                <SafeResponsiveChart className="h-64 min-h-[16rem]" minHeight={200}>
                    <LineChart
                      data={egress?.dailyBuckets ?? []}
                      margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid stroke="rgba(148,163,184,0.24)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis width={48} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="bytes"
                        name="Bytes"
                        stroke="#da7101"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                </SafeResponsiveChart>
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className={cn(cardClassName, "p-8")}>
                <h3 className="mb-6 font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  Citations by status
                </h3>
                <CitationStatusPieChart
                  citationsByStatus={pipeline?.citationsByStatus}
                  className="h-64 w-full min-h-[260px]"
                  innerRadius={50}
                  outerRadius={90}
                  cy="42%"
                />
              </div>
              <div className={cn(cardClassName, "p-8")}>
                <h3 className="mb-6 font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  Errors (jobs + failed refs, daily)
                </h3>
                <SafeResponsiveChart className="h-64 min-h-[16rem]" minHeight={200}>
                    <LineChart data={ts?.errors ?? []}>
                      <CartesianGrid stroke="rgba(148,163,184,0.24)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis width={36} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke="#a12c7b"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                </SafeResponsiveChart>
              </div>
            </section>

            <section className={cn(cardClassName, "flex flex-col")}>
              <div className="border-b border-slate-200 p-6 dark:border-slate-700">
                <h3 className="font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">
                  Recent Archival Alerts
                </h3>
              </div>
              <div className="p-6 space-y-6 flex-1 overflow-y-auto max-h-[400px]">
                {recentAlerts.map((report, i) => (
                  <div key={report.jobId} className="flex gap-4 group">
                    <div
                      className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        i % 2 === 0
                          ? "bg-blue-300 ring-4 ring-blue-200/70 dark:bg-blue-400 dark:ring-blue-500/20"
                          : "bg-emerald-500",
                      )}
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-[#0f4fa8] dark:text-blue-200">
                        {report.healthLabel}
                      </p>
                      <p className="max-w-[200px] truncate text-xs text-slate-600 dark:text-slate-300">
                        {report.ownerLabel} • {report.flaggedCitationCount} flagged citation{report.flaggedCitationCount === 1 ? "" : "s"}
                      </p>
                      <span className="text-[10px] font-bold uppercase tracking-tight text-slate-400 dark:text-slate-500">
                        {timeAgo(report.latestActionableAt ?? report.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
                {isRecentQueueError ? (
                  <AdminQueryFeedback
                    title="Recent archival alerts"
                    error={recentQueueError}
                    onRetry={() => void refetchRecentQueue()}
                    retryLabel="Retry alerts"
                    variant="warning"
                    className="border-dashed"
                  />
                ) : null}
                {recentAlerts.length === 0 && !isRecentQueueError && (
                  <div className="py-12 text-center text-sm italic text-slate-500 dark:text-slate-400">
                    No critical archival alerts at this time.
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <AdminFooter />
    </div>
  );
}
