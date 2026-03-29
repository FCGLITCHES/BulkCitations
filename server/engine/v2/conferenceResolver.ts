import type { CanonicalReferenceType, ParsedReference } from '@shared/schema';
import { classifyLocatorToken, normalizeKnownContainerName } from '../shared/citationSemantics.js';
import { cleanConferenceTitleFragment } from './containerHints.js';
import { proceedingsSignal } from './qualityRules.js';
import { normalizeWhitespace } from './utils.js';

const CONFERENCE_TEXT_SIGNAL = /\b(?:conference|symposium|workshop|congress|meeting|forum|summit|colloquium|proceedings|poster abstracts?|electronic poster abstracts?)\b/i;
const PUBLISHER_SIGNAL = /\b(?:ieee|acm|springer|elsevier|wiley|routledge|sage|taylor\s*&\s*francis|oxford university press|cambridge university press|crc press|mdpi|pearson|mcgraw-hill|palgrave|american society of mechanical engineers|european association of geoscientists\s*&\s*engineers|thieme|press|publisher|publishing|verlag|editions?|ediciones?|editora|federation)\b/i;
const INSTITUTIONAL_SIGNAL = /\b(?:organization|agency|administration|department|ministry|office|commission|council|foundation|university|institute|society|association|bureau|center|centre|laborator(?:y|ies)|college|academy)\b/i;
const DOI_OR_URL_TAIL_PATTERN = /\b(?:doi:\s*)?10\.\d{4,}\/\S+\b|https?:\/\/\S+/gi;
const TRAILING_YEAR_PATTERN = /(?:[.;,]\s*|\s+)(?<year>(?:1[5-9]\d{2}|20\d{2}))\s*$/i;
const LOCATOR_SIGNAL = /^(?:pp?\.?\s*)?(?=[A-Za-z0-9.-]*\d)[A-Za-z0-9][A-Za-z0-9.-]*(?:\s*[-–]\s*[A-Za-z0-9][A-Za-z0-9.-]*)?$/i;

function hasConferenceText(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return CONFERENCE_TEXT_SIGNAL.test(normalized)
    || proceedingsSignal(normalized)
    || /\b(?:ieee cat\.?\s*no\.?|lfnm|iccic|icassp|trustcom|crimean conference|bioengineering conference)\b/i.test(normalized);
}

function looksStandalonePublisherTail(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  if (hasConferenceText(normalized)) return false;
  if (/ieee cat\.?\s*no\.?/i.test(normalized)) return false;
  return PUBLISHER_SIGNAL.test(normalized);
}

function cleanSentenceNoise(value: string): string {
  return normalizeWhitespace(
    value
      .replace(DOI_OR_URL_TAIL_PATTERN, '')
      .replace(/[.;,:]\s*$/g, ''),
  );
}

function scoreConferenceCandidate(candidate: string, parsed: ParsedReference): number {
  const normalized = normalizeWhitespace(candidate);
  if (!normalized) return Number.POSITIVE_INFINITY;

  let score = 0;
  const title = normalizeWhitespace(parsed.title ?? '');
  if (title && normalized.toLowerCase().includes(title.toLowerCase())) score += 4;
  if (/\bpp?\./i.test(normalized) || /\(\s*pp?\./i.test(normalized)) score += 3;
  if (/\bdoi\b|https?:\/\//i.test(normalized)) score += 3;
  if (/,\s*(?:1[5-9]\d{2}|20\d{2})\b/.test(normalized)) score += 2;
  if (/\babstracts?(?:,\s*pp)?\b/i.test(normalized) && !/electronic poster abstracts?/i.test(normalized)) score += 2;
  if (/^[^.]+?\.\s+(?:proceedings|proc\.?|book of abstracts|electronic poster abstracts?)\b/i.test(normalized)) score += 4;
  if (hasConferenceText(normalized)) score -= 2;
  if (/ieee cat\.?\s*no\.?/i.test(normalized)) score -= 1;
  if (/\bproceedings\b/i.test(normalized)) score -= 1;
  return score;
}

function reorderConferenceLead(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';

  const reversedLeadMatch = normalized.match(/^(?<topic>.+?),\s*(?<prefix>(?:\d{4}\s+)?(?:ieee|acm).+?(?:conference|symposium|workshop|congress|meeting)\s+(?:on|for))$/i);
  if (reversedLeadMatch?.groups?.topic && reversedLeadMatch.groups.prefix) {
    return normalizeWhitespace(`${reversedLeadMatch.groups.prefix} ${reversedLeadMatch.groups.topic}`);
  }

  return normalized;
}

function normalizeConferenceContainer(value: string): string {
  const normalized = reorderConferenceLead(cleanSentenceNoise(value));
  if (!normalized) return '';

  const sentenceParts = normalized
    .split(/\.\s+/)
    .map((part) => cleanSentenceNoise(cleanConferenceTitleFragment(part)))
    .filter(Boolean);

  if (sentenceParts.length === 0) return '';

  const keptParts = sentenceParts.filter((part, index) => {
    if (!part) return false;
    if (index === 0) return true;
    if (TRAILING_YEAR_PATTERN.test(part)) return false;
    if (LOCATOR_SIGNAL.test(part)) return false;
    if (/^abstracts?(?:,\s*pp)?$/i.test(part)) return false;
    return !looksStandalonePublisherTail(part);
  });

  return normalizeWhitespace(keptParts.join('. '));
}

function splitTrailingPlace(value: string): { conferenceTitle: string; place?: string } {
  const normalized = normalizeWhitespace(value);
  if (!normalized || !normalized.includes(',')) return { conferenceTitle: normalized };

  const commaParts = normalized
    .split(',')
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  if (commaParts.length < 2) return { conferenceTitle: normalized };

  const last = commaParts[commaParts.length - 1] ?? '';
  if (hasConferenceText(last) || looksStandalonePublisherTail(last)) {
    return { conferenceTitle: normalized };
  }
  if (!/^[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){0,3}$/u.test(last)) {
    return { conferenceTitle: normalized };
  }

  return {
    conferenceTitle: normalizeWhitespace(commaParts.slice(0, -1).join(', ')),
    place: last,
  };
}

function splitTrailingPublisher(value: string): { conferenceTitle: string; publisher?: string } {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return { conferenceTitle: '' };

  const sentenceParts = normalized
    .split(/\.\s+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  if (sentenceParts.length >= 2) {
    const last = sentenceParts[sentenceParts.length - 1] ?? '';
    if (looksStandalonePublisherTail(last)) {
      return {
        conferenceTitle: normalizeWhitespace(sentenceParts.slice(0, -1).join('. ')),
        publisher: last,
      };
    }
  }

  const commaParts = normalized
    .split(',')
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  if (commaParts.length >= 2) {
    const last = commaParts[commaParts.length - 1] ?? '';
    if (looksStandalonePublisherTail(last)) {
      return {
        conferenceTitle: normalizeWhitespace(commaParts.slice(0, -1).join(', ')),
        publisher: last,
      };
    }
  }

  return { conferenceTitle: normalized };
}

function extractLocator(value: string): { cleaned: string; locator?: string } {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return { cleaned: '' };

  const parenMatch = normalized.match(/\((?:pp?\.?\s*)?(?<locator>(?=[A-Za-z0-9.-]*\d)[A-Za-z0-9][A-Za-z0-9.-]*(?:\s*[-–]\s*[A-Za-z0-9][A-Za-z0-9.-]*)?)\)/i);
  if (parenMatch?.groups?.locator) {
    return {
      cleaned: normalizeWhitespace(normalized.replace(parenMatch[0], '')),
      locator: normalizeWhitespace(parenMatch.groups.locator).replace(/\s*[-–]\s*/g, '-'),
    };
  }

  const suffixMatch = normalized.match(/(?:,\s*|\.\s*)(?:pp?\.?\s*)?(?<locator>(?=[A-Za-z0-9.-]*\d)[A-Za-z0-9][A-Za-z0-9.-]*(?:\s*[-–]\s*[A-Za-z0-9][A-Za-z0-9.-]*)?)(?=(?:[.,;]\s*(?:1[5-9]\d{2}|20\d{2})\b)|(?:[.,;]\s*(?:ieee|acm|springer|elsevier|wiley|routledge|sage|american society of mechanical engineers|european association of geoscientists\s*&\s*engineers)\b)|$)/i);
  if (suffixMatch?.groups?.locator) {
    return {
      cleaned: normalizeWhitespace(normalized.replace(suffixMatch[0], '')),
      locator: normalizeWhitespace(suffixMatch.groups.locator).replace(/\s*[-–]\s*/g, '-'),
    };
  }

  return { cleaned: normalized };
}

function splitConferenceTailComponents(value: string): {
  conferenceTitle: string;
  publisher?: string;
  locator?: string;
  place?: string;
} {
  const withoutIdentifiers = cleanSentenceNoise(value);
  const withoutTrailingYear = normalizeWhitespace(withoutIdentifiers.replace(TRAILING_YEAR_PATTERN, ''));
  const locatorSplit = extractLocator(withoutTrailingYear);
  const afterLocatorYearCleanup = normalizeWhitespace(locatorSplit.cleaned.replace(TRAILING_YEAR_PATTERN, ''));
  const publisherSplit = splitTrailingPublisher(afterLocatorYearCleanup);
  const placeSplit = splitTrailingPlace(publisherSplit.conferenceTitle);

  return {
    conferenceTitle: normalizeConferenceContainer(placeSplit.conferenceTitle),
    publisher: publisherSplit.publisher,
    locator: locatorSplit.locator,
    place: placeSplit.place,
  };
}

function extractInlineConferenceFromTitle(title: string | undefined): { title?: string; container?: string } {
  const normalized = normalizeWhitespace(title ?? '');
  if (!normalized) return {};

  const inlineMatch = normalized.match(/^(?<title>.+?)[."]\s+In\s+(?<container>.+)$/i);
  if (inlineMatch?.groups?.container) {
    return {
      title: normalizeWhitespace(inlineMatch.groups.title).replace(/["”]$/u, ''),
      container: inlineMatch.groups.container,
    };
  }

  return {};
}

function extractConferenceFromRaw(rawNormalized: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(rawNormalized ?? '');
  if (!normalized) return undefined;

  const inMatch = normalized.match(/(?:^|[."]\s+)\bIn\s+(?<container>.+)$/i);
  if (inMatch?.groups?.container) {
    return normalizeWhitespace(inMatch.groups.container);
  }

  return undefined;
}

function extractProceedingsTail(rawNormalized: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(rawNormalized ?? '');
  if (!normalized) return undefined;
  const match = normalized.match(/\b(?<tail>(?:proceedings|proc\.?|book of abstracts|electronic poster abstracts?)\b[^.;]*(?:\.\s*[^.;]+)?)/i);
  return splitConferenceTailComponents(match?.groups?.tail ?? '').conferenceTitle;
}

function extractConferenceCatalogTail(rawNormalized: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(rawNormalized ?? '');
  if (!normalized) return undefined;
  const match = normalized.match(/\((?<catalog>IEEE Cat\.?\s*No\.?[^)]+)\)/i);
  return normalizeWhitespace(match?.groups?.catalog ?? '');
}

function applyRecoveredLocator(parsed: ParsedReference, locator: string | undefined): ParsedReference {
  if (!locator) return parsed;
  if (normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? '')) return parsed;

  const classified = classifyLocatorToken(locator);
  if (!classified.value) return parsed;

  if (classified.kind === 'article-number') {
    return { ...parsed, 'article-number': classified.value };
  }
  if (classified.kind === 'pages') {
    return { ...parsed, pages: classified.value };
  }
  return parsed;
}

function hasProceedingsLeadBleed(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return /^[^.]+?\.\s+(?:proceedings|proc\.?|book of abstracts|electronic poster abstracts?)\b/i.test(normalized);
}

function clearConferenceInstitutionLeak(parsed: ParsedReference): ParsedReference {
  if (!parsed.institution) return parsed;

  const institution = normalizeWhitespace(parsed.institution);
  const conferenceTitle = normalizeWhitespace(parsed.conferenceTitle ?? '');
  const publisher = normalizeWhitespace(parsed.publisher ?? '');

  const leakedConferenceTail = Boolean(conferenceTitle) && institution.toLowerCase().includes(conferenceTitle.toLowerCase());
  const duplicatedPublisher = Boolean(publisher) && institution.toLowerCase() === publisher.toLowerCase();
  const conferenceNoiseOnly = hasConferenceText(institution) && !INSTITUTIONAL_SIGNAL.test(institution);

  if (leakedConferenceTail || duplicatedPublisher || conferenceNoiseOnly) {
    return {
      ...parsed,
      institution: undefined,
    };
  }

  return parsed;
}

export function resolveConferenceContainer(options: {
  parsed: ParsedReference;
  referenceType: CanonicalReferenceType;
  rawNormalized?: string;
}): {
  parsed: ParsedReference;
  referenceType: CanonicalReferenceType;
  reasons: string[];
} {
  let parsed: ParsedReference = { ...options.parsed };
  let referenceType = options.referenceType;
  const reasons: string[] = [];

  const inlineTitle = extractInlineConferenceFromTitle(parsed.title);
  const inlineTitleLooksConference = Boolean(inlineTitle.container) && hasConferenceText(inlineTitle.container);
  const rawConferenceCandidate = extractConferenceFromRaw(options.rawNormalized);
  const rawConferenceLooksConference = Boolean(rawConferenceCandidate) && hasConferenceText(rawConferenceCandidate);
  const rawRecovered = rawConferenceCandidate ? splitConferenceTailComponents(rawConferenceCandidate) : {
    conferenceTitle: '',
    publisher: undefined,
    locator: undefined,
    place: undefined,
  };
  const proceedingsTail = extractProceedingsTail(options.rawNormalized);
  const catalogTail = extractConferenceCatalogTail(options.rawNormalized);

  if (inlineTitle.title && inlineTitle.container && (referenceType === 'conference' || inlineTitleLooksConference)) {
    parsed.title = inlineTitle.title;
    reasons.push('trimmed_inline_conference_tail_from_title');
  }

  const conferenceCandidates = [
    parsed.conferenceTitle,
    inlineTitleLooksConference || referenceType === 'conference' ? inlineTitle.container : undefined,
    hasConferenceText(parsed.bookTitle) ? parsed.bookTitle : undefined,
    hasConferenceText(parsed.journal) ? parsed.journal : undefined,
    rawConferenceLooksConference || referenceType === 'conference' ? rawConferenceCandidate : undefined,
  ]
    .map((value) => normalizeWhitespace(value ?? ''))
    .filter(Boolean);

  const conferenceSource = conferenceCandidates
    .sort((left, right) => scoreConferenceCandidate(left, parsed) - scoreConferenceCandidate(right, parsed))[0];
  if (!conferenceSource) {
    return { parsed, referenceType, reasons };
  }

  const resolved = splitConferenceTailComponents(conferenceSource);
  if (resolved.conferenceTitle) {
    parsed.conferenceTitle = normalizeKnownContainerName(resolved.conferenceTitle);
    reasons.push('resolved_conference_container');
  }
  if (
    rawRecovered.conferenceTitle
    && /^\[(?:1[5-9]\d{2}|20\d{2})\]\s+/i.test(rawRecovered.conferenceTitle)
    && parsed.conferenceTitle
  ) {
    const rawWithoutBracketYear = normalizeWhitespace(rawRecovered.conferenceTitle.replace(/^\[(?:1[5-9]\d{2}|20\d{2})\]\s+/i, ''));
    if (
      rawWithoutBracketYear
      && normalizeWhitespace(parsed.conferenceTitle).toLowerCase() === rawWithoutBracketYear.toLowerCase()
    ) {
      parsed.conferenceTitle = normalizeKnownContainerName(rawRecovered.conferenceTitle);
      reasons.push('preserved_bracketed_conference_year_from_raw');
    }
  }
  if (
    proceedingsTail
    && parsed.conferenceTitle
    && (
      hasProceedingsLeadBleed(parsed.conferenceTitle)
      || (
        parsed.conferenceTitle.toLowerCase().includes(proceedingsTail.toLowerCase())
        && !parsed.conferenceTitle.toLowerCase().startsWith(proceedingsTail.toLowerCase())
      )
    )
  ) {
    const proceedingsReplacement = (
      rawRecovered.conferenceTitle
      && /^\[(?:1[5-9]\d{2}|20\d{2})\]\s+/i.test(rawRecovered.conferenceTitle)
      && rawRecovered.conferenceTitle.toLowerCase().includes(proceedingsTail.toLowerCase())
    )
      ? rawRecovered.conferenceTitle
      : proceedingsTail;
    parsed.conferenceTitle = normalizeKnownContainerName(proceedingsReplacement);
    reasons.push('replaced_bleeding_conference_title_with_proceedings_tail');
  }
  const currentPublisher = normalizeWhitespace(parsed.publisher ?? '');
  const normalizedConferenceTitle = normalizeWhitespace(parsed.conferenceTitle ?? '');
  const pollutedPublisher = currentPublisher
    && (
      (Boolean(normalizedConferenceTitle) && currentPublisher.toLowerCase().includes(normalizedConferenceTitle.toLowerCase()))
      || /^in\b/i.test(currentPublisher)
      || /\bpp?\./i.test(currentPublisher)
    );
  const recoveredPublisher = resolved.publisher ?? rawRecovered.publisher;
  if ((pollutedPublisher || !parsed.publisher) && recoveredPublisher) {
    parsed.publisher = recoveredPublisher;
    reasons.push('recovered_conference_publisher');
  }
  const recoveredPlace = resolved.place ?? rawRecovered.place;
  if (!parsed.placeOfPublication && recoveredPlace) {
    parsed.placeOfPublication = recoveredPlace;
    reasons.push('recovered_conference_place');
  }

  const recoveredLocator = resolved.locator ?? rawRecovered.locator;
  parsed = applyRecoveredLocator(parsed, recoveredLocator);
  if (recoveredLocator && normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? '') === recoveredLocator) {
    reasons.push('recovered_conference_locator');
  }

  const remainingLocator = extractLocator(parsed.conferenceTitle ?? '');
  if (remainingLocator.locator) {
    parsed = applyRecoveredLocator(parsed, remainingLocator.locator);
    parsed.conferenceTitle = normalizeKnownContainerName(normalizeConferenceContainer(remainingLocator.cleaned));
    reasons.push('trimmed_locator_noise_from_conference_title');
  }

  if (
    proceedingsTail
    && parsed.conferenceTitle
    && !/\b(?:proceedings|proc\.?|book of abstracts|electronic poster abstracts?)\b/i.test(parsed.conferenceTitle)
    && !parsed.conferenceTitle.toLowerCase().includes(proceedingsTail.toLowerCase())
  ) {
    parsed.conferenceTitle = normalizeKnownContainerName(`${parsed.conferenceTitle}. ${proceedingsTail}`);
    reasons.push('appended_proceedings_tail_from_raw');
  }

  if (
    catalogTail
    && parsed.conferenceTitle
    && !parsed.conferenceTitle.toLowerCase().includes(catalogTail.toLowerCase())
  ) {
    parsed.conferenceTitle = normalizeKnownContainerName(`${parsed.conferenceTitle} (${catalogTail})`);
    reasons.push('appended_conference_catalog_tail_from_raw');
  }

  if (hasConferenceText(parsed.journal)) {
    parsed.journal = undefined;
    reasons.push('cleared_conference_journal_leak');
  }
  if (hasConferenceText(parsed.bookTitle)) {
    parsed.bookTitle = undefined;
    reasons.push('cleared_conference_book_title_leak');
  }
  if (parsed.placeOfPublication && /^in\b/i.test(normalizeWhitespace(parsed.placeOfPublication))) {
    parsed.placeOfPublication = undefined;
    reasons.push('cleared_conference_place_leak');
  }

  parsed = clearConferenceInstitutionLeak(parsed);
  if (referenceType !== 'conference') {
    referenceType = 'conference';
    reasons.push('resolved_conference_reference_type');
  }

  return {
    parsed,
    referenceType,
    reasons: Array.from(new Set(reasons)),
  };
}
