import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
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

export default function AdminReportDetail() {
  const [, params] = useRoute("/admin/reports/:id");
  const id = params?.id;
  const [report, setReport] = useState<CitationReport | null>(null);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/reports/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (report) setStatus(report.status);
  }, [report]);

  const handleStatusChange = async () => {
    if (!id || !status) return;
    setActionLoading("status");
    try {
      const res = await fetch(`/api/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) setReport((r) => (r ? { ...r, status: status as CitationReport["status"] } : null));
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddToStressTest = async () => {
    if (!id) return;
    setActionLoading("stress");
    try {
      const res = await fetch(`/api/reports/${id}/add-to-stress`, { method: "POST" });
      if (res.ok) setActionLoading(null);
    } finally {
      setActionLoading(null);
    }
  };

  if (!id) return null;
  if (loading) return <div className="p-6">Loading...</div>;
  if (!report) return <div className="p-6">Report not found.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/admin/reports">
          <Button variant="ghost" size="sm" className="text-blue-600 hover:bg-blue-100 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/50 dark:hover:text-blue-200">
            ← Back to queue
          </Button>
        </Link>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Report #{id.slice(0, 8)}</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">open</SelectItem>
                <SelectItem value="fixed">fixed</SelectItem>
                <SelectItem value="rejected">rejected</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="border-blue-600 text-blue-700 hover:bg-blue-100 hover:text-blue-900 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/50 dark:hover:text-blue-100"
              onClick={handleStatusChange}
              disabled={actionLoading !== null}
            >
              {actionLoading === "status" ? "Saving..." : "Update"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">
              INPUT ({report.detectedInputStyle} → {report.targetStyle})
            </p>
            <pre className="bg-muted/50 p-3 rounded text-sm whitespace-pre-wrap break-words">
              {report.rawInput}
            </pre>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">OUTPUT</p>
            <pre className="bg-muted/50 p-3 rounded text-sm whitespace-pre-wrap break-words">
              {report.convertedOutput}
            </pre>
          </div>
          <p className="text-sm">
            <strong>User reported:</strong> {report.userCategory}
            {report.userNote && ` — ${report.userNote}`}
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="border-blue-600 text-blue-700 hover:bg-blue-100 hover:text-blue-900 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/50 dark:hover:text-blue-100"
              onClick={async () => {
                setStatus("fixed");
                setActionLoading("status");
                try {
                  const res = await fetch(`/api/reports/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "fixed" }),
                  });
                  if (res.ok) setReport((r) => (r ? { ...r, status: "fixed" } : null));
                } finally {
                  setActionLoading(null);
                }
              }}
              disabled={actionLoading !== null}
            >
              {actionLoading === "status" ? "Saving..." : "Mark as fixed"}
            </Button>
            <Button
              variant="outline"
              className="border-blue-600 text-blue-700 hover:bg-blue-100 hover:text-blue-900 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/50 dark:hover:text-blue-100"
              onClick={handleAddToStressTest}
              disabled={actionLoading !== null}
            >
              {actionLoading === "stress" ? "Adding..." : "Add to stress test"}
            </Button>
            <Button
              variant="outline"
              className="border-red-600 text-red-700 hover:bg-red-100 hover:text-red-900 dark:border-red-400 dark:text-red-300 dark:hover:bg-red-950/50 dark:hover:text-red-100"
              onClick={async () => {
                setStatus("rejected");
                setActionLoading("status");
                try {
                  const res = await fetch(`/api/reports/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "rejected" }),
                  });
                  if (res.ok) setReport((r) => (r ? { ...r, status: "rejected" } : null));
                } finally {
                  setActionLoading(null);
                }
              }}
              disabled={actionLoading !== null}
            >
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
