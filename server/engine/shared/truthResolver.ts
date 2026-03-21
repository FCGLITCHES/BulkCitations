import type {
  ApprovedCanonicalFields,
  ApprovedTruthEntry,
  CanonicalAuthor,
  CanonicalCitation,
  CanonicalReferenceType,
  ConvertedReference,
  FieldApprovalMap,
  ParsedReference,
  TruthMatchType,
  TruthProvenance,
} from '@shared/schema';
import { normalizeCitationStyle } from '@shared/schema';
import { formatCSLData, initCSLStyles, parsedReferenceToCSL } from '../cslConverter.js';
import { fixFormatting, runAssertions } from '../strictRenderer.js';
import { findBestTruthMatch } from '../../store/truthStore.js';
import { computeFingerprint } from '../../store/reportStore.js';
import { computeWorkKey } from '../../utils/workKey.js';
import {
  canonicalReferenceTypeToParsed,
  canonicalToParsedReference,
  coerceCanonicalAuthor,
  createFieldValue,
  parsedReferenceTypeToCanonical,
} from '../v2/utils.js';

const APPROVED_FIELD_KEYS = [
  'authors',
  'title',
  'year',
  'journal',
  'volume',
  'issue',
  'pages',
  'doi',
  'publisher',
  'url',
  'conferenceTitle',
  'bookTitle',
  'institution',
  'edition',
  'editor',
  'referenceType',
] as const;

type ApprovedFieldKey = typeof APPROVED_FIELD_KEYS[number];

function currentEngineVersion(): string {
  return process.env.APP_VERSION
    ?? process.env.npm_package_version
    ?? '0.0.0';
}

function semverCompare(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function isTruthStale(truth: ApprovedTruthEntry, engineVersion = currentEngineVersion()): boolean {
  if (!truth.staleAfterVersion) return false;
  return semverCompare(engineVersion, truth.staleAfterVersion) >= 0;
}

function approvedFieldKeys(fieldApproval?: FieldApprovalMap): ApprovedFieldKey[] {
  if (!fieldApproval) return [];
  return APPROVED_FIELD_KEYS.filter((field) => fieldApproval[field]?.approved === true);
}

function normalizeApprovedAuthors(fields?: ApprovedCanonicalFields): CanonicalAuthor[] | undefined {
  if (!fields) return undefined;
  if (!fields.authors) return undefined;
  return fields.authors.map((author) => coerceCanonicalAuthor(author));
}

function mergedParsedFromTruth(liveParsed: ParsedReference, truth: ApprovedTruthEntry): ParsedReference {
  const next: ParsedReference = {
    ...liveParsed,
  };
  const approvedFields = approvedFieldKeys(truth.fieldApproval);
  const corrected = truth.correctedFields ?? {};

  for (const field of approvedFields) {
    switch (field) {
      case 'authors':
        next.authors = normalizeApprovedAuthors(corrected)?.map((author) => author.literal || (author.first ? `${author.last}, ${author.first}` : author.last)) ?? [];
        break;
      case 'title':
        next.title = corrected.title ?? undefined;
        break;
      case 'year':
        next.year = corrected.year != null ? String(corrected.year) : undefined;
        break;
      case 'journal':
        next.journal = corrected.journal ?? undefined;
        break;
      case 'volume':
        next.volume = corrected.volume ?? undefined;
        break;
      case 'issue':
        next.issue = corrected.issue ?? undefined;
        break;
      case 'pages':
        next.pages = corrected.pages ?? undefined;
        break;
      case 'doi':
        next.doi = corrected.doi ?? undefined;
        break;
      case 'publisher':
        next.publisher = corrected.publisher ?? undefined;
        break;
      case 'url':
        next.url = corrected.url ?? undefined;
        break;
      case 'conferenceTitle':
        next.conferenceTitle = corrected.conferenceTitle ?? undefined;
        break;
      case 'bookTitle':
        next.bookTitle = corrected.bookTitle ?? undefined;
        break;
      case 'institution':
        next.institution = corrected.institution ?? undefined;
        break;
      case 'edition':
        next.edition = corrected.edition ?? undefined;
        break;
      case 'editor':
        next.editor = corrected.editor ?? undefined;
        break;
      default:
        break;
    }
  }

  return next;
}

function mergedReferenceType(
  liveType: CanonicalReferenceType,
  truth: ApprovedTruthEntry,
): CanonicalReferenceType {
  if (truth.fieldApproval?.referenceType?.approved) {
    const approvedType = truth.correctedFields?.referenceType;
    if (approvedType) {
      if (['journal', 'book', 'chapter', 'conference', 'thesis', 'website', 'report', 'preprint', 'unknown'].includes(String(approvedType))) {
        return approvedType as CanonicalReferenceType;
      }
      return parsedReferenceTypeToCanonical(approvedType as any);
    }
  }
  return liveType;
}

function renderParsedReference(
  parsed: ParsedReference,
  referenceType: string,
  outputStyle: string,
): {
  convertedText: string;
  warnings: string[];
} {
  initCSLStyles();
  const normalizedStyle = normalizeCitationStyle(outputStyle);
  const cslData = parsedReferenceToCSL(parsed, referenceType as any, `truth-${computeWorkKey(parsed)}`);
  const raw = formatCSLData(cslData, normalizedStyle as any, { includeDoi: false });
  const convertedText = fixFormatting(normalizedStyle, raw, parsed);
  const assertionResult = runAssertions(normalizedStyle, convertedText, parsed);
  return {
    convertedText,
    warnings: assertionResult.warnings,
  };
}

function buildTruthProvenance(
  truth: ApprovedTruthEntry,
  matchType: TruthMatchType,
  usedValidatedOutput: boolean,
  staleTruth: boolean,
): TruthProvenance {
  return {
    truthApplied: true,
    truthId: truth.truthId,
    truthMatchType: matchType,
    appliedFields: approvedFieldKeys(truth.fieldApproval),
    usedValidatedOutput,
    staleTruth,
  };
}

export async function resolveTruthForParsedReference(args: {
  originalText: string;
  parsedData?: ParsedReference;
  outputStyle: string;
}): Promise<{
  truth: ApprovedTruthEntry;
  matchType: TruthMatchType;
} | null> {
  return findBestTruthMatch({
    fingerprint: computeFingerprint(args.originalText),
    doi: args.parsedData?.doi ?? null,
    workKey: args.parsedData ? computeWorkKey(args.parsedData) : null,
    outputStyle: args.outputStyle,
  });
}

export async function applyTruthToLegacyReference(
  reference: ConvertedReference,
  outputStyle: string,
): Promise<ConvertedReference> {
  const match = await resolveTruthForParsedReference({
    originalText: reference.originalText,
    parsedData: reference.parsedData,
    outputStyle,
  });
  if (!match) return reference;

  const staleTruth = isTruthStale(match.truth);
  const usedValidatedOutput = !staleTruth && match.truth.outputStyle === outputStyle && Boolean(match.truth.validatedOutput);
  const mergedParsed = mergedParsedFromTruth(reference.parsedData, match.truth);
  const mergedType = match.truth.fieldApproval?.referenceType?.approved && match.truth.correctedFields?.referenceType
    ? match.truth.correctedFields.referenceType as any
    : reference.referenceType;

  const rendered = usedValidatedOutput
    ? { convertedText: match.truth.validatedOutput, warnings: reference.warnings ?? [] }
    : renderParsedReference(mergedParsed, mergedType, outputStyle);

  return {
    ...reference,
    referenceType: mergedType,
    parsedData: mergedParsed,
    convertedText: rendered.convertedText,
    warnings: Array.from(new Set([...(reference.warnings ?? []), ...rendered.warnings])),
    workKey: computeWorkKey(mergedParsed),
    truthProvenance: buildTruthProvenance(match.truth, match.matchType, usedValidatedOutput, staleTruth),
  };
}

export async function resolveTruthForCanonicalCitation(citation: CanonicalCitation, outputStyle: string): Promise<{
  truth: ApprovedTruthEntry;
  matchType: TruthMatchType;
} | null> {
  const parsed = canonicalToParsedReference(citation);
  return findBestTruthMatch({
    fingerprint: computeFingerprint(citation.raw),
    doi: citation.doi.value,
    workKey: computeWorkKey(parsed),
    outputStyle,
  });
}

export function applyTruthToCanonicalCitation(
  citation: CanonicalCitation,
  truth: ApprovedTruthEntry,
  matchType: TruthMatchType,
  outputStyle: string,
): CanonicalCitation {
  const corrected = truth.correctedFields ?? {};
  const appliedFields = approvedFieldKeys(truth.fieldApproval);
  const staleTruth = isTruthStale(truth);
  const usedValidatedOutput = !staleTruth && truth.outputStyle === outputStyle && Boolean(truth.validatedOutput);

  let next = {
    ...citation,
    referenceType: mergedReferenceType(citation.referenceType, truth),
  };

  for (const field of appliedFields) {
    switch (field) {
      case 'authors':
        next = {
          ...next,
          authors: createFieldValue(normalizeApprovedAuthors(corrected) ?? [], 'user', 1, 'truth'),
        };
        break;
      case 'title':
        next = { ...next, title: createFieldValue(corrected.title ?? null, 'user', 1, 'truth') };
        break;
      case 'year':
        next = { ...next, year: createFieldValue(corrected.year ?? null, 'user', 1, 'truth') };
        break;
      case 'journal':
        next = { ...next, journal: createFieldValue(corrected.journal ?? null, 'user', 1, 'truth') };
        break;
      case 'volume':
        next = { ...next, volume: createFieldValue(corrected.volume ?? null, 'user', 1, 'truth') };
        break;
      case 'issue':
        next = { ...next, issue: createFieldValue(corrected.issue ?? null, 'user', 1, 'truth') };
        break;
      case 'pages':
        next = { ...next, pages: createFieldValue(corrected.pages ?? null, 'user', 1, 'truth') };
        break;
      case 'doi':
        next = { ...next, doi: createFieldValue(corrected.doi ?? null, 'user', 1, 'truth') };
        break;
      case 'publisher':
        next = { ...next, publisher: createFieldValue(corrected.publisher ?? null, 'user', 1, 'truth') };
        break;
      case 'url':
        next = { ...next, url: createFieldValue(corrected.url ?? null, 'user', 1, 'truth') };
        break;
      case 'conferenceTitle':
        next = { ...next, conferenceTitle: createFieldValue(corrected.conferenceTitle ?? null, 'user', 1, 'truth') };
        break;
      case 'bookTitle':
        next = { ...next, bookTitle: createFieldValue(corrected.bookTitle ?? null, 'user', 1, 'truth') };
        break;
      case 'institution':
        next = { ...next, institution: createFieldValue(corrected.institution ?? null, 'user', 1, 'truth') };
        break;
      case 'edition':
        next = { ...next, edition: createFieldValue(corrected.edition ?? null, 'user', 1, 'truth') };
        break;
      case 'editor':
        next = { ...next, editor: createFieldValue(corrected.editor ?? null, 'user', 1, 'truth') };
        break;
      default:
        break;
    }
  }

  return {
    ...next,
    truth: {
      ...buildTruthProvenance(truth, matchType, usedValidatedOutput, staleTruth),
      resolvedCanonical: corrected,
      validatedOutput: usedValidatedOutput ? truth.validatedOutput : undefined,
    },
  };
}
