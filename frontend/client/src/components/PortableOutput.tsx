import React, { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Copy,
  Database,
  Download,
  Edit3,
  ExternalLink,
  FileCode,
  FileText,
  Flag,
  Link2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";

export type HealthState = "clean" | "review" | "action_needed";
export type AuthorityStatus = "cache_hit" | "fetched" | "no_match" | "error" | "blocked" | "skipped" | "timeout" | string;
type AssertionSeverity = "warning" | "error";
type DebugStageKey = "detect" | "extract" | "enrich" | "validate" | "render" | "dedupe";

export interface AssertionHighlight {
  start: number;
  end: number;
  message: string;
  severity: AssertionSeverity;
}

export interface AssertionDetail {
  id: string;
  description: string;
  passed: boolean;
  severity: AssertionSeverity;
}

export interface AssertionSummary {
  total: number;
  passed: number;
  failed: number;
  failedCritical: number;
  details: AssertionDetail[];
}

export interface ConfidenceResult {
  score: number;
  isSuspicious?: boolean;
  breakdown?: { rules?: number; validation?: number };
}

export interface AuthorityData {
  title?: string;
  authors?: string[];
  journal?: string;
  year?: string | number;
  url?: string;
}

export interface ParsedReference {
  authors?: Array<string | { given?: string; family?: string; literal?: string }>;
  title?: string;
  year?: string;
  journal?: string;
  conferenceTitle?: string;
  bookTitle?: string;
  publisher?: string;
  institution?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  editor?: string;
  ["article-number"]?: string;
}

export interface DebugStageEntry {
  stageId: string;
  status: "info" | "warning" | "error";
  message: string;
  code?: string;
}

export interface ProcessingPathSnapshot {
  partialResult?: boolean;
  stagesRun?: string[];
  fallbacksUsed?: string[];
  partialReasons?: string[];
}

export interface ReportEngineSnapshot {
  engineVersion?: "v1" | "v2" | "v3";
  extractorPath?: string;
  stageLogSummary?: DebugStageEntry[];
  processingPath?: ProcessingPathSnapshot;
  validationCodes?: string[];
  qualityFlags?: string[];
  splitContaminationFlags?: string[];
}

export interface ConvertedReference {
  id: string;
  originalText: string;
  convertedText: string;
  inputStyle: string;
  outputStyle: string;
  effectiveStyle?: string;
  referenceType: "journal" | "book" | "bookChapter" | "conference" | "website" | "report" | "thesis" | "other" | string;
  parsedData?: ParsedReference;
  confidence?: ConfidenceResult;
  authorityData?: AuthorityData;
  authorityStatus?: AuthorityStatus;
  styleDetectionFailed?: boolean;
  inputStyleUncertain?: boolean;
  doiVerificationStatus?: "absent" | "verified" | "conflicted" | "unverified";
  assertionSummary?: AssertionSummary;
  assertionHighlights?: AssertionHighlight[];
  warnings?: string[];
  healthState?: HealthState;
  healthReasons?: string[];
  reportEngineSnapshot?: ReportEngineSnapshot;
  debug?: {
    extractionPath?: string;
    splitMethod?: string;
    splitConfidence?: string | number;
    detectedStyle?: string;
    fallbacksUsed?: string[];
  };
  patternHits?: Array<{ id: string; fields: string[] }>;
}

export interface DuplicateGroup {
  groupId: string;
  primaryId: string;
  members: ConvertedReference[];
  method?: string;
}

export interface Cluster {
  clusterId: string;
  bestMemberId?: string;
  members: ConvertedReference[];
}

export interface ReportPayload {
  citationId?: string;
  originalText: string;
  detectedStyle: string;
  outputStyle: string;
  convertedText: string;
  parsedData?: ParsedReference;
  referenceType?: string;
  confidence?: number;
  engineSnapshot?: ReportEngineSnapshot;
  categories: string[];
  userNote?: string;
}

export interface PortableOutputProps {
  convertedReferences: ConvertedReference[];
  clusters?: Cluster[];
  duplicateGroups?: DuplicateGroup[];
  engineVersion?: "v1" | "v2" | "v3";
  groupDuplicates?: boolean;
  isPro?: boolean;
  onError?: (message: string) => void;
  onRecheck?: (referenceId: string) => Promise<void> | void;
  onReport?: (payload: ReportPayload) => Promise<void> | void;
  renderExtractedFields?: (reference: ConvertedReference) => ReactNode;
  renderReferenceInsights?: (reference: ConvertedReference) => ReactNode;
}

type HealthSignals = { state: HealthState; reasons: string[] };
type ToastRecord = { id: string; title: string; description?: string; tone?: "default" | "error" };
type StageIssueSummary = { message: string; count: number };
type DebugHotspotSummary = {
  key: DebugStageKey;
  count: number;
  label: string;
  description: string;
  issues: StageIssueSummary[];
  formatNotRecognizedCount: number;
};

const INPUT_STYLE_LABELS: Record<string, string> = {
  auto: "Auto-detect",
  unknown: "Format not recognized",
  apa: "APA",
  mla: "MLA",
  harvard: "Harvard",
  chicago: "Chicago",
  ieee: "IEEE",
  vancouver: "Vancouver",
};

function normalizeInputStyle(style: string) {
  return String(style || "").trim().toLowerCase();
}

function isFormatNotRecognized(style: string) {
  return normalizeInputStyle(style) === "unknown";
}

function formatStyleLabel(style: string) {
  const normalized = normalizeInputStyle(style);
  if (!normalized) return "Style";
  if (normalized.startsWith("apa")) return "APA";
  if (normalized.startsWith("mla")) return "MLA";
  if (normalized.startsWith("ieee")) return "IEEE";
  if (normalized.startsWith("vancouver")) return "Vancouver";
  if (normalized.startsWith("chicago")) return "Chicago";
  if (normalized.startsWith("harvard")) return "Harvard";
  if (normalized.startsWith("ama")) return "AMA";
  if (normalized.startsWith("acs")) return "ACS";
  if (normalized === "unknown") return "Format not recognized";
  const fallback = normalized.replace(/[-_0-9]+/g, " ").trim().replace(/\b\w/g, (char) => char.toUpperCase());
  return (INPUT_STYLE_LABELS[normalized] ?? fallback) || "Style";
}

function formatHotspotBadgeLabel(stage: DebugHotspotSummary) {
  if (stage.key !== "detect" || stage.formatNotRecognizedCount === 0) {
    return `${stage.label} - ${stage.count}`;
  }

  return `${stage.label} - ${stage.count} · From Format not recognized: ${stage.formatNotRecognizedCount}`;
}

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

const DEBUG_STAGE_META: Record<DebugStageKey, { label: string; description: string }> = {
  detect: { label: "detect", description: "Source-style detection looks uncertain, so downstream parsing may be shaky." },
  extract: { label: "extract", description: "Core field extraction looks incomplete or unstable, such as authors, title, year, or venue." },
  enrich: { label: "enrich", description: "Authority or metadata enrichment could not confidently verify the citation." },
  validate: { label: "validate", description: "Health checks flagged the citation for manual review or further investigation." },
  render: { label: "render", description: "Output formatting or style assertions indicate the final citation still needs cleanup." },
  dedupe: { label: "dedupe", description: "This citation is part of a duplicate cluster and may need merge or selection review." },
};

const EXTRACTION_WARNING_CODES = new Set([
  "missing_field",
  "venue_missing_for_conference",
  "author_structure_unstable",
  "connector_as_author",
  "initials_as_surname",
  "missing_locator",
  "locator_missing_from_source",
  "placeholder_journal",
  "placeholder_volume",
]);

const RENDER_WARNING_CODES = new Set([
  "render_output_empty_or_invalid",
  "missing_locator",
  "locator_missing_from_source",
]);

const DEBUG_TOKEN_LABELS: Record<string, string> = {
  authority_unconfirmed: "Authority validation could not confirm an exact match",
  author_structure_unstable: "Author names were parsed in an unstable format",
  connector_as_author: "Connector text was parsed as an author name",
  initials_as_surname: "Author initials were parsed as surnames",
  locator_missing_from_source: "Locator from the source is missing in the output",
  manual_review_required: "Manual review is required before submission",
  missing_field: "A core citation field is missing",
  missing_locator: "Missing page or article locator",
  no_match: "No authoritative match found for this citation",
  placeholder_journal: "Venue / Journal field still looks like a placeholder",
  placeholder_volume: "Volume field still looks like a placeholder",
  render_output_empty_or_invalid: "Rendered output is incomplete or invalid",
  review_recommended: "Manual review is recommended",
  venue_missing_for_conference: "Conference venue information is incomplete",
};

const REPORT_CATEGORIES = [
  { value: "author", label: "Author name incorrect" },
  { value: "year", label: "Year missing or incorrect" },
  { value: "title", label: "Title missing or incorrect" },
  { value: "venue", label: "Venue / Journal incorrect" },
  { value: "locator", label: "Pages missing or incorrect" },
  { value: "style-detection", label: "Wrong citation style detected" },
  { value: "reference-type", label: "Wrong reference type" },
  { value: "other", label: "Other..." },
] as const;

const CONFIDENCE_THRESHOLDS = {
  actionNeeded: 65,
  review: 85,
  authorityValidated: 96,
  recheckCeiling: 90,
};

const SCROLL_THRESHOLD = 300;
const SHOW_ZERO_DUPLICATES_IN_UI = true;
const INITIAL_REFERENCE_RENDER_LIMIT = 25;
const REFERENCE_RENDER_INCREMENT = 100;

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeMultilineValue(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseWarningCode(warning: string) {
  const match = warning.match(/^(?:warning|error):\s*([a-z0-9_.-]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function humanizeDebugToken(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const code = parseWarningCode(raw) ?? raw;
  const normalized = code.trim().toLowerCase();
  if (!normalized) return "";

  if (DEBUG_TOKEN_LABELS[normalized]) return DEBUG_TOKEN_LABELS[normalized];
  if (/[.!?]$/.test(raw) || /\s/.test(raw)) return raw.replace(/\s+/g, " ").trim();

  const readable = normalized.replace(/[_.-]+/g, " ").trim();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : "";
}

function inputSuggestsLocator(originalText: string) {
  return /\bpp?\.?\s*[A-Z]?\d|\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d|\b\d+\(\d+\)\s*:\s*[A-Z]?\d|\bS\d+(?:[-–]S?\d+)?\b/i.test(originalText);
}

function outputPreservesLocator(refData: ConvertedReference) {
  const parsedPages = String(refData.parsedData?.pages ?? "").trim();
  const parsedArticleNumber = String(refData.parsedData?.["article-number"] ?? "").trim();
  const convertedText = String(refData.convertedText ?? "");
  if (parsedPages || parsedArticleNumber) return true;
  if (/\bpp?\.?\s*[A-Z]?\d|\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d|\bS\d+(?:[-–]S?\d+)?\b/i.test(convertedText)) return true;
  return /\b(?:e|E)\d{4,}\b/.test(convertedText);
}

function hasVenue(parsed?: ParsedReference) {
  return Boolean(parsed?.journal || parsed?.conferenceTitle || parsed?.bookTitle);
}

function hasParsedField(parsed: ParsedReference | undefined, field: string) {
  switch (field) {
    case "authors": return Array.isArray(parsed?.authors) && parsed.authors.length > 0;
    case "title": return Boolean(parsed?.title);
    case "year": return Boolean(parsed?.year);
    case "publisher": return Boolean(parsed?.publisher);
    case "venue": return hasVenue(parsed);
    case "locator": return Boolean(parsed?.pages || parsed?.["article-number"]);
    case "bookTitle": return Boolean(parsed?.bookTitle);
    case "institution": return Boolean(parsed?.institution);
    case "url": return Boolean(parsed?.url);
    case "volume": return Boolean(parsed?.volume);
    case "issue": return Boolean(parsed?.issue);
    default: return false;
  }
}

function requirementProfile(referenceType: string) {
  switch (referenceType) {
    case "book": return { required: ["authors", "title", "year", "publisher"], reviewIfMissing: [] as string[] };
    case "conference": return { required: ["authors", "title", "year", "venue"], reviewIfMissing: ["locator"] };
    case "bookChapter": return { required: ["authors", "title", "year", "bookTitle"], reviewIfMissing: ["locator", "publisher"] };
    case "website": return { required: ["title", "url"], reviewIfMissing: ["authors", "year"] };
    case "report": return { required: ["title", "year"], reviewIfMissing: ["authors", "institution"] };
    case "thesis": return { required: ["authors", "title", "year", "institution"], reviewIfMissing: [] as string[] };
    case "journal":
    default:
      return { required: ["authors", "title", "year", "venue"], reviewIfMissing: ["volume", "locator"] };
  }
}

function formatFieldLabel(field: string) {
  switch (field) {
    case "authors": return "author";
    case "title": return "title";
    case "year": return "year";
    case "publisher": return "publisher";
    case "venue": return "venue / journal";
    case "locator": return "page number or article number";
    case "bookTitle": return "book title";
    case "institution": return "institution";
    case "url": return "URL";
    case "volume": return "volume";
    case "issue": return "issue";
    default: return field;
  }
}

function getMissingLocatorReason(originalText: string) {
  const raw = String(originalText ?? "");
  if (/\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d+/i.test(raw) || /\barticle\s+[A-Z]?\d+/i.test(raw)) return "Article number shown in the original input is missing in the output";
  if (/\bp+\.\s*[A-Z]?\d+/i.test(raw) || /\bpp+\.\s*[A-Z]?\d+/i.test(raw) || /\b:\s*[A-Z]?\d+(?:[-–][A-Z]?\d+)?\b/.test(raw)) return "Page number shown in the original input is missing in the output";
  return "Locator shown in the original input is missing in the output";
}

function hasMalformedAuthorShape(authors: ParsedReference["authors"]) {
  if (!Array.isArray(authors) || authors.length === 0) return false;
  return authors.some((author) => {
    if (typeof author === "string") return author.trim().length <= 1 || /^(and|&|et)$/i.test(author.trim());
    const family = String(author.family ?? "").trim();
    const given = String(author.given ?? "").trim();
    return (!family && !given) || /^[A-Z]\.?$/.test(family);
  });
}

function computeReferenceHealth(ref: ConvertedReference): HealthSignals {
  if (ref.healthState) return { state: ref.healthState, reasons: ref.healthReasons ?? [] };

  const parsed = ref.parsedData;
  const warnings = ref.warnings ?? [];
  const warningCodes = warnings.map(parseWarningCode).filter((code): code is string => Boolean(code));
  const profile = requirementProfile(ref.referenceType);
  const missingRequiredFields = profile.required.filter((field) => !hasParsedField(parsed, field));
  const missingReviewFields = profile.reviewIfMissing.filter((field) => !hasParsedField(parsed, field));
  const actionReasons: string[] = [];
  const softReasons: string[] = [];

  if (hasMalformedAuthorShape(parsed?.authors)) actionReasons.push("Author names were parsed in an unstable format");
  if (warningCodes.includes("locator_missing_from_source")) actionReasons.push(getMissingLocatorReason(ref.originalText));
  if (warningCodes.includes("render_output_empty_or_invalid")) actionReasons.push("Rendered output looks incomplete or invalid");

  if (ref.styleDetectionFailed) softReasons.push("Effective output style could not be resolved");
  if ((ref.confidence?.score ?? 100) <= CONFIDENCE_THRESHOLDS.actionNeeded) softReasons.push("Very low-confidence parse");
  else if ((ref.confidence?.score ?? 100) <= CONFIDENCE_THRESHOLDS.review) softReasons.push("Moderate confidence - a quick review is suggested");
  for (const field of missingRequiredFields) softReasons.push(`Required field missing: ${formatFieldLabel(field)}`);
  for (const field of missingReviewFields) softReasons.push(`Review suggested: ${formatFieldLabel(field)} is missing or incomplete`);
  if ((ref.referenceType === "journal" || ref.referenceType === "conference") && !hasVenue(parsed)) softReasons.push("Review suggested: venue / journal is missing from the parsed result");

  if (actionReasons.length > 0) return { state: "action_needed", reasons: [...new Set([...actionReasons, ...softReasons])] };
  if (softReasons.length > 0) return { state: "review", reasons: [...new Set(softReasons)] };
  return { state: "clean", reasons: [] };
}

function deriveDebugStages(ref: ConvertedReference, health: HealthSignals | undefined, isInDuplicateGroup: boolean) {
  const stages = new Set<DebugStageKey>();
  const warningCodes = (ref.warnings ?? []).map(parseWarningCode).filter((code): code is string => Boolean(code));
  const healthReasons = (health?.reasons ?? []).join(" ").toLowerCase();
  const parsed = ref.parsedData ?? {};

  if (ref.styleDetectionFailed || ref.inputStyleUncertain) stages.add("detect");
  const missingCoreFields = !parsed.title || !parsed.year || !parsed.authors?.length || (!parsed.journal && !parsed.conferenceTitle && !parsed.bookTitle && ["journal", "conference", "bookChapter"].includes(ref.referenceType));
  const extractionWarnings = warningCodes.some((code) => ["missing_field", "venue_missing_for_conference", "author_structure_unstable", "connector_as_author", "initials_as_surname", "missing_locator", "locator_missing_from_source", "placeholder_journal", "placeholder_volume"].includes(code));
  const extractionReasons = /required field missing|author names were parsed in an unstable format|(?:journal or venue|venue \/ journal) is missing|publisher missing/.test(healthReasons);
  if (missingCoreFields || extractionWarnings || extractionReasons) stages.add("extract");
  if (["no_match", "error", "timeout"].includes(ref.authorityStatus ?? "")) stages.add("enrich");
  if ((ref.assertionSummary?.failed ?? 0) > 0 || warningCodes.some((code) => ["render_output_empty_or_invalid", "missing_locator", "locator_missing_from_source"].includes(code))) stages.add("render");
  if (health && health.state !== "clean") stages.add("validate");
  if (isInDuplicateGroup) stages.add("dedupe");
  if (stages.size === 0 && health?.state === "action_needed") stages.add("validate");
  return [...stages];
}

function stageLogMatchesHotspot(stageKey: DebugStageKey, stageId: string) {
  const normalized = stageId.toLowerCase();
  switch (stageKey) {
    case "detect": return normalized.includes("detect");
    case "extract": return normalized.includes("extract") || normalized.includes("split") || normalized.includes("normalize");
    case "enrich": return normalized.includes("enrich") || normalized.includes("authority");
    case "validate": return normalized.includes("validate");
    case "render": return normalized.includes("render") || normalized.includes("format");
    case "dedupe": return normalized.includes("dedupe") || normalized.includes("duplicate");
    default: return false;
  }
}

function collectStageIssues(
  ref: ConvertedReference,
  stageKey: DebugStageKey,
  health: HealthSignals | undefined,
  isInDuplicateGroup: boolean,
) {
  const issues = new Map<string, string>();
  const addIssue = (value?: string) => {
    const message = humanizeDebugToken(value ?? "");
    if (!message) return;
    const key = message.toLowerCase().replace(/[.]+$/, "");
    if (!issues.has(key)) issues.set(key, message);
  };

  const stageLog = ref.reportEngineSnapshot?.stageLogSummary ?? [];
  const validationCodes = ref.reportEngineSnapshot?.validationCodes ?? [];
  const qualityFlags = ref.reportEngineSnapshot?.qualityFlags ?? [];
  const partialReasons = ref.reportEngineSnapshot?.processingPath?.partialReasons ?? [];
  const splitFlags = ref.reportEngineSnapshot?.splitContaminationFlags ?? [];
  const warningCodes = (ref.warnings ?? []).map(parseWarningCode).filter((code): code is string => Boolean(code));
  const failedAssertions = ref.assertionSummary?.details.filter((detail) => !detail.passed) ?? [];

  for (const entry of stageLog) {
    if (stageLogMatchesHotspot(stageKey, entry.stageId)) addIssue(entry.message || entry.code);
  }

  switch (stageKey) {
    case "detect":
      if (ref.styleDetectionFailed) addIssue("Effective output style could not be resolved");
      if (ref.inputStyleUncertain) addIssue("Input style detection remained uncertain");
      break;
    case "extract":
      for (const reason of health?.reasons ?? []) {
        if (/required field missing|review suggested|author names were parsed in an unstable format|(?:journal or venue|venue \/ journal) is missing|publisher missing|institution|volume|issue|locator/i.test(reason)) addIssue(reason);
      }
      for (const code of warningCodes) {
        if (EXTRACTION_WARNING_CODES.has(code)) addIssue(code);
      }
      for (const flag of splitFlags) addIssue(flag);
      break;
    case "enrich":
      if (ref.authorityStatus === "no_match") addIssue("No authoritative match found for this citation");
      if (ref.authorityStatus === "error") addIssue("External validation could not complete on this run");
      if (ref.authorityStatus === "timeout") addIssue("External validation timed out before a match could be confirmed");
      for (const value of [...validationCodes, ...partialReasons]) {
        if (/authority|match|metadata|enrich/i.test(value)) addIssue(value);
      }
      break;
    case "validate":
      for (const reason of health?.reasons ?? []) addIssue(reason);
      for (const value of [...validationCodes, ...qualityFlags, ...partialReasons]) addIssue(value);
      break;
    case "render":
      for (const detail of failedAssertions) addIssue(detail.description);
      for (const code of warningCodes) {
        if (RENDER_WARNING_CODES.has(code)) addIssue(code);
      }
      break;
    case "dedupe":
      if (isInDuplicateGroup) addIssue("Potential duplicate citation needs merge or keep review");
      break;
    default:
      break;
  }

  return [...issues.values()];
}

function buildStageDebugSummary(
  refs: ConvertedReference[],
  healthById: Record<string, HealthSignals>,
  groupedReferenceIds: Set<string>,
): DebugHotspotSummary[] {
  const summaryByStage = new Map<DebugStageKey, { count: number; issues: Map<string, StageIssueSummary>; formatNotRecognizedCount: number }>();

  for (const ref of refs) {
    const health = healthById[ref.id];
    if (!health || health.state === "clean") continue;

    const isInDuplicateGroup = groupedReferenceIds.has(ref.id);
    const stages = deriveDebugStages(ref, health, isInDuplicateGroup);
    for (const stage of stages) {
      const summary = summaryByStage.get(stage) ?? { count: 0, issues: new Map<string, StageIssueSummary>(), formatNotRecognizedCount: 0 };
      summary.count += 1;
      if (stage === "detect" && isFormatNotRecognized(ref.inputStyle)) summary.formatNotRecognizedCount += 1;

      for (const issue of collectStageIssues(ref, stage, health, isInDuplicateGroup)) {
        const key = issue.toLowerCase().replace(/[.]+$/, "");
        const existing = summary.issues.get(key);
        if (existing) existing.count += 1;
        else summary.issues.set(key, { message: issue, count: 1 });
      }

      summaryByStage.set(stage, summary);
    }
  }

  return [...summaryByStage.entries()]
    .map(([key, value]) => ({
      key,
      count: value.count,
      label: DEBUG_STAGE_META[key].label,
      description: DEBUG_STAGE_META[key].description,
      formatNotRecognizedCount: value.formatNotRecognizedCount,
      issues: [...value.issues.values()]
        .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message))
        .slice(0, 4),
    }))
    .sort((a, b) => b.count - a.count);
}

function buildDuplicateDiffMarkup(text: string, compareText?: string) {
  if (!compareText || compareText === text) return { html: escapeHtml(text), differenceCount: 0 };
  const textTokens = text.match(/\s+|[^\s]+/g) ?? [text];
  const compareTokens = compareText.match(/\s+|[^\s]+/g) ?? [compareText];
  const textWords = textTokens.map((token, index) => ({ token, index, normalized: token.replace(/[.,;:()[\]{}"']/g, "").toLowerCase() })).filter((entry) => entry.normalized && !/^\s+$/.test(entry.token));
  const compareWords = compareTokens.map((token) => ({ normalized: token.replace(/[.,;:()[\]{}"']/g, "").toLowerCase() })).filter((entry) => entry.normalized);
  const dp = Array.from({ length: textWords.length + 1 }, () => Array(compareWords.length + 1).fill(0));
  for (let i = textWords.length - 1; i >= 0; i -= 1) {
    for (let j = compareWords.length - 1; j >= 0; j -= 1) {
      dp[i][j] = textWords[i].normalized === compareWords[j].normalized ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
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
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  let differenceCount = 0;
  const html = textTokens.map((token, index) => {
    if (/^\s+$/.test(token)) return token;
    const normalized = token.replace(/[.,;:()[\]{}"']/g, "").toLowerCase();
    const safe = escapeHtml(token);
    if (!normalized || matchedIndexes.has(index)) return safe;
    differenceCount += 1;
    return `<mark class="rounded bg-amber-200 px-0.5 text-amber-950">${safe}</mark>`;
  }).join("");
  return { html, differenceCount };
}

function citationHtml(text: string, highlights?: AssertionHighlight[]) {
  const items = (highlights ?? []).filter((item) => item.start >= 0 && item.end > item.start && item.end <= text.length).sort((a, b) => a.start - b.start);
  if (items.length === 0) return renderInlineItalicsHtml(text);
  let cursor = 0;
  let html = "";
  for (const item of items) {
    if (item.start < cursor) continue;
    const before = text.slice(cursor, item.start);
    const segment = text.slice(item.start, item.end);
    const color = item.severity === "error" ? "#e11d48" : "#d97706";
    html += renderInlineItalicsHtml(before);
    html += `<span style="text-decoration: wavy underline ${color}; text-underline-offset: 3px;" title="${escapeHtml(item.message)}">${renderInlineItalicsHtml(segment)}</span>`;
    cursor = item.end;
  }
  html += renderInlineItalicsHtml(text.slice(cursor));
  return html;
}

function renderInlineItalicsHtml(text: string) {
  return escapeHtml(text).replace(/([*_])([^*_]+?)\1/g, "<em>$2</em>");
}

function authorityStatusLabel(status: AuthorityStatus) {
  switch (status) {
    case "cache_hit": return "Validated (cache)";
    case "fetched": return "Validated";
    case "no_match": return "No match";
    case "error": return "Validation unavailable";
    case "blocked": return "Upgrade to validate";
    case "skipped": return "Validation skipped";
    default: return "";
  }
}

function confidenceBreakdownMessage({
  confidence,
  authorityStatus,
  healthState,
  healthReasons,
  reportEngineSnapshot,
}: {
  confidence?: ConfidenceResult;
  authorityStatus?: AuthorityStatus;
  healthState?: HealthState;
  healthReasons?: string[];
  reportEngineSnapshot?: ReportEngineSnapshot;
}) {
  const primaryReason = healthReasons?.find(Boolean)?.replace(/\.$/, "");
  if (primaryReason) return primaryReason;
  if (reportEngineSnapshot?.processingPath?.partialResult) return "This result used a fallback path for part of the pipeline, so it is safer to review the fields before treating it as final.";
  if (authorityStatus === "no_match") return "The citation was built from local parsing, but external sources did not confirm an exact match.";
  if (authorityStatus === "error") return "The citation structure looks usable locally, but external validation could not complete on this run.";
  if ((confidence?.score ?? 0) < 60) return "The input did not contain enough reliable detail to extract a strong citation. Supplying more of the original reference will help.";
  if ((confidence?.score ?? 0) < 85) return "Most core fields were found, but one or more citation details still look incomplete or inconsistent.";
  return "Core citation fields were extracted cleanly and no blocking health checks remain.";
}

function usePortableToasts() {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const pushToast = useCallback((toast: Omit<ToastRecord, "id">) => {
    const record = { ...toast, id: makeId("toast") };
    setToasts((current) => [record, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== record.id)), 2800);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((current) => current.filter((item) => item.id !== id)), []);
  return { toasts, pushToast, dismissToast };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(anchor);
}

function downloadTextFile(content: string, filename: string, mime = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

function authorsToText(authors?: ParsedReference["authors"]) {
  if (!authors || authors.length === 0) return "";
  return authors.map((author) => (typeof author === "string" ? author : author.literal || [author.family, author.given].filter(Boolean).join(", "))).filter(Boolean).join(" and ");
}

function slugId(source: string) {
  return source.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "reference";
}

function toBibtexEntry(ref: ConvertedReference, index: number) {
  const parsed = ref.parsedData ?? {};
  const key = `${slugId(parsed.title ?? `reference_${index + 1}`)}_${parsed.year ?? index + 1}`;
  const entryType = ref.referenceType === "book" ? "book" : ref.referenceType === "website" ? "misc" : ref.referenceType === "conference" ? "inproceedings" : "article";
  const fields: Array<[string, string | undefined]> = [
    ["author", authorsToText(parsed.authors)],
    ["title", parsed.title],
    ["year", parsed.year],
    ["journal", parsed.journal],
    ["booktitle", parsed.bookTitle || parsed.conferenceTitle],
    ["publisher", parsed.publisher || parsed.institution],
    ["volume", parsed.volume],
    ["number", parsed.issue],
    ["pages", parsed.pages || parsed["article-number"]],
    ["url", parsed.url],
  ];
  const body = fields.filter(([, value]) => value).map(([field, value]) => `  ${field} = {${value}}`).join(",\n");
  return `@${entryType}{${key},\n${body}\n}`;
}

function toRisEntry(ref: ConvertedReference) {
  const parsed = ref.parsedData ?? {};
  return [
    `TY  - ${ref.referenceType === "book" ? "BOOK" : ref.referenceType === "conference" ? "CPAPER" : ref.referenceType === "website" ? "ELEC" : "JOUR"}`,
    ...((parsed.authors ?? []).map((author) => `AU  - ${typeof author === "string" ? author : [author.family, author.given].filter(Boolean).join(", ")}`)),
    parsed.title ? `TI  - ${parsed.title}` : "",
    parsed.journal ? `JO  - ${parsed.journal}` : "",
    parsed.bookTitle || parsed.conferenceTitle ? `T2  - ${parsed.bookTitle || parsed.conferenceTitle}` : "",
    parsed.year ? `PY  - ${parsed.year}` : "",
    parsed.volume ? `VL  - ${parsed.volume}` : "",
    parsed.issue ? `IS  - ${parsed.issue}` : "",
    parsed.pages ? `SP  - ${parsed.pages}` : "",
    parsed.url ? `UR  - ${parsed.url}` : "",
    "ER  - ",
  ].filter(Boolean).join("\n");
}

function PortalDialog({
  open,
  onClose,
  title,
  children,
  maxWidthClass = "sm:max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidthClass?: string;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className={cn("w-full rounded-2xl border border-slate-200 bg-white shadow-2xl", maxWidthClass)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-bold text-[#002147]">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[80dvh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastRecord[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed right-4 top-4 z-[90] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className={cn("rounded-2xl border px-4 py-3 shadow-xl backdrop-blur", toast.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-white text-slate-900")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold">{toast.title}</p>
              {toast.description ? <p className="mt-1 text-sm text-slate-600">{toast.description}</p> : null}
            </div>
            <button type="button" onClick={() => onDismiss(toast.id)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Badge({ children, className, title, onClick }: { children: ReactNode; className?: string; title?: string; onClick?: () => void }) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", onClick && "transition hover:brightness-95", className)}
    >
      {children}
    </Comp>
  );
}

function ActionButton({
  children,
  className,
  onClick,
  variant = "ghost",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  variant?: "ghost" | "solid" | "outline";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "solid" && "bg-[#002147] text-white hover:bg-[#001736]",
        variant === "outline" && "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        className,
      )}
    >
      {children}
    </button>
  );
}

function HoverCard({
  trigger,
  children,
  align = "left",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const openNow = () => {
    if (closeTimer) clearTimeout(closeTimer);
    setOpen(true);
  };

  const closeSoon = () => {
    closeTimer = setTimeout(() => setOpen(false), 100);
  };

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={closeSoon}
    >
      {trigger}
      {open ? (
        <div
          className={cn(
            "absolute z-[9999] top-[calc(100%+0.45rem)] w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function HighlightedCitationText({ text, highlights }: { text: string; highlights?: AssertionHighlight[] }) {
  const processedHtml = useMemo(() => citationHtml(text, highlights), [text, highlights]);
  return <p className="min-w-0 break-words text-sm font-medium leading-relaxed text-slate-900 sm:text-base" dangerouslySetInnerHTML={{ __html: processedHtml }} />;
}

function AssertionBadge({ summary, style }: { summary?: AssertionSummary; style: string }) {
  if (!summary || summary.total === 0) return null;
  const styleLabel = formatStyleLabel(style);
  const allPassed = summary.failed === 0;
  const hasCritical = summary.failedCritical > 0;
  const warnings = summary.details.filter((detail) => !detail.passed).map((detail) => detail.description);
  return (
    <HoverCard
      trigger={(
        <Badge
          className={cn(
            "cursor-help border border-[#0b1530] bg-[#0b1530] text-white",
            allPassed
              ? "border-[#0b1530] bg-[#0b1530] text-white"
              : hasCritical
                ? "border-[#0b1530] bg-[#0b1530] text-white"
                : "border-[#0b1530] bg-[#0b1530] text-white",
          )}
        >
          {allPassed ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {styleLabel}: {summary.passed}/{summary.total}
        </Badge>
      )}
    >
      <div className="space-y-1.5">
        {warnings.length > 0 ? (
          warnings.map((warning, index) => (
            <p key={`${styleLabel}-warning-${index}`} className="text-xs leading-5 text-slate-600">
              {warning}
            </p>
          ))
        ) : (
          <p className="text-xs leading-5 text-slate-600">No warnings.</p>
        )}
      </div>
    </HoverCard>
  );
}

function ScholarPreview({
  confidence,
  authorityData,
  authorityStatus,
  isPro = false,
  referenceId,
  onRecheck,
  healthState,
  healthReasons,
  reportEngineSnapshot,
}: {
  confidence?: ConfidenceResult;
  authorityData?: AuthorityData;
  authorityStatus?: AuthorityStatus;
  isPro?: boolean;
  referenceId?: string;
  onRecheck?: (referenceId: string) => Promise<void> | void;
  healthState?: HealthState;
  healthReasons?: string[];
  reportEngineSnapshot?: ReportEngineSnapshot;
}) {
  const [open, setOpen] = useState(false);
  const [isRechecking, setIsRechecking] = useState(false);

  if (!confidence) return null;
  if (!isPro) return <Badge className="ml-2 border border-slate-200 bg-slate-100 text-slate-500">Confidence Locked</Badge>;

  const canRecheck = Boolean(
    onRecheck
      && referenceId
      && reportEngineSnapshot?.engineVersion !== "v2"
      && (confidence.score < CONFIDENCE_THRESHOLDS.recheckCeiling || authorityStatus === "no_match" || authorityStatus === "error"),
  );

  let badgeClassName = "border ";
  let icon: ReactNode = null;
  let bandLabel = "";

  if (healthState === "action_needed") {
    badgeClassName += "border-rose-200 bg-rose-50 text-rose-700";
    icon = <AlertTriangle className="h-3 w-3" />;
    bandLabel = "Needs action";
  } else if (healthState === "review") {
    badgeClassName += "border-amber-200 bg-amber-50 text-amber-700";
    icon = <AlertTriangle className="h-3 w-3" />;
    bandLabel = "Needs review";
  } else if (healthState === "clean") {
    badgeClassName += "border-[#537f57] bg-[#537f57] text-white";
    icon = <CheckCircle2 className="h-3 w-3" />;
    bandLabel = "Ready";
  } else {
    badgeClassName += "border-slate-200 bg-slate-50 text-slate-700";
  }

  return (
    <>
      <HoverCard
        trigger={(
          <Badge onClick={() => setOpen(true)} className={cn("cursor-pointer", badgeClassName)}>
            {icon}
            <span className="whitespace-nowrap">{bandLabel} ({confidence.score}%)</span>
          </Badge>
        )}
        align="right"
      >
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-900">
            {bandLabel ? `${bandLabel} • ${confidence.score}%` : `Quality score • ${confidence.score}%`}
          </p>
          <p className="text-xs leading-5 text-slate-600">
            {confidenceBreakdownMessage({ confidence, authorityStatus, healthState, healthReasons, reportEngineSnapshot })}
          </p>
          {healthReasons && healthReasons.length > 1 ? (
            <ul className="space-y-1 text-xs leading-5 text-slate-600">
              {healthReasons.map((reason) => (
                <li key={reason}>- {reason}</li>
              ))}
            </ul>
          ) : null}
          {authorityStatus ? (
            <p className="text-xs text-slate-500">Validation status: {authorityStatusLabel(authorityStatus)}</p>
          ) : null}
        </div>
      </HoverCard>

      <PortalDialog open={open} onClose={() => setOpen(false)} title="Quality Score">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold text-slate-400">Confidence</p>
              <p className="mt-2 text-2xl font-black text-[#002147]">{confidence.score}%</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold text-slate-400">Validation status</p>
              <p className="mt-2 text-sm font-semibold text-slate-800">{authorityStatus ? authorityStatusLabel(authorityStatus) : "Local only"}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm leading-6 text-slate-600">
              {confidenceBreakdownMessage({ confidence, authorityStatus, healthState, healthReasons, reportEngineSnapshot })}
            </p>
            {healthReasons && healthReasons.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {healthReasons.map((reason) => (
                  <li key={reason}>- {reason}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {authorityData ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#002147]">
                <Link2 className="h-4 w-4" />
                External validation record
              </div>
              <p className="text-sm font-semibold text-slate-900">{authorityData.title}</p>
              {authorityData.authors?.length ? <p className="mt-1 text-sm text-slate-600">{authorityData.authors.join(", ")}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {authorityData.journal ? <span>{authorityData.journal}</span> : null}
                {authorityData.year ? <span>({authorityData.year})</span> : null}
                {authorityData.url ? (
                  <a href={authorityData.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-[#0f4fa8] hover:underline">
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {confidence.isSuspicious ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              Warning: The authoritative metadata strongly mismatches the provided text. Proceed with caution.
            </div>
          ) : null}

          {canRecheck ? (
            <ActionButton
              variant="outline"
              disabled={isRechecking}
              onClick={async () => {
                if (!onRecheck || !referenceId) return;
                setIsRechecking(true);
                try {
                  await onRecheck(referenceId);
                } finally {
                  setIsRechecking(false);
                }
              }}
              className="w-full"
            >
              <RefreshCw className={cn("h-4 w-4", isRechecking && "animate-spin")} />
              {isRechecking ? "Rechecking..." : "Recheck"}
            </ActionButton>
          ) : null}
        </div>
      </PortalDialog>
    </>
  );
}

function ReportButton({
  citationId,
  rawInput,
  detectedInputStyle,
  targetStyle,
  convertedOutput,
  parsedData,
  referenceType,
  confidence,
  reportEngineSnapshot,
  reported = false,
  onReported,
  onSubmit,
}: {
  citationId?: string;
  rawInput: string;
  detectedInputStyle: string;
  targetStyle: string;
  convertedOutput: string;
  parsedData?: ParsedReference;
  referenceType?: string;
  confidence?: number;
  reportEngineSnapshot?: ReportEngineSnapshot;
  reported?: boolean;
  onReported?: () => void;
  onSubmit?: (payload: ReportPayload) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [userNote, setUserNote] = useState("");
  const [showOriginalInput, setShowOriginalInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleCategory = (value: string) => {
    setCategories((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
  };

  if (reported) return <span className="ml-1 text-xs font-bold text-rose-600">Thanks - reported.</span>;

  return (
    <>
      <ActionButton
        variant="ghost"
        onClick={() => setOpen(true)}
        className="px-0 py-0 text-[15px] font-semibold !text-red-600 hover:bg-transparent hover:!text-red-700 dark:!text-red-400 dark:hover:!text-red-300"
      >
        <Flag className="h-4 w-4" />
        <span className="hidden sm:inline">Report bad citation</span>
        <span className="sm:hidden">Wrong?</span>
      </ActionButton>

      <PortalDialog open={open} onClose={() => setOpen(false)} title="Report an issue">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-500">Converted citation</label>
              <ActionButton
                variant="outline"
                onClick={() => setShowOriginalInput((current) => !current)}
                className={cn(
                  "px-2 py-1 text-xs border-[#002147]",
                  showOriginalInput
                    ? "!bg-[#002147] !text-white hover:!bg-[#002147] hover:!text-white focus-visible:!bg-[#002147] focus-visible:!text-white"
                    : "!bg-white !text-[#002147] hover:!bg-white hover:!text-[#002147]",
                )}
              >
                {showOriginalInput ? "Hide original input" : "Show original input"}
              </ActionButton>
            </div>
            <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs break-words">
              {convertedOutput}
            </div>
          </div>

          {showOriginalInput ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500">Original input</label>
              <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs break-words">
                {rawInput}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Compare the converted citation with the original input before reporting.
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-800">What is wrong? (select all that apply)</label>
            <div className="grid gap-3 rounded-xl border border-slate-200 p-3">
              {REPORT_CATEGORIES.map((category) => (
                <label key={category.value} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={categories.includes(category.value)}
                    onChange={() => toggleCategory(category.value)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[#002147] focus:ring-[#002147]"
                  />
                  <span className="text-sm leading-5 text-slate-700">{category.label}</span>
                </label>
              ))}
            </div>
          </div>

          {categories.includes("other") ? (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800">Describe the issue</label>
              <textarea
                value={userNote}
                onChange={(event) => setUserNote(event.target.value.slice(0, 500))}
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#002147]"
                placeholder="e.g. should be conference, not venue / journal"
              />
              <p className="text-xs text-slate-500">{userNote.length}/500</p>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
            <ActionButton variant="outline" onClick={() => setOpen(false)}>Cancel</ActionButton>
            <ActionButton
              variant="outline"
              disabled={categories.length === 0 || submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await onSubmit?.({
                    citationId,
                    originalText: rawInput,
                    detectedStyle: detectedInputStyle,
                    outputStyle: targetStyle,
                    convertedText: convertedOutput,
                    parsedData,
                    referenceType,
                    confidence,
                    engineSnapshot: reportEngineSnapshot,
                    categories,
                    userNote: categories.includes("other") ? userNote.slice(0, 500) : undefined,
                  });
                  setOpen(false);
                  setCategories([]);
                  setUserNote("");
                  setShowOriginalInput(false);
                  onReported?.();
                } finally {
                  setSubmitting(false);
                }
              }}
              className="border-blue-600 text-blue-700 hover:bg-blue-50"
            >
              {submitting ? "Submitting..." : "Submit report"}
            </ActionButton>
          </div>
        </div>
      </PortalDialog>
    </>
  );
}

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
  onReport,
  renderExtractedFields,
  renderReferenceInsights,
}: {
  refData: ConvertedReference;
  handleCopyReference: (id: string, text: string) => void;
  isCopied: boolean;
  referenceTypeLabel: string;
  isPro?: boolean;
  onRecheck?: (referenceId: string) => Promise<void> | void;
  showDebug?: boolean;
  showInputFormat?: boolean;
  isReported?: boolean;
  onReported?: (refId: string) => void;
  isFailed?: boolean;
  userEditedText?: string;
  onSaveEdit?: (id: string, newText: string) => void;
  health?: HealthSignals;
  extraActions?: ReactNode;
  diffAgainstText?: string;
  showOriginalInput?: boolean;
  onReport?: (payload: ReportPayload) => Promise<void> | void;
  renderExtractedFields?: (reference: ConvertedReference) => ReactNode;
  renderReferenceInsights?: (reference: ConvertedReference) => ReactNode;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const rowWarnings: string[] = [];
  const shouldWarnDroppedLocator =
    ["journal", "conference", "bookChapter"].includes(refData.referenceType)
    && inputSuggestsLocator(refData.originalText)
    && !outputPreservesLocator(refData);

  if (shouldWarnDroppedLocator) rowWarnings.push("Input locator was not preserved in the output");
  if (!refData.parsedData?.publisher && refData.referenceType === "book") rowWarnings.push("Incomplete: publisher missing");

  const citationText = userEditedText ?? refData.convertedText;
  const duplicateDiffMarkup = useMemo(
    () => (diffAgainstText ? buildDuplicateDiffMarkup(citationText, diffAgainstText) : null),
    [citationText, diffAgainstText],
  );
  const originalInputLines = useMemo(() => normalizeMultilineValue(refData.originalText), [refData.originalText]);
  const shouldShowOriginalInput = showOriginalInput && originalInputLines.length > 0;
  const leftAccentClassName =
    health?.state === "clean"
      ? "bg-emerald-500"
      : health?.state === "review"
        ? "bg-amber-500"
        : "bg-rose-500";

  const healthBadge = health ? (
    <HoverCard
      trigger={(
        <Badge
          className={cn(
            "cursor-help border-transparent bg-transparent px-0 text-[#0b1530] shadow-none",
            health.state === "clean"
              ? "text-[#0b1530]"
              : health.state === "review"
                ? "text-amber-700"
                : "text-rose-700",
          )}
        >
          {health.state === "clean" ? <ShieldCheck className="h-3 w-3" /> : null}
          {health.state === "review" ? <ClipboardList className="h-3 w-3" /> : null}
          {health.state === "action_needed" ? <ShieldAlert className="h-3 w-3" /> : null}
          {health.state === "clean" ? "Ready" : health.state === "review" ? "Review" : "Needs fix"}
        </Badge>
      )}
    >
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-slate-900">
          {health.state === "clean"
            ? "Ready to submit."
            : health.state === "review"
              ? "Looks good overall; a quick review is suggested."
              : "Needs attention before submission."}
        </p>
        {health.reasons.length > 0 ? (
          <div className="space-y-1.5">
            {health.reasons.map((reason, index) => (
              <p key={`${refData.id}-health-${index}`} className="text-xs leading-5 text-slate-600">{reason}</p>
            ))}
          </div>
        ) : null}
        {rowWarnings.length > 0 ? (
          <div className="space-y-1.5">
            {rowWarnings.map((warning, index) => (
              <p key={`${refData.id}-warning-${index}`} className="text-xs leading-5 text-amber-700">{warning}</p>
            ))}
          </div>
        ) : null}
      </div>
    </HoverCard>
  ) : null;

  return (
    <div
      className={cn(
        "relative mb-4 overflow-visible border border-slate-200 bg-white px-6 py-5 shadow-sm transition-colors",
      )}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1", leftAccentClassName)} />
      <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        {isEditing ? (
          <div className="w-full space-y-2">
            <textarea
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              rows={4}
              className="min-h-[5rem] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-[#002147]"
            />
            <div className="flex gap-2">
              <ActionButton
                variant="solid"
                onClick={() => {
                  onSaveEdit?.(refData.id, editText);
                  setIsEditing(false);
                }}
              >
                Save
              </ActionButton>
              <ActionButton variant="ghost" onClick={() => setIsEditing(false)}>Cancel</ActionButton>
            </div>
          </div>
        ) : (
          <div className="w-full">
            <div className="text-[#002147]">
              {duplicateDiffMarkup && duplicateDiffMarkup.differenceCount > 0 ? (
                <p
                  className="min-w-0 break-words text-sm font-bold leading-relaxed text-[#002147] sm:text-base"
                  dangerouslySetInnerHTML={{ __html: duplicateDiffMarkup.html }}
                />
              ) : (
                <div>
                  <HighlightedCitationText text={citationText} highlights={refData.assertionHighlights} />
                </div>
              )}
            </div>

            {duplicateDiffMarkup && duplicateDiffMarkup.differenceCount > 0 ? (
              <p className="mt-2 text-xs text-amber-700">Highlighted text shows what differs from the selected version.</p>
            ) : null}

            {renderReferenceInsights ? renderReferenceInsights(refData) : null}
          </div>
        )}
      </div>

      {shouldShowOriginalInput ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-slate-400">Original input</span>
            <span className="hidden text-[10px] text-slate-400 sm:inline">Compare against converted citation above</span>
          </div>
          <div className="space-y-1 break-words font-mono text-xs text-slate-600">
            {originalInputLines.map((line, index) => (
              <p key={`${refData.id}-original-${index}`}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}

      {showDebug && renderExtractedFields ? renderExtractedFields(refData) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {healthBadge}
        {refData.referenceType ? <Badge className="border-transparent bg-slate-200 px-4 text-slate-600">{referenceTypeLabel}</Badge> : null}
        {showInputFormat ? <Badge className="rounded-sm border border-slate-300 bg-white px-3 text-slate-700">From {formatStyleLabel(refData.inputStyle)}</Badge> : null}
        {showDebug && refData.styleDetectionFailed ? <Badge className="border border-amber-200 bg-amber-50 text-amber-700" title="The engine could not resolve a stable effective output style, so this citation may still need manual review.">Style unresolved</Badge> : null}
        {showDebug && refData.inputStyleUncertain && !refData.styleDetectionFailed ? <Badge className="border border-blue-200 bg-blue-50 text-blue-700" title="Input auto-detection stayed uncertain, but the requested output style was explicit so the citation was not downgraded for that alone.">Input style uncertain</Badge> : null}
        {showDebug && refData.doiVerificationStatus && refData.doiVerificationStatus !== "absent" ? (
          <Badge
            className={cn(
              "border px-3",
              refData.doiVerificationStatus === "verified"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : refData.doiVerificationStatus === "conflicted"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-slate-200 bg-slate-50 text-slate-700",
            )}
          >
            DOI {refData.doiVerificationStatus}
          </Badge>
        ) : null}
        {showDebug && refData.assertionSummary ? <AssertionBadge summary={refData.assertionSummary} style={refData.outputStyle} /> : null}
        {showDebug && refData.confidence ? (
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
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-5 border-t border-slate-200 pt-4">
        {extraActions}
        <ActionButton
          variant="ghost"
          onClick={() => {
            if (!isEditing) {
              setEditText(citationText);
              setIsEditing(true);
            }
          }}
          className="px-0 py-0 text-[15px] font-semibold text-slate-700 hover:bg-transparent hover:text-[#002147]"
        >
          <Edit3 className="h-4 w-4" />
          Edit
        </ActionButton>
        <ActionButton
          variant="ghost"
          onClick={() => handleCopyReference(refData.id, userEditedText ?? refData.convertedText)}
          className="px-0 py-0 text-[15px] font-semibold text-slate-700 hover:bg-transparent hover:text-[#002147]"
        >
          <Copy className="h-4 w-4" />
          {isCopied ? "Copied" : "Copy"}
        </ActionButton>
        <ReportButton
          citationId={refData.id}
          rawInput={refData.originalText}
          detectedInputStyle={refData.inputStyle}
          targetStyle={refData.outputStyle}
          convertedOutput={citationText}
          parsedData={refData.parsedData}
          referenceType={refData.referenceType}
          confidence={refData.confidence?.score}
          reportEngineSnapshot={refData.reportEngineSnapshot}
          reported={isReported}
          onReported={onReported ? () => onReported(refData.id) : undefined}
          onSubmit={onReport}
        />
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
  && prev.onReport === next.onReport
  && prev.renderExtractedFields === next.renderExtractedFields
  && prev.renderReferenceInsights === next.renderReferenceInsights
));

export default function PortableOutput({
  convertedReferences,
  clusters = [],
  duplicateGroups = [],
  engineVersion = "v2",
  groupDuplicates = true,
  isPro = false,
  onError,
  onRecheck,
  onReport,
  renderExtractedFields,
  renderReferenceInsights,
}: PortableOutputProps) {
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
  const [userEdits, setUserEdits] = useState<Record<string, string>>({});
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_REFERENCE_RENDER_LIMIT);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const { toasts, pushToast, dismissToast } = usePortableToasts();
  const showInputFormat = showDebug;

  useEffect(() => {
    const onScroll = () => setIsScrollPastThreshold(window.scrollY > SCROLL_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setVisibleLimit(INITIAL_REFERENCE_RENDER_LIMIT);
  }, [convertedReferences]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!downloadMenuRef.current?.contains(event.target as Node)) setShowDownloadMenu(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const emitError = useCallback((message: string) => {
    onError?.(message);
    pushToast({ title: "Action failed", description: message, tone: "error" });
  }, [onError, pushToast]);

  const healthById = useMemo(() => {
    const map: Record<string, HealthSignals> = {};
    for (const ref of convertedReferences) map[ref.id] = computeReferenceHealth(ref);
    return map;
  }, [convertedReferences]);

  const detectedGroups = useMemo(() => {
    if (engineVersion !== "v1") {
      return duplicateGroups.map((group) => ({
        groupId: group.groupId,
        primaryId: group.primaryId,
        members: group.members,
        label: `${group.members.length - 1} duplicate${group.members.length - 1 === 1 ? "" : "s"}`,
      }));
    }
    return clusters
      .map((cluster) => ({
        groupId: cluster.clusterId,
        primaryId: cluster.bestMemberId ?? cluster.members[0]?.id ?? "",
        members: cluster.members,
        label: `${Math.max(0, cluster.members.length - 1)} similar version${cluster.members.length - 1 === 1 ? "" : "s"}`,
      }))
      .filter((group) => group.members.length > 1 && group.primaryId);
  }, [clusters, duplicateGroups, engineVersion]);

  const filteredReferences = useMemo(
    () => (healthFilter === "all" ? convertedReferences : convertedReferences.filter((ref) => healthById[ref.id]?.state === healthFilter)),
    [convertedReferences, healthById, healthFilter],
  );
  const visibleReferences = useMemo(
    () => filteredReferences.slice(0, visibleLimit),
    [filteredReferences, visibleLimit],
  );
  const visibleReferenceIds = useMemo(
    () => new Set(visibleReferences.map((reference) => reference.id)),
    [visibleReferences],
  );
  const hiddenReferenceCount = Math.max(0, filteredReferences.length - visibleReferences.length);

  const displayGroups = useMemo(
    () => (groupDuplicates
      ? detectedGroups
          .map((group) => ({
            ...group,
            members: group.members.filter((member) => visibleReferenceIds.has(member.id)),
          }))
          .filter((group) => group.members.length > 0)
      : []),
    [detectedGroups, groupDuplicates, visibleReferenceIds],
  );
  const groupedReferenceIds = useMemo(() => new Set(displayGroups.flatMap((group) => group.members.map((member) => member.id))), [displayGroups]);

  const visibleUngroupedReferences = useMemo(
    () => visibleReferences.filter((ref) => !groupDuplicates || !groupedReferenceIds.has(ref.id)),
    [groupDuplicates, groupedReferenceIds, visibleReferences],
  );

  const handleSaveEdit = useCallback(async (id: string, newText: string) => {
    setUserEdits((prev) => ({ ...prev, [id]: newText }));
    pushToast({ title: "Edits Saved", description: "Your changes have been saved and the card updated locally." });
  }, [pushToast]);

  useEffect(() => {
    if (hasShownDoiToast) return;
    if (!convertedReferences.some((ref) => /doi:|https?:\/\/doi\.org/i.test(ref.originalText))) return;
    setHasShownDoiToast(true);
    const timer = window.setTimeout(() => {
      pushToast({ title: "DOIs Removed", description: "DOI fields were detected in your input. Per strict style rules, DOIs have been stripped from the output." });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [convertedReferences, hasShownDoiToast, pushToast]);

  const cleanTextForCopy = useCallback((text: string) => (keepItalics ? text : text.replace(/[*_]/g, "")), [keepItalics]);

  const handleCopyReference = useCallback(async (refId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(cleanTextForCopy(text));
      setCopiedStates((prev) => ({ ...prev, [refId]: true }));
      pushToast({ title: "Copied!", description: "Reference copied to clipboard." });
      window.setTimeout(() => setCopiedStates((prev) => ({ ...prev, [refId]: false })), 2000);
    } catch {
      emitError("Failed to copy reference to clipboard");
    }
  }, [cleanTextForCopy, emitError, pushToast]);

  const handleReported = useCallback((id: string) => {
    setReportedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    pushToast({ title: "Report submitted", description: "Thanks. Your feedback has been saved." });
  }, [pushToast]);

  const handleCopyAll = useCallback(async () => {
    try {
      const isIEEE = visibleReferences[0]?.outputStyle === "ieee";
      const allText = visibleReferences.map((ref, index) => {
        let cleanedText = cleanTextForCopy(userEdits[ref.id] ?? ref.convertedText);
        if (isIEEE && /^\[\d+\]\s*/.test(cleanedText)) cleanedText = cleanedText.replace(/^\[\d+\]\s*/, `[${index + 1}] `);
        if (showNumbered && !isIEEE) return `${index + 1}. ${cleanedText}`;
        return cleanedText;
      }).join("\n");
      await navigator.clipboard.writeText(allText);
      setAllCopied(true);
      pushToast({ title: "All Copied!", description: `${visibleReferences.length} references copied to clipboard.` });
      window.setTimeout(() => setAllCopied(false), 2000);
    } catch {
      emitError("Failed to copy references to clipboard");
    }
  }, [cleanTextForCopy, emitError, pushToast, showNumbered, userEdits, visibleReferences]);

  const handleDownloadTxt = useCallback(() => {
    const payload = convertedReferences.map((ref, index) => {
      const text = userEdits[ref.id] ?? ref.convertedText;
      return showNumbered ? `${index + 1}. ${text}` : text;
    }).join("\n\n");
    downloadTextFile(payload, "references.txt");
    pushToast({ title: "Downloaded!", description: "References downloaded as TXT file." });
  }, [convertedReferences, pushToast, showNumbered, userEdits]);

  const handleDownloadBibtex = useCallback(() => {
    downloadTextFile(convertedReferences.map(toBibtexEntry).join("\n\n"), "references.bib", "text/x-bibtex;charset=utf-8");
    pushToast({ title: "Downloaded!", description: "References downloaded as BibTeX file." });
  }, [convertedReferences, pushToast]);

  const handleDownloadRis = useCallback(() => {
    downloadTextFile(convertedReferences.map(toRisEntry).join("\n\n"), "references.ris", "application/x-research-info-systems;charset=utf-8");
    pushToast({ title: "Downloaded!", description: "References downloaded as RIS file." });
  }, [convertedReferences, pushToast]);

  const handleDownloadPDF = useCallback(async () => {
    try {
      const { default: jsPDF } = await import("jspdf");
      const pdf = new jsPDF();
      const pageHeight = pdf.internal.pageSize.height;
      const margin = 20;
      let yPosition = margin;
      pdf.setFontSize(16);
      pdf.text("Converted References", margin, yPosition);
      yPosition += 15;
      pdf.setFontSize(11);
      const isIEEE = convertedReferences[0]?.outputStyle === "ieee";
      convertedReferences.forEach((ref, index) => {
        let text = cleanTextForCopy(userEdits[ref.id] ?? ref.convertedText);
        if (isIEEE && /^\[\d+\]\s*/.test(text)) text = text.replace(/^\[\d+\]\s*/, `[${index + 1}] `);
        if (showNumbered && !isIEEE) text = `${index + 1}. ${text}`;
        const lines = pdf.splitTextToSize(text, pdf.internal.pageSize.width - 2 * margin);
        if (yPosition + (lines.length * 6) > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
        }
        pdf.text(lines, margin, yPosition);
        yPosition += lines.length * 6 + 2;
      });
      pdf.save("converted-references.pdf");
      pushToast({ title: "PDF Downloaded!", description: "References exported as PDF." });
    } catch {
      emitError("Failed to generate PDF. Install jspdf if you want PDF export.");
    }
  }, [cleanTextForCopy, convertedReferences, emitError, pushToast, showNumbered, userEdits]);

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
    const duplicates = groupDuplicates
      ? detectedGroups.reduce((sum, group) => sum + Math.max(0, group.members.length - 1), 0)
      : 0;
    return { total, clean, review, actionNeeded, duplicates };
  }, [convertedReferences, detectedGroups, groupDuplicates, healthById]);

  const stageDebugSummary = useMemo(
    () => buildStageDebugSummary(convertedReferences, healthById, groupedReferenceIds),
    [convertedReferences, groupedReferenceIds, healthById],
  );

  if (convertedReferences.length === 0) {
    return (
      <>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <div className="py-12 text-center">
          <div className="mb-4 text-slate-500">
            <FileText className="mx-auto mb-2 h-12 w-12 opacity-50" />
            <p>No converted references yet</p>
            <p className="text-sm">Convert some references to see them here.</p>
          </div>
        </div>
      </>
    );
  }

  const cleanPct = healthStats.total ? (healthStats.clean / healthStats.total) * 100 : 0;
  const reviewPct = healthStats.total ? (healthStats.review / healthStats.total) * 100 : 0;

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="space-y-4 sm:space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-sm font-bold text-[#002147]">Reference Health</h4>
            <span className="text-xs text-slate-500">{healthStats.total} total references</span>
          </div>

          <div className="mb-4 flex h-2 w-full overflow-hidden rounded-full bg-rose-500">
            {cleanPct > 0 ? <div className="h-full bg-emerald-500" style={{ width: `${cleanPct}%` }} /> : null}
            {reviewPct > 0 ? <div className="h-full bg-amber-400" style={{ width: `${reviewPct}%` }} /> : null}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <button type="button" className={cn("flex items-center gap-2 text-xs font-bold text-slate-600 hover:underline", healthFilter === "clean" && "underline")} onClick={() => setHealthFilter((prev) => (prev === "clean" ? "all" : "clean"))}>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span><span className="text-emerald-600">{healthStats.clean}</span> ready</span>
            </button>
            <button type="button" className={cn("flex items-center gap-2 text-xs font-bold text-slate-600 hover:underline", healthFilter === "review" && "underline")} onClick={() => setHealthFilter((prev) => (prev === "review" ? "all" : "review"))}>
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span><span className="text-amber-600">{healthStats.review}</span> review</span>
            </button>
            <button type="button" className={cn("flex items-center gap-2 text-xs font-bold text-slate-600 hover:underline", healthFilter === "action_needed" && "underline")} onClick={() => setHealthFilter((prev) => (prev === "action_needed" ? "all" : "action_needed"))}>
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              <span><span className="text-rose-600">{healthStats.actionNeeded}</span> action needed</span>
            </button>
          </div>

          {(healthStats.duplicates > 0 || SHOW_ZERO_DUPLICATES_IN_UI) ? <p className="mt-4 text-[10px] text-slate-400">Includes {healthStats.duplicates} likely duplicate{healthStats.duplicates === 1 ? "" : "s"}.</p> : null}

          <div className="mt-6 flex flex-col items-start justify-between gap-4 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={showDebug} onChange={(event) => setShowDebug(event.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-[#002147] focus:ring-[#002147]" />
              <span>Advanced details</span>
            </label>
            <ActionButton
              variant="outline"
              onClick={() => setShowOriginalInput((prev) => !prev)}
              className={cn(
                "w-full border-[#002147] sm:w-auto",
                showOriginalInput
                  ? "!bg-[#002147] !text-white hover:!bg-[#002147] hover:!text-white focus-visible:!bg-[#002147] focus-visible:!text-white"
                  : "!bg-white !text-[#002147] hover:!bg-white hover:!text-[#002147]",
              )}
            >
              {showOriginalInput ? "Hide original input" : "Show original input"}
            </ActionButton>
          </div>
        </div>

        {showDebug ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Review Hotspots</h4>
                <p className="text-xs text-slate-500">Debug view for all citations currently flagged as review or action needed.</p>
              </div>
              <Badge className="w-fit border border-slate-200 bg-slate-50 text-slate-600">{convertedReferences.filter((ref) => healthById[ref.id]?.state !== "clean").length} flagged total</Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {stageDebugSummary.length > 0
                ? stageDebugSummary.map((stage) => (
                    <HoverCard
                      key={stage.key}
                      trigger={(
                        <Badge className="cursor-help border border-slate-200 bg-slate-50 text-slate-700">
                          {formatHotspotBadgeLabel(stage)}
                        </Badge>
                      )}
                    >
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-slate-900">
                          {stage.count} flagged citation{stage.count === 1 ? "" : "s"} in {stage.label}
                        </p>
                        {stage.key === "detect" && stage.formatNotRecognizedCount > 0 ? (
                          <p className="text-xs leading-5 text-slate-600">
                            From Format not recognized: {stage.formatNotRecognizedCount}
                          </p>
                        ) : null}
                        {stage.issues.length > 0 ? (
                          stage.issues.map((issue) => (
                            <p key={`${stage.key}-${issue.message}`} className="text-xs leading-5 text-slate-600">
                              {issue.count > 1 ? `${issue.count} citations: ` : ""}
                              {issue.message}
                            </p>
                          ))
                        ) : (
                          <p className="text-xs leading-5 text-slate-600">{stage.description}</p>
                        )}
                      </div>
                    </HoverCard>
                  ))
                : <div className="text-xs text-slate-500">No current review hotspots in this output set.</div>}
            </div>
          </div>
        ) : null}

        <div className="rounded-xl bg-slate-50 p-3 sm:p-4">
          {displayGroups.map((group) => {
            const overrideSelection = selectedDuplicateOverrides[group.groupId];
            const selectedId = overrideSelection && group.members.some((member) => member.id === overrideSelection) ? overrideSelection : group.primaryId;
            const filteredMembers = healthFilter === "all" ? group.members : group.members.filter((member) => healthById[member.id]?.state === healthFilter);
            if (filteredMembers.length === 0) return null;
            const mainRef = filteredMembers.find((member) => member.id === selectedId) ?? filteredMembers.find((member) => member.id === group.primaryId) ?? filteredMembers[0];
            if (!mainRef) return null;
            const duplicates = filteredMembers.filter((member) => member.id !== mainRef.id);
            return (
              <div key={group.groupId} className="relative mb-6">
                <div className="absolute bottom-0 left-0 top-0 w-1 rounded-l bg-[#002147]/20" />
                <div className="pl-4">
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
                    onReport={onReport}
                    renderExtractedFields={renderExtractedFields}
                    renderReferenceInsights={renderReferenceInsights}
                  />

                  {duplicates.length > 0 ? (
                    <details className="-mt-2 border-l-2 border-slate-200 pl-6">
                      <summary className="mb-2 cursor-pointer list-none rounded-xl px-2 py-2 text-xs font-bold text-slate-500 hover:bg-white">
                        Reveal {duplicates.length} duplicate{duplicates.length === 1 ? "" : "s"}
                      </summary>
                      <div className="space-y-3">
                        {duplicates.map((dup) => {
                          const isSelected = dup.id === selectedId;
                          return (
                            <MemoCitationRow
                              key={dup.id}
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
                              onReport={onReport}
                              renderExtractedFields={renderExtractedFields}
                              renderReferenceInsights={renderReferenceInsights}
                              extraActions={
                                <ActionButton
                                  variant={isSelected ? "solid" : "ghost"}
                                  onClick={() => setSelectedDuplicateOverrides((prev) => ({ ...prev, [group.groupId]: dup.id }))}
                                  className={cn("px-3 py-1.5 text-xs", !isSelected && "text-slate-600")}
                                >
                                  {isSelected ? "Selected version" : "Select this version"}
                                </ActionButton>
                              }
                            />
                          );
                        })}
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            );
          })}

          {visibleUngroupedReferences.map((ref) => (
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
              onReport={onReport}
              renderExtractedFields={renderExtractedFields}
              renderReferenceInsights={renderReferenceInsights}
            />
          ))}

          {hiddenReferenceCount > 0 ? (
            <div className="mt-2 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center sm:flex-row sm:justify-between sm:text-left">
              <p className="text-xs font-semibold text-slate-600">
                Showing {visibleReferences.length.toLocaleString()} of {filteredReferences.length.toLocaleString()} reference{filteredReferences.length === 1 ? "" : "s"} in this view.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <ActionButton
                  variant="outline"
                  onClick={() => setVisibleLimit((current) => current + REFERENCE_RENDER_INCREMENT)}
                  className="border-slate-300 bg-white text-slate-700"
                >
                  Show more
                </ActionButton>
                <ActionButton
                  variant="solid"
                  onClick={() => setVisibleLimit(filteredReferences.length)}
                  className="bg-[#061126] text-white"
                >
                  Show all
                </ActionButton>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mb-20 w-full space-y-8 sm:mb-0">
          <div className="space-y-2">
            <label className="flex items-center gap-3 text-[15px] font-medium text-[#0b1530]">
              <input type="checkbox" checked={showNumbered} onChange={(event) => setShowNumbered(event.target.checked)} className="h-4 w-4 rounded-[2px] border-slate-400 text-[#002147] focus:ring-[#002147]" />
              Number references (1., 2., 3...)
            </label>
            <label className="flex items-center gap-3 text-[15px] font-medium text-[#0b1530]">
              <input type="checkbox" checked={keepItalics} onChange={(event) => setKeepItalics(event.target.checked)} className="h-4 w-4 rounded-[2px] border-slate-400 text-[#002147] focus:ring-[#002147]" />
              Keep italics formatting (*text*) when copying
            </label>
          </div>

          <div className={cn("fixed z-40 flex flex-row gap-3 bg-white/95 backdrop-blur md:relative md:left-auto md:right-auto md:w-full md:translate-x-0 md:bg-transparent md:backdrop-blur-none", isScrollPastThreshold ? "bottom-4 left-4 right-[4.5rem] w-auto sm:right-[5.5rem]" : "bottom-4 left-1/2 w-[calc(100vw-3rem)] -translate-x-1/2 sm:w-auto md:left-auto md:bottom-auto md:translate-x-0")}>
            <ActionButton variant="solid" onClick={handleCopyAll} disabled={allCopied} className="h-11 flex-1 rounded-none bg-[#061126] px-4 text-[16px] font-semibold text-white hover:bg-[#061126] md:min-w-0 md:flex-[1.7]">
              {allCopied ? <Check className="h-[18px] w-[18px]" /> : <ClipboardList className="h-[18px] w-[18px]" />}
              {allCopied ? "Copied!" : "Copy All"}
            </ActionButton>

            <div ref={downloadMenuRef} className="relative flex-[0.58] sm:flex-[0.54]">
              <ActionButton variant="outline" onClick={() => setShowDownloadMenu((current) => !current)} className="h-11 w-full rounded-none border-slate-300 bg-white px-4 text-[16px] font-medium text-[#061126] hover:bg-slate-50">
                <Download className="h-[18px] w-[18px]" />
                <span>Download</span>
                <ChevronDown className="ml-1 h-[18px] w-[18px]" />
              </ActionButton>

              {showDownloadMenu ? (
                <div className="absolute bottom-[calc(100%+0.5rem)] right-0 z-10 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  <button type="button" onClick={() => { setShowDownloadMenu(false); handleDownloadTxt(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <FileText className="h-4 w-4" />
                    TXT
                  </button>
                  <button type="button" onClick={() => { setShowDownloadMenu(false); void handleDownloadPDF(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Download className="h-4 w-4" />
                    PDF
                  </button>
                  <button type="button" onClick={() => { setShowDownloadMenu(false); handleDownloadBibtex(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <FileCode className="h-4 w-4" />
                    BibTeX
                  </button>
                  <button type="button" onClick={() => { setShowDownloadMenu(false); handleDownloadRis(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Database className="h-4 w-4" />
                    RIS
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export const demoPortableReferences: ConvertedReference[] = [
  {
    id: "1",
    originalText: "Smith J and Patel R. 2024. Mapping citation intelligence in academic workflows. Journal of Research Design 18(2):44-61",
    convertedText: "Smith, J., & Patel, R. (2024). *Mapping citation intelligence in academic workflows*. Journal of Research Design, 18(2), 44-61.",
    inputStyle: "auto",
    outputStyle: "apa",
    referenceType: "journal",
    parsedData: {
      authors: [{ family: "Smith", given: "J." }, { family: "Patel", given: "R." }],
      title: "Mapping citation intelligence in academic workflows",
      year: "2024",
      journal: "Journal of Research Design",
      volume: "18",
      issue: "2",
      pages: "44-61",
    },
    confidence: { score: 98, breakdown: { rules: 98, validation: 0 } },
    authorityStatus: "cache_hit",
    authorityData: {
      title: "Mapping citation intelligence in academic workflows",
      authors: ["Smith, J.", "Patel, R."],
      journal: "Journal of Research Design",
      year: "2024",
      url: "https://example.com/reference-1",
    },
    assertionSummary: { total: 8, passed: 8, failed: 0, failedCritical: 0, details: [] },
    reportEngineSnapshot: {
      engineVersion: "v2",
      extractorPath: "deterministic+repair",
      processingPath: { partialResult: false, stagesRun: ["ingest", "split", "detect_style", "extract_fields", "normalize", "validate", "render"], fallbacksUsed: [], partialReasons: [] },
      stageLogSummary: [{ stageId: "extract", status: "info", message: "Structured fields resolved cleanly." }],
      validationCodes: [],
      qualityFlags: ["ready_to_submit"],
      splitContaminationFlags: [],
    },
  },
  {
    id: "2",
    originalText: "WHO Global Health Observatory, 2023, https://www.who.int/data/gho",
    convertedText: "World Health Organization. (2023). *Global health observatory*. https://www.who.int/data/gho",
    inputStyle: "harvard",
    outputStyle: "apa",
    referenceType: "website",
    parsedData: {
      title: "Global health observatory",
      year: "2023",
      url: "https://www.who.int/data/gho",
      authors: ["World Health Organization"],
    },
    confidence: { score: 84, breakdown: { rules: 84, validation: 0 } },
    authorityStatus: "no_match",
    assertionSummary: {
      total: 7,
      passed: 6,
      failed: 1,
      failedCritical: 0,
      details: [{ id: "web-access-date", description: "Access date may be required for your policy.", passed: false, severity: "warning" }],
    },
    reportEngineSnapshot: {
      engineVersion: "v2",
      extractorPath: "heuristic_web",
      processingPath: { partialResult: true, stagesRun: ["ingest", "split", "detect_style", "extract_fields", "normalize", "validate", "render"], fallbacksUsed: ["web_title_cleanup"], partialReasons: ["authority_unconfirmed"] },
      stageLogSummary: [{ stageId: "enrich", status: "warning", message: "No authoritative match found for this website record.", code: "no_match" }],
      validationCodes: ["authority_unconfirmed"],
      qualityFlags: ["review_recommended"],
      splitContaminationFlags: [],
    },
    healthState: "review",
    healthReasons: ["Most core fields were found, but external validation could not confirm an exact match."],
  },
  {
    id: "3",
    originalText: "Nguyen T 2022 Adaptive parsing systems for citation cleanup International Conference on Data Pipelines",
    convertedText: "Nguyen, T. (2022). Adaptive parsing systems for citation cleanup. In *Proceedings of the International Conference on Data Pipelines*.",
    inputStyle: "auto",
    outputStyle: "apa",
    referenceType: "conference",
    parsedData: {
      authors: ["Nguyen, T."],
      title: "Adaptive parsing systems for citation cleanup",
      year: "2022",
      conferenceTitle: "International Conference on Data Pipelines",
    },
    confidence: { score: 63, isSuspicious: true, breakdown: { rules: 63, validation: 0 } },
    authorityStatus: "error",
    warnings: ["warning: missing_locator", "warning: venue_missing_for_conference"],
    assertionSummary: {
      total: 6,
      passed: 4,
      failed: 2,
      failedCritical: 1,
      details: [
        { id: "locator", description: "Conference citation is missing pages or article number.", passed: false, severity: "error" },
        { id: "venue-shape", description: "Venue information may be incomplete.", passed: false, severity: "warning" },
      ],
    },
    assertionHighlights: [{ start: 0, end: 10, message: "Author block may need manual review.", severity: "warning" }],
    reportEngineSnapshot: {
      engineVersion: "v2",
      extractorPath: "conference_repair",
      processingPath: { partialResult: true, stagesRun: ["ingest", "split", "detect_style", "extract_fields", "normalize", "validate", "render"], fallbacksUsed: ["conference_title_repair"], partialReasons: ["missing_locator"] },
      stageLogSummary: [
        { stageId: "extract", status: "warning", message: "Conference venue recovered but locator is missing.", code: "missing_locator" },
        { stageId: "render", status: "error", message: "Final output still lacks a locator for a structured conference citation.", code: "render_output_empty_or_invalid" },
      ],
      validationCodes: ["missing_locator"],
      qualityFlags: ["manual_review_required"],
      splitContaminationFlags: [],
    },
    healthState: "action_needed",
    healthReasons: ["Conference citation is missing a required locator and should be fixed before submission."],
  },
];
