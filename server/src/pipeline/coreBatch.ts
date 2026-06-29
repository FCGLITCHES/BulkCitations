import type { ReferenceCarrier } from '../engine/types/carrier.js';
import type { RawBlock } from '../engine/types/ingestion.js';
import type { PipelineContext } from '../engine/types/pipeline.js';
import type { PipelineDependencies } from './dependencies.js';
import {
  runInlineFastLanePostProcessing,
  shouldInlineFastLanePostProcessing,
  type IntegratedFastLaneStageStats,
} from './fastLane.js';

export interface CorePipelineBatchResult {
  carriers: ReferenceCarrier[];
  integratedStageStats: IntegratedFastLaneStageStats | null;
}

export async function runCorePipelineBatch(
  blocks: RawBlock[],
  ctx: PipelineContext,
  deps: PipelineDependencies,
): Promise<CorePipelineBatchResult> {
  let carriers = await deps.coreStages.styleDetect.run(blocks, ctx);
  carriers = await deps.coreStages.extract.run(carriers, ctx);
  carriers = await deps.coreStages.authorDisambig.run(carriers, ctx);
  carriers = await deps.coreStages.structuralFamilyRouter.run(carriers, ctx);
  carriers = await deps.coreStages.typeClassify.run(carriers, ctx);

  if (!shouldInlineFastLanePostProcessing(ctx)) {
    return {
      carriers,
      integratedStageStats: null,
    };
  }

  const integrated = await runInlineFastLanePostProcessing(carriers, ctx);
  return {
    carriers: integrated.carriers,
    integratedStageStats: {
      sharedRepair: integrated.sharedRepair,
      normalization: integrated.normalization,
    },
  };
}
