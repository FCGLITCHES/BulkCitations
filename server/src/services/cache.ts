import { getRedis } from '../redis/client.js';
import { shouldUseRedisProviderCaches } from '../config.js';

let hitCount = 0;
let missCount = 0;

export async function getFromCache<T>(key: string): Promise<T | null> {
  if (!shouldUseRedisProviderCaches()) {
    missCount++;
    return null;
  }

  try {
    const raw = await getRedis().get(key);
    if (raw === null) {
      missCount++;
      return null;
    }
    hitCount++;
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if (!(err instanceof Error && err.message === 'REDIS_URL is not configured.')) {
      process.stderr.write(
        `[cache] get error for "${key}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    missCount++;
    return null;
  }
}

export async function setInCache(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!shouldUseRedisProviderCaches()) {
    return;
  }

  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err: unknown) {
    if (!(err instanceof Error && err.message === 'REDIS_URL is not configured.')) {
      process.stderr.write(
        `[cache] set error for "${key}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

export async function deleteFromCache(key: string): Promise<void> {
  if (!shouldUseRedisProviderCaches()) {
    return;
  }

  try {
    await getRedis().del(key);
  } catch (err: unknown) {
    if (!(err instanceof Error && err.message === 'REDIS_URL is not configured.')) {
      process.stderr.write(
        `[cache] delete error for "${key}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

export async function getCacheStats(): Promise<{
  hitCount: number;
  missCount: number;
}> {
  return { hitCount, missCount };
}
