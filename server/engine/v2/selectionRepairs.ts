import type { CanonicalReferenceType, ParsedReference } from '@shared/schema';
import { cleanConferenceTitleFragment } from './containerHints.js';
import { proceedingsSignal } from './qualityRules.js';
import { normalizeWhitespace } from './utils.js';

const CONFERENCE_TEXT_SIGNAL = /\b(?:conference|symposium|workshop|congress|meeting|proceedings|forum|summit|colloquium|poster abstracts?|electronic poster abstracts?)\b/i;
const CONFERENCE_DOI_SIGNAL = /^(?:10\.1145\/|10\.29327\/|10\.2991\/|10\.2495\/|10\.26678\/|10\.14201\/0aq|10\.51980\/|10\.3997\/2214-4609\.20|10\.1164\/ajrccm-conference\.|10\.1136\/[^/]+-snis\.|10\.52202\/|10\.46898\/home\.|10\.2749\/222137|10\.2316\/p\.|10\.5817\/cz\.muni\.p210-|10\.54941\/ahfe|10\.17491\/cgsi\/)/i;

function hasConferenceText(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return proceedingsSignal(normalized)
    || CONFERENCE_TEXT_SIGNAL.test(normalized)
    || /\b(?:ieee cat\.?\s*no\.?|lfnm|iccic|icassp|trustcom|crimean conference)\b/i.test(normalized);
}

function hasSerialStructure(parsed: ParsedReference): boolean {
  return Boolean(
    normalizeWhitespace(parsed.volume ?? '')
    || normalizeWhitespace(parsed.issue ?? '')
    || normalizeWhitespace(parsed.pages ?? parsed['article-number'] ?? ''),
  );
}

export function repairSelectedParsedReference(options: {
  parsed: ParsedReference;
  referenceType: CanonicalReferenceType;
}): {
  parsed: ParsedReference;
  referenceType: CanonicalReferenceType;
  reasons: string[];
} {
  const parsed: ParsedReference = { ...options.parsed };
  let referenceType = options.referenceType;
  const reasons: string[] = [];

  const doi = normalizeWhitespace(parsed.doi ?? '');
  const journal = normalizeWhitespace(parsed.journal ?? '');
  const bookTitle = normalizeWhitespace(parsed.bookTitle ?? '');
  const conferenceTitle = normalizeWhitespace(parsed.conferenceTitle ?? '');
  const serialStructure = hasSerialStructure(parsed);

  const candidateConferenceContainer = !conferenceTitle
    ? (hasConferenceText(journal) ? journal : hasConferenceText(bookTitle) ? bookTitle : '')
    : conferenceTitle;

  const strongConferenceEvidence = Boolean(candidateConferenceContainer)
    || (
      CONFERENCE_DOI_SIGNAL.test(doi)
      && referenceType !== 'journal'
      && !serialStructure
    );

  if (referenceType !== 'conference' && strongConferenceEvidence) {
    referenceType = 'conference';
    reasons.push('promoted_to_conference');
  }

  if (!conferenceTitle && candidateConferenceContainer) {
    parsed.conferenceTitle = cleanConferenceTitleFragment(candidateConferenceContainer) || candidateConferenceContainer;
    if (candidateConferenceContainer === journal) parsed.journal = undefined;
    if (candidateConferenceContainer === bookTitle) parsed.bookTitle = undefined;
    reasons.push('normalized_conference_container');
  }

  if (referenceType === 'conference' && hasConferenceText(journal)) {
    parsed.conferenceTitle = parsed.conferenceTitle
      ?? cleanConferenceTitleFragment(journal)
      ?? journal;
    parsed.journal = undefined;
    reasons.push('moved_journal_to_conference_title');
  }

  return {
    parsed,
    referenceType,
    reasons: Array.from(new Set(reasons)),
  };
}
