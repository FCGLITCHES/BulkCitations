import type { CanonicalReferenceType, ParsedReference } from '@shared/schema';
import { normalizeWhitespace } from './utils.js';

const REPORT_DOI_SIGNAL = /^(?:10\.2172\/|10\.21236\/|10\.6028\/|10\.3386\/w\d+|10\.20955\/wp\.|10\.18235\/|10\.54067\/acpf\.|10\.4095\/|10\.55277\/researchhub\.|10\.4271\/|10\.31979\/mti\.|10\.5703\/)/i;
const REPORT_TITLE_SIGNAL = /\b(?:report|guideline|working paper|policy brief|white paper|technical note|statement|case study|forecasts?)\b/i;
const BOOKISH_TITLE_SIGNAL = /\b(?:handbook|textbook|encyclopedia|dictionary|monograph|companion|collected works)\b/i;
const THESIS_SIGNAL = /\b(?:doctoral|doctorate|phd|master'?s?|dissertation|thesis)\b/i;
const INSTITUTIONAL_SIGNAL = /\b(?:organization|agency|administration|department|ministry|office|commission|council|bank|foundation|university|institute|society|association|bureau|center|centre|laborator(?:y|ies)|researchhub technologies|defense technical information center|office of scientific and technical information|mineta transportation institute|purdue university)\b/i;
const COMMERCIAL_PUBLISHER_SIGNAL = /\b(?:springer|elsevier|wiley|routledge|sage|taylor\s*&\s*francis|oxford university press|cambridge university press|crc press|mdpi|pearson|mcgraw-hill|palgrave|thieme|trans tech publications|atlantis press|press|publisher|publishing|verlag|editions?|editora)\b/i;
const DOI_OR_URL_TAIL_PATTERN = /\b(?:doi:\s*)?10\.\d{4,}\/\S+\b|https?:\/\/\S+/gi;
const TRAILING_YEAR_FRAGMENT_PATTERN = /(?:,\s*|\.\s*|\s+)(?<year>(?:1[5-9]\d{2}|20\d{2}))\s*$/i;

function looksInstitutional(value: string | undefined): boolean {
  return INSTITUTIONAL_SIGNAL.test(normalizeWhitespace(value ?? ''));
}

function looksCommercialPublisher(value: string | undefined): boolean {
  return COMMERCIAL_PUBLISHER_SIGNAL.test(normalizeWhitespace(value ?? ''));
}

function hasSerialStructure(parsed: ParsedReference): boolean {
  return Boolean(
    normalizeWhitespace(parsed.volume ?? '')
    || normalizeWhitespace(parsed.issue ?? '')
    || normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? ''),
  );
}

function looksLikeWebsiteOnlyShape(parsed: ParsedReference): boolean {
  return Boolean(
    normalizeWhitespace(parsed.url ?? '')
    && !REPORT_DOI_SIGNAL.test(normalizeWhitespace(parsed.doi ?? ''))
    && !normalizeWhitespace(parsed.volume ?? '')
    && !normalizeWhitespace(parsed.issue ?? '')
    && !normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? ''),
  );
}

function looksLikeThesisShape(parsed: ParsedReference): boolean {
  return Boolean(
    THESIS_SIGNAL.test([
      parsed.title,
      parsed.publisher,
      parsed.institution,
      parsed.journal,
      parsed.thesisType,
    ].map((value) => normalizeWhitespace(value ?? '')).filter(Boolean).join(' '))
  );
}

function normalizeReportTitle(value: string | undefined): string {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return '';
  return normalizeWhitespace(
    normalized
      .replace(DOI_OR_URL_TAIL_PATTERN, '')
      .replace(/[.;,:]\s*$/g, ''),
  );
}

function trimTrailingYearLeakFromTitle(value: string | undefined): string {
  return normalizeWhitespace(normalizeReportTitle(value).replace(TRAILING_YEAR_FRAGMENT_PATTERN, ''));
}

function restoreCorporateSuffixPeriod(value: string | undefined): string {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return '';
  return normalized
    .replace(/\bInc$/i, 'Inc.')
    .replace(/\bLtd$/i, 'Ltd.')
    .replace(/\bCo$/i, 'Co.')
    .replace(/\bCorp$/i, 'Corp.');
}

function extractPublisherYearTailFromRaw(rawNormalized: string | undefined): {
  title?: string;
  publisher?: string;
  year?: string;
} {
  const normalized = normalizeWhitespace((rawNormalized ?? '').replace(DOI_OR_URL_TAIL_PATTERN, ''));
  if (!normalized) return {};

  const sentenceParts = normalized
    .split(/\.\s+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  if (sentenceParts.length < 2) return {};

  const tail = sentenceParts[sentenceParts.length - 1] ?? '';
  const tailMatch = tail.match(/^(?<publisher>.+)(?:,\s*|\.\s*)(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?\s*$/i);
  if (!tailMatch?.groups?.publisher || !tailMatch.groups.year) return {};

  const publisher = restoreCorporateSuffixPeriod(tailMatch.groups.publisher);
  if (!looksInstitutional(publisher) && !looksCommercialPublisher(publisher)) return {};

  const title = trimTrailingYearLeakFromTitle(sentenceParts[sentenceParts.length - 2] ?? '');
  if (!title) return { publisher, year: tailMatch.groups.year };

  return {
    title,
    publisher,
    year: tailMatch.groups.year,
  };
}

export function resolveReportMetadata(options: {
  parsed: ParsedReference;
  referenceType: CanonicalReferenceType;
  rawNormalized?: string;
}): {
  parsed: ParsedReference;
  referenceType: CanonicalReferenceType;
  reasons: string[];
} {
  const parsed: ParsedReference = { ...options.parsed };
  let referenceType = options.referenceType;
  const reasons: string[] = [];

  if (referenceType === 'website' || referenceType === 'thesis' || referenceType === 'conference') {
    return { parsed, referenceType, reasons };
  }
  if (looksLikeWebsiteOnlyShape(parsed) || looksLikeThesisShape(parsed)) {
    return { parsed, referenceType, reasons };
  }

  const doi = normalizeWhitespace(parsed.doi ?? '');
  const title = normalizeReportTitle(parsed.title);
  const publisher = normalizeWhitespace(parsed.publisher ?? '');
  const journal = normalizeWhitespace(parsed.journal ?? '');
  const institution = normalizeWhitespace(parsed.institution ?? '');
  const serialStructure = hasSerialStructure(parsed);
  const rawTail = extractPublisherYearTailFromRaw(options.rawNormalized);

  if (!parsed.title && rawTail.title) {
    parsed.title = rawTail.title;
    reasons.push('recovered_report_title_from_raw');
  } else if (
    parsed.title
    && rawTail.title
    && rawTail.publisher
    && normalizeReportTitle(parsed.title).toLowerCase().includes(rawTail.publisher.toLowerCase())
  ) {
    parsed.title = rawTail.title;
    reasons.push('replaced_report_title_with_raw_tail_title');
  } else if (parsed.title && rawTail.publisher) {
    const cleanedTitle = trimTrailingYearLeakFromTitle(parsed.title);
    if (cleanedTitle && cleanedTitle !== parsed.title) {
      parsed.title = cleanedTitle;
      reasons.push('trimmed_report_title_year_tail');
    }
  }

  if (!parsed.publisher && rawTail.publisher) {
    parsed.publisher = rawTail.publisher;
    reasons.push('recovered_report_publisher_from_raw');
  }
  if (!parsed.year && rawTail.year) {
    parsed.year = rawTail.year;
    reasons.push('recovered_report_year_from_raw');
  }

  const nextTitle = normalizeReportTitle(parsed.title);
  const nextPublisher = normalizeWhitespace(parsed.publisher ?? '');
  const nextJournal = normalizeWhitespace(parsed.journal ?? '');
  const nextInstitution = normalizeWhitespace(parsed.institution ?? '');

  const institutionSource = (
    nextInstitution && looksInstitutional(nextInstitution)
  )
    ? nextInstitution
    : (
      looksInstitutional(nextPublisher) && !looksCommercialPublisher(nextPublisher)
        ? nextPublisher
        : (!serialStructure && looksInstitutional(nextJournal) ? nextJournal : '')
    );

  const reportTitleLike = REPORT_TITLE_SIGNAL.test(nextTitle) && !BOOKISH_TITLE_SIGNAL.test(nextTitle);
  const strongReportEvidence = REPORT_DOI_SIGNAL.test(doi) || (
    reportTitleLike
    && !serialStructure
    && !nextJournal
    && !normalizeWhitespace(parsed.volume ?? '')
    && !normalizeWhitespace(parsed.issue ?? '')
  );
  const safeInstitutionalReportEvidence = Boolean(institutionSource)
    && !normalizeWhitespace(parsed.url ?? '')
    && !serialStructure
    && !BOOKISH_TITLE_SIGNAL.test(nextTitle)
    && !parsed.bookTitle
    && !parsed.conferenceTitle
    && !looksCommercialPublisher(nextPublisher);

  if (referenceType !== 'report' && (strongReportEvidence || safeInstitutionalReportEvidence)) {
    referenceType = 'report';
    reasons.push(strongReportEvidence ? 'promoted_to_report_from_strong_evidence' : 'promoted_to_report_from_institutional_evidence');
  }

  const institutionNeedsRepair = !parsed.institution || !looksInstitutional(parsed.institution);
  if (institutionNeedsRepair && institutionSource && referenceType === 'report') {
    parsed.institution = institutionSource;
    reasons.push(institutionSource === nextPublisher ? 'mapped_publisher_to_institution' : 'mapped_journal_to_institution');
    if (institutionSource === nextJournal) {
      parsed.journal = undefined;
    }
  }

  if (referenceType === 'report' && parsed.journal && looksInstitutional(parsed.journal) && !serialStructure) {
    parsed.institution = parsed.institution ?? parsed.journal;
    parsed.journal = undefined;
    reasons.push('cleared_report_journal_tail');
  }

  if (parsed.publisher) {
    parsed.publisher = restoreCorporateSuffixPeriod(parsed.publisher);
  }
  if (parsed.institution) {
    parsed.institution = restoreCorporateSuffixPeriod(parsed.institution);
  }

  return {
    parsed,
    referenceType,
    reasons: Array.from(new Set(reasons)),
  };
}
