import type {
  AppliedRepairMetadata,
  FieldRepairConfidence,
  RepairMissMetadata,
  ResidualArtifactMetadata,
} from '@shared/schema';
import type {
  SplitContaminationFlag,
  SplitRepairAction,
  StrippedRegion,
  V2ContentLine,
  V2PreparedWorkingChunk,
  V2SplitArtifact,
  V2WorkingChunkFieldHint,
  V2WorkingChunkFieldHintType,
} from './contracts.js';
import { V2_THRESHOLD_POLICY } from './thresholdPolicy.js';
import { compactUriDoiSpacing, normalizeDoiValue, normalizeUnicodeText, normalizeWhitespace } from './utils.js';

export const OPENER_THRESHOLD = V2_THRESHOLD_POLICY.split.openerThreshold;
export const OVERSIZED_WORKING_CHUNK_CHARS = V2_THRESHOLD_POLICY.split.oversizedWorkingChunkChars;
export const OVERSIZED_WORKING_CHUNK_LINES = V2_THRESHOLD_POLICY.split.oversizedWorkingChunkLines;
const BOUNDARY_OPENER_THRESHOLD = 0.3;

const NUMERIC_CITATION_MARKER_PATTERN = /^(?:\[\d+\]|\d+[.)])\s+/;
const SURNAME_INITIAL_OPENER_PATTERN = /^[\p{Lu}][\p{L}\p{M}'’.-]+,\s+[A-Z](?:[.\-\s]*[A-Z])*\.?(?:\s|,|&)/u;
const SURNAME_FULL_NAME_OPENER_PATTERN = /^[\p{Lu}][\p{L}\p{M}'’.-]+,\s+[\p{Lu}][\p{L}\p{M}'’.-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’.-]+){0,3}\.?(?:\s|,|["“”'])/u;
const PARTICLE_SURNAME_INITIAL_OPENER_PATTERN = /^(?:de|del|della|di|dos|du|van|von|der|da|la|le)\s+[\p{Lu}][\p{L}\p{M}'’.-]+,\s+[A-Z](?:[.\-\s]*[A-Z])*\.?(?:\s|,|&|\()/u;
const PARTICLE_SURNAME_FULL_NAME_OPENER_PATTERN = /^(?:de|del|della|di|dos|du|van|von|der|da|la|le)\s+[\p{Lu}][\p{L}\p{M}'’.-]+,\s+[\p{Lu}][\p{L}\p{M}'’.-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’.-]+){0,3}\.?(?:\s|,|["“”']|\()/u;
const ORG_AUTHOR_OPENER_PATTERN = /^[\p{Lu}][\p{L}\p{M}&'’.-]+(?:\s+(?:(?:of|and|for|the|in|on|at|by|de|van|du|der|da|del|di|la|le)\b|[\p{Lu}][\p{L}\p{M}&'’.-]+)){0,7}\.\s/u;
const COMPACT_AUTHOR_RUN_OPENER_PATTERN = /^(?:[\p{Lu}][\p{L}\p{M}'’.-]+\s+[A-Z]{1,4}\.?,\s*){1,}[\p{Lu}][\p{L}\p{M}'’.-]+\s+[A-Z]{1,4}\.?/u;
const VANCOUVER_AUTHOR_RUN_OPENER_PATTERN = /^(?:[\p{Lu}][\p{L}\p{M}'’.-]+\s+[A-Z](?:[.\-\s]*[A-Z])*(?:[.,])\s+){1,}[\p{Lu}][\p{L}\p{M}'’.-]+\s+[A-Z](?:[.\-\s]*[A-Z])*\.?/u;
const SINGLE_AUTHOR_INITIAL_OPENER_PATTERN = /^[\p{Lu}][\p{L}\p{M}'’.-]+\s+[A-Z](?:[.\-\s]*[A-Z])*\.\s+[\p{Lu}"“”'(\[]/u;
const INITIALS_LEAD_AUTHOR_RUN_OPENER_PATTERN = /^(?:(?:[A-Z]\.?\s*){1,3}[\p{Lu}][\p{L}\p{M}'’.-]+(?:,\s*|\s+and\s+)){1,}(?:[A-Z]\.?\s*){1,3}[\p{Lu}][\p{L}\p{M}'’.-]+/u;
const MIXED_AUTHOR_ORDER_OPENER_PATTERN = /^(?:(?:(?:[A-Z]\.?\s*){1,3}|[\p{Lu}][\p{L}\p{M}'’.-]+\s+)[\p{Lu}][\p{L}\p{M}'’.-]+(?:,\s*|\s+and\s+)){1,}(?:(?:[A-Z]\.?\s*){1,3}|[\p{Lu}][\p{L}\p{M}'’.-]+\s+)[\p{Lu}][\p{L}\p{M}'’.-]+/u;
const YEAR_ANCHOR_PATTERN = /\(\d{4}[a-z]?\)/u;
const BARE_TRAILING_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/u;
const VANCOUVER_TAIL_PATTERN = /\b(?:19|20)\d{2};\d+(?:\([A-Za-z0-9-]+\))?:[A-Za-z]?\d/u;
const URL_PATTERN = /https?:\/\/\S+/iu;
const DOI_CORE_PATTERN = /\b10\.\d{4,9}\/\S+\b/iu;
const DOI_TOKEN_PATTERN = /\bdoi\s*:\s*10\.\d{4,9}\/\S+\b/iu;
const DOI_OR_URL_PATTERN = new RegExp(`${DOI_CORE_PATTERN.source}|${URL_PATTERN.source}|${DOI_TOKEN_PATTERN.source}`, 'iu');
const ACCESS_DATE_PATTERN = /^(?:accessed|viewed|retrieved)\b/i;
const SHORT_HEADING_PATTERN = /^(?:references?|bibliography|works cited)$/iu;
const PAGE_ARTIFACT_PATTERN = /^(?:page\s+)?\d+\.?(?:\s+(?:of|\/)\s+\d+)?$/iu;
const RUNNING_TITLE_PATTERN = /^[\p{Lu}][\p{L}\p{M}'’.-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’.-]+){1,8}$/u;
const CONTINUATION_TAIL_PATTERN = /(?:&|,|\band\b)\s*$/iu;
const SURNAME_INITIAL_TAIL_PATTERN = /[\p{Lu}][\p{L}\p{M}'’.-]+,\s+[A-Z](?:[.\-\s]*[A-Z])*\.?$/u;
const STRONG_SEPARATOR_PATTERN = /;|\)\.|[.](?=\s+[A-Z])/gu;
const BOUNDARY_CONTINUATION_PATTERN = /^(?:in\b|translated\b|edited\b|retrieved\b|available\b|accessed\b|from\b|pp?\.?\b|pages?\b|vol(?:ume)?\.?\b|issue\b|no\.?\b|doi\b|https?:\/\/|www\.|and\b|&\b)/iu;
const BOUNDARY_BIBLIOGRAPHIC_SIGNAL_PATTERN = /\b(?:10\.\d{4,9}\/\S+|https?:\/\/\S+|(?:19|20)\d{2}|vol(?:ume)?\.?\b|issue\b|no\.?\b|pp?\.?\b|pages?\b|journal\b|conference\b|proceedings\b|press\b|university\b|publisher\b)\b/iu;
const YEAR_TOKEN_PATTERN = /\(\d{4}[a-z]?\)/gu;
const SINGLE_TOKEN_ARTIFACT_PATTERN = /\b([B-HJ-Z])\s+([a-záéíóúüñç]{2,})\b/gu;
const LOWER_SINGLE_TOKEN_ARTIFACT_PATTERN = /\b([b-hj-z])\s+([a-záéíóúüñç]{2,})\b/gu;
const LOCATOR_ARTIFACT_PATTERN = /\b\d\s+\d{1,4}(?:[-–]\d+|\(\d+\)|\b)/u;
const BROKEN_URI_ARTIFACT_PATTERN = /\b(?:h\s+ttps?|https?\s+:\s*\/\s*\/|https?:\s+\/\s*\/|https?:\/\s+\/|www\s+\.\s*|doi\s+:\s*|10\s+\.\s*\d{4,9}\/|10\.\s+\d{4,9}\/|10\.\d{4,9}\s+\/|10\.\d{4,9}\/\s+\S+)/iu;

type RawLine = {
  lineIndex: number;
  sourceLineNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
  trimmed: string;
};

type CandidateBuildState = {
  includedLineIndices: number[];
  repairActions: SplitRepairAction[];
  splitReasons: string[];
};

type AllowlistEntry = {
  brokenSpan: string;
  canonicalSpan: string;
  fieldType: V2WorkingChunkFieldHintType;
  prefixAnchor?: string;
  source: string;
  createdAt: string;
  provenance: string;
};

const PDF_COPY_ALLOWLIST: AllowlistEntry[] = [
  {
    brokenSpan: 'S pringer',
    canonicalSpan: 'Springer',
    fieldType: 'publisher_place',
    prefixAnchor: 'pp.',
    source: 'Citations test 2.pdf:p1:Biggs-2015',
    createdAt: '2026-03-27',
    provenance: 'legacy_unverified',
  },
  {
    brokenSpan: 'Journal of Applied P sychology',
    canonicalSpan: 'Journal of Applied Psychology',
    fieldType: 'journal_tail',
    source: 'Citations test 2.pdf:p1:Brayfield-Rothe-1951',
    createdAt: '2026-03-27',
    provenance: 'legacy_unverified',
  },
  {
    brokenSpan: 'Human R elations',
    canonicalSpan: 'Human Relations',
    fieldType: 'journal_tail',
    source: 'Citations test 2.pdf:p1:Brough-2013',
    createdAt: '2026-03-27',
    provenance: 'legacy_unverified',
  },
  {
    brokenSpan: 'American P sychologist',
    canonicalSpan: 'American Psychologist',
    fieldType: 'journal_tail',
    source: 'Citations test 2.pdf:p1:Dipboye-Flanagan-1979',
    createdAt: '2026-03-27',
    provenance: 'legacy_unverified',
  },
];

function safeTrim(value: string): string {
  return value.replace(/\r$/, '');
}

function toRawLines(rawItem: string): RawLine[] {
  const lines: RawLine[] = [];
  const parts = rawItem.split(/\r?\n/);
  let offset = 0;
  parts.forEach((line, index) => {
    const rawLine = safeTrim(line);
    lines.push({
      lineIndex: index,
      sourceLineNumber: index + 1,
      text: rawLine,
      startOffset: offset,
      endOffset: offset + rawLine.length,
      trimmed: rawLine.trim(),
    });
    offset += rawLine.length + 1;
  });
  return lines;
}

function stripLeadingCitationNumbering(value: string): string {
  return value.replace(NUMERIC_CITATION_MARKER_PATTERN, '').trim();
}

function normalizeLineForScoring(value: string): string {
  return normalizeWhitespace(stripLeadingCitationNumbering(value))
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s+:/g, ':');
}

function tokenCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function containsUppercaseWord(value: string): boolean {
  return /\b[\p{Lu}][\p{L}\p{M}'’.-]+\b/u.test(value);
}

function hasValidNumericMarkerLead(value: string): boolean {
  const numericMarkerMatch = value.match(NUMERIC_CITATION_MARKER_PATTERN);
  if (!numericMarkerMatch) return false;
  const remainder = value.slice(numericMarkerMatch[0].length).trim();
  return tokenCount(remainder) >= 4
    && (containsUppercaseWord(remainder) || YEAR_ANCHOR_PATTERN.test(remainder) || BARE_TRAILING_YEAR_PATTERN.test(remainder));
}

function hasAuthorLead(normalized: string): boolean {
  return SURNAME_INITIAL_OPENER_PATTERN.test(normalized)
    || SURNAME_FULL_NAME_OPENER_PATTERN.test(normalized)
    || PARTICLE_SURNAME_INITIAL_OPENER_PATTERN.test(normalized)
    || PARTICLE_SURNAME_FULL_NAME_OPENER_PATTERN.test(normalized)
    || COMPACT_AUTHOR_RUN_OPENER_PATTERN.test(normalized)
    || VANCOUVER_AUTHOR_RUN_OPENER_PATTERN.test(normalized)
    || SINGLE_AUTHOR_INITIAL_OPENER_PATTERN.test(normalized)
    || INITIALS_LEAD_AUTHOR_RUN_OPENER_PATTERN.test(normalized)
    || MIXED_AUTHOR_ORDER_OPENER_PATTERN.test(normalized)
    || isLikelyGroupAuthorLine(normalized);
}

function isLikelyGroupAuthorLine(value: string): boolean {
  return ORG_AUTHOR_OPENER_PATTERN.test(value)
    && /\b(?:organization|agency|department|ministry|council|center|centre|institute|association|team|group|committee|university|hospital|foundation|office|programme|program|research|service|society|commission)\b/i.test(value);
}

function isBlankEquivalent(line: RawLine): boolean {
  return tokenCount(line.trimmed) === 0;
}

function isPageArtifact(line: RawLine): boolean {
  return PAGE_ARTIFACT_PATTERN.test(line.trimmed) || /\b\d+\s+of\s+\d+\b/i.test(line.trimmed);
}

function isRunningTitle(line: RawLine): boolean {
  if (!RUNNING_TITLE_PATTERN.test(line.trimmed)) return false;
  if (line.trimmed.includes('.')) return false;
  return tokenCount(line.trimmed) <= 10 && !YEAR_ANCHOR_PATTERN.test(line.trimmed);
}

function classifyArtifactRule(line: RawLine): string | null {
  if (isBlankEquivalent(line)) return 'blank_equivalent';
  if (SHORT_HEADING_PATTERN.test(line.trimmed)) return 'section_heading';
  if (isPageArtifact(line)) return 'page_number';
  if (isRunningTitle(line)) return 'running_title';
  return null;
}

function parseableUriOrDoi(value: string): boolean {
  return DOI_OR_URL_PATTERN.test(compactUriDoiSpacing(value));
}

function isUriTailLine(line: RawLine): boolean {
  if (!parseableUriOrDoi(line.trimmed)) return false;
  if (ACCESS_DATE_PATTERN.test(line.trimmed)) return false;
  const compacted = compactUriDoiSpacing(line.trimmed);
  if (/^(?:doi:|https?:\/\/|www\.)/i.test(compacted)) return true;

  const normalized = normalizeLineForScoring(line.trimmed);
  if (hasAuthorLead(normalized)) return false;
  if (YEAR_ANCHOR_PATTERN.test(normalized) || BARE_TRAILING_YEAR_PATTERN.test(normalized)) return false;

  return tokenCount(normalized) <= 4;
}

function continuationSignalsForLine(normalized: string, nextNormalized: string | null): string[] {
  const signals: string[] = [];
  if (CONTINUATION_TAIL_PATTERN.test(normalized)) signals.push('tail_connector');
  if (SURNAME_INITIAL_TAIL_PATTERN.test(normalized)) signals.push('surname_initial_tail');
  if ((normalized.endsWith('-') || normalized.endsWith('\u00ad')) && nextNormalized && /^[a-z]/u.test(nextNormalized)) {
    signals.push('wrapped_hyphen');
  }
  if (nextNormalized && !/[.?!]$/.test(normalized) && !parseableUriOrDoi(normalized)) {
    signals.push('soft_wrap');
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

function previousNonExcludedLine(contentLines: V2ContentLine[], lineIndex: number): V2ContentLine | null {
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const line = contentLines[index]!;
    if (line.excluded) continue;
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
  const hasValidNumericLead = hasValidNumericMarkerLead(rawLine.trimmed);
  if (hasValidNumericLead) score += 0.4;

  const authorOpener = hasAuthorLead(normalized);
  if (authorOpener) score += 0.35;
  if (YEAR_ANCHOR_PATTERN.test(normalized)) score += 0.25;
  if (previousArtifactBoundary(lines, rawLine.lineIndex)) score += 0.1;
  if (
    authorOpener
    && continuationSignals.length > 0
    && nextLine
    && YEAR_ANCHOR_PATTERN.test(normalizeLineForScoring(nextLine.trimmed))
  ) {
    score += 0.25;
  }
  if (hasValidNumericLead && VANCOUVER_TAIL_PATTERN.test(normalized)) score += 0.25;
  if ((!authorOpener && /^[a-z]/u.test(normalized)) || /^(?:&|and|et\s+al\.?)/iu.test(normalized)) score -= 0.45;
  if (!YEAR_ANCHOR_PATTERN.test(normalized) && tokenCount(normalized) < 4) score -= 0.2;
  if (/^(?:In |pp?\.?|vol\.?|issue\b|doi:|https?:\/\/|www\.)/i.test(normalized)) score -= 0.15;

  return Number(Math.max(0, Math.min(1, score)).toFixed(2));
}

function looksLikeBoundarySeed(normalized: string): boolean {
  if (!normalized) return false;
  if (BOUNDARY_CONTINUATION_PATTERN.test(normalized)) return false;
  if (hasAuthorLead(normalized)) return true;
  if (/^[\p{Ll}]/u.test(normalized)) return false;

  const tokens = tokenCount(normalized);
  if (tokens < 3) return false;

  if (YEAR_ANCHOR_PATTERN.test(normalized) && !/^(?:In |Translated |Edited |Retrieved |Available )/iu.test(normalized)) {
    return true;
  }

  if (DOI_OR_URL_PATTERN.test(compactUriDoiSpacing(normalized)) && tokens >= 4) {
    return true;
  }

  if (tokens >= 4 && BOUNDARY_BIBLIOGRAPHIC_SIGNAL_PATTERN.test(normalized) && /[.:"“”;,]/u.test(normalized)) {
    return true;
  }

  return tokens >= 6 && /\b(?:19|20)\d{2}\b/u.test(normalized) && /[.;:,]/u.test(normalized);
}

function buildContentLines(lines: RawLine[]): V2ContentLine[] {
  return lines.map((line) => {
    const artifactRule = classifyArtifactRule(line);
    if (artifactRule) {
      return {
        lineIndex: line.lineIndex,
        sourceLineNumber: line.sourceLineNumber,
        text: line.text,
        role: 'artifact' as const,
        excluded: true,
        rawOpenerScore: 0,
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
        role: 'uri_tail' as const,
        excluded: false,
        rawOpenerScore: 0,
        openerConfidence: 0,
        continuationSignals: ['uri_tail'],
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
      role: 'content' as const,
      excluded: false,
      rawOpenerScore,
      openerConfidence: rawOpenerScore,
      continuationSignals,
    };
  }).map((line, index, contentLines) => {
    if (line.role !== 'content') return line;
    const previous = previousNonExcludedLine(contentLines, index);
    if (!previous) return line;
    if (previous.continuationSignals.some((signal) => signal !== 'uri_tail')) {
      return {
        ...line,
        openerConfidence: 0,
      };
    }
    return line;
  });
}

function startsNewCitation(
  line: V2ContentLine,
  currentCandidate: CandidateBuildState | null,
  boundaryBefore: boolean,
): boolean {
  if (line.role !== 'content') return false;
  // Explicit numbered bibliography markers should always open a new citation,
  // even when the previous line looks like a soft-wrapped continuation.
  if (hasValidNumericMarkerLead(line.text.trim())) return true;
  if (!currentCandidate || currentCandidate.includedLineIndices.length === 0) return true;
  if (boundaryBefore) {
    const normalized = normalizeLineForScoring(line.text.trim());
    if (
      hasValidNumericMarkerLead(line.text.trim())
      || looksLikeBoundarySeed(normalized)
      || line.rawOpenerScore >= BOUNDARY_OPENER_THRESHOLD
    ) {
      return true;
    }
  }
  return line.openerConfidence >= OPENER_THRESHOLD;
}

function buildJoinedText(contentLines: V2ContentLine[], includedLineIndices: number[], normalizeLines: boolean): string {
  const segments: string[] = [];

  includedLineIndices.forEach((lineIndex, position) => {
    const line = contentLines[lineIndex];
    if (!line) return;
    const text = normalizeLines
      ? compactUriDoiSpacing(normalizeUnicodeText(line.text).trim())
      : line.text.trim();
    if (!text) return;

    if (segments.length === 0) {
      segments.push(text);
      return;
    }

    const previousLine = contentLines[includedLineIndices[position - 1] ?? -1];
    const joiner = previousLine?.continuationSignals.length ? ' ' : '\n';
    segments.push(joiner, text);
  });

  return segments.join('');
}

function buildStrippedRegions(candidateLines: V2ContentLine[], includedLineIndices: number[]): StrippedRegion[] {
  if (includedLineIndices.length === 0) return [];
  const first = Math.min(...includedLineIndices);
  const last = Math.max(...includedLineIndices);
  return candidateLines
    .filter((line) => line.lineIndex >= first && line.lineIndex <= last && line.role === 'artifact' && line.rule)
    .map((line) => ({
      rule: line.rule!,
      rawText: line.text,
      startOffset: 0,
      endOffset: line.text.length,
      startLine: line.sourceLineNumber,
      endLine: line.sourceLineNumber,
    }));
}

function buildLocalCandidate(
  rawLines: RawLine[],
  contentLines: V2ContentLine[],
  includedGlobalLineIndices: number[],
  splitReasons: string[],
  repairActions: SplitRepairAction[],
): { rawChunk: string; splitArtifact: V2SplitArtifact } {
  const firstIncluded = Math.min(...includedGlobalLineIndices);
  const lastIncluded = Math.max(...includedGlobalLineIndices);
  const rawSlice = rawLines.slice(firstIncluded, lastIncluded + 1);
  const localContentLines = contentLines.slice(firstIncluded, lastIncluded + 1).map((line, localIndex) => ({
    ...line,
    lineIndex: localIndex,
  }));
  const includedLineIndices = includedGlobalLineIndices.map((index) => index - firstIncluded);
  const cleanedChunk = buildJoinedText(localContentLines, includedLineIndices, false);
  const strippedRegions = buildStrippedRegions(contentLines, includedGlobalLineIndices);
  const contaminationFlags: SplitContaminationFlag[] = [];

  if (strippedRegions.some((region) => region.rule === 'running_title' || region.rule === 'section_heading')) {
    contaminationFlags.push('header_bleed_suspected');
  }
  if (strippedRegions.some((region) => region.rule === 'page_number')) {
    contaminationFlags.push('page_artifact_present');
  }
  if (includedLineIndices.length > OVERSIZED_WORKING_CHUNK_LINES || cleanedChunk.length > OVERSIZED_WORKING_CHUNK_CHARS) {
    contaminationFlags.push('oversized_chunk');
  }
  if (includedLineIndices.every((lineIndex) => localContentLines[lineIndex]?.role === 'uri_tail')) {
    contaminationFlags.push('doi_orphan');
  }
  const lastIncludedLine = localContentLines[includedLineIndices[includedLineIndices.length - 1] ?? -1];
  if (lastIncludedLine?.role === 'content' && lastIncludedLine.continuationSignals.some((signal) => signal !== 'uri_tail')) {
    contaminationFlags.push('multiline_truncation_suspected');
  }

  const confidence = Number(Math.max(
    0.35,
    0.92
      - (contaminationFlags.length * 0.08)
      - (repairActions.length * 0.03)
      - (splitReasons.includes('llm_multi_citation_resplit') ? 0.08 : 0),
  ).toFixed(2));

  return {
    rawChunk: rawSlice.map((line) => line.text).join('\n').trim(),
    splitArtifact: {
      cleanedChunk,
      confidence,
      splitReasons,
      splitMethod: splitReasons.includes('llm_multi_citation_resplit') ? 'llm' : 'structural',
      fallbackUsed: splitReasons.includes('llm_multi_citation_resplit'),
      contaminationFlags,
      strippedRegions,
      repairActions,
      chunkLength: cleanedChunk.length,
      lineCount: includedLineIndices.length,
      contentLines: localContentLines,
      includedLineIndices,
    },
  };
}

function compactNumericLocatorArtifacts(value: string): string {
  return value
    .replace(/(\d)\s+(\d)/g, '$1$2')
    .replace(/\s*[-–]\s*/g, '-')
    .replace(/\bpp?\.\s*/gi, 'pp. ');
}

function compactWrappedWordArtifacts(value: string): string {
  return value
    .replace(/\u00ad\s*(?=[a-z])/g, '')
    .replace(/-\s+(?=[a-z])/g, '-');
}

function findHintStart(text: string, anchorStart: number): number {
  const before = text.slice(0, anchorStart);
  const strongMatches = [...before.matchAll(STRONG_SEPARATOR_PATTERN)];
  if (strongMatches.length > 0) {
    const match = strongMatches[strongMatches.length - 1]!;
    return (match.index ?? 0) + match[0].length;
  }

  const newlineIndex = before.lastIndexOf('\n');
  if (newlineIndex >= 0) return newlineIndex + 1;

  const yearMatches = [...before.matchAll(YEAR_TOKEN_PATTERN)];
  if (yearMatches.length > 0) {
    const match = yearMatches[yearMatches.length - 1]!;
    return (match.index ?? 0) + match[0].length + 1;
  }

  return 0;
}

function findHintEnd(text: string, anchorEnd: number): number {
  const after = text.slice(anchorEnd);
  const nextStrong = after.search(/;|\)\.|[.](?=\s+[A-Z])/u);
  if (nextStrong >= 0) return anchorEnd + nextStrong + 1;
  const nextNewline = after.indexOf('\n');
  if (nextNewline >= 0) return anchorEnd + nextNewline;
  return text.length;
}

function findAnchorMatches(text: string): Array<V2WorkingChunkFieldHint & { priority: number }> {
  const hints: Array<V2WorkingChunkFieldHint & { priority: number }> = [];
  const pushHint = (
    fieldType: V2WorkingChunkFieldHintType,
    start: number,
    end: number,
    anchor: string,
    priority: number,
    prefixAnchor?: string,
  ) => {
    hints.push({
      fieldType,
      start,
      end,
      anchor,
      prefixAnchor,
      text: text.slice(start, end),
      priority,
    });
  };

  const uriPattern = /\b(?:doi:|https?:\/\/|www\.|10\.\d{4,9}\/)\S*/gi;
  for (const match of text.matchAll(uriPattern)) {
    if (match.index == null) continue;
    pushHint('doi_url', match.index, match.index + match[0].length, match[0], 5);
  }

  for (const entry of PDF_COPY_ALLOWLIST) {
    const matchIndex = text.indexOf(entry.brokenSpan);
    if (matchIndex < 0) continue;
    pushHint(
      entry.fieldType,
      findHintStart(text, matchIndex),
      findHintEnd(text, matchIndex + entry.brokenSpan.length),
      entry.brokenSpan,
      6,
      entry.prefixAnchor,
    );
  }

  const locatorPattern = /\b(?:pp?\.\s*\d[\d\s\-–]*|\d{4};\d+(?:\([^)]+\))?:[A-Za-z]?\d[\d\s\-–]*)/gi;
  for (const match of text.matchAll(locatorPattern)) {
    if (match.index == null) continue;
    pushHint('locator', match.index, match.index + match[0].length, match[0], 4);
  }

  const inPattern = /(?:^|\n|;\s*|\)\.\s*)(In\s+)/g;
  for (const match of text.matchAll(inPattern)) {
    if (match.index == null) continue;
    const anchorStart = match.index + match[0].lastIndexOf('In ');
    pushHint('container', anchorStart, Math.min(text.length, anchorStart + 180), 'In ', 3);
  }

  const publisherPattern = /\b(?:Springer|Wiley|Routledge|Sage Publications?|IEEE|Edward Elgar|Design Council)\b/gi;
  for (const match of text.matchAll(publisherPattern)) {
    if (match.index == null) continue;
    pushHint('publisher_place', findHintStart(text, match.index), findHintEnd(text, match.index + match[0].length), match[0], 3);
  }

  const journalPattern = /\b(?:Journal|Human|American|Occupational|Psychological|Work\s*&\s*Stress|Nature|BMJ|Psychologist|Psychology)\b/gi;
  for (const match of text.matchAll(journalPattern)) {
    if (match.index == null) continue;
    pushHint('journal_tail', findHintStart(text, match.index), findHintEnd(text, match.index + match[0].length), match[0], 2);
  }

  const journalPhrasePattern = /\b(?:Journal of [^.]+|American [^.]+|Human [^.]+|Work\s*&\s*Stress[^.]*|Nature[^.]*|BMJ[^.]*)/gi;
  for (const match of text.matchAll(journalPhrasePattern)) {
    if (match.index == null) continue;
    pushHint('journal_tail', match.index, findHintEnd(text, match.index + match[0].length), match[0], 3);
  }

  const titleMatch = text.match(/\(\d{4}[a-z]?\)\.\s+(.+?)(?=(?:\.\s+In\b|\.?\s+[A-Z][A-Za-z&'’.-]+,\s*\d|\n(?:In |[A-Z][A-Za-z&'’.-]+)|$))/u);
  if (titleMatch?.index != null) {
    const titleStart = titleMatch.index + titleMatch[0].indexOf(titleMatch[1]!);
    pushHint('title', titleStart, titleStart + titleMatch[1]!.length, titleMatch[1]!, 1);
  }

  return hints
    .sort((left, right) => right.start - left.start || right.priority - left.priority)
    .reduce<Array<V2WorkingChunkFieldHint & { priority: number }>>((accumulator, hint) => {
      if (accumulator.some((existing) => hint.start < existing.end && hint.end > existing.start)) return accumulator;
      accumulator.push({ ...hint, text: text.slice(hint.start, hint.end) });
      return accumulator;
    }, [])
    .sort((left, right) => left.start - right.start);
}

function applyAllowlistToHint(hint: V2WorkingChunkFieldHint, joinedText: string): { updatedText: string; repairs: AppliedRepairMetadata[] } {
  let updatedText = joinedText.slice(hint.start, hint.end);
  const repairs: AppliedRepairMetadata[] = [];

  for (const entry of PDF_COPY_ALLOWLIST) {
    if (entry.fieldType !== hint.fieldType) continue;
    if (entry.prefixAnchor && !updatedText.includes(entry.prefixAnchor) && !hint.text.includes(entry.prefixAnchor)) continue;
    if (!updatedText.includes(entry.brokenSpan)) continue;
    const before = updatedText;
    updatedText = updatedText.replace(entry.brokenSpan, entry.canonicalSpan);
    if (before !== updatedText) {
      repairs.push({
        field: hint.fieldType,
        source: 'allowlist',
        before,
        after: updatedText,
        confidence: 'high',
      });
    }
  }

  return { updatedText, repairs };
}

function applyFieldPatternRepair(fieldType: V2WorkingChunkFieldHintType, value: string): { value: string; applied: boolean } {
  let repaired = value;

  if (fieldType === 'doi_url') {
    repaired = compactUriDoiSpacing(repaired);
  }

  if (fieldType === 'locator') {
    repaired = compactNumericLocatorArtifacts(repaired)
      .replace(/\b(\d)([A-Za-z])\b/g, '$1 $2');
  }

  if (fieldType === 'journal_tail' || fieldType === 'publisher_place') {
    repaired = repaired.replace(SINGLE_TOKEN_ARTIFACT_PATTERN, '$1$2');
    repaired = repaired.replace(LOWER_SINGLE_TOKEN_ARTIFACT_PATTERN, '$1$2');
  }

  if (fieldType === 'container' || fieldType === 'title') {
    repaired = repaired.replace(LOWER_SINGLE_TOKEN_ARTIFACT_PATTERN, '$1$2');
    repaired = repaired.replace(/\be\s+d\.\b/giu, 'ed.');
  }

  repaired = compactWrappedWordArtifacts(repaired);
  return {
    value: repaired,
    applied: repaired !== value,
  };
}

function detectResidualArtifactsForValue(field: string, value: string | null | undefined): ResidualArtifactMetadata[] {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return [];

  const artifacts: ResidualArtifactMetadata[] = [];
  if (BROKEN_URI_ARTIFACT_PATTERN.test(normalized)) {
    artifacts.push({
      field,
      severity: field === 'doi' || field === 'url' ? 'high' : 'medium',
      code: 'broken_uri_spacing',
      value: normalized,
    });
  }
  if (LOCATOR_ARTIFACT_PATTERN.test(normalized) && ['pages', 'volume', 'issue', 'locator'].includes(field)) {
    artifacts.push({
      field,
      severity: 'medium',
      code: 'broken_locator_spacing',
      value: normalized,
    });
  }
  if ((field === 'journal' || field === 'publisher' || field === 'conferenceTitle' || field === 'institution' || field === 'container' || field === 'journal_tail')
    && SINGLE_TOKEN_ARTIFACT_PATTERN.test(normalized)) {
    artifacts.push({
      field,
      severity: field === 'journal' || field === 'publisher' ? 'medium' : 'low',
      code: 'split_token_artifact',
      value: normalized,
    });
  }
  if (field === 'title' && /\b([b-hj-z])\s+([a-záéíóúüñç]{2,})\b/u.test(normalized)) {
    artifacts.push({
      field,
      severity: 'low',
      code: 'title_split_token_artifact',
      value: normalized,
    });
  }

  return artifacts;
}

function confidenceRank(value: FieldRepairConfidence): number {
  switch (value) {
    case 'low':
      return 0;
    case 'medium':
      return 1;
    default:
      return 2;
  }
}

function minConfidence(values: FieldRepairConfidence[]): FieldRepairConfidence {
  if (values.length === 0) return 'high';
  return values.reduce<FieldRepairConfidence>((lowest, value) => (
    confidenceRank(value) < confidenceRank(lowest) ? value : lowest
  ), 'high');
}

function mergeHintRepair(joinedText: string, hint: V2WorkingChunkFieldHint, replacement: string): string {
  return `${joinedText.slice(0, hint.start)}${replacement}${joinedText.slice(hint.end)}`;
}

function normalizeForHinting(value: string): string {
  return compactWrappedWordArtifacts(
    compactUriDoiSpacing(
      normalizeUnicodeText(value),
    ),
  );
}

export function prepareWorkingChunk(splitArtifact: V2SplitArtifact): V2PreparedWorkingChunk {
  const preparedContentLines = splitArtifact.contentLines.map((line) => ({
    ...line,
    text: splitArtifact.includedLineIndices.includes(line.lineIndex)
      ? normalizeForHinting(line.text)
      : line.text,
  }));

  let joinedText = buildJoinedText(preparedContentLines, splitArtifact.includedLineIndices, false);
  let fieldHints = findAnchorMatches(joinedText);
  const appliedRepairs: AppliedRepairMetadata[] = [];
  const repairMisses: RepairMissMetadata[] = [];
  const residualArtifacts: ResidualArtifactMetadata[] = [];
  const fieldConfidenceMap = new Map<string, FieldRepairConfidence>();

  for (const hint of fieldHints) {
    let hintText = joinedText.slice(hint.start, hint.end);
    const allowlistResult = applyAllowlistToHint(hint, joinedText);
    if (allowlistResult.repairs.length > 0) {
      hintText = allowlistResult.updatedText;
      appliedRepairs.push(...allowlistResult.repairs);
      fieldConfidenceMap.set(hint.fieldType, 'high');
    }

    const patternResult = applyFieldPatternRepair(hint.fieldType, hintText);
    if (patternResult.applied) {
      appliedRepairs.push({
        field: hint.fieldType,
        source: 'field_pattern',
        before: hintText,
        after: patternResult.value,
        confidence: 'medium',
      });
      hintText = patternResult.value;
      fieldConfidenceMap.set(
        hint.fieldType,
        fieldConfidenceMap.get(hint.fieldType) === 'low' ? 'low' : 'medium',
      );
    }

    const hintResiduals = detectResidualArtifactsForValue(hint.fieldType, hintText);
    if (hintResiduals.length > 0) {
      residualArtifacts.push(...hintResiduals);
      repairMisses.push(...hintResiduals.map((artifact) => ({
        field: hint.fieldType,
        brokenSpan: artifact.value,
        sourceSpan: hint.text,
        code: 'REPAIR_MISS',
      })));
      if (fieldConfidenceMap.get(hint.fieldType) === 'medium') {
        fieldConfidenceMap.set(hint.fieldType, 'low');
      }
    }

    if (hintText !== joinedText.slice(hint.start, hint.end)) {
      joinedText = mergeHintRepair(joinedText, hint, hintText);
      fieldHints = findAnchorMatches(joinedText);
    }
  }

  const citationRepairConfidence = minConfidence([...fieldConfidenceMap.values()]);
  return {
    includedLineIndices: splitArtifact.includedLineIndices,
    joinedText,
    fieldHints,
    appliedRepairs,
    repairMisses,
    residualArtifacts,
    citationRepairConfidence: appliedRepairs.length === 0 ? 'high' : citationRepairConfidence,
  };
}

export function detectResidualArtifactsByField(fields: Record<string, string | null | undefined>): ResidualArtifactMetadata[] {
  return Object.entries(fields).flatMap(([field, value]) => detectResidualArtifactsForValue(field, value));
}

export function splitRawReferenceBlock(rawItem: string, baseReasons: string[]): Array<{ rawChunk: string; splitArtifact: V2SplitArtifact }> {
  const rawLines = toRawLines(rawItem);
  const contentLines = buildContentLines(rawLines);
  const candidates: Array<{ rawChunk: string; splitArtifact: V2SplitArtifact }> = [];
  let currentCandidate: CandidateBuildState | null = null;
  let pendingUriTails: RawLine[] = [];

  const finalizeCurrent = () => {
    if (!currentCandidate || currentCandidate.includedLineIndices.length === 0) return;
    candidates.push(buildLocalCandidate(
      rawLines,
      contentLines,
      currentCandidate.includedLineIndices,
      currentCandidate.splitReasons,
      currentCandidate.repairActions,
    ));
    currentCandidate = null;
  };

  for (const line of rawLines) {
    const contentLine = contentLines[line.lineIndex]!;
    const boundaryBefore = previousArtifactBoundary(rawLines, line.lineIndex);
    if (contentLine.role === 'artifact') continue;

    if (contentLine.role === 'uri_tail') {
      const uriGroup = [line];
      if (currentCandidate && currentCandidate.includedLineIndices.length > 0) {
        currentCandidate.includedLineIndices.push(...uriGroup.map((item) => item.lineIndex));
        currentCandidate.repairActions.push({
          action: 'uri_tail_inline_attach',
          rawText: uriGroup.map((item) => item.text).join('\n'),
          sourceLineNumbers: uriGroup.map((item) => item.sourceLineNumber),
        });
      } else {
        pendingUriTails.push(...uriGroup);
      }
      continue;
    }

    if (startsNewCitation(contentLine, currentCandidate, boundaryBefore)) {
      finalizeCurrent();
      currentCandidate = {
        includedLineIndices: [line.lineIndex],
        repairActions: [],
        splitReasons: [
          ...baseReasons,
          NUMERIC_CITATION_MARKER_PATTERN.test(line.trimmed)
            ? 'structural_numbering'
            : (contentLine.openerConfidence >= OPENER_THRESHOLD ? 'structural_author_year_start' : 'structural_continuation_seed'),
        ],
      };
      if (pendingUriTails.length > 0) {
        currentCandidate.repairActions.push({
          action: 'uri_tail_forward_attach',
          rawText: pendingUriTails.map((item) => item.text).join('\n'),
          sourceLineNumbers: pendingUriTails.map((item) => item.sourceLineNumber),
        });
        currentCandidate.includedLineIndices.push(...pendingUriTails.map((item) => item.lineIndex));
        pendingUriTails = [];
      }
      continue;
    }

    if (!currentCandidate) {
      currentCandidate = {
        includedLineIndices: [line.lineIndex],
        repairActions: [],
        splitReasons: [...baseReasons, 'structural_continuation_seed'],
      };
      if (pendingUriTails.length > 0) {
        currentCandidate.repairActions.push({
          action: 'uri_tail_forward_attach',
          rawText: pendingUriTails.map((item) => item.text).join('\n'),
          sourceLineNumbers: pendingUriTails.map((item) => item.sourceLineNumber),
        });
        currentCandidate.includedLineIndices.push(...pendingUriTails.map((item) => item.lineIndex));
        pendingUriTails = [];
      }
    } else {
      currentCandidate.includedLineIndices.push(line.lineIndex);
    }
  }

  finalizeCurrent();

  if (pendingUriTails.length > 0) {
    const dangling = buildLocalCandidate(
      rawLines,
      contentLines,
      pendingUriTails.map((item) => item.lineIndex),
      [...baseReasons, 'dangling_uri_tail'],
      [{
        action: 'dangling_uri_tail',
        rawText: pendingUriTails.map((item) => item.text).join('\n'),
        sourceLineNumbers: pendingUriTails.map((item) => item.sourceLineNumber),
      }],
    );
    dangling.splitArtifact.contaminationFlags = Array.from(
      new Set<SplitContaminationFlag>([
        ...dangling.splitArtifact.contaminationFlags,
        'doi_orphan',
        'dangling_uri_tail',
      ]),
    );
    candidates.push(dangling);
  }

  return candidates.length > 0
    ? candidates
    : [
      buildLocalCandidate(
        rawLines,
        contentLines,
        rawLines.filter((line) => !isBlankEquivalent(line)).map((line) => line.lineIndex),
        baseReasons,
        [],
      ),
    ];
}

export function pdfCopyAllowlistKeys(): string[] {
  return PDF_COPY_ALLOWLIST.map((entry) => `${entry.brokenSpan}|${entry.fieldType}|${entry.prefixAnchor ?? ''}`);
}

export function canonicalizePotentialDoi(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(compactUriDoiSpacing(value ?? ''));
  if (!normalized) return null;
  const doi = normalizeDoiValue(normalized);
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : null;
}

export function hasParseableUriOrDoi(value: string | null | undefined): boolean {
  return parseableUriOrDoi(normalizeWhitespace(value ?? ''));
}
