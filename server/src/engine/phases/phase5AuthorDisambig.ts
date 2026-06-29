import type { MLClient } from '../../ml/client.js';
import {
  normalizeArxiv,
  normalizeDoi,
  normalizeHandle,
  normalizePatent,
  normalizePropagationUrl,
} from '../identifierUtils.js';
import { ErrorCode } from '../errors/index.js';
import { syncFieldUncertainty } from '../fieldConfidence.js';
import { FIELD_CONFIDENCE_THRESHOLDS } from '../mandatory-fields.js';
import type { ReferenceCarrier } from '../types/carrier.js';
import { fieldOf } from '../types/field.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import {
  isLikelyAuthorSegment,
  isValidAuthorSpanText,
  parseAuthorSegment,
  toCanonicalAuthor,
} from '../utils/authors.js';
import { hasFieldValue } from '../utils/fields.js';
import { isStageBudgetExceeded, runWithRemainingStageBudget } from '../../pipeline/performance.js';

const CONTRACT_VERSION = 1;
const STAGE_ID = 'phase5_author_disambiguation';
const AUTHOR_READY_CONFIDENCE_FLOOR = FIELD_CONFIDENCE_THRESHOLDS.authors ?? 0.75;

export class Phase5AuthorDisambig implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'author_disambiguation' as const;
  readonly contractVersion = CONTRACT_VERSION;

  constructor(private readonly mlClient?: MLClient) {}

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    let usedFallback = false;
    let budgetExceeded = false;
    const allowMlAuthorDisambiguation = ctx.executionPolicy.authorDisambiguationMl !== 'off';
    const pendingMl: PendingAuthorDisambiguation[] = [];

    for (const carrier of carriers) {
      const existingAuthors = carrier.fields.authors.value;
      if (shouldPreserveInstitutionalOwnerReportWithoutAuthors(carrier)) {
        clearAuthorsForInstitutionalOwnerReport(carrier);
        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: 0,
            message:
              'Author disambiguation preserved the repeated institutional-owner report profile without authors.',
          }),
        );
        continue;
      }
      const hasContaminatedAuthors = hasContaminatedExistingAuthors(carrier, existingAuthors);
      const raw = carrier.raw;
      const yearMatch = raw.match(/\((?:19|20)\d{2}[a-z]?\)|\b(?:19|20)\d{2}\b/);
      const yearIndex = yearMatch?.index ?? raw.length;
      let authorSegment = trimAuthorSegmentBeforeTitle(
        raw
          .slice(0, yearIndex)
          .trim()
          .replace(/^[\[\(]?\d+[\]\).]?\s*/, ''),
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
      );
      if (yearMatch && yearIndex > 120 && raw.includes('. ')) {
        authorSegment = trimAuthorSegmentBeforeTitle(
          (raw.split('. ')[0] ?? authorSegment).trim(),
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        );
      }
      // "et al." truncates the author list at the source. Parsing strips it
      // silently, so record an incomplete-list marker for health to surface
      // without lowering confidence to hide the gap.
      if (/\bet\s*al\b/iu.test(authorSegment) || /\bet\s*al\b/iu.test(raw.slice(0, yearIndex))) {
        carrier.authorListIncomplete = true;
      }
      const fallbackAuthors = parseAuthorSegment(authorSegment);
      const fallbackReparseIsBetter = shouldPreferFallbackAuthorReparse({
        authorSegment,
        existingAuthors,
        fallbackAuthors,
        hasContaminatedAuthors,
      });
      if (
        hasFieldValue(carrier.fields.authors)
        && carrier.healthEvidence.validSpanFields.includes('authors')
        && !hasContaminatedAuthors
        && !fallbackReparseIsBetter
      ) {
        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: 0,
            message: 'Author disambiguation preserved an already-validated author span.',
          }),
        );
        continue;
      }

      if (
        (!allowMlAuthorDisambiguation || !this.mlClient)
        && hasFieldValue(carrier.fields.authors)
        && !hasContaminatedAuthors
        && !fallbackReparseIsBetter
      ) {
        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: 0,
            message: allowMlAuthorDisambiguation
              ? 'Author disambiguation preserved extracted authors without fallback reparse.'
              : 'Author disambiguation preserved extracted authors because ML author routing is disabled by the execution policy.',
          }),
        );
        continue;
      }

      const shouldAttemptMl = shouldAttemptMlAuthorDisambiguation({
        authorSegment,
        existingAuthors,
        fallbackAuthors,
        hasContaminatedAuthors,
      });

      const pending: PendingAuthorDisambiguation = {
        carrier,
        existingAuthors,
        hasContaminatedAuthors,
        authorSegment,
        fallbackAuthors,
      };

      if (!allowMlAuthorDisambiguation || !this.mlClient || !shouldAttemptMl) {
        const fallbackIsWarning = allowMlAuthorDisambiguation && !this.mlClient && shouldAttemptMl;
        applyFallbackAuthorDisambiguation(pending);
        usedFallback = fallbackIsWarning || usedFallback;
        pushAuthorDisambiguationCarrierStageLog(carrier, this.phaseId, fallbackIsWarning, false);
        continue;
      }

      pendingMl.push(pending);
    }

    const authorNerBatchSize = Math.max(1, ctx.runtimeTuning.batchSize);
    for (let index = 0; index < pendingMl.length; index += authorNerBatchSize) {
      const batch = pendingMl.slice(index, index + authorNerBatchSize);
      if (isStageBudgetExceeded(ctx, this.phaseId, startedAt)) {
        budgetExceeded = true;
        for (const pending of pendingMl.slice(index)) {
          usedFallback = applyFallbackAuthorDisambiguation(pending) || usedFallback;
          pushAuthorDisambiguationCarrierStageLog(pending.carrier, this.phaseId, true, true);
        }
        break;
      }

      try {
        const budgeted = await runWithRemainingStageBudget(ctx, this.phaseId, startedAt, () =>
          this.mlClient!.authorNer(batch.map((pending) => pending.authorSegment)),
        );
        if (budgeted.timedOut) {
          budgetExceeded = true;
          for (const pending of pendingMl.slice(index)) {
            usedFallback = applyFallbackAuthorDisambiguation(pending) || usedFallback;
            pushAuthorDisambiguationCarrierStageLog(pending.carrier, this.phaseId, true, true);
          }
          break;
        }

        for (const [batchIndex, pending] of batch.entries()) {
          const usedCarrierFallback = applyMlAuthorDisambiguation(
            pending,
            budgeted.value[batchIndex],
          );
          usedFallback = usedCarrierFallback || usedFallback;
          pushAuthorDisambiguationCarrierStageLog(
            pending.carrier,
            this.phaseId,
            usedCarrierFallback,
            false,
          );
        }
      } catch {
        for (const pending of batch) {
          usedFallback = applyFallbackAuthorDisambiguation(pending) || usedFallback;
          pushAuthorDisambiguationCarrierStageLog(pending.carrier, this.phaseId, true, false);
        }
      }
    }

    promoteBestIdentifierAuthors(carriers);

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: usedFallback ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        ...(usedFallback ? { code: ErrorCode.AUTHOR_ML_UNAVAILABLE } : {}),
        message: usedFallback
          ? budgetExceeded
            ? 'Phase 5 exceeded its latency budget and used regex author parsing.'
            : 'Phase 5 used regex author parsing.'
          : 'Phase 5 author disambiguation completed.',
      }),
    );

    return carriers;
  }
}

export const phase5AuthorDisambig = new Phase5AuthorDisambig();

export function reconcileIdentifierAuthorGroups(carriers: ReferenceCarrier[]): void {
  promoteBestIdentifierAuthors(carriers);
}

interface PendingAuthorDisambiguation {
  carrier: ReferenceCarrier;
  existingAuthors: ReferenceCarrier['fields']['authors']['value'];
  hasContaminatedAuthors: boolean;
  authorSegment: string;
  fallbackAuthors: ReferenceCarrier['fields']['authors']['value'];
}

function applyMlAuthorDisambiguation(
  pending: PendingAuthorDisambiguation,
  result: Awaited<ReturnType<MLClient['authorNer']>>[number] | undefined,
): boolean {
  const mlAuthors = result?.authors?.map((author) => toCanonicalAuthor(author))
    .filter((author): author is NonNullable<ReturnType<typeof toCanonicalAuthor>> => author != null)
    ?? [];
  const mlAuthorsValid = isValidAuthorSpanText(pending.authorSegment, mlAuthors);
  const fallbackAuthorsValid = isValidAuthorSpanText(pending.authorSegment, pending.fallbackAuthors);
  const preferFallback = mlAuthorsValid
    && fallbackAuthorsValid
    && shouldPreferFallbackOverMlAuthors(pending.authorSegment, mlAuthors, pending.fallbackAuthors);
  const nextAuthors = mlAuthorsValid && !preferFallback ? mlAuthors : pending.fallbackAuthors;
  const source = mlAuthorsValid && !preferFallback ? 'ml_author_ner' : 'regex_fallback';
  const confidence = mlAuthorsValid && !preferFallback
    ? Math.max(result?.confidence ?? 0.83, AUTHOR_READY_CONFIDENCE_FLOOR)
    : fallbackAuthorsValid ? AUTHOR_READY_CONFIDENCE_FLOOR : pending.fallbackAuthors.length > 0 ? 0.72 : 0.2;

  applyAuthorDisambiguationResult(pending, nextAuthors, source, confidence);
  return !mlAuthorsValid || preferFallback;
}

function applyFallbackAuthorDisambiguation(pending: PendingAuthorDisambiguation): boolean {
  const fallbackAuthorsValid = isValidAuthorSpanText(pending.authorSegment, pending.fallbackAuthors);
  applyAuthorDisambiguationResult(
    pending,
    pending.fallbackAuthors,
    'regex_fallback',
    fallbackAuthorsValid ? AUTHOR_READY_CONFIDENCE_FLOOR : pending.fallbackAuthors.length > 0 ? 0.72 : 0.2,
  );
  return true;
}

function applyAuthorDisambiguationResult(
  pending: PendingAuthorDisambiguation,
  nextAuthors: ReferenceCarrier['fields']['authors']['value'],
  source: 'ml_author_ner' | 'regex_fallback',
  confidence: number,
): void {
  if (!shouldReplaceAuthorList(
    pending.existingAuthors,
    nextAuthors,
    pending.hasContaminatedAuthors,
  )) {
    return;
  }

  pending.carrier.fields.authors = fieldOf(nextAuthors, source, STAGE_ID, confidence);
  if (
    nextAuthors.length > 0 &&
    isValidAuthorSpanText(pending.authorSegment, nextAuthors) &&
    !pending.carrier.healthEvidence.validSpanFields.includes('authors')
  ) {
    pending.carrier.healthEvidence.validSpanFields.push('authors');
  }
  syncFieldUncertainty(pending.carrier.fields);
}

function pushAuthorDisambiguationCarrierStageLog(
  carrier: ReferenceCarrier,
  phaseId: Phase5AuthorDisambig['phaseId'],
  usedFallback: boolean,
  budgetExceeded: boolean,
): void {
  carrier.stageLog.push(
    stageRecord({
      phaseId,
      status: usedFallback ? 'warning' : 'success',
      durationMs: 0,
      ...(usedFallback ? { code: ErrorCode.AUTHOR_ML_UNAVAILABLE } : {}),
      message: usedFallback
        ? budgetExceeded
          ? 'Author disambiguation used regex fallback after the phase budget was exceeded.'
          : 'Author disambiguation used regex fallback.'
        : 'Author disambiguation completed.',
    }),
  );
}

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
): StageRunRecord {
  return {
    stageId: STAGE_ID,
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}

function trimAuthorSegmentBeforeTitle(segment: string, titleHint: string | null): string {
  let trimmed = segment.trim();
  if (!trimmed) {
    return trimmed;
  }

  const quoteIndex = trimmed.search(/[“"‘'][^“"‘']{6,}/u);
  if (quoteIndex > 0) {
    trimmed = trimmed.slice(0, quoteIndex).trim();
  }

  if (titleHint) {
    const titleIndex = indexOfNormalizedSubstring(trimmed, titleHint);
    if (titleIndex > 0) {
      trimmed = trimmed.slice(0, titleIndex).trim();
    }
  }

  trimmed = trimLeadingSentenceAuthorSpan(trimmed);

  return trimmed.replace(/[;,:\s]+$/u, '').trim();
}

function trimLeadingSentenceAuthorSpan(segment: string): string {
  const sentenceMatch = segment.match(/^(?<lead>.+?\.)\s+(?<rest>.+)$/u);
  if (!sentenceMatch?.groups?.lead || !sentenceMatch.groups.rest) {
    return segment;
  }

  const lead = sentenceMatch.groups.lead.trim();
  const rest = sentenceMatch.groups.rest.trim();
  const parsedLead = parseAuthorSegment(lead);
  if (!isValidAuthorSpanText(lead, parsedLead)) {
    return segment;
  }
  if (looksSentenceRemainderLikeAuthorText(rest) && !looksSentenceRemainderLikeTitle(rest)) {
    return segment;
  }

  return lead.replace(/[.;]\s*$/u, '').trim();
}

function looksSentenceRemainderLikeAuthorText(rest: string): boolean {
  if (!isLikelyAuthorSegment(rest)) {
    return false;
  }

  const parsedRest = parseAuthorSegment(rest);
  return isValidAuthorSpanText(rest, parsedRest);
}

function looksSentenceRemainderLikeTitle(rest: string): boolean {
  if (!rest) {
    return false;
  }

  if (/\b(?:https?:\/\/|10\.\d{4,9}\/|ISBN\b|ISSN\b)\b/iu.test(rest)) {
    return true;
  }

  if (/\b(?:press|publishing|publisher|books?|springer|routledge|elsevier|wiley|gru[yü]ter|verlag|de gruyter)\b/iu.test(rest)) {
    return true;
  }

  if (/\b[IVXLCDM]{2,}\b/u.test(rest)) {
    return true;
  }

  const lowercaseWords = rest.match(/\b\p{Ll}{3,}\b/gu) ?? [];
  if (lowercaseWords.length >= 2) {
    return true;
  }

  const tokens = rest.split(/\s+/u).filter(Boolean);
  return tokens.length >= 5 && lowercaseWords.length >= 1;
}

function indexOfNormalizedSubstring(haystack: string, needle: string): number {
  const normalizedHaystack = normalizeComparableText(haystack);
  const normalizedNeedle = normalizeComparableText(needle);
  if (!normalizedHaystack || !normalizedNeedle) {
    return -1;
  }

  const normalizedIndex = normalizedHaystack.indexOf(normalizedNeedle);
  if (normalizedIndex < 0) {
    return -1;
  }

  const lowerNeedle = normalizedNeedle.toLowerCase();
  for (let sourceIndex = 0; sourceIndex < haystack.length; sourceIndex += 1) {
    const normalizedSlice = normalizeComparableText(haystack.slice(sourceIndex));
    if (normalizedSlice.startsWith(lowerNeedle)) {
      return sourceIndex;
    }
  }

  return -1;
}

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function shouldAttemptMlAuthorDisambiguation(input: {
  authorSegment: string;
  existingAuthors: ReferenceCarrier['fields']['authors']['value'];
  fallbackAuthors: ReferenceCarrier['fields']['authors']['value'];
  hasContaminatedAuthors: boolean;
}): boolean {
  const { authorSegment, existingAuthors, fallbackAuthors, hasContaminatedAuthors } = input;
  if (!isLikelyAuthorSegment(authorSegment)) {
    return false;
  }

  const hasExistingAuthors = Array.isArray(existingAuthors) && existingAuthors.length > 0;
  if (!hasExistingAuthors || hasContaminatedAuthors) {
    return true;
  }

  const fallbackCount = Array.isArray(fallbackAuthors) ? fallbackAuthors.length : 0;
  if (fallbackCount === 0) {
    return true;
  }

  if (/\bet al\.?\b/iu.test(authorSegment)) {
    return true;
  }

  if (/;\s*/u.test(authorSegment) && fallbackCount <= 2) {
    return true;
  }

  if (/,\s*[A-Z]\.(?:\s*[A-Z]\.)*/u.test(authorSegment) && fallbackCount <= 1) {
    return true;
  }

  return false;
}

function shouldPreferFallbackAuthorReparse(input: {
  authorSegment: string;
  existingAuthors: ReferenceCarrier['fields']['authors']['value'];
  fallbackAuthors: ReferenceCarrier['fields']['authors']['value'];
  hasContaminatedAuthors: boolean;
}): boolean {
  const {
    authorSegment,
    existingAuthors,
    fallbackAuthors,
    hasContaminatedAuthors,
  } = input;
  if (!isValidAuthorSpanText(authorSegment, fallbackAuthors)) {
    return false;
  }
  if (!Array.isArray(existingAuthors) || existingAuthors.length === 0) {
    return true;
  }
  if (hasContaminatedAuthors) {
    return true;
  }
  if (
    fallbackAuthors.length > existingAuthors.length
    && authorSegmentSupportsMultipleAuthors(authorSegment, fallbackAuthors.length)
  ) {
    return true;
  }

  return hasBetterAuthorDetail(existingAuthors, fallbackAuthors);
}

function shouldPreferFallbackOverMlAuthors(
  authorSegment: string,
  mlAuthors: ReferenceCarrier['fields']['authors']['value'],
  fallbackAuthors: ReferenceCarrier['fields']['authors']['value'],
): boolean {
  if (!Array.isArray(mlAuthors) || !Array.isArray(fallbackAuthors) || fallbackAuthors.length === 0) {
    return false;
  }

  if (
    fallbackAuthors.length > mlAuthors.length
    && authorSegmentSupportsMultipleAuthors(authorSegment, fallbackAuthors.length)
  ) {
    return true;
  }

  if (fallbackAuthors.length === mlAuthors.length && hasBetterAuthorDetail(mlAuthors, fallbackAuthors)) {
    return true;
  }

  return mlAuthors.some((author, index) =>
    authorLooksLikeInitialsFamilySwap(author, fallbackAuthors[index]),
  );
}

function authorSegmentSupportsMultipleAuthors(authorSegment: string, expectedCount: number): boolean {
  if (expectedCount <= 1) {
    return false;
  }

  const explicitJoiners = (authorSegment.match(/\s+and\s+|&|;/giu) ?? []).length;
  const commaDelimitedNames = (authorSegment.match(/,\s*(?:[\p{Lu}][\p{L}'-]+|\p{Lu}\.)/gu) ?? []).length;
  const compactInitialNames = (authorSegment.match(/\b[\p{Lu}][\p{L}'-]+\s+[\p{Lu}](?=,|$)/gu) ?? []).length;
  return explicitJoiners + 1 >= expectedCount
    || commaDelimitedNames + 1 >= expectedCount
    || compactInitialNames >= expectedCount;
}

function authorLooksLikeInitialsFamilySwap(
  author: NonNullable<ReferenceCarrier['fields']['authors']['value']>[number],
  fallback: NonNullable<ReferenceCarrier['fields']['authors']['value']>[number] | undefined,
): boolean {
  if (!fallback || !author.family || !author.given || !fallback.family || !fallback.given) {
    return false;
  }

  const family = author.family.replace(/[.\s-]+/gu, '');
  const given = author.given.replace(/[.\s-]+/gu, '');
  const fallbackFamily = fallback.family.replace(/[.\s-]+/gu, '');
  const fallbackGiven = fallback.given.replace(/[.\s-]+/gu, '');
  return family.length <= 4
    && /^[\p{Lu}]+$/u.test(family)
    && given.length >= 4
    && /^[\p{Lu}]+$/u.test(given)
    && fallbackFamily.toLocaleUpperCase() === given
    && fallbackGiven.toLocaleUpperCase() === family;
}

function shouldPreserveInstitutionalOwnerReportWithoutAuthors(carrier: ReferenceCarrier): boolean {
  const ownerLead = typeof carrier.fields.institution.value === 'string'
    ? carrier.fields.institution.value
    : typeof carrier.fields.publisher.value === 'string'
      ? carrier.fields.publisher.value
      : null;
  const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;

  if (
    !ownerLead
    || !title
    || !hasFieldValue(carrier.fields.year)
    || hasFieldValue(carrier.fields.journal)
    || hasFieldValue(carrier.fields.conferenceTitle)
    || hasFieldValue(carrier.fields.bookTitle)
    || hasFieldValue(carrier.fields.volume)
    || hasFieldValue(carrier.fields.issue)
    || hasFieldValue(carrier.fields.pages)
    || hasFieldValue(carrier.fields.isbn)
    || hasFieldValue(carrier.fields.issn)
  ) {
    return false;
  }

  const ownerComparable = normalizeComparableText(ownerLead);
  const titleComparable = normalizeComparableText(title);
  const rawComparable = normalizeComparableText(
    carrier.raw.replace(/^[\[\(]?\d+[\]\).]?\s*/, ''),
  );
  if (!ownerComparable || !titleComparable || !rawComparable) {
    return false;
  }

  const firstOwnerIndex = rawComparable.indexOf(ownerComparable);
  if (firstOwnerIndex !== 0) {
    return false;
  }
  const repeatedOwnerIndex = rawComparable.indexOf(ownerComparable, ownerComparable.length);
  if (repeatedOwnerIndex < 0) {
    return false;
  }

  const repeatedInstitutionalOwnerSignature = `${ownerComparable} ${titleComparable} ${ownerComparable}`;
  return rawComparable.includes(repeatedInstitutionalOwnerSignature);
}

function clearAuthorsForInstitutionalOwnerReport(carrier: ReferenceCarrier): void {
  const currentAuthors = carrier.fields.authors;
  carrier.fields.authors = fieldOf(
    [],
    currentAuthors.source,
    STAGE_ID,
    Math.max(0.84, currentAuthors.confidence),
    {
      origin: currentAuthors.origin,
      previousValue: currentAuthors.value,
      previousSource: currentAuthors.source,
      previousOrigin: currentAuthors.origin,
    },
  );
  carrier.healthEvidence.validSpanFields = carrier.healthEvidence.validSpanFields.filter(
    (field) => field !== 'authors',
  );
  syncFieldUncertainty(carrier.fields);
}

function hasContaminatedExistingAuthors(
  carrier: ReferenceCarrier,
  authors: ReferenceCarrier['fields']['authors']['value'],
): boolean {
  if (!Array.isArray(authors) || authors.length === 0) {
    return false;
  }

  const suspiciousNeedles = [
    carrier.fields.title.value,
    carrier.fields.publisher.value,
    carrier.fields.conferenceTitle.value,
    carrier.fields.bookTitle.value,
    carrier.fields.institution.value,
    carrier.fields.journal.value,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeComparableText(value))
    .filter((value) => value.length >= 8);

  return authors.some((author) => {
    const candidates = [
      author.literal,
      [author.family, author.given].filter(Boolean).join(' ').trim(),
      author.family ?? null,
      author.given ?? null,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    return candidates.some((candidate) => authorTextLooksContaminated(candidate, suspiciousNeedles));
  });
}

function authorTextLooksContaminated(value: string, suspiciousNeedles: string[]): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }

  if (/\b(?:https?:\/\/|10\.\d{4,9}\/|available at|retrieved from|doi\b|isbn\b|issn\b)\b/iu.test(value)) {
    return true;
  }

  if ((/[“”"']/u.test(value) || /…/u.test(value)) && normalized.split(/\s+/u).length >= 3) {
    return true;
  }

  if (
    suspiciousNeedles.some((needle) =>
      normalized.includes(needle)
      || (normalized.length >= 8 && needle.includes(normalized))
    )
  ) {
    return true;
  }

  const tokenCount = normalized.split(/\s+/u).filter(Boolean).length;
  return tokenCount >= 5
    && /\b(?:conference|proceedings|journal|algorithm|technology|publisher|available|review|report|symposium)\b/iu.test(value);
}

function shouldReplaceAuthorList(
  currentAuthors: ReferenceCarrier['fields']['authors']['value'],
  nextAuthors: ReferenceCarrier['fields']['authors']['value'],
  currentIsContaminated: boolean,
): boolean {
  if (!Array.isArray(nextAuthors) || nextAuthors.length === 0) {
    return false;
  }

  if (!Array.isArray(currentAuthors) || currentAuthors.length === 0) {
    return true;
  }

  if (currentIsContaminated) {
    return true;
  }

  if (currentAuthors.length < nextAuthors.length) {
    return true;
  }

  return hasBetterAuthorDetail(currentAuthors, nextAuthors);
}

function promoteBestIdentifierAuthors(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();

  for (const carrier of carriers) {
    const key = getIdentifierGroupingKey(carrier);
    if (!key) {
      continue;
    }
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
      continue;
    }
    groups.set(key, [carrier]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const best = group
      .map((carrier) => carrier.fields.authors)
      .filter((field) => Array.isArray(field.value) && field.value.length >= 1)
      .sort((left, right) => authorPromotionScore(right) - authorPromotionScore(left))[0];

    if (!best || !Array.isArray(best.value) || best.value.length < 1) {
      continue;
    }

    for (const carrier of group) {
      if (shouldPreserveInstitutionalOwnerReportWithoutAuthors(carrier)) {
        clearAuthorsForInstitutionalOwnerReport(carrier);
        continue;
      }

      const currentAuthors = carrier.fields.authors.value;
      if (!shouldPromoteIdentifierAuthors(carrier.raw, currentAuthors, best.value)) {
        continue;
      }

      carrier.fields.authors = fieldOf(
        best.value,
        best.source,
        STAGE_ID,
        Math.max(0.78, best.confidence - 0.02),
        {
          origin: best.origin,
          previousValue: carrier.fields.authors.value,
          previousSource: carrier.fields.authors.source,
          previousOrigin: carrier.fields.authors.origin,
        },
      );

      if (!carrier.healthEvidence.validSpanFields.includes('authors')) {
        carrier.healthEvidence.validSpanFields.push('authors');
      }
      syncFieldUncertainty(carrier.fields);
    }
  }
}

function getIdentifierGroupingKey(carrier: ReferenceCarrier): string | null {
  const doi = normalizeDoi(carrier.fields.doi.value);
  if (doi) {
    return scopeIdentifierGroupingKey(carrier, `doi:${doi}`);
  }

  const doiFromUrl = normalizeDoi(carrier.fields.url.value);
  if (doiFromUrl) {
    return scopeIdentifierGroupingKey(carrier, `doi:${doiFromUrl}`);
  }

  const url = normalizePropagationUrl(carrier.fields.url.value);
  if (url) {
    return scopeIdentifierGroupingKey(carrier, `url:${url}`);
  }

  const patent = normalizePatent(carrier.fields.patent.value);
  if (patent) {
    return scopeIdentifierGroupingKey(carrier, `patent:${patent}`);
  }

  const handle = normalizeHandle(carrier.fields.handle.value);
  if (handle) {
    return scopeIdentifierGroupingKey(carrier, `handle:${handle}`);
  }

  const arxiv = normalizeArxiv(carrier.fields.arxiv.value);
  if (arxiv) {
    return scopeIdentifierGroupingKey(carrier, `arxiv:${arxiv}`);
  }

  return null;
}

function scopeIdentifierGroupingKey(carrier: ReferenceCarrier, key: string): string {
  return carrier.semanticGroupKey
    ? `${carrier.semanticGroupKey}::${key}`
    : key;
}

function shouldPromoteIdentifierAuthors(
  raw: string,
  currentAuthors: ReferenceCarrier['fields']['authors']['value'],
  bestAuthors: ReferenceCarrier['fields']['authors']['value'],
): boolean {
  const bestAuthorCount = Array.isArray(bestAuthors) ? bestAuthors.length : 0;
  const currentCount = Array.isArray(currentAuthors) ? currentAuthors.length : 0;
  if (currentCount === 0) {
    return true;
  }
  if (currentCount >= bestAuthorCount && !hasBetterAuthorDetail(currentAuthors, bestAuthors)) {
    return false;
  }

  if (/\bet al\.?\b/iu.test(raw)) {
    return true;
  }

  const authorZone = raw.split(/\b(?:1[6-9]|20)\d{2}\b/u)[0] ?? raw;
  const explicitJoiners = (authorZone.match(/\s+and\s+|&|;/giu) ?? []).length;
  const commaDelimitedNames = (authorZone.match(/,\s+(?:[\p{Lu}][\p{L}'-]+|\p{Lu}\.)/gu) ?? []).length;
  const expectedMinimum = Math.max(explicitJoiners + 1, Math.min(bestAuthorCount, commaDelimitedNames + 1));

  if (expectedMinimum >= 2 && currentCount < expectedMinimum) {
    return true;
  }

  return hasBetterAuthorDetail(currentAuthors, bestAuthors);
}

function authorPromotionScore(field: ReferenceCarrier['fields']['authors']): number {
  const authorCount = Array.isArray(field.value) ? field.value.length : 0;
  const richness = Array.isArray(field.value) ? authorListRichness(field.value) : 0;
  return field.confidence + authorCount * 0.08 + richness * 0.01;
}

function hasBetterAuthorDetail(
  currentAuthors: ReferenceCarrier['fields']['authors']['value'],
  bestAuthors: ReferenceCarrier['fields']['authors']['value'],
): boolean {
  if (!Array.isArray(currentAuthors) || !Array.isArray(bestAuthors)) {
    return false;
  }
  if (bestAuthors.length < currentAuthors.length) {
    return false;
  }

  const currentRichness = authorListRichness(currentAuthors);
  const bestRichness = authorListRichness(bestAuthors);
  if (bestRichness <= currentRichness) {
    return false;
  }

  return bestRichness - currentRichness >= 3;
}

function authorListRichness(authors: NonNullable<ReferenceCarrier['fields']['authors']['value']>): number {
  return authors.reduce((sum, author) => {
    const family = (author.family ?? author.literal ?? '').trim();
    const given = (author.given ?? '').trim();
    const literal = (author.literal ?? '').trim();
    const initialsOnly = given.length > 0 && /^[\p{Lu}](?:[.\s-]*\p{Lu})*\.?$/u.test(given);

    let score = family.length;
    if (literal && author.isCorporate) {
      score += literal.length;
    } else if (given) {
      score += initialsOnly ? 1 : given.replace(/[.\s-]+/gu, '').length;
    }

    return sum + score;
  }, 0);
}
