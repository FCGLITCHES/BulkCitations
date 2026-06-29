import { describe, expect, it } from 'vitest';
import { phase7Normalize } from '../../../../src/engine/phases/phase7Normalize.js';
import { Phase8Enrich } from '../../../../src/engine/phases/phase8Enrich.js';
import { fieldOf } from '../../../../src/engine/types/field.js';
import { hasFieldValue } from '../../../../src/engine/utils/fields.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';
import { runThroughPhase6 } from '../../../helpers/runSprint2Core.js';

describe('Phase8Enrich', () => {
  it('fills or overwrites model fields when provider confidence is higher', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). rough title. Journal of Examples, 12(3), 44-50. doi:10.1000/smith-2020-better-title-study',
    );

    carrier.fields.title = fieldOf('rough title', 'ml_extraction', 'phase4_extraction', 0.6);
    await phase7Normalize.run([carrier], ctx);

    const phase = new Phase8Enrich(
      {
        lookup: async () => ({
          confidence: 0.92,
          fields: {
            title: 'Better Title Study',
            url: 'https://doi.org/10.1000/smith-2020-better-title-study',
          },
        }),
        resolveDoi: async () => null,
      },
      {
        lookup: async () => null,
      },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    expect(carrier.fields.title.value).toBe('Better Title Study');
    expect(carrier.fields.title.source).toBe('enrichment_crossref');
    expect(carrier.fields.title.origin).toBe('authority');
    expect(carrier.fields.title.confidence).toBe(1);
    expect(carrier.fields.title.previousValue).toBe('rough title');
    expect(carrier.enrichment.fieldsOverwritten).toContain('title');
  });

  it('recovers an OCR-corrupted DOI for provider lookup (only the confirmed record is applied)', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    // The DOI "10.1000/ocrtest-2020" is OCR-mangled to "1O.lOOO/ocrtest-2020"
    // (1->l, 0->O in the registrant) so the DOI regex cannot see it.
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). rough title. Journal of Examples, 12(3), 44-50. 1O.lOOO/ocrtest-2020',
    );
    carrier.fields.title = fieldOf('rough title', 'ml_extraction', 'phase4_extraction', 0.6);
    await phase7Normalize.run([carrier], ctx);

    // The OCR-tolerant extractor now recovers the mangled DOI to its clean form, but marks it
    // low-confidence (the suffix is kept verbatim and may carry OCR damage) so it sits below
    // the enrichment-overwrite threshold and a provider record can still confirm/override it.
    expect(hasFieldValue(carrier.fields.doi)).toBe(true);
    expect(carrier.fields.doi.value).toBe('10.1000/ocrtest-2020');
    expect(carrier.fields.doi.confidence).toBeLessThan(0.85);

    let lookedUpDoi: string | undefined;
    const phase = new Phase8Enrich(
      {
        lookup: async (fields) => {
          lookedUpDoi = typeof fields.doi.value === 'string' ? fields.doi.value : undefined;
          // Respond ONLY to the recovered (clean) DOI, proving it drove the lookup.
          if (lookedUpDoi !== '10.1000/ocrtest-2020') return null;
          return { confidence: 0.95, fields: { title: 'Recovered Canonical Title' } };
        },
        resolveDoi: async () => null,
      },
      { lookup: async () => null },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    expect(lookedUpDoi).toBe('10.1000/ocrtest-2020');
    expect(carrier.fields.title.value).toBe('Recovered Canonical Title');
    expect(carrier.fields.title.source).toBe('enrichment_crossref');
  });

  it('upgrades origin when provider confirms an existing heuristic field value', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50. doi:10.1000/example-study',
    );

    carrier.fields.title = fieldOf('Example study', 'regex_fallback', 'phase4_extraction', 0.82);
    carrier.fields.doi = fieldOf('10.1000/example-study', 'regex_fallback', 'phase4_extraction', 0.82);
    await phase7Normalize.run([carrier], ctx);

    const phase = new Phase8Enrich(
      {
        lookup: async () => ({
          confidence: 0.94,
          fields: {
            title: 'Example study',
            doi: '10.1000/example-study',
          },
        }),
        resolveDoi: async () => null,
      },
      {
        lookup: async () => null,
      },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    expect(carrier.fields.title.origin).toBe('authority');
    expect(carrier.fields.title.source).toBe('enrichment_crossref');
    expect(carrier.fields.doi.origin).toBe('authority');
    expect(carrier.enrichment.fieldsEnriched).toEqual(expect.arrayContaining(['title', 'doi']));
  });

  it('never overwrites admin confirmed fields', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Locked title. Journal of Examples, 12(3), 44-50.',
    );

    carrier.fields.title = fieldOf('Locked title', 'admin_confirmed', 'admin_review', 0.99);

    const phase = new Phase8Enrich(
      {
        lookup: async () => ({
          confidence: 0.95,
          fields: {
            title: 'Unlocked title',
          },
        }),
        resolveDoi: async () => null,
      },
      {
        lookup: async () => null,
      },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    expect(carrier.fields.title.value).toBe('Locked title');
    expect(carrier.fields.title.source).toBe('admin_confirmed');
    expect(carrier.fields.title.origin).toBe('admin');
    expect(carrier.fields.title.confidence).toBe(1);
  });

  it('does not inject DOI-style authority fields from low-confidence title matches when the citation had no DOI', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    const { carrier } = await runThroughPhase6(
      'Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.',
    );

    await phase7Normalize.run([carrier], ctx);

    const phase = new Phase8Enrich(
      {
        lookup: async () => ({
          confidence: 0.8,
          fields: {
            doi: '10.1201/9781315389325-7',
            url: 'https://doi.org/10.1201/9781315389325-7',
            publisher: 'CRC Press',
          },
        }),
        resolveDoi: async () => null,
      },
      {
        lookup: async () => null,
      },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    expect(carrier.fields.doi.value).toBeNull();
    expect(carrier.fields.url.value).toBeNull();
    expect(carrier.fields.publisher.value).toBeNull();
  });

  it('does not backfill conference papers with a journal from low-confidence title search hits', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    const { carrier } = await runThroughPhase6(
      'Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In 2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.',
    );

    await phase7Normalize.run([carrier], ctx);

    const phase = new Phase8Enrich(
      {
        lookup: async () => ({
          confidence: 0.8,
          fields: {
            journal: 'Machine Learning and the Internet of Medical Things in Healthcare',
          },
        }),
        resolveDoi: async () => null,
      },
      {
        lookup: async () => null,
      },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    expect(carrier.type.type).toBe('conference-paper');
    expect(carrier.fields.conferenceTitle.value).toBe('Second International Conference on Electronics, Communication and Aerospace Technology (ICECA)');
    expect(carrier.fields.journal.value).toBeNull();
  });

  it('withholds a conflicting provider match instead of fabricating fields, and flags it for review', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    const { carrier } = await runThroughPhase6(
      'Vaswani A, Shazeer N. Attention is all you need. 1999.',
    );

    // Scrambled input: a real title bolted onto a wrong year, with no anchoring DOI.
    carrier.fields.title = fieldOf('Attention is all you need', 'regex_fallback', 'phase4_extraction', 0.7);
    carrier.fields.year = fieldOf(1999, 'regex_fallback', 'phase4_extraction', 0.7);
    await phase7Normalize.run([carrier], ctx);
    expect(hasFieldValue(carrier.fields.doi)).toBe(false);

    const phase = new Phase8Enrich(
      {
        // Title-search hit (confidence < 0.9) for the REAL work: same title, but 2017 not 1999.
        lookup: async () => ({
          confidence: 0.8,
          fields: {
            title: 'Attention is all you need',
            year: 2017,
            journal: 'Advances in Neural Information Processing Systems',
          },
        }),
        resolveDoi: async () => null,
      },
      { lookup: async () => null },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    // The record was withheld wholesale — the empty journal was NOT populated from a record
    // that belongs to a different-year work, and the wrong year was left intact for review.
    expect(carrier.fields.journal.value).toBeNull();
    expect(carrier.fields.year.value).toBe(1999);
    expect(carrier.enrichment.mismatch?.provider).toBe('crossref');
    expect(carrier.enrichment.mismatch?.reasons.join(' ')).toMatch(/year/i);
  });

  it('still applies a non-conflicting low-confidence title match (the guard does not over-block)', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    const { carrier } = await runThroughPhase6(
      'Vaswani A, Shazeer N. Attention is all you need. 2017.',
    );

    carrier.fields.title = fieldOf('Attention is all you need', 'regex_fallback', 'phase4_extraction', 0.7);
    carrier.fields.year = fieldOf(2017, 'regex_fallback', 'phase4_extraction', 0.7);
    await phase7Normalize.run([carrier], ctx);

    const phase = new Phase8Enrich(
      {
        lookup: async () => ({
          confidence: 0.8,
          fields: {
            title: 'Attention is all you need',
            year: 2017,
            journal: 'Advances in Neural Information Processing Systems',
          },
        }),
        resolveDoi: async () => null,
      },
      { lookup: async () => null },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    expect(carrier.fields.journal.value).toBe('Advances in Neural Information Processing Systems');
    expect(carrier.enrichment.mismatch).toBeUndefined();
  });

  it('stops enrichment when the phase budget is exhausted', async () => {
    const ctx = createTestPipelineContext({ options: { enrich: true } });
    ctx.performanceBudgets.enrichment = 1;
    const { carrier } = await runThroughPhase6(
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
    );

    const phase = new Phase8Enrich(
      {
        lookup: async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });
          return {
            confidence: 0.92,
            fields: {
              title: 'Delayed provider title',
            },
          };
        },
        resolveDoi: async () => null,
      },
      {
        lookup: async () => null,
      },
      { lookupLastResort: async () => null },
    );

    await phase.run([carrier], ctx);

    expect(carrier.enrichment.status).toBe('skipped');
    expect(carrier.fields.title.value).not.toBe('Delayed provider title');
    expect(ctx.stageLog.at(-1)?.message).toContain('latency budget');
  });
});
