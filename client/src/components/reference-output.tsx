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
import { ConvertedReference, Cluster, type AssertionHighlight } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import jsPDF from 'jspdf';

import { ScholarPreview } from "./ScholarPreview";
import ReportButton from "./ReportButton";

interface ReferenceOutputProps {
  convertedReferences: ConvertedReference[];
  clusters?: Cluster[];
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

function inputSuggestsLocator(originalText: string) {
  return /\bpp?\.?\s*[A-Z]?\d|\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d|\b\d+\(\d+\)\s*:\s*[A-Z]?\d|\bS\d+(?:[-–]S?\d+)?\b/i.test(originalText);
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
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const [isExpanded, setIsExpanded] = useState(false);

  const rowWarnings: string[] = [];
  const hasPages = !!refData.parsedData?.pages;
  const hasArticleNumber = !!(refData.parsedData as any)?.['article-number'];
  const pagesLookLikeELocator = /^[eE]?\d{4,}$/.test((refData.parsedData?.pages ?? '').trim());
  const hasEffectivePages = hasPages || hasArticleNumber || pagesLookLikeELocator;
  const shouldRequireLocator = inputSuggestsLocator(refData.originalText);
  if (shouldRequireLocator && !hasEffectivePages && ['journal', 'conference', 'bookChapter'].includes(refData.referenceType)) {
    rowWarnings.push("Incomplete: pages missing");
  }
  if (!refData.parsedData?.publisher && refData.referenceType === 'book') {
    rowWarnings.push("Incomplete: publisher missing");
  }
  if (refData.authorInitialsOnly) {
    rowWarnings.push("Author initials only — review suggested");
  }

  const citationText = userEditedText ?? refData.convertedText;
  const isLongCitation = citationText.length > 150;

  const confidenceBadge = refData.confidence ? (
    <ScholarPreview
      confidence={refData.confidence}
      authorityData={refData.authorityData}
      authorityStatus={refData.authorityStatus}
      isPro={isPro}
      referenceId={refData.id}
      onRecheck={onRecheck}
    />
  ) : null;

  const otherBadges = (
    <>
      {refData.referenceType && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs cursor-help">
                {getReferenceTypeLabel(refData.referenceType)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {refData.referenceType === "journal" && (
                <p>Classified as a journal article based on title, year, and journal/volume/pages pattern.</p>
              )}
              {refData.referenceType === "conference" && (
                <p>Classified as a conference proceeding because a conference container (e.g. &quot;In 2018 IEEE ...&quot;) was detected.</p>
              )}
              {refData.referenceType === "book" && (
                <p>Classified as a book or monograph because no clear journal/conference container was found.</p>
              )}
              {refData.referenceType === "bookChapter" && (
                <p>Classified as a book chapter due to an &quot;In:&quot; style container with editors or book title.</p>
              )}
              {(!refData.referenceType || refData.referenceType === "other") && (
                <p>
                  Parsed as <strong>Other</strong> because the parser could not confidently detect a journal,
                  conference, or book container. If this is a journal article, make sure the input includes a
                  clear journal or conference title and isn&apos;t truncated.
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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

  const warningBadges = (
    <>
      {rowWarnings.length > 1 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="destructive" className="text-xs cursor-help">
                ⚠️ {rowWarnings.length} Warnings
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs space-y-1">
              <ul className="list-disc pl-3">
                {rowWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : rowWarnings.length === 1 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant={rowWarnings[0].includes("initials") ? "secondary" : "destructive"} className="text-xs cursor-help">
                {rowWarnings[0].includes("initials") ? "Author initials only" : `⚠️ ${rowWarnings[0]}`}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {rowWarnings[0]}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </>
  );

  const citationBadges = (
    <>
      {otherBadges}
      {warningBadges}
      {confidenceBadge}
    </>
  );

  return (
    <Card
      className={`border-l-4 mb-4 ${isFailed ? "border-l-destructive bg-destructive/5" : "border-l-primary"}`}
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
                <HighlightedCitationText
                  text={citationText}
                  highlights={refData.assertionHighlights}
                />
              </div>
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
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {otherBadges}
              {confidenceBadge}
              {warningBadges}
            </div>

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
              <ReportButton
                refId={refData.id}
                rawInput={refData.originalText}
                detectedInputStyle={refData.inputStyle}
                targetStyle={refData.outputStyle}
                convertedOutput={refData.convertedText}
                reported={reportedIds?.has(refData.id)}
                onReported={onReported ? () => onReported(refData.id) : undefined}
              />
            </div>
          </div>

          <div className="sm:hidden flex items-center gap-2 w-full justify-end border-t border-muted/50 pt-3 mt-1">
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
            <ReportButton
              refId={refData.id}
              rawInput={refData.originalText}
              detectedInputStyle={refData.inputStyle}
              targetStyle={refData.outputStyle}
              convertedOutput={refData.convertedText}
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

export default function ReferenceOutput({ convertedReferences, clusters = [], onError, isPro = false, onRecheck }: ReferenceOutputProps) {
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);
  const [showInputFormat, setShowInputFormat] = useState(true);
  const [allCopied, setAllCopied] = useState(false);
  const [showNumbered, setShowNumbered] = useState(false);
  const [keepItalics, setKeepItalics] = useState(false);
  const [hasShownDoiToast, setHasShownDoiToast] = useState(false);
  const [showFailedOnly, setShowFailedOnly] = useState(false);
  const [isScrollPastThreshold, setIsScrollPastThreshold] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrollPastThreshold(window.scrollY > SCROLL_THRESHOLD);
    onScroll(); // set initial
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const [userEdits, setUserEdits] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const handleSaveEdit = (id: string, newText: string) => {
    setUserEdits(prev => ({ ...prev, [id]: newText }));
    toast({ title: "Edits Saved", description: "Your changes have been saved locally." });
  };

  const isFailedReference = (ref: ConvertedReference) => {
    const hasCriticalWarning = (ref.warnings ?? []).some((w) => w.startsWith("error:"));
    return ref.styleDetectionFailed || ref.referenceType === "other" || hasCriticalWarning;
  };

  const batchSummary = useMemo(() => {
    const failed = convertedReferences.filter(isFailedReference).length;
    const lowConfidence = convertedReferences.filter(
      (r) => r.confidence?.isSuspicious || (r.confidence?.score ?? 100) < 60
    ).length;
    const duplicateCount =
      clusters?.reduce((sum, c) => sum + Math.max(0, (c.members?.length ?? 0) - 1), 0) ?? 0;
    const missingYear = convertedReferences.filter((r) => !r.parsedData?.year).length;
    const missingVenue = convertedReferences.filter(
      (r) =>
        r.referenceType === "other" ||
        ((r.referenceType === "journal" || r.referenceType === "conference") && !r.parsedData?.journal && !r.parsedData?.conferenceTitle)
    ).length;
    const needReview = convertedReferences.filter(
      (r) =>
        isFailedReference(r) ||
        r.confidence?.isSuspicious ||
        (r.confidence?.score ?? 100) < 70
    ).length;

    return {
      total: convertedReferences.length,
      failed,
      successful: convertedReferences.length - failed,
      lowConfidence,
      duplicateCount,
      missingYear,
      missingVenue,
      needReview,
    };
  }, [convertedReferences, clusters]);

  const visibleReferences = useMemo(
    () => (showFailedOnly ? convertedReferences.filter(isFailedReference) : convertedReferences),
    [showFailedOnly, convertedReferences]
  );

  // Scan input specifically for DOI stripping toast warning
  // To avoid blasting the user, we only show it once per batch.
  if (!hasShownDoiToast && convertedReferences.some(r => /doi:|https?:\/\/doi\.org/i.test(r.originalText))) {
    setHasShownDoiToast(true);
    setTimeout(() => {
      toast({
        title: "DOIs Removed",
        description: "DOI fields were detected in your input. Per strict style rules, DOIs have been stripped from the output.",
        variant: "default",
      });
    }, 500);
  }

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
    const failed = convertedReferences.filter(isFailedReference).length;

    const needsReview = convertedReferences.filter(
      (r) => !isFailedReference(r) && (
        r.confidence?.isSuspicious ||
        (r.confidence?.score ?? 100) < 70 ||
        !r.parsedData?.year ||
        (!r.parsedData?.journal && !r.parsedData?.conferenceTitle && (r.referenceType === "journal" || r.referenceType === "conference")) ||
        r.authorInitialsOnly
      )
    ).length;

    const duplicates = clusters?.reduce((sum, c) => sum + Math.max(0, (c.members?.length ?? 0) - 1), 0) ?? 0;
    const clean = Math.max(0, total - failed - needsReview - duplicates);

    return { total, clean, needsReview, duplicates, failed };
  }, [convertedReferences, clusters]);

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
  const reviewPct = healthStats.total ? (healthStats.needsReview / healthStats.total) * 100 : 0;
  const dupPct = healthStats.total ? (healthStats.duplicates / healthStats.total) * 100 : 0;
  const failPct = healthStats.total ? (healthStats.failed / healthStats.total) * 100 : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Reference Health Bar */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
        <div className="p-3 sm:p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">Reference Health</h4>
            <span className="text-xs font-medium text-muted-foreground">{healthStats.total} total</span>
          </div>

          <div className="h-2 w-full flex rounded-full overflow-hidden flex-nowrap bg-muted">
            {cleanPct > 0 && <div style={{ width: `${cleanPct}%` }} className="bg-emerald-500" />}
            {reviewPct > 0 && <div style={{ width: `${reviewPct}%` }} className="bg-amber-400" />}
            {dupPct > 0 && <div style={{ width: `${dupPct}%` }} className="bg-blue-400" />}
            {failPct > 0 && <div style={{ width: `${failPct}%` }} className="bg-red-500" />}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs mt-1">
            {[
              healthStats.clean > 0 && (
                <div key="clean" className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span><strong className="font-bold">{healthStats.clean}</strong> clean</span>
                </div>
              ),
              healthStats.needsReview > 0 && (
                <div key="review" className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span><strong className="font-bold">{healthStats.needsReview}</strong> review</span>
                </div>
              ),
              healthStats.duplicates > 0 && (
                <div key="duplicate" className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span><strong className="font-bold">{healthStats.duplicates}</strong> duplicate</span>
                </div>
              ),
              healthStats.failed > 0 && (
                <div
                  key="failed"
                  className={`flex items-center gap-1.5 cursor-pointer hover:underline transition-colors ${showFailedOnly ? 'text-foreground font-bold' : 'text-red-700 dark:text-red-400'}`}
                  onClick={() => setShowFailedOnly(prev => !prev)}
                >
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span><strong className="font-bold">{healthStats.failed}</strong> failed {showFailedOnly ? "(Showing only failed)" : ""}</span>
                </div>
              )
            ].filter(Boolean).map((item, index, arr) => (
              <React.Fragment key={index}>
                {item}
                {index < arr.length - 1 && <span className="text-muted-foreground/40 font-bold px-1">&middot;</span>}
              </React.Fragment>
            ))}
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
        </div>
      </div>

      {/* Output Display */}
      <div className="bg-muted/50 rounded-lg p-3 sm:p-4 min-h-[200px] overflow-x-auto">
        {/* Render Clusters First */}
        {clusters && clusters.length > 0 && clusters.map(cluster => {
          const clusterMembers = cluster.members as ConvertedReference[];
          const filteredMembers = showFailedOnly ? clusterMembers.filter(isFailedReference) : clusterMembers;
          if (showFailedOnly && filteredMembers.length === 0) return null;

          const mainRef =
            filteredMembers.find((m: ConvertedReference) => m.id === cluster.bestMemberId) ||
            filteredMembers[0] ||
            clusterMembers.find((m: ConvertedReference) => m.id === cluster.bestMemberId) ||
            clusterMembers[0];
          if (!mainRef) return null;

          const duplicates = filteredMembers.filter((m: ConvertedReference) => m.id !== mainRef.id);

          return (
            <div key={cluster.clusterId} className="mb-6 relative">
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
                isFailed={isFailedReference(mainRef)}
                userEditedText={userEdits[mainRef.id]}
                onSaveEdit={handleSaveEdit}
              />

              {showDebug && (cluster.warnings?.length || cluster.winnerDiagnostics) && (
                <div className="ml-6 mt-2 text-xs font-mono bg-muted/50 rounded-md p-4 border border-border/60 space-y-2 text-left">
                  <div>
                    <span className="text-muted-foreground mr-1">cluster:</span>
                    <span className="font-semibold">{cluster.clusterId}</span>
                  </div>
                  {cluster.warnings && cluster.warnings.length > 0 && (
                    <div>
                      <span className="text-muted-foreground mr-1">warnings:</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">{cluster.warnings.join(" | ")}</span>
                    </div>
                  )}
                  {cluster.winnerDiagnostics && (
                    <>
                      <div>
                        <span className="text-muted-foreground mr-1">winner:</span>
                        <span className="font-semibold">{cluster.winnerDiagnostics.chosenMemberId}</span>
                        {cluster.winnerDiagnostics.chosenReasons.length > 0 && (
                          <span className="text-muted-foreground ml-1">({cluster.winnerDiagnostics.chosenReasons.join(", ")})</span>
                        )}
                      </div>
                      <div className="pt-2 border-t border-border/40 space-y-1">
                        <div className="text-muted-foreground mb-1">memberDiagnostics:</div>
                        {cluster.winnerDiagnostics.memberDiagnostics.map((d) => (
                          <div key={d.id} className="grid grid-cols-[auto_1fr] gap-2 pl-2">
                            <span className="font-semibold">{d.id}</span>
                            <span className="text-muted-foreground">
                              <span className="text-foreground mr-2">score={d.score}</span>
                              {d.reasons.length > 0 ? `[${d.reasons.join(", ")}]` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {duplicates.length > 0 && (
                <Collapsible className="pl-6 border-l-2 border-muted mt-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground w-full justify-start pl-2 hover:bg-muted mb-2">
                      <ChevronDown className="h-3 w-3 mr-1" />
                      {duplicates.length} Highly Similar Deduplicated Citations
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {duplicates.map((dup: ConvertedReference) => (
                      <CitationRow
                        key={dup.id}
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
                        isFailed={isFailedReference(dup)}
                        userEditedText={userEdits[dup.id]}
                        onSaveEdit={handleSaveEdit}
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          );
        })}

        {/* Render Independent References (not in any cluster) */}
        {visibleReferences
          .filter(ref => !ref.clusterId || !clusters?.some(c => c.clusterId === ref.clusterId))
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
              isFailed={isFailedReference(ref)}
              userEditedText={userEdits[ref.id]}
              onSaveEdit={handleSaveEdit}
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

        {/* Copy All + Download row — fixed on mobile/tablet up to md; same width, centered then shift left when scroll-to-top shows */}
        <div
          className={`fixed md:relative bottom-4 md:bottom-auto z-40 md:z-auto bg-card/95 md:bg-transparent backdrop-blur-md md:backdrop-blur-none p-3 md:p-0 rounded-xl md:rounded-none shadow-2xl md:shadow-none border border-border md:border-0 flex flex-row md:justify-center gap-3 max-w-[calc(100vw-4.5rem)] md:max-w-none
            ${isScrollPastThreshold ? "left-4 right-14 md:left-auto md:right-auto" : "left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0"}
          `}
        >
          <Button
            onClick={handleCopyAll}
            variant="default"
            className="flex-1 text-sm md:text-base whitespace-nowrap"
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
              <Button variant="outline" className="flex-1 md:w-auto md:flex-none flex items-center justify-center gap-2">
                <Download className="h-4 w-4" />
                Download
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
