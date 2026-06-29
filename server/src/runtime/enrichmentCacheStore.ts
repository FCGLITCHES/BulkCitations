/**
 * Cross-job enrichment cache. Keyed by the provider memo key (`doi:…` / `title:…` — the same key the
 * recovery already computes to look up providers), so a FUTURE conversion of the same reference is
 * applied from cache and promoted to ready WITHOUT a provider call. A null-userId row is the shared
 * global entry; a per-user row is that user's private copy ("both" persistence). Falls back to an
 * in-process Map when the runtime isn't DB-backed (tests), and never throws to its callers.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { enrichedReferenceCache } from '../db/schema.js';
import { runtimePersistenceBackend } from './persistence.js';

export interface CachedEnrichment {
  /** A serialized ProviderRecord ({ confidence, fields, authors?, referenceType? }). */
  record: Record<string, unknown>;
  provider: string | null;
}

export interface RecordEnrichmentInput {
  userId: string | null;
  cacheKey: string;
  doi: string | null;
  record: Record<string, unknown>;
  provider: string | null;
  matchConfidence: number | null;
}

const memCache = new Map<string, CachedEnrichment>();
const memKey = (userId: string | null, cacheKey: string): string => `${userId ?? 'global'}|${cacheKey}`;

export async function lookupEnrichedReference(
  userId: string | null,
  cacheKey: string,
): Promise<CachedEnrichment | null> {
  try {
    if (runtimePersistenceBackend !== 'database') {
      return memCache.get(memKey(userId, cacheKey)) ?? memCache.get(memKey(null, cacheKey)) ?? null;
    }
    // Prefer the user's private entry, then the shared global one.
    for (const scope of userId ? [userId, null] : [null]) {
      const rows = await db
        .select({ fields: enrichedReferenceCache.fields, provider: enrichedReferenceCache.sourceProvider })
        .from(enrichedReferenceCache)
        .where(
          and(
            eq(enrichedReferenceCache.canonicalWorkKey, cacheKey),
            scope ? eq(enrichedReferenceCache.userId, scope) : isNull(enrichedReferenceCache.userId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row) return { record: row.fields as Record<string, unknown>, provider: row.provider };
    }
    return null;
  } catch {
    return null;
  }
}

export async function recordEnrichedReference(input: RecordEnrichmentInput): Promise<void> {
  try {
    if (runtimePersistenceBackend !== 'database') {
      const entry: CachedEnrichment = { record: input.record, provider: input.provider };
      memCache.set(memKey(input.userId, input.cacheKey), entry);
      if (input.userId) memCache.set(memKey(null, input.cacheKey), entry);
      return;
    }
    // Write the user's private copy AND the shared global copy.
    for (const scope of input.userId ? [input.userId, null] : [null]) {
      await upsertScope(scope, input);
    }
  } catch {
    // best-effort cache — never fail a recovery
  }
}

async function upsertScope(userId: string | null, input: RecordEnrichmentInput): Promise<void> {
  const existing = (
    await db
      .select({ id: enrichedReferenceCache.id, hitCount: enrichedReferenceCache.hitCount })
      .from(enrichedReferenceCache)
      .where(
        and(
          eq(enrichedReferenceCache.canonicalWorkKey, input.cacheKey),
          userId ? eq(enrichedReferenceCache.userId, userId) : isNull(enrichedReferenceCache.userId),
        ),
      )
      .limit(1)
  )[0];

  if (existing) {
    await db
      .update(enrichedReferenceCache)
      .set({
        fields: input.record,
        sourceProvider: input.provider,
        matchConfidence: input.matchConfidence,
        hitCount: (existing.hitCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(enrichedReferenceCache.id, existing.id));
  } else {
    await db.insert(enrichedReferenceCache).values({
      userId,
      doi: input.doi,
      canonicalWorkKey: input.cacheKey,
      fields: input.record,
      sourceProvider: input.provider,
      matchConfidence: input.matchConfidence,
    });
  }
}
