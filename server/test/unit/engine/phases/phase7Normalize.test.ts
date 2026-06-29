import { describe, expect, it } from 'vitest';
import { phase7Normalize } from '../../../../src/engine/phases/phase7Normalize.js';
import { fieldOf } from '../../../../src/engine/types/field.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { runThroughPhase6 } from '../../../helpers/runSprint2Core.js';

describe('phase7Normalize', () => {
  it('normalizes DOI, URL, pages, edition, and title whitespace with a schema audit trail', async () => {
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). AN EXAMPLE ARTICLE. Journal of Examples, 12(3), pp. 44--50. https://doi.org/10.1000/XYZ123',
    );

    carrier.fields.url.value = 'https: //example.org/resource.';
    carrier.fields.pages.value = 'pp. 44--50';
    carrier.fields.edition.value = 'second';

    const ctx = createTestPipelineContext();
    const [normalized] = await phase7Normalize.run([carrier], ctx);

    expect(normalized!.fields.doi.value).toBe('10.1000/xyz123');
    expect(normalized!.fields.url.value).toBe('https://example.org/resource');
    expect(normalized!.fields.pages.value).toBe('44-50');
    expect(normalized!.fields.edition.value).toBe('2nd ed.');
    expect(normalized!.fields.title.value).toBe('AN EXAMPLE ARTICLE');
    expect(normalized!.normalizationMeta?.appliedRules.length).toBeGreaterThan(0);
    expect(normalized!.normalizationMeta?.mandatoryFieldCheck).toMatchObject({
      referenceType: 'article-journal',
      schemaStyle: 'apa7',
      missingMandatory: [],
    });
    expect(normalized!.stageLog.at(-1)?.details).toMatchObject({
      missingMandatoryFields: [],
      missingMandatoryCount: 0,
    });
  });

  it('preserves trusted origin and confidence through normalization', async () => {
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). EXAMPLE ARTICLE. Journal of Examples, 12(3), 44-50.',
    );

    carrier.fields.title = fieldOf('EXAMPLE ARTICLE', 'enrichment_crossref', 'phase8_enrichment', 0.93);

    const ctx = createTestPipelineContext();
    const [normalized] = await phase7Normalize.run([carrier], ctx);

    expect(normalized!.fields.title.origin).toBe('authority');
    expect(normalized!.fields.title.confidence).toBe(1);
    expect(normalized!.fields.title.uncertain).toBe(false);
  });

  it('uses the requested output style when confirming mandatory fields', async () => {
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
    );

    carrier.fields.issue.value = null;

    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'vancouver';
    const [normalized] = await phase7Normalize.run([carrier], ctx);

    expect(normalized!.normalizationMeta?.mandatoryFieldCheck).toMatchObject({
      referenceType: 'article-journal',
      schemaStyle: 'vancouver',
    });
    expect(normalized!.normalizationMeta?.mandatoryFieldCheck?.missingMandatory).not.toContain('issue');
    expect(normalized!.stageLog.at(-1)?.status).toBe('success');
  });

  it('records missing preferred fields in normalization metadata and stage logs', async () => {
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
    );

    carrier.fields.pages.value = null;

    const ctx = createTestPipelineContext();
    const [normalized] = await phase7Normalize.run([carrier], ctx);

    expect(normalized!.normalizationMeta?.mandatoryFieldCheck?.missingMandatory).not.toContain('pages');
    expect(normalized!.stageLog.at(-1)).toMatchObject({
      phaseId: 'normalization',
      status: 'success',
      details: {
        missingMandatoryFields: [],
        missingMandatoryCount: 0,
      },
    });
  });

  it('can suppress the global normalization summary for fast-lane batch integration', async () => {
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). EXAMPLE ARTICLE. Journal of Examples, 12(3), pp. 44--50. https://doi.org/10.1000/XYZ123',
    );

    const ctx = createTestPipelineContext();
    const result = await phase7Normalize.apply([carrier], ctx, { suppressContextStageLog: true });

    expect(result.stats.carrierWarnings).toBeGreaterThanOrEqual(0);
    expect(ctx.stageLog).toHaveLength(0);
    expect(result.carriers[0]?.stageLog.at(-1)?.phaseId).toBe('normalization');
  });
});
