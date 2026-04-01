import { createDetectStage } from '../../v2/stages/detect.js';
import type { V3Stage } from '../contracts.js';

export function createV3DetectStyleStage(): V3Stage {
  return {
    id: 'detect_style',
    async run(context) {
      return {
        ...context,
        v2: await createDetectStage(context.adapters.classifier).run(context.v2),
      };
    },
  };
}
