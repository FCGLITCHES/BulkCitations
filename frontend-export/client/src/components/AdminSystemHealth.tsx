import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
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

function formatMs(value: number | null) {
  if (value == null) return "--";
  return `${Math.round(value)}ms`;
}

export default function AdminSystemHealth() {
  const [location] = useLocation();
  const { data: analyticsSummary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/admin/analytics/summary", 30],
    queryFn: async () => adminFetch<AnalyticsSummary>("/api/admin/analytics/summary?days=30"),
  });

  const converter = analyticsSummary?.converter ?? {
    starts: 0, completed: 0, failed: 0,
    startRate: null, completionRate: null,
    averageCitationsPerStart: null, averageDurationMs: null,
  };

  return (
    <div className="min-h-screen bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#11161d] dark:text-slate-100 selection:bg-primary-fixed selection:text-on-primary-fixed">
      <AdminHeader />

      <main className="flex-1 min-w-0 bg-transparent pt-24 flex flex-col">
        <div className="p-8 max-w-7xl mx-auto space-y-8 pb-16">
          {isLoading ? (
            <div className="py-24 text-center text-slate-500 font-headline text-2xl italic dark:text-slate-400">
               Synchronising diagnostic monitors...
            </div>
          ) : (
            <>
              {/* Header Actions Section */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div className="space-y-1">
                  <p className="font-label text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 font-black">Infrastucture Diagnostics</p>
                  <h3 className="font-headline text-4xl text-[#0f4fa8] dark:text-blue-300 font-black -tracking-wider">Real-time Environment Status</h3>
                </div>
                <div className="flex gap-3">
                  <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-[#0f4fa8] dark:text-blue-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-900 transition-all">
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Download Log
                  </button>
                  <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#002147] text-white font-bold text-sm shadow-lg hover:shadow-xl transition-all active:scale-95">
                    <span className="material-symbols-outlined text-[18px]">refresh</span>
                    Refresh Stats
                  </button>
                </div>
              </div>

              {/* Metrics Grid: Bento Style */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Uptime Card */}
                <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900 flex flex-col justify-between min-h-[160px]">
                  <div className="flex justify-between items-start">
                    <span className="material-symbols-outlined text-secondary">timer</span>
                    <span className="text-[10px] font-black text-secondary uppercase tracking-widest bg-secondary-container px-2 py-0.5 rounded">Stable</span>
                  </div>
                  <div>
                    <p className="text-3xl font-headline font-black text-[#0f4fa8] dark:text-blue-300">99.98%</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mt-1 uppercase tracking-tighter">30-Day Uptime Statistic</p>
                  </div>
                </div>

                {/* Latency Detection Card */}
                <div className="md:col-span-2 rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900">
                  <div className="flex justify-between items-center mb-6 text-body">
                    <h4 className="font-black text-[10px] uppercase tracking-wider text-[#0f4fa8] dark:text-blue-400">API Latency (ms)</h4>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-300"></span>
                        <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-tighter">Primary</span>
                      </div>
                    </div>
                  </div>
                  <div className="h-24 flex items-end gap-1.5">
                    {[40, 60, 55, 45, 70, 85, 40, 35, 50, 30, 45, 60].map((h, i) => (
                      <div 
                        key={i} 
                        className={cn("flex-1 rounded-t-sm transition-colors group relative", i === 3 || i === 9 ? "bg-blue-600 dark:bg-blue-300" : "bg-slate-100 dark:bg-slate-800 hover:bg-blue-500 dark:hover:bg-blue-400")}
                        style={{ height: `${h}%` }}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 text-[9px] font-bold bg-slate-900 dark:bg-blue-500 text-white dark:text-slate-950 px-1 rounded whitespace-nowrap z-10">{h}ms</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-4">
                    <div className="text-center">
                      <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter">Detection</p>
                      <p className="text-sm font-headline font-black text-[#0f4fa8] dark:text-blue-300">{formatMs((converter.averageDurationMs || 0) * 0.2)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter">Formatting</p>
                      <p className="text-sm font-headline font-black text-[#0f4fa8] dark:text-blue-300">{formatMs((converter.averageDurationMs || 0) * 0.1)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter">Export</p>
                      <p className="text-sm font-headline font-black text-[#0f4fa8] dark:text-blue-300">{formatMs((converter.averageDurationMs || 0) * 0.7)}</p>
                    </div>
                  </div>
                </div>

                {/* Integration Status Card */}
                <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900">
                  <h4 className="font-black text-[10px] uppercase tracking-wider text-[#0f4fa8] dark:text-blue-400 mb-4">External APIs</h4>
                  <div className="space-y-4">
                    {[
                      { name: "DOI Resolution", icon: "check_circle", color: "text-secondary" },
                      { name: "Crossref Engine", icon: "check_circle", color: "text-secondary" },
                      { name: "ORCID Auth", icon: "pending", color: "text-tertiary-fixed-dim" },
                    ].map((api) => (
                      <div key={api.name} className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300 tracking-tight">{api.name}</span>
                        <span className={cn("material-symbols-outlined text-sm", api.color)}>{api.icon}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Database & Infrastructure Detail */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Database Health */}
                <div className="lg:col-span-1 space-y-6">
                  <h4 className="font-headline text-xl text-[#0f4fa8] dark:text-blue-300 font-black -tracking-tight">Database Cluster</h4>
                  <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900 space-y-6">
                    {/* Main DB */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <p className="text-[10px] font-black text-[#0f4fa8] dark:text-blue-300 uppercase tracking-widest">Main Postgres</p>
                        <p className="text-[10px] text-secondary font-black uppercase">92% Health</p>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-secondary h-full w-[92%]"></div>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 font-black tracking-tighter uppercase">
                        <span>CPU: 24%</span>
                        <span>Mem: 4.2GB</span>
                        <span>Disk: 68%</span>
                      </div>
                    </div>
                    {/* Replica 01 */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <p className="text-[10px] font-black text-[#0f4fa8] dark:text-blue-300 uppercase tracking-widest">Read Replica-01</p>
                        <p className="text-[10px] text-secondary font-black uppercase">98% Health</p>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-secondary h-full w-[98%]"></div>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 font-black tracking-tighter uppercase">
                        <span>CPU: 12%</span>
                        <span>Mem: 1.8GB</span>
                        <span>Disk: 12%</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-[#002147] p-6 rounded-xl text-white">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="material-symbols-outlined text-primary-fixed-dim">auto_awesome</span>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em]">Archivist Insight</p>
                    </div>
                    <p className="text-sm font-serif italic leading-relaxed opacity-90">
                      "Database performance remains optimal despite a 14% increase in citation requests this morning. Replication lag is currently &lt; 10ms."
                    </p>
                  </div>
                </div>

                {/* Recent Error Logs */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-headline text-xl text-[#0f4fa8] dark:text-blue-300 font-black -tracking-tight">Recent Error Logs</h4>
                    <button className="text-[10px] font-black text-[#0f4fa8] dark:text-blue-300 uppercase tracking-widest border-b border-[#0f4fa8] dark:border-blue-400 hover:opacity-70 transition-opacity">Clear Non-Critical</button>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900 overflow-hidden font-body">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Severity</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Timestamp</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Component</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {[
                          { severity: "Critical", time: "14:02:11 UTC", component: "Export Svc", message: "Failed to serialize BibTeX for batch #99283...", color: "bg-error-container text-on-error-container" },
                          { severity: "Warning", time: "13:58:45 UTC", component: "Auth Provider", message: "Latency spike detected in Institutional SSO...", color: "bg-tertiary-fixed text-on-tertiary-fixed-variant" },
                          { severity: "Info", time: "13:45:02 UTC", component: "System", message: "Garbage collection successfully completed (402MB cleared)", color: "bg-secondary-fixed text-on-secondary-fixed-variant" },
                          { severity: "Info", time: "13:30:19 UTC", component: "Formatter", message: "New citation style 'Oxford University Press' cached...", color: "bg-secondary-fixed text-on-secondary-fixed-variant" },
                          { severity: "Warning", time: "13:12:55 UTC", component: "DB Replica", message: "Read-only connection timeout on node 'RP-04'", color: "bg-tertiary-fixed text-on-tertiary-fixed-variant" },
                        ].map((log, i) => (
                          <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                            <td className="px-6 py-4">
                              <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black uppercase", log.color)}>{log.severity}</span>
                            </td>
                            <td className="px-6 py-4 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter">{log.time}</td>
                            <td className="px-6 py-4 text-[10px] font-black text-[#0f4fa8] dark:text-blue-300 uppercase tracking-tighter">{log.component}</td>
                            <td className="px-6 py-4 text-[11px] text-slate-600 dark:text-slate-300 italic font-medium">{log.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 text-center">
                      <button className="text-[10px] font-black uppercase tracking-widest text-[#0f4fa8] dark:text-blue-300 hover:opacity-70 transition-colors">View All Archive Logs</button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <AdminFooter />
    </div>
  );
}
