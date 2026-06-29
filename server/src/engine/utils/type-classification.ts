import type { ReferenceCarrier } from '../types/carrier.js';
import type { ReferenceType } from '../types/citation.js';
import { normalizePatent } from '../identifierUtils.js';
import { recoverArticleContainerSpill } from './articleContainer.js';
import { hasFieldValue } from './fields.js';
import { isPlaceholderContainerValue } from './placeholders.js';

const WEBPAGE_FALLBACK_PENALTY = 6;
export const CONFERENCE_CUE_REGEX = /\b(?:conference|symposium|simp[oó]sio|workshop|congress|congreso|meeting|proceedings|proc\.?|anais|prosiding|jornadas|seminar|seminario|abstracts publication|конференц\p{L}*|канферэнц\p{L}*)\b/iu;
const CONFERENCE_DOI_REGEX =
  /\b10\.(?:14209\/sbrt\.|21009\/03\.|14293\/s2199-ssp-|2991\/assehr\.|37702\/2175-957x\.cobenge\.|1049\/cp\.|29363\/nanoge\.[a-z0-9-]+\.\d{4}\.|1109\/[a-z][a-z0-9-]{2,}\d{4,}\.\d{4}\.)/iu;
const BOOK_CHAPTER_DOI_REGEX =
  /\b10\.\d{4,9}\/(?:97[89][-\d]+(?:[A-Za-z./-]*)?_\d+|1-4020-[\d-]+_\d+|bfb\d{7,})\b/iu;
const PREPRINT_CUE_REGEX = /\b(?:preprint|preprints|arxiv|biorxiv|medrxiv|ssrn|zenodo|figshare|research square|techrxiv)\b/iu;
const PUBLISHER_CUE_REGEX =
  /\b(?:press|publishing|publisher|editorial|books?|booksellers|editions?|editores?|media|springer|palgrave|cambridge|oxford|routledge|elsevier|wiley|dial[eé]tica|avestia|gru[yü]ter|verlag|birkh[aä]user|hanser|editora|crv|apress|peter\s+lang(?:\s+\p{L}+)?|thieme|sciendo)\b/iu;
const EXPLICIT_REPORT_DOI_REGEX = /\b10\.(?:31003\/|3133\/|46220\/|54932\/|55277\/researchhub\.)/iu;
const OSTI_DOI_REGEX = /\b10\.2172\//iu;
const SPARSE_PREPRINT_OWNER_REGEX =
  /\b(?:elsevier bv|research square platform llc|mdpi ag|jmir publications inc|arxiv|biorxiv|medrxiv|ieee|institute of electrical and electronics engineers(?: ieee)?)\b/u;
const PLACEHOLDER_DOI_TAIL_REGEX =
  /(?:https?:\/\/(?:dx\.)?doi\.org\/?\.?\s*$|\bdoi:\s*\.?\s*$)/iu;
const GENERIC_CONFERENCE_ALIAS_TOKENS = new Set([
  'ACP',
  'CP',
  'DOI',
  'PROC',
  'PROCEDIA',
  'VOL',
]);
const EVENTISH_CONFERENCE_TITLE_REGEX =
  /\b(?:[A-Z][a-z]+\d{1,4}|[A-Z]{2,}\d{1,4}|\d{1,3}(?:st|nd|rd|th))\b|-\s+[A-Z]/u;

function looksWebpageSiteOwnerBlend(
  value: string | null | undefined,
  siteName: string | null | undefined,
  institution: string | null | undefined,
): boolean {
  const normalizedValue = normalizeComparableText(value ?? '');
  if (!normalizedValue) {
    return false;
  }

  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/iu.test(value ?? '')) {
    return true;
  }

  const normalizedSiteName = normalizeComparableText(siteName ?? '');
  const normalizedInstitution = normalizeComparableText(institution ?? '');
  if (normalizedSiteName && normalizedValue === normalizedSiteName) {
    return true;
  }
  if (normalizedInstitution && normalizedValue === normalizedInstitution) {
    return true;
  }

  return (
    normalizedSiteName.length > 0
    && normalizedInstitution.length > 0
    && normalizedValue.includes(normalizedSiteName)
    && normalizedValue.includes(normalizedInstitution)
  );
}

export function classifyTypeHeuristically(
  carrier: Pick<ReferenceCarrier, 'fields' | 'raw'>,
): ReferenceType {
  const { fields } = carrier;
  const raw = normalizeTypeInput(carrier.raw);
  const rawJournalValue = fieldText(fields.journal) ?? '';
  const rawPublisherValue = fieldText(fields.publisher) ?? '';
  const rawVolumeValue = fieldText(fields.volume) ?? '';
  const rawIssueValue = fieldText(fields.issue) ?? '';
  const rawPagesPresent = hasFieldValue(fields.pages);
  const rawYearValue = hasFieldValue(fields.year) ? String(fields.year.value).trim() : '';
  const yearOnlyLocatorSpill =
    looksYearLikeValue(rawVolumeValue)
    && rawIssueValue.length === 0
    && !rawPagesPresent
    && (
      !rawYearValue
      || rawVolumeValue === rawYearValue
    );
  if (
    rawJournalValue
    && looksPublisherLikeValue(rawJournalValue)
    && yearOnlyLocatorSpill
  ) {
    return 'book';
  }
  if (
    rawPublisherValue
    && yearOnlyLocatorSpill
    && rawJournalValue.length === 0
    && hasFieldValue(fields.isbn)
  ) {
    return 'book';
  }
  const institutionValue = fieldText(fields.institution);
  const bookTitleValue = fieldText(fields.bookTitle);
  const bookTitleArticleSpill = recoverArticleContainerSpill(bookTitleValue);
  const publisherValue = fieldText(fields.publisher);
  const journalValue = fieldText(fields.journal);
  const siteNameValue = fieldText(fields.siteName);
  const titleValue = fieldText(fields.title);
  // A placeholder container ("Journal", "Journal, ?", "Journal, vol. ?, pp. 12-20")
  // is not a real venue — treat it as absent so it can't drive an article or
  // conference classification (it is cleared from the field downstream anyway).
  const conferenceTitleValue = isPlaceholderContainerValue(fieldText(fields.conferenceTitle))
    ? null
    : fieldText(fields.conferenceTitle);
  const conferenceTitleIsPlaceholder =
    hasFieldValue(fields.conferenceTitle) && conferenceTitleValue == null;
  const scores = new Map<ReferenceType, number>([
    ['article-journal', 0],
    ['book', 0],
    ['book-chapter', 0],
    ['thesis', 0],
    ['conference-paper', 0],
    ['webpage', 0],
    ['report', 0],
    ['patent', 0],
    ['dataset', 0],
    ['preprint', 0],
    ['unknown', 0],
  ]);

  const explicitUrl = fieldText(fields.url);
  const hasMeaningfulUrl =
    (explicitUrl != null && !isPlaceholderDoiUrl(explicitUrl))
    || hasMeaningfulRawUrl(raw);
  const hasDoi = hasFieldValue(fields.doi) || /\b10\.\d{4,9}\/[^\s"'<>]+/iu.test(raw);
  const hasIsbn = hasFieldValue(fields.isbn) || /\b(?:97[89][-\s]?\d(?:[-\s]?\d){9,11})\b/iu.test(raw) || /10\.\d{4,9}\/(?:97[89][-\d]{10,17})/iu.test(raw);
  const hasIssn = hasFieldValue(fields.issn) || /\b\d{4}-\d{3}[\dXx]\b/iu.test(raw);
  const patentFromRaw = normalizePatent(raw);
  const hasPatent =
    hasFieldValue(fields.patent)
    || patentFromRaw != null
    || /\bpatent(?:\s+application)?(?:\s+no\.?)?\b/iu.test(raw)
    || /https?:\/\/(?:www\.)?patents\.google\.com\/patent\//iu.test(raw);
  const conferenceLooksThesis = conferenceTitleValue != null && hasThesisCue(conferenceTitleValue);
  const hasThesis = hasFieldValue(fields.thesisType) || hasThesisCue(raw) || conferenceLooksThesis;
  const hasSiteName = hasFieldValue(fields.siteName);
  const hasRepository =
    hasFieldValue(fields.repository)
    || hasFieldValue(fields.arxiv)
    || PREPRINT_CUE_REGEX.test(raw);
  const hasPreprintDoi =
    (hasFieldValue(fields.doi) && /10\.(?:2139\/ssrn\.|20944\/preprints|21203\/rs\.|36227\/techrxiv\.)/iu.test(String(fields.doi.value)))
    || /10\.(?:2139\/ssrn\.|20944\/preprints|21203\/rs\.|36227\/techrxiv\.)/iu.test(raw);
  const hasExplicitReportDoi =
    (hasFieldValue(fields.doi) && EXPLICIT_REPORT_DOI_REGEX.test(String(fields.doi.value)))
    || EXPLICIT_REPORT_DOI_REGEX.test(raw);
  const hasOstiDoi =
    (hasFieldValue(fields.doi) && OSTI_DOI_REGEX.test(String(fields.doi.value)))
    || OSTI_DOI_REGEX.test(raw);
  const hasDatasetCue = /\b(?:dataset|data set|figshare|zenodo)\b/iu.test(raw);
  const volumeValue = fieldText(fields.volume);
  const issueValue = fieldText(fields.issue);
  const accessedDateValue = fieldText(fields.accessedDate);
  const suspiciousTitleEmbeddedPages =
    looksTitleEmbeddedYearRangePagesValue(
      fieldText(fields.pages),
      titleValue,
      volumeValue,
      issueValue,
      fieldText(fields.publisher),
      fieldText(fields.bookTitle),
      fieldText(fields.doi),
      hasIsbn,
    );
  const webpageIdentifierLocatorArtifact = looksWebpageIdentifierLocatorArtifact(
    fieldText(fields.pages),
    {
      hasMeaningfulUrl,
      siteName: siteNameValue,
      institution: institutionValue,
      pmid: fieldText(fields.pmid),
    },
  );
  const hasLocators =
    hasFieldValue(fields.volume)
    || hasFieldValue(fields.issue)
    || (
      hasFieldValue(fields.pages)
      && !suspiciousTitleEmbeddedPages
      && !webpageIdentifierLocatorArtifact
      && !looksWebpageAccessedYearLocatorArtifact(
        fieldText(fields.pages),
        accessedDateValue,
        hasMeaningfulUrl,
        siteNameValue,
      )
    )
    || /\b(?:vol|volume)\.?\s*\d+\b/iu.test(raw)
    || /\bno\.?\s*\d+\b/iu.test(raw)
    || /\bpp?\.?\s*[A-Za-z]?\d/u.test(raw)
    || /;\s*\d+\s*\(\d+\)\s*[:;,]\s*[A-Za-z]?\d+/u.test(raw);
  const suspiciousPublisherLocator =
    (
      (journalValue != null && looksPublisherLikeValue(journalValue))
      || (journalValue == null && publisherValue != null && hasIsbn)
    )
    && looksYearLikeValue(volumeValue)
    && issueValue == null
    && !hasFieldValue(fields.pages);
  const hasMisleadingBookContainer =
    bookTitleValue != null
    && !hasFieldValue(fields.pages)
    && !/\bIn\s+/iu.test(raw)
    && (Boolean(institutionValue) || hasReportCue(raw))
    && looksContinuationFragment(bookTitleValue);
  const hasConference =
    (hasFieldValue(fields.conferenceTitle) && !conferenceLooksThesis && !conferenceTitleIsPlaceholder)
    || CONFERENCE_DOI_REGEX.test(raw)
    || CONFERENCE_CUE_REGEX.test(raw);
  const namedConferenceContainer =
    conferenceTitleValue != null
    && !conferenceLooksThesis
    && normalizeComparableText(conferenceTitleValue) !== normalizeComparableText(titleValue ?? '')
    && !looksInstitutionLikeValue(conferenceTitleValue)
    && !hasReportCue(conferenceTitleValue)
    && !looksJournalLikeContainerValue(conferenceTitleValue)
    && EVENTISH_CONFERENCE_TITLE_REGEX.test(conferenceTitleValue);
  const hasPresentationCue = /\bpaper presented at\b/iu.test(raw);
  const titleEmbedsConferenceTitle =
    titleValue != null
    && conferenceTitleValue != null
    && normalizeComparableText(conferenceTitleValue).length >= 12
    && normalizeComparableText(titleValue).includes(normalizeComparableText(conferenceTitleValue));
  const strongConferenceContainer =
    conferenceTitleValue != null
    && !conferenceLooksThesis
    && normalizeComparableText(conferenceTitleValue) !== normalizeComparableText(titleValue ?? '')
    && (
      CONFERENCE_CUE_REGEX.test(conferenceTitleValue)
      || namedConferenceContainer
    );
  const journalGroundedInRaw =
    journalValue != null
    && rawContainsContainer(raw, journalValue);
  const hasWebDocumentCadence =
    hasMeaningfulUrl
    && !hasDoi
    && !hasLocators
    && (
      hasSiteName
      || bookTitleValue != null
      || /["“][^"”]{4,220}["”]/u.test(raw)
      || /\(\d{4}\)/u.test(raw)
      || /,\s*(?:19|20)\d{2}(?:[.,]|$)/u.test(raw)
    );
  const hasBookChapterDoi =
    (hasFieldValue(fields.doi) && BOOK_CHAPTER_DOI_REGEX.test(String(fields.doi.value)))
    || BOOK_CHAPTER_DOI_REGEX.test(raw);
  const hasBookContainer =
    (
      hasFieldValue(fields.bookTitle)
      && !hasMisleadingBookContainer
      && !hasWebDocumentCadence
      && !bookTitleArticleSpill
    )
    || hasBookContainerCue(raw);
  const hasStrongBookChapterProfile =
    hasBookChapterDoi
    && (
      hasBookContainer
      || hasFieldValue(fields.publisher)
      || hasFieldValue(fields.isbn)
      || /\bIn\s+/iu.test(raw)
    );
  const hasPublisher =
    hasFieldValue(fields.publisher)
    || PUBLISHER_CUE_REGEX.test(raw);
  const hasStrongBookTitle =
    bookTitleValue != null
    && !hasMisleadingBookContainer
    && !hasWebDocumentCadence
    && !looksConferenceVenueAlias(bookTitleValue)
    && !looksInstitutionLikeValue(bookTitleValue);
  const bookTitleLooksConferenceAlias =
    bookTitleValue != null
    && looksConferenceVenueAlias(bookTitleValue);
  const journalLooksPublisherAlias =
    journalValue != null
    && !hasLocators
    && !looksConferenceVenueAlias(journalValue)
    && !looksReportPublisherAcronym(journalValue);
  const publisherLooksInstitutional =
    publisherValue != null
    && looksInstitutionLikeValue(publisherValue)
    && !looksPublisherLikeValue(publisherValue);
  const ostiLikeOwner =
    /\b(?:office of scientific and technical information|osti|us doe)\b/iu.test(
      [institutionValue, publisherValue, journalValue, raw].filter(Boolean).join(' '),
    );
  const hasOstiReportProfile =
    hasOstiDoi
    && ostiLikeOwner
    && !/\bpaper presented at\b/iu.test(raw)
    && !CONFERENCE_CUE_REGEX.test(raw)
    && !looksProceedingsSeriesContainer(raw);
  const publisherLooksStandaloneInstitutionalAlias =
    publisherValue != null
    && looksStandaloneInstitutionalAlias(publisherValue)
    && !hasConference
    && !CONFERENCE_DOI_REGEX.test(raw);
  const rawInstitutionCue =
    /\b(?:survey|department|ministry|agency|commission|bureau|administration|university|institute|laboratory|office|standards|association|society|group|editor|task force|contributors)\b/iu.test(raw);
  const hasReport =
    hasFieldValue(fields.reportNumber)
    || hasReportCue(raw);
  const hasJournal = hasFieldValue(fields.journal);
  const conferenceJournalEcho =
    conferenceTitleValue != null
    && !conferenceLooksThesis
    && journalValue != null
    && normalizeComparableText(conferenceTitleValue ?? '') === normalizeComparableText(journalValue);
  const mirroredConferenceVenue =
    conferenceJournalEcho
    && !hasLocators
    && !hasIssn
    && conferenceTitleValue != null
    && !looksPublisherLikeValue(conferenceTitleValue)
    && !looksInstitutionLikeValue(conferenceTitleValue);
  const repeatedInstitutionOwner = institutionValue != null && rawRepeatsPhrase(raw, institutionValue);
  const websiteLikeSource = (hasSiteName || bookTitleValue != null) && hasWebDocumentCadence;
  const conferenceTitleLooksWebSpill =
    conferenceTitleValue != null
    && (
      /\b(?:online|available)\b/iu.test(conferenceTitleValue)
      || (
        siteNameValue != null
        && normalizeComparableText(conferenceTitleValue) === normalizeComparableText(siteNameValue)
      )
    );
  const strongArticleProfile =
    (hasJournal || bookTitleArticleSpill != null)
    && hasLocators
    && (
      hasIssn
      || journalGroundedInRaw
      || Boolean(bookTitleArticleSpill?.issnHint)
      || Boolean(bookTitleArticleSpill?.journal && rawContainsContainer(raw, bookTitleArticleSpill.journal))
    );
  const conferenceTitleLooksJournalish =
    conferenceTitleValue != null
    && (
      /\b(?:journal|revista|review|annals?|letters?|transactions?|news|studies)\b/iu.test(conferenceTitleValue)
      || looksYearLikeValue(volumeValue)
      || hasIssn
    );
  const articleLikeConferenceContainer =
    conferenceTitleValue != null
    && !conferenceLooksThesis
    && conferenceTitleLooksJournalish
    && hasLocators
    && !CONFERENCE_CUE_REGEX.test(conferenceTitleValue)
    && !looksProceedingsSeriesContainer(conferenceTitleValue)
    && !looksConferenceVenueAlias(conferenceTitleValue)
    && (
      hasIssn
      || rawContainsContainer(raw, conferenceTitleValue)
    );
  const articleLikeBookContainer =
    bookTitleArticleSpill != null
    && !hasConference
    && !hasPresentationCue
    && !CONFERENCE_DOI_REGEX.test(raw)
    && !hasBookChapterDoi
    && !hasIsbn
    && !hasExplicitReportDoi
    && !hasOstiReportProfile
    && !hasReport
    && !hasRepository
    && !hasPreprintDoi
    && !websiteLikeSource
    && (hasLocators || hasDoi || Boolean(bookTitleArticleSpill.issnHint));
  const conferenceTitleLooksPreprintish =
    conferenceTitleValue != null
    && PREPRINT_CUE_REGEX.test(conferenceTitleValue);
  const conferenceTitleLooksReportish =
    conferenceTitleValue != null
    && (
      hasReportCue(conferenceTitleValue)
      || looksInstitutionLikeValue(conferenceTitleValue)
      || looksReportPublisherAcronym(conferenceTitleValue)
    );
  const hasSparsePreprintOwnerProfile =
    !hasRepository
    && !hasPreprintDoi
    && !hasMeaningfulUrl
    && !hasFieldValue(fields.isbn)
    && !hasFieldValue(fields.bookTitle)
    && !hasFieldValue(fields.journal)
    && !hasFieldValue(fields.conferenceTitle)
    && !hasLocators
    && !hasConference
    && isKnownPreprintRepositoryOwner(publisherValue)
    && hasPlaceholderDoiTail(raw);
  const hasInstitution =
    hasFieldValue(fields.institution)
    || (rawInstitutionCue && !hasWebDocumentCadence);
  const webpageLikeJournalEcho =
    journalValue != null
    && hasMeaningfulUrl
    && !hasDoi
    && !hasLocators
    && looksWebpageSiteOwnerBlend(journalValue, siteNameValue, institutionValue);
  const publisherLooksBookish = publisherValue != null && PUBLISHER_CUE_REGEX.test(publisherValue);
  const publisherLooksReportish = publisherValue != null && looksReportPublisherAcronym(publisherValue);
  const conferencePublisherAlias =
    publisherValue != null
    && looksConferenceVenueAlias(publisherValue);
  const journalLooksInstitutional =
    journalValue != null
    && (
      looksInstitutionLikeValue(journalValue)
      || looksReportPublisherAcronym(journalValue)
    )
    && !looksPublisherLikeValue(journalValue);
  const journalMirrorsInstitution =
    journalValue != null
    && institutionValue != null
    && normalizeComparableText(journalValue) === normalizeComparableText(institutionValue);
  const journalMirrorsPublisher =
    journalValue != null
    && publisherValue != null
    && normalizeComparableText(journalValue) === normalizeComparableText(publisherValue);
  const journalLooksReportOwner =
    journalValue != null
    && !looksPublisherLikeValue(journalValue)
    && !looksConferenceVenueAlias(journalValue)
    && !/\b(?:journal|revista|review|annals?|letters?|transactions?)\b/iu.test(journalValue)
    && (
      (journalLooksInstitutional && (journalMirrorsInstitution || journalMirrorsPublisher || repeatedInstitutionOwner))
      || (journalMirrorsInstitution && repeatedInstitutionOwner)
      || (journalMirrorsPublisher && repeatedInstitutionOwner)
    );
  const strongArticleReportOverride =
    strongArticleProfile
    && !hasConference
    && !hasBookContainer
    && !hasPresentationCue
    && !hasWebDocumentCadence
    && !hasExplicitReportDoi
    && !hasOstiReportProfile
    && !hasFieldValue(fields.reportNumber)
    && !publisherLooksInstitutional
    && !publisherLooksStandaloneInstitutionalAlias
    && !journalLooksReportOwner;
  const journalContainsPublisherTail =
    journalValue != null
    && publisherValue != null
    && normalizeComparableText(journalValue).includes(normalizeComparableText(publisherValue))
    && !hasConference
    && !hasLocators;
  const bareConferencePublisher =
    publisherValue != null
    && hasDoi
    && !hasLocators
    && !hasIsbn
    && !looksPublisherLikeValue(publisherValue)
    && !looksInstitutionLikeValue(publisherValue);
  const repeatedPublisherOwner =
    publisherValue != null
    && rawRepeatsPhrase(raw, publisherValue);
  const repeatedInstitutionalOwner =
    repeatedInstitutionOwner
    || repeatedPublisherOwner
    || (
      institutionValue != null
      && publisherValue != null
      && normalizeComparableText(institutionValue) === normalizeComparableText(publisherValue)
    );
  const institutionalAnnualReportBook =
    hasIsbn
    && !hasLocators
    && !hasConference
    && !hasPresentationCue
    && !hasPreprintDoi
    && !hasPatent
    && !hasExplicitReportDoi
    && !hasOstiReportProfile
    && !hasFieldValue(fields.reportNumber)
    && (
      /\bannual report\b/iu.test(titleValue ?? '')
      || /\bannual report\b/iu.test(raw)
    )
    && (
      journalValue != null
      || publisherValue != null
      || institutionValue != null
      || repeatedInstitutionalOwner
    );

  if (suspiciousPublisherLocator && !hasConference) {
    return looksPublisherLikeValue(journalValue ?? '') ? 'book' : 'report';
  }

  if (
    (hasPreprintDoi || hasRepository || hasSparsePreprintOwnerProfile)
    && !hasPresentationCue
    && !CONFERENCE_DOI_REGEX.test(raw)
    && !hasBookContainer
    && !hasPatent
  ) {
    return 'preprint';
  }

  if (hasThesis && !hasConference && !hasWebDocumentCadence) {
    return 'thesis';
  }

  if (strongArticleReportOverride) {
    return 'article-journal';
  }

  if (articleLikeBookContainer) {
    return 'article-journal';
  }

  if (
    articleLikeConferenceContainer
    && !hasPresentationCue
    && !CONFERENCE_DOI_REGEX.test(raw)
    && !hasBookContainer
    && !hasExplicitReportDoi
    && !hasOstiReportProfile
    && !conferenceTitleLooksPreprintish
  ) {
    return 'article-journal';
  }

  if (institutionalAnnualReportBook) {
    return 'book';
  }

  if (webpageLikeJournalEcho) {
    return 'webpage';
  }

  if (
    strongArticleProfile
    && !hasPresentationCue
    && !CONFERENCE_DOI_REGEX.test(raw)
    && (
      titleEmbedsConferenceTitle
      || conferenceJournalEcho
      || conferenceTitleLooksJournalish
    )
  ) {
    return 'article-journal';
  }

  if (
    namedConferenceContainer
    && !hasLocators
    && !hasBookContainer
    && !hasExplicitReportDoi
    && !hasOstiReportProfile
    && !conferenceTitleLooksReportish
    && !conferenceTitleLooksPreprintish
    && !hasWebDocumentCadence
  ) {
    return 'conference-paper';
  }

  if (
    (hasExplicitReportDoi || hasReport || (repeatedInstitutionalOwner && (publisherLooksInstitutional || journalLooksReportOwner)))
    && !hasPresentationCue
    && !CONFERENCE_DOI_REGEX.test(raw)
    && !looksProceedingsSeriesContainer(raw)
    && !hasWebDocumentCadence
    && (
      !conferenceTitleValue
      || titleEmbedsConferenceTitle
      || conferenceTitleLooksReportish
      || conferenceTitleLooksPreprintish
    )
  ) {
    return 'report';
  }

  if (
    hasSiteName
    && hasMeaningfulUrl
    && !hasDoi
    && !hasLocators
    && !hasPresentationCue
    && !CONFERENCE_DOI_REGEX.test(raw)
    && (
      !conferenceTitleValue
      || conferenceTitleLooksWebSpill
    )
  ) {
    return 'webpage';
  }

  if (journalLooksReportOwner && !hasConference && !hasLocators && hasDoi && !hasIsbn) {
    return 'report';
  }

  if (hasStrongBookChapterProfile && !hasThesis) {
    return 'book-chapter';
  }

  if (hasPatent) {
    addScore(scores, 'patent', patentFromRaw ? 18 : 12);
    addScore(scores, 'unknown', -4);
    addScore(scores, 'webpage', -8);
    addScore(scores, 'report', -5);
    addScore(scores, 'book', -5);
  }
  if (hasThesis) {
    addScore(scores, 'thesis', 16);
    addScore(scores, 'conference-paper', -12);
    addScore(scores, 'book', -6);
    addScore(scores, 'report', -3);
    addScore(scores, 'webpage', -5);
  }
  if (hasRepository) addScore(scores, 'preprint', 10);
  if (hasSparsePreprintOwnerProfile) {
    addScore(scores, 'preprint', 11);
    addScore(scores, 'book', -8);
    addScore(scores, 'report', -4);
  }
  if (hasPreprintDoi) {
    addScore(scores, 'preprint', 12);
    addScore(scores, 'article-journal', -3);
    addScore(scores, 'conference-paper', -8);
    addScore(scores, 'book', -6);
    addScore(scores, 'report', -5);
  }
  if (hasDatasetCue && !hasJournal && !hasConference) addScore(scores, 'dataset', 9);
  if (hasIsbn && journalLooksPublisherAlias && !hasConference) {
    addScore(scores, 'book', 12);
    addScore(scores, 'article-journal', -10);
  }
  if (hasIsbn && !hasJournal && !hasConference) addScore(scores, hasBookContainer ? 'book-chapter' : 'book', 7);
  if (hasIssn && !hasConference && !hasBookContainer) addScore(scores, 'article-journal', 6);

  if (hasBookContainer) {
    addScore(scores, hasConference ? 'conference-paper' : 'book-chapter', 9);
  }

  if (hasStrongBookTitle && hasPublisher && !hasConference) {
    addScore(scores, 'book-chapter', 13);
    addScore(scores, 'article-journal', -10);
  }

  if (journalContainsPublisherTail && (hasPublisher || hasIsbn) && !hasConference) {
    addScore(scores, hasBookContainer || hasFieldValue(fields.pages) ? 'book-chapter' : 'book', 12);
    addScore(scores, 'article-journal', -10);
  }

  if (hasConference || namedConferenceContainer) {
    addScore(scores, 'conference-paper', hasBookContainer ? 3 : 8);
  }
  if (hasConference && conferencePublisherAlias) {
    addScore(scores, 'conference-paper', 7);
    addScore(scores, 'article-journal', -6);
  }

  if (hasPresentationCue) {
    addScore(scores, 'conference-paper', 14);
    addScore(scores, 'article-journal', -12);
    addScore(scores, 'report', -6);
  }

  if (mirroredConferenceVenue) {
    addScore(scores, 'conference-paper', 11);
    addScore(scores, 'article-journal', -10);
  }

  if (bookTitleLooksConferenceAlias && (hasLocators || hasDoi)) {
    addScore(scores, 'conference-paper', 11);
    addScore(scores, 'book-chapter', -7);
  }

  if (strongConferenceContainer) {
    addScore(scores, 'conference-paper', journalGroundedInRaw ? 5 : 10);
    if (!journalGroundedInRaw) {
      addScore(scores, 'article-journal', -8);
    }
  }

  if (hasBookChapterDoi) {
    addScore(scores, 'book-chapter', 14);
    addScore(scores, 'conference-paper', -6);
    addScore(scores, 'article-journal', -4);
  }

  if (hasBookChapterDoi && hasPublisher && !hasConference) {
    addScore(scores, 'book-chapter', 6);
    addScore(scores, 'article-journal', -4);
  }

  if (suspiciousPublisherLocator && !hasConference) {
    addScore(scores, hasIsbn || publisherLooksBookish ? 'book' : 'report', 12);
    addScore(scores, 'article-journal', -14);
  }

  if (bareConferencePublisher) {
    addScore(scores, 'conference-paper', 7);
    addScore(scores, 'book', -3);
  }

  if (journalLooksReportOwner && !hasConference && !hasLocators) {
    addScore(scores, 'report', 14);
    addScore(scores, 'article-journal', -14);
    addScore(scores, 'book', -5);
    addScore(scores, 'webpage', -4);
  }

  if (
    !suspiciousPublisherLocator
    && (
      (hasJournal && !journalLooksReportOwner && (!strongConferenceContainer || journalGroundedInRaw))
    || (hasDoi && hasLocators && !hasBookContainer && !hasConference)
    )
  ) {
    addScore(scores, 'article-journal', 10);
  } else if (hasLocators && !hasConference && !hasBookContainer && !suspiciousPublisherLocator) {
    addScore(scores, 'article-journal', 7);
  }

  if (hasPublisher && !hasLocators && !hasConference && !hasBookContainer) {
    if ((publisherLooksReportish || publisherLooksInstitutional || publisherLooksStandaloneInstitutionalAlias) && hasDoi && !hasIsbn) {
      addScore(scores, 'report', publisherLooksReportish ? 8 : publisherLooksInstitutional ? 11 : 9);
      addScore(scores, 'book', -6);
    } else {
      addScore(scores, 'book', 7);
    }
  }

  if (hasPublisher && hasIsbn && !hasConference && !hasLocators) {
    addScore(scores, 'book', 10);
    addScore(scores, 'article-journal', -8);
  }

  if ((hasInstitution || hasReport || publisherLooksReportish || publisherLooksInstitutional || publisherLooksStandaloneInstitutionalAlias || journalLooksReportOwner) && !hasConference && (!hasJournal || journalLooksReportOwner)) {
    addScore(scores, 'report', hasReport ? 8 : publisherLooksInstitutional ? 10 : publisherLooksStandaloneInstitutionalAlias ? 8 : 6);
    if (publisherLooksInstitutional || publisherLooksStandaloneInstitutionalAlias) {
      addScore(scores, 'book', -5);
    }
    if (repeatedInstitutionOwner || hasMisleadingBookContainer || publisherLooksInstitutional || publisherLooksStandaloneInstitutionalAlias || journalLooksReportOwner) {
      addScore(scores, 'report', 5);
    }
  }
  if ((hasExplicitReportDoi || hasOstiReportProfile) && !hasConference && !hasLocators) {
    addScore(scores, 'report', hasExplicitReportDoi ? 14 : 12);
    addScore(scores, 'article-journal', -12);
    addScore(scores, 'conference-paper', -8);
    addScore(scores, 'webpage', -4);
  }

  if (websiteLikeSource && !hasConference) {
    addScore(scores, 'webpage', 12);
    addScore(scores, 'book-chapter', -6);
    addScore(scores, 'book', publisherLooksBookish ? -2 : -5);
    addScore(scores, 'report', -2);
  }

  if (hasWebDocumentCadence && !hasConference) {
    addScore(scores, 'webpage', 16);
    addScore(scores, 'report', -8);
    addScore(scores, 'book', -6);
    addScore(scores, 'book-chapter', -8);
    addScore(scores, 'conference-paper', -6);
  }

  if (hasSiteName && hasMeaningfulUrl && !hasConference && !hasBookContainer && !hasLocators) {
    addScore(scores, 'webpage', 11);
    addScore(scores, 'book', -4);
    addScore(scores, 'report', -3);
  }

  if (hasMeaningfulUrl && !hasDoi && !hasLocators && !hasConference && !hasBookContainer && !hasPublisher && !hasInstitution && !hasThesis) {
    addScore(scores, 'webpage', 7);
  } else if (hasMeaningfulUrl) {
    addScore(scores, 'webpage', -WEBPAGE_FALLBACK_PENALTY);
  }

  if (hasSiteName && !hasLocators && !hasConference) {
    addScore(scores, 'webpage', hasPublisher ? 5 : 7);
  }

  const ranked = [...scores.entries()]
    .filter(([type]) => type !== 'unknown')
    .sort((left, right) => right[1] - left[1]);
  const [bestType, bestScore] = ranked[0] ?? ['unknown', 0];

  return bestScore > 0 ? bestType : 'unknown';
}

export function fallbackTypeConfidence(type: ReferenceType): number {
  switch (type) {
    case 'article-journal':
      return 0.84;
    case 'conference-paper':
    case 'book-chapter':
    case 'book':
    case 'thesis':
    case 'report':
    case 'preprint':
      return 0.79;
    case 'patent':
    case 'webpage':
      return 0.75;
    case 'dataset':
      return 0.7;
    default:
      return 0.4;
  }
}

function addScore(scores: Map<ReferenceType, number>, type: ReferenceType, value: number): void {
  scores.set(type, (scores.get(type) ?? 0) + value);
}

function normalizeTypeInput(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/&amp;/giu, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldText(field: ReferenceCarrier['fields'][keyof ReferenceCarrier['fields']]): string | null {
  if (!field || field.value == null) return null;
  if (typeof field.value !== 'string') return null;
  const normalized = field.value.trim();
  return normalized === '' ? null : normalized;
}

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCueText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .normalize('NFKC')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function hasThesisCue(value: string | null | undefined): boolean {
  return /\b(?:doctoral dissertation|phd thesis|master'?s thesis|dissertation|thesis)\b/u.test(
    normalizeCueText(value),
  );
}

function hasReportCue(value: string | null | undefined): boolean {
  return /\b(?:report|standard|bulletin|technical report|white paper|working paper|guideline|specification|recommendation|geophysical abstracts)\b/u.test(
    normalizeCueText(value),
  );
}

function isKnownPreprintRepositoryOwner(value: string | null | undefined): boolean {
  return SPARSE_PREPRINT_OWNER_REGEX.test(normalizeCueText(value));
}

function hasPlaceholderDoiTail(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return PLACEHOLDER_DOI_TAIL_REGEX.test(value.trim());
}

function rawRepeatsPhrase(raw: string, phrase: string): boolean {
  const normalizedRaw = normalizeComparableText(raw);
  const normalizedPhrase = normalizeComparableText(phrase);
  if (!normalizedPhrase) return false;
  const firstIndex = normalizedRaw.indexOf(normalizedPhrase);
  if (firstIndex < 0) return false;
  return normalizedRaw.indexOf(normalizedPhrase, firstIndex + normalizedPhrase.length) >= 0;
}

function rawContainsContainer(raw: string, phrase: string): boolean {
  const normalizedRaw = normalizeComparableText(raw);
  const normalizedPhrase = normalizeComparableText(phrase);
  if (!normalizedPhrase || normalizedPhrase.length < 6) return false;
  return normalizedRaw.includes(normalizedPhrase);
}

function hasBookContainerCue(raw: string): boolean {
  return (
    /\bIn:\s+[\p{L}\d]/iu.test(raw)
    || /\.\s+In\s+.+?\(\s*pp?\.\s*[A-Za-z]?\d/iu.test(raw)
    || /\.\s+In\s+.+?\b(?:edited by|editor(?:s)?|ed\.|eds\.)\b/iu.test(raw)
    || /["“].+["”][,.]?\s+In:\s+.+/iu.test(raw)
  );
}

function looksContinuationFragment(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/[:;,.()[\]]/u.test(normalized)) return false;
  return normalized.split(/\s+/u).length <= 3;
}

function looksPublisherLikeValue(value: string): boolean {
  return PUBLISHER_CUE_REGEX.test(value);
}

function looksYearLikeValue(value: string | null): boolean {
  return value != null && /^(?:1[6-9]|20)\d{2}$/u.test(value);
}

function looksWebpageAccessedYearLocatorArtifact(
  pages: string | null,
  accessedDate: string | null,
  hasMeaningfulUrl: boolean,
  siteName: string | null,
): boolean {
  if (!looksYearLikeValue(pages) || !accessedDate || !hasMeaningfulUrl || !siteName) {
    return false;
  }

  const accessedYear = accessedDate.match(/(?:1[6-9]|20)\d{2}/u)?.[0] ?? null;
  return accessedYear != null && pages === accessedYear;
}

function looksWebpageIdentifierLocatorArtifact(
  pages: string | null,
  options: {
    hasMeaningfulUrl: boolean;
    siteName: string | null;
    institution: string | null;
    pmid: string | null;
  },
): boolean {
  if (!pages || !options.hasMeaningfulUrl) {
    return false;
  }

  const normalizedPages = normalizeComparableText(pages);
  if (normalizedPages === '99999999') {
    return true;
  }
  if (
    !normalizedPages
    || (
      normalizeComparableText(options.siteName ?? '').length === 0
      && normalizeComparableText(options.institution ?? '').length === 0
    )
  ) {
    return false;
  }

  return [options.pmid]
    .map((candidate) => normalizeComparableText(candidate ?? ''))
    .some((candidate) => candidate.length > 0 && candidate === normalizedPages);
}

function looksTitleEmbeddedYearRangePagesValue(
  pages: string | null,
  title: string | null,
  volume: string | null,
  issue: string | null,
  publisher: string | null,
  bookTitle: string | null,
  doi: string | null,
  hasIsbn: boolean,
): boolean {
  if (!pages || !title) return false;
  if (volume != null && volume.trim().length > 0) return false;
  if (issue != null && issue.trim().length > 0) return false;

  const normalizedPages = pages.replace(/\s+/gu, '');
  if (!/^(?:1[4-9]|20)\d{2}[–-](?:1[4-9]|20)\d{2}$/u.test(normalizedPages)) {
    return false;
  }

  if (!normalizeComparableText(title).includes(normalizeComparableText(normalizedPages))) {
    return false;
  }

  const hasBookishSignal =
    hasIsbn
    || (publisher != null && looksPublisherLikeValue(publisher))
    || (bookTitle != null && bookTitle.trim().length > 0)
    || (doi != null && (/10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi) || BOOK_CHAPTER_DOI_REGEX.test(doi)));

  return hasBookishSignal;
}

function looksInstitutionLikeValue(value: string): boolean {
  return /\b(?:survey|department|ministry|agency|commission|bureau|administration|university|institute|laboratory|office|standards|association|society|group|editor|task force|contributors)\b/iu.test(value);
}

function looksReportPublisherAcronym(value: string): boolean {
  return looksInstitutionalAcronymPhrase(value);
}

function looksConferenceVenueAlias(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || /^n\/?a$/iu.test(normalized)) return false;
  if (CONFERENCE_CUE_REGEX.test(normalized)) return true;
  if (looksProceedingsSeriesContainer(normalized)) return true;
  if (looksPublisherLikeValue(normalized)) return false;
  if (looksInstitutionLikeValue(normalized)) return false;
  if (looksInstitutionalAcronymPhrase(normalized)) return false;
  if (/\b(?:journal|revista|review|annals?|letters?|transactions?)\b/iu.test(normalized)) return false;

  const compact = normalized.replace(/\s+/gu, '');
  if (/^[A-Z][A-Z0-9&./-]{1,18}$/u.test(compact)) return true;

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  if (
    tokens.length >= 2
    && tokens.length <= 4
    && tokens.every((token) => /^[A-Z0-9&./-]{1,4}$/u.test(token))
  ) {
    return false;
  }
  return tokens.length >= 1 && tokens.length <= 6 && tokens.every((token) => /^[\p{Lu}\d&./'-]+$/u.test(token));
}

function looksJournalLikeContainerValue(value: string): boolean {
  const normalized = value
    .replace(/[.,;:()[\]]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return false;
  if (/\b(?:journal|jurnal|revista|review|quarterly|annals?|letters?|bulletin|magazine|transactions?|cultures|studies)\b/iu.test(normalized)) {
    return true;
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const hasLowercaseConnector = tokens.some((token) => /^(?:van|von|der|den|de|del|da|do|dos|du|und|and|the|of)$/iu.test(token));
  if (hasLowercaseConnector) {
    return false;
  }

  return (
    tokens.length >= 4
    && tokens.every((token) => /^[A-Za-z&]{1,8}$/u.test(token))
    && tokens.filter((token) => token.length <= 4).length >= Math.ceil(tokens.length / 2)
  );
}

function looksInstitutionalAcronymPhrase(value: string): boolean {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  return (
    tokens.length >= 2
    && tokens.length <= 4
    && tokens.every((token) => /^[A-Z]{2,6}$/u.test(token))
  );
}

function looksStandaloneInstitutionalAlias(value: string): boolean {
  const normalized = value.trim();
  return (
    /^[A-Z][A-Z0-9&./-]{4,12}$/u.test(normalized)
    && !GENERIC_CONFERENCE_ALIAS_TOKENS.has(normalized)
  );
}

function looksProceedingsSeriesContainer(value: string): boolean {
  return (
    /^advances in [\p{L}\d,&:/'’(). -]{6,} research$/iu.test(value)
    || /\b(?:aip conference proceedings|ceur workshop proceedings|acm international conference proceeding series|journal of physics: conference series|e3s web of conferences)\b/iu.test(value)
  );
}

function isPlaceholderDoiUrl(value: string): boolean {
  return /^https?:\/\/(?:dx\.)?doi\.org\/?\.?$/iu.test(value.trim());
}

function hasMeaningfulRawUrl(raw: string): boolean {
  const urlMatches = raw.match(/\bhttps?:\/\/[^\s)]+/giu) ?? [];
  return urlMatches.some((match) => {
    const normalized = normalizeRawUrlCandidate(match);
    return normalized.length > 0 && !isPlaceholderDoiUrl(normalized);
  });
}

function normalizeRawUrlCandidate(value: string): string {
  return value.trim().replace(/[.,;:]+$/u, '').replace(/\)+$/u, '');
}
