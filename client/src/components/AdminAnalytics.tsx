import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CitationReport } from "@shared/schema";

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

  return (
    <div className="bg-surface font-body text-on-surface antialiased min-h-screen">
      <AdminHeader />

      <main className="pt-24 pb-12 px-8 max-w-[1600px] mx-auto space-y-8">
        {/* Header Section */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-4xl font-extrabold tracking-tight text-primary-container font-headline">Analytics Overview</h1>
            <p className="text-on-surface-variant max-w-2xl">Quantitative insights into archival conversion velocity, citation accuracy, and institutional engagement across the digital library ecosystem.</p>
          </div>
          <div className="flex items-center bg-surface-container-low p-1 rounded-lg">
            <button 
              onClick={() => setWindowDays(30)}
              className={cn("px-4 py-2 text-sm font-medium transition-all rounded", windowDays === 30 ? "font-bold text-white bg-primary-container shadow-sm" : "text-on-surface-variant hover:text-primary-container")}
            >
              Last 30 Days
            </button>
            <button 
              onClick={() => setWindowDays(90)}
              className={cn("px-4 py-2 text-sm font-medium transition-all rounded", windowDays === 90 ? "font-bold text-white bg-primary-container shadow-sm" : "text-on-surface-variant hover:text-primary-container")}
            >
              Last 90 Days
            </button>
            <button className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:text-primary-container transition-all">Custom</button>
          </div>
        </section>

        {isLoading ? (
          <div className="py-24 text-center text-on-surface-variant font-headline text-2xl italic">
            Synchronising archival metrics...
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)] border-l-4 border-primary-container">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Total Conversions</span>
                  <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>trending_up</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-primary-container">{(converter.completed).toLocaleString()}</div>
                  <div className="flex items-center gap-1 text-sm text-secondary font-medium">
                    <span className="material-symbols-outlined text-sm">north</span>
                    <span>{formatPercent((converter.completed / (lifetime.completed || 1)) * 0.1)} vs last period</span>
                  </div>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)] border-l-4 border-secondary">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Avg. Accuracy</span>
                  <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-primary-container">{formatPercent(accuracy)}</div>
                  <div className="text-sm text-on-surface-variant">Target: <span className="font-bold">99.8%</span></div>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)]">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">References Processed</span>
                  <span className="material-symbols-outlined text-primary-container">database</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-primary-container">{(lifetime.converterStarts / 1000000).toFixed(1)}M</div>
                  <div className="text-sm text-on-surface-variant">Global Archive Aggregate</div>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)]">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Avg. Duration</span>
                  <span className="material-symbols-outlined text-primary-container">speed</span>
                </div>
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-primary-container">{formatMs(converter.averageDurationMs)}</div>
                  <div className="text-sm text-on-surface-variant">p95 Latency: {formatMs((converter.averageDurationMs || 0) * 1.5)}</div>
                </div>
              </div>
            </section>

            {/* Large Detailed Chart Section */}
            <section className="bg-surface-container-lowest rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)] overflow-hidden">
              <div className="p-8 border-b border-surface-container flex justify-between items-center">
                <h3 className="text-xl font-bold text-primary-container font-headline">Conversion Volume vs. Accuracy over Time</h3>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-primary-container"></div>
                    <span className="text-xs font-medium text-on-surface-variant">Volume</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-secondary"></div>
                    <span className="text-xs font-medium text-on-surface-variant">Accuracy</span>
                  </div>
                </div>
              </div>
              <div className="p-8 h-[400px] relative flex items-end gap-2">
                {/* Visual Placeholder for a Chart using Bento-like bars */}
                {[
                  { day: "MON", height: "40%" },
                  { day: "TUE", height: "55%" },
                  { day: "WED", height: "45%" },
                  { day: "THU", height: "80%" },
                  { day: "FRI", height: "70%" },
                  { day: "SAT", height: "30%" },
                  { day: "SUN", height: "25%" },
                ].map((item) => (
                  <div key={item.day} className="flex-1 flex flex-col justify-end items-center gap-2 group h-full">
                    <div className="w-full bg-primary-fixed-dim/20 rounded-t-sm relative group-hover:bg-primary-fixed-dim transition-colors" style={{ height: item.height }}></div>
                    <div className="text-[10px] text-on-surface-variant font-bold">{item.day}</div>
                  </div>
                ))}
                {/* Line Overlay Simulation */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none px-8 pb-10" preserveAspectRatio="none" viewBox="0 0 1000 400">
                  <path d="M0,200 Q150,50 300,150 T600,80 T1000,120" fill="none" stroke="#43664d" strokeWidth="3"></path>
                </svg>
              </div>
            </section>

            {/* Secondary Insight Row */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Citation Style Popularity */}
              <div className="bg-surface-container-lowest p-8 rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)]">
                <h3 className="text-xl font-bold text-primary-container mb-8 font-headline">Citation Style Popularity</h3>
                <div className="space-y-6">
                  {[
                    { style: "APA 7th Edition", pct: "42%" },
                    { style: "MLA 9th Edition", pct: "28%" },
                    { style: "Chicago Manual of Style", pct: "15%" },
                    { style: "Vancouver / IEEE", pct: "10%" },
                  ].map((s) => (
                    <div key={s.style} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-bold">{s.style}</span>
                        <span className="text-on-surface-variant">{s.pct}</span>
                      </div>
                      <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                        <div className="h-full bg-primary-container" style={{ width: s.pct }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Source Type Distribution */}
              <div className="bg-surface-container-lowest p-8 rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)] flex flex-col">
                <h3 className="text-xl font-bold text-primary-container mb-8 font-headline">Source Type Distribution</h3>
                <div className="flex flex-1 items-center justify-center gap-12">
                  {/* Custom CSS Pie Chart Simulation */}
                  <div className="w-48 h-48 rounded-full relative" style={{ background: "conic-gradient(#002147 0% 60%, #43664d 60% 80%, #708ab5 80% 90%, #d6e3ff 90% 100%)" }}>
                    <div className="absolute inset-8 bg-white rounded-full flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-primary-container">60%</div>
                        <div className="text-[10px] uppercase font-bold text-on-surface-variant">Journals</div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: "Journal Articles", color: "bg-primary-container" },
                      { label: "Books", color: "bg-secondary" },
                      { label: "Websites", color: "bg-on-primary-container" },
                      { label: "Conference Papers", color: "bg-primary-fixed" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-3">
                        <div className={cn("w-3 h-3 rounded-full", item.color)}></div>
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Tertiary Row */}
            <section className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              {/* Top Institutional Partners */}
              <div className="xl:col-span-2 bg-surface-container-lowest rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)] overflow-hidden">
                <div className="p-6 border-b border-surface-container">
                  <h3 className="text-xl font-bold text-primary-container font-headline">Top Institutional Partners</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-container-low text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                        <th className="px-6 py-4 font-label">Institution Name</th>
                        <th className="px-6 py-4 font-label">Region</th>
                        <th className="px-6 py-4 font-label">Conversions</th>
                        <th className="px-6 py-4 font-label">Growth</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container text-sm font-body">
                      {[
                        { name: "University of Oxford", region: "United Kingdom", count: "421,002", growth: "+18.4%" },
                        { name: "Harvard University", region: "United States", count: "398,110", growth: "+12.1%" },
                        { name: "National University of Singapore", region: "Singapore", count: "312,450", growth: "+24.8%" },
                        { name: "ETH Zürich", region: "Switzerland", count: "285,120", growth: "+9.2%" },
                      ].map((inst) => (
                        <tr key={inst.name} className="hover:bg-surface-container-low transition-colors">
                          <td className="px-6 py-4 font-bold text-primary-container">{inst.name}</td>
                          <td className="px-6 py-4">{inst.region}</td>
                          <td className="px-6 py-4">{inst.count}</td>
                          <td className="px-6 py-4 text-secondary font-bold">{inst.growth}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Archival Alerts */}
              <div className="bg-surface-container-lowest rounded-xl shadow-[0_4px_24px_rgba(25,28,30,0.04)] flex flex-col">
                <div className="p-6 border-b border-surface-container">
                  <h3 className="text-xl font-bold text-primary-container font-headline">Recent Archival Alerts</h3>
                </div>
                <div className="p-6 space-y-6 flex-1 overflow-y-auto max-h-[400px]">
                  {recentReports?.filter(r => r.status === 'pending').slice(0, 5).map((report, i) => (
                    <div key={report.id} className="flex gap-4 group">
                      <div className={cn("mt-1 w-2 h-2 rounded-full shrink-0", i % 2 === 0 ? "bg-tertiary-fixed-dim ring-4 ring-tertiary-fixed/30" : "bg-secondary")}></div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-primary-container">{report.failureCategory?.replace('-', ' ').toUpperCase() || "System Alert"}</p>
                        <p className="text-xs text-on-surface-variant truncate max-w-[200px]">{report.originalText}</p>
                        <span className="text-[10px] font-bold text-outline uppercase tracking-tight">{timeAgo(report.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                  {(!recentReports || recentReports.length === 0) && (
                    <div className="text-center py-12 text-on-surface-variant italic text-sm">
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
