import { afterEach, describe, expect, it } from 'vitest';
import { createPipelineDependencies } from '../pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../pipeline/orchestrator.js';
import { evaluateFixture } from './runner.js';
import { REGRESSION_FIXTURES } from './fixtures.js';
import { resetRuntimeStore, upsertApprovedTruthPayload } from '../runtime/persistence.js';

describe('regression fixtures', () => {
  afterEach(async () => {
    await resetRuntimeStore();
  });

  for (const fixture of REGRESSION_FIXTURES) {
    it(`${fixture.suite}: ${fixture.id}`, async () => {
      for (const seed of fixture.approvedTruthSeed ?? []) {
        await upsertApprovedTruthPayload({
          rawText: seed.rawText,
          expectedFields: seed.expectedFields,
          expectedType: seed.expectedType ?? null,
          expectedStyle: seed.expectedStyle ?? null,
          trustLevel: seed.trustLevel ?? 'gold',
          reviewedBy: seed.reviewedBy ?? 'regression-test',
          provenance: seed.provenance ?? 'approved_truth_seed',
        });
      }
      const ctx = createPipelineContext({
        outputStyle: fixture.input.outputStyle ?? 'apa7',
        ...(fixture.pipelineOptions ? { options: fixture.pipelineOptions } : {}),
      });
      const { response } = await runConvertPipeline(fixture.input, ctx, createPipelineDependencies());
      const result = evaluateFixture(fixture, response);

      expect(result.details).toEqual([]);
    });
  }
});
