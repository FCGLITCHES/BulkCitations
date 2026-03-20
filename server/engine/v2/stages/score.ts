import type { CanonicalCitation, CitationQualityScore } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { addCitationStageLog, average, createStageDiagnostic } from '../utils.js';

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
    url: citation.url.confidence,
  };

  let overall = average([
    fieldScores.authors,
    fieldScores.title,
    fieldScores.year,
    Math.max(fieldScores.journal, fieldScores.publisher),
    Math.max(fieldScores.doi, fieldScores.url),
  ]);

  const errorCount = citation.validationIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = citation.validationIssues.filter((issue) => issue.severity === 'warning').length;
  overall = Math.max(0, overall - (errorCount * 0.15) - (warningCount * 0.05));

  const validationCodes = new Set(citation.validationIssues.map((issue) => issue.code));
  if (validationCodes.has('connector_as_author')) overall = Math.min(overall, 0.35);
  if (validationCodes.has('placeholder_volume') || validationCodes.has('placeholder_journal')) {
    overall = Math.max(0, overall - 0.15);
  }
  if (validationCodes.has('venue_missing_for_conference') || validationCodes.has('weak_proceedings_venue')) {
    overall = Math.max(0, overall - 0.08);
  }

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
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  if (citation.authors.value.length === 0) missingRequired.push('authors');
  if (!citation.title.value) missingRequired.push('title');
  if (citation.year.value == null) missingRequired.push('year');

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
  if (validationCodes.has('connector_as_author') || validationCodes.has('alternating_surname_given_tokens')) flags.push('malformed_authors');
  if (warningCount > 0 || errorCount > 0) flags.push('review');
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
