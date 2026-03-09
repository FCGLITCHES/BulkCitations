import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Quote, Trash2, ArrowLeft } from "lucide-react";

interface HistoryItem {
    id: string;
    originalText: string;
    convertedText: string;
    inputStyle: string;
    outputStyle: string;
    timestamp: string;
}

export default function HistoryPage() {
    const [history, setHistory] = useState<HistoryItem[]>([]);

    useEffect(() => {
        const loadHistory = () => {
            try {
                const stored = localStorage.getItem("bulkcitations_history");
                if (stored) {
                    setHistory(JSON.parse(stored));
                }
            } catch (e) {
                console.error("Failed to load history", e);
            }
        };
        loadHistory();
    }, []);

    const clearHistory = () => {
        localStorage.removeItem("bulkcitations_history");
        setHistory([]);
    };

    const removeHistoryItem = (id: string) => {
        const updated = history.filter(item => item.id !== id);
        setHistory(updated);
        localStorage.setItem("bulkcitations_history", JSON.stringify(updated));
    };

    return (
        <div className="min-h-screen bg-background font-sans">
            <header className="bg-white/80 dark:bg-card/80 backdrop-blur-lg shadow-sm border-b border-border overflow-x-hidden sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-3">
                            <Link href="/">
                                <div className="w-10 h-10 bg-gradient-brand rounded-xl flex items-center justify-center shadow-md hover:scale-105 transition-transform cursor-pointer">
                                    <Quote className="text-white text-lg" />
                                </div>
                            </Link>
                            <div>
                                <h1 className="text-xl font-semibold text-foreground">BulkCitations</h1>
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Conversion History</p>
                            </div>
                        </div>

                        <nav className="flex items-center gap-4">
                            <Link href="/">
                                <Button variant="ghost" size="sm" className="hidden sm:flex text-muted-foreground gap-2 hover:text-primary">
                                    <ArrowLeft className="w-4 h-4" /> Back to Converter
                                </Button>
                            </Link>
                        </nav>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8 sm:py-12 max-w-5xl">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground tracking-tight">Recent Conversions</h2>
                        <p className="text-muted-foreground mt-1">Found {history.length} locally saved references.</p>
                    </div>
                    {history.length > 0 && (
                        <Button variant="destructive" size="sm" onClick={clearHistory} className="gap-2">
                            <Trash2 className="w-4 h-4" /> Clear All
                        </Button>
                    )}
                </div>

                {history.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-20 px-4 rounded-2xl border-2 border-dashed border-border bg-card/50"
                    >
                        <Quote className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-foreground mb-2">No History Found</h3>
                        <p className="text-muted-foreground mb-6">Your beautifully converted citations will appear here.</p>
                        <Link href="/">
                            <Button className="bg-primary hover:bg-primary/90 text-white rounded-full px-8">
                                Start Converting
                            </Button>
                        </Link>
                    </motion.div>
                ) : (
                    <div className="space-y-4">
                        <AnimatePresence>
                            {history.map((item, index) => (
                                <motion.div
                                    key={item.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ duration: 0.3, delay: index * 0.05 }}
                                >
                                    <Card className="overflow-hidden border-border/50 hover:border-primary/30 transition-colors shadow-sm focus-within:ring-2 focus-within:ring-primary/20">
                                        <CardHeader className="bg-muted/30 py-3 px-4 sm:px-6 flex flex-row items-center justify-between border-b border-border/50">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="text-xs font-medium text-muted-foreground bg-background px-2 py-1 rounded-md border border-border">
                                                    {new Date(item.timestamp).toLocaleString(undefined, {
                                                        dateStyle: 'medium',
                                                        timeStyle: 'short'
                                                    })}
                                                </span>
                                                <div className="flex items-center gap-1.5 text-xs font-semibold">
                                                    <span className="text-foreground">{item.inputStyle.toUpperCase()}</span>
                                                    <span className="text-muted-foreground">&rarr;</span>
                                                    <span className="text-primary">{item.outputStyle.toUpperCase()}</span>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeHistoryItem(item.id)}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </CardHeader>
                                        <CardContent className="p-4 sm:p-6 grid gap-4 grid-cols-1 md:grid-cols-2">
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Original Text</h4>
                                                <div className="text-sm p-3 bg-muted/20 rounded-lg border border-border/50 break-words font-mono opacity-80">
                                                    {item.originalText}
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Converted Output</h4>
                                                <div className="text-sm p-3 bg-primary/5 rounded-lg border border-primary/20 break-words font-medium text-foreground h-full relative group">
                                                    {item.convertedText}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </main>
        </div>
    );
}
