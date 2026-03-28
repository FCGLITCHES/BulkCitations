import type {
  CanonicalReferenceType,
  ExtractionContainerHints,
  ParsedReference,
} from '@shared/schema';
import { normalizeKnownContainerName } from '../shared/citationSemantics.js';
import { bestVenueFromParsed, proceedingsSignal } from './qualityRules.js';
import { normalizeWhitespace } from './utils.js';

const REPORT_PUBLISHER_SIGNAL = /\b(?:organization|agency|administration|department|ministry|office|commission|council|bank|foundation|university|institute|society|association|bureau|federal reserve|inter-american development bank|world health organization|un women|openai)\b/i;
const REPORT_TITLE_SIGNAL = /\b(?:report|guideline|working paper|policy brief|technical note|white paper|manual|handbook|statement|case study)\b/i;
const BOOK_TITLE_SIGNAL = /\b(?:handbook|manual|guide|style guide|textbook|companion)\b/i;
const THESIS_SIGNAL = /\b(?:(?:doctoral|phd|master'?s?)\s+)?(?:dissertation|thesis)\b/i;
const SERIAL_PAGES_TAIL_PATTERN = /(?:^|[.;,:]\s*:?\s*)(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?|e\d{4,}|n\d+)\s*$/i;
const SERIAL_VOLUME_ISSUE_TAIL_PATTERN = /(?:^|,\s*)(?<volume>\d+)\((?<issue>[A-Za-z0-9-]+)\)\s*$/i;
const SERIAL_VOLUME_TAIL_PATTERN = /(?:^|,\s*)(?<volume>\d+)\s*$/i;
const SERIAL_YEAR_TAIL_PATTERN = /(?:^|[.;,]\s*)(?<year>(?:1[5-9]\d{2}|20\d{2}))(?:(?:\s*[;,:]\s*)|$)/i;
const JOURNAL_LIKE_SIGNAL = /\b(?:journal|review|transactions|letters|proceedings|science signaling|endoscopy|medicine|psychiatry|neurological sciences)\b/i;
const DOI_OR_URL_TAIL_PATTERN = /\b(?:doi:\s*)?10\.\d{4,}\/\S+\b|https?:\/\/\S+/gi;

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
  if (cleaned.toLowerCase().startsWith('in ')) cleaned = normalizeWhitespace(cleaned.slice(3));
  return cleaned.replace(/[,:;.-]+$/g, '').trim();
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
    const volumeMatch = serialSource.match(SERIAL_VOLUME_TAIL_PATTERN);
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

function inferContainerKind(
  parsed: ParsedReference,
  referenceType: CanonicalReferenceType,
  venue: string,
): { kind: ExtractionContainerHints['containerKindHint']; confidence: number } {
  const lowerVenue = venue.toLowerCase();
  const locator = normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? '');
  const publisherOrInstitution = normalizeWhitespace(parsed.institution ?? parsed.publisher ?? '');
  const title = normalizeWhitespace(parsed.title ?? '');

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
    && !venue
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
    referenceType === 'book'
    && !venue
    && !parsed.volume
    && !parsed.issue
    && !locator
    && !parsed.bookTitle
    && !parsed.conferenceTitle
    && (parsed.edition || BOOK_TITLE_SIGNAL.test(title) || publisherOrInstitution)
  ) {
    return { kind: 'book', confidence: 0.92 };
  }

  if (
    publisherOrInstitution
    && !venue
    && !parsed.volume
    && !parsed.issue
    && !locator
    && !parsed.bookTitle
    && !parsed.conferenceTitle
    && (referenceType === 'report' || REPORT_PUBLISHER_SIGNAL.test(publisherOrInstitution) || REPORT_TITLE_SIGNAL.test(title))
  ) {
    return { kind: 'report', confidence: referenceType === 'report' ? 0.94 : 0.88 };
  }

  if (referenceType === 'report' && (parsed.institution || parsed.publisher)) {
    return { kind: 'report', confidence: 0.78 };
  }

  if (referenceType === 'website' && parsed.url && !venue) {
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

  if (next.publisher) {
    const cleanedPublisher = stripLeadingDecoration(next.publisher);
    if (cleanedPublisher) next.publisher = cleanedPublisher;
  } else if (hints.copyrightPublisherCandidate) {
    next.publisher = hints.copyrightPublisherCandidate;
  }

  if (next.journal && hints.venueContaminated) {
    next.journal = normalizeKnownContainerName(cleanVenueFragment(next.journal));
  }
  if (next.conferenceTitle && hints.venueContaminated) {
    next.conferenceTitle = normalizeKnownContainerName(cleanVenueFragment(next.conferenceTitle));
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
