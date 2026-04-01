import type { V3Stage } from '../contracts.js';
import { addCitationStageLog, createStageDiagnostic } from '../../v2/utils.js';

export function createV3AuthorityValidateAndAdjustStage(): V3Stage {
  return {
    id: 'authority_validate_and_adjust',
    async run(context) {
      return {
        ...context,
        v2: {
          ...context.v2,
          citations: context.v2.citations.map((citation) => addCitationStageLog(
            citation,
            createStageDiagnostic(
              'authority_validate_and_adjust',
              'success',
              'Authority adjustment contract completed; final display score is derived during v3 response shaping.',
            ),
          )),
        },
      };
    },
  };
}
