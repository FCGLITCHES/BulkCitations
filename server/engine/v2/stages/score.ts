import type { CanonicalCitation, CitationQualityScore } from '@shared/schema';
import { isGroupAuthor } from '../../shared/citationSemantics.js';
import { matchTitlesStrict } from '../resolution.js';
import type { V2Stage } from '../contracts.js';
import { addCitationStageLog, average, createStageDiagnostic } from '../utils.js';
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

const DUPLICATE_AUTO_READY_THRESHOLD = 0.85;

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

function hasConfirmedSplitContamination(validationCodes: Set<string>): boolean {
  return [...CONFIRMED_SPLIT_CODES].some((code) => validationCodes.has(code));
}

function hasAnySplitContamination(validationCodes: Set<string>): boolean {
  return [...SUSPECTED_SPLIT_CODES, ...CONFIRMED_SPLIT_CODES].some((code) => validationCodes.has(code));
}

function scoreCitation(citation: CanonicalCitation): CitationQualityScore {
  const fieldScores = buildFieldScores(citation);
  const missingRequired = getMissingRequiredFields(citation);
  const missingExpected = getMissingExpectedFields(citation);
  const requirementProfile = getRequirementProfile(citation.referenceType);
  const venueScore = getVenueScore(citation, fieldScores);
  const requiredScores: number[] = requirementProfile.required.map((field) => {
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

  let overall = average(requiredScores);

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

  overall = Math.max(0, overall - (structuralIssues.severe * 0.18) - (structuralIssues.review * 0.04));

  if (validationCodes.has('connector_as_author') || validationCodes.has('author_structure_unstable')) overall = Math.min(overall, 0.32);
  if (validationCodes.has('placeholder_volume') || validationCodes.has('placeholder_journal')) overall = Math.max(0, overall - 0.12);
  if (hasWeakProceedingsVenue) overall = Math.max(0, overall - 0.08);
  if (hasDroppedLocatorWarning) overall = Math.max(0, overall - 0.06);
  if (validationCodes.has('initials_as_surname')) overall = Math.max(0, overall - 0.08);
  if (validationCodes.has('protected_title_token_corrupted') || validationCodes.has('protected_venue_token_corrupted')) overall = Math.min(overall, 0.45);
  if (hasHardConflicts) overall = Math.min(overall, 0.52);
  if (hasInsufficientEvidence) overall = Math.min(overall, 0.45);
  if (hasAmbiguousMatch) overall = Math.min(overall, 0.84);
  if (hasResolutionMiss && !allowsLocalReadyOnResolutionMiss(citation)) overall = Math.min(overall, 0.89);
  if (hasProviderError) overall = Math.max(0, overall - 0.03);
  if (isVerifiedResolution(citation)) overall = Math.min(1, overall + 0.03);

  if (citation.extraction?.method === 'llm') overall *= 0.9;
  if (citation.extraction?.method === 'hybrid') overall *= 0.95;
  if (citation.extraction?.fallbackUsed) overall = Math.max(0, overall - 0.04);
  if (citation.enrichment?.retractedFlag) overall = Math.min(overall, 0.4);

  const missingOptional: string[] = [];
  for (const optionalField of ['doi', 'journal', 'volume', 'issue', 'pages', 'publisher', 'url'] as const) {
    if (!citation[optionalField].value) {
      missingOptional.push(optionalField);
    }
  }

  const flags: string[] = [];
  if (citation.status === 'duplicate') flags.push('duplicate');
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

  if (flags.includes('malformed_authors')) {
    overall = Math.min(overall, 0.45);
  }
  if (missingRequired.length > 0) {
    overall = Math.min(overall, 0.59);
  }
  if (missingExpected.length > 0 && missingRequired.length === 0) {
    overall = Math.max(0, overall - Math.min(0.08, missingExpected.length * 0.02));
  }
  if (hasConfirmedSplit) {
    overall = Math.min(overall, 0.49);
  }

  overall = Number(overall.toFixed(2));

  const errorIssues = citation.validationIssues.filter((issue) => issue.severity === 'error');
  const noErrorLevelIssues = errorIssues.length === 0;
  const readyByResolution = doiVerified(citation) || exactExternalTitleMatch(citation) || localReadyWithoutCoverage(citation, overall, fieldScores);
  const readyByLocalOnly = localReadyWithoutResolution(citation, overall, fieldScores);
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

  const reviewNeeded = (citation.status === 'duplicate' && !readyByDuplicateConfidence)
    || hasAmbiguousMatch
    || hasResolutionMiss
    || hasProviderError
    || hasProviderNoCoverage
    || missingExpected.length > 0
    || (overall >= 0.75 && overall < 0.9)
    || citation.validationIssues.some((issue) => issue.severity === 'warning');

  let bucket: CitationQualityScore['bucket'] = 'worth_reviewing';
  let bucketReasons: string[] = [];

  if (actionNeeded) {
    bucket = 'action_needed';
    bucketReasons = [
      ...(hasInsufficientEvidence ? ['Not enough parse evidence was available for strict external resolution.'] : []),
      ...(flags.includes('malformed_authors') ? ['Author parsing remains malformed.'] : []),
      ...(missingRequired.length > 0 ? [`Missing required fields: ${missingRequired.join(', ')}.`] : []),
      ...(flags.includes('protected_token_corruption') ? ['Protected title or venue tokens were corrupted.'] : []),
      ...(hasConfirmedSplit ? ['Confirmed split contamination suggests the citation contains more than one reference or a truncated fragment.'] : []),
      ...(hasHardConflicts ? [`Verified external data conflicted with extracted fields: ${citation.resolution?.conflictFields.join(', ')}.`] : []),
    ];
  } else if (noErrorLevelIssues && (readyByResolution || readyByLocalOnly || readyByDuplicateConfidence)) {
    bucket = 'ready';
    bucketReasons = [
      ...(doiVerified(citation) ? ['Verified by DOI against Crossref.'] : []),
      ...(!doiVerified(citation) && exactExternalTitleMatch(citation) ? ['Verified by exact external title match.'] : []),
      ...(!doiVerified(citation) && !exactExternalTitleMatch(citation) && localReadyWithoutCoverage(citation, overall, fieldScores)
        ? ['High-confidence local parse with no exact provider coverage.']
        : []),
      ...(!readyByResolution && readyByLocalOnly ? ['High-confidence local parse with no unresolved validation errors.'] : []),
      ...(!readyByResolution && !readyByLocalOnly && readyByDuplicateConfidence
        ? ['High-confidence parse stayed ready even though the citation belongs to a duplicate family.']
        : []),
    ];
  } else if (reviewNeeded) {
    bucket = 'worth_reviewing';
    bucketReasons = [
      ...(citation.status === 'duplicate' ? ['Citation is part of a duplicate family.'] : []),
      ...(hasAmbiguousMatch ? ['External resolution returned multiple equally strong candidates.'] : []),
      ...(hasResolutionMiss ? ['No exact external title match was accepted.'] : []),
      ...(hasProviderError ? ['External resolution encountered a provider error.'] : []),
      ...(hasProviderNoCoverage ? ['Providers may not cover this citation type well enough for verification.'] : []),
      ...(missingExpected.length > 0 ? [`Expected fields are still missing: ${missingExpected.join(', ')}.`] : []),
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

export function createScoreStage(): V2Stage {
  return {
    id: 'score',
    async run(context) {
      const startedAt = Date.now();
      const citations = context.citations.map((citation) => addCitationStageLog(
        {
          ...citation,
          quality: scoreCitation(citation),
        },
        createStageDiagnostic('score', 'success', 'Calculated quality score for citation.'),
      ));

      return {
        ...context,
        citations,
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
