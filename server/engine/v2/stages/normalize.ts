import type { CanonicalAuthor, CanonicalCitation, FieldValue, NormalizationMetadata } from '@shared/schema';
import { isGroupAuthor, normalizeGroupAuthor, normalizeKnownContainerName } from '../../shared/citationSemantics.js';
import type { V2Stage } from '../contracts.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createStageDiagnostic,
  createFieldValue,
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
          normalization: buildNormalizationMetadata(doiNormalized, unicodeRepairedFields, titleCaseApplied),
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
          reportInstitutionPromoted: normalizedCitation.referenceType === 'report' && Boolean(normalizedCitation.institution.value),
          bookTitlePromoted: normalizedCitation.referenceType !== citation.referenceType || Boolean(normalizedCitation.bookTitle.value && !citation.bookTitle.value),
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
