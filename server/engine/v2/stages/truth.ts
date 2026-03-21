import type { CanonicalCitation } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { applyTruthToCanonicalCitation, resolveTruthForCanonicalCitation } from '../../shared/truthResolver.js';
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

      const citations: CanonicalCitation[] = [];
      for (const citation of context.citations) {
        const match = await resolveTruthForCanonicalCitation(citation, context.request.outputStyle);
        if (!match) {
          citations.push(addCitationStageLog(
            citation,
            createStageDiagnostic('truth', 'success', 'No approved truth matched this citation.'),
          ));
          continue;
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

        citations.push(addCitationStageLog(
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
        ));
      }

      return {
        ...context,
        citations,
        jobDebug: context.debugEnabled
          ? {
              ...context.jobDebug,
              truth: {
                citationCount: citations.length,
                appliedCount,
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
