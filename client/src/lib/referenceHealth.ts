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
  clusters?: Cluster[]
): HealthSignals {
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
  const hardReasons: string[] = [];
  const softReasons: string[] = [];
  const profile = getFallbackRequirementProfile(ref.referenceType);

  const missingRequiredFields = profile.required.filter((field) => !hasParsedField(parsed, field));
  const missingReviewFields = profile.reviewIfMissing.filter((field) => !hasParsedField(parsed, field));
  const hasErrorWarning = warnings.some((w) => w.startsWith("error:"));
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
  const missingPublisherForBook =
    ref.referenceType === "book" && !parsed.publisher;
  const noVenueForStructuredType =
    (ref.referenceType === "journal" || ref.referenceType === "conference") && !hasVenue(parsed);
  const malformedAuthorShape = hasMalformedAuthorShape(parsed);
  const placeholderFields = hasPlaceholderFields(parsed);

  if (missingRequiredFields.includes("authors")) hardReasons.push("Missing author");
  if (missingRequiredFields.includes("year")) hardReasons.push("Missing year");
  if (missingRequiredFields.includes("title")) hardReasons.push("Missing title");
  if (missingRequiredFields.includes("publisher")) hardReasons.push("Missing publisher");
  if (missingRequiredFields.includes("institution")) hardReasons.push("Missing institution");
  if (missingRequiredFields.includes("url")) hardReasons.push("Missing URL");
  if (malformedAuthorShape) hardReasons.push("Author parsing looks malformed");
  if (missingRequiredFields.includes("venue") && mediumLowConfidence) {
    hardReasons.push("Missing required venue");
  }
  if (veryLowConfidence) hardReasons.push("Very low-confidence parse");
  if (styleFailed) softReasons.push("Auto-detect uncertain; style fell back to best-guess");
  if (hasErrorWarning) hardReasons.push("Critical formatting or parsing errors");

  if (!missingRequiredFields.includes("year") && mediumLowConfidence && !veryLowConfidence) {
    softReasons.push("Moderate confidence — a quick review is suggested");
  }
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

  if (hardReasons.length > 0) {
    state = "action_needed";
    reasons.push(...new Set([...hardReasons, ...softReasons]));
  } else if (softReasons.length > 0) {
    state = "review";
    reasons.push(...new Set(softReasons));
  } else {
    state = "clean";
  }

  return { state, reasons };
}

