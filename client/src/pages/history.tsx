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
    customName?: string;
}

interface BatchJob {
    id: string;
    timestamp: string;
    targetStyle: string;
    references: HistoryItem[];
    customName?: string;
}

export default function HistoryPage() {
    const [historyBatches, setHistoryBatches] = useState<BatchJob[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedBatch, setSelectedBatch] = useState<BatchJob | null>(null);
    const [showFullList, setShowFullList] = useState(false);
    const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
    const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
    const [tempName, setTempName] = useState("");

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
                        references: refs,
                        customName: refs.find(r => r.customName)?.customName
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
        if (confirm("Are you sure you want to clear your entire history? This action cannot be undone.")) {
            localStorage.removeItem("bulkcitations_history");
            setHistoryBatches([]);
            setSelectedBatchIds(new Set());
        }
    };

    const deleteBatches = (ids: Set<string>) => {
        const newBatches = historyBatches.filter(b => !ids.has(b.id));
        setHistoryBatches(newBatches);
        
        const allRefs = newBatches.flatMap(b => b.references);
        localStorage.setItem("bulkcitations_history", JSON.stringify(allRefs));
        
        const nextSelected = new Set(selectedBatchIds);
        ids.forEach(id => nextSelected.delete(id));
        setSelectedBatchIds(nextSelected);
    };

    const toggleSelection = (id: string) => {
        const next = new Set(selectedBatchIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelectedBatchIds(next);
    };

    const toggleSelectAll = () => {
        if (selectedBatchIds.size === filteredBatches.length && filteredBatches.length > 0) {
            setSelectedBatchIds(new Set());
        } else {
            setSelectedBatchIds(new Set(filteredBatches.map(b => b.id)));
        }
    };

    const renameBatch = (id: string, newName: string) => {
        const nameToSave = newName.trim();
        const updatedBatches = historyBatches.map(batch => {
            if (batch.id === id) {
                const updatedRefs = batch.references.map(ref => ({ ...ref, customName: nameToSave || undefined }));
                return { ...batch, references: updatedRefs, customName: nameToSave || undefined };
            }
            return batch;
        });
        setHistoryBatches(updatedBatches);
        
        const allRefs = updatedBatches.flatMap(b => b.references);
        localStorage.setItem("bulkcitations_history", JSON.stringify(allRefs));
        setEditingBatchId(null);
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

    const exportSelected = () => {
        const selectedBatches = historyBatches.filter(b => selectedBatchIds.has(b.id));
        const allRefs = selectedBatches.flatMap(b => b.references).map(r => r.convertedText).join("\n\n");
        if (!allRefs) return;
        const blob = new Blob([allRefs], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `bulkcitations_selected_export.txt`;
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
        <div className="bg-surface dark:bg-slate-950 text-on-surface dark:text-slate-100 min-h-screen flex flex-col font-body">
            <LandingNavbar />

            <main className="max-w-7xl mx-auto px-8 py-12 flex-1 w-full flex flex-col">
                <header className="mb-12">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-bold font-headline text-primary-container dark:text-blue-50 leading-tight tracking-tight mb-2">Conversion History</h1>
                            <p className="text-on-surface-variant dark:text-slate-400 max-w-xl">Review and manage your scholarly archives. Track citation health and re-export processed batches with clinical precision.</p>
                        </div>
                        {historyBatches.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <button 
                                    onClick={toggleSelectAll} 
                                    className="flex items-center gap-2 px-3.5 py-2 bg-surface-container dark:bg-slate-800 text-on-surface-variant dark:text-slate-400 rounded-lg font-semibold hover:bg-surface-variant dark:hover:bg-slate-700 transition-colors text-sm"
                                >
                                    <span className="material-symbols-outlined text-base">
                                        {selectedBatchIds.size === filteredBatches.length && filteredBatches.length > 0 ? "deselect" : "select_all"}
                                    </span>
                                    {selectedBatchIds.size === filteredBatches.length && filteredBatches.length > 0 ? "Deselect All" : "Select All"}
                                </button>
                                <button onClick={downloadAll} className="flex items-center gap-2 px-3.5 py-2 bg-secondary-container dark:bg-slate-800 text-on-secondary-container dark:text-blue-300 rounded-lg font-semibold hover:bg-secondary-fixed transition-colors text-sm">
                                    <span className="material-symbols-outlined text-base">download</span>
                                    Bulk Export
                                </button>
                                <button onClick={clearHistory} className="flex items-center gap-2 px-3.5 py-2 bg-error-container text-on-error-container rounded-lg font-semibold hover:opacity-90 transition-colors text-sm">
                                    <span className="material-symbols-outlined text-base">delete_sweep</span>
                                    Clear History
                                </button>
                            </div>
                        )}
                    </div>
                </header>

                {historyBatches.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 text-center">
                        <div className="bg-surface-container-low dark:bg-slate-900 rounded-full w-24 h-24 flex items-center justify-center mb-8">
                            <span className="material-symbols-outlined text-5xl text-on-surface-variant/40 dark:text-slate-700">history</span>
                        </div>
                        <h2 className="font-headline text-2xl font-bold text-primary dark:text-blue-300 mb-3">No Conversion History Yet</h2>
                        <p className="text-on-surface-variant dark:text-slate-400 max-md mb-8 leading-relaxed">
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
                                    className="w-full pl-12 pr-4 py-3 bg-surface-container-lowest dark:bg-slate-900 border-none rounded-xl shadow-sm focus:ring-2 focus:ring-primary-container transition-all placeholder:text-outline-variant dark:placeholder:text-slate-600 dark:text-slate-100" 
                                    placeholder="Find past jobs by style or date..." 
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
                                <span className="px-4 py-2 bg-primary-container text-white rounded-full text-sm font-medium whitespace-nowrap">All Jobs</span>
                                <span className="px-4 py-2 bg-surface-container dark:bg-slate-800 text-on-surface-variant dark:text-slate-400 rounded-full text-sm font-medium whitespace-nowrap hover:bg-surface-variant dark:hover:bg-slate-700 cursor-pointer">Last 30 Days</span>
                                <span className="px-4 py-2 bg-surface-container dark:bg-slate-800 text-on-surface-variant dark:text-slate-400 rounded-full text-sm font-medium whitespace-nowrap hover:bg-surface-variant dark:hover:bg-slate-700 cursor-pointer">Completed</span>
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
                                            className="bg-surface-container-lowest dark:bg-slate-900 p-6 rounded-xl flex flex-col md:flex-row items-center gap-6 shadow-sm border border-outline-variant/10 dark:border-slate-800 hover:shadow-md transition-shadow group"
                                        >
                                            <div className="flex items-center gap-6 w-full md:w-auto">
                                                <input 
                                                    type="checkbox" 
                                                    checked={selectedBatchIds.has(batch.id)}
                                                    onChange={() => toggleSelection(batch.id)}
                                                    className="w-5 h-5 rounded border-outline-variant text-primary-container focus:ring-primary-container cursor-pointer" 
                                                />
                                                <div className="min-w-[240px] flex flex-col justify-center">
                                                    <div className="flex items-center gap-2 group/title h-8">
                                                        {editingBatchId === batch.id ? (
                                                            <input 
                                                                autoFocus
                                                                className="text-lg font-headline font-bold text-primary-container dark:text-blue-100 bg-surface-container-high dark:bg-slate-800 border-none rounded px-2 py-0.5 w-full focus:ring-1 focus:ring-primary outline-none"
                                                                value={tempName}
                                                                onChange={(e) => setTempName(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') renameBatch(batch.id, tempName);
                                                                    if (e.key === 'Escape') setEditingBatchId(null);
                                                                }}
                                                                onBlur={() => renameBatch(batch.id, tempName)}
                                                            />
                                                        ) : (
                                                            <>
                                                                <h3 className="text-xl font-headline font-bold text-primary-container dark:text-blue-50 truncate max-w-[200px]">
                                                                    {batch.customName || `Conversion Batch (${historyBatches.length - index})`}
                                                                </h3>
                                                                <button 
                                                                    onClick={() => {
                                                                        setEditingBatchId(batch.id);
                                                                        setTempName(batch.customName || `Conversion Batch (${historyBatches.length - index})`);
                                                                    }}
                                                                    className="opacity-0 group-hover/title:opacity-100 transition-opacity p-1 text-on-surface-variant hover:text-primary"
                                                                >
                                                                    <span className="material-symbols-outlined text-base">edit</span>
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-on-surface-variant dark:text-slate-400">{dateStr} • {timeStr}</p>
                                                </div>
                                            </div>

                                            <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-8 w-full">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase tracking-wider text-outline dark:text-slate-500 font-bold mb-1">References</span>
                                                    <span className="font-semibold dark:text-slate-200">{batch.references.length} refs</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase tracking-wider text-outline dark:text-slate-500 font-bold mb-1">Target Style</span>
                                                    <span className="font-semibold dark:text-slate-200">{batch.targetStyle}</span>
                                                </div>
                                                <div className="col-span-2 flex flex-col">
                                                    <span className="text-[10px] uppercase tracking-wider text-outline dark:text-slate-500 font-bold mb-1">Reference Health</span>
                                                    <div className="flex gap-2">
                                                        <span className="flex items-center gap-1 px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 text-xs font-bold rounded-full border border-emerald-200/50 dark:border-emerald-800/20">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400"></span> {health.ready} Ready
                                                        </span>
                                                        {batch.references.length - health.ready > 0 && (
                                                            <span className="flex items-center gap-1 px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 text-xs font-bold rounded-full border border-red-200/50 dark:border-red-800/20">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-red-600 dark:bg-red-400"></span> {batch.references.length - health.ready} Action Needed
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 w-full md:w-auto">
                                                <Sheet onOpenChange={(open) => { if (!open) setShowFullList(false); }}>
                                                    <SheetTrigger asChild>
                                                        <button 
                                                            onClick={() => setSelectedBatch(batch)}
                                                            className="flex-1 md:flex-none px-4 py-2 text-primary-container dark:text-blue-300 font-semibold hover:bg-surface-container dark:hover:bg-slate-800 rounded-lg transition-colors"
                                                        >
                                                            Details
                                                        </button>
                                                    </SheetTrigger>
                                                    <SheetContent className="w-full sm:max-w-md bg-white dark:bg-slate-950 border-l border-outline-variant/20 dark:border-slate-800 shadow-2xl p-0 flex flex-col h-full overflow-hidden">
                                                        <div className="p-6 pb-2 bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
                                                            <SheetHeader>
                                                                <SheetTitle className="text-2xl font-headline font-bold text-[#002147] dark:text-blue-50">Job Details</SheetTitle>
                                                            </SheetHeader>
                                                        </div>
                                                        
                                                        <div className="flex-1 overflow-y-auto px-6 py-4">
                                                            {selectedBatch && (() => {
                                                                const selHealth = calculateHealth(selectedBatch);
                                                                return (
                                                                    <div className="space-y-8 font-body text-on-surface dark:text-slate-200">
                                                                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                                            <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold block mb-2 font-headline">Summary Statistics</span>
                                                                            <div className="grid grid-cols-2 gap-4">
                                                                                <div className="bg-slate-100/70 dark:bg-slate-900/50 p-4 rounded-lg flex flex-col justify-center border border-slate-200/50 dark:border-slate-800">
                                                                                    <span className="text-3xl font-bold text-[#002147] dark:text-blue-50 mb-0.5 font-headline">{selectedBatch.references.length}</span>
                                                                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Total Citations</span>
                                                                                </div>
                                                                                <div className="bg-emerald-100/50 dark:bg-emerald-900/20 p-4 rounded-lg flex flex-col justify-center border border-emerald-200/50 dark:border-emerald-800/20">
                                                                                    <span className="text-3xl font-bold text-emerald-800 dark:text-emerald-400 mb-0.5 font-headline">{selHealth.score}%</span>
                                                                                    <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">Health Score</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                                                                            <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold block mb-4 font-headline">Resolved {selectedBatch.targetStyle} Issues</span>
                                                                            <ul className="space-y-4 pr-2">
                                                                                {selectedBatch.references.slice(0, showFullList ? undefined : 7).map((ref, i) => (
                                                                                    <li key={i} className="flex items-start gap-3 transition-opacity duration-200">
                                                                                        <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400 text-sm mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                                                                                        <div className="flex-1 overflow-hidden">
                                                                                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 line-clamp-1 font-headline">{ref.convertedText || ref.originalText}</p>
                                                                                            <p className="text-xs text-slate-500 dark:text-slate-400 italic line-clamp-1">Successfully formatted to {selectedBatch.targetStyle}</p>
                                                                                        </div>
                                                                                    </li>
                                                                                ))}
                                                                                {selectedBatch.references.length > 7 && !showFullList && (
                                                                                    <li className="text-xs text-center text-slate-400 dark:text-slate-500 italic mt-4 bg-slate-50 dark:bg-slate-900/50 py-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 font-headline">
                                                                                        + {selectedBatch.references.length - 7} more references
                                                                                    </li>
                                                                                )}
                                                                            </ul>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>

                                                        {selectedBatch && (
                                                            <div className="p-6 border-t dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-md flex flex-col gap-3 shadow-[0_-8px_30px_rgb(0,0,0,0.04)] sticky bottom-0">
                                                                <button 
                                                                    onClick={() => downloadExport(selectedBatch)}
                                                                    className="w-full py-3.5 bg-[#002147] dark:bg-blue-600 hover:bg-[#002147]/90 dark:hover:bg-blue-500 text-white font-bold rounded-lg transition-all text-sm shadow-md hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 font-body"
                                                                >
                                                                    <span className="material-symbols-outlined text-lg">download</span>
                                                                    Download {selectedBatch.targetStyle} Export
                                                                </button>
                                                                <button 
                                                                    onClick={() => setShowFullList(!showFullList)}
                                                                    className="w-full py-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-[#002147] dark:text-blue-100 font-bold rounded-lg transition-all text-sm shadow-sm hover:shadow-md active:scale-[0.98] flex items-center justify-center gap-2 font-body"
                                                                >
                                                                    <span className="material-symbols-outlined text-lg">
                                                                        {showFullList ? "expand_less" : "expand_more"}
                                                                    </span>
                                                                    {showFullList ? "Show Less" : "View Full Reference List"}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </SheetContent>
                                                </Sheet>
                                                <button 
                                                    onClick={() => downloadExport(batch)}
                                                    className="flex-1 md:flex-none px-4 py-2 bg-primary-container text-white font-semibold rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
                                                >
                                                    Export
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        if (confirm("Delete this batch?")) {
                                                            deleteBatches(new Set([batch.id]));
                                                        }
                                                    }}
                                                    className="p-2 text-on-error-container bg-error-container/20 hover:bg-error-container/40 rounded-lg transition-colors group-hover:opacity-100 md:opacity-0"
                                                    title="Delete batch"
                                                >
                                                    <span className="material-symbols-outlined text-lg">delete</span>
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

                        <AnimatePresence>
                            {selectedBatchIds.size > 0 && (
                                <motion.div 
                                    initial={{ y: 100, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    exit={{ y: 100, opacity: 0 }}
                                    className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-primary-container dark:bg-blue-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-6 backdrop-blur-md border border-white/10 w-max"
                                >
                                    <div className="flex items-center gap-3 pr-6 border-r border-white/20">
                                        <span className="bg-white/20 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs">
                                            {selectedBatchIds.size}
                                        </span>
                                        <span className="font-semibold text-xs tracking-wide">Selected Items</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={exportSelected}
                                            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-white/10 rounded-lg transition-colors text-xs font-bold"
                                        >
                                            <span className="material-symbols-outlined text-base">download</span>
                                            Export
                                        </button>
                                        <button 
                                            onClick={() => {
                                                if (confirm(`Delete ${selectedBatchIds.size} selected items?`)) {
                                                    deleteBatches(selectedBatchIds);
                                                }
                                            }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-error-container text-on-error-container rounded-lg transition-colors text-xs font-bold"
                                        >
                                            <span className="material-symbols-outlined text-base">delete</span>
                                            Delete
                                        </button>
                                        <button 
                                            onClick={() => setSelectedBatchIds(new Set())}
                                            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-white/10 rounded-lg transition-colors text-xs font-bold text-white/70"
                                        >
                                            <span className="material-symbols-outlined text-base">close</span>
                                            Clear
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
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
