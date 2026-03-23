import type { ClassifierAdapter, V2Stage } from '../contracts.js';
import {
  runStageTasksSequentiallyWithIsolation,
} from '../stageIsolation.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createFieldValue,
  createStageDiagnostic,
  isVerboseDebugEnabled,
  logStructuredDebug,
} from '../utils.js';

function deriveDetectUncertainty(inputSignals: string[] | undefined) {
  const signals = new Set(inputSignals ?? []);
  const uncertaintyFlags = ['mixed_style_markers', 'ocr_noise_markers', 'long_prose_lines', 'footnote_markers']
    .filter((signal) => signals.has(signal));
  const penalty = uncertaintyFlags.reduce((sum, signal) => {
    switch (signal) {
      case 'mixed_style_markers':
      case 'ocr_noise_markers':
        return sum + 0.12;
      case 'long_prose_lines':
      case 'footnote_markers':
        return sum + 0.06;
      default:
        return sum;
    }
  }, 0);

  return {
    uncertaintyFlags,
    penalty,
  };
}

export function createDetectStage(classifier: ClassifierAdapter): V2Stage {
  return {
    id: 'detect',
    async run(context) {
      const startedAt = Date.now();
      const verboseDebug = isVerboseDebugEnabled();
      const isolation = await runStageTasksSequentiallyWithIsolation({
        stageId: 'detect',
        items: context.citations,
        run: async (citation, index) => {
          if (context.request.inputStyle !== 'auto') {
            const nextCitationBase = {
              ...citation,
              detectedStyle: createFieldValue(context.request.inputStyle, 'user', 1, 'detect'),
            };
            const nextCitation = context.debugEnabled && verboseDebug
              ? attachCitationDebug(nextCitationBase, 'detect', {
                detectorId: classifier.id,
                style: context.request.inputStyle,
                confidence: 1,
              }, true)
              : nextCitationBase;
            return addCitationStageLog(
              nextCitation,
              createStageDiagnostic('detect', 'success', 'Using user-supplied input style.'),
            );
          }

          const result = await classifier.detectStyle(citation.raw);
          const detectUncertainty = deriveDetectUncertainty(context.inputProfile?.signals);
          const effectiveConfidence = Math.max(0, Number((result.confidence - detectUncertainty.penalty).toFixed(3)));
          const lowConfidenceHint = effectiveConfidence < 0.55;
          const nextCitationBase = {
            ...citation,
            detectedStyle: createFieldValue(result.style, 'extracted', effectiveConfidence, 'detect'),
          };
          const nextCitation = context.debugEnabled
            ? attachCitationDebug(nextCitationBase, 'detect', {
              detectorId: classifier.id,
              style: result.style,
              classifierConfidence: result.confidence,
              effectiveConfidence,
              uncertaintyFlags: detectUncertainty.uncertaintyFlags,
              lowConfidenceHint,
              ...(verboseDebug ? { confidencePenalty: detectUncertainty.penalty } : {}),
            }, true)
            : nextCitationBase;
          logStructuredDebug(context, 'detect', index, nextCitation, {
            selectedBranch: undefined,
            selectionReason: undefined,
            authorParserMode: undefined,
            warningFlags: result.style
              ? (lowConfidenceHint ? ['style_detection_low_confidence'] : [])
              : ['style_detection_failed'],
            detectorId: classifier.id,
            style: result.style,
            confidence: effectiveConfidence,
          });
          return addCitationStageLog(
            nextCitation,
            createStageDiagnostic(
              'detect',
              result.style && !lowConfidenceHint ? 'success' : 'warning',
              result.style
                ? lowConfidenceHint
                  ? `Detected citation style as ${result.style}, but the style hint is low confidence.`
                  : `Detected citation style as ${result.style}.`
                : 'Could not confidently detect citation style.',
              result.style
                ? {
                  style: result.style,
                  classifierConfidence: result.confidence,
                  confidence: effectiveConfidence,
                  uncertaintyFlags: detectUncertainty.uncertaintyFlags,
                }
                : undefined,
            ),
          );
        },
        recover: ({ item: citation, message, timedOut }) => {
          const nextCitation = attachCitationDebug({
            ...citation,
            detectedStyle: context.request.inputStyle !== 'auto'
              ? createFieldValue(context.request.inputStyle, 'user', 1, 'detect')
              : createFieldValue(citation.detectedStyle.value ?? null, citation.detectedStyle.source, citation.detectedStyle.confidence, 'detect'),
          }, 'detect', {
            detectorId: classifier.id,
            isolationRecovered: true,
            timedOut,
            errorMessage: message,
          }, context.debugEnabled);
          return addCitationStageLog(
            nextCitation,
            createStageDiagnostic(
              'detect',
              'warning',
              timedOut
                ? 'Style detection timed out for this citation; continuing without a confident detected style.'
                : 'Style detection failed for this citation; continuing without a confident detected style.',
              { detectorId: classifier.id, timedOut, message },
            ),
          );
        },
      });
      const citations = isolation.outcomes.map((outcome) => outcome.result);
      const recoveredFallbacks = isolation.outcomes
        .filter((outcome) => outcome.recovered)
        .map((outcome) => outcome.timedOut ? 'detect:item-timeout' : 'detect:item-error');
      const fallbacksUsed = [...context.fallbacksUsed, ...recoveredFallbacks];
      const partialReasons = [...new Set([
        ...context.partialReasons,
        ...recoveredFallbacks,
      ])];

      return {
        ...context,
        citations,
        fallbacksUsed,
        partialResult: context.partialResult || isolation.recoveredCount > 0,
        partialReasons,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            detect: {
              adapter: classifier.id,
              citationCount: citations.length,
              recoveredCount: isolation.recoveredCount,
              timeoutCount: isolation.timeoutCount,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'detect',
            'success',
            `Completed style detection for ${citations.length} citation(s).`,
            { adapter: classifier.id, citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
