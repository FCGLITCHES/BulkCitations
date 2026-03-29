import { z } from 'zod';
import type { CanonicalAuthor } from '@shared/schema';
import { normalizeDoiValue, normalizeWhitespace, parseAuthorToCanonical } from './utils.js';

const REFERENCE_TYPES = ['journal', 'book', 'chapter', 'conference', 'thesis', 'website', 'report', 'preprint', 'unknown'] as const;

const nullableTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().trim().min(1).nullable().optional());

const nullableYear = z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().int().nullable().optional());

const thesisTypeSchema = z.enum(['Doctoral dissertation', "Master's thesis"]).nullable().optional();

const authorSchema = z.object({
  first: nullableTrimmedString,
  last: z.string().trim().min(1),
  initials: nullableTrimmedString,
  literal: z.string().trim().min(1).optional(),
}).superRefine((author, ctx) => {
  const hasLiteral = Boolean(author.literal);
  if (!hasLiteral) return;
  if (author.literal !== author.last) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'group author literal must match last',
    });
  }
  if (author.first != null || author.initials != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'group author must not include first or initials',
    });
  }
});

const sharedFields = {
  authors: z.array(authorSchema).default([]),
  title: nullableTrimmedString.default(null),
  year: nullableYear.default(null),
  doi: nullableTrimmedString.default(null),
  url: nullableTrimmedString.default(null),
};

const journalSchema = z.object({
  referenceType: z.literal('journal'),
  ...sharedFields,
  journal: nullableTrimmedString.default(null),
  volume: nullableTrimmedString.default(null),
  issue: nullableTrimmedString.default(null),
  pages: nullableTrimmedString.default(null),
});

const bookSchema = z.object({
  referenceType: z.literal('book'),
  ...sharedFields,
  publisher: nullableTrimmedString.default(null),
  placeOfPublication: nullableTrimmedString.default(null),
  edition: nullableTrimmedString.default(null),
});

const chapterSchema = z.object({
  referenceType: z.literal('chapter'),
  ...sharedFields,
  bookTitle: nullableTrimmedString.default(null),
  editors: z.array(authorSchema).default([]),
  pages: nullableTrimmedString.default(null),
  publisher: nullableTrimmedString.default(null),
  placeOfPublication: nullableTrimmedString.default(null),
});

const conferenceSchema = z.object({
  referenceType: z.literal('conference'),
  ...sharedFields,
  conferenceTitle: nullableTrimmedString.default(null),
  pages: nullableTrimmedString.default(null),
  publisher: nullableTrimmedString.default(null),
  placeOfPublication: nullableTrimmedString.default(null),
});

const thesisSchema = z.object({
  referenceType: z.literal('thesis'),
  ...sharedFields,
  thesisType: thesisTypeSchema.default(null),
  institution: nullableTrimmedString.default(null),
});

const websiteSchema = z.object({
  referenceType: z.literal('website'),
  ...sharedFields,
  institution: nullableTrimmedString.default(null),
  publisher: nullableTrimmedString.default(null),
  accessed: nullableTrimmedString.default(null),
});

const reportSchema = z.object({
  referenceType: z.literal('report'),
  ...sharedFields,
  institution: nullableTrimmedString.default(null),
  publisher: nullableTrimmedString.default(null),
  placeOfPublication: nullableTrimmedString.default(null),
  edition: nullableTrimmedString.default(null),
});

const preprintSchema = z.object({
  referenceType: z.literal('preprint'),
  ...sharedFields,
  repository: nullableTrimmedString.default(null),
  institution: nullableTrimmedString.default(null),
});

const unknownSchema = z.object({
  referenceType: z.literal('unknown'),
  ...sharedFields,
  inferenceNote: nullableTrimmedString.default(null),
});

const llmExtractionUnion = z.discriminatedUnion('referenceType', [
  journalSchema,
  bookSchema,
  chapterSchema,
  conferenceSchema,
  thesisSchema,
  websiteSchema,
  reportSchema,
  preprintSchema,
  unknownSchema,
]);

export type LlmExtraction = z.infer<typeof llmExtractionUnion>;

export const LLM_EXTRACT_SYSTEM_PROMPT = `Read the citation, infer its source type, and return exactly one JSON object.

Choose referenceType from: journal, book, chapter, conference, thesis, website, report, preprint, unknown.

Return canonical raw fields only. No formatted strings, explanations, markdown, or code fences. Do not invent missing fields.

Field rules:
- Return all fields listed for the inferred type. Use null for missing scalars, [] for missing arrays.
- year: integer or null.
- volume, issue: string or null.
- pages: return as found in the input, e.g. "530–532".
- accessed: ISO 8601 (YYYY-MM-DD) or null.
- doi: raw identifier only, with no doi.org prefix and no leading "doi:". If the input contains a DOI URL, strip the prefix and return only the identifier.
- thesisType: "Doctoral dissertation", "Master's thesis", or null.
- edition: use for report numbers, guideline codes, revisions, and version labels.
- placeOfPublication + publisher: parse "Amsterdam: EMA" as { "placeOfPublication": "Amsterdam", "publisher": "EMA" }.
- If type is ambiguous, prefer the more specific type and set inferenceNote to a brief explanation.

Author and editor schema:
{ "first": string|null, "last": string, "initials": string|null, "literal"?: string }

Author and editor rules:
- initials: extract exactly as found in the citation, e.g. "J.K." or "J. K."; null if absent.
- Institutional/group: last = full group name, literal = same, first = null, initials = null.
- editors: same schema, array, only for chapter outputs. Use [] if none found.

Type field sets:
- journal    → authors, title, year, journal, volume, issue, pages, doi, url
- book       → authors, title, year, publisher, placeOfPublication, edition, doi, url
- chapter    → authors, title, bookTitle, editors, year, pages, publisher, placeOfPublication, doi, url
- conference → authors, title, conferenceTitle, year, pages, publisher, placeOfPublication, doi, url
- thesis     → authors, title, year, thesisType, institution, doi, url
- website    → authors, title, year, institution, publisher, url, accessed
- report     → authors, title, year, institution, publisher, placeOfPublication, edition, doi, url
- preprint   → authors, title, year, repository, institution, doi, url
- unknown    → authors, title, year, doi, url, inferenceNote`;

function normalizeIsoDate(value: unknown): string | null | undefined {
  if (typeof value !== 'string') return value as string | null | undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : trimmed;
}

function normalizeEditors(value: unknown): CanonicalAuthor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => {
    const parsed = authorSchema.parse(entry);
    return {
      first: parsed.first ?? null,
      last: parsed.last,
      initials: parsed.initials ?? null,
      ...(parsed.literal ? { literal: parsed.literal } : {}),
    };
  });
}

function normalizeLegacyEditor(value: unknown): CanonicalAuthor[] | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return undefined;
  return [parseAuthorToCanonical(trimmed)];
}

function normalizeReferenceType(value: unknown): LlmExtraction['referenceType'] {
  return REFERENCE_TYPES.includes(value as LlmExtraction['referenceType'])
    ? value as LlmExtraction['referenceType']
    : 'unknown';
}

export function extractJsonContent(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function normalizeLlmExtractionInput(value: unknown): Record<string, unknown> {
  const input = value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
  const doiValue = typeof input.doi === 'string' ? normalizeDoiValue(input.doi) : input.doi;
  const normalized: Record<string, unknown> = {
    ...input,
    referenceType: normalizeReferenceType(input.referenceType),
    doi: typeof doiValue === 'string' && doiValue ? doiValue : null,
    placeOfPublication: input.placeOfPublication ?? input.place ?? null,
    accessed: normalizeIsoDate(input.accessed ?? input.accessed_date ?? null) ?? null,
    edition: input.edition ?? input.reportNumber ?? input.guidelineCode ?? input.revision ?? input.version ?? null,
  };

  const normalizedEditors = normalizeEditors(input.editors) ?? normalizeLegacyEditor(input.editor);
  if (normalizedEditors) {
    normalized.editors = normalizedEditors;
  }

  return normalized;
}

export function parseLlmExtraction(value: unknown): LlmExtraction {
  const normalized = normalizeLlmExtractionInput(value);
  return llmExtractionUnion.parse(normalized);
}
