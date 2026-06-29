import type { CountAudit } from '../types/pipeline.js';
import type { BatchEnvelope, RawBlock, RawBlockFlag, SplitQualityFlag } from '../types/ingestion.js';
import {
  CONTINUATION_SUPPRESSOR_REGEX,
  GROUP_AUTHOR_REGEX,
  INITIALS_FIRST_REGEX,
  LOWERCASE_OR_CONJUNCTION_LEAD_REGEX,
  NUMBERED_LEAD_REGEX,
  PAREN_YEAR_REGEX,
  SURNAME_INITIALS_REGEX,
  SURNAME_PARTICLE_REGEX,
  VANCOUVER_TAIL_REGEX,
  isLikelyGroupAuthorLine,
} from './detect.js';
import { isLogicalEmptyLine, leadingWhitespaceWidth, normalizeSignalLine } from './normalize.js';
import { joinWrappedDoiLines, joinWrappedUrlLines } from './wrappedTokens.js';

export const PHASE2_SEMISTRUCT_CONFIDENCE_THRESHOLD = 0.55;
export const PHASE2_OPENER_THRESHOLD = 0.60;
export const PHASE2_TOO_LONG_BLOCK_CHARS = 1_200;
export const PHASE2_OVERSIZED_RECOVERY_CHARS = 500;

const MIN_BLOCK_LENGTH = 20;
const HEADING_REGEX = /^(?:references?|bibliography|works cited)$/i;
const PAGE_COUNTER_REGEX = /^\s*(?:Page\s+)?\d+\s+(?:of|\/)\s+\d+\s*$/;
const TRAILING_PAGE_COUNTER_REGEX = /\b\d+\s+(?:of|\/)\s+\d+\s*$/i;
const FUSED_PAGE_COUNTER_HEADING_REGEX = /\b\d+\s+(?:of|\/)\s+\d+\s*references?$/i;
const RUNNING_TITLE_REGEX = /^\s*\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]+(?:\s+\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]+){1,8}\s*$/u;
const URI_OR_DOI_REGEX = /(?:https?:\/\/\S+|www\.\S+|\b10\.\d{4,9}\/\S+\b)/i;
const NUMERIC_AUTHOR_LIST_LEAD_REGEX =
  /^\s*\p{Lu}[\p{L}\p{M}'`\u2018\u2019.-]+(?:\s+\p{Lu}{1,4})?(?:,\s*(?:(?:da|de|del|della|di|la|le|van|von)\s+)?\p{Lu}[\p{L}\p{M}'`\u2018\u2019.-]+(?:\s+\p{Lu}{1,4})?){1,10}(?:[:.])\s+/u;
const SECONDARY_AUTHOR_YEAR_BOUNDARY_REGEX = /(?<=[.!?])\s+(?=(?:[A-Z][A-Za-z'’.-]+,\s+[A-Z][^()]{0,40}\(\d{4}[a-z]?\)|[A-Z][a-z'’.-]+(?: et al\.?| & [A-Z][a-z'’.-]+)?\s*\(\d{4}[a-z]?\)))/g;

interface BlockDraft {
  lines: string[];
  splitReason: string;
  boundarySignals: string[];
}

export interface Phase2SplitHeuristicResult {
  aggregatedCount: number;
  blocks: RawBlock[];
  countAudit: CountAudit;
  splitQualityFlag: SplitQualityFlag;
}

export function splitPhase2Heuristic(input: BatchEnvelope): Phase2SplitHeuristicResult {
  const preparedText = prepareWorkingText(input.rawText);
  const blockDrafts = aggregateBlocks(preparedText, input);
  const blocks = materializeBlocks(blockDrafts, input);
  const countAudit = buildCountAudit(input.estimatedCount, blockDrafts.length, blocks);
  const splitQualityFlag = computeSplitQualityFlag(blocks, input.detection?.sampled ?? false);

  return {
    aggregatedCount: blockDrafts.length,
    blocks,
    countAudit,
    splitQualityFlag,
  };
}

function prepareWorkingText(rawText: string): string {
  let current = joinWrappedDoiLines(rawText);
  current = joinWrappedUrlLines(current);
  return current;
}

function aggregateBlocks(preparedText: string, input: BatchEnvelope): BlockDraft[] {
  if (
    input.detectedFormat !== 'doi_list'
    && input.detectedFormat !== 'bibtex'
    && input.detectedFormat !== 'ris'
    && hasStrongNumberedStructure(input, preparedText)
  ) {
    return splitNumberedBlocks(preparedText);
  }

  switch (input.detectedFormat) {
    case 'doi_list':
      return preparedText
        .split('\n')
        .filter((line) => !isLogicalEmptyLine(line))
        .map((line) => ({ lines: [normalizeSignalLine(line).trim()], splitReason: 'doi_line', boundarySignals: ['doi_line'] }));
    case 'bibtex':
      return splitBibtexEntries(preparedText);
    case 'ris':
      return splitRisEntries(preparedText);
    case 'numbered_list':
      return input.formatConfidence >= PHASE2_SEMISTRUCT_CONFIDENCE_THRESHOLD
        ? splitNumberedBlocks(preparedText)
        : fallbackSplit(preparedText);
    case 'blank_line':
      return input.formatConfidence >= PHASE2_SEMISTRUCT_CONFIDENCE_THRESHOLD
        ? splitBlankLineBlocks(preparedText)
        : fallbackSplit(preparedText);
    case 'hanging_indent':
      return input.formatConfidence >= PHASE2_SEMISTRUCT_CONFIDENCE_THRESHOLD
        ? splitHangingIndentBlocks(preparedText)
        : fallbackSplit(preparedText);
    case 'plain_text':
    case 'unknown':
      return fallbackSplit(preparedText);
  }
}

function splitBibtexEntries(text: string): BlockDraft[] {
  const starts = [...text.matchAll(/^@\w+\s*\{[^,]+,/gm)].map((match) => match.index ?? 0);
  if (starts.length === 0) return [];

  return starts.map((start, index) => ({
    lines: [text.slice(start, starts[index + 1] ?? text.length).trim()],
    splitReason: 'bibtex_entry',
    boundarySignals: ['bibtex_entry'],
  }));
}

function splitRisEntries(text: string): BlockDraft[] {
  const lines = text.split('\n');
  const drafts: BlockDraft[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^TY\s+-\s+/.test(line) && current.length > 0) {
      drafts.push({ lines: [...current], splitReason: 'ris_entry', boundarySignals: ['ris_entry'] });
      current = [];
    }
    if (!isLogicalEmptyLine(line)) current.push(normalizeSignalLine(line));
    if (/^ER\s+-/.test(line) && current.length > 0) {
      drafts.push({ lines: [...current], splitReason: 'ris_entry', boundarySignals: ['ris_entry'] });
      current = [];
    }
  }

  if (current.length > 0) {
    drafts.push({ lines: current, splitReason: 'ris_entry', boundarySignals: ['ris_entry'] });
  }

  return drafts;
}

function splitNumberedBlocks(text: string): BlockDraft[] {
  const lines = text.split('\n');
  const drafts: BlockDraft[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isLogicalEmptyLine(line)) continue;
    const normalized = normalizeSignalLine(line);
    if (isSplitArtifactLine(normalized)) continue;
    if (NUMBERED_LEAD_REGEX.test(normalized) && current.length > 0) {
      drafts.push({ lines: [...current], splitReason: 'number_marker', boundarySignals: ['numbered_lead'] });
      current = [];
    }
    current.push(normalized);
  }

  if (current.length > 0) {
    drafts.push({ lines: current, splitReason: 'number_marker', boundarySignals: ['numbered_lead'] });
  }

  return drafts;
}

function splitBlankLineBlocks(text: string): BlockDraft[] {
  return text
    .split(/\n\s*\n+/)
    .map((block) => block.split('\n').filter((line) => !isLogicalEmptyLine(line)).map(normalizeSignalLine))
    .filter((lines) => lines.length > 0)
    .map((lines) => ({
      lines,
      splitReason: 'blank_line',
      boundarySignals: ['blank_line'],
    }));
}

function splitHangingIndentBlocks(text: string): BlockDraft[] {
  const lines = text.split('\n');
  const drafts: BlockDraft[] = [];
  let current: string[] = [];
  let baseIndent = 0;

  for (const line of lines) {
    if (isLogicalEmptyLine(line)) {
      if (current.length > 0) {
        drafts.push({ lines: [...current], splitReason: 'hanging_indent', boundarySignals: ['hanging_indent'] });
        current = [];
        baseIndent = 0;
      }
      continue;
    }

    const indent = leadingWhitespaceWidth(line);
    const normalized = normalizeSignalLine(line).trim();
    if (current.length === 0) {
      current = [normalized];
      baseIndent = indent;
      continue;
    }

    if (indent <= baseIndent && looksLikeCitationStart(normalized)) {
      drafts.push({ lines: [...current], splitReason: 'hanging_indent', boundarySignals: ['hanging_indent'] });
      current = [normalized];
      baseIndent = indent;
      continue;
    }

    current.push(normalized);
  }

  if (current.length > 0) {
    drafts.push({ lines: current, splitReason: 'hanging_indent', boundarySignals: ['hanging_indent'] });
  }

  return drafts;
}

function fallbackSplit(text: string): BlockDraft[] {
  const lines = preprocessFallbackLines(text);
  const drafts: BlockDraft[] = [];
  let current: BlockDraft | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.kind === 'artifact') continue;

    if (line.kind === 'uri_tail') {
      const attached = attachUriTail(drafts, current, line.text);
      if (!attached) {
        if (current) {
          drafts.push(current);
          current = null;
        }
        drafts.push({
          lines: [line.text],
          splitReason: 'uncertain',
          boundarySignals: ['uri_tail_orphan'],
        });
      }
      continue;
    }

    const nextLine = lines[index + 1]?.kind === 'content' ? lines[index + 1]!.text : null;
    const previousArtifactBoundary = index > 0 && lines[index - 1]?.kind === 'artifact';
    const { score, reason, signals } = scoreOpener(line.text, nextLine, previousArtifactBoundary);
    const shouldStart =
      NUMBERED_LEAD_REGEX.test(line.text)
      || (!CONTINUATION_SUPPRESSOR_REGEX.test(line.text) && score >= PHASE2_OPENER_THRESHOLD);

    if (!current) {
      current = {
        lines: [line.text],
        splitReason: shouldStart ? reason : 'uncertain',
        boundarySignals: [...signals],
      };
      continue;
    }

    if (shouldStart) {
      drafts.push(current);
      current = {
        lines: [line.text],
        splitReason: reason,
        boundarySignals: [...signals],
      };
      continue;
    }

    current.lines.push(line.text);
    current.boundarySignals.push(...signals);
  }

  if (current) drafts.push(current);

  const recovered = applyOversizedRecovery(drafts);
  return recovered.length > 0 ? recovered : drafts;
}

function preprocessFallbackLines(text: string): Array<{ kind: 'content' | 'artifact' | 'uri_tail'; text: string }> {
  const physicalLines = text.split('\n');
  const artifactIndexes = findArtifactIndexes(physicalLines);
  const prepared: Array<{ kind: 'content' | 'artifact' | 'uri_tail'; text: string }> = [];

  for (const [index, line] of physicalLines.entries()) {
    if (isLogicalEmptyLine(line)) continue;

    const normalized = normalizeSignalLine(line).replace(/\s+$/g, '');
    if (artifactIndexes.has(index)) {
      prepared.push({ kind: 'artifact', text: normalized });
      continue;
    }
    if (isUriTailLine(normalized)) {
      prepared.push({ kind: 'uri_tail', text: normalized.trim() });
      continue;
    }
    prepared.push({ kind: 'content', text: normalized.trim() });
  }

  return prepared;
}

function findArtifactIndexes(lines: string[]): Set<number> {
  const indexes = new Set<number>();
  const runningCandidates = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeSignalLine(lines[index] ?? '').trim();
    if (!line) continue;

    if (HEADING_REGEX.test(line) && line.length <= 20 && !containsYearDoiUrl(line)) {
      indexes.add(index);
      continue;
    }

    if (PAGE_COUNTER_REGEX.test(line)) {
      indexes.add(index);
      continue;
    }

    if (TRAILING_PAGE_COUNTER_REGEX.test(line) || FUSED_PAGE_COUNTER_HEADING_REGEX.test(line)) {
      indexes.add(index);
      continue;
    }

    if (RUNNING_TITLE_REGEX.test(line) && !/[.]/.test(line) && !containsYearDoiUrl(line)) {
      runningCandidates.add(index);
    }
  }

  for (const index of runningCandidates) {
    if (hasArtifactNeighbor(index, indexes, runningCandidates)) {
      indexes.add(index);
    }
  }

  return indexes;
}

function hasArtifactNeighbor(index: number, artifacts: Set<number>, runningCandidates: Set<number>): boolean {
  for (let offset = -2; offset <= 2; offset += 1) {
    if (offset === 0) continue;
    const candidate = index + offset;
    if (artifacts.has(candidate) || runningCandidates.has(candidate)) {
      return true;
    }
  }
  return false;
}

function hasStrongNumberedStructure(input: BatchEnvelope, text: string): boolean {
  const explicitNumberedLeads = countMatches(text, /^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/gm);
  const numberedLineCount = input.ingestionSignals.numberedLineCount ?? 0;
  const numberedLineRatio = input.ingestionSignals.numberedLineRatio ?? 0;

  return explicitNumberedLeads >= 3 || numberedLineCount >= 3 || numberedLineRatio >= 0.08;
}

function isSplitArtifactLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    HEADING_REGEX.test(trimmed)
    || PAGE_COUNTER_REGEX.test(trimmed)
    || TRAILING_PAGE_COUNTER_REGEX.test(trimmed)
    || FUSED_PAGE_COUNTER_HEADING_REGEX.test(trimmed)
  );
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function isUriTailLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    URI_OR_DOI_REGEX.test(trimmed)
    && !/^(?:accessed|viewed|retrieved)\b/i.test(trimmed)
    && !NUMBERED_LEAD_REGEX.test(trimmed)
    && !PAREN_YEAR_REGEX.test(trimmed)
    && (trimmed.length <= 120 || /^(?:doi:|https?:\/\/|www\.)/i.test(trimmed))
  );
}

function attachUriTail(drafts: BlockDraft[], current: BlockDraft | null, tail: string): boolean {
  // A line that is only a URL/DOI is never a standalone reference — line-wrapped paste
  // (PDF copy, OCR) routinely drops the link onto its own line *after* the citation's
  // terminal period, so it belongs to the reference immediately above it. Attach it to
  // the nearest preceding block. The one exception is a list of bare URLs, where each URL
  // really is its own reference: never chain a tail onto a block that is itself only URIs.
  const target = current ?? drafts.at(-1) ?? null;
  if (!target) return false;
  if (target.lines.every((line) => isUriTailLine(line))) return false;

  target.lines.push(tail);
  target.boundarySignals.push('uri_tail_attach_previous');
  if (target.splitReason === 'uncertain') {
    target.splitReason = 'uri_tail_attach_previous';
  }
  return true;
}

function scoreOpener(line: string, nextLine: string | null, previousArtifactBoundary: boolean): {
  score: number;
  reason: string;
  signals: string[];
} {
  let score = 0;
  let reason = 'uncertain';
  const signals: string[] = [];

  if (NUMBERED_LEAD_REGEX.test(line)) {
    score += 0.40;
    reason = 'number_marker';
    signals.push('numbered_lead');
  }

  const authorOpener = looksLikeCitationStart(line);
  if (authorOpener) {
    score += 0.35;
    reason = reason === 'number_marker' ? reason : 'opener_score';
    signals.push('author_opener');
  }

  const hasYearAnchor = PAREN_YEAR_REGEX.test(line) || /\b(?:19|20)\d{2}[a-z]?\b/.test(line);
  if (hasYearAnchor) {
    score += 0.25;
    signals.push('year_anchor');
  }

  if (previousArtifactBoundary) {
    score += 0.10;
    signals.push('artifact_boundary');
  }

  if (LOWERCASE_OR_CONJUNCTION_LEAD_REGEX.test(line)) {
    score -= 0.45;
    signals.push('lowercase_lead');
  }

  if (line.trim().length < 15 && !hasYearAnchor) {
    score -= 0.20;
    signals.push('too_short');
  }

  if (CONTINUATION_SUPPRESSOR_REGEX.test(line)) {
    score -= 0.15;
    signals.push('continuation_like');
  }

  let compositeBonus = 0;
  if (authorOpener && /(?:&|,|\band\b)\s*$/i.test(line) && nextLine && PAREN_YEAR_REGEX.test(nextLine)) {
    compositeBonus = Math.max(compositeBonus, 0.25);
    signals.push('author_continuation_bonus');
  }
  if (NUMBERED_LEAD_REGEX.test(line) && VANCOUVER_TAIL_REGEX.test(line)) {
    compositeBonus = Math.max(compositeBonus, 0.25);
    signals.push('vancouver_tail_bonus');
  }

  score = clamp(score + compositeBonus);

  if (score >= PHASE2_OPENER_THRESHOLD && reason === 'uncertain') {
    reason = 'opener_score';
  }

  return { score, reason, signals };
}

function applyOversizedRecovery(drafts: BlockDraft[]): BlockDraft[] {
  if (drafts.length === 0) return drafts;

  const needsRecovery =
    (drafts.length === 1 && collapseInternalWhitespace(drafts[0]!.lines.join('\n')).length > PHASE2_OVERSIZED_RECOVERY_CHARS)
    || drafts.some((draft) => collapseInternalWhitespace(draft.lines.join('\n')).length > PHASE2_TOO_LONG_BLOCK_CHARS);

  if (!needsRecovery) return drafts;

  const recovered: BlockDraft[] = [];

  for (const draft of drafts) {
    const text = collapseInternalWhitespace(draft.lines.join('\n'));
    if (
      text.length <= PHASE2_OVERSIZED_RECOVERY_CHARS
      && text.length <= PHASE2_TOO_LONG_BLOCK_CHARS
    ) {
      recovered.push(draft);
      continue;
    }

    const pieces = text.split(SECONDARY_AUTHOR_YEAR_BOUNDARY_REGEX).map((piece) => piece.trim()).filter(Boolean);
    if (pieces.length <= 1) {
      recovered.push(draft);
      continue;
    }

    for (const piece of pieces) {
      recovered.push({
        lines: [piece],
        splitReason: 'secondary_author_year_boundary',
        boundarySignals: [...draft.boundarySignals, 'secondary_author_year_boundary'],
      });
    }
  }

  return recovered;
}

function looksLikeCitationStart(line: string): boolean {
  return (
    NUMBERED_LEAD_REGEX.test(line)
    || SURNAME_INITIALS_REGEX.test(line)
    || SURNAME_PARTICLE_REGEX.test(line)
    || INITIALS_FIRST_REGEX.test(line)
    || NUMERIC_AUTHOR_LIST_LEAD_REGEX.test(line)
    || /^\s*[A-Z][A-Za-z'`-]+(?:\s+[A-Z]{1,4})?(?:,\s+(?:(?:da|de|del|della|di|la|le|van|von)\s+)?[A-Z][A-Za-z'`-]+(?:\s+[A-Z]{1,4})?)+(?:\.)?/i.test(line)
    || (GROUP_AUTHOR_REGEX.test(line) && isLikelyGroupAuthorLine(line))
    || /^\s*\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]+(?:\s+\p{Lu}[\p{L}\p{M}'\u2018\u2019\u02BC.-]+){0,3}\s*\(\d{4}[a-z]?\)/u.test(line)
  );
}

function looksLikeCompleteCitationBlock(text: string): boolean {
  const normalized = collapseInternalWhitespace(text);
  if (normalized.length < 40 || normalized.length > PHASE2_TOO_LONG_BLOCK_CHARS) {
    return false;
  }

  const startsLikeCitation = looksLikeCitationStart(normalized)
    || /^\s*(?:[A-Z][A-Za-z'`-]+(?:\s+[A-Z][A-Za-z'`-]+){0,3}\.\s*){2,}/.test(normalized);
  if (!startsLikeCitation) {
    return false;
  }

  const hasAnchor = /\(\d{4}[a-z]?\)|\b(?:19|20)\d{2}(?:\s+[A-Za-z]{3}\s+\d{1,2})?\b/.test(normalized)
    || /\b10\.\d{4,9}\/\S+\b/i.test(normalized)
    || /https?:\/\/\S+/i.test(normalized);
  if (!hasAnchor) {
    return false;
  }

  return /(?:\.\s*$|:\s*[A-Za-z]?\d[\w-]*\s*$|\bpp?\.\s*[A-Za-z]?\d[\w-]*\s*\.\s*$|\b10\.\d{4,9}\/\S+\s*$|https?:\/\/\S+\s*$)/i.test(normalized);
}

function materializeBlocks(blockDrafts: BlockDraft[], envelope: BatchEnvelope): RawBlock[] {
  return blockDrafts.map((draft, index) => {
    const text = collapseInternalWhitespace(draft.lines.join('\n'));
    const flags: RawBlockFlag[] = [];
    let splitMethod: RawBlock['splitMethod'] = methodForFormat(envelope.detectedFormat, draft.splitReason);
    let splitConfidence = confidenceForMethod(splitMethod);

    if (splitMethod === 'uncertain' && looksLikeCompleteCitationBlock(text)) {
      splitMethod = 'ml_classifier';
      splitConfidence = 0.72;
    }

    if (text.length < MIN_BLOCK_LENGTH) flags.push('too_short');
    if (text.length > PHASE2_TOO_LONG_BLOCK_CHARS) flags.push('too_long');
    if (splitMethod === 'uncertain' || splitConfidence < 0.5) {
      flags.push('uncertain');
      splitMethod = 'uncertain';
      splitConfidence = Math.min(splitConfidence, 0.49);
    }

    return {
      index,
      text,
      formatMeta: {
        sourceType: envelope.sourceType,
        structure: envelope.structure,
        detectedFormat: envelope.detectedFormat,
        formatConfidence: envelope.formatConfidence,
      },
      splitMethod,
      splitConfidence,
      isDoiResolved: false,
      flags,
      splitReason: draft.splitReason,
      blockFormat: envelope.detectedFormat,
      boundarySignals: [...new Set(draft.boundarySignals)],
    };
  });
}

function methodForFormat(detectedFormat: BatchEnvelope['detectedFormat'], splitReason: string): RawBlock['splitMethod'] {
  if (splitReason === 'number_marker') return 'numbered';
  if (splitReason === 'blank_line') return 'blank_line';
  if (splitReason === 'hanging_indent') return 'hanging_indent';

  switch (detectedFormat) {
    case 'doi_list':
      return 'doi_list';
    case 'bibtex':
      return 'bibtex_entry';
    case 'ris':
      return 'ris_entry';
    case 'numbered_list':
      return 'numbered';
    case 'blank_line':
      return 'blank_line';
    case 'hanging_indent':
      return 'hanging_indent';
    case 'plain_text':
    case 'unknown':
      return 'uncertain';
  }
}

function confidenceForMethod(splitMethod: RawBlock['splitMethod']): number {
  switch (splitMethod) {
    case 'doi_list':
    case 'bibtex_entry':
    case 'ris_entry':
    case 'doi_resolved':
      return 1;
    case 'numbered':
      return 0.95;
    case 'blank_line':
      return 0.8;
    case 'hanging_indent':
      return 0.7;
    case 'ml_classifier':
      return 0.6;
    case 'uncertain':
      return 0.4;
  }
}

function buildCountAudit(inputEstimate: number, aggregatedCount: number, blocks: RawBlock[]): CountAudit {
  return {
    inputEstimate,
    aggregatedCount,
    splitCount: blocks.length,
    delta: blocks.length - inputEstimate,
    needsActionCount: blocks.filter((block) => block.flags.length > 0).length,
    droppedCount: 0,
  };
}

function computeSplitQualityFlag(blocks: RawBlock[], sampled: boolean): SplitQualityFlag {
  if (sampled) return 'sampled';
  if (blocks.length === 0) return 'low';
  const consistentBlocks = blocks.filter((block) => block.splitConfidence >= 0.6).length;
  return consistentBlocks / blocks.length >= 0.6 ? 'ok' : 'low';
}

function containsYearDoiUrl(line: string): boolean {
  return (
    /\(\d{4}[a-z]?\)|\b(?:19|20)\d{2}[a-z]?\b/.test(line)
    || /\b10\.\d{4,9}\/\S+\b/i.test(line)
    || /https?:\/\/\S+|www\.\S+/i.test(line)
  );
}

function collapseInternalWhitespace(block: string): string {
  return block.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
