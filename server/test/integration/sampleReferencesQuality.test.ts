import { describe, expect, it } from 'vitest';
import { createPipelineContext, runConvertPipeline } from '../../src/pipeline/orchestrator.js';
import type { ExtractBatchResponse, MLHealthResponse } from '../../src/ml/client.js';
import type {
  Phase4ExtractAttempt,
  Phase4MetricsSnapshot,
  Phase4MlRuntimeLike,
  Phase4RequestMode,
} from '../../src/ml/phase4Runtime.js';
import {
  SAMPLE_MIXED_REFERENCES_EXPECTATIONS,
  SAMPLE_MIXED_REFERENCES_INPUT,
} from '../fixtures/sampleMixedReferences.js';

describe('sample mixed references quality', () => {
  it('parses the frontend sample references into stable structured citations', async () => {
    const ctx = createPipelineContext({ outputStyle: 'apa7' });
    const { response } = await runConvertPipeline({
      sourceType: 'text',
      content: SAMPLE_MIXED_REFERENCES_INPUT,
      outputStyle: 'apa7',
    }, ctx);

    expect(response.references).toHaveLength(SAMPLE_MIXED_REFERENCES_EXPECTATIONS.length);
    expect(response.countAudit.droppedCount).toBe(0);

    for (const [index, expected] of SAMPLE_MIXED_REFERENCES_EXPECTATIONS.entries()) {
      const citation = response.references[index];

      expect(citation, `missing citation at index ${index}`).toBeDefined();
      expect(citation?.fields.title.value, `title mismatch at index ${index}`)
        .toSatisfy((value: unknown) => normalized(value) === normalized(expected.title));
      expect(citation?.referenceType, `type mismatch at index ${index}`).toBe(expected.type);
      expect(citation?.fields.authors.value.length, `author count mismatch at index ${index}`)
        .toBe(expected.authorCount);
      expect(citation?.fields.year.value, `year mismatch at index ${index}`).toBe(expected.year);

      if (expected.journal) {
        expect(citation?.fields.journal.value, `journal mismatch at index ${index}`)
          .toSatisfy((value: unknown) => normalized(value) === normalized(expected.journal));
      }

      if (expected.conferenceTitle) {
        expect(citation?.fields.conferenceTitle.value, `conference title mismatch at index ${index}`)
          .toSatisfy((value: unknown) => normalized(value).includes(normalized(expected.conferenceTitle)));
      }

      if (expected.volume) {
        expect(citation?.fields.volume.value, `volume mismatch at index ${index}`).toBe(expected.volume);
      }

      if (expected.issue) {
        expect(citation?.fields.issue.value, `issue mismatch at index ${index}`).toBe(expected.issue);
      }

      if (expected.pages) {
        expect(citation?.fields.pages.value, `pages mismatch at index ${index}`)
          .toSatisfy((value: unknown) => normalizedPages(value) === normalizedPages(expected.pages));
      }

      for (const fragment of expected.renderedIncludes) {
        expect(citation?.renderedText, `rendered output mismatch at index ${index}`)
          .toSatisfy((value: unknown) => normalized(value).includes(normalized(fragment)));
      }

      expect(citation?.renderedText, `legacy italic markers should not appear at index ${index}`)
        .not.toMatch(/(^|[\s(])_[^_]+_(?=[\s,.;:)])/);
    }
  });

  it('does not let an empty primary ML author prediction erase heuristic Vancouver authors', async () => {
    const previousIsolatedRuntime = process.env.BULKREFERENCES_ISOLATED_RUNTIME;
    const previousMode = process.env.ML_PHASE4_MODE;
    const previousPrimaryFraction = process.env.ML_PHASE4_PRIMARY_FRACTION;
    process.env.BULKREFERENCES_ISOLATED_RUNTIME = 'true';
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';

    try {
      const ctx = createPipelineContext({ outputStyle: 'apa7' });
      const { response } = await runConvertPipeline({
        sourceType: 'text',
        content: 'Rajkomar A, Dean J, Kohane I. Machine learning in medicine. New England Journal of Medicine. 2019;380(14):1347-1358.',
        outputStyle: 'apa7',
      }, ctx, {
        phase4Runtime: new EmptyAuthorPrimaryRuntime(),
      });

      expect(response.references).toHaveLength(1);
      expect(response.references[0]?.fields.authors.value).toEqual([
        expect.objectContaining({ family: 'Rajkomar', given: 'A' }),
        expect.objectContaining({ family: 'Dean', given: 'J' }),
        expect.objectContaining({ family: 'Kohane', given: 'I' }),
      ]);
      expect(response.references[0]?.renderedText).not.toContain('Unknown author');
      expect(response.references[0]?.publicStatus).toBe('ready');
    } finally {
      restoreEnv('BULKREFERENCES_ISOLATED_RUNTIME', previousIsolatedRuntime);
      restoreEnv('ML_PHASE4_MODE', previousMode);
      restoreEnv('ML_PHASE4_PRIMARY_FRACTION', previousPrimaryFraction);
    }
  });

  it('does not let malformed primary ML BIO spans erase heuristic authors', async () => {
    const previousIsolatedRuntime = process.env.BULKREFERENCES_ISOLATED_RUNTIME;
    const previousMode = process.env.ML_PHASE4_MODE;
    const previousPrimaryFraction = process.env.ML_PHASE4_PRIMARY_FRACTION;
    process.env.BULKREFERENCES_ISOLATED_RUNTIME = 'true';
    process.env.ML_PHASE4_MODE = 'primary';
    process.env.ML_PHASE4_PRIMARY_FRACTION = '1';

    try {
      const ctx = createPipelineContext({ outputStyle: 'apa7' });
      const { response } = await runConvertPipeline({
        sourceType: 'text',
        content: 'Rajkomar A, Dean J, Kohane I. Machine learning in medicine. New England Journal of Medicine. 2019;380(14):1347-1358.',
        outputStyle: 'apa7',
      }, ctx, {
        phase4Runtime: new MalformedBioAuthorPrimaryRuntime(),
      });

      expect(response.references).toHaveLength(1);
      expect(response.references[0]?.fields.authors.value).toEqual([
        expect.objectContaining({ family: 'Rajkomar', given: 'A' }),
        expect.objectContaining({ family: 'Dean', given: 'J' }),
        expect.objectContaining({ family: 'Kohane', given: 'I' }),
      ]);
      expect(response.references[0]?.publicStatus).toBe('ready');
      expect(response.references[0]?.extractionMeta?.runMode).toBe('heuristic');
      expect(response.references[0]?.extractionMeta?.bio?.diagnostics)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'unclosed_bio_sequence' }),
        ]));
    } finally {
      restoreEnv('BULKREFERENCES_ISOLATED_RUNTIME', previousIsolatedRuntime);
      restoreEnv('ML_PHASE4_MODE', previousMode);
      restoreEnv('ML_PHASE4_PRIMARY_FRACTION', previousPrimaryFraction);
    }
  });
});

class EmptyAuthorPrimaryRuntime implements Phase4MlRuntimeLike {
  getCachedHealth(): MLHealthResponse {
    return healthOk();
  }

  async refreshHealth(): Promise<MLHealthResponse> {
    return healthOk();
  }

  async extract(
    mode: Phase4RequestMode,
    texts: string[],
    styles: string[],
  ): Promise<Phase4ExtractAttempt> {
    const response: ExtractBatchResponse = {
      results: texts.map((_, index) => ({
        fields: { authors: [] },
        fieldConfidences: { authors: 0.99 },
        overallConfidence: 0.99,
        modelVersion: 'test-empty-author-primary',
        featureVersion: 'test',
        styleUsed: styles[index] ?? 'vancouver',
        uncertainFields: [],
      })),
    };
    return {
      mode,
      outcome: 'success',
      health: healthOk(),
      attempted: true,
      response,
    };
  }

  recordFallback(_reason: string): void {
    // Test runtime does not need metrics side effects.
  }

  recordShadowDrop(_reason: string): void {
    // Test runtime does not need metrics side effects.
  }

  getMetricsSnapshot(): Phase4MetricsSnapshot {
    return {
      requestsTotal: {},
      latencyMs: {},
      fallbacksTotal: {},
      shadowDropsTotal: {},
      breakerState: 'closed',
      queueDepth: 0,
    };
  }
}

class MalformedBioAuthorPrimaryRuntime implements Phase4MlRuntimeLike {
  getCachedHealth(): MLHealthResponse {
    return healthOk();
  }

  async refreshHealth(): Promise<MLHealthResponse> {
    return healthOk();
  }

  async extract(
    mode: Phase4RequestMode,
    texts: string[],
    styles: string[],
  ): Promise<Phase4ExtractAttempt> {
    const response: ExtractBatchResponse = {
      results: texts.map((text, index) => ({
        fields: { authors: ',' },
        fieldConfidences: { authors: 0.99 },
        overallConfidence: 0.99,
        modelVersion: 'test-malformed-bio-primary',
        featureVersion: 'test',
        styleUsed: styles[index] ?? 'vancouver',
        uncertainFields: [],
        entities: [{
          field: 'authors',
          tokenStart: 1,
          tokenEnd: 2,
          text: ',',
          confidence: 0.99,
          valid: true,
        }],
        bio: {
          tokens: ['Rajkomar', ',', 'Dean', 'J', '.', 'Machine'],
          labels: ['I-author', 'I-author', 'I-author', 'I-author', 'O', 'O'],
          offsets: [[0, 8], [9, 10], [11, 15], [16, 17], [17, 18], [19, 26]],
          labelConfidences: [0.99, 0.99, 0.99, 0.99, 0.8, 0.8],
          entities: [{
            label: 'author',
            field: 'authors',
            tokenStart: 1,
            tokenEnd: 2,
            charStart: text.indexOf(','),
            charEnd: text.indexOf(',') + 1,
            text: ',',
            confidence: 0.99,
            valid: true,
          }],
          diagnostics: [{
            code: 'unclosed_bio_sequence',
            severity: 'review',
            label: 'I-author',
            field: 'authors',
            tokenIndex: 0,
            message: 'BIO author span started with an inside label.',
          }],
          labelSchemaVersion: 'citation-bio-v1',
          featureVersion: 'test',
          modelVersion: 'test-malformed-bio-primary',
        },
      })),
    };
    return {
      mode,
      outcome: 'success',
      health: healthOk(),
      attempted: true,
      response,
    };
  }

  recordFallback(_reason: string): void {
    // Test runtime does not need metrics side effects.
  }

  recordShadowDrop(_reason: string): void {
    // Test runtime does not need metrics side effects.
  }

  getMetricsSnapshot(): Phase4MetricsSnapshot {
    return {
      requestsTotal: {},
      latencyMs: {},
      fallbacksTotal: {},
      shadowDropsTotal: {},
      breakerState: 'closed',
      queueDepth: 0,
    };
  }
}

function healthOk(): MLHealthResponse {
  return {
    status: 'ok',
    activeModelVersion: 'test-empty-author-primary',
    featureVersion: 'test',
    artifactsReady: true,
    lastSuccessfulInferenceAt: '2026-04-24T00:00:00.000Z',
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function normalized(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[_".,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedPages(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[–—]/g, '-').replace(/\s+/g, '').trim();
}
