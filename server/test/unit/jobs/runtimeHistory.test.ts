import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storeCompletedJob } from '../../../src/jobs/runtime.js';
import { createPipelineDependencies } from '../../../src/pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../../../src/pipeline/orchestrator.js';
import {
  listCitationExtractionHistory,
  resetRuntimeStore,
} from '../../../src/runtime/persistence.js';
import type { ConvertRequest } from '../../../src/engine/types/api.js';

describe('storeCompletedJob extraction history', () => {
  beforeEach(async () => {
    delete process.env.ML_PHASE4_MODE;
    delete process.env.ML_PHASE4_PRIMARY_FRACTION;
    delete process.env.ML_PHASE4_SHADOW_FRACTION;
    await resetRuntimeStore();
  });

  afterEach(async () => {
    await resetRuntimeStore();
  });

  it('persists extraction history rows for completed citations', async () => {
    const request: ConvertRequest = {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
      outputStyle: 'apa7',
    };
    const ctx = createPipelineContext({ outputStyle: 'apa7' });
    const artifacts = await runConvertPipeline(request, ctx, createPipelineDependencies());

    await storeCompletedJob(request, artifacts, 'sync');

    const citation = artifacts.citations[0];
    expect(citation?.extractionMeta?.runMode).toBe('heuristic');

    const history = await listCitationExtractionHistory(citation!.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.citationId).toBe(citation?.id);
    expect(history[0]?.runMode).toBe('heuristic');
  });

  it('returns a defensive copy of extraction history rows in memory mode', async () => {
    const request: ConvertRequest = {
      sourceType: 'text',
      content: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
      outputStyle: 'apa7',
    };
    const ctx = createPipelineContext({ outputStyle: 'apa7' });
    const artifacts = await runConvertPipeline(request, ctx, createPipelineDependencies());

    await storeCompletedJob(request, artifacts, 'sync');

    const citation = artifacts.citations[0]!;
    const history = await listCitationExtractionHistory(citation.id);
    history[0]!.runMode = 'ml';

    const reread = await listCitationExtractionHistory(citation.id);
    expect(reread[0]?.runMode).toBe('heuristic');
  });
});
