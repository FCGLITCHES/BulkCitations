import type {
  BatchEnvelope,
  DetectedFormat,
  DetectionOutcome,
  DetectionProfile,
  DetectorResult,
  IngestionSignals,
  IngestionStructure,
} from '../types/ingestion.js';
import {
  containsYearDoiOrUrl,
  isLogicalEmptyLine,
  leadingWhitespaceWidth,
  normalizeSignalLine,
  splitLogicalBlocks,
  type NormalizedIngestionText,
} from './normalize.js';

export const SIGMOID_K = 8;
export const PHASE2_SEMISTRUCT_CONFIDENCE_THRESHOLD = 0.55;
export const NUMBERED_LEAD_REGEX = /^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+[A-Z]/;
export const PAREN_YEAR_REGEX = /\(\d{4}[a-z]?\)/;
export const BARE_YEAR_REGEX = /\b(?:19|20)\d{2}[a-z]?\b/;
export const VANCOUVER_TAIL_REGEX = /\b(?:19|20)\d{2};\d+(?:\([A-Za-z0-9-]+\))?:[A-Za-z]?\d/;
export const CONTINUATION_SUPPRESSOR_REGEX = /^(?:in\b|translated\b|edited\b|retrieved\b|available\b|accessed\b|from\b|pp?\.?\b|pages?\b|vol(?:ume)?\.?\b|issue\b|no\.?\b|doi\b|https?:\/\/|www\.|and\b|&\b|et al\.?\b)/i;
export const LOWERCASE_OR_CONJUNCTION_LEAD_REGEX = /^\s*(?:[a-z]|and\b|or\b|but\b|&\b|et\b)/;

const DOI_ONLY_REGEX = /^10\.\d{4,9}\/\S+$/i;
const DOI_TOKEN_REGEX = /\b10\.\d{4,9}\/\S+\b/gi;
const FOOTNOTE_REGEX = /[¹²³⁴⁵⁶⁷⁸⁹]|\^\d+/;
const BIBTEX_ENTRY_HEADER_REGEX = /^\s*@\w+\s*\{[^,]+,/;
const BIBTEX_FIELD_REGEX = /^\s*[A-Za-z][\w-]*\s*=\s*.+,?\s*$/;
const RIS_TAG_REGEX = /^[A-Z]{2}\s+-\s+/;
const BOOK_TAIL_REGEX = /(?:^|[.]\s+)[A-Z][A-Za-z'’.\- ]+(?:,\s*[A-Z]{2,})?(?:\s+[A-Z][A-Za-z'’.\-]+){0,4}\s*:\s*[A-Z][^.;]{2,}(?:[;,]\s*(?:19|20)\d{2})?\.?$/;
const CONFERENCE_TAIL_REGEX = /\b(?:conference|symposium|workshop|congress|meeting|proceedings|forum|summit|colloquium)\b/i;
const IEEE_PAGES_REGEX = /\bIEEE\b/i;
const PAGES_MARKER_REGEX = /\bpp?\.?\s*\d+/i;
const ORG_KEYWORD_REGEX = /\b(?:organization|agency|department|ministry|council|institute|association|team|group|committee|university|hospital|foundation|office|research|society|commission|centre|center)\b/i;

export const SURNAME_INITIALS_REGEX = /^\s*\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]{1,40},\s+\p{Lu}(?:\.(?:\s*\p{Lu}\.){0,3}|\s+\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]{1,30})/u;
export const SURNAME_PARTICLE_REGEX = /^\s*(?:de|del|der|den|di|da|la|le|van|von)\s+\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]{1,40},\s+\p{Lu}/iu;
export const INITIALS_FIRST_REGEX = /^\s*\p{Lu}(?:\.\p{Lu}?\.?|\s+\p{Lu}\.?)\s+\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]{1,40}/u;
export const GROUP_AUTHOR_REGEX = /^\s*\p{Lu}[\p{L}\p{M}&,'\u2018\u2019\u02BC.\- ]{4,80}\b(?:Institute|Organization|University|Association|Committee|Department|Society|Agency|Bureau|Foundation|Office|Center|Centre|Hospital|Council|Commission|Ministry)\b/u;

type TextSourceType = 'text' | 'doi_list' | 'bib' | 'ris';

type ScoredCandidate = Exclude<DetectedFormat, 'doi_list'>;

type WeightedSignalKey =
  | 'numberedLineRatio'
  | 'blankBlockRatio'
  | 'authorStartRatio'
  | 'footnoteMarkerRatio'
  | 'bookTailRatio'
  | 'conferenceTailRatio'
  | 'ocrNoiseRatio'
  | 'hangingIndentRatio'
  | 'averageIndentDeltaNorm'
  | 'bibtexSchemaCoverage'
  | 'risSchemaCoverage';

export interface DetectionSignals {
  nonEmptyLineCount: number;
  numberedLineCount: number;
  numberedLineRatio: number;
  blankBlockCount: number;
  blankBlockRatio: number;
  authorStartCount: number;
  authorStartRatio: number;
  footnoteMarkerCount: number;
  footnoteMarkerRatio: number;
  doiCount: number;
  doiDensity: number;
  bookTailCount: number;
  bookTailRatio: number;
  conferenceTailCount: number;
  conferenceTailRatio: number;
  ocrNoiseCount: number;
  ocrNoiseRatio: number;
  hangingIndentCount: number;
  hangingIndentRatio: number;
  averageIndentDelta: number;
  averageIndentDeltaNorm: number;
  mixedStyleMarkers: boolean;
  doiLineCoverage: number;
  bibtexSchemaCoverage: number;
  risSchemaCoverage: number;
  schemaCandidate: 'doi_list' | 'bibtex' | 'ris' | null;
  profile: DetectionProfile;
}

const FORMAT_BIAS: Record<ScoredCandidate, number> = {
  bibtex: 0.05,
  ris: 0.05,
  numbered_list: 0.05,
  blank_line: 0.05,
  hanging_indent: 0.05,
  plain_text: 0.05,
  unknown: 0,
};

const FORMAT_SIGNAL_WEIGHTS: Record<ScoredCandidate, Partial<Record<WeightedSignalKey, number>>> = {
  bibtex: {
    bibtexSchemaCoverage: 0.85,
    ocrNoiseRatio: -0.10,
  },
  ris: {
    risSchemaCoverage: 0.85,
    ocrNoiseRatio: -0.10,
  },
  numbered_list: {
    numberedLineRatio: 0.55,
    footnoteMarkerRatio: 0.10,
    blankBlockRatio: 0.10,
    authorStartRatio: 0.05,
    ocrNoiseRatio: -0.15,
  },
  blank_line: {
    blankBlockRatio: 0.60,
    authorStartRatio: 0.10,
    numberedLineRatio: -0.10,
    ocrNoiseRatio: -0.10,
  },
  hanging_indent: {
    hangingIndentRatio: 0.55,
    averageIndentDeltaNorm: 0.15,
    authorStartRatio: 0.10,
    numberedLineRatio: -0.10,
    blankBlockRatio: -0.05,
  },
  plain_text: {
    authorStartRatio: 0.20,
    bookTailRatio: 0.10,
    conferenceTailRatio: 0.10,
    numberedLineRatio: -0.15,
    blankBlockRatio: -0.15,
    ocrNoiseRatio: -0.10,
  },
  unknown: {
    ocrNoiseRatio: 0.20,
    authorStartRatio: -0.10,
    numberedLineRatio: -0.10,
    blankBlockRatio: -0.10,
  },
};

export interface Phase1DetectionResult {
  detectedFormat: DetectedFormat;
  formatConfidence: number;
  estimatedCount: number;
  structure: IngestionStructure;
  styleHints: string[];
  detectedDois: string[];
  ingestionSignals: IngestionSignals;
  detection: DetectionOutcome;
}

export function detectPhase1Scored(
  sourceType: TextSourceType,
  normalized: NormalizedIngestionText,
): Phase1DetectionResult {
  const signals = collectDetectionSignals(normalized.normalizedText, normalized.physicalLines);
  const ingestionSignals = mapDetectionSignalsToIngestionSignals(signals);
  const detectedDois = extractDois(normalized.normalizedText);
  const styleHints = detectStyleHints(normalized.normalizedText, 'unknown');

  if (signals.nonEmptyLineCount === 0) {
    const detection = forcedOutcome('unknown', ['empty_input']);
    return {
      detectedFormat: 'unknown',
      formatConfidence: 0,
      estimatedCount: 0,
      structure: 'unknown',
      styleHints: [],
      detectedDois: [],
      ingestionSignals,
      detection,
    };
  }

  if (sourceType === 'bib') {
    return buildStructuredForced('bibtex', sourceType, normalized.normalizedText, detectedDois, ingestionSignals);
  }
  if (sourceType === 'ris') {
    return buildStructuredForced('ris', sourceType, normalized.normalizedText, detectedDois, ingestionSignals);
  }
  if (sourceType === 'doi_list') {
    return buildStructuredForced('doi_list', sourceType, normalized.normalizedText, detectedDois, ingestionSignals);
  }

  if (signals.doiLineCoverage === 1) {
    return buildStructuredForced('doi_list', sourceType, normalized.normalizedText, detectedDois, ingestionSignals);
  }

  const scored = scoreCandidates(signals);
  const detection = buildScoredOutcome(scored);
  const detectedFormat = detection.chosen.format;
  const styleHintsForFormat = detectStyleHints(normalized.normalizedText, detectedFormat);
  const formatConfidence = computeFormatConfidence(detection.chosen.score, signals, detection.secondBest?.score ?? 0);
  const structure = resolveStructure(detectedFormat, detection.chosen.score, formatConfidence, signals);
  const estimatedCount = estimateCount(detectedFormat, signals, normalized.normalizedText);

  return {
    detectedFormat,
    formatConfidence,
    estimatedCount,
    structure,
    styleHints: styleHintsForFormat,
    detectedDois,
    ingestionSignals,
    detection: {
      ...detection,
      effectiveConfidence: detection.confidence,
      sampled: false,
    },
  };
}

function buildStructuredForced(
  detectedFormat: DetectedFormat,
  sourceType: TextSourceType,
  rawText: string,
  detectedDois: string[],
  ingestionSignals: IngestionSignals,
): Phase1DetectionResult {
  const detection = forcedOutcome(detectedFormat, [
    sourceType === 'text' ? 'hard_accept' : 'source_type_forced',
  ]);

  return {
    detectedFormat,
    formatConfidence: 1,
    estimatedCount: Math.max(1, estimateStructuredCount(detectedFormat, rawText, ingestionSignals)),
    structure: 'structured',
    styleHints: detectStyleHints(rawText, detectedFormat),
    detectedDois,
    ingestionSignals,
    detection,
  };
}

function forcedOutcome(format: DetectedFormat, evidence: string[]): DetectionOutcome {
  const chosen: DetectorResult = {
    format,
    score: 1,
    evidence,
    blockCoverage: 1,
  };

  return {
    chosen,
    secondBest: null,
    confidence: 1,
    effectiveConfidence: 1,
    method: 'forced',
    perBlockUsed: false,
    sampled: false,
  };
}

function buildScoredOutcome(input: {
  top: DetectorResult;
  secondBest: DetectorResult | null;
  hardAcceptedFormats: Set<DetectedFormat>;
}): DetectionOutcome {
  const margin = input.top.score - (input.secondBest?.score ?? 0);
  const confidence = Math.min(sigmoid(SIGMOID_K * margin), 0.95);

  return {
    chosen: input.top,
    secondBest: input.secondBest,
    confidence,
    effectiveConfidence: confidence,
    method: 'scored',
    perBlockUsed: false,
    sampled: false,
  };
}

function scoreCandidates(signals: DetectionSignals): {
  top: DetectorResult;
  secondBest: DetectorResult | null;
  hardAcceptedFormats: Set<DetectedFormat>;
} {
  const hardAcceptedFormats = new Set<DetectedFormat>();
  const results: DetectorResult[] = (Object.keys(FORMAT_BIAS) as ScoredCandidate[]).map((format) =>
    scoreCandidate(format, signals),
  );
  const sorted = [...results].sort((left, right) => right.score - left.score);
  return {
    top: sorted[0]!,
    secondBest: sorted[1]?.score ? sorted[1] : null,
    hardAcceptedFormats,
  };
}

function scoreCandidate(format: ScoredCandidate, signals: DetectionSignals): DetectorResult {
  const evidence: string[] = [];
  let score = FORMAT_BIAS[format];

  if (format === 'bibtex' && signals.schemaCandidate === 'bibtex' && !isHardAccepted('bibtex', signals)) {
    score += 0.25;
    evidence.push('schema_bonus');
  }
  if (format === 'ris' && signals.schemaCandidate === 'ris' && !isHardAccepted('ris', signals)) {
    score += 0.25;
    evidence.push('schema_bonus');
  }

  const weights = FORMAT_SIGNAL_WEIGHTS[format];
  for (const [key, weight] of Object.entries(weights) as Array<[WeightedSignalKey, number]>) {
    const value = signals[key];
    if (typeof value === 'number' && value !== 0) {
      score += value * weight;
      evidence.push(`${key}:${value.toFixed(2)}`);
    }
  }

  const clamped = clamp(score);
  return {
    format,
    score: clamped,
    evidence,
    blockCoverage: clamped,
  };
}

function isHardAccepted(format: 'bibtex' | 'ris', signals: DetectionSignals): boolean {
  if (format === 'bibtex') {
    return signals.bibtexSchemaCoverage >= 0.60 && scoreCandidate('bibtex', {
      ...signals,
      schemaCandidate: null,
    }).score >= 0.80;
  }
  return signals.risSchemaCoverage >= 0.60 && scoreCandidate('ris', {
    ...signals,
    schemaCandidate: null,
  }).score >= 0.80;
}

function resolveStructure(
  detectedFormat: DetectedFormat,
  score: number,
  formatConfidence: number,
  signals: DetectionSignals,
): IngestionStructure {
  if (detectedFormat === 'bibtex') {
    return signals.bibtexSchemaCoverage >= 0.60 && score >= 0.80 ? 'structured' : 'semi_structured';
  }
  if (detectedFormat === 'ris') {
    return signals.risSchemaCoverage >= 0.60 && score >= 0.80 ? 'structured' : 'semi_structured';
  }
  if (detectedFormat === 'numbered_list' || detectedFormat === 'blank_line' || detectedFormat === 'hanging_indent') {
    return formatConfidence >= PHASE2_SEMISTRUCT_CONFIDENCE_THRESHOLD
      ? 'semi_structured'
      : 'unstructured';
  }
  if (detectedFormat === 'plain_text') return 'unstructured';
  if (detectedFormat === 'unknown') {
    return formatConfidence < 0.35 ? 'unknown' : 'unstructured';
  }
  return 'structured';
}

function estimateCount(
  detectedFormat: DetectedFormat,
  signals: Pick<DetectionSignals, 'numberedLineCount' | 'blankBlockCount' | 'authorStartCount' | 'doiLineCoverage' | 'nonEmptyLineCount' | 'bibtexSchemaCoverage' | 'risSchemaCoverage' | 'hangingIndentCount'>,
  rawText: string,
): number {
  switch (detectedFormat) {
    case 'doi_list':
      return Math.max(1, Math.round((signals.doiLineCoverage || 1) * Math.max(signals.nonEmptyLineCount, 1)));
    case 'bibtex':
      return Math.max(1, countMatches(rawText, /^@\w+\s*\{[^,]+,/gm));
    case 'ris':
      return Math.max(1, countMatches(rawText, /^TY\s+-\s+\w+/gm));
    case 'numbered_list':
      return Math.max(1, signals.numberedLineCount);
    case 'blank_line':
      return Math.max(1, signals.blankBlockCount);
    case 'hanging_indent':
      return Math.max(1, signals.authorStartCount || signals.hangingIndentCount || 1);
    case 'plain_text':
    case 'unknown': {
      const yearAnchors = (rawText.match(/\(\d{4}[a-z]?\)|\b(?:19|20)\d{2}[a-z]?\b/g) ?? []).length;
      return Math.max(1, Math.min(signals.nonEmptyLineCount, yearAnchors || signals.authorStartCount || 1));
    }
  }
}

export function collectDetectionSignals(rawText: string, physicalLines: string[]): DetectionSignals {
  const logicalLines = physicalLines.filter((line) => !isLogicalEmptyLine(line)).map(normalizeSignalLine);
  const nonEmptyLineCount = logicalLines.length;
  const logicalBlocks = splitLogicalBlocks(physicalLines);
  const numberedLineCount = logicalLines.filter((line) => NUMBERED_LEAD_REGEX.test(line)).length;
  const authorStartCount = logicalLines.filter(isAuthorOpenerLine).length;
  const footnoteMarkerCount = logicalLines.filter((line) => FOOTNOTE_REGEX.test(line)).length;
  const bookTailCount = logicalLines.filter(looksLikeBookTailLine).length;
  const conferenceTailCount = logicalLines.filter(looksLikeConferenceTailLine).length;
  const doiCount = countMatches(rawText, DOI_TOKEN_REGEX);
  const ocrNoiseCount = logicalLines.filter(isOcrNoiseLine).length;
  const { hangingIndentCount, averageIndentDelta } = computeHangingIndentStats(physicalLines);

  const doiLineCoverage = coverage(logicalLines, isDoiLine);
  const bibtexSchemaCoverage = coverage(logicalLines, (line) =>
    BIBTEX_ENTRY_HEADER_REGEX.test(line) || BIBTEX_FIELD_REGEX.test(line));
  const risSchemaCoverage = coverage(logicalLines, (line) => RIS_TAG_REGEX.test(line));

  const numberedLineRatio = ratio(numberedLineCount, nonEmptyLineCount);
  const authorStartRatio = ratio(authorStartCount, nonEmptyLineCount);
  const footnoteMarkerRatio = ratio(footnoteMarkerCount, nonEmptyLineCount);
  const bookTailRatio = ratio(bookTailCount, nonEmptyLineCount);
  const conferenceTailRatio = ratio(conferenceTailCount, nonEmptyLineCount);
  const ocrNoiseRatio = ratio(ocrNoiseCount, nonEmptyLineCount);
  const hangingIndentRatio = ratio(hangingIndentCount, nonEmptyLineCount);
  const blankBlockCount = logicalBlocks.length >= 2 ? logicalBlocks.length : 0;
  const blankBlockRatio = ratio(blankBlockCount, nonEmptyLineCount);
  const averageIndentDeltaNorm = clamp(averageIndentDelta / 4);
  const mixedStyleMarkers =
    (numberedLineRatio >= 0.15 && authorStartRatio >= 0.15)
    || (bookTailCount > 0 && conferenceTailCount > 0)
    || (footnoteMarkerCount > 0 && numberedLineCount > 0);

  const schemaCandidate = resolveSchemaCandidate({
    bibtexSchemaCoverage,
    risSchemaCoverage,
    doiLineCoverage,
  });

  const signalsBase = {
    nonEmptyLineCount,
    numberedLineCount,
    numberedLineRatio,
    blankBlockCount,
    blankBlockRatio,
    authorStartCount,
    authorStartRatio,
    footnoteMarkerCount,
    footnoteMarkerRatio,
    doiCount,
    doiDensity: ratio(doiCount, Math.max(nonEmptyLineCount, 1)),
    bookTailCount,
    bookTailRatio,
    conferenceTailCount,
    conferenceTailRatio,
    ocrNoiseCount,
    ocrNoiseRatio,
    hangingIndentCount,
    hangingIndentRatio,
    averageIndentDelta,
    averageIndentDeltaNorm,
    mixedStyleMarkers,
    doiLineCoverage,
    bibtexSchemaCoverage,
    risSchemaCoverage,
    schemaCandidate,
  };

  return {
    ...signalsBase,
    profile: classifyInputProfile(signalsBase),
  };
}

function classifyInputProfile(signals: Omit<DetectionSignals, 'profile'>): DetectionProfile {
  if (
    signals.bibtexSchemaCoverage >= 0.60
    || signals.risSchemaCoverage >= 0.60
    || signals.doiLineCoverage >= 0.80
  ) {
    return 'CLEAN_STRUCTURED';
  }

  if (signals.ocrNoiseRatio >= 0.12 || signals.ocrNoiseCount >= 3) {
    return 'OCR_HEAVY';
  }

  if (signals.mixedStyleMarkers) {
    return 'AMBIGUOUS_MIXED';
  }

  if (signals.authorStartRatio >= 0.25 && signals.ocrNoiseRatio < 0.12) {
    return 'BIBLIOGRAPHIC_PLAIN';
  }

  return 'WEAK_NON_BIBLIOGRAPHIC';
}

function resolveSchemaCandidate(input: {
  bibtexSchemaCoverage: number;
  risSchemaCoverage: number;
  doiLineCoverage: number;
}): 'doi_list' | 'bibtex' | 'ris' | null {
  if (input.bibtexSchemaCoverage > 0.20) return 'bibtex';
  if (input.risSchemaCoverage > 0.20) return 'ris';
  if (input.doiLineCoverage > 0.50) return 'doi_list';
  return null;
}

function computeFormatConfidence(topScore: number, signals: DetectionSignals, _secondScore: number): number {
  const mixedPenalty =
    signals.numberedLineRatio >= 0.15 && signals.authorStartRatio >= 0.15
      ? 0.30 * Math.min(signals.numberedLineRatio, signals.authorStartRatio)
      : 0;

  return clamp(topScore * (1 - mixedPenalty));
}

function estimateStructuredCount(
  detectedFormat: DetectedFormat,
  rawText: string,
  ingestionSignals: IngestionSignals,
): number {
  if (detectedFormat === 'doi_list') {
    return Math.max(1, Math.round((ingestionSignals.doiLineCoverage ?? 1) * Math.max(ingestionSignals.nonEmptyLineCount ?? 1, 1)));
  }
  if (detectedFormat === 'bibtex') {
    return Math.max(1, countMatches(rawText, /^@\w+\s*\{[^,]+,/gm));
  }
  if (detectedFormat === 'ris') {
    return Math.max(1, countMatches(rawText, /^TY\s+-\s+\w+/gm));
  }
  return 1;
}

export function mapDetectionSignalsToIngestionSignals(signals: DetectionSignals): IngestionSignals {
  return {
    isPdfExtracted: false,
    isDocxExtracted: false,
    hasLineNumbers: signals.numberedLineCount > 0,
    hasHangingIndents: signals.hangingIndentCount > 0,
    hasBibTexEntries: signals.bibtexSchemaCoverage > 0,
    hasRisEntries: signals.risSchemaCoverage > 0,
    nonEmptyLineCount: signals.nonEmptyLineCount,
    numberedLineCount: signals.numberedLineCount,
    numberedLineRatio: signals.numberedLineRatio,
    blankBlockCount: signals.blankBlockCount,
    blankBlockRatio: signals.blankBlockRatio,
    authorStartCount: signals.authorStartCount,
    authorStartRatio: signals.authorStartRatio,
    footnoteMarkerCount: signals.footnoteMarkerCount,
    footnoteMarkerRatio: signals.footnoteMarkerRatio,
    doiCount: signals.doiCount,
    doiDensity: signals.doiDensity,
    bookTailCount: signals.bookTailCount,
    bookTailRatio: signals.bookTailRatio,
    conferenceTailCount: signals.conferenceTailCount,
    conferenceTailRatio: signals.conferenceTailRatio,
    ocrNoiseCount: signals.ocrNoiseCount,
    ocrNoiseRatio: signals.ocrNoiseRatio,
    hangingIndentCount: signals.hangingIndentCount,
    hangingIndentRatio: signals.hangingIndentRatio,
    averageIndentDelta: signals.averageIndentDelta,
    averageIndentDeltaNorm: signals.averageIndentDeltaNorm,
    mixedStyleMarkers: signals.mixedStyleMarkers,
    doiLineCoverage: signals.doiLineCoverage,
    bibtexSchemaCoverage: signals.bibtexSchemaCoverage,
    risSchemaCoverage: signals.risSchemaCoverage,
    schemaCandidate: signals.schemaCandidate,
    profile: signals.profile,
  };
}

export function isAuthorOpenerLine(line: string): boolean {
  return (
    SURNAME_INITIALS_REGEX.test(line)
    || SURNAME_PARTICLE_REGEX.test(line)
    || INITIALS_FIRST_REGEX.test(line)
    || isLikelyGroupAuthorLine(line)
    || /^\s*\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]+(?:\s+\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]+){0,3}\s*\(\d{4}[a-z]?\)/u.test(line)
  );
}

export function isLikelyGroupAuthorLine(line: string): boolean {
  return GROUP_AUTHOR_REGEX.test(line) && ORG_KEYWORD_REGEX.test(line);
}

export function looksLikeBookTailLine(line: string): boolean {
  return BOOK_TAIL_REGEX.test(line.trim());
}

export function looksLikeConferenceTailLine(line: string): boolean {
  const trimmed = line.trim();
  return CONFERENCE_TAIL_REGEX.test(trimmed) || (IEEE_PAGES_REGEX.test(trimmed) && PAGES_MARKER_REGEX.test(trimmed));
}

export function isOcrNoiseLine(line: string): boolean {
  const trimmed = normalizeSignalLine(line).trim();
  if (!trimmed) return false;

  if (/\b\p{L}{3,}-\s+\p{L}{2,}\b/u.test(trimmed)) return true;
  if (/^\s*(?:Page\s+)?\d+\s+(?:of|\/)\s+\d+\s*$/.test(trimmed)) return true;
  if (trimmed.length < 3 && (trimmed.match(/[^0-9A-Za-z]/g) ?? []).length >= 2) return true;

  const total = trimmed.length;
  const nonAlphabetic = (trimmed.match(/[^\p{L}\p{M}]/gu) ?? []).length;
  if (total > 0 && nonAlphabetic / total > 0.60 && !containsYearDoiOrUrl(trimmed)) {
    return true;
  }

  return false;
}

function computeHangingIndentStats(physicalLines: string[]): { hangingIndentCount: number; averageIndentDelta: number } {
  let hangingIndentCount = 0;
  const deltas: number[] = [];
  let previousNonEmptyLine: string | null = null;

  for (const line of physicalLines) {
    if (isLogicalEmptyLine(line)) continue;

    if (previousNonEmptyLine) {
      const currentIndent = leadingWhitespaceWidth(line);
      const previousIndent = leadingWhitespaceWidth(previousNonEmptyLine);
      if (
        currentIndent >= previousIndent + 2
        && !NUMBERED_LEAD_REGEX.test(normalizeSignalLine(previousNonEmptyLine))
      ) {
        hangingIndentCount += 1;
        deltas.push(currentIndent - previousIndent);
      }
    }

    previousNonEmptyLine = line;
  }

  return {
    hangingIndentCount,
    averageIndentDelta: deltas.length > 0
      ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
      : 0,
  };
}

function coverage(lines: string[], predicate: (line: string) => boolean): number {
  if (lines.length === 0) return 0;
  return lines.filter(predicate).length / lines.length;
}

function ratio(count: number, total: number): number {
  if (total <= 0) return 0;
  return count / total;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

function isDoiLine(line: string): boolean {
  return DOI_ONLY_REGEX.test(normalizeDoiLine(line));
}

function normalizeDoiLine(line: string): string {
  return line
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/doi\.org\//i, '')
    .trim();
}

function extractDois(rawText: string): string[] {
  const seen = new Set<string>();
  for (const match of rawText.matchAll(DOI_TOKEN_REGEX)) {
    const cleaned = normalizeDoiLine(match[0]).replace(/[)\],.;:]+$/g, '');
    if (cleaned) seen.add(cleaned);
  }
  return [...seen];
}

function detectStyleHints(rawText: string, detectedFormat: DetectedFormat): string[] {
  const hints = new Set<string>();

  if (detectedFormat === 'numbered_list') {
    hints.add('ieee');
    hints.add('vancouver');
  }

  if (/\(\d{4}[a-z]?\)/.test(rawText) || /\bdoi:\s*10\./i.test(rawText) || /\bRetrieved from\b/i.test(rawText)) {
    hints.add('apa7');
  }

  if (/[\u201C\u201D"][^\u201C\u201D"]+[\u201C\u201D"]/.test(rawText)) {
    hints.add('mla9');
  }

  if (/\b(?:19|20)\d{2}\b/.test(rawText) && /:\s*\d/.test(rawText)) {
    hints.add('vancouver');
  }

  return [...hints];
}
