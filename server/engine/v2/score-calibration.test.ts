import type { CanonicalCitation } from '@shared/schema';
import { describe, expect, it } from 'vitest';
import { createFieldValue, createEmptyCitation } from './utils.js';
import {
  OBSERVATION_PENALTY_CAP,
  OBSERVATION_PENALTY_PER_CODE,
  observationPenaltyForCodes,
  validateScoreConfiguration,
} from './qualityRules.js';
import { scoreCitation } from './stages/score.js';

function makeCitation(referenceType: any, overrides: Partial<CanonicalCitation> = {}): CanonicalCitation {
  const citation = createEmptyCitation('Synthetic citation input');
  return {
    ...citation,
    referenceType,
    authors: createFieldValue([{ first: 'Jane', last: 'Smith', initials: 'J.' }], 'extracted', 0.78, 'extract'),
    title: createFieldValue('Long form title for citation scoring regression coverage', 'extracted', 0.79, 'extract'),
    year: createFieldValue(2021, 'extracted', 0.8, 'extract'),
    journal: createFieldValue('Journal of Score Calibration', 'extracted', 0.75, 'extract'),
    volume: createFieldValue('12', 'extracted', 0.68, 'extract'),
    issue: createFieldValue('3', 'extracted', 0.66, 'extract'),
    pages: createFieldValue('200-212', 'extracted', 0.68, 'extract'),
    doi: createFieldValue(null, 'extracted', 0, 'extract'),
    publisher: createFieldValue('Example Press', 'extracted', 0.74, 'extract'),
    placeOfPublication: createFieldValue('London', 'extracted', 0.72, 'extract'),
    url: createFieldValue('https://example.org/resource', 'extracted', 0.76, 'extract'),
    conferenceTitle: createFieldValue('Proceedings of the Calibration Conference', 'extracted', 0.75, 'extract'),
    bookTitle: createFieldValue('Collected Studies in Calibration', 'extracted', 0.75, 'extract'),
    institution: createFieldValue('Example Research Institute', 'extracted', 0.74, 'extract'),
    edition: createFieldValue('2nd ed.', 'extracted', 0.72, 'extract'),
    extraction: {
      method: 'deterministic' as const,
      fallbackUsed: false,
    },
    validationIssues: [],
    ...overrides,
  } as CanonicalCitation;
}

describe('v2 score recalibration', () => {
  it('applies explicit observation penalties with a hard cap', () => {
    expect(observationPenaltyForCodes(['field_confidence_outlier'])).toBe(OBSERVATION_PENALTY_PER_CODE);
    expect(observationPenaltyForCodes([
      'field_confidence_outlier',
      'locator_unusual_shape',
      'identifier_weak_shape',
      'support_field_type_mismatch',
    ])).toBe(OBSERVATION_PENALTY_CAP);
    expect(observationPenaltyForCodes(['score_profile_fallback'])).toBe(0);
  });

  it('keeps clean complete fixtures for primary types inside the balanced band', () => {
    const journal = scoreCitation(makeCitation('journal'));
    const book = scoreCitation(makeCitation('book', {
      journal: createFieldValue(null, 'extracted', 0, 'extract'),
      bookTitle: createFieldValue(null, 'extracted', 0, 'extract'),
      volume: createFieldValue(null, 'extracted', 0, 'extract'),
      issue: createFieldValue(null, 'extracted', 0, 'extract'),
      pages: createFieldValue(null, 'extracted', 0, 'extract'),
    }));
    const report = scoreCitation(makeCitation('report', {
      authors: createFieldValue([{ first: null, last: 'World Health Organization', initials: null, literal: 'World Health Organization' }], 'extracted', 0.74, 'extract'),
      institution: createFieldValue('World Health Organization', 'extracted', 0.73, 'extract'),
      publisher: createFieldValue('World Health Organization', 'extracted', 0.73, 'extract'),
      journal: createFieldValue(null, 'extracted', 0, 'extract'),
      doi: createFieldValue(null, 'extracted', 0, 'extract'),
      url: createFieldValue(null, 'extracted', 0, 'extract'),
    }));
    const chapter = scoreCitation(makeCitation('chapter', {
      journal: createFieldValue(null, 'extracted', 0, 'extract'),
      bookTitle: createFieldValue('Collected Studies in Calibration', 'extracted', 0.73, 'extract'),
      publisher: createFieldValue('Example Press', 'extracted', 0.73, 'extract'),
    }));
    const website = scoreCitation(makeCitation('website', {
      authors: createFieldValue([], 'extracted', 0.2, 'extract'),
      year: createFieldValue(null, 'extracted', 0, 'extract'),
      title: createFieldValue('Long form title for a website scoring calibration example', 'extracted', 0.74, 'extract'),
      url: createFieldValue('https://example.org/resource', 'extracted', 0.76, 'extract'),
      journal: createFieldValue(null, 'extracted', 0, 'extract'),
      volume: createFieldValue(null, 'extracted', 0, 'extract'),
      issue: createFieldValue(null, 'extracted', 0, 'extract'),
      pages: createFieldValue(null, 'extracted', 0, 'extract'),
      doi: createFieldValue(null, 'extracted', 0, 'extract'),
      publisher: createFieldValue('Example Organization', 'extracted', 0.71, 'extract'),
    }));

    for (const result of [journal, book, report, chapter, website]) {
      expect(result.overall).toBeGreaterThanOrEqual(0.82);
      expect(result.overall).toBeLessThanOrEqual(0.88);
    }
  });

  it('prevents weak required fields from reaching ready even with partial credit', () => {
    const result = scoreCitation(makeCitation('journal', {
      title: createFieldValue('Short title', 'extracted', 0.83, 'extract'),
    }));

    expect(result.overall).toBeGreaterThan(0.6);
    expect(result.bucket).not.toBe('ready');
    expect(result.bucketReasons).toContain('Too many required fields remained weak to meet the ready threshold.');
  });

  it('requires expected support fields for journal readiness', () => {
    const result = scoreCitation(makeCitation('journal', {
      journal: createFieldValue(null, 'extracted', 0, 'extract'),
      volume: createFieldValue(null, 'extracted', 0, 'extract'),
      issue: createFieldValue(null, 'extracted', 0, 'extract'),
      pages: createFieldValue(null, 'extracted', 0, 'extract'),
    }));

    expect(result.bucket).not.toBe('ready');
    expect(result.bucketReasons).toContain('Expected support fields were too sparse to meet the ready threshold.');
  });

  it('falls back unknown score profiles to journal and records an observation code', () => {
    const result = scoreCitation(makeCitation('preprint', {
      referenceType: 'preprint',
    }));

    expect(result.observationCodes).toContain('score_profile_fallback');
  });

  it('does not fire venue-title overlap observations for chapter citations with a valid book title', () => {
    const result = scoreCitation(makeCitation('chapter', {
      title: createFieldValue('Policy instruments for environmental governance', 'extracted', 0.75, 'extract'),
      bookTitle: createFieldValue('Environmental Policy Instruments for Environmental Governance', 'extracted', 0.74, 'extract'),
    }));

    expect(result.observationCodes).not.toContain('venue_title_partial_overlap');
  });

  it('treats accepted no-op GPT rescue as score-neutral', () => {
    const baseline = scoreCitation(makeCitation('book'));
    const rescued = scoreCitation(makeCitation('book', {
      extraction: {
        method: 'llm',
        fallbackUsed: true,
        llmFallbackAttempted: true,
        llmFallbackAccepted: true,
        llmFallbackNoOpAccepted: true,
        llmFallbackFieldsImproved: [],
        llmFallbackStrictPassDelta: 0,
      },
    }));

    expect(rescued.overall).toBe(baseline.overall);
  });

  it('allows accepted GPT rescue to lower the score when repaired fields are genuinely weaker', () => {
    const baseline = scoreCitation(makeCitation('report', {
      institution: createFieldValue('World Health Organization', 'extracted', 0.82, 'extract'),
      publisher: createFieldValue('World Health Organization', 'extracted', 0.82, 'extract'),
    }));
    const rescued = scoreCitation(makeCitation('report', {
      institution: createFieldValue('WHO', 'extracted', 0.55, 'extract'),
      publisher: createFieldValue('WHO', 'extracted', 0.55, 'extract'),
      extraction: {
        method: 'llm',
        fallbackUsed: true,
        llmFallbackAttempted: true,
        llmFallbackAccepted: true,
        llmFallbackFieldsImproved: ['institution'],
        llmFallbackStrictPassDelta: 0,
      },
    }));

    expect(rescued.overall).toBeLessThan(baseline.overall);
  });

  it('validates score configuration in both directions and rejects incomplete observation codes', () => {
    expect(() => validateScoreConfiguration({
      requirementProfiles: {
        journal: {
          required: ['authors', 'title', 'year'],
          expected: ['venue'],
          optional: [],
        },
      },
      scoreProfiles: {
        journal: {
          weights: {
            requiredAverage: 0.5,
            requiredCompleteness: 0.2,
            expectedAverage: 0.15,
            expectedCompleteness: 0.15,
          },
          expectedFieldWeights: {},
          acceptableConfidenceFloors: {
            title: 0.7,
            authors: 0.7,
            year: 0.7,
            venue: 0.7,
            locator: 0.7,
            identifier: 0.7,
            support: 0.7,
          },
          weakStatePartialCredit: {
            title: 0.4,
            authors: 0.4,
            year: 0.4,
            venue: 0.4,
            locator: 0.4,
            identifier: 0.4,
            support: 0.4,
          },
          readyAcceptableRequiredMinimum: 3,
          readyExpectedFieldMinimum: 0,
        },
      },
    })).toThrow();

    expect(() => validateScoreConfiguration({
      requirementProfiles: {
        journal: {
          required: ['authors', 'title', 'year'],
          expected: [],
          optional: [],
        },
      },
      scoreProfiles: {
        journal: {
          weights: {
            requiredAverage: 0.5,
            requiredCompleteness: 0.2,
            expectedAverage: 0.15,
            expectedCompleteness: 0.15,
          },
          expectedFieldWeights: { venue: 1 },
          acceptableConfidenceFloors: {
            title: 0.7,
            authors: 0.7,
            year: 0.7,
            venue: 0.7,
            locator: 0.7,
            identifier: 0.7,
            support: 0.7,
          },
          weakStatePartialCredit: {
            title: 0.4,
            authors: 0.4,
            year: 0.4,
            venue: 0.4,
            locator: 0.4,
            identifier: 0.4,
            support: 0.4,
          },
          readyAcceptableRequiredMinimum: 3,
          readyExpectedFieldMinimum: 1,
        },
      },
    })).toThrow();

    expect(() => validateScoreConfiguration({
      observationRegistry: {
        broken: { code: 'field_confidence_outlier', penaltyType: 'broken' as any },
      },
    })).toThrow();
  });
});
