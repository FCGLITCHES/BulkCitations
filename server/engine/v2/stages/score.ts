import type { CanonicalCitation, CitationQualityScore } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { runStageTasksSequentiallyWithIsolation } from '../stageIsolation.js';
import { addCitationStageLog, average, createStageDiagnostic } from '../utils.js';
import {
  collectScoreObservationCodes,
  evaluateScoreField,
  getMissingExpectedFields,
  getMissingRequiredFields,
  getRequirementProfile,
  getScoreProfile,
  observationPenaltyForCodes,
} from '../qualityRules.js';
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
    year: citation.year.confidence,
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
    placeOfPublication: citation.placeOfPublication.confidence,
    repository: citation.repository.confidence,
    thesisType: citation.thesisType.confidence,
    editor: citation.editor.confidence,
  };
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

function computeOverall(
  citation: CanonicalCitation,
  requiredFields: string[],
): { overall: number; observationCodes: string[]; acceptableRequiredCount: number; presentExpectedCount: number } {
  const profileSelection = getScoreProfile(citation.referenceType);
  const profile = profileSelection.profile;
  const requiredEvaluations = requiredFields.map((field) => evaluateScoreField(citation, field, profile));
  const requiredScores = requiredEvaluations.map((evaluation) => evaluation.scoreCredit);
  const requiredAverage = requiredScores.length > 0 ? average(requiredScores) : 0;
  const requiredCompleteness = requiredFields.length === 0
    ? 1
    : requiredEvaluations.reduce((sum, evaluation) => sum + evaluation.completenessCredit, 0) / requiredFields.length;

  const expectedFields = Object.keys(profile.expectedFieldWeights);
  const expectedEvaluations = expectedFields.map((field) => ({
    evaluation: evaluateScoreField(citation, field, profile),
    weight: profile.expectedFieldWeights[field] ?? 0,
  }));
  const totalExpectedWeight = expectedEvaluations.reduce((sum, entry) => sum + entry.weight, 0);
  const expectedAverage = totalExpectedWeight <= 0
    ? 1
    : Number((
      expectedEvaluations.reduce((sum, entry) => sum + (entry.evaluation.scoreCredit * entry.weight), 0) / totalExpectedWeight
    ).toFixed(4));
  const expectedCompleteness = totalExpectedWeight <= 0
    ? 1
    : Number((
      expectedEvaluations.reduce((sum, entry) => sum + (entry.evaluation.completenessCredit * entry.weight), 0) / totalExpectedWeight
    ).toFixed(4));
  const observationCodes = collectScoreObservationCodes(citation, profileSelection);
  const observationPenalty = observationPenaltyForCodes(observationCodes);

  let overall = (requiredAverage * profile.weights.requiredAverage)
    + (requiredCompleteness * profile.weights.requiredCompleteness)
    + (expectedAverage * profile.weights.expectedAverage)
    + (expectedCompleteness * profile.weights.expectedCompleteness)
    - observationPenalty;

  if (isVerifiedResolution(citation)) overall = Math.min(1, overall + 0.03);
  if (citation.resolution?.repairFailed) {
    overall -= 0.08;
  } else if (
    citation.resolution?.escalatedForBlockers
    && !citation.resolution?.acceptedCandidate
  ) {
    overall -= 0.04;
  } else if (
    citation.extraction?.llmFallbackAttempted
    && !citation.extraction?.llmFallbackAccepted
    && !citation.extraction?.llmFallbackSkippedByBudget
    && !citation.extraction?.llmFallbackSkippedForTruth
    && !citation.extraction?.llmFallbackReusedFromCluster
  ) {
    // Accepted rescue has no extra penalty. That does not guarantee the post-repair
    // score stays above the pre-repair score; cleaner repaired fields can still
    // score lower under the normal field-based formula.
    overall -= 0.03;
  }

  return {
    overall: Number(Math.max(0, Math.min(1, overall)).toFixed(2)),
    observationCodes,
    acceptableRequiredCount: requiredEvaluations.filter((evaluation) => evaluation.state === 'acceptable').length,
    presentExpectedCount: expectedEvaluations.filter((entry) => entry.evaluation.state !== 'missing').length,
  };
}

function bucketReasons(
  readyBlockers: ReadyBlockerCode[],
  observationCodes: string[],
  hardUnresolved: boolean,
  softUnresolvedAfterEscalation: boolean,
  repairFailed: boolean,
  missingRequired: string[],
  acceptableRequiredShortfall: boolean,
  expectedPresenceShortfall: boolean,
  overall: number,
): string[] {
  const reasons: string[] = [];
  if (readyBlockers.length > 0) {
    reasons.push(`Ready blockers: ${readyBlockers.join(', ')}.`);
  }
  if (missingRequired.length > 0) {
    reasons.push(`Missing required fields: ${missingRequired.join(', ')}.`);
  }
  if (acceptableRequiredShortfall) {
    reasons.push('Too many required fields remained weak to meet the ready threshold.');
  }
  if (expectedPresenceShortfall) {
    reasons.push('Expected support fields were too sparse to meet the ready threshold.');
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
  if (observationCodes.length > 0) {
    reasons.push(`Non-blocking observations reduced confidence: ${observationCodes.join(', ')}.`);
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

export function scoreCitation(citation: CanonicalCitation): CitationQualityScore {
  const fieldScores = buildFieldScores(citation);
  const rawMissingRequired = getMissingRequiredFields(citation);
  const missingRequired = effectiveMissingRequiredFields(citation, rawMissingRequired);
  const missingOptional = getMissingExpectedFields(citation);
  const requiredFields = effectiveRequiredFields(citation);
  const profileSelection = getScoreProfile(citation.referenceType);
  const {
    overall,
    observationCodes,
    acceptableRequiredCount,
    presentExpectedCount: rawPresentExpectedCount,
  } = computeOverall(citation, requiredFields);
  const blockerAnalysis = analyzeReadyBlockers(citation);
  const readyBlockers = blockerAnalysis.codes;
  const hardBlockers = blockerAnalysis.hardCodes;
  const softBlockers = blockerAnalysis.softCodes;
  const { hardUnresolved, softUnresolvedAfterEscalation } = deriveResolutionBucketState(citation);
  const repairFailed = citation.resolution?.repairFailed === true;
  const hasRequiredFields = missingRequired.length === 0;
  const publisherSupportSurrogatePresent = profileSelection.profileKey === 'book'
    && evaluateScoreField(citation, 'publisher', profileSelection.profile).state !== 'missing';
  const presentExpectedCount = publisherSupportSurrogatePresent
    ? Math.max(rawPresentExpectedCount, 1)
    : rawPresentExpectedCount;
  const acceptableRequiredShortfall = acceptableRequiredCount < profileSelection.profile.readyAcceptableRequiredMinimum;
  const expectedPresenceShortfall = presentExpectedCount < profileSelection.profile.readyExpectedFieldMinimum;

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
    && !acceptableRequiredShortfall
    && !expectedPresenceShortfall
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
    observationCodes,
    bucket,
    bucketReasons: bucketReasons(
      readyBlockers,
      observationCodes,
      hardUnresolved,
      softUnresolvedAfterEscalation,
      repairFailed,
      missingRequired,
      acceptableRequiredShortfall,
      expectedPresenceShortfall,
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
    observationCodes: [],
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
