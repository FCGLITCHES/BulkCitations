import { describe, expect, it } from "vitest";
import { evaluatePublishGate } from "../../../../src/engine/publishing/publishGate.js";

describe("publish gate", () => {
  it("allows fast publish when golden examples pass and changed style diffs were reviewed", () => {
    expect(
      evaluatePublishGate({
        changedStyles: ["apa7"],
        goldenExamples: [{ name: "apa7_article_doi_render", passed: true }],
        criticalFailures: [],
        reviewedOutputDiffs: true,
        previousStableVersion: "engine-2026-06-01",
      }),
    ).toEqual({
      status: "publishable",
      reasons: [],
      rollbackAvailable: true,
    });
  });

  it("blocks publish on failed goldens, critical failures, or unreviewed style diffs", () => {
    const result = evaluatePublishGate({
      changedStyles: ["apa7", "mla9"],
      goldenExamples: [
        {
          name: "apa7_article_doi_render",
          passed: false,
          failureMode: "apa7_article_required_fields",
        },
      ],
      criticalFailures: ["renderer_exception"],
      reviewedOutputDiffs: false,
      previousStableVersion: null,
    });

    expect(result).toEqual({
      status: "blocked",
      reasons: [
        "golden_examples_failed:apa7_article_required_fields",
        "critical_failures:renderer_exception",
        "output_diff_review_required:apa7,mla9",
      ],
      rollbackAvailable: false,
    });
  });
});
