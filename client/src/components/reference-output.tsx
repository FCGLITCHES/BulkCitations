import React, { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Download,
  FileText,
  FileCode,
  Database,
  Copy,
  Edit,
  ChevronDown,
  Check,
  ClipboardList,
  ShieldCheck,
  ShieldAlert
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Cluster, ConvertedReference, DuplicateGroup, type AssertionHighlight, type HealthState } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { computeReferenceHealth } from "@/lib/referenceHealth";
import jsPDF from 'jspdf';

import { ScholarPreview } from "./ScholarPreview";
import ReportButton from "./ReportButton";

interface ReferenceOutputProps {
  convertedReferences: ConvertedReference[];
  clusters?: Cluster[];
  duplicateGroups?: DuplicateGroup[];
  engineVersion?: "v1" | "v2";
  groupDuplicates?: boolean;
  onError: (error: string) => void;
  isPro?: boolean;
  onRecheck?: (referenceId: string) => void;
  onResolveAuthors?: (refId: string, newAuthors: string[]) => Promise<void>;
}

const INPUT_STYLE_LABELS: Record<string, string> = {
  auto: "Auto-detect",
  apa: "APA",
  mla: "MLA",
  harvard: "Harvard",
  chicago: "Chicago",
  ieee: "IEEE",
  vancouver: "Vancouver",
};

function normalizeMultilineValue(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inputSuggestsLocator(originalText: string) {
  return /\bpp?\.?\s*[A-Z]?\d|\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d|\b\d+\(\d+\)\s*:\s*[A-Z]?\d|\bS\d+(?:[-–]S?\d+)?\b/i.test(originalText);
}

function outputPreservesLocator(refData: ConvertedReference) {
  const parsedPages = String(refData.parsedData?.pages ?? "").trim();
  const parsedArticleNumber = String((refData.parsedData as any)?.["article-number"] ?? "").trim();
  const convertedText = String(refData.convertedText ?? "");

  if (parsedPages || parsedArticleNumber) return true;
  if (/\bpp?\.?\s*[A-Z]?\d|\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d|\bS\d+(?:[-–]S?\d+)?\b/i.test(convertedText)) {
    return true;
  }

  return /\b(?:e|E)\d{4,}\b/.test(convertedText);
}

// ---------------------------------------------------------------------------
// Helper: Render citation text with inline underline highlights for failed assertions
// ---------------------------------------------------------------------------
function HighlightedCitationText({ text, highlights }: { text: string; highlights?: AssertionHighlight[] }) {
  const processedHtml = useMemo(() => {
    let html = text;

    // Apply highlights FIRST — indices were computed on the raw text (with * markers),
    // so they must be applied before the *→<em> conversion shifts offsets.
    if (highlights && highlights.length > 0) {
      const sorted = [...highlights].sort((a, b) => b.start - a.start);
      for (const h of sorted) {
        if (h.start < 0 || h.end > text.length || h.start >= h.end) continue;
        const before = html.substring(0, h.start);
        const segment = html.substring(h.start, h.end);
        const after = html.substring(h.end);
        const color = h.severity === 'error' ? 'var(--destructive, #ef4444)' : '#f59e0b';
        html = `${before}<span class="assertion-highlight" style="text-decoration: wavy underline ${color}; text-underline-offset: 3px; cursor: help;" title="${h.message.replace(/"/g, '&quot;')}">${segment}</span>${after}`;
      }
    }

    // Then convert *text* to <em>text</em> for italics
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    return html;
  }, [text, highlights]);

  return (
    <p className="text-foreground leading-relaxed flex-1 min-w-0 font-medium text-sm sm:text-base break-words"
      dangerouslySetInnerHTML={{ __html: processedHtml }}
    />
  );
}

function buildDuplicateDiffMarkup(text: string, compareText?: string): { html: string; differenceCount: number } {
  if (!compareText || compareText === text) {
    return { html: text, differenceCount: 0 };
  }

  const textTokens = text.match(/\s+|[^\s]+/g) ?? [text];
  const compareTokens = compareText.match(/\s+|[^\s]+/g) ?? [compareText];
  const textWords = textTokens
    .map((token, index) => ({ token, index, normalized: token.replace(/[.,;:()[\]{}"']/g, "").toLowerCase() }))
    .filter((entry) => entry.normalized && !/^\s+$/.test(entry.token));
  const compareWords = compareTokens
    .map((token) => ({ normalized: token.replace(/[.,;:()[\]{}"']/g, "").toLowerCase() }))
    .filter((entry) => entry.normalized);

  const dp = Array.from({ length: textWords.length + 1 }, () => Array(compareWords.length + 1).fill(0));
  for (let i = textWords.length - 1; i >= 0; i -= 1) {
    for (let j = compareWords.length - 1; j >= 0; j -= 1) {
      if (textWords[i].normalized === compareWords[j].normalized) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const matchedIndexes = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < textWords.length && j < compareWords.length) {
    if (textWords[i].normalized === compareWords[j].normalized) {
      matchedIndexes.add(textWords[i].index);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  let differenceCount = 0;
  const html = textTokens.map((token, index) => {
    if (/^\s+$/.test(token)) return token;
    const normalized = token.replace(/[.,;:()[\]{}"']/g, "").toLowerCase();
    if (!normalized || matchedIndexes.has(index)) return token;
    differenceCount += 1;
    return `<mark class="rounded bg-amber-500/20 px-0.5 text-amber-200">${token}</mark>`;
  }).join("");

  return { html, differenceCount };
}

// ---------------------------------------------------------------------------
// Sub-Component: AssertionBadge
// Shows "APA: 9/10 ✓" style badge
// ---------------------------------------------------------------------------
function AssertionBadge({ summary, style }: { summary: ConvertedReference['assertionSummary']; style: string }) {
  if (!summary || summary.total === 0) return null;

  const styleLabel = style?.toUpperCase().replace('-CTR', '').replace('-AD', ' AD').replace('-NB', ' NB') || 'STYLE';
  const allPassed = summary.failed === 0;
  const hasCritical = summary.failedCritical > 0;

  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'outline';
  let icon = null;
  if (allPassed) {
    variant = 'default';
    icon = <ShieldCheck className="w-3 h-3 mr-1" />;
  } else if (hasCritical) {
    variant = 'destructive';
    icon = <ShieldAlert className="w-3 h-3 mr-1" />;
  } else {
    variant = 'secondary';
    icon = <ShieldAlert className="w-3 h-3 mr-1" />;
  }

  const failedRules = summary.details.filter(d => !d.passed);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={variant}
            className="cursor-help flex items-center text-xs ml-2"
            aria-label={`${styleLabel} assertion results: ${summary.passed} of ${summary.total} rules passed`}
          >
            {icon}
            {styleLabel}: {summary.passed}/{summary.total} {allPassed ? '✓' : '⚠'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-semibold">Assertion Results</p>
            {allPassed ? (
              <p className="text-primary">All {summary.total} style rules passed.</p>
            ) : (
              <>
                <p>{summary.failed} rule{summary.failed > 1 ? 's' : ''} failed:</p>
                <ul className="list-disc pl-3 space-y-0.5">
                  {failedRules.map(r => (
                    <li key={r.id} className={r.severity === 'error' ? 'text-destructive' : 'text-amber-600'}>
                      {r.description}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Sub-Component: CitationRow
// Handles rendering of an individual citation with its Copy/Edit actions
// ---------------------------------------------------------------------------
function CitationRow({
  refData,
  handleCopyReference,
  copiedStates,
  getReferenceTypeLabel,
  isPro,
  onRecheck,
  showDebug,
  showInputFormat,
  reportedIds,
  onReported,
  isFailed,
  userEditedText,
  onSaveEdit,
  health,
  extraActions,
  diffAgainstText,
  showOriginalInput,
}: {
  refData: ConvertedReference;
  handleCopyReference: (id: string, text: string) => void;
  copiedStates: Record<string, boolean>;
  getReferenceTypeLabel: (type: string) => string;
  isPro?: boolean;
  onRecheck?: (referenceId: string) => void;
  showDebug?: boolean;
  showInputFormat?: boolean;
  reportedIds?: Set<string>;
  onReported?: (refId: string) => void;
  isFailed?: boolean;
  userEditedText?: string;
  onSaveEdit?: (id: string, newText: string) => void;
  health?: { state: HealthState; reasons: string[] };
  extraActions?: React.ReactNode;
  diffAgainstText?: string;
  showOriginalInput?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const [isExpanded, setIsExpanded] = useState(false);

  const rowWarnings: string[] = [];
  const shouldWarnDroppedLocator =
    ['journal', 'conference', 'bookChapter'].includes(refData.referenceType)
    && inputSuggestsLocator(refData.originalText)
    && !outputPreservesLocator(refData);
  if (shouldWarnDroppedLocator) {
    rowWarnings.push("Input locator was not preserved in the output");
  }
  if (!refData.parsedData?.publisher && refData.referenceType === 'book') {
    rowWarnings.push("Incomplete: publisher missing");
  }
  const citationText = userEditedText ?? refData.convertedText;
  const duplicateDiffMarkup = useMemo(
    () => (diffAgainstText ? buildDuplicateDiffMarkup(citationText, diffAgainstText) : null),
    [citationText, diffAgainstText],
  );
  const isLongCitation = citationText.length > 150;
  const confidenceBadge = refData.confidence ? (
    <ScholarPreview
      confidence={refData.confidence}
      authorityData={refData.authorityData}
      authorityStatus={refData.authorityStatus}
      isPro={isPro}
      referenceId={refData.id}
      onRecheck={onRecheck}
      healthState={health?.state}
    />
  ) : null;

  const otherBadges = (
    <>
      {refData.referenceType && (
        <Badge variant="outline" className="text-xs">
          {getReferenceTypeLabel(refData.referenceType)}
        </Badge>
      )}

      {showInputFormat && (
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs shrink-0">
          From {INPUT_STYLE_LABELS[refData.inputStyle] ?? refData.inputStyle}
        </Button>
      )}

      {refData.styleDetectionFailed && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="text-xs cursor-help">
                Auto-detect uncertain
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <p>
                The input didn&apos;t strongly match APA, MLA, Harvard, Chicago, IEEE, or Vancouver patterns.
                The parser fell back to a best guess, so type and field mapping may be less reliable.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {refData.assertionSummary && (
        <AssertionBadge summary={refData.assertionSummary} style={refData.outputStyle} />
      )}
    </>
  );

  const healthBadge = health ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={
              health.state === "clean"
                ? "outline"
                : "outline"
            }
            className={`text-xs cursor-help flex items-center gap-1 ${
              health.state === "clean"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : health.state === "review"
                  ? "border-amber-500/40 text-amber-100"
                  : "border-red-500/40 bg-red-500/15 text-red-100"
            }`}
          >
            {health.state === "clean" && <ShieldCheck className="w-3 h-3" />}
            {health.state === "review" && <ClipboardList className="w-3 h-3" />}
            {health.state === "action_needed" && <ShieldAlert className="w-3 h-3" />}
            <span>
              {health.state === "clean"
                ? "Ready"
                : health.state === "review"
                  ? "Review"
                  : "Needs fix"}
            </span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs space-y-1">
          <p className="font-semibold">
            {health.state === "clean"
              ? "Ready to submit."
              : health.state === "review"
                ? "Looks good overall; a quick review is suggested."
                : "Needs attention before submission."}
          </p>
          {health.reasons.length > 0 && (
            <ul className="list-disc pl-3 space-y-0.5">
              {health.reasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          )}
          {rowWarnings.length > 0 && (
            <ul className="list-disc pl-3 space-y-0.5 mt-1">
              {rowWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;

  const citationBadges = (
    <>
      {healthBadge}
      {otherBadges}
      {confidenceBadge}
    </>
  );
  const originalInputLines = useMemo(
    () => normalizeMultilineValue(refData.originalText),
    [refData.originalText],
  );
  const shouldShowOriginalInput = showOriginalInput && originalInputLines.length > 0;

  return (
    <Card
      className={`border-l-4 mb-4 ${
        health?.state === "action_needed"
          ? "border-l-destructive bg-destructive/5"
          : health?.state === "review"
            ? "border-l-amber-400"
            : "border-l-primary"
      }`}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-3 min-w-0">
          {isEditing ? (
            <div className="w-full space-y-2">
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full min-h-[5rem] text-sm leading-relaxed font-sans mt-2"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { onSaveEdit?.(refData.id, editText); setIsEditing(false); }}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="w-full">
              <div
                className={`${isExpanded ? "" : "line-clamp-3 sm:line-clamp-none transition-all duration-300"} cursor-pointer sm:cursor-auto`}
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {duplicateDiffMarkup && duplicateDiffMarkup.differenceCount > 0 ? (
                  <p
                    className="text-foreground leading-relaxed flex-1 min-w-0 font-medium text-sm sm:text-base break-words"
                    dangerouslySetInnerHTML={{ __html: duplicateDiffMarkup.html }}
                  />
                ) : (
                  <HighlightedCitationText
                    text={citationText}
                    highlights={refData.assertionHighlights}
                  />
                )}
              </div>
              {duplicateDiffMarkup && duplicateDiffMarkup.differenceCount > 0 && (
                <p className="mt-2 text-xs text-amber-300">
                  Highlighted text shows what differs from the selected version.
                </p>
              )}
              {shouldShowOriginalInput && (
                <div className="mt-3 rounded-lg border border-dashed border-border/70 bg-background/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Original Input
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Compare against the converted citation above
                    </span>
                  </div>
                  <div className="space-y-1 font-mono text-xs text-muted-foreground">
                    {originalInputLines.map((line, index) => (
                      <div key={`${refData.id}-original-${index}`} className="break-words">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!isExpanded && isLongCitation && (
                <button
                  onClick={() => setIsExpanded(true)}
                  className="text-xs text-muted-foreground mt-1 hover:text-primary sm:hidden inline-flex items-center"
                >
                  <ChevronDown className="w-3 h-3 mr-1" />
                  Read more
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 pt-3 border-t border-muted">
          <Collapsible className="sm:hidden w-full">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Citation Details</span>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-muted/50">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-2 text-left">
              <div className="flex flex-wrap items-center gap-2">
                {citationBadges}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="hidden sm:flex flex-col gap-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2 min-w-0">{citationBadges}</div>

            <div className="flex items-center gap-2 flex-shrink-0 w-full justify-end border-t border-muted/50 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!isEditing) {
                    setEditText(citationText);
                    setIsEditing(true);
                  }
                }}
                className="text-xs text-foreground hover:bg-muted hover:text-foreground"
                title="Edit citation"
              >
                <Edit className="h-3 w-3 mr-1" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopyReference(refData.id, userEditedText ?? refData.convertedText)}
                className="text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {copiedStates[refData.id] ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
              {extraActions}
              <ReportButton
                rawInput={refData.originalText}
                detectedInputStyle={refData.inputStyle}
                targetStyle={refData.outputStyle}
                convertedOutput={citationText}
                reported={reportedIds?.has(refData.id)}
                onReported={onReported ? () => onReported(refData.id) : undefined}
              />
            </div>
          </div>

          <div className="sm:hidden flex items-center gap-2 w-full justify-end border-t border-muted/50 pt-3 mt-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (!isEditing) {
                  setEditText(citationText);
                  setIsEditing(true);
                }
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground h-8 w-8"
              title="Edit citation"
            >
              <Edit className="h-4 w-4" />
              <span className="sr-only">Edit</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleCopyReference(refData.id, userEditedText ?? refData.convertedText)}
              className="text-muted-foreground hover:bg-muted hover:text-foreground h-8 w-8"
              title="Copy citation"
            >
              {copiedStates[refData.id] ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
            {extraActions}
            <ReportButton
              rawInput={refData.originalText}
              detectedInputStyle={refData.inputStyle}
              targetStyle={refData.outputStyle}
              convertedOutput={citationText}
              reported={reportedIds?.has(refData.id)}
              onReported={onReported ? () => onReported(refData.id) : undefined}
            />
          </div>

          {showDebug && (
            <div className="mt-3 pt-3 border-t border-muted text-xs font-mono bg-muted/50 rounded p-2">
              <div><strong>authorityStatus:</strong> {refData.authorityStatus ?? "—"}</div>
              {refData.patternHits && refData.patternHits.length > 0 && (
                <div className="mt-1"><strong>patternHits:</strong> {refData.patternHits.map((h) => `${h.id}(${h.fields.join(",")})`).join(", ")}</div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
const SCROLL_THRESHOLD = 300; // same as ScrollToTop so bar shifts when button appears
const SHOW_ZERO_DUPLICATES_IN_UI = !import.meta.env.PROD;

export default function ReferenceOutput({
  convertedReferences,
  clusters = [],
  duplicateGroups = [],
  engineVersion = "v1",
  groupDuplicates = true,
  onError,
  isPro = false,
  onRecheck,
}: ReferenceOutputProps) {
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);
  const [showInputFormat, setShowInputFormat] = useState(true);
  const [showOriginalInput, setShowOriginalInput] = useState(false);
  const [allCopied, setAllCopied] = useState(false);
  const [showNumbered, setShowNumbered] = useState(false);
  const [keepItalics, setKeepItalics] = useState(false);
  const [hasShownDoiToast, setHasShownDoiToast] = useState(false);
  const [healthFilter, setHealthFilter] = useState<HealthState | "all">("all");
  const [isScrollPastThreshold, setIsScrollPastThreshold] = useState(false);
  const [selectedDuplicates, setSelectedDuplicates] = useState<Record<string, string>>({});

  useEffect(() => {
    const onScroll = () => setIsScrollPastThreshold(window.scrollY > SCROLL_THRESHOLD);
    onScroll(); // set initial
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const [userEdits, setUserEdits] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const healthById = useMemo(() => {
    const map: Record<string, { state: HealthState; reasons: string[] }> = {};
    for (const ref of convertedReferences) {
      const health = computeReferenceHealth(ref);
      map[ref.id] = health;
    }
    return map;
  }, [convertedReferences]);

  const detectedGroups = useMemo(() => {
    if (engineVersion === "v2") {
      return duplicateGroups.map((group) => ({
        groupId: group.groupId,
        primaryId: group.primaryId,
        members: group.members,
        label: `${group.members.length - 1} duplicate${group.members.length - 1 === 1 ? "" : "s"}`,
      }));
    }

    return clusters.map((cluster) => ({
      groupId: cluster.clusterId,
      primaryId: cluster.bestMemberId ?? cluster.members[0]?.id ?? "",
      members: cluster.members,
      label: `${Math.max(0, cluster.members.length - 1)} similar version${cluster.members.length - 1 === 1 ? "" : "s"}`,
    })).filter((group) => group.members.length > 1 && group.primaryId);
  }, [clusters, duplicateGroups, engineVersion]);

  const displayGroups = useMemo(
    () => (groupDuplicates ? detectedGroups : []),
    [detectedGroups, groupDuplicates],
  );

  const groupedReferenceIds = useMemo(
    () => new Set(displayGroups.flatMap((group) => group.members.map((member) => member.id))),
    [displayGroups],
  );

  useEffect(() => {
    setSelectedDuplicates((prev) => {
      let changed = false;
      const next: Record<string, string> = {};

      for (const group of detectedGroups) {
        const memberIds = new Set(group.members.map((member) => member.id));
        const existingSelection = prev[group.groupId];
        const nextSelection = existingSelection && memberIds.has(existingSelection)
          ? existingSelection
          : group.primaryId;

        next[group.groupId] = nextSelection;
        if (prev[group.groupId] !== nextSelection) changed = true;
      }

      if (!changed) {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (
          prevKeys.length === nextKeys.length
          && nextKeys.every((key) => prev[key] === next[key])
        ) {
          return prev;
        }
      }

      return next;
    });
  }, [detectedGroups]);

  const visibleReferences = useMemo(
    () =>
      healthFilter === "all"
        ? convertedReferences
        : convertedReferences.filter((r) => healthById[r.id]?.state === healthFilter),
    [healthFilter, convertedReferences, healthById]
  );

  const handleSaveEdit = async (id: string, newText: string) => {
    setUserEdits(prev => ({ ...prev, [id]: newText }));
    
    // Auto-report the edit to the admin queue
    const refData = convertedReferences.find(r => r.id === id);
    if (refData && newText !== refData.convertedText) {
      try {
        await fetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "user-edit", // Distinguish from manual "Wrong?" reports
            originalText: refData.originalText,
            detectedStyle: refData.inputStyle,
            outputStyle: refData.outputStyle,
            convertedText: refData.convertedText,
            proposedStyleFix: newText, // The user's "ground truth" correction
            failureCategory: "other",
            parsedData: refData.parsedData,
            referenceType: refData.referenceType,
            confidence: refData.confidence,
            status: "proposed" // Mark as proposed fix ready for admin review
          }),
        });
      } catch (err) {
        console.warn("[ReferenceOutput] Failed to auto-report edit:", err);
      }
    }

    toast({ title: "Edits Saved", description: "Your changes have been saved and sent for review." });
  };

  useEffect(() => {
    if (hasShownDoiToast) return;
    if (!convertedReferences.some((ref) => /doi:|https?:\/\/doi\.org/i.test(ref.originalText))) return;

    setHasShownDoiToast(true);
    const timer = window.setTimeout(() => {
      toast({
        title: "DOIs Removed",
        description: "DOI fields were detected in your input. Per strict style rules, DOIs have been stripped from the output.",
        variant: "default",
      });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [convertedReferences, hasShownDoiToast, toast]);

  // Function to clean text for copying
  const cleanTextForCopy = (text: string): string => {
    if (keepItalics) {
      // Keep asterisks for italics formatting
      return text;
    } else {
      // Remove asterisks that are used for italics formatting
      return text.replace(/\*/g, '');
    }
  };

  const handleCopyReference = async (refId: string, text: string) => {
    try {
      const cleanedText = cleanTextForCopy(text);
      await navigator.clipboard.writeText(cleanedText);
      setCopiedStates(prev => ({ ...prev, [refId]: true }));
      toast({
        title: "Copied!",
        description: "Reference copied to clipboard",
      });

      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [refId]: false }));
      }, 2000);
    } catch (error) {
      onError("Failed to copy reference to clipboard");
    }
  };

  const handleCopyAll = async () => {
    try {
      const isIEEE = visibleReferences[0]?.outputStyle === "ieee";
      const allText = visibleReferences.map((ref, index) => {
        let cleanedText = cleanTextForCopy(userEdits[ref.id] ?? ref.convertedText);
        if (isIEEE && /^\[\d+\]\s*/.test(cleanedText)) {
          cleanedText = cleanedText.replace(/^\[\d+\]\s*/, `[${index + 1}] `);
        }
        if (showNumbered && !isIEEE) {
          return `${index + 1}. ${cleanedText}`;
        }
        return cleanedText;
      }).join('\n');

      await navigator.clipboard.writeText(allText);
      setAllCopied(true);
      toast({
        title: "All Copied!",
        description: `${visibleReferences.length} references copied to clipboard`,
      });

      // Reset copied state after 2 seconds
      setTimeout(() => {
        setAllCopied(false);
      }, 2000);
    } catch (error) {
      onError("Failed to copy references to clipboard");
    }
  };

  const handleDownloadPDF = async () => {
    try {
      const pdf = new jsPDF();
      const pageHeight = pdf.internal.pageSize.height;
      const margin = 20;
      let yPosition = margin;

      // Title
      pdf.setFontSize(16);
      pdf.text('Converted References', margin, yPosition);
      yPosition += 15;

      // Add references
      pdf.setFontSize(11);
      const isIEEE = convertedReferences[0]?.outputStyle === "ieee";
      convertedReferences.forEach((ref, index) => {
        let text = userEdits[ref.id] ?? ref.convertedText;
        if (isIEEE && /^\[\d+\]\s*/.test(text)) {
          text = text.replace(/^\[\d+\]\s*/, `[${index + 1}] `);
        }
        if (showNumbered && !isIEEE) {
          text = `${index + 1}. ${text}`;
        }
        const lines = pdf.splitTextToSize(text, pdf.internal.pageSize.width - 2 * margin);

        // Check if we need a new page
        if (yPosition + (lines.length * 6) > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
        }

        pdf.text(lines, margin, yPosition);
        yPosition += lines.length * 6 + 2; // Line height + single line gap
      });

      pdf.save('converted-references.pdf');
      toast({
        title: "PDF Downloaded!",
        description: "References exported as PDF",
      });
    } catch (error) {
      onError("Failed to generate PDF");
    }
  };

  const handleDownloadTxt = async () => {
    try {
      const response = await apiRequest("POST", "/api/export/txt", {
        references: convertedReferences.map(r => ({ ...r, convertedText: userEdits[r.id] ?? r.convertedText }))
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'references.txt';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Downloaded!",
        description: "References downloaded as TXT file",
      });
    } catch (error) {
      onError("Failed to download TXT file");
    }
  };

  const handleDownloadBibtex = async () => {
    try {
      const response = await apiRequest("POST", "/api/export/bibtex", {
        references: convertedReferences.map(r => ({ ...r, convertedText: userEdits[r.id] ?? r.convertedText }))
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'references.bib';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Downloaded!",
        description: "References downloaded as BibTeX file",
      });
    } catch (error) {
      onError("Failed to download BibTeX file");
    }
  };

  const handleDownloadRis = async () => {
    try {
      const response = await apiRequest("POST", "/api/export/ris", {
        references: convertedReferences.map(r => ({ ...r, convertedText: userEdits[r.id] ?? r.convertedText }))
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'references.ris';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Downloaded!",
        description: "References downloaded as RIS file",
      });
    } catch (error) {
      onError("Failed to download RIS file");
    }
  };

  const getReferenceTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      journal: 'Journal Article',
      book: 'Book',
      bookChapter: 'Book Chapter',
      conference: 'Conference Paper',
      website: 'Website',
      report: 'Report',
      thesis: 'Thesis',
      other: 'Other'
    };
    return types[type] || 'Unknown';
  };

  const healthStats = useMemo(() => {
    const total = convertedReferences.length;
    let clean = 0;
    let review = 0;
    let actionNeeded = 0;

    for (const ref of convertedReferences) {
      const health = healthById[ref.id];
      if (!health) continue;
      if (health.state === "clean") clean += 1;
      else if (health.state === "review") review += 1;
      else if (health.state === "action_needed") actionNeeded += 1;
    }

    const duplicates =
      detectedGroups.reduce((sum, group) => sum + Math.max(0, group.members.length - 1), 0);

    return { total, clean, review, actionNeeded, duplicates };
  }, [convertedReferences, detectedGroups, healthById]);

  useEffect(() => {
    if (!healthStats.total) return;
    // Lightweight instrumentation hook for future tuning of thresholds.
    // eslint-disable-next-line no-console
    console.debug("referenceHealthDistribution", healthStats);
  }, [healthStats]);

  if (convertedReferences.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-muted-foreground mb-4">
          <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No converted references yet</p>
          <p className="text-sm">Convert some references to see them here</p>
        </div>
      </div>
    );
  }

  const cleanPct = healthStats.total ? (healthStats.clean / healthStats.total) * 100 : 0;
  const reviewPct = healthStats.total ? (healthStats.review / healthStats.total) * 100 : 0;
  const actionPct = healthStats.total ? (healthStats.actionNeeded / healthStats.total) * 100 : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Reference Health Bar */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
        <div className="p-3 sm:p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">Reference Health</h4>
            <span className="text-xs font-medium text-muted-foreground">
              {healthStats.total} total
            </span>
          </div>

          <div className="h-2 w-full flex rounded-full overflow-hidden flex-nowrap bg-muted">
            {cleanPct > 0 && <div style={{ width: `${cleanPct}%` }} className="bg-emerald-500" />}
            {reviewPct > 0 && <div style={{ width: `${reviewPct}%` }} className="bg-amber-400" />}
            {actionPct > 0 && <div style={{ width: `${actionPct}%` }} className="bg-red-500" />}
          </div>

          <div className="flex flex-col gap-1 mt-1 text-[13px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={`flex items-center gap-1.5 underline-offset-2 ${healthFilter === "clean"
                  ? "font-bold text-foreground underline"
                  : "font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
                  }`}
                onClick={() =>
                  setHealthFilter(prev => (prev === "clean" ? "all" : "clean"))
                }
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>
                  {healthStats.clean} ready
                </span>
              </button>
              <span className="text-muted-foreground/40 font-bold">&middot;</span>
              <button
                type="button"
                className={`flex items-center gap-1.5 underline-offset-2 ${healthFilter === "review"
                  ? "font-bold text-foreground underline"
                  : "font-bold text-amber-700 dark:text-amber-400 hover:underline"
                  }`}
                onClick={() =>
                  setHealthFilter(prev => (prev === "review" ? "all" : "review"))
                }
              >
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>
                  {healthStats.review} worth reviewing
                </span>
              </button>
              <span className="text-muted-foreground/40 font-bold">&middot;</span>
              <button
                type="button"
                className={`flex items-center gap-1.5 underline-offset-2 ${healthFilter === "action_needed"
                  ? "font-bold text-foreground underline"
                  : "font-bold text-red-700 dark:text-red-400 hover:underline"
                  }`}
                onClick={() =>
                  setHealthFilter(prev =>
                    prev === "action_needed" ? "all" : "action_needed"
                  )
                }
              >
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span>
                  {healthStats.actionNeeded} action needed
                  {healthFilter === "action_needed" ? " (showing only these)" : ""}
                </span>
              </button>
            </div>
            {(healthStats.duplicates > 0 || SHOW_ZERO_DUPLICATES_IN_UI) && (
              <div className="text-[11px] text-muted-foreground">
                Includes {healthStats.duplicates} likely duplicate
                {healthStats.duplicates === 1 ? "" : "s"}.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="rounded"
            />
            Show parsing details
          </label>
          <Button
            variant={showInputFormat ? "default" : "outline"}
            size="sm"
            className="text-xs sm:text-sm"
            onClick={() => setShowInputFormat((prev) => !prev)}
          >
            {showInputFormat ? "Hide detected source style" : "Show detected source style"}
          </Button>
          <Badge variant="outline" className="text-xs">
            Engine {engineVersion.toUpperCase()}
          </Badge>
          <Button
            variant={showOriginalInput ? "default" : "outline"}
            size="sm"
            className="text-xs sm:text-sm"
            onClick={() => setShowOriginalInput((prev) => !prev)}
          >
            {showOriginalInput ? "Hide original input" : "Show original input for all"}
          </Button>
        </div>
      </div>

      {/* Output Display */}
      <div className="bg-muted/50 rounded-lg p-3 sm:p-4 min-h-[200px] overflow-x-auto">
        {displayGroups.map((group, index) => {
          const selectedId = selectedDuplicates[group.groupId] ?? group.primaryId;
          const filteredMembers =
            healthFilter === "all"
              ? group.members
              : group.members.filter((member) => healthById[member.id]?.state === healthFilter);
          if (filteredMembers.length === 0) return null;

          const mainRef =
            filteredMembers.find((member) => member.id === selectedId)
            ?? filteredMembers.find((member) => member.id === group.primaryId)
            ?? filteredMembers[0];
          if (!mainRef) return null;

          const duplicates = filteredMembers.filter((member) => member.id !== mainRef.id);

          return (
            <div key={group.groupId} className="mb-6 relative">
              <div className="absolute -left-3 top-0 bottom-0 w-1 bg-primary/20 rounded-l" />
              <CitationRow
                refData={mainRef}
                handleCopyReference={handleCopyReference}
                copiedStates={copiedStates}
                getReferenceTypeLabel={getReferenceTypeLabel}
                isPro={isPro}
                onRecheck={onRecheck}
                showDebug={showDebug}
                showInputFormat={showInputFormat}
                reportedIds={reportedIds}
                onReported={(id) => setReportedIds((prev) => new Set(prev).add(id))}
                isFailed={healthById[mainRef.id]?.state === "action_needed"}
                userEditedText={userEdits[mainRef.id]}
                onSaveEdit={handleSaveEdit}
                health={healthById[mainRef.id]}
                showOriginalInput={showOriginalInput}
              />

              {duplicates.length > 0 && (
                <Collapsible className="pl-6 border-l-2 border-muted -mt-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground w-full justify-start pl-2 hover:bg-muted mb-2">
                      <ChevronDown className="h-3 w-3 mr-1" />
                      Reveal {duplicates.length} duplicate{duplicates.length === 1 ? "" : "s"}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-3">
                      {duplicates.map((dup) => {
                        const isSelected = dup.id === selectedId;
                        return (
                          <div key={dup.id} className="relative">
                            <CitationRow
                              refData={dup}
                              handleCopyReference={handleCopyReference}
                              copiedStates={copiedStates}
                              getReferenceTypeLabel={getReferenceTypeLabel}
                              isPro={isPro}
                              onRecheck={onRecheck}
                              showDebug={showDebug}
                              showInputFormat={showInputFormat}
                              reportedIds={reportedIds}
                              onReported={(id) => setReportedIds((prev) => new Set(prev).add(id))}
                              isFailed={healthById[dup.id]?.state === "action_needed"}
                              userEditedText={userEdits[dup.id]}
                              onSaveEdit={handleSaveEdit}
                              health={healthById[dup.id]}
                              showOriginalInput={showOriginalInput}
                              diffAgainstText={userEdits[mainRef.id] ?? mainRef.convertedText}
                              extraActions={
                                <Button
                                  type="button"
                                  variant={isSelected ? "default" : "ghost"}
                                  size="sm"
                                  onClick={() => setSelectedDuplicates((prev) => ({ ...prev, [group.groupId]: dup.id }))}
                                  className="text-xs"
                                >
                                  {isSelected ? "Selected version" : "Select this version"}
                                </Button>
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          );
        })}

        {visibleReferences
          .filter((ref) => !groupDuplicates || !groupedReferenceIds.has(ref.id))
          .map((ref) => (
            <CitationRow
              key={ref.id}
              refData={ref}
              handleCopyReference={handleCopyReference}
              copiedStates={copiedStates}
              getReferenceTypeLabel={getReferenceTypeLabel}
              isPro={isPro}
              onRecheck={onRecheck}
              showDebug={showDebug}
              showInputFormat={showInputFormat}
              reportedIds={reportedIds}
              onReported={(id) => setReportedIds((prev) => new Set(prev).add(id))}
              isFailed={healthById[ref.id]?.state === "action_needed"}
              userEditedText={userEdits[ref.id]}
              onSaveEdit={handleSaveEdit}
              health={healthById[ref.id]}
              showOriginalInput={showOriginalInput}
            />
          ))}
      </div>

      {/* Export Options */}
      <div className="space-y-4 mb-20 sm:mb-0">
        {/* Copy Options */}
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="numbering"
              checked={showNumbered}
              onCheckedChange={(checked) => setShowNumbered(checked === true)}
            />
            <label
              htmlFor="numbering"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Number references (1., 2., 3...)
            </label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="keep-italics"
              checked={keepItalics}
              onCheckedChange={(checked) => setKeepItalics(checked === true)}
            />
            <label
              htmlFor="keep-italics"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Keep italics formatting (*text*) when copying
            </label>
          </div>
        </div>

        {/* Copy All + Download row */}
        <div
          className={`fixed md:relative bottom-4 md:bottom-auto z-40 md:z-auto bg-card/95 md:bg-transparent backdrop-blur-md md:backdrop-blur-none p-3 md:p-0 rounded-xl md:rounded-none shadow-2xl md:shadow-none border border-border md:border-0 flex flex-row md:justify-center gap-2 sm:max-w-[calc(100vw-4.5rem)] md:max-w-none
            ${isScrollPastThreshold ? "left-4 right-[4.5rem] sm:right-[5.5rem] md:left-auto md:right-auto w-auto" : "left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 w-[calc(100vw-3rem)] sm:w-auto"}
          `}
        >
          <Button
            onClick={handleCopyAll}
            variant="default"
            className="flex-1 sm:w-auto h-11 text-sm md:text-base whitespace-nowrap"
            disabled={allCopied}
          >
            {allCopied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <ClipboardList className="mr-2 h-4 w-4" />
                Copy All
              </>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex-1 sm:w-auto md:flex-none flex items-center justify-center gap-2 h-11 text-sm md:text-base">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Download</span>
                <span className="sm:hidden">Save</span>
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 z-50">
              <DropdownMenuItem onClick={handleDownloadTxt}>
                <FileText className="mr-2 h-4 w-4" />
                TXT
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadPDF}>
                <Download className="mr-2 h-4 w-4" />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadBibtex}>
                <FileCode className="mr-2 h-4 w-4" />
                BibTeX
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadRis}>
                <Database className="mr-2 h-4 w-4" />
                RIS
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
