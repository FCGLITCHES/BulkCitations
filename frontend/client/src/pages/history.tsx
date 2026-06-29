import { useState, useEffect, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    getHistorySnapshotStoreSnapshot,
    getHistorySyncStateSnapshot,
    loadHistorySnapshot,
    saveHistorySnapshot,
    subscribeHistorySnapshot,
    subscribeHistorySyncState,
} from "@/lib/history-sync";
import { useUserSession } from "@/hooks/use-user-session";
import { ChevronDown, Database, Download, FileCode, FileText } from "lucide-react";

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

type HistoryExportFormat = "txt" | "pdf" | "bib" | "ris";

function groupHistoryIntoBatches(items: HistoryItem[]) {
    const groups = new Map<string, HistoryItem[]>();
    items.forEach((item) => {
        const date = new Date(item.timestamp);
        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
        const existing = groups.get(key);
        if (existing) {
            existing.push(item);
            return;
        }
        groups.set(key, [item]);
    });

    return Array.from(groups.values())
        .map((references) => ({
            id: references[0].id,
            timestamp: references[0].timestamp,
            targetStyle: references[0].outputStyle,
            references,
            customName: references.find((reference) => reference.customName)?.customName,
        }))
        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

export default function HistoryPage() {
    const { isAuthenticated, isInitialized } = useUserSession();
    const historySyncState = useSyncExternalStore(
        subscribeHistorySyncState,
        getHistorySyncStateSnapshot,
        getHistorySyncStateSnapshot,
    );
    const historyItems = useSyncExternalStore(
        subscribeHistorySnapshot,
        getHistorySnapshotStoreSnapshot,
        getHistorySnapshotStoreSnapshot,
    ) as HistoryItem[];
    const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
    const [showFullList, setShowFullList] = useState(false);
    const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
    const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
    const [tempName, setTempName] = useState("");
    const historyBatches = isAuthenticated ? groupHistoryIntoBatches(historyItems) : [];
    const selectedBatch = selectedBatchId
        ? historyBatches.find((batch) => batch.id === selectedBatchId) ?? null
        : null;

    useEffect(() => {
        if (!isInitialized) {
            return;
        }
        if (!isAuthenticated) {
            setSelectedBatchId(null);
            setSelectedBatchIds(new Set());
            return;
        }
        void loadHistorySnapshot().catch((error) => {
            console.error("Failed to load history", error);
        });
    }, [isInitialized, isAuthenticated]);

    useEffect(() => {
        if (selectedBatchId && !historyBatches.some((batch) => batch.id === selectedBatchId)) {
            setSelectedBatchId(null);
            setShowFullList(false);
        }
    }, [historyBatches, selectedBatchId]);

    const clearHistory = () => {
        if (confirm("Are you sure you want to clear your entire history? This action cannot be undone.")) {
            setSelectedBatchId(null);
            setSelectedBatchIds(new Set());
            void saveHistorySnapshot([]);
        }
    };

    const deleteBatches = (ids: Set<string>) => {
        const newBatches = historyBatches.filter(b => !ids.has(b.id));
        const allRefs = newBatches.flatMap(b => b.references);
        void saveHistorySnapshot(allRefs);

        const nextSelected = new Set(selectedBatchIds);
        ids.forEach(id => nextSelected.delete(id));
        setSelectedBatchIds(nextSelected);
        if (selectedBatchId && ids.has(selectedBatchId)) {
            setSelectedBatchId(null);
            setShowFullList(false);
        }
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
        if (selectedBatchIds.size === visibleBatches.length && visibleBatches.length > 0) {
            setSelectedBatchIds(new Set());
        } else {
            setSelectedBatchIds(new Set(visibleBatches.map(b => b.id)));
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

        const allRefs = updatedBatches.flatMap(b => b.references);
        void saveHistorySnapshot(allRefs);
        setEditingBatchId(null);
    };

    const exportHistoryItems = async (
        items: HistoryItem[],
        format: HistoryExportFormat,
        fileStem: string,
    ) => {
        if (items.length === 0) return;

        if (format === "txt") {
            downloadTextFile(
                items.map((item) => item.convertedText).join("\n\n"),
                `${fileStem}.txt`,
                "text/plain;charset=utf-8",
            );
            return;
        }

        if (format === "bib") {
            downloadTextFile(
                items.map((item, index) => toBibtexEntry(item, index)).join("\n\n"),
                `${fileStem}.bib`,
                "text/x-bibtex;charset=utf-8",
            );
            return;
        }

        if (format === "ris") {
            downloadTextFile(
                items.map((item, index) => toRisEntry(item, index)).join("\n\n"),
                `${fileStem}.ris`,
                "application/x-research-info-systems;charset=utf-8",
            );
            return;
        }

        try {
            const { default: jsPDF } = await import("jspdf");
            const pdf = new jsPDF();
            const pageHeight = pdf.internal.pageSize.height;
            const margin = 20;
            let yPosition = margin;

            pdf.setFontSize(16);
            pdf.text("Conversion History Export", margin, yPosition);
            yPosition += 15;
            pdf.setFontSize(11);

            items.forEach((item, index) => {
                const lines = pdf.splitTextToSize(
                    `${index + 1}. ${item.convertedText}`,
                    pdf.internal.pageSize.width - 2 * margin,
                );
                if (yPosition + (lines.length * 6) > pageHeight - margin) {
                    pdf.addPage();
                    yPosition = margin;
                }
                pdf.text(lines, margin, yPosition);
                yPosition += lines.length * 6 + 4;
            });

            pdf.save(`${fileStem}.pdf`);
        } catch (error) {
            console.error("Failed to export history PDF", error);
        }
    };

    const exportBatch = async (batch: BatchJob, format: HistoryExportFormat) => {
        await exportHistoryItems(
            batch.references,
            format,
            buildHistoryExportFileStem(batch.customName || `conversion_batch_${new Date(batch.timestamp).getTime()}`),
        );
    };

    const exportAll = async (format: HistoryExportFormat) => {
        await exportHistoryItems(
            historyBatches.flatMap((batch) => batch.references),
            format,
            "bulkcitations_full_export",
        );
    };

    const exportSelected = async (format: HistoryExportFormat) => {
        const selectedBatches = historyBatches.filter((batch) => selectedBatchIds.has(batch.id));
        await exportHistoryItems(
            selectedBatches.flatMap((batch) => batch.references),
            format,
            "bulkcitations_selected_export",
        );
    };

    const visibleBatches = historyBatches;

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

    const syncStatus = historySyncState.status;
    const syncStatusConfig = {
        synced: {
            label: "Synced",
            dotClassName: "bg-emerald-500",
            textClassName: "text-emerald-800 dark:text-emerald-300",
            bgClassName: "bg-emerald-100 dark:bg-emerald-950/40",
            borderClassName: "border-emerald-200 dark:border-emerald-900/60",
        },
        syncing: {
            label: "Syncing",
            dotClassName: "bg-amber-500",
            textClassName: "text-amber-900 dark:text-amber-200",
            bgClassName: "bg-amber-100 dark:bg-amber-950/40",
            borderClassName: "border-amber-200 dark:border-amber-900/60",
        },
        offline: {
            label: "Offline",
            dotClassName: "bg-red-500",
            textClassName: "text-red-800 dark:text-red-300",
            bgClassName: "bg-red-100 dark:bg-red-950/40",
            borderClassName: "border-red-200 dark:border-red-900/60",
        },
    }[syncStatus];

    return (
        <div className="bg-surface dark:bg-slate-950 text-on-surface dark:text-slate-100 min-h-screen flex flex-col font-body">
            <LandingNavbar />

            <main className="max-w-7xl mx-auto px-8 py-12 flex-1 w-full flex flex-col">
                <header className="mb-12">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-bold font-headline text-primary-container dark:text-blue-50 leading-tight tracking-tight mb-2">Conversion History</h1>
                        </div>
                        {historyBatches.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <button 
                                    onClick={toggleSelectAll} 
                                    className="flex items-center gap-2 px-3.5 py-2 bg-surface-container dark:bg-slate-800 text-on-surface-variant dark:text-slate-400 rounded-lg font-semibold hover:bg-surface-variant dark:hover:bg-slate-700 transition-colors text-sm"
                                >
                                    <span className="material-symbols-outlined text-base">
                                        {selectedBatchIds.size === visibleBatches.length && visibleBatches.length > 0 ? "deselect" : "select_all"}
                                    </span>
                                    {selectedBatchIds.size === visibleBatches.length && visibleBatches.length > 0 ? "Deselect All" : "Select All"}
                                </button>
                                <HistoryExportMenu
                                    label="Bulk Export"
                                    onSelect={(format) => { void exportAll(format); }}
                                    className="bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed dark:bg-slate-800 dark:text-blue-300"
                                />
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
                            {!isInitialized
                              ? "Loading your account session…"
                              : isAuthenticated
                                ? "Your past scholarly conversions will appear here after you run the converter while signed in."
                                : "Sign in to save conversion history to your account. Anonymous sessions are not stored."}
                        </p>
                        <Link href={isAuthenticated ? "/" : "/login"}>
                            <button
                                disabled={!isInitialized}
                                className="bg-primary-container text-white px-8 py-3 rounded-full text-sm font-bold tracking-wide hover:scale-105 transition-transform duration-150 shadow-md disabled:opacity-60 disabled:pointer-events-none"
                            >
                                {!isInitialized ? "Loading…" : isAuthenticated ? "Start Converting References" : "Sign in to save history"}
                            </button>
                        </Link>
                    </div>
                ) : (
                    <>
                        <section className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                            <div className="flex w-full flex-1 flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-lowest px-4 py-3 shadow-sm dark:bg-slate-900">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-primary-container dark:text-blue-200">
                                    {historyBatches.length} saved batch{historyBatches.length === 1 ? "" : "es"}
                                    </p>
                                </div>
                                <div
                                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${syncStatusConfig.bgClassName} ${syncStatusConfig.borderClassName} ${syncStatusConfig.textClassName}`}
                                >
                                    <span className={`h-2.5 w-2.5 rounded-full ${syncStatusConfig.dotClassName}`}></span>
                                    <span>{syncStatusConfig.label}</span>
                                </div>
                            </div>
                            <div className="flex w-full flex-wrap gap-2 xl:w-auto">
                                <span className="px-4 py-2 bg-primary-container text-white rounded-full text-sm font-medium whitespace-nowrap">All Jobs</span>
                                <span className="px-4 py-2 bg-surface-container dark:bg-slate-800 text-on-surface-variant dark:text-slate-400 rounded-full text-sm font-medium whitespace-nowrap">Newest First</span>
                            </div>
                        </section>

                        <section className="space-y-6 flex-1">
                                {visibleBatches.map((batch, index) => {
                                    const dateObj = new Date(batch.timestamp);
                                    const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                                    const timeStr = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                                    const health = calculateHealth(batch);

                                    return (
                                        <div
                                            key={batch.id}
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
                                                            onClick={() => setSelectedBatchId(batch.id)}
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
                                                                                        <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-sm text-emerald-600 dark:text-emerald-400">check_circle</span>
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
                                                                <HistoryExportMenu
                                                                    label={`Download ${selectedBatch.targetStyle} Export`}
                                                                    onSelect={(format) => { void exportBatch(selectedBatch, format); }}
                                                                    className="w-full justify-center bg-[#002147] text-white hover:bg-[#002147]/90 dark:bg-blue-600 dark:hover:bg-blue-500"
                                                                />
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
                                                <HistoryExportMenu
                                                    label="Export"
                                                    onSelect={(format) => { void exportBatch(batch, format); }}
                                                    className="flex-1 whitespace-nowrap bg-primary-container text-white hover:opacity-90 md:flex-none"
                                                />
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
                                        </div>
                                    );
                                })}
                            
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
                                        <HistoryExportMenu
                                            label="Export"
                                            onSelect={(format) => { void exportSelected(format); }}
                                            className="px-3 py-1.5 text-xs font-bold text-white hover:bg-white/10"
                                            compact
                                        />
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
        </div>
    );
}

function HistoryExportMenu({
    label,
    onSelect,
    className,
    compact = false,
}: {
    label: string;
    onSelect: (format: HistoryExportFormat) => void;
    className?: string;
    compact?: boolean;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    className={`flex items-center gap-2 rounded-lg px-3.5 py-2 font-semibold transition-colors ${compact ? "" : "text-sm"} ${className ?? ""}`}
                >
                    <Download className={compact ? "h-4 w-4" : "h-4 w-4"} />
                    <span>{label}</span>
                    <ChevronDown className={compact ? "h-4 w-4" : "h-4 w-4"} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => onSelect("txt")}>
                    <FileText className="h-4 w-4" />
                    TXT
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect("pdf")}>
                    <Download className="h-4 w-4" />
                    PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect("bib")}>
                    <FileCode className="h-4 w-4" />
                    BibTeX
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect("ris")}>
                    <Database className="h-4 w-4" />
                    RIS
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function buildHistoryExportFileStem(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        || "bulkcitations_export";
}

function downloadTextFile(content: string, fileName: string, contentType: string) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}

function toBibtexEntry(item: HistoryItem, index: number) {
    const citationKey = buildHistoryExportFileStem(item.customName || item.outputStyle || `reference_${index + 1}`);
    const note = escapeBibtexValue(item.convertedText);
    const title = escapeBibtexValue(readHistoryTitle(item));
    const year = readHistoryYear(item);

    return [
        `@misc{${citationKey}_${index + 1},`,
        `  title = {${title}},`,
        year ? `  year = {${year}},` : null,
        `  note = {${note}},`,
        `  keywords = {${escapeBibtexValue(item.outputStyle)}},`,
        "}",
    ].filter(Boolean).join("\n");
}

function toRisEntry(item: HistoryItem, index: number) {
    const title = readHistoryTitle(item);
    const year = readHistoryYear(item);

    return [
        "TY  - GEN",
        `ID  - history-${index + 1}`,
        `TI  - ${title}`,
        year ? `PY  - ${year}` : null,
        `N1  - ${item.convertedText.replace(/\r?\n/g, " ")}`,
        `KW  - ${item.outputStyle}`,
        "ER  -",
    ].filter(Boolean).join("\n");
}

function readHistoryTitle(item: HistoryItem) {
    const compact = item.convertedText.replace(/\s+/g, " ").trim();
    const match = compact.match(/[.”"]\s*([^.[(]+?)(?:\.|\s+[A-Z][a-z]+,|\s+\*|\s+[A-Z][a-z]+\s+\d)/);
    return (match?.[1] || compact.slice(0, 80)).trim();
}

function readHistoryYear(item: HistoryItem) {
    return item.convertedText.match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
}

function escapeBibtexValue(value: string) {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/{/g, "\\{")
        .replace(/}/g, "\\}");
}
