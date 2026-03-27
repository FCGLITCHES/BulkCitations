import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStageConfig } from './config.js';
import { createSplitStage, SUSPECTED_MULTI_CITATION_CHARS } from './stages/split.js';
import { pdfCopyContinuousBlock } from './fixtures/pdfCopyFixtures.js';

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
    workingChunkByCitationId: {},
    splitArtifactsByCitationId: {},
    llmBudget: {
      maxCalls: 5,
      totalCalls: 0,
      splitCalls: 0,
      extractCalls: 0,
      capReached: false,
    },
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

  it('keeps pre-veto raw opener scores while vetoing wrapped author continuations', async () => {
    const result = await createSplitStage().run(makeSplitContext([pdfCopyContinuousBlock]));

    expect(result.citations).toHaveLength(8);
    const foxCitation = result.citations.find((citation) => citation.raw.includes('Fox, K. E.'));
    const splitDebug = foxCitation?.stageDebug?.split as Record<string, any>;
    const foxLead = splitDebug.contentLines.find((line: any) => line.text.includes('Fox, K. E.'));
    const kellyContinuation = splitDebug.contentLines.find((line: any) => line.text.includes('Kelly, E. L. (2022).'));

    expect(foxLead.rawOpenerScore).toBeGreaterThanOrEqual(0.35);
    expect(kellyContinuation.rawOpenerScore).toBeGreaterThan(0.58);
    expect(kellyContinuation.openerConfidence).toBe(0);
  });

  it('splits the verbatim PDF-copy block into separate citations and preserves uri tails inside the right candidate', async () => {
    const result = await createSplitStage().run(makeSplitContext([pdfCopyContinuousBlock]));

    expect(result.citations).toHaveLength(8);
    expect(result.workingChunkByCitationId).toEqual({});

    const first = result.citations[0];
    const second = result.citations[1];
    const firstSplit = result.splitArtifactsByCitationId[first.id];
    const secondSplit = result.splitArtifactsByCitationId[second.id];

    expect(first.raw).toContain('O ccupational Health Psychology');
    expect(second.raw).toContain('h ttps://doi.org/10.1080/02678373.2010.50680');
    expect(firstSplit.cleanedChunk).toContain('O ccupational Health Psychology');
    expect(secondSplit.cleanedChunk).toContain('h ttps://doi.org/10.1080/02678373.2010.50680');
    expect(secondSplit.repairActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'uri_tail_inline_attach' }),
      ]),
    );
  });

  it('forward-attaches leading uri tails when there is no previous citation candidate', async () => {
    const raw = [
      'https://doi.org/10.1016/j.example.2021.01.001',
      'Smith, J. (2022). Next reference. Journal of Quality, 10(2), 11-19.',
    ].join('\n');

    const result = await createSplitStage().run(makeSplitContext([raw]));
    expect(result.citations).toHaveLength(1);
    const splitDebug = result.citations[0].stageDebug?.split as Record<string, any>;
    expect(splitDebug.repairActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'uri_tail_forward_attach' }),
      ]),
    );
  });

  it('does not treat bare page-number lines as numeric citation markers', async () => {
    const raw = [
      '34.',
      'Smith, J. (2022). Next reference. Journal of Quality, 10(2), 11-19.',
    ].join('\n');

    const result = await createSplitStage().run(makeSplitContext([raw]));
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.raw).not.toContain('34.');
  });

  it('uses deterministic secondary recovery on oversized multi-citation chunks before calling the LLM splitter', async () => {
    const raw = [
      `Smith, J. (2020). ${longTitle('alpha')}. Journal of Quality, 10(2), 11-19.`,
      `Brown, A. (2021). ${longTitle('beta')}. Journal of Testing, 11(3), 21-30.`,
    ].join(' ');

    expect(normalizeWhitespace(raw).length).toBeGreaterThan(SUSPECTED_MULTI_CITATION_CHARS);
    const result = await createSplitStage().run(makeSplitContext([raw]));

    expect(result.citations).toHaveLength(2);
    expect(result.fallbacksUsed).not.toContain('split:llm');
    expect(result.citations[0].split?.reasons).toContain('secondary_boundary_recovery');
  });

  it('falls back to LLM re-splitting for oversized single-blob inputs when deterministic recovery cannot separate them', async () => {
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
});

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
