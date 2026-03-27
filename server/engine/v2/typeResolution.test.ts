import { describe, expect, it } from 'vitest';
import { resolveReferenceTypeFromEvidence } from './typeResolution.js';

describe('type resolution', () => {
  it('lets high-confidence container evidence override detect-stage type hints', () => {
    const resolved = resolveReferenceTypeFromEvidence({
      claimedType: 'journal',
      parsed: {
        title: 'A conference paper',
        conferenceTitle: 'Proceedings of the Testing Symposium',
        year: '2024',
      },
      containerHints: {
        containerKindHint: 'conference',
        containerKindConfidence: 0.96,
        venueContaminated: false,
        titleContainerBleed: false,
        publisherTailPresent: false,
        locatorInVenue: false,
        copyrightTailPresent: false,
        copyrightPublisherCandidate: null,
      },
      detectTypeHint: 'journal',
    });

    expect(resolved.referenceType).toBe('conference');
    expect(resolved.reason).toBe('container_kind:conference');
  });

  it('falls back to the claimed type when no stronger evidence exists', () => {
    const resolved = resolveReferenceTypeFromEvidence({
      claimedType: 'report',
      parsed: {
        title: 'A report',
        year: '2024',
      },
      containerHints: {
        containerKindHint: 'unknown',
        containerKindConfidence: 0,
        venueContaminated: false,
        titleContainerBleed: false,
        publisherTailPresent: false,
        locatorInVenue: false,
        copyrightTailPresent: false,
        copyrightPublisherCandidate: null,
      },
    });

    expect(resolved.referenceType).toBe('report');
    expect(resolved.reason).toBe('claimed_type:report');
  });
});
