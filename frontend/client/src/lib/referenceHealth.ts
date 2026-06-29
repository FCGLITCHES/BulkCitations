import {
  getProtectedContainerCorruptionReasons,
  getProtectedTitleCorruptionReasons,
  hasInventedPlaceholderVenue,
  hasMalformedAuthorShape,
  hasPlaceholderFieldValue,
} from "@shared/referenceHealthHeuristics";
import { CONFIDENCE_THRESHOLDS } from "@shared/confidenceThresholds";
import type { Cluster, ConvertedReference, HealthState, ReferenceType } from "./types";

type HealthSignals = {
  state: HealthState;
  reasons: string[];
};

function formatFieldLabel(field: string) {
  switch (field) {
    case "authors": return "author";
    case "title": return "title";
    case "year": return "year";
    case "publisher": return "publisher";
    case "venue": return "venue / journal";
    case "locator": return "page number or article number";
    case "bookTitle": return "book title";
    case "institution": return "institution";
    case "url": return "URL";
    case "volume": return "volume";
    case "issue": return "issue";
    default: return field;
  }
}

function getMissingRequiredFieldReason(field: string) {
  return `Required field missing: ${formatFieldLabel(field)}`;
}

function getMissingReviewFieldReason(field: string) {
  return `Review suggested: ${formatFieldLabel(field)} is missing or incomplete`;
}

function getPlaceholderFieldReasons(parsed: any) {
  const reasons: string[] = [];
  const placeholderChecks: Array<[string, unknown]> = [
    ["journal", parsed?.journal],
    ["volume", parsed?.volume],
    ["issue", parsed?.issue],
  ];

  for (const [field, value] of placeholderChecks) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized && hasPlaceholderFieldValue(normalized)) {
      reasons.push(`Placeholder value detected in ${formatFieldLabel(field)}`);
    }
  }

  return reasons;
}

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
      return { required: ["authors", "title", "year", "venue"], reviewIfMissing: [] as string[] };
    case "bookChapter":
      return { required: ["authors", "title", "year", "bookTitle"], reviewIfMissing: [] as string[] };
    case "website":
      return { required: ["title", "url"], reviewIfMissing: [] as string[] };
    case "report":
      return { required: ["title", "year"], reviewIfMissing: [] as string[] };
    case "thesis":
      return { required: ["authors", "title", "year", "institution"], reviewIfMissing: [] as string[] };
    case "journal":
    default:
      return { required: ["authors", "title", "year", "venue"], reviewIfMissing: [] as string[] };
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

function getMissingLocatorReason(originalText: string) {
  const raw = String(originalText ?? "");
  if (/\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d+/i.test(raw) || /\barticle\s+[A-Z]?\d+/i.test(raw)) {
    return "Article number shown in the original input is missing in the output";
  }
  if (/\bp+\.\s*[A-Z]?\d+/i.test(raw) || /\bpp+\.\s*[A-Z]?\d+/i.test(raw) || /\b:\s*[A-Z]?\d+(?:[-–][A-Z]?\d+)?\b/.test(raw)) {
    return "Page number shown in the original input is missing in the output";
  }
  return "Locator shown in the original input is missing in the output";
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
  const hasLocatorWarning = warningCodes.includes("locator_missing_from_source");
  const hasReviewWarning = warningCodes.some((code) => [
    "placeholder_volume",
    "placeholder_journal",
    "venue_missing_for_conference",
    "missing_field",
    "missing_locator",
    "render_output_empty_or_invalid",
  ].includes(code));
  const veryLowConfidence = (ref.confidence?.score ?? 100) <= CONFIDENCE_THRESHOLDS.lowReview;
  const mediumLowConfidence = (ref.confidence?.score ?? 100) <= CONFIDENCE_THRESHOLDS.review;
  const styleFailed = !!ref.styleDetectionFailed;
  const missingPublisherForBook = ref.referenceType === "book" && !parsed.publisher;
  const noVenueForStructuredType =
    (ref.referenceType === "journal" || ref.referenceType === "conference") && !hasVenue(parsed);
  const malformedAuthorShape = hasMalformedAuthorShape(parsed.authors);
  const placeholderFields = hasPlaceholderFields(parsed);
  const hasConcreteReviewSignal =
    hasReviewWarning
    || missingRequiredFields.length > 0
    || missingReviewFields.length > 0
    || styleFailed
    || placeholderFields
    || noVenueForStructuredType;

  if (malformedAuthorShape) {
    actionReasons.push("Author names were parsed in an unstable format");
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
  if (hasLocatorWarning) {
    actionReasons.push(getMissingLocatorReason(ref.originalText));
  }

  if (styleFailed) {
    softReasons.push("Style detection failed on the first pass; review the detected source style");
  }
  if (hasErrorWarning && actionReasons.length === 0) {
    softReasons.push("Critical formatting or parsing errors");
  }
  if (veryLowConfidence) {
    softReasons.push("Very low-confidence parse");
  } else if (
    !missingRequiredFields.includes("year")
    && mediumLowConfidence
    && hasConcreteReviewSignal
  ) {
    softReasons.push("Moderate confidence - a quick review is suggested");
  }
  for (const field of missingRequiredFields) {
    softReasons.push(getMissingRequiredFieldReason(field));
  }
  if (hasReviewWarning && !hasLocatorWarning) {
    softReasons.push("Style or formatting warnings present");
  }
  if (missingPublisherForBook) {
    softReasons.push("Required field missing: publisher");
  }
  if (placeholderFields) {
    softReasons.push(...getPlaceholderFieldReasons(parsed));
  }
  for (const field of missingReviewFields) {
    if (field === "locator" && !mediumLowConfidence) continue;
    softReasons.push(getMissingReviewFieldReason(field));
  }
  if (noVenueForStructuredType && mediumLowConfidence) {
    softReasons.push("Review suggested: venue / journal is missing from the parsed result");
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
