import type { CanonicalCitation, CanonicalReferenceType, ValidationIssue } from '@shared/schema';
import { isGroupAuthor, normalizeGroupAuthor } from '../shared/citationSemantics.js';
import { normalizeResolutionTitle, normalizeSurnameForResolution } from './resolution.js';
import { normalizeDoiValue, normalizeWhitespace } from './utils.js';

export const READY_CONFIDENCE_FLOOR = 0.8;
export const REVIEW_CONFIDENCE_FLOOR = 0.6;

export type ReadyBlockerCode =
  | 'identifier_in_locator'
  | 'multiple_link_targets'
  | 'duplicate_link_target'
  | 'incompatible_field_overlap'
  | 'edition_repeated'
  | 'identifier_in_text_field'
  | 'repeated_title_in_container'
  | 'report_number_misfiled'
  | 'website_tail_duplication';

export const HARD_READY_BLOCKER_CODES = new Set<ReadyBlockerCode>([
  'identifier_in_locator',
  'multiple_link_targets',
  'duplicate_link_target',
  'incompatible_field_overlap',
]);

export const SOFT_READY_BLOCKER_CODES = new Set<ReadyBlockerCode>([
  'edition_repeated',
  'identifier_in_text_field',
  'repeated_title_in_container',
  'report_number_misfiled',
  'website_tail_duplication',
]);

const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+\b/giu;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]}]+/giu;
const REPORT_NUMBER_PATTERN = /\b(?:COM\(\d{4}\)\s*\d+\s*(?:final)?|CELEX:\s*[0-9A-Z]+|Report\s+No\.\s*[-A-Z0-9()./ ]+)\b/giu;

type FieldName =
  | 'title'
  | 'journal'
  | 'conferenceTitle'
  | 'bookTitle'
  | 'publisher'
  | 'institution'
  | 'volume'
  | 'issue'
  | 'pages'
  | 'doi'
  | 'url';

type IdentifierHit = {
  target: string;
  kind: 'doi' | 'url';
  raw: string;
};

export interface ReadyBlockerAnalysis {
  codes: ReadyBlockerCode[];
  hardCodes: ReadyBlockerCode[];
  softCodes: ReadyBlockerCode[];
  issues: ValidationIssue[];
  distinctLinkTargets: string[];
  duplicateLinkTargets: string[];
}

export interface ResolutionBucketState {
  hardUnresolved: boolean;
  softUnresolvedAfterEscalation: boolean;
}

function stripDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeComparisonText(value: string | null | undefined): string {
  return normalizeWhitespace(
    stripDiacritics(value ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' '),
  );
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeComparisonText(value).split(/\s+/).filter(Boolean);
}

function contiguousOverlapLength(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;

  let longest = 0;
  const rightIndex = new Map<string, number[]>();
  for (let index = 0; index < right.length; index += 1) {
    const token = right[index]!;
    const values = rightIndex.get(token) ?? [];
    values.push(index);
    rightIndex.set(token, values);
  }

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const positions = rightIndex.get(left[leftIndex]!) ?? [];
    for (const start of positions) {
      let length = 0;
      while (
        leftIndex + length < left.length
        && start + length < right.length
        && left[leftIndex + length] === right[start + length]
      ) {
        length += 1;
      }
      if (length > longest) longest = length;
    }
  }

  return longest;
}

function normalizedFieldValue(citation: CanonicalCitation, field: FieldName): string {
  switch (field) {
    case 'title':
      return citation.title.value ?? '';
    case 'journal':
      return citation.journal.value ?? '';
    case 'conferenceTitle':
      return citation.conferenceTitle.value ?? '';
    case 'bookTitle':
      return citation.bookTitle.value ?? '';
    case 'publisher':
      return citation.publisher.value ?? '';
    case 'institution':
      return citation.institution.value ?? '';
    case 'volume':
      return citation.volume.value ?? '';
    case 'issue':
      return citation.issue.value ?? '';
    case 'pages':
      return citation.pages.value ?? '';
    case 'doi':
      return citation.doi.value ?? '';
    case 'url':
      return citation.url.value ?? '';
  }
}

function normalizeCanonicalUrl(value: string | null | undefined): string {
  const trimmed = normalizeWhitespace(value ?? '').replace(/[)\],.;:]+$/g, '');
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/g, '') || '/';
    const search = parsed.search || '';
    return `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${path}${search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function canonicalIdentifierTarget(value: string | null | undefined): IdentifierHit | null {
  const trimmed = normalizeWhitespace(value ?? '');
  if (!trimmed) return null;

  const doiCandidate = normalizeWhitespace(trimmed)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  if (/^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/i.test(doiCandidate)) {
    const normalizedDoi = normalizeDoiValue(trimmed);
    return {
      target: `doi:${normalizedDoi.toLowerCase()}`,
      kind: 'doi',
      raw: trimmed,
    };
  }

  const canonicalUrl = normalizeCanonicalUrl(trimmed);
  if (!canonicalUrl) return null;

  return {
    target: `url:${canonicalUrl}`,
    kind: 'url',
    raw: trimmed,
  };
}

export function extractIdentifierHits(value: string | null | undefined): IdentifierHit[] {
  const source = value ?? '';
  if (!source) return [];

  const hits: IdentifierHit[] = [];
  const addMatch = (raw: string): void => {
    const normalized = raw.replace(/[)\],.;:]+$/g, '');
    const hit = canonicalIdentifierTarget(normalized);
    if (!hit) return;
    if (!hits.some((existing) => existing.target === hit.target && existing.raw === hit.raw)) {
      hits.push(hit);
    }
  };

  for (const match of source.matchAll(URL_PATTERN)) {
    addMatch(match[0]);
  }

  for (const match of source.matchAll(DOI_PATTERN)) {
    addMatch(match[0]);
  }

  return hits;
}

function hasIndividualAuthor(citation: CanonicalCitation): boolean {
  return citation.authors.value.some((author) => {
    const literal = normalizeWhitespace(author.literal ?? '');
    if (literal && isGroupAuthor(literal)) return false;
    return !isGroupAuthor(author.last);
  });
}

function firstTitleTokens(title: string, count: number): string {
  return tokenize(title).slice(0, count).join(' ');
}

function allowsInstitutionalOverlap(
  citation: CanonicalCitation,
  field: FieldName,
  titleNormalized: string,
  fieldNormalized: string,
): boolean {
  if (!titleNormalized || !fieldNormalized) return false;
  const authorLiteral = citation.authors.value[0]?.literal ?? '';
  const normalizedAuthorLiteral = normalizeComparisonText(
    authorLiteral && isGroupAuthor(authorLiteral)
      ? normalizeGroupAuthor(authorLiteral)
      : '',
  );
  const normalizedInstitution = normalizeComparisonText(citation.institution.value);
  const normalizedPublisher = normalizeComparisonText(citation.publisher.value);

  if (field === 'institution' && normalizedAuthorLiteral && normalizedAuthorLiteral === fieldNormalized) {
    return true;
  }
  if (field === 'publisher' && normalizedAuthorLiteral && normalizedAuthorLiteral === fieldNormalized) {
    return true;
  }
  if (
    (field === 'publisher' && normalizedInstitution && normalizedInstitution === fieldNormalized)
    || (field === 'institution' && normalizedPublisher && normalizedPublisher === fieldNormalized)
  ) {
    return true;
  }

  if (
    (citation.referenceType === 'report' || citation.referenceType === 'book')
    && !hasIndividualAuthor(citation)
    && field === 'publisher'
  ) {
    for (let count = 1; count <= 4; count += 1) {
      if (fieldNormalized === firstTitleTokens(titleNormalized, count)) {
        return true;
      }
    }
  }

  return false;
}

function canonicalLinkTargetsByField(citation: CanonicalCitation): Map<FieldName, IdentifierHit[]> {
  const result = new Map<FieldName, IdentifierHit[]>();
  const fields: FieldName[] = [
    'title',
    'journal',
    'conferenceTitle',
    'bookTitle',
    'publisher',
    'institution',
    'volume',
    'issue',
    'pages',
    'doi',
    'url',
  ];

  for (const field of fields) {
    result.set(field, extractIdentifierHits(normalizedFieldValue(citation, field)));
  }

  return result;
}

function reportNumberValue(value: string | null | undefined): string[] {
  return [...(value ?? '').matchAll(REPORT_NUMBER_PATTERN)]
    .map((match) => normalizeComparisonText(match[0]))
    .filter(Boolean);
}

function authorityJustifiesReportNumberPlacement(citation: CanonicalCitation, numbers: string[]): boolean {
  if (numbers.length === 0) return false;
  const authorityTitle = normalizeComparisonText(citation.resolution?.acceptedCandidate?.title);
  if (!authorityTitle) return false;
  return numbers.every((number) => authorityTitle.includes(number));
}

function websiteTailKeys(citation: CanonicalCitation): string[] {
  const url = normalizeCanonicalUrl(citation.url.value);
  if (!url) return [];

  const result = new Set<string>();
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const tail = parsed.pathname.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
    if (host) result.add(host);
    if (tail) result.add(tail);
  } catch {
    result.add(url.toLowerCase());
  }

  return [...result];
}

function countOccurrences(value: string, fragment: string): number {
  if (!value || !fragment) return 0;
  const pattern = new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return (value.match(pattern) ?? []).length;
}

function addIssue(
  issues: ValidationIssue[],
  code: ReadyBlockerCode,
  severity: 'error' | 'warning',
  field: string,
  message: string,
  extracted?: unknown,
): void {
  issues.push({
    field,
    severity,
    code,
    message,
    extracted,
  });
}

export function analyzeReadyBlockers(citation: CanonicalCitation): ReadyBlockerAnalysis {
  const codes = new Set<ReadyBlockerCode>();
  const issues: ValidationIssue[] = [];
  const linkTargetsByField = canonicalLinkTargetsByField(citation);
  const targetOccurrences = new Map<string, number>();
  const distinctTargets = new Set<string>();

  for (const [field, hits] of linkTargetsByField.entries()) {
    for (const hit of hits) {
      distinctTargets.add(hit.target);
      targetOccurrences.set(hit.target, (targetOccurrences.get(hit.target) ?? 0) + 1);
      if (['volume', 'issue', 'pages'].includes(field)) {
        codes.add('identifier_in_locator');
      } else if (['title', 'journal', 'conferenceTitle', 'bookTitle', 'publisher', 'institution'].includes(field)) {
        codes.add('identifier_in_text_field');
      }
    }
  }

  if (distinctTargets.size >= 2) {
    codes.add('multiple_link_targets');
  }

  const duplicateLinkTargets = [...targetOccurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([target]) => target);
  if (duplicateLinkTargets.length > 0) {
    codes.add('duplicate_link_target');
  }

  const titleNormalized = normalizeComparisonText(citation.title.value);
  const titleTokens = tokenize(citation.title.value);
  const overlapFields: Array<{ field: FieldName; label: string }> = [
    { field: 'journal', label: 'journal' },
    { field: 'conferenceTitle', label: 'conferenceTitle' },
    { field: 'bookTitle', label: 'bookTitle' },
    { field: 'publisher', label: 'publisher' },
    { field: 'institution', label: 'institution' },
  ];

  for (const { field, label } of overlapFields) {
    const fieldValue = normalizedFieldValue(citation, field);
    const fieldNormalized = normalizeComparisonText(fieldValue);
    if (!titleNormalized || !fieldNormalized) continue;
    if (allowsInstitutionalOverlap(citation, field, titleNormalized, fieldNormalized)) continue;

    const fieldTokens = tokenize(fieldValue);
    const overlap = contiguousOverlapLength(titleTokens, fieldTokens);
    const fullMatch = titleNormalized === fieldNormalized;

    if (fullMatch || overlap >= 5) {
      codes.add('incompatible_field_overlap');
      addIssue(
        issues,
        'incompatible_field_overlap',
        'error',
        label,
        `Title overlaps ${label} strongly enough to indicate duplicated or bled fields.`,
        { title: citation.title.value, [label]: fieldValue },
      );
      continue;
    }

    if (
      ['journal', 'conferenceTitle', 'bookTitle'].includes(field)
      && overlap >= 3
      && overlap <= 4
    ) {
      codes.add('repeated_title_in_container');
    }
  }

  const normalizedEdition = normalizeComparisonText(citation.edition.value)
    .replace(/\beditions?\b/g, 'ed')
    .replace(/\bed\b/g, 'ed')
    .trim();
  if (normalizedEdition && titleNormalized) {
    const editionMarker = normalizedEdition
      .replace(/\b(?:ed|edition)\b/g, '')
      .trim();
    if (
      (normalizedEdition && titleNormalized.includes(normalizedEdition))
      || (editionMarker && titleNormalized.includes(editionMarker))
    ) {
      codes.add('edition_repeated');
    }
  }

  const reportNumbersOutsideTitle = [
    ...reportNumberValue(citation.publisher.value),
    ...reportNumberValue(citation.institution.value),
    ...reportNumberValue(citation.journal.value),
    ...reportNumberValue(citation.conferenceTitle.value),
    ...reportNumberValue(citation.bookTitle.value),
    ...reportNumberValue(citation.volume.value),
    ...reportNumberValue(citation.issue.value),
    ...reportNumberValue(citation.pages.value),
    ...reportNumberValue(citation.url.value),
    ...reportNumberValue(citation.doi.value),
  ];
  if (
    reportNumbersOutsideTitle.length > 0
    && !authorityJustifiesReportNumberPlacement(citation, reportNumbersOutsideTitle)
  ) {
    codes.add('report_number_misfiled');
  }

  if (citation.referenceType === 'website') {
    const renderText = normalizeWhitespace([
      citation.title.value ?? '',
      citation.publisher.value ?? '',
      citation.journal.value ?? '',
      citation.url.value ?? '',
    ].join(' ')).toLowerCase();
    const duplicateTail = websiteTailKeys(citation).some((key) => countOccurrences(renderText, key) > 1);
    if (duplicateTail) {
      codes.add('website_tail_duplication');
    }
  }

  if (codes.has('identifier_in_locator')) {
    addIssue(
      issues,
      'identifier_in_locator',
      'error',
      'pages',
      'A DOI or URL leaked into a locator field.',
      {
        volume: citation.volume.value,
        issue: citation.issue.value,
        pages: citation.pages.value,
      },
    );
  }

  if (codes.has('multiple_link_targets')) {
    addIssue(
      issues,
      'multiple_link_targets',
      'error',
      'url',
      'Multiple distinct DOI or URL targets remain on the citation.',
      [...distinctTargets],
    );
  }

  if (codes.has('duplicate_link_target')) {
    addIssue(
      issues,
      'duplicate_link_target',
      'error',
      'url',
      'The same DOI or URL target appears more than once on the citation.',
      duplicateLinkTargets,
    );
  }

  if (codes.has('edition_repeated')) {
    addIssue(
      issues,
      'edition_repeated',
      'warning',
      'edition',
      'Edition information was repeated across title and edition fields.',
      {
        title: citation.title.value,
        edition: citation.edition.value,
      },
    );
  }

  if (codes.has('identifier_in_text_field')) {
    addIssue(
      issues,
      'identifier_in_text_field',
      'warning',
      'title',
      'A DOI or URL leaked into a text field instead of remaining as the terminal identifier.',
      {
        title: citation.title.value,
        journal: citation.journal.value,
        conferenceTitle: citation.conferenceTitle.value,
        bookTitle: citation.bookTitle.value,
        publisher: citation.publisher.value,
        institution: citation.institution.value,
      },
    );
  }

  if (codes.has('repeated_title_in_container') && !codes.has('incompatible_field_overlap')) {
    addIssue(
      issues,
      'repeated_title_in_container',
      'warning',
      'journal',
      'The title appears again inside the container/source field.',
      {
        title: citation.title.value,
        journal: citation.journal.value,
        conferenceTitle: citation.conferenceTitle.value,
        bookTitle: citation.bookTitle.value,
      },
    );
  }

  if (codes.has('report_number_misfiled')) {
    addIssue(
      issues,
      'report_number_misfiled',
      'warning',
      'publisher',
      'A report number appears outside the title without authority support for that placement.',
      reportNumbersOutsideTitle,
    );
  }

  if (codes.has('website_tail_duplication')) {
    addIssue(
      issues,
      'website_tail_duplication',
      'warning',
      'url',
      'Website source or URL tail content was duplicated in the rendered source fields.',
      {
        title: citation.title.value,
        publisher: citation.publisher.value,
        journal: citation.journal.value,
        url: citation.url.value,
      },
    );
  }

  const finalCodes = [...codes];
  return {
    codes: finalCodes,
    hardCodes: finalCodes.filter((code) => HARD_READY_BLOCKER_CODES.has(code)),
    softCodes: finalCodes.filter((code) => SOFT_READY_BLOCKER_CODES.has(code)),
    issues,
    distinctLinkTargets: [...distinctTargets],
    duplicateLinkTargets,
  };
}

export function isHardReadyBlocker(code: string): code is ReadyBlockerCode {
  return HARD_READY_BLOCKER_CODES.has(code as ReadyBlockerCode);
}

export function isSoftReadyBlocker(code: string): code is ReadyBlockerCode {
  return SOFT_READY_BLOCKER_CODES.has(code as ReadyBlockerCode);
}

export function compareRequiredIdentityField(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): boolean {
  if (typeof left === 'number' || typeof right === 'number') {
    return String(left ?? '') === String(right ?? '');
  }
  return normalizeComparisonText(left ?? '') === normalizeComparisonText(right ?? '');
}

export function citationHasIndividualAuthors(citation: CanonicalCitation): boolean {
  return hasIndividualAuthor(citation);
}

export function citationTitleLeadingPublisherException(citation: CanonicalCitation): boolean {
  if (!['report', 'book'].includes(citation.referenceType)) return false;
  if (hasIndividualAuthor(citation)) return false;
  const publisher = normalizeComparisonText(citation.publisher.value);
  const title = normalizeComparisonText(citation.title.value);
  if (!publisher || !title) return false;
  for (let count = 1; count <= 4; count += 1) {
    if (publisher === firstTitleTokens(title, count)) return true;
  }
  return false;
}

function normalizedAcceptedCandidatePrimaryAuthor(citation: CanonicalCitation): string {
  const firstAuthor = citation.resolution?.acceptedCandidate?.authors?.[0] ?? '';
  if (!firstAuthor) return '';
  const normalized = normalizeWhitespace(firstAuthor);
  if (!normalized) return '';
  if (isGroupAuthor(normalized)) {
    return normalizeSurnameForResolution(normalizeGroupAuthor(normalized));
  }
  if (normalized.includes(',')) {
    return normalizeSurnameForResolution(normalized.split(',')[0] ?? '');
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  return normalizeSurnameForResolution(parts[parts.length - 1] ?? '');
}

export function deriveResolutionBucketState(citation: CanonicalCitation): ResolutionBucketState {
  const resolution = citation.resolution;
  const candidate = resolution?.acceptedCandidate;
  const evidence = resolution?.queryEvidence;

  let hardUnresolved = false;
  if (candidate && evidence) {
    const candidateTitle = normalizeResolutionTitle(candidate.title).normalized;
    const evidenceTitle = evidence.titleNormalized ?? '';
    const titleConflict = Boolean(candidateTitle && evidenceTitle && candidateTitle !== evidenceTitle);

    const evidenceGroupAuthor = normalizeSurnameForResolution(evidence.groupAuthorLiteral ?? '');
    const evidenceFirstAuthor = normalizeSurnameForResolution(evidence.firstAuthorSurname ?? '');
    const candidatePrimaryAuthor = normalizedAcceptedCandidatePrimaryAuthor(citation);
    const authorConflict = evidenceGroupAuthor
      ? Boolean(candidatePrimaryAuthor && candidatePrimaryAuthor !== evidenceGroupAuthor)
      : Boolean(evidenceFirstAuthor && candidatePrimaryAuthor && candidatePrimaryAuthor !== evidenceFirstAuthor);

    const candidateYear = candidate.year ?? null;
    const evidenceYear = evidence.year ?? null;
    const yearConflict = candidateYear != null
      && evidenceYear != null
      && candidateYear !== evidenceYear
      && !(resolution.yearToleranceApplied && Math.abs(candidateYear - evidenceYear) === 1);

    hardUnresolved = titleConflict || authorConflict || yearConflict;
  }

  return {
    hardUnresolved,
    softUnresolvedAfterEscalation: Boolean(
      citation.resolution?.escalatedForBlockers
        && !citation.resolution?.acceptedCandidate
        && !hardUnresolved,
    ),
  };
}
