import { describe, expect, it } from 'vitest';
import { createPipelineContext } from '../pipeline/orchestrator.js';
import { phase10Health } from './phases/phase10Health.js';
import { phase12Render } from './phases/phase12Render.js';
import { fieldOf } from './types/field.js';
import { buildReferenceCarrier } from './utils/carriers.js';
import type { StyleDetectionResult } from './types/carrier.js';

function buildArticleCarrier() {
  const style: StyleDetectionResult = {
    primary: {
      style: 'unknown',
      confidence: 0.41,
    },
    secondary: null,
    family: 'unknown',
    familyConfidence: 0.41,
    styleConfidence: 0,
    familyMarginToRunnerUp: 0.02,
    styleMarginToRunnerUp: 0,
    certaintyTier: 'low',
    styleCandidates: [],
    signals: [],
    isUnknown: true,
    isMultiStyle: false,
  };

  const carrier = buildReferenceCarrier(
    {
      index: 0,
      text: 'Smith J Example study Journal of Examples 2020 12(3) 44-50',
      splitMethod: 'blank_line',
      splitConfidence: 0.95,
      isDoiResolved: false,
      flags: [],
    },
    style,
    undefined,
    'apa7',
  );

  carrier.type = {
    type: 'article-journal',
    confidence: 0.95,
    isUnknown: false,
  };
  carrier.fields.authors = fieldOf(
    [
      {
        family: 'Smith',
        given: 'J.',
        initials: 'J',
        isCorporate: false,
      },
    ],
    'ingestion',
    'phase_test',
    0.99,
  );
  carrier.fields.title = fieldOf('Example study', 'ingestion', 'phase_test', 0.99);
  carrier.fields.year = fieldOf(2020, 'ingestion', 'phase_test', 0.99);
  carrier.fields.journal = fieldOf('Journal of Examples', 'ingestion', 'phase_test', 0.99);
  carrier.fields.volume = fieldOf('12', 'ingestion', 'phase_test', 0.99);
  carrier.fields.issue = fieldOf('3', 'ingestion', 'phase_test', 0.99);
  carrier.fields.pages = fieldOf('44-50', 'ingestion', 'phase_test', 0.99);
  carrier.healthEvidence.validSpanFields = [
    'authors',
    'title',
    'year',
    'journal',
    'volume',
    'issue',
    'pages',
  ];

  return carrier;
}

describe('heuristics mode architecture', () => {
  it('keeps explicit guaranteed styles on the guaranteed path even when detection is unknown', async () => {
    const carrier = buildArticleCarrier();
    const ctx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        enrich: false,
        debug: true,
      },
    });

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.styleResolution.effectiveStyle).toBe('apa7');
    expect(carrier.styleResolution.effectiveDetectionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(carrier.scoring.breakdown.formatScoringPath).toBe('guaranteed');
    expect(carrier.health.warnings.some((warning) => warning.code === 'style_unknown')).toBe(false);
    expect(
      carrier.health.warnings.some((warning) => warning.code === 'input_style_uncertain'),
    ).toBe(true);
    expect(carrier.publicStatus).toBe('ready');
  });

  it('suppresses conflicted DOI links from rendered output', async () => {
    const carrier = buildArticleCarrier();
    const ctx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        enrich: false,
        debug: true,
      },
    });

    carrier.fields.doi = fieldOf('10.1000/conflicted-study', 'ingestion', 'phase_test', 0.99);
    carrier.doiVerification = {
      status: 'conflicted',
      reasons: ['DOI provider metadata mismatched on title.'],
    };

    await phase10Health.run([carrier], ctx);
    await phase12Render.run([carrier], ctx);

    expect(carrier.rendered.text).not.toContain('doi.org/');
    expect(carrier.health.warnings.some((warning) => warning.code === 'doi_conflicted')).toBe(true);
  });

  it('requires valid BIO span evidence for mandatory ML-extracted fields', async () => {
    const carrier = buildArticleCarrier();
    const ctx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        enrich: false,
        debug: true,
      },
    });

    carrier.fields.title = fieldOf('Example study', 'ml_extraction', 'phase4_extraction', 0.95);
    carrier.healthEvidence.validSpanFields = carrier.healthEvidence.validSpanFields.filter((field) => field !== 'title');
    carrier.extractionMeta = {
      modelVersion: 'bio-test-v1',
      featureVersion: 'plain-text-bio-v1',
      styleUsed: 'apa',
      overallConfidence: 0.9,
      fieldConfidences: { title: 0.95 },
      uncertainFields: [],
      runMode: 'ml',
      timestamp: new Date().toISOString(),
      bio: {
        tokens: ['Smith', 'Example', 'study'],
        labels: ['B-author', 'O', 'O'],
        offsets: [[0, 5], [6, 13], [14, 19]],
        labelConfidences: [0.9, 0.8, 0.8],
        entities: [],
        diagnostics: [],
        labelSchemaVersion: 'citation-bio-v1',
        featureVersion: 'plain-text-bio-v1',
        modelVersion: 'bio-test-v1',
      },
    };

    await phase10Health.run([carrier], ctx);

    expect(carrier.health.breakdown.missingMandatory).toContain('title');
    expect(carrier.health.warnings.some((warning) => warning.code === 'missing_required_ml_span')).toBe(true);
    expect(carrier.publicStatus).toBe('needs_action');
  });
});
