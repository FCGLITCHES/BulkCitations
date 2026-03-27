import type { CanonicalReferenceType, ExtractionContainerHints, ParsedReference } from '@shared/schema';
import { providerSourceTypeToCanonical } from './sourceTypes.js';

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
