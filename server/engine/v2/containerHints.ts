import type {
  CanonicalReferenceType,
  ExtractionContainerHints,
  ParsedReference,
} from '@shared/schema';
import { normalizeKnownContainerName } from '../shared/citationSemantics.js';
import { bestVenueFromParsed, proceedingsSignal } from './qualityRules.js';
import { normalizeWhitespace } from './utils.js';

const REPORT_PUBLISHER_SIGNAL = /\b(?:organization|agency|administration|department|ministry|office|commission|council|bank|foundation|university|institute|society|association|bureau|federal reserve|inter-american development bank|world health organization|un women|openai)\b/i;
const STRONG_REPORT_PUBLISHER_SIGNAL = /\b(?:office of scientific and technical information|defense technical information center|national bureau of economic research|national institute of standards and technology|inter-american development bank|federal reserve bank|nuclear regulatory commission|natural resources canada|akademiya2063|researchhub technologies|sae international)\b/i;
const REPORT_TITLE_SIGNAL = /\b(?:report|guideline|working paper|policy brief|technical note|white paper|manual|handbook|statement|case study)\b/i;
const REPORT_TITLE_OVERRIDE_SIGNAL = /\b(?:report|guideline|working paper|policy brief|briefs?|technical note|white paper|statement|case study|forecasts?)\b/i;
const BOOK_TITLE_SIGNAL = /\b(?:handbook|manual|guide|style guide|textbook|companion)\b/i;
const THESIS_SIGNAL = /\b(?:(?:doctoral|phd|master'?s?)\s+)?(?:dissertation|thesis)\b/i;
const REPORT_DOI_SIGNAL = /^(?:10\.2172\/|10\.21236\/|10\.6028\/|10\.3386\/w\d+|10\.20955\/wp\.|10\.18235\/|10\.54067\/acpf\.|10\.4095\/|10\.55277\/researchhub\.|10\.4271\/)/i;
const SERIAL_PAGES_TAIL_PATTERN = /(?:^|[.;,:]\s*:?\s*)(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?|e\d{4,}|n\d+)\s*$/i;
const SERIAL_VOLUME_ISSUE_TAIL_PATTERN = /(?:^|,\s*)(?<volume>\d+)\((?<issue>[A-Za-z0-9-]+)\)\s*$/i;
const SERIAL_VOLUME_TAIL_PATTERN = /(?:^|,\s*)(?<volume>\d+)\s*$/i;
const SERIAL_SEMICOLON_VOLUME_ISSUE_TAIL_PATTERN = /(?:^|[.;]\s*(?:1[5-9]\d{2}|20\d{2})\s*[;,:]\s*)(?<volume>\d+)\((?<issue>[A-Za-z0-9-]+)\)\s*$/i;
const SERIAL_SEMICOLON_VOLUME_TAIL_PATTERN = /(?:^|[.;]\s*(?:1[5-9]\d{2}|20\d{2})\s*[;,:]\s*)(?<volume>\d+)\s*$/i;
const SERIAL_YEAR_TAIL_PATTERN = /(?:^|[.;,]\s*)(?<year>(?:1[5-9]\d{2}|20\d{2}))(?:(?:\s*[;,:]\s*)|$)/i;
const JOURNAL_LIKE_SIGNAL = /\b(?:journal|review|transactions|letters|proceedings|science signaling|endoscopy|medicine|psychiatry|neurological sciences)\b/i;
const DOI_OR_URL_TAIL_PATTERN = /\b(?:doi:\s*)?10\.\d{4,}\/\S+\b|https?:\/\/\S+/gi;
const PUBLISHER_NAME_SIGNAL = /\b(?:ieee|acm|springer|elsevier|wiley|routledge|sage|taylor\s*&\s*francis|oxford university press|cambridge university press|crc press|mdpi|pearson|mcgraw-hill|palgrave|american society of mechanical engineers|thieme|press|verlag|editions?|editora|publishers?|federation)\b/i;
const SERIAL_TAIL_PATTERN = /(?:,\s*\d+(?:\([A-Za-z0-9-]+\))?(?:,\s*[A-Za-z]?\d[\w.-]*(?:\s*[-–]\s*[A-Za-z]?\d[\w.-]*)?)?|[.;]\s*(?:1[5-9]\d{2}|20\d{2})\s*[;,:]\s*\d+(?:\([A-Za-z0-9-]+\))?(?::\s*[A-Za-z0-9][\w.-]*(?:\s*[-–]\s*[A-Za-z0-9][\w.-]*)?)?)\s*$/i;
const SERIAL_LOCATOR_ONLY_TAIL_PATTERN = /(?:,\s*[A-Za-z]?\d[\w.-]*(?:\s*[-–]\s*[A-Za-z]?\d[\w.-]*)?)\s*$/i;

function stripLeadingDecoration(value: string): string {
  let cleaned = normalizeWhitespace(value);
  if (!cleaned) return cleaned;

  if (cleaned.startsWith('©')) cleaned = normalizeWhitespace(cleaned.slice(1));
  if (/^\d{4}\b/.test(cleaned)) cleaned = normalizeWhitespace(cleaned.replace(/^\d{4}\b/, ''));
  cleaned = cleaned.replace(/\ball rights reserved\b/gi, '');
  return normalizeWhitespace(cleaned.replace(/^[,.;:\- ]+|[,.;:\- ]+$/g, ''));
}

function cleanVenueFragment(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return normalized;

  const lower = normalized.toLowerCase();
  const cutMarkers = [' (pp.', ', pp.', ' pp.', ', vol.', ' vol.', ', no.', ' no.', ' doi:', ' https://', ' http://'];
  let end = normalized.length;
  for (const marker of cutMarkers) {
    const index = lower.indexOf(marker);
    if (index >= 0) end = Math.min(end, index);
  }

  let cleaned = normalizeWhitespace(normalized.slice(0, end));
  cleaned = normalizeWhitespace(
    cleaned
      .replace(SERIAL_TAIL_PATTERN, '')
      .replace(SERIAL_LOCATOR_ONLY_TAIL_PATTERN, ''),
  );
  if (cleaned.toLowerCase().startsWith('in ')) cleaned = normalizeWhitespace(cleaned.slice(3));
  return cleaned.replace(/[,:;.-]+$/g, '').trim();
}

function hasSerialJournalEvidence(parsed: ParsedReference): boolean {
  return Boolean(
    normalizeWhitespace(parsed.issue ?? '')
    || (
      normalizeWhitespace(parsed.volume ?? '')
      && normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? '')
    ),
  );
}

function looksSerialJournalContainerCandidate(value: string | undefined, parsed: ParsedReference): boolean {
  const cleaned = cleanVenueFragment(value ?? '');
  if (!cleaned) return false;
  if (proceedingsSignal(cleaned)) return false;
  if (/\b(?:conference|symposium|workshop|congress|meeting|forum|summit|colloquium|poster abstracts?|electronic poster abstracts?)\b/i.test(cleaned)) {
    return false;
  }
  if (!hasSerialJournalEvidence(parsed)) return false;
  return Boolean(
    JOURNAL_LIKE_SIGNAL.test(cleaned)
    || normalizeWhitespace(parsed.issue ?? '')
    || /[:&]/.test(cleaned)
  );
}

export function cleanConferenceTitleFragment(value: string): string {
  let cleaned = normalizeWhitespace(value).replace(DOI_OR_URL_TAIL_PATTERN, '');
  if (!cleaned) return cleaned;

  cleaned = cleaned
    .replace(/,\s*pp?\.?\s*[A-Za-z]?\d[\w.-]*(?:\s*[-–]\s*[A-Za-z]?\d[\w.-]*)?(?:\.\s*[^.]+)?$/i, '')
    .replace(/,\s*(?:1[5-9]\d{2}|20\d{2})(?:,\s*pp?\.?\s*[A-Za-z]?\d[\w.-]*(?:\s*[-–]\s*[A-Za-z]?\d[\w.-]*)?)?(?:\.\s*[^.]+)?$/i, '')
    .replace(/(?:,\s*|\.\s*)(?:1[5-9]\d{2}|20\d{2})\s*[;,:]\s*(?:pp?\.?\s*)?[A-Za-z0-9][\w.-]*(?:\s*[-–]\s*[A-Za-z0-9][\w.-]*)?(?:\.\s*[^.]+)?$/i, '')
    .replace(/(?:,\s*)(?:pp?\.?\s*)?\d+\s*[-–]\s*\d+(?:\.\s*[^.]+)?$/i, '')
    .replace(/\.\s*(?:19|20)\d{2}\s*$/i, '')
    .replace(/^in\s+/i, '')
    .trim();

  const sentenceParts = cleaned
    .split(/\.\s+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  if (sentenceParts.length >= 2) {
    const trailingPart = sentenceParts[sentenceParts.length - 1] ?? '';
    if (PUBLISHER_NAME_SIGNAL.test(trailingPart)) {
      sentenceParts.pop();
      cleaned = sentenceParts.join('. ');
    }
  }

  const commaParts = cleaned
    .split(',')
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  if (commaParts.length >= 2) {
    const trailingPart = commaParts[commaParts.length - 1] ?? '';
    if (
      PUBLISHER_NAME_SIGNAL.test(trailingPart)
      && !/\b(?:conference|symposium|workshop|congress|meeting|proceedings|forum|summit|colloquium|poster abstracts?|electronic poster abstracts?)\b/i.test(trailingPart)
    ) {
      cleaned = commaParts.slice(0, -1).join(', ');
    }
  }

  return normalizeWhitespace(cleaned.replace(/^[,.;:\- ]+|[,.;:\- ]+$/g, ''));
}

function looksLikeJournalVenuePublisher(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return JOURNAL_LIKE_SIGNAL.test(normalized);
}

function recoverSerialFieldsFromVenue(parsed: ParsedReference): ParsedReference {
  const next: ParsedReference = { ...parsed };
  const originalJournal = normalizeWhitespace(next.journal ?? '');
  if (!originalJournal) return next;
  const serialSource = normalizeWhitespace(originalJournal.replace(DOI_OR_URL_TAIL_PATTERN, ''))
    .replace(/[.;,:]\s*$/g, '');
  let journal = originalJournal;

  if (
    next.placeOfPublication
    && next.publisher
    && looksLikeJournalVenuePublisher(next.publisher)
    && originalJournal.toLowerCase().startsWith(normalizeWhitespace(next.placeOfPublication).toLowerCase())
  ) {
    journal = normalizeWhitespace(`${next.placeOfPublication}: ${next.publisher}`);
    next.placeOfPublication = undefined;
    next.publisher = undefined;
  }

  const yearMatch = serialSource.match(SERIAL_YEAR_TAIL_PATTERN);
  if (!next.year && yearMatch?.groups?.year) {
    next.year = yearMatch.groups.year;
  }
  const pagesMatch = serialSource.match(SERIAL_PAGES_TAIL_PATTERN);
  if (!next.pages && pagesMatch?.groups?.pages) {
    next.pages = normalizeWhitespace(pagesMatch.groups.pages).replace(/\s*[-–]\s*/g, '-');
    if (next['article-number'] && next['article-number'] === next.pages) {
      next['article-number'] = undefined;
    }
  }
  const volumeIssueMatch = serialSource.match(SERIAL_VOLUME_ISSUE_TAIL_PATTERN);
  if (volumeIssueMatch?.groups) {
    if (!next.volume) next.volume = volumeIssueMatch.groups.volume;
    if (!next.issue) next.issue = volumeIssueMatch.groups.issue;
  } else {
    const semicolonVolumeIssueMatch = serialSource.match(SERIAL_SEMICOLON_VOLUME_ISSUE_TAIL_PATTERN);
    if (semicolonVolumeIssueMatch?.groups) {
      if (!next.volume) next.volume = semicolonVolumeIssueMatch.groups.volume;
      if (!next.issue) next.issue = semicolonVolumeIssueMatch.groups.issue;
    }
    const volumeMatch = serialSource.match(SERIAL_VOLUME_TAIL_PATTERN)
      ?? serialSource.match(SERIAL_SEMICOLON_VOLUME_TAIL_PATTERN);
    if (!next.volume && volumeMatch?.groups?.volume) {
      next.volume = volumeMatch.groups.volume;
    }
  }

  journal = journal
    .replace(/\.\s*(?:1[5-9]\d{2}|20\d{2})\s*;\s*:?[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?\s*$/i, '')
    .replace(/,\s*\d+\([A-Za-z0-9-]+\)\s*$/i, '')
    .replace(/,\s*\d+\s*$/i, '')
    .replace(/\.\s*(?:1[5-9]\d{2}|20\d{2})\s*$/i, '')
    .replace(/[.;,:]\s*$/g, '');
  const cleanedJournal = cleanVenueFragment(journal);
  next.journal = cleanedJournal ? normalizeKnownContainerName(cleanedJournal) : next.journal;
  return next;
}

function cleanInstitutionFragment(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return normalized;

  let cleaned = normalized
    .replace(/^\[+|\]+$/g, '')
    .replace(/^\(?\s*(?:(?:doctoral|phd|master'?s?)\s+)?(?:dissertation|thesis)\s*,\s*/i, '')
    .replace(/[[(]\s*(?:(?:doctoral|phd|master'?s?)\s+)?(?:dissertation|thesis)\s*,\s*/i, '')
    .replace(/[,.;\s]+(?:1[5-9]\d{2}|20\d{2})\s*$/i, '')
    .replace(/[,.;\s]*(?:(?:doctoral|phd|master'?s?)\s+)?(?:dissertation|thesis)\.?$/i, '')
    .replace(/^[,.;\s]+|[\],.;\s]+$/g, '');
  cleaned = normalizeWhitespace(cleaned);
  return cleaned;
}

function looksCommercialBookPublisher(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return PUBLISHER_NAME_SIGNAL.test(normalized)
    || /\bon behalf of\b/i.test(normalized)
    || /\b(?:press|publishers?|verlag|editora|ediciones?|imprint)\b/i.test(normalized);
}

function splitTrailingPublisherFromBookTitle(bookTitle: string): { bookTitle: string; publisher?: string } {
  const normalized = normalizeWhitespace(bookTitle);
  if (!normalized || !normalized.includes(',')) return { bookTitle };

  const parts = normalized.split(',').map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (parts.length < 2) return { bookTitle: normalized };

  const publisherCandidate = parts[parts.length - 1] ?? '';
  if (!PUBLISHER_NAME_SIGNAL.test(publisherCandidate)) {
    return { bookTitle: normalized };
  }

  const titleCandidate = normalizeWhitespace(parts.slice(0, -1).join(', '));
  if (!titleCandidate) return { bookTitle: normalized };

  return {
    bookTitle: titleCandidate,
    publisher: publisherCandidate,
  };
}

function inferContainerKind(
  parsed: ParsedReference,
  referenceType: CanonicalReferenceType,
  venue: string,
): { kind: ExtractionContainerHints['containerKindHint']; confidence: number } {
  const lowerVenue = venue.toLowerCase();
  const explicitContainerVenue = normalizeWhitespace(parsed.journal ?? parsed.conferenceTitle ?? parsed.bookTitle ?? '');
  const locator = normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? '');
  const publisherOrInstitution = normalizeWhitespace(parsed.institution ?? parsed.publisher ?? '');
  const title = normalizeWhitespace(parsed.title ?? '');
  const doi = normalizeWhitespace(parsed.doi ?? '');
  const reportTitleLike = REPORT_TITLE_OVERRIDE_SIGNAL.test(title)
    || /\bbriefs?\s+no\.?\s*\d+\b/i.test(title);
  const bookClaimLikely = referenceType === 'book'
    || Boolean(parsed.edition)
    || BOOK_TITLE_SIGNAL.test(title);
  const strongReportEvidence = referenceType === 'report'
    || STRONG_REPORT_PUBLISHER_SIGNAL.test(publisherOrInstitution)
    || REPORT_DOI_SIGNAL.test(doi)
    || reportTitleLike
    || (REPORT_TITLE_SIGNAL.test(title) && !BOOK_TITLE_SIGNAL.test(title));
  const weakInstitutionalReportEvidence = REPORT_PUBLISHER_SIGNAL.test(publisherOrInstitution)
    && !looksCommercialBookPublisher(publisherOrInstitution)
    && !bookClaimLikely;

  if (
    parsed.conferenceTitle
    || proceedingsSignal(venue)
    || lowerVenue.includes('proc.')
    || lowerVenue.includes('conference')
    || lowerVenue.includes('symposium')
    || lowerVenue.includes('workshop')
    || lowerVenue.includes('congress')
  ) {
    return { kind: 'conference', confidence: 0.96 };
  }

  if (parsed.bookTitle) {
    return { kind: 'book', confidence: referenceType === 'chapter' ? 0.95 : 0.9 };
  }

  const thesisEvidence = [
    parsed.institution,
    parsed.publisher,
    parsed.journal,
    parsed.bookTitle,
    parsed.title,
  ].some((value) => THESIS_SIGNAL.test(normalizeWhitespace(value ?? '')));

  if ((referenceType === 'thesis' && parsed.institution) || thesisEvidence) {
    return { kind: 'thesis', confidence: 0.96 };
  }

  if (
    parsed.url
    && !explicitContainerVenue
    && !parsed.volume
    && !parsed.issue
    && !locator
    && !parsed.bookTitle
    && !parsed.conferenceTitle
    && (referenceType === 'website' || !publisherOrInstitution)
  ) {
    return { kind: 'website', confidence: referenceType === 'website' ? 0.96 : 0.9 };
  }

  if (
    publisherOrInstitution
    && !explicitContainerVenue
    && !parsed.volume
    && !parsed.issue
    && !locator
    && !parsed.bookTitle
    && !parsed.conferenceTitle
    && (
      strongReportEvidence
      || weakInstitutionalReportEvidence
    )
  ) {
    return { kind: 'report', confidence: referenceType === 'report' ? 0.94 : 0.88 };
  }

  if (
    referenceType === 'book'
    && !explicitContainerVenue
    && !parsed.volume
    && !parsed.issue
    && !locator
    && !parsed.bookTitle
    && !parsed.conferenceTitle
    && !reportTitleLike
    && (parsed.edition || BOOK_TITLE_SIGNAL.test(title) || publisherOrInstitution)
  ) {
    return { kind: 'book', confidence: 0.92 };
  }

  if (referenceType === 'report' && (parsed.institution || parsed.publisher)) {
    return { kind: 'report', confidence: 0.78 };
  }

  if (referenceType === 'website' && parsed.url && !explicitContainerVenue) {
    return { kind: 'website', confidence: 0.76 };
  }

  if (parsed.journal || venue) {
    return { kind: 'journal', confidence: 0.82 };
  }

  return { kind: 'unknown', confidence: 0 };
}

export function buildContainerHints(
  parsed: ParsedReference,
  referenceType: CanonicalReferenceType,
): ExtractionContainerHints {
  const venue = normalizeWhitespace(bestVenueFromParsed(parsed) ?? '');
  const lowerVenue = venue.toLowerCase();
  const publisher = normalizeWhitespace(parsed.publisher ?? '');
  const publisherLower = publisher.toLowerCase();
  const combinedTail = normalizeWhitespace([venue, publisher].filter(Boolean).join(' '));
  const copyrightPublisherCandidate = stripLeadingDecoration(
    publisher.startsWith('©') ? publisher : lowerVenue.startsWith('©') ? venue : '',
  );
  const container = inferContainerKind(parsed, referenceType, venue);

  const locatorInVenue = Boolean(venue) && (
    lowerVenue.includes(' pp.')
    || lowerVenue.includes('(pp.')
    || lowerVenue.includes(' vol.')
    || lowerVenue.includes(' no.')
    || SERIAL_TAIL_PATTERN.test(venue)
  );
  const venueContaminated = Boolean(venue) && (
    lowerVenue.startsWith('in ')
    || locatorInVenue
    || lowerVenue.includes('doi:')
    || lowerVenue.includes('https://')
    || lowerVenue.includes('http://')
    || lowerVenue.startsWith('©')
  );
  const normalizedTitle = normalizeWhitespace(parsed.title ?? '');
  const lowerTitle = normalizedTitle.toLowerCase();
  const titleContainerBleed = Boolean(normalizedTitle) && (
    normalizedTitle.includes('" In ')
    || normalizedTitle.includes('. In ')
    || lowerTitle.includes(' in proceedings')
    || lowerTitle.includes(' in endoscopy')
  );
  const publisherTailPresent = Boolean(
    publisher
    || combinedTail.toLowerCase().includes('press')
    || combinedTail.toLowerCase().includes('springer')
    || combinedTail.toLowerCase().includes('wiley')
    || combinedTail.toLowerCase().includes('elsevier')
    || combinedTail.toLowerCase().includes('routledge')
    || combinedTail.toLowerCase().includes('thieme')
    || combinedTail.toLowerCase().includes('publisher')
  );
  const copyrightTailPresent = (
    publisher.startsWith('©')
    || publisherLower.includes('all rights reserved')
    || lowerVenue.startsWith('©')
    || lowerVenue.includes('all rights reserved')
  );

  return {
    containerKindHint: container.kind,
    containerKindConfidence: container.confidence,
    venueContaminated,
    titleContainerBleed,
    publisherTailPresent,
    locatorInVenue,
    copyrightTailPresent,
    copyrightPublisherCandidate: copyrightPublisherCandidate || null,
  };
}

export function resolveWinnerContainer(
  parsed: ParsedReference,
  referenceType: CanonicalReferenceType,
): { parsed: ParsedReference; containerHints: ExtractionContainerHints } {
  let next: ParsedReference = { ...parsed };
  let hints = buildContainerHints(next, referenceType);

  if (next.bookTitle) {
    const cleanedBookTitle = cleanVenueFragment(next.bookTitle);
    if (cleanedBookTitle && cleanedBookTitle !== next.bookTitle) {
      next.bookTitle = normalizeKnownContainerName(cleanedBookTitle);
    }
  }
  if (next.conferenceTitle) {
    const cleanedConferenceTitle = cleanConferenceTitleFragment(next.conferenceTitle);
    if (cleanedConferenceTitle && cleanedConferenceTitle !== next.conferenceTitle) {
      next.conferenceTitle = normalizeKnownContainerName(cleanedConferenceTitle);
    }
  }

  const serialContainerCandidate = [
    next.journal ? undefined : next.bookTitle,
    next.journal ? undefined : next.conferenceTitle,
  ]
    .map((value) => normalizeWhitespace(value ?? ''))
    .find((value) => looksSerialJournalContainerCandidate(value, next));

  if (serialContainerCandidate) {
    next.journal = normalizeKnownContainerName(cleanVenueFragment(serialContainerCandidate));
    if (normalizeWhitespace(next.bookTitle ?? '') === serialContainerCandidate) next.bookTitle = undefined;
    if (normalizeWhitespace(next.conferenceTitle ?? '') === serialContainerCandidate) next.conferenceTitle = undefined;
  }

  if (next.bookTitle) {
    const editedBookTitleMatch = normalizeWhitespace(next.bookTitle).match(/^(?<bookTitle>.+?),\s+edited by\s+(?<editor>.+?)(?:,\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?))?$/i);
    if (editedBookTitleMatch?.groups) {
      next.bookTitle = normalizeWhitespace(editedBookTitleMatch.groups.bookTitle ?? '') || next.bookTitle;
      next.editor = normalizeWhitespace(next.editor ?? editedBookTitleMatch.groups.editor ?? '') || next.editor;
      if (!next.pages && editedBookTitleMatch.groups.pages) {
        next.pages = normalizeWhitespace(editedBookTitleMatch.groups.pages).replace(/\s*[-–]\s*/g, '-');
      }
    }

    if (!next.publisher) {
      const splitBookTitle = splitTrailingPublisherFromBookTitle(next.bookTitle);
      next.bookTitle = splitBookTitle.bookTitle;
      if (splitBookTitle.publisher) {
        next.publisher = splitBookTitle.publisher;
      }
    }
  }

  const thesisTitleMatch = normalizeWhitespace(next.title ?? '').match(
    /^(?<title>.+?)\s*[\[(](?:(?:doctoral|phd|master'?s?)\s+)?(?:dissertation|thesis)\s*,\s*(?<institution>[^\])]+)[\])]\.?$/i,
  );
  if (thesisTitleMatch?.groups) {
    next.title = normalizeWhitespace(thesisTitleMatch.groups.title ?? '') || next.title;
    next.institution = cleanInstitutionFragment(thesisTitleMatch.groups.institution ?? '') || next.institution;
  }

  if (referenceType === 'thesis' || hints.containerKindHint === 'thesis') {
    if (next.institution) {
      next.institution = cleanInstitutionFragment(next.institution);
    } else {
      const thesisContainerCandidate = [next.journal, next.bookTitle, next.publisher]
        .map((value) => normalizeWhitespace(value ?? ''))
        .find((value) => THESIS_SIGNAL.test(value) || /(?:19|20)\d{2}.*\b(?:dissertation|thesis)\b/i.test(value));
      if (thesisContainerCandidate) {
        next.institution = cleanInstitutionFragment(thesisContainerCandidate) || next.institution;
      }
    }

    if (next.journal && THESIS_SIGNAL.test(next.journal)) next.journal = undefined;
    if (next.bookTitle && THESIS_SIGNAL.test(next.bookTitle)) next.bookTitle = undefined;
    if (next.publisher && THESIS_SIGNAL.test(next.publisher) && next.institution) next.publisher = cleanInstitutionFragment(next.publisher);
  }

  if ((referenceType === 'journal' || hints.containerKindHint === 'journal') && next.journal) {
    next = recoverSerialFieldsFromVenue(next);
  }

  if (
    (referenceType === 'journal' || hints.containerKindHint === 'journal')
    && next.journal
    && SERIAL_TAIL_PATTERN.test(next.journal)
  ) {
    next.journal = normalizeKnownContainerName(cleanVenueFragment(next.journal));
  }

  if (next.publisher) {
    const cleanedPublisher = stripLeadingDecoration(next.publisher);
    if (cleanedPublisher) next.publisher = cleanedPublisher;
  } else if (hints.copyrightPublisherCandidate) {
    next.publisher = hints.copyrightPublisherCandidate;
  }

  if (!next.placeOfPublication && next.publisher) {
    const placePublisherMatch = normalizeWhitespace(next.publisher).match(/^(?<place>[^:]+):\s*(?<publisher>.+)$/);
    if (placePublisherMatch?.groups) {
      next.placeOfPublication = normalizeWhitespace(placePublisherMatch.groups.place ?? '') || next.placeOfPublication;
      next.publisher = normalizeWhitespace(placePublisherMatch.groups.publisher ?? '') || next.publisher;
    }
  }

  if (next.journal && hints.venueContaminated) {
    next.journal = normalizeKnownContainerName(cleanVenueFragment(next.journal));
  }
  if (next.conferenceTitle && (referenceType === 'conference' || hints.containerKindHint === 'conference' || hints.venueContaminated)) {
    next.conferenceTitle = normalizeKnownContainerName(cleanConferenceTitleFragment(next.conferenceTitle));
  }
  if (next.bookTitle && hints.venueContaminated) {
    next.bookTitle = normalizeKnownContainerName(cleanVenueFragment(next.bookTitle));
  }

  if (next.journal) next.journal = normalizeKnownContainerName(next.journal);
  if (next.conferenceTitle) next.conferenceTitle = normalizeKnownContainerName(next.conferenceTitle);
  if (next.bookTitle) next.bookTitle = normalizeKnownContainerName(next.bookTitle);

  hints = buildContainerHints(next, referenceType);
  return { parsed: next, containerHints: hints };
}
