import type { ClassifierAdapter, V2Stage } from '../contracts.js';
import { addCitationStageLog, attachCitationDebug, createFieldValue, createStageDiagnostic, logStructuredDebug } from '../utils.js';

export function createDetectStage(classifier: ClassifierAdapter): V2Stage {
  return {
    id: 'detect',
    async run(context) {
      const startedAt = Date.now();
      const citations = await Promise.all(context.citations.map(async (citation) => {
        if (context.request.inputStyle !== 'auto') {
          const nextCitation = attachCitationDebug({
            ...citation,
            detectedStyle: createFieldValue(context.request.inputStyle, 'user', 1, 'detect'),
          }, 'detect', {
            detectorId: classifier.id,
            style: context.request.inputStyle,
            confidence: 1,
          }, context.debugEnabled);
          return addCitationStageLog(
            nextCitation,
            createStageDiagnostic('detect', 'success', 'Using user-supplied input style.'),
          );
        }

        const result = await classifier.detectStyle(citation.raw);
        const nextCitation = attachCitationDebug({
          ...citation,
          detectedStyle: createFieldValue(result.style, 'extracted', result.confidence, 'detect'),
        }, 'detect', {
          detectorId: classifier.id,
          style: result.style,
          confidence: result.confidence,
        }, context.debugEnabled);
        logStructuredDebug(context, 'detect', context.citations.findIndex((item) => item.id === citation.id), nextCitation, {
          selectedBranch: undefined,
          selectionReason: undefined,
          authorParserMode: undefined,
          warningFlags: result.style ? [] : ['style_detection_failed'],
          detectorId: classifier.id,
          style: result.style,
          confidence: result.confidence,
        });
        return addCitationStageLog(
          nextCitation,
          createStageDiagnostic(
            'detect',
            result.style ? 'success' : 'warning',
            result.style ? `Detected citation style as ${result.style}.` : 'Could not confidently detect citation style.',
            result.style ? { style: result.style, confidence: result.confidence } : undefined,
          ),
        );
      }));

      return {
        ...context,
        citations,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            detect: {
              adapter: classifier.id,
              citationCount: citations.length,
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
