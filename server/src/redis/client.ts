import { Redis } from 'ioredis';
import { env, resolvedRedisUrl } from '../config.js';

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (!resolvedRedisUrl || !resolvedRedisUrl.trim()) {
    const hasRest =
      Boolean(env.UPSTASH_REDIS_REST_URL?.trim()) && Boolean(env.UPSTASH_REDIS_REST_TOKEN?.trim());
    if (hasRest) {
      throw new Error(
        'Redis TCP URL missing: set REDIS_URL or UPSTASH_REDIS_URL to your Upstash **Redis** URL (rediss://… from the Redis tab). ' +
          'REST credentials alone cannot drive the ioredis TCP client used for provider/ML cache, rate limiting, and report-IP backends.',
      );
    }
    throw new Error('REDIS_URL is not configured.');
  }
  if (!redisInstance) {
    redisInstance = new Redis(resolvedRedisUrl, {
      // null = don't throw MaxRetriesPerRequestError on a disconnect; the optional
      // cache/rate-limit/report-IP paths treat Redis as best-effort and tolerate reconnects.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 5_000,
      lazyConnect: false,
    });

    redisInstance.on('error', (err: unknown) => {
      // Log but don't crash — ioredis auto-reconnects and Redis is optional here.
      process.stderr.write(`[redis] error: ${String(err)}\n`);
    });
  }
  return redisInstance;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
