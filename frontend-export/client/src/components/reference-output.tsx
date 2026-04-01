import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Download,
  FileText,
  FileCode,
  Code,
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

const REFERENCE_TYPE_LABELS: Record<string, string> = {
  journal: "Journal Article",
  book: "Book",
  bookChapter: "Book Chapter",
  conference: "Conference Paper",
  website: "Website",
  report: "Report",
  thesis: "Thesis",
  other: "Other",
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

type DebugStageKey = "detect" | "extract" | "enrich" | "validate" | "render" | "dedupe";

const DEBUG_STAGE_META: Record<DebugStageKey, { label: string; description: string }> = {
  detect: {
    label: "detect",
    description: "Source-style detection looks uncertain, so downstream parsing may be shaky.",
  },
  extract: {
    label: "extract",
    description: "Core field extraction looks incomplete or unstable, such as authors, title, year, or venue.",
  },
  enrich: {
    label: "enrich",
    description: "Authority or metadata enrichment could not confidently verify the citation.",
  },
  validate: {
    label: "validate",
    description: "Health checks flagged the citation for manual review or further investigation.",
  },
  render: {
    label: "render",
    description: "Output formatting or style assertions indicate the final citation still needs cleanup.",
  },
  dedupe: {
    label: "dedupe",
    description: "This citation is part of a duplicate cluster and may need merge or selection review.",
  },
};

function deriveDebugStages(
  ref: ConvertedReference,
  health: { state: HealthState; reasons: string[] } | undefined,
  isInDuplicateGroup: boolean,
) {
  const stages = new Set<DebugStageKey>();
  const warningCodes = (ref.warnings ?? [])
    .map((warning) => warning.match(/^(?:warning|error):\s*([a-z0-9_.-]+)/i)?.[1]?.toLowerCase())
    .filter((code): code is string => Boolean(code));
  const healthReasons = (health?.reasons ?? []).join(" ").toLowerCase();
  const parsed = ref.parsedData ?? {};

  if (ref.styleDetectionFailed) {
    stages.add("detect");
  }

  const missingCoreFields =
    !parsed?.title
    || !parsed?.year
    || !parsed?.authors?.length
    || (!parsed?.journal && !parsed?.conferenceTitle && !parsed?.bookTitle && ["journal", "conference", "bookChapter"].includes(ref.referenceType));
  const extractionWarnings = warningCodes.some((code) => [
    "missing_field",
    "venue_missing_for_conference",
    "author_structure_unstable",
    "connector_as_author",
    "initials_as_surname",
    "missing_locator",
    "locator_missing_from_source",
    "placeholder_journal",
    "placeholder_volume",
  ].includes(code));
  const extractionReasons =
    /required field missing|author names were parsed in an unstable format|placeholder venue|journal or venue is missing|publisher missing/.test(healthReasons);
  if (missingCoreFields || extractionWarnings || extractionReasons) {
    stages.add("extract");
  }

  if (["no_match", "error", "timeout"].includes(ref.authorityStatus ?? "")) {
    stages.add("enrich");
  }

  const assertionFailed = (ref.assertionSummary?.failed ?? 0) > 0;
  const renderWarnings = warningCodes.some((code) => [
    "render_output_empty_or_invalid",
    "missing_locator",
    "locator_missing_from_source",
  ].includes(code));
  if (assertionFailed || renderWarnings) {
    stages.add("render");
  }

  if (health && health.state !== "clean") {
    stages.add("validate");
  }

  if (isInDuplicateGroup) {
    stages.add("dedupe");
  }

  if (stages.size === 0 && health?.state === "action_needed") {
    stages.add("validate");
  }

  return [...stages];
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
  isCopied,
  referenceTypeLabel,
  isPro,
  onRecheck,
  showDebug,
  showInputFormat,
  isReported,
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
  isCopied: boolean;
  referenceTypeLabel: string;
  isPro?: boolean;
  onRecheck?: (referenceId: string) => void;
  showDebug?: boolean;
  showInputFormat?: boolean;
  isReported?: boolean;
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
  const [showDebugTrace, setShowDebugTrace] = useState(false);

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
  const confidenceBadge = showDebug && refData.confidence ? (
    <ScholarPreview
      confidence={refData.confidence}
      authorityData={refData.authorityData}
      authorityStatus={refData.authorityStatus}
      isPro={isPro}
      referenceId={refData.id}
      onRecheck={onRecheck}
      healthState={health?.state}
      healthReasons={health?.reasons}
      reportEngineSnapshot={refData.reportEngineSnapshot}
    />
  ) : null;

  const otherBadges = (
    <>
      {refData.referenceType && (
        <Badge variant="outline" className="text-xs bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-transparent">
          {referenceTypeLabel}
        </Badge>
      )}

      {showDebug && showInputFormat && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs shrink-0">
                From {INPUT_STYLE_LABELS[refData.inputStyle] ?? refData.inputStyle}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Parser used {INPUT_STYLE_LABELS[refData.inputStyle] ?? refData.inputStyle} as the source style. If Auto-detect was enabled, this was the winning style.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {showDebug && refData.styleDetectionFailed && (
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

      {showDebug && refData.assertionSummary && (
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
            className={`text-xs cursor-help flex items-center gap-1 border-transparent ${
              health.state === "clean"
                ? "bg-primary-container/10 text-primary-container dark:bg-blue-900/40 dark:text-blue-300"
                : health.state === "review"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400"
                  : "bg-error-container text-on-error-container dark:bg-red-900/40 dark:text-red-400"
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
  const debugStageLog = refData.reportEngineSnapshot?.stageLogSummary ?? [];
  const debugProcessingPath = refData.reportEngineSnapshot?.processingPath;
  const debugChips = [
    ...(refData.reportEngineSnapshot?.validationCodes ?? []).map((value) => ({ label: value, tone: "outline" as const })),
    ...(refData.reportEngineSnapshot?.qualityFlags ?? []).map((value) => ({ label: value, tone: "secondary" as const })),
    ...(debugProcessingPath?.fallbacksUsed ?? []).map((value) => ({ label: value, tone: "outline" as const })),
    ...(debugProcessingPath?.partialReasons ?? []).map((value) => ({ label: value, tone: "outline" as const })),
    ...(refData.reportEngineSnapshot?.splitContaminationFlags ?? []).map((value) => ({ label: value, tone: "outline" as const })),
  ];
  const canShowDebugTrace = showDebug && (
    debugStageLog.length > 0
    || Boolean(refData.reportEngineSnapshot?.extractorPath)
    || Boolean(debugProcessingPath?.stagesRun?.length)
    || debugChips.length > 0
  );

  return (
    <div className={`bg-surface-container-lowest dark:bg-slate-800 p-5 sm:p-6 rounded-lg border border-outline-variant/30 dark:border-slate-700/50 shadow-sm citation-card ${health?.state === "clean" ? "ready" : health?.state === "review" ? "review" : "error"} relative group mb-4 transition-colors`}>
      
      {/* Primary Content Area */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-4 min-w-0">
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
              className={`font-bold text-sm sm:text-base text-primary-container dark:text-slate-100 leading-relaxed ${isExpanded ? "" : "line-clamp-3 sm:line-clamp-none transition-all duration-300"} cursor-pointer sm:cursor-auto`}
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {duplicateDiffMarkup && duplicateDiffMarkup.differenceCount > 0 ? (
                <p
                  className="text-primary-container dark:text-slate-100 leading-relaxed flex-1 min-w-0 font-bold text-sm sm:text-base break-words"
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
              <p className="mt-2 text-xs text-brand-amber text-opacity-80">
                Highlighted text shows what differs from the selected version.
              </p>
            )}
            {!isExpanded && isLongCitation && (
              <button
                onClick={() => setIsExpanded(true)}
                className="text-xs text-muted-foreground mt-1 hover:text-primary-container sm:hidden inline-flex items-center"
              >
                <ChevronDown className="w-3 h-3 mr-1" />
                Read more
              </button>
            )}
          </div>
        )}
      </div>

      {/* Original Input Expandable */}
      {shouldShowOriginalInput && (
        <div className="bg-surface-container-low dark:bg-slate-700/30 rounded p-3 mb-4 border border-outline-variant/20 dark:border-slate-700/50">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] font-bold text-outline uppercase tracking-widest">Original Input</span>
            <span className="text-[10px] text-outline/60 hidden sm:inline">Compare against converted citation above</span>
          </div>
          <div className="text-xs font-mono text-on-surface-variant dark:text-slate-300 break-words space-y-1">
            {originalInputLines.map((line, index) => (
              <p key={`${refData.id}-original-${index}`}>{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* Debug Trace Toggle */}
      {canShowDebugTrace && (
        <div className="mb-4">
          <button 
            type="button"
            className="flex items-center gap-2 bg-surface-container dark:bg-slate-700/50 px-3 py-1.5 rounded-lg border border-outline-variant/30 dark:border-slate-700/50 text-xs font-bold text-primary-container dark:text-blue-300 hover:bg-surface-container-high dark:hover:bg-slate-700 transition-colors"
            onClick={() => setShowDebugTrace((current) => !current)}
          >
            <span className="material-symbols-outlined text-sm">code</span>
            {showDebugTrace ? "Hide Debug Trace" : "Show Debug Trace"}
          </button>
        </div>
      )}

      {/* Expanded Debug Trace */}
      {canShowDebugTrace && showDebugTrace && (
        <div className="mb-4 rounded-lg border border-outline-variant/20 dark:border-slate-700/50 bg-surface-container-low dark:bg-slate-700/30 p-3 sm:p-4 text-on-surface dark:text-slate-200">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-outline">Engine</p>
              <p className="mt-2 text-sm font-semibold">{refData.reportEngineSnapshot?.engineVersion ?? "unknown"}</p>
            </div>
            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-outline">Extractor</p>
              <p className="mt-2 text-sm font-semibold">{refData.reportEngineSnapshot?.extractorPath ?? "unknown"}</p>
            </div>
            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-outline">Partial Result</p>
              <p className="mt-2 text-sm font-semibold">{debugProcessingPath?.partialResult ? "Yes" : "No"}</p>
            </div>
            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-outline">Stages Run</p>
              <p className="mt-2 text-sm font-semibold">{debugProcessingPath?.stagesRun?.length ?? 0}</p>
            </div>
          </div>

          {debugChips.length > 0 && (
            <div className="mt-4 space-y-2">
              <Label className="text-[10px] uppercase font-bold tracking-widest text-outline">Flags and fallback reasons</Label>
              <div className="flex flex-wrap gap-1.5">
                {debugChips.map((chip) => (
                  <span key={`${chip.tone}-${chip.label}`} className="text-[10px] font-bold text-on-surface-variant border border-outline-variant/30 bg-surface-container px-2 py-1 rounded-full uppercase">
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {debugProcessingPath?.stagesRun?.length ? (
            <div className="mt-4 space-y-2">
              <Label className="text-[10px] uppercase font-bold tracking-widest text-outline">Pipeline path</Label>
              <div className="flex flex-wrap gap-1.5">
                {debugProcessingPath.stagesRun.map((stage) => (
                  <span key={stage} className="text-[10px] font-bold text-on-surface-variant border border-outline-variant/30 bg-surface-container px-2 py-1 rounded-full uppercase">
                    {stage}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            <Label className="text-[10px] uppercase font-bold tracking-widest text-outline">Stage diagnostics</Label>
            {debugStageLog.length === 0 ? (
              <div className="rounded-lg border border-dashed border-outline-variant/40 px-3 py-4 text-xs text-outline italic">
                No stage diagnostics were captured for this citation.
              </div>
            ) : (
              <div className="space-y-2">
                {debugStageLog.map((entry) => (
                  <div key={`${entry.stageId}-${entry.status}-${entry.message}`} className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${entry.status === "error" ? "text-brand-red bg-brand-red/10 border border-brand-red/30" : entry.status === "warning" ? "text-brand-amber bg-brand-amber/10 border border-brand-amber/30" : "text-on-surface-variant bg-surface-container border border-outline-variant/30"}`}>
                        {entry.stageId}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase text-on-surface-variant bg-surface-container border border-outline-variant/30`}>
                        {entry.status}
                      </span>
                      {entry.code && (
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full text-on-surface-variant bg-surface-container border border-outline-variant/30`}>
                          {entry.code}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-on-surface-variant">{entry.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="mt-4 pt-4 border-t border-outline-variant/20 text-xs font-mono bg-surface-container rounded p-3">
            <div><strong className="text-primary-container">authorityStatus:</strong> {refData.authorityStatus ?? "—"}</div>
            {refData.debug && (
              <>
                <div className="mt-1"><strong className="text-primary-container">extractionPath:</strong> {refData.debug.extractionPath}</div>
                <div className="mt-1"><strong className="text-primary-container">splitMethod:</strong> {refData.debug.splitMethod}</div>
                <div className="mt-1"><strong className="text-primary-container">splitConfidence:</strong> {refData.debug.splitConfidence}</div>
                <div className="mt-1"><strong className="text-primary-container">detectedStyle:</strong> {refData.debug.detectedStyle}</div>
                <div className="mt-1"><strong className="text-primary-container">fallbacksUsed:</strong> {refData.debug.fallbacksUsed.length > 0 ? refData.debug.fallbacksUsed.join(", ") : "—"}</div>
              </>
            )}
            {refData.patternHits && refData.patternHits.length > 0 && (
              <div className="mt-1">
                <strong className="text-primary-container">patternHits:</strong> {refData.patternHits.map((h) => `${h.id}(${h.fields.join(",")})`).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Badges mapped loosely to old tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {citationBadges}
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-outline-variant/10">
        {extraActions}
        <button 
          onClick={() => {
            if (!isEditing) {
              setEditText(citationText);
              setIsEditing(true);
            }
          }}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50"
        >
          <span className="material-symbols-outlined text-[16px]">edit</span> Edit
        </button>
        
        <button 
          onClick={() => handleCopyReference(refData.id, userEditedText ?? refData.convertedText)}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50"
        >
          <span className="material-symbols-outlined text-[16px]">content_copy</span> {isCopied ? "Copied" : "Copy"}
        </button>
        
        <div className="inline-flex">
          <ReportButton
            rawInput={refData.originalText}
            detectedInputStyle={refData.inputStyle}
            targetStyle={refData.outputStyle}
            convertedOutput={citationText}
            parsedData={refData.parsedData}
            referenceType={refData.referenceType}
            confidence={refData.confidence?.score}
            reportEngineSnapshot={refData.reportEngineSnapshot as any}
            reported={isReported}
            onReported={onReported ? () => onReported(refData.id) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

const MemoCitationRow = memo(CitationRow, (prev, next) => (
  prev.refData === next.refData
  && prev.isCopied === next.isCopied
  && prev.referenceTypeLabel === next.referenceTypeLabel
  && prev.isPro === next.isPro
  && prev.onRecheck === next.onRecheck
  && prev.showDebug === next.showDebug
  && prev.showInputFormat === next.showInputFormat
  && prev.isReported === next.isReported
  && prev.onReported === next.onReported
  && prev.isFailed === next.isFailed
  && prev.userEditedText === next.userEditedText
  && prev.onSaveEdit === next.onSaveEdit
  && prev.health === next.health
  && prev.extraActions === next.extraActions
  && prev.diffAgainstText === next.diffAgainstText
  && prev.showOriginalInput === next.showOriginalInput
  && prev.handleCopyReference === next.handleCopyReference
));

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
const SCROLL_THRESHOLD = 300; // same as ScrollToTop so bar shifts when button appears
const SHOW_ZERO_DUPLICATES_IN_UI = !import.meta.env.PROD;

export default function ReferenceOutput({
  convertedReferences,
  clusters = [],
  duplicateGroups = [],
  engineVersion = "v2",
  groupDuplicates = true,
  onError,
  isPro = false,
  onRecheck,
}: ReferenceOutputProps) {
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);
  const [showOriginalInput, setShowOriginalInput] = useState(false);
  const [allCopied, setAllCopied] = useState(false);
  const [showNumbered, setShowNumbered] = useState(false);
  const [keepItalics, setKeepItalics] = useState(false);
  const [hasShownDoiToast, setHasShownDoiToast] = useState(false);
  const [healthFilter, setHealthFilter] = useState<HealthState | "all">("all");
  const [isScrollPastThreshold, setIsScrollPastThreshold] = useState(false);
  const [selectedDuplicateOverrides, setSelectedDuplicateOverrides] = useState<Record<string, string>>({});
  const showInputFormat = showDebug;
  const showStageDebug = showDebug;

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

  const visibleReferences = useMemo(
    () =>
      healthFilter === "all"
        ? convertedReferences
        : convertedReferences.filter((r) => healthById[r.id]?.state === healthFilter),
    [healthFilter, convertedReferences, healthById]
  );

  const visibleUngroupedReferences = useMemo(
    () => visibleReferences.filter((ref) => !groupDuplicates || !groupedReferenceIds.has(ref.id)),
    [groupDuplicates, groupedReferenceIds, visibleReferences],
  );

  const handleSaveEdit = useCallback(async (id: string, newText: string) => {
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
  }, [convertedReferences, toast]);

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
  const cleanTextForCopy = useCallback((text: string): string => {
    if (keepItalics) {
      // Keep asterisks for italics formatting
      return text;
    } else {
      // Remove asterisks that are used for italics formatting
      return text.replace(/\*/g, '');
    }
  }, [keepItalics]);

  const handleCopyReference = useCallback(async (refId: string, text: string) => {
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
  }, [cleanTextForCopy, onError, toast]);

  const handleReported = useCallback((id: string) => {
    setReportedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

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
      const { default: jsPDF } = await import("jspdf");
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

  const stageDebugSummary = useMemo(() => {
    const counts = new Map<DebugStageKey, number>();

    for (const ref of visibleReferences) {
      const health = healthById[ref.id];
      if (!health || health.state === "clean") continue;

      const stages = deriveDebugStages(ref, health, groupedReferenceIds.has(ref.id));
      for (const stage of stages) {
        counts.set(stage, (counts.get(stage) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([key, count]) => ({
        key,
        count,
        label: DEBUG_STAGE_META[key].label,
        description: DEBUG_STAGE_META[key].description,
      }))
      .sort((a, b) => b.count - a.count);
  }, [groupedReferenceIds, healthById, visibleReferences]);

  useEffect(() => {
    if (!healthStats.total) return;
    if (import.meta.env.DEV) {
      // Lightweight instrumentation hook for future tuning of thresholds.
      // eslint-disable-next-line no-console
      console.debug("referenceHealthDistribution", healthStats);
    }
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
      {/* Reference Health Dashboard */}
      <div className="bg-surface-container-lowest rounded border border-outline-variant p-5 sm:p-6 mb-2">
        <div className="flex justify-between items-center mb-4">
          <h4 className="text-sm font-bold text-primary-container">Reference Health</h4>
          <span className="text-xs text-on-surface-variant">{healthStats.total} total references</span>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full h-2 bg-brand-red rounded-full overflow-hidden flex mb-4">
          {cleanPct > 0 && <div className="h-full bg-brand-green" style={{ width: `${cleanPct}%` }}></div>}
          {reviewPct > 0 && <div className="h-full bg-brand-amber" style={{ width: `${reviewPct}%` }}></div>}
        </div>

        {/* Status Indicators */}
        <div className="flex flex-wrap gap-x-4 sm:gap-x-6 gap-y-2">
          <div 
            className={`flex items-center gap-1.5 sm:gap-2 cursor-pointer ${healthFilter === 'clean' ? 'underline' : 'hover:underline'}`}
            onClick={() => setHealthFilter(prev => prev === "clean" ? "all" : "clean")}
          >
            <span className="w-2 h-2 rounded-full bg-brand-green"></span>
            <span className="text-xs font-bold text-on-surface-variant"><span className="text-brand-green">{healthStats.clean}</span> ready</span>
          </div>
          <div 
            className={`flex items-center gap-1.5 sm:gap-2 cursor-pointer ${healthFilter === 'review' ? 'underline' : 'hover:underline'}`}
            onClick={() => setHealthFilter(prev => prev === "review" ? "all" : "review")}
          >
            <span className="w-2 h-2 rounded-full bg-brand-amber"></span>
            <span className="text-xs font-bold text-on-surface-variant"><span className="text-brand-amber">{healthStats.review}</span> review</span>
          </div>
          <div 
            className={`flex items-center gap-1.5 sm:gap-2 cursor-pointer ${healthFilter === 'action_needed' ? 'underline' : 'hover:underline'}`}
            onClick={() => setHealthFilter(prev => prev === "action_needed" ? "all" : "action_needed")}
          >
            <span className="w-2 h-2 rounded-full bg-brand-red"></span>
            <span className="text-xs font-bold text-on-surface-variant"><span className="text-brand-red">{healthStats.actionNeeded}</span> action needed</span>
            {healthFilter === 'action_needed' && <span className="text-[10px] text-outline italic ml-1 underline cursor-pointer hover:text-primary-container transition-colors hidden sm:inline">showing only these</span>}
          </div>
        </div>
        
        {(healthStats.duplicates > 0 || SHOW_ZERO_DUPLICATES_IN_UI) && (
          <p className="mt-4 text-[10px] text-outline">Includes {healthStats.duplicates} likely duplicate{healthStats.duplicates === 1 ? "" : "s"}.</p>
        )}
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-6 pt-4 border-t border-outline-variant/10">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-on-surface-variant font-bold uppercase tracking-tight">
            <input 
              type="checkbox" 
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="rounded border-outline-variant text-primary-container focus:ring-primary-container h-3.5 w-3.5" 
            />
            <span>Advanced details</span>
          </label>
          <button 
            type="button"
            onClick={() => setShowOriginalInput((prev) => !prev)}
            className="bg-brand-green/10 text-brand-green px-3 py-1.5 rounded-full text-[10px] font-bold border border-brand-green/20 hover:bg-brand-green hover:text-white transition-all w-full sm:w-auto"
          >
            {showOriginalInput ? "Hide original input" : "Show original input"}
          </button>
        </div>
      </div>

      {showStageDebug && (
        <div className="rounded-lg border border-border/60 bg-card/80 p-3 sm:p-4 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Review Hotspots</h4>
              <p className="text-xs text-muted-foreground">
                Debug view for citations currently flagged as review or action needed.
              </p>
            </div>
            <Badge variant="outline" className="w-fit text-xs">
              {visibleReferences.filter((ref) => healthById[ref.id]?.state !== "clean").length} flagged in view
            </Badge>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {stageDebugSummary.length > 0 ? (
              <TooltipProvider>
                {stageDebugSummary.map((stage) => (
                  <Tooltip key={stage.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center rounded-full border border-border/70 bg-muted/60 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10"
                      >
                        {stage.label} - {stage.count}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      <p>{stage.description}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </TooltipProvider>
            ) : (
              <div className="text-xs text-muted-foreground">
                No current review hotspots in this output set.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Output Display */}
      <div className="bg-muted/50 rounded-lg p-3 sm:p-4 min-h-[200px] overflow-x-auto">
        {displayGroups.map((group) => {
          const overrideSelection = selectedDuplicateOverrides[group.groupId];
          const selectedId = overrideSelection && group.members.some((member) => member.id === overrideSelection)
            ? overrideSelection
            : group.primaryId;
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
              <MemoCitationRow
                refData={mainRef}
                handleCopyReference={handleCopyReference}
                isCopied={Boolean(copiedStates[mainRef.id])}
                referenceTypeLabel={REFERENCE_TYPE_LABELS[mainRef.referenceType] || "Unknown"}
                isPro={isPro}
                onRecheck={onRecheck}
                showDebug={showDebug}
                showInputFormat={showInputFormat}
                isReported={reportedIds.has(mainRef.id)}
                onReported={handleReported}
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
                            <MemoCitationRow
                              refData={dup}
                              handleCopyReference={handleCopyReference}
                              isCopied={Boolean(copiedStates[dup.id])}
                              referenceTypeLabel={REFERENCE_TYPE_LABELS[dup.referenceType] || "Unknown"}
                              isPro={isPro}
                              onRecheck={onRecheck}
                              showDebug={showDebug}
                              showInputFormat={showInputFormat}
                              isReported={reportedIds.has(dup.id)}
                              onReported={handleReported}
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
                                  onClick={() => setSelectedDuplicateOverrides((prev) => ({ ...prev, [group.groupId]: dup.id }))}
                                  className={`text-xs h-auto px-3 py-1.5 font-bold ${isSelected ? "bg-primary-container text-white dark:bg-blue-600" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"}`}
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

        {visibleUngroupedReferences
          .map((ref) => (
            <MemoCitationRow
              key={ref.id}
              refData={ref}
              handleCopyReference={handleCopyReference}
              isCopied={Boolean(copiedStates[ref.id])}
              referenceTypeLabel={REFERENCE_TYPE_LABELS[ref.referenceType] || "Unknown"}
              isPro={isPro}
              onRecheck={onRecheck}
              showDebug={showDebug}
              showInputFormat={showInputFormat}
              isReported={reportedIds.has(ref.id)}
              onReported={handleReported}
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
          className={`fixed md:relative bottom-4 md:bottom-auto z-40 md:z-auto bg-card/95 md:bg-transparent backdrop-blur-md md:backdrop-blur-none p-3 md:p-0 rounded-lg md:rounded-none shadow-2xl md:shadow-none border border-border md:border-0 flex flex-row md:justify-center gap-2 sm:max-w-[calc(100vw-4.5rem)] md:max-w-none
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
