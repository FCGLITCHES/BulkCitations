import type { CanonicalCitation, CitationQualityScore } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { runStageTasksSequentiallyWithIsolation } from '../stageIsolation.js';
import { addCitationStageLog, average, createStageDiagnostic } from '../utils.js';
import { getMissingExpectedFields, getMissingRequiredFields, getRequirementProfile } from '../qualityRules.js';
import {
  analyzeReadyBlockers,
  deriveResolutionBucketState,
  READY_CONFIDENCE_FLOOR,
  REVIEW_CONFIDENCE_FLOOR,
  type ReadyBlockerCode,
} from '../readyBlockers.js';

function grade(overall: number): 'A' | 'B' | 'C' | 'F' {
  if (overall >= 0.9) return 'A';
  if (overall >= 0.8) return 'B';
  if (overall >= REVIEW_CONFIDENCE_FLOOR) return 'C';
  return 'F';
}

function isVerifiedResolution(citation: CanonicalCitation): boolean {
  return citation.resolution?.status === 'verified' || citation.resolution?.status === 'verified_with_year_tolerance';
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

function getVenueScore(citation: CanonicalCitation, fieldScores: Record<string, number>): number {
  switch (citation.referenceType) {
    case 'conference':
      return Math.max(fieldScores.conferenceTitle, fieldScores.bookTitle, fieldScores.journal, fieldScores.publisher);
    case 'chapter':
      return Math.max(fieldScores.bookTitle, fieldScores.publisher);
    case 'thesis':
      return Math.max(fieldScores.institution, fieldScores.publisher);
    case 'report':
      return Math.max(fieldScores.institution, fieldScores.publisher, fieldScores.journal);
    case 'website':
      return Math.max(fieldScores.publisher, fieldScores.journal, fieldScores.url);
    case 'book':
      return Math.max(fieldScores.publisher, fieldScores.bookTitle);
    default:
      return Math.max(fieldScores.journal, fieldScores.publisher, fieldScores.bookTitle);
  }
}

function canIgnoreMissingVerifiedVenue(citation: CanonicalCitation): boolean {
  return isVerifiedResolution(citation)
    && Boolean(citation.resolution?.acceptedCandidate?.title)
    && citation.title.confidence >= 0.75
    && citation.year.confidence >= 0.75;
}

function effectiveMissingRequiredFields(citation: CanonicalCitation, missingRequired: string[]): string[] {
  if (!canIgnoreMissingVerifiedVenue(citation)) return missingRequired;
  return missingRequired.filter((field) => field !== 'venue');
}

function effectiveRequiredFields(citation: CanonicalCitation): string[] {
  const profile = getRequirementProfile(citation.referenceType);
  if (!canIgnoreMissingVerifiedVenue(citation)) return profile.required;
  return profile.required.filter((field) => field !== 'venue');
}

function scoreForRequiredField(
  citation: CanonicalCitation,
  fieldScores: Record<string, number>,
  field: string,
): number {
  switch (field) {
    case 'authors':
      return citation.authors.value.length > 0 ? fieldScores.authors : 0;
    case 'title':
      return citation.title.value ? fieldScores.title : 0;
    case 'year':
      return citation.year.value != null ? fieldScores.year : 0;
    case 'venue':
      return getVenueScore(citation, fieldScores);
    case 'publisher':
      return citation.publisher.value ? fieldScores.publisher : 0;
    case 'institution':
      return citation.institution.value ? Math.max(fieldScores.institution, fieldScores.publisher) : 0;
    case 'bookTitle':
      return citation.bookTitle.value ? Math.max(fieldScores.bookTitle, fieldScores.publisher) : 0;
    case 'url':
      return citation.url.value ? fieldScores.url : 0;
    default:
      return 0;
  }
}

function computeOverall(
  citation: CanonicalCitation,
  fieldScores: Record<string, number>,
  requiredFields: string[],
): number {
  const requiredScores = requiredFields.map((field) => scoreForRequiredField(citation, fieldScores, field));
  const requiredAverage = requiredScores.length > 0 ? average(requiredScores) : 0;
  const requiredCompleteness = requiredFields.length === 0
    ? 1
    : requiredScores.filter((score) => score > 0).length / requiredFields.length;

  const expectedValues = [
    citation.volume.value ? fieldScores.volume : 0,
    citation.issue.value ? fieldScores.issue : 0,
    citation.pages.value ? fieldScores.pages : 0,
    citation.doi.value ? fieldScores.doi : 0,
    citation.url.value ? fieldScores.url : 0,
    citation.publisher.value && ['conference', 'chapter', 'report', 'book', 'thesis'].includes(citation.referenceType)
      ? fieldScores.publisher
      : 0,
  ];
  const expectedAverage = expectedValues.length > 0 ? average(expectedValues) : 0;
  const expectedCompleteness = expectedValues.length === 0
    ? 1
    : expectedValues.filter((score) => score > 0).length / expectedValues.length;

  let overall = (requiredAverage * 0.72)
    + (requiredCompleteness * 0.18)
    + (expectedAverage * 0.05)
    + (expectedCompleteness * 0.05);

  if (citation.extraction?.method === 'llm') overall = Math.max(0, overall - 0.03);
  if (citation.extraction?.method === 'hybrid') overall = Math.max(0, overall - 0.02);
  if (citation.extraction?.fallbackUsed) overall = Math.max(0, overall - 0.02);
  if (isVerifiedResolution(citation)) overall = Math.min(1, overall + 0.03);

  return Number(Math.max(0, Math.min(1, overall)).toFixed(2));
}

function bucketReasons(
  readyBlockers: ReadyBlockerCode[],
  hardUnresolved: boolean,
  softUnresolvedAfterEscalation: boolean,
  repairFailed: boolean,
  missingRequired: string[],
  overall: number,
): string[] {
  const reasons: string[] = [];
  if (readyBlockers.length > 0) {
    reasons.push(`Ready blockers: ${readyBlockers.join(', ')}.`);
  }
  if (missingRequired.length > 0) {
    reasons.push(`Missing required fields: ${missingRequired.join(', ')}.`);
  }
  if (hardUnresolved) {
    reasons.push('Authority evidence contradicted the original identity fields.');
  }
  if (softUnresolvedAfterEscalation) {
    reasons.push('Blocker-driven authority escalation found no accepted match.');
  }
  if (repairFailed) {
    reasons.push('Blocker-driven rescue could not produce a usable repaired citation.');
  }
  if (overall < REVIEW_CONFIDENCE_FLOOR) {
    reasons.push('Parse confidence and completeness remained below the review floor.');
  } else if (overall < READY_CONFIDENCE_FLOOR) {
    reasons.push('Parse confidence and completeness remained below the ready floor.');
  }
  if (reasons.length === 0) {
    reasons.push('Citation passed readiness gates.');
  }
  return [...new Set(reasons)];
}

function buildFlags(
  citation: CanonicalCitation,
  readyBlockers: ReadyBlockerCode[],
  hardUnresolved: boolean,
  softUnresolvedAfterEscalation: boolean,
): string[] {
  const flags: string[] = [];
  if (citation.status === 'duplicate') flags.push('duplicate');
  if (citation.extraction?.fallbackUsed) flags.push('fallback_extracted');
  if (citation.extraction?.method === 'llm') flags.push('llm_extracted');
  if (citation.extraction?.method === 'hybrid') flags.push('hybrid_extracted');
  if (isVerifiedResolution(citation)) flags.push('authority_verified');
  if (citation.resolution?.escalatedForBlockers) flags.push('escalated_for_blockers');
  if (citation.resolution?.repairFailed) flags.push('repair_failed');
  if (hardUnresolved) flags.push('hard_unresolved');
  if (softUnresolvedAfterEscalation) flags.push('soft_unresolved_after_escalation');
  flags.push(...readyBlockers);
  return [...new Set(flags)];
}

function scoreCitation(citation: CanonicalCitation): CitationQualityScore {
  const fieldScores = buildFieldScores(citation);
  const rawMissingRequired = getMissingRequiredFields(citation);
  const missingRequired = effectiveMissingRequiredFields(citation, rawMissingRequired);
  const missingOptional = getMissingExpectedFields(citation);
  const requiredFields = effectiveRequiredFields(citation);
  const overall = computeOverall(citation, fieldScores, requiredFields);
  const blockerAnalysis = analyzeReadyBlockers(citation);
  const readyBlockers = blockerAnalysis.codes;
  const hardBlockers = blockerAnalysis.hardCodes;
  const softBlockers = blockerAnalysis.softCodes;
  const { hardUnresolved, softUnresolvedAfterEscalation } = deriveResolutionBucketState(citation);
  const repairFailed = citation.resolution?.repairFailed === true;
  const hasRequiredFields = missingRequired.length === 0;

  let bucket: CitationQualityScore['bucket'];
  if (
    hardBlockers.length > 0
    || softBlockers.length >= 2
    || hardUnresolved
    || repairFailed
    || overall < REVIEW_CONFIDENCE_FLOOR
  ) {
    bucket = 'action_needed';
  } else if (
    readyBlockers.length === 0
    && hasRequiredFields
    && overall >= READY_CONFIDENCE_FLOOR
    && !repairFailed
    && !hardUnresolved
    && !softUnresolvedAfterEscalation
  ) {
    bucket = 'ready';
  } else if (
    hardBlockers.length === 0
    && (
      softBlockers.length === 1
      || softUnresolvedAfterEscalation
    )
    && overall >= REVIEW_CONFIDENCE_FLOOR
    && !repairFailed
  ) {
    bucket = 'worth_reviewing';
  } else {
    bucket = 'action_needed';
  }

  return {
    overall,
    grade: grade(overall),
    fieldScores,
    flags: buildFlags(citation, readyBlockers, hardUnresolved, softUnresolvedAfterEscalation),
    missingRequired,
    missingOptional,
    readyBlockers,
    bucket,
    bucketReasons: bucketReasons(
      readyBlockers,
      hardUnresolved,
      softUnresolvedAfterEscalation,
      repairFailed,
      missingRequired,
      overall,
    ),
  };
}

function fallbackQuality(citation: CanonicalCitation, message: string, timedOut: boolean): CitationQualityScore {
  const fieldScores = buildFieldScores(citation);
  return {
    overall: 0,
    grade: 'F',
    fieldScores,
    flags: [timedOut ? 'score_timeout' : 'score_error'],
    missingRequired: getMissingRequiredFields(citation),
    missingOptional: getMissingExpectedFields(citation),
    readyBlockers: [],
    bucket: 'action_needed',
    bucketReasons: [
      timedOut
        ? 'Quality scoring timed out, so this citation needs manual review.'
        : 'Quality scoring failed, so this citation needs manual review.',
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
          createStageDiagnostic('score', 'success', 'Calculated deterministic readiness score for citation.'),
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
