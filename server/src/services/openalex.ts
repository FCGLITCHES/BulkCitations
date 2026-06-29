import { createHash } from 'node:crypto';
import type { ExtractedFields } from '../engine/types/citation.js';
import type { ProviderRecord } from './crossref.js';
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

export interface OpenAlexService {
  lookup(fields: ExtractedFields, options?: ProviderLookupOptions): Promise<ProviderRecord | null>;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

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

interface OpenAlexAuthorship {
  author?: { display_name?: string };
}

interface OpenAlexWork {
  display_name?: string;
  title?: string;
  publication_year?: number;
  doi?: string;
  primary_location?: {
    source?: { display_name?: string };
  };
  open_access?: { oa_url?: string };
  authorships?: OpenAlexAuthorship[];
  cited_by_count?: number;
  type?: string;
}

function parseAuthorName(displayName: string): {
  family: string;
  given: string | null;
} {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] ?? displayName, given: null };
  const family = parts.at(-1) ?? displayName;
  const given = parts.slice(0, -1).join(' ');
  return { family, given };
}

function mapWorkToRecord(
  work: OpenAlexWork,
  confidence: number,
): ProviderRecord {
  const title = work.display_name ?? work.title ?? null;
  const year = work.publication_year ?? null;
  const journal = work.primary_location?.source?.display_name ?? null;

  const rawDoi = work.doi ?? null;
  const doi = rawDoi
    ? rawDoi.replace(/^https?:\/\/doi\.org\//i, '')
    : null;
  const url = rawDoi ?? (doi ? `https://doi.org/${doi}` : null);
  const openAccessUrl = work.open_access?.oa_url ?? null;

  const authors = work.authorships
    ?.map((a) => a.author?.display_name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .map(parseAuthorName);

  const record: ProviderRecord = {
    confidence,
    fields: {
      title,
      year,
      journal,
      doi,
      url: openAccessUrl ?? url,
      database: 'OpenAlex',
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

export class RealOpenAlexService implements OpenAlexService {
  private readonly timeoutMs = env.OPENALEX_TIMEOUT_MS;

  async lookup(fields: ExtractedFields, options: ProviderLookupOptions = {}): Promise<ProviderRecord | null> {
    const rawDoi =
      typeof fields.doi.value === 'string'
        ? normalizeDoi(fields.doi.value)
        : null;

    if (rawDoi) {
      const lookupKey = options.lookupKey ?? `doi:${rawDoi}`;
      return this.lookupByDoi(rawDoi, { ...options, lookupKey });
    }

    const title =
      typeof fields.title.value === 'string'
        ? fields.title.value.trim()
        : null;

    if (!title) return null;

    return this.searchByTitle(title, options);
  }

  private async lookupByDoi(doi: string, options: ProviderLookupOptions = {}): Promise<ProviderRecord | null> {
    const cacheKey = redisKeys.openalexDoi(doi);
    const lookupKey = options.lookupKey ?? `doi:${doi}`;
    const idempotencyKey = options.idempotencyKey ?? buildProviderIdempotencyKey('openalex', lookupKey);
    const retryAttempts = options.retryAttempts ?? env.OPENALEX_RETRY_ATTEMPTS;
    const retryDelayMs = options.retryDelayMs ?? env.OPENALEX_RETRY_BASE_DELAY_MS;

    try {
      return await cachedGet<ProviderRecord>(cacheKey, redisTtl.openalexDoi, async () => {
        const params = new URLSearchParams();
        if (env.CROSSREF_EMAIL) params.set('mailto', env.CROSSREF_EMAIL);

        const qs = params.toString();
        const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}${qs ? `?${qs}` : ''}`;

        const response = await instrumentedFetch({
          provider: 'openalex',
          route: 'openalex.lookupByDoi',
          method: 'GET',
          url,
          headers: {
            Accept: 'application/json',
            'x-idempotency-key': idempotencyKey,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
          retryAttempts,
          retryDelayMs,
          expectedContentTypes: ['application/json'],
        });

        if (!response.ok) {
          if (RETRYABLE_STATUS_CODES.has(response.status)) {
            throw new ProviderLookupError(
              'openalex',
              'openalex.lookupByDoi',
              idempotencyKey,
              lookupKey,
              response.status,
              `OpenAlex DOI lookup failed with status ${response.status}.`,
            );
          }
          return null;
        }

        const work = (await response.json()) as OpenAlexWork;
        if (!work.display_name && !work.title) return null;

        return mapWorkToRecord(work, 0.93);
      });
    } catch (error) {
      if (error instanceof ProviderLookupError) {
        throw error;
      }
      if (error instanceof OutboundFetchError) {
        throw new ProviderLookupError(
          'openalex',
          'openalex.lookupByDoi',
          idempotencyKey,
          lookupKey,
          error.statusCode,
          error.message,
        );
      }
      throw new ProviderLookupError(
        'openalex',
        'openalex.lookupByDoi',
        idempotencyKey,
        lookupKey,
        undefined,
        error instanceof Error ? error.message : 'OpenAlex DOI lookup failed.',
      );
    }
  }

  private async searchByTitle(title: string, options: ProviderLookupOptions = {}): Promise<ProviderRecord | null> {
    const queryHash = hashQuery(title);
    const cacheKey = redisKeys.openalexSearch(queryHash);
    const lookupKey = options.lookupKey ?? `title:${queryHash}`;
    const idempotencyKey = options.idempotencyKey ?? buildProviderIdempotencyKey('openalex', lookupKey);
    const retryAttempts = options.retryAttempts ?? env.OPENALEX_RETRY_ATTEMPTS;
    const retryDelayMs = options.retryDelayMs ?? env.OPENALEX_RETRY_BASE_DELAY_MS;

    try {
      return await cachedGet<ProviderRecord>(
        cacheKey,
        redisTtl.openalexSearch,
        async () => {
          const params = new URLSearchParams({
            search: title,
            per_page: '1',
          });

          if (env.CROSSREF_EMAIL) params.set('mailto', env.CROSSREF_EMAIL);

          const url = `https://api.openalex.org/works?${params.toString()}`;

          const response = await instrumentedFetch({
            provider: 'openalex',
            route: 'openalex.searchByTitle',
            method: 'GET',
            url,
            headers: {
              Accept: 'application/json',
              'x-idempotency-key': idempotencyKey,
            },
            signal: AbortSignal.timeout(this.timeoutMs),
            retryAttempts,
            retryDelayMs,
            expectedContentTypes: ['application/json'],
          });

          if (!response.ok) {
            if (RETRYABLE_STATUS_CODES.has(response.status)) {
              throw new ProviderLookupError(
                'openalex',
                'openalex.searchByTitle',
                idempotencyKey,
                lookupKey,
                response.status,
                `OpenAlex title lookup failed with status ${response.status}.`,
              );
            }
            return null;
          }

          const json = (await response.json()) as {
            results?: OpenAlexWork[];
          };

          const work = json.results?.[0];
          if (!work) return null;

          return mapWorkToRecord(work, 0.78);
        },
      );
    } catch (error) {
      if (error instanceof ProviderLookupError) {
        throw error;
      }
      if (error instanceof OutboundFetchError) {
        throw new ProviderLookupError(
          'openalex',
          'openalex.searchByTitle',
          idempotencyKey,
          lookupKey,
          error.statusCode,
          error.message,
        );
      }
      throw new ProviderLookupError(
        'openalex',
        'openalex.searchByTitle',
        idempotencyKey,
        lookupKey,
        undefined,
        error instanceof Error ? error.message : 'OpenAlex title lookup failed.',
      );
    }
  }
}

export class HeuristicOpenAlexService implements OpenAlexService {
  async lookup(fields: ExtractedFields, _options: ProviderLookupOptions = {}): Promise<ProviderRecord | null> {
    if (typeof fields.doi.value === 'string' && fields.doi.value.trim()) {
      return getTestProviderRecordByDoi(fields.doi.value);
    }

    if (
      typeof fields.journal.value === 'string' &&
      fields.journal.value.trim()
    ) {
      return {
        confidence: 0.72,
        fields: {
          database: 'OpenAlex',
        },
      };
    }

    return null;
  }
}

export const openAlexService: OpenAlexService =
  process.env.NODE_ENV === 'test'
    ? new HeuristicOpenAlexService()
    : new RealOpenAlexService();
