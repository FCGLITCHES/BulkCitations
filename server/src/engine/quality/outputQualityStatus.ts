export const OUTPUT_QUALITY_STATUSES = [
  "ready",
  "repaired",
  "needs_review",
  "abstained",
  "failed",
] as const;

export type OutputQualityStatus = (typeof OUTPUT_QUALITY_STATUSES)[number];

export const OUTPUT_QUALITY_REASON_CODES = [
  "missing_doi",
  "missing_required_field",
  "title_conflict",
  "ambiguous_authors",
  "duplicate_candidate",
  "style_render_issue",
  "low_confidence",
  "critical_failure",
] as const;

export type OutputQualityReasonCode =
  (typeof OUTPUT_QUALITY_REASON_CODES)[number];

export interface OutputQualityInput {
  hasCriticalFailure?: boolean;
  wasRepaired?: boolean;
  abstained?: boolean;
  needsReview?: boolean;
  confidence?: number;
  reasonCodes?: OutputQualityReasonCode[];
}

export interface OutputQualityDecision {
  status: OutputQualityStatus;
  reasonCodes: OutputQualityReasonCode[];
}

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export function resolveOutputQualityStatus(
  input: OutputQualityInput,
): OutputQualityDecision {
  const reasonCodes = new Set(input.reasonCodes ?? []);
  const confidence = input.confidence;

  if (input.hasCriticalFailure) {
    reasonCodes.add("critical_failure");
    return { status: "failed", reasonCodes: [...reasonCodes] };
  }

  if (input.abstained) {
    return { status: "abstained", reasonCodes: [...reasonCodes] };
  }

  if (typeof confidence === "number" && confidence < LOW_CONFIDENCE_THRESHOLD) {
    reasonCodes.add("low_confidence");
  }

  if (input.needsReview || reasonCodes.has("low_confidence")) {
    return { status: "needs_review", reasonCodes: [...reasonCodes] };
  }

  if (input.wasRepaired) {
    return { status: "repaired", reasonCodes: [...reasonCodes] };
  }

  return { status: "ready", reasonCodes: [...reasonCodes] };
}
