import { createHash } from "node:crypto";

import type {
  BenchmarkManifestRow,
  BenchmarkPredictionRow,
  BenchmarkReferenceType,
} from "./types.js";
import type { TruthFieldValue } from "../training/truthFields.js";

const SHARED_ALLOWED_FIELDS = [
  "authors",
  "title",
  "year",
  "doi",
  "url",
];
const CONFERENCE_DOI_REGEX =
  /\b10\.(?:14209\/sbrt\.|21009\/03\.|14293\/s2199-ssp-|2991\/assehr\.|37702\/2175-957x\.cobenge\.|1049\/cp\.|47696\/adved\.)/iu;

const TYPE_ALLOWED_FIELDS: Record<BenchmarkReferenceType | "unknown", string[]> = {
  "article-journal": [...SHARED_ALLOWED_FIELDS, "journal/venue", "volume", "issue", "pages", "issn", "pmid"],
  "conference-paper": [...SHARED_ALLOWED_FIELDS, "conferenceTitle", "pages", "isbn", "publisher", "editors"],
  book: [...SHARED_ALLOWED_FIELDS, "publisher", "isbn", "edition", "placeOfPublication", "editors"],
  "book-chapter": [
    ...SHARED_ALLOWED_FIELDS,
    "bookTitle",
    "pages",
    "isbn",
    "publisher",
    "editors",
    "edition",
    "placeOfPublication",
  ],
  preprint: [...SHARED_ALLOWED_FIELDS, "repository", "arxiv", "articleNumber"],
  thesis: [...SHARED_ALLOWED_FIELDS, "institution", "thesisType", "handle"],
  report: [...SHARED_ALLOWED_FIELDS, "institution", "reportNumber", "issn", "isbn"],
  patent: [...SHARED_ALLOWED_FIELDS, "patent", "placeOfPublication"],
  webpage: [...SHARED_ALLOWED_FIELDS, "institution", "siteName", "accessedDate"],
  unknown: [...SHARED_ALLOWED_FIELDS],
};

export function hashBenchmarkFormattedString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function assertManifestFormattedAlignment(
  manifest: BenchmarkManifestRow[],
  formattedStrings: string[],
): void {
  if (manifest.length !== formattedStrings.length) {
    throw new Error(
      `Benchmark alignment mismatch: ${manifest.length} manifest rows vs ${formattedStrings.length} formatted lines.`,
    );
  }

  const mismatches: string[] = [];
  for (let index = 0; index < manifest.length; index += 1) {
    const row = manifest[index]!;
    const formatted = formattedStrings[index]!;
    if (row.formatted_string !== formatted) {
      mismatches.push(`${index}:${row.variant_id}`);
    }
    if (row.formatted_hash !== hashBenchmarkFormattedString(row.formatted_string)) {
      mismatches.push(`${index}:${row.variant_id}:hash`);
    }
    if (mismatches.length >= 5) break;
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Benchmark alignment invariant failed for ${mismatches.join(", ")}.`,
    );
  }
}

export function filterPredictionFieldsByType(
  referenceType: string,
  rawFields: Record<string, TruthFieldValue>,
): {
  fields: Record<string, TruthFieldValue>;
  strippedFields: string[];
} {
  const normalizedType = normalizePredictionType(referenceType);
  const allowed = new Set(TYPE_ALLOWED_FIELDS[normalizedType]);
  const normalizedFields = normalizePredictionFieldsForBenchmark(normalizedType, rawFields);
  const fields: Record<string, TruthFieldValue> = {};
  const strippedFields: string[] = [];

  for (const [field, value] of Object.entries(normalizedFields)) {
    if (allowed.has(field)) {
      fields[field] = value;
    } else if (hasComparableValue(value)) {
      strippedFields.push(field);
    }
  }

  return { fields, strippedFields: strippedFields.sort((left, right) => left.localeCompare(right)) };
}

export function allowedPredictionFieldsForType(referenceType: string): string[] {
  return [...TYPE_ALLOWED_FIELDS[normalizePredictionType(referenceType)]];
}

export function countUnsupportedPredictedFields(prediction: BenchmarkPredictionRow | undefined): number {
  return prediction?.adapter_stripped_fields?.length ?? 0;
}

function normalizePredictionType(referenceType: string): BenchmarkReferenceType | "unknown" {
  switch (referenceType) {
    case "article-journal":
    case "conference-paper":
    case "book":
    case "book-chapter":
    case "preprint":
    case "thesis":
    case "report":
    case "patent":
    case "webpage":
      return referenceType;
    default:
      return "unknown";
  }
}

function hasComparableValue(value: TruthFieldValue | undefined): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => hasComparableValue(entry));
  }
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function normalizePredictionFieldsForBenchmark(
  referenceType: BenchmarkReferenceType | "unknown",
  rawFields: Record<string, TruthFieldValue>,
): Record<string, TruthFieldValue> {
  const fields = { ...rawFields };

  const journalValue = fields.journal;
  if (
    referenceType === "article-journal"
    && !hasComparableValue(fields.venue)
    && !hasComparableValue(fields["journal/venue"])
    && journalValue !== undefined
    && hasComparableValue(journalValue)
  ) {
    fields["journal/venue"] = journalValue;
  }
  if (referenceType === "article-journal") {
    delete fields.journal;
    delete fields.venue;
  }

  if (referenceType === "conference-paper" && !hasComparableValue(fields.publisher)) {
    const institution = fields.institution;
    if (institution !== undefined && hasComparableValue(institution)) {
      fields.publisher = institution;
    }
  }

  if (
    referenceType === "conference-paper"
    && !hasComparableValue(fields.conferenceTitle)
    && typeof fields.publisher === "string"
    && shouldBackfillConferenceTitleFromPublisher(fields.publisher, fields.doi)
  ) {
    fields.conferenceTitle = fields.publisher;
  }

  return fields;
}

function shouldBackfillConferenceTitleFromPublisher(
  publisher: string,
  doi: TruthFieldValue | undefined,
): boolean {
  const normalizedPublisher = publisher.trim();
  if (normalizedPublisher.length === 0) return false;
  if (looksPublisherOnlyValue(normalizedPublisher)) return false;
  if (typeof doi === "string" && CONFERENCE_DOI_REGEX.test(doi)) return true;
  if (
    /\b(?:conference|symposium|workshop|congress|congreso|meeting|proceedings|forum|program review|abstracts publication|anais|jornadas|technical program review)\b/iu.test(
      normalizedPublisher,
    )
  ) {
    return true;
  }
  if (looksProceedingsSeriesPublisher(normalizedPublisher)) {
    return true;
  }
  return false;
}

function looksPublisherOnlyValue(value: string): boolean {
  if (looksInstitutionalAcronymPhrase(value)) return true;
  return /\b(?:press|publishing|publisher|verlag|editores?|editorial|books?|ltd|llc|inc|kg|gmbh|springer|apress|wiley|elsevier|thieme)\b/iu.test(
    value,
  );
}

function looksInstitutionalAcronymPhrase(value: string): boolean {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  return (
    tokens.length >= 2
    && tokens.length <= 4
    && tokens.every((token) => /^[A-Z]{2,6}$/u.test(token))
  );
}

function looksProceedingsSeriesPublisher(value: string): boolean {
  return (
    /^advances in [\p{L}\d,&:/'’(). -]{6,} research$/iu.test(value)
    || /\b(?:aip conference proceedings|ceur workshop proceedings|acm international conference proceeding series|journal of physics: conference series|e3s web of conferences)\b/iu.test(value)
  );
}
