import { AppError, ErrorCode } from '../errors/index.js';
import { env } from '../../config.js';
import type { InspectRequest } from '../types/api.js';
import type {
  BatchEnvelope,
  DetectedFormat,
  DetectionOutcome,
  DetectorResult,
  IngestCleanupHint,
  IngestCleanupMeta,
  IngestionStructure,
  IngestionSignals,
  NormalizationMeta,
} from '../types/ingestion.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import {
  collectDetectionSignals,
  detectPhase1Scored,
  mapDetectionSignalsToIngestionSignals,
} from '../ingestion/detect.js';
import { normalizeIngestionText, type NormalizedIngestionText } from '../ingestion/normalize.js';
import { repairOcrArtifacts } from '../ingestion/ocrRepair.js';
import { hasOcrDictionary, isOcrDictionaryWord } from '../ingestion/ocrCorrect.js';
import { buildNormalizedHash, normalizeDoiForKey, normalizeProvenanceForKey } from '../ingestion/canonical.js';

const CONTRACT_VERSION = 2;
const MAX_INPUT_CHARS = 500_000;
const DOI_REGEX = /10\.\d{4,9}\/[^\s"'<>]+/gi;
const NUMBERED_LINE_REGEX = /^\s*(?:\[\d+\]|\d+[.)\]])\s+/gm;
const RIS_ENTRY_REGEX = /^TY  - /gm;
const BIBTEX_ENTRY_REGEX = /@\w+\s*{/g;
const SIGMOID_K = 8;
const SAMPLED_DISCOUNT = 0.85;
const PDFISH_MIN_LINE_COUNT = 4;
const PDFISH_MIN_CHARS = 80;
const PDFISH_SHORT_LINE_MAX = 45;
const CITATION_START_REGEX = /^(?:\[\d+\]|\d+[.)\]])\s+\S|^[A-Z][A-Za-z'`-]+,\s*(?:[A-Z]\.|[A-Z][a-z]+)|^[A-Z][A-Za-z'`-]+(?:\s+[A-Z][A-Za-z'`-]+){0,3}\s*\(\d{4}[a-z]?\)|^[A-Z][A-Za-z&'`\- ]+,\s*\d{4}\./;
const PDF_ARTIFACT_LINE_REGEX = /^(?:\d+|page\s+\d+|p\.\s*\d+)$/i;
const PDF_TRAILING_PAGE_COUNTER_REGEX = /\b\d+\s+(?:of|\/)\s+\d+\s*$/i;
const PDF_FUSED_PAGE_COUNTER_HEADING_REGEX = /\b\d+\s+(?:of|\/)\s+\d+\s*references?$/i;
const PDF_BULLET_ONLY_REGEX = /^[•\-–]+$/;

/** Source types whose content is directly processable as text. */
export type TextSourceType = 'text' | 'doi_list' | 'bib' | 'ris';

const RIS_TAG_MAP: Record<string, string> = {
  TY: 'type',
  AU: 'author',
  TI: 'title',
  PY: 'year',
  JO: 'journal',
  VL: 'volume',
  SP: 'startPage',
  EP: 'endPage',
  DO: 'doi',
  PB: 'publisher',
  UR: 'url',
};

/* ─── Parser types ──────────────────────────────────────────── */

export interface ParsedBibtexEntry {
  entryType: string;
  citationKey: string;
  fields: Record<string, string>;
}

export interface ParsedRisEntry {
  fields: Record<string, string[]>;
}

/* ─── Phase 1 ───────────────────────────────────────────────── */

export class Phase1Ingest implements PipelineStage<InspectRequest, BatchEnvelope> {
  readonly phaseId = 'ingestion' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(input: InspectRequest, ctx: PipelineContext): Promise<BatchEnvelope> {
    const startedAt = Date.now();

    try {
      const { sourceType } = input;
      const normalized = normalizeIngestionText(input.content);
      const rawText = normalized.normalizedText;
      const signals = mapDetectionSignalsToIngestionSignals(
        collectDetectionSignals(normalized.normalizedText, normalized.physicalLines),
      );

      ctx.stageLog.push(
        stageRecord({
          phaseId: 'normalization',
          status: 'success',
          durationMs: 0,
          message: 'Phase 1 normalization completed.',
          details: {
            ...(structuredClone(normalized.normalizationMeta) as Record<string, unknown>),
            normalizedHash: buildNormalizedHash(normalized.normalizedText),
            provenanceKey: normalizeProvenanceForKey(sourceType),
          },
        }, 'phase1_normalization'),
      );

      if (sourceType === 'pdf' || sourceType === 'docx') {
        const envelope = buildFileUploadEnvelope(sourceType, normalized, signals);
        ctx.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: Date.now() - startedAt,
            message: `Phase 1 marked ${sourceType} upload for ML extraction.`,
            details: { sourceType, structure: 'unknown' },
          }),
        );
        return envelope;
      }

      if (normalized.logicalLines.length === 0) {
        throw new AppError(400, ErrorCode.INGEST_EMPTY_INPUT, 'Input content must not be empty.');
      }

      if (rawText.length > MAX_INPUT_CHARS) {
        throw new AppError(
          413,
          ErrorCode.INGEST_FILE_TOO_LARGE,
          `Inspect input exceeds the ${MAX_INPUT_CHARS.toLocaleString()} character limit.`,
          { maxChars: MAX_INPUT_CHARS, actualChars: rawText.length },
        );
      }

      if (!toTextSourceType(sourceType)) {
        throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, `Unsupported ingest source type: ${sourceType}`);
      }

      const { envelope, detectionTelemetry } = buildProfiledTextEnvelope(
        sourceType,
        normalized.originalText,
        { enableScoredDetection: ctx.options.enableScoredDetection, normalized },
      );
      const cleanupMode = resolvePdfCleanupMode(ctx);
      const cleanupMeta = cleanupMode === 'off'
        ? undefined
        : buildCleanupMeta(sourceType, rawText);

      if (cleanupMeta) {
        envelope.cleanupMeta = cleanupMeta;
      }

      if (detectionTelemetry) {
        ctx.stageLog.push(
          stageRecord({
            phaseId: 'detection_telemetry',
            status: 'success',
            durationMs: 0,
            message: `Phase 1 compared baseline=${detectionTelemetry.legacyFormat} and scored=${detectionTelemetry.scoredFormat}.`,
            details: {
              ...detectionTelemetry,
              normalizationMeta: structuredClone(normalized.normalizationMeta),
            },
          }, 'phase1_detection_telemetry'),
        );
      }

      ctx.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: 'success',
          durationMs: Date.now() - startedAt,
          message: `Phase 1 profiled ${envelope.estimatedCount} reference candidates.`,
          details: {
            sourceType,
            normalizedHash: envelope.normalizedHash,
            provenanceKey: envelope.provenanceKey,
            detectedFormat: envelope.detectedFormat,
            structure: envelope.structure,
            estimatedCount: envelope.estimatedCount,
            doiCount: envelope.detectedDois.length,
            ...(envelope.detection ? { scoredConfidence: envelope.detection.confidence } : {}),
            ...(cleanupMeta ? {
              lookedLikePdfCopy: cleanupMeta.lookedLikePdfCopy,
              cleanupCandidateGenerated: cleanupMeta.hints.includes('cleanup_candidate_generated'),
            } : {}),
          },
        }),
      );

      return envelope;
    } catch (error) {
      ctx.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: 'error',
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : 'Phase 1 failed.',
          code: error instanceof AppError ? error.code : ErrorCode.PHASE_ERROR,
        }),
      );
      throw error;
    }
  }
}

export const phase1Ingest = new Phase1Ingest();

export function buildProfiledTextEnvelope(
  sourceType: InspectRequest['sourceType'],
  content: string,
  options: { enableScoredDetection?: boolean; normalized?: NormalizedIngestionText } = {},
): {
  envelope: BatchEnvelope;
  detectionTelemetry?: {
    legacyFormat: DetectedFormat;
    scoredFormat: DetectedFormat;
    legacyStructure: IngestionStructure;
    scoredStructure: IngestionStructure;
    legacyEstimatedCount: number;
    scoredEstimatedCount: number;
    agreed: boolean;
    confidence: number;
    structureMismatch: boolean;
    estimateMismatch: boolean;
  };
} {
  // Reuse a pre-normalized result when the caller already computed it for `content`
  // (the Phase 1 run path), avoiding a redundant full normalization pass.
  const normalized = options.normalized ?? normalizeIngestionText(content);
  const rawText = normalized.normalizedText;
  const signals = mapDetectionSignalsToIngestionSignals(
    collectDetectionSignals(normalized.normalizedText, normalized.physicalLines),
  );
  const effective = toTextSourceType(sourceType);

  if (!effective) {
    throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, `Unsupported ingest source type: ${sourceType}`);
  }

  const legacyEnvelope = buildLegacyEnvelope(
    sourceType,
    effective,
    rawText,
    normalized.originalText,
    normalized.normalizationMeta,
    signals,
  );
  const scoredEnabled = isScoredDetectorEnabled(options.enableScoredDetection);

  if (!scoredEnabled) {
    return { envelope: legacyEnvelope };
  }

  const scoredResult = detectPhase1Scored(effective, normalized);
  const envelope: BatchEnvelope = {
    ...legacyEnvelope,
    ...scoredResult,
    rawTextOriginal: normalized.originalText,
    rawText,
    normalizationMeta: normalized.normalizationMeta,
  };

  return {
    envelope,
    detectionTelemetry: {
      legacyFormat: legacyEnvelope.detectedFormat,
      scoredFormat: scoredResult.detectedFormat,
      legacyStructure: legacyEnvelope.structure,
      scoredStructure: scoredResult.structure,
      legacyEstimatedCount: legacyEnvelope.estimatedCount,
      scoredEstimatedCount: scoredResult.estimatedCount,
      agreed: legacyEnvelope.detectedFormat === scoredResult.detectedFormat,
      confidence: scoredResult.detection.confidence,
      structureMismatch: legacyEnvelope.structure !== scoredResult.structure,
      estimateMismatch: legacyEnvelope.estimatedCount !== scoredResult.estimatedCount,
    },
  };
}

/* ─── Parsers ───────────────────────────────────────────────── */

export function parseBibtexEntries(raw: string): ParsedBibtexEntry[] {
  const headerPattern = /@(\w+)\s*\{\s*([^,]*),/g;
  const starts: Array<{ index: number; entryType: string; citationKey: string }> = [];

  let headerMatch: RegExpExecArray | null;
  while ((headerMatch = headerPattern.exec(raw)) !== null) {
    starts.push({
      index: headerMatch.index,
      entryType: (headerMatch[1] ?? '').toLowerCase(),
      citationKey: (headerMatch[2] ?? '').trim(),
    });
  }

  const entries: ParsedBibtexEntry[] = [];

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]!.index : raw.length;
    const body = raw.slice(start.index, end);

    const fields: Record<string, string> = {};
    const fieldPattern = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldPattern.exec(body)) !== null) {
      const name = (fieldMatch[1] ?? '').toLowerCase();
      const value = (fieldMatch[2] ?? fieldMatch[3] ?? fieldMatch[4] ?? '').trim();
      if (name) fields[name] = value;
    }

    entries.push({
      entryType: start.entryType,
      citationKey: start.citationKey,
      fields,
    });
  }

  return entries;
}

export function parseRisEntries(raw: string): ParsedRisEntry[] {
  const entries: ParsedRisEntry[] = [];
  const chunks = raw.split(/(?=^TY  - )/m);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('TY  - ')) continue;

    const fields: Record<string, string[]> = {};

    for (const line of trimmed.split('\n')) {
      const tagMatch = line.match(/^([A-Z][A-Z0-9])\s{2}-\s(.*)$/);
      if (!tagMatch?.[1]) continue;

      const tag = tagMatch[1];
      const value = (tagMatch[2] ?? '').trim();
      if (tag === 'ER') continue;

      const fieldName = RIS_TAG_MAP[tag] ?? tag.toLowerCase();
      if (!fields[fieldName]) fields[fieldName] = [];
      fields[fieldName].push(value);
    }

    if (Object.keys(fields).length > 0) {
      entries.push({ fields });
    }
  }

  return entries;
}

/* ─── Internal helpers ──────────────────────────────────────── */

function buildFileUploadEnvelope(
  sourceType: 'pdf' | 'docx',
  normalized: ReturnType<typeof normalizeIngestionText>,
  ingestionSignals: IngestionSignals,
): BatchEnvelope {
  return {
    pipelineMajor: 3,
    sourceType,
    provenanceKey: normalizeProvenanceForKey(sourceType),
    structure: 'unknown',
    detectedFormat: 'unknown',
    formatConfidence: 0.2,
    estimatedCount: 0,
    hasDois: false,
    styleHints: [],
    normalizedHash: buildNormalizedHash(normalized.normalizedText),
    rawTextOriginal: normalized.originalText,
    rawText: normalized.normalizedText,
    detectedDois: [],
    normalizationMeta: normalized.normalizationMeta,
    ingestionSignals: {
      ...ingestionSignals,
      isPdfExtracted: sourceType === 'pdf',
      isDocxExtracted: sourceType === 'docx',
    },
  };
}

function buildLegacyEnvelope(
  sourceType: InspectRequest['sourceType'],
  effective: TextSourceType,
  rawText: string,
  rawTextOriginal: string,
  normalizationMeta: NormalizationMeta,
  ingestionSignals: IngestionSignals,
): BatchEnvelope {
  const lines = toNonEmptyLines(rawText);
  const detectedFormat = detectFormat(effective, rawText, lines);
  const formatConfidence = confidenceForFormat(effective, detectedFormat);
  const detectedDois = extractDois(rawText, effective === 'doi_list' || detectedFormat === 'doi_list');
  const estimatedCount = estimateCount(effective, rawText, lines, detectedFormat);
  const structure = detectStructure(effective, detectedFormat, rawText);
  const styleHints = detectStyleHints(rawText, detectedFormat);

  return {
    pipelineMajor: 3,
    sourceType,
    provenanceKey: normalizeProvenanceForKey(sourceType),
    structure,
    detectedFormat,
    formatConfidence,
    estimatedCount,
    hasDois: detectedDois.length > 0,
    styleHints,
    normalizedHash: buildNormalizedHash(rawText),
    rawTextOriginal,
    rawText,
    detectedDois,
    ingestionSignals,
    normalizationMeta,
  };
}

function isScoredDetectorEnabled(override?: boolean): boolean {
  return override ?? env.FEATURE_SCORED_DETECTOR;
}

function resolvePdfCleanupMode(ctx: PipelineContext): 'off' | 'inspect_only' | 'full' {
  return ctx.options.enablePdfCleanup ? ctx.options.pdfCleanupMode : 'off';
}

function toTextSourceType(sourceType: InspectRequest['sourceType']): TextSourceType | null {
  if (sourceType === 'txt') return 'text';
  if (sourceType === 'text' || sourceType === 'doi_list' || sourceType === 'bib' || sourceType === 'ris') {
    return sourceType;
  }
  return null;
}

function buildCleanupMeta(
  sourceType: InspectRequest['sourceType'],
  rawText: string,
): IngestCleanupMeta | undefined {
  if (sourceType !== 'text' && sourceType !== 'txt') return undefined;

  const lookedLikePdfCopy = looksLikePdfCopy(rawText);
  if (!lookedLikePdfCopy) {
    return {
      lookedLikePdfCopy: false,
      hints: [],
    };
  }

  try {
    const cleaned = cleanupPdfArtifacts(rawText);
    return {
      lookedLikePdfCopy: true,
      hints: cleaned.hints,
      ...(cleaned.text !== rawText && cleaned.text.length <= env.PDF_CLEANUP_MAX_CANDIDATE_LENGTH
        ? { candidateText: cleaned.text }
        : {}),
    };
  } catch {
    return {
      lookedLikePdfCopy: true,
      hints: [],
    };
  }
}

function extractDois(rawText: string, preserveDuplicates = false): string[] {
  if (preserveDuplicates) {
    return [...rawText.matchAll(DOI_REGEX)]
      .map((match) => cleanDoi(match[0]))
      .filter((value): value is string => value != null);
  }

  const seen = new Set<string>();

  for (const match of rawText.matchAll(DOI_REGEX)) {
    const cleaned = cleanDoi(match[0]);
    if (cleaned) seen.add(cleaned);
  }

  return [...seen];
}

function cleanDoi(value: string): string | null {
  const withoutPunctuation = value.replace(/[)\],.;:]+$/g, '').trim();
  return normalizeDoiForKey(withoutPunctuation);
}

function toNonEmptyLines(rawText: string): string[] {
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function looksLikePdfCopy(text: string): boolean {
  if (text.length < PDFISH_MIN_CHARS) return false;

  const lines = toNonEmptyLines(text);
  if (lines.length < PDFISH_MIN_LINE_COUNT) return false;

  const shortLineRatio = lines.filter((line) => line.length < PDFISH_SHORT_LINE_MAX).length / lines.length;
  const hyphenBreaks = (text.match(/([A-Za-z]{3,})-\n([a-z]{2,})/g) ?? []).length;
  const artifactLineCount = lines.filter((line) => PDF_ARTIFACT_LINE_REGEX.test(line)).length;
  const bulletGlyphLines = lines.filter((line) => PDF_BULLET_ONLY_REGEX.test(line)).length;

  let signals = 0;
  if (shortLineRatio > 0.4) signals += 1;
  if (hyphenBreaks >= 2) signals += 1;
  if (artifactLineCount >= 2) signals += 1;
  if (bulletGlyphLines >= 2) signals += 1;

  return signals >= 2;
}

export function cleanupPdfArtifacts(raw: string): { text: string; hints: IngestCleanupHint[] } {
  let text = raw;
  const hints: IngestCleanupHint[] = [];

  const ocrResult = repairOcrArtifacts(text);
  text = ocrResult.text;
  if (ocrResult.changed) hints.push('repaired_ocr_artifacts');

  const hyphenResult = fixEndOfLineHyphens(text);
  text = hyphenResult.text;
  if (hyphenResult.changed) hints.push('fixed_eol_hyphens');

  const mergedResult = mergeSoftLineBreaks(text);
  text = mergedResult.text;
  if (mergedResult.changed) hints.push('merged_soft_breaks');

  const strippedResult = stripPdfArtifacts(text);
  text = strippedResult.text;
  if (strippedResult.changed) hints.push('stripped_pdf_artifacts');

  if (text !== raw) {
    hints.push('cleanup_candidate_generated');
  }

  return { text, hints };
}

export function fixEndOfLineHyphens(text: string): { text: string; changed: boolean } {
  const before = text;
  let after: string;
  if (hasOcrDictionary()) {
    // Robust: fuse a line-break hyphen ONLY when the joined form is a real word. This joins genuine
    // splits (tra-\nining -> training, In-\nternational -> international, LIT-\nERARY -> LITERARY)
    // while PRESERVING real compounds (self-\ncontained, Well-\nKnown stay hyphenated) and
    // identifier-like cases (COVID-\n19).
    after = text.replace(/([A-Za-z]{2,})-\n([A-Za-z]{2,})/g, (match: string, a: string, b: string) =>
      isOcrDictionaryWord((a + b).toLowerCase()) ? a + b : match);
  } else {
    // No dictionary available -> conservative fallback (lowercase or all-caps continuation only).
    after = text
      .replace(/([A-Za-z]{3,})-\n([a-z]{2,})/g, '$1$2')
      .replace(/([A-Z]{3,})-\n([A-Z]{2,})/g, '$1$2');
  }
  return { text: after, changed: after !== before };
}

export function mergeSoftLineBreaks(text: string): { text: string; changed: boolean } {
  const lines = text.split('\n');
  if (lines.length <= 1) return { text, changed: false };

  const merged: string[] = [];
  let changed = false;

  for (const line of lines) {
    if (merged.length === 0) {
      merged.push(line);
      continue;
    }

    const previous = merged[merged.length - 1] ?? '';
    if (shouldMergeSoftBreak(previous, line)) {
      merged[merged.length - 1] = `${previous.replace(/\s+$/g, '')} ${line.trimStart()}`;
      changed = true;
      continue;
    }

    merged.push(line);
  }

  return {
    text: merged.join('\n'),
    changed,
  };
}

export function stripPdfArtifacts(text: string): { text: string; changed: boolean } {
  const lines = text.split('\n');
  const kept: string[] = [];
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (isStandalonePdfArtifactLine(trimmed)) {
      changed = true;
      continue;
    }
    kept.push(line);
  }

  return {
    text: kept.join('\n'),
    changed,
  };
}

function shouldMergeSoftBreak(previousLine: string, nextLine: string): boolean {
  const previous = previousLine.trim();
  const next = nextLine.trim();

  if (!previous || !next) return false;
  if (isStandalonePdfArtifactLine(next)) return false;
  if (/^@\w+\s*\{/.test(next) || /^TY  - /.test(next) || /^ER  - /.test(next)) return false;
  if (CITATION_START_REGEX.test(next)) return false;

  return true;
}

function isStandalonePdfArtifactLine(trimmedLine: string): boolean {
  if (!trimmedLine) return false;
  if (/^\d{4}$/.test(trimmedLine)) return false;
  return (
    PDF_ARTIFACT_LINE_REGEX.test(trimmedLine)
    || PDF_TRAILING_PAGE_COUNTER_REGEX.test(trimmedLine)
    || PDF_FUSED_PAGE_COUNTER_HEADING_REGEX.test(trimmedLine)
    || PDF_BULLET_ONLY_REGEX.test(trimmedLine)
  );
}

function detectFormat(
  sourceType: TextSourceType,
  rawText: string,
  lines: string[],
): DetectedFormat {
  if (sourceType === 'bib') return 'bibtex';
  if (sourceType === 'ris') return 'ris';
  if (sourceType === 'doi_list' || isDoiList(lines)) return 'doi_list';
  if (countMatches(rawText, BIBTEX_ENTRY_REGEX) > 0) return 'bibtex';
  if (countMatches(rawText, RIS_ENTRY_REGEX) > 0) return 'ris';
  if (countMatches(rawText, NUMBERED_LINE_REGEX) >= 2) return 'numbered_list';
  if (splitOnBlankLines(rawText).length >= 2) return 'blank_line';
  if (hasHangingIndent(rawText)) return 'hanging_indent';
  return rawText.includes('\n') ? 'plain_text' : 'unknown';
}

function detectStructure(
  sourceType: TextSourceType,
  detectedFormat: DetectedFormat,
  rawText: string,
): IngestionStructure {
  if (
    sourceType === 'doi_list' ||
    sourceType === 'bib' ||
    sourceType === 'ris' ||
    detectedFormat === 'doi_list' ||
    detectedFormat === 'bibtex' ||
    detectedFormat === 'ris'
  ) {
    return 'structured';
  }
  if (
    detectedFormat === 'numbered_list' ||
    detectedFormat === 'blank_line' ||
    detectedFormat === 'hanging_indent'
  ) {
    return 'semi_structured';
  }
  if (rawText.trim().length > 0) {
    return 'unstructured';
  }
  return 'unknown';
}

function estimateCount(
  sourceType: TextSourceType,
  rawText: string,
  lines: string[],
  detectedFormat: DetectedFormat,
): number {
  if (sourceType === 'doi_list' || detectedFormat === 'doi_list') {
    return Math.max(1, lines.filter((line) => cleanDoi(line.replace(/^doi:\s*/i, ''))).length);
  }

  if (detectedFormat === 'bibtex') {
    return Math.max(1, countMatches(rawText, BIBTEX_ENTRY_REGEX));
  }

  if (detectedFormat === 'ris') {
    return Math.max(1, countMatches(rawText, RIS_ENTRY_REGEX));
  }

  if (detectedFormat === 'numbered_list') {
    return Math.max(1, countMatches(rawText, NUMBERED_LINE_REGEX));
  }

  if (detectedFormat === 'blank_line') {
    return Math.max(1, splitOnBlankLines(rawText).length);
  }

  if (detectedFormat === 'hanging_indent') {
    return Math.max(1, estimateHangingIndentCount(rawText));
  }

  const yearAnchors = (rawText.match(/\(\d{4}[a-z]?\)|\b(?:19|20)\d{2}[a-z]?\b/g) ?? []).length;
  return Math.max(1, Math.min(lines.length, yearAnchors || 1));
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

  if (/[\u201C\u201D][^\u201C\u201D]+[\u201C\u201D]/.test(rawText)) {
    hints.add('mla9');
  }

  if (/\b(?:19|20)\d{2}\b/.test(rawText) && /:\s*\d/.test(rawText)) {
    hints.add('vancouver');
  }

  return [...hints];
}

function confidenceForFormat(
  sourceType: TextSourceType,
  detectedFormat: DetectedFormat,
): number {
  if (sourceType === 'doi_list' || detectedFormat === 'doi_list') return 1;
  if (sourceType === 'bib' || sourceType === 'ris') return 1;
  if (detectedFormat === 'bibtex' || detectedFormat === 'ris') return 0.98;
  if (detectedFormat === 'numbered_list') return 0.92;
  if (detectedFormat === 'blank_line') return 0.8;
  if (detectedFormat === 'hanging_indent') return 0.72;
  if (detectedFormat === 'plain_text') return 0.45;
  return 0.2;
}

function countMatches(rawText: string, pattern: RegExp): number {
  return [...rawText.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

function isDoiList(lines: string[]): boolean {
  if (lines.length === 0) return false;

  return lines.every((line) => {
    const stripped = line.replace(/^doi:\s*/i, '').trim();
    return /^10\.\d{4,9}\/\S+$/i.test(stripped);
  });
}

function splitOnBlankLines(rawText: string): string[] {
  return rawText
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function hasHangingIndent(rawText: string): boolean {
  const lines = rawText.split('\n');

  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1] ?? '';
    const current = lines[index] ?? '';
    if (!previous.trim() || !current.trim()) continue;

    const previousIndent = leadingWhitespace(previous);
    const currentIndent = leadingWhitespace(current);
    if (currentIndent >= previousIndent + 2) return true;
  }

  return false;
}

function estimateHangingIndentCount(rawText: string): number {
  const lines = rawText.split('\n');
  let count = 0;
  let previousIndent = 0;
  let previousWasBlank = true;

  for (const line of lines) {
    if (!line.trim()) {
      previousWasBlank = true;
      previousIndent = 0;
      continue;
    }

    const indent = leadingWhitespace(line);
    if (previousWasBlank || indent === 0 && previousIndent > 0) {
      count += 1;
    }

    previousIndent = indent;
    previousWasBlank = false;
  }

  return count;
}

function leadingWhitespace(line: string): number {
  const match = line.match(/^\s*/);
  return match?.[0].length ?? 0;
}

/* ─── Scored detection ──────────────────────────────────────── */

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}

function scoredDetect(
  sourceType: TextSourceType,
  rawText: string,
  lines: string[],
): DetectionOutcome {
  if (sourceType === 'bib') return forcedOutcome('bibtex');
  if (sourceType === 'ris') return forcedOutcome('ris');
  if (sourceType === 'doi_list') return forcedOutcome('doi_list');

  const risResult = scoreRisFormat(rawText);
  if (risResult.score > 0.85) return buildDetectionOutcome(risResult, [risResult], false);

  const bibtexResult = scoreBibtexFormat(rawText);
  if (bibtexResult.score > 0.85) return buildDetectionOutcome(bibtexResult, [risResult, bibtexResult], false);

  const allResults: DetectorResult[] = [
    scoreDoiListFormat(lines),
    risResult,
    bibtexResult,
    scoreNumberedFormat(rawText, lines),
    scoreHangingIndentFormat(rawText),
    scorePlainTextFormat(rawText),
  ];

  const sorted = [...allResults].sort((a, b) => b.score - a.score);
  return buildDetectionOutcome(sorted[0]!, allResults, false);
}

function forcedOutcome(format: DetectedFormat): DetectionOutcome {
  const chosen: DetectorResult = { format, score: 1, evidence: ['source_type_forced'], blockCoverage: 1 };
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

function buildDetectionOutcome(
  chosen: DetectorResult,
  allResults: DetectorResult[],
  sampled: boolean,
): DetectionOutcome {
  const sorted = [...allResults].sort((a, b) => b.score - a.score);
  const top = sorted[0]!;
  const secondBest = sorted.length > 1 && sorted[1]!.score > 0 ? sorted[1]! : null;
  const margin = top.score - (secondBest?.score ?? 0);
  const confidence = sigmoid(SIGMOID_K * margin);
  const effectiveConfidence = sampled ? confidence * SAMPLED_DISCOUNT : confidence;

  return {
    chosen: top,
    secondBest,
    confidence,
    effectiveConfidence,
    method: 'scored',
    perBlockUsed: false,
    sampled,
  };
}

function scoreDoiListFormat(lines: string[]): DetectorResult {
  const evidence: string[] = [];
  if (lines.length === 0) return { format: 'doi_list', score: 0, evidence: ['empty_input'], blockCoverage: 0 };

  const doiPattern = /^10\.\d{4,9}\/\S+$/i;
  let matching = 0;
  for (const line of lines) {
    if (doiPattern.test(line.replace(/^doi:\s*/i, '').trim())) matching += 1;
  }

  const coverage = matching / lines.length;
  if (coverage < 1) {
    evidence.push(`${lines.length - matching} non-DOI lines`);
    return { format: 'doi_list', score: 0, evidence, blockCoverage: coverage };
  }

  evidence.push(`all ${lines.length} lines match DOI pattern`);
  return { format: 'doi_list', score: clampScore(0.30 + coverage * 0.60), evidence, blockCoverage: 1 };
}

function scoreRisFormat(rawText: string): DetectorResult {
  const evidence: string[] = [];
  let score = 0;

  const tyCount = countMatches(rawText, /^TY {2}- /gm);
  const erCount = countMatches(rawText, /^ER {2}- *$/gm);
  const hasTY = tyCount > 0;
  const hasER = erCount > 0;
  const isPaired = tyCount === erCount;

  if (hasTY && hasER && isPaired) {
    score += 0.35;
    evidence.push(`${tyCount} paired TY/ER entries`);
  } else if (hasTY && !hasER) {
    score -= 0.30;
    evidence.push('TY without matching ER');
  }

  const validTags = ['TI', 'AU', 'PY', 'JO', 'VL', 'IS', 'SP', 'EP', 'DO', 'UR'];
  const foundTags = validTags.filter((tag) => new RegExp(`^${tag} {2}- `, 'm').test(rawText));
  if (foundTags.length >= 3) {
    score += 0.25;
    evidence.push(`${foundTags.length} valid RIS tags`);
  }

  if (isPaired && tyCount > 0) {
    const chunks = rawText.split(/^ER {2}- *$/m);
    const cleanGaps = chunks.slice(0, -1).every((chunk) => {
      const afterER = chunk.split(/^TY {2}- /m).pop()?.trim() ?? '';
      return afterER.length === 0 || /^TY {2}- /m.test(afterER);
    });
    if (cleanGaps) {
      score += 0.10;
      evidence.push('clean gaps between entries');
    }
  }

  return { format: 'ris', score: clampScore(score), evidence, blockCoverage: tyCount > 0 ? 1 : 0 };
}

function scoreBibtexFormat(rawText: string): DetectorResult {
  const evidence: string[] = [];
  let score = 0;

  const entryPattern = /@(\w+)\s*\{\s*[^,]*,/g;
  const entryCount = countMatches(rawText, entryPattern);
  if (entryCount > 0) {
    score += 0.30;
    evidence.push(`${entryCount} @TYPE{ entries`);
  }

  const fieldCount = countMatches(rawText, /\w+\s*=\s*(?:\{[^}]*\}|"[^"]*"|\d+)/g);
  if (fieldCount >= 3) {
    score += 0.20;
    evidence.push(`${fieldCount} field assignments`);
  }

  const openBraces = (rawText.match(/\{/g) ?? []).length;
  const closeBraces = (rawText.match(/\}/g) ?? []).length;
  if (entryCount > 0 && Math.abs(openBraces - closeBraces) <= entryCount) {
    score += 0.20;
    evidence.push('balanced braces');
  } else if (entryCount > 0) {
    score -= 0.20;
    evidence.push('unbalanced braces');
  }

  return { format: 'bibtex', score: clampScore(score), evidence, blockCoverage: entryCount > 0 ? 1 : 0 };
}

function scoreNumberedFormat(rawText: string, lines: string[]): DetectorResult {
  const evidence: string[] = [];
  let score = 0;
  if (lines.length === 0) return { format: 'numbered_list', score: 0, evidence: ['empty_input'], blockCoverage: 0 };

  const numberPattern = /^\s*(?:\[\d+\]|\d+[.)\]])\s+/;
  const numberedLines = lines.filter((line) => numberPattern.test(line));
  const fraction = numberedLines.length / lines.length;

  if (fraction >= 0.6) {
    score += 0.25;
    evidence.push(`${(fraction * 100).toFixed(0)}% of lines are numbered`);
  }

  const numbers = numberedLines.map((line) => {
    const match = line.match(/\[?(\d+)[.\])]/);
    return match ? Number(match[1]) : 0;
  }).filter((n) => n > 0);

  if (numbers.length >= 2) {
    let sequential = true;
    const uniqueNumbers = new Set(numbers);
    if (uniqueNumbers.size < numbers.length) {
      score -= 0.20;
      evidence.push('duplicate numbers');
      sequential = false;
    }
    if (sequential) {
      const sorted = [...numbers].sort((a, b) => a - b);
      const gaps = sorted.slice(1).filter((n, i) => n !== sorted[i]! + 1).length;
      if (gaps <= 1) {
        score += 0.15;
        evidence.push('sequential numbering');
      }
    }
  }

  const multiWord = numberedLines.filter((line) => line.split(/\s+/).length > 3);
  if (multiWord.length > numberedLines.length * 0.5) {
    score += 0.10;
    evidence.push('multi-word blocks');
  }

  return { format: 'numbered_list', score: clampScore(score), evidence, blockCoverage: fraction };
}

function scoreHangingIndentFormat(rawText: string): DetectorResult {
  const evidence: string[] = [];
  let score = 0;
  const allLines = rawText.split('\n');
  const blocks = splitOnBlankLines(rawText);
  if (blocks.length < 3) return { format: 'hanging_indent', score: 0, evidence: ['too_few_blocks'], blockCoverage: 0 };

  let hangingBlocks = 0;
  let firstLinesAtCol0 = 0;
  let totalLength = 0;
  const deltas: number[] = [];

  for (const block of blocks) {
    const blockLines = block.split('\n').filter((l) => l.trim().length > 0);
    if (blockLines.length < 2) continue;

    const firstIndent = leadingWhitespace(blockLines[0]!);
    const continuationIndents = blockLines.slice(1).map(leadingWhitespace);
    const avgContinuation = continuationIndents.reduce((s, v) => s + v, 0) / continuationIndents.length;

    if (avgContinuation > firstIndent + 1) {
      hangingBlocks += 1;
      deltas.push(avgContinuation - firstIndent);
    }
    if (firstIndent === 0) firstLinesAtCol0 += 1;
    totalLength += block.length;
  }

  const hangingFraction = hangingBlocks / blocks.length;
  if (hangingFraction >= 0.5) {
    score += 0.20;
    evidence.push(`${(hangingFraction * 100).toFixed(0)}% blocks have hanging indent`);
  }

  if (firstLinesAtCol0 / blocks.length >= 0.7) {
    score += 0.15;
    evidence.push('first lines at column 0');
  }

  const avgBlockLen = totalLength / blocks.length;
  if (avgBlockLen > 60) {
    score += 0.10;
    evidence.push(`avg block length ${Math.round(avgBlockLen)} chars`);
  }

  if (deltas.length >= 2) {
    const avgDelta = deltas.reduce((s, v) => s + v, 0) / deltas.length;
    const variance = deltas.reduce((s, v) => s + (v - avgDelta) ** 2, 0) / deltas.length;
    if (variance > 4) {
      score -= 0.15;
      evidence.push('inconsistent indent delta');
    }
  }

  const authorPattern = /^[A-Z][A-Za-z'`-]+,\s*(?:[A-Z]\.|[A-Z][a-z]+)/;
  const authorLike = blocks.filter((b) => authorPattern.test(b.trim())).length;
  if (authorLike === 0 && blocks.length >= 3) {
    score -= 0.10;
    evidence.push('no author-shaped block starts');
  }

  return { format: 'hanging_indent', score: clampScore(score), evidence, blockCoverage: hangingFraction };
}

function scorePlainTextFormat(rawText: string): DetectorResult {
  const evidence: string[] = [];
  let score = 0.10;
  evidence.push('base fallback score');

  const blankLineBlocks = splitOnBlankLines(rawText);
  if (blankLineBlocks.length >= 3) {
    score += 0.10;
    evidence.push(`${blankLineBlocks.length} blank-line separated blocks`);
  }

  return { format: 'plain_text', score: clampScore(score), evidence, blockCoverage: 1 };
}

/* ─── Stage record helper ──────────────────────────────────── */

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
  stageIdOverride?: string,
): StageRunRecord {
  return {
    stageId: stageIdOverride ?? `phase1_${record.phaseId}`,
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}
