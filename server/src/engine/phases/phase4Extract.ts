import { createHash } from 'node:crypto';
import { env } from '../../config.js';
import type { ExtractBatchError, ExtractResult, MLHealthResponse } from '../../ml/client.js';
import type { Phase4MlRuntimeLike, Phase4RequestMode } from '../../ml/phase4Runtime.js';
import { getPhase4OverrideMode } from '../../ml/phase4ModeOverride.js';
import { ML_ERROR_CODES, type MLError } from '../../ml/errors.js';
import { syncFieldUncertainty } from '../fieldConfidence.js';
import { toHealthWarning, uniqueHealthWarnings } from '../healthWarnings.js';
import { ErrorCode } from '../errors/index.js';
import { buildCandidateEnvelopeFromExtractionArtifacts } from '../reliability.js';
import {
  normalizeArxiv,
  normalizeDoi,
  normalizeHandle,
  normalizeIdentifierForField,
  normalizeIsbn,
  normalizeIssn,
  normalizePropagationUrl,
  normalizePatent,
  normalizePmid,
} from '../identifierUtils.js';
import { representativeStyleForFamily } from '../styleDetection.js';
import type { ReferenceCarrier } from '../types/carrier.js';
import { canOverwrite, fieldOf, type FieldSource } from '../types/field.js';
import type { CanonicalAuthor, CitationStyle, ExtractedFields, ReferenceType, StyleFamily } from '../types/citation.js';
import type {
  CitationExtractionHistoryRow,
  ExtractionMeta,
  ExtractionMetaError,
  ExtractionRunMode,
  ExtractionBioDebug,
  ShadowDiff,
} from '../types/extractionMeta.js';
import type {
  CitationFeatureRecallShadow,
  CitationFeatures,
} from '../types/extractionFeatures.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { isValidAuthorSpanText, looksLikeTitleOrProse, parseAuthorSegment, parseSingleAuthor, toCanonicalAuthor } from '../utils/authors.js';
import {
  cloneExtractedFields,
  EXTRACTED_FIELD_KEYS,
  hasFieldValue,
  isExtractedFieldKey,
  rewriteField,
  setExtractedField,
  type ExtractedFieldKey,
} from '../utils/fields.js';
import {
  AUTHORITY_BOOK_CHAPTER_DOI_REGEX,
  AUTHORITY_CONFERENCE_DOI_REGEX,
  AUTHORITY_EXPLICIT_REPORT_DOI_REGEX,
  AUTHORITY_OSTI_DOI_REGEX,
  recoverConferenceTitleFromAuthorityDoiHint,
  recoverPublisherFromAuthorityDoiHint,
} from '../data/authorityPack.js';
import { lookupIssnByJournalTitle } from '../data/journalIssnHints.js';
import {
  compareCitationFeatureRecallFromFeatures,
  extractCitationFeatures,
} from '../extractionFeatures.js';
import { resolveDoi } from './phase4/extractionContract.js';
import {
  buildRawCitationSupport,
  buildRawCitationSupportFromNormalizedRaw,
  findQuotedTitle,
  normalizeExtractionInput,
  stripTrailingIdentifierTailForParsing,
  type RawCitationSupport,
} from '../rawCitationSupport.js';
import { ocrFoldKey } from '../ingestion/ocrFold.js';

const CONTRACT_VERSION = 3;
const STAGE_ID = 'phase4_extraction';
const MAX_ML_BATCH_ITEMS = 128;
const UNCERTAINTY_THRESHOLD = 0.7;
const DOI_REGEX = /10\.\d{4,9}\/[^\s"'<>]+/i;
const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;
const SMART_QUOTES_REGEX = /[“”„‟«»]/g;
const SMART_APOSTROPHE_REGEX = /[‘’‚‛]/g;
const PMID_REGEX = /\bPMID[:\s]*(\d{5,9})\b/i;
const ARXIV_REGEX = /\b(?:arXiv:\s*|10\.48550\/arXiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)\b/i;
const ISBN_REGEX = /\bISBN(?:-1[03])?:?\s*((?:97[89][-\s]?)?\d(?:[-\s]?\d){8,}[0-9Xx])\b/i;
const ISSN_REGEX = /\bISSN:?\s*(\d{4}-?\d{3}[\dXx])\b/i;
const HANDLE_REGEX = /\b(?:hdl:\s*|https?:\/\/(?:hdl\.)?handle\.net\/)(\d+(?:\.\d+)*\/\S+)\b/i;
const PATENT_REGEX = /\b(?:(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)\s*)?Patent(?:\s+Application)?(?:\s+No\.?)?\s*([A-Z0-9/-]{5,})\b/i;
const BARE_PATENT_IDENTIFIER_REGEX = /\b(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)(?:\s*(?:RE|PP|D))?\s*\d{6,}[A-Z0-9/-]*\b/i;
const APA_ARTICLE_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>(?![A-Z]\.\s).+?),\s*(?<volume>\d+)\((?<issue>[^)]+)\),\s*(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu;
const APA_ARTICLE_NO_PAGES_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>(?![A-Z]\.\s).+?),\s*(?<volume>\d+)\((?<issue>[^)]+)\)\.?$/iu;
const APA_ARTICLE_NO_ISSUE_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>(?![A-Z]\.\s).+?),\s*(?<volume>\d+),\s*(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu;
const APA_ARTICLE_WORD_LOCATOR_REGEX =
  /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>(?![A-Z]\.\s).+?),\s*vol\.?\s*(?<volume>\d+),\s*no\.?\s*(?<issue>[^.]+)\.?$/iu;
const APA_SEMICOLON_ARTICLE_NO_PAGES_REGEX =
  /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>(?![A-Z]\.\s).+?)[,;]\s*(?<volume>\d+)\((?<issue>[^)]+)\)\.?$/iu;
const APA_ISSUE_ONLY_ARTICLE_REGEX =
  /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>(?![A-Z]\.\s).+?),\s*\((?<issue>[^)]+)\),\s*(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu;
const AUTHOR_DATE_BARE_LOCATOR_ARTICLE_REGEX =
  /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>.+?)\s+(?<volume>\d+)\((?<issue>[^)]+)\)\s+(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu;
const YEARLESS_ARTICLE_REGEX =
  /^(?<authors>.+?,\s*(?:[\p{Lu}]\.\s*){1,4})\s*\.?\s*(?<title>.+?)\.\s*(?<journal>(?![A-Z]\.\s).+?),\s*(?<volume>\d+)\((?<issue>[^)]+)\),\s*(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/u;
const HARVARD_ARTICLE_REGEX = /^(?<authors>.+?),\s*(?<year>(?:19|20)\d{2})\.\s*(?<title>.+?)\.\s*(?<journal>.+?),\s*(?<volume>\d+)\((?<issue>[^)]+)\),\s*pp?\.?\s*(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu;
const HARVARD_QUOTED_ARTICLE_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\s*["“](?<title>.+?)(?:[.?!,])?["”]\s*,?\s*(?<journal>.+?),\s*(?<volume>\d+)\((?<issue>[^)]+)\),\s*p{1,2}\.?\s*(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu;
const MLA_ARTICLE_REGEX = /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s+(?<journal>.+?),\s*vol\.\s*(?<volume>\d+)(?:,\s*no\.\s*(?<issue>[^,]+))?,\s*(?<year>(?:19|20)\d{2})(?:,\s*pp?\.?\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu;
const MLA_ARTICLE_ISSUE_ONLY_REGEX = /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s+(?<journal>.+?),\s*no\.\s*(?<issue>[^,]+),\s*(?<year>(?:19|20)\d{2})(?:,\s*pp?\.?\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu;
const CHICAGO_ARTICLE_REGEX = /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s+(?<journal>.+?)\s+(?<volume>\d+)(?:,\s*nos?\.?\s*(?<issue>[^ ]+))?\s+\((?<year>(?:19|20)\d{2})\)(?::\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu;
const VANCOUVER_ARTICLE_REGEX = /^(?<authors>.+?)\.\s*(?<title>.+?)\.\s*(?<journal>.+?)\.\s*(?<year>(?:19|20)\d{2})(?:\s+[A-Za-z]{3}\s+\d+)?;(?<volume>\d+)\((?<issue>[^)]+)\):(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu;
const VANCOUVER_ARTICLE_NO_ISSUE_REGEX = /^(?<authors>.+?)\.\s*(?<title>.+?)\.\s*(?<journal>.+?)\s+(?<year>(?:19|20)\d{2})(?:\s+[A-Za-z]{3}\s+\d+)?;(?<volume>\d+)(?:\((?<issue>[^)]+)\))?:(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu;
const NUMERIC_COLON_ARTICLE_REGEX = /^(?:\[\d+\]|\(\d+\)|\d+[.)])?\s*(?<authors>.+?):\s*(?<title>.+?)\.\s*(?<journal>.+?)\.\s*(?<year>(?:19|20)\d{2}),\s*(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?::\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?(?:\.\s*)?(?:10\.\d{4,9}\/[^\s"'<>]+)?\.?$/i;
// volume accepts a "?" placeholder (degraded inputs that lost the volume); it is
// cleared downstream so the citation parses as a proper article instead of falling
// through to a conference parser that mangles the container and drops the authors.
const IEEE_ARTICLE_REGEX = /^(?:\[\d+\]\s*)?(?<authors>.+?),\s*"(?<title>[^"]+)"\s*,?\s*(?<journal>.+?),\s*vol\.\s*(?<volume>\d+|\?)(?:,\s*no\.\s*(?<issue>[^,]+))?(?:,\s*p{1,2}\.\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?,\s*(?<year>(?:19|20)\d{2})\.?$/iu;
const IEEE_SEMICOLON_ARTICLE_REGEX =
  /^(?:\[\d+\]\s*)?(?<authors>.+?)[,;]\s*["“](?<title>.+?)(?:[;.,])?["”]\s*[;,]\s*(?<journal>.+?)\s*[;,]\s*vol\.?\s*(?<volume>\d+)(?:\s*[;,]\s*no\.?\s*(?<issue>[^;,.]+))?(?:\s*[;,]\s*p{1,2}\.?\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?(?:\s*[;,]\s*(?<year>(?:19|20)\d{2}))?\.?$/iu;
const REVIEW_ARTICLE_LOCATOR_REGEX =
  /^(?<authors>.+?,\s*(?:[A-Z]\.\s*){1,4})\s*\.?\s*(?<title>.+?\(review\))\.\s*(?<journal>.+?),\s*(?<volume>\d+)\((?<issue>[^)]+)\),\s*(?<pages>[A-Za-z]?\d[\w\-–]*)(?:,\s*(?<year>(?:19|20)\d{2}))?\.?$/iu;
const IN_COLLECTION_REGEX = /^(?<authors>.+?)\.\s*(?<title>[^.]+)\.\s*In\s+(?<container>.+?)\s*\(pp\.\s*(?<pages>[A-Za-z]?\d[\w\-–]*)\)\.\s*(?<publisher>[^.]+)\.?$/i;
const IEEE_IN_COLLECTION_REGEX = /^(?:\[\d+\]\s*)?(?<authors>.+?),\s*"(?<title>[^"]+)"\s*,?\s*in\s+(?<container>.+?),\s*(?<publisher>[^,]+),\s*(?<year>(?:19|20)\d{2}),\s*pp?\.\s*(?<pages>[A-Za-z]?\d[\w\-–]*(?:\.[A-Za-z0-9]+)?)\.?$/iu;
const AUTHOR_DATE_IN_COLLECTION_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?(?:[.?!]))\s+In\s+(?<container>.+?)\s*\(pp\.\s*(?<pages>[^)]+)\)\.\s*(?<publisher>.+?)(?:\.\s*(?:Available at|Retrieved from)\b.*)?\.?$/iu;
const AUTHOR_DATE_QUOTED_CHAPTER_TAIL_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\s*["“](?<title>.+?)(?:[.?!,])?["”]\s+(?<container>.+?)\.\s+(?<publisher>.+?),\s*pp?\.\s*(?<pages>[A-Za-z]?\d[\w\-–]*(?:\.[A-Za-z0-9]+)?)(?:\.\s*(?:Available at|Retrieved from)\b.*)?\.?$/iu;
const HARVARD_IN_COLLECTION_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\s*["“](?<title>.+?)(?:[.?!,])?["”]\s*,?\s*(?<container>.+?)\.\s*(?<publisher>.+?)(?:,\s*pp?\.\s*(?<pages>[A-Za-z]?\d[\w\-–]*(?:\.[A-Za-z0-9]+)?))?(?:\.\s*(?:Available at|Retrieved from)\b.*)?\.?$/iu;
const CHICAGO_IN_COLLECTION_REGEX = /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s*In\s+(?<container>.+?)\.\s*(?<publisher>.+?),\s*(?<year>(?:19|20)\d{2})\.?$/iu;
const MLA_CONTAINER_PAGES_REGEX = /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s*(?<container>.+),\s*(?<publisher>[^,]+),\s*(?<year>(?:19|20)\d{2})(?:,\s*pp?\.\s*(?<pages>[A-Za-z]?\d[\w\-–]*(?:\.[A-Za-z0-9]+)?))?\.?$/iu;
const VANCOUVER_CONTAINER_PAGES_REGEX = /^(?:\[\d+\]\s*)?(?<authors>.+?)\.\s*(?<title>.+?)\.\s*(?<container>.+),\s*(?<publisher>[^;]+);\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*(?<pages>[A-Za-z]?\d[\w\-–]*(?:\.[A-Za-z0-9]+)?))?\.?$/iu;
const AUTHOR_DATE_QUOTED_TAIL_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\s*["“](?<title>.+?)(?:[.?!,])?["”]\s*(?<container>.+?)\.?$/iu;
const AUTHOR_DATE_BOOK_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:1[6-9]|20)\d{2})\)\.?\s*(?<title>.+?)(?:[.?!])\s*(?<publisher>[^.]+)\.?$/iu;
const GIVEN_NAME_LATE_YEAR_BOOK_REGEX =
  /^(?<authors>.+?,\s*.+?)\.\s*(?<title>.+?)(?:[.?!])\s*(?<publisher>[^,;]+)[,;]\s*(?<year>(?:1[6-9]|20)\d{2})\.?$/iu;
const CORPORATE_PUBLISHER_TAIL_BOOK_REGEX =
  /^(?<authors>.+?\b(?:fund|survey|standards|organization|organisation|institute|agency|department|ministry|office|association|society|task force|library|university)\b)\.\s*(?<title>.+?)\.\s*(?<publisher>[^,;]+)[,;]\s*(?<year>(?:1[6-9]|20)\d{2})\.?$/iu;
const INITIALS_LATE_YEAR_BOOK_REGEX =
  /^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*(?<authors>(?:[A-Z]\.\s*)+[A-Z][\p{L}'-]+),\s*(?<title>.+?)\.\s*(?<publisher>[^,;]+)[,;]\s*(?<year>(?:1[6-9]|20)\d{2})\.?$/u;
const QUOTED_PUBLISHER_TAIL_REGEX =
  /^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*(?<authors>.+?),\s*["“](?<title>.+?)(?:[.?!,])?["”]\s*,?\s*(?<publisher>[^,;]+)[,;]\s*(?<year>(?:1[6-9]|20)\d{2})\.?$/iu;
const NUMERIC_QUOTED_PUBLISHER_PAGES_TAIL_REGEX =
  /^(?:\[\d+\]\s*)?(?<authors>.+?),\s*["“](?<title>.+?)(?:[.?!,])?["”]\s*,?\s*(?<publisher>[^,;]+)[,;]\s*(?<year>(?:19|20)\d{2}),\s*p{1,2}\.?\s*(?<pages>[^.;]+)\.?$/iu;
const NUMERIC_SEMICOLON_BOOK_REGEX =
  /^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*(?<authors>(?:(?:[A-Z][\p{L}'-]+(?:\s+[A-Z]\.){1,3})|(?:(?:[A-Z]\.\s*)+[A-Z][\p{L}'-]+)))\s*(?<title>.+?)\.\s*(?<publisher>[^;]+);\s*(?<year>(?:1[6-9]|20)\d{2})\.?$/u;
const NUMERIC_BOOK_REGEX =
  /^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*(?<authors>.+?),\s*(?<title>.+?)\.\s*(?<publisher>[^,]+),\s*(?<year>(?:1[6-9]|20)\d{2})\.?$/iu;
const LATE_YEAR_BOOK_REGEX = /^(?:\[\d+\]\s*)?(?<authors>.+?)[.,]\s*(?<title>.+?)\.\s*(?<publisher>[^,;]+)[,;]\s*(?<year>(?:1[6-9]|20)\d{2})\.?$/iu;
const CHICAGO_CONFERENCE_REGEX = /^(?<authors>.+?)[.,]?\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s*Paper presented at\s+(?<container>.+)\.\s*(?<year>(?:19|20)\d{2})\.?$/iu;
const MLA_CONFERENCE_REGEX =
  /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s*(?<year>(?:19|20)\d{2}),\s*(?<container>.+?)\.?$/iu;
const APA_CONFERENCE_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)(?:[?!]|\.(?!\d))\s*(?<container>(?:.*\bProceedings\b|.*(?:Conference|Symposium|Workshop|Congress|Congreso|Congresso|Meeting|Jornadas|Anais|Abstracts Publication).*))\.?$/iu;
const VANCOUVER_CONFERENCE_INSTITUTIONAL_ETAL_REGEX =
  /^(?:\[\d+\]\s*)?(?<authors>.+?\bet al\.)\s+(?<title>.+?),\s*(?<container>[^;]+);\s*(?<year>(?:19|20)\d{2})\.?$/iu;
const VANCOUVER_CONFERENCE_PUBLISHER_ETAL_REGEX =
  /^(?:\[\d+\]\s*)?(?<authors>.+?\bet al\.)\s*(?<title>.+?),\s*(?<publisher>[^;]+);\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*(?<pages>[^.;]+))?\.?$/iu;
const VANCOUVER_CONFERENCE_PUBLISHER_REGEX =
  /^(?:\[\d+\]\s*)?(?<authors>.+?)\.\s*(?<title>.+?),\s*(?<publisher>[^;]+);\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*(?<pages>[^.;]+))?\.?$/iu;
const CHICAGO_ARTICLE_PAGES_ONLY_REGEX =
  /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s+(?<journal>.+?),\s*(?<year>(?:19|20)\d{2}),\s*(?<pages>[A-Za-zIVXLCDM]*\d[\w\-–]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d[\w\-–]*)?)\.?$/iu;
const CHICAGO_CONFERENCE_PAGES_ONLY_REGEX =
  /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s*(?<year>(?:19|20)\d{2}),\s*(?<pages>[A-Za-zIVXLCDM]*\d[\w\-–]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d[\w\-–]*)?)\.?$/iu;
const THESIS_BRACKET_REGEX = /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\s*\[(?<thesisType>[^\],]+),\s*(?<institution>[^\]]+)\]\.?$/i;
const THESIS_TAIL_REGEX = /^(?<authors>.+?)\.\s*(?<title>.+?)\.\s*(?<year>(?:19|20)\d{2}),\s*https?:\/\/[^\s"'<>]+\.\s*(?<institution>.+?),\s*(?<thesisType>Dissertation|Thesis)\.?$/iu;
const WEBPAGE_AUTHORLESS_REGEX = /^(?<title>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<siteName>[^.]+)\.?$/i;
const WEBPAGE_APA_CORPORATE_REGEX = /^(?<authors>.+?)\.\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<publisher>[^.]+)\.\s*(?<siteName>[^.]+)\.?$/iu;
const WEBPAGE_CHICAGO_REGEX = /^(?<siteName>.+?)\.\s*["“](?<title>.+?)["”]\.?\s*(?<year>(?:19|20)\d{2})\.?$/iu;
const WEBPAGE_CHICAGO_OWNER_REGEX =
  /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s*(?<siteName>[^,]+),\s*(?<publisher>[^,]+),\s*(?<year>(?:19|20)\d{2})\.?$/iu;
const WEBPAGE_HARVARD_OWNER_SITE_REGEX =
  /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\s*(?<title>.+?),\s*(?<siteName>[^.]+)\.\s*(?<publisher>.+?)\.?$/iu;
const WEBPAGE_HARVARD_REGEX = /^(?<title>.+?)\s*\((?<year>(?:19|20)\d{2})\)\s*(?<siteName>[^.]+)\.?$/iu;
const WEBPAGE_IEEE_REGEX = /^(?:\[\d+\]\s*)?"(?<title>[^"]+?)(?:,)?"\s*,?\s*(?<siteName>[^.]+)\.\s*\[Online\]\.?/iu;
const WEBPAGE_MLA_REGEX =
  /^(?<authors>.+?)\.\s*["“](?<title>[^"”]+)["”]\.?\s*(?<siteName>[^,]+),\s*(?<publisher>[^,]+),\s*(?<year>(?:19|20)\d{2})\.?$/iu;
const WEBPAGE_VANCOUVER_REGEX = /^(?:\[\d+\]\s*)?(?<title>.+?)\.\s*(?<siteName>[^.]+)\s+(?<year>(?:19|20)\d{2})\.?$/iu;
const DOI_URL_REGEX = /^https?:\/\/(?:dx\.)?doi\.org\//iu;
const PLACEHOLDER_DOI_URL_REGEX = /^https?:\/\/(?:dx\.)?doi\.org\/?\.?$/iu;
const PREPRINT_DOI_ID_REGEX = /\b10\.20944\/preprints(?<year>\d{4})(?<month>\d{2})\.(?<sequence>\d{4})\.v\d+\b/iu;
const SPARSE_PREPRINT_OWNER_REGEX =
  /\b(?:elsevier bv|research square platform llc|mdpi ag|jmir publications inc|arxiv|biorxiv|medrxiv|ieee|institute of electrical and electronics engineers(?: ieee)?)\b/iu;
const CONFERENCE_CUE_REGEX = /(?:\b(?:conference|symposium|simp[oó]sio|workshop|congress|congreso|congresso|meeting|proceedings|proc\.?|anais|prosiding|jornadas|seminar|seminario|abstracts publication)\b|конференц\p{L}*|канферэнц\p{L}*)/iu;
const CONFERENCE_KEYWORD_REGEX = /(?:\b(?:conference|proceedings|anais|symposium|workshop|congress|meeting|forum|seminar)\b|семинар\p{L}*|канферэнц\p{L}*|матэрыял\p{L}*)/iu;
const CONFERENCE_DOI_REGEX = AUTHORITY_CONFERENCE_DOI_REGEX;
const BOOK_CHAPTER_DOI_REGEX = AUTHORITY_BOOK_CHAPTER_DOI_REGEX;
const EXPLICIT_REPORT_DOI_REGEX = AUTHORITY_EXPLICIT_REPORT_DOI_REGEX;
const OSTI_DOI_REGEX = AUTHORITY_OSTI_DOI_REGEX;
const ML_BYPASS_STYLES = new Set<CitationStyle>(['ama', 'acs']);
const ML_SUPPORTED_STYLES = new Set<CitationStyle>([
  'apa7',
  'mla9',
  'vancouver',
  'ieee',
  'harvard-ctr',
  'chicago-author-date',
  'chicago-notes-bib',
  'unknown',
]);
const ML_PRIMARY_PATCH_FIELDS = new Set<ExtractedFieldKey>([
  'conferenceTitle',
  'publisher',
  'authors',
  'doi',
  'title',
]);
const ML_PRIMARY_PATCH_CONFIDENCE_FLOORS: Partial<Record<ExtractedFieldKey, number>> = {
  conferenceTitle: 0.86,
  publisher: 0.86,
  authors: 0.82,
  doi: 0.97,
  title: 0.84,
};
const COMPARABLE_TEXT_CACHE_LIMIT = 32_768;
const CONFERENCE_TITLE_NORMALIZATION_CACHE_LIMIT = 32_768;
const PREPRINT_CUE_CACHE_LIMIT = 16_384;
const CONFERENCE_CONTAINER_CACHE_LIMIT = 16_384;
const NUMERIC_CONFERENCE_RECOVERY_CACHE_LIMIT = 8_192;
const QUOTED_NUMERIC_CONFERENCE_RECOVERY_CACHE_LIMIT = 8_192;
const TAIL_AFTER_TITLE_CACHE_LIMIT = 16_384;
const TEMPORAL_CONFERENCE_RECOVERY_CACHE_LIMIT = 8_192;
const CONFERENCE_PUBLISHER_ALIAS_CACHE_LIMIT = 8_192;
const CONFERENCE_PUBLISHER_TITLE_TAIL_CACHE_LIMIT = 8_192;
const CONFERENCE_PUBLISHER_SLOT_CACHE_LIMIT = 8_192;
const EXPLICIT_CONFERENCE_PUBLISHER_CACHE_LIMIT = 8_192;
const COMPACT_CONFERENCE_ALIAS_CACHE_LIMIT = 16_384;
const PUBLISHER_YEAR_TAIL_CACHE_LIMIT = 16_384;
const QUOTED_PUBLISHER_BEFORE_YEAR_CACHE_LIMIT = 16_384;
const LOOSE_DATE_PLACE_CONFERENCE_CACHE_LIMIT = 16_384;
const PROPAGATION_PUBLISHER_PROXY_CACHE_LIMIT = 16_384;

interface ParsedReference {
  authorSegment?: string | undefined;
  title?: string | undefined;
  year?: number | undefined;
  journal?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  pages?: string | undefined;
  conferenceTitle?: string | undefined;
  bookTitle?: string | undefined;
  publisher?: string | undefined;
  institution?: string | undefined;
  thesisType?: string | undefined;
  siteName?: string | undefined;
  repository?: string | undefined;
  typeHint?: ReferenceType | undefined;
  patent?: string | undefined;
}

interface TokenWindow {
  tokenStart: number;
  tokenEnd: number;
}

interface TokenizedInput {
  tokens: string[];
  ranges: Array<{ start: number; end: number }>;
}

interface HeuristicEvidence {
  fields: Partial<Record<ExtractedFieldKey, unknown>>;
  fieldConfidences: Partial<Record<ExtractedFieldKey, number>>;
  spanTexts: Partial<Record<ExtractedFieldKey, string>>;
  warnings: string[];
  overallConfidence: number;
}

interface HeuristicCandidateContext {
  parsed: ParsedReference;
  yearMatch: CitationFeatures['yearMatch'];
  preprintCue: boolean;
  thesisCue: boolean;
  authorSegment: string;
  titleSegment: string;
  remainderAfterTitle: string;
  venueRemainder: string;
  vancouverJournalHint: string | null;
  volumeIssuePages: RegExpMatchArray | null;
  volumeIssueWithoutPages: RegExpMatchArray | null;
  pagesOnly: RegExpMatchArray | null;
  parsedAsApaCorporateWebpage: boolean;
  parsedAsOwnerSiteWebpage: boolean;
  parseableRaw: string;
  rawHasThesisCue: boolean;
  rawHasReportCue: boolean;
  rawHasConferenceCue: boolean;
  rawHasWebsiteAccessMarker: boolean;
  rawHasNonDoiUrl: boolean;
  rawHasDoiOnlyUrl: boolean;
  rawHasWebpageOwnerTailProfile: boolean;
  hasPlaceholderDoiTailFlag: boolean;
}

interface Phase4RoutingConfig {
  mode: 'heuristic' | 'shadow' | 'primary';
  primaryFraction: number;
  shadowFraction: number;
}

interface Phase4SelectionPlan {
  path: 'heuristic' | 'shadow' | 'primary';
  shouldAttemptMl: boolean;
  reason: string;
}

interface MlResolution {
  result?: ExtractResult;
  error?: ExtractionMetaError;
}

interface HeuristicExtractComputation {
  prediction: ExtractResult;
  candidateRecallShadow?: CitationFeatureRecallShadow;
}

export class Phase4Extract implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'extraction' as const;
  readonly contractVersion = CONTRACT_VERSION;

  constructor(private readonly phase4Runtime?: Phase4MlRuntimeLike) {}

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    const captureCarrierDiagnostics = ctx.options.debug || ctx.executionPolicy.debugMode === 'full';
    const prebuildCandidateEnvelope = ctx.executionPolicy.parseProfile !== 'core_parse_fast';
    const extractionMlDisabled = ctx.executionPolicy.extractionMl === 'off';
    const routingConfig = extractionMlDisabled
      ? heuristicRoutingConfig()
      : normalizeRoutingConfigForPipeline(await readRoutingConfig(), ctx);
    const heuristics = new Map<string, HeuristicExtractComputation>();

    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;
      heuristics.set(carrier.id, buildHeuristicExtractResult(carrier, captureCarrierDiagnostics));
    }

    const health = extractionMlDisabled || routingConfig.mode === 'heuristic'
      ? null
      : (this.phase4Runtime?.getCachedHealth() ?? null);
    const activeModelVersion = health?.activeModelVersion ?? 'heuristic';
    const plans = new Map<string, Phase4SelectionPlan>();
    let primaryCount = 0;
    let shadowCount = 0;
    let heuristicCount = 0;

    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;
      const plan: Phase4SelectionPlan = extractionMlDisabled
        ? { path: 'heuristic', shouldAttemptMl: false, reason: 'policy_off' }
        : selectPlanForCarrier(carrier, routingConfig, activeModelVersion);
      plans.set(carrier.id, plan);
      if (plan.path === 'primary') primaryCount += 1;
      else if (plan.path === 'shadow') shadowCount += 1;
      else heuristicCount += 1;
      if (plan.reason === 'unsupported_style_bypass' || plan.reason === 'unsupported_style') {
        this.phase4Runtime?.recordFallback(plan.reason);
      }
    }

    const mlResults = extractionMlDisabled
      ? new Map<string, MlResolution>()
      : await this.resolveMlPredictions(carriers, plans, ctx);

    let mlFailureCount = 0;
    let warningCount = 0;

    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;

      const heuristic = heuristics.get(carrier.id);
      const plan = plans.get(carrier.id);
      if (!heuristic || !plan) continue;

      try {
        const resolution = mlResults.get(carrier.id);
        if (resolution?.error) mlFailureCount += 1;

        const applied = applyPhase4Selection(
          carrier,
          heuristic.prediction,
          heuristic.candidateRecallShadow,
          resolution,
          plan,
          health,
        );
        carrier.fields = applied.fields;
        const liveRepository = typeof carrier.fields.repository.value === 'string'
          ? normalizeConferenceTitle(carrier.fields.repository.value)
          : null;
        const liveConferenceForPreprint = typeof carrier.fields.conferenceTitle.value === 'string'
          ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
          : null;
        const livePublisherForPreprint = typeof carrier.fields.publisher.value === 'string'
          ? normalizeConferenceTitle(carrier.fields.publisher.value)
          : null;
        if (
          liveRepository
          && liveConferenceForPreprint
          && !looksProceedingsLikeDoi(typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined)
          && !/\bpaper presented at\b/iu.test(carrier.raw)
          && (
            /\bpreprint\b/iu.test(carrier.raw)
            || /\bpreprint\b/iu.test(liveConferenceForPreprint)
            || !looksConferencePublicationVenue(liveConferenceForPreprint)
            || normalizeComparableText(liveConferenceForPreprint) === normalizeComparableText(liveRepository)
            || (
              livePublisherForPreprint
              && normalizeComparableText(liveConferenceForPreprint) === normalizeComparableText(livePublisherForPreprint)
            )
          )
        ) {
          setExtractedField(
            carrier.fields,
            'conferenceTitle',
            fieldOf(
              null,
              carrier.fields.conferenceTitle.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.conferenceTitle.origin,
                previousValue: carrier.fields.conferenceTitle.value,
                previousSource: carrier.fields.conferenceTitle.source,
                previousOrigin: carrier.fields.conferenceTitle.origin,
              },
            ) as ExtractedFields['conferenceTitle'],
          );
        }
        const liveConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
          ? carrier.fields.conferenceTitle.value
          : null;
        const livePublisher = typeof carrier.fields.publisher.value === 'string'
          ? carrier.fields.publisher.value
          : null;
        const liveTitle = typeof carrier.fields.title.value === 'string'
          ? carrier.fields.title.value
          : null;
        if (liveConferenceTitle && !livePublisher && liveTitle) {
          const quotedCompactConferenceAliasTail = liveTitle.match(
            /^(?<title>.+?)(?:["“”'‘’]\.?\s*)(?<alias>[A-Z][A-Z0-9&./-]{2,18})$/u,
          );
          const repairedQuotedCompactAliasTitle = normalizeTitleCandidate(
            quotedCompactConferenceAliasTail?.groups?.title,
          );
          if (repairedQuotedCompactAliasTitle) {
            setExtractedField(
              carrier.fields,
              'title',
              fieldOf(
                repairedQuotedCompactAliasTitle,
                carrier.fields.title.source,
                STAGE_ID,
                carrier.fields.title.confidence,
                {
                  origin: carrier.fields.title.origin,
                  previousValue: liveTitle as ExtractedFields['title']['value'],
                  previousSource: carrier.fields.title.source,
                  previousOrigin: carrier.fields.title.origin,
                },
              ) as ExtractedFields['title'],
            );
          }
        }
        repairFinalMergedFieldInteractions(carrier.fields, carrier.raw);
        const postRepairConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
          ? carrier.fields.conferenceTitle.value
          : null;
        const postRepairPublisher = typeof carrier.fields.publisher.value === 'string'
          ? carrier.fields.publisher.value
          : null;
        const postRepairTitle = typeof carrier.fields.title.value === 'string'
          ? carrier.fields.title.value
          : null;
        const postRepairQuotedAliasTail = postRepairTitle
          ? postRepairTitle.match(/^(?<title>.+?)(?:["“”'‘’]\.?\s*)(?<alias>[A-Z][A-Z0-9&./-]{2,18})$/u)
          : null;
        const repairedPostRepairTitle = normalizeTitleCandidate(
          postRepairQuotedAliasTail?.groups?.title,
        );
        if (repairedPostRepairTitle) {
          carrier.fields.title.value = repairedPostRepairTitle;
        }
        const repairedDecimalTitle = recoverDecimalTitleContinuationFromPublisherSpill(
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
          typeof carrier.fields.publisher.value === 'string' ? carrier.fields.publisher.value : null,
          typeof carrier.fields.publisher.previousValue === 'string'
            ? carrier.fields.publisher.previousValue
            : null,
        );
        if (repairedDecimalTitle) {
          carrier.fields.title.value = repairedDecimalTitle;
        }

        const postAliasTitle = typeof carrier.fields.title.value === 'string'
          ? carrier.fields.title.value
          : null;
        const postAliasJournal = typeof carrier.fields.journal.value === 'string'
          ? carrier.fields.journal.value
          : null;
        const postAliasPublisher = typeof carrier.fields.publisher.value === 'string'
          ? carrier.fields.publisher.value
          : null;
        const quotedTitleCandidate = findQuotedTitle(carrier.raw)?.title ?? null;
        if (
          postAliasTitle
          && postAliasJournal
          && postAliasPublisher
          && normalizeComparableText(postAliasPublisher) === normalizeComparableText(postAliasJournal)
          && quotedTitleCandidate
          && (
            isBetterQuotedTitleCandidate(quotedTitleCandidate, postAliasTitle)
            || (
              /\b\d+(?:st|nd|rd|th)\s+ed(?:ition)?\b/iu.test(quotedTitleCandidate)
              && normalizeComparableText(quotedTitleCandidate).includes(normalizeComparableText(postAliasTitle))
            )
          )
        ) {
          const normalizedQuotedTitle = normalizeTitleCandidate(
            normalizeInlineQuoteCharacters(quotedTitleCandidate).replace(/[’‘]/gu, "'"),
          );
          if (normalizedQuotedTitle) {
            carrier.fields.title.value = normalizedQuotedTitle;
            carrier.fields.publisher.value = null;
          }
        }

        const locatorOverflowTitle = typeof carrier.fields.title.value === 'string'
          ? carrier.fields.title.value.match(
            /^(?<title>.+?)\.\s+(?<journal>.+?),\s*vol\.?\s*(?<volume>\d+)(?:,\s*no\.?\s*(?<issue>[^,.;]+))?(?:[,;:]\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu,
          )
          : null;
        if (locatorOverflowTitle?.groups?.title && locatorOverflowTitle.groups.journal) {
          const recoveredTitle = normalizeTitleCandidate(locatorOverflowTitle.groups.title);
          const recoveredJournal = normalizeJournalCandidate(
            locatorOverflowTitle.groups.journal,
            recoveredTitle,
          );
          if (recoveredTitle && recoveredJournal) {
            carrier.fields.title.value = recoveredTitle;
            carrier.fields.journal.value = recoveredJournal;
            if (!hasFieldValue(carrier.fields.volume) && locatorOverflowTitle.groups.volume?.trim()) {
              carrier.fields.volume.value = locatorOverflowTitle.groups.volume.trim();
            }
            if (!hasFieldValue(carrier.fields.issue) && locatorOverflowTitle.groups.issue?.trim()) {
              carrier.fields.issue.value = locatorOverflowTitle.groups.issue.trim();
            }
            if (!hasFieldValue(carrier.fields.pages) && locatorOverflowTitle.groups.pages?.trim()) {
              carrier.fields.pages.value = normalizePages(locatorOverflowTitle.groups.pages);
            }
            carrier.fields.publisher.value = null;
            carrier.fields.institution.value = null;
          }
        }

        const titleLeadSentence = typeof carrier.fields.title.value === 'string'
          ? carrier.fields.title.value.match(/^(?<title>.+?)\.\s+\p{Lu}/u)?.groups?.title
          : null;
        const recoveredLeadSentenceArticleOverflow =
          !hasFieldValue(carrier.fields.journal)
          && titleLeadSentence
          && /\bvol\.?\s*\d+/iu.test(carrier.raw)
            ? recoverArticleLocatorAfterTitle(carrier.raw, titleLeadSentence)
            : null;
        const recoveredLeadTitle = titleLeadSentence
          ? normalizeTitleCandidate(titleLeadSentence)
          : null;
        if (recoveredLeadSentenceArticleOverflow && recoveredLeadTitle) {
          setExtractedField(
            carrier.fields,
            'title',
            fieldOf(
              recoveredLeadTitle,
              carrier.fields.title.source,
              STAGE_ID,
              Math.max(carrier.fields.title.confidence, 0.8),
              {
                origin: carrier.fields.title.origin,
                previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
                previousSource: carrier.fields.title.source,
                previousOrigin: carrier.fields.title.origin,
              },
            ) as ExtractedFields['title'],
          );
          setExtractedField(
            carrier.fields,
            'journal',
            fieldOf(
              recoveredLeadSentenceArticleOverflow.journal,
              'regex_fallback',
              STAGE_ID,
              0.76,
              {
                previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
                previousSource: carrier.fields.journal.source,
                previousOrigin: carrier.fields.journal.origin,
              },
            ) as ExtractedFields['journal'],
          );
          if (!hasFieldValue(carrier.fields.volume) && recoveredLeadSentenceArticleOverflow.volume) {
            setExtractedField(
              carrier.fields,
              'volume',
              fieldOf(
                recoveredLeadSentenceArticleOverflow.volume,
                'regex_fallback',
                STAGE_ID,
                0.74,
                {
                  previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
                  previousSource: carrier.fields.volume.source,
                  previousOrigin: carrier.fields.volume.origin,
                },
              ) as ExtractedFields['volume'],
            );
          }
          if (!hasFieldValue(carrier.fields.issue) && recoveredLeadSentenceArticleOverflow.issue) {
            setExtractedField(
              carrier.fields,
              'issue',
              fieldOf(
                recoveredLeadSentenceArticleOverflow.issue,
                'regex_fallback',
                STAGE_ID,
                0.72,
                {
                  previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
                  previousSource: carrier.fields.issue.source,
                  previousOrigin: carrier.fields.issue.origin,
                },
              ) as ExtractedFields['issue'],
            );
          }
          if (!hasFieldValue(carrier.fields.pages) && recoveredLeadSentenceArticleOverflow.pages) {
            setExtractedField(
              carrier.fields,
              'pages',
              fieldOf(
                recoveredLeadSentenceArticleOverflow.pages,
                'regex_fallback',
                STAGE_ID,
                0.7,
                {
                  previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
                  previousSource: carrier.fields.pages.source,
                  previousOrigin: carrier.fields.pages.origin,
                },
              ) as ExtractedFields['pages'],
            );
          }
          setExtractedField(
            carrier.fields,
            'publisher',
            fieldOf(
              null,
              carrier.fields.publisher.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.publisher.origin,
                previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
                previousSource: carrier.fields.publisher.source,
                previousOrigin: carrier.fields.publisher.origin,
              },
            ) as ExtractedFields['publisher'],
          );
          setExtractedField(
            carrier.fields,
            'institution',
            fieldOf(
              null,
              carrier.fields.institution.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.institution.origin,
                previousValue: carrier.fields.institution.value as ExtractedFields['institution']['value'],
                previousSource: carrier.fields.institution.source,
                previousOrigin: carrier.fields.institution.origin,
              },
            ) as ExtractedFields['institution'],
          );
          setExtractedField(
            carrier.fields,
            'siteName',
            fieldOf(
              null,
              carrier.fields.siteName.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.siteName.origin,
                previousValue: carrier.fields.siteName.value as ExtractedFields['siteName']['value'],
                previousSource: carrier.fields.siteName.source,
                previousOrigin: carrier.fields.siteName.origin,
              },
            ) as ExtractedFields['siteName'],
          );
        }

        const postRepairDoi = typeof carrier.fields.doi.value === 'string'
          ? carrier.fields.doi.value
          : undefined;
        const postRepairDoiPublisherHint = inferPublisherFromDoiHint(postRepairDoi);
        const postRepairJournal = typeof carrier.fields.journal.value === 'string'
          ? carrier.fields.journal.value
          : null;
        if (
          !postRepairJournal
          && typeof carrier.fields.publisher.value === 'string'
          && (
            hasFieldValue(carrier.fields.volume)
            || hasFieldValue(carrier.fields.issue)
            || hasFieldValue(carrier.fields.pages)
          )
          && !looksConferencePublicationVenue(carrier.fields.publisher.value)
          && !looksConferenceContainer(carrier.fields.publisher.value)
        ) {
          const recoveredJournal = normalizeJournalCandidate(
            carrier.fields.publisher.value,
            typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
          );
          if (recoveredJournal) {
            carrier.fields.journal.value = recoveredJournal;
            carrier.fields.publisher.value = null;
          }
        }

        const postRepairConferenceForPublisher = typeof carrier.fields.conferenceTitle.value === 'string'
          ? carrier.fields.conferenceTitle.value
          : null;
        if (
          !hasFieldValue(carrier.fields.publisher)
          && postRepairDoiPublisherHint
          && (
            postRepairConferenceForPublisher != null
            || CONFERENCE_DOI_REGEX.test(carrier.raw)
            || /\bpaper presented at\b/iu.test(carrier.raw)
          )
        ) {
          carrier.fields.publisher.value = postRepairDoiPublisherHint;
        }

        const recoveredQuotedConference = recoverQuotedConferenceSegmentsFromRaw(
          carrier.raw,
          postRepairConferenceForPublisher,
          postRepairDoi,
        );
        if (recoveredQuotedConference) {
          carrier.fields.title.value = recoveredQuotedConference.title;
          if (
            !hasFieldValue(carrier.fields.authors)
            || (Array.isArray(carrier.fields.authors.value) && carrier.fields.authors.value.length === 0)
          ) {
            carrier.fields.authors.value = recoveredQuotedConference.authors;
          }
          if (
            recoveredQuotedConference.publisher
            && (
              !hasFieldValue(carrier.fields.publisher)
              || (
                typeof carrier.fields.publisher.value === 'string'
                && looksConferencePublicationVenue(carrier.fields.publisher.value)
              )
            )
          ) {
            carrier.fields.publisher.value = recoveredQuotedConference.publisher;
          }
        }

        if (
          postRepairDoiPublisherHint
          && typeof carrier.fields.publisher.value === 'string'
          && postRepairConferenceForPublisher
          && (
            looksConferencePublicationVenue(carrier.fields.publisher.value)
            || looksConferenceContainer(carrier.fields.publisher.value)
            || normalizeComparableText(postRepairConferenceForPublisher).startsWith(
              normalizeComparableText(carrier.fields.publisher.value),
            )
          )
        ) {
          carrier.fields.publisher.value = postRepairDoiPublisherHint;
        }

        const aliasSpillPublisher = typeof carrier.fields.publisher.value === 'string'
          ? carrier.fields.publisher.value.match(/^(?<title>.+?),\s*(?<alias>[A-Z][A-Z0-9&./-]{2,18})$/u)
          : null;
        if (
          aliasSpillPublisher?.groups?.title
          && aliasSpillPublisher.groups.alias
          && postRepairConferenceForPublisher
        ) {
          const recoveredTitle = normalizeTitleCandidate(aliasSpillPublisher.groups.title);
          if (recoveredTitle) {
            carrier.fields.title.value = recoveredTitle;
            carrier.fields.publisher.value = aliasSpillPublisher.groups.alias;
          }
        }
        carrier.healthEvidence = applied.healthEvidence;
        carrier.extractionMeta = applied.extractionMeta;
        if (prebuildCandidateEnvelope) {
          carrier.candidateEnvelope = buildCandidateEnvelopeFromExtractionArtifacts({
            fields: carrier.fields,
            fieldConfidences: applied.extractionMeta.fieldConfidences,
            healthSpans: applied.healthEvidence.spans,
            runMode: applied.extractionMeta.runMode,
            ...(applied.extractionMeta.entities ? { entities: applied.extractionMeta.entities } : {}),
          });
        } else {
          delete carrier.candidateEnvelope;
        }
        syncFieldUncertainty(carrier.fields);

        const status = applied.extractionMeta.mlError || applied.extractionMeta.runMode === 'shadow' || applied.healthEvidence.parserWarnings.length > 0
          ? 'warning'
          : 'success';
        if (status === 'warning') warningCount += 1;
        if (applied.extractionMeta.runMode === 'heuristic' && applied.extractionMeta.mlError) {
          this.phase4Runtime?.recordFallback(applied.extractionMeta.mlError.code.toLowerCase());
        }

        if (captureCarrierDiagnostics) {
          carrier.stageLog.push(
            stageRecord({
              phaseId: this.phaseId,
              status,
              durationMs: 0,
              ...(applied.extractionMeta.mlError ? { code: ErrorCode.EXTRACT_ML_UNAVAILABLE } : {}),
              message: buildCarrierMessage(applied.extractionMeta, plan.reason),
              details: {
                routePath: plan.path,
                reason: plan.reason,
                modelVersion: applied.extractionMeta.modelVersion,
                featureVersion: applied.extractionMeta.featureVersion,
                warningCodes: carrier.healthEvidence.parserWarnings,
                uncertainFields: applied.extractionMeta.uncertainFields,
                validSpanFields: carrier.healthEvidence.validSpanFields,
                invalidSpanFields: carrier.healthEvidence.invalidSpanFields,
                candidateRecallAllMatch: applied.extractionMeta.candidateRecallShadow?.allMatch ?? null,
                candidateRecallMismatches: applied.extractionMeta.candidateRecallShadow
                  ? Object.entries(applied.extractionMeta.candidateRecallShadow.fields)
                    .filter(([, entry]) => !entry.matches)
                    .map(([field]) => field)
                  : [],
              },
            }),
          );
        }
      } catch (error) {
        warningCount += 1;
        const fallbackMeta = buildExtractionMeta(heuristic.prediction, 'heuristic', {
          mlError: toExtractionMetaError(error),
          ...(heuristic.candidateRecallShadow
            ? { candidateRecallShadow: heuristic.candidateRecallShadow }
            : {}),
        });
        carrier.fields = mergeExtractedFields(carrier.fields, heuristic.prediction, 'regex_fallback');
        carrier.partialData = structuredClone(carrier.fields);
        carrier.healthEvidence = buildHealthEvidence(heuristic.prediction);
        carrier.extractionMeta = fallbackMeta;
        if (prebuildCandidateEnvelope) {
          carrier.candidateEnvelope = buildCandidateEnvelopeFromExtractionArtifacts({
            fields: carrier.fields,
            fieldConfidences: fallbackMeta.fieldConfidences,
            healthSpans: carrier.healthEvidence.spans,
            runMode: fallbackMeta.runMode,
            ...(fallbackMeta.entities ? { entities: fallbackMeta.entities } : {}),
          });
        } else {
          delete carrier.candidateEnvelope;
        }
        syncFieldUncertainty(carrier.fields);

        if (captureCarrierDiagnostics) {
          carrier.stageLog.push(
            stageRecord({
              phaseId: this.phaseId,
              status: 'warning',
              durationMs: 0,
              code: ErrorCode.EXTRACT_PARSE_FAILED,
              message: 'Extraction degraded to heuristic evidence after an unexpected error.',
              details: {
                modelVersion: fallbackMeta.modelVersion,
                candidateRecallAllMatch: fallbackMeta.candidateRecallShadow?.allMatch ?? null,
                candidateRecallMismatches: fallbackMeta.candidateRecallShadow
                  ? Object.entries(fallbackMeta.candidateRecallShadow.fields)
                    .filter(([, entry]) => !entry.matches)
                    .map(([field]) => field)
                  : [],
              },
            }),
          );
        }
      }
    }

    propagateSharedIdentifierFields(carriers);
    recoverConferenceTitlesFromRaw(carriers);
    backfillConferenceTitlesFromSiblings(carriers);
    recoverConferencePublishersFromRaw(carriers);
    backfillConferencePublishersFromSiblings(carriers);
    propagateConferenceTitlesFromSiblingsFinal(carriers);
    backfillConferencePublishersFromRawGroups(carriers);
    propagateExistingConferencePublishersFromSiblings(carriers);
    restoreConferencePublisherPreviousValues(carriers);
    forceRestoreConferencePublisherPreviousValues(carriers);
    for (const carrier of carriers) {
      sanitizeConferenceTitleAfterPropagation(carrier);
    }
    const siblingConferencePublisherByGroup = new Map<string, ExtractedFields['publisher']>();
    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;
      const key = getPropagationGroupKey(carrier);
      if (!key) continue;
      if (typeof carrier.fields.publisher.value !== 'string' || carrier.fields.publisher.value.trim().length === 0) {
        continue;
      }
      const existing = siblingConferencePublisherByGroup.get(key);
      if (
        !existing
        || conferencePublisherPropagationScore(carrier.fields.publisher.value, carrier.fields.publisher.confidence)
          > conferencePublisherPropagationScore(existing.value, existing.confidence)
      ) {
        siblingConferencePublisherByGroup.set(key, carrier.fields.publisher);
      }
    }
    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;
      const key = getPropagationGroupKey(carrier);
      if (!key) continue;
      const sibling = siblingConferencePublisherByGroup.get(key);
      if (!sibling) continue;
      if (hasFieldValue(carrier.fields.publisher)) continue;
      if (!hasFieldValue(carrier.fields.conferenceTitle)) continue;

      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          sibling.value,
          sibling.source,
          STAGE_ID,
          Math.max(0.74, sibling.confidence - 0.02),
          {
            origin: sibling.origin,
            previousValue: carrier.fields.publisher.value,
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }

    for (const carrier of carriers) {
      const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      if (hasFieldValue(carrier.fields.publisher)) {
        continue;
      }

      const recoveredNumericConference = recoverStrongNumericConferencePublisherTail(carrier.raw);
      if (!recoveredNumericConference?.publisher) {
        continue;
      }
      const doiConferenceTitleHint = recoverConferenceTitleFromDoiHint(
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
        typeof carrier.fields.year.value === 'number'
          ? carrier.fields.year.value
          : recoveredNumericConference.year,
      );
      const publisherActsLikeRenderedPublisher =
        looksPublisherLike(recoveredNumericConference.publisher)
        || looksConferencePublisherOrganization(recoveredNumericConference.publisher)
        || looksCompactConferenceVenueAlias(recoveredNumericConference.publisher);
      const shouldRecoverWeakConferenceTail =
        Boolean(doiConferenceTitleHint)
        || (
          !currentConferenceTitle
          && publisherActsLikeRenderedPublisher
        )
        || looksCompactConferenceVenueAlias(currentConferenceTitle)
        || (
          publisherActsLikeRenderedPublisher
          && normalizeComparableText(currentConferenceTitle)
            === normalizeComparableText(recoveredNumericConference.publisher)
        );
      if (!shouldRecoverWeakConferenceTail) {
        continue;
      }
      const shouldKeepCompactConferenceAlias =
        currentConferenceTitle.length > 0
        && normalizeComparableText(currentConferenceTitle)
          !== normalizeComparableText(recoveredNumericConference.publisher);

      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          recoveredNumericConference.publisher,
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          Math.max(0.74, carrier.fields.conferenceTitle.confidence),
          {
            origin: carrier.fields.conferenceTitle.origin,
            previousValue: carrier.fields.publisher.value,
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          doiConferenceTitleHint ?? (shouldKeepCompactConferenceAlias ? currentConferenceTitle : null),
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          doiConferenceTitleHint || shouldKeepCompactConferenceAlias
            ? Math.max(0.74, carrier.fields.conferenceTitle.confidence)
            : 0,
          {
            origin: carrier.fields.conferenceTitle.origin,
            uncertain: true,
            previousValue: carrier.fields.conferenceTitle.value,
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
          },
          ) as ExtractedFields['conferenceTitle'],
      );
      if (
        recoveredNumericConference.publisher
        && (
          looksPublisherLike(recoveredNumericConference.publisher)
          || looksConferencePublisherOrganization(recoveredNumericConference.publisher)
          || looksCompactConferenceVenueAlias(recoveredNumericConference.publisher)
          || looksConferenceContainer(recoveredNumericConference.publisher)
        )
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            recoveredNumericConference.publisher,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.76, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
      if (recoveredNumericConference.title) {
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            recoveredNumericConference.title,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.76, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value,
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }
      if (recoveredNumericConference.pages) {
        setExtractedField(
          carrier.fields,
          'pages',
          fieldOf(
            recoveredNumericConference.pages,
            carrier.fields.pages.source,
            STAGE_ID,
            Math.max(0.74, carrier.fields.pages.confidence),
            {
              origin: carrier.fields.pages.origin,
              previousValue: carrier.fields.pages.value,
              previousSource: carrier.fields.pages.source,
              previousOrigin: carrier.fields.pages.origin,
            },
          ) as ExtractedFields['pages'],
        );
      }
    }

    for (const carrier of carriers) {
      const doiConferenceTitleHint = recoverConferenceTitleFromDoiHint(
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
        typeof carrier.fields.year.value === 'number' ? carrier.fields.year.value : undefined,
      );
      if (!doiConferenceTitleHint) {
        continue;
      }

      const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      const currentPublisher = typeof carrier.fields.publisher.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.publisher.value)
        : '';
      const normalizedHintWithoutYear = normalizeComparableText(
        doiConferenceTitleHint.replace(/^(?:19|20)\d{2}\s+/u, ''),
      );
      if (
        currentConferenceTitle
        && !looksCompactConferenceVenueAlias(currentConferenceTitle)
        && normalizeComparableText(currentConferenceTitle) !== normalizeComparableText(currentPublisher)
        && normalizeComparableText(currentConferenceTitle) !== normalizedHintWithoutYear
      ) {
        continue;
      }

      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          doiConferenceTitleHint,
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          Math.max(0.76, carrier.fields.conferenceTitle.confidence),
          {
            origin: carrier.fields.conferenceTitle.origin,
            previousValue: carrier.fields.conferenceTitle.value,
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
          },
          ) as ExtractedFields['conferenceTitle'],
      );

      const recoveredNumericConference = recoverStrongNumericConferencePublisherTail(carrier.raw);
      const recoveredPublisher =
        recoveredNumericConference?.publisher
        ?? recoverExplicitConferencePublisherFromRaw(
          carrier.raw,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
          doiConferenceTitleHint,
          typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
        );
      if (recoveredPublisher) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            recoveredPublisher,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.76, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      } else if (
        currentPublisher
        && !looksPublisherLike(currentPublisher)
        && !looksConferencePublisherOrganization(currentPublisher)
        && !looksCompactConferenceVenueAlias(currentPublisher)
        && !looksConferenceContainer(currentPublisher)
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            null,
            carrier.fields.publisher.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.publisher.origin,
              uncertain: true,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }

      const updatedPublisher = typeof carrier.fields.publisher.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.publisher.value)
        : '';
      const explicitConferencePublisher = recoverExplicitConferencePublisherFromRaw(
        carrier.raw,
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        doiConferenceTitleHint,
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
      );
      if (
        updatedPublisher
        && (
          looksInstitutionalContainer(updatedPublisher)
          || looksStandaloneInstitutionalAlias(updatedPublisher)
        )
        && !looksPublisherLike(updatedPublisher)
        && !looksConferencePublisherOrganization(updatedPublisher)
        && !looksCompactConferenceVenueAlias(updatedPublisher)
        && (
          !explicitConferencePublisher
          || normalizeComparableText(explicitConferencePublisher) !== normalizeComparableText(updatedPublisher)
        )
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            null,
            carrier.fields.publisher.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.publisher.origin,
              uncertain: true,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
        if (
          typeof carrier.fields.institution.value === 'string'
          && normalizeComparableText(carrier.fields.institution.value) === normalizeComparableText(updatedPublisher)
        ) {
          setExtractedField(
            carrier.fields,
            'institution',
            fieldOf(
              null,
              carrier.fields.institution.source,
              STAGE_ID,
              0,
              {
                origin: carrier.fields.institution.origin,
                uncertain: true,
                previousValue: carrier.fields.institution.value,
                previousSource: carrier.fields.institution.source,
                previousOrigin: carrier.fields.institution.origin,
              },
            ) as ExtractedFields['institution'],
          );
        }
      }

      if (
        typeof carrier.fields.journal.value === 'string'
        && normalizeComparableText(carrier.fields.journal.value) === normalizeComparableText(doiConferenceTitleHint)
      ) {
        setExtractedField(
          carrier.fields,
          'journal',
          fieldOf(
            null,
            carrier.fields.journal.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.journal.origin,
              uncertain: true,
              previousValue: carrier.fields.journal.value,
              previousSource: carrier.fields.journal.source,
              previousOrigin: carrier.fields.journal.origin,
            },
          ) as ExtractedFields['journal'],
        );
      }
    }

    for (const carrier of carriers) {
      const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      const publisher = typeof carrier.fields.publisher.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.publisher.value)
        : '';
      const doiPublisherHint = inferPublisherFromDoiHint(
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
      );
      const explicitConferencePublisher = recoverExplicitConferencePublisherFromRaw(
        carrier.raw,
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        conferenceTitle || null,
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
      );
      const institution = typeof carrier.fields.institution.value === 'string'
        ? normalizeInstitutionCandidate(carrier.fields.institution.value)
        : null;
      if (!conferenceTitle || isConferencePlaceholder(conferenceTitle) || !looksConferencePublicationVenue(conferenceTitle)) {
        continue;
      }
      if (
        publisher
        && (
          looksInstitutionalContainer(publisher)
          || looksStandaloneInstitutionalAlias(publisher)
        )
        && !looksPublisherLike(publisher)
        && !looksConferencePublisherOrganization(publisher)
        && !looksCompactConferenceVenueAlias(publisher)
        && !looksConferenceContainer(publisher)
        && (!doiPublisherHint || normalizeComparableText(doiPublisherHint) !== normalizeComparableText(publisher))
        && (
          !explicitConferencePublisher
          || normalizeComparableText(explicitConferencePublisher) !== normalizeComparableText(publisher)
        )
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            null,
            carrier.fields.publisher.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.publisher.origin,
              uncertain: true,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
        if (
          institution
          && normalizeComparableText(institution).endsWith(normalizeComparableText(publisher))
        ) {
          setExtractedField(
            carrier.fields,
            'institution',
            fieldOf(
              null,
              carrier.fields.institution.source,
              STAGE_ID,
              0,
              {
                origin: carrier.fields.institution.origin,
                uncertain: true,
                previousValue: carrier.fields.institution.value,
                previousSource: carrier.fields.institution.source,
                previousOrigin: carrier.fields.institution.origin,
              },
            ) as ExtractedFields['institution'],
          );
        }
      }
    }

    for (const carrier of carriers) {
      const institution = typeof carrier.fields.institution.value === 'string'
        ? carrier.fields.institution.value
        : undefined;
      const url = typeof carrier.fields.url.value === 'string'
        ? carrier.fields.url.value
        : undefined;
      if (!institution || !url || isDoiUrl(url) || typeof carrier.fields.siteName.value === 'string') {
        continue;
      }
      const recoveredOwnerSiteWebpage = recoverAuthorDateOwnerSiteWebpageFromRaw(
        carrier.raw,
        institution,
      );
      if (!recoveredOwnerSiteWebpage) {
        continue;
      }

      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          recoveredOwnerSiteWebpage.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.76, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value,
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
      setExtractedField(
        carrier.fields,
        'siteName',
        fieldOf(
          recoveredOwnerSiteWebpage.siteName,
          carrier.fields.siteName.source,
          STAGE_ID,
          Math.max(0.76, carrier.fields.siteName.confidence),
          {
            origin: carrier.fields.siteName.origin,
            previousValue: carrier.fields.siteName.value,
            previousSource: carrier.fields.siteName.source,
            previousOrigin: carrier.fields.siteName.origin,
          },
        ) as ExtractedFields['siteName'],
      );
      setExtractedField(
        carrier.fields,
        'institution',
        fieldOf(
          recoveredOwnerSiteWebpage.institution,
          carrier.fields.institution.source,
          STAGE_ID,
          Math.max(0.76, carrier.fields.institution.confidence),
          {
            origin: carrier.fields.institution.origin,
            previousValue: carrier.fields.institution.value,
            previousSource: carrier.fields.institution.source,
            previousOrigin: carrier.fields.institution.origin,
          },
        ) as ExtractedFields['institution'],
      );
    }

    const bestSiblingAuthors = new Map<string, ExtractedFields['authors']>();
    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;
      const key = getPropagationGroupKey(carrier);
      if (!key) continue;
      const authors = carrier.fields.authors;
      if (!Array.isArray(authors.value) || authors.value.length < 2) continue;
      if (isLowQualityPropagationValue('authors', authors.value)) continue;

      const existing = bestSiblingAuthors.get(key);
      if (
        !existing
        || (Array.isArray(existing.value) && authors.value.length > existing.value.length)
        || authors.confidence > existing.confidence + 0.04
      ) {
        bestSiblingAuthors.set(key, authors);
      }
    }

    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;
      const key = getPropagationGroupKey(carrier);
      if (!key) continue;
      const best = bestSiblingAuthors.get(key);
      if (!best || !Array.isArray(best.value) || best.value.length < 2) continue;

      const currentAuthors = carrier.fields.authors.value;
      const currentCount = Array.isArray(currentAuthors) ? currentAuthors.length : 0;
      const shouldPromoteAuthors =
        /\bet al\.?\b/iu.test(carrier.raw)
        || currentCount === 0
        || currentCount === 1
        || currentAuthors.some((author) => /,/.test(author.family ?? author.literal ?? ''));

      if (!shouldPromoteAuthors || currentCount >= best.value.length) {
        continue;
      }

      setExtractedField(
        carrier.fields,
        'authors',
        fieldOf(
          best.value,
          best.source,
          STAGE_ID,
          Math.max(0.74, best.confidence - 0.02),
          {
            origin: best.origin,
            previousValue: carrier.fields.authors.value,
            previousSource: carrier.fields.authors.source,
            previousOrigin: carrier.fields.authors.origin,
          },
        ) as ExtractedFields['authors'],
      );
    }

    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;

      const cleanedPublisher = typeof carrier.fields.publisher.value === 'string'
        ? normalizePropagationPublisherProxy(
          restorePublisherLegalSuffixFromRaw(carrier.raw, carrier.fields.publisher.value),
          carrier.raw,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        )
        : null;
      const originalPublisher = typeof carrier.fields.publisher.value === 'string'
        ? restorePublisherLegalSuffixFromRaw(carrier.raw, carrier.fields.publisher.value)
        : null;
      const finalPublisher = originalPublisher && /^©\s*/u.test(originalPublisher)
        ? originalPublisher
        : (cleanedPublisher ?? originalPublisher);
      if (
        typeof carrier.fields.publisher.value === 'string'
        && (
          !finalPublisher
          || finalPublisher !== carrier.fields.publisher.value
        )
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            finalPublisher,
            carrier.fields.publisher.source,
            STAGE_ID,
            finalPublisher ? carrier.fields.publisher.confidence : 0,
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
              ...(finalPublisher ? {} : { uncertain: true }),
            },
          ) as ExtractedFields['publisher'],
        );
      }

      const cleanedConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : null;
      const publisherAfterCleanup = typeof carrier.fields.publisher.value === 'string'
        ? carrier.fields.publisher.value
        : null;
      const explicitConferencePublisher = recoverExplicitConferencePublisherFromRaw(
        carrier.raw,
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        cleanedConferenceTitle,
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
      );
      const doiPublisherHint = inferPublisherFromDoiHint(
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
      );
      if (!publisherAfterCleanup && (cleanedConferenceTitle || explicitConferencePublisher || doiPublisherHint)) {
        const recoveredConferencePublisher = explicitConferencePublisher ?? doiPublisherHint;
        if (!recoveredConferencePublisher) {
          continue;
        }
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            recoveredConferencePublisher,
            explicitConferencePublisher ? carrier.fields.title.source : carrier.fields.doi.source,
            STAGE_ID,
            explicitConferencePublisher
              ? Math.max(0.76, carrier.fields.title.confidence - 0.04)
              : Math.max(0.76, carrier.fields.doi.confidence - 0.08),
            {
              origin: explicitConferencePublisher ? carrier.fields.title.origin : carrier.fields.doi.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
      const publisherAfterHint = typeof carrier.fields.publisher.value === 'string'
        ? carrier.fields.publisher.value
        : null;
      if (
        cleanedConferenceTitle
        && publisherAfterHint
        && hasFieldValue(carrier.fields.pages)
        && looksJournalLikeContainer(publisherAfterHint)
        && !looksPublisherLike(publisherAfterHint)
        && !looksInstitutionalContainer(publisherAfterHint)
        && (
          looksCompactConferenceVenueAlias(cleanedConferenceTitle)
          || normalizeComparableText(cleanedConferenceTitle) === normalizeComparableText(publisherAfterHint)
        )
      ) {
        setExtractedField(
          carrier.fields,
          'journal',
          fieldOf(
            normalizeJournalCandidate(publisherAfterHint, typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null) ?? publisherAfterHint,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.journal.value,
              previousSource: carrier.fields.journal.source,
              previousOrigin: carrier.fields.journal.origin,
            },
          ) as ExtractedFields['journal'],
        );
        setExtractedField(
          carrier.fields,
          'conferenceTitle',
          fieldOf(
            null,
            carrier.fields.conferenceTitle.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.conferenceTitle.origin,
              previousValue: carrier.fields.conferenceTitle.value,
              previousSource: carrier.fields.conferenceTitle.source,
              previousOrigin: carrier.fields.conferenceTitle.origin,
              uncertain: true,
            },
          ) as ExtractedFields['conferenceTitle'],
        );
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            null,
            carrier.fields.publisher.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
              uncertain: true,
            },
          ) as ExtractedFields['publisher'],
        );
      }

      if (shouldSuppressMirroredCorporateOwnerAuthor(carrier.fields, carrier.raw)) {
        setExtractedField(
          carrier.fields,
          'authors',
          fieldOf(
            [],
            carrier.fields.authors.source,
            STAGE_ID,
            0.82,
            {
              origin: carrier.fields.authors.origin,
              previousValue: carrier.fields.authors.value,
              previousSource: carrier.fields.authors.source,
              previousOrigin: carrier.fields.authors.origin,
            },
          ) as ExtractedFields['authors'],
        );
      }
    }

    propagateTitlesFromSiblingsFinal(carriers);
    finalizeConferenceFieldSanity(carriers);
    repairConferenceSiblingGroups(carriers);
    propagateConferenceTitlesFromSiblingsFinal(carriers);
    propagateTitlesFromSiblingsFinal(carriers);
    propagateExistingConferencePublishersFromSiblings(carriers);
    stripPublisherQuoteArtifacts(carriers);

    // Some late conference/institution cleanup passes intentionally null out
    // publisher while preserving the recovered value in previousValue. Restore
    // that publisher here so the final phase output reflects the best
    // conference+publisher pair after all rewrites have settled.
    forceRestoreConferencePublisherPreviousValues(carriers);
    restoreFinalConferenceAndPublisherRepairs(carriers);
    repairConferenceSiblingGroups(carriers);
    propagateConferenceTitlesFromSiblingsFinal(carriers);
    propagateExistingConferencePublishersFromSiblings(carriers);
    repairCarrierArticlePublisherSpills(carriers);
    repairConferenceDoiFastPathSpills(carriers);
    applyLateFieldRoutingRepairs(carriers);
    repairDecimalConferenceTitlePublisherSplits(carriers);
    repairDecimalTitleContinuationsFromPublisherHistory(carriers);
     preferExplicitRawConferencePublishers(carriers);
     enforceDoiConferenceTitleHints(carriers);
     stripPublisherQuoteArtifacts(carriers);
     restoreExplicitPublisherOverridesAfterDoiHints(carriers);
     cleanupWebpageContainerEchoes(carriers);
     repairExplicitOwnerSiteWebpages(carriers);
     cleanupFinalArticleLocatorSpills(carriers);
     repairSingleTokenConferenceArticleSpills(carriers);
     repairFinalDecimalTitles(carriers);
     repairFinalQuotedNumericConferencePublisherTails(carriers);
     enforceFinalRepeatedInstitutionalOwnerReports(carriers);
     repairFinalRawLeadRecoveries(carriers);
     cleanupFinalArticleLocatorSpills(carriers);

     ctx.stageLog.push(
       stageRecord({
        phaseId: this.phaseId,
        status: warningCount > 0 || mlFailureCount > 0 ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        ...(mlFailureCount > 0 ? { code: ErrorCode.EXTRACT_ML_UNAVAILABLE } : {}),
        message: `Phase 4 extraction completed (heuristic=${heuristicCount}, shadow=${shadowCount}, primary=${primaryCount}, mlFailures=${mlFailureCount}).`,
        details: {
          mode: routingConfig.mode,
          extractionMl: ctx.executionPolicy.extractionMl,
          primaryCount,
          shadowCount,
          heuristicCount,
          mlFailureCount,
          activeModelVersion: health?.activeModelVersion ?? null,
          featureVersion: health?.featureVersion ?? null,
        },
      }),
    );

    for (const carrier of carriers) {
      if (carrier.doiFastPath) continue;
      reconcileExplicitIssue(carrier);
    }

    return carriers;
  }

  private async resolveMlPredictions(
    carriers: ReferenceCarrier[],
    plans: Map<string, Phase4SelectionPlan>,
    ctx: PipelineContext,
  ): Promise<Map<string, MlResolution>> {
    const resolutions = new Map<string, MlResolution>();
    if (!this.phase4Runtime || carriers.length === 0) return resolutions;

    await this.collectMlResolutions(
      'primary',
      carriers.filter((carrier) => plans.get(carrier.id)?.path === 'primary'),
      resolutions,
      ctx,
    );
    await this.collectMlResolutions(
      'shadow',
      carriers.filter((carrier) => plans.get(carrier.id)?.path === 'shadow'),
      resolutions,
      ctx,
    );

    return resolutions;
  }

  private async collectMlResolutions(
    mode: Phase4RequestMode,
    carriers: ReferenceCarrier[],
    resolutions: Map<string, MlResolution>,
    ctx: PipelineContext,
  ): Promise<void> {
    if (!this.phase4Runtime || carriers.length === 0) return;

    const dedupedRequests = dedupePhase4MlRequests(carriers);
    const sharedCache = getPhase4MlSharedCache(ctx, mode);
    const newRequests: Array<Phase4MlDedupedRequest & { deferred: Deferred<Phase4MlCachedResolution | null> }> = [];
    const applications: Array<{
      carriers: ReferenceCarrier[];
      resolution: Promise<Phase4MlCachedResolution | null>;
    }> = [];

    for (const request of dedupedRequests) {
      const existing = sharedCache.get(request.cacheKey);
      if (existing) {
        applications.push({
          carriers: request.carriers,
          resolution: existing,
        });
        continue;
      }

      const deferred = createDeferred<Phase4MlCachedResolution | null>();
      sharedCache.set(request.cacheKey, deferred.promise);
      newRequests.push({
        ...request,
        deferred,
      });
      applications.push({
        carriers: request.carriers,
        resolution: deferred.promise,
      });
    }

    for (const batch of chunk(newRequests, MAX_ML_BATCH_ITEMS)) {
      const attempt = await this.phase4Runtime.extract(
        mode,
        batch.map((request) => request.raw),
        batch.map((request) => request.styleHint),
      );

      if (attempt.response) {
        const errorByIndex = new Map((attempt.response.errors ?? []).map((error) => [error.index, error]));

        for (let index = 0; index < batch.length; index += 1) {
          const request = batch[index];
          if (!request) continue;

          const prediction = attempt.response.results[index] ?? undefined;
          const batchError = errorByIndex.get(index);

          if (prediction) {
            request.deferred.resolve({ prediction });
          } else if (batchError) {
            request.deferred.resolve({ error: toBatchError(batchError, attempt.health) });
          } else {
            request.deferred.resolve({
              error: {
                code: 'INTERNAL_ERROR',
                message: 'ML service returned a null result for this citation.',
              },
            });
          }
        }
        continue;
      }

      if (mode === 'shadow' && !attempt.attempted) {
        for (const request of batch) {
          request.deferred.resolve(null);
        }
        continue;
      }

      if (!attempt.error) {
        for (const request of batch) {
          request.deferred.resolve(null);
        }
        continue;
      }

      for (const request of batch) {
        request.deferred.resolve({ error: toExtractionMetaError(attempt.error, attempt.health) });
      }
    }

    for (const application of applications) {
      const cached = await application.resolution;
      if (!cached) continue;
      for (const carrier of application.carriers) {
        resolutions.set(carrier.id, cached.prediction
          ? { result: sanitizePrediction(cached.prediction, carrier) }
          : { error: cached.error! });
      }
    }
  }
}

export const phase4Extract = new Phase4Extract();

const phase4MlSharedCaches = new WeakMap<
  PipelineContext,
  Map<string, Promise<Phase4MlCachedResolution | null>>
>();

interface Phase4MlDedupedRequest {
  cacheKey: string;
  raw: string;
  styleHint: CitationStyle;
  carriers: ReferenceCarrier[];
}

interface Phase4MlCachedResolution {
  prediction?: ExtractResult;
  error?: ExtractionMetaError;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function getPhase4MlSharedCache(
  ctx: PipelineContext,
  mode: Phase4RequestMode,
): Map<string, Promise<Phase4MlCachedResolution | null>> {
  let cache = phase4MlSharedCaches.get(ctx);
  if (!cache) {
    cache = new Map();
    phase4MlSharedCaches.set(ctx, cache);
  }
  const modeCache = new Map<string, Promise<Phase4MlCachedResolution | null>>();
  modeCache.get = (key: string) => cache.get(`${mode}\u0000${key}`);
  modeCache.set = (key: string, value: Promise<Phase4MlCachedResolution | null>) => {
    cache.set(`${mode}\u0000${key}`, value);
    return modeCache;
  };
  return modeCache;
}

function dedupePhase4MlRequests(carriers: ReferenceCarrier[]): Phase4MlDedupedRequest[] {
  const byKey = new Map<string, Phase4MlDedupedRequest>();

  for (const carrier of carriers) {
    const styleHint = getPhase4MlStyleHint(carrier);
    const key = `${styleHint}\u0000${normalizePhase4MlDedupKey(carrier.raw)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.carriers.push(carrier);
      continue;
    }

    byKey.set(key, {
      cacheKey: key,
      raw: carrier.raw,
      styleHint,
      carriers: [carrier],
    });
  }

  return [...byKey.values()];
}

function normalizePhase4MlDedupKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function applyPhase4Selection(
  carrier: ReferenceCarrier,
  heuristic: ExtractResult,
  candidateRecallShadow: CitationFeatureRecallShadow | undefined,
  resolution: MlResolution | undefined,
  plan: Phase4SelectionPlan,
  health: MLHealthResponse | null,
): {
  fields: ExtractedFields;
  healthEvidence: ReferenceCarrier['healthEvidence'];
  extractionMeta: ExtractionMeta;
} {
  const mlPrediction = resolution?.result;
  const mlError = resolution?.error;

  if (plan.path === 'primary' && mlPrediction) {
    const heuristicFields = mergeExtractedFields(carrier.fields, heuristic, 'regex_fallback');
    if (hasBlockingPrimaryMlBioDiagnostic(mlPrediction)) {
      return buildPrimaryMlHeuristicFallback(
        carrier,
        heuristic,
        heuristicFields,
        mlPrediction,
        candidateRecallShadow,
      );
    }

    const selectivePatch = buildPrimaryMlPatchPrediction(heuristic, mlPrediction, carrier.raw);
    const hasSelectivePatch = hasExtractResultValues(selectivePatch);

    if (!hasSelectivePatch) {
      return buildPrimaryMlHeuristicFallback(
        carrier,
        heuristic,
        heuristicFields,
        mlPrediction,
        candidateRecallShadow,
      );
    }

    const patchedFields = mergeExtractedFields(heuristicFields, selectivePatch, 'ml_extraction');
    const mergedHealthEvidence = mergeHealthEvidence(
      buildHealthEvidence(heuristic),
      buildHealthEvidence({
        ...selectivePatch,
        ...(mlPrediction.bio ? { bio: mlPrediction.bio } : {}),
      }),
    );

    return {
      fields: patchedFields,
      healthEvidence: mergedHealthEvidence,
      extractionMeta: buildExtractionMeta(selectivePatch, 'ml', {
        modelVersion: mlPrediction.modelVersion ?? null,
        featureVersion: mlPrediction.featureVersion ?? null,
        styleUsed: mlPrediction.styleUsed || normalizeStyleFamily(carrier.style.family),
        fieldConfidences: {
          ...heuristic.fieldConfidences,
          ...selectivePatch.fieldConfidences,
        },
        uncertainFields: [...new Set([
          ...heuristic.uncertainFields,
          ...selectivePatch.uncertainFields,
        ])],
        ...(mlPrediction.bio ? { bio: mlPrediction.bio } : {}),
        shadowDiff: buildShadowDiff(heuristic.fields, selectivePatch.fields),
        ...(candidateRecallShadow ? { candidateRecallShadow } : {}),
      }),
    };
  }

  if (plan.path === 'shadow') {
    if (!resolution) {
      return {
        fields: mergeExtractedFields(carrier.fields, heuristic, 'regex_fallback'),
        healthEvidence: buildHealthEvidence(heuristic),
        extractionMeta: buildExtractionMeta(heuristic, 'heuristic', {
          ...(candidateRecallShadow ? { candidateRecallShadow } : {}),
        }),
      };
    }

    return {
      fields: mergeExtractedFields(carrier.fields, heuristic, 'regex_fallback'),
      healthEvidence: buildHealthEvidence(heuristic),
      extractionMeta: mlPrediction
        ? buildExtractionMeta(mlPrediction, 'shadow', {
          shadowDiff: buildShadowDiff(heuristic.fields, mlPrediction.fields),
          ...(candidateRecallShadow ? { candidateRecallShadow } : {}),
        })
        : buildExtractionMeta(heuristic, 'shadow', {
          modelVersion: health?.activeModelVersion ?? null,
          featureVersion: health?.featureVersion ?? null,
          styleUsed: normalizeStyleFamily(carrier.style.family),
          overallConfidence: null,
          fieldConfidences: {},
          uncertainFields: [],
          entities: [],
          ...(candidateRecallShadow ? { candidateRecallShadow } : {}),
          mlError: mlError ?? {
            code: 'MODEL_UNAVAILABLE',
            message: 'ML shadow extraction was unavailable for this citation.',
          },
        }),
    };
  }

  return {
    fields: mergeExtractedFields(carrier.fields, heuristic, 'regex_fallback'),
    healthEvidence: buildHealthEvidence(heuristic),
    extractionMeta: buildExtractionMeta(heuristic, 'heuristic', {
      ...(candidateRecallShadow ? { candidateRecallShadow } : {}),
      ...(mlError ? { mlError } : {}),
    }),
  };
}

function selectPlanForCarrier(
  carrier: ReferenceCarrier,
  config: Phase4RoutingConfig,
  activeModelVersion: string,
): Phase4SelectionPlan {
  const style = getPhase4MlStyleHint(carrier);
  if (ML_BYPASS_STYLES.has(style)) {
    return { path: 'heuristic', shouldAttemptMl: false, reason: 'unsupported_style_bypass' };
  }
  if (!ML_SUPPORTED_STYLES.has(style)) {
    return { path: 'heuristic', shouldAttemptMl: false, reason: 'unsupported_style' };
  }
  if (carrier.detection?.splitQualityFlag === 'low' && carrier.detection.confidence < 0.60) {
    return { path: 'heuristic', shouldAttemptMl: false, reason: 'detection_uncertainty_bypass' };
  }
  if (config.mode === 'heuristic') {
    return { path: 'heuristic', shouldAttemptMl: false, reason: 'heuristic_mode' };
  }

  const bucket = deterministicBucket(carrier.raw, activeModelVersion);

  if (config.mode === 'shadow') {
    if (bucket <= config.shadowFraction) {
      return { path: 'shadow', shouldAttemptMl: true, reason: 'shadow_fraction' };
    }
    return { path: 'heuristic', shouldAttemptMl: false, reason: 'shadow_fraction_skip' };
  }

  if (bucket <= config.primaryFraction) {
    return { path: 'primary', shouldAttemptMl: true, reason: 'primary_fraction' };
  }
  if (bucket <= config.shadowFraction) {
    return { path: 'shadow', shouldAttemptMl: true, reason: 'shadow_fraction' };
  }
  return { path: 'heuristic', shouldAttemptMl: false, reason: 'primary_fraction_skip' };
}

function normalizeRoutingConfigForPipeline(
  config: Phase4RoutingConfig,
  ctx: PipelineContext,
): Phase4RoutingConfig {
  if (
    config.mode !== 'primary'
    || ctx.options.debug
    || ctx.executionPolicy.debugMode === 'full'
  ) {
    return config;
  }

  return {
    ...config,
    shadowFraction: Math.min(config.shadowFraction, config.primaryFraction),
  };
}

function buildPrimaryMlHeuristicFallback(
  carrier: ReferenceCarrier,
  heuristic: ExtractResult,
  heuristicFields: ExtractedFields,
  mlPrediction: ExtractResult,
  candidateRecallShadow: CitationFeatureRecallShadow | undefined,
): {
  fields: ExtractedFields;
  healthEvidence: ReferenceCarrier['healthEvidence'];
  extractionMeta: ExtractionMeta;
} {
  const heuristicHealth = buildHealthEvidence(heuristic);
  const mlHealth = buildHealthEvidence(mlPrediction);
  return {
    fields: heuristicFields,
    healthEvidence: mergeMlDiagnosticsIntoHeuristicHealth(heuristicHealth, mlHealth),
    extractionMeta: buildExtractionMeta(heuristic, 'heuristic', {
      modelVersion: mlPrediction.modelVersion ?? null,
      featureVersion: mlPrediction.featureVersion ?? null,
      styleUsed: mlPrediction.styleUsed || normalizeStyleFamily(carrier.style.family),
      ...(mlPrediction.bio ? { bio: mlPrediction.bio } : {}),
      ...(mlPrediction.entities ? { entities: structuredClone(mlPrediction.entities) } : {}),
      shadowDiff: buildShadowDiff(heuristic.fields, mlPrediction.fields),
      ...(candidateRecallShadow ? { candidateRecallShadow } : {}),
    }),
  };
}

function hasBlockingPrimaryMlBioDiagnostic(prediction: ExtractResult): boolean {
  return prediction.bio?.diagnostics?.some((diagnostic) => (
    diagnostic.code === 'unclosed_bio_sequence'
    || diagnostic.code === 'overlapping_spans'
  )) ?? false;
}

function sanitizePrediction(prediction: ExtractResult, carrier: ReferenceCarrier): ExtractResult {
  const fields = Object.fromEntries(
    Object.entries(prediction.fields ?? {}).filter(([key]) => isExtractedFieldKey(key)),
  ) as ExtractResult['fields'];
  const fieldConfidences = Object.fromEntries(
    Object.entries(prediction.fieldConfidences ?? {}).filter(([key]) => isExtractedFieldKey(key)),
  ) as ExtractResult['fieldConfidences'];
  const uncertainFields = (prediction.uncertainFields ?? []).filter(isExtractedFieldKey);
  const entities = (prediction.entities ?? [])
    .filter((entity) => isExtractedFieldKey(entity.field))
    .map((entity) => ({
      field: entity.field,
      tokenStart: entity.tokenStart,
      tokenEnd: entity.tokenEnd,
      text: entity.text,
      confidence: entity.confidence,
      valid: entity.valid,
    }));
  const bio = sanitizeBioPayload(prediction.bio);

  return {
    fields,
    fieldConfidences,
    overallConfidence: Number.isFinite(prediction.overallConfidence)
      ? prediction.overallConfidence
      : 0,
    modelVersion: prediction.modelVersion ?? carrier.extractionMeta?.modelVersion ?? null,
    featureVersion: prediction.featureVersion ?? null,
    styleUsed: prediction.styleUsed || normalizeStyleFamily(carrier.style.family),
    uncertainFields,
    ...(entities.length > 0 ? { entities } : {}),
    ...(bio ? { bio } : {}),
  };
}

function mergeExtractedFields(
  existing: ExtractedFields,
  incoming: ExtractResult,
  source: FieldSource,
): ExtractedFields {
  const merged = cloneExtractedFields(existing);
  const validEntities = bestValidEntityByField(incoming);
  const clearedFields = new Set<ExtractedFieldKey>();

  for (const [field, rawValue] of Object.entries(incoming.fields)) {
    if (!isExtractedFieldKey(field)) continue;
    const confidence = incoming.fieldConfidences[field] ?? validEntities.get(field)?.confidence ?? incoming.overallConfidence ?? 0.5;
    const current = merged[field];
    if (!canApplyPhase4Field(current, source, confidence)) continue;

    if (rawValue == null) {
      clearedFields.add(field);
      setExtractedField(merged, field, fieldOf(
        null as ExtractedFields[typeof field]['value'],
        source,
        STAGE_ID,
        0,
        {
          uncertain: true,
          previousValue: current.value as ExtractedFields[typeof field]['value'],
          previousSource: current.source,
          previousOrigin: current.origin,
        },
      ) as ExtractedFields[typeof field]);
      continue;
    }

    const normalized = normalizeFieldValue(field, rawValue);
    if (normalized == null) continue;

    setExtractedField(merged, field, fieldOf(
      normalized as never,
      source,
      STAGE_ID,
      confidence,
      hasFieldValueForPhase4(current)
        ? {
          previousValue: current.value as never,
          previousSource: current.source,
          previousOrigin: current.origin,
        }
        : {},
    ) as ExtractedFields[typeof field]);
  }

  for (const [field, entity] of validEntities.entries()) {
    if (clearedFields.has(field)) continue;
    const current = merged[field];
    if (hasFieldValueForPhase4(current)) continue;

    const normalized = normalizeFieldValue(field, entity.text);
    if (normalized == null) continue;

    setExtractedField(merged, field, fieldOf(
      normalized as never,
      source,
      STAGE_ID,
      entity.confidence,
    ) as ExtractedFields[typeof field]);
  }

  return merged;
}

function hasExtractResultValues(prediction: ExtractResult): boolean {
  return Object.keys(prediction.fields).length > 0;
}

function buildPrimaryMlPatchPrediction(
  heuristic: ExtractResult,
  mlPrediction: ExtractResult,
  raw: string,
): ExtractResult {
  const entitiesByField = bestEntityByField(mlPrediction);
  const validEntities = bestValidEntityByField(mlPrediction);
  const fields: ExtractResult['fields'] = {};
  const fieldConfidences: ExtractResult['fieldConfidences'] = {};
  const uncertainFields: ExtractResult['uncertainFields'] = [];
  const entities: NonNullable<ExtractResult['entities']> = [];

  for (const field of ML_PRIMARY_PATCH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(mlPrediction.fields, field)) {
      continue;
    }
    const value = mlPrediction.fields[field];
    if (value == null) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (typeof value === 'string' && !value.trim()) {
      continue;
    }

    const entity = entitiesByField.get(field);
    if (!shouldApplyPrimaryMlPatchField(field, value, heuristic, raw, entity)) {
      continue;
    }

    const normalized = normalizeFieldValue(field, value);
    if (!hasMeaningfulPrimaryMlPatchValue(field, normalized)) {
      continue;
    }

    const confidence = mlPrediction.fieldConfidences[field]
      ?? validEntities.get(field)?.confidence
      ?? entity?.confidence
      ?? mlPrediction.overallConfidence
      ?? 0.5;
    fields[field] = value;
    fieldConfidences[field] = confidence;
    if (mlPrediction.uncertainFields.includes(field)) {
      uncertainFields.push(field);
    }
    if (entity) {
      entities.push(entity);
    }
  }

  return {
    fields,
    fieldConfidences,
    overallConfidence: mlPrediction.overallConfidence,
    modelVersion: mlPrediction.modelVersion,
    featureVersion: mlPrediction.featureVersion,
    styleUsed: mlPrediction.styleUsed,
    uncertainFields,
    ...(entities.length > 0 ? { entities } : {}),
    ...(mlPrediction.bio ? { bio: mlPrediction.bio } : {}),
  };
}

function hasMeaningfulPrimaryMlPatchValue(
  field: ExtractedFieldKey,
  normalized: ExtractedFields[ExtractedFieldKey]['value'] | null,
): boolean {
  if (normalized == null) {
    return false;
  }

  if (field === 'authors' || field === 'editors') {
    return Array.isArray(normalized) && normalized.length > 0;
  }

  if (typeof normalized === 'string') {
    return normalized.trim().length > 0;
  }

  return true;
}

function shouldApplyPrimaryMlPatchField(
  field: ExtractedFieldKey,
  value: unknown,
  heuristic: ExtractResult,
  raw: string,
  entity: NonNullable<ExtractResult['entities']>[number] | undefined,
): boolean {
  if (!isPrimaryPatchFieldAmbiguous(field, heuristic)) {
    return false;
  }

  return isPrimaryPatchGrounded(field, value, raw, entity);
}

function isPrimaryPatchFieldAmbiguous(
  field: ExtractedFieldKey,
  heuristic: ExtractResult,
): boolean {
  const heuristicValue = heuristic.fields[field];
  const hasHeuristicValue = normalizeComparableValue(heuristicValue) !== undefined;
  const heuristicConfidence = heuristic.fieldConfidences[field] ?? 0;

  if (!hasHeuristicValue) {
    return true;
  }

  if (heuristic.uncertainFields.includes(field)) {
    return true;
  }

  const floor = ML_PRIMARY_PATCH_CONFIDENCE_FLOORS[field] ?? 0.84;
  return heuristicConfidence < floor;
}

function isPrimaryPatchGrounded(
  field: ExtractedFieldKey,
  value: unknown,
  raw: string,
  entity: NonNullable<ExtractResult['entities']>[number] | undefined,
): boolean {
  if (field === 'doi') {
    const normalizedCandidate = normalizeDoi(typeof value === 'string' ? value : null);
    if (!normalizedCandidate) {
      return false;
    }

    if (normalizeDoi(raw) === normalizedCandidate) {
      return true;
    }

    const rawDoiMatch = raw.match(DOI_REGEX)?.[0] ?? null;
    return normalizeDoi(rawDoiMatch) === normalizedCandidate;
  }

  if (entity?.valid) {
    return true;
  }

  const candidateText = toPrimaryPatchGroundingText(field, value);
  if (!candidateText) {
    return false;
  }

  const normalizedCandidate = normalizePrimaryPatchGroundingText(candidateText);
  const normalizedRaw = normalizePrimaryPatchGroundingText(raw);
  if (!normalizedCandidate || !normalizedRaw) {
    return false;
  }

  return normalizedRaw.includes(normalizedCandidate);
}

function toPrimaryPatchGroundingText(field: ExtractedFieldKey, value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (field === 'authors' && Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }
        const author = entry as { literal?: unknown; family?: unknown; given?: unknown };
        const literal = typeof author.literal === 'string' ? author.literal.trim() : '';
        if (literal) {
          return literal;
        }
        const family = typeof author.family === 'string' ? author.family.trim() : '';
        const given = typeof author.given === 'string' ? author.given.trim() : '';
        return [family, given].filter(Boolean).join(' ');
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join('; ') : null;
  }

  return null;
}

function normalizePrimaryPatchGroundingText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SMART_QUOTES_REGEX, '"')
    .replace(SMART_APOSTROPHE_REGEX, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function mergeHealthEvidence(
  baseline: ReferenceCarrier['healthEvidence'],
  patch: ReferenceCarrier['healthEvidence'],
): ReferenceCarrier['healthEvidence'] {
  const spanKey = (span: ReferenceCarrier['healthEvidence']['spans'][number]): string =>
    `${span.field}:${span.tokenStart}:${span.tokenEnd}:${span.valid ? 1 : 0}:${span.text}`;
  const seen = new Set<string>();
  const spans: ReferenceCarrier['healthEvidence']['spans'] = [];

  for (const span of [...baseline.spans, ...patch.spans]) {
    const key = spanKey(span);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    spans.push(span);
  }

  const validSpanFields = [...new Set([
    ...baseline.validSpanFields,
    ...patch.validSpanFields,
  ])];
  const invalidSpanFields = [...new Set([
    ...baseline.invalidSpanFields,
    ...patch.invalidSpanFields,
  ])];
  const parserWarnings = [...new Set([
    ...baseline.parserWarnings,
    ...patch.parserWarnings,
  ])];
  const warnings = uniqueHealthWarnings(parserWarnings.map((code) => toHealthWarning(code)));

  return {
    spans,
    validSpanFields,
    invalidSpanFields,
    parserWarnings,
    warnings,
  };
}

function mergeMlDiagnosticsIntoHeuristicHealth(
  heuristic: ReferenceCarrier['healthEvidence'],
  ml: ReferenceCarrier['healthEvidence'],
): ReferenceCarrier['healthEvidence'] {
  const invalidMlSpans = ml.spans.filter((span) => !span.valid);
  const spanKey = (span: ReferenceCarrier['healthEvidence']['spans'][number]): string =>
    `${span.field}:${span.tokenStart}:${span.tokenEnd}:${span.valid ? 1 : 0}:${span.text}`;
  const seen = new Set<string>();
  const spans: ReferenceCarrier['healthEvidence']['spans'] = [];

  for (const span of [...heuristic.spans, ...invalidMlSpans]) {
    const key = spanKey(span);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    spans.push(span);
  }

  const validSpanFields = [...heuristic.validSpanFields];
  const invalidSpanFields = [...new Set([
    ...heuristic.invalidSpanFields,
    ...ml.invalidSpanFields,
  ])];
  const parserWarnings = [...new Set([
    ...heuristic.parserWarnings,
    ...ml.parserWarnings.filter((warning) => warning.startsWith('invalid_') || warning === 'invalid_author_span'),
  ])];
  const warnings = uniqueHealthWarnings(parserWarnings.map((code) => toHealthWarning(code)));

  return {
    spans,
    validSpanFields,
    invalidSpanFields,
    parserWarnings,
    warnings,
  };
}

function repairFinalMergedFieldInteractions(
    fields: ExtractedFields,
    raw: string,
  ): void {
    const currentTitle = typeof fields.title.value === 'string' ? fields.title.value : null;
    const currentPublisher = typeof fields.publisher.value === 'string' ? fields.publisher.value : null;
    const currentConferenceTitle = typeof fields.conferenceTitle.value === 'string'
      ? fields.conferenceTitle.value
      : null;
    const reviewTailCarryoverSource = currentConferenceTitle ?? currentPublisher;
    const reviewTailCarryoverMatch =
      currentTitle && reviewTailCarryoverSource
        ? reviewTailCarryoverSource.match(/^(?<review>.+?\(review\))\.\s+(?<journal>.+)$/iu)
        : null;
    const reviewTailJournal = normalizeJournalCandidate(
      reviewTailCarryoverMatch?.groups?.journal,
      currentTitle ?? undefined,
    );
    const reviewTailTitle = normalizeTitleCandidate(
      [currentTitle, reviewTailCarryoverMatch?.groups?.review]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join('. '),
    );
    if (reviewTailJournal) {
      setExtractedField(
        fields,
        'journal',
        fieldOf(
          reviewTailJournal,
          currentConferenceTitle ? fields.conferenceTitle.source : fields.publisher.source,
          STAGE_ID,
          Math.max(
            0.82,
            currentConferenceTitle ? fields.conferenceTitle.confidence : fields.publisher.confidence,
          ),
          {
            origin: currentConferenceTitle ? fields.conferenceTitle.origin : fields.publisher.origin,
            previousValue: fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: fields.journal.source,
            previousOrigin: fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      if (reviewTailTitle) {
        setExtractedField(
          fields,
          'title',
          fieldOf(
            reviewTailTitle,
            fields.title.source,
            STAGE_ID,
            Math.max(0.8, fields.title.confidence),
            {
              origin: fields.title.origin,
              previousValue: currentTitle as ExtractedFields['title']['value'],
              previousSource: fields.title.source,
              previousOrigin: fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }
      if (currentConferenceTitle === reviewTailCarryoverSource) {
        fields.conferenceTitle = fieldOf(
          null,
          fields.conferenceTitle.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: fields.conferenceTitle.origin,
            previousValue: currentConferenceTitle as ExtractedFields['conferenceTitle']['value'],
            previousSource: fields.conferenceTitle.source,
            previousOrigin: fields.conferenceTitle.origin,
          },
        ) as ExtractedFields['conferenceTitle'];
      }
      if (currentPublisher === reviewTailCarryoverSource) {
        fields.publisher = fieldOf(
          null,
          fields.publisher.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: fields.publisher.origin,
            previousValue: currentPublisher as ExtractedFields['publisher']['value'],
            previousSource: fields.publisher.source,
            previousOrigin: fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'];
      }
    }
    const repairedTitlePublisher = repairPublisherTitleTokenCarryover(
      currentTitle,
      currentPublisher,
    );
  if (repairedTitlePublisher) {
    setExtractedField(
      fields,
      'title',
      fieldOf(
        repairedTitlePublisher.title,
        fields.title.source,
        STAGE_ID,
        fields.title.confidence,
        {
          origin: fields.title.origin,
          previousValue: currentTitle as ExtractedFields['title']['value'],
          previousSource: fields.title.source,
          previousOrigin: fields.title.origin,
        },
      ) as ExtractedFields['title'],
    );
    setExtractedField(
      fields,
      'publisher',
      fieldOf(
        repairedTitlePublisher.publisher,
        fields.publisher.source,
        STAGE_ID,
        fields.publisher.confidence,
        {
          origin: fields.publisher.origin,
          previousValue: currentPublisher as ExtractedFields['publisher']['value'],
          previousSource: fields.publisher.source,
          previousOrigin: fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }

    const publisherAfterRepair = typeof fields.publisher.value === 'string'
      ? fields.publisher.value
      : null;
    const doi = typeof fields.doi.value === 'string' ? fields.doi.value : null;
    const isbn = typeof fields.isbn.value === 'string' ? fields.isbn.value : null;
    if (
      currentTitle
      && currentConferenceTitle
      && !publisherAfterRepair
    ) {
      const recoveredConferencePublisherAlias = inferPublisherFromDoiHint(doi ?? undefined)
        ?? recoverStrongNumericConferencePublisherTail(raw)?.publisher
        ?? recoverConferencePublisherAliasFromRaw(raw);
      if (recoveredConferencePublisherAlias) {
        const compactConferenceAliasTail = currentTitle.match(
          new RegExp(
            `^(?<title>.+?)(?:["“”'‘’]\\.?\\s*|[.,;:]\\s+)${escapeRegex(recoveredConferencePublisherAlias)}$`,
            'iu',
          ),
        );
        const recoveredCompactAliasTitle = normalizeTitleCandidate(
          compactConferenceAliasTail?.groups?.title,
        );
        if (recoveredCompactAliasTitle) {
          setExtractedField(
            fields,
            'title',
            fieldOf(
              recoveredCompactAliasTitle,
              fields.title.source,
              STAGE_ID,
              fields.title.confidence,
              {
                origin: fields.title.origin,
                previousValue: currentTitle as ExtractedFields['title']['value'],
                previousSource: fields.title.source,
                previousOrigin: fields.title.origin,
              },
            ) as ExtractedFields['title'],
          );
        }
      }
    }

    if (
      !publisherAfterRepair
      && currentTitle
    && !hasFieldValue(fields.bookTitle)
    && !hasFieldValue(fields.journal)
    && (isbn || looksBookChapterDoi(doi ?? undefined) || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? ''))
  ) {
    const swallowedPublisher = recoverPublisherFromSwallowedTitleSuffix(currentTitle);
    if (swallowedPublisher) {
      setExtractedField(
        fields,
        'title',
        fieldOf(
          swallowedPublisher.title,
          fields.title.source,
          STAGE_ID,
          fields.title.confidence,
          {
            origin: fields.title.origin,
            previousValue: currentTitle as ExtractedFields['title']['value'],
            previousSource: fields.title.source,
            previousOrigin: fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
      setExtractedField(
        fields,
        'publisher',
        fieldOf(
          swallowedPublisher.publisher,
          fields.title.source,
          STAGE_ID,
          Math.max(fields.title.confidence - 0.02, 0.7),
          {
            origin: fields.title.origin,
            previousValue: fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: fields.publisher.source,
            previousOrigin: fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }
  }

  const publisherAfterBookRepair = typeof fields.publisher.value === 'string'
    ? fields.publisher.value
    : null;
  const conferenceTitleAfterBookRepair = typeof fields.conferenceTitle.value === 'string'
    ? fields.conferenceTitle.value
    : null;
  if (
    !conferenceTitleAfterBookRepair
    && publisherAfterBookRepair
    && !hasFieldValue(fields.bookTitle)
    && !hasFieldValue(fields.volume)
    && !hasFieldValue(fields.issue)
    && !hasFieldValue(fields.pages)
    && looksUppercaseProceedingsTitle(publisherAfterBookRepair)
  ) {
    setExtractedField(
      fields,
      'conferenceTitle',
      fieldOf(
        publisherAfterBookRepair,
        fields.publisher.source,
        STAGE_ID,
        Math.max(fields.publisher.confidence, 0.74),
        {
          origin: fields.publisher.origin,
          previousValue: fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
          previousSource: fields.conferenceTitle.source,
          previousOrigin: fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
    setExtractedField(
      fields,
      'publisher',
      fieldOf(
        null,
        fields.publisher.source,
        STAGE_ID,
        0,
        {
          uncertain: true,
          origin: fields.publisher.origin,
          previousValue: publisherAfterBookRepair as ExtractedFields['publisher']['value'],
          previousSource: fields.publisher.source,
          previousOrigin: fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }

  const conferenceTitleAfterProceedingsRepair = typeof fields.conferenceTitle.value === 'string'
    ? fields.conferenceTitle.value
    : null;
  const publisherAfterProceedingsRepair = typeof fields.publisher.value === 'string'
    ? fields.publisher.value
    : null;
  if (
    !publisherAfterProceedingsRepair
    && conferenceTitleAfterProceedingsRepair
    && !hasFieldValue(fields.journal)
    && !hasFieldValue(fields.bookTitle)
    && !hasFieldValue(fields.volume)
    && !hasFieldValue(fields.issue)
    && !hasFieldValue(fields.pages)
    && !looksUppercaseProceedingsTitle(conferenceTitleAfterProceedingsRepair)
    && !looksConferencePublicationVenue(conferenceTitleAfterProceedingsRepair)
    && !looksConferenceVenueAlias(conferenceTitleAfterProceedingsRepair)
    && (isbn || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? ''))
  ) {
    setExtractedField(
      fields,
        'publisher',
        fieldOf(
          conferenceTitleAfterProceedingsRepair,
          fields.conferenceTitle.source,
          STAGE_ID,
          Math.max(fields.conferenceTitle.confidence, 0.72),
          {
            origin: fields.conferenceTitle.origin,
          previousValue: fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: fields.publisher.source,
          previousOrigin: fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
    setExtractedField(
      fields,
      'conferenceTitle',
      fieldOf(
        null,
        fields.conferenceTitle.source,
        STAGE_ID,
        0,
        {
          uncertain: true,
          origin: fields.conferenceTitle.origin,
          previousValue: conferenceTitleAfterProceedingsRepair as ExtractedFields['conferenceTitle']['value'],
          previousSource: fields.conferenceTitle.source,
          previousOrigin: fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
  }

  const publisherAfterConferenceRepair = typeof fields.publisher.value === 'string'
    ? fields.publisher.value
    : null;
  const hasBookishIdentifier =
    isbn != null
    || looksBookChapterDoi(doi ?? undefined)
    || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? '');
  const rawHasNonDoiUrl = URL_REGEX.test(raw) && !DOI_URL_REGEX.test(raw);
  if (
    publisherAfterConferenceRepair
    && !hasFieldValue(fields.journal)
    && !hasFieldValue(fields.conferenceTitle)
    && !hasFieldValue(fields.bookTitle)
    && !hasFieldValue(fields.volume)
    && !hasFieldValue(fields.issue)
    && !hasFieldValue(fields.pages)
    && !hasBookishIdentifier
    && !rawHasNonDoiUrl
    && !hasWebpageAccessCue(raw)
    && !hasReportCue(raw)
    && !hasThesisCue(raw)
    && !looksPublisherLike(publisherAfterConferenceRepair)
    && !looksInstitutionalContainer(publisherAfterConferenceRepair)
    && citationContainsGroundedContainer(raw, publisherAfterConferenceRepair)
  ) {
    const recoveredJournalVenue = normalizeJournalCandidate(
      publisherAfterConferenceRepair,
      typeof fields.title.value === 'string' ? fields.title.value : null,
    ) ?? normalizeConferenceTitle(publisherAfterConferenceRepair);
    if (recoveredJournalVenue) {
      setExtractedField(
        fields,
        'journal',
        fieldOf(
          recoveredJournalVenue,
          fields.publisher.source,
          STAGE_ID,
          Math.max(fields.publisher.confidence, 0.72),
          {
            origin: fields.publisher.origin,
            previousValue: fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: fields.journal.source,
            previousOrigin: fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        fields,
        'publisher',
        fieldOf(
          null,
          fields.publisher.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: fields.publisher.origin,
            previousValue: publisherAfterConferenceRepair as ExtractedFields['publisher']['value'],
            previousSource: fields.publisher.source,
            previousOrigin: fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }
  }

  const publisherAfterVenueRepair = typeof fields.publisher.value === 'string'
    ? fields.publisher.value
    : null;
  const titleAfterRepair = typeof fields.title.value === 'string'
    ? stripTrailingPunctuation(fields.title.value)
    : null;
  const trailingTitleToken = titleAfterRepair?.split(/\s+/u).filter(Boolean).at(-1) ?? null;
  if (
    publisherAfterVenueRepair
    && trailingTitleToken
    && (
      /^[ivxlcdm]+$/iu.test(trailingTitleToken)
      || /^[a-z]$/iu.test(trailingTitleToken)
    )
  ) {
    const strippedPublisher = publisherAfterVenueRepair.replace(
      new RegExp(`^${escapeRegex(trailingTitleToken)}\\.\\s+`, 'iu'),
      '',
    ).trim();
    if (strippedPublisher && strippedPublisher !== publisherAfterVenueRepair) {
      setExtractedField(
        fields,
        'publisher',
        fieldOf(
          strippedPublisher,
          fields.publisher.source,
          STAGE_ID,
          fields.publisher.confidence,
          {
            origin: fields.publisher.origin,
            previousValue: publisherAfterVenueRepair as ExtractedFields['publisher']['value'],
            previousSource: fields.publisher.source,
            previousOrigin: fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }
  }

  const currentTitleForVenueRecovery = typeof fields.title.value === 'string'
    ? fields.title.value
    : null;
  const rawTailAfterTitle = currentTitleForVenueRecovery
    ? extractTailAfterTitle(raw, currentTitleForVenueRecovery)
    : null;
  const rawTailHasYearLocator = rawTailAfterTitle
    ? /[;,]\s*(?:19|20)\d{2}\b/u.test(stripIdentifierTail(stripTrailingPunctuation(rawTailAfterTitle)))
    : false;
  const recoveredConferenceFromRaw =
    currentTitleForVenueRecovery && !rawTailHasYearLocator
      ? recoverConferenceContainerAfterTitle(raw, currentTitleForVenueRecovery)
      : null;
  if (
    !hasFieldValue(fields.conferenceTitle)
    && !hasFieldValue(fields.bookTitle)
    && !hasFieldValue(fields.volume)
    && !hasFieldValue(fields.issue)
    && !hasFieldValue(fields.pages)
    && !hasFieldValue(fields.isbn)
    && !hasFieldValue(fields.repository)
    && !/10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? '')
    && recoveredConferenceFromRaw
    && !looksPublisherLike(recoveredConferenceFromRaw)
    && !looksInstitutionalContainer(recoveredConferenceFromRaw)
    && !looksLowQualityContainerCandidate(recoveredConferenceFromRaw)
    && (
      looksConferencePublicationVenue(recoveredConferenceFromRaw)
      || looksConferenceVenueAlias(recoveredConferenceFromRaw)
      || looksUppercaseProceedingsTitle(recoveredConferenceFromRaw)
    )
  ) {
    setExtractedField(
      fields,
      'conferenceTitle',
      fieldOf(
        recoveredConferenceFromRaw,
        fields.publisher.source,
        STAGE_ID,
        Math.max(fields.publisher.confidence, 0.72),
        {
          origin: fields.publisher.origin,
          previousValue: fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
          previousSource: fields.conferenceTitle.source,
          previousOrigin: fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
    setExtractedField(
      fields,
      'publisher',
      fieldOf(
        null,
        fields.publisher.source,
        STAGE_ID,
        0,
        {
          uncertain: true,
          origin: fields.publisher.origin,
          previousValue: fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: fields.publisher.source,
          previousOrigin: fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }

  if (typeof fields.publisher.value === 'string') {
    setExtractedField(
      fields,
      'publisher',
      fieldOf(
        restorePublisherLegalSuffixFromRaw(raw, fields.publisher.value),
        fields.publisher.source,
        STAGE_ID,
        fields.publisher.confidence,
        {
          origin: fields.publisher.origin,
          previousValue: fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: fields.publisher.source,
          previousOrigin: fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }

  const finalTitle = typeof fields.title.value === 'string'
    ? fields.title.value
    : null;
  const finalConferenceTitle = typeof fields.conferenceTitle.value === 'string'
    ? fields.conferenceTitle.value
    : null;
  const finalPublisher = typeof fields.publisher.value === 'string'
    ? fields.publisher.value
    : null;
  if (finalTitle && finalConferenceTitle && !finalPublisher) {
    const quotedCompactConferenceAliasTail = finalTitle.match(
      /^(?<title>.+?)(?:["“”'‘’]\.?\s*)(?<alias>[A-Z][A-Z0-9&./-]{2,18})$/u,
    );
    const repairedQuotedCompactAliasTitle = normalizeTitleCandidate(
      quotedCompactConferenceAliasTail?.groups?.title,
    );
    if (repairedQuotedCompactAliasTitle) {
      setExtractedField(
        fields,
        'title',
        fieldOf(
          repairedQuotedCompactAliasTitle,
          fields.title.source,
          STAGE_ID,
          fields.title.confidence,
          {
            origin: fields.title.origin,
            previousValue: finalTitle as ExtractedFields['title']['value'],
            previousSource: fields.title.source,
            previousOrigin: fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
    }

    const trailingConferenceAlias =
      inferPublisherFromDoiHint(doi ?? undefined)
      ?? recoverStrongNumericConferencePublisherTail(raw)?.publisher
      ?? recoverConferencePublisherAliasFromRaw(raw);
    const compactAliasTail = finalTitle.match(
      /^(?<title>.+?)(?:["“”'‘’]\.?\s*|[.,;:]\s+)(?<alias>[A-Z][A-Z0-9&./-]{2,18})$/u,
    );
    const compactAliasCandidate = compactAliasTail?.groups?.alias?.trim() ?? null;
    if (trailingConferenceAlias) {
      const repairedFinalTitle = normalizeTitleCandidate(
        finalTitle.replace(
          new RegExp(
            `(?:["“”'‘’]\\.?\\s*|[.,;:]\\s+)${escapeRegex(trailingConferenceAlias)}$`,
            'iu',
          ),
          '',
        ),
      );
      if (
        repairedFinalTitle
        && repairedFinalTitle !== normalizeTitleCandidate(finalTitle)
      ) {
        setExtractedField(
          fields,
          'title',
          fieldOf(
            repairedFinalTitle,
            fields.title.source,
            STAGE_ID,
            fields.title.confidence,
            {
              origin: fields.title.origin,
              previousValue: finalTitle as ExtractedFields['title']['value'],
              previousSource: fields.title.source,
              previousOrigin: fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }
    }
    if (
      compactAliasCandidate
      && !GENERIC_CONFERENCE_ALIAS_TOKENS.has(compactAliasCandidate.replace(/\s+/gu, ''))
      && (
        looksCompactConferenceVenueAlias(compactAliasCandidate)
        || looksConferencePublisherOrganization(compactAliasCandidate)
        || looksPublisherLike(compactAliasCandidate)
        || looksInstitutionalAcronymPhrase(compactAliasCandidate)
      )
    ) {
      const repairedCompactAliasTitle = normalizeTitleCandidate(
        compactAliasTail?.groups?.title,
      );
      if (
        repairedCompactAliasTitle
        && repairedCompactAliasTitle !== normalizeTitleCandidate(
          typeof fields.title.value === 'string' ? fields.title.value : '',
        )
      ) {
        setExtractedField(
          fields,
          'title',
          fieldOf(
            repairedCompactAliasTitle,
            fields.title.source,
            STAGE_ID,
            fields.title.confidence,
            {
              origin: fields.title.origin,
              previousValue: fields.title.value as ExtractedFields['title']['value'],
              previousSource: fields.title.source,
              previousOrigin: fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }
    }
  }
}

function canApplyPhase4Field(
  existing: ExtractedFields[ExtractedFieldKey],
  incomingSource: FieldSource,
  incomingConfidence: number,
): boolean {
  if (existing.source === 'admin_confirmed') return false;
  if (!hasFieldValueForPhase4(existing)) return true;
  if (existing.source === incomingSource) {
    return incomingConfidence >= existing.confidence;
  }
  return canOverwrite(existing as never, incomingSource, incomingConfidence);
}

function buildHealthEvidence(prediction: ExtractResult): ReferenceCarrier['healthEvidence'] {
  const sourceEntities = prediction.bio?.entities?.length
    ? prediction.bio.entities
    : (prediction.entities ?? []);
  const spans = sourceEntities
    .filter((entity): entity is NonNullable<ExtractResult['entities']>[number] & { field: ExtractedFieldKey } => isExtractedFieldKey(entity.field))
    .map((entity) => ({
      field: entity.field,
      tokenStart: entity.tokenStart,
      tokenEnd: entity.tokenEnd,
      text: entity.text,
      confidence: entity.confidence,
      valid: entity.valid,
    }));

  const validSpanFields = [...new Set(spans.filter((span) => span.valid).map((span) => span.field))];
  const invalidSpanFields = [...new Set(spans.filter((span) => !span.valid).map((span) => span.field))];
  const parserWarnings = [
    ...prediction.uncertainFields.map((field) => `uncertain_${field}`),
    ...(prediction.bio?.diagnostics ?? []).map((diagnostic) => diagnostic.code),
    ...spans.flatMap((span) => (
      !span.valid && span.field !== 'authors' ? [`invalid_${span.field}_span`] : []
    )),
    ...(invalidSpanFields.includes('authors') ? ['invalid_author_span'] : []),
  ];
  const warnings = uniqueHealthWarnings(parserWarnings.map((code) => toHealthWarning(code)));

  return {
    spans,
    validSpanFields,
    invalidSpanFields,
    parserWarnings,
    warnings,
  };
}

function bestValidEntityByField(prediction: ExtractResult) {
  const best = new Map<ExtractedFieldKey, NonNullable<ExtractResult['entities']>[number]>();

  for (const entity of prediction.entities ?? []) {
    if (!entity.valid || !isExtractedFieldKey(entity.field)) continue;
    const existing = best.get(entity.field);
    if (!existing || entity.confidence > existing.confidence) {
      best.set(entity.field, entity);
    }
  }

  return best;
}

function bestEntityByField(prediction: ExtractResult) {
  const best = new Map<ExtractedFieldKey, NonNullable<ExtractResult['entities']>[number]>();

  for (const entity of prediction.entities ?? []) {
    if (!isExtractedFieldKey(entity.field)) continue;
    const existing = best.get(entity.field);
    if (!existing || entity.confidence > existing.confidence) {
      best.set(entity.field, entity);
    }
  }

  return best;
}

function buildExtractionMeta(
  prediction: ExtractResult,
  runMode: ExtractionRunMode,
  overrides: Partial<ExtractionMeta> = {},
): ExtractionMeta {
  return {
    modelVersion: overrides.modelVersion ?? prediction.modelVersion ?? null,
    featureVersion: overrides.featureVersion ?? prediction.featureVersion ?? null,
    styleUsed: overrides.styleUsed ?? prediction.styleUsed,
    overallConfidence: overrides.overallConfidence ?? prediction.overallConfidence,
    fieldConfidences: overrides.fieldConfidences ?? structuredClone(prediction.fieldConfidences),
    uncertainFields: overrides.uncertainFields ?? [...prediction.uncertainFields],
    runMode,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    ...(overrides.entities !== undefined
      ? { entities: overrides.entities }
      : prediction.entities
        ? { entities: structuredClone(prediction.entities) }
        : {}),
    ...(overrides.bio !== undefined
      ? { bio: overrides.bio }
      : prediction.bio
        ? { bio: structuredClone(prediction.bio) }
        : {}),
    ...(overrides.shadowDiff ? { shadowDiff: overrides.shadowDiff } : {}),
    ...(overrides.candidateRecallShadow
      ? { candidateRecallShadow: overrides.candidateRecallShadow }
      : {}),
    ...(overrides.mlError !== undefined ? { mlError: overrides.mlError } : {}),
  };
}

function sanitizeBioPayload(bio: ExtractResult['bio'] | undefined): ExtractionBioDebug | undefined {
  if (!bio) return undefined;
  const entities = (bio.entities ?? [])
    .filter((entity) => isExtractedFieldKey(entity.field))
    .map((entity) => ({
      label: String(entity.label || entity.field),
      field: entity.field,
      tokenStart: Number.isFinite(entity.tokenStart) ? entity.tokenStart : 0,
      tokenEnd: Number.isFinite(entity.tokenEnd) ? entity.tokenEnd : 0,
      charStart: Number.isFinite(entity.charStart) ? entity.charStart : 0,
      charEnd: Number.isFinite(entity.charEnd) ? entity.charEnd : 0,
      text: String(entity.text ?? ''),
      confidence: Number.isFinite(entity.confidence) ? entity.confidence : 0,
      valid: entity.valid !== false,
      ...(entity.diagnostics?.length ? { diagnostics: [...entity.diagnostics] } : {}),
    }));

  return {
    tokens: [...(bio.tokens ?? [])].map(String),
    labels: [...(bio.labels ?? [])].map(String),
    offsets: (bio.offsets ?? [])
      .filter((offset): offset is [number, number] => (
        Array.isArray(offset)
        && offset.length === 2
        && Number.isFinite(offset[0])
        && Number.isFinite(offset[1])
      ))
      .map((offset) => [offset[0], offset[1]]),
    labelConfidences: [...(bio.labelConfidences ?? [])].filter(Number.isFinite),
    entities,
    diagnostics: (bio.diagnostics ?? []).map((diagnostic) => ({
      code: String(diagnostic.code),
      ...(diagnostic.severity ? { severity: diagnostic.severity } : {}),
      ...(diagnostic.label ? { label: diagnostic.label } : {}),
      ...(diagnostic.field ? { field: diagnostic.field } : {}),
      ...(diagnostic.tokenIndex != null ? { tokenIndex: diagnostic.tokenIndex } : {}),
      ...(diagnostic.message ? { message: diagnostic.message } : {}),
    })),
    labelSchemaVersion: String(bio.labelSchemaVersion || 'citation-bio-v1'),
    featureVersion: bio.featureVersion ?? null,
    modelVersion: bio.modelVersion ?? null,
  };
}

function buildShadowDiff(
  baselineFields: Partial<Record<ExtractedFieldKey, unknown>>,
  mlFields: Partial<Record<ExtractedFieldKey, unknown>>,
): ShadowDiff {
  const perFieldDiff: ShadowDiff['perFieldDiff'] = {};
  let changedCount = 0;
  let totalCompared = 0;

  for (const key of EXTRACTED_FIELD_KEYS) {
    const baseline = normalizeComparableValue(baselineFields[key]);
    const candidate = normalizeComparableValue(mlFields[key]);
    const hasBaseline = baseline !== undefined;
    const hasCandidate = candidate !== undefined;
    if (!hasBaseline && !hasCandidate) continue;

    totalCompared += 1;
    let status: ShadowDiff['perFieldDiff'][ExtractedFieldKey];
    if (hasBaseline && hasCandidate && deepEquals(baseline, candidate)) {
      status = 'same';
    } else if (!hasBaseline && hasCandidate) {
      status = 'added';
      changedCount += 1;
    } else if (hasBaseline && !hasCandidate) {
      status = 'removed';
      changedCount += 1;
    } else {
      status = 'changed';
      changedCount += 1;
    }

    perFieldDiff[key] = status;
  }

  return {
    baselineFields: structuredClone(baselineFields),
    mlFields: structuredClone(mlFields),
    perFieldDiff,
    severityScore: totalCompared === 0 ? 0 : Number((changedCount / totalCompared).toFixed(3)),
  };
}

function buildHeuristicExtractResult(
  carrier: ReferenceCarrier,
  captureCandidateRecallShadow: boolean,
): HeuristicExtractComputation {
  const raw = carrier.raw.replace(/\s+/g, ' ').trim();
  const features = extractCitationFeatures(raw, carrier.style.family);
  const tokenized = tokenize(raw);
  const heuristic = buildHeuristicEvidence(raw, carrier.style.family, carrier.type.type, features);
  const entities = buildHeuristicEntities(raw, tokenized, heuristic);

  return {
    prediction: {
      fields: heuristic.fields,
      fieldConfidences: heuristic.fieldConfidences,
      overallConfidence: heuristic.overallConfidence,
      modelVersion: null,
      featureVersion: null,
      styleUsed: normalizeStyleFamily(carrier.style.family),
      uncertainFields: Object.entries(heuristic.fieldConfidences)
        .filter(([, confidence]) => (confidence ?? 0) < UNCERTAINTY_THRESHOLD)
        .map(([field]) => field)
        .filter(isExtractedFieldKey),
      ...(entities.length > 0 ? { entities } : {}),
    },
    ...(captureCandidateRecallShadow
      ? { candidateRecallShadow: compareCitationFeatureRecallFromFeatures(features) }
      : {}),
  };
}

function normalizeFieldValue(field: ExtractedFieldKey, rawValue: unknown): ExtractedFields[typeof field]['value'] | null {
  if (field === 'authors' || field === 'editors') {
    if (Array.isArray(rawValue)) {
      const authors = rawValue
        .map((value) => toCanonicalAuthor(value))
        .filter((value): value is CanonicalAuthor => value != null);
      return authors as ExtractedFields[typeof field]['value'];
    }

    if (typeof rawValue === 'string') {
      return parseAuthorSegment(rawValue) as ExtractedFields[typeof field]['value'];
    }

    return [] as ExtractedFields[typeof field]['value'];
  }

  if (field === 'year') {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue as ExtractedFields[typeof field]['value'];
    }

    if (typeof rawValue === 'string') {
      const match = rawValue.match(/\b((?:19|20)\d{2})\b/);
      return (match ? Number(match[1]) : null) as ExtractedFields[typeof field]['value'] | null;
    }

    return null;
  }

  if (
    field === 'doi'
    || field === 'pmid'
    || field === 'arxiv'
    || field === 'isbn'
    || field === 'issn'
    || field === 'handle'
    || field === 'patent'
  ) {
    return normalizeIdentifierForField(field, rawValue) as ExtractedFields[typeof field]['value'] | null;
  }

  if (typeof rawValue === 'string') {
    const normalized = field === 'pages' ? normalizePages(rawValue.trim()) : rawValue.trim();
    return (normalized.length > 0 ? normalized : null) as ExtractedFields[typeof field]['value'] | null;
  }

  return null;
}

function buildHeuristicEvidence(
  raw: string,
  family: StyleFamily,
  referenceType?: ReferenceType,
  features?: CitationFeatures,
): HeuristicEvidence {
  const citationFeatures = features ?? extractCitationFeatures(raw, family);
  return extractCandidatesFromFeatures(raw, family, referenceType, citationFeatures);
}

function buildHeuristicCandidateContext(
  raw: string,
  family: StyleFamily,
  referenceType: ReferenceType | undefined,
  citationFeatures: CitationFeatures,
): HeuristicCandidateContext {
  const normalizedRaw = citationFeatures.normalizedRaw;
  const parseableRaw = citationFeatures.parseableRaw;
  const rawSupport: RawCitationSupport = {
    normalizedRaw,
    parseableRaw,
    quotedTitle: citationFeatures.quotedTitle,
  };
  const parsed = cloneParsedReference(parseStructuredReference(parseableRaw, family, rawSupport));
  const yearMatch = citationFeatures.yearMatch;
  const yearIndex = yearMatch?.index ?? parseableRaw.length;
  const quotedTitle = citationFeatures.quotedTitle;
  const preprintCue = looksPreprintCue(normalizedRaw);
  const rawHasThesisCue = hasThesisCue(normalizedRaw);
  const rawHasReportCue = hasReportCue(normalizedRaw);
  const rawHasConferenceCue =
    /\bpaper presented at\b/iu.test(normalizedRaw) || CONFERENCE_CUE_REGEX.test(normalizedRaw);
  const rawHasWebsiteAccessMarker = hasWebpageAccessCue(normalizedRaw);
  const normalizedUrl = citationFeatures.identifiers.url.normalized ?? undefined;
  const rawHasNonDoiUrl = Boolean(
    normalizedUrl && !isDoiUrl(normalizedUrl),
  );
  const rawHasDoiOnlyUrl =
    Boolean(normalizedUrl)
    && !rawHasNonDoiUrl
    && isDoiUrl(normalizedUrl);
  const rawHasWebpageOwnerTailProfile =
    WEBPAGE_APA_CORPORATE_REGEX.test(parseableRaw)
    || WEBPAGE_CHICAGO_OWNER_REGEX.test(parseableRaw)
    || WEBPAGE_HARVARD_OWNER_SITE_REGEX.test(parseableRaw)
    || WEBPAGE_MLA_REGEX.test(parseableRaw);
  const thesisCue = parsed.typeHint === 'thesis' || Boolean(parsed.thesisType) || rawHasThesisCue;

  let authorSegment = parsed.authorSegment
    ?? (parsed.typeHint === 'webpage'
      ? ''
      : parseableRaw
        .slice(0, yearIndex)
        .replace(/^[\[\(]?\d+[\]\).]?\s*/, '')
        .replace(/\(\s*$/u, '')
        .trim());
  let rest = parseableRaw.slice(yearIndex + (yearMatch?.matchText.length ?? 0)).replace(/^[).,\s]+/, '').trim();
  let titleSegment = parsed.title ?? rest.split('. ')[0]?.trim() ?? '';
  let remainderAfterTitle = rest.slice(titleSegment.length).replace(/^[.\s]+/, '').trim();
  let vancouverJournalHint: string | null = null;
  let vancouverAfterJournal = '';

  if (!parsed.authorSegment && quotedTitle && quotedTitle.start > 0) {
    const beforeTitle = parseableRaw
      .slice(0, quotedTitle.start)
      .replace(/^[\[\(]?\d+[\]\).]?\s*/, '')
      .replace(/[,\s]+$/u, '')
      .trim();
    if (beforeTitle) {
      authorSegment = beforeTitle;
    }
  }

  const shouldPreferQuotedTitle =
    quotedTitle?.title
    && (
      !parsed.title
      || isLowQualityTitleCandidate(parsed.title)
      || looksLikeAuthorSpill(parsed.title)
      || isBetterQuotedTitleCandidate(quotedTitle.title, parsed.title)
    );

  if (shouldPreferQuotedTitle && quotedTitle?.title) {
    titleSegment = quotedTitle.title;
    remainderAfterTitle = parseableRaw
      .slice(quotedTitle.end)
      .replace(/^[,.;:\s]+/u, '')
      .trim();
    rest = `${titleSegment}. ${remainderAfterTitle}`.trim();
  }

  if (preprintCue && quotedTitle?.title) {
    const beforeTitle = parseableRaw
      .slice(0, quotedTitle.start)
      .replace(/^[\[\(]?\d+[\]\).]?\s*/u, '')
      .replace(/[.,\s]+$/u, '')
      .trim();
    const afterTitle = parseableRaw
      .slice(quotedTitle.end)
      .replace(/^[,.;:\s]+/u, '')
      .trim();
    if (beforeTitle) {
      authorSegment = beforeTitle;
    }
    titleSegment = quotedTitle.title;
    remainderAfterTitle = afterTitle;
    rest = `${titleSegment}. ${remainderAfterTitle}`.trim();
  }

  if (preprintCue && family === 'numeric' && yearMatch && (!parsed.title || !parsed.authorSegment)) {
    const leadBeforeYear = parseableRaw
      .slice(0, yearIndex)
      .replace(/^[\[\(]?\d+[\]\).]?\s*/u, '')
      .trim();
    const sentenceBreak = leadBeforeYear.indexOf('. ');
    if (sentenceBreak > 0) {
      const possibleAuthors = leadBeforeYear.slice(0, sentenceBreak).trim();
      const possibleTitle = leadBeforeYear.slice(sentenceBreak + 2).trim();
      if (possibleAuthors && possibleTitle && normalizeComparableText(possibleTitle).split(' ').length >= 3) {
        authorSegment = possibleAuthors;
        titleSegment = possibleTitle;
        remainderAfterTitle = parseableRaw
          .slice(yearIndex + (yearMatch.matchText.length ?? 0))
          .replace(/^[).,\s]+/u, '')
          .trim();
        rest = `${titleSegment}. ${remainderAfterTitle}`.trim();
      }
    }
  }

  const looksLikeVancouverVenueTail =
    /\b(?:19|20)\d{2}\s+[A-Za-z]{3}\s+\d{1,2};\s*\d+\s*\(/.test(parseableRaw) ||
    /;\s*\d+\s*\(\d+\)\s*[:;,]\s*[A-Za-z]?\d+/.test(parseableRaw);

  if (looksLikeVancouverVenueTail && yearMatch && yearIndex > 120 && parseableRaw.includes('. ')) {
    // Strip a leading list marker ("9. ", "[9] ") first — otherwise it becomes
    // sentences[0] and shifts authors->title, title->journal (dropping the real
    // authors entirely for longer numbered Vancouver references).
    const sentences = parseableRaw
      .replace(/^[\[\(]?\d+[\]\).]?\s*/u, '')
      .split('. ')
      .map((part) => part.trim())
      .filter(Boolean);
    if (sentences.length >= 3) {
      authorSegment = sentences[0] ?? authorSegment;
      titleSegment = sentences[1] ?? titleSegment;
      remainderAfterTitle = sentences.slice(2).join('. ').trim();
      rest = `${titleSegment}. ${remainderAfterTitle}`.trim();
      if (sentences.length >= 4) {
        vancouverJournalHint = sentences[2] ?? null;
        vancouverAfterJournal = sentences.slice(3).join('. ').trim();
      }
    }
  }

  // Strip square brackets that wrap a numeric locator ("[12]" -> "12", "[45-67]" -> "45-67") in the
  // post-title remainder, so a bracketed volume/issue/page form is recognized by the locator patterns
  // below AND does not survive (or leave a dangling bracket) in the sliced journal value. Applied to
  // remainderAfterTitle/vancouverAfterJournal — not just venueRemainder — so the journal slice and the
  // locator match stay index-aligned. Round parens are left intact — they carry the issue number in
  // the "volume(issue)" form.
  const debracketLocator = (segment: string): string =>
    segment.replace(/\[\s*((?:pp?\.\s*)?[A-Za-z]?\d[\d\s.,–—-]*?)\s*\]/g, '$1');
  remainderAfterTitle = debracketLocator(remainderAfterTitle);
  vancouverAfterJournal = debracketLocator(vancouverAfterJournal);
  const venueRemainder = vancouverAfterJournal || remainderAfterTitle;
  const parsedAsApaCorporateWebpage =
    parsed.typeHint === 'webpage' && WEBPAGE_APA_CORPORATE_REGEX.test(parseableRaw);
  const parsedAsOwnerSiteWebpage =
    parsed.typeHint === 'webpage'
    && (
      parsedAsApaCorporateWebpage
      || WEBPAGE_HARVARD_OWNER_SITE_REGEX.test(parseableRaw)
      || WEBPAGE_CHICAGO_OWNER_REGEX.test(parseableRaw)
      || WEBPAGE_MLA_REGEX.test(parseableRaw)
    );

  return {
    parsed,
    yearMatch,
    preprintCue,
    thesisCue,
    authorSegment,
    titleSegment,
    remainderAfterTitle,
    venueRemainder,
    vancouverJournalHint,
    volumeIssuePages: venueRemainder.match(
      /(\d+)\s*\(([^)]+)\)\s*[,;:]\s*(?:pp?\.\s*)?([A-Za-z]?\d+(?:\s*[–-]\s*\d+)?)/i,
    ),
    volumeIssueWithoutPages: venueRemainder.match(
      /^(?<journal>.+?),\s*(?:vol\.?\s*)?(?<volume>\d+)(?:\s*\((?<issueParen>[^)]+)\)|,\s*no\.?\s*(?<issueWord>[^,.]+))\.?$/i,
    ),
    pagesOnly: venueRemainder.match(
      /[,;:]\s*(?:pp?\.\s*)?([A-Za-z]?\d+(?:\s*[–-]\s*\d+)?)(?:\.|$)/i,
    ),
    parsedAsApaCorporateWebpage,
    parsedAsOwnerSiteWebpage,
    parseableRaw,
    rawHasThesisCue,
    rawHasReportCue,
    rawHasConferenceCue,
    rawHasWebsiteAccessMarker,
    rawHasNonDoiUrl,
    rawHasDoiOnlyUrl,
    rawHasWebpageOwnerTailProfile,
    hasPlaceholderDoiTailFlag: hasPlaceholderDoiTail(normalizedRaw),
  };
}

function cloneParsedReference(parsed: ParsedReference): ParsedReference {
  return { ...parsed };
}

function extractCandidatesFromFeatures(
  raw: string,
  family: StyleFamily,
  referenceType: ReferenceType | undefined,
  citationFeatures: CitationFeatures,
): HeuristicEvidence {
  const fields: Partial<Record<ExtractedFieldKey, unknown>> = {};
  const fieldConfidences: Partial<Record<ExtractedFieldKey, number>> = {};
  const spanTexts: Partial<Record<ExtractedFieldKey, string>> = {};
  const warnings: string[] = [];
  const normalizedRaw = citationFeatures.normalizedRaw;
  const parseableRaw = citationFeatures.parseableRaw;
  let {
    parsed,
    yearMatch,
    preprintCue,
    thesisCue,
    authorSegment,
    titleSegment,
    remainderAfterTitle,
    venueRemainder,
    vancouverJournalHint,
    volumeIssuePages,
    volumeIssueWithoutPages,
    pagesOnly,
    parsedAsApaCorporateWebpage,
    parsedAsOwnerSiteWebpage,
    rawHasThesisCue,
    rawHasReportCue,
    rawHasConferenceCue,
    rawHasWebsiteAccessMarker,
    rawHasNonDoiUrl,
    rawHasDoiOnlyUrl,
    rawHasWebpageOwnerTailProfile,
    hasPlaceholderDoiTailFlag,
  } = buildHeuristicCandidateContext(raw, family, referenceType, citationFeatures);
  const urlMatch = citationFeatures.identifiers.url.raw;
  const inCollection = parseInCollectionRemainder(venueRemainder);

  if (authorSegment) {
    authorSegment = recoverAuthorSegmentOverflow(authorSegment, titleSegment);
    let authors = parseAuthorSegment(authorSegment);
    if (authors.length === 0 && parsed.typeHint === 'conference-paper') {
      authors = parseRecoverableNumericConferenceAuthors(authorSegment);
    }
    const validAuthorSpan = isValidAuthorSpanText(authorSegment, authors);
    if (!validAuthorSpan) warnings.push('invalid_author_span');
    fields.authors = authors;
    fieldConfidences.authors = 0.78;
    spanTexts.authors = authorSegment;
  }

  const corporateInstitution = authorSegment && looksInstitutionalContainer(authorSegment)
    ? normalizeInstitutionCandidate(authorSegment, parsed.year ?? yearMatch?.year)
    : null;

  if (titleSegment) {
    fields.title = normalizeTitleCandidate(titleSegment) ?? stripTrailingPunctuation(titleSegment);
    fieldConfidences.title = 0.8;
    spanTexts.title = titleSegment;
  }

  if (parsed.year != null) {
    fields.year = parsed.year;
    fieldConfidences.year = 0.96;
    spanTexts.year = String(parsed.year);
  } else if (yearMatch) {
    fields.year = yearMatch.year;
    fieldConfidences.year = 0.96;
    spanTexts.year = String(yearMatch.year);
  }

  const resolvedDoi = resolveDoi(citationFeatures);
  if (resolvedDoi) {
    fields.doi = resolvedDoi.value;
    fieldConfidences.doi = resolvedDoi.confidence;
    spanTexts.doi = resolvedDoi.spanText;
  }

  if (citationFeatures.identifiers.pmid.normalized) {
    fields.pmid = citationFeatures.identifiers.pmid.normalized;
    fieldConfidences.pmid = 0.96;
    spanTexts.pmid = citationFeatures.identifiers.pmid.raw ?? citationFeatures.identifiers.pmid.normalized;
  }

  if (citationFeatures.identifiers.arxiv.normalized) {
    fields.arxiv = citationFeatures.identifiers.arxiv.normalized;
    fieldConfidences.arxiv = 0.96;
    spanTexts.arxiv = citationFeatures.identifiers.arxiv.raw ?? citationFeatures.identifiers.arxiv.normalized;
  } else if (typeof fields.doi === 'string') {
    const inferredPreprintId = inferArxivFromIdentifier(fields.doi);
    if (inferredPreprintId) {
      fields.arxiv = inferredPreprintId;
      fieldConfidences.arxiv = 0.78;
      spanTexts.arxiv = fields.doi;
    }
  }

  if (citationFeatures.identifiers.isbn.normalized) {
    fields.isbn = citationFeatures.identifiers.isbn.normalized;
    fieldConfidences.isbn = 0.94;
    spanTexts.isbn = citationFeatures.identifiers.isbn.raw ?? citationFeatures.identifiers.isbn.normalized;
  } else if (
    typeof fields.doi === 'string'
    && (
      parsed.typeHint === 'book'
      || parsed.typeHint === 'book-chapter'
      || referenceType === 'book'
      || referenceType === 'book-chapter'
      || (
        !parsed.journal
        && !parsed.conferenceTitle
        && !parsed.bookTitle
        && !parsed.repository
        && !parsed.siteName
        && !parsed.patent
      )
    )
  ) {
    const inferredIsbn = inferPreferredIsbnFromIdentifier(fields.doi, {
      raw,
      bookTitle: typeof fields.bookTitle === 'string' ? fields.bookTitle : parsed.bookTitle ?? null,
      publisher: typeof fields.publisher === 'string' ? fields.publisher : parsed.publisher ?? null,
    });
    if (inferredIsbn) {
      fields.isbn = inferredIsbn;
      fieldConfidences.isbn = 0.78;
      spanTexts.isbn = fields.doi;
    }
  }

  if (citationFeatures.identifiers.issn.normalized) {
    fields.issn = citationFeatures.identifiers.issn.normalized;
    fieldConfidences.issn = 0.94;
    spanTexts.issn = citationFeatures.identifiers.issn.raw ?? citationFeatures.identifiers.issn.normalized;
  } else if (typeof fields.doi === 'string') {
    const inferredIssn = inferIssnFromIdentifier(fields.doi);
    if (inferredIssn) {
      fields.issn = inferredIssn;
      fieldConfidences.issn = 0.72;
      spanTexts.issn = fields.doi;
    }
  }

  if (citationFeatures.identifiers.handle.normalized) {
    fields.handle = citationFeatures.identifiers.handle.normalized;
    fieldConfidences.handle = 0.92;
    spanTexts.handle = citationFeatures.identifiers.handle.raw ?? citationFeatures.identifiers.handle.normalized;
  }

  if (parsed.patent) {
    fields.patent = normalizePatent(parsed.patent);
    fieldConfidences.patent = 0.94;
    spanTexts.patent = parsed.patent;
  } else {
    const patentIdentifier = citationFeatures.identifiers.patent.normalized;
    if (patentIdentifier) {
      fields.patent = patentIdentifier;
      fieldConfidences.patent = 0.92;
      spanTexts.patent = citationFeatures.identifiers.patent.raw ?? patentIdentifier;
    }
  }

  if (urlMatch) {
    fields.url = citationFeatures.identifiers.url.normalized ?? stripTrailingPunctuation(urlMatch);
    fieldConfidences.url = 0.92;
    spanTexts.url = urlMatch;
  } else if (typeof fields.doi === 'string' && fields.doi.trim()) {
    fields.url = `https://doi.org/${fields.doi}`;
    fieldConfidences.url = 0.9;
    spanTexts.url = fields.doi;
  } else if (typeof fields.patent === 'string' && fields.patent.trim()) {
    fields.url = `https://patents.google.com/patent/${fields.patent}/en`;
    fieldConfidences.url = 0.88;
    spanTexts.url = fields.patent;
  }

  if (parsed.journal) {
    fields.journal = parsed.journal;
    fieldConfidences.journal = 0.88;
    spanTexts.journal = parsed.journal;
  }

  if (parsed.volume) {
    fields.volume = parsed.volume;
    fieldConfidences.volume = 0.86;
    spanTexts.volume = parsed.volume;
  }

  if (parsed.issue) {
    fields.issue = foldIssueIfOcr(parsed.issue);
    fieldConfidences.issue = 0.84;
    spanTexts.issue = parsed.issue;
  }

  // (explicit "no. N"/"(N)" issue recovery happens post-candidate-selection in
  // reconcileExplicitIssue, so it cannot perturb which candidate wins.)

  if (parsed.pages) {
    const pages = normalizePages(parsed.pages);
    fields.pages = pages;
    fieldConfidences.pages = 0.84;
    spanTexts.pages = parsed.pages;
  }

  if (parsed.conferenceTitle) {
    fields.conferenceTitle = normalizeConferenceTitle(parsed.conferenceTitle);
    fieldConfidences.conferenceTitle = 0.82;
    spanTexts.conferenceTitle = parsed.conferenceTitle;
  }

  if (parsed.bookTitle) {
    fields.bookTitle = normalizeConferenceTitle(parsed.bookTitle);
    fieldConfidences.bookTitle = 0.82;
    spanTexts.bookTitle = parsed.bookTitle;
  }

  if (parsed.publisher) {
    fields.publisher = normalizePublisherCandidate(parsed.publisher, titleSegment);
    fieldConfidences.publisher = 0.72;
    spanTexts.publisher = parsed.publisher;
  }

  if (parsed.institution) {
    fields.institution = normalizeInstitutionCandidate(parsed.institution, parsed.year ?? yearMatch?.year);
    fieldConfidences.institution = 0.76;
    spanTexts.institution = parsed.institution;
  }

  if (parsed.thesisType) {
    fields.thesisType = parsed.thesisType;
    fieldConfidences.thesisType = 0.83;
    spanTexts.thesisType = parsed.thesisType;
  }

  if (parsed.siteName) {
    fields.siteName = normalizeSiteNameCandidate(parsed.siteName) ?? parsed.siteName;
    fieldConfidences.siteName = 0.72;
    spanTexts.siteName = parsed.siteName;
  }

  if (
    !fields.institution
    && parsed.publisher
    && parsed.siteName
    && (parsed.typeHint !== 'webpage' || parsedAsOwnerSiteWebpage)
  ) {
    const institution = normalizeInstitutionCandidate(parsed.publisher, parsed.year ?? yearMatch?.year);
    if (institution) {
      fields.institution = institution;
      fieldConfidences.institution = 0.7;
      spanTexts.institution = parsed.publisher;
    }
  }

  const webpageLikeContainerRecovery =
    typeof fields.bookTitle === 'string'
    && !looksConferenceContainer(fields.bookTitle)
    && (
      (
        WEBPAGE_APA_CORPORATE_REGEX.test(parseableRaw)
        || WEBPAGE_CHICAGO_OWNER_REGEX.test(parseableRaw)
        || WEBPAGE_MLA_REGEX.test(parseableRaw)
        || !looksScholarlyRemainder(parseableRaw)
      )
      && (
        ((typeof fields.url === 'string' && !isDoiUrl(fields.url)) || rawHasWebsiteAccessMarker)
      )
    );

  if (webpageLikeContainerRecovery) {
    const recoveredSiteName = normalizeSiteNameCandidate(
      typeof fields.bookTitle === 'string' ? fields.bookTitle : undefined,
    );
    const currentSiteName = typeof fields.siteName === 'string'
      ? normalizeSiteNameCandidate(fields.siteName)
      : null;
    const normalizedCurrentSite = normalizeComparableText(currentSiteName ?? '');
    const normalizedRecoveredSite = normalizeComparableText(recoveredSiteName ?? '');
    const normalizedPublisher = normalizeComparableText(
      typeof fields.publisher === 'string' ? fields.publisher : '',
    );
    const normalizedInstitution = normalizeComparableText(
      typeof fields.institution === 'string' ? fields.institution : '',
    );

    if (
      recoveredSiteName
      && (
        !currentSiteName
        || normalizedCurrentSite === normalizedPublisher
        || normalizedCurrentSite === normalizedInstitution
        || normalizedCurrentSite === normalizedRecoveredSite
      )
    ) {
      fields.siteName = recoveredSiteName;
      fieldConfidences.siteName = Math.max(fieldConfidences.siteName ?? 0, 0.74);
      spanTexts.siteName = recoveredSiteName;
    }

    if (
      recoveredSiteName
      && normalizeComparableText(String(fields.siteName ?? '')) === normalizedRecoveredSite
    ) {
      delete fields.bookTitle;
      delete fieldConfidences.bookTitle;
      delete spanTexts.bookTitle;
    }
  }

  if (parsed.repository) {
    const resolvedRepository = resolvePreprintRepository(raw, parsed.repository, titleSegment);
    if (resolvedRepository) {
      fields.repository = resolvedRepository;
      fieldConfidences.repository = 0.78;
      spanTexts.repository = parsed.repository;
    }
  }

  const inferredConferenceContainer = !parsed.conferenceTitle
    && !thesisCue
    && parsed.typeHint !== 'report'
    && parsed.typeHint !== 'preprint'
    && !looksPreprintCue(raw)
    ? inferBareConferenceContainer(
        remainderAfterTitle,
        typeof fields.doi === 'string' ? fields.doi : undefined,
        typeof fields.publisher === 'string' ? fields.publisher : undefined,
      )
    : null;

  if (fields.patent && !parsed.typeHint) {
    parsed.typeHint = 'patent';
  }

  if (!parsed.conferenceTitle && !parsed.bookTitle && inCollection) {
    const normalizedContainer = normalizeConferenceTitle(inCollection.container);
    if (looksConferenceContainer(normalizedContainer)) {
      fields.conferenceTitle = normalizedContainer;
      fieldConfidences.conferenceTitle = 0.76;
      spanTexts.conferenceTitle = inCollection.container;
    } else {
      fields.bookTitle = normalizedContainer;
      fieldConfidences.bookTitle = 0.76;
      spanTexts.bookTitle = inCollection.container;
    }
    if (!fields.pages && inCollection.pages) {
      fields.pages = normalizePages(inCollection.pages);
      fieldConfidences.pages = 0.74;
      spanTexts.pages = inCollection.pages;
    }
    if (!fields.publisher && inCollection.publisher) {
      fields.publisher = inCollection.publisher;
      fieldConfidences.publisher = 0.7;
      spanTexts.publisher = inCollection.publisher;
    }
  } else if (
    !parsed.conferenceTitle
    && /\[(?:poster|abstract|paper)\]/iu.test(titleSegment)
    && /^n\/?a$/iu.test(stripTrailingPunctuation(remainderAfterTitle))
  ) {
    fields.conferenceTitle = 'N/A';
    fieldConfidences.conferenceTitle = 0.7;
    spanTexts.conferenceTitle = remainderAfterTitle;
  } else if (thesisCue) {
    const thesisDetail = parseBracketedThesisDetails(remainderAfterTitle);
    const institution = normalizeInstitutionCandidate(
      parsed.institution ?? thesisDetail?.institution ?? getLastClause(remainderAfterTitle),
      parsed.year ?? yearMatch?.year,
    );
    const thesisType = parsed.thesisType ?? extractThesisType(raw);
    if (institution) {
      fields.institution = institution;
      fieldConfidences.institution = 0.7;
      spanTexts.institution = institution;
    }
    fields.thesisType = thesisType;
    fieldConfidences.thesisType = 0.83;
    spanTexts.thesisType = thesisType;
  } else if (inferredConferenceContainer) {
    fields.conferenceTitle = inferredConferenceContainer;
    fieldConfidences.conferenceTitle = 0.72;
    spanTexts.conferenceTitle = remainderAfterTitle;
  } else if (looksPreprintCue(raw)) {
    const repository = resolvePreprintRepository(
      raw,
      typeof fields.publisher === 'string' ? fields.publisher : undefined,
      titleSegment,
    );
    if (repository) {
      fields.repository = repository;
      fieldConfidences.repository = 0.82;
      spanTexts.repository = repository;
    }
  } else if (!parsed.journal && !parsed.conferenceTitle && !parsed.bookTitle && vancouverJournalHint) {
    const journal = stripTrailingPunctuation(vancouverJournalHint);
    fields.journal = journal;
    fieldConfidences.journal = 0.76;
    spanTexts.journal = vancouverJournalHint;
  } else if (!parsed.journal && !parsed.conferenceTitle && !parsed.bookTitle && volumeIssuePages) {
    const journal = stripTrailingPunctuation(remainderAfterTitle.slice(0, volumeIssuePages.index).trim());
    fields.journal = journal;
    fieldConfidences.journal = 0.76;
    spanTexts.journal = journal;
  } else if (!parsed.journal && !parsed.conferenceTitle && !parsed.bookTitle && volumeIssueWithoutPages?.groups) {
    const journal = stripTrailingPunctuation(volumeIssueWithoutPages.groups.journal?.trim() ?? '');
    const volume = volumeIssueWithoutPages.groups.volume?.trim() ?? '';
    const issue = volumeIssueWithoutPages.groups.issueParen?.trim() || volumeIssueWithoutPages.groups.issueWord?.trim() || '';
    if (journal && looksPublisherYearOnlyLocator(journal, volume, issue)) {
      const publisher = normalizePublisherCandidate(journal, titleSegment);
      if (publisher) {
        fields.publisher = publisher;
        fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.74);
        spanTexts.publisher = journal;
      }
      if (!fields.year && isYearLikeLocatorValue(volume)) {
        fields.year = Number(volume);
        fieldConfidences.year = Math.max(fieldConfidences.year ?? 0, 0.74);
        spanTexts.year = volume;
      }
    } else if (journal) {
      fields.journal = journal;
      fieldConfidences.journal = 0.74;
      spanTexts.journal = journal;
    }
  } else if (
    !parsed.journal
    && !parsed.conferenceTitle
    && !parsed.bookTitle
    && remainderAfterTitle
    && looksPublisherLike(getLastClause(remainderAfterTitle))
  ) {
    const publisher = normalizePublisherCandidate(getLastClause(remainderAfterTitle), titleSegment);
    if (publisher && !looksLowQualityContainerCandidate(publisher)) {
      fields.publisher = publisher;
      fieldConfidences.publisher = 0.68;
      spanTexts.publisher = publisher;
    }
  } else if (
    !parsed.journal
    && !parsed.conferenceTitle
    && !parsed.bookTitle
    && looksInstitutionalContainer(remainderAfterTitle)
  ) {
    const institution = normalizeInstitutionCandidate(
      getLastClause(remainderAfterTitle),
      parsed.year ?? yearMatch?.year,
    );
    if (institution) {
      fields.institution = institution;
      fieldConfidences.institution = 0.68;
      spanTexts.institution = institution;
    }
  } else if (
    !parsed.journal
    && !parsed.conferenceTitle
    && !parsed.bookTitle
    && !parsed.siteName
    && (urlMatch?.[0] || hasWebpageAccessCue(normalizedRaw))
    && !isDoiUrl(urlMatch?.[0])
    && remainderAfterTitle
    && !looksScholarlyRemainder(venueRemainder)
  ) {
    const siteName = normalizeSiteNameCandidate(getLastClause(remainderAfterTitle));
    if (siteName && !looksLowQualityContainerCandidate(siteName) && !looksPublisherLike(siteName) && !looksInstitutionalContainer(siteName)) {
      fields.siteName = siteName;
      fieldConfidences.siteName = 0.65;
      spanTexts.siteName = siteName;
    }
  } else if (remainderAfterTitle) {
    const finalClause = getLastClause(remainderAfterTitle);
    if (looksPublisherLike(finalClause)) {
      fields.publisher = normalizePublisherCandidate(finalClause, titleSegment);
      fieldConfidences.publisher = 0.67;
      spanTexts.publisher = finalClause;
    }
  }

  if (
    corporateInstitution
    && (
      !fields.institution
      || (
        typeof fields.siteName === 'string'
        && normalizeComparableText(String(fields.institution)) === normalizeComparableText(fields.siteName)
      )
    )
    && (fields.siteName || looksInstitutionalContainer(remainderAfterTitle))
  ) {
    fields.institution = corporateInstitution;
    fieldConfidences.institution = 0.66;
    spanTexts.institution = authorSegment;
  }

  let recoveredPlaceholderDoiBook: ReturnType<typeof parsePlaceholderDoiBookReference> | null = null;
  if ((!fields.title || !fields.publisher) && hasPlaceholderDoiTailFlag) {
    recoveredPlaceholderDoiBook =
      parsePlaceholderDoiBookReference(raw) ?? recoverLoosePlaceholderDoiBookReference(raw);
  }
  if (recoveredPlaceholderDoiBook) {
    const recoveredAuthors = recoveredPlaceholderDoiBook.authorSegment
      ? parseAuthorSegment(recoveredPlaceholderDoiBook.authorSegment)
      : [];
    if (
      recoveredPlaceholderDoiBook.authorSegment
      && (
        !Array.isArray(fields.authors)
        || fields.authors.length === 0
        || !isValidAuthorSpanText(recoveredPlaceholderDoiBook.authorSegment, fields.authors)
      )
      && recoveredAuthors.length > 0
    ) {
      fields.authors = recoveredAuthors;
      fieldConfidences.authors = Math.max(fieldConfidences.authors ?? 0, 0.76);
      spanTexts.authors = recoveredPlaceholderDoiBook.authorSegment;
    }
    if (!fields.title && recoveredPlaceholderDoiBook.title) {
      fields.title = normalizeTitleCandidate(recoveredPlaceholderDoiBook.title) ?? recoveredPlaceholderDoiBook.title;
      fieldConfidences.title = Math.max(fieldConfidences.title ?? 0, 0.8);
      spanTexts.title = recoveredPlaceholderDoiBook.title;
      titleSegment = recoveredPlaceholderDoiBook.title;
    }
    if (!fields.publisher && recoveredPlaceholderDoiBook.publisher) {
      fields.publisher = normalizePublisherCandidate(
        recoveredPlaceholderDoiBook.publisher,
        typeof fields.title === 'string' ? fields.title : titleSegment,
      );
      fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.74);
      spanTexts.publisher = recoveredPlaceholderDoiBook.publisher;
    }
    parsed.typeHint ??= 'book';
  }

  const shouldRecoverNumericConference =
    family === 'numeric'
    && (
      !fields.title
      || !fields.publisher
      || !fields.conferenceTitle
      || (typeof fields.title === 'string' && looksLikeAuthorSpill(fields.title))
      || (
        typeof fields.journal === 'string'
        && typeof fields.publisher === 'string'
        && normalizeComparableText(fields.journal).includes(
          normalizeComparableText(fields.publisher),
        )
      )
    );
  const recoveredNumericConference = shouldRecoverNumericConference
    ? recoverStrongNumericConferencePublisherTail(raw)
    : null;
  if (recoveredNumericConference) {
    const recoveredAuthors = recoveredNumericConference.authorSegment
      ? parseRecoverableNumericConferenceAuthors(recoveredNumericConference.authorSegment)
      : [];
    if (
      recoveredNumericConference.authorSegment
      && (
        !Array.isArray(fields.authors)
        || fields.authors.length === 0
        || (recoveredAuthors.length > 0 && fields.authors.length > recoveredAuthors.length)
        || !isValidAuthorSpanText(recoveredNumericConference.authorSegment, fields.authors)
      )
      && recoveredAuthors.length > 0
    ) {
      fields.authors = recoveredAuthors;
      fieldConfidences.authors = Math.max(fieldConfidences.authors ?? 0, 0.78);
      spanTexts.authors = recoveredNumericConference.authorSegment;
    }
    const currentTitle = typeof fields.title === 'string' ? fields.title : null;
    const recoveredConferenceTitleText = recoveredNumericConference.title ?? null;
    const recoveredConferenceTitleWordCount = recoveredConferenceTitleText
      ? recoveredConferenceTitleText.split(/\s+/u).filter(Boolean).length
      : 0;
    const shouldOverrideRecoveredConferenceTitle =
      Boolean(recoveredConferenceTitleText)
      && (
        !currentTitle
        || looksLikeAuthorSpill(currentTitle)
        || (
          currentTitle.split(/\s+/u).filter(Boolean).length <= 4
          && recoveredConferenceTitleWordCount >= 6
        )
      );
    if (shouldOverrideRecoveredConferenceTitle && recoveredConferenceTitleText) {
      fields.title = recoveredConferenceTitleText;
      fieldConfidences.title = Math.max(fieldConfidences.title ?? 0, 0.82);
      spanTexts.title = recoveredConferenceTitleText;
      titleSegment = recoveredConferenceTitleText;
    }
    if (!fields.publisher && recoveredNumericConference.publisher) {
      fields.publisher = normalizePublisherCandidate(
        recoveredNumericConference.publisher,
        typeof fields.title === 'string' ? fields.title : titleSegment,
      );
      fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.76);
      spanTexts.publisher = recoveredNumericConference.publisher;
    }
    if (!fields.pages && recoveredNumericConference.pages) {
      fields.pages = normalizePages(recoveredNumericConference.pages);
      fieldConfidences.pages = Math.max(fieldConfidences.pages ?? 0, 0.74);
      spanTexts.pages = recoveredNumericConference.pages;
    }
    const recoveredConferenceTitle =
      recoverConferenceTitleFromDoiHint(
        typeof fields.doi === 'string' ? fields.doi : extractRelaxedDoi(raw) ?? undefined,
        typeof fields.year === 'number' ? fields.year : recoveredNumericConference.year,
      )
      ?? parsed.conferenceTitle
      ?? null;
    if (!fields.conferenceTitle && recoveredConferenceTitle) {
      fields.conferenceTitle = normalizeConferenceTitle(recoveredConferenceTitle);
      fieldConfidences.conferenceTitle = Math.max(fieldConfidences.conferenceTitle ?? 0, 0.78);
      spanTexts.conferenceTitle = recoveredConferenceTitle;
    }
    if (!fields.year && recoveredNumericConference.year != null) {
      fields.year = recoveredNumericConference.year;
      fieldConfidences.year = Math.max(fieldConfidences.year ?? 0, 0.94);
      spanTexts.year = String(recoveredNumericConference.year);
    }
    const recoveredConferenceJournalSpill =
      typeof fields.journal === 'string'
      && recoveredNumericConference.title != null
      && normalizeComparableText(fields.journal).includes(
        normalizeComparableText(recoveredNumericConference.title),
      )
      && (
        !recoveredNumericConference.publisher
        || normalizeComparableText(fields.journal).includes(
          normalizeComparableText(recoveredNumericConference.publisher),
        )
      );
    if (recoveredConferenceJournalSpill) {
      fields.journal = null;
      delete fieldConfidences.journal;
      delete spanTexts.journal;
    }
    if (
      typeof fields.volume === 'string'
      && recoveredNumericConference.year != null
      && normalizeComparableText(fields.volume) === normalizeComparableText(String(recoveredNumericConference.year))
    ) {
      fields.volume = null;
      delete fieldConfidences.volume;
      delete spanTexts.volume;
    }
    parsed.typeHint ??= 'conference-paper';
  }

  // Comma-delimited-FIELDS recovery: "Author, Title, Journal, YEAR;VOL(ISSUE):PAGES" (numbered
  // IEEE/engineering bibliographies). The span detector over-extends the author span here, so the
  // title arrives as a garbage tail (";", "(N)", a month). Re-derive from raw and fill only the
  // missing/garbage fields. The recovery itself is strict (bare ", YEAR" tail required), so clean
  // APA/Vancouver/parenthetical-year refs return null and are untouched.
  const commaFieldsTitleBad =
    !fields.title
    || (
      typeof fields.title === 'string'
      && (
        looksLikeAuthorSpill(fields.title)
        || /[;:]|\(\d+\)/.test(fields.title)
        || /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(fields.title.trim())
        || /,\s/.test(fields.title)
      )
    );
  const recoveredCommaFields = (commaFieldsTitleBad || !fields.journal)
    ? recoverCommaDelimitedFieldsReference(raw)
    : null;
  if (recoveredCommaFields) {
    const recoveredCommaAuthors = parseAuthorSegment(recoveredCommaFields.authorSegment);
    if (
      recoveredCommaAuthors.length > 0
      && (
        !Array.isArray(fields.authors)
        || fields.authors.length === 0
        || !isValidAuthorSpanText(recoveredCommaFields.authorSegment, fields.authors)
      )
    ) {
      fields.authors = recoveredCommaAuthors;
      fieldConfidences.authors = Math.max(fieldConfidences.authors ?? 0, 0.76);
      spanTexts.authors = recoveredCommaFields.authorSegment;
    }
    if (commaFieldsTitleBad && recoveredCommaFields.title) {
      fields.title = normalizeTitleCandidate(recoveredCommaFields.title) ?? recoveredCommaFields.title;
      fieldConfidences.title = Math.max(fieldConfidences.title ?? 0, 0.78);
      spanTexts.title = recoveredCommaFields.title;
      titleSegment = recoveredCommaFields.title;
    }
    if (!fields.journal && recoveredCommaFields.journal) {
      fields.journal = recoveredCommaFields.journal;
      fieldConfidences.journal = Math.max(fieldConfidences.journal ?? 0, 0.72);
      spanTexts.journal = recoveredCommaFields.journal;
    }
    if (!fields.publisher && recoveredCommaFields.publisher) {
      // Book tail ("Vol. N. Publisher"): the standard pass often mislabels the publisher as journal;
      // clear that so it isn't deduped away when we set the real publisher.
      if (
        !recoveredCommaFields.journal
        && typeof fields.journal === 'string'
        && normalizeComparableText(fields.journal) === normalizeComparableText(recoveredCommaFields.publisher)
      ) {
        fields.journal = null;
        delete fieldConfidences.journal;
        delete spanTexts.journal;
      }
      fields.publisher = recoveredCommaFields.publisher;
      fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.72);
      spanTexts.publisher = recoveredCommaFields.publisher;
    }
    if (!fields.year && recoveredCommaFields.year != null) {
      fields.year = recoveredCommaFields.year;
      fieldConfidences.year = Math.max(fieldConfidences.year ?? 0, 0.9);
      spanTexts.year = String(recoveredCommaFields.year);
    }
    if (!fields.volume && recoveredCommaFields.volume) {
      fields.volume = recoveredCommaFields.volume;
      fieldConfidences.volume = Math.max(fieldConfidences.volume ?? 0, 0.8);
      spanTexts.volume = recoveredCommaFields.volume;
    }
    if (!fields.issue && recoveredCommaFields.issue) {
      fields.issue = recoveredCommaFields.issue;
      fieldConfidences.issue = Math.max(fieldConfidences.issue ?? 0, 0.78);
      spanTexts.issue = recoveredCommaFields.issue;
    }
    if (!fields.pages && recoveredCommaFields.pages) {
      fields.pages = normalizePages(recoveredCommaFields.pages);
      fieldConfidences.pages = Math.max(fieldConfidences.pages ?? 0, 0.78);
      spanTexts.pages = recoveredCommaFields.pages;
    }
  }

  repairConflictingContainerFields(fields, {
    raw: normalizedRaw,
    title: typeof fields.title === 'string' ? fields.title : titleSegment,
    year: typeof fields.year === 'number' ? fields.year : parsed.year ?? yearMatch?.year,
    referenceType: referenceType ?? parsed.typeHint ?? null,
    precomputed: {
      parseableRaw,
      rawHasThesisCue,
      rawHasReportCue,
      rawHasConferenceCue,
      rawHasWebsiteAccessMarker,
      rawHasNonDoiUrl,
      rawHasDoiOnlyUrl,
      rawHasWebpageOwnerTailProfile,
    },
  });

  const recoveredBookChapter = looksBookChapterDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
    ? recoverBookChapterFromRaw(normalizedRaw)
    : null;
  if (recoveredBookChapter) {
    fields.title = recoveredBookChapter.title;
    fieldConfidences.title = Math.max(fieldConfidences.title ?? 0, 0.84);
    spanTexts.title = recoveredBookChapter.title;

    fields.bookTitle = recoveredBookChapter.bookTitle;
    fieldConfidences.bookTitle = Math.max(fieldConfidences.bookTitle ?? 0, 0.84);
    spanTexts.bookTitle = recoveredBookChapter.bookTitle;

    if (recoveredBookChapter.pages) {
      fields.pages = recoveredBookChapter.pages;
      fieldConfidences.pages = Math.max(fieldConfidences.pages ?? 0, 0.82);
      spanTexts.pages = recoveredBookChapter.pages;
    }

    if (recoveredBookChapter.publisher) {
      fields.publisher = recoveredBookChapter.publisher;
      fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.82);
      spanTexts.publisher = recoveredBookChapter.publisher;
    }

    fields.journal = null;
    delete fieldConfidences.journal;
    delete spanTexts.journal;
    fields.conferenceTitle = null;
    delete fieldConfidences.conferenceTitle;
    delete spanTexts.conferenceTitle;
    referenceType = 'book-chapter';
    parsed.typeHint = 'book-chapter';
  }

  if (typeof fields.title === 'string' && typeof fields.bookTitle === 'string') {
    const quotedOverflowMatch = fields.bookTitle.match(
      /^(?<fragment>.+?)["”]\s*,?\s*(?<rest>.+)$/u,
    );
    const rawQuotedTitle = stripTrailingPunctuation(
      normalizeInlineQuoteCharacters(normalizedRaw).match(/"(?<quoted>[^"]{2,220})"/u)?.groups?.quoted
        ?? '',
    );
    const overflowFragment = quotedOverflowMatch?.groups?.fragment
      ? stripTrailingPunctuation(quotedOverflowMatch.groups.fragment)
      : null;
    const overflowRest = quotedOverflowMatch?.groups?.rest
      ? normalizeConferenceTitle(quotedOverflowMatch.groups.rest)
      : null;
    if (
      rawQuotedTitle
      && overflowFragment
      && overflowRest
      && !looksLowQualityContainerCandidate(overflowRest)
      && normalizeComparableText(rawQuotedTitle).startsWith(normalizeComparableText(fields.title))
      && normalizeComparableText(rawQuotedTitle).includes(normalizeComparableText(overflowFragment))
      && normalizeComparableText(rawQuotedTitle) !== normalizeComparableText(fields.title)
    ) {
      fields.title = rawQuotedTitle;
      fields.bookTitle = overflowRest;
    }
  }

  const repeatedInstitutionTail = remainderAfterTitle
    ? normalizeInstitutionCandidate(
      splitSentenceClauses(stripIdentifierTail(remainderAfterTitle))
        .map((clause) => stripTrailingPunctuation(clause))
        .filter(Boolean)
        .at(-1),
      parsed.year ?? yearMatch?.year,
    )
    : null;
  const hasRepeatedCorporateInstitutionTail =
    corporateInstitution != null
    && repeatedInstitutionTail != null
    && normalizeComparableText(corporateInstitution) === normalizeComparableText(repeatedInstitutionTail);
  const hasArticleLocators =
    typeof fields.volume === 'string'
    || typeof fields.issue === 'string'
    || typeof fields.pages === 'string';
  const articleLikeContainerProfile =
    hasArticleLocators
    || typeof fields.issn === 'string';
  const titleEmbedsConferenceFalsePositive =
    typeof fields.title === 'string'
    && typeof fields.conferenceTitle === 'string'
    && normalizeComparableText(fields.conferenceTitle).length >= 12
    && normalizeComparableText(fields.title).includes(normalizeComparableText(fields.conferenceTitle))
    && articleLikeContainerProfile
    && !looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
    && !/\bpaper presented at\b/iu.test(normalizedRaw);
  const hasPreprintRoutingCue =
    looksPreprintCue(normalizedRaw)
    || typeof fields.repository === 'string'
    || /10\.(?:2139\/ssrn\.|20944\/preprints|21203\/rs\.|36227\/techrxiv\.|2196\/preprints?)/iu.test(
      typeof fields.doi === 'string' ? fields.doi : normalizedRaw,
    );
  const hasConferenceRoutingCue =
    /\bpaper presented at\b/iu.test(normalizedRaw)
    || (
      CONFERENCE_CUE_REGEX.test(normalizedRaw)
      && !titleEmbedsConferenceFalsePositive
      && !hasPreprintRoutingCue
    )
    || looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined);
  const hasWebRoutingCue =
    hasWebpageAccessCue(normalizedRaw)
    || (
      typeof fields.url === 'string'
      && fields.url.length > 0
      && !isDoiUrl(fields.url)
    );

  if (
    hasRepeatedCorporateInstitutionTail
    && !hasArticleLocators
    && !hasConferenceRoutingCue
    && !hasWebRoutingCue
    && !thesisCue
    && !fields.isbn
    && !(typeof fields.doi === 'string' && /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(fields.doi))
    && !fields.conferenceTitle
    && !fields.bookTitle
  ) {
    fields.institution = corporateInstitution;
    fieldConfidences.institution = Math.max(fieldConfidences.institution ?? 0, 0.82);
    spanTexts.institution = authorSegment;

    if (typeof fields.title === 'string') {
      const titleClauses = splitSentenceClauses(fields.title)
        .map((clause) => stripTrailingPunctuation(clause))
        .filter(Boolean);
      const repeatedTailInTitle = titleClauses.at(-1);
      if (
        titleClauses.length >= 2
        && repeatedTailInTitle
        && normalizeComparableText(repeatedTailInTitle) === normalizeComparableText(corporateInstitution)
      ) {
        fields.title = normalizeTitleCandidate(titleClauses.slice(0, -1).join(' ')) ?? fields.title;
      }
    }

    if (
      typeof fields.publisher === 'string'
      && normalizeComparableText(fields.publisher) === normalizeComparableText(corporateInstitution)
    ) {
      fields.publisher = null;
      delete fieldConfidences.publisher;
      delete spanTexts.publisher;
    }

    if (
      typeof fields.journal === 'string'
      && normalizeComparableText(fields.journal) === normalizeComparableText(corporateInstitution)
    ) {
      fields.journal = null;
      delete fieldConfidences.journal;
      delete spanTexts.journal;
    }

    if (
      typeof fields.siteName === 'string'
      && normalizeComparableText(fields.siteName) === normalizeComparableText(corporateInstitution)
    ) {
      fields.siteName = null;
      delete fieldConfidences.siteName;
      delete spanTexts.siteName;
    }

    fields.journal = null;
    delete fieldConfidences.journal;
    delete spanTexts.journal;

    referenceType = 'report';
    parsed.typeHint = 'report';
  }

  if (
    typeof fields.conferenceTitle === 'string'
    && hasPreprintRoutingCue
    && !/\bpaper presented at\b/iu.test(normalizedRaw)
    && !looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
  ) {
    const normalizedConferenceTitle = normalizeConferenceTitle(fields.conferenceTitle);
    const normalizedRepository = typeof fields.repository === 'string'
      ? normalizeConferenceTitle(fields.repository)
      : null;
    const normalizedPublisher = typeof fields.publisher === 'string'
      ? normalizeConferenceTitle(fields.publisher)
      : null;
    if (
      !looksConferencePublicationVenue(normalizedConferenceTitle)
      || /\bpreprint\b/iu.test(normalizedConferenceTitle)
      || (
        normalizedRepository
        && normalizeComparableText(normalizedConferenceTitle) === normalizeComparableText(normalizedRepository)
      )
      || (
        normalizedPublisher
        && normalizeComparableText(normalizedConferenceTitle) === normalizeComparableText(normalizedPublisher)
      )
    ) {
      fields.conferenceTitle = null;
      delete fieldConfidences.conferenceTitle;
      delete spanTexts.conferenceTitle;
    }
  }

  if (
    !fields.isbn
    && typeof fields.doi === 'string'
    && (
      typeof fields.bookTitle === 'string'
      || (
        typeof fields.publisher === 'string'
        && resolveReferenceTypeForFieldGuards(fields, referenceType ?? parsed.typeHint ?? null) === 'book'
      )
    )
  ) {
    const inferredIsbn = inferPreferredIsbnFromIdentifier(fields.doi, {
      raw,
      bookTitle: typeof fields.bookTitle === 'string' ? fields.bookTitle : null,
      publisher: typeof fields.publisher === 'string' ? fields.publisher : null,
    });
    if (inferredIsbn) {
      fields.isbn = inferredIsbn;
      fieldConfidences.isbn = Math.max(fieldConfidences.isbn ?? 0, 0.78);
      spanTexts.isbn = fields.doi;
    }
  }

  const hasBookishDoiIdentifier =
    typeof fields.doi === 'string'
    && (
      inferIsbnFromIdentifier(fields.doi) != null
      || looksBookChapterDoi(fields.doi)
    );
  const institutionLead = typeof fields.institution === 'string'
    ? normalizeInstitutionCandidate(fields.institution, typeof fields.year === 'number' ? fields.year : parsed.year ?? yearMatch?.year)
    : null;
  const publisherInstitutionLead = typeof fields.publisher === 'string'
    ? normalizeInstitutionCandidate(fields.publisher, typeof fields.year === 'number' ? fields.year : parsed.year ?? yearMatch?.year)
    : null;
  const publisherLead = typeof fields.publisher === 'string'
    ? stripTrailingPunctuation(fields.publisher).trim() || null
    : null;
  const corporateLead = institutionLead ?? (hasBookishDoiIdentifier ? (publisherInstitutionLead ?? publisherLead) : null);
  const normalizedRawLead = normalizeExtractionInput(normalizedRaw);
  const currentAuthors = Array.isArray(fields.authors)
    ? fields.authors
      .map((author) => toCanonicalAuthor(author))
      .filter((author): author is NonNullable<typeof author> => author != null)
    : [];
  const hasWeakSingleAuthor =
    currentAuthors.length === 1
    && !currentAuthors[0]?.isCorporate
    && !String(currentAuthors[0]?.given ?? '').trim()
    && !/\s/u.test(currentAuthors[0]?.family ?? '');
  const singleAuthorComparable: string =
    currentAuthors.length === 1
      ? [
        currentAuthors[0]?.literal,
        [currentAuthors[0]?.given, currentAuthors[0]?.family].filter(Boolean).join(' '),
        [currentAuthors[0]?.family, currentAuthors[0]?.given].filter(Boolean).join(' '),
      ]
        .map((value) => normalizeComparableText(String(value ?? '')))
        .find((value) => value.length > 0)
        ?? ''
      : '';
  const hasSingleInstitutionLikeAuthor =
    currentAuthors.length === 1
    && !currentAuthors[0]?.isCorporate
    && corporateLead != null
    && (
      singleAuthorComparable === normalizeComparableText(corporateLead)
      || (
        singleAuthorComparable.length > 0
        && normalizeComparableText(corporateLead).startsWith(singleAuthorComparable)
        && singleAuthorComparable.split(/\s+/u).length <= 2
      )
    );

  if (
    corporateLead
    && normalizedRawLead.startsWith(`${corporateLead}.`)
    && (
      hasBookishDoiIdentifier
      || (parsed.typeHint !== 'report' && referenceType !== 'report')
    )
    && (currentAuthors.length === 0 || hasWeakSingleAuthor || (hasBookishDoiIdentifier && hasSingleInstitutionLikeAuthor))
  ) {
    const corporateAuthor = toCanonicalAuthor({
      family: corporateLead,
      literal: corporateLead,
      isCorporate: true,
    });
    if (corporateAuthor) {
      fields.authors = [corporateAuthor];
      fieldConfidences.authors = Math.max(fieldConfidences.authors ?? 0, 0.78);
      spanTexts.authors = corporateLead;
    }
  }

  if (
    !fields.publisher
    && typeof fields.institution === 'string'
    && typeof fields.isbn === 'string'
    && fields.isbn.trim().length > 0
    && normalizedRawLead.includes(`${fields.institution}, ${String(fields.year ?? parsed.year ?? '')}`)
  ) {
    fields.publisher = fields.institution;
    fields.institution = null;
    fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.76);
    spanTexts.publisher = String(fields.publisher);
  }

  if (
    !fields.publisher
    && (
      !fields.journal
      || (
        typeof fields.journal === 'string'
        && looksPublisherYearOnlyLocator(
          fields.journal,
          typeof fields.volume === 'string' ? fields.volume : null,
          typeof fields.issue === 'string' ? fields.issue : null,
        )
      )
    )
    && !fields.conferenceTitle
    && !fields.bookTitle
    && typeof fields.title === 'string'
  ) {
    const recoveredPublisherTail = recoverPublisherYearTailFromRaw(normalizedRaw, fields.title);
    if (recoveredPublisherTail) {
      fields.publisher = recoveredPublisherTail.publisher;
      fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.74);
      spanTexts.publisher = recoveredPublisherTail.publisher;
      if (
        typeof fields.journal === 'string'
        && looksPublisherYearOnlyLocator(
          fields.journal,
          typeof fields.volume === 'string' ? fields.volume : null,
          typeof fields.issue === 'string' ? fields.issue : null,
        )
      ) {
        fields.journal = null;
        fields.volume = null;
      }
      if (!fields.year && recoveredPublisherTail.year) {
        fields.year = recoveredPublisherTail.year;
        fieldConfidences.year = Math.max(fieldConfidences.year ?? 0, 0.74);
        spanTexts.year = String(recoveredPublisherTail.year);
      }
    }
  }

  if (
    typeof fields.publisher === 'string'
    && typeof fields.title === 'string'
    && typeof fields.bookTitle !== 'string'
    && typeof fields.conferenceTitle !== 'string'
  ) {
    const parseableNormalizedRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(normalizedRaw));
    const titleOverflowMatch = parseableNormalizedRaw.match(
      new RegExp(
        `${escapeRegex(stripTrailingPunctuation(fields.title))}(?<overflow>,\\s*[^.]{3,180})\\.\\s*${escapeRegex(fields.publisher)}[,;]`,
        'iu',
      ),
    );
    const overflow = titleOverflowMatch?.groups?.overflow?.trim();
    if (overflow) {
      fields.title = `${stripTrailingPunctuation(fields.title)}${overflow}`.replace(/\s+/g, ' ').trim();
      fieldConfidences.title = Math.max(fieldConfidences.title ?? 0, 0.8);
      spanTexts.title = String(fields.title);
    }
  }

  if (!fields.issn && typeof fields.journal === 'string') {
    const hintedIssn = lookupIssnByJournalTitle(fields.journal);
    if (hintedIssn) {
      fields.issn = normalizeIssn(hintedIssn) ?? hintedIssn;
      fieldConfidences.issn = 0.76;
      spanTexts.issn = fields.journal;
    }
  }

  if (!parsed.volume && volumeIssuePages) {
    const volume = volumeIssuePages[1];
    const issue = volumeIssuePages[2];
    const pages = volumeIssuePages[3];
    if (volume) {
      fields.volume = volume;
      fieldConfidences.volume = 0.82;
      spanTexts.volume = volume;
    }
    if (issue) {
      fields.issue = issue;
      fieldConfidences.issue = 0.78;
      spanTexts.issue = issue;
    }
    if (pages && (!fields.year || normalizeComparableText(pages) !== normalizeComparableText(String(fields.year)))) {
      fields.pages = normalizePages(pages);
      fieldConfidences.pages = 0.77;
      spanTexts.pages = pages;
    }
  } else if (!parsed.volume && volumeIssueWithoutPages?.groups) {
    const journalFromLocator = volumeIssueWithoutPages.groups.journal?.trim();
    const volume = volumeIssueWithoutPages.groups.volume?.trim();
    const issue = volumeIssueWithoutPages.groups.issueParen?.trim() || volumeIssueWithoutPages.groups.issueWord?.trim();
    if (journalFromLocator && looksPublisherYearOnlyLocator(journalFromLocator, volume, issue)) {
      const normalizedPublisher = normalizePublisherCandidate(journalFromLocator, typeof fields.title === 'string' ? fields.title : titleSegment);
      if (!fields.publisher && normalizedPublisher) {
        fields.publisher = normalizedPublisher;
        fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.74);
        spanTexts.publisher = journalFromLocator;
      }
      if (!fields.year && isYearLikeLocatorValue(volume)) {
        fields.year = Number(volume);
        fieldConfidences.year = Math.max(fieldConfidences.year ?? 0, 0.74);
        spanTexts.year = volume ?? '';
      }
    } else {
      if (!fields.journal && journalFromLocator) {
        const normalizedJournal = normalizeJournalCandidate(journalFromLocator, typeof fields.title === 'string' ? fields.title : titleSegment);
        if (normalizedJournal) {
          fields.journal = normalizedJournal;
          fieldConfidences.journal = 0.82;
          spanTexts.journal = journalFromLocator;
        }
      }
      if (volume) {
        fields.volume = volume;
        fieldConfidences.volume = 0.8;
        spanTexts.volume = volume;
      }
      if (issue) {
        fields.issue = issue;
        fieldConfidences.issue = 0.76;
        spanTexts.issue = issue;
      }
    }
  } else if (!parsed.pages && pagesOnly?.[1]) {
    const normalizedPages = normalizePages(pagesOnly[1]);
    if (!fields.year || normalizeComparableText(normalizedPages) !== normalizeComparableText(String(fields.year))) {
      fields.pages = normalizedPages;
      fieldConfidences.pages = 0.68;
      spanTexts.pages = pagesOnly[1];
    }
  }

  if (/Retrieved from|Accessed/i.test(raw) && !fields.accessedDate) {
    const accessedDate = raw.match(/(?:Accessed|Retrieved)\s+(.*?)(?:\.|$)/i)?.[1]?.trim();
    if (accessedDate) {
      fields.accessedDate = accessedDate;
      fieldConfidences.accessedDate = 0.72;
      spanTexts.accessedDate = accessedDate;
    }
  }

  if (
    !fields.publisher
    && typeof fields.title === 'string'
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && typeof fields.doi === 'string'
  ) {
    const recoveredConferencePublisher =
      recoverStandaloneConferencePublisherSlot(
        normalizedRaw,
        fields.title,
        typeof fields.conferenceTitle === 'string' ? fields.conferenceTitle : null,
      )
      ?? recoverLooseConferencePublisherSlot(
        normalizedRaw,
        fields.title,
        typeof fields.conferenceTitle === 'string' ? fields.conferenceTitle : null,
      );
    if (
      recoveredConferencePublisher
      && (
        CONFERENCE_DOI_REGEX.test(fields.doi)
        || looksProceedingsLikeDoi(fields.doi)
        || (typeof fields.journal === 'string' && CONFERENCE_KEYWORD_REGEX.test(fields.journal))
      )
    ) {
      fields.publisher = recoveredConferencePublisher;
      fieldConfidences.publisher = Math.max(fieldConfidences.publisher ?? 0, 0.78);
      spanTexts.publisher = recoveredConferencePublisher;
      if (
        typeof fields.journal === 'string'
        && normalizeComparableText(fields.journal) !== normalizeComparableText(recoveredConferencePublisher)
        && normalizeComparableText(recoveredConferencePublisher).includes(normalizeComparableText(fields.journal))
      ) {
        fields.journal = null;
        delete fieldConfidences.journal;
        delete spanTexts.journal;
      }
    }
  }

  if (
    !fields.conferenceTitle
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && typeof fields.journal === 'string'
    && CONFERENCE_KEYWORD_REGEX.test(fields.journal)
  ) {
    fields.conferenceTitle = normalizeConferenceTitle(fields.journal);
    fieldConfidences.conferenceTitle = Math.max(fieldConfidences.conferenceTitle ?? 0, 0.8);
    spanTexts.conferenceTitle = String(fields.conferenceTitle);
    fields.journal = null;
    delete fieldConfidences.journal;
    delete spanTexts.journal;
  }

  if (
    typeof fields.publisher === 'string'
    && typeof fields.journal === 'string'
    && (
      fields.volume
      || fields.issue
      || fields.pages
    )
    && !looksPublisherLike(fields.publisher)
    && !looksInstitutionalContainer(fields.publisher)
    && normalizeComparableText(fields.publisher).includes(normalizeComparableText(fields.journal))
  ) {
    const repairedArticlePublisherSpill = repairArticlePublisherLocatorSpill(
      normalizedRaw,
      typeof fields.title === 'string' ? fields.title : null,
      fields.journal,
      fields.publisher,
    );
    if (repairedArticlePublisherSpill?.title) {
      fields.title = repairedArticlePublisherSpill.title;
      fieldConfidences.title = Math.max(fieldConfidences.title ?? 0, 0.8);
      spanTexts.title = repairedArticlePublisherSpill.title;
    }
    fields.publisher = null;
    delete fieldConfidences.publisher;
    delete spanTexts.publisher;
  }

  if (
    typeof fields.publisher === 'string'
    && (
      fields.volume
      || fields.issue
      || fields.pages
    )
  ) {
    const editionJournalMatch = fields.publisher.match(
      /^(?<edition>\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?)\s+(?<journal>.+)$/iu,
    );
    const recoveredJournal = editionJournalMatch?.groups?.journal
      ? (
        normalizeJournalCandidate(editionJournalMatch.groups.journal, typeof fields.title === 'string' ? fields.title : titleSegment)
        ?? stripTrailingPunctuation(editionJournalMatch.groups.journal).trim()
      )
      : null;

    if (editionJournalMatch?.groups?.edition && recoveredJournal) {
      const normalizedEdition = stripTrailingPunctuation(editionJournalMatch.groups.edition);
      if (
        typeof fields.title === 'string'
        && normalizedEdition
        && !normalizeComparableText(fields.title).includes(normalizeComparableText(normalizedEdition))
      ) {
        fields.title = `${stripTrailingPunctuation(fields.title)}, ${normalizedEdition}`;
        fieldConfidences.title = Math.max(fieldConfidences.title ?? 0, 0.8);
        spanTexts.title = String(fields.title);
      }
      fields.journal = recoveredJournal;
      fieldConfidences.journal = Math.max(fieldConfidences.journal ?? 0, 0.78);
      spanTexts.journal = recoveredJournal;
      fields.publisher = null;
      delete fieldConfidences.publisher;
      delete spanTexts.publisher;
    }
  }

  if (
    !fields.journal
    && typeof fields.conferenceTitle === 'string'
    && fields.conferenceTitle.trim().length > 0
    && (
      !looksCompactConferenceVenueAlias(fields.conferenceTitle)
      || looksJournalLikeContainer(fields.conferenceTitle)
      || Boolean(lookupIssnByJournalTitle(fields.conferenceTitle))
    )
    && /\breview\)/iu.test(normalizedRaw)
    && !CONFERENCE_CUE_REGEX.test(normalizedRaw)
    && !looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
    && !looksInstitutionalContainer(fields.conferenceTitle)
    && !looksPublisherLike(fields.conferenceTitle)
  ) {
    const recoveredJournal = normalizeConferenceTitle(fields.conferenceTitle);
    if (recoveredJournal) {
      fields.journal = recoveredJournal;
      fields.conferenceTitle = null;
      fieldConfidences.journal = Math.max(fieldConfidences.journal ?? 0, 0.8);
      spanTexts.journal = recoveredJournal;
      delete fieldConfidences.conferenceTitle;
      delete spanTexts.conferenceTitle;
    }
  }

  if (
    !fields.journal
    && typeof fields.conferenceTitle === 'string'
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
      || typeof fields.issn === 'string'
    )
    && (
      !CONFERENCE_CUE_REGEX.test(normalizedRaw)
      || titleEmbedsConferenceFalsePositive
    )
    && !looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
    && (
      !looksCompactConferenceVenueAlias(fields.conferenceTitle)
      || looksJournalLikeContainer(fields.conferenceTitle)
      || Boolean(lookupIssnByJournalTitle(fields.conferenceTitle))
    )
    && !looksInstitutionalContainer(fields.conferenceTitle)
    && !looksPublisherLike(fields.conferenceTitle)
  ) {
    const recoveredJournal =
      normalizeJournalCandidate(fields.conferenceTitle, typeof fields.title === 'string' ? fields.title : titleSegment)
      ?? normalizeConferenceTitle(fields.conferenceTitle);
    const recoveredTitle =
      typeof fields.title === 'string'
        ? recoverTitleOverflowBeforeContainer(normalizedRaw, fields.title, recoveredJournal)
        : null;
    if (recoveredTitle) {
      fields.title = recoveredTitle;
      fieldConfidences.title = Math.max(fieldConfidences.title ?? 0, 0.8);
      spanTexts.title = recoveredTitle;
    }
    fields.journal = recoveredJournal;
    fields.conferenceTitle = null;
    fieldConfidences.journal = Math.max(fieldConfidences.journal ?? 0, 0.8);
    spanTexts.journal = recoveredJournal;
    delete fieldConfidences.conferenceTitle;
    delete spanTexts.conferenceTitle;
    if (
      typeof fields.institution === 'string'
      && normalizeComparableText(fields.institution).startsWith(normalizeComparableText(recoveredJournal))
    ) {
      fields.institution = null;
    }
  }

  if (
    typeof fields.repository === 'string'
    && typeof fields.conferenceTitle === 'string'
    && !looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
    && !/\bpaper presented at\b/iu.test(normalizedRaw)
  ) {
    const normalizedRepository = normalizeConferenceTitle(fields.repository);
    const normalizedConferenceTitle = normalizeConferenceTitle(fields.conferenceTitle);
    const normalizedPublisher = typeof fields.publisher === 'string'
      ? normalizeConferenceTitle(fields.publisher)
      : null;
    if (
      /\bpreprint\b/iu.test(normalizedRaw)
      || /\bpreprint\b/iu.test(normalizedConferenceTitle)
      || !looksConferencePublicationVenue(normalizedConferenceTitle)
      || normalizeComparableText(normalizedConferenceTitle) === normalizeComparableText(normalizedRepository)
      || (
        normalizedPublisher
        && normalizeComparableText(normalizedConferenceTitle) === normalizeComparableText(normalizedPublisher)
      )
    ) {
      fields.conferenceTitle = null;
      delete fieldConfidences.conferenceTitle;
      delete spanTexts.conferenceTitle;
    }
  }

  clearTitleEmbeddedYearRangePages(fields, fieldConfidences, spanTexts);

  syncRecoveredFieldEvidence(fields, fieldConfidences, spanTexts);
  pruneClearedFieldArtifacts(fields, fieldConfidences, spanTexts);

  const confidenceValues = Object.values(fieldConfidences);
  const overallConfidence = confidenceValues.length > 0
    ? Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(3))
    : 0.4;

  return {
    fields,
    fieldConfidences,
    spanTexts,
    warnings,
    overallConfidence,
  };
}

function pruneClearedFieldArtifacts(
  fields: Partial<Record<ExtractedFieldKey, unknown>>,
  fieldConfidences: Partial<Record<ExtractedFieldKey, number>>,
  spanTexts: Partial<Record<ExtractedFieldKey, string>>,
): void {
  for (const field of EXTRACTED_FIELD_KEYS) {
    const value = fields[field];
    if (value == null || (typeof value === 'string' && value.trim() === '')) {
      delete fieldConfidences[field];
      delete spanTexts[field];
    }
  }
}

function syncRecoveredFieldEvidence(
  fields: Partial<Record<ExtractedFieldKey, unknown>>,
  fieldConfidences: Partial<Record<ExtractedFieldKey, number>>,
  spanTexts: Partial<Record<ExtractedFieldKey, string>>,
): void {
  for (const field of EXTRACTED_FIELD_KEYS) {
    const value = fields[field];
    if (value == null || (typeof value === 'string' && value.trim() === '')) {
      delete fieldConfidences[field];
      delete spanTexts[field];
      continue;
    }

    if (fieldConfidences[field] == null) {
      fieldConfidences[field] = defaultRecoveredFieldConfidence(field);
    }

    const recoveredSpanText = toRecoveredSpanText(field, value);
    if (!recoveredSpanText) {
      delete spanTexts[field];
      continue;
    }

    const currentSpan = spanTexts[field];
    if (
      !currentSpan
      || (
        shouldOverwriteRecoveredSpan(field)
        && normalizeComparableText(currentSpan) !== normalizeComparableText(recoveredSpanText)
      )
    ) {
      spanTexts[field] = recoveredSpanText;
    }
  }
}

function shouldOverwriteRecoveredSpan(field: ExtractedFieldKey): boolean {
  return field === 'title'
    || field === 'journal'
    || field === 'conferenceTitle'
    || field === 'bookTitle'
    || field === 'publisher'
    || field === 'institution'
    || field === 'repository'
    || field === 'siteName';
}

function defaultRecoveredFieldConfidence(field: ExtractedFieldKey): number {
  switch (field) {
    case 'year':
      return 0.96;
    case 'title':
      return 0.8;
    case 'authors':
      return 0.78;
    case 'journal':
      return 0.82;
    case 'volume':
      return 0.8;
    case 'issue':
      return 0.76;
    case 'pages':
      return 0.74;
    case 'conferenceTitle':
    case 'bookTitle':
      return 0.76;
    case 'publisher':
    case 'institution':
    case 'repository':
      return 0.7;
    case 'siteName':
      return 0.72;
    case 'doi':
      return 0.98;
    case 'pmid':
    case 'arxiv':
      return 0.96;
    case 'isbn':
    case 'issn':
    case 'patent':
      return 0.94;
    case 'handle':
      return 0.9;
    case 'url':
      return 0.8;
    case 'articleNumber':
    case 'reportNumber':
    case 'database':
    case 'placeOfPublication':
    case 'edition':
    case 'thesisType':
    case 'accessedDate':
      return 0.72;
    case 'editors':
      return 0.74;
    default:
      return 0.7;
  }
}

function toRecoveredSpanText(field: ExtractedFieldKey, value: unknown): string | null {
  if (field === 'authors' || field === 'editors') {
    return null;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  return null;
}

function buildHeuristicEntities(
  raw: string,
  tokenized: TokenizedInput,
  heuristic: HeuristicEvidence,
): NonNullable<ExtractResult['entities']> {
  const entities: NonNullable<ExtractResult['entities']> = [];
  const occupied = new Set<number>();

  for (const [field, rawText] of Object.entries(heuristic.spanTexts)) {
    if (!rawText || !isExtractedFieldKey(field)) continue;
    const window = findTokenWindow(
      raw,
      tokenized,
      rawText,
      occupied,
      field === 'volume' || field === 'issue' || field === 'pages',
    );
    if (!window) continue;

    const confidence = heuristic.fieldConfidences[field] ?? heuristic.overallConfidence;
    const valid = field === 'authors'
      ? !heuristic.warnings.includes('invalid_author_span')
      : true;

    for (let index = window.tokenStart; index < window.tokenEnd; index += 1) {
      occupied.add(index);
    }

    entities.push({
      field,
      tokenStart: window.tokenStart,
      tokenEnd: window.tokenEnd,
      text: rawText,
      confidence,
      valid,
    });
  }

  return entities;
}

function tokenize(text: string): TokenizedInput {
  const tokens: string[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  const matcher = /\S+/g;

  for (const match of text.matchAll(matcher)) {
    tokens.push(match[0]);
    ranges.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }

  return { tokens, ranges };
}

function findTokenWindow(
  raw: string,
  tokenized: TokenizedInput,
  rawText: string,
  occupied: Set<number>,
  allowOverlap = false,
): TokenWindow | null {
  const normalizedNeedle = normalizeLookup(rawText);
  if (!normalizedNeedle) return null;

  for (let start = 0; start < tokenized.tokens.length; start += 1) {
    if (occupied.has(start)) continue;

    let candidate = '';
    for (let end = start; end < tokenized.tokens.length; end += 1) {
      if (occupied.has(end)) break;
      candidate = normalizeLookup(tokenized.tokens.slice(start, end + 1).join(' '));
      if (candidate === normalizedNeedle) {
        return { tokenStart: start, tokenEnd: end + 1 };
      }
      if (candidate.length > normalizedNeedle.length + 4) break;
    }
  }

  const escapedNeedle = escapeRegex(rawText.trim());
  if (!escapedNeedle) return null;

  for (const match of raw.matchAll(new RegExp(escapedNeedle, 'gi'))) {
    const startOffset = match.index ?? -1;
    if (startOffset < 0) continue;
    const endOffset = startOffset + match[0].length;
    const window = tokenWindowFromOffsets(tokenized, startOffset, endOffset);
    if (!window) continue;
    if (!allowOverlap && rangeHasOccupiedTokens(window, occupied)) continue;
    return window;
  }

  return null;
}

function tokenWindowFromOffsets(
  tokenized: TokenizedInput,
  startOffset: number,
  endOffset: number,
): TokenWindow | null {
  let tokenStart = -1;
  let tokenEnd = -1;

  for (let index = 0; index < tokenized.ranges.length; index += 1) {
    const range = tokenized.ranges[index];
    if (!range) continue;
    if (tokenStart === -1 && range.end > startOffset) tokenStart = index;
    if (range.start < endOffset) tokenEnd = index + 1;
  }

  if (tokenStart === -1 || tokenEnd === -1 || tokenStart >= tokenEnd) {
    return null;
  }

  return { tokenStart, tokenEnd };
}

function rangeHasOccupiedTokens(window: TokenWindow, occupied: Set<number>): boolean {
  for (let index = window.tokenStart; index < window.tokenEnd; index += 1) {
    if (occupied.has(index)) return true;
  }
  return false;
}

function normalizeLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseStructuredReference(
  raw: string,
  family: StyleFamily,
  rawSupport?: RawCitationSupport,
): ParsedReference {
  const support = rawSupport ?? buildRawCitationSupport(raw);
  const parseableStructuredRaw = support.parseableRaw;
  const rawQuotedTitle = support.quotedTitle?.title ?? null;
  const explicitPatent = extractPatentIdentifier(raw);
  if (explicitPatent) {
    const year = extractFirstYear(raw);
    const quotedPatentTitle = rawQuotedTitle;
    const authorSegment = /\b(?:Patent|Application)\b/iu.test(raw)
      ? raw.split(/\b(?:Patent|Application)\b/iu)[0]?.replace(/^[\[\(]?\d+[\]\).]?\s*/, '').trim() ?? ''
      : '';
    const title =
      quotedPatentTitle
      ?? (
        raw
        .replace(new RegExp(escapeRegex(explicitPatent), 'iu'), '')
        .replace(/https?:\/\/(?:www\.)?patents\.google\.com\/patent\/[^\s"'<>]+/iu, '')
        .replace(PATENT_REGEX, '')
        .replace(BARE_PATENT_IDENTIFIER_REGEX, '')
        .replace(/\b(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)\b/gi, '')
        .replace(/\bPatent(?:\s+Application)?(?:\s+No\.?)?\b/gi, '')
        .replace(/\b((?:19|20)\d{2})\b/g, '')
        .replace(/^[\[\(]?\d+[\]\).]?\s*/u, '')
        .replace(/\s+/g, ' ')
        .trim() || undefined
      );

    return {
      ...(authorSegment ? { authorSegment } : {}),
      ...(title ? { title: stripTrailingPunctuation(title) } : {}),
      ...(year != null ? { year } : {}),
      patent: explicitPatent,
      typeHint: 'patent',
    };
  }

  const thesisMatch = raw.match(THESIS_BRACKET_REGEX);
  if (thesisMatch?.groups) {
    const groups = Object.fromEntries(
      Object.entries(thesisMatch.groups).map(([key, value]) => [key, value?.trim() ?? '']),
    );
    return {
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      institution: groups.institution,
      thesisType: groups.thesisType,
      typeHint: 'thesis',
    };
  }

  const thesisTailMatch = raw.match(THESIS_TAIL_REGEX);
  if (thesisTailMatch?.groups) {
    const groups = Object.fromEntries(
      Object.entries(thesisTailMatch.groups).map(([key, value]) => [key, value?.trim() ?? '']),
    );
    return {
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      institution: groups.institution,
      thesisType: groups.thesisType,
      typeHint: 'thesis',
    };
  }

  const webpageMatch = isLikelyAuthorlessWebpageReference(raw) ? raw.match(WEBPAGE_AUTHORLESS_REGEX) : null;
  if (webpageMatch?.groups) {
    const groups = Object.fromEntries(
      Object.entries(webpageMatch.groups).map(([key, value]) => [key, value?.trim() ?? '']),
    );
    return {
      title: groups.title,
      year: toYear(groups.year),
      siteName: groups.siteName,
      typeHint: 'webpage',
    };
  }

  const genericWebpage = parseGenericWebpageReference(raw, support);
  if (genericWebpage) {
    return genericWebpage;
  }

  const parsers = (family === 'numeric'
    ? [
      [NUMERIC_COLON_ARTICLE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [VANCOUVER_ARTICLE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [VANCOUVER_ARTICLE_NO_ISSUE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [IEEE_ARTICLE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [IEEE_SEMICOLON_ARTICLE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [REVIEW_ARTICLE_LOCATOR_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [IN_COLLECTION_REGEX, (groups: Record<string, string>) => mapInCollectionGroups(groups, raw)],
      [AUTHOR_DATE_IN_COLLECTION_REGEX, (groups: Record<string, string>) => mapGenericContainerGroups(groups, 'book-chapter', raw)],
      [IEEE_IN_COLLECTION_REGEX, (groups: Record<string, string>) => mapGenericContainerGroups(groups, 'book-chapter', raw)],
      [NUMERIC_QUOTED_PUBLISHER_PAGES_TAIL_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: rawQuotedTitle ?? groups.title,
        year: toYear(groups.year),
        publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
        pages: groups.pages ? normalizePages(groups.pages) : undefined,
        ...(
          CONFERENCE_DOI_REGEX.test(raw) || looksProceedingsLikeDoi(raw.match(DOI_REGEX)?.[0])
            ? { typeHint: 'conference-paper' as const }
            : {}
        ),
      })],
      [QUOTED_PUBLISHER_TAIL_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: rawQuotedTitle ?? groups.title,
        year: toYear(groups.year),
        publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
        ...(looksProceedingsLikeDoi(raw.match(DOI_REGEX)?.[0])
          ? { conferenceTitle: normalizeConferenceTitle(groups.publisher), typeHint: 'conference-paper' as const }
          : {}),
      })],
      [INITIALS_LATE_YEAR_BOOK_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
        typeHint: 'book' as const,
      })],
      [APA_ARTICLE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [APA_ARTICLE_NO_PAGES_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        typeHint: 'article-journal' as const,
      })],
      [APA_ARTICLE_WORD_LOCATOR_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        typeHint: 'article-journal' as const,
      })],
      [APA_SEMICOLON_ARTICLE_NO_PAGES_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        typeHint: 'article-journal' as const,
      })],
      [APA_ISSUE_ONLY_ARTICLE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [AUTHOR_DATE_BARE_LOCATOR_ARTICLE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [APA_ARTICLE_NO_ISSUE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
      [YEARLESS_ARTICLE_REGEX, (groups: Record<string, string>) => ({
        authorSegment: groups.authors,
        title: groups.title,
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
    ]
    : family === 'notes_bibliography'
      ? [
        [MLA_ARTICLE_REGEX, (groups: Record<string, string>) => ({
          authorSegment: groups.authors,
          title: groups.title,
          year: toYear(groups.year),
          journal: groups.journal,
          volume: groups.volume,
          issue: groups.issue,
          pages: groups.pages,
          typeHint: 'article-journal' as const,
        })],
        [MLA_ARTICLE_ISSUE_ONLY_REGEX, (groups: Record<string, string>) => ({
          authorSegment: groups.authors,
          title: groups.title,
          year: toYear(groups.year),
          journal: groups.journal,
          volume: groups.volume,
          issue: groups.issue,
          pages: groups.pages,
          typeHint: 'article-journal' as const,
        })],
        [CHICAGO_ARTICLE_REGEX, (groups: Record<string, string>) => ({
          authorSegment: groups.authors,
          title: groups.title,
          year: toYear(groups.year),
          journal: groups.journal,
          volume: groups.volume,
          issue: groups.issue,
          pages: groups.pages,
          typeHint: 'article-journal' as const,
        })],
        [CHICAGO_ARTICLE_PAGES_ONLY_REGEX, (groups: Record<string, string>) => ({
          authorSegment: groups.authors,
          title: groups.title,
          year: toYear(groups.year),
          journal: groups.journal,
          pages: groups.pages,
          typeHint: 'article-journal' as const,
        })],
        [REVIEW_ARTICLE_LOCATOR_REGEX, (groups: Record<string, string>) => ({
          authorSegment: groups.authors,
          title: groups.title,
          year: toYear(groups.year),
          journal: groups.journal,
          volume: groups.volume,
          issue: groups.issue,
          pages: groups.pages,
          typeHint: 'article-journal' as const,
        })],
        [IN_COLLECTION_REGEX, (groups: Record<string, string>) => mapInCollectionGroups(groups, raw)],
      ]
      : [
        [APA_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [APA_ARTICLE_NO_PAGES_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      typeHint: 'article-journal' as const,
    })],
        [APA_ARTICLE_WORD_LOCATOR_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      typeHint: 'article-journal' as const,
    })],
        [APA_SEMICOLON_ARTICLE_NO_PAGES_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      typeHint: 'article-journal' as const,
    })],
        [APA_ISSUE_ONLY_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [AUTHOR_DATE_BARE_LOCATOR_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [APA_ARTICLE_NO_ISSUE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [YEARLESS_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [HARVARD_QUOTED_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [AUTHOR_DATE_QUOTED_CHAPTER_TAIL_REGEX, (groups: Record<string, string>) => mapGenericContainerGroups(groups, 'book-chapter', raw)],
        [AUTHOR_DATE_QUOTED_TAIL_REGEX, (groups: Record<string, string>) => mapAuthorDateQuotedTailGroups(groups, raw)],
        [HARVARD_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [MLA_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [MLA_ARTICLE_ISSUE_ONLY_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [CHICAGO_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [CHICAGO_ARTICLE_PAGES_ONLY_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [NUMERIC_COLON_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [VANCOUVER_ARTICLE_NO_ISSUE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [VANCOUVER_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      journal: groups.journal,
      volume: groups.volume,
      issue: groups.issue,
      pages: groups.pages,
      typeHint: 'article-journal' as const,
    })],
        [IEEE_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
        [IEEE_SEMICOLON_ARTICLE_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
        [REVIEW_ARTICLE_LOCATOR_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
        title: groups.title,
        year: toYear(groups.year),
        journal: groups.journal,
        volume: groups.volume,
        issue: groups.issue,
        pages: groups.pages,
        typeHint: 'article-journal' as const,
      })],
        [IN_COLLECTION_REGEX, (groups: Record<string, string>) => mapInCollectionGroups(groups, raw)],
        [AUTHOR_DATE_IN_COLLECTION_REGEX, (groups: Record<string, string>) => mapGenericContainerGroups(groups, 'book-chapter', raw)],
        [HARVARD_IN_COLLECTION_REGEX, (groups: Record<string, string>) => mapGenericContainerGroups(groups, 'book-chapter', raw)],
        [CHICAGO_IN_COLLECTION_REGEX, (groups: Record<string, string>) => mapGenericContainerGroups(groups, 'book-chapter', raw)],
        [MLA_CONTAINER_PAGES_REGEX, (groups: Record<string, string>) => mapGenericContainerGroups(groups, 'book-chapter', raw)],
        [VANCOUVER_CONTAINER_PAGES_REGEX, (groups: Record<string, string>) => mapGenericContainerGroups(groups, 'book-chapter', raw)],
        [VANCOUVER_CONFERENCE_INSTITUTIONAL_ETAL_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      conferenceTitle: normalizeConferenceTitle(groups.container),
      typeHint: 'conference-paper' as const,
    })],
        [QUOTED_PUBLISHER_TAIL_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
      ...(looksProceedingsLikeDoi(raw.match(DOI_REGEX)?.[0])
        ? { conferenceTitle: normalizeConferenceTitle(groups.publisher), typeHint: 'conference-paper' as const }
        : {}),
    })],
        [INITIALS_LATE_YEAR_BOOK_REGEX, (groups: Record<string, string>) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
      typeHint: 'book' as const,
    })],
      ]
  ) as [RegExp, (groups: Record<string, string>) => ParsedReference][];

  const flexibleSemicolonArticle = parseFlexibleSemicolonArticleReference(parseableStructuredRaw);
  if (flexibleSemicolonArticle) {
    return flexibleSemicolonArticle;
  }

  for (const [pattern, mapper] of parsers) {
    const parsed = parseRegexMatch(parseableStructuredRaw, pattern, mapper);
    if (parsed) {
      return parsed;
    }
  }

  const strongNumericConference =
    family === 'numeric' || family === 'unknown'
      ? recoverStrongNumericConferencePublisherTail(raw)
      : null;
  if (strongNumericConference) {
    return strongNumericConference;
  }

  const genericConference = parseGenericConferenceReference(parseableStructuredRaw);
  if (genericConference) {
    return genericConference;
  }

  const genericReport = parseAuthorDateCorporateReportReference(parseableStructuredRaw);
  if (genericReport) {
    return genericReport;
  }

  const genericInCollection = parseGenericInCollectionReference(parseableStructuredRaw);
  if (genericInCollection) {
    return genericInCollection;
  }

  const genericPublisherTail = parseGenericPublisherTailReference(raw);
  if (genericPublisherTail) {
    return genericPublisherTail;
  }

  if (family !== 'unknown') {
    return parseStructuredReference(raw, 'unknown', support);
  }

  return {};
}

function parseRegexMatch(
  raw: string,
  pattern: RegExp,
  mapper: (groups: Record<string, string>) => ParsedReference,
): ParsedReference | null {
  const match = raw.match(pattern);
  if (!match?.groups) return null;

  const groups = Object.fromEntries(
    Object.entries(match.groups).map(([key, value]) => [key, value?.trim() ?? '']),
  );
  return repairParsedReference(mapper(groups), raw);
}

function repairParsedReference(parsed: ParsedReference, raw?: string): ParsedReference {
  const repaired = { ...parsed };

  if (repaired.publisher) {
    repaired.publisher = repaired.publisher.replace(/^©\s*/u, '').trim();
  }

  if (repaired.title) {
    repaired.title = normalizeTitleCandidate(repaired.title) ?? repaired.title;
  }

  if (repaired.title && repaired.journal) {
    const leadingJournalSpill = extractLeadingJournalSpill(repaired.journal);
    if (leadingJournalSpill) {
      repaired.journal = leadingJournalSpill.rest;
      const recoveredTitleContinuation =
        raw && repaired.title
          ? recoverTitleContinuationFromRaw(raw, repaired.title, leadingJournalSpill.lead)
          : null;
      const normalizedLead = stripTrailingPunctuation(leadingJournalSpill.lead);
      if (
        normalizedLead
        && repaired.title
        && !normalizeComparableText(repaired.title).includes(normalizeComparableText(normalizedLead))
      ) {
        repaired.title =
          recoveredTitleContinuation
          ?? `${stripTrailingPunctuation(repaired.title)}, ${normalizedLead}`.trim();
      }
    }

    const singleLetterJournalLead = repaired.journal.match(/^(?<fragment>[A-Z])\.\s+(?<rest>.+)$/u);
    const journalRest = singleLetterJournalLead?.groups?.rest;
    const journalFragment = singleLetterJournalLead?.groups?.fragment;
    if (journalRest && journalFragment && /\b[\p{L}\p{N}]$/u.test(repaired.title)) {
      repaired.title = `${stripTrailingPunctuation(repaired.title)}.${journalFragment}`;
      repaired.journal = journalRest.trim();
    }

    const quotedJournalLead = splitQuotedJournalLead(repaired.title, repaired.journal);
    if (quotedJournalLead) {
      repaired.journal = quotedJournalLead;
    }

    const normalizedJournal = normalizeJournalCandidate(repaired.journal, repaired.title);
    if (normalizedJournal) {
      repaired.journal = normalizedJournal;
    }
  }

  if (raw && repaired.authorSegment && repaired.title) {
    const parsedAuthors = parseRecoverableNumericConferenceAuthors(repaired.authorSegment);
    const titleLooksAuthorSpill =
      looksLikeAuthorSpill(repaired.title)
      || looksLikeLeadingAuthorSequence(repaired.title);
    const journalLooksAuthorSpill =
      typeof repaired.journal === 'string'
      && (
        looksLikeAuthorSpill(repaired.journal)
        || looksLikeLeadingAuthorSequence(repaired.journal)
      );
    const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
    const looksSemicolonArticleShape =
      typeof repaired.journal === 'string'
      && /\b(?:19|20)\d{2}(?:\s+[A-Za-z]{3}\s+\d+)?;\d+(?:\([^)]*\))?(?::[A-Za-z]?\d[\w\-–]*)?\.?$/iu.test(parseableRaw);
    const looksNumericBookLeadShape =
      typeof repaired.publisher === 'string'
      && /^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/u.test(parseableRaw)
      && /\b(?:1[6-9]|20)\d{2}\b/u.test(parseableRaw)
      && !/\bet al\./iu.test(parseableRaw);
    if (
      parsedAuthors.length <= 1
      && (titleLooksAuthorSpill || journalLooksAuthorSpill)
      && (looksSemicolonArticleShape || looksNumericBookLeadShape)
    ) {
      const reparsedCandidates = [
        ...(looksSemicolonArticleShape ? [parseFlexibleSemicolonArticleReference(raw)] : []),
        ...(looksNumericBookLeadShape
          ? [
            parseNumericEnumeratedPublisherTailBookReference(parseableRaw),
            parseSentenceTailBookReference(parseableRaw),
          ]
          : []),
      ].filter((candidate): candidate is ParsedReference => candidate != null);
      const improvedCandidate = reparsedCandidates.find((candidate) => {
        if (!candidate.authorSegment || !candidate.title) {
          return false;
        }
        const candidateAuthors = parseRecoverableNumericConferenceAuthors(candidate.authorSegment);
        return (
          candidateAuthors.length > parsedAuthors.length
          && !looksLikeAuthorSpill(candidate.title)
          && !looksLikeLeadingAuthorSequence(candidate.title)
          && !(
            typeof candidate.journal === 'string'
            && (
              looksLikeAuthorSpill(candidate.journal)
              || looksLikeLeadingAuthorSequence(candidate.journal)
            )
          )
        );
      });
      if (improvedCandidate) {
        return repairParsedReference(improvedCandidate);
      }
    }
  }

  return repaired;
}

function parseFlexibleSemicolonArticleReference(raw: string): ParsedReference | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const match = parseableRaw.match(
    /^(?<lead>.+)\.\s*(?<journal>.+?)\s+(?<year>(?:19|20)\d{2})(?:\s+[A-Za-z]{3}\s+\d+)?;(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?::(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu,
  );
  if (!match?.groups?.lead || !match.groups.journal || !match.groups.year || !match.groups.volume) {
    return null;
  }
  if (!/\s(?:and|&)\s/u.test(match.groups.lead)) {
    return null;
  }

  const splitLead = splitNumericConferenceLead(match.groups.lead.trim());
  const journal = normalizeJournalCandidate(match.groups.journal);
  if (!splitLead || !journal || !looksJournalLikeContainer(journal)) {
    return null;
  }

  return {
    authorSegment: splitLead.authorSegment,
    title: splitLead.title,
    year: toYear(match.groups.year),
    journal,
    volume: match.groups.volume.trim(),
    issue: match.groups.issue?.trim() ?? undefined,
    pages: match.groups.pages ? normalizePages(match.groups.pages) : undefined,
    typeHint: 'article-journal',
  };
}

function parseGenericConferenceReference(raw: string): ParsedReference | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  return (
    parseRegexMatch(parseableRaw, CHICAGO_CONFERENCE_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      conferenceTitle: normalizeConferenceTitle(groups.container),
      typeHint: 'conference-paper',
    }))
    ?? parseRegexMatch(parseableRaw, CHICAGO_CONFERENCE_PAGES_ONLY_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      pages: groups.pages,
      typeHint: 'conference-paper',
    }))
    ?? parseRegexMatch(parseableRaw, MLA_CONFERENCE_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      conferenceTitle: normalizeConferenceTitle(groups.container),
      typeHint: 'conference-paper',
    }))
    ?? parseRegexMatch(parseableRaw, APA_CONFERENCE_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      conferenceTitle: normalizeConferenceTitle(groups.container),
      typeHint: 'conference-paper',
    }))
    ?? parseAuthorDateTemporalConferenceReference(parseableRaw)
    ?? parseMlaTemporalConferenceReference(parseableRaw)
    ?? parseVancouverPublisherTailConferenceReference(parseableRaw, raw)
    ?? parseVancouverInstitutionTailConferenceReference(parseableRaw, raw)
  );
}

function splitNumericConferenceLead(
  lead: string,
): { authorSegment: string; title: string } | null {
  const candidates: Array<{ authorSegment: string; title: string; score: number }> = [];
  const commaIndexes = [...lead.matchAll(/,\s+/gu)]
    .map((candidate) => candidate.index ?? -1)
    .filter((candidate) => candidate > 0)
    .sort((left, right) => right - left);

  const etAlBoundary = lead.match(/^(?<authors>.+?\bet al\.)\s+(?<title>.+)$/iu);
  if (etAlBoundary?.groups?.authors && etAlBoundary.groups.title) {
    const possibleAuthors = etAlBoundary.groups.authors.trim();
    const possibleTitle = stripTrailingPunctuation(etAlBoundary.groups.title.trim());
    const parsedAuthors = parseRecoverableNumericConferenceAuthors(possibleAuthors);
    const authorSegmentRecoverable =
      parsedAuthors.length >= 2 || isRecoverableAuthorSegment(possibleAuthors, parsedAuthors);
    if (
      parsedAuthors.length >= 2
      && authorSegmentRecoverable
      && possibleTitle.split(/\s+/u).filter(Boolean).length >= 5
      && !looksLikeAuthorSpill(possibleTitle)
    ) {
      return {
        authorSegment: possibleAuthors,
        title: possibleTitle,
      };
    }
  }

  const quotedBoundary = lead.match(/^(?<authors>.+?)(?:,\s*|\s+)[“"](?!\s*$)(?<title>.+)[”"]$/u);
  if (quotedBoundary?.groups?.authors && quotedBoundary.groups.title) {
    const possibleAuthors = stripTrailingPunctuation(quotedBoundary.groups.authors.trim());
    const possibleTitle = stripTrailingPunctuation(quotedBoundary.groups.title.trim());
    const parsedAuthors = parseRecoverableNumericConferenceAuthors(possibleAuthors);
    const authorSegmentRecoverable =
      parsedAuthors.length >= 2 || isRecoverableAuthorSegment(possibleAuthors, parsedAuthors);
    if (
      parsedAuthors.length >= 1
      && authorSegmentRecoverable
      && possibleTitle.split(/\s+/u).filter(Boolean).length >= 5
      && !looksLikeAuthorSpill(possibleTitle)
    ) {
      return {
        authorSegment: possibleAuthors,
        title: possibleTitle,
      };
    }
  }

  const periodIndexes = [...lead.matchAll(/\.\s+/gu)]
    .map((candidate) => candidate.index ?? -1)
    .filter((candidate) => candidate > 0)
    .sort((left, right) => right - left);

  for (const periodIndex of periodIndexes) {
    const possibleAuthors = lead.slice(0, periodIndex + 1).trim();
    const possibleTitle = stripTrailingPunctuation(lead.slice(periodIndex + 2).trim());
    const cleanedPossibleTitle = possibleTitle.replace(/^[,;:\s]+/u, '').trim();
    const possibleAuthorWords = normalizeComparableText(possibleAuthors).split(' ').filter(Boolean).length;
    const parsedAuthors = parseRecoverableNumericConferenceAuthors(possibleAuthors);
    const authorSegmentRecoverable =
      parsedAuthors.length >= 2 || isRecoverableAuthorSegment(possibleAuthors, parsedAuthors);
    const authorLikeTitlePenalty = countLeadingAuthorLikeNameSegments(cleanedPossibleTitle) * 0.45;
    if (
      parsedAuthors.length >= 1
      && authorSegmentRecoverable
      && !possibleAuthors.includes(':')
      && possibleAuthorWords <= 18
      && cleanedPossibleTitle.split(/\s+/u).filter(Boolean).length >= 5
      && !looksLikeAuthorSpill(cleanedPossibleTitle)
      && !looksLikeLeadingAuthorSequence(cleanedPossibleTitle)
    ) {
      candidates.push({
        authorSegment: possibleAuthors,
        title: cleanedPossibleTitle,
        score:
          cleanedPossibleTitle.length / 60
          + Math.min(parsedAuthors.length, 5) * 0.22
          + (cleanedPossibleTitle.includes(':') ? 0.15 : 0)
          - authorLikeTitlePenalty,
      });
    }
  }

  for (const commaIndex of commaIndexes) {
    const possibleAuthors = lead.slice(0, commaIndex).trim();
    const possibleTitle = stripTrailingPunctuation(lead.slice(commaIndex + 1).trim());
    const cleanedPossibleTitle = possibleTitle.replace(/^et al\.\s*/iu, '').trim();
    const possibleAuthorWords = normalizeComparableText(possibleAuthors).split(' ').filter(Boolean).length;
    const parsedAuthors = parseRecoverableNumericConferenceAuthors(possibleAuthors);
    const authorSegmentRecoverable =
      parsedAuthors.length >= 2 || isRecoverableAuthorSegment(possibleAuthors, parsedAuthors);
    const authorLikeTitlePenalty = countLeadingAuthorLikeNameSegments(cleanedPossibleTitle) * 0.45;
    if (
      parsedAuthors.length >= 1
      && authorSegmentRecoverable
      && !possibleAuthors.includes(':')
      && possibleAuthorWords <= 18
      && cleanedPossibleTitle.split(/\s+/u).filter(Boolean).length >= 5
      && !looksLikeAuthorSpill(cleanedPossibleTitle)
      && !looksLikeLeadingAuthorSequence(cleanedPossibleTitle)
    ) {
      candidates.push({
        authorSegment: possibleAuthors,
        title: cleanedPossibleTitle,
        score:
          cleanedPossibleTitle.length / 60
          + Math.min(parsedAuthors.length, 4) * 0.2
          + (cleanedPossibleTitle.includes(':') ? 0.15 : 0)
          - (/\bet al\./iu.test(cleanedPossibleTitle) ? 0.3 : 0)
          - authorLikeTitlePenalty,
      });
    }
  }

  const best = candidates.sort(
    (left, right) =>
      right.score - left.score
      || right.title.length - left.title.length
      || right.authorSegment.length - left.authorSegment.length,
  )[0];

  return best
    ? { authorSegment: best.authorSegment, title: best.title }
    : null;
}

function parseRecoverableNumericConferenceAuthors(segment: string) {
  const parsedAuthors = parseAuthorSegment(segment);
  const hasAdditionalAuthorBoundary =
    /(?:\s+(?:and|&)\s+|,\s*(?=[A-Z]\.)|,\s*(?=[A-Z][\p{L}'-]+,\s*[A-Z]))/u.test(segment);
  if (parsedAuthors.length > 0 && !(parsedAuthors.length === 1 && hasAdditionalAuthorBoundary)) {
    return parsedAuthors;
  }

  const fallbackParts = segment
    .replace(/\s+(?:and|&)\s+/giu, ';')
    .replace(/\s*,\s*(?=[A-Z]\.)/gu, ';')
    .split(/\s*;\s*/u)
    .map((part) => stripTrailingPunctuation(part).trim())
    .filter(Boolean);
  if (fallbackParts.length < 2) {
    return [];
  }

  const fallbackAuthors = fallbackParts
    .filter((part) => /^[A-Z][\p{L}.'’-]*\.?\s+\p{L}/u.test(part))
    .map((part) => parseSingleAuthor(part))
    .filter((author) => !author.isCorporate && Boolean(author.family));
  if (fallbackAuthors.length === fallbackParts.length) {
    return fallbackAuthors;
  }

  const coordinatedParts = segment
    .replace(/\s*&\s*/giu, ' and ')
    .split(/\s+and\s+/iu)
    .map((part) => stripTrailingPunctuation(part).replace(/^[,;:\s]+/u, '').trim())
    .filter(Boolean);
  if (coordinatedParts.length >= 2) {
    const coordinatedAuthors = coordinatedParts
      .map((part) => {
        const parsedPart = parseAuthorSegment(part);
        if (
          parsedPart.length === 1
          && !parsedPart[0]?.isCorporate
          && Boolean(parsedPart[0]?.family)
        ) {
          return parsedPart[0];
        }

        if (
          /^[\p{Lu}][\p{L}'’-]+,\s*(?:[\p{Lu}]\.\s*){1,4}$/u.test(part)
          || /^(?:[\p{Lu}]\.\s*){1,4}[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)*$/u.test(part)
        ) {
          const singleAuthor = parseSingleAuthor(part);
          return singleAuthor.isCorporate || !singleAuthor.family ? null : singleAuthor;
        }

        return null;
      })
      .filter((author): author is CanonicalAuthor => author != null);
    if (coordinatedAuthors.length === coordinatedParts.length) {
      return coordinatedAuthors;
    }
  }

  return [];
}

function parseAuthorDateCorporateReportReference(raw: string): ParsedReference | null {
  const match = raw.match(/^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.?\s*(?<remainder>.+)$/iu);
  if (!match?.groups?.authors || !match.groups.year || !match.groups.remainder) {
    return null;
  }

  const year = toYear(match.groups.year);
  const authorSegment = stripTrailingPunctuation(match.groups.authors);
  const institution = normalizeInstitutionCandidate(authorSegment, year);
  if (!authorSegment || !institution) {
    return null;
  }

  const clauses = splitSentenceClauses(match.groups.remainder)
    .map((clause) => stripTrailingPunctuation(clause.trim()))
    .filter(Boolean);
  if (clauses.length < 2) {
    return null;
  }

  const repeatedOwner = normalizeInstitutionCandidate(clauses.at(-1), year);
  if (
    !repeatedOwner
    || normalizeComparableText(repeatedOwner) !== normalizeComparableText(institution)
  ) {
    return null;
  }

  const title = normalizeTitleCandidate(clauses.slice(0, -1).join('. '));
  if (!title || title.split(/\s+/u).filter(Boolean).length < 2) {
    return null;
  }

  return {
    authorSegment: institution,
    title,
    year,
    institution,
    typeHint: 'report',
  };
}

function recoverAuthorDateCorporateReportFromRaw(
  raw: string,
  institution: string | null,
): ParsedReference | null {
  if (!institution) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  if (/10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(parseableRaw)) {
    return null;
  }
  const parsed = parseAuthorDateCorporateReportReference(parseableRaw);
  if (
    parsed?.institution
    && normalizeComparableText(parsed.institution) === normalizeComparableText(institution)
  ) {
    return parsed;
  }

  const match = parseableRaw.match(/^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.?\s*(?<remainder>.+)$/iu);
  if (!match?.groups?.authors || !match.groups.remainder || !match.groups.year) {
    return null;
  }

  const clauses = splitSentenceClauses(match.groups.remainder)
    .map((clause) => stripTrailingPunctuation(clause.trim()))
    .filter(Boolean);
  const owner = normalizeInstitutionCandidate(clauses.at(-1), toYear(match.groups.year));
  const authorInstitution = normalizeInstitutionCandidate(match.groups.authors, toYear(match.groups.year));
  const title = normalizeTitleCandidate(clauses.slice(0, -1).join('. '));
  const normalizedHint = normalizeComparableText(institution);
  if (
    !owner
    || !authorInstitution
    || !title
    || normalizeComparableText(owner) !== normalizeComparableText(authorInstitution)
    || (
      normalizedHint.length > 0
      && !normalizeComparableText(owner).includes(normalizedHint)
    )
  ) {
    return null;
  }

  return {
    authorSegment: authorInstitution,
    title,
    year: toYear(match.groups.year),
    institution: authorInstitution,
    typeHint: 'report',
  };
}

function recoverNumericCorporateReportFromRaw(
  raw: string,
  institution: string | null,
): ParsedReference | null {
  if (!institution) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw))
    .replace(/^\[\d+\]\s*/u, '')
    .trim();
  if (/10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(parseableRaw)) {
    return null;
  }
  const yearMatch = parseableRaw.match(/;\s*(?<year>(?:19|20)\d{2})\.?$/iu);
  if (!yearMatch?.groups?.year || yearMatch.index == null) {
    return null;
  }

  const year = toYear(yearMatch.groups.year);
  const clauses = splitSentenceClauses(parseableRaw.slice(0, yearMatch.index).trim())
    .map((clause) => stripTrailingPunctuation(clause.trim()))
    .filter(Boolean);
  if (clauses.length < 3) {
    return null;
  }

  const authorInstitution = normalizeInstitutionCandidate(clauses[0], year);
  const ownerInstitution = normalizeInstitutionCandidate(clauses.at(-1), year);
  const normalizedTitle = normalizeTitleCandidate(clauses.slice(1, -1).join('. '));
  const normalizedHint = normalizeComparableText(institution);
  if (
    !authorInstitution
    || !ownerInstitution
    || !normalizedTitle
    || normalizeComparableText(authorInstitution) !== normalizeComparableText(ownerInstitution)
    || (
      normalizedHint.length > 0
      && !normalizeComparableText(ownerInstitution).includes(normalizedHint)
    )
  ) {
    return null;
  }

  return {
    authorSegment: authorInstitution,
    title: normalizedTitle,
    year,
    institution: authorInstitution,
    typeHint: 'report',
  };
}

function recoverOwnerYearCorporateReportFromRaw(
  raw: string,
  institution: string | null,
): ParsedReference | null {
  if (!institution) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw))
    .replace(/^\[\d+\]\s*/u, '')
    .trim();
  if (/10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(parseableRaw)) {
    return null;
  }
  const yearMatch = parseableRaw.match(/[;,]\s*(?<year>(?:19|20)\d{2})\.?$/iu);
  if (!yearMatch?.groups?.year || yearMatch.index == null) {
    return null;
  }

  const year = toYear(yearMatch.groups.year);
  const prefix = parseableRaw.slice(0, yearMatch.index).trim();
  const clauses = splitSentenceClauses(prefix)
    .map((clause) => stripTrailingPunctuation(clause.trim()))
    .filter(Boolean);
  if (clauses.length < 3) {
    return null;
  }

  const authorInstitution = normalizeInstitutionCandidate(clauses[0], year);
  const ownerInstitution = normalizeInstitutionCandidate(clauses.at(-1), year);
  const normalizedHint = normalizeComparableText(institution);
  const normalizedTitle = normalizeTitleCandidate(clauses.slice(1, -1).join('. '));
  if (
    !authorInstitution
    || !ownerInstitution
    || !normalizedTitle
    || normalizeComparableText(authorInstitution) !== normalizeComparableText(ownerInstitution)
    || (
      normalizedHint.length > 0
      && !normalizeComparableText(ownerInstitution).includes(normalizedHint)
    )
  ) {
    return null;
  }

  return {
    authorSegment: authorInstitution,
    title: normalizedTitle,
    year,
    institution: authorInstitution,
    typeHint: 'report',
  };
}

function parseAuthorDateTemporalConferenceReference(raw: string): ParsedReference | null {
  const match = raw.match(/^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<container>.+)$/iu);
  if (!match?.groups?.authors || !match.groups.year || !match.groups.title || !match.groups.container) {
    return null;
  }

  const container = normalizeConferenceTitle(stripTrailingPunctuation(match.groups.container));
  if (
    !container
    || !shouldPreserveConferenceTemporalTail(container)
    || looksLowQualityContainerCandidate(container)
    || (
      looksInstitutionalContainer(container)
      && !/^[A-Z0-9][A-Z0-9&./-]{2,18}(?:,|\s+(?:19|20)\d{2}\b)/u.test(container)
    )
    || recoverJournalFromContainerLocator(container)
  ) {
    return null;
  }

  return {
    authorSegment: match.groups.authors,
    title: match.groups.title,
    year: toYear(match.groups.year),
    conferenceTitle: container,
    typeHint: 'conference-paper',
  };
}

function parseMlaTemporalConferenceReference(raw: string): ParsedReference | null {
  const match = raw.match(/^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s*(?<year>(?:19|20)\d{2}),\s*(?<container>.+)$/iu);
  if (!match?.groups?.authors || !match.groups.year || !match.groups.title || !match.groups.container) {
    return null;
  }

  const container = normalizeConferenceTitle(stripTrailingPunctuation(match.groups.container));
  if (
    !container
    || !shouldPreserveConferenceTemporalTail(container)
    || looksLowQualityContainerCandidate(container)
    || (
      looksInstitutionalContainer(container)
      && !/^[A-Z0-9][A-Z0-9&./-]{2,18}(?:,|\s+(?:19|20)\d{2}\b)/u.test(container)
    )
    || recoverJournalFromContainerLocator(container)
  ) {
    return null;
  }

  return {
    authorSegment: match.groups.authors,
    title: match.groups.title,
    year: toYear(match.groups.year),
    conferenceTitle: container,
    typeHint: 'conference-paper',
  };
}

function parseVancouverInstitutionTailConferenceReference(
  parseableRaw: string,
  raw: string,
): ParsedReference | null {
  const match = parseableRaw.match(
    /^(?:\[\d+\]\s*)?(?<lead>.+),\s*(?<publisher>[^;]+);\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*(?<pages>[^.;]+))?\.?$/iu,
  );
  if (!match?.groups?.lead || !match.groups.publisher) {
    return null;
  }

  let lead = match.groups.lead.trim();
  let publisherText = match.groups.publisher.trim();
  const publisherLeadingQuoteMatch = publisherText.match(/^(?<quote>[”"])\s*(?<rest>.+)$/u);
  if (publisherLeadingQuoteMatch?.groups?.rest && /[“"]/.test(lead)) {
    lead = `${lead.replace(/[,\s]+$/u, '')},${publisherLeadingQuoteMatch.groups.quote}`;
    publisherText = publisherLeadingQuoteMatch.groups.rest.trim();
  }
  lead = lead.replace(/([”"])\s*,\s*$/u, '$1');
  const publisher = normalizeConferenceTitle(match.groups.publisher ?? '');
  const year = toYear(match.groups.year ?? '');
  const doi = raw.match(DOI_REGEX)?.[0];
  const pages = match.groups.pages ? normalizePages(match.groups.pages) : undefined;
  const splitLead = splitNumericConferenceLead(lead);
  const authorSegment = splitLead?.authorSegment ?? '';
  const title = splitLead?.title ?? '';

  if (
    !authorSegment
    || !title
    || !publisher
  ) {
    return null;
  }

  const hasConferenceDoi =
    CONFERENCE_DOI_REGEX.test(raw)
    || looksProceedingsLikeDoi(doi ?? undefined);
  const hasConferenceEvidence =
    looksConferenceContainer(publisher)
    || hasConferenceDoi
    || /\bpaper presented at\b/iu.test(raw)
    || CONFERENCE_CUE_REGEX.test(raw);
  if (!hasConferenceEvidence && looksStandaloneInstitutionalAlias(publisher)) {
    const institution = normalizeInstitutionCandidate(publisher, year);
    return {
      authorSegment,
      title,
      year,
      ...(institution ? { institution } : {}),
      typeHint: 'report',
    };
  }
  if (!hasConferenceEvidence) {
    return null;
  }

  if (
    looksInstitutionalContainer(publisher)
    || looksStandaloneInstitutionalAlias(publisher)
    || looksConferencePublisherOrganization(publisher)
  ) {
    return {
      authorSegment,
      title,
      year,
      publisher,
      ...(pages ? { pages } : {}),
      typeHint: 'conference-paper',
    };
  }

  return {
    authorSegment,
    title,
    year,
    conferenceTitle: publisher,
    ...(pages ? { pages } : {}),
    typeHint: 'conference-paper',
  };
}

function parseVancouverPublisherTailConferenceReference(
  parseableRaw: string,
  raw: string,
): ParsedReference | null {
  const parsed =
    parseRegexMatch(parseableRaw, VANCOUVER_CONFERENCE_PUBLISHER_ETAL_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: stripTrailingPunctuation(groups.publisher ?? ''),
      ...(groups.pages ? { pages: groups.pages } : {}),
    }))
    ?? parseRegexMatch(parseableRaw, VANCOUVER_CONFERENCE_PUBLISHER_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: stripTrailingPunctuation(groups.publisher ?? ''),
      ...(groups.pages ? { pages: groups.pages } : {}),
    }));
  const parsedLooksLowQuality =
    parsed != null
    && (
      !parsed.title
      || looksLikeAuthorSpill(parsed.title)
      || countLeadingAuthorLikeNameSegments(parsed.title) > 0
      || hasIncompleteAuthorTail(parsed.authorSegment ?? '')
    );
  const fallbackMatch = (!parsed?.publisher || parsedLooksLowQuality)
    ? parseableRaw.match(
      /^(?:\[\d+\]\s*)?(?<lead>.+),\s*(?<publisher>[^;]+);\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*(?<pages>[^.;]+))?\.?$/iu,
    )
    : null;
  const fallbackSplit = fallbackMatch?.groups?.lead
    ? splitNumericConferenceLead(fallbackMatch.groups.lead.trim())
    : null;
  const fallbackResolved =
    fallbackSplit && fallbackMatch?.groups?.publisher && fallbackMatch.groups.year
      ? {
        authorSegment: fallbackSplit.authorSegment,
        title: fallbackSplit.title,
        year: toYear(fallbackMatch.groups.year),
        publisher: stripTrailingPunctuation(fallbackMatch.groups.publisher),
        ...(fallbackMatch.groups.pages ? { pages: normalizePages(fallbackMatch.groups.pages) } : {}),
      }
      : null;
  const resolved = parsed?.publisher && !parsedLooksLowQuality
    ? parsed
    : (
      fallbackResolved
      ?? (
        parsed?.publisher
          ? parsed
          : null
      )
    );

  if (!resolved?.publisher) {
    return null;
  }

  const normalizedPublisher = normalizeConferenceTitle(resolved.publisher);
  const doi = raw.match(DOI_REGEX)?.[0];
  const hasConferenceDoi =
    CONFERENCE_DOI_REGEX.test(raw)
    || looksProceedingsLikeDoi(doi ?? undefined);
  const hasConferenceCue =
    looksConferenceContainer(normalizedPublisher)
    || hasConferenceDoi
    || /\bpaper presented at\b/iu.test(raw)
    || CONFERENCE_CUE_REGEX.test(raw);
  const institutionalConferenceTail =
    hasConferenceDoi
    && looksInstitutionalContainer(normalizedPublisher)
    && !looksReportPublisherAcronym(normalizedPublisher);
  const standaloneInstitutionalAlias =
    looksStandaloneInstitutionalAlias(normalizedPublisher)
    && !hasConferenceDoi
    && !/\bpaper presented at\b/iu.test(raw)
    && !CONFERENCE_CUE_REGEX.test(raw);

  if (
    (!hasConferenceCue && !standaloneInstitutionalAlias)
    || isPreprintPublisherTail(raw)
    || /\b(?:report|standard|bulletin|working paper|white paper|guideline|specification|recommendation)\b/iu.test(raw)
    || (looksInstitutionalContainer(normalizedPublisher) && !institutionalConferenceTail)
    || looksReportPublisherAcronym(normalizedPublisher)
  ) {
    return null;
  }

  if (standaloneInstitutionalAlias) {
    const institution = normalizeInstitutionCandidate(normalizedPublisher, resolved.year);
    return {
      authorSegment: resolved.authorSegment,
      title: resolved.title,
      year: resolved.year,
      ...(institution ? { institution } : {}),
      typeHint: 'report',
    };
  }

  return {
    authorSegment: resolved.authorSegment,
    title: resolved.title,
    year: resolved.year,
    publisher: resolved.publisher,
    ...(resolved.pages ? { pages: normalizePages(resolved.pages) } : {}),
    typeHint: 'conference-paper',
  };
}

function parseGenericInCollectionReference(raw: string): ParsedReference | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  return (
    parseRegexMatch(parseableRaw, AUTHOR_DATE_IN_COLLECTION_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, AUTHOR_DATE_QUOTED_CHAPTER_TAIL_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, IEEE_IN_COLLECTION_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, HARVARD_IN_COLLECTION_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, CHICAGO_IN_COLLECTION_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, MLA_CONTAINER_PAGES_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, VANCOUVER_CONTAINER_PAGES_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
  );
}

function parseNumericEnumeratedPublisherTailBookReference(raw: string): ParsedReference | null {
  if (!/^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/u.test(raw)) {
    return null;
  }

  const yearMatch = [...raw.matchAll(/\b((?:1[6-9]|20)\d{2})\b/gu)].at(-1);
  const yearIndex = yearMatch?.index ?? -1;
  const year = Number(yearMatch?.[1] ?? '');
  if (yearIndex < 0 || !Number.isFinite(year)) {
    return null;
  }

  const beforeYear = raw.slice(0, yearIndex).replace(/[;,.\s]+$/u, '').trim();
  const publisherBreaks = [...beforeYear.matchAll(/\.\s+/gu)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);

  for (const publisherBreak of publisherBreaks) {
    const authorAndTitle = beforeYear.slice(0, publisherBreak).trim();
    const publisherCandidate = stripTrailingPunctuation(beforeYear.slice(publisherBreak + 2).trim());
    const publisher = normalizePublisherCandidate(publisherCandidate, authorAndTitle);
    if (!publisher || isPublisherTailFragment(publisher)) {
      continue;
    }

    const lead = authorAndTitle.replace(/^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/u, '').trim();
    const splitLead = splitNumericConferenceLead(lead);
    if (!splitLead || parseRecoverableNumericConferenceAuthors(splitLead.authorSegment).length < 2) {
      continue;
    }

    return {
      authorSegment: splitLead.authorSegment,
      title: splitLead.title,
      year,
      publisher,
      typeHint: 'book',
    };
  }

  return null;
}

function parseSentenceTailBookReference(raw: string): ParsedReference | null {
  const yearMatch = [...raw.matchAll(/\b((?:1[6-9]|20)\d{2})\b/gu)].at(-1);
  const yearIndex = yearMatch?.index ?? -1;
  if (yearIndex < 0) {
    return null;
  }

  const beforeYear = raw.slice(0, yearIndex).replace(/[;,.\s]+$/u, '').trim();
  const year = Number(yearMatch?.[1] ?? '');
  if (!Number.isFinite(year)) {
    return null;
  }

  const breakIndexes = [...beforeYear.matchAll(/\.\s+/gu)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);
  const candidates: Array<ParsedReference & { score: number }> = [];
  for (const publisherBreak of breakIndexes) {
    const authorAndTitle = beforeYear.slice(0, publisherBreak).trim();
    const publisherCandidate = stripTrailingPunctuation(beforeYear.slice(publisherBreak + 2).trim());
    const normalizedPublisher = normalizePublisherCandidate(publisherCandidate, authorAndTitle);
    if (!normalizedPublisher || isPublisherTailFragment(normalizedPublisher)) {
      continue;
    }

    const numericLead = authorAndTitle.replace(/^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/u, '').trim();
    if (/^(?:\[\d+\]|\(\d+\)|\d+[.)])/u.test(authorAndTitle) || /(?:\b[A-Z]\.\s*){2,}/u.test(numericLead)) {
      const splitNumericLead = splitNumericConferenceLead(numericLead);
      if (splitNumericLead) {
        const numericAuthors = parseRecoverableNumericConferenceAuthors(splitNumericLead.authorSegment);
        candidates.push({
          authorSegment: splitNumericLead.authorSegment,
          title: splitNumericLead.title,
          year,
          publisher: normalizedPublisher,
          score:
            scorePublisherTailCandidate(normalizedPublisher, splitNumericLead.title)
            + Math.min(numericAuthors.length, 4) * 0.22
            + 0.4,
        });
      }
    }

    const authorBreaks = [...authorAndTitle.matchAll(/\.\s+/gu)]
      .map((match) => match.index ?? -1)
      .filter((index) => index >= 0)
      .sort((left, right) => right - left);

    for (const authorBreak of authorBreaks) {
      const authorSegment = authorAndTitle.slice(0, authorBreak).trim();
      const title = authorAndTitle.slice(authorBreak + 2).trim();
      if (
        !authorSegment
        || !title
        || normalizeComparableText(title).split(' ').length < 2
      ) {
        continue;
      }

      const authorCount = parseAuthorSegment(authorSegment).length;
      candidates.push({
        authorSegment,
        title,
        year,
        publisher: normalizedPublisher,
        score:
          scorePublisherTailCandidate(normalizedPublisher, title)
          + Math.min(authorCount, 3) * 0.18
          - (looksLikeAuthorSpill(title) ? 0.75 : 0)
          - (hasIncompleteAuthorTail(authorSegment) ? 0.45 : 0),
      });
    }
  }

  const bestCandidate = candidates.sort(
    (left, right) =>
      right.score - left.score
      || (right.publisher?.length ?? 0) - (left.publisher?.length ?? 0),
  )[0];

  if (!bestCandidate) {
    return null;
  }

  const { score: _score, ...parsed } = bestCandidate;
  return parsed;
}

function parsePlaceholderDoiBookReference(raw: string): ParsedReference | null {
  const normalizedRaw = normalizeExtractionInput(raw);
  if (!hasPlaceholderDoiTail(normalizedRaw)) {
    return null;
  }

  const parseableRaw = collapseRepeatedSentenceBoundaryArtifacts(
    stripTrailingIdentifierTailForParsing(normalizedRaw),
  );
  const breakIndexes = [...parseableRaw.matchAll(/\.\s+/gu)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);
  const candidates: Array<ParsedReference & { score: number }> = [];

  for (const publisherBreak of breakIndexes) {
    const authorAndTitle = parseableRaw.slice(0, publisherBreak).trim();
    const publisherCandidate = stripTrailingPunctuation(parseableRaw.slice(publisherBreak + 2).trim());
    const normalizedPublisher = normalizePublisherCandidate(publisherCandidate, authorAndTitle);
    if (
      !normalizedPublisher
      || isPublisherTailFragment(normalizedPublisher)
      || (
        !looksPublisherLike(normalizedPublisher)
        && !looksInstitutionalContainer(normalizedPublisher)
        && !looksStandaloneInstitutionalAlias(normalizedPublisher)
      )
    ) {
      continue;
    }

    const authorBreaks = [...authorAndTitle.matchAll(/\.\s+/gu)]
      .map((match) => match.index ?? -1)
      .filter((index) => index >= 0)
      .sort((left, right) => right - left);

    for (const authorBreak of authorBreaks) {
      const authorSegment = authorAndTitle.slice(0, authorBreak + 1).replace(/[,;\s]+$/u, '').trim();
      const authorLooksPlaceholderRecoverable =
        /,/.test(authorSegment)
        || /(?:^|[\s,;])[\p{Lu}](?:\.[\s,;]|\.?$)/u.test(authorSegment)
        || /\s*(?:&|and)\s*/iu.test(authorSegment);
      const title = normalizeTitleCandidate(
        authorAndTitle
          .slice(authorBreak + 2)
          .replace(/^[.,;:\s]+/u, '')
          .replace(/^(?:[\p{Lu}]\.\s+)+(?=["“”'‘’]?\p{L}{3,})/u, '')
          .trim(),
      );
      if (
        !authorSegment
        || !title
        || normalizeComparableText(title).split(' ').filter(Boolean).length < 2
      ) {
        continue;
      }

      const parsedAuthors = parseAuthorSegment(authorSegment);
      if (
        parsedAuthors.length < 1
        || (!isRecoverableAuthorSegment(authorSegment, parsedAuthors) && !authorLooksPlaceholderRecoverable)
        || hasIncompleteAuthorTail(authorSegment)
      ) {
        continue;
      }

      candidates.push({
        authorSegment,
        title,
        publisher: normalizedPublisher,
        typeHint: 'book',
        score:
          scorePublisherTailCandidate(normalizedPublisher, title)
          + Math.min(parsedAuthors.length, 3) * 0.18
          - countLeadingAuthorLikeNameSegments(title) * 0.35,
      });
    }
  }

  const bestCandidate = candidates.sort(
    (left, right) =>
      right.score - left.score
      || (right.publisher?.length ?? 0) - (left.publisher?.length ?? 0),
  )[0];

  if (!bestCandidate) {
    return recoverPlaceholderDoiBookFromTail(parseableRaw);
  }

  const { score: _score, ...parsed } = bestCandidate;
  return parsed;
}

function recoverPlaceholderDoiBookFromTail(parseableRaw: string): ParsedReference | null {
  const segments = parseableRaw
    .split('. ')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 3) {
    return null;
  }

  const publisherCandidate = normalizePublisherCandidate(
    segments.at(-1) ?? '',
    segments.slice(0, -1).join('. '),
  );
  if (
    !publisherCandidate
    || (
      !looksPublisherLike(publisherCandidate)
      && !looksInstitutionalContainer(publisherCandidate)
      && !looksStandaloneInstitutionalAlias(publisherCandidate)
    )
  ) {
    return null;
  }

  for (let titleStartIndex = segments.length - 2; titleStartIndex >= 1; titleStartIndex -= 1) {
    const authorSegment = `${segments.slice(0, titleStartIndex).join('. ')}.`.replace(/\.+$/u, '.').trim();
    const title = normalizeTitleCandidate(
      segments
        .slice(titleStartIndex, -1)
        .join('. ')
        .replace(/^(?:[\p{Lu}]\.\s+)+(?=["“”'‘’]?\p{L}{3,})/u, '')
        .trim(),
    );
    if (!authorSegment || !title) {
      continue;
    }

    const parsedAuthors = parseAuthorSegment(authorSegment);
    if (parsedAuthors.length < 1 || hasIncompleteAuthorTail(authorSegment)) {
      continue;
    }

    return {
      authorSegment,
      title,
      publisher: publisherCandidate,
      typeHint: 'book',
    };
  }

  return null;
}

function recoverLoosePlaceholderDoiBookReference(raw: string): ParsedReference | null {
  const normalizedRaw = normalizeExtractionInput(raw);
  if (!hasPlaceholderDoiTail(normalizedRaw)) {
    return null;
  }

  const parseableRaw = collapseRepeatedSentenceBoundaryArtifacts(
    stripTrailingIdentifierTailForParsing(normalizedRaw),
  );
  const publisherBreak = parseableRaw.lastIndexOf('. ');
  if (publisherBreak < 0) {
    return null;
  }

  const beforePublisher = parseableRaw.slice(0, publisherBreak).trim();
  const publisher = stripTrailingPunctuation(parseableRaw.slice(publisherBreak + 2).trim());
  if (
    !beforePublisher
    || !publisher
    || (
      !looksPublisherLike(publisher)
      && !looksInstitutionalContainer(publisher)
      && !looksStandaloneInstitutionalAlias(publisher)
    )
  ) {
    return null;
  }

  const authorBreaks = [...beforePublisher.matchAll(/\.\s+/gu)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);

  for (const authorBreak of authorBreaks) {
    const authorSegment = beforePublisher.slice(0, authorBreak + 1).replace(/[,;\s]+$/u, '').trim();
    const title = normalizeTitleCandidate(
      beforePublisher
        .slice(authorBreak + 2)
        .replace(/^[.,;:\s]+/u, '')
        .replace(/^(?:[\p{Lu}]\.\s+)+(?=["“”'‘’]?\p{L}{3,})/u, '')
        .trim(),
    );
    if (!authorSegment || !title) {
      continue;
    }

    const parsedAuthors = parseAuthorSegment(authorSegment);
    if (parsedAuthors.length < 1 || hasIncompleteAuthorTail(authorSegment)) {
      continue;
    }

    return {
      authorSegment,
      title,
      publisher,
      typeHint: 'book',
    };
  }

  return null;
}

function parseGenericPublisherTailReference(raw: string): ParsedReference | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const placeholderDoiBook = parsePlaceholderDoiBookReference(raw);
  const numericEnumeratedBook = parseNumericEnumeratedPublisherTailBookReference(parseableRaw);
  const numericSentenceTailBook =
    /^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/u.test(parseableRaw)
      ? parseSentenceTailBookReference(parseableRaw)
      : null;
  if (
    /\b(?:vol|volume|issue|no\.?|pp?\.)\b/iu.test(parseableRaw)
    && !/\b(?:press|publishing|publisher|report|standard|bulletin|guideline|recommendation|proceedings|conference|symposium|workshop|congress|meeting)\b/iu.test(parseableRaw)
  ) {
    return null;
  }

  if (
    ((URL_REGEX.test(raw) || hasWebpageAccessCue(raw) || /\bRFC Editor\b/iu.test(raw))
      || (hasWebpageAccessCue(parseableRaw) || /\bRFC Editor\b/iu.test(parseableRaw)))
    && !looksScholarlyRemainder(parseableRaw)
    && !placeholderDoiBook
  ) {
    return null;
  }

  const parsed =
    placeholderDoiBook
    ?? numericEnumeratedBook
    ?? parseRegexMatch(parseableRaw, AUTHOR_DATE_BOOK_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
    }))
    ?? parseRegexMatch(parseableRaw, CORPORATE_PUBLISHER_TAIL_BOOK_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
      typeHint: 'book' as const,
    }))
    ?? parseRegexMatch(parseableRaw, QUOTED_PUBLISHER_TAIL_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
      ...(looksProceedingsLikeDoi(raw.match(DOI_REGEX)?.[0])
        ? { conferenceTitle: normalizeConferenceTitle(groups.publisher), typeHint: 'conference-paper' as const }
        : {}),
    }))
    ?? (
      numericSentenceTailBook
      && typeof numericSentenceTailBook.authorSegment === 'string'
      && parseRecoverableNumericConferenceAuthors(numericSentenceTailBook.authorSegment).length >= 2
        ? numericSentenceTailBook
        : null
    )
    ?? parseRegexMatch(parseableRaw, INITIALS_LATE_YEAR_BOOK_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
      typeHint: 'book' as const,
    }))
    ?? parseRegexMatch(parseableRaw, NUMERIC_SEMICOLON_BOOK_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
    }))
    ?? parseRegexMatch(parseableRaw, NUMERIC_BOOK_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
    }))
    ?? parseSentenceTailBookReference(parseableRaw)
    ?? parseRegexMatch(parseableRaw, GIVEN_NAME_LATE_YEAR_BOOK_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
      typeHint: 'book' as const,
    }))
    ?? parseRegexMatch(parseableRaw, LATE_YEAR_BOOK_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher ? stripTrailingPunctuation(groups.publisher) : undefined,
    }));

  if (!parsed?.publisher) {
    return null;
  }

  const normalizedPublisher = normalizePublisherCandidate(parsed.publisher, parsed.title);
  if (!normalizedPublisher) {
    return null;
  }
  if (isPreprintPublisherTail(raw)) {
    const repository = resolvePreprintRepository(raw, normalizedPublisher, parsed.title);
    return {
      ...parsed,
      publisher: normalizedPublisher,
      ...(repository ? { repository } : {}),
      typeHint: 'preprint',
    };
  }

  if (hasThesisCue(raw)) {
    const institution = normalizeInstitutionCandidate(normalizedPublisher, parsed.year);
    return {
      authorSegment: parsed.authorSegment,
      title: parsed.title,
      year: parsed.year,
      ...(institution ? { institution } : {}),
      thesisType: extractThesisType(raw),
      typeHint: 'thesis',
    };
  }

  if (looksConferenceContainer(normalizedPublisher) && !looksStandaloneInstitutionalAlias(normalizedPublisher)) {
    return {
      authorSegment: parsed.authorSegment,
      title: parsed.title,
      year: parsed.year,
      conferenceTitle: normalizeConferenceTitle(normalizedPublisher),
      typeHint: 'conference-paper',
    };
  }

  const normalizedAuthor = normalizeComparableText(parsed.authorSegment ?? '');
  const normalizedPublisherKey = normalizeComparableText(normalizedPublisher);
  const doiMatch = raw.match(DOI_REGEX)?.[0];
  const inferredIsbn = doiMatch ? inferIsbnFromIdentifier(doiMatch) : null;
  const reportLikeDoi =
    looksReportLikeDoi(doiMatch ?? undefined, {
      raw,
      owner: normalizedPublisher,
    });
  if (
    !inferredIsbn
    && (
      reportLikeDoi
      || looksOstiLikeOwner(normalizedPublisher)
      || 
      /\b(?:report|standard|bulletin|survey|specification|guideline|recommendation)\b/iu.test(raw)
      || (
        looksInstitutionalContainer(normalizedPublisher)
        && !/\b(?:press|publishing|publisher)\b/iu.test(normalizedPublisher)
      )
      || looksStandaloneInstitutionalAlias(normalizedPublisher)
      || looksReportPublisherAcronym(normalizedPublisher)
      || (normalizedAuthor.length > 0 && normalizedAuthor === normalizedPublisherKey)
    )
  ) {
    const repairedTail = splitTrailingInstitutionFromReportTail(
      parsed.title,
      normalizedPublisher,
      parsed.year,
    );
    const institution = repairedTail?.institution
      ?? normalizeInstitutionCandidate(normalizedPublisher, parsed.year);
    return {
      authorSegment: parsed.authorSegment,
      title: repairedTail?.title ?? parsed.title,
      year: parsed.year,
      ...(institution ? { institution } : {}),
      typeHint: 'report',
    };
  }

  return {
    authorSegment: parsed.authorSegment,
    title: parsed.title,
    year: parsed.year,
    publisher: normalizedPublisher,
    typeHint: 'book',
  };
}

function parseGenericWebpageReference(
  raw: string,
  rawSupport?: RawCitationSupport,
): ParsedReference | null {
  const support = rawSupport ?? buildRawCitationSupport(raw);
  const parseableRaw = support.parseableRaw;
  const normalizedRaw = support.normalizedRaw;
  const rawUrl = raw.match(URL_REGEX)?.[0];
  const hasNonDoiUrl = rawUrl != null && !isDoiUrl(rawUrl);
  const hasDoiOnlyUrl = rawUrl != null && isDoiUrl(rawUrl) && !hasNonDoiUrl;
  const hasWebAccessCue = hasWebpageAccessCue(normalizedRaw)
    && (!rawUrl || !isDoiUrl(rawUrl));
  const hasWebpageOwnerTailProfile =
    WEBPAGE_APA_CORPORATE_REGEX.test(parseableRaw)
    || WEBPAGE_CHICAGO_OWNER_REGEX.test(parseableRaw)
    || WEBPAGE_HARVARD_OWNER_SITE_REGEX.test(parseableRaw)
    || WEBPAGE_MLA_REGEX.test(parseableRaw);
  if (hasDoiOnlyUrl) {
    return null;
  }
  if (
    (
      !hasNonDoiUrl
      && !hasWebAccessCue
      && !/\bRFC Editor\b/iu.test(normalizedRaw)
      && !hasWebpageOwnerTailProfile
    )
    || (looksScholarlyRemainder(parseableRaw) && !hasWebpageOwnerTailProfile)
  ) {
    return null;
  }

  return (
    parseHarvardOwnerSiteWebpageReference(parseableRaw)
    ??
    parseRegexMatch(parseableRaw, WEBPAGE_APA_CORPORATE_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher,
      siteName: groups.siteName,
      typeHint: 'webpage',
    }))
    ?? parseRegexMatch(parseableRaw, WEBPAGE_CHICAGO_OWNER_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher,
      siteName: groups.siteName,
      typeHint: 'webpage',
    }))
    ?? parseRegexMatch(parseableRaw, WEBPAGE_CHICAGO_REGEX, (groups) => ({
      title: groups.title,
      year: toYear(groups.year),
      siteName: groups.siteName,
      typeHint: 'webpage',
    }))
    ?? parseRegexMatch(parseableRaw, WEBPAGE_HARVARD_OWNER_SITE_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher,
      siteName: groups.siteName,
      typeHint: 'webpage',
    }))
    ?? parseRegexMatch(parseableRaw, WEBPAGE_HARVARD_REGEX, (groups) => ({
      title: groups.title,
      year: toYear(groups.year),
      siteName: groups.siteName,
      typeHint: 'webpage',
    }))
    ?? parseRegexMatch(parseableRaw, WEBPAGE_IEEE_REGEX, (groups) => ({
      title: groups.title,
      siteName: groups.siteName,
      typeHint: 'webpage',
    }))
    ?? parseRegexMatch(parseableRaw, WEBPAGE_MLA_REGEX, (groups) => ({
      authorSegment: groups.authors,
      title: groups.title,
      year: toYear(groups.year),
      publisher: groups.publisher,
      siteName: groups.siteName,
      typeHint: 'webpage',
    }))
    ?? parseRegexMatch(parseableRaw, WEBPAGE_VANCOUVER_REGEX, (groups) => ({
      title: groups.title,
      year: toYear(groups.year),
      siteName: groups.siteName,
      typeHint: 'webpage',
    }))
  );
}

function parseHarvardOwnerSiteWebpageReference(raw: string): ParsedReference | null {
  const leadMatch = raw.match(/^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\s*(?<remainder>.+)$/iu);
  if (!leadMatch?.groups?.authors || !leadMatch.groups.remainder || !leadMatch.groups.year) {
    return null;
  }

  const remainderClauses = leadMatch.groups.remainder
    .split(/\.\s+/u)
    .map((clause) => stripTrailingPunctuation(clause.trim()))
    .filter(Boolean);
  if (remainderClauses.length < 2) {
    return null;
  }

  const publisher = normalizeInstitutionCandidate(remainderClauses.at(-1), toYear(leadMatch.groups.year));
  const titleAndSite = remainderClauses.slice(0, -1).join('. ').trim();
  const splitIndex = titleAndSite.lastIndexOf(',');
  if (!publisher || splitIndex <= 0) {
    return null;
  }

  const title = stripTrailingPunctuation(titleAndSite.slice(0, splitIndex).trim());
  const siteName = normalizeSiteNameCandidate(titleAndSite.slice(splitIndex + 1).trim());
  if (!title || !siteName || title.split(/\s+/u).filter(Boolean).length < 3) {
    return null;
  }

  return {
    authorSegment: leadMatch.groups.authors.trim(),
    title,
    year: toYear(leadMatch.groups.year),
    publisher,
    siteName,
    typeHint: 'webpage',
  };
}

function mapGenericContainerGroups(
  groups: Record<string, string>,
  fallbackType: 'book-chapter' | 'conference-paper',
  raw?: string,
): ParsedReference {
  const container = normalizeConferenceTitle(groups.container ?? '');
  const normalizedContainer = normalizeComparableText(container);
  const containerDoi = raw?.match(DOI_REGEX)?.[0];
  const forceBookChapter = fallbackType === 'book-chapter' && looksBookChapterDoi(containerDoi);
  const isConference = !forceBookChapter && (
    fallbackType === 'conference-paper'
    || looksConferenceContainer(container)
  );
  const title = groups.title ?? groups.titleQuoted ?? groups.titleBare ?? '';
  const publisher = stripTrailingPunctuation(groups.publisher ?? '');

  return {
    ...(groups.authors ? { authorSegment: groups.authors } : {}),
    ...(title ? { title } : {}),
    ...(groups.year ? { year: toYear(groups.year) } : {}),
    ...(isConference
      ? { conferenceTitle: container, typeHint: 'conference-paper' as const }
      : { bookTitle: container, typeHint: 'book-chapter' as const }),
    ...(groups.pages ? { pages: groups.pages } : {}),
    ...(publisher && normalizedContainer !== normalizeComparableText(publisher) ? { publisher } : {}),
  };
}

function mapAuthorDateQuotedTailGroups(groups: Record<string, string>, raw: string): ParsedReference {
  const title = stripTrailingPunctuation(groups.title ?? '');
  const containerRaw = stripIdentifierTail(stripTrailingPunctuation(groups.container ?? ''));
  const container = containerRaw.replace(/^©\s*/u, '').trim();
  const articleMatch = container.match(
    /^(?<journal>.+?),\s*(?<volume>\d+)\((?<issue>[^)]+)\),\s*p{1,2}\.?\s*(?<pages>[A-Za-z]?\d[\w\-–]*)$/iu,
  );
  if (articleMatch?.groups) {
    return {
      authorSegment: groups.authors,
      title,
      year: toYear(groups.year),
      journal: stripTrailingPunctuation(articleMatch.groups.journal ?? ''),
      volume: articleMatch.groups.volume,
      issue: articleMatch.groups.issue,
      pages: articleMatch.groups.pages,
      typeHint: 'article-journal',
    };
  }

  const chapterTailPages = containerRaw.match(/\bpp?\.\s*(?<pages>[A-Za-z]?\d[\w\-–]*(?:\.[A-Za-z0-9]+)?)/iu)?.groups?.pages;
  const splitBookChapter = splitBookChapterConferenceTail(container, title);
  if (
    splitBookChapter.bookTitle
    && (
      splitBookChapter.publisher
      || looksBookChapterDoi(raw.match(DOI_REGEX)?.[0])
      || chapterTailPages != null
    )
  ) {
    return {
      authorSegment: groups.authors,
      title,
      year: toYear(groups.year),
      bookTitle: splitBookChapter.bookTitle,
      ...(splitBookChapter.publisher ? { publisher: splitBookChapter.publisher } : {}),
      ...(chapterTailPages ? { pages: chapterTailPages } : {}),
      typeHint: 'book-chapter',
    };
  }

  if (
    looksConferenceContainer(container)
    || (
      looksProceedingsLikeDoi(raw.match(DOI_REGEX)?.[0])
      && !looksPublisherLike(container)
    )
  ) {
    return {
      authorSegment: groups.authors,
      title,
      year: toYear(groups.year),
      conferenceTitle: normalizeConferenceTitle(container),
      typeHint: 'conference-paper',
    };
  }

  const publisher = normalizePublisherCandidate(container, title);
  if (publisher) {
    return {
      authorSegment: groups.authors,
      title,
      year: toYear(groups.year),
      ...(looksInstitutionalContainer(publisher) ? { institution: publisher, typeHint: 'report' as const } : { publisher, typeHint: 'book' as const }),
    };
  }

  return {
    authorSegment: groups.authors,
    title,
    year: toYear(groups.year),
  };
}

function mapInCollectionGroups(groups: Record<string, string>, raw: string): ParsedReference {
  const container = normalizeConferenceTitle(groups.container ?? '');
  const isConference =
    looksConferenceContainer(container)
    && !looksBookChapterDoi(raw.match(DOI_REGEX)?.[0]);

  return {
    authorSegment: groups.authors,
    title: groups.title,
    year: extractFirstYear(container) ?? extractFirstYear(raw),
    ...(isConference
      ? { conferenceTitle: container, typeHint: 'conference-paper' as const }
      : { bookTitle: container, typeHint: 'book-chapter' as const }),
    ...(groups.pages ? { pages: groups.pages } : {}),
    ...(groups.publisher ? { publisher: groups.publisher } : {}),
  };
}

function composeCacheKey(...parts: Array<string | null | undefined>): string {
  return parts.map((part) => part ?? '').join('\u0000');
}

function toYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractFirstYear(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const match = value.match(/\b((?:19|20)\d{2})\b/);
  return match?.[1] ? Number(match[1]) : undefined;
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

function getLastClause(text: string): string {
  const clauses = splitSentenceClauses(text)
    .map((part) => stripTrailingPunctuation(part))
    .filter(Boolean);
  return clauses.at(-1) ?? text.trim();
}

function splitTrailingInstitutionFromReportTail(
  title: string | undefined,
  tail: string | undefined,
  year?: number | null,
): { title: string; institution: string } | null {
  const normalizedTail = normalizeConferenceTitle(tail);
  if (!title || !normalizedTail) {
    return null;
  }

  const clauses = splitSentenceClauses(normalizedTail)
    .map((part) => stripTrailingPunctuation(part))
    .filter(Boolean);
  if (clauses.length < 2) {
    return null;
  }

  const institution = normalizeInstitutionCandidate(clauses.at(-1), year);
  const leadingTail = clauses.slice(0, -1).join('. ').trim();
  const repairedTitle = normalizeTitleCandidate([title, leadingTail].filter(Boolean).join('. '));
  if (
    !institution
    || !leadingTail
    || !repairedTitle
    || repairedTitle.split(/\s+/u).filter(Boolean).length < 3
  ) {
    return null;
  }

  return {
    title: repairedTitle,
    institution,
  };
}

function recoverAuthorDateReportTitleFromRaw(
  raw: string,
  institution: string | undefined,
): string | null {
  const normalizedInstitution = normalizeInstitutionCandidate(institution);
  if (!normalizedInstitution) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const escapedInstitution = normalizedInstitution.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = parseableRaw.match(
    new RegExp(
      `^.+?\\((?:19|20)\\d{2}\\)\\.?\\s*(?<title>.+?)\\.\\s*${escapedInstitution.replace(/\s+/gu, '\\s+')}(?:[.;]|$)`,
      'iu',
    ),
  );
  return normalizeTitleCandidate(match?.groups?.title);
}

function recoverAuthorDateOwnerSiteWebpageFromRaw(
  raw: string,
  institution?: string,
): { title: string; siteName: string; institution: string } | null {
  const normalizedInstitution = institution
    ? normalizeInstitutionCandidate(institution)
    : null;
  if (institution && !normalizedInstitution) {
    return null;
  }

  const normalizedRaw = normalizeExtractionInput(raw);
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizedRaw);
  const candidateInputs = parseableRaw === normalizedRaw
    ? [normalizedRaw]
    : [parseableRaw, normalizedRaw];
  const candidates = candidateInputs.flatMap((candidateRaw) => [
    candidateRaw.match(
      /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\s*(?<title>.+?),\s*(?<siteName>[^.]+)\.\s*(?<owner>[^.]+)\.?$/iu,
    ),
    candidateRaw.match(
      /^(?<owner>.+?)\.\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<ownerEcho>.+?)\.\s*(?<siteName>[^.]+?)\.?\s*(?:Available at:\s*)?https?:\/\/[^\s"'<>]+/iu,
    ),
    candidateRaw.match(
      /^(?:\[\d+\]\s*)?(?<owner>.+?),\s*["“](?<title>.+?)(?:[.?!])?["”],?\s*(?<siteName>[^.[\]]+?)(?:\.\s*\[Online\])?\.?\s*(?:Available:\s*)?https?:\/\/[^\s"'<>]+/iu,
    ),
  ]);

  for (const match of candidates) {
    if (!match?.groups?.title || !match.groups.siteName || !match.groups.owner) {
      continue;
    }

    const owner = stripTrailingPunctuation(match.groups.owner).replace(/\s+/gu, ' ').trim();
    const normalizedOwner =
      normalizeInstitutionCandidate(owner, toYear(match.groups.year))
      ?? owner;
    const ownerEchoText = match.groups.ownerEcho
      ? stripTrailingPunctuation(match.groups.ownerEcho).replace(/\s+/gu, ' ').trim()
      : null;
    const ownerEcho =
      ownerEchoText
        ? normalizeInstitutionCandidate(ownerEchoText, toYear(match.groups.year)) ?? ownerEchoText
        : null;
    const title = normalizeTitleCandidate(stripTrailingPunctuation(match.groups.title));
    const siteName = normalizeSiteNameCandidate(match.groups.siteName);
    if (
      !normalizedOwner
      || !title
      || !siteName
      || (
        normalizedInstitution != null
        && normalizeComparableText(normalizedOwner) !== normalizeComparableText(normalizedInstitution)
        && (
          !ownerEcho
          || normalizeComparableText(ownerEcho) !== normalizeComparableText(normalizedInstitution)
        )
      )
    ) {
      continue;
    }

    return {
      title,
      siteName,
      institution: owner,
    };
  }

  return null;
}

function recoverVancouverOwnerSiteWebpageFromRaw(
  raw: string,
): { title: string; siteName: string; institution: string } | null {
  const normalizedRaw = normalizeExtractionInput(raw);
  const match = normalizedRaw.match(
    /^(?:\[\d+\]\s*)?(?<owner>.+?)\.\s+(?<title>.+?)\.\s+(?<siteName>.+?)\s+(?<year>(?:19|20)\d{2})\.\s*https?:\/\/[^\s"'<>]+/iu,
  );
  const institution = match?.groups?.owner
    ? stripTrailingPunctuation(match.groups.owner).replace(/\s+/gu, ' ').trim()
    : null;
  const title = match?.groups?.title
    ? normalizeTitleCandidate(stripTrailingPunctuation(match.groups.title))
    : null;
  const siteName = match?.groups?.siteName
    ? normalizeSiteNameCandidate(match.groups.siteName)
    : null;
  if (!institution || !title || !siteName) {
    return null;
  }

  return {
    title,
    siteName,
    institution,
  };
}

function splitSentenceClauses(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const clauses: string[] = [];
  let clauseStart = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character == null || !/[.?!]/u.test(character)) {
      continue;
    }

    const nextCharacter = normalized[index + 1];
    if (nextCharacter == null || !/\s/u.test(nextCharacter)) {
      continue;
    }

    if (character === '.') {
      const initialFragment = normalized.slice(Math.max(0, index - 10), index + 1);
      if (/(?:^|[\s(])(?:[\p{Lu}]\.){1,5}$/u.test(initialFragment)) {
        continue;
      }

      const abbreviationFragment = normalized.slice(Math.max(0, index - 16), index + 1);
      if (/(?:^|[\s(])(?:[\p{Lu}]\.){2,10}$/u.test(abbreviationFragment)) {
        continue;
      }
    }

    const clause = normalized.slice(clauseStart, index + 1).trim();
    if (clause) {
      clauses.push(clause);
    }

    let nextStart = index + 1;
    while (nextStart < normalized.length && /\s/u.test(normalized[nextStart] ?? '')) {
      nextStart += 1;
    }
    clauseStart = nextStart;
  }

  const trailingClause = normalized.slice(clauseStart).trim();
  if (trailingClause) {
    clauses.push(trailingClause);
  }

  return clauses;
}

function parseInCollectionRemainder(
  text: string,
): { container: string; pages?: string; publisher?: string } | null {
  const match = text.match(
    /^In\s+(?<container>.+?)\s*\((?:pp?\.\s*(?<pages>[^)]+))\)\.\s*(?<publisher>.+?)?\.?$/iu,
  );
  if (!match?.groups) {
    return null;
  }

  return {
    container: match.groups.container?.trim() ?? '',
    ...(match.groups.pages?.trim() ? { pages: match.groups.pages.trim() } : {}),
    ...(match.groups.publisher?.trim() ? { publisher: match.groups.publisher.trim() } : {}),
  };
}

function parseBracketedThesisDetails(
  text: string,
): { thesisType?: string; institution?: string } | null {
  const match = text.match(/\[(?<thesisType>[^\],]+),\s*(?<institution>[^\]]+)\]/u);
  if (!match?.groups) {
    return null;
  }

  return {
    ...(match.groups.thesisType?.trim() ? { thesisType: match.groups.thesisType.trim() } : {}),
    ...(match.groups.institution?.trim() ? { institution: match.groups.institution.trim() } : {}),
  };
}

function looksInstitutionalContainer(text: string): boolean {
  if (!text) return false;
  if (isConferencePlaceholder(text)) return false;
  const normalized = stripIdentifierTail(stripTrailingPunctuation(text)).trim();
  if (!normalized) return false;
  const foldedNormalized = normalized.normalize('NFKD').replace(/\p{Diacritic}/gu, '');
  if (looksJournalLikeContainer(normalized)) {
    return false;
  }
  if (CONFERENCE_CUE_REGEX.test(normalized) || looksProceedingsLikeContainer(normalized)) {
    return false;
  }
  const finalClause = getLastClause(normalized);
  const foldedFinalClause = getLastClause(foldedNormalized);
  if (isConferencePlaceholder(finalClause)) return false;
  if (looksJournalLikeContainer(finalClause)) {
    return false;
  }
  if (CONFERENCE_CUE_REGEX.test(finalClause) || looksProceedingsLikeContainer(finalClause)) {
    return false;
  }
  const institutionalCue =
    /\b(?:survey|department|ministry|agency|commission|bureau|administration|authority|university|institute|laboratory|office|standards|association|society|group|editor|task force|contributors|foundation|fundacio|fundaci[oó]n|funda[cç][aã]o|center|centre|convention|committee|academy|council|organization|organisation|service|services|pharmacopeial)\b/iu;
  return (
    institutionalCue.test(finalClause)
    || institutionalCue.test(normalized)
    || institutionalCue.test(foldedFinalClause)
    || institutionalCue.test(foldedNormalized)
    || looksInstitutionalAcronymPhrase(finalClause)
    || looksInstitutionalAcronymPhrase(normalized)
  );
}

function looksConferencePublisherOrganization(text: string): boolean {
  if (!text) return false;
  const finalClause = getLastClause(text);
  return /\b(?:association|associa[cç][aã]o|asociaci[oó]n|associazione|society|sociedad|sociedade|grupo)\b/iu.test(finalClause);
}

function looksConferenceContainer(text: string | undefined): boolean {
  if (!text) return false;
  return looksConferenceContainerCached(text);
}

function looksConferencePublicationVenue(text: string | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeConferenceTitle(text);
  if (!normalized || isConferencePlaceholder(normalized)) return false;
  if (looksConferenceContainer(normalized)) return true;
  if (looksLocatorHeavyContainerSpill(normalized) || looksContainerInstitutionTailSpill(normalized)) {
    return false;
  }
  if (looksPublisherLike(normalized) || looksInstitutionalContainer(normalized) || looksReportPublisherAcronym(normalized)) {
    return false;
  }
  return looksJournalLikeContainer(normalized) || looksConferenceVenueAlias(normalized);
}

function looksPreprintCue(text: string | undefined): boolean {
  if (!text) return false;
  return looksPreprintCueCached(text);
}

function recoverConferencePlaceholderFromRaw(raw: string): string | null {
  if (/\bpaper presented at\s+n\/?a\b/iu.test(raw)) {
    return 'N/A';
  }
  if (/[.,]\s*(?:19|20)\d{2},\s*n\/?a(?:[.,]|$)/iu.test(raw)) {
    return 'N/A';
  }
  return null;
}

function sanitizeConferenceTitleAfterPropagation(carrier: ReferenceCarrier): void {
  const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
    ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
    : '';
  if (!conferenceTitle) {
    return;
  }

  const repository = typeof carrier.fields.repository.value === 'string'
    ? normalizeConferenceTitle(carrier.fields.repository.value)
    : '';
  const publisher = typeof carrier.fields.publisher.value === 'string'
    ? normalizeConferenceTitle(carrier.fields.publisher.value)
    : '';
  const institution = typeof carrier.fields.institution.value === 'string'
    ? normalizeConferenceTitle(carrier.fields.institution.value)
    : '';
  const journal = typeof carrier.fields.journal.value === 'string'
    ? normalizeConferenceTitle(carrier.fields.journal.value)
    : '';
  const siteName = typeof carrier.fields.siteName.value === 'string'
    ? normalizeConferenceTitle(carrier.fields.siteName.value)
    : '';
  const title = typeof carrier.fields.title.value === 'string'
    ? carrier.fields.title.value
    : '';
  const doi = typeof carrier.fields.doi.value === 'string'
    ? carrier.fields.doi.value
    : undefined;
  const hasArticleLocators =
    hasFieldValue(carrier.fields.volume)
    || hasFieldValue(carrier.fields.issue)
    || hasFieldValue(carrier.fields.pages);
  const hasExplicitProceedingsEvidence =
    looksProceedingsLikeDoi(doi)
    || /\bpaper presented at\b/iu.test(carrier.raw)
    || hasExplicitConferenceTitleCue(conferenceTitle);
  const matchesRepository =
    repository.length > 0
    && normalizeComparableText(conferenceTitle) === normalizeComparableText(repository);
  const matchesPublisher =
    publisher.length > 0
    && normalizeComparableText(conferenceTitle) === normalizeComparableText(publisher);
  const matchesInstitution =
    institution.length > 0
    && normalizeComparableText(conferenceTitle) === normalizeComparableText(institution);
  const matchesJournal =
    journal.length > 0
    && normalizeComparableText(conferenceTitle) === normalizeComparableText(journal);
  const titleEmbedsConference =
    title.length > 0
    && normalizeComparableText(title).includes(normalizeComparableText(conferenceTitle));
  const placeholderConference = recoverConferencePlaceholderFromRaw(carrier.raw);
  const preprintLikeCarrier =
    repository.length > 0
    || looksPreprintCue(carrier.raw)
    || looksPreprintCue(doi)
    || looksPreprintCue(conferenceTitle);
  const webpageLikeConferenceSpill =
    siteName.length > 0
    && !hasExplicitProceedingsEvidence
    && (
      normalizeComparableText(conferenceTitle) === normalizeComparableText(siteName)
      || /\b(?:online|available)\b/iu.test(conferenceTitle)
      || !looksConferencePublicationVenue(conferenceTitle)
    );

  if (
    placeholderConference
    && (
      !conferenceTitle
      || titleEmbedsConference
      || matchesPublisher
      || !looksConferencePublicationVenue(conferenceTitle)
    )
  ) {
    setExtractedField(
      carrier.fields,
      'conferenceTitle',
      fieldOf(
        placeholderConference,
        carrier.fields.conferenceTitle.source,
        STAGE_ID,
        Math.max(0.7, carrier.fields.conferenceTitle.confidence),
        {
          uncertain: true,
          origin: carrier.fields.conferenceTitle.origin,
          previousValue: carrier.fields.conferenceTitle.value,
          previousSource: carrier.fields.conferenceTitle.source,
          previousOrigin: carrier.fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
    return;
  }

  if (
    preprintLikeCarrier
    && !hasExplicitProceedingsEvidence
    && (
      matchesRepository
      || matchesPublisher
      || !looksConferencePublicationVenue(conferenceTitle)
    )
  ) {
    setExtractedField(
      carrier.fields,
      'conferenceTitle',
      fieldOf(
        null,
        carrier.fields.conferenceTitle.source,
        STAGE_ID,
        0,
        {
          uncertain: true,
          origin: carrier.fields.conferenceTitle.origin,
          previousValue: carrier.fields.conferenceTitle.value,
          previousSource: carrier.fields.conferenceTitle.source,
          previousOrigin: carrier.fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
    return;
  }

  if (
    !hasExplicitProceedingsEvidence
    && (
      webpageLikeConferenceSpill
      || (
        siteName.length > 0
        && normalizeComparableText(conferenceTitle) === normalizeComparableText(siteName)
      )
      || (
      matchesPublisher
      || matchesInstitution
      || matchesJournal
      || (
        hasArticleLocators
        && (
          !looksConferencePublicationVenue(conferenceTitle)
          || titleEmbedsConference
        )
      )
      )
    )
  ) {
    setExtractedField(
      carrier.fields,
      'conferenceTitle',
      fieldOf(
        null,
        carrier.fields.conferenceTitle.source,
        STAGE_ID,
        0,
        {
          uncertain: true,
          origin: carrier.fields.conferenceTitle.origin,
          previousValue: carrier.fields.conferenceTitle.value,
          previousSource: carrier.fields.conferenceTitle.source,
          previousOrigin: carrier.fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
    if (typeof carrier.fields.title.value === 'string') {
      const finalizedDecimalTitle = recoverDecimalTerminalTokenFromRaw(
        carrier.raw,
        carrier.fields.title.value,
      );
      if (
        finalizedDecimalTitle
        && normalizeComparableText(finalizedDecimalTitle)
          !== normalizeComparableText(carrier.fields.title.value)
      ) {
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            finalizedDecimalTitle,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }
    }
  }
}

function looksScholarlyRemainder(text: string): boolean {
  return (
    /\b(?:vol|volume|issue|no|pp?)\.?\b/iu.test(text)
    || /\bIn\s+/u.test(text)
    || looksConferenceContainer(text)
    || /;\s*\d+\s*\(\d+\)\s*[:;,]\s*[A-Za-z]?\d+/u.test(text)
    || /\b\d+\s*\(([^)]+)\)\s*[,;:]\s*(?:pp?\.\s*)?[A-Za-z]?\d+/u.test(text)
  );
}

function extractThesisType(text: string): string {
  const normalized = normalizeCueText(text);
  if (/\bdoctoral dissertation\b/u.test(normalized)) {
    return 'Doctoral Dissertation';
  }
  if (/\bphd thesis\b/u.test(normalized)) {
    return 'PhD Thesis';
  }
  if (/\bmaster'?s thesis\b/u.test(normalized)) {
    return "Master's Thesis";
  }
  if (/\bdissertation\b/u.test(normalized)) {
    return 'Dissertation';
  }
  return 'Thesis';
}

function stripTrailingThesisLabel(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?<base>.+?)(?:[,.:;]\s*)(?<label>[^,.:;]+)$/u);
  if (!match?.groups?.base || !match.groups.label) {
    return trimmed;
  }
  return hasThesisCue(match.groups.label) ? match.groups.base.trim() : trimmed;
}

function looksOstiLikeOwner(value: string | undefined): boolean {
  if (!value) return false;
  return /\b(?:office of scientific and technical information|osti|us doe)\b/iu.test(value);
}

function looksReportLikeDoi(
  doi: string | undefined,
  options: { raw?: string | undefined; owner?: string | undefined } = {},
): boolean {
  const normalizedDoi = normalizeDoi(doi ?? undefined) ?? doi?.trim() ?? '';
  if (!normalizedDoi) {
    return false;
  }
  if (EXPLICIT_REPORT_DOI_REGEX.test(normalizedDoi)) {
    return true;
  }
  if (!OSTI_DOI_REGEX.test(normalizedDoi)) {
    return false;
  }
  if (
    options.raw
    && (
      /\bpaper presented at\b/iu.test(options.raw)
      || CONFERENCE_CUE_REGEX.test(options.raw)
      || shouldPreserveConferenceTemporalTail(stripTrailingIdentifierTailForParsing(normalizeExtractionInput(options.raw)))
    )
  ) {
    return false;
  }
  return looksOstiLikeOwner(options.owner) || looksOstiLikeOwner(options.raw);
}

function extractRepository(text: string): string | null {
  const identifierMapped = inferPreprintRepositoryFromText(text);
  if (identifierMapped) {
    return identifierMapped;
  }
  const match = text.match(/(arXiv|SSRN|bioRxiv|medRxiv|Zenodo|Figshare|Preprints\.org|MDPI AG|Research Square Platform LLC|TechRxiv|Elsevier BV|JMIR Publications Inc\.?)/i);
  return match?.[1]?.replace(/\.$/u, '') ?? null;
}

function inferPreprintRepositoryFromText(text: string): string | null {
  if (/10\.2139\/ssrn\./iu.test(text) || /\bSSRN\b/iu.test(text)) {
    return 'Elsevier BV';
  }
  if (/10\.21203\/rs\./iu.test(text) || /\bResearch Square\b/iu.test(text)) {
    return 'Research Square Platform LLC';
  }
  if (/10\.20944\/preprints/iu.test(text) || /\bPreprints\.org\b/iu.test(text) || /\bMDPI AG\b/iu.test(text)) {
    return 'MDPI AG';
  }
  if (/10\.36227\/techrxiv\./iu.test(text) || /\bTechRxiv\b/iu.test(text)) {
    return 'Institute of Electrical and Electronics Engineers (IEEE)';
  }
  if (/10\.2196\/preprints?\./iu.test(text) || /\bJMIR Publications Inc\.?\b/iu.test(text)) {
    return 'JMIR Publications Inc.';
  }
  if (/10\.48550\/arxiv\./iu.test(text) || /(?:^|\b)arxiv(?::|\b)/iu.test(text)) {
    return 'arXiv';
  }
  if (/\bbioRxiv\b/iu.test(text)) {
    return 'bioRxiv';
  }
  if (/\bmedRxiv\b/iu.test(text)) {
    return 'medRxiv';
  }
  return null;
}

function isKnownPreprintRepositoryOwner(value: string | null | undefined): boolean {
  return SPARSE_PREPRINT_OWNER_REGEX.test(normalizeCueText(value));
}

function hasSparsePreprintRepositoryTail(raw: string, repositoryOwner: string): boolean {
  const normalizedOwner = normalizeConferenceTitle(repositoryOwner);
  if (!normalizedOwner || !isKnownPreprintRepositoryOwner(normalizedOwner)) {
    return false;
  }

  const normalizedRaw = normalizeExtractionInput(stripIdentifierTail(raw));
  return new RegExp(
    `(?:[.,;:]\\s*|\\b(?:19|20)\\d{2}\\s*,\\s*)${escapeRegex(normalizedOwner)}\\s*[.,;:]?\\s*$`,
    'iu',
  ).test(normalizedRaw);
}

function resolveSparsePreprintRepositoryOwnerFromTail(raw: string): string | null {
  const candidateOwner = extractRepository(stripIdentifierTail(raw));
  if (!candidateOwner || !isKnownPreprintRepositoryOwner(candidateOwner)) {
    return null;
  }
  if (!hasSparsePreprintRepositoryTail(raw, candidateOwner)) {
    return null;
  }
  return candidateOwner;
}

function stripIdentifierTail(text: string): string {
  return text
    .replace(/\s*doi:\s*\.?$/iu, '')
    .replace(/\s*(?:Available at:\s*)?https?:\/\/[^\s"'<>]+\.?$/iu, '')
    .replace(/\s*https?:\/\/(?:dx\.)?doi\.org\/\.?$/iu, '')
    .replace(/\s*(?:doi:\s*)?10\.\d{4,9}\/[^\s"'<>]+\.?$/iu, '')
    .trim();
}

function isLikelyAuthorlessWebpageReference(raw: string): boolean {
  if (looksScholarlyRemainder(raw)) {
    return false;
  }

  if (/\b(?:journal|review|bulletin|transactions|conference|proceedings|symposium|workshop|press|publishing|springer|wiley|elsevier|apress)\b/iu.test(raw)) {
    return false;
  }

  const yearIndex = raw.search(/\((?:19|20)\d{2}\)/u);
  if (yearIndex <= 0) {
    return false;
  }

  const lead = raw.slice(0, yearIndex).trim();
  if (
    /[,;&]/u.test(lead)
    || /\bet al\.?\b/iu.test(lead)
    || /^[A-Z][\p{L}'-]+,\s*[A-Z]/u.test(lead)
    || /\b(?:and|und|y|e)\b/iu.test(lead)
  ) {
    return false;
  }

  return true;
}

function looksProceedingsLikeContainer(text: string): boolean {
  const words = text.split(/\s+/u).filter(Boolean);
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  if (words.length < 4 || letters.length === 0) return false;
  const uppercaseLetters = letters.filter((char) => char === char.toUpperCase()).length;
  const uppercaseRatio = uppercaseLetters / letters.length;
  const hasConferenceCue = CONFERENCE_CUE_REGEX.test(text);
  const hasProceedingsCue = /\b(?:proceedings|abstracts publication|conference record|book of abstracts|technical sessions?)\b/iu.test(text);
  const hasProceedingsDelimiter = /:\s*[A-Z\p{Lu}]/u.test(text) && words.length >= 5;
  return hasProceedingsDelimiter || (uppercaseRatio >= 0.72 && (hasConferenceCue || hasProceedingsCue));
}

function looksProceedingsLikeDoi(value: string | undefined): boolean {
  if (!value) return false;
  return CONFERENCE_DOI_REGEX.test(value) && !looksBookChapterDoi(value);
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

function normalizeConferenceTitle(value: string | undefined): string {
  if (value == null || value === '') return '';
  return normalizeConferenceTitleCached(value);
}

const normalizeConferenceTitleCached = createBoundedStringCache(
  CONFERENCE_TITLE_NORMALIZATION_CACHE_LIMIT,
  (value) => {
    const normalizedInput = value
      .replace(/\s+/g, ' ')
      .trim();
    const preserveTemporalTail = shouldPreserveConferenceTemporalTail(normalizedInput);

    return normalizedInput
      .replace(/^[A-Z]\.\s*["“”'‘’]\s*/u, '')
      .replace(/^[,.;:\s]+/u, '')
      .replace(/^["“”'‘’\s]+/u, '')
      .replace(/^\s*Paper presented at\s+/iu, '')
      .replace(/^\s*in\s+/iu, '')
      .replace(preserveTemporalTail ? /$^/u : /^\s*(?:19|20)\d{2}\s*,\s*/u, '')
      .replace(preserveTemporalTail ? /$^/u : /^\s*((?:19|20)\d{2})\s+(?=[A-Z])/u, '')
      .replace(preserveTemporalTail ? /$^/u : /\s+(?:19|20)\d{2}\s+[A-Za-z]{3}\s+\d{1,2}\s*$/u, '')
      .replace(preserveTemporalTail ? /$^/u : /\s+(?:19|20)\d{2}\s*$/u, '')
      .replace(/\s+/g, ' ')
      .trim();
  },
);

function shouldPreserveConferenceTemporalTail(value: string): boolean {
  const normalized = value
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return false;
  }

  const yearMatches = normalized.match(/\b(?:19|20)\d{2}\b/gu) ?? [];
  if (yearMatches.length === 0) {
    return false;
  }

  const hasMonthCue = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/iu.test(normalized);
  const hasDateCue = /\b\d{1,2}(?:[–-]\d{1,2})?,\s*(?:19|20)\d{2}\b/u.test(normalized);
  const commaSegments = normalized.split(',').map((segment) => segment.trim()).filter(Boolean);

  const looksAliasLedContainer =
    looksUppercaseProceedingsTitle(normalized)
    || /^[A-Z0-9][A-Z0-9&./-]{2,18}(?:\s+(?:19|20)\d{2})?(?:,|$)/u.test(normalized);
  const startsWithYear = /^(?:19|20)\d{2}\b/u.test(normalized);
  const startsWithYearHeadline = /^(?:19|20)\d{2}\s+(?=[A-Z])/u.test(normalized);
  const hasConferenceNarrativeCue =
    CONFERENCE_CUE_REGEX.test(normalized)
    || /\b(?:annual|program review|technical program review)\b/iu.test(normalized);
  const hasLocationCue =
    /\([^)]*(?:United States|U\.K\.|UK|USA|Canada|Brasil|Brazil|Россия|Russia)\)/iu.test(normalized)
    || /,\s*[A-Z]{2}(?:\s*\([^)]*\))?(?:,|$)/u.test(normalized)
    || /,\s*[A-Z][\p{L}.'-]+(?:\s+[A-Z][\p{L}.'-]+)*,\s*[A-Z]{2}(?:\s*\([^)]*\))?(?:,|$)/u.test(normalized);
  const hasNarrativeDateRangeCue =
    /\b(?:annual|program review|technical program review)\b/iu.test(normalized)
    && /\b\d{1,2}(?:[–-]\d{1,2})?\s+[A-Za-z]{3,9}\s+(?:19|20)\d{2}\b/u.test(normalized);
  if (!looksAliasLedContainer) {
    return (
      (
        startsWithYearHeadline
        && hasConferenceNarrativeCue
        && yearMatches.length === 1
        && !hasMonthCue
        && !hasDateCue
        && commaSegments.length <= 1
      )
      || (
        startsWithYear
        && hasConferenceNarrativeCue
        && commaSegments.length >= 2
        && (hasLocationCue || hasNarrativeDateRangeCue)
      )
    );
  }
  return yearMatches.length > 1 || hasMonthCue || hasDateCue || commaSegments.length >= 3;
}

function collapseJournalAbbreviationToInitialism(value: string): string {
  const tokens = value
    .split(/\s+/u)
    .map((token) => token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/gu, ''))
    .filter(Boolean);

  if (tokens.length < 4) {
    return value;
  }

  const contentTokens = tokens.filter((token) => !/^(?:of|and|the|for|in|on|de|la|le)$/iu.test(token));
  if (contentTokens.length < 4) {
    return value;
  }

  const abbreviationLikeTokens = contentTokens.every((token) => /^[A-Za-z]{1,8}$/u.test(token));
  const compactTokenCount = contentTokens.filter((token) => token.length <= 4).length;
  const singleLetterCount = contentTokens.filter((token) => token.length === 1).length;
  const abbreviationCueCount = contentTokens.filter((token) => /^(?:int|intl|res|rev|med|env(?:iron)?|clin|sci|tech|j)$/iu.test(token)).length;
  if (
    !abbreviationLikeTokens
    || (singleLetterCount === 0 && abbreviationCueCount === 0)
    || compactTokenCount < Math.ceil(contentTokens.length / 2)
  ) {
    return value;
  }

  const initials = contentTokens
    .map((token) => token[0]?.toUpperCase() ?? '')
    .join('');

  return initials.length >= 4 ? initials : value;
}

function normalizeTitleCandidate(value: string | undefined): string | null {
  if (!value) return null;

  let normalized = value.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/^["“”]+/u, '').trim();

  const quoteCount = (normalized.match(/["“”]/gu) ?? []).length;
  if (/["“”]$/u.test(normalized) && quoteCount === 1) {
    normalized = normalized.replace(/["“”]+$/u, '').trim();
  }

  const publisherSpillRepair = recoverTitleBeforePublisherSpill(normalized);
  if (publisherSpillRepair) {
    normalized = publisherSpillRepair;
  }

  normalized = normalized.replace(/[.,;:]+$/u, '').trim();

  return normalized || null;
}

function recoverDecimalTitleContinuationFromPublisherSpill(
  title: string | null,
  publisher: string | null,
  previousPublisher: string | null,
): string | null {
  if (!title || !publisher || !previousPublisher || !/\b\d+$/u.test(title)) {
    return null;
  }

  const publisherIndex = previousPublisher
    .toLocaleLowerCase()
    .indexOf(publisher.toLocaleLowerCase());
  if (publisherIndex <= 0) {
    return null;
  }

  const spillPrefix = previousPublisher.slice(0, publisherIndex).replace(/[\s,;:]+$/u, '').trim();
  const spillMatch = spillPrefix.match(/^(?<fraction>\d+)(?<rest>\s*[-–—].+)$/u);
  if (!spillMatch?.groups?.fraction || !spillMatch.groups.rest) {
    return null;
  }

  const repairedTitle = normalizeTitleCandidate(
    `${title}.${spillMatch.groups.fraction}${spillMatch.groups.rest}`,
  );
  return repairedTitle && repairedTitle.length > title.length ? repairedTitle : null;
}

function repairDecimalTitleContinuationsFromPublisherHistory(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const repairedTitle = recoverDecimalTitleContinuationFromPublisherSpill(
      typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
      typeof carrier.fields.publisher.value === 'string' ? carrier.fields.publisher.value : null,
      typeof carrier.fields.publisher.previousValue === 'string'
        ? carrier.fields.publisher.previousValue
        : null,
    );
    if (!repairedTitle) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'title',
      fieldOf(
        repairedTitle,
        carrier.fields.title.source,
        STAGE_ID,
        Math.max(0.8, carrier.fields.title.confidence),
        {
          origin: carrier.fields.title.origin,
          previousValue: carrier.fields.title.value,
          previousSource: carrier.fields.title.source,
          previousOrigin: carrier.fields.title.origin,
        },
      ) as ExtractedFields['title'],
    );
  }
}

function recoverAuthorSegmentOverflow(authorSegment: string, titleHint?: string | undefined): string {
  const normalized = normalizeExtractionInput(authorSegment).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return normalized;
  }

  const candidates: string[] = [];
  const sentenceBoundary = normalized.match(/^(?<authors>.+?\.)\s+(?<remainder>.+)$/u);
  if (
    sentenceBoundary?.groups?.authors
    && sentenceBoundary.groups.remainder
    && parseAuthorSegment(sentenceBoundary.groups.authors.trim()).length === 1
    && looksTitleLikeOverflowRemainder(sentenceBoundary.groups.remainder, titleHint)
  ) {
    candidates.push(stripTrailingPunctuation(sentenceBoundary.groups.authors.trim()));
  }

  const quoteIndex = normalized.search(/["“]/u);
  if (quoteIndex > 0) {
    candidates.push(stripTrailingPunctuation(normalized.slice(0, quoteIndex).trim()));
  }

  const titleLeadBoundary = findAuthorSegmentBoundaryBeforeTitle(normalized, titleHint);
  if (titleLeadBoundary) {
    candidates.push(titleLeadBoundary);
  }

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed || trimmed === normalized) {
      continue;
    }
    const parsed = parseAuthorSegment(trimmed);
    if (parsed.length > 0 && isValidAuthorSpanText(trimmed, parsed)) {
      return trimmed;
    }
  }

  return normalized;
}

/**
 * Recovery for comma-delimited-FIELDS references (numbered IEEE/engineering bibliographies):
 * "Author(s), Title, Journal, YEAR [Mon D];VOL(ISSUE):PAGES". The standard span detector over-extends
 * the author span through the commas, leaving the title/journal swallowed. This re-derives them from
 * the raw text. Strict: returns null unless a bare ", YEAR" tail (not "(YEAR)"/". YEAR") exists AND a
 * leading name run is followed by a title-prose segment — so period-delimited APA/Vancouver refs and
 * parenthetical-year refs never match.
 */
function recoverCommaDelimitedFieldsReference(raw: string): {
  authorSegment: string;
  title: string;
  journal: string | null;
  year: number | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
} | null {
  let text = normalizeExtractionInput(raw).replace(/\s+/g, ' ').trim();
  text = text.replace(/^\[?\d+[\].)]\s*/, '');
  const tail = text.match(
    /,\s*(?<year>(?:19|20)\d{2})\b[^,;]*?(?:[;,]\s*(?:vol\.?\s*)?(?<vol>\d+)\s*(?:\((?<issue>[^)]+)\))?\s*[:,]\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*\d+)?))?\s*\.?\s*$/i,
  );
  if (!tail || tail.index == null || !tail.groups?.year) return null;
  const head = text.slice(0, tail.index).trim();
  const segs = head.split(',').map((seg) => seg.trim()).filter(Boolean);
  if (segs.length < 2) return null;
  const titleCut = segs.findIndex((seg, idx) => idx >= 1 && looksLikeTitleOrProse(seg));
  if (titleCut < 1) return null;
  const authorSegment = segs.slice(0, titleCut).join(', ');
  if (parseAuthorSegment(authorSegment).length === 0) return null;
  const rest = segs.slice(titleCut);
  let journal = rest.length >= 2 ? rest.slice(1).join(', ') : null;
  let volume = tail.groups.vol ?? null;
  let publisher: string | null = null;
  // Book series tail: a "journal" candidate like "Vol. 679. Springer" is really volume + publisher.
  if (journal) {
    const volPub = journal.match(/^(?:vol\.?\s*)?(?<vol>\d+)\b[.\s]*(?<pub>.+)$/i);
    if (volPub?.groups?.pub && /^\p{Lu}/u.test(volPub.groups.pub.trim())) {
      volume = volume ?? volPub.groups.vol ?? null;
      publisher = volPub.groups.pub.replace(/\.\s*$/, '').trim();
      journal = null;
    }
  }
  return {
    authorSegment,
    title: rest[0] ?? '',
    journal,
    year: Number(tail.groups.year),
    volume,
    issue: tail.groups.issue ?? null,
    pages: tail.groups.pages ? tail.groups.pages.replace(/\s+/g, '') : null,
    publisher,
  };
}

function looksTitleLikeOverflowRemainder(value: string, titleHint?: string | undefined): boolean {
  const normalized = normalizeExtractionInput(value).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  const openingWindow = normalized
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 10)
    .join(' ');
  const wordCount = openingWindow.split(/\s+/u).filter(Boolean).length;
  if (wordCount < 4) {
    return false;
  }

  if (titleHint) {
    const titleTokens = normalizeComparableText(titleHint)
      .split(' ')
      .filter((token) => token.length >= 5);
    if (
      titleTokens.some((token) =>
        new RegExp(`\\b${escapeRegex(token)}\\b`, 'iu').test(openingWindow),
      )
    ) {
      return true;
    }
  }

  const uppercaseWordCount = openingWindow
    .split(/\s+/u)
    .filter((token) => /[\p{Lu}]/u.test(token) && token === token.toUpperCase() && token.length >= 4)
    .length;

  return (
    countLeadingAuthorLikeNameSegments(openingWindow) === 0
    && (
      uppercaseWordCount >= 3
      || openingWindow.includes(':')
      || looksPublisherLike(openingWindow)
      || looksInstitutionalContainer(openingWindow)
      || looksConferenceContainer(openingWindow)
    )
  );
}

function findAuthorSegmentBoundaryBeforeTitle(authorSegment: string, titleHint?: string | undefined): string | null {
  if (!titleHint) {
    return null;
  }

  const tokens = titleHint
    .replace(/&amp;/giu, '&')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  for (const token of tokens.slice(0, 4)) {
    const pattern = new RegExp(`\\b${escapeRegex(token)}\\b`, 'iu');
    const match = pattern.exec(authorSegment);
    if (!match || match.index == null || match.index <= 0) {
      continue;
    }

    const candidate = stripTrailingPunctuation(authorSegment.slice(0, match.index).trim());
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function inferBareConferenceContainer(
  remainder: string | undefined,
  doi?: string,
  publisher?: string,
): string | null {
  const rawTail = stripIdentifierTail(remainder ?? '').trim();
  const directTailContainer = rawTail.match(
    /^(?<container>[^,.;]{2,180}?)(?=(?:[,;]\s*(?:pp?\.\s*[A-Za-z]?\d|(?:19|20)\d{2}\b)|\.\s*(?:19|20)\d{2}\b|$))/iu,
  )?.groups?.container;
  const normalizedDirectTailContainer = normalizeConferenceTitle(directTailContainer ?? '');
  if (
    normalizedDirectTailContainer
    && looksProceedingsLikeDoi(doi)
    && !looksLowQualityContainerCandidate(normalizedDirectTailContainer)
    && !recoverJournalFromContainerLocator(normalizedDirectTailContainer)
  ) {
    return normalizedDirectTailContainer;
  }

  const candidate = normalizeConferenceTitle(rawTail);
  if (!candidate) return null;
  if (
    recoverJournalFromContainerLocator(candidate)
    || /\b(?:vol\.?|volume|no\.?|issue|pp?\.?)\b/iu.test(candidate)
    || /(?:^|[;,]\s*)(?:19|20)\d{2}\s*\([^)]*\)\s*[,;:]\s*[A-Za-z]?\d/u.test(candidate)
    || /(?:^|[;,]\s*)\d+\([^)]*\)\s*[,;:]\s*[A-Za-z]?\d/u.test(candidate)
  ) {
    return null;
  }
  const trailingProceedingsClause = candidate
    .split(/\.\s+/u)
    .map((clause) => normalizeConferenceTitle(clause))
    .filter(Boolean)
    .reverse()
    .find((clause) => looksConferenceContainer(clause) || looksProceedingsLikeContainer(clause));
  if (trailingProceedingsClause) return trailingProceedingsClause;
  if (looksConferenceContainer(candidate)) return candidate;
  if (publisher && normalizeComparableText(candidate) === normalizeComparableText(publisher)) {
    return looksProceedingsLikeDoi(doi) ? candidate : null;
  }
  if (looksProceedingsLikeDoi(doi) && !looksPublisherLike(candidate) && !looksInstitutionalContainer(candidate)) {
    return candidate;
  }
  return null;
}

function looksBookChapterDoi(value: string | undefined): boolean {
  if (!value) return false;
  if (BOOK_CHAPTER_DOI_REGEX.test(value)) {
    return true;
  }

  const inferredIsbn = inferIsbnFromIdentifier(value);
  if (!inferredIsbn) {
    return false;
  }

  const compactValue = value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')
    .replace(/^doi:\s*/iu, '')
    .replace(/[^A-Za-z0-9]/g, '');
  const compactIsbn = inferredIsbn.replace(/[^A-Za-z0-9]/g, '');
  const isbnIndex = compactValue.indexOf(compactIsbn);
  if (isbnIndex < 0) {
    return false;
  }

  const suffix = compactValue.slice(isbnIndex + compactIsbn.length);
  return suffix.length > 0 && /^[A-Za-z0-9]{2,12}$/u.test(suffix);
}

function recoverPublisherAfterContainer(raw: string, container: string, titleHint?: string | null): string | null {
  const normalizedRaw = normalizeExtractionInput(stripTrailingIdentifierTailForParsing(raw));
  const normalizedContainer = normalizeExtractionInput(container);
  const containerIndex = normalizedRaw.toLocaleLowerCase().indexOf(normalizedContainer.toLocaleLowerCase());
  if (containerIndex < 0) {
    return null;
  }

  const tail = normalizedRaw
    .slice(containerIndex + normalizedContainer.length)
    .replace(/^[\s,.;:]+/u, '')
    .trim();
  if (!tail) {
    return null;
  }

  const publisherMatch = tail.match(
    /^(?<publisher>[^,.;]+(?:\s+[^,.;]+){0,8}?)(?=(?:,\s*pp?\.\s*|,\s*(?:19|20)\d{2}\b|;\s*(?:19|20)\d{2}\b|\.\s*(?:19|20)\d{2}\b|\s+(?:19|20)\d{2}\b|\.?\s*Available at\b|\.?\s*https?:\/\/|\.?\s*doi:))/iu,
  );
  const candidate = publisherMatch?.groups?.publisher?.trim();
  return normalizePublisherCandidate(candidate, titleHint ?? undefined);
}

function recoverConferencePublisherAfterContainer(raw: string, container: string, titleHint?: string | null): string | null {
  const recoveredPublisher = recoverPublisherAfterContainer(raw, container, titleHint);
  if (recoveredPublisher) {
    return recoveredPublisher;
  }

  const standaloneTailPublisher = recoverConferencePublisherFromTitleTail(raw, titleHint, container);
  if (standaloneTailPublisher) {
    return standaloneTailPublisher;
  }

  const normalizedRaw = normalizeExtractionInput(stripTrailingIdentifierTailForParsing(raw));
  const normalizedContainer = normalizeExtractionInput(container);
  const containerIndex = normalizedRaw.toLocaleLowerCase().indexOf(normalizedContainer.toLocaleLowerCase());
  if (containerIndex < 0) {
    return null;
  }

  const tail = normalizedRaw
    .slice(containerIndex + normalizedContainer.length)
    .replace(/^[\s,.;:]+/u, '')
    .trim();
  if (!tail) {
    return null;
  }

  const aliasCandidate = tail.match(
    /^(?<publisher>[A-Z][A-Z0-9&./-]{1,18})(?=(?:,\s*pp?\.\s*|,\s*(?:19|20)\d{2}\b|;\s*(?:19|20)\d{2}\b|\.\s*(?:19|20)\d{2}\b|\s+(?:19|20)\d{2}\b|\.?\s*Available at\b|\.?\s*https?:\/\/|\.?\s*doi:))/u,
  )?.groups?.publisher?.trim();

  return aliasCandidate && looksConferenceVenueAlias(aliasCandidate)
    ? normalizeConferenceTitle(aliasCandidate)
    : null;
}

function recoverConferencePublisherFromTitleTail(
  raw: string,
  titleHint?: string | null,
  conferenceTitleHint?: string | null,
): string | null {
  return recoverConferencePublisherFromTitleTailCached(
    composeCacheKey(raw, titleHint, conferenceTitleHint),
  );
}

const recoverConferencePublisherFromTitleTailCached = createBoundedValueCache<string | null>(
  CONFERENCE_PUBLISHER_TITLE_TAIL_CACHE_LIMIT,
  (cacheKey) => {
    const [raw = '', titleHint = '', conferenceTitleHint = ''] = cacheKey.split('\u0000');
    if (!titleHint) {
      return null;
    }

    const tail = extractTailAfterTitle(raw, titleHint);
    if (!tail) {
      return null;
    }

    let working = normalizeExtractionInput(stripTrailingIdentifierTailForParsing(tail))
      .replace(/^[,.;:\s]+/u, '')
      .trim();
    if (!working) {
      return null;
    }

    const normalizedConference = conferenceTitleHint
      ? normalizeExtractionInput(conferenceTitleHint)
      : '';
    if (normalizedConference) {
      const lowerWorking = working.toLocaleLowerCase();
      const lowerConference = normalizedConference.toLocaleLowerCase();
      if (lowerWorking.startsWith(lowerConference)) {
        working = working
          .slice(normalizedConference.length)
          .replace(/^[,.;:\s]+/u, '')
          .trim();
      }
    }

    if (!working) {
      return null;
    }

    const publisherText = working.match(
      /^(?<publisher>.+?)(?=(?:[,;]\s*(?:19|20)\d{2}\b|\.\s*(?:19|20)\d{2}\b|\.?\s*(?:Available at|Retrieved from|doi:)\b|\.?\s*https?:\/\/|$))/iu,
    )?.groups?.publisher?.trim();
    if (!publisherText) {
      return null;
    }

    const normalizedPublisher =
      normalizePublisherCandidate(publisherText, titleHint)
      ?? (
        (
          looksInstitutionalContainer(publisherText)
          || looksConferencePublisherOrganization(publisherText)
          || looksPublisherLike(publisherText)
          || looksStandaloneInstitutionalAlias(publisherText)
        )
          ? normalizeConferenceTitle(publisherText)
          : null
      );
    if (!normalizedPublisher) {
      return null;
    }
    if (
      looksConferenceContainer(normalizedPublisher)
      || looksConferencePublicationVenue(normalizedPublisher)
    ) {
      return null;
    }

    return normalizedPublisher;
  },
);

function recoverStandaloneConferencePublisherSlot(
  raw: string,
  titleHint?: string | null,
  conferenceTitleHint?: string | null,
): string | null {
  return recoverStandaloneConferencePublisherSlotCached(
    composeCacheKey(raw, titleHint, conferenceTitleHint),
  );
}

const recoverStandaloneConferencePublisherSlotCached = createBoundedValueCache<string | null>(
  CONFERENCE_PUBLISHER_SLOT_CACHE_LIMIT,
  (cacheKey) => {
    const [raw = '', titleHint = '', conferenceTitleHint = ''] = cacheKey.split('\u0000');
    if (titleHint) {
      const extractedTail = extractTailAfterTitle(raw, titleHint);
      const tailCandidate = extractedTail
        ? extractedTail
          .replace(/^[\s"'“”'‘’.,;:]+/u, '')
          .replace(/\s*(?:Available at|Retrieved from|doi:|https?:\/\/).+$/iu, '')
          .replace(/\s*[;,]\s*(?:19|20)\d{2}(?:\b|[.,]).*$/iu, '')
          .replace(/[.,;:\s]+$/u, '')
          .trim()
        : '';
      const normalizedTailCandidate = normalizeConferencePublisherSlotCandidate(
        tailCandidate,
        titleHint,
        conferenceTitleHint,
      );
      if (normalizedTailCandidate) {
        return normalizedTailCandidate;
      }
    }

    const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
    if (!parseableRaw) {
      return null;
    }

    const normalizedTitle = titleHint
      ? stripTrailingPunctuation(normalizeExtractionInput(titleHint))
        .replace(/^["“”'‘’\s]+/u, '')
        .replace(/["“”'‘’\s]+$/u, '')
        .trim()
      : '';
    const escapedTitle = normalizedTitle ? escapeRegex(normalizedTitle) : null;
    if (!escapedTitle) {
      return null;
    }

    const slotCandidates = [
      parseableRaw.match(
        new RegExp(
          `${escapedTitle}(?:["”'’]\\.?|\\.)\\s*(?<publisher>.+?)\\.\\s*(?:Available at|Retrieved from|doi:|https?:\\/\\/|$)`,
          'iu',
        ),
      )?.groups?.publisher,
      parseableRaw.match(
        new RegExp(
          `${escapedTitle}(?:["”'’])?\\s*,\\s*(?<publisher>.+?)\\s*[;,]\\s*(?:19|20)\\d{2}(?:\\b|[.,])`,
          'iu',
        ),
      )?.groups?.publisher,
    ];

    for (const candidate of slotCandidates) {
      const normalized = normalizeExplicitConferencePublisherCandidate(
        candidate,
        titleHint,
        conferenceTitleHint,
      ) ?? normalizeConferencePublisherSlotCandidate(
        candidate,
        titleHint,
        conferenceTitleHint,
      );
      if (normalized) {
        return normalized;
      }
    }

    return null;
  },
);

function recoverLooseConferencePublisherSlot(
  raw: string,
  titleHint?: string | null,
  conferenceTitleHint?: string | null,
): string | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  if (!parseableRaw) {
    return null;
  }

  const slotCandidates = [
    parseableRaw.match(
      /["”'’]\.?\s*(?<publisher>.+?)\.\s*(?:Available at|Retrieved from|doi:|https?:\/\/|$)/iu,
    )?.groups?.publisher,
    parseableRaw.match(
      /(?:["”'’]|,)\s*(?<publisher>.+?)\s*[;,]\s*(?:19|20)\d{2}(?:\b|[.,])/iu,
    )?.groups?.publisher,
  ];

  for (const candidate of slotCandidates) {
    const normalized = normalizeConferencePublisherSlotCandidate(
      candidate,
      titleHint,
      conferenceTitleHint,
    );
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function splitBookChapterConferenceTail(
  value: string,
  titleHint?: string | null,
): { bookTitle: string; publisher: string | null } {
  const normalizedValue = normalizeConferenceTitle(value);
  const trimmedTail = normalizedValue
    .replace(/\.\s*Available at\b.+$/iu, '')
    .replace(/,\s*(?:19|20)\d{2}\b.*$/iu, '')
    .replace(/,\s*(?:pp?\.|p\.)\s*.+$/iu, '')
    .replace(/,\s*(?:pp?|p)\.?$/iu, '')
    .replace(/[.,;:\s]+$/u, '')
    .trim();
  const commaParts = trimmedTail.split(/\s*,\s*/u).filter(Boolean);
  const dottedTailMatch = trimmedTail.match(
    /^(?<book>.+?)[.?!]\s+(?<publisher>[^.?!]+)$/iu,
  );

  let rawPublisherCandidate: string | null = null;
  let rawBookTitle = trimmedTail;

  for (let index = commaParts.length - 1; index >= 1; index -= 1) {
    const segment = commaParts[index];
    if (!segment) continue;
    const normalizedPublisher = looksPlausibleTrailingPublisherSegment(segment, titleHint ?? undefined)
      ? normalizePublisherCandidate(segment, titleHint ?? undefined)
      : null;
    if (!normalizedPublisher) continue;
    rawPublisherCandidate = segment.trim();
    rawBookTitle = commaParts.slice(0, index).join(', ');
    break;
  }

  if (
    !rawPublisherCandidate
    && dottedTailMatch?.groups?.publisher
    && looksPlausibleTrailingPublisherSegment(dottedTailMatch.groups.publisher, titleHint ?? undefined)
  ) {
    rawPublisherCandidate = dottedTailMatch.groups.publisher.trim();
    rawBookTitle = dottedTailMatch.groups.book?.trim() ?? trimmedTail;
  }

  const candidateBookTitle = normalizeConferenceTitle(
    rawBookTitle.replace(/,\s*vol\.?\s*\d+$/iu, ''),
  );
  const candidatePublisher = rawPublisherCandidate
    ? (
      normalizePublisherCandidate(rawPublisherCandidate, titleHint ?? undefined)
      ?? (
        looksCompactConferenceVenueAlias(rawPublisherCandidate) && looksConferenceContainer(normalizedValue)
          ? normalizeConferenceTitle(rawPublisherCandidate)
          : null
      )
    )
    : null;

  if (
    !candidatePublisher
    || looksConferenceContainer(candidatePublisher)
    || looksInstitutionalContainer(candidatePublisher)
  ) {
    return { bookTitle: normalizedValue, publisher: null };
  }

  return {
    bookTitle: candidateBookTitle,
    publisher: candidatePublisher,
  };
}

function looksPlausibleTrailingPublisherSegment(value: string, titleHint?: string | null): boolean {
  const normalized = normalizePublisherCandidate(value, titleHint);
  if (!normalized) {
    return false;
  }

  if (looksConferenceContainer(normalized) || looksJournalLikeContainer(normalized)) {
    return false;
  }

  if (looksPublisherLike(normalized) || looksInstitutionalContainer(normalized) || looksReportPublisherAcronym(normalized)) {
    return true;
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  return (
    tokens.length >= 1
    && tokens.length <= 2
    && tokens.every((token) => /^[\p{Lu}][\p{L}&.'’`-]*$/u.test(token))
  );
}

function recoverAuthorDateInCollectionFromRaw(
  raw: string,
): { title: string; bookTitle: string; pages: string | null; publisher: string | null } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const leadingAuthorDate = parseableRaw.match(/^.+?\((?:1[6-9]|20)\d{2}\)\.?\s*(?<rest>.+)$/u);
  const remainder = leadingAuthorDate?.groups?.rest?.trim();
  if (!remainder) {
    return null;
  }

  const match = remainder.match(
    /^(?<title>.+?(?:[.?!]))\s+In\s+(?<container>.+?)\s*\((?:pp?\.\s*(?<pages>[^)]+))\)\.\s*(?<publisher>.+?)\.?$/iu,
  );
  if (!match?.groups?.title || !match.groups.container) {
    return null;
  }

  const title = normalizeTitleCandidate(match.groups.title);
  const bookTitle = normalizeConferenceTitle(match.groups.container);
  const publisher = normalizePublisherCandidate(match.groups.publisher, title ?? undefined);
  const pages = match.groups.pages ? normalizePages(match.groups.pages) : null;
  if (!title || !bookTitle) {
    return null;
  }

  return {
    title,
    bookTitle,
    pages,
    publisher,
  };
}

function recoverBookChapterFromRaw(
  raw: string,
): { title: string; bookTitle: string; pages: string | null; publisher: string | null } | null {
  const authorDateRecovery = recoverAuthorDateInCollectionFromRaw(raw);
  if (authorDateRecovery) {
    return authorDateRecovery;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const parsed =
    parseRegexMatch(parseableRaw, AUTHOR_DATE_QUOTED_CHAPTER_TAIL_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, HARVARD_IN_COLLECTION_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, CHICAGO_IN_COLLECTION_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, MLA_CONTAINER_PAGES_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, VANCOUVER_CONTAINER_PAGES_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw))
    ?? parseRegexMatch(parseableRaw, IEEE_IN_COLLECTION_REGEX, (groups) => mapGenericContainerGroups(groups, 'book-chapter', raw));

  if (!parsed?.title || !parsed.bookTitle) {
    return null;
  }

  return {
    title: parsed.title,
    bookTitle: parsed.bookTitle,
    pages: parsed.pages ?? null,
    publisher: parsed.publisher ?? null,
  };
}

function recoverTrailingTitleLetterFragment(
  raw: string,
  title: string,
  journal: string,
): string | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const match = parseableRaw.match(
    new RegExp(
      `${escapeRegex(stripTrailingPunctuation(title))}\\.(?<fragment>[A-Z])\\.\\s+${escapeRegex(journal)}(?:,|\\s)`,
      'u',
    ),
  );
  const fragment = match?.groups?.fragment?.trim();
  if (!fragment) {
    return null;
  }

  return `${stripTrailingPunctuation(title)}.${fragment}`;
}

function recoverJournalFromContainerLocator(
  value: string,
): { journal: string; volume: string | null; issue: string | null; pages: string | null } | null {
  const normalized = normalizeConferenceTitle(value);
  const patterns = [
    /^(?<journal>.+?),\s*(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?:,\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
    /^(?<journal>.+?),\s*\((?<issue>[^)]+)\)(?:,\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
    /^(?<journal>.+?),\s*no\.?\s*(?<issue>[^,(;:]+)(?:\s*\((?<year>(?:19|20)\d{2})\))?(?::\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
    /^(?<journal>.+?)\s+(?<year>(?:19|20)\d{2});(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?:[:;,]\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
    /^(?<journal>.+?)[;,]\s*(?<volume>\d+)\((?<issue>[^)]+)\)(?:[;,]\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
    /^(?<journal>.+?)\s+(?<volume>\d+)\((?<issue>[^)]+)\)(?:\s+(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
    /^(?<journal>.+?)\s+(?<volume>\d{1,4}),\s*no\.?\s*(?<issue>[^:,(;]+)(?:\s*[:;,]\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
    /^(?<journal>.+?)\s+(?<volume>\d{1,4})$/iu,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const rawJournal = match?.groups?.journal
      ? stripTrailingPunctuation(
        match.groups.year
          ? match.groups.journal.replace(new RegExp(`\\s+${match.groups.year}$`, 'u'), '')
          : match.groups.journal,
      ).trim()
      : null;
    const journal = rawJournal
      ? normalizeJournalCandidate(rawJournal) ?? rawJournal
      : null;
    if (
      !journal
      || looksLowQualityContainerCandidate(journal)
      || looksConferencePublicationVenue(journal)
    ) {
      continue;
    }

    return {
      journal,
      volume: match?.groups?.volume?.trim() ?? null,
      issue: match?.groups?.issue?.trim() ?? null,
      pages: match?.groups?.pages ? normalizePages(match.groups.pages) : null,
    };
  }

  return null;
}

function recoverJournalFromConferenceStyledContainer(
  value: string,
): { journal: string; volume: string | null; issue: string | null; pages: string | null } | null {
  const standardLocator = recoverJournalFromContainerLocator(value);
  if (standardLocator) {
    return standardLocator;
  }

  const normalized = normalizeConferenceTitle(value);
  const semicolonLocator = normalized.match(
    /^(?<journal>.+?)\s+(?<year>(?:19|20)\d{2})\s*;\s*(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?:[:;,]\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
  );
  const journal = semicolonLocator?.groups?.journal
    ? normalizeJournalCandidate(semicolonLocator.groups.journal)
      ?? stripTrailingPunctuation(semicolonLocator.groups.journal).trim()
    : null;
  if (!journal) {
    return null;
  }

  return {
    journal,
    volume: semicolonLocator?.groups?.volume?.trim() ?? null,
    issue: semicolonLocator?.groups?.issue?.trim() ?? null,
    pages: semicolonLocator?.groups?.pages
      ? normalizePages(semicolonLocator.groups.pages)
      : null,
  };
}

function trimContainerOverflowFromTitle(title: string, container: string): string | null {
  const normalizedTitle = normalizeExtractionInput(title);
  const normalizedContainer = normalizeExtractionInput(container);
  const containerIndex = normalizedTitle.toLocaleLowerCase().lastIndexOf(normalizedContainer.toLocaleLowerCase());
  if (containerIndex <= 0) {
    return null;
  }

  const candidate = stripTrailingPunctuation(
    normalizedTitle
      .slice(0, containerIndex)
      .replace(/[,"“”'‘’\s]+$/u, '')
      .trim(),
  );

  const tokenCount = candidate.split(/\s+/u).filter(Boolean).length;
  if (tokenCount >= 3) {
    return candidate;
  }
  return candidate.length >= 8 && /[\p{L}\p{N}]/u.test(candidate) ? candidate : null;
}

function repairEchoedBookTitleOverflow(
  title: string,
  bookTitle: string,
): { title: string; bookTitle: string } | null {
  const echoMatch = bookTitle.match(/^(?<echo>.+?)\.\s+In\s+(?<container>.+)$/iu);
  if (!echoMatch?.groups?.container) {
    return null;
  }

  const repairedBookTitle = normalizeConferenceTitle(echoMatch.groups.container);
  const echoedTitleFragment = stripTrailingPunctuation(echoMatch.groups.echo ?? '');
  const baseTitle = trimContainerOverflowFromTitle(title, repairedBookTitle) ?? stripTrailingPunctuation(title);
  if (!repairedBookTitle || !baseTitle) {
    return null;
  }

  const comparableBaseTitle = normalizeComparableText(baseTitle);
  const comparableEchoedTitleFragment = normalizeComparableText(echoedTitleFragment);
  const repairedTitle = comparableEchoedTitleFragment.length > 0
    && !comparableBaseTitle.endsWith(comparableEchoedTitleFragment)
    ? normalizeTitleCandidate(
      /\bin\b/iu.test(echoedTitleFragment)
        ? `${baseTitle}. ${echoedTitleFragment}`
        : `${baseTitle}. in ${echoedTitleFragment}`,
    )
    : normalizeTitleCandidate(baseTitle);
  if (!repairedBookTitle || !repairedTitle) {
    return null;
  }

  return {
    title: repairedTitle,
    bookTitle: repairedBookTitle,
  };
}

function trimPublisherAndLocatorTailFromBookTitle(
  title: string,
  bookTitle: string,
  publisher: string | null | undefined,
): { title: string; bookTitle: string } | null {
  const normalizedBookTitle = normalizeConferenceTitle(bookTitle);
  if (!normalizedBookTitle) {
    return null;
  }

  const normalizedPublisher = publisher ? normalizeConferenceTitle(publisher) : null;
  let candidate = normalizedBookTitle;

  if (normalizedPublisher) {
    candidate = candidate.replace(
      new RegExp(
        `[\\s,.;:]+${escapeRegex(normalizedPublisher)}(?:[\\s,.;:]+(?:pp?|p)\\.?)?$`,
        'iu',
      ),
      '',
    );
  }

  candidate = candidate
    .replace(/[\s,.;:]+(?:pp?|p)\.?$/iu, '')
    .replace(/[\s,.;:]+$/u, '')
    .trim();

  const repairedBookTitle = normalizeConferenceTitle(candidate);
  if (
    !repairedBookTitle
    || normalizeComparableText(repairedBookTitle) === normalizeComparableText(normalizedBookTitle)
    || looksLowQualityContainerCandidate(repairedBookTitle)
  ) {
    return null;
  }

  const repairedTitle = trimContainerOverflowFromTitle(title, repairedBookTitle) ?? normalizeTitleCandidate(title);
  if (!repairedTitle) {
    return null;
  }

  return {
    title: repairedTitle,
    bookTitle: repairedBookTitle,
  };
}

function looksStandalonePageRangeValue(
  value: string | null | undefined,
  pages: string | null | undefined,
): boolean {
  if (!value) {
    return false;
  }

  const trimmed = stripTrailingPunctuation(value)
    .replace(/^(?:pp?|p)\.?\s*/iu, '')
    .trim();
  if (!trimmed) {
    return false;
  }

  const normalizedPages = pages ? normalizeComparableText(normalizePages(pages)) : '';
  const normalizedValue = normalizeComparableText(normalizePages(trimmed));
  if (normalizedPages.length > 0 && normalizedValue === normalizedPages) {
    return true;
  }

  return /^(?:[A-Za-z]?\d{1,4}|[IVXLCDM]{1,12})(?:\s*[–-]\s*(?:[A-Za-z]?\d{1,4}|[IVXLCDM]{1,12}))$/iu.test(
    trimmed,
  );
}

function getCorporateAuthorLabel(author: CanonicalAuthor | null | undefined): string | null {
  if (!author || !author.isCorporate) {
    return null;
  }
  const candidate = stripTrailingPunctuation(
    author.literal ?? [author.family, author.given].filter(Boolean).join(' '),
  ).trim();
  return candidate.length > 0 ? candidate : null;
}

function recoverLeadingCorporateOwnerFromRaw(raw: string): string | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const ownerMatch = parseableRaw.match(
    /^(?:\[\d+\]\s*)?(?<owner>.+?)(?:\s*\((?:19|20)\d{2}\)|\.(?:\s|$)|,\s*(?:19|20)\d{2}\b)/iu,
  ) ?? parseableRaw.match(
    /^(?:\[\d+\]\s*)?(?<owner>[^,]{2,220}),\s*["“]/u,
  );
  const ownerCandidate = ownerMatch?.groups?.owner
    ? normalizeInstitutionCandidate(ownerMatch.groups.owner)
    : null;
  return ownerCandidate && looksInstitutionalContainer(ownerCandidate) ? ownerCandidate : null;
}

function recoverQuotedRepeatedInstitutionalOwnerReportFromRaw(
  raw: string,
): { owner: string; title: string | null } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw)).trim();
  const match = parseableRaw.match(
    /^(?:\[\d+\]\s*)?(?<owner>[^,]{2,220}),\s*["“](?<title>.+?)(?:[.?!])?["”],?\s*(?<ownerEcho>[^,]{2,220}),\s*(?<year>(?:19|20)\d{2})(?:[.;]|$)/iu,
  );
  if (!match?.groups?.owner || !match.groups.ownerEcho || !match.groups.year) {
    return null;
  }

  const year = toYear(match.groups.year);
  const owner = normalizeInstitutionCandidate(match.groups.owner, year);
  const ownerEcho = normalizeInstitutionCandidate(match.groups.ownerEcho, year);
  if (
    !owner
    || !ownerEcho
    || normalizeComparableText(owner) !== normalizeComparableText(ownerEcho)
  ) {
    return null;
  }

  return {
    owner,
    title: normalizeTitleCandidate(match.groups.title),
  };
}

function recoverRepeatedInstitutionalOwnerReportWithoutYearFromRaw(
  raw: string,
): { owner: string; title: string | null } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw))
    .replace(/\.\s*Available at:?\s*$/iu, '')
    .trim();
  const match = parseableRaw.match(
    /^(?<owner>[A-Z][^.]{2,220}?)\s+(?<title>(?:specification|standard|guide|practice|method|report|recommendation|guideline|manual|bulletin)\b.+?)\.\s*(?<ownerEcho>[^.]{2,220})\.?$/iu,
  );
  if (!match?.groups?.owner || !match.groups.title || !match.groups.ownerEcho) {
    return null;
  }

  const owner =
    normalizeInstitutionCandidate(match.groups.owner)
    ?? stripTrailingPunctuation(match.groups.owner).trim();
  const ownerEcho =
    normalizeInstitutionCandidate(match.groups.ownerEcho)
    ?? stripTrailingPunctuation(match.groups.ownerEcho).trim();
  if (
    !owner
    || !ownerEcho
    || normalizeComparableText(owner) !== normalizeComparableText(ownerEcho)
  ) {
    return null;
  }

  return {
    owner,
    title: normalizeTitleCandidate(match.groups.title),
  };
}

function normalizePublisherCandidate(value: string | undefined, titleHint?: string | null): string | null {
  if (!value) return null;
  const sourceWithStraightQuotes = normalizeInlineQuoteCharacters(value);
  let normalized = stripTrailingPunctuation(value)
    .replace(/&amp;/giu, '&')
    .replace(/^©\s*/u, '')
    .replace(/^["“”'‘’\s]+/u, '')
    .replace(/["“”'‘’\s]+$/u, '')
    .replace(/^\[Online\]\s*/iu, '')
    .replace(/,\s*(?:pp?|p)\.?$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const title = stripTrailingPunctuation(titleHint ?? '');
  if (title) {
    const titlePrefix = new RegExp(`^${escapeRegex(title)}[.\\s,:;-]+`, 'iu');
    const quotedTitlePrefix = new RegExp(`^["“]${escapeRegex(title)}["”][.\\s,:;-]+`, 'iu');
    normalized = normalized.replace(quotedTitlePrefix, '').replace(titlePrefix, '').trim();
    const titleTokens = title.split(/\s+/u).filter(Boolean);
    const trailingTitleToken = titleTokens.at(-1) ?? null;
    if (
      trailingTitleToken
      && (
        /^[ivxlcdm]+$/iu.test(trailingTitleToken)
        || /^[a-z]$/iu.test(trailingTitleToken)
      )
    ) {
      normalized = normalized.replace(
        new RegExp(`^${escapeRegex(trailingTitleToken)}\\.\\s+`, 'iu'),
        '',
      ).trim();
    }

    const embeddedTitleTail = recoverPublisherTailAfterEmbeddedTitle(normalized, title);
    if (embeddedTitleTail) {
      normalized = embeddedTitleTail;
    }
  }

  const copyrightLeadIndex = normalized.search(/(?:^|[\s"“”'‘’])©\s*[\p{Lu}]/u);
  if (copyrightLeadIndex > 0) {
    normalized = normalized.slice(copyrightLeadIndex).trim();
  }

  const leadingInClauses = splitSentenceClauses(normalized);
  if (/^In\s+/iu.test(normalized) && leadingInClauses.length > 1) {
    const trailingPublisherClause = leadingInClauses
      .map((candidate) => stripTrailingPunctuation(candidate.replace(/^In\s+/iu, '').trim()))
      .filter(Boolean)
      .reverse()
      .find((candidate) => looksPublisherLike(candidate) || looksInstitutionalContainer(candidate));
    if (trailingPublisherClause) {
      normalized = trailingPublisherClause;
    }
  }

  const overflowTail = recoverPublisherTailFromOverflowingCandidate(normalized);
  if (overflowTail) {
    normalized = overflowTail;
  }

  normalized = stripTrailingContainerLocatorTail(normalized);
  const legalSuffixSource = normalized;
  if (
    /^(?:[\p{Lu}]\.){1,5}\s+[\p{Lu}][\p{L}&.'’`-]+(?:\s+[\p{Lu}][\p{L}&.'’`-]+){0,5}$/u.test(normalized)
    && !looksLowQualityContainerCandidate(normalized)
  ) {
    return restorePublisherLegalSuffix(legalSuffixSource, normalized);
  }

  const trailingClause = getBestTrailingContainerClause(normalized, (candidate) =>
    looksPublisherLike(candidate) || looksInstitutionalContainer(candidate),
  );
  const finalClause = trailingClause ?? getLastClause(normalized);
  if (finalClause && finalClause !== normalized && (looksPublisherLike(finalClause) || looksInstitutionalContainer(finalClause))) {
    normalized = restorePublisherLegalSuffix(legalSuffixSource, finalClause);
  }

  const restored = rebalanceQuotedPublisherCandidate(
    sourceWithStraightQuotes,
    restorePublisherLegalSuffix(legalSuffixSource, normalized),
  );
  if (
    !restored
    || looksLowQualityContainerCandidate(restored)
    || /^\d+(?:\([^)]*\))?$/u.test(restored)
    || isPublisherTailFragment(restored)
  ) {
    return null;
  }

  return restored;
}

function recoverPublisherTailAfterEmbeddedTitle(
  value: string,
  titleHint: string,
): string | null {
  const normalizedTitle = stripTrailingPunctuation(
    normalizeInlineQuoteCharacters(titleHint),
  ).replace(/^["“”'‘’\s]+/u, '').replace(/["“”'‘’\s]+$/u, '').trim();
  if (!normalizedTitle) {
    return null;
  }

  const normalizedValue = normalizeInlineQuoteCharacters(value).trim();
  const patterns = [
    new RegExp(`^.+?["“]?${escapeRegex(normalizedTitle)}["”]?[.\\s,:;-]+(?<tail>.+)$`, 'iu'),
    new RegExp(`^.+?${escapeRegex(normalizedTitle)}[.\\s,:;-]+(?<tail>.+)$`, 'iu'),
  ];

  for (const pattern of patterns) {
    const match = normalizedValue.match(pattern);
    const tail = match?.groups?.tail
      ? stripTrailingPunctuation(stripPublisherLeadQuoteBleed(match.groups.tail))
      : '';
    if (!tail) {
      continue;
    }
    const recoveredTail = recoverPublisherTailFromOverflowingCandidate(tail) ?? tail;
    if (
      looksPublisherLike(recoveredTail)
      || looksInstitutionalContainer(recoveredTail)
      || looksStandaloneInstitutionalAlias(recoveredTail)
      || looksConferencePublisherOrganization(recoveredTail)
    ) {
      return recoveredTail;
    }
  }

  return null;
}

function recoverPublisherTailFromOverflowingCandidate(value: string): string | null {
  const clauses = value
    .split(/\s*,\s*/u)
    .map((candidate) => stripTrailingPunctuation(candidate.trim()))
    .filter(Boolean);
  if (clauses.length < 2) {
    return null;
  }

  const trailingPublisherClause = [...clauses]
    .reverse()
    .find((candidate) =>
      looksPublisherLike(candidate)
      || looksInstitutionalContainer(candidate)
      || looksStandaloneInstitutionalAlias(candidate)
      || looksConferencePublisherOrganization(candidate),
    );

  return trailingPublisherClause ?? null;
}

function rebalanceQuotedPublisherCandidate(source: string, candidate: string): string {
  const normalizedSource = normalizeInlineQuoteCharacters(source);
  const normalizedCandidate = normalizeInlineQuoteCharacters(candidate);
  const quoteCount = (normalizedCandidate.match(/"/gu) ?? []).length;
  if (quoteCount % 2 === 0) {
    return normalizedCandidate;
  }

  const candidateCore = normalizedCandidate.replace(/"+$/u, '').trim();
  const recovered = normalizedSource.match(
    new RegExp(
      `${escapeRegex(candidateCore)}(?<closing>")(?=[.,;:]?(?:\\s|$))`,
      'u',
    ),
  );

  if (recovered?.groups?.closing) {
    return `${candidateCore}"`;
  }

  return normalizedCandidate;
}

function trimTrailingTitleSuffix(value: string, titleHint?: string | null): string {
  const title = stripTrailingPunctuation(titleHint ?? '');
  if (!title) {
    return value;
  }

  const escapedTitle = escapeRegex(title);
  return value
    .replace(new RegExp(`^${escapedTitle}[.\\s,:;-]+`, 'iu'), '')
    .replace(new RegExp(`^["“]${escapedTitle}["”][.\\s,:;-]+`, 'iu'), '')
    .trim();
}

function restorePublisherLegalSuffix(source: string, candidate: string): string {
  const normalizedCandidate = candidate.trim();
  const leadingInitialsMatch = source.match(
    new RegExp(`^(?<prefix>(?:[\\p{Lu}]\\.){2,5}\\s+)${escapeRegex(normalizedCandidate)}$`, 'u'),
  );
  if (leadingInitialsMatch?.groups?.prefix) {
    return `${leadingInitialsMatch.groups.prefix}${normalizedCandidate}`;
  }
  if (
    /\bGmbH\s*&\s*Co(?:\.)?\s*KG\b/iu.test(source)
    && /\bGmbH\s*&\s*Co\b/iu.test(normalizedCandidate)
    && !/\bKG\b/iu.test(normalizedCandidate)
  ) {
    return /[.,]$/u.test(normalizedCandidate)
      ? `${normalizedCandidate} KG`
      : `${normalizedCandidate}. KG`;
  }
  const suffixMatch = source.match(
    new RegExp(`^${escapeRegex(candidate)}(?:[.,]|\\s)+\\s*(KG|AG|BV|SA|LLC|Ltd|Inc)$`, 'iu'),
  );
  if (!suffixMatch?.[1]) {
    return candidate;
  }

  return /[.,]$/u.test(candidate) ? `${candidate} ${suffixMatch[1]}` : `${candidate}. ${suffixMatch[1]}`;
}

function restorePublisherLegalSuffixFromRaw(raw: string, candidate: string): string {
  const normalizedCandidate = candidate.trim();
  if (!normalizedCandidate) return candidate;

  const copyrightMatch = raw.match(
    new RegExp(`(?:^|[\\s"“”'‘’])(?<publisher>©\\s*${escapeRegex(normalizedCandidate)})(?![\\p{L}])`, 'u'),
  );
  if (copyrightMatch?.groups?.publisher) {
    return copyrightMatch.groups.publisher.trim();
  }

  const leadingInitialsMatch = raw.match(
    new RegExp(`(?<![\\p{L}])(?<publisher>(?:[\\p{Lu}]\\.){2,5}\\s+${escapeRegex(normalizedCandidate)})(?![\\p{L}])`, 'u'),
  );
  if (leadingInitialsMatch?.groups?.publisher) {
    return leadingInitialsMatch.groups.publisher;
  }

  if (
    /\bGmbH\s*&\s*Co(?:\.)?\s*KG\b/iu.test(raw)
    && /\bGmbH\s*&\s*Co\b/iu.test(normalizedCandidate)
    && !/\bKG\b/iu.test(normalizedCandidate)
  ) {
    return /[.,]$/u.test(normalizedCandidate)
      ? `${normalizedCandidate} KG`
      : `${normalizedCandidate}. KG`;
  }

  const suffixMatch = raw.match(
    new RegExp(`${escapeRegex(normalizedCandidate)}(?:[.,]|\\s)+\\s*(KG|AG|BV|SA|LLC|Ltd|Inc)\\b`, 'iu'),
  );
  if (!suffixMatch?.[1]) {
    return candidate;
  }

  return /[.,]$/u.test(normalizedCandidate)
    ? `${normalizedCandidate} ${suffixMatch[1]}`
    : `${normalizedCandidate}. ${suffixMatch[1]}`;
}

function repairPublisherTitleTokenCarryover(
  title: string | null,
  publisher: string | null,
): { title: string; publisher: string } | null {
  if (!title || !publisher) {
    return null;
  }

  const normalizedTitle = stripTrailingPunctuation(title);
  const titleMatch = normalizedTitle.match(
    /^(?<base>.+?)(?:,\s*|\s+)(?<token>[A-Z]|[IVXLCDM]+)$/iu,
  );
  if (!titleMatch?.groups?.base || !titleMatch.groups.token) {
    return null;
  }

  const token = titleMatch.groups.token;
  const repairedPublisher = publisher.replace(
    new RegExp(`^${escapeRegex(token)}\\.\\s+`, 'iu'),
    '',
  ).trim();
  if (!repairedPublisher || repairedPublisher === publisher.trim()) {
    return null;
  }

  const normalizedPublisher = normalizePublisherCandidate(
    repairedPublisher,
    titleMatch.groups.base,
  );
  if (!normalizedPublisher) {
    return null;
  }

  return {
    title: titleMatch.groups.base.trim(),
    publisher: normalizedPublisher,
  };
}

function recoverPublisherFromSwallowedTitleSuffix(
  title: string | null,
): { title: string; publisher: string } | null {
  if (!title || !title.includes(':')) {
    return null;
  }

  const parts = title.split(':');
  const publisherCandidate = stripTrailingPunctuation(parts.pop()?.trim() ?? '');
  const repairedTitle = stripTrailingPunctuation(parts.join(':').trim());
  const publisherWords = publisherCandidate.split(/\s+/u).filter(Boolean);
  const titleCaseWordCount = publisherWords.filter((word) => /^[\p{Lu}]/u.test(word)).length;
  if (
    !publisherCandidate
    || !repairedTitle
    || repairedTitle.split(/\s+/u).filter(Boolean).length < 4
    || publisherWords.length > 8
    || (
      !looksPublisherLike(publisherCandidate)
      && (
        publisherWords.length < 2
        || /^(?:a|an|the)$/iu.test(publisherWords[0] ?? '')
        || /\d/u.test(publisherCandidate)
        || titleCaseWordCount < 2
      )
    )
  ) {
    return null;
  }

  return {
    title: repairedTitle,
    publisher: publisherCandidate,
  };
}

function stripTrailingContainerLocatorTail(value: string): string {
  return value
    .replace(/,\s*\d+\([^)]*\),\s*(?:p{1,2}\.?\s*)?[A-Za-z]?\d[\w\s–-]*$/iu, '')
    .replace(/,\s*p{1,2}\.?\s*[A-Za-z]?\d[\w\s–-]*$/iu, '')
    .replace(/,\s*(?:vol\.?|volume|no\.?|issue)\s*[^,.;]+$/iu, '')
    .replace(/,\s*no\.?\s*$/iu, '')
    .replace(/,\s*\d+\([^)]*\)\s*$/u, '')
    .replace(/,\s*\d+\s*$/u, '')
    .replace(/[;,]\s*(?:19|20)\d{2}\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBestTrailingContainerClause(
  value: string,
  predicate: (candidate: string) => boolean,
): string | null {
  const clauses = value
    .split(/\.\s+/u)
    .map((part) => stripTrailingContainerLocatorTail(part.trim()))
    .filter(Boolean);

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const candidate = clauses[index];
    if (candidate && predicate(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeInstitutionCandidate(value: string | undefined, year?: number | null): string | null {
  if (!value) return null;
  let normalized = stripTrailingPunctuation(value)
    .replace(/^["“”'‘’\s]+/u, '')
    .replace(/["“”'‘’\s]+$/u, '')
    .replace(/^(?:doctoral dissertation|phd thesis|master'?s thesis|dissertation|thesis)[,.:]?\s*/iu, '')
    .replace(/[;,]?\s*(?:doctoral dissertation|phd thesis|master'?s thesis|dissertation|thesis)\s*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  if (year != null) {
    normalized = normalized.replace(new RegExp(`[;,]?\\s*${year}\\s*$`, 'u'), '').trim();
  }

  if (
    /^(?:pp?\.?\s*)?[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*[A-Za-z]?\d[\w–-]*)?$/iu.test(normalized)
    || /^(?:vol\.?|volume|no\.?|issue|pp?\.?)\s*\d[\w–-]*(?:\s*[,:;]\s*[A-Za-z]?\d[\w–-]*)*$/iu.test(normalized)
  ) {
    return null;
  }

  const finalClause = getLastClause(normalized);
  const abbreviationLedInstitution =
    /^(?:[\p{Lu}]\.){2,5}\s+[\p{L}]/u.test(normalized)
    || /^(?:[\p{Lu}]\.){2,5}[\p{L}\s]/u.test(normalized);
  const preserveFullInstitution =
    abbreviationLedInstitution
    || looksInstitutionalContainer(normalized);
  if (!preserveFullInstitution && looksInstitutionalContainer(finalClause)) {
    normalized = finalClause;
  }

  return normalized || null;
}

function looksJournalLikeContainer(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = stripIdentifierTail(stripTrailingPunctuation(value)).trim();
  if (!normalized) return false;
  if (lookupIssnByJournalTitle(normalized)) return true;

  const hasJournalCue = /\b(?:journal|jurnal|revista|review|quarterly|annals?|letters?|bulletin|magazine|transactions?)\b/iu.test(normalized);
  if (hasJournalCue) return true;

  if (looksConferenceContainer(normalized) && !hasJournalCue) {
    return false;
  }

  if (looksPublisherLike(normalized) && !hasJournalCue) {
    return false;
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const hasLowercaseConnector = tokens.some((token) => /^(?:van|von|der|den|de|del|da|do|dos|du|und|and|the|of)$/iu.test(token));
  if (hasLowercaseConnector) {
    return false;
  }
  const abbreviationHeavy =
    tokens.length >= 4
    && tokens.every((token) => /^[A-Za-z&]{1,8}$/u.test(token))
    && tokens.filter((token) => token.length <= 4).length >= Math.ceil(tokens.length / 2);

  return abbreviationHeavy;
}

function looksConferenceVenueAlias(value: string | undefined): boolean {
  if (!value) return false;

  const normalized = normalizeConferenceTitle(value);
  if (!normalized) return false;
  if (/^n\/?a$/iu.test(normalized)) return false;
  if (looksConferenceContainer(normalized)) return true;
  if (looksPublisherLike(normalized)) return false;
  if (looksInstitutionalContainer(normalized)) return false;
  if (looksReportPublisherAcronym(normalized)) return false;
  if (looksLocatorHeavyContainerSpill(normalized)) return false;

  const compact = normalized.replace(/\s+/gu, '');
  if (/^[A-Z][A-Z0-9&./-]{1,18}$/u.test(compact)) {
    return true;
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  if (
    tokens.length >= 2
    && tokens.length <= 4
    && tokens.every((token) => /^[A-Z0-9&./-]{1,4}$/u.test(token))
  ) {
    return false;
  }
  return (
    tokens.length >= 1
    && tokens.length <= 6
    && tokens.every((token) => /^[\p{Lu}\d&./'-]+$/u.test(token))
  );
}

function isConferenceFallbackContainerCandidate(
  value: string | null | undefined,
  options: { rawHasConferenceDoi?: boolean; rawHasConferenceCue?: boolean } = {},
): boolean {
  if (!value) return false;

  const normalized = normalizeConferenceTitle(value);
  if (!normalized || /^n\/?a$/iu.test(normalized)) return false;
  if (looksLocatorHeavyContainerSpill(normalized)) return false;
  const compactAlias = looksCompactConferenceVenueAlias(normalized);
  const hasConferenceEvidence = Boolean(options.rawHasConferenceDoi || options.rawHasConferenceCue);
  const tokenCount = normalized.split(/\s+/u).filter(Boolean).length;
  if (looksConferencePublicationVenue(normalized)) return true;
  if (compactAlias && !hasConferenceEvidence) return false;
  if (looksConferenceVenueAlias(normalized)) return true;
  if (compactAlias) return true;

  if (
    options.rawHasConferenceCue
    && !looksPublisherLike(normalized)
    && !looksLowQualityContainerCandidate(normalized)
    && tokenCount >= 2
    && (
      normalized.includes(',')
      || CONFERENCE_KEYWORD_REGEX.test(normalized)
    )
  ) {
    return true;
  }

  if (options.rawHasConferenceDoi) {
    if (looksInstitutionalContainer(normalized)) return true;
    if (looksPublisherLike(normalized) && normalized.split(/\s+/u).filter(Boolean).length >= 2) return true;
  }

  return false;
}

function looksTitleEmbeddedYearRangePages(
  fields: Partial<Record<ExtractedFieldKey, unknown>>,
): boolean {
  const title = typeof fields.title === 'string' ? fields.title : '';
  const pages = typeof fields.pages === 'string' ? normalizePages(fields.pages) : null;
  if (!title || !pages) {
    return false;
  }

  const normalizedPages = pages.replace(/\s+/gu, '');
  if (!/^(?:1[4-9]|20)\d{2}[–-](?:1[4-9]|20)\d{2}$/u.test(normalizedPages)) {
    return false;
  }
  if (typeof fields.volume === 'string' && fields.volume.trim().length > 0) {
    return false;
  }
  if (typeof fields.issue === 'string' && fields.issue.trim().length > 0) {
    return false;
  }

  const normalizedTitle = normalizeComparableText(title);
  const comparablePages = normalizeComparableText(normalizedPages);
  if (!normalizedTitle.includes(comparablePages)) {
    return false;
  }

  const doi = typeof fields.doi === 'string' ? fields.doi : '';
  const hasBookishSignal =
    (typeof fields.isbn === 'string' && fields.isbn.trim().length > 0)
    || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi)
    || inferIsbnFromIdentifier(doi) != null
    || looksBookChapterDoi(doi)
    || (typeof fields.publisher === 'string' && looksPublisherLike(fields.publisher))
    || (typeof fields.bookTitle === 'string' && fields.bookTitle.trim().length > 0);

  return hasBookishSignal;
}

function clearTitleEmbeddedYearRangePages(
  fields: Partial<Record<ExtractedFieldKey, unknown>>,
  fieldConfidences?: Partial<Record<ExtractedFieldKey, number>>,
  spanTexts?: Partial<Record<ExtractedFieldKey, string>>,
): void {
  if (!looksTitleEmbeddedYearRangePages(fields)) {
    return;
  }

  fields.pages = null;
  if (fieldConfidences) {
    delete fieldConfidences.pages;
  }
  if (spanTexts) {
    delete spanTexts.pages;
  }
}

function recoverCompactConferenceAliasFromDoi(doi: string | undefined, raw?: string | null): string | null {
  return recoverCompactConferenceAliasFromDoiCached(composeCacheKey(doi, raw));
}

const recoverCompactConferenceAliasFromDoiCached = createBoundedValueCache<string | null>(
  COMPACT_CONFERENCE_ALIAS_CACHE_LIMIT,
  (cacheKey) => {
    const [doi = '', raw = ''] = cacheKey.split('\u0000');
    const normalizedDoi = normalizeDoi(doi || undefined) ?? doi.trim();
    if (!normalizedDoi) {
      return null;
    }
    if (looksBookChapterDoi(normalizedDoi) || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(normalizedDoi)) {
      return null;
    }
    const rawHasConferenceCue = Boolean(raw && (CONFERENCE_CUE_REGEX.test(raw) || /\bpaper presented at\b/iu.test(raw)));
    const rawHasArticleLocatorCadence = Boolean(raw && looksArticleLocatorCadenceForConferenceAlias(raw));
    const proceedingsLikeDoi = looksProceedingsLikeDoi(normalizedDoi);
    const conferenceLikeDoi = CONFERENCE_DOI_REGEX.test(normalizedDoi);
    if (
      (!proceedingsLikeDoi && !conferenceLikeDoi && !rawHasConferenceCue)
      || (!proceedingsLikeDoi && !conferenceLikeDoi && rawHasArticleLocatorCadence)
    ) {
      return null;
    }

    const explicitRawAcronym = raw
      ? [...raw.matchAll(/\(([A-Z][A-Z0-9&./-]{2,12})\)/gu)]
        .map((match) => normalizeConferenceTitle(match[1] ?? ''))
        .find((candidate) => candidate && looksCompactConferenceVenueAlias(candidate))
      : null;
    if (explicitRawAcronym) {
      return explicitRawAcronym;
    }

    const doiTail = normalizedDoi.split('/').slice(1).join('/').toUpperCase();
    if (!doiTail) {
      return null;
    }

    const slugCandidates = [
      doiTail.match(/^(?<slug>[A-Z]{3,12})\d{2,}/u)?.groups?.slug,
      doiTail.match(/(?:^|[./-])(?<slug>[A-Z]{3,12})(?:\d|[./-]|$)/u)?.groups?.slug,
    ]
      .map((candidate) => candidate?.trim() ?? '')
      .filter(Boolean)
      .filter((candidate) => !GENERIC_CONFERENCE_ALIAS_TOKENS.has(candidate));

    const alias = slugCandidates.find((candidate) => looksCompactConferenceVenueAlias(candidate));
    return alias ? normalizeConferenceTitle(alias) : null;
  },
);

function recoverConferenceTitleFromDoiHint(
  doi: string | undefined,
  year?: number | null,
): string | null {
  return recoverConferenceTitleFromAuthorityDoiHint(doi, year ?? undefined);
}

function inferPublisherFromDoiHint(doi: string | undefined): string | null {
  return recoverPublisherFromAuthorityDoiHint(doi);
}

function stripPublisherLeadQuoteBleed(value: string): string {
  return value
    .replace(/^[A-Z]\.\s*["”]\s*/u, '')
    .replace(/^[A-Z]["”]\s*/u, '')
    .replace(/^[A-Z]\.(?=["”])/u, '')
    .trim();
}

function recoverTitleBeforePublisherSpill(value: string): string | null {
  const normalized = normalizeInlineQuoteCharacters(value).trim();
  const match = normalized.match(
    /^(?<title>.+?)(?:["”]\s*,\s*|,\s+)(?<publisher>(?:©\s*)?.+)$/u,
  );
  const title = match?.groups?.title
    ? stripTrailingPunctuation(match.groups.title.replace(/["“”'‘’\s]+$/u, '').trim())
    : null;
  const publisher = match?.groups?.publisher
    ? stripTrailingPunctuation(stripPublisherLeadQuoteBleed(match.groups.publisher))
    : null;

  if (
    !title
    || !publisher
    || !(
      looksPublisherLike(publisher)
      || looksInstitutionalContainer(publisher)
      || looksStandaloneInstitutionalAlias(publisher)
      || looksConferencePublisherOrganization(publisher)
    )
  ) {
    return null;
  }

  // Do not split decimal-bearing titles like "Quality 4.0 - ..." at the comma
  // immediately after the decimal fragment.
  if (/\b\d+$/u.test(title) && /^\d+(?:\.\d+)?\s*[-–—]/u.test(publisher)) {
    return null;
  }

  return title;
}

function recoverQuotedConferenceSegmentsFromRaw(
  raw: string,
  conferenceTitleHint?: string | null,
  doiHint?: string | undefined,
): { authors: CanonicalAuthor[]; title: string; publisher: string | null } | null {
  const hasConferenceEvidence =
    Boolean(conferenceTitleHint)
    || Boolean(recoverConferenceTitleFromDoiHint(doiHint))
    || CONFERENCE_DOI_REGEX.test(raw)
    || /\bpaper presented at\b/iu.test(raw)
    || CONFERENCE_CUE_REGEX.test(raw);
  if (!hasConferenceEvidence) {
    return null;
  }

  const normalizedRaw = normalizeInlineQuoteCharacters(raw).replace(/\s+/gu, ' ').trim();
  const match = normalizedRaw.match(
    /^(?:\[\d+\]\s*)?(?<authors>.+?)(?:,\s*|\s+)["“](?<title>.+?)["”][,.;:\s]+(?<publisher>.+?)(?:(?:[,;]\s*(?:19|20)\d{2}\b)|(?:\.\s*(?:Available at|Retrieved from)\b)|(?:\s+doi:\s*)|(?:\s+https?:\/\/)|$)/iu,
  );
  if (!match?.groups?.authors || !match.groups.title || !match.groups.publisher) {
    return null;
  }

  const rawAuthors = stripTrailingPunctuation(match.groups.authors.trim());
  let authors = parseAuthorSegment(rawAuthors);
  if (authors.length === 0) {
    const initialsLeadMatch = rawAuthors.match(
      /^(?<given>(?:[A-ZА-Я]\.?\s+){1,4})(?<family>[\p{L}'’‘-]{2,})$/iu,
    );
    const fallbackAuthor = initialsLeadMatch?.groups?.family
      ? toCanonicalAuthor({
        family: initialsLeadMatch.groups.family,
        given: initialsLeadMatch.groups.given?.replace(/\s+/gu, ' ').trim() ?? null,
      })
      : null;
    if (fallbackAuthor) {
      authors = [fallbackAuthor];
    }
  }
  const title = normalizeTitleCandidate(match.groups.title);
  const publisher = normalizeConferencePublisherSlotCandidate(
    match.groups.publisher,
    title,
    conferenceTitleHint,
  );
  if (!title || authors.length === 0) {
    return null;
  }

  return {
    authors,
    title,
    publisher,
  };
}

function looksArticleLocatorCadenceForConferenceAlias(raw: string): boolean {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  if (!parseableRaw) {
    return false;
  }

  return (
    /\bpp?\.\s*[A-Za-z]?\d[\w\-–]*/iu.test(parseableRaw)
    || /\bvol\.?\s*\d+/iu.test(parseableRaw)
    || /\bno\.?\s*[\w-]+/iu.test(parseableRaw)
    || /\b\d+\(\d+\)\b/u.test(parseableRaw)
    || /\b(?:19|20)\d{2};\d+(?:\([^)]+\))?:[A-Za-z]?\d/u.test(parseableRaw)
  );
}

function recoverCompactConferenceAliasFromRaw(
  raw: string | null | undefined,
  titleHint?: string | null,
): string | null {
  if (!raw) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  if (!parseableRaw) {
    return null;
  }

  const title = typeof titleHint === 'string' ? stripTrailingPunctuation(titleHint).trim() : '';
  const escapedTitle = title ? escapeRegex(title) : null;
  const candidates = [
    escapedTitle
      ? parseableRaw.match(
        new RegExp(
          `${escapedTitle}\\s*,\\s*(?<alias>[A-Z][A-Z0-9&./-]{2,12})\\s*[;,]\\s*(?<year>(?:19|20)\\d{2})\\b`,
          'u',
        ),
      )?.groups?.alias
      : null,
    escapedTitle
      ? parseableRaw.match(
        new RegExp(
          `${escapedTitle}\\s*\\.\\s*(?<alias>[A-Z][A-Z0-9&./-]{2,12})\\s*\\.\\s*(?:Available at|doi:|Retrieved from)\\b`,
          'iu',
        ),
      )?.groups?.alias
      : null,
    parseableRaw.match(
      /(?:^|[.])\s*(?<alias>[A-Z][A-Z0-9&./-]{2,12})\s*[;,]\s*(?<year>(?:19|20)\d{2})\b/u,
    )?.groups?.alias,
    parseableRaw.match(
      /(?:^|[.])\s*(?<alias>[A-Z][A-Z0-9&./-]{2,12})\s*\.\s*(?:Available at|doi:|Retrieved from)\b/iu,
    )?.groups?.alias,
  ]
    .map((candidate) => normalizeConferenceTitle(candidate ?? ''))
    .find((candidate) => candidate && looksStandaloneInstitutionalAlias(candidate));

  return candidates ?? null;
}

function looksCompactConferenceVenueAlias(value: string | undefined): boolean {
  if (!value) return false;

  const normalized = normalizeConferenceTitle(value);
  if (!normalized) return false;
  if (looksConferenceContainer(normalized)) return false;
  if (looksPublisherLike(normalized)) return false;
  if (looksInstitutionalContainer(normalized)) return false;
  if (looksJournalLikeContainer(normalized)) return false;
  if (looksLocatorHeavyContainerSpill(normalized)) return false;

  const compact = normalized.replace(/\s+/gu, '');
  return /^[A-Z0-9&./-]{2,12}$/u.test(compact) && compact === compact.toUpperCase();
}

const GENERIC_CONFERENCE_ALIAS_TOKENS = new Set([
  'ACP',
  'CP',
  'DOI',
  'PROC',
  'PROCEDIA',
  'VOL',
]);

function looksReportPublisherAcronym(value: string): boolean {
  return looksInstitutionalAcronymPhrase(value);
}

function looksInstitutionalAcronymPhrase(value: string): boolean {
  const normalized = normalizeConferenceTitle(value);
  if (!normalized) return false;

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  return (
    tokens.length >= 2
    && tokens.length <= 4
    && tokens.every((token) => /^[A-Z]{2,6}$/u.test(token))
  );
}

function looksStandaloneInstitutionalAlias(value: string): boolean {
  const normalized = normalizeConferenceTitle(value);
  if (!normalized) return false;
  return (
    (
      /^[A-Z][A-Z0-9&./-]{3,11}$/u.test(normalized)
      && !GENERIC_CONFERENCE_ALIAS_TOKENS.has(normalized)
    )
    || /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/u.test(normalized)
  );
}

function looksProceedingsSeriesContainer(value: string): boolean {
  return (
    /^advances in [\p{L}\d,&:/'’(). -]{6,} research$/iu.test(value)
    || /\b(?:aip conference proceedings|ceur workshop proceedings|acm international conference proceeding series|journal of physics: conference series|e3s web of conferences)\b/iu.test(value)
  );
}

function resolvePreprintRepository(raw: string, publisherCandidate?: string | null, titleHint?: string | null): string | null {
  const identifierMapped = inferPreprintRepositoryFromText(raw);
  if (identifierMapped) {
    return identifierMapped;
  }

  const publisher = normalizePublisherCandidate(publisherCandidate ?? undefined, titleHint);
  if (
    publisher
    && !looksLowQualityContainerCandidate(publisher)
    && !looksLikeAuthorSpill(publisher)
    && !/^(?:preprint|working paper)$/iu.test(publisher)
    && publisher.split(/\s+/u).filter(Boolean).length <= 10
  ) {
    return publisher;
  }
  return extractRepository(raw);
}

function normalizeSiteNameCandidate(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = stripTrailingPunctuation(value)
    .replace(/^["'“”‘’\s]+/u, '')
    .replace(/["'“”‘’\s]+$/u, '')
    .replace(/^\[Online\]\s*/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !normalized
    || hasWebpageAccessCue(normalized)
    || looksUrlHostPathArtifact(normalized)
  ) {
    return null;
  }
  return normalized;
}

function looksUrlHostPathArtifact(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = stripTrailingPunctuation(value).trim();
  if (!normalized) {
    return false;
  }
  return (
    /^(?:www\.)?[A-Za-z0-9-]+\.[A-Za-z]{2,}(?:\/[^\s]+)+$/u.test(normalized)
    || /^(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/u.test(normalized)
    || /^[A-Za-z]{2,10}\/[A-Za-z0-9._~%+-]+(?:[-/][A-Za-z0-9._~%+-]+)*$/u.test(normalized)
  );
}

function shouldOverrideWeakWebpageSiteName(
  currentSiteName: string | null,
  comparisonValues: Array<string | null | undefined>,
): boolean {
  if (!currentSiteName) {
    return true;
  }

  if (looksUrlHostPathArtifact(currentSiteName)) {
    return true;
  }

  const comparableCurrentSiteName = normalizeComparableText(currentSiteName);
  if (!comparableCurrentSiteName) {
    return true;
  }

  return comparisonValues.some((value) => {
    const comparableValue = normalizeComparableText(value ?? '');
    return comparableValue.length > 0 && comparableValue === comparableCurrentSiteName;
  });
}

function selectHumanReadableWebpageSiteNameFromPublisher(
  currentSiteName: string | null,
  publisher: string | null | undefined,
  institution: string | null | undefined,
): string | null {
  const normalizedPublisher = normalizeSiteNameCandidate(publisher ?? undefined);
  if (!normalizedPublisher) {
    return null;
  }

  if (!shouldOverrideWeakWebpageSiteName(currentSiteName, [publisher, institution])) {
    return null;
  }

  const comparablePublisher = normalizeComparableText(normalizedPublisher);
  if (!comparablePublisher) {
    return null;
  }

  const comparableInstitution = normalizeComparableText(
    normalizeInstitutionCandidate(institution ?? undefined) ?? institution ?? '',
  );
  if (comparableInstitution && comparablePublisher === comparableInstitution) {
    return null;
  }

  const hasHumanReadableSiteCue =
    /\s/u.test(normalizedPublisher)
    || /\b(?:documentation|docs?|developer|reference|manual|guide|wiki|blog|news|help|support|learn)\b/iu.test(normalizedPublisher)
    || /[A-Z].*[A-Z]/u.test(normalizedPublisher);

  return hasHumanReadableSiteCue ? normalizedPublisher : null;
}

function looksWebpageSiteOwnerBlend(
  value: string | null | undefined,
  siteName: string | null | undefined,
  institution: string | null | undefined,
): boolean {
  const normalizedValue = normalizeComparableText(stripTrailingPunctuation(value ?? ''));
  if (!normalizedValue) {
    return false;
  }

  if (looksUrlHostPathArtifact(value ?? undefined)) {
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

function extractSiteNameFromUrl(url: string | undefined): string | null {
  if (!url || isDoiUrl(url)) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./iu, '').trim();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

function recoverNamedSiteLabelFromRaw(raw: string, url: string | undefined): string | null {
  if (!url || isDoiUrl(url)) {
    return null;
  }

  try {
    const host = new URL(url).hostname.replace(/^www\./iu, '').toLowerCase();
    const hostLabelPatterns: Array<{ hostPattern: RegExp; labelPattern: RegExp; label: string }> = [
      { hostPattern: /^rfc-editor\.org$/iu, labelPattern: /\bRFC Editor\b/u, label: 'RFC Editor' },
      { hostPattern: /^docs\.python\.org$/iu, labelPattern: /\bPython Documentation\b/u, label: 'Python Documentation' },
      { hostPattern: /^developer\.mozilla\.org$/iu, labelPattern: /\bMDN Web Docs\b/u, label: 'MDN Web Docs' },
      { hostPattern: /(?:^|\.)w3\.org$/iu, labelPattern: /\bW3C\b/u, label: 'W3C' },
      { hostPattern: /^react\.dev$/iu, labelPattern: /\bReact\b/u, label: 'React' },
    ];

    for (const candidate of hostLabelPatterns) {
      if (candidate.hostPattern.test(host) && candidate.labelPattern.test(raw)) {
        return candidate.label;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function stripAccessTail(value: string): string {
  return value
    .replace(/\s*(?:[.,;:]?\s*)?(?:Accessed|Retrieved)(?:\s+from)?\s+.+$/iu, '')
    .replace(/\s*(?:[.,;:]?\s*)?Available at\s+.+$/iu, '')
    .trim();
}

function recoverWebpageTitleBeforeUrl(raw: string): string | null {
  const normalizedRaw = normalizeExtractionInput(raw);
  const match =
    normalizedRaw.match(/^\s*.+?\s*\((?:19|20)\d{2}\)\.\s*(?<title>.+?)\.\s*https?:\/\/[^\s"'<>]+/iu)
    ?? normalizedRaw.match(/^\s*(?<title>.+?)\.\s*https?:\/\/[^\s"'<>]+/iu);
  const title = match?.groups?.title
    ? normalizeTitleCandidate(stripAccessTail(match.groups.title))
    : null;
  return title;
}

function repairConflictingContainerFields(
  fields: Partial<Record<ExtractedFieldKey, unknown>>,
  context: {
    raw: string;
    title?: string | null;
    year?: number | null | undefined;
    referenceType?: ReferenceType | null | undefined;
    precomputed?: {
      parseableRaw?: string;
      rawHasThesisCue?: boolean;
      rawHasReportCue?: boolean;
      rawHasConferenceCue?: boolean;
      rawHasWebsiteAccessMarker?: boolean;
      rawHasNonDoiUrl?: boolean;
      rawHasDoiOnlyUrl?: boolean;
      rawHasWebpageOwnerTailProfile?: boolean;
    };
  },
): void {
  const title = typeof context.title === 'string' ? context.title : '';
  if (typeof fields.publisher === 'string') {
    fields.publisher = restorePublisherLegalSuffixFromRaw(context.raw, fields.publisher);
  }
  const normalizedTitle = normalizeComparableText(title);
  const rawJournalText = typeof fields.journal === 'string'
    ? normalizeConferenceTitle(fields.journal)
    : null;
  const journal = typeof fields.journal === 'string'
    ? normalizeJournalCandidate(fields.journal, title)
    : null;
  const doi = typeof fields.doi === 'string' ? fields.doi : null;
  const rawPublisher = typeof fields.publisher === 'string' ? fields.publisher : null;
  const publisher = typeof fields.publisher === 'string' ? normalizePublisherCandidate(fields.publisher, title) : null;
  const institution = typeof fields.institution === 'string'
    ? normalizeInstitutionCandidate(fields.institution, context.year ?? undefined)
    : null;
  const bookTitle = typeof fields.bookTitle === 'string' ? normalizeConferenceTitle(fields.bookTitle) : null;
  const conferenceTitle = typeof fields.conferenceTitle === 'string'
    ? normalizeConferenceTitle(fields.conferenceTitle)
    : null;
  const repository = typeof fields.repository === 'string'
    ? resolvePreprintRepository(context.raw, fields.repository, title)
    : null;
  const siteName = typeof fields.siteName === 'string'
    ? normalizeSiteNameCandidate(fields.siteName)
    : null;
  const comparableSiteName = siteName ? normalizeComparableText(siteName) : '';
  const comparablePublisher = publisher ? normalizeComparableText(publisher) : '';
  const comparableInstitution = institution ? normalizeComparableText(institution) : '';
  const comparableBookTitle = bookTitle ? normalizeComparableText(bookTitle) : '';
  const doiConferenceAlias = recoverCompactConferenceAliasFromDoi(
    typeof fields.doi === 'string' ? fields.doi : undefined,
    context.raw,
  );
  if (
    doiConferenceAlias
    && conferenceTitle
    && looksCompactConferenceVenueAlias(conferenceTitle)
    && normalizeComparableText(conferenceTitle) !== normalizeComparableText(doiConferenceAlias)
  ) {
    fields.conferenceTitle = doiConferenceAlias;
  }
  const hasIsbn = typeof fields.isbn === 'string' && fields.isbn.trim().length > 0;
  const hasPublisherCue = publisher ? looksPublisherLike(publisher) : false;
  if (looksTitleEmbeddedYearRangePages(fields)) {
    fields.pages = null;
  }
  let effectiveReferenceType = resolveReferenceTypeForFieldGuards(fields, context.referenceType ?? null);
  const strippedRaw = context.precomputed?.parseableRaw
    ?? stripTrailingIdentifierTailForParsing(normalizeExtractionInput(context.raw));
  const hasThesisCueInRaw =
    (typeof fields.thesisType === 'string' && fields.thesisType.trim().length > 0)
    || context.precomputed?.rawHasThesisCue
    || hasThesisCue(context.raw);
  const rawHasReportCue = context.precomputed?.rawHasReportCue ?? hasReportCue(context.raw);
  const rawHasConferenceCue = context.precomputed?.rawHasConferenceCue
    ?? (
      /\bpaper presented at\b/iu.test(context.raw)
      || CONFERENCE_CUE_REGEX.test(context.raw)
    );
  const hasBookChapterContext =
    effectiveReferenceType === 'book-chapter'
    || context.referenceType === 'book-chapter'
    || looksBookChapterDoi(doi ?? undefined)
    || /\bIn\s+/u.test(strippedRaw);
  const rawUrl = context.raw.match(URL_REGEX)?.[0];
  const hasNonDoiUrl = context.precomputed?.rawHasNonDoiUrl ?? (rawUrl != null && !isDoiUrl(rawUrl));
  const hasDoiOnlyUrl = context.precomputed?.rawHasDoiOnlyUrl
    ?? (rawUrl != null && isDoiUrl(rawUrl) && !hasNonDoiUrl);
  const hasWebpageOwnerTailProfile = context.precomputed?.rawHasWebpageOwnerTailProfile
    ?? (
      WEBPAGE_APA_CORPORATE_REGEX.test(strippedRaw)
      || WEBPAGE_CHICAGO_OWNER_REGEX.test(strippedRaw)
      || WEBPAGE_HARVARD_OWNER_SITE_REGEX.test(strippedRaw)
      || WEBPAGE_MLA_REGEX.test(strippedRaw)
    );
  const hasWebpageCue =
    hasNonDoiUrl
    || ((context.precomputed?.rawHasWebsiteAccessMarker ?? hasWebpageAccessCue(context.raw)) && !hasDoiOnlyUrl);
  const likelyWebpageContext =
    !hasDoiOnlyUrl
    &&
    hasWebpageCue
    && !rawHasReportCue
    && (!looksScholarlyRemainder(strippedRaw) || hasWebpageOwnerTailProfile);
  const hasArticleLocatorsGlobal =
    (typeof fields.volume === 'string' && fields.volume.trim().length > 0)
    || (typeof fields.issue === 'string' && fields.issue.trim().length > 0)
    || (typeof fields.pages === 'string' && fields.pages.trim().length > 0);
  const conferenceTitleMatchesTitle =
    conferenceTitle != null
    && normalizedTitle.length > 0
    && normalizeComparableText(conferenceTitle) === normalizedTitle;
  const strongConferenceContainer =
    conferenceTitle != null
    && !conferenceTitleMatchesTitle
    && looksConferencePublicationVenue(conferenceTitle);
  const journalGroundedInRaw =
    journal != null
    && citationContainsGroundedContainer(strippedRaw, journal);
  const suspiciousPublisherJournal =
    rawJournalText != null
    && looksPublisherYearOnlyLocator(
      rawJournalText,
      typeof fields.volume === 'string' ? fields.volume : null,
      typeof fields.issue === 'string' ? fields.issue : null,
    );

  if (
    suspiciousPublisherJournal
    && !conferenceTitle
    && !likelyWebpageContext
  ) {
    const recoveredPublisher = normalizePublisherCandidate(rawJournalText, title);
    if (recoveredPublisher) {
      fields.publisher = recoveredPublisher;
    }
    if (
      typeof fields.volume === 'string'
      && isYearLikeLocatorValue(fields.volume)
      && typeof fields.year !== 'number'
    ) {
      fields.year = Number(fields.volume);
    }
    fields.journal = null;
    fields.volume = null;
    if (typeof fields.issue === 'string' && !fields.pages) {
      fields.issue = null;
    }
    if (
      (hasIsbn || (doi != null && /10\.\d{4,9}\/97[89]/iu.test(doi)))
      && effectiveReferenceType === 'article-journal'
    ) {
      effectiveReferenceType = 'book';
    }
  }

  if (publisher) {
    fields.publisher = publisher;
  }

  if (typeof fields.title === 'string' && typeof fields.publisher === 'string') {
    const repairedTitlePublisher = repairPublisherTitleTokenCarryover(
      fields.title,
      fields.publisher,
    );
    if (repairedTitlePublisher) {
      fields.title = repairedTitlePublisher.title;
      fields.publisher = repairedTitlePublisher.publisher;
    }
  }

  if (institution) {
    fields.institution = institution;
  }

  if (repository) {
    fields.repository = repository;
  }

  if (journal) {
    fields.journal = journal;
  }

  if (
    typeof fields.title === 'string'
    && typeof fields.journal === 'string'
    && typeof fields.publisher === 'string'
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
    )
  ) {
    const repairedArticlePublisherSpill = repairArticlePublisherLocatorSpill(
      context.raw,
      fields.title,
      fields.journal,
      fields.publisher,
    );
    if (repairedArticlePublisherSpill) {
      if (repairedArticlePublisherSpill.title) {
        fields.title = repairedArticlePublisherSpill.title;
      }
      fields.publisher = null;
    } else if (
      !looksPublisherLike(fields.publisher)
      && !looksInstitutionalContainer(fields.publisher)
      && normalizeComparableText(fields.publisher).includes(normalizeComparableText(fields.journal))
    ) {
      fields.publisher = null;
    }
  }

  if (siteName) {
    fields.siteName = siteName;
  }

  if (conferenceTitle) {
    fields.conferenceTitle = conferenceTitle;
  }

  if (
    !fields.conferenceTitle
    && !fields.bookTitle
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && !fields.repository
    && !looksPreprintCue(context.raw)
    && typeof fields.publisher === 'string'
    && looksJournalLikeContainer(fields.publisher)
    && (
      effectiveReferenceType === 'conference-paper'
      || effectiveReferenceType === 'book'
      || effectiveReferenceType === 'unknown'
      || effectiveReferenceType == null
    )
  ) {
    fields.conferenceTitle = normalizeConferenceTitle(fields.publisher);
    fields.publisher = null;
    effectiveReferenceType = 'conference-paper';
  }

  if (typeof fields.conferenceTitle === 'string' && typeof fields.title === 'string') {
    const recoveredConferenceVenue = recoverConferenceVenuePrefixFromRaw(
      context.raw,
      fields.title,
      fields.conferenceTitle,
    );
    if (recoveredConferenceVenue) {
      fields.conferenceTitle = recoveredConferenceVenue;
    }
  }

  if (
    typeof fields.conferenceTitle === 'string'
    && looksSwallowedConferenceTitleCandidate(fields.conferenceTitle, title)
    && !looksConferencePublicationVenue(fields.conferenceTitle)
  ) {
    fields.conferenceTitle = null;
  }

  if (
    strongConferenceContainer
    && typeof fields.journal === 'string'
    && fields.journal.trim().length > 0
    && !journalGroundedInRaw
  ) {
    fields.journal = null;
    effectiveReferenceType = 'conference-paper';
  }

  if (
    typeof fields.conferenceTitle === 'string'
    && conferenceTitleMatchesTitle
    && !looksConferencePublicationVenue(fields.conferenceTitle)
  ) {
    fields.conferenceTitle = null;
  }

  if (
    typeof fields.conferenceTitle === 'string'
    && typeof fields.title === 'string'
    && !looksConferencePublicationVenue(fields.conferenceTitle)
  ) {
    const recoveredTitle = recoverTitleContinuationFromRaw(context.raw, fields.title, fields.conferenceTitle);
    if (recoveredTitle) {
      fields.title = recoveredTitle;
      fields.conferenceTitle = null;

      const recoveredJournalTail = extractTailAfterTitle(context.raw, recoveredTitle);
      const recoveredJournalLocator = recoveredJournalTail
        ? recoverJournalFromContainerLocator(recoveredJournalTail)
        : null;
      if (recoveredJournalLocator) {
        fields.journal = recoveredJournalLocator.journal;
        if (!fields.volume && recoveredJournalLocator.volume) {
          fields.volume = recoveredJournalLocator.volume;
        }
        if (!fields.issue && recoveredJournalLocator.issue) {
          fields.issue = recoveredJournalLocator.issue;
        }
        if (!fields.pages && recoveredJournalLocator.pages) {
          fields.pages = recoveredJournalLocator.pages;
        }
      }
    }
  }

  if (
    typeof fields.title === 'string'
    && (
      typeof fields.conferenceTitle === 'string'
      || typeof fields.publisher === 'string'
      || typeof fields.institution === 'string'
    )
  ) {
    const recoveredDecimalOverflow = recoverDecimalTitleOverflowFromRaw(context.raw, fields.title);
    if (recoveredDecimalOverflow) {
      const overflowKey = normalizeComparableText(recoveredDecimalOverflow.overflow);
      fields.title = recoveredDecimalOverflow.title;

      if (
        typeof fields.conferenceTitle === 'string'
        && normalizeComparableText(fields.conferenceTitle).startsWith(overflowKey)
      ) {
        const repairedConferenceTitle = recoveredDecimalOverflow.tail
          ? normalizeConferenceTitle(recoveredDecimalOverflow.tail)
          : null;
        fields.conferenceTitle =
          repairedConferenceTitle && !looksLowQualityContainerCandidate(repairedConferenceTitle)
            ? repairedConferenceTitle
            : null;
      }

      if (
        typeof fields.publisher === 'string'
        && normalizeComparableText(fields.publisher).startsWith(overflowKey)
      ) {
        fields.publisher = null;
      }

      if (
        typeof fields.institution === 'string'
        && normalizeComparableText(fields.institution).startsWith(overflowKey)
      ) {
        fields.institution = null;
      }
    }
  }

  if (
    typeof fields.journal === 'string'
    && (
      !fields.volume
      || !fields.issue
      || !fields.pages
    )
  ) {
    const bareTrailingVolume = fields.journal.match(/^(?<journal>.+?)\s+(?<volume>\d{1,4})$/u);
    const bareTrailingJournalText =
      typeof bareTrailingVolume?.groups?.journal === 'string'
        ? bareTrailingVolume.groups.journal
        : null;
    const bareTrailingVolumeText =
      typeof bareTrailingVolume?.groups?.volume === 'string'
        ? bareTrailingVolume.groups.volume.trim()
        : null;
    const bareJournal = bareTrailingJournalText
      ? normalizeJournalCandidate(bareTrailingJournalText, title)
      : null;
    if (!fields.volume && bareJournal) {
      fields.journal = bareJournal;
      fields.volume = bareTrailingVolumeText;
      effectiveReferenceType = 'article-journal';
    }

    const journalFieldValue = typeof fields.journal === 'string' ? fields.journal : null;
    const recoveredJournalLocator =
      journalFieldValue != null
        ? (
          recoverJournalFromConferenceStyledContainer(journalFieldValue)
          ?? recoverJournalFromContainerLocator(journalFieldValue)
        )
        : null;
    if (
      recoveredJournalLocator
      && journalFieldValue != null
      && normalizeComparableText(recoveredJournalLocator.journal)
        !== normalizeComparableText(journalFieldValue)
    ) {
      fields.journal = recoveredJournalLocator.journal;
      if (!fields.volume && recoveredJournalLocator.volume) {
        fields.volume = recoveredJournalLocator.volume;
      }
      if (!fields.issue && recoveredJournalLocator.issue) {
        fields.issue = recoveredJournalLocator.issue;
      }
      if (!fields.pages && recoveredJournalLocator.pages) {
        fields.pages = recoveredJournalLocator.pages;
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  if (
    typeof fields.title === 'string'
    && (
      !fields.journal
      || !fields.volume
      || !fields.issue
    )
  ) {
    const recoveredWordLocatorArticle = recoverAuthorDateWordLocatorArticleFromRaw(context.raw);
    if (recoveredWordLocatorArticle) {
      fields.title = recoveredWordLocatorArticle.title;
      fields.journal = recoveredWordLocatorArticle.journal;
      if (!fields.volume) {
        fields.volume = recoveredWordLocatorArticle.volume;
      }
      if (!fields.issue && recoveredWordLocatorArticle.issue) {
        fields.issue = recoveredWordLocatorArticle.issue;
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  if (!fields.journal && typeof fields.title === 'string') {
    const swallowedJournalLocator = recoverArticleLocatorFromEmbeddedTitle(fields.title);
    if (swallowedJournalLocator) {
      fields.title = recoverDecimalTerminalTokenFromRaw(context.raw, swallowedJournalLocator.title)
        ?? swallowedJournalLocator.title;
      fields.journal = swallowedJournalLocator.journal;
      if (!fields.volume && swallowedJournalLocator.volume) {
        fields.volume = swallowedJournalLocator.volume;
      }
      if (!fields.issue && swallowedJournalLocator.issue) {
        fields.issue = swallowedJournalLocator.issue;
      }
      if (!fields.pages && swallowedJournalLocator.pages) {
        fields.pages = swallowedJournalLocator.pages;
      }

      if (typeof fields.siteName === 'string' && /^(?:no|vol)$/iu.test(fields.siteName.trim())) {
        fields.siteName = null;
      }
      if (typeof fields.institution === 'string' && /^\d{1,4}$/u.test(fields.institution.trim())) {
        fields.institution = null;
      }
      if (
        typeof fields.conferenceTitle === 'string'
        && fields.conferenceTitle.trim().length <= 2
      ) {
        fields.conferenceTitle = null;
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  if (!fields.journal && typeof fields.title === 'string') {
    const recoveredArticleOverflow = recoverArticleLocatorAfterTitle(context.raw, fields.title);
    if (recoveredArticleOverflow) {
      if (recoveredArticleOverflow.titleSuffix) {
        fields.title = `${stripTrailingPunctuation(fields.title)}, ${recoveredArticleOverflow.titleSuffix}`;
      }
      fields.journal = recoveredArticleOverflow.journal;
      if (!fields.volume && recoveredArticleOverflow.volume) {
        fields.volume = recoveredArticleOverflow.volume;
      }
      if (!fields.issue && recoveredArticleOverflow.issue) {
        fields.issue = recoveredArticleOverflow.issue;
      }
      if (!fields.pages && recoveredArticleOverflow.pages) {
        fields.pages = recoveredArticleOverflow.pages;
      }
      fields.publisher = null;
      fields.institution = null;
      if (
        typeof fields.siteName === 'string'
        && recoveredArticleOverflow.titleSuffix
        && normalizeComparableText(fields.siteName) === normalizeComparableText(recoveredArticleOverflow.titleSuffix)
      ) {
        fields.siteName = null;
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  if (
    typeof fields.title === 'string'
    && (
      !fields.journal
      || !fields.volume
      || !fields.issue
    )
  ) {
    const escapedTitle = escapeRegex(stripTrailingPunctuation(fields.title));
    const articleWordLocatorFromRaw = strippedRaw.match(
      new RegExp(
        `${escapedTitle}\\.\\s+(?<journal>.+?),\\s*vol\\.?\\s*(?<volume>\\d+),\\s*no\\.?\\s*(?<issue>[^.]+)\\.?$`,
        'iu',
      ),
    );
    if (articleWordLocatorFromRaw?.groups) {
      const recoveredJournal = normalizeJournalCandidate(articleWordLocatorFromRaw.groups.journal, fields.title);
      if (!fields.journal && recoveredJournal) {
        fields.journal = recoveredJournal;
      }
      if (!fields.volume && articleWordLocatorFromRaw.groups.volume?.trim()) {
        fields.volume = articleWordLocatorFromRaw.groups.volume.trim();
      }
      if (!fields.issue && articleWordLocatorFromRaw.groups.issue?.trim()) {
        fields.issue = articleWordLocatorFromRaw.groups.issue.trim();
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  const currentWeakConferenceTitle = typeof fields.conferenceTitle === 'string'
    ? normalizeConferenceTitle(fields.conferenceTitle)
    : null;
  const hasGroundedArticleEvidence =
    typeof fields.journal === 'string'
    && normalizeJournalCandidate(fields.journal, typeof fields.title === 'string' ? fields.title : null) != null
    && citationContainsGroundedContainer(strippedRaw, String(fields.journal))
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
    );
  const weakConferenceLooksArticleProxy =
    currentWeakConferenceTitle != null
    && !looksConferencePublicationVenue(currentWeakConferenceTitle)
    && (
      looksJournalLikeContainer(currentWeakConferenceTitle)
      || looksPublisherLike(currentWeakConferenceTitle)
      || normalizeComparableText(currentWeakConferenceTitle) === normalizeComparableText(String(fields.journal ?? ''))
    );
  if (
    hasGroundedArticleEvidence
    && weakConferenceLooksArticleProxy
    && !rawHasConferenceCue
    && !looksProceedingsLikeDoi(doi ?? undefined)
    && !CONFERENCE_DOI_REGEX.test(doi ?? '')
  ) {
    if (
      !fields.publisher
      || normalizeComparableText(String(fields.publisher)) === normalizeComparableText(currentWeakConferenceTitle)
    ) {
      fields.publisher = null;
    }
    if (
      !fields.bookTitle
      || normalizeComparableText(String(fields.bookTitle)) === normalizeComparableText(currentWeakConferenceTitle)
    ) {
      fields.bookTitle = null;
    }
    if (
      !fields.institution
      || normalizeComparableText(String(fields.institution)) === normalizeComparableText(currentWeakConferenceTitle)
    ) {
      fields.institution = null;
    }
    fields.conferenceTitle = null;
    effectiveReferenceType = 'article-journal';
  }

  const harvardOwnerSiteRecovery = parseHarvardOwnerSiteWebpageReference(
    stripTrailingIdentifierTailForParsing(normalizeExtractionInput(context.raw)),
  );
  if (harvardOwnerSiteRecovery && likelyWebpageContext) {
    const recoveredSiteName = normalizeSiteNameCandidate(harvardOwnerSiteRecovery.siteName);
    const recoveredInstitution = normalizeInstitutionCandidate(
      harvardOwnerSiteRecovery.publisher,
      context.year ?? undefined,
    );

    if (
      recoveredSiteName
      && (
        !siteName
        || comparableSiteName === comparablePublisher
        || comparableSiteName === comparableInstitution
      )
    ) {
      fields.siteName = recoveredSiteName;
    }

    if (recoveredInstitution && !institution) {
      fields.institution = recoveredInstitution;
    }

    if (typeof fields.title === 'string') {
      const trimmedTitle = trimTrailingContainerLabelFromTitle(fields.title, recoveredSiteName ?? '');
      if (trimmedTitle) {
        fields.title = trimmedTitle;
      }
    }
  }

  if (
    typeof fields.title === 'string'
    && typeof fields.siteName === 'string'
    && fields.siteName.trim().length > 0
  ) {
    const trimmedTitle = trimTrailingContainerLabelFromTitle(fields.title, fields.siteName);
    if (trimmedTitle) {
      fields.title = trimmedTitle;
    }
  }

  if (
    typeof fields.title === 'string'
    && typeof fields.publisher === 'string'
    && likelyWebpageContext
  ) {
    const trimmedTitle = trimTrailingContainerLabelFromTitle(fields.title, fields.publisher);
    if (trimmedTitle) {
      fields.title = trimmedTitle;
    }
  }

  if (rawPublisher && typeof fields.title === 'string' && rawPublisher.includes('. ')) {
    const publisherClauses = rawPublisher.split(/\.\s+/u).map((clause) => clause.trim()).filter(Boolean);
    const trailingPublisherClause = publisherClauses.at(-1) ?? null;
    const leadingPublisherText = publisherClauses.slice(0, -1).join('. ').trim();
    if (
      trailingPublisherClause
      && leadingPublisherText
      && looksPublisherLike(trailingPublisherClause)
      && !looksPublisherLike(leadingPublisherText)
      && typeof fields.title === 'string'
      && fields.title.split(/\s+/u).filter(Boolean).length <= 4
    ) {
      const normalizedTitle = stripTrailingPunctuation(fields.title);
      fields.title = `${normalizedTitle}, ${stripTrailingPunctuation(leadingPublisherText)}`;
      fields.publisher = trailingPublisherClause;
    }
  }

  if (likelyWebpageContext && bookTitle && !looksConferenceContainer(bookTitle)) {
    const resolvedSiteName = normalizeSiteNameCandidate(bookTitle);
    const shouldRecoverSiteName =
      resolvedSiteName != null
      && (
        !siteName
        || comparableSiteName === comparableBookTitle
        || comparableSiteName === comparablePublisher
        || comparableSiteName === comparableInstitution
      );

    if (shouldRecoverSiteName && resolvedSiteName) {
      fields.siteName = resolvedSiteName;
    }

    if (resolvedSiteName && (shouldRecoverSiteName || comparableSiteName === comparableBookTitle)) {
      delete fields.bookTitle;
    }
  }

  const shouldPromotePublisherToConference =
    !hasThesisCueInRaw
    && !rawHasReportCue
    && !likelyWebpageContext
    && !fields.repository
    && !looksPreprintCue(context.raw)
    && !bookTitle
    && !fields.conferenceTitle
    && publisher
    && !hasPublisherCue
    && (
      looksConferencePublicationVenue(publisher)
      || looksProceedingsLikeDoi(doi ?? undefined)
      || /\bpaper presented at\b/iu.test(context.raw)
      || CONFERENCE_CUE_REGEX.test(context.raw)
    );

  if (shouldPromotePublisherToConference) {
    fields.conferenceTitle = normalizeConferenceTitle(publisher);
    if (
      normalizeComparableText(publisher) === normalizeComparableText(String(fields.conferenceTitle))
      && !looksPublisherLike(publisher)
      && !looksInstitutionalContainer(publisher)
    ) {
      fields.publisher = null;
    }
  }

  if (
    fields.conferenceTitle
    && !isConferencePlaceholder(String(fields.conferenceTitle))
    && !looksProceedingsLikeDoi(doi ?? undefined)
    && (
      !looksConferencePublicationVenue(String(fields.conferenceTitle))
      || looksSwallowedConferenceTitleCandidate(String(fields.conferenceTitle), title)
    )
  ) {
    const comparableConferenceTitle = normalizeComparableText(String(fields.conferenceTitle));
    if (
      (comparablePublisher && comparableConferenceTitle === comparablePublisher)
      || (comparableInstitution && comparableConferenceTitle === comparableInstitution)
    ) {
      fields.conferenceTitle = null;
    }
  }

  if (typeof fields.conferenceTitle === 'string') {
    const normalizedConferenceTitle = normalizeComparableText(fields.conferenceTitle);
    if (
      typeof fields.publisher === 'string'
      && normalizeComparableText(fields.publisher) === normalizedConferenceTitle
    ) {
      fields.publisher = null;
    }
    if (
      typeof fields.institution === 'string'
      && normalizeComparableText(fields.institution) === normalizedConferenceTitle
    ) {
      fields.institution = null;
    }
    if (
      isConferencePlaceholder(fields.conferenceTitle)
      && typeof fields.institution === 'string'
      && isConferencePlaceholder(fields.institution)
    ) {
      fields.institution = null;
    }
  }

  if (
    typeof fields.conferenceTitle === 'string'
    && !isConferencePlaceholder(fields.conferenceTitle)
    && (
      !looksConferencePublicationVenue(fields.conferenceTitle)
      || looksSwallowedConferenceTitleCandidate(fields.conferenceTitle, title)
    )
    && looksJournalLikeContainer(fields.conferenceTitle)
  ) {
    const rawHasConferenceCue =
      /\bpaper presented at\b/iu.test(context.raw)
      || CONFERENCE_CUE_REGEX.test(context.raw);
    const rawHasConferenceDoi =
      looksProceedingsLikeDoi(doi ?? undefined)
      || CONFERENCE_DOI_REGEX.test(context.raw);
    const preserveConferenceContainer = isConferenceFallbackContainerCandidate(
      fields.conferenceTitle,
      {
        rawHasConferenceCue,
        rawHasConferenceDoi,
      },
    );
    if (!preserveConferenceContainer) {
      const recoveredJournal = normalizeJournalCandidate(fields.conferenceTitle, title);
      if (recoveredJournal) {
        const recoveredTitle = title
          ? recoverTitleOverflowBeforeContainer(context.raw, title, recoveredJournal)
          : null;
        if (recoveredTitle) {
          fields.title = recoveredTitle;
        }
        fields.journal = recoveredJournal;
        fields.conferenceTitle = null;
        if (
          typeof fields.institution === 'string'
          && normalizeComparableText(fields.institution).startsWith(normalizeComparableText(recoveredJournal))
        ) {
          fields.institution = null;
        }
        effectiveReferenceType = 'article-journal';
      }
    }
  }

  if (
    !fields.journal
    && typeof fields.conferenceTitle === 'string'
    && !isConferencePlaceholder(fields.conferenceTitle)
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
    )
  ) {
    const rawHasConferenceCue =
      /\bpaper presented at\b/iu.test(context.raw)
      || CONFERENCE_CUE_REGEX.test(context.raw);
    const rawHasConferenceDoi =
      looksProceedingsLikeDoi(doi ?? undefined)
      || CONFERENCE_DOI_REGEX.test(context.raw);
    if (
      !rawHasConferenceCue
      && !rawHasConferenceDoi
      && !looksCompactConferenceVenueAlias(fields.conferenceTitle)
      && !looksInstitutionalContainer(fields.conferenceTitle)
      && !looksPublisherLike(fields.conferenceTitle)
    ) {
      const recoveredJournal =
        normalizeJournalCandidate(fields.conferenceTitle, title)
        ?? normalizeConferenceTitle(fields.conferenceTitle);
      if (recoveredJournal) {
        const recoveredTitle = title
          ? recoverTitleOverflowBeforeContainer(context.raw, title, recoveredJournal)
          : null;
        if (recoveredTitle) {
          fields.title = recoveredTitle;
        }
        fields.journal = recoveredJournal;
        fields.conferenceTitle = null;
        if (
          typeof fields.institution === 'string'
          && normalizeComparableText(fields.institution).startsWith(normalizeComparableText(recoveredJournal))
        ) {
          fields.institution = null;
        }
        effectiveReferenceType = 'article-journal';
      }
    }
  }

  if (
    typeof fields.publisher === 'string'
    && looksJournalLikeContainer(fields.publisher)
    && !looksPublisherLike(fields.publisher)
    && !rawHasReportCue
    && !/^\d+(?:st|nd|rd|th)\s+ed\.?\s+/iu.test(fields.publisher)
  ) {
    const recoveredJournal = normalizeJournalCandidate(fields.publisher, title);
    if (recoveredJournal) {
      fields.journal = recoveredJournal;
      fields.publisher = null;
      effectiveReferenceType = 'article-journal';
    }
  } else if (
    typeof fields.publisher === 'string'
    && !fields.journal
    && !fields.conferenceTitle
    && !fields.bookTitle
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && typeof fields.doi === 'string'
    && !looksBookChapterDoi(fields.doi)
    && !/10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(fields.doi)
    && !looksPublisherLike(fields.publisher)
    && !looksInstitutionalContainer(fields.publisher)
    && !rawHasReportCue
    && !hasThesisCueInRaw
    && !likelyWebpageContext
    && citationContainsGroundedContainer(strippedRaw, fields.publisher)
  ) {
    const recoveredJournal = normalizeJournalCandidate(fields.publisher, title)
      ?? normalizeConferenceTitle(fields.publisher);
    if (recoveredJournal) {
      fields.journal = recoveredJournal;
      fields.publisher = null;
      effectiveReferenceType = 'article-journal';
    }
  } else if (
    typeof fields.publisher === 'string'
    && !looksPublisherLike(fields.publisher)
    && /^\d+(?:st|nd|rd|th)\s+ed\.?\s+/iu.test(fields.publisher)
  ) {
    const editionLeadMatch = fields.publisher.match(/^(?<edition>\d+(?:st|nd|rd|th)\s+ed\.?)\s+(?<journal>.+)$/iu);
    const recoveredEdition = editionLeadMatch?.groups?.edition?.trim() ?? null;
    const recoveredJournalLocatorFromInstitution = typeof fields.institution === 'string'
      ? fields.institution.match(
        /^(?<journal>.+?),\s*(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?:,\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
      )
      : null;
    const recoveredJournalFromPublisher = editionLeadMatch?.groups?.journal
      ? (
        normalizeJournalCandidate(editionLeadMatch.groups.journal, title)
        ?? stripTrailingPunctuation(editionLeadMatch.groups.journal).trim()
      )
      : null;
    const recoveredJournalLocator = recoveredJournalLocatorFromInstitution?.groups?.journal
      ? {
        journal:
          normalizeJournalCandidate(recoveredJournalLocatorFromInstitution.groups.journal, title)
          ?? stripTrailingPunctuation(recoveredJournalLocatorFromInstitution.groups.journal).trim(),
        volume: recoveredJournalLocatorFromInstitution.groups.volume?.trim() ?? null,
        issue: recoveredJournalLocatorFromInstitution.groups.issue?.trim() ?? null,
        pages: recoveredJournalLocatorFromInstitution.groups.pages
          ? normalizePages(recoveredJournalLocatorFromInstitution.groups.pages)
          : null,
      }
      : typeof fields.institution === 'string'
        ? recoverJournalFromContainerLocator(fields.institution)
        : null;
    const recoveredJournal =
      recoveredJournalLocator?.journal
      ?? recoveredJournalFromPublisher;
    if (recoveredEdition && recoveredJournal) {
      if (
        typeof fields.title === 'string'
        && !normalizeComparableText(fields.title).endsWith(normalizeComparableText(recoveredEdition))
      ) {
        fields.title = `${stripTrailingPunctuation(fields.title)}, ${recoveredEdition}`;
      }
      fields.journal = recoveredJournal;
      if (!fields.volume && recoveredJournalLocator?.volume) {
        fields.volume = recoveredJournalLocator.volume;
      }
      if (!fields.issue && recoveredJournalLocator?.issue) {
        fields.issue = recoveredJournalLocator.issue;
      }
      if (!fields.pages && recoveredJournalLocator?.pages) {
        fields.pages = recoveredJournalLocator.pages;
      }
      fields.publisher = null;
      fields.institution = null;
      if (typeof fields.siteName === 'string' && normalizeComparableText(fields.siteName) === normalizeComparableText(recoveredEdition)) {
        fields.siteName = null;
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  if (
    typeof fields.publisher === 'string'
    && (
      looksLocatorHeavyContainerSpill(fields.publisher)
      || (
        typeof fields.journal === 'string'
        && citationContainsGroundedContainer(strippedRaw, fields.journal)
        && isJournalLocatorDerivative(fields.publisher, String(fields.journal))
      )
    )
  ) {
    fields.publisher = null;
  }

  if (
    typeof fields.publisher === 'string'
    && typeof fields.journal === 'string'
  ) {
    const editionJournalMatch = fields.publisher.match(
      /^(?<edition>\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?)\s+(?<journal>.+)$/iu,
    );
    if (
      editionJournalMatch?.groups?.edition
      && editionJournalMatch.groups.journal
      && normalizeComparableText(editionJournalMatch.groups.journal) === normalizeComparableText(fields.journal)
    ) {
      const normalizedEdition = stripTrailingPunctuation(editionJournalMatch.groups.edition);
      if (
        typeof fields.title === 'string'
        && normalizedEdition
        && !normalizeComparableText(fields.title).includes(normalizeComparableText(normalizedEdition))
      ) {
        fields.title = `${stripTrailingPunctuation(fields.title)}, ${normalizedEdition}`;
      }
      fields.publisher = null;
    }
  }

  if (
    typeof fields.conferenceTitle === 'string'
    && fields.conferenceTitle.trim().length <= 2
    && (
      typeof fields.journal === 'string'
      || typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
    )
  ) {
    fields.conferenceTitle = null;
  }

  if (
    typeof fields.publisher === 'string'
    && !fields.journal
    && (
      fields.volume
      || fields.issue
      || fields.pages
    )
  ) {
    const editionJournalMatch = fields.publisher.match(
      /^(?<edition>\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?)\s+(?<journal>.+)$/iu,
    );
    const recoveredJournal = editionJournalMatch?.groups?.journal
      ? (
        normalizeJournalCandidate(editionJournalMatch.groups.journal, title)
        ?? stripTrailingPunctuation(editionJournalMatch.groups.journal).trim()
      )
      : null;
    if (editionJournalMatch?.groups?.edition && recoveredJournal) {
      const normalizedEdition = stripTrailingPunctuation(editionJournalMatch.groups.edition);
      if (
        typeof fields.title === 'string'
        && normalizedEdition
        && !normalizeComparableText(fields.title).includes(normalizeComparableText(normalizedEdition))
      ) {
        fields.title = `${stripTrailingPunctuation(fields.title)}, ${normalizedEdition}`;
      }
      fields.journal = recoveredJournal;
      fields.publisher = null;
    }
  }

  if (
    typeof fields.journal === 'string'
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
    )
  ) {
    const trimmedJournalYear = fields.journal.replace(/\s+(?:19|20)\d{2}$/u, '').trim();
    if (trimmedJournalYear && trimmedJournalYear !== fields.journal) {
      fields.journal = trimmedJournalYear;
    }
  }

  if (
    typeof fields.bookTitle === 'string'
    && (
      looksLocatorHeavyContainerSpill(fields.bookTitle)
      || (
        typeof fields.journal === 'string'
        && citationContainsGroundedContainer(strippedRaw, fields.journal)
        && isJournalLocatorDerivative(fields.bookTitle, String(fields.journal))
      )
    )
  ) {
    fields.bookTitle = null;
  }

  if (!fields.journal && typeof fields.bookTitle === 'string') {
    if (!hasBookChapterContext) {
      const locatorMatch = String(fields.bookTitle).match(
        /^(?<journal>.+?),\s*(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?:,\s*p{1,2}\.?)?$/iu,
      );
      const recoveredJournalLocator = locatorMatch?.groups?.journal
        ? {
            journal:
              normalizeJournalCandidate(locatorMatch.groups.journal, title)
              ?? stripTrailingPunctuation(locatorMatch.groups.journal).trim(),
            volume: locatorMatch.groups.volume?.trim() ?? null,
            issue: locatorMatch.groups.issue?.trim() ?? null,
            pages: null,
          }
        : recoverJournalFromContainerLocator(fields.bookTitle);
      if (recoveredJournalLocator) {
        fields.journal = recoveredJournalLocator.journal;
        if (!fields.volume && recoveredJournalLocator.volume) {
          fields.volume = recoveredJournalLocator.volume;
        }
        if (!fields.issue && recoveredJournalLocator.issue) {
          fields.issue = recoveredJournalLocator.issue;
        }
        if (!fields.pages && recoveredJournalLocator.pages) {
          fields.pages = recoveredJournalLocator.pages;
        }
        fields.bookTitle = null;
        effectiveReferenceType = 'article-journal';
      }
    }
  }

  if (
    typeof fields.siteName === 'string'
    && fields.siteName.trim().length > 0
    && typeof fields.url === 'string'
    && isDoiUrl(fields.url)
    && !likelyWebpageContext
    && typeof fields.title === 'string'
    && !(typeof fields.journal === 'string' && fields.journal.trim().length > 0)
    && !(typeof fields.bookTitle === 'string' && fields.bookTitle.trim().length > 0)
    && !(typeof fields.conferenceTitle === 'string' && fields.conferenceTitle.trim().length > 0)
    && (
      (typeof fields.publisher === 'string' && fields.publisher.trim().length > 0)
      || (typeof fields.institution === 'string' && fields.institution.trim().length > 0)
    )
  ) {
    const recoveredTail = normalizeSiteNameCandidate(fields.siteName);
    if (recoveredTail) {
      const normalizedTail = normalizeComparableText(recoveredTail);
      const normalizedTitleValue = normalizeComparableText(fields.title);
      if (normalizedTail && !normalizedTitleValue.endsWith(normalizedTail)) {
        fields.title = `${stripTrailingPunctuation(fields.title)}, ${recoveredTail}`;
      }
    }
    fields.siteName = null;
  }

  const hasConferenceSignals =
    strongConferenceContainer
    || looksProceedingsLikeDoi(doi ?? undefined)
    || /\bpaper presented at\b/iu.test(context.raw)
    || CONFERENCE_CUE_REGEX.test(context.raw);
  const proceedingsDoi = looksProceedingsLikeDoi(doi ?? undefined);
  const implicitConferenceJournalFallback = rawJournalText != null
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && !looksBookChapterDoi(doi ?? undefined)
    && !looksLocatorHeavyContainerSpill(rawJournalText)
    && !looksPublisherLike(rawJournalText)
    && (
      shouldPreserveConferenceTemporalTail(rawJournalText)
      || CONFERENCE_KEYWORD_REGEX.test(rawJournalText)
      || isConferenceFallbackContainerCandidate(rawJournalText, {
        rawHasConferenceDoi: proceedingsDoi,
        rawHasConferenceCue: hasConferenceSignals,
      })
    );
  const implicitConferenceInstitutionFallback = typeof fields.institution === 'string'
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && !looksPublisherLike(fields.institution)
    && (
      shouldPreserveConferenceTemporalTail(fields.institution.replace(/^Paper presented at\s+/iu, '').trim())
      || CONFERENCE_KEYWORD_REGEX.test(fields.institution)
      || isConferenceFallbackContainerCandidate(
        fields.institution.replace(/^Paper presented at\s+/iu, '').trim(),
        {
          rawHasConferenceDoi: proceedingsDoi,
          rawHasConferenceCue: hasConferenceSignals,
        },
      )
    );

  if (
    (effectiveReferenceType === 'conference-paper' || hasConferenceSignals || implicitConferenceJournalFallback || implicitConferenceInstitutionFallback)
    && !fields.conferenceTitle
  ) {
    const bookTitleConferenceFallback = typeof fields.bookTitle === 'string'
      && looksConferencePublicationVenue(fields.bookTitle)
      && !looksBookChapterDoi(doi ?? undefined)
      && !looksLocatorHeavyContainerSpill(fields.bookTitle)
      ? normalizeConferenceTitle(fields.bookTitle)
      : null;
    const journalConferenceFallback = rawJournalText != null
      && (
        implicitConferenceJournalFallback
        || isConferenceFallbackContainerCandidate(rawJournalText, {
          rawHasConferenceDoi: proceedingsDoi,
          rawHasConferenceCue: hasConferenceSignals,
        })
      )
      && !looksBookChapterDoi(doi ?? undefined)
      && !looksLocatorHeavyContainerSpill(rawJournalText)
      ? normalizeConferenceTitle(rawJournalText)
      : null;
    const institutionConferenceFallback = typeof fields.institution === 'string'
      && (
        implicitConferenceInstitutionFallback
        || isConferenceFallbackContainerCandidate(
          fields.institution.replace(/^Paper presented at\s+/iu, '').trim(),
          {
            rawHasConferenceDoi: proceedingsDoi,
            rawHasConferenceCue: hasConferenceSignals,
          },
        )
      )
      ? normalizeConferenceTitle(
        fields.institution.replace(/^Paper presented at\s+/iu, '').trim(),
      )
      : null;
    const publisherConferenceFallback = typeof fields.publisher === 'string'
      && (
        looksConferenceContainer(fields.publisher)
        || (
          proceedingsDoi
          && looksConferenceVenueAlias(fields.publisher)
          && !looksInstitutionalContainer(String(fields.publisher))
        )
      )
      && !looksPublisherLike(String(fields.publisher))
      ? normalizeConferenceTitle(fields.publisher)
      : null;
    const recoveredConferenceTitle =
      bookTitleConferenceFallback
      ?? journalConferenceFallback
      ?? institutionConferenceFallback
      ?? publisherConferenceFallback;

    if (recoveredConferenceTitle) {
      fields.conferenceTitle = recoveredConferenceTitle;
      if (
        typeof fields.bookTitle === 'string'
        && normalizeComparableText(fields.bookTitle) === normalizeComparableText(recoveredConferenceTitle)
      ) {
        fields.bookTitle = null;
      }
    }
  }

  if (
    (effectiveReferenceType === 'conference-paper' || hasConferenceSignals || /\bpaper presented at\s+n\/?a\b/iu.test(context.raw))
    && !fields.conferenceTitle
    && /\[(?:poster|abstract|paper)\]/iu.test(String(fields.title ?? title ?? ''))
  ) {
    fields.conferenceTitle = 'N/A';
    if (typeof fields.institution === 'string' && isConferencePlaceholder(fields.institution)) {
      fields.institution = null;
    }
  }

  if (
    (effectiveReferenceType === 'conference-paper' || typeof fields.conferenceTitle === 'string')
    && !fields.publisher
    && rawJournalText != null
    && !looksLocatorHeavyContainerSpill(rawJournalText)
    && !looksConferenceVenueAlias(rawJournalText)
  ) {
    const recoveredPublisher =
      normalizePublisherCandidate(rawJournalText, title)
      ?? normalizeConferenceTitle(rawJournalText);
    if (recoveredPublisher) {
      fields.publisher = recoveredPublisher;
    }
  }

  if (
    (effectiveReferenceType === 'conference-paper' || typeof fields.conferenceTitle === 'string')
    && !fields.publisher
    && typeof fields.conferenceTitle === 'string'
  ) {
    const recoveredConferencePublisher = recoverConferencePublisherAfterContainer(
      context.raw,
      fields.conferenceTitle,
      title,
    );
    if (recoveredConferencePublisher) {
      fields.publisher = recoveredConferencePublisher;
    }
  }

  const doiLooksBookish = looksBookChapterDoi(doi ?? undefined)
    || (doi != null && /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi));

  if (
    !fields.publisher
    && rawJournalText != null
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && (hasIsbn || doiLooksBookish)
    && !looksConferenceVenueAlias(rawJournalText)
    && !looksLocatorHeavyContainerSpill(rawJournalText)
  ) {
    const recoveredPublisher =
      normalizePublisherCandidate(rawJournalText, title)
      ?? normalizeConferenceTitle(rawJournalText);
    if (recoveredPublisher) {
      fields.publisher = recoveredPublisher;
      fields.journal = null;
    }
  }

  if (
    !fields.conferenceTitle
    && !fields.volume
    && !fields.issue
    && !fields.pages
  ) {
    const lateConferenceTitleFromJournal = typeof fields.journal === 'string'
      && !looksPublisherLike(fields.journal)
      && (
        shouldPreserveConferenceTemporalTail(fields.journal)
      || CONFERENCE_KEYWORD_REGEX.test(fields.journal)
        || isConferenceFallbackContainerCandidate(fields.journal, {
          rawHasConferenceDoi: proceedingsDoi,
          rawHasConferenceCue: hasConferenceSignals,
        })
      )
      ? normalizeConferenceTitle(fields.journal)
      : null;
    const lateConferenceTitleFromInstitution = typeof fields.institution === 'string'
      && !looksPublisherLike(fields.institution)
      && (
        shouldPreserveConferenceTemporalTail(fields.institution.replace(/^Paper presented at\s+/iu, '').trim())
      || CONFERENCE_KEYWORD_REGEX.test(fields.institution)
        || isConferenceFallbackContainerCandidate(
          fields.institution.replace(/^Paper presented at\s+/iu, '').trim(),
          {
            rawHasConferenceDoi: proceedingsDoi,
            rawHasConferenceCue: hasConferenceSignals,
          },
        )
      )
      ? normalizeConferenceTitle(fields.institution.replace(/^Paper presented at\s+/iu, '').trim())
      : null;
    const lateConferenceTitle = lateConferenceTitleFromJournal ?? lateConferenceTitleFromInstitution;
    if (lateConferenceTitle) {
      fields.conferenceTitle = lateConferenceTitle;
      if (
        typeof fields.journal === 'string'
        && normalizeComparableText(fields.journal) === normalizeComparableText(lateConferenceTitle)
      ) {
        fields.journal = null;
      }
      if (
        typeof fields.institution === 'string'
        && normalizeComparableText(fields.institution.replace(/^Paper presented at\s+/iu, '').trim())
          === normalizeComparableText(lateConferenceTitle)
      ) {
        fields.institution = null;
      }
      effectiveReferenceType = 'conference-paper';
    }
  }

  if (
    typeof fields.title === 'string'
    && typeof fields.journal === 'string'
    && typeof fields.publisher === 'string'
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
    )
  ) {
    const repairedArticlePublisherSpill = repairArticlePublisherLocatorSpill(
      context.raw,
      fields.title,
      fields.journal,
      fields.publisher,
    );
    if (repairedArticlePublisherSpill) {
      if (repairedArticlePublisherSpill.title) {
        fields.title = repairedArticlePublisherSpill.title;
      }
      fields.publisher = null;
    }
  }

  effectiveReferenceType = resolveReferenceTypeForFieldGuards(fields, effectiveReferenceType);

  const shouldRecoverInlineBookContext =
    typeof fields.title === 'string'
    && (
      typeof fields.doi === 'string'
      || /\.\s+In\s+/u.test(fields.title)
      || /\.\s+In\s+/u.test(strippedRaw)
    )
    && (
      !fields.bookTitle
      || (
        typeof fields.bookTitle === 'string'
        && (
          looksPublisherLike(fields.bookTitle)
          || looksInstitutionalContainer(fields.bookTitle)
          || (comparablePublisher.length > 0 && normalizeComparableText(fields.bookTitle) === comparablePublisher)
        )
      )
    );

  if (shouldRecoverInlineBookContext) {
    const recoveredInlineBookContext = recoverAuthorDateInCollectionFromRaw(context.raw);
    if (recoveredInlineBookContext) {
      fields.title = recoveredInlineBookContext.title;
      fields.bookTitle = recoveredInlineBookContext.bookTitle;
      if (!fields.pages && recoveredInlineBookContext.pages) {
        fields.pages = recoveredInlineBookContext.pages;
      }
      if (
        recoveredInlineBookContext.publisher
        && (
          !fields.publisher
          || (
            typeof fields.publisher === 'string'
            && fields.publisher.trim().length + 2 < recoveredInlineBookContext.publisher.length
          )
        )
      ) {
        fields.publisher = recoveredInlineBookContext.publisher;
      }
      effectiveReferenceType = 'book-chapter';
    }
  }

  if (
    fields.conferenceTitle
    && !fields.publisher
    && shouldAllowPublisherForType(effectiveReferenceType)
  ) {
    const journalPublisherFallback = rawJournalText != null
      && !looksConferenceVenueAlias(rawJournalText)
      ? normalizePublisherCandidate(rawJournalText, title) ?? normalizeConferenceTitle(rawJournalText)
      : null;
    if (journalPublisherFallback) {
      fields.publisher = journalPublisherFallback;
    }
  }

  if (hasThesisCueInRaw) {
    const resolvedInstitution = institution ?? (publisher ? normalizeInstitutionCandidate(publisher, context.year ?? undefined) : null);
    if (resolvedInstitution) {
      fields.institution = resolvedInstitution;
      if (publisher && normalizeComparableText(publisher) === normalizeComparableText(resolvedInstitution)) {
        fields.publisher = null;
      }
    }
    if (!fields.thesisType) {
      fields.thesisType = extractThesisType(context.raw);
    }
    if (typeof fields.title === 'string') {
      fields.title = stripTrailingThesisLabel(fields.title);
    }
    if (fields.conferenceTitle) {
      fields.conferenceTitle = null;
    }
  }

  if (fields.conferenceTitle && looksBookChapterDoi(doi ?? undefined)) {
    const splitConferenceTail = splitBookChapterConferenceTail(String(fields.conferenceTitle), title);
    const recoveredBookTitle = splitConferenceTail.bookTitle;
    fields.bookTitle = recoveredBookTitle;
    const recoveredPublisher =
      splitConferenceTail.publisher
      ?? (publisher && looksPublisherLike(publisher) ? publisher : null)
      ?? recoverPublisherAfterContainer(context.raw, recoveredBookTitle, title);
    if (recoveredPublisher) {
      fields.publisher = recoveredPublisher;
    }
    fields.conferenceTitle = null;
    effectiveReferenceType = 'book-chapter';
  }

  if (
    !fields.bookTitle
    && typeof fields.journal === 'string'
    && looksBookChapterDoi(doi ?? undefined)
  ) {
    const splitJournalTail = splitBookChapterConferenceTail(String(fields.journal), title);
    if (splitJournalTail.bookTitle && normalizeComparableText(splitJournalTail.bookTitle) !== normalizeComparableText(String(fields.journal))) {
      fields.bookTitle = splitJournalTail.bookTitle;
      if (!fields.publisher && splitJournalTail.publisher) {
        fields.publisher = splitJournalTail.publisher;
      }
      fields.journal = null;
      if (
        typeof fields.volume === 'string'
        && typeof fields.year === 'number'
        && normalizeComparableText(fields.volume) === normalizeComparableText(String(fields.year))
      ) {
        fields.volume = null;
      }
      effectiveReferenceType = 'book-chapter';
    }
  }

  const rawHasConferenceFieldCue =
    CONFERENCE_CUE_REGEX.test(strippedRaw)
    || /\bpaper presented at\b/iu.test(strippedRaw)
    || looksProceedingsLikeDoi(doi ?? undefined);
  const rawConferenceField = typeof fields.conferenceTitle === 'string'
    ? normalizeConferenceTitle(fields.conferenceTitle)
    : null;
  const rawPublisherField = typeof fields.publisher === 'string'
    ? normalizeConferenceTitle(fields.publisher)
    : null;

  if (
    !fields.journal
    && typeof fields.conferenceTitle === 'string'
    && fields.conferenceTitle.trim().length > 0
    && /\breview\)/iu.test(strippedRaw)
    && !rawHasConferenceFieldCue
  ) {
    fields.journal = normalizeConferenceTitle(fields.conferenceTitle);
    fields.conferenceTitle = null;
    effectiveReferenceType = 'article-journal';
  }

  if (
    !fields.journal
    && rawConferenceField
    && !rawHasConferenceFieldCue
    && (
      looksJournalLikeContainer(rawConferenceField)
      || /\breview\)/iu.test(strippedRaw)
      || (
        looksCompactConferenceVenueAlias(rawConferenceField)
        && typeof fields.issue === 'string'
      )
    )
  ) {
    const repairedJournal =
      normalizeJournalCandidate(rawConferenceField, title)
      ?? (/\breview\)/iu.test(strippedRaw) ? rawConferenceField : null);
    if (repairedJournal) {
      fields.journal = repairedJournal;
      fields.conferenceTitle = null;
      effectiveReferenceType = 'article-journal';
    }
  }

  if (
    !fields.journal
    && rawPublisherField
    && !rawHasConferenceFieldCue
    && !looksConferenceContainer(rawPublisherField)
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
    )
  ) {
    const repairedJournal = normalizeJournalCandidate(rawPublisherField, title);
    const conferenceFieldLooksNumeric =
      typeof fields.conferenceTitle === 'string'
      && (
        /^\d+(?:[–-]\d+)?$/u.test(fields.conferenceTitle.trim())
        || (
          typeof fields.pages === 'string'
          && normalizeComparableText(fields.conferenceTitle)
            === normalizeComparableText(fields.pages)
        )
      );

    if (repairedJournal && (!looksPublisherLike(rawPublisherField) || typeof fields.issue === 'string')) {
      fields.journal = repairedJournal;
      fields.publisher = null;
      if (conferenceFieldLooksNumeric) {
        fields.conferenceTitle = null;
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  const hasChapterLocatorCue =
    /\bIn\s+/u.test(strippedRaw)
    || /\b(?:pp?\.|p\.)\s*[A-Za-z]?\d/u.test(strippedRaw);

  if (
    !fields.conferenceTitle
    && typeof fields.journal === 'string'
    && looksCompactConferenceVenueAlias(fields.journal)
    && !fields.issue
    && typeof fields.pages === 'string'
    && (
      CONFERENCE_CUE_REGEX.test(context.raw)
      || (
        typeof fields.volume === 'string'
        && typeof fields.year === 'number'
        && normalizeComparableText(fields.volume) === normalizeComparableText(String(fields.year))
      )
    )
  ) {
    fields.conferenceTitle = normalizeConferenceTitle(fields.journal);
    fields.journal = null;
    if (
      typeof fields.volume === 'string'
      && typeof fields.year === 'number'
      && normalizeComparableText(fields.volume) === normalizeComparableText(String(fields.year))
    ) {
      fields.volume = null;
    }
    effectiveReferenceType = 'conference-paper';
  }

  if (
    !fields.bookTitle
    && !fields.conferenceTitle
    && !fields.journal
    && typeof fields.title === 'string'
    && (
      effectiveReferenceType === 'book-chapter'
      || context.referenceType === 'book-chapter'
      || hasChapterLocatorCue
    )
  ) {
    const overflowContainer = splitTrailingContainerFromTitleOverflow(fields.title);
    if (overflowContainer) {
      fields.title = overflowContainer.title;
      fields.bookTitle = overflowContainer.container;
      effectiveReferenceType = 'book-chapter';
    }
  }

  if (
    typeof fields.bookTitle === 'string'
    && /^p{1,2}\.?\s*[A-Za-z]?\d/iu.test(fields.bookTitle)
  ) {
    fields.bookTitle = null;
  }

  if (
    !fields.bookTitle
    && !fields.conferenceTitle
    && !fields.journal
    && title
    && (
      effectiveReferenceType === 'book-chapter'
      || context.referenceType === 'book-chapter'
      || hasChapterLocatorCue
    )
  ) {
    const recoveredBookContext = recoverMissingBookTitleFromRaw(
      context.raw,
      title,
      publisher ?? rawPublisher,
    );
    if (recoveredBookContext) {
      fields.bookTitle = recoveredBookContext.bookTitle;
      if (
        recoveredBookContext.publisher
        && (
          !fields.publisher
          || (
            typeof fields.publisher === 'string'
            && (
              isPublisherTailFragment(fields.publisher)
              || looksLowQualityContainerCandidate(fields.publisher)
            )
          )
        )
      ) {
        fields.publisher = recoveredBookContext.publisher;
      }
      effectiveReferenceType = 'book-chapter';
    }
  }

  if (
    !fields.bookTitle
    && title
    && (
      hasChapterLocatorCue
      || typeof fields.journal === 'string'
      || typeof fields.conferenceTitle === 'string'
      || effectiveReferenceType === 'book-chapter'
      || context.referenceType === 'book-chapter'
    )
    && looksBookChapterDoi(doi ?? undefined)
  ) {
    const recoveredBookContext = recoverMissingBookTitleFromRaw(
      context.raw,
      title,
      publisher ?? rawPublisher,
    );
    if (recoveredBookContext) {
      fields.bookTitle = recoveredBookContext.bookTitle;
      if (
        recoveredBookContext.publisher
        && (
          !fields.publisher
          || (
            typeof fields.publisher === 'string'
            && (
              isPublisherTailFragment(fields.publisher)
              || looksLowQualityContainerCandidate(fields.publisher)
            )
          )
        )
      ) {
        fields.publisher = recoveredBookContext.publisher;
      }
      if (
        typeof fields.journal === 'string'
        && normalizeComparableText(fields.journal).includes(
          normalizeComparableText(recoveredBookContext.bookTitle),
        )
      ) {
        fields.journal = null;
      }
      if (
        typeof fields.conferenceTitle === 'string'
        && normalizeComparableText(fields.conferenceTitle).includes(
          normalizeComparableText(recoveredBookContext.bookTitle),
        )
      ) {
        fields.conferenceTitle = null;
      }
      if (
        typeof fields.volume === 'string'
        && typeof fields.year === 'number'
        && normalizeComparableText(fields.volume) === normalizeComparableText(String(fields.year))
      ) {
        fields.volume = null;
      }
      effectiveReferenceType = 'book-chapter';
    }
  }

  if (!fields.journal && typeof fields.bookTitle === 'string') {
    if (!hasBookChapterContext) {
      const locatorMatch = String(fields.bookTitle).match(
        /^(?<journal>.+?),\s*(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?:,\s*p{1,2}\.?)?$/iu,
      );
      if (locatorMatch?.groups?.journal) {
        fields.journal =
          normalizeJournalCandidate(locatorMatch.groups.journal, title)
          ?? stripTrailingPunctuation(locatorMatch.groups.journal).trim();
        if (!fields.volume && locatorMatch.groups.volume) {
          fields.volume = locatorMatch.groups.volume.trim();
        }
        if (!fields.issue && locatorMatch.groups.issue) {
          fields.issue = locatorMatch.groups.issue.trim();
        }
        fields.bookTitle = null;
        effectiveReferenceType = 'article-journal';
      }
    }
  }

  const sparsePreprintOwner =
    publisher && isKnownPreprintRepositoryOwner(publisher)
      ? publisher
      : (
        effectiveReferenceType === 'preprint'
        || context.referenceType === 'preprint'
      )
        ? resolveSparsePreprintRepositoryOwnerFromTail(context.raw)
        : null;

  const sparsePreprintOwnerRecovery =
    !fields.repository
    && sparsePreprintOwner
    && !fields.journal
    && !fields.conferenceTitle
    && !fields.bookTitle
    && !hasArticleLocatorsGlobal
    && !likelyWebpageContext
    && !hasIsbn
    && !rawHasReportCue
    && (
      effectiveReferenceType === 'preprint'
      || context.referenceType === 'preprint'
      || hasSparsePreprintRepositoryTail(context.raw, sparsePreprintOwner)
    );

  if (!fields.repository && (looksPreprintCue(context.raw) || sparsePreprintOwnerRecovery)) {
    const resolvedRepository = resolvePreprintRepository(
      context.raw,
      sparsePreprintOwner ?? publisher,
      title,
    );
    if (resolvedRepository) {
      fields.repository = resolvedRepository;
    }
  } else if (
    repository
    && /^(?:ssrn|arxiv|biorxiv|medrxiv|zenodo|figshare)$/iu.test(repository)
    && publisher
  ) {
    const resolvedRepository = resolvePreprintRepository(context.raw, publisher, title);
    if (resolvedRepository) {
      fields.repository = resolvedRepository;
    }
  }

  if (
    (
      likelyWebpageContext
      || (
        hasWebpageAccessCue(context.raw)
        && typeof fields.url === 'string'
        && !isDoiUrl(fields.url)
      )
    )
    && typeof fields.institution === 'string'
  ) {
    const recoveredOwnerSiteWebpage = recoverAuthorDateOwnerSiteWebpageFromRaw(
      context.raw,
      fields.institution,
    );
    if (recoveredOwnerSiteWebpage) {
      const currentSiteName = typeof fields.siteName === 'string'
        ? normalizeSiteNameCandidate(fields.siteName)
        : null;
      const shouldOverrideSiteName = shouldOverrideWeakWebpageSiteName(currentSiteName, [
        typeof fields.institution === 'string' ? fields.institution : null,
        typeof fields.publisher === 'string' ? fields.publisher : null,
        typeof fields.bookTitle === 'string' ? fields.bookTitle : null,
      ]);
      fields.title = recoveredOwnerSiteWebpage.title;
      fields.institution = recoveredOwnerSiteWebpage.institution;
      if (shouldOverrideSiteName) {
        fields.siteName = recoveredOwnerSiteWebpage.siteName;
      }
    }
  }

  if (
    bookTitle
    && institution
    && normalizedTitle
    && normalizeComparableText(bookTitle).length > 0
    && normalizedTitle.includes(normalizeComparableText(bookTitle))
  ) {
    fields.bookTitle = null;
  }

  if (typeof fields.bookTitle === 'string' && typeof fields.title === 'string') {
    const splitBookTail = splitBookChapterConferenceTail(fields.bookTitle, fields.title);
    if (
      splitBookTail.publisher
      && normalizeComparableText(splitBookTail.bookTitle) !== normalizeComparableText(fields.bookTitle)
    ) {
      fields.bookTitle = splitBookTail.bookTitle;
      if (!fields.publisher) {
        fields.publisher = splitBookTail.publisher;
      }
    }

    const repairedEchoOverflow = repairEchoedBookTitleOverflow(
      String(fields.title),
      String(fields.bookTitle),
    );
    if (repairedEchoOverflow) {
      fields.title = repairedEchoOverflow.title;
      fields.bookTitle = repairedEchoOverflow.bookTitle;
    } else {
      const quotedOverflowMatch = String(fields.bookTitle).match(
        /^(?<fragment>.+?)["”]\s*,?\s*(?<rest>.+)$/u,
      );
      const quotedTitleFromRaw = stripTrailingPunctuation(
        normalizeInlineQuoteCharacters(context.raw).match(/"(?<quoted>[^"]{2,220})"/u)?.groups?.quoted
          ?? findQuotedTitle(context.raw)?.title
          ?? '',
      );
      const quotedOverflowFragment = quotedOverflowMatch?.groups?.fragment
        ? stripTrailingPunctuation(quotedOverflowMatch.groups.fragment)
        : null;
      const quotedOverflowRest = quotedOverflowMatch?.groups?.rest;
      const repairedQuotedOverflow = (
        quotedTitleFromRaw
        && quotedOverflowFragment
        && quotedOverflowRest
        && normalizeComparableText(quotedTitleFromRaw).startsWith(
          normalizeComparableText(String(fields.title)),
        )
        && normalizeComparableText(quotedTitleFromRaw).includes(
          normalizeComparableText(quotedOverflowFragment),
        )
        && normalizeComparableText(quotedTitleFromRaw) !== normalizeComparableText(String(fields.title))
        && !looksLowQualityContainerCandidate(quotedOverflowRest)
      )
        ? {
          title: quotedTitleFromRaw,
          bookTitle: normalizeConferenceTitle(quotedOverflowRest),
        }
        : recoverQuotedBookTitleOverflowFromRaw(
          context.raw,
          String(fields.title),
          String(fields.bookTitle),
        );
      if (repairedQuotedOverflow) {
        fields.title = repairedQuotedOverflow.title;
        fields.bookTitle = repairedQuotedOverflow.bookTitle;
      } else {
        const repairedInCollectionOverflow = recoverInCollectionTitleOverflowFromRaw(
          context.raw,
          String(fields.title),
          String(fields.bookTitle),
        );
        if (repairedInCollectionOverflow) {
          fields.title = repairedInCollectionOverflow.title;
          fields.bookTitle = repairedInCollectionOverflow.bookTitle;
        }
      }

      const trimmedTitle = trimContainerOverflowFromTitle(
        String(fields.title),
        String(fields.bookTitle),
      );
      if (trimmedTitle) {
        fields.title = trimmedTitle;
      }
    }
  }

  const currentConferenceTitle = typeof fields.conferenceTitle === 'string'
    ? normalizeConferenceTitle(fields.conferenceTitle)
    : null;
  const hasConferenceDoiSignal =
    CONFERENCE_DOI_REGEX.test(doi ?? '')
    || looksProceedingsLikeDoi(doi ?? undefined)
    || recoverConferenceTitleFromDoiHint(doi ?? undefined, context.year ?? undefined) != null;
  const currentConferenceLooksStandaloneInstitutionalAlias =
    currentConferenceTitle != null
    && looksStandaloneInstitutionalAlias(currentConferenceTitle)
    && !hasConferenceDoiSignal
    && !looksProceedingsLikeDoi(doi ?? undefined)
    && !rawHasConferenceCue;

    if (
      currentConferenceTitle
      && !isConferencePlaceholder(currentConferenceTitle)
    && (
      currentConferenceLooksStandaloneInstitutionalAlias
      || (
        !looksConferencePublicationVenue(currentConferenceTitle)
        && (
          rawHasReportCue
          || looksInstitutionalContainer(currentConferenceTitle)
          || looksReportPublisherAcronym(currentConferenceTitle)
        )
      )
    )
  ) {
    const resolvedInstitution = normalizeInstitutionCandidate(currentConferenceTitle, context.year ?? undefined);
    if (resolvedInstitution) {
      fields.institution = resolvedInstitution;
    }
      fields.conferenceTitle = null;
      effectiveReferenceType = effectiveReferenceType === 'conference-paper' ? 'report' : effectiveReferenceType;
    }

    if (
      typeof fields.institution === 'string'
      && typeof fields.pages === 'string'
      && normalizeComparableText(fields.institution) === normalizeComparableText(fields.pages)
    ) {
      fields.institution = null;
    }

    const recoveredConferencePublisherAlias = inferPublisherFromDoiHint(doi ?? undefined)
      ?? recoverStrongNumericConferencePublisherTail(context.raw)?.publisher
      ?? recoverConferencePublisherAliasFromRaw(context.raw);
    const titleWithConferenceAlias = typeof fields.title === 'string' ? fields.title : null;
    if (titleWithConferenceAlias && recoveredConferencePublisherAlias) {
      const trimmedConferenceAliasTail = trimTrailingContainerLabelFromTitle(
        titleWithConferenceAlias,
        recoveredConferencePublisherAlias,
      );
      if (trimmedConferenceAliasTail) {
        fields.title = trimmedConferenceAliasTail;
      }
      const currentTitleAfterTrim = typeof fields.title === 'string' ? fields.title : null;
      const quotedConferenceAliasTail = currentTitleAfterTrim?.match(
        new RegExp(
          `^(?<title>.+?)(?:["“”'‘’]\\.?\\s*|[.,;:]\\s+)${escapeRegex(recoveredConferencePublisherAlias)}$`,
          'iu',
        ),
      );
      const recoveredConferenceTitle = normalizeTitleCandidate(
        quotedConferenceAliasTail?.groups?.title,
      );
      if (recoveredConferenceTitle) {
        fields.title = recoveredConferenceTitle;
      }
      const currentTitleAfterQuotedTrim = typeof fields.title === 'string' ? fields.title : null;
      const compactConferenceAliasTail = currentTitleAfterQuotedTrim?.match(
        /^(?<title>.+?)(?:["“”'‘’]\.?\s*|[.,;:]\s+)(?<alias>[A-Z][A-Z0-9&./-]{2,18})$/u,
      );
      if (
        compactConferenceAliasTail?.groups?.alias
        && (
          looksCompactConferenceVenueAlias(compactConferenceAliasTail.groups.alias)
          || looksConferencePublisherOrganization(compactConferenceAliasTail.groups.alias)
          || normalizeComparableText(compactConferenceAliasTail.groups.alias)
            === normalizeComparableText(recoveredConferencePublisherAlias)
        )
      ) {
        const recoveredCompactAliasTitle = normalizeTitleCandidate(
          compactConferenceAliasTail.groups.title,
        );
        if (recoveredCompactAliasTitle) {
          fields.title = recoveredCompactAliasTitle;
        }
      }

      const quotedCompactConferenceAliasTail = (typeof fields.title === 'string' ? fields.title : null)?.match(
        /^(?<title>.+?)(?:["“”'‘’]\.?\s*)(?<alias>[A-Z][A-Z0-9&./-]{2,18})$/u,
      );
      const repairedQuotedCompactConferenceAliasTitle = normalizeTitleCandidate(
        quotedCompactConferenceAliasTail?.groups?.title,
      );
      if (repairedQuotedCompactConferenceAliasTitle) {
        fields.title = repairedQuotedCompactConferenceAliasTitle;
      }
    }

    if (
      typeof fields.title === 'string'
      && context.raw
      && typeof fields.conferenceTitle === 'string'
      && (
        /["“”]/u.test(fields.title)
        || (
          typeof fields.publisher !== 'string'
          && /(?:^|[\s,:;-])(?:IEEE|ACM|SPIE|ASME|AIP|IET)$/iu.test(fields.title)
        )
      )
    ) {
      const quotedTitle = findQuotedTitle(context.raw)?.title;
      const normalizedQuotedTitle = normalizeTitleCandidate(quotedTitle ?? undefined);
      if (normalizedQuotedTitle) {
        fields.title = normalizedQuotedTitle;
      }
    }

    if (
      typeof fields.conferenceTitle === 'string'
      && hasConferenceDoiSignal
    && typeof fields.publisher === 'string'
  ) {
    const normalizedConferencePublisher = normalizeConferenceTitle(fields.publisher);
    if (
      normalizedConferencePublisher
      && !looksPublisherLike(normalizedConferencePublisher)
      && !looksConferencePublisherOrganization(normalizedConferencePublisher)
      && !looksCompactConferenceVenueAlias(normalizedConferencePublisher)
      && !looksConferenceContainer(normalizedConferencePublisher)
    ) {
      fields.publisher = null;
      if (
        typeof fields.institution === 'string'
        && (
          normalizeComparableText(fields.institution) === normalizeComparableText(normalizedConferencePublisher)
          || normalizeComparableText(fields.institution).endsWith(normalizeComparableText(normalizedConferencePublisher))
        )
      ) {
        fields.institution = null;
      }
    }
  }

  const currentPublisher = typeof fields.publisher === 'string'
    ? normalizePublisherCandidate(fields.publisher, title)
    : null;
  const currentPublisherLooksStandaloneInstitutionalAlias =
    currentPublisher != null
    && looksStandaloneInstitutionalAlias(currentPublisher)
    && !hasConferenceDoiSignal
    && !looksProceedingsLikeDoi(doi ?? undefined)
    && !rawHasConferenceCue;
  const publisherBackedReportDoi = looksReportLikeDoi(doi ?? undefined, {
    raw: context.raw,
    owner: currentPublisher ?? undefined,
  });

  if (
    currentPublisher
    && !likelyWebpageContext
    && !hasIsbn
    && !hasPublisherCue
    && !hasConferenceDoiSignal
    && (
      publisherBackedReportDoi
      ||
      looksInstitutionalContainer(currentPublisher)
      || currentPublisherLooksStandaloneInstitutionalAlias
      || /\b(?:report|standard|bulletin|guideline|recommendation|specification)\b/iu.test(context.raw)
    )
  ) {
    const repairedTail = splitTrailingInstitutionFromReportTail(
      typeof fields.title === 'string' ? fields.title : title,
      currentPublisher,
      context.year ?? undefined,
    );
    const recoveredAuthorDateTitle = (
      publisherBackedReportDoi
      || /\b(?:report|standard|bulletin|guideline|recommendation|specification)\b/iu.test(context.raw)
    )
      ? recoverAuthorDateReportTitleFromRaw(
          context.raw,
          repairedTail?.institution ?? currentPublisher,
        )
      : null;
    const resolvedInstitution = repairedTail?.institution
      ?? normalizeInstitutionCandidate(currentPublisher, context.year ?? undefined);
    if (resolvedInstitution) {
      if (repairedTail?.title || recoveredAuthorDateTitle) {
        fields.title = repairedTail?.title ?? recoveredAuthorDateTitle;
      }
      fields.institution = resolvedInstitution;
      if (!fields.conferenceTitle) {
        fields.publisher = null;
      }
    }
  }

  const currentJournalText = typeof fields.journal === 'string'
    ? normalizeJournalCandidate(fields.journal, title) ?? normalizeConferenceTitle(fields.journal)
    : null;
  const currentJournalLooksStandaloneInstitutionalAlias =
    currentJournalText != null
    && looksStandaloneInstitutionalAlias(currentJournalText)
    && !hasConferenceDoiSignal
    && !looksProceedingsLikeDoi(doi ?? undefined)
    && !rawHasConferenceCue;
  const journalSupportsReportCue =
    currentJournalText != null
    && !looksJournalLikeContainer(currentJournalText);
  const journalBackedReportDoi = looksReportLikeDoi(doi ?? undefined, {
    raw: context.raw,
    owner: currentJournalText ?? undefined,
  });

  if (
    currentJournalText
    && !likelyWebpageContext
    && !hasIsbn
    && !hasArticleLocatorsGlobal
    && !fields.conferenceTitle
    && !fields.bookTitle
    && !hasConferenceDoiSignal
    && (
      journalBackedReportDoi
      || currentJournalLooksStandaloneInstitutionalAlias
      || (rawHasReportCue && journalSupportsReportCue)
    )
  ) {
    const repairedTail = splitTrailingInstitutionFromReportTail(
      typeof fields.title === 'string' ? fields.title : title,
      currentJournalText,
      context.year ?? undefined,
    );
    const recoveredAuthorDateTitle = (
      journalBackedReportDoi
      || (rawHasReportCue && journalSupportsReportCue)
    )
      ? recoverAuthorDateReportTitleFromRaw(
          context.raw,
          repairedTail?.institution ?? currentJournalText,
        )
      : null;
    const resolvedInstitution = repairedTail?.institution
      ?? normalizeInstitutionCandidate(currentJournalText, context.year ?? undefined);
    if (resolvedInstitution) {
      if (repairedTail?.title || recoveredAuthorDateTitle) {
        fields.title = repairedTail?.title ?? recoveredAuthorDateTitle;
      }
      fields.institution = resolvedInstitution;
      fields.journal = null;
      effectiveReferenceType = 'report';
    }
  }

  if (
    publisher
    && institution
    && looksPublisherLike(publisher)
    && normalizeComparableText(publisher) === normalizeComparableText(institution)
  ) {
    fields.institution = null;
  }

  if (
    hasWebpageAccessCue(context.raw)
    && typeof fields.url === 'string'
    && !isDoiUrl(fields.url)
    && typeof fields.institution === 'string'
  ) {
    const recoveredOwnerSiteWebpage = recoverAuthorDateOwnerSiteWebpageFromRaw(
      context.raw,
      fields.institution,
    );
    if (recoveredOwnerSiteWebpage) {
      const currentSiteName = typeof fields.siteName === 'string'
        ? normalizeSiteNameCandidate(fields.siteName)
        : null;
      const shouldOverrideSiteName = shouldOverrideWeakWebpageSiteName(currentSiteName, [
        typeof fields.institution === 'string' ? fields.institution : null,
        typeof fields.publisher === 'string' ? fields.publisher : null,
        typeof fields.bookTitle === 'string' ? fields.bookTitle : null,
      ]);
      fields.title = recoveredOwnerSiteWebpage.title;
      fields.institution = recoveredOwnerSiteWebpage.institution;
      if (shouldOverrideSiteName) {
        fields.siteName = recoveredOwnerSiteWebpage.siteName;
      }
    }
  }

  if (
    (likelyWebpageContext || (hasWebpageAccessCue(context.raw) && typeof fields.url === 'string' && !isDoiUrl(fields.url)))
    && typeof fields.url === 'string'
    && !isDoiUrl(fields.url)
  ) {
    const recoveredUrlSiteName = extractSiteNameFromUrl(fields.url);
    const currentSiteName = typeof fields.siteName === 'string' ? normalizeSiteNameCandidate(fields.siteName) : null;
    const recoveredTitle =
      hasWebpageAccessCue(context.raw)
      || (typeof fields.title === 'string' && /https?:\/\//iu.test(fields.title))
        ? recoverWebpageTitleBeforeUrl(context.raw)
        : null;

    if (!currentSiteName && recoveredUrlSiteName) {
      fields.siteName = recoveredUrlSiteName;
    }

    if (recoveredTitle) {
      fields.title = recoveredTitle;
    }

    if (typeof fields.publisher === 'string' && looksUrlHostPathArtifact(fields.publisher)) {
      fields.publisher = null;
    }

    if (typeof fields.institution === 'string' && looksUrlHostPathArtifact(fields.institution)) {
      fields.institution = null;
    }

    if (
      typeof fields.conferenceTitle === 'string'
      && (
        looksUrlHostPathArtifact(fields.conferenceTitle)
        || hasWebpageAccessCue(fields.conferenceTitle)
      )
    ) {
      fields.conferenceTitle = null;
    }

    if (typeof fields.siteName === 'string' && hasWebpageAccessCue(fields.siteName)) {
      if (recoveredUrlSiteName) {
        fields.siteName = recoveredUrlSiteName;
      } else {
        fields.siteName = null;
      }
    }

    if (!fields.conferenceTitle && !fields.publisher && !fields.institution) {
      effectiveReferenceType = 'webpage';
    }
  }

  clearTitleEmbeddedYearRangePages(fields);

  if (
    !fields.journal
    && typeof fields.publisher === 'string'
    && /^\d+(?:st|nd|rd|th)\s+ed\.?\s+/iu.test(fields.publisher)
    && typeof fields.institution === 'string'
  ) {
    const editionLeadMatch = fields.publisher.match(/^(?<edition>\d+(?:st|nd|rd|th)\s+ed\.?)\s+(?<journal>.+)$/iu);
    const locatorMatch = fields.institution.match(
      /^(?<journal>.+?),\s*(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?:,\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
    );
    const recoveredEdition = editionLeadMatch?.groups?.edition?.trim() ?? null;
    const recoveredJournal =
      locatorMatch?.groups?.journal
        ? normalizeJournalCandidate(locatorMatch.groups.journal, title) ?? stripTrailingPunctuation(locatorMatch.groups.journal).trim()
        : (
          editionLeadMatch?.groups?.journal
            ? normalizeJournalCandidate(editionLeadMatch.groups.journal, title) ?? stripTrailingPunctuation(editionLeadMatch.groups.journal).trim()
            : null
        );
    if (recoveredEdition && recoveredJournal) {
      if (
        typeof fields.title === 'string'
        && !normalizeComparableText(fields.title).endsWith(normalizeComparableText(recoveredEdition))
      ) {
        fields.title = `${stripTrailingPunctuation(fields.title)}, ${recoveredEdition}`;
      }
      fields.journal = recoveredJournal;
      if (!fields.volume && locatorMatch?.groups?.volume?.trim()) {
        fields.volume = locatorMatch.groups.volume.trim();
      }
      if (!fields.issue && locatorMatch?.groups?.issue?.trim()) {
        fields.issue = locatorMatch.groups.issue.trim();
      }
      if (!fields.pages && locatorMatch?.groups?.pages) {
        fields.pages = normalizePages(locatorMatch.groups.pages);
      }
      fields.publisher = null;
      fields.institution = null;
      if (typeof fields.siteName === 'string' && normalizeComparableText(fields.siteName) === normalizeComparableText(recoveredEdition)) {
        fields.siteName = null;
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  if (typeof fields.title === 'string' && typeof fields.journal === 'string') {
    const recoveredTrailingLetter = recoverTrailingTitleLetterFragment(context.raw, fields.title, fields.journal);
    if (recoveredTrailingLetter) {
      fields.title = recoveredTrailingLetter;
    }
  }

  if (looksBookChapterDoi(doi ?? undefined) && title) {
    const spillContainerSource = typeof fields.journal === 'string'
      ? fields.journal
      : (
        typeof fields.conferenceTitle === 'string'
          ? fields.conferenceTitle
          : null
      );

    if (spillContainerSource && !fields.bookTitle) {
      const splitSpillContainer = splitBookChapterConferenceTail(spillContainerSource, title);
      if (
        splitSpillContainer.publisher
        && normalizeComparableText(splitSpillContainer.bookTitle)
          !== normalizeComparableText(spillContainerSource)
      ) {
        fields.bookTitle = splitSpillContainer.bookTitle;
        if (
          !fields.publisher
          || normalizeComparableText(splitSpillContainer.bookTitle).includes(
            normalizeComparableText(String(fields.publisher)),
          )
        ) {
          fields.publisher = splitSpillContainer.publisher;
        }
        if (typeof fields.journal === 'string') {
          fields.journal = null;
        }
        if (typeof fields.conferenceTitle === 'string') {
          fields.conferenceTitle = null;
        }
        if (
          typeof fields.volume === 'string'
          && typeof fields.year === 'number'
          && normalizeComparableText(fields.volume) === normalizeComparableText(String(fields.year))
        ) {
          fields.volume = null;
        }
        effectiveReferenceType = 'book-chapter';
      }
    }

    if (
      typeof fields.bookTitle === 'string'
      && (
        fields.bookTitle.split(/\s+/u).filter(Boolean).length < 3
        || looksPublisherLike(fields.bookTitle)
        || (
          (publisher ?? rawPublisher)
          && normalizeComparableText(fields.bookTitle)
            === normalizeComparableText(String(publisher ?? rawPublisher))
        )
      )
    ) {
      const shortQuotedOverflowMatch = fields.bookTitle.match(
        /^(?<fragment>.+?)["”]\s*,?\s*(?<rest>.+)$/u,
      );
      const repairedShortQuotedOverflow = (
        shortQuotedOverflowMatch?.groups?.fragment
        && shortQuotedOverflowMatch.groups.rest
      )
        ? (() => {
          const quotedTitle = stripTrailingPunctuation(
            normalizeInlineQuoteCharacters(context.raw).match(/"(?<quoted>[^"]{2,220})"/u)?.groups?.quoted
              ?? '',
          );
          const fragment = stripTrailingPunctuation(shortQuotedOverflowMatch.groups?.fragment ?? '');
          const rest = normalizeConferenceTitle(shortQuotedOverflowMatch.groups?.rest ?? '');
          if (
            quotedTitle
            && fragment
            && rest
            && !looksLowQualityContainerCandidate(rest)
            && normalizeComparableText(quotedTitle).startsWith(normalizeComparableText(title))
            && normalizeComparableText(quotedTitle).includes(normalizeComparableText(fragment))
            && normalizeComparableText(quotedTitle) !== normalizeComparableText(title)
          ) {
            return {
              title: quotedTitle,
              bookTitle: rest,
            };
          }
          return null;
        })()
        : null;
      if (repairedShortQuotedOverflow) {
        fields.title = repairedShortQuotedOverflow.title;
        fields.bookTitle = repairedShortQuotedOverflow.bookTitle;
        effectiveReferenceType = 'book-chapter';
      }

      const recoveredPublisherLikeBookContext = recoverBookContextFromPublisherLikeBookTitle(
        context.raw,
        title,
        typeof fields.bookTitle === 'string' ? fields.bookTitle : null,
        publisher ?? rawPublisher,
      );
      if (recoveredPublisherLikeBookContext) {
        fields.title = recoveredPublisherLikeBookContext.title;
        fields.bookTitle = recoveredPublisherLikeBookContext.bookTitle;
        if (recoveredPublisherLikeBookContext.publisher) {
          fields.publisher = recoveredPublisherLikeBookContext.publisher;
        }
        effectiveReferenceType = 'book-chapter';
      }

      const recoveredBookContext = recoveredPublisherLikeBookContext == null
        ? recoverMissingBookTitleFromRaw(
          context.raw,
          title,
          publisher ?? rawPublisher,
        )
        : null;
      if (
        recoveredBookContext
        && recoveredBookContext.bookTitle.split(/\s+/u).filter(Boolean).length >= 3
      ) {
        fields.bookTitle = recoveredBookContext.bookTitle;
        if (
          recoveredBookContext.publisher
          && (
            !fields.publisher
            || normalizeComparableText(recoveredBookContext.bookTitle).includes(
              normalizeComparableText(String(fields.publisher)),
            )
          )
        ) {
          fields.publisher = recoveredBookContext.publisher;
        }
        effectiveReferenceType = 'book-chapter';
      }
    }

    if (
      typeof fields.bookTitle === 'string'
      && fields.bookTitle.split(/\s+/u).filter(Boolean).length < 3
      && typeof fields.publisher === 'string'
    ) {
      const tail = extractTailAfterTitle(context.raw, title);
      const normalizedPublisher = normalizePublisherCandidate(fields.publisher, title);
      if (tail && normalizedPublisher) {
        const publisherIndex = tail.toLocaleLowerCase().lastIndexOf(normalizedPublisher.toLocaleLowerCase());
        const prePublisherTail = (
          publisherIndex > 0
            ? tail.slice(0, publisherIndex)
            : tail
        )
          .replace(/^In\s+/iu, '')
          .replace(/[;,]\s*p{1,2}\.?\s*[A-Za-z]?\d[\w\s–-]*$/iu, '')
          .replace(/[;,]\s*(?:19|20)\d{2}\s*$/u, '')
          .replace(/[.,;:\s]+$/u, '')
          .trim();
        const sentenceClauses = prePublisherTail
          .split(/\.\s+/u)
          .map((candidate) => normalizeConferenceTitle(candidate))
          .filter((candidate) =>
            candidate.split(/\s+/u).filter(Boolean).length >= 3
            && !looksLowQualityContainerCandidate(candidate)
            && !looksInstitutionalContainer(candidate)
            && !looksPublisherLike(candidate),
          );
        const recoveredTrailingContainer = sentenceClauses.at(-1) ?? null;
        if (recoveredTrailingContainer) {
          fields.bookTitle = recoveredTrailingContainer;
          effectiveReferenceType = 'book-chapter';
        }
      }
    }
  }

  if (
    !fields.journal
    && typeof fields.conferenceTitle === 'string'
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
    )
  ) {
    const rawHasConferenceCue =
      /\bpaper presented at\b/iu.test(context.raw)
      || CONFERENCE_CUE_REGEX.test(context.raw);
    const rawHasConferenceDoi =
      looksProceedingsLikeDoi(doi ?? undefined)
      || CONFERENCE_DOI_REGEX.test(context.raw);
    if (
      !rawHasConferenceCue
      && !rawHasConferenceDoi
      && !looksCompactConferenceVenueAlias(fields.conferenceTitle)
      && !looksInstitutionalContainer(fields.conferenceTitle)
      && !looksPublisherLike(fields.conferenceTitle)
    ) {
      const recoveredJournal =
        normalizeJournalCandidate(fields.conferenceTitle, typeof fields.title === 'string' ? fields.title : title)
        ?? normalizeConferenceTitle(fields.conferenceTitle);
      const recoveredTitle =
        typeof fields.title === 'string'
          ? recoverTitleOverflowBeforeContainer(context.raw, fields.title, recoveredJournal)
          : null;
      if (recoveredTitle) {
        fields.title = recoveredTitle;
      }
      fields.journal = recoveredJournal;
      fields.conferenceTitle = null;
      if (
        typeof fields.institution === 'string'
        && normalizeComparableText(fields.institution).startsWith(normalizeComparableText(recoveredJournal))
      ) {
        fields.institution = null;
      }
      effectiveReferenceType = 'article-journal';
    }
  }

  if (
    !fields.journal
    && typeof fields.publisher === 'string'
    && (
      typeof fields.isbn === 'string'
      || looksBookChapterDoi(doi ?? undefined)
      || (doi != null && /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi))
    )
    && typeof fields.volume === 'string'
    && isYearLikeLocatorValue(fields.volume)
    && !fields.issue
    && !fields.pages
  ) {
    if (
      typeof fields.year !== 'number'
      || normalizeComparableText(fields.volume) === normalizeComparableText(String(fields.year))
    ) {
      fields.volume = null;
      effectiveReferenceType = 'book';
    }
  }

  if (
    typeof fields.title === 'string'
    && typeof fields.journal === 'string'
    && typeof fields.publisher === 'string'
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
    )
    && !looksPublisherLike(fields.publisher)
    && !looksInstitutionalContainer(fields.publisher)
    && normalizeComparableText(fields.publisher).includes(normalizeComparableText(fields.journal))
  ) {
    const repairedArticlePublisherSpill = repairArticlePublisherLocatorSpill(
      context.raw,
      fields.title,
      fields.journal,
      fields.publisher,
    );
    if (repairedArticlePublisherSpill?.title) {
      fields.title = repairedArticlePublisherSpill.title;
    }
    fields.publisher = null;
  }

  if (typeof fields.title === 'string' && typeof fields.bookTitle === 'string') {
    const repairedLateBookTitleOverflow =
      repairEchoedBookTitleOverflow(String(fields.title), String(fields.bookTitle))
      ?? recoverQuotedBookTitleOverflowFromRaw(
        context.raw,
        String(fields.title),
        String(fields.bookTitle),
      )
      ?? recoverInCollectionTitleOverflowFromRaw(
        context.raw,
        String(fields.title),
        String(fields.bookTitle),
      );
    if (repairedLateBookTitleOverflow) {
      fields.title = repairedLateBookTitleOverflow.title;
      fields.bookTitle = repairedLateBookTitleOverflow.bookTitle;
      effectiveReferenceType = 'book-chapter';
    }

    const explicitEchoOverflowMatch = String(fields.bookTitle).match(
      /^(?<echo>.+?)\.\s+In\s+(?<container>.+)$/iu,
    );
    if (explicitEchoOverflowMatch?.groups?.container) {
      const repairedBookTitle = normalizeConferenceTitle(explicitEchoOverflowMatch.groups.container);
      const echoedTitleFragment = stripTrailingPunctuation(explicitEchoOverflowMatch.groups.echo ?? '');
      const baseTitle = stripTrailingPunctuation(String(fields.title));
      if (
        repairedBookTitle
        && !looksLowQualityContainerCandidate(repairedBookTitle)
      ) {
        fields.bookTitle = repairedBookTitle;
        if (echoedTitleFragment) {
          const comparableBaseTitle = normalizeComparableText(baseTitle);
          const comparableEchoedTitleFragment = normalizeComparableText(echoedTitleFragment);
          if (
            comparableEchoedTitleFragment.length > 0
            && !comparableBaseTitle.endsWith(comparableEchoedTitleFragment)
          ) {
            const repairedTitle = normalizeTitleCandidate(
              /\bin\b/iu.test(echoedTitleFragment)
                ? `${baseTitle}. ${echoedTitleFragment}`
                : `${baseTitle}. in ${echoedTitleFragment}`,
            );
            if (repairedTitle) {
              fields.title = repairedTitle;
            }
          }
        }
        effectiveReferenceType = 'book-chapter';
      }
    }
  }

  applyReferenceTypeFieldGuards(
    fields,
    resolveReferenceTypeForFieldGuards(fields, effectiveReferenceType),
    context.raw,
  );
  repairEditionJournalPublisherSpill(fields);
}

function applyReferenceTypeFieldGuards(
  fields: Partial<Record<ExtractedFieldKey, unknown>>,
  referenceType: ReferenceType | null,
  raw?: string,
): void {
  const doi = typeof fields.doi === 'string' ? fields.doi : null;
  const title = typeof fields.title === 'string' ? fields.title : null;
  const journal = typeof fields.journal === 'string'
    ? normalizeConferenceTitle(fields.journal)
    : null;
  const bookTitle = typeof fields.bookTitle === 'string'
    ? normalizeConferenceTitle(fields.bookTitle)
    : null;
  const conferenceTitle = typeof fields.conferenceTitle === 'string'
    ? normalizeConferenceTitle(fields.conferenceTitle)
    : null;
  const repository = typeof fields.repository === 'string'
    ? normalizeConferenceTitle(fields.repository)
    : null;
  const rawHasConferenceCue = Boolean(raw && (/\bpaper presented at\b/iu.test(raw) || CONFERENCE_CUE_REGEX.test(raw)));
  const rawHasConferenceDoi = Boolean(raw && CONFERENCE_DOI_REGEX.test(raw));
  const hasArticleLocators =
    (typeof fields.volume === 'string' && fields.volume.trim().length > 0)
    || (typeof fields.issue === 'string' && fields.issue.trim().length > 0)
    || (typeof fields.pages === 'string' && fields.pages.trim().length > 0);
  const hasBookChapterDoi = looksBookChapterDoi(doi ?? undefined);
  const hasProceedingsDoi = looksProceedingsLikeDoi(doi ?? undefined);
  const splitJournalBookChapter =
    hasBookChapterDoi && journal && title
      ? splitBookChapterConferenceTail(journal, title)
      : null;
  const splitJournalPublisherTail =
    journal && title
      ? splitBookChapterConferenceTail(journal, title)
      : null;
  const journalLooksMergedPublisherTail =
    journal != null
    && splitJournalPublisherTail?.publisher != null
    && normalizeComparableText(splitJournalPublisherTail.bookTitle) !== normalizeComparableText(journal)
    && !looksConferenceContainer(splitJournalPublisherTail.bookTitle)
    && !looksInstitutionalContainer(splitJournalPublisherTail.bookTitle);

  if (
    !journal
    && conferenceTitle
    && hasArticleLocators
    && !rawHasConferenceCue
    && !rawHasConferenceDoi
    && !looksCompactConferenceVenueAlias(conferenceTitle)
    && !looksInstitutionalContainer(conferenceTitle)
    && !looksPublisherLike(conferenceTitle)
  ) {
    const recoveredJournal =
      normalizeJournalCandidate(conferenceTitle, title)
      ?? normalizeConferenceTitle(conferenceTitle);
    const recoveredTitle = title && raw
      ? recoverTitleOverflowBeforeContainer(raw, title, recoveredJournal)
      : null;
    if (recoveredTitle) {
      fields.title = recoveredTitle;
    }
    fields.journal = recoveredJournal;
    fields.conferenceTitle = null;
    if (
      typeof fields.institution === 'string'
      && normalizeComparableText(fields.institution).startsWith(normalizeComparableText(recoveredJournal))
    ) {
      fields.institution = null;
    }
    referenceType = 'article-journal';
  }

  if (
    referenceType === 'webpage'
    && typeof fields.url === 'string'
    && !isDoiUrl(fields.url)
    && !hasArticleLocators
  ) {
    const normalizedSiteName = typeof fields.siteName === 'string'
      ? normalizeSiteNameCandidate(fields.siteName)
      : null;
    const normalizedInstitution = typeof fields.institution === 'string'
      ? normalizeInstitutionCandidate(fields.institution)
      : null;
    const normalizedJournal = typeof fields.journal === 'string'
      ? normalizeConferenceTitle(fields.journal)
      : null;

    if (
      normalizedJournal
      && (
        looksWebpageSiteOwnerBlend(normalizedJournal, normalizedSiteName, normalizedInstitution)
        || (
          normalizedSiteName != null
          && normalizedInstitution != null
          && normalizeComparableText(normalizedJournal).includes(normalizeComparableText(normalizedSiteName))
          && normalizeComparableText(normalizedJournal).includes(normalizeComparableText(normalizedInstitution))
        )
      )
    ) {
      fields.journal = null;
    }
  }

  if (
    hasBookChapterDoi
    && journal
    && splitJournalBookChapter?.publisher
    && normalizeComparableText(splitJournalBookChapter.bookTitle) !== normalizeComparableText(journal)
  ) {
    fields.bookTitle = splitJournalBookChapter.bookTitle;
    if (
      !fields.publisher
      || normalizeComparableText(splitJournalBookChapter.bookTitle).includes(
        normalizeComparableText(String(fields.publisher)),
      )
    ) {
      fields.publisher = splitJournalBookChapter.publisher;
    }
    fields.journal = null;
    if (
      typeof fields.volume === 'string'
      && typeof fields.year === 'number'
      && normalizeComparableText(fields.volume) === normalizeComparableText(String(fields.year))
    ) {
      fields.volume = null;
    }
    referenceType = 'book-chapter';
  }

  if (
    raw
    && title
    && typeof fields.bookTitle === 'string'
    && fields.bookTitle.split(/\s+/u).filter(Boolean).length < 3
    && typeof fields.publisher === 'string'
  ) {
    const tail = extractTailAfterTitle(raw, title);
    const normalizedPublisher = normalizePublisherCandidate(fields.publisher, title);
    if (tail && normalizedPublisher) {
      const publisherIndex = tail.toLocaleLowerCase().lastIndexOf(normalizedPublisher.toLocaleLowerCase());
      const prePublisherTail = (
        publisherIndex > 0
          ? tail.slice(0, publisherIndex)
          : tail
      )
        .replace(/^In\s+/iu, '')
        .replace(/[;,]\s*p{1,2}\.?\s*[A-Za-z]?\d[\w\s–-]*$/iu, '')
        .replace(/[;,]\s*(?:19|20)\d{2}\s*$/u, '')
        .replace(/[.,;:\s]+$/u, '')
        .trim();
      const sentenceClauses = prePublisherTail
        .split(/\.\s+/u)
        .map((candidate) => normalizeConferenceTitle(candidate))
        .filter((candidate) =>
          candidate.split(/\s+/u).filter(Boolean).length >= 3
          && !looksLowQualityContainerCandidate(candidate)
          && !looksInstitutionalContainer(candidate)
          && !looksPublisherLike(candidate),
        );
      const recoveredTrailingContainer = sentenceClauses.at(-1) ?? null;
      if (recoveredTrailingContainer) {
        fields.bookTitle = recoveredTrailingContainer;
        referenceType = 'book-chapter';
      }
    }
  }

  if (
    raw
    && hasProceedingsDoi
    && !fields.conferenceTitle
    && typeof fields.bookTitle === 'string'
    && typeof fields.title === 'string'
    && (
      looksLikeAuthorSpill(fields.title)
      || /\bet al\.?$/iu.test(fields.title)
      || /^[A-Z][\p{L}'-]+(?:\s+[A-Z]\.)?,\s*et al\.?$/u.test(fields.title)
    )
  ) {
    const recoveredConferenceTail = extractTailAfterTitle(raw, fields.bookTitle);
    const recoveredConferenceTitle = recoveredConferenceTail
      ? normalizeConferenceTitle(
        recoveredConferenceTail
          .replace(/^[,.;:\s]+/u, '')
          .replace(/[;,]\s*(?:19|20)\d{2}\b.*$/iu, '')
          .trim(),
      )
      : null;
    if (recoveredConferenceTitle && !looksLowQualityContainerCandidate(recoveredConferenceTitle)) {
      fields.title = fields.bookTitle;
      fields.bookTitle = null;
      fields.conferenceTitle = recoveredConferenceTitle;
      referenceType = 'conference-paper';
    }
  }

  if (
    journalLooksMergedPublisherTail
    && splitJournalPublisherTail
    && (
      referenceType === 'book-chapter'
      || referenceType === 'book'
      || hasBookChapterDoi
      || (typeof fields.isbn === 'string' && fields.isbn.trim().length > 0)
      || !fields.volume
    )
  ) {
    const normalizedSplitBookTitle = normalizeConferenceTitle(splitJournalPublisherTail.bookTitle);
    const normalizedSplitPublisher = splitJournalPublisherTail.publisher;
    if (
      normalizedSplitBookTitle
      && !looksLowQualityContainerCandidate(normalizedSplitBookTitle)
      && !looksPublisherLike(normalizedSplitBookTitle)
    ) {
      if (
        !fields.bookTitle
        || looksLowQualityContainerCandidate(String(fields.bookTitle))
        || /^p{1,2}\.?$/iu.test(String(fields.bookTitle))
        || /^pp?\.\s*[A-Za-z]?\d/iu.test(String(fields.bookTitle))
      ) {
        fields.bookTitle = normalizedSplitBookTitle;
      }
      if (
        normalizedSplitPublisher
        && (
          !fields.publisher
          || looksLowQualityContainerCandidate(String(fields.publisher))
          || normalizeComparableText(String(fields.publisher)).includes(normalizeComparableText(normalizedSplitBookTitle))
        )
      ) {
        fields.publisher = normalizedSplitPublisher;
      }

      if (
        title
        && (
          title.split(/\s+/u).filter(Boolean).length <= 3
          || /\b(?:in|of|for|on|to|and|with|without|under|within|toward|towards|against|between|among)$/iu.test(title)
        )
      ) {
        const recoveredTitle = recoverTitleContinuationFromRaw(raw ?? '', title, normalizedSplitBookTitle);
        if (recoveredTitle) {
          fields.title = recoveredTitle;
        } else if (/\b(?:in|of|for|on|to|and|with|without|under|within|toward|towards|against|between|among)$/iu.test(title)) {
          fields.title = `${stripTrailingPunctuation(title)} ${normalizedSplitBookTitle}`.trim();
        }
      }

      fields.journal = null;
      referenceType = hasBookChapterDoi || typeof fields.pages === 'string' ? 'book-chapter' : 'book';
    }
  }

  if (
    title
    && (
      referenceType === 'book-chapter'
      || hasBookChapterDoi
      || (
        typeof fields.bookTitle === 'string'
        && /^p{1,2}\.?\s*[A-Za-z]?\d/iu.test(fields.bookTitle)
      )
      || (
        typeof fields.pages === 'string'
        && /\bpp?\.?$/iu.test(title)
      )
    )
  ) {
    const swallowedBookContext = recoverBookContextFromSwallowedTitleTail(title);
    if (swallowedBookContext) {
      fields.title = swallowedBookContext.title;
      if (
        !fields.bookTitle
        || looksLowQualityContainerCandidate(String(fields.bookTitle))
        || /^p{1,2}\.?\s*[A-Za-z]?\d/iu.test(String(fields.bookTitle))
      ) {
        fields.bookTitle = swallowedBookContext.bookTitle;
      }
      if (
        swallowedBookContext.publisher
        && (
          !fields.publisher
          || (
            typeof fields.publisher === 'string'
            && (
              isPublisherTailFragment(fields.publisher)
              || looksLowQualityContainerCandidate(fields.publisher)
            )
          )
        )
      ) {
        fields.publisher = swallowedBookContext.publisher;
      }
      referenceType = 'book-chapter';
    }
  }

  if (
    typeof fields.bookTitle === 'string'
    && /\(\s*pp?\.\s*[^)]*\)\s*$/iu.test(fields.bookTitle)
  ) {
    const cleanedBookTitle = normalizeConferenceTitle(
      fields.bookTitle.replace(/\s*\(\s*pp?\.\s*[^)]*\)\s*$/iu, ''),
    );
    if (cleanedBookTitle && !looksLowQualityContainerCandidate(cleanedBookTitle)) {
      fields.bookTitle = cleanedBookTitle;
      referenceType = 'book-chapter';
    }
  }

  if (
    typeof fields.bookTitle === 'string'
    && /^p{1,2}\.?\s*[A-Za-z]?\d/iu.test(fields.bookTitle)
    && title
    && (
      referenceType === 'book-chapter'
      || hasBookChapterDoi
    )
    && raw
  ) {
    fields.bookTitle = null;
    const recoveredBookContext = recoverMissingBookTitleFromRaw(
      raw,
      title,
      typeof fields.publisher === 'string' ? fields.publisher : null,
    );
    if (recoveredBookContext) {
      fields.bookTitle = recoveredBookContext.bookTitle;
      if (
        recoveredBookContext.publisher
        && (
          !fields.publisher
          || (
            typeof fields.publisher === 'string'
            && (
              isPublisherTailFragment(fields.publisher)
              || looksLowQualityContainerCandidate(fields.publisher)
            )
          )
        )
      ) {
        fields.publisher = recoveredBookContext.publisher;
      }
      referenceType = 'book-chapter';
    }
  }

  const hasBookishSignals =
    journal != null
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && (
      (typeof fields.isbn === 'string' && fields.isbn.trim().length > 0)
      || (doi != null && /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi))
    )
    && !looksConferenceVenueAlias(journal);
  const compactConferenceAliasCandidate =
    !conferenceTitle
      ? (
        (bookTitle != null && looksCompactConferenceVenueAlias(bookTitle) ? bookTitle : null)
        ?? (journal != null && looksCompactConferenceVenueAlias(journal) ? journal : null)
        ?? (typeof fields.publisher === 'string' && looksCompactConferenceVenueAlias(fields.publisher)
          ? normalizeConferenceTitle(fields.publisher)
          : null)
        ?? (typeof fields.institution === 'string' && looksCompactConferenceVenueAlias(fields.institution)
          ? normalizeConferenceTitle(fields.institution)
          : null)
        )
      : null;
  const hasStrongArticleContainerEvidence =
    (typeof fields.issn === 'string' && fields.issn.trim().length > 0)
    || (
      typeof fields.journal === 'string'
      && (
        looksJournalLikeContainer(fields.journal)
        || Boolean(lookupIssnByJournalTitle(fields.journal))
      )
    );
  const recoveredConferenceContainer =
    raw && title
      ? recoverConferenceContainerAfterTitle(raw, title)
      : null;
  const canPromoteRecoveredConferenceContainer =
    recoveredConferenceContainer
    && !looksPublisherLike(recoveredConferenceContainer)
    && !looksInstitutionalContainer(recoveredConferenceContainer)
    && !looksLowQualityContainerCandidate(recoveredConferenceContainer)
    && !fields.volume
    && !fields.issue
    && !fields.bookTitle
    && !hasBookChapterDoi
    && !hasProceedingsDoi
    && !(typeof fields.isbn === 'string' && fields.isbn.trim().length > 0)
    && (
      referenceType === 'conference-paper'
      || referenceType === 'book'
    );

  if (!fields.conferenceTitle && canPromoteRecoveredConferenceContainer) {
    fields.conferenceTitle = recoveredConferenceContainer;
    referenceType = 'conference-paper';
  }

  if (
    raw
    &&
    !fields.conferenceTitle
    && typeof fields.title === 'string'
  ) {
    const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
    const directTemporalConference =
      recoverStrongTemporalConferenceFromRaw(parseableRaw)
      ?? parseAuthorDateTemporalConferenceReference(parseableRaw)
      ?? parseMlaTemporalConferenceReference(parseableRaw);
    const firstTitleClause = splitSentenceClauses(fields.title)
      .map((clause) => normalizeTitleCandidate(clause))
      .find((clause): clause is string => typeof clause === 'string' && clause.length > 0)
      ?? null;
    const recoveredTemporalConference =
      (typeof directTemporalConference?.conferenceTitle === 'string' && typeof directTemporalConference.title === 'string'
        ? {
          title: normalizeTitleCasePreservingAcronyms(directTemporalConference.title),
          conferenceTitle: directTemporalConference.conferenceTitle,
        }
        : null)
      ?? splitTemporalConferenceTailFromTitle(fields.title)
      ?? (
        firstTitleClause
          ? (() => {
            const rawRecoveredConference = recoverConferenceContainerAfterTitle(raw, firstTitleClause);
            if (
              rawRecoveredConference
              && shouldPreserveConferenceTemporalTail(rawRecoveredConference)
              && !looksInstitutionalContainer(rawRecoveredConference)
            ) {
              return {
                title: firstTitleClause,
                conferenceTitle: rawRecoveredConference,
              };
            }
            return null;
          })()
          : null
      )
      ?? (
        !fields.issue
        && !fields.pages
          ? (() => {
            const recoveredFromJournalVolume = recoverTemporalConferenceFromJournalVolume(
              typeof fields.journal === 'string' ? fields.journal : null,
              typeof fields.volume === 'string' ? fields.volume : null,
            );
            if (recoveredFromJournalVolume && firstTitleClause) {
              return {
                title: firstTitleClause,
                conferenceTitle: recoveredFromJournalVolume,
              };
            }
            return null;
          })()
          : null
      );
    if (recoveredTemporalConference) {
      fields.title = recoveredTemporalConference.title;
      fields.conferenceTitle = recoveredTemporalConference.conferenceTitle;
      fields.journal = null;
      fields.volume = null;
      fields.issue = null;
      if (typeof fields.institution === 'string' && fields.institution.trim().length <= 3) {
        fields.institution = null;
      }
      referenceType = 'conference-paper';
    }
  }

  const recoveredTemporalFromJournalVolume =
    !fields.issue && !fields.pages
      ? recoverTemporalConferenceFromJournalVolume(
        typeof fields.journal === 'string' ? fields.journal : null,
        typeof fields.volume === 'string' ? fields.volume : null,
      )
      : null;
  if (recoveredTemporalFromJournalVolume) {
    const firstTitleClause = typeof fields.title === 'string'
      ? (
        splitSentenceClauses(fields.title)
          .map((clause) => normalizeTitleCandidate(clause))
          .find((clause): clause is string => typeof clause === 'string' && clause.length > 0)
        ?? null
      )
      : null;
    if (!fields.conferenceTitle) {
      fields.conferenceTitle = recoveredTemporalFromJournalVolume;
    }
    if (firstTitleClause) {
      fields.title = normalizeTitleCasePreservingAcronyms(firstTitleClause);
    }
    if (
      typeof fields.publisher === 'string'
      && (
        normalizeComparableText(fields.publisher).includes(normalizeComparableText(recoveredTemporalFromJournalVolume))
        || /^(?:19|20)\d{2},\s*/u.test(fields.publisher)
        || shouldPreserveConferenceTemporalTail(
          normalizeConferenceTitle(fields.publisher.replace(/^(?:19|20)\d{2},\s*/u, '')),
        )
      )
    ) {
      fields.publisher = null;
    }
    fields.journal = null;
    fields.volume = null;
    if (typeof fields.institution === 'string' && fields.institution.trim().length <= 3) {
      fields.institution = null;
    }
    referenceType = 'conference-paper';
  }

  const hasBookishDoiIdentifier =
    typeof fields.doi === 'string'
    && (
      inferIsbnFromIdentifier(fields.doi) != null
      || looksBookChapterDoi(fields.doi)
    );
  const currentAuthors = Array.isArray(fields.authors)
    ? fields.authors
      .map((author) => toCanonicalAuthor(author))
      .filter((author): author is NonNullable<typeof author> => author != null)
    : [];
  const hasCorporateAuthorPublisherBookSignal =
    typeof fields.institution === 'string'
    && typeof fields.publisher === 'string'
    && normalizeComparableText(fields.institution) === normalizeComparableText(fields.publisher)
    && currentAuthors.some((author) => author.isCorporate);

  if (
    raw
    && !hasBookishDoiIdentifier
    && !hasCorporateAuthorPublisherBookSignal
  ) {
    const recoveredCorporateReport =
      (typeof fields.institution === 'string'
        ? (
          recoverAuthorDateCorporateReportFromRaw(raw, fields.institution)
          ?? recoverNumericCorporateReportFromRaw(raw, fields.institution)
          ?? recoverOwnerYearCorporateReportFromRaw(raw, fields.institution)
        )
        : null)
      ?? (
        hasReportCue(raw)
          ? parseAuthorDateCorporateReportReference(
            stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw)),
          )
          : null
      );
    if (recoveredCorporateReport?.title && recoveredCorporateReport.institution) {
      const recoveredInstitution = recoveredCorporateReport.institution;
      fields.title = recoveredCorporateReport.title;
      fields.institution = recoveredInstitution;
      fields.publisher = null;
      fields.journal = null;
      fields.conferenceTitle = null;
      fields.authors = [];
      referenceType = 'report';
    }
  }

  const lowQualityConferenceTitleValue = typeof fields.title === 'string'
    ? normalizeConferenceTitle(fields.title)
    : null;
  if (
    raw
    && (
      referenceType === 'conference-paper'
      || CONFERENCE_DOI_REGEX.test(raw)
      || looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
    )
    && typeof fields.title === 'string'
    && (
      fields.title.trim().split(/\s+/u).filter(Boolean).length <= 2
      || looksCompactConferenceVenueAlias(lowQualityConferenceTitleValue ?? '')
      || looksPublisherLike(lowQualityConferenceTitleValue ?? '')
      || (
        typeof fields.publisher === 'string'
        && normalizeComparableText(fields.title) === normalizeComparableText(fields.publisher)
      )
    )
  ) {
    const recoveredNumericConference = recoverStrongNumericConferencePublisherTail(raw);
    if (recoveredNumericConference && typeof recoveredNumericConference.authorSegment === 'string') {
      const recoveredAuthors = parseAuthorSegment(recoveredNumericConference.authorSegment);
      if (recoveredAuthors.length >= 2) {
        fields.authors = recoveredAuthors;
        fields.title = recoveredNumericConference.title;
        fields.publisher = recoveredNumericConference.publisher ?? null;
        fields.conferenceTitle = null;
        fields.pages = recoveredNumericConference.pages ?? null;
        if (recoveredNumericConference.year) {
          fields.year = recoveredNumericConference.year;
        }
        referenceType = 'conference-paper';
      }
    }
  }

  if (raw) {
    const authorCount = Array.isArray(fields.authors) ? fields.authors.length : 0;
    const parseableConferenceRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
    if (
      authorCount < 2
      && (
        referenceType === 'conference-paper'
        || CONFERENCE_DOI_REGEX.test(raw)
        || looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
      )
    ) {
      const conferenceAuthorMatch =
        parseableConferenceRaw.match(VANCOUVER_CONFERENCE_PUBLISHER_ETAL_REGEX)
        ?? parseableConferenceRaw.match(VANCOUVER_CONFERENCE_PUBLISHER_REGEX)
        ?? parseableConferenceRaw.match(VANCOUVER_CONFERENCE_INSTITUTIONAL_ETAL_REGEX);
      const recoveredAuthorSegment = conferenceAuthorMatch?.groups?.authors?.trim() ?? null;
      if (recoveredAuthorSegment) {
        const recoveredAuthors = parseAuthorSegment(recoveredAuthorSegment);
        if (recoveredAuthors.length >= 1) {
          fields.authors = recoveredAuthors;
        }
      }
    }

    const doiConferenceTitleHint = recoverConferenceTitleFromDoiHint(
      typeof fields.doi === 'string' ? fields.doi : undefined,
      typeof fields.year === 'number' ? fields.year : undefined,
    );
    const currentConferenceTitleText = typeof fields.conferenceTitle === 'string'
      ? normalizeConferenceTitle(fields.conferenceTitle)
      : null;
    const currentConferenceTitlePublisherSlot = typeof fields.conferenceTitle === 'string'
      ? normalizeConferencePublisherSlotCandidate(
        fields.conferenceTitle,
        typeof fields.title === 'string' ? fields.title : undefined,
        doiConferenceTitleHint ?? null,
      )
      : null;
    const fallbackConferenceTitlePublisherSlot =
      !currentConferenceTitlePublisherSlot
      && doiConferenceTitleHint
      && currentConferenceTitleText
      && normalizeComparableText(currentConferenceTitleText) !== normalizeComparableText(doiConferenceTitleHint)
      && !hasExplicitConferenceTitleCue(currentConferenceTitleText)
      && !looksConferencePublicationVenue(currentConferenceTitleText)
      && !looksConferenceContainer(currentConferenceTitleText)
      && !looksLowQualityContainerCandidate(currentConferenceTitleText)
        ? currentConferenceTitleText
        : null;
    const preservedConferenceTitlePublisherSlot =
      currentConferenceTitlePublisherSlot ?? fallbackConferenceTitlePublisherSlot;
    if (
      doiConferenceTitleHint
      && (
        !fields.conferenceTitle
        || (
          typeof fields.conferenceTitle === 'string'
          && (
            looksCompactConferenceVenueAlias(fields.conferenceTitle)
            || Boolean(preservedConferenceTitlePublisherSlot)
            || normalizeComparableText(fields.conferenceTitle)
              === normalizeComparableText(typeof fields.publisher === 'string' ? fields.publisher : '')
          )
        )
      )
    ) {
      if (
        !fields.publisher
        && preservedConferenceTitlePublisherSlot
        && normalizeComparableText(preservedConferenceTitlePublisherSlot) !== normalizeComparableText(doiConferenceTitleHint)
      ) {
        fields.publisher = preservedConferenceTitlePublisherSlot;
      }
      fields.conferenceTitle = doiConferenceTitleHint;
      referenceType = 'conference-paper';
    }

    const doiPublisherHint = inferPublisherFromDoiHint(
      typeof fields.doi === 'string' ? fields.doi : undefined,
    );
    const explicitConferencePublisherFromRaw = recoverExplicitConferencePublisherFromRaw(
      raw,
      typeof fields.title === 'string' ? fields.title : null,
      doiConferenceTitleHint ?? currentConferenceTitleText,
      typeof fields.doi === 'string' ? fields.doi : undefined,
    );
    if (
      doiPublisherHint
      && (
        !fields.publisher
        || (
          typeof fields.publisher === 'string'
          && looksBrokenConferencePublisher(fields.publisher)
        )
      )
      ) {
      fields.publisher = doiPublisherHint;
    }

    if (
      !fields.publisher
      && explicitConferencePublisherFromRaw
      && (
        doiConferenceTitleHint
        || CONFERENCE_DOI_REGEX.test(raw)
        || (
          typeof fields.conferenceTitle === 'string'
          && looksConferencePublicationVenue(fields.conferenceTitle)
        )
      )
    ) {
      fields.publisher = explicitConferencePublisherFromRaw;
      if (
        doiConferenceTitleHint
        && (
          !fields.conferenceTitle
          || !(currentConferenceTitleText && looksConferencePublicationVenue(currentConferenceTitleText))
          || Boolean(preservedConferenceTitlePublisherSlot)
        )
      ) {
        fields.conferenceTitle = doiConferenceTitleHint;
      }
      referenceType = 'conference-paper';
    }

    if (
      !fields.publisher
      && typeof fields.conferenceTitle === 'string'
      && Boolean(preservedConferenceTitlePublisherSlot)
      && !(currentConferenceTitleText && looksConferencePublicationVenue(currentConferenceTitleText))
      && (
        CONFERENCE_DOI_REGEX.test(raw ?? '')
        || Boolean(recoverCompactConferenceAliasFromDoi(typeof fields.doi === 'string' ? fields.doi : undefined, raw))
      )
    ) {
      fields.publisher = preservedConferenceTitlePublisherSlot;
      fields.conferenceTitle = doiConferenceTitleHint ?? null;
      referenceType = 'conference-paper';
    }

    const recoveredNumericConferencePublisherTail =
      referenceType === 'conference-paper'
      || rawHasConferenceDoi
      || Boolean(doiConferenceTitleHint)
        ? recoverStrongNumericConferencePublisherTail(raw)
        : null;
    const currentTitleText = typeof fields.title === 'string'
      ? normalizeTitleCandidate(fields.title)
      : null;
    const currentPublisherText = typeof fields.publisher === 'string'
      ? normalizeConferenceTitle(fields.publisher)
      : null;
    const recoveredConferenceTitleText = typeof recoveredNumericConferencePublisherTail?.title === 'string'
      ? normalizeTitleCandidate(recoveredNumericConferencePublisherTail.title)
      : null;
    const recoveredConferencePublisherText = typeof recoveredNumericConferencePublisherTail?.publisher === 'string'
      ? normalizeConferenceTitle(recoveredNumericConferencePublisherTail.publisher)
      : null;
    const titleLooksPublisherContaminated =
      currentTitleText != null
      && (
        (currentPublisherText != null && normalizeComparableText(currentTitleText).includes(normalizeComparableText(currentPublisherText)))
        || (
          typeof fields.conferenceTitle === 'string'
          && normalizeComparableText(currentTitleText).includes(normalizeComparableText(fields.conferenceTitle))
        )
        || (typeof fields.title === 'string' && /["“”]/u.test(fields.title))
      );
    const titleLooksRecoveredConferenceStronger =
      currentTitleText == null
      || recoveredConferenceTitleText == null
      || recoveredConferenceTitleText.length > currentTitleText.length + 12
      || normalizeComparableText(currentTitleText) === normalizeComparableText(currentPublisherText ?? '')
      || (
        currentTitleText.split(/\s+/u).filter(Boolean).length < 5
        && recoveredConferenceTitleText.split(/\s+/u).filter(Boolean).length >= 5
      )
      || titleLooksPublisherContaminated;

    if (
      recoveredNumericConferencePublisherTail
      && recoveredConferencePublisherText
      && (
        !currentPublisherText
        || looksBrokenConferencePublisher(currentPublisherText)
        || (
          doiConferenceTitleHint != null
          && normalizeComparableText(doiConferenceTitleHint).includes(normalizeComparableText(currentPublisherText))
        )
        || normalizeComparableText(currentPublisherText).includes(normalizeComparableText(recoveredConferencePublisherText))
        || normalizeComparableText(recoveredConferencePublisherText).includes(normalizeComparableText(currentPublisherText))
      )
    ) {
      fields.publisher = doiPublisherHint ?? recoveredConferencePublisherText;
    }

    if (
      recoveredConferenceTitleText
      && titleLooksRecoveredConferenceStronger
    ) {
      fields.title = recoveredConferenceTitleText;
    }

    const quotedConferenceTitle = raw ? normalizeTitleCandidate(findQuotedTitle(raw)?.title ?? undefined) : null;
    if (
      quotedConferenceTitle
      && typeof fields.title === 'string'
      && (
        /["“”]/u.test(fields.title)
        || (
          typeof fields.publisher === 'string'
          && normalizeComparableText(fields.title).includes(normalizeComparableText(fields.publisher))
        )
      )
    ) {
      fields.title = quotedConferenceTitle;
    }
  }

  if (
    raw
    &&
    !fields.publisher
    && typeof fields.conferenceTitle === 'string'
    && looksCompactConferenceVenueAlias(fields.conferenceTitle)
  ) {
    const recoveredNumericConference = recoverStrongNumericConferencePublisherTail(raw);
    if (typeof recoveredNumericConference?.publisher === 'string') {
      const doiConferenceTitleHint = recoverConferenceTitleFromDoiHint(
        typeof fields.doi === 'string' ? fields.doi : undefined,
        typeof fields.year === 'number' ? fields.year : undefined,
      );
      const shouldKeepCompactConferenceAlias =
        normalizeComparableText(fields.conferenceTitle)
          !== normalizeComparableText(recoveredNumericConference.publisher);
      fields.publisher = recoveredNumericConference.publisher;
      fields.conferenceTitle =
        doiConferenceTitleHint ?? (shouldKeepCompactConferenceAlias ? fields.conferenceTitle : null);
      if (typeof recoveredNumericConference.pages === 'string') {
        fields.pages = recoveredNumericConference.pages;
      }
      if (typeof recoveredNumericConference.title === 'string') {
        fields.title = recoveredNumericConference.title;
      }
      referenceType = 'conference-paper';
    }
  }

  if (
    raw
    && !conferenceTitle
    && hasProceedingsDoi
    && typeof fields.bookTitle === 'string'
    && typeof fields.title === 'string'
    && looksLikeAuthorSpill(fields.title)
  ) {
    const recoveredConferenceTail = extractTailAfterTitle(raw, fields.bookTitle);
    const recoveredConferenceTitle = recoveredConferenceTail
      ? normalizeConferenceTitle(
        recoveredConferenceTail
          .replace(/^[,.;:\s]+/u, '')
          .replace(/[;,]\s*(?:19|20)\d{2}\b.*$/iu, '')
          .trim(),
      )
      : null;
    if (recoveredConferenceTitle && !looksLowQualityContainerCandidate(recoveredConferenceTitle)) {
      fields.title = fields.bookTitle;
      fields.bookTitle = null;
      fields.conferenceTitle = recoveredConferenceTitle;
      referenceType = 'conference-paper';
    }
  }

  const conferenceAliasCandidate =
    !conferenceTitle
      ? (
        (bookTitle != null && looksConferenceVenueAlias(bookTitle) ? bookTitle : null)
        ?? (journal != null && looksConferenceVenueAlias(journal) ? journal : null)
        ?? (typeof fields.publisher === 'string' && looksConferenceVenueAlias(fields.publisher)
          ? normalizeConferenceTitle(fields.publisher)
          : null)
        ?? (typeof fields.institution === 'string' && looksConferenceVenueAlias(fields.institution)
          ? normalizeConferenceTitle(fields.institution)
          : null)
        )
      : null;
  const aliasOnlyConferenceSignal =
    compactConferenceAliasCandidate != null
    && typeof fields.pages === 'string'
    && !fields.issue
    && !(typeof fields.issn === 'string' && fields.issn.trim().length > 0)
    && !(
      typeof fields.journal === 'string'
      && (
        looksJournalLikeContainer(fields.journal)
        || Boolean(lookupIssnByJournalTitle(fields.journal))
      )
    );
  const hasConferenceAliasSignals =
    conferenceAliasCandidate != null
    && !hasBookChapterDoi
    && !hasStrongArticleContainerEvidence
    && (
      hasProceedingsDoi
      || /\bpaper presented at\b/iu.test(raw ?? '')
      || CONFERENCE_CUE_REGEX.test(raw ?? '')
      || aliasOnlyConferenceSignal
    );

  if (hasBookishSignals) {
    if (!fields.publisher) {
      fields.publisher = journal;
    }
    referenceType = 'book';
  }

  if (repository) {
    if (bookTitle && normalizeComparableText(bookTitle) === normalizeComparableText(repository)) {
      fields.bookTitle = null;
    }
    if (conferenceTitle && normalizeComparableText(conferenceTitle) === normalizeComparableText(repository)) {
      fields.conferenceTitle = null;
    }
    referenceType = 'preprint';
  }

  if (
    conferenceTitle
    && hasBookChapterDoi
    && !looksConferencePublicationVenue(conferenceTitle)
  ) {
    if (!fields.bookTitle) {
      fields.bookTitle = conferenceTitle;
    }
    fields.conferenceTitle = null;
    referenceType = 'book-chapter';
  }

  if (
    referenceType !== 'book-chapter'
    && hasConferenceAliasSignals
  ) {
    fields.conferenceTitle = conferenceAliasCandidate;
    if (bookTitle != null && conferenceAliasCandidate === bookTitle) {
      fields.bookTitle = null;
    }
    if (journal != null && conferenceAliasCandidate === journal) {
      fields.journal = null;
    }
    if (typeof fields.publisher === 'string' && normalizeConferenceTitle(fields.publisher) === conferenceAliasCandidate) {
      fields.publisher = null;
    }
    if (typeof fields.institution === 'string' && normalizeConferenceTitle(fields.institution) === conferenceAliasCandidate) {
      fields.institution = null;
    }
    referenceType = 'conference-paper';
  }

  if (
    typeof fields.publisher === 'string'
    && (
      fields.volume
      || fields.issue
      || fields.pages
    )
  ) {
    const editionJournalMatch = fields.publisher.match(
      /^(?<edition>\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?)\s+(?<journal>.+)$/iu,
    );
    const recoveredJournal = editionJournalMatch?.groups?.journal
      ? (
        normalizeJournalCandidate(editionJournalMatch.groups.journal, title)
        ?? stripTrailingPunctuation(editionJournalMatch.groups.journal).trim()
      )
      : null;
    if (editionJournalMatch?.groups?.edition && recoveredJournal) {
      const normalizedEdition = stripTrailingPunctuation(editionJournalMatch.groups.edition);
      if (
        typeof fields.title === 'string'
        && normalizedEdition
        && !normalizeComparableText(fields.title).includes(normalizeComparableText(normalizedEdition))
      ) {
        fields.title = `${stripTrailingPunctuation(fields.title)}, ${normalizedEdition}`;
      }
      fields.journal = recoveredJournal;
      fields.publisher = null;
    }
  }

  if (typeof fields.title === 'string' && typeof fields.publisher === 'string') {
    const repairedTitlePublisher = repairPublisherTitleTokenCarryover(
      fields.title,
      fields.publisher,
    );
    if (repairedTitlePublisher) {
      fields.title = repairedTitlePublisher.title;
      fields.publisher = repairedTitlePublisher.publisher;
    }
  }

  const journalLikePublisherConferenceFallback =
    !fields.conferenceTitle
    && !fields.bookTitle
    && !fields.volume
    && !fields.issue
    && !fields.pages
    && !fields.repository
    && !looksPreprintCue(raw)
    && typeof fields.publisher === 'string'
    && looksJournalLikeContainer(fields.publisher)
    && (
      referenceType === 'unknown'
      || referenceType === 'book'
      || referenceType === 'conference-paper'
      || referenceType == null
    )
    ? normalizeConferenceTitle(fields.publisher)
    : null;
  if (journalLikePublisherConferenceFallback) {
    fields.conferenceTitle = journalLikePublisherConferenceFallback;
    fields.publisher = null;
    referenceType = 'conference-paper';
  }

  if (
    typeof fields.repository === 'string'
    && typeof fields.conferenceTitle === 'string'
    && !looksProceedingsLikeDoi(typeof fields.doi === 'string' ? fields.doi : undefined)
  ) {
    const normalizedRepository = normalizeConferenceTitle(fields.repository);
    const normalizedConferenceTitle = normalizeConferenceTitle(fields.conferenceTitle);
    const normalizedPublisher = typeof fields.publisher === 'string'
      ? normalizeConferenceTitle(fields.publisher)
      : null;
    if (
      /\bpreprint\b/iu.test(normalizedConferenceTitle)
      || !looksConferencePublicationVenue(normalizedConferenceTitle)
      || normalizeComparableText(normalizedConferenceTitle) === normalizeComparableText(normalizedRepository)
      || (
        normalizedPublisher
        && normalizeComparableText(normalizedConferenceTitle) === normalizeComparableText(normalizedPublisher)
      )
    ) {
      fields.conferenceTitle = null;
    }
  }

  if (raw && typeof fields.publisher === 'string' && fields.publisher.trim().length > 0) {
    fields.publisher = restorePublisherLegalSuffixFromRaw(raw, fields.publisher);
  }

  if (referenceType === 'article-journal') {
    fields.publisher = null;
    fields.conferenceTitle = null;
    fields.bookTitle = null;
    fields.siteName = null;
    fields.institution = null;
    return;
  }

  if (referenceType === 'conference-paper') {
    const currentConferenceTitle = typeof fields.conferenceTitle === 'string'
      ? normalizeConferenceTitle(fields.conferenceTitle)
      : null;
    const currentBookTitle = typeof fields.bookTitle === 'string'
      ? normalizeConferenceTitle(fields.bookTitle)
      : null;
    const currentJournal = typeof fields.journal === 'string'
      ? normalizeJournalCandidate(fields.journal, title) ?? normalizeConferenceTitle(fields.journal)
      : null;
    const publisher = typeof fields.publisher === 'string'
      ? normalizeConferenceTitle(fields.publisher)
      : null;
    const institution = typeof fields.institution === 'string'
      ? normalizeConferenceTitle(fields.institution)
      : null;
    const recoveredRawConferenceTitle =
      raw && typeof fields.title === 'string'
        ? recoverConferenceContainerAfterTitle(raw, fields.title)
        : null;
    const rawHasConferenceDoi = raw ? CONFERENCE_DOI_REGEX.test(raw) : false;
    const rawHasConferenceCue = Boolean(raw && (/\bpaper presented at\b/iu.test(raw) || CONFERENCE_CUE_REGEX.test(raw)));
    const doiConferenceAlias = recoverCompactConferenceAliasFromDoi(
      typeof fields.doi === 'string' ? fields.doi : undefined,
      raw,
    );
    const doiConferenceTitleHint = recoverConferenceTitleFromDoiHint(
      typeof fields.doi === 'string' ? fields.doi : undefined,
      typeof fields.year === 'number' ? fields.year : undefined,
    );
    const doiPublisherHint = inferPublisherFromDoiHint(
      typeof fields.doi === 'string' ? fields.doi : undefined,
    );
    const hasArticleLocators =
      (typeof fields.volume === 'string' && fields.volume.trim().length > 0)
      || (typeof fields.issue === 'string' && fields.issue.trim().length > 0)
      || (typeof fields.pages === 'string' && fields.pages.trim().length > 0);
    const titleOnlyConferenceCue =
      Boolean(
        title
        && CONFERENCE_CUE_REGEX.test(title)
        && hasArticleLocators
        && !rawHasConferenceDoi
        && !doiConferenceAlias
        && !doiConferenceTitleHint,
      );
    const effectiveRawConferenceCue = rawHasConferenceCue && !titleOnlyConferenceCue;
    const hasConferenceEvidence =
      effectiveRawConferenceCue
      || rawHasConferenceDoi
      || Boolean(doiConferenceTitleHint)
      || Boolean(doiConferenceAlias);
    const hasIssnBackedArticleEvidence =
      typeof fields.issn === 'string'
      || Boolean(currentConferenceTitle && lookupIssnByJournalTitle(currentConferenceTitle));
    const weakConferenceProxy =
      currentConferenceTitle != null
      && !looksConferencePublicationVenue(currentConferenceTitle)
      && (
        looksJournalLikeContainer(currentConferenceTitle)
        || looksInstitutionalContainer(currentConferenceTitle)
        || looksReportPublisherAcronym(currentConferenceTitle)
      );
    const weakPublisherProxy =
      publisher != null
      && !looksPublisherLike(publisher)
      && !looksConferencePublicationVenue(publisher)
      && (
        looksJournalLikeContainer(publisher)
        || looksInstitutionalContainer(publisher)
        || looksReportPublisherAcronym(publisher)
      );

    if (
      currentConferenceTitle
      && hasArticleLocators
      && !effectiveRawConferenceCue
      && !rawHasConferenceDoi
      && !doiConferenceAlias
      && !looksCompactConferenceVenueAlias(currentConferenceTitle)
      && !looksInstitutionalContainer(currentConferenceTitle)
      && !looksPublisherLike(currentConferenceTitle)
    ) {
      const recoveredJournal =
        normalizeJournalCandidate(currentConferenceTitle, title)
        ?? normalizeConferenceTitle(currentConferenceTitle);
      const recoveredTitle = title
        ? recoverTitleOverflowBeforeContainer(raw ?? '', title, recoveredJournal)
        : null;
      if (recoveredTitle) {
        fields.title = recoveredTitle;
      }
      fields.journal = recoveredJournal;
      fields.conferenceTitle = null;
      fields.publisher = null;
      if (
        typeof fields.institution === 'string'
        && normalizeComparableText(fields.institution).startsWith(normalizeComparableText(recoveredJournal))
      ) {
        fields.institution = null;
      }
      fields.bookTitle = null;
      fields.siteName = null;
      return;
    }

    if (
      currentConferenceTitle
      && looksCompactConferenceVenueAlias(currentConferenceTitle)
      && hasArticleLocators
      && !effectiveRawConferenceCue
      && (!rawHasConferenceDoi || hasIssnBackedArticleEvidence)
      && (!doiConferenceAlias || hasIssnBackedArticleEvidence)
      && (!doiConferenceTitleHint || hasIssnBackedArticleEvidence)
      && hasIssnBackedArticleEvidence
    ) {
      fields.journal = normalizeJournalCandidate(currentConferenceTitle, title) ?? currentConferenceTitle;
      fields.conferenceTitle = null;
      fields.publisher = null;
      fields.bookTitle = null;
      fields.siteName = null;
      return;
    }

    if (
      currentJournal
      && hasArticleLocators
      && !effectiveRawConferenceCue
      && !rawHasConferenceDoi
      && !doiConferenceAlias
      && (!currentConferenceTitle || weakConferenceProxy)
      && (!publisher || weakPublisherProxy || normalizeComparableText(publisher) === normalizeComparableText(currentJournal))
    ) {
      fields.publisher = null;
      fields.conferenceTitle = null;
      fields.bookTitle = null;
      fields.siteName = null;
      fields.institution = null;
      return;
    }

    if (
      currentConferenceTitle
      && looksCompactConferenceVenueAlias(currentConferenceTitle)
      && publisher
      && hasArticleLocators
      && !effectiveRawConferenceCue
      && !rawHasConferenceDoi
      && !doiConferenceAlias
      && looksJournalLikeContainer(publisher)
      && !looksInstitutionalContainer(publisher)
      && !looksPublisherLike(publisher)
    ) {
      const recoveredJournal =
        normalizeJournalCandidate(publisher, title)
        ?? normalizeConferenceTitle(publisher);
      const recoveredTitle = title
        ? recoverTitleOverflowBeforeContainer(raw ?? '', title, recoveredJournal)
        : null;
      if (recoveredTitle) {
        fields.title = recoveredTitle;
      }
      fields.journal = recoveredJournal;
      fields.publisher = null;
      fields.conferenceTitle = null;
      fields.bookTitle = null;
      fields.siteName = null;
      if (
        typeof fields.institution === 'string'
        && normalizeComparableText(fields.institution).startsWith(normalizeComparableText(recoveredJournal))
      ) {
        fields.institution = null;
      }
      return;
    }

    if (
      doiConferenceTitleHint
      && (
        !currentConferenceTitle
        || looksCompactConferenceVenueAlias(currentConferenceTitle)
        || normalizeComparableText(currentConferenceTitle) === normalizeComparableText(publisher ?? '')
      )
    ) {
      fields.conferenceTitle = doiConferenceTitleHint;
    }

    if (
      doiConferenceAlias
      && currentConferenceTitle
      && looksCompactConferenceVenueAlias(currentConferenceTitle)
      && normalizeComparableText(currentConferenceTitle) !== normalizeComparableText(doiConferenceAlias)
    ) {
      fields.conferenceTitle = doiConferenceAlias;
    }

    if (!currentConferenceTitle) {
      const fallbackConferenceTitle =
        recoveredRawConferenceTitle
        ?? doiConferenceTitleHint
        ?? doiConferenceAlias
        ?? (
          !hasArticleLocators && currentBookTitle && isConferenceFallbackContainerCandidate(currentBookTitle, {
            rawHasConferenceDoi,
            rawHasConferenceCue: effectiveRawConferenceCue,
          })
            ? currentBookTitle
            : null
        )
        ?? (
          !hasArticleLocators && currentJournal && isConferenceFallbackContainerCandidate(currentJournal, {
            rawHasConferenceDoi,
            rawHasConferenceCue: effectiveRawConferenceCue,
          })
            ? currentJournal
            : null
        )
        ?? (
          !hasArticleLocators && publisher && isConferenceFallbackContainerCandidate(publisher, {
            rawHasConferenceDoi,
            rawHasConferenceCue: effectiveRawConferenceCue,
          })
            ? publisher
            : null
        )
        ?? (
          !hasArticleLocators && institution && isConferenceFallbackContainerCandidate(institution, {
            rawHasConferenceDoi,
            rawHasConferenceCue: effectiveRawConferenceCue,
          })
            ? institution
            : null
        );
      if (fallbackConferenceTitle) {
        fields.conferenceTitle = fallbackConferenceTitle;
      }
    }

    if (
      !currentJournal
      && publisher
      && hasArticleLocators
      && !effectiveRawConferenceCue
      && !rawHasConferenceDoi
      && !doiConferenceAlias
      && !doiConferenceTitleHint
      && looksJournalLikeContainer(publisher)
      && !looksPublisherLike(publisher)
      && !looksInstitutionalContainer(publisher)
    ) {
      fields.journal = normalizeJournalCandidate(publisher, title) ?? publisher;
      fields.publisher = null;
      fields.conferenceTitle = null;
      fields.bookTitle = null;
      fields.siteName = null;
      return;
    }

    if (
      !fields.publisher
      && currentJournal
      && hasConferenceEvidence
      && !looksLocatorHeavyContainerSpill(currentJournal)
      && !looksConferenceVenueAlias(currentJournal)
      && !looksCompactConferenceVenueAlias(currentJournal)
      && !looksInstitutionalContainer(currentJournal)
      && (
        looksPublisherLike(currentJournal)
        || looksJournalLikeContainer(currentJournal)
        || looksStandaloneInstitutionalAlias(currentJournal)
        || looksInstitutionalContainer(currentJournal)
      )
      && (
        !fields.conferenceTitle
        || normalizeComparableText(currentJournal) !== normalizeComparableText(String(fields.conferenceTitle))
      )
    ) {
      fields.publisher = currentJournal;
    }

    if (
      currentJournal
      && hasConferenceEvidence
      && typeof fields.publisher === 'string'
      && (
        looksCompactConferenceVenueAlias(fields.publisher)
        || looksBrokenConferencePublisher(fields.publisher)
      )
      && !looksConferenceVenueAlias(currentJournal)
      && !looksCompactConferenceVenueAlias(currentJournal)
      && !looksInstitutionalContainer(currentJournal)
      && normalizeComparableText(currentJournal) !== normalizeComparableText(String(fields.conferenceTitle ?? ''))
    ) {
      fields.publisher = currentJournal;
    }

    if (
      publisher
      && typeof fields.conferenceTitle === 'string'
      && normalizeComparableText(publisher) === normalizeComparableText(fields.conferenceTitle)
      && !currentJournal
      && !institution
    ) {
      fields.publisher = null;
    }

    if (
      doiPublisherHint
      && (
        !fields.publisher
        || (
          typeof fields.publisher === 'string'
          && looksBrokenConferencePublisher(fields.publisher)
        )
        || (
          typeof fields.publisher === 'string'
          && normalizeComparableText(doiPublisherHint).includes(normalizeComparableText(fields.publisher))
        )
        || (
          typeof fields.publisher === 'string'
          && normalizeComparableText(fields.publisher).includes(normalizeComparableText(doiPublisherHint))
        )
        || (
          doiConferenceTitleHint != null
          && typeof fields.publisher === 'string'
          && normalizeComparableText(doiConferenceTitleHint).includes(normalizeComparableText(fields.publisher))
        )
      )
    ) {
      fields.publisher = doiPublisherHint;
    }

    const recoveredNumericConferencePublisherTail =
      rawHasConferenceDoi || doiConferenceTitleHint
        ? recoverStrongNumericConferencePublisherTail(raw ?? '')
        : null;
    const recoveredConferenceAuthors =
      recoveredNumericConferencePublisherTail?.authorSegment
        ? parseAuthorSegment(recoveredNumericConferencePublisherTail.authorSegment)
        : [];
    const recoveredConferenceTitle =
      typeof recoveredNumericConferencePublisherTail?.title === 'string'
        ? normalizeTitleCandidate(recoveredNumericConferencePublisherTail.title)
        : null;
    if (
      recoveredConferenceAuthors.length >= 1
      && (
        !Array.isArray(fields.authors)
        || fields.authors.length < 2
        || typeof fields.title !== 'string'
        || fields.title.trim().length === 0
      )
    ) {
      fields.authors = recoveredConferenceAuthors;
    }
    if (
      recoveredConferenceTitle
      && (
        typeof fields.title !== 'string'
        || fields.title.trim().length === 0
        || normalizeComparableText(fields.title) === normalizeComparableText(String(fields.publisher ?? ''))
        || (
          typeof fields.title === 'string'
          && (
            /["“”]/u.test(fields.title)
            || (
              typeof fields.publisher === 'string'
              && normalizeComparableText(fields.title).includes(normalizeComparableText(fields.publisher))
            )
          )
        )
      )
    ) {
      fields.title = recoveredConferenceTitle;
    }

    const finalQuotedConferenceTitle = raw
      ? normalizeTitleCandidate(findQuotedTitle(raw)?.title ?? undefined)
      : null;
    const authorDateQuotedConferenceTitle = raw
      ? normalizeTitleCandidate(
        raw.match(/^\s*.+?\((?:19|20)\d{2}\)\s*["“](?<title>.+?)(?:[.?!,])?["”]/u)?.groups?.title ?? undefined,
      )
      : null;
    const numericConferenceSentenceTitle = raw
      ? normalizeTitleCandidate(
        stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw))
          .match(/^(?:\[\d+\]\s*)?.+?\.\s+(?<title>.+?),\s*[^;]+;\s*(?:19|20)\d{2}(?:,\s*p{1,2}\.?\s*[^.;]+)?\.?$/iu)
          ?.groups?.title ?? undefined,
      )
      : null;
    if (
      finalQuotedConferenceTitle
      && typeof fields.title === 'string'
      && (
        /["“”]/u.test(fields.title)
        || (
          typeof fields.publisher === 'string'
          && normalizeComparableText(fields.title).includes(normalizeComparableText(fields.publisher))
        )
      )
    ) {
      fields.title = finalQuotedConferenceTitle;
    }
    if (
      authorDateQuotedConferenceTitle
      && (
        typeof fields.title !== 'string'
        || /["“”]/u.test(fields.title)
        || (
          typeof fields.publisher === 'string'
          && normalizeComparableText(fields.title).includes(normalizeComparableText(fields.publisher))
        )
      )
    ) {
      fields.title = authorDateQuotedConferenceTitle;
    }
    if (
      numericConferenceSentenceTitle
      && (
        typeof fields.title !== 'string'
        || fields.title.trim().length === 0
      )
    ) {
      fields.title = numericConferenceSentenceTitle;
    }

    if (
      institution
      && typeof fields.conferenceTitle === 'string'
      && normalizeComparableText(institution) === normalizeComparableText(fields.conferenceTitle)
    ) {
      fields.institution = null;
    }
    if (
      !fields.conferenceTitle
      && !rawHasConferenceCue
      && !rawHasConferenceDoi
      && institution
      && looksStandaloneInstitutionalAlias(institution)
    ) {
      fields.institution = institution;
      fields.publisher = null;
      referenceType = 'report';
    }
    fields.journal = null;
    fields.bookTitle = null;
    fields.siteName = null;
    return;
  }

  if (referenceType === 'book-chapter') {
    fields.journal = null;
    fields.conferenceTitle = null;
    fields.siteName = null;
    fields.institution = null;
    return;
  }

  if (referenceType === 'book') {
    fields.journal = null;
    fields.conferenceTitle = null;
    fields.bookTitle = null;
    fields.siteName = null;
    fields.institution = null;
    if (looksTitleEmbeddedYearRangePages(fields)) {
      fields.pages = null;
    }
    return;
  }

  if (referenceType === 'report') {
    if (Array.isArray(fields.authors) && fields.authors.length === 1) {
      const [authorValue] = fields.authors;
      const author = toCanonicalAuthor(authorValue) ?? (
        typeof authorValue === 'string'
          ? {
            family: authorValue.trim(),
            given: null,
            initials: null,
            literal: authorValue.trim(),
            isCorporate: true,
          }
          : null
      );
      const ownerLead = typeof fields.institution === 'string'
        ? fields.institution
        : typeof fields.publisher === 'string'
          ? fields.publisher
          : null;
      const authorComparable = author
        ? normalizeComparableText(author.literal ?? [author.family, author.given].filter(Boolean).join(' '))
        : '';
      const ownerComparable = ownerLead ? normalizeComparableText(ownerLead) : '';
      const rawComparable = raw ? normalizeComparableText(raw) : '';
      if (
        ownerComparable.length > 0
        && authorComparable.length > 0
        && (
          ownerComparable === authorComparable
          || rawComparable.startsWith(`${ownerComparable} `)
        )
      ) {
        fields.authors = [];
      }
    }
    fields.journal = null;
    fields.conferenceTitle = null;
    fields.bookTitle = null;
    fields.siteName = null;
    return;
  }

  if (
    !fields.journal
    && typeof fields.conferenceTitle === 'string'
    && (
      typeof fields.volume === 'string'
      || typeof fields.issue === 'string'
      || typeof fields.pages === 'string'
      || typeof fields.issn === 'string'
    )
    && !CONFERENCE_CUE_REGEX.test(raw ?? '')
    && !looksProceedingsLikeDoi(doi ?? undefined)
    && !looksInstitutionalContainer(fields.conferenceTitle)
    && (
      typeof fields.issn === 'string'
      || (
        looksJournalLikeContainer(fields.conferenceTitle)
        || Boolean(lookupIssnByJournalTitle(fields.conferenceTitle))
      )
    )
  ) {
    fields.journal =
      normalizeJournalCandidate(fields.conferenceTitle, typeof fields.title === 'string' ? fields.title : null)
      ?? normalizeConferenceTitle(fields.conferenceTitle);
    fields.conferenceTitle = null;
    if (
      typeof fields.bookTitle === 'string'
      && typeof fields.journal === 'string'
      && shouldClearArticleSpillContainer(fields.bookTitle, fields.journal)
    ) {
      fields.bookTitle = null;
    }
  }

  if (referenceType === 'preprint') {
    fields.journal = null;
    fields.conferenceTitle = null;
    fields.bookTitle = null;
    fields.siteName = null;
  }
}

function repairEditionJournalPublisherSpill(
  fields: Partial<Record<ExtractedFieldKey, unknown>>,
): void {
  if (
    typeof fields.publisher !== 'string'
    || (
      !fields.volume
      && !fields.issue
      && !fields.pages
    )
  ) {
    return;
  }

  const editionJournalMatch = fields.publisher.match(
    /^(?<edition>\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?)\s+(?<journal>.+)$/iu,
  );
  const title = typeof fields.title === 'string' ? fields.title : null;
  const recoveredJournal = editionJournalMatch?.groups?.journal
    ? (
      normalizeJournalCandidate(editionJournalMatch.groups.journal, title)
      ?? stripTrailingPunctuation(editionJournalMatch.groups.journal).trim()
    )
    : null;

  if (!editionJournalMatch?.groups?.edition || !recoveredJournal) {
    return;
  }

  const normalizedEdition = stripTrailingPunctuation(editionJournalMatch.groups.edition);
  if (
    typeof fields.title === 'string'
    && normalizedEdition
    && !normalizeComparableText(fields.title).includes(normalizeComparableText(normalizedEdition))
  ) {
    fields.title = `${stripTrailingPunctuation(fields.title)}, ${normalizedEdition}`;
  }
  fields.journal = recoveredJournal;
  fields.publisher = null;
}

function shouldAllowPublisherForType(referenceType: ReferenceType | null | undefined): boolean {
  return referenceType !== 'article-journal';
}

function resolveReferenceTypeForFieldGuards(
  fields: Partial<Record<ExtractedFieldKey, unknown>>,
  referenceType: ReferenceType | null,
): ReferenceType | null {
  const title = typeof fields.title === 'string' ? normalizeComparableText(fields.title) : '';
  const doi = typeof fields.doi === 'string' ? fields.doi : '';
  const nonDoiUrl = typeof fields.url === 'string' && !isDoiUrl(fields.url);
  const conferenceTitle = typeof fields.conferenceTitle === 'string'
    ? normalizeConferenceTitle(fields.conferenceTitle)
    : '';
  const strongConferenceTitle =
    conferenceTitle.length > 0
    && normalizeComparableText(conferenceTitle) !== title
    && looksConferencePublicationVenue(conferenceTitle);
  const bookTitle = typeof fields.bookTitle === 'string'
    ? normalizeConferenceTitle(fields.bookTitle)
    : '';
  const journal = typeof fields.journal === 'string'
    ? normalizeConferenceTitle(fields.journal)
    : '';
  const repository = typeof fields.repository === 'string'
    ? normalizeConferenceTitle(fields.repository)
    : '';
  const publisher = typeof fields.publisher === 'string'
    ? normalizeConferenceTitle(fields.publisher)
    : '';
  const institution = typeof fields.institution === 'string'
    ? normalizeInstitutionCandidate(fields.institution, typeof fields.year === 'number' ? fields.year : undefined) ?? ''
    : '';
  const siteName = typeof fields.siteName === 'string'
    ? normalizeConferenceTitle(fields.siteName)
    : '';
  const pmid = typeof fields.pmid === 'string'
    ? normalizePmid(fields.pmid) ?? stripTrailingPunctuation(fields.pmid).trim()
    : '';
  const pages = typeof fields.pages === 'string' ? normalizePages(fields.pages) : '';
  const webpageIdentifierLocatorArtifact = looksWebpageIdentifierLocatorArtifact(pages, {
    hasMeaningfulUrl: nonDoiUrl,
    siteName,
    institution,
    pmid,
  });
  const hasBookishIdentifier =
    (typeof fields.isbn === 'string' && fields.isbn.trim().length > 0)
    || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi)
    || looksBookChapterDoi(doi);
  const hasLocators =
    (typeof fields.volume === 'string' && fields.volume.trim().length > 0)
    || (typeof fields.issue === 'string' && fields.issue.trim().length > 0)
    || (pages.length > 0 && !webpageIdentifierLocatorArtifact);
  const hasThesis =
    typeof fields.thesisType === 'string'
    && fields.thesisType.trim().length > 0;
  const mergedBookishJournalTail =
    journal.length > 0
    && publisher.length > 0
    && normalizeComparableText(journal).includes(normalizeComparableText(publisher))
    && !hasLocators
    && !looksConferenceVenueAlias(journal);
  const reportLikeDoi = looksReportLikeDoi(doi, {
    owner: institution || journal || publisher || siteName,
  });
  const conferenceLikeDoi = CONFERENCE_DOI_REGEX.test(doi) || looksProceedingsLikeDoi(doi);
  const reportishOwner =
    institution.length > 0
    || siteName.length > 0
    || looksInstitutionalContainer(journal)
    || looksInstitutionalContainer(publisher)
    || looksReportPublisherAcronym(journal)
    || looksReportPublisherAcronym(publisher)
    || looksOstiLikeOwner(journal)
    || looksOstiLikeOwner(publisher)
    || looksOstiLikeOwner(siteName)
    || (!nonDoiUrl && /^(?:rfc editor|east asia forum)$/iu.test(siteName))
    || (!nonDoiUrl && /^(?:rfc editor|east asia forum)$/iu.test(journal));
  const conferencePublisherAlias =
    publisher.length > 0
    && (looksCompactConferenceVenueAlias(publisher) || looksConferencePublisherOrganization(publisher));
  const explicitConferenceField =
    conferenceTitle.length > 0
    && !looksLowQualityContainerCandidate(conferenceTitle)
    && !looksReportPublisherAcronym(conferenceTitle)
    && (
      hasExplicitConferenceTitleCue(conferenceTitle)
      || looksConferencePublicationVenue(conferenceTitle)
      || looksConferenceContainer(conferenceTitle)
      || looksCompactConferenceVenueAlias(conferenceTitle)
    )
    && normalizeComparableText(conferenceTitle) !== title;
  const conferenceLikeJournal =
    journal.length > 0
    && !hasLocators
    && !looksLowQualityContainerCandidate(journal)
    && !looksInstitutionalContainer(journal)
    && (
      looksConferencePublicationVenue(journal)
      || looksConferenceContainer(journal)
      || looksCompactConferenceVenueAlias(journal)
    );
  const strongBookChapterSignal =
    bookTitle.length > 0
    && !looksConferenceContainer(bookTitle)
    && !looksInstitutionalContainer(bookTitle)
    && (
      referenceType === 'book-chapter'
      || publisher.length > 0
      || hasBookishIdentifier
      || looksBookChapterDoi(doi)
    );
  const strongArticleProfile =
    journal.length > 0
    && hasLocators
    && !looksConferenceVenueAlias(journal)
    && !looksConferencePublisherOrganization(journal);
  const webpageLikeJournalEcho =
    journal.length > 0
    && nonDoiUrl
    && !hasLocators
    && !reportLikeDoi
    && looksWebpageSiteOwnerBlend(journal, siteName, institution);
  const strongWebpageProfile =
    nonDoiUrl
    && !hasLocators
    && !conferenceLikeDoi
    && !reportLikeDoi
    && !hasBookishIdentifier
    && (
      (siteName.length > 0 && !looksConferencePublicationVenue(siteName))
      || webpageLikeJournalEcho
      || (
        institution.length > 0
        && journal.length === 0
        && conferenceTitle.length === 0
      )
    );

  if (hasThesis) {
    return 'thesis';
  }

  if (strongWebpageProfile) {
    return 'webpage';
  }

  if (
    strongArticleProfile
    && !reportLikeDoi
    && !conferenceLikeDoi
    && !explicitConferenceField
  ) {
    return 'article-journal';
  }

  if (
    conferenceTitle.length > 0
    && looksBookChapterDoi(doi)
    && !looksConferencePublicationVenue(conferenceTitle)
  ) {
    return 'book-chapter';
  }

  if (repository.length > 0 && !conferenceLikeDoi) {
    return 'preprint';
  }

  if (strongConferenceTitle || (explicitConferenceField && !reportLikeDoi)) {
    return 'conference-paper';
  }

  if (strongBookChapterSignal) {
    return 'book-chapter';
  }

  if (reportLikeDoi && !conferenceLikeDoi && !hasLocators && reportishOwner) {
    return 'report';
  }

  if (conferenceLikeJournal && !reportLikeDoi) {
    return 'conference-paper';
  }

  if (conferenceLikeDoi && !reportLikeDoi && !hasLocators) {
    return 'conference-paper';
  }

  if (conferenceLikeDoi && (strongConferenceTitle || conferencePublisherAlias)) {
    return 'conference-paper';
  }

  if (mergedBookishJournalTail) {
    return hasBookishIdentifier ? 'book' : referenceType === 'book-chapter' ? 'book-chapter' : 'book';
  }

  if (
    journal.length > 0
    && hasBookishIdentifier
    && !hasLocators
    && !looksConferenceVenueAlias(journal)
  ) {
    return 'book';
  }

  if (typeof fields.conferenceTitle === 'string' && fields.conferenceTitle.trim().length > 0) {
    return 'conference-paper';
  }

  if (
    reportLikeDoi
    && !conferenceLikeDoi
    && !hasLocators
    && (
      siteName.length > 0
      || journal.length > 0
      || institution.length > 0
      || publisher.length > 0
    )
  ) {
    return 'report';
  }

  if (typeof fields.journal === 'string' && fields.journal.trim().length > 0) {
    return 'article-journal';
  }

  if (typeof fields.bookTitle === 'string' && fields.bookTitle.trim().length > 0) {
    return 'book-chapter';
  }

  if (typeof fields.patent === 'string' && fields.patent.trim().length > 0) {
    return 'patent';
  }

  if (
    typeof fields.isbn === 'string'
    && fields.isbn.trim().length > 0
    && typeof fields.publisher === 'string'
    && fields.publisher.trim().length > 0
  ) {
    return 'book';
  }

  if (
    typeof fields.siteName === 'string'
    && fields.siteName.trim().length > 0
    && !(typeof fields.journal === 'string' && fields.journal.trim().length > 0)
  ) {
    return 'webpage';
  }

  if (referenceType && referenceType !== 'unknown') {
    return referenceType;
  }

  return null;
}

function citationContainsGroundedContainer(raw: string, value: string): boolean {
  const candidate = normalizeComparableText(stripIdentifierTail(stripTrailingPunctuation(value)));
  if (!candidate || candidate.length < 6) {
    return false;
  }

  const haystack = normalizeComparableText(stripIdentifierTail(normalizeExtractionInput(raw)));
  return haystack.includes(candidate);
}

function looksSwallowedConferenceTitleCandidate(
  value: string,
  titleHint?: string | null,
): boolean {
  const normalized = stripIdentifierTail(stripTrailingPunctuation(value));
  if (!normalized) {
    return true;
  }
  if (isConferencePlaceholder(normalized)) {
    return false;
  }
  if (looksConferencePublicationVenue(normalized)) {
    return false;
  }

  const comparableCandidate = normalizeComparableText(normalized);
  const comparableTitle = titleHint ? normalizeComparableText(titleHint) : '';
  const containsTitle =
    comparableTitle.length >= 8
    && (
      comparableCandidate.includes(comparableTitle)
      || comparableTitle.includes(comparableCandidate)
    );
  const commaParts = normalized
    .split(/\s*,\s*/u)
    .map((part) => stripTrailingPunctuation(part).trim())
    .filter(Boolean);
  const leadingClause = commaParts[0] ?? '';
  const trailingClause = commaParts.at(-1) ?? '';
  const titleTailSpill =
    commaParts.length >= 2
    && comparableTitle.length >= 8
    && normalizeComparableText(leadingClause).length >= 8
    && comparableTitle.includes(normalizeComparableText(leadingClause))
    && trailingClause.split(/\s+/u).filter(Boolean).length <= 6
    && (
      /["“”«»]/u.test(trailingClause)
      || looksPublisherLike(trailingClause)
      || looksInstitutionalContainer(trailingClause)
      || looksReportPublisherAcronym(trailingClause)
      || /^[\p{Lu}\d"'«»&./-]+(?:\s+[\p{Lu}\d"'«»&./-]+){0,4}$/u.test(trailingClause)
    );

  return (
    looksLowQualityContainerCandidate(normalized)
    || looksLocatorHeavyContainerSpill(normalized)
    || looksLikeAuthorSpill(normalized)
    || looksContainerInstitutionTailSpill(normalized)
    || /https?:\/\/|10\.\d{4,9}\//iu.test(normalized)
    || titleTailSpill
    || containsTitle
  );
}

function looksContainerInstitutionTailSpill(value: string): boolean {
  const normalized = stripIdentifierTail(stripTrailingPunctuation(value));
  if (!normalized || !normalized.includes(',')) {
    return false;
  }

  const parts = normalized
    .split(/\s*,\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return false;
  }

  const tail = parts.at(-1) ?? '';
  const head = parts.slice(0, -1).join(', ');

  return (
    head.split(/\s+/u).filter(Boolean).length >= 2
    && (
      looksInstitutionalContainer(tail)
      || looksPublisherLike(tail)
      || looksReportPublisherAcronym(tail)
    )
  );
}

function looksLocatorHeavyContainerSpill(value: string): boolean {
  const normalized = stripIdentifierTail(stripTrailingPunctuation(value));
  if (!normalized) {
    return false;
  }

  return (
    /\b(?:vol\.?|volume|no\.?|issue|pp?\.?)\b/iu.test(normalized)
    || /(?:^|[;,]\s*)(?:19|20)\d{2}\s*\([^)]*\)/u.test(normalized)
    || /(?:^|[;,]\s*)\d{4}\s*\([^)]*\)\s*[,;:]\s*[A-Za-z]?\d/u.test(normalized)
    || /(?:^|[;,]\s*)(?:19|20)\d{2}\s*;\s*\d+/u.test(normalized)
    || /(?:^|[;,]\s*)(?:19|20)\d{2}\s*,\s*[A-Za-z]?\d/u.test(normalized)
  );
}

function isJournalLocatorDerivative(value: string, journal: string): boolean {
  const normalizedValue = normalizeComparableText(stripIdentifierTail(stripTrailingPunctuation(value)));
  const normalizedJournal = normalizeComparableText(stripIdentifierTail(stripTrailingPunctuation(journal)));
  if (!normalizedValue || !normalizedJournal) {
    return false;
  }

  return (
    normalizedValue.startsWith(normalizedJournal)
    || normalizedValue === `${normalizedJournal} vol`
    || normalizedValue === `${normalizedJournal} no`
    || normalizedValue === `${normalizedJournal} issue`
  );
}

function isLowQualityTitleCandidate(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim();
  if (normalized.length < 3) return true;
  if (/^(?:p|pp|vol|no)$/iu.test(normalized)) return true;
  if (/^[;:.,()\[\]\d\s\-–]+$/u.test(normalized)) return true;
  return false;
}

function isBetterQuotedTitleCandidate(quotedTitle: string, parsedTitle: string): boolean {
  const normalizedQuoted = normalizeComparableText(quotedTitle);
  const normalizedParsed = normalizeComparableText(parsedTitle);
  if (!normalizedQuoted || !normalizedParsed) {
    return false;
  }
  if (!normalizedQuoted.includes(normalizedParsed)) {
    return false;
  }
  return normalizedQuoted.length >= normalizedParsed.length + 8;
}

function isPublisherTailFragment(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 4) return true;
  if (/^[A-Za-z]?\d+(?:[–-][A-Za-z]?\d+)*(?:\.[A-Za-z0-9]+)?$/u.test(normalized)) return true;
  return /^(?:kg|co|inc|ltd|llc|sa|bv|ag)$/iu.test(normalized);
}

function scorePublisherTailCandidate(publisher: string, title: string): number {
  let score = publisher.length;
  const normalizedPublisher = normalizeComparableText(publisher);
  const normalizedTitle = normalizeComparableText(title);

  if (looksPublisherLike(publisher)) score += 24;
  if (looksInstitutionalContainer(publisher)) score += 12;
  if (/\b(?:gmbh|press|publisher|publishing|springer|dial[eé]tica|de gruyter|cambridge|oxford|routledge|wiley|elsevier)\b/iu.test(publisher)) {
    score += 18;
  }
  if (normalizedTitle && normalizedPublisher.includes(normalizedTitle)) {
    score -= 20;
  }
  if (isPublisherTailFragment(publisher)) {
    score -= 40;
  }

  return score;
}

function looksLowQualityContainerCandidate(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim();
  if (isConferencePlaceholder(normalized)) return false;
  if (normalized.length < 3) return true;
  if (DOI_REGEX.test(normalized) || URL_REGEX.test(normalized)) return true;
  if (/\breview\)\.\s+\p{L}/iu.test(normalized)) return true;
  if (/^(?:available|online|retrieved|accessed)$/iu.test(normalized)) return true;
  if (/^(?:p|pp|vol|no|issue)$/iu.test(normalized)) return true;
  if (/^[;:.,()\[\]\d\s\-–]+$/u.test(normalized)) return true;
  return false;
}

function looksPublisherLike(value: string | undefined): boolean {
  if (!value) return false;
  return /\b(?:press|publishing|publisher|books?|booksellers|editions?|editores?|media|springer|palgrave|cambridge|oxford|routledge|elsevier|wiley|dial[eé]tica|avestia|gru[yü]ter|verlag|birkh[aä]user|hanser|editora|editorial|crv|apress|peter\s+lang(?:\s+\p{L}+)?|thieme|sciendo)\b/iu.test(value);
}

function isConferencePlaceholder(value: string | undefined): boolean {
  if (!value) return false;
  return /^n\/?a$/iu.test(stripIdentifierTail(stripTrailingPunctuation(value)).trim());
}

function isDoiUrl(value: string | undefined): boolean {
  if (!value) return false;
  return DOI_URL_REGEX.test(value.trim());
}

function hasPlaceholderDoiTail(value: string): boolean {
  const trimmed = value.trim();
  return (
    PLACEHOLDER_DOI_URL_REGEX.test(trimmed)
    || /(?:^|[\s(])https?:\/\/(?:dx\.)?doi\.org\/?\.?\s*$/iu.test(trimmed)
  );
}

function stripDiacriticsForIdentifier(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}+/gu, '');
}

function extractRelaxedDoi(value: string): string | null {
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
      return normalizedDoi;
    }
  }

  return null;
}

function collapseRepeatedSentenceBoundaryArtifacts(value: string): string {
  return value
    .replace(/(?<=[\p{L}\p{M}]\.)\s+\.(?=\s*["“”'‘’]?\p{L})/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

const OCR_DIGIT_FOLD: Record<string, string> = { o: '0', l: '1', i: '1', j: '1', s: '5', b: '8', z: '2' };
function foldOcrDigits(value: string): string {
  return value.replace(/[a-z]/gi, (c) => OCR_DIGIT_FOLD[c.toLowerCase()] ?? c);
}

// A locator that should be a number but reads as pure digit look-alikes (an OCR'd "1" as "l",
// "0" as "o") is folded back to the number. Anything containing a real digit is trusted as-is,
// so genuine alphanumeric issues ("S1", "3a") are never mangled.
function foldIssueIfOcr(value: string): string {
  if (/\d/.test(value)) return value;
  const folded = foldOcrDigits(value);
  return /^\d+$/.test(folded) ? folded : value;
}

// Issue number from an explicit "no."/"issue"/"iss." marker anywhere in the venue text.
// Handles "vol. X, no. Y, year, pages" (the without-pages regex anchors to end-of-string and
// misses it) and OCR'd digits ("no. l" -> "1"). Refuses ambiguous alphanumerics.
function extractExplicitIssue(text: string): string | null {
  const num = text.match(/\b(?:nos?|issue|iss|number)\.?\s*(\d{1,4}[a-z]?)\b/i);
  if (num?.[1]) return num[1];
  // "VOL(ISS)" parenthetical, e.g. "2011(3)" -> issue 3. Reject a bare year-in-parens
  // ("3 (2004)") so the year is never mistaken for the issue.
  const paren = text.match(/\b\d{1,4}\s*\((\d{1,4}[a-z]?)\)/);
  if (paren?.[1] && !/^(?:1[6-9]|20)\d{2}$/.test(paren[1])) return paren[1];
  const ocr = text.match(/\bno\.\s*([olisbzj]{1,4})\b/i);
  if (ocr?.[1]) {
    const folded = foldOcrDigits(ocr[1]);
    if (/^\d+$/.test(folded)) return folded;
  }
  return null;
}

function venueTextForExplicitIssue(carrier: ReferenceCarrier): string {
  let text = normalizeExtractionInput(carrier.raw);
  const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : '';
  if (title.length > 8) {
    const idx = text.indexOf(title);
    if (idx >= 0) text = text.slice(idx + title.length); // restrict to the venue/locator tail
  }
  return text;
}

// Post-selection issue reconcile: runs AFTER candidate selection so it cannot perturb which
// candidate wins (filling an issue during candidate-building tipped scoring toward worse
// title/author splits). The explicit "no. N"/"VOL(ISS)" marker is authoritative when the issue
// is missing, year-like, or a duplicate of the volume; a clean issue is never overridden.
// The number sitting before an explicit issue marker ("2004, no. 3" / "vol. 36 no. 4") — the
// true volume when the parser swapped volume and issue.
function extractVolumeBeforeIssueMarker(venue: string): string | null {
  const m = venue.match(/\b(?:vol\.?\s*)?(\d{1,4})\s*[,;]?\s*(?:nos?|issue|iss)\.?\s+\d/i);
  return m?.[1] ?? null;
}

function reconcileExplicitIssue(carrier: ReferenceCarrier): void {
  const volume = typeof carrier.fields.volume.value === 'string' ? carrier.fields.volume.value : '';
  if (!volume && !hasFieldValue(carrier.fields.journal)) return; // journal-locator context only
  const currentIssue = typeof carrier.fields.issue.value === 'string' ? carrier.fields.issue.value : '';
  // Act only when the issue looks wrong: missing, a year swallowed as the issue (the "(2004)"
  // in "no. 3 (2004)"), or a duplicate of the volume.
  if (currentIssue && !isYearLikeLocatorValue(currentIssue) && currentIssue !== volume) return;
  const venue = venueTextForExplicitIssue(carrier);
  const explicitIssue = extractExplicitIssue(venue);
  if (!explicitIssue || explicitIssue === currentIssue) return;
  // Volume/issue swap recovery: the parser put the issue value in `volume` and the year in
  // `issue` ("2004, no. 3 (2004)" -> volume=3, issue=2004). Recover the real volume (the number
  // before the issue marker) first; if it can't be recovered, leave the locator untouched.
  if (volume && explicitIssue === volume) {
    const realVolume = extractVolumeBeforeIssueMarker(venue);
    if (!realVolume || realVolume === explicitIssue) return;
    setExtractedField(
      carrier.fields,
      'volume',
      fieldOf(realVolume, 'regex_fallback' as FieldSource, STAGE_ID, 0.78) as ExtractedFields['volume'],
    );
  }
  setExtractedField(
    carrier.fields,
    'issue',
    fieldOf(explicitIssue, 'regex_fallback' as FieldSource, STAGE_ID, 0.78) as ExtractedFields['issue'],
  );
}

function normalizePages(value: string): string {
  // The extracted field holds the page range as canonical DATA — ASCII hyphen,
  // full numbers. Presentation (en-dash for APA/MLA/Chicago/etc., hyphen for
  // Vancouver) is the renderer's job (see formatPageRange in phase12Render), not
  // the extractor's. Storing the typographic en-dash here leaked presentation into
  // the field and made it mismatch the (hyphenated) gold on every range.
  const trimmed = value.replace(/[–—]/g, '-').replace(/-{2,}/g, '-').trim();
  if (/[A-Za-zIVXLCDM]/u.test(trimmed) && /-.*-/u.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\s*-\s*/g, '-').trim();
  const numericMatch = normalized.match(/^(?<start>\d+)-(?<end>\d+)$/u);
  const g = numericMatch?.groups;
  if (!g) {
    return normalized;
  }

  const start = g.start;
  const end = g.end;
  if (start === undefined || end === undefined) {
    return normalized;
  }
  if (end.length >= start.length) {
    return `${start}-${end}`;
  }

  const prefix = start.slice(0, start.length - end.length);
  const expandedEnd = `${prefix}${end}`;
  return `${start}-${expandedEnd}`;
}

function inferIsbnFromIdentifier(value: string): string | null {
  const normalizedValue = normalizeDoi(value) ?? value.trim();
  const chapterMatches = [
    ...normalizedValue.matchAll(/(?:^|\/)(97[89](?:[- ]?\d){10,16})(?:_[A-Za-z0-9.-]+)(?=$|[^A-Za-z0-9])/gi),
    ...normalizedValue.matchAll(/(?:^|\/)b(97[89](?:[- ]?\d){10,16})(?:\.[A-Za-z0-9.-]+)(?=$|[^A-Za-z0-9])/gi),
    ...normalizedValue.matchAll(/(?:^|\/)(97[89](?:[- ]?\d){10,16})(?:\.\d{2,4})(?=$|[^A-Za-z0-9])/gi),
    ...normalizedValue.matchAll(/(?:^|\/)(97[89]\d{10,13})(?=\.\d{2,4}(?:$|[^A-Za-z0-9]))/gi),
    ...normalizedValue.matchAll(/(?:^|\/)(97[89](?:[- ]?\d){10,16})-(?:[A-Za-z0-9]{1,8})(?=$|[^A-Za-z0-9])/gi),
    ...normalizedValue.matchAll(/(?:^|\/)(97[89](?:[- ]?\d){9,15}\.\d)(?=$|[^A-Za-z0-9])/gi),
  ];
  for (const match of chapterMatches) {
    const candidate = match[1] ?? match[0];
    const isbn = normalizeIsbn(candidate);
    if (isbn) return isbn;
  }

  const structuredMatches = [
    ...normalizedValue.matchAll(/(?:^|\/)(97[89](?:[- ]?\d){10,16})(?=$|[^A-Za-z0-9])/gi),
    ...normalizedValue.matchAll(/(?:^|\/)[A-Za-z]{2,4}(97[89]\d{10,13})(?=$|[^A-Za-z0-9])/g),
  ];
  for (const match of structuredMatches) {
    const candidate = match[1] ?? match[0];
    const isbn = normalizeIsbn(candidate.replace(/_[A-Za-z0-9]+$/u, '').replace(/[./_-]+/g, ''));
    if (isbn) return isbn;
  }
  return null;
}

function inferPreferredIsbnFromIdentifier(
  value: string,
  options: { publisher?: string | null; bookTitle?: string | null; raw?: string | null } = {},
): string | null {
  // PDF copy/paste wraps the DOI mid-slug ("...1812-\n-2_5" -> "...1812--2_5"),
  // leaving a doubled hyphen that defeats the ISBN-slug regexes. The embedded ISBN
  // grammar never has adjacent hyphens, so collapsing runs here is safe and only
  // affects ISBN inference (not the emitted DOI).
  const normalizedValue = (normalizeDoi(value) ?? value.trim()).replace(/-{2,}/g, '-');
  const springerPrintChapterIsbn = extractSpringerPrintChapterIsbn(normalizedValue);
  if (springerPrintChapterIsbn) {
    return springerPrintChapterIsbn;
  }

  const springerElectronicIsbn = extractSpringerElectronicChapterIsbn(normalizedValue);
  if (springerElectronicIsbn) {
    return springerElectronicIsbn;
  }

  const legacySpringerElectronicIsbn = extractLegacySpringerElectronicChapterIsbn(normalizedValue);
  if (legacySpringerElectronicIsbn) {
    return legacySpringerElectronicIsbn;
  }

  const inferredIsbn = inferIsbnFromIdentifier(normalizedValue);
  if (
    inferredIsbn
    && /^10\.1007\//iu.test(normalizedValue)
    && !looksBookChapterDoi(normalizedValue)
    && shouldPreferSpringerPrintIsbn(options)
    && !shouldKeepSpringerElectronicBookIsbn(normalizedValue)
  ) {
    const printIsbn = inferSpringerPrintIsbnFromElectronicIdentifier(inferredIsbn);
    if (printIsbn) {
      return printIsbn;
    }
  }

  return inferredIsbn;
}

function extractSpringerPrintChapterIsbn(value: string): string | null {
  if (!/^10\.1007\//iu.test(value)) {
    return null;
  }

  const chapterMatches = [
    ...value.matchAll(/(?:^|\/)(97[89](?:[- ]?\d){10,16})(?:_\d{1,4}(?=$|[^A-Za-z0-9-])|\.\d{2,4}(?=$|[^A-Za-z0-9]))/gi),
  ];

  for (const match of chapterMatches) {
    const candidate = match[1] ?? match[0];
    const electronicIsbn = normalizeIsbn(candidate);
    if (!electronicIsbn) continue;

    const printIsbn = inferSpringerPrintIsbnFromElectronicIdentifier(electronicIsbn);
    if (printIsbn) {
      return printIsbn;
    }
  }

  return null;
}

function convertIsbn10IdentifierToIsbn13(value: string): string | null {
  const normalized = normalizeIsbn(value);
  if (!normalized) return null;
  if (normalized.length === 13) return normalized;
  if (normalized.length !== 10) return null;

  const body = `978${normalized.slice(0, 9)}`;
  return buildIsbn13FromBody(body);
}

function inferSpringerPrintIsbnFromElectronicIdentifier(value: string): string | null {
  const normalized = normalizeIsbn(value);
  if (!normalized || normalized.length !== 13) return null;

  const body = normalized.slice(0, 12);
  if (!/^\d{12}$/u.test(body)) {
    return null;
  }

  const decrementedBody = (BigInt(body) - 1n).toString().padStart(12, '0');
  return buildIsbn13FromBody(decrementedBody);
}

function extractSpringerElectronicChapterIsbn(value: string): string | null {
  if (!/^10\.1007\//iu.test(value)) {
    return null;
  }

  const chapterMatches = [
    ...value.matchAll(/(?:^|\/)(97[89](?:[- ]?\d){10,16})_(?:\d{1,4})(?=$|[^A-Za-z0-9-])/gi),
  ];

  for (const match of chapterMatches) {
    const candidate = match[1] ?? match[0];
    const isbn = normalizeIsbn(candidate);
    if (isbn) return isbn;
  }

  return null;
}

function extractLegacySpringerElectronicChapterIsbn(value: string): string | null {
  if (!/^10\.1007\//iu.test(value)) {
    return null;
  }

  const underscoreMatch = value.match(/(?:^|\/)(?<identifier>[0-9Xx-]{10,20})_(?:\d{1,4})(?=$|[^A-Za-z0-9])/iu);
  const dottedMatch = value.match(/(?:^|\/)(?<identifier>[0-9Xx-]{10,20})(?:\.\d{2,4})(?=$|[^A-Za-z0-9])/iu);
  const candidates = [
    underscoreMatch?.groups?.identifier,
    dottedMatch?.groups?.identifier,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const electronicIsbn = convertIsbn10IdentifierToIsbn13(candidate);
    if (electronicIsbn) return electronicIsbn;
  }

  return null;
}

function shouldPreferSpringerPrintIsbn(
  options: { publisher?: string | null; bookTitle?: string | null; raw?: string | null },
): boolean {
  const publisher = options.publisher ?? '';
  const raw = options.raw ?? '';
  const bookTitle = options.bookTitle ?? '';
  const normalizedPublisher = normalizeConferenceTitle(publisher);

  // Apress is a Springer Nature imprint: its book DOIs use the 10.1007 prefix and
  // register the print ISBN as primary, but the slug embeds the electronic ISBN.
  // Recognize it so the print-ISBN preference applies (electronic-1 holds for Apress).
  if (!/\b(?:springer|apress|bohn stafleu van loghum)\b/iu.test(`${publisher} ${raw}`)) {
    // OCR-tolerant fallback: on degraded input the publisher name itself is mangled
    // ("Sprinqer", "Springcr") so the literal regex misses. Fold confusables and
    // retry against the publisher, which is where this imprint signal lives.
    if (!foldedTextHasSpringerImprint(publisher)) {
      return false;
    }
    return !/\bmonographs?\b/iu.test(bookTitle);
  }

  if (!normalizedPublisher) {
    return /\b(?:springer(?: international publishing| us| fachmedien wiesbaden| berlin heidelberg| new york)|bohn stafleu van loghum)\b/iu.test(raw);
  }

  if (
    /\b(?:springer (?:international publishing|us|fachmedien wiesbaden|berlin heidelberg|new york)|bohn stafleu van loghum)\b/iu.test(normalizedPublisher)
  ) {
    return true;
  }

  return (
    /\b(?:springer|apress)\b/iu.test(normalizedPublisher)
    && !/\bmonographs?\b/iu.test(bookTitle)
  );
}

// OCR confusables ("Sprinqer", "Springcr", "Aprcss") fold to the same key as the
// clean imprint name, so we can recover the print-ISBN signal from degraded input
// without un-mangling display text. Distinct publishers (Palgrave, Elsevier, Wiley)
// fold to different keys and are unaffected.
const SPRINGER_OCR_FOLD_KEYS: ReadonlyArray<string> = [
  ocrFoldKey('springer'),
  ocrFoldKey('apress'),
];

function foldedTextHasSpringerImprint(text: string): boolean {
  if (!text.trim()) return false;
  const folded = ocrFoldKey(text);
  return SPRINGER_OCR_FOLD_KEYS.some((key) => key.length > 0 && folded.includes(key));
}

function shouldKeepSpringerElectronicBookIsbn(value: string): boolean {
  const normalizedValue = normalizeDoi(value) ?? value.trim().toLowerCase();
  return SPRINGER_ELECTRONIC_BOOK_ISBN_DOI_EXCEPTIONS.has(normalizedValue);
}

const SPRINGER_ELECTRONIC_BOOK_ISBN_DOI_EXCEPTIONS = new Set<string>([
  '10.1007/978-3-031-01510-6',
  '10.1007/978-981-19-6109-0',
]);

function buildIsbn13FromBody(body: string): string | null {
  if (!/^\d{12}$/u.test(body)) return null;

  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }

  const checksum = (10 - (sum % 10)) % 10;
  return normalizeIsbn(`${body}${checksum}`);
}

function extractTailAfterTitle(raw: string, title: string): string | null {
  return extractTailAfterTitleCached(composeCacheKey(raw, title));
}

const extractTailAfterTitleCached = createBoundedValueCache<string | null>(
  TAIL_AFTER_TITLE_CACHE_LIMIT,
  (cacheKey) => {
    const [raw = '', title = ''] = cacheKey.split('\u0000');
    const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
    const normalizedTitle = stripTrailingPunctuation(normalizeExtractionInput(title))
      .replace(/^["“”'‘’\s]+/u, '')
      .replace(/["“”'‘’\s]+$/u, '')
      .trim();

    if (!normalizedTitle) {
      return null;
    }

    const tailIndex = parseableRaw.toLocaleLowerCase().lastIndexOf(normalizedTitle.toLocaleLowerCase());
    if (tailIndex < 0) {
      return null;
    }

    const tail = parseableRaw
      .slice(tailIndex + normalizedTitle.length)
      .replace(/^[\s"'“”'‘’.,;:]+/u, '')
      .trim();

    return tail || null;
  },
);

function recoverArticleLocatorAfterTitle(
  raw: string,
  title: string,
): { titleSuffix: string | null; journal: string; volume: string | null; issue: string | null; pages: string | null } | null {
  const tail = extractTailAfterTitle(raw, title);
  if (!tail) {
    return null;
  }

  let working = tail
    .replace(/[“”]/gu, '"')
    .replace(/\b(?:available at|retrieved from)\b.+$/iu, '')
    .replace(/[;,]?\s*doi:\s*\.?$/iu, '')
    .replace(/[;,]?\s*https?:\/\/(?:dx\.)?doi\.org\/\.?$/iu, '')
    .replace(/[.,;:\s]+$/u, '')
    .trim();
  if (!working) {
    return null;
  }

  let titleSuffix: string | null = null;
  const editionLeadMatch = working.match(
    /^(?<suffix>\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?)\s+(?<rest>.+)$/iu,
  );
  if (editionLeadMatch?.groups?.rest) {
    const recoveredSuffix = editionLeadMatch.groups.suffix?.trim() ?? '';
    titleSuffix = stripTrailingPunctuation(recoveredSuffix).trim() || null;
    working = editionLeadMatch.groups.rest.trim();
  }

  const directLocator = recoverJournalFromContainerLocator(working);
  if (directLocator) {
    const suspiciousYearOnlyLocator =
      isYearLikeLocatorValue(directLocator.volume)
      && !directLocator.issue
      && !directLocator.pages
      && !looksJournalLikeContainer(directLocator.journal)
      && !lookupIssnByJournalTitle(directLocator.journal);
    if (looksPublisherYearOnlyLocator(directLocator.journal, directLocator.volume, directLocator.issue) || suspiciousYearOnlyLocator) {
      return null;
    }
    return {
      titleSuffix,
      journal: directLocator.journal,
      volume: directLocator.volume,
      issue: directLocator.issue,
      pages: directLocator.pages,
    };
  }

  const labeledLocator = working.match(
    /^(?<journal>.+?),\s*vol\.?\s*(?<volume>\d+)(?:,\s*no\.?\s*(?<issue>[^,.;]+))?(?:[,;:]\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
  );
  if (labeledLocator?.groups?.journal) {
    const journal = normalizeJournalCandidate(labeledLocator.groups.journal, title);
    if (
      journal
      && !looksPublisherYearOnlyLocator(journal, labeledLocator.groups.volume?.trim() ?? null, labeledLocator.groups.issue?.trim() ?? null)
    ) {
      return {
        titleSuffix,
        journal,
        volume: labeledLocator.groups.volume?.trim() ?? null,
        issue: labeledLocator.groups.issue?.trim() ?? null,
        pages: labeledLocator.groups.pages ? normalizePages(labeledLocator.groups.pages) : null,
      };
    }
  }

  const semicolonLocator = working.match(
    /^(?<journal>.+?)\s+(?<year>(?:19|20)\d{2});(?<volume>\d+)(?:\((?<issue>[^)]+)\))?:(?<pages>[A-Za-z]?\d[\w\-–]*)$/iu,
  );
  if (semicolonLocator?.groups?.journal) {
    const journal = normalizeJournalCandidate(semicolonLocator.groups.journal, title);
    if (journal) {
      return {
        titleSuffix,
        journal,
        volume: semicolonLocator.groups.volume?.trim() ?? null,
        issue: semicolonLocator.groups.issue?.trim() ?? null,
        pages: semicolonLocator.groups.pages ? normalizePages(semicolonLocator.groups.pages) : null,
      };
    }
  }

  const semicolonLabeledLocator = working.match(
    /^(?<journal>.+?)\s*[;,]\s*vol\.?\s*(?<volume>\d+)(?:\s*[;,]\s*no\.?\s*(?<issue>[^;,.]+))?(?:\s*[;,]\s*p{1,2}\.?\s*(?<pages>[A-Za-z]?\d[\w\-–]*))?(?:\s*[;,]\s*(?<year>(?:19|20)\d{2}))?$/iu,
  );
  if (semicolonLabeledLocator?.groups?.journal) {
    const journal = normalizeJournalCandidate(semicolonLabeledLocator.groups.journal, title);
    if (
      journal
      && !looksPublisherYearOnlyLocator(journal, semicolonLabeledLocator.groups.volume?.trim() ?? null, semicolonLabeledLocator.groups.issue?.trim() ?? null)
    ) {
      return {
        titleSuffix,
        journal,
        volume: semicolonLabeledLocator.groups.volume?.trim() ?? null,
        issue: semicolonLabeledLocator.groups.issue?.trim() ?? null,
        pages: semicolonLabeledLocator.groups.pages
          ? normalizePages(semicolonLabeledLocator.groups.pages)
          : null,
      };
    }
  }

  return null;
}

function recoverArticleLocatorFromEmbeddedTitle(
  value: string,
): { title: string; journal: string; volume: string | null; issue: string | null; pages: string | null } | null {
  const normalized = normalizeExtractionInput(value);
  const patterns = [
    /^(?<title>.+?)\.\s+(?<journal>.+?),\s*(?:vol\.?\s*)?(?<volume>\d+)(?:\s*\((?<issue>[^)]+)\)|,\s*no\.?\s*(?<issueWord>[^,.]+))?(?:[,;:]\s*(?:pp?\.\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu,
    /^(?<title>.+?)[,.;]\s+(?<journal>.+?)[;,]\s*(?<volume>\d+)\((?<issue>[^)]+)\)(?:[,:;\s]+(?:pp?\.\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu,
    /^(?<title>.+?)\.\s+(?<journal>.+?),\s*\((?<issue>[^)]+)\),\s*(?:pp?\.\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*)\.?$/iu,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.groups?.title || !match.groups.journal) {
      continue;
    }
    const recoveredTitle = normalizeTitleCandidate(match.groups.title);
    const recoveredJournal = normalizeJournalCandidate(match.groups.journal, match.groups.title);
    if (!recoveredTitle || !recoveredJournal) {
      continue;
    }

    return {
      title: recoveredTitle,
      journal: recoveredJournal,
      volume: match.groups.volume?.trim() ?? null,
      issue: match.groups.issue?.trim() ?? match.groups.issueWord?.trim() ?? null,
      pages: match.groups.pages ? normalizePages(match.groups.pages) : null,
    };
  }

  return null;
}

function shouldClearArticleSpillContainer(
  value: string | null | undefined,
  journal: string,
): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = normalizeConferenceTitle(value);
  const normalizedJournal = normalizeConferenceTitle(journal);
  if (!normalizedValue || !normalizedJournal) {
    return false;
  }

  const comparableValue = normalizeComparableText(normalizedValue);
  const comparableJournal = normalizeComparableText(normalizedJournal);
  if (!comparableValue || !comparableJournal) {
    return false;
  }

  if (comparableValue === comparableJournal) {
    return true;
  }

  if (looksLocatorHeavyContainerSpill(normalizedValue) && comparableValue.includes(comparableJournal)) {
    return true;
  }

  const recoveredConferenceStyledJournal = recoverJournalFromConferenceStyledContainer(normalizedValue);
  return recoveredConferenceStyledJournal != null
    && normalizeComparableText(recoveredConferenceStyledJournal.journal) === comparableJournal;
}

function recoverLabeledArticleLocatorFromRaw(
  raw: string,
): { journal: string; volume: string | null; issue: string | null; pages: string | null } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const locatorMatch = parseableRaw.match(
    /,\s*vol\.?\s*(?<volume>\d+)(?:,\s*no(?:s?)?\.?\s*(?<issue>[^,.;]+))?(?:,\s*(?<year>(?:19|20)\d{2}))?(?:,\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?$/iu,
  );
  if (!locatorMatch?.groups?.volume || locatorMatch.index == null) {
    return null;
  }

  const lead = parseableRaw.slice(0, locatorMatch.index).trim();
  const quotedLeadJournal = lead.match(/(?:["”']\s*|\]\s*|[.?!]\s+)(?<journal>[^.?!]+)$/u)?.groups?.journal;
  const rawJournal = stripTrailingPunctuation(
    (quotedLeadJournal ?? getLastClause(lead))
      .replace(/^[\]\)"'“”‘’.,;:\s]+/u, '')
      .replace(/,\s*vol\.?\s*\d+.*$/iu, ''),
  ).trim();
  const journal =
    normalizeJournalCandidate(rawJournal)
    ?? normalizeConferenceTitle(rawJournal);
  if (
    !journal
    || looksLowQualityContainerCandidate(journal)
    || /^vol\.?\s*\d+/iu.test(journal)
    || /^no\.?\s*[^,]+/iu.test(journal)
    || looksConferencePublicationVenue(journal)
  ) {
    return null;
  }

  return {
    journal,
    volume: locatorMatch.groups.volume?.trim() ?? null,
    issue: locatorMatch.groups.issue?.trim() ?? null,
    pages: locatorMatch.groups.pages ? normalizePages(locatorMatch.groups.pages) : null,
  };
}

function recoverAuthorDateWordLocatorArticleFromRaw(
  raw: string,
): { title: string; journal: string; volume: string; issue: string | null } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const match = parseableRaw.match(
    /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>.+?),\s*vol\.?\s*(?<volume>\d+)(?:,\s*no(?:s?)?\.?\s*(?<issue>[^,.;]+))?\.?$/iu,
  );
  if (!match?.groups?.title || !match.groups.journal || !match.groups.volume) {
    return null;
  }

  const title = normalizeTitleCandidate(match.groups.title);
  const rawJournal = stripTrailingPunctuation(match.groups.journal).trim();
  const journal =
    normalizeJournalCandidate(match.groups.journal, title ?? undefined)
    ?? (rawJournal && !looksConferencePublicationVenue(rawJournal) ? rawJournal : null);
  if (!title || !journal || looksConferencePublicationVenue(journal)) {
    return null;
  }

  return {
    title,
    journal,
    volume: match.groups.volume.trim(),
    issue: match.groups.issue?.trim() ?? null,
  };
}

function recoverLiteralAuthorDateWordLocatorArticleFromRaw(
  raw: string,
): { title: string; journal: string; volume: string; issue: string | null } | null {
  const normalizedRaw = normalizeExtractionInput(raw);
  const match = normalizedRaw.match(
    /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<journal>.+?),\s*vol\.?\s*(?<volume>\d+)(?:,\s*no(?:s?)?\.?\s*(?<issue>[^,.;]+))?\.?$/iu,
  );
  if (!match?.groups?.title || !match.groups.journal || !match.groups.volume) {
    return null;
  }

  const title = normalizeTitleCandidate(match.groups.title) ?? stripTrailingPunctuation(match.groups.title).trim();
  const journal = stripTrailingPunctuation(match.groups.journal).trim();
  if (!title || !journal || looksConferencePublicationVenue(journal)) {
    return null;
  }

  return {
    title,
    journal,
    volume: match.groups.volume.trim(),
    issue: match.groups.issue?.trim() ?? null,
  };
}

function recoverFlexibleSemicolonArticleFromRawDirect(
  raw: string,
): { authorSegment: string; title: string; journal: string; volume: string; issue: string | null; pages: string | null } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const match = parseableRaw.match(
    /^(?<lead>.+)\.\s*(?<journal>.+?)\s+(?<year>(?:19|20)\d{2})(?:\s+[A-Za-z]{3}\s+\d+)?;(?<volume>\d+)(?:\((?<issue>[^)]+)\))?(?::(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu,
  );
  if (!match?.groups?.lead || !match.groups.journal || !match.groups.volume) {
    return null;
  }

  const journal =
    normalizeJournalCandidate(match.groups.journal)
    ?? stripTrailingPunctuation(match.groups.journal).trim();
  if (!journal || looksConferencePublicationVenue(journal)) {
    return null;
  }

  const periodIndexes = [...match.groups.lead.matchAll(/\.\s+/gu)]
    .map((candidate) => candidate.index ?? -1)
    .filter((candidate) => candidate > 0)
    .sort((left, right) => right - left);

  for (const periodIndex of periodIndexes) {
    const authorSegment = match.groups.lead.slice(0, periodIndex + 1).trim();
    const title = stripTrailingPunctuation(match.groups.lead.slice(periodIndex + 2).trim())
      .replace(/^[,;:\s]+/u, '')
      .replace(/^(?:and|&)\s+/iu, '')
      .trim();
    const parsedAuthors = parseAuthorSegment(authorSegment);
    if (
      parsedAuthors.length >= 2
      && title.split(/\s+/u).filter(Boolean).length >= 5
      && !looksLikeAuthorSpill(title)
      && !looksLikeLeadingAuthorSequence(title)
    ) {
      return {
        authorSegment,
        title,
        journal,
        volume: match.groups.volume.trim(),
        issue: match.groups.issue?.trim() ?? null,
        pages: match.groups.pages ? normalizePages(match.groups.pages) : null,
      };
    }
  }

  return null;
}

function parseExplicitLeadAuthors(authorSegment: string): CanonicalAuthor[] {
  const parsedAuthors = parseAuthorSegment(authorSegment);
  if (parsedAuthors.length >= 2) {
    return parsedAuthors;
  }

  const explicitParts = authorSegment
    .replace(/\s*,?\s*(?:and|&)\s+/giu, ';')
    .split(/\s*;\s*/u)
    .map((part) => stripTrailingPunctuation(part).trim())
    .filter(Boolean);
  if (explicitParts.length < 2) {
    return parsedAuthors;
  }

  const explicitAuthors = explicitParts
    .map((part) => parseSingleAuthor(part))
    .filter((author) => !author.isCorporate && Boolean(author.family));
  return explicitAuthors.length === explicitParts.length ? explicitAuthors : parsedAuthors;
}

function recoverNumericEnumeratedBookLeadFromRawDirect(
  raw: string,
): { authorSegment: string; title: string; publisher: string; year: number } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  if (!/^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/u.test(parseableRaw)) {
    return null;
  }

  const yearMatch = [...parseableRaw.matchAll(/\b((?:1[6-9]|20)\d{2})\b/gu)].at(-1);
  const yearIndex = yearMatch?.index ?? -1;
  const year = Number(yearMatch?.[1] ?? '');
  if (yearIndex < 0 || !Number.isFinite(year)) {
    return null;
  }

  const beforeYear = parseableRaw.slice(0, yearIndex).replace(/[;,.\s]+$/u, '').trim();
  const publisherBreak = beforeYear.lastIndexOf('. ');
  if (publisherBreak < 0) {
    return null;
  }

  const lead = beforeYear
    .slice(0, publisherBreak)
    .replace(/^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/u, '')
    .trim();
  const publisherCandidate = stripTrailingPunctuation(beforeYear.slice(publisherBreak + 2).trim());
  const publisher = normalizePublisherCandidate(publisherCandidate, lead);
  if (!publisher || isPublisherTailFragment(publisher)) {
    return null;
  }

  const commaIndexes = [...lead.matchAll(/,\s+/gu)]
    .map((candidate) => candidate.index ?? -1)
    .filter((candidate) => candidate > 0)
    .sort((left, right) => right - left);

  for (const commaIndex of commaIndexes) {
    const authorSegment = lead.slice(0, commaIndex).trim().replace(/[,;\s]+$/u, '');
    const title = stripTrailingPunctuation(lead.slice(commaIndex + 1).trim())
      .replace(/^(?:and|&)\s+/iu, '')
      .trim();
    const parsedAuthors = parseExplicitLeadAuthors(authorSegment);
    if (
      parsedAuthors.length >= 2
      && title.split(/\s+/u).filter(Boolean).length >= 5
      && !looksLikeAuthorSpill(title)
      && !looksLikeLeadingAuthorSequence(title)
    ) {
      return {
        authorSegment,
        title,
        publisher,
        year,
      };
    }
  }

  return null;
}

function recoverUppercaseTwoAuthorBookLeadFromRaw(
  raw: string,
): { authors: CanonicalAuthor[]; title: string; publisher: string; year: number } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const match = parseableRaw.match(
    /^(?:\[\d+\]|\(\d+\)|\d+[.)])\s*(?<author1>(?:[\p{Lu}]\.\s*){1,4}[\p{Lu}][\p{Lu}'’-]+)\s*,\s*(?:and|&)\s*(?<author2>(?:[\p{Lu}]\.\s*){1,4}[\p{Lu}][\p{Lu}'’\-\s]+?)\s*,\s*(?<title>.+?)\.\s*(?<publisher>[^,;]+)[,;]\s*(?<year>(?:1[6-9]|20)\d{2})\.?$/u,
  );
  if (!match?.groups?.author1 || !match.groups.author2 || !match.groups.title || !match.groups.publisher || !match.groups.year) {
    return null;
  }

  const authors = [
    parseSingleAuthor(stripTrailingPunctuation(match.groups.author1).trim()),
    parseSingleAuthor(stripTrailingPunctuation(match.groups.author2).trim()),
  ].filter((author) => !author.isCorporate && Boolean(author.family));
  const title = normalizeTitleCandidate(match.groups.title);
  const publisher = normalizePublisherCandidate(match.groups.publisher, title ?? undefined);
  const year = toYear(match.groups.year);
  if (authors.length !== 2 || !title || !publisher || year == null) {
    return null;
  }

  return { authors, title, publisher, year };
}

function recoverBareVolumeIssueArticleFromRaw(
  raw: string,
): { title: string; journal: string; volume: string; issue: string | null; pages: string | null } | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const match = parseableRaw.match(
    /^(?<authors>.+?)\.\s*[“"](?<title>.+?)(?:[.?!])?[”"]\.?\s+(?<journal>.+?)\s+(?<volume>\d{1,4}),\s*no\.?\s*(?<issue>[^:,(;]+)(?:\s*[:;,]\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*))?\.?$/iu,
  );
  if (!match?.groups?.title || !match.groups.journal || !match.groups.volume || !match.groups.issue) {
    return null;
  }

  const title = normalizeTitleCandidate(match.groups.title);
  const journal = normalizeJournalCandidate(match.groups.journal, title ?? undefined);
  if (!title || !journal || looksConferencePublicationVenue(journal)) {
    return null;
  }

  return {
    title,
    journal,
    volume: match.groups.volume.trim(),
    issue: match.groups.issue.trim(),
    pages: match.groups.pages ? normalizePages(match.groups.pages) : null,
  };
}

function recoverReviewTitleContinuationFromRaw(
  raw: string,
  title: string,
  journal: string,
): string | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const normalizedTitle = normalizeExtractionInput(stripTrailingPunctuation(title)).trim();
  const normalizedJournal = normalizeExtractionInput(stripTrailingPunctuation(journal)).trim();
  if (!normalizedTitle || !normalizedJournal) {
    return null;
  }

  const match = parseableRaw.match(
    new RegExp(
      `${escapeRegex(normalizedTitle)},\\s*(?<continuation>.+?\\(review\\))\\.\\s+${escapeRegex(normalizedJournal)}(?:\\.|$)`,
      'iu',
    ),
  );
  const continuation = match?.groups?.continuation
    ? stripTrailingPunctuation(match.groups.continuation)
    : null;
  if (!continuation) {
    return null;
  }

  return normalizeTitleCandidate(`${stripTrailingPunctuation(title)}, ${continuation}`);
}

function recoverConferenceContainerAfterTitle(raw: string, title: string): string | null {
  const tail = extractTailAfterTitle(raw, title);
  if (!tail) {
    return null;
  }

  const working = stripIdentifierTail(stripTrailingPunctuation(tail))
    .replace(/^[,.;:\s]+/u, '')
    .trim();
  if (!working) {
    return null;
  }

  const containerMatch = working.match(
    /^(?<container>[^,.;]{2,180}?)(?=(?:[,;]\s*(?:pp?\.\s*[A-Za-z]?\d|(?:19|20)\d{2}\b)|\.\s*(?:19|20)\d{2}\b|$))/iu,
  );
  const matchedCandidate = normalizeConferenceTitle(containerMatch?.groups?.container ?? working);
  const fullCandidate = normalizeConferenceTitle(working);
  const candidate =
    fullCandidate
    && shouldPreserveConferenceTemporalTail(working)
    && !looksLocatorHeavyContainerSpill(fullCandidate)
      ? fullCandidate
      : matchedCandidate;
  if (!candidate) {
    return null;
  }
  if (looksLowQualityContainerCandidate(candidate) || recoverJournalFromContainerLocator(candidate)) {
    return null;
  }
  if (normalizeComparableText(candidate) === normalizeComparableText(title)) {
    return null;
  }

  return candidate;
}

function recoverTitleOverflowBeforeContainer(raw: string, title: string, container: string): string | null {
  const normalizedTitle = normalizeExtractionInput(stripTrailingPunctuation(title)).trim();
  const normalizedContainer = normalizeExtractionInput(stripTrailingPunctuation(container)).trim();
  if (!normalizedTitle || !normalizedContainer) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const overflowMatch = parseableRaw.match(
    new RegExp(
      `${escapeRegex(normalizedTitle)}(?<overflow>.+?)\\.\\s+${escapeRegex(normalizedContainer)}(?=(?:[,;:]\\s*(?:vol\\.?|volume|no\\.?|issue|pp?\\.?|\\d{4}\\b|[A-Za-z]?\\d)|\\s+https?:\\/\\/|\\s+doi:|\\s+10\\.|$))`,
      'iu',
    ),
  );
  const overflow = overflowMatch?.groups?.overflow
    ? normalizeExtractionInput(overflowMatch.groups.overflow)
    : null;
  if (
    !overflow
    || overflow.trim().length < 4
    || /^[,.;:\s]+$/u.test(overflow)
    || looksConferenceContainer(overflow)
    || looksJournalLikeContainer(overflow)
    || looksPublisherLike(overflow)
  ) {
    return null;
  }

  return stripTrailingPunctuation(`${normalizedTitle}${overflow}`).trim();
}

function recoverDecimalTitleOverflowFromRaw(
  raw: string,
  title: string,
): { title: string; overflow: string; tail: string | null } | null {
  const normalizedTitle = normalizeExtractionInput(stripTrailingPunctuation(title)).trim();
  if (!normalizedTitle || !/\b\d+$/u.test(normalizedTitle)) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const overflowMatch = parseableRaw.match(
    new RegExp(
      `${escapeRegex(normalizedTitle)}\\.(?<overflow>\\d+(?:\\.\\d+)?\\s*[-–—]\\s*[^.]{3,220})\\.\\s*(?<tail>.+)$`,
      'iu',
    ),
  );
  const overflow = overflowMatch?.groups?.overflow
    ? normalizeExtractionInput(overflowMatch.groups.overflow)
    : null;
  const tail = overflowMatch?.groups?.tail
    ? normalizeExtractionInput(overflowMatch.groups.tail)
    : null;
  if (!overflow || !/\d+\s*[-–—]\s*\p{L}/iu.test(overflow)) {
    return null;
  }

  const repairedTitle = normalizeTitleCandidate(`${normalizedTitle}.${overflow}`);
  if (!repairedTitle || repairedTitle.length <= normalizedTitle.length + 3) {
    return null;
  }

  return {
    title: repairedTitle,
    overflow,
    tail: tail?.trim() ? tail.trim() : null,
  };
}

function recoverDecimalTerminalTokenFromRaw(raw: string, title: string): string | null {
  const normalizedTitle = normalizeExtractionInput(stripTrailingPunctuation(title)).trim();
  if (!normalizedTitle || !/\b\d+$/u.test(normalizedTitle)) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const token = parseableRaw.match(
    new RegExp(`${escapeRegex(normalizedTitle)}\\.(?<token>(?:[A-Z]|\\d{1,3}))\\.(?=\\s|$)`, 'u'),
  )?.groups?.token;
  if (!token) {
    return null;
  }

  return normalizeTitleCandidate(`${normalizedTitle}.${token}`) ?? null;
}

function looksUppercaseProceedingsTitle(value: string): boolean {
  const words = value.split(/\s+/u).filter(Boolean);
  const letters = [...value].filter((char) => /\p{L}/u.test(char));
  const uppercaseLetters = letters.filter((char) => /\p{Lu}/u.test(char));
  if (words.length < 5 || letters.length < 20) {
    return false;
  }

  const uppercaseRatio = uppercaseLetters.length / letters.length;
  return uppercaseRatio >= 0.6 && value.includes(':');
}

function recoverConferenceVenuePrefixFromRaw(
  raw: string,
  title: string,
  conferenceTitle: string,
): string | null {
  const tail = extractTailAfterTitle(raw, title);
  if (!tail) {
    return null;
  }

  const normalizedTail = normalizeExtractionInput(stripTrailingIdentifierTailForParsing(tail));
  const normalizedConference = normalizeExtractionInput(conferenceTitle);
  if (!normalizedTail || !normalizedConference) {
    return null;
  }

  const conferenceIndex = normalizedTail.toLocaleLowerCase().indexOf(normalizedConference.toLocaleLowerCase());
  if (conferenceIndex <= 0) {
    return null;
  }

  const prefix = stripTrailingPunctuation(normalizedTail.slice(0, conferenceIndex).trim());
  if (
    !prefix
    || !looksConferenceVenuePrefix(prefix)
    || looksPublisherLike(prefix)
    || looksInstitutionalContainer(prefix)
  ) {
    return null;
  }

  return normalizeConferenceTitle(`${prefix}. ${conferenceTitle}`);
}

function looksConferenceVenuePrefix(value: string): boolean {
  if (looksJournalLikeContainer(value)) {
    return true;
  }

  const words = value.split(/\s+/u).filter(Boolean);
  const letters = [...value].filter((char) => /\p{L}/u.test(char));
  if (words.length < 4 || letters.length === 0) {
    return false;
  }

  const uppercaseLetters = letters.filter((char) => char === char.toUpperCase()).length;
  const uppercaseRatio = uppercaseLetters / letters.length;
  return uppercaseRatio >= 0.72;
}

function recoverPublisherYearTailFromRaw(
  raw: string,
  title: string,
): { publisher: string; year: number | null } | null {
  return recoverPublisherYearTailFromRawCached(composeCacheKey(raw, title));
}

const recoverPublisherYearTailFromRawCached = createBoundedValueCache<{ publisher: string; year: number | null } | null>(
  PUBLISHER_YEAR_TAIL_CACHE_LIMIT,
  (cacheKey) => {
    const [raw = '', title = ''] = cacheKey.split('\u0000');
    const tail = extractTailAfterTitle(raw, title);
    if (!tail) {
      return null;
    }

    const match = tail.match(/^(?<publisher>[^.;]{2,120})[,;]\s*(?<year>(?:1[6-9]|20)\d{2})(?:[.;]|$)/u);
    const publisher = match?.groups?.publisher
      ? normalizePublisherCandidate(match.groups.publisher, title)
      : null;
    if (!publisher || !looksPublisherLike(publisher)) {
      return null;
    }

    return {
      publisher,
      year: match?.groups?.year ? Number(match.groups.year) : null,
    };
  },
);

function isYearLikeLocatorValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^(?:1[6-9]|20)\d{2}$/u.test(value.trim());
}

function looksWebpageIdentifierLocatorArtifact(
  pages: string | null | undefined,
  options: {
    hasMeaningfulUrl: boolean;
    siteName?: string | null | undefined;
    institution?: string | null | undefined;
    pmid?: string | null | undefined;
  },
): boolean {
  if (!pages || !options.hasMeaningfulUrl) {
    return false;
  }

  const normalizedPages = normalizeComparableText(normalizePages(pages));
  if (normalizedPages === '99999999') {
    return true;
  }
  if (!normalizedPages) {
    return false;
  }

  const hasWebpageContext =
    normalizeComparableText(options.siteName ?? '').length > 0
    || normalizeComparableText(options.institution ?? '').length > 0;
  if (!hasWebpageContext) {
    return false;
  }

  const identifierCandidates = [options.pmid]
    .map((candidate) => normalizeComparableText(candidate ?? ''))
    .filter((candidate) => candidate.length > 0);
  return identifierCandidates.some((candidate) => candidate === normalizedPages);
}

function looksUrlContaminatedOwnerValue(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 && /https?:\/\/[^\s"'<>]+/iu.test(normalized);
}

function looksPublisherYearOnlyLocator(
  journalCandidate: string | null | undefined,
  volume: string | null | undefined,
  issue: string | null | undefined,
): boolean {
  const candidate = journalCandidate?.trim() ?? '';
  if (!candidate || issue?.trim()) {
    return false;
  }
  if (!isYearLikeLocatorValue(volume)) {
    return false;
  }
  return looksPublisherLike(candidate) || looksInstitutionalContainer(candidate) || looksReportPublisherAcronym(candidate);
}

function recoverMissingBookTitleFromRaw(
  raw: string,
  title: string,
  publisherHint?: string | null,
): { bookTitle: string; publisher: string | null } | null {
  const tail = extractTailAfterTitle(raw, title);
  if (!tail) {
    return null;
  }

  let working = tail.replace(/^In\s+/iu, '').trim();
  if (!working) {
    return null;
  }

  const normalizedPublisherHint = normalizePublisherCandidate(publisherHint ?? undefined, title);
  const splitTail = splitBookChapterConferenceTail(working, title);
  const recoveredPublisher = splitTail.publisher ?? normalizedPublisherHint ?? null;
  const cleanedWorking = splitTail.bookTitle
    .replace(/[;,]\s*p{1,2}\.?\s*[A-Za-z]?\d[\w\s–-]*$/iu, '')
    .replace(/[;,]\s*(?:19|20)\d{2}\s*$/u, '')
    .replace(/[;,]\s*(?:available at|retrieved from).+$/iu, '')
    .replace(/[.,;:\s]+$/u, '')
    .trim();
  const trailingContainerClause = getBestTrailingContainerClause(
    cleanedWorking,
    (candidate) =>
      candidate.split(/\s+/u).filter(Boolean).length >= 3
      && !looksInstitutionalContainer(candidate)
      && !looksPublisherLike(candidate)
      && !looksLowQualityContainerCandidate(candidate),
  );
  const recoveredBookTitle = normalizeConferenceTitle(
    trailingContainerClause ?? cleanedWorking,
  );
  if (recoveredBookTitle && recoverJournalFromContainerLocator(recoveredBookTitle)) {
    return null;
  }

  if (
    !recoveredBookTitle
    || looksConferenceContainer(recoveredBookTitle)
    || looksInstitutionalContainer(recoveredBookTitle)
    || looksLowQualityContainerCandidate(recoveredBookTitle)
  ) {
    return null;
  }

  if (normalizeComparableText(title).includes(normalizeComparableText(recoveredBookTitle))) {
    return null;
  }

  return {
    bookTitle: recoveredBookTitle,
    publisher: recoveredPublisher ?? normalizedPublisherHint ?? null,
  };
}

function recoverBookContextFromPublisherLikeBookTitle(
  raw: string,
  title: string,
  bookTitle: string | null | undefined,
  publisherHint?: string | null,
): { title: string; bookTitle: string; publisher: string | null } | null {
  const normalizedTitle = normalizeTitleCandidate(title);
  const normalizedBookTitle = normalizeConferenceTitle(bookTitle ?? '');
  const normalizedPublisherHint =
    normalizePublisherCandidate(publisherHint ?? undefined, normalizedTitle ?? undefined)
    ?? normalizeConferenceTitle(publisherHint ?? '');
  if (!normalizedTitle || !normalizedBookTitle) {
    return null;
  }

  const suspiciousBookTitle =
    normalizedBookTitle.split(/\s+/u).filter(Boolean).length < 3
    || looksPublisherLike(normalizedBookTitle)
    || looksInstitutionalContainer(normalizedBookTitle)
    || (
      normalizedPublisherHint.length > 0
      && normalizeComparableText(normalizedBookTitle) === normalizeComparableText(normalizedPublisherHint)
    );
  if (!suspiciousBookTitle) {
    return null;
  }

  const leadingTitleCandidate = splitSentenceClauses(normalizedTitle)
    .map((clause) => stripTrailingPunctuation(clause).trim())
    .find(Boolean)
    ?? normalizedTitle;
  const normalizedLeadingTitle = normalizeTitleCandidate(leadingTitleCandidate);
  if (
    !normalizedLeadingTitle
    || normalizeComparableText(normalizedLeadingTitle) === normalizeComparableText(normalizedBookTitle)
  ) {
    return null;
  }

  const recoveredBookContext = recoverMissingBookTitleFromRaw(
    raw,
    normalizedLeadingTitle,
    normalizedPublisherHint || publisherHint || null,
  );
  if (
    !recoveredBookContext
    || normalizeComparableText(recoveredBookContext.bookTitle) === normalizeComparableText(normalizedBookTitle)
  ) {
    return null;
  }

  return {
    title: normalizedLeadingTitle,
    bookTitle: recoveredBookContext.bookTitle,
    publisher: recoveredBookContext.publisher ?? (normalizedPublisherHint || null),
  };
}

function recoverBookContextFromSwallowedTitleTail(
  title: string,
): { title: string; bookTitle: string; publisher: string | null } | null {
  const match = title.match(
    /^(?<title>.+?["”]?,?)\s+(?<bookTitle>.+?)\.\s+(?<publisher>[^,]+),\s*pp?\.?$/iu,
  );
  if (!match?.groups?.title || !match.groups.bookTitle) {
    return null;
  }

  const repairedTitle = normalizeTitleCandidate(match.groups.title);
  const repairedBookTitle = normalizeConferenceTitle(match.groups.bookTitle);
  const repairedPublisher = normalizePublisherCandidate(match.groups.publisher ?? '', repairedTitle ?? undefined);
  if (
    !repairedTitle
    || !repairedBookTitle
    || repairedBookTitle.split(/\s+/u).filter(Boolean).length < 3
  ) {
    return null;
  }

  return {
    title: repairedTitle,
    bookTitle: repairedBookTitle,
    publisher: repairedPublisher,
  };
}

function splitTemporalConferenceTailFromTitle(
  title: string,
): { title: string; conferenceTitle: string } | null {
  const clauses = splitSentenceClauses(title)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length < 2) {
    return null;
  }

  const conferenceTitle = normalizeConferenceTitle(clauses.at(-1));
  const repairedTitle = normalizeTitleCandidate(clauses.slice(0, -1).join(' '));
  if (
    !conferenceTitle
    || !repairedTitle
    || repairedTitle.split(/\s+/u).filter(Boolean).length < 3
    || !shouldPreserveConferenceTemporalTail(conferenceTitle)
    || looksLowQualityContainerCandidate(conferenceTitle)
    || looksInstitutionalContainer(conferenceTitle)
    || recoverJournalFromContainerLocator(conferenceTitle)
  ) {
    return null;
  }

  return { title: repairedTitle, conferenceTitle };
}

function normalizeTitleCasePreservingAcronyms(value: string): string {
  const normalized = normalizeTitleCandidate(value);
  if (!normalized) {
    return value;
  }

  return normalized
    .split(/\s+/u)
    .map((token, index) => {
      const prefix = token.match(/^[^A-Za-z\p{L}]*/u)?.[0] ?? '';
      const suffix = token.match(/[^A-Za-z\p{L}]+$/u)?.[0] ?? '';
      const core = token.slice(prefix.length, token.length - suffix.length);
      if (!core) {
        return token;
      }
      if (/^[A-Z0-9][A-Z0-9.-]*$/u.test(core)) {
        return token;
      }
      if (/^(?:a|an|and|as|at|by|de|del|for|from|in|into|of|on|or|the|to|via|vs?)$/iu.test(core) && index > 0) {
        return `${prefix}${core.toLowerCase()}${suffix}`;
      }
      if (/^[\p{Ll}][\p{L}\p{M}'’-]*$/u.test(core)) {
        return `${prefix}${core[0]?.toUpperCase() ?? ''}${core.slice(1)}${suffix}`;
      }
      return token;
    })
    .join(' ');
}

function recoverTemporalConferenceFromJournalVolume(
  journal: string | null,
  volume: string | null,
): string | null {
  const normalizedJournal = journal ? normalizeConferenceTitle(journal) : null;
  const normalizedVolume = volume ? stripTrailingPunctuation(volume).trim() : null;
  if (!normalizedJournal || !normalizedVolume || !/^(?:19|20)\d{2}$/u.test(normalizedVolume)) {
    return null;
  }

  const combined = normalizeConferenceTitle(
    /\b(?:19|20)\d{2}\b/u.test(normalizedJournal)
      ? `${normalizedJournal}, ${normalizedVolume}`
      : `${normalizedJournal} ${normalizedVolume}`,
  );
  if (
    !combined
    || !shouldPreserveConferenceTemporalTail(combined)
    || looksLowQualityContainerCandidate(combined)
    || looksInstitutionalContainer(combined)
  ) {
    return null;
  }

  return combined;
}

function recoverStrongTemporalConferenceFromRaw(
  raw: string,
): { title: string; conferenceTitle: string } | null {
  return recoverStrongTemporalConferenceFromRawCached(raw);
}

const recoverStrongTemporalConferenceFromRawCached = createBoundedValueCache<{ title: string; conferenceTitle: string } | null>(
  TEMPORAL_CONFERENCE_RECOVERY_CACHE_LIMIT,
  (raw) => {
    const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
    const authorDateMatch = parseableRaw.match(
      /^(?<authors>.+?)\s*\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<container>.+)$/iu,
    );
    const mlaMatch = authorDateMatch
      ? null
      : parseableRaw.match(
        /^(?<authors>.+?)\.\s*["“](?<title>.+?)(?:[.?!])?["”]\.?\s*(?<year>(?:19|20)\d{2}),\s*(?<container>.+)$/iu,
      );
    const match = authorDateMatch ?? mlaMatch;
    const title = normalizeTitleCandidate(match?.groups?.title);
    const conferenceTitle = normalizeConferenceTitle(stripTrailingPunctuation(match?.groups?.container ?? ''));
    if (
      !title
      || !conferenceTitle
      || !shouldPreserveConferenceTemporalTail(conferenceTitle)
      || looksLowQualityContainerCandidate(conferenceTitle)
      || looksInstitutionalContainer(conferenceTitle)
    ) {
      return null;
    }

    return {
      title: normalizeTitleCasePreservingAcronyms(title),
      conferenceTitle,
    };
  },
);

function recoverStrongNumericConferencePublisherTail(raw: string): ParsedReference | null {
  return recoverStrongNumericConferencePublisherTailCached(raw);
}

const recoverStrongNumericConferencePublisherTailCached = createBoundedValueCache<ParsedReference | null>(
  NUMERIC_CONFERENCE_RECOVERY_CACHE_LIMIT,
  (raw) => {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const match =
    parseableRaw.match(
      /^(?:\[\d+\]\s*)?(?<lead>.+,[”"])\s*(?<publisher>[^,;“”"]+)[,;]\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*(?<pages>[^.;]+))?\.?$/iu,
    )
    ?? parseableRaw.match(
      /^(?:\[\d+\]\s*)?(?<lead>.+),\s*(?<publisher>[^;,]+)[,;]\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*(?<pages>[^.;]+))?\.?$/iu,
    );
  if (!match?.groups?.lead || !match.groups.publisher || !match.groups.year) {
    return null;
  }

  let lead = match.groups.lead.trim();
  let publisherText = match.groups.publisher.trim();
  const publisherLeadingQuoteMatch = publisherText.match(/^(?<quote>[”"])\s*(?<rest>.+)$/u);
  if (publisherLeadingQuoteMatch?.groups?.rest && /[“"]/.test(lead)) {
    lead = `${lead.replace(/[,\s]+$/u, '')},${publisherLeadingQuoteMatch.groups.quote}`;
    publisherText = publisherLeadingQuoteMatch.groups.rest.trim();
  }
  lead = lead.replace(/([”"])\s*,\s*$/u, '$1');

  const sentenceBoundarySplit = lead.match(/^(?<authors>.+?\.)\s+(?<title>.+)$/u);
  const fallbackAuthorTitleSplit =
    sentenceBoundarySplit?.groups?.authors
    && sentenceBoundarySplit.groups.title
      ? {
        authorSegment: sentenceBoundarySplit.groups.authors.trim(),
        title: sentenceBoundarySplit.groups.title.trim(),
      }
      : null;
  const authorTitleSplit = splitNumericConferenceLead(lead) ?? fallbackAuthorTitleSplit;
  if (!authorTitleSplit) {
    return null;
  }

  const authorSegment = stripTrailingPunctuation(authorTitleSplit.authorSegment);
  const parsedAuthors = parseRecoverableNumericConferenceAuthors(authorSegment);
  const rawQuotedTitle = findQuotedTitle(raw)?.title ?? null;
  const title =
    stripTrailingPunctuation(rawQuotedTitle ?? '').trim()
    || normalizeTitleCandidate(authorTitleSplit.title);
  const cleanedPublisher = stripTrailingPunctuation(publisherText).trim();
  const publisher =
    normalizePublisherCandidate(cleanedPublisher, title ?? undefined)
    ?? normalizeConferenceTitle(cleanedPublisher);
  const pages = match.groups.pages ? normalizePages(match.groups.pages) : undefined;
  const doi = extractRelaxedDoi(raw);
  const doiConferenceTitleHint = recoverConferenceTitleFromDoiHint(
    doi ?? undefined,
    toYear(match.groups.year),
  );
  const hasNumericEnumerator = /^\s*(?:\[\d+\]|\d+\.)\s*/u.test(raw);
  const publisherLooksConferenceish =
    looksConferencePublisherOrganization(publisher)
    || looksConferenceContainer(publisher)
    || looksCompactConferenceVenueAlias(publisher)
    || looksStandaloneInstitutionalAlias(publisher)
    || (
      looksInstitutionalContainer(publisher)
      && (
        doiConferenceTitleHint != null
        || CONFERENCE_CUE_REGEX.test(raw)
        || looksProceedingsLikeDoi(doi ?? undefined)
      )
    )
    || (
      looksPublisherLike(publisher)
      && (
        doiConferenceTitleHint != null
        || CONFERENCE_CUE_REGEX.test(raw)
      )
    )
    || (
      doiConferenceTitleHint != null
      && looksJournalLikeContainer(publisher)
    );
  const hasConferenceEvidence =
    CONFERENCE_DOI_REGEX.test(raw)
    || looksProceedingsLikeDoi(doi ?? undefined)
    || /\bpaper presented at\b/iu.test(raw)
    || CONFERENCE_CUE_REGEX.test(raw)
    || (hasNumericEnumerator && publisherLooksConferenceish);

  if (
    parsedAuthors.length < 1
    || !title
    || title.split(/\s+/u).filter(Boolean).length < 5
    || !publisher
    || !hasConferenceEvidence
    || !publisherLooksConferenceish
  ) {
    return null;
  }

  return {
    authorSegment,
    title,
    publisher,
    year: toYear(match.groups.year),
    ...(pages ? { pages } : {}),
    typeHint: 'conference-paper',
  };
  },
);

function recoverConferencePublisherAliasFromRaw(raw: string): string | null {
  return recoverConferencePublisherAliasFromRawCached(raw);
}

const recoverConferencePublisherAliasFromRawCached = createBoundedValueCache<string | null>(
  CONFERENCE_PUBLISHER_ALIAS_CACHE_LIMIT,
  (raw) => {
    const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
    const match = parseableRaw.match(
      /(?:["”]\s*,\s*|,\s*|\.?\s+)(?<publisher>[^,;]+)[,;]\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*[^.;]+)?\.?$/iu,
    );
    return normalizeExplicitConferencePublisherCandidate(
      match?.groups?.publisher,
      undefined,
      undefined,
    );
  },
);

function hasExplicitConferencePublisherEvidence(
  raw: string,
  conferenceTitleHint?: string | null,
  doiHint?: string | undefined,
): boolean {
  const normalizedConferenceTitle = conferenceTitleHint
    ? normalizeConferenceTitle(conferenceTitleHint)
    : null;
  return (
    Boolean(normalizedConferenceTitle && looksConferencePublicationVenue(normalizedConferenceTitle))
    || CONFERENCE_DOI_REGEX.test(raw)
    || /\bpaper presented at\b/iu.test(raw)
    || CONFERENCE_CUE_REGEX.test(raw)
    || Boolean(recoverConferenceTitleFromDoiHint(doiHint))
    || Boolean(recoverCompactConferenceAliasFromDoi(doiHint, raw))
  );
}

function normalizeExplicitConferencePublisherCandidate(
  candidate: string | null | undefined,
  titleHint?: string | null,
  conferenceTitleHint?: string | null,
): string | null {
  const cleanedCandidate = candidate
    ? stripConferencePublisherWrapperCandidate(candidate, conferenceTitleHint)
    : null;
  const publisher = cleanedCandidate
    ? normalizePublisherCandidate(stripPublisherLeadQuoteBleed(cleanedCandidate), titleHint ?? undefined)
      ?? normalizeConferenceTitle(stripPublisherLeadQuoteBleed(cleanedCandidate))
    : null;
  if (
    !publisher
    || isConferencePlaceholder(publisher)
    || looksLowQualityContainerCandidate(publisher)
    || looksLocatorHeavyContainerSpill(publisher)
    || looksContainerInstitutionTailSpill(publisher)
    || hasExplicitConferenceTitleCue(publisher)
    || looksConferencePublicationVenue(publisher)
    || looksConferenceContainer(publisher)
  ) {
    return null;
  }
  if (titleHint && normalizeComparableText(titleHint) === normalizeComparableText(publisher)) {
    return null;
  }
  if (
    conferenceTitleHint
    && normalizeComparableText(conferenceTitleHint) === normalizeComparableText(publisher)
    && !looksPublisherLike(publisher)
    && !looksInstitutionalContainer(publisher)
    && !looksConferencePublisherOrganization(publisher)
    && !looksStandaloneInstitutionalAlias(publisher)
  ) {
    return null;
  }
  if (looksLikeAuthorSpill(publisher)) {
    return null;
  }
  return publisher;
}

function stripConferencePublisherWrapperCandidate(
  candidate: string,
  conferenceTitleHint?: string | null,
): string | null {
  let normalized = normalizeInlineQuoteCharacters(candidate)
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) {
    return null;
  }

  const normalizedConference = conferenceTitleHint
    ? normalizeInlineQuoteCharacters(normalizeConferenceTitle(conferenceTitleHint) ?? '')
    : '';
  if (normalizedConference) {
    const wrapperPatterns = [
      new RegExp(
        `^Paper presented at\\s+${escapeRegex(normalizedConference)}(?:\\.\\s*(?:19|20)\\d{2})?[.\\s,:;-]*(?<tail>.+)?$`,
        'iu',
      ),
      new RegExp(
        `^(?:19|20)\\d{2}[,.;:\\s]+${escapeRegex(normalizedConference)}[.\\s,:;-]*(?<tail>.+)?$`,
        'iu',
      ),
      new RegExp(
        `^${escapeRegex(normalizedConference)}[.\\s,:;-]+(?:19|20)\\d{2}[.\\s,:;-]*(?<tail>.+)?$`,
        'iu',
      ),
    ];

    for (const pattern of wrapperPatterns) {
      const match = normalized.match(pattern);
      if (!match) {
        continue;
      }
      const tail = match.groups?.tail?.trim() ?? '';
      return tail ? tail : null;
    }

    if (normalizeComparableText(normalized) === normalizeComparableText(normalizedConference)) {
      return null;
    }
  }

  if (
    /^paper presented at\b/iu.test(normalized)
    || /^(?:19|20)\d{2}[,.;:\s]+(?:proceedings|anais|conference|symposium|congress|meeting|workshop)\b/iu.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeConferencePublisherSlotCandidate(
  candidate: string | null | undefined,
  titleHint?: string | null,
  conferenceTitleHint?: string | null,
): string | null {
  const normalizedPublisher = normalizeExplicitConferencePublisherCandidate(
    candidate,
    titleHint,
    conferenceTitleHint,
  );
  if (normalizedPublisher) {
    return normalizedPublisher;
  }

  const normalized = candidate ? normalizeConferenceTitle(candidate) : null;
  if (
    !normalized
    || isConferencePlaceholder(normalized)
    || looksLowQualityContainerCandidate(normalized)
    || looksLocatorHeavyContainerSpill(normalized)
    || looksContainerInstitutionTailSpill(normalized)
    || looksLikeAuthorSpill(normalized)
    || hasExplicitConferenceTitleCue(normalized)
    || looksConferencePublicationVenue(normalized)
    || looksConferenceContainer(normalized)
  ) {
    return null;
  }

  const tokenCount = normalized.split(/\s+/u).filter(Boolean).length;
  if (tokenCount < 2 || tokenCount > 12) {
    return null;
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const uppercaseishTokenCount = tokens.filter((token) =>
    /[\p{Lu}]/u.test(token) && token === token.toUpperCase()
  ).length;
  const titlecaseTokenCount = tokens.filter((token) => /^[\p{Lu}]/u.test(token)).length;

  if (
    looksRecoverableConferencePublisherSlot(normalized)
    || looksPublisherLike(normalized)
    || looksInstitutionalContainer(normalized)
    || looksConferencePublisherOrganization(normalized)
    || looksStandaloneInstitutionalAlias(normalized)
    || uppercaseishTokenCount >= 2
    || titlecaseTokenCount >= 2
  ) {
    return normalized;
  }

  return null;
}

function recoverExplicitConferencePublisherFromRaw(
  raw: string,
  titleHint?: string | null,
  conferenceTitleHint?: string | null,
  doiHint?: string | undefined,
): string | null {
  return recoverExplicitConferencePublisherFromRawCached(
    composeCacheKey(raw, titleHint, conferenceTitleHint, doiHint),
  );
}

const recoverExplicitConferencePublisherFromRawCached = createBoundedValueCache<string | null>(
  EXPLICIT_CONFERENCE_PUBLISHER_CACHE_LIMIT,
  (cacheKey) => {
    const [raw = '', titleHint = '', conferenceTitleHint = '', doiHint = ''] = cacheKey.split('\u0000');
    if (!hasExplicitConferencePublisherEvidence(raw, conferenceTitleHint, doiHint || undefined)) {
      return null;
    }
    const candidates = [
      recoverStrongNumericConferencePublisherTail(raw)?.publisher ?? null,
      recoverConferencePublisherFromTitleTail(raw, titleHint, conferenceTitleHint),
      recoverStandaloneConferencePublisherSlot(raw, titleHint, conferenceTitleHint),
      recoverConferencePublisherAliasFromRaw(raw),
      inferPublisherFromDoiHint(doiHint || undefined),
    ];
    for (const candidate of candidates) {
      const normalized = normalizeExplicitConferencePublisherCandidate(
        candidate,
        titleHint,
        conferenceTitleHint,
      );
      if (normalized) {
        return normalized;
      }
    }
    return null;
  },
);

function looksRecoverableConferencePublisherSlot(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  return (
    looksPublisherLike(text)
    || looksConferencePublisherOrganization(text)
    || looksInstitutionalContainer(text)
    || looksStandaloneInstitutionalAlias(text)
  );
}

function splitTrailingContainerFromTitleOverflow(
  title: string,
): { title: string; container: string } | null {
  const overflowMatch = title.match(/^(?<title>.+?)(?:["”]\s*,\s*|["”]\s+)(?<container>.+)$/u);
  const repairedTitle = overflowMatch?.groups?.title
    ? stripTrailingPunctuation(overflowMatch.groups.title.replace(/["“”'‘’\s]+$/u, '').trim())
    : null;
  const container = overflowMatch?.groups?.container
    ? normalizeConferenceTitle(overflowMatch.groups.container)
    : null;

  if (
    !repairedTitle
    || !container
    || looksLowQualityContainerCandidate(container)
    || normalizeComparableText(repairedTitle).split(' ').length < 3
    || normalizeComparableText(container).split(' ').length < 2
  ) {
    return null;
  }

  return {
    title: repairedTitle,
    container,
  };
}

function repairArticlePublisherLocatorSpill(
  raw: string,
  title: string | null,
  journal: string | null,
  publisher: string | null,
): { title: string | null; publisher: null } | null {
  if (!title || !journal || !publisher) {
    return null;
  }

  const normalizedJournal = normalizeConferenceTitle(journal);
  const normalizedPublisher = normalizeConferenceTitle(publisher);
  if (
    !normalizedJournal
    || !normalizedPublisher
    || looksPublisherLike(normalizedPublisher)
    || looksInstitutionalContainer(normalizedPublisher)
    || looksConferenceContainer(normalizedPublisher)
    || looksConferencePublicationVenue(normalizedPublisher)
    || looksLowQualityContainerCandidate(normalizedPublisher)
    || !normalizeComparableText(normalizedPublisher).includes(normalizeComparableText(normalizedJournal))
  ) {
    return null;
  }

  const comparableJournal = normalizeComparableText(normalizedJournal);
  const comparablePublisher = normalizeComparableText(normalizedPublisher);
  const comparableTitle = normalizeComparableText(title);
  if (!comparableJournal || !comparablePublisher || !comparableTitle) {
    return null;
  }

  const journalTailMatch = normalizedPublisher.match(
    new RegExp(`^(?<continuation>.+?)(?:[.,;:]\\s*)${escapeRegex(normalizedJournal)}$`, 'iu'),
  );
  const continuation = journalTailMatch?.groups?.continuation
    ? stripTrailingPunctuation(journalTailMatch.groups.continuation)
    : null;
  if (
    !continuation
    || continuation.split(/\s+/u).filter(Boolean).length < 3
    || looksPublisherLike(continuation)
    || looksInstitutionalContainer(continuation)
    || looksConferenceContainer(continuation)
  ) {
    return null;
  }

  const recoveredTitle = recoverTitleContinuationFromRaw(raw, title, continuation)
    ?? (
      comparablePublisher.includes(comparableTitle)
        ? stripTrailingPunctuation(normalizedPublisher.replace(
          new RegExp(`[.,;:]?\\s*${escapeRegex(normalizedJournal)}$`, 'iu'),
          '',
        ))
        : null
    );
  const fallbackTitle = recoveredTitle
    ?? (
      /^[\p{Lu}"'“]/u.test(continuation)
        ? `${stripTrailingPunctuation(title)}, ${continuation}`.trim()
        : null
    );
  if (!fallbackTitle) {
    return null;
  }

  return {
    title: fallbackTitle,
    publisher: null,
  };
}

function recoverQuotedBookTitleOverflowFromRaw(
  raw: string,
  title: string,
  bookTitle: string,
): { title: string; bookTitle: string } | null {
  const leadingFragmentMatch = bookTitle.match(
    /^(?<fragment>.+?)["”]\s*,?\s*(?<rest>.+)$/u,
  );
  const fragment = leadingFragmentMatch?.groups?.fragment
    ? stripTrailingPunctuation(leadingFragmentMatch.groups.fragment)
    : null;
  const rest = leadingFragmentMatch?.groups?.rest
    ? normalizeConferenceTitle(leadingFragmentMatch.groups.rest)
    : null;
  if (!fragment || !rest || looksLowQualityContainerCandidate(rest)) {
    return null;
  }

  const normalizedRaw = normalizeInlineQuoteCharacters(normalizeExtractionInput(raw));
  const normalizedTitleStem = normalizeExtractionInput(stripTrailingPunctuation(title));
  const normalizedFragment = normalizeExtractionInput(fragment);
  const directQuotedMatch = normalizedRaw.match(
    new RegExp(
      `["](?<quoted>${escapeRegex(normalizedTitleStem)}(?:[^"]{0,64}?${escapeRegex(normalizedFragment)})?)[,.]?(?:"|$)`,
      'iu',
    ),
  );
  const quotedTitle = stripTrailingPunctuation(
    directQuotedMatch?.groups?.quoted
      ?? findQuotedTitle(raw)?.title
      ?? '',
  );
  const normalizedTitle = normalizeComparableText(title);
  const normalizedQuotedTitle = normalizeComparableText(quotedTitle ?? "");
  const normalizedComparableFragment = normalizeComparableText(fragment);
  if (
    !normalizedTitle
    || !normalizedQuotedTitle
    || !normalizedComparableFragment
    || !normalizedQuotedTitle.startsWith(normalizedTitle)
    || !normalizedQuotedTitle.includes(normalizedComparableFragment)
  ) {
    return null;
  }

  return {
    title: stripTrailingPunctuation(quotedTitle ?? title),
    bookTitle: rest,
  };
}

function recoverInCollectionTitleOverflowFromRaw(
  raw: string,
  title: string,
  bookTitle: string,
): { title: string; bookTitle: string } | null {
  const normalizedTitle = stripTrailingPunctuation(normalizeExtractionInput(title));
  if (!normalizedTitle) {
    return null;
  }

  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const escapedTitle = escapeRegex(normalizedTitle);
  const overflowMatch = parseableRaw.match(
    new RegExp(
      `${escapedTitle}(?<overflow>.+?)\\.\\s+In\\s+(?<bookTitle>.+?)(?=(?:\\s*\\(|\\.\\s+|,\\s*(?:19|20)\\d{2}\\b|,\\s*pp?\\.|\\s+https?:\\/\\/|\\s+doi:|\\s+10\\.))`,
      "iu",
    ),
  );
  const overflow = overflowMatch?.groups?.overflow
    ? normalizeExtractionInput(overflowMatch.groups.overflow)
    : null;
  const recoveredBookTitle = overflowMatch?.groups?.bookTitle
    ? normalizeConferenceTitle(overflowMatch.groups.bookTitle)
    : null;
  if (
    !overflow
    || !recoveredBookTitle
    || looksLowQualityContainerCandidate(recoveredBookTitle)
    || looksConferenceContainer(recoveredBookTitle)
  ) {
    return null;
  }

  return {
    title: stripTrailingPunctuation(`${normalizedTitle}${overflow}`),
    bookTitle: recoveredBookTitle,
  };
}

function splitQuotedJournalLead(title: string, journal: string): string | null {
  const quotedLead = journal.match(/^(?<fragment>[^,]{1,48}(?:["”](?:,\s*["”]?)?|,\s*["”]))\s+(?<rest>.+)$/u);
  const fragment = quotedLead?.groups?.fragment;
  const rest = quotedLead?.groups?.rest?.trim();
  if (!fragment || !rest) {
    return null;
  }

  const fragmentKey = normalizeComparableText(
    stripTrailingPunctuation(fragment).replace(/["“”„‟«»]+/gu, ' '),
  );
  const titleKey = normalizeComparableText(title);
  if (!fragmentKey || !titleKey.endsWith(fragmentKey)) {
    return null;
  }

  return rest;
}

function stripLeadingJournalSpill(journal: string): string {
  return extractLeadingJournalSpill(journal)?.rest ?? journal;
}

function extractLeadingJournalSpill(
  journal: string,
): { lead: string; rest: string } | null {
  const reviewLead = journal.match(/^(?<lead>.+?\breview\),?\s*["”]?)\s*(?<rest>.+)$/iu);
  const lead = reviewLead?.groups?.lead ? stripTrailingPunctuation(reviewLead.groups.lead) : null;
  const rest = reviewLead?.groups?.rest ? reviewLead.groups.rest.trim() : null;
  if (
    lead
    && rest
    && looksJournalLikeContainer(rest)
    && (looksLikeAuthorSpill(lead) || countLeadingAuthorLikeNameSegments(lead) >= 1)
  ) {
    return { lead, rest };
  }

  return null;
}

function trimTrailingContainerLabelFromTitle(title: string, candidate: string): string | null {
  const normalizedCandidate = stripTrailingPunctuation(candidate).trim();
  if (!normalizedCandidate) {
    return null;
  }

  const trimmed = title
    .replace(new RegExp(`[\\s,:;-]+${escapeRegex(normalizedCandidate)}$`, 'iu'), '')
    .trim();
  if (!trimmed || trimmed === title) {
    return null;
  }

  return stripTrailingPunctuation(trimmed);
}

function recoverTitleContinuationFromRaw(raw: string, title: string, continuation: string): string | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const normalizedTitle = normalizeExtractionInput(stripTrailingPunctuation(title)).trim();
  const normalizedContinuation = normalizeExtractionInput(stripTrailingPunctuation(continuation)).trim();
  if (!normalizedTitle || !normalizedContinuation) {
    return null;
  }

  const match = parseableRaw.match(
    new RegExp(
      `${escapeRegex(normalizedTitle)}(?<sep>[,:;])\\s+${escapeRegex(normalizedContinuation)}(?=(?:\\.\\s+|,\\s*(?:vol\\.?|volume|no\\.?|issue|pp?\\.?|\\d{4}\\b)|\\s+https?:\\/\\/|\\s+doi:|\\s+10\\.))`,
      'iu',
    ),
  );
  const separator = match?.groups?.sep?.trim();
  if (!separator) {
    return null;
  }

  return `${stripTrailingPunctuation(normalizedTitle)}${separator} ${stripTrailingPunctuation(normalizedContinuation)}`.trim();
}

function normalizeJournalCandidate(value: string | undefined, titleHint?: string | null): string | null {
  if (!value) return null;

  let normalized = stripTrailingPunctuation(value)
    .replace(/&amp;/giu, '&')
    .replace(/^©\s*/u, '')
    .replace(/^["“”'‘’\s]+/u, '')
    .replace(/["“”'‘’\s]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

  normalized = trimTrailingTitleSuffix(normalized, titleHint);
  normalized = stripTrailingContainerLocatorTail(normalized);

  const splitLead = splitQuotedJournalLead(titleHint ?? '', normalized);
  if (splitLead) {
    normalized = splitLead;
  }

  normalized = stripLeadingJournalSpill(normalized);

  // NLM-style journal names carry a section after a period: "Physical review. B,
  // Condensed matter", "Physical review. A". The trailing-clause splitter below
  // treats that period as a field boundary and would drop the section (keeping only
  // "Physical review"), so preserve the whole name when the lead is itself a journal
  // and the tail is a bare section marker (a lone capital, optionally with a
  // descriptor). A real word tail ("Nature", "B cells…") never matches.
  const nlmSectionMatch = normalized.match(
    /^(?<lead>.+?)\.\s+(?<section>(?:[Ss]ection\s+)?[A-Z](?:,\s+[^.]+)?)$/u,
  );
  if (nlmSectionMatch?.groups?.lead && looksJournalLikeContainer(nlmSectionMatch.groups.lead.trim())) {
    return collapseJournalAbbreviationToInitialism(stripTrailingPunctuation(normalized));
  }

  const trailingClause = getBestTrailingContainerClause(normalized, (candidate) => looksJournalLikeContainer(candidate));
  if (trailingClause) {
    normalized = trailingClause;
  } else {
    const lastClause = getLastClause(normalized);
    if (lastClause && looksJournalLikeContainer(lastClause)) {
      normalized = lastClause;
    }
  }

  normalized = normalized.replace(/^(?:by\s+[^.]+\.\s*)/iu, '').trim();
  normalized = stripTrailingPunctuation(normalized);
  if (!normalized || looksLowQualityContainerCandidate(normalized)) {
    return null;
  }

  return collapseJournalAbbreviationToInitialism(normalized);
}

function countLeadingAuthorLikeNameSegments(value: string): number {
  const sample = value.trim().slice(0, 120);
  const match = sample.match(
    /^(?<lead>(?:(?:[A-Z][\p{L}'-]+\s+[A-Z](?:\.)?[,;]?\s*)|(?:[A-Z][\p{L}'-]+\s+[A-Z]\.\s*))+)/u,
  );
  if (!match?.groups?.lead) {
    return 0;
  }

  return match.groups.lead
    .split(/(?<=[.,])\s+|,\s+/u)
    .map((segment) => segment.trim())
    .filter((segment) => /^[A-Z][\p{L}'-]+\s+[A-Z](?:\.)?$/u.test(segment))
    .length;
}

function looksLikeAuthorSpill(value: string): boolean {
  const sample = value.trim().slice(0, 96);
  return (
    /^[A-Z][\p{L}'-]+,\s/iu.test(sample)
    || /^[A-Z][\p{L}'-]{2,}\.\s+[A-Z][\p{L}'-]{2,}/u.test(sample)
    || countLeadingAuthorLikeNameSegments(sample) >= 1
  );
}

function looksLikeLeadingAuthorSequence(value: string): boolean {
  const sample = value
    .replace(/^[,;:\s]+/u, '')
    .replace(/^(?:and|&)\s+/iu, '')
    .trim()
    .slice(0, 120);
  return (
    /^[\p{Lu}][\p{L}'’-]+\s+[\p{Lu}][\p{L}'’-]+,\s*(?:[\p{Lu}]\.\s*){1,4}(?:\s*(?:,|;|&|and)\s*|$)/u.test(sample)
    || /^[\p{Lu}][\p{L}'’-]+,\s*(?:[\p{Lu}]\.\s*){1,4}(?:\s*(?:,|;|&|and)\s*|$)/u.test(sample)
    || /^(?:[\p{Lu}]\.\s*){1,4}[\p{Lu}][\p{L}'’-]+(?:\s*(?:,|;|&|and)\s*|$)/u.test(sample)
  );
}

function hasIncompleteAuthorTail(value: string): boolean {
  return /(?:\b(?:and|&)\s+|\b)[A-Z]$/u.test(value.trim());
}

function isRecoverableAuthorSegment(
  value: string,
  parsedAuthors: CanonicalAuthor[],
): boolean {
  if (parsedAuthors.length === 0) {
    return false;
  }

  if (isValidAuthorSpanText(value, parsedAuthors)) {
    return true;
  }

  const normalized = value.trim();
  return (
    /^(?:[\p{L}'’-]+,\s*[\p{Lu}](?:\.)?(?:\s*[\p{Lu}](?:\.)?)?)(?:\s*(?:,|;|&|and)\s*[\p{L}'’-]+,\s*[\p{Lu}](?:\.)?(?:\s*[\p{Lu}](?:\.)?)?)+\.?$/u.test(normalized)
    || /^(?:[\p{L}'’-]+\s+[\p{Lu}](?:\.)?(?:\s*[\p{Lu}](?:\.)?)?)(?:\s*,\s*[\p{L}'’-]+\s+[\p{Lu}](?:\.)?(?:\s*[\p{Lu}](?:\.)?)?)+\.?$/u.test(normalized)
  );
}

function inferIssnFromIdentifier(value: string): string | null {
  const direct = value.match(/\b\d{4}-\d{3}[\dXx]\b/u)?.[0];
  if (direct) {
    return normalizeIssn(direct);
  }
  const compact = value.match(/\bS?(\d{8})\b/u)?.[1];
  if (compact) {
    return normalizeIssn(`${compact.slice(0, 4)}-${compact.slice(4)}`);
  }
  return null;
}

function inferArxivFromIdentifier(value: string): string | null {
  const direct = normalizeArxiv(value);
  if (direct) return direct;
  const match = value.match(PREPRINT_DOI_ID_REGEX);
  if (!match?.groups) return null;
  const { year, month, sequence } = match.groups;
  if (!year || !month || !sequence) return null;
  return `${year.slice(2)}${month}.${sequence}`;
}

function isPreprintPublisherTail(raw: string): boolean {
  return looksPreprintCue(raw);
}

function normalizeComparableText(value: string): string {
  return normalizeComparableTextCached(value);
}

const normalizeComparableTextCached = createBoundedStringCache(
  COMPARABLE_TEXT_CACHE_LIMIT,
  (value) => value
    .normalize('NFKC')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/&amp;/giu, '&')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase(),
);

function normalizeCueText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .normalize('NFKC')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/&amp;/giu, '&')
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

function hasWebpageAccessCue(value: string | null | undefined): boolean {
  return /\b(?:accessed|retrieved|available at|online)\b/u.test(normalizeCueText(value));
}

function hasReportCue(value: string | null | undefined): boolean {
  return /\b(?:report|standard|bulletin|technical report|white paper|working paper|guideline|specification|recommendation|geophysical abstracts)\b/u.test(
    normalizeCueText(value),
  );
}

const looksPreprintCueCached = createBoundedBooleanCache(
  PREPRINT_CUE_CACHE_LIMIT,
  (text) => /\b(?:preprint|preprints|arxiv|biorxiv|medrxiv|ssrn|zenodo|figshare|research square|techrxiv)\b/iu.test(text)
    || /10\.20944\/preprints/iu.test(text)
    || /10\.2139\/ssrn\./iu.test(text)
    || /10\.21203\/rs\./iu.test(text)
    || /10\.36227\/techrxiv\./iu.test(text),
);

const looksConferenceContainerCached = createBoundedBooleanCache(
  CONFERENCE_CONTAINER_CACHE_LIMIT,
  (text) => {
    if (isConferencePlaceholder(text)) return true;
    const normalized = stripIdentifierTail(stripTrailingPunctuation(text));
    if (!normalized) return false;
    if (CONFERENCE_CUE_REGEX.test(normalized)) return true;
    if (/advances in social science, education and humanities research/iu.test(normalized)) return true;
    if (looksProceedingsSeriesContainer(normalized)) return true;
    return looksProceedingsLikeContainer(normalized);
  },
);

function createBoundedValueCache<TValue>(
  limit: number,
  compute: (value: string) => TValue,
): (value: string) => TValue {
  const cache = new Map<string, TValue>();
  return (value: string) => {
    if (cache.has(value)) {
      return cache.get(value) as TValue;
    }
    const result = compute(value);
    cache.set(value, result);
    evictOldestCacheEntry(cache, limit);
    return result;
  };
}

function createBoundedStringCache(
  limit: number,
  compute: (value: string) => string,
): (value: string) => string {
  const cache = new Map<string, string>();
  return (value: string) => {
    const cached = cache.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const result = compute(value);
    cache.set(value, result);
    evictOldestCacheEntry(cache, limit);
    return result;
  };
}

function createBoundedBooleanCache(
  limit: number,
  compute: (value: string) => boolean,
): (value: string) => boolean {
  const cache = new Map<string, boolean>();
  return (value: string) => {
    const cached = cache.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const result = compute(value);
    cache.set(value, result);
    evictOldestCacheEntry(cache, limit);
    return result;
  };
}

function evictOldestCacheEntry<TValue>(cache: Map<string, TValue>, limit: number): void {
  if (cache.size <= limit) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

const PROPAGATABLE_FIELDS = [
  'authors',
  'title',
  'year',
  'journal',
  'volume',
  'issue',
  'pages',
  'publisher',
  'conferenceTitle',
  'bookTitle',
  'institution',
  'thesisType',
  'repository',
  'isbn',
  'issn',
  'handle',
  'patent',
  'siteName',
  'arxiv',
] as const satisfies ReadonlyArray<ExtractedFieldKey>;

function propagateSharedIdentifierFields(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
      continue;
    }
    groups.set(key, [carrier]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    for (const field of PROPAGATABLE_FIELDS) {
      const best = selectPropagationCandidate(group, field);
      if (!best) continue;

      for (const carrier of group) {
        const current = carrier.fields[field];
        if (!shouldAdoptPropagationValue(field, current.value, carrier)) continue;
        setExtractedField(
          carrier.fields,
          field,
          fieldOf(
            best.value,
            best.source,
            STAGE_ID,
            Math.max(0.74, best.confidence - 0.02),
            {
              origin: best.origin,
              previousValue: current.value,
              previousSource: current.source,
              previousOrigin: current.origin,
            },
          ) as ExtractedFields[typeof field],
        );
      }
    }
  }
}

function backfillIdentifierSiblingAuthors(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
      continue;
    }
    groups.set(key, [carrier]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    backfillIncompleteIdentifierAuthors(group);
  }
}

function promoteBestIdentifierAuthorLists(carriers: ReferenceCarrier[]): void {
  const bestByKey = new Map<string, ExtractedFields['authors']>();

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const authors = carrier.fields.authors;
    if (!Array.isArray(authors.value) || authors.value.length < 2) continue;
    if (isLowQualityPropagationValue('authors', authors.value)) continue;

    const existing = bestByKey.get(key);
    if (
      !existing
      || (Array.isArray(existing.value) && authors.value.length > existing.value.length)
      || authors.confidence > existing.confidence + 0.04
    ) {
      bestByKey.set(key, authors);
    }
  }

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const best = bestByKey.get(key);
    if (!best || !Array.isArray(best.value) || best.value.length < 2) continue;

    const currentAuthors = carrier.fields.authors.value;
    const currentCount = Array.isArray(currentAuthors) ? currentAuthors.length : 0;
    if (
      !needsIdentifierAuthorBackfill(carrier.raw, currentAuthors, best.value.length)
      && currentCount >= best.value.length
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'authors',
      fieldOf(
        best.value,
        best.source,
        STAGE_ID,
        Math.max(0.74, best.confidence - 0.02),
        {
          origin: best.origin,
          previousValue: carrier.fields.authors.value,
          previousSource: carrier.fields.authors.source,
          previousOrigin: carrier.fields.authors.origin,
        },
      ) as ExtractedFields['authors'],
    );
  }
}

function getPropagationGroupKey(carrier: ReferenceCarrier): string | null {
  const doi = normalizeDoi(carrier.fields.doi.value);
  if (doi) return scopePropagationGroupKey(carrier, `doi:${doi}`);

  const doiFromUrl = normalizeDoi(carrier.fields.url.value);
  if (doiFromUrl) return scopePropagationGroupKey(carrier, `doi:${doiFromUrl}`);

  const url = normalizePropagationUrl(carrier.fields.url.value);
  if (url) return scopePropagationGroupKey(carrier, `url:${url}`);

  const patent = normalizePatent(carrier.fields.patent.value);
  if (patent) return scopePropagationGroupKey(carrier, `patent:${patent}`);

  const handle = normalizeHandle(carrier.fields.handle.value);
  if (handle) return scopePropagationGroupKey(carrier, `handle:${handle}`);

  const arxiv = normalizeArxiv(carrier.fields.arxiv.value);
  if (arxiv) return scopePropagationGroupKey(carrier, `arxiv:${arxiv}`);

  return null;
}

function scopePropagationGroupKey(carrier: ReferenceCarrier, key: string): string {
  return carrier.semanticGroupKey
    ? `${carrier.semanticGroupKey}::${key}`
    : key;
}

function selectPropagationCandidate(
  carriers: ReferenceCarrier[],
  field: (typeof PROPAGATABLE_FIELDS)[number],
): ExtractedFields[typeof field] | null {
  const groupHasConferenceEvidence =
    field === 'conferenceTitle'
    && carriers.some((carrier) => {
      const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      return (
        CONFERENCE_DOI_REGEX.test(carrier.raw)
        || CONFERENCE_CUE_REGEX.test(carrier.raw)
        || looksConferenceContainer(conferenceTitle)
        || looksConferencePublicationVenue(conferenceTitle)
        || Boolean(recoverCompactConferenceAliasFromDoi(typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined, carrier.raw))
      );
    });
  const candidates = field === 'conferenceTitle'
    ? buildConferencePropagationCandidates(carriers, groupHasConferenceEvidence)
    : carriers
      .map((carrier) => carrier.fields[field])
      .filter((candidate) => hasFieldValue(candidate))
      .filter((candidate) => !isLowQualityPropagationValue(field, candidate.value));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => propagationScore(field, right.value, right.confidence) - propagationScore(field, left.value, left.confidence));
  return candidates[0] ?? null;
}

function recoverConferenceTitlesFromRaw(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    if (hasFieldValue(carrier.fields.conferenceTitle) || !hasFieldValue(carrier.fields.title)) {
      continue;
    }
    const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;
    if (!title) {
      continue;
    }
    const hasArticleLocators =
      hasFieldValue(carrier.fields.volume)
      || hasFieldValue(carrier.fields.issue)
      || hasFieldValue(carrier.fields.pages);
    if (hasArticleLocators) {
      continue;
    }

    const normalizedRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(carrier.raw));
    const temporalConference =
      recoverStrongTemporalConferenceFromRaw(normalizedRaw)?.conferenceTitle
      ?? parseAuthorDateTemporalConferenceReference(normalizedRaw)?.conferenceTitle
      ?? parseMlaTemporalConferenceReference(normalizedRaw)?.conferenceTitle
      ?? recoverConferenceContainerAfterTitle(carrier.raw, title);
    let normalizedTemporalConference = temporalConference
      ? normalizeConferenceTitle(temporalConference)
      : null;
    if (
      normalizedTemporalConference
      && /,\s*$/u.test(normalizedTemporalConference)
    ) {
      const completedTemporalConference = normalizedRaw.match(
        new RegExp(`${escapeRegex(normalizedTemporalConference)}\\s*(?<year>(?:19|20)\\d{2})(?:\\b|[.,])`, 'iu'),
      )?.groups?.year;
      if (completedTemporalConference) {
        normalizedTemporalConference = `${normalizedTemporalConference} ${completedTemporalConference}`;
      }
    }
    if (
      !normalizedTemporalConference
      || looksLowQualityContainerCandidate(normalizedTemporalConference)
      || looksPublisherLike(normalizedTemporalConference)
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'conferenceTitle',
      fieldOf(
        normalizedTemporalConference,
        carrier.fields.title.source,
        STAGE_ID,
        Math.max(0.78, carrier.fields.title.confidence - 0.02),
        {
          origin: carrier.fields.title.origin,
          previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
          previousSource: carrier.fields.conferenceTitle.source,
          previousOrigin: carrier.fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
  }
}

function restoreConferencePublisherPreviousValues(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    if (hasFieldValue(carrier.fields.publisher) || !hasFieldValue(carrier.fields.conferenceTitle)) {
      continue;
    }
    const previousPublisherValue =
      typeof (carrier.fields.publisher as { previousValue?: unknown }).previousValue === 'string'
        ? String((carrier.fields.publisher as { previousValue?: unknown }).previousValue)
        : null;
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const title = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : null;
    const normalizedPreviousPublisher = normalizeConferencePublisherSlotCandidate(
      previousPublisherValue,
      title,
      conferenceTitle,
    ) ?? (
      previousPublisherValue
      && previousPublisherValue.replace(/^[\s"'“”'‘’.,;:]+/u, '').trim().split(/\s+/u).filter(Boolean).length >= 2
      && normalizeComparableText(previousPublisherValue) !== normalizeComparableText(conferenceTitle ?? '')
        ? normalizeConferenceTitle(previousPublisherValue.replace(/^[\s"'“”'‘’.,;:]+/u, ''))
        : null
    );
    if (
      !normalizedPreviousPublisher
      || (conferenceTitle && normalizeComparableText(normalizedPreviousPublisher) === normalizeComparableText(conferenceTitle))
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        normalizedPreviousPublisher,
        carrier.fields.publisher.source,
        STAGE_ID,
        0.76,
        {
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }
}

function propagateConferenceTitlesFromSiblingsFinal(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();
  for (const carrier of carriers) {
    const key = getPropagationGroupKey(carrier);
    if (!key || carrier.doiFastPath) {
      continue;
    }
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
    } else {
      groups.set(key, [carrier]);
    }
  }

  for (const group of groups.values()) {
    const bestConferenceTitle = group
      .map((carrier) => carrier.fields.conferenceTitle)
      .filter((field) => hasFieldValue(field) && typeof field.value === 'string')
      .sort((left, right) => propagationScore('conferenceTitle', right.value, right.confidence) - propagationScore('conferenceTitle', left.value, left.confidence))[0];
    if (!bestConferenceTitle || typeof bestConferenceTitle.value !== 'string') {
      continue;
    }

    for (const carrier of group) {
      const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : null;
      const currentPublisher = typeof carrier.fields.publisher.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.publisher.value)
        : null;
      const currentInstitution = typeof carrier.fields.institution.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.institution.value)
        : null;
      const currentLooksWeak =
        currentConferenceTitle == null
        || currentConferenceTitle.length === 0
        || normalizeComparableText(currentConferenceTitle) === normalizeComparableText(currentPublisher ?? '')
        || normalizeComparableText(currentConferenceTitle) === normalizeComparableText(currentInstitution ?? '')
        || (
          !looksConferencePublicationVenue(currentConferenceTitle)
          && !shouldPreserveConferenceTemporalTail(currentConferenceTitle)
          && !CONFERENCE_KEYWORD_REGEX.test(currentConferenceTitle)
        );
      if (!currentLooksWeak) {
        continue;
      }
      const hasArticleLocators =
        hasFieldValue(carrier.fields.volume)
        || hasFieldValue(carrier.fields.issue)
        || hasFieldValue(carrier.fields.pages);
      if (hasArticleLocators) {
        continue;
      }

      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          bestConferenceTitle.value,
          bestConferenceTitle.source,
          STAGE_ID,
          Math.max(0.76, bestConferenceTitle.confidence - 0.02),
          {
            origin: bestConferenceTitle.origin,
            previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
    }
  }
}

function backfillConferencePublishersFromRawGroups(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();
  for (const carrier of carriers) {
    const key = getPropagationGroupKey(carrier);
    if (!key || carrier.doiFastPath) {
      continue;
    }
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
    } else {
      groups.set(key, [carrier]);
    }
  }

  for (const group of groups.values()) {
    const bestConferenceTitle = group
      .map((carrier) => carrier.fields.conferenceTitle)
      .filter((field) => hasFieldValue(field) && typeof field.value === 'string')
      .sort((left, right) => propagationScore('conferenceTitle', right.value, right.confidence) - propagationScore('conferenceTitle', left.value, left.confidence))[0];
    if (!bestConferenceTitle || typeof bestConferenceTitle.value !== 'string') {
      continue;
    }

    const rawPublisherCandidates = group
      .map((carrier) => {
        const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;
        const literalCandidate =
          normalizeConferencePublisherSlotCandidate(
            carrier.raw.match(/[”"'’]\.?\s*(?<publisher>.+?)\.\s*Available at:/iu)?.groups?.publisher,
            title,
            bestConferenceTitle.value,
          )
          ?? normalizeConferencePublisherSlotCandidate(
            carrier.raw.match(/(?:[”"'’]|,)\s*(?<publisher>.+?)\s*[;,]\s*(?:19|20)\d{2}(?:\b|[.,])/iu)?.groups?.publisher,
            title,
            bestConferenceTitle.value,
          );
        if (!literalCandidate) {
          return null;
        }
        return fieldOf(
          literalCandidate,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.78, carrier.fields.title.confidence - 0.02),
          {
            origin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['publisher'];
      })
      .filter((candidate): candidate is ExtractedFields['publisher'] => candidate != null)
      .sort((left, right) => conferencePublisherPropagationScore(right.value, right.confidence) - conferencePublisherPropagationScore(left.value, left.confidence));

    const bestPublisher = rawPublisherCandidates[0];
    if (!bestPublisher || typeof bestPublisher.value !== 'string') {
      continue;
    }

    for (const carrier of group) {
      if (
        hasFieldValue(carrier.fields.publisher)
        && !isLowQualityPropagationValue('publisher', carrier.fields.publisher.value)
      ) {
        continue;
      }
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          bestPublisher.value,
          bestPublisher.source,
          STAGE_ID,
          Math.max(0.76, bestPublisher.confidence - 0.02),
          {
            origin: bestPublisher.origin,
            previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }
  }
}

function recoverConferencePublishersFromRaw(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const title = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : null;
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const journal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const publisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const hasConferenceEvidence =
      Boolean(conferenceTitle)
      || CONFERENCE_DOI_REGEX.test(carrier.raw)
      || looksProceedingsLikeDoi(typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined)
      || Boolean(journal && CONFERENCE_KEYWORD_REGEX.test(journal));
    if (!title || !hasConferenceEvidence) {
      continue;
    }

    const recoveredPublisher =
      recoverStandaloneConferencePublisherSlot(carrier.raw, title, conferenceTitle)
      ?? recoverLooseConferencePublisherSlot(carrier.raw, title, conferenceTitle)
      ?? normalizeConferencePublisherSlotCandidate(
        carrier.raw.match(/[”"'’]\.?\s*(?<publisher>.+?)\.\s*Available at:/iu)?.groups?.publisher,
        title,
        conferenceTitle,
      )
      ?? normalizeConferencePublisherSlotCandidate(
        carrier.raw.match(/(?:[”"'’]|,)\s*(?<publisher>.+?)\s*[;,]\s*(?:19|20)\d{2}(?:\b|[.,])/iu)?.groups?.publisher,
        title,
        conferenceTitle,
      )
      ?? (() => {
        const extractedTail = extractTailAfterTitle(carrier.raw, title);
        const candidate = extractedTail
          ? extractedTail
            .replace(/^[\s"'“”'‘’.,;:]+/u, '')
            .replace(/\s*(?:Available at|Retrieved from|doi:|https?:\/\/).+$/iu, '')
            .replace(/\s*[;,]\s*(?:19|20)\d{2}(?:\b|[.,]).*$/iu, '')
            .replace(/[.,;:\s]+$/u, '')
            .trim()
          : '';
        return normalizeConferencePublisherSlotCandidate(candidate, title, conferenceTitle);
      })();
    if (
      !recoveredPublisher
      || (conferenceTitle && normalizeComparableText(recoveredPublisher) === normalizeComparableText(conferenceTitle))
    ) {
      continue;
    }

    const shouldReplace =
      !publisher
      || normalizeComparableText(recoveredPublisher).includes(normalizeComparableText(publisher))
      || (
        publisher.length + 4 <= recoveredPublisher.length
        && !looksPublisherLike(publisher)
        && !looksInstitutionalContainer(publisher)
        && !looksStandaloneInstitutionalAlias(publisher)
        && !looksReportPublisherAcronym(publisher)
        && !looksOstiLikeOwner(publisher)
      );
    if (!shouldReplace) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        recoveredPublisher,
        carrier.fields.title.source,
        STAGE_ID,
        Math.max(0.78, carrier.fields.title.confidence - 0.02),
        {
          origin: carrier.fields.title.origin,
          previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }
}

function repairCarrierArticlePublisherSpills(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const title = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : null;
    const journal = typeof carrier.fields.journal.value === 'string'
      ? carrier.fields.journal.value
      : null;
    const publisher = typeof carrier.fields.publisher.value === 'string'
      ? carrier.fields.publisher.value
      : null;
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const doi = typeof carrier.fields.doi.value === 'string'
      ? carrier.fields.doi.value
      : undefined;
    const hasBookishIdentifier =
      hasFieldValue(carrier.fields.bookTitle)
      || hasFieldValue(carrier.fields.isbn)
      || looksBookChapterDoi(doi)
      || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? '');
    const hasArticleLocators =
      hasFieldValue(carrier.fields.volume)
      || hasFieldValue(carrier.fields.issue)
      || hasFieldValue(carrier.fields.pages);
    const hasConferenceEvidence =
      Boolean(conferenceTitle)
      || CONFERENCE_DOI_REGEX.test(carrier.raw)
      || looksProceedingsLikeDoi(doi)
      || /\bpaper presented at\b/iu.test(carrier.raw)
      || looksConferencePublicationVenue(publisher ?? undefined);
    if (!title || !publisher || !hasArticleLocators || hasBookishIdentifier || hasConferenceEvidence) {
      continue;
    }
    if (!journal) {
      if (
        looksConferencePublicationVenue(publisher)
        || looksConferenceContainer(publisher)
      ) {
        continue;
      }
      const literalPublisherCandidate = stripTrailingPunctuation(publisher).trim();
      const recoveredJournal =
        normalizeJournalCandidate(publisher, title)
        ?? (
          looksJournalLikeContainer(publisher)
          && !looksConferencePublicationVenue(publisher)
          && !looksConferenceContainer(publisher)
            ? literalPublisherCandidate
            : null
        )
        ?? (
          literalPublisherCandidate.split(/\s+/u).filter(Boolean).length >= 2
          && literalPublisherCandidate.split(/\s+/u).filter(Boolean).length <= 5
          && /^[\p{L}&.'’‘ -]+$/u.test(literalPublisherCandidate)
          && !looksPublisherLike(literalPublisherCandidate)
          && !looksInstitutionalContainer(literalPublisherCandidate)
          && !looksStandaloneInstitutionalAlias(literalPublisherCandidate)
          && !looksConferencePublicationVenue(literalPublisherCandidate)
          && !looksConferenceContainer(literalPublisherCandidate)
            ? literalPublisherCandidate
            : null
        );
      if (!recoveredJournal) {
        continue;
      }
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          recoveredJournal,
          carrier.fields.publisher.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.publisher.confidence),
          {
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          null,
          carrier.fields.publisher.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
      continue;
    }
    if (
      looksPublisherLike(publisher)
      || looksInstitutionalContainer(publisher)
      || !normalizeComparableText(publisher).includes(normalizeComparableText(journal))
    ) {
      continue;
    }

    const repaired = repairArticlePublisherLocatorSpill(carrier.raw, title, journal, publisher);
    if (repaired?.title) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          repaired.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
    }
    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        null,
        carrier.fields.publisher.source,
        STAGE_ID,
        0,
        {
          uncertain: true,
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }
}

function repairConferenceDoiFastPathSpills(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined;
    const doiConferenceTitleHint = recoverConferenceTitleFromDoiHint(doi);
    const doiPublisherHint = inferPublisherFromDoiHint(doi);
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const publisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const title = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : null;
    const hasConferenceEvidence =
      Boolean(conferenceTitle)
      || Boolean(doiConferenceTitleHint)
      || CONFERENCE_DOI_REGEX.test(carrier.raw)
      || looksProceedingsLikeDoi(doi);
    if (!hasConferenceEvidence) {
      continue;
    }

    const recoveredQuotedConference = recoverQuotedConferenceSegmentsFromRaw(
      carrier.raw,
      conferenceTitle ?? doiConferenceTitleHint,
      doi,
    );
    if (recoveredQuotedConference) {
      if (
        !hasFieldValue(carrier.fields.authors)
        || (Array.isArray(carrier.fields.authors.value) && carrier.fields.authors.value.length === 0)
      ) {
        setExtractedField(
          carrier.fields,
          'authors',
          fieldOf(
            recoveredQuotedConference.authors,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.title.confidence - 0.02),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
              previousSource: carrier.fields.authors.source,
              previousOrigin: carrier.fields.authors.origin,
            },
          ) as ExtractedFields['authors'],
        );
      }

      const titleLooksSpilled =
        !title
        || title.includes(',"')
        || title.includes(',”')
        || (
          publisher != null
          && normalizeComparableText(title).includes(normalizeComparableText(publisher))
        );
      if (titleLooksSpilled) {
        const cleanedRecoveredTitle = recoveredQuotedConference.publisher
          ? stripTrailingPunctuation(
            recoveredQuotedConference.title.replace(
              new RegExp(`(?:["”]?\\s*,\\s*)?${escapeRegex(recoveredQuotedConference.publisher)}$`, 'iu'),
              '',
            ),
          ).trim()
          : recoveredQuotedConference.title;
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            cleanedRecoveredTitle,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }

      if (
        recoveredQuotedConference.publisher
        && (
          !publisher
          || looksConferencePublicationVenue(publisher)
          || looksConferenceContainer(publisher)
          || normalizeComparableText(recoveredQuotedConference.publisher) !== normalizeComparableText(publisher)
        )
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            recoveredQuotedConference.publisher,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.title.confidence - 0.02),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
    }

    const refreshedConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : doiConferenceTitleHint;
    const refreshedPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const refreshedTitle = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : null;

    if (
      doiPublisherHint
      && (
        !refreshedPublisher
        || /^(?:available at|retrieved from)$/iu.test(refreshedPublisher)
        || normalizeComparableText(refreshedPublisher) === normalizeComparableText(refreshedConferenceTitle ?? '')
        || (
          refreshedConferenceTitle != null
          && normalizeComparableText(refreshedConferenceTitle).startsWith(normalizeComparableText(refreshedPublisher))
        )
        || looksConferencePublicationVenue(refreshedPublisher)
        || looksConferenceContainer(refreshedPublisher)
        || (
          refreshedTitle != null
          && normalizeComparableText(refreshedPublisher).startsWith(normalizeComparableText(refreshedTitle))
        )
      )
    ) {
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          doiPublisherHint,
          carrier.fields.publisher.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.publisher.confidence),
          {
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }

    const finalPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    if (
      finalPublisher
      && refreshedTitle
    ) {
      const aliasSpillMatch = normalizeInlineQuoteCharacters(finalPublisher).match(
        /^(?<title>.+?)(?:["”]?\s*,\s*["”]?|\s*["”]\s+)(?<alias>[A-Z][A-Z0-9&./-]{2,18})$/u,
      );
      const aliasTitle = aliasSpillMatch?.groups?.title;
      const alias = aliasSpillMatch?.groups?.alias;
      if (
        aliasTitle
        && alias
        && normalizeComparableText(aliasTitle).startsWith(normalizeComparableText(refreshedTitle))
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            alias,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
    }
  }
}

function forceRestoreConferencePublisherPreviousValues(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    if (hasFieldValue(carrier.fields.publisher) || !hasFieldValue(carrier.fields.conferenceTitle)) {
      continue;
    }
    const previousPublisherValue =
      typeof (carrier.fields.publisher as { previousValue?: unknown }).previousValue === 'string'
        ? String((carrier.fields.publisher as { previousValue?: unknown }).previousValue)
        : null;
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const restoredPublisher = previousPublisherValue
      ? normalizeConferenceTitle(previousPublisherValue.replace(/^[\s"'“”'‘’.,;:]+/u, ''))
      : null;
    if (
      !restoredPublisher
      || restoredPublisher.split(/\s+/u).filter(Boolean).length < 2
      || normalizeComparableText(restoredPublisher) === normalizeComparableText(conferenceTitle ?? '')
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        restoredPublisher,
        carrier.fields.publisher.source,
        STAGE_ID,
        0.74,
        {
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }
}

function recoverBookChapterPublisherFromRaw(
  raw: string,
  bookTitle: string,
  titleHint?: string | null,
): string | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  if (!parseableRaw) {
    return null;
  }

  const patterns = [
    new RegExp(
      `In:?\\s+${escapeRegex(bookTitle)}\\s*(?:\\(pp?\\.[^)]+\\))?\\.\\s*(?<publisher>[^.]+?)(?:\\.\\s*(?:19|20)\\d{2}\\b|$)`,
      'iu',
    ),
    new RegExp(
      `${escapeRegex(bookTitle)}\\s*,\\s*(?<publisher>[^,;]+?)\\s*[;,]\\s*(?:19|20)\\d{2}\\b`,
      'iu',
    ),
    new RegExp(
      `${escapeRegex(bookTitle)}\\s*\\.\\s*(?<publisher>[^.]+?)\\.(?:\\s*(?:19|20)\\d{2}\\b|$)`,
      'iu',
    ),
  ];

  for (const pattern of patterns) {
    const candidate = parseableRaw.match(pattern)?.groups?.publisher;
    const normalized = candidate
      ? normalizePublisherCandidate(candidate, titleHint ?? undefined)
        ?? normalizeConferenceTitle(candidate)
      : null;
    if (
      normalized
      && !looksConferencePublicationVenue(normalized)
      && !looksConferenceContainer(normalized)
      && !looksJournalLikeContainer(normalized)
    ) {
      return normalized;
    }
  }

  return null;
}

function recoverLeadingDottedGivenFromRaw(
  raw: string,
  family: string,
): string | null {
  const normalizedRaw = normalizeInlineQuoteCharacters(raw);
  const match = normalizedRaw.match(
    new RegExp(
      `^(?:\\[\\d+\\]\\s*)?(?<given>(?:[A-ZА-Я]\\.\\s*){1,4})${escapeRegex(family)}\\b`,
      'iu',
    ),
  );
  return match?.groups?.given?.replace(/\s+/gu, ' ').trim() ?? null;
}

function applyLateFieldRoutingRepairs(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;
    const journal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const bookTitle = typeof carrier.fields.bookTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.bookTitle.value)
      : null;
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const publisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const institution = typeof carrier.fields.institution.value === 'string'
      ? normalizeInstitutionCandidate(carrier.fields.institution.value)
      : null;
    const siteName = typeof carrier.fields.siteName.value === 'string'
      ? normalizeSiteNameCandidate(carrier.fields.siteName.value)
      : null;
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined;
    const hasVolumeOrIssue =
      hasFieldValue(carrier.fields.volume)
      || hasFieldValue(carrier.fields.issue);
    const hasConferenceEvidence =
      Boolean(conferenceTitle)
      || CONFERENCE_DOI_REGEX.test(carrier.raw)
      || looksProceedingsLikeDoi(doi);
    const hasBookishIdentifier =
      Boolean(bookTitle)
      || hasFieldValue(carrier.fields.isbn)
      || looksBookChapterDoi(doi)
      || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? '');
    const url = typeof carrier.fields.url.value === 'string' ? carrier.fields.url.value : null;
    const hasNonDoiUrl = typeof url === 'string' && !isDoiUrl(url);
    const currentAuthors = Array.isArray(carrier.fields.authors.value)
      ? carrier.fields.authors.value
      : [];
    const primaryCorporateOwner = currentAuthors
      .map((author) => getCorporateAuthorLabel(author))
      .find((value): value is string => typeof value === 'string' && value.length > 0)
      ?? institution
      ?? recoverLeadingCorporateOwnerFromRaw(carrier.raw);
    const normalizedRaw = normalizeComparableText(carrier.raw);

    if (title && bookTitle) {
      const repairedBookTitlePublisherOverflow = trimPublisherAndLocatorTailFromBookTitle(
        title,
        bookTitle,
        publisher,
      );
      if (repairedBookTitlePublisherOverflow) {
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            repairedBookTitlePublisherOverflow.title,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
        setExtractedField(
          carrier.fields,
          'bookTitle',
          fieldOf(
            repairedBookTitlePublisherOverflow.bookTitle,
            carrier.fields.bookTitle.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.bookTitle.confidence),
            {
              origin: carrier.fields.bookTitle.origin,
              previousValue: carrier.fields.bookTitle.value as ExtractedFields['bookTitle']['value'],
              previousSource: carrier.fields.bookTitle.source,
              previousOrigin: carrier.fields.bookTitle.origin,
            },
          ) as ExtractedFields['bookTitle'],
        );
      }

      const echoedBookTitleMatch = bookTitle.match(/^(?<echo>.+?)\.\s+In\s+(?<container>.+)$/iu);
      const echoedTitleFragment = stripTrailingPunctuation(echoedBookTitleMatch?.groups?.echo ?? '');
      const repairedBookTitle = echoedBookTitleMatch?.groups?.container
        ? normalizeConferenceTitle(echoedBookTitleMatch.groups.container)
        : null;
      if (
        repairedBookTitle
        && !looksLowQualityContainerCandidate(repairedBookTitle)
      ) {
        setExtractedField(
          carrier.fields,
          'bookTitle',
          fieldOf(
            repairedBookTitle,
            carrier.fields.bookTitle.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.bookTitle.confidence),
            {
              origin: carrier.fields.bookTitle.origin,
              previousValue: carrier.fields.bookTitle.value as ExtractedFields['bookTitle']['value'],
              previousSource: carrier.fields.bookTitle.source,
              previousOrigin: carrier.fields.bookTitle.origin,
            },
          ) as ExtractedFields['bookTitle'],
        );
        if (echoedTitleFragment) {
          const comparableTitle = normalizeComparableText(title);
          const comparableEchoedTitleFragment = normalizeComparableText(echoedTitleFragment);
          if (
            comparableEchoedTitleFragment.length > 0
            && !comparableTitle.endsWith(comparableEchoedTitleFragment)
          ) {
            const repairedTitle = normalizeTitleCandidate(
              /\bin\b/iu.test(echoedTitleFragment)
                ? `${stripTrailingPunctuation(title)}. ${echoedTitleFragment}`
                : `${stripTrailingPunctuation(title)}. in ${echoedTitleFragment}`,
            );
            if (repairedTitle) {
              setExtractedField(
                carrier.fields,
                'title',
                fieldOf(
                  repairedTitle,
                  carrier.fields.title.source,
                  STAGE_ID,
                  Math.max(0.82, carrier.fields.title.confidence),
                  {
                    origin: carrier.fields.title.origin,
                    previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
                    previousSource: carrier.fields.title.source,
                    previousOrigin: carrier.fields.title.origin,
                  },
                ) as ExtractedFields['title'],
              );
            }
          }
        }
      }

      const trailingContainer = getBestTrailingContainerClause(
        bookTitle,
        (candidate) =>
          candidate.split(/\s+/u).filter(Boolean).length >= 3
          && !looksLowQualityContainerCandidate(candidate)
          && !looksInstitutionalContainer(candidate)
          && !looksPublisherLike(candidate),
      );
      const normalizedTrailingContainer = trailingContainer
        ? normalizeConferenceTitle(trailingContainer)
        : null;
      if (
        normalizedTrailingContainer
        && normalizeComparableText(normalizedTrailingContainer) !== normalizeComparableText(bookTitle)
      ) {
        const leadingOverflowMatch = bookTitle.match(
          new RegExp(`^(?<overflow>.+?)\\.\\s+${escapeRegex(normalizedTrailingContainer)}$`, 'iu'),
        );
        const leadingOverflowFragment = stripTrailingPunctuation(
          leadingOverflowMatch?.groups?.overflow ?? '',
        );
        setExtractedField(
          carrier.fields,
          'bookTitle',
          fieldOf(
            normalizedTrailingContainer,
            carrier.fields.bookTitle.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.bookTitle.confidence),
            {
              origin: carrier.fields.bookTitle.origin,
              previousValue: carrier.fields.bookTitle.value as ExtractedFields['bookTitle']['value'],
              previousSource: carrier.fields.bookTitle.source,
              previousOrigin: carrier.fields.bookTitle.origin,
            },
          ) as ExtractedFields['bookTitle'],
        );
        if (leadingOverflowFragment) {
          const comparableTitle = normalizeComparableText(title);
          const comparableLeadingOverflow = normalizeComparableText(leadingOverflowFragment);
          if (
            comparableLeadingOverflow.length > 0
            && !comparableTitle.endsWith(comparableLeadingOverflow)
          ) {
            const repairedTitle = normalizeTitleCandidate(
              /\bin\b/iu.test(leadingOverflowFragment)
                ? `${stripTrailingPunctuation(title)}. ${leadingOverflowFragment}`
                : `${stripTrailingPunctuation(title)}. in ${leadingOverflowFragment}`,
            );
            if (repairedTitle) {
              setExtractedField(
                carrier.fields,
                'title',
                fieldOf(
                  repairedTitle,
                  carrier.fields.title.source,
                  STAGE_ID,
                  Math.max(0.82, carrier.fields.title.confidence),
                  {
                    origin: carrier.fields.title.origin,
                    previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
                    previousSource: carrier.fields.title.source,
                    previousOrigin: carrier.fields.title.origin,
                  },
                ) as ExtractedFields['title'],
              );
            }
          }
        }
      }
    }

    if (
      hasBookishIdentifier
      && !hasConferenceEvidence
      && !hasVolumeOrIssue
      && !hasNonDoiUrl
      && primaryCorporateOwner
    ) {
      const normalizedOwner = normalizeComparableText(primaryCorporateOwner);
      const repeatedOwner =
        normalizedOwner.length > 0
        && normalizedRaw.split(normalizedOwner).length - 1 >= 2;

      if (repeatedOwner) {
        if (!publisher) {
          setExtractedField(
            carrier.fields,
            'publisher',
            fieldOf(
              primaryCorporateOwner,
              carrier.fields.publisher.source,
              STAGE_ID,
              Math.max(0.84, carrier.fields.publisher.confidence),
              {
                origin: carrier.fields.publisher.origin,
                previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
                previousSource: carrier.fields.publisher.source,
                previousOrigin: carrier.fields.publisher.origin,
              },
            ) as ExtractedFields['publisher'],
          );
        }

        if (!journal) {
          setExtractedField(
            carrier.fields,
            'journal',
            fieldOf(
              primaryCorporateOwner,
              carrier.fields.journal.source,
              STAGE_ID,
              Math.max(0.8, carrier.fields.journal.confidence),
              {
                origin: carrier.fields.journal.origin,
                previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
                previousSource: carrier.fields.journal.source,
                previousOrigin: carrier.fields.journal.origin,
              },
            ) as ExtractedFields['journal'],
          );
        }

        const corporateOwnerAuthor: CanonicalAuthor = {
          family: primaryCorporateOwner,
          given: null,
          initials: null,
          literal: primaryCorporateOwner,
          isCorporate: true,
        };

        if (
          currentAuthors.length === 0
          || currentAuthors.every((author) => !author.isCorporate)
        ) {
          setExtractedField(
            carrier.fields,
            'authors',
            fieldOf(
              [corporateOwnerAuthor],
              carrier.fields.authors.source,
              STAGE_ID,
              Math.max(0.84, carrier.fields.authors.confidence),
              {
                origin: carrier.fields.authors.origin,
                previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
                previousSource: carrier.fields.authors.source,
                previousOrigin: carrier.fields.authors.origin,
              },
            ) as ExtractedFields['authors'],
          );
        } else if (currentAuthors.length > 1) {
          const cleanedAuthors = currentAuthors.filter((author, index) => {
            const label = getCorporateAuthorLabel(author);
            if (!label) {
              return true;
            }
            if (index === 0) {
              return true;
            }
            const comparableLabel = normalizeComparableText(label);
            return (
              comparableLabel.length > 0
              && comparableLabel !== normalizedOwner
              && !title?.toLocaleLowerCase().includes(label.toLocaleLowerCase())
            );
          });
          if (cleanedAuthors.length > 0 && cleanedAuthors.length !== currentAuthors.length) {
            setExtractedField(
              carrier.fields,
              'authors',
              fieldOf(
                cleanedAuthors,
                carrier.fields.authors.source,
                STAGE_ID,
                Math.max(0.84, carrier.fields.authors.confidence),
                {
                  origin: carrier.fields.authors.origin,
                  previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
                  previousSource: carrier.fields.authors.source,
                  previousOrigin: carrier.fields.authors.origin,
                },
              ) as ExtractedFields['authors'],
            );
          }
        } else if (currentAuthors.length === 1 && !currentAuthors[0]?.isCorporate) {
          setExtractedField(
            carrier.fields,
            'authors',
            fieldOf(
              [corporateOwnerAuthor],
              carrier.fields.authors.source,
              STAGE_ID,
              Math.max(0.84, carrier.fields.authors.confidence),
              {
                origin: carrier.fields.authors.origin,
                previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
                previousSource: carrier.fields.authors.source,
                previousOrigin: carrier.fields.authors.origin,
              },
            ) as ExtractedFields['authors'],
          );
        }
      }
    }

    const quotedRepeatedInstitutionalOwnerReport =
      !hasBookishIdentifier
      && !hasConferenceEvidence
      && !hasVolumeOrIssue
      && !hasNonDoiUrl
      && !conferenceTitle
      && !bookTitle
        ? recoverQuotedRepeatedInstitutionalOwnerReportFromRaw(carrier.raw)
        : null;
    const repeatedInstitutionalOwnerReportWithoutYear =
      !hasBookishIdentifier
      && !hasConferenceEvidence
      && !hasVolumeOrIssue
      && !hasNonDoiUrl
      && !conferenceTitle
      && !bookTitle
        ? recoverRepeatedInstitutionalOwnerReportWithoutYearFromRaw(carrier.raw)
        : null;
    const repeatedInstitutionalOwnerProfile =
      (quotedRepeatedInstitutionalOwnerReport != null || repeatedInstitutionalOwnerReportWithoutYear != null)
      && (
        journal == null
        || normalizeComparableText(journal)
          === normalizeComparableText(
            quotedRepeatedInstitutionalOwnerReport?.owner
            ?? repeatedInstitutionalOwnerReportWithoutYear?.owner
            ?? '',
          )
      );
    const resolvedOwnerLead =
      quotedRepeatedInstitutionalOwnerReport?.owner
      ?? repeatedInstitutionalOwnerReportWithoutYear?.owner
      ?? primaryCorporateOwner;
    const repeatedInstitutionalOwnerTitle =
      quotedRepeatedInstitutionalOwnerReport?.title
      ?? repeatedInstitutionalOwnerReportWithoutYear?.title
      ?? null;
    const reportLikeOwnerDoi =
      resolvedOwnerLead != null
      && looksReportLikeDoi(doi ?? undefined, {
        raw: carrier.raw,
        owner: resolvedOwnerLead,
      });
    if (
      !hasBookishIdentifier
      && !hasConferenceEvidence
      && !hasVolumeOrIssue
      && !hasNonDoiUrl
      && resolvedOwnerLead
      && (reportLikeOwnerDoi || repeatedInstitutionalOwnerProfile)
    ) {
      const resolvedOwner = resolvedOwnerLead;
      const normalizedOwner = normalizeComparableText(resolvedOwner);
      const repeatedOwner =
        normalizedOwner.length > 0
        && normalizedRaw.split(normalizedOwner).length - 1 >= 2;
      const journalMatchesOwner =
        journal != null
        && normalizeComparableText(journal) === normalizedOwner;
      const mirroredOwnerAuthor =
        currentAuthors.length === 1
        && matchesInstitutionalOwner(currentAuthors[0], resolvedOwner);

      if (repeatedOwner || journalMatchesOwner || mirroredOwnerAuthor || repeatedInstitutionalOwnerProfile) {
        if (repeatedInstitutionalOwnerTitle) {
          setExtractedField(
            carrier.fields,
            'title',
            fieldOf(
              repeatedInstitutionalOwnerTitle,
              carrier.fields.title.source,
              STAGE_ID,
              Math.max(0.84, carrier.fields.title.confidence),
              {
                origin: carrier.fields.title.origin,
                previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
                previousSource: carrier.fields.title.source,
                previousOrigin: carrier.fields.title.origin,
              },
            ) as ExtractedFields['title'],
          );
        }

        if (!institution) {
          setExtractedField(
            carrier.fields,
            'institution',
            fieldOf(
              resolvedOwner,
              carrier.fields.institution.source,
              STAGE_ID,
              Math.max(0.84, carrier.fields.institution.confidence),
              {
                origin: carrier.fields.institution.origin,
                previousValue: carrier.fields.institution.value as ExtractedFields['institution']['value'],
                previousSource: carrier.fields.institution.source,
                previousOrigin: carrier.fields.institution.origin,
              },
            ) as ExtractedFields['institution'],
          );
        }

        if (journalMatchesOwner || repeatedOwner || repeatedInstitutionalOwnerProfile) {
          setExtractedField(
            carrier.fields,
            'journal',
            fieldOf(
              null,
              carrier.fields.journal.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.journal.origin,
                previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
                previousSource: carrier.fields.journal.source,
                previousOrigin: carrier.fields.journal.origin,
              },
            ) as ExtractedFields['journal'],
          );
        }

        if (
          typeof carrier.fields.publisher.value === 'string'
          && normalizeComparableText(carrier.fields.publisher.value) === normalizedOwner
        ) {
          setExtractedField(
            carrier.fields,
            'publisher',
            fieldOf(
              null,
              carrier.fields.publisher.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.publisher.origin,
                previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
                previousSource: carrier.fields.publisher.source,
                previousOrigin: carrier.fields.publisher.origin,
              },
            ) as ExtractedFields['publisher'],
          );
        }

        if (
          conferenceTitle
          && normalizeComparableText(conferenceTitle) === normalizedOwner
        ) {
          setExtractedField(
            carrier.fields,
            'conferenceTitle',
            fieldOf(
              null,
              carrier.fields.conferenceTitle.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.conferenceTitle.origin,
                previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
                previousSource: carrier.fields.conferenceTitle.source,
                previousOrigin: carrier.fields.conferenceTitle.origin,
              },
            ) as ExtractedFields['conferenceTitle'],
          );
        }

        if (mirroredOwnerAuthor || repeatedOwner || repeatedInstitutionalOwnerProfile) {
          setExtractedField(
            carrier.fields,
            'authors',
            fieldOf(
              [],
              carrier.fields.authors.source,
              STAGE_ID,
              Math.max(0.82, carrier.fields.authors.confidence),
              {
                origin: carrier.fields.authors.origin,
                previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
                previousSource: carrier.fields.authors.source,
                previousOrigin: carrier.fields.authors.origin,
              },
            ) as ExtractedFields['authors'],
          );
        }

      }
    }

    const refreshedTitleText = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : null;
    const refreshedJournalText = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const refreshedVolumeText = typeof carrier.fields.volume.value === 'string'
      ? carrier.fields.volume.value.trim()
      : null;
    const refreshedIssueText = typeof carrier.fields.issue.value === 'string'
      ? carrier.fields.issue.value.trim()
      : null;
    const volumeLooksYearOnly =
      refreshedVolumeText != null
      && typeof carrier.fields.year.value === 'number'
      && normalizeComparableText(refreshedVolumeText) === normalizeComparableText(String(carrier.fields.year.value));
    const journalLooksLocatorOnly =
      refreshedJournalText != null
      && (
        /^vol\.?\s*\d+/iu.test(refreshedJournalText)
        || /^no\.?\s*[^,]+/iu.test(refreshedJournalText)
        || recoverJournalFromContainerLocator(refreshedJournalText) != null
      );
    const reviewTitleContinuation =
      refreshedTitleText
      && refreshedJournalText
      && !/\breview\)/iu.test(refreshedTitleText)
        ? recoverReviewTitleContinuationFromRaw(carrier.raw, refreshedTitleText, refreshedJournalText)
        : null;
    if (reviewTitleContinuation) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          reviewTitleContinuation,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
    }

    let effectiveTitleText = reviewTitleContinuation ?? refreshedTitleText;
    let effectiveJournalText = refreshedJournalText;
    let effectiveVolumeText = refreshedVolumeText;
    let effectiveIssueText = refreshedIssueText;
    let effectiveVolumeLooksYearOnly = volumeLooksYearOnly;
    let effectiveJournalLooksLocatorOnly = journalLooksLocatorOnly;

    const recoveredRawWordLocatorArticle =
      effectiveTitleText
      && (
        !effectiveJournalText
        || effectiveJournalLooksLocatorOnly
        || effectiveVolumeLooksYearOnly
        || /\bvol\.?\b/iu.test(effectiveTitleText)
      )
        ? recoverAuthorDateWordLocatorArticleFromRaw(carrier.raw)
        : null;
    if (
      recoveredRawWordLocatorArticle
      && (
        normalizeComparableText(effectiveTitleText ?? '') !== normalizeComparableText(recoveredRawWordLocatorArticle.title)
        || normalizeComparableText(effectiveJournalText ?? '') !== normalizeComparableText(recoveredRawWordLocatorArticle.journal)
        || !effectiveVolumeText
        || effectiveVolumeLooksYearOnly
        || (!effectiveIssueText && recoveredRawWordLocatorArticle.issue)
      )
    ) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          recoveredRawWordLocatorArticle.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          recoveredRawWordLocatorArticle.journal,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.journal.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          recoveredRawWordLocatorArticle.volume,
          carrier.fields.volume.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.volume.confidence),
          {
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
      if (recoveredRawWordLocatorArticle.issue) {
        setExtractedField(
          carrier.fields,
          'issue',
          fieldOf(
            recoveredRawWordLocatorArticle.issue,
            carrier.fields.issue.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.issue.confidence),
            {
              origin: carrier.fields.issue.origin,
              previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
              previousSource: carrier.fields.issue.source,
              previousOrigin: carrier.fields.issue.origin,
            },
          ) as ExtractedFields['issue'],
        );
      }
      effectiveTitleText = recoveredRawWordLocatorArticle.title;
      effectiveJournalText = recoveredRawWordLocatorArticle.journal;
      effectiveVolumeText = recoveredRawWordLocatorArticle.volume;
      effectiveIssueText = recoveredRawWordLocatorArticle.issue;
      effectiveVolumeLooksYearOnly = false;
      effectiveJournalLooksLocatorOnly = false;
    }

    if (
      effectiveTitleText
      && (
        !effectiveJournalText
        || effectiveJournalLooksLocatorOnly
        || effectiveVolumeLooksYearOnly
      )
    ) {
      const recoveredArticleLocatorWithTitle =
        recoverArticleLocatorAfterTitle(carrier.raw, effectiveTitleText);
        const titleRecoveredJournalLooksBroken =
          recoveredArticleLocatorWithTitle != null
          && (
            /^vol\.?\s*\d+/iu.test(recoveredArticleLocatorWithTitle.journal)
            || /^no\.?\s*[^,]+/iu.test(recoveredArticleLocatorWithTitle.journal)
            || recoverJournalFromContainerLocator(recoveredArticleLocatorWithTitle.journal) != null
            || isYearLikeLocatorValue(recoveredArticleLocatorWithTitle.volume)
          );
        const recoveredArticleLocator =
          (!recoveredArticleLocatorWithTitle || titleRecoveredJournalLooksBroken)
          ?? (
            effectiveJournalLooksLocatorOnly || effectiveVolumeLooksYearOnly
              ? recoverLabeledArticleLocatorFromRaw(carrier.raw)
              : null
          )
            ? (
              (effectiveJournalLooksLocatorOnly || effectiveVolumeLooksYearOnly)
                ? recoverLabeledArticleLocatorFromRaw(carrier.raw)
                : null
            ) ?? recoveredArticleLocatorWithTitle
            : recoveredArticleLocatorWithTitle;
        if (
          recoveredArticleLocator
          && !looksLowQualityContainerCandidate(recoveredArticleLocator.journal)
          && !/^vol\.?\s*\d+/iu.test(recoveredArticleLocator.journal)
          && !/^no\.?\s*[^,]+/iu.test(recoveredArticleLocator.journal)
          && !looksConferencePublicationVenue(recoveredArticleLocator.journal)
        ) {
          const recoveredBrokenFieldMatch = recoveredArticleLocator.journal.match(
            /^(?:[\]\)"'“”‘’.,;\s]+)?(?<journal>.+?),\s*vol\.?\s*(?<volume>\d+)(?:,\s*no(?:s?)?\.?\s*(?<issue>[^,.;]+))?$/iu,
          );
          const recoveredJournalText = recoveredBrokenFieldMatch?.groups?.journal
            ? (
              normalizeJournalCandidate(recoveredBrokenFieldMatch.groups.journal)
              ?? normalizeConferenceTitle(recoveredBrokenFieldMatch.groups.journal)
              ?? recoveredArticleLocator.journal
            )
            : recoveredArticleLocator.journal;
          const recoveredVolumeText = recoveredBrokenFieldMatch?.groups?.volume?.trim()
            ?? recoveredArticleLocator.volume;
          const recoveredIssueText = recoveredBrokenFieldMatch?.groups?.volume
            ? (
              recoveredBrokenFieldMatch.groups.issue?.trim()
              ?? carrier.raw.match(/,\s*no(?:s?)?\.?\s*(?<issue>[^,.;]+)/iu)?.groups?.issue?.trim()
              ?? recoveredArticleLocator.issue
            )
            : recoveredArticleLocator.issue;
          if (recoveredArticleLocatorWithTitle?.titleSuffix) {
            const repairedTitle = normalizeTitleCandidate(
              `${stripTrailingPunctuation(effectiveTitleText)}, ${recoveredArticleLocatorWithTitle.titleSuffix}`,
            );
            if (repairedTitle) {
              setExtractedField(
                carrier.fields,
                'title',
                fieldOf(
                  repairedTitle,
                  carrier.fields.title.source,
                  STAGE_ID,
                  Math.max(0.82, carrier.fields.title.confidence),
                  {
                    origin: carrier.fields.title.origin,
                    previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
                    previousSource: carrier.fields.title.source,
                    previousOrigin: carrier.fields.title.origin,
                  },
                ) as ExtractedFields['title'],
              );
            }
          }
        setExtractedField(
          carrier.fields,
          'journal',
          fieldOf(
            recoveredJournalText,
            carrier.fields.journal.source,
            STAGE_ID,
            Math.max(0.84, carrier.fields.journal.confidence),
            {
              origin: carrier.fields.journal.origin,
              previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
              previousSource: carrier.fields.journal.source,
              previousOrigin: carrier.fields.journal.origin,
            },
          ) as ExtractedFields['journal'],
        );
        if (recoveredVolumeText && (!effectiveVolumeText || effectiveVolumeLooksYearOnly)) {
          setExtractedField(
            carrier.fields,
            'volume',
            fieldOf(
              recoveredVolumeText,
              carrier.fields.volume.source,
              STAGE_ID,
              Math.max(0.82, carrier.fields.volume.confidence),
              {
                origin: carrier.fields.volume.origin,
                previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
                previousSource: carrier.fields.volume.source,
                previousOrigin: carrier.fields.volume.origin,
              },
              ) as ExtractedFields['volume'],
          );
        }
        if (recoveredIssueText && (!effectiveIssueText || effectiveJournalLooksLocatorOnly)) {
          setExtractedField(
            carrier.fields,
            'issue',
            fieldOf(
              recoveredIssueText,
              carrier.fields.issue.source,
              STAGE_ID,
              Math.max(0.8, carrier.fields.issue.confidence),
              {
                origin: carrier.fields.issue.origin,
                previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
                previousSource: carrier.fields.issue.source,
                previousOrigin: carrier.fields.issue.origin,
              },
            ) as ExtractedFields['issue'],
          );
        }
        if (
          recoveredArticleLocator.pages
          && !hasFieldValue(carrier.fields.pages)
        ) {
          setExtractedField(
            carrier.fields,
            'pages',
            fieldOf(
              recoveredArticleLocator.pages,
              carrier.fields.pages.source,
              STAGE_ID,
              Math.max(0.8, carrier.fields.pages.confidence),
              {
                origin: carrier.fields.pages.origin,
                previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
                previousSource: carrier.fields.pages.source,
                previousOrigin: carrier.fields.pages.origin,
              },
            ) as ExtractedFields['pages'],
          );
        }
        if (
          typeof carrier.fields.conferenceTitle.value === 'string'
          && shouldClearArticleSpillContainer(carrier.fields.conferenceTitle.value, recoveredJournalText)
        ) {
          setExtractedField(
            carrier.fields,
            'conferenceTitle',
            fieldOf(
              null,
              carrier.fields.conferenceTitle.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.conferenceTitle.origin,
                previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
                previousSource: carrier.fields.conferenceTitle.source,
                previousOrigin: carrier.fields.conferenceTitle.origin,
              },
            ) as ExtractedFields['conferenceTitle'],
          );
        }
        if (
          typeof carrier.fields.bookTitle.value === 'string'
          && shouldClearArticleSpillContainer(carrier.fields.bookTitle.value, recoveredJournalText)
        ) {
          setExtractedField(
            carrier.fields,
            'bookTitle',
            fieldOf(
              null,
              carrier.fields.bookTitle.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.bookTitle.origin,
                previousValue: carrier.fields.bookTitle.value as ExtractedFields['bookTitle']['value'],
                previousSource: carrier.fields.bookTitle.source,
                previousOrigin: carrier.fields.bookTitle.origin,
              },
            ) as ExtractedFields['bookTitle'],
          );
        }
        if (
          typeof carrier.fields.publisher.value === 'string'
          && shouldClearArticleSpillContainer(carrier.fields.publisher.value, recoveredJournalText)
        ) {
          setExtractedField(
            carrier.fields,
            'publisher',
            fieldOf(
              null,
              carrier.fields.publisher.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.publisher.origin,
                previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
                previousSource: carrier.fields.publisher.source,
                previousOrigin: carrier.fields.publisher.origin,
              },
            ) as ExtractedFields['publisher'],
          );
        }
      }
      if (effectiveJournalLooksLocatorOnly || effectiveVolumeLooksYearOnly) {
        const recoveredLabeledArticleLocator = recoverLabeledArticleLocatorFromRaw(carrier.raw);
        if (
          recoveredLabeledArticleLocator
          && !looksLowQualityContainerCandidate(recoveredLabeledArticleLocator.journal)
          && !looksConferencePublicationVenue(recoveredLabeledArticleLocator.journal)
        ) {
          setExtractedField(
            carrier.fields,
            'journal',
            fieldOf(
              recoveredLabeledArticleLocator.journal,
              carrier.fields.journal.source,
              STAGE_ID,
              Math.max(0.84, carrier.fields.journal.confidence),
              {
                origin: carrier.fields.journal.origin,
                previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
                previousSource: carrier.fields.journal.source,
                previousOrigin: carrier.fields.journal.origin,
              },
            ) as ExtractedFields['journal'],
          );
          if (recoveredLabeledArticleLocator.volume && effectiveVolumeLooksYearOnly) {
            setExtractedField(
              carrier.fields,
              'volume',
              fieldOf(
                recoveredLabeledArticleLocator.volume,
                carrier.fields.volume.source,
                STAGE_ID,
                Math.max(0.82, carrier.fields.volume.confidence),
                {
                  origin: carrier.fields.volume.origin,
                  previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
                  previousSource: carrier.fields.volume.source,
                  previousOrigin: carrier.fields.volume.origin,
                },
              ) as ExtractedFields['volume'],
            );
          }
          if (recoveredLabeledArticleLocator.issue && !hasFieldValue(carrier.fields.issue)) {
            setExtractedField(
              carrier.fields,
              'issue',
              fieldOf(
                recoveredLabeledArticleLocator.issue,
                carrier.fields.issue.source,
                STAGE_ID,
                Math.max(0.82, carrier.fields.issue.confidence),
                {
                  origin: carrier.fields.issue.origin,
                  previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
                  previousSource: carrier.fields.issue.source,
                  previousOrigin: carrier.fields.issue.origin,
                },
              ) as ExtractedFields['issue'],
            );
          }
          if (recoveredLabeledArticleLocator.pages && !hasFieldValue(carrier.fields.pages)) {
            setExtractedField(
              carrier.fields,
              'pages',
              fieldOf(
                recoveredLabeledArticleLocator.pages,
                carrier.fields.pages.source,
                STAGE_ID,
                Math.max(0.82, carrier.fields.pages.confidence),
                {
                  origin: carrier.fields.pages.origin,
                  previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
                  previousSource: carrier.fields.pages.source,
                  previousOrigin: carrier.fields.pages.origin,
                },
              ) as ExtractedFields['pages'],
            );
          }
        }
      }
    }

    if (hasNonDoiUrl) {
      const recoveredOwnerSite =
        recoverAuthorDateOwnerSiteWebpageFromRaw(
          carrier.raw,
          institution ?? undefined,
        )
        ?? recoverAuthorDateOwnerSiteWebpageFromRaw(carrier.raw);
      if (recoveredOwnerSite) {
        const currentSiteName = typeof carrier.fields.siteName.value === 'string'
          ? normalizeSiteNameCandidate(carrier.fields.siteName.value)
          : null;
        const currentInstitution = typeof carrier.fields.institution.value === 'string'
          ? normalizeInstitutionCandidate(carrier.fields.institution.value)
          : null;
        const shouldRepairSiteName =
          shouldOverrideWeakWebpageSiteName(currentSiteName, [
            typeof carrier.fields.institution.value === 'string' ? carrier.fields.institution.value : null,
            typeof carrier.fields.publisher.value === 'string' ? carrier.fields.publisher.value : null,
            typeof carrier.fields.bookTitle.value === 'string' ? carrier.fields.bookTitle.value : null,
          ])
          || looksWebpageSiteOwnerBlend(
            currentSiteName,
            recoveredOwnerSite.siteName,
            recoveredOwnerSite.institution,
          );
        const shouldRepairInstitution =
          !currentInstitution
          || normalizeComparableText(currentInstitution) === normalizeComparableText(recoveredOwnerSite.siteName)
          || looksWebpageSiteOwnerBlend(
            currentInstitution,
            recoveredOwnerSite.siteName,
            recoveredOwnerSite.institution,
          );
        if (shouldRepairSiteName) {
          setExtractedField(
            carrier.fields,
            'siteName',
            fieldOf(
              recoveredOwnerSite.siteName,
              carrier.fields.siteName.source,
              STAGE_ID,
              Math.max(0.82, carrier.fields.siteName.confidence),
              {
                origin: carrier.fields.siteName.origin,
                previousValue: carrier.fields.siteName.value as ExtractedFields['siteName']['value'],
                previousSource: carrier.fields.siteName.source,
                previousOrigin: carrier.fields.siteName.origin,
              },
            ) as ExtractedFields['siteName'],
          );
        }
        if (shouldRepairInstitution) {
          setExtractedField(
            carrier.fields,
            'institution',
            fieldOf(
              recoveredOwnerSite.institution,
              carrier.fields.institution.source,
              STAGE_ID,
              Math.max(0.82, carrier.fields.institution.confidence),
              {
                origin: carrier.fields.institution.origin,
                previousValue: carrier.fields.institution.value as ExtractedFields['institution']['value'],
                previousSource: carrier.fields.institution.source,
                previousOrigin: carrier.fields.institution.origin,
              },
            ) as ExtractedFields['institution'],
          );
        }
        if (shouldRepairSiteName || shouldRepairInstitution) {
          if (normalizeComparableText(title ?? '') !== normalizeComparableText(recoveredOwnerSite.title)) {
            setExtractedField(
              carrier.fields,
              'title',
              fieldOf(
                recoveredOwnerSite.title,
                carrier.fields.title.source,
                STAGE_ID,
                Math.max(0.82, carrier.fields.title.confidence),
                {
                  origin: carrier.fields.title.origin,
                  previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
                  previousSource: carrier.fields.title.source,
                  previousOrigin: carrier.fields.title.origin,
                },
              ) as ExtractedFields['title'],
            );
          }
        }
      }
    }

    if (hasNonDoiUrl) {
      const recoveredNamedSiteLabel = recoverNamedSiteLabelFromRaw(carrier.raw, url);
      if (recoveredNamedSiteLabel && shouldOverrideWeakWebpageSiteName(siteName, [institution, publisher, bookTitle])) {
        setExtractedField(
          carrier.fields,
          'siteName',
          fieldOf(
            recoveredNamedSiteLabel,
            carrier.fields.siteName.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.siteName.confidence),
            {
              origin: carrier.fields.siteName.origin,
              previousValue: carrier.fields.siteName.value as ExtractedFields['siteName']['value'],
              previousSource: carrier.fields.siteName.source,
              previousOrigin: carrier.fields.siteName.origin,
            },
          ) as ExtractedFields['siteName'],
        );
      }
    }

    if (hasNonDoiUrl) {
      const publisherBackedSiteName = selectHumanReadableWebpageSiteNameFromPublisher(
        typeof carrier.fields.siteName.value === 'string' ? carrier.fields.siteName.value : null,
        typeof carrier.fields.publisher.value === 'string' ? carrier.fields.publisher.value : null,
        typeof carrier.fields.institution.value === 'string' ? carrier.fields.institution.value : null,
      );
      if (publisherBackedSiteName) {
        setExtractedField(
          carrier.fields,
          'siteName',
          fieldOf(
            publisherBackedSiteName,
            carrier.fields.siteName.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.siteName.confidence),
            {
              origin: carrier.fields.siteName.origin,
              previousValue: carrier.fields.siteName.value as ExtractedFields['siteName']['value'],
              previousSource: carrier.fields.siteName.source,
              previousOrigin: carrier.fields.siteName.origin,
            },
          ) as ExtractedFields['siteName'],
        );
      }
    }

    let refreshedSiteName = typeof carrier.fields.siteName.value === 'string'
      ? normalizeSiteNameCandidate(carrier.fields.siteName.value)
      : null;
    let refreshedInstitution = typeof carrier.fields.institution.value === 'string'
      ? normalizeInstitutionCandidate(carrier.fields.institution.value)
      : null;
    let refreshedJournal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const refreshedVolume = typeof carrier.fields.volume.value === 'string'
      ? carrier.fields.volume.value.trim()
      : null;
    let refreshedPages = typeof carrier.fields.pages.value === 'string'
      ? normalizePages(carrier.fields.pages.value)
      : null;
    const refreshedPmid = typeof carrier.fields.pmid.value === 'string'
      ? normalizePmid(carrier.fields.pmid.value) ?? stripTrailingPunctuation(carrier.fields.pmid.value).trim()
      : null;
    if (
      hasNonDoiUrl
      && looksUrlContaminatedOwnerValue(
        typeof carrier.fields.institution.value === 'string' ? carrier.fields.institution.value : null,
      )
    ) {
      setExtractedField(
        carrier.fields,
        'institution',
        fieldOf(
          null,
          carrier.fields.institution.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.institution.origin,
            previousValue: carrier.fields.institution.value as ExtractedFields['institution']['value'],
            previousSource: carrier.fields.institution.source,
            previousOrigin: carrier.fields.institution.origin,
          },
        ) as ExtractedFields['institution'],
      );
      refreshedInstitution = null;
    }
    if (
      hasNonDoiUrl
      && looksWebpageIdentifierLocatorArtifact(refreshedPages, {
        hasMeaningfulUrl: true,
        siteName: refreshedSiteName,
        institution: refreshedInstitution,
        pmid: refreshedPmid,
      })
    ) {
      setExtractedField(
        carrier.fields,
        'pages',
        fieldOf(
          null,
          carrier.fields.pages.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.pages.origin,
            previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
            previousSource: carrier.fields.pages.source,
            previousOrigin: carrier.fields.pages.origin,
          },
        ) as ExtractedFields['pages'],
      );
      refreshedPages = null;
    }
    const hasConcreteWebpageLocators =
      hasFieldValue(carrier.fields.issue)
      || refreshedPages != null
      || (refreshedVolume != null && !isYearLikeLocatorValue(refreshedVolume));
    const journalDuplicatesPrimaryCorporateOwner =
      refreshedJournal != null
      && normalizeComparableText(primaryCorporateOwner ?? '').length > 0
      && normalizeComparableText(refreshedJournal) === normalizeComparableText(primaryCorporateOwner ?? '');
    if (
      hasNonDoiUrl
      && !hasConcreteWebpageLocators
      && refreshedJournal
      && (
        looksWebpageSiteOwnerBlend(refreshedJournal, refreshedSiteName, refreshedInstitution)
        || journalDuplicatesPrimaryCorporateOwner
      )
    ) {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          null,
          carrier.fields.journal.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      refreshedJournal = null;
      if (
        refreshedVolume
        && isYearLikeLocatorValue(refreshedVolume)
        && !hasFieldValue(carrier.fields.issue)
        && !hasFieldValue(carrier.fields.pages)
      ) {
        setExtractedField(
          carrier.fields,
          'volume',
          fieldOf(
            null,
            carrier.fields.volume.source,
            STAGE_ID,
            0,
            {
              uncertain: true,
              origin: carrier.fields.volume.origin,
              previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
              previousSource: carrier.fields.volume.source,
              previousOrigin: carrier.fields.volume.origin,
            },
          ) as ExtractedFields['volume'],
        );
      }
    }

    if (!hasBookishIdentifier && !hasConferenceEvidence && !journal && publisher && hasVolumeOrIssue) {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          stripTrailingPunctuation(publisher).trim(),
          carrier.fields.publisher.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.publisher.confidence),
          {
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          null,
          carrier.fields.publisher.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }

    if (typeof carrier.fields.title.value === 'string') {
      const repairedDecimalTitle = recoverDecimalTerminalTokenFromRaw(
        carrier.raw,
        carrier.fields.title.value,
      );
      if (
        repairedDecimalTitle
        && normalizeComparableText(repairedDecimalTitle)
          !== normalizeComparableText(carrier.fields.title.value)
      ) {
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            repairedDecimalTitle,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }
    }

    const refreshedBookishJournal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const refreshedPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const refreshedBookTitle = typeof carrier.fields.bookTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.bookTitle.value)
      : null;
    const publisherLooksLikePages = looksStandalonePageRangeValue(refreshedPublisher, refreshedPages);
    if (hasBookishIdentifier && refreshedBookTitle && (!refreshedPublisher || publisherLooksLikePages)) {
      const splitBookTitleTail = splitBookChapterConferenceTail(refreshedBookTitle, title);
      const recoveredPublisher =
        splitBookTitleTail.publisher
        ?? (refreshedBookishJournal
          && (
            looksPublisherLike(refreshedBookishJournal)
            || looksInstitutionalContainer(refreshedBookishJournal)
            || /\b(?:press|verlag|publishing|springer|elsevier|wiley|sciendo|loghum|metzler|heidelberg|singapore|international)\b/iu.test(refreshedBookishJournal)
          )
            ? refreshedBookishJournal
            : null)
        ?? recoverBookChapterPublisherFromRaw(carrier.raw, refreshedBookTitle, title);
      if (recoveredPublisher) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            recoveredPublisher,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
        if (refreshedBookishJournal && normalizeComparableText(refreshedBookishJournal) === normalizeComparableText(recoveredPublisher)) {
          setExtractedField(
            carrier.fields,
            'journal',
            fieldOf(
              null,
              carrier.fields.journal.source,
              STAGE_ID,
              0,
              {
                uncertain: true,
                origin: carrier.fields.journal.origin,
                previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
                previousSource: carrier.fields.journal.source,
                previousOrigin: carrier.fields.journal.origin,
              },
            ) as ExtractedFields['journal'],
          );
        }
      }
    }

    const finalPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    if (title && finalPublisher && normalizeComparableText(title).includes(normalizeComparableText(finalPublisher))) {
      const cleanedTitle = stripTrailingPunctuation(
        title.replace(
          new RegExp(`(?:["”]?\\s*,\\s*)?${escapeRegex(finalPublisher)}$`, 'iu'),
          '',
        ),
      ).trim();
      if (cleanedTitle && cleanedTitle !== title) {
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            cleanedTitle,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }
    }

    const finalBookTitle = typeof carrier.fields.bookTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.bookTitle.value)
      : null;
    const finalTitleForBookRepair = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : null;
    if (finalTitleForBookRepair && finalBookTitle) {
      const repairedFinalBookTitle = trimPublisherAndLocatorTailFromBookTitle(
        finalTitleForBookRepair,
        finalBookTitle,
        finalPublisher,
      );
      if (repairedFinalBookTitle) {
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            repairedFinalBookTitle.title,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
        setExtractedField(
          carrier.fields,
          'bookTitle',
          fieldOf(
            repairedFinalBookTitle.bookTitle,
            carrier.fields.bookTitle.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.bookTitle.confidence),
            {
              origin: carrier.fields.bookTitle.origin,
              previousValue: carrier.fields.bookTitle.value as ExtractedFields['bookTitle']['value'],
              previousSource: carrier.fields.bookTitle.source,
              previousOrigin: carrier.fields.bookTitle.origin,
            },
          ) as ExtractedFields['bookTitle'],
        );
      }
    }

    const finalJournal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const finalConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const finalVolume = typeof carrier.fields.volume.value === 'string'
      ? carrier.fields.volume.value.trim()
      : null;
    const finalIssue = typeof carrier.fields.issue.value === 'string'
      ? carrier.fields.issue.value.trim()
      : null;
    const finalPages = typeof carrier.fields.pages.value === 'string'
      ? normalizePages(carrier.fields.pages.value)
      : null;
    const hasConcreteArticleLocators =
      (finalVolume != null && !isYearLikeLocatorValue(finalVolume))
      || finalIssue != null
      || finalPages != null;
    const comparableFinalJournal = normalizeComparableText(finalJournal ?? '');
    const comparableFinalConferenceTitle = normalizeComparableText(finalConferenceTitle ?? '');
    const comparableFinalPublisher = normalizeComparableText(finalPublisher ?? '');
    const comparableFinalBookTitle = normalizeComparableText(finalBookTitle ?? '');
    const journalDuplicatesConference =
      finalJournal != null
      && finalConferenceTitle != null
      && (
        comparableFinalJournal === comparableFinalConferenceTitle
        || comparableFinalConferenceTitle.startsWith(comparableFinalJournal)
      );
    const journalDuplicatesBookishField =
      finalJournal != null
      && hasBookishIdentifier
      && (
        (finalPublisher != null
          && comparableFinalJournal === comparableFinalPublisher
          && normalizeComparableText(primaryCorporateOwner ?? '') !== comparableFinalPublisher)
        || (finalBookTitle != null
          && comparableFinalJournal === comparableFinalBookTitle)
      );
    const publisherEmbeddedInBookTitle =
      finalPublisher != null
      && finalBookTitle != null
      && comparableFinalPublisher.length > 0
      && comparableFinalBookTitle.includes(comparableFinalPublisher);
    const journalLooksRecoverablePublisher =
      finalJournal != null
      && (
        looksPublisherLike(finalJournal)
        || looksInstitutionalContainer(finalJournal)
        || /\b(?:press|verlag|publishing|springer|elsevier|wiley|sciendo|loghum|metzler|heidelberg|singapore|international|nature)\b/iu.test(finalJournal)
      );
    const publisherLooksConferenceSpill =
      finalPublisher != null
      && finalConferenceTitle != null
      && comparableFinalPublisher.length > 0
      && (
        (comparableFinalPublisher !== comparableFinalConferenceTitle
          && (
            comparableFinalPublisher.includes(comparableFinalConferenceTitle)
            || comparableFinalConferenceTitle.includes(comparableFinalPublisher)
          ))
        || /^\d{4},\s*/u.test(finalPublisher)
      )
      && !looksPublisherLike(finalPublisher)
      && !looksInstitutionalContainer(finalPublisher);

    if (
      finalJournal
      && (
        journalDuplicatesConference
        || journalDuplicatesBookishField
        || (
          finalPublisher != null
          && !hasConcreteArticleLocators
          && normalizeComparableText(primaryCorporateOwner ?? '') !== comparableFinalPublisher
          && normalizeComparableText(finalJournal) === normalizeComparableText(finalPublisher)
        )
      )
    ) {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          null,
          carrier.fields.journal.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
    }

    if (
      hasBookishIdentifier
      && finalBookTitle
      && publisherEmbeddedInBookTitle
      && journalLooksRecoverablePublisher
      && finalJournal != null
      && comparableFinalJournal !== comparableFinalBookTitle
    ) {
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          finalJournal,
          carrier.fields.publisher.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.publisher.confidence),
          {
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          null,
          carrier.fields.journal.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
    }

    if (
      publisherLooksConferenceSpill
      && !hasConcreteArticleLocators
    ) {
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          null,
          carrier.fields.publisher.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }

    if (
      finalVolume != null
      && isYearLikeLocatorValue(finalVolume)
      && !finalIssue
      && !finalPages
      && (
        hasBookishIdentifier
        || finalConferenceTitle != null
      )
    ) {
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          null,
          carrier.fields.volume.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
    }

    if (
      Array.isArray(carrier.fields.authors.value)
      && carrier.fields.authors.value.length === 1
    ) {
      const author = carrier.fields.authors.value[0];
      if (!author || author.isCorporate) {
        continue;
      }
      const dottedGiven = recoverLeadingDottedGivenFromRaw(carrier.raw, author.family);
      if (dottedGiven && author.given !== dottedGiven) {
        const repairedAuthor: CanonicalAuthor = {
          family: author.family,
          given: dottedGiven,
          initials: dottedGiven,
          ...(author.literal ? { literal: author.literal } : {}),
          ...(author.orcid ? { orcid: author.orcid } : {}),
          isCorporate: false,
        };
        setExtractedField(
          carrier.fields,
          'authors',
          fieldOf(
            [repairedAuthor],
            carrier.fields.authors.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.authors.confidence),
            {
              origin: carrier.fields.authors.origin,
              previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
              previousSource: carrier.fields.authors.source,
              previousOrigin: carrier.fields.authors.origin,
            },
          ) as ExtractedFields['authors'],
        );
      }
    }
  }

  const groups = new Map<string, ReferenceCarrier[]>();
  for (const carrier of carriers) {
    const key = getPropagationGroupKey(carrier);
    if (!key) {
      continue;
    }
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
    } else {
      groups.set(key, [carrier]);
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const bestTitle = group
      .map((carrier) => {
        const title = typeof carrier.fields.title.value === 'string'
          ? normalizeTitleCandidate(carrier.fields.title.value)
          : null;
        const publisher = typeof carrier.fields.publisher.value === 'string'
          ? normalizeConferenceTitle(carrier.fields.publisher.value)
          : null;
        if (!title || title.length < 24) {
          return null;
        }
        if (publisher && normalizeComparableText(title) === normalizeComparableText(publisher)) {
          return null;
        }
        return {
          carrier,
          title,
          score: title.length + carrier.fields.title.confidence * 10,
        };
      })
      .filter((candidate): candidate is { carrier: ReferenceCarrier; title: string; score: number } => candidate != null)
      .sort((left, right) => right.score - left.score)[0];
    if (!bestTitle) {
      continue;
    }

    for (const carrier of group) {
      const title = typeof carrier.fields.title.value === 'string'
        ? normalizeTitleCandidate(carrier.fields.title.value)
        : null;
      const publisher = typeof carrier.fields.publisher.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.publisher.value)
        : null;
      const titleLooksBroken =
        !title
        || title.length < Math.max(18, Math.floor(bestTitle.title.length * 0.55))
        || (publisher != null && normalizeComparableText(title) === normalizeComparableText(publisher))
        || (
          publisher != null
          && normalizeComparableText(title).includes(normalizeComparableText(publisher))
          && title.length < bestTitle.title.length
        );
      if (!titleLooksBroken) {
        continue;
      }

      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          bestTitle.title,
          bestTitle.carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.8, bestTitle.carrier.fields.title.confidence - 0.02),
          {
            origin: bestTitle.carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
    }
  }
}

function cleanupWebpageContainerEchoes(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const url = typeof carrier.fields.url.value === 'string' ? carrier.fields.url.value : null;
    const journal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const siteName = typeof carrier.fields.siteName.value === 'string'
      ? normalizeSiteNameCandidate(carrier.fields.siteName.value)
      : null;
    const institution = typeof carrier.fields.institution.value === 'string'
      ? normalizeInstitutionCandidate(carrier.fields.institution.value)
      : null;
    const hasArticleLocators =
      hasFieldValue(carrier.fields.volume)
      || hasFieldValue(carrier.fields.issue)
      || hasFieldValue(carrier.fields.pages);

    if (
      url
      && !isDoiUrl(url)
      && !hasArticleLocators
      && journal
      && looksWebpageSiteOwnerBlend(journal, siteName, institution)
    ) {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          null,
          carrier.fields.journal.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
    }
  }
}

function repairExplicitOwnerSiteWebpages(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const url = typeof carrier.fields.url.value === 'string' ? carrier.fields.url.value : null;
    if (!url || isDoiUrl(url)) {
      continue;
    }

    const recoveredOwnerSite =
      recoverAuthorDateOwnerSiteWebpageFromRaw(carrier.raw)
      ?? recoverVancouverOwnerSiteWebpageFromRaw(carrier.raw);
    if (!recoveredOwnerSite) {
      continue;
    }

    const currentSiteName = typeof carrier.fields.siteName.value === 'string'
      ? normalizeSiteNameCandidate(carrier.fields.siteName.value)
      : null;
    const currentInstitution = typeof carrier.fields.institution.value === 'string'
      ? normalizeInstitutionCandidate(carrier.fields.institution.value)
      : null;
    const shouldRepairSiteName =
      !currentSiteName
      || normalizeComparableText(currentSiteName) === normalizeComparableText(recoveredOwnerSite.institution)
      || looksWebpageSiteOwnerBlend(
        currentSiteName,
        recoveredOwnerSite.siteName,
        recoveredOwnerSite.institution,
      );
    const shouldRepairInstitution =
      !currentInstitution
      || normalizeComparableText(currentInstitution) === normalizeComparableText(recoveredOwnerSite.siteName)
      || looksWebpageSiteOwnerBlend(
        currentInstitution,
        recoveredOwnerSite.siteName,
        recoveredOwnerSite.institution,
      );

    if (shouldRepairSiteName) {
      setExtractedField(
        carrier.fields,
        'siteName',
        fieldOf(
          recoveredOwnerSite.siteName,
          carrier.fields.siteName.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.siteName.confidence),
          {
            origin: carrier.fields.siteName.origin,
            previousValue: carrier.fields.siteName.value as ExtractedFields['siteName']['value'],
            previousSource: carrier.fields.siteName.source,
            previousOrigin: carrier.fields.siteName.origin,
          },
        ) as ExtractedFields['siteName'],
      );
    }

    if (shouldRepairInstitution) {
      setExtractedField(
        carrier.fields,
        'institution',
        fieldOf(
          recoveredOwnerSite.institution,
          carrier.fields.institution.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.institution.confidence),
          {
            origin: carrier.fields.institution.origin,
            previousValue: carrier.fields.institution.value as ExtractedFields['institution']['value'],
            previousSource: carrier.fields.institution.source,
            previousOrigin: carrier.fields.institution.origin,
          },
        ) as ExtractedFields['institution'],
      );
    }

    if (
      (shouldRepairSiteName || shouldRepairInstitution)
      && normalizeComparableText(
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : '',
      ) !== normalizeComparableText(recoveredOwnerSite.title)
    ) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          recoveredOwnerSite.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
    }
  }
}

function cleanupFinalArticleLocatorSpills(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const title = typeof carrier.fields.title.value === 'string'
      ? normalizeTitleCandidate(carrier.fields.title.value)
      : null;
    const journal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const volume = typeof carrier.fields.volume.value === 'string'
      ? carrier.fields.volume.value.trim()
      : null;
    const year = typeof carrier.fields.year.value === 'number' ? carrier.fields.year.value : null;
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined;
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const brokenJournal =
      journal != null
      && (
        /^vol\.?\s*\d+/iu.test(journal)
        || /^no\.?\s*[^,]+/iu.test(journal)
        || recoverJournalFromContainerLocator(journal) != null
      );
    const titleLooksLocatorSpill = title != null && /\bvol\.?\b/iu.test(title);
    const numericJournalFragment = journal != null && /^\d{1,4}\s*,\s*no\b/iu.test(journal);
    const volumeLooksYearOnly =
      volume != null
      && year != null
      && normalizeComparableText(volume) === normalizeComparableText(String(year));

    if (
      (!brokenJournal && !volumeLooksYearOnly && !titleLooksLocatorSpill && !numericJournalFragment)
      || conferenceTitle != null
      || CONFERENCE_DOI_REGEX.test(carrier.raw)
      || looksProceedingsLikeDoi(doi)
    ) {
      continue;
    }

    const recoveredExplicitWordLocatorArticle =
      recoverLiteralAuthorDateWordLocatorArticleFromRaw(carrier.raw)
      ?? recoverAuthorDateWordLocatorArticleFromRaw(carrier.raw);
    if (recoveredExplicitWordLocatorArticle) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          recoveredExplicitWordLocatorArticle.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          recoveredExplicitWordLocatorArticle.journal,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.journal.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          recoveredExplicitWordLocatorArticle.volume,
          carrier.fields.volume.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.volume.confidence),
          {
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
      if (recoveredExplicitWordLocatorArticle.issue) {
        setExtractedField(
          carrier.fields,
          'issue',
          fieldOf(
            recoveredExplicitWordLocatorArticle.issue,
            carrier.fields.issue.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.issue.confidence),
            {
              origin: carrier.fields.issue.origin,
              previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
              previousSource: carrier.fields.issue.source,
              previousOrigin: carrier.fields.issue.origin,
            },
          ) as ExtractedFields['issue'],
        );
      }
      continue;
    }

    const recoveredBareVolumeIssueArticle = recoverBareVolumeIssueArticleFromRaw(carrier.raw);
    if (recoveredBareVolumeIssueArticle) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          recoveredBareVolumeIssueArticle.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          recoveredBareVolumeIssueArticle.journal,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.journal.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          recoveredBareVolumeIssueArticle.volume,
          carrier.fields.volume.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.volume.confidence),
          {
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
      if (recoveredBareVolumeIssueArticle.issue) {
        setExtractedField(
          carrier.fields,
          'issue',
          fieldOf(
            recoveredBareVolumeIssueArticle.issue,
            carrier.fields.issue.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.issue.confidence),
            {
              origin: carrier.fields.issue.origin,
              previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
              previousSource: carrier.fields.issue.source,
              previousOrigin: carrier.fields.issue.origin,
            },
          ) as ExtractedFields['issue'],
        );
      }
      if (recoveredBareVolumeIssueArticle.pages) {
        setExtractedField(
          carrier.fields,
          'pages',
          fieldOf(
            recoveredBareVolumeIssueArticle.pages,
            carrier.fields.pages.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.pages.confidence),
            {
              origin: carrier.fields.pages.origin,
              previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
              previousSource: carrier.fields.pages.source,
              previousOrigin: carrier.fields.pages.origin,
            },
          ) as ExtractedFields['pages'],
        );
      }
      continue;
    }

    const recoveredPagesMatch = carrier.raw.match(
      /,\s*(?:p{1,2}\.?\s*)?(?<pages>[A-Za-z]?\d[\w\-–]*)\s*(?:[,.;]|$)/iu,
    );
    const recoveredFromBrokenFieldMatch = journal?.match(
      /^(?:[\]\)"'“”‘’.,;\s]+)?(?<journal>.+?),\s*vol\.?\s*(?<volume>\d+)(?:,\s*no(?:s?)?\.?\s*(?<issue>[^,.;]+))?$/iu,
    );
    const recoveredFromBrokenField:
      | { journal: string; volume: string; issue: string | null; pages: string | null }
      | null =
      recoveredFromBrokenFieldMatch?.groups?.journal && recoveredFromBrokenFieldMatch.groups.volume
        ? {
          journal:
            normalizeJournalCandidate(recoveredFromBrokenFieldMatch.groups.journal)
            ?? normalizeConferenceTitle(recoveredFromBrokenFieldMatch.groups.journal),
          volume: recoveredFromBrokenFieldMatch.groups.volume.trim(),
          issue:
            recoveredFromBrokenFieldMatch.groups.issue?.trim()
            ?? carrier.raw.match(/,\s*no(?:s?)?\.?\s*(?<issue>[^,.;]+)/iu)?.groups?.issue?.trim()
            ?? null,
          pages: recoveredPagesMatch?.groups?.pages
            ? normalizePages(recoveredPagesMatch.groups.pages)
            : null,
        }
        : null;
    if (
      recoveredFromBrokenField
      && recoveredFromBrokenField.journal
      && !looksConferencePublicationVenue(recoveredFromBrokenField.journal)
    ) {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          recoveredFromBrokenField.journal,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.journal.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          recoveredFromBrokenField.volume,
          carrier.fields.volume.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.volume.confidence),
          {
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
      if (recoveredFromBrokenField.issue) {
        setExtractedField(
          carrier.fields,
          'issue',
          fieldOf(
            recoveredFromBrokenField.issue,
            carrier.fields.issue.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.issue.confidence),
            {
              origin: carrier.fields.issue.origin,
              previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
              previousSource: carrier.fields.issue.source,
              previousOrigin: carrier.fields.issue.origin,
            },
          ) as ExtractedFields['issue'],
        );
      }
      if (recoveredFromBrokenField.pages && !hasFieldValue(carrier.fields.pages)) {
        setExtractedField(
          carrier.fields,
          'pages',
          fieldOf(
            recoveredFromBrokenField.pages,
            carrier.fields.pages.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.pages.confidence),
            {
              origin: carrier.fields.pages.origin,
              previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
              previousSource: carrier.fields.pages.source,
              previousOrigin: carrier.fields.pages.origin,
            },
          ) as ExtractedFields['pages'],
        );
      }
      continue;
    }

    const recovered = recoverLabeledArticleLocatorFromRaw(carrier.raw);
    if (
      !recovered
      || looksLowQualityContainerCandidate(recovered.journal)
      || looksConferencePublicationVenue(recovered.journal)
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'journal',
      fieldOf(
        recovered.journal,
        carrier.fields.journal.source,
        STAGE_ID,
        Math.max(0.84, carrier.fields.journal.confidence),
        {
          origin: carrier.fields.journal.origin,
          previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
          previousSource: carrier.fields.journal.source,
          previousOrigin: carrier.fields.journal.origin,
        },
      ) as ExtractedFields['journal'],
    );
    if (recovered.volume && volumeLooksYearOnly) {
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          recovered.volume,
          carrier.fields.volume.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.volume.confidence),
          {
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
    }
    if (recovered.issue) {
      setExtractedField(
        carrier.fields,
        'issue',
        fieldOf(
          recovered.issue,
          carrier.fields.issue.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.issue.confidence),
          {
            origin: carrier.fields.issue.origin,
            previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
            previousSource: carrier.fields.issue.source,
            previousOrigin: carrier.fields.issue.origin,
          },
        ) as ExtractedFields['issue'],
      );
    }
    if (recovered.pages && !hasFieldValue(carrier.fields.pages)) {
      setExtractedField(
        carrier.fields,
        'pages',
        fieldOf(
          recovered.pages,
          carrier.fields.pages.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.pages.confidence),
          {
            origin: carrier.fields.pages.origin,
            previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
            previousSource: carrier.fields.pages.source,
            previousOrigin: carrier.fields.pages.origin,
          },
        ) as ExtractedFields['pages'],
      );
    }
  }
}

function repairFinalRawLeadRecoveries(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const normalizedRaw = normalizeExtractionInput(carrier.raw);
    const currentAuthors = Array.isArray(carrier.fields.authors.value) ? carrier.fields.authors.value : [];
    const currentTitle = typeof carrier.fields.title.value === 'string'
      ? normalizeTitleCandidate(carrier.fields.title.value)
      : null;
    const currentJournal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    const currentBookTitle = typeof carrier.fields.bookTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.bookTitle.value)
      : null;
    const currentNumericJournalFragment =
      currentJournal != null && /^\d{1,4}\s*,\s*no\b/iu.test(currentJournal);
    const currentTitleLooksLocatorSpill =
      currentTitle != null && /\bvol\.?\b/iu.test(currentTitle);

    const currentSwallowedWordLocator =
      currentTitle != null && currentNumericJournalFragment
        ? currentTitle.match(/^(?<title>.+?)\.\s+(?<journal>.+?),\s*vol$/iu)
        : null;
    if (currentSwallowedWordLocator?.groups?.title && currentSwallowedWordLocator.groups.journal) {
      const recoveredTitle = normalizeTitleCandidate(currentSwallowedWordLocator.groups.title);
      const recoveredJournal = stripTrailingPunctuation(currentSwallowedWordLocator.groups.journal).trim();
      const recoveredVolume = currentJournal?.match(/^(?<volume>\d{1,4})\s*,\s*no\b/iu)?.groups?.volume?.trim() ?? null;
      const recoveredIssue = carrier.raw.match(/,\s*no(?:s?)?\.?\s*(?<issue>[^,.;]+)/iu)?.groups?.issue?.trim() ?? null;
      if (recoveredTitle && recoveredJournal && recoveredVolume) {
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            recoveredTitle,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.84, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
        setExtractedField(
          carrier.fields,
          'journal',
          fieldOf(
            recoveredJournal,
            carrier.fields.journal.source,
            STAGE_ID,
            Math.max(0.84, carrier.fields.journal.confidence),
            {
              origin: carrier.fields.journal.origin,
              previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
              previousSource: carrier.fields.journal.source,
              previousOrigin: carrier.fields.journal.origin,
            },
          ) as ExtractedFields['journal'],
        );
        setExtractedField(
          carrier.fields,
          'volume',
          fieldOf(
            recoveredVolume,
            carrier.fields.volume.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.volume.confidence),
            {
              origin: carrier.fields.volume.origin,
              previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
              previousSource: carrier.fields.volume.source,
              previousOrigin: carrier.fields.volume.origin,
            },
          ) as ExtractedFields['volume'],
        );
        if (recoveredIssue) {
          setExtractedField(
            carrier.fields,
            'issue',
            fieldOf(
              recoveredIssue,
              carrier.fields.issue.source,
              STAGE_ID,
              Math.max(0.82, carrier.fields.issue.confidence),
              {
                origin: carrier.fields.issue.origin,
                previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
                previousSource: carrier.fields.issue.source,
                previousOrigin: carrier.fields.issue.origin,
              },
            ) as ExtractedFields['issue'],
          );
        }
        continue;
      }
    }

    const explicitWordLocatorRecovery =
      /,\s*vol\.?\s*\d+/iu.test(carrier.raw)
      || currentTitleLooksLocatorSpill
      || currentNumericJournalFragment
        ? (
          recoverLiteralAuthorDateWordLocatorArticleFromRaw(carrier.raw)
          ?? recoverAuthorDateWordLocatorArticleFromRaw(carrier.raw)
        )
        : null;
    if (explicitWordLocatorRecovery) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          explicitWordLocatorRecovery.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          explicitWordLocatorRecovery.journal,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.journal.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          explicitWordLocatorRecovery.volume,
          carrier.fields.volume.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.volume.confidence),
          {
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
      if (explicitWordLocatorRecovery.issue) {
        setExtractedField(
          carrier.fields,
          'issue',
          fieldOf(
            explicitWordLocatorRecovery.issue,
            carrier.fields.issue.source,
            STAGE_ID,
            Math.max(0.82, carrier.fields.issue.confidence),
            {
              origin: carrier.fields.issue.origin,
              previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
              previousSource: carrier.fields.issue.source,
              previousOrigin: carrier.fields.issue.origin,
            },
          ) as ExtractedFields['issue'],
        );
      }
      continue;
    }

    const needsLeadRepair =
      currentAuthors.length < 2
      || (currentTitle != null && (looksLikeAuthorSpill(currentTitle) || looksLikeLeadingAuthorSequence(currentTitle)))
      || (currentJournal != null && (looksLikeAuthorSpill(currentJournal) || looksLikeLeadingAuthorSequence(currentJournal)));

    if (!needsLeadRepair) {
      continue;
    }

    const semicolonArticleRecovery = recoverFlexibleSemicolonArticleFromRawDirect(carrier.raw);
    if (semicolonArticleRecovery) {
      const recoveredAuthors = parseExplicitLeadAuthors(semicolonArticleRecovery.authorSegment);
      setExtractedField(
        carrier.fields,
        'authors',
        fieldOf(
          recoveredAuthors,
          carrier.fields.authors.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.authors.confidence),
          {
            origin: carrier.fields.authors.origin,
            previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
            previousSource: carrier.fields.authors.source,
            previousOrigin: carrier.fields.authors.origin,
          },
        ) as ExtractedFields['authors'],
      );
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          semicolonArticleRecovery.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          semicolonArticleRecovery.journal,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.journal.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          semicolonArticleRecovery.volume,
          carrier.fields.volume.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.volume.confidence),
          {
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
      if (semicolonArticleRecovery.issue) {
        setExtractedField(
          carrier.fields,
          'issue',
          fieldOf(
            semicolonArticleRecovery.issue,
            carrier.fields.issue.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.issue.confidence),
            {
              origin: carrier.fields.issue.origin,
              previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
              previousSource: carrier.fields.issue.source,
              previousOrigin: carrier.fields.issue.origin,
            },
          ) as ExtractedFields['issue'],
        );
      }
      if (semicolonArticleRecovery.pages) {
        setExtractedField(
          carrier.fields,
          'pages',
          fieldOf(
            semicolonArticleRecovery.pages,
            carrier.fields.pages.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.pages.confidence),
            {
              origin: carrier.fields.pages.origin,
              previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
              previousSource: carrier.fields.pages.source,
              previousOrigin: carrier.fields.pages.origin,
            },
          ) as ExtractedFields['pages'],
        );
      }
      continue;
    }

    const numericBookRecovery =
      currentBookTitle == null
      && !/\.\s+In\s+/u.test(normalizedRaw)
        ? recoverNumericEnumeratedBookLeadFromRawDirect(carrier.raw)
        : null;
    const uppercaseTwoAuthorBookRecovery =
      numericBookRecovery == null
      && currentBookTitle == null
      && !/\.\s+In\s+/u.test(normalizedRaw)
        ? recoverUppercaseTwoAuthorBookLeadFromRaw(carrier.raw)
        : null;
    if (!numericBookRecovery && !uppercaseTwoAuthorBookRecovery) {
      continue;
    }

    const recoveredBookAuthors = numericBookRecovery
      ? parseExplicitLeadAuthors(numericBookRecovery.authorSegment)
      : (uppercaseTwoAuthorBookRecovery?.authors ?? []);
    const recoveredBookTitle = numericBookRecovery?.title ?? uppercaseTwoAuthorBookRecovery?.title ?? null;
    const recoveredBookPublisher = numericBookRecovery?.publisher ?? uppercaseTwoAuthorBookRecovery?.publisher ?? null;
    const recoveredBookYear = numericBookRecovery?.year ?? uppercaseTwoAuthorBookRecovery?.year ?? null;
    if (
      recoveredBookAuthors.length < 2
      || !recoveredBookTitle
      || !recoveredBookPublisher
      || recoveredBookYear == null
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'authors',
      fieldOf(
        recoveredBookAuthors,
        carrier.fields.authors.source,
        STAGE_ID,
        Math.max(0.84, carrier.fields.authors.confidence),
        {
          origin: carrier.fields.authors.origin,
          previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
          previousSource: carrier.fields.authors.source,
          previousOrigin: carrier.fields.authors.origin,
        },
      ) as ExtractedFields['authors'],
    );
    setExtractedField(
      carrier.fields,
      'title',
      fieldOf(
        recoveredBookTitle,
        carrier.fields.title.source,
        STAGE_ID,
        Math.max(0.84, carrier.fields.title.confidence),
        {
          origin: carrier.fields.title.origin,
          previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
          previousSource: carrier.fields.title.source,
          previousOrigin: carrier.fields.title.origin,
        },
      ) as ExtractedFields['title'],
    );
    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        recoveredBookPublisher,
        carrier.fields.publisher.source,
        STAGE_ID,
        Math.max(0.84, carrier.fields.publisher.confidence),
        {
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
    setExtractedField(
      carrier.fields,
      'year',
      fieldOf(
        recoveredBookYear,
        carrier.fields.year.source,
        STAGE_ID,
        Math.max(0.84, carrier.fields.year.confidence),
        {
          origin: carrier.fields.year.origin,
          previousValue: carrier.fields.year.value as ExtractedFields['year']['value'],
          previousSource: carrier.fields.year.source,
          previousOrigin: carrier.fields.year.origin,
        },
      ) as ExtractedFields['year'],
    );
  }
}

function enforceFinalRepeatedInstitutionalOwnerReports(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const repeatedInstitutionalOwnerReport = recoverQuotedRepeatedInstitutionalOwnerReportFromRaw(
      carrier.raw,
    );
    if (!repeatedInstitutionalOwnerReport) {
      continue;
    }

    const hasLocator =
      hasFieldValue(carrier.fields.volume)
      || hasFieldValue(carrier.fields.issue)
      || hasFieldValue(carrier.fields.pages);
    const hasNonDoiUrl =
      typeof carrier.fields.url.value === 'string'
      && !isDoiUrl(carrier.fields.url.value);
    const hasBookishIdentifier =
      hasFieldValue(carrier.fields.isbn)
      || hasFieldValue(carrier.fields.bookTitle)
      || looksBookChapterDoi(typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined)
      || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : '',
      );
    const hasConferenceEvidence =
      hasFieldValue(carrier.fields.conferenceTitle)
      || /\bpaper presented at\b/iu.test(carrier.raw)
      || CONFERENCE_CUE_REGEX.test(carrier.raw);
    if (hasLocator || hasNonDoiUrl || hasBookishIdentifier || hasConferenceEvidence) {
      continue;
    }

    const normalizedOwner = normalizeComparableText(repeatedInstitutionalOwnerReport.owner);
    const journal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : null;
    if (journal && normalizeComparableText(journal) !== normalizedOwner) {
      continue;
    }

    if (repeatedInstitutionalOwnerReport.title) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          repeatedInstitutionalOwnerReport.title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
    }

    setExtractedField(
      carrier.fields,
      'institution',
      fieldOf(
        repeatedInstitutionalOwnerReport.owner,
        carrier.fields.institution.source,
        STAGE_ID,
        Math.max(0.86, carrier.fields.institution.confidence),
        {
          origin: carrier.fields.institution.origin,
          previousValue: carrier.fields.institution.value as ExtractedFields['institution']['value'],
          previousSource: carrier.fields.institution.source,
          previousOrigin: carrier.fields.institution.origin,
        },
      ) as ExtractedFields['institution'],
    );

    for (const field of ['journal', 'publisher', 'conferenceTitle'] as const) {
      setExtractedField(
        carrier.fields,
        field,
        fieldOf(
          null,
          carrier.fields[field].source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields[field].origin,
            previousValue: carrier.fields[field].value as ExtractedFields[typeof field]['value'],
            previousSource: carrier.fields[field].source,
            previousOrigin: carrier.fields[field].origin,
          },
        ) as ExtractedFields[typeof field],
      );
    }

    if (
      Array.isArray(carrier.fields.authors.value)
      && carrier.fields.authors.value.length <= 1
    ) {
      setExtractedField(
        carrier.fields,
        'authors',
        fieldOf(
          [],
          carrier.fields.authors.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.authors.confidence),
          {
            origin: carrier.fields.authors.origin,
            previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
            previousSource: carrier.fields.authors.source,
            previousOrigin: carrier.fields.authors.origin,
          },
        ) as ExtractedFields['authors'],
      );
    }
  }
}

function repairSingleTokenConferenceArticleSpills(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    if (!conferenceTitle || conferenceTitle.length > 2) {
      continue;
    }

    const recoveredFromTitle = typeof carrier.fields.title.value === 'string'
      ? recoverArticleLocatorFromEmbeddedTitle(carrier.fields.title.value)
      : null;
    const recoveredFromTail =
      !recoveredFromTitle
      && typeof carrier.fields.title.value === 'string'
        ? recoverArticleLocatorAfterTitle(carrier.raw, carrier.fields.title.value)
        : null;
    if (!recoveredFromTitle && !recoveredFromTail) {
      continue;
    }

    const repairedTitle =
      recoveredFromTitle?.title
      ? recoverDecimalTerminalTokenFromRaw(carrier.raw, recoveredFromTitle.title) ?? recoveredFromTitle.title
      : typeof carrier.fields.title.value === 'string'
        ? recoverDecimalTerminalTokenFromRaw(carrier.raw, carrier.fields.title.value) ?? carrier.fields.title.value
        : null;
    if (repairedTitle) {
      setExtractedField(
        carrier.fields,
        'title',
        fieldOf(
          repairedTitle,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
    }

    const recoveredJournal = recoveredFromTitle?.journal ?? recoveredFromTail?.journal ?? null;
    if (recoveredJournal) {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          recoveredJournal,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.82, carrier.fields.journal.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
    }

    const recoveredVolume = recoveredFromTitle?.volume ?? recoveredFromTail?.volume ?? null;
    if (!hasFieldValue(carrier.fields.volume) && recoveredVolume) {
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          recoveredVolume,
          carrier.fields.volume.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.volume.confidence),
          {
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
    }

    const recoveredIssue = recoveredFromTitle?.issue ?? recoveredFromTail?.issue ?? null;
    if (!hasFieldValue(carrier.fields.issue) && recoveredIssue) {
      setExtractedField(
        carrier.fields,
        'issue',
        fieldOf(
          recoveredIssue,
          carrier.fields.issue.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.issue.confidence),
          {
            origin: carrier.fields.issue.origin,
            previousValue: carrier.fields.issue.value as ExtractedFields['issue']['value'],
            previousSource: carrier.fields.issue.source,
            previousOrigin: carrier.fields.issue.origin,
          },
        ) as ExtractedFields['issue'],
      );
    }

    const recoveredPages = recoveredFromTitle?.pages ?? recoveredFromTail?.pages ?? null;
    if (!hasFieldValue(carrier.fields.pages) && recoveredPages) {
      setExtractedField(
        carrier.fields,
        'pages',
        fieldOf(
          recoveredPages,
          carrier.fields.pages.source,
          STAGE_ID,
          Math.max(0.78, carrier.fields.pages.confidence),
          {
            origin: carrier.fields.pages.origin,
            previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
            previousSource: carrier.fields.pages.source,
            previousOrigin: carrier.fields.pages.origin,
          },
        ) as ExtractedFields['pages'],
      );
    }

    setExtractedField(
      carrier.fields,
      'conferenceTitle',
      fieldOf(
        null,
        carrier.fields.conferenceTitle.source,
        STAGE_ID,
        0,
        {
          uncertain: true,
          origin: carrier.fields.conferenceTitle.origin,
          previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
          previousSource: carrier.fields.conferenceTitle.source,
          previousOrigin: carrier.fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
  }
}

function repairFinalDecimalTitles(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    if (typeof carrier.fields.title.value !== 'string') {
      continue;
    }

    const repairedTitle = recoverDecimalTerminalTokenFromRaw(
      carrier.raw,
      carrier.fields.title.value,
    );
    if (
      !repairedTitle
      || normalizeComparableText(repairedTitle)
        === normalizeComparableText(carrier.fields.title.value)
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'title',
      fieldOf(
        repairedTitle,
        carrier.fields.title.source,
        STAGE_ID,
        Math.max(0.8, carrier.fields.title.confidence),
        {
          origin: carrier.fields.title.origin,
          previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
          previousSource: carrier.fields.title.source,
          previousOrigin: carrier.fields.title.origin,
        },
      ) as ExtractedFields['title'],
    );
  }
}

function repairFinalQuotedNumericConferencePublisherTails(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    if (
      carrier.style.family !== 'numeric'
      || typeof carrier.fields.title.value !== 'string'
      || !looksLikeAuthorSpill(carrier.fields.title.value)
    ) {
      continue;
    }

    const recoveredConference = recoverQuotedNumericConferencePublisherTailFromRaw(carrier.raw);
    if (!recoveredConference) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'authors',
      fieldOf(
        recoveredConference.authors,
        carrier.fields.authors.source,
        STAGE_ID,
        Math.max(0.82, carrier.fields.authors.confidence),
        {
          origin: carrier.fields.authors.origin,
          previousValue: carrier.fields.authors.value as ExtractedFields['authors']['value'],
          previousSource: carrier.fields.authors.source,
          previousOrigin: carrier.fields.authors.origin,
        },
      ) as ExtractedFields['authors'],
    );
    setExtractedField(
      carrier.fields,
      'title',
      fieldOf(
        recoveredConference.title,
        carrier.fields.title.source,
        STAGE_ID,
        Math.max(0.84, carrier.fields.title.confidence),
        {
          origin: carrier.fields.title.origin,
          previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
          previousSource: carrier.fields.title.source,
          previousOrigin: carrier.fields.title.origin,
        },
      ) as ExtractedFields['title'],
    );
    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        recoveredConference.publisher,
        carrier.fields.publisher.source,
        STAGE_ID,
        Math.max(0.82, carrier.fields.publisher.confidence),
        {
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
    if (recoveredConference.pages) {
      setExtractedField(
        carrier.fields,
        'pages',
        fieldOf(
          recoveredConference.pages,
          carrier.fields.pages.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.pages.confidence),
          {
            origin: carrier.fields.pages.origin,
            previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
            previousSource: carrier.fields.pages.source,
            previousOrigin: carrier.fields.pages.origin,
          },
        ) as ExtractedFields['pages'],
      );
    }
    if (
      typeof carrier.fields.volume.value === 'string'
      && normalizeComparableText(carrier.fields.volume.value)
        === normalizeComparableText(String(recoveredConference.year))
    ) {
      setExtractedField(
        carrier.fields,
        'volume',
        fieldOf(
          null,
          carrier.fields.volume.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.volume.origin,
            previousValue: carrier.fields.volume.value as ExtractedFields['volume']['value'],
            previousSource: carrier.fields.volume.source,
            previousOrigin: carrier.fields.volume.origin,
          },
        ) as ExtractedFields['volume'],
      );
    }
    if (typeof carrier.fields.journal.value === 'string') {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          null,
          carrier.fields.journal.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
    }
    if (typeof carrier.fields.year.value !== 'number' && recoveredConference.year != null) {
      setExtractedField(
        carrier.fields,
        'year',
        fieldOf(
          recoveredConference.year,
          carrier.fields.year.source,
          STAGE_ID,
          Math.max(0.92, carrier.fields.year.confidence),
          {
            origin: carrier.fields.year.origin,
            previousValue: carrier.fields.year.value as ExtractedFields['year']['value'],
            previousSource: carrier.fields.year.source,
            previousOrigin: carrier.fields.year.origin,
          },
        ) as ExtractedFields['year'],
      );
    }
  }
}

function recoverQuotedNumericConferencePublisherTailFromRaw(raw: string) {
  return recoverQuotedNumericConferencePublisherTailFromRawCached(raw);
}

const recoverQuotedNumericConferencePublisherTailFromRawCached = createBoundedValueCache<{
  authorSegment: string;
  authors: CanonicalAuthor[];
  title: string;
  publisher: string;
  year: number;
  pages: string | null;
} | null>(
  QUOTED_NUMERIC_CONFERENCE_RECOVERY_CACHE_LIMIT,
  (raw) => {
  const parseableRaw = stripTrailingIdentifierTailForParsing(raw.replace(/\s+/gu, ' ').trim());
  const match = parseableRaw.match(
    /^(?:\[\d+\]\s*)?(?<authors>.+?),\s*[“"](?<title>.+?)[”"]\s*(?<publisher>[^,;“”"]+)[,;]\s*(?<year>(?:19|20)\d{2})(?:,\s*p{1,2}\.?\s*(?<pages>[^.;]+))?\.?$/iu,
  );
  if (!match?.groups?.authors || !match.groups.title || !match.groups.publisher || !match.groups.year) {
    return null;
  }

  const authorSegment = stripTrailingPunctuation(match.groups.authors);
  const authors = parseRecoverableNumericConferenceAuthors(authorSegment);
  const rawQuotedTitle = findQuotedTitle(raw)?.title ?? null;
  const title =
    stripTrailingPunctuation(rawQuotedTitle ?? '').trim()
    || stripTrailingPunctuation(match.groups.title).trim()
    || normalizeTitleCandidate(match.groups.title);
  const cleanedPublisher = stripTrailingPunctuation(match.groups.publisher).trim();
  const publisher =
    normalizePublisherCandidate(cleanedPublisher, title ?? undefined)
    ?? normalizeConferenceTitle(cleanedPublisher);
  const year = toYear(match.groups.year);
  const pages = match.groups.pages ? normalizePages(match.groups.pages) : null;
  if (
    authors.length < 1
    || !title
    || title.split(/\s+/u).filter(Boolean).length < 5
    || !publisher
    || year == null
  ) {
    return null;
  }

  return {
    authorSegment,
    authors,
    title,
    publisher,
    year,
    pages,
  };
  },
);

function finalizeConferenceFieldSanity(carriers: ReferenceCarrier[]): void {
  const groundedConferenceCueRegex =
    /\b(?:proceedings?|conference|congress|symposium|workshop|meeting|paper presented at|jornadas?|anais)\b/iu;

  for (const carrier of carriers) {
    const raw = normalizeExtractionInput(carrier.raw);
    const rawSupport = buildRawCitationSupportFromNormalizedRaw(raw);
    const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;
    const bookTitle = typeof carrier.fields.bookTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.bookTitle.value)
      : null;
    const journal = typeof carrier.fields.journal.value === 'string'
      ? normalizeJournalCandidate(carrier.fields.journal.value, title)
      : null;
    const rawConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? carrier.fields.conferenceTitle.value
      : null;
    const conferenceTitle = rawConferenceTitle != null
      ? normalizeConferenceTitle(rawConferenceTitle)
      : null;
    const publisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const institution = typeof carrier.fields.institution.value === 'string'
      ? (
        normalizeInstitutionCandidate(carrier.fields.institution.value)
        ?? stripTrailingPunctuation(carrier.fields.institution.value).trim()
        ?? null
      )
      : null;
    const thesisType = typeof carrier.fields.thesisType.value === 'string'
      ? carrier.fields.thesisType.value
      : null;
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined;
    const isbn = typeof carrier.fields.isbn.value === 'string' ? carrier.fields.isbn.value : null;
    const hasArticleLocators =
      hasFieldValue(carrier.fields.volume)
      || hasFieldValue(carrier.fields.issue)
      || hasFieldValue(carrier.fields.pages);
    const bookLikeIdentifier =
      Boolean(isbn)
      || looksBookChapterDoi(doi)
      || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? '');
    const reportLikeDoi = looksReportLikeDoi(doi, {
      raw,
      owner: institution ?? publisher ?? conferenceTitle ?? undefined,
    });
    const hasGroundedConferenceCue = groundedConferenceCueRegex.test(raw);

    if (
      rawConferenceTitle
      && conferenceTitle
      && stripTrailingPunctuation(rawConferenceTitle).trim() !== conferenceTitle
    ) {
      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          conferenceTitle,
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.conferenceTitle.confidence),
          {
            origin: carrier.fields.conferenceTitle.origin,
            previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
    }

    const reclaimedJournalFromConferenceTitle =
      conferenceTitle
      && !hasGroundedConferenceCue
      && !bookLikeIdentifier
      && !reportLikeDoi
      && hasArticleLocators
      && looksJournalLikeContainer(conferenceTitle)
      && !looksConferenceContainer(conferenceTitle)
      && !looksConferenceVenueAlias(conferenceTitle)
        ? normalizeJournalCandidate(conferenceTitle, title)
        : null;

    if (
      reclaimedJournalFromConferenceTitle
      && (!journal || looksLowQualityContainerCandidate(journal))
    ) {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          reclaimedJournalFromConferenceTitle,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.84, carrier.fields.conferenceTitle.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          null,
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.conferenceTitle.origin,
            previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
      continue;
    }

    if (publisher && bookTitle) {
      const publisherWithoutBookTitle = stripTrailingPunctuation(
        publisher.replace(new RegExp(`^${escapeRegex(bookTitle)}\\s*,\\s*`, 'iu'), ''),
      ).trim();
      if (
        publisherWithoutBookTitle
        && publisherWithoutBookTitle.length < publisher.length
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            publisherWithoutBookTitle,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
    }

    if (
      conferenceTitle
      && !hasGroundedConferenceCue
      && !journal
      && !hasArticleLocators
      && bookLikeIdentifier
    ) {
      const splitConferenceTail =
        looksBookChapterDoi(doi)
          ? splitBookChapterConferenceTail(conferenceTitle, title)
          : null;
      const recoveredBookTitle = splitConferenceTail?.bookTitle ?? null;
      const recoveredPublisher =
        splitConferenceTail?.publisher
        ?? (
          recoveredBookTitle
            ? stripTrailingPunctuation(
              conferenceTitle
                .replace(new RegExp(`^${escapeRegex(recoveredBookTitle)}\\s*,\\s*`, 'iu'), ''),
            ).trim()
            : conferenceTitle
        );

      if (recoveredBookTitle && (!carrier.fields.bookTitle.value || looksLowQualityContainerCandidate(String(carrier.fields.bookTitle.value)))) {
        setExtractedField(
          carrier.fields,
          'bookTitle',
          fieldOf(
            recoveredBookTitle,
            carrier.fields.bookTitle.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.conferenceTitle.confidence),
            {
              origin: carrier.fields.bookTitle.origin,
              previousValue: carrier.fields.bookTitle.value as ExtractedFields['bookTitle']['value'],
              previousSource: carrier.fields.bookTitle.source,
              previousOrigin: carrier.fields.bookTitle.origin,
            },
          ) as ExtractedFields['bookTitle'],
        );
      }

      if ((!publisher || looksLowQualityContainerCandidate(publisher)) && recoveredPublisher) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            recoveredPublisher,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.conferenceTitle.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          null,
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          0,
          {
            uncertain: true,
            origin: carrier.fields.conferenceTitle.origin,
            previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
      continue;
    }

    if (
      !conferenceTitle
      && !journal
      && !hasArticleLocators
      && !bookLikeIdentifier
    ) {
      const recoveredConferenceTitleFromSnippet = recoverLooseDatePlaceConferenceSnippet(
        raw,
        rawSupport,
      );
      const recoveredConferenceTitle =
        recoveredConferenceTitleFromSnippet
        ?? (title
          ? recoverInstitutionalConferenceTailBeforeYearFromRaw(raw, title, rawSupport)
          : null);
      if (
        recoveredConferenceTitle
        && (
          looksConferencePublicationVenue(recoveredConferenceTitle)
          || shouldPreserveConferenceTemporalTail(recoveredConferenceTitle)
          || looksConferencePublisherOrganization(recoveredConferenceTitle)
          || looksAllCapsConferenceTailCandidate(recoveredConferenceTitle)
          || /,\s*[A-Z]{2},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2}$/u.test(recoveredConferenceTitle)
        )
        && (
          !reportLikeDoi
          || Boolean(recoveredConferenceTitleFromSnippet)
          || looksConferencePublicationVenue(recoveredConferenceTitle)
          || shouldPreserveConferenceTemporalTail(recoveredConferenceTitle)
          || /,\s*[A-Z]{2},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2}$/u.test(recoveredConferenceTitle)
        )
      ) {
        setExtractedField(
          carrier.fields,
          'conferenceTitle',
          fieldOf(
            recoveredConferenceTitle,
            carrier.fields.conferenceTitle.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.conferenceTitle.confidence),
            {
              origin: carrier.fields.conferenceTitle.origin,
              previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
              previousSource: carrier.fields.conferenceTitle.source,
              previousOrigin: carrier.fields.conferenceTitle.origin,
            },
          ) as ExtractedFields['conferenceTitle'],
        );
      }
    }

    if (
      !publisher
      && institution
      && !journal
      && !conferenceTitle
      && !bookLikeIdentifier
      && !hasArticleLocators
      && hasQuotedOwnerSlot(raw, institution, rawSupport)
    ) {
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          institution,
          carrier.fields.publisher.source,
          STAGE_ID,
          Math.max(0.76, carrier.fields.institution.confidence),
          {
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }

    if (title && conferenceTitle && !hasGroundedConferenceCue) {
      const recoveredArticle = recoverArticleLocatorAfterTitle(raw, title);
      if (
        recoveredArticle
        && looksJournalLikeContainer(recoveredArticle.journal)
        && !looksConferencePublicationVenue(recoveredArticle.journal)
      ) {
        setExtractedField(
          carrier.fields,
          'journal',
          fieldOf(
            recoveredArticle.journal,
            carrier.fields.journal.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.journal.confidence),
            {
              origin: carrier.fields.journal.origin,
              previousValue: carrier.fields.journal.value,
              previousSource: carrier.fields.journal.source,
              previousOrigin: carrier.fields.journal.origin,
            },
          ) as ExtractedFields['journal'],
        );
        if (recoveredArticle.volume) {
          setExtractedField(
            carrier.fields,
            'volume',
            fieldOf(
              recoveredArticle.volume,
              carrier.fields.volume.source,
              STAGE_ID,
              Math.max(0.76, carrier.fields.volume.confidence),
              {
                origin: carrier.fields.volume.origin,
                previousValue: carrier.fields.volume.value,
                previousSource: carrier.fields.volume.source,
                previousOrigin: carrier.fields.volume.origin,
              },
            ) as ExtractedFields['volume'],
          );
        }
        if (recoveredArticle.issue) {
          setExtractedField(
            carrier.fields,
            'issue',
            fieldOf(
              recoveredArticle.issue,
              carrier.fields.issue.source,
              STAGE_ID,
              Math.max(0.76, carrier.fields.issue.confidence),
              {
                origin: carrier.fields.issue.origin,
                previousValue: carrier.fields.issue.value,
                previousSource: carrier.fields.issue.source,
                previousOrigin: carrier.fields.issue.origin,
              },
            ) as ExtractedFields['issue'],
          );
        }
        if (recoveredArticle.pages) {
          setExtractedField(
            carrier.fields,
            'pages',
            fieldOf(
              recoveredArticle.pages,
              carrier.fields.pages.source,
              STAGE_ID,
              Math.max(0.76, carrier.fields.pages.confidence),
              {
                origin: carrier.fields.pages.origin,
                previousValue: carrier.fields.pages.value,
                previousSource: carrier.fields.pages.source,
                previousOrigin: carrier.fields.pages.origin,
              },
            ) as ExtractedFields['pages'],
          );
        }
        setExtractedField(
          carrier.fields,
          'conferenceTitle',
          fieldOf(
            null,
            carrier.fields.conferenceTitle.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.conferenceTitle.origin,
              previousValue: carrier.fields.conferenceTitle.value,
              previousSource: carrier.fields.conferenceTitle.source,
              previousOrigin: carrier.fields.conferenceTitle.origin,
              uncertain: true,
            },
          ) as ExtractedFields['conferenceTitle'],
        );
      }
    }

    const locatorBackedConferenceJournal = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const recoveredLocatorBackedJournal =
      locatorBackedConferenceJournal != null
        ? recoverJournalFromConferenceStyledContainer(locatorBackedConferenceJournal)
        : null;
    const conferenceContainerLooksJournalish =
      locatorBackedConferenceJournal != null
      && (
        recoveredLocatorBackedJournal != null
        || looksJournalLikeContainer(locatorBackedConferenceJournal)
        || /\b(?:journal|revista|review|annals?|letters?|transactions?|bulletin|law review)\b/iu.test(locatorBackedConferenceJournal)
        || hasFieldValue(carrier.fields.issn)
      );
    if (
      !journal
      && locatorBackedConferenceJournal
      && conferenceContainerLooksJournalish
      && (
        recoveredLocatorBackedJournal != null
        || hasFieldValue(carrier.fields.issn)
        || hasFieldValue(carrier.fields.volume)
        || hasFieldValue(carrier.fields.issue)
        || hasFieldValue(carrier.fields.pages)
      )
    ) {
      setExtractedField(
        carrier.fields,
        'journal',
        fieldOf(
          recoveredLocatorBackedJournal?.journal ?? locatorBackedConferenceJournal,
          carrier.fields.journal.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.conferenceTitle.confidence),
          {
            origin: carrier.fields.journal.origin,
            previousValue: carrier.fields.journal.value,
            previousSource: carrier.fields.journal.source,
            previousOrigin: carrier.fields.journal.origin,
          },
        ) as ExtractedFields['journal'],
      );
      if (recoveredLocatorBackedJournal?.volume && !hasFieldValue(carrier.fields.volume)) {
        setExtractedField(
          carrier.fields,
          'volume',
          fieldOf(
            recoveredLocatorBackedJournal.volume,
            carrier.fields.volume.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.volume.confidence),
            {
              origin: carrier.fields.volume.origin,
              previousValue: carrier.fields.volume.value,
              previousSource: carrier.fields.volume.source,
              previousOrigin: carrier.fields.volume.origin,
            },
          ) as ExtractedFields['volume'],
        );
      }
      if (recoveredLocatorBackedJournal?.issue && !hasFieldValue(carrier.fields.issue)) {
        setExtractedField(
          carrier.fields,
          'issue',
          fieldOf(
            recoveredLocatorBackedJournal.issue,
            carrier.fields.issue.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.issue.confidence),
            {
              origin: carrier.fields.issue.origin,
              previousValue: carrier.fields.issue.value,
              previousSource: carrier.fields.issue.source,
              previousOrigin: carrier.fields.issue.origin,
            },
          ) as ExtractedFields['issue'],
        );
      }
      if (recoveredLocatorBackedJournal?.pages && !hasFieldValue(carrier.fields.pages)) {
        setExtractedField(
          carrier.fields,
          'pages',
          fieldOf(
            recoveredLocatorBackedJournal.pages,
            carrier.fields.pages.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.pages.confidence),
            {
              origin: carrier.fields.pages.origin,
              previousValue: carrier.fields.pages.value,
              previousSource: carrier.fields.pages.source,
              previousOrigin: carrier.fields.pages.origin,
            },
          ) as ExtractedFields['pages'],
        );
      }
      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          null,
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          0,
          {
            origin: carrier.fields.conferenceTitle.origin,
            previousValue: carrier.fields.conferenceTitle.value,
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
            uncertain: true,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          null,
          carrier.fields.publisher.source,
          STAGE_ID,
          0,
          {
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value,
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
            uncertain: true,
          },
        ) as ExtractedFields['publisher'],
      );
    }

    const refreshedConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const refreshedPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;

    if (
      refreshedConferenceTitle
      && !CONFERENCE_DOI_REGEX.test(raw)
      && !looksProceedingsLikeDoi(doi)
      && (
        thesisType
        || hasThesisCue(raw)
        || (!hasGroundedConferenceCue && hasReportCue(raw))
        || (!hasGroundedConferenceCue && hasReportCue(refreshedConferenceTitle))
        || (
          !hasGroundedConferenceCue
          && institution
          && normalizeComparableText(refreshedConferenceTitle) === normalizeComparableText(institution)
        )
        || (
          !hasGroundedConferenceCue
          && (
            looksInstitutionalContainer(refreshedConferenceTitle)
            || looksStandaloneInstitutionalAlias(refreshedConferenceTitle)
            || looksReportPublisherAcronym(refreshedConferenceTitle)
          )
        )
      )
    ) {
      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          null,
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          0,
          {
            origin: carrier.fields.conferenceTitle.origin,
            previousValue: carrier.fields.conferenceTitle.value,
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
            uncertain: true,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
    }

    const saneConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;

    if (title && saneConferenceTitle && saneConferenceTitle.length <= 3) {
      const recoveredConferencePair =
        recoverDatePlaceConferenceFromRaw(raw, rawSupport)
        ?? recoverAuthorDateConferenceContainerFromRaw(raw, rawSupport);
      const recoveredConference = recoveredConferencePair?.conferenceTitle
        ?? recoverConferenceContainerAfterTitle(raw, title);
      const recoveredOverflowTitle = recoveredConference
        ? (
          recoveredConferencePair?.title
          ?? recoverTitleOverflowBeforeContainer(raw, title, recoveredConference)
        )
        : null;
      if (recoveredConference && looksConferencePublicationVenue(recoveredConference)) {
        setExtractedField(
          carrier.fields,
          'conferenceTitle',
          fieldOf(
            recoveredConference,
            carrier.fields.conferenceTitle.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.conferenceTitle.confidence),
            {
              origin: carrier.fields.conferenceTitle.origin,
              previousValue: carrier.fields.conferenceTitle.value,
              previousSource: carrier.fields.conferenceTitle.source,
              previousOrigin: carrier.fields.conferenceTitle.origin,
            },
          ) as ExtractedFields['conferenceTitle'],
        );
        if (recoveredOverflowTitle) {
          setExtractedField(
            carrier.fields,
            'title',
            fieldOf(
              recoveredOverflowTitle,
              carrier.fields.title.source,
              STAGE_ID,
              Math.max(0.78, carrier.fields.title.confidence),
              {
                origin: carrier.fields.title.origin,
                previousValue: carrier.fields.title.value,
                previousSource: carrier.fields.title.source,
                previousOrigin: carrier.fields.title.origin,
              },
            ) as ExtractedFields['title'],
          );
        }
      }
    }

    const finalConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const finalPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;

    if (finalPublisher && title) {
      const trimmedPublisher = finalConferenceTitle
        ? trimPublisherAfterConferencePrefix(finalPublisher, finalConferenceTitle)
        : null;
      const recoveredPublisherYearTail =
        recoverQuotedPublisherBeforeYearFromRaw(raw, title, finalConferenceTitle, rawSupport)
        ?? recoverPublisherYearTailFromRaw(raw, title)?.publisher
        ?? recoverLoosePublisherYearTailFromRaw(raw, title, finalConferenceTitle)
        ?? null;
      if (trimmedPublisher && normalizeComparableText(trimmedPublisher) !== normalizeComparableText(finalPublisher)) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            trimmedPublisher,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
        continue;
      }

      const explicitConferencePublisher = recoverExplicitConferencePublisherFromRaw(
        raw,
        title,
        finalConferenceTitle,
        doi,
      );
      const normalizedTitle = normalizeComparableText(title);
      const publisherContainsTitle =
        normalizedTitle.length >= 10 && normalizeComparableText(finalPublisher).includes(normalizedTitle);
      const publisherContainsConference =
        finalConferenceTitle
        && normalizeComparableText(finalPublisher).includes(normalizeComparableText(finalConferenceTitle));
      const shouldDropCompactAliasPublisher =
        Boolean(finalConferenceTitle)
        && carrier.style.family !== 'numeric'
        && /\bavailable at:/iu.test(raw)
        && looksCompactConferenceVenueAlias(finalPublisher);

      if (recoveredPublisherYearTail) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            recoveredPublisherYearTail,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      } else if (shouldDropCompactAliasPublisher) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            null,
            carrier.fields.publisher.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
              uncertain: true,
            },
          ) as ExtractedFields['publisher'],
        );
      } else if (
        explicitConferencePublisher
        && (
          !finalConferenceTitle
          || normalizeComparableText(explicitConferencePublisher)
            !== normalizeComparableText(finalConferenceTitle)
        )
        && !(
          normalizedTitle.length >= 10
          && normalizeComparableText(explicitConferencePublisher).includes(normalizedTitle)
        )
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            explicitConferencePublisher,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      } else if (publisherContainsTitle || publisherContainsConference) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            null,
            carrier.fields.publisher.source,
            STAGE_ID,
            0,
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
              uncertain: true,
            },
          ) as ExtractedFields['publisher'],
        );
      }
    }

    const settledPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const settledConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    if (
      settledPublisher
      && institution
      && !hasGroundedConferenceCue
      && (
        normalizeComparableText(settledPublisher) === normalizeComparableText(institution)
        || normalizeComparableText(settledPublisher).endsWith(normalizeComparableText(institution))
      )
      && !settledConferenceTitle
    ) {
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          null,
          carrier.fields.publisher.source,
          STAGE_ID,
          0,
          {
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value,
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
            uncertain: true,
          },
        ) as ExtractedFields['publisher'],
      );
    }
  }
}

function trimPublisherAfterConferencePrefix(
  publisher: string,
  conferenceTitle: string,
): string | null {
  const normalizedPublisher = normalizeConferenceTitle(publisher);
  const normalizedConference = normalizeConferenceTitle(conferenceTitle);
  if (!normalizedPublisher || !normalizedConference) {
    return null;
  }

  const trimmedPrefix = normalizedPublisher
    .replace(new RegExp(`^in\\s+${escapeRegex(normalizedConference)}\\s*,\\s*`, 'iu'), '')
    .replace(new RegExp(`^${escapeRegex(normalizedConference)}\\s*,\\s*`, 'iu'), '')
    .trim();
  if (trimmedPrefix && trimmedPrefix !== normalizedPublisher) {
    return normalizeConferenceTitle(trimmedPrefix);
  }

  const conferenceIndex = normalizedPublisher.toLocaleLowerCase().indexOf(normalizedConference.toLocaleLowerCase());
  if (conferenceIndex >= 0) {
    const trailing = normalizedPublisher
      .slice(conferenceIndex + normalizedConference.length)
      .replace(/^[,;:\s]+/u, '')
      .trim();
    if (trailing) {
      return normalizeConferenceTitle(trailing);
    }
  }

  return null;
}

function recoverAuthorDateConferenceContainerFromRaw(
  raw: string,
  rawSupport?: RawCitationSupport,
): { title: string; conferenceTitle: string } | null {
  const parseableRaw = (rawSupport ?? buildRawCitationSupport(raw)).parseableRaw;
  const match = parseableRaw.match(
    /\((?<year>(?:19|20)\d{2})\)\.\s*(?<title>.+?)\.\s*(?<conference>[A-Z0-9][^.]{8,220},\s+[^.]{4,220}(?:,\s*(?:19|20)\d{2})?)\.?$/u,
  );
  const recoveredTitle = match?.groups?.title ? normalizeTitleCandidate(match.groups.title) : null;
  const recoveredConference = match?.groups?.conference
    ? normalizeConferenceTitle(match.groups.conference)
    : null;
  if (
    !recoveredTitle
    || !recoveredConference
    || looksInstitutionalContainer(recoveredConference)
    || !looksConferencePublicationVenue(recoveredConference)
  ) {
    return null;
  }

  return {
    title: recoveredTitle,
    conferenceTitle: recoveredConference,
  };
}

function recoverDatePlaceConferenceFromRaw(
  raw: string,
  rawSupport?: RawCitationSupport,
): { title: string | null; conferenceTitle: string } | null {
  const support = rawSupport ?? buildRawCitationSupport(raw);
  const parseableRaw = support.parseableRaw;
  const quotedTailConference = recoverQuotedDatePlaceConferenceFromRaw(raw, support);
  const uppercaseConferencePair = recoverUppercaseDatePlaceConferencePair(raw, support);
  const authorDateMatch = parseableRaw.match(
    /\((?:19|20)\d{2}\)\.\s*(?<title>.+?)\.\s*(?<conference>[A-Z0-9].{8,220}?,\s*.{3,220}?,\s*(?:[A-Za-z]{3,9}\s+\d{1,2},\s*)?(?:19|20)\d{2})\.?$/u,
  );
  const quotedMatch = parseableRaw.match(
    /[”"']\.?\s*(?:(?:19|20)\d{2},\s*)?(?<conference>[A-Z0-9].{8,220}?,\s*.{3,220}?,\s*(?:[A-Za-z]{3,9}\s+\d{1,2},\s*)?(?:19|20)\d{2})(?:[.,]|$)/u,
  );
  const recoveredConference = normalizeConferenceTitle(
    quotedTailConference?.conferenceTitle
      ?? uppercaseConferencePair?.conferenceTitle
      ?? authorDateMatch?.groups?.conference
      ?? quotedMatch?.groups?.conference
      ?? '',
  );
  if (
    !recoveredConference
    || looksInstitutionalContainer(recoveredConference)
    || !looksConferencePublicationVenue(recoveredConference)
  ) {
    return null;
  }

  const recoveredTitle = authorDateMatch?.groups?.title
    ? normalizeTitleCandidate(authorDateMatch.groups.title)
    : quotedTailConference?.title ?? uppercaseConferencePair?.title ?? null;

  return {
    title: recoveredTitle,
    conferenceTitle: recoveredConference,
  };
}

function recoverUppercaseDatePlaceConferencePair(
  raw: string,
  rawSupport?: RawCitationSupport,
): { title: string | null; conferenceTitle: string } | null {
  const parseableRaw = (rawSupport ?? buildRawCitationSupport(raw)).parseableRaw;
  const match = parseableRaw.match(
    /\((?:19|20)\d{2}\)\.\s*(?<title>.+?)\.\s*(?<conference>[A-Z][A-Z0-9]+(?:\s+\d{4})?,\s*[^,]{2,80},\s*[A-Za-z.]{2,20},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2})/u,
  );
  const conferenceTitle = match?.groups?.conference
    ? normalizeConferenceTitle(match.groups.conference)
    : null;
  const title = match?.groups?.title ? normalizeTitleCandidate(match.groups.title) : null;
  if (
    !conferenceTitle
    || !title
    || looksInstitutionalContainer(conferenceTitle)
  ) {
    return null;
  }
  return { title, conferenceTitle };
}

function recoverQuotedDatePlaceConferenceFromRaw(
  raw: string,
  rawSupport?: RawCitationSupport,
): { title: string | null; conferenceTitle: string } | null {
  const support = rawSupport ?? buildRawCitationSupport(raw);
  const parseableRaw = support.parseableRaw;
  const quotedTitle = support.quotedTitle;
  if (!quotedTitle?.title) {
    return null;
  }

  const tail = parseableRaw
    .slice(quotedTitle.end)
    .replace(/^[,.;:\s]+/u, '')
    .replace(/^(?:19|20)\d{2},\s*/u, '')
    .replace(/[.,;:\s]+$/u, '')
    .trim();
  if (!tail) {
    return null;
  }

  const conferenceTitle = normalizeConferenceTitle(tail);
  if (
    !conferenceTitle
    || looksInstitutionalContainer(conferenceTitle)
    || !looksConferencePublicationVenue(conferenceTitle)
  ) {
    return null;
  }

  return {
    title: normalizeTitleCandidate(quotedTitle.title),
    conferenceTitle,
  };
}

function recoverQuotedPublisherBeforeYearFromRaw(
  raw: string,
  titleHint?: string | null,
  conferenceTitleHint?: string | null,
  rawSupport?: RawCitationSupport,
): string | null {
  void rawSupport;
  return recoverQuotedPublisherBeforeYearFromRawCached(composeCacheKey(raw, titleHint, conferenceTitleHint));
}

const recoverQuotedPublisherBeforeYearFromRawCached = createBoundedValueCache<string | null>(
  QUOTED_PUBLISHER_BEFORE_YEAR_CACHE_LIMIT,
  (cacheKey) => {
    const [raw = '', titleHint = '', conferenceTitleHint = ''] = cacheKey.split('\u0000');
    const parseableRaw = buildRawCitationSupport(raw).parseableRaw;
    const match =
      parseableRaw.match(/[”"']\s*,\s*(?<publisher>[^,.;]{2,120})\s*,\s*(?:19|20)\d{2}(?:[.,]|$)/u)
      ?? parseableRaw.match(/[”"']\s*\.\s*(?<publisher>[^,.;]{2,120})\s*,\s*(?:19|20)\d{2}(?:[.,]|$)/u);
    const publisher = match?.groups?.publisher
      ? normalizeConferencePublisherSlotCandidate(
        match.groups.publisher.replace(/^[\s"'“”'‘’.,;:]+/u, ''),
        titleHint || null,
        conferenceTitleHint || null,
      )
      : null;
    return publisher && !looksConferencePublicationVenue(publisher) ? publisher : null;
  },
);

function recoverLooseDatePlaceConferenceSnippet(
  raw: string,
  rawSupport?: RawCitationSupport,
): string | null {
  void rawSupport;
  return recoverLooseDatePlaceConferenceSnippetCached(raw);
}

const recoverLooseDatePlaceConferenceSnippetCached = createBoundedValueCache<string | null>(
  LOOSE_DATE_PLACE_CONFERENCE_CACHE_LIMIT,
  (raw) => {
    const parseableRaw = buildRawCitationSupport(raw).parseableRaw;
    const match =
      parseableRaw.match(
        /(?:^|[.?!]\s+|[”"']\s*[,.;]\s+)(?<conference>[A-Z0-9][A-Za-z0-9 .,&()/'-]{6,220},\s*[A-Za-z. -]{2,80},\s*[A-Za-z. -]{2,40},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2})(?:[.;]|$)/u,
      )
      ?? parseableRaw.match(
        /(?:^|[.?!]\s+|[”"']\s*[,.;]\s+)(?<conference>[A-Z0-9][A-Za-z0-9 .,&()/'-]{6,220},\s*[A-Za-z. -]{2,80},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2})(?:[.;]|$)/u,
      )
      ?? parseableRaw.match(
        /(?:^|[.?!]\s+|[”"']\s*[,.;]\s+)(?<conference>[A-Z0-9][A-Za-z0-9 .,&()/'-]{6,220},\s*[A-Za-z. -]{2,80},\s*[A-Za-z. -]{2,80},\s*[A-Z]{2},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2})(?:[.;]|$)/u,
      );
    const conferenceTitle = match?.groups?.conference
      ? normalizeConferenceTitle(match.groups.conference)
      : null;
    if (
      !conferenceTitle
      || looksInstitutionalContainer(conferenceTitle)
      || (
        !looksConferencePublicationVenue(conferenceTitle)
        && !shouldPreserveConferenceTemporalTail(conferenceTitle)
        && !/,\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2}$/u.test(conferenceTitle)
      )
    ) {
      return null;
    }
    return conferenceTitle;
  },
);

function recoverInstitutionalConferenceTailBeforeYearFromRaw(
  raw: string,
  title: string,
  rawSupport?: RawCitationSupport,
): string | null {
  const parseableRaw = (rawSupport ?? buildRawCitationSupport(raw)).parseableRaw;
  const tail =
    extractTailAfterTitle(raw, title)
    ?? parseableRaw.match(
      new RegExp(
        `${escapeRegex(stripTrailingPunctuation(normalizeExtractionInput(title)).replace(/^["“”'‘’\\s]+/u, '').replace(/["“”'‘’\\s]+$/u, '').trim())}[,.;:]\\s*(?<tail>[^.;]{2,220}[,;]\\s*(?:1[6-9]|20)\\d{2})(?:[.;]|$)`,
        'iu',
      ),
    )?.groups?.tail
    ?? null;
  if (!tail) {
    return null;
  }

  const temporalTailMatch = tail.match(
    /^(?<conferencePrefix>[^.;]{2,220},\s*(?:[A-Za-z. -]{2,80},\s*)?[A-Z]{2},\s*[A-Za-z]{3,9}\s+\d{1,2}),\s*(?<year>(?:1[6-9]|20)\d{2})(?:[.;]|$)/u,
  );
  const temporalConferencePrefix = temporalTailMatch?.groups?.conferencePrefix
    ? normalizeConferenceTitle(temporalTailMatch.groups.conferencePrefix)
    : null;
  if (temporalConferencePrefix && temporalTailMatch?.groups?.year) {
    return `${temporalConferencePrefix.replace(/,\s*$/u, '')}, ${temporalTailMatch.groups.year}`;
  }

  const match = tail.match(/^(?<conference>[^.;]{2,220})[,;]\s*(?<year>(?:1[6-9]|20)\d{2})(?:[.;]|$)/u);
  const conferenceTitle = match?.groups?.conference
    ? normalizeConferenceTitle(match.groups.conference)
    : null;
  if (!conferenceTitle) {
    return null;
  }

  if (
    looksConferencePublicationVenue(conferenceTitle)
    || looksConferencePublisherOrganization(conferenceTitle)
    || looksAllCapsConferenceTailCandidate(conferenceTitle)
  ) {
    return conferenceTitle;
  }

  return null;
}

function hasQuotedOwnerSlot(
  raw: string,
  owner: string,
  rawSupport?: RawCitationSupport,
): boolean {
  const parseableRaw = (rawSupport ?? buildRawCitationSupport(raw)).parseableRaw;
  const escapedOwner = escapeRegex(owner).replace(/\s+/gu, '\\s+');
  return new RegExp(
    `[”"']\\s*(?:[.,]|\\s)\\s*${escapedOwner}(?:\\s*[,;]\\s*(?:1[6-9]|20)\\d{2})?(?:[.;]|$)`,
    'iu',
  ).test(parseableRaw);
}

function looksAllCapsConferenceTailCandidate(text: string): boolean {
  const normalized = normalizeConferenceTitle(text);
  if (!normalized || looksLowQualityContainerCandidate(normalized)) {
    return false;
  }
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  if (tokens.length < 3) {
    return false;
  }
  if (looksInstitutionalAcronymPhrase(normalized) || looksReportPublisherAcronym(normalized)) {
    return false;
  }
  const letters = [...normalized].filter((character) => /\p{L}/u.test(character));
  if (letters.length < 10) {
    return false;
  }
  const uppercaseLetters = letters.filter((character) => character === character.toUpperCase()).length;
  return uppercaseLetters / letters.length >= 0.8;
}

function recoverUppercaseConferenceContainerFromJournal(
  value: string | null | undefined,
): { conferenceTitle: string; pages: string | null } | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeConferenceTitle(value);
  const match = normalized.match(/^(?<conference>.+?)(?:,\s*(?<pages>\d{1,4}(?:[–-]\d{1,4})?))?$/u);
  const conferenceTitle = match?.groups?.conference
    ? normalizeConferenceTitle(match.groups.conference)
    : null;
  const pages = match?.groups?.pages ? normalizePages(match.groups.pages) : null;
  if (!conferenceTitle || !looksAllCapsConferenceTailCandidate(conferenceTitle)) {
    return null;
  }
  return { conferenceTitle, pages };
}

function stripPublisherQuoteArtifacts(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    if (typeof carrier.fields.publisher.value !== 'string') {
      continue;
    }
    const normalized = normalizePublisherWithDoiHint(
      carrier.fields.publisher.value,
      typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
    );
    if (!normalized || normalized === carrier.fields.publisher.value) {
      continue;
    }
    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        normalized,
        carrier.fields.publisher.source,
        STAGE_ID,
        Math.max(0.76, carrier.fields.publisher.confidence),
        {
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value,
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }
}

function repairDecimalConferenceTitlePublisherSplits(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const title = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value.trim()
      : null;
    const publisher = typeof carrier.fields.publisher.value === 'string'
      ? carrier.fields.publisher.value.trim()
      : null;
    if (!title || !publisher) {
      continue;
    }

    const spillMatch = publisher.match(/^(?<decimal>[0-9])\s*[-–:]\s*(?<rest>.+?),\s*(?<publisher>.+)$/u);
    if (!spillMatch?.groups?.decimal || !spillMatch.groups.rest || !spillMatch.groups.publisher) {
      continue;
    }

    if (!/\b\d$/u.test(title) || looksLowQualityContainerCandidate(spillMatch.groups.publisher)) {
      continue;
    }

    const repairedTitle = normalizeTitleCandidate(
      `${title}.${spillMatch.groups.decimal} - ${spillMatch.groups.rest}`,
    );
    const repairedPublisher = normalizeConferencePublisherSlotCandidate(
      spillMatch.groups.publisher,
      repairedTitle,
      typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
    );
    if (!repairedTitle || !repairedPublisher) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'title',
      fieldOf(
        repairedTitle,
        carrier.fields.title.source,
        STAGE_ID,
        Math.max(0.8, carrier.fields.title.confidence),
        {
          origin: carrier.fields.title.origin,
          previousValue: carrier.fields.title.value,
          previousSource: carrier.fields.title.source,
          previousOrigin: carrier.fields.title.origin,
        },
      ) as ExtractedFields['title'],
    );
    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        repairedPublisher,
        carrier.fields.publisher.source,
        STAGE_ID,
        Math.max(0.8, carrier.fields.publisher.confidence),
        {
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value,
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }
}

function preferExplicitRawConferencePublishers(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined;
    const doiPublisherHint = inferPublisherFromDoiHint(doi);
    const currentPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const titleHint = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;
    const previousPublisher = typeof carrier.fields.publisher.previousValue === 'string'
      ? (
        normalizePublisherCandidate(
          stripPublisherLeadQuoteBleed(carrier.fields.publisher.previousValue),
          titleHint ?? undefined,
        )
        ?? normalizeConferenceTitle(stripPublisherLeadQuoteBleed(carrier.fields.publisher.previousValue))
      )
      : null;
    if (!currentPublisher || !doiPublisherHint) {
      continue;
    }

    const recoveredPublisher =
      previousPublisher
      ?? (
      recoverStandaloneConferencePublisherSlot(
        carrier.raw,
        titleHint,
        typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
      )
      ?? recoverLooseConferencePublisherSlot(
        carrier.raw,
        titleHint,
        typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
      )
      ?? recoverLoosePublisherYearTailFromRaw(
        carrier.raw,
        titleHint,
        typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
      )
      );
    if (
      !recoveredPublisher
      || !looksPublisherLike(recoveredPublisher)
      || looksConferencePublicationVenue(recoveredPublisher)
      || normalizeComparableText(recoveredPublisher) === normalizeComparableText(doiPublisherHint)
      || normalizeComparableText(recoveredPublisher) === normalizeComparableText(currentPublisher)
    ) {
      continue;
    }

    if (
      normalizeComparableText(currentPublisher) !== normalizeComparableText(doiPublisherHint)
      && !looksConferencePublicationVenue(currentPublisher)
      && !looksJournalLikeContainer(currentPublisher)
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        recoveredPublisher,
        carrier.fields.publisher.source,
        STAGE_ID,
        Math.max(0.82, carrier.fields.publisher.confidence),
        {
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value,
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }
}

function restoreExplicitPublisherOverridesAfterDoiHints(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined;
    const doiPublisherHint = inferPublisherFromDoiHint(doi);
    const currentPublisher = typeof carrier.fields.publisher.value === 'string'
      ? stripPublisherLeadQuoteBleed(carrier.fields.publisher.value).trim()
      : null;
    const previousPublisher = typeof carrier.fields.publisher.previousValue === 'string'
      ? carrier.fields.publisher.previousValue
      : null;
    const titleHint = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;
    if (!currentPublisher || !previousPublisher) {
      continue;
    }
    const cleanedPreviousPublisher = extractTrailingPublisherOverrideCandidate(
      stripPublisherLeadQuoteBleed(previousPublisher),
    )
      .replace(/^[\s"'“”'‘’]+/u, '')
      .replace(/[.,;:\s]+$/u, '')
      .trim();
    const recoveredPublisher =
      normalizePublisherCandidate(cleanedPreviousPublisher, titleHint ?? undefined)
      ?? cleanedPreviousPublisher;
    const comparableRecovered = normalizeComparableText(recoveredPublisher ?? '');
    const comparableCurrent = normalizeComparableText(currentPublisher);
    const comparableHint = doiPublisherHint ? normalizeComparableText(doiPublisherHint) : '';
    const titleTailTokens = normalizeComparableText(titleHint ?? '')
      .split(' ')
      .filter((token) => token.length >= 4)
      .slice(-3);
    const currentContainsTitleTail =
      titleTailTokens.length >= 2
      && titleTailTokens.every((token) => comparableCurrent.includes(token));
    const recoveredContainsTitleTail =
      titleTailTokens.length >= 2
      && titleTailTokens.every((token) => comparableRecovered.includes(token));
    const currentLooksSynthetic =
      (
        comparableHint.length > 0
        && (
          comparableCurrent === comparableHint
          || comparableCurrent.includes(comparableHint)
          || comparableHint.includes(comparableCurrent)
        )
      )
      || currentContainsTitleTail;
    if (
      !recoveredPublisher
      || comparableRecovered === comparableCurrent
      || looksConferencePublicationVenue(recoveredPublisher)
      || looksConferenceContainer(recoveredPublisher)
      || !looksPublisherLike(recoveredPublisher)
      || recoveredContainsTitleTail
      || !currentLooksSynthetic
    ) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'publisher',
      fieldOf(
        recoveredPublisher,
        carrier.fields.publisher.source,
        STAGE_ID,
        Math.max(0.84, carrier.fields.publisher.confidence),
        {
          origin: carrier.fields.publisher.origin,
          previousValue: carrier.fields.publisher.value,
          previousSource: carrier.fields.publisher.source,
          previousOrigin: carrier.fields.publisher.origin,
        },
      ) as ExtractedFields['publisher'],
    );
  }
}

function extractTrailingPublisherOverrideCandidate(value: string): string {
  const normalized = value.trim();
  const publisherTail = normalized.match(
    /(?<publisher>(?:[\p{Lu}\d][\p{L}\p{N}&.'’/-]*\s+){0,8}(?:press|publishing|publishers?|verlag|ieee|springer|thieme|elsevier|wiley|routledge|cambridge|oxford)(?:\s+[\p{Lu}\d][\p{L}\p{N}&.'’/-]*){0,6})$/iu,
  )?.groups?.publisher;
  return publisherTail?.trim() ?? normalized;
}

function enforceDoiConferenceTitleHints(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined;
    const hint = recoverConferenceTitleFromDoiHint(
      doi,
      typeof carrier.fields.year.value === 'number' ? carrier.fields.year.value : undefined,
    );
    if (!hint) {
      continue;
    }

    const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const currentTitle = typeof carrier.fields.title.value === 'string'
      ? normalizeTitleCandidate(carrier.fields.title.value)
      : null;
    const currentPublisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    if (!shouldPreferDoiConferenceTitleHint(currentConferenceTitle, hint, currentTitle, currentPublisher)) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'conferenceTitle',
      fieldOf(
        hint,
        carrier.fields.conferenceTitle.source,
        STAGE_ID,
        Math.max(0.84, carrier.fields.conferenceTitle.confidence),
        {
          origin: carrier.fields.conferenceTitle.origin,
          previousValue: carrier.fields.conferenceTitle.value,
          previousSource: carrier.fields.conferenceTitle.source,
          previousOrigin: carrier.fields.conferenceTitle.origin,
        },
      ) as ExtractedFields['conferenceTitle'],
    );
  }
}

function normalizePublisherWithDoiHint(value: string, doi: string | undefined): string {
  const cleaned = stripPublisherLeadQuoteBleed(value).replace(/^[\s"'“”'‘’]+/u, '').trim();
  const doiPublisherHint = inferPublisherFromDoiHint(doi);
  if (!doiPublisherHint) {
    return cleaned;
  }

  const normalizedCurrent = normalizeConferenceTitle(cleaned);
  const normalizedHint = normalizeConferenceTitle(doiPublisherHint);
  const comparableCurrent = normalizeComparableText(normalizedCurrent);
  const comparableHint = normalizeComparableText(normalizedHint);

  if (!normalizedCurrent) {
    return doiPublisherHint;
  }

  if (
    comparableCurrent === comparableHint
    || comparableCurrent.includes(comparableHint)
    || (comparableCurrent.length >= 8 && comparableHint.includes(comparableCurrent))
  ) {
    return doiPublisherHint;
  }

  if (
    looksCompactConferenceVenueAlias(normalizedCurrent)
    || looksLikeAuthorSpill(normalizedCurrent)
    || looksConferencePublicationVenue(normalizedCurrent)
    || looksJournalLikeContainer(normalizedCurrent)
    || /["“”]/u.test(value)
    || normalizedCurrent.split(/\s+/u).filter(Boolean).length <= 2
  ) {
    return doiPublisherHint;
  }

  return cleaned;
}

function shouldPreferDoiConferenceTitleHint(
  currentConferenceTitle: string | null,
  hint: string,
  currentTitle: string | null,
  currentPublisher: string | null,
): boolean {
  if (!currentConferenceTitle) {
    return true;
  }

  const normalizedCurrent = normalizeConferenceTitle(currentConferenceTitle);
  const normalizedHint = normalizeConferenceTitle(hint);
  const comparableCurrent = normalizeComparableText(normalizedCurrent);
  const comparableHint = normalizeComparableText(normalizedHint);

  if (comparableCurrent === comparableHint) {
    return false;
  }

  if (isConferencePlaceholder(normalizedHint)) {
    return (
      !isConferencePlaceholder(normalizedCurrent)
      || normalizeComparableText(normalizedCurrent) === normalizeComparableText(currentTitle ?? '')
      || normalizeComparableText(normalizedCurrent) === normalizeComparableText(currentPublisher ?? '')
    );
  }

  if (
    normalizeComparableText(normalizedCurrent) === normalizeComparableText(currentTitle ?? '')
    || normalizeComparableText(normalizedCurrent) === normalizeComparableText(currentPublisher ?? '')
    || looksLowQualityContainerCandidate(normalizedCurrent)
    || looksContainerInstitutionTailSpill(normalizedCurrent)
  ) {
    return true;
  }

  const hintHasExplicitCue = hasExplicitConferenceTitleCue(normalizedHint);
  const currentHasExplicitCue = hasExplicitConferenceTitleCue(normalizedCurrent);
  if (hintHasExplicitCue && !currentHasExplicitCue) {
    return true;
  }

  return comparableHint.length > comparableCurrent.length + 8 && comparableHint.includes(comparableCurrent);
}

function recoverLoosePublisherYearTailFromRaw(
  raw: string,
  titleHint?: string | null,
  conferenceTitleHint?: string | null,
): string | null {
  const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(raw));
  const match =
    parseableRaw.match(/[”"']\s*,?\s*(?<publisher>[^.;]{2,120})[,;]\s*(?:19|20)\d{2}(?:[.,]|$)/u)
    ?? parseableRaw.match(/\.\s*(?<publisher>[^.;]{2,120})[,;]\s*(?:19|20)\d{2}(?:[.,]|$)/u);
  const publisher = match?.groups?.publisher
    ? normalizeConferencePublisherSlotCandidate(
      match.groups.publisher,
      titleHint ?? null,
      conferenceTitleHint ?? null,
    )
    : null;
  return publisher && !looksConferencePublicationVenue(publisher) ? publisher : null;
}

function propagateTitlesFromSiblingsFinal(carriers: ReferenceCarrier[]): void {
  const bestTitles = new Map<string, ExtractedFields['title']>();

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key || typeof carrier.fields.title.value !== 'string') continue;
    const title = normalizeTitleCandidate(carrier.fields.title.value);
    if (!title || title.length < 8) continue;
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    if (
      conferenceTitle
      && normalizeComparableText(title).includes(normalizeComparableText(conferenceTitle))
    ) {
      continue;
    }

    const existing = bestTitles.get(key);
    if (
      !existing
      || (typeof existing.value === 'string' && title.length > existing.value.length)
      || carrier.fields.title.confidence > existing.confidence + 0.03
    ) {
      bestTitles.set(
        key,
        fieldOf(
          title,
          carrier.fields.title.source,
          STAGE_ID,
          Math.max(0.78, carrier.fields.title.confidence),
          {
            origin: carrier.fields.title.origin,
            previousValue: carrier.fields.title.value,
            previousSource: carrier.fields.title.source,
            previousOrigin: carrier.fields.title.origin,
          },
        ) as ExtractedFields['title'],
      );
    }
  }

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const best = bestTitles.get(key);
    if (!best || typeof best.value !== 'string') continue;

    const currentTitle = typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : '';
    const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const currentLooksSwallowed =
      !currentTitle
      || /^\s*[.,"“”'‘’]/u.test(currentTitle)
      || (
        currentConferenceTitle
        && normalizeComparableText(currentTitle).includes(normalizeComparableText(currentConferenceTitle))
      )
      || (
        currentConferenceTitle
        && normalizeComparableText(currentTitle).includes(
          normalizeComparableText(currentConferenceTitle.split(',')[0] ?? ''),
        )
      );

    if (!currentLooksSwallowed) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'title',
      fieldOf(
        best.value,
        best.source,
        STAGE_ID,
        Math.max(0.76, best.confidence - 0.02),
        {
          origin: best.origin,
          previousValue: carrier.fields.title.value,
          previousSource: carrier.fields.title.source,
          previousOrigin: carrier.fields.title.origin,
        },
      ) as ExtractedFields['title'],
    );
  }
}

function repairConferenceSiblingGroups(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();
  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
    } else {
      groups.set(key, [carrier]);
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const bestConferenceTitle = group
      .map((carrier) => recoverLooseDatePlaceConferenceSnippet(carrier.raw))
      .find((value): value is string => Boolean(value))
      ?? group
        .map((carrier) => {
          const parseableRaw = stripTrailingIdentifierTailForParsing(normalizeExtractionInput(carrier.raw));
          const fallbackMatch = parseableRaw.match(
            /(?<conference>[A-Z][A-Z0-9]+(?:\s+\d{4})?,\s*[^,]{2,80},\s*[A-Za-z.]{2,20},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2})/u,
          );
          return fallbackMatch?.groups?.conference
            ? normalizeConferenceTitle(fallbackMatch.groups.conference)
            : null;
        })
        .find((value): value is string => Boolean(value))
      ?? group
        .map((carrier) => typeof carrier.fields.conferenceTitle.value === 'string'
          ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
          : null)
        .find((value): value is string => Boolean(value && looksConferencePublicationVenue(value)));

    const conferenceLeadSegment = bestConferenceTitle?.split(',')[0]?.trim() ?? null;
    const bestTitle = group
      .map((carrier) => {
        const value = typeof carrier.fields.title.value === 'string'
          ? normalizeTitleCandidate(carrier.fields.title.value)
          : null;
        if (!value) {
          return null;
        }
        const normalizedValue = normalizeComparableText(value);
        const includesFullConference = Boolean(
          bestConferenceTitle && normalizedValue.includes(normalizeComparableText(bestConferenceTitle)),
        );
        const includesConferenceLead = Boolean(
          conferenceLeadSegment && normalizedValue.includes(normalizeComparableText(conferenceLeadSegment)),
        );
        const hasTemporalLocationTail = /,\s*[A-Za-z. -]{2,40},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2}/u.test(value);
        const startsWithPunctuation = /^\s*[.,"“”'‘’]/u.test(value);
        return {
          value,
          score:
            (startsWithPunctuation ? 0 : 10)
            + (includesFullConference ? 0 : 10)
            + (includesConferenceLead ? 0 : 10)
            + (hasTemporalLocationTail ? 0 : 10)
            + Math.min(value.length, 80) / 100,
        };
      })
      .filter((candidate): candidate is { value: string; score: number } => candidate != null && candidate.value.length >= 10)
      .sort((left, right) => right.score - left.score)[0]?.value;

    const bestPublisher = group
      .map((carrier) => {
        const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;
        const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
          ? carrier.fields.conferenceTitle.value
          : bestConferenceTitle ?? null;
        return (
          recoverQuotedPublisherBeforeYearFromRaw(carrier.raw, title, conferenceTitle)
          ?? recoverPublisherYearTailFromRaw(carrier.raw, title ?? '')?.publisher
          ?? (typeof carrier.fields.publisher.value === 'string'
            ? normalizeConferenceTitle(carrier.fields.publisher.value)
            : null)
        );
      })
      .find((value): value is string =>
        Boolean(
          value
          && !looksConferencePublicationVenue(value)
          && !looksLowQualityContainerCandidate(value)
          && (!bestConferenceTitle || !normalizeComparableText(value).includes(normalizeComparableText(bestConferenceTitle))),
        ));

    for (const carrier of group) {
      const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : null;
      const currentTitle = typeof carrier.fields.title.value === 'string'
        ? carrier.fields.title.value
        : null;
      const currentPublisher = typeof carrier.fields.publisher.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.publisher.value)
        : null;
      const normalizedCurrentTitle = currentTitle ? normalizeComparableText(currentTitle) : '';
  const conferenceLeadSegment = bestConferenceTitle?.split(',')[0]?.trim() ?? null;
  const currentTitleLooksSwallowed =
        currentTitle != null
        && (
          /^\s*[.,"“”'‘’]/u.test(currentTitle)
          || (bestConferenceTitle
            && normalizedCurrentTitle.includes(normalizeComparableText(bestConferenceTitle)))
          || (conferenceLeadSegment
            && normalizedCurrentTitle.includes(normalizeComparableText(conferenceLeadSegment)))
          || (bestConferenceTitle
            && currentTitle != null
            && /,\s*[A-Za-z. -]{2,40},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2}/u.test(currentTitle)
            && normalizedCurrentTitle.includes(normalizeComparableText(conferenceLeadSegment ?? bestConferenceTitle)))
        );

      if (
        bestConferenceTitle
        && (
          !currentConferenceTitle
          || currentConferenceTitle.length <= 3
          || looksLowQualityContainerCandidate(currentConferenceTitle)
        )
      ) {
        setExtractedField(
          carrier.fields,
          'conferenceTitle',
          fieldOf(
            bestConferenceTitle,
            carrier.fields.conferenceTitle.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.conferenceTitle.confidence),
            {
              origin: carrier.fields.conferenceTitle.origin,
              previousValue: carrier.fields.conferenceTitle.value,
              previousSource: carrier.fields.conferenceTitle.source,
              previousOrigin: carrier.fields.conferenceTitle.origin,
            },
          ) as ExtractedFields['conferenceTitle'],
        );
      }

      if (bestTitle && currentTitleLooksSwallowed) {
        setExtractedField(
          carrier.fields,
          'title',
          fieldOf(
            bestTitle,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.title.confidence),
            {
              origin: carrier.fields.title.origin,
              previousValue: carrier.fields.title.value,
              previousSource: carrier.fields.title.source,
              previousOrigin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['title'],
        );
      }

      if (
        bestPublisher
        && (
          !currentPublisher
          || (
            bestConferenceTitle
            && normalizeComparableText(currentPublisher).includes(normalizeComparableText(bestConferenceTitle))
          )
          || (
            currentTitle
            && normalizeComparableText(currentPublisher).includes(normalizeComparableText(currentTitle))
          )
        )
      ) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            bestPublisher.replace(/^[\s"'“”'‘’.,;:]+/u, ''),
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.78, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value,
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
    }
  }
}

function restoreFinalConferenceAndPublisherRepairs(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    const raw = normalizeExtractionInput(carrier.raw);
    const rawSupport = buildRawCitationSupportFromNormalizedRaw(raw);
    const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null;
    const journal = typeof carrier.fields.journal.value === 'string'
      ? normalizeJournalCandidate(carrier.fields.journal.value, title)
      : null;
    const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    const publisher = typeof carrier.fields.publisher.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.publisher.value)
      : null;
    const institution = typeof carrier.fields.institution.value === 'string'
      ? (
        normalizeInstitutionCandidate(carrier.fields.institution.value)
        ?? stripTrailingPunctuation(carrier.fields.institution.value).trim()
      )
      : null;
    const bookTitle = typeof carrier.fields.bookTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.bookTitle.value)
      : null;
    const previousConferenceTitle = typeof (carrier.fields.conferenceTitle as { previousValue?: unknown }).previousValue === 'string'
      ? normalizeConferenceTitle(String((carrier.fields.conferenceTitle as { previousValue?: unknown }).previousValue))
      : null;
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined;
    const hasBookishIdentifier =
      hasFieldValue(carrier.fields.isbn)
      || looksBookChapterDoi(doi)
      || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? '');
    const hasLocators =
      hasFieldValue(carrier.fields.volume)
      || hasFieldValue(carrier.fields.issue)
      || hasFieldValue(carrier.fields.pages);
    const reportLikeDoi = looksReportLikeDoi(doi, {
      raw,
      owner: institution ?? publisher ?? conferenceTitle ?? undefined,
    });

    if (publisher && bookTitle) {
      const publisherWithoutBookTitle = stripTrailingPunctuation(
        publisher.replace(new RegExp(`^${escapeRegex(bookTitle)}\\s*,\\s*`, 'iu'), ''),
      ).trim();
      if (publisherWithoutBookTitle && publisherWithoutBookTitle.length < publisher.length) {
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            publisherWithoutBookTitle,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
    }

    if (!conferenceTitle && journal) {
      const recoveredUppercaseConference = recoverUppercaseConferenceContainerFromJournal(journal);
      if (recoveredUppercaseConference) {
        setExtractedField(
          carrier.fields,
          'conferenceTitle',
          fieldOf(
            recoveredUppercaseConference.conferenceTitle,
            carrier.fields.conferenceTitle.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.journal.confidence),
            {
              origin: carrier.fields.conferenceTitle.origin,
              previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
              previousSource: carrier.fields.conferenceTitle.source,
              previousOrigin: carrier.fields.conferenceTitle.origin,
            },
          ) as ExtractedFields['conferenceTitle'],
        );
        setExtractedField(
          carrier.fields,
          'journal',
          fieldOf(
            null,
            carrier.fields.journal.source,
            STAGE_ID,
            0,
            {
              uncertain: true,
              origin: carrier.fields.journal.origin,
              previousValue: carrier.fields.journal.value as ExtractedFields['journal']['value'],
              previousSource: carrier.fields.journal.source,
              previousOrigin: carrier.fields.journal.origin,
            },
          ) as ExtractedFields['journal'],
        );
        if (!hasFieldValue(carrier.fields.pages) && recoveredUppercaseConference.pages) {
          setExtractedField(
            carrier.fields,
            'pages',
            fieldOf(
              recoveredUppercaseConference.pages,
              carrier.fields.pages.source,
              STAGE_ID,
              Math.max(0.76, carrier.fields.pages.confidence),
              {
                origin: carrier.fields.pages.origin,
                previousValue: carrier.fields.pages.value as ExtractedFields['pages']['value'],
                previousSource: carrier.fields.pages.source,
                previousOrigin: carrier.fields.pages.origin,
              },
            ) as ExtractedFields['pages'],
          );
        }
      }
    }

    if (
      !hasFieldValue(carrier.fields.conferenceTitle)
      && previousConferenceTitle
      && (
        CONFERENCE_CUE_REGEX.test(previousConferenceTitle)
        || CONFERENCE_DOI_REGEX.test(raw)
        || looksProceedingsLikeDoi(doi)
        || shouldPreserveConferenceTemporalTail(previousConferenceTitle)
        || looksAllCapsConferenceTailCandidate(previousConferenceTitle)
      )
    ) {
      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          previousConferenceTitle,
          carrier.fields.conferenceTitle.source,
          STAGE_ID,
          Math.max(0.8, carrier.fields.conferenceTitle.confidence),
          {
            origin: carrier.fields.conferenceTitle.origin,
            previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
            previousSource: carrier.fields.conferenceTitle.source,
            previousOrigin: carrier.fields.conferenceTitle.origin,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
      if (publisher) {
        const spillPrefix = stripTrailingPunctuation(
          publisher.replace(new RegExp(`(?:^|\\.\\s*)${escapeRegex(previousConferenceTitle)}$`, 'iu'), ''),
        ).trim();
        const normalizedSpillPrefix = normalizeTitleCandidate(spillPrefix);
        if (
          normalizedSpillPrefix
          && title
          && !looksPublisherLike(normalizedSpillPrefix)
          && !looksInstitutionalContainer(normalizedSpillPrefix)
          && !normalizeComparableText(title).includes(normalizeComparableText(normalizedSpillPrefix))
        ) {
          setExtractedField(
            carrier.fields,
            'title',
            fieldOf(
              `${stripTrailingPunctuation(title)}, ${normalizedSpillPrefix}`,
              carrier.fields.title.source,
              STAGE_ID,
              Math.max(0.8, carrier.fields.title.confidence),
              {
                origin: carrier.fields.title.origin,
                previousValue: carrier.fields.title.value as ExtractedFields['title']['value'],
                previousSource: carrier.fields.title.source,
                previousOrigin: carrier.fields.title.origin,
              },
            ) as ExtractedFields['title'],
          );
        }
        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            null,
            carrier.fields.publisher.source,
            STAGE_ID,
            0,
            {
              uncertain: true,
              origin: carrier.fields.publisher.origin,
              previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
              previousSource: carrier.fields.publisher.source,
              previousOrigin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
    }

    if (!conferenceTitle && !journal && !hasLocators && !hasBookishIdentifier) {
      const recoveredConferenceTitleFromSnippet = recoverLooseDatePlaceConferenceSnippet(
        raw,
        rawSupport,
      );
      const recoveredConferenceTitle =
        recoveredConferenceTitleFromSnippet
        ?? (title
          ? recoverInstitutionalConferenceTailBeforeYearFromRaw(raw, title, rawSupport)
          : null);
      if (
        recoveredConferenceTitle
        && (
          (
            Boolean(recoveredConferenceTitleFromSnippet)
            || looksConferencePublicationVenue(recoveredConferenceTitle)
            || shouldPreserveConferenceTemporalTail(recoveredConferenceTitle)
            || looksConferencePublisherOrganization(recoveredConferenceTitle)
            || looksAllCapsConferenceTailCandidate(recoveredConferenceTitle)
            || /,\s*[A-Z]{2},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2}$/u.test(recoveredConferenceTitle)
          )
          && (
            !reportLikeDoi
            || Boolean(recoveredConferenceTitleFromSnippet)
            || shouldPreserveConferenceTemporalTail(recoveredConferenceTitle)
            || /,\s*[A-Z]{2},\s*[A-Za-z]{3,9}\s+\d{1,2},\s*(?:19|20)\d{2}$/u.test(recoveredConferenceTitle)
          )
        )
      ) {
        setExtractedField(
          carrier.fields,
          'conferenceTitle',
          fieldOf(
            recoveredConferenceTitle,
            carrier.fields.conferenceTitle.source,
            STAGE_ID,
            Math.max(0.8, carrier.fields.conferenceTitle.confidence),
            {
              origin: carrier.fields.conferenceTitle.origin,
              previousValue: carrier.fields.conferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
              previousSource: carrier.fields.conferenceTitle.source,
              previousOrigin: carrier.fields.conferenceTitle.origin,
            },
          ) as ExtractedFields['conferenceTitle'],
        );
      }
    }

    const refreshedConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : null;
    if (
      !hasFieldValue(carrier.fields.publisher)
      && institution
      && !journal
      && !hasLocators
      && !hasBookishIdentifier
      && hasQuotedOwnerSlot(raw, institution, rawSupport)
      && (
        !refreshedConferenceTitle
        || normalizeComparableText(refreshedConferenceTitle) !== normalizeComparableText(institution)
      )
    ) {
      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          institution,
          carrier.fields.publisher.source,
          STAGE_ID,
          Math.max(0.78, carrier.fields.institution.confidence),
          {
            origin: carrier.fields.publisher.origin,
            previousValue: carrier.fields.publisher.value as ExtractedFields['publisher']['value'],
            previousSource: carrier.fields.publisher.source,
            previousOrigin: carrier.fields.publisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }
  }
}

function backfillConferenceTitlesFromSiblings(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
      continue;
    }
    groups.set(key, [carrier]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const groupHasConferenceEvidence = group.some((carrier) => {
      const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      const journal = typeof carrier.fields.journal.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.journal.value)
        : '';
      const institution = typeof carrier.fields.institution.value === 'string'
        ? normalizeConferenceTitle(
          carrier.fields.institution.value.replace(/^Paper presented at\s+/iu, '').trim(),
        )
        : '';
      return (
        CONFERENCE_DOI_REGEX.test(carrier.raw)
        || CONFERENCE_CUE_REGEX.test(carrier.raw)
        || /\bpaper presented at\b/iu.test(carrier.raw)
        || looksConferenceContainer(conferenceTitle)
        || looksConferencePublicationVenue(conferenceTitle)
        || CONFERENCE_KEYWORD_REGEX.test(journal)
        || shouldPreserveConferenceTemporalTail(journal)
        || CONFERENCE_KEYWORD_REGEX.test(institution)
        || shouldPreserveConferenceTemporalTail(institution)
        || isConferenceFallbackContainerCandidate(journal, {
          rawHasConferenceDoi: CONFERENCE_DOI_REGEX.test(carrier.raw),
          rawHasConferenceCue: /\bpaper presented at\b/iu.test(carrier.raw) || CONFERENCE_CUE_REGEX.test(carrier.raw),
        })
        || isConferenceFallbackContainerCandidate(institution, {
          rawHasConferenceDoi: CONFERENCE_DOI_REGEX.test(carrier.raw),
          rawHasConferenceCue: /\bpaper presented at\b/iu.test(carrier.raw) || CONFERENCE_CUE_REGEX.test(carrier.raw),
        })
        || Boolean(
          recoverCompactConferenceAliasFromDoi(
            typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
            carrier.raw,
          ),
        )
      );
    });
    if (!groupHasConferenceEvidence) continue;

    const candidates = buildConferencePropagationCandidates(group, groupHasConferenceEvidence)
      .filter((candidate) => hasFieldValue(candidate))
      .sort((left, right) => propagationScore('conferenceTitle', right.value, right.confidence) - propagationScore('conferenceTitle', left.value, left.confidence));
    const best = candidates[0];
    if (!best) continue;

    for (const carrier of group) {
      const current = carrier.fields.conferenceTitle;
      const bestText = typeof best.value === 'string'
        ? normalizeConferenceTitle(best.value)
        : '';
      const currentText = typeof current.value === 'string'
        ? normalizeConferenceTitle(current.value)
        : '';
      const bestHasExplicitConferenceCue = hasExplicitConferenceTitleCue(bestText);
      const currentHasExplicitConferenceCue = hasExplicitConferenceTitleCue(currentText);
      const currentLooksJournalProxy =
        currentText.length > 0
        && !currentHasExplicitConferenceCue
        && (
          looksJournalLikeContainer(currentText)
          || looksCompactConferenceVenueAlias(currentText)
          || looksPublisherLike(currentText)
        )
        && !looksInstitutionalContainer(currentText);
      const currentLooksInferiorToBest =
        currentText.length > 0
        && bestText.length > 0
        && currentText !== bestText
        && !currentHasExplicitConferenceCue
        && bestHasExplicitConferenceCue
        && (
          looksCompactConferenceVenueAlias(currentText)
          || looksJournalLikeContainer(currentText)
          || looksPublisherLike(currentText)
          || bestText.length >= currentText.length + 8
        );
      if (
        !shouldAdoptPropagationValue('conferenceTitle', current.value, carrier)
        && !currentLooksJournalProxy
        && !currentLooksInferiorToBest
      ) {
        continue;
      }
      if (
        currentText.length > 0
        && currentText !== bestText
        && !hasFieldValue(carrier.fields.publisher)
        && (
          looksCompactConferenceVenueAlias(currentText)
          || looksJournalLikeContainer(currentText)
          || looksPublisherLike(currentText)
          || looksConferencePublisherOrganization(currentText)
          || (
            looksInstitutionalContainer(currentText)
            && (
              typeof carrier.fields.institution.value !== 'string'
              || normalizeComparableText(carrier.fields.institution.value) !== normalizeComparableText(currentText)
            )
          )
          || (
            currentLooksInferiorToBest
            && !looksConferencePublicationVenue(currentText)
            && !looksConferenceContainer(currentText)
            && !looksLowQualityContainerCandidate(currentText)
          )
        )
      ) {
        const preservedPublisher = normalizePropagationPublisherProxy(
          typeof current.value === 'string' ? current.value : currentText,
          carrier.raw,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        ) ?? normalizeConferencePublisherSlotCandidate(
          typeof current.value === 'string' ? current.value : currentText,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
          bestText,
        );
        if (preservedPublisher) {
          setExtractedField(
            carrier.fields,
            'publisher',
            fieldOf(
              preservedPublisher,
              current.source,
              STAGE_ID,
              Math.max(0.72, current.confidence - 0.04),
              {
                origin: current.origin,
              },
            ) as ExtractedFields['publisher'],
          );
        }
      }
      setExtractedField(
        carrier.fields,
        'conferenceTitle',
        fieldOf(
          best.value,
          best.source,
          STAGE_ID,
          Math.max(0.76, best.confidence - 0.02),
          {
            origin: best.origin,
            previousValue: current.value,
            previousSource: current.source,
            previousOrigin: current.origin,
          },
          ) as ExtractedFields['conferenceTitle'],
      );

      if (!hasFieldValue(carrier.fields.publisher)) {
        const rawRecoveredPublisher = recoverExplicitConferencePublisherFromRaw(
          carrier.raw,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
          bestText,
          typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
        ) ?? normalizeConferencePublisherSlotCandidate(
          typeof carrier.fields.journal.value === 'string' ? carrier.fields.journal.value : null,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
          bestText,
        ) ?? normalizeConferencePublisherSlotCandidate(
          typeof carrier.fields.institution.value === 'string'
            ? carrier.fields.institution.value.replace(/^Paper presented at\s+/iu, '').trim()
            : null,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
          bestText,
        );
        if (
          rawRecoveredPublisher
          && normalizeComparableText(rawRecoveredPublisher) !== normalizeComparableText(bestText)
        ) {
          setExtractedField(
            carrier.fields,
            'publisher',
            fieldOf(
              rawRecoveredPublisher,
              current.source,
              STAGE_ID,
              Math.max(0.72, current.confidence - 0.06),
              {
                origin: current.origin,
              },
            ) as ExtractedFields['publisher'],
          );
        }
      }
    }
  }
}

function backfillConferencePublishersFromSiblings(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
      continue;
    }
    groups.set(key, [carrier]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const groupHasConferenceEvidence = group.some((carrier) => {
      const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      const journal = typeof carrier.fields.journal.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.journal.value)
        : '';
      const institution = typeof carrier.fields.institution.value === 'string'
        ? normalizeConferenceTitle(
          carrier.fields.institution.value.replace(/^Paper presented at\s+/iu, '').trim(),
        )
        : '';
      return (
        CONFERENCE_DOI_REGEX.test(carrier.raw)
        || CONFERENCE_CUE_REGEX.test(carrier.raw)
        || /\bpaper presented at\b/iu.test(carrier.raw)
        || hasExplicitConferenceTitleCue(conferenceTitle)
        || looksConferenceContainer(conferenceTitle)
        || looksConferencePublicationVenue(conferenceTitle)
        || CONFERENCE_KEYWORD_REGEX.test(journal)
        || shouldPreserveConferenceTemporalTail(journal)
        || CONFERENCE_KEYWORD_REGEX.test(institution)
        || shouldPreserveConferenceTemporalTail(institution)
        || isConferenceFallbackContainerCandidate(journal, {
          rawHasConferenceDoi: CONFERENCE_DOI_REGEX.test(carrier.raw),
          rawHasConferenceCue: /\bpaper presented at\b/iu.test(carrier.raw) || CONFERENCE_CUE_REGEX.test(carrier.raw),
        })
        || isConferenceFallbackContainerCandidate(institution, {
          rawHasConferenceDoi: CONFERENCE_DOI_REGEX.test(carrier.raw),
          rawHasConferenceCue: /\bpaper presented at\b/iu.test(carrier.raw) || CONFERENCE_CUE_REGEX.test(carrier.raw),
        })
        || Boolean(
          recoverCompactConferenceAliasFromDoi(
            typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
            carrier.raw,
          ),
        )
      );
    });
    if (!groupHasConferenceEvidence) continue;

    const candidates: Array<ExtractedFields['publisher']> = [];
    for (const carrier of group) {
      for (const sourceField of ['publisher', 'conferenceTitle', 'journal'] as const) {
        const field = carrier.fields[sourceField];
        if (!hasFieldValue(field) || typeof field.value !== 'string') {
          continue;
        }

        const normalizedText = normalizePropagationPublisherProxy(
          field.value,
          carrier.raw,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        );
        if (!normalizedText || !isConferencePublisherCandidate(normalizedText)) {
          continue;
        }

        candidates.push(
          fieldOf(
            normalizedText,
            field.source,
            STAGE_ID,
            sourceField === 'publisher' ? Math.max(0.76, field.confidence) : Math.max(0.72, field.confidence - 0.04),
            {
              origin: field.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }

      const directPublisherText = typeof carrier.fields.publisher.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.publisher.value)
        : null;
      if (
        directPublisherText
        && isConferencePublisherCandidate(directPublisherText)
      ) {
        candidates.push(
          fieldOf(
            directPublisherText,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.76, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }

      const previousPublisherValue =
        typeof (carrier.fields.publisher as { previousValue?: unknown }).previousValue === 'string'
          ? String((carrier.fields.publisher as { previousValue?: unknown }).previousValue)
          : null;
      const normalizedPreviousPublisher = previousPublisherValue
        ? normalizeConferencePublisherSlotCandidate(
          previousPublisherValue,
          typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
          typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
        )
        : null;
      if (normalizedPreviousPublisher) {
        candidates.push(
          fieldOf(
            normalizedPreviousPublisher,
            carrier.fields.publisher.source,
            STAGE_ID,
            Math.max(0.74, carrier.fields.publisher.confidence),
            {
              origin: carrier.fields.publisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }

      const tailPublisher = recoverConferencePublisherFromTitleTail(
        carrier.raw,
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
      );
      const standaloneTailPublisher = recoverStandaloneConferencePublisherSlot(
        carrier.raw,
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
      );
      const looseStandaloneTailPublisher = recoverLooseConferencePublisherSlot(
        carrier.raw,
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
        typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
      );
      const extractedTailPublisher = typeof carrier.fields.title.value === 'string'
        ? (() => {
          const extractedTail = extractTailAfterTitle(carrier.raw, carrier.fields.title.value);
          const candidate = extractedTail
            ? extractedTail
              .replace(/^[\s"'“”'‘’.,;:]+/u, '')
              .replace(/\s*(?:Available at|Retrieved from|doi:|https?:\/\/).+$/iu, '')
              .replace(/\s*[;,]\s*(?:19|20)\d{2}(?:\b|[.,]).*$/iu, '')
              .replace(/[.,;:\s]+$/u, '')
              .trim()
            : '';
          return normalizeConferencePublisherSlotCandidate(
            candidate,
            carrier.fields.title.value,
            typeof carrier.fields.conferenceTitle.value === 'string' ? carrier.fields.conferenceTitle.value : null,
          );
        })()
        : null;
      const currentInstitution = typeof carrier.fields.institution.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.institution.value)
        : null;
      const recoveredTailPublisher =
        extractedTailPublisher
        ?? tailPublisher
        ?? standaloneTailPublisher
        ?? looseStandaloneTailPublisher;
      if (
        recoveredTailPublisher
        && !looksLowQualityContainerCandidate(recoveredTailPublisher)
        && !looksLocatorHeavyContainerSpill(recoveredTailPublisher)
        && !hasExplicitConferenceTitleCue(recoveredTailPublisher)
        && !looksConferencePublicationVenue(recoveredTailPublisher)
        && (
          looksPublisherLike(recoveredTailPublisher)
          || looksConferencePublisherOrganization(recoveredTailPublisher)
          || looksInstitutionalContainer(recoveredTailPublisher)
          || looksStandaloneInstitutionalAlias(recoveredTailPublisher)
        )
        && (
          !currentInstitution
          || normalizeComparableText(currentInstitution) !== normalizeComparableText(recoveredTailPublisher)
        )
      ) {
        candidates.push(
          fieldOf(
            recoveredTailPublisher,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.72, carrier.fields.title.confidence - 0.06),
            {
              origin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }

      const rawAlias = recoverCompactConferenceAliasFromRaw(
        carrier.raw,
        typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : null,
      );
      if (rawAlias && looksStandaloneInstitutionalAlias(rawAlias)) {
        candidates.push(
          fieldOf(
            rawAlias,
            carrier.fields.title.source,
            STAGE_ID,
            Math.max(0.7, carrier.fields.title.confidence - 0.1),
            {
              origin: carrier.fields.title.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
    }

    if (candidates.length === 0) {
      const directPublisherCandidates = group
        .map((carrier) => carrier.fields.publisher)
        .filter((field) => hasFieldValue(field) && typeof field.value === 'string')
        .filter((field) => isConferencePublisherCandidate(normalizeConferenceTitle(String(field.value))))
        .sort((left, right) => conferencePublisherPropagationScore(right.value, right.confidence) - conferencePublisherPropagationScore(left.value, left.confidence));
      const bestDirectPublisher = directPublisherCandidates[0];
      if (!bestDirectPublisher || typeof bestDirectPublisher.value !== 'string') {
        continue;
      }

      for (const carrier of group) {
        const currentPublisher = carrier.fields.publisher;
        const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
          ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
          : '';
        if (
          hasFieldValue(currentPublisher)
          && !isLowQualityPropagationValue('publisher', currentPublisher.value)
        ) {
          continue;
        }
        if (!currentConferenceTitle) {
          continue;
        }

        setExtractedField(
          carrier.fields,
          'publisher',
          fieldOf(
            bestDirectPublisher.value,
            bestDirectPublisher.source,
            STAGE_ID,
            Math.max(0.74, bestDirectPublisher.confidence - 0.02),
            {
              origin: bestDirectPublisher.origin,
              previousValue: currentPublisher.value,
              previousSource: currentPublisher.source,
              previousOrigin: currentPublisher.origin,
            },
          ) as ExtractedFields['publisher'],
        );
      }
      continue;
    }

    candidates.sort(
      (left, right) =>
        conferencePublisherPropagationScore(right.value, right.confidence)
        - conferencePublisherPropagationScore(left.value, left.confidence),
    );
    const best = candidates[0];
    if (!best || typeof best.value !== 'string') {
      continue;
    }

    for (const carrier of group) {
      const currentPublisher = carrier.fields.publisher;
      const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      if (
        hasFieldValue(currentPublisher)
        && !isLowQualityPropagationValue('publisher', currentPublisher.value)
      ) {
        continue;
      }
      if (
        currentConferenceTitle
        && normalizeComparableText(currentConferenceTitle) === normalizeComparableText(best.value)
      ) {
        continue;
      }

      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          best.value,
          best.source,
          STAGE_ID,
          Math.max(0.74, best.confidence - 0.02),
          {
            origin: best.origin,
            previousValue: currentPublisher.value,
            previousSource: currentPublisher.source,
            previousOrigin: currentPublisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }

    const bestExistingPublisher = group
      .map((carrier) => carrier.fields.publisher)
      .filter((field) => hasFieldValue(field) && typeof field.value === 'string')
      .sort((left, right) => conferencePublisherPropagationScore(right.value, right.confidence) - conferencePublisherPropagationScore(left.value, left.confidence))[0];
    if (!bestExistingPublisher || typeof bestExistingPublisher.value !== 'string') {
      continue;
    }

    for (const carrier of group) {
      const currentPublisher = carrier.fields.publisher;
      const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      if (
        hasFieldValue(currentPublisher)
        && !isLowQualityPropagationValue('publisher', currentPublisher.value)
      ) {
        continue;
      }
      if (!currentConferenceTitle) {
        continue;
      }

      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          bestExistingPublisher.value,
          bestExistingPublisher.source,
          STAGE_ID,
          Math.max(0.74, bestExistingPublisher.confidence - 0.02),
          {
            origin: bestExistingPublisher.origin,
            previousValue: currentPublisher.value,
            previousSource: currentPublisher.source,
            previousOrigin: currentPublisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }
  }
}

function propagateExistingConferencePublishersFromSiblings(carriers: ReferenceCarrier[]): void {
  const groups = new Map<string, ReferenceCarrier[]>();

  for (const carrier of carriers) {
    if (carrier.doiFastPath) continue;
    const key = getPropagationGroupKey(carrier);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(carrier);
      continue;
    }
    groups.set(key, [carrier]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const bestPublisher = group
      .map((carrier) => carrier.fields.publisher)
      .filter((field) => hasFieldValue(field) && typeof field.value === 'string')
      .filter((field) => {
        const text = normalizeConferenceTitle(String(field.value));
        return (
          text.length > 0
          && !looksLikeAuthorSpill(text)
        );
      })
      .sort((left, right) => conferencePublisherPropagationScore(right.value, right.confidence) - conferencePublisherPropagationScore(left.value, left.confidence))[0];
    if (!bestPublisher || typeof bestPublisher.value !== 'string') {
      continue;
    }

    const groupHasConferenceContainer = group.some((carrier) =>
      typeof carrier.fields.conferenceTitle.value === 'string'
      && normalizeConferenceTitle(carrier.fields.conferenceTitle.value).length > 0,
    );
    if (!groupHasConferenceContainer) {
      continue;
    }

    for (const carrier of group) {
      const currentPublisher = carrier.fields.publisher;
      const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
        ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
        : '';
      if (!currentConferenceTitle) {
        continue;
      }
      if (
        hasFieldValue(currentPublisher)
        && !isLowQualityPropagationValue('publisher', currentPublisher.value)
      ) {
        continue;
      }

      setExtractedField(
        carrier.fields,
        'publisher',
        fieldOf(
          bestPublisher.value,
          bestPublisher.source,
          STAGE_ID,
          Math.max(0.74, bestPublisher.confidence - 0.02),
          {
            origin: bestPublisher.origin,
            previousValue: currentPublisher.value,
            previousSource: currentPublisher.source,
            previousOrigin: currentPublisher.origin,
          },
        ) as ExtractedFields['publisher'],
      );
    }
  }
}

function buildConferencePropagationCandidates(
  carriers: ReferenceCarrier[],
  groupHasConferenceEvidence: boolean,
): ExtractedFields['conferenceTitle'][] {
  const candidates: ExtractedFields['conferenceTitle'][] = [];
  const explicitConferenceTitles = new Set<string>();

    for (const carrier of carriers) {
      const rawHasConferenceDoi =
        CONFERENCE_DOI_REGEX.test(carrier.raw)
        || looksProceedingsLikeDoi(typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined);
    const rawHasConferenceCue =
      /\bpaper presented at\b/iu.test(carrier.raw)
      || CONFERENCE_CUE_REGEX.test(carrier.raw);
    const currentConferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.conferenceTitle.value)
      : '';
    const currentJournal = typeof carrier.fields.journal.value === 'string'
      ? normalizeConferenceTitle(carrier.fields.journal.value)
      : '';

    if (
      currentConferenceTitle.length > 0
      && (
        looksConferencePublicationVenue(currentConferenceTitle)
        || (
          (rawHasConferenceDoi || rawHasConferenceCue)
          && !looksInstitutionalContainer(currentConferenceTitle)
          && !looksLowQualityContainerCandidate(currentConferenceTitle)
        )
      )
    ) {
      explicitConferenceTitles.add(currentConferenceTitle);
    }

    if (
      (rawHasConferenceDoi || rawHasConferenceCue)
      && currentJournal.length > 0
      && (looksConferencePublicationVenue(currentJournal) || looksJournalLikeContainer(currentJournal))
      && !looksInstitutionalContainer(currentJournal)
    ) {
      explicitConferenceTitles.add(currentJournal);
    }
  }

  for (const carrier of carriers) {
    const rawHasConferenceDoi =
      CONFERENCE_DOI_REGEX.test(carrier.raw)
      || looksProceedingsLikeDoi(typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined);
    const rawHasConferenceCue =
      /\bpaper presented at\b/iu.test(carrier.raw)
      || CONFERENCE_CUE_REGEX.test(carrier.raw);
    const conferenceEvidence = {
      rawHasConferenceDoi: rawHasConferenceDoi || groupHasConferenceEvidence,
      rawHasConferenceCue: rawHasConferenceCue || groupHasConferenceEvidence,
    };
      const currentConferenceTitle = carrier.fields.conferenceTitle;
      const currentInstitution = carrier.fields.institution;
      if (hasFieldValue(currentConferenceTitle)) {
        const text = typeof currentConferenceTitle.value === 'string'
          ? normalizeConferenceTitle(currentConferenceTitle.value)
          : '';
      const explicitCarrierConferenceTitle =
        text.length > 0
        && (rawHasConferenceDoi || rawHasConferenceCue)
        && !looksInstitutionalContainer(text)
        && !looksLowQualityContainerCandidate(text);
      if (
        text
        && (
          !isLowQualityPropagationValue('conferenceTitle', text)
          || looksConferenceVenueAlias(text)
          || looksCompactConferenceVenueAlias(text)
          || explicitCarrierConferenceTitle
          || (
            groupHasConferenceEvidence
            && looksJournalLikeContainer(text)
            && !looksInstitutionalContainer(text)
          )
        )
      ) {
          candidates.push(currentConferenceTitle as ExtractedFields['conferenceTitle']);
        }
      }

      if (hasFieldValue(currentInstitution) && typeof currentInstitution.value === 'string') {
        const normalizedInstitution = normalizeConferenceTitle(
          currentInstitution.value.replace(/^Paper presented at\s+/iu, '').trim(),
        );
        if (
          normalizedInstitution
          && !looksLowQualityContainerCandidate(normalizedInstitution)
          && !looksPublisherLike(normalizedInstitution)
          && isConferenceFallbackContainerCandidate(normalizedInstitution, conferenceEvidence)
        ) {
          candidates.push(
            fieldOf(
              normalizedInstitution,
              currentInstitution.source,
              STAGE_ID,
              Math.max(0.74, currentInstitution.confidence - 0.04),
              {
                origin: currentInstitution.origin,
              },
            ) as ExtractedFields['conferenceTitle'],
          );
        }
      }

      const doiAlias = recoverCompactConferenceAliasFromDoi(
        typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : undefined,
        carrier.raw,
    );
    if (doiAlias) {
      candidates.push(
        fieldOf(
          doiAlias,
          carrier.fields.doi.source,
          STAGE_ID,
          Math.max(0.78, carrier.fields.doi.confidence - 0.08),
          {
            origin: carrier.fields.doi.origin,
            previousValue: currentConferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
            previousSource: currentConferenceTitle.source,
            previousOrigin: currentConferenceTitle.origin,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
    }

    for (const fallbackField of ['journal'] as const) {
      const fallback = carrier.fields[fallbackField];
      if (!hasFieldValue(fallback) || typeof fallback.value !== 'string') {
        continue;
      }

      const normalizedFallback = normalizeConferenceTitle(fallback.value);
      if (
        !normalizedFallback
        || looksLowQualityContainerCandidate(normalizedFallback)
        || looksLocatorHeavyContainerSpill(normalizedFallback)
        || looksLikeAuthorSpill(normalizedFallback)
        || looksPublisherLike(normalizedFallback)
      ) {
        continue;
      }

      const allowSiblingJournalVenue =
        fallbackField === 'journal'
        && !looksInstitutionalContainer(normalizedFallback)
        && groupHasConferenceEvidence
        && explicitConferenceTitles.has(normalizedFallback);

      if (!allowSiblingJournalVenue && !isConferenceFallbackContainerCandidate(normalizedFallback, conferenceEvidence)) {
        continue;
      }

      candidates.push(
        fieldOf(
          normalizedFallback,
          fallback.source,
          STAGE_ID,
          Math.max(0.76, fallback.confidence - 0.04),
          {
            origin: fallback.origin,
            previousValue: currentConferenceTitle.value as ExtractedFields['conferenceTitle']['value'],
            previousSource: currentConferenceTitle.source,
            previousOrigin: currentConferenceTitle.origin,
          },
        ) as ExtractedFields['conferenceTitle'],
      );
    }
  }

  return candidates;
}

function shouldAdoptPropagationValue(
  field: (typeof PROPAGATABLE_FIELDS)[number],
  currentValue: ExtractedFields[typeof field]['value'],
  carrier: ReferenceCarrier,
): boolean {
  if (field === 'authors') {
    const currentAuthors = Array.isArray(currentValue) ? currentValue : [];
    const hasEtAlCue = /\bet al\.?\b/iu.test(carrier.raw);
    const hasGroupedAuthor = currentAuthors.some((author) =>
      /,/.test(author.family ?? author.literal ?? ''),
    );
    return (
      !hasFieldValue(carrier.fields.authors)
      || carrier.healthEvidence.invalidSpanFields.includes('authors')
      || isLowQualityPropagationValue(field, currentValue)
      || hasGroupedAuthor
      || (hasEtAlCue && currentAuthors.length < 2)
    );
  }

  return !hasFieldValue(carrier.fields[field]) || isLowQualityPropagationValue(field, currentValue);
}

function backfillIncompleteIdentifierAuthors(group: ReferenceCarrier[]): void {
  const candidates = group
    .map((carrier) => carrier.fields.authors)
    .filter((candidate) => Array.isArray(candidate.value) && candidate.value.length >= 2)
    .filter((candidate) => !isLowQualityPropagationValue('authors', candidate.value))
    .sort((left, right) => propagationScore('authors', right.value, right.confidence) - propagationScore('authors', left.value, left.confidence));

  const best = candidates[0];
  if (!best || !Array.isArray(best.value) || best.value.length < 2) {
    return;
  }

  for (const carrier of group) {
    const currentAuthors = carrier.fields.authors.value;
    if (!needsIdentifierAuthorBackfill(carrier.raw, currentAuthors, best.value.length)) {
      continue;
    }

    setExtractedField(
      carrier.fields,
      'authors',
      fieldOf(
        best.value,
        best.source,
        STAGE_ID,
        Math.max(0.74, best.confidence - 0.02),
        {
          origin: best.origin,
          previousValue: carrier.fields.authors.value,
          previousSource: carrier.fields.authors.source,
          previousOrigin: carrier.fields.authors.origin,
        },
      ) as ExtractedFields['authors'],
    );
  }
}

function needsIdentifierAuthorBackfill(
  raw: string,
  currentAuthors: ExtractedFields['authors']['value'],
  bestAuthorCount: number,
): boolean {
  if (!Array.isArray(currentAuthors) || currentAuthors.length === 0) {
    return true;
  }

  const hasGroupedAuthor = currentAuthors.some((author) => /,/.test(author.family ?? author.literal ?? ''));
  if (hasGroupedAuthor) {
    return true;
  }

  if (/\bet al\.?\b/iu.test(raw) && currentAuthors.length < bestAuthorCount) {
    return true;
  }

  const authorZone = raw.split(/\b(?:1[6-9]|20)\d{2}\b/u)[0] ?? raw;
  const explicitJoiners = (authorZone.match(/\s+and\s+|&|;/giu) ?? []).length;
  const commaDelimitedNames = (authorZone.match(/,\s+(?:[\p{Lu}][\p{L}'-]+|\p{Lu}\.)/gu) ?? []).length;
  const expectedMinimum = Math.max(explicitJoiners + 1, Math.min(bestAuthorCount, commaDelimitedNames + 1));

  return expectedMinimum >= 2 && currentAuthors.length < expectedMinimum;
}

function propagationScore(
  field: (typeof PROPAGATABLE_FIELDS)[number],
  value: ExtractedFields[typeof field]['value'],
  confidence: number,
): number {
  if (Array.isArray(value)) {
    return confidence + value.length * 0.08;
  }
  if (typeof value === 'number') {
    return confidence + 0.05;
  }
  const text = typeof value === 'string' ? value : '';
  let score = confidence + Math.min(text.length / 120, 0.24);

  if (field === 'conferenceTitle') {
    const hasExplicitConferenceCue = hasExplicitConferenceTitleCue(text);
    if (isConferencePlaceholder(text)) score += 0.18;
    if (hasExplicitConferenceCue) score += 0.34;
    if (looksConferencePublicationVenue(text)) score += 0.3;
    if (!hasExplicitConferenceCue && looksJournalLikeContainer(text)) score -= 0.18;
    if (!hasExplicitConferenceCue && looksCompactConferenceVenueAlias(text)) score -= 0.14;
    if (!looksConferencePublicationVenue(text) && looksInstitutionalContainer(text)) score -= 0.45;
    if (looksContainerInstitutionTailSpill(text)) score -= 0.65;
  }

  if (field === 'bookTitle') {
    if (!looksPublisherLike(text) && !looksInstitutionalContainer(text)) score += 0.12;
    if (looksConferenceContainer(text)) score -= 0.2;
  }

  if (field === 'repository') {
    if (inferPreprintRepositoryFromText(text) === text) score += 0.2;
    if (looksLikeAuthorSpill(text)) score -= 0.5;
  }

  return score;
}

function hasExplicitConferenceTitleCue(text: string | undefined): boolean {
  if (!text) return false;
  return looksConferenceContainer(text) || looksUppercaseProceedingsTitle(text);
}

function looksBrokenConferencePublisher(text: string | undefined): boolean {
  if (!text) return true;
  const normalized = normalizeInlineQuoteCharacters(stripTrailingPunctuation(text)).trim();
  if (!normalized) {
    return true;
  }
  return (
    /\bpaper presented at\b/iu.test(normalized)
    || /^["'\].,;:\s]+/u.test(normalized)
    || /^n\/?a$/iu.test(normalized)
  );
}

function isConferencePublisherCandidate(text: string | undefined): boolean {
  if (!text) return false;
  if (looksLowQualityContainerCandidate(text) || looksLocatorHeavyContainerSpill(text)) {
    return false;
  }
  if (/^paper presented at\b/iu.test(text)) {
    return false;
  }
  if (looksLikeAuthorSpill(text) || hasExplicitConferenceTitleCue(text)) {
    return false;
  }
  if (
    looksConferenceContainer(text)
    && !looksCompactConferenceVenueAlias(text)
    && !looksConferencePublisherOrganization(text)
    && !looksPublisherLike(text)
    && !looksInstitutionalContainer(text)
  ) {
    return false;
  }
  return (
    looksPublisherLike(text)
    || looksInstitutionalContainer(text)
    || looksRecoverableConferencePublisherSlot(text)
    || looksCompactConferenceVenueAlias(text)
    || looksJournalLikeContainer(text)
    || Boolean(normalizeConferencePublisherSlotCandidate(text))
  );
}

function conferencePublisherPropagationScore(
  value: ExtractedFields['publisher']['value'],
  confidence: number,
): number {
  const text = typeof value === 'string' ? value : '';
  let score = propagationScore('publisher', value, confidence);
  if (looksPublisherLike(text)) score += 0.16;
  if (looksInstitutionalContainer(text)) score += 0.14;
  if (looksCompactConferenceVenueAlias(text)) score += 0.12;
  if (looksJournalLikeContainer(text)) score += 0.08;
  if (text.split(/\s+/u).filter(Boolean).length >= 3) score += 0.08;
  if (looksStandaloneInstitutionalAlias(text) && !looksInstitutionalContainer(text)) score -= 0.14;
  if (looksCompactConferenceVenueAlias(text) && text.length <= 12) score -= 0.2;
  return score;
}

function normalizeInlineQuoteCharacters(value: string): string {
  return value.replace(/[“”«»]/gu, '"');
}

function normalizePropagationPublisherProxy(
  value: string,
  raw: string,
  titleHint?: string | null,
): string | null {
  return normalizePropagationPublisherProxyCached(composeCacheKey(value, raw, titleHint));
}

const normalizePropagationPublisherProxyCached = createBoundedValueCache<string | null>(
  PROPAGATION_PUBLISHER_PROXY_CACHE_LIMIT,
  (cacheKey) => {
    const [value = '', raw = '', titleHint = ''] = cacheKey.split('\u0000');
    const normalized = normalizePublisherCandidate(
      stripPublisherLeadQuoteBleed(normalizeInlineQuoteCharacters(value)),
      titleHint || null,
    );
    if (!normalized) {
      return null;
    }

    const normalizedCandidate = normalizeInlineQuoteCharacters(normalized);
    const quoteCount = (normalizedCandidate.match(/"/gu) ?? []).length;
    if (quoteCount % 2 === 0) {
      return normalizedCandidate;
    }

    const rawWithStraightQuotes = normalizeInlineQuoteCharacters(normalizeExtractionInput(raw));
    const candidateCore = normalizedCandidate.replace(/"+$/u, '').trim();
    const recovered = rawWithStraightQuotes.match(
      new RegExp(
        `${escapeRegex(candidateCore)}(?<closing>")(?=[.,;:]?(?:\\s+(?:Available at|Accessed|Retrieved|https?:\\/\\/|doi:)|$))`,
        'iu',
      ),
    );

    if (recovered?.groups?.closing) {
      return `${candidateCore}"`;
    }

    return normalizedCandidate;
  },
);

function shouldSuppressMirroredCorporateOwnerAuthor(
  fields: ExtractedFields,
  raw: string,
): boolean {
  const authors = Array.isArray(fields.authors.value) ? fields.authors.value : [];
  if (authors.length !== 1) {
    return false;
  }

  const ownerLead = typeof fields.institution.value === 'string'
    ? fields.institution.value
    : typeof fields.publisher.value === 'string'
      ? fields.publisher.value
      : null;
  if (!ownerLead) {
    return false;
  }

  const doi = typeof fields.doi.value === 'string' ? fields.doi.value : null;
  const hasBookishIdentifier =
    (typeof fields.isbn.value === 'string' && fields.isbn.value.trim().length > 0)
    || looksBookChapterDoi(doi ?? undefined)
    || /10\.\d{4,9}\/97[89][-\d]{10,17}/iu.test(doi ?? '');
  if (hasBookishIdentifier) {
    return false;
  }

  if (
    hasFieldValue(fields.journal)
    || hasFieldValue(fields.conferenceTitle)
    || hasFieldValue(fields.bookTitle)
    || hasFieldValue(fields.repository)
    || hasFieldValue(fields.siteName)
  ) {
    return false;
  }

  const reportishOwnerCue =
    looksReportLikeDoi(doi ?? '', { owner: ownerLead })
    || /\b(?:report|standard|bulletin|guideline|specification|recommendation)\b/iu.test(raw);
  if (!reportishOwnerCue) {
    return false;
  }

  const [author] = authors;
  const authorComparable = normalizeComparableText(
    author?.literal ?? [author?.family, author?.given].filter(Boolean).join(' '),
  );
  const ownerComparable = normalizeComparableText(ownerLead);
  if (
    !authorComparable
    || !ownerComparable
    || (
      authorComparable !== ownerComparable
      && !matchesInstitutionalOwner(author, ownerLead)
    )
  ) {
    return false;
  }

  const rawComparable = normalizeComparableText(raw);
  const firstIndex = rawComparable.indexOf(ownerComparable);
  if (firstIndex < 0) {
    return false;
  }
  const secondIndex = rawComparable.indexOf(ownerComparable, firstIndex + ownerComparable.length);
  return secondIndex >= 0;
}

function matchesInstitutionalOwner(
  author: CanonicalAuthor | undefined,
  ownerLead: string,
): boolean {
  if (!author) {
    return false;
  }

  const authorText = author.literal ?? [author.family, author.given].filter(Boolean).join(' ');
  const authorComparable = normalizeComparableText(authorText);
  const ownerComparable = normalizeComparableText(ownerLead);
  if (!authorComparable || !ownerComparable) {
    return false;
  }
  if (authorComparable === ownerComparable) {
    return true;
  }

  const authorTokens = comparableTokenSignature(authorText);
  const ownerTokens = comparableTokenSignature(ownerLead);
  return authorTokens.length > 0 && authorTokens === ownerTokens;
}

function comparableTokenSignature(value: string): string {
  return normalizeComparableText(value)
    .split(/\s+/u)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function isLowQualityPropagationValue(
  field: (typeof PROPAGATABLE_FIELDS)[number],
  value: ExtractedFields[typeof field]['value'],
): boolean {
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    return value.some((author) => {
      const family = author.family ?? author.literal ?? '';
      const text = `${family} ${author.given ?? ''}`.trim();
      return (
        text.length > 80
        || /https?:\/\//iu.test(text)
        || /(?:vol|pp?|doi|conference|review)/iu.test(text)
        || family.includes(',')
      );
    });
  }

  if (typeof value === 'number') {
    return !Number.isFinite(value);
  }

  if (field === 'title') {
    return isLowQualityTitleCandidate(typeof value === 'string' ? value : undefined);
  }

  if (field === 'conferenceTitle') {
    const text = typeof value === 'string' ? normalizeConferenceTitle(value) : '';
    if (isConferencePlaceholder(text)) {
      return false;
    }
    return (
      looksLowQualityContainerCandidate(text)
      || (!looksConferencePublicationVenue(text) && looksInstitutionalContainer(text))
      || looksReportPublisherAcronym(text)
      || looksContainerInstitutionTailSpill(text)
      || !looksConferencePublicationVenue(text)
    );
  }

  if (field === 'bookTitle') {
    const text = typeof value === 'string' ? normalizeConferenceTitle(value) : '';
    return (
      looksLowQualityContainerCandidate(text)
      || looksInstitutionalContainer(text)
      || looksPublisherLike(text)
      || looksLikeAuthorSpill(text)
    );
  }

  if (field === 'repository') {
    const text = typeof value === 'string' ? value.trim() : '';
    return (
      looksLowQualityContainerCandidate(text)
      || looksLikeAuthorSpill(text)
      || text.split(/\s+/u).filter(Boolean).length > 10
    );
  }

  if (field === 'siteName' || field === 'journal' || field === 'publisher' || field === 'institution') {
    return looksLowQualityContainerCandidate(typeof value === 'string' ? value : undefined);
  }

  return false;
}

function getPhase4MlStyleHint(carrier: ReferenceCarrier): CitationStyle {
  if (carrier.style.primary.style !== 'unknown' && carrier.style.primary.style !== 'auto') {
    return carrier.style.primary.style;
  }

  return representativeStyleForFamily(carrier.style.family);
}

function normalizeStyleFamily(family: StyleFamily): string {
  switch (family) {
    case 'author_date':
      return 'apa';
    case 'notes_bibliography':
      return 'mla';
    case 'numeric':
      return 'numeric';
    case 'web_accessed':
      return 'web';
    default:
      return 'unknown';
  }
}

function deterministicBucket(raw: string, activeModelVersion: string): number {
  const normalized = normalizeHashInput(raw);
  const digest = createHash('sha1')
    .update(`${normalized}::${activeModelVersion}`)
    .digest('hex')
    .slice(0, 8);
  const value = Number.parseInt(digest, 16);
  return value / 0x1_0000_0000;
}

function normalizeHashInput(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function readRoutingConfig(): Promise<Phase4RoutingConfig> {
  const overrideMode = await getPhase4OverrideMode();
  const mode = overrideMode ?? parseMode(process.env.ML_PHASE4_MODE ?? env.ML_PHASE4_MODE);
  return {
    mode,
    primaryFraction: clampFraction(process.env.ML_PHASE4_PRIMARY_FRACTION ?? `${env.ML_PHASE4_PRIMARY_FRACTION}`),
    shadowFraction: overrideMode
      ? 0
      : clampFraction(process.env.ML_PHASE4_SHADOW_FRACTION ?? `${env.ML_PHASE4_SHADOW_FRACTION}`),
  };
}

function heuristicRoutingConfig(): Phase4RoutingConfig {
  return {
    mode: 'heuristic',
    primaryFraction: 0,
    shadowFraction: 0,
  };
}

function parseMode(value: string): Phase4RoutingConfig['mode'] {
  return value === 'shadow' || value === 'primary' ? value : 'heuristic';
}

function clampFraction(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function toBatchError(error: ExtractBatchError, health: MLHealthResponse | null): ExtractionMetaError {
  return {
    code: error.code,
    message: error.message ?? buildDefaultMlErrorMessage(error.code, health?.activeModelVersion ?? null),
  };
}

function toExtractionMetaError(
  error: MLError | unknown,
  health: MLHealthResponse | null = null,
): ExtractionMetaError {
  if (typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string') {
    const errorWithMessage = error as { code: string; message?: unknown };
    const code = isMlErrorCode(errorWithMessage.code) ? errorWithMessage.code : 'INTERNAL_ERROR';
    return {
      code,
      message: typeof errorWithMessage.message === 'string'
        ? errorWithMessage.message
        : buildDefaultMlErrorMessage(code, health?.activeModelVersion ?? null),
    };
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: error.message || buildDefaultMlErrorMessage('INTERNAL_ERROR', health?.activeModelVersion ?? null),
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: buildDefaultMlErrorMessage('INTERNAL_ERROR', health?.activeModelVersion ?? null),
  };
}

function isMlErrorCode(code: string): code is (typeof ML_ERROR_CODES)[number] {
  return (ML_ERROR_CODES as readonly string[]).includes(code);
}

function buildDefaultMlErrorMessage(code: string, modelVersion: string | null): string {
  const suffix = modelVersion ? ` (model ${modelVersion})` : '';
  switch (code) {
    case 'INFERENCE_TIMEOUT':
      return `ML extraction timed out${suffix}.`;
    case 'MODEL_UNAVAILABLE':
      return `ML extraction model was unavailable${suffix}.`;
    case 'CIRCUIT_OPEN':
      return `ML extraction circuit is open${suffix}.`;
    case 'QUEUE_FULL':
      return `ML extraction queue is full${suffix}.`;
    case 'BAD_REQUEST':
      return `ML extraction request was invalid${suffix}.`;
    default:
      return `ML extraction failed${suffix}.`;
  }
}

function buildCarrierMessage(meta: ExtractionMeta, reason: string): string {
  if (meta.runMode === 'ml') {
    return `Extraction used heuristic output with selective ML patches (${reason}).`;
  }
  if (meta.runMode === 'shadow') {
    return meta.mlError
      ? `Extraction kept heuristic output while shadow ML failed (${reason}).`
      : `Extraction kept heuristic output while recording shadow ML diff (${reason}).`;
  }
  return meta.mlError
    ? `Extraction used heuristic output after ML fallback (${reason}).`
    : `Extraction used heuristic output (${reason}).`;
}

function normalizeComparableValue(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableValue(entry));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, normalizeComparableValue(entry)])
        .filter(([, entry]) => entry !== undefined),
    );
  }
  return value;
}

function deepEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasFieldValueForPhase4(field: { value: unknown }): boolean {
  if (Array.isArray(field.value)) {
    return field.value.length > 0;
  }
  if (typeof field.value === 'string') {
    return field.value.trim().length > 0;
  }
  return field.value !== null && field.value !== undefined;
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
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

export type { CitationExtractionHistoryRow };

