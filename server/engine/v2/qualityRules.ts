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

export type ScoreProfileKey =
  | 'journal'
  | 'book'
  | 'report'
  | 'chapter'
  | 'website'
  | 'conference'
  | 'thesis';

export type ScoreFieldCategory =
  | 'title'
  | 'authors'
  | 'year'
  | 'venue'
  | 'locator'
  | 'identifier'
  | 'support';

export type FieldState = 'missing' | 'weak' | 'acceptable';

export type ObservationPenaltyType = 'contradiction' | 'informational';

export type ObservationCode =
  | 'field_confidence_outlier'
  | 'venue_title_partial_overlap'
  | 'locator_unusual_shape'
  | 'identifier_weak_shape'
  | 'support_field_type_mismatch'
  | 'score_profile_fallback';

export type ScoreFormulaWeights = {
  requiredAverage: number;
  requiredCompleteness: number;
  expectedAverage: number;
  expectedCompleteness: number;
};

export type ScoreProfile = {
  weights: ScoreFormulaWeights;
  expectedFieldWeights: Record<string, number>;
  acceptableConfidenceFloors: Record<ScoreFieldCategory, number>;
  weakStatePartialCredit: Record<ScoreFieldCategory, number>;
  readyAcceptableRequiredMinimum: number;
  readyExpectedFieldMinimum: number;
};

export type ObservationCodeDefinition = {
  code: ObservationCode;
  penaltyType: ObservationPenaltyType;
};

export type ScoreProfileSelection = {
  profileKey: ScoreProfileKey;
  profile: ScoreProfile;
  usedFallback: boolean;
};

export type ScoreFieldEvaluation = {
  field: string;
  category: ScoreFieldCategory;
  state: FieldState;
  present: boolean;
  confidence: number;
  scoreCredit: number;
  completenessCredit: number;
  normalizedValue: string;
};

export const OBSERVATION_PENALTY_PER_CODE = 0.02;
export const OBSERVATION_PENALTY_CAP = 0.06;

const REQUIREMENT_PROFILES: Record<string, RequirementProfile> = {
  journal: {
    required: ['authors', 'title', 'year'],
    expected: ['venue', 'volume', 'issue', 'locator'],
    optional: ['doi', 'url', 'publisher'],
  },
  book: {
    required: ['authors', 'title', 'year', 'publisher'],
    expected: ['edition', 'placeOfPublication'],
    optional: ['doi', 'url'],
  },
  conference: {
    required: ['authors', 'title', 'year'],
    expected: ['venue', 'locator'],
    optional: ['doi', 'url', 'publisher'],
  },
  chapter: {
    required: ['authors', 'title', 'year', 'bookTitle'],
    expected: ['locator', 'publisher'],
    optional: ['doi', 'url'],
  },
  bookChapter: {
    required: ['authors', 'title', 'year', 'bookTitle'],
    expected: ['locator', 'publisher'],
    optional: ['doi', 'url'],
  },
  website: {
    required: ['title', 'url'],
    expected: [],
    optional: ['authors', 'year', 'publisher'],
  },
  report: {
    required: ['title', 'year'],
    expected: ['authors', 'institution'],
    optional: ['url', 'doi'],
  },
  thesis: {
    required: ['authors', 'title', 'year', 'institution'],
    expected: [],
    optional: ['url', 'doi'],
  },
};

const SCORE_PROFILES: Record<ScoreProfileKey, ScoreProfile> = {
  journal: {
    weights: {
      requiredAverage: 0.45,
      requiredCompleteness: 0.21,
      expectedAverage: 0.18,
      expectedCompleteness: 0.16,
    },
    expectedFieldWeights: {
      venue: 0.4,
      volume: 0.2,
      issue: 0.15,
      locator: 0.25,
    },
    acceptableConfidenceFloors: {
      title: 0.72,
      authors: 0.72,
      year: 0.78,
      venue: 0.68,
      locator: 0.62,
      identifier: 0.72,
      support: 0.64,
    },
    weakStatePartialCredit: {
      title: 0.45,
      authors: 0.4,
      year: 0.55,
      venue: 0.35,
      locator: 0.3,
      identifier: 0.3,
      support: 0.35,
    },
    readyAcceptableRequiredMinimum: 3,
    readyExpectedFieldMinimum: 1,
  },
  book: {
    weights: {
      requiredAverage: 0.48,
      requiredCompleteness: 0.22,
      expectedAverage: 0.12,
      expectedCompleteness: 0.18,
    },
    expectedFieldWeights: {
      edition: 0.4,
      placeOfPublication: 0.6,
    },
    acceptableConfidenceFloors: {
      title: 0.72,
      authors: 0.74,
      year: 0.78,
      venue: 0.66,
      locator: 0.6,
      identifier: 0.72,
      support: 0.68,
    },
    weakStatePartialCredit: {
      title: 0.45,
      authors: 0.42,
      year: 0.55,
      venue: 0.32,
      locator: 0.3,
      identifier: 0.3,
      support: 0.4,
    },
    readyAcceptableRequiredMinimum: 4,
    readyExpectedFieldMinimum: 1,
  },
  report: {
    weights: {
      requiredAverage: 0.45,
      requiredCompleteness: 0.2,
      expectedAverage: 0.13,
      expectedCompleteness: 0.22,
    },
    expectedFieldWeights: {
      authors: 0.45,
      institution: 0.55,
    },
    acceptableConfidenceFloors: {
      title: 0.72,
      authors: 0.72,
      year: 0.78,
      venue: 0.62,
      locator: 0.58,
      identifier: 0.7,
      support: 0.68,
    },
    weakStatePartialCredit: {
      title: 0.45,
      authors: 0.38,
      year: 0.55,
      venue: 0.28,
      locator: 0.28,
      identifier: 0.28,
      support: 0.42,
    },
    readyAcceptableRequiredMinimum: 2,
    readyExpectedFieldMinimum: 1,
  },
  chapter: {
    weights: {
      requiredAverage: 0.46,
      requiredCompleteness: 0.22,
      expectedAverage: 0.13,
      expectedCompleteness: 0.19,
    },
    expectedFieldWeights: {
      locator: 0.55,
      publisher: 0.45,
    },
    acceptableConfidenceFloors: {
      title: 0.72,
      authors: 0.74,
      year: 0.78,
      venue: 0.68,
      locator: 0.62,
      identifier: 0.72,
      support: 0.66,
    },
    weakStatePartialCredit: {
      title: 0.45,
      authors: 0.4,
      year: 0.55,
      venue: 0.35,
      locator: 0.34,
      identifier: 0.3,
      support: 0.38,
    },
    readyAcceptableRequiredMinimum: 4,
    readyExpectedFieldMinimum: 1,
  },
  website: {
    weights: {
      requiredAverage: 0.6,
      requiredCompleteness: 0.4,
      expectedAverage: 0,
      expectedCompleteness: 0,
    },
    expectedFieldWeights: {},
    acceptableConfidenceFloors: {
      title: 0.72,
      authors: 0.72,
      year: 0.76,
      venue: 0.62,
      locator: 0.58,
      identifier: 0.74,
      support: 0.62,
    },
    weakStatePartialCredit: {
      title: 0.45,
      authors: 0.38,
      year: 0.5,
      venue: 0.3,
      locator: 0.28,
      identifier: 0.35,
      support: 0.34,
    },
    readyAcceptableRequiredMinimum: 2,
    readyExpectedFieldMinimum: 0,
  },
  conference: {
    weights: {
      requiredAverage: 0.47,
      requiredCompleteness: 0.21,
      expectedAverage: 0.15,
      expectedCompleteness: 0.17,
    },
    expectedFieldWeights: {
      venue: 0.55,
      locator: 0.45,
    },
    acceptableConfidenceFloors: {
      title: 0.72,
      authors: 0.74,
      year: 0.78,
      venue: 0.68,
      locator: 0.62,
      identifier: 0.72,
      support: 0.64,
    },
    weakStatePartialCredit: {
      title: 0.45,
      authors: 0.4,
      year: 0.55,
      venue: 0.35,
      locator: 0.34,
      identifier: 0.3,
      support: 0.34,
    },
    readyAcceptableRequiredMinimum: 3,
    readyExpectedFieldMinimum: 1,
  },
  thesis: {
    weights: {
      requiredAverage: 0.52,
      requiredCompleteness: 0.24,
      expectedAverage: 0,
      expectedCompleteness: 0.24,
    },
    expectedFieldWeights: {},
    acceptableConfidenceFloors: {
      title: 0.72,
      authors: 0.74,
      year: 0.78,
      venue: 0.62,
      locator: 0.58,
      identifier: 0.7,
      support: 0.68,
    },
    weakStatePartialCredit: {
      title: 0.45,
      authors: 0.4,
      year: 0.55,
      venue: 0.3,
      locator: 0.28,
      identifier: 0.28,
      support: 0.4,
    },
    readyAcceptableRequiredMinimum: 4,
    readyExpectedFieldMinimum: 0,
  },
};

const OBSERVATION_CODE_REGISTRY: Record<ObservationCode, ObservationCodeDefinition> = {
  field_confidence_outlier: { code: 'field_confidence_outlier', penaltyType: 'contradiction' },
  venue_title_partial_overlap: { code: 'venue_title_partial_overlap', penaltyType: 'contradiction' },
  locator_unusual_shape: { code: 'locator_unusual_shape', penaltyType: 'contradiction' },
  identifier_weak_shape: { code: 'identifier_weak_shape', penaltyType: 'contradiction' },
  support_field_type_mismatch: { code: 'support_field_type_mismatch', penaltyType: 'contradiction' },
  score_profile_fallback: { code: 'score_profile_fallback', penaltyType: 'informational' },
};

const SCORE_PROFILE_FALLBACK_REFERENCE_TYPES = new Set([
  'unknown',
  'preprint',
  'standard',
  'patent',
  'dataset',
]);

export function getRequirementProfile(referenceType: string): RequirementProfile {
  return REQUIREMENT_PROFILES[referenceType] ?? REQUIREMENT_PROFILES.journal;
}

export function getScoreProfile(referenceType: string): ScoreProfileSelection {
  if ((referenceType as ScoreProfileKey) in SCORE_PROFILES) {
    const profileKey = referenceType as ScoreProfileKey;
    return {
      profileKey,
      profile: SCORE_PROFILES[profileKey],
      usedFallback: false,
    };
  }

  if (SCORE_PROFILE_FALLBACK_REFERENCE_TYPES.has(referenceType)) {
    return {
      profileKey: 'journal',
      profile: SCORE_PROFILES.journal,
      usedFallback: true,
    };
  }

  return {
    profileKey: 'journal',
    profile: SCORE_PROFILES.journal,
    usedFallback: true,
  };
}

export function getObservationCodeRegistry(): Record<ObservationCode, ObservationCodeDefinition> {
  return OBSERVATION_CODE_REGISTRY;
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
    const looksLikeInvertedInitialsAuthor = /^[^,]+,\s*(?:[\p{Lu}]\.?\s*){2,6}$/u.test(normalized);
    const hasContentLeak = looksLikeAuthorContentLeak(normalized);

    if (isCompactVancouver) compactVancouverCount += 1;
    if (hasContentLeak) contaminatedBlobCount += 1;
    if (!isCompactVancouver && ((normalized.match(/,/g) ?? []).length >= 2 || /\b(?:and|&)\b/i.test(normalized))) {
      mergedBlobCount += 1;
    }
    if (/^[A-Z](?:\.?\s*[A-Z]){0,5}\.?$/i.test(normalized.replace(/\s+/g, ''))) initialsOnlyCount += 1;
    if (!isCompactVancouver && !looksLikeInvertedInitialsAuthor && /(?:^|[\s,])\p{L}\.?$/u.test(normalized)) singleCharacterTailCount += 1;

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

function stripTrailingVenueArtifacts(value: string | null | undefined): string | undefined {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return undefined;

  const cleaned = normalizeWhitespace(
    normalized
      .replace(/,\s*vol\.?$/i, '')
      .replace(/\s+vol\.?$/i, '')
      .replace(/,\s*no\.?$/i, '')
      .replace(/\s+no\.?$/i, '')
      .replace(/[.;,:-]+$/g, ''),
  );

  return cleaned || undefined;
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
    journal: stripTrailingVenueArtifacts(normalizeKnownContainerName(normalizeWhitespace(parsed.journal ?? ''))),
    volume: normalizeWhitespace(parsed.volume ?? '') || undefined,
    issue: normalizeWhitespace(parsed.issue ?? '') || undefined,
    pages,
    'article-number': articleNumber,
    publisher: normalizeWhitespace(parsed.publisher ?? '') || undefined,
    url: urlDuplicatesDoi(normalizedUrlValue, normalizedDoiValue) ? undefined : normalizedUrlValue,
    conferenceTitle: stripTrailingVenueArtifacts(normalizeKnownContainerName(normalizeWhitespace(parsed.conferenceTitle ?? ''))),
    bookTitle: stripTrailingVenueArtifacts(normalizeKnownContainerName(normalizeWhitespace(parsed.bookTitle ?? ''))),
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
  if (!normalized) return undefined;

  let trimmed = normalized.replace(/[\],.;:]+$/g, '');
  while (trimmed.endsWith(')')) {
    const candidate = trimmed.slice(0, -1);
    const openCount = (candidate.match(/\(/g) ?? []).length;
    const closeCount = (candidate.match(/\)/g) ?? []).length;
    if (closeCount < openCount) break;
    trimmed = candidate;
  }
  return trimmed || undefined;
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
  );

  const normalizedBeforeStrip = normalized;
  normalized = normalizedBeforeStrip.replace(/^[\s,.;:()[\]{}"'-]+|[\s,.;:()[\]{}"'-]+$/g, '');
  if (!normalized.endsWith(')')) {
    const openCount = (normalized.match(/\(/g) ?? []).length;
    const closeCount = (normalized.match(/\)/g) ?? []).length;
    if (openCount > closeCount && normalizedBeforeStrip.includes(`${normalized})`)) {
      normalized = `${normalized}${')'.repeat(openCount - closeCount)}`;
    }
  }

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
    case 'placeOfPublication':
      return Boolean(citation.placeOfPublication.value);
    case 'url':
      return Boolean(citation.url.value);
    case 'doi':
      return Boolean(citation.doi.value);
    default:
      return false;
  }
}

function normalizeScoreText(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTextTokenCount(value: string | null | undefined): number {
  return normalizeScoreText(value)
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function isAbbreviationOnlyVenue(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  if (/^(?:BMJ|JAMA|NEJM|PNAS|IEEE|ACM|EMA|WHO|ICCIC|ICML|ICLR|CVPR|ECCV|ICCV|AAAI|IJCAI|ACL|EMNLP|NAACL|COLING|SIGIR|KDD|UIST|CHI|CSCW|ISMB|RECOMB|NEURIPS|NIPS)$/i.test(normalized)) {
    return false;
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  return tokens.every((token) => /^[A-Z]{1,8}\.?$/u.test(token));
}

function normalizedAuthorSummary(authors: CanonicalAuthor[]): string {
  return authors
    .map((author) => normalizeWhitespace(author.literal ?? [author.last, author.first ?? author.initials ?? ''].filter(Boolean).join(', ')))
    .filter(Boolean)
    .join(' | ');
}

function getVenueValue(citation: CanonicalCitation): string | null {
  switch (citation.referenceType) {
    case 'journal':
      return citation.journal.value;
    case 'conference':
      return citation.conferenceTitle.value ?? citation.bookTitle.value ?? citation.journal.value ?? citation.publisher.value;
    case 'chapter':
      return citation.bookTitle.value ?? citation.publisher.value;
    case 'thesis':
      return citation.institution.value ?? citation.publisher.value;
    case 'report':
      return citation.institution.value ?? citation.publisher.value ?? citation.journal.value;
    case 'website':
      return citation.publisher.value ?? citation.journal.value;
    case 'book':
      return citation.publisher.value ?? citation.bookTitle.value;
    default:
      return citation.journal.value ?? citation.bookTitle.value ?? citation.publisher.value;
  }
}

function getVenueConfidence(citation: CanonicalCitation): number {
  switch (citation.referenceType) {
    case 'conference':
      return Math.max(citation.conferenceTitle.confidence, citation.bookTitle.confidence, citation.journal.confidence, citation.publisher.confidence);
    case 'chapter':
      return Math.max(citation.bookTitle.confidence, citation.publisher.confidence);
    case 'thesis':
      return Math.max(citation.institution.confidence, citation.publisher.confidence);
    case 'report':
      return Math.max(citation.institution.confidence, citation.publisher.confidence, citation.journal.confidence);
    case 'website':
      return Math.max(citation.publisher.confidence, citation.journal.confidence, citation.url.confidence);
    case 'book':
      return Math.max(citation.publisher.confidence, citation.bookTitle.confidence);
    default:
      return Math.max(citation.journal.confidence, citation.publisher.confidence, citation.bookTitle.confidence);
  }
}

function getFieldCategory(field: string): ScoreFieldCategory {
  switch (field) {
    case 'title':
      return 'title';
    case 'authors':
      return 'authors';
    case 'year':
      return 'year';
    case 'journal':
    case 'conferenceTitle':
    case 'bookTitle':
    case 'venue':
      return 'venue';
    case 'volume':
    case 'issue':
    case 'pages':
    case 'locator':
      return 'locator';
    case 'doi':
    case 'url':
      return 'identifier';
    default:
      return 'support';
  }
}

function getFieldConfidence(citation: CanonicalCitation, field: string): number {
  switch (field) {
    case 'authors':
      return citation.authors.confidence;
    case 'title':
      return citation.title.confidence;
    case 'year':
      return citation.year.confidence;
    case 'venue':
      return getVenueConfidence(citation);
    case 'journal':
      return citation.journal.confidence;
    case 'conferenceTitle':
      return citation.conferenceTitle.confidence;
    case 'bookTitle':
      return citation.bookTitle.confidence;
    case 'volume':
      return citation.volume.confidence;
    case 'issue':
      return citation.issue.confidence;
    case 'locator':
    case 'pages':
      return citation.pages.confidence;
    case 'doi':
      return citation.doi.confidence;
    case 'url':
      return citation.url.confidence;
    case 'publisher':
      return citation.publisher.confidence;
    case 'institution':
      return citation.institution.confidence;
    case 'edition':
      return citation.edition.confidence;
    case 'placeOfPublication':
      return citation.placeOfPublication.confidence;
    default:
      return 0;
  }
}

function getFieldRawValue(citation: CanonicalCitation, field: string): unknown {
  switch (field) {
    case 'authors':
      return citation.authors.value;
    case 'title':
      return citation.title.value;
    case 'year':
      return citation.year.value;
    case 'venue':
      return getVenueValue(citation);
    case 'journal':
      return citation.journal.value;
    case 'conferenceTitle':
      return citation.conferenceTitle.value;
    case 'bookTitle':
      return citation.bookTitle.value;
    case 'volume':
      return citation.volume.value;
    case 'issue':
      return citation.issue.value;
    case 'locator':
    case 'pages':
      return citation.pages.value;
    case 'doi':
      return citation.doi.value;
    case 'url':
      return citation.url.value;
    case 'publisher':
      return citation.publisher.value;
    case 'institution':
      return citation.institution.value;
    case 'edition':
      return citation.edition.value;
    case 'placeOfPublication':
      return citation.placeOfPublication.value;
    default:
      return null;
  }
}

function getFieldNormalizedValue(citation: CanonicalCitation, field: string): string {
  const rawValue = getFieldRawValue(citation, field);
  if (field === 'authors') {
    return normalizedAuthorSummary((rawValue as CanonicalAuthor[]) ?? []);
  }
  if (field === 'year') {
    return rawValue == null ? '' : String(rawValue);
  }
  return normalizeScoreText(typeof rawValue === 'string' ? rawValue : String(rawValue ?? ''));
}

function weakTitle(value: string | null | undefined, confidence: number, floor: number): boolean {
  const normalized = normalizeScoreText(value);
  const tokenCount = scoreTextTokenCount(value);
  if (/^(?:short|sample|example|test)\s+title$/i.test(normalized)) return true;
  if (tokenCount <= 1) return confidence < Math.max(0.88, floor + 0.08);
  if (tokenCount === 2) return false;
  return false;
}

function weakAuthors(authors: CanonicalAuthor[]): boolean {
  if (authors.length === 0) return false;
  const firstAuthor = authors[0];
  const surname = normalizeWhitespace(firstAuthor?.last ?? '');
  if (!surname || surname.length === 1) return true;
  const hasGivenName = Boolean(normalizeWhitespace(firstAuthor?.first ?? '') || normalizeWhitespace(firstAuthor?.initials ?? ''));
  if (hasGivenName) return false;
  const literal = normalizeWhitespace(firstAuthor?.literal ?? '');
  const surnameTokens = surname.split(/\s+/).filter(Boolean);
  if (literal || surnameTokens.length >= 2) {
    return false;
  }
  return true;
}

function weakYear(value: number | null | undefined): boolean {
  if (value == null) return false;
  const currentYear = new Date().getUTCFullYear();
  return value < 100 || value > currentYear + 2;
}

function weakVenue(value: string | null | undefined, confidence: number): boolean {
  return confidence < 0.5 || isAbbreviationOnlyVenue(value);
}

function weakLocator(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  if (normalized.length === 1 && !/\d/.test(normalized)) return true;
  return classifyLocatorToken(normalized).kind === 'title_fragment';
}

function weakIdentifier(field: 'doi' | 'url', value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  if (field === 'doi') {
    return !/^10\.\d{4,9}\/\S+$/i.test(normalizeDoiValue(normalized));
  }
  return !/^https?:\/\/\S+$/i.test(normalized);
}

function weakSupport(value: string | null | undefined, confidence: number): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  const truncated = normalized.length <= 2;
  return confidence < 0.45 || isPlaceholderValue(normalized) || truncated;
}

export function evaluateScoreField(
  citation: CanonicalCitation,
  field: string,
  profile?: ScoreProfile,
): ScoreFieldEvaluation {
  const selectedProfile = profile ?? getScoreProfile(citation.referenceType).profile;
  const category = getFieldCategory(field);
  const confidence = getFieldConfidence(citation, field);
  const normalizedValue = getFieldNormalizedValue(citation, field);
  const present = field === 'authors'
    ? citation.authors.value.length > 0
    : field === 'year'
      ? citation.year.value != null
      : field === 'locator'
        ? Boolean(citation.pages.value)
        : Boolean(getFieldRawValue(citation, field));

  if (!present || !normalizedValue) {
    return {
      field,
      category,
      state: 'missing',
      present: false,
      confidence,
      scoreCredit: 0,
      completenessCredit: 0,
      normalizedValue: '',
    };
  }

  let weak = false;
  switch (category) {
    case 'title':
      weak = weakTitle(citation.title.value, confidence, selectedProfile.acceptableConfidenceFloors.title)
        || confidence < selectedProfile.acceptableConfidenceFloors.title;
      break;
    case 'authors':
      weak = weakAuthors(citation.authors.value) || confidence < selectedProfile.acceptableConfidenceFloors.authors;
      break;
    case 'year':
      weak = weakYear(citation.year.value) || confidence < selectedProfile.acceptableConfidenceFloors.year;
      break;
    case 'venue':
      weak = weakVenue(String(getFieldRawValue(citation, field) ?? ''), confidence)
        || confidence < selectedProfile.acceptableConfidenceFloors.venue;
      break;
    case 'locator':
      weak = weakLocator(String(getFieldRawValue(citation, field) ?? ''))
        || confidence < selectedProfile.acceptableConfidenceFloors.locator;
      break;
    case 'identifier':
      weak = weakIdentifier(field === 'doi' ? 'doi' : 'url', String(getFieldRawValue(citation, field) ?? ''))
        || confidence < selectedProfile.acceptableConfidenceFloors.identifier;
      break;
    case 'support':
      weak = weakSupport(String(getFieldRawValue(citation, field) ?? ''), confidence)
        || confidence < selectedProfile.acceptableConfidenceFloors.support;
      break;
  }

  if (!weak) {
    return {
      field,
      category,
      state: 'acceptable',
      present: true,
      confidence,
      scoreCredit: confidence,
      completenessCredit: 1,
      normalizedValue,
    };
  }

  const credit = selectedProfile.weakStatePartialCredit[category];
  return {
    field,
    category,
    state: 'weak',
    present: true,
    confidence,
    scoreCredit: Number((confidence * credit).toFixed(4)),
    completenessCredit: credit,
    normalizedValue,
  };
}

function contiguousOverlap(left: string | null | undefined, right: string | null | undefined, minTokens: number): boolean {
  const leftTokens = normalizeScoreText(left).split(/\s+/).filter(Boolean);
  const rightTokens = normalizeScoreText(right).split(/\s+/).filter(Boolean);
  if (leftTokens.length < minTokens || rightTokens.length < minTokens) return false;
  const rightJoined = rightTokens.join(' ');
  for (let index = 0; index <= leftTokens.length - minTokens; index += 1) {
    const span = leftTokens.slice(index, index + minTokens).join(' ');
    if (rightJoined.includes(span)) return true;
  }
  return false;
}

function looksSupportTypeMismatch(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return /^https?:\/\//i.test(normalized) || /^10\.\d{4,9}\//i.test(normalized) || /^\d+$/.test(normalized);
}

export function collectScoreObservationCodes(
  citation: CanonicalCitation,
  profileSelection?: ScoreProfileSelection,
): ObservationCode[] {
  const selection = profileSelection ?? getScoreProfile(citation.referenceType);
  const codes: ObservationCode[] = [];
  const required = getRequirementProfile(citation.referenceType).required;
  const requiredEvaluations = required.map((field) => evaluateScoreField(citation, field, selection.profile));
  const presentRequired = requiredEvaluations.filter((evaluation) => evaluation.present);

  if (selection.usedFallback) {
    codes.push('score_profile_fallback');
  }

  if (presentRequired.length >= 2) {
    const averageConfidence = presentRequired.reduce((sum, evaluation) => sum + evaluation.confidence, 0) / presentRequired.length;
    if (presentRequired.some((evaluation) => evaluation.confidence <= averageConfidence - 0.25)) {
      codes.push('field_confidence_outlier');
    }
  }

  if (
    citation.referenceType !== 'chapter'
    && citation.referenceType !== 'website'
    && contiguousOverlap(citation.title.value, getVenueValue(citation), 3)
  ) {
    codes.push('venue_title_partial_overlap');
  }

  if (
    citation.referenceType === 'journal'
    && (
      evaluateScoreField(citation, 'volume', selection.profile).state === 'weak'
      || evaluateScoreField(citation, 'issue', selection.profile).state === 'weak'
      || evaluateScoreField(citation, 'locator', selection.profile).state === 'weak'
    )
  ) {
    codes.push('locator_unusual_shape');
  }

  if (
    evaluateScoreField(citation, 'doi', selection.profile).state === 'weak'
    || evaluateScoreField(citation, 'url', selection.profile).state === 'weak'
  ) {
    codes.push('identifier_weak_shape');
  }

  if (
    looksSupportTypeMismatch(citation.publisher.value)
    || looksSupportTypeMismatch(citation.institution.value)
    || looksSupportTypeMismatch(citation.edition.value)
  ) {
    codes.push('support_field_type_mismatch');
  }

  return [...new Set(codes)];
}

export function observationPenaltyForCodes(codes: ObservationCode[]): number {
  const contradictionCount = [...new Set(codes)]
    .map((code) => OBSERVATION_CODE_REGISTRY[code])
    .filter((definition) => definition?.penaltyType === 'contradiction')
    .length;
  return Math.min(OBSERVATION_PENALTY_CAP, contradictionCount * OBSERVATION_PENALTY_PER_CODE);
}

export function validateScoreConfiguration(config?: {
  requirementProfiles?: Record<string, RequirementProfile>;
  scoreProfiles?: Record<string, ScoreProfile>;
  observationRegistry?: Record<string, ObservationCodeDefinition>;
}): void {
  const requirementProfiles = config?.requirementProfiles ?? REQUIREMENT_PROFILES;
  const scoreProfiles = config?.scoreProfiles ?? SCORE_PROFILES;
  const observationRegistry = config?.observationRegistry ?? OBSERVATION_CODE_REGISTRY;

  for (const definition of Object.values(observationRegistry)) {
    if (definition.penaltyType !== 'contradiction' && definition.penaltyType !== 'informational') {
      throw new Error(`Observation code ${definition.code} is missing a valid penaltyType.`);
    }
  }

  for (const [referenceType, profile] of Object.entries(scoreProfiles)) {
    const weightSum = Object.values(profile.weights).reduce((sum, value) => sum + value, 0);
    if (Math.abs(weightSum - 1) > 0.0001) {
      throw new Error(`Score profile ${referenceType} weights must sum to 1.0.`);
    }

    const requirementProfile = requirementProfiles[referenceType];
    if (!requirementProfile) {
      throw new Error(`Missing requirement profile for score profile ${referenceType}.`);
    }

    for (const expectedField of requirementProfile.expected) {
      if (!(expectedField in profile.expectedFieldWeights)) {
        throw new Error(`Score profile ${referenceType} is missing expected field weight for ${expectedField}.`);
      }
    }

    for (const expectedField of Object.keys(profile.expectedFieldWeights)) {
      if (!requirementProfile.expected.includes(expectedField)) {
        throw new Error(`Score profile ${referenceType} defines orphan expected field weight ${expectedField}.`);
      }
    }

    if (Object.keys(profile.expectedFieldWeights).length > 0 && profile.readyExpectedFieldMinimum < 1) {
      throw new Error(`Score profile ${referenceType} must require at least one expected field when expected weights are defined.`);
    }
  }
}

validateScoreConfiguration();
