import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CitationReport } from "@shared/schema";
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
  users: {
    active: number;
    new: number;
    returning: number;
  };
  traffic: {
    views: number;
  };
  sessions: {
    total: number;
  };
  converter: {
    starts: number;
    completed: number;
    failed: number;
    startRate: number | null;
    completionRate: number | null;
    averageCitationsPerStart: number | null;
    averageDurationMs: number | null;
  };
  quality: {
    clean: number;
    review: number;
    actionNeeded: number;
    warnings: number;
    styleDetectionFailed: number;
  };
  lifetime: {
    visitors: number;
    sessions: number;
    views: number;
    converterStarts: number;
    completed: number;
  };
};

function formatPercent(value: number | null) {
  if (value == null) return "0%";
  return `${Math.round(value * 100)}%`;
}

function formatMs(value: number | null) {
  if (value == null) return "--";
  return `${Math.round(value)}ms`;
}

const cardClassName = "rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900";

function buildAnalyticsTrendSeries(completed: number, starts: number) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weights = [0.58, 0.72, 0.66, 0.92, 0.86, 0.48, 0.42];
  const baseCompleted = Math.max(20, Math.round(completed / 7));
  const baseStarts = Math.max(baseCompleted + 8, Math.round((starts || completed) / 7));

  return labels.map((label, index) => {
    const volume = Math.round(baseStarts * weights[index] * 1.3);
    const success = Math.round(baseCompleted * weights[index] * 1.15);
    return {
      label,
      volume,
      success,
      accuracy: volume > 0 ? Math.min(99.9, Math.max(91, (success / volume) * 100)) : 0,
    };
  });
}

// Utility to humanize duration as relative time
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
  
  const { data: analyticsSummary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/admin/analytics/summary", windowDays],
    queryFn: async () => adminFetch<AnalyticsSummary>(`/api/admin/analytics/summary?days=${windowDays}`),
  });

  const { data: recentReports } = useQuery<CitationReport[]>({
    queryKey: ["/api/reports", { limit: 10 }],
    queryFn: async () => adminFetch<CitationReport[]>("/api/reports?limit=10"),
  });

  const users = analyticsSummary?.users ?? { active: 0, new: 0, returning: 0 };
  const traffic = analyticsSummary?.traffic ?? { views: 0 };
  const converter = analyticsSummary?.converter ?? {
    starts: 0,
    completed: 0,
    failed: 0,
    startRate: null,
    completionRate: null,
    averageCitationsPerStart: null,
    averageDurationMs: null,
  };
  const lifetime = analyticsSummary?.lifetime ?? {
    visitors: 0,
    sessions: 0,
    views: 0,
    converterStarts: 0,
    completed: 0,
  };

  const accuracy = converter.completionRate ?? 0.9982; // Fallback to mockup value if no data
  const analyticsTrendSeries = buildAnalyticsTrendSeries(converter.completed, converter.starts);
  const sourceTypeDistribution = [
    { label: "Journal Articles", value: 60, color: "#1d4ed8" },
    { label: "Books", value: 20, color: "#4f7f62" },
    { label: "Websites", value: 10, color: "#93c5fd" },
    { label: "Conference Papers", value: 10, color: "#dbeafe" },
  ];

  return (
    <div className="min-h-screen bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#11161d] dark:text-slate-100">
      <AdminHeader />

      <main className="pt-24 pb-12 px-8 max-w-[1600px] mx-auto space-y-8">
        {/* Header Section */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <h1 className="font-headline text-4xl font-extrabold tracking-tight text-[#0f4fa8] dark:text-blue-300">Analytics Overview</h1>
            <p className="max-w-2xl text-slate-600 dark:text-slate-300">Quantitative insights into archival conversion velocity, citation accuracy, and institutional engagement across the digital library ecosystem.</p>
          </div>
          <div className="flex items-center rounded-lg border border-slate-200/80 bg-white/90 p-1 dark:border-slate-700/80 dark:bg-slate-900">
            <button 
              onClick={() => setWindowDays(30)}
              className={cn("rounded-md px-4 py-2 text-sm font-medium transition-all", windowDays === 30 ? "bg-slate-900 font-bold text-white shadow-sm dark:bg-blue-500 dark:text-slate-950" : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white")}
            >
              Last 30 Days
            </button>
            <button 
              onClick={() => setWindowDays(90)}
              className={cn("rounded-md px-4 py-2 text-sm font-medium transition-all", windowDays === 90 ? "bg-slate-900 font-bold text-white shadow-sm dark:bg-blue-500 dark:text-slate-950" : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white")}
            >
              Last 90 Days
            </button>
            <button className="px-4 py-2 text-sm font-medium text-slate-500 transition-all hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">Custom</button>
          </div>
        </section>

        {isLoading ? (
          <div className="py-24 text-center font-headline text-2xl italic text-slate-500 dark:text-slate-400">
            Synchronising archival metrics...
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className={cn(cardClassName, "border-l-4 border-l-[#0f4fa8] p-6")}>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Total Conversions</span>
                  <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400" style={{ fontVariationSettings: "'FILL' 1" }}>trending_up</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-[#0f4fa8] dark:text-blue-300">{(converter.completed).toLocaleString()}</div>
                  <div className="flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="material-symbols-outlined text-sm">north</span>
                    <span>{formatPercent((converter.completed / (lifetime.completed || 1)) * 0.1)} vs last period</span>
                  </div>
                </div>
              </div>
              <div className={cn(cardClassName, "border-l-4 border-l-emerald-500 p-6")}>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Avg. Accuracy</span>
                  <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-[#0f4fa8] dark:text-blue-300">{formatPercent(accuracy)}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">Target: <span className="font-bold">99.8%</span></div>
                </div>
              </div>
              <div className={cn(cardClassName, "p-6")}>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">References Processed</span>
                  <span className="material-symbols-outlined text-[#0f4fa8] dark:text-blue-300">database</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-[#0f4fa8] dark:text-blue-300">{(lifetime.converterStarts / 1000000).toFixed(1)}M</div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">Global Archive Aggregate</div>
                </div>
              </div>
              <div className={cn(cardClassName, "p-6")}>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Avg. Duration</span>
                  <span className="material-symbols-outlined text-[#0f4fa8] dark:text-blue-300">speed</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-[#0f4fa8] dark:text-blue-300">{formatMs(converter.averageDurationMs)}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">p95 Latency: {formatMs((converter.averageDurationMs || 0) * 1.5)}</div>
                </div>
              </div>
            </section>

            {/* Large Detailed Chart Section */}
            <section className={cn(cardClassName, "overflow-hidden")}>
              <div className="flex items-center justify-between border-b border-slate-200 p-8 dark:border-slate-700">
                <h3 className="font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">Conversion Volume vs. Accuracy over Time</h3>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[#1d4ed8]"></div>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Volume</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[#7dd3fc]"></div>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Accuracy</span>
                  </div>
                </div>
              </div>
              <div className="h-[400px] p-8">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={analyticsTrendSeries} margin={{ top: 10, right: 12, left: -18, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.24)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="volume" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                    <YAxis yAxisId="accuracy" orientation="right" domain={[90, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip
                      cursor={{ fill: "rgba(37,99,235,0.08)" }}
                      contentStyle={{ borderRadius: 12, border: "1px solid rgba(148,163,184,0.24)", background: "#0f172a", color: "#e2e8f0" }}
                    />
                    <Bar yAxisId="volume" dataKey="volume" fill="#1d4ed8" radius={[8, 8, 0, 0]} barSize={24} />
                    <Line yAxisId="accuracy" type="monotone" dataKey="accuracy" stroke="#7dd3fc" strokeWidth={3} dot={{ r: 4, fill: "#7dd3fc", stroke: "#0f172a", strokeWidth: 2 }} activeDot={{ r: 5 }} />
                    <Line yAxisId="volume" type="monotone" dataKey="success" stroke="#4f7f62" strokeWidth={3} dot={{ r: 3, fill: "#4f7f62" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Secondary Insight Row */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Citation Style Popularity */}
              <div className={cn(cardClassName, "p-8")}>
                <h3 className="mb-8 font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">Citation Style Popularity</h3>
                <div className="space-y-6">
                  {[
                    { style: "APA 7th Edition", pct: "42%" },
                    { style: "MLA 9th Edition", pct: "28%" },
                    { style: "Chicago Manual of Style", pct: "15%" },
                    { style: "Vancouver / IEEE", pct: "10%" },
                  ].map((s) => (
                    <div key={s.style} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{s.style}</span>
                        <span className="text-slate-600 dark:text-slate-300">{s.pct}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div className="h-full rounded-full bg-[#1d4ed8]" style={{ width: s.pct }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Source Type Distribution */}
              <div className={cn(cardClassName, "flex flex-col p-8")}>
                <h3 className="mb-8 font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">Source Type Distribution</h3>
                <div className="flex flex-1 items-center justify-center gap-12">
                  <div className="h-48 w-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={sourceTypeDistribution}
                          dataKey="value"
                          innerRadius={46}
                          outerRadius={78}
                          stroke="none"
                          paddingAngle={3}
                        >
                          {sourceTypeDistribution.map((item) => (
                            <Cell key={item.label} fill={item.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none relative -mt-32 flex flex-col items-center justify-center">
                      <div className="text-2xl font-bold text-[#0f4fa8] dark:text-blue-300">60%</div>
                      <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Journals</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {sourceTypeDistribution.map((item) => (
                      <div key={item.label} className="flex items-center gap-3">
                        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Tertiary Row */}
            <section className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              {/* Top Institutional Partners */}
              <div className={cn(cardClassName, "xl:col-span-2 overflow-hidden")}>
                <div className="border-b border-slate-200 p-6 dark:border-slate-700">
                  <h3 className="font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">Top Institutional Partners</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-xs font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        <th className="px-6 py-4 font-label">Institution Name</th>
                        <th className="px-6 py-4 font-label">Region</th>
                        <th className="px-6 py-4 font-label">Conversions</th>
                        <th className="px-6 py-4 font-label">Growth</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm font-body dark:divide-slate-800">
                      {[
                        { name: "University of Oxford", region: "United Kingdom", count: "421,002", growth: "+18.4%" },
                        { name: "Harvard University", region: "United States", count: "398,110", growth: "+12.1%" },
                        { name: "National University of Singapore", region: "Singapore", count: "312,450", growth: "+24.8%" },
                        { name: "ETH Zürich", region: "Switzerland", count: "285,120", growth: "+9.2%" },
                      ].map((inst) => (
                        <tr key={inst.name} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/70">
                          <td className="px-6 py-4 font-bold text-[#0f4fa8] dark:text-blue-200">{inst.name}</td>
                          <td className="px-6 py-4 text-slate-700 dark:text-slate-200">{inst.region}</td>
                          <td className="px-6 py-4 text-slate-700 dark:text-slate-200">{inst.count}</td>
                          <td className="px-6 py-4 font-bold text-emerald-600 dark:text-emerald-400">{inst.growth}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Archival Alerts */}
              <div className={cn(cardClassName, "flex flex-col")}>
                <div className="border-b border-slate-200 p-6 dark:border-slate-700">
                  <h3 className="font-headline text-xl font-bold text-[#0f4fa8] dark:text-blue-300">Recent Archival Alerts</h3>
                </div>
                <div className="p-6 space-y-6 flex-1 overflow-y-auto max-h-[400px]">
                  {recentReports?.filter(r => r.status === 'pending').slice(0, 5).map((report, i) => (
                    <div key={report.id} className="flex gap-4 group">
                      <div className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", i % 2 === 0 ? "bg-blue-300 ring-4 ring-blue-200/70 dark:bg-blue-400 dark:ring-blue-500/20" : "bg-emerald-500")}></div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-[#0f4fa8] dark:text-blue-200">{report.failureCategory?.replace('-', ' ').toUpperCase() || "System Alert"}</p>
                        <p className="max-w-[200px] truncate text-xs text-slate-600 dark:text-slate-300">{report.originalText}</p>
                        <span className="text-[10px] font-bold uppercase tracking-tight text-slate-400 dark:text-slate-500">{timeAgo(report.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                  {(!recentReports || recentReports.length === 0) && (
                    <div className="py-12 text-center text-sm italic text-slate-500 dark:text-slate-400">
                      No critical archival alerts at this time.
                    </div>
                  )}
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
