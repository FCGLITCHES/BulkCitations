import type {
  CanonicalAuthor,
  CanonicalCitation,
  CanonicalReferenceType,
  ResolutionAcceptedCandidate,
  ResolutionMetadata,
  ResolutionQueryEvidence,
} from '@shared/schema';
import { getProtectedContainerCorruptionReasons } from '@shared/referenceHealthHeuristics';
import { isPlaceholderFieldValue } from '@shared/referencePlaceholders';
import {
  classifyLocatorToken,
  isGroupAuthor,
  normalizeGroupAuthor,
  normalizeProtectedTokenValue,
} from '../shared/citationSemantics.js';
import type { ResolutionCandidateRecord } from './contracts.js';
import { normalizeDoiValue, normalizeWhitespace } from './utils.js';

const PROTECTED_TOKEN_RULES = [
  { canonical: 'U-Net', pattern: /\bU[\s-]?Net\b/gi },
  { canonical: 'PRISMA', pattern: /\bPRISMA\b/gi },
  { canonical: 'GLOBOCAN', pattern: /\bGLOBOCAN\b/gi },
  { canonical: 'BMJ', pattern: /\bBMJ\b/gi },
  { canonical: 'GPT-5.1', pattern: /\bGPT[\s-]?5\.1\b/gi },
] as const;

const GENERIC_VENUE_PATTERN = /^(?:journal|conference|proceedings|book|report|website|site|web(?:page)?)(?:\s+(?:vol(?:ume)?|issue|no|number|pp?|pages?|article|\d+|\?))*$/i;

type TitleMatchResult = {
  accepted: boolean;
  exact: boolean;
  nearExact: boolean;
  jaccard: number;
  reasons: string[];
};

export type EvaluatedResolutionCandidate = {
  candidate: ResolutionCandidateRecord;
  accepted: boolean;
  band: 0 | 1 | 2;
  score: number;
  reasons: string[];
  yearToleranceApplied: boolean;
  extraAuthorMatches: number;
  venueOverlap: number;
  titleMatch: TitleMatchResult;
};

function asciiFold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizePunctuationToSpace(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, ' ');
}

function extractProtectedTokens(value: string): string[] {
  const found = new Set<string>();
  for (const rule of PROTECTED_TOKEN_RULES) {
    if (rule.pattern.test(value)) {
      found.add(rule.canonical);
    }
    rule.pattern.lastIndex = 0;
  }
  return [...found].sort();
}

export function normalizeResolutionTitle(value: string | null | undefined): {
  normalized: string;
  tokens: string[];
  protectedTokens: string[];
} {
  const raw = normalizeProtectedTokenValue(normalizeWhitespace(value ?? '').normalize('NFC'));
  if (!raw) {
    return { normalized: '', tokens: [], protectedTokens: [] };
  }

  const protectedTokens = extractProtectedTokens(raw);
  const normalized = normalizeWhitespace(
    normalizePunctuationToSpace(raw.toLowerCase()),
  );
  const tokens = normalized.split(/\s+/).filter(Boolean);

  return {
    normalized,
    tokens,
    protectedTokens,
  };
}

export function normalizeSurnameForResolution(value: string | null | undefined): string {
  const folded = asciiFold(normalizeWhitespace(value ?? '').toLowerCase());
  return normalizeWhitespace(folded.replace(/[^\p{L}\p{N}\s]+/gu, ' '));
}

function normalizeGroupNameForResolution(value: string | null | undefined): string {
  return normalizeSurnameForResolution(normalizeGroupAuthor(value ?? ''));
}

function normalizeCandidateAuthorSurname(author: string | null | undefined): string {
  const normalized = normalizeWhitespace(author ?? '');
  if (!normalized) return '';
  if (normalized.includes(',')) {
    return normalizeSurnameForResolution(normalized.split(',')[0] ?? '');
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return normalizeSurnameForResolution(normalized);
  }

  const particles = new Set(['da', 'de', 'del', 'der', 'di', 'du', 'la', 'le', 'van', 'von', 'bin', 'ibn']);
  let start = tokens.length - 1;
  while (start > 0 && particles.has(tokens[start - 1]?.toLowerCase() ?? '')) {
    start -= 1;
  }

  return normalizeSurnameForResolution(tokens.slice(start).join(' '));
}

function normalizeResolutionVenue(value: string | null | undefined): string {
  return normalizeWhitespace(
    normalizeProtectedTokenValue(value ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' '),
  );
}

function venueLooksSubstantive(value: string | null | undefined): boolean {
  const raw = normalizeWhitespace(value ?? '');
  const normalized = normalizeResolutionVenue(value);
  if (!raw || !normalized) return false;
  if (isPlaceholderFieldValue(normalized)) return false;
  if (/\?/.test(raw)) return false;
  if (GENERIC_VENUE_PATTERN.test(normalized)) return false;
  return normalized.split(/\s+/).filter(Boolean).some((token) => token.length >= 4);
}

function citationVenueValue(citation: CanonicalCitation): string {
  return citation.journal.value ?? citation.conferenceTitle.value ?? citation.bookTitle.value ?? citation.publisher.value ?? '';
}

function localVenueSuggestsCrossTypeUpgrade(citation: CanonicalCitation): boolean {
  const venue = citationVenueValue(citation);
  const normalized = normalizeResolutionVenue(venue);
  if (!venueLooksSubstantive(venue)) return true;
  return /\b(proceedings|conference|symposium|workshop|lecture\s+notes|drops|ebooks?)\b/i.test(normalized);
}

function normalizeLocatorForResolution(value: string | null | undefined): string {
  const classified = classifyLocatorToken(normalizeWhitespace(value ?? ''));
  return classified.value?.replace(/–/g, '-') ?? '';
}

function parseLocatorRange(value: string): { start: string; end?: string } | null {
  const normalized = normalizeLocatorForResolution(value);
  if (!normalized) return null;
  const rangeMatch = normalized.match(/^([A-Za-z]?\d+)-([A-Za-z]?\d+)$/);
  if (rangeMatch) {
    return {
      start: rangeMatch[1] ?? '',
      end: rangeMatch[2] ?? '',
    };
  }
  if (/^[A-Za-z]?\d+$/.test(normalized)) {
    return { start: normalized };
  }
  return null;
}

function locatorCompatibility(localLocator: string | null | undefined, candidateLocator: string | null | undefined): number {
  const left = normalizeLocatorForResolution(localLocator);
  const right = normalizeLocatorForResolution(candidateLocator);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftRange = parseLocatorRange(left);
  const rightRange = parseLocatorRange(right);
  if (!leftRange || !rightRange) return 0;

  if (leftRange.start === rightRange.start && leftRange.end === rightRange.end) return 1;
  if (leftRange.start === rightRange.start) return 0.8;
  if (leftRange.end && rightRange.end && leftRange.end === rightRange.end) return 0.65;
  return 0;
}

function tokenSet(tokens: string[]): Set<string> {
  return new Set(tokens.filter(Boolean));
}

function jaccard(left: string[], right: string[]): number {
  const leftSet = tokenSet(left);
  const rightSet = tokenSet(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function overlapRatio(left: string[], right: string[]): number {
  const leftSet = tokenSet(left);
  const rightSet = tokenSet(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  return intersection / Math.max(leftSet.size, rightSet.size);
}

function protectedTokensMatch(left: string[], right: string[]): boolean {
  if (left.length === 0 && right.length === 0) return true;
  if (left.length !== right.length) return false;
  return left.every((token, index) => token === right[index]);
}

export function matchTitlesStrict(
  parsedTitle: string | null | undefined,
  candidateTitle: string | null | undefined,
): TitleMatchResult {
  const left = normalizeResolutionTitle(parsedTitle);
  const right = normalizeResolutionTitle(candidateTitle);
  const reasons: string[] = [];

  if (!left.normalized || !right.normalized) {
    reasons.push('title_missing');
    return { accepted: false, exact: false, nearExact: false, jaccard: 0, reasons };
  }

  if (!protectedTokensMatch(left.protectedTokens, right.protectedTokens)) {
    reasons.push('protected_token_mismatch');
    return { accepted: false, exact: false, nearExact: false, jaccard: 0, reasons };
  }

  if (left.normalized === right.normalized) {
    return { accepted: true, exact: true, nearExact: false, jaccard: 1, reasons };
  }

  const shorter = left.tokens.length <= right.tokens.length ? left : right;
  const longer = shorter === left ? right : left;
  if (shorter.tokens.length < 5) {
    reasons.push('short_title_requires_exact_match');
    return { accepted: false, exact: false, nearExact: false, jaccard: jaccard(left.tokens, right.tokens), reasons };
  }

  const similarity = jaccard(left.tokens, right.tokens);
  const requiredLongTokens = shorter.tokens.filter((token) => token.length >= 6);
  const longTokensPreserved = requiredLongTokens.every((token) => longer.tokens.includes(token));

  if (similarity >= 0.92 && longTokensPreserved) {
    return { accepted: true, exact: false, nearExact: true, jaccard: similarity, reasons };
  }

  if (similarity < 0.92) reasons.push('title_similarity_below_threshold');
  if (!longTokensPreserved) reasons.push('long_tokens_not_preserved');
  return { accepted: false, exact: false, nearExact: false, jaccard: similarity, reasons };
}

function getPrimaryAuthorEvidence(citation: CanonicalCitation): { firstAuthorSurname?: string; groupAuthorLiteral?: string } {
  const firstAuthor = citation.authors.value[0];
  if (!firstAuthor) return {};

  if (firstAuthor.literal && isGroupAuthor(firstAuthor.literal)) {
    return {
      groupAuthorLiteral: normalizeGroupAuthor(firstAuthor.literal),
    };
  }

  if (isGroupAuthor(firstAuthor.last)) {
    return {
      groupAuthorLiteral: normalizeGroupAuthor(firstAuthor.last),
    };
  }

  return {
    firstAuthorSurname: firstAuthor.last,
  };
}

export function buildResolutionQueryEvidence(citation: CanonicalCitation): ResolutionQueryEvidence {
  const title = normalizeResolutionTitle(citation.title.value);
  const primaryAuthor = getPrimaryAuthorEvidence(citation);
  const venue = citation.journal.value ?? citation.conferenceTitle.value ?? citation.bookTitle.value ?? citation.publisher.value ?? null;

  return {
    titlePresent: Boolean(title.normalized),
    titleTokenCount: title.tokens.length,
    firstAuthorSurname: primaryAuthor.firstAuthorSurname,
    groupAuthorLiteral: primaryAuthor.groupAuthorLiteral,
    year: citation.year.value,
    venue,
    sourceType: citation.referenceType,
  };
}

function countAdditionalAuthorMatches(citationAuthors: CanonicalAuthor[], candidateAuthors: string[]): number {
  if (citationAuthors.length < 3 || candidateAuthors.length < 3) return 0;

  const expected = citationAuthors
    .slice(1, 6)
    .map((author) => normalizeSurnameForResolution(author.last))
    .filter(Boolean);
  const actual = candidateAuthors
    .slice(1, 6)
    .map((author) => normalizeCandidateAuthorSurname(author))
    .filter(Boolean);

  const actualSet = new Set(actual);
  return expected.filter((author) => actualSet.has(author)).length;
}

function sourceTypeCompatible(
  referenceType: CanonicalReferenceType,
  sourceType?: string,
  allowPlaceholderFlex = false,
): boolean {
  const normalized = normalizeWhitespace((sourceType ?? '').toLowerCase());
  if (!normalized) return true;
  switch (referenceType) {
    case 'journal':
      if (allowPlaceholderFlex) {
        return /(journal|article|conference|proceeding|paper|book|monograph|chapter|report)/.test(normalized);
      }
      return /(journal|article)/.test(normalized);
    case 'chapter':
      return /(chapter|section|book)/.test(normalized);
    case 'conference':
      return /(conference|proceeding|paper)/.test(normalized);
    case 'report':
      return /(report)/.test(normalized);
    case 'book':
      return /(book|monograph)/.test(normalized);
    case 'thesis':
      return /(dissertation|thesis)/.test(normalized);
    case 'website':
      return /(website|webpage|site)/.test(normalized);
    case 'preprint':
      return /(preprint|posted-content|article)/.test(normalized);
    default:
      return true;
  }
}

function isPreprintLike(citation: CanonicalCitation, candidate: ResolutionCandidateRecord): boolean {
  if (citation.referenceType === 'preprint') return true;
  const combined = `${citation.journal.value ?? ''} ${citation.conferenceTitle.value ?? ''} ${candidate.venue ?? ''}`.toLowerCase();
  return /\b(arxiv|biorxiv|medrxiv)\b/.test(combined);
}

function yearCompatibility(
  citation: CanonicalCitation,
  candidate: ResolutionCandidateRecord,
): { compatible: boolean; toleranceApplied: boolean; reason?: string } {
  if (citation.year.value == null || candidate.year == null) {
    return { compatible: true, toleranceApplied: false };
  }
  if (citation.year.value === candidate.year) {
    return { compatible: true, toleranceApplied: false };
  }
  if (Math.abs(citation.year.value - candidate.year) === 1 && isPreprintLike(citation, candidate)) {
    return { compatible: true, toleranceApplied: true };
  }
  return { compatible: false, toleranceApplied: false, reason: 'year_incompatible' };
}

function venueTokenOverlap(citation: CanonicalCitation, candidate: ResolutionCandidateRecord): number {
  const localVenue = citation.journal.value ?? citation.conferenceTitle.value ?? citation.bookTitle.value ?? citation.publisher.value ?? '';
  const left = normalizeResolutionTitle(localVenue);
  const right = normalizeResolutionTitle(candidate.venue ?? candidate.publisher ?? '');
  return overlapRatio(left.tokens, right.tokens);
}

function candidateProtectedVenueMismatch(citation: CanonicalCitation, candidate: ResolutionCandidateRecord): boolean {
  return getProtectedContainerCorruptionReasons(
    citation.raw,
    {
      journal: candidate.venue ?? candidate.publisher ?? undefined,
      conferenceTitle: undefined,
      bookTitle: undefined,
    },
    candidate.title,
  ).length > 0;
}

function candidateMetadataRichness(candidate: ResolutionCandidateRecord): number {
  return [
    candidate.doi,
    candidate.url,
    candidate.venue,
    candidate.publisher,
    candidate.volume,
    candidate.issue,
    candidate.pages,
    candidate.year,
  ].filter(Boolean).length + Math.min(candidate.authors?.length ?? 0, 5) * 0.1;
}

function normalizedCandidatePrimaryAuthor(candidate: ResolutionCandidateRecord): string {
  return normalizeCandidateAuthorSurname(candidate.authors?.[0] ?? '');
}

function candidatesAreEquivalent(left: ResolutionCandidateRecord, right: ResolutionCandidateRecord): boolean {
  const leftDoi = left.doi ? normalizeDoiValue(left.doi).toLowerCase() : '';
  const rightDoi = right.doi ? normalizeDoiValue(right.doi).toLowerCase() : '';
  if (leftDoi && rightDoi && leftDoi === rightDoi) return true;

  if (normalizeResolutionTitle(left.title).normalized !== normalizeResolutionTitle(right.title).normalized) return false;
  if (normalizedCandidatePrimaryAuthor(left) !== normalizedCandidatePrimaryAuthor(right)) return false;
  if (left.year != null && right.year != null && left.year !== right.year) return false;

  const venueOverlap = overlapRatio(
    normalizeResolutionTitle(left.venue ?? left.publisher ?? '').tokens,
    normalizeResolutionTitle(right.venue ?? right.publisher ?? '').tokens,
  );

  return venueOverlap >= 0.85 || (!left.venue && !right.venue);
}

function candidateProviderPriority(candidate: ResolutionCandidateRecord): number {
  switch (candidate.provider) {
    case 'crossref':
      return 3;
    case 'pubmed':
      return 2;
    case 'openalex':
      return 1;
    default:
      return 0;
  }
}

function groupAuthorAgreement(groupAuthorLiteral: string, candidateAuthors: string[]): boolean {
  if (candidateAuthors.length === 0) return false;
  const target = normalizeGroupNameForResolution(groupAuthorLiteral);
  return candidateAuthors.some((author) => {
    if (!isGroupAuthor(author)) return false;
    const candidate = normalizeGroupNameForResolution(author);
    const leftTokens = target.split(/\s+/).filter(Boolean);
    const rightTokens = candidate.split(/\s+/).filter(Boolean);
    return overlapRatio(leftTokens, rightTokens) >= 0.9;
  });
}

export function evaluateResolutionCandidate(
  citation: CanonicalCitation,
  candidate: ResolutionCandidateRecord,
): EvaluatedResolutionCandidate {
  const reasons: string[] = [];
  const titleMatch = matchTitlesStrict(citation.title.value, candidate.title);
  if (!titleMatch.accepted) {
    return {
      candidate,
      accepted: false,
      band: 0,
      score: 0,
      reasons: titleMatch.reasons,
      yearToleranceApplied: false,
      extraAuthorMatches: 0,
      venueOverlap: 0,
      titleMatch,
    };
  }

  const queryEvidence = getPrimaryAuthorEvidence(citation);
  const candidateAuthors = candidate.authors ?? [];
  let authorGatePassed = false;
  let extraAuthorMatches = 0;
  const authorEvidenceIsSparse = citation.authors.confidence < 0.9 || citation.authors.value.length < 3;

  if (queryEvidence.groupAuthorLiteral) {
    authorGatePassed = groupAuthorAgreement(queryEvidence.groupAuthorLiteral, candidateAuthors);
    if (!authorGatePassed) reasons.push('group_author_mismatch');
  } else if (queryEvidence.firstAuthorSurname) {
    const expectedSurname = normalizeSurnameForResolution(queryEvidence.firstAuthorSurname);
    const candidatePrimary = normalizeCandidateAuthorSurname(candidateAuthors[0] ?? '');
    authorGatePassed = Boolean(expectedSurname && candidatePrimary && expectedSurname === candidatePrimary);
    if (!authorGatePassed) reasons.push('first_author_mismatch');
    extraAuthorMatches = countAdditionalAuthorMatches(citation.authors.value, candidateAuthors);
    if (authorGatePassed && citation.authors.value.length >= 3 && candidateAuthors.length >= 3 && extraAuthorMatches < 1 && !authorEvidenceIsSparse) {
      authorGatePassed = false;
      reasons.push('coauthor_overlap_missing');
    }
  }

  if (!authorGatePassed) {
    return {
      candidate,
      accepted: false,
      band: 0,
      score: 0,
      reasons,
      yearToleranceApplied: false,
      extraAuthorMatches,
      venueOverlap: venueTokenOverlap(citation, candidate),
      titleMatch,
    };
  }

  const year = yearCompatibility(citation, candidate);
  if (!year.compatible) {
    reasons.push(year.reason ?? 'year_incompatible');
    return {
      candidate,
      accepted: false,
      band: 0,
      score: 0,
      reasons,
      yearToleranceApplied: false,
      extraAuthorMatches,
      venueOverlap: venueTokenOverlap(citation, candidate),
      titleMatch,
    };
  }

  const venueOverlap = venueTokenOverlap(citation, candidate);
  if (candidateProtectedVenueMismatch(citation, candidate)) {
    reasons.push('protected_venue_mismatch');
    return {
      candidate,
      accepted: false,
      band: 0,
      score: 0,
      reasons,
      yearToleranceApplied: year.toleranceApplied,
      extraAuthorMatches,
      venueOverlap,
      titleMatch,
    };
  }

  const sourceTypeScore = sourceTypeCompatible(
    citation.referenceType,
    candidate.sourceType,
    localVenueSuggestsCrossTypeUpgrade(citation),
  ) ? 1 : 0;
  if (!sourceTypeScore && citation.referenceType !== 'unknown') {
    reasons.push('source_type_incompatible');
    return {
      candidate,
      accepted: false,
      band: 0,
      score: 0,
      reasons,
      yearToleranceApplied: year.toleranceApplied,
      extraAuthorMatches,
      venueOverlap,
      titleMatch,
    };
  }
  const locatorScore = locatorCompatibility(citation.pages.value, candidate.pages);
  const band: 1 | 2 = titleMatch.exact ? 2 : 1;
  const score = (titleMatch.exact ? 100 : 90)
    + (year.toleranceApplied ? 4 : 10)
    + Math.min(extraAuthorMatches, 3) * 5
    + Math.round(venueOverlap * 10)
    + Math.round(locatorScore * 8)
    + (sourceTypeScore * 2);

  return {
    candidate,
    accepted: true,
    band,
    score,
    reasons,
    yearToleranceApplied: year.toleranceApplied,
    extraAuthorMatches,
    venueOverlap,
    titleMatch,
  };
}

export function chooseBestResolutionCandidate(
  citation: CanonicalCitation,
  candidates: ResolutionCandidateRecord[],
): {
  accepted?: EvaluatedResolutionCandidate;
  ambiguous: boolean;
  evaluated: EvaluatedResolutionCandidate[];
} {
  const evaluated = candidates.map((candidate) => evaluateResolutionCandidate(citation, candidate));
  const accepted = evaluated
    .filter((candidate) => candidate.accepted)
    .sort((left, right) => right.band - left.band || right.score - left.score);

  if (accepted.length === 0) {
    return {
      ambiguous: false,
      evaluated,
    };
  }

  if (accepted.length >= 2 && accepted[0].band === accepted[1].band && accepted[0].score === accepted[1].score) {
    if (candidatesAreEquivalent(accepted[0].candidate, accepted[1].candidate)) {
      const richer = [...accepted]
        .filter((candidate) => candidate.band === accepted[0].band && candidate.score === accepted[0].score)
        .sort((left, right) =>
          candidateMetadataRichness(right.candidate) - candidateMetadataRichness(left.candidate)
          || candidateProviderPriority(right.candidate) - candidateProviderPriority(left.candidate)
        )[0];
      if (richer) {
        return {
          accepted: richer,
          ambiguous: false,
          evaluated,
        };
      }
    }
    return {
      ambiguous: true,
      evaluated,
    };
  }

  return {
    accepted: accepted[0],
    ambiguous: false,
    evaluated,
  };
}

export function buildAcceptedCandidateSummary(candidate: ResolutionCandidateRecord): ResolutionAcceptedCandidate {
  return {
    provider: candidate.provider,
    title: candidate.title,
    authors: candidate.authors,
    year: candidate.year,
    venue: candidate.venue,
    volume: candidate.volume,
    issue: candidate.issue,
    pages: candidate.pages,
    publisher: candidate.publisher,
    doi: candidate.doi,
    url: candidate.url,
    sourceType: candidate.sourceType,
  };
}

export function buildResolutionMetadata(
  citation: CanonicalCitation,
  status: ResolutionMetadata['status'],
  overrides?: Partial<Omit<ResolutionMetadata, 'status' | 'queryEvidence' | 'candidateCount' | 'rejectedReasons' | 'conflictFields' | 'yearToleranceApplied'>>,
): ResolutionMetadata {
  return {
    status,
    candidateCount: 0,
    rejectedReasons: [],
    appliedFields: [],
    conflictFields: [],
    yearToleranceApplied: false,
    queryEvidence: buildResolutionQueryEvidence(citation),
    ...overrides,
  };
}
