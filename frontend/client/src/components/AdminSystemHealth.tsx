import { useQuery } from "@tanstack/react-query";
import { AdminShell, AdminCard, AdminCardHeader } from "./AdminShell";
import { AdminCslStatus } from "./AdminCslStatus";
import { CitationStatusPieChart } from "./CitationStatusPieChart";
import { SafeResponsiveChart } from "./SafeResponsiveChart";
import { adminFetch } from "@/lib/admin-api";
import type { AnalyticsSummary } from "@/types/analytics";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const DAYS = 30;

function formatMs(value: number | null | undefined) {
  if (value == null) return "--";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

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

const chartTooltipStyle = {
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.2)",
  background: "#0c111b",
  color: "#e2e8f0",
  fontSize: 12,
} as const;

export default function AdminSystemHealth() {
  const { data: s, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ["/internal/admin/analytics/summary", DAYS],
    queryFn: async () =>
      adminFetch<AnalyticsSummary>(`/internal/admin/analytics/summary?days=${DAYS}`),
    placeholderData: (previousData) => previousData,
  });

  const pipeline = s?.pipeline;
  const ts = s?.timeSeries;
  const providers = s?.providers;
  const quality = s?.quality;

  const jobBar = Object.entries(pipeline?.jobsByStatus ?? {}).map(([status, count]) => ({
    status,
    count,
  }));
  const errorSeries =
    ts?.errors?.map((d) => ({ label: d.date.slice(5), count: d.count })) ?? [];

  const kpis = [
    { label: "Avg job time", value: formatMs(pipeline?.avgJobDurationMs) },
    { label: "Queue depth", value: compact(pipeline?.queueDepth) },
    {
      label: "High confidence",
      value: quality != null ? `${(quality.highConfidenceRate * 100).toFixed(1)}%` : "--",
    },
    {
      label: "CrossRef calls",
      value: compact(providers?.crossref.calls),
      detail:
        providers != null
          ? `${(providers.crossref.cacheHitRate * 100).toFixed(0)}% cache hit`
          : undefined,
    },
    {
      label: "OpenAlex calls",
      value: compact(providers?.openalex.calls),
      detail:
        providers != null
          ? `${(providers.openalex.cacheHitRate * 100).toFixed(0)}% cache hit`
          : undefined,
    },
  ];

  return (
    <AdminShell
      title="Health"
      subtitle={`Last ${DAYS} days · queue depth ${pipeline?.queueDepth ?? 0} · avg job ${formatMs(pipeline?.avgJobDurationMs)}`}
    >
      <div className="space-y-5">
        <AdminCslStatus />

        {isLoading && !s ? (
          <div className="py-24 text-center text-slate-400 dark:text-slate-500">
            Synchronising diagnostic monitors…
          </div>
        ) : (
          <div className="space-y-5">
          {/* KPI strip */}
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {kpis.map((k) => (
              <AdminCard key={k.label} className="p-5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {k.label}
                </p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {k.value}
                </p>
                {k.detail ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {k.detail}
                  </p>
                ) : null}
              </AdminCard>
            ))}
          </section>

          {/* Citations + jobs */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <AdminCard>
              <AdminCardHeader title="Citations by status" />
              <CitationStatusPieChart
                citationsByStatus={pipeline?.citationsByStatus}
                className="h-56 w-full min-h-[220px]"
                innerRadius={48}
                outerRadius={76}
                cy="46%"
              />
            </AdminCard>

            <AdminCard className="lg:col-span-2">
              <AdminCardHeader title="Jobs by status" />
              <SafeResponsiveChart className="h-56 min-h-[14rem]" minHeight={180}>
                <BarChart data={jobBar} margin={{ left: -16, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.16)" vertical={false} />
                  <XAxis
                    dataKey="status"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    width={40}
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                  <Bar dataKey="count" fill="#2f6df6" radius={[6, 6, 0, 0]} maxBarSize={64} />
                </BarChart>
              </SafeResponsiveChart>
            </AdminCard>
          </section>

          {/* Error signal */}
          <section>
            <AdminCard>
              <AdminCardHeader title="Error signal (daily)" />
              <SafeResponsiveChart className="h-60 min-h-[15rem]" minHeight={200}>
                <AreaChart data={errorSeries} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="errFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
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
                    allowDecimals={false}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} cursor={{ stroke: "rgba(148,163,184,0.3)" }} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Errors"
                    stroke="#f43f5e"
                    strokeWidth={2.5}
                    fill="url(#errFill)"
                  />
                </AreaChart>
              </SafeResponsiveChart>
              {errorSeries.every((d) => d.count === 0) ? (
                <p className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">
                  No errors recorded in this window.
                </p>
              ) : null}
            </AdminCard>
          </section>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
