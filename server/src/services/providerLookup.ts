import { createHash } from 'node:crypto';

export interface ProviderLookupOptions {
  idempotencyKey?: string;
  lookupKey?: string;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export type ProviderName = 'crossref' | 'openalex';

export class ProviderLookupError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly route: string,
    readonly idempotencyKey: string,
    readonly lookupKey: string,
    readonly statusCode?: number,
    message = 'Provider lookup failed.',
  ) {
    super(message);
    this.name = 'ProviderLookupError';
  }
}

export function buildProviderIdempotencyKey(provider: ProviderName, lookupKey: string): string {
  const digest = createHash('sha256').update(`${provider}|${lookupKey}`).digest('hex').slice(0, 32);
  return `${provider}:${digest}`;
}

