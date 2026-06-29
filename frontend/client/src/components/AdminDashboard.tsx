import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, Sparkles, TrendingUp } from "lucide-react";
import { AdminShell, AdminCard, AdminCardHeader } from "./AdminShell";
import type { SidebarStatGroup } from "./AdminShell";
import { AdminQueryFeedback } from "./AdminQueryFeedback";
import { SafeResponsiveChart } from "./SafeResponsiveChart";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import type { AnalyticsSummary } from "@/types/analytics";

const WINDOW_OPTIONS = [
  { days: 7, label: "7D" },
  { days: 14, label: "14D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
] as const;

function compact(value: number | null | undefined) {
  if (value == null) return "0";
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return value.toLocaleString();
}

function formatMs(value: number | null | undefined) {
  if (value == null) return "--";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

const STATUS_LABELS: Record<string, string> = {
  ready: "Ready",
  needs_action: "Needs action",
  needs_review: "Needs review",
  error: "Error",
  failed: "Failed",
  processing: "Processing",
  pending: "Pending",
};

const STATUS_COLORS: Record<string, string> = {
  ready: "bg-emerald-500",
  needs_action: "bg-amber-500",
  needs_review: "bg-sky-500",
  error: "bg-rose-500",
  failed: "bg-rose-500",
  processing: "bg-violet-500",
  pending: "bg-slate-400",
};

function prettyStatus(key: string) {
  return (
    STATUS_LABELS[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

type Phase4ModeResponse = {
  mode: "heuristic" | "primary" | "default";
  envMode: "heuristic" | "shadow" | "primary";
  effectiveMode: "heuristic" | "shadow" | "primary";
  options: Array<{ id: "1" | "2"; label: string; mode: "heuristic" | "primary" }>;
};

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number>(30);

  const {
    data: s,
    error: summaryError,
    isError: isSummaryError,
    isLoading,
    refetch: refetchSummary,
  } = useQuery<AnalyticsSummary>({
    queryKey: ["/internal/admin/analytics/summary", days],
    queryFn: async () =>
      adminFetch<AnalyticsSummary>(`/internal/admin/analytics/summary?days=${days}`),
    placeholderData: (previousData) => previousData,
  });

  const phase4ModeQuery = useQuery({
    queryKey: ["/internal/admin/phase4-mode"],
    queryFn: async () => adminFetch<Phase4ModeResponse>("/internal/admin/phase4-mode"),
    placeholderData: (previousData) => previousData,
  });
  const phase4ModeMutation = useMutation({
    mutationFn: async (mode: "heuristic" | "primary") =>
      adminFetch<Phase4ModeResponse>("/internal/admin/phase4-mode", {
        method: "PUT",
        body: JSON.stringify({ mode }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["/internal/admin/phase4-mode"], data);
    },
  });

  const pipeline = s?.pipeline;
  const quality = s?.quality;
  const users = s?.users;
  const reports = s?.reports;
  const providers = s?.providers;
  const ts = s?.timeSeries;

  const jobSeries = useMemo(
    () => ts?.jobs?.map((d) => ({ label: d.date.slice(5), count: d.count })) ?? [],
    [ts?.jobs],
  );
  const peakJobs = useMemo(
    () => jobSeries.reduce((max, d) => Math.max(max, d.count), 0),
    [jobSeries],
  );

  const citationsByStatus = pipeline?.citationsByStatus ?? {};
  const totalCitations = pipeline?.totalCitations ?? 0;
  const readyCount = citationsByStatus.ready ?? 0;
  const needsActionCount =
    quality?.needsActionCount ?? citationsByStatus.needs_action ?? 0;
  const readyShare = totalCitations > 0 ? (readyCount / totalCitations) * 100 : 0;
  const actionShare =
    totalCitations > 0 ? (needsActionCount / totalCitations) * 100 : 0;

  const statusRows = useMemo(() => {
    const entries = Object.entries(citationsByStatus).filter(([, n]) => n > 0);
    const max = entries.reduce((m, [, n]) => Math.max(m, n), 0) || 1;
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({
        key,
        label: prettyStatus(key),
        count,
        pct: (count / max) * 100,
        color: STATUS_COLORS[key] ?? "bg-slate-400",
      }));
  }, [citationsByStatus]);

  const needsReview = quality?.needsReviewCount ?? 0;

  const sidebarStats: SidebarStatGroup[] = [
    {
      label: "Pipeline",
      items: [
        { label: "Jobs", value: compact(pipeline?.totalJobs), tone: "info" },
        { label: "Citations", value: compact(totalCitations), tone: "positive" },
        {
          label: "Queue depth",
          value: compact(pipeline?.queueDepth),
          tone: pipeline?.queueDepth ? "warning" : "neutral",
        },
      ],
    },
    {
      label: "Providers",
      items: [
        { label: "CrossRef", value: compact(providers?.crossref.calls) },
        { label: "OpenAlex", value: compact(providers?.openalex.calls) },
        {
          label: "OpenAI tok",
          value: compact(
            (providers?.openai.promptTokens ?? 0) +
              (providers?.openai.completionTokens ?? 0),
          ),
        },
      ],
    },
    {
      label: "Users",
      items: [
        { label: "Active", value: compact(users?.activeInWindow), tone: "positive" },
        { label: "New", value: compact(users?.newInWindow), tone: "info" },
        { label: "Reports", value: compact(reports?.pending), tone: reports?.pending ? "warning" : "neutral" },
      ],
    },
  ];

  const kpis = [
    {
      label: "Avg refs / job",
      value: pipeline?.avgRefsPerJob?.toFixed(1) ?? "0",
    },
    {
      label: "High confidence",
      value: quality != null ? `${(quality.highConfidenceRate * 100).toFixed(1)}%` : "0%",
    },
    {
      label: "Avg job time",
      value: formatMs(pipeline?.avgJobDurationMs),
    },
    {
      label: "Report resolution",
      value: reports != null ? `${reports.resolutionRatePercent.toFixed(0)}%` : "0%",
    },
  ];

  const windowToggle = (
    <div className="inline-flex rounded-xl border border-slate-200/80 bg-white p-0.5 dark:border-slate-800/60 dark:bg-[#121826]">
      {WINDOW_OPTIONS.map((opt) => (
        <button
          key={opt.days}
          type="button"
          onClick={() => setDays(opt.days)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
            days === opt.days
              ? "bg-[#002147] text-white dark:bg-[#0f4fa8]"
              : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <AdminShell
      title="Dashboard"
      subtitle={
        s?.window
          ? `Last ${days} days · ${s.window.from?.slice(0, 10)} → ${s.window.to?.slice(0, 10)}`
          : `Last ${days} days`
      }
      headerActions={windowToggle}
      sidebarStats={sidebarStats}
      fitViewport
    >
      {isLoading && !s ? (
        <div className="py-24 text-center text-slate-400 dark:text-slate-500">
          Synchronising dashboard…
        </div>
      ) : isSummaryError && !s ? (
        <AdminQueryFeedback
          title="Executive dashboard"
          error={summaryError}
          onRetry={() => void refetchSummary()}
        />
      ) : (
        <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
          {isSummaryError && s ? (
            <AdminQueryFeedback
              title="Executive dashboard"
              error={summaryError}
              onRetry={() => void refetchSummary()}
              retryLabel="Refresh"
              variant="warning"
            />
          ) : null}

          {/* KPI strip */}
          <section className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
            {kpis.map((k) => (
              <AdminCard key={k.label} className="p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {k.label}
                </p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {k.value}
                </p>
              </AdminCard>
            ))}
          </section>

          {/* Feature row: throughput + citation health */}
          <section className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-3">
            {/* Pipeline throughput */}
            <AdminCard className="relative flex flex-col lg:col-span-2">
              <AdminCardHeader
                title="Pipeline throughput"
                action={{ label: "Health", href: "/admin/health" }}
              />
              <div className="mb-3 flex items-end gap-3">
                <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {compact(pipeline?.totalJobs)}
                </span>
                <span className="mb-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                  jobs processed
                </span>
              </div>

              {peakJobs > 0 ? (
                <div className="pointer-events-none absolute right-6 top-20 z-10 flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-bold text-white">
                  <TrendingUp className="h-3.5 w-3.5" />
                  peak {compact(peakJobs)}
                </div>
              ) : null}

              <SafeResponsiveChart className="min-h-[10rem] flex-1" minHeight={140}>
                <AreaChart data={jobSeries} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="jobsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.16)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    width={40}
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid rgba(148,163,184,0.2)",
                      background: "#0c111b",
                      color: "#e2e8f0",
                      fontSize: 12,
                    }}
                    cursor={{ stroke: "rgba(148,163,184,0.3)" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Jobs"
                    stroke="#22c55e"
                    strokeWidth={2.5}
                    fill="url(#jobsFill)"
                  />
                </AreaChart>
              </SafeResponsiveChart>
            </AdminCard>

            {/* Citation health (assets/debts analogue) */}
            <AdminCard>
              <AdminCardHeader
                title="Citation health"
                action={{ label: "Review", href: "/admin/review" }}
              />
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Ready
                    </span>
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {compact(readyCount)}
                  </p>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Needs action
                    </span>
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {compact(needsActionCount)}
                  </p>
                </div>
              </div>

              {/* Proportion bar */}
              <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${readyShare}%` }}
                />
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${actionShare}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] font-medium text-slate-400 dark:text-slate-500">
                <span>{readyShare.toFixed(0)}% ready</span>
                <span>{compact(totalCitations)} total</span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 dark:border-slate-800/60">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Correction rate
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                    {quality != null ? `${(quality.correctionRate * 100).toFixed(1)}%` : "0%"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Needs review
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                    {compact(needsReview)}
                  </p>
                </div>
              </div>
            </AdminCard>
          </section>

          {/* Second row: review queue + statuses + engine controls */}
          <section className="grid shrink-0 grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Needs review (transactions-to-review analogue) */}
            <AdminCard className="flex flex-col">
              <AdminCardHeader
                title="Queue to review"
                action={{ label: "View all", href: "/admin/review" }}
              />
              {needsReview > 0 ? (
                <Link
                  href="/admin/review"
                  className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl py-8 text-center transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
                    <Sparkles className="h-6 w-6" />
                  </span>
                  <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {compact(needsReview)}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    citations waiting for review
                  </span>
                </Link>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                    <CheckCircle2 className="h-6 w-6" />
                  </span>
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    You're all caught up
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    No citations need review
                  </span>
                </div>
              )}
            </AdminCard>

            {/* Citations by status (top-categories analogue) */}
            <AdminCard>
              <AdminCardHeader
                title="Citations by status"
                action={{ label: "Data", href: "/admin/data" }}
              />
              {statusRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  No citations in this window
                </p>
              ) : (
                <div className="space-y-4">
                  {statusRows.map((row) => (
                    <div key={row.key}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", row.color)} />
                          <span className="font-medium text-slate-600 dark:text-slate-300">
                            {row.label}
                          </span>
                        </div>
                        <span className="font-semibold tabular-nums text-slate-900 dark:text-white">
                          {compact(row.count)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className={cn("h-full rounded-full", row.color)}
                          style={{ width: `${row.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </AdminCard>

            {/* Engine controls (next-two-weeks analogue) */}
            <AdminCard>
              <AdminCardHeader
                title="Engine — Phase 4 mode"
                action={{ label: "Settings", href: "/admin/settings" }}
              />
              <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                Switch extraction between heuristics and the ML model.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["heuristic", "primary"] as const).map((mode) => {
                  const active = phase4ModeQuery.data?.effectiveMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => phase4ModeMutation.mutate(mode)}
                      disabled={phase4ModeMutation.isPending}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        active
                          ? "border-[#002147] bg-[#002147] text-white dark:border-[#0f4fa8] dark:bg-[#0f4fa8]"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-200 dark:hover:border-slate-600",
                      )}
                    >
                      {mode === "heuristic" ? "Heuristics" : "ML model"}
                    </button>
                  );
                })}
              </div>
              <dl className="mt-4 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-400 dark:text-slate-500">Effective</dt>
                  <dd className="font-bold text-slate-700 dark:text-slate-200">
                    {phase4ModeQuery.data?.effectiveMode ?? "loading"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400 dark:text-slate-500">Startup env</dt>
                  <dd className="font-bold text-slate-700 dark:text-slate-200">
                    {phase4ModeQuery.data?.envMode ?? "unknown"}
                  </dd>
                </div>
                {phase4ModeMutation.error ? (
                  <p className="text-rose-500">{phase4ModeMutation.error.message}</p>
                ) : null}
              </dl>
            </AdminCard>
          </section>
        </div>
      )}
    </AdminShell>
  );
}
