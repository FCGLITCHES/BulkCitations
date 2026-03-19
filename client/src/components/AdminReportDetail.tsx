import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { 
  ArrowLeft, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  Brush, 
  Wrench,
  Bot,
  Users,
  Filter,
  AlertCircle,
  ShieldCheck,
  Zap
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import type { CitationReport, FixType } from "@shared/schema";

export default function AdminReportDetail() {
  const [, params] = useRoute("/admin/reports/:id");
  const { id } = params || {};
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [fixType, setFixType] = useState<FixType>("renderer-fix");
  const [targetReferenceType, setTargetReferenceType] = useState<string>("");
  const [proposedPattern, setProposedPattern] = useState({ regex: "", replacement: "" });
  const [proposedStyleFix, setProposedStyleFix] = useState("");

  const { data: report, isLoading } = useQuery<CitationReport>({
    queryKey: [`/api/reports/${id}`],
    queryFn: async () => {
      const res = await fetch(`/api/reports/${id}`);
      if (!res.ok) throw new Error("Report not found");
      return res.json();
    },
  });

  useEffect(() => {
    if (report?.fixType) setFixType(report.fixType);
    if (report?.referenceType) setTargetReferenceType(report.referenceType);
  }, [report]);



  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await fetch(`/api/reports/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      if (!res.ok) throw new Error("Failed to reject");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Report rejected" });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${id}`] });
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reports/${id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to mark as duplicate");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Marked as duplicate" });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/grouped"] });
    }
  });

  // Master Resolution Mutation (Handles everything)
  const resolveMutation = useMutation({
    mutationFn: async ({ saveAsTruth }: { saveAsTruth: boolean }) => {
      const res = await fetch(`/api/reports/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            fixType, 
            referenceType: targetReferenceType,
            proposedPattern,
            proposedStyleFix,
            saveAsTruth
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to resolve report");
      }
      return res.json();
    },
    onSuccess: (data) => {
      let title = "Success";
      let description = "Your fixes have been applied successfully.";
      
      const status = data.report.status;
      if (status === "accepted") {
        title = "Issue Resolved";
      } else if (status === "rejected") {
        title = "Report Rejected";
      } else if (status === "duplicate") {
        title = "Marked as Duplicate";
      }

      toast({ title, description });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/grouped"] });
    },
    onError: (err: Error) => {
      toast({ title: "Resolution Failed", description: err.message, variant: "destructive" });
    }
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground font-mono">Loading report {id}...</div>;
  if (!report) return <div className="p-8 text-center">Report not found. <Link href="/admin/reports" className="text-blue-500">Go back</Link></div>;

  const referenceTypes = [
    "journal-article",
    "book",
    "chapter",
    "paper-conference",
    "thesis",
    "report",
    "webpage",
  ];

  return (
    <div className="container mx-auto py-8 px-4 max-w-5xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/reports">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Queue
          </Button>
        </Link>
        <Badge variant={report.status === "pending" ? "secondary" : "default"}>
          {report.status.toUpperCase()}
        </Badge>
        {report.source === "auto" ? (
          <Badge variant="outline" className="text-purple-600 border-purple-200 dark:text-purple-400 dark:border-purple-800" title="Automatically queued by the system">
            <Bot className="h-3 w-3 mr-1" />
            AUTO-QUEUED
          </Badge>
        ) : (
          <Badge variant="outline" className="text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-800" title="Reported by a user">
            <Users className="h-3 w-3 mr-1" />
            USER-REPORTED
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Input/Output */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Comparison: Original vs. Output</span>
                {report.source === "user-edit" && (
                  <Badge className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300">
                    USER EDITED THIS
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Original Input</Label>
                  <div className="p-3 bg-red-50/20 dark:bg-red-950/20 rounded-md font-mono text-xs break-words border border-red-100 dark:border-red-900 min-h-[100px]">
                    {report.originalText}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Engine Output</Label>
                  <div className="p-3 bg-muted/30 rounded-md font-mono text-xs break-words border border-border min-h-[100px]">
                    {report.convertedText}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-blue-600 dark:text-blue-400 uppercase font-bold tracking-tight">
                    {report.source === "user-edit" ? "User's Ground Truth (Edit)" : "Proposed Style Fix"}
                  </Label>
                  <Textarea 
                    className={`p-3 rounded-md font-mono text-xs break-words border min-h-[100px] h-full ${proposedStyleFix ? "bg-green-50/20 border-green-200 dark:bg-green-950/20" : "bg-muted/10 border-dashed"}`}
                    value={proposedStyleFix}
                    onChange={(e) => setProposedStyleFix(e.target.value)}
                    placeholder="Enter the canonical golden format here..."
                  />
                  {report.source === "user-edit" && (
                    <p className="text-[9px] text-orange-600 mt-1">This was edited by a user. Verify formatting before saving as truth.</p>
                  )}
                </div>
              </div>
              
              {report.autoQueueReasons && report.autoQueueReasons.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <Label className="text-xs text-red-600 dark:text-red-400 font-bold">Trigger Reasons</Label>
                  <ul className="list-none space-y-1">
                    {report.autoQueueReasons.map((reason, i) => (
                      <li key={i} className="text-xs bg-red-50 dark:bg-red-950/30 p-1.5 flex items-center gap-1.5 rounded text-red-700 dark:text-red-300">
                        <ArrowLeft className="h-3 w-3 rotate-180" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <Label className="text-xs text-muted-foreground uppercase">Detected Style</Label>
                  <div className="font-bold">{report.detectedStyle || "N/A"}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase">Target Style</Label>
                  <div className="font-bold text-blue-600 dark:text-blue-400">{report.outputStyle}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">Parsed Interpretation</CardTitle>
              <Badge variant={report.confidence && report.confidence > 70 ? "secondary" : "destructive"}>
                {(report.confidence || 0)}% Confidence
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <div><span className="text-muted-foreground">Type:</span> <span className="font-mono">{report.referenceType || "N/A"}</span></div>
                  <div><span className="text-muted-foreground">Authors:</span> <span className="font-mono break-all">{report.parsedData?.authors?.join("; ") || "None"}</span></div>
                  <div><span className="text-muted-foreground">Title:</span> {report.parsedData?.title || "N/A"}</div>
                </div>
                <div className="space-y-2">
                  <div><span className="text-muted-foreground">Journal:</span> {report.parsedData?.journal || "N/A"}</div>
                  <div><span className="text-muted-foreground">Year:</span> {report.parsedData?.year || "N/A"}</div>
                  <div><span className="text-muted-foreground">Locator:</span> {report.parsedData?.pages || report.parsedData?.volume || "N/A"}</div>
                </div>
              </div>
              {report.userNote && (
                <div className="mt-4 p-3 bg-yellow-50/50 dark:bg-yellow-950/20 border-l-4 border-yellow-400 text-xs">
                  <span className="font-bold">User Note:</span> {report.userNote}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Resolution Command Panel */}
        <div className="space-y-6">
          <Card className="border-blue-200 dark:border-blue-900 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brush className="h-4 w-4 text-blue-500" />
                Resolve Failure
              </CardTitle>
              <CardDescription>Determine what needs to be fixed to solve this issue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Resolution Type</Label>
                <Select value={fixType} onValueChange={(v) => setFixType(v as FixType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dynamic-pattern">
                      <div className="flex items-center gap-2">
                        <Code className="h-4 w-4 text-green-500" />
                        <span>Dynamic Pattern (patterns.json)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="parser-logic">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-orange-500" />
                        <span>Parser Logic (Code change)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="scoring-tweak">
                      <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4 text-blue-500" />
                        <span>Scoring Tweak (detectStyle)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="renderer-fix">
                      <div className="flex items-center gap-2">
                        <Brush className="h-4 w-4 text-purple-500" />
                        <span>Renderer Fix (Formatting)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="type-correction">
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-pink-500" />
                        <span>Type Correction (Wrong category)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="other-fix">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-gray-500" />
                        <span>Other / Edge Case</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {fixType === "type-correction" && (
                <div className="space-y-2 p-3 bg-pink-50/20 dark:bg-pink-950/20 rounded border border-pink-100 dark:border-pink-900 border-dashed">
                  <Label className="text-xs font-bold text-pink-700 dark:text-pink-300">Corrected Reference Type</Label>
                  <Select value={targetReferenceType} onValueChange={setTargetReferenceType}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {referenceTypes.map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">The data is parsed correctly, it's just in the wrong category.</p>
                </div>
              )}

              {fixType === "dynamic-pattern" && (
                <div className="space-y-3 p-3 bg-muted rounded border border-dashed text-xs">
                  <div className="space-y-1.5">
                    <Label className="text-[10px]">Regex Pattern</Label>
                    <Input 
                      className="font-mono h-8 text-xs" 
                      placeholder="e.g. ^(.*?),\\s*(\\d{4});" 
                      value={proposedPattern.regex}
                      onChange={(e) => setProposedPattern({...proposedPattern, regex: e.target.value})}
                    />
                  </div>
                  <p className="text-[9px] text-muted-foreground">Will be auto-added to patterns.json on Accept.</p>
                </div>
              )}

              <div className="space-y-3 pt-2">
                {/* Case 1: Master Resolution (Everything) */}
                {proposedStyleFix && (
                  <Button 
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-9 text-xs"
                      disabled={report.status === "accepted"}
                      onClick={() => resolveMutation.mutate({ saveAsTruth: true })}
                  >
                      <Zap className="h-4 w-4 mr-1.5" />
                      Complete Resolution & Save Truth
                  </Button>
                )}

                <div className="flex flex-col gap-2">
                  {/* Case 2: Only Fix (No truth override) */}
                  <Button 
                    variant="default"
                    className="w-full bg-blue-600 hover:bg-blue-700 h-9 text-xs" 
                    disabled={report.status === "accepted"}
                    onClick={() => resolveMutation.mutate({ saveAsTruth: false })}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    Accept Fix & Resolve Only
                  </Button>

                  {/* Case 3: Only Truth (No fix type change) */}
                  {proposedStyleFix && (
                    <Button 
                        variant="outline"
                        className="w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 h-9 text-xs"
                        disabled={report.status === "accepted"}
                        onClick={() => resolveMutation.mutate({ saveAsTruth: true })}
                    >
                        <ShieldCheck className="h-4 w-4 mr-1.5" />
                        Save as Truth Only
                    </Button>
                  )}
                </div>

                <div className="h-px bg-border my-2" />

                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline" 
                    className="text-red-500 hover:bg-red-50 text-xs"
                    onClick={() => {
                      const reason = prompt("Why mark this as correct? (e.g. output is already valid)");
                      if (reason !== null) rejectMutation.mutate(reason || "Output is already correct");
                    }}
                  >
                    <XCircle className="h-3 w-3 mr-1.5" />
                    Mark as Correct
                  </Button>
                  <Button 
                    variant="outline" 
                    className="text-muted-foreground hover:bg-muted text-xs"
                    onClick={() => duplicateMutation.mutate()}
                  >
                    <Copy className="h-3 w-3 mr-1.5" />
                    Duplicate
                  </Button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="pt-0 flex flex-col items-start gap-2">
               <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs h-7 px-2"
                onClick={() => {
                  fetch(`/api/reports/${id}/add-to-stress`, { method: "POST" })
                    .then(() => toast({ title: "Added to stress test corpus" }));
                }}
              >
                 Add to Stress Test Corpus
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
