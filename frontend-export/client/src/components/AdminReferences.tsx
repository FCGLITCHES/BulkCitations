import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

interface ArchivalBatch {
  id: string;
  createdAt: string;
  status: string;
  request: {
    sourceType: string;
    content: string;
    outputStyle: string;
  };
  response?: {
    citations?: any[];
  };
  metadata?: {
    institutionName?: string;
    originalFilename?: string;
    institutionLogo?: string;
  };
}

interface BatchesResponse {
  jobs: ArchivalBatch[];
  total: number;
}

export default function AdminReferences() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All Health Status");
  const [page, setPage] = useState(0);
  const limit = 10;

  const { data, isLoading } = useQuery<BatchesResponse>({
    queryKey: ["/api/admin/references", search, status, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString(),
      });
      if (search) params.append("search", search);
      if (status !== "All Health Status") params.append("status", status);
      
      return adminFetch<BatchesResponse>(`/api/admin/references?${params.toString()}`);
    },
  });

  const batches = data?.jobs ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="min-h-screen bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#11161d] dark:text-slate-100 flex flex-col">
      <AdminHeader />

      <main className="flex-1 max-w-7xl mx-auto px-6 py-12 md:px-12 pt-28">
        {/* Editorial Header Section */}
        <header className="mb-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div className="space-y-2">
              <span className="text-slate-500 dark:text-slate-400 font-label text-xs font-black tracking-[0.1em] uppercase">Administrative Console</span>
              <h1 className="text-4xl md:text-5xl font-headline font-black text-[#0f4fa8] dark:text-blue-300 leading-tight">
                Reference Archive <br /> Management
              </h1>
            </div>
            {/* Toggle Switch */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full p-1 flex items-center shadow-sm">
              <button className="px-6 py-2 rounded-full text-sm font-black bg-slate-900 text-white dark:bg-blue-500 dark:text-slate-950 shadow-sm transition-all whitespace-nowrap">
                Individual Researchers
              </button>
              <button className="px-6 py-2 rounded-full text-sm font-bold text-slate-500 hover:text-[#0f4fa8] dark:hover:text-blue-300 transition-colors whitespace-nowrap">
                Institutional Batches
              </button>
            </div>
          </div>
        </header>

        {/* Search and Filter Bar */}
        <div className="mb-8 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-96 group">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#0f4fa8] dark:group-focus-within:text-blue-300 transition-colors">search</span>
            <input
              className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm focus:ring-2 focus:ring-[#0f4fa8]/10 dark:focus:ring-blue-300/10 transition-all text-sm placeholder:text-slate-400 dark:text-slate-100 outline-none"
              placeholder="Search by Job ID or Institution..."
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:flex-none">
              <select 
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="appearance-none w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 pr-10 text-sm font-bold text-slate-700 dark:text-slate-300 shadow-sm focus:ring-2 focus:ring-[#0f4fa8]/10 outline-none"
              >
                <option>All Health Status</option>
                <option>Ready</option>
                <option>Review</option>
                <option>Action Needed</option>
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">expand_more</span>
            </div>
            <button className="bg-[#002147] text-white font-bold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center gap-2 text-sm whitespace-nowrap active:scale-95">
              <span className="material-symbols-outlined text-[18px]">filter_list</span>
              Apply Filters
            </button>
          </div>
        </div>

        {/* High-Density Archive Table */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase">Job / Batch ID</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase">User / Institution</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase">Total Refs</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase">Date Processed</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase">Health</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                   [...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={6} className="px-6 py-8 h-16">
                        <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-full"></div>
                      </td>
                    </tr>
                  ))
                ) : batches.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center text-slate-500 italic">
                      No archival batches found matching criteria.
                    </td>
                  </tr>
                ) : (
                  batches.map((batch) => {
                    const health = batch.status === 'completed' ? 'Ready' : 'Review';
                    const date = new Date(batch.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                    
                    return (
                      <tr key={batch.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group">
                        <td className="px-6 py-5">
                          <span className="font-mono text-[10px] font-black text-[#0f4fa8] dark:text-blue-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded truncate block max-w-[120px]">
                            #{batch.id.slice(0, 8).toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700">
                              {batch.metadata?.institutionLogo ? (
                                <img className="w-full h-full object-cover" src={batch.metadata.institutionLogo} alt="Logo" />
                              ) : (
                                <span className="material-symbols-outlined text-slate-400 text-[18px]">devices</span>
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                                {batch.metadata?.institutionName || "Guest Researcher"}
                              </span>
                              {!batch.metadata?.institutionName && batch.metadata?.visitorId && (
                                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[150px]">
                                  ID: {batch.metadata.visitorId}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-sm text-slate-600 dark:text-slate-400 font-bold">
                          {batch.response?.citations?.length || 0}
                        </td>
                        <td className="px-6 py-5 text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-tighter">
                          {date}
                        </td>
                        <td className="px-6 py-5">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter",
                            health === "Ready" 
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" 
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          )}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", health === "Ready" ? "bg-emerald-500" : "bg-amber-500")}></span>
                            {health}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-[#0f4fa8] dark:text-blue-400 transition-colors" title="View Details">
                              <span className="material-symbols-outlined">visibility</span>
                            </button>
                            <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-[#0f4fa8] dark:text-blue-400 transition-colors" title="Re-export">
                              <span className="material-symbols-outlined">ios_share</span>
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
          {/* Pagination Footer */}
          <div className="px-6 py-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/30">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Showing <span className="text-slate-900 dark:text-slate-100">{batches.length}</span> of <span className="text-slate-900 dark:text-slate-100">{total}</span> archival batches
            </p>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-blue-500 dark:text-slate-950 font-black text-xs shadow-sm">
                {page + 1}
              </button>
              <button 
                onClick={() => setPage(page + 1)}
                disabled={batches.length < limit}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_right</span>
              </button>
            </div>
          </div>
        </div>

        {/* System Stats Cards (Asymmetric Bento) */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-[#002147] p-8 rounded-2xl text-white relative overflow-hidden group shadow-xl">
            <div className="relative z-10">
              <h3 className="font-headline text-2xl mb-2 font-black italic">Network Health Index</h3>
              <p className="text-blue-100/70 text-sm max-w-md mb-8 leading-relaxed">Current processing speed for high-density academic batches is operating at 98.4% efficiency across all nodes.</p>
              <div className="flex gap-12">
                <div>
                  <span className="block text-[10px] font-black uppercase tracking-widest text-blue-300/80 mb-2">Avg Process Time</span>
                  <span className="text-2xl font-black italic">1.2s <span className="text-sm font-bold opacity-60">/ ref</span></span>
                </div>
                <div>
                  <span className="block text-[10px] font-black uppercase tracking-widest text-blue-300/80 mb-2">Error Rate</span>
                  <span className="text-2xl font-black italic">0.02%</span>
                </div>
              </div>
            </div>
            {/* Abstract Decorative Element */}
            <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-white/5 rounded-full blur-3xl group-hover:bg-white/10 transition-all duration-700"></div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 p-8 rounded-2xl flex flex-col justify-between shadow-lg border-l-4 border-l-[#002147] dark:border-l-blue-500">
            <div>
              <span className="material-symbols-outlined text-[#0f4fa8] dark:text-blue-300 mb-4 text-3xl">analytics</span>
              <h4 className="font-black text-[#0f4fa8] dark:text-blue-300 uppercase tracking-widest text-xs">Quick Actions</h4>
            </div>
            <ul className="space-y-4 mt-6">
              <li>
                <button className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-[#0f4fa8] dark:hover:text-blue-300 flex items-center gap-2 transition-colors">
                  <span className="material-symbols-outlined text-[18px]">download_done</span>
                  Export Master Audit
                </button>
              </li>
              <li>
                <button className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-[#0f4fa8] dark:hover:text-blue-300 flex items-center gap-2 transition-colors">
                  <span className="material-symbols-outlined text-[18px]">sync</span>
                  Re-sync DOI Metadata
                </button>
              </li>
              <li>
                <button className="text-xs font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 hover:opacity-80 flex items-center gap-2 transition-colors">
                  <span className="material-symbols-outlined text-[18px]">cleaning_services</span>
                  Purge Stale Cache
                </button>
              </li>
            </ul>
          </div>
        </div>
      </main>
      
      <AdminFooter />
    </div>
  );
}
