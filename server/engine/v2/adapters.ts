// @ts-nocheck
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import pLimit from 'p-limit';
import { getAuthorityData } from '@shared/authorityLookup';
import type {
  CanonicalAuthor,
  CanonicalReferenceType,
  CitationStyle,
  ParsedReference,
  V2ConversionResponse,
  V2SelectorMode,
} from '@shared/schema';
import { CitationParser } from '../citationParser.js';
import { classifyLocatorToken, isGroupAuthor, normalizeGroupAuthor } from '../shared/citationSemantics.js';
import {
  canonicalAuthorToDisplay,
  canonicalReferenceTypeToParsed,
  canonicalToParsedReference,
  coerceCanonicalAuthor,
  fixUnicodeText,
  looksLikeAlternatingTokenArray,
  normalizeDoiValue,
  normalizeWhitespace,
  parseAuthorToCanonical,
  parseAuthorsForStyle,
  parseInitialsFirstAuthor,
  parsedReferenceTypeToCanonical,
} from './utils.js';
import { crossrefTypeFilterForSourceType, mapCrossrefTypeToReferenceType } from './sourceTypes.js';
import {
  analyzeParsedAuthorStrings,
  bestVenueFromParsed,
  getRequirementProfile,
  hasParsedVenue,
  isLocatorLike,
  isPlaceholderValue,
  looksLikeAuthorContentLeak,
  looksLikeCompactVancouverAuthorString,
  proceedingsSignal,
  sanitizeParsedReference,
} from './qualityRules.js';
import {
  getOpenAiExtractModel,
  getOpenAiExtractTimeoutMs,
  reserveExtractFallbackCall,
} from './llmConfig.js';
import {
  extractJsonContent,
  LLM_EXTRACT_SYSTEM_PROMPT,
  parseLlmExtraction,
  type LlmExtraction,
} from './llmExtraction.js';
import { assessCandidatePlausibility } from './fieldPlausibility.js';
import { buildContainerHints, resolveWinnerContainer } from './containerHints.js';
import { resolveConferenceContainer } from './conferenceResolver.js';
import { resolveReportMetadata } from './reportResolver.js';
import { normalizeAuthorsForProvenance } from './authorProvenance.js';
import {
  buildNormalizedKeyFields,
  selectExtractionCandidate,
} from './candidateSelector.js';
import {
  buildStyleSignalScore,
} from './classificationPolicy.js';
import {
  areReferenceTypesMergeCompatible,
  resolveReferenceTypeFromEvidence,
} from './typeResolution.js';
import { repairSelectedParsedReference } from './selectionRepairs.js';
import {
  applyClusterReuseFields,
  buildFallbackQueuePriority,
  buildSingleTargetIdentifierFingerprint,
  canRetryFallbackAttempt,
  classifyLlmAttemptError,
  clearInflightCachePromise,
  clearInflightClusterPromise,
  computeFallbackCacheKey,
  computeFallbackClusterKey,
  getFallbackAttemptHistory,
  getInflightCachePromise,
  getInflightClusterPromise,
  getPersistedClusterReuse,
  isFieldStructurallyCorrupt,
  recordAcceptedClusterReuse,
  recordFallbackAttemptHistory,
  resolveTruthStateForFallback,
  setInflightCachePromise,
  setInflightClusterPromise,
} from './llmFallbackPolicy.js';
import type {
  AuthorityLookupAdapter,
  CacheAdapter,
  ClassifierAdapter,
  EmbeddingAdapter,
  ExportAdapter,
  ExtractorAdapter,
  ResolutionCandidateRecord,
  ResolutionProviderAdapter,
  ResolutionSearchQuery,
  V2SplitArtifact,
  V2AdapterBundle,
} from './contracts.js';
import { V2_THRESHOLD_POLICY } from './thresholdPolicy.js';

const DOI_PATTERN = /\b10\.\d{4,}\/\S+\b/i;
const YEAR_PATTERN = /\b(?:1[5-9]\d{2}|20\d{2})\b/g;
const URL_PATTERN = /https?:\/\/\S+/i;
const URL_PATTERN_GLOBAL = /https?:\/\/\S+/gi;
const DEFAULT_GROBID_TIMEOUT_MS = V2_THRESHOLD_POLICY.extract.grobidTimeoutMs;
const DEFAULT_GROBID_COOLDOWN_MS = V2_THRESHOLD_POLICY.extract.grobidCooldownMs;
const PLACE_PUBLISHER_YEAR_PATTERN = /([^.;]+?):\s*([^.;]+?)\s*;\s*((?:1[5-9]\d{2}|20\d{2}))$/i;
const PLACE_PUBLISHER_PATTERN = /([^.;]+?):\s*([^.;]+?)$/i;
const PLACE_YEAR_PATTERN = /([A-Za-z][^.;\d]*?)\s*;\s*((?:1[5-9]\d{2}|20\d{2}))$/i;
const METADATA_YEAR_PATTERN = /(.+?)\s*;\s*((?:1[5-9]\d{2}|20\d{2}))$/i;
const UPDATED_YEAR_PATTERN = /^(?:updated|revised)\s+[A-Za-z]+\s+((?:1[5-9]\d{2}|20\d{2}))$/i;
const YEAR_ONLY_SEGMENT_PATTERN = /^((?:1[5-9]\d{2}|20\d{2}))$/;
const ARXIV_SEGMENT_PATTERN = /\barxiv(?:\s+preprint)?\b/i;
const ARXIV_ID_PATTERN = /(arXiv:\d{4}\.\d{4,5}(?:v\d+)?)/i;
const EDITION_SEGMENT_PATTERN = /^(?:\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?|version\b.+)$/i;
const IDENTIFIER_SEGMENT_PATTERN = /^(?:[A-Z][A-Za-z0-9&/-]+(?:\s+[A-Z][A-Za-z0-9&/-]+){0,4}\s+)?(?:guideline|statement|manual|handbook|working paper|fact sheet|programme guide|program guide|methods manual)\s+\[[A-Z]{1,12}[A-Z0-9-]*\d+[A-Z0-9-]*\]$/i;
const INSTITUTIONAL_KEYWORD_PATTERN = /\b(?:organization|agency|administration|department|ministry|office|commission|council|library|bank|foundation|programme|program|centre|center|college|university|hospital|publisher|press|authority|academ(?:y|ies)|team|group|committee|board|unit|collaboration|network|initiative|institute|society|association|union|research|observatory|task\s*force|taskforce|bureau|laborator(?:y|ies)|lab|portal|hub)\b/i;
const REPORT_PUBLISHER_KEYWORD_PATTERN = /\b(?:organization|agency|administration|department|ministry|office|commission|council|library|bank|foundation|centre|center|college|university|hospital|authority|academ(?:y|ies)|team|group|committee|board|unit|collaboration|network|initiative|institute|society|association|union|observatory|task\s*force|taskforce|bureau|laborator(?:y|ies)|lab|portal|hub)\b/i;
const PERSONAL_AUTHOR_LEAD_PATTERN = /(?:^|,\s*)[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2}\s+[A-Z](?:[.-]?[A-Z]){0,5}\.?/;
const BRACKETED_IDENTIFIER_PATTERN = /\[[A-Z]{1,12}[A-Z0-9-]*\d+[A-Z0-9-]*\]/;
const INSTITUTIONAL_TAIL_PATTERN = /(?:available from:|:\s*[^.;]+;\s*(?:1[5-9]\d{2}|20\d{2})$|;\s*(?:1[5-9]\d{2}|20\d{2})$|(?:^|[.]\s+)version\b|\[[A-Z]{1,12}[A-Z0-9-]*\d+[A-Z0-9-]*\])/i;
const QUOTED_JOURNAL_LOCATOR_PATTERN = /^(?<authors>.+?)\s+"(?<title>[^"]+?)"\.?\s+(?<journal>.+?)\s+(?:vol\.?\s*)?(?<volume>\d+)(?:\s*,\s*no\.?\s*(?<issue>[A-Za-z0-9-]+))?\s*\((?<year>(?:1[5-9]\d{2}|20\d{2}))\)\s*:\s*(?<locator>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?(?:\s+(?<tail>.+))?$/i;
const COMPACT_JOURNAL_TAIL_PATTERN = /^(?<lead>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2})(?:\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2})?)\s*,\s*(?<volume>\d+)(?:\((?<issue>[A-Za-z0-9-]+)\))?\s*,\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?(?:\s+(?<tail>.+))?$/i;
const IN_SOURCE_QUOTED_PATTERN = /^(?<authors>.+?)\.\s+"(?<title>[^"]+?)"\.?\s+In:?\s+(?<tail>.+)$/i;
const IN_SOURCE_PLAIN_PATTERN = /^(?<authors>.+?)\.\s+(?<title>[^.]+?)\.\s+In:?\s+(?<tail>.+)$/i;
const IN_SOURCE_LOCATOR_PATTERN = /\bpp?\.?\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\b/i;
const CONFERENCE_SIGNAL_PATTERN = /\b(?:conference|symposium|workshop|congress|meeting|proceedings|forum|summit|colloquium)\b/i;
const PUBLISHER_SEGMENT_PATTERN = /\b(?:IEEE|ACM|Springer|Elsevier|Wiley|Routledge|Sage|Taylor\s*&\s*Francis|Oxford University Press|Cambridge University Press|CRC Press|MDPI|Pearson|McGraw-Hill|Palgrave|American Institute of Aeronautics and Astronautics|Institution of Engineering and Technology|Japan Society of Applied Physics|International Association for Bridge and Structural Engineering|American Thoracic Society|International Astronautical Federation|Atlantis Press)\b/i;
const BOOKISH_CONTAINER_SIGNAL = /\b(?:handbook|manual|guide|textbook|companion|encyclopedia|dictionary|concentrate|reader|workbook|primer)\b/i;
const NUMBERED_CHAPTER_TITLE_PATTERN = /^(?:chapter\s+)?\d+(?:[.):-]|\s+-)\s*/i;
const ATLANTIS_PROCEEDINGS_SERIES_SIGNAL = /\badvances in social science, education and humanities research\b/i;
const PLACE_SEGMENT_PATTERN = /^(?:[A-Z][A-Za-z'’.-]+(?:,\s*[A-Z][A-Za-z'’.-]+){0,3})$/;
const BOOK_TAIL_PATTERN = /(?<place>[A-Z][^.:]{1,80}?)\s*:\s*(?<publisher>[^.;]+?)(?:[;,]\s*(?<year>(?:1[5-9]\d{2}|20\d{2})))?\.?$/i;
const BOOK_PUBLISHER_YEAR_PATTERN = /(?<publisher>[^.;]+?)\s*[,;]\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?$/i;
const BOOK_NOTE_PATTERN = /^(?<title>.+?)\.\s*(?<note>(?:translated|edited|with\s+a\s+foreword|foreword|preface|introduction)\b.+)$/i;
const HARVARD_JOURNAL_PATTERN = /^(?<author>.+?)\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))\s*,\s*["'](?<title>[^"']+)["']\s*,\s*(?<journal>.+?),\s*vol\.?\s*(?<volume>\d+)(?:,\s*no\.?\s*(?<issue>[^,]+))?,\s*pp\.?\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?(?:,\s*(?<tail>.+))?$/i;
const HARVARD_SENTENCE_JOURNAL_PATTERN = /^(?<author>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.\s*(?<title>.+?)\.\s*(?<journal>.+?),\s*(?:(?<volume>\d+)(?:\((?<issue>[A-Za-z0-9-]+)\))?|\((?<issueOnly>[A-Za-z0-9-]+)\))\s*,\s*pp?\.?\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?(?:\s+(?<tail>.+))?$/i;
const APA_JOURNAL_PATTERN = /^(?<authors>.+?)\s*\((?<year>(?:1[5-9]\d{2}|20\d{2}))\)\.\s+(?<title>.+?)\.\s+(?<journal>.+?),\s*(?<volume>\d+)(?:\((?<issue>[A-Za-z0-9-]+)\))?,\s*(?<locator>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?(?:\s+(?<tail>.+))?$/i;
const HARVARD_CONFERENCE_PATTERN = /^(?<author>.+?)\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))\s*,\s*["'](?<title>[^"']+)["']\s*,\s*in\s+(?<conferenceTitle>.+?),\s*(?<place>[^,]+),\s*pp\.?\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\s*,\s*(?<publisher>[^.]+)\.?$/i;
const HARVARD_IN_SOURCE_CHAPTER_PATTERN = /^(?<author>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.\s*(?<title>.+?)\.\s+In:?\s+(?<bookTitle>.+?),\s*pp?\.?\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?\s*(?<publisher>[^.]+?)\.?(?:\s+(?<tail>.+))?$/i;
const HARVARD_BOOK_PATTERN = /^(?<author>.+?)\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))\s*,\s*(?<title>[^,]+?)(?:,\s*(?<edition>\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?|[A-Za-z0-9.\- ]+ edition))?,\s*(?<publisher>[^,]+),\s*(?<place>[^.]+)\.?$/i;
const HARVARD_WEBSITE_PATTERN = /^(?<author>.+?)\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))\s*,\s*["'](?<title>[^"']+)["']\s*,\s*(?<container>.+?),\s*(?:viewed|accessed)\b[\s\S]+?(?<url>(?:https?:\/\/|www\.)\S+)/i;
const QUOTED_WEBSITE_PATTERN = /^(?:\[\d+\]\s*)?(?<author>.+?)(?:,|\.)\s+"(?<title>[^"]+?)"[,.]?\s*(?<rest>.+)$/i;
const MLA_CHAPTER_PATTERN = /^(?<author>.+?)\.\s+"(?<title>[^"]+?)"\.?\s+(?<bookTitle>.+?),\s+edited by\s+(?<editor>.+?),\s+(?<publisher>[^,]+),\s+(?<year>(?:1[5-9]\d{2}|20\d{2})),\s*pp\.?\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?$/i;
const MLA_BARE_CHAPTER_PATTERN = /^(?<author>.+?)\.\s+"(?<title>[^"]+?)"\.?\s+(?<bookTitle>.+?),\s*pp\.?\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?\s+(?<publisher>[^,]+),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?(?:\s+(?<tail>.+))?$/i;
const MLA_QUOTED_CHAPTER_NO_PAGES_PATTERN = /^(?:\[\d+\]\s*|\d+\.\s*)?(?<author>.+?)\.\s+"(?<title>[^"]+?)"\.?\s+(?<bookTitle>[^.]+?)\.\s+(?<publisher>[^,]+),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?(?:\s+(?<tail>.+))?$/i;
const MLA_CONFERENCE_PROCEEDINGS_PATTERN = /^(?<author>.+?)\.\s+"(?<title>[^"]+?)"\.?\s+(?<conferenceTitle>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2})),\s*pp\.?\s*(?<pages>[A-Za-z0-9][\w.-]*(?:\s*[-–]\s*[A-Za-z0-9][\w.-]*)?)\.?\s+(?<publisher>[^.]+)\.\s*(?<tail>.+)?$/i;
const CHICAGO_CHAPTER_PATTERN = /^(?<author>.+?)\.\s+"(?<title>[^"]+?)"\.?\s+In\s+(?<bookTitle>.+?),\s+edited by\s+(?<editor>.+?),\s*(?:pp\.?\s*)?(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.\s+(?<place>[^:]+):\s*(?<publisher>[^,]+),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?$/i;
const CHICAGO_AUTHOR_DATE_JOURNAL_PATTERN = /^(?<authors>.+?)\.\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))\.\s+"(?<title>[^"]+?)"\.?\s+(?<journal>.+?)\s+(?<volume>\d+),\s*no\.?\s*(?<issue>[A-Za-z0-9-]+):\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?(?:\s+(?<tail>.+))?$/i;
const CHICAGO_AUTHOR_DATE_REPORT_PATTERN = /^(?<author>.+?)\.\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))\.\s+(?<title>.+?)\.\s+(?<place>[^:]+):\s+(?<publisher>[^.]+)\.\s*(?<url>(?:https?:\/\/|www\.)\S+)?$/i;
const TITLE_PLACE_PUBLISHER_REPORT_PATTERN = /^(?:\[\d+\]\s*|\d+\.\s*)?(?<title>.+?)\.\s+(?<place>[^:]+):\s*(?<publisher>[^.;]+)\s*;\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?(?:\s+(?<tail>.+))?$/i;
const MLA_BOOK_PATTERN = /^(?<author>.+?)\.\s+(?<title>[^."]+?)\.\s+(?<publisher>[^,]+),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?$/i;
const CHICAGO_BOOK_PATTERN = /^(?<author>.+?)\.\s+(?<title>[^."]+?)\.\s+(?<place>[^:]+):\s*(?<publisher>[^,]+),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?$/i;
const IEEE_BOOK_PATTERN = /^(?:\[\d+\]\s*)?(?<author>(?:[\p{Lu}]\.\s*)+[\p{Lu}][\p{L}'’-]+),\s*(?<title>[^.]+?)\.\s+(?<place>[^:]+):\s*(?<publisher>[^,]+),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?$/u;
const IEEE_CONFERENCE_PATTERN = /^(?:\[\d+\]\s*)?(?<authors>.+?),\s*"(?<title>[^"]+?)"\s+in\s+(?<conferenceTitle>.+?),\s*(?<place>[^,]+),\s*(?<year>(?:1[5-9]\d{2}|20\d{2})),\s*pp\.?\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?(?:\s*,?\s*(?<tail>.+))?$/i;
const VANCOUVER_ARTICLE_NUMBER_PATTERN = /^(?:\[\d+\]\s*|\d+\.\s*)?(?<authors>.+?)\.\s+(?<title>.+?)\.\s+(?<journal>.+?)\.\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))(?:\s+(?<month>[A-Za-z]{3,9}))?;\s*(?<volume>\d+):(?<locator>[A-Za-z0-9][\w.-]*(?:\s*[-–]\s*[A-Za-z0-9][\w.-]*)?)\.?(?:\s+(?<tail>.+))?$/i;
const VANCOUVER_COMPACT_JOURNAL_PATTERN = /^(?:\[\d+\]\s*|\d+\.\s*)?(?<authors>[^.]+)\.\s+(?<title>.+?)\.\s+(?<journal>.+?)\.\s+(?<year>(?:1[5-9]\d{2}|20\d{2}));\s*(?<volume>\d+)(?:\((?<issue>[A-Za-z0-9-]+)\))?:(?<pages>[A-Za-z0-9][\w.-]*(?:\s*[-–]\s*[A-Za-z0-9][\w.-]*)?)\.?(?:\s+(?<tail>.+))?$/i;
const VANCOUVER_SENTENCE_JOURNAL_PATTERN = /^(?:\[\d+\]\s*|\d+\.\s*)?(?<authors>.+)\.\s+(?<title>[^.]+?)\.\s+(?<journal>[^.]+?)\.\s+(?<year>(?:1[5-9]\d{2}|20\d{2}));\s*(?<volume>\d+)(?:\((?<issue>[A-Za-z0-9-]+)\))?\.?(?:\s+(?<tail>.+))?$/i;
const AUTHOR_COLON_VANCOUVER_PATTERN = /^(?:\[\d+\]\s*|\d+\.\s*)?(?<authors>.+?):\s+(?<title>.+?)\.\s+(?<journal>.+?)\.\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))\s*[,;]\s*(?<volume>\d+)(?:\((?<issue>[A-Za-z0-9-]+)\))?:\s*(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)\.?(?:\s+(?<tail>.+))?$/i;
const APA_THESIS_PATTERN = /^(?<author>.+?)\s*\((?<year>(?:1[5-9]\d{2}|20\d{2}))\)\.\s*(?<title>.+?)\s*[\[(](?<descriptor>(?:doctoral|phd|master'?s?)\s+(?:dissertation|thesis),\s*(?<institution>[^)\]]+))[\])]\.?\s*(?<url>(?:https?:\/\/|www\.)\S+)?$/i;
const MLA_THESIS_PATTERN = /^(?<author>.+?)\.\s+"(?<title>[^"]+?)"\.?\s+(?<institution>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.\s*(?<descriptor>(?:phd|doctoral|master'?s?)\s+(?:dissertation|thesis))\.?(?:\s+(?<url>(?:https?:\/\/|www\.)\S+))?$/i;
const THESIS_DESCRIPTOR_PATTERN = /\b(?:(?:doctoral|phd|master'?s?)\s+)?(?:dissertation|thesis)\b/i;
const AUTO_STYLE_CANDIDATES: CitationStyle[] = ['apa', 'mla', 'harvard', 'chicago', 'ieee', 'vancouver'];

let grobidCooldownUntil = 0;

let parserSingleton: CitationParser | null = null;

function getParser(): CitationParser {
  if (!parserSingleton) parserSingleton = new CitationParser();
  return parserSingleton;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLocalExtractFallbackCallsForBatch(batchSize: number): number {
  const normalizedBatchSize = Math.max(batchSize, 1);
  const perBatchCap = Math.min(readPositiveIntEnv('V2_EXTRACT_FALLBACK_MAX_CALLS_PER_BATCH', 75), 75);
  const configuredRate = Number.parseFloat(process.env.V2_EXTRACT_FALLBACK_MAX_RATE_PER_BATCH ?? '');
  const maxRate = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : 0.15;
  const rateLimitedCap = Math.max(1, Math.ceil(normalizedBatchSize * maxRate));
  return Math.min(rateLimitedCap, perBatchCap);
}

function isTruthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

function isResolutionProviderDisabled(provider: 'crossref' | 'pubmed' | 'openalex'): boolean {
  return isTruthyEnv(process.env[`V2_DISABLE_${provider.toUpperCase()}`]);
}

function isGrobidCoolingDown() {
  return Date.now() < grobidCooldownUntil;
}

function openGrobidCooldown(reason: string) {
  const cooldownMs = readPositiveIntEnv('GROBID_COOLDOWN_MS', DEFAULT_GROBID_COOLDOWN_MS);
  grobidCooldownUntil = Date.now() + cooldownMs;
  console.log(JSON.stringify({
    stage: 'extract',
    adapter: 'grobid',
    event: 'cooldown_opened',
    reason,
    cooldownMs,
  }));
}

function looksLikeAuthorColonVancouverReference(input: string): boolean {
  const normalized = normalizeWhitespace(input);
  if (!/^[^:]{6,}:\s+.+\.\s+[A-Z][^.]+?\.\s+(?:19|20)\d{2}\s*[,;]\s*\d+/i.test(normalized)) {
    return false;
  }

  const authorLead = normalized.slice(0, normalized.indexOf(':')).trim();
  if (!authorLead) return false;
  if (authorLead.includes('. ')) return false;

  const compactSingleAuthor = /^(?:[A-Z][A-Za-z'’-]+|d'[A-Za-z'’-]+)(?:\s+(?:da|de|del|der|di|du|la|le|van|von)\s+[A-Z][A-Za-z'’-]+)*(?:\s+[A-Z][A-Za-z'’-]+)*\s+[A-Z]{1,4}$/i.test(authorLead);
  const commaSeparatedCompactAuthors = ((authorLead.match(/,/g) ?? []).length >= 1 || /\bet\s+al\.?$/i.test(authorLead))
    && /\b[A-Z]{1,4}\b/.test(authorLead);

  return compactSingleAuthor || commaSeparatedCompactAuthors;
}

function preNormalizeExtractorInput(parser: CitationParser, input: string): string {
  return parser.preNormalize(fixUnicodeText(input));
}

function attachAutoStyleToCandidate(
  parser: CitationParser,
  normalized: string,
  candidate: ParsedSelectionCandidate | null,
  styleLocked: boolean,
): ParsedSelectionCandidate | null {
  if (!candidate || styleLocked || candidate.styleUsed) return candidate;
  const autoCandidate = selectBestAutoStyleCandidate(parser, normalized);
  if (!autoCandidate.styleUsed) return candidate;
  if (autoCandidate.referenceType !== candidate.referenceType) return candidate;
  return {
    ...candidate,
    styleUsed: autoCandidate.styleUsed,
    styleConfidence: autoCandidate.styleConfidence,
  };
}

function buildDeterministicCandidate(input: string, inputStyle: string, detectionConfidence = 0) {
  const parser = getParser();
  const normalized = preNormalizeExtractorInput(parser, input);
  const rawUrl = extractUrlSpan(normalized)?.url;
  const styleLocked = inputStyle !== 'auto' && detectionConfidence >= 0.88;
  if (hasWebsiteAccessSignals(normalized)) {
    const institutionalDirect = buildInstitutionalCandidate(normalized);
    if (institutionalDirect) return institutionalDirect;
  }
  const ieeeQuotedReference = buildIeeeQuotedReferenceCandidate(normalized);
  if (ieeeQuotedReference) return ieeeQuotedReference;
  const quotedTitleJournalLocator = buildQuotedTitleJournalLocatorCandidate(normalized);
  if (quotedTitleJournalLocator) {
    return attachAutoStyleToCandidate(parser, normalized, quotedTitleJournalLocator as ParsedSelectionCandidate, styleLocked)
      ?? quotedTitleJournalLocator;
  }
  const apaJournal = buildApaJournalCandidate(normalized);
  if (apaJournal) return apaJournal;
  const ieeeConference = buildIeeeConferenceCandidate(normalized);
  if (ieeeConference) return ieeeConference;
  const vancouverArticleNumber = buildVancouverArticleNumberCandidate(normalized);
  if (vancouverArticleNumber) return vancouverArticleNumber;
  const authorColonVancouver = buildAuthorColonVancouverCandidate(normalized);
  if (authorColonVancouver) return authorColonVancouver;
  const vancouverCompactJournal = buildVancouverCompactJournalCandidate(normalized);
  if (vancouverCompactJournal) return vancouverCompactJournal;
  const vancouverPublisherYearSource = buildVancouverPublisherYearSourceCandidate(normalized);
  if (vancouverPublisherYearSource) return vancouverPublisherYearSource;
  const compactJournalTail = buildCompactJournalTailCandidate(normalized);
  if (compactJournalTail) {
    return attachAutoStyleToCandidate(parser, normalized, compactJournalTail as ParsedSelectionCandidate, styleLocked)
      ?? compactJournalTail;
  }
  const harvardJournal = buildHarvardJournalCandidate(normalized);
  if (harvardJournal) return harvardJournal;
  const harvardSentenceJournal = buildHarvardSentenceJournalCandidate(normalized);
  if (harvardSentenceJournal) return harvardSentenceJournal;
  const harvardConference = buildHarvardConferenceCandidate(normalized);
  if (harvardConference) return harvardConference;
  const harvardInSourceChapter = buildHarvardInSourceChapterCandidate(normalized);
  if (harvardInSourceChapter) return harvardInSourceChapter;
  const quotedWebsite = buildQuotedWebsiteCandidate(normalized, inputStyle);
  if (quotedWebsite) return quotedWebsite;
  const harvardWebsite = buildHarvardWebsiteCandidate(normalized);
  if (harvardWebsite) return harvardWebsite;
  const quotedBookChapter = buildQuotedBookChapterCandidate(normalized, inputStyle);
  if (quotedBookChapter) return quotedBookChapter;
  const chicagoAuthorDateJournal = buildChicagoAuthorDateJournalCandidate(normalized);
  if (chicagoAuthorDateJournal) return chicagoAuthorDateJournal;
  const chicagoAuthorDateReport = buildChicagoAuthorDateReportCandidate(normalized);
  if (chicagoAuthorDateReport) return chicagoAuthorDateReport;
  const titlePlacePublisherReport = buildTitlePlacePublisherReportCandidate(normalized);
  if (titlePlacePublisherReport) return titlePlacePublisherReport;
  const apaThesis = buildApaThesisCandidate(normalized);
  if (apaThesis) return apaThesis;
  const mlaThesis = buildMlaThesisCandidate(normalized);
  if (mlaThesis) return mlaThesis;
  const sentenceThesis = buildSentenceThesisCandidate(normalized, inputStyle);
  if (sentenceThesis) return sentenceThesis;
  const authorYearPublisherTail = buildAuthorYearPublisherTailCandidate(normalized, inputStyle);
  if (authorYearPublisherTail) return authorYearPublisherTail;
  const harvardBook = buildHarvardBookCandidate(normalized);
  if (harvardBook) return harvardBook;
  const ieeeBook = buildIeeeBookCandidate(normalized);
  if (ieeeBook) return ieeeBook;
  const numberedPublisherYearBook = buildNumberedPublisherYearBookCandidate(normalized);
  if (numberedPublisherYearBook) return numberedPublisherYearBook;
  const bookTail = buildBookTailCandidate(normalized, inputStyle);
  if (bookTail) {
    return attachAutoStyleToCandidate(parser, normalized, bookTail as ParsedSelectionCandidate, styleLocked)
      ?? bookTail;
  }

  const selectedStyleCandidate = !styleLocked || inputStyle === 'auto'
    ? (looksLikeAuthorColonVancouverReference(normalized)
      ? {
          branch: 'deterministic_raw' as const,
          normalized,
          parsed: parser.parseReference(normalized, 'vancouver').parsed,
          referenceType: 'unknown',
          warnings: [],
          styleUsed: 'vancouver' as CitationStyle,
          styleConfidence: 0.9,
        }
      : selectBestAutoStyleCandidate(parser, normalized))
    : null;
  const styleToParse = styleLocked
    ? inputStyle as CitationStyle
    : (selectedStyleCandidate?.styleUsed ?? inputStyle ?? 'apa') as CitationStyle;
  const { parsed } = parser.parseReference(normalized, styleToParse);
  const normalizedParsedUrl = cleanTrailingUrl(parsed.url);
  if (rawUrl && (!normalizedParsedUrl || rawUrl.length > normalizedParsedUrl.length)) {
    parsed.url = rawUrl;
  } else if (normalizedParsedUrl) {
    parsed.url = normalizedParsedUrl;
  }

  const doiMatch = normalized.match(DOI_PATTERN);
  if (!parsed.doi && doiMatch) {
    parsed.doi = normalizeDoiValue(doiMatch[0]);
  }
  if (!parsed.doi) {
    parsed.doi = deriveDoiHintFromUrl(parsed.url ?? rawUrl);
  }

  const looksAuthorOptionalWebsite = Boolean(parsed.url)
    && !hasParsedVenue(parsed)
    && !parsed.publisher
    && !parsed.institution
    && !isLocatorLike(parsed.pages ?? parsed['article-number'])
    && !parsed.volume
    && !parsed.issue;
  const primaryAuthor = normalizeWhitespace(parsed.authors?.[0] ?? '');
  if (looksAuthorOptionalWebsite && (parsed.authors?.length ?? 0) === 1) {
    if (!parsed.title && primaryAuthor && !looksLikeInstitutionalLead(primaryAuthor)) {
      parsed.title = primaryAuthor;
      parsed.authors = undefined;
    } else if (
      parsed.title
      && primaryAuthor
      && normalizeWhitespace(parsed.title.toLowerCase()) === normalizeWhitespace(primaryAuthor.toLowerCase())
    ) {
      parsed.authors = undefined;
    }
  }

  let referenceType = parsedReferenceTypeToCanonical(parser.determineReferenceType(parsed));
  if (
    parsed.url
    && !hasParsedVenue(parsed)
    && !parsed.publisher
    && !parsed.institution
    && !isLocatorLike(parsed.pages ?? parsed['article-number'])
    && (!parsed.volume && !parsed.issue)
    && ((parsed.authors?.length ?? 0) <= 1 || referenceType === 'unknown')
  ) {
    referenceType = 'website';
  }
  if (referenceType === 'website' && looksLikeUrlLedWebsitePseudoAuthorParse(parsed, referenceType)) {
    parsed.authors = undefined;
  }

  return {
    normalized,
    parsed,
    referenceType,
    warnings: parsed.parseWarnings ?? [],
    styleUsed: styleToParse,
    styleConfidence: styleLocked ? 1 : selectedStyleCandidate?.styleConfidence,
  };
}

function buildYearAnchoredCandidate(input: string) {
  const parser = getParser();
  const normalized = preNormalizeExtractorInput(parser, input);
  const parsed = parser.parseYearAnchored(normalized);
  if (!parsed) return null;
  return {
    normalized,
    parsed,
    referenceType: parsedReferenceTypeToCanonical(parser.determineReferenceType(parsed)),
    warnings: parsed.parseWarnings ?? [],
  };
}

function getSelectorMode(): V2SelectorMode {
  const value = normalizeWhitespace(process.env.V2_SELECTOR_MODE ?? '').toLowerCase();
  if (value === 'legacy_first_match') return 'legacy_first_match';
  return 'multi_candidate';
}

function buildStyleParserSelectionCandidate(
  parser: CitationParser,
  normalized: string,
  style: CitationStyle,
  styleConfidence?: number,
): ParsedSelectionCandidate {
  const rawUrl = extractUrlSpan(normalized)?.url;
  const { parsed } = parser.parseReference(normalized, style);
  const repairedParsedAuthors = repairAlternatingParsedAuthorArray(parsed.authors);
  if (repairedParsedAuthors) {
    parsed.authors = repairedParsedAuthors;
  }
  const normalizedParsedUrl = cleanTrailingUrl(parsed.url);
  if (rawUrl && (!normalizedParsedUrl || rawUrl.length > normalizedParsedUrl.length)) {
    parsed.url = rawUrl;
  } else if (normalizedParsedUrl) {
    parsed.url = normalizedParsedUrl;
  }

  const doiMatch = normalized.match(DOI_PATTERN);
  if (!parsed.doi && doiMatch) {
    parsed.doi = normalizeDoiValue(doiMatch[0]);
  }
  if (!parsed.doi) {
    parsed.doi = deriveDoiHintFromUrl(parsed.url ?? rawUrl);
  }

  const looksAuthorOptionalWebsite = Boolean(parsed.url)
    && !hasParsedVenue(parsed)
    && !parsed.publisher
    && !parsed.institution
    && !isLocatorLike(parsed.pages ?? parsed['article-number'])
    && !parsed.volume
    && !parsed.issue;
  const primaryAuthor = normalizeWhitespace(parsed.authors?.[0] ?? '');
  if (looksAuthorOptionalWebsite && (parsed.authors?.length ?? 0) === 1) {
    if (!parsed.title && primaryAuthor && !looksLikeInstitutionalLead(primaryAuthor)) {
      parsed.title = primaryAuthor;
      parsed.authors = undefined;
    } else if (
      parsed.title
      && primaryAuthor
      && normalizeWhitespace(parsed.title.toLowerCase()) === normalizeWhitespace(primaryAuthor.toLowerCase())
    ) {
      parsed.authors = undefined;
    }
  }

  let referenceType = parsedReferenceTypeToCanonical(parser.determineReferenceType(parsed));
  if (
    parsed.url
    && !hasParsedVenue(parsed)
    && !parsed.publisher
    && !parsed.institution
    && !isLocatorLike(parsed.pages ?? parsed['article-number'])
    && (!parsed.volume && !parsed.issue)
    && ((parsed.authors?.length ?? 0) <= 1 || referenceType === 'unknown')
  ) {
    referenceType = 'website';
  }
  if (referenceType === 'website' && looksLikeUrlLedWebsitePseudoAuthorParse(parsed, referenceType)) {
    parsed.authors = undefined;
  }

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType,
    warnings: parsed.parseWarnings ?? [],
    styleUsed: style,
    styleConfidence,
  };
}

function collectDeterministicCandidateAttempts(input: string, inputStyle: string, detectionConfidence = 0): CandidateAttempt[] {
  const parser = getParser();
  const normalized = preNormalizeExtractorInput(parser, input);
  const styleLocked = inputStyle !== 'auto' && detectionConfidence >= 0.88;
  const attempts: CandidateAttempt[] = [];
  let adapterPriority = 0;
  const ieeeQuotedReference = buildIeeeQuotedReferenceCandidate(normalized);
  const preferIeeeQuotedReference = Boolean(
    ieeeQuotedReference
    && (ieeeQuotedReference.parsed.authors?.length ?? 0) > 0
    && normalizeWhitespace(ieeeQuotedReference.parsed.title ?? '')
    && normalizeWhitespace(ieeeQuotedReference.parsed.year ?? '')
    && (
      normalizeWhitespace(ieeeQuotedReference.parsed.journal ?? '')
      || normalizeWhitespace(ieeeQuotedReference.parsed.conferenceTitle ?? '')
    )
    && (
      normalizeWhitespace(ieeeQuotedReference.parsed.pages ?? ieeeQuotedReference.parsed['article-number'] ?? '')
      || normalizeWhitespace(ieeeQuotedReference.parsed.volume ?? '')
      || normalizeWhitespace(ieeeQuotedReference.parsed.issue ?? '')
    ),
  );

  const pushAttempt = (
    adapterId: string,
    candidate: ParsedSelectionCandidate | null,
    branch?: ExtractorSelectionBranch,
  ) => {
    const effectiveBranch = branch ?? candidate?.branch ?? 'deterministic_raw';
    attempts.push({
      adapterId,
      adapterPriority: adapterPriority += 1,
      branch: effectiveBranch,
      candidate: candidate ? { ...candidate, branch: effectiveBranch } : null,
    });
  };

  if (hasWebsiteAccessSignals(normalized)) {
    pushAttempt('heuristic:website_access_institutional', buildInstitutionalCandidate(normalized));
  }

  pushAttempt('heuristic:ieee_quoted_reference', ieeeQuotedReference);

  const quotedTitleJournalLocator = buildQuotedTitleJournalLocatorCandidate(normalized);
  pushAttempt(
    'heuristic:quoted_title_journal_locator',
    quotedTitleJournalLocator
      ? (attachAutoStyleToCandidate(parser, normalized, quotedTitleJournalLocator as ParsedSelectionCandidate, styleLocked)
        ?? quotedTitleJournalLocator)
      : null,
  );
  pushAttempt('heuristic:apa_journal', buildApaJournalCandidate(normalized));
  pushAttempt('heuristic:ieee_conference', buildIeeeConferenceCandidate(normalized));
  pushAttempt('heuristic:vancouver_article_number', buildVancouverArticleNumberCandidate(normalized));
  pushAttempt('heuristic:author_colon_vancouver', buildAuthorColonVancouverCandidate(normalized));
  pushAttempt('heuristic:vancouver_compact_journal', buildVancouverCompactJournalCandidate(normalized));
  pushAttempt('heuristic:institutional_vancouver_journal', buildInstitutionalVancouverJournalCandidate(normalized));
  pushAttempt('heuristic:vancouver_sentence_journal', buildVancouverSentenceJournalCandidate(normalized));
  pushAttempt('heuristic:vancouver_publisher_year_source', buildVancouverPublisherYearSourceCandidate(normalized));

  const compactJournalTail = buildCompactJournalTailCandidate(normalized);
  pushAttempt(
    'heuristic:compact_journal_tail',
    compactJournalTail
      ? (attachAutoStyleToCandidate(parser, normalized, compactJournalTail as ParsedSelectionCandidate, styleLocked)
        ?? compactJournalTail)
      : null,
  );

  pushAttempt('heuristic:harvard_journal', buildHarvardJournalCandidate(normalized));
  pushAttempt('heuristic:harvard_sentence_journal', buildHarvardSentenceJournalCandidate(normalized));
  pushAttempt('heuristic:harvard_conference', buildHarvardConferenceCandidate(normalized));
  pushAttempt('heuristic:harvard_in_source_chapter', buildHarvardInSourceChapterCandidate(normalized));
  pushAttempt('heuristic:quoted_website', buildQuotedWebsiteCandidate(normalized, inputStyle));
  pushAttempt('heuristic:harvard_website', buildHarvardWebsiteCandidate(normalized));
  pushAttempt('heuristic:quoted_book_chapter', buildQuotedBookChapterCandidate(normalized, inputStyle));
  pushAttempt('heuristic:in_source_container', buildInSourceCandidate(normalized, inputStyle));
  pushAttempt('heuristic:chicago_author_date_journal', buildChicagoAuthorDateJournalCandidate(normalized));
  pushAttempt('heuristic:chicago_author_date_report', buildChicagoAuthorDateReportCandidate(normalized));
  pushAttempt('heuristic:title_place_publisher_report', buildTitlePlacePublisherReportCandidate(normalized));
  pushAttempt('heuristic:apa_thesis', buildApaThesisCandidate(normalized));
  pushAttempt('heuristic:mla_thesis', buildMlaThesisCandidate(normalized));
  pushAttempt('heuristic:sentence_thesis', buildSentenceThesisCandidate(normalized, inputStyle));
  pushAttempt('heuristic:author_year_publisher_tail', buildAuthorYearPublisherTailCandidate(normalized, inputStyle));
  pushAttempt('heuristic:harvard_book', buildHarvardBookCandidate(normalized));
  pushAttempt('heuristic:ieee_book', buildIeeeBookCandidate(normalized));
  pushAttempt('heuristic:numbered_publisher_year_book', buildNumberedPublisherYearBookCandidate(normalized));

  const bookTail = buildBookTailCandidate(normalized, inputStyle);
  pushAttempt(
    'heuristic:book_tail',
    bookTail
      ? (attachAutoStyleToCandidate(parser, normalized, bookTail as ParsedSelectionCandidate, styleLocked)
        ?? bookTail)
      : null,
  );

  const selectedStyleCandidate = !styleLocked || inputStyle === 'auto'
    ? (looksLikeAuthorColonVancouverReference(normalized)
      ? {
          branch: 'deterministic_raw' as const,
          normalized,
          parsed: parser.parseReference(normalized, 'vancouver').parsed,
          referenceType: 'unknown',
          warnings: [],
          styleUsed: 'vancouver' as CitationStyle,
          styleConfidence: 0.9,
        }
      : selectBestAutoStyleCandidate(parser, normalized))
    : null;
  const styleToParse = styleLocked
    ? inputStyle as CitationStyle
    : (selectedStyleCandidate?.styleUsed ?? inputStyle ?? 'apa') as CitationStyle;
  if (!(preferIeeeQuotedReference && styleToParse === 'ieee')) {
    pushAttempt(
      `parser:selected_style:${styleToParse}`,
      buildStyleParserSelectionCandidate(
        parser,
        normalized,
        styleToParse,
        styleLocked ? 1 : selectedStyleCandidate?.styleConfidence,
      ),
    );
  }

  if (!styleLocked || inputStyle === 'auto') {
    if (preferIeeeQuotedReference) {
      return attempts;
    }
    for (const style of AUTO_STYLE_CANDIDATES) {
      pushAttempt(`parser:auto:${style}`, buildStyleParserSelectionCandidate(parser, normalized, style));
    }
  }

  return attempts;
}

function prepareExtractionCandidate(attempt: CandidateAttempt): CandidateAttempt {
  if (!attempt.candidate) return attempt;

  const sanitized = sanitizeParsedReference(attempt.candidate.parsed, attempt.candidate.referenceType);
  const parsed = normalizeAuthorOptionalWebsiteParse(sanitized.parsed, sanitized.referenceType);
  const preparedCandidate: PreparedExtractionCandidate = {
    ...attempt.candidate,
    id: `${attempt.adapterId}:${attempt.adapterPriority}`,
    adapterId: attempt.adapterId,
    claimedType: sanitized.referenceType,
    parsed,
    referenceType: sanitized.referenceType,
    normalizedKeyFields: buildNormalizedKeyFields(parsed),
    containerHints: buildContainerHints(parsed, sanitized.referenceType),
    plausibility: assessCandidatePlausibility(parsed, sanitized.referenceType),
  };

  return {
    ...attempt,
    candidate: preparedCandidate,
  };
}

type ExtractorSelectionBranch =
  | 'deterministic_raw'
  | 'year_anchored_fallback_raw'
  | 'institutional_heuristic_raw'
  | 'in_source_heuristic_raw';

type ParsedSelectionCandidate = {
  branch: ExtractorSelectionBranch;
  normalized: string;
  parsed: ParsedReference;
  referenceType: string;
  warnings: string[];
  styleUsed?: CitationStyle | null;
  styleConfidence?: number;
};

type CandidateAttempt = {
  adapterId: string;
  adapterPriority: number;
  branch: ExtractorSelectionBranch;
  candidate: ParsedSelectionCandidate | null;
};

function attemptSelectionBucket(attempt: CandidateAttempt): number {
  if (attempt.adapterId === 'legacy:year_anchored_fallback') return 3;
  if (attempt.adapterId.startsWith('parser:')) return 2;
  return 1;
}

function reorderCandidateAttemptsForSelection(attempts: CandidateAttempt[]): CandidateAttempt[] {
  return attempts
    .map((attempt, index) => ({ attempt, index }))
    .sort((left, right) =>
      (attemptSelectionBucket(left.attempt) - attemptSelectionBucket(right.attempt))
      || (left.attempt.adapterPriority - right.attempt.adapterPriority)
      || (left.index - right.index))
    .map(({ attempt }, index) => ({
      ...attempt,
      adapterPriority: index + 1,
      candidate: attempt.candidate
        ? {
            ...attempt.candidate,
            id: `${attempt.adapterId}:${index + 1}`,
          }
        : null,
    }));
}

type PreparedExtractionCandidate = ParsedSelectionCandidate & {
  id: string;
  adapterId: string;
  claimedType: ReturnType<typeof parsedReferenceTypeToCanonical>;
  normalizedKeyFields: ReturnType<typeof buildNormalizedKeyFields>;
  containerHints: ReturnType<typeof buildContainerHints>;
  plausibility: ReturnType<typeof assessCandidatePlausibility>;
};

function finalizeSelectedParse(
  parsed: ParsedReference,
  referenceType: CanonicalReferenceType,
  detectTypeHint: CanonicalReferenceType | null,
  rawNormalized?: string,
): {
  parsed: ParsedReference;
  referenceType: CanonicalReferenceType;
  containerHints: ReturnType<typeof buildContainerHints>;
  typeResolution: ReturnType<typeof resolveReferenceTypeFromEvidence>;
  repairReasons: string[];
} {
  let nextReferenceType = referenceType;
  let resolvedContainer = resolveWinnerContainer(parsed, nextReferenceType);
  let nextParsed = resolvedContainer.parsed;
  let typeResolution = resolveReferenceTypeFromEvidence({
    claimedType: nextReferenceType,
    parsed: nextParsed,
    containerHints: resolvedContainer.containerHints,
    detectTypeHint,
  });
  nextReferenceType = typeResolution.referenceType;

  const repaired = repairSelectedParsedReference({
    parsed: nextParsed,
    referenceType: nextReferenceType,
  });
  nextParsed = repaired.parsed;
  nextReferenceType = repaired.referenceType;

  const conferenceResolved = resolveConferenceContainer({
    parsed: nextParsed,
    referenceType: nextReferenceType,
    rawNormalized,
  });
  nextParsed = conferenceResolved.parsed;
  nextReferenceType = conferenceResolved.referenceType;

  const reportResolved = resolveReportMetadata({
    parsed: nextParsed,
    referenceType: nextReferenceType,
    rawNormalized,
  });
  nextParsed = reportResolved.parsed;
  nextReferenceType = reportResolved.referenceType;

  const sanitized = sanitizeParsedReference(nextParsed, nextReferenceType);
  nextParsed = normalizeAuthorOptionalWebsiteParse(sanitized.parsed, sanitized.referenceType);
  resolvedContainer = resolveWinnerContainer(nextParsed, nextReferenceType);
  nextParsed = resolvedContainer.parsed;
  typeResolution = resolveReferenceTypeFromEvidence({
    claimedType: nextReferenceType,
    parsed: nextParsed,
    containerHints: resolvedContainer.containerHints,
    detectTypeHint,
  });

  return {
    parsed: nextParsed,
    referenceType: typeResolution.referenceType,
    containerHints: resolvedContainer.containerHints,
    typeResolution,
    repairReasons: Array.from(new Set([
      ...repaired.reasons,
      ...conferenceResolved.reasons,
      ...reportResolved.reasons,
    ])),
  };
}

function cleanTrailingUrl(url: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(url ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, '');
  if (!normalized) return undefined;
  const cleaned = normalized.replace(/[)\].,;:]+$/g, '');
  return /^www\./i.test(cleaned) ? `https://${cleaned}` : cleaned;
}

type ExtractedUrlSpan = {
  url: string;
  start: number;
  end: number;
};

const URL_CHAR_PATTERN = /[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/;

function extractUrlSpan(value: string): ExtractedUrlSpan | null {
  const startMatch = value.match(/https?:\/\/|www\./i);
  const start = startMatch?.index ?? -1;
  if (start < 0) return null;

  let cursor = start;
  let raw = '';
  while (cursor < value.length) {
    const char = value[cursor] ?? '';
    if (/\s/.test(char)) {
      let lookahead = cursor;
      while (lookahead < value.length && /\s/.test(value[lookahead] ?? '')) {
        lookahead += 1;
      }
      if (lookahead >= value.length) break;
      const nextToken = value.slice(lookahead).match(/^[^\s]+/)?.[0] ?? '';
      const nextChar = value[lookahead] ?? '';
      if (/^(?:accessed|viewed|available|retrieved|doi|vol|no|pp)\b/i.test(nextToken)) break;
      if (/[.]\s*$/.test(raw) && /^[A-Z]/.test(nextToken)) break;
      if (!URL_CHAR_PATTERN.test(nextChar)) break;
      raw += value.slice(cursor, lookahead);
      cursor = lookahead;
      continue;
    }

    if (!URL_CHAR_PATTERN.test(char)) break;
    raw += char;
    cursor += 1;
  }

  const url = cleanTrailingUrl(raw);
  return url ? { url, start, end: cursor } : null;
}

function removeUrlSpan(value: string, span: ExtractedUrlSpan | null): string {
  if (!span) return value;
  return normalizeWhitespace(`${value.slice(0, span.start)} ${value.slice(span.end)}`);
}

function deriveDoiHintFromUrl(value: string | undefined): string | undefined {
  const url = cleanTrailingUrl(value);
  if (!url) return undefined;

  const embeddedDoi = url.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i)?.[0];
  if (embeddedDoi) {
    return normalizeDoiValue(embeddedDoi);
  }

  try {
    const parsed = new URL(url);
    if (/^(?:dx\.)?doi\.org$/i.test(parsed.hostname) && parsed.pathname.length > 1) {
      return normalizeDoiValue(parsed.href);
    }

    if (/(^|\.)nature\.com$/i.test(parsed.hostname)) {
      const articleId = parsed.pathname.match(/\/articles\/([^/?#]+)/i)?.[1];
      if (articleId) {
        return normalizeDoiValue(`10.1038/${articleId}`);
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function looksInitialOnlyAuthorValue(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '').replace(/\s+/g, '');
  if (!normalized) return false;
  return /^[A-Z](?:\.?[A-Z]){0,5}\.?$/i.test(normalized);
}

function titleEndsWithWeakTail(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return /\b(?:a|an|and|as|at|by|for|from|in|into|of|on|or|the|through|to|using|via|with)$/i.test(normalized);
}

function looksLikeUrlLedWebsitePseudoAuthorParse(parsed: ParsedReference, referenceType?: string): boolean {
  if ((referenceType ?? 'unknown') !== 'website' || !parsed.url) return false;
  if (!parsed.authors?.length) return false;
  if (hasParsedVenue(parsed) || parsed.publisher || parsed.institution || parsed.volume || parsed.issue) return false;
  if (isLocatorLike(parsed.pages ?? parsed['article-number'])) return false;

  const initialsOnlyCount = (parsed.authors ?? []).filter((author) => looksInitialOnlyAuthorValue(author)).length;
  if (initialsOnlyCount === 0) return false;

  return initialsOnlyCount === (parsed.authors?.length ?? 0)
    || ((parsed.authors?.length ?? 0) === 1 && titleEndsWithWeakTail(parsed.title));
}

function extractLastYear(value: string): string | undefined {
  const matches = [...value.matchAll(YEAR_PATTERN)];
  return matches.length > 0 ? matches[matches.length - 1]?.[0] : undefined;
}

function normalizeParsedYear(value: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return undefined;
  return extractLastYear(normalized) ?? normalized;
}

function stripTrailingPeriod(value: string): string {
  return normalizeWhitespace(value.replace(/[.]+$/g, ''));
}

function stripLeadingPunctuation(value: string): string {
  return normalizeWhitespace(value.replace(/^[\s,.;:()[\]{}"'-]+/, ''));
}

function rebalanceContainerBrackets(value: string): string {
  let cleaned = normalizeWhitespace(value);
  if (!cleaned) return cleaned;

  if (/^(?:19|20)\d{2}\](?=\s+\p{L})/u.test(cleaned)) {
    cleaned = cleaned.replace(/^((?:19|20)\d{2})\](?=\s+\p{L})/u, '[$1]');
  }

  const openParens = (cleaned.match(/\(/g) ?? []).length;
  const closeParens = (cleaned.match(/\)/g) ?? []).length;
  if (openParens > closeParens) {
    cleaned = `${cleaned}${')'.repeat(openParens - closeParens)}`;
  }

  const openBrackets = (cleaned.match(/\[/g) ?? []).length;
  const closeBrackets = (cleaned.match(/\]/g) ?? []).length;
  if (openBrackets > closeBrackets) {
    cleaned = `${cleaned}${']'.repeat(openBrackets - closeBrackets)}`;
  }

  return cleaned;
}

function cleanContainerTitle(value: string): string {
  return rebalanceContainerBrackets(normalizeWhitespace(
    stripLeadingPunctuation(
      stripTrailingPeriod(
        value
          .replace(/(\p{L})-\s+(\p{L})/gu, '$1$2')
          .replace(/\bdoi:\s*/i, '')
          .replace(DOI_PATTERN, '')
          .replace(URL_PATTERN, '')
          .replace(IN_SOURCE_LOCATOR_PATTERN, '')
          .replace(/\(\s*\)|\[\s*\]/g, ' ')
          .replace(/^[,;:\s]+|[,;:\s]+$/g, ''),
      ),
    ),
  ));
}

function splitSentenceSegments(value: string): string[] {
  const protectedUrls: string[] = [];
  const protectedValue = value.replace(URL_PATTERN_GLOBAL, (match) => {
    const index = protectedUrls.push(match) - 1;
    return `__URL_${index}__`;
  });

  return protectedValue
    .split(/\.\s+/)
    .map((segment) => segment.replace(/__URL_(\d+)__/g, (_, index) => protectedUrls[Number(index)] ?? ''))
    .map((segment) => stripTrailingPeriod(segment))
    .filter(Boolean);
}

function looksLikeInstitutionalAcronymToken(token: string): boolean {
  const normalized = normalizeWhitespace(token).replace(/[().,;:]+$/g, '');
  if (!normalized) return false;
  if (normalized.includes('.')) return false;
  if (/^[A-Z]{2,10}$/.test(normalized)) return true;
  if (!/^[A-Z0-9][A-Za-z0-9+-]*$/.test(normalized)) return false;
  const upperCount = Array.from(normalized).filter((char) => /[A-Z]/.test(char)).length;
  const lowerCount = Array.from(normalized).filter((char) => /[a-z]/.test(char)).length;
  return lowerCount > 0 && upperCount >= 3;
}

function looksLikeInstitutionalLead(segment: string): boolean {
  const normalized = normalizeWhitespace(segment);
  if (!normalized) return false;
  if (looksLikeAlternatingTokenArray(normalized.split(/\s+/))) return false;
  if (PERSONAL_AUTHOR_LEAD_PATTERN.test(normalized) && /,\s*[A-Z](?:[.-]?[A-Z]){0,5}\.?/.test(normalized)) return false;
  if (isGroupAuthor(normalized)) return true;
  if (INSTITUTIONAL_KEYWORD_PATTERN.test(normalized) && normalized.split(/\s+/).length >= 2) return true;
  if (/^[A-Z0-9][A-Za-z0-9.+-]*$/.test(normalized)) return true;
  if (normalized.split(/\s+/).length <= 4 && normalized.split(/\s+/).some((token) => looksLikeInstitutionalAcronymToken(token))) return true;
  const connectiveTokens = new Set(['and', 'for', 'of', 'the', 'in', 'on', 'at', 'to', 'de', 'del', 'la', 'le', 'van', 'von']);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const titleCaseOrConnectorTokens = tokens.filter((token) => (
    connectiveTokens.has(token.toLowerCase())
    || /^[A-Z0-9][A-Za-z0-9.+-]*$/.test(token)
    || looksLikeInstitutionalAcronymToken(token)
  )).length;
  return tokens.length >= 3
    && titleCaseOrConnectorTokens >= Math.max(2, tokens.length - 1)
    && !/[A-Z]\.$/.test(normalized);
}

function looksLikeSourceTailFragment(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return /^available from:/i.test(normalized)
    || Boolean(URL_PATTERN.test(normalized))
    || PLACE_PUBLISHER_YEAR_PATTERN.test(normalized)
    || PLACE_YEAR_PATTERN.test(normalized)
    || ARXIV_SEGMENT_PATTERN.test(normalized);
}

function looksLikeInstitutionalAuthorList(authors: string[] | undefined): boolean {
  if (!authors || authors.length === 0) return false;
  return authors.every((author) => looksLikeInstitutionalLead(author));
}

function normalizeInstitutionalAuthor(value: string): string {
  const normalized = normalizeWhitespace(value);
  return isGroupAuthor(normalized) ? normalizeGroupAuthor(normalized) : normalized;
}

function buildInstitutionalLiteralAuthor(value: string) {
  const literal = normalizeInstitutionalAuthor(value);
  return {
    first: null,
    last: literal,
    initials: null,
    literal,
  };
}

function looksLikeInstitutionalMetadataSegment(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return EDITION_SEGMENT_PATTERN.test(normalized)
    || IDENTIFIER_SEGMENT_PATTERN.test(normalized)
    || BRACKETED_IDENTIFIER_PATTERN.test(normalized);
}

function looksLikeInstitutionalVenueLeak(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  return /\b(?:report\s+no\.?|available(?:\s+at|\s+from)?|accessed|viewed|\[online\]|version|ver\.?)\b/i.test(normalized)
    || PLACE_PUBLISHER_PATTERN.test(stripTrailingPeriod(normalized))
    || PLACE_PUBLISHER_YEAR_PATTERN.test(stripTrailingPeriod(normalized));
}

function looksLikeAuthorEchoTitle(parsed: ParsedReference): boolean {
  const title = normalizeWhitespace(parsed.title ?? '').toLowerCase();
  const firstAuthor = normalizeWhitespace(parsed.authors?.[0] ?? '').toLowerCase();
  if (!title || !firstAuthor) return false;
  const normalizedAuthor = firstAuthor.replace(/,.+$/g, '');
  return title === normalizedAuthor || title.startsWith(`${normalizedAuthor}.`);
}

function looksLikeLocatorOnlyTitle(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '').replace(/^[:;,.()\[\]\s-]+/, '');
  if (!normalized) return false;
  const compact = normalizeWhitespace(
    normalized
      .replace(/^article\s+/i, '')
      .replace(/^(?:pp?\.?|pages?|doi)\s*/i, '')
      .replace(/\bdoi\b\.?$/i, '')
      .replace(/[()]/g, ' ')
      .trim(),
  );
  if (!compact) return false;
  if (/^(?:pp?\.?\s*)?[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?(?:\.\s*doi\.?)?$/i.test(normalized)) {
    return true;
  }
  const compactTokens = compact
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !/^(?:pp?\.?|pages?|doi)$/i.test(token));
  return compactTokens.length <= 3
    && compactTokens.every((token) => isLocatorLike(token) || /^[A-Za-z]?\d{2,}[A-Za-z.-]*$/i.test(token));
}

function looksLikeSerialVenueTail(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return false;
  if (/\b(?:journal|proceedings|conference|symposium|workshop|endoscopy|science signaling)\b/i.test(normalized)) {
    return true;
  }
  if (/\bpp?\.?\s*[A-Za-z]?\d/i.test(normalized)) return true;
  if (/\bvol\.?\s*\d+/i.test(normalized)) return true;
  if (/^\d+(?:\([A-Za-z0-9-]+\))?(?::[A-Za-z]?\d+(?:[-–][A-Za-z]?\d+)?)?$/i.test(normalized)) return true;
  return /^[^.;]+,\s*\d+(?:\([A-Za-z0-9-]+\))?(?:,\s*pp?\.?\s*[A-Za-z]?\d+(?:[-–][A-Za-z]?\d+)?)?$/i.test(normalized);
}

function extractLeadAuthorFromQuotedLead(value: string): string[] | undefined {
  const normalized = normalizeWhitespace(stripTrailingPeriod(value));
  const mixedLeadMatch = normalized.match(/^(?<first>[^,]+,\s*[^,]+),\s*(?:and|&)\s+(?<second>.+)$/i);
  if (mixedLeadMatch?.groups) {
    const firstAuthor = normalizeWhitespace(mixedLeadMatch.groups.first);
    const secondAuthor = normalizeIeeeFullNameAuthorSegment(mixedLeadMatch.groups.second);
    if (firstAuthor && secondAuthor && secondAuthor.includes(',')) {
      return [firstAuthor, secondAuthor];
    }
  }

  const parts = normalized.split(',').map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (parts.length < 2) return undefined;
  const surname = parts[0];
  const given = parts[1].replace(/\bet\s+al\.?$/i, '').trim();
  if (!surname || !given) return undefined;
  if (surname.split(/\s+/).length > 5 || given.split(/\s+/).length > 6) return undefined;
  return [`${surname}, ${given}`];
}

function hasMlaMixedQuotedLead(value: string): boolean {
  const normalized = normalizeWhitespace(
    value.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, ''),
  );
  return /^[\p{Lu}][\p{L}'’-]+(?:\s+(?:da|de|del|della|der|di|dos|du|la|le|van|von)\s+[\p{Lu}][\p{L}'’-]+){0,2},\s+[^,]+,\s+and\s+[\p{Lu}]/u.test(normalized);
}

function hasChicagoSingleQuotedLead(value: string): boolean {
  const normalized = normalizeWhitespace(
    stripTrailingPeriod(value).replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, ''),
  );
  return /^[\p{Lu}][\p{L}'’-]+(?:\s+(?:da|de|del|della|der|di|dos|du|la|le|van|von)\s+[\p{Lu}][\p{L}'’-]+){0,2},\s+[^,]+$/u.test(normalized);
}

function repairAlternatingParsedAuthorArray(authors: string[] | undefined): string[] | null {
  if (!authors || authors.length < 4 || authors.length % 2 !== 0) return null;

  const normalizedTokens = authors
    .map((author) => normalizeWhitespace(stripLeadingAuthorConjunction(author).replace(/^[,;]+|[,;]+$/g, '')))
    .filter(Boolean)
    .map((author) => author.replace(/\b([\p{Lu}])$/u, '$1.'));

  if (normalizedTokens.length !== authors.length) return null;

  const pairedAuthors: string[] = [];
  for (let index = 0; index < normalizedTokens.length; index += 2) {
    const surname = normalizedTokens[index] ?? '';
    const given = normalizedTokens[index + 1] ?? '';
    const givenTokens = normalizeWhitespace(given).split(/\s+/).filter(Boolean);
    if (
      !looksLikeSurnameLeadSegment(surname)
      || givenTokens.length === 0
      || givenTokens.length > 4
      || !givenTokens.every((token, tokenIndex) => looksLikeFullNameOrInitialToken(token, tokenIndex, givenTokens.length))
    ) {
      return null;
    }
    pairedAuthors.push(`${surname}, ${given}`);
  }

  return pairedAuthors;
}

function looksLikeSurnameLeadSegment(segment: string): boolean {
  const normalized = normalizeWhitespace(segment);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.length >= 1
    && tokens.length <= 3
    && tokens.every((token) => /^(?:[\p{Lu}][\p{L}'’-]+|d'[\p{L}'’-]+)$/u.test(token));
}

function looksLikeFullNameToken(token: string, index: number, length: number): boolean {
  if (!token) return false;
  if (/^(?:da|de|del|della|der|di|dos|du|la|le|van|von)$/i.test(token)) {
    return index > 0 && index < length - 1;
  }
  return /^(?:[\p{Lu}][\p{L}'’-]+|d'[\p{Lu}][\p{L}'’-]+)$/u.test(token);
}

function looksLikeFullNameOrInitialToken(token: string, index: number, length: number): boolean {
  if (!token) return false;
  if (/^(?:[\p{Lu}]\.){1,4}$/u.test(token) || /^[\p{Lu}]\.?$/u.test(token)) {
    return true;
  }
  return looksLikeFullNameToken(token, index, length);
}

function stripLeadingAuthorConjunction(segment: string): string {
  return normalizeWhitespace(segment.replace(/^(?:and|&)\s+/i, ''));
}

function looksLikeGivenNameSegment(segment: string): boolean {
  const normalized = normalizeWhitespace(segment);
  if (!normalized || /[.]/.test(normalized)) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.length >= 1
    && tokens.length <= 4
    && tokens.every((token, index) => looksLikeFullNameToken(token, index, tokens.length));
}

function looksLikeFullNameAuthorSegment(segment: string): boolean {
  const normalized = normalizeWhitespace(segment);
  if (!normalized || normalized.includes(',')) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.length >= 2
    && tokens.length <= 5
    && tokens.every((token, index) => looksLikeFullNameToken(token, index, tokens.length));
}

function parseIeeeInitialLeadingCompoundSurnameSegment(segment: string): {
  initial: string;
  middle: string;
  last: string;
} | null {
  const normalized = normalizeWhitespace(segment);
  if (!normalized || normalized.includes(',')) return null;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length !== 3) return null;
  if (!/^(?:[\p{Lu}]\.){1,4}$/u.test(tokens[0] ?? '') && !/^[\p{Lu}]\.?$/u.test(tokens[0] ?? '')) return null;
  if (!/^[\p{Lu}][\p{L}'’-]+$/u.test(tokens[1] ?? '')) return null;
  if (!/^[\p{Lu}][\p{L}'’-]+$/u.test(tokens[2] ?? '')) return null;
  return {
    initial: tokens[0] ?? '',
    middle: tokens[1] ?? '',
    last: tokens[2] ?? '',
  };
}

function repairIeeeCompoundSurnameSeries(segments: string[]): string[] {
  const parsedCandidates = segments.map((segment) => parseIeeeInitialLeadingCompoundSurnameSegment(segment));
  const trailingTokenCounts = parsedCandidates.reduce<Map<string, number>>((counts, candidate) => {
    if (!candidate) return counts;
    counts.set(candidate.last.toLowerCase(), (counts.get(candidate.last.toLowerCase()) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const repeatedTrailingFamilyCount = Array.from(trailingTokenCounts.values()).filter((count) => count >= 2).length;
  if (repeatedTrailingFamilyCount === 0) return segments;

  return segments.map((segment, index) => {
    const candidate = parsedCandidates[index];
    if (!candidate) return segment;
    return `${candidate.middle} ${candidate.last}, ${candidate.initial}`;
  });
}

function splitIeeeAuthorSegments(value: string): string[] {
  const normalized = normalizeWhitespace(value)
    .replace(/,\s+and\s+/i, ', ')
    .replace(/\s+and\s+/gi, ', ')
    .split(/\s*,\s*/)
    .map((segment) => stripLeadingAuthorConjunction(segment.replace(/[.;]+$/g, '')))
    .filter(Boolean);
  const seriesRepaired = repairIeeeCompoundSurnameSeries(normalized);

  if (
    seriesRepaired.length >= 3
    && seriesRepaired.length <= 8
    && (seriesRepaired[0]?.split(/\s+/).filter(Boolean).length ?? 0) === 1
    && looksLikeSurnameLeadSegment(seriesRepaired[0] ?? '')
    && looksLikeGivenNameSegment(seriesRepaired[1] ?? '')
    && seriesRepaired.slice(2).every((segment) => looksLikeFullNameAuthorSegment(segment))
  ) {
    return [
      `${seriesRepaired[0]}, ${seriesRepaired[1]}`,
      ...seriesRepaired.slice(2),
    ].map((segment) => normalizeIeeeFullNameAuthorSegment(segment));
  }

  if (
    seriesRepaired.length >= 4
    && seriesRepaired.length <= 10
    && (seriesRepaired[0]?.split(/\s+/).filter(Boolean).length ?? 0) === 1
    && looksLikeSurnameLeadSegment(seriesRepaired[0] ?? '')
    && looksLikeGivenNameSegment(seriesRepaired[1] ?? '')
    && seriesRepaired.slice(2).every((segment) => looksLikeFullNameAuthorSegment(segment))
  ) {
    return [
      `${seriesRepaired[0]}, ${seriesRepaired[1]}`,
      ...seriesRepaired.slice(2),
    ].map((segment) => normalizeIeeeFullNameAuthorSegment(segment));
  }

  return seriesRepaired.map((segment) => normalizeIeeeFullNameAuthorSegment(segment));
}

function normalizeIeeeFullNameAuthorSegment(segment: string): string {
  const normalized = stripLeadingAuthorConjunction(
    normalizeWhitespace(segment.replace(/^[,;]+|[,;]+$/g, '').replace(/[.;]+$/g, '')),
  );
  if (!normalized || normalized.includes(',')) return normalized;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const hasInitialToken = tokens.some((token) => /^(?:[\p{Lu}]\.){1,4}$/u.test(token) || /^[\p{Lu}]\.?$/u.test(token));
  if (isGroupAuthor(normalized) && !hasInitialToken) return normalized;
  if (tokens.length < 2) return normalized;
  const compactInitialsFirst = parseInitialsFirstAuthor(normalized);
  if (
    compactInitialsFirst
    && !(
      tokens.length === 3
      && (/^(?:[\p{Lu}]\.){1,4}$/u.test(tokens[0] ?? '') || /^[\p{Lu}]\.?$/u.test(tokens[0] ?? ''))
      && /^[\p{Lu}][\p{L}'’-]+$/u.test(tokens[1] ?? '')
      && /^[\p{Lu}][\p{L}'’-]+$/u.test(tokens[2] ?? '')
    )
  ) {
    return normalized;
  }
  if (!tokens.every((token, index) => looksLikeFullNameOrInitialToken(token, index, tokens.length))) return normalized;

  const lastToken = tokens[tokens.length - 1] ?? '';
  const middleToken = tokens[1] ?? '';
  const lastLooksPatronymic = /(?:ovich|evich|vich|ich|ovna|evna)$/i.test(lastToken);
  const middleIsInitial = /^(?:[\p{Lu}]\.){1,4}$/u.test(middleToken) || /^[\p{Lu}]\.?$/u.test(middleToken);

  if (
    tokens.length === 3
    && middleIsInitial
  ) {
    return `${tokens[2]}, ${tokens[0]} ${tokens[1]}`;
  }

  if (
    tokens.length === 3
    && lastLooksPatronymic
    && tokens.every((token, index) => looksLikeFullNameOrInitialToken(token, index, tokens.length))
  ) {
    return `${tokens[2]}, ${tokens[0]} ${tokens[1]}`;
  }

  if (
    tokens.length === 3
    && tokens.every((token) => /^(?:[\p{Lu}][\p{L}'’-]+|d'[\p{Lu}][\p{L}'’-]+)$/u.test(token))
  ) {
    return `${tokens[1]} ${tokens[2]}, ${tokens[0]}`;
  }

  let surnameStartIndex = tokens.length - 1;
  while (surnameStartIndex > 1 && /^(?:da|de|del|della|der|di|dos|du|la|le|van|von)$/i.test(tokens[surnameStartIndex - 1] ?? '')) {
    surnameStartIndex -= 1;
  }

  const givenTokens = tokens.slice(0, surnameStartIndex);
  const surnameTokens = tokens.slice(surnameStartIndex);
  if (givenTokens.length === 0 || surnameTokens.length === 0) return normalized;

  return `${surnameTokens.join(' ')}, ${givenTokens.join(' ')}`;
}

function splitIeeeQuotedReference(normalized: string): {
  authorsLead: string;
  title: string;
  tail: string;
} | null {
  const trimmed = normalizeWhitespace(normalized.replace(/^(?:\[\d+\]\s*|\d+\.\s*)/, ''));
  const firstQuoteIndex = trimmed.indexOf('"');
  if (firstQuoteIndex <= 0) return null;

  const authorsLead = normalizeWhitespace(trimmed.slice(0, firstQuoteIndex).replace(/,\s*$/, ''));
  if (!authorsLead) return null;

  for (let index = trimmed.length - 1; index > firstQuoteIndex; index -= 1) {
    if (trimmed[index] !== '"') continue;
    const title = stripTrailingPeriod(trimmed.slice(firstQuoteIndex + 1, index));
    const tail = normalizeWhitespace(trimmed.slice(index + 1).replace(/^[,.;\s]+/, ''));
    if (!title || !tail) continue;
    if (/^by\b/i.test(tail)) continue;
    if (!/\b(?:1[5-9]\d{2}|20\d{2})\b/.test(tail)) continue;
    if (!/\b(?:in\b|vol\.?|no\.?|pp?\.?|doi:?)\b/i.test(tail)) continue;
    return { authorsLead, title, tail };
  }

  return null;
}

function stripIeeeTailSignals(value: string): {
  core: string;
  doi?: string;
  url?: string;
} {
  let core = normalizeWhitespace(value);
  const doiMatch = core.match(DOI_PATTERN);
  const urlMatch = core.match(URL_PATTERN);
  const doi = doiMatch
    ? closeUnbalancedTrailingParentheses(normalizeDoiValue(doiMatch[0]))
    : undefined;
  const url = urlMatch ? cleanTrailingUrl(urlMatch[0]) : undefined;

  if (doiMatch) core = normalizeWhitespace(core.replace(doiMatch[0], ''));
  if (urlMatch) core = normalizeWhitespace(core.replace(urlMatch[0], ''));
  core = normalizeWhitespace(
    core
      .replace(/\bdoi\s*:?\s*$/i, '')
      .replace(/[.,;:\s]+$/g, ''),
  );

  return { core, doi, url };
}

function parseTrailingYear(value: string): { year: string; index: number } | null {
  const matches = [...value.matchAll(/\b(?:1[5-9]\d{2}|20\d{2})\b/g)];
  const last = matches.at(-1);
  if (!last || last.index == null) return null;
  return { year: last[0], index: last.index };
}

function closeUnbalancedTrailingParentheses(value: string): string {
  const normalized = normalizeWhitespace(value);
  const openCount = (normalized.match(/\(/g) ?? []).length;
  const closeCount = (normalized.match(/\)/g) ?? []).length;
  return openCount > closeCount ? `${normalized}${')'.repeat(openCount - closeCount)}` : normalized;
}

function finalizeIeeeQuotedTitle(rawReference: string, title: string): string {
  const normalizedTitle = normalizeWhitespace(title.replace(/,\s*$/g, ''));
  if (!normalizedTitle) return normalizedTitle;
  const balanced = closeUnbalancedTrailingParentheses(normalizedTitle);
  if (balanced !== normalizedTitle) return balanced;
  if (
    /\b(?:No\.?\s*\d+|Vol\.?\s*\d+)$/.test(normalizedTitle)
    && rawReference.includes(`${normalizedTitle})`)
  ) {
    return `${normalizedTitle})`;
  }
  return normalizedTitle;
}

function normalizeIeeeContainerRemainder(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/(?:,\s*){2,}/g, ', ')
      .replace(/[.,;:\s]+\b(?:doi|available)\s*:?\s*$/i, '')
      .replace(/[)\].,;:\s]+$/g, '')
      .replace(/^[,.;:\s]+/g, ''),
  );
}

function splitPossiblePlaceFromConferenceTitle(value: string): {
  conferenceTitle: string;
  placeOfPublication?: string;
} {
  const cleaned = cleanContainerTitle(normalizeIeeeContainerRemainder(value));
  if (!cleaned.includes(',')) return { conferenceTitle: cleaned };

  const parts = cleaned.split(',').map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (parts.length < 2) return { conferenceTitle: cleaned };

  const trailingCountry = parts[parts.length - 1] ?? '';
  const trailingCity = parts[parts.length - 2] ?? '';
  if (
    parts.length >= 3
    && PLACE_SEGMENT_PATTERN.test(trailingCity)
    && PLACE_SEGMENT_PATTERN.test(trailingCountry)
  ) {
    return {
      conferenceTitle: cleanContainerTitle(parts.slice(0, -2).join(', ')),
      placeOfPublication: `${trailingCity}, ${trailingCountry}`,
    };
  }

  const placeCandidate = parts[parts.length - 1] ?? '';
  if (!PLACE_SEGMENT_PATTERN.test(placeCandidate)) {
    return { conferenceTitle: cleaned };
  }

  return {
    conferenceTitle: cleanContainerTitle(parts.slice(0, -1).join(', ')),
    placeOfPublication: placeCandidate,
  };
}

function looksLikeProceedingsVolumeContainer(value: string, locator: string | undefined): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (!/^volume\s+\d+\s*:/i.test(normalized)) return false;
  const locatorKind = classifyLocatorToken(locator ?? '').kind;
  return locatorKind === 'article-number'
    || /\b(?:conference|symposium|workshop|proceedings|systems|subsea)\b/i.test(normalized);
}

function buildIeeeQuotedReferenceCandidate(normalized: string): ParsedSelectionCandidate | null {
  const parts = splitIeeeQuotedReference(normalized);
  if (!parts) return null;
  if (/\bedited by\b/i.test(parts.tail)) return null;
  const quotedLeadLooksMla = hasMlaMixedQuotedLead(parts.authorsLead);
  const quotedLeadLooksChicago = !quotedLeadLooksMla
    && hasChicagoSingleQuotedLead(parts.authorsLead)
    && !/\bvol\.?\s*\d+/i.test(normalized)
    && !/\bpp?\.?\s*[A-Za-z]?\d+/i.test(normalized);

  const authors = splitIeeeAuthorSegments(parts.authorsLead)
    .map((segment) => {
      const normalizedSegment = normalizeWhitespace(segment);
      const repairedSegment = normalizeIeeeFullNameAuthorSegment(normalizedSegment);
      const hasExpandedGivenName = /,\s*[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){0,3}$/u.test(repairedSegment);
      return hasExpandedGivenName
        ? (parseAuthorToCanonical(repairedSegment) ?? parseInitialsFirstAuthor(repairedSegment))
        : (parseInitialsFirstAuthor(repairedSegment) ?? parseAuthorToCanonical(repairedSegment));
    })
    .map((author) => renderAuthor(author))
    .filter(Boolean);
  if (authors.length === 0 || !parts.title) return null;

  const strippedTail = stripIeeeTailSignals(parts.tail);
  const locatorMatch = strippedTail.core.match(
    /\bpp?\.?\s*(?<pages>[A-Za-z]?\d[\w.-]*(?:\s*[-–]\s*[A-Za-z]?\d[\w.-]*)?)\b/i,
  );
  const pages = normalizeWhitespace(locatorMatch?.groups?.pages ?? '').replace(/\s*[-–]\s*/g, '-');
  const tailWithoutPages = locatorMatch
    ? normalizeWhitespace(`${strippedTail.core.slice(0, locatorMatch.index)} ${strippedTail.core.slice((locatorMatch.index ?? 0) + locatorMatch[0].length)}`)
    : strippedTail.core;
  const yearMatch = parseTrailingYear(tailWithoutPages);
  if (!yearMatch) return null;

  const year = normalizeParsedYear(yearMatch.year);
  const containerBeforeYear = normalizeIeeeContainerRemainder(
    `${tailWithoutPages.slice(0, yearMatch.index)} ${tailWithoutPages.slice(yearMatch.index + yearMatch.year.length)}`
  );
  if (!year || !containerBeforeYear) return null;

  const conferenceLead = /^in\b/i.test(containerBeforeYear)
    ? normalizeIeeeContainerRemainder(containerBeforeYear.replace(/^in\s+/i, ''))
    : containerBeforeYear;
  if (
    /^in\b/i.test(containerBeforeYear)
    || proceedingsSignal(conferenceLead)
    || looksLikeProceedingsVolumeContainer(conferenceLead, pages)
  ) {
    const conferenceSegments = conferenceLead
      .split(/\.\s+/)
      .map((segment) => cleanContainerTitle(segment))
      .filter(Boolean);
    let publisher: string | undefined;
    if (conferenceSegments.length >= 2) {
      const trailingSegment = conferenceSegments[conferenceSegments.length - 1];
      if (trailingSegment && (/^[A-Z]{2,10}$/.test(trailingSegment) || looksLikePublisherSegment(trailingSegment))) {
        publisher = cleanContainerTitle(conferenceSegments.pop());
      }
    }
    const splitConference = splitPossiblePlaceFromConferenceTitle(
      normalizeIeeeContainerRemainder(conferenceSegments.join('. ')),
    );
    if (!splitConference.conferenceTitle) return null;
    let conferenceTitle = normalizeConferenceContainer(
      splitConference.conferenceTitle.split(/\s*,\s*/).map((segment) => cleanContainerTitle(segment)).filter(Boolean),
    ) ?? splitConference.conferenceTitle;
    const proceedingsTail = extractProceedingsTailSegment(parts.tail) ?? extractProceedingsTailSegment(tailWithoutPages);
    if (
      proceedingsTail
      && !proceedingsSignal(conferenceTitle)
      && !normalizeWhitespace(conferenceTitle).toLowerCase().includes(proceedingsTail.toLowerCase())
    ) {
      conferenceTitle = normalizeWhitespace(`${conferenceTitle}. ${proceedingsTail}`);
    }
    if (!publisher) {
      const splitConferencePublisher = splitTrailingPublisherFromConferenceTitle(conferenceTitle);
      conferenceTitle = splitConferencePublisher.conferenceTitle;
      publisher = splitConferencePublisher.publisher;
    }

    const parsed: ParsedReference = {
      authors,
      title: finalizeIeeeQuotedTitle(normalized, stripTrailingPeriod(parts.title)),
      conferenceTitle,
      placeOfPublication: splitConference.placeOfPublication,
      year,
      pages: pages || undefined,
      publisher,
      doi: strippedTail.doi,
      url: strippedTail.url,
      parseWarnings: ['ieee-quoted-reference-heuristic'],
    };

    return {
      branch: 'deterministic_raw',
      normalized,
      parsed,
      referenceType: 'conference',
      warnings: parsed.parseWarnings ?? [],
      styleUsed: 'ieee',
      styleConfidence: 0.96,
    };
  }

  let journalLead = containerBeforeYear;
  const issueMatch = journalLead.match(/\bno\.?\s*(?<issue>[^,]+)\b/i);
  const issue = normalizeWhitespace(issueMatch?.groups?.issue ?? '');
  if (issueMatch) {
    journalLead = normalizeIeeeContainerRemainder(journalLead.replace(issueMatch[0], ''));
  }

  const volumeMatch = journalLead.match(/\bvol\.?\s*(?<volume>[^,]*)/i);
  const volume = normalizeWhitespace(volumeMatch?.groups?.volume ?? '');
  if (volumeMatch) {
    journalLead = normalizeIeeeContainerRemainder(journalLead.replace(volumeMatch[0], ''));
  }

  const journal = cleanContainerTitle(normalizeIeeeContainerRemainder(journalLead));
  if (!journal) return null;

  const locatorKind = classifyLocatorToken(pages).kind;
  const parsed: ParsedReference = {
    authors,
    title: finalizeIeeeQuotedTitle(normalized, stripTrailingPeriod(parts.title)),
    journal,
    volume: volume || undefined,
    issue: issue || undefined,
    year,
    pages: locatorKind === 'pages' ? pages || undefined : undefined,
    'article-number': locatorKind === 'article-number' ? pages || undefined : undefined,
    doi: strippedTail.doi,
    url: strippedTail.url,
    parseWarnings: ['ieee-quoted-reference-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: parsed.parseWarnings ?? [],
    styleUsed: quotedLeadLooksMla ? 'mla' : (quotedLeadLooksChicago ? 'chicago' : 'ieee'),
    styleConfidence: quotedLeadLooksMla || quotedLeadLooksChicago ? 0.93 : 0.96,
  };
}

function buildQuotedTitleJournalLocatorCandidate(normalized: string): {
  normalized: string;
  parsed: ParsedReference;
  referenceType: ReturnType<typeof parsedReferenceTypeToCanonical>;
  warnings: string[];
} | null {
  const match = normalized.match(QUOTED_JOURNAL_LOCATOR_PATTERN);
  if (!match?.groups) return null;

  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = normalizeWhitespace(match.groups.journal ?? '');
  const volume = normalizeWhitespace(match.groups.volume ?? '');
  const issue = normalizeWhitespace(match.groups.issue ?? '');
  const year = normalizeWhitespace(match.groups.year ?? '');
  const locator = normalizeWhitespace(match.groups.locator ?? '').replace(/\s*[-–]\s*/g, '-');
  if (!title || !journal || !volume || !year || !locator) return null;

  const locatorKind = classifyLocatorToken(locator).kind;
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doiMatch = tail.match(DOI_PATTERN);
  const urlMatch = tail.match(URL_PATTERN);
  const parsed: ParsedReference = {
    authors: extractLeadAuthorFromQuotedLead(match.groups.authors ?? ''),
    title,
    journal,
    volume,
    issue: issue || undefined,
    year,
    pages: locator || undefined,
    'article-number': locatorKind === 'article-number' ? locator : undefined,
    doi: doiMatch ? normalizeDoiValue(doiMatch[0]) : undefined,
    url: urlMatch ? cleanTrailingUrl(urlMatch[0]) : undefined,
    parseWarnings: ['quoted-title-journal-locator-heuristic'],
  };

  return {
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: parsed.parseWarnings ?? [],
  };
}

function buildCompactJournalTailCandidate(normalized: string): {
  normalized: string;
  parsed: ParsedReference;
  referenceType: ReturnType<typeof parsedReferenceTypeToCanonical>;
  warnings: string[];
} | null {
  const match = normalized.match(COMPACT_JOURNAL_TAIL_PATTERN);
  if (!match?.groups) return null;

  const leadSegments = normalizeWhitespace(match.groups.lead ?? '')
    .split(/\s*,\s*/)
    .map((segment) => cleanContainerTitle(segment))
    .filter(Boolean);
  if (leadSegments.length < 4) return null;

  const journal = cleanContainerTitle(leadSegments[leadSegments.length - 1] ?? '');
  let title = stripTrailingPeriod(leadSegments[leadSegments.length - 2] ?? '');
  let authors = leadSegments.slice(0, -2).map((segment) => normalizeWhitespace(segment)).filter(Boolean);
  const likelyCompactAuthor = (value: string) => (
    looksLikeCompactVancouverAuthorString(value)
    || /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2}\s+[A-Z]{1,4}$/.test(value)
  );
  if (authors.length >= 3) {
    const recoveredAuthors: string[] = [];
    const recoveredTitleSegments: string[] = [];
    for (const segment of leadSegments.slice(0, -1)) {
      if (recoveredTitleSegments.length === 0 && likelyCompactAuthor(segment)) {
        recoveredAuthors.push(normalizeWhitespace(segment));
        continue;
      }
      recoveredTitleSegments.push(normalizeWhitespace(segment));
    }
    const splitTail = recoveredTitleSegments[0]?.match(/^(?<author>[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2}\s+[A-Z]{1,4})\.\s+(?<rest>.+)$/);
    if (splitTail?.groups?.author && splitTail.groups.rest) {
      recoveredAuthors.push(normalizeWhitespace(splitTail.groups.author));
      recoveredTitleSegments[0] = normalizeWhitespace(splitTail.groups.rest);
    }
    if (recoveredAuthors.length >= 4 && recoveredTitleSegments.length > 0) {
      authors = recoveredAuthors;
      title = stripTrailingPeriod(recoveredTitleSegments.join(', '));
    }
  }
  if (!journal || !title || authors.length === 0) return null;
  if (!authors.every((author) => looksLikeCompactVancouverAuthorString(author) || /^(?:[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2}|[A-Z][A-Za-z'’.-]+\s+[A-Z]{1,4})$/.test(author))) {
    return null;
  }

  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doiMatch = tail.match(DOI_PATTERN);
  const urlMatch = tail.match(URL_PATTERN);
  const parsed: ParsedReference = {
    authors,
    title,
    journal,
    year: normalizeParsedYear(match.groups.year),
    volume: normalizeWhitespace(match.groups.volume ?? '') || undefined,
    issue: normalizeWhitespace(match.groups.issue ?? '') || undefined,
    pages: normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-') || undefined,
    doi: doiMatch ? normalizeDoiValue(doiMatch[0]) : undefined,
    url: urlMatch ? cleanTrailingUrl(urlMatch[0]) : undefined,
    parseWarnings: ['compact-journal-tail-heuristic'],
  };

  return {
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: parsed.parseWarnings ?? [],
  };
}

function splitCompactAuthorSeries(value: string): string[] {
  return normalizeWhitespace(value.replace(/\s+(?:and|&)\s+/gi, ', '))
    .split(/\s*,\s*/)
    .map((segment) => stripTrailingPeriod(segment))
    .filter(Boolean);
}

function splitInvertedAuthorSeries(value: string): string[] {
  const normalized = normalizeWhitespace(value)
    .replace(/\.\s+(?=[\p{Lu}][^,]+,\s*[\p{Lu}])/gu, '. | ');
  return normalized
    .split(/\s+\|\s+/)
    .map((segment) => stripTrailingPeriod(segment))
    .filter(Boolean);
}

function splitApaAuthorSeries(value: string): string[] {
  const normalized = normalizeWhitespace(value)
    .replace(/\s*\.\.\.\s*/g, ' ')
    .replace(/\s*…\s*/g, ' ')
    .replace(/\s*,?\s*&\s+/g, ' ');

  const commaTokens = normalized
    .split(/\s*,\s*/)
    .map((segment) => normalizeWhitespace(stripLeadingAuthorConjunction(segment).replace(/^[,;]+|[,;]+$/g, '')))
    .filter(Boolean);
  if (commaTokens.length >= 4 && commaTokens.length % 2 === 0) {
    const pairedAuthors: string[] = [];
    let allPairsLookValid = true;
    for (let index = 0; index < commaTokens.length; index += 2) {
      const surname = commaTokens[index] ?? '';
      const given = commaTokens[index + 1] ?? '';
      const givenTokens = normalizeWhitespace(given).split(/\s+/).filter(Boolean);
      if (
        !looksLikeSurnameLeadSegment(surname)
        || givenTokens.length === 0
        || givenTokens.length > 4
        || !givenTokens.every((token, tokenIndex) => looksLikeFullNameOrInitialToken(token, tokenIndex, givenTokens.length))
      ) {
        allPairsLookValid = false;
        break;
      }
      pairedAuthors.push(`${surname}, ${given}`);
    }
    if (allPairsLookValid && pairedAuthors.length > 0) {
      return pairedAuthors;
    }
  }

  return [...normalized.matchAll(/[\p{Lu}][\p{L}'’.-]+(?:\s+(?:da|de|del|der|di|du|la|le|van|von)\s+[\p{Lu}][\p{L}'’.-]+)*(?:\s+[\p{Lu}][\p{L}'’.-]+)*,\s*(?:[\p{Lu}]\.\s*){1,6}/gu)]
    .map((match) => normalizeWhitespace(stripTrailingPeriod(match[0] ?? '')))
    .filter(Boolean);
}

function parseChicagoAuthorDateAuthors(value: string): string[] {
  const normalized = stripTrailingPeriod(normalizeWhitespace(value));
  if (!normalized) return [];

  const firstMatch = normalized.match(/^(?<first>[^,]+,\s*[^,]+),\s*(?<rest>.+)$/);
  if (!firstMatch?.groups) {
    return normalized.split(/\s+(?:and|&)\s+/i).map((segment) => normalizeWhitespace(segment)).filter(Boolean);
  }

  const firstAuthor = normalizeWhitespace(firstMatch.groups.first);
  const remainingAuthors = normalizeWhitespace(firstMatch.groups.rest)
    .replace(/,\s+and\s+/i, ', ')
    .split(/\s*,\s*/)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);

  return [firstAuthor, ...remainingAuthors];
}

function buildVancouverArticleNumberCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(VANCOUVER_ARTICLE_NUMBER_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle(splitCompactAuthorSeries(match.groups.authors ?? ''), 'vancouver');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const volume = normalizeWhitespace(match.groups.volume ?? '') || undefined;
  const locator = normalizeWhitespace(match.groups.locator ?? '').replace(/\s*[-–]\s*/g, '-');
  const locatorKind = classifyLocatorToken(locator).kind;
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];

  if (authors.length === 0 || !title || !journal || !year || !volume || !locator) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    pages: locatorKind === 'pages' ? locator : undefined,
    'article-number': locator,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['vancouver-article-number-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'vancouver',
    styleConfidence: 0.94,
  };
}

function buildVancouverCompactJournalCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(VANCOUVER_COMPACT_JOURNAL_PATTERN);
  if (!match?.groups) return null;

  const authors = splitCompactAuthorSeries(match.groups.authors ?? '')
    .map((segment) => {
      const compactMatch = normalizeWhitespace(segment).match(/^(?<last>[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})\s+(?<initials>[A-Z]{1,4})$/u);
      if (!compactMatch?.groups) return normalizeWhitespace(segment);
      const initials = compactMatch.groups.initials.split('').map((initial) => `${initial}.`).join(' ');
      return `${compactMatch.groups.last}, ${initials}`;
    })
    .filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const volume = normalizeWhitespace(match.groups.volume ?? '') || undefined;
  const issue = normalizeWhitespace(match.groups.issue ?? '') || undefined;
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-') || undefined;
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];

  if (authors.length === 0 || !title || !journal || !year || !volume || !pages) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    issue,
    pages,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['vancouver-compact-journal-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: parsed.parseWarnings ?? [],
    styleUsed: 'vancouver',
    styleConfidence: 0.94,
  };
}

function collapseInstitutionalInitialismDots(value: string): string {
  return normalizeWhitespace(
    value.replace(/\b(?:[A-Z]\.){2,}[A-Z]?\.?/g, (match) => match.replace(/\./g, '')),
  );
}

function buildInstitutionalVancouverJournalCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(/^(?:\[\d+\]\s*|\d+\.\s*)?(?<lead>.+?)\.\s+(?<journal>[^.]+?)\.\s+(?<year>(?:1[5-9]\d{2}|20\d{2}));\s*(?<volume>\d+)(?:\((?<issue>[A-Za-z0-9-]+)\))?\.?(?:\s+(?<tail>.+))?$/i);
  if (!match?.groups) return null;

  const repairedLead = collapseInstitutionalInitialismDots(match.groups.lead ?? '');
  if (!INSTITUTIONAL_KEYWORD_PATTERN.test(repairedLead)) return null;

  const leadSegments = repairedLead.split(/\.\s+/).map((segment) => normalizeWhitespace(segment)).filter(Boolean);
  if (leadSegments.length < 2) return null;

  const title = stripTrailingPeriod(leadSegments.pop() ?? '');
  const authorLead = normalizeWhitespace(leadSegments.join('. '));
  const authorParse = {
    authors: [buildInstitutionalLiteralAuthor(authorLead)],
    parserMode: 'institutional_literal',
    warningFlags: [] as string[],
    rejectedCandidates: [] as string[],
  };
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const volume = normalizeWhitespace(match.groups.volume ?? '') || undefined;
  const issue = normalizeWhitespace(match.groups.issue ?? '') || undefined;
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];

  if (authors.length === 0 || !title || !journal || !year || !volume) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    issue,
    institution: normalizeInstitutionalAuthor(authorLead),
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['institutional-vancouver-journal-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'vancouver',
    styleConfidence: 0.93,
  };
}

function buildVancouverSentenceJournalCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(VANCOUVER_SENTENCE_JOURNAL_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([normalizeWhitespace(match.groups.authors ?? '')], 'vancouver');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const volume = normalizeWhitespace(match.groups.volume ?? '') || undefined;
  const issue = normalizeWhitespace(match.groups.issue ?? '') || undefined;
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];

  if (authors.length === 0 || !title || !journal || !year || !volume) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    issue,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['vancouver-sentence-journal-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'vancouver',
    styleConfidence: 0.92,
  };
}

function buildVancouverPublisherYearSourceCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(/^(?:\[\d+\]\s*|\d+\.\s*)?(?<authors>.+?)\.\s+(?<title>.+?)\.\s+(?<publisher>.+?)\s*;\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.?(?:\s+(?<tail>.+))?$/i);
  if (!match?.groups) return null;

  const rawPublisher = normalizeWhitespace(match.groups.publisher ?? '');
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  if (/^\d+(?:\([A-Za-z0-9-]+\))?:/i.test(tail)) return null;
  if (
    /\bIn:?\s+/i.test(rawPublisher)
    || /\bpp?\.?\s*[A-Za-z]?\d+/i.test(rawPublisher)
    || /\bp\.?\s*[A-Za-z]?\d+/i.test(rawPublisher)
  ) {
    return null;
  }

  let authorLead = normalizeWhitespace(match.groups.authors ?? '');
  let titleLead = stripTrailingPeriod(match.groups.title ?? '');
  const repairedInitialsLead = repairInitialsLeadWithLeadingSurname(authorLead, titleLead);
  authorLead = repairedInitialsLead.authorLead;
  titleLead = repairedInitialsLead.titleLead;

  const authorParse = parseAuthorsForStyle(splitCompactAuthorSeries(authorLead), 'vancouver');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(titleLead);
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const doi = tail.match(DOI_PATTERN)?.[0];
  const url = tail.match(URL_PATTERN)?.[0];

  if (authors.length === 0 || !title || !publisher || !year) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    publisher,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    url: url ? cleanTrailingUrl(url) : undefined,
    parseWarnings: ['vancouver-publisher-year-source-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: inferPublisherBackedReferenceType(authors, title, publisher),
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'vancouver',
    styleConfidence: 0.93,
  };
}

function buildAuthorColonVancouverCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(AUTHOR_COLON_VANCOUVER_PATTERN);
  if (!match?.groups) return null;

  const rawAuthors = normalizeWhitespace(match.groups.authors ?? '');
  const hasInvertedPairs = /[^,]+,\s*[A-Z]\.(?:\s+[^,]+,\s*[A-Z]\.)+/u.test(rawAuthors);
  if (rawAuthors.includes('. ') && !hasInvertedPairs) return null;
  const authorSegments = hasInvertedPairs
    ? splitInvertedAuthorSeries(rawAuthors)
    : splitCompactAuthorSeries(rawAuthors);
  const authors = hasInvertedPairs
    ? authorSegments.map((segment) => normalizeWhitespace(segment.replace(/,\s*([A-Z])$/u, ', $1.')))
    : authorSegments;
  const authorParse = {
    authors: [],
    parserMode: hasInvertedPairs ? 'inverted_pairs_literal' : 'vancouver_compact_array',
    warningFlags: [],
    rejectedCandidates: [],
  };
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const volume = normalizeWhitespace(match.groups.volume ?? '') || undefined;
  const issue = normalizeWhitespace(match.groups.issue ?? '') || undefined;
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];

  if (authors.length === 0 || !title || !journal || !year || !volume || !pages) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    issue,
    pages,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['author-colon-vancouver-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'vancouver',
    styleConfidence: 0.95,
  };
}

function extractBookTitleLead(value: string): { title: string | undefined; edition: string | undefined } {
  let normalized = stripTrailingPeriod(normalizeWhitespace(value));
  if (!normalized) {
    return { title: undefined, edition: undefined };
  }

  const noteMatch = normalized.match(BOOK_NOTE_PATTERN);
  if (noteMatch?.groups?.title) {
    normalized = stripTrailingPeriod(noteMatch.groups.title);
  }

  const editionMatch = normalized.match(/\((?<edition>\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?)\)/i);
  const edition = editionMatch?.groups?.edition
    ? normalizeWhitespace(editionMatch.groups.edition)
    : undefined;
  if (editionMatch) {
    normalized = normalizeWhitespace(normalized.replace(editionMatch[0], ' '));
  }

  return {
    title: normalized || undefined,
    edition,
  };
}

function looksLikeInitialsOnlyLead(value: string): boolean {
  const compact = normalizeWhitespace(value).replace(/\s+/g, '');
  if (!compact) return false;
  return /^(?:[\p{Lu}]\.?){1,6}$/u.test(compact);
}

function repairInitialsLeadWithLeadingSurname(
  authorLead: string,
  titleLead: string,
): { authorLead: string; titleLead: string } {
  const normalizedAuthorLead = normalizeWhitespace(authorLead);
  const normalizedTitleLead = normalizeWhitespace(titleLead);

  if (!looksLikeInitialsOnlyLead(normalizedAuthorLead) || !normalizedTitleLead) {
    return {
      authorLead: normalizedAuthorLead,
      titleLead: normalizedTitleLead,
    };
  }

  const repaired = normalizedTitleLead.match(/^(?<surname>[\p{L}'’.-]+(?:\s+(?:da|de|del|der|di|du|la|le|van|von|al-|bin)\s+[\p{L}'’.-]+){0,3}),\s+(?<rest>.+)$/u);
  if (!repaired?.groups?.surname || !repaired.groups.rest) {
    return {
      authorLead: normalizedAuthorLead,
      titleLead: normalizedTitleLead,
    };
  }

  return {
    authorLead: normalizeWhitespace(`${normalizedAuthorLead} ${repaired.groups.surname}`),
    titleLead: normalizeWhitespace(repaired.groups.rest),
  };
}

function looksLikeCommercialPublisherName(value: string): boolean {
  const normalized = cleanContainerTitle(value);
  if (!normalized) return false;
  if (PUBLISHER_SEGMENT_PATTERN.test(normalized)) return true;
  return /\b(?:press|verlag|editions?|ediciones?|editora|publisher|publishers?|editorial)\b/i.test(normalized);
}

function splitTrailingPublisherFromConferenceTitle(value: string): {
  conferenceTitle: string;
  publisher?: string;
} {
  const normalized = cleanContainerTitle(value);
  if (!normalized || !normalized.includes(',')) return { conferenceTitle: normalized };

  const parts = normalized.split(',').map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (parts.length < 2) return { conferenceTitle: normalized };

  const publisherCandidate = parts[parts.length - 1] ?? '';
  if (
    !looksLikePublisherSegment(publisherCandidate)
    && !looksLikeCommercialPublisherName(publisherCandidate)
  ) {
    return { conferenceTitle: normalized };
  }

  const conferenceTitle = cleanContainerTitle(parts.slice(0, -1).join(', '));
  if (!conferenceTitle) return { conferenceTitle: normalized };

  return {
    conferenceTitle,
    publisher: cleanContainerTitle(publisherCandidate),
  };
}

function looksBookishContainerTitle(value: string): boolean {
  const normalized = cleanContainerTitle(value);
  if (!normalized) return false;
  return BOOKISH_CONTAINER_SIGNAL.test(normalized)
    || /\b(?:family law|contract law|criminal law|civil law|international law|lecture notes|encyclopedia|lexikon|pocket book|concentrate)\b/i.test(normalized);
}

function looksNumberedChapterTitle(value: string): boolean {
  return NUMBERED_CHAPTER_TITLE_PATTERN.test(normalizeWhitespace(value));
}

function looksBookChapterDoiFamily(doi: string | undefined): boolean {
  const normalizedDoi = normalizeDoiValue(doi ?? '');
  if (!normalizedDoi) return false;
  return /^(?:10\.1007\/97[89]-|10\.1201\/97[89]|10\.1016\/b97[89]-|10\.30525\/97[89]-|10\.1163\/97[89]|10\.5040\/97[89]|10\.51202\/97[89]|10\.1093\/[^/]+\/97[89].*(?:003\.\d+|ch-\d+))/i.test(normalizedDoi);
}

function looksProceedingsSeriesContainer(
  container: string,
  publisher: string | undefined,
  doi: string | undefined,
): boolean {
  const normalizedContainer = cleanContainerTitle(container);
  if (!normalizedContainer || looksBookishContainerTitle(normalizedContainer)) return false;

  const normalizedPublisher = cleanContainerTitle(publisher ?? '');
  const normalizedDoi = normalizeDoiValue(doi ?? '');

  if (ATLANTIS_PROCEEDINGS_SERIES_SIGNAL.test(normalizedContainer)) return true;
  if (/^10\.2991\//i.test(normalizedDoi) && /atlantis press/i.test(normalizedPublisher)) {
    return /advances in social science|humanities research|proceedings|conference|symposium|workshop/i.test(normalizedContainer);
  }

  return false;
}

function looksConferenceProceedingsDoiFamily(doi: string | undefined): boolean {
  const normalizedDoi = normalizeDoiValue(doi ?? '');
  if (!normalizedDoi) return false;
  return /^(?:10\.1109\/|10\.1145\/|10\.1117\/|10\.1115\/|10\.29327\/|10\.2991\/|10\.2495\/|10\.26678\/|10\.14201\/0aq|10\.51980\/|10\.3997\/2214-4609\.20|10\.1164\/ajrccm-conference\.|10\.1136\/[^/]+-snis\.|10\.1055\/s-|10\.52202\/|10\.46898\/home\.|10\.2749\/222137)/i.test(normalizedDoi);
}

function inferPublisherBackedReferenceType(authors: string[], title: string, publisher: string): ReturnType<typeof parsedReferenceTypeToCanonical> {
  const primaryAuthor = normalizeWhitespace(authors[0] ?? '');
  const institutionalLead = primaryAuthor && looksLikeInstitutionalLead(primaryAuthor);
  const personalLead = Boolean(primaryAuthor) && !institutionalLead && !isGroupAuthor(primaryAuthor);
  const normalizedTitle = normalizeWhitespace(title.toLowerCase());
  const normalizedAuthor = normalizeInstitutionalAuthor(primaryAuthor).toLowerCase();
  const normalizedPublisher = normalizeInstitutionalAuthor(publisher).toLowerCase();
  const reportLikeTitle = /\b(report|guideline|guidance|brief|bulletin|white\s+paper|policy|framework|roadmap|recommendation|statement|fact\s+sheet|statistics?|working\s+paper|discussion\s+paper|forecasting|database)\b/i.test(normalizedTitle);
  const stronglyBookLikeTitle = /\b(handbook|manual|textbook|book|volume|edition|theory|history|poetry|patterns|programming|process)\b/i.test(normalizedTitle);
  const institutionalPublisherMatch = Boolean(normalizedAuthor && normalizedPublisher && normalizedAuthor === normalizedPublisher);
  const institutionalPublisher = REPORT_PUBLISHER_KEYWORD_PATTERN.test(normalizedPublisher);
  const commercialPublisher = looksLikeCommercialPublisherName(publisher);

  if (reportLikeTitle) return 'report';
  if (institutionalPublisherMatch && !stronglyBookLikeTitle) return 'report';
  if (institutionalPublisher && !commercialPublisher && !stronglyBookLikeTitle && !personalLead) return 'report';
  if (!institutionalLead) return 'book';
  return 'book';
}

function inferBookTailReferenceType(authors: string[], title: string, publisher: string): ReturnType<typeof parsedReferenceTypeToCanonical> {
  return inferPublisherBackedReferenceType(authors, title, publisher);
}

function buildBookTailCandidate(normalized: string, inputStyle: string): {
  normalized: string;
  parsed: ParsedReference;
  referenceType: ReturnType<typeof parsedReferenceTypeToCanonical>;
  warnings: string[];
} | null {
  if (/\bIn:?\s+.+\bpp?\.?\s*[A-Za-z]?\d+/i.test(normalized)) return null;
  if (/\b(?:conference|proceedings|symposium|workshop)\b/i.test(normalized)) return null;
  if (/\b(?:vol\.?|no\.?|issue|journal)\b/i.test(normalized)) return null;
  const doi = normalized.match(DOI_PATTERN)?.[0];
  const url = normalized.match(URL_PATTERN)?.[0];
  const matchingInput = stripTrailingPeriod(normalizeWhitespace(
    normalized
      .replace(/\bdoi:\s*/i, '')
      .replace(DOI_PATTERN, '')
      .replace(URL_PATTERN, ''),
  ));
  let placeOfPublication: string | undefined;
  let publisher: string | undefined;
  let beforeTail = '';
  let year: string | undefined;

  const placeTailMatch = matchingInput.match(BOOK_TAIL_PATTERN);
  if (placeTailMatch?.groups && placeTailMatch.index != null) {
    placeOfPublication = cleanContainerTitle(placeTailMatch.groups.place ?? '') || undefined;
    publisher = cleanContainerTitle(placeTailMatch.groups.publisher ?? '') || undefined;
    beforeTail = stripTrailingPeriod(matchingInput.slice(0, placeTailMatch.index).trim());
    year = normalizeParsedYear(placeTailMatch.groups.year);
    if (!placeOfPublication || !publisher || !beforeTail) return null;
  } else {
    const publisherTailMatch = matchingInput.match(BOOK_PUBLISHER_YEAR_PATTERN);
    if (!publisherTailMatch?.groups || publisherTailMatch.index == null) return null;
    publisher = cleanContainerTitle(publisherTailMatch.groups.publisher ?? '') || undefined;
    beforeTail = stripTrailingPeriod(matchingInput.slice(0, publisherTailMatch.index).trim());
    year = normalizeParsedYear(publisherTailMatch.groups.year);
    if (!publisher || !beforeTail) return null;
    if (/^\d+(?:\.\d+)?$/.test(publisher)) return null;
  }

  let authorLead = '';
  let titleLead = '';

  const parentheticalYear = beforeTail.match(/\((?<year>(?:1[5-9]\d{2}|20\d{2}))\)/);
  if (parentheticalYear?.index != null) {
    authorLead = stripTrailingPeriod(beforeTail.slice(0, parentheticalYear.index));
    titleLead = stripLeadingPunctuation(
      beforeTail.slice(parentheticalYear.index + parentheticalYear[0].length),
    );
    year = year ?? normalizeParsedYear(parentheticalYear.groups?.year);
  } else {
    const leadParts = beforeTail.match(/^(?<authors>.+?)\.\s+(?<title>.+)$/);
    if (!leadParts?.groups) return null;
    authorLead = stripTrailingPeriod(leadParts.groups.authors ?? '');
    titleLead = normalizeWhitespace(leadParts.groups.title ?? '');
  }

  if (!authorLead || !titleLead) return null;
  const repairedInitialsLead = repairInitialsLeadWithLeadingSurname(authorLead, titleLead);
  authorLead = repairedInitialsLead.authorLead;
  titleLead = repairedInitialsLead.titleLead;
  if (/[."]\s+in\s+[A-Z]/i.test(titleLead) || /\bproceedings of the\b/i.test(titleLead)) return null;

  const { title, edition } = extractBookTitleLead(titleLead);
  if (!title) return null;

  const authorParse = parseAuthorsForStyle([authorLead], inputStyle);
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  if (authors.length === 0) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    publisher,
    placeOfPublication,
    edition,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    url: url ? cleanTrailingUrl(url) : undefined,
    parseWarnings: ['book-tail-heuristic'],
  };

  return {
    normalized,
    parsed,
    referenceType: inferBookTailReferenceType(authors, title, publisher),
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
  };
}

function buildHarvardJournalCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(HARVARD_JOURNAL_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([match.groups.author ?? ''], 'harvard');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const volume = normalizeWhitespace(match.groups.volume ?? '');
  const issue = normalizeWhitespace(match.groups.issue ?? '') || undefined;
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');
  const year = normalizeParsedYear(match.groups.year);
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];

  if (!title || !journal || authors.length === 0 || !volume || !pages || !year) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    issue,
    pages,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['harvard-journal-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'harvard',
    styleConfidence: 0.93,
  };
}

function buildHarvardSentenceJournalCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(HARVARD_SENTENCE_JOURNAL_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([match.groups.author ?? ''], 'harvard');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const volume = normalizeWhitespace(match.groups.volume ?? match.groups.issueOnly ?? '') || undefined;
  const issue = match.groups.volume
    ? (normalizeWhitespace(match.groups.issue ?? '') || undefined)
    : undefined;
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');
  const year = normalizeParsedYear(match.groups.year);
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];
  const url = tail.match(URL_PATTERN)?.[0];

  if (!title || !journal || authors.length === 0 || !volume || !pages || !year) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    issue,
    pages,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    url: url ? cleanTrailingUrl(url) : undefined,
    parseWarnings: ['harvard-sentence-journal-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'harvard',
    styleConfidence: 0.94,
  };
}

function buildApaJournalCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(APA_JOURNAL_PATTERN);
  if (!match?.groups) return null;

  const authorSegments = splitApaAuthorSeries(match.groups.authors ?? '');
  if (authorSegments.length === 0) return null;

  const authorParse = parseAuthorsForStyle(authorSegments, 'apa');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const volume = normalizeWhitespace(match.groups.volume ?? '');
  const issue = normalizeWhitespace(match.groups.issue ?? '') || undefined;
  const locator = normalizeWhitespace(match.groups.locator ?? '').replace(/\s*[-–]\s*/g, '-');
  const locatorKind = classifyLocatorToken(locator).kind;
  const year = normalizeParsedYear(match.groups.year);
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];
  const url = tail.match(URL_PATTERN)?.[0];

  if (!title || !journal || authors.length === 0 || !volume || !locator || !year) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    issue,
    pages: locatorKind === 'pages' ? locator : undefined,
    'article-number': locatorKind === 'article-number' ? locator : undefined,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    url: url ? cleanTrailingUrl(url) : undefined,
    parseWarnings: ['apa-journal-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'apa',
    styleConfidence: 0.95,
  };
}

function buildHarvardConferenceCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(HARVARD_CONFERENCE_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle(splitCompactAuthorSeries(match.groups.author ?? ''), 'vancouver');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const conferenceTitle = cleanContainerTitle(match.groups.conferenceTitle ?? '');
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');

  if (authors.length === 0 || !title || !conferenceTitle || !publisher || !year || !pages) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    conferenceTitle,
    publisher,
    pages,
    parseWarnings: ['harvard-conference-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'conference',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'harvard',
    styleConfidence: 0.94,
  };
}

function buildHarvardInSourceChapterCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(HARVARD_IN_SOURCE_CHAPTER_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([match.groups.author ?? ''], 'harvard');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const bookTitle = cleanContainerTitle(match.groups.bookTitle ?? '');
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];
  const url = tail.match(URL_PATTERN)?.[0];

  if (authors.length === 0 || !title || !bookTitle || !publisher || !year || !pages) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    bookTitle,
    publisher,
    pages,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    url: url ? cleanTrailingUrl(url) : undefined,
    parseWarnings: ['harvard-in-source-chapter-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'chapter',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'harvard',
    styleConfidence: 0.94,
  };
}

function buildChicagoAuthorDateReportCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(CHICAGO_AUTHOR_DATE_REPORT_PATTERN);
  if (!match?.groups) return null;

  const authorLead = normalizeWhitespace(match.groups.author ?? '');
  if (!looksLikeInstitutionalLead(authorLead)) return null;

  const author = normalizeInstitutionalAuthor(authorLead);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const placeOfPublication = cleanContainerTitle(match.groups.place ?? '');
  const url = cleanTrailingUrl(match.groups.url);

  if (!author || !title || !year || !publisher) return null;

  const parsed: ParsedReference = {
    authors: [author],
    title,
    year,
    publisher,
    placeOfPublication,
    institution: author,
    url,
    parseWarnings: ['chicago-author-date-report-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'report',
    warnings: parsed.parseWarnings ?? [],
    styleUsed: 'chicago',
    styleConfidence: 0.93,
  };
}

function buildTitlePlacePublisherReportCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(TITLE_PLACE_PUBLISHER_REPORT_PATTERN);
  if (!match?.groups) return null;

  const title = cleanContainerTitle(match.groups.title ?? '');
  const placeOfPublication = cleanContainerTitle(match.groups.place ?? '');
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];
  const url = cleanTrailingUrl(tail.match(URL_PATTERN)?.[0]);

  if (!title || !placeOfPublication || !publisher || !year) return null;
  if (BOOKISH_CONTAINER_SIGNAL.test(title) && !/\b(?:report|guideline|working paper|policy brief|technical note|white paper|statement|briefs?|forecasts?)\b/i.test(title)) {
    return null;
  }

  const strongReportPublisher = /\b(?:world health organization|office of scientific and technical information|defense technical information center|national bureau of economic research|national institute of standards and technology|inter-american development bank|federal reserve bank|nuclear regulatory commission|natural resources canada|akademiya2063|researchhub technologies|sae international)\b/i.test(publisher);
  const reportLikeTitle = /\b(?:report|guideline|working paper|policy brief|technical note|white paper|statement|briefs?|forecasts?)\b/i.test(title);
  if (!strongReportPublisher && !reportLikeTitle) return null;

  const institutionalAuthor = normalizeInstitutionalAuthor(publisher);
  const parsed: ParsedReference = {
    authors: institutionalAuthor ? [institutionalAuthor] : undefined,
    title,
    year,
    publisher,
    institution: institutionalAuthor || publisher,
    placeOfPublication,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    url,
    parseWarnings: ['title-place-publisher-report-heuristic'],
  };

  return {
    branch: 'institutional_heuristic_raw',
    normalized,
    parsed,
    referenceType: 'report',
    warnings: parsed.parseWarnings ?? [],
    styleUsed: 'vancouver',
    styleConfidence: 0.9,
  };
}

function buildHarvardBookCandidate(normalized: string): ParsedSelectionCandidate | null {
  if (/\b(?:vol\.?|no\.?|pp\.?|journal|conference|proceedings|viewed|accessed)\b/i.test(normalized)) return null;
  const match = normalized.match(HARVARD_BOOK_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([match.groups.author ?? ''], 'harvard');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = cleanContainerTitle(match.groups.title ?? '');
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const placeOfPublication = cleanContainerTitle(match.groups.place ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const edition = normalizeWhitespace(match.groups.edition ?? '') || undefined;

  if (!title || !publisher || !placeOfPublication || !year || authors.length === 0) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    publisher,
    placeOfPublication,
    edition,
    parseWarnings: ['harvard-book-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'book',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'harvard',
    styleConfidence: 0.93,
  };
}

function buildIeeeConferenceCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(IEEE_CONFERENCE_PATTERN);
  if (!match?.groups) return null;

  const authorSegments = splitIeeeAuthorSegments(match.groups.authors ?? '');
  const authorParse = parseAuthorsForStyle(authorSegments, 'ieee');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '').replace(/,\s*$/g, '');
  const conferenceTitle = cleanContainerTitle(match.groups.conferenceTitle ?? '');
  const placeOfPublication = cleanContainerTitle(match.groups.place ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];

  if (authors.length === 0 || !title || !conferenceTitle || !placeOfPublication || !year || !pages) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    conferenceTitle,
    placeOfPublication,
    year,
    pages,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['ieee-conference-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'conference',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'ieee',
    styleConfidence: 0.95,
  };
}

function buildHarvardWebsiteCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(HARVARD_WEBSITE_PATTERN);
  if (!match?.groups) return null;

  const authorLead = normalizeWhitespace(match.groups.author ?? '');
  const authorParse = looksLikeInstitutionalLead(authorLead)
    ? { authors: [], parserMode: 'institutional_literal', warningFlags: [], rejectedCandidates: [] }
    : parseAuthorsForStyle([authorLead], 'harvard');
  const authors = looksLikeInstitutionalLead(authorLead)
    ? [normalizeInstitutionalAuthor(authorLead)]
    : authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const institution = cleanContainerTitle(match.groups.container ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const url = cleanTrailingUrl(match.groups.url);

  if (!title || !institution || !year || !url || authors.length === 0) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    institution,
    url,
    parseWarnings: ['harvard-website-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'website',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'harvard',
    styleConfidence: 0.92,
  };
}

function buildQuotedWebsiteCandidate(normalized: string, inputStyle: string): ParsedSelectionCandidate | null {
  const match = normalized.match(QUOTED_WEBSITE_PATTERN);
  if (!match?.groups) return null;

  const rest = normalizeWhitespace(match.groups.rest ?? '');
  const urlSpan = extractUrlSpan(rest);
  const url = urlSpan?.url;
  if (!url) return null;

  const restWithoutUrl = stripTrailingPeriod(removeUrlSpan(rest, urlSpan));
  if (!/\b(accessed|viewed|available(?:\s+at|\s+from)?|\[online\])\b/i.test(restWithoutUrl) && !/\b(accessed|viewed|available(?:\s+at|\s+from)?|\[online\])\b/i.test(rest)) {
    return null;
  }

  const inferredStyle = /^\s*\[\d+\]/.test(normalized)
    ? 'ieee'
    : /\bviewed\b/i.test(normalized)
      ? 'harvard'
      : /\baccessed\b/i.test(normalized)
        ? 'chicago'
        : (inputStyle === 'auto' ? 'mla' : inputStyle);
  const authorLead = normalizeWhitespace(match.groups.author ?? '');
  const authorParse = looksLikeInstitutionalLead(authorLead)
    ? { authors: [], parserMode: 'institutional_literal', warningFlags: [], rejectedCandidates: [] }
    : parseAuthorsForStyle([authorLead], inferredStyle);
  const authors = looksLikeInstitutionalLead(authorLead)
    ? [normalizeInstitutionalAuthor(authorLead)]
    : authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const year = extractWebsitePublicationYear(rest);
  const institution = cleanContainerTitle(
    restWithoutUrl
      .replace(/\b(?:accessed|viewed|available(?:\s+at|\s+from)?|\[online\])\b[\s\S]*$/i, '')
      .replace(/,\s*((?:1[5-9]\d{2}|20\d{2}))\.?$/i, '')
      .replace(/[,.]\s*$/g, ''),
  );

  if (!title || !institution || !url || authors.length === 0) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    institution,
    url,
    parseWarnings: ['quoted-website-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'website',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: inferredStyle === 'auto' ? null : inferredStyle as CitationStyle,
    styleConfidence: year ? 0.9 : 0.84,
  };
}

function buildMlaConferenceProceedingsCandidate(normalized: string, inputStyle: string): ParsedSelectionCandidate | null {
  const match = normalized.match(MLA_CONFERENCE_PROCEEDINGS_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([match.groups.author ?? ''], inputStyle === 'auto' ? 'mla' : inputStyle);
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const conferenceTitle = cleanContainerTitle(match.groups.conferenceTitle ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];
  const url = tail.match(URL_PATTERN)?.[0];

  if (!authors.length || !title || !conferenceTitle || !year || !pages || !publisher) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    conferenceTitle,
    pages,
    publisher,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    url: url ? cleanTrailingUrl(url) : undefined,
    parseWarnings: ['mla-conference-proceedings-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'conference',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'mla',
    styleConfidence: 0.94,
  };
}

function buildQuotedBookChapterCandidate(normalized: string, inputStyle: string): ParsedSelectionCandidate | null {
  const mlaConference = buildMlaConferenceProceedingsCandidate(normalized, inputStyle);
  if (mlaConference) return mlaConference;

  const mlaMatch = normalized.match(MLA_CHAPTER_PATTERN);
  if (mlaMatch?.groups) {
    const authorParse = parseAuthorsForStyle([mlaMatch.groups.author ?? ''], inputStyle === 'auto' ? 'mla' : inputStyle);
    const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
    const title = stripTrailingPeriod(mlaMatch.groups.title ?? '');
    const bookTitle = cleanContainerTitle(mlaMatch.groups.bookTitle ?? '');
    const editor = cleanContainerTitle(mlaMatch.groups.editor ?? '');
    const publisher = cleanContainerTitle(mlaMatch.groups.publisher ?? '');
    const year = normalizeParsedYear(mlaMatch.groups.year);
    const pages = normalizeWhitespace(mlaMatch.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');

    if (CONFERENCE_SIGNAL_PATTERN.test(bookTitle)) {
      return null;
    }

    if (authors.length > 0 && title && bookTitle && publisher && year && pages) {
      const parsed: ParsedReference = {
        authors,
        title,
        year,
        bookTitle,
        editor,
        publisher,
        pages,
        parseWarnings: ['quoted-book-chapter-heuristic'],
      };

      return {
        branch: 'deterministic_raw',
        normalized,
        parsed,
        referenceType: 'chapter',
        warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
        styleUsed: 'mla',
        styleConfidence: 0.94,
      };
    }
  }

  const mlaBareMatch = normalized.match(MLA_BARE_CHAPTER_PATTERN);
  if (mlaBareMatch?.groups) {
    const authorParse = parseAuthorsForStyle([mlaBareMatch.groups.author ?? ''], inputStyle === 'auto' ? 'mla' : inputStyle);
    const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
    const title = stripTrailingPeriod(mlaBareMatch.groups.title ?? '');
    const bookTitle = cleanContainerTitle(mlaBareMatch.groups.bookTitle ?? '');
    const publisher = cleanContainerTitle(mlaBareMatch.groups.publisher ?? '');
    const year = normalizeParsedYear(mlaBareMatch.groups.year);
    const pages = normalizeWhitespace(mlaBareMatch.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');
    const tail = normalizeWhitespace(mlaBareMatch.groups.tail ?? '');
    const doi = tail.match(DOI_PATTERN)?.[0];
    const url = tail.match(URL_PATTERN)?.[0];

    if (CONFERENCE_SIGNAL_PATTERN.test(bookTitle)) {
      return null;
    }

    if (authors.length > 0 && title && bookTitle && publisher && year && pages) {
      const parsed: ParsedReference = {
        authors,
        title,
        year,
        bookTitle,
        publisher,
        pages,
        doi: doi ? normalizeDoiValue(doi) : undefined,
        url: url ? cleanTrailingUrl(url) : undefined,
        parseWarnings: ['quoted-book-chapter-heuristic'],
      };

      return {
        branch: 'deterministic_raw',
        normalized,
        parsed,
        referenceType: 'chapter',
        warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
        styleUsed: 'mla',
        styleConfidence: 0.93,
      };
    }
  }

  const mlaNoPagesMatch = normalized.match(MLA_QUOTED_CHAPTER_NO_PAGES_PATTERN);
  if (mlaNoPagesMatch?.groups) {
    const authorParse = parseAuthorsForStyle([mlaNoPagesMatch.groups.author ?? ''], inputStyle === 'auto' ? 'mla' : inputStyle);
    const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
    const title = stripTrailingPeriod(mlaNoPagesMatch.groups.title ?? '');
    const bookTitle = cleanContainerTitle(mlaNoPagesMatch.groups.bookTitle ?? '');
    const publisher = cleanContainerTitle(mlaNoPagesMatch.groups.publisher ?? '');
    const year = normalizeParsedYear(mlaNoPagesMatch.groups.year);
    const tail = normalizeWhitespace(mlaNoPagesMatch.groups.tail ?? '');
    const doi = tail.match(DOI_PATTERN)?.[0];
    const url = tail.match(URL_PATTERN)?.[0];

    if (
      !looksBookishContainerTitle(bookTitle)
      || bookTitle.startsWith('In ')
      || /\bedited by\b/i.test(bookTitle)
      || /,\s*\d+(?:-\d+)?$/i.test(bookTitle)
      || CONFERENCE_SIGNAL_PATTERN.test(bookTitle)
      || looksLikeCommercialPublisherName(title)
    ) {
      return null;
    }

    if (authors.length > 0 && title && bookTitle && publisher && year) {
      const parsed: ParsedReference = {
        authors,
        title,
        year,
        bookTitle,
        publisher,
        doi: doi ? normalizeDoiValue(doi) : undefined,
        url: url ? cleanTrailingUrl(url) : undefined,
        parseWarnings: ['quoted-book-chapter-heuristic'],
      };

      return {
        branch: 'deterministic_raw',
        normalized,
        parsed,
        referenceType: 'chapter',
        warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
        styleUsed: 'mla',
        styleConfidence: 0.91,
      };
    }
  }

  const chicagoMatch = normalized.match(CHICAGO_CHAPTER_PATTERN);
  if (!chicagoMatch?.groups) return null;

  const authorParse = parseAuthorsForStyle([chicagoMatch.groups.author ?? ''], inputStyle === 'auto' ? 'chicago' : inputStyle);
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(chicagoMatch.groups.title ?? '');
  const bookTitle = cleanContainerTitle(chicagoMatch.groups.bookTitle ?? '');
  const editor = cleanContainerTitle(chicagoMatch.groups.editor ?? '');
  const publisher = cleanContainerTitle(chicagoMatch.groups.publisher ?? '');
  const placeOfPublication = cleanContainerTitle(chicagoMatch.groups.place ?? '');
  const year = normalizeParsedYear(chicagoMatch.groups.year);
  const pages = normalizeWhitespace(chicagoMatch.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');

  if (authors.length === 0 || !title || !bookTitle || !publisher || !placeOfPublication || !year || !pages) {
    return null;
  }

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    bookTitle,
    editor,
    publisher,
    placeOfPublication,
    pages,
    parseWarnings: ['quoted-book-chapter-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'chapter',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'chicago',
    styleConfidence: 0.94,
  };
}

function buildChicagoAuthorDateJournalCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(CHICAGO_AUTHOR_DATE_JOURNAL_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle(parseChicagoAuthorDateAuthors(match.groups.authors ?? ''), 'chicago');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const journal = cleanContainerTitle(match.groups.journal ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const volume = normalizeWhitespace(match.groups.volume ?? '') || undefined;
  const issue = normalizeWhitespace(match.groups.issue ?? '') || undefined;
  const pages = normalizeWhitespace(match.groups.pages ?? '').replace(/\s*[-–]\s*/g, '-');
  const tail = normalizeWhitespace(match.groups.tail ?? '');
  const doi = tail.match(DOI_PATTERN)?.[0];

  if (authors.length === 0 || !title || !journal || !year || !volume || !issue || !pages) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    journal,
    volume,
    issue,
    pages,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['chicago-author-date-journal-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'journal',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'chicago',
    styleConfidence: 0.94,
  };
}

function buildApaThesisCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(APA_THESIS_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([match.groups.author ?? ''], 'apa');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const institution = cleanContainerTitle(match.groups.institution ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const url = cleanTrailingUrl(match.groups.url);

  if (authors.length === 0 || !title || !institution || !year) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    institution,
    url,
    parseWarnings: ['apa-thesis-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'thesis',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'apa',
    styleConfidence: 0.95,
  };
}

function buildMlaThesisCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(MLA_THESIS_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([match.groups.author ?? ''], 'mla');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const institution = cleanContainerTitle(match.groups.institution ?? '');
  const year = normalizeParsedYear(match.groups.year);
  const url = cleanTrailingUrl(match.groups.url);

  if (authors.length === 0 || !title || !institution || !year) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    institution,
    url,
    parseWarnings: ['mla-thesis-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'thesis',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'mla',
    styleConfidence: 0.94,
  };
}

function buildSentenceThesisCandidate(normalized: string, inputStyle: string): ParsedSelectionCandidate | null {
  if (!THESIS_DESCRIPTOR_PATTERN.test(normalized)) return null;

  const urlSpan = extractUrlSpan(normalized);
  const url = urlSpan?.url;
  const withoutUrl = normalizeWhitespace(removeUrlSpan(normalized, urlSpan));
  const doi = withoutUrl.match(DOI_PATTERN)?.[0];
  const working = stripTrailingPeriod(normalizeWhitespace(
    withoutUrl
      .replace(/\bdoi:\s*/i, '')
      .replace(DOI_PATTERN, ''),
  ));

  const simpleSentenceMatch = working.match(
    /^(?:\[\d+\]\s*)?(?<author>.+?)\.\s+(?<title>.+?)\.\s+(?<institution>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.\s*(?<descriptor>(?:(?:doctoral|phd|master'?s?)\s+)?(?:dissertation|thesis))$/i,
  );
  if (simpleSentenceMatch?.groups) {
    const authorParse = parseAuthorsForStyle([normalizeWhitespace(simpleSentenceMatch.groups.author ?? '')], inputStyle === 'auto' ? null : inputStyle);
    const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
    const title = stripTrailingPeriod(simpleSentenceMatch.groups.title ?? '');
    const institution = cleanContainerTitle(simpleSentenceMatch.groups.institution ?? '');
    const year = normalizeParsedYear(simpleSentenceMatch.groups.year);
    if (authors.length > 0 && title && institution && year) {
      const parsed: ParsedReference = {
        authors,
        title,
        year,
        institution,
        publisher: institution,
        url: url ? cleanTrailingUrl(url) : undefined,
        doi: doi ? normalizeDoiValue(doi) : undefined,
        parseWarnings: ['sentence-thesis-heuristic'],
      };

      return {
        branch: 'deterministic_raw',
        normalized,
        parsed,
        referenceType: 'thesis',
        warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
        styleUsed: inputStyle === 'auto' ? null : inputStyle as CitationStyle,
        styleConfidence: 0.95,
      };
    }
  }

  const descriptorMatch = working.match(THESIS_DESCRIPTOR_PATTERN);
  if (!descriptorMatch || descriptorMatch.index == null) return null;

  const beforeDescriptor = stripTrailingPeriod(working.slice(0, descriptorMatch.index));
  let afterDescriptor = normalizeWhitespace(
    working
      .slice(descriptorMatch.index + descriptorMatch[0].length)
      .replace(/^[\s[(:,.-]+/u, '')
      .replace(/[\]\s.]+$/u, ''),
  );

  const authorYearPatterns = [
    /^(?<author>.+?)\s*\((?<year>(?:1[5-9]\d{2}|20\d{2}))\)\.\s*(?<title>.+)$/i,
    /^(?<author>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.\s*(?<title>.+)$/i,
  ];

  let authorLead: string | undefined;
  let year = normalizeParsedYear(extractLastYear(afterDescriptor));
  let title: string | undefined;

  for (const pattern of authorYearPatterns) {
    const match = beforeDescriptor.match(pattern);
    if (!match?.groups) continue;
    authorLead = normalizeWhitespace(match.groups.author ?? '') || undefined;
    year = normalizeParsedYear(match.groups.year) ?? year;
    title = stripTrailingPeriod((match.groups.title ?? '').replace(/\s*[\[]\s*$/u, '')) || undefined;
    break;
  }

  if (!authorLead || !title) {
    const trailingYearMatch = working.match(/^(?<author>.+?)\.\s*(?<title>.+?)\.\s*(?:doctoral|phd|master'?s?)\s+(?:dissertation|thesis)\s*,\s*(?<institution>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))$/i);
    if (trailingYearMatch?.groups) {
      authorLead = normalizeWhitespace(trailingYearMatch.groups.author ?? '') || undefined;
      title = stripTrailingPeriod((trailingYearMatch.groups.title ?? '').replace(/\s*[\[]\s*$/u, '')) || undefined;
      year = normalizeParsedYear(trailingYearMatch.groups.year) ?? year;
      afterDescriptor = normalizeWhitespace(trailingYearMatch.groups.institution ?? '');
    }
  }

  if (!authorLead || !title || !year) return null;

  const institution = cleanContainerTitle(
    stripTrailingPeriod(
      afterDescriptor
        .replace(new RegExp(`[,\\s]+${year}$`), '')
        .replace(/^[\s,.-]+|[\s,.-]+$/g, ''),
    ),
  );
  if (!institution) return null;

  const authorParse = parseAuthorsForStyle([authorLead], inputStyle === 'auto' ? null : inputStyle);
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  if (authors.length === 0) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    institution,
    publisher: institution,
    url: url ? cleanTrailingUrl(url) : undefined,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['sentence-thesis-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'thesis',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: inputStyle === 'auto' ? null : inputStyle as CitationStyle,
    styleConfidence: 0.93,
  };
}

function buildIeeeBookCandidate(normalized: string): ParsedSelectionCandidate | null {
  const match = normalized.match(IEEE_BOOK_PATTERN);
  if (!match?.groups) return null;

  const authorParse = parseAuthorsForStyle([normalizeIeeeFullNameAuthorSegment(match.groups.author ?? '')], 'ieee');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = cleanContainerTitle(match.groups.title ?? '');
  const placeOfPublication = cleanContainerTitle(match.groups.place ?? '');
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const year = normalizeParsedYear(match.groups.year);

  if (authors.length === 0 || !title || !placeOfPublication || !publisher || !year) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    publisher,
    placeOfPublication,
    parseWarnings: ['ieee-book-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: 'book',
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: 'ieee',
    styleConfidence: 0.95,
  };
}

function buildAuthorYearPublisherTailCandidate(normalized: string, inputStyle: string): ParsedSelectionCandidate | null {
  if (THESIS_DESCRIPTOR_PATTERN.test(normalized)) return null;
  if (/\bIn:?\s+.+\bpp?\.?\s*[A-Za-z]?\d+/i.test(normalized)) return null;
  if (/\b(?:vol\.?|no\.?|issue|journal|conference|proceedings|symposium|workshop)\b/i.test(normalized)) return null;

  const urlSpan = extractUrlSpan(normalized);
  const url = urlSpan?.url;
  const withoutUrl = normalizeWhitespace(removeUrlSpan(normalized, urlSpan));
  const doi = withoutUrl.match(DOI_PATTERN)?.[0];
  const working = stripTrailingPeriod(normalizeWhitespace(
    withoutUrl
      .replace(/\bdoi:\s*/i, '')
      .replace(DOI_PATTERN, ''),
  ));
  const leadMatch = working.match(/^(?<author>.+?)\s*\((?<year>(?:1[5-9]\d{2}|20\d{2}))\)\.\s*(?<body>.+)$/)
    ?? working.match(/^(?<author>.+?),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))\.\s*(?<body>.+)$/);
  if (!leadMatch?.groups) return null;

  const authorLead = normalizeWhitespace(leadMatch.groups.author ?? '');
  const year = normalizeParsedYear(leadMatch.groups.year);
  const body = normalizeWhitespace(leadMatch.groups.body ?? '');
  if (!authorLead || !year || !body) return null;
  if (/,\s*\d+(?:\([A-Za-z0-9-]+\))?\s*,\s*[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?\.?$/i.test(body)) return null;

  const bodySegments = splitSentenceSegments(body);
  if (bodySegments.length < 2) return null;
  const publisher = cleanContainerTitle(bodySegments[bodySegments.length - 1] ?? '');
  const title = stripTrailingPeriod(bodySegments.slice(0, -1).join('. '));
  if (!publisher || !title) return null;
  if (looksLikeSerialVenueTail(publisher)) return null;
  if (/\b(?:vol\.?|no\.?|issue|pp?\.?)\b/i.test(title)) return null;
  if (/[."]\s+in\s+[A-Z]/i.test(title) || /\bproceedings of the\b/i.test(title)) return null;

  const institutionalAuthorLead = looksLikeInstitutionalLead(authorLead)
    || (
      /[.()]/.test(authorLead)
      && /\b(?:commission|department|ministry|office|administration|agency|bureau|council|division|div\.|directorate|university|institute|laboratory|lab)\b/i.test(authorLead)
    );

  const authorParse = institutionalAuthorLead
    ? {
        authors: [buildInstitutionalLiteralAuthor(authorLead)],
        parserMode: 'institutional_literal',
        warningFlags: [] as string[],
        rejectedCandidates: [] as string[],
      }
    : parseAuthorsForStyle([authorLead], inputStyle === 'auto' ? null : inputStyle);
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  if (authors.length === 0) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    publisher,
    institution: institutionalAuthorLead ? normalizeInstitutionalAuthor(authorLead) : undefined,
    url: url ? cleanTrailingUrl(url) : undefined,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['author-year-publisher-tail-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: inferPublisherBackedReferenceType(authors, title, publisher),
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: inputStyle === 'auto' ? null : inputStyle as CitationStyle,
    styleConfidence: 0.91,
  };
}

function buildNumberedPublisherYearBookCandidate(normalized: string): ParsedSelectionCandidate | null {
  if (/\b(?:vol\.?|no\.?|issue|journal|conference|proceedings|symposium|workshop|pp?\.?)\b/i.test(normalized)) return null;
  if (/"[^"]+"/.test(normalized)) return null;

  const urlSpan = extractUrlSpan(normalized);
  const url = urlSpan?.url;
  const withoutUrl = normalizeWhitespace(removeUrlSpan(normalized, urlSpan));
  const doi = withoutUrl.match(DOI_PATTERN)?.[0];
  const working = stripTrailingPeriod(normalizeWhitespace(
    withoutUrl
      .replace(/\bdoi:\s*/i, '')
      .replace(DOI_PATTERN, ''),
  ));
  const numberedLead = /^(?:\[\d+\]|\d+\.)/.test(working);
  const match = working.match(/^(?:\[\d+\]|\d+\.)?\s*(?<authors>.+?),\s*(?<title>.+?)\.\s+(?<publisher>[^,]+),\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))$/);
  if (!match?.groups) return null;

  const authorSegments = normalizeWhitespace(match.groups.authors ?? '')
    .replace(/,\s+and\s+/i, ', ')
    .replace(/\s+and\s+/gi, ', ')
    .split(/\s*,\s*/)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);
  const authorParse = parseAuthorsForStyle(authorSegments, 'ieee');
  const authors = authorParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  const publisher = cleanContainerTitle(match.groups.publisher ?? '');
  const year = normalizeParsedYear(match.groups.year);

  if (authors.length === 0 || !title || !publisher || !year) return null;
  if (title.split(/\s+/).filter(Boolean).length < 2) return null;
  if (publisher.includes('. ')) return null;

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    publisher,
    url: url ? cleanTrailingUrl(url) : undefined,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['numbered-publisher-year-book-heuristic'],
  };

  return {
    branch: 'deterministic_raw',
    normalized,
    parsed,
    referenceType: inferPublisherBackedReferenceType(authors, title, publisher),
    warnings: [...(parsed.parseWarnings ?? []), ...authorParse.warningFlags],
    styleUsed: numberedLead ? 'ieee' : null,
    styleConfidence: numberedLead ? 0.92 : 0.9,
  };
}

function selectBestAutoStyleCandidate(parser: CitationParser, normalized: string): ParsedSelectionCandidate {
  const candidates = AUTO_STYLE_CANDIDATES.map((style) => {
    const { parsed } = parser.parseReference(normalized, style);
    const referenceType = parsedReferenceTypeToCanonical(parser.determineReferenceType(parsed));
    const sanitized = sanitizeParsedReference(parsed, referenceType);
    const repairedParsed = normalizeAuthorOptionalWebsiteParse(sanitized.parsed, sanitized.referenceType);
    const authorParse = parseAuthorsForStyle(repairedParsed.authors ?? [], style);
    const score = scoreCandidate(repairedParsed, sanitized.referenceType)
      - (authorParse.warningFlags.length * 2)
      - (authorParse.rejectedCandidates.length * 1.5)
      + ((authorParse.parserMode === 'alternating_pairs' || authorParse.parserMode === 'surname_given_pairs') ? 8 : 0)
      + buildStyleSignalScore(normalized, style);

    return {
      style,
      candidate: {
        branch: 'deterministic_raw' as const,
        normalized,
        parsed: repairedParsed,
        referenceType: sanitized.referenceType,
        warnings: parsed.parseWarnings ?? [],
        styleUsed: style,
      },
      score,
    };
  }).sort((left, right) => right.score - left.score);

  const best = candidates[0];
  const second = candidates[1];
  const margin = best && second ? best.score - second.score : 0;
  const confidence = best
    ? Math.max(0.42, Math.min(0.96, Number((0.58 + Math.max(margin, 0) * 0.035 + Math.max(buildStyleSignalScore(normalized, best.style), 0) * 0.02).toFixed(3))))
    : 0.35;

  return best
    ? {
        ...best.candidate,
        styleConfidence: confidence,
      }
    : {
        branch: 'deterministic_raw',
        normalized,
        parsed: {},
        referenceType: 'unknown',
        warnings: [],
        styleUsed: null,
        styleConfidence: 0.35,
      };
}

function buildTitleLedWebsiteCandidate(
  normalized: string,
  leadingSegment: string,
  remainder: string,
): ParsedSelectionCandidate | null {
  const urlSpan = extractUrlSpan(remainder);
  const url = urlSpan?.url;
  if (!url) return null;

  const tailWithoutUrl = stripTrailingPeriod(normalizeWhitespace(
    removeUrlSpan(remainder, urlSpan)
      .replace(/\bAvailable from:\s*/i, ''),
  ));
  const normalizedTail = normalizeWhitespace(tailWithoutUrl).replace(/[()]/g, '');
  const year = extractLastYear(remainder) ?? extractLastYear(leadingSegment);
  const title = stripTrailingPeriod(leadingSegment);
  const doi = deriveDoiHintFromUrl(url);

  if (!title || !year) return null;
  if (normalizedTail && normalizedTail !== year) return null;

  const parsed: ParsedReference = {
    title,
    year,
    url,
    doi,
    parseWarnings: ['title-led-website-heuristic'],
  };

  return {
    branch: 'institutional_heuristic_raw',
    normalized,
    parsed,
    referenceType: 'website',
    warnings: parsed.parseWarnings ?? [],
  };
}

function hasWebsiteAccessSignals(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return /\b(?:viewed|accessed)\b/i.test(normalized)
    || /\[(?:online)\]/i.test(normalized)
    || /\bavailable(?:\s+at|\s+from)?\b/i.test(normalized);
}

function extractWebsiteContainerSegment(value: string): string | undefined {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return undefined;

  const withoutUrl = normalizeWhitespace(removeUrlSpan(normalized, extractUrlSpan(normalized)));
  const trimmed = withoutUrl
    .replace(/\[(?:online)\]/ig, ' ')
    .replace(/\b(?:viewed|accessed)\b[\s\S]*$/i, ' ')
    .replace(/\bavailable(?:\s+at|\s+from)?\b[\s\S]*$/i, ' ')
    .replace(/\bver(?:sion)?\.?\s*[A-Za-z0-9.-]+/i, ' ')
    .replace(/\b(?:1[5-9]\d{2}|20\d{2})\b/g, ' ')
    .replace(/[.,;:]+\s*[.,;:]+/g, ' ')
    .replace(/\s+[.,;:]+/g, ' ')
    .replace(/^[,;:\s]+|[,;:\s]+$/g, ' ');

  const cleaned = cleanContainerTitle(trimmed);
  return cleaned || undefined;
}

function extractWebsiteEdition(value: string): string | undefined {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return undefined;
  const versionMatch = normalized.match(/\bver(?:sion)?\.?\s*[A-Za-z0-9.-]+/i);
  return versionMatch ? normalizeWhitespace(versionMatch[0]) : undefined;
}

function extractWebsitePublicationYear(value: string): string | undefined {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return undefined;
  const withoutAccessDates = normalized
    .replace(/\b(?:viewed|accessed)\b[\s\S]*$/i, ' ')
    .replace(/\bavailable(?:\s+at|\s+from)?\b[\s\S]*$/i, ' ');
  return extractLastYear(withoutAccessDates);
}

function extractInstitutionalTitleNote(value: string): { title: string | undefined; edition: string | undefined } {
  const cleaned = stripTrailingPeriod(normalizeWhitespace(value));
  if (!cleaned) {
    return { title: undefined, edition: undefined };
  }

  const noteMatch = cleaned.match(/^(?<title>.+?)\s*\((?<note>[^)]+)\)$/);
  const rawTitle = noteMatch?.groups?.title ?? cleaned;
  const rawNote = noteMatch?.groups?.note;
  const title = cleanContainerTitle(rawTitle);
  const edition = rawNote && /\b(?:report\s+no\.?|guideline|statement|manual|handbook|version|ver\.?)\b/i.test(rawNote)
    ? normalizeWhitespace(rawNote)
    : undefined;

  return {
    title: title || undefined,
    edition,
  };
}

function buildInstitutionalWebsiteCandidate(
  normalized: string,
  author: string,
  title: string,
  remainder: string,
  year: string | undefined,
): ParsedSelectionCandidate | null {
  const url = extractUrlSpan(remainder)?.url;
  if (!url) return null;
  if (!hasWebsiteAccessSignals(remainder) && !/\b(?:nature\.com|doi\.org)\b/i.test(url)) return null;

  const normalizedAuthor = normalizeInstitutionalAuthor(author);
  const cleanedTitle = cleanContainerTitle(title);
  const inferredYear = year ?? extractWebsitePublicationYear(remainder);
  if (!normalizedAuthor || !cleanedTitle) return null;

  const container = extractWebsiteContainerSegment(remainder);
  const edition = extractWebsiteEdition(remainder);
  const institution = container && normalizeWhitespace(container.toLowerCase()) !== normalizeWhitespace(normalizedAuthor.toLowerCase())
    ? container
    : normalizedAuthor;
  const parsed: ParsedReference = {
    authors: [normalizedAuthor],
    title: cleanedTitle,
    year: inferredYear,
    url,
    doi: deriveDoiHintFromUrl(url),
    institution,
    edition,
    parseWarnings: ['institutional-access-website-heuristic'],
  };

  return {
    branch: 'institutional_heuristic_raw',
    normalized,
    parsed,
    referenceType: 'website',
    warnings: parsed.parseWarnings ?? [],
  };
}

function buildInstitutionalAuthorYearCandidate(normalized: string): ParsedSelectionCandidate | null {
  const apaAuthorYearMatch = normalized.match(/^(?<author>.+?)\s*\((?<year>(?:1[5-9]\d{2}|20\d{2}))\)\.\s*(?<remainder>.+)$/);
  if (apaAuthorYearMatch?.groups && looksLikeInstitutionalLead(apaAuthorYearMatch.groups.author ?? '')) {
    const normalizedAuthor = normalizeInstitutionalAuthor(apaAuthorYearMatch.groups.author ?? '');
    const fixedYear = normalizeParsedYear(apaAuthorYearMatch.groups.year);
    let remainder = normalizeWhitespace(apaAuthorYearMatch.groups.remainder ?? '');
    if (!normalizedAuthor || !remainder || !fixedYear) return null;

    const directWebsite = buildInstitutionalWebsiteCandidate(
      normalized,
      normalizedAuthor,
      remainder,
      remainder,
      fixedYear,
    );
    if (directWebsite) return directWebsite;

    const doi = normalized.match(DOI_PATTERN)?.[0];
    const urlSpan = extractUrlSpan(remainder);
    const url = urlSpan?.url;
    remainder = normalizeWhitespace(removeUrlSpan(remainder, urlSpan));

    let publisher: string | undefined;
    let placeOfPublication: string | undefined;
    let edition: string | undefined;
    const reportNumberMatch = remainder.match(/\((Report No\.?\s*[^)]+)\)/i) ?? remainder.match(/\bReport No\.?:\s*([^.;]+)/i);
    if (reportNumberMatch) {
      edition = normalizeWhitespace((reportNumberMatch[1] ?? reportNumberMatch[0]).replace(/^\(|\)$/g, '')) || undefined;
      remainder = normalizeWhitespace(remainder.replace(reportNumberMatch[0], ''));
    }
    const titlePlacePublisherMatch = stripTrailingPeriod(remainder).match(/^(?<title>.+?)\.\s+(?<place>[^:]+):\s*(?<publisher>[^.]+)$/);
    if (titlePlacePublisherMatch?.groups) {
      placeOfPublication = normalizeWhitespace(titlePlacePublisherMatch.groups.place ?? '') || undefined;
      publisher = normalizeWhitespace(titlePlacePublisherMatch.groups.publisher ?? '') || undefined;
      remainder = normalizeWhitespace(titlePlacePublisherMatch.groups.title ?? '');
    }
    const placePublisherMatch = stripTrailingPeriod(remainder).match(PLACE_PUBLISHER_PATTERN);
    if (!publisher && placePublisherMatch) {
      placeOfPublication = normalizeWhitespace(placePublisherMatch[1] ?? '') || undefined;
      publisher = normalizeWhitespace(placePublisherMatch[2] ?? '') || undefined;
      remainder = normalizeWhitespace(stripTrailingPeriod(remainder).replace(PLACE_PUBLISHER_PATTERN, ''));
    }

    const extractedNote = extractInstitutionalTitleNote(remainder);
    const title = extractedNote.title;
    edition = edition ?? extractedNote.edition;
    if (!title) return null;

    let referenceType: ParsedSelectionCandidate['referenceType'] = 'report';
    if (edition && /\b(?:manual|handbook|style|guide)\b/i.test(`${title} ${edition}`)) {
      referenceType = 'book';
    } else if (url && !publisher) {
      referenceType = 'website';
    }

    const parsed: ParsedReference = {
      authors: [normalizedAuthor],
      title,
      year: fixedYear,
      doi: doi ? normalizeDoiValue(doi) : deriveDoiHintFromUrl(url),
      publisher,
      url,
      institution: referenceType === 'report' || referenceType === 'preprint'
        ? normalizedAuthor
        : publisher ?? normalizedAuthor,
      edition,
      placeOfPublication,
      parseWarnings: ['institutional-author-year-heuristic'],
    };

    return {
      branch: 'institutional_heuristic_raw',
      normalized,
      parsed,
      referenceType,
      warnings: parsed.parseWarnings ?? [],
      styleUsed: 'apa',
      styleConfidence: 0.92,
    };
  }

  const harvardWebsiteMatch = normalized.match(/^(?<author>.+?)\s+(?<year>(?:1[5-9]\d{2}|20\d{2}))\s*,\s*['"](?<title>[^'"]+)['"]\s*,?\s*(?<remainder>.+)$/);
  if (harvardWebsiteMatch?.groups && looksLikeInstitutionalLead(harvardWebsiteMatch.groups.author ?? '')) {
    const candidate = buildInstitutionalWebsiteCandidate(
      normalized,
      harvardWebsiteMatch.groups.author ?? '',
      harvardWebsiteMatch.groups.title ?? '',
      harvardWebsiteMatch.groups.remainder ?? '',
      harvardWebsiteMatch.groups.year,
    );
    if (candidate) return candidate;
  }

  const quotedWebsiteMatch = normalized.match(/^(?:\[\d+\]\s*)?(?<author>.+?)(?:,|\.)\s*"(?<title>[^"]+?)"[,.]?\s*(?<remainder>.+)$/);
  if (quotedWebsiteMatch?.groups && looksLikeInstitutionalLead(quotedWebsiteMatch.groups.author ?? '')) {
    const candidate = buildInstitutionalWebsiteCandidate(
      normalized,
      quotedWebsiteMatch.groups.author ?? '',
      quotedWebsiteMatch.groups.title ?? '',
      quotedWebsiteMatch.groups.remainder ?? '',
      undefined,
    );
    if (candidate) return candidate;
  }

  return null;
}

function looksLikePublisherSegment(value: string): boolean {
  const normalized = cleanContainerTitle(value);
  if (!normalized) return false;
  if (PUBLISHER_SEGMENT_PATTERN.test(normalized)) return true;
  return /^(?:[A-Z]{2,10}|[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+Press)$/.test(normalized);
}

function normalizePublisherName(publisher: string | undefined, place: string | undefined): string | undefined {
  const normalizedPublisher = cleanContainerTitle(publisher ?? '');
  const normalizedPlace = cleanContainerTitle(place ?? '');
  if (!normalizedPublisher) return undefined;
  if (/^springer$/i.test(normalizedPublisher) && normalizedPlace) {
    return normalizeWhitespace(`${normalizedPublisher} ${normalizedPlace.replace(/,\s*/g, ' ')}`);
  }
  return normalizedPublisher;
}

function normalizeConferenceContainer(segments: string[]): string | undefined {
  const cleanedSegments = segments
    .map((segment) => cleanContainerTitle(segment))
    .map((segment) => segment.replace(/^Proc\.?\s+/i, 'Proceedings of the '))
    .filter((segment) => segment && !/^(?:19|20)\d{2}$/.test(segment));
  if (cleanedSegments.length === 0) return undefined;

  const signalIndex = cleanedSegments.findIndex((segment) => CONFERENCE_SIGNAL_PATTERN.test(segment));
  if (signalIndex === -1) {
    return normalizeWhitespace(cleanedSegments.join(', '));
  }

  const signalSegment = cleanedSegments[signalIndex];
  const remaining = cleanedSegments.filter((_, index) => index !== signalIndex);
  if (remaining.length === 0) return signalSegment;

  if (/\b(?:on|for|of)$/i.test(signalSegment)) {
    return normalizeWhitespace(`${signalSegment} ${remaining.join(', ')}`);
  }

  return normalizeWhitespace(cleanedSegments.join(', '));
}

function extractProceedingsTailSegment(value: string): string | undefined {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return undefined;
  const match = normalized.match(/\b(?<tail>(?:proceedings|proc\.?|book of abstracts|abstracts?)\b[^.;]*(?:\b(?:1[5-9]\d{2}|20\d{2})\b)?)/i);
  return cleanContainerTitle(match?.groups?.tail ?? '');
}

function extractTrailingAuthorLeadYear(value: string): { authorLead: string; year: string | undefined } {
  const normalized = stripTrailingPeriod(normalizeWhitespace(value));
  if (!normalized) return { authorLead: '', year: undefined };

  const parentheticalYearMatch = normalized.match(/^(?<authors>.+?)\s*\((?<year>(?:1[5-9]\d{2}|20\d{2})[a-z]?)\)$/i);
  if (parentheticalYearMatch?.groups) {
    return {
      authorLead: normalizeWhitespace(parentheticalYearMatch.groups.authors ?? ''),
      year: normalizeParsedYear(parentheticalYearMatch.groups.year),
    };
  }

  const trailingYearMatch = normalized.match(/^(?<authors>.+?)[,;]?\s+(?<year>(?:1[5-9]\d{2}|20\d{2})[a-z]?)$/i);
  if (trailingYearMatch?.groups) {
    return {
      authorLead: normalizeWhitespace(trailingYearMatch.groups.authors ?? ''),
      year: normalizeParsedYear(trailingYearMatch.groups.year),
    };
  }

  return {
    authorLead: normalized,
    year: undefined,
  };
}

function splitAlternatingAuthorPairs(value: string): string[] | undefined {
  const normalized = normalizeWhitespace(
    value
      .replace(/\s*,?\s+(?:and|&)\s+/gi, ', ')
      .replace(/\s*,\s*,/g, ', ')
      .replace(/,\s*$/, ''),
  );
  if (!normalized.includes(',')) return undefined;

  const parts = normalized.split(/\s*,\s*/).map((segment) => normalizeWhitespace(segment)).filter(Boolean);
  if (parts.length < 4 || parts.length % 2 !== 0) return undefined;
  if (parts.some((part) => /^(?:19|20)\d{2}[a-z]?$/i.test(part))) return undefined;
  if (parts.some((part, index) => (
    index % 2 === 0
      ? !/^[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){0,4}$/u.test(part)
      : !/^[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){0,5}$/u.test(part)
  ))) {
    return undefined;
  }

  const authors: string[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    authors.push(normalizeWhitespace(`${parts[index]}, ${parts[index + 1]}`));
  }
  return authors.filter(Boolean);
}

function buildAuthorsFromInSourceLead(value: string, inputStyle: string): string[] | undefined {
  const normalized = stripTrailingPeriod(normalizeWhitespace(value).replace(/^\[\d+\]\s*/, ''));
  if (!normalized) return undefined;

  const alternatingPairs = splitAlternatingAuthorPairs(normalized);
  if (alternatingPairs?.length) {
    const alternatingParse = parseAuthorsForStyle(
      alternatingPairs,
      inputStyle === 'auto' || inputStyle === 'vancouver' || inputStyle === 'ieee'
        ? 'apa'
        : inputStyle,
    );
    const rendered = alternatingParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
    if (rendered.length > 0) return rendered;
  }

  const explicitLeadAndTail = normalized.match(/^([^,]+,\s*[^,]+),\s*(?:and|&)\s+(.+)$/i);
  if (explicitLeadAndTail) {
    return [
      normalizeWhitespace(explicitLeadAndTail[1] ?? ''),
      normalizeWhitespace(explicitLeadAndTail[2] ?? ''),
    ].filter(Boolean);
  }

  const invertedThenLead = normalized.match(/^([^,]+),\s*([^,]+),\s*(?:and|&)\s+(.+)$/i);
  if (invertedThenLead) {
    return [
      normalizeWhitespace(`${invertedThenLead[1]}, ${invertedThenLead[2]}`),
      normalizeWhitespace(invertedThenLead[3] ?? ''),
    ].filter(Boolean);
  }

  const looksLikeSingleInvertedAuthor = /^[^,]+,\s*[^,]+$/u.test(normalized);
  const compactVancouverAuthors = splitCompactAuthorSeries(normalized);
  if (!looksLikeSingleInvertedAuthor && compactVancouverAuthors.length >= 2) {
    const compactParse = parseAuthorsForStyle(compactVancouverAuthors, 'vancouver');
    const rendered = compactParse.authors.map((author) => renderAuthor(author)).filter(Boolean);
    if (rendered.length > 0) return rendered;
  }

  const leadingInvertedAuthor = normalized.match(
    /^(?<first>[^,]+,\s*(?:[\p{Lu}]\.?\s*){1,6})(?:,\s*(?<rest>.+))$/u,
  );
  if (leadingInvertedAuthor?.groups) {
    const first = normalizeWhitespace(leadingInvertedAuthor.groups.first ?? '');
    const restSegments = normalizeWhitespace(leadingInvertedAuthor.groups.rest ?? '')
      .replace(/\s*,?\s+(?:and|&)\s+/gi, ', ')
      .split(/\s*,\s*/)
      .map((segment) => stripLeadingAuthorConjunction(segment))
      .filter(Boolean);
    if (
      first
      && restSegments.length > 0
      && restSegments.every((segment) => (
        /^[\p{Lu}](?:\.?\s*[\p{Lu}])*\.?\s+[\p{L}]/u.test(segment)
        || looksLikeFullNameAuthorSegment(segment)
        || segment.includes(',')
      ))
    ) {
      return [first, ...restSegments];
    }
  }

  const compactAuthorLead = normalizeWhitespace(
    normalized
      .replace(/\s*,?\s+(?:and|&)\s+/i, ', ')
      .replace(/\s*,\s*,/g, ', ')
      .replace(/,\s*$/, ''),
  );
  const compactAuthorSegments = compactAuthorLead
    .split(/\s*,\s*/)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);
  if (
    compactAuthorSegments.length >= 3
    && compactAuthorSegments.length <= 10
    && /^[\p{Lu}]\.?$/u.test(compactAuthorSegments[1] ?? '')
    && compactAuthorSegments.every((segment, index) => (
      index === 0
        ? /^[\p{Lu}][\p{L}'’-]+$/u.test(segment)
        : /^(?:[\p{Lu}]\.?|[\p{Lu}]\.?\s+[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){0,2}|[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){0,3})$/u.test(segment)
    ))
  ) {
    return compactAuthorSegments.reduce<string[]>((authors, segment, index) => {
      if (index === 0 && compactAuthorSegments[index + 1] && /^[\p{Lu}]\.?$/u.test(compactAuthorSegments[index + 1] ?? '')) {
        authors.push(normalizeWhitespace(`${segment}, ${compactAuthorSegments[index + 1]}`));
        return authors;
      }
      if (index === 1 && /^[\p{Lu}]\.?$/u.test(segment)) return authors;
      authors.push(segment);
      return authors;
    }, []).filter(Boolean);
  }

  if (/\s+(?:and|&)\s+/i.test(normalized)) {
    return normalized.split(/\s+(?:and|&)\s+/i).map((segment) => normalizeWhitespace(segment)).filter(Boolean);
  }

  const commaSegments = normalized.split(/\s*,\s*/).map((segment) => normalizeWhitespace(segment)).filter(Boolean);
  if (commaSegments.length === 2) {
    return [normalizeWhitespace(`${commaSegments[0]}, ${commaSegments[1]}`)];
  }
  if (commaSegments.length >= 4 && commaSegments.length % 2 === 0) {
    const authors: string[] = [];
    for (let index = 0; index < commaSegments.length; index += 2) {
      authors.push(normalizeWhitespace(`${commaSegments[index]}, ${commaSegments[index + 1]}`));
    }
    return authors.filter(Boolean);
  }

  return [normalized];
}

function buildInSourceCandidate(input: string, inputStyle: string): ParsedSelectionCandidate | null {
  const parser = getParser();
  const normalized = preNormalizeExtractorInput(parser, input);
  const match = normalized.match(IN_SOURCE_QUOTED_PATTERN) ?? normalized.match(IN_SOURCE_PLAIN_PATTERN);
  if (!match?.groups) return null;

  const extractedAuthorLead = extractTrailingAuthorLeadYear(match.groups.authors ?? '');
  const authorLead = stripTrailingPeriod(extractedAuthorLead.authorLead);
  const title = stripTrailingPeriod(match.groups.title ?? '');
  if (!authorLead || !title) return null;

  const year = extractedAuthorLead.year ?? normalizeParsedYear(match.groups.tail ?? normalized);
  if (!year) return null;

  const doi = normalized.match(DOI_PATTERN)?.[0];
  const explicitLocator = match.groups.tail?.match(IN_SOURCE_LOCATOR_PATTERN)?.groups?.pages;
  const tailWithoutDoi = normalizeWhitespace((match.groups.tail ?? '')
    .replace(/\bdoi:\s*/i, '')
    .replace(DOI_PATTERN, '')
    .replace(URL_PATTERN, ''));
  const tailWithoutYear = tailWithoutDoi.replace(new RegExp(`[;,.\\s]+${year}[.]?$`), '');
  const bareLocatorMatch = tailWithoutYear.match(
    /(?:^|,\s*)(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)(?=\.\s+[^.]+(?:\.[^.]+)*$)/i,
  );
  const locator = normalizeWhitespace(explicitLocator ?? bareLocatorMatch?.groups?.pages ?? '')
    .replace(/\s*[-–]\s*/g, '-')
    || undefined;
  const tailWithoutLocator = normalizeWhitespace(
    tailWithoutYear
      .replace(IN_SOURCE_LOCATOR_PATTERN, '')
      .replace(
        /(?:^|,\s*)(?<pages>[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?)(?=\.\s+[^.]+(?:\.[^.]+)*$)/i,
        '',
      ),
  );
  const segments = splitSentenceSegments(tailWithoutLocator)
    .map((segment) => cleanContainerTitle(segment))
    .filter((segment) => segment && segment.toLowerCase() !== 'in');
  if (segments.length === 0) return null;

  const hasEditorSignal = /\b(?:edited by|editor(?:s)?\b|\(eds?\.?\)|\beds?\.?\b)/i.test(normalized);
  const publisherTailPresent = segments.some((segment) =>
    /^©/.test(segment)
    || looksLikePublisherSegment(segment)
    || looksLikeCommercialPublisherName(segment)
  );
  const likelyBookishContainer = looksBookishContainerTitle(segments[0] ?? '');
  const likelyNumberedChapter = looksNumberedChapterTitle(title);
  const copyrightProceedingsLike = /\bIn:?\s+/i.test(normalized)
    && !hasEditorSignal
    && segments.length <= 3
    && segments.some((segment) => /^©/.test(segment))
    && publisherTailPresent
    && !likelyBookishContainer
    && !likelyNumberedChapter;
  const publisherTail = segments.find((segment) =>
    /^©/.test(segment)
    || looksLikePublisherSegment(segment)
    || looksLikeCommercialPublisherName(segment)
  );
  const explicitConferenceSignal = segments.some((segment) =>
    CONFERENCE_SIGNAL_PATTERN.test(segment)
    || /\b(?:electronic poster abstracts?|poster abstracts?)\b/i.test(segment),
  );
  const proceedingsSeriesLike = !hasEditorSignal
    && !likelyBookishContainer
    && !likelyNumberedChapter
    && segments.length <= 2
    && looksProceedingsSeriesContainer(segments[0] ?? '', publisherTail, doi);
  const proceedingsDoiFamilyLike = !hasEditorSignal
    && !likelyBookishContainer
    && !likelyNumberedChapter
    && looksConferenceProceedingsDoiFamily(doi);
  const bookChapterDoiFamilyLike = !hasEditorSignal && looksBookChapterDoiFamily(doi);
  const weakConferenceEvidence = segments.some((segment) => /\bvolume\s+\d+\s*:/i.test(segment))
    || copyrightProceedingsLike
    || proceedingsSeriesLike;
  const conferenceLike = explicitConferenceSignal
    || proceedingsDoiFamilyLike
    || (!bookChapterDoiFamilyLike && weakConferenceEvidence);
  const authors = buildAuthorsFromInSourceLead(authorLead, inputStyle);

  if (conferenceLike) {
    const conferenceSegments = segments
      .flatMap((segment) => segment.split(/\s*,\s*/))
      .map((segment) => cleanContainerTitle(segment))
      .filter(Boolean);
    const trailingSegment = conferenceSegments[conferenceSegments.length - 1];
    let publisher = trailingSegment && (
      /^©/.test(trailingSegment)
      || looksLikePublisherSegment(trailingSegment)
      || looksLikeCommercialPublisherName(trailingSegment)
    )
      ? cleanContainerTitle(conferenceSegments.pop())
      : undefined;
    let conferenceTitle = normalizeConferenceContainer(conferenceSegments);
    if (!conferenceTitle) return null;
    if (!publisher) {
      const splitConference = splitTrailingPublisherFromConferenceTitle(conferenceTitle);
      conferenceTitle = splitConference.conferenceTitle;
      publisher = splitConference.publisher;
    }

    const parsed: ParsedReference = {
      authors,
      title,
      year,
      conferenceTitle,
      pages: locator ? locator.replace(/\s*[-–]\s*/g, '-') : undefined,
      publisher,
      doi: doi ? normalizeDoiValue(doi) : undefined,
      parseWarnings: ['in-source-container-heuristic'],
    };

    return {
      branch: 'in_source_heuristic_raw',
      normalized,
      parsed,
      referenceType: 'conference',
      warnings: parsed.parseWarnings ?? [],
    };
  }

  const [bookTitleSegment, ...tailSentenceSegments] = segments;
  const bookTitle = cleanContainerTitle(bookTitleSegment);
  if (!bookTitle) return null;

  const tailSegments = tailSentenceSegments
    .flatMap((segment) => segment.split(/\s*,\s*/))
    .map((segment) => cleanContainerTitle(segment))
    .filter(Boolean);
  let publisher: string | undefined;
  let placeOfPublication: string | undefined;
  if (tailSegments.length > 0) {
    const publisherIndex = tailSegments.findIndex((segment) => looksLikePublisherSegment(segment));
    if (publisherIndex >= 0) {
      const publisherSeed = tailSegments[publisherIndex];
      const placeSeed = tailSegments.slice(publisherIndex + 1)
        .filter((segment) => PLACE_SEGMENT_PATTERN.test(segment))
        .join(', ');
      placeOfPublication = normalizeWhitespace(placeSeed) || undefined;
      const normalizedPublisher = normalizePublisherName(publisherSeed, placeSeed);
      publisher = placeOfPublication && normalizedPublisher
        ? normalizeWhitespace(`${placeOfPublication}: ${normalizedPublisher}`)
        : normalizedPublisher;
    } else {
      const placeSeed = tailSegments.slice(1).join(', ');
      placeOfPublication = normalizeWhitespace(placeSeed) || undefined;
      const normalizedPublisher = normalizePublisherName(tailSegments[0], placeSeed);
      publisher = placeOfPublication && normalizedPublisher
        ? normalizeWhitespace(`${placeOfPublication}: ${normalizedPublisher}`)
        : normalizedPublisher;
    }
  }

  const parsed: ParsedReference = {
    authors,
    title,
    year,
    bookTitle,
    pages: locator ? locator.replace(/\s*[-–]\s*/g, '-') : undefined,
    publisher,
    placeOfPublication,
    doi: doi ? normalizeDoiValue(doi) : undefined,
    parseWarnings: ['in-source-container-heuristic'],
  };

  return {
    branch: 'in_source_heuristic_raw',
    normalized,
    parsed,
    referenceType: 'chapter',
    warnings: parsed.parseWarnings ?? [],
  };
}

function buildInstitutionalCandidate(input: string): ParsedSelectionCandidate | null {
  const parser = getParser();
  const normalized = preNormalizeExtractorInput(parser, input);
  const authorYearCandidate = buildInstitutionalAuthorYearCandidate(normalized);
  if (authorYearCandidate) return authorYearCandidate;
  const authorMatch = normalized.match(/^(.+?)\.\s+(.+)$/);
  if (!authorMatch) return null;

  const leadingSegment = stripTrailingPeriod(authorMatch[1] ?? '');
  let remainder = normalizeWhitespace(authorMatch[2] ?? '');
  if (!remainder) return null;
  if (looksLikeInitialsOnlyLead(leadingSegment)) {
    return null;
  }
  const likelyInstitutionalTail = INSTITUTIONAL_TAIL_PATTERN.test(remainder);
  if (!looksLikeInstitutionalLead(leadingSegment)) {
    const titleLedWebsite = buildTitleLedWebsiteCandidate(normalized, leadingSegment, remainder);
    if (titleLedWebsite) return titleLedWebsite;
    if (!likelyInstitutionalTail || PERSONAL_AUTHOR_LEAD_PATTERN.test(leadingSegment)) {
      return null;
    }
  }

  const looksLikeReportTail = /\breport\s+no\.?/i.test(remainder)
    || PLACE_PUBLISHER_YEAR_PATTERN.test(stripTrailingPeriod(remainder));
  if (hasWebsiteAccessSignals(remainder) && !looksLikeReportTail) {
    const websiteMatch = remainder.match(/^(?<title>.+?)\.\s+(?<tail>.+)$/);
    if (websiteMatch?.groups) {
      const directWebsite = buildInstitutionalWebsiteCandidate(
        normalized,
        leadingSegment,
        websiteMatch.groups.title ?? '',
        websiteMatch.groups.tail ?? '',
        undefined,
      );
      if (directWebsite) return directWebsite;
    }
  }

  const doiMatch = normalized.match(DOI_PATTERN);
  const doi = doiMatch ? normalizeDoiValue(doiMatch[0]) : undefined;

  let url = cleanTrailingUrl(remainder.match(/\bAvailable from:\s*(https?:\/\/\S+)/i)?.[1]);
  if (url) {
    remainder = normalizeWhitespace(remainder.replace(/\bAvailable from:\s*https?:\/\/\S+/i, ''));
  } else {
    url = cleanTrailingUrl(remainder.match(URL_PATTERN)?.[0]);
    if (url) {
      remainder = normalizeWhitespace(remainder.replace(URL_PATTERN, ''));
    }
  }

  let publisher: string | undefined;
  let placeOfPublication: string | undefined;
  let year = extractLastYear(normalized);
  let edition: string | undefined;
  const reportNumberMatch = remainder.match(/\bReport No\.?:\s*([^.;]+)/i);
  if (reportNumberMatch) {
    edition = normalizeWhitespace(`Report No.: ${reportNumberMatch[1] ?? ''}`) || edition;
    remainder = normalizeWhitespace(remainder.replace(reportNumberMatch[0], ''));
  }
  const inlinePlacePublisherYearMatch = stripTrailingPeriod(remainder).match(/(?<place>[^.;]+?):\s*(?<publisher>[^.;]+?)\s*;\s*(?<year>(?:1[5-9]\d{2}|20\d{2}))/i);
  if (inlinePlacePublisherYearMatch?.groups) {
    placeOfPublication = normalizeWhitespace(inlinePlacePublisherYearMatch.groups.place ?? '') || undefined;
    publisher = normalizeWhitespace(inlinePlacePublisherYearMatch.groups.publisher ?? '') || undefined;
    year = year ?? inlinePlacePublisherYearMatch.groups.year;
    remainder = normalizeWhitespace(stripTrailingPeriod(remainder).replace(inlinePlacePublisherYearMatch[0], ''));
  }
  const titlePlacePublisherMatch = stripTrailingPeriod(remainder).match(/^(?<title>.+?)\.\s+(?<place>[^:]+):\s*(?<publisher>[^.]+)$/);
  if (titlePlacePublisherMatch?.groups) {
    placeOfPublication = normalizeWhitespace(titlePlacePublisherMatch.groups.place ?? '') || undefined;
    publisher = normalizeWhitespace(titlePlacePublisherMatch.groups.publisher ?? '') || undefined;
    remainder = normalizeWhitespace(titlePlacePublisherMatch.groups.title ?? '');
  }
  const placePublisherYearMatch = stripTrailingPeriod(remainder).match(PLACE_PUBLISHER_YEAR_PATTERN);
  if (!publisher && placePublisherYearMatch) {
    placeOfPublication = normalizeWhitespace(placePublisherYearMatch[1] ?? '') || undefined;
    publisher = normalizeWhitespace(placePublisherYearMatch[2] ?? '') || undefined;
    year = year ?? placePublisherYearMatch[3];
    remainder = normalizeWhitespace(stripTrailingPeriod(remainder).replace(PLACE_PUBLISHER_YEAR_PATTERN, ''));
  } else {
    const strippedRemainder = stripTrailingPeriod(remainder);
    const metadataYearMatch = strippedRemainder.match(METADATA_YEAR_PATTERN);
    if (metadataYearMatch && looksLikeInstitutionalMetadataSegment(metadataYearMatch[1] ?? '')) {
      edition = normalizeWhitespace(metadataYearMatch[1] ?? '') || undefined;
      year = year ?? metadataYearMatch[2];
      remainder = normalizeWhitespace(strippedRemainder.replace(METADATA_YEAR_PATTERN, ''));
    } else {
      const placeYearMatch = strippedRemainder.match(PLACE_YEAR_PATTERN);
      if (placeYearMatch) {
        if (looksLikeInstitutionalMetadataSegment(placeYearMatch[1] ?? '')) {
          placeOfPublication = undefined;
        } else {
          placeOfPublication = normalizeWhitespace(placeYearMatch[1] ?? '') || undefined;
        }
        year = year ?? placeYearMatch[2];
        remainder = normalizeWhitespace(strippedRemainder.replace(PLACE_YEAR_PATTERN, ''));
        if (!edition && looksLikeInstitutionalMetadataSegment(placeYearMatch[1] ?? '')) {
          edition = normalizeWhitespace(placeYearMatch[1] ?? '') || undefined;
        }
      }
    }
  }

  const segments = splitSentenceSegments(remainder);
  if (segments.length === 0) return null;

  let preprint = false;
  const titleSegments: string[] = [];
  for (const segment of segments) {
    const metadataYear = segment.match(METADATA_YEAR_PATTERN);
    if (metadataYear && looksLikeInstitutionalMetadataSegment(metadataYear[1] ?? '')) {
      edition = edition ?? (normalizeWhitespace(metadataYear[1] ?? '') || undefined);
      year = year ?? metadataYear[2];
      continue;
    }

    if (YEAR_ONLY_SEGMENT_PATTERN.test(segment)) {
      year = year ?? segment.match(YEAR_ONLY_SEGMENT_PATTERN)?.[1];
      continue;
    }

    const updatedYear = segment.match(UPDATED_YEAR_PATTERN)?.[1];
    if (updatedYear) {
      year = year ?? updatedYear;
      continue;
    }

    if (ARXIV_SEGMENT_PATTERN.test(segment)) {
      preprint = true;
      const arxivId = cleanTrailingUrl(segment.match(ARXIV_ID_PATTERN)?.[1]);
      if (!url && arxivId) {
        url = `https://arxiv.org/abs/${arxivId.replace(/^arXiv:/i, '')}`;
      }
      continue;
    }

    if (!edition && looksLikeInstitutionalMetadataSegment(segment)) {
      edition = segment;
      continue;
    }

    titleSegments.push(segment);
  }

  let title = normalizeWhitespace(titleSegments.join('. '));
  if (!title) return null;

  let referenceType: ParsedSelectionCandidate['referenceType'] = 'report';
  if (preprint) {
    referenceType = 'preprint';
  } else if (edition && /\b(?:ed(?:ition)?|manual|handbook|style|guide)\b/i.test(`${title} ${edition}`)) {
    referenceType = 'book';
  } else if (url && !publisher) {
    referenceType = 'website';
  }

  const normalizedAuthor = normalizeInstitutionalAuthor(leadingSegment);
  const parsed: ParsedReference = {
    authors: [normalizedAuthor],
    title,
    year,
    doi,
    publisher,
    url,
    institution: referenceType === 'report' || referenceType === 'preprint' ? normalizedAuthor : publisher ?? normalizedAuthor,
    edition,
    placeOfPublication,
    journal: preprint ? 'arXiv preprint' : undefined,
    parseWarnings: ['institutional-heuristic'],
  };

  return {
    branch: 'institutional_heuristic_raw',
    normalized,
    parsed,
    referenceType,
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
  if (isGrobidCoolingDown()) {
    return null;
  }
  const baseUrl = (process.env.GROBID_URL ?? 'http://localhost:8070').replace(/\/$/, '');
  const body = new URLSearchParams({
    citations: input,
    consolidateCitations: '0',
    includeRawCitations: '1',
  });
  const timeoutMs = readPositiveIntEnv('GROBID_TIMEOUT_MS', DEFAULT_GROBID_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/api/processCitation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 503) {
        openGrobidCooldown(`status_${response.status}`);
      }
      throw new Error(`GROBID ${response.status}`);
    }

    const tei = await response.text();
    if (!tei.trim()) return null;
    return parseGrobidTei(tei);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timed out') || message.includes('TimeoutError') || message.includes('AbortError')) {
      openGrobidCooldown('timeout');
    }
    throw error;
  }
}

function looksLikeDateFragment(value: string | undefined): boolean {
  if (!value) return false;
  return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(value) || /^\d{1,2}[;:/]/.test(value);
}

function looksLikeMergedAuthorBlob(author: string): boolean {
  const normalized = normalizeWhitespace(author);
  if (looksLikeAuthorContentLeak(normalized)) return true;
  const commaCount = (normalized.match(/,/g) ?? []).length;
  return !isGroupAuthor(normalized) && (commaCount >= 2 || /\b(?:and|&)\b/.test(normalized));
}

function looksLikeCleanInvertedAuthor(author: string): boolean {
  return /^[^,]+,\s*(?:[\p{Lu}]\.?\s*){1,6}$/u.test(normalizeWhitespace(author));
}

function shouldIgnoreSingleCharacterTailPenalty(authors: string[] | undefined): boolean {
  return Boolean(authors?.length)
    && authors!.every((author) => looksLikeCleanInvertedAuthor(author) && !looksLikeMergedAuthorBlob(author));
}

function isPlaceholderVenue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized === 'vol' || normalized === 'vol.' || normalized === 'journal' || normalized === '?';
}

function scoreCandidate(parsed: ParsedReference | null | undefined, referenceType?: string): number {
  if (!parsed) return -999;
  const normalizedReferenceType = referenceType ?? 'journal';
  const requirements = getRequirementProfile(normalizedReferenceType);
  const authorSignals = analyzeParsedAuthorStrings(parsed.authors);
  const singleCharacterTailCount = shouldIgnoreSingleCharacterTailPenalty(parsed.authors) ? 0 : authorSignals.singleCharacterTailCount;
  const locatorValue = parsed.pages ?? parsed['article-number'];
  const titleLooksLikeLocator = looksLikeLocatorOnlyTitle(parsed.title);
  const suspiciousWebsiteAuthorState = looksLikeUrlLedWebsitePseudoAuthorParse(parsed, normalizedReferenceType);
  let score = 0;
  if (parsed.title && !titleLooksLikeLocator && parsed.title.split(/\s+/).length >= 4 && !looksLikeDateFragment(parsed.title) && !looksLikeSourceTailFragment(parsed.title)) score += 4;
  else if (parsed.title && !titleLooksLikeLocator && !looksLikeSourceTailFragment(parsed.title)) score += 1.5;
  if (parsed.year) score += 2.5;
  if (hasParsedVenue(parsed)) score += 3;
  if (parsed.publisher || parsed.institution) score += 1.5;
  if (normalizedReferenceType === 'book' && parsed.publisher && !hasParsedVenue(parsed)) score += 2;
  if (normalizedReferenceType === 'report' && (parsed.publisher || parsed.institution) && (parsed.edition || parsed.url)) score += 2.2;
  if (normalizedReferenceType === 'website' && parsed.institution) score += 0.8;
  if (parsed.url) score += normalizedReferenceType === 'website' ? 3.5 : 0.45;
  if (parsed.doi) score += normalizedReferenceType === 'website' ? 1.4 : 0.75;
  if (parsed.authors?.length) score += 3.5;
  if (parsed.volume) score += requirements.expected.includes('volume') ? 1 : 0.3;
  if (parsed.issue) score += requirements.expected.includes('issue') ? 1 : 0.3;
  if (isLocatorLike(locatorValue)) score += requirements.expected.includes('locator') ? 1.2 : 0.4;
  if (parsed.authors && looksLikeAlternatingTokenArray(parsed.authors)) score -= 2;
  if (parsed.authors?.some((author) => looksLikeMergedAuthorBlob(author))) score -= 4;
  if (authorSignals.mergedBlobCount > 0) score -= authorSignals.mergedBlobCount * 2.5;
  if (authorSignals.contaminatedBlobCount > 0) score -= authorSignals.contaminatedBlobCount * 6;
  if (authorSignals.initialsOnlyCount > Math.ceil((parsed.authors?.length ?? 0) / 2)) score -= 2;
  if (singleCharacterTailCount > 0) score -= singleCharacterTailCount * 0.35;
  score += authorSignals.richness * 1.5;
  if ((parsed.authors?.length ?? 0) >= 2 && authorSignals.compactVancouverCount === (parsed.authors?.length ?? 0)) score += 1.4;
  if (parsed.authors?.some((author) => author.length > 120 || /\. .+\./.test(author))) score -= 3;
  if (looksLikeInstitutionalAuthorList(parsed.authors)) score += 0.8;
  if (titleLooksLikeLocator) score -= 6;
  if (parsed.title && looksLikeSourceTailFragment(parsed.title)) score -= 3.5;
  if (parsed.journal && looksLikeInstitutionalVenueLeak(parsed.journal)) score -= 5.5;
  if (parsed.title && /\breport\s+no\.?/i.test(parsed.title) && normalizedReferenceType === 'journal') score -= 4;
  if (
    normalizedReferenceType === 'journal'
    && Boolean(parsed.url)
    && Boolean(parsed.publisher || parsed.institution)
    && !parsed.volume
    && !parsed.issue
    && !isLocatorLike(locatorValue)
  ) {
    score -= 5.5;
  }
  if (looksLikeAuthorEchoTitle(parsed)) score -= 5;
  if (suspiciousWebsiteAuthorState) score -= 6;
  if (suspiciousWebsiteAuthorState && titleEndsWithWeakTail(parsed.title)) score -= 2.5;
  if (isPlaceholderVenue(parsed.journal) || isPlaceholderVenue(parsed.volume) || isPlaceholderVenue(parsed.issue)) score -= 3;
  if (proceedingsSignal(parsed.conferenceTitle ?? parsed.bookTitle ?? parsed.journal) && (parsed.conferenceTitle || parsed.bookTitle || parsed.journal)) score += 1;
  if (normalizedReferenceType !== 'unknown') score += 1;
  return score;
}

function normalizeAuthorOptionalWebsiteParse(parsed: ParsedReference, referenceType: string): ParsedReference {
  if (referenceType !== 'website') return parsed;

  const normalized: ParsedReference = { ...parsed };
  const looksAuthorOptionalWebsite = Boolean(normalized.url)
    && !hasParsedVenue(normalized)
    && !normalized.publisher
    && !normalized.institution
    && !isLocatorLike(normalized.pages ?? normalized['article-number'])
    && !normalized.volume
    && !normalized.issue;
  if (!looksAuthorOptionalWebsite) return normalized;

  const primaryAuthor = normalizeWhitespace(normalized.authors?.[0] ?? '');
  if ((normalized.authors?.length ?? 0) === 1) {
    if (!normalized.title && primaryAuthor && !looksLikeInstitutionalLead(primaryAuthor)) {
      normalized.title = primaryAuthor;
      normalized.authors = undefined;
    } else if (
      normalized.title
      && primaryAuthor
      && normalizeWhitespace(normalized.title.toLowerCase()) === normalizeWhitespace(primaryAuthor.toLowerCase())
    ) {
      normalized.authors = undefined;
    }
  }

  if (looksLikeUrlLedWebsitePseudoAuthorParse(normalized, referenceType)) {
    normalized.authors = undefined;
  }

  return normalized;
}

function shouldShortCircuitDeterministicSelection(
  input: string,
  parsed: ParsedReference,
  referenceType: string,
  authorParse: ReturnType<typeof parseAuthorsForStyle>,
  score: number,
  splitArtifact?: V2SplitArtifact,
  inputStyle?: string,
): boolean {
  if (!['journal', 'conference', 'book', 'chapter', 'thesis', 'preprint'].includes(referenceType)) {
    return false;
  }

  const normalizedStyle = (inputStyle ?? 'auto').toLowerCase();
  const requirements = getRequirementProfile(referenceType);
  const locatorValue = parsed.pages ?? parsed['article-number'];
  const hasCoreTitle = Boolean(parsed.title)
    && !looksLikeLocatorOnlyTitle(parsed.title)
    && !looksLikeDateFragment(parsed.title)
    && !looksLikeSourceTailFragment(parsed.title);
  const hasCoreAuthors = (parsed.authors?.length ?? 0) > 0;
  const hasCoreYear = Boolean(parsed.year);
  const hasExpectedLocator = !requirements.expected.includes('locator') || isLocatorLike(locatorValue);
  const hasContainer = hasParsedVenue(parsed) || Boolean(parsed.publisher || parsed.institution);
  const cleanAuthors = authorParse.warningFlags.length === 0 && authorParse.rejectedCandidates.length === 0;
  const noSplitContamination = (splitArtifact?.contaminationFlags.length ?? 0) === 0;
  const hasDelimitedCoauthorLead = /,\s*(?:&|and)\s+[A-Z]/i.test(input);
  const styleConsistentCompactAuthors = authorParse.parserMode !== 'vancouver_compact'
    && authorParse.parserMode !== 'vancouver_compact_array'
    ? true
    : normalizedStyle === 'vancouver';
  const safeInvertedCoauthors = !(hasDelimitedCoauthorLead && authorParse.parserMode === 'inverted_or_generic');
  const inSourceContainerMissing = /\bIn\s+.+\bpp?\.?\s*[A-Z]?\d+/i.test(input)
    && !parsed.conferenceTitle
    && !parsed.bookTitle
    && (
      (referenceType === 'chapter' && Boolean(parsed.journal))
      || (referenceType === 'conference' && !/conference|proceedings|symposium|workshop/i.test(parsed.journal ?? ''))
    );
  if (inSourceContainerMissing) return false;

  return hasCoreTitle
    && hasCoreAuthors
    && hasCoreYear
    && hasExpectedLocator
    && hasContainer
    && cleanAuthors
    && safeInvertedCoauthors
    && styleConsistentCompactAuthors
    && noSplitContamination
    && score >= 13;
}

function selectionReason(
  selectedBranch: ExtractorSelectionBranch,
  deterministic: ParsedReference,
  fallback: ParsedReference | null,
  institutional: ParsedReference | null,
  inSource: ParsedReference | null,
): string {
  if (selectedBranch === 'deterministic_raw') {
    if (!fallback && !institutional && !inSource) return 'no_competing_candidate';
    if (looksLikeAlternatingTokenArray(deterministic.authors ?? [])) return 'deterministic_retained_for_structured_fields_with_author_recovery';
    return 'deterministic_scored_higher';
  }
  if (selectedBranch === 'institutional_heuristic_raw') {
    if (!deterministic.title && institutional?.title) return 'deterministic_missing_title_institutional_selected';
    if (looksLikeSourceTailFragment(deterministic.title)) return 'deterministic_title_looked_like_source_tail';
    return 'institutional_heuristic_scored_higher';
  }
  if (selectedBranch === 'in_source_heuristic_raw') {
    if (!deterministic.conferenceTitle && !deterministic.bookTitle) return 'deterministic_missing_container_in_source_selected';
    if (!deterministic.title && inSource?.title) return 'deterministic_missing_title_in_source_selected';
    return 'in_source_heuristic_scored_higher';
  }
  if (!deterministic.title && fallback?.title) return 'deterministic_missing_title';
  if ((!deterministic.authors || deterministic.authors.length === 0) && fallback?.authors?.length) return 'deterministic_missing_authors';
  return 'year_anchored_scored_higher';
}

function fillMissingFromFallback(
  selected: ParsedReference,
  fallback: ParsedReference | null,
  targetReferenceType: string = 'unknown',
): ParsedReference {
  if (!fallback) return selected;
  const merged: ParsedReference = { ...selected };
  const mergeableFields = targetReferenceType === 'website'
    ? ['title', 'url', 'doi', 'institution', 'edition'] as const
    : targetReferenceType === 'report'
      ? ['title', 'year', 'publisher', 'url', 'doi', 'institution', 'edition', 'editor'] as const
      : targetReferenceType === 'book'
        ? ['title', 'year', 'publisher', 'url', 'doi', 'institution', 'edition', 'editor'] as const
        : targetReferenceType === 'chapter'
          ? ['title', 'year', 'bookTitle', 'pages', 'publisher', 'url', 'doi', 'institution', 'edition', 'editor'] as const
          : targetReferenceType === 'conference'
            ? ['title', 'year', 'conferenceTitle', 'pages', 'publisher', 'url', 'doi', 'institution', 'edition', 'editor'] as const
            : targetReferenceType === 'thesis'
              ? ['title', 'year', 'institution', 'url', 'doi', 'edition'] as const
            : ['title', 'year', 'journal', 'conferenceTitle', 'bookTitle', 'volume', 'issue', 'pages', 'article-number', 'publisher', 'url', 'doi', 'institution', 'edition', 'editor'] as const;
  for (const field of mergeableFields) {
    if (
      field === 'publisher'
      && normalizeWhitespace((fallback.publisher ?? '').toLowerCase())
        === normalizeWhitespace((merged.edition ?? '').toLowerCase())
    ) {
      continue;
    }
    if (!merged[field] && fallback[field]) {
      merged[field] = fallback[field];
    }
  }
  const fallbackAuthorEchoesSelectedTitle = Boolean(
    (!merged.authors || merged.authors.length === 0)
    && fallback.authors?.length === 1
    && merged.title
    && normalizeWhitespace((fallback.authors[0] ?? '').toLowerCase()) === normalizeWhitespace(merged.title.toLowerCase()),
  );
  const avoidWebsiteAuthorBackfill = targetReferenceType === 'website';
  if (
    (!merged.authors || merged.authors.length === 0)
    && fallback.authors?.length
    && !fallbackAuthorEchoesSelectedTitle
    && !avoidWebsiteAuthorBackfill
  ) {
    merged.authors = fallback.authors;
  }
  return merged;
}

function buildFieldConfidence(parsed: ParsedReference, referenceType: string) {
  const authorSignals = analyzeParsedAuthorStrings(parsed.authors);
  const singleCharacterTailCount = shouldIgnoreSingleCharacterTailPenalty(parsed.authors) ? 0 : authorSignals.singleCharacterTailCount;
  const locatorValue = parsed.pages ?? parsed['article-number'];
  const institutionalAuthors = looksLikeInstitutionalAuthorList(parsed.authors);
  const institutionalVenue = normalizeWhitespace(parsed.institution ?? parsed.publisher ?? '');
  const institutionalPublisher = Boolean(institutionalVenue) && isGroupAuthor(institutionalVenue);
  const titleEchoesAuthor = looksLikeAuthorEchoTitle(parsed);
  const titleLooksLikeLocator = looksLikeLocatorOnlyTitle(parsed.title);
  const suspiciousWebsiteAuthorState = looksLikeUrlLedWebsitePseudoAuthorParse(parsed, referenceType);
  const titleLooksWeakWebsiteTail = suspiciousWebsiteAuthorState && titleEndsWithWeakTail(parsed.title);
  const mostlyCompactVancouver = (parsed.authors?.length ?? 0) >= 2
    && authorSignals.compactVancouverCount >= Math.ceil((parsed.authors?.length ?? 0) * 0.7);
  const authorConfidenceFloor = authorSignals.contaminatedBlobCount > 0 ? 0.05 : 0.25;
  const authorConfidence = parsed.authors?.length
    ? Math.max(
      authorConfidenceFloor,
      Math.min(
        0.97,
        0.84
          + (authorSignals.richness * 0.05)
          - (authorSignals.mergedBlobCount * 0.18)
          - (authorSignals.contaminatedBlobCount * 0.5)
          - (singleCharacterTailCount * 0.03)
          - (authorSignals.initialsOnlyCount > Math.ceil((parsed.authors?.length ?? 0) / 2) ? 0.08 : 0)
          + (mostlyCompactVancouver ? 0.08 : 0)
          + (institutionalAuthors ? 0.06 : 0),
      ),
    )
    : 0.2;
  const publisherConfidence = parsed.publisher || parsed.institution
    ? (institutionalPublisher ? 0.9 : (referenceType === 'book' ? 0.82 : 0.74))
    : 0.1;
  return {
    authors: suspiciousWebsiteAuthorState ? 0.08 : (institutionalAuthors ? Math.max(authorConfidence, 0.9) : authorConfidence),
    title: parsed.title ? ((titleLooksLikeLocator || looksLikeDateFragment(parsed.title) || looksLikeSourceTailFragment(parsed.title) || titleEchoesAuthor || titleLooksWeakWebsiteTail) ? 0.08 : 0.9) : 0.2,
    year: parsed.year ? 0.92 : 0.1,
    journal: hasParsedVenue(parsed) ? 0.82 : (referenceType === 'journal' ? 0.18 : 0.12),
    volume: parsed.volume ? 0.82 : 0.1,
    issue: parsed.issue ? 0.8 : 0.1,
    pages: isLocatorLike(locatorValue) ? 0.82 : 0.1,
    doi: parsed.doi ? 0.96 : 0.05,
    publisher: publisherConfidence,
    url: parsed.url ? (referenceType === 'website' ? 0.96 : 0.9) : 0.05,
  } as const;
}

function hasParsedFallbackField(parsed: ParsedReference, field: string): boolean {
  switch (field) {
    case 'authors':
      return (parsed.authors?.length ?? 0) > 0;
    case 'title':
      return Boolean(parsed.title)
        && !looksLikeLocatorOnlyTitle(parsed.title)
        && !looksLikeDateFragment(parsed.title)
        && !looksLikeSourceTailFragment(parsed.title);
    case 'year':
      return Boolean(parsed.year);
    case 'venue':
      return Boolean(bestVenueFromParsed(parsed) && !isPlaceholderValue(bestVenueFromParsed(parsed)));
    case 'bookTitle':
      return Boolean(parsed.bookTitle);
    case 'publisher':
      return Boolean(parsed.publisher);
    case 'institution':
      return Boolean(parsed.institution ?? parsed.publisher);
    case 'locator':
      return isLocatorLike(parsed.pages ?? parsed['article-number']);
    default:
      return Boolean(parsed[field as keyof ParsedReference]);
  }
}

function fieldConfidenceKeyForFallbackField(field: string): keyof ReturnType<typeof buildFieldConfidence> | null {
  switch (field) {
    case 'authors':
      return 'authors';
    case 'title':
      return 'title';
    case 'year':
      return 'year';
    case 'venue':
    case 'bookTitle':
      return 'journal';
    case 'publisher':
    case 'institution':
      return 'publisher';
    case 'locator':
      return 'pages';
    case 'volume':
      return 'volume';
    case 'issue':
      return 'issue';
    case 'doi':
      return 'doi';
    case 'url':
      return 'url';
    default:
      return null;
  }
}

function getFallbackCriticalFields(referenceType: string): string[] {
  return [...new Set(getRequirementProfile(referenceType).required)];
}

function countMissingFallbackFields(parsed: ParsedReference, fields: string[]): number {
  return fields.reduce((count, field) => count + (hasParsedFallbackField(parsed, field) ? 0 : 1), 0);
}

function needsLlmFallback(parsed: ParsedReference, fieldConfidence: Record<string, number>, referenceType: string): boolean {
  const criticalFields = getFallbackCriticalFields(referenceType);
  const missingRequired = countMissingFallbackFields(parsed, criticalFields) > 0;
  const lowConfidenceCritical = criticalFields
    .map((field) => fieldConfidenceKeyForFallbackField(field))
    .filter((field): field is keyof typeof fieldConfidence => field !== null)
    .map((field) => fieldConfidence[field] ?? 0)
    .some((value) => value < V2_THRESHOLD_POLICY.extract.llmCriticalFieldFloor);
  return missingRequired || lowConfidenceCritical;
}

function shouldAllowLlmFallback(
  parsed: ParsedReference,
  referenceType: string,
  selectionScore: number,
  batchSize: number,
  executionMode: 'sync' | 'async' | undefined,
): boolean {
  const requirements = getRequirementProfile(referenceType);
  const criticalFields = getFallbackCriticalFields(referenceType);
  const missingRequiredCount = countMissingFallbackFields(parsed, requirements.required);
  const missingCriticalCount = countMissingFallbackFields(parsed, criticalFields);
  const catastrophic =
    missingCriticalCount > 0
    || missingRequiredCount >= 2
    || selectionScore < 5;
  const weakSelection = selectionScore < V2_THRESHOLD_POLICY.extract.weakSelectionScore;

  if (executionMode === 'sync') {
    if (batchSize >= 50) return catastrophic;
    if (batchSize >= 10) {
      return catastrophic || (
        weakSelection
        || (
          missingRequiredCount >= 1
          && selectionScore < V2_THRESHOLD_POLICY.extract.mediumBatchWeakSelectionScore
        )
      );
    }
  }

  if (batchSize >= 100) return catastrophic;
  if (batchSize >= 25) {
    return catastrophic || (
      weakSelection
      || (
        missingRequiredCount >= 1
        && selectionScore < V2_THRESHOLD_POLICY.extract.mediumBatchWeakSelectionScore
      )
    );
  }
  return true;
}

function summarizeStrictFallbackCoverage(
  parsed: ParsedReference,
  referenceType: string,
  authorParse: ReturnType<typeof parseAuthorsForStyle>,
  fieldConfidence: Record<string, number>,
) {
  const referenceTypeReady = referenceType !== 'unknown';
  const titleReady = hasParsedFallbackField(parsed, 'title');
  const yearReady = hasParsedFallbackField(parsed, 'year');
  const parsedVenue = bestVenueFromParsed(parsed);
  const venueReady = Boolean(parsedVenue && !isPlaceholderValue(parsedVenue));
  const authors = authorParse.authors ?? [];
  const authorCount = authors.length;
  const firstAuthorConfidence = fieldConfidence.authors ?? 0;
  const firstAuthorCandidate = authors[0];
  const firstAuthor = typeof firstAuthorCandidate === 'string'
    ? normalizeWhitespace(firstAuthorCandidate)
    : normalizeWhitespace(
      firstAuthorCandidate?.literal
      ?? firstAuthorCandidate?.last
      ?? [firstAuthorCandidate?.first, firstAuthorCandidate?.last].filter(Boolean).join(' '),
    );
  const institutionalFirstAuthor = Boolean(firstAuthor) && looksLikeInstitutionalLead(firstAuthor);
  const malformedAuthorBlob = !institutionalFirstAuthor && (authorParse.warningFlags.length > 0 || authorParse.rejectedCandidates.length > 0);
  const firstAuthorReady = authorCount > 0
    && (
      institutionalFirstAuthor
        ? firstAuthorConfidence >= Math.max(0.35, V2_THRESHOLD_POLICY.extract.llmCriticalFieldFloor - 0.25)
        : (!malformedAuthorBlob && firstAuthorConfidence >= V2_THRESHOLD_POLICY.extract.llmCriticalFieldFloor)
    );
  const coreChecks = {
    referenceType: referenceTypeReady,
    title: titleReady,
    year: yearReady,
    firstAuthor: firstAuthorReady,
    venue: venueReady,
  };
  const corePassedCount = Object.values(coreChecks).filter(Boolean).length;
  return {
    coreChecks,
    corePassedCount,
    strictNearPass: corePassedCount >= 3,
    strictLocallyReady: corePassedCount === 5,
    authorCount,
    firstAuthorConfidence,
    malformedAuthorBlob,
  };
}

function getLlmFallbackTrigger(
  parsed: ParsedReference,
  referenceType: string,
  fieldConfidence: Record<string, number>,
  authorParse: ReturnType<typeof parseAuthorsForStyle>,
  splitArtifact?: V2SplitArtifact,
) {
  const coverage = summarizeStrictFallbackCoverage(parsed, referenceType, authorParse, fieldConfidence);
  const noContaminationRisk = (splitArtifact?.contaminationFlags?.length ?? 0) === 0;
  const noAuthors = coverage.authorCount === 0;
  const malformedAuthorBlob = coverage.malformedAuthorBlob;
  const weakFirstAuthor = coverage.firstAuthorConfidence < V2_THRESHOLD_POLICY.extract.llmCriticalFieldFloor;
  const weakVenue = !coverage.coreChecks.venue;
  const weakReferenceType = !coverage.coreChecks.referenceType;
  const strictNearPass = coverage.strictNearPass && noContaminationRisk;
  const lowConfidenceNonCore = hasWeakNonCoreFieldConfidence(referenceType, fieldConfidence, parsed);
  const duplicatedTails = hasDuplicatedTail(parsed.title) || hasDuplicatedTail(parsed.publisher) || hasDuplicatedTail(parsed.institution);
  const identifierLeakage = hasIdentifierLeakage(parsed);
  const metadataBleed = hasMetadataBleed(parsed);
  const typePriorityEligible = ['book', 'report', 'chapter', 'conference', 'website', 'thesis'].includes(referenceType);

  let reason: string | null = null;
  if (strictNearPass && noAuthors) reason = 'missing_authors';
  else if (strictNearPass && malformedAuthorBlob) reason = 'malformed_authors';
  else if (strictNearPass && weakFirstAuthor) reason = 'weak_first_author';
  else if (strictNearPass && weakVenue) reason = 'weak_venue';
  else if (strictNearPass && weakReferenceType) reason = 'weak_reference_type';
  else if (identifierLeakage) reason = 'identifier_leakage';
  else if (metadataBleed) reason = 'metadata_bleed';
  else if (duplicatedTails) reason = 'duplicated_tails';
  else if (lowConfidenceNonCore) reason = 'low_confidence_non_core';
  else if (strictNearPass && coverage.corePassedCount < 5) reason = 'multi_field_low_confidence';

  return {
    ...coverage,
    noAuthors,
    weakVenue,
    weakReferenceType,
    strictNearPass,
    noContaminationRisk,
    lowConfidenceNonCore,
    duplicatedTails,
    identifierLeakage,
    metadataBleed,
    typePriorityEligible,
    hardStructuralSuspicion: identifierLeakage || metadataBleed || duplicatedTails,
    shouldTrigger: reason !== null && !coverage.strictLocallyReady,
    reason,
  };
}

function listImprovedStrictFields(
  beforeCoverage: ReturnType<typeof summarizeStrictFallbackCoverage>,
  afterCoverage: ReturnType<typeof summarizeStrictFallbackCoverage>,
) {
  const fields: string[] = [];
  for (const field of ['referenceType', 'title', 'year', 'firstAuthor', 'venue'] as const) {
    if (!beforeCoverage.coreChecks[field] && afterCoverage.coreChecks[field]) fields.push(field);
  }
  return fields;
}

function normalizeComparableFallbackValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return normalizeWhitespace(value);
  if (Array.isArray(value)) return normalizeWhitespace(value.map((item) => normalizeComparableFallbackValue(item)).join(' '));
  return normalizeWhitespace(String(value));
}

function hasDuplicatedTail(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '').toLowerCase();
  if (!normalized) return false;
  const parts = normalized.split(/[.,;:]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  return new Set(parts).size < parts.length;
}

function hasIdentifierLeakage(parsed: ParsedReference): boolean {
  const suspiciousFields: Array<keyof ParsedReference> = ['volume', 'issue', 'pages', 'journal', 'bookTitle', 'conferenceTitle', 'publisher', 'institution'];
  return suspiciousFields.some((field) => isFieldStructurallyCorrupt(field, parsed[field]));
}

function hasMetadataBleed(parsed: ParsedReference): boolean {
  const title = normalizeComparableFallbackValue(parsed.title);
  const containerFields = [parsed.journal, parsed.bookTitle, parsed.conferenceTitle, parsed.publisher, parsed.institution]
    .map((value) => normalizeComparableFallbackValue(value))
    .filter(Boolean);
  if (!title) return false;
  return containerFields.some((field) => field === title || field.includes(title));
}

function hasWeakNonCoreFieldConfidence(referenceType: string, fieldConfidence: Record<string, number>, parsed: ParsedReference): boolean {
  const fieldsByType: Record<string, Array<keyof ParsedReference>> = {
    journal: ['journal', 'volume', 'issue', 'pages', 'doi', 'url'],
    book: ['publisher', 'placeOfPublication', 'edition', 'doi', 'url'],
    chapter: ['bookTitle', 'pages', 'publisher', 'placeOfPublication', 'doi', 'url'],
    conference: ['conferenceTitle', 'pages', 'publisher', 'placeOfPublication', 'doi', 'url'],
    report: ['institution', 'publisher', 'placeOfPublication', 'edition', 'doi', 'url'],
    thesis: ['institution', 'thesisType', 'repository', 'doi', 'url'],
    website: ['institution', 'publisher', 'url'],
  };
  const candidateFields = fieldsByType[referenceType] ?? [];
  return candidateFields.some((field) => (
    hasParsedFallbackField(parsed, field)
    && (fieldConfidence[field === 'placeOfPublication' || field === 'edition' || field === 'institution' || field === 'bookTitle' || field === 'conferenceTitle' || field === 'repository' || field === 'thesisType'
      ? 'publisher'
      : field] ?? 0) < 0.7
  ));
}

function hasRequiredSupportFieldsForType(parsed: ParsedReference, referenceType: string): boolean {
  switch (referenceType) {
    case 'conference':
      return Boolean(normalizeWhitespace(parsed.conferenceTitle ?? ''));
    case 'chapter':
      return Boolean(normalizeWhitespace(parsed.bookTitle ?? ''));
    case 'report':
      return Boolean(normalizeWhitespace(parsed.title ?? ''))
        && Boolean(normalizeWhitespace(parsed.year ?? ''))
        && Boolean(normalizeWhitespace(parsed.institution ?? parsed.publisher ?? ''));
    case 'book':
      return Boolean(normalizeWhitespace(parsed.publisher ?? ''));
    default:
      return true;
  }
}

function mergedOutputIsNoOp(beforeParsed: ParsedReference, afterParsed: ParsedReference): boolean {
  const fields = ['authors', 'title', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'publisher', 'placeOfPublication', 'url', 'conferenceTitle', 'bookTitle', 'institution', 'edition', 'editor', 'thesisType', 'repository'] as const;
  return fields.every((field) => normalizeComparableFallbackValue(beforeParsed[field]) === normalizeComparableFallbackValue(afterParsed[field]));
}

function listMeaningfulTypeSpecificFallbackGains(
  beforeParsed: ParsedReference,
  afterParsed: ParsedReference,
  beforeReferenceType: string,
  afterReferenceType: string,
) {
  const referenceType = afterReferenceType !== 'unknown' ? afterReferenceType : beforeReferenceType;
    const fieldsByType: Record<string, Array<keyof ParsedReference>> = {
      book: ['publisher', 'placeOfPublication', 'edition', 'doi', 'url'],
      chapter: ['bookTitle', 'pages', 'publisher', 'editor', 'doi', 'url'],
      conference: ['conferenceTitle', 'pages', 'publisher', 'doi', 'url'],
      report: ['institution', 'publisher', 'placeOfPublication', 'edition', 'doi', 'url'],
      thesis: ['thesisType', 'institution', 'repository', 'doi', 'url'],
      website: ['publisher', 'institution', 'url'],
    };
  const candidateFields = fieldsByType[referenceType] ?? [];
  const gains: string[] = [];

  for (const field of candidateFields) {
    const beforeValue = beforeParsed[field];
    const afterValue = afterParsed[field];
    if (hasParsedFallbackField(afterParsed, field) && !hasParsedFallbackField(beforeParsed, field)) {
      gains.push(String(field));
      continue;
    }

    const normalizedBefore = normalizeComparableFallbackValue(beforeValue);
    const normalizedAfter = normalizeComparableFallbackValue(afterValue);
    if (!normalizedAfter || normalizedBefore === normalizedAfter) continue;
    if (isPlaceholderValue(normalizedBefore) && !isPlaceholderValue(normalizedAfter)) {
      gains.push(String(field));
    }
  }

  return gains;
}

function listMeaningfulFallbackFieldChanges(
  beforeParsed: ParsedReference,
  afterParsed: ParsedReference,
  beforeReferenceType: string,
  afterReferenceType: string,
) {
  const referenceType = afterReferenceType !== 'unknown' ? afterReferenceType : beforeReferenceType;
  const fieldsByType: Record<string, Array<keyof ParsedReference | 'authors' | 'title'>> = {
      journal: ['authors', 'title', 'journal', 'volume', 'issue', 'pages', 'doi'],
      book: ['authors', 'title', 'publisher', 'placeOfPublication', 'edition', 'doi'],
      chapter: ['authors', 'title', 'bookTitle', 'pages', 'publisher', 'doi'],
      conference: ['authors', 'title', 'conferenceTitle', 'pages', 'publisher', 'doi'],
      report: ['authors', 'title', 'institution', 'publisher', 'placeOfPublication', 'edition', 'doi', 'url'],
      thesis: ['authors', 'title', 'institution', 'thesisType', 'repository', 'doi', 'url'],
      website: ['authors', 'title', 'publisher', 'institution', 'url'],
    };
  const candidateFields = fieldsByType[referenceType] ?? ['authors', 'title'];
  const changes: string[] = [];

  for (const field of candidateFields) {
    const beforeValue = beforeParsed[field as keyof ParsedReference];
    const afterValue = afterParsed[field as keyof ParsedReference];
    const normalizedBefore = normalizeComparableFallbackValue(beforeValue);
    const normalizedAfter = normalizeComparableFallbackValue(afterValue);
    if (!normalizedAfter || normalizedBefore === normalizedAfter) continue;
    if (field === 'authors' || field === 'title' || hasParsedFallbackField(afterParsed, field as keyof ParsedReference)) {
      changes.push(String(field));
    }
  }

  return changes;
}

const SAFE_SINGLE_FIELD_LLM_REPAIRS = new Set([
  'edition',
  'institution',
  'publisher',
  'placeOfPublication',
  'conferenceTitle',
  'bookTitle',
  'journal',
  'volume',
  'issue',
  'pages',
  'doi',
  'url',
]);

function shouldAcceptLlmFallbackResult(params: {
  beforeParsed: ParsedReference;
  beforeReferenceType: string;
  beforeFieldConfidence: Record<string, number>;
  beforeAuthorParse: ReturnType<typeof parseAuthorsForStyle>;
  afterParsed: ParsedReference;
  afterReferenceType: string;
  afterFieldConfidence: Record<string, number>;
  afterAuthorParse: ReturnType<typeof parseAuthorsForStyle>;
}) {
  const beforeCoverage = summarizeStrictFallbackCoverage(
    params.beforeParsed,
    params.beforeReferenceType,
    params.beforeAuthorParse,
    params.beforeFieldConfidence,
  );
  const afterCoverage = summarizeStrictFallbackCoverage(
    params.afterParsed,
    params.afterReferenceType,
    params.afterAuthorParse,
    params.afterFieldConfidence,
  );
  const beforePlausibility = assessCandidatePlausibility(params.beforeParsed, params.beforeReferenceType);
  const afterPlausibility = assessCandidatePlausibility(params.afterParsed, params.afterReferenceType);
  const fieldsImproved = listImprovedStrictFields(beforeCoverage, afterCoverage);
  const typeSpecificGains = listMeaningfulTypeSpecificFallbackGains(
    params.beforeParsed,
    params.afterParsed,
    params.beforeReferenceType,
    params.afterReferenceType,
  );
  const meaningfulFieldChanges = listMeaningfulFallbackFieldChanges(
    params.beforeParsed,
    params.afterParsed,
    params.beforeReferenceType,
    params.afterReferenceType,
  );
  const allImprovedFields = [...new Set([...fieldsImproved, ...typeSpecificGains, ...meaningfulFieldChanges])];
  const strictPassDelta = afterCoverage.corePassedCount - beforeCoverage.corePassedCount;
  const titlePenaltyImproved = afterPlausibility.title.penalty < beforePlausibility.title.penalty;
  const venuePenaltyImproved = afterPlausibility.venue.penalty < beforePlausibility.venue.penalty;
  const noOpRepair = mergedOutputIsNoOp(params.beforeParsed, params.afterParsed);
  const safeSingleFieldRepair = allImprovedFields.length === 1
    && SAFE_SINGLE_FIELD_LLM_REPAIRS.has(allImprovedFields[0] ?? '')
    && params.afterReferenceType === params.beforeReferenceType;

  if (afterCoverage.authorCount === 0) {
    return { accept: false, reason: 'authors_still_empty', fieldsImproved: allImprovedFields, strictPassDelta: afterCoverage.corePassedCount - beforeCoverage.corePassedCount };
  }
  if (afterCoverage.malformedAuthorBlob) {
    return { accept: false, reason: 'authors_still_malformed', fieldsImproved: allImprovedFields, strictPassDelta: afterCoverage.corePassedCount - beforeCoverage.corePassedCount };
  }
  if (afterPlausibility.title.penalty > beforePlausibility.title.penalty) {
    return { accept: false, reason: 'title_plausibility_worsened', fieldsImproved: allImprovedFields, strictPassDelta: afterCoverage.corePassedCount - beforeCoverage.corePassedCount };
  }
  if (afterPlausibility.venue.penalty > beforePlausibility.venue.penalty) {
    return { accept: false, reason: 'venue_plausibility_worsened', fieldsImproved: allImprovedFields, strictPassDelta: afterCoverage.corePassedCount - beforeCoverage.corePassedCount };
  }
  if (
    params.beforeReferenceType !== 'unknown'
    && params.afterReferenceType !== params.beforeReferenceType
    && !areReferenceTypesMergeCompatible(params.beforeReferenceType, params.afterReferenceType)
  ) {
      if (!hasRequiredSupportFieldsForType(params.afterParsed, params.afterReferenceType)) {
        return { accept: false, reason: 'type_change_missing_support_fields', fieldsImproved: allImprovedFields, strictPassDelta };
      }
      const safeWebsiteUpgrade =
        params.beforeReferenceType === 'website'
        && ['report', 'thesis'].includes(params.afterReferenceType)
        && afterPlausibility.title.penalty <= beforePlausibility.title.penalty
        && afterPlausibility.venue.penalty <= beforePlausibility.venue.penalty
        && allImprovedFields.length >= 2;
      const safeSemanticUpgrade =
        (
          strictPassDelta > 0
          && afterCoverage.corePassedCount >= beforeCoverage.corePassedCount + 2
          && afterPlausibility.title.penalty <= beforePlausibility.title.penalty
          && afterPlausibility.venue.penalty <= beforePlausibility.venue.penalty
        )
        || safeWebsiteUpgrade;
      if (!safeSemanticUpgrade) {
        return { accept: false, reason: 'reference_type_less_coherent', fieldsImproved: allImprovedFields, strictPassDelta };
      }
    }

    if (strictPassDelta <= 0) {
      const semanticGainWithoutStrictDelta =
        strictPassDelta === 0
        && afterCoverage.corePassedCount >= beforeCoverage.corePassedCount
        && (
          (!noOpRepair && allImprovedFields.length > 0)
          || titlePenaltyImproved
          || venuePenaltyImproved
          || typeSpecificGains.length > 0
          || meaningfulFieldChanges.length >= 2
          || safeSingleFieldRepair
        );
      if (!semanticGainWithoutStrictDelta) {
        return { accept: false, reason: 'no_strict_gain', fieldsImproved: allImprovedFields, strictPassDelta };
      }
      return {
        accept: true,
        reason: allImprovedFields.length > 0
          ? `semantic_gain:${allImprovedFields.join('|')}`
          : (titlePenaltyImproved ? 'semantic_gain:title_plausibility' : 'semantic_gain:venue_plausibility'),
        fieldsImproved: allImprovedFields,
        strictPassDelta,
      };
    }

    return {
      accept: true,
      reason: allImprovedFields.length > 0 ? `improved:${allImprovedFields.join('|')}` : 'strict_gain',
      fieldsImproved: allImprovedFields,
      strictPassDelta,
    };
  }

function splitContaminationPenalty(splitArtifact?: V2SplitArtifact): number {
  if (!splitArtifact) return 0;

  let penalty = 0;
  if (splitArtifact.contaminationFlags.includes('header_bleed_suspected')) penalty += V2_THRESHOLD_POLICY.extract.splitPenalty.headerBleed;
  if (splitArtifact.contaminationFlags.includes('page_artifact_present')) penalty += V2_THRESHOLD_POLICY.extract.splitPenalty.pageArtifact;
  if (splitArtifact.contaminationFlags.includes('multiline_truncation_suspected')) penalty += V2_THRESHOLD_POLICY.extract.splitPenalty.multilineTruncation;
  if (splitArtifact.contaminationFlags.includes('oversized_chunk')) penalty += V2_THRESHOLD_POLICY.extract.splitPenalty.oversizedChunk;
  if (splitArtifact.contaminationFlags.includes('doi_orphan')) penalty += V2_THRESHOLD_POLICY.extract.splitPenalty.doiOrphan;
  return Math.min(V2_THRESHOLD_POLICY.extract.splitPenaltyCap, penalty);
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

async function extractWithLlm(input: string): Promise<LlmExtraction | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const replayFile = process.env.V2_LLM_EXTRACT_REPLAY_FILE;
  if (replayFile) {
    const replayRaw = fs.readFileSync(replayFile, 'utf8').trim();
    const replayParsed = JSON.parse(replayRaw);
    const replayContent = typeof replayParsed?.choices?.[0]?.message?.content === 'string'
      ? replayParsed.choices[0].message.content
      : replayRaw;
    return parseLlmExtraction(JSON.parse(extractJsonContent(replayContent)));
  }
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = getOpenAiExtractModel();
  const configuredTemperature = Number.parseFloat(process.env.V2_LLM_EXTRACT_TEMPERATURE ?? '0');
  const temperature = Number.isFinite(configuredTemperature) ? configuredTemperature : 0;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        {
          role: 'system',
          content: LLM_EXTRACT_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: input,
        },
      ],
    }),
    signal: AbortSignal.timeout(getOpenAiExtractTimeoutMs()),
  });

  if (!response.ok) {
    throw new Error(`LLM extraction failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const parsed = parseLlmExtraction(JSON.parse(extractJsonContent(content)));
  return parsed;
}

function mergeLlmWithDeterministic(
  deterministic: {
    parsed: ParsedReference;
    referenceType: ReturnType<typeof parsedReferenceTypeToCanonical>;
    fieldConfidence: ReturnType<typeof buildFieldConfidence>;
  },
  llm: LlmExtraction,
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
    'article-number': deterministic.parsed['article-number'],
    doi: llm.doi ? normalizeDoiValue(llm.doi) : deterministic.parsed.doi,
    publisher: llm.publisher ?? deterministic.parsed.publisher,
    placeOfPublication: llm.placeOfPublication ?? deterministic.parsed.placeOfPublication,
    url: llm.url ?? deterministic.parsed.url,
    accessed: llm.accessed ?? deterministic.parsed.accessed,
    conferenceTitle: llm.conferenceTitle ?? deterministic.parsed.conferenceTitle,
    bookTitle: llm.bookTitle ?? deterministic.parsed.bookTitle,
    institution: llm.institution ?? deterministic.parsed.institution,
    edition: llm.edition ?? deterministic.parsed.edition,
    editors: llm.referenceType === 'chapter'
      ? llm.editors
      : (deterministic.parsed.editors ?? []),
    editor: llm.referenceType === 'chapter'
      ? (llm.editors[0] ? canonicalAuthorToDisplay(coerceCanonicalAuthor(llm.editors[0])) : deterministic.parsed.editor)
      : deterministic.parsed.editor,
    thesisType: llm.referenceType === 'thesis'
      ? llm.thesisType ?? deterministic.parsed.thesisType
      : deterministic.parsed.thesisType,
    repository: llm.referenceType === 'preprint'
      ? llm.repository ?? deterministic.parsed.repository
      : deterministic.parsed.repository,
      inferenceNote: llm.referenceType === 'unknown'
        ? llm.inferenceNote ?? deterministic.parsed.inferenceNote
        : deterministic.parsed.inferenceNote,
    } as ParsedReference;

  const fieldsToClearByType: Partial<Record<CanonicalReferenceType, Array<keyof ParsedReference>>> = {
    journal: ['publisher', 'placeOfPublication', 'conferenceTitle', 'bookTitle', 'institution', 'edition', 'editor', 'editors', 'thesisType', 'repository'],
    book: ['journal', 'volume', 'issue', 'pages', 'article-number', 'conferenceTitle', 'institution', 'thesisType', 'repository'],
    chapter: ['journal', 'volume', 'issue', 'article-number', 'institution', 'thesisType', 'repository'],
    conference: ['journal', 'volume', 'issue', 'bookTitle', 'institution', 'edition', 'thesisType', 'repository'],
    report: ['journal', 'volume', 'issue', 'pages', 'article-number', 'conferenceTitle', 'bookTitle', 'edition', 'editor', 'editors', 'thesisType', 'repository'],
    website: ['journal', 'volume', 'issue', 'pages', 'article-number', 'conferenceTitle', 'bookTitle', 'edition', 'editor', 'editors', 'thesisType', 'repository'],
    thesis: ['journal', 'volume', 'issue', 'pages', 'article-number', 'conferenceTitle', 'bookTitle', 'edition', 'editor', 'editors'],
  };
  const llmReferenceType = llm.referenceType !== 'unknown' ? llm.referenceType : deterministic.referenceType;
  for (const field of fieldsToClearByType[llmReferenceType] ?? []) {
    if ((llm as Record<string, unknown>)[field] == null) {
      delete (parsed as Record<string, unknown>)[field];
    }
  }

  const noOpMerge = mergedOutputIsNoOp(deterministic.parsed, parsed);

    return {
      parsed,
    referenceType: llm.referenceType !== 'unknown' ? llm.referenceType : deterministic.referenceType,
    fieldConfidence: noOpMerge
      ? deterministic.fieldConfidence
      : {
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
  const firstLooksLikeInitials = Boolean(normalizedFirst) && /^[\p{Lu}](?:[.-]?[\p{Lu}]){0,5}\.?$/u.test(normalizedFirst.replace(/\s+/g, ''));
  const firstInitialCount = (normalizeWhitespace(author.first ?? '').match(/[\p{Lu}](?=\.|\b)/gu) ?? []).length;
  const storedInitialCount = (normalizeWhitespace(author.initials ?? '').match(/[\p{Lu}](?=\.|\b)/gu) ?? []).length;
  if (author.initials && storedInitialCount > firstInitialCount) return `${author.last}, ${author.initials}`;
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
    const normalized = preNormalizeExtractorInput(parser, input);
    const quotedLead = normalizeWhitespace((normalized.match(/^(?<lead>.+?)\s+"[^"]+"/u)?.groups?.lead ?? ''));
    if (looksLikeAuthorColonVancouverReference(normalized)) {
      return { style: 'vancouver', confidence: 0.9 };
    }
    if (/"[^"]+,"\s+in\s+(?:proc(?:eedings)?\.?|proceedings)\b/i.test(normalized)) {
      return { style: 'ieee', confidence: 0.95 };
    }
    if (/^\s*\[\d+\]/.test(normalized) && /\bin\s+(?:proc(?:eedings)?\.?|proceedings)\b/i.test(normalized)) {
      return { style: 'ieee', confidence: 0.94 };
    }
    if (/^\s*\[\d+\]/.test(normalized) && /\bpp?\.\s*[A-Za-z]?\d+/i.test(normalized) && /,\s*(?:1[5-9]\d{2}|20\d{2})\.?$/i.test(normalized)) {
      return { style: 'ieee', confidence: 0.92 };
    }
    if (
      /"[^"]+?"\s*,?\s+.+$/i.test(normalized)
      && /\[\s*online\s*\]/i.test(normalized)
      && /\bavailable\s*:/i.test(normalized)
    ) {
      return { style: 'ieee', confidence: 0.96 };
    }
    if (/\bviewed\b/i.test(normalized) && /\bavailable at:/i.test(normalized) && /['"][^'"]+['"]/i.test(normalized)) {
      return { style: 'harvard', confidence: 0.95 };
    }
    if (
      /\baccessed\b/i.test(normalized)
      && /"[^"]+"/.test(normalized)
      && /\bwww\.[^\s,]+/i.test(normalized)
      && !/\bavailable at:/i.test(normalized)
    ) {
      return { style: 'mla', confidence: 0.93 };
    }
    if (/\baccessed\b/i.test(normalized) && /"[^"]+"/.test(normalized)) {
      return { style: 'chicago', confidence: 0.94 };
    }
    if (
      hasMlaMixedQuotedLead(quotedLead)
      && /"[^"]+"/.test(normalized)
      && (
        buildQuotedTitleJournalLocatorCandidate(normalized)
        || (/\bvol\.?\s*\d+/i.test(normalized) && /\bpp?\.?\s*[A-Za-z]?\d+/i.test(normalized))
      )
    ) {
      return { style: 'mla', confidence: 0.93 };
    }
    const heuristicStyle = buildIeeeQuotedReferenceCandidate(normalized)
      ?? buildHarvardJournalCandidate(normalized)
      ?? buildApaJournalCandidate(normalized)
      ?? buildHarvardConferenceCandidate(normalized)
      ?? buildIeeeConferenceCandidate(normalized)
      ?? buildChicagoAuthorDateJournalCandidate(normalized)
      ?? buildChicagoAuthorDateReportCandidate(normalized)
      ?? buildInstitutionalAuthorYearCandidate(normalized)
      ?? buildApaThesisCandidate(normalized)
      ?? buildMlaThesisCandidate(normalized)
      ?? buildHarvardWebsiteCandidate(normalized)
      ?? buildQuotedWebsiteCandidate(normalized, 'auto')
      ?? buildQuotedBookChapterCandidate(normalized, 'auto')
      ?? buildHarvardBookCandidate(normalized)
      ?? buildVancouverCompactJournalCandidate(normalized)
      ?? buildIeeeBookCandidate(normalized);
    if (heuristicStyle?.styleUsed) {
      return {
        style: heuristicStyle.styleUsed,
        confidence: heuristicStyle.styleConfidence ?? 0.9,
      };
    }
    if (CHICAGO_BOOK_PATTERN.test(normalized)) {
      return { style: 'chicago', confidence: 0.92 };
    }
    if (MLA_BOOK_PATTERN.test(normalized)) {
      return { style: 'mla', confidence: 0.9 };
    }
    const selected = selectBestAutoStyleCandidate(parser, normalized);
    return {
      style: selected.styleUsed ?? null,
      confidence: selected.styleConfidence ?? 0.35,
    };
  }
}

class DefaultExtractorAdapter implements ExtractorAdapter {
  readonly id = 'default-parser-extractor';

  async extract(input: string, inputStyle: string, options?: {
    inputProfile?: { structure: string; estimatedCount?: number };
    detectionConfidence?: number;
    batchSize?: number;
    executionMode?: 'sync' | 'async';
    splitArtifact?: V2SplitArtifact;
    llmBudget?: { maxCalls: number; totalCalls: number; splitCalls: number; extractCalls: number; capReached: boolean };
    debugEnabled?: boolean;
    outputStyle?: string;
    originalRawText?: string;
    engineVersion?: string;
    userEdited?: boolean;
    adminApproved?: boolean;
    verificationNeeded?: boolean;
  }) {
    const selectorMode = getSelectorMode();
    const detectionConfidence = options?.detectionConfidence ?? 0;
    const deterministicBase = buildDeterministicCandidate(input, inputStyle, options?.detectionConfidence ?? 0);
    const deterministicSanitized = sanitizeParsedReference(deterministicBase.parsed, deterministicBase.referenceType);
    const deterministic = {
      ...deterministicBase,
      parsed: normalizeAuthorOptionalWebsiteParse(deterministicSanitized.parsed, deterministicSanitized.referenceType),
      referenceType: deterministicSanitized.referenceType,
    };
    const deterministicAuthorParse = parseAuthorsForStyle(
      deterministic.parsed.authors ?? [],
      deterministic.styleUsed ?? inputStyle,
    );
    const deterministicScore = scoreCandidate(deterministic.parsed, deterministic.referenceType)
      - (deterministicAuthorParse.warningFlags.length * 2)
      - (deterministicAuthorParse.rejectedCandidates.length * 1.5)
      + ((deterministicAuthorParse.parserMode === 'alternating_pairs' || deterministicAuthorParse.parserMode === 'surname_given_pairs') ? 8 : 0);
    const skipCompetingCandidates = shouldShortCircuitDeterministicSelection(
      input,
      deterministic.parsed,
      deterministic.referenceType,
      deterministicAuthorParse,
      deterministicScore,
      options?.splitArtifact,
      inputStyle,
    );
    const emptyAuthorParseResult = {
      authors: [],
      parserMode: 'none',
      warningFlags: [],
      rejectedCandidates: [],
    } satisfies ReturnType<typeof parseAuthorsForStyle>;

    const createPreparedBranchAttempt = (
      adapterId: string,
      branch: ExtractorSelectionBranch,
      adapterPriority: number,
      candidate: Omit<ParsedSelectionCandidate, 'branch'> | null,
    ): CandidateAttempt | null => {
      if (!candidate) return null;
      return prepareExtractionCandidate({
        adapterId,
        adapterPriority,
        branch,
        candidate: {
          ...candidate,
          branch,
        },
      });
    };

    const fallbackBase = skipCompetingCandidates ? null : buildYearAnchoredCandidate(input);
    const fallback = fallbackBase
        ? (() => {
          const sanitized = sanitizeParsedReference(fallbackBase.parsed, fallbackBase.referenceType);
          return {
            ...fallbackBase,
            parsed: normalizeAuthorOptionalWebsiteParse(sanitized.parsed, sanitized.referenceType),
            referenceType: sanitized.referenceType,
          };
        })()
      : null;
    const institutionalBase = skipCompetingCandidates ? null : buildInstitutionalCandidate(input);
    const institutional = institutionalBase
        ? (() => {
          const sanitized = sanitizeParsedReference(institutionalBase.parsed, institutionalBase.referenceType);
          return {
            ...institutionalBase,
            parsed: normalizeAuthorOptionalWebsiteParse(sanitized.parsed, sanitized.referenceType),
            referenceType: sanitized.referenceType,
          };
        })()
      : null;
    const inSourceBase = skipCompetingCandidates ? null : buildInSourceCandidate(input, inputStyle);
    const inSource = inSourceBase
        ? (() => {
          const sanitized = sanitizeParsedReference(inSourceBase.parsed, inSourceBase.referenceType);
          return {
            ...inSourceBase,
            parsed: normalizeAuthorOptionalWebsiteParse(sanitized.parsed, sanitized.referenceType),
            referenceType: sanitized.referenceType,
          };
        })()
      : null;
    const fallbackAuthorParse = fallback
      ? parseAuthorsForStyle(fallback.parsed.authors ?? [], inputStyle)
      : emptyAuthorParseResult;
    const institutionalAuthorParse = institutional
      ? parseAuthorsForStyle(institutional.parsed.authors ?? [], inputStyle)
      : emptyAuthorParseResult;
    const inSourceAuthorParse = inSource
      ? parseAuthorsForStyle(inSource.parsed.authors ?? [], inputStyle)
      : emptyAuthorParseResult;
    const fallbackScore = scoreCandidate(fallback?.parsed, fallback?.referenceType)
      - (fallbackAuthorParse.warningFlags.length * 2)
      - (fallbackAuthorParse.rejectedCandidates.length * 1.5);
    const institutionalScore = scoreCandidate(institutional?.parsed, institutional?.referenceType)
      - (institutionalAuthorParse.warningFlags.length * 2)
      - (institutionalAuthorParse.rejectedCandidates.length * 1.5)
      + (institutional ? (institutional.referenceType === 'report' ? 4 : 1.2) : 0);
    const inSourceScore = scoreCandidate(inSource?.parsed, inSource?.referenceType)
      - (inSourceAuthorParse.warningFlags.length * 2)
      - (inSourceAuthorParse.rejectedCandidates.length * 1.5)
      + (inSource ? 1.8 : 0);

    const deterministicBaselineAttempt = createPreparedBranchAttempt(
      'legacy:deterministic_baseline',
      'deterministic_raw',
      0,
      deterministic,
    );
    let preparedAttempts = collectDeterministicCandidateAttempts(input, inputStyle, detectionConfidence)
      .map((attempt) => prepareExtractionCandidate(attempt));
    let nextAdapterPriority = preparedAttempts.length;
    const fallbackAttempt = createPreparedBranchAttempt(
      'legacy:year_anchored_fallback',
      'year_anchored_fallback_raw',
      nextAdapterPriority += 1,
      fallback,
    );
    const institutionalAttempt = createPreparedBranchAttempt(
      'legacy:institutional_heuristic',
      'institutional_heuristic_raw',
      nextAdapterPriority += 1,
      institutional,
    );
    const inSourceAttempt = createPreparedBranchAttempt(
      'legacy:in_source_heuristic',
      'in_source_heuristic_raw',
      nextAdapterPriority += 1,
      inSource,
    );

    if (fallbackAttempt) preparedAttempts.push(fallbackAttempt);
    if (institutionalAttempt) preparedAttempts.push(institutionalAttempt);
    if (inSourceAttempt) preparedAttempts.push(inSourceAttempt);
    preparedAttempts = reorderCandidateAttemptsForSelection(preparedAttempts);

    const attemptAuthorParse = new Map<string, ReturnType<typeof parseAuthorsForStyle>>();
    const attemptScore = new Map<string, number>();
    for (const attempt of preparedAttempts) {
      if (!attempt.candidate) continue;
      const authorParse = parseAuthorsForStyle(
        attempt.candidate.parsed.authors ?? [],
        attempt.candidate.styleUsed ?? inputStyle,
      );
      let candidateScore = scoreCandidate(attempt.candidate.parsed, attempt.candidate.claimedType)
        - (authorParse.warningFlags.length * 2)
        - (authorParse.rejectedCandidates.length * 1.5);
      if (
        authorParse.parserMode === 'alternating_pairs'
        || authorParse.parserMode === 'surname_given_pairs'
      ) {
        candidateScore += 8;
      }
      if (attempt.branch === 'institutional_heuristic_raw') {
        candidateScore += attempt.candidate.claimedType === 'report' ? 4 : 1.2;
      }
      if (attempt.branch === 'in_source_heuristic_raw') {
        candidateScore += 1.8;
      }
      attemptAuthorParse.set(attempt.candidate.id, authorParse);
      attemptScore.set(attempt.candidate.id, candidateScore);
    }

    const selection = selectExtractionCandidate(preparedAttempts, selectorMode);
    const selectedBase = selection.winner
      ?? deterministicBaselineAttempt?.candidate
      ?? preparedAttempts.find((attempt) => attempt.candidate)?.candidate
      ?? {
        ...deterministic,
        id: 'legacy:synthetic_fallback',
        adapterId: 'legacy:synthetic_fallback',
        claimedType: deterministic.referenceType,
        normalizedKeyFields: buildNormalizedKeyFields(deterministic.parsed),
        containerHints: buildContainerHints(deterministic.parsed, deterministic.referenceType),
        plausibility: assessCandidatePlausibility(deterministic.parsed, deterministic.referenceType),
      };
    const selectedBranch = selectedBase.branch;
    let selectedReferenceType = selectedBase.claimedType;
    let mergedSelection = { ...selectedBase.parsed };
    const selectedReason = selectorMode === 'legacy_first_match'
      ? selectionReason(
        selectedBranch,
        deterministic.parsed,
        fallback?.parsed ?? null,
        institutional?.parsed ?? null,
        inSource?.parsed ?? null,
      )
      : selection.selectionReason;
    const selectedAuthorParse = attemptAuthorParse.get(selectedBase.id)
      ?? parseAuthorsForStyle(selectedBase.parsed.authors ?? [], selectedBase.styleUsed ?? inputStyle);
    const selectedStyle = selectedBase.styleUsed ?? deterministic.styleUsed ?? (inputStyle === 'auto' ? null : inputStyle);

    const mergeCompatibleAlternates = preparedAttempts
      .filter((attempt) => attempt.candidate && attempt.candidate.id !== selectedBase.id)
      .filter((attempt) => {
        const alternate = attempt.candidate!;
        if (selectedReferenceType === 'unknown') return true;
        if (alternate.claimedType === 'unknown') return true;
        return areReferenceTypesMergeCompatible(selectedReferenceType, alternate.claimedType);
      })
      .sort((left, right) =>
        (attemptScore.get(right.candidate!.id) ?? -999) - (attemptScore.get(left.candidate!.id) ?? -999));
    for (const alternate of mergeCompatibleAlternates) {
      mergedSelection = fillMissingFromFallback(
        mergedSelection,
        alternate.candidate!.parsed,
        selectedReferenceType === 'unknown' ? alternate.candidate!.claimedType : selectedReferenceType,
      );
    }

    const finalizedSelection = finalizeSelectedParse(
      mergedSelection,
      selectedReferenceType === 'unknown'
        ? mergeCompatibleAlternates.find((attempt) => attempt.candidate?.claimedType !== 'unknown')?.candidate?.claimedType ?? 'unknown'
        : selectedReferenceType,
      deterministic.referenceType !== 'unknown' ? deterministic.referenceType : null,
      selectedBase.normalized,
    );
    mergedSelection = finalizedSelection.parsed;
    selectedReferenceType = finalizedSelection.referenceType;
    let typeResolution = finalizedSelection.typeResolution;
    const winnerContainerHints = finalizedSelection.containerHints;
    const winnerRepairReasons = finalizedSelection.repairReasons;

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
    if (institutional && selectedBranch !== 'institutional_heuristic_raw') rejectedCandidates.push('institutional_heuristic_not_selected');
    if (inSource && selectedBranch !== 'in_source_heuristic_raw') rejectedCandidates.push('in_source_heuristic_not_selected');

    const inputStructure = options?.inputProfile?.structure ?? 'unknown';
    const inputSignals = new Set(options?.inputProfile?.signals ?? []);
    const batchSize = options?.batchSize ?? options?.inputProfile?.estimatedCount ?? 1;
    const grobidEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_GROBID_EXTRACTOR ?? '');
    const forceGrobid = options?.forceGrobid === true;
    const llmEnabled = !forceGrobid
      && /^(1|true|yes|on)$/i.test(process.env.ENABLE_LLM_EXTRACTOR ?? '1')
      && Boolean(process.env.OPENAI_API_KEY);
    const noisyProfileSignals = ['ocr_noise_markers', 'mixed_style_markers', 'long_prose_lines', 'footnote_markers']
      .filter((signal) => inputSignals.has(signal));
    const deterministicFriendlySignals = ['book_tail_markers', 'conference_tail_markers', 'doi_heavy']
      .filter((signal) => inputSignals.has(signal));
    const profilePrefersGrobid = inputStructure === 'semi_structured'
      || inputStructure === 'unstructured'
      || noisyProfileSignals.length > 0
      || splitContaminationFlags.some((flag) => ['header_bleed_suspected', 'page_artifact_present', 'multiline_truncation_suspected', 'oversized_chunk'].includes(flag));
    const profilePrefersDeterministic = deterministicFriendlySignals.length > 0;

    let llmApplied = false;
    let llmAttempted = false;
    let llmCapReached = false;
    let llmFallbackAccepted = false;
    let llmFallbackSkippedByBudget = false;
    let llmFallbackReusedFromCluster = false;
    let llmFallbackSkippedForTruth = false;
    let llmFallbackVerificationNeeded = false;
    let llmFallbackReason: string | undefined;
    let llmFallbackCacheKey: string | undefined;
    let llmFallbackClusterKey: string | undefined;
    let llmFallbackQueuePriority: number | undefined;
    let llmFallbackAttemptErrorType:
      | 'timeout'
      | 'rate_limit'
      | 'invalid_json_response'
      | 'empty_response'
      | 'network_error'
      | 'token_limit_exceeded'
      | 'unexpected_runtime_error'
      | undefined;
    let llmFallbackFieldsImproved: string[] = [];
    let llmFallbackStrictPassDelta = 0;
    let llmFallbackNoOpAccepted = false;
    let llmRawExtraction: LlmExtraction | null = null;
    let llmMergedCandidateParsed: ParsedReference | null = null;
    let llmBeforeParsed: ParsedReference | null = null;
    let llmFailureMessage: string | null = null;
    const llmWarnings: string[] = [];
    const llmTrigger = getLlmFallbackTrigger(
      mergedSelection,
      selectedReferenceType,
      selectedFieldConfidence,
      selectedAuthorParse,
      splitArtifact,
    );
    const fallbackRawText = options?.originalRawText ?? input;
    const outputStyle = options?.outputStyle ?? 'apa';
    const engineVersion = options?.engineVersion ?? 'v2';
    llmFallbackCacheKey = computeFallbackCacheKey(fallbackRawText);
    llmFallbackClusterKey = computeFallbackClusterKey(mergedSelection) ?? undefined;
    const weakSelection =
      llmTrigger.shouldTrigger
      || 
      needsLlmFallback(mergedSelection, selectedFieldConfidence, selectedReferenceType)
      || ((attemptScore.get(selectedBase.id) ?? deterministicScore) - contaminationScorePenalty) < V2_THRESHOLD_POLICY.extract.weakSelectionScore
      || selectedAuthorParse.warningFlags.length > 0
      || selectedAuthorParse.rejectedCandidates.length > 0
      || splitContaminationFlags.length > 0;
    const batchAllowsLlmFallback = shouldAllowLlmFallback(
      mergedSelection,
      selectedReferenceType,
      (attemptScore.get(selectedBase.id) ?? deterministicScore) - contaminationScorePenalty,
      batchSize,
      options?.executionMode,
    );
    const batchFallbackCap = getLocalExtractFallbackCallsForBatch(batchSize);
    const llmCriticalTriggerReasons = ['missing_authors', 'malformed_authors', 'weak_first_author', 'weak_venue', 'weak_reference_type', 'identifier_leakage', 'metadata_bleed', 'duplicated_tails'];
    const allowLlmFallback = weakSelection
      && (
        batchAllowsLlmFallback
        || llmCriticalTriggerReasons.includes(llmTrigger.reason ?? '')
      );
    llmFallbackQueuePriority = buildFallbackQueuePriority({
      reportedBefore: false,
      userEdited: Boolean(options?.userEdited),
      hardStructuralSuspicion: Boolean(llmTrigger.hardStructuralSuspicion),
      typePriority: Boolean(llmTrigger.typePriorityEligible),
    });

    if (llmEnabled && weakSelection && allowLlmFallback) {
      llmFallbackReason = llmTrigger.reason ?? 'weak_selection';
      const truthState = await resolveTruthStateForFallback({
        rawForCacheKey: fallbackRawText,
        outputStyle,
        engineVersion,
        userEdited: options?.userEdited,
        adminApproved: options?.adminApproved,
        terminalVerificationNeeded: options?.verificationNeeded,
      });
      const existingAttempt = llmFallbackCacheKey ? getFallbackAttemptHistory(llmFallbackCacheKey) : null;
      const persistedClusterReuse = getPersistedClusterReuse(llmFallbackClusterKey ?? null, engineVersion, outputStyle);

      if (truthState.truthIsCurrent) {
        llmFallbackSkippedForTruth = true;
        llmFallbackReason = 'truth_approved';
        llmWarnings.push('llm_fallback_skipped_truth');
      } else if (persistedClusterReuse) {
        const beforeParsed = { ...mergedSelection };
        const reusedReferenceType = persistedClusterReuse.fields.referenceType ?? selectedReferenceType;
        const reusedParsed = applyClusterReuseFields(mergedSelection, persistedClusterReuse);
        const sanitizedReused = sanitizeParsedReference(reusedParsed, reusedReferenceType);
        mergedSelection = normalizeAuthorOptionalWebsiteParse(sanitizedReused.parsed, sanitizedReused.referenceType);
        selectedReferenceType = sanitizedReused.referenceType;
        selectedFieldConfidence = {
          ...selectedFieldConfidence,
          ...applySplitPenaltyToFieldConfidence(buildFieldConfidence(mergedSelection, selectedReferenceType), splitPenalty),
        };
        llmFallbackAccepted = true;
        llmFallbackReusedFromCluster = true;
        llmFallbackReason = 'cluster_reuse';
        llmFallbackFieldsImproved = listMeaningfulFallbackFieldChanges(
          beforeParsed,
          mergedSelection,
          selectedReferenceType,
          selectedReferenceType,
        );
        llmWarnings.push('llm_fallback_reused_from_cluster');
      } else if (existingAttempt && !canRetryFallbackAttempt(existingAttempt)) {
        llmFallbackReason = existingAttempt.accepted ? 'exact_cache_hit' : 'exact_cache_rejected';
        llmWarnings.push('llm_fallback_cache_skip');
      } else {
        const inflightExact = llmFallbackCacheKey ? getInflightCachePromise<void>(llmFallbackCacheKey) : null;
        const inflightCluster = getInflightClusterPromise<void>(llmFallbackClusterKey ?? null);
        if (inflightExact) {
          await inflightExact;
        } else if (inflightCluster) {
          await inflightCluster;
        }

        const reusedAfterWait = getPersistedClusterReuse(llmFallbackClusterKey ?? null, engineVersion, outputStyle);
        if (reusedAfterWait) {
          const reusedReferenceType = reusedAfterWait.fields.referenceType ?? selectedReferenceType;
          const reusedParsed = applyClusterReuseFields(mergedSelection, reusedAfterWait);
          const sanitizedReused = sanitizeParsedReference(reusedParsed, reusedReferenceType);
          mergedSelection = normalizeAuthorOptionalWebsiteParse(sanitizedReused.parsed, sanitizedReused.referenceType);
          selectedReferenceType = sanitizedReused.referenceType;
          selectedFieldConfidence = {
            ...selectedFieldConfidence,
            ...applySplitPenaltyToFieldConfidence(buildFieldConfidence(mergedSelection, selectedReferenceType), splitPenalty),
          };
          llmFallbackAccepted = true;
          llmFallbackReusedFromCluster = true;
          llmFallbackReason = 'cluster_reuse';
          llmWarnings.push('llm_fallback_reused_from_cluster');
        } else {
          const reserved = await reserveExtractFallbackCall(options?.llmBudget, batchSize);
          if (!reserved) {
            llmCapReached = true;
            llmFallbackSkippedByBudget = true;
            rejectedCandidates.push('llm_batch_budget_cap_reached');
            llmWarnings.push('llm_batch_budget_cap_reached');
          } else {
            const llmExecution = (async () => {
              llmAttempted = true;
              try {
                const llm = await extractWithLlm(selectedBase.normalized);
                if (!llm) {
                  llmFallbackAttemptErrorType = 'empty_response';
                  llmFailureMessage = 'LLM returned no content.';
                  recordFallbackAttemptHistory({
                    cacheKey: llmFallbackCacheKey!,
                    accepted: false,
                    completedAt: new Date().toISOString(),
                    errorType: 'empty_response',
                  });
                  return;
                }

                const beforeParsed = { ...mergedSelection };
                llmRawExtraction = llm;
                llmBeforeParsed = beforeParsed;
                const beforeReferenceType = selectedReferenceType;
                const beforeFieldConfidence = { ...selectedFieldConfidence };
                const beforeAuthorParse = parseAuthorsForStyle(mergedSelection.authors ?? [], selectedStyle);
                const merged = mergeLlmWithDeterministic({
                  parsed: mergedSelection,
                  referenceType: selectedReferenceType,
                  fieldConfidence: selectedFieldConfidence,
                }, llm);
                let candidateSelection = normalizeAuthorOptionalWebsiteParse(
                  sanitizeParsedReference(merged.parsed, merged.referenceType).parsed,
                  sanitizeParsedReference(merged.parsed, merged.referenceType).referenceType,
                );
                const candidateSanitized = sanitizeParsedReference(candidateSelection, merged.referenceType);
                candidateSelection = normalizeAuthorOptionalWebsiteParse(candidateSanitized.parsed, candidateSanitized.referenceType);
                llmMergedCandidateParsed = candidateSelection;
                let hybridContainer = resolveWinnerContainer(candidateSelection, candidateSanitized.referenceType);
                candidateSelection = hybridContainer.parsed;
                llmMergedCandidateParsed = candidateSelection;
                const hybridResolution = resolveReferenceTypeFromEvidence({
                  claimedType: candidateSanitized.referenceType,
                  parsed: candidateSelection,
                  containerHints: hybridContainer.containerHints,
                  detectTypeHint: deterministic.referenceType !== 'unknown' ? deterministic.referenceType : null,
                });
                const candidateReferenceType = hybridResolution.referenceType;
                const candidateFieldConfidence = {
                  ...merged.fieldConfidence,
                  ...applySplitPenaltyToFieldConfidence(buildFieldConfidence(candidateSelection, candidateReferenceType), splitPenalty),
                };
                const candidateAuthorParse = parseAuthorsForStyle(candidateSelection.authors ?? [], selectedStyle);
                const acceptance = shouldAcceptLlmFallbackResult({
                  beforeParsed,
                  beforeReferenceType,
                  beforeFieldConfidence,
                  beforeAuthorParse,
                  afterParsed: candidateSelection,
                  afterReferenceType: candidateReferenceType,
                  afterFieldConfidence: candidateFieldConfidence,
                  afterAuthorParse: candidateAuthorParse,
                });
                llmFallbackFieldsImproved = acceptance.fieldsImproved;
                llmFallbackStrictPassDelta = acceptance.strictPassDelta;
                if (acceptance.accept) {
                  mergedSelection = candidateSelection;
                  selectedReferenceType = candidateReferenceType;
                  typeResolution = hybridResolution;
                  llmFallbackNoOpAccepted = mergedOutputIsNoOp(beforeParsed, candidateSelection)
                    && acceptance.fieldsImproved.length === 0
                    && acceptance.strictPassDelta <= 0;
                  selectedFieldConfidence = llmFallbackNoOpAccepted
                    ? beforeFieldConfidence
                    : candidateFieldConfidence;
                  extractorPath = 'llm';
                  llmApplied = true;
                  llmFallbackAccepted = true;
                  llmFallbackReason = acceptance.reason;
                  recordAcceptedClusterReuse(
                    llmFallbackClusterKey ?? null,
                    engineVersion,
                    outputStyle,
                    candidateSelection,
                    candidateReferenceType,
                  );
                  recordFallbackAttemptHistory({
                    cacheKey: llmFallbackCacheKey!,
                    accepted: true,
                    completedAt: new Date().toISOString(),
                  });
                  llmWarnings.push('llm_fallback_applied');
                } else {
                  rejectedCandidates.push(`llm_rejected:${acceptance.reason}`);
                  llmWarnings.push(`llm_fallback_rejected:${acceptance.reason}`);
                  llmFallbackReason = acceptance.reason;
                  recordFallbackAttemptHistory({
                    cacheKey: llmFallbackCacheKey!,
                    accepted: false,
                    completedAt: new Date().toISOString(),
                  });
                }
              } catch (error) {
                rejectedCandidates.push('llm_invalid_or_failed');
                llmFailureMessage = error instanceof Error ? error.message : String(error);
                llmFallbackAttemptErrorType = classifyLlmAttemptError(error);
                llmWarnings.push(`llm_fallback_failed:${llmFailureMessage}`);
                llmFallbackReason = 'llm_invalid_or_failed';
                recordFallbackAttemptHistory({
                  cacheKey: llmFallbackCacheKey!,
                  accepted: false,
                  completedAt: new Date().toISOString(),
                  errorType: llmFallbackAttemptErrorType,
                });
              }
            })();

            if (llmFallbackCacheKey) setInflightCachePromise(llmFallbackCacheKey, llmExecution);
            setInflightClusterPromise(llmFallbackClusterKey ?? null, llmExecution);
            try {
              await llmExecution;
            } finally {
              if (llmFallbackCacheKey) clearInflightCachePromise(llmFallbackCacheKey, llmExecution);
              clearInflightClusterPromise(llmFallbackClusterKey ?? null, llmExecution);
            }
          }
        }
      }

      if (options?.userEdited && !options?.adminApproved && (llmAttempted || llmFallbackReusedFromCluster)) {
        llmFallbackVerificationNeeded = true;
      }
    } else if (llmEnabled && weakSelection && !allowLlmFallback) {
      rejectedCandidates.push('llm_batch_gated');
      llmWarnings.push('llm_batch_gated');
      llmFallbackReason = llmTrigger.reason ?? 'not_near_pass';
    }

    const currentSelectionScore = scoreCandidate(mergedSelection, selectedReferenceType);
    const grobidRouteReason = forceGrobid
      ? options?.forceGrobidReason ?? 'forced_unresolved_recovery'
      : (
        needsLlmFallback(mergedSelection, selectedFieldConfidence, selectedReferenceType)
        || (currentSelectionScore - contaminationScorePenalty) < V2_THRESHOLD_POLICY.extract.weakSelectionScore
        || splitContaminationFlags.length > 0
      )
          ? 'weak_selected_parse'
        : detectionConfidence < 0.65
          ? 'low_detection_confidence'
          : profilePrefersGrobid && !profilePrefersDeterministic && detectionConfidence < 0.9
            ? 'noisy_profile_medium_confidence'
            : 'not_needed';
    const shouldTryGrobid = grobidEnabled && (forceGrobid || grobidRouteReason !== 'not_needed');

    if (grobidEnabled && !shouldTryGrobid) {
      console.log(JSON.stringify({
        stage: 'extract',
        adapter: 'grobid',
        event: 'skipped',
        reason: grobidRouteReason,
        batchSize,
        detectionConfidence,
        inputStructure,
        inputSignals: [...inputSignals],
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
          inputSignals: [...inputSignals],
          reason: grobidRouteReason,
        }));
        grobidCandidate = await extractWithGrobid(input);
        if (grobidCandidate) {
          grobidScore = scoreCandidate(grobidCandidate.parsed, grobidCandidate.referenceType) + 1;
          const grobidPreferredProfile = ['structured', 'semi_structured'].includes(inputStructure)
            && !profilePrefersDeterministic;
          const currentBestScore = Math.max(
            currentSelectionScore,
            deterministicScore,
            fallbackScore,
            institutionalScore,
            inSourceScore,
            ...Array.from(attemptScore.values()),
          );
          const grobidLooksUsable = Boolean(grobidCandidate.parsed.title) && Boolean(grobidCandidate.parsed.authors?.length);
          if (
            (forceGrobid && grobidLooksUsable)
            || (grobidLooksUsable && grobidPreferredProfile)
            || grobidScore > currentBestScore + 0.5
            || (grobidPreferredProfile && grobidLooksUsable && grobidScore >= currentBestScore - 0.25)
          ) {
            mergedSelection = fillMissingFromFallback(grobidCandidate.parsed, mergedSelection, grobidCandidate.referenceType);
            const sanitizedGrobid = sanitizeParsedReference(mergedSelection, grobidCandidate.referenceType);
            mergedSelection = normalizeAuthorOptionalWebsiteParse(sanitizedGrobid.parsed, sanitizedGrobid.referenceType);
            let grobidContainer = resolveWinnerContainer(mergedSelection, sanitizedGrobid.referenceType);
            mergedSelection = grobidContainer.parsed;
            const grobidResolution = resolveReferenceTypeFromEvidence({
              claimedType: sanitizedGrobid.referenceType,
              parsed: mergedSelection,
              containerHints: grobidContainer.containerHints,
              detectTypeHint: deterministic.referenceType !== 'unknown' ? deterministic.referenceType : null,
            });
            selectedReferenceType = grobidResolution.referenceType;
            typeResolution = grobidResolution;
            selectedFieldConfidence = applySplitPenaltyToFieldConfidence(
              buildFieldConfidence(mergedSelection, selectedReferenceType),
              splitPenalty,
            );
            extractorPath = llmApplied ? 'hybrid' : 'grobid';
            console.log(JSON.stringify({
              stage: 'extract',
              adapter: 'grobid',
              event: 'selected',
              batchSize,
              detectionConfidence,
              inputStructure,
              inputSignals: [...inputSignals],
              reason: grobidRouteReason,
              grobidScore,
              deterministicScore,
              fallbackScore,
              institutionalScore,
              inSourceScore,
              currentSelectionScore,
            }));
          } else {
            console.log(JSON.stringify({
              stage: 'extract',
              adapter: 'grobid',
              event: 'attempted_not_selected',
              batchSize,
              detectionConfidence,
              inputStructure,
              inputSignals: [...inputSignals],
              reason: grobidRouteReason,
              grobidScore,
              deterministicScore,
              fallbackScore,
              institutionalScore,
              inSourceScore,
              currentSelectionScore,
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
          inputSignals: [...inputSignals],
          reason: grobidRouteReason,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const selectionReasonSuffix = llmApplied
      ? '_with_llm_fill'
      : llmCapReached
        ? '_llm_cap_reached'
        : llmAttempted && llmFallbackReason === 'llm_invalid_or_failed'
          ? '_llm_invalid_or_failed'
          : llmAttempted && llmFallbackReason
            ? `_llm_rejected_${llmFallbackReason.replace(/[^a-z0-9]+/gi, '_')}`
          : '';
    const selectedAuthorFingerprint = JSON.stringify(selectedBase.parsed.authors ?? []);
    const provenanceAdjustedAuthors = normalizeAuthorsForProvenance(mergedSelection.authors ?? [], selectedStyle);
    const mergedAuthorFingerprint = JSON.stringify(provenanceAdjustedAuthors.authors ?? []);
    const selectedStyleConfidence = selectedBase.styleConfidence ?? deterministic.styleConfidence;
    const finalAuthorParse = selectedAuthorFingerprint === mergedAuthorFingerprint
      ? selectedAuthorParse
      : parseAuthorsForStyle(provenanceAdjustedAuthors.authors ?? [], selectedStyle);
    const warnings = Array.from(new Set([
      ...deterministic.warnings,
      ...(fallback?.warnings ?? []),
      ...(institutional?.warnings ?? []),
      ...(inSource?.warnings ?? []),
      ...selectedBase.warnings,
      ...splitWarnings,
      ...winnerRepairReasons.map((reason) => `selected_repair:${reason}`),
      ...llmWarnings,
    ]));
    const selectionDebugScores = preparedAttempts.reduce<Record<string, number>>((scores, attempt) => {
      if (attempt.candidate) {
        scores[attempt.adapterId] = attemptScore.get(attempt.candidate.id) ?? -999;
      }
      return scores;
    }, {});

    return {
      parsed: mergedSelection,
      referenceType: selectedReferenceType,
      method: llmApplied ? 'hybrid' as const : 'deterministic' as const,
      fallbackUsed:
        selectedBranch !== 'deterministic_raw'
        || llmApplied
        || llmAttempted
        || llmCapReached
        || extractorPath === 'grobid'
        || extractorPath === 'hybrid',
      extractorPath,
      selectedBranch: llmApplied ? 'hybrid' as const : selectedBranch,
      selectionReason: `${selectedReason}${selectionReasonSuffix}`,
      selectorMode,
      selectionMode: selection.selectionMode,
      winnerAdapterId: selectedBase.adapterId,
      winnerCandidateId: selectedBase.id,
      typeResolutionReason: typeResolution.reason,
      detectedStyle: selectedStyle,
      detectedStyleConfidence: selectedStyleConfidence,
      canonicalAuthors: finalAuthorParse.authors,
      authorParserMode: finalAuthorParse.parserMode,
      authorWarningFlags: finalAuthorParse.warningFlags,
      rejectedCandidates: [
        ...rejectedCandidates,
        ...finalAuthorParse.rejectedCandidates,
      ],
      llmCapReached,
      llmFallbackAttempted: llmAttempted,
      llmFallbackAccepted: llmFallbackAccepted,
      llmFallbackReason,
      llmFallbackSkippedByBudget,
      llmFallbackReusedFromCluster,
      llmFallbackSkippedForTruth,
      llmFallbackVerificationNeeded,
      llmFallbackCacheKey,
      llmFallbackClusterKey,
      llmFallbackQueuePriority,
      llmFallbackAttemptErrorType,
      llmFallbackFieldsImproved,
      llmFallbackStrictPassDelta,
      llmFallbackFirstAuthorConfidence: llmTrigger.firstAuthorConfidence,
      llmFallbackNoOpAccepted,
      fieldConfidence: selectedFieldConfidence,
      warnings,
      debug: options?.debugEnabled
        ? {
            deterministic_raw: deterministic.parsed,
            year_anchored_fallback_raw: fallback?.parsed ?? null,
            institutional_heuristic_raw: institutional?.parsed ?? null,
            in_source_heuristic_raw: inSource?.parsed ?? null,
            grobid_raw: grobidCandidate?.parsed ?? null,
            selected_branch: llmApplied ? 'hybrid' : selectedBranch,
            selection_reason: `${selectedReason}${selectionReasonSuffix}`,
            selector_mode: selectorMode,
            selection_mode: selection.selectionMode,
            winner_adapter_id: selectedBase.adapterId,
            winner_candidate_id: selectedBase.id,
            winner_score_breakdown: selection.winnerBreakdown,
            adapter_registry: selection.adapterRegistry,
            winner_container_hints: winnerContainerHints,
            winner_repair_reasons: winnerRepairReasons,
            type_resolution_reason: typeResolution.reason,
            extractor_path: extractorPath,
            detected_style: selectedStyle,
            detected_style_confidence: selectedStyleConfidence,
            deterministic_score: deterministicScore,
            fallback_score: fallbackScore,
            institutional_score: institutionalScore,
            in_source_score: inSourceScore,
            grobid_score: grobidScore,
            candidate_scores: selectionDebugScores,
            deterministic_author_parser_mode: deterministicAuthorParse.parserMode,
            deterministic_author_warning_flags: deterministicAuthorParse.warningFlags,
            fallback_author_parser_mode: fallbackAuthorParse.parserMode,
            fallback_author_warning_flags: fallbackAuthorParse.warningFlags,
            institutional_author_parser_mode: institutionalAuthorParse.parserMode,
            institutional_author_warning_flags: institutionalAuthorParse.warningFlags,
            in_source_author_parser_mode: inSourceAuthorParse.parserMode,
            in_source_author_warning_flags: inSourceAuthorParse.warningFlags,
            split_contamination_flags: splitContaminationFlags,
            split_contamination_penalty: splitPenalty,
            input_profile_signals: [...inputSignals],
            grobid_noisy_profile_signals: noisyProfileSignals,
            deterministic_friendly_signals: deterministicFriendlySignals,
            cleaned_chunk_length: splitArtifact?.chunkLength ?? input.length,
            llm_attempted: llmAttempted,
            llm_applied: llmApplied,
            llm_cap_reached: llmCapReached,
            llm_fallback_reason: llmFallbackReason,
            llm_fallback_skipped_by_budget: llmFallbackSkippedByBudget,
            llm_fallback_reused_from_cluster: llmFallbackReusedFromCluster,
            llm_fallback_skipped_for_truth: llmFallbackSkippedForTruth,
            llm_fallback_verification_needed: llmFallbackVerificationNeeded,
            llm_fallback_cache_key: llmFallbackCacheKey,
            llm_fallback_cluster_key: llmFallbackClusterKey,
            llm_fallback_queue_priority: llmFallbackQueuePriority,
            llm_fallback_attempt_error_type: llmFallbackAttemptErrorType,
            llm_fallback_fields_improved: llmFallbackFieldsImproved,
            llm_fallback_strict_pass_delta: llmFallbackStrictPassDelta,
            llm_fallback_first_author_confidence: llmTrigger.firstAuthorConfidence,
            llm_fallback_no_op_accepted: llmFallbackNoOpAccepted,
            llm_raw_extraction: llmRawExtraction,
            llm_before_parsed: llmBeforeParsed,
            llm_candidate_after_merge: llmMergedCandidateParsed,
            llm_failure_message: llmFailureMessage,
            llm_trigger: {
              shouldTrigger: llmTrigger.shouldTrigger,
              reason: llmTrigger.reason,
              authorCount: llmTrigger.authorCount,
              noAuthors: llmTrigger.noAuthors,
              malformedAuthorBlob: llmTrigger.malformedAuthorBlob,
              weakVenue: llmTrigger.weakVenue,
              weakReferenceType: llmTrigger.weakReferenceType,
              lowConfidenceNonCore: llmTrigger.lowConfidenceNonCore,
              duplicatedTails: llmTrigger.duplicatedTails,
              identifierLeakage: llmTrigger.identifierLeakage,
              metadataBleed: llmTrigger.metadataBleed,
              typePriorityEligible: llmTrigger.typePriorityEligible,
              strictNearPass: llmTrigger.strictNearPass,
              corePassedCount: llmTrigger.corePassedCount,
              batchFallbackCap,
              queuePriority: llmFallbackQueuePriority,
            },
            rejectedCandidates,
          }
        : undefined,
    };
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

function normalizeResolutionAuthors(authors: unknown): string[] {
  if (!Array.isArray(authors)) return [];

  return authors
    .map((author) => {
      if (!author) return '';
      if (typeof author === 'string') return normalizeWhitespace(author);
      if (typeof author === 'object') {
        const literal = normalizeWhitespace(String((author as { literal?: unknown }).literal ?? ''));
        if (literal) return literal;
        const family = normalizeWhitespace(String((author as { family?: unknown }).family ?? ''));
        const given = normalizeWhitespace(String((author as { given?: unknown }).given ?? ''));
        if (family && given) return `${family}, ${given}`;
        return family || given;
      }
      return '';
    })
    .filter(Boolean);
}

function parseYear(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function mapCrossrefSearchItem(item: Record<string, any>): ResolutionCandidateRecord {
  return {
    provider: 'crossref',
    title: item.title?.[0] ?? item.title,
    authors: normalizeResolutionAuthors(item.author),
    year: item.issued?.['date-parts']?.[0]?.[0],
    venue: item['container-title']?.[0] ?? item['container-title'],
    volume: item.volume,
    issue: item.issue,
    pages: item.page,
    publisher: item.publisher,
    doi: item.DOI,
    url: item.URL,
    sourceType: item.type,
    raw: item,
  };
}

function mapCrossrefDoiRecord(record: Record<string, any>): ResolutionCandidateRecord {
  return {
    provider: 'crossref',
    title: Array.isArray(record.title) ? record.title[0] : record.title,
    authors: normalizeResolutionAuthors(record.author),
    year: record.issued?.['date-parts']?.[0]?.[0]
      ?? record.published?.['date-parts']?.[0]?.[0]
      ?? record['published-print']?.['date-parts']?.[0]?.[0]
      ?? record['published-online']?.['date-parts']?.[0]?.[0],
    venue: Array.isArray(record['container-title']) ? record['container-title'][0] : record['container-title'],
    volume: record.volume,
    issue: record.issue,
    pages: record.page ?? record['article-number'] ?? record.number,
    publisher: record.publisher,
    doi: record.DOI,
    url: record.URL,
    sourceType: record.type,
    raw: record,
  };
}

function mapPubmedSummaryRecord(record: Record<string, any>): ResolutionCandidateRecord {
  const authors = Array.isArray(record.authors)
    ? record.authors.map((author: Record<string, unknown>) => normalizeWhitespace(String(author.name ?? ''))).filter(Boolean)
    : [];

  return {
    provider: 'pubmed',
    title: record.title,
    authors,
    year: parseYear(record.pubdate),
    venue: record.fulljournalname ?? record.source,
    doi: Array.isArray(record.articleids)
      ? record.articleids.find((entry: Record<string, unknown>) => String(entry.idtype ?? '').toLowerCase() === 'doi')?.value
      : undefined,
    url: record.elocationid,
    sourceType: 'journal-article',
    raw: record,
  };
}

function mapOpenAlexRecord(record: Record<string, any>): ResolutionCandidateRecord {
  const authors = Array.isArray(record.authorships)
    ? record.authorships
      .map((authorship: Record<string, any>) => normalizeWhitespace(String(authorship.raw_author_name ?? authorship.author?.display_name ?? '')))
      .filter(Boolean)
    : [];

  return {
    provider: 'openalex',
    title: record.title,
    authors,
    year: parseYear(record.publication_year),
    venue: record.primary_location?.source?.display_name,
    volume: record.biblio?.volume,
    issue: record.biblio?.issue,
    pages: [record.biblio?.first_page, record.biblio?.last_page].filter(Boolean).join('-') || undefined,
    doi: typeof record.doi === 'string' ? normalizeDoiValue(record.doi) : undefined,
    url: record.primary_location?.landing_page_url,
    sourceType: record.type,
    raw: record,
  };
}

const PROVIDER_MIN_INTERVAL_MS = {
  crossref: 125,
  pubmed: 400,
  openalex: 250,
} as const;

const PROVIDER_TIMEOUT_MS = {
  crossref: 2500,
  pubmed: 2500,
  openalex: 2500,
} as const;

const DOI_LOOKUP_LIMIT = pLimit(readPositiveIntEnv('V2_DOI_LOOKUP_CONCURRENCY', 6));

const providerLocks = new Map<keyof typeof PROVIDER_MIN_INTERVAL_MS, Promise<void>>();
const providerNextAllowedAt = new Map<keyof typeof PROVIDER_MIN_INTERVAL_MS, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1000;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());
  return null;
}

async function waitForProviderSlot(provider: keyof typeof PROVIDER_MIN_INTERVAL_MS): Promise<void> {
  const previous = providerLocks.get(provider) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  providerLocks.set(provider, current);

  await previous;
  try {
    const now = Date.now();
    const nextAllowedAt = providerNextAllowedAt.get(provider) ?? now;
    const waitMs = Math.max(0, nextAllowedAt - now);
    providerNextAllowedAt.set(provider, Math.max(now, nextAllowedAt) + PROVIDER_MIN_INTERVAL_MS[provider]);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  } finally {
    release();
    if (providerLocks.get(provider) === current) {
      providerLocks.delete(provider);
    }
  }
}

function isRetriableProviderStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchWithProviderPolicy(
  provider: keyof typeof PROVIDER_MIN_INTERVAL_MS,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const maxRetries = readPositiveIntEnv('V2_PROVIDER_MAX_RETRIES', 2);
  const maxRetryAfterMs = readPositiveIntEnv('V2_PROVIDER_MAX_RETRY_AFTER_MS', 4_000);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await waitForProviderSlot(provider);
    const response = await fetch(url, init);
    if (response.ok || !isRetriableProviderStatus(response.status) || attempt === maxRetries) {
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const backoffMs = Math.min(
      retryAfterMs ?? (PROVIDER_MIN_INTERVAL_MS[provider] * (attempt + 2) * 2),
      maxRetryAfterMs,
    );
    await sleep(backoffMs);
  }

  throw new Error(`Unreachable provider retry state for ${provider}`);
}

function isCrossrefResponseSufficient(record: Record<string, any>): boolean {
  const title = Array.isArray(record.title) ? record.title[0] : record.title;
  const year = record.issued?.['date-parts']?.[0]?.[0]
    ?? record.published?.['date-parts']?.[0]?.[0]
    ?? record['published-print']?.['date-parts']?.[0]?.[0]
    ?? record['published-online']?.['date-parts']?.[0]?.[0];
  const authorCount = Array.isArray(record.author) ? record.author.length : 0;
  const mappedType = mapCrossrefTypeToReferenceType(String(record.type ?? ''));
  const hasInstitutionalAuthority = Boolean(record.publisher || record.institution);
  return Boolean(title && year)
    && (
      authorCount > 0
      || (
        hasInstitutionalAuthority
        && ['report', 'book', 'website'].includes(mappedType)
      )
    );
}

function candidateLooksBiomedicalNamespace(candidate: ResolutionCandidateRecord | undefined): boolean {
  if (!candidate) return false;
  const venue = normalizeWhitespace(candidate.venue ?? '').toLowerCase();
  const sourceType = normalizeWhitespace(candidate.sourceType ?? '').toLowerCase();
  const combined = `${venue} ${sourceType}`;
  return /(pubmed|medline|nlm|biomed|clinical|medicine|medical|oncology|cardio|neurol|jama|bmj|nejm|lancet)/.test(combined);
}

async function fetchCrossrefDoiRecord(doi: string): Promise<Record<string, any> | null> {
  const normalizedDoi = normalizeDoiValue(doi);
  const response = await fetchWithProviderPolicy(
    'crossref',
    `https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CitingApp/1.0 (mailto:noreply@citing.app)',
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.crossref),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Crossref DOI lookup failed with status ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  const payload = await response.json() as { message?: Record<string, any> };
  return payload.message ?? null;
}

async function fetchOpenAlexByDoi(doi: string): Promise<ResolutionCandidateRecord[]> {
  const normalizedDoi = normalizeDoiValue(doi);
  const url = `https://api.openalex.org/works?filter=doi:${encodeURIComponent(`https://doi.org/${normalizedDoi}`)}&per-page=1&select=id,title,publication_year,authorships,biblio,primary_location,type,doi`;
  const response = await fetchWithProviderPolicy(
    'openalex',
    url,
    {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.openalex),
    },
  );
  if (!response.ok) {
    const error = new Error(`OpenAlex DOI lookup failed with status ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  const payload = await response.json() as { results?: Array<Record<string, any>> };
  return (payload.results ?? []).slice(0, 1).map(mapOpenAlexRecord);
}

async function fetchPubmedByDoi(doi: string): Promise<ResolutionCandidateRecord[]> {
  const normalizedDoi = normalizeDoiValue(doi);
  const searchParams = new URLSearchParams({
    db: 'pubmed',
    retmode: 'json',
    retmax: '1',
    term: `${normalizedDoi}[AID]`,
    tool: 'CitingApp',
  });
  const searchResponse = await fetchWithProviderPolicy(
    'pubmed',
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams.toString()}`,
    {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.pubmed),
    },
  );
  if (!searchResponse.ok) {
    const error = new Error(`PubMed DOI search failed with status ${searchResponse.status}`) as Error & { status?: number };
    error.status = searchResponse.status;
    throw error;
  }
  const searchPayload = await searchResponse.json() as { esearchresult?: { idlist?: string[] } };
  const ids = searchPayload.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const summaryParams = new URLSearchParams({
    db: 'pubmed',
    retmode: 'json',
    id: ids.join(','),
    tool: 'CitingApp',
  });
  const summaryResponse = await fetchWithProviderPolicy(
    'pubmed',
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams.toString()}`,
    {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.pubmed),
    },
  );
  if (!summaryResponse.ok) {
    const error = new Error(`PubMed DOI summary failed with status ${summaryResponse.status}`) as Error & { status?: number };
    error.status = summaryResponse.status;
    throw error;
  }
  const summaryPayload = await summaryResponse.json() as { result?: Record<string, any> };
  return ids
    .map((id) => summaryPayload.result?.[id])
    .filter(Boolean)
    .map(mapPubmedSummaryRecord);
}

function buildCrossrefFilters(
  query: ResolutionSearchQuery,
  includeTypeFilter: boolean,
): { filter: string | null; typeFilterApplied: boolean } {
  const filters: string[] = [];
  const typeFilter = includeTypeFilter ? crossrefTypeFilterForSourceType(query.sourceType) : null;
  if (query.year != null) {
    filters.push(`from-pub-date:${query.year}-01-01`);
    filters.push(`until-pub-date:${query.year}-12-31`);
  }
  if (typeFilter) {
    filters.push(typeFilter);
  }
  return {
    filter: filters.length > 0 ? filters.join(',') : null,
    typeFilterApplied: Boolean(typeFilter),
  };
}

function buildCrossrefSearchUrl(
  query: ResolutionSearchQuery,
  limit: number,
  includeTypeFilter: boolean,
): { url: string; typeFilterApplied: boolean } {
  const params = new URLSearchParams({
    rows: String(limit),
    select: 'DOI,title,author,issued,container-title,volume,issue,page,publisher,URL,type',
    'query.bibliographic': query.title,
  });

  const authorQuery = query.firstAuthorSurname ?? query.groupAuthorLiteral;
  if (authorQuery) params.set('query.author', authorQuery);
  if (query.venue) params.set('query.container-title', query.venue);

  const filters = buildCrossrefFilters(query, includeTypeFilter);
  if (filters.filter) params.set('filter', filters.filter);

  return {
    url: `https://api.crossref.org/works?${params.toString()}`,
    typeFilterApplied: filters.typeFilterApplied,
  };
}

function buildPubmedSearchTerm(query: ResolutionSearchQuery): string {
  const parts = [`"${query.title}"[Title]`];
  if (query.firstAuthorSurname) parts.push(`"${query.firstAuthorSurname}"[1au]`);
  if (query.year != null) parts.push(`${query.year}[pdat]`);
  return parts.join(' AND ');
}

function buildOpenAlexSearchUrl(query: ResolutionSearchQuery, limit: number, includeYearFilter: boolean): string {
  const params = new URLSearchParams({
    'search': `"${query.title}"`,
    'per-page': String(limit),
    'select': 'id,title,publication_year,authorships,biblio,primary_location,type,doi',
    'mailto': 'noreply@citing.app',
  });
  if (includeYearFilter && query.year != null) {
    params.set('filter', `publication_year:${query.year}`);
  }
  return `https://api.openalex.org/works?${params.toString()}`;
}

class DefaultResolutionProviderAdapter implements ResolutionProviderAdapter {
  readonly id = 'strict-network-resolution';

  async lookupByDoi(doi: string): Promise<ResolutionCandidateRecord[]> {
    return DOI_LOOKUP_LIMIT(async () => {
      const normalizedDoi = normalizeDoiValue(doi);
      const candidates: ResolutionCandidateRecord[] = [];

      const crossrefRecord = await fetchCrossrefDoiRecord(normalizedDoi);
      const crossrefCandidate = crossrefRecord ? mapCrossrefDoiRecord(crossrefRecord) : null;
      if (crossrefCandidate) {
        candidates.push(crossrefCandidate);
      }

      if (!crossrefRecord || !isCrossrefResponseSufficient(crossrefRecord)) {
        const openAlexCandidates = await fetchOpenAlexByDoi(normalizedDoi);
        candidates.push(...openAlexCandidates);
      }

      const biomedicalAnchor = candidates.find(candidateLooksBiomedicalNamespace);
      if (biomedicalAnchor) {
        const pubmedCandidates = await fetchPubmedByDoi(normalizedDoi);
        candidates.push(...pubmedCandidates);
      }

      const seen = new Set<string>();
      return candidates.filter((candidate) => {
        const key = [
          candidate.provider,
          normalizeDoiValue(candidate.doi ?? ''),
          normalizeWhitespace(candidate.title ?? '').toLowerCase(),
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
  }

  async searchCrossrefByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]> {
    const requestInit = {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CitingApp/1.0 (mailto:noreply@citing.app)',
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.crossref),
    } satisfies RequestInit;
    const primarySearch = buildCrossrefSearchUrl(query, limit, true);

    const primaryResponse = await fetchWithProviderPolicy(
      'crossref',
      primarySearch.url,
      requestInit,
    );
    if (!primaryResponse.ok) {
      const error = new Error(`Crossref title search failed with status ${primaryResponse.status}`) as Error & { status?: number };
      error.status = primaryResponse.status;
      throw error;
    }

    const primaryPayload = await primaryResponse.json() as { message?: { items?: Array<Record<string, any>> } };
    const primaryItems = (primaryPayload.message?.items ?? []).slice(0, limit);
    if (primaryItems.length > 0) {
      return primaryItems.map(mapCrossrefSearchItem);
    }
    if (!primarySearch.typeFilterApplied) {
      return [];
    }

    const relaxedSearch = buildCrossrefSearchUrl(query, limit, false);

    const relaxedResponse = await fetchWithProviderPolicy(
      'crossref',
      relaxedSearch.url,
      requestInit,
    );
    if (!relaxedResponse.ok) {
      const error = new Error(`Crossref title search failed with status ${relaxedResponse.status}`) as Error & { status?: number };
      error.status = relaxedResponse.status;
      throw error;
    }

    const relaxedPayload = await relaxedResponse.json() as { message?: { items?: Array<Record<string, any>> } };
    return (relaxedPayload.message?.items ?? []).slice(0, limit).map(mapCrossrefSearchItem);
  }

  async searchPubmedByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]> {
    const searchParams = new URLSearchParams({
      db: 'pubmed',
      retmode: 'json',
      retmax: String(limit),
      term: buildPubmedSearchTerm(query),
      tool: 'CitingApp',
      email: 'noreply@citing.app',
    });
    const searchResponse = await fetchWithProviderPolicy(
      'pubmed',
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams.toString()}`,
      {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.pubmed),
      },
    );
    if (!searchResponse.ok) {
      const error = new Error(`PubMed search failed with status ${searchResponse.status}`) as Error & { status?: number };
      error.status = searchResponse.status;
      throw error;
    }

    const search = await searchResponse.json() as { esearchresult?: { idlist?: string[] } };
    const ids = search.esearchresult?.idlist?.slice(0, limit) ?? [];
    if (ids.length === 0) return [];

    const summaryParams = new URLSearchParams({
      db: 'pubmed',
      retmode: 'json',
      id: ids.join(','),
      tool: 'CitingApp',
      email: 'noreply@citing.app',
    });
    const summaryResponse = await fetchWithProviderPolicy(
      'pubmed',
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams.toString()}`,
      {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.pubmed),
      },
    );
    if (!summaryResponse.ok) {
      const error = new Error(`PubMed summary failed with status ${summaryResponse.status}`) as Error & { status?: number };
      error.status = summaryResponse.status;
      throw error;
    }

    const summary = await summaryResponse.json() as { result?: Record<string, any> };
    return ids
      .map((id) => summary.result?.[id])
      .filter(Boolean)
      .map(mapPubmedSummaryRecord);
  }

  async searchOpenAlexByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]> {
    const requestInit = {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.openalex),
    } satisfies RequestInit;

    const primaryResponse = await fetchWithProviderPolicy(
      'openalex',
      buildOpenAlexSearchUrl(query, limit, true),
      requestInit,
    );
    if (!primaryResponse.ok) {
      const error = new Error(`OpenAlex search failed with status ${primaryResponse.status}`) as Error & { status?: number };
      error.status = primaryResponse.status;
      throw error;
    }

    const primaryPayload = await primaryResponse.json() as { results?: Array<Record<string, any>> };
    const primaryItems = (primaryPayload.results ?? []).slice(0, limit);
    if (primaryItems.length > 0) {
      return primaryItems.map(mapOpenAlexRecord);
    }

    const relaxedResponse = await fetchWithProviderPolicy(
      'openalex',
      buildOpenAlexSearchUrl(query, limit, false),
      requestInit,
    );
    if (!relaxedResponse.ok) {
      const error = new Error(`OpenAlex search failed with status ${relaxedResponse.status}`) as Error & { status?: number };
      error.status = relaxedResponse.status;
      throw error;
    }

    const relaxedPayload = await relaxedResponse.json() as { results?: Array<Record<string, any>> };
    return (relaxedPayload.results ?? []).slice(0, limit).map(mapOpenAlexRecord);
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
    resolutionProvider: new DefaultResolutionProviderAdapter(),
    embedding: new NoopEmbeddingAdapter(),
    cache: new MemoryCacheAdapter(),
    exportAdapter: new DefaultExportAdapter(),
  };
}
