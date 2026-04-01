import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { CitationEditor } from "./CitationEditor";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ChevronDown, 
  ChevronUp, 
  AlertCircle, 
  CheckCircle2, 
  Wrench,
  Search,
  Filter,
  History,
  Settings2,
} from "lucide-react";

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
    visitorId?: string;
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
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [editingCitation, setEditingCitation] = useState<{
    citation: any;
    jobId: string;
    index: number;
  } | null>(null);

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

  const getBatchHealth = (batch: ArchivalBatch) => {
    const citations = batch.response?.citations ?? [];
    if (citations.length === 0) return { label: 'Empty', color: 'bg-slate-200 text-slate-600', dot: 'bg-slate-400' };
    
    // Count buckets for high-fidelity summary
    const actionNeededCount = citations.filter(c => c.quality?.bucket === 'action_needed').length;
    const reviewNeededCount = citations.filter(c => c.quality?.bucket === 'worth_reviewing').length;

    if (actionNeededCount > 0) {
      return { 
        label: `${actionNeededCount} Action Needed`, 
        color: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400', 
        dot: 'bg-rose-500' 
      };
    }
    if (reviewNeededCount > 0) {
      return { 
        label: `${reviewNeededCount} Review`, 
        color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400', 
        dot: 'bg-amber-500' 
      };
    }
    
    return { label: 'Ready', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400', dot: 'bg-emerald-500' };
  };

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
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-[#0f4fa8] dark:group-focus-within:text-blue-300 transition-colors" />
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
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none h-5 w-5 text-slate-400" />
            </div>
            <button className="bg-[#002147] text-white font-bold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center gap-2 text-sm whitespace-nowrap active:scale-95">
              <Filter className="h-4 w-4" />
              Apply Filters
            </button>
          </div>
        </div>

        {/* High-Density Archive Table */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase border-b border-slate-100 dark:border-slate-800">Job / Batch ID</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase border-b border-slate-100 dark:border-slate-800">User / Institution</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase border-b border-slate-100 dark:border-slate-800">Total Refs</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase border-b border-slate-100 dark:border-slate-800">Date Processed</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase border-b border-slate-100 dark:border-slate-800">Health Summary</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-500 dark:text-slate-400 tracking-widest uppercase text-right border-b border-slate-100 dark:border-slate-800">Actions</th>
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
                    const health = getBatchHealth(batch);
                    const date = new Date(batch.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                    const isExpanded = expandedBatchId === batch.id;

                    return (
                      <React.Fragment key={batch.id}>
                        <tr className={cn(
                          "hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group cursor-pointer",
                          isExpanded && "bg-slate-50/80 dark:bg-slate-800/80"
                        )} onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}>
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
                              health.color
                            )}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", health.dot)}></span>
                              {health.label}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isExpanded ? (
                                <ChevronUp className="h-5 w-5 text-[#0f4fa8] dark:text-blue-400" />
                              ) : (
                                <ChevronDown className="h-5 w-5 text-slate-400 group-hover:text-[#0f4fa8] dark:group-hover:text-blue-400 transition-colors" />
                              )}
                            </div>
                          </td>
                        </tr>
                        
                        {/* Expandable Citation Inspection Area */}
                        {isExpanded && (
                          <tr className="bg-slate-50/40 dark:bg-slate-900/50">
                            <td colSpan={6} className="px-8 py-6 border-b border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2 duration-300">
                              <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-blue-500">list_alt</span>
                                    <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Archival Content Inspection</h4>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <Badge variant="outline" className="text-[10px] uppercase font-bold text-slate-400">
                                      {batch.request.sourceType}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] uppercase font-bold text-slate-400">
                                      Style: {batch.request.outputStyle}
                                    </Badge>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 gap-3">
                                  {(batch.response?.citations ?? []).map((citation, idx) => {
                                    const cBucket = citation.quality?.bucket;
                                    const isAction = cBucket === 'action_needed';
                                    const isReview = cBucket === 'worth_reviewing';
                                    
                                    return (
                                      <div 
                                        key={idx} 
                                        className={cn(
                                          "flex items-center justify-between p-4 rounded-xl border transition-all",
                                          isAction 
                                            ? "bg-rose-50/50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-900/30 shadow-sm" 
                                            : isReview
                                              ? "bg-amber-50/50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30"
                                              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                        )}
                                      >
                                        <div className="flex items-center gap-4 flex-1 min-w-0">
                                          <div className="w-8 h-8 flex items-center justify-center shrink-0">
                                            {isAction ? (
                                              <AlertCircle className="h-5 w-5 text-rose-500" />
                                            ) : isReview ? (
                                              <AlertCircle className="h-5 w-5 text-amber-500" />
                                            ) : (
                                              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                            )}
                                          </div>
                                          <div className="flex flex-col min-w-0 pr-4">
                                            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate opacity-60">
                                               {citation.raw}
                                            </span>
                                            <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                              {citation.rendered?.formatted || "Processing..."}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-4 shrink-0">
                                          {citation.is_manually_corrected && (
                                            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-[9px] font-black uppercase">
                                              Fixed
                                            </Badge>
                                          )}
                                          <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            className={cn(
                                              "h-8 px-3 gap-2 font-black text-[10px] uppercase tracking-widest transition-all",
                                              isAction 
                                                ? "bg-rose-500 text-white hover:bg-rose-600 shadow-md" 
                                                : "text-slate-500 hover:bg-slate-100"
                                            )}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingCitation({ citation, jobId: batch.id, index: idx });
                                            }}
                                          >
                                            <Wrench className="h-3 w-3" />
                                            {isAction ? "Fix Citation" : "Edit"}
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
                <ChevronDown className="rotate-90 h-5 w-5" />
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-blue-500 dark:text-slate-950 font-black text-xs shadow-sm">
                {page + 1}
              </button>
              <button 
                onClick={() => setPage(page + 1)}
                disabled={batches.length < limit}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronDown className="-rotate-90 h-5 w-5" />
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
              <History className="h-8 w-8 text-[#0f4fa8] dark:text-blue-300 mb-4" />
              <h4 className="font-black text-[#0f4fa8] dark:text-blue-300 uppercase tracking-widest text-xs">Quick Actions</h4>
            </div>
            <ul className="space-y-4 mt-6">
              <li>
                <button className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-[#0f4fa8] dark:hover:text-blue-300 flex items-center gap-2 transition-colors">
                  <CheckCircle2 className="h-4 w-4" />
                  Export Master Audit
                </button>
              </li>
              <li>
                <button className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-[#0f4fa8] dark:hover:text-blue-300 flex items-center gap-2 transition-colors">
                  <Settings2 className="h-4 w-4" />
                  Re-sync DOI Metadata
                </button>
              </li>
              <li>
                <button className="text-xs font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 hover:opacity-80 flex items-center gap-2 transition-colors">
                  <AlertCircle className="h-4 w-4" />
                  Purge Stale Cache
                </button>
              </li>
            </ul>
          </div>
        </div>
      </main>
      
      {/* Citation Repair Modal */}
      {editingCitation && (
        <CitationEditor 
          isOpen={true}
          onClose={() => setEditingCitation(null)}
          citation={editingCitation.citation}
          jobId={editingCitation.jobId}
          index={editingCitation.index}
        />
      )}

      <AdminFooter />
    </div>
  );
}
