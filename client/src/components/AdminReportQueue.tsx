import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Navbar } from "@/components/navbar";
import { 
  ChevronRight, 
  Users, 
  Bot,
  Filter,
  Edit,
  AlertCircle,
  GitBranch,
  MessageSquare,
  ShieldCheck,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import type { CitationReport, ReportStatus } from "@shared/schema";
import { adminFetch } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

interface GroupedReport {
  fingerprint: string;
  reports: CitationReport[];
  totalCount: number;
  category: string;
}

type SortKey = "freq" | "category" | "source" | "targetStyle";
type SortDirection = "asc" | "desc";

function StageBadge({ report }: { report: CitationReport }) {
  const blame = report.likelyStageBlame;
  if (!blame) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Unknown
      </Badge>
    );
  }

  const variant =
    blame.confidence >= 0.8
      ? "default"
      : blame.confidence >= 0.5
        ? "secondary"
        : "outline";

  return (
    <Badge variant={variant} className="text-[10px] uppercase">
      {blame.likelyStage}
      <span className="ml-1 opacity-70">{Math.round(blame.confidence * 100)}%</span>
    </Badge>
  );
}

function getReportCategories(report: CitationReport, fallbackCategory: string): string[] {
  const values = report.failureCategories?.length
    ? report.failureCategories
    : report.failureCategory
      ? [report.failureCategory]
      : [fallbackCategory];

  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export default function AdminReportQueue() {
  const [statusFilter, setStatusFilter] = useState<ReportStatus>("pending");
  const [sortKey, setSortKey] = useState<SortKey>("freq");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedFingerprints, setSelectedFingerprints] = useState<Set<string>>(new Set());
  const [showStageFocus, setShowStageFocus] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: groups, isLoading } = useQuery<GroupedReport[]>({
    queryKey: ["/api/reports/grouped", statusFilter],
    queryFn: async () => {
      return adminFetch<GroupedReport[]>(`/api/reports/grouped?status=${statusFilter}`);
    },
  });

  const stats = groups?.reduce((acc, g) => {
    acc.total += g.totalCount;
    acc.groups += 1;
    return acc;
  }, { total: 0, groups: 0 }) || { total: 0, groups: 0 };

  const sortedGroups = [...(groups ?? [])].sort((left, right) => {
    const leftLatest = left.reports[0];
    const rightLatest = right.reports[0];

    if (!leftLatest || !rightLatest) {
      return 0;
    }

    let comparison = 0;

    if (sortKey === "freq") {
      comparison = left.totalCount - right.totalCount;
    } else if (sortKey === "category") {
      comparison = left.category.localeCompare(right.category);
    } else if (sortKey === "source") {
      comparison = leftLatest.source.localeCompare(rightLatest.source);
    } else if (sortKey === "targetStyle") {
      comparison = leftLatest.outputStyle.localeCompare(rightLatest.outputStyle);
    }

    if (comparison === 0) {
      comparison = right.totalCount - left.totalCount;
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  const selectedGroups = sortedGroups.filter((group) => selectedFingerprints.has(group.fingerprint));
  const selectedReportIds = selectedGroups.flatMap((group) => group.reports.map((report) => report.id));
  const allVisibleSelected = sortedGroups.length > 0 && sortedGroups.every((group) => selectedFingerprints.has(group.fingerprint));
  const stageFocusEntries = Object.entries(
    sortedGroups.reduce<Record<string, number>>((acc, group) => {
      const latest = group.reports[0];
      const stage = latest?.likelyStageBlame?.likelyStage ?? "unknown";
      acc[stage] = (acc[stage] ?? 0) + group.totalCount;
      return acc;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1]);

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      return adminFetch<{ success: true; deletedCount: number }>("/api/reports", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
    },
    onSuccess: (data) => {
      setSelectedFingerprints(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/reports/grouped"] });
      toast({
        title: "Reports deleted",
        description: `Removed ${data.deletedCount} report${data.deletedCount === 1 ? "" : "s"} from the queue.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to delete selected reports.",
        variant: "destructive",
      });
    },
  });

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "freq" ? "desc" : "asc");
  }

  function SortHeader({ label, value }: { label: string; value: SortKey }) {
    const isActive = sortKey === value;
    const Icon = !isActive ? ArrowUpDown : sortDirection === "asc" ? ArrowUp : ArrowDown;

    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 -ml-2 font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => toggleSort(value)}
      >
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" />
      </Button>
    );
  }

  function toggleFingerprint(fingerprint: string, checked: boolean | "indeterminate") {
    setSelectedFingerprints((current) => {
      const next = new Set(current);
      if (checked === true) {
        next.add(fingerprint);
      } else {
        next.delete(fingerprint);
      }
      return next;
    });
  }

  function toggleAllVisible(checked: boolean | "indeterminate") {
    setSelectedFingerprints((current) => {
      const next = new Set(current);
      if (checked === true) {
        for (const group of sortedGroups) {
          next.add(group.fingerprint);
        }
      } else {
        for (const group of sortedGroups) {
          next.delete(group.fingerprint);
        }
      }
      return next;
    });
  }

  function handleDeleteSelected() {
    if (selectedReportIds.length === 0 || deleteMutation.isPending) return;
    const confirmed = window.confirm(
      `Delete ${selectedReportIds.length} report${selectedReportIds.length === 1 ? "" : "s"} across ${selectedGroups.length} selected issue group${selectedGroups.length === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!confirmed) return;
    deleteMutation.mutate(selectedReportIds);
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="mx-auto w-full max-w-[1600px] px-4 py-8 space-y-8 xl:px-6">
        <div className="flex items-center gap-4 mb-2">
           <Link href="/">
             <Button variant="ghost" size="sm" className="gap-2">
               <ChevronRight className="h-4 w-4 rotate-180" />
               Back to Home
             </Button>
           </Link>
        </div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Failure Queue</h1>
          <p className="text-muted-foreground mt-1">
            Review and resolve citation parsing failures. Grouped by similarity.
          </p>
          <div className="mt-4">
            <Button
              type="button"
              variant={showStageFocus ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setShowStageFocus((current) => !current)}
            >
              <AlertCircle className="h-4 w-4" />
              {showStageFocus ? "Hide Stage Hotspots" : "Show Stage Hotspots"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              See where failures are clustering by stage, such as `extract - 4` or `enrich - 2`.
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {selectedReportIds.length > 0 && (
            <>
              <Badge variant="secondary" className="h-9 px-3 text-xs">
                {selectedReportIds.length} selected
              </Badge>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={handleDeleteSelected}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
                {deleteMutation.isPending ? "Deleting..." : "Delete Selected"}
              </Button>
            </>
          )}
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ReportStatus)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="proposed">Proposed</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="duplicate">Duplicates</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showStageFocus && (
        <Card className="border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-900/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Review Focus By Stage</CardTitle>
          </CardHeader>
          <CardContent>
            {stageFocusEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stage blame data available for the current filter.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stageFocusEntries.map(([stage, count]) => (
                  <Badge key={stage} variant="secondary" className="px-3 py-1 text-xs uppercase tracking-wide">
                    {stage} - {count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400">Total Failures</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unique Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.groups}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Frequency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.groups > 0 ? (stats.total / stats.groups).toFixed(1) : 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[52px]">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleAllVisible}
                      aria-label="Select all visible report groups"
                    />
                  </div>
                </TableHead>
                <TableHead className="w-[80px]">
                  <SortHeader label="Freq" value="freq" />
                </TableHead>
                <TableHead>
                  <SortHeader label="Category" value="category" />
                </TableHead>
                <TableHead>
                  <SortHeader label="Source" value="source" />
                </TableHead>
              <TableHead>Original Citation</TableHead>
              <TableHead>
                <SortHeader label="Target Style" value="targetStyle" />
              </TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                    Loading failure queue...
                  </TableCell>
                </TableRow>
              ) : groups?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                    No reports found for this filter.
                  </TableCell>
                </TableRow>
                ) : (
                  sortedGroups.map((group) => {
                    const latest = group.reports[0];
                    return (
                      <TableRow key={group.fingerprint} className="group hover:bg-muted/50">
                        <TableCell>
                          <div className="flex items-center justify-center">
                            <Checkbox
                              checked={selectedFingerprints.has(group.fingerprint)}
                              onCheckedChange={(checked) => toggleFingerprint(group.fingerprint, checked)}
                              aria-label={`Select report group ${latest.originalText}`}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-bold">
                            {group.totalCount}x
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const categories = getReportCategories(latest, group.category);
                            const primaryCategory = categories[0] ?? group.category;

                            return (
                              <TooltipProvider delayDuration={150}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="inline-flex items-center gap-1.5">
                                      <Badge variant="outline" className="capitalize border-border/70 bg-background/80">
                                        {primaryCategory.replace("-", " ")}
                                      </Badge>
                                      {categories.length > 2 && (
                                        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                          +{categories.length - 1}
                                        </span>
                                      )}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    <div className="space-y-1">
                                      <p className="font-semibold">Reported categories</p>
                                      <ul className="space-y-1">
                                        {categories.map((category) => (
                                          <li key={category} className="capitalize">
                                            {category.replace("-", " ")}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {latest.source === "user" ? (
                              <Users className="h-3.5 w-3.5 text-blue-500" />
                            ) : latest.source === "user-edit" ? (
                              <Edit className="h-3.5 w-3.5 text-orange-500" />
                            ) : (
                              <Bot className="h-3.5 w-3.5 text-purple-500" />
                            )}
                            <span className="text-xs capitalize">{latest.source.replace("-", " ")}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <div className="truncate font-mono text-xs" title={latest.originalText}>
                            {latest.originalText}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase text-[10px]">
                            {latest.outputStyle}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <StageBadge report={latest} />
                            {latest.likelyStageBlame && latest.likelyStageBlame.confidence < 0.5 && (
                              <span className="text-[10px] text-muted-foreground">uncertain</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {latest.assigneeName ? (
                              <Badge variant="secondary" className="text-[10px]">
                                <GitBranch className="mr-1 h-3 w-3" />
                                {latest.assigneeName}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                Unassigned
                              </Badge>
                            )}
                            {latest.truthId && (
                              <Badge variant="outline" className="text-[10px]">
                                <ShieldCheck className="mr-1 h-3 w-3" />
                                Truth
                              </Badge>
                            )}
                            {latest.regressionFixtureId && (
                              <Badge variant="outline" className="text-[10px]">
                                <AlertCircle className="mr-1 h-3 w-3" />
                                Regression
                              </Badge>
                            )}
                            {!!latest.reviewEvents?.length && (
                              <Badge variant="outline" className="text-[10px]">
                                <MessageSquare className="mr-1 h-3 w-3" />
                                {latest.reviewEvents.length}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/admin/reports/${latest.id}`}>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
