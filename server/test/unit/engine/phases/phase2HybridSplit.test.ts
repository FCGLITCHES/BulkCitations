import { describe, expect, it } from 'vitest';
import { phase1Ingest } from '../../../../src/engine/phases/phase1Ingest.js';
import { phase2Split } from '../../../../src/engine/phases/phase2Split.js';
import type { BatchEnvelope } from '../../../../src/engine/types/ingestion.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';

describe('phase2Split – hybrid fallback and split quality', () => {
  it('returns splitQualityFlag = ok for structured formats', async () => {
    const ingestCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
          '[2] Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
        ].join('\n'),
      },
      ingestCtx,
    );

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    expect(result.splitQualityFlag).toBe('ok');
  });

  it('uses hybrid fallback for plain_text format and returns quality flag', async () => {
    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'unstructured',
      detectedFormat: 'plain_text',
      formatConfidence: 0.45,
      estimatedCount: 3,
      hasDois: false,
      styleHints: [],
      rawText: [
        'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
        '',
        'Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
        '',
        'Brown, K. (2019). Third article. Science Today, 5(2), 12-18.',
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

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.splitQualityFlag).toBeDefined();
    expect(['ok', 'low', 'sampled']).toContain(result.splitQualityFlag);
  });

  it('uses hybrid fallback for unknown format', async () => {
    const envelope: BatchEnvelope = {
      pipelineMajor: 3,
      sourceType: 'text',
      structure: 'unknown',
      detectedFormat: 'unknown',
      formatConfidence: 0.2,
      estimatedCount: 1,
      hasDois: false,
      styleHints: [],
      rawText: [
        'Smith, J. (2020). Example article. Journal of Examples.',
        '',
        'Doe, A. (2021). Another article. Example Review.',
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

    expect(result.blocks.length).toBeGreaterThanOrEqual(1);
    expect(result.splitQualityFlag).toBeDefined();
  });

  it('populates splitReason on each block', async () => {
    const ingestCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Smith, J. (2020). Example article.',
          '[2] Doe, A. (2021). Another article.',
        ].join('\n'),
      },
      ingestCtx,
    );

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    for (const block of result.blocks) {
      expect(block.splitReason).toBeDefined();
      expect(block.splitReason!.length).toBeGreaterThan(0);
    }
  });

  it('populates blockFormat on each block', async () => {
    const ingestCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Smith, J. (2020). Example article.',
          '[2] Doe, A. (2021). Another article.',
        ].join('\n'),
      },
      ingestCtx,
    );

    const splitCtx = createTestPipelineContext();
    const result = await phase2Split.run(envelope, splitCtx);

    for (const block of result.blocks) {
      expect(block.blockFormat).toBe('numbered_list');
    }
  });

  it('logs split quality flag in stage telemetry', async () => {
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
    await phase2Split.run(envelope, splitCtx);

    const splitEntry = splitCtx.stageLog.find((e) => e.phaseId === 'splitting');
    expect(splitEntry?.details?.splitQualityFlag).toBeDefined();
  });
});
