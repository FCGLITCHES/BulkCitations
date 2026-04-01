import { createSplitStage } from '../../v2/stages/split.js';
import type { V3Stage } from '../contracts.js';
import { initializeRuntimeFieldLocks } from '../locks.js';

export function createV3SplitStage(): V3Stage {
  return {
    id: 'split',
    async run(context) {
      const v2 = await createSplitStage().run(context.v2);
      return {
        ...context,
        v2,
        fieldLocksByCitationId: initializeRuntimeFieldLocks(v2.citations, context.request),
      };
    },
  };
}
