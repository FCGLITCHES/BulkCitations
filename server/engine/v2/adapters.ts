// @ts-nocheck
import { Buffer } from 'node:buffer';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { z } from 'zod';
import { getAuthorityData } from '@shared/authorityLookup';
import type { CanonicalAuthor, CitationStyle, ParsedReference, V2ConversionResponse } from '@shared/schema';
import { CitationParser } from '../citationParser.js';
import {
  canonicalReferenceTypeToParsed,
  canonicalToParsedReference,
  coerceCanonicalAuthor,
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
  proceedingsSignal,
  sanitizeParsedReference,
} from './qualityRules.js';
import type {
  AuthorityLookupAdapter,
  CacheAdapter,
  ClassifierAdapter,
  EmbeddingAdapter,
  ExportAdapter,
  ExtractorAdapter,
  V2SplitArtifact,
  V2AdapterBundle,
} from './contracts.js';

const DOI_PATTERN = /\b10\.\d{4,}\/\S+\b/i;
const REQUIRED_EXTRACTION_FIELDS: Array<keyof ParsedReference> = ['title', 'year'];

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

function buildDeterministicCandidate(input: string, inputStyle: string) {
  const parser = getParser();
  const normalized = parser.preNormalize(input);
  const detectedStyle = inputStyle !== 'auto' ? inputStyle : parser.detectStyle(normalized) ?? 'apa';
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
  const normalized = parser.preNormalize(input);
  const parsed = parser.parseYearAnchored(normalized);
  if (!parsed) return null;
  return {
    normalized,
    parsed,
    referenceType: parsedReferenceTypeToCanonical(parser.determineReferenceType(parsed)),
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
  const baseUrl = (process.env.GROBID_URL ?? 'http://localhost:8070').replace(/\/$/, '');
  const body = new URLSearchParams({
    citations: input,
    consolidateCitations: '0',
    includeRawCitations: '1',
  });

  const response = await fetch(`${baseUrl}/api/processCitation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(Number.parseInt(process.env.GROBID_TIMEOUT_MS ?? '3000', 10)),
  });

  if (!response.ok) {
    throw new Error(`GROBID ${response.status}`);
  }

  const tei = await response.text();
  if (!tei.trim()) return null;
  return parseGrobidTei(tei);
}

function looksLikeDateFragment(value: string | undefined): boolean {
  if (!value) return false;
  return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(value) || /^\d{1,2}[;:/]/.test(value);
}

function looksLikeMergedAuthorBlob(author: string): boolean {
  const normalized = normalizeWhitespace(author);
  const commaCount = (normalized.match(/,/g) ?? []).length;
  return commaCount >= 2 || /\b(?:and|&)\b/.test(normalized);
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
  let score = 0;
  if (parsed.title && parsed.title.split(/\s+/).length >= 4 && !looksLikeDateFragment(parsed.title)) score += 4;
  else if (parsed.title) score += 1.5;
  if (parsed.year) score += 2.5;
  if (hasParsedVenue(parsed)) score += 3;
  if (parsed.publisher || parsed.institution) score += 1.5;
  if (parsed.authors?.length) score += 3.5;
  if (parsed.volume) score += requirements.expected.includes('volume') ? 1 : 0.3;
  if (parsed.issue) score += requirements.expected.includes('issue') ? 1 : 0.3;
  if (isLocatorLike(parsed.pages)) score += requirements.expected.includes('locator') ? 1.2 : 0.4;
  if (parsed.authors && looksLikeAlternatingTokenArray(parsed.authors)) score -= 2;
  if (parsed.authors?.some((author) => looksLikeMergedAuthorBlob(author))) score -= 4;
  if (authorSignals.mergedBlobCount > 0) score -= authorSignals.mergedBlobCount * 2.5;
  if (authorSignals.initialsOnlyCount > Math.ceil((parsed.authors?.length ?? 0) / 2)) score -= 2;
  if (authorSignals.singleCharacterTailCount > 0) score -= authorSignals.singleCharacterTailCount * 1.2;
  score += authorSignals.richness * 1.5;
  if (parsed.authors?.some((author) => author.length > 120 || /\. .+\./.test(author))) score -= 3;
  if (isPlaceholderVenue(parsed.journal) || isPlaceholderVenue(parsed.volume) || isPlaceholderVenue(parsed.issue)) score -= 3;
  if (proceedingsSignal(parsed.conferenceTitle ?? parsed.bookTitle ?? parsed.journal) && (parsed.conferenceTitle || parsed.bookTitle || parsed.journal)) score += 1;
  if (referenceType && referenceType !== 'unknown') score += 1;
  return score;
}

function selectionReason(
  selectedBranch: 'deterministic_raw' | 'year_anchored_fallback_raw',
  deterministic: ParsedReference,
  fallback: ParsedReference | null,
): string {
  if (selectedBranch === 'deterministic_raw') {
    if (!fallback) return 'year_anchored_unavailable';
    if (looksLikeAlternatingTokenArray(deterministic.authors ?? [])) return 'deterministic_retained_for_structured_fields_with_author_recovery';
    return 'deterministic_scored_higher';
  }
  if (!deterministic.title && fallback?.title) return 'deterministic_missing_title';
  if ((!deterministic.authors || deterministic.authors.length === 0) && fallback?.authors?.length) return 'deterministic_missing_authors';
  return 'year_anchored_scored_higher';
}

function fillMissingFromFallback(selected: ParsedReference, fallback: ParsedReference | null): ParsedReference {
  if (!fallback) return selected;
  const merged: ParsedReference = { ...selected };
  for (const field of ['title', 'year', 'journal', 'conferenceTitle', 'bookTitle', 'volume', 'issue', 'pages', 'publisher', 'url', 'doi', 'institution', 'edition', 'editor'] as const) {
    if (!merged[field] && fallback[field]) {
      merged[field] = fallback[field];
    }
  }
  if ((!merged.authors || merged.authors.length === 0) && fallback.authors?.length) {
    merged.authors = fallback.authors;
  }
  return merged;
}

function buildFieldConfidence(parsed: ParsedReference, referenceType: string) {
  const authorSignals = analyzeParsedAuthorStrings(parsed.authors);
  return {
    authors: parsed.authors?.length
      ? Math.max(0.25, Math.min(0.92, 0.84 + (authorSignals.richness * 0.04) - (authorSignals.mergedBlobCount * 0.12) - (authorSignals.singleCharacterTailCount * 0.08)))
      : 0.2,
    title: parsed.title ? (looksLikeDateFragment(parsed.title) ? 0.2 : 0.88) : 0.2,
    year: parsed.year ? 0.92 : 0.1,
    journal: hasParsedVenue(parsed) ? 0.82 : (referenceType === 'journal' ? 0.18 : 0.12),
    volume: parsed.volume ? 0.82 : 0.1,
    issue: parsed.issue ? 0.8 : 0.1,
    pages: isLocatorLike(parsed.pages) ? 0.82 : 0.1,
    doi: parsed.doi ? 0.96 : 0.05,
    publisher: parsed.publisher || parsed.institution ? 0.74 : 0.1,
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
    signal: AbortSignal.timeout(4500),
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
  const firstLooksLikeInitials = Boolean(normalizedFirst) && /^[A-Z](?:\.?\s*[A-Z]){0,5}\.?$/i.test(normalizedFirst.replace(/\s+/g, ''));
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
    const normalized = parser.preNormalize(input);
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
    const deterministicAuthorParse = parseAuthorsForStyle(deterministic.parsed.authors ?? [], inputStyle);
    const fallbackAuthorParse = parseAuthorsForStyle(fallback?.parsed.authors ?? [], inputStyle);
    const deterministicScore = scoreCandidate(deterministic.parsed, deterministic.referenceType)
      - (deterministicAuthorParse.warningFlags.length * 2)
      - (deterministicAuthorParse.rejectedCandidates.length * 1.5)
      + ((deterministicAuthorParse.parserMode === 'alternating_pairs' || deterministicAuthorParse.parserMode === 'surname_given_pairs') ? 8 : 0);
    const fallbackScore = scoreCandidate(fallback?.parsed, fallback?.referenceType)
      - (fallbackAuthorParse.warningFlags.length * 2)
      - (fallbackAuthorParse.rejectedCandidates.length * 1.5);
    const selectedBranch = fallbackScore > deterministicScore ? 'year_anchored_fallback_raw' : 'deterministic_raw';
    const selectedBase = selectedBranch === 'year_anchored_fallback_raw' && fallback ? fallback : deterministic;
    let mergedSelection = fillMissingFromFallback(selectedBase.parsed, selectedBranch === 'deterministic_raw' ? fallback?.parsed ?? null : deterministic.parsed);
    let selectedReferenceType = selectedBranch === 'year_anchored_fallback_raw' && fallback ? fallback.referenceType : deterministic.referenceType;
    const selectedReason = selectionReason(selectedBranch, deterministic.parsed, fallback?.parsed ?? null);
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

    const inputStructure = options?.inputProfile?.structure ?? 'unknown';
    const batchSize = options?.batchSize ?? options?.inputProfile?.estimatedCount ?? 1;
    const grobidEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_GROBID_EXTRACTOR ?? '');
    const detectionConfidence = options?.detectionConfidence ?? 0;
    const weakDeterministicSelection =
      needsLlmFallback(mergedSelection, selectedFieldConfidence)
      || (deterministicScore - contaminationScorePenalty) < 8
      || deterministicAuthorParse.warningFlags.length > 0
      || deterministicAuthorParse.rejectedCandidates.length > 0
      || splitContaminationFlags.length > 0;
    const profilePrefersGrobid = inputStructure === 'semi_structured'
      || inputStructure === 'unstructured'
      || splitContaminationFlags.some((flag) => ['header_bleed_suspected', 'page_artifact_present', 'multiline_truncation_suspected', 'oversized_chunk'].includes(flag));
    const grobidRouteReason = weakDeterministicSelection
      ? 'weak_deterministic_parse'
      : splitContaminationFlags.length > 0
        ? 'split_contamination'
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
          const profilePrefersGrobid = ['structured', 'semi_structured'].includes(inputStructure);
          const deterministicBestScore = Math.max(deterministicScore, fallbackScore);
          const grobidLooksUsable = Boolean(grobidCandidate.parsed.title) && Boolean(grobidCandidate.parsed.authors?.length);
          if (
            (grobidLooksUsable && profilePrefersGrobid)
            || 
            grobidScore > deterministicBestScore + 0.5
            || (profilePrefersGrobid && grobidLooksUsable && grobidScore >= deterministicBestScore - 0.25)
          ) {
            mergedSelection = fillMissingFromFallback(grobidCandidate.parsed, mergedSelection);
            selectedReferenceType = grobidCandidate.referenceType;
            selectedFieldConfidence = {
              ...applySplitPenaltyToFieldConfidence(buildFieldConfidence(mergedSelection, selectedReferenceType), splitPenalty),
              authors: Math.max(applySplitPenaltyToFieldConfidence(buildFieldConfidence(mergedSelection, selectedReferenceType), splitPenalty).authors, 0.9 - Math.min(0.18, splitPenalty)),
              title: Math.max(applySplitPenaltyToFieldConfidence(buildFieldConfidence(mergedSelection, selectedReferenceType), splitPenalty).title, 0.9 - Math.min(0.18, splitPenalty)),
              year: Math.max(applySplitPenaltyToFieldConfidence(buildFieldConfidence(mergedSelection, selectedReferenceType), splitPenalty).year, 0.9 - Math.min(0.18, splitPenalty)),
            };
            extractorPath = 'grobid';
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

    if (!needsLlmFallback(mergedSelection, selectedFieldConfidence) || !/^(1|true|yes|on)$/i.test(process.env.ENABLE_LLM_EXTRACTOR ?? '1')) {
      return {
        parsed: mergedSelection,
        referenceType: selectedReferenceType,
        method: 'deterministic' as const,
        fallbackUsed: false,
        extractorPath,
        selectedBranch,
        selectionReason: selectedReason,
        rejectedCandidates,
        fieldConfidence: selectedFieldConfidence,
        warnings: [...deterministic.warnings, ...(fallback?.warnings ?? []), ...splitWarnings],
        debug: {
          deterministic_raw: deterministic.parsed,
          year_anchored_fallback_raw: fallback?.parsed ?? null,
          grobid_raw: grobidCandidate?.parsed ?? null,
          selected_branch: selectedBranch,
          selection_reason: selectedReason,
          extractor_path: extractorPath,
          deterministic_score: deterministicScore,
          fallback_score: fallbackScore,
          grobid_score: grobidScore,
          deterministic_author_parser_mode: deterministicAuthorParse.parserMode,
          deterministic_author_warning_flags: deterministicAuthorParse.warningFlags,
          fallback_author_parser_mode: fallbackAuthorParse.parserMode,
          fallback_author_warning_flags: fallbackAuthorParse.warningFlags,
          split_contamination_flags: splitContaminationFlags,
          split_contamination_penalty: splitPenalty,
          cleaned_chunk_length: splitArtifact?.chunkLength ?? input.length,
          rejectedCandidates,
        },
      };
    }

    try {
      const llm = await extractWithLlm(selectedBase.normalized);
      if (!llm) {
        return {
          parsed: mergedSelection,
          referenceType: selectedReferenceType,
          method: 'deterministic' as const,
          fallbackUsed: false,
          selectedBranch,
          selectionReason: selectedReason,
          rejectedCandidates,
          fieldConfidence: selectedFieldConfidence,
          warnings: [...deterministic.warnings, ...(fallback?.warnings ?? []), ...splitWarnings, 'llm_fallback_unavailable'],
          debug: {
            deterministic_raw: deterministic.parsed,
            year_anchored_fallback_raw: fallback?.parsed ?? null,
            selected_branch: selectedBranch,
            selection_reason: selectedReason,
            deterministic_score: deterministicScore,
            fallback_score: fallbackScore,
            split_contamination_flags: splitContaminationFlags,
            split_contamination_penalty: splitPenalty,
            cleaned_chunk_length: splitArtifact?.chunkLength ?? input.length,
            rejectedCandidates,
          },
        };
      }

      const merged = mergeLlmWithDeterministic({ parsed: mergedSelection, referenceType: selectedReferenceType }, llm);
      const sanitizedHybrid = sanitizeParsedReference(merged.parsed, merged.referenceType);
      const hybridFieldConfidence = {
        ...merged.fieldConfidence,
        ...applySplitPenaltyToFieldConfidence(buildFieldConfidence(sanitizedHybrid.parsed, sanitizedHybrid.referenceType), splitPenalty),
      };
      return {
        parsed: sanitizedHybrid.parsed,
        referenceType: sanitizedHybrid.referenceType,
        method: 'hybrid' as const,
        fallbackUsed: true,
        extractorPath: extractorPath === 'grobid' ? 'hybrid' : 'llm',
        selectedBranch: 'hybrid' as const,
        selectionReason: `${selectedReason}_with_llm_fill`,
        rejectedCandidates,
        fieldConfidence: hybridFieldConfidence,
        warnings: [...deterministic.warnings, ...(fallback?.warnings ?? []), ...splitWarnings, 'llm_fallback_applied'],
        debug: {
          deterministic_raw: deterministic.parsed,
          year_anchored_fallback_raw: fallback?.parsed ?? null,
          grobid_raw: grobidCandidate?.parsed ?? null,
          selected_branch: 'hybrid',
          selection_reason: `${selectedReason}_with_llm_fill`,
          extractor_path: extractorPath === 'grobid' ? 'hybrid' : 'llm',
          deterministic_score: deterministicScore,
          fallback_score: fallbackScore,
          grobid_score: grobidScore,
          deterministic_author_parser_mode: deterministicAuthorParse.parserMode,
          deterministic_author_warning_flags: deterministicAuthorParse.warningFlags,
          fallback_author_parser_mode: fallbackAuthorParse.parserMode,
          fallback_author_warning_flags: fallbackAuthorParse.warningFlags,
          split_contamination_flags: splitContaminationFlags,
          split_contamination_penalty: splitPenalty,
          cleaned_chunk_length: splitArtifact?.chunkLength ?? input.length,
          rejectedCandidates,
        },
      };
    } catch (error) {
      return {
        parsed: mergedSelection,
        referenceType: selectedReferenceType,
        method: 'deterministic' as const,
        fallbackUsed: true,
        extractorPath,
        selectedBranch,
        selectionReason: `${selectedReason}_llm_invalid_or_failed`,
        rejectedCandidates: [
          ...rejectedCandidates,
          'llm_invalid_or_failed',
        ],
        fieldConfidence: selectedFieldConfidence,
        warnings: [
          ...deterministic.warnings,
          ...(fallback?.warnings ?? []),
          ...splitWarnings,
          `llm_fallback_failed:${error instanceof Error ? error.message : String(error)}`,
        ],
        debug: {
          deterministic_raw: deterministic.parsed,
          year_anchored_fallback_raw: fallback?.parsed ?? null,
          grobid_raw: grobidCandidate?.parsed ?? null,
          selected_branch: selectedBranch,
          selection_reason: `${selectedReason}_llm_invalid_or_failed`,
          extractor_path: extractorPath,
          deterministic_score: deterministicScore,
          fallback_score: fallbackScore,
          grobid_score: grobidScore,
          deterministic_author_parser_mode: deterministicAuthorParse.parserMode,
          deterministic_author_warning_flags: deterministicAuthorParse.warningFlags,
          fallback_author_parser_mode: fallbackAuthorParse.parserMode,
          fallback_author_warning_flags: fallbackAuthorParse.warningFlags,
          split_contamination_flags: splitContaminationFlags,
          split_contamination_penalty: splitPenalty,
          cleaned_chunk_length: splitArtifact?.chunkLength ?? input.length,
          rejectedCandidates: [
            ...rejectedCandidates,
            'llm_invalid_or_failed',
          ],
        },
      };
    }
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
    embedding: new NoopEmbeddingAdapter(),
    cache: new MemoryCacheAdapter(),
    exportAdapter: new DefaultExportAdapter(),
  };
}
