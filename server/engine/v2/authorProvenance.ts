import type { CanonicalAuthor, CitationStyle } from '@shared/schema';
import { isGroupAuthor, normalizeGroupAuthor } from '../shared/citationSemantics.js';
import { looksLikeCompactInitialLeadingPersonalName, normalizeWhitespace } from './utils.js';

export type AuthorProvenanceKind = 'personal' | 'group' | 'institutional_literal';

const INSTITUTIONAL_LITERAL_SIGNAL = /\b(?:department|faculty|university|institute|ministry|office|administration|agency|bureau|council|division|directorate|center|centre|laboratory|lab|school|college|researchhub technologies|defense technical information center|office of scientific and technical information)\b/i;

function classifyAuthor(author: string): AuthorProvenanceKind {
  const normalized = normalizeWhitespace(author);
  if (!normalized) return 'personal';
  if (looksLikeCompactInitialLeadingPersonalName(normalized)) return 'personal';
  if (isGroupAuthor(normalized)) return 'group';
  if (
    normalized.includes(',')
    && INSTITUTIONAL_LITERAL_SIGNAL.test(normalized)
    && normalized.split(/\s*,\s*/).filter(Boolean).length >= 3
  ) {
    return 'institutional_literal';
  }
  return 'personal';
}

export function normalizeAuthorsForProvenance(
  authors: Array<string | CanonicalAuthor>,
  _style: CitationStyle | string | null | undefined,
): {
  authors: Array<string | CanonicalAuthor>;
  provenance: AuthorProvenanceKind[];
} {
  const provenance: AuthorProvenanceKind[] = [];

  const nextAuthors = authors.map((author) => {
    if (typeof author !== 'string') {
      provenance.push(author.literal && isGroupAuthor(author.literal) ? 'group' : 'personal');
      return author;
    }

    const normalized = normalizeWhitespace(author);
    const kind = classifyAuthor(normalized);
    provenance.push(kind);

    if (kind === 'group' || kind === 'institutional_literal') {
      return normalizeGroupAuthor(normalized);
    }
    return normalized;
  });

  return { authors: nextAuthors, provenance };
}
