import {
  normalizeArxiv,
  normalizeDoi,
  normalizeHandle,
  normalizeIsbn,
  normalizeIssn,
  normalizePatent,
  normalizePmid,
} from './identifierUtils.js';
import {
  buildRawCitationSupportFromNormalizedRaw,
  findBestYearMatch,
  normalizeExtractionInput,
} from './rawCitationSupport.js';
import { recoverDoi } from './ingestion/ocrFold.js';
import type {
  CitationFeatures,
  CitationFeatureRecallEntry,
  CitationFeatureRecallShadow,
} from './types/extractionFeatures.js';
import type { StyleFamily } from './types/citation.js';

const DOI_REGEX = /10\.\d{4,9}\/[^\s"'<>]+/i;
const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;
const PMID_REGEX = /\bPMID[:\s]*(\d{5,9})\b/i;
const ARXIV_REGEX = /\b(?:arXiv:\s*|10\.48550\/arXiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)\b/i;
const ISBN_REGEX = /\bISBN(?:-1[03])?:?\s*((?:97[89][-\s]?)?\d(?:[-\s]?\d){8,}[0-9Xx])\b/i;
const ISSN_REGEX = /\bISSN:?\s*(\d{4}-?\d{3}[\dXx])\b/i;
const HANDLE_REGEX = /\b(?:hdl:\s*|https?:\/\/(?:hdl\.)?handle\.net\/)(\d+(?:\.\d+)*\/\S+)\b/i;
const PATENT_REGEX = /\b(?:(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)\s*)?Patent(?:\s+Application)?(?:\s+No\.?)?\s*([A-Z0-9/-]{5,})\b/i;
const BARE_PATENT_IDENTIFIER_REGEX = /\b(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)(?:\s*(?:RE|PP|D))?\s*\d{6,}[A-Z0-9/-]*\b/i;

interface LegacyFeatureSnapshot {
  doi: string | null;
  url: string | null;
  pmid: string | null;
  arxiv: string | null;
  isbn: string | null;
  issn: string | null;
  handle: string | null;
  patent: string | null;
  year: number | null;
  quotedTitle: string | null;
}

export function extractCitationFeatures(raw: string, family: StyleFamily): CitationFeatures {
  const normalizedRaw = normalizeExtractionInput(raw);
  const rawSupport = buildRawCitationSupportFromNormalizedRaw(normalizedRaw);
  const parseableRaw = rawSupport.parseableRaw;
  // Match the normalized input first (clean + OCR-recovered cases), then fall back to the
  // ORIGINAL raw. normalizeExtractionInput can drop/mangle a *bare trailing* DOI (the
  // `bare_identifier` paste pattern, e.g. "… pp. 28–29. 10.1353/abr.2015.0061"), collapsing it
  // to a path-less "https://doi.org/" stub — which left such DOIs unrecovered even though every
  // other identifier below already matches `raw`. The raw fallback is diacritic-folded so an
  // OCR'd DOI path ("10.1353/péw.2015.0065") still validates; normalizeDoi() rejects non-DOIs,
  // so the fallback only ever promotes a genuine DOI when the normalized pass found none.
  const strictDoiRaw =
    normalizedRaw.match(DOI_REGEX)?.[0]
    ?? raw.normalize("NFKD").replace(/\p{Mark}+/gu, "").match(DOI_REGEX)?.[0]
    ?? null;
  const relaxedDoi = strictDoiRaw ? null : extractRelaxedDoi(normalizedRaw);
  const normalizedDoi = strictDoiRaw ? normalizeDoi(strictDoiRaw) : (relaxedDoi?.value ?? null);
  const doiRecovered = relaxedDoi?.recovered ?? false;
  const rawUrl = normalizedRaw.match(URL_REGEX)?.[0] ?? null;
  const pmidMatch = raw.match(PMID_REGEX);
  const arxivMatch = raw.match(ARXIV_REGEX) ?? raw.match(/10\.48550\/arXiv\.([^\s"'<>]+)/i);
  const isbnMatch = raw.match(ISBN_REGEX);
  const issnMatch = raw.match(ISSN_REGEX);
  const handleMatch = raw.match(HANDLE_REGEX);
  const patentRaw = extractPatentIdentifier(raw) ?? null;

  return {
    raw,
    family,
    normalizedRaw,
    parseableRaw,
    yearMatch: findBestYearMatch(parseableRaw, family),
    quotedTitle: rawSupport.quotedTitle,
    identifiers: {
      doi: {
        raw: strictDoiRaw ?? normalizedDoi,
        normalized: normalizedDoi,
        recovered: doiRecovered,
      },
      url: {
        raw: rawUrl,
        normalized: rawUrl ? stripTrailingPunctuation(rawUrl) : null,
      },
      pmid: {
        raw: pmidMatch?.[0] ?? null,
        normalized: pmidMatch?.[1] ? normalizePmid(pmidMatch[1]) : null,
      },
      arxiv: {
        raw: arxivMatch?.[0] ?? null,
        normalized: arxivMatch?.[0] ? normalizeArxiv(arxivMatch[0]) : null,
      },
      isbn: {
        raw: isbnMatch?.[0] ?? null,
        normalized: isbnMatch?.[1] ? normalizeIsbn(isbnMatch[1]) : null,
      },
      issn: {
        raw: issnMatch?.[0] ?? null,
        normalized: issnMatch?.[1] ? normalizeIssn(issnMatch[1]) : null,
      },
      handle: {
        raw: handleMatch?.[0] ?? null,
        normalized: handleMatch?.[1] ? normalizeHandle(handleMatch[1]) : null,
      },
      patent: {
        raw: patentRaw,
        normalized: patentRaw ? normalizePatent(patentRaw) : null,
      },
    },
  };
}

export function compareCitationFeatureRecall(
  raw: string,
  family: StyleFamily,
): CitationFeatureRecallShadow {
  return compareCitationFeatureRecallFromFeatures(extractCitationFeatures(raw, family));
}

export function compareCitationFeatureRecallFromFeatures(
  features: CitationFeatures,
): CitationFeatureRecallShadow {
  const legacy = collectLegacyHeuristicFeatureSnapshot(features.raw, features.family);

  const fields = {
    doi: createRecallEntry(legacy.doi, features.identifiers.doi.normalized),
    url: createRecallEntry(legacy.url, features.identifiers.url.normalized),
    pmid: createRecallEntry(legacy.pmid, features.identifiers.pmid.normalized),
    arxiv: createRecallEntry(legacy.arxiv, features.identifiers.arxiv.normalized),
    isbn: createRecallEntry(legacy.isbn, features.identifiers.isbn.normalized),
    issn: createRecallEntry(legacy.issn, features.identifiers.issn.normalized),
    handle: createRecallEntry(legacy.handle, features.identifiers.handle.normalized),
    patent: createRecallEntry(legacy.patent, features.identifiers.patent.normalized),
    year: createRecallEntry(legacy.year, features.yearMatch?.year ?? null),
    quotedTitle: createRecallEntry(legacy.quotedTitle, features.quotedTitle?.title ?? null),
  } satisfies CitationFeatureRecallShadow['fields'];

  return {
    allMatch: Object.values(fields).every((entry) => entry.matches),
    fields,
  };
}

function collectLegacyHeuristicFeatureSnapshot(
  raw: string,
  family: StyleFamily,
): LegacyFeatureSnapshot {
  const normalizedRaw = normalizeExtractionInput(raw);
  const rawSupport = buildRawCitationSupportFromNormalizedRaw(normalizedRaw);
  const strictDoiMatch = normalizedRaw.match(DOI_REGEX);
  const relaxedDoi = strictDoiMatch?.[0]
    ? normalizeDoi(strictDoiMatch[0])
    : (extractRelaxedDoi(normalizedRaw)?.value ?? null);
  const pmidMatch = raw.match(PMID_REGEX);
  const arxivMatch = raw.match(ARXIV_REGEX) ?? raw.match(/10\.48550\/arXiv\.([^\s"'<>]+)/i);
  const isbnMatch = raw.match(ISBN_REGEX);
  const issnMatch = raw.match(ISSN_REGEX);
  const handleMatch = raw.match(HANDLE_REGEX);

  return {
    doi: relaxedDoi,
    url: normalizedRaw.match(URL_REGEX)?.[0]
      ? stripTrailingPunctuation(normalizedRaw.match(URL_REGEX)?.[0] ?? '')
      : null,
    pmid: pmidMatch?.[1] ? normalizePmid(pmidMatch[1]) : null,
    arxiv: arxivMatch?.[0] ? normalizeArxiv(arxivMatch[0]) : null,
    isbn: isbnMatch?.[1] ? normalizeIsbn(isbnMatch[1]) : null,
    issn: issnMatch?.[1] ? normalizeIssn(issnMatch[1]) : null,
    handle: handleMatch?.[1] ? normalizeHandle(handleMatch[1]) : null,
    patent: extractPatentIdentifier(raw) ?? null,
    year: findBestYearMatch(rawSupport.parseableRaw, family)?.year ?? null,
    quotedTitle: rawSupport.quotedTitle?.title ?? null,
  };
}

function createRecallEntry(
  legacy: string | number | null,
  feature: string | number | null,
): CitationFeatureRecallEntry {
  return {
    legacy,
    feature,
    matches: legacy === feature,
  };
}

function normalizeComparableText(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function stripTrailingPunctuation(value: string): string {
  let normalized = value.replace(/[.,;:\]]+$/g, '').trim();
  while (normalized.endsWith(')')) {
    const openCount = (normalized.match(/\(/g) ?? []).length;
    const closeCount = (normalized.match(/\)/g) ?? []).length;
    if (closeCount <= openCount) {
      break;
    }
    normalized = normalized.slice(0, -1).trim();
  }
  return normalized;
}

function extractRelaxedDoi(value: string): { value: string; recovered: boolean } | null {
  const normalizedValue = normalizeExtractionInput(value);
  if (!normalizedValue) {
    return null;
  }

  const identifierValue = stripDiacriticsForIdentifier(normalizedValue);
  const doiCandidates = [
    identifierValue.match(/https?:\/\/(?:dx\.)?doi\.org\/(?<doi>10\.\d{4,9}\/[^\s"'<>]+)/iu)?.groups?.doi,
    identifierValue.match(/\bdoi:\s*(?<doi>10\.\d{4,9}\/[^\s"'<>]+)/iu)?.groups?.doi,
    identifierValue.match(/\b(?<doi>10\.\d{4,9}\/[^\s"'<>]+)/iu)?.groups?.doi,
  ];

  for (const candidate of doiCandidates) {
    const normalizedDoi = normalizeDoi(candidate);
    if (normalizedDoi) {
      return { value: normalizedDoi, recovered: false };
    }
  }

  // OCR-tolerant fallback: a misread registrant digit (e.g. "10.1O07/..." for "10.1007/...")
  // defeats the strict patterns above. recoverDoi folds the grammar-guaranteed digit
  // positions back and keeps the suffix verbatim, returning only a structurally valid DOI.
  // It is flagged `recovered` so the suffix (which may still carry OCR damage) is emitted at
  // reduced confidence and stays overridable by enrichment.
  const recovered = recoverDoi(identifierValue);
  if (recovered) {
    const normalizedRecovered = normalizeDoi(recovered);
    if (normalizedRecovered) {
      return { value: normalizedRecovered, recovered: true };
    }
  }

  return null;
}

function stripDiacriticsForIdentifier(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}+/gu, '');
}

function extractPatentIdentifier(text: string): string | undefined {
  const compactText = text.trim();
  const direct = compactText.length <= 96 ? normalizePatent(compactText) : null;
  if (direct) {
    return direct;
  }
  const patentUrlMatch = text.match(/https?:\/\/(?:www\.)?patents\.google\.com\/patent\/[^\s"'<>]+/iu)?.[0];
  if (patentUrlMatch) {
    return normalizePatent(patentUrlMatch) ?? undefined;
  }
  const contextualMatch = text.match(PATENT_REGEX)?.[0];
  if (contextualMatch) {
    return normalizePatent(contextualMatch) ?? undefined;
  }
  const bareMatch = text.match(BARE_PATENT_IDENTIFIER_REGEX)?.[0];
  if (bareMatch && isPatentIdentifierInsideDoiContext(text, bareMatch)) {
    return undefined;
  }
  return bareMatch ? normalizePatent(bareMatch) ?? undefined : undefined;
}

function isPatentIdentifierInsideDoiContext(text: string, patentIdentifier: string): boolean {
  const compactText = text.replace(/\s+/g, '');
  const compactPatent = patentIdentifier.replace(/\s+/g, '');
  return new RegExp(
    `(?:doi:|https?:\\/\\/(?:dx\\.)?doi\\.org\\/|10\\.\\d{4,9}\\/)[^\\s"'<>]*${escapeRegex(compactPatent)}`,
    'iu',
  ).test(compactText);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
