import type {
  CanonicalAuthor,
  CanonicalCitation,
  FieldRepairConfidence,
  FieldValue,
  NormalizationMetadata,
} from '@shared/schema';
import { isGroupAuthor, normalizeGroupAuthor, normalizeKnownContainerName } from '../../shared/citationSemantics.js';
import { detectResidualArtifactsByField } from '../rawPdfCopy.js';
import type { V2Stage } from '../contracts.js';
import { normalizeLocatorValue } from '../qualityRules.js';
import {
  runStageTasksSequentiallyWithIsolation,
} from '../stageIsolation.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createStageDiagnostic,
  createFieldValue,
  fixUnicodeText,
  isVerboseDebugEnabled,
  isLikelyAllCaps,
  logStructuredDebug,
  normalizeCanonicalAuthor,
  normalizeDoiValue,
  normalizeWhitespace,
  toSmartTitleCase,
} from '../utils.js';

function normalizeNullableField(
  field: FieldValue<string | null>,
  normalizer: (value: string) => string,
  stageId: 'normalize',
): { field: FieldValue<string | null>; changed: boolean } {
  if (!field.value) return { field, changed: false };
  const normalized = normalizer(field.value);
  if (normalized === field.value) return { field, changed: false };
  return {
    field: {
      value: normalized,
      source: 'normalized',
      confidence: field.confidence,
      stageId,
    },
    changed: true,
  };
}

function normalizeAuthors(field: FieldValue<CanonicalAuthor[]>): { field: FieldValue<CanonicalAuthor[]>; changed: boolean } {
  if (field.value.length === 0) return { field, changed: false };

  const nextAuthors = field.value.map(normalizeCanonicalAuthor);
  const changed = JSON.stringify(nextAuthors) !== JSON.stringify(field.value);
  if (!changed) return { field, changed: false };

  return {
    field: {
      ...field,
      value: nextAuthors,
      source: 'normalized',
      stageId: 'normalize',
    },
    changed: true,
  };
}

function buildNormalizationMetadata(
  doiNormalized: boolean,
  unicodeRepairedFields: string[],
  titleCaseApplied: boolean,
  fieldRepairConfidence: Record<string, FieldRepairConfidence>,
  citationRepairConfidence: FieldRepairConfidence,
  appliedRepairs: NonNullable<NormalizationMetadata['appliedRepairs']>,
  repairMisses: NonNullable<NormalizationMetadata['repairMisses']>,
  residualArtifacts: NonNullable<NormalizationMetadata['residualArtifacts']>,
): NormalizationMetadata {
  return {
    doiNormalized,
    unicodeRepairedFields,
    titleCaseApplied,
    journalNormalizationHookAvailable: true,
    appliedRepairs,
    repairMisses,
    fieldRepairConfidence,
    citationRepairConfidence,
    residualArtifacts,
  };
}

function normalizeEditionValue(value: string): string {
  const normalized = normalizeWhitespace(value)
    .replace(/\bedition\b/gi, 'ed.')
    .replace(/\bed\.$/i, 'ed.')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized
    .replace(/^first\s+ed\.?$/i, '1st ed.')
    .replace(/^second\s+ed\.?$/i, '2nd ed.')
    .replace(/^third\s+ed\.?$/i, '3rd ed.')
    .replace(/^fourth\s+ed\.?$/i, '4th ed.');
}

export function createNormalizeStage(): V2Stage {
  return {
    id: 'normalize',
    async run(context) {
      const startedAt = Date.now();
      const verboseDebug = isVerboseDebugEnabled();

      const isolation = await runStageTasksSequentiallyWithIsolation({
        stageId: 'normalize',
        items: context.citations,
        run: (citation, index) => {
          const unicodeRepairedFields: string[] = [];
          const preparedWorkingChunk = context.workingChunkByCitationId[citation.id];

          const normalizedTitleBase = citation.title.value ? fixUnicodeText(citation.title.value).replace(/\.$/, '') : null;
          const titleCaseApplied = Boolean(normalizedTitleBase && isLikelyAllCaps(normalizedTitleBase));
          const normalizedTitle = titleCaseApplied && normalizedTitleBase ? toSmartTitleCase(normalizedTitleBase) : normalizedTitleBase;
          if (citation.title.value && normalizedTitle && normalizedTitle !== citation.title.value) {
            unicodeRepairedFields.push('title');
          }

          const normalizedJournal = citation.journal.value ? fixUnicodeText(citation.journal.value) : null;
          if (citation.journal.value && normalizedJournal && normalizedJournal !== citation.journal.value) {
            unicodeRepairedFields.push('journal');
          }

          const titleResult = normalizeNullableField(citation.title, (value) => {
            const base = fixUnicodeText(value).replace(/\.$/, '');
            return isLikelyAllCaps(base) ? toSmartTitleCase(base) : base;
          }, 'normalize');
          const journalResult = normalizeNullableField(citation.journal, fixUnicodeText, 'normalize');
          const volumeResult = normalizeNullableField(citation.volume, normalizeWhitespace, 'normalize');
          const issueResult = normalizeNullableField(citation.issue, normalizeWhitespace, 'normalize');
          const pagesResult = normalizeNullableField(citation.pages, (value) => {
            const repaired = fixUnicodeText(value).replace(/[–—]/g, '-');
            return normalizeLocatorValue(repaired) ?? repaired;
          }, 'normalize');
          const publisherResult = normalizeNullableField(citation.publisher, fixUnicodeText, 'normalize');
          const urlResult = normalizeNullableField(citation.url, (value) => normalizeWhitespace(value).replace(/\.$/, ''), 'normalize');
          const doiResult = normalizeNullableField(citation.doi, normalizeDoiValue, 'normalize');
          const conferenceResult = normalizeNullableField(citation.conferenceTitle, normalizeKnownContainerName, 'normalize');
          const bookTitleResult = normalizeNullableField(citation.bookTitle, normalizeKnownContainerName, 'normalize');
          const institutionResult = normalizeNullableField(citation.institution, (value) => {
            const fixed = fixUnicodeText(value);
            return isGroupAuthor(fixed) ? normalizeGroupAuthor(fixed) : fixed;
          }, 'normalize');
          const editionResult = normalizeNullableField(citation.edition, normalizeEditionValue, 'normalize');
          const editorResult = normalizeNullableField(citation.editor, fixUnicodeText, 'normalize');
          const authorsResult = normalizeAuthors(citation.authors);
          const doiNormalized = Boolean(citation.doi.value && doiResult.field.value && citation.doi.value !== doiResult.field.value);

          let normalizedCitation: CanonicalCitation = {
            ...citation,
            authors: authorsResult.field,
            title: titleResult.field,
            journal: journalResult.field,
            volume: volumeResult.field,
            issue: issueResult.field,
            pages: pagesResult.field,
            doi: doiResult.field,
            publisher: publisherResult.field,
            url: urlResult.field,
            conferenceTitle: conferenceResult.field,
            bookTitle: bookTitleResult.field,
            institution: institutionResult.field,
            edition: editionResult.field,
            editor: editorResult.field,
            normalization: buildNormalizationMetadata(
              doiNormalized,
              unicodeRepairedFields,
              titleCaseApplied,
              {},
              preparedWorkingChunk?.citationRepairConfidence ?? 'high',
              preparedWorkingChunk?.appliedRepairs ?? [],
              preparedWorkingChunk?.repairMisses ?? [],
              preparedWorkingChunk?.residualArtifacts ?? [],
            ),
          };

          if (publisherResult.field.value && isGroupAuthor(publisherResult.field.value)) {
            normalizedCitation = {
              ...normalizedCitation,
              publisher: createFieldValue(normalizeGroupAuthor(publisherResult.field.value), 'normalized', publisherResult.field.confidence, 'normalize'),
            };
          }

          if (
            normalizedCitation.referenceType === 'report'
            && !normalizedCitation.institution.value
            && normalizedCitation.publisher.value
            && isGroupAuthor(normalizedCitation.publisher.value)
          ) {
            normalizedCitation = {
              ...normalizedCitation,
              institution: createFieldValue(normalizeGroupAuthor(normalizedCitation.publisher.value), 'normalized', normalizedCitation.publisher.confidence, 'normalize'),
            };
          }

          if (
            ['report', 'book'].includes(normalizedCitation.referenceType)
            && normalizedCitation.authors.value.length === 0
          ) {
            const institutionalAuthor = normalizedCitation.institution.value ?? normalizedCitation.publisher.value;
            if (institutionalAuthor && isGroupAuthor(institutionalAuthor)) {
              normalizedCitation = {
                ...normalizedCitation,
                authors: createFieldValue([normalizeCanonicalAuthor({
                  first: null,
                  last: normalizeGroupAuthor(institutionalAuthor),
                  initials: null,
                  literal: normalizeGroupAuthor(institutionalAuthor),
                })], 'normalized', 0.88, 'normalize'),
              };
            }
          }

          if (
            ['book', 'chapter'].includes(normalizedCitation.referenceType)
            && !normalizedCitation.bookTitle.value
            && normalizedCitation.journal.value
            && /\b(handbook|manual|guide|encyclopedia|textbook)\b/i.test(normalizedCitation.journal.value)
          ) {
            normalizedCitation = {
              ...normalizedCitation,
              bookTitle: createFieldValue(normalizeKnownContainerName(normalizedCitation.journal.value), 'normalized', normalizedCitation.journal.confidence, 'normalize'),
            };
          }

          if (
            normalizedCitation.referenceType === 'report'
            && !normalizedCitation.institution.value
            && normalizedCitation.journal.value
            && isGroupAuthor(normalizedCitation.journal.value)
          ) {
            normalizedCitation = {
              ...normalizedCitation,
              institution: createFieldValue(normalizeGroupAuthor(normalizedCitation.journal.value), 'normalized', normalizedCitation.journal.confidence, 'normalize'),
            };
          }

          const fieldRepairConfidence = (preparedWorkingChunk?.appliedRepairs ?? []).reduce<Record<string, FieldRepairConfidence>>((accumulator, repair) => {
            if (!repair.field || !repair.confidence) return accumulator;
            const current = accumulator[repair.field];
            if (!current) {
              accumulator[repair.field] = repair.confidence;
              return accumulator;
            }
            const rank = { high: 2, medium: 1, low: 0 } satisfies Record<FieldRepairConfidence, number>;
            accumulator[repair.field] = rank[repair.confidence] < rank[current] ? repair.confidence : current;
            return accumulator;
          }, {});
          const residualArtifacts = [
            ...(preparedWorkingChunk?.residualArtifacts ?? []),
            ...detectResidualArtifactsByField({
              title: normalizedCitation.title.value,
              journal: normalizedCitation.journal.value,
              publisher: normalizedCitation.publisher.value,
              conferenceTitle: normalizedCitation.conferenceTitle.value,
              bookTitle: normalizedCitation.bookTitle.value,
              institution: normalizedCitation.institution.value,
              doi: normalizedCitation.doi.value,
              url: normalizedCitation.url.value,
              pages: normalizedCitation.pages.value,
              volume: normalizedCitation.volume.value,
              issue: normalizedCitation.issue.value,
            }),
          ];
          normalizedCitation = {
            ...normalizedCitation,
            normalization: buildNormalizationMetadata(
              doiNormalized,
              unicodeRepairedFields,
              titleCaseApplied,
              fieldRepairConfidence,
              preparedWorkingChunk?.citationRepairConfidence ?? 'high',
              preparedWorkingChunk?.appliedRepairs ?? [],
              preparedWorkingChunk?.repairMisses ?? [],
              residualArtifacts,
            ),
          };

          const changed = [
            titleResult.changed,
            journalResult.changed,
            volumeResult.changed,
            issueResult.changed,
            pagesResult.changed,
            publisherResult.changed,
            urlResult.changed,
            doiResult.changed,
            conferenceResult.changed,
            bookTitleResult.changed,
            institutionResult.changed,
            editionResult.changed,
            editorResult.changed,
            authorsResult.changed,
          ].some(Boolean);
          if (context.debugEnabled && verboseDebug) {
            normalizedCitation = attachCitationDebug(normalizedCitation, 'normalize', {
              changed,
              doiNormalized,
              unicodeRepairedFields,
              titleCaseApplied,
              reportInstitutionPromoted: normalizedCitation.referenceType === 'report' && Boolean(normalizedCitation.institution.value),
              bookTitlePromoted: normalizedCitation.referenceType !== citation.referenceType || Boolean(normalizedCitation.bookTitle.value && !citation.bookTitle.value),
            }, true);
          }
          logStructuredDebug(context, 'normalize', index, normalizedCitation, {
            warningFlags: unicodeRepairedFields,
            titleCaseApplied,
          });

          return addCitationStageLog(
            normalizedCitation,
            createStageDiagnostic(
              'normalize',
              'success',
              changed ? 'Normalized canonical field values.' : 'Canonical fields were already normalized.',
              {
                doiNormalized,
                unicodeRepairedFields,
                titleCaseApplied,
              },
            ),
          );
        },
        recover: ({ item: citation, message, timedOut }) => addCitationStageLog(
          attachCitationDebug(citation, 'normalize', {
            isolationRecovered: true,
            timedOut,
            errorMessage: message,
          }, context.debugEnabled),
          createStageDiagnostic(
            'normalize',
            'warning',
            timedOut
              ? 'Normalization timed out for this citation; keeping the pre-normalized fields.'
              : 'Normalization failed for this citation; keeping the pre-normalized fields.',
            { timedOut, message },
          ),
        ),
      });
      const citations = isolation.outcomes.map((outcome) => outcome.result);
      const recoveredFallbacks = isolation.outcomes
        .filter((outcome) => outcome.recovered)
        .map((outcome) => outcome.timedOut ? 'normalize:item-timeout' : 'normalize:item-error');

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
            normalize: {
              citationCount: citations.length,
              recoveredCount: isolation.recoveredCount,
              timeoutCount: isolation.timeoutCount,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'normalize',
            'success',
            `Normalized ${citations.length} citation(s).`,
            { citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
