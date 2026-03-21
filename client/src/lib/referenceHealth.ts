import {
  getProtectedContainerCorruptionReasons,
  getProtectedTitleCorruptionReasons,
  hasInventedPlaceholderVenue,
  hasMalformedAuthorShape,
  hasPlaceholderFieldValue,
} from "@shared/referenceHealthHeuristics";
import type { Cluster, ConvertedReference, HealthState, ReferenceType } from "./types";

type HealthSignals = {
  state: HealthState;
  reasons: string[];
};

function hasVenue(parsed: any) {
  return !!(parsed?.journal || parsed?.conferenceTitle || parsed?.bookTitle);
}

function hasPlaceholderFields(parsed: any) {
  const suspectValues = [parsed?.journal, parsed?.volume, parsed?.issue]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return suspectValues.some((value) => hasPlaceholderFieldValue(value));
}

function getFallbackRequirementProfile(type: ReferenceType) {
  switch (type) {
    case "book":
      return { required: ["authors", "title", "year", "publisher"], reviewIfMissing: [] as string[] };
    case "conference":
      return { required: ["authors", "title", "year", "venue"], reviewIfMissing: ["locator"] };
    case "bookChapter":
      return { required: ["authors", "title", "year", "bookTitle"], reviewIfMissing: ["locator", "publisher"] };
    case "website":
      return { required: ["title", "url"], reviewIfMissing: ["authors", "year"] };
    case "report":
      return { required: ["title", "year"], reviewIfMissing: ["authors", "institution"] };
    case "thesis":
      return { required: ["authors", "title", "year", "institution"], reviewIfMissing: [] as string[] };
    case "journal":
    default:
      return { required: ["authors", "title", "year", "venue"], reviewIfMissing: ["volume", "issue", "locator"] };
  }
}

function parseWarningCode(warning: string) {
  const match = warning.match(/^(?:warning|error):\s*([a-z0-9_.-]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function hasParsedField(parsed: any, field: string) {
  switch (field) {
    case "authors":
      return Array.isArray(parsed?.authors) && parsed.authors.length > 0;
    case "title":
      return !!parsed?.title;
    case "year":
      return !!parsed?.year;
    case "publisher":
      return !!parsed?.publisher;
    case "venue":
      return hasVenue(parsed);
    case "locator":
      return !!(parsed?.pages || parsed?.["article-number"]);
    case "bookTitle":
      return !!parsed?.bookTitle;
    case "institution":
      return !!parsed?.institution;
    case "url":
      return !!parsed?.url;
    case "volume":
      return !!parsed?.volume;
    case "issue":
      return !!parsed?.issue;
    default:
      return false;
  }
}

export function computeReferenceHealth(
  ref: ConvertedReference,
  clusters?: Cluster[],
): HealthSignals {
  void clusters;

  if (ref.healthState) {
    return {
      state: ref.healthState,
      reasons: ref.healthReasons ?? [],
    };
  }

  const parsed = ref.parsedData ?? {};
  const warnings = ref.warnings ?? [];
  const warningCodes = warnings.map(parseWarningCode).filter((code): code is string => Boolean(code));
  const reasons: string[] = [];
  const actionReasons: string[] = [];
  const softReasons: string[] = [];
  const profile = getFallbackRequirementProfile(ref.referenceType);

  const missingRequiredFields = profile.required.filter((field) => !hasParsedField(parsed, field));
  const missingReviewFields = profile.reviewIfMissing.filter((field) => !hasParsedField(parsed, field));
  const hasErrorWarning = warnings.some((warning) => warning.startsWith("error:"));
  const hasReviewWarning = warningCodes.some((code) => [
    "placeholder_volume",
    "placeholder_journal",
    "venue_missing_for_conference",
    "locator_missing_from_source",
    "missing_field",
    "missing_locator",
    "render_output_empty_or_invalid",
  ].includes(code));
  const veryLowConfidence = (ref.confidence?.score ?? 100) < 40;
  const mediumLowConfidence = (ref.confidence?.score ?? 100) < 70;
  const styleFailed = !!ref.styleDetectionFailed;
  const missingPublisherForBook = ref.referenceType === "book" && !parsed.publisher;
  const noVenueForStructuredType =
    (ref.referenceType === "journal" || ref.referenceType === "conference") && !hasVenue(parsed);
  const malformedAuthorShape = hasMalformedAuthorShape(parsed.authors);
  const placeholderFields = hasPlaceholderFields(parsed);

  if (malformedAuthorShape) {
    actionReasons.push("Author parsing looks malformed");
  }
  if (hasInventedPlaceholderVenue(parsed, ref.originalText)) {
    actionReasons.push("Placeholder venue text appears to have been invented by the parser");
  }
  actionReasons.push(...getProtectedTitleCorruptionReasons(ref.originalText, parsed.title));
  actionReasons.push(...getProtectedContainerCorruptionReasons(ref.originalText, parsed));
  if (warningCodes.includes("connector_as_author")) {
    actionReasons.push("A conjunction token was parsed as an author");
  }
  if (warningCodes.includes("author_structure_unstable")) {
    actionReasons.push("Author structure still looks unstable");
  }
  if (warningCodes.includes("initials_as_surname")) {
    actionReasons.push("An author surname field contains initials only");
  }
  if (warningCodes.includes("locator_missing_from_source")) {
    actionReasons.push("A locator present in the source was not preserved");
  }

  if (styleFailed) {
    softReasons.push("Auto-detect uncertain; style fell back to best-guess");
  }
  if (hasErrorWarning && actionReasons.length === 0) {
    softReasons.push("Critical formatting or parsing errors");
  }
  if (veryLowConfidence) {
    softReasons.push("Very low-confidence parse");
  } else if (!missingRequiredFields.includes("year") && mediumLowConfidence) {
    softReasons.push("Moderate confidence - a quick review is suggested");
  }
  if (missingRequiredFields.includes("authors")) softReasons.push("Missing author");
  if (missingRequiredFields.includes("year")) softReasons.push("Missing year");
  if (missingRequiredFields.includes("title")) softReasons.push("Missing title");
  if (missingRequiredFields.includes("publisher")) softReasons.push("Missing publisher");
  if (missingRequiredFields.includes("institution")) softReasons.push("Missing institution");
  if (missingRequiredFields.includes("url")) softReasons.push("Missing URL");
  if (missingRequiredFields.includes("venue")) softReasons.push("Missing required venue");
  if (hasReviewWarning) {
    softReasons.push("Style or formatting warnings present");
  }
  if (missingPublisherForBook) {
    softReasons.push("Book publisher missing");
  }
  if (placeholderFields) {
    softReasons.push("Placeholder or suspicious venue fields present");
  }
  if (missingReviewFields.includes("authors")) {
    softReasons.push("Author information may be missing");
  }
  if (missingReviewFields.includes("year")) {
    softReasons.push("Year information may be missing");
  }
  if (missingReviewFields.includes("locator") && mediumLowConfidence) {
    softReasons.push("Locator information may be missing");
  }
  if (noVenueForStructuredType && mediumLowConfidence) {
    softReasons.push("Expected venue information is missing");
  }

  let state: HealthState;

  if (actionReasons.length > 0) {
    state = "action_needed";
    reasons.push(...new Set([...actionReasons, ...softReasons]));
  } else if (softReasons.length > 0) {
    state = "review";
    reasons.push(...new Set(softReasons));
  } else {
    state = "clean";
  }

  return { state, reasons };
}
