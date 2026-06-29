import { describe, expect, it, vi } from 'vitest';
import { emptyField } from '../../../../src/engine/types/field.js';
import { Phase6_5LLMFallback, phase6_5LLMFallback } from '../../../../src/engine/phases/phase6_5LLMFallback.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { runThroughPhase6 } from '../../../helpers/runSprint2Core.js';

describe('phase6_5LLMFallback', () => {
  it('fills missing mandatory fields from the raw citation using overwrite guards', async () => {
    const { carrier } = await runThroughPhase6(
      'World Health Organization. (2022). Health update. https://example.org/update Accessed January 1, 2024.',
    );

    carrier.fields.url = emptyField('test_url_missing');
    carrier.fields.accessedDate = emptyField('test_access_missing');

    const ctx = createTestPipelineContext();
    const [repaired] = await phase6_5LLMFallback.run([carrier], ctx);

    expect(repaired!.fields.url.value).toBe('https://example.org/update');
    expect(repaired!.fields.accessedDate.value).toContain('January 1, 2024');
    expect(repaired!.stageLog.at(-1)?.phaseId).toBe('llm_fallback');
  });

  it('re-checks referenceType after repairs when standard flow type was unknown', async () => {
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
    );

    carrier.type = { type: 'unknown', confidence: 0.4, isUnknown: true };
    carrier.fields.journal = emptyField('test_journal_missing');
    carrier.fields.volume = emptyField('test_volume_missing');

    const repairer = async () => ({
      referenceConfidence: 0.9,
      source: 'heuristic' as const,
      fields: {
        journal: 'Journal of Examples',
        volume: '12',
      },
    });

    const phase = new Phase6_5LLMFallback(repairer);
    const ctx = createTestPipelineContext();
    ctx.tenantContext.tier = 'pro';
    const [repaired] = await phase.run([carrier], ctx);

    expect(repaired?.type.type).toBe('article-journal');
    expect(repaired?.type.isUnknown).toBe(false);
  });

  it('ignores unsupported repair keys instead of crashing the conversion', async () => {
    const { carrier } = await runThroughPhase6(
      'World Health Organization. (2022). Health update. https://example.org/update Accessed January 1, 2024.',
    );

    carrier.fields.url = emptyField('test_url_missing');

    const repairer = async () => ({
      referenceConfidence: 0.91,
      source: 'llm' as const,
      fields: {
        source: 'hallucinated_key_from_model',
        url: 'https://example.org/update',
      } as Record<string, unknown>,
    });

    const phase = new Phase6_5LLMFallback(repairer);
    const ctx = createTestPipelineContext();
    ctx.tenantContext.tier = 'pro';
    const [repaired] = await phase.run([carrier], ctx);

    expect(repaired?.fields.url.value).toBe('https://example.org/update');
    expect(repaired?.stageLog.at(-1)?.phaseId).toBe('llm_fallback');
  });

  it('does not trigger fallback repair solely because detected input style is unknown when output style is explicit', async () => {
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
    );

    carrier.styleResolution = {
      ...carrier.styleResolution,
      requestedStyle: 'apa7',
      effectiveStyle: 'apa7',
      effectiveStyleSource: 'requested',
      effectiveStyleKnown: true,
      inputStyleUncertain: true,
    };

    const repairer = async () => ({
      referenceConfidence: 0.91,
      source: 'heuristic' as const,
      fields: {
        title: 'Should not be applied',
      },
    });

    const phase = new Phase6_5LLMFallback(repairer);
    const ctx = createTestPipelineContext();
    ctx.outputStyle = 'apa7';
    const [repaired] = await phase.run([carrier], ctx);

    expect(repaired?.fields.title.value).toBe('Example article');
    expect(repaired?.stageLog.some((entry) => entry.phaseId === 'llm_fallback')).toBe(false);
  });

  it('forces heuristic-only repair for free tier even when a hosted repairer is configured', async () => {
    const { carrier } = await runThroughPhase6(
      'World Health Organization. (2022). Health update. https://example.org/update Accessed January 1, 2024.',
    );

    carrier.fields.url = emptyField('test_url_missing');

    const repairer = vi.fn(async () => ({
      referenceConfidence: 0.95,
      source: 'llm' as const,
      fields: {
        url: 'https://wrong.example.org/should-not-apply',
      },
    }));

    const phase = new Phase6_5LLMFallback(repairer);
    const ctx = createTestPipelineContext();
    ctx.tenantContext.tier = 'free';
    const [repaired] = await phase.run([carrier], ctx);

    expect(repairer).not.toHaveBeenCalled();
    expect(repaired?.fields.url.value).toBe('https://example.org/update');
  });
});
