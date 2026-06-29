import {
  normalizeArxiv,
  normalizeDoi,
  normalizeHandle,
  normalizeIdentifierForField,
  normalizeIsbn,
  normalizeIssn,
  normalizePatent,
  normalizePmid,
} from "../engine/identifierUtils.js";
import type { BenchmarkManifestRow, BenchmarkPredictionRow, BenchmarkReferenceType } from "./types.js";
import type { TruthFieldValue, TruthScalar } from "../training/truthFields.js";

const PUNCTUATION_REGEX = /[^\p{L}\p{N}]+/gu;
const DASH_REGEX = /[\u2010-\u2015\u2212]+/gu;
const DOI_PREFIX_REGEX = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu;
const ARXIV_PREFIX_REGEX = /^arxiv:\s*/iu;

export function canonicalizeBenchmarkFieldName(field: string): string {
  if (field === "journal" || field === "venue") {
    return "journal/venue";
  }
  return field;
}

export function canonicalizeBenchmarkFieldList(fields: readonly string[]): string[] {
  return [...new Set(fields.map((field) => canonicalizeBenchmarkFieldName(field)))];
}

function normalizeCompactIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeSoftText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/&amp;/giu, "&")
    .replace(DASH_REGEX, "-")
    .replace(DOI_PREFIX_REGEX, "")
    .replace(ARXIV_PREFIX_REGEX, "")
    .replace(/&/gu, " and ")
    .toLowerCase()
    .replace(PUNCTUATION_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStrictText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replace(/&amp;/giu, "&").trim();
}

export function normalizeBenchmarkValue(
  field: string,
  value: TruthFieldValue | unknown,
): TruthFieldValue | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeBenchmarkScalar(field, item))
      .filter((item): item is TruthScalar => item !== undefined);
  }
  return normalizeBenchmarkScalar(field, value);
}

export function deriveVirtualVenue(
  referenceType: BenchmarkReferenceType | string,
  fields: Record<string, TruthFieldValue | undefined>,
): TruthFieldValue | undefined {
  if (hasComparableBenchmarkValue(fields.venue)) {
    return fields.venue;
  }
  if (hasComparableBenchmarkValue(fields["journal/venue"])) {
    return fields["journal/venue"];
  }
  switch (referenceType) {
    case "article-journal":
      return fields.journal;
    case "conference-paper":
      return fields.conferenceTitle;
    case "book-chapter":
      return fields.bookTitle;
    case "book":
      return fields.publisher;
    case "thesis":
    case "report":
      return fields.institution;
    case "preprint":
      return fields.repository;
    case "webpage":
      return fields.siteName;
    default:
      return undefined;
  }
}

export function flattenPredictionFields(
  prediction: BenchmarkPredictionRow,
): Record<string, TruthFieldValue | undefined> {
  const firstAuthor = Array.isArray(prediction.fields.authors)
    ? prediction.fields.authors[0]
    : undefined;
  const flattened: Record<string, TruthFieldValue | undefined> = {};
  for (const [field, value] of Object.entries(prediction.fields)) {
    setCanonicalBenchmarkField(flattened, field, value);
  }
  if (firstAuthor !== undefined) {
    setCanonicalBenchmarkField(flattened, "firstAuthor", firstAuthor);
  }
  setCanonicalBenchmarkField(
    flattened,
    "journal/venue",
    deriveVirtualVenue(prediction.detected_type ?? prediction.reference_type, flattened) ?? prediction.venue,
  );
  return flattened;
}

export function flattenManifestFields(
  row: BenchmarkManifestRow,
): Record<string, TruthFieldValue | undefined> {
  const firstAuthor = Array.isArray(row.expected_fields.authors)
    ? row.expected_fields.authors[0]
    : undefined;
  const flattened: Record<string, TruthFieldValue | undefined> = {};
  for (const [field, value] of Object.entries(row.expected_fields)) {
    setCanonicalBenchmarkField(flattened, field, value);
  }
  if (firstAuthor !== undefined) {
    setCanonicalBenchmarkField(flattened, "firstAuthor", firstAuthor);
  }
  setCanonicalBenchmarkField(flattened, "journal/venue", deriveVirtualVenue(row.reference_type, row.expected_fields));
  return flattened;
}

function normalizeBenchmarkScalar(
  field: string,
  value: unknown,
): TruthScalar | undefined {
  if (value == null) return undefined;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "string") return undefined;

  switch (field) {
    case "doi":
      return normalizeDoi(value) ?? undefined;
    case "pmid":
      return normalizePmid(value) ?? undefined;
    case "arxiv":
      return normalizeArxiv(value) ?? undefined;
    case "isbn":
      return normalizeIsbn(value) ?? undefined;
    case "issn":
      return normalizeIssn(value) ?? undefined;
    case "handle":
      return normalizeHandle(value) ?? undefined;
    case "patent":
      return normalizePatent(value) ?? undefined;
    case "venue":
    case "journal/venue":
    case "authors":
    case "firstAuthor":
    case "title":
    case "journal":
    case "conferenceTitle":
    case "bookTitle":
    case "institution":
    case "publisher":
    case "repository":
    case "siteName":
    case "reportNumber":
    case "thesisType":
    case "edition":
    case "articleNumber":
    case "accessedDate":
      return normalizeStrictText(value) || undefined;
    case "pages":
      return normalizeStrictText(value).replace(/\bpp?\b\.?/giu, " ").replace(/\s+/g, " ").trim() || undefined;
    case "year": {
      const match = value.match(/\b((?:19|20)\d{2})\b/);
      return match?.[1] ?? value.trim();
    }
    default:
      return normalizeStrictText(value) || undefined;
  }
}

export function normalizeFieldForSearch(field: string, value: TruthFieldValue | undefined): string {
  const normalized = normalizeBenchmarkValue(field, value);
  if (Array.isArray(normalized)) {
    return normalized.map((entry) => String(entry ?? "")).join(" ");
  }
  return normalized == null ? "" : String(normalized);
}

export function inferRequiredFields(
  row: Pick<
    BenchmarkManifestRow,
    "reference_type" | "expected_fields" | "formatted_string"
  >,
): string[] {
  const venue = deriveVirtualVenue(row.reference_type, row.expected_fields);
  const required: string[] = [];
  const coreFields = getCoreRequiredFields(row.reference_type, row.expected_fields, venue);

  for (const field of coreFields) {
    const value =
      field === "journal/venue"
        ? venue
        : row.expected_fields[field];
    if (fieldLooksPresentInFormatted(field, value, row.formatted_string) && !required.includes(field)) {
      required.push(field);
    }
  }

  return required;
}

function getCoreRequiredFields(
  referenceType: BenchmarkManifestRow["reference_type"],
  expectedFields: Record<string, TruthFieldValue>,
  venue: TruthFieldValue | undefined,
): string[] {
  switch (referenceType) {
    case "article-journal":
      return [
        "authors",
        "title",
        "year",
        ...(hasComparableBenchmarkValue(venue) ? ["journal/venue"] : []),
        ...(hasComparableBenchmarkValue(expectedFields.volume)
          ? ["volume"]
          : hasComparableBenchmarkValue(expectedFields.doi)
            ? ["doi"]
            : []),
      ];
    case "conference-paper":
      return ["authors", "title", "year", "conferenceTitle"];
    case "book":
      return [
        ...(hasComparableBenchmarkValue(expectedFields.authors)
          ? ["authors"]
          : hasComparableBenchmarkValue(expectedFields.editors)
            ? ["editors"]
            : []),
        "title",
        "year",
        "publisher",
      ];
    case "book-chapter":
      return ["authors", "title", "year", "bookTitle"];
    case "preprint":
      return ["authors", "title", "year", "repository"];
    case "thesis":
      return ["authors", "title", "year", "institution", "thesisType"];
    case "report":
      return [
        ...(hasComparableBenchmarkValue(expectedFields.authors)
          ? ["authors"]
          : hasComparableBenchmarkValue(expectedFields.institution)
            ? ["institution"]
            : []),
        "title",
        "year",
      ];
    case "patent":
      return ["title", "year", "patent"];
    case "webpage":
      return ["title", "url"];
    default:
      return ["title"];
  }
}

export function fieldLooksPresentInFormatted(
  field: string,
  value: TruthFieldValue | undefined,
  formatted: string,
): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => fieldLooksPresentInFormatted(field, entry, formatted));
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return formatted.includes(String(value));
  }
  if (typeof value !== "string") return false;

  switch (field) {
    case "doi":
    case "pmid":
    case "arxiv":
    case "isbn":
    case "issn":
    case "handle":
    case "patent": {
      const normalized = normalizeIdentifierForField(
        field as "doi" | "pmid" | "arxiv" | "isbn" | "issn" | "handle" | "patent",
        value,
      );
      if (!normalized) return false;
      const normalizedFormatted = normalizeSoftText(formatted);
      const normalizedIdentifier = normalizeSoftText(normalized);
      if (normalizedFormatted.includes(normalizedIdentifier)) {
        return true;
      }
      return normalizeCompactIdentifier(formatted).includes(normalizeCompactIdentifier(normalized));
    }
    case "venue":
    case "journal/venue":
      return normalizeSoftText(formatted).includes(normalizeSoftText(value));
    default:
      return normalizeSoftText(formatted).includes(normalizeSoftText(value));
  }
}

function hasComparableBenchmarkValue(value: TruthFieldValue | undefined): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => hasComparableBenchmarkValue(entry));
  }
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function setCanonicalBenchmarkField(
  target: Record<string, TruthFieldValue | undefined>,
  field: string,
  value: TruthFieldValue | undefined,
): void {
  if (!hasComparableBenchmarkValue(value)) {
    return;
  }

  const canonicalField = canonicalizeBenchmarkFieldName(field);
  if (canonicalField === "journal/venue" && hasComparableBenchmarkValue(target["journal/venue"])) {
    return;
  }
  target[canonicalField] = value;
}
