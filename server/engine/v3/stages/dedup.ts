import { createDedupStage } from '../../v2/stages/dedup.js';
import type { V3Stage } from '../contracts.js';

export function createV3DedupStage(): V3Stage {
  return {
    id: 'dedup',
    async run(context) {
      return {
        ...context,
        v2: await createDedupStage().run(context.v2),
      };
    },
  };
}
