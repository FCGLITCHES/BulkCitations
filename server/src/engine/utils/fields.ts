import {
  emptyField,
  fieldOf,
  getFieldOriginForSource,
  type FieldOrigin,
  type FieldSource,
  type FieldValue,
} from '../types/field.js';
import type {
  CanonicalAuthor,
  ExtractedFields,
} from '../types/citation.js';

export const EXTRACTED_FIELD_KEYS = [
  'authors',
  'title',
  'year',
  'journal',
  'volume',
  'issue',
  'pages',
  'doi',
  'pmid',
  'pmcid',
  'arxiv',
  'isbn',
  'issn',
  'handle',
  'patent',
  'publisher',
  'placeOfPublication',
  'url',
  'conferenceTitle',
  'bookTitle',
  'institution',
  'edition',
  'editors',
  'thesisType',
  'repository',
  'articleNumber',
  'accessedDate',
  'siteName',
  'database',
  'reportNumber',
] as const satisfies ReadonlyArray<keyof ExtractedFields>;

export type ExtractedFieldKey = (typeof EXTRACTED_FIELD_KEYS)[number];

export function isExtractedFieldKey(value: string): value is ExtractedFieldKey {
  return (EXTRACTED_FIELD_KEYS as readonly string[]).includes(value);
}

export function createEmptyExtractedFields(
  stageId: string,
  source: FieldSource = 'ml_extraction',
): ExtractedFields {
  return {
    authors: {
      value: [],
      confidence: 0,
      source,
      origin: getFieldOriginForSource(source),
      stageId,
      uncertain: true,
    },
    title: emptyField<string>(stageId, source),
    year: emptyField<number>(stageId, source),
    journal: emptyField<string>(stageId, source),
    volume: emptyField<string>(stageId, source),
    issue: emptyField<string>(stageId, source),
    pages: emptyField<string>(stageId, source),
    doi: emptyField<string>(stageId, source),
    pmid: emptyField<string>(stageId, source),
    pmcid: emptyField<string>(stageId, source),
    arxiv: emptyField<string>(stageId, source),
    isbn: emptyField<string>(stageId, source),
    issn: emptyField<string>(stageId, source),
    handle: emptyField<string>(stageId, source),
    patent: emptyField<string>(stageId, source),
    publisher: emptyField<string>(stageId, source),
    placeOfPublication: emptyField<string>(stageId, source),
    url: emptyField<string>(stageId, source),
    conferenceTitle: emptyField<string>(stageId, source),
    bookTitle: emptyField<string>(stageId, source),
    institution: emptyField<string>(stageId, source),
    edition: emptyField<string>(stageId, source),
    editors: {
      value: [],
      confidence: 0,
      source,
      origin: getFieldOriginForSource(source),
      stageId,
      uncertain: true,
    },
    thesisType: emptyField<string>(stageId, source),
    repository: emptyField<string>(stageId, source),
    articleNumber: emptyField<string>(stageId, source),
    accessedDate: emptyField<string>(stageId, source),
    siteName: emptyField<string>(stageId, source),
    database: emptyField<string>(stageId, source),
    reportNumber: emptyField<string>(stageId, source),
  };
}

export function cloneExtractedFields(fields: ExtractedFields): ExtractedFields {
  return structuredClone(fields);
}

export function hasFieldValue(field: FieldValue<unknown>): boolean {
  if (Array.isArray(field.value)) {
    return field.value.length > 0;
  }

  if (typeof field.value === 'string') {
    return field.value.trim().length > 0;
  }

  return field.value !== null && field.value !== undefined;
}

export function getEquivalentFieldKeys(
  key: keyof ExtractedFields,
): Array<keyof ExtractedFields> {
  switch (key) {
    case 'pages':
      return ['pages', 'articleNumber'];
    case 'articleNumber':
      return ['articleNumber', 'pages'];
    default:
      return [key];
  }
}

export function resolveEquivalentFieldKey(
  fields: ExtractedFields,
  key: keyof ExtractedFields,
): keyof ExtractedFields {
  return getEquivalentFieldKeys(key).find((candidate) => hasFieldValue(fields[candidate])) ?? key;
}

export function getMissingFieldKeys(
  fields: ExtractedFields,
  keys: ReadonlyArray<keyof ExtractedFields>,
): Array<keyof ExtractedFields> {
  return keys.filter((key) => !getEquivalentFieldKeys(key).some((candidate) => hasFieldValue(fields[candidate])));
}

export function averageConfidence(fields: ExtractedFields): number {
  const populated = EXTRACTED_FIELD_KEYS
    .map((key) => fields[key])
    .filter((field) => hasFieldValue(field));

  if (populated.length === 0) return 0;
  return populated.reduce((sum, field) => sum + field.confidence, 0) / populated.length;
}

export function setExtractedField<K extends keyof ExtractedFields>(
  fields: ExtractedFields,
  key: K,
  value: ExtractedFields[K],
): void {
  const mutable = fields as Record<keyof ExtractedFields, ExtractedFields[keyof ExtractedFields]>;
  mutable[key] = value;
}

export function rewriteField<K extends keyof ExtractedFields>(
  existing: ExtractedFields[K],
  key: K,
  nextValue: ExtractedFields[K]['value'],
  source: FieldSource,
  stageId: string,
  confidence: number,
  options: {
    origin?: FieldOrigin;
    uncertain?: boolean;
  } = {},
): ExtractedFields[K] {
  return fieldOf(
    nextValue,
    source,
    stageId,
    confidence,
    {
      origin: options.origin ?? existing.origin,
      ...(options.uncertain !== undefined ? { uncertain: options.uncertain } : {}),
      previousValue: existing.value,
      previousSource: existing.source,
      previousOrigin: existing.origin,
    },
  ) as ExtractedFields[K];
}
