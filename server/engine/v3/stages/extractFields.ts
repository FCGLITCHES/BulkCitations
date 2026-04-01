import { createExtractStage } from '../../v2/stages/extract.js';
import type { V3Stage } from '../contracts.js';
import { applyRuntimeFieldLocks } from '../locks.js';

export function createV3ExtractFieldsStage(): V3Stage {
  return {
    id: 'extract_fields',
    async run(context) {
      const previousCitations = context.v2.citations;
      const nextV2 = await createExtractStage(context.adapters.extractor).run(context.v2);
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
