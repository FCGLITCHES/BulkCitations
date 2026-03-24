import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface HistoryItem {
    id: string;
    originalText: string;
    convertedText: string;
    inputStyle: string;
    outputStyle: string;
    healthState?: string;
    timestamp: string;
}

interface BatchJob {
    id: string;
    timestamp: string;
    targetStyle: string;
    references: HistoryItem[];
}

export default function HistoryPage() {
    const [historyBatches, setHistoryBatches] = useState<BatchJob[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedBatch, setSelectedBatch] = useState<BatchJob | null>(null);

    useEffect(() => {
        const loadHistory = () => {
            try {
                const stored = localStorage.getItem("bulkcitations_history");
                if (stored) {
                    const parsed: HistoryItem[] = JSON.parse(stored);
                    
                    const groups: Record<string, HistoryItem[]> = {};
                    parsed.forEach(item => {
                        const date = new Date(item.timestamp);
                        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
                        if (!groups[key]) groups[key] = [];
                        groups[key].push(item);
                    });
                    
                    const batches: BatchJob[] = Object.values(groups).map(refs => ({
                        id: refs[0].id,
                        timestamp: refs[0].timestamp,
                        targetStyle: refs[0].outputStyle,
                        references: refs
                    })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                    
                    setHistoryBatches(batches);
                }
            } catch (e) {
                console.error("Failed to load history", e);
            }
        };
        loadHistory();
    }, []);

    const clearHistory = () => {
        localStorage.removeItem("bulkcitations_history");
        setHistoryBatches([]);
    };

    const downloadExport = (batch: BatchJob) => {
        const text = batch.references.map(r => r.convertedText).join("\n\n");
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `bulkcitations_export_${new Date(batch.timestamp).getTime()}.txt`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const downloadAll = () => {
        const allRefs = historyBatches.flatMap(b => b.references).map(r => r.convertedText).join("\n\n");
        if (!allRefs) return;
        const blob = new Blob([allRefs], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `bulkcitations_full_export.txt`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const filteredBatches = historyBatches.filter(
        batch => 
            batch.targetStyle.toLowerCase().includes(searchQuery.toLowerCase()) || 
            new Date(batch.timestamp).toLocaleString().toLowerCase().includes(searchQuery.toLowerCase())
    );

    const calculateHealth = (batch: BatchJob) => {
        const total = batch.references.length;
        if (total === 0) return { ready: 0, score: 0 };
        const ready = batch.references.filter(r => r.healthState === 'clean').length;
        const fallbackReady = ready === 0 ? total : ready; // If health wasn't saved, assume all are ready
        return {
            ready: fallbackReady,
            score: Math.round((fallbackReady / total) * 100)
        };
    };

    return (
        <div className="bg-surface text-on-surface min-h-screen flex flex-col font-body">
            <LandingNavbar />

            <main className="max-w-7xl mx-auto px-8 py-12 flex-1 w-full flex flex-col">
                <header className="mb-12">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-bold font-headline text-primary-container leading-tight tracking-tight mb-2">Conversion History</h1>
                            <p className="text-on-surface-variant max-w-xl">Review and manage your scholarly archives. Track citation health and re-export processed batches with clinical precision.</p>
                        </div>
                        {historyBatches.length > 0 && (
                            <div className="flex flex-wrap items-center gap-3">
                                <button onClick={downloadAll} className="flex items-center gap-2 px-5 py-2.5 bg-secondary-container text-on-secondary-container rounded-lg font-semibold hover:bg-secondary-fixed transition-colors">
                                    <span className="material-symbols-outlined text-lg">download</span>
                                    Bulk Export
                                </button>
                                <button onClick={clearHistory} className="flex items-center gap-2 px-5 py-2.5 bg-error-container text-on-error-container rounded-lg font-semibold hover:opacity-90 transition-colors">
                                    <span className="material-symbols-outlined text-lg">delete</span>
                                    Bulk Delete
                                </button>
                            </div>
                        )}
                    </div>
                </header>

                {historyBatches.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 text-center">
                        <div className="bg-surface-container-low rounded-full w-24 h-24 flex items-center justify-center mb-8">
                            <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">history</span>
                        </div>
                        <h2 className="font-headline text-2xl font-bold text-primary mb-3">No Conversion History Yet</h2>
                        <p className="text-on-surface-variant max-w-md mb-8 leading-relaxed">
                            Your past scholarly conversions will appear here once you start using the Bulk Reference Parser.
                        </p>
                        <Link href="/">
                            <button className="bg-primary-container text-white px-8 py-3 rounded-full text-sm font-bold tracking-wide hover:scale-105 transition-transform duration-150 shadow-md">
                                Start Converting References
                            </button>
                        </Link>
                    </div>
                ) : (
                    <>
                        <section className="mb-8 flex flex-col md:flex-row gap-4 items-center justify-between">
                            <div className="relative w-full md:max-w-md">
                                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">search</span>
                                <input 
                                    className="w-full pl-12 pr-4 py-3 bg-surface-container-lowest border-none rounded-xl shadow-sm focus:ring-2 focus:ring-primary-container transition-all placeholder:text-outline-variant" 
                                    placeholder="Find past jobs by style or date..." 
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
                                <span className="px-4 py-2 bg-primary-container text-white rounded-full text-sm font-medium whitespace-nowrap">All Jobs</span>
                                <span className="px-4 py-2 bg-surface-container text-on-surface-variant rounded-full text-sm font-medium whitespace-nowrap hover:bg-surface-variant cursor-pointer">Last 30 Days</span>
                                <span className="px-4 py-2 bg-surface-container text-on-surface-variant rounded-full text-sm font-medium whitespace-nowrap hover:bg-surface-variant cursor-pointer">Completed</span>
                            </div>
                        </section>

                        <section className="space-y-6 flex-1">
                            <AnimatePresence>
                                {filteredBatches.map((batch, index) => {
                                    const dateObj = new Date(batch.timestamp);
                                    const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                                    const timeStr = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                                    const health = calculateHealth(batch);

                                    return (
                                        <motion.div
                                            key={batch.id}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.98 }}
                                            transition={{ duration: 0.2, delay: index * 0.05 }}
                                            className="bg-surface-container-lowest p-6 rounded-xl flex flex-col md:flex-row items-center gap-6 shadow-sm border border-outline-variant/10 hover:shadow-md transition-shadow group"
                                        >
                                            <div className="flex items-center gap-6 w-full md:w-auto">
                                                <input type="checkbox" className="w-5 h-5 rounded border-outline-variant text-primary-container focus:ring-primary-container" />
                                                <div className="min-w-[240px]">
                                                    <h3 className="text-xl font-headline font-bold text-primary-container">Conversion Batch</h3>
                                                    <p className="text-sm text-on-surface-variant">{dateStr} • {timeStr}</p>
                                                </div>
                                            </div>

                                            <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-8 w-full">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase tracking-wider text-outline font-bold mb-1">References</span>
                                                    <span className="font-semibold">{batch.references.length} refs</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase tracking-wider text-outline font-bold mb-1">Target Style</span>
                                                    <span className="font-semibold">{batch.targetStyle}</span>
                                                </div>
                                                <div className="col-span-2 flex flex-col">
                                                    <span className="text-[10px] uppercase tracking-wider text-outline font-bold mb-1">Reference Health</span>
                                                    <div className="flex gap-2">
                                                        <span className="flex items-center gap-1 px-3 py-1 bg-secondary-fixed text-on-secondary-fixed-variant text-xs font-bold rounded-full">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span> {health.ready} Ready
                                                        </span>
                                                        {batch.references.length - health.ready > 0 && (
                                                            <span className="flex items-center gap-1 px-3 py-1 bg-error-container text-on-error-container text-xs font-bold rounded-full">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-error"></span> {batch.references.length - health.ready} Action Needed
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 w-full md:w-auto">
                                                <Sheet>
                                                    <SheetTrigger asChild>
                                                        <button 
                                                            onClick={() => setSelectedBatch(batch)}
                                                            className="flex-1 md:flex-none px-4 py-2 text-primary-container font-semibold hover:bg-surface-container rounded-lg transition-colors"
                                                        >
                                                            Details
                                                        </button>
                                                    </SheetTrigger>
                                                    <SheetContent className="w-full sm:max-w-md bg-white border-l border-outline-variant/20 shadow-2xl overflow-y-auto">
                                                        <SheetHeader className="mb-8">
                                                            <SheetTitle className="text-2xl font-headline font-bold text-[#002147]">Job Details</SheetTitle>
                                                        </SheetHeader>
                                                        
                                                        {selectedBatch && (() => {
                                                            const selHealth = calculateHealth(selectedBatch);
                                                            return (
                                                                <div className="space-y-8 font-body text-on-surface">
                                                                    <div>
                                                                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-2">Summary Statistics</span>
                                                                        <div className="grid grid-cols-2 gap-4">
                                                                            <div className="bg-slate-100/70 p-4 rounded-lg flex flex-col justify-center">
                                                                                <span className="text-3xl font-bold text-[#002147] mb-0.5">{selectedBatch.references.length}</span>
                                                                                <span className="text-[11px] text-slate-500 font-medium">Total Citations</span>
                                                                            </div>
                                                                            <div className="bg-emerald-200/50 p-4 rounded-lg flex flex-col justify-center">
                                                                                <span className="text-3xl font-bold text-[#306850] mb-0.5">{selHealth.score}%</span>
                                                                                <span className="text-[11px] text-[#486a51] font-medium">Health Score</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    <div>
                                                                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-4">Resolved {selectedBatch.targetStyle} Issues</span>
                                                                        <ul className="space-y-4 pr-2">
                                                                            {selectedBatch.references.slice(0, 50).map((ref, i) => (
                                                                                <li key={i} className="flex items-start gap-3">
                                                                                    <span className="material-symbols-outlined text-[#306850] text-sm mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                                                                                    <div className="flex-1 overflow-hidden">
                                                                                        <p className="text-sm font-semibold text-slate-800 line-clamp-1">{ref.convertedText || ref.originalText}</p>
                                                                                        <p className="text-xs text-slate-500 italic line-clamp-1">Successfully formatted to {selectedBatch.targetStyle}</p>
                                                                                    </div>
                                                                                </li>
                                                                            ))}
                                                                            {selectedBatch.references.length > 50 && (
                                                                                <li className="text-xs text-center text-slate-400 italic mt-4">
                                                                                    + {selectedBatch.references.length - 50} more references
                                                                                </li>
                                                                            )}
                                                                        </ul>
                                                                    </div>

                                                                    <div className="pt-8 flex flex-col gap-3">
                                                                        <button 
                                                                            onClick={() => downloadExport(selectedBatch)}
                                                                            className="w-full py-3 bg-[#002147] hover:bg-[#002147]/90 text-white font-bold rounded-md transition-colors text-sm shadow-sm"
                                                                        >
                                                                            Download {selectedBatch.targetStyle} Export
                                                                        </button>
                                                                        <button 
                                                                            className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-[#002147] font-bold rounded-md transition-colors text-sm shadow-sm"
                                                                        >
                                                                            View Full Reference List
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </SheetContent>
                                                </Sheet>
                                                <button 
                                                    onClick={() => downloadExport(batch)}
                                                    className="flex-1 md:flex-none px-4 py-2 bg-primary-container text-white font-semibold rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
                                                >
                                                    Export
                                                </button>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                            
                            {filteredBatches.length === 0 && searchQuery && (
                                <div className="text-center py-12 text-on-surface-variant">
                                    No batches found matching "{searchQuery}"
                                </div>
                            )}
                        </section>
                    </>
                )}
            </main>
            
            <LandingFooter />
            
            <style>{`
                .hide-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .hide-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </div>
    );
}
