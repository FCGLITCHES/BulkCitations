import { describe, expect, it } from "vitest";
import { calculateConfidence } from "../shared/confidence";
import type { AuthorityData, ParsedReference } from "../shared/schema";

describe("calculateConfidence", () => {
  it("ignores authority metadata when computing the score", () => {
    const parsed: ParsedReference = {
      authors: ["Kelly, C. J.", "Karthikesalingam, A."],
      title: "Key challenges for delivering clinical impact with artificial intelligence",
      year: "2019",
      journal: "BMC Medicine",
      volume: "17",
      issue: "1",
    };
    const authority: AuthorityData = {
      title: "Completely different metadata",
      authors: ["Wrong, A."],
      journal: "Other Journal",
      year: "2020",
    };

    const firstPass = calculateConfidence(parsed, 62);
    const recheck = calculateConfidence(parsed, 62, authority);

    expect(firstPass).toEqual(recheck);
    expect(recheck.score).toBe(62);
    expect(recheck.breakdown).toEqual({ rules: 62 });
  });
});
