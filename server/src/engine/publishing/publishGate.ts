import type { StyleProfileId } from "../styleProfiles.js";

export type PublishGateStatus = "publishable" | "blocked";

export interface GoldenExampleCheck {
  name: string;
  passed: boolean;
  failureMode?: string;
}

export interface PublishGateInput {
  changedStyles: StyleProfileId[];
  goldenExamples: GoldenExampleCheck[];
  criticalFailures: string[];
  reviewedOutputDiffs: boolean;
  previousStableVersion?: string | null;
}

export interface PublishGateResult {
  status: PublishGateStatus;
  reasons: string[];
  rollbackAvailable: boolean;
}

export function evaluatePublishGate(
  input: PublishGateInput,
): PublishGateResult {
  const reasons: string[] = [];
  const failedGoldenExamples = input.goldenExamples.filter(
    (example) => !example.passed,
  );

  if (failedGoldenExamples.length > 0) {
    reasons.push(
      `golden_examples_failed:${failedGoldenExamples
        .map((example) => example.failureMode ?? example.name)
        .join(",")}`,
    );
  }

  if (input.criticalFailures.length > 0) {
    reasons.push(`critical_failures:${input.criticalFailures.join(",")}`);
  }

  if (input.changedStyles.length > 0 && !input.reviewedOutputDiffs) {
    reasons.push(
      `output_diff_review_required:${input.changedStyles.join(",")}`,
    );
  }

  return {
    status: reasons.length === 0 ? "publishable" : "blocked",
    reasons,
    rollbackAvailable: Boolean(input.previousStableVersion),
  };
}
