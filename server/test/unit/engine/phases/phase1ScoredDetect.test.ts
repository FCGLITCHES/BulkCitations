import { describe, expect, it } from 'vitest';
import { phase1Ingest } from '../../../../src/engine/phases/phase1Ingest.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';

describe('phase1Ingest – scored detection', () => {
  it('runs legacy detection when feature flag is off', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = false;
    const result = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
          '[2] Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
        ].join('\n'),
      },
      ctx,
    );

    expect(result.detectedFormat).toBe('numbered_list');
    expect(result.detection).toBeUndefined();
  });

  it('produces a DetectionOutcome when feature flag is on', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
          '[2] Doe, A. (2021). Another article. Example Review, 9(1), 1-10.',
        ].join('\n'),
      },
      ctx,
    );

    expect(result.detection).toBeDefined();
    expect(result.detection!.method).toBe('scored');
    expect(result.detection!.chosen.format).toBe('numbered_list');
    expect(result.detection!.chosen.score).toBeGreaterThan(0);
    expect(result.detection!.chosen.evidence.length).toBeGreaterThan(0);
    expect(result.detection!.confidence).toBeGreaterThan(0);
    expect(result.detection!.effectiveConfidence).toBeGreaterThan(0);
    expect(result.detection!.sampled).toBe(false);
  });

  it('returns forced outcome for bib source type', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'bib',
        content: '@article{smith2020, title = {Example}}',
      },
      ctx,
    );

    expect(result.detection).toBeDefined();
    expect(result.detection!.method).toBe('forced');
    expect(result.detection!.chosen.format).toBe('bibtex');
    expect(result.detection!.confidence).toBe(1);
  });

  it('returns forced outcome for ris source type', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'ris',
        content: 'TY  - JOUR\nTI  - Example\nER  -',
      },
      ctx,
    );

    expect(result.detection!.method).toBe('forced');
    expect(result.detection!.chosen.format).toBe('ris');
  });

  it('returns forced outcome for doi_list source type', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'doi_list',
        content: '10.1000/alpha\n10.1000/beta',
      },
      ctx,
    );

    expect(result.detection!.method).toBe('forced');
    expect(result.detection!.chosen.format).toBe('doi_list');
  });

  it('scores DOI list format when all lines are DOIs', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: '10.1000/abc\n10.2000/def\n10.3000/ghi',
      },
      ctx,
    );

    expect(result.detection!.chosen.format).toBe('doi_list');
    expect(result.detection!.chosen.score).toBeGreaterThan(0.8);
  });

  it('disqualifies DOI list when any non-DOI line is present', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: '10.1000/abc\nNot a DOI\n10.3000/ghi',
      },
      ctx,
    );

    expect(result.detection!.chosen.format).not.toBe('doi_list');
  });

  it('detects RIS with high confidence for well-formed entries', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          'TY  - JOUR',
          'AU  - Smith, John',
          'TI  - Example Title',
          'PY  - 2020',
          'JO  - Example Journal',
          'ER  -',
        ].join('\n'),
      },
      ctx,
    );

    expect(result.detection!.chosen.format).toBe('ris');
    expect(result.detection!.chosen.score).toBeGreaterThan(0.5);
  });

  it('detects BibTeX with high confidence for well-formed entries', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '@article{smith2020,',
          '  author = {Smith, John},',
          '  title = {Example Title},',
          '  journal = {Example Journal},',
          '  year = {2020},',
          '}',
        ].join('\n'),
      },
      ctx,
    );

    expect(result.detection!.chosen.format).toBe('bibtex');
    expect(result.detection!.chosen.score).toBeGreaterThan(0.5);
  });

  it('logs detection telemetry comparing legacy and scored results', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    await phase1Ingest.run(
      {
        sourceType: 'text',
        content: [
          '[1] Smith, J. (2020). Example article. Journal of Examples.',
          '[2] Doe, A. (2021). Another article. Example Review.',
        ].join('\n'),
      },
      ctx,
    );

    const telemetryEntry = ctx.stageLog.find((entry) => entry.stageId.includes('detection_telemetry'));
    expect(telemetryEntry).toBeDefined();
    expect(telemetryEntry!.details).toHaveProperty('legacyFormat');
    expect(telemetryEntry!.details).toHaveProperty('scoredFormat');
    expect(telemetryEntry!.details).toHaveProperty('agreed');
    expect(telemetryEntry!.details).toHaveProperty('confidence');
  });

  it('scores plain text as low confidence fallback', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run(
      {
        sourceType: 'text',
        content: 'Just some random text that does not look like any citation format at all.',
      },
      ctx,
    );

    expect(result.detection!.chosen.score).toBeLessThan(0.5);
  });
});
