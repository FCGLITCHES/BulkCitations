import type { V2Stage } from '../contracts.js';

export function createGroupStage(): V2Stage {
  return {
    id: 'group',
    async run(context) {
      return context;
    },
  };
}
