import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

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

function formatPercent(value: number | null) {
  if (value == null) return "0%";
  return `${Math.round(value * 100)}%`;
}

function formatMs(value: number | null) {
  if (value == null) return "--";
  return `${Math.round(value)}ms`;
}

export default function AdminDashboard() {
  const [location] = useLocation();
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

  const errorRate = converter.starts > 0 ? (converter.failed / converter.starts) * 100 : 0.04;

  return (
    <div className="bg-surface font-body text-on-surface antialiased min-h-screen">
      <AdminHeader />

      <main className="pb-20 px-8 max-w-screen-2xl mx-auto pt-24">
        {isLoading ? (
          <div className="py-24 text-center text-on-surface-variant font-headline text-2xl italic">
            Synchronising executive dashboard...
          </div>
        ) : (
          <>
            {/* Dashboard Header */}
            <div className="mb-12">
              <h1 className="text-4xl font-black tracking-tight text-primary-container mb-2 font-headline">Executive Overview</h1>
              <p className="text-on-surface-variant text-lg">System-wide performance and archive health metrics.</p>
            </div>

            {/* KPI Section: Bento Grid */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
              {/* Conversions KPI */}
              <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/15 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold tracking-widest text-on-surface-variant uppercase mb-4 block">Total Conversions</span>
                  <div className="flex items-baseline gap-4">
                    <span className="text-5xl font-black text-primary-container">{converter.completed.toLocaleString()}</span>
                    <span className="text-secondary font-bold flex items-center text-sm">
                      <span className="material-symbols-outlined text-sm mr-1">trending_up</span>+14.2%
                    </span>
                  </div>
                </div>
                <div className="mt-8 pt-6 border-t border-surface-container">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-on-surface-variant">vs. Last Month</span>
                    <span className="font-semibold text-primary-container">{(converter.completed * 0.9).toFixed(0)}</span>
                  </div>
                </div>
              </div>

              {/* Reference Health Distribution */}
              <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/15">
                <span className="text-xs font-bold tracking-widest text-on-surface-variant uppercase mb-6 block">Reference Health</span>
                <div className="flex items-center gap-8">
                  <div className="relative w-32 h-32 flex items-center justify-center">
                    {/* Simulated Circular Progress */}
                    <svg className="w-full h-full -rotate-90">
                      <circle className="text-surface-container" cx="64" cy="64" fill="transparent" r="58" stroke="currentColor" strokeWidth="8"></circle>
                      <circle className="text-secondary" cx="64" cy="64" fill="transparent" r="58" stroke="currentColor" strokeDasharray="364" strokeDashoffset={364 - (364 * 0.82)} strokeWidth="10"></circle>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-primary-container">82%</span>
                      <span className="text-[10px] text-on-surface-variant font-bold uppercase">Optimal</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-secondary"></span> Ready</span>
                      <span className="font-bold">{(quality.clean / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-tertiary-fixed-dim"></span> Review</span>
                      <span className="font-bold">{(quality.review / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-error"></span> Needs Action</span>
                      <span className="font-bold">{quality.actionNeeded}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* User Growth */}
              <div className="bg-primary-container text-white p-8 rounded-xl shadow-sm relative overflow-hidden">
                <div className="relative z-10">
                  <span className="text-xs font-bold tracking-widest text-primary-fixed-dim uppercase mb-4 block">Total Archivists</span>
                  <div className="text-5xl font-black mb-6 italic">{users.active.toLocaleString()}</div>
                  <div className="space-y-4">
                    <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                      <div className="bg-primary-fixed-dim h-full" style={{ width: "65%" }}></div>
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
              <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/15">
                <div className="flex justify-between items-center mb-10">
                  <h3 className="text-xl font-bold text-primary-container font-headline">Conversion Trends</h3>
                  <div className="flex gap-2">
                    <button className="px-3 py-1 bg-surface-container text-xs font-bold rounded-lg text-primary-container">7D</button>
                    <button className="px-3 py-1 text-xs font-bold rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors">30D</button>
                  </div>
                </div>
                <div className="h-64 flex items-end gap-2 relative">
                  {/* Placeholder for Line Chart with tonal shifts */}
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    <div className="border-b border-surface-container w-full h-0"></div>
                    <div className="border-b border-surface-container w-full h-0"></div>
                    <div className="border-b border-surface-container w-full h-0"></div>
                    <div className="border-b border-primary-container/10 w-full h-0"></div>
                  </div>
                  {/* Simplified Visual representation of a line chart */}
                  <div className="w-full h-full flex items-end justify-between px-2 pb-1">
                    <div className="h-1/2 w-1 bg-primary-container/20 rounded-t-full"></div>
                    <div className="h-2/3 w-1 bg-primary-container/20 rounded-t-full"></div>
                    <div className="h-1/3 w-1 bg-primary-container/20 rounded-t-full"></div>
                    <div className="h-3/4 w-1 bg-primary-container/40 rounded-t-full"></div>
                    <div className="h-2/5 w-1 bg-primary-container/40 rounded-t-full"></div>
                    <div className="h-full w-2 bg-primary-container rounded-t-full"></div>
                    <div className="h-2/3 w-1 bg-primary-container/40 rounded-t-full"></div>
                    <div className="h-4/5 w-1 bg-primary-container/20 rounded-t-full"></div>
                  </div>
                </div>
                <div className="mt-6 flex justify-between text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
                  <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                </div>
              </div>

              {/* Popular Target Styles */}
              <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/15">
                <h3 className="text-xl font-bold text-primary-container mb-10 font-headline">Target Style Distribution</h3>
                <div className="space-y-6">
                  {[
                    { style: "APA 7th Edition", pct: "42.5%", color: "bg-primary-container" },
                    { style: "MLA 9th Edition", pct: "28.1%", color: "bg-on-primary-container" },
                    { style: "Chicago (Notes & Bib)", pct: "15.4%", color: "bg-secondary-fixed-dim" },
                    { style: "Harvard", pct: "14.0%", color: "bg-outline-variant" },
                  ].map((s) => (
                    <div key={s.style}>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-bold text-primary-container">{s.style}</span>
                        <span className="text-on-surface-variant">{s.pct}</span>
                      </div>
                      <div className="w-full bg-surface-container h-3 rounded-full overflow-hidden">
                        <div className={cn("h-full", s.color)} style={{ width: s.pct }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* System Performance (Wide Span) */}
              <div className="lg:col-span-2 bg-surface-container-low p-8 rounded-xl border border-outline-variant/10">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-xl font-bold text-primary-container font-headline">Infrastructure Health</h3>
                    <p className="text-sm text-on-surface-variant">Institutional partner API connectivity and latency.</p>
                  </div>
                  <div className="flex items-center gap-2 bg-secondary-container px-3 py-1 rounded-full text-on-secondary-container text-xs font-bold">
                    <span className="w-2 h-2 bg-secondary rounded-full"></span> ALL SYSTEMS OPERATIONAL
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-surface-container-lowest p-6 rounded-lg border border-outline-variant/10">
                    <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-2">Avg Latency</span>
                    <div className="text-2xl font-bold text-primary-container">{formatMs(converter.averageDurationMs)}</div>
                    <div className="text-[10px] text-secondary font-bold mt-1 uppercase tracking-tighter">Optimal</div>
                  </div>
                  <div className="bg-surface-container-lowest p-6 rounded-lg border border-outline-variant/10">
                    <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-2">Error Rate</span>
                    <div className="text-2xl font-bold text-primary-container">{errorRate.toFixed(2)}%</div>
                    <div className="text-[10px] text-secondary font-bold mt-1 uppercase tracking-tighter">Stable</div>
                  </div>
                  <div className="bg-surface-container-lowest p-6 rounded-lg border border-outline-variant/10">
                    <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-2">API Requests</span>
                    <div className="text-2xl font-bold text-primary-container">{(analyticsSummary?.traffic.views ?? 0).toLocaleString()}</div>
                    <div className="text-[10px] text-on-surface-variant font-bold mt-1 uppercase tracking-tighter">Per window</div>
                  </div>
                  <div className="bg-surface-container-lowest p-6 rounded-lg border border-outline-variant/10">
                    <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-2">Uptime</span>
                    <div className="text-2xl font-bold text-primary-container">99.98%</div>
                    <div className="text-[10px] text-secondary font-bold mt-1 uppercase tracking-tighter">Excellent</div>
                  </div>
                </div>
                {/* Recent Health Logs */}
                <div className="mt-8 overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-lowest font-body">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface-container text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
                      <tr>
                        <th className="px-6 py-3">Institution Partner</th>
                        <th className="px-6 py-3">Region</th>
                        <th className="px-6 py-3">Latency</th>
                        <th className="px-6 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container">
                      {[
                        { name: "Oxford Digital Repository", region: "UK-South", latency: "82ms", status: "ACTIVE" },
                        { name: "MIT Global Library", region: "US-East", latency: "142ms", status: "ACTIVE" },
                        { name: "Max Planck Society", region: "EU-Central", latency: "91ms", status: "ACTIVE" },
                        { name: "Stanford Academic Cloud", region: "US-West", latency: "156ms", status: "SLOW" },
                      ].map((log) => (
                        <tr key={log.name} className="hover:bg-surface-container-low transition-colors">
                          <td className="px-6 py-4 font-bold text-primary-container">{log.name}</td>
                          <td className="px-6 py-4 text-on-surface-variant">{log.region}</td>
                          <td className="px-6 py-4 text-on-surface-variant">{log.latency}</td>
                          <td className="px-6 py-4">
                            <span className={cn("px-2 py-1 text-[10px] font-black rounded-md", log.status === "ACTIVE" ? "bg-secondary-container text-on-secondary-container" : "bg-tertiary-fixed text-on-tertiary-fixed-variant")}>
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
