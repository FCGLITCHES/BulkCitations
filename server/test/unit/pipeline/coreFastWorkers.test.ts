import { describe, expect, it } from 'vitest';
import {
  createPipelineContext,
  runConvertPipeline,
  runConvertPipelineFromBlocks,
} from '../../../src/pipeline/orchestrator.js';
import type { ConvertResponse } from '../../../src/engine/types/api.js';
import type { RawBlock } from '../../../src/engine/types/ingestion.js';

const WORKER_THREAD_LANE_TIMEOUT_MS = 120_000;

describe('core_parse_fast worker-thread lane', () => {
  it('preserves semantic output when worker threads are enabled', async () => {
    const content = [
      'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
      '',
      'Doe, A. (2021). Another study. Example Review, 9(1), 1-10.',
      '',
      'Brown, C. (2019). Third example. Example Quarterly, 7(2), 11-18.',
    ].join('\n');

    const singleThreadCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 1,
        maxConcurrency: 1,
        fastLaneMulticoreMinRefs: 1,
      },
    });
    const workerCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 1,
        maxConcurrency: 2,
        fastLaneMulticoreMinRefs: 1,
      },
    });

    const singleThread = await runConvertPipeline({
      sourceType: 'text',
      content,
      outputStyle: 'apa7',
    }, singleThreadCtx);
    const workerThread = await runConvertPipeline({
      sourceType: 'text',
      content,
      outputStyle: 'apa7',
    }, workerCtx);

    expect(projectResponse(workerThread.response)).toEqual(projectResponse(singleThread.response));
  }, WORKER_THREAD_LANE_TIMEOUT_MS);

  it('reconciles shared-doi author groups after worker merges so report citations stay semantically identical', async () => {
    const content = [
      'BSI British Standards. Nanomanufacturing. Product specifications. BSI British Standards, 2023. doi:10.3403/30420243.',
      '',
      '[1]BSI British Stàndàrds, “Nànomànufàcturing. Product spécificàtions,” BSI British Stàndàrds, 2023. doi: 10.3403/30420243.',
    ].join('\n');

    const singleThreadCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 1,
        maxConcurrency: 1,
        fastLaneMulticoreMinRefs: 1,
      },
    });
    const workerCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 1,
        maxConcurrency: 2,
        fastLaneMulticoreMinRefs: 1,
      },
    });

    const singleThread = await runConvertPipeline({
      sourceType: 'text',
      content,
      outputStyle: 'apa7',
    }, singleThreadCtx);
    const workerThread = await runConvertPipeline({
      sourceType: 'text',
      content,
      outputStyle: 'apa7',
    }, workerCtx);

    expect(projectResponse(workerThread.response)).toEqual(projectResponse(singleThread.response));
    expect(workerThread.response.references.every((citation) => citation.referenceType === 'report')).toBe(true);
    expect(workerThread.response.references.every((citation) => citation.referenceType !== 'unknown')).toBe(true);
  }, WORKER_THREAD_LANE_TIMEOUT_MS);

  it('preserves semantic output when one record spans fast-lane batch boundaries', async () => {
    const content = [
      'BSI British Standards. (2013). Solid biofuels. Terminology, definitions and descriptions. BSI British Standards. https://doi.org/10.3403/03001113',
      '',
      'BSI British Standards (2013) Solid biofuels. Terminology, definitions and descriptions. BSI British Standards. Available at: https://doi.org/10.3403/03001113.',
      '',
      'BSI British Standards. Solid Biofuels. Terminology, Definitions and Descriptions. BSI British Standards, 2013. https://doi.org/10.3403/03001113.',
      '',
      '[1]BSI British Standards. Solid biofuels. Terminology, definitions and descriptions. BSI British Standards; 2013. https://doi.org/10.3403/03001113.',
      '',
      '[1]BSI British Standards, “Solid biofuels. Terminology, definitions and descriptions,” BSI British Standards, 2013. doi: 10.3403/03001113.',
      '',
      'BSI British Standards. Solid Biofuels. Terminology, Definitions and Descriptions. BSI British Standards, 2013, https://doi.org/10.3403/03001113.',
    ].join('\n');

    const singleThreadCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 4,
        maxConcurrency: 1,
        fastLaneMulticoreMinRefs: 1,
      },
    });
    const workerCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 4,
        maxConcurrency: 2,
        fastLaneMulticoreMinRefs: 1,
      },
    });

    const singleThread = await runConvertPipeline({
      sourceType: 'text',
      content,
      outputStyle: 'apa7',
    }, singleThreadCtx);
    const workerThread = await runConvertPipeline({
      sourceType: 'text',
      content,
      outputStyle: 'apa7',
    }, workerCtx);

    expect(projectResponse(workerThread.response)).toEqual(projectResponse(singleThread.response));
    expect(workerThread.response.references.every((citation) => citation.referenceType === 'report')).toBe(true);
    expect(workerThread.response.references.every((citation) => citation.referenceType !== 'unknown')).toBe(true);
  }, WORKER_THREAD_LANE_TIMEOUT_MS);

  it('keeps bookish monographs and conference rows out of unknown or webpage under worker-thread parsing', async () => {
    const cases = [
      {
        content: 'Ali, N. (2024). Older South Asian Migrant Women\'s Experiences of Ageing in the UK. Springer International Publishing. https://doi.org/10.1007/978-3-031-50462-4',
        expectedType: 'book',
      },
      {
        content: 'Paulo Santos da Silva, M., & de Paula Martins, C. (2023). A Extensão Universitária Como Caminho Para a Sustentabilidade Técnica, Econômica e Social na Produção de Biocombustíveis. Proceedings of the 51 Brasilian Congress of Engineering Education. https://doi.org/10.37702/2175-957x.cobenge.2023.4540',
        expectedType: 'conference-paper',
      },
      {
        content: '[1] S. Claeys, "Fluid mud density determination in navigational channels," Hydro12 - Taking care of the sea, Hydrographic Society Benelux, 2012. doi:10.3990/2.228',
        expectedType: 'conference-paper',
      },
    ] as const;

    for (const testCase of cases) {
      const singleThreadCtx = createPipelineContext({
        outputStyle: 'apa7',
        options: {
          parseProfile: 'core_parse_fast',
        },
        runtimeTuning: {
          batchSize: 1,
          maxConcurrency: 1,
          fastLaneMulticoreMinRefs: 1,
        },
      });
      const workerCtx = createPipelineContext({
        outputStyle: 'apa7',
        options: {
          parseProfile: 'core_parse_fast',
        },
        runtimeTuning: {
          batchSize: 1,
          maxConcurrency: 2,
          fastLaneMulticoreMinRefs: 1,
        },
      });

      const singleThread = await runConvertPipeline({
        sourceType: 'text',
        content: testCase.content,
        outputStyle: 'apa7',
      }, singleThreadCtx);
      const workerThread = await runConvertPipeline({
        sourceType: 'text',
        content: testCase.content,
        outputStyle: 'apa7',
      }, workerCtx);

      expect(projectResponse(workerThread.response)).toEqual(projectResponse(singleThread.response));
      expect(workerThread.response.references).toHaveLength(1);
      expect(workerThread.response.references[0]?.referenceType).toBe(testCase.expectedType);
      expect(workerThread.response.references[0]?.referenceType).not.toBe('unknown');
      expect(workerThread.response.references[0]?.referenceType).not.toBe('webpage');
    }
  }, WORKER_THREAD_LANE_TIMEOUT_MS);

  it('keeps benchmark semantic groups intact across fast-lane batch-size and worker changes', async () => {
    const blocks = createBenchmarkLikeBlocks([
      {
        semanticGroupKey: 'preprint-144383a403d1db07:clean',
        text: 'Chen, H., Cheng, D., Zhou, D., Mo, Y., Zhong, L., Wang, Y., Wang, Y., Qiu, H., Tan, X., Wang, B., Huang, M., & Song, B. (2023). Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato. Elsevier BV. https://doi.org/10.2139/ssrn.4583547',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:noisy',
        text: 'Chen, H., Cheng, D., Zhou, D., Mo, Y., Zhong, L., Wang, Y., Wang, Y., Qiu, H., Tan, X., Wang, B., Huang, M., & Song, B. . Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato. Elsevier BV. https://doi.org/',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:clean',
        text: 'Chen, H. et al. (2023) “Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato.” Elsevier BV. Available at: https://doi.org/10.2139/ssrn.4583547.',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:noisy',
        text: 'Chen;  H.  et  al.  (2023)  “Ripv1;  a  Ralstonia  Solanacearum  Type  Iii  Effector;  Acts  as  a  Novel  E3  Ubiquitin  Ligase  to  Suppress  Plant  Pamp-Triggered  Immunity  Responses  and  Promote  Susceptibility  in  Potato.”  Elsevier  BV.  Available  at:  https://doi.org/10.2139/ssrn.4583547.',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:clean',
        text: 'Chen, Huilan, Dong Cheng, Dan Zhou, et al. “Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4583547.',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:noisy',
        text: 'Chen, Huilan, Dong Cheng, Dan Zhou, et al. “Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato.” Preprint, Elsevier BV, 2023. https://doi.org/.',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:clean',
        text: '[1]Chen H, Cheng D, Zhou D, Mo Y, Zhong L, Wang Y, et al. Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato 2023. https://doi.org/10.2139/ssrn.4583547.',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:noisy',
        text: '[1]Chén H, Chéng D, Zhou D, Mo Y, Zhong L, Wàng Y, ét àl. Ripv1, à Ràlstonià Solànàcéàrum Typé Iii Efféctor, Acts às à Novél E3 Ubiquitin Ligàsé to Suppréss Plànt Pàmp-Triggéréd Immunity Résponsés ànd Promoté Suscéptibility in Potàto 2023. https://doi.org/10.2139/ssrn.4583547.',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:clean',
        text: '[1]H. Chen et al., “Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato,” 2023, Elsevier BV. doi: 10.2139/ssrn.4583547.',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:noisy',
        text: '[1]H. Chen et al., “Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato,” 2023, Elsevier BV. doi: .',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:clean',
        text: 'Chen, Huilan, et al. “Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato.” Elsevier BV, 2023, https://doi.org/10.2139/ssrn.4583547.',
      },
      {
        semanticGroupKey: 'preprint-144383a403d1db07:noisy',
        text: 'Chen, Huilan, et al. “Ripv1, a Ralstonia Solanacearum Type Iii Effector, Acts as a Novel E3 Ubiquitin Ligase to Suppress Plant Pamp-Triggered Immunity Responses and Promote Susceptibility in Potato.” Elsevier BV, 2023, doi:10.2139/ssrn.4583547.',
      },
    ]);

    const wideCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 12,
        maxConcurrency: 1,
        fastLaneMulticoreMinRefs: 1,
      },
    });
    const narrowSingleCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 5,
        maxConcurrency: 1,
        fastLaneMulticoreMinRefs: 1,
      },
    });
    const narrowWorkerCtx = createPipelineContext({
      outputStyle: 'apa7',
      options: {
        parseProfile: 'core_parse_fast',
      },
      runtimeTuning: {
        batchSize: 5,
        maxConcurrency: 2,
        fastLaneMulticoreMinRefs: 1,
      },
    });

    const wide = await runConvertPipelineFromBlocks(createPresplitInput(blocks), wideCtx);
    const narrowSingle = await runConvertPipelineFromBlocks(createPresplitInput(blocks), narrowSingleCtx);
    const narrowWorker = await runConvertPipelineFromBlocks(createPresplitInput(blocks), narrowWorkerCtx);

    expect(projectBenchmarkPreprintContract(narrowSingle.response)).toEqual(
      projectBenchmarkPreprintContract(wide.response),
    );
    expect(projectBenchmarkPreprintContract(narrowWorker.response)).toEqual(
      projectBenchmarkPreprintContract(wide.response),
    );
    expect(wide.response.references[1]?.fields.repository.value).toBe('Elsevier BV');
    expect(narrowSingle.response.references[1]?.fields.repository.value).toBe('Elsevier BV');
    expect(narrowWorker.response.references[1]?.fields.repository.value).toBe('Elsevier BV');
  }, WORKER_THREAD_LANE_TIMEOUT_MS);
});

function projectResponse(response: ConvertResponse): unknown {
  return {
    executionProfile: response.executionProfile,
    summary: response.summary,
    countAudit: response.countAudit,
    references: response.references.map((citation) => ({
      index: citation.index,
      status: citation.status,
      publicStatus: citation.publicStatus,
      parseOutcome: citation.parseOutcome,
      referenceType: citation.referenceType,
      detectedStyle: citation.detectedStyle,
      detectedStyleFamily: citation.detectedStyleFamily,
      renderedText: citation.renderedText,
      fields: Object.fromEntries(
        Object.entries(citation.fields).map(([field, value]) => [field, value.value]),
      ),
      stageLogLength: citation.stageLog.length,
    })),
    stagesRun: response.processingPath.stagesRun,
  };
}

function projectBenchmarkPreprintContract(response: ConvertResponse): unknown {
  return response.references.map((citation) => ({
    index: citation.index,
    status: citation.status,
    publicStatus: citation.publicStatus,
    parseOutcome: citation.parseOutcome,
    referenceType: citation.referenceType,
    detectedStyle: citation.detectedStyle,
    detectedStyleFamily: citation.detectedStyleFamily,
    renderedText: citation.renderedText,
    fields: {
      authors: citation.fields.authors.value,
      title: citation.fields.title.value,
      year: citation.fields.year.value,
      doi: citation.fields.doi.value,
      url: citation.fields.url.value,
      repository: citation.fields.repository.value,
    },
  }));
}

function createBenchmarkLikeBlocks(
  rows: Array<{
    semanticGroupKey: string;
    text: string;
  }>,
): RawBlock[] {
  return rows.map((row, index) => ({
    index,
    text: row.text,
    semanticGroupKey: row.semanticGroupKey,
    formatMeta: {
      sourceType: 'text',
      structure: 'structured',
      detectedFormat: 'plain_text',
      formatConfidence: 1,
    },
    splitMethod: 'blank_line',
    splitConfidence: 1,
    isDoiResolved: false,
    flags: [],
    splitReason: 'benchmark_pre_split',
    blockFormat: 'plain_text',
    boundarySignals: ['benchmark_pre_split'],
  }));
}

function createPresplitInput(blocks: RawBlock[]) {
  return {
    sourceType: 'text' as const,
    blocks,
    countAudit: {
      inputEstimate: blocks.length,
      aggregatedCount: blocks.length,
      splitCount: blocks.length,
      delta: 0,
      needsActionCount: 0,
      droppedCount: 0,
    },
    detectionMeta: {
      confidence: 1,
      sampled: false,
      splitQualityFlag: 'ok' as const,
    },
  };
}
