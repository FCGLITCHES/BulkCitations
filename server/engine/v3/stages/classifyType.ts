import type { CanonicalCitation, CanonicalReferenceType } from '@shared/schema';
import type { V3Stage } from '../contracts.js';
import { addCitationStageLog, createStageDiagnostic } from '../../v2/utils.js';

function inferReferenceType(citation: CanonicalCitation): CanonicalReferenceType {
  if (citation.referenceType !== 'unknown') return citation.referenceType;
  if (citation.conferenceTitle.value) return 'conference';
  if (citation.bookTitle.value) return 'chapter';
  if (citation.journal.value) return 'journal';
  if (citation.thesisType.value || citation.repository.value) return 'thesis';
  if (citation.url.value && !citation.journal.value) return 'website';
  if (citation.institution.value) return 'report';
  if (citation.publisher.value) return 'book';
  return citation.referenceType;
}

export function createV3ClassifyTypeStage(): V3Stage {
  return {
    id: 'classify_type',
    async run(context) {
      return {
        ...context,
        v2: {
          ...context.v2,
          citations: context.v2.citations.map((citation) => {
            const referenceType = inferReferenceType(citation);
            return addCitationStageLog({
              ...citation,
              referenceType,
            }, createStageDiagnostic('classify_type', 'success', `Resolved citation type as ${referenceType}.`));
          }),
        },
      };
    },
  };
}
