import { formatCSLData, initCSLStyles, parsedReferenceToCSL } from '../../cslConverter.js';
import { fixFormatting, runAssertions } from '../../strictRenderer.js';
import type { V2Stage } from '../contracts.js';
import {
  runStageTasksSequentiallyWithIsolation,
} from '../stageIsolation.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  canonicalReferenceTypeToParsed,
  canonicalToParsedReference,
  createStageDiagnostic,
  fixUnicodeText,
  isVerboseDebugEnabled,
  logStructuredDebug,
} from '../utils.js';

let cslReady = false;
const SPACE_BEFORE_PUNCT_RE = /\s+([,.;:])/g;
const DUPLICATE_PUNCT_RE = /([,.;:]){2,}/g;
const EMPTY_PARENS_PUNCT_RE = /\(\s*[,.;:]\s*\)/g;
const MULTI_SPACE_RE = /\s{2,}/g;

function ensureCsl(): void {
  if (!cslReady) {
    initCSLStyles();
    cslReady = true;
  }
}

function postCslCleanup(value: string): string {
  let cleaned = value;
  if (/[\t ]+[,.;:]/.test(cleaned)) {
    cleaned = cleaned.replace(SPACE_BEFORE_PUNCT_RE, '$1');
  }
  if (/([,.;:]){2,}/.test(cleaned)) {
    cleaned = cleaned.replace(DUPLICATE_PUNCT_RE, '$1');
  }
  if (cleaned.includes('(')) {
    cleaned = cleaned.replace(EMPTY_PARENS_PUNCT_RE, '');
  }
  if (cleaned.includes('  ')) {
    cleaned = cleaned.replace(MULTI_SPACE_RE, ' ');
  }
  return cleaned.trim();
}

function sanitizeCitation(value: string): string {
  const normalized = fixUnicodeText(value);
  if (!normalized) return normalized;
  const lastChar = normalized.charCodeAt(normalized.length - 1);
  return lastChar === 46 || lastChar === 63 || lastChar === 33 ? normalized : `${normalized}.`;
}

function isRenderable(value: string): boolean {
  return value.trim().length >= 3 && /[A-Za-z0-9]/.test(value);
}

export function createRenderStage(): V2Stage {
  return {
    id: 'render',
    async run(context) {
      const startedAt = Date.now();
      const verboseDebug = isVerboseDebugEnabled();
      ensureCsl();
      const fallbacksUsed = [...context.fallbacksUsed];
      let partialResult = context.partialResult;

      const isolation = await runStageTasksSequentiallyWithIsolation({
        stageId: 'render',
        items: context.citations,
        run: (citation, index) => {
          if (citation.truth?.usedValidatedOutput && citation.truth.validatedOutput) {
            const trustedOutput = sanitizeCitation(postCslCleanup(citation.truth.validatedOutput));
            const nextCitationBase = {
              ...citation,
              rendered: {
                outputStyle: context.request.outputStyle,
                formatted: trustedOutput,
                warnings: citation.rendered?.warnings ?? [],
                sanitized: trustedOutput !== citation.truth.validatedOutput,
                assertionSummary: citation.rendered?.assertionSummary,
                assertionHighlights: citation.rendered?.assertionHighlights,
              },
            };
            const nextCitation = context.debugEnabled && verboseDebug
              ? attachCitationDebug(nextCitationBase, 'render', {
                trustedTruthOutputUsed: true,
                truthId: citation.truth.truthId,
              }, true)
              : nextCitationBase;

            return addCitationStageLog(
              nextCitation,
              createStageDiagnostic(
                'render',
                'success',
                'Rendered citation from approved truth output.',
                { truthId: citation.truth.truthId },
              ),
            );
          }

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

          const nextCitationBase = {
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
          };
          const nextCitation = context.debugEnabled && verboseDebug
            ? attachCitationDebug(nextCitationBase, 'render', {
              warningFlags: assertionResult.warnings,
              rawConvertedText,
              formatted,
              cleaned,
              sanitized,
            }, true)
            : nextCitationBase;
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
        },
        recover: ({ item: citation, message, timedOut }) => {
          partialResult = true;
          const fallbackTag = timedOut ? 'render:item-timeout' : 'render:item-error';
          fallbacksUsed.push(fallbackTag);
          return addCitationStageLog(
            attachCitationDebug({
              ...citation,
              rendered: {
                outputStyle: context.request.outputStyle,
                formatted: sanitizeCitation(citation.raw),
                warnings: ['warning:render_stage_error'],
                sanitized: false,
                assertionSummary: citation.rendered?.assertionSummary,
                assertionHighlights: citation.rendered?.assertionHighlights,
              },
            }, 'render', {
              isolationRecovered: true,
              timedOut,
              errorMessage: message,
            }, context.debugEnabled),
            createStageDiagnostic(
              'render',
              'warning',
              timedOut
                ? 'Rendering timed out for this citation; falling back to the raw citation text.'
                : 'Rendering failed for this citation; falling back to the raw citation text.',
              { timedOut, message },
            ),
          );
        },
      });
      const citations = isolation.outcomes.map((outcome) => outcome.result);
      const recoveredFallbacks = isolation.outcomes
        .filter((outcome) => outcome.recovered)
        .map((outcome) => outcome.timedOut ? 'render:item-timeout' : 'render:item-error');

      return {
        ...context,
        citations,
        fallbacksUsed,
        partialResult,
        partialReasons: [...new Set([
          ...context.partialReasons,
          ...recoveredFallbacks,
          ...(fallbacksUsed.includes('render:sanitize_fallback') ? ['render:sanitize_fallback'] : []),
        ])],
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            render: {
              citationCount: citations.length,
              outputStyle: context.request.outputStyle,
              recoveredCount: isolation.recoveredCount,
              timeoutCount: isolation.timeoutCount,
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
