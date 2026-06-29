import { describe, expect, it } from 'vitest';
import { evaluateFieldSchema, getFieldSchema } from '../../../../src/engine/mandatory-fields.js';
import { phase7Normalize } from '../../../../src/engine/phases/phase7Normalize.js';
import { phase10Health } from '../../../../src/engine/phases/phase10Health.js';
import { toHealthWarning } from '../../../../src/engine/healthWarnings.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { runThroughPhase6 } from '../../../helpers/runSprint2Core.js';

const SHARED_OUTPUT_STYLES = [
  'apa7',
  'mla9',
  'chicago-author-date',
  'vancouver',
  'ieee',
  'harvard-ctr',
] as const;

describe('Phase10Health', () => {
  it('marks complete journal citations as ready with a strong score', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';

    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. https://doi.org/10.1000/example-study',
    );

    await phase7Normalize.run([carrier], ctx);
    await phase10Health.run([carrier], ctx);

    expect(carrier.type.type).toBe('article-journal');
    expect(carrier.publicStatus).toBe('ready');
    expect(carrier.health.breakdown.missingMandatory).toEqual([]);
    expect(carrier.scoring.breakdown.fieldEvidenceScore).toBeGreaterThan(0.8);
    expect(carrier.scoring.breakdown.structuralIntegrityScore).toBeGreaterThan(0.8);
  });

  it('marks missing mandatory fields as needs_action', async () => {
    const ctx = createTestPipelineContext();
    const { carrier } = await runThroughPhase6('Anonymous note about cells');

    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('needs_action');
    expect(carrier.health.breakdown.missingMandatory.length).toBeGreaterThan(0);
  });

  it('marks invalid mandatory fields as needs_action', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    carrier.fields.year.value = 3026;
    carrier.fields.year.confidence = 0.99;
    carrier.healthEvidence.validSpanFields.push('year');
    await phase7Normalize.run([carrier], ctx);
    carrier.fields.year.value = 3026;
    carrier.fields.year.confidence = 0.99;

    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('needs_action');
    expect(carrier.health.breakdown.invalidMandatory).toContain('year');
    expect(carrier.health.reasons).toContain('invalid year value');
  });

  it('marks low-confidence mandatory fields as needs_review when all required fields are present', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    carrier.fields.title.confidence = 0.55;
    carrier.fields.title.uncertain = true;
    await phase7Normalize.run([carrier], ctx);
    carrier.fields.title.confidence = 0.55;
    carrier.fields.title.uncertain = true;

    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('needs_review');
    expect(carrier.health.breakdown.lowConfidenceMandatory).toContain('title');
  });

  it('accepts structurally valid year and doi at heuristic confidence via validated thresholds', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. https://doi.org/10.1000/example-study',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.fields.year.confidence = 0.82;
    carrier.fields.doi.confidence = 0.82;
    carrier.fields.title.confidence = 0.82;

    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('ready');
    expect(carrier.health.breakdown.lowConfidenceMandatory).toEqual([]);
  });

  it('downgrades uncertain-split warnings from action to review for well-formed single citations', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.healthEvidence.warnings = [toHealthWarning('uncertain_split_block', 'split boundary remains uncertain')];

    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('needs_review');
    expect(carrier.health.reasons).toContain('split boundary remains uncertain');
  });

  it('scores DOI duplication in doi and DOI-form url as the 0.75 soft-duplicate exception', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. https://doi.org/10.1000/example-study',
    );

    await phase7Normalize.run([carrier], ctx);
    carrier.fields.doi.value = '10.1000/example-study';
    carrier.fields.url.value = 'https://doi.org/10.1000/example-study';

    await phase10Health.run([carrier], ctx);

    expect(carrier.scoring.breakdown.structuralSubscores.noDuplicateFieldsScore).toBe(0.75);
  });

  it('accepts articleNumber as satisfying the page locator requirement for journal citations', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3).',
    );

    carrier.fields.pages.value = null;
    carrier.fields.articleNumber.value = 'e100237';
    carrier.fields.articleNumber.confidence = 0.92;
    carrier.healthEvidence.validSpanFields.push('articleNumber');

    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('ready');
    expect(carrier.health.breakdown.missingMandatory).not.toContain('pages or articleNumber');
  });

  it('treats missing journal pages as preferred-only and surfaces an info warning', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    carrier.type = {
      type: 'article-journal',
      confidence: 0.95,
      isUnknown: false,
    };
    await phase7Normalize.run([carrier], ctx);
    carrier.fields.pages.value = null;

    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('ready');
    expect(carrier.health.breakdown.missingMandatory).toEqual([]);
    expect(carrier.health.warnings.some((warning) => warning.code === 'missing_preferred_fields')).toBe(true);
  });

  it('treats missing issue as preferred-only and surfaces it as an info warning', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    carrier.type = {
      type: 'article-journal',
      confidence: 0.95,
      isUnknown: false,
    };
    await phase7Normalize.run([carrier], ctx);
    carrier.fields.issue.value = null;
    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('ready');
    expect(carrier.health.breakdown.missingMandatory).toEqual([]);
    expect(carrier.health.warnings.some((warning) => warning.code === 'missing_preferred_fields')).toBe(true);
  });

  it('allows online-first journal articles with a DOI and no volume or pages', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. https://doi.org/10.1000/example-study',
    );

    carrier.type = {
      type: 'article-journal',
      confidence: 0.95,
      isUnknown: false,
    };
    carrier.fields.volume.value = null;
    carrier.fields.pages.value = null;
    carrier.fields.articleNumber.value = null;
    carrier.fields.doi.value = '10.1000/example-study';
    carrier.healthEvidence.validSpanFields.push('doi');

    await phase7Normalize.run([carrier], ctx);
    carrier.fields.volume.value = null;
    carrier.fields.pages.value = null;
    carrier.fields.articleNumber.value = null;
    carrier.fields.doi.value = '10.1000/example-study';

    await phase10Health.run([carrier], ctx);

    expect(carrier.publicStatus).toBe('ready');
    expect(carrier.health.breakdown.missingMandatory).toEqual([]);
  });

  for (const outputStyle of SHARED_OUTPUT_STYLES) {
    it(`keeps missing issue as informational only for ${outputStyle}`, async () => {
      const ctx = createTestPipelineContext();
      ctx.outputStyle = outputStyle;
      const { carrier } = await runThroughPhase6(
        'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
      );

      carrier.type = {
        type: 'article-journal',
        confidence: 0.95,
        isUnknown: false,
      };
      await phase7Normalize.run([carrier], ctx);
      carrier.fields.issue.value = null;

      await phase10Health.run([carrier], ctx);

      expect(carrier.publicStatus).toBe('ready');
      expect(carrier.health.breakdown.missingMandatory).toEqual([]);
      expect(carrier.health.warnings.some((warning) => warning.code === 'missing_preferred_fields')).toBe(true);
    });

    it(`keeps online-first journal articles ready for ${outputStyle}`, async () => {
      const ctx = createTestPipelineContext();
      ctx.outputStyle = outputStyle;
      const { carrier } = await runThroughPhase6(
        'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. https://doi.org/10.1000/example-study',
      );

      carrier.type = {
        type: 'article-journal',
        confidence: 0.95,
        isUnknown: false,
      };
      carrier.fields.volume.value = null;
      carrier.fields.pages.value = null;
      carrier.fields.articleNumber.value = null;
      carrier.fields.doi.value = '10.1000/example-study';
      carrier.healthEvidence.validSpanFields.push('doi');

      await phase7Normalize.run([carrier], ctx);
      carrier.fields.volume.value = null;
      carrier.fields.pages.value = null;
      carrier.fields.articleNumber.value = null;
      carrier.fields.doi.value = '10.1000/example-study';

      await phase10Health.run([carrier], ctx);

      expect(carrier.publicStatus).toBe('ready');
      expect(carrier.health.breakdown.missingMandatory).toEqual([]);
    });
  }

  it('uses the unknown schema when type confidence is below the existing floor', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6('Example report title.');

    carrier.type = {
      type: 'article-journal',
      confidence: 0.4,
      isUnknown: true,
    };
    carrier.fields.title.value = 'Example report title';
    carrier.fields.title.confidence = 0.95;
    carrier.healthEvidence.validSpanFields.push('title');

    await phase10Health.run([carrier], ctx);

    expect(carrier.health.breakdown.missingMandatory).not.toContain('journal');
    expect(carrier.health.breakdown.missingMandatory).not.toContain('volume');
  });

  it('blends completeness and confidence for field evidence instead of multiplying them', async () => {
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    await phase7Normalize.run([carrier], ctx);

    for (const field of ['authors', 'year', 'title', 'journal', 'volume', 'issue', 'pages'] as const) {
      carrier.fields[field].confidence = 0.85;
    }

    await phase10Health.run([carrier], ctx);

    const evaluation = evaluateFieldSchema(
      carrier.fields,
      getFieldSchema(carrier.type.type, ctx.outputStyle),
    );
    const mandatoryUnitCount = evaluation.effectiveSchema.mandatory.length
      + evaluation.effectiveSchema.requireOneOf.filter((group) => group.severity === 'mandatory').length;
    const preferredUnitCount = evaluation.effectiveSchema.preferred.length
      + evaluation.effectiveSchema.requireOneOf.filter((group) => group.severity === 'preferred').length;
    const expectedCompleteness = (
      mandatoryUnitCount
      + (evaluation.presentPreferred.length * 0.5)
    ) / (
      mandatoryUnitCount
      + (preferredUnitCount * 0.5)
    );

    expect(carrier.health.breakdown.missingMandatory).toEqual([]);
    expect(carrier.health.breakdown.invalidMandatory).toEqual([]);
    expect(carrier.scoring.breakdown.fieldEvidence.completeness).toBeCloseTo(expectedCompleteness, 6);
    expect(carrier.scoring.breakdown.fieldEvidence.avgMandatoryConfidence).toBeCloseTo(0.85, 6);
    expect(carrier.scoring.breakdown.fieldEvidenceScore).toBeCloseTo((expectedCompleteness + 0.85) / 2, 6);
  });
});
