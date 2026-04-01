import type { CanonicalCitation } from '@shared/schema';
import { isGroupAuthor, normalizeGroupAuthor } from '../../shared/citationSemantics.js';
import type { V3Stage } from '../contracts.js';
import { addCitationStageLog, createFieldValue, createStageDiagnostic, normalizeCanonicalAuthor } from '../../v2/utils.js';

function promoteCorporateAuthor(citation: CanonicalCitation): CanonicalCitation {
  if (citation.authors.value.length > 0) {
    return addCitationStageLog(
      citation,
      createStageDiagnostic('parse_authors', 'success', 'Structured author payload already present.'),
    );
  }

  const candidate = citation.institution.value ?? citation.publisher.value ?? null;
  if (!candidate || !isGroupAuthor(candidate)) {
    return addCitationStageLog(
      citation,
      createStageDiagnostic('parse_authors', 'success', 'No author enrichment was needed.'),
    );
  }

  const normalized = normalizeGroupAuthor(candidate);
  return addCitationStageLog({
    ...citation,
    authors: createFieldValue([
      normalizeCanonicalAuthor({
        first: null,
        last: normalized,
        initials: null,
        literal: normalized,
      }),
    ], 'normalized', 0.9, 'parse_authors'),
  }, createStageDiagnostic('parse_authors', 'success', 'Promoted a corporate author from institutional metadata.'));
}

export function createV3ParseAuthorsStage(): V3Stage {
  return {
    id: 'parse_authors',
    async run(context) {
      return {
        ...context,
        v2: {
          ...context.v2,
          citations: context.v2.citations.map(promoteCorporateAuthor),
        },
      };
    },
  };
}
