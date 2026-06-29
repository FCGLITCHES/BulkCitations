import { afterEach, describe, expect, it } from 'vitest';
import { createPipelineContext, runConvertPipeline } from '../../src/pipeline/orchestrator.js';
import {
  resetRuntimeStore,
  upsertApprovedTruthPayload,
} from '../../src/runtime/persistence.js';

describe('certified approved truth live overlays', () => {
  afterEach(async () => {
    await resetRuntimeStore();
  });

  it('applies a certified overlay output to the same reference in the live convert path', async () => {
    const rawText = 'Doe, J. Certified overlay source. Journal of Useful Tests. 2024;12(3):45-50.';
    const approvedRawText = `22. ${rawText} https://doi.org/10.1234/useful.tests.2024.45`;
    const approvedRenderedOutput = 'Doe, J. (2024). Certified approved overlay output. Journal of Useful Tests, 12(3), 45-50.';

    await upsertApprovedTruthPayload({
      rawText: approvedRawText,
      expectedFields: {
        authors: ['Doe, J.'],
        title: 'Certified overlay source',
        journal: 'Journal of Useful Tests',
        year: '2024',
        volume: '12',
        issue: '3',
        pages: '45-50',
        corrected_output: 'Non-overlay output should not be used.',
      },
      coreTruth: {
        authors: ['Doe, J.'],
        title: 'Certified overlay source',
        journal: 'Journal of Useful Tests',
        year: '2024',
        volume: '12',
        issue: '3',
        pages: '45-50',
      },
      overlayTruth: {
        title: 'Certified approved overlay output',
        corrected_output: approvedRenderedOutput,
      },
      expectedType: 'article-journal',
      expectedStyle: 'apa7',
      trustLevel: 'reviewed',
      rowStatus: 'reviewed',
      goldKind: 'overlay_accept',
      approvalSource: 'learning_queue',
      taskCertifications: [
        {
          task: 'overlay_learning',
          truthScope: 'overlay',
          status: 'certified',
          certifiedAt: new Date().toISOString(),
          certifiedBy: 'admin@example.com',
          requiredReviewPasses: 1,
          completedReviewPasses: 1,
          pass1Hash: null,
          pass2Hash: null,
        },
      ],
    });

    const ctx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_full',
      },
    });
    const { response } = await runConvertPipeline({
      sourceType: 'text',
      content: rawText,
      outputStyle: 'apa7',
    }, ctx);

    expect(response.references).toHaveLength(1);
    expect(response.references[0]?.renderedText).toBe(approvedRenderedOutput);
    expect(response.references[0]?.fields.title.value).toBe('Certified approved overlay output');
    expect(response.references[0]?.referenceType).toBe('article-journal');
    expect(response.diagnostics.some((entry) =>
      entry.message?.includes('certified approved truth overlay'),
    )).toBe(true);
  });
});
