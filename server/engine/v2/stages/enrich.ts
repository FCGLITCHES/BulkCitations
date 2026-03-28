import pLimit from 'p-limit';
import type {
  CanonicalAuthor,
  CanonicalCitation,
  CanonicalReferenceType,
  EnrichmentMetadata,
  FieldValue,
  ResolutionAcceptedCandidate,
  ResolutionMetadata,
} from '@shared/schema';
import { isPlaceholderFieldValue } from '@shared/referencePlaceholders';
import { isGroupAuthor, normalizeGroupAuthor, normalizeKnownContainerName } from '../../shared/citationSemantics.js';
import type {
  CacheAdapter,
  ExtractorAdapter,
  ResolutionCandidateRecord,
  ResolutionProviderAdapter,
  ResolutionSearchQuery,
  V2Stage,
} from '../contracts.js';
import {
  buildAcceptedCandidateSummary,
  buildResolutionMetadata,
  buildResolutionQueryEvidence,
  chooseBestResolutionCandidate,
  normalizeResolutionTitle,
  normalizeSurnameForResolution,
} from '../resolution.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  coerceCanonicalAuthor,
  createFieldValue,
  createStageDiagnostic,
  logStructuredDebug,
  normalizeDoiValue,
  normalizeWhitespace,
  nowIso,
  parseAuthorsForStyle,
} from '../utils.js';
import { providerSourceTypeToCanonical } from '../sourceTypes.js';

const PROVIDER_LIMIT = 5;
const DEFAULT_ENRICH_CONCURRENCY = 8;
const DEFAULT_ENRICH_CITATION_TIMEOUT_MS = 5_000;
const AUTHORITY_FIELD_CONFIDENCE = 0.97;
const LARGE_SYNC_BATCH_RESOLUTION_THRESHOLD = 25;
const LOCAL_ONLY_SYNC_REFERENCE_TYPES: CanonicalReferenceType[] = ['conference', 'chapter', 'book', 'report', 'website'];

type ProviderKey = 'doi' | 'crossref' | 'pubmed' | 'openalex';

type CachedResolutionPayload = {
  status: ResolutionMetadata['status'];
  provider?: string;
  matchStrategy?: ResolutionMetadata['matchStrategy'];
  candidateCount: number;
  acceptedCandidate?: ResolutionAcceptedCandidate;
  rejectedReasons: string[];
  yearToleranceApplied: boolean;
};

type ResolutionExecutionResult = {
  payload: CachedResolutionPayload;
  providerOrder: ProviderKey[];
  successfulProviderCount: number;
  providerErrorCount: number;
  partialResult: boolean;
  fallbacksUsed: string[];
};

type AuthorityMergeAudit = {
  appliedFields: string[];
  conflictFields: string[];
};

function recordField(list: string[], fieldName: string): void {
  if (!list.includes(fieldName)) {
    list.push(fieldName);
  }
}

function authorityFieldValue<T>(field: FieldValue<T>, value: T, stageId: string): FieldValue<T> {
  return {
    value,
    source: 'authority',
    confidence: Math.max(field.confidence, AUTHORITY_FIELD_CONFIDENCE),
    stageId,
  };
}

function updateStringField(
  field: FieldValue<string | null>,
  incoming: string | undefined,
  stageId: string,
  audit: AuthorityMergeAudit,
  fieldName: string,
  normalizer: (value: string) => string = (value) => normalizeWhitespace(value.toLowerCase()),
): FieldValue<string | null> {
  const nextValue = normalizeWhitespace(incoming ?? '') || undefined;
  if (!nextValue) return field;

  if (!field.value || isPlaceholderFieldValue(field.value)) {
    recordField(audit.appliedFields, fieldName);
    return authorityFieldValue(field, nextValue, stageId);
  }

  const normalizedCurrent = normalizer(field.value);
  const normalizedIncoming = normalizer(nextValue);
  const equivalent = fieldName === 'journal'
    ? areVenueValuesEquivalent(field.value, nextValue)
    : normalizedCurrent === normalizedIncoming;

  if (equivalent) {
    return field;
  }

  if (field.source === 'user') {
    recordField(audit.conflictFields, fieldName);
    return field;
  }

  recordField(audit.appliedFields, fieldName);
  return authorityFieldValue(field, nextValue, stageId);
}

function updateNumericField(
  field: FieldValue<number | null>,
  incoming: number | undefined,
  stageId: string,
  audit: AuthorityMergeAudit,
  fieldName: string,
): FieldValue<number | null> {
  if (incoming == null || !Number.isFinite(incoming)) return field;
  if (field.value == null) {
    recordField(audit.appliedFields, fieldName);
    return authorityFieldValue(field, incoming, stageId);
  }

  if (field.value === incoming) {
    return field;
  }

  if (field.source === 'user') {
    recordField(audit.conflictFields, fieldName);
    return field;
  }

  recordField(audit.appliedFields, fieldName);
  return authorityFieldValue(field, incoming, stageId);
}

function buildVenueNormalizer(value: string): string {
  const STOP_TOKENS = new Set(['and', 'of', 'the', 'in', 'on']);
  const tokens = normalizeWhitespace(normalizeKnownContainerName(value).toLowerCase())
    .replace(/&amp;|&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token && !STOP_TOKENS.has(token))
    .map((token) => {
      if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
      if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
      return token;
    });
  return tokens.join(' ');
}

function areVenueValuesEquivalent(left: string, right: string): boolean {
  const leftTokens = buildVenueNormalizer(left).split(/\s+/).filter(Boolean);
  const rightTokens = buildVenueNormalizer(right).split(/\s+/).filter(Boolean);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const tokensEquivalent = (shorter: string[], longer: string[]) => shorter.every((token, index) => {
    const other = longer[index] ?? '';
    return token === other || token.startsWith(other) || other.startsWith(token);
  });
  if (leftTokens.length === rightTokens.length) {
    return leftTokens.every((token, index) => {
      const other = rightTokens[index] ?? '';
      return token === other || token.startsWith(other) || other.startsWith(token);
    });
  }

  const leftHasParentheticalQualifier = /\([^)]*\)/.test(left);
  const rightHasParentheticalQualifier = /\([^)]*\)/.test(right);
  if (!leftHasParentheticalQualifier && !rightHasParentheticalQualifier) return false;

  const shorter = leftTokens.length < rightTokens.length ? leftTokens : rightTokens;
  const longer = shorter === leftTokens ? rightTokens : leftTokens;
  return tokensEquivalent(shorter, longer);
}

function normalizeTextComparisonValue(value: string): string {
  return normalizeWhitespace(
    value
      .normalize('NFKC')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .toLowerCase(),
  );
}

function normalizePageComparisonValue(value: string): string {
  const normalized = normalizeWhitespace(value)
    .replace(/\be(?=\d)/ig, '')
    .replace(/–/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/^pp?\.?\s*/i, '');
  const articleNumberLikeRange = normalized.match(/^(\d{5,})-(\d{1,3})$/);
  if (articleNumberLikeRange) return articleNumberLikeRange[1];
  const rangeMatch = normalized.match(/^([A-Za-z]?)(\d+)-([A-Za-z]?)(\d+)$/);
  if (!rangeMatch) return normalized;

  const [, startPrefix = '', startDigits, endPrefixRaw = '', endDigits] = rangeMatch;
  const endPrefix = endPrefixRaw || startPrefix;
  let expandedEnd = endDigits;

  if (/^\d+$/.test(startDigits) && /^\d+$/.test(endDigits) && endDigits.length < startDigits.length) {
    expandedEnd = `${startDigits.slice(0, startDigits.length - endDigits.length)}${endDigits}`;
  }

  return `${startPrefix}${startDigits}-${endPrefix}${expandedEnd}`;
}

function isLikelyOnlineFirstLocator(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^1-\d{1,2}$/.test(normalizePageComparisonValue(value));
}

function authorInitialKey(author: CanonicalAuthor): string {
  const seed = normalizeWhitespace(author.initials ?? author.first ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .toUpperCase();
  const initials = seed
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .join('');
  return initials.slice(0, 6);
}

function authorSignature(author: CanonicalAuthor): string {
  const literal = normalizeWhitespace(author.literal ?? '');
  if (literal && isGroupAuthor(literal)) {
    return `group:${normalizeGroupAuthor(literal).toLowerCase()}`;
  }
  if (isGroupAuthor(author.last)) {
    return `group:${normalizeGroupAuthor(author.last).toLowerCase()}`;
  }
  return `${normalizeSurnameForResolution(author.last)}|${authorInitialKey(author)}`;
}

function normalizeAuthorityAuthors(authors?: string[]): CanonicalAuthor[] {
  return (authors ?? [])
    .map((author) => coerceCanonicalAuthor(author))
    .filter((author) => Boolean(author.literal || author.last));
}

function authorsEquivalent(current: CanonicalAuthor[], authority: CanonicalAuthor[]): boolean {
  if (current.length === 0 || authority.length === 0) return false;
  if (current.length !== authority.length) return false;
  const currentSignatures = current.map(authorSignature);
  const authoritySignatures = authority.map(authorSignature);
  return currentSignatures.every((signature, index) => signature === authoritySignatures[index]);
}

function updateAuthorsField(
  field: FieldValue<CanonicalAuthor[]>,
  incoming: string[] | undefined,
  stageId: string,
  audit: AuthorityMergeAudit,
): FieldValue<CanonicalAuthor[]> {
  const authorityAuthors = normalizeAuthorityAuthors(incoming);
  if (authorityAuthors.length === 0) return field;

  if (field.value.length === 0) {
    recordField(audit.appliedFields, 'authors');
    return authorityFieldValue(field, authorityAuthors, stageId);
  }

  if (authorsEquivalent(field.value, authorityAuthors)) {
    return field;
  }

  if (field.source === 'user') {
    recordField(audit.conflictFields, 'authors');
    return field;
  }

  recordField(audit.appliedFields, 'authors');
  return authorityFieldValue(field, authorityAuthors, stageId);
}

function looksPlaceholderVenue(value: string | null | undefined): boolean {
  return !value || isPlaceholderFieldValue(value) || /^journal(?:\b|[,.:?])/i.test(normalizeWhitespace(value));
}

function resolveAuthorityReferenceType(
  citation: CanonicalCitation,
  candidate: ResolutionAcceptedCandidate,
): CanonicalReferenceType {
  const authorityType = providerSourceTypeToCanonical(candidate.sourceType);
  if (!authorityType) return citation.referenceType;
  if (citation.referenceType === 'unknown') return authorityType;
  if (citation.referenceType === 'preprint' && authorityType === 'journal') return 'journal';

  if (
    citation.referenceType === 'journal'
    && authorityType !== 'journal'
    && (
      looksPlaceholderVenue(citation.journal.value)
      || (!citation.volume.value && !citation.issue.value && !citation.pages.value)
    )
  ) {
    return authorityType;
  }

  return citation.referenceType;
}

function resolutionCacheBucket(referenceType: CanonicalReferenceType): string {
  switch (referenceType) {
    case 'unknown':
    case 'journal':
    case 'preprint':
      return 'serial';
    default:
      return referenceType;
  }
}

function resolutionVenueKey(citation: CanonicalCitation): string {
  const rawVenue = normalizeWhitespace(
    citation.journal.value
    ?? citation.conferenceTitle.value
    ?? citation.bookTitle.value
    ?? citation.publisher.value
    ?? '',
  );
  if (!rawVenue || isPlaceholderFieldValue(rawVenue) || /\?/.test(rawVenue)) return '';

  const normalized = normalizeWhitespace(
    normalizeKnownContainerName(rawVenue)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' '),
  );

  if (!normalized || /^(?:journal|conference|proceedings|book|report)(?:\s+(?:vol(?:ume)?|issue|no|number|pp?|pages?|\?))*$/i.test(normalized)) {
    return '';
  }

  return normalized;
}

function cacheKeyForCitation(citation: CanonicalCitation): string {
  const evidence = buildResolutionQueryEvidence(citation);
  const normalizedTitle = normalizeResolutionTitle(citation.title.value).normalized;
  return [
    normalizedTitle,
    normalizeSurnameForResolution(evidence.firstAuthorSurname ?? evidence.groupAuthorLiteral ?? ''),
    citation.year.value ?? '',
    resolutionCacheBucket(citation.referenceType),
    resolutionVenueKey(citation),
    resolutionUrlKey(evidence.url),
  ].join('|');
}

function isBiomedical(citation: CanonicalCitation): boolean {
  const combined = normalizeWhitespace([
    citation.journal.value ?? '',
    citation.title.value ?? '',
  ].join(' ').toLowerCase());
  return /(med|clinical|oncology|cardio|biomed|health|lancet|nejm|jama|bmj|tuberculosis|radiology|medical)/.test(combined);
}

function isCorporateHeavy(citation: CanonicalCitation): boolean {
  if (citation.authors.value.some((author) => Boolean(author.literal) || isGroupAuthor(author.last))) return true;
  if (citation.publisher.value && isGroupAuthor(citation.publisher.value)) return true;
  if (citation.institution.value && isGroupAuthor(citation.institution.value)) return true;
  return false;
}

function normalizeResolutionUrlValue(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? '').replace(/[)\],.;:]+$/g, '');
}

function resolutionUrlKey(value: string | null | undefined): string {
  const normalized = normalizeResolutionUrlValue(value).toLowerCase();
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/g, '');
  } catch {
    return normalized;
  }
}

function deriveDoiHintFromUrl(value: string | null | undefined): string | null {
  const normalized = normalizeResolutionUrlValue(value);
  if (!normalized) return null;

  const embeddedDoi = normalized.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i)?.[0];
  if (embeddedDoi) {
    return normalizeDoiValue(embeddedDoi);
  }

  try {
    const parsed = new URL(normalized);
    if (/^(?:dx\.)?doi\.org$/i.test(parsed.hostname) && parsed.pathname.length > 1) {
      return normalizeDoiValue(parsed.href);
    }

    if (/(^|\.)nature\.com$/i.test(parsed.hostname)) {
      const natureArticleId = parsed.pathname.match(/\/articles\/([^/?#]+)/i)?.[1];
      if (natureArticleId) {
        return normalizeDoiValue(`10.1038/${natureArticleId}`);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isScholarlyLandingUrl(value: string | null | undefined): boolean {
  const normalized = normalizeResolutionUrlValue(value).toLowerCase();
  if (!normalized) return false;
  if (deriveDoiHintFromUrl(normalized)) return true;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const scholarlyHost = /(^|\.)(nature\.com|sciencedirect\.com|ieeexplore\.ieee\.org|link\.springer\.com|onlinelibrary\.wiley\.com|bmj\.com|jamanetwork\.com|nejm\.org|thelancet\.com|cell\.com|academic\.oup\.com|oup\.com|cambridge\.org|frontiersin\.org|mdpi\.com|plos\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov)$/i.test(host);
    if (!scholarlyHost) return false;
    return /\/(articles?|article|doi|full|record|paper|content|news|news-features?)\//.test(path);
  } catch {
    return false;
  }
}

function scholarlyWebsiteNeedsAuthority(citation: CanonicalCitation): boolean {
  return citation.referenceType === 'website' && isScholarlyLandingUrl(citation.url.value);
}

function canUseLocalOnlyResolutionFallback(citation: CanonicalCitation, queryEvidence: ReturnType<typeof buildResolutionQueryEvidence>): boolean {
  if (!queryEvidence.titlePresent) return false;
  if (queryEvidence.firstAuthorSurname || queryEvidence.groupAuthorLiteral) return false;
  if (!['website', 'report', 'book'].includes(citation.referenceType)) return false;

  if (citation.referenceType === 'website') {
    return Boolean(citation.url.value) && !scholarlyWebsiteNeedsAuthority(citation);
  }

  return Boolean(citation.publisher.value || citation.institution.value || citation.bookTitle.value);
}

function strongLocalResolutionSkipReason(
  citation: CanonicalCitation,
  executionMode: 'sync' | 'async',
  batchSize: number,
): 'strong_local_doi_skip' | 'strong_local_sync_skip' | 'strong_local_batch_skip' | null {
  if (executionMode !== 'sync') return null;
  if (scholarlyWebsiteNeedsAuthority(citation)) return null;

  const venueConfidence = Math.max(
    citation.journal.confidence,
    citation.conferenceTitle.confidence,
    citation.bookTitle.confidence,
    citation.publisher.confidence,
    citation.institution.confidence,
  );
  const requiresAuthors = !['website'].includes(citation.referenceType);
  const requiresVenue = ['journal', 'conference', 'chapter', 'book', 'report'].includes(citation.referenceType);
  const strongAuthors = !requiresAuthors || (citation.authors.value.length > 0 && citation.authors.confidence >= 0.86);
  const strongVenue = !requiresVenue || venueConfidence >= 0.85;
  const strongUrl = citation.referenceType !== 'website' || citation.url.confidence >= 0.88;

  const strongLocalIdentity = strongAuthors
    && citation.title.confidence >= 0.9
    && citation.year.confidence >= 0.88
    && strongVenue
    && strongUrl;

  if (!strongLocalIdentity) return null;
  if (batchSize >= LARGE_SYNC_BATCH_RESOLUTION_THRESHOLD) {
    return 'strong_local_batch_skip';
  }
  if (citation.extraction?.fallbackUsed || citation.extraction?.method === 'hybrid') return null;
  if (citation.doi.value && citation.doi.confidence >= 0.95 && batchSize >= 8) {
    return 'strong_local_doi_skip';
  }
  if (LOCAL_ONLY_SYNC_REFERENCE_TYPES.includes(citation.referenceType)) {
    return 'strong_local_sync_skip';
  }
  return null;
}

function shouldAttemptPreResolutionGrobidRecovery(
  citation: CanonicalCitation,
  batchSize: number,
  executionMode: 'sync' | 'async',
): boolean {
  const grobidEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_GROBID_EXTRACTOR ?? '');
  if (!grobidEnabled) return false;
  if (citation.extraction?.extractorPath === 'grobid' || citation.extraction?.extractorPath === 'hybrid') return false;
  if (executionMode === 'sync' && batchSize > 25) return false;
  if (!['journal', 'conference', 'book', 'chapter', 'preprint', 'unknown'].includes(citation.referenceType)) return false;

  const venueConfidence = Math.max(
    citation.journal.confidence,
    citation.conferenceTitle.confidence,
    citation.bookTitle.confidence,
    citation.publisher.confidence,
  );
  const authorRequired = citation.referenceType !== 'website';
  const weakIdentity = citation.title.confidence < 0.9
    || citation.year.confidence < 0.88
    || venueConfidence < 0.78
    || (authorRequired && citation.authors.confidence < 0.84);

  return weakIdentity || citation.extraction?.fallbackUsed === true;
}

async function applyGrobidRecoveryExtraction(
  citation: CanonicalCitation,
  extractor: ExtractorAdapter,
  inputStyle: string,
  rawInput: string,
  options: Parameters<ExtractorAdapter["extract"]>[2],
): Promise<CanonicalCitation | null> {
  const result = await extractor.extract(rawInput, inputStyle, {
    ...options,
    forceGrobid: true,
    forceGrobidReason: 'pre_resolution_weak_parse',
  });

  if (result.extractorPath !== 'grobid' && result.extractorPath !== 'hybrid') {
    return null;
  }

  const authorParseResult = result.canonicalAuthors
    ? {
      authors: result.canonicalAuthors,
      parserMode: result.authorParserMode ?? 'none',
      warningFlags: result.authorWarningFlags ?? [],
      rejectedCandidates: result.rejectedCandidates ?? [],
    }
    : parseAuthorsForStyle(result.parsed.authors ?? [], result.detectedStyle ?? inputStyle);
  const yearValue = result.parsed.year ? Number.parseInt(result.parsed.year, 10) : null;

  const preferStringField = (
    current: typeof citation.title,
    nextValue: string | null | undefined,
    nextConfidence: number,
  ) => nextValue
    ? createFieldValue(nextValue, 'extracted', Math.max(current.confidence, nextConfidence), 'extract')
    : current;

  return {
    ...citation,
    referenceType: result.referenceType === 'unknown' ? citation.referenceType : result.referenceType,
    authors: authorParseResult.authors.length > 0
      ? createFieldValue(authorParseResult.authors, 'extracted', Math.max(citation.authors.confidence, result.fieldConfidence.authors ?? 0), 'extract')
      : citation.authors,
    title: preferStringField(citation.title, result.parsed.title ?? null, result.fieldConfidence.title ?? 0),
    year: Number.isFinite(yearValue)
      ? createFieldValue(Number(yearValue), 'extracted', Math.max(citation.year.confidence, result.fieldConfidence.year ?? 0), 'extract')
      : citation.year,
    journal: preferStringField(citation.journal, result.parsed.journal ?? null, result.fieldConfidence.journal ?? 0),
    volume: preferStringField(citation.volume, result.parsed.volume ?? null, result.fieldConfidence.volume ?? 0),
    issue: preferStringField(citation.issue, result.parsed.issue ?? null, result.fieldConfidence.issue ?? 0),
    pages: preferStringField(citation.pages, result.parsed.pages ?? result.parsed['article-number'] ?? null, result.fieldConfidence.pages ?? 0),
    doi: preferStringField(citation.doi, result.parsed.doi ?? null, result.fieldConfidence.doi ?? 0),
    publisher: preferStringField(citation.publisher, result.parsed.publisher ?? null, result.fieldConfidence.publisher ?? 0),
    url: preferStringField(citation.url, result.parsed.url ?? null, result.fieldConfidence.url ?? 0),
    conferenceTitle: preferStringField(citation.conferenceTitle, result.parsed.conferenceTitle ?? null, result.fieldConfidence.journal ?? 0),
    bookTitle: preferStringField(citation.bookTitle, result.parsed.bookTitle ?? null, result.fieldConfidence.journal ?? 0),
    institution: preferStringField(citation.institution, result.parsed.institution ?? null, result.fieldConfidence.publisher ?? 0),
    edition: preferStringField(citation.edition, result.parsed.edition ?? null, result.fieldConfidence.publisher ?? 0),
    editor: preferStringField(citation.editor, result.parsed.editor ?? null, result.fieldConfidence.authors ?? 0),
    extraction: {
      method: result.method,
      fallbackUsed: true,
      extractorPath: result.extractorPath,
      selectedBranch: result.selectedBranch,
      selectionReason: result.selectionReason ?? 'pre_resolution_weak_parse',
      authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
      rejectedCandidates: [
        ...(citation.extraction?.rejectedCandidates ?? []),
        ...authorParseResult.rejectedCandidates,
      ],
    },
  };
}

function providerOrderForCitation(citation: CanonicalCitation): ProviderKey[] {
  const doiHint = citation.doi.value ?? deriveDoiHintFromUrl(citation.url.value);
  if (doiHint) {
    return isBiomedical(citation) && ['journal', 'preprint', 'unknown', 'website'].includes(citation.referenceType)
      ? ['doi', 'crossref', 'pubmed', 'openalex']
      : ['doi', 'crossref', 'openalex'];
  }
  if (isBiomedical(citation) && ['journal', 'preprint', 'unknown'].includes(citation.referenceType)) {
    return ['crossref', 'pubmed', 'openalex'];
  }
  if (scholarlyWebsiteNeedsAuthority(citation)) {
    return ['crossref', 'openalex'];
  }
  if (['report', 'book', 'website', 'chapter'].includes(citation.referenceType) || isCorporateHeavy(citation)) {
    return ['openalex', 'crossref'];
  }
  return ['crossref', 'openalex'];
}

async function fetchProviderCandidates(
  provider: ResolutionProviderAdapter,
  query: ResolutionSearchQuery,
  doiHint: string | null,
  providerKey: ProviderKey,
): Promise<ResolutionCandidateRecord[]> {
  switch (providerKey) {
    case 'doi':
      return doiHint ? provider.lookupByDoi(doiHint) : [];
    case 'crossref':
      return query.title ? provider.searchCrossrefByTitle(query, PROVIDER_LIMIT) : [];
    case 'pubmed':
      return query.title ? provider.searchPubmedByTitle(query, PROVIDER_LIMIT) : [];
    case 'openalex':
      return query.title ? provider.searchOpenAlexByTitle(query, PROVIDER_LIMIT) : [];
    default:
      return [];
  }
}

function toMatchStrategy(providerKey: ProviderKey): ResolutionMetadata['matchStrategy'] {
  switch (providerKey) {
    case 'doi':
      return 'crossref_doi';
    case 'crossref':
      return 'crossref_exact_title';
    case 'pubmed':
      return 'pubmed_exact_title';
    case 'openalex':
      return 'openalex_exact_title';
    default:
      return 'none';
  }
}

function applyVerifiedCandidate(
  citation: CanonicalCitation,
  candidate: ResolutionAcceptedCandidate,
): { citation: CanonicalCitation; appliedFields: string[]; conflictFields: string[] } {
  const audit: AuthorityMergeAudit = {
    appliedFields: [],
    conflictFields: [],
  };
  const resolvedReferenceType = resolveAuthorityReferenceType(citation, candidate);
  if (resolvedReferenceType !== citation.referenceType) {
    recordField(audit.appliedFields, 'referenceType');
  }

  const promoteAuthorityPages = resolvedReferenceType === 'journal'
    && !citation.volume.value
    && !citation.issue.value
    && Boolean(candidate.volume)
    && Boolean(candidate.pages)
    && isLikelyOnlineFirstLocator(citation.pages.value);

  let nextCitation: CanonicalCitation = {
    ...citation,
    referenceType: resolvedReferenceType,
    authors: updateAuthorsField(citation.authors, candidate.authors, 'enrich', audit),
    title: updateStringField(citation.title, candidate.title, 'enrich', audit, 'title', normalizeTextComparisonValue),
    year: updateNumericField(citation.year, candidate.year, 'enrich', audit, 'year'),
    doi: updateStringField(citation.doi, candidate.doi ? normalizeDoiValue(candidate.doi) : undefined, 'enrich', audit, 'doi', normalizeDoiValue),
    url: updateStringField(citation.url, candidate.url, 'enrich', audit, 'url'),
    volume: updateStringField(citation.volume, candidate.volume, 'enrich', audit, 'volume'),
    issue: updateStringField(citation.issue, candidate.issue, 'enrich', audit, 'issue'),
    pages: promoteAuthorityPages
      ? (() => {
          recordField(audit.appliedFields, 'pages');
          return authorityFieldValue(citation.pages, normalizeWhitespace(candidate.pages ?? ''), 'enrich');
        })()
      : updateStringField(citation.pages, candidate.pages, 'enrich', audit, 'pages', normalizePageComparisonValue),
    publisher: updateStringField(citation.publisher, candidate.publisher, 'enrich', audit, 'publisher'),
  };

  const venue = candidate.venue;
  if (resolvedReferenceType === 'conference') {
    nextCitation = {
      ...nextCitation,
      conferenceTitle: updateStringField(citation.conferenceTitle, venue, 'enrich', audit, 'conferenceTitle', buildVenueNormalizer),
    };
  } else if (['book', 'chapter'].includes(resolvedReferenceType)) {
    nextCitation = {
      ...nextCitation,
      bookTitle: updateStringField(citation.bookTitle, venue, 'enrich', audit, 'bookTitle', buildVenueNormalizer),
    };
  } else {
    nextCitation = {
      ...nextCitation,
      journal: updateStringField(citation.journal, venue, 'enrich', audit, 'journal', buildVenueNormalizer),
    };
  }

  if (resolvedReferenceType === 'report' && !nextCitation.institution.value && candidate.publisher && isGroupAuthor(candidate.publisher)) {
    recordField(audit.appliedFields, 'institution');
    nextCitation = {
      ...nextCitation,
      institution: authorityFieldValue(nextCitation.institution, normalizeGroupAuthor(candidate.publisher), 'enrich'),
    };
  }

  return {
    citation: nextCitation,
    appliedFields: audit.appliedFields,
    conflictFields: audit.conflictFields,
  };
}

function providerKeyFromPayload(payload: CachedResolutionPayload): ProviderKey | 'cache' | 'unverifiable' {
  if (!payload.acceptedCandidate) return 'unverifiable';
  if (payload.matchStrategy === 'crossref_doi') return 'doi';
  switch (payload.acceptedCandidate.provider) {
    case 'crossref':
    case 'pubmed':
    case 'openalex':
      return payload.acceptedCandidate.provider;
    default:
      return 'unverifiable';
  }
}

function applyResolutionPayload(
  citation: CanonicalCitation,
  payload: CachedResolutionPayload,
  resolutionProviderId: string,
  sourceMode: 'cache' | 'shared' | 'direct',
): { citation: CanonicalCitation; appliedFields: string[]; conflictFields: string[] } {
  let nextCitation = citation;
  let appliedFields: string[] = [];
  let conflictFields: string[] = [];

  if (payload.acceptedCandidate) {
    const merged = applyVerifiedCandidate(citation, payload.acceptedCandidate);
    nextCitation = merged.citation;
    appliedFields = merged.appliedFields;
    conflictFields = merged.conflictFields;
  }

  const providerNoCoverage = payload.status === 'provider_no_coverage';

  return {
    citation: {
      ...nextCitation,
      resolution: {
        ...buildResolutionMetadata(nextCitation, payload.status, {
          resolvedAt: nowIso(),
          provider: payload.provider ?? resolutionProviderId,
          matchStrategy: payload.matchStrategy,
          acceptedCandidate: payload.acceptedCandidate,
        }),
        candidateCount: payload.candidateCount,
        rejectedReasons: payload.rejectedReasons,
        appliedFields,
        conflictFields,
        yearToleranceApplied: payload.yearToleranceApplied,
      },
      enrichment: buildEnrichmentFromResolution(
        payload.acceptedCandidate
          ? 'fetched'
          : payload.status === 'provider_error'
            ? 'error'
            : providerNoCoverage
              ? 'skipped'
              : 'no_match',
        resolutionProviderId,
        sourceMode === 'cache'
          ? 'cache'
          : providerNoCoverage
            ? 'skipped'
            : providerKeyFromPayload(payload),
        payload.acceptedCandidate,
        sourceMode === 'cache' ? { cached: true } : sourceMode === 'shared' ? { shared: true } : undefined,
        sourceMode === 'cache',
      ),
    },
    appliedFields,
    conflictFields,
  };
}

function buildEnrichmentFromResolution(
  status: EnrichmentMetadata['status'],
  providerId: string,
  providerKey: ProviderKey | 'cache' | 'unverifiable' | 'skipped',
  candidate?: ResolutionAcceptedCandidate,
  raw?: Record<string, unknown>,
  cacheHit = false,
): EnrichmentMetadata {
  return {
    status,
    provider: candidate?.provider ?? providerId,
    sourceUsed: providerKey === 'doi'
      ? 'crossref_doi'
      : providerKey === 'crossref'
        ? 'crossref_title_author'
        : providerKey === 'pubmed'
          ? 'pubmed'
          : providerKey === 'openalex'
            ? 'openalex'
            : providerKey === 'cache'
              ? 'cache'
              : providerKey === 'skipped'
                ? 'skipped'
                : 'unverifiable',
    cacheHit,
    doiFound: Boolean(candidate?.doi),
    abstractFound: false,
    retractedFlag: /retract/i.test(String(candidate?.title ?? '')),
    matchedTitle: candidate?.title,
    matchedAuthors: candidate?.authors,
    matchedYear: candidate?.year,
    url: candidate?.url,
    raw,
  };
}

function buildTimedOutResolutionResult(
  citation: CanonicalCitation,
  resolutionProviderId: string,
): ResolutionExecutionResult {
  const providerOrder = providerOrderForCitation(citation);
  return {
    payload: {
      status: 'provider_error',
      provider: resolutionProviderId,
      matchStrategy: 'none',
      candidateCount: 0,
      rejectedReasons: ['resolution_execution_timeout'],
      yearToleranceApplied: false,
    },
    providerOrder,
    successfulProviderCount: 0,
    providerErrorCount: providerOrder.length > 0 ? 1 : 0,
    partialResult: true,
    fallbacksUsed: ['enrich:resolution_timeout'],
  };
}

export function createEnrichStage(
  resolutionProvider: ResolutionProviderAdapter,
  cache: CacheAdapter,
  extractor: ExtractorAdapter,
): V2Stage {
  return {
    id: 'enrich',
    async run(context) {
      const startedAt = Date.now();
      if (!context.request.enrich) {
        const citations = context.citations.map((citation) => addCitationStageLog(
          attachCitationDebug({
            ...citation,
            enrichment: citation.enrichment ?? buildEnrichmentFromResolution('skipped', resolutionProvider.id, 'skipped'),
          }, 'enrich', {
            status: 'skipped',
            providerOrder: [],
            candidateCount: 0,
            warningFlags: [],
          }, context.debugEnabled),
          createStageDiagnostic('enrich', 'skipped', 'Strict external resolution disabled for this request.', {
            provider: resolutionProvider.id,
          }),
        ));

        return {
          ...context,
          citations,
          jobDebug: context.debugEnabled
            ? {
              ...context.jobDebug,
              enrich: {
                citationCount: citations.length,
                provider: resolutionProvider.id,
                skipped: true,
              },
            }
            : context.jobDebug,
          pipelineLog: [
            ...context.pipelineLog,
            createStageDiagnostic(
              'enrich',
              'skipped',
              `Skipped strict external resolution for ${citations.length} citation(s).`,
              { provider: resolutionProvider.id, citationCount: citations.length },
              Date.now() - startedAt,
            ),
          ],
        };
      }

      const concurrency = Number.parseInt(process.env.V2_ENRICH_CONCURRENCY ?? String(DEFAULT_ENRICH_CONCURRENCY), 10);
      const configuredCitationTimeoutMs = Number.parseInt(process.env.V2_ENRICH_CITATION_TIMEOUT_MS ?? '', 10);
      const citationTimeoutMs = Number.isFinite(configuredCitationTimeoutMs) && configuredCitationTimeoutMs > 0
        ? configuredCitationTimeoutMs
        : DEFAULT_ENRICH_CITATION_TIMEOUT_MS;
      const limit = pLimit(Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_ENRICH_CONCURRENCY);
      const inFlightResolutionByKey = new Map<string, Promise<ResolutionExecutionResult>>();
      const batchSize = context.citations.length;

      const executeResolutionForCitation = async (
        citation: CanonicalCitation,
        resolutionQuery: ResolutionSearchQuery,
      ): Promise<ResolutionExecutionResult> => {
        const localFallbacks: string[] = [];
        let localPartialResult = false;
        const providerOrder = providerOrderForCitation(citation);
        const resolutionDoiHint = citation.doi.value ?? deriveDoiHintFromUrl(citation.url.value);
        const allCandidates: ResolutionCandidateRecord[] = [];
        const rejectedReasons: string[] = [];
        let providerError = false;
        let successfulProviderCount = 0;
        let providerErrorCount = 0;
        let selected: ReturnType<typeof chooseBestResolutionCandidate> = {
          ambiguous: false,
          evaluated: [],
        };

        for (const providerKey of providerOrder) {
          try {
            const candidates = await fetchProviderCandidates(
              resolutionProvider,
              resolutionQuery,
              resolutionDoiHint,
              providerKey,
            );
            successfulProviderCount += 1;
            allCandidates.push(...candidates);
            selected = chooseBestResolutionCandidate(citation, allCandidates);
            if (selected.accepted && !selected.ambiguous && selected.accepted.band === 2) {
              break;
            }
          } catch (error) {
            providerError = true;
            providerErrorCount += 1;
            localPartialResult = true;
            localFallbacks.push(`enrich:${providerKey}_provider_error`);
            rejectedReasons.push(`${providerKey}_provider_error:${error instanceof Error ? error.message : String(error)}`);
          }
        }

        rejectedReasons.push(
          ...selected.evaluated
            .filter((entry) => !entry.accepted)
            .flatMap((entry) => entry.reasons.map((reason) => `${entry.candidate.provider}:${reason}`)),
        );

        let payload: CachedResolutionPayload;
        if (selected.ambiguous) {
          payload = {
            status: 'ambiguous_match',
            provider: resolutionProvider.id,
            matchStrategy: 'none',
            candidateCount: allCandidates.length,
            rejectedReasons: [
              'ambiguous_match',
              ...selected.evaluated
                .filter((entry) => entry.accepted)
                .slice(0, 2)
                .map((entry) => `${entry.candidate.provider}:${entry.candidate.title ?? 'unknown_title'}`),
              ...rejectedReasons,
            ],
            yearToleranceApplied: false,
          };
        } else if (selected.accepted) {
          const acceptedCandidate = buildAcceptedCandidateSummary(selected.accepted.candidate);
          payload = {
            status: selected.accepted.yearToleranceApplied ? 'verified_with_year_tolerance' : 'verified',
            provider: selected.accepted.candidate.provider,
            matchStrategy: toMatchStrategy(
              selected.accepted.candidate.provider === 'crossref' && citation.doi.value
                ? 'doi'
                : selected.accepted.candidate.provider,
            ),
            candidateCount: allCandidates.length,
            acceptedCandidate,
            rejectedReasons,
            yearToleranceApplied: selected.accepted.yearToleranceApplied,
          };
        } else {
          const status: ResolutionMetadata['status'] = providerError && successfulProviderCount === 0
            ? 'provider_error'
            : allCandidates.length === 0 && ['report', 'book', 'website', 'chapter'].includes(citation.referenceType)
              ? 'provider_no_coverage'
              : 'no_exact_match';
          payload = {
            status,
            provider: resolutionProvider.id,
            matchStrategy: 'none',
            candidateCount: allCandidates.length,
            rejectedReasons,
            yearToleranceApplied: false,
          };
        }

        await cache.set(cacheKeyForCitation(citation), payload satisfies CachedResolutionPayload);

        return {
          payload,
          providerOrder,
          successfulProviderCount,
          providerErrorCount,
          partialResult: localPartialResult,
          fallbacksUsed: localFallbacks,
        };
      };

      const results = await Promise.all(context.citations.map((citation, citationIndex) => limit(async () => {
        const localFallbacks: string[] = [];
        let localPartialResult = false;

        try {
        if (citation.status === 'duplicate') {
          const nextCitation = attachCitationDebug({
            ...citation,
            resolution: buildResolutionMetadata(citation, 'skipped_duplicate', {
              resolvedAt: nowIso(),
              provider: resolutionProvider.id,
              matchStrategy: 'none',
            }),
            enrichment: buildEnrichmentFromResolution('skipped', resolutionProvider.id, 'skipped'),
          }, 'enrich', {
            status: 'skipped_duplicate',
            providerOrder: [],
            candidateCount: 0,
            warningFlags: [],
          }, context.debugEnabled);

          return {
            citation: addCitationStageLog(nextCitation, createStageDiagnostic('enrich', 'skipped', 'Resolution skipped for duplicate citation.')),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        let candidateCitation = citation;
        if (shouldAttemptPreResolutionGrobidRecovery(candidateCitation, batchSize, context.executionMode)) {
          try {
            const recoveredCitation = await applyGrobidRecoveryExtraction(
              candidateCitation,
              extractor,
              candidateCitation.detectedStyle.value ?? context.request.inputStyle,
              context.workingChunkByCitationId[citation.id]?.joinedText ?? citation.raw,
              {
                inputProfile: context.inputProfile,
                detectionConfidence: candidateCitation.detectedStyle.confidence,
                batchSize,
                executionMode: context.executionMode,
                splitArtifact: context.splitArtifactsByCitationId[citation.id],
                llmBudget: context.llmBudget,
                debugEnabled: context.debugEnabled,
              },
            );
            if (recoveredCitation) {
              candidateCitation = recoveredCitation;
              localFallbacks.push('enrich:grobid_recovery_extract');
            }
          } catch (error) {
            localFallbacks.push('enrich:grobid_recovery_failed');
            localPartialResult = true;
          }
        }

        const queryEvidence = buildResolutionQueryEvidence(candidateCitation);
        const urlBackedWebsiteEvidence = candidateCitation.referenceType === 'website' && Boolean(queryEvidence.url);
        const localOnlyResolutionFallback = canUseLocalOnlyResolutionFallback(candidateCitation, queryEvidence);
        if (!queryEvidence.titlePresent || (!queryEvidence.firstAuthorSurname && !queryEvidence.groupAuthorLiteral && !localOnlyResolutionFallback && !urlBackedWebsiteEvidence)) {
          const nextCitation = attachCitationDebug({
            ...candidateCitation,
            resolution: {
              ...buildResolutionMetadata(candidateCitation, 'insufficient_evidence', {
                resolvedAt: nowIso(),
                provider: resolutionProvider.id,
                matchStrategy: 'none',
              }),
              rejectedReasons: ['parse_too_sparse'],
            },
            enrichment: buildEnrichmentFromResolution('skipped', resolutionProvider.id, 'skipped'),
          }, 'enrich', {
            status: 'insufficient_evidence',
            providerOrder: [],
            candidateCount: 0,
            warningFlags: ['parse_too_sparse'],
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, nextCitation, {
            providerOrder: [],
            warningFlags: ['parse_too_sparse'],
            candidateCount: 0,
          });
          return {
            citation: addCitationStageLog(nextCitation, createStageDiagnostic('enrich', 'warning', 'Skipped network resolution because parse evidence was insufficient.', {
              provider: resolutionProvider.id,
              reason: 'parse_too_sparse',
            })),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        if (localOnlyResolutionFallback) {
          const nextCitation = attachCitationDebug({
            ...candidateCitation,
            resolution: {
              ...buildResolutionMetadata(candidateCitation, 'provider_no_coverage', {
                resolvedAt: nowIso(),
                provider: resolutionProvider.id,
                matchStrategy: 'none',
              }),
              rejectedReasons: ['local_only_author_optional_reference'],
            },
            enrichment: buildEnrichmentFromResolution('skipped', resolutionProvider.id, 'skipped'),
          }, 'enrich', {
            status: 'provider_no_coverage',
            providerOrder: [],
            candidateCount: 0,
            warningFlags: ['local_only_author_optional_reference'],
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, nextCitation, {
            providerOrder: [],
            warningFlags: ['local_only_author_optional_reference'],
            candidateCount: 0,
          });
          return {
            citation: addCitationStageLog(nextCitation, createStageDiagnostic('enrich', 'success', 'Skipped external resolution for an author-optional reference with strong local evidence.', {
              provider: resolutionProvider.id,
              reason: 'local_only_author_optional_reference',
            })),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        const strongLocalSkipReason = strongLocalResolutionSkipReason(candidateCitation, context.executionMode, batchSize);
        if (strongLocalSkipReason) {
          const skipMessage = strongLocalSkipReason === 'strong_local_doi_skip'
            ? 'Skipped network resolution because the citation already has a strong local DOI-backed parse.'
            : strongLocalSkipReason === 'strong_local_sync_skip'
              ? 'Skipped network resolution because this citation type already has strong local evidence in synchronous mode.'
              : 'Skipped network resolution for a strong local parse in a large synchronous batch.';
          const nextCitation = attachCitationDebug({
            ...candidateCitation,
            enrichment: buildEnrichmentFromResolution('skipped', resolutionProvider.id, 'skipped', undefined, {
              strongLocalSkipReason,
              batchSize,
            }),
          }, 'enrich', {
            status: 'skipped_strong_local_sync',
            providerOrder: [],
            candidateCount: 0,
            warningFlags: [],
            batchSize,
            strongLocalSkipReason,
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, nextCitation, {
            providerOrder: [],
            candidateCount: 0,
            batchSize,
            strongLocalSkipReason,
          });
          return {
            citation: addCitationStageLog(nextCitation, createStageDiagnostic('enrich', 'skipped', skipMessage, {
              provider: resolutionProvider.id,
              reason: strongLocalSkipReason,
              batchSize,
            })),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        const cacheKey = cacheKeyForCitation(candidateCitation);
        const resolutionQuery: ResolutionSearchQuery = {
          title: candidateCitation.title.value ?? '',
          firstAuthorSurname: queryEvidence.firstAuthorSurname,
          groupAuthorLiteral: queryEvidence.groupAuthorLiteral,
          year: queryEvidence.year ?? null,
          venue: queryEvidence.venue ?? null,
          url: queryEvidence.url ?? null,
          sourceType: queryEvidence.sourceType,
        };
        const cached = await cache.get<CachedResolutionPayload>(cacheKey);
        if (cached) {
          const hydrated = applyResolutionPayload(candidateCitation, cached, resolutionProvider.id, 'cache');
          const cachedCitation = attachCitationDebug(hydrated.citation, 'enrich', {
            status: cached.status,
            providerOrder: ['cache'],
            cacheHit: true,
            candidateCount: cached.candidateCount,
            appliedFields: hydrated.appliedFields,
            conflictFields: hydrated.conflictFields,
            warningFlags: hydrated.conflictFields,
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, cachedCitation, {
            providerOrder: ['cache'],
            cacheHit: true,
            candidateCount: cached.candidateCount,
            appliedFields: hydrated.appliedFields,
            conflictFields: hydrated.conflictFields,
            warningFlags: hydrated.conflictFields,
          });
          return {
            citation: addCitationStageLog(cachedCitation, createStageDiagnostic('enrich', 'success', 'Reused cached strict resolution result.', {
              provider: cached.provider,
              status: cached.status,
              cacheKey,
              appliedFields: hydrated.appliedFields,
              conflictFields: hydrated.conflictFields,
            })),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }

        let execution = inFlightResolutionByKey.get(cacheKey);
        const sharedExecution = Boolean(execution);
        if (!execution) {
          execution = executeResolutionForCitation(candidateCitation, resolutionQuery)
            .finally(() => {
              if (inFlightResolutionByKey.get(cacheKey) === execution) {
                inFlightResolutionByKey.delete(cacheKey);
              }
            });
          inFlightResolutionByKey.set(cacheKey, execution);
        }
        let executionTimeoutHandle: NodeJS.Timeout | null = null;
        const resolved = await Promise.race([
            execution,
            new Promise<ResolutionExecutionResult>((resolve) => {
              executionTimeoutHandle = setTimeout(() => {
                if (inFlightResolutionByKey.get(cacheKey) === execution) {
                  inFlightResolutionByKey.delete(cacheKey);
                }
              const timedOutResult = buildTimedOutResolutionResult(candidateCitation, resolutionProvider.id);
              void cache.set(cacheKey, timedOutResult.payload);
              resolve(timedOutResult);
            }, citationTimeoutMs);
          }),
        ]).finally(() => {
          if (executionTimeoutHandle) {
            clearTimeout(executionTimeoutHandle);
          }
        });
        localFallbacks.push(...resolved.fallbacksUsed);
        localPartialResult = localPartialResult || resolved.partialResult;

        const hydrated = applyResolutionPayload(
          candidateCitation,
          resolved.payload,
          resolutionProvider.id,
          sharedExecution ? 'shared' : 'direct',
        );
        let nextCitation = hydrated.citation;
        let stageStatus: 'success' | 'warning' = 'warning';
        let stageMessage = 'No exact external match was accepted for this citation.';

        if (resolved.payload.status === 'ambiguous_match') {
          stageMessage = 'Multiple strict external matches tied; citation remains unresolved.';
        } else if (resolved.payload.acceptedCandidate) {
          stageStatus = hydrated.conflictFields.length === 0 ? 'success' : 'warning';
          stageMessage = hydrated.conflictFields.length === 0
            ? (sharedExecution ? 'Reused an in-flight verified authority match.' : 'Verified citation via strict external resolution.')
            : 'Verified citation externally, but conflicting extracted fields were preserved for review.';
        } else if (resolved.payload.status === 'provider_error') {
          stageMessage = 'External resolution completed with provider errors and no accepted exact match.';
        } else {
          stageMessage = sharedExecution
            ? 'Reused an in-flight unresolved authority result.'
            : 'Strict external resolution did not accept any exact-title candidate.';
        }

        nextCitation = attachCitationDebug(nextCitation, 'enrich', {
          status: nextCitation.resolution?.status,
          providerOrder: resolved.providerOrder,
          cacheHit: false,
          candidateCount: resolved.payload.candidateCount,
          successfulProviderCount: resolved.successfulProviderCount,
          providerErrorCount: resolved.providerErrorCount,
          acceptedCandidate: nextCitation.resolution?.acceptedCandidate,
          rejectedReasons: nextCitation.resolution?.rejectedReasons ?? [],
          appliedFields: hydrated.appliedFields,
          conflictFields: hydrated.conflictFields,
          yearToleranceApplied: nextCitation.resolution?.yearToleranceApplied ?? false,
          warningFlags: hydrated.conflictFields,
          sharedExecution,
        }, context.debugEnabled);
        logStructuredDebug(context, 'enrich', citationIndex, nextCitation, {
          providerOrder: resolved.providerOrder,
          candidateCount: resolved.payload.candidateCount,
          successfulProviderCount: resolved.successfulProviderCount,
          providerErrorCount: resolved.providerErrorCount,
          appliedFields: hydrated.appliedFields,
          warningFlags: hydrated.conflictFields,
          conflictFields: hydrated.conflictFields,
          selectedBranch: undefined,
          selectionReason: nextCitation.resolution?.status,
          sharedExecution,
        });

        return {
          citation: addCitationStageLog(nextCitation, createStageDiagnostic('enrich', stageStatus, stageMessage, {
            provider: nextCitation.resolution?.provider,
            status: nextCitation.resolution?.status,
            candidateCount: nextCitation.resolution?.candidateCount,
            appliedFields: hydrated.appliedFields,
            conflictFields: hydrated.conflictFields,
            sharedExecution,
          })),
          fallbacksUsed: localFallbacks,
          partialResult: localPartialResult,
        };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          localFallbacks.push('enrich:item-error');
          localPartialResult = true;
          const nextCitation = attachCitationDebug({
            ...citation,
            resolution: {
              ...buildResolutionMetadata(citation, 'provider_error', {
                resolvedAt: nowIso(),
                provider: resolutionProvider.id,
                matchStrategy: 'none',
              }),
              rejectedReasons: [message],
            },
            enrichment: buildEnrichmentFromResolution('error', resolutionProvider.id, 'unverifiable'),
          }, 'enrich', {
            status: 'provider_error',
            providerOrder: [],
            cacheHit: false,
            candidateCount: 0,
            warningFlags: [message],
            isolationRecovered: true,
          }, context.debugEnabled);
          logStructuredDebug(context, 'enrich', citationIndex, nextCitation, {
            providerOrder: [],
            candidateCount: 0,
            warningFlags: [message],
            conflictFields: [],
            selectedBranch: undefined,
            selectionReason: 'provider_error',
            sharedExecution: false,
          });
          return {
            citation: addCitationStageLog(
              nextCitation,
              createStageDiagnostic(
                'enrich',
                'warning',
                'External resolution failed for this citation; continuing with the local canonical fields.',
                { provider: resolutionProvider.id, message },
              ),
            ),
            fallbacksUsed: localFallbacks,
            partialResult: localPartialResult,
          };
        }
      })));

      const citations = results.map((result) => result.citation);
      const fallbacksUsed = [
        ...context.fallbacksUsed,
        ...results.flatMap((result) => result.fallbacksUsed),
      ];
      const partialResult = context.partialResult || results.some((result) => result.partialResult);

      return {
        ...context,
        citations,
        fallbacksUsed,
        partialResult,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            enrich: {
              citationCount: citations.length,
              provider: resolutionProvider.id,
              concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_ENRICH_CONCURRENCY,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'enrich',
            'success',
            `Completed strict external resolution for ${citations.length} citation(s).`,
            { provider: resolutionProvider.id, citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
