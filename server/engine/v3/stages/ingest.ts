import { createIngestStage } from '../../v2/stages/ingest.js';
import type { V3Stage } from '../contracts.js';

export function createV3IngestStage(): V3Stage {
  return {
    id: 'ingest',
    async run(context) {
      const v2 = await createIngestStage().run(context.v2);
      return {
        ...context,
        v2,
        documentStyleHint: v2.inputProfile?.styleHints?.[0] ?? null,
      };
    },
  };
}
