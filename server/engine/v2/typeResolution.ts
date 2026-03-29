import type { CanonicalReferenceType, ExtractionContainerHints, ParsedReference } from '@shared/schema';
import { providerSourceTypeToCanonical } from './sourceTypes.js';

function normalizeDoi(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function looksConferenceDoiFamily(doi: string | undefined): boolean {
  const normalizedDoi = normalizeDoi(doi);
  return /^(?:10\.1109\/|10\.1145\/|10\.1117\/|10\.1115\/|10\.29327\/|10\.2991\/|10\.2495\/|10\.26678\/|10\.14201\/0aq|10\.51980\/|10\.3997\/2214-4609\.20|10\.1164\/ajrccm-conference\.|10\.1136\/[^/]+-snis\.|10\.1055\/s-|10\.52202\/|10\.46898\/home\.|10\.2749\/222137|10\.1364\/(?:ls|freeform)\.|10\.2316\/p\.|10\.5817\/cz\.muni\.p210-|10\.54941\/ahfe|10\.17491\/cgsi\/)/i.test(normalizedDoi);
}

function looksBookChapterDoiFamily(doi: string | undefined): boolean {
  const normalizedDoi = normalizeDoi(doi);
  return /^(?:10\.1007\/97[89]-|10\.1201\/97[89]|10\.1016\/b97[89]-|10\.30525\/97[89]-|10\.1163\/97[89]|10\.5040\/97[89]|10\.51202\/97[89]|10\.1093\/[^/]+\/97[89].*(?:003\.\d+|ch-\d+))/i.test(normalizedDoi);
}

function hasConferenceText(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return /\b(?:conference|symposium|workshop|congress|meeting|proceedings|forum|summit|colloquium|poster abstracts?|electronic poster abstracts?)\b/i.test(normalized);
}

function resolveTypeFromContainerHints(
  hints: ExtractionContainerHints,
  claimedType: CanonicalReferenceType,
  parsed: ParsedReference,
): CanonicalReferenceType | null {
  if (hints.containerKindConfidence < 0.85) return null;

  switch (hints.containerKindHint) {
    case 'conference':
      return 'conference';
    case 'book':
      if (claimedType === 'chapter' || Boolean(parsed.bookTitle && (parsed.pages || parsed.editor))) {
        return 'chapter';
      }
      return 'book';
    case 'report':
      return 'report';
    case 'thesis':
      return 'thesis';
    case 'website':
      return 'website';
    case 'journal':
      return 'journal';
    default:
      return null;
  }
}

export function resolveReferenceTypeFromEvidence(options: {
  claimedType: CanonicalReferenceType;
  parsed: ParsedReference;
  containerHints: ExtractionContainerHints;
  providerSourceType?: string | null;
  detectTypeHint?: CanonicalReferenceType | null;
}): { referenceType: CanonicalReferenceType; reason: string } {
  if (
    looksBookChapterDoiFamily(options.parsed.doi)
    && (
      options.claimedType === 'chapter'
      || Boolean(options.parsed.bookTitle)
      || (
        Boolean(options.parsed.conferenceTitle)
        && !hasConferenceText(options.parsed.conferenceTitle)
      )
    )
  ) {
    return {
      referenceType: 'chapter',
      reason: 'doi_family:book_chapter',
    };
  }

  if (
    looksConferenceDoiFamily(options.parsed.doi)
    && !looksBookChapterDoiFamily(options.parsed.doi)
    && (
      options.claimedType === 'conference'
      || Boolean(options.parsed.conferenceTitle)
      || (
        Boolean(options.parsed.bookTitle)
        && !options.parsed.editor
        && !options.parsed.placeOfPublication
      )
      || hasConferenceText(options.parsed.bookTitle)
      || (options.detectTypeHint === 'conference')
    )
  ) {
    return {
      referenceType: 'conference',
      reason: 'doi_family:conference',
    };
  }

  const containerResolved = resolveTypeFromContainerHints(options.containerHints, options.claimedType, options.parsed);
  if (containerResolved) {
    return {
      referenceType: containerResolved,
      reason: `container_kind:${options.containerHints.containerKindHint}`,
    };
  }

  const providerType = providerSourceTypeToCanonical(options.providerSourceType ?? undefined);
  if (providerType) {
    return {
      referenceType: providerType,
      reason: `provider_source_type:${providerType}`,
    };
  }

  if (options.claimedType !== 'unknown') {
    return {
      referenceType: options.claimedType,
      reason: `claimed_type:${options.claimedType}`,
    };
  }

  if (options.detectTypeHint && options.detectTypeHint !== 'unknown') {
    return {
      referenceType: options.detectTypeHint,
      reason: `detect_type_hint:${options.detectTypeHint}`,
    };
  }

  return {
    referenceType: 'unknown',
    reason: 'no_type_evidence',
  };
}

export function areReferenceTypesMergeCompatible(
  targetType: CanonicalReferenceType,
  candidateType: CanonicalReferenceType,
): boolean {
  if (targetType === candidateType) return true;
  if (targetType === 'chapter' && candidateType === 'book') return true;
  if (targetType === 'book' && candidateType === 'chapter') return true;
  if (targetType === 'report' && candidateType === 'thesis') return false;
  if (targetType === 'thesis' && candidateType === 'report') return false;
  if (targetType === 'conference' && candidateType === 'journal') return false;
  if (targetType === 'journal' && candidateType === 'conference') return false;
  return candidateType === 'unknown';
}
