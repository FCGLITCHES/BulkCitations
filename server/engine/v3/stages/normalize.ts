import { createNormalizeStage } from '../../v2/stages/normalize.js';
import type { V3Stage } from '../contracts.js';
import { applyRuntimeFieldLocks } from '../locks.js';

export function createV3NormalizeStage(): V3Stage {
  return {
    id: 'normalize',
    async run(context) {
      const previousCitations = context.v2.citations;
      const nextV2 = await createNormalizeStage().run(context.v2);
      return {
        ...context,
        v2: {
          ...nextV2,
          citations: applyRuntimeFieldLocks(previousCitations, nextV2.citations, context.fieldLocksByCitationId),
        },
      };
    },
  };
}
