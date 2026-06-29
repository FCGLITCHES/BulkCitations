import { classifyTypeHeuristically, fallbackTypeConfidence } from '../utils/type-classification.js';
import { lookupAuthorityDoiHints } from '../data/authorityPack.js';
import { recoverArticleContainerSpill } from '../utils/articleContainer.js';
import type {
  CandidateEnvelopeEntry,
  ReferenceCarrier,
  StructuralFamilyRoutingResult,
} from '../types/carrier.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import type { ExtractedFields, ReferenceType } from '../types/citation.js';
import { hasFieldValue } from '../utils/fields.js';

const CONTRACT_VERSION = 1;
const STAGE_ID = 'phase5_8_structural_family_router';

const CONFERENCE_CUE_REGEX =
  /\b(?:conference|symposium|simp[oó]sio|workshop|congress|congreso|congresso|meeting|proceedings|proc\.?|anais|prosiding|jornadas|seminar|seminario|forum|abstracts publication|канферэнц\p{L}*|конференц\p{L}*)\b/iu;
const ARTICLE_CONTAINER_REGEX =
  /\b(?:journal|revista|review|annals?|letters?|transactions?|quarterly|bulletin|studies|archive|archives)\b/iu;
const PREPRINT_CUE_REGEX = /\b(?:preprint|preprints|arxiv|biorxiv|medrxiv|ssrn|techrxiv|research square)\b/iu;
const SPARSE_PREPRINT_OWNER_REGEX =
  /\b(?:elsevier bv|research square platform llc|mdpi ag|jmir publications inc|arxiv|biorxiv|medrxiv|ieee|institute of electrical and electronics engineers(?: ieee)?)\b/u;
const PLACEHOLDER_DOI_TAIL_REGEX =
  /(?:https?:\/\/(?:dx\.)?doi\.org\/?\.?\s*$|\bdoi:\s*\.?\s*$)/iu;
const BOOK_CHAPTER_CUE_REGEX = /\b(?:\bin:?\s+|edited by|editor(?:s)?|ed\.|eds\.)\b/iu;
const INSTITUTION_CUE_REGEX =
  /\b(?:department|ministry|agency|commission|bureau|administration|university|institute|laboratory|office|standards|association|society|survey|task force|council)\b/iu;
const BOOKISH_PUBLISHER_REGEX =
  /\b(?:press|publishing|publisher|editorial|books?|editions?|media|springer|palgrave|cambridge|oxford|routledge|elsevier|wiley|dial[eé]tica|avestia|gru[yü]ter|verlag|birkh[aä]user|hanser|editora|crv|peter\s+lang(?:\s+\p{L}+)?|thieme|sciendo)\b/iu;
const EVENTISH_CONFERENCE_TITLE_REGEX =
  /\b(?:[A-Z][a-z]+\d{1,4}|[A-Z]{2,}\d{1,4}|\d{1,3}(?:st|nd|rd|th))\b|[-:]\s+[A-Z]/u;

export class Phase5_8StructuralFamilyRouter
implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'structural_family_routing' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();

    for (const carrier of carriers) {
      carrier.structuralRouting ??= routeStructuralFamily(carrier);
      const route = carrier.structuralRouting;
      carrier.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: route.type === 'unknown' ? 'warning' : 'success',
          durationMs: 0,
          message:
            route.type === 'unknown'
              ? 'Structural family router could not commit a family and left the type unresolved.'
              : `Structural family router routed citation to ${route.type}.`,
          details: {
            type: route.type,
            confidence: route.confidence,
            source: route.source,
            reasonCodes: route.reasonCodes,
          },
        }),
      );
    }

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: carriers.some((carrier) => carrier.structuralRouting?.type === 'unknown') ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        message: 'Structural family routing completed.',
      }),
    );

    return carriers;
  }
}

export const phase5_8StructuralFamilyRouter = new Phase5_8StructuralFamilyRouter();

export function routeStructuralFamily(carrier: ReferenceCarrier): StructuralFamilyRoutingResult {
  if (
    carrier.structuralRouting?.source === 'approved_truth'
    || carrier.structuralRouting?.source === 'authority_pack'
  ) {
    return carrier.structuralRouting;
  }

  const { fields } = carrier;
  const journalCandidate = topCandidateText(carrier.candidateEnvelope?.journalCandidates);
  const conferenceCandidate = topCandidateText(carrier.candidateEnvelope?.conferenceCandidates);
  const bookTitleCandidate = topCandidateText(carrier.candidateEnvelope?.bookTitleCandidates);
  const publisherCandidate = topCandidateText(carrier.candidateEnvelope?.publisherCandidates);
  const institutionCandidate = topCandidateText(carrier.candidateEnvelope?.institutionCandidates);
  const doi = fieldText(fields.doi);
  const authorityDoiHint = lookupAuthorityDoiHints(
    doi ?? undefined,
    typeof fields.year.value === 'number' ? fields.year.value : null,
  );
  const journal = fieldText(fields.journal) ?? journalCandidate;
  const conferenceTitle = fieldText(fields.conferenceTitle) ?? conferenceCandidate;
  const bookTitle = fieldText(fields.bookTitle) ?? bookTitleCandidate;
  const publisher = fieldText(fields.publisher) ?? publisherCandidate;
  const institution = fieldText(fields.institution) ?? institutionCandidate;
  const siteName = fieldText(fields.siteName);
  const title = fieldText(fields.title);
  const pages = fieldText(fields.pages);
  const webpageIdentifierLocatorArtifact = looksWebpageIdentifierLocatorArtifact(pages, {
    hasMeaningfulUrl:
      hasFieldValue(fields.url)
      && !/^https?:\/\/(?:dx\.)?doi\.org\//iu.test(String(fields.url.value ?? '')),
    siteName,
    institution,
    pmid: fieldText(fields.pmid),
  });
  const hasStrongArticleLocators =
    hasFieldValue(fields.volume)
    || hasFieldValue(fields.issue)
    || hasFieldValue(fields.issn);
  const hasLocators =
    hasStrongArticleLocators
    || (pages != null && !webpageIdentifierLocatorArtifact);
  const hasMeaningfulUrl =
    hasFieldValue(fields.url)
    && !/^https?:\/\/(?:dx\.)?doi\.org\//iu.test(String(fields.url.value ?? ''));
  const bookTitleArticleSpill = recoverArticleContainerSpill(bookTitle);
  const conferenceCue =
    Boolean(conferenceTitle && CONFERENCE_CUE_REGEX.test(conferenceTitle))
    || Boolean(conferenceCandidate && CONFERENCE_CUE_REGEX.test(conferenceCandidate))
    || CONFERENCE_CUE_REGEX.test(carrier.raw);
  const hasBookishDoi = Boolean(doi && /\b10\.\d{4,9}\/97[89][-\d]{10,17}\b/iu.test(doi));
  const publisherLooksBookish = Boolean(publisher && BOOKISH_PUBLISHER_REGEX.test(publisher));
  const hasBookishSignals =
    hasFieldValue(fields.isbn)
    || Boolean(bookTitle && !bookTitleArticleSpill)
    || publisherLooksBookish;
  const hasSparsePreprintOwnerProfile =
    !hasFieldValue(fields.repository)
    && !hasFieldValue(fields.arxiv)
    && !hasMeaningfulUrl
    && !hasFieldValue(fields.isbn)
    && !journal
    && !conferenceTitle
    && !conferenceCandidate
    && !bookTitle
    && !hasLocators
    && Boolean(publisher && isKnownPreprintRepositoryOwner(publisher))
    && hasPlaceholderDoiTail(carrier.raw);
  const journalishConference =
    Boolean(
      conferenceTitle
      && ARTICLE_CONTAINER_REGEX.test(conferenceTitle)
      && !CONFERENCE_CUE_REGEX.test(conferenceTitle),
    );
  const namedConferenceContainer =
    Boolean(
      conferenceTitle
      && conferenceTitle !== title
      && !journalishConference
      && !hasReportCue(conferenceTitle)
      && !INSTITUTION_CUE_REGEX.test(conferenceTitle)
      && EVENTISH_CONFERENCE_TITLE_REGEX.test(conferenceTitle),
    )
    || Boolean(
      conferenceCandidate
      && conferenceCandidate !== title
      && !hasReportCue(conferenceCandidate)
      && !INSTITUTION_CUE_REGEX.test(conferenceCandidate)
      && EVENTISH_CONFERENCE_TITLE_REGEX.test(conferenceCandidate),
    );
  const strongConferenceProfile = conferenceCue || namedConferenceContainer;
  const publisherLooksArticleContainer =
    Boolean(
      publisher
      && ARTICLE_CONTAINER_REGEX.test(publisher)
      && !CONFERENCE_CUE_REGEX.test(publisher)
      && !publisherLooksBookish,
    );
  const explicitReportCue =
    hasFieldValue(fields.reportNumber)
    || Boolean(institutionCandidate && INSTITUTION_CUE_REGEX.test(institutionCandidate))
    || hasReportCue(carrier.raw);
  const webpageProfile =
    Boolean(hasMeaningfulUrl && !hasLocators && !strongConferenceProfile)
    && (
      Boolean(siteName)
      || Boolean(carrier.fields.accessedDate.value)
      || hasWebpageCue(carrier.raw)
      || (title != null && !journal && !publisher && !institution)
    );
  const bookTitleArticleProfile =
    Boolean(
      bookTitleArticleSpill
      && !strongConferenceProfile
      && !hasFieldValue(fields.isbn)
      && !webpageProfile
      && !hasReportCue(carrier.raw)
      && (!authorityDoiHint.typeHint || authorityDoiHint.typeHint === 'article-journal')
      && (
        hasStrongArticleLocators
        || hasLocators
        || Boolean(doi)
        || Boolean(bookTitleArticleSpill.issnHint)
      ),
    );
  const strongArticleProfile =
    Boolean(
      !hasBookishSignals
      && (
        (journal && (hasStrongArticleLocators || ARTICLE_CONTAINER_REGEX.test(journal)))
        || (
          conferenceTitle
          && !strongConferenceProfile
          && hasStrongArticleLocators
          && (journalishConference || hasFieldValue(fields.issn))
        )
        || (publisherLooksArticleContainer && hasStrongArticleLocators)
        || bookTitleArticleProfile
      ),
    );
  const reportProfile =
    Boolean(
      explicitReportCue
      || (institution && INSTITUTION_CUE_REGEX.test(institution))
      || (
        publisher
        && INSTITUTION_CUE_REGEX.test(publisher)
        && !ARTICLE_CONTAINER_REGEX.test(publisher)
        && !publisherLooksBookish
      ),
    )
    && !strongArticleProfile
    && !strongConferenceProfile
    && !webpageProfile
    && !hasBookishSignals;
  const bookChapterProfile =
    Boolean(bookTitle)
    || Boolean(hasFieldValue(fields.isbn) && (BOOK_CHAPTER_CUE_REGEX.test(carrier.raw) || Boolean(bookTitle)))
    || Boolean(bookTitle && publisher);
  const preferBookChapterOverConference =
    Boolean(bookTitle)
    && !Boolean(conferenceTitle)
    && !Boolean(bookTitleArticleSpill)
    && !reportProfile
    && !webpageProfile
    && (hasFieldValue(fields.isbn) || publisherLooksBookish || hasBookishDoi);
  const bookProfile =
    Boolean(
      hasFieldValue(fields.isbn)
      && !strongConferenceProfile
      && !explicitReportCue
      && !webpageProfile,
    )
    || Boolean(
      publisherLooksBookish
      && !hasLocators
      && !strongConferenceProfile
      && !explicitReportCue
      && !webpageProfile
      && !bookChapterProfile,
    );

  if (hasFieldValue(fields.patent)) {
    return routed('patent', 0.99, 'heuristic', ['patent_identifier']);
  }

  if (hasFieldValue(fields.thesisType) || hasThesisCue(carrier.raw)) {
    return routed('thesis', 0.98, 'heuristic', ['thesis_cue']);
  }

  if (
    hasFieldValue(fields.repository)
    || hasFieldValue(fields.arxiv)
    || PREPRINT_CUE_REGEX.test(carrier.raw)
    || hasSparsePreprintOwnerProfile
  ) {
    return routed(
      'preprint',
      hasSparsePreprintOwnerProfile ? 0.95 : 0.96,
      'heuristic',
      hasSparsePreprintOwnerProfile ? ['preprint_sparse_owner_profile'] : ['preprint_cue'],
    );
  }

  if (strongArticleProfile) {
    const articleReasonCodes =
      conferenceTitle && !journal
        ? ['article_locator_profile', 'conference_container_article_override']
        : bookTitleArticleProfile && !journal
          ? ['article_locator_profile', 'book_container_article_override']
          : ['article_locator_profile'];
    return routed(
      'article-journal',
      conferenceTitle && !journal ? 0.95 : bookTitleArticleProfile && !journal ? 0.96 : 0.97,
      'heuristic',
      articleReasonCodes,
    );
  }

  if (preferBookChapterOverConference) {
    return routed('book-chapter', 0.94, 'heuristic', [
      'book_chapter_profile',
      'bookish_conference_override',
    ]);
  }

  if (strongConferenceProfile || (conferenceTitle && !hasLocators && !reportProfile && !webpageProfile)) {
    return routed(
      'conference-paper',
      conferenceCandidate && !fieldText(fields.conferenceTitle) ? 0.94 : 0.93,
      'heuristic',
      conferenceCandidate && !fieldText(fields.conferenceTitle)
        ? ['conference_container_profile', 'candidate_envelope_conference_support']
        : ['conference_container_profile'],
    );
  }

  if (webpageProfile) {
    return routed('webpage', 0.91, 'heuristic', ['web_document_profile']);
  }

  if (bookChapterProfile) {
    return routed('book-chapter', 0.88, 'heuristic', ['book_chapter_profile']);
  }

  if (bookProfile) {
    return routed('book', 0.88, 'heuristic', ['bookish_container_profile']);
  }

  if (reportProfile) {
    return routed(
      'report',
      explicitReportCue ? 0.93 : institutionCandidate ? 0.9 : 0.87,
      'heuristic',
      institutionCandidate ? ['institutional_report_profile', 'candidate_envelope_institution_support'] : ['institutional_report_profile'],
    );
  }

  if (authorityDoiHint.typeHint) {
    return routed(
      authorityDoiHint.typeHint,
      authorityDoiHint.confidence,
      'authority_pack',
      authorityDoiHint.reasonCodes,
    );
  }

  if (carrier.doiFastPath && hasFieldValue(fields.doi) && !hasCarrierEvidenceBeyondDoi(fields)) {
    return routed('unknown', 0.45, 'heuristic', ['doi_only_partial_parse']);
  }

  const fallbackType = classifyTypeHeuristically(carrier);
  return routed(
    fallbackType,
    fallbackType === 'unknown' ? 0.4 : fallbackTypeConfidence(fallbackType),
    'heuristic',
    ['heuristic_fallback'],
  );
}

function topCandidateText(candidates: CandidateEnvelopeEntry[] | undefined): string | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const text = sorted[0]?.text?.trim();
  return text ? text : null;
}

function routed(
  type: ReferenceType,
  confidence: number,
  source: StructuralFamilyRoutingResult['source'],
  reasonCodes: string[],
): StructuralFamilyRoutingResult {
  return {
    type,
    confidence,
    source,
    reasonCodes,
  };
}

function hasCarrierEvidenceBeyondDoi(fields: ExtractedFields): boolean {
  return [
    fields.title,
    fields.journal,
    fields.conferenceTitle,
    fields.bookTitle,
    fields.publisher,
    fields.institution,
    fields.siteName,
    fields.volume,
    fields.issue,
    fields.pages,
    fields.issn,
    fields.isbn,
    fields.reportNumber,
  ].some((field) => hasFieldValue(field));
}

function fieldText(field: ExtractedFields[keyof ExtractedFields]): string | null {
  if (!field || field.value == null || typeof field.value !== 'string') {
    return null;
  }
  const normalized = field.value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIdentifierLikeText(value: string | null | undefined): string {
  return (value ?? '').replace(/[^\p{L}\p{N}]+/gu, '').toLocaleLowerCase();
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

function hasWebpageCue(value: string | null | undefined): boolean {
  return /\b(?:accessed|retrieved|available at|online)\b/u.test(normalizeCueText(value));
}

function hasReportCue(value: string | null | undefined): boolean {
  return /\b(?:report|standard|bulletin|technical report|white paper|working paper|guideline|specification|recommendation)\b/u.test(
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

function looksWebpageIdentifierLocatorArtifact(
  pages: string | null,
  options: {
    hasMeaningfulUrl: boolean;
    siteName: string | null;
    institution: string | null;
    pmid: string | null;
  },
): boolean {
  if (!pages || !options.hasMeaningfulUrl || (!options.siteName && !options.institution)) {
    return false;
  }

  const normalizedPages = normalizeIdentifierLikeText(pages);
  if (normalizedPages === '99999999') {
    return true;
  }
  if (!normalizedPages) {
    return false;
  }

  return [options.pmid]
    .map((candidate) => normalizeIdentifierLikeText(candidate))
    .some((candidate) => candidate.length > 0 && candidate === normalizedPages);
}

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
): StageRunRecord {
  return {
    stageId: STAGE_ID,
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}
