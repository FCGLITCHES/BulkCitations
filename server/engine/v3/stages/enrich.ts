import { createEnrichStage } from '../../v2/stages/enrich.js';
import { createNormalizeStage } from '../../v2/stages/normalize.js';
import type { V3Stage } from '../contracts.js';
import { applyRuntimeFieldLocks } from '../locks.js';

export function createV3EnrichStage(): V3Stage {
  return {
    id: 'enrich',
    async run(context) {
      const previousCitations = context.v2.citations;
      const enriched = await createEnrichStage(
        context.adapters.resolutionProvider,
        context.adapters.cache,
        context.adapters.extractor,
      ).run(context.v2);
      const normalizedEnriched = await createNormalizeStage().run(enriched);

      return {
        ...context,
        v2: {
          ...normalizedEnriched,
          citations: applyRuntimeFieldLocks(previousCitations, normalizedEnriched.citations, context.fieldLocksByCitationId),
        },
      };
    },
  };
}
