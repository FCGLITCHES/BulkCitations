import type { CanonicalAuthor, ExtractedFields } from './types/citation.js';
import {
  isValidArxiv,
  isValidDoi,
  isValidHandle,
  isValidIsbn,
  isValidIssn,
  isValidPatent,
  isValidPmid,
} from './identifierUtils.js';

// Tokens that are placeholders for a *missing* value rather than real content.
// Includes the bare structural words ("journal", "vol", "issue") and the "?"
// marker that upstream bibliographies emit for unknown containers/locators —
// kept in sync with the frontend PLACEHOLDER_VALUES set. Anchored so it only
// matches a field that is *entirely* a placeholder (never "Journal of …").
const PLACEHOLDER_REGEX =
  /^(unknown|untitled|n\/a|na|none|null|placeholder|tbd|to be determined|\?|journal|vol\.?|issue|n\.d\.|s\.n\.|\[s\.n\.\])$/i;

export function isValidYear(value: unknown, currentYear = new Date().getFullYear()): boolean {
  const year =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.match(/\b(\d{4})\b/)?.[1] ?? Number.NaN)
        : Number.NaN;

  return Number.isInteger(year) && year >= 1000 && year <= currentYear;
}

export function isValidUrl(value: unknown): boolean {
  const url = trimmedString(value);
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export {
  isValidArxiv,
  isValidDoi,
  isValidHandle,
  isValidIsbn,
  isValidIssn,
  isValidPatent,
  isValidPmid,
};

export function isValidLocatorPages(value: unknown): boolean {
  const normalized = cleanLocatorLabel(trimmedString(value));
  if (!normalized) return false;

  if (/^[a-z]?\d+$/iu.test(normalized)) return true;
  if (/^[a-z]?\d+\s*[-–]\s*[a-z]?\d+$/iu.test(normalized)) {
    const [startRaw, endRaw] = normalized.split(/[-–]/u);
    const start = Number(startRaw?.replace(/[^\d]/gu, ''));
    const end = Number(endRaw?.replace(/[^\d]/gu, ''));
    return Number.isFinite(start) && Number.isFinite(end) && start <= end;
  }

  return false;
}

export function isValidArticleNumber(value: unknown): boolean {
  const normalized = cleanLocatorLabel(trimmedString(value));
  if (!normalized) return false;

  return /\d/u.test(normalized) && /^[\p{L}\p{N}][\p{L}\p{N}_.:/()+-]{0,80}$/u.test(normalized);
}

export function isValidReportNumber(value: unknown): boolean {
  const normalized = trimmedString(value);
  return Boolean(normalized && /[a-z0-9]/iu.test(normalized));
}

export function isValidAuthorList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((author) => isValidCanonicalAuthor(author));
}

export function isPlaceholderLikeValue(value: unknown): boolean {
  const normalized = trimmedString(value);
  return Boolean(normalized && PLACEHOLDER_REGEX.test(normalized));
}

export function validateMandatoryField(
  field: keyof ExtractedFields,
  value: ExtractedFields[keyof ExtractedFields]['value'],
): { valid: boolean; reason?: string } {
  switch (field) {
    case 'authors':
    case 'editors':
      return isValidAuthorList(value)
        ? { valid: true }
        : { valid: false, reason: `invalid ${String(field)} value` };
    case 'year':
      return isValidYear(value) ? { valid: true } : { valid: false, reason: 'invalid year value' };
    case 'doi':
      return isValidDoi(value) ? { valid: true } : { valid: false, reason: 'invalid DOI format' };
    case 'pmid':
      return isValidPmid(value) ? { valid: true } : { valid: false, reason: 'invalid PMID format' };
    case 'arxiv':
      return isValidArxiv(value)
        ? { valid: true }
        : { valid: false, reason: 'invalid arXiv format' };
    case 'isbn':
      return isValidIsbn(value) ? { valid: true } : { valid: false, reason: 'invalid ISBN format' };
    case 'issn':
      return isValidIssn(value) ? { valid: true } : { valid: false, reason: 'invalid ISSN format' };
    case 'handle':
      return isValidHandle(value)
        ? { valid: true }
        : { valid: false, reason: 'invalid Handle format' };
    case 'patent':
      return isValidPatent(value)
        ? { valid: true }
        : { valid: false, reason: 'invalid patent identifier' };
    case 'url':
      return isValidUrl(value) ? { valid: true } : { valid: false, reason: 'invalid URL format' };
    case 'pages':
      return isValidLocatorPages(value)
        ? { valid: true }
        : { valid: false, reason: 'invalid pages locator' };
    case 'articleNumber':
      return isValidArticleNumber(value)
        ? { valid: true }
        : { valid: false, reason: 'invalid articleNumber locator' };
    case 'reportNumber':
      return isValidReportNumber(value)
        ? { valid: true }
        : { valid: false, reason: 'invalid report number' };
    case 'title':
    case 'journal':
    case 'conferenceTitle':
    case 'bookTitle':
    case 'siteName':
    case 'publisher':
    case 'institution':
    case 'repository':
      return typeof value === 'string' && value.trim().length > 0 && !isPlaceholderLikeValue(value)
        ? { valid: true }
        : { valid: false, reason: `invalid ${String(field)} value` };
    default:
      return hasNonEmptyValue(value)
        ? { valid: true }
        : { valid: false, reason: `invalid ${String(field)} value` };
  }
}

function hasNonEmptyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value != null;
}

export function isValidCanonicalAuthor(value: unknown): value is CanonicalAuthor {
  if (typeof value !== 'object' || value == null) return false;

  const author = value as Partial<CanonicalAuthor>;
  const family = trimmedString(author.family);
  const given = trimmedString(author.given);
  const initials = trimmedString(author.initials);
  const literal = trimmedString(author.literal);

  if (author.isCorporate) {
    return Boolean(literal || family);
  }

  if (!family || /^et\s+al\.?$/iu.test(family) || /^[,.;]+$/u.test(family)) return false;
  if (/^[A-Z]\.?$/iu.test(family) && !(given || initials)) return false;
  return true;
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function cleanLocatorLabel(value: string | null): string | null {
  if (!value) return null;

  const cleaned = value
    .replace(/^pages?:\s*/iu, '')
    .replace(/^pp?\.?:?\s*/iu, '')
    .replace(/^article(?:\s+(?:no\.?|number))?:\s*/iu, '')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}
