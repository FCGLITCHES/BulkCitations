import { ParsedReference } from '@shared/schema';

/**
 * DOI Metadata Enrichment via Crossref API
 * 
 * When a DOI is present in a parsed citation, we can fetch the authoritative
 * metadata from Crossref to fill in or correct any fields our regex parser
 * may have missed or gotten wrong.
 * 
 * Pipeline:
 *   1. Parser extracts DOI from free text
 *   2. This service fetches Crossref metadata for that DOI
 *   3. Crossref CSL-JSON is merged with our parsed data
 *   4. Result goes to citeproc for formatting
 * 
 * Benefits:
 *   - Fills missing fields (volume, issue, pages, full journal name)
 *   - Corrects author names (proper casing, full given names)
 *   - Provides correct title casing
 *   - Adds ISSN, publisher, and other metadata
 *   - Turns "partial/dirty" inputs into complete citations
 */

// Simple in-memory cache to avoid re-fetching DOIs
const doiCache = new Map<string, Record<string, any>>();

// Rate limiting: Crossref asks for max ~50 req/s for polite pool
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL_MS = 100; // 10 req/s max

/**
 * Fetch CSL-JSON metadata from Crossref for a given DOI.
 * Returns the CSL-JSON object or null if not found/error.
 */
export async function fetchCrossrefMetadata(doi: string): Promise<Record<string, any> | null> {
    // Normalize DOI
    const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '')
        .replace(/^doi:\s*/i, '')
        .trim();

    if (!cleanDoi) return null;

    // Check cache
    if (doiCache.has(cleanDoi)) {
        return doiCache.get(cleanDoi)!;
    }

    // Rate limiting
    const now = Date.now();
    const elapsed = now - lastFetchTime;
    if (elapsed < MIN_FETCH_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_FETCH_INTERVAL_MS - elapsed));
    }
    lastFetchTime = Date.now();

    try {
        // Crossref content negotiation: request CSL-JSON directly
        const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`, {
            headers: {
                'Accept': 'application/json',
                // Polite pool: identify ourselves for better rate limits
                'User-Agent': 'CitingApp/1.0 (mailto:noreply@citing.app)',
            },
            signal: AbortSignal.timeout(5000), // 5s timeout
        });

        if (!response.ok) {
            console.warn(`Crossref API returned ${response.status} for DOI: ${cleanDoi}`);
            return null;
        }

        const data = await response.json();
        const message = data.message;

        if (!message) return null;

        // Convert Crossref response to CSL-JSON-like structure
        const cslData = crossrefToCSL(message, cleanDoi);

        // Cache the result
        doiCache.set(cleanDoi, cslData);

        return cslData;
    } catch (error) {
        console.warn(`Crossref fetch failed for DOI ${cleanDoi}:`, error);
        return null;
    }
}

/**
 * Convert Crossref API response to a CSL-JSON-compatible object.
 */
function crossrefToCSL(message: any, doi: string): Record<string, any> {
    const csl: Record<string, any> = {
        DOI: doi,
    };

    // Type mapping
    const typeMap: Record<string, string> = {
        'journal-article': 'article-journal',
        'book': 'book',
        'book-chapter': 'chapter',
        'proceedings-article': 'paper-conference',
        'report': 'report',
        'thesis': 'thesis',
        'dataset': 'dataset',
        'monograph': 'book',
        'edited-book': 'book',
    };
    csl.type = typeMap[message.type] || 'article-journal';

    // Title
    if (message.title && message.title.length > 0) {
        csl.title = message.title[0];
    }

    // Authors
    if (message.author && message.author.length > 0) {
        csl.author = message.author.map((a: any) => {
            if (a.name) {
                // Organization author
                return { literal: a.name };
            }
            return {
                family: a.family || '',
                given: a.given || '',
            };
        });
    }

    // Published date
    const dateSource = message['published-print'] || message['published-online'] || message['published'];
    if (dateSource && dateSource['date-parts'] && dateSource['date-parts'][0]) {
        csl.issued = { 'date-parts': [dateSource['date-parts'][0]] };
    }

    // Container (journal/book title)
    if (message['container-title'] && message['container-title'].length > 0) {
        // Use full title (first entry), short title is usually second
        csl['container-title'] = message['container-title'][0];
    }

    // Volume
    if (message.volume) {
        csl.volume = message.volume;
    }

    // Issue
    if (message.issue) {
        csl.issue = message.issue;
    }

    // Pages
    if (message.page) {
        csl.page = message.page;
    }

    // Article number
    if (message['article-number']) {
        csl.number = message['article-number'];
    }

    // Publisher
    if (message.publisher) {
        csl.publisher = message.publisher;
    }

    // ISSN
    if (message.ISSN && message.ISSN.length > 0) {
        csl.ISSN = message.ISSN[0];
    }

    // URL
    if (message.URL) {
        csl.URL = message.URL;
    }

    // Short container title (abbreviation)
    if (message['short-container-title'] && message['short-container-title'].length > 0) {
        csl['container-title-short'] = message['short-container-title'][0];
    }

    return csl;
}

/**
 * Merge Crossref metadata with our parser output.
 * Strategy: Crossref is authoritative for structured fields,
 * but we keep parser data as fallback for anything Crossref doesn't have.
 * 
 * @param parserCSL  - CSL-JSON from our regex parser
 * @param crossrefCSL - CSL-JSON from Crossref API
 * @returns Merged CSL-JSON with Crossref data taking priority
 */
export function mergeCSLData(
    parserCSL: Record<string, any>,
    crossrefCSL: Record<string, any>
): Record<string, any> {
    const merged = { ...parserCSL };

    // Crossref-authoritative fields (always prefer Crossref when available)
    const authoritativeFields = [
        'title', 'author', 'issued', 'volume', 'issue',
        'page', 'number', 'DOI', 'publisher', 'publisher-place', 'edition',
        'ISSN', 'container-title-short',
    ];

    for (const field of authoritativeFields) {
        if (crossrefCSL[field] !== undefined && crossrefCSL[field] !== null && crossrefCSL[field] !== '') {
            merged[field] = crossrefCSL[field];
        }
    }

    // Container-title: prefer the LONGER value (full name over abbreviation)
    if (crossrefCSL['container-title']) {
        const parserTitle = (parserCSL['container-title'] || '').toString();
        const crossrefTitle = crossrefCSL['container-title'].toString();
        // Use the longer one — it's more likely to be the full journal name
        merged['container-title'] = crossrefTitle.length >= parserTitle.length ? crossrefTitle : parserTitle;
    }

    // Type: prefer Crossref's type if available
    if (crossrefCSL.type) {
        merged.type = crossrefCSL.type;
    }

    // Keep the ID from parser
    merged.id = parserCSL.id;

    return merged;
}

/**
 * Extract a DOI from a parsed reference.
 * Checks the `doi` field and falls back to URL pattern matching.
 */
export function extractDOI(parsed: ParsedReference): string | null {
    if (parsed.doi) {
        return parsed.doi.replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:\s*/i, '');
    }

    // Check if URL contains a DOI
    if (parsed.url) {
        const doiUrlMatch = parsed.url.match(/doi\.org\/(.+)$/i);
        if (doiUrlMatch) {
            return doiUrlMatch[1];
        }
    }

    return null;
}
