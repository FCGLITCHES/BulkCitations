import type {
  CanonicalAuthor,
  CanonicalCitation,
  CanonicalReferenceType,
  ResolutionAcceptedCandidate,
  ResolutionMetadata,
  ResolutionQueryEvidence,
} from '@shared/schema';
import { isGroupAuthor, normalizeGroupAuthor, normalizeProtectedTokenValue } from '../shared/citationSemantics.js';
import type { ResolutionCandidateRecord } from './contracts.js';
import { normalizeWhitespace } from './utils.js';

const PROTECTED_TOKEN_RULES = [
  { canonical: 'U-Net', pattern: /\bU[\s-]?Net\b/gi },
  { canonical: 'PRISMA', pattern: /\bPRISMA\b/gi },
  { canonical: 'GLOBOCAN', pattern: /\bGLOBOCAN\b/gi },
  { canonical: 'BMJ', pattern: /\bBMJ\b/gi },
  { canonical: 'GPT-5.1', pattern: /\bGPT[\s-]?5\.1\b/gi },
] as const;

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
    .map((author) => normalizeSurnameForResolution(author.split(',')[0] ?? author))
    .filter(Boolean);

  const actualSet = new Set(actual);
  return expected.filter((author) => actualSet.has(author)).length;
}

function sourceTypeCompatible(referenceType: CanonicalReferenceType, sourceType?: string): boolean {
  const normalized = normalizeWhitespace((sourceType ?? '').toLowerCase());
  if (!normalized) return true;
  switch (referenceType) {
    case 'journal':
      return /(journal|article)/.test(normalized);
    case 'conference':
      return /(conference|proceeding|paper)/.test(normalized);
    case 'report':
      return /(report)/.test(normalized);
    case 'book':
      return /(book|monograph)/.test(normalized);
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

  if (queryEvidence.groupAuthorLiteral) {
    authorGatePassed = groupAuthorAgreement(queryEvidence.groupAuthorLiteral, candidateAuthors);
    if (!authorGatePassed) reasons.push('group_author_mismatch');
  } else if (queryEvidence.firstAuthorSurname) {
    const expectedSurname = normalizeSurnameForResolution(queryEvidence.firstAuthorSurname);
    const candidatePrimary = normalizeSurnameForResolution(candidateAuthors[0]?.split(',')[0] ?? candidateAuthors[0] ?? '');
    authorGatePassed = Boolean(expectedSurname && candidatePrimary && expectedSurname === candidatePrimary);
    if (!authorGatePassed) reasons.push('first_author_mismatch');
    extraAuthorMatches = countAdditionalAuthorMatches(citation.authors.value, candidateAuthors);
    if (authorGatePassed && citation.authors.value.length >= 3 && candidateAuthors.length >= 3 && extraAuthorMatches < 1) {
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
  const sourceTypeScore = sourceTypeCompatible(citation.referenceType, candidate.sourceType) ? 1 : 0;
  const band: 1 | 2 = titleMatch.exact ? 2 : 1;
  const score = (titleMatch.exact ? 100 : 90)
    + (year.toleranceApplied ? 4 : 10)
    + Math.min(extraAuthorMatches, 3) * 5
    + Math.round(venueOverlap * 10)
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
    conflictFields: [],
    yearToleranceApplied: false,
    queryEvidence: buildResolutionQueryEvidence(citation),
    ...overrides,
  };
}
