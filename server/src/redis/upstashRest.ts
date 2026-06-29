import { Redis } from '@upstash/redis';
import { env } from '../config.js';

/** Lazy singleton for Upstash REST. Returns null if REST env is unset. */
let instance: Redis | null = null;

export function getUpstashRest(): Redis | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    return null;
  }
  if (!instance) {
    instance = new Redis({ url, token });
  }
  return instance;
}
