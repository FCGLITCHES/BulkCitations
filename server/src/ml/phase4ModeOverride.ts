import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { runtimeOverrides as runtimeOverridesTable } from '../db/schema.js';
import { runtimePersistenceBackend } from '../runtime/persistence.js';
import { env } from '../config.js';

export type Phase4OverrideMode = 'heuristic' | 'primary' | null;

const PHASE4_OVERRIDE_KEY = 'phase4_mode_override';
const OVERRIDE_CACHE_TTL_MS = 2_000;

let phase4OverrideMode: Phase4OverrideMode = null;
let phase4OverrideCachedAtMs = 0;

function formatOverridePersistenceError(action: 'read' | 'write', error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`[ml][phase4Override] persistence ${action} failed: ${message}`);
}

export function shouldUseTransientPhase4OverrideState(): boolean {
  if (process.env.BULKREFERENCES_ISOLATED_RUNTIME === 'true') {
    return true;
  }

  return runtimePersistenceBackend !== 'database' && env.NODE_ENV === 'test';
}

function normalizeOverrideMode(value: unknown): Phase4OverrideMode {
  if (value === 'heuristic' || value === 'primary') {
    return value;
  }
  return null;
}

function extractModeFromOverridePayload(payload: unknown): Phase4OverrideMode {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const candidate = (payload as { mode?: unknown }).mode;
  return normalizeOverrideMode(candidate);
}

async function refreshOverrideFromPersistence(): Promise<Phase4OverrideMode> {
  if (shouldUseTransientPhase4OverrideState()) {
    return phase4OverrideMode;
  }

  try {
    const [row] = await db
      .select({
        value: runtimeOverridesTable.value,
      })
      .from(runtimeOverridesTable)
      .where(eq(runtimeOverridesTable.key, PHASE4_OVERRIDE_KEY))
      .limit(1);

    phase4OverrideMode = extractModeFromOverridePayload(row?.value);
    phase4OverrideCachedAtMs = Date.now();
  } catch (error) {
    throw formatOverridePersistenceError('read', error);
  }

  return phase4OverrideMode;
}

export async function getPhase4OverrideMode(): Promise<Phase4OverrideMode> {
  if (shouldUseTransientPhase4OverrideState()) {
    return phase4OverrideMode;
  }

  const cacheAgeMs = Date.now() - phase4OverrideCachedAtMs;
  if (cacheAgeMs <= OVERRIDE_CACHE_TTL_MS) {
    return phase4OverrideMode;
  }

  return refreshOverrideFromPersistence();
}

export async function setPhase4OverrideMode(mode: Phase4OverrideMode): Promise<Phase4OverrideMode> {
  if (shouldUseTransientPhase4OverrideState()) {
    phase4OverrideMode = mode;
    phase4OverrideCachedAtMs = Date.now();
    return phase4OverrideMode;
  }

  const previousMode = phase4OverrideMode;
  const previousCachedAtMs = phase4OverrideCachedAtMs;
  phase4OverrideMode = mode;
  phase4OverrideCachedAtMs = Date.now();

  try {
    await db
      .insert(runtimeOverridesTable)
      .values({
        key: PHASE4_OVERRIDE_KEY,
        value: { mode: phase4OverrideMode },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: runtimeOverridesTable.key,
        set: {
          value: { mode: phase4OverrideMode },
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    phase4OverrideMode = previousMode;
    phase4OverrideCachedAtMs = previousCachedAtMs;
    throw formatOverridePersistenceError('write', error);
  }

  return phase4OverrideMode;
}

export function getPhase4EffectiveLabel(
  envMode: 'heuristic' | 'shadow' | 'primary',
  overrideMode: Phase4OverrideMode = phase4OverrideMode,
): 'heuristic' | 'shadow' | 'primary' {
  if (overrideMode === 'heuristic') return 'heuristic';
  if (overrideMode === 'primary') return 'primary';
  return envMode;
}
