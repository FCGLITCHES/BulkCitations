import { randomUUID } from 'node:crypto';
import type {
  CanonicalAuthor,
  CanonicalCitation,
  CanonicalReferenceType,
  FieldValue,
  ParsedReference,
  ReferenceType,
  StageDiagnostic,
  V2FieldSource,
  V2StageId,
  V2StageStatus,
} from '@shared/schema';
import {
  classifyLocatorToken,
  isGroupAuthor,
  normalizeGroupAuthor,
  normalizeKnownContainerName,
  repairGroupAuthorFragments,
} from '../shared/citationSemantics.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export class TimeoutError extends Error {
  readonly code = 'V2_TIMEOUT';
  readonly timeoutMs: number;
  readonly label: string;

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
    || (
      error instanceof Error
      && (
        (error as Error & { code?: string }).code === 'V2_TIMEOUT'
        || error.name === 'TimeoutError'
      )
    );
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function createFieldValue<T>(
  value: T,
  source: V2FieldSource,
  confidence: number,
  stageId: string,
): FieldValue<T> {
  return {
    value,
    source,
    confidence: clampConfidence(confidence),
    stageId,
  };
}

export function createStageDiagnostic(
  stageId: V2StageId | string,
  status: V2StageStatus,
  message: string,
  details?: Record<string, unknown>,
  durationMs?: number,
): StageDiagnostic {
  return {
    stageId,
    status,
    message,
    details,
    durationMs,
    timestamp: nowIso(),
  };
}

export function createEmptyCitation(raw: string): CanonicalCitation {
  return {
    id: randomUUID(),
    raw,
    status: 'active',
    referenceType: 'unknown',
    authors: createFieldValue([], 'extracted', 0, 'split'),
    title: createFieldValue(null, 'extracted', 0, 'split'),
    year: createFieldValue(null, 'extracted', 0, 'split'),
    journal: createFieldValue(null, 'extracted', 0, 'split'),
    volume: createFieldValue(null, 'extracted', 0, 'split'),
    issue: createFieldValue(null, 'extracted', 0, 'split'),
    pages: createFieldValue(null, 'extracted', 0, 'split'),
    doi: createFieldValue(null, 'extracted', 0, 'split'),
    publisher: createFieldValue(null, 'extracted', 0, 'split'),
    placeOfPublication: createFieldValue(null, 'extracted', 0, 'split'),
    url: createFieldValue(null, 'extracted', 0, 'split'),
    conferenceTitle: createFieldValue(null, 'extracted', 0, 'split'),
    bookTitle: createFieldValue(null, 'extracted', 0, 'split'),
    institution: createFieldValue(null, 'extracted', 0, 'split'),
    edition: createFieldValue(null, 'extracted', 0, 'split'),
    editor: createFieldValue(null, 'extracted', 0, 'split'),
    detectedStyle: createFieldValue(null, 'extracted', 0, 'split'),
    validationIssues: [],
    duplicate: null,
    enrichment: null,
    stageLog: [],
  };
}

export function addCitationStageLog(citation: CanonicalCitation, diagnostic: StageDiagnostic): CanonicalCitation {
  return {
    ...citation,
    stageLog: [...citation.stageLog, diagnostic],
  };
}

export function parsedReferenceTypeToCanonical(type: ReferenceType): CanonicalReferenceType {
  switch (type) {
    case 'journal':
      return 'journal';
    case 'book':
      return 'book';
    case 'bookChapter':
      return 'chapter';
    case 'conference':
      return 'conference';
    case 'thesis':
      return 'thesis';
    case 'website':
      return 'website';
    case 'report':
      return 'report';
    case 'preprint':
      return 'preprint';
    default:
      return 'unknown';
  }
}

export function canonicalReferenceTypeToParsed(type: CanonicalReferenceType): ReferenceType {
  switch (type) {
    case 'journal':
      return 'journal';
    case 'book':
      return 'book';
    case 'chapter':
      return 'bookChapter';
    case 'conference':
      return 'conference';
    case 'thesis':
      return 'thesis';
    case 'website':
      return 'website';
    case 'report':
      return 'report';
    case 'preprint':
      return 'preprint';
    default:
      return 'other';
  }
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeDoiValue(value: string): string {
  let normalized = normalizeWhitespace(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');

  while (/[)\].,;:]+$/.test(normalized)) {
    const lastChar = normalized.slice(-1);
    if (lastChar === ')') {
      const openCount = (normalized.match(/\(/g) ?? []).length;
      const closeCount = (normalized.match(/\)/g) ?? []).length;
      if (closeCount <= openCount) break;
    }
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function doiToUrl(doi: string): string {
  return `https://doi.org/${normalizeDoiValue(doi)}`;
}

const CP1252_REVERSE_BYTE_MAP = new Map<string, number>([
  ['€', 0x80],
  ['‚', 0x82],
  ['ƒ', 0x83],
  ['„', 0x84],
  ['…', 0x85],
  ['†', 0x86],
  ['‡', 0x87],
  ['ˆ', 0x88],
  ['‰', 0x89],
  ['Š', 0x8A],
  ['‹', 0x8B],
  ['Œ', 0x8C],
  ['Ž', 0x8E],
  ['‘', 0x91],
  ['’', 0x92],
  ['“', 0x93],
  ['”', 0x94],
  ['•', 0x95],
  ['–', 0x96],
  ['—', 0x97],
  ['˜', 0x98],
  ['™', 0x99],
  ['š', 0x9A],
  ['›', 0x9B],
  ['œ', 0x9C],
  ['ž', 0x9E],
  ['Ÿ', 0x9F],
]);

function containsSuspiciousMojibake(value: string): boolean {
  return /(?:Ã.|Â.|â.|Ð.|Ñ.|¤|�)/u.test(value);
}

function mojibakePenalty(value: string): number {
  let penalty = 0;
  penalty += (value.match(/�/g) ?? []).length * 4;
  penalty += (value.match(/[ÃÂâÐÑ¤]/g) ?? []).length * 2;
  penalty += (value.match(/[\u0000-\u001f]/g) ?? []).length * 3;
  return penalty;
}

function decodeUtf8Mojibake(value: string): string {
  const bytes: number[] = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null) continue;
    if (codePoint <= 0xFF) {
      bytes.push(codePoint);
      continue;
    }
    const mapped = CP1252_REVERSE_BYTE_MAP.get(char);
    if (mapped == null) {
      return value;
    }
    bytes.push(mapped);
  }
  return Buffer.from(bytes).toString('utf8');
}

function repairMojibake(value: string): string {
  if (!containsSuspiciousMojibake(value)) return value;

  let current = value;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const candidate = decodeUtf8Mojibake(current);
    if (!candidate || candidate === current) break;
    if (mojibakePenalty(candidate) > mojibakePenalty(current)) break;
    current = candidate;
    if (!containsSuspiciousMojibake(current)) break;
  }
  return current;
}

const OCR_JOINABLE_SHORT_WORDS = new Set([
  'an',
  'as',
  'at',
  'be',
  'by',
  'do',
  'ed',
  'if',
  'in',
  'is',
  'it',
  'no',
  'of',
  'on',
  'or',
  'pp',
  'to',
  'up',
  'we',
]);
const OCR_STANDALONE_SINGLE_LETTERS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

function shortWordJoinKey(current: string, next: string): string {
  return `${current}${next}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function normalizeUnicodeText(value: string): string {
  return repairMojibake(value)
    .replace(/â€(?=[\d,.;:)\]-])/g, '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\uFFF9-\uFFFF]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-');
}

export function compactUriDoiSpacing(value: string): string {
  return value
    .replace(/\bhttps?\s*:\s*\/\s*\//gi, (match) => match.replace(/\s+/g, ''))
    .replace(/\bwww\s*\.\s*/gi, 'www.')
    .replace(/\bdoi\s*:\s*10\.\s*(\d{4,})\s*\/\s*/gi, 'doi:10.$1/')
    .replace(/\b10\s*\.\s*(\d{4,})\s*\/\s*/g, '10.$1/')
    .replace(/\s+([,.;:)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1');
}

function stripTokenEdgeNoise(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}/:.-]+$/gu, '');
}

function shouldMergeOcrSplitTokens(current: string, next: string): boolean {
  const currentCore = stripTokenEdgeNoise(current);
  const nextCore = stripTokenEdgeNoise(next);
  if (!currentCore || !nextCore) return false;

  if (current.endsWith('-') && /^[\p{L}]{2,}/u.test(nextCore)) {
    return true;
  }

  if (
    /^\d$/u.test(currentCore)
    && /^\d{2,}(?:[A-Za-z]?\d*|\([^)]*\)|[-–].+)?$/u.test(nextCore)
    && !/[,:;]$/.test(current)
  ) {
    return true;
  }

  if (/^[\p{L}]$/u.test(currentCore) && /^[\p{L}]$/u.test(nextCore)) {
    return OCR_JOINABLE_SHORT_WORDS.has(shortWordJoinKey(currentCore, nextCore));
  }

  if (/^[\p{L}]$/u.test(currentCore) && /^[\p{Ll}][\p{L}\p{N}/:.-]{1,}$/u.test(nextCore)) {
    if (/^[A-Z]$/u.test(currentCore)) {
      return false;
    }
    if (OCR_STANDALONE_SINGLE_LETTERS.has(currentCore.toLowerCase())) {
      return OCR_JOINABLE_SHORT_WORDS.has(shortWordJoinKey(currentCore, nextCore));
    }
    return true;
  }

  if (/^[\p{Lu}]$/u.test(currentCore) && /^[\p{Lu}]{2,}$/u.test(nextCore) && nextCore.length <= 3) {
    return !OCR_STANDALONE_SINGLE_LETTERS.has(currentCore.toLowerCase());
  }

  return false;
}

export function repairPdfCopyArtifacts(value: string): string {
  const normalized = compactUriDoiSpacing(
    normalizeWhitespace(value)
      .replace(/\b([A-Z])\s+\.(?=\s|[,;:)\]])/g, '$1.')
      .replace(/\b([A-Z])\s+\.(?=\()/g, '$1.'),
  );
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return normalized;

  let working = [...tokens];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const nextTokens: string[] = [];
    let changed = false;

    for (let index = 0; index < working.length; index += 1) {
      const current = working[index]!;
      const next = working[index + 1];
      if (next && shouldMergeOcrSplitTokens(current, next)) {
        nextTokens.push(`${current}${next}`);
        index += 1;
        changed = true;
        continue;
      }
      nextTokens.push(current);
    }

    working = nextTokens;
    if (!changed) break;
  }

  return working
    .join(' ')
    .replace(/([:;])\s*([Aa])(?=[A-Z]{4,}\b)/g, '$1 $2 ');
}

export function fixUnicodeText(value: string): string {
  return repairPdfCopyArtifacts(
    normalizeUnicodeText(value),
  );
}

export function isLikelyAllCaps(value: string): boolean {
  const letters = Array.from(value).filter((char) => /\p{L}/u.test(char));
  if (letters.length < 4) return false;
  const upper = letters.filter((char) => char === char.toLocaleUpperCase() && char !== char.toLocaleLowerCase()).length;
  return upper / letters.length > 0.8;
}

const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
const INITIALS_TOKEN_PATTERN = /^[\p{Lu}](?:[.-]?[\p{Lu}]){0,5}\.?$/u;
const DOTTED_INITIALS_PATTERN = /^[\p{Lu}](?:\.[\p{Lu}])+\.?$/u;

export function toSmartTitleCase(value: string): string {
  return fixUnicodeText(value)
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLocaleLowerCase();
      if (
        word === word.toLocaleUpperCase()
        && /[\p{L}\p{N}]/u.test(word)
        && /^[\p{Lu}\p{N}-]{2,}$/u.test(word)
      ) {
        return word.toLocaleUpperCase();
      }
      if (index > 0 && TITLE_STOP_WORDS.has(lower)) return lower;
      return lower.replace(/^\p{L}/u, (char) => char.toLocaleUpperCase());
    })
    .join(' ');
}

function initialsFromWords(words: string[]): string | null {
  const initials = words
    .map((word) => word.trim())
    .filter(Boolean)
    .flatMap((word) => {
      const compact = word.replace(/\s+/g, '');
      const withoutDots = compact.replace(/\./g, '');
      if (!withoutDots) return [];
      if (/[a-z]/.test(withoutDots)) {
        return withoutDots
          .split('-')
          .filter(Boolean)
          .map((part) => Array.from(part)[0]?.toUpperCase() ?? '')
          .filter(Boolean);
      }
      if (DOTTED_INITIALS_PATTERN.test(compact) || /^[\p{Lu}]{2,3}$/u.test(withoutDots)) {
        return withoutDots.split('').map((part) => part.toUpperCase());
      }
      if (/^[\p{Lu}]\.?$/u.test(word)) return [word.replace(/\./g, '').toUpperCase()];
      return Array.from(word)[0]?.toUpperCase() ?? '';
    })
    .filter(Boolean);

  return initials.length > 0 ? initials.map((letter) => `${letter}.`).join(' ') : null;
}

function normalizeCompactedGivenNames(value: string): string {
  return normalizeWhitespace(
    fixUnicodeText(value)
      .replace(/([\p{Ll}])([\p{Lu}]\.)/gu, '$1 $2')
      .replace(/([\p{Ll}])([\p{Lu}])(?=$|\s)/gu, '$1 $2'),
  );
}

export function parseAuthorToCanonical(author: string): CanonicalAuthor {
  const normalized = fixUnicodeText(author.replace(/[;]+$/, ''));
  if (!normalized) {
    return {
      first: null,
      last: 'Unknown',
      initials: null,
      literal: author,
    };
  }

  if (/^et\s+al\.?$/i.test(normalized)) {
    return {
      first: null,
      last: 'et al.',
      initials: null,
      literal: normalized,
    };
  }

  if (isGroupAuthor(normalized)) {
    const group = normalizeGroupAuthor(normalized);
    return {
      first: null,
      last: group,
      initials: null,
      literal: group,
    };
  }

  if (normalized.includes(',')) {
    const [last, rest] = normalized.split(',', 2);
    const first = normalizeCompactedGivenNames(rest ?? '') || null;
    return {
      first,
      last: normalizePersonLastName(last),
      initials: first ? initialsFromWords(first.split(/\s+/)) : null,
    };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      first: null,
      last: parts[0],
      initials: /^[\p{Lu}.]+$/u.test(parts[0]) ? parts[0] : null,
    };
  }

  const last = parts[parts.length - 1];
  let firstParts = parts.slice(0, -1);
  const suffixes = new Set(['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv']);
  let suffix = '';
  if (suffixes.has(last.toLowerCase()) && parts.length >= 2) {
    suffix = last;
    firstParts = parts.slice(0, -2);
  }
  const surnameParts = parts.slice(firstParts.length, suffix ? -1 : undefined);
  const normalizedLast = normalizePersonLastName(`${surnameParts.join(' ')}${suffix ? ` ${suffix}` : ''}`.trim());
  const first = normalizeCompactedGivenNames(firstParts.join(' '));
  return {
    first,
    last: normalizedLast,
    initials: initialsFromWords(firstParts),
  };
}

export function normalizeCanonicalAuthor(author: CanonicalAuthor): CanonicalAuthor {
  if (author.literal && !author.first && !author.last) {
    return parseAuthorToCanonical(author.literal);
  }

  const first = author.first ? fixUnicodeText(author.first) : null;
  const last = normalizePersonLastName(author.last ? fixUnicodeText(author.last) : 'Unknown');
  const literal = author.literal ? fixUnicodeText(author.literal) : undefined;
  const combinedGroupCandidate = [
    literal,
    normalizeWhitespace([first, last].filter(Boolean).join(' ')),
    last,
  ]
    .find((candidate) => Boolean(candidate) && isGroupAuthor(candidate ?? ''));

  if (combinedGroupCandidate) {
    const group = normalizeGroupAuthor(combinedGroupCandidate);
    return {
      first: null,
      last: group,
      initials: null,
      literal: group,
      orcid: author.orcid ? normalizeWhitespace(author.orcid) : undefined,
    };
  }

  return {
    first,
    last,
    initials: author.initials ? fixUnicodeText(author.initials) : initialsFromWords((first ?? '').split(/\s+/).filter(Boolean)),
    literal,
    orcid: author.orcid ? normalizeWhitespace(author.orcid) : undefined,
  };
}

export function coerceCanonicalAuthor(author: string | CanonicalAuthor): CanonicalAuthor {
  return typeof author === 'string' ? parseAuthorToCanonical(author) : normalizeCanonicalAuthor(author);
}

function dottedInitials(value: string): string | null {
  const compact = normalizeWhitespace(value).replace(/\s+/g, '').replace(/\./g, '');
  if (!compact || !/^[\p{Lu}]{1,6}$/u.test(compact)) return null;
  return compact.toUpperCase().split('').map((char) => `${char}.`).join(' ');
}

export function looksLikeAlternatingTokenArray(tokens: string[]): boolean {
  const normalizedTokens = normalizeAuthorTokens(tokens);
  if (normalizedTokens.length < 4 || normalizedTokens.length % 2 !== 0) return false;
  const oddAreInitials = normalizedTokens
    .filter((_, index) => index % 2 === 1)
    .every((token) => INITIALS_TOKEN_PATTERN.test(token.replace(/\s+/g, '')));
  const evenAreNames = normalizedTokens
    .filter((_, index) => index % 2 === 0)
    .every((token) => token.length > 2 && /[\p{L}]/u.test(token) && !INITIALS_TOKEN_PATTERN.test(token.replace(/\s+/g, '')));
  return oddAreInitials && evenAreNames;
}

export function parseAlternatingTokenArray(tokens: string[]): CanonicalAuthor[] {
  const normalizedTokens = normalizeAuthorTokens(tokens);
  const authors: CanonicalAuthor[] = [];
  for (let index = 0; index < normalizedTokens.length; index += 2) {
    const surname = normalizeWhitespace(normalizedTokens[index]);
    const initials = dottedInitials(normalizedTokens[index + 1] ?? '');
    authors.push({
      first: null,
      last: surname,
      initials,
    });
  }
  return authors;
}

function normalizeAuthorTokens(tokens: string[]): string[] {
  return tokens
    .map((token) => fixUnicodeText(token)
      .replace(/^(?:&|and)\s+/i, '')
      .replace(/^(&|and)$/i, '')
      .replace(/^[,;]+|[,;]+$/g, '')
      .trim())
    .filter(Boolean);
}

function buildPairedAuthorsFromAlternatingTokens(tokens: string[]): string[] {
  const normalizedTokens = normalizeAuthorTokens(tokens);
  const paired: string[] = [];
  for (let index = 0; index < normalizedTokens.length; index += 2) {
    const left = normalizedTokens[index];
    const right = normalizedTokens[index + 1];
    if (!left || !right) continue;
    paired.push(`${left}, ${right}`);
  }
  return paired;
}

function splitAuthorBlob(author: string): string[] {
  const normalized = normalizeGroupAuthor(fixUnicodeText(author)
    .replace(/\s+(?:and|&)\s+/gi, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim());
  if (!normalized) return [];
  if (isGroupAuthor(normalized) && !normalized.includes(',')) return [normalized];

  const commaTokens = normalized.split(/\s*,\s*/).map((token) => token.trim()).filter(Boolean);
  const repairedGroupTokens = repairGroupAuthorFragments(commaTokens);
  if (repairedGroupTokens.length !== commaTokens.length) {
    return repairedGroupTokens;
  }
  if (commaTokens.length >= 4 && commaTokens.length % 2 === 0 && looksLikeSurnameGivenAlternatingArray(commaTokens)) {
    return buildPairedAuthorsFromAlternatingTokens(commaTokens);
  }
  if (commaTokens.length >= 4 && commaTokens.length % 2 === 0 && looksLikeAlternatingTokenArray(commaTokens)) {
    return buildPairedAuthorsFromAlternatingTokens(commaTokens);
  }
  if (commaTokens.length === 2 && looksLikeSurnameToken(commaTokens[0]) && looksLikeGivenNamesToken(commaTokens[1])) {
    return [normalized];
  }
  if (
    commaTokens.length >= 2
    && commaTokens.every((token) => !token.includes(','))
    && commaTokens.every((token) => token.split(/\s+/).filter(Boolean).length >= 2)
    && commaTokens.every((token) => !isGroupAuthor(token))
  ) {
    return commaTokens;
  }
  if (commaTokens.length >= 3) {
    const recombined: string[] = [];
    let changed = false;
    for (let index = 0; index < commaTokens.length; index += 1) {
      const token = commaTokens[index];
      const next = commaTokens[index + 1];
      if (next && looksLikeSurnameToken(token) && looksLikeGivenNamesToken(next)) {
        recombined.push(`${token}, ${next}`);
        index += 1;
        changed = true;
        continue;
      }
      recombined.push(token);
    }
    if (changed) return recombined;
  }
  if (commaTokens.length >= 3 && commaTokens.every((token) => !token.includes(','))) {
    return commaTokens;
  }
  return [normalized];
}

function expandAuthorBlobs(authors: Array<string | CanonicalAuthor>): Array<string | CanonicalAuthor> {
  const expanded: Array<string | CanonicalAuthor> = [];
  for (const author of authors) {
    if (typeof author !== 'string') {
      expanded.push(author);
      continue;
    }
    const split = splitAuthorBlob(author);
    if (split.length <= 1) {
      expanded.push(author);
      continue;
    }
    expanded.push(...split);
  }
  return expanded;
}

function looksLikeGivenNamesToken(token: string): boolean {
  const normalized = normalizeWhitespace(token);
  if (!normalized) return false;
  if (parseCompactVancouverAuthor(normalized)) return false;
  if (INITIALS_TOKEN_PATTERN.test(normalized.replace(/\s+/g, ''))) return true;
  return /[\p{Ll}]/u.test(normalized) && normalized.split(/\s+/).length <= 4;
}

function looksLikeSurnameToken(token: string): boolean {
  const normalized = normalizeWhitespace(token);
  if (!normalized) return false;
  if (normalized.includes(',')) return false;
  if (parseCompactVancouverAuthor(normalized)) return false;
  if (INITIALS_TOKEN_PATTERN.test(normalized.replace(/\s+/g, ''))) return false;
  return /^[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,3}$/u.test(normalized);
}

function looksLikeMixedInvertedAndFullNameArray(tokens: string[]): boolean {
  const normalizedTokens = normalizeAuthorTokens(tokens);
  if (normalizedTokens.length < 3) return false;
  const [first, ...rest] = normalizedTokens;
  if (!first || !first.includes(',')) return false;
  if (rest.some((token) => token.includes(','))) return false;

  const [surname, given] = first.split(',').map((part) => normalizeWhitespace(part));
  if (!looksLikeSurnameToken(surname) || !looksLikeGivenNamesToken(given ?? '')) return false;

  return rest.every((token) => {
    const normalized = normalizeWhitespace(token);
    return normalized.split(/\s+/).length >= 2 && looksLikeGivenNamesToken(normalized);
  });
}

export function looksLikeSurnameGivenAlternatingArray(tokens: string[]): boolean {
  const normalizedTokens = normalizeAuthorTokens(tokens);
  if (normalizedTokens.length < 4 || normalizedTokens.length % 2 !== 0) return false;

  const evenAreSurnames = normalizedTokens
    .filter((_, index) => index % 2 === 0)
    .every((token) => looksLikeSurnameToken(token));
  const oddAreGivenNames = normalizedTokens
    .filter((_, index) => index % 2 === 1)
    .every((token) => looksLikeGivenNamesToken(token));

  return evenAreSurnames && oddAreGivenNames;
}

export function parseSurnameGivenAlternatingArray(tokens: string[]): CanonicalAuthor[] {
  const normalizedTokens = normalizeAuthorTokens(tokens);
  const authors: CanonicalAuthor[] = [];

  for (let index = 0; index < normalizedTokens.length; index += 2) {
    const surname = normalizePersonLastName(normalizedTokens[index] ?? '');
    const given = normalizeCompactedGivenNames(normalizedTokens[index + 1] ?? '') || null;
    if (!surname) continue;
    authors.push({
      first: given,
      last: surname,
      initials: given ? initialsFromWords(given.split(/\s+/)) : null,
    });
  }

  return authors;
}

export function parseCompactVancouverAuthor(author: string): CanonicalAuthor | null {
  const normalized = fixUnicodeText(author);
  if (normalized.includes(',')) return null;
  const match = normalized.match(/^(.+?)\s+([\p{Lu}]{1,6}(?:-[\p{Lu}]{1,6})?)$/u);
  if (!match) return null;
  const last = normalizePersonLastName(match[1]);
  const initials = dottedInitials(match[2]);
  if (!initials) return null;
  return {
    first: null,
    last,
    initials,
  };
}

export function parseInitialsFirstAuthor(author: string): CanonicalAuthor | null {
  const normalized = fixUnicodeText(author);
  const match = normalized.match(/^((?:[\p{Lu}]\.(?:-[\p{Lu}]\.)?\s*)+)\s+(.+)$/u);
  if (!match) return null;
  return {
    first: null,
    last: normalizePersonLastName(match[2]),
    initials: normalizeWhitespace(match[1]),
  };
}

function parseMixedMlaAuthor(author: string): CanonicalAuthor | null {
  const normalized = fixUnicodeText(author);
  if (normalized.includes(',')) return null;
  const compact = parseInitialsFirstAuthor(normalized);
  if (compact) return compact;
  return null;
}

function isInitialsOnlyAuthor(author: CanonicalAuthor): boolean {
  const last = normalizeWhitespace(author.last);
  return !author.first && !author.literal && /^[\p{Lu}](?:\.\s*[\p{Lu}])*\.?$/u.test(last);
}

function mergeInitialValues(base: string | null | undefined, extra: string | null | undefined): string | null {
  const values = [base, extra]
    .map((value) => normalizeWhitespace(value ?? ''))
    .filter(Boolean);
  if (values.length === 0) return null;
  return [...new Set(values)].join(' ');
}

function countInitialLetters(value: string | null | undefined): number {
  return (normalizeWhitespace(value ?? '').match(/[\p{Lu}](?=\.|\b)/gu) ?? []).length;
}

function collapseOrphanInitialAuthors(authors: CanonicalAuthor[]): CanonicalAuthor[] {
  const collapsed: CanonicalAuthor[] = [];

  for (const author of authors) {
    if (isInitialsOnlyAuthor(author) && collapsed.length > 0) {
      const previous = collapsed[collapsed.length - 1];
      if (!isInitialsOnlyAuthor(previous)) {
        collapsed[collapsed.length - 1] = {
          ...previous,
          initials: mergeInitialValues(previous.initials, dottedInitials(author.last) ?? author.last),
        };
        continue;
      }
    }

    collapsed.push(author);
  }

  return collapsed;
}

function collapseSplitSurnameGivenAuthors(authors: CanonicalAuthor[]): CanonicalAuthor[] {
  const collapsed: CanonicalAuthor[] = [];

  for (const author of authors) {
    if (collapsed.length > 0) {
      const previous = collapsed[collapsed.length - 1];
      const previousHasSurnameOnly = !previous.first && !previous.initials && !previous.literal && !isInitialsOnlyAuthor(previous);
      const currentCarriesGivenName = Boolean(author.first) && /^[\p{Lu}](?:\.\s*[\p{Lu}])*\.?$/u.test(normalizeWhitespace(author.last));

      if (previousHasSurnameOnly && currentCarriesGivenName) {
        collapsed[collapsed.length - 1] = {
          ...previous,
          first: author.first,
          initials: mergeInitialValues(initialsFromWords((author.first ?? '').split(/\s+/).filter(Boolean)), dottedInitials(author.last) ?? author.last),
        };
        continue;
      }
    }

    collapsed.push(author);
  }

  return collapsed;
}

export function parseAuthorsForStyle(
  authors: Array<string | CanonicalAuthor>,
  style: string | null | undefined,
): {
  authors: CanonicalAuthor[];
  parserMode: string;
  warningFlags: string[];
  rejectedCandidates: string[];
} {
  const normalizedStyle = (style ?? 'auto').toLowerCase();
  if (authors.length === 0) {
    return { authors: [], parserMode: 'none', warningFlags: [], rejectedCandidates: [] };
  }

  const expandedAuthors = expandAuthorBlobs(authors);
  const rawStrings = expandedAuthors.filter((author): author is string => typeof author === 'string').map((author) => fixUnicodeText(author));
  const ieeeFullNameMixedArray = normalizedStyle === 'ieee'
    && rawStrings.length === expandedAuthors.length
    && looksLikeMixedInvertedAndFullNameArray(rawStrings);
  const compactVancouverArray = rawStrings.length === expandedAuthors.length
    && rawStrings.filter((author) => !/^et\s+al\.?$/i.test(author)).length >= 2
    && rawStrings.every((author) => /^et\s+al\.?$/i.test(author) || Boolean(parseCompactVancouverAuthor(author)) || isGroupAuthor(author));
  if (compactVancouverArray) {
    return {
      authors: rawStrings.map((author) => {
        if (/^et\s+al\.?$/i.test(author)) {
          return {
            first: null,
            last: 'et al.',
            initials: null,
            literal: 'et al.',
          };
        }
        if (isGroupAuthor(author)) {
          const group = normalizeGroupAuthor(author);
          return {
            first: null,
            last: group,
            initials: null,
            literal: group,
          };
        }
        return parseCompactVancouverAuthor(author) ?? parseAuthorToCanonical(author);
      }),
      parserMode: 'vancouver_compact_array',
      warningFlags: [],
      rejectedCandidates: [],
    };
  }
  if (!ieeeFullNameMixedArray && rawStrings.length === expandedAuthors.length && looksLikeAlternatingTokenArray(rawStrings)) {
    return {
      authors: parseAlternatingTokenArray(rawStrings),
      parserMode: 'alternating_pairs',
      warningFlags: ['alternating_author_tokens_detected'],
      rejectedCandidates: ['alternating_tokens_rewritten_before_canonicalization'],
    };
  }
  if (!ieeeFullNameMixedArray && rawStrings.length === expandedAuthors.length && looksLikeSurnameGivenAlternatingArray(rawStrings)) {
    return {
      authors: parseSurnameGivenAlternatingArray(rawStrings),
      parserMode: 'surname_given_pairs',
      warningFlags: ['surname_given_alternation_detected'],
      rejectedCandidates: ['surname_given_tokens_rewritten_before_canonicalization'],
    };
  }

  const canonicalAuthors = expandedAuthors.map((author) => {
    if (typeof author !== 'string') return normalizeCanonicalAuthor(author);
    const normalized = fixUnicodeText(author);

    if (isGroupAuthor(normalized)) {
      const group = normalizeGroupAuthor(normalized);
      return {
        first: null,
        last: group,
        initials: null,
        literal: group,
      };
    }

    const compactVancouver = !normalized.includes(',') ? parseCompactVancouverAuthor(normalized) : null;
    if (compactVancouver) {
      return compactVancouver;
    }
    if (normalizedStyle === 'vancouver') {
      return parseAuthorToCanonical(normalized);
    }

    const initialsFirst = parseInitialsFirstAuthor(normalized);
    if (initialsFirst && !normalized.includes(',')) {
      return initialsFirst;
    }
    if (normalizedStyle === 'ieee') {
      return parseAuthorToCanonical(normalized);
    }
    if (normalizedStyle === 'mla') {
      return parseMixedMlaAuthor(normalized) ?? parseAuthorToCanonical(normalized);
    }
    return parseAuthorToCanonical(normalized);
  });

  const repairedAuthors = collapseOrphanInitialAuthors(collapseSplitSurnameGivenAuthors(canonicalAuthors));
  const warningFlags: string[] = [];
  const rejectedCandidates: string[] = [];
  if (repairedAuthors.length !== canonicalAuthors.length) {
    warningFlags.push('orphan_initial_authors_collapsed');
    rejectedCandidates.push('orphan_initial_tokens_rewritten');
  }
  if (repairedAuthors.some((author) => /^[\p{Lu}](?:\.\s*[\p{Lu}])*\.?$/u.test(author.last))) {
    warningFlags.push('initials_as_surname_suspected');
    rejectedCandidates.push('compact_author_inversion_suspected');
  }

  const parserMode = normalizedStyle === 'vancouver'
    ? 'vancouver_compact'
    : normalizedStyle === 'ieee'
      ? 'ieee_initials_first'
      : normalizedStyle === 'mla'
        ? 'mla_mixed'
        : 'inverted_or_generic';

  return {
    authors: repairedAuthors,
    parserMode,
    warningFlags,
    rejectedCandidates,
  };
}

export function canonicalAuthorToDisplay(author: CanonicalAuthor): string {
  if (author.literal) return author.literal;
  const normalizedFirst = normalizeWhitespace(author.first ?? '');
  const firstLooksLikeInitials = Boolean(normalizedFirst) && INITIALS_TOKEN_PATTERN.test(normalizedFirst.replace(/\s+/g, ''));
  const firstInitialCount = countInitialLetters(author.first);
  const storedInitialCount = countInitialLetters(author.initials);
  if (author.initials && storedInitialCount > firstInitialCount) return `${author.last}, ${author.initials}`;
  if (author.first && !firstLooksLikeInitials) return `${author.last}, ${author.first}`;
  if (author.initials) return `${author.last}, ${author.initials}`;
  if (author.first) return `${author.last}, ${dottedInitials(author.first) ?? author.first}`;
  return author.last;
}

export function attachCitationDebug(
  citation: CanonicalCitation,
  stageId: V2StageId,
  details: Record<string, unknown>,
  enabled: boolean,
): CanonicalCitation {
  if (!enabled) return citation;
  return {
    ...citation,
    stageDebug: {
      ...(citation.stageDebug ?? {}),
      [stageId]: details,
    },
  };
}

export function logStructuredDebug(
  context: { debugEnabled: boolean; jobId: string },
  stageId: V2StageId,
  citationIndex: number,
  citation: CanonicalCitation,
  details: Record<string, unknown>,
): void {
  if (!context.debugEnabled) return;
  if (!/^(1|true|yes|on)$/i.test(process.env.V2_DEBUG_STRUCTURED_LOGS ?? '')) return;
  console.log(JSON.stringify({
    jobId: context.jobId,
    stage: stageId,
    citationIndex,
    citationId: citation.id,
    selectedBranch: details.selectedBranch,
    selectionReason: details.selectionReason,
    authorParserMode: details.authorParserMode,
    warningFlags: details.warningFlags,
    ...details,
  }));
}

export function isVerboseDebugEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.V2_DEBUG_VERBOSE ?? '');
}

const PARTICLES = new Set(['da', 'de', 'del', 'der', 'di', 'du', 'la', 'le', 'van', 'von', 'al-', 'bin']);

function normalizePersonLastName(value: string): string {
  const parts = normalizeWhitespace(value).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return normalizeWhitespace(value);

  const normalizedParts: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const lowered = part.toLowerCase();
    if (PARTICLES.has(lowered)) {
      normalizedParts.push(lowered);
    } else {
      normalizedParts.push(part);
    }
  }
  return normalizedParts.join(' ');
}

export function canonicalToParsedReference(citation: CanonicalCitation): ParsedReference {
  const locator = classifyLocatorToken(citation.pages.value ?? '');
  return {
    authors: citation.authors.value.map(canonicalAuthorToDisplay),
    title: citation.title.value ?? undefined,
    year: citation.year.value != null ? String(citation.year.value) : undefined,
    journal: citation.journal.value ? normalizeKnownContainerName(citation.journal.value) : undefined,
    volume: citation.volume.value ?? undefined,
    issue: citation.issue.value ?? undefined,
    pages: locator.kind === 'pages' ? locator.value ?? undefined : undefined,
    'article-number': locator.kind === 'article-number' ? locator.value ?? undefined : undefined,
    doi: citation.doi.value ?? undefined,
    publisher: citation.publisher.value ?? undefined,
    url: citation.url.value ?? undefined,
    conferenceTitle: citation.conferenceTitle.value ? normalizeKnownContainerName(citation.conferenceTitle.value) : undefined,
    bookTitle: citation.bookTitle.value ? normalizeKnownContainerName(citation.bookTitle.value) : undefined,
    institution: citation.institution.value ?? undefined,
    edition: citation.edition.value ?? undefined,
    editor: citation.editor.value ? canonicalAuthorToDisplay(parseAuthorToCanonical(citation.editor.value)) : undefined,
  };
}

export function normalizedField(field?: FieldValue<string | null>): string {
  return normalizeWhitespace((field?.value ?? '').toLowerCase());
}

export function firstAuthorLastName(citation: CanonicalCitation): string {
  const firstAuthor = citation.authors.value[0];
  return firstAuthor?.last ? normalizeWhitespace(firstAuthor.last.toLowerCase()) : '';
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function runWithTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timeout);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
