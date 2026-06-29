import type {
  CitationFeatureQuotedTitle,
  CitationFeatureYearMatch,
} from './types/extractionFeatures.js';
import type { StyleFamily } from './types/citation.js';

const DOI_REGEX = /10\.\d{4,9}\/[^\s"'<>]+/i;
const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;
const SMART_QUOTES_REGEX = /[“”„‟«»]/g;
const SMART_APOSTROPHE_REGEX = /[‘’‚‛]/g;
const EXTRACTION_INPUT_CACHE_LIMIT = 16_384;
const PARSEABLE_RAW_CACHE_LIMIT = 16_384;
const RAW_CITATION_SUPPORT_CACHE_LIMIT = 16_384;
const QUOTED_TITLE_CACHE_LIMIT = 16_384;
const YEAR_MATCH_CACHE_LIMIT = 16_384;

export interface RawCitationSupport {
  normalizedRaw: string;
  parseableRaw: string;
  quotedTitle: CitationFeatureQuotedTitle | null;
}

export function normalizeExtractionInput(value: string): string {
  return normalizeExtractionInputCached(value);
}

export function stripTrailingIdentifierTailForParsing(value: string): string {
  return stripTrailingIdentifierTailForParsingCached(value);
}

export function buildRawCitationSupport(raw: string): RawCitationSupport {
  return buildRawCitationSupportFromNormalizedRaw(normalizeExtractionInput(raw));
}

export function buildRawCitationSupportFromNormalizedRaw(
  normalizedRaw: string,
): RawCitationSupport {
  return buildRawCitationSupportCached(normalizedRaw);
}

export function findBestYearMatch(
  raw: string,
  family: StyleFamily,
): CitationFeatureYearMatch | null {
  return findBestYearMatchCached(composeCacheKey(family, raw));
}

export function findQuotedTitle(raw: string): CitationFeatureQuotedTitle | null {
  return findQuotedTitleCached(raw);
}

const normalizeExtractionInputCached = createBoundedStringCache(
  EXTRACTION_INPUT_CACHE_LIMIT,
  (value) =>
    value
      .normalize('NFKC')
      .replace(SMART_QUOTES_REGEX, '"')
      .replace(SMART_APOSTROPHE_REGEX, "'")
      .replace(/&amp;/gi, '&')
      // De-hyphenate mid-word line wraps ("communica-\ntion" -> "communication")
      // before collapsing whitespace, so wrapped/PDF input extracts as the joined
      // word. Runs at the extraction layer, downstream of the Phase-2 cleanup gate
      // (which stays off for single refs), and is a no-op on single-line input, so
      // existing corpora and benchmark field hashes are unaffected.
      .replace(/(\p{L})-\n[ \t]*(\p{Ll})/gu, '$1$2')
      .replace(/\s+/g, ' ')
      .trim(),
);

const stripTrailingIdentifierTailForParsingCached = createBoundedStringCache(
  PARSEABLE_RAW_CACHE_LIMIT,
  (value) =>
    value
      .replace(/\s+(?:Available at|Retrieved from|Accessed at|Accessed)\s*:?\s*https?:\/\/[^\s"'<>]+\.?$/iu, '')
      .replace(
        /\s+https?:\/\/[^\s"'<>]+\.?\s+(?:PMID|PMCID|ISBN(?:-1[03])?|ISSN|arXiv|Patent(?:\s+No\.?)?)\s*:?\s*[A-Za-z0-9./_-]+\.?$/iu,
        '',
      )
      .replace(/(?:,|;|\.)?\s*doi:\s*\.?$/iu, '')
      .replace(/(?:,|\.)?\s*(?:doi:\s*)?10\.\d{4,9}\/[^\s"'<>]+\.?$/iu, '')
      .replace(/(?:,|;|\.)?\s*https?:\/\/(?:dx\.)?doi\.org\/\.?$/iu, '')
      .replace(/(?:,|\.)?\s*https?:\/\/[^\s"'<>]+\.?$/iu, '')
      .trim()
      .replace(/[.,;:]\s*$/u, '')
      .trim(),
);

const buildRawCitationSupportCached = createBoundedValueCache<RawCitationSupport>(
  RAW_CITATION_SUPPORT_CACHE_LIMIT,
  (normalizedRaw) => {
    const parseableRaw = stripTrailingIdentifierTailForParsing(normalizedRaw);
    return {
      normalizedRaw,
      parseableRaw,
      quotedTitle: findQuotedTitle(parseableRaw),
    };
  },
);

const findQuotedTitleCached = createBoundedValueCache<CitationFeatureQuotedTitle | null>(
  QUOTED_TITLE_CACHE_LIMIT,
  (raw) => {
    const candidates: Array<CitationFeatureQuotedTitle & { score: number }> = [];
    const normalizedRaw = normalizeInlineQuoteCharacters(raw);
    const quoteIndexes = [...normalizedRaw.matchAll(/"/gu)]
      .map((match) => match.index ?? -1)
      .filter((index) => index >= 0);

    for (let leftIndex = 0; leftIndex < quoteIndexes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < quoteIndexes.length; rightIndex += 1) {
        const start = quoteIndexes[leftIndex]!;
        const endIndex = quoteIndexes[rightIndex]!;
        const title = normalizedRaw.slice(start + 1, endIndex).trim();
        if (!title || title.length < 3) {
          continue;
        }
        if (DOI_REGEX.test(title) || URL_REGEX.test(title)) {
          continue;
        }

        candidates.push({
          title,
          start,
          end: endIndex + 1,
          score: scoreQuotedTitleCandidate(title, normalizedRaw, start, endIndex + 1),
        });
      }
    }

    const bestCandidate = candidates.sort(
      (left, right) => right.score - left.score || right.title.length - left.title.length,
    )[0];

    if (!bestCandidate) {
      return null;
    }

    return {
      title: bestCandidate.title,
      start: bestCandidate.start,
      end: bestCandidate.end,
    };
  },
);

const findBestYearMatchCached = createBoundedValueCache<CitationFeatureYearMatch | null>(
  YEAR_MATCH_CACHE_LIMIT,
  (cacheKey) => {
    const [family = 'author_date', raw = ''] = cacheKey.split('\u0000');
    const matches = [...raw.matchAll(/\b(\d{4})[a-z]?\b/giu)]
      .map((match) => {
        const matchText = match[0];
        const index = match.index ?? -1;
        const year = Number(match[1]);
        const before = raw.slice(Math.max(0, index - 24), index).toLowerCase();
        const after = raw
          .slice(index + matchText.length, Math.min(raw.length, index + matchText.length + 24))
          .toLowerCase();
        const context = raw
          .slice(Math.max(0, index - 32), Math.min(raw.length, index + matchText.length + 32))
          .toLowerCase();
        const prevChar = index > 0 ? (raw[index - 1] ?? '') : '';
        const nextChar = raw[index + matchText.length] ?? '';
        let score = 0;

        if (prevChar === '(' && nextChar === ')') score += 4;
        if (family === 'author_date' && index < 120) score += 3;
        if (family !== 'author_date' && index > raw.length * 0.45) score += 3;
        if (/[;:,)]\s*$/.test(before)) score += 1;
        if (/^\s*[;:.,)]/.test(after)) score += 1;
        if (/[–-]/.test(prevChar) || /[–-]/.test(nextChar)) score -= 5;
        if (/\b(?:vol|volume|issue|no)\.?\s*$/u.test(before)) score -= 4;
        if (/\b(?:accessed|retrieved|available at)\b/u.test(before)) score -= 5;
        if (/\b(?:ed|edition)\b/u.test(after)) score -= 4;
        if (/\b(?:doi|https?:\/\/|doi\.org\/|arxiv|isbn|issn|handle\.net|patent)\b/u.test(context)) score -= 7;
        if (/[\/_.]/.test(prevChar) || /[\/_.]/.test(nextChar)) score -= 4;
        if (/\.\d{3,}/u.test(after) || /\d{3,}\./u.test(before)) score -= 3;

        return { matchText, index, year, score };
      })
      .filter((candidate) => candidate.index >= 0);

    if (matches.length === 0) {
      return null;
    }

    matches.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return family === 'author_date' ? left.index - right.index : right.index - left.index;
    });

    const best = matches[0];
    if (!best) {
      return null;
    }

    return {
      matchText: best.matchText,
      index: best.index,
      year: best.year,
    };
  },
);

function composeCacheKey(...parts: Array<string | null | undefined>): string {
  return parts.map((part) => part ?? '').join('\u0000');
}

function scoreQuotedTitleCandidate(
  title: string,
  raw: string,
  start: number,
  end: number,
): number {
  let score = title.length;
  const normalized = normalizeComparableText(title);
  if (normalized.split(' ').length >= 3) score += 12;
  if (/[.?!]$/.test(title)) score += 4;
  if (/[,;:]/u.test(title)) score += 2;
  if (/\p{L}/u.test(title)) score += 4;

  const prefix = raw.slice(0, start);
  const suffix = raw.slice(end);
  if (/\b(?:19|20)\d{2}\b/u.test(prefix)) score += 2;
  if (/^\s*[,.;:]/u.test(suffix)) score += 2;

  return score;
}

function normalizeInlineQuoteCharacters(value: string): string {
  return value.replace(/[“”«»]/gu, '"');
}

function normalizeComparableText(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function createBoundedValueCache<TValue>(
  limit: number,
  compute: (value: string) => TValue,
): (value: string) => TValue {
  const cache = new Map<string, TValue>();
  return (value: string) => {
    if (cache.has(value)) {
      return cache.get(value) as TValue;
    }
    const result = compute(value);
    cache.set(value, result);
    evictOldestCacheEntry(cache, limit);
    return result;
  };
}

function createBoundedStringCache(
  limit: number,
  compute: (value: string) => string,
): (value: string) => string {
  const cache = new Map<string, string>();
  return (value: string) => {
    const cached = cache.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const result = compute(value);
    cache.set(value, result);
    evictOldestCacheEntry(cache, limit);
    return result;
  };
}

function evictOldestCacheEntry<TValue>(cache: Map<string, TValue>, limit: number): void {
  if (cache.size <= limit) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}
