import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStageConfig } from './config.js';
import { processV2Conversion } from './pipeline.js';
import { createSplitStage } from './stages/split.js';

function makeSplitContext(rawItems: string[], options?: { debug?: boolean; structure?: 'structured' | 'semi_structured' | 'unstructured' | 'unknown' }) {
  const debugEnabled = options?.debug ?? true;
  const structure = options?.structure ?? 'unstructured';

  return {
    request: {
      sourceType: 'text',
      content: rawItems.join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: debugEnabled,
    },
    jobId: 'split-test-job',
    receivedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    executionMode: 'sync',
    debugEnabled,
    rawItems,
    inputProfile: {
      structure,
      confidence: 0.92,
      inputType: 'plain_blob',
      estimatedCount: rawItems.length,
      hasDois: /10\.\d{4,}\//.test(rawItems.join('\n')),
      hasUrls: /https?:\/\//.test(rawItems.join('\n')),
      styleHints: [],
      signals: ['test_fixture'],
    },
    citations: [],
    duplicates: [],
    groups: {},
    pipelineLog: [],
    stageTimings: [],
    stagesRun: [],
    fallbacksUsed: [],
    partialResult: false,
    partialReasons: [],
    jobDebug: {},
    stageConfig: buildStageConfig(),
  } as any;
}

function longTitle(seed: string): string {
  return Array.from({ length: 80 }, (_, index) => `${seed} segment ${index + 1}`).join(' ');
}

describe('v2 split contamination handling', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_SPLIT_MODEL;
    vi.unstubAllGlobals();
  });

  it('strips header bleed with exact stripped-region logging while preserving the audit raw chunk', async () => {
    const raw = [
      '2023 Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17',
      '13. Cramer RD, Bunce JD, Patterson DE, Frank IE: Crossvalidation, bootstrapping, and partial least squares',
      'compared with multiple regression in conventional QSAR studies. Mol Inform. 1988, 7:18-25.',
      '10.1002/qsar.19880070105',
    ].join('\n');

    const result = await createSplitStage().run(makeSplitContext([raw]));

    expect(result.citations).toHaveLength(1);
    const citation = result.citations[0];
    const splitDebug = citation.stageDebug?.split as Record<string, any>;

    expect(citation.raw).toContain('Cureus 15(8): e44359');
    expect(citation.raw).toContain('10.1002/qsar.19880070105');
    expect(result.workingChunkByCitationId?.[citation.id]).toContain('10.1002/qsar.19880070105');
    expect(result.workingChunkByCitationId?.[citation.id]).not.toContain('Cureus 15(8): e44359');
    expect(splitDebug.cleanedChunk).toBe(result.workingChunkByCitationId?.[citation.id]);
    expect(splitDebug.strippedRegions).toEqual([
      expect.objectContaining({
        rule: 'header_bleed',
        rawText: '2023 Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17',
        startOffset: 0,
        startLine: 1,
        endLine: 1,
      }),
    ]);
  });

  it('reattaches DOI-only orphan lines before emitting citations', async () => {
    const raw = [
      '1. Smith J. Example title. Journal of Quality. 2020;10(2):11-19.',
      '10.1000/example-doi',
      '2. Brown A. Second title. Another Journal. 2021;11(3):21-30.',
    ].join('\n');

    const result = await createSplitStage().run(makeSplitContext([raw]));

    expect(result.citations).toHaveLength(2);
    const first = result.citations[0];
    const firstDebug = first.stageDebug?.split as Record<string, any>;

    expect(result.workingChunkByCitationId?.[first.id]).toContain('10.1000/example-doi');
    expect(firstDebug.repairActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'doi_reattached',
          rawText: '10.1000/example-doi',
        }),
      ]),
    );
    expect(firstDebug.contaminationFlags).not.toContain('doi_orphan');
    expect(result.citations.some((citation: any) => citation.raw.trim() === '10.1000/example-doi')).toBe(false);
  });

  it('marks residual multiline truncation after line-based repair opportunities are exhausted', async () => {
    const raw = [
      '12. Brown LD, Garcia-Lopez JF, van der Berg E,',
      '2024',
    ].join('\n');

    const result = await createSplitStage().run(makeSplitContext([raw]));

    expect(result.citations).toHaveLength(1);
    const splitDebug = result.citations[0].stageDebug?.split as Record<string, any>;
    expect(splitDebug.contaminationFlags).toContain('multiline_truncation_suspected');
  });

  it('uses deterministic secondary recovery on oversized multi-citation chunks before calling the LLM splitter', async () => {
    const raw = [
      `Smith, J. (2020). ${longTitle('alpha')}. Journal of Quality, 10(2), 11-19.`,
      `Brown, A. (2021). ${longTitle('beta')}. Journal of Testing, 11(3), 21-30.`,
    ].join(' ');

    const result = await createSplitStage().run(makeSplitContext([raw]));

    expect(result.citations).toHaveLength(2);
    expect(result.fallbacksUsed).not.toContain('split:llm');
    expect(result.citations[0].split?.reasons).toContain('secondary_boundary_recovery');
  });

  it('falls back to LLM re-splitting for suspected multi-citation blobs when deterministic recovery cannot separate them', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = 'https://example.test/v1';
    process.env.OPENAI_SPLIT_MODEL = 'gpt-4o-mini';

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify([
              'Smith J. Example title one. Journal of Quality. 2020;10(2):11-19.',
              'Brown A. Example title two. Another Journal. 2021;11(3):21-30.',
            ]),
          },
        },
      ],
    }), { status: 200 })) as any);

    const raw = Array.from({ length: 340 }, (_, index) => `Merged blob token ${index + 1}`).join(' ');
    const result = await createSplitStage().run(makeSplitContext([raw]));

    expect(result.citations).toHaveLength(2);
    expect(result.fallbacksUsed).toContain('split:llm');
    expect(result.citations[0].split?.method).toBe('llm');
  });

  it('keeps cleaned chunks internal while extraction and validation consume them', async () => {
    const raw = [
      '2023 Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17',
      '13. Cramer RD, Bunce JD, Patterson DE, Frank IE: Crossvalidation, bootstrapping, and partial least squares',
      'compared with multiple regression in conventional QSAR studies. Mol Inform. 1988, 7:18-25.',
      '10.1002/qsar.19880070105',
    ].join('\n');

    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: raw,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    expect(response.citations).toHaveLength(1);
    const citation = response.citations[0] as Record<string, any>;
    const splitDebug = response.debug?.citations[0]?.stages.split as Record<string, any>;

    expect(citation.raw).toContain('Cureus 15(8): e44359');
    expect('cleanedChunk' in citation).toBe(false);
    expect(splitDebug.cleanedChunk).not.toContain('Cureus 15(8): e44359');
    expect(citation.title.value ?? citation.journal.value ?? '').not.toContain('Cureus 15(8): e44359');
    expect(citation.doi.value).toBe('10.1002/qsar.19880070105');
  });

  it('preserves multiple contamination signals through validation and applies the global contamination cap', async () => {
    const raw = [
      '2023 Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17',
      `12. Brown LD, Garcia-Lopez JF, van der Berg E. ${longTitle('federated diagnostics')}. Journal of Quality. 2021;10(2):11-19.`,
    ].join('\n');

    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: raw,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    const citation = response.citations[0];
    const issueCodes = citation.validationIssues.map((issue) => issue.code);
    const splitDebug = response.debug?.citations[0]?.stages.split as Record<string, any>;
    const extractDebug = response.debug?.citations[0]?.stages.extract as Record<string, any>;

    expect(splitDebug.contaminationFlags).toEqual(
      expect.arrayContaining(['header_bleed_suspected', 'page_artifact_present']),
    );
    expect(issueCodes).toEqual(
      expect.arrayContaining(['header_bleed_confirmed', 'page_artifact_confirmed']),
    );
    expect(citation.quality?.flags).toEqual(
      expect.arrayContaining(['split_contamination_suspected', 'split_contamination_confirmed']),
    );
    expect(extractDebug.splitContaminationPenalty).toBeGreaterThan(0);
    expect(citation.quality?.overall).toBeLessThanOrEqual(0.74);
    expect(['A', 'B']).not.toContain(citation.quality?.grade);
  });
});
