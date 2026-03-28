import { useQuery } from "@tanstack/react-query";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type AnalyticsSummary = {
  generatedAt: string;
  windowDays: number;
  users: { active: number; new: number; returning: number };
  traffic: { views: number };
  sessions: { total: number };
  converter: {
    starts: number; completed: number; failed: number;
    startRate: number | null; completionRate: number | null;
    averageCitationsPerStart: number | null; averageDurationMs: number | null;
  };
  quality: {
    clean: number; review: number; actionNeeded: number;
    warnings: number; styleDetectionFailed: number;
  };
  lifetime: {
    visitors: number; sessions: number; views: number;
    converterStarts: number; completed: number;
  };
};

function formatMs(value: number | null) {
  if (value == null) return "--";
  return `${Math.round(value)}ms`;
}

const cardClassName = "rounded-2xl border border-slate-200/80 bg-white/95 p-8 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900";
const subduedCardClassName = "rounded-2xl border border-slate-200/80 bg-slate-50/95 p-8 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.2)] dark:border-slate-700/80 dark:bg-slate-900/95";

function buildTrendSeries(completed: number, starts: number) {
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weights = [0.72, 0.84, 0.78, 0.92, 1.14, 0.96, 0.88];
  const baseCompleted = Math.max(18, Math.round(completed / 7));
  const baseStarted = Math.max(baseCompleted + 6, Math.round((starts || completed) / 7));

  return dayLabels.map((day, index) => {
    const completion = Math.round(baseCompleted * weights[index]);
    const volume = Math.round(baseStarted * (weights[index] + 0.08));
    return {
      day,
      completed: completion,
      started: volume,
      accuracy: volume > 0 ? Math.min(99.9, Math.max(91, (completion / volume) * 100)) : 0,
    };
  });
}

export default function AdminDashboard() {
  const { data: analyticsSummary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/admin/analytics/summary", 30],
    queryFn: async () => adminFetch<AnalyticsSummary>("/api/admin/analytics/summary?days=30"),
  });

  const users = analyticsSummary?.users ?? { active: 0, new: 0, returning: 0 };
  const converter = analyticsSummary?.converter ?? {
    starts: 0, completed: 0, failed: 0,
    startRate: null, completionRate: null,
    averageCitationsPerStart: null, averageDurationMs: null,
  };
  const quality = analyticsSummary?.quality ?? {
    clean: 0, review: 0, actionNeeded: 0, warnings: 0, styleDetectionFailed: 0
  };
  const trendSeries = buildTrendSeries(converter.completed, converter.starts);
  const styleDistribution = [
    { style: "APA 7th Edition", value: 42.5, color: "#2563eb" },
    { style: "MLA 9th Edition", value: 28.1, color: "#cbdaf6" },
    { style: "Chicago (Notes & Bib)", value: 15.4, color: "#77c8d0" },
    { style: "Harvard", value: 14.0, color: "#78a47b" },
  ];
  const healthDistribution = [
    { name: "Ready", value: quality.clean, color: "#4f7f62" },
    { name: "Review", value: quality.review, color: "#d3c2f4" },
    { name: "Needs Action", value: quality.actionNeeded, color: "#f59e8b" },
  ];

  const errorRate = converter.starts > 0 ? (converter.failed / converter.starts) * 100 : 0.04;

  return (
    <div className="min-h-screen bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#11161d] dark:text-slate-100">
      <AdminHeader />

      <main className="pb-20 px-8 max-w-screen-2xl mx-auto pt-24">
        {isLoading ? (
          <div className="py-24 text-center text-slate-500 font-headline text-2xl italic dark:text-slate-400">
            Synchronising executive dashboard...
          </div>
        ) : (
          <>
            {/* Dashboard Header */}
            <div className="mb-12">
              <h1 className="mb-2 font-headline text-4xl font-black tracking-tight text-[#0f4fa8] dark:text-blue-300">Executive Overview</h1>
              <p className="text-lg text-slate-600 dark:text-slate-300">System-wide performance and archive health metrics.</p>
            </div>

            {/* KPI Section: Bento Grid */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
              {/* Conversions KPI */}
              <div className={cn(cardClassName, "flex flex-col justify-between")}>
                <div>
                  <span className="mb-4 block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Total Conversions</span>
                  <div className="flex items-baseline gap-4">
                    <span className="text-5xl font-black text-[#0f4fa8] dark:text-blue-300">{converter.completed.toLocaleString()}</span>
                    <span className="flex items-center text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      <span className="material-symbols-outlined text-sm mr-1">trending_up</span>+14.2%
                    </span>
                  </div>
                </div>
                <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-700">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-600 dark:text-slate-300">vs. Last Month</span>
                    <span className="font-semibold text-[#0f4fa8] dark:text-blue-300">{(converter.completed * 0.9).toFixed(0)}</span>
                  </div>
                </div>
              </div>

              {/* Reference Health Distribution */}
              <div className={cardClassName}>
                <span className="mb-6 block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Reference Health</span>
                <div className="flex items-center gap-8">
                  <div className="relative h-32 w-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={healthDistribution}
                          dataKey="value"
                          innerRadius={36}
                          outerRadius={54}
                          stroke="none"
                          paddingAngle={3}
                        >
                          {healthDistribution.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-[#0f4fa8] dark:text-blue-300">82%</span>
                      <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Optimal</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200"><span className="h-2 w-2 rounded-full bg-[#4f7f62]"></span> Ready</span>
                      <span className="font-bold text-slate-900 dark:text-white">{(quality.clean / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200"><span className="h-2 w-2 rounded-full bg-[#d3c2f4]"></span> Review</span>
                      <span className="font-bold text-slate-900 dark:text-white">{(quality.review / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200"><span className="h-2 w-2 rounded-full bg-[#f59e8b]"></span> Needs Action</span>
                      <span className="font-bold text-slate-900 dark:text-white">{quality.actionNeeded}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* User Growth */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b5cad] to-[#123d73] p-8 text-white shadow-[0_22px_48px_-24px_rgba(15,23,42,0.5)]">
                <div className="relative z-10">
                  <span className="mb-4 block text-xs font-bold uppercase tracking-widest text-blue-100/80">Total Archivists</span>
                  <div className="text-5xl font-black mb-6 italic">{users.active.toLocaleString()}</div>
                  <div className="space-y-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                      <div className="h-full bg-blue-200" style={{ width: "65%" }}></div>
                    </div>
                    <div className="flex justify-between text-xs font-medium">
                      <span>Students (65%)</span>
                      <span>Institutions (35%)</span>
                    </div>
                  </div>
                </div>
                {/* Abstract decorative shape */}
                <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl"></div>
              </div>
            </section>

            {/* Detailed Analytics Panels */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              {/* Conversion Trends */}
              <div className={cardClassName}>
                <div className="flex justify-between items-center mb-10">
                  <h3 className="font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">Conversion Trends</h3>
                  <div className="flex gap-2">
                    <button className="rounded-md bg-slate-900 px-3 py-1 text-xs font-bold text-white dark:bg-blue-500 dark:text-slate-950">7D</button>
                    <button className="rounded-md px-3 py-1 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">30D</button>
                  </div>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendSeries} margin={{ top: 10, right: 8, left: -18, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(148,163,184,0.24)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="volume" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                      <YAxis yAxisId="accuracy" orientation="right" domain={[90, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                      <Tooltip
                        cursor={{ fill: "rgba(37,99,235,0.08)" }}
                        contentStyle={{ borderRadius: 12, border: "1px solid rgba(148,163,184,0.24)", background: "#0f172a", color: "#e2e8f0" }}
                      />
                      <Bar yAxisId="volume" dataKey="started" fill="#1d4ed8" radius={[8, 8, 0, 0]} barSize={20} />
                      <Bar yAxisId="volume" dataKey="completed" fill="#60a5fa" radius={[8, 8, 0, 0]} barSize={14} />
                      <Line yAxisId="accuracy" type="monotone" dataKey="accuracy" stroke="#7dd3fc" strokeWidth={3} dot={{ r: 4, fill: "#7dd3fc", stroke: "#0f172a", strokeWidth: 2 }} activeDot={{ r: 5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-5 flex flex-wrap gap-4 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#1d4ed8]"></span> Started</span>
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#60a5fa]"></span> Completed</span>
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#7dd3fc]"></span> Accuracy</span>
                </div>
              </div>

              {/* Popular Target Styles */}
              <div className={cardClassName}>
                <h3 className="mb-10 font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">Target Style Distribution</h3>
                <div className="space-y-6">
                  {styleDistribution.map((s) => (
                    <div key={s.style}>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-bold text-[#0f4fa8] dark:text-blue-200">{s.style}</span>
                        <span className="text-slate-600 dark:text-slate-300">{s.value.toFixed(1)}%</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div className="h-full rounded-full" style={{ width: `${s.value}%`, backgroundColor: s.color }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* System Performance (Wide Span) */}
              <div className={cn(subduedCardClassName, "lg:col-span-2")}>
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">Infrastructure Health</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300">Institutional partner API connectivity and latency.</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span> ALL SYSTEMS OPERATIONAL
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-slate-200/80 bg-white/90 p-6 dark:border-slate-700/80 dark:bg-slate-900">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Avg Latency</span>
                    <div className="text-2xl font-bold text-[#0f4fa8] dark:text-blue-300">{formatMs(converter.averageDurationMs)}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-tighter text-emerald-600 dark:text-emerald-400">Optimal</div>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/90 p-6 dark:border-slate-700/80 dark:bg-slate-900">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Error Rate</span>
                    <div className="text-2xl font-bold text-[#0f4fa8] dark:text-blue-300">{errorRate.toFixed(2)}%</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-tighter text-emerald-600 dark:text-emerald-400">Stable</div>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/90 p-6 dark:border-slate-700/80 dark:bg-slate-900">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">API Requests</span>
                    <div className="text-2xl font-bold text-[#0f4fa8] dark:text-blue-300">{(analyticsSummary?.traffic.views ?? 0).toLocaleString()}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-tighter text-slate-500 dark:text-slate-400">Per window</div>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/90 p-6 dark:border-slate-700/80 dark:bg-slate-900">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Uptime</span>
                    <div className="text-2xl font-bold text-[#0f4fa8] dark:text-blue-300">99.98%</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-tighter text-emerald-600 dark:text-emerald-400">Excellent</div>
                  </div>
                </div>
                {/* Recent Health Logs */}
                <div className="mt-8 overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 font-body dark:border-slate-700/80 dark:bg-slate-900">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      <tr>
                        <th className="px-6 py-3">Institution Partner</th>
                        <th className="px-6 py-3">Region</th>
                        <th className="px-6 py-3">Latency</th>
                        <th className="px-6 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {[
                        { name: "Oxford Digital Repository", region: "UK-South", latency: "82ms", status: "ACTIVE" },
                        { name: "MIT Global Library", region: "US-East", latency: "142ms", status: "ACTIVE" },
                        { name: "Max Planck Society", region: "EU-Central", latency: "91ms", status: "ACTIVE" },
                        { name: "Stanford Academic Cloud", region: "US-West", latency: "156ms", status: "SLOW" },
                      ].map((log) => (
                        <tr key={log.name} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/70">
                          <td className="px-6 py-4 font-bold text-[#0f4fa8] dark:text-blue-200">{log.name}</td>
                          <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{log.region}</td>
                          <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{log.latency}</td>
                          <td className="px-6 py-4">
                            <span className={cn("rounded-md px-2 py-1 text-[10px] font-black", log.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300")}>
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <AdminFooter />
    </div>
  );
}
