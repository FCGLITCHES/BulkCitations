import { createHash } from 'node:crypto';
import type { ExtractedFields } from '../engine/types/citation.js';
import type { ReferenceType } from '../engine/types/citation.js';
import { env, shouldUseRedisProviderCaches } from '../config.js';
import { getRedis } from '../redis/client.js';
import { redisKeys, redisTtl } from '../redis/keys.js';
import { OutboundFetchError, instrumentedFetch } from './instrumentedFetch.js';
import { getTestProviderRecordByDoi } from './providerFixtures.js';
import {
  buildProviderIdempotencyKey,
  ProviderLookupError,
  type ProviderLookupOptions,
} from './providerLookup.js';

export interface ProviderRecord {
  confidence: number;
  fields: Partial<Record<keyof ExtractedFields, unknown>>;
  authors?: Array<{ family: string; given?: string | null }>;
  referenceType?: ReferenceType | null;
}

export interface CrossrefService {
  lookup(fields: ExtractedFields, options?: ProviderLookupOptions): Promise<ProviderRecord | null>;
  resolveDoi(doi: string, options?: ProviderLookupOptions): Promise<ProviderRecord | null>;
}

function normalizeDoi(value: string): string {
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase();
}

function hashQuery(query: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function buildHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    // Crossref polite pool: identifiable UA (contact mailto optional via CROSSREF_EMAIL)
    'User-Agent': env.CROSSREF_EMAIL
      ? `BulkReferences/1.0 (https://bulkreferences.com; mailto:${env.CROSSREF_EMAIL})`
      : 'BulkReferences/1.0 (https://bulkreferences.com)',
  };
}

const MIN_INTERVAL_MS = env.CROSSREF_MIN_INTERVAL_MS;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

let chain: Promise<unknown> = Promise.resolve();
let lastCallEnd = 0;

function enqueueCrossref<T>(fn: () => Promise<T>): Promise<T> {
  const task = chain.then(async () => {
    const wait =
      lastCallEnd === 0
        ? 0
        : Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallEnd));
    if (wait > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, wait);
      });
    }

    try {
      return await fn();
    } finally {
      lastCallEnd = Date.now();
    }
  });

  chain = task.then(() => undefined, () => undefined);
  return task as Promise<T>;
}

function mapWorkTypeToReferenceType(workType: unknown): ReferenceType | null {
  if (typeof workType !== 'string') {
    return null;
  }

  switch (workType.trim().toLowerCase()) {
    case 'journal-article':
      return 'article-journal';
    case 'proceedings-article':
      return 'conference-paper';
    case 'book':
    case 'monograph':
    case 'edited-book':
      return 'book';
    case 'book-chapter':
    case 'reference-entry':
      return 'book-chapter';
    case 'posted-content':
      return 'preprint';
    case 'dissertation':
      return 'thesis';
    case 'report':
    case 'report-series':
      return 'report';
    default:
      return null;
  }
}

function extractYear(work: Record<string, unknown>): number | null {
  for (const key of ['published-print', 'published-online', 'created']) {
    const entry = work[key] as { 'date-parts'?: number[][] } | undefined;
    const year = entry?.['date-parts']?.[0]?.[0];
    if (typeof year === 'number') return year;
  }
  return null;
}

function mapWorkToRecord(
  work: Record<string, unknown>,
  confidence: number,
): ProviderRecord {
  const title = (work['title'] as string[] | undefined)?.[0] ?? null;
  const journal = (work['container-title'] as string[] | undefined)?.[0] ?? null;
  const doi = (work['DOI'] as string | undefined) ?? null;
  const volume = (work['volume'] as string | undefined) ?? null;
  const issue = (work['issue'] as string | undefined) ?? null;
  const pages = (work['page'] as string | undefined) ?? null;
  const publisher = (work['publisher'] as string | undefined) ?? null;
  const url = doi ? `https://doi.org/${doi}` : (work['URL'] as string | undefined) ?? null;
  const year = extractYear(work);

  const rawAuthors = work['author'] as
    | Array<{ family?: string; given?: string }>
    | undefined;

  const authors = rawAuthors
    ?.filter((a) => typeof a.family === 'string')
    .map((a) => ({
      family: a.family!,
      given: a.given ?? null,
    }));

  const record: ProviderRecord = {
    confidence,
    referenceType: mapWorkTypeToReferenceType(work['type']),
    fields: {
      title,
      year,
      journal,
      volume,
      issue,
      pages,
      doi,
      publisher,
      url,
    },
  };

  if (authors && authors.length > 0) {
    record.authors = authors;
    record.fields.authors = authors;
  }

  return record;
}

async function cachedGet<T>(
  cacheKey: string,
  ttl: number,
  fetcher: () => Promise<T | null>,
): Promise<T | null> {
  if (!shouldUseRedisProviderCaches()) {
    return fetcher();
  }

  let redis: ReturnType<typeof getRedis> | null = null;
  try {
    redis = getRedis();
  } catch {
    redis = null;
  }
  try {
    if (!redis) throw new Error('Redis unavailable');
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;
  } catch {
    /* cache miss or Redis down — proceed to fetch */
  }

  const result = await fetcher();

  if (result !== null) {
    try {
      if (!redis) throw new Error('Redis unavailable');
      await redis.set(cacheKey, JSON.stringify(result), 'EX', ttl);
    } catch {
      /* non-fatal cache write failure */
    }
  }

  return result;
}

export class RealCrossrefService implements CrossrefService {
  private readonly timeoutMs = env.CROSSREF_TIMEOUT_MS;
  private readonly headers = buildHeaders();

  async resolveDoi(doi: string, options: ProviderLookupOptions = {}): Promise<ProviderRecord | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;

    const cacheKey = redisKeys.crossrefDoi(normalized);
    const lookupKey = options.lookupKey ?? `doi:${normalized}`;
    const idempotencyKey = options.idempotencyKey ?? buildProviderIdempotencyKey('crossref', lookupKey);
    const retryAttempts = options.retryAttempts ?? env.CROSSREF_RETRY_ATTEMPTS;
    const retryDelayMs = options.retryDelayMs ?? env.CROSSREF_RETRY_BASE_DELAY_MS;

    return cachedGet<ProviderRecord>(cacheKey, redisTtl.crossrefDoi, async () => {
      // Path must keep `/` in the DOI as path segments — do not encode whole DOI as one segment (%2F).
      const pathDoi = normalized
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const query = env.CROSSREF_EMAIL
        ? `?mailto=${encodeURIComponent(env.CROSSREF_EMAIL)}`
        : '';
      const url = `https://api.crossref.org/works/${pathDoi}${query}`;

      const response = await enqueueCrossref(() =>
        instrumentedFetch({
          provider: 'crossref',
          route: 'crossref.resolveDoi',
          method: 'GET',
          url,
          headers: {
            ...this.headers,
            'x-idempotency-key': idempotencyKey,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
          retryAttempts,
          retryDelayMs,
          expectedContentTypes: ['application/json'],
        }),
      );

      if (!response.ok) {
        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          throw new ProviderLookupError(
            'crossref',
            'crossref.resolveDoi',
            idempotencyKey,
            lookupKey,
            response.status,
            `Crossref resolve DOI request failed with status ${response.status}.`,
          );
        }
        return null;
      }

      const json = (await response.json()) as {
        message?: Record<string, unknown>;
      };

      if (!json.message) return null;

      return mapWorkToRecord(json.message, 0.95);
    });
  }

  async lookup(fields: ExtractedFields, options: ProviderLookupOptions = {}): Promise<ProviderRecord | null> {
    const doi =
      typeof fields.doi.value === 'string'
        ? normalizeDoi(fields.doi.value)
        : null;

    if (doi) {
      const lookupKey = options.lookupKey ?? `doi:${doi}`;
      return this.resolveDoi(doi, { ...options, lookupKey });
    }

    const title =
      typeof fields.title.value === 'string'
        ? fields.title.value.trim()
        : null;

    if (!title) return null;

    const queryHash = hashQuery(title);
    const cacheKey = redisKeys.crossrefSearch(queryHash);
    const lookupKey = options.lookupKey ?? `title:${queryHash}`;
    const idempotencyKey = options.idempotencyKey ?? buildProviderIdempotencyKey('crossref', lookupKey);
    const retryAttempts = options.retryAttempts ?? env.CROSSREF_RETRY_ATTEMPTS;
    const retryDelayMs = options.retryDelayMs ?? env.CROSSREF_RETRY_BASE_DELAY_MS;

    try {
      return await cachedGet<ProviderRecord>(
        cacheKey,
        redisTtl.crossrefSearch,
        async () => {
          const params = new URLSearchParams({
            'query.bibliographic': title,
            rows: '1',
          });
          if (env.CROSSREF_EMAIL) {
            params.set('mailto', env.CROSSREF_EMAIL);
          }

          const url = `https://api.crossref.org/works?${params.toString()}`;

          const response = await enqueueCrossref(() =>
            instrumentedFetch({
              provider: 'crossref',
              route: 'crossref.lookup',
              method: 'GET',
              url,
              headers: {
                ...this.headers,
                'x-idempotency-key': idempotencyKey,
              },
              signal: AbortSignal.timeout(this.timeoutMs),
              retryAttempts,
              retryDelayMs,
              expectedContentTypes: ['application/json'],
            }),
          );

          if (!response.ok) {
            if (RETRYABLE_STATUS_CODES.has(response.status)) {
              throw new ProviderLookupError(
                'crossref',
                'crossref.lookup',
                idempotencyKey,
                lookupKey,
                response.status,
                `Crossref title lookup failed with status ${response.status}.`,
              );
            }
            return null;
          }

          const json = (await response.json()) as {
            message?: { items?: Record<string, unknown>[] };
          };

          const item = json.message?.items?.[0];
          if (!item) return null;

          return mapWorkToRecord(item, 0.80);
        },
      );
    } catch (error) {
      if (error instanceof ProviderLookupError) {
        throw error;
      }
      if (error instanceof OutboundFetchError) {
        throw new ProviderLookupError(
          'crossref',
          'crossref.lookup',
          idempotencyKey,
          lookupKey,
          error.statusCode,
          error.message,
        );
      }
      throw new ProviderLookupError(
        'crossref',
        'crossref.lookup',
        idempotencyKey,
        lookupKey,
        undefined,
        error instanceof Error ? error.message : 'Crossref lookup failed.',
      );
    }
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export class HeuristicCrossrefService implements CrossrefService {
  async lookup(fields: ExtractedFields, _options: ProviderLookupOptions = {}): Promise<ProviderRecord | null> {
    const doi =
      typeof fields.doi.value === 'string'
        ? normalizeDoi(fields.doi.value)
        : null;
    if (doi) return this.resolveDoi(doi, _options);

    if (typeof fields.title.value === 'string' && fields.title.value.trim()) {
      return {
        confidence: 0.76,
        fields: {
          url: `https://search.crossref.org/?q=${encodeURIComponent(fields.title.value)}`,
        },
      };
    }

    return null;
  }

  async resolveDoi(doi: string, _options: ProviderLookupOptions = {}): Promise<ProviderRecord | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;
    return getTestProviderRecordByDoi(normalized);
  }
}

export const crossrefService: CrossrefService =
  process.env.NODE_ENV === 'test'
    ? new HeuristicCrossrefService()
    : new RealCrossrefService();
