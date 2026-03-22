// @ts-nocheck
import { Buffer } from 'node:buffer';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { z } from 'zod';
import { getAuthorityData } from '@shared/authorityLookup';
import type { CanonicalAuthor, CitationStyle, ParsedReference, V2ConversionResponse } from '@shared/schema';
import { CitationParser } from '../citationParser.js';
import { fetchCrossrefMetadata } from '../doiEnrichment.js';
import { isGroupAuthor, normalizeGroupAuthor } from '../shared/citationSemantics.js';
import {
  canonicalReferenceTypeToParsed,
  canonicalToParsedReference,
  coerceCanonicalAuthor,
  fixUnicodeText,
  looksLikeAlternatingTokenArray,
  normalizeDoiValue,
  normalizeWhitespace,
  parseAuthorsForStyle,
  parsedReferenceTypeToCanonical,
} from './utils.js';
import {
  analyzeParsedAuthorStrings,
  getRequirementProfile,
  hasParsedVenue,
  isLocatorLike,
  isPlaceholderValue,
  looksLikeAuthorContentLeak,
  proceedingsSignal,
  sanitizeParsedReference,
} from './qualityRules.js';
import { getOpenAiExtractTimeoutMs, tryConsumeLlmCall } from './llmConfig.js';
import type {
  AuthorityLookupAdapter,
  CacheAdapter,
  ClassifierAdapter,
  EmbeddingAdapter,
  ExportAdapter,
  ExtractorAdapter,
  ResolutionCandidateRecord,
  ResolutionProviderAdapter,
  ResolutionSearchQuery,
  V2SplitArtifact,
  V2AdapterBundle,
} from './contracts.js';

const DOI_PATTERN = /\b10\.\d{4,}\/\S+\b/i;
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;
const URL_PATTERN = /https?:\/\/\S+/i;
const URL_PATTERN_GLOBAL = /https?:\/\/\S+/gi;
const REQUIRED_EXTRACTION_FIELDS: Array<keyof ParsedReference> = ['title', 'year'];
const DEFAULT_GROBID_TIMEOUT_MS = 3000;
const DEFAULT_GROBID_COOLDOWN_MS = 30000;
const PLACE_PUBLISHER_YEAR_PATTERN = /([^.;]+?):\s*([^.;]+?)\s*;\s*((?:19|20)\d{2})$/i;
const PLACE_YEAR_PATTERN = /([A-Za-z][^.;\d]*?)\s*;\s*((?:19|20)\d{2})$/i;
const METADATA_YEAR_PATTERN = /(.+?)\s*;\s*((?:19|20)\d{2})$/i;
const UPDATED_YEAR_PATTERN = /^(?:updated|revised)\s+[A-Za-z]+\s+((?:19|20)\d{2})$/i;
const YEAR_ONLY_SEGMENT_PATTERN = /^((?:19|20)\d{2})$/;
const ARXIV_SEGMENT_PATTERN = /\barxiv(?:\s+preprint)?\b/i;
const ARXIV_ID_PATTERN = /(arXiv:\d{4}\.\d{4,5}(?:v\d+)?)/i;
const EDITION_SEGMENT_PATTERN = /^(?:\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?|version\b.+)$/i;
const IDENTIFIER_SEGMENT_PATTERN = /^(?:[A-Z][A-Za-z0-9&/-]+(?:\s+[A-Z][A-Za-z0-9&/-]+){0,4}\s+)?(?:guideline|statement|manual|handbook|working paper|fact sheet|programme guide|program guide|methods manual)\s+\[[A-Z]{1,12}[A-Z0-9-]*\d+[A-Z0-9-]*\]$/i;
const INSTITUTIONAL_KEYWORD_PATTERN = /\b(?:organization|agency|administration|department|ministry|office|commission|council|library|bank|foundation|programme|program|centre|center|college|university|hospital|publisher|press|authority|academ(?:y|ies)|team|group|committee|collaboration|network|initiative|institute|society|association|union|research)\b/i;
const PERSONAL_AUTHOR_LEAD_PATTERN = /(?:^|,\s*)[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2}\s+[A-Z](?:[.-]?[A-Z]){0,5}\.?/;
const BRACKETED_IDENTIFIER_PATTERN = /\[[A-Z]{1,12}[A-Z0-9-]*\d+[A-Z0-9-]*\]/;
const INSTITUTIONAL_TAIL_PATTERN = /(?:available from:|:\s*[^.;]+;\s*(?:19|20)\d{2}$|;\s*(?:19|20)\d{2}$|(?:^|[.]\s+)version\b|\[[A-Z]{1,12}[A-Z0-9-]*\d+[A-Z0-9-]*\])/i;

let grobidCooldownUntil = 0;

const canonicalAuthorSchema = z.object({
  first: z.string().trim().min(1).nullable().optional(),
  last: z.string().trim().min(1),
  initials: z.string().trim().min(1).nullable().optional(),
  literal: z.string().trim().min(1).optional(),
});

const llmExtractionSchema = z.object({
  authors: z.array(canonicalAuthorSchema).optional().default([]),
  title: z.string().trim().nullable().optional(),
  year: z.union([z.string().trim(), z.number().int()]).nullable().optional(),
  journal: z.string().trim().nullable().optional(),
  volume: z.string().trim().nullable().optional(),
  issue: z.string().trim().nullable().optional(),
  pages: z.string().trim().nullable().optional(),
  doi: z.string().trim().nullable().optional(),
  publisher: z.string().trim().nullable().optional(),
  url: z.string().trim().nullable().optional(),
  referenceType: z.enum(['journal', 'book', 'chapter', 'conference', 'thesis', 'website', 'report', 'preprint', 'unknown']).optional().default('unknown'),
});

let parserSingleton: CitationParser | null = null;

function getParser(): CitationParser {
  if (!parserSingleton) parserSingleton = new CitationParser();
  return parserSingleton;
}

function extractJsonContent(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isGrobidCoolingDown() {
  return Date.now() < grobidCooldownUntil;
}

function openGrobidCooldown(reason: string) {
  const cooldownMs = readPositiveIntEnv('GROBID_COOLDOWN_MS', DEFAULT_GROBID_COOLDOWN_MS);
  grobidCooldownUntil = Date.now() + cooldownMs;
  console.log(JSON.stringify({
    stage: 'extract',
    adapter: 'grobid',
    event: 'cooldown_opened',
    reason,
    cooldownMs,
  }));
}

function looksLikeAuthorColonVancouverReference(input: string): boolean {
  const normalized = normalizeWhitespace(input);
  if (!/^[^:]{6,}:\s+.+\.\s+[A-Z][^.]+?\.\s+(?:19|20)\d{2}\s*[,;]\s*\d+/i.test(normalized)) {
    return false;
  }

  const authorLead = normalized.slice(0, normalized.indexOf(':')).trim();
  if (!authorLead) return false;

  const compactSingleAuthor = /^(?:[A-Z][A-Za-z'’-]+|d'[A-Za-z'’-]+)(?:\s+(?:da|de|del|der|di|du|la|le|van|von)\s+[A-Z][A-Za-z'’-]+)*(?:\s+[A-Z][A-Za-z'’-]+)*\s+[A-Z]{1,4}$/i.test(authorLead);
  const commaSeparatedCompactAuthors = ((authorLead.match(/,/g) ?? []).length >= 1 || /\bet\s+al\.?$/i.test(authorLead))
    && /\b[A-Z]{1,4}\b/.test(authorLead);

  return compactSingleAuthor || commaSeparatedCompactAuthors;
}

function preNormalizeExtractorInput(parser: CitationParser, input: string): string {
  return parser.preNormalize(fixUnicodeText(input));
}

function buildDeterministicCandidate(input: string, inputStyle: string) {
  const parser = getParser();
  const normalized = preNormalizeExtractorInput(parser, input);
  const detectedStyle = inputStyle !== 'auto'
    ? inputStyle
    : looksLikeAuthorColonVancouverReference(normalized)
      ? 'vancouver'
      : parser.detectStyle(normalized) ?? 'apa';
  const { parsed } = parser.parseReference(normalized, detectedStyle as CitationStyle);
  const doiMatch = normalized.match(DOI_PATTERN);
  if (!parsed.doi && doiMatch) {
    parsed.doi = normalizeDoiValue(doiMatch[0]);
  }

  return {
    normalized,
    parsed,
    referenceType: parsedReferenceTypeToCanonical(parser.determineReferenceType(parsed)),
    warnings: parsed.parseWarnings ?? [],
  };
}

function buildYearAnchoredCandidate(input: string) {
  const parser = getParser();
  const normalized = preNormalizeExtractorInput(parser, input);
  const parsed = parser.parseYearAnchored(normalized);
  if (!parsed) return null;
  return {
    normalized,
    parsed,
    referenceType: parsedReferenceTypeToCanonical(parser.determineReferenceType(parsed)),
    warnings: parsed.parseWarnings ?? [],
  };
}

type ExtractorSelectionBranch = 'deterministic_raw' | 'year_anchored_fallback_raw' | 'institutional_heuristic_raw';

type ParsedSelectionCandidate = {
  branch: ExtractorSelectionBranch;
  normalized: string;
  parsed: ParsedReference;
  referenceType: string;
  warnings: string[];
};

function cleanTrailingUrl(url: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(url ?? '');
  return normalized ? normalized.replace(/[).,;]+$/g, '') : undefined;
}

function extractLastYear(value: string): string | undefined {
  const matches = [...value.matchAll(YEAR_PATTERN)];
  return matches.length > 0 ? matches[matches.length - 1]?.[0] : undefined;
}

function stripTrailingPeriod(value: string): string {
  return normalizeWhitespace(value.replace(/[.]+$/g, ''));
}

function splitSentenceSegments(value: string): string[] {
  const protectedUrls: string[] = [];
  const protectedValue = value.replace(URL_PATTERN_GLOBAL, (match) => {
    const index = protectedUrls.push(match) - 1;
    return `__URL_${index}__`;
  });

  return protectedValue
    .split(/\.\s+/)
    .map((segment) => segment.replace(/__URL_(\d+)__/g, (_, index) => protectedUrls[Number(index)] ?? ''))
    .map((segment) => stripTrailingPeriod(segment))
    .filter(Boolean);
}

function looksLikeInstitutionalAcronymToken(token: string): boolean {
  const normalized = normalizeWhitespace(token).replace(/[().,;:]+$/g, '');
  if (!normalized) return false;
  if (normalized.includes('.')) return false;
  if (/^[A-Z]{2,10}$/.test(normalized)) return true;
  if (!/^[A-Z0-9][A-Za-z0-9+-]*$/.test(normalized)) return false;
  const upperCount = Array.from(normalized).filter((char) => /[A-Z]/.test(char)).length;
  const lowerCount = Array.from(normalized).filter((char) => /[a-z]/.test(char)).length;
  return lowerCount > 0 && upperCount >= 3;
}

function looksLikeInstitutionalLead(segment: string): boolean {
  const normalized = normalizeWhitespace(segment);
  if (!normalized) return false;
  if (looksLikeAlternatingTokenArray(normalized.split(/\s+/))) return false;
  if (PERSONAL_AUTHOR_LEAD_PATTERN.test(normalized) && /,\s*[A-Z](?:[.-]?[A-Z]){0,5}\.?/.test(normalized)) return false;
  if (isGroupAuthor(normalized)) return true;
  if (INSTITUTIONAL_KEYWORD_PATTERN.test(normalized) && normalized.split(/\s+/).length >= 2) return true;
  if (/^[A-Z0-9][A-Za-z0-9.+-]*$/.test(normalized)) return true;
  if (normalized.split(/\s+/).length <= 4 && normalized.split(/\s+/).some((token) => looksLikeInstitutionalAcronymToken(token))) return true;
  const connectiveTokens = new Set(['and', 'for', 'of', 'the', 'in', 'on', 'at', 'to', 'de', 'del', 'la', 'le', 'van', 'von']);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const titleCaseOrConnectorTokens = tokens.filter((token) => (
    connectiveTokens.has(token.toLowerCase())
    || /^[A-Z0-9][A-Za-z0-9.+-]*$/.test(token)
    || looksLikeInstitutionalAcronymToken(token)
  )).length;
  return tokens.length >= 3
    && titleCaseOrConnectorTokens >= Math.max(2, tokens.length - 1)
    && !/[A-Z]\.$/.test(normalized);
}

function looksLikeSourceTailFragment(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return /^available from:/i.test(normalized)
    || Boolean(URL_PATTERN.test(normalized))
    || PLACE_PUBLISHER_YEAR_PATTERN.test(normalized)
    || PLACE_YEAR_PATTERN.test(normalized)
    || ARXIV_SEGMENT_PATTERN.test(normalized);
}

function looksLikeInstitutionalAuthorList(authors: string[] | undefined): boolean {
  if (!authors || authors.length === 0) return false;
  return authors.every((author) => looksLikeInstitutionalLead(author));
}

function normalizeInstitutionalAuthor(value: string): string {
  const normalized = normalizeWhitespace(value);
  return isGroupAuthor(normalized) ? normalizeGroupAuthor(normalized) : normalized;
}

function looksLikeInstitutionalMetadataSegment(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return EDITION_SEGMENT_PATTERN.test(normalized)
    || IDENTIFIER_SEGMENT_PATTERN.test(normalized)
    || BRACKETED_IDENTIFIER_PATTERN.test(normalized);
}

function looksLikeAuthorEchoTitle(parsed: ParsedReference): boolean {
  const title = normalizeWhitespace(parsed.title ?? '').toLowerCase();
  const firstAuthor = normalizeWhitespace(parsed.authors?.[0] ?? '').toLowerCase();
  if (!title || !firstAuthor) return false;
  const normalizedAuthor = firstAuthor.replace(/,.+$/g, '');
  return title === normalizedAuthor || title.startsWith(`${normalizedAuthor}.`);
}

function buildTitleLedWebsiteCandidate(
  normalized: string,
  leadingSegment: string,
  remainder: string,
): ParsedSelectionCandidate | null {
  const url = cleanTrailingUrl(remainder.match(/\bAvailable from:\s*(https?:\/\/\S+)/i)?.[1])
    ?? cleanTrailingUrl(remainder.match(URL_PATTERN)?.[0]);
  if (!url) return null;

  const tailWithoutUrl = stripTrailingPeriod(normalizeWhitespace(
    remainder
      .replace(/\bAvailable from:\s*https?:\/\/\S+/i, '')
      .replace(URL_PATTERN, ''),
  ));
  const normalizedTail = normalizeWhitespace(tailWithoutUrl).replace(/[()]/g, '');
  const year = extractLastYear(remainder) ?? extractLastYear(leadingSegment);
  const title = stripTrailingPeriod(leadingSegment);

  if (!title || !year) return null;
  if (normalizedTail && normalizedTail !== year) return null;

  const parsed: ParsedReference = {
    title,
    year,
    url,
    parseWarnings: ['title-led-website-heuristic'],
  };

  return {
    branch: 'institutional_heuristic_raw',
    normalized,
    parsed,
    referenceType: 'website',
    warnings: parsed.parseWarnings ?? [],
  };
}

function buildInstitutionalCandidate(input: string): ParsedSelectionCandidate | null {
  const parser = getParser();
  const normalized = preNormalizeExtractorInput(parser, input);
  const authorMatch = normalized.match(/^(.+?)\.\s+(.+)$/);
  if (!authorMatch) return null;

  const leadingSegment = stripTrailingPeriod(authorMatch[1] ?? '');
  let remainder = normalizeWhitespace(authorMatch[2] ?? '');
  if (!remainder) return null;
  const likelyInstitutionalTail = INSTITUTIONAL_TAIL_PATTERN.test(remainder);
  if (!looksLikeInstitutionalLead(leadingSegment)) {
    const titleLedWebsite = buildTitleLedWebsiteCandidate(normalized, leadingSegment, remainder);
    if (titleLedWebsite) return titleLedWebsite;
    if (!likelyInstitutionalTail || PERSONAL_AUTHOR_LEAD_PATTERN.test(leadingSegment)) {
      return null;
    }
  }

  const doiMatch = normalized.match(DOI_PATTERN);
  const doi = doiMatch ? normalizeDoiValue(doiMatch[0]) : undefined;

  let url = cleanTrailingUrl(remainder.match(/\bAvailable from:\s*(https?:\/\/\S+)/i)?.[1]);
  if (url) {
    remainder = normalizeWhitespace(remainder.replace(/\bAvailable from:\s*https?:\/\/\S+/i, ''));
  } else {
    url = cleanTrailingUrl(remainder.match(URL_PATTERN)?.[0]);
    if (url) {
      remainder = normalizeWhitespace(remainder.replace(URL_PATTERN, ''));
    }
  }

  let publisher: string | undefined;
  let placeOfPublication: string | undefined;
  let year = extractLastYear(normalized);
  let edition: string | undefined;
  const placePublisherYearMatch = stripTrailingPeriod(remainder).match(PLACE_PUBLISHER_YEAR_PATTERN);
  if (placePublisherYearMatch) {
    placeOfPublication = normalizeWhitespace(placePublisherYearMatch[1] ?? '') || undefined;
    publisher = normalizeWhitespace(placePublisherYearMatch[2] ?? '') || undefined;
    year = year ?? placePublisherYearMatch[3];
    remainder = normalizeWhitespace(stripTrailingPeriod(remainder).replace(PLACE_PUBLISHER_YEAR_PATTERN, ''));
  } else {
    const strippedRemainder = stripTrailingPeriod(remainder);
    const metadataYearMatch = strippedRemainder.match(METADATA_YEAR_PATTERN);
    if (metadataYearMatch && looksLikeInstitutionalMetadataSegment(metadataYearMatch[1] ?? '')) {
      edition = normalizeWhitespace(metadataYearMatch[1] ?? '') || undefined;
      year = year ?? metadataYearMatch[2];
      remainder = normalizeWhitespace(strippedRemainder.replace(METADATA_YEAR_PATTERN, ''));
    } else {
      const placeYearMatch = strippedRemainder.match(PLACE_YEAR_PATTERN);
      if (placeYearMatch) {
        if (looksLikeInstitutionalMetadataSegment(placeYearMatch[1] ?? '')) {
          placeOfPublication = undefined;
        } else {
          placeOfPublication = normalizeWhitespace(placeYearMatch[1] ?? '') || undefined;
        }
        year = year ?? placeYearMatch[2];
        remainder = normalizeWhitespace(strippedRemainder.replace(PLACE_YEAR_PATTERN, ''));
        if (!edition && looksLikeInstitutionalMetadataSegment(placeYearMatch[1] ?? '')) {
          edition = normalizeWhitespace(placeYearMatch[1] ?? '') || undefined;
        }
      }
    }
  }

  const segments = splitSentenceSegments(remainder);
  if (segments.length === 0) return null;

  let preprint = false;
  const titleSegments: string[] = [];
  for (const segment of segments) {
    const metadataYear = segment.match(METADATA_YEAR_PATTERN);
    if (metadataYear && looksLikeInstitutionalMetadataSegment(metadataYear[1] ?? '')) {
      edition = edition ?? (normalizeWhitespace(metadataYear[1] ?? '') || undefined);
      year = year ?? metadataYear[2];
      continue;
    }

    if (YEAR_ONLY_SEGMENT_PATTERN.test(segment)) {
      year = year ?? segment.match(YEAR_ONLY_SEGMENT_PATTERN)?.[1];
      continue;
    }

    const updatedYear = segment.match(UPDATED_YEAR_PATTERN)?.[1];
    if (updatedYear) {
      year = year ?? updatedYear;
      continue;
    }

    if (ARXIV_SEGMENT_PATTERN.test(segment)) {
      preprint = true;
      const arxivId = cleanTrailingUrl(segment.match(ARXIV_ID_PATTERN)?.[1]);
      if (!url && arxivId) {
        url = `https://arxiv.org/abs/${arxivId.replace(/^arXiv:/i, '')}`;
      }
      continue;
    }

    if (!edition && looksLikeInstitutionalMetadataSegment(segment)) {
      edition = segment;
      continue;
    }

    titleSegments.push(segment);
  }

  let title = normalizeWhitespace(titleSegments.join('. '));
  if (!title) return null;

  let referenceType: ParsedSelectionCandidate['referenceType'] = 'report';
  if (preprint) {
    referenceType = 'preprint';
  } else if (edition && /\b(?:ed(?:ition)?|manual|handbook|style|guide)\b/i.test(`${title} ${edition}`)) {
    referenceType = 'book';
  } else if (url && !publisher) {
    referenceType = 'website';
  }

  const normalizedAuthor = normalizeInstitutionalAuthor(leadingSegment);
  const parsed: ParsedReference = {
    authors: [normalizedAuthor],
    title,
    year,
    doi,
    publisher,
    url,
    institution: referenceType === 'report' || referenceType === 'preprint' ? normalizedAuthor : publisher ?? normalizedAuthor,
    edition,
    placeOfPublication,
    journal: preprint ? 'arXiv preprint' : undefined,
    parseWarnings: ['institutional-heuristic'],
  };

  return {
    branch: 'institutional_heuristic_raw',
    normalized,
    parsed,
    referenceType,
    warnings: parsed.parseWarnings ?? [],
  };
}

function xmlDecoded(value: string): string {
  return normalizeWhitespace(value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

function stripXml(value: string): string {
  return xmlDecoded(value.replace(/<[^>]+>/g, ' '));
}

function firstXmlMatch(value: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(value);
  return match?.[1] ? stripXml(match[1]) : undefined;
}

function xmlMatches(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => stripXml(match[1])).filter(Boolean);
}

function parseGrobidTei(tei: string) {
  const authorBlocks = [...tei.matchAll(/<author\b[\s\S]*?>([\s\S]*?)<\/author>/gi)];
  const authors = authorBlocks.map((match) => {
    const block = match[1];
    const surname = firstXmlMatch(block, /<surname[^>]*>([\s\S]*?)<\/surname>/i)
      ?? firstXmlMatch(block, /<family[^>]*>([\s\S]*?)<\/family>/i)
      ?? '';
    const firstNames = xmlMatches(block, /<forename[^>]*>([\s\S]*?)<\/forename>/gi);
    const first = firstNames.length > 0 ? firstNames.join(' ') : null;
    const initials = first
      ? first.split(/\s+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ''}.`).join(' ')
      : null;
    return {
      last: surname,
      first,
      initials: initials || null,
    };
  }).filter((author) => author.last);

  const title = firstXmlMatch(tei, /<title[^>]+level="a"[^>]*>([\s\S]*?)<\/title>/i)
    ?? firstXmlMatch(tei, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const journal = firstXmlMatch(tei, /<title[^>]+level="j"[^>]*>([\s\S]*?)<\/title>/i);
  const bookTitle = firstXmlMatch(tei, /<title[^>]+level="m"[^>]*>([\s\S]*?)<\/title>/i);
  const conferenceTitle = firstXmlMatch(tei, /<meeting[^>]*>([\s\S]*?)<\/meeting>/i);
  const volume = firstXmlMatch(tei, /<biblScope[^>]+unit="volume"[^>]*>([\s\S]*?)<\/biblScope>/i);
  const issue = firstXmlMatch(tei, /<biblScope[^>]+unit="issue"[^>]*>([\s\S]*?)<\/biblScope>/i);
  const fromPage = firstXmlMatch(tei, /<biblScope[^>]+unit="page"[^>]+from="([^"]+)"/i);
  const toPage = firstXmlMatch(tei, /<biblScope[^>]+unit="page"[^>]+to="([^"]+)"/i);
  const pages = fromPage && toPage ? `${fromPage}-${toPage}` : firstXmlMatch(tei, /<biblScope[^>]+unit="page"[^>]*>([\s\S]*?)<\/biblScope>/i);
  const publisher = firstXmlMatch(tei, /<publisher[^>]*>([\s\S]*?)<\/publisher>/i);
  const doi = normalizeDoiValue(firstXmlMatch(tei, /<idno[^>]+type="DOI"[^>]*>([\s\S]*?)<\/idno>/i) ?? '');
  const url = firstXmlMatch(tei, /<ptr[^>]+target="([^"]+)"/i) ?? firstXmlMatch(tei, /<idno[^>]+type="URL"[^>]*>([\s\S]*?)<\/idno>/i);
  const yearMatch = tei.match(/<date[^>]+when="(\d{4})[^"]*"/i) ?? tei.match(/<date[^>]*>([\s\S]*?\b(?:19|20)\d{2}\b[\s\S]*?)<\/date>/i);
  const year = yearMatch?.[1]?.match(/\b(19|20)\d{2}\b/)?.[0];

  const parsed: ParsedReference = {
    authors: authors.map((author) => author.first ? `${author.last}, ${author.first}` : author.last),
    title,
    year,
    journal,
    volume,
    issue,
    pages,
    doi: doi || undefined,
    publisher,
    url,
    conferenceTitle,
    bookTitle,
  };

  const referenceType = conferenceTitle
    ? 'conference'
    : journal
      ? 'journal'
      : bookTitle
        ? 'book'
        : parsedReferenceTypeToCanonical(getParser().determineReferenceType(parsed));

  return {
    parsed,
    referenceType,
    warnings: [] as string[],
  };
}

async function extractWithGrobid(input: string): Promise<ReturnType<typeof parseGrobidTei> | null> {
  if (!/^(1|true|yes|on)$/i.test(process.env.ENABLE_GROBID_EXTRACTOR ?? '')) {
    return null;
  }
  if (isGrobidCoolingDown()) {
    return null;
  }
  const baseUrl = (process.env.GROBID_URL ?? 'http://localhost:8070').replace(/\/$/, '');
  const body = new URLSearchParams({
    citations: input,
    consolidateCitations: '0',
    includeRawCitations: '1',
  });
  const timeoutMs = readPositiveIntEnv('GROBID_TIMEOUT_MS', DEFAULT_GROBID_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/api/processCitation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 503) {
        openGrobidCooldown(`status_${response.status}`);
      }
      throw new Error(`GROBID ${response.status}`);
    }

    const tei = await response.text();
    if (!tei.trim()) return null;
    return parseGrobidTei(tei);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timed out') || message.includes('TimeoutError') || message.includes('AbortError')) {
      openGrobidCooldown('timeout');
    }
    throw error;
  }
}

function looksLikeDateFragment(value: string | undefined): boolean {
  if (!value) return false;
  return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(value) || /^\d{1,2}[;:/]/.test(value);
}

function looksLikeMergedAuthorBlob(author: string): boolean {
  const normalized = normalizeWhitespace(author);
  if (looksLikeAuthorContentLeak(normalized)) return true;
  const commaCount = (normalized.match(/,/g) ?? []).length;
  return !isGroupAuthor(normalized) && (commaCount >= 2 || /\b(?:and|&)\b/.test(normalized));
}

function isPlaceholderVenue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized === 'vol' || normalized === 'vol.' || normalized === 'journal' || normalized === '?';
}

function scoreCandidate(parsed: ParsedReference | null | undefined, referenceType?: string): number {
  if (!parsed) return -999;
  const requirements = getRequirementProfile(referenceType ?? 'journal');
  const authorSignals = analyzeParsedAuthorStrings(parsed.authors);
  const locatorValue = parsed.pages ?? parsed['article-number'];
  let score = 0;
  if (parsed.title && parsed.title.split(/\s+/).length >= 4 && !looksLikeDateFragment(parsed.title) && !looksLikeSourceTailFragment(parsed.title)) score += 4;
  else if (parsed.title && !looksLikeSourceTailFragment(parsed.title)) score += 1.5;
  if (parsed.year) score += 2.5;
  if (hasParsedVenue(parsed)) score += 3;
  if (parsed.publisher || parsed.institution) score += 1.5;
  if (parsed.authors?.length) score += 3.5;
  if (parsed.volume) score += requirements.expected.includes('volume') ? 1 : 0.3;
  if (parsed.issue) score += requirements.expected.includes('issue') ? 1 : 0.3;
  if (isLocatorLike(locatorValue)) score += requirements.expected.includes('locator') ? 1.2 : 0.4;
  if (parsed.authors && looksLikeAlternatingTokenArray(parsed.authors)) score -= 2;
  if (parsed.authors?.some((author) => looksLikeMergedAuthorBlob(author))) score -= 4;
  if (authorSignals.mergedBlobCount > 0) score -= authorSignals.mergedBlobCount * 2.5;
  if (authorSignals.contaminatedBlobCount > 0) score -= authorSignals.contaminatedBlobCount * 6;
  if (authorSignals.initialsOnlyCount > Math.ceil((parsed.authors?.length ?? 0) / 2)) score -= 2;
  if (authorSignals.singleCharacterTailCount > 0) score -= authorSignals.singleCharacterTailCount * 0.35;
  score += authorSignals.richness * 1.5;
  if ((parsed.authors?.length ?? 0) >= 2 && authorSignals.compactVancouverCount === (parsed.authors?.length ?? 0)) score += 1.4;
  if (parsed.authors?.some((author) => author.length > 120 || /\. .+\./.test(author))) score -= 3;
  if (looksLikeInstitutionalAuthorList(parsed.authors)) score += 0.8;
  if (parsed.title && looksLikeSourceTailFragment(parsed.title)) score -= 3.5;
  if (looksLikeAuthorEchoTitle(parsed)) score -= 5;
  if (isPlaceholderVenue(parsed.journal) || isPlaceholderVenue(parsed.volume) || isPlaceholderVenue(parsed.issue)) score -= 3;
  if (proceedingsSignal(parsed.conferenceTitle ?? parsed.bookTitle ?? parsed.journal) && (parsed.conferenceTitle || parsed.bookTitle || parsed.journal)) score += 1;
  if (referenceType && referenceType !== 'unknown') score += 1;
  return score;
}

function selectionReason(
  selectedBranch: ExtractorSelectionBranch,
  deterministic: ParsedReference,
  fallback: ParsedReference | null,
  institutional: ParsedReference | null,
): string {
  if (selectedBranch === 'deterministic_raw') {
    if (!fallback && !institutional) return 'no_competing_candidate';
    if (looksLikeAlternatingTokenArray(deterministic.authors ?? [])) return 'deterministic_retained_for_structured_fields_with_author_recovery';
    return 'deterministic_scored_higher';
  }
  if (selectedBranch === 'institutional_heuristic_raw') {
    if (!deterministic.title && institutional?.title) return 'deterministic_missing_title_institutional_selected';
    if (looksLikeSourceTailFragment(deterministic.title)) return 'deterministic_title_looked_like_source_tail';
    return 'institutional_heuristic_scored_higher';
  }
  if (!deterministic.title && fallback?.title) return 'deterministic_missing_title';
  if ((!deterministic.authors || deterministic.authors.length === 0) && fallback?.authors?.length) return 'deterministic_missing_authors';
  return 'year_anchored_scored_higher';
}

function fillMissingFromFallback(selected: ParsedReference, fallback: ParsedReference | null): ParsedReference {
  if (!fallback) return selected;
  const merged: ParsedReference = { ...selected };
  for (const field of ['title', 'year', 'journal', 'conferenceTitle', 'bookTitle', 'volume', 'issue', 'pages', 'article-number', 'publisher', 'url', 'doi', 'institution', 'edition', 'editor'] as const) {
    if (!merged[field] && fallback[field]) {
      merged[field] = fallback[field];
    }
  }
  const fallbackAuthorEchoesSelectedTitle = Boolean(
    (!merged.authors || merged.authors.length === 0)
    && fallback.authors?.length === 1
    && merged.title
    && normalizeWhitespace((fallback.authors[0] ?? '').toLowerCase()) === normalizeWhitespace(merged.title.toLowerCase()),
  );
  if ((!merged.authors || merged.authors.length === 0) && fallback.authors?.length && !fallbackAuthorEchoesSelectedTitle) {
    merged.authors = fallback.authors;
  }
  return merged;
}

function buildFieldConfidence(parsed: ParsedReference, referenceType: string) {
  const authorSignals = analyzeParsedAuthorStrings(parsed.authors);
  const locatorValue = parsed.pages ?? parsed['article-number'];
  const institutionalAuthors = looksLikeInstitutionalAuthorList(parsed.authors);
  const institutionalVenue = normalizeWhitespace(parsed.institution ?? parsed.publisher ?? '');
  const institutionalPublisher = Boolean(institutionalVenue) && isGroupAuthor(institutionalVenue);
  const titleEchoesAuthor = looksLikeAuthorEchoTitle(parsed);
  const mostlyCompactVancouver = (parsed.authors?.length ?? 0) >= 2
    && authorSignals.compactVancouverCount >= Math.ceil((parsed.authors?.length ?? 0) * 0.7);
  const authorConfidenceFloor = authorSignals.contaminatedBlobCount > 0 ? 0.05 : 0.25;
  const authorConfidence = parsed.authors?.length
    ? Math.max(
      authorConfidenceFloor,
      Math.min(
        0.97,
        0.84
          + (authorSignals.richness * 0.05)
          - (authorSignals.mergedBlobCount * 0.18)
          - (authorSignals.contaminatedBlobCount * 0.5)
          - (authorSignals.singleCharacterTailCount * 0.03)
          - (authorSignals.initialsOnlyCount > Math.ceil((parsed.authors?.length ?? 0) / 2) ? 0.08 : 0)
          + (mostlyCompactVancouver ? 0.08 : 0)
          + (institutionalAuthors ? 0.06 : 0),
      ),
    )
    : 0.2;
  const publisherConfidence = parsed.publisher || parsed.institution
    ? (institutionalPublisher ? 0.9 : 0.74)
    : 0.1;
  return {
    authors: institutionalAuthors ? Math.max(authorConfidence, 0.9) : authorConfidence,
    title: parsed.title ? ((looksLikeDateFragment(parsed.title) || looksLikeSourceTailFragment(parsed.title) || titleEchoesAuthor) ? 0.18 : 0.9) : 0.2,
    year: parsed.year ? 0.92 : 0.1,
    journal: hasParsedVenue(parsed) ? 0.82 : (referenceType === 'journal' ? 0.18 : 0.12),
    volume: parsed.volume ? 0.82 : 0.1,
    issue: parsed.issue ? 0.8 : 0.1,
    pages: isLocatorLike(locatorValue) ? 0.82 : 0.1,
    doi: parsed.doi ? 0.96 : 0.05,
    publisher: publisherConfidence,
    url: parsed.url ? 0.9 : 0.05,
  } as const;
}

function needsLlmFallback(parsed: ParsedReference, fieldConfidence: Record<string, number>): boolean {
  const missingRequired = REQUIRED_EXTRACTION_FIELDS.some((field) => !parsed[field]);
  const lowConfidenceCritical = ['authors', 'title', 'year']
    .map((field) => fieldConfidence[field] ?? 0)
    .some((value) => value < 0.45);
  return missingRequired || lowConfidenceCritical;
}

function splitContaminationPenalty(splitArtifact?: V2SplitArtifact): number {
  if (!splitArtifact) return 0;

  let penalty = 0;
  if (splitArtifact.contaminationFlags.includes('header_bleed_suspected')) penalty += 0.08;
  if (splitArtifact.contaminationFlags.includes('page_artifact_present')) penalty += 0.07;
  if (splitArtifact.contaminationFlags.includes('multiline_truncation_suspected')) penalty += 0.1;
  if (splitArtifact.contaminationFlags.includes('oversized_chunk')) penalty += 0.12;
  if (splitArtifact.contaminationFlags.includes('doi_orphan')) penalty += 0.16;
  return Math.min(0.28, penalty);
}

function applySplitPenaltyToFieldConfidence(
  fieldConfidence: ReturnType<typeof buildFieldConfidence>,
  penalty: number,
) {
  if (penalty <= 0) return fieldConfidence;

  return {
    ...fieldConfidence,
    authors: Math.max(0.05, fieldConfidence.authors - penalty),
    title: Math.max(0.05, fieldConfidence.title - penalty),
    year: Math.max(0.05, fieldConfidence.year - (penalty * 0.8)),
    journal: Math.max(0.05, fieldConfidence.journal - (penalty * 0.75)),
    volume: Math.max(0.05, fieldConfidence.volume - (penalty * 0.5)),
    issue: Math.max(0.05, fieldConfidence.issue - (penalty * 0.5)),
    pages: Math.max(0.05, fieldConfidence.pages - (penalty * 0.65)),
    doi: Math.max(0.05, fieldConfidence.doi - (penalty * 0.35)),
    publisher: Math.max(0.05, fieldConfidence.publisher - (penalty * 0.45)),
    url: Math.max(0.05, fieldConfidence.url - (penalty * 0.3)),
  };
}

async function extractWithLlm(input: string): Promise<z.infer<typeof llmExtractionSchema> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_EXTRACT_MODEL ?? 'gpt-4o-mini';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'Extract academic citation fields into strict JSON.',
            'Return canonical raw fields only.',
            'Never return formatted citation strings or formatted author lists.',
            'authors must be an array of objects with first, last, initials, and optional literal.',
          ].join(' '),
        },
        {
          role: 'user',
          content: input,
        },
      ],
    }),
    signal: AbortSignal.timeout(getOpenAiExtractTimeoutMs()),
  });

  if (!response.ok) {
    throw new Error(`LLM extraction failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const parsed = llmExtractionSchema.parse(JSON.parse(extractJsonContent(content)));
  return parsed;
}

function mergeLlmWithDeterministic(
  deterministic: { parsed: ParsedReference; referenceType: ReturnType<typeof parsedReferenceTypeToCanonical> },
  llm: z.infer<typeof llmExtractionSchema>,
) {
  const parsed = {
    ...deterministic.parsed,
    authors: llm.authors.length > 0
      ? llm.authors.map((author) => {
        const coerced = coerceCanonicalAuthor(author as CanonicalAuthor);
        return coerced.literal ?? `${coerced.last}${coerced.first ? `, ${coerced.first}` : ''}`;
      })
      : deterministic.parsed.authors,
    title: llm.title ?? deterministic.parsed.title,
    year: llm.year != null ? String(llm.year) : deterministic.parsed.year,
    journal: llm.journal ?? deterministic.parsed.journal,
    volume: llm.volume ?? deterministic.parsed.volume,
    issue: llm.issue ?? deterministic.parsed.issue,
    pages: llm.pages ?? deterministic.parsed.pages,
    'article-number': deterministic.parsed['article-number'],
    doi: llm.doi ? normalizeDoiValue(llm.doi) : deterministic.parsed.doi,
    publisher: llm.publisher ?? deterministic.parsed.publisher,
    url: llm.url ?? deterministic.parsed.url,
    conferenceTitle: deterministic.parsed.conferenceTitle,
    bookTitle: deterministic.parsed.bookTitle,
    institution: deterministic.parsed.institution,
    edition: deterministic.parsed.edition,
    editor: deterministic.parsed.editor,
  };

  return {
    parsed,
    referenceType: llm.referenceType !== 'unknown' ? llm.referenceType : deterministic.referenceType,
    fieldConfidence: {
      ...deterministic.fieldConfidence,
      authors: llm.authors.length > 0 ? 0.78 : deterministic.fieldConfidence.authors,
      title: llm.title ? 0.76 : deterministic.fieldConfidence.title,
      year: llm.year != null ? 0.78 : deterministic.fieldConfidence.year,
      journal: llm.journal ? 0.72 : deterministic.fieldConfidence.journal,
      volume: llm.volume ? 0.7 : deterministic.fieldConfidence.volume,
      issue: llm.issue ? 0.7 : deterministic.fieldConfidence.issue,
      pages: llm.pages ? 0.72 : deterministic.fieldConfidence.pages,
      doi: llm.doi ? 0.86 : deterministic.fieldConfidence.doi,
      publisher: llm.publisher ? 0.72 : deterministic.fieldConfidence.publisher,
      url: llm.url ? 0.8 : deterministic.fieldConfidence.url,
    },
  };
}

function renderAuthor(author: CanonicalAuthor): string {
  if (author.literal) return author.literal;
  const normalizedFirst = normalizeWhitespace(author.first ?? '');
  const firstLooksLikeInitials = Boolean(normalizedFirst) && /^[\p{Lu}](?:[.-]?[\p{Lu}]){0,5}\.?$/u.test(normalizedFirst.replace(/\s+/g, ''));
  const firstInitialCount = (normalizeWhitespace(author.first ?? '').match(/[\p{Lu}](?=\.|\b)/gu) ?? []).length;
  const storedInitialCount = (normalizeWhitespace(author.initials ?? '').match(/[\p{Lu}](?=\.|\b)/gu) ?? []).length;
  if (author.initials && storedInitialCount > firstInitialCount) return `${author.last}, ${author.initials}`;
  if (author.first && !firstLooksLikeInitials) return `${author.last}, ${author.first}`;
  if (author.initials) return `${author.last}, ${author.initials}`;
  if (author.first) return `${author.last}, ${author.first}`;
  return author.last;
}

function exportableCitations(response: V2ConversionResponse) {
  return response.citations.filter((citation) => citation.status !== 'duplicate');
}

class DefaultClassifierAdapter implements ClassifierAdapter {
  readonly id = 'default-heuristic-classifier';

  async detectStyle(input: string): Promise<{ style: CitationStyle | null; confidence: number }> {
    const parser = getParser();
    const normalized = preNormalizeExtractorInput(parser, input);
    if (looksLikeAuthorColonVancouverReference(normalized)) {
      return { style: 'vancouver', confidence: 0.9 };
    }
    if (/^\s*\[\d+\]/.test(normalized) || /\bvol\.\s*\d+/i.test(normalized) && /"\s*,?\s*[A-Z]/.test(normalized)) {
      return { style: 'ieee', confidence: 0.91 };
    }
    if (/\.\s+\d{4};\d+(?:\(\d+\))?:\S+/i.test(normalized) || /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+[A-Z]{1,4}\.\s+\d{4};/.test(normalized)) {
      return { style: 'vancouver', confidence: 0.9 };
    }
    if (/\(\d{4}\)\.\s+/.test(normalized)) {
      return { style: 'apa', confidence: 0.88 };
    }
    if (/".+?"\s+[A-Z]/.test(normalized) && /\bvol\.\s*\d+/i.test(normalized)) {
      return { style: 'mla', confidence: 0.82 };
    }
    if (/\b\d{4}\.\s+.+,\s+\d+\(\d+\),\s+pp?\./i.test(normalized)) {
      return { style: 'harvard', confidence: 0.86 };
    }
    const detected = parser.detectStyle(normalized);
    return {
      style: detected,
      confidence: detected ? 0.84 : 0.35,
    };
  }
}

class DefaultExtractorAdapter implements ExtractorAdapter {
  readonly id = 'default-parser-extractor';

  async extract(input: string, inputStyle: string, options?: {
    inputProfile?: { structure: string; estimatedCount?: number };
    detectionConfidence?: number;
    batchSize?: number;
    splitArtifact?: V2SplitArtifact;
    llmBudget?: { maxCalls: number; totalCalls: number; splitCalls: number; extractCalls: number; capReached: boolean };
  }) {
    const deterministicBase = buildDeterministicCandidate(input, inputStyle);
    const deterministicSanitized = sanitizeParsedReference(deterministicBase.parsed, deterministicBase.referenceType);
    const deterministic = {
      ...deterministicBase,
      parsed: deterministicSanitized.parsed,
      referenceType: deterministicSanitized.referenceType,
    };
    const fallbackBase = buildYearAnchoredCandidate(input);
    const fallback = fallbackBase
      ? (() => {
          const sanitized = sanitizeParsedReference(fallbackBase.parsed, fallbackBase.referenceType);
          return {
            ...fallbackBase,
            parsed: sanitized.parsed,
            referenceType: sanitized.referenceType,
          };
        })()
      : null;
    const institutionalBase = buildInstitutionalCandidate(input);
    const institutional = institutionalBase
      ? (() => {
          const sanitized = sanitizeParsedReference(institutionalBase.parsed, institutionalBase.referenceType);
          return {
            ...institutionalBase,
            parsed: sanitized.parsed,
            referenceType: sanitized.referenceType,
          };
        })()
      : null;
    const deterministicAuthorParse = parseAuthorsForStyle(deterministic.parsed.authors ?? [], inputStyle);
    const fallbackAuthorParse = parseAuthorsForStyle(fallback?.parsed.authors ?? [], inputStyle);
    const institutionalAuthorParse = parseAuthorsForStyle(institutional?.parsed.authors ?? [], inputStyle);
    const deterministicScore = scoreCandidate(deterministic.parsed, deterministic.referenceType)
      - (deterministicAuthorParse.warningFlags.length * 2)
      - (deterministicAuthorParse.rejectedCandidates.length * 1.5)
      + ((deterministicAuthorParse.parserMode === 'alternating_pairs' || deterministicAuthorParse.parserMode === 'surname_given_pairs') ? 8 : 0);
    const fallbackScore = scoreCandidate(fallback?.parsed, fallback?.referenceType)
      - (fallbackAuthorParse.warningFlags.length * 2)
      - (fallbackAuthorParse.rejectedCandidates.length * 1.5);
    const institutionalScore = scoreCandidate(institutional?.parsed, institutional?.referenceType)
      - (institutionalAuthorParse.warningFlags.length * 2)
      - (institutionalAuthorParse.rejectedCandidates.length * 1.5)
      + (institutional ? 1.2 : 0);
    const scoredCandidates = [
      {
        branch: 'deterministic_raw' as const,
        candidate: deterministic,
        score: deterministicScore,
      },
      ...(fallback ? [{
        branch: 'year_anchored_fallback_raw' as const,
        candidate: fallback,
        score: fallbackScore,
      }] : []),
      ...(institutional ? [{
        branch: 'institutional_heuristic_raw' as const,
        candidate: institutional,
        score: institutionalScore,
      }] : []),
    ].sort((left, right) => right.score - left.score);
    const selectedCandidate = scoredCandidates[0] ?? {
      branch: 'deterministic_raw' as const,
      candidate: deterministic,
      score: deterministicScore,
    };
    const selectedBranch = selectedCandidate.branch;
    const selectedBase = selectedCandidate.candidate;
    let mergedSelection = selectedBase.parsed;
    for (const alternate of scoredCandidates.slice(1)) {
      mergedSelection = fillMissingFromFallback(mergedSelection, alternate.candidate.parsed);
    }
    let selectedReferenceType = selectedBase.referenceType;
    if (selectedReferenceType === 'unknown') {
      const promotedReferenceType = scoredCandidates.find((entry) => entry.candidate.referenceType !== 'unknown')?.candidate.referenceType;
      if (promotedReferenceType) selectedReferenceType = promotedReferenceType;
    }
    const selectedReason = selectionReason(selectedBranch, deterministic.parsed, fallback?.parsed ?? null, institutional?.parsed ?? null);
    const selectedAuthorParse = selectedBranch === 'year_anchored_fallback_raw'
      ? fallbackAuthorParse
      : selectedBranch === 'institutional_heuristic_raw'
        ? institutionalAuthorParse
        : deterministicAuthorParse;
    let selectedFieldConfidence = buildFieldConfidence(mergedSelection, selectedReferenceType);
    const splitArtifact = options?.splitArtifact;
    const splitContaminationFlags = splitArtifact?.contaminationFlags ?? [];
    const splitPenalty = splitContaminationPenalty(splitArtifact);
    const splitWarnings = splitContaminationFlags.map((flag) => `split_contamination:${flag}`);
    const contaminationScorePenalty = splitPenalty * 10;
    if (splitPenalty > 0) {
      selectedFieldConfidence = applySplitPenaltyToFieldConfidence(selectedFieldConfidence, splitPenalty);
    }
    let extractorPath: 'deterministic' | 'grobid' | 'llm' | 'hybrid' = 'deterministic';
    const rejectedCandidates: string[] = [];
    if (looksLikeAlternatingTokenArray(deterministic.parsed.authors ?? [])) rejectedCandidates.push('deterministic_alternating_author_tokens');
    if (fallback?.parsed.title && looksLikeDateFragment(fallback.parsed.title)) rejectedCandidates.push('year_anchored_title_looks_like_date_fragment');
    if (institutional && selectedBranch !== 'institutional_heuristic_raw') rejectedCandidates.push('institutional_heuristic_not_selected');

    const inputStructure = options?.inputProfile?.structure ?? 'unknown';
    const batchSize = options?.batchSize ?? options?.inputProfile?.estimatedCount ?? 1;
    const grobidEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_GROBID_EXTRACTOR ?? '');
    const llmEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_LLM_EXTRACTOR ?? '1') && Boolean(process.env.OPENAI_API_KEY);
    const detectionConfidence = options?.detectionConfidence ?? 0;
    const profilePrefersGrobid = inputStructure === 'semi_structured'
      || inputStructure === 'unstructured'
      || splitContaminationFlags.some((flag) => ['header_bleed_suspected', 'page_artifact_present', 'multiline_truncation_suspected', 'oversized_chunk'].includes(flag));

    let llmApplied = false;
    let llmAttempted = false;
    let llmCapReached = false;
    const llmWarnings: string[] = [];

    const weakSelection =
      needsLlmFallback(mergedSelection, selectedFieldConfidence)
      || (selectedCandidate.score - contaminationScorePenalty) < 8
      || selectedAuthorParse.warningFlags.length > 0
      || selectedAuthorParse.rejectedCandidates.length > 0
      || splitContaminationFlags.length > 0;

    if (llmEnabled && weakSelection) {
      llmAttempted = true;
      if (!tryConsumeLlmCall(options?.llmBudget, 'extract')) {
        llmCapReached = true;
        rejectedCandidates.push('llm_cap_reached');
        llmWarnings.push('llm_cap_reached');
      } else {
        try {
          const llm = await extractWithLlm(selectedBase.normalized);
          if (llm) {
            const merged = mergeLlmWithDeterministic({ parsed: mergedSelection, referenceType: selectedReferenceType }, llm);
            const sanitizedHybrid = sanitizeParsedReference(merged.parsed, merged.referenceType);
            mergedSelection = sanitizedHybrid.parsed;
            selectedReferenceType = sanitizedHybrid.referenceType;
            selectedFieldConfidence = {
              ...merged.fieldConfidence,
              ...applySplitPenaltyToFieldConfidence(buildFieldConfidence(mergedSelection, selectedReferenceType), splitPenalty),
            };
            extractorPath = 'llm';
            llmApplied = true;
            llmWarnings.push('llm_fallback_applied');
          } else {
            rejectedCandidates.push('llm_unavailable');
            llmWarnings.push('llm_fallback_unavailable');
          }
        } catch (error) {
          rejectedCandidates.push('llm_invalid_or_failed');
          llmWarnings.push(`llm_fallback_failed:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const currentSelectionScore = scoreCandidate(mergedSelection, selectedReferenceType);
    const grobidRouteReason = (
      needsLlmFallback(mergedSelection, selectedFieldConfidence)
      || (currentSelectionScore - contaminationScorePenalty) < 8
      || splitContaminationFlags.length > 0
    )
          ? 'weak_selected_parse'
      : detectionConfidence < 0.65
        ? 'low_detection_confidence'
        : profilePrefersGrobid && detectionConfidence < 0.9
          ? 'noisy_profile_medium_confidence'
          : 'not_needed';
    const shouldTryGrobid = grobidEnabled && grobidRouteReason !== 'not_needed';

    if (grobidEnabled && !shouldTryGrobid) {
      console.log(JSON.stringify({
        stage: 'extract',
        adapter: 'grobid',
        event: 'skipped',
        reason: grobidRouteReason,
        batchSize,
        detectionConfidence,
        inputStructure,
      }));
    }

    let grobidCandidate: ReturnType<typeof parseGrobidTei> | null = null;
    let grobidScore = -999;
    if (shouldTryGrobid) {
      try {
        console.log(JSON.stringify({
          stage: 'extract',
          adapter: 'grobid',
          event: 'attempting',
          batchSize,
          detectionConfidence,
          inputStructure,
          reason: grobidRouteReason,
        }));
        grobidCandidate = await extractWithGrobid(input);
        if (grobidCandidate) {
          grobidScore = scoreCandidate(grobidCandidate.parsed, grobidCandidate.referenceType) + 1;
          const grobidPreferredProfile = ['structured', 'semi_structured'].includes(inputStructure);
          const currentBestScore = Math.max(currentSelectionScore, deterministicScore, fallbackScore, institutionalScore);
          const grobidLooksUsable = Boolean(grobidCandidate.parsed.title) && Boolean(grobidCandidate.parsed.authors?.length);
          if (
            (grobidLooksUsable && grobidPreferredProfile)
            || grobidScore > currentBestScore + 0.5
            || (grobidPreferredProfile && grobidLooksUsable && grobidScore >= currentBestScore - 0.25)
          ) {
            mergedSelection = fillMissingFromFallback(grobidCandidate.parsed, mergedSelection);
            selectedReferenceType = grobidCandidate.referenceType;
            selectedFieldConfidence = applySplitPenaltyToFieldConfidence(
              buildFieldConfidence(mergedSelection, selectedReferenceType),
              splitPenalty,
            );
            extractorPath = llmApplied ? 'hybrid' : 'grobid';
            console.log(JSON.stringify({
              stage: 'extract',
              adapter: 'grobid',
              event: 'selected',
              batchSize,
              detectionConfidence,
              inputStructure,
              reason: grobidRouteReason,
              grobidScore,
              deterministicScore,
              fallbackScore,
              institutionalScore,
              currentSelectionScore,
            }));
          } else {
            console.log(JSON.stringify({
              stage: 'extract',
              adapter: 'grobid',
              event: 'attempted_not_selected',
              batchSize,
              detectionConfidence,
              inputStructure,
              reason: grobidRouteReason,
              grobidScore,
              deterministicScore,
              fallbackScore,
              institutionalScore,
              currentSelectionScore,
            }));
          }
        }
      } catch (error) {
        rejectedCandidates.push(`grobid_failed:${error instanceof Error ? error.message : String(error)}`);
        console.log(JSON.stringify({
          stage: 'extract',
          adapter: 'grobid',
          event: 'failed',
          batchSize,
          detectionConfidence,
          inputStructure,
          reason: grobidRouteReason,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const selectionReasonSuffix = llmApplied
      ? '_with_llm_fill'
      : llmCapReached
        ? '_llm_cap_reached'
        : llmAttempted && llmWarnings.some((warning) => warning.startsWith('llm_fallback_') || warning === 'llm_cap_reached')
          ? '_llm_invalid_or_failed'
          : '';

    return {
      parsed: mergedSelection,
      referenceType: selectedReferenceType,
      method: llmApplied ? 'hybrid' as const : 'deterministic' as const,
      fallbackUsed: llmApplied || llmAttempted || llmCapReached,
      extractorPath,
      selectedBranch: llmApplied ? 'hybrid' as const : selectedBranch,
      selectionReason: `${selectedReason}${selectionReasonSuffix}`,
      rejectedCandidates,
      llmCapReached,
      fieldConfidence: selectedFieldConfidence,
      warnings: [
        ...deterministic.warnings,
        ...(fallback?.warnings ?? []),
        ...(institutional?.warnings ?? []),
        ...splitWarnings,
        ...llmWarnings,
      ],
      debug: {
        deterministic_raw: deterministic.parsed,
        year_anchored_fallback_raw: fallback?.parsed ?? null,
        institutional_heuristic_raw: institutional?.parsed ?? null,
        grobid_raw: grobidCandidate?.parsed ?? null,
        selected_branch: llmApplied ? 'hybrid' : selectedBranch,
        selection_reason: `${selectedReason}${selectionReasonSuffix}`,
        extractor_path: extractorPath,
        deterministic_score: deterministicScore,
        fallback_score: fallbackScore,
        institutional_score: institutionalScore,
        grobid_score: grobidScore,
        deterministic_author_parser_mode: deterministicAuthorParse.parserMode,
        deterministic_author_warning_flags: deterministicAuthorParse.warningFlags,
        fallback_author_parser_mode: fallbackAuthorParse.parserMode,
        fallback_author_warning_flags: fallbackAuthorParse.warningFlags,
        institutional_author_parser_mode: institutionalAuthorParse.parserMode,
        institutional_author_warning_flags: institutionalAuthorParse.warningFlags,
        split_contamination_flags: splitContaminationFlags,
        split_contamination_penalty: splitPenalty,
        cleaned_chunk_length: splitArtifact?.chunkLength ?? input.length,
        llm_attempted: llmAttempted,
        llm_applied: llmApplied,
        llm_cap_reached: llmCapReached,
        rejectedCandidates,
      },
    };
  }
}

class DefaultAuthorityLookupAdapter implements AuthorityLookupAdapter {
  readonly id = 'semantic-scholar-authority';

  async lookup(citation) {
    if (!citation.title.value && !citation.doi.value) {
      return { status: 'skipped' as const };
    }

    const result = await getAuthorityData(canonicalToParsedReference(citation));
    if (!result.data) {
      return { status: result.status === 'cache_hit' ? 'fetched' : result.status };
    }

    return {
      status: result.status === 'cache_hit' ? 'fetched' : result.status,
      data: {
        title: result.data.title,
        authors: result.data.authors,
        journal: result.data.journal,
        year: result.data.year,
        url: result.data.url,
      },
    };
  }
}

function normalizeResolutionAuthors(authors: unknown): string[] {
  if (!Array.isArray(authors)) return [];

  return authors
    .map((author) => {
      if (!author) return '';
      if (typeof author === 'string') return normalizeWhitespace(author);
      if (typeof author === 'object') {
        const literal = normalizeWhitespace(String((author as { literal?: unknown }).literal ?? ''));
        if (literal) return literal;
        const family = normalizeWhitespace(String((author as { family?: unknown }).family ?? ''));
        const given = normalizeWhitespace(String((author as { given?: unknown }).given ?? ''));
        if (family && given) return `${family}, ${given}`;
        return family || given;
      }
      return '';
    })
    .filter(Boolean);
}

function parseYear(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function mapCrossrefSearchItem(item: Record<string, any>): ResolutionCandidateRecord {
  return {
    provider: 'crossref',
    title: item.title?.[0] ?? item.title,
    authors: normalizeResolutionAuthors(item.author),
    year: item.issued?.['date-parts']?.[0]?.[0],
    venue: item['container-title']?.[0] ?? item['container-title'],
    volume: item.volume,
    issue: item.issue,
    pages: item.page,
    publisher: item.publisher,
    doi: item.DOI,
    url: item.URL,
    sourceType: item.type,
    raw: item,
  };
}

function mapCrossrefDoiRecord(record: Record<string, any>): ResolutionCandidateRecord {
  return {
    provider: 'crossref',
    title: record.title,
    authors: normalizeResolutionAuthors(record.author),
    year: record.issued?.['date-parts']?.[0]?.[0],
    venue: record['container-title'],
    volume: record.volume,
    issue: record.issue,
    pages: record.page ?? record.number,
    publisher: record.publisher,
    doi: record.DOI,
    url: record.URL,
    sourceType: record.type,
    raw: record,
  };
}

function mapPubmedSummaryRecord(record: Record<string, any>): ResolutionCandidateRecord {
  const authors = Array.isArray(record.authors)
    ? record.authors.map((author: Record<string, unknown>) => normalizeWhitespace(String(author.name ?? ''))).filter(Boolean)
    : [];

  return {
    provider: 'pubmed',
    title: record.title,
    authors,
    year: parseYear(record.pubdate),
    venue: record.fulljournalname ?? record.source,
    doi: Array.isArray(record.articleids)
      ? record.articleids.find((entry: Record<string, unknown>) => String(entry.idtype ?? '').toLowerCase() === 'doi')?.value
      : undefined,
    url: record.elocationid,
    sourceType: 'journal-article',
    raw: record,
  };
}

function mapOpenAlexRecord(record: Record<string, any>): ResolutionCandidateRecord {
  const authors = Array.isArray(record.authorships)
    ? record.authorships
      .map((authorship: Record<string, any>) => normalizeWhitespace(String(authorship.raw_author_name ?? authorship.author?.display_name ?? '')))
      .filter(Boolean)
    : [];

  return {
    provider: 'openalex',
    title: record.title,
    authors,
    year: parseYear(record.publication_year),
    venue: record.primary_location?.source?.display_name,
    volume: record.biblio?.volume,
    issue: record.biblio?.issue,
    pages: [record.biblio?.first_page, record.biblio?.last_page].filter(Boolean).join('-') || undefined,
    doi: typeof record.doi === 'string' ? normalizeDoiValue(record.doi) : undefined,
    url: record.primary_location?.landing_page_url,
    sourceType: record.type,
    raw: record,
  };
}

const PROVIDER_MIN_INTERVAL_MS = {
  crossref: 125,
  pubmed: 400,
  openalex: 250,
} as const;

const PROVIDER_TIMEOUT_MS = {
  crossref: 2500,
  pubmed: 2500,
  openalex: 2500,
} as const;

const providerLocks = new Map<keyof typeof PROVIDER_MIN_INTERVAL_MS, Promise<void>>();
const providerNextAllowedAt = new Map<keyof typeof PROVIDER_MIN_INTERVAL_MS, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1000;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());
  return null;
}

async function waitForProviderSlot(provider: keyof typeof PROVIDER_MIN_INTERVAL_MS): Promise<void> {
  const previous = providerLocks.get(provider) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  providerLocks.set(provider, current);

  await previous;
  try {
    const now = Date.now();
    const nextAllowedAt = providerNextAllowedAt.get(provider) ?? now;
    const waitMs = Math.max(0, nextAllowedAt - now);
    providerNextAllowedAt.set(provider, Math.max(now, nextAllowedAt) + PROVIDER_MIN_INTERVAL_MS[provider]);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  } finally {
    release();
    if (providerLocks.get(provider) === current) {
      providerLocks.delete(provider);
    }
  }
}

function isRetriableProviderStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchWithProviderPolicy(
  provider: keyof typeof PROVIDER_MIN_INTERVAL_MS,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await waitForProviderSlot(provider);
    const response = await fetch(url, init);
    if (response.ok || !isRetriableProviderStatus(response.status) || attempt === maxRetries) {
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const backoffMs = retryAfterMs ?? (PROVIDER_MIN_INTERVAL_MS[provider] * (attempt + 2) * 2);
    await sleep(backoffMs);
  }

  throw new Error(`Unreachable provider retry state for ${provider}`);
}

function buildCrossrefFilters(query: ResolutionSearchQuery, includeTypeFilter: boolean): string | null {
  const filters: string[] = [];
  if (query.year != null) {
    filters.push(`from-pub-date:${query.year}-01-01`);
    filters.push(`until-pub-date:${query.year}-12-31`);
  }
  if (includeTypeFilter) {
    switch (query.sourceType) {
      case 'journal':
        filters.push('type:journal-article');
        break;
      case 'conference':
        filters.push('type:proceedings-article');
        break;
      case 'report':
        filters.push('type:report');
        break;
      case 'book':
        filters.push('type:book');
        break;
      case 'chapter':
        filters.push('type:book-chapter');
        break;
      case 'preprint':
        filters.push('type:posted-content');
        break;
      default:
        break;
    }
  }
  return filters.length > 0 ? filters.join(',') : null;
}

function buildCrossrefSearchUrl(query: ResolutionSearchQuery, limit: number, includeTypeFilter: boolean): string {
  const params = new URLSearchParams({
    rows: String(limit),
    select: 'DOI,title,author,issued,container-title,volume,issue,page,publisher,URL,type',
    'query.bibliographic': query.title,
  });

  const authorQuery = query.firstAuthorSurname ?? query.groupAuthorLiteral;
  if (authorQuery) params.set('query.author', authorQuery);
  if (query.venue) params.set('query.container-title', query.venue);

  const filters = buildCrossrefFilters(query, includeTypeFilter);
  if (filters) params.set('filter', filters);

  return `https://api.crossref.org/works?${params.toString()}`;
}

function buildPubmedSearchTerm(query: ResolutionSearchQuery): string {
  const parts = [`"${query.title}"[Title]`];
  if (query.firstAuthorSurname) parts.push(`"${query.firstAuthorSurname}"[1au]`);
  if (query.year != null) parts.push(`${query.year}[pdat]`);
  return parts.join(' AND ');
}

function buildOpenAlexSearchUrl(query: ResolutionSearchQuery, limit: number, includeYearFilter: boolean): string {
  const params = new URLSearchParams({
    'search': `"${query.title}"`,
    'per-page': String(limit),
    'select': 'id,title,publication_year,authorships,biblio,primary_location,type,doi',
    'mailto': 'noreply@citing.app',
  });
  if (includeYearFilter && query.year != null) {
    params.set('filter', `publication_year:${query.year}`);
  }
  return `https://api.openalex.org/works?${params.toString()}`;
}

class DefaultResolutionProviderAdapter implements ResolutionProviderAdapter {
  readonly id = 'strict-network-resolution';

  async lookupByDoi(doi: string): Promise<ResolutionCandidateRecord[]> {
    const record = await fetchCrossrefMetadata(doi);
    return record ? [mapCrossrefDoiRecord(record)] : [];
  }

  async searchCrossrefByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]> {
    const requestInit = {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CitingApp/1.0 (mailto:noreply@citing.app)',
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.crossref),
    } satisfies RequestInit;

    const primaryResponse = await fetchWithProviderPolicy(
      'crossref',
      buildCrossrefSearchUrl(query, limit, true),
      requestInit,
    );
    if (!primaryResponse.ok) {
      const error = new Error(`Crossref title search failed with status ${primaryResponse.status}`) as Error & { status?: number };
      error.status = primaryResponse.status;
      throw error;
    }

    const primaryPayload = await primaryResponse.json() as { message?: { items?: Array<Record<string, any>> } };
    const primaryItems = (primaryPayload.message?.items ?? []).slice(0, limit);
    if (primaryItems.length > 0) {
      return primaryItems.map(mapCrossrefSearchItem);
    }

    const relaxedResponse = await fetchWithProviderPolicy(
      'crossref',
      buildCrossrefSearchUrl(query, limit, false),
      requestInit,
    );
    if (!relaxedResponse.ok) {
      const error = new Error(`Crossref title search failed with status ${relaxedResponse.status}`) as Error & { status?: number };
      error.status = relaxedResponse.status;
      throw error;
    }

    const relaxedPayload = await relaxedResponse.json() as { message?: { items?: Array<Record<string, any>> } };
    return (relaxedPayload.message?.items ?? []).slice(0, limit).map(mapCrossrefSearchItem);
  }

  async searchPubmedByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]> {
    const searchParams = new URLSearchParams({
      db: 'pubmed',
      retmode: 'json',
      retmax: String(limit),
      term: buildPubmedSearchTerm(query),
      tool: 'CitingApp',
      email: 'noreply@citing.app',
    });
    const searchResponse = await fetchWithProviderPolicy(
      'pubmed',
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams.toString()}`,
      {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.pubmed),
      },
    );
    if (!searchResponse.ok) {
      const error = new Error(`PubMed search failed with status ${searchResponse.status}`) as Error & { status?: number };
      error.status = searchResponse.status;
      throw error;
    }

    const search = await searchResponse.json() as { esearchresult?: { idlist?: string[] } };
    const ids = search.esearchresult?.idlist?.slice(0, limit) ?? [];
    if (ids.length === 0) return [];

    const summaryParams = new URLSearchParams({
      db: 'pubmed',
      retmode: 'json',
      id: ids.join(','),
      tool: 'CitingApp',
      email: 'noreply@citing.app',
    });
    const summaryResponse = await fetchWithProviderPolicy(
      'pubmed',
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams.toString()}`,
      {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.pubmed),
      },
    );
    if (!summaryResponse.ok) {
      const error = new Error(`PubMed summary failed with status ${summaryResponse.status}`) as Error & { status?: number };
      error.status = summaryResponse.status;
      throw error;
    }

    const summary = await summaryResponse.json() as { result?: Record<string, any> };
    return ids
      .map((id) => summary.result?.[id])
      .filter(Boolean)
      .map(mapPubmedSummaryRecord);
  }

  async searchOpenAlexByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]> {
    const requestInit = {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.openalex),
    } satisfies RequestInit;

    const primaryResponse = await fetchWithProviderPolicy(
      'openalex',
      buildOpenAlexSearchUrl(query, limit, true),
      requestInit,
    );
    if (!primaryResponse.ok) {
      const error = new Error(`OpenAlex search failed with status ${primaryResponse.status}`) as Error & { status?: number };
      error.status = primaryResponse.status;
      throw error;
    }

    const primaryPayload = await primaryResponse.json() as { results?: Array<Record<string, any>> };
    const primaryItems = (primaryPayload.results ?? []).slice(0, limit);
    if (primaryItems.length > 0) {
      return primaryItems.map(mapOpenAlexRecord);
    }

    const relaxedResponse = await fetchWithProviderPolicy(
      'openalex',
      buildOpenAlexSearchUrl(query, limit, false),
      requestInit,
    );
    if (!relaxedResponse.ok) {
      const error = new Error(`OpenAlex search failed with status ${relaxedResponse.status}`) as Error & { status?: number };
      error.status = relaxedResponse.status;
      throw error;
    }

    const relaxedPayload = await relaxedResponse.json() as { results?: Array<Record<string, any>> };
    return (relaxedPayload.results ?? []).slice(0, limit).map(mapOpenAlexRecord);
  }
}

class NoopEmbeddingAdapter implements EmbeddingAdapter {
  readonly id = 'noop-embedding';

  isAvailable(): boolean {
    return false;
  }
}

class MemoryCacheAdapter implements CacheAdapter {
  readonly id = 'memory-cache';
  private cache = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.cache.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.cache.set(key, value);
  }
}

class DefaultExportAdapter implements ExportAdapter {
  readonly id = 'default-exporter';

  async generate(format: 'txt' | 'bib' | 'ris' | 'csv' | 'docx', response: V2ConversionResponse) {
    const citations = exportableCitations(response);

    switch (format) {
      case 'txt':
        return {
          contentType: 'text/plain; charset=utf-8',
          filename: `citations-${response.job_id}.txt`,
          body: citations.map((citation) => citation.rendered?.formatted ?? '').filter(Boolean).join('\n'),
        };
      case 'bib':
        return {
          contentType: 'text/plain; charset=utf-8',
          filename: `citations-${response.job_id}.bib`,
          body: citations.map((citation, index) => {
            const parsed = canonicalToParsedReference(citation);
            const type = canonicalReferenceTypeToParsed(citation.referenceType);
            const bibType = type === 'journal' ? 'article' : type === 'book' ? 'book' : 'misc';
            const lines = [
              `@${bibType}{ref${index + 1},`,
              parsed.title ? `  title = {${parsed.title}},` : null,
              parsed.authors?.length ? `  author = {${parsed.authors.join(' and ')}},` : null,
              parsed.year ? `  year = {${parsed.year}},` : null,
              parsed.journal ? `  journal = {${parsed.journal}},` : null,
              parsed.volume ? `  volume = {${parsed.volume}},` : null,
              parsed.issue ? `  number = {${parsed.issue}},` : null,
              parsed.pages ? `  pages = {${parsed.pages}},` : null,
              parsed.publisher ? `  publisher = {${parsed.publisher}},` : null,
              parsed.doi ? `  doi = {${parsed.doi}},` : null,
              '}',
            ].filter(Boolean);
            return lines.join('\n');
          }).join('\n\n'),
        };
      case 'ris':
        return {
          contentType: 'application/x-research-info-systems; charset=utf-8',
          filename: `citations-${response.job_id}.ris`,
          body: citations.map((citation) => {
            const parsed = canonicalToParsedReference(citation);
            const type = canonicalReferenceTypeToParsed(citation.referenceType);
            const risType = type === 'journal' ? 'JOUR' : type === 'book' ? 'BOOK' : type === 'conference' ? 'CONF' : 'GEN';
            const lines = [`TY  - ${risType}`];
            for (const author of parsed.authors ?? []) lines.push(`AU  - ${author}`);
            if (parsed.title) lines.push(`TI  - ${parsed.title}`);
            if (parsed.journal) lines.push(`JO  - ${parsed.journal}`);
            if (parsed.volume) lines.push(`VL  - ${parsed.volume}`);
            if (parsed.issue) lines.push(`IS  - ${parsed.issue}`);
            if (parsed.pages) lines.push(`SP  - ${parsed.pages}`);
            if (parsed.year) lines.push(`PY  - ${parsed.year}`);
            if (parsed.publisher) lines.push(`PB  - ${parsed.publisher}`);
            if (parsed.doi) lines.push(`DO  - ${parsed.doi}`);
            if (parsed.url) lines.push(`UR  - ${parsed.url}`);
            lines.push('ER  - ');
            return lines.join('\n');
          }).join('\n\n'),
        };
      case 'csv':
        return {
          contentType: 'text/csv; charset=utf-8',
          filename: `citations-${response.job_id}.csv`,
          body: [
            'id,status,referenceType,title,year,journal,doi,url,formatted',
            ...citations.map((citation) => {
              const cells = [
                citation.id,
                citation.status,
                citation.referenceType,
                citation.title.value ?? '',
                citation.year.value != null ? String(citation.year.value) : '',
                citation.journal.value ?? '',
                citation.doi.value ?? '',
                citation.url.value ?? '',
                citation.rendered?.formatted ?? '',
              ];
              return cells.map((cell) => `"${String(normalizeWhitespace(cell)).replace(/"/g, '""')}"`).join(',');
            }),
          ].join('\n'),
        };
      case 'docx': {
        const doc = new Document({
          sections: [{
            children: citations.map((citation) => new Paragraph({
              children: [new TextRun(citation.rendered?.formatted ?? citation.raw)],
            })),
          }],
        });

        return {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filename: `citations-${response.job_id}.docx`,
          body: Buffer.from(await Packer.toBuffer(doc)),
        };
      }
    }
  }
}

export function createDefaultAdapters(): V2AdapterBundle {
  return {
    classifier: new DefaultClassifierAdapter(),
    extractor: new DefaultExtractorAdapter(),
    authorityLookup: new DefaultAuthorityLookupAdapter(),
    resolutionProvider: new DefaultResolutionProviderAdapter(),
    embedding: new NoopEmbeddingAdapter(),
    cache: new MemoryCacheAdapter(),
    exportAdapter: new DefaultExportAdapter(),
  };
}
