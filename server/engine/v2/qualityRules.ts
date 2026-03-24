import type { CanonicalAuthor, CanonicalCitation, ParsedReference } from '@shared/schema';
import { isPlaceholderFieldValue } from '@shared/referencePlaceholders';
import {
  classifyLocatorToken,
  normalizeKnownContainerName,
} from '../shared/citationSemantics.js';
import { normalizeDoiValue, normalizeWhitespace } from './utils.js';

const RAW_LOCATOR_PATTERN = /\bpp?\.?\s*[A-Z]?\d|\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d|\b\d+\(\d+\)\s*:\s*[A-Z]?\d|\bS\d+(?:[-–]S?\d+)?\b|(?:^|[\s(,;:])[A-Za-z]\d{2,}(?=$|[\s),.;:])|(?:^|[\s(,;:])\d{6,}(?=$|[\s),.;:])/i;
const STRONG_LOCATOR_PATTERN = /\b(?:pp?\.?\s*[A-Z]?\d+(?:\s*[-–]\s*[A-Z]?\d+)?|pages?\s+[A-Z]?\d+(?:\s*[-–]\s*[A-Z]?\d+)?|Art(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d+|(?:^|[\s(,;:])[A-Za-z]\d{2,}(?=$|[\s),.;:])|(?:^|[\s(,;:])\d{6,}(?=$|[\s),.;:])|\bS\d+(?:[-–]S?\d+)?)\b/i;
const COMPACT_VANCOUVER_AUTHOR_PATTERN = /^(?:[\p{Lu}][\p{L}'’-]+|d'[\p{L}'’-]+)(?:\s+(?:da|de|del|der|di|du|la|le|van|von)\s+[\p{Lu}][\p{L}'’-]+)*(?:\s+[\p{Lu}][\p{L}'’-]+)*\s+[\p{Lu}]{1,6}(?:-[\p{Lu}]{1,6})?$/u;
const AUTHOR_CONTENT_LEAK_DOI_OR_URL_PATTERN = /\b10\.\d{4,9}\/\S+|https?:\/\/\S+/i;
const AUTHOR_CONTENT_LEAK_YEAR_LOCATOR_PATTERN = /\b(?:19|20)\d{2}\b\s*[,;]\s*\d+(?:\([^)]+\))?\s*:\s*(?:[A-Za-z]?\d+|10\.)/i;
const AUTHOR_CONTENT_LEAK_SOURCE_TAIL_PATTERN = /\.\s+[A-Z][^.]{2,}\.\s+(?:19|20)\d{2}\b/;
const AUTHOR_CONTENT_LEAK_COLON_TITLE_PATTERN = /:\s+[^\d.]+(?:\s+[^\d.]+){3,}/;
const PARSED_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;
const TITLE_URL_OR_DOI_PATTERN = /\b(?:https?:\/\/\S+|(?:dx\.)?doi\.org\/\S+|10\.\d{4,9}\/\S+)\b/gi;

export function looksLikeCompactVancouverAuthorString(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return COMPACT_VANCOUVER_AUTHOR_PATTERN.test(normalized);
}

export function looksLikeAuthorContentLeak(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  if (looksLikeCompactVancouverAuthorString(normalized)) return false;
  if (AUTHOR_CONTENT_LEAK_DOI_OR_URL_PATTERN.test(normalized)) return true;
  if (AUTHOR_CONTENT_LEAK_YEAR_LOCATOR_PATTERN.test(normalized)) return true;
  if (AUTHOR_CONTENT_LEAK_SOURCE_TAIL_PATTERN.test(normalized)) return true;
  if (AUTHOR_CONTENT_LEAK_COLON_TITLE_PATTERN.test(normalized)) return true;

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount >= 12 && /[.:;]/.test(normalized);
}

export type RequirementProfile = {
  required: string[];
  expected: string[];
  optional: string[];
};

export function getRequirementProfile(referenceType: string): RequirementProfile {
  switch (referenceType) {
    case 'book':
      return {
        required: ['authors', 'title', 'year', 'publisher'],
        expected: ['edition'],
        optional: ['doi', 'url'],
      };
    case 'conference':
      return {
        required: ['authors', 'title', 'year'],
        expected: ['venue', 'locator'],
        optional: ['doi', 'url', 'publisher'],
      };
    case 'chapter':
    case 'bookChapter':
      return {
        required: ['authors', 'title', 'year', 'bookTitle'],
        expected: ['locator', 'publisher'],
        optional: ['doi', 'url'],
      };
    case 'website':
      return {
        required: ['title', 'url'],
        expected: ['authors', 'year'],
        optional: ['publisher'],
      };
    case 'report':
      return {
        required: ['title', 'year'],
        expected: ['authors', 'institution'],
        optional: ['url', 'doi'],
      };
    case 'thesis':
      return {
        required: ['authors', 'title', 'year', 'institution'],
        expected: [],
        optional: ['url', 'doi'],
      };
    case 'journal':
    default:
      return {
        required: ['authors', 'title', 'year'],
        expected: ['venue', 'volume', 'issue', 'locator'],
        optional: ['doi', 'url', 'publisher'],
      };
  }
}

export function isPlaceholderValue(value: string | null | undefined): boolean {
  return isPlaceholderFieldValue(value);
}

export function proceedingsSignal(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '').toLowerCase();
  return /\b(proceedings|conference|symposium|workshop|congress)\b/.test(normalized);
}

export function rawSuggestsLocator(raw: string): boolean {
  return RAW_LOCATOR_PATTERN.test(raw);
}

export function rawSuggestsDroppedLocator(raw: string): boolean {
  const normalized = normalizeWhitespace(raw);
  if (/\b(?:19|20)\d{2}\s*[,;]\s*\d+(?:\([^)]+\))?\s*:\s*10\.\d{4,9}\//i.test(normalized)) {
    return false;
  }
  return STRONG_LOCATOR_PATTERN.test(normalized);
}

export function isLocatorLike(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return classifyLocatorToken(normalized).kind !== 'title_fragment';
}

export function looksWeakConferenceVenue(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  if (proceedingsSignal(normalized)) return false;
  if (isPlaceholderValue(normalized)) return true;
  if (/^[A-Z]{2,8}(?:\s+\d{4})?$/.test(normalized)) return false;
  if (/\b(?:neurips|nips|icml|iclr|cvpr|eccv|iccv|aaai|ijcai|acl|emnlp|naacl|coling|sigir|kdd|uist|chi|cscw|ismb|recomb|www)\b/i.test(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 4) return false;

  return !/[A-Z]{2,}/.test(normalized) && words.length <= 2;
}

export function normalizeLocatorValue(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value ?? '')
    .replace(/^pp?\.?\s*/i, '')
    .replace(/^p\.?\s*/i, '')
    .replace(/[;,.]+$/g, '')
    .trim();

  if (!normalized) return null;
  return classifyLocatorToken(normalized).value ?? normalized;
}

export function bestVenueFromParsed(parsed: ParsedReference): string | null {
  return parsed.conferenceTitle ?? parsed.bookTitle ?? parsed.journal ?? null;
}

export function hasParsedVenue(parsed: ParsedReference): boolean {
  return Boolean(bestVenueFromParsed(parsed) && !isPlaceholderValue(bestVenueFromParsed(parsed)));
}

export function hasCitationVenue(citation: CanonicalCitation): boolean {
  return Boolean(
    [citation.conferenceTitle.value, citation.bookTitle.value, citation.journal.value]
      .find((value) => value && !isPlaceholderValue(value)),
  );
}

export function getMissingRequiredFields(citation: CanonicalCitation): string[] {
  const profile = getRequirementProfile(citation.referenceType);
  return profile.required.filter((field) => !hasCitationField(citation, field));
}

export function getMissingExpectedFields(citation: CanonicalCitation): string[] {
  if (citation.referenceType === 'journal') {
    const normalizedRaw = normalizeWhitespace(citation.raw);
    const missing: string[] = [];
    const hasVolume = Boolean(citation.volume.value);
    const hasIssue = Boolean(citation.issue.value);
    const hasLocator = hasCitationField(citation, 'locator');
    const rawSuggestsVolume = /\b(?:19|20)\d{2}\s*[,;]\s*\d+/i.test(normalizedRaw) || /\bvol\.?\s*\d+/i.test(normalizedRaw);
    const rawSuggestsIssue = /\b(?:19|20)\d{2}\s*[,;]\s*\d+\([^)]+\)/i.test(normalizedRaw) || /\bno\.?\s*\d+/i.test(normalizedRaw);
    const rawSuggestsLocator = rawSuggestsDroppedLocator(normalizedRaw)
      || /\b(?:19|20)\d{2}\s*[,;]\s*\d+(?:\([^)]+\))?\s*:\s*(?!10\.)\S+/i.test(normalizedRaw)
      || /\bpp?\.?\s*[A-Z]?\d+/i.test(normalizedRaw);

    if (!hasVolume && rawSuggestsVolume) missing.push('volume');
    if (!hasIssue && rawSuggestsIssue) missing.push('issue');
    if (!hasLocator && rawSuggestsLocator) missing.push('locator');
    return missing;
  }

  const profile = getRequirementProfile(citation.referenceType);
  return profile.expected.filter((field) => !hasCitationField(citation, field));
}

export function countStructuralValidationIssues(citation: CanonicalCitation): { severe: number; review: number } {
  const severeCodes = new Set([
    'authors_missing',
    'connector_as_author',
    'author_structure_unstable',
    'year_out_of_range',
    'parse_too_sparse',
    'protected_title_token_corrupted',
    'protected_venue_token_corrupted',
    'embedded_reference_start_in_title',
    'embedded_reference_start_in_venue',
    'multiple_doi_clusters',
    'multiple_year_anchor_clusters',
    'resolved_field_conflict',
  ]);
  const reviewCodes = new Set([
    'header_bleed_suspected',
    'header_bleed_confirmed',
    'doi_orphan_suspected',
    'doi_orphan_confirmed',
    'multiline_truncation_suspected',
    'multiline_truncation_confirmed',
    'page_artifact_suspected',
    'page_artifact_confirmed',
    'oversized_chunk_suspected',
    'oversized_chunk_confirmed',
    'initials_as_surname',
    'placeholder_volume',
    'placeholder_journal',
    'venue_missing_for_conference',
    'validation_stage_error',
    'doi_invalid_shape',
    'locator_missing_from_source',
    'ambiguous_external_match',
    'no_exact_external_match',
    'provider_no_coverage',
    'resolution_year_tolerance_applied',
  ]);

  let severe = 0;
  let review = 0;
  for (const issue of citation.validationIssues) {
    if (severeCodes.has(issue.code) || issue.severity === 'error') severe += 1;
    else if (reviewCodes.has(issue.code) || issue.severity === 'warning') review += 1;
  }
  return { severe, review };
}

export function analyzeParsedAuthorStrings(authors: string[] | undefined): {
  missing: boolean;
  mergedBlobCount: number;
  contaminatedBlobCount: number;
  compactVancouverCount: number;
  initialsOnlyCount: number;
  singleCharacterTailCount: number;
  richness: number;
} {
  if (!authors || authors.length === 0) {
    return {
      missing: true,
      mergedBlobCount: 0,
      contaminatedBlobCount: 0,
      compactVancouverCount: 0,
      initialsOnlyCount: 0,
      singleCharacterTailCount: 0,
      richness: 0,
    };
  }

  let mergedBlobCount = 0;
  let contaminatedBlobCount = 0;
  let compactVancouverCount = 0;
  let initialsOnlyCount = 0;
  let singleCharacterTailCount = 0;
  let richness = 0;

  for (const author of authors) {
    const normalized = normalizeWhitespace(author);
    if (!normalized) continue;
    const isCompactVancouver = looksLikeCompactVancouverAuthorString(normalized);
    const hasContentLeak = looksLikeAuthorContentLeak(normalized);

    if (isCompactVancouver) compactVancouverCount += 1;
    if (hasContentLeak) contaminatedBlobCount += 1;
    if (!isCompactVancouver && ((normalized.match(/,/g) ?? []).length >= 2 || /\b(?:and|&)\b/i.test(normalized))) {
      mergedBlobCount += 1;
    }
    if (/^[A-Z](?:\.?\s*[A-Z]){0,5}\.?$/i.test(normalized.replace(/\s+/g, ''))) initialsOnlyCount += 1;
    if (!isCompactVancouver && /(?:^|[\s,])\p{L}\.?$/u.test(normalized)) singleCharacterTailCount += 1;

    const initialsCount = (normalized.match(/[\p{Lu}](?=\.|\b)/gu) ?? []).length;
    if (initialsCount >= 2) richness += 1.2;
    else if (initialsCount === 1) richness += 0.6;
    if (isCompactVancouver) richness += 0.5;
    else if (/,\s*[A-Z].*[A-Z]/.test(normalized) || /^[^,]+\s+[\p{Lu}]{2,6}$/u.test(normalized)) richness += 0.8;
  }

  return {
    missing: false,
    mergedBlobCount,
    contaminatedBlobCount,
    compactVancouverCount,
    initialsOnlyCount,
    singleCharacterTailCount,
    richness: Number((richness / Math.max(authors.length, 1)).toFixed(2)),
  };
}

export function hasCanonicalMalformedAuthors(authors: CanonicalAuthor[]): boolean {
  if (authors.length === 0) return true;
  let suspiciousCount = 0;
  for (const author of authors) {
    const last = normalizeWhitespace(author.last);
    const combined = normalizeWhitespace([author.literal ?? '', author.last, author.first ?? '', author.initials ?? ''].join(' '));
    if (!last) {
      suspiciousCount += 1;
      continue;
    }
    if (/^(and|&|et)$/i.test(last)) suspiciousCount += 1;
    else if (/^[A-Z](?:\.\s*[A-Z])*\.?$/i.test(last)) suspiciousCount += 1;
    else if (last.length === 1) suspiciousCount += 1;
    else if (looksLikeAuthorContentLeak(combined)) suspiciousCount += 1;
    else if (combined.split(/\s+/).filter(Boolean).length >= 12 && /[.:;]/.test(combined)) suspiciousCount += 1;
  }
  return suspiciousCount > 0 && suspiciousCount >= Math.ceil(authors.length / 3);
}

export function sanitizeParsedReference(
  parsed: ParsedReference,
  referenceType: string,
): { parsed: ParsedReference; referenceType: string } {
  const normalizedPages = normalizeLocatorValue(parsed.pages);
  const normalizedArticleNumber = normalizeWhitespace(parsed['article-number'] ?? '') || undefined;
  const classifiedPageLocator = normalizedPages ? classifyLocatorToken(normalizedPages) : null;
  const pages =
    classifiedPageLocator?.kind === 'pages'
      ? classifiedPageLocator.value ?? undefined
      : normalizedArticleNumber
        ? normalizedPages ?? undefined
        : undefined;
  const articleNumber =
    normalizedArticleNumber
      ?? (classifiedPageLocator?.kind === 'article-number' ? classifiedPageLocator.value ?? undefined : undefined);
  const normalizedYearValue = (() => {
    const rawYear = normalizeWhitespace(parsed.year ?? '');
    if (!rawYear) return undefined;
    const matches = [...rawYear.matchAll(PARSED_YEAR_PATTERN)];
    return matches.length > 0 ? matches[matches.length - 1]?.[0] : rawYear;
  })();
  const normalizedUrlValue = normalizeLinkValue(parsed.url);
  const normalizedDoiValue = normalizeParsedDoi(parsed.doi)
    ?? (normalizedUrlValue && /^https?:\/\/(?:dx\.)?doi\.org\//i.test(normalizedUrlValue)
      ? normalizeDoiValue(normalizedUrlValue)
      : undefined);
  const sanitizedTitle = stripLinkArtifactsFromTitle(parsed.title, normalizedUrlValue, normalizedDoiValue);

  const sanitized: ParsedReference = {
    ...parsed,
    title: sanitizedTitle,
    year: normalizedYearValue,
    journal: normalizeKnownContainerName(normalizeWhitespace(parsed.journal ?? '')) || undefined,
    volume: normalizeWhitespace(parsed.volume ?? '') || undefined,
    issue: normalizeWhitespace(parsed.issue ?? '') || undefined,
    pages,
    'article-number': articleNumber,
    publisher: normalizeWhitespace(parsed.publisher ?? '') || undefined,
    url: urlDuplicatesDoi(normalizedUrlValue, normalizedDoiValue) ? undefined : normalizedUrlValue,
    conferenceTitle: normalizeKnownContainerName(normalizeWhitespace(parsed.conferenceTitle ?? '')) || undefined,
    bookTitle: normalizeKnownContainerName(normalizeWhitespace(parsed.bookTitle ?? '')) || undefined,
    institution: normalizeWhitespace(parsed.institution ?? '') || undefined,
    edition: normalizeWhitespace(parsed.edition ?? '') || undefined,
    editor: normalizeWhitespace(parsed.editor ?? '') || undefined,
    doi: normalizedDoiValue,
    authors: parsed.authors?.map((author) => normalizeWhitespace(author)).filter(Boolean),
  };

  if (isPlaceholderValue(sanitized.journal)) sanitized.journal = undefined;
  if (isPlaceholderValue(sanitized.volume)) sanitized.volume = undefined;
  if (isPlaceholderValue(sanitized.issue)) sanitized.issue = undefined;

  let nextReferenceType = referenceType;
  const journalVenue = sanitized.journal;
  if (!sanitized.conferenceTitle && journalVenue && proceedingsSignal(journalVenue)) {
    sanitized.conferenceTitle = journalVenue;
    sanitized.journal = undefined;
    nextReferenceType = 'conference';
  }

  return {
    parsed: sanitized,
    referenceType: nextReferenceType,
  };
}

function normalizeLinkValue(value: string | null | undefined): string | undefined {
  const normalized = normalizeWhitespace(value ?? '');
  return normalized ? normalized.replace(/[)\],.;:]+$/g, '') : undefined;
}

function normalizeParsedDoi(value: string | null | undefined): string | undefined {
  const normalized = normalizeLinkValue(value);
  return normalized ? normalizeDoiValue(normalized) : undefined;
}

function stripLinkArtifactsFromTitle(
  value: string | null | undefined,
  url: string | undefined,
  doi: string | undefined,
): string | undefined {
  let normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return undefined;

  for (const artifact of [url, doi, doi ? `https://doi.org/${doi}` : undefined]) {
    if (!artifact) continue;
    const escaped = artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalizeWhitespace(normalized.replace(new RegExp(escaped, 'ig'), ' '));
  }

  normalized = normalizeWhitespace(
    normalized
      .replace(TITLE_URL_OR_DOI_PATTERN, ' ')
      .replace(/\(\s*\)/g, ' ')
      .replace(/\[\s*\]/g, ' '),
  ).replace(/^[\s,.;:()[\]{}"'-]+|[\s,.;:()[\]{}"'-]+$/g, '');

  return normalized || undefined;
}

function urlDuplicatesDoi(url: string | undefined, doi: string | undefined): boolean {
  if (!url || !doi) return false;
  if (!/^https?:\/\/(?:dx\.)?doi\.org\//i.test(url)) return false;
  return normalizeDoiValue(url).toLowerCase() === doi.toLowerCase();
}

function hasCitationField(citation: CanonicalCitation, field: string): boolean {
  switch (field) {
    case 'authors':
      return citation.authors.value.length > 0;
    case 'title':
      return Boolean(citation.title.value);
    case 'year':
      return citation.year.value != null;
    case 'venue':
      return hasCitationVenue(citation);
    case 'volume':
      return Boolean(citation.volume.value);
    case 'issue':
      return Boolean(citation.issue.value);
    case 'locator':
      return isLocatorLike(citation.pages.value);
    case 'publisher':
      return Boolean(citation.publisher.value);
    case 'institution':
      return Boolean(citation.institution.value);
    case 'bookTitle':
      return Boolean(citation.bookTitle.value);
    case 'edition':
      return Boolean(citation.edition.value);
    case 'url':
      return Boolean(citation.url.value);
    case 'doi':
      return Boolean(citation.doi.value);
    default:
      return false;
  }
}
