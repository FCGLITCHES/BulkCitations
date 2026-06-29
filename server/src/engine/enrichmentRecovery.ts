import { crossrefService, type CrossrefService, type ProviderRecord } from '../services/crossref.js';
import { openAlexService, type OpenAlexService } from '../services/openalex.js';
import { buildProviderIdempotencyKey } from '../services/providerLookup.js';
import { verifyDoiAgainstRecord, verifyEnrichmentRecordMatch } from './doiVerification.js';
import { toHealthWarning } from './healthWarnings.js';
import { rescoreCarrierAfterCorrection } from './rescoring.js';
import { syncFieldUncertainty } from './fieldConfidence.js';
import { hasFieldValue } from './utils/fields.js';
import {
  applyProviderRecord,
  buildProviderMemoKey,
  resolveEnrichmentLookupFields,
} from './phases/phase8Enrich.js';
import type { ReferenceCarrier } from './types/carrier.js';
import type { EnrichmentRecoveryResult, PipelineContext } from './types/pipeline.js';

type RecoveryProvider = 'crossref' | 'openalex';
type ApplyProvider = 'crossref' | 'openalex' | 'semantic_scholar';

/**
 * Cross-job cache hooks, injected by the orchestrator (keeps this engine module free of DB deps).
 * The key is the provider memo key, so a future job hits the cache before any provider call.
 */
export interface EnrichmentCacheHooks {
  lookup: (
    userId: string | null,
    cacheKey: string,
  ) => Promise<{ record: Record<string, unknown>; provider: string | null } | null>;
  record: (input: {
    userId: string | null;
    cacheKey: string;
    doi: string | null;
    record: Record<string, unknown>;
    provider: string | null;
    matchConfidence: number | null;
  }) => Promise<void>;
}

const DEFAULT_MAX_LOOKUPS = 50;

/**
 * Pro-only post-health recovery. For each reference still in `needs_action`: first try the cross-job
 * cache, otherwise do a verified enrichment lookup — and ONLY on a confident match apply the
 * canonical fields and re-derive status (promoting it to `ready`). A mismatch (conflicting year /
 * type / author) leaves the reference untouched in `needs_action`, so a wrong provider record can
 * never confidently green a reference. Verified matches are written back to the cache so the same
 * reference in a future job skips straight to ready. Bounded by `maxLookups` per batch.
 */
export async function recoverNeedsActionCarriers(
  carriers: ReferenceCarrier[],
  ctx: PipelineContext,
  options: {
    maxLookups?: number;
    crossref?: CrossrefService;
    openalex?: OpenAlexService;
    cache?: EnrichmentCacheHooks;
  } = {},
): Promise<EnrichmentRecoveryResult> {
  const crossref = options.crossref ?? crossrefService;
  const openalex = options.openalex ?? openAlexService;
  const maxLookups = options.maxLookups ?? DEFAULT_MAX_LOOKUPS;
  const cache = options.cache;

  const targets = carriers.filter(
    (carrier) => carrier.publicStatus === 'needs_action' && !carrier.error,
  );

  let attempted = 0;
  let enriched = 0;
  let skipped = 0;
  const recoveredCarrierIds: string[] = [];

  for (const carrier of targets) {
    if (attempted >= maxLookups) {
      skipped += 1;
      continue;
    }
    attempted += 1;

    const recovered = await recoverOne(carrier, ctx, crossref, openalex, cache);
    if (recovered) {
      enriched += 1;
      recoveredCarrierIds.push(carrier.id);
    } else {
      skipped += 1;
    }
  }

  return { attempted, enriched, skipped, recoveredCarrierIds };
}

async function recoverOne(
  carrier: ReferenceCarrier,
  ctx: PipelineContext,
  crossref: CrossrefService,
  openalex: OpenAlexService,
  cache: EnrichmentCacheHooks | undefined,
): Promise<boolean> {
  const lookupFields = resolveEnrichmentLookupFields(carrier);
  const key = buildProviderMemoKey(lookupFields);
  if (!key) return false;
  const userId = ctx.tenantContext.userId ?? null;
  const doiValue = typeof lookupFields.doi.value === 'string' ? lookupFields.doi.value : null;

  // 1. Cross-job cache: a prior verified match for the same key applies without a provider call.
  if (cache) {
    const cached = await cache.lookup(userId, key);
    if (cached) {
      const promoted = await applyRecordAndPromote(
        carrier,
        ctx,
        cached.record as unknown as ProviderRecord,
        coerceProvider(cached.provider),
        'cache',
      );
      if (promoted) return true;
    }
  }

  // 2. Provider lookup + verification.
  const resolved = await resolveBestRecord(lookupFields, key, ctx, crossref, openalex);
  if (!resolved) return false;
  const { provider, record } = resolved;

  const verified = hasFieldValue(lookupFields.doi)
    ? verifyDoiAgainstRecord(lookupFields, lookupFields.doi.value, record).status === 'verified'
    : verifyEnrichmentRecordMatch(lookupFields, record, carrier.type.type).matches;
  if (!verified) return false;

  const promoted = await applyRecordAndPromote(carrier, ctx, record, provider, providerLabel(provider));
  if (!promoted) return false;

  // 3. Cache the verified match for future jobs (per-user + global).
  if (cache) {
    await cache.record({
      userId,
      cacheKey: key,
      doi: doiValue,
      record: record as unknown as Record<string, unknown>,
      provider,
      matchConfidence: record.confidence,
    });
  }
  return true;
}

/**
 * Apply a (verified or cached) provider record to a carrier and re-derive its status. Returns true
 * only if the reference actually changed AND was promoted out of needs_action.
 */
async function applyRecordAndPromote(
  carrier: ReferenceCarrier,
  ctx: PipelineContext,
  record: ProviderRecord,
  provider: ApplyProvider,
  sourceLabel: string,
): Promise<boolean> {
  if (!record || typeof record !== 'object' || typeof record.fields !== 'object') return false;

  const originalFields = structuredClone(carrier.fields);
  const fieldsEnriched = new Set<string>();
  const fieldsOverwritten = new Set<string>();
  const blockedFields = new Set<string>();
  applyProviderRecord(carrier, originalFields, record, provider, fieldsEnriched, fieldsOverwritten, blockedFields);

  const changed = [...new Set([...fieldsEnriched, ...fieldsOverwritten])];
  if (changed.length === 0) return false;

  syncFieldUncertainty(carrier.fields);
  mergeEnrichmentResult(carrier, provider, fieldsEnriched, fieldsOverwritten);

  await rescoreCarrierAfterCorrection(carrier, ctx, changed);

  if (carrier.publicStatus === 'needs_action') return false;

  carrier.health.warnings.push(
    toHealthWarning('enrichment_recovered', `Recovered via ${sourceLabel} (${changed.join(', ')}).`),
  );
  return true;
}

async function resolveBestRecord(
  lookupFields: ReturnType<typeof resolveEnrichmentLookupFields>,
  key: string,
  ctx: PipelineContext,
  crossref: CrossrefService,
  openalex: OpenAlexService,
): Promise<{ provider: RecoveryProvider; record: ProviderRecord } | null> {
  ctx.providerUsage.crossrefCalls += 1;
  ctx.providerUsage.openalexCalls += 1;
  const [crossrefResult, openalexResult] = await Promise.allSettled([
    crossref.lookup(lookupFields, {
      lookupKey: `crossref:${key}`,
      idempotencyKey: buildProviderIdempotencyKey('crossref', `crossref:${key}`),
    }),
    openalex.lookup(lookupFields, {
      lookupKey: `openalex:${key}`,
      idempotencyKey: buildProviderIdempotencyKey('openalex', `openalex:${key}`),
    }),
  ]);

  const candidates: Array<{ provider: RecoveryProvider; record: ProviderRecord }> = [];
  if (crossrefResult.status === 'fulfilled' && crossrefResult.value) {
    candidates.push({ provider: 'crossref', record: crossrefResult.value });
  }
  if (openalexResult.status === 'fulfilled' && openalexResult.value) {
    candidates.push({ provider: 'openalex', record: openalexResult.value });
  }
  candidates.sort((left, right) => right.record.confidence - left.record.confidence);
  return candidates[0] ?? null;
}

function mergeEnrichmentResult(
  carrier: ReferenceCarrier,
  provider: ApplyProvider,
  fieldsEnriched: Set<string>,
  fieldsOverwritten: Set<string>,
): void {
  const prev = carrier.enrichment ?? {
    status: 'skipped' as const,
    crossrefHit: false,
    openalexHit: false,
    semanticScholarHit: false,
    fieldsEnriched: [],
    fieldsOverwritten: [],
    cacheHits: 0,
  };
  carrier.enrichment = {
    ...prev,
    status: 'enriched',
    crossrefHit: prev.crossrefHit || provider === 'crossref',
    openalexHit: prev.openalexHit || provider === 'openalex',
    fieldsEnriched: [...new Set([...prev.fieldsEnriched, ...fieldsEnriched])],
    fieldsOverwritten: [...new Set([...prev.fieldsOverwritten, ...fieldsOverwritten])],
  };
}

function providerLabel(provider: RecoveryProvider): string {
  return provider === 'crossref' ? 'Crossref' : 'OpenAlex';
}

function coerceProvider(provider: string | null): ApplyProvider {
  if (provider === 'openalex') return 'openalex';
  if (provider === 'semantic_scholar') return 'semantic_scholar';
  return 'crossref';
}
