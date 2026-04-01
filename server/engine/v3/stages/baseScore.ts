import { createScoreStage } from '../../v2/stages/score.js';
import { createValidateStage } from '../../v2/stages/validate.js';
import type { V3Stage } from '../contracts.js';

export function createV3BaseScoreStage(): V3Stage {
  return {
    id: 'base_score',
    async run(context) {
      const validated = await createValidateStage().run(context.v2);
      const scored = await createScoreStage().run(validated);
      return {
        ...context,
        v2: scored,
      };
    },
  };
}
