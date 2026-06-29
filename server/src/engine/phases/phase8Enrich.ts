import { applyEnrichmentField, isAdminProtected } from '../overwrite-policy.js';
import { verifyDoiAgainstRecord, verifyEnrichmentRecordMatch } from '../doiVerification.js';
import { ErrorCode } from '../errors/index.js';
import { syncFieldUncertainty } from '../fieldConfidence.js';
import type { EnrichmentResult, ReferenceCarrier } from '../types/carrier.js';
import type { CanonicalAuthor, ExtractedFields } from '../types/citation.js';
import { fieldOf, isTrustedFieldOrigin, type FieldSource } from '../types/field.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { EXTRACTED_FIELD_KEYS, hasFieldValue, setExtractedField, type ExtractedFieldKey } from '../utils/fields.js';
import type { CrossrefService, ProviderRecord } from '../../services/crossref.js';
import { crossrefService } from '../../services/crossref.js';
import type { OpenAlexService } from '../../services/openalex.js';
import { openAlexService } from '../../services/openalex.js';
import type { SemanticScholarService } from '../../services/semanticScholar.js';
import { semanticScholarService } from '../../services/semanticScholar.js';
import { createHash } from 'node:crypto';
import { env } from '../../config.js';
import { normalizeDoiForKey, normalizeLookupText, normalizeUrlForKey } from '../ingestion/canonical.js';
import { recoverDoi } from '../ingestion/ocrFold.js';
import { buildProviderIdempotencyKey, ProviderLookupError } from '../../services/providerLookup.js';
import {
  isStageBudgetExceeded,
  runWithConcurrencyLimit,
  runWithRemainingStageBudget,
} from '../../pipeline/performance.js';

const CONTRACT_VERSION = 1;
const STAGE_ID = 'phase8_enrichment';
const MAX_DEAD_LETTER_DETAILS = 25;

interface ProviderDeadLetterEntry {
  carrierId: string;
  provider: 'crossref' | 'openalex';
  lookupKey: string;
  idempotencyKey: string;
  statusCode?: number;
  message: string;
  at: string;
}

export class Phase8Enrich implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'enrichment' as const;
  readonly contractVersion = CONTRACT_VERSION;

  constructor(
    private readonly crossref: CrossrefService = crossrefService,
    private readonly openalex: OpenAlexService = openAlexService,
    private readonly semanticScholar: SemanticScholarService = semanticScholarService,
  ) {}

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();

    if (!ctx.options.enrich) {
      ctx.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: 'skipped',
          durationMs: Date.now() - startedAt,
          message: 'Phase 8 enrichment disabled by request options.',
        }),
      );
      return carriers;
    }

    let changedCount = 0;
    let warningCount = 0;
    const deadLetters: ProviderDeadLetterEntry[] = [];

    const crossrefMemo = new Map<string, Promise<ProviderRecord | null>>();
    const openalexMemo = new Map<string, Promise<ProviderRecord | null>>();
    const PROVIDER_BUDGET = {
      crossref: { maxCalls: 50 },
      openalex: { maxCalls: 50 },
    } as const;
    let crossrefCalls = 0;
    let openalexCalls = 0;

    await runWithConcurrencyLimit(
      carriers,
      Math.min(env.PIPELINE_MAX_CONCURRENCY, Math.max(1, carriers.length)),
      async (carrier) => {
        if (isStageBudgetExceeded(ctx, this.phaseId, startedAt)) {
          warningCount += 1;
          carrier.enrichment = {
            status: 'skipped',
            crossrefHit: false,
            openalexHit: false,
            semanticScholarHit: false,
            fieldsEnriched: [],
            fieldsOverwritten: [],
            cacheHits: 0,
          };
          carrier.stageLog.push(
            stageRecord({
              phaseId: this.phaseId,
              status: 'warning',
              durationMs: 0,
              code: ErrorCode.ENRICH_CROSSREF_TIMEOUT,
              message: 'Enrichment skipped because the phase latency budget was exhausted.',
            }),
          );
          return;
        }

      const originalFields = structuredClone(carrier.fields);
      if (carrier.doiFastPath) {
        carrier.enrichment = {
          status: 'skipped',
          crossrefHit: false,
          openalexHit: false,
          semanticScholarHit: false,
          fieldsEnriched: [],
          fieldsOverwritten: [],
          cacheHits: 0,
        };
        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'skipped',
            durationMs: 0,
            message: 'Enrichment skipped because DOI fast-path already supplied provider metadata.',
          }),
        );
        return;
      }

      let crossrefHit = false;
      let openalexHit = false;
      let semanticScholarHit = false;
      let hadError = false;
      let budgetExceeded = false;
      const carrierDeadLetters: ProviderDeadLetterEntry[] = [];
      const fieldsEnriched = new Set<string>();
      const fieldsOverwritten = new Set<string>();
      const blockedFields = new Set<string>();
      let enrichmentMismatch: EnrichmentResult['mismatch'] | undefined;

      try {
        const lookupFields = resolveEnrichmentLookupFields(carrier);
        const key = buildProviderMemoKey(lookupFields);
        const canCallCrossref = crossrefCalls < PROVIDER_BUDGET.crossref.maxCalls;
        const canCallOpenalex = openalexCalls < PROVIDER_BUDGET.openalex.maxCalls;
        const crossrefLookupKey = key ? `crossref:${key}` : null;
        const openalexLookupKey = key ? `openalex:${key}` : null;
        const crossrefIdempotencyKey = crossrefLookupKey
          ? buildProviderIdempotencyKey('crossref', crossrefLookupKey)
          : null;
        const openalexIdempotencyKey = openalexLookupKey
          ? buildProviderIdempotencyKey('openalex', openalexLookupKey)
          : null;

        const crossrefPromise = key && canCallCrossref
          ? (crossrefMemo.get(`crossref:${key}`) ?? (() => {
            crossrefCalls += 1;
            ctx.providerUsage.crossrefCalls += 1;
            const crossrefLookupOptions = {
              retryAttempts: env.CROSSREF_RETRY_ATTEMPTS,
              retryDelayMs: env.CROSSREF_RETRY_BASE_DELAY_MS,
              ...(crossrefLookupKey ? { lookupKey: crossrefLookupKey } : {}),
              ...(crossrefIdempotencyKey ? { idempotencyKey: crossrefIdempotencyKey } : {}),
            };
            const p = this.crossref.lookup(lookupFields, {
              ...crossrefLookupOptions,
            });
            crossrefMemo.set(`crossref:${key}`, p);
            return p;
          })())
          : Promise.resolve(null);

        const openalexPromise = key && canCallOpenalex
          ? (openalexMemo.get(`openalex:${key}`) ?? (() => {
            openalexCalls += 1;
            ctx.providerUsage.openalexCalls += 1;
            const openalexLookupOptions = {
              retryAttempts: env.OPENALEX_RETRY_ATTEMPTS,
              retryDelayMs: env.OPENALEX_RETRY_BASE_DELAY_MS,
              ...(openalexLookupKey ? { lookupKey: openalexLookupKey } : {}),
              ...(openalexIdempotencyKey ? { idempotencyKey: openalexIdempotencyKey } : {}),
            };
            const p = this.openalex.lookup(lookupFields, {
              ...openalexLookupOptions,
            });
            openalexMemo.set(`openalex:${key}`, p);
            return p;
          })())
          : Promise.resolve(null);

        const providerRecords = await runWithRemainingStageBudget(ctx, this.phaseId, startedAt, () =>
          Promise.allSettled([crossrefPromise, openalexPromise]),
        );
        if (providerRecords.timedOut) {
          budgetExceeded = true;
          throw new Error('Phase budget exceeded.');
        }
        const [crossrefSettled, openalexSettled] = providerRecords.value;
        const crossrefResult = unwrapProviderRecord({
          carrierId: carrier.id,
          provider: 'crossref',
          result: crossrefSettled,
          lookupKey: crossrefLookupKey ?? 'crossref:none',
          idempotencyKey: crossrefIdempotencyKey ?? 'crossref:none',
        });
        const openalexResult = unwrapProviderRecord({
          carrierId: carrier.id,
          provider: 'openalex',
          result: openalexSettled,
          lookupKey: openalexLookupKey ?? 'openalex:none',
          idempotencyKey: openalexIdempotencyKey ?? 'openalex:none',
        });
        const crossrefRecord = crossrefResult.record;
        const openalexRecord = openalexResult.record;
        if (crossrefResult.deadLetter) {
          deadLetters.push(crossrefResult.deadLetter);
          carrierDeadLetters.push(crossrefResult.deadLetter);
          hadError = true;
        }
        if (openalexResult.deadLetter) {
          deadLetters.push(openalexResult.deadLetter);
          carrierDeadLetters.push(openalexResult.deadLetter);
          hadError = true;
        }
        const verificationRecord = [crossrefRecord, openalexRecord]
          .filter((record): record is ProviderRecord => record != null)
          .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
        carrier.doiVerification = verifyDoiAgainstRecord(originalFields, originalFields.doi.value, verificationRecord);

        crossrefHit = crossrefRecord != null;
        openalexHit = openalexRecord != null;

        const crossrefMismatch = applyProviderRecord(carrier, originalFields, crossrefRecord, 'crossref', fieldsEnriched, fieldsOverwritten, blockedFields);
        const openalexMismatch = applyProviderRecord(carrier, originalFields, openalexRecord, 'openalex', fieldsEnriched, fieldsOverwritten, blockedFields);
        enrichmentMismatch = enrichmentMismatch ?? crossrefMismatch ?? openalexMismatch ?? undefined;

        const noPrimaryHits = !crossrefHit && !openalexHit;
        const noChangesYet = fieldsEnriched.size + fieldsOverwritten.size === 0;
        if (noPrimaryHits && noChangesYet && key) {
          try {
            const semanticScholarRecord = await runWithRemainingStageBudget(ctx, this.phaseId, startedAt, () =>
              this.semanticScholar.lookupLastResort(carrier.fields),
            );
            if (semanticScholarRecord.timedOut) {
              budgetExceeded = true;
              throw new Error('Phase budget exceeded.');
            }
            const ssRecord = semanticScholarRecord.value;
            semanticScholarHit = ssRecord != null;
            if (ssRecord) {
              ctx.providerUsage.semanticScholarCalls += 1;
              const ssMismatch = applyProviderRecord(
                carrier,
                originalFields,
                ssRecord,
                'semantic_scholar',
                fieldsEnriched,
                fieldsOverwritten,
                blockedFields,
              );
              enrichmentMismatch = enrichmentMismatch ?? ssMismatch ?? undefined;
            }
          } catch {
            hadError = !budgetExceeded;
          }
        }
      } catch {
        hadError = !budgetExceeded;
      }

      const fieldChanges = fieldsEnriched.size + fieldsOverwritten.size;
      const status =
        budgetExceeded
          ? fieldChanges > 0
            ? 'partial'
            : 'skipped'
          : hadError
          ? 'error'
          : fieldChanges > 0
            ? 'enriched'
            : crossrefHit || openalexHit
              ? 'partial'
              : 'skipped';

      if (fieldChanges > 0) changedCount += 1;
      if (hadError || blockedFields.size > 0 || budgetExceeded) warningCount += 1;

      carrier.enrichment = {
        status,
        crossrefHit,
        openalexHit,
        semanticScholarHit,
        fieldsEnriched: [...fieldsEnriched],
        fieldsOverwritten: [...fieldsOverwritten],
        cacheHits: 0,
        ...(enrichmentMismatch ? { mismatch: enrichmentMismatch } : {}),
      };
      syncFieldUncertainty(carrier.fields);

      carrier.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: hadError || blockedFields.size > 0 || budgetExceeded ? 'warning' : status === 'skipped' ? 'skipped' : 'success',
          durationMs: 0,
          ...(
            budgetExceeded
              ? { code: ErrorCode.ENRICH_CROSSREF_TIMEOUT }
              : hadError
              ? { code: ErrorCode.ENRICH_CROSSREF_ERROR }
              : blockedFields.size > 0
                ? { code: ErrorCode.ENRICH_OVERWRITE_BLOCKED }
                : {}
          ),
          message: budgetExceeded
            ? 'Enrichment stopped when the phase latency budget was reached.'
            : hadError
              ? 'Enrichment degraded because a provider lookup failed.'
            : status === 'skipped'
              ? 'Enrichment found no provider metadata to apply.'
              : `Enrichment applied ${fieldChanges} provider field updates.`,
          details: {
            crossrefHit,
            openalexHit,
            semanticScholarHit,
            fieldsEnriched: [...fieldsEnriched],
            fieldsOverwritten: [...fieldsOverwritten],
            blockedFields: [...blockedFields],
            budgetExceeded,
            deadLetterCount: carrierDeadLetters.length,
            ...(carrierDeadLetters.length > 0
              ? {
                deadLetters: carrierDeadLetters.map((entry) => ({
                  provider: entry.provider,
                  lookupKey: entry.lookupKey,
                  statusCode: entry.statusCode,
                  message: entry.message,
                })),
              }
              : {}),
          },
        }),
      );
      },
    );

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: warningCount > 0 ? 'warning' : changedCount > 0 ? 'success' : 'skipped',
        durationMs: Date.now() - startedAt,
        ...(warningCount > 0
          ? {
              code: isStageBudgetExceeded(ctx, this.phaseId, startedAt)
                ? ErrorCode.ENRICH_CROSSREF_TIMEOUT
                : ErrorCode.ENRICH_CROSSREF_ERROR,
            }
          : {}),
        message:
          isStageBudgetExceeded(ctx, this.phaseId, startedAt)
            ? `Phase 8 stopped at its latency budget after enriching ${changedCount} references.`
            : changedCount > 0
              ? `Phase 8 enriched ${changedCount} references.`
              : 'Phase 8 enrichment had no provider changes.',
        details: {
          deadLetterCount: deadLetters.length,
          ...(deadLetters.length > 0
            ? {
              deadLetters: deadLetters.slice(0, MAX_DEAD_LETTER_DETAILS).map((entry) => ({
                carrierId: entry.carrierId,
                provider: entry.provider,
                lookupKey: entry.lookupKey,
                statusCode: entry.statusCode,
                message: entry.message,
                at: entry.at,
              })),
            }
            : {}),
        },
      }),
    );

    return carriers;
  }
}

export const phase8Enrich = new Phase8Enrich();

function normalizeDoi(value: string): string {
  return normalizeDoiForKey(value) ?? '';
}

// When OCR/noise destroyed the DOI so the extractor found none, try to recover a
// structurally-valid DOI candidate from the raw text (grammar-constrained: the
// registrant after "10." must be digits — see ocrFold.recoverDoi) and use it for
// provider lookup ONLY. The candidate is never written to output: only a
// provider-confirmed record flows back through the normal (verified) enrichment
// application path, so a wrong recovery cannot corrupt the result — it simply
// fails to resolve. This is what lets OCR'd references (≈22% of which have a
// DOI invisible to the regex) still resolve to canonical metadata.
export function resolveEnrichmentLookupFields(carrier: ReferenceCarrier): ExtractedFields {
  if (hasFieldValue(carrier.fields.doi)) return carrier.fields;
  const recovered = recoverDoi(carrier.raw);
  if (!recovered) return carrier.fields;
  return {
    ...carrier.fields,
    doi: fieldOf(recovered, 'regex_fallback', STAGE_ID, 0.5),
  };
}

export function buildProviderMemoKey(fields: ExtractedFields): string | null {
  const rawDoi = typeof fields.doi.value === 'string' ? normalizeDoi(fields.doi.value) : null;
  if (rawDoi) return `doi:${rawDoi}`;

  const title = typeof fields.title.value === 'string'
    ? normalizeLookupText(fields.title.value)
    : '';
  if (!title) return null;
  const url = normalizeUrlForKey(fields.url.value);
  const seed = url ? `${title}|${url}` : title;
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 16);
  return `title:${hash}`;
}

function unwrapProviderRecord(input: {
  carrierId: string;
  provider: 'crossref' | 'openalex';
  result: PromiseSettledResult<ProviderRecord | null>;
  lookupKey: string;
  idempotencyKey: string;
}): {
  record: ProviderRecord | null;
  deadLetter?: ProviderDeadLetterEntry;
} {
  if (input.result.status === 'fulfilled') {
    return { record: input.result.value };
  }

  const reason = input.result.reason;
  if (reason instanceof ProviderLookupError) {
    return {
      record: null,
      deadLetter: {
        carrierId: input.carrierId,
        provider: input.provider,
        lookupKey: reason.lookupKey || input.lookupKey,
        idempotencyKey: reason.idempotencyKey || input.idempotencyKey,
        ...(typeof reason.statusCode === 'number' ? { statusCode: reason.statusCode } : {}),
        message: reason.message,
        at: new Date().toISOString(),
      },
    };
  }

  return {
    record: null,
    deadLetter: {
      carrierId: input.carrierId,
      provider: input.provider,
      lookupKey: input.lookupKey,
      idempotencyKey: input.idempotencyKey,
      message: reason instanceof Error ? reason.message : 'Provider lookup failed.',
      at: new Date().toISOString(),
    },
  };
}

export function applyProviderRecord(
  carrier: ReferenceCarrier,
  originalFields: ExtractedFields,
  record: ProviderRecord | null,
  provider: 'crossref' | 'openalex' | 'semantic_scholar',
  fieldsEnriched: Set<string>,
  fieldsOverwritten: Set<string>,
  blockedFields: Set<string>,
): EnrichmentResult['mismatch'] | null {
  if (!record) return null;

  // No-fabrication guard. When the citation has no anchoring DOI, the provider record was
  // resolved by a bibliographic/title search (confidence < 0.9), which is exactly the case
  // that scrambled input abuses: a real title recycled onto a wrong author/year matches the
  // real work. If that record CONFLICTS with the citation (author/year/title/type disagree),
  // its fields almost certainly belong to a DIFFERENT work — applying them (even into empty
  // fields) would fabricate a reference the input never claimed. Withhold the whole record
  // and report the conflict so health flags it for review instead of silently "correcting" it.
  // DOI-anchored or high-confidence records keep their existing path (DOI verification +
  // the 0.85 overwrite threshold already govern those).
  const originalDoi = typeof originalFields.doi.value === 'string'
    ? normalizeDoi(originalFields.doi.value)
    : '';
  if (!originalDoi && record.confidence < 0.9) {
    const agreement = verifyEnrichmentRecordMatch(originalFields, record, carrier.type.type);
    if (agreement.conflicts.length > 0) {
      return { provider, reasons: agreement.conflicts };
    }
  }

  for (const [key, value] of getProviderEntries(record)) {
    if (!shouldApplyProviderField(carrier, originalFields, record, key, value)) {
      continue;
    }
    const existing = carrier.fields[key];
    const existingHadValue = hasFieldValue(existing);
    const next = applyEnrichmentField(existing as never, value as never, record.confidence, provider, STAGE_ID) as typeof existing;
    const valueChanged = !valuesEqual(existing.value, next.value);

    if (!valueChanged && isAdminProtected(existing) && !valuesEqual(existing.value, value)) {
      blockedFields.add(key);
      continue;
    }

    if (!valueChanged) {
      confirmProviderFieldMatch(
        carrier,
        key,
        existing,
        value,
        record,
        provider,
        fieldsEnriched,
      );
      continue;
    }

    setExtractedField(carrier.fields, key, next as ExtractedFields[typeof key]);

    if (!existingHadValue && hasFieldValue(next)) {
      fieldsEnriched.add(key);
    } else {
      fieldsOverwritten.add(key);
    }
  }

  return null;
}

function shouldApplyProviderField(
  carrier: ReferenceCarrier,
  originalFields: ExtractedFields,
  record: ProviderRecord,
  key: ExtractedFieldKey,
  value: ExtractedFields[ExtractedFieldKey]['value'],
): boolean {
  const originalDoi = typeof originalFields.doi.value === 'string'
    ? normalizeDoi(originalFields.doi.value)
    : '';
  if (originalDoi) {
    return true;
  }

  if (record.confidence >= 0.9) {
    return true;
  }

  if (
    carrier.type.type === 'conference-paper'
    && key === 'journal'
    && typeof originalFields.conferenceTitle.value === 'string'
    && originalFields.conferenceTitle.value.trim().length > 0
    && !hasFieldValue(originalFields.journal)
  ) {
    return false;
  }

  if (key === 'doi') {
    return false;
  }

  if (key === 'publisher') {
    return false;
  }

  if (key === 'url' && typeof value === 'string' && /doi\.org\//i.test(value)) {
    return false;
  }

  return true;
}

function getProviderEntries(
  record: ProviderRecord,
): Array<[ExtractedFieldKey, ExtractedFields[ExtractedFieldKey]['value']]> {
  const entries: Array<[ExtractedFieldKey, ExtractedFields[ExtractedFieldKey]['value']]> = [];

  for (const key of EXTRACTED_FIELD_KEYS) {
    const rawValue = record.fields[key];
    if (rawValue === undefined) continue;

    const value = coerceProviderValue(key, rawValue);
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;

    entries.push([key, value]);
  }

  return entries;
}

function coerceProviderValue<K extends ExtractedFieldKey>(
  key: K,
  rawValue: unknown,
): ExtractedFields[K]['value'] | null {
  if (key === 'authors' || key === 'editors') {
    if (!Array.isArray(rawValue)) return [] as ExtractedFields[K]['value'];

    const authors = rawValue
      .map((value) => toCanonicalAuthor(value))
      .filter((value): value is CanonicalAuthor => value != null);

    return authors as ExtractedFields[K]['value'];
  }

  if (key === 'year') {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue as ExtractedFields[K]['value'];
    }
    if (typeof rawValue === 'string') {
      const match = rawValue.match(/\b((?:19|20)\d{2})\b/);
      return (match ? Number(match[1]) : null) as ExtractedFields[K]['value'] | null;
    }
    return null;
  }

  if (typeof rawValue === 'string') {
    const normalized = rawValue.trim();
    return (normalized.length > 0 ? normalized : null) as ExtractedFields[K]['value'] | null;
  }

  return null;
}

function toCanonicalAuthor(value: unknown): CanonicalAuthor | null {
  if (typeof value !== 'object' || value == null) return null;

  const family = typeof (value as { family?: unknown }).family === 'string'
    ? (value as { family: string }).family.trim()
    : '';
  const given = typeof (value as { given?: unknown }).given === 'string'
    ? (value as { given: string }).given.trim()
    : null;
  const literal = typeof (value as { literal?: unknown }).literal === 'string'
    ? (value as { literal: string }).literal.trim()
    : undefined;

  if (!family && !literal) return null;

  return {
    family: family || literal || 'Unknown',
    given,
    initials: given ? given.split(/\s+/).map((part) => part.charAt(0).toUpperCase()).join('') : null,
    ...(literal ? { literal } : {}),
    isCorporate: Boolean(literal),
  };
}

function confirmProviderFieldMatch(
  carrier: ReferenceCarrier,
  key: ExtractedFieldKey,
  existing: ExtractedFields[ExtractedFieldKey],
  providerValue: ExtractedFields[ExtractedFieldKey]['value'],
  record: ProviderRecord,
  provider: 'crossref' | 'openalex' | 'semantic_scholar',
  fieldsEnriched: Set<string>,
): void {
  if (!hasFieldValue(existing) || isTrustedFieldOrigin(existing.origin) || isAdminProtected(existing)) {
    return;
  }

  if (!valuesEqual(existing.value, providerValue)) {
    return;
  }

  const source = enrichmentSource(provider);
  const confirmed = fieldOf(
    existing.value as never,
    source,
    STAGE_ID,
    Math.max(existing.confidence, Math.min(1, record.confidence)),
    { origin: 'authority' },
  );

  setExtractedField(carrier.fields, key, confirmed as ExtractedFields[typeof key]);
  fieldsEnriched.add(key);
}

function enrichmentSource(provider: 'crossref' | 'openalex' | 'semantic_scholar'): FieldSource {
  return `enrichment_${provider}` as FieldSource;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
