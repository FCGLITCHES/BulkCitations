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
  const unclearSourceType =
    (isJournalLike(ref.referenceType, parsed) || isConferenceLike(ref.referenceType, parsed)) &&
    !parsed.journal &&
    !parsed.conferenceTitle;
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

  if (missingAuthors) hardReasons.push("Missing author");
  if (missingYear) hardReasons.push("Missing year");
  if (unclearSourceType || noVenueForStructuredType) {
    hardReasons.push("Unclear source type or missing venue");
  }
  if (veryLowConfidence) hardReasons.push("Very low-confidence parse");
  if (styleFailed) hardReasons.push("Auto-detect uncertain; style fell back to best-guess");
  if (isOtherType) hardReasons.push("Source type unclear (classified as Other)");
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

