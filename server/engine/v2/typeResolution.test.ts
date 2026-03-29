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

  it('prefers chapter for book-chapter doi families even when a weak conference title leaked into parsing', () => {
    const resolved = resolveReferenceTypeFromEvidence({
      claimedType: 'conference',
      parsed: {
        title: 'Attention Enhanced Transformer for Multi-agent Trajectory Prediction',
        conferenceTitle: 'Lecture Notes in Computer Science',
        year: '2024',
        doi: '10.1007/978-981-97-5678-0_24',
      },
      containerHints: {
        containerKindHint: 'conference',
        containerKindConfidence: 0.9,
        venueContaminated: false,
        titleContainerBleed: false,
        publisherTailPresent: false,
        locatorInVenue: false,
        copyrightTailPresent: false,
        copyrightPublisherCandidate: null,
      },
    });

    expect(resolved.referenceType).toBe('chapter');
    expect(resolved.reason).toBe('doi_family:book_chapter');
  });

  it('prefers conference for proceedings doi families even when parsing exposes a book title container', () => {
    const resolved = resolveReferenceTypeFromEvidence({
      claimedType: 'chapter',
      parsed: {
        title: 'AMiner: Toward Understanding Big Scholar Data',
        bookTitle: 'Proceedings of the Ninth ACM International Conference on Web Search and Data Mining',
        year: '2016',
        doi: '10.1145/2835776.2835849',
      },
      containerHints: {
        containerKindHint: 'book',
        containerKindConfidence: 0.9,
        venueContaminated: false,
        titleContainerBleed: false,
        publisherTailPresent: false,
        locatorInVenue: false,
        copyrightTailPresent: false,
        copyrightPublisherCandidate: null,
      },
    });

    expect(resolved.referenceType).toBe('conference');
    expect(resolved.reason).toBe('doi_family:conference');
  });

  it('prefers conference for conference-doi families even when only a bookTitle container survived parsing', () => {
    const resolved = resolveReferenceTypeFromEvidence({
      claimedType: 'chapter',
      parsed: {
        title: 'Squeezed vacuum profile control via pump field shaping',
        bookTitle: 'Frontiers in Optics 2013',
        year: '2013',
        doi: '10.1364/ls.2013.lw2g.4',
      },
      containerHints: {
        containerKindHint: 'book',
        containerKindConfidence: 0.92,
        venueContaminated: false,
        titleContainerBleed: false,
        publisherTailPresent: false,
        locatorInVenue: false,
        copyrightTailPresent: false,
        copyrightPublisherCandidate: null,
      },
    });

    expect(resolved.referenceType).toBe('conference');
    expect(resolved.reason).toBe('doi_family:conference');
  });
});
