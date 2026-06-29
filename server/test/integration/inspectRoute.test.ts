import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { env } from '../../src/config.js';
import { phase1Ingest } from '../../src/engine/phases/phase1Ingest.js';
import { phase2Split } from '../../src/engine/phases/phase2Split.js';
import type { InspectResponse } from '../../src/engine/types/api.js';
import { createTestPipelineContext } from '../helpers/createPipelineContext.js';

describe('POST /v1/inspect', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    env.FEATURE_PDF_CLEANUP = false;
  });

  it('returns the same counts as the shared Phase 1 + Phase 2 logic', async () => {
    const request = {
      sourceType: 'text' as const,
      content: [
        '[1] Smith, J. (2020). Example article.',
        '    Journal of Examples, 12(3), 44-50.',
        '[2] Doe, A. (2021). Another article.',
        '    Example Review, 9(1), 1-10.',
      ].join('\n'),
    };

    const directCtx = createTestPipelineContext();
    const envelope = await phase1Ingest.run(request, directCtx);
    const direct = await phase2Split.run(envelope, directCtx);

    app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/inspect',
      payload: request,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as InspectResponse;

    expect(body.estimatedCount).toBe(envelope.estimatedCount);
    expect(body.aggregatedCount).toBe(direct.countAudit.aggregatedCount);
    expect(body.splitCount).toBe(direct.countAudit.splitCount);
    expect(body.needsActionCount).toBe(direct.countAudit.needsActionCount);
    expect(body.countAudit).toEqual(direct.countAudit);
    expect(body.detectedFormat).toBe(envelope.detectedFormat);
    expect(body.cleanup?.mode).toBe('off');
    expect(body.diagnostics?.map((entry) => entry.phaseId)).toEqual([
      'normalization',
      'ingestion',
      'block_aggregation',
      'splitting',
    ]);
  });

  it('exposes inspect-only cleanup diagnostics while keeping baseline blocks', async () => {
    env.FEATURE_PDF_CLEANUP = true;

    const request = {
      sourceType: 'text' as const,
      content: [
        '47',
        'Shannon, C. E. (1948). A Mathematic-',
        'al Theory of Communi-',
        'cation. Bell System Technical Journal, 27(3), 379-423.',
        '',
        '48',
        'Turing, A. M. (1950). Computing machinery and intelli-',
        'gence. Mind, 59(236), 433-460.',
      ].join('\n'),
    };

    const directCtx = createTestPipelineContext();
    directCtx.options = {
      ...directCtx.options,
      enablePdfCleanup: true,
      pdfCleanupMode: 'inspect_only',
    };
    const envelope = await phase1Ingest.run(request, directCtx);
    const direct = await phase2Split.run(envelope, directCtx);

    app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/inspect',
      payload: request,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as InspectResponse;

    expect(body.cleanup).toMatchObject({
      mode: 'inspect_only',
      lookedLikePdfCopy: true,
      candidateGenerated: true,
      wouldSelect: 'cleaned',
      finalUsed: 'baseline',
      decisionReason: 'quality_improved',
    });
    expect(body.splitCount).toBe(direct.countAudit.splitCount);
    expect(body.blocks?.[0]?.text).toContain('A Mathematic- al Theory');
    expect(body.diagnostics?.map((entry) => entry.phaseId)).toContain('pdf_cleanup_evaluation');
  });

  it('parses large pasted input above the old 500k character cap before route validation', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/inspect',
      payload: {
        sourceType: 'invalid-source',
        content: `${'A'.repeat(500_001)}\nSmith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.`,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('INPUT_VALIDATION_FAILED');
  });
});
