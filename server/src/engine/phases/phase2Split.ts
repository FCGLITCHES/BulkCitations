import { AppError, ErrorCode } from '../errors/index.js';
import { env } from '../../config.js';
import { buildProfiledTextEnvelope, cleanupPdfArtifacts } from './phase1Ingest.js';
import type {
  BatchEnvelope,
  DetectedFormat,
  InputCleanupDecisionReason,
  InputCleanupInfo,
  RawBlock,
  RawBlockFlag,
  SplitQualityFlag,
} from '../types/ingestion.js';
import type {
  CountAudit,
  PipelineContext,
  PipelineStage,
  StageRunRecord,
} from '../types/pipeline.js';
import { splitPhase2Heuristic } from '../ingestion/split.js';
import { joinWrappedDoiLines, joinWrappedUrlLines } from '../ingestion/wrappedTokens.js';

const CONTRACT_VERSION = 2;
const MIN_BLOCK_LENGTH = 20;
const MAX_BLOCK_LENGTH = 1_200;
const MAX_PER_BLOCK_DETECTION = 80;
const SPLIT_QUALITY_THRESHOLD = 0.60;
const NUMBERED_LINE_REGEX = /^\s*(?:\[\d+\]|\d+[.)\]])\s+/;
const BIBTEX_START_REGEX = /@\w+\s*{/g;

export interface Phase2SplitResult {
  resolvedEnvelope: BatchEnvelope;
  blocks: RawBlock[];
  countAudit: CountAudit;
  splitQualityFlag: SplitQualityFlag;
  cleanup: {
    mode: 'off' | 'inspect_only' | 'full';
    lookedLikePdfCopy: boolean;
    candidateGenerated: boolean;
    baselineDetectedFormat: DetectedFormat;
    cleanedDetectedFormat?: DetectedFormat;
    baselineSplitQuality: number;
    cleanedSplitQuality?: number;
    qualityDelta?: number;
    wouldSelect: 'baseline' | 'cleaned';
    finalUsed: 'baseline' | 'cleaned';
    decisionReason?: InputCleanupDecisionReason;
  };
}

interface BaseSplitEvaluation {
  blocks: RawBlock[];
  countAudit: CountAudit;
  splitQualityFlag: SplitQualityFlag;
  splitQualityScore: number;
}

interface SplitCandidateEvaluation extends BaseSplitEvaluation {
  envelope: BatchEnvelope;
}

export class Phase2Split implements PipelineStage<BatchEnvelope, Phase2SplitResult> {
  readonly phaseId = 'splitting' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(input: BatchEnvelope, ctx: PipelineContext): Promise<Phase2SplitResult> {
    const stageStartedAt = Date.now();

    try {
      const baseline = evaluateSplitCandidate(input);
      const cleanupStartedAt = Date.now();
      const cleanup = evaluatePdfCleanup(input, baseline, ctx);
      const finalUsed = cleanup.finalUsed === 'cleaned' && cleanup.cleaned
        ? cleanup.cleaned
        : baseline;

      if (cleanup.mode !== 'off') {
        ctx.stageLog.push(
          stageRecord({
            phaseId: 'pdf_cleanup_evaluation',
            status: cleanup.decisionReason === 'cleanup_error' ? 'warning' : 'success',
            durationMs: Date.now() - cleanupStartedAt,
            message: buildPdfCleanupMessage(cleanup),
            details: {
              lookedLikePdfCopy: cleanup.lookedLikePdfCopy,
              candidateGenerated: cleanup.candidateGenerated,
              baselineDetectedFormat: cleanup.baselineDetectedFormat,
              cleanedDetectedFormat: cleanup.cleanedDetectedFormat,
              baselineSplitQuality: cleanup.baselineSplitQuality,
              cleanedSplitQuality: cleanup.cleanedSplitQuality,
              qualityDelta: cleanup.qualityDelta,
              finalUsed: cleanup.finalUsed,
              decisionReason: cleanup.decisionReason,
              sampled: false,
            },
          }),
        );
      }

      if (finalUsed.blocks.length === 0) {
        throw new AppError(422, ErrorCode.SPLIT_NO_BLOCKS_FOUND, 'No citation blocks could be derived from the input.');
      }

      ctx.stageLog.push(
        stageRecord({
          phaseId: 'block_aggregation',
          status: 'success',
          durationMs: Date.now() - stageStartedAt,
          message: `Aggregated ${finalUsed.countAudit.aggregatedCount} candidate blocks.`,
          details: {
            detectedFormat: finalUsed.envelope.detectedFormat,
            aggregatedCount: finalUsed.countAudit.aggregatedCount,
          },
        }),
      );

      const blocks = attachInputCleanup(finalUsed.blocks, cleanup);
      const countAudit = {
        ...finalUsed.countAudit,
        needsActionCount: blocks.filter((block) => block.flags.length > 0).length,
      };
      const hasMeaningfulDrift =
        countAudit.inputEstimate > 0 &&
        Math.abs(countAudit.delta) / countAudit.inputEstimate > 0.05;
      const hasFlags = blocks.some((block) => block.flags.length > 0);

      ctx.stageLog.push(
        stageRecord({
          phaseId: 'splitting',
          status: hasMeaningfulDrift || hasFlags ? 'warning' : 'success',
          durationMs: Date.now() - stageStartedAt,
          message: hasMeaningfulDrift
            ? `Split count (${countAudit.splitCount}) differs from estimate (${countAudit.inputEstimate}) by ${countAudit.delta}.`
            : `Split ${countAudit.splitCount} citation blocks.`,
          ...(hasMeaningfulDrift ? { code: ErrorCode.SPLIT_COUNT_AUDIT_DRIFT } : {}),
          details: {
            splitCount: countAudit.splitCount,
            aggregatedCount: countAudit.aggregatedCount,
            needsActionCount: countAudit.needsActionCount,
            droppedCount: countAudit.droppedCount,
            splitQualityFlag: finalUsed.splitQualityFlag,
          },
        }),
      );

      return {
        resolvedEnvelope: finalUsed.envelope,
        blocks,
        countAudit,
        splitQualityFlag: finalUsed.splitQualityFlag,
        cleanup: {
          mode: cleanup.mode,
          lookedLikePdfCopy: cleanup.lookedLikePdfCopy,
          candidateGenerated: cleanup.candidateGenerated,
          baselineDetectedFormat: cleanup.baselineDetectedFormat,
          ...(cleanup.cleanedDetectedFormat ? { cleanedDetectedFormat: cleanup.cleanedDetectedFormat } : {}),
          baselineSplitQuality: cleanup.baselineSplitQuality,
          ...(cleanup.cleanedSplitQuality != null ? { cleanedSplitQuality: cleanup.cleanedSplitQuality } : {}),
          ...(cleanup.qualityDelta != null ? { qualityDelta: cleanup.qualityDelta } : {}),
          wouldSelect: cleanup.wouldSelect,
          finalUsed: cleanup.finalUsed,
          ...(cleanup.decisionReason ? { decisionReason: cleanup.decisionReason } : {}),
        },
      };
    } catch (error) {
      ctx.stageLog.push(
        stageRecord({
          phaseId: 'splitting',
          status: 'error',
          durationMs: Date.now() - stageStartedAt,
          message: error instanceof Error ? error.message : 'Phase 2 failed.',
          code: error instanceof AppError ? error.code : ErrorCode.PHASE_ERROR,
        }),
      );
      throw error;
    }
  }
}

export const phase2Split = new Phase2Split();

function evaluateSplitCandidate(input: BatchEnvelope): SplitCandidateEvaluation {
  const result = splitPhase2Heuristic(input);

  return {
    envelope: input,
    blocks: result.blocks,
    countAudit: result.countAudit,
    splitQualityFlag: result.splitQualityFlag,
    splitQualityScore: scoreSplitQuality(result.blocks.map((block) => block.text)),
  };
}

function evaluatePdfCleanup(
  input: BatchEnvelope,
  baseline: SplitCandidateEvaluation,
  ctx: PipelineContext,
): {
  mode: 'off' | 'inspect_only' | 'full';
  lookedLikePdfCopy: boolean;
  candidateGenerated: boolean;
  baselineDetectedFormat: DetectedFormat;
  cleanedDetectedFormat?: DetectedFormat;
  baselineSplitQuality: number;
  cleanedSplitQuality?: number;
  qualityDelta?: number;
  wouldSelect: 'baseline' | 'cleaned';
  finalUsed: 'baseline' | 'cleaned';
  decisionReason?: InputCleanupDecisionReason;
  cleaned?: SplitCandidateEvaluation;
  hints: InputCleanupInfo['hints'];
} {
  const mode = ctx.options.enablePdfCleanup ? ctx.options.pdfCleanupMode : 'off';
  if (mode === 'off') {
    return {
      mode,
      lookedLikePdfCopy: false,
      candidateGenerated: false,
      baselineDetectedFormat: baseline.envelope.detectedFormat,
      baselineSplitQuality: baseline.splitQualityScore,
      wouldSelect: 'baseline',
      finalUsed: 'baseline',
      hints: [],
    };
  }

  if (!input.cleanupMeta?.lookedLikePdfCopy) {
    return {
      mode,
      lookedLikePdfCopy: false,
      candidateGenerated: false,
      baselineDetectedFormat: baseline.envelope.detectedFormat,
      baselineSplitQuality: baseline.splitQualityScore,
      wouldSelect: 'baseline',
      finalUsed: 'baseline',
      decisionReason: 'not_pdf_like',
      hints: [],
    };
  }

  try {
    const cleanupCandidate = resolveCleanupCandidate(input);
    const baseHints = cleanupCandidate.hints.filter((hint) => hint !== 'cleanup_selected' && hint !== 'cleanup_rejected');

    if (cleanupCandidate.text == null || cleanupCandidate.text === input.rawText) {
      return {
        mode,
        lookedLikePdfCopy: true,
        candidateGenerated: false,
        baselineDetectedFormat: baseline.envelope.detectedFormat,
        baselineSplitQuality: baseline.splitQualityScore,
        wouldSelect: 'baseline',
        finalUsed: 'baseline',
        decisionReason: 'equal_or_noise',
        hints: [...baseHints],
      };
    }

    const cleanedSourceType = input.sourceType === 'txt' ? 'txt' : 'text';
    const { envelope: cleanedEnvelope } = buildProfiledTextEnvelope(
      cleanedSourceType,
      cleanupCandidate.text,
      { enableScoredDetection: ctx.options.enableScoredDetection },
    );
    const cleaned = evaluateSplitCandidate({
      ...cleanedEnvelope,
      cleanupMeta: input.cleanupMeta,
    });
    const qualityDelta = cleaned.splitQualityScore - baseline.splitQualityScore;
    const blockCountRatio = baseline.countAudit.splitCount === 0
      ? cleaned.countAudit.splitCount
      : Math.abs(cleaned.countAudit.splitCount - baseline.countAudit.splitCount) / baseline.countAudit.splitCount;
    const baselineEstimateDelta = Math.abs(baseline.countAudit.splitCount - baseline.countAudit.inputEstimate);
    const cleanedEstimateDelta = Math.abs(cleaned.countAudit.splitCount - baseline.countAudit.inputEstimate);
    const cleanedImprovesEstimatedCount = cleanedEstimateDelta < baselineEstimateDelta;

    let wouldSelect: 'baseline' | 'cleaned' = 'baseline';
    let decisionReason: InputCleanupDecisionReason = 'equal_or_noise';

    if (
      blockCountRatio > env.PDF_CLEANUP_BLOCK_COUNT_DIVERGENCE_RATIO
      && !cleanedImprovesEstimatedCount
    ) {
      decisionReason = 'block_count_divergence';
    } else if (
      cleaned.envelope.detectedFormat !== baseline.envelope.detectedFormat &&
      qualityDelta < env.PDF_CLEANUP_MIN_IMPROVEMENT_DELTA
    ) {
      decisionReason = 'format_change_without_quality_gain';
    } else if (qualityDelta > env.PDF_CLEANUP_MIN_IMPROVEMENT_DELTA) {
      wouldSelect = 'cleaned';
      decisionReason = 'quality_improved';
    }

    const finalUsed = mode === 'full' && wouldSelect === 'cleaned' ? 'cleaned' : 'baseline';

    const finalHints: InputCleanupInfo['hints'] = [
      ...baseHints,
      ...(finalUsed === 'cleaned'
        ? (['cleanup_selected'] as const)
        : (['cleanup_rejected'] as const)),
    ];

    return {
      mode,
      lookedLikePdfCopy: true,
      candidateGenerated: true,
      baselineDetectedFormat: baseline.envelope.detectedFormat,
      cleanedDetectedFormat: cleaned.envelope.detectedFormat,
      baselineSplitQuality: baseline.splitQualityScore,
      cleanedSplitQuality: cleaned.splitQualityScore,
      qualityDelta,
      wouldSelect,
      finalUsed,
      decisionReason,
      cleaned,
      hints: finalHints,
    };
  } catch {
    return {
      mode,
      lookedLikePdfCopy: true,
      candidateGenerated: false,
      baselineDetectedFormat: baseline.envelope.detectedFormat,
      baselineSplitQuality: baseline.splitQualityScore,
      wouldSelect: 'baseline',
      finalUsed: 'baseline',
      decisionReason: 'cleanup_error',
      hints: ['cleanup_rejected'],
    };
  }
}

function resolveCleanupCandidate(input: BatchEnvelope): { text?: string; hints: InputCleanupInfo['hints'] } {
  if (input.cleanupMeta?.candidateText) {
    return {
      text: input.cleanupMeta.candidateText,
      hints: [...input.cleanupMeta.hints],
    };
  }

  const regenerated = cleanupPdfArtifacts(input.rawText);
  return {
    ...(regenerated.text !== input.rawText ? { text: regenerated.text } : {}),
    hints: regenerated.hints,
  };
}

function attachInputCleanup(
  blocks: RawBlock[],
  cleanup: ReturnType<typeof evaluatePdfCleanup>,
): RawBlock[] {
  if (cleanup.mode === 'off') return blocks;

  const info: InputCleanupInfo = {
    lookedLikePdfCopy: cleanup.lookedLikePdfCopy,
    cleanupApplied: cleanup.finalUsed === 'cleaned',
    finalUsed: cleanup.finalUsed,
    hints: [...cleanup.hints],
    ...(cleanup.qualityDelta != null ? { qualityDelta: cleanup.qualityDelta } : {}),
    ...(cleanup.decisionReason ? { decisionReason: cleanup.decisionReason } : {}),
  };

  return blocks.map((block) => ({
    ...block,
    inputCleanup: structuredClone(info),
  }));
}

function buildPdfCleanupMessage(cleanup: ReturnType<typeof evaluatePdfCleanup>): string {
  if (cleanup.decisionReason === 'cleanup_error') {
    return 'PDF cleanup evaluation failed; baseline split was kept.';
  }
  if (!cleanup.lookedLikePdfCopy) {
    return 'PDF cleanup skipped; input did not look like PDF copy.';
  }
  if (cleanup.mode === 'inspect_only' && cleanup.wouldSelect === 'cleaned') {
    return 'PDF cleanup would select the cleaned candidate; inspect mode kept baseline.';
  }
  if (cleanup.finalUsed === 'cleaned') {
    return 'PDF cleanup selected the cleaned candidate for splitting.';
  }
  return 'PDF cleanup compared baseline vs cleaned candidate and kept baseline.';
}

function cleanAggregatableText(rawText: string): string {
  let cleaned = rawText.replace(/\r\n?/g, '\n');
  cleaned = joinWrappedDoiLines(cleaned);
  cleaned = joinWrappedUrlLines(cleaned);

  const cleanedLines = cleaned
    .split('\n')
    .filter((line) => !isArtifactLine(line))
    .map((line) => line.replace(/\s+$/g, ''));

  return cleanedLines.join('\n').trim();
}
function isArtifactLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  return (
    /^(references|bibliography)$/i.test(trimmed) ||
    /^page\s+\d+$/i.test(trimmed) ||
    /^\d+$/.test(trimmed) ||
    /^[IVXLCDM]+$/i.test(trimmed)
  );
}

function aggregateBlocks(cleanedText: string, input: BatchEnvelope): string[] {
  if (!cleanedText.trim()) return [];

  switch (input.detectedFormat) {
    case 'doi_list':
      return cleanedText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    case 'bibtex':
      return splitBibtexEntries(cleanedText);

    case 'ris':
      return splitRisEntries(cleanedText);

    case 'numbered_list':
      return splitNumberedBlocks(cleanedText);

    case 'blank_line':
      return cleanedText
        .split(/\n\s*\n+/)
        .map((block) => collapseInternalWhitespace(block))
        .filter((block) => block.length > 0);

    case 'hanging_indent':
      return splitByHangingIndent(cleanedText);

    case 'plain_text':
    case 'unknown':
      return hybridFallbackSplit(cleanedText).blocks;
  }
}

function splitBibtexEntries(cleanedText: string): string[] {
  const starts = [...cleanedText.matchAll(BIBTEX_START_REGEX)].map((match) => match.index ?? 0);
  if (starts.length === 0) return [];

  return starts
    .map((start, index) => cleanedText.slice(start, starts[index + 1] ?? cleanedText.length).trim())
    .filter((block) => block.length > 0);
}

function splitRisEntries(cleanedText: string): string[] {
  const lines = cleanedText.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^TY  - /.test(line) && current.length > 0) {
      blocks.push(current.join('\n').trim());
      current = [];
    }

    current.push(line);

    if (/^ER  - /.test(line)) {
      blocks.push(current.join('\n').trim());
      current = [];
    }
  }

  if (current.length > 0) {
    blocks.push(current.join('\n').trim());
  }

  return blocks.filter((block) => block.length > 0);
}

function splitNumberedBlocks(cleanedText: string): string[] {
  const lines = cleanedText.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      if (current.length > 0) current.push('');
      continue;
    }

    if (NUMBERED_LINE_REGEX.test(line) && current.length > 0) {
      blocks.push(collapseInternalWhitespace(current.join('\n')));
      current = [];
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(collapseInternalWhitespace(current.join('\n')));
  }

  return blocks.filter((block) => block.length > 0);
}

function splitByHangingIndent(cleanedText: string): string[] {
  const lines = cleanedText.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let baseIndent = 0;

  for (const line of lines) {
    if (!line.trim()) {
      if (current.length > 0) {
        blocks.push(collapseInternalWhitespace(current.join('\n')));
        current = [];
        baseIndent = 0;
      }
      continue;
    }

    const indent = leadingWhitespace(line);
    const trimmed = line.trim();

    if (current.length === 0) {
      current = [trimmed];
      baseIndent = indent;
      continue;
    }

    if (shouldStartNewCitation(trimmed, indent, baseIndent, current)) {
      blocks.push(collapseInternalWhitespace(current.join('\n')));
      current = [trimmed];
      baseIndent = indent;
      continue;
    }

    current.push(trimmed);
  }

  if (current.length > 0) {
    blocks.push(collapseInternalWhitespace(current.join('\n')));
  }

  return blocks.filter((block) => block.length > 0);
}

function shouldStartNewCitation(
  line: string,
  indent: number,
  baseIndent: number,
  currentBlock: string[],
): boolean {
  const currentText = collapseInternalWhitespace(currentBlock.join(' '));
  if (currentText.length < 40) return false;

  const currentLooksComplete = /(?:\(\d{4}[a-z]?\)|\b(?:19|20)\d{2}\b)/.test(currentText);
  if (!currentLooksComplete) return false;
  if (indent > baseIndent) return false;

  return looksLikeCitationStart(line);
}

function looksLikeCitationStart(line: string): boolean {
  return (
    NUMBERED_LINE_REGEX.test(line) ||
    /^[A-Z][A-Za-z'`-]+,\s*(?:[A-Z]\.|[A-Z][a-z]+)/.test(line) ||
    /^\s*[A-Z][A-Za-z'`-]+(?:\s+[A-Z]{1,4})?(?:,\s+(?:(?:da|de|del|della|di|la|le|van|von)\s+)?[A-Z][A-Za-z'`-]+(?:\s+[A-Z]{1,4})?)+(?:\.)?/i.test(line) ||
    /^[A-Z][A-Za-z'`-]+(?:\s+[A-Z][A-Za-z'`-]+){0,3}\s*\(\d{4}[a-z]?\)/.test(line) ||
    /^[A-Z][A-Za-z&'`\- ]+,\s*\d{4}\./.test(line)
  );
}

function collapseInternalWhitespace(block: string): string {
  return block.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksLikeCompleteCitationBlock(text: string): boolean {
  const normalized = collapseInternalWhitespace(text);
  if (normalized.length < 40 || normalized.length > MAX_BLOCK_LENGTH) {
    return false;
  }

  const startsLikeCitation =
    looksLikeCitationStart(normalized)
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

  return /(?:\.\s*$|:\s*[A-Za-z]?\d[\w-]*\s*$|\bpp?\.\s*[A-Za-z]?\d[\w-]*\s*\.\s*$)/i.test(normalized);
}

function materializeBlocks(blockTexts: string[], envelope: BatchEnvelope, hybridStrategy?: string): RawBlock[] {
  return blockTexts.map((text, index) => {
    const flags: RawBlockFlag[] = [];
    let splitMethod: RawBlock['splitMethod'] = methodForFormat(envelope.detectedFormat);
    let splitConfidence = confidenceForMethod(splitMethod);

    if (text.length < MIN_BLOCK_LENGTH) {
      flags.push('too_short');
    }

    if (text.length > MAX_BLOCK_LENGTH) {
      flags.push('too_long');
    }

    if (splitMethod === 'uncertain' || splitConfidence < 0.5) {
      flags.push('uncertain');
      splitMethod = 'uncertain';
      splitConfidence = Math.min(splitConfidence, 0.49);
    }

    const splitReason = hybridStrategy ?? splitMethodToReason(splitMethod);

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
      splitReason,
      blockFormat: envelope.detectedFormat,
    };
  });
}

function methodForFormat(detectedFormat: BatchEnvelope['detectedFormat']): RawBlock['splitMethod'] {
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

function buildCountAudit(
  inputEstimate: number,
  aggregatedCount: number,
  blocks: RawBlock[],
): CountAudit {
  return {
    inputEstimate,
    aggregatedCount,
    splitCount: blocks.length,
    delta: blocks.length - inputEstimate,
    needsActionCount: blocks.filter((block) => block.flags.length > 0).length,
    droppedCount: 0,
  };
}

function leadingWhitespace(line: string): number {
  const match = line.match(/^\s*/);
  return match?.[0].length ?? 0;
}

/* ─── Hybrid fallback splitter ──────────────────────────────── */

interface HybridSplitResult {
  blocks: string[];
  strategy: string;
  relativeScore: number;
  absoluteConsistency: number;
}

function hybridFallbackSplit(cleanedText: string): HybridSplitResult {
  const candidates = [
    { strategy: 'blank_line', blocks: splitByBlankLines(cleanedText) },
    { strategy: 'numbered', blocks: splitNumberedBlocks(cleanedText) },
    { strategy: 'hanging_indent', blocks: splitByHangingIndent(cleanedText) },
  ];

  const scored = candidates.map((candidate) => ({
    ...candidate,
    relativeScore: scoreSplitQuality(candidate.blocks),
    absoluteConsistency: scoreSplitQuality(candidate.blocks),
  }));

  scored.sort((a, b) => b.relativeScore - a.relativeScore);
  const winner = scored[0]!;

  return {
    blocks: winner.blocks,
    strategy: winner.strategy,
    relativeScore: winner.relativeScore,
    absoluteConsistency: winner.absoluteConsistency,
  };
}

function splitByBlankLines(cleanedText: string): string[] {
  return cleanedText
    .split(/\n\s*\n+/)
    .map((block) => collapseInternalWhitespace(block))
    .filter((block) => block.length > 0);
}

const CITATION_TERMINATOR = /(?:\(\d{4}[a-z]?\)|10\.\d{4,9}\/\S+|\d+[–-]\d+|\bpp?\.\s*\d+)\.?\s*$/;

export function scoreSplitQuality(blocks: string[]): number {
  if (blocks.length === 0) return 0;
  if (blocks.length === 1) {
    if (looksLikeCompleteCitationBlock(blocks[0]!)) return 0.92;
    const normalized = collapseInternalWhitespace(blocks[0]!);
    if (normalized.length >= 30 && /\b(?:19|20)\d{2}\b/.test(normalized)) return 0.6;
    return 0.3;
  }

  let score = 0;
  const lengths = blocks.map((b) => b.length);
  const mean = lengths.reduce((s, v) => s + v, 0) / lengths.length;
  const variance = lengths.reduce((s, v) => s + (v - mean) ** 2, 0) / lengths.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;

  if (cv < 0.5) score += 0.30;
  else if (cv < 0.8) score += 0.15;

  const terminatorFraction = blocks.filter((b) => CITATION_TERMINATOR.test(b)).length / blocks.length;
  score += terminatorFraction * 0.30;

  const tooShort = blocks.filter((b) => b.length < MIN_BLOCK_LENGTH).length;
  score -= (tooShort / blocks.length) * 0.20;

  const tooLong = blocks.filter((b) => b.length > 800).length;
  score -= (tooLong / blocks.length) * 0.20;

  const splitTokenArtifacts = blocks.filter((block) => /\b\p{L}{3,}-\s+\p{L}{2,}\b/u.test(block)).length;
  score -= (splitTokenArtifacts / blocks.length) * 0.25;

  if (blocks.length >= 2) score += 0.10;

  return Math.max(0, Math.min(1, score));
}

function computeSplitQualityFlag(absoluteConsistency: number, sampled: boolean): SplitQualityFlag {
  if (sampled) return 'sampled';
  return absoluteConsistency >= SPLIT_QUALITY_THRESHOLD ? 'ok' : 'low';
}

function splitMethodToReason(method: RawBlock['splitMethod']): string {
  switch (method) {
    case 'doi_list': return 'doi_line';
    case 'bibtex_entry': return 'bibtex_entry';
    case 'ris_entry': return 'ris_entry';
    case 'numbered': return 'number_marker';
    case 'blank_line': return 'blank_line';
    case 'hanging_indent': return 'hanging_indent';
    case 'doi_resolved': return 'doi_resolved';
    case 'ml_classifier': return 'ml_classifier';
    case 'uncertain': return 'uncertain';
  }
}

/* ─── Stage record helper ──────────────────────────────────── */

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
  stageIdOverride?: string,
): StageRunRecord {
  return {
    stageId: stageIdOverride ?? `phase2_${record.phaseId}`,
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}
