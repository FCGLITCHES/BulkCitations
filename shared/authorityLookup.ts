import type { ParsedReference, AuthorityData } from './schema';

export type AuthorityLookupResult =
  | { data: AuthorityData; status: 'cache_hit' | 'fetched' }
  | { data: null; status: 'no_match' | 'error' };

// Simple native LRU Cache implementation using a JS Map
// Maps preserve insertion order, so making an LRU is straightforward.
class LRUCache<K, V> {
    private cache: Map<K, V>;
    private maxItems: number;

    constructor(maxItems: number = 1000) {
        this.cache = new Map();
        this.maxItems = maxItems;
    }

    get(key: K): V | undefined {
        if (!this.cache.has(key)) return undefined;
        const val = this.cache.get(key)!;
        // Refresh position to 'recently used'
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }

    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxItems) {
            // Delete the least recently used item (the first one)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }
}

import pLimit from 'p-limit';

// Global server-side cache for authority lookup
const authorityCache = new LRUCache<string, AuthorityData | null>(500);

// Strict rate-limiter for Semantic Scholar (1 Req / Sec)
// We use a queue to ensure we dont exceed the tiered API limit even during bursts
const authorityLimit = pLimit(1); // One at a time
const WAIT_MS = 1000;

/**
 * Normalizes title for cache keying
 */
function getCacheKey(fields: ParsedReference): string {
    const titleStr = fields.title ? fields.title.toLowerCase().replace(/[^\w\s]/g, '').trim() : '';
    const yearStr = fields.year ? fields.year.trim() : '';
    // Combine title+year as key. If neither, fallback to entire string's hash (would need to pass raw text here, but title usually suffices)
    return `auth_${titleStr}_${yearStr}`;
}

/**
 * Extracts and maps Semantic Scholar API response to our unified AuthorityData type
 */
function mapSemanticScholarToAuthority(data: any): AuthorityData {
    const authors = data.authors ? data.authors.map((a: any) => a.name) : [];

    return {
        title: data.title || '',
        authors: authors.length > 0 ? authors : [],
        journal: data.venue || data.journal?.name || '',
        year: data.year ? data.year.toString() : undefined,
        url: data.url || undefined,
        pages: data.pages || undefined,
        volume: data.journal?.volume || undefined
    };
}

/**
 * Internal fetch implementation that enforces the 1s delay
 */
async function throttledFetch(apiUrl: string, headers: Record<string, string>): Promise<Response> {
    return authorityLimit(async () => {
        const res = await fetch(apiUrl, { method: 'GET', headers });
        // Enforce a hard sleep of 1 second after each request to respect the TPS limit
        await new Promise(resolve => setTimeout(resolve, WAIT_MS));
        return res;
    });
}

/**
 * Looks up citation metadata from Semantic Scholar's Graph API using Title and Authors.
 * Includes LRU caching to prevent duplicate external requests.
 * Returns { data, status } for trust + analytics (cache_hit | fetched | no_match | error).
 */
export async function getAuthorityData(fields: ParsedReference, options?: { force?: boolean }): Promise<AuthorityLookupResult> {
    // We need at least a title to make a meaningful search
    if (!fields.title) {
        return { data: null, status: 'no_match' };
    }

    const cacheKey = getCacheKey(fields);
    if (!options?.force) {
        const cached = authorityCache.get(cacheKey);
        if (cached !== undefined) {
            return cached
                ? { data: cached, status: 'cache_hit' }
                : { data: null, status: 'no_match' };
        }
    }

    // Construct query: "Title Author1 Author2"
    let queryParts = [fields.title];
    if (fields.authors && fields.authors.length > 0) {
        queryParts.push(fields.authors[0].split(',')[0]);
    }

    const query = encodeURIComponent(queryParts.join(' ').substring(0, 100));
    const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${query}&limit=1&fields=title,authors,year,venue,journal,url,pages`;

    try {
        const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (apiKey) headers['x-api-key'] = apiKey;

        const response = await throttledFetch(apiUrl, headers);

        if (!response.ok) {
            console.warn(`Semantic Scholar API failed with status ${response.status}`);
            authorityCache.set(cacheKey, null);
            return { data: null, status: 'error' };
        }

        const data = await response.json();

        if (data.data && data.data.length > 0) {
            const topResult = data.data[0];
            const mappedRecord = mapSemanticScholarToAuthority(topResult);
            authorityCache.set(cacheKey, mappedRecord);
            return { data: mappedRecord, status: 'fetched' };
        }
        authorityCache.set(cacheKey, null);
        return { data: null, status: 'no_match' };
    } catch (error) {
        console.warn("Semantic Scholar fetch error:", error);
        return { data: null, status: 'error' };
    }
}
