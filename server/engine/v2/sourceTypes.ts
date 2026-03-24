import type { CanonicalReferenceType } from '@shared/schema';
import { normalizeWhitespace } from './utils.js';

type CanonicalSourceTypeMatch = {
  canonical: CanonicalReferenceType;
  pattern: RegExp;
};

const PROVIDER_SOURCE_TYPE_PATTERNS: CanonicalSourceTypeMatch[] = [
  {
    canonical: 'chapter',
    pattern: /(book[-\s]chapter|book[-\s]section|chapter|book[-\s]part|reference[-\s]entry|reference[-\s]book|book[-\s]track)/,
  },
  {
    canonical: 'conference',
    pattern: /(conference[-\s]paper|paper[-\s]conference|conference|proceedings[-\s]article|proceeding|symposium|workshop|congress)/,
  },
  {
    canonical: 'report',
    pattern: /(technical[-\s]report|white[-\s]paper|policy[-\s]brief|report[-\s]series|report)/,
  },
  {
    canonical: 'website',
    pattern: /(website|webpage|site)/,
  },
  {
    canonical: 'preprint',
    pattern: /(preprint|posted[-\s]content|working[-\s]paper|discussion[-\s]paper|accepted[-\s]manuscript)/,
  },
  {
    canonical: 'thesis',
    pattern: /(dissertation|thesis)/,
  },
  {
    canonical: 'book',
    pattern: /(edited[-\s]book|reference[-\s]book|book[-\s]series|book[-\s]set|monograph|book)/,
  },
  {
    canonical: 'journal',
    pattern: /(journal[-\s]article|article[-\s]journal|journal[-\s]volume|journal[-\s]issue|journal|article)/,
  },
];

export function providerSourceTypeToCanonical(sourceType?: string): CanonicalReferenceType | null {
  const normalized = normalizeWhitespace((sourceType ?? '').toLowerCase());
  if (!normalized) return null;

  for (const entry of PROVIDER_SOURCE_TYPE_PATTERNS) {
    if (entry.pattern.test(normalized)) return entry.canonical;
  }

  return null;
}

export function providerSourceTypeMatchesReferenceType(
  referenceType: CanonicalReferenceType,
  sourceType?: string,
  allowPlaceholderFlex = false,
): boolean {
  const normalized = normalizeWhitespace((sourceType ?? '').toLowerCase());
  if (!normalized || referenceType === 'unknown') return true;

  const canonical = providerSourceTypeToCanonical(normalized);
  if (!canonical) return true;
  if (canonical === referenceType) return true;

  if (referenceType === 'preprint') {
    return canonical === 'journal' || canonical === 'preprint';
  }

  if (referenceType === 'chapter') {
    return canonical === 'book';
  }

  if (referenceType === 'journal' && allowPlaceholderFlex) {
    return ['journal', 'conference', 'book', 'chapter', 'report'].includes(canonical);
  }

  if (referenceType === 'website' && allowPlaceholderFlex) {
    return ['website', 'journal', 'conference', 'book', 'chapter', 'report'].includes(canonical);
  }

  return false;
}

export function crossrefTypeFilterForSourceType(sourceType?: CanonicalReferenceType): string | null {
  switch (sourceType) {
    case 'journal':
      return 'type:journal-article';
    case 'conference':
      return 'type:proceedings-article';
    case 'report':
      return 'type:report';
    case 'book':
      return 'type:book';
    case 'chapter':
      return 'type:book-chapter';
    case 'preprint':
      return 'type:posted-content';
    case 'thesis':
      return 'type:dissertation';
    default:
      return null;
  }
}
