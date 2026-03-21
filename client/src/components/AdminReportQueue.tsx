import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Navbar } from "@/components/navbar";
import { 
  ChevronRight, 
  Users, 
  Bot,
  Filter,
  Edit,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

interface GroupedReport {
  fingerprint: string;
  reports: CitationReport[];
  totalCount: number;
  category: string;
}

type SortKey = "freq" | "category" | "source" | "targetStyle";
type SortDirection = "asc" | "desc";

export default function AdminReportQueue() {
  const [statusFilter, setStatusFilter] = useState<ReportStatus>("pending");
  const [sortKey, setSortKey] = useState<SortKey>("freq");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

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

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto py-8 px-4 max-w-6xl space-y-8">
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
        </div>
        
        <div className="flex items-center gap-2">
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
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
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    Loading failure queue...
                  </TableCell>
                </TableRow>
              ) : groups?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No reports found for this filter.
                  </TableCell>
                </TableRow>
                ) : (
                  sortedGroups.map((group) => {
                    const latest = group.reports[0];
                    return (
                      <TableRow key={group.fingerprint} className="group hover:bg-muted/50">
                        <TableCell>
                          <Badge variant="secondary" className="font-bold">
                            {group.totalCount}x
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {group.category.replace("-", " ")}
                          </Badge>
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
