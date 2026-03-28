import { formatCSLData, initCSLStyles, parsedReferenceToCSL } from '../../cslConverter.js';
import { sanitizeStructuredLocatorContainers } from '../../shared/structuredLocatorCleanup.js';
import { fixFormatting, runAssertions } from '../renderPolicy.js';
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
const DUPLICATE_PUNCT_RE = /([,.;:])\1+/g;
const MIXED_PUNCT_SEQUENCE_RE = /(?<!\b[A-Z])([,.;:])(?:\s*[,.;:])+/g;
const EMPTY_PARENS_PUNCT_RE = /\(\s*[,.;:]\s*\)/g;
const MULTI_SPACE_RE = /\s{2,}/g;
const PROTECTED_INITIAL_DOT_COMMA_RE = /\b([A-Z])\.\s*,/g;
const PROTECTED_INITIAL_DOT_COMMA_TOKEN = '__INITIAL_DOT_COMMA__';
const PROTECTED_INITIAL_TRAILING_DOT_RE = new RegExp(`${PROTECTED_INITIAL_DOT_COMMA_TOKEN}\\.(?=\\s|$)`, 'g');

function ensureCsl(): void {
  if (!cslReady) {
    initCSLStyles();
    cslReady = true;
  }
}

export function postCslCleanup(value: string): string {
  let cleaned = value;
  if (/\b[A-Z]\.\s*,/.test(cleaned)) {
    cleaned = cleaned.replace(PROTECTED_INITIAL_DOT_COMMA_RE, `$1${PROTECTED_INITIAL_DOT_COMMA_TOKEN}`);
  }
  if (/[\t ]+[,.;:]/.test(cleaned)) {
    cleaned = cleaned.replace(SPACE_BEFORE_PUNCT_RE, '$1');
  }
  if (/([,.;:]){2,}/.test(cleaned)) {
    cleaned = cleaned.replace(DUPLICATE_PUNCT_RE, '$1');
  }
  if (/[,.;:]\s*[,.;:]/.test(cleaned)) {
    cleaned = cleaned.replace(MIXED_PUNCT_SEQUENCE_RE, '$1');
  }
  if (cleaned.includes('(')) {
    cleaned = cleaned.replace(EMPTY_PARENS_PUNCT_RE, '');
  }
  if (cleaned.includes('  ')) {
    cleaned = cleaned.replace(MULTI_SPACE_RE, ' ');
  }
  if (cleaned.includes(PROTECTED_INITIAL_DOT_COMMA_TOKEN)) {
    cleaned = cleaned.replace(PROTECTED_INITIAL_TRAILING_DOT_RE, PROTECTED_INITIAL_DOT_COMMA_TOKEN);
    cleaned = cleaned.split(PROTECTED_INITIAL_DOT_COMMA_TOKEN).join('.,');
  }
  return cleaned.trim();
}

function sanitizeCitation(value: string): string {
  const normalized = fixUnicodeText(value);
  if (!normalized) return normalized;
  const lastChar = normalized.charCodeAt(normalized.length - 1);
  return lastChar === 46 || lastChar === 63 || lastChar === 33 ? normalized : `${normalized}.`;
}

function sanitizeTrustedCitation(value: string): string {
  const normalized = value.trim();
  if (!normalized) return normalized;
  const lastChar = normalized.charCodeAt(normalized.length - 1);
  return lastChar === 46 || lastChar === 63 || lastChar === 33 ? normalized : `${normalized}.`;
}

function isRenderable(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || !/[A-Za-z0-9]/.test(trimmed)) return false;
  if (/^\(?n\.d\.\)?\.?$/i.test(trimmed)) return false;
  return true;
}

function fallbackAuthorToken(citation: any): string | null {
  const author = citation.authors?.value?.[0];
  if (!author) return null;
  const last = fixUnicodeText(author.last ?? author.literal ?? '').trim();
  const initials = fixUnicodeText(author.initials ?? '').trim();
  const firstInitial = fixUnicodeText(author.first ?? '').trim().charAt(0);
  if (!last) return null;
  if (initials) return `${last}, ${initials}`;
  if (firstInitial) return `${last}, ${firstInitial.toUpperCase()}.`;
  return last;
}

function buildMinimalApaFallback(citation: any): string {
  const author = fallbackAuthorToken(citation);
  const year = citation.year?.value != null ? String(citation.year.value) : 'n.d.';
  const title = fixUnicodeText((citation.title?.value ?? '').trim());
  const raw = fixUnicodeText((citation.raw ?? '').trim());

  if (author && title) {
    return `${author} (${year}). ${sanitizeCitation(title)}`;
  }
  if (title) {
    return `[Unresolved reference]. ${sanitizeCitation(title)}`;
  }
  if (raw) {
    return `[Unresolved reference]. ${sanitizeCitation(raw)}`;
  }
  return '[Unresolved reference]. Citation unavailable.';
}

function markActionNeeded(citation: any) {
  return {
    ...citation,
    quality: citation.quality
      ? {
          ...citation.quality,
          bucket: 'action_needed',
          bucketReasons: [...new Set([...(citation.quality.bucketReasons ?? []), 'render_fallback_applied'])],
          flags: [...new Set([...(citation.quality.flags ?? []), 'action_needed'])],
        }
      : citation.quality,
  };
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
            const trustedOutput = sanitizeTrustedCitation(postCslCleanup(citation.truth.validatedOutput));
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

          const parsed = sanitizeStructuredLocatorContainers(canonicalToParsedReference(citation));
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
            ...(renderable ? citation : markActionNeeded(citation)),
            rendered: {
              outputStyle: context.request.outputStyle,
              formatted: renderable ? sanitized : buildMinimalApaFallback(citation),
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
              ...markActionNeeded(citation),
              rendered: {
                outputStyle: context.request.outputStyle,
                formatted: buildMinimalApaFallback(citation),
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
