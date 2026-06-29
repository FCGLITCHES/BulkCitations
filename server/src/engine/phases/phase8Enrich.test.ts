import { describe, expect, it } from 'vitest';
import type { CrossrefService, ProviderRecord } from '../../services/crossref.js';
import type { OpenAlexService } from '../../services/openalex.js';
import type { SemanticScholarService } from '../../services/semanticScholar.js';
import { ProviderLookupError, type ProviderLookupOptions } from '../../services/providerLookup.js';
import { createPipelineContext } from '../../pipeline/orchestrator.js';
import { fieldOf } from '../types/field.js';
import { buildReferenceCarrier } from '../utils/carriers.js';
import type { StyleDetectionResult } from '../types/carrier.js';
import { Phase8Enrich } from './phase8Enrich.js';

function style(): StyleDetectionResult {
  return {
    primary: { style: 'apa7', confidence: 0.9 },
    secondary: null,
    family: 'author_date',
    familyConfidence: 0.9,
    styleConfidence: 0.9,
    familyMarginToRunnerUp: 0.5,
    styleMarginToRunnerUp: 0.5,
    certaintyTier: 'high',
    styleCandidates: [{ style: 'apa7', score: 0.9 }],
    familyCandidates: [{ family: 'author_date', score: 0.9 }],
    signals: [],
    conflictDampened: false,
    isUnknown: false,
    isMultiStyle: false,
  };
}

function makeCarrier() {
  const carrier = buildReferenceCarrier({
    index: 0,
    text: 'Smith, J. (2020). Example study on reliability.',
    splitMethod: 'blank_line',
    splitConfidence: 1,
    isDoiResolved: false,
    flags: [],
  }, style(), undefined, 'apa7');
  carrier.fields.title = fieldOf('Example study on reliability', 'phase4_extraction', 'phase8Enrich.test', 0.9);
  carrier.fields.authors = fieldOf([{
    family: 'Smith',
    given: 'J.',
    initials: 'J',
    isCorporate: false,
  }], 'phase4_extraction', 'phase8Enrich.test', 0.9);
  carrier.fields.year = fieldOf(2020, 'phase4_extraction', 'phase8Enrich.test', 0.9);
  return carrier;
}

describe('phase8 enrichment reliability', () => {
  it('records provider dead letters with deterministic idempotency keys', async () => {
    let seenCrossrefOptions: ProviderLookupOptions | undefined;
    let seenOpenAlexOptions: ProviderLookupOptions | undefined;

    const crossref: CrossrefService = {
      async lookup(_fields, options) {
        seenCrossrefOptions = options;
        throw new ProviderLookupError(
          'crossref',
          'crossref.lookup',
          options?.idempotencyKey ?? 'missing',
          options?.lookupKey ?? 'missing',
          503,
          'Crossref unavailable',
        );
      },
      async resolveDoi(_doi) {
        return null;
      },
    };

    const openalex: OpenAlexService = {
      async lookup(_fields, options) {
        seenOpenAlexOptions = options;
        return null;
      },
    };

    const semanticScholar: SemanticScholarService = {
      async lookupLastResort(): Promise<ProviderRecord | null> {
        return null;
      },
    };

    const phase = new Phase8Enrich(crossref, openalex, semanticScholar);
    const ctx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        enrich: true,
      },
    });
    // Keep the dead-letter assertion stable under full-suite load.
    ctx.performanceBudgets.enrichment = 5_000;

    const [carrier] = await phase.run([makeCarrier()], ctx);
    const summary = ctx.stageLog.find((entry) => entry.stageId === 'phase8_enrichment');

    expect(seenCrossrefOptions?.idempotencyKey).toMatch(/^crossref:/);
    expect(seenOpenAlexOptions?.idempotencyKey).toMatch(/^openalex:/);
    expect(summary?.details?.deadLetterCount).toBe(1);
    expect(carrier?.enrichment.status).toBe('error');
  });
});
