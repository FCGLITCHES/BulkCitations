import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Navbar } from "@/components/navbar";
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
  Zap,
  ChevronRight,
  Code,
  Settings,
  Info,
  GitBranch,
  MessageSquare,
  Clock3,
  ArrowRightLeft,
  CopyCheck
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import type { CitationReport, FixType } from "@shared/schema";
import { adminFetch } from "@/lib/admin-api";

type EditableFieldKey =
  | "authors"
  | "title"
  | "year"
  | "journal"
  | "volume"
  | "issue"
  | "pages"
  | "doi"
  | "publisher"
  | "conferenceTitle"
  | "bookTitle"
  | "referenceType";

const EDITABLE_FIELDS: Array<{ key: EditableFieldKey; label: string }> = [
  { key: "authors", label: "Authors" },
  { key: "title", label: "Title" },
  { key: "year", label: "Year" },
  { key: "journal", label: "Journal" },
  { key: "conferenceTitle", label: "Conference Title" },
  { key: "bookTitle", label: "Book Title" },
  { key: "volume", label: "Volume" },
  { key: "issue", label: "Issue" },
  { key: "pages", label: "Pages" },
  { key: "doi", label: "DOI" },
  { key: "publisher", label: "Publisher" },
  { key: "referenceType", label: "Reference Type" },
];

function FieldHint({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors">
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-5">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function initialCorrectedFields(report?: CitationReport | null) {
  if (!report) return {} as Record<EditableFieldKey, string>;
  return {
    authors: Array.isArray(report.correctedFields?.authors)
      ? report.correctedFields?.authors.map((author) => author.literal || (author.first ? `${author.last}, ${author.first}` : author.last)).join("; ")
      : Array.isArray(report.parsedData?.authors) ? report.parsedData.authors.join("; ") : "",
    title: report.correctedFields?.title ?? report.parsedData?.title ?? "",
    year: report.correctedFields?.year != null ? String(report.correctedFields.year) : report.parsedData?.year ?? "",
    journal: report.correctedFields?.journal ?? report.parsedData?.journal ?? "",
    volume: report.correctedFields?.volume ?? report.parsedData?.volume ?? "",
    issue: report.correctedFields?.issue ?? report.parsedData?.issue ?? "",
    pages: report.correctedFields?.pages ?? report.parsedData?.pages ?? "",
    doi: report.correctedFields?.doi ?? report.parsedData?.doi ?? "",
    publisher: report.correctedFields?.publisher ?? report.parsedData?.publisher ?? "",
    conferenceTitle: report.correctedFields?.conferenceTitle ?? report.parsedData?.conferenceTitle ?? "",
    bookTitle: report.correctedFields?.bookTitle ?? report.parsedData?.bookTitle ?? "",
    referenceType: String(report.correctedFields?.referenceType ?? report.referenceType ?? ""),
  };
}

export default function AdminReportDetail() {
  const [, params] = useRoute("/admin/reports/:id");
  const { id } = params || {};
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [fixType, setFixType] = useState<FixType>("renderer-fix");
  const [targetReferenceType, setTargetReferenceType] = useState<string>("");
  const [proposedPattern, setProposedPattern] = useState({ regex: "", replacement: "" });
  const [proposedStyleFix, setProposedStyleFix] = useState("");
  const [correctedFields, setCorrectedFields] = useState<Record<EditableFieldKey, string>>({} as Record<EditableFieldKey, string>);
  const [approvedFields, setApprovedFields] = useState<Record<EditableFieldKey, boolean>>({} as Record<EditableFieldKey, boolean>);
  const [failureTaxonomy, setFailureTaxonomy] = useState("");
  const [stageBlame, setStageBlame] = useState("");
  const [duplicateDecision, setDuplicateDecision] = useState<CitationReport["duplicateDecision"]>("not_applicable");
  const [assigneeName, setAssigneeName] = useState("");
  const [newComment, setNewComment] = useState("");
  const [resolvedByCommit, setResolvedByCommit] = useState("");
  const [resolvedByVersion, setResolvedByVersion] = useState("");

  const { data: report, isLoading } = useQuery<CitationReport>({
    queryKey: [`/api/reports/${id}`],
    queryFn: async () => {
      return adminFetch<CitationReport>(`/api/reports/${id}`);
    },
  });

  useEffect(() => {
    if (report?.fixType) setFixType(report.fixType);
    if (report?.referenceType) setTargetReferenceType(report.referenceType);
    if (report) {
      setCorrectedFields(initialCorrectedFields(report));
      setApprovedFields(EDITABLE_FIELDS.reduce((acc, field) => ({
        ...acc,
        [field.key]: Boolean(report.fieldApproval?.[field.key]?.approved),
      }), {} as Record<EditableFieldKey, boolean>));
      setFailureTaxonomy((report.failureTaxonomy ?? []).join(", "));
      setStageBlame((report.stageBlame ?? []).join(", "));
      setDuplicateDecision(report.duplicateDecision ?? "not_applicable");
      setAssigneeName(report.assigneeName ?? "");
      setResolvedByCommit(report.resolvedByCommit ?? report.resolutionTrace?.resolvedByCommit ?? "");
      setResolvedByVersion(report.resolvedByVersion ?? report.resolutionTrace?.resolvedByVersion ?? "");
    }
  }, [report]);



  const assignMutation = useMutation({
    mutationFn: async () => {
      return adminFetch<{ report: CitationReport }>(`/api/reports/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeName,
          actor: "admin",
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData([`/api/reports/${id}`], data.report);
      toast({ title: "Assignment updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/grouped"] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async () => {
      return adminFetch<{ report: CitationReport }>(`/api/reports/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: "admin",
          message: newComment,
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData([`/api/reports/${id}`], data.report);
      setNewComment("");
      toast({ title: "Comment added" });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/grouped"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      return adminFetch(`/api/reports/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
    },
    onSuccess: () => {
      toast({ title: "Report rejected" });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${id}`] });
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      return adminFetch(`/api/reports/${id}/duplicate`, { method: "POST" });
    },
    onSuccess: () => {
      toast({ title: "Marked as duplicate" });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/grouped"] });
    }
  });

  // Master Resolution Mutation (Handles everything)
  const resolveMutation = useMutation({
    mutationFn: async ({ saveAsTruth, modeLabel }: { saveAsTruth: boolean; modeLabel: string }) => {
      return adminFetch<{ report: CitationReport }>(`/api/reports/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            fixType, 
            referenceType: targetReferenceType,
            proposedPattern,
            proposedStyleFix,
            saveAsTruth,
            correctedFields: {
              authors: correctedFields.authors
                ? correctedFields.authors.split(";").map((author) => author.trim()).filter(Boolean).map((author) => {
                  const [last, first] = author.includes(",")
                    ? author.split(",", 2).map((part) => part.trim())
                    : [author.trim(), null];
                  return { last, first, initials: null };
                })
                : undefined,
              title: correctedFields.title || null,
              year: correctedFields.year ? Number.parseInt(correctedFields.year, 10) : null,
              journal: correctedFields.journal || null,
              volume: correctedFields.volume || null,
              issue: correctedFields.issue || null,
              pages: correctedFields.pages || null,
              doi: correctedFields.doi || null,
              publisher: correctedFields.publisher || null,
              conferenceTitle: correctedFields.conferenceTitle || null,
              bookTitle: correctedFields.bookTitle || null,
              referenceType: correctedFields.referenceType || targetReferenceType || report?.referenceType,
            },
            fieldApproval: Object.fromEntries(
              EDITABLE_FIELDS.map((field) => [
                field.key,
                {
                  approved: Boolean(approvedFields[field.key]),
                  value: correctedFields[field.key] || undefined,
                },
              ]),
            ),
            failureTaxonomy: failureTaxonomy.split(",").map((item) => item.trim()).filter(Boolean),
            stageBlame: stageBlame.split(",").map((item) => item.trim()).filter(Boolean),
            duplicateDecision,
            resolvedByCommit: resolvedByCommit || undefined,
            resolvedByVersion: resolvedByVersion || undefined,
        })
      });
    },
    onSuccess: (data, variables) => {
      let title = "Success";
      let description = `${variables.modeLabel} has been applied and the report has been updated.`;
      
      const status = data.report.status;
      if (status === "accepted") {
        title = "Issue Resolved";
      } else if (status === "rejected") {
        title = "Report Rejected";
      } else if (status === "duplicate") {
        title = "Marked as Duplicate";
      }

      queryClient.setQueryData([`/api/reports/${id}`], data.report);
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
  const confidenceScore =
    typeof report.confidence === "number"
      ? report.confidence
      : typeof (report.confidence as unknown as { score?: unknown } | undefined)?.score === "number"
        ? (report.confidence as unknown as { score: number }).score
        : 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto py-8 px-4 xl:px-6 max-w-[1650px] space-y-6">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/admin/reports">
            <Button variant="ghost" size="sm" className="gap-2">
              <ChevronRight className="h-4 w-4 rotate-180" />
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column: Input/Output */}
        <div className="xl:col-span-7 space-y-6">
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
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Original Input</Label>
                  <div className="p-3 bg-red-50/20 dark:bg-red-950/20 rounded-md font-mono text-xs leading-6 break-words border border-red-100 dark:border-red-900 h-[220px] overflow-auto">
                    {report.originalText}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Engine Output</Label>
                  <div className="p-3 bg-muted/30 rounded-md font-mono text-xs leading-6 break-words border border-border h-[220px] overflow-auto">
                    {report.convertedText}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-blue-600 dark:text-blue-400 uppercase font-bold tracking-tight">
                    {report.source === "user-edit" ? "User's Ground Truth (Edit)" : "Proposed Style Fix"}
                  </Label>
                  <Textarea 
                    className={`p-3 rounded-md font-mono text-xs leading-6 break-words border h-[220px] resize-none ${proposedStyleFix ? "bg-green-50/20 border-green-200 dark:bg-green-950/20" : "bg-muted/10 border-dashed"}`}
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
              <Badge variant={confidenceScore > 70 ? "secondary" : "destructive"}>
                {confidenceScore}% Confidence
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Resolution Snapshot</CardTitle>
              <CardDescription>Compare the original engine understanding, approved fields, and final approved output side by side.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Original engine output</Label>
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-2">
                  <div><span className="text-muted-foreground">Type:</span> {report.originalEngineOutput?.referenceType ?? report.referenceType ?? "N/A"}</div>
                  <div><span className="text-muted-foreground">Confidence:</span> {report.originalEngineOutput?.confidence ?? report.confidence ?? "N/A"}</div>
                  <div className="break-words font-mono text-[11px]">{report.originalEngineOutput?.convertedText ?? report.convertedText}</div>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Approved fields</Label>
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-2">
                  {Object.entries(report.correctedFields ?? {}).length === 0 ? (
                    <p className="text-muted-foreground">No corrected fields stored yet.</p>
                  ) : (
                    Object.entries(report.correctedFields ?? {}).map(([field, value]) => (
                      <div key={field} className="grid grid-cols-[110px,1fr] gap-2">
                        <span className="font-medium capitalize text-muted-foreground">{field}</span>
                        <span className="break-words">
                          {Array.isArray(value)
                            ? value.map((entry) => ("literal" in entry && entry.literal ? entry.literal : "first" in entry && entry.first ? `${entry.last}, ${entry.first}` : "last" in entry ? entry.last : String(entry))).join("; ")
                            : value == null
                              ? "null"
                              : String(value)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Final approved output</Label>
                <div className="rounded-md border border-emerald-200/50 bg-emerald-50/10 p-3 text-xs leading-6">
                  {report.finalApprovedOutput || proposedStyleFix || report.proposedStyleFix || "No final approved output stored yet."}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Resolution Command Panel */}
        <div className="xl:col-span-5 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                Workflow & Provenance
              </CardTitle>
              <CardDescription>
                Review stage blame, assign ownership, and keep a visible timeline without opening debug payloads.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Likely failing stage</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant={report.likelyStageBlame && report.likelyStageBlame.confidence >= 0.8 ? "default" : report.likelyStageBlame && report.likelyStageBlame.confidence >= 0.5 ? "secondary" : "outline"}>
                        {report.likelyStageBlame?.likelyStage ?? "unknown"}
                      </Badge>
                      <span className="text-sm font-medium">
                        {report.likelyStageBlame ? `${Math.round(report.likelyStageBlame.confidence * 100)}% confidence` : "No stage blame captured"}
                      </span>
                    </div>
                  </div>
                  {report.engineSnapshot?.truthProvenance?.truthApplied && (
                    <Badge variant="outline" className="text-[10px]">
                      Truth applied
                    </Badge>
                  )}
                </div>
                {!!report.likelyStageBlame?.evidence?.length && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
                    <div className="flex flex-wrap gap-1.5">
                      {report.likelyStageBlame.evidence.map((entry) => (
                        <Badge key={entry} variant="outline" className="text-[10px]">
                          {entry}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {!!report.likelyStageBlame?.alternatives?.length && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Alternatives</p>
                    <div className="flex flex-wrap gap-1.5">
                      {report.likelyStageBlame.alternatives.map((alternative) => (
                        <Badge key={`${alternative.stage}-${alternative.confidence}`} variant="outline" className="text-[10px]">
                          {alternative.stage} {Math.round(alternative.confidence * 100)}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground inline-flex items-center gap-1.5">
                    Assignee
                    <GitBranch className="h-3.5 w-3.5" />
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      className="h-8 text-xs"
                      value={assigneeName}
                      onChange={(e) => setAssigneeName(e.target.value)}
                      placeholder="Assign reviewer name"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => assignMutation.mutate()}
                      disabled={!assigneeName.trim() || assignMutation.isPending}
                    >
                      Assign
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Resolved by commit</Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      value={resolvedByCommit}
                      onChange={(e) => setResolvedByCommit(e.target.value)}
                      placeholder="abc1234"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Resolved by version</Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      value={resolvedByVersion}
                      onChange={(e) => setResolvedByVersion(e.target.value)}
                      placeholder="2.4.1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground inline-flex items-center gap-1.5">
                    Review comment
                    <MessageSquare className="h-3.5 w-3.5" />
                  </Label>
                  <Textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    rows={3}
                    className="resize-none text-xs"
                    placeholder="Add reviewer context, commit notes, or why this is stage-specific."
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => commentMutation.mutate()}
                    disabled={!newComment.trim() || commentMutation.isPending}
                  >
                    Add comment
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Truth</p>
                  <div className="mt-2 text-xs">
                    {report.truthId ? (
                      <div className="space-y-1">
                        <p className="font-medium">Truth linked</p>
                        <p className="font-mono break-all text-muted-foreground">{report.truthId}</p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No truth entry linked yet.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pattern export</p>
                  <div className="mt-2 text-xs">
                    {report.patternExport ? (
                      <div className="space-y-2">
                        <p className="font-mono break-all text-muted-foreground">{report.patternExport.filePath}</p>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => navigator.clipboard.writeText(report.patternExport?.content ?? "")}
                        >
                          <CopyCheck className="mr-1.5 h-3.5 w-3.5" />
                          Copy snippet
                        </Button>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No pattern export generated.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Regression fixture</p>
                  <div className="mt-2 text-xs">
                    {report.regressionFixtureId ? (
                      <div className="space-y-1">
                        <p className="font-medium">Generated</p>
                        <p className="font-mono break-all text-muted-foreground">{report.regressionFixtureId}</p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No generated fixture linked yet.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground inline-flex items-center gap-1.5">
                  Review timeline
                  <Clock3 className="h-3.5 w-3.5" />
                </Label>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/10 p-3">
                  {(report.reviewEvents ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No review events recorded yet.</p>
                  ) : (
                    (report.reviewEvents ?? []).map((event) => (
                      <div key={event.id} className="rounded border border-border/60 bg-background/80 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] uppercase">{event.type}</Badge>
                            <span className="text-xs font-medium">{event.actor}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
                        </div>
                        {event.message && <p className="mt-2 text-xs leading-5">{event.message}</p>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 dark:border-blue-900 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brush className="h-4 w-4 text-blue-500" />
                Resolve Failure
              </CardTitle>
              <CardDescription>Determine what needs to be fixed to solve this issue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
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
                      <p className="text-[9px] text-muted-foreground">An export snippet will be generated for source control. Direct file writes stay opt-in.</p>
                    </div>
                  )}
                </div>

                <div className="space-y-3 p-4 bg-emerald-50/10 dark:bg-emerald-950/10 rounded border border-emerald-200/40 dark:border-emerald-900/40">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-emerald-700 dark:text-emerald-300">Field-Level Truth Approval</Label>
                    <p className="text-[10px] text-muted-foreground">Approve corrected fields so they can become trusted training data for ranking and confidence models.</p>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {EDITABLE_FIELDS.map((field) => (
                      <div key={field.key} className="grid grid-cols-[auto,1fr] gap-2 items-start">
                        <Checkbox
                          checked={Boolean(approvedFields[field.key])}
                          onCheckedChange={(checked) => setApprovedFields((current) => ({
                            ...current,
                            [field.key]: Boolean(checked),
                          }))}
                          className="mt-2"
                        />
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase text-muted-foreground">{field.label}</Label>
                          <Input
                            className="h-8 text-xs"
                            value={correctedFields[field.key] ?? ""}
                            onChange={(e) => setCorrectedFields((current) => ({
                              ...current,
                              [field.key]: e.target.value,
                            }))}
                            placeholder={`Approved ${field.label.toLowerCase()}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-3 pt-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground inline-flex items-center gap-1.5">
                        Failure Taxonomy
                        <FieldHint text="Short tags for the type of failure, such as author parsing, locator formatting, deduplication miss, or style-detection error." />
                      </Label>
                      <Input
                        className="h-8 text-xs"
                        value={failureTaxonomy}
                        onChange={(e) => setFailureTaxonomy(e.target.value)}
                        placeholder="author_split, placeholder_volume, dedup_miss"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground inline-flex items-center gap-1.5">
                        Stage Blame
                        <FieldHint text="Which pipeline stage most likely introduced the problem, for example extract, validate, dedup, renderer, or clustering." />
                      </Label>
                      <Input
                        className="h-8 text-xs"
                        value={stageBlame}
                        onChange={(e) => setStageBlame(e.target.value)}
                        placeholder="extract, validate, dedup"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground inline-flex items-center gap-1.5">
                        Duplicate Decision
                        <FieldHint text="Record whether this citation is truly unique, a confirmed duplicate, or still needs review for duplicate handling." />
                      </Label>
                      <Select value={duplicateDecision ?? "not_applicable"} onValueChange={(value) => setDuplicateDecision(value as CitationReport["duplicateDecision"])}>
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_applicable">Not applicable</SelectItem>
                          <SelectItem value="confirmed_duplicate">Confirmed duplicate</SelectItem>
                          <SelectItem value="confirmed_unique">Confirmed unique</SelectItem>
                          <SelectItem value="needs_review">Needs review</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                {/* Case 1: Master Resolution (Everything) */}
                {proposedStyleFix && (
                  <Button 
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-9 text-xs"
                      disabled={report.status === "accepted"}
                      onClick={() => resolveMutation.mutate({ saveAsTruth: true, modeLabel: "Complete resolution and truth save" })}
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
                    onClick={() => resolveMutation.mutate({ saveAsTruth: false, modeLabel: "Fix resolution" })}
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
                        onClick={() => resolveMutation.mutate({ saveAsTruth: true, modeLabel: "Truth save" })}
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
                  adminFetch(`/api/reports/${id}/add-to-stress`, { method: "POST" })
                    .then(() => toast({ title: "Added to stress test corpus" }))
                    .catch((error: Error) => toast({
                      title: "Could not add to stress test corpus",
                      description: error.message,
                      variant: "destructive",
                    }));
                }}
              >
                 Add to Stress Test Corpus
              </Button>
            </CardFooter>
          </Card>
        </div>
        </div>
      </main>
    </div>
  );
}
