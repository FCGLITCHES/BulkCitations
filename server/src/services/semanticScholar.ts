import type { ExtractedFields } from '../engine/types/citation.js';
import { env } from '../config.js';
import { instrumentedFetch } from './instrumentedFetch.js';
import type { ProviderRecord } from './crossref.js';

/** Minimum spacing between outbound Semantic Scholar calls (1/s; conservative for API key tier). */
const MIN_INTERVAL_MS = 1000;

let chain: Promise<unknown> = Promise.resolve();
let lastCallEnd = 0;

function enqueueSemanticScholar<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(async () => {
    const wait =
      lastCallEnd === 0
        ? 0
        : Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallEnd));
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      return await fn();
    } finally {
      lastCallEnd = Date.now();
    }
  });
  chain = p.then(() => undefined, () => undefined);
  return p as Promise<T>;
}

function buildSearchQuery(fields: ExtractedFields): string | null {
  const title = typeof fields.title.value === 'string' ? fields.title.value.trim() : '';
  if (!title) return null;

  const authors = fields.authors.value;
  let firstAuthor = '';
  if (Array.isArray(authors) && authors.length > 0) {
    const a = authors[0]!;
    firstAuthor = (a.family ?? a.literal ?? '').split(',')[0]?.trim() ?? '';
  }

  const q = [title, firstAuthor].filter(Boolean).join(' ').slice(0, 280);
  return q.length > 0 ? q : null;
}

function mapPaperToRecord(paper: Record<string, unknown>): ProviderRecord | null {
  const title = typeof paper.title === 'string' ? paper.title : null;
  if (!title) return null;

  const year = typeof paper.year === 'number' ? paper.year : null;
  const venue =
    typeof paper.venue === 'string'
      ? paper.venue
      : typeof (paper.journal as { name?: string } | undefined)?.name === 'string'
        ? (paper.journal as { name: string }).name
        : null;
  const url = typeof paper.url === 'string' ? paper.url : null;
  const pages = typeof paper.pages === 'string' ? paper.pages : null;

  const rawAuthors = paper.authors as Array<{ name?: string }> | undefined;
  const authors = rawAuthors
    ?.map((a) => {
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      if (!name) return null;
      const parts = name.split(/\s+/);
      const family = parts.length > 1 ? parts[parts.length - 1]! : name;
      const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : null;
      return { family, given };
    })
    .filter((a): a is { family: string; given: string | null } => a != null);

  const confidence = 0.72;

  return {
    confidence,
    fields: {
      title,
      year,
      journal: venue,
      url,
      pages,
    },
    ...(authors && authors.length > 0 ? { authors } : {}),
  };
}

export interface SemanticScholarService {
  lookupLastResort(fields: ExtractedFields): Promise<ProviderRecord | null>;
}

class SemanticScholarServiceImpl implements SemanticScholarService {
  async lookupLastResort(fields: ExtractedFields): Promise<ProviderRecord | null> {
    const apiKey = env.SEMANTIC_SCHOLAR_API_KEY?.trim();
    if (!apiKey) {
      return null;
    }

    const query = buildSearchQuery(fields);
    if (!query) return null;

    return enqueueSemanticScholar(async () => {
      const params = new URLSearchParams({
        query,
        limit: '1',
        fields: 'title,authors,year,venue,journal,url,pages',
      });
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`;

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'x-api-key': apiKey,
      };

      const response = await instrumentedFetch({
        provider: 'other',
        route: 'semantic_scholar.search',
        method: 'GET',
        url,
        headers,
      });

      if (!response.ok) {
        return null;
      }

      const json = (await response.json()) as { data?: Record<string, unknown>[] };
      const top = json.data?.[0];
      if (!top) return null;

      return mapPaperToRecord(top);
    });
  }
}

export const semanticScholarService: SemanticScholarService = new SemanticScholarServiceImpl();
