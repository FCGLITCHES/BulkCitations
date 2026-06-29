import { shouldUseRedisReportIpLimiter } from '../config.js';
import { getRedis } from '../redis/client.js';

type MemoryEntry = { count: number; day: string };

const memoryLimits = new Map<string, MemoryEntry>();

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Returns true if this IP may submit another citation report (under daily cap).
 * Uses Redis when available; otherwise an in-memory per-day counter (dev / no Redis).
 */
export async function tryConsumeReportSlot(ip: string, maxPerDay: number): Promise<boolean> {
  const day = utcDayKey();
  const key = `report_ip:${ip}:${day}`;
  const shouldUseRedis = shouldUseRedisReportIpLimiter();

  if (shouldUseRedis) {
    try {
      const redis = getRedis();
      const n = await redis.incr(key);
      if (n === 1) {
        await redis.expire(key, 86_400);
      }
      return n <= maxPerDay;
    } catch {
      // fall through to memory
    }
  }

  const prev = memoryLimits.get(key);
  if (!prev || prev.day !== day) {
    memoryLimits.set(key, { count: 1, day });
    return true;
  }
  if (prev.count >= maxPerDay) {
    return false;
  }
  prev.count += 1;
  return true;
}

export function resetReportIpLimiter(): void {
  memoryLimits.clear();
}
