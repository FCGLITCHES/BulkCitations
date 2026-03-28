import type {
  CanonicalReferenceType,
  ExtractionCandidatePlausibility,
  FieldPlausibilityAssessment,
  ParsedReference,
} from '@shared/schema';
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

function titleLooksLikeSourceTail(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return /^(?:[A-Z][A-Za-z'’.-]+(?:,\s*[A-Z][A-Za-z'’.-]+){0,3}):\s+.+(?:19|20)\d{2}$/u.test(normalized)
    || /;\s*(?:1[5-9]\d{2}|20\d{2})$/.test(normalized)
    || /\b(?:available from|viewed|accessed|all rights reserved)\b/i.test(normalized);
}

function titleLooksLikePureLocator(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;

  const compact = normalized
    .replace(/^article\s+/i, '')
    .replace(/^(?:pp?\.?|pages?|doi)\s*/i, '')
    .replace(/\bdoi\b\.?$/i, '')
    .replace(/[()]/g, '')
    .trim();
  if (!compact) return false;

  if (/^(?:pp?\.?\s*)?[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?(?:\.\s*doi\.?)?$/i.test(normalized)) {
    return true;
  }
  if (/^(?:pp?\.?\s*)?[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?\s+doi\.?$/i.test(normalized)) {
    return true;
  }

  if (/^[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?$/i.test(compact)) return true;
  if (/^[A-Z]\d+[a-z]?\d*$/i.test(compact)) return true;

  const tokens = compact
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !/^(?:pp?\.?|pages?|doi)$/i.test(token));
  if (tokens.length > 3) return false;

  return tokens.every((token) => /^[A-Za-z]?\d+[A-Za-z.-]*$/i.test(token));
}

function titleLooksLikeEmbeddedMetadataNote(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return /\((?:Report No\.?|Working Paper No\.?|Technical Note|Policy Brief|Doctoral dissertation|PhD dissertation|Master'?s thesis|Master'?s dissertation)\b[^)]*\)/i.test(normalized)
    || /\bReport No\.?\s*[A-Z0-9-]+/i.test(normalized);
}

function looksLikeSentenceAuthorBlob(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (!/[.:;]/.test(normalized)) return false;
  if (normalized.split(/\s+/).length < 5) return false;
  return true;
}

function looksLikeLegitimateInitialAuthor(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return /^[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+)*,\s*[\p{Lu}](?:\.\s*[\p{Lu}]\.)*\.?$/u.test(normalized)
    || /^[\p{Lu}](?:\.\s*[\p{Lu}]\.)*\s+[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+)*$/u.test(normalized);
}

function venueLooksLikePublisherTail(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return /;\s*(?:1[5-9]\d{2}|20\d{2})$/i.test(normalized)
    || /:\s*[^.;]+\b(?:press|publisher|organization|agency|department|ministry|office|commission|council|bank|foundation|university|institute|society|association|hub|portal|observatory|network|unit)\b/i.test(normalized)
    || /[)\]]\s+[A-Z][^.;]+:\s*[^.;]+$/u.test(normalized);
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
  if (
    signals.singleCharacterTailCount > 0
    && parsed.authors.length >= 2
    && parsed.authors.some((author) => !looksLikeLegitimateInitialAuthor(author))
  ) {
    return implausible('single_character_tail', 0.35);
  }
  if (parsed.authors.some((author) => looksLikeAuthorContentLeak(author))) {
    return implausible('author_content_leak', 1.1);
  }
  if (parsed.authors.some((author) => looksLikeSentenceAuthorBlob(author))) {
    return implausible('sentence_like_author_blob', 1.15);
  }

  return plausible();
}

export function assessTitle(parsed: ParsedReference): FieldPlausibilityAssessment {
  const title = normalizeWhitespace(parsed.title ?? '');
  if (!title) return missing();

  const lower = title.toLowerCase();
  if (['available', 'available from', 'accessed', 'viewed', 'doi', 'online'].includes(lower)) {
    return implausible('title_is_metadata_label', 1.2);
  }
  if (includesAny(lower, ['https://', 'http://', 'doi.org/', '10.'])) {
    return implausible('title_contains_identifier', 1.1);
  }
  if (titleLooksLikeSourceTail(title)) {
    return implausible('title_looks_like_source_tail', 1.1);
  }
  if (titleLooksLikeEmbeddedMetadataNote(title)) {
    return implausible('title_contains_metadata_note', 1.05);
  }
  if (lower.startsWith('in ') && title.split(/\s+/).length > 5) {
    return implausible('title_starts_with_container', 0.8);
  }
  if (/[."]\s+in\s+[A-Z]/i.test(title) || /\bproceedings of the\b/i.test(title)) {
    return implausible('title_contains_container_phrase', 1.05);
  }
  if (titleLooksLikePureLocator(title)) {
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
  if (/\b(?:ver\.?|version)\b/i.test(venue)) {
    return implausible('venue_contains_version_marker', 1.05);
  }
  if (venueLooksLikePublisherTail(venue)) {
    return implausible('venue_contains_publisher_tail', 1.1);
  }
  if (/[-–:]$/.test(venue)) {
    return implausible('venue_truncated_fragment', 1.05);
  }
  if (lower.startsWith('in ') || includesAny(lower, [' pp.', '(pp.', ' vol.', ' no.', '©'])) {
    return implausible('venue_contaminated', 0.95);
  }
  if (
    referenceType === 'conference'
    && looksWeakConferenceVenue(venue)
    && !normalizeWhitespace(parsed.publisher ?? '')
  ) {
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
  if (/^[^.;]{1,80}:\s+[^.;]+$/u.test(publisher)) {
    return implausible('publisher_contains_place_prefix', 1.1);
  }
  if (
    /\b(?:report\s+no\.?|working paper|technical note|policy brief)\b/i.test(publisher)
    || /[)\]]\s*[:;,-]/.test(publisher)
    || /\b[A-Z]{2,}(?:-[A-Z0-9]{2,}){1,}\)?/.test(publisher)
  ) {
    return implausible('publisher_contains_metadata_tail', 1.15);
  }
  if (lower === '©' || lower === 'copyright') {
    return implausible('publisher_is_copyright_marker', 0.9);
  }
  if (includesAny(lower, ['all rights reserved', 'copyright'])) {
    return implausible('publisher_contains_copyright_tail', 0.35);
  }
  if (
    includesAny(lower, ['https://', 'http://', 'www.'])
    || /\b[a-z0-9.-]+\.[a-z]{2,}\/\S*/i.test(publisher)
    || (/[/\\]/.test(publisher) && !/\s/.test(publisher))
  ) {
    return implausible('publisher_contains_url_fragment', 1.2);
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
