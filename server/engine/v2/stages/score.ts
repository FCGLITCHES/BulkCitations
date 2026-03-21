import type { CanonicalCitation, CitationQualityScore } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { addCitationStageLog, average, createStageDiagnostic } from '../utils.js';
import {
  countStructuralValidationIssues,
  getMissingExpectedFields,
  getMissingRequiredFields,
} from '../qualityRules.js';

function grade(overall: number): 'A' | 'B' | 'C' | 'F' {
  if (overall >= 0.9) return 'A';
  if (overall >= 0.75) return 'B';
  if (overall >= 0.6) return 'C';
  return 'F';
}

function scoreCitation(citation: CanonicalCitation): CitationQualityScore {
  const fieldScores = {
    authors: citation.authors.confidence,
    title: citation.title.confidence,
    year: citation.year.value != null ? Math.max(citation.year.confidence, 0.85) : citation.year.confidence,
    journal: citation.journal.confidence,
    volume: citation.volume.confidence,
    issue: citation.issue.confidence,
    pages: citation.pages.confidence,
    doi: citation.doi.confidence,
    publisher: citation.publisher.confidence,
    institution: citation.institution.confidence,
    url: citation.url.confidence,
  };

  const requiredScores: number[] = [];
  const missingRequired = getMissingRequiredFields(citation);
  const missingExpected = getMissingExpectedFields(citation);

  requiredScores.push(fieldScores.authors, fieldScores.title, fieldScores.year);
  if (citation.referenceType === 'book') requiredScores.push(fieldScores.publisher);
  else if (citation.referenceType === 'thesis') requiredScores.push(Math.max(fieldScores.publisher, fieldScores.institution));
  else requiredScores.push(Math.max(fieldScores.journal, fieldScores.publisher));

  let overall = average(requiredScores);

  const expectedBonuses: number[] = [];
  if (citation.volume.value) expectedBonuses.push(fieldScores.volume);
  if (citation.issue.value) expectedBonuses.push(fieldScores.issue);
  if (citation.pages.value) expectedBonuses.push(fieldScores.pages);
  if (citation.publisher.value && ['conference', 'bookChapter', 'report', 'book'].includes(citation.referenceType)) {
    expectedBonuses.push(fieldScores.publisher);
  }
  if (expectedBonuses.length > 0) {
    overall = Math.min(1, overall + (average(expectedBonuses) * 0.08));
  }

  const validationCodes = new Set(citation.validationIssues.map((issue) => issue.code));
  const hasVenueMissingForConference = citation.validationIssues.some((issue) => issue.code === 'venue_missing_for_conference' && issue.severity !== 'info');
  const hasWeakProceedingsVenue = citation.validationIssues.some((issue) => issue.code === 'weak_proceedings_venue' && issue.severity !== 'info');
  const hasDroppedLocatorWarning = citation.validationIssues.some((issue) => issue.code === 'locator_missing_from_source' && issue.severity !== 'info');
  const structuralIssues = countStructuralValidationIssues(citation);
  const splitContaminationSuspectedCodes = [
    'header_bleed_suspected',
    'doi_orphan_suspected',
    'multiline_truncation_suspected',
    'page_artifact_suspected',
    'oversized_chunk_suspected',
  ];
  const splitContaminationConfirmedCodes = [
    'header_bleed_confirmed',
    'doi_orphan_confirmed',
    'multiline_truncation_confirmed',
    'page_artifact_confirmed',
    'oversized_chunk_confirmed',
  ];
  const hasSplitContaminationSuspected = [
    ...splitContaminationSuspectedCodes,
    ...splitContaminationConfirmedCodes,
  ].some((code) => validationCodes.has(code));
  const hasSplitContaminationConfirmed = splitContaminationConfirmedCodes.some((code) => validationCodes.has(code));
  overall = Math.max(0, overall - (structuralIssues.severe * 0.18) - (structuralIssues.review * 0.04));

  if (validationCodes.has('connector_as_author') || validationCodes.has('author_structure_unstable')) overall = Math.min(overall, 0.32);
  if (validationCodes.has('placeholder_volume') || validationCodes.has('placeholder_journal')) overall = Math.max(0, overall - 0.12);
  if (hasVenueMissingForConference || hasWeakProceedingsVenue) overall = Math.max(0, overall - 0.08);
  if (hasDroppedLocatorWarning) overall = Math.max(0, overall - 0.06);
  if (validationCodes.has('authority_mismatch')) overall = Math.max(0, overall - 0.02);
  if (validationCodes.has('initials_as_surname')) overall = Math.max(0, overall - 0.08);

  if (citation.extraction?.method === 'llm') overall *= 0.9;
  if (citation.extraction?.method === 'hybrid') overall *= 0.95;
  if (citation.extraction?.fallbackUsed) overall = Math.max(0, overall - 0.04);

  if (citation.validation?.verificationAttempted && citation.validation.mismatchFields.length === 0) {
    overall = Math.min(1, overall + 0.15);
  }

  if (citation.enrichment?.confidencePenalty) {
    overall = Math.max(0, overall + citation.enrichment.confidencePenalty);
  }

  const flags: string[] = [];
  const missingOptional: string[] = [];

  for (const optionalField of ['doi', 'journal', 'volume', 'issue', 'pages', 'publisher', 'url'] as const) {
    if (!citation[optionalField].value) {
      missingOptional.push(optionalField);
    }
  }

  if (!citation.doi.value) flags.push('missing_doi');
  if (citation.status === 'duplicate') flags.push('duplicate');
  if (citation.extraction?.fallbackUsed) flags.push('llm_extracted');
  if (citation.validation?.verificationAttempted && citation.validation.mismatchFields.length > 0) flags.push('unverified');
  if (citation.title.confidence < 0.5) flags.push('low_confidence_title');
  if (citation.authors.value.some((author) => Boolean(author.literal))) flags.push('author_parse_failed');
  if (validationCodes.has('placeholder_volume') || validationCodes.has('placeholder_journal')) flags.push('placeholder_fields');
  if (validationCodes.has('connector_as_author') || validationCodes.has('author_structure_unstable') || validationCodes.has('initials_as_surname')) flags.push('malformed_authors');
  if (structuralIssues.severe > 0 || structuralIssues.review > 0) flags.push('review');
  if (validationCodes.has('authority_rate_limited')) flags.push('authority_rate_limited');
  if (validationCodes.has('authority_not_found')) flags.push('authority_not_found');
  if (hasSplitContaminationSuspected) flags.push('split_contamination_suspected');
  if (hasSplitContaminationConfirmed) flags.push('split_contamination_confirmed');
  if (citation.enrichment?.retractedFlag) {
    flags.push('retracted');
    overall = Math.min(overall, 0.4);
  }

  if (flags.includes('malformed_authors')) {
    overall = Math.min(overall, 0.45);
  }
  if (missingRequired.length > 0) {
    overall = Math.min(overall, 0.59);
  }
  if (missingExpected.length > 0 && missingRequired.length === 0) {
    overall = Math.max(0, overall - Math.min(0.08, missingExpected.length * 0.02));
  }
  if (hasSplitContaminationSuspected || hasSplitContaminationConfirmed) {
    overall = Math.min(overall, 0.74);
  }

  overall = Number(overall.toFixed(2));

  return {
    overall,
    grade: grade(overall),
    fieldScores,
    flags,
    missingRequired,
    missingOptional,
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
