import type { ParsedReference } from './schema';
import { isPlaceholderFieldValue } from './referencePlaceholders';

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const PROTECTED_TITLE_RULES = [
  { label: 'U-Net', raw: /\bU[-\s]?Net\b/i, parsed: /\bU-Net\b/i },
  { label: 'G*Power', raw: /\bG\s*\*?\s*Power\b/i, parsed: /\bG\*Power\b/i },
  { label: '2−ΔΔCT', raw: /2\s*[-−]\s*ΔΔCT/i, parsed: /2−ΔΔCT/i },
  { label: 'PRISMA', raw: /\bPRISMA\b/i, parsed: /\bPRISMA\b/i },
  { label: 'GLOBOCAN', raw: /\bGLOBOCAN\b/i, parsed: /\bGLOBOCAN\b/i },
  { label: 'DESeq2', raw: /\bDESeq\s*2\b/i, parsed: /\bDESeq2\b/i },
] as const;

const PROTECTED_CONTAINER_RULES = [
  { label: 'BMJ', raw: /\bBMJ\b/i, expected: /\bBMJ\b/i },
  { label: 'PLoS Medicine', raw: /\bPLoS\s+Medicine\b/i, expected: /\bPLoS\s+Medicine\b/i },
  { label: 'DROPS', raw: /\bDROPS\b/i, expected: /\bDROPS\b/i },
] as const;

export function hasPlaceholderFieldValue(value: string | null | undefined): boolean {
  return isPlaceholderFieldValue(value);
}

export function hasMalformedAuthorShape(authors: string[] | undefined): boolean {
  if (!Array.isArray(authors) || authors.length === 0) return false;

  return authors.some((author) => {
    const value = normalizeWhitespace(String(author ?? ''));
    if (!value) return true;
    if (/[,&]\s*&/.test(value) || /\b&\b/.test(value)) return true;
    if (/,\s*[A-Z](?:\s*,\s*[A-Z]){1,}/.test(value)) return true;
    if (/^[A-Z][a-z]+,\s*[A-Z]\s*,\s*[A-Z]/.test(value)) return true;
    if (/^\w+\s+\w+\s+\&/.test(value)) return true;
    return false;
  });
}

function rawContainsPlaceholder(raw: string, value: string): boolean {
  const normalizedRaw = normalizeWhitespace(raw).toLowerCase();
  if (!normalizedRaw) return false;
  if (normalizedRaw.includes('?')) return true;
  if (value === 'journal') return /\bjournal\b/.test(normalizedRaw);
  if (value === 'vol' || value === 'vol.') return /\bvol\.?\b/.test(normalizedRaw);
  if (value === 'unknown') return /\bunknown\b/.test(normalizedRaw);
  return normalizedRaw.includes(value);
}

export function hasInventedPlaceholderVenue(
  parsed: Pick<ParsedReference, 'journal' | 'volume' | 'issue'>,
  raw: string,
): boolean {
  return [parsed.journal, parsed.volume, parsed.issue]
    .map((value) => normalizeWhitespace(String(value ?? '').toLowerCase()))
    .filter(Boolean)
    .some((value) => hasPlaceholderFieldValue(value) && !rawContainsPlaceholder(raw, value));
}

export function getProtectedTitleCorruptionReasons(raw: string, parsedTitle?: string | null): string[] {
  const reasons: string[] = [];
  const title = normalizeWhitespace(parsedTitle ?? '');
  if (!title) return reasons;

  for (const rule of PROTECTED_TITLE_RULES) {
    if (rule.raw.test(raw) && !rule.parsed.test(title)) {
      reasons.push(`Protected title token ${rule.label} was corrupted`);
    }
  }

  return reasons;
}

export function getProtectedContainerCorruptionReasons(
  raw: string,
  parsed: Pick<ParsedReference, 'journal' | 'conferenceTitle' | 'bookTitle'>,
  parsedTitle?: string | null,
): string[] {
  const reasons: string[] = [];
  const venue = normalizeWhitespace(parsed.journal ?? parsed.conferenceTitle ?? parsed.bookTitle ?? '');
  const title = normalizeWhitespace(parsedTitle ?? '');
  if (!venue) return reasons;

  for (const rule of PROTECTED_CONTAINER_RULES) {
    if (rule.raw.test(raw) && !rule.expected.test(venue) && !(title && rule.expected.test(title))) {
      reasons.push(`Protected venue token ${rule.label} was not preserved`);
    }
  }

  return reasons;
}
