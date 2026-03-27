import type { ParsedReference } from '@shared/schema';

type ContainerField = 'journal' | 'conferenceTitle' | 'bookTitle';

const CONTAINER_FIELDS: readonly ContainerField[] = ['journal', 'conferenceTitle', 'bookTitle'];
const FLEX_DASH_PATTERN = '[-\\u2010-\\u2015]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlexibleTokenPattern(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.split(/[-\u2010-\u2015]/).map(escapeRegExp).join(`\\s*${FLEX_DASH_PATTERN}\\s*`))
    .join('\\s+');
}

function hasStructuredLocator(parsed: ParsedReference): boolean {
  return Boolean((parsed.pages && parsed.pages.trim()) || (parsed['article-number'] && parsed['article-number'].trim()));
}

function buildTrailingLocatorPatterns(parsed: ParsedReference): RegExp[] {
  const patterns: RegExp[] = [];
  const volumePattern = parsed.volume ? buildFlexibleTokenPattern(parsed.volume) : '';
  const issuePattern = parsed.issue ? buildFlexibleTokenPattern(parsed.issue) : '';
  const pagesPattern = parsed.pages ? buildFlexibleTokenPattern(parsed.pages) : '';
  const articleNumberPattern = parsed['article-number'] ? buildFlexibleTokenPattern(parsed['article-number']) : '';

  const locatorPattern = pagesPattern
    ? `(?:pp?\\.?\\s*)?${pagesPattern}`
    : articleNumberPattern
      ? `(?:article\\s+)?${articleNumberPattern}`
      : '';

  if (!locatorPattern) return patterns;

  if (volumePattern && issuePattern) {
    patterns.push(new RegExp(
      `[\\s,;:]+(?:vol(?:ume)?\\.?\\s*)?${volumePattern}\\s*\\(\\s*${issuePattern}\\s*\\)\\s*[:;,]?\\s*${locatorPattern}[.,;:]*$`,
      'iu',
    ));
    patterns.push(new RegExp(
      `[\\s,;:]+(?:vol(?:ume)?\\.?\\s*)?${volumePattern}\\s*,?\\s*(?:no\\.?|issue)\\s*${issuePattern}\\s*,?\\s*${locatorPattern}[.,;:]*$`,
      'iu',
    ));
    patterns.push(new RegExp(
      `[\\s,;:]+${volumePattern}\\s*\\(\\s*${issuePattern}\\s*\\)[.,;:]*$`,
      'iu',
    ));
  }

  if (volumePattern) {
    patterns.push(new RegExp(
      `[\\s,;:]+(?:vol(?:ume)?\\.?\\s*)?${volumePattern}\\s*[:;,]\\s*${locatorPattern}[.,;:]*$`,
      'iu',
    ));
    patterns.push(new RegExp(
      `[\\s,;:]+(?:vol(?:ume)?\\.?\\s*)?${volumePattern}\\s*,?\\s*${locatorPattern}[.,;:]*$`,
      'iu',
    ));
  }

  patterns.push(new RegExp(
    `[\\s,;:]+${locatorPattern}[.,;:]*$`,
    'iu',
  ));

  return patterns;
}

function stripStructuredLocatorTail(value: string, parsed: ParsedReference): string {
  if (!hasStructuredLocator(parsed)) return value;

  const trimmed = value.trim();
  if (!trimmed) return value;

  for (const pattern of buildTrailingLocatorPatterns(parsed)) {
    if (!pattern.test(trimmed)) continue;

    const cleaned = trimmed
      .replace(pattern, '')
      .replace(/[\s,;:]+$/u, '')
      .trim();

    if (/[\p{L}\p{N}]/u.test(cleaned)) {
      return cleaned;
    }
  }

  return value;
}

export function getStructuredLocatorContaminatedFields(parsed: ParsedReference): ContainerField[] {
  if (!hasStructuredLocator(parsed)) return [];

  return CONTAINER_FIELDS.filter((field) => {
    const value = parsed[field];
    return typeof value === 'string' && value.trim().length > 0 && stripStructuredLocatorTail(value, parsed) !== value;
  });
}

export function sanitizeStructuredLocatorContainers(parsed: ParsedReference): ParsedReference {
  const contaminatedFields = getStructuredLocatorContaminatedFields(parsed);
  if (contaminatedFields.length === 0) return parsed;

  const next: ParsedReference = { ...parsed };
  for (const field of contaminatedFields) {
    const value = next[field];
    if (typeof value === 'string') {
      next[field] = stripStructuredLocatorTail(value, parsed);
    }
  }
  return next;
}
