import { formatCSLData, initCSLStyles, parsedReferenceToCSL } from '../../cslConverter.js';
import { fixFormatting, runAssertions } from '../../strictRenderer.js';
import type { V2Stage } from '../contracts.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  canonicalReferenceTypeToParsed,
  canonicalToParsedReference,
  createStageDiagnostic,
  fixUnicodeText,
  logStructuredDebug,
} from '../utils.js';

let cslReady = false;

function ensureCsl(): void {
  if (!cslReady) {
    initCSLStyles();
    cslReady = true;
  }
}

function postCslCleanup(value: string): string {
  return value
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,.;:]){2,}/g, '$1')
    .replace(/\(\s*[,.;:]\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeCitation(value: string): string {
  const normalized = fixUnicodeText(value);
  if (!normalized) return normalized;
  return /[.?!]$/.test(normalized) ? normalized : `${normalized}.`;
}

function isRenderable(value: string): boolean {
  return value.trim().length >= 3 && /[A-Za-z0-9]/.test(value);
}

export function createRenderStage(): V2Stage {
  return {
    id: 'render',
    async run(context) {
      const startedAt = Date.now();
      ensureCsl();
      const fallbacksUsed = [...context.fallbacksUsed];
      let partialResult = context.partialResult;

      const citations = context.citations.map((citation, index) => {
        const parsed = canonicalToParsedReference(citation);
        const referenceType = canonicalReferenceTypeToParsed(citation.referenceType);
        const cslData = parsedReferenceToCSL(parsed, referenceType, citation.id || `v2-ref-${index + 1}`);
        const rawConvertedText = formatCSLData(cslData, context.request.outputStyle as any, { includeDoi: false });
        const formatted = fixFormatting(context.request.outputStyle, rawConvertedText, {
          ...parsed,
          type: referenceType,
        });
        const cleaned = postCslCleanup(formatted);
        const sanitized = sanitizeCitation(cleaned);
        const assertionResult = runAssertions(context.request.outputStyle, sanitized, {
          ...parsed,
          type: referenceType,
        });

        const renderable = isRenderable(sanitized);
        if (!renderable) {
          partialResult = true;
          fallbacksUsed.push('render:sanitize_fallback');
        }

        const nextCitation = attachCitationDebug({
          ...citation,
          rendered: {
            outputStyle: context.request.outputStyle,
            formatted: renderable ? sanitized : sanitizeCitation(citation.raw),
            warnings: [
              ...assertionResult.warnings,
              ...(renderable ? [] : ['warning:render_output_empty_or_invalid']),
            ],
            sanitized: sanitized !== formatted,
            assertionSummary: assertionResult.assertionSummary,
            assertionHighlights: assertionResult.assertionHighlights,
          },
        }, 'render', {
          rawConvertedText,
          formatted,
          cleaned,
          sanitized,
          warningFlags: assertionResult.warnings,
        }, context.debugEnabled);
        logStructuredDebug(context, 'render', index, nextCitation, {
          warningFlags: assertionResult.warnings,
        });
        return addCitationStageLog(
          nextCitation,
          createStageDiagnostic(
            'render',
            renderable ? 'success' : 'warning',
            renderable ? 'Rendered citation through the v2 CSL adapter.' : 'Rendered output required sanitize fallback.',
            { warningCount: assertionResult.warnings.length, sanitized: sanitized !== formatted },
          ),
        );
      });

      return {
        ...context,
        citations,
        fallbacksUsed,
        partialResult,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            render: {
              citationCount: citations.length,
              outputStyle: context.request.outputStyle,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'render',
            'success',
            `Rendered ${citations.length} citation(s) in ${context.request.outputStyle}.`,
            { citationCount: citations.length, outputStyle: context.request.outputStyle },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
