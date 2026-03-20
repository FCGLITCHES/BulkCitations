import type { Cluster, ConvertedReference, HealthState, ReferenceType } from "./types";

type HealthSignals = {
  state: HealthState;
  reasons: string[];
};

function isJournalLike(type: ReferenceType, parsed: any) {
  return type === "journal" || !!parsed?.journal;
}

function isConferenceLike(type: ReferenceType, parsed: any) {
  return type === "conference" || !!parsed?.conferenceTitle;
}

function hasVenue(parsed: any) {
  return !!(parsed?.journal || parsed?.conferenceTitle || parsed?.bookTitle);
}

function hasMalformedAuthorShape(parsed: any) {
  const authors = Array.isArray(parsed?.authors) ? parsed.authors : [];
  return authors.some((author: string) => {
    const value = String(author ?? "").trim();
    if (!value) return true;
    if (/[,&]\s*&/.test(value) || /\b&\b/.test(value)) return true;
    if (/,\s*[A-Z](?:\s*,\s*[A-Z]){1,}/.test(value)) return true;
    if (/^[A-Z][a-z]+,\s*[A-Z]\s*,\s*[A-Z]/.test(value)) return true;
    if (/^\w+\s+\w+\s+\&/.test(value)) return true;
    return false;
  });
}

function hasPlaceholderFields(parsed: any) {
  const suspectValues = [parsed?.journal, parsed?.volume, parsed?.issue]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return suspectValues.some((value) => value === "vol" || value === "journal" || value === "?" || value === "vol.");
}

export function computeReferenceHealth(
  ref: ConvertedReference,
  clusters?: Cluster[]
): HealthSignals {
  const parsed = ref.parsedData ?? {};
  const warnings = ref.warnings ?? [];
  const reasons: string[] = [];
  const hardReasons: string[] = [];
  const softReasons: string[] = [];

  const missingYear = !parsed.year;
  const missingAuthors = !parsed.authors || parsed.authors.length === 0;
  const hasErrorWarning = warnings.some((w) => w.startsWith("error:"));
  const hasWarningWarning = warnings.some((w) => w.startsWith("warning:"));
  const veryLowConfidence = (ref.confidence?.score ?? 100) < 40;
  const mediumLowConfidence = (ref.confidence?.score ?? 100) < 70;
  const styleFailed = !!ref.styleDetectionFailed;
  const isOtherType = ref.referenceType === "other";
  const missingPublisherForBook =
    ref.referenceType === "book" && !parsed.publisher;
  const noVenueForStructuredType =
    (ref.referenceType === "journal" || ref.referenceType === "conference") && !hasVenue(parsed);
  const malformedAuthorShape = hasMalformedAuthorShape(parsed);
  const placeholderFields = hasPlaceholderFields(parsed);

  if (missingAuthors) hardReasons.push("Missing author");
  if (missingYear) hardReasons.push("Missing year");
  if (malformedAuthorShape) hardReasons.push("Author parsing looks malformed");
  // Do NOT treat unclear source type / missing venue as a hard \"needs fix\" signal.
  // Users can still see when something is classified as Other in the type badge.
  if (veryLowConfidence) hardReasons.push("Very low-confidence parse");
  if (styleFailed) hardReasons.push("Auto-detect uncertain; style fell back to best-guess");
  // Don't escalate \"Other\" into a hard failure; it's informational only.
  if (hasErrorWarning) hardReasons.push("Critical formatting or parsing errors");

  if (!missingYear && mediumLowConfidence && !veryLowConfidence) {
    softReasons.push("Moderate confidence — a quick review is suggested");
  }
  if (!missingPublisherForBook && hasWarningWarning) {
    softReasons.push("Style or formatting warnings present");
  }
  if (missingPublisherForBook) {
    softReasons.push("Book publisher missing");
  }
  if (placeholderFields) {
    softReasons.push("Placeholder or suspicious venue fields present");
  }
  if (noVenueForStructuredType) {
    softReasons.push("Expected venue information is missing");
  }

  let state: HealthState;

  if (hardReasons.length > 0) {
    state = "action_needed";
    reasons.push(...hardReasons, ...softReasons);
  } else if (softReasons.length > 0) {
    state = "review";
    reasons.push(...softReasons);
  } else {
    state = "clean";
  }

  return { state, reasons };
}

