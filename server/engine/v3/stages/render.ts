import { createRenderStage } from '../../v2/stages/render.js';
import { createRespondStage } from '../../v2/stages/respond.js';
import type { V3Stage } from '../contracts.js';

export function createV3RenderStage(): V3Stage {
  return {
    id: 'render',
    async run(context) {
      const rendered = await createRenderStage().run(context.v2);
      const responded = await createRespondStage().run(rendered);
      return {
        ...context,
        v2: responded,
      };
    },
  };
}
