import type { ProviderRecord } from '../services/crossref.js';
import type {
  CanonicalAuthor,
  DoiVerificationResult,
  ExtractedFields,
  ReferenceType,
} from './types/citation.js';

const PRIMARY_COMPARABLE_FIELDS = new Set(['title', 'first_author', 'year', 'container']);

export function normalizeDoiForComparison(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[?#].*$/u, '')
    .replace(/[.,;:]+$/u, '')
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function verifyDoiAgainstRecord(
  fields: ExtractedFields,
  doiValue: string | null | undefined,
  record: ProviderRecord | null,
): DoiVerificationResult {
  const normalizedDoi = normalizeDoiForComparison(doiValue);
  if (!normalizedDoi) {
    return {
      status: 'absent',
      reasons: [],
    };
  }

  if (!record) {
    return {
      status: 'unverified',
      reasons: ['DOI could not be resolved against provider metadata.'],
    };
  }

  const providerDoi = normalizeDoiForComparison(readProviderString(record, 'doi'));
  if (!providerDoi || providerDoi !== normalizedDoi) {
    return {
      status: 'conflicted',
      reasons: ['Provider DOI does not align with the extracted DOI.'],
    };
  }

  const comparedFields: string[] = [];
  const mismatches: string[] = [];

  compareField(
    'title',
    readFieldString(fields.title.value),
    readProviderString(record, 'title'),
    (left, right) => tokenSimilarity(left, right) >= 0.8,
    comparedFields,
    mismatches,
  );

  compareField(
    'year',
    readFieldYear(fields.year.value),
    readProviderYear(record),
    (left, right) => left === right,
    comparedFields,
    mismatches,
  );

  compareField(
    'container',
    extractCitationContainer(fields),
    extractProviderContainer(record),
    (left, right) => tokenSimilarity(left, right) >= 0.8,
    comparedFields,
    mismatches,
  );

  compareField(
    'volume',
    readFieldString(fields.volume.value),
    readProviderString(record, 'volume'),
    (left, right) => normalizeScalar(left) === normalizeScalar(right),
    comparedFields,
    mismatches,
  );

  compareField(
    'issue',
    readFieldString(fields.issue.value),
    readProviderString(record, 'issue'),
    (left, right) => normalizeScalar(left) === normalizeScalar(right),
    comparedFields,
    mismatches,
  );

  compareField(
    'locator',
    extractCitationLocator(fields),
    extractProviderLocator(record),
    (left, right) => normalizeLocator(left) === normalizeLocator(right),
    comparedFields,
    mismatches,
  );

  compareField(
    'url',
    readFieldString(fields.url.value),
    readProviderString(record, 'url'),
    urlsAlign,
    comparedFields,
    mismatches,
  );

  const authorComparison = compareAuthors(fields.authors.value, extractProviderAuthors(record));
  if (authorComparison.comparable) {
    comparedFields.push('first_author');
    if (!authorComparison.matches) {
      mismatches.push(authorComparison.reason);
    } else {
      comparedFields.push('authors');
    }
  }

  const primaryFieldCount = comparedFields.filter((field) =>
    PRIMARY_COMPARABLE_FIELDS.has(field),
  ).length;
  const comparableFieldCount = comparedFields.filter((field) => field !== 'authors').length;

  if (comparableFieldCount < 2 || primaryFieldCount < 1) {
    return {
      status: 'unverified',
      reasons: ['Provider metadata was insufficient to verify the DOI safely.'],
    };
  }

  if (mismatches.length > 0) {
    return {
      status: 'conflicted',
      reasons: mismatches,
    };
  }

  return {
    status: 'verified',
    reasons: [
      `Verified against provider metadata using ${comparableFieldCount} comparable fields.`,
    ],
  };
}

export interface EnrichmentMatchResult {
  matches: boolean;
  confidence: number;
  agreedFields: string[];
  /**
   * Hard conflicts between the citation and the provider record (title/author/year/type
   * disagree). Distinct from `matches`, which also requires positive corroboration:
   * a record can have zero conflicts yet still not `match` (e.g. a titleless reference
   * with nothing to anchor). Callers gating field application on "do no harm" should key
   * off `conflicts` so they block contradictory records without over-blocking weak-but-
   * non-contradictory ones.
   */
  conflicts: string[];
  reasons: string[];
}

/**
 * Verify a provider record is plausibly the SAME work as a reference that has no usable DOI, so its
 * metadata can be trusted for auto-recovery. The title is the anchor (must agree strongly) and needs
 * at least one corroborating field (year or first author); any hard conflict — year differing by ≥2,
 * a different first author, or a different reference type — rejects the match. Conservative by design:
 * on doubt it returns `matches: false` so the reference stays in needs_action rather than being
 * confidently mislabeled. (DOI-bearing references should use `verifyDoiAgainstRecord` instead.)
 */
export function verifyEnrichmentRecordMatch(
  fields: ExtractedFields,
  record: ProviderRecord | null,
  citationType?: ReferenceType | null,
): EnrichmentMatchResult {
  if (!record) {
    return { matches: false, confidence: 0, agreedFields: [], conflicts: [], reasons: ['No provider record resolved.'] };
  }

  const agreedFields: string[] = [];
  const conflicts: string[] = [];

  const citationTitle = readFieldString(fields.title.value);
  const providerTitle = readProviderString(record, 'title');
  let titleAgrees = false;
  if (citationTitle && providerTitle) {
    if (tokenSimilarity(citationTitle, providerTitle) >= 0.82) {
      agreedFields.push('title');
      titleAgrees = true;
    } else {
      conflicts.push('title does not match the provider record');
    }
  }

  const citationYear = readFieldYear(fields.year.value);
  const providerYear = readProviderYear(record);
  if (citationYear != null && providerYear != null) {
    if (citationYear === providerYear) {
      agreedFields.push('year');
    } else if (Math.abs(citationYear - providerYear) >= 2) {
      // ±1 tolerated (print-vs-online release gap); ≥2 is a real conflict.
      conflicts.push(`year ${citationYear} conflicts with provider ${providerYear}`);
    }
  }

  const authorComparison = compareAuthors(fields.authors.value, extractProviderAuthors(record));
  if (authorComparison.comparable) {
    if (authorComparison.matches) {
      agreedFields.push('author');
    } else {
      conflicts.push('first author conflicts with the provider record');
    }
  }

  if (citationType && record.referenceType && citationType !== record.referenceType) {
    conflicts.push(`reference type ${citationType} conflicts with provider ${record.referenceType}`);
  }

  const corroborated = agreedFields.includes('year') || agreedFields.includes('author');
  const matches = conflicts.length === 0 && titleAgrees && corroborated;
  const confidence = matches ? Math.min(0.92, 0.72 + 0.07 * (agreedFields.length - 1)) : 0;

  return {
    matches,
    confidence,
    agreedFields,
    conflicts,
    reasons: matches
      ? [`Matched provider record on ${agreedFields.join(', ')}.`]
      : conflicts.length > 0
        ? conflicts
        : ['Insufficient corroborating fields to trust the provider record.'],
  };
}

function compareField<T>(
  fieldName: string,
  left: T | null,
  right: T | null,
  comparator: (left: T, right: T) => boolean,
  comparedFields: string[],
  mismatches: string[],
): void {
  if (left == null || right == null) return;
  comparedFields.push(fieldName);
  if (!comparator(left, right)) {
    mismatches.push(`DOI provider metadata mismatched on ${fieldName}.`);
  }
}

function readFieldString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readFieldYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function readProviderString(record: ProviderRecord, key: keyof ExtractedFields): string | null {
  const value = record.fields[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readProviderYear(record: ProviderRecord): number | null {
  const value = record.fields.year;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function extractCitationContainer(fields: ExtractedFields): string | null {
  return (
    [
      readFieldString(fields.journal.value),
      readFieldString(fields.conferenceTitle.value),
      readFieldString(fields.bookTitle.value),
      readFieldString(fields.siteName.value),
      readFieldString(fields.repository.value),
      readFieldString(fields.publisher.value),
    ].find(Boolean) ?? null
  );
}

function extractProviderContainer(record: ProviderRecord): string | null {
  return (
    [
      readProviderString(record, 'journal'),
      readProviderString(record, 'conferenceTitle'),
      readProviderString(record, 'bookTitle'),
      readProviderString(record, 'siteName'),
      readProviderString(record, 'repository'),
      readProviderString(record, 'publisher'),
    ].find(Boolean) ?? null
  );
}

function extractCitationLocator(fields: ExtractedFields): string | null {
  return (
    [
      readFieldString(fields.pages.value),
      readFieldString(fields.articleNumber.value),
      readFieldString(fields.reportNumber.value),
    ].find(Boolean) ?? null
  );
}

function extractProviderLocator(record: ProviderRecord): string | null {
  return (
    [
      readProviderString(record, 'pages'),
      readProviderString(record, 'articleNumber'),
      readProviderString(record, 'reportNumber'),
    ].find(Boolean) ?? null
  );
}

function extractProviderAuthors(record: ProviderRecord): CanonicalAuthor[] {
  if (record.authors && record.authors.length > 0) {
    return record.authors
      .filter((author) => typeof author.family === 'string' && author.family.trim().length > 0)
      .map((author) => ({
        family: author.family.trim(),
        given: typeof author.given === 'string' ? author.given.trim() || null : null,
        initials: null,
        isCorporate: false,
      }));
  }

  const value = record.fields.authors;
  if (!Array.isArray(value)) return [];

  const authors: CanonicalAuthor[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) continue;

    const family = readRecordString(entry, 'family') ?? '';
    const given = readRecordString(entry, 'given');
    const literal = readRecordString(entry, 'literal');

    if (!family && !literal) continue;

    authors.push({
      family: family || literal || '',
      given,
      initials: null,
      ...(literal ? { literal } : {}),
      isCorporate: Boolean(literal && !family),
    });
  }

  return authors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRecordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function compareAuthors(
  citationAuthors: CanonicalAuthor[],
  providerAuthors: CanonicalAuthor[],
): { comparable: boolean; matches: boolean; reason: string } {
  if (citationAuthors.length === 0 || providerAuthors.length === 0) {
    return {
      comparable: false,
      matches: false,
      reason: '',
    };
  }

  const citationFamilies = citationAuthors.map(authorFamilyKey).filter(Boolean);
  const providerFamilies = providerAuthors.map(authorFamilyKey).filter(Boolean);
  if (citationFamilies.length === 0 || providerFamilies.length === 0) {
    return {
      comparable: false,
      matches: false,
      reason: '',
    };
  }

  if (citationFamilies[0] !== providerFamilies[0]) {
    return {
      comparable: true,
      matches: false,
      reason: 'DOI provider metadata mismatched on first author.',
    };
  }

  if (citationFamilies.length <= 3 && providerFamilies.length > citationFamilies.length) {
    const prefixMatches = citationFamilies.every(
      (family, index) => family === providerFamilies[index],
    );
    return {
      comparable: true,
      matches: prefixMatches,
      reason: 'DOI provider metadata mismatched on author ordering.',
    };
  }

  const citationFamilySet = new Set(citationFamilies);
  const providerFamilySet = new Set(providerFamilies);
  const denominator = Math.min(citationFamilySet.size, providerFamilySet.size);
  const overlap = [...citationFamilySet].filter((family) => providerFamilySet.has(family)).length;
  const overlapRatio = denominator === 0 ? 0 : overlap / denominator;

  return {
    comparable: true,
    matches: overlapRatio > 0.5,
    reason: 'DOI provider metadata mismatched on author overlap.',
  };
}

function authorFamilyKey(author: CanonicalAuthor): string {
  if (author.isCorporate) {
    return normalizeScalar(author.literal ?? author.family);
  }

  if (author.family.trim().length > 0) {
    return normalizeScalar(author.family);
  }

  if (author.literal) {
    return inferFamilyFromLiteral(author.literal);
  }

  return '';
}

function inferFamilyFromLiteral(value: string): string {
  const normalized = normalizeScalar(value);
  if (!normalized) return '';
  if (normalized.includes(',')) {
    return normalized.split(',')[0]?.trim() ?? '';
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length >= 2) {
    const lastToken = tokens.at(-1) ?? '';
    if (lastToken.length <= 3 && tokens[0]!.length > 1) {
      return tokens.slice(0, -1).join(' ');
    }
  }

  return tokens.at(-1) ?? normalized;
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const overlap = [...leftSet].filter((token) => rightSet.has(token)).length;
  const precision = overlap / leftSet.size;
  const recall = overlap / rightSet.size;
  if (precision === 0 || recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function tokenize(value: string): string[] {
  return normalizeScalar(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeScalar(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N},\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocator(value: string): string {
  return value.replace(/[–—]/g, '-').replace(/\s+/g, '').toLowerCase();
}

function urlsAlign(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.host.toLowerCase() === rightUrl.host.toLowerCase() &&
      leftUrl.pathname.replace(/\/+$/, '').toLowerCase() ===
        rightUrl.pathname.replace(/\/+$/, '').toLowerCase()
    );
  } catch {
    return false;
  }
}
