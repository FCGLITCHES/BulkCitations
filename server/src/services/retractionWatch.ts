import { env } from '../config.js';
import { getFromCache, setInCache } from './cache.js';
import { instrumentedFetch, mapOutboundFetchError } from './instrumentedFetch.js';

export interface RetractionCheckResult {
  retracted: boolean;
  expressionOfConcern: boolean;
  date?: string;
  reason?: string;
}

export interface RetractionWatchService {
  check(doi: string): Promise<RetractionCheckResult | null>;
}

const CACHE_PREFIX = 'retraction:';
const CACHE_TTL_SECONDS = 604_800; // 7 days

interface CrossrefUpdateTo {
  type?: string;
  label?: string;
  updated?: { 'date-time'?: string };
  DOI?: string;
}

interface CrossrefRelation {
  'is-retracted-by'?: unknown[];
}

interface CrossrefWork {
  type?: string;
  'update-to'?: CrossrefUpdateTo[];
  relation?: CrossrefRelation;
}

function parseRetractionFromWork(work: CrossrefWork): RetractionCheckResult {
  let retracted = false;
  let expressionOfConcern = false;
  let date: string | undefined;
  let reason: string | undefined;

  if (work.type === 'retracted-article') {
    retracted = true;
  }

  if (
    work.relation?.['is-retracted-by'] &&
    Array.isArray(work.relation['is-retracted-by']) &&
    work.relation['is-retracted-by'].length > 0
  ) {
    retracted = true;
  }

  if (Array.isArray(work['update-to'])) {
    for (const update of work['update-to']) {
      const t = update.type?.toLowerCase() ?? '';
      if (t === 'retraction' || t.includes('retract')) {
        retracted = true;
        date ??= update.updated?.['date-time'];
        reason ??= update.label;
      }
      if (t === 'expression-of-concern' || t.includes('concern')) {
        expressionOfConcern = true;
        date ??= update.updated?.['date-time'];
        reason ??= update.label;
      }
    }
  }

  const result: RetractionCheckResult = { retracted, expressionOfConcern };
  if (date !== undefined) result.date = date;
  if (reason !== undefined) result.reason = reason;
  return result;
}

class CrossrefRetractionWatchService implements RetractionWatchService {
  async check(doi: string): Promise<RetractionCheckResult | null> {
    const cacheKey = `${CACHE_PREFIX}${doi}`;

    try {
      const cached = await getFromCache<RetractionCheckResult>(cacheKey);
      if (cached) return cached;
    } catch {
      // cache miss — proceed to network
    }

    try {
      const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (env.CROSSREF_EMAIL) {
        headers['User-Agent'] = `BulkReferences/1.0 (mailto:${env.CROSSREF_EMAIL})`;
      }

      const res = await instrumentedFetch({
        provider: 'crossref',
        route: '/works/:doi',
        method: 'GET',
        url,
        headers,
        timeoutMs: env.RETRACTION_WATCH_TIMEOUT_MS,
        expectedContentTypes: ['application/json'],
      });

      if (!res.ok) return null;

      const body = (await res.json()) as { message?: CrossrefWork };
      if (!body.message) return null;

      const result = parseRetractionFromWork(body.message);

      await setInCache(cacheKey, result, CACHE_TTL_SECONDS).catch(() => {});

      return result;
    } catch (err: unknown) {
      const mapped = mapOutboundFetchError(
        err,
        'Retraction watch lookup failed.',
      );
      process.stderr.write(
        `[retractionWatch] check failed for ${doi}: ${mapped.code} (${mapped.statusCode}) ${mapped.message}\n`,
      );
      return null;
    }
  }
}

class NoopRetractionWatchService implements RetractionWatchService {
  async check(_doi: string): Promise<RetractionCheckResult | null> {
    return null;
  }
}

export const retractionWatchService: RetractionWatchService =
  process.env.NODE_ENV === 'test'
    ? new NoopRetractionWatchService()
    : new CrossrefRetractionWatchService();
