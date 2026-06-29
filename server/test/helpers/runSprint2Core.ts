import { phase3StyleDetect } from '../../src/engine/phases/phase3StyleDetect.js';
import { phase4Extract } from '../../src/engine/phases/phase4Extract.js';
import { phase5AuthorDisambig } from '../../src/engine/phases/phase5AuthorDisambig.js';
import { phase5_8StructuralFamilyRouter } from '../../src/engine/phases/phase5_8StructuralFamilyRouter.js';
import { phase6TypeClassify } from '../../src/engine/phases/phase6TypeClassify.js';
import { createTestPipelineContext } from './createPipelineContext.js';
import { makeRawBlock } from './makeRawBlock.js';

export async function runThroughPhase6(raw: string) {
  const ctx = createTestPipelineContext();
  let carriers = await phase3StyleDetect.run([makeRawBlock(raw)], ctx);
  carriers = await phase4Extract.run(carriers, ctx);
  carriers = await phase5AuthorDisambig.run(carriers, ctx);
  carriers = await phase5_8StructuralFamilyRouter.run(carriers, ctx);
  carriers = await phase6TypeClassify.run(carriers, ctx);
  return {
    ctx,
    carrier: carriers[0]!,
  };
}
