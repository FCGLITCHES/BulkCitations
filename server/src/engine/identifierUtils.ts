const DOI_REGEX = /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i;
const PMID_REGEX = /^[1-9]\d{0,8}$/;
const PMCID_REGEX = /^PMC\d+$/i;
const ARXIV_ID_REGEX = /^((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)$/i;
const ISBN_CLEAN_REGEX = /^[0-9]{9}[0-9X]$|^(?:97[89])[0-9]{10}$/i;
const ISSN_CLEAN_REGEX = /^[0-9]{7}[0-9X]$/i;
const HANDLE_REGEX = /^\d+(?:\.\d+)*\/\S+$/;
const PATENT_REGEX =
  /\b((?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)\s*)?(?:RE|PP|D)?\s*\d{6,}[A-Z0-9/-]*\b/i;
const NON_SPECIFIC_PROPAGATION_URL_HOSTS = new Set([
  'doi.org',
  'dx.doi.org',
  'handle.net',
  'hdl.handle.net',
  'arxiv.org',
  'www.arxiv.org',
  'patents.google.com',
]);

type IdentifierField = 'doi' | 'pmid' | 'pmcid' | 'arxiv' | 'isbn' | 'issn' | 'handle' | 'patent';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stringInput(value: unknown, allowNumber = false): string | null {
  if (typeof value === 'string') return value.trim();
  if (allowNumber && typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function stripTerminalCitationPunctuation(value: string): string {
  let normalized = value
    .trim()
    .replace(/^<(.+)>$/u, '$1')
    .replace(/[?#].*$/u, '');

  while (/[.,;:]$/u.test(normalized)) {
    normalized = normalized.slice(0, -1).trimEnd();
  }

  while (normalized.endsWith(')') && countChar(normalized, '(') < countChar(normalized, ')')) {
    normalized = normalized.slice(0, -1).trimEnd();
  }

  while (normalized.endsWith(']') && countChar(normalized, '[') < countChar(normalized, ']')) {
    normalized = normalized.slice(0, -1).trimEnd();
  }

  return normalized;
}

function countChar(value: string, char: string): number {
  return value.split(char).length - 1;
}

export function normalizeDoi(value: unknown): string | null {
  const input = stringInput(value);
  if (!input) return null;

  const normalized = stripTerminalCitationPunctuation(
    input.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, ''),
  ).toLowerCase();

  return DOI_REGEX.test(normalized) ? normalized : null;
}

export function isValidDoi(value: unknown): boolean {
  return normalizeDoi(value) != null;
}

export function normalizePmid(value: unknown): string | null {
  const input = stringInput(value, true);
  if (!input) return null;

  const normalized = stripTerminalCitationPunctuation(input.replace(/^pmid:\s*/i, ''));
  return PMID_REGEX.test(normalized) ? normalized : null;
}

export function isValidPmid(value: unknown): boolean {
  return normalizePmid(value) != null;
}

export function normalizePmcid(value: unknown): string | null {
  const input = stringInput(value);
  if (!input) return null;

  const normalized = stripTerminalCitationPunctuation(
    input.replace(/^pmcid:\s*/i, '').replace(/\s+/g, ''),
  ).toUpperCase();
  return PMCID_REGEX.test(normalized) ? normalized : null;
}

export function isValidPmcid(value: unknown): boolean {
  return normalizePmcid(value) != null;
}

export function normalizeArxiv(value: unknown): string | null {
  const input = stringInput(value);
  if (!input) return null;

  const trimmed = stripTerminalCitationPunctuation(input);
  const doiMatch = trimmed.match(/10\.48550\/arxiv\.([^\s/]+)/i);
  if (doiMatch?.[1]) {
    return stripTerminalCitationPunctuation(doiMatch[1]);
  }

  const normalized = stripTerminalCitationPunctuation(
    trimmed
      .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
      .replace(/\.pdf$/i, '')
      .replace(/^arxiv:\s*/i, ''),
  );
  const match = normalized.match(ARXIV_ID_REGEX);
  return match?.[1] ? match[1] : null;
}

export function isValidArxiv(value: unknown): boolean {
  return normalizeArxiv(value) != null;
}

export function normalizeIsbn(value: unknown): string | null {
  const input = stringInput(value, true);
  if (!input) return null;

  const normalized = input
    .replace(/^isbn(?:-1[03])?:?\s*/i, '')
    .replace(/[^0-9X]/gi, '')
    .toUpperCase();
  if (!ISBN_CLEAN_REGEX.test(normalized)) return null;
  if (normalized.length === 10) {
    return isValidIsbn10(normalized) ? normalized : null;
  }
  return isValidIsbn13(normalized) ? normalized : null;
}

export function isValidIsbn(value: unknown): boolean {
  return normalizeIsbn(value) != null;
}

export function normalizeIssn(value: unknown): string | null {
  const input = stringInput(value, true);
  if (!input) return null;

  const normalized = input
    .replace(/^issn:?\s*/i, '')
    .replace(/[^0-9X]/gi, '')
    .toUpperCase();
  return ISSN_CLEAN_REGEX.test(normalized) && isValidIssnChecksum(normalized) ? normalized : null;
}

export function isValidIssn(value: unknown): boolean {
  return normalizeIssn(value) != null;
}

export function normalizeHandle(value: unknown): string | null {
  const input = stringInput(value);
  if (!input) return null;

  const normalized = stripTerminalCitationPunctuation(
    input.replace(/^https?:\/\/(?:hdl\.)?handle\.net\//i, '').replace(/^hdl:\s*/i, ''),
  );
  return HANDLE_REGEX.test(normalized) ? normalized : null;
}

export function isValidHandle(value: unknown): boolean {
  return normalizeHandle(value) != null;
}

export function normalizePropagationUrl(value: unknown): string | null {
  const input = stringInput(value);
  if (!input) return null;

  const normalized = stripTerminalCitationPunctuation(input);

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || NON_SPECIFIC_PROPAGATION_URL_HOSTS.has(host)) {
    return null;
  }

  const pathname = parsed.pathname
    .replace(/\/+/g, '/')
    .replace(/\/$/u, '');
  if (!pathname) {
    return null;
  }

  return `${host}${pathname}`;
}

export function normalizePatent(value: unknown): string | null {
  const input = stringInput(value, true);
  if (!input) return null;

  const raw = stripTerminalCitationPunctuation(input);
  const patentUrlNormalized = raw
    .replace(/^https?:\/\/(?:www\.)?patents\.google\.com\/patent\//i, '')
    .replace(/\/(?:[a-z]{2}(?:-[a-z]{2})?)\/?$/i, '')
    .replace(/[?#].*$/u, '')
    .trim();
  const hasPatentContext =
    /\bpatent(?:\s+application)?(?:\s+no\.?)?\b/i.test(raw) ||
    /^https?:\/\/(?:www\.)?patents\.google\.com\/patent\//i.test(raw);
  const cleaned = patentUrlNormalized
    .replace(/\bpatent(?:\s+application)?(?:\s+no\.?)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!cleaned) return null;

  const match = cleaned.match(PATENT_REGEX);
  if (!match?.[0]) return null;

  const normalized = match[0].replace(/\s+/g, '');
  const hasJurisdictionOrPrefix = /^(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU|RE|PP|D)/i.test(normalized);
  const compactRaw = raw.replace(/\s+/g, '');
  const embeddedInDoi = new RegExp(
    `(?:doi:|https?:\\/\\/(?:dx\\.)?doi\\.org\\/|10\\.\\d{4,9}\\/)[^\\s"'<>]*${escapeRegex(normalized)}`,
    'i',
  ).test(compactRaw);
  const digitCount = normalized.replace(/\D/g, '').length;
  if (!hasPatentContext && embeddedInDoi) return null;
  if (!hasPatentContext && !hasJurisdictionOrPrefix) return null;
  if (digitCount < 6) return null;
  return normalized;
}

export function isValidPatent(value: unknown): boolean {
  return normalizePatent(value) != null;
}

export function normalizeIdentifierForField(field: IdentifierField, value: unknown): string | null {
  switch (field) {
    case 'doi':
      return normalizeDoi(value);
    case 'pmid':
      return normalizePmid(value);
    case 'pmcid':
      return normalizePmcid(value);
    case 'arxiv':
      return normalizeArxiv(value);
    case 'isbn':
      return normalizeIsbn(value);
    case 'issn':
      return normalizeIssn(value);
    case 'handle':
      return normalizeHandle(value);
    case 'patent':
      return normalizePatent(value);
  }
}

function isValidIsbn10(value: string): boolean {
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(value[index]) * (10 - index);
  }
  const checksum = value[9] === 'X' ? 10 : Number(value[9]);
  return Number.isFinite(checksum) && (sum + checksum) % 11 === 0;
}

function isValidIsbn13(value: string): boolean {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 1 : 3);
  }
  const checksum = (10 - (sum % 10)) % 10;
  return checksum === Number(value[12]);
}

function isValidIssnChecksum(value: string): boolean {
  let sum = 0;
  for (let index = 0; index < 7; index += 1) {
    sum += Number(value[index]) * (8 - index);
  }
  const checksum = (11 - (sum % 11)) % 11;
  const expected = checksum === 10 ? 'X' : String(checksum);
  return value[7] === expected;
}
