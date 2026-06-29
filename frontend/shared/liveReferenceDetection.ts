const NUMERIC_CITATION_MARKER_PATTERN = /^(?:\[\d+\]|\d+[.)])\s+/;
/** Line-start markers: [n] or n./n) — exclude lines that begin with a calendar year (19xx/20xx.) */
const LINE_BRACKET_MARKER_PATTERN = /^\s*\[(\d{1,4})\]\s+(\S.*)?$/u;
const LINE_DOT_MARKER_PATTERN = /^\s*(?!(?:19|20)\d{2}[.)])(\d{1,4})[.)]\s+(\S.*)?$/u;
const SURNAME_INITIAL_OPENER_PATTERN = /^[A-Z][A-Za-záéíóúüñç'’.-]+,\s+[A-Z](?:[.\-\s]*[A-Z])*\.?(?:\s|,|&)/u;
const SURNAME_FULL_NAME_OPENER_PATTERN = /^[A-Z][A-Za-záéíóúüñç'’.-]+,\s+[A-Z][A-Za-záéíóúüñç'’.-]+(?:\s+[A-Z][A-Za-záéíóúüñç'’.-]+){0,3}\.?(?:\s|,|["“”'])/u;
const ORG_AUTHOR_OPENER_PATTERN = /^[A-Z][A-Za-z&'’.-]+(?:\s+(?:(?:of|and|for|the|in|on|at|by|de|van|du|der|da|del|di|la|le)\b|[A-Z][A-Za-z&'’.-]+)){0,7}\.\s/u;
const COMPACT_AUTHOR_RUN_OPENER_PATTERN = /^(?:[A-Z][A-Za-z'’.-]+\s+[A-Z]{1,4}\.?,\s*){1,}[A-Z][A-Za-z'’.-]+\s+[A-Z]{1,4}\.?/u;
const INITIALS_LEAD_AUTHOR_RUN_OPENER_PATTERN = /^(?:(?:[A-Z]\.\s*){1,3}[A-Z][A-Za-z'’.-]+,\s*){1,}(?:and\s+)?(?:[A-Z]\.\s*){1,3}[A-Z][A-Za-z'’.-]+/u;
const YEAR_ANCHOR_PATTERN = /\(\d{4}[a-z]?\)/u;
const BARE_TRAILING_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/u;
const VANCOUVER_TAIL_PATTERN = /\b(?:19|20)\d{2};\d+(?:\([A-Za-z0-9-]+\))?:[A-Za-z]?\d/u;
const DOI_CORE_PATTERN = /\b10\.\d{4,9}\/\S+\b/iu;
const DOI_TOKEN_PATTERN = /\bdoi\s*:\s*10\.\d{4,9}\/\S+\b/iu;
const URL_PATTERN = /https?:\/\/\S+/iu;
const ACCESS_DATE_PATTERN = /^(?:accessed|viewed|retrieved)\b/i;
const SHORT_HEADING_PATTERN = /^(?:references?|bibliography|works cited)$/iu;
const PAGE_ARTIFACT_PATTERN = /^(?:page\s+)?\d+\.?(?:\s+(?:of|\/)\s+\d+)?$/iu;
const RUNNING_TITLE_PATTERN = /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,8}$/u;
const CONTINUATION_TAIL_PATTERN = /(?:&|,|\band\b)\s*$/iu;
const SURNAME_INITIAL_TAIL_PATTERN = /[A-Z][A-Za-záéíóúüñç'’.-]+,\s+[A-Z](?:[.\-\s]*[A-Z])*\.?$/u;
const OPENER_THRESHOLD = 0.58;
const SUSPECTED_MULTI_CITATION_CHARS = 2000;
const SECONDARY_BOUNDARY_PATTERN = /(?<=\.)\s+(?=[A-Z][A-Za-z'’.-]+,\s+[A-Z][^()]{0,40}\(\d{4}\))/g;

type RawLine = {
  lineIndex: number;
  sourceLineNumber: number;
  text: string;
  trimmed: string;
};

type LiveContentLine = {
  lineIndex: number;
  sourceLineNumber: number;
  text: string;
  role: "content" | "artifact" | "uri_tail";
  excluded: boolean;
  openerConfidence: number;
  continuationSignals: string[];
  rule?: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDoiValue(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[.)]+$/, "");
}

function compactUriDoiSpacing(value: string): string {
  return value
    .replace(/\bhttps?\s*:\s*\/\s*\//gi, (match) => match.replace(/\s+/g, ""))
    .replace(/\bwww\s*\.\s*/gi, "www.")
    .replace(/\bdoi\s*:\s*10\.\s*(\d{4,})\s*\/\s*/gi, "doi:10.$1/")
    .replace(/\b10\s*\.\s*(\d{4,})\s*\/\s*/g, "10.$1/");
}

function normalizeDoi(raw: string): string | null {
  const doi = normalizeDoiValue(raw);
  return /^10\.\d{4,}\/\S+$/i.test(doi) ? doi : null;
}

function detectExplicitCount(text: string): number | null {
  if (/@\w+\s*\{[^,]+,/.test(text)) {
    return (text.match(/@\w+\s*\{/g) ?? []).length;
  }

  if (/^TY\s+-\s+\w+/m.test(text)) {
    return (text.match(/^TY\s+-/gm) ?? []).length;
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((line) => Boolean(normalizeDoi(line)))) {
    return lines.length;
  }

  return null;
}

function toRawLines(rawItem: string): RawLine[] {
  return rawItem.split(/\r?\n/).map((line, index) => {
    const text = line.replace(/\r$/, "");
    return {
      lineIndex: index,
      sourceLineNumber: index + 1,
      text,
      trimmed: text.trim(),
    };
  });
}

function stripLeadingCitationNumbering(value: string): string {
  return value.replace(NUMERIC_CITATION_MARKER_PATTERN, "").trim();
}

function normalizeLineForScoring(value: string): string {
  return normalizeWhitespace(stripLeadingCitationNumbering(value))
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s+:/g, ":");
}

function tokenCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function containsUppercaseWord(value: string): boolean {
  return /\b[A-Z][A-Za-z'’.-]+\b/u.test(value);
}

function hasSubstantialReferenceBody(remainder: string): boolean {
  const trimmed = remainder.trim();
  if (tokenCount(trimmed) < 3) return false;
  if (/^https?:\/\//iu.test(trimmed)) return false;
  return (
    containsUppercaseWord(trimmed)
    || YEAR_ANCHOR_PATTERN.test(trimmed)
    || BARE_TRAILING_YEAR_PATTERN.test(trimmed)
    || /[,:]/.test(trimmed)
  );
}

function hasValidNumericMarkerLead(value: string): boolean {
  const numericMarkerMatch = value.match(NUMERIC_CITATION_MARKER_PATTERN);
  if (!numericMarkerMatch) return false;
  const remainder = value.slice(numericMarkerMatch[0].length).trim();
  return hasSubstantialReferenceBody(remainder);
}

/** Counts lines that start like bibliography rows: `[n] …` or `n.` / `n)` … (not only brackets). */
function countLineBasedReferenceMarkers(text: string): number {
  const rawLines = toRawLines(text);
  let count = 0;
  for (const line of rawLines) {
    const t = line.trimmed;
    if (!t) continue;
    if (classifyArtifactRule(line)) continue;
    if (isUriTailLine(line)) continue;

    const bracket = t.match(LINE_BRACKET_MARKER_PATTERN);
    if (bracket?.[2] != null && hasSubstantialReferenceBody(bracket[2])) {
      count += 1;
      continue;
    }

    const dot = t.match(LINE_DOT_MARKER_PATTERN);
    if (dot?.[2] != null && hasSubstantialReferenceBody(dot[2])) {
      count += 1;
    }
  }
  return count;
}

function isLikelyGroupAuthorLine(value: string): boolean {
  return ORG_AUTHOR_OPENER_PATTERN.test(value)
    && /\b(?:organization|agency|department|ministry|council|center|centre|institute|association|team|group|committee|university|hospital|foundation|office|programme|program|research|service|society|commission)\b/i.test(value);
}

function hasAuthorLead(normalized: string): boolean {
  return SURNAME_INITIAL_OPENER_PATTERN.test(normalized)
    || SURNAME_FULL_NAME_OPENER_PATTERN.test(normalized)
    || COMPACT_AUTHOR_RUN_OPENER_PATTERN.test(normalized)
    || INITIALS_LEAD_AUTHOR_RUN_OPENER_PATTERN.test(normalized)
    || isLikelyGroupAuthorLine(normalized);
}

function isBlankEquivalent(line: RawLine): boolean {
  return tokenCount(line.trimmed) === 0;
}

function isPageArtifact(line: RawLine): boolean {
  return PAGE_ARTIFACT_PATTERN.test(line.trimmed) || /\b\d+\s+of\s+\d+\b/i.test(line.trimmed);
}

function isRunningTitle(line: RawLine): boolean {
  if (!RUNNING_TITLE_PATTERN.test(line.trimmed)) return false;
  if (line.trimmed.includes(".")) return false;
  return tokenCount(line.trimmed) <= 10 && !YEAR_ANCHOR_PATTERN.test(line.trimmed);
}

function classifyArtifactRule(line: RawLine): string | null {
  if (isBlankEquivalent(line)) return "blank_equivalent";
  if (SHORT_HEADING_PATTERN.test(line.trimmed)) return "section_heading";
  if (isPageArtifact(line)) return "page_number";
  if (isRunningTitle(line)) return "running_title";
  return null;
}

function parseableUriOrDoi(value: string): boolean {
  return DOI_CORE_PATTERN.test(compactUriDoiSpacing(value))
    || DOI_TOKEN_PATTERN.test(compactUriDoiSpacing(value))
    || URL_PATTERN.test(compactUriDoiSpacing(value));
}

function isUriTailLine(line: RawLine): boolean {
  if (!parseableUriOrDoi(line.trimmed)) return false;
  if (ACCESS_DATE_PATTERN.test(line.trimmed)) return false;
  return tokenCount(line.trimmed) <= 8 || /^(?:doi:|https?:\/\/|www\.)/i.test(line.trimmed);
}

function continuationSignalsForLine(normalized: string, nextNormalized: string | null): string[] {
  const signals: string[] = [];
  if (CONTINUATION_TAIL_PATTERN.test(normalized)) signals.push("tail_connector");
  if (SURNAME_INITIAL_TAIL_PATTERN.test(normalized)) signals.push("surname_initial_tail");
  if ((normalized.endsWith("-") || normalized.endsWith("\u00ad")) && nextNormalized && /^[a-z]/u.test(nextNormalized)) {
    signals.push("wrapped_hyphen");
  }
  if (nextNormalized && !/[.?!]$/.test(normalized)) {
    signals.push("soft_wrap");
  }
  return signals;
}

function previousArtifactBoundary(lines: RawLine[], lineIndex: number): boolean {
  if (lineIndex <= 0) return false;
  const previousLine = lines[lineIndex - 1];
  return previousLine ? isBlankEquivalent(previousLine) || classifyArtifactRule(previousLine) != null : false;
}

function nextImmediateContentLine(lines: RawLine[], lineIndex: number): RawLine | null {
  const line = lines[lineIndex + 1];
  if (!line) return null;
  return classifyArtifactRule(line) ? null : line;
}

function previousNonExcludedLine(contentLines: LiveContentLine[], lineIndex: number): LiveContentLine | null {
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const line = contentLines[index];
    if (!line || line.excluded) continue;
    return line;
  }
  return null;
}

function scoreLine(
  rawLine: RawLine,
  lines: RawLine[],
  nextLine: RawLine | null,
  continuationSignals: string[],
): number {
  const normalized = normalizeLineForScoring(rawLine.trimmed);
  if (!normalized) return 0;

  let score = 0;
  const numericLead = hasValidNumericMarkerLead(rawLine.trimmed);
  const authorLead = hasAuthorLead(normalized);

  if (numericLead) score += 0.4;
  if (authorLead) score += 0.35;
  if (YEAR_ANCHOR_PATTERN.test(normalized)) score += 0.25;
  if (previousArtifactBoundary(lines, rawLine.lineIndex)) score += 0.1;
  if (
    authorLead
    && continuationSignals.length > 0
    && nextLine
    && YEAR_ANCHOR_PATTERN.test(normalizeLineForScoring(nextLine.trimmed))
  ) {
    score += 0.25;
  }
  if (numericLead && VANCOUVER_TAIL_PATTERN.test(normalized)) score += 0.25;
  if (/^[a-z]/u.test(normalized) || /^(?:&|and|et\s+al\.?)/iu.test(normalized)) score -= 0.45;
  if (!YEAR_ANCHOR_PATTERN.test(normalized) && tokenCount(normalized) < 4) score -= 0.2;
  if (/^(?:In |pp?\.?|vol\.?|issue\b|doi:|https?:\/\/|www\.)/i.test(normalized)) score -= 0.15;

  return Number(Math.max(0, Math.min(1, score)).toFixed(2));
}

function buildContentLines(lines: RawLine[]): LiveContentLine[] {
  return lines.map((line) => {
    const artifactRule = classifyArtifactRule(line);
    if (artifactRule) {
      return {
        lineIndex: line.lineIndex,
        sourceLineNumber: line.sourceLineNumber,
        text: line.text,
        role: "artifact" as const,
        excluded: true,
        openerConfidence: 0,
        continuationSignals: [],
        rule: artifactRule,
      };
    }

    if (isUriTailLine(line)) {
      return {
        lineIndex: line.lineIndex,
        sourceLineNumber: line.sourceLineNumber,
        text: line.text,
        role: "uri_tail" as const,
        excluded: false,
        openerConfidence: 0,
        continuationSignals: ["uri_tail"],
      };
    }

    const nextLine = nextImmediateContentLine(lines, line.lineIndex);
    const continuationSignals = continuationSignalsForLine(
      normalizeLineForScoring(line.trimmed),
      nextLine ? normalizeLineForScoring(nextLine.trimmed) : null,
    );
    const rawOpenerScore = scoreLine(line, lines, nextLine, continuationSignals);

    return {
      lineIndex: line.lineIndex,
      sourceLineNumber: line.sourceLineNumber,
      text: line.text,
      role: "content" as const,
      excluded: false,
      openerConfidence: rawOpenerScore,
      continuationSignals,
    };
  }).map((line, index, contentLines) => {
    if (line.role !== "content") return line;
    const previous = previousNonExcludedLine(contentLines, index);
    if (!previous) return line;
    if (previous.continuationSignals.some((signal) => signal !== "uri_tail")) {
      return {
        ...line,
        openerConfidence: 0,
      };
    }
    return line;
  });
}

function startsNewCitation(
  line: LiveContentLine,
  hasCurrentCandidate: boolean,
  boundaryBefore: boolean,
): boolean {
  if (line.role !== "content") return false;
  if (hasValidNumericMarkerLead(line.text.trim())) return true;
  if (!hasCurrentCandidate) return true;

  if (boundaryBefore) {
    const normalized = normalizeLineForScoring(line.text.trim());
    if (hasValidNumericMarkerLead(line.text.trim()) || hasAuthorLead(normalized)) return true;
    if (
      /^[\p{Lu}]/u.test(normalized)
      && tokenCount(normalized) >= 4
      && YEAR_ANCHOR_PATTERN.test(normalized)
      && !/^(?:In |Translated |Edited |Retrieved |Available )/iu.test(normalized)
    ) {
      return true;
    }
  }

  return line.openerConfidence >= OPENER_THRESHOLD;
}

function secondaryBoundaryRecoveryCount(raw: string): number {
  if (normalizeWhitespace(raw).length <= SUSPECTED_MULTI_CITATION_CHARS) return 1;

  const matches = [...raw.matchAll(SECONDARY_BOUNDARY_PATTERN)];
  if (matches.length === 0) return 1;

  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    const boundary = match.index ?? 0;
    parts.push(raw.slice(lastIndex, boundary).trim());
    lastIndex = boundary + match[0].length;
  }
  parts.push(raw.slice(lastIndex).trim());

  return parts.filter(Boolean).length || 1;
}

function countStructuralCandidates(rawItem: string): number {
  const rawLines = toRawLines(rawItem);
  const contentLines = buildContentLines(rawLines);

  let count = 0;
  let hasCurrentCandidate = false;
  let pendingUriTailCount = 0;

  const finalizeCurrent = () => {
    if (!hasCurrentCandidate) return;
    count += 1;
    hasCurrentCandidate = false;
  };

  for (const rawLine of rawLines) {
    const contentLine = contentLines[rawLine.lineIndex];
    if (!contentLine) continue;

    if (contentLine.role === "artifact") continue;

    if (contentLine.role === "uri_tail") {
      if (hasCurrentCandidate) {
        pendingUriTailCount = 0;
      } else {
        pendingUriTailCount += 1;
      }
      continue;
    }

    const boundaryBefore = previousArtifactBoundary(rawLines, rawLine.lineIndex);
    if (startsNewCitation(contentLine, hasCurrentCandidate, boundaryBefore)) {
      finalizeCurrent();
      hasCurrentCandidate = true;
      pendingUriTailCount = 0;
      continue;
    }

    if (!hasCurrentCandidate) {
      hasCurrentCandidate = true;
      pendingUriTailCount = 0;
    }
  }

  finalizeCurrent();

  if (pendingUriTailCount > 0) {
    count += 1;
  }

  if (count > 1) return count;

  return Math.max(count, secondaryBoundaryRecoveryCount(rawItem));
}

export function countEngineLikeInputReferences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const explicitCount = detectExplicitCount(trimmed);
  if (explicitCount && explicitCount > 0) return explicitCount;

  const structural = countStructuralCandidates(trimmed);
  const lineMarkers = countLineBasedReferenceMarkers(trimmed);
  return Math.max(structural, lineMarkers, 1);
}
