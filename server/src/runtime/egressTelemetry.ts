import { randomUUID } from 'node:crypto';
import { getCorrelationId } from './requestContext.js';
import {
  recordEgressEvent,
  rollupEgressDaily,
  rollupEgressMonthly,
} from './persistence.js';

export type EgressProvider = 'crossref' | 'openalex' | 'openai' | 'ml' | 'other';

export interface EgressEventInput {
  provider: EgressProvider;
  route: string;
  method: string;
  status: number;
  requestBodyBytes: number;
  responseBodyBytes: number;
  latencyMs: number;
  cacheHit?: boolean;
}

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function shouldPersistEgressTelemetry(): boolean {
  return process.env.BULKREFERENCES_ISOLATED_RUNTIME !== 'true';
}

export async function recordEgress(input: EgressEventInput): Promise<void> {
  if (!shouldPersistEgressTelemetry()) {
    return;
  }

  const correlationId = getCorrelationId();
  const now = new Date();
  const event = {
    id: randomUUID(),
    correlationId: correlationId ?? 'unknown',
    provider: input.provider,
    route: input.route,
    method: input.method,
    status: input.status,
    requestBodyBytes: input.requestBodyBytes,
    responseBodyBytes: input.responseBodyBytes,
    latencyMs: input.latencyMs,
    cacheHit: input.cacheHit ?? false,
    createdAt: now.toISOString(),
  };

  await recordEgressEvent(event);
  await Promise.all([
    rollupEgressDaily({
      period: dayKey(now),
      provider: event.provider,
      route: event.route,
      requestBodyBytes: event.requestBodyBytes,
      responseBodyBytes: event.responseBodyBytes,
      calls: 1,
      cacheHits: event.cacheHit ? 1 : 0,
    }),
    rollupEgressMonthly({
      period: monthKey(now),
      provider: event.provider,
      route: event.route,
      requestBodyBytes: event.requestBodyBytes,
      responseBodyBytes: event.responseBodyBytes,
      calls: 1,
      cacheHits: event.cacheHit ? 1 : 0,
    }),
  ]);
}
