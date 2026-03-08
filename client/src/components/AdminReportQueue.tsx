import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

interface CitationReport {
  id: string;
  timestamp: string;
  rawInput: string;
  detectedInputStyle: string;
  targetStyle: string;
  convertedOutput: string;
  userCategory: string;
  userNote?: string;
  status: "open" | "fixed" | "rejected";
}

const CATEGORY_LABELS: Record<string, string> = {
  "Year missing or incorrect": "year",
  "Author name incorrect": "author",
  "Title missing or incorrect": "title",
  "Journal / venue incorrect": "venue",
  "Pages missing or incorrect": "pages",
  "Wrong citation style detected": "style",
  "Other...": "other",
};

const STATUS_COLORS: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  open: "destructive",
  fixed: "default",
  rejected: "secondary",
};

export default function AdminReportQueue() {
  const [reports, setReports] = useState<CitationReport[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "fixed" | "rejected">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reports")
      .then((r) => r.json())
      .then((data) => {
        setReports(Array.isArray(data) ? data : []);
      })
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = reports.filter((r) => filter === "all" || r.status === filter);
  const openAndFixed = reports.filter((r) => r.status === "open" || r.status === "fixed");
  const byCategory: Record<string, number> = {};
  const byStyle: Record<string, number> = {};
  openAndFixed.forEach((r) => {
    byCategory[r.userCategory] = (byCategory[r.userCategory] ?? 0) + 1;
    const styleKey = `${r.detectedInputStyle}→${r.targetStyle}`;
    byStyle[styleKey] = (byStyle[styleKey] ?? 0) + 1;
  });

  const statusDotColor = (status: string) => {
    if (status === "rejected") return "bg-red-500";
    if (status === "open") return "bg-blue-500";
    return "bg-green-500"; // fixed
  };

  if (loading) return <div className="p-6">Loading reports...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/">
          <Button variant="ghost" size="sm" className="text-blue-600 hover:bg-blue-100 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/50 dark:hover:text-blue-200">
            ← Back
          </Button>
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reports ({reports.length} total)</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter by:</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">all</option>
            <option value="open">open</option>
            <option value="fixed">fixed</option>
            <option value="rejected">rejected</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="text-sm font-medium">By category (open + fixed only)</CardHeader>
          <CardContent className="text-sm space-y-1">
            {Object.keys(byCategory).length === 0 ? (
              <p className="text-muted-foreground">No open or fixed reports</p>
            ) : (
              Object.entries(byCategory).map(([cat, count]) => (
                <div key={cat}>
                  {CATEGORY_LABELS[cat] ?? cat}: {count}
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="text-sm font-medium">By input style (open + fixed only)</CardHeader>
          <CardContent className="text-sm space-y-1">
            {Object.keys(byStyle).length === 0 ? (
              <p className="text-muted-foreground">No open or fixed reports</p>
            ) : (
              Object.entries(byStyle).map(([style, count]) => (
                <div key={style}>
                  {style}: {count}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Time</th>
                <th className="text-left p-2">Style</th>
                <th className="text-left p-2">Category</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice()
                .reverse()
                .map((r, i) => (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="p-2">{filtered.length - i}</td>
                    <td className="p-2">{new Date(r.timestamp).toLocaleTimeString()}</td>
                    <td className="p-2">
                      {r.detectedInputStyle}→{r.targetStyle}
                    </td>
                    <td className="p-2">{CATEGORY_LABELS[r.userCategory] ?? r.userCategory}</td>
                    <td className="p-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDotColor(r.status)}`}
                          aria-hidden
                        />
                        <Badge variant={STATUS_COLORS[r.status] ?? "outline"}>{r.status}</Badge>
                      </span>
                    </td>
                    <td className="p-2">
                      <Link href={`/admin/reports/${r.id}`}>
                        <Button variant="ghost" size="sm" className="text-blue-600 hover:bg-blue-100 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/50 dark:hover:text-blue-200">
                          View
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
