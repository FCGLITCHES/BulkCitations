import type { CanonicalCitation } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { applyTruthToCanonicalCitation, resolveTruthForCanonicalCitation } from '../../shared/truthResolver.js';
import {
  getStageIsolationConcurrency,
  getStageIsolationTimeoutMs,
  getStageRuntimeTimeoutMs,
  runStageTasksWithIsolation,
} from '../stageIsolation.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createStageDiagnostic,
} from '../utils.js';

export function createTruthStage(): V2Stage {
  return {
    id: 'truth',
    async run(context) {
      const startedAt = Date.now();
      let appliedCount = 0;

      const isolation = await runStageTasksWithIsolation({
        stageId: 'truth',
        items: context.citations,
        concurrency: getStageIsolationConcurrency('truth'),
        timeoutMs: getStageIsolationTimeoutMs('truth', getStageRuntimeTimeoutMs('truth', context.stageConfig)),
        run: async (citation) => {
          const match = await resolveTruthForCanonicalCitation(citation, context.request.outputStyle);
          if (!match) {
            return addCitationStageLog(
              citation,
              createStageDiagnostic('truth', 'success', 'No approved truth matched this citation.'),
            );
          }

          appliedCount += 1;
          const nextCitation = attachCitationDebug(
            applyTruthToCanonicalCitation(citation, match.truth, match.matchType, context.request.outputStyle),
            'truth',
            {
              truthId: match.truth.truthId,
              truthMatchType: match.matchType,
              truthOutputStyle: match.truth.outputStyle,
              appliedFields: match.truth.truthId ? match.truth.fieldApproval ? Object.entries(match.truth.fieldApproval)
                .filter(([, decision]) => decision?.approved)
                .map(([field]) => field) : [] : [],
              usedValidatedOutput: Boolean(match.truth.validatedOutput && match.truth.outputStyle === context.request.outputStyle),
            },
            context.debugEnabled,
          );

          return addCitationStageLog(
            nextCitation,
            createStageDiagnostic(
              'truth',
              'success',
              `Applied approved truth via ${match.matchType} match.`,
              {
                truthId: match.truth.truthId,
                matchType: match.matchType,
              },
            ),
          );
        },
        recover: ({ item: citation, message, timedOut }) => addCitationStageLog(
          attachCitationDebug(citation, 'truth', {
            isolationRecovered: true,
            timedOut,
            errorMessage: message,
          }, context.debugEnabled),
          createStageDiagnostic(
            'truth',
            'warning',
            timedOut
              ? 'Truth lookup timed out for this citation; continuing without applying saved truth.'
              : 'Truth lookup failed for this citation; continuing without applying saved truth.',
            { timedOut, message },
          ),
        ),
      });
      const citations = isolation.outcomes.map((outcome) => outcome.result);
      const recoveredFallbacks = isolation.outcomes
        .filter((outcome) => outcome.recovered)
        .map((outcome) => outcome.timedOut ? 'truth:item-timeout' : 'truth:item-error');

      return {
        ...context,
        citations,
        fallbacksUsed: [...context.fallbacksUsed, ...recoveredFallbacks],
        partialResult: context.partialResult || isolation.recoveredCount > 0,
        partialReasons: [...new Set([
          ...context.partialReasons,
          ...recoveredFallbacks,
        ])],
        jobDebug: context.debugEnabled
          ? {
              ...context.jobDebug,
              truth: {
                citationCount: citations.length,
                appliedCount,
                recoveredCount: isolation.recoveredCount,
                timeoutCount: isolation.timeoutCount,
              },
            }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'truth',
            'success',
            appliedCount > 0
              ? `Applied approved truth to ${appliedCount} citation(s).`
              : 'No approved truth matched this batch.',
            {
              citationCount: citations.length,
              appliedCount,
            },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
