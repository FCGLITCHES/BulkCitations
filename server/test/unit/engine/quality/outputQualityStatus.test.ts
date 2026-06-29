import { describe, expect, it } from "vitest";
import { resolveOutputQualityStatus } from "../../../../src/engine/quality/outputQualityStatus.js";

describe("output quality status", () => {
  it("keeps one shared ready/repaired/review/abstain/fail status model", () => {
    expect(resolveOutputQualityStatus({ confidence: 0.95 })).toEqual({
      status: "ready",
      reasonCodes: [],
    });
    expect(
      resolveOutputQualityStatus({ wasRepaired: true, confidence: 0.9 }),
    ).toEqual({
      status: "repaired",
      reasonCodes: [],
    });
    expect(resolveOutputQualityStatus({ confidence: 0.4 })).toEqual({
      status: "needs_review",
      reasonCodes: ["low_confidence"],
    });
    expect(resolveOutputQualityStatus({ abstained: true })).toEqual({
      status: "abstained",
      reasonCodes: [],
    });
    expect(resolveOutputQualityStatus({ hasCriticalFailure: true })).toEqual({
      status: "failed",
      reasonCodes: ["critical_failure"],
    });
  });
});
