import type { CanonicalAuthor, CanonicalCitation, FieldValue, NormalizationMetadata } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createStageDiagnostic,
  fixUnicodeText,
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
): NormalizationMetadata {
  return {
    doiNormalized,
    unicodeRepairedFields,
    titleCaseApplied,
    journalNormalizationHookAvailable: true,
  };
}

export function createNormalizeStage(): V2Stage {
  return {
    id: 'normalize',
    async run(context) {
      const startedAt = Date.now();

      const citations: CanonicalCitation[] = context.citations.map((citation) => {
        const unicodeRepairedFields: string[] = [];

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
        const pagesResult = normalizeNullableField(citation.pages, (value) => fixUnicodeText(value).replace(/[–—]/g, '-'), 'normalize');
        const publisherResult = normalizeNullableField(citation.publisher, fixUnicodeText, 'normalize');
        const urlResult = normalizeNullableField(citation.url, (value) => normalizeWhitespace(value).replace(/\.$/, ''), 'normalize');
        const doiResult = normalizeNullableField(citation.doi, normalizeDoiValue, 'normalize');
        const conferenceResult = normalizeNullableField(citation.conferenceTitle, fixUnicodeText, 'normalize');
        const bookTitleResult = normalizeNullableField(citation.bookTitle, fixUnicodeText, 'normalize');
        const institutionResult = normalizeNullableField(citation.institution, fixUnicodeText, 'normalize');
        const editionResult = normalizeNullableField(citation.edition, normalizeWhitespace, 'normalize');
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
          normalization: buildNormalizationMetadata(doiNormalized, unicodeRepairedFields, titleCaseApplied),
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
        normalizedCitation = attachCitationDebug(normalizedCitation, 'normalize', {
          changed,
          doiNormalized,
          unicodeRepairedFields,
          titleCaseApplied,
        }, context.debugEnabled);
        logStructuredDebug(context, 'normalize', context.citations.findIndex((item) => item.id === citation.id), normalizedCitation, {
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
      });

      return {
        ...context,
        citations,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            normalize: {
              citationCount: citations.length,
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
