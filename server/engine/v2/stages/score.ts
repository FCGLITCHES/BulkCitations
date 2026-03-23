import type { CanonicalCitation, CitationQualityScore } from '@shared/schema';
import { isPlaceholderFieldValue } from '@shared/referencePlaceholders';
import { isGroupAuthor } from '../../shared/citationSemantics.js';
import { matchTitlesStrict } from '../resolution.js';
import type { V2Stage } from '../contracts.js';
import {
  runStageTasksSequentiallyWithIsolation,
} from '../stageIsolation.js';
import { addCitationStageLog, average, createStageDiagnostic, normalizeWhitespace } from '../utils.js';
import {
  countStructuralValidationIssues,
  getRequirementProfile,
  getMissingExpectedFields,
  getMissingRequiredFields,
} from '../qualityRules.js';

const CONFIRMED_SPLIT_CODES = new Set([
  'header_bleed_confirmed',
  'doi_orphan_confirmed',
  'multiline_truncation_confirmed',
  'page_artifact_confirmed',
  'oversized_chunk_confirmed',
  'embedded_reference_start_in_title',
  'embedded_reference_start_in_venue',
  'multiple_doi_clusters',
  'multiple_year_anchor_clusters',
]);

const SUSPECTED_SPLIT_CODES = new Set([
  'header_bleed_suspected',
  'doi_orphan_suspected',
  'multiline_truncation_suspected',
  'page_artifact_suspected',
  'oversized_chunk_suspected',
]);

const CLEAN_UNRESOLVED_ACTIVE_READY_THRESHOLD = 0.83;
const DUPLICATE_AUTO_READY_THRESHOLD = CLEAN_UNRESOLVED_ACTIVE_READY_THRESHOLD;
const CLEAN_UNRESOLVED_DUPLICATE_READY_THRESHOLD = CLEAN_UNRESOLVED_ACTIVE_READY_THRESHOLD;
const GENERIC_VENUE_PATTERN = /^(?:journal|conference|proceedings|book|report|website|site|web(?:page)?)(?:\s+(?:vol(?:ume)?|issue|no|number|pp?|pages?|article|\d+))*$/i;
const CLEAN_UNRESOLVED_VALIDATION_CODES = new Set([
  'no_exact_external_match',
  'ambiguous_external_match',
  'provider_no_coverage',
  'provider_resolution_error',
  'authority_rate_limited',
  'authority_fields_applied',
  'resolution_year_tolerance_applied',
]);

function grade(overall: number): 'A' | 'B' | 'C' | 'F' {
  if (overall >= 0.9) return 'A';
  if (overall >= 0.75) return 'B';
  if (overall >= 0.6) return 'C';
  return 'F';
}

function isVerifiedResolution(citation: CanonicalCitation): boolean {
  return citation.resolution?.status === 'verified' || citation.resolution?.status === 'verified_with_year_tolerance';
}

function getVenueScore(citation: CanonicalCitation, fieldScores: Record<string, number>): number {
  switch (citation.referenceType) {
    case 'conference':
      return Math.max(
        citation.conferenceTitle.value ? Math.max(fieldScores.conferenceTitle, 0.82) : 0,
        citation.bookTitle.value ? Math.max(fieldScores.bookTitle, 0.82) : 0,
        citation.publisher.value ? fieldScores.publisher : 0,
        citation.journal.value ? fieldScores.journal : 0,
      );
    case 'chapter':
      return Math.max(
        citation.bookTitle.value ? Math.max(fieldScores.bookTitle, 0.82) : 0,
        citation.publisher.value ? fieldScores.publisher : 0,
      );
    case 'thesis':
      return Math.max(fieldScores.institution, fieldScores.publisher);
    case 'report':
      return Math.max(fieldScores.institution, fieldScores.publisher, fieldScores.journal);
    case 'website':
      return Math.max(fieldScores.publisher, fieldScores.journal, fieldScores.url);
    case 'book':
      return Math.max(fieldScores.publisher, fieldScores.bookTitle);
    default:
      return Math.max(
        citation.journal.value ? fieldScores.journal : 0,
        citation.publisher.value ? fieldScores.publisher : 0,
        citation.bookTitle.value ? fieldScores.bookTitle : 0,
      );
  }
}

function buildFieldScores(citation: CanonicalCitation): Record<string, number> {
  return {
    authors: citation.authors.confidence,
    title: citation.title.confidence,
    year: citation.year.value != null ? Math.max(citation.year.confidence, 0.85) : citation.year.confidence,
    journal: citation.journal.confidence,
    conferenceTitle: citation.conferenceTitle.confidence,
    bookTitle: citation.bookTitle.confidence,
    volume: citation.volume.confidence,
    issue: citation.issue.confidence,
    pages: citation.pages.confidence,
    doi: citation.doi.confidence,
    publisher: citation.publisher.confidence,
    institution: citation.institution.confidence,
    url: citation.url.confidence,
    edition: citation.edition.confidence,
    editor: citation.editor.confidence,
  };
}

function titleLooksSubstantive(citation: CanonicalCitation): boolean {
  const title = normalizeWhitespace(citation.title.value ?? '');
  if (!title) return false;
  const tokens = title.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;
  if (/\?/.test(title)) return false;
  if (/^[\p{L}'’.-]+\s*,\s*[\p{L}'’.-]+$/u.test(title)) return false;
  if (/\b(?:journal|conference|vol(?:ume)?|issue|pp?|pages?)\b/i.test(title) && /(?:19|20)\d{2}|\?/.test(title)) {
    return false;
  }
  return true;
}

function venueLooksSubstantive(citation: CanonicalCitation): boolean {
  const venue = normalizeWhitespace(
    citation.conferenceTitle.value
    ?? citation.bookTitle.value
    ?? citation.journal.value
    ?? citation.publisher.value
    ?? citation.institution.value
    ?? '',
  );
  if (!venue) return false;
  if (/\?/.test(venue)) return false;

  const normalized = normalizeWhitespace(
    venue
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' '),
  );

  if (!normalized) return false;
  if (isPlaceholderFieldValue(normalized)) return false;
  if (GENERIC_VENUE_PATTERN.test(normalized)) return false;
  if (/(?:^|[\s,])(?:vol(?:ume)?|issue|pp?|pages?)\.?$/i.test(venue)) return false;
  if (/\b[A-Z]{3,}\b/.test(venue)) return true;
  return normalized.split(/\s+/).filter(Boolean).some((token) => token.length >= 4);
}

function hasAnyVenue(citation: CanonicalCitation): boolean {
  return Boolean(
    citation.journal.value
    || citation.conferenceTitle.value
    || citation.bookTitle.value
    || citation.publisher.value
    || citation.institution.value,
  );
}

function onlyCleanUnresolvedIssues(citation: CanonicalCitation): boolean {
  return citation.validationIssues.every((issue) => CLEAN_UNRESOLVED_VALIDATION_CODES.has(issue.code));
}

function keyFieldConfidenceReady(citation: CanonicalCitation, fieldScores: Record<string, number>): boolean {
  const profile = getRequirementProfile(citation.referenceType);
  return profile.required.every((field) => {
    switch (field) {
      case 'authors':
        return fieldScores.authors >= 0.88;
      case 'title':
        return fieldScores.title >= 0.88;
      case 'year':
        return fieldScores.year >= 0.88;
      case 'venue':
        return getVenueScore(citation, fieldScores) >= 0.88;
      case 'publisher':
        return fieldScores.publisher >= 0.88;
      case 'institution':
        return Math.max(fieldScores.institution, fieldScores.publisher) >= 0.88;
      case 'bookTitle':
        return fieldScores.bookTitle >= 0.88;
      case 'url':
        return fieldScores.url >= 0.88;
      default:
        return true;
    }
  });
}

function localReadyWithoutCoverage(citation: CanonicalCitation, overall: number, fieldScores: Record<string, number>): boolean {
  if (!['report', 'book', 'website'].includes(citation.referenceType)) return false;
  if (!citation.resolution || !['provider_no_coverage', 'no_exact_match'].includes(citation.resolution.status)) return false;
  return overall >= 0.9 && keyFieldConfidenceReady(citation, fieldScores);
}

function allowsLocalReadyOnResolutionMiss(citation: CanonicalCitation): boolean {
  return ['report', 'book', 'website'].includes(citation.referenceType);
}

function localReadyWithoutResolution(citation: CanonicalCitation, overall: number, fieldScores: Record<string, number>): boolean {
  if (citation.resolution) return false;
  return overall >= 0.9 && keyFieldConfidenceReady(citation, fieldScores);
}

function localReadyWithCleanUnresolvedResolution(
  citation: CanonicalCitation,
  overall: number,
  fieldScores: Record<string, number>,
  missingRequired: string[],
  missingExpected: string[],
  noErrorLevelIssues: boolean,
): boolean {
  if (!citation.resolution || !['no_exact_match', 'ambiguous_match', 'provider_no_coverage', 'provider_error'].includes(citation.resolution.status)) {
    return false;
  }
  if (!noErrorLevelIssues || missingRequired.length > 0 || missingExpected.length > 0) return false;
  if (!onlyCleanUnresolvedIssues(citation)) return false;
  if (!titleLooksSubstantive(citation) || !venueLooksSubstantive(citation)) return false;

  const authorRequired = getRequirementProfile(citation.referenceType).required.includes('authors');
  if (authorRequired && fieldScores.authors < 0.84) return false;
  if (fieldScores.title < 0.88 || fieldScores.year < 0.88) return false;

  const threshold = citation.status === 'duplicate'
    ? CLEAN_UNRESOLVED_DUPLICATE_READY_THRESHOLD
    : CLEAN_UNRESOLVED_ACTIVE_READY_THRESHOLD;

  return overall >= threshold;
}

function duplicateAutoReady(citation: CanonicalCitation, overall: number): boolean {
  return citation.status === 'duplicate' && overall >= DUPLICATE_AUTO_READY_THRESHOLD;
}

function exactExternalTitleMatch(citation: CanonicalCitation): boolean {
  if (!isVerifiedResolution(citation) || !citation.resolution?.acceptedCandidate?.title) return false;
  return matchTitlesStrict(citation.title.value, citation.resolution.acceptedCandidate.title).exact;
}

function doiVerified(citation: CanonicalCitation): boolean {
  return isVerifiedResolution(citation) && citation.resolution?.matchStrategy === 'crossref_doi';
}

function canIgnoreMissingVerifiedVenue(citation: CanonicalCitation): boolean {
  if (!isVerifiedResolution(citation)) return false;
  if (doiVerified(citation) || exactExternalTitleMatch(citation)) return true;
  return Boolean(
    citation.resolution?.acceptedCandidate?.title
    && citation.title.confidence >= 0.88
    && citation.year.confidence >= 0.88,
  );
}

function effectiveRequiredFields(citation: CanonicalCitation, requirementProfile: ReturnType<typeof getRequirementProfile>): string[] {
  return requirementProfile.required.filter((field) => !(field === 'venue' && canIgnoreMissingVerifiedVenue(citation)));
}

function effectiveMissingRequiredFields(citation: CanonicalCitation, missingRequired: string[]): string[] {
  if (!canIgnoreMissingVerifiedVenue(citation)) return missingRequired;
  return missingRequired.filter((field) => field !== 'venue');
}

function hasConfirmedSplitContamination(validationCodes: Set<string>): boolean {
  return [...CONFIRMED_SPLIT_CODES].some((code) => validationCodes.has(code));
}

function hasAnySplitContamination(validationCodes: Set<string>): boolean {
  return [...SUSPECTED_SPLIT_CODES, ...CONFIRMED_SPLIT_CODES].some((code) => validationCodes.has(code));
}

function scoreCitation(citation: CanonicalCitation): CitationQualityScore {
  const fieldScores = buildFieldScores(citation);
  const rawMissingRequired = getMissingRequiredFields(citation);
  const missingExpected = getMissingExpectedFields(citation);
  const requirementProfile = getRequirementProfile(citation.referenceType);
  const requiredFields = effectiveRequiredFields(citation, requirementProfile);
  const missingRequired = effectiveMissingRequiredFields(citation, rawMissingRequired);
  const venueScore = getVenueScore(citation, fieldScores);
  const requiredScores: number[] = requiredFields.map((field) => {
    switch (field) {
      case 'authors':
        return fieldScores.authors;
      case 'title':
        return fieldScores.title;
      case 'year':
        return fieldScores.year;
      case 'venue':
        return venueScore;
      case 'publisher':
        return fieldScores.publisher;
      case 'institution':
        return Math.max(fieldScores.institution, fieldScores.publisher);
      case 'bookTitle':
        return Math.max(fieldScores.bookTitle, fieldScores.publisher);
      case 'url':
        return fieldScores.url;
      default:
        return 0;
    }
  });

  let overall = requiredScores.length > 0 ? average(requiredScores) : 0;

  const expectedBonuses: number[] = [];
  if (citation.volume.value) expectedBonuses.push(fieldScores.volume);
  if (citation.issue.value) expectedBonuses.push(fieldScores.issue);
  if (citation.pages.value) expectedBonuses.push(fieldScores.pages);
  if (citation.publisher.value && ['conference', 'chapter', 'report', 'book'].includes(citation.referenceType)) {
    expectedBonuses.push(fieldScores.publisher);
  }
  if (citation.url.value && ['website', 'report'].includes(citation.referenceType)) {
    expectedBonuses.push(fieldScores.url);
  }
  if (expectedBonuses.length > 0) {
    overall = Math.min(1, overall + (average(expectedBonuses) * 0.08));
  }

  const validationCodes = new Set(citation.validationIssues.map((issue) => issue.code));
  const structuralIssues = countStructuralValidationIssues(citation);
  const hasWeakProceedingsVenue = citation.validationIssues.some((issue) => issue.code === 'weak_proceedings_venue' && issue.severity !== 'info');
  const hasDroppedLocatorWarning = citation.validationIssues.some((issue) => issue.code === 'locator_missing_from_source' && issue.severity !== 'info');
  const hasConfirmedSplit = hasConfirmedSplitContamination(validationCodes);
  const hasInsufficientEvidence = citation.resolution?.status === 'insufficient_evidence';
  const hasAmbiguousMatch = citation.resolution?.status === 'ambiguous_match';
  const hasHardConflicts = (citation.resolution?.conflictFields.length ?? 0) > 0;
  const hasResolutionMiss = citation.resolution?.status === 'no_exact_match';
  const hasProviderError = citation.resolution?.status === 'provider_error';
  const hasProviderNoCoverage = citation.resolution?.status === 'provider_no_coverage';
  const duplicatePenalty = citation.status === 'duplicate'
    ? citation.duplicate?.confidencePenalty ?? 0
    : 0;
  const duplicateChangedFields = citation.status === 'duplicate'
    ? citation.duplicate?.changedFields ?? []
    : [];

  overall = Math.max(0, overall - (structuralIssues.severe * 0.18));

  if (validationCodes.has('connector_as_author') || validationCodes.has('author_structure_unstable')) overall = Math.min(overall, 0.32);
  if (validationCodes.has('placeholder_volume') || validationCodes.has('placeholder_journal')) overall = Math.max(0, overall - 0.12);
  if (hasWeakProceedingsVenue) overall = Math.max(0, overall - 0.08);
  if (hasDroppedLocatorWarning) overall = Math.max(0, overall - 0.06);
  if (validationCodes.has('initials_as_surname')) overall = Math.max(0, overall - 0.08);
  if (validationCodes.has('protected_title_token_corrupted') || validationCodes.has('protected_venue_token_corrupted')) overall = Math.min(overall, 0.45);
  if (hasHardConflicts) overall = Math.min(overall, 0.52);
  if (hasInsufficientEvidence) overall = Math.min(overall, 0.45);
  if (hasAmbiguousMatch) overall = Math.min(overall, 0.84);
  if (hasResolutionMiss && !allowsLocalReadyOnResolutionMiss(citation)) overall = Math.min(overall, 0.95);
  if (hasProviderError) overall = Math.max(0, overall - 0.03);
  if (isVerifiedResolution(citation)) overall = Math.min(1, overall + 0.03);

  if (citation.extraction?.method === 'llm') overall *= 0.9;
  if (citation.extraction?.method === 'hybrid') overall *= 0.95;
  if (citation.extraction?.fallbackUsed) overall = Math.max(0, overall - 0.04);
  if (citation.enrichment?.retractedFlag) overall = Math.min(overall, 0.4);
  if (duplicatePenalty > 0) overall = Math.max(0, overall - duplicatePenalty);

  const missingOptional: string[] = [];
  for (const optionalField of ['doi', 'journal', 'volume', 'issue', 'pages', 'publisher', 'url'] as const) {
    if (!citation[optionalField].value) {
      missingOptional.push(optionalField);
    }
  }

  const flags: string[] = [];
  if (citation.status === 'duplicate') flags.push('duplicate');
  if (duplicatePenalty > 0) flags.push('duplicate_fields_changed');
  if (citation.extraction?.fallbackUsed) flags.push('llm_extracted');
  if (citation.title.confidence < 0.5) flags.push('low_confidence_title');
  if (citation.authors.value.some((author) => Boolean(author.literal) && !isGroupAuthor(author.literal ?? ''))) {
    flags.push('author_parse_failed');
  }
  if (validationCodes.has('placeholder_volume') || validationCodes.has('placeholder_journal')) flags.push('placeholder_fields');
  if (validationCodes.has('connector_as_author') || validationCodes.has('author_structure_unstable') || validationCodes.has('initials_as_surname')) flags.push('malformed_authors');
  if (structuralIssues.severe > 0 || structuralIssues.review > 0) flags.push('review');
  if (validationCodes.has('authority_rate_limited')) flags.push('authority_rate_limited');
  if (validationCodes.has('provider_no_coverage')) flags.push('provider_no_coverage');
  if (hasProviderError) flags.push('provider_error');
  if (citation.resolution?.status === 'ambiguous_match') flags.push('resolution_ambiguous');
  if (hasInsufficientEvidence) flags.push('resolution_insufficient_evidence');
  if (hasHardConflicts) flags.push('field_conflicts');
  if (hasAnySplitContamination(validationCodes)) flags.push('split_contamination_suspected');
  if (hasConfirmedSplit) flags.push('split_contamination_confirmed');
  if (validationCodes.has('protected_title_token_corrupted') || validationCodes.has('protected_venue_token_corrupted')) {
    flags.push('protected_token_corruption');
  }
  if (citation.enrichment?.retractedFlag) flags.push('retracted');
  if (doiVerified(citation)) flags.push('doi_verified');
  else if (exactExternalTitleMatch(citation)) flags.push('exact_external_match');
  if (citation.resolution?.status === 'verified_with_year_tolerance') flags.push('year_tolerance_applied');
  if ((rawMissingRequired.includes('venue') && missingRequired.length === rawMissingRequired.length - 1)
    || (isVerifiedResolution(citation) && !hasAnyVenue(citation))) {
    flags.push('verified_missing_venue');
  }

  if (flags.includes('malformed_authors')) {
    overall = Math.min(overall, 0.45);
  }
  if (missingRequired.length > 0) {
    overall = Math.min(overall, 0.59);
  }
  if (hasConfirmedSplit) {
    overall = Math.min(overall, 0.49);
  }

  overall = Number(overall.toFixed(2));

  const errorIssues = citation.validationIssues.filter((issue) => issue.severity === 'error');
  const noErrorLevelIssues = errorIssues.length === 0;
  const readyByResolution = doiVerified(citation) || exactExternalTitleMatch(citation) || localReadyWithoutCoverage(citation, overall, fieldScores);
  const readyByLocalOnly = localReadyWithoutResolution(citation, overall, fieldScores);
  const readyByCleanUnresolvedResolution = localReadyWithCleanUnresolvedResolution(
    citation,
    overall,
    fieldScores,
    missingRequired,
    missingExpected,
    noErrorLevelIssues,
  );
  const readyByDuplicateConfidence = duplicateAutoReady(citation, overall);
  const actionNeeded = citation.status !== 'duplicate' && (
    hasInsufficientEvidence
    || flags.includes('malformed_authors')
    || missingRequired.length > 0
    || flags.includes('protected_token_corruption')
    || hasConfirmedSplit
    || hasHardConflicts
    || errorIssues.some((issue) => [
      'embedded_reference_start_in_title',
      'embedded_reference_start_in_venue',
      'multiple_doi_clusters',
      'multiple_year_anchor_clusters',
    ].includes(issue.code))
  );

  const reviewNeeded = hasAmbiguousMatch
    || hasResolutionMiss
    || hasProviderError
    || hasProviderNoCoverage
    || (overall >= 0.75 && overall < 0.9);

  let bucket: CitationQualityScore['bucket'] = 'worth_reviewing';
  let bucketReasons: string[] = [];

  if (actionNeeded) {
    bucket = 'action_needed';
    bucketReasons = [
      ...(hasInsufficientEvidence ? ['Not enough parse evidence was available for strict external resolution.'] : []),
      ...(flags.includes('malformed_authors') ? ['Author parsing remains malformed.'] : []),
      ...(missingRequired.length > 0 ? [`Missing required fields: ${missingRequired.join(', ')}.`] : []),
      ...(flags.includes('protected_token_corruption') ? ['Protected title or venue tokens were corrupted.'] : []),
      ...(hasConfirmedSplit ? ['Confirmed split contamination was detected and the citation likely needs cleanup.'] : []),
      ...(hasHardConflicts ? [`Verified external data conflicted with extracted fields: ${citation.resolution?.conflictFields.join(', ')}.`] : []),
    ];
  } else if (noErrorLevelIssues && (readyByResolution || readyByLocalOnly || readyByCleanUnresolvedResolution || readyByDuplicateConfidence)) {
    bucket = 'ready';
    bucketReasons = [
      ...(doiVerified(citation) ? ['Verified by DOI against Crossref.'] : []),
      ...(!doiVerified(citation) && exactExternalTitleMatch(citation) ? ['Verified by exact external title match.'] : []),
      ...(!doiVerified(citation) && !exactExternalTitleMatch(citation) && localReadyWithoutCoverage(citation, overall, fieldScores)
        ? ['High-confidence local parse with no exact provider coverage.']
        : []),
      ...(!readyByResolution && readyByLocalOnly ? ['High-confidence local parse with no unresolved validation errors.'] : []),
      ...(!readyByResolution && !readyByLocalOnly && readyByCleanUnresolvedResolution
        ? ['High-confidence local parse remained ready despite unresolved authority verification.']
        : []),
      ...(!readyByResolution && !readyByLocalOnly && !readyByCleanUnresolvedResolution && readyByDuplicateConfidence
        ? ['High-confidence parse stayed ready even though the citation belongs to a duplicate family.']
        : []),
      ...(flags.includes('verified_missing_venue') ? ['Identity was verified even though no venue field was recovered.'] : []),
    ];
  } else if (reviewNeeded) {
    bucket = 'worth_reviewing';
    bucketReasons = [
      ...(duplicateChangedFields.length > 0 ? [`Duplicate merge changed: ${duplicateChangedFields.join(', ')}.`] : []),
      ...(hasAmbiguousMatch ? ['External resolution returned multiple equally strong candidates.'] : []),
      ...(hasResolutionMiss ? ['No exact external title match was accepted.'] : []),
      ...(hasProviderError ? ['External resolution encountered a provider error.'] : []),
      ...(hasProviderNoCoverage ? ['Providers may not cover this citation type well enough for verification.'] : []),
      ...(overall >= 0.75 && overall < 0.9 ? ['Local quality is below the ready threshold.'] : []),
    ];
  } else {
    bucket = overall >= 0.9 ? 'ready' : overall >= 0.75 ? 'worth_reviewing' : 'action_needed';
    bucketReasons = bucket === 'ready'
      ? ['Citation passed local structural checks.']
      : bucket === 'worth_reviewing'
        ? ['Citation remains structurally plausible but below the ready threshold.']
        : ['Citation failed quality thresholds and needs correction.'];
  }

  bucketReasons = [...new Set(bucketReasons.filter(Boolean))];

  return {
    overall,
    grade: grade(overall),
    fieldScores,
    flags: [...new Set(flags)],
    missingRequired,
    missingOptional,
    bucket,
    bucketReasons,
  };
}

function fallbackQuality(citation: CanonicalCitation, message: string, timedOut: boolean): CitationQualityScore {
  const fieldScores = buildFieldScores(citation);
  return {
    overall: 0.45,
    grade: 'F',
    fieldScores,
    flags: ['review', timedOut ? 'score_timeout' : 'score_error'],
    missingRequired: getMissingRequiredFields(citation),
    missingOptional: [],
    bucket: 'action_needed',
    bucketReasons: [
      timedOut
        ? 'Quality scoring timed out, so this citation needs a manual check before it can be treated as ready.'
        : 'Quality scoring failed for this citation, so it needs a manual check before it can be treated as ready.',
      message,
    ],
  };
}

export function createScoreStage(): V2Stage {
  return {
    id: 'score',
    async run(context) {
      const startedAt = Date.now();
      const isolation = await runStageTasksSequentiallyWithIsolation({
        stageId: 'score',
        items: context.citations,
        run: (citation) => addCitationStageLog(
          {
            ...citation,
            quality: scoreCitation(citation),
          },
          createStageDiagnostic('score', 'success', 'Calculated quality score for citation.'),
        ),
        recover: ({ item: citation, message, timedOut }) => addCitationStageLog(
          {
            ...citation,
            quality: fallbackQuality(citation, message, timedOut),
          },
          createStageDiagnostic(
            'score',
            'warning',
            timedOut
              ? 'Quality scoring timed out for this citation; marking it for manual review.'
              : 'Quality scoring failed for this citation; marking it for manual review.',
            { timedOut, message },
          ),
        ),
      });
      const citations = isolation.outcomes.map((outcome) => outcome.result);
      const recoveredFallbacks = isolation.outcomes
        .filter((outcome) => outcome.recovered)
        .map((outcome) => outcome.timedOut ? 'score:item-timeout' : 'score:item-error');

      return {
        ...context,
        citations,
        fallbacksUsed: [...context.fallbacksUsed, ...recoveredFallbacks],
        partialResult: context.partialResult || isolation.recoveredCount > 0,
        partialReasons: [...new Set([
          ...context.partialReasons,
          ...recoveredFallbacks,
        ])],
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'score',
            'success',
            `Calculated quality scores for ${citations.length} citation(s).`,
            { citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
