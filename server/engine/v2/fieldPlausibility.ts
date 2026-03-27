import type {
  CanonicalReferenceType,
  ExtractionCandidatePlausibility,
  FieldPlausibilityAssessment,
  ParsedReference,
} from '@shared/schema';
import { classifyLocatorToken } from '../shared/citationSemantics.js';
import {
  analyzeParsedAuthorStrings,
  bestVenueFromParsed,
  isLocatorLike,
  looksLikeAuthorContentLeak,
  looksWeakConferenceVenue,
} from './qualityRules.js';
import { normalizeWhitespace } from './utils.js';

function missing(reason = 'missing'): FieldPlausibilityAssessment {
  return { plausible: true, penalty: 0, reason };
}

function plausible(reason = 'plausible'): FieldPlausibilityAssessment {
  return { plausible: true, penalty: 0, reason };
}

function implausible(reason: string, penalty: number): FieldPlausibilityAssessment {
  return { plausible: false, penalty, reason };
}

function includesAny(value: string, parts: string[]): boolean {
  return parts.some((part) => value.includes(part));
}

export function assessAuthors(parsed: ParsedReference): FieldPlausibilityAssessment {
  if (!parsed.authors?.length) return missing();

  const signals = analyzeParsedAuthorStrings(parsed.authors);
  if (signals.contaminatedBlobCount > 0) {
    return implausible('author_content_leak', 1.1);
  }
  if (signals.mergedBlobCount > 0) {
    return implausible('merged_author_blob', 0.7);
  }
  if (signals.initialsOnlyCount >= Math.max(2, Math.ceil(parsed.authors.length * 0.7))) {
    return implausible('initials_only_authors', 0.45);
  }
  if (signals.singleCharacterTailCount > 0) {
    return implausible('single_character_tail', 0.35);
  }
  if (parsed.authors.some((author) => looksLikeAuthorContentLeak(author))) {
    return implausible('author_content_leak', 1.1);
  }

  return plausible();
}

export function assessTitle(parsed: ParsedReference): FieldPlausibilityAssessment {
  const title = normalizeWhitespace(parsed.title ?? '');
  if (!title) return missing();

  const lower = title.toLowerCase();
  if (includesAny(lower, ['https://', 'http://', 'doi.org/', '10.'])) {
    return implausible('title_contains_identifier', 1.1);
  }
  if (lower.startsWith('in ') && title.split(/\s+/).length > 5) {
    return implausible('title_starts_with_container', 0.8);
  }

  const locatorKind = classifyLocatorToken(title).kind;
  if (locatorKind !== 'title_fragment') {
    return implausible('title_looks_like_locator', 1.2);
  }

  return plausible();
}

export function assessVenue(
  parsed: ParsedReference,
  referenceType: CanonicalReferenceType,
): FieldPlausibilityAssessment {
  const venue = normalizeWhitespace(bestVenueFromParsed(parsed) ?? '');
  if (!venue) return missing();

  const lower = venue.toLowerCase();
  if (includesAny(lower, ['https://', 'http://', 'doi.org/', '10.'])) {
    return implausible('venue_contains_identifier', 1.1);
  }
  if (lower.startsWith('in ') || includesAny(lower, [' pp.', '(pp.', ' vol.', ' no.', '©'])) {
    return implausible('venue_contaminated', 0.95);
  }
  if (referenceType === 'conference' && looksWeakConferenceVenue(venue)) {
    return implausible('weak_conference_venue', 0.6);
  }

  return plausible();
}

export function assessLocator(parsed: ParsedReference): FieldPlausibilityAssessment {
  const locator = normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? '');
  if (!locator) return missing();
  if (!isLocatorLike(locator)) {
    return implausible('locator_not_plausible', 0.8);
  }
  return plausible();
}

export function assessPublisher(parsed: ParsedReference): FieldPlausibilityAssessment {
  const publisher = normalizeWhitespace(parsed.publisher ?? parsed.institution ?? '');
  if (!publisher) return missing();

  const lower = publisher.toLowerCase();
  if (lower === '©' || lower === 'copyright') {
    return implausible('publisher_is_copyright_marker', 0.9);
  }
  if (includesAny(lower, ['all rights reserved', 'copyright'])) {
    return implausible('publisher_contains_copyright_tail', 0.35);
  }

  return plausible();
}

export function assessYear(parsed: ParsedReference): FieldPlausibilityAssessment {
  const yearText = normalizeWhitespace(parsed.year ?? '');
  if (!yearText) return missing();

  const yearValue = Number.parseInt(yearText, 10);
  if (!Number.isFinite(yearValue) || yearValue < 1500 || yearValue > 2100) {
    return implausible('year_out_of_range', 1);
  }

  return plausible();
}

export function assessCandidatePlausibility(
  parsed: ParsedReference,
  referenceType: CanonicalReferenceType,
): ExtractionCandidatePlausibility {
  return {
    authors: assessAuthors(parsed),
    title: assessTitle(parsed),
    venue: assessVenue(parsed, referenceType),
    locator: assessLocator(parsed),
    publisher: assessPublisher(parsed),
    year: assessYear(parsed),
  };
}
