import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../../../../src/engine/errors/codes.js';
import * as phase1Module from '../../../../src/engine/phases/phase1Ingest.js';
import { phase1Ingest } from '../../../../src/engine/phases/phase1Ingest.js';
import { phase2Split } from '../../../../src/engine/phases/phase2Split.js';
import type { BatchEnvelope } from '../../../../src/engine/types/ingestion.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';

describe('phase2Split', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('splits numbered multiline references without dropping continuation lines', async () => {
    const ingestCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Smith, J. (2020). Example article.',
          '    Journal of Examples, 12(3), 44-50.',
          '[2] Doe, A. (2021). Another article.',
          '    Example Review, 9(1), 1-10.',
        ].join('\n'),
      },
      ingestCtx,
    );

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]?.text).toContain('Journal of Examples');
    expect(result.blocks[0]?.splitMethod).toBe('numbered');
    expect(result.blocks[0]?.formatMeta).toMatchObject({
      sourceType: envelope.sourceType,
      structure: envelope.structure,
      detectedFormat: envelope.detectedFormat,
    });
    expect(result.countAudit.droppedCount).toBe(0);
    expect(result.countAudit.needsActionCount).toBe(0);
  });

  it('forces numbered splitting when numbered leads are strong even if detector confidence is low', async () => {
    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'unstructured',
      detectedFormat: 'plain_text',
      formatConfidence: 0.31,
      estimatedCount: 4,
      hasDois: true,
      styleHints: ['vancouver'],
      rawText: [
        '1. Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent',
        'advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59.',
        '10.1080/17460441.2021.1909567',
        '',
        '2. Paul D, Sanap G, Shenoy S, Kalyane D, Kalia K, Tekade RK: Artificial intelligence in drug discovery and',
        'development. Drug Discov Today. 2021, 26:80-93. 10.1016/j.drudis.2020.10.010',
        '',
        '3. Sapoval N, Aghazadeh A, Nute MG, et al.: Current progress and open challenges for applying deep learning',
        'across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7',
        '2023 Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17',
        '',
        '4. Kim H, Kim E, Lee I, Bae B, Park M, Nam H: Artificial intelligence in drug discovery: a comprehensive review',
        'of data-driven and machine learning approaches. Biotechnol Bioprocess Eng. 2020, 25:895-930.',
        '10.1007/s12257-020-0049-y',
      ].join('\n'),
      detectedDois: [
        '10.1080/17460441.2021.1909567',
        '10.1016/j.drudis.2020.10.010',
        '10.1038/s41467-022-29268-7',
        '10.7759/cureus.44359',
        '10.1007/s12257-020-0049-y',
      ],
      ingestionSignals: {
        isPdfExtracted: false,
        isDocxExtracted: false,
        hasLineNumbers: true,
        hasHangingIndents: false,
        hasBibTexEntries: false,
        hasRisEntries: false,
        numberedLineCount: 4,
        numberedLineRatio: 0.31,
      },
    };

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.blocks).toHaveLength(4);
    expect(result.blocks.every((block) => block.splitMethod === 'numbered')).toBe(true);
    expect(result.blocks[2]?.text).toContain('across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7');
    expect(result.blocks.some((block) => block.text.includes('15 of 17'))).toBe(false);
  });

  it('reconstructs hanging-indent batches into separate blocks', async () => {
    const ingestCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          'Smith, J. (2020). Example article.',
          '    Journal of Examples, 12(3), 44-50.',
          'Doe, A. (2021). Another article.',
          '    Example Review, 9(1), 1-10.',
        ].join('\n'),
      },
      ingestCtx,
    );

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.every((block) => block.splitMethod === 'hanging_indent')).toBe(true);
    expect(result.blocks[0]?.formatMeta?.detectedFormat).toBe(envelope.detectedFormat);
    expect(result.countAudit.aggregatedCount).toBe(2);
  });

  it('warns on count-audit drift and keeps droppedCount at zero', async () => {
    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'semi_structured',
      detectedFormat: 'blank_line',
      formatConfidence: 0.8,
      estimatedCount: 4,
      hasDois: false,
      styleHints: ['apa7'],
      rawText: [
        'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
        '',
        'Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
      ].join('\n'),
      detectedDois: [],
      ingestionSignals: {
        isPdfExtracted: false,
        isDocxExtracted: false,
        hasLineNumbers: false,
        hasHangingIndents: false,
        hasBibTexEntries: false,
        hasRisEntries: false,
      },
    };

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.countAudit.splitCount).toBe(2);
    expect(result.countAudit.delta).toBe(-2);
    expect(result.countAudit.droppedCount).toBe(0);
    expect(splitCtx.stageLog.at(-1)).toMatchObject({
      status: 'warning',
      code: ErrorCode.SPLIT_COUNT_AUDIT_DRIFT,
    });
  });

  it('surfaces short and long blocks as needs_action instead of dropping them', async () => {
    const ingestCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Short ref.',
          `[2] ${'A'.repeat(1305)}`,
        ].join('\n'),
      },
      ingestCtx,
    );

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]?.flags).toContain('too_short');
    expect(result.blocks[1]?.flags).toContain('too_long');
    expect(result.countAudit.needsActionCount).toBe(2);
    expect(result.countAudit.droppedCount).toBe(0);
  });

  it('selects the cleaned candidate only when PDF cleanup meaningfully improves split quality', async () => {
    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'semi_structured',
      detectedFormat: 'blank_line',
      formatConfidence: 0.72,
      estimatedCount: 2,
      hasDois: false,
      styleHints: [],
      rawText: [
        '47',
        'Shannon, C. E. (1948). A Mathematic-',
        'al Theory of Communi-',
        'cation. Bell System Technical Journal, 27(3), 379-423.',
        '',
        '48',
        'Turing, A. M. (1950). Computing machinery and intelli-',
        'gence. Mind, 59(236), 433-460.',
      ].join('\n'),
      detectedDois: [],
      ingestionSignals: {
        isPdfExtracted: false,
        isDocxExtracted: false,
        hasLineNumbers: true,
        hasHangingIndents: false,
        hasBibTexEntries: false,
        hasRisEntries: false,
      },
      cleanupMeta: {
        lookedLikePdfCopy: true,
        hints: ['fixed_eol_hyphens', 'stripped_pdf_artifacts', 'cleanup_candidate_generated'],
        candidateText: [
          'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
          '',
          'Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433-460.',
        ].join('\n'),
      },
    };

    const splitCtx = createTestPipelineContext();
    splitCtx.options.enablePdfCleanup = true;
    splitCtx.options.pdfCleanupMode = 'full';
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.cleanup.lookedLikePdfCopy).toBe(true);
    expect(result.cleanup.wouldSelect).toBe('cleaned');
    expect(result.cleanup.finalUsed).toBe('cleaned');
    expect(result.cleanup.decisionReason).toBe('quality_improved');
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]?.inputCleanup?.cleanupApplied).toBe(true);
  });

  it('keeps baseline blocks in inspect-only mode even when cleanup would win', async () => {
    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'semi_structured',
      detectedFormat: 'blank_line',
      formatConfidence: 0.72,
      estimatedCount: 2,
      hasDois: false,
      styleHints: [],
      rawText: [
        '47',
        'Shannon, C. E. (1948). A Mathematic-',
        'al Theory of Communi-',
        'cation. Bell System Technical Journal, 27(3), 379-423.',
        '',
        '48',
        'Turing, A. M. (1950). Computing machinery and intelli-',
        'gence. Mind, 59(236), 433-460.',
      ].join('\n'),
      detectedDois: [],
      ingestionSignals: {
        isPdfExtracted: false,
        isDocxExtracted: false,
        hasLineNumbers: true,
        hasHangingIndents: false,
        hasBibTexEntries: false,
        hasRisEntries: false,
      },
      cleanupMeta: {
        lookedLikePdfCopy: true,
        hints: ['fixed_eol_hyphens', 'stripped_pdf_artifacts', 'cleanup_candidate_generated'],
        candidateText: [
          'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
          '',
          'Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433-460.',
        ].join('\n'),
      },
    };

    const splitCtx = createTestPipelineContext();
    splitCtx.options.enablePdfCleanup = true;
    splitCtx.options.pdfCleanupMode = 'inspect_only';
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.cleanup.wouldSelect).toBe('cleaned');
    expect(result.cleanup.finalUsed).toBe('baseline');
    expect(result.blocks[0]?.inputCleanup?.cleanupApplied).toBe(false);
  });

  it('keeps baseline when cleanup changes format without meaningful quality gain', async () => {
    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'unstructured',
      detectedFormat: 'plain_text',
      formatConfidence: 0.45,
      estimatedCount: 2,
      hasDois: false,
      styleHints: [],
      rawText: [
        '[1] Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
        '[2] Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
      ].join('\n'),
      detectedDois: [],
      ingestionSignals: {
        isPdfExtracted: false,
        isDocxExtracted: false,
        hasLineNumbers: true,
        hasHangingIndents: false,
        hasBibTexEntries: false,
        hasRisEntries: false,
      },
      cleanupMeta: {
        lookedLikePdfCopy: true,
        hints: ['cleanup_candidate_generated'],
        candidateText: [
          '[1] Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
          ' [2] Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
        ].join('\n'),
      },
    };

    const splitCtx = createTestPipelineContext();
    splitCtx.options.enablePdfCleanup = true;
    splitCtx.options.pdfCleanupMode = 'full';
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.cleanup.finalUsed).toBe('baseline');
    expect(result.cleanup.decisionReason).toBe('format_change_without_quality_gain');
  });

  it('keeps baseline when cleaned block count diverges too far from baseline', async () => {
    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'semi_structured',
      detectedFormat: 'blank_line',
      formatConfidence: 0.8,
      estimatedCount: 2,
      hasDois: false,
      styleHints: ['apa7'],
      rawText: [
        'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
        '',
        'Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
      ].join('\n'),
      detectedDois: [],
      ingestionSignals: {
        isPdfExtracted: false,
        isDocxExtracted: false,
        hasLineNumbers: false,
        hasHangingIndents: false,
        hasBibTexEntries: false,
        hasRisEntries: false,
      },
      cleanupMeta: {
        lookedLikePdfCopy: true,
        hints: ['cleanup_candidate_generated'],
        candidateText: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
      },
    };

    const splitCtx = createTestPipelineContext();
    splitCtx.options.enablePdfCleanup = true;
    splitCtx.options.pdfCleanupMode = 'full';
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.cleanup.finalUsed).toBe('baseline');
    expect(result.cleanup.decisionReason).toBe('block_count_divergence');
  });

  it('falls back cleanly when cleanup generation throws', async () => {
    vi.spyOn(phase1Module, 'cleanupPdfArtifacts').mockImplementation(() => {
      throw new Error('boom');
    });

    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'unstructured',
      detectedFormat: 'plain_text',
      formatConfidence: 0.45,
      estimatedCount: 1,
      hasDois: false,
      styleHints: [],
      rawText: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
      detectedDois: [],
      ingestionSignals: {
        isPdfExtracted: false,
        isDocxExtracted: false,
        hasLineNumbers: false,
        hasHangingIndents: false,
        hasBibTexEntries: false,
        hasRisEntries: false,
      },
      cleanupMeta: {
        lookedLikePdfCopy: true,
        hints: [],
      },
    };

    const splitCtx = createTestPipelineContext();
    splitCtx.options.enablePdfCleanup = true;
    splitCtx.options.pdfCleanupMode = 'full';
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.cleanup.finalUsed).toBe('baseline');
    expect(result.cleanup.decisionReason).toBe('cleanup_error');
  });

  it('treats a single clear Vancouver-style citation as a confident block', async () => {
    const ingestCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: 'Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.',
      },
      ingestCtx,
    );

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.splitMethod).toBe('ml_classifier');
    expect(result.blocks[0]?.flags).not.toContain('uncertain');
    expect(result.splitQualityFlag).toBe('ok');
  });

  it('treats a single Cureus-derived numeric citation with colon-style authors as a confident block', async () => {
    const ingestCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: 'Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59. 10.1080/17460441.2021.1909567',
      },
      ingestCtx,
    );

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.splitMethod).toBe('ml_classifier');
    expect(result.blocks[0]?.flags).not.toContain('uncertain');
    expect(result.splitQualityFlag).toBe('ok');
  });
});
