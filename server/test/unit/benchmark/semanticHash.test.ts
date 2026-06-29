import { describe, expect, it } from "vitest";

import { computeBenchmarkSemanticOutputSummary } from "../../../src/benchmark/semanticHash.js";
import type { BenchmarkPredictionRow } from "../../../src/benchmark/types.js";

describe("benchmark semantic output hash", () => {
  it("ignores timing-only differences and row order", () => {
    const left: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        citation_style: "apa7",
        reference_type: "article-journal",
        formatted_hash: "hash-1",
        fields: {
          title: "Example title",
          year: 2020,
        },
        output_latency_ms: 10,
        duration_ms: 12,
        warnings: [],
      },
      {
        record_id: "r2",
        variant_id: "r2:apa7:clean",
        citation_style: "apa7",
        reference_type: "book",
        formatted_hash: "hash-2",
        fields: {
          title: "Example book",
        },
        output_latency_ms: 30,
        duration_ms: 40,
        warnings: ["needs_review"],
      },
    ];
    const right: BenchmarkPredictionRow[] = [
      {
        ...left[1]!,
        output_latency_ms: 1,
        duration_ms: 2,
      },
      {
        ...left[0]!,
        output_latency_ms: 99,
        duration_ms: 101,
      },
    ];

    expect(computeBenchmarkSemanticOutputSummary(left).semanticOutputHash).toBe(
      computeBenchmarkSemanticOutputSummary(right).semanticOutputHash,
    );
    expect(computeBenchmarkSemanticOutputSummary(left).fieldHash).toBe(
      computeBenchmarkSemanticOutputSummary(right).fieldHash,
    );
    expect(computeBenchmarkSemanticOutputSummary(left).contractHash).toBe(
      computeBenchmarkSemanticOutputSummary(right).contractHash,
    );
  });

  it("changes when semantic prediction content changes", () => {
    const baseline: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        citation_style: "apa7",
        reference_type: "article-journal",
        formatted_hash: "hash-1",
        fields: {
          title: "Example title",
        },
        output_latency_ms: 10,
        duration_ms: 12,
        warnings: [],
      },
    ];
    const changed: BenchmarkPredictionRow[] = [
      {
        ...baseline[0]!,
        fields: {
          title: "Changed title",
        },
      },
    ];

    expect(computeBenchmarkSemanticOutputSummary(baseline).semanticOutputHash).not.toBe(
      computeBenchmarkSemanticOutputSummary(changed).semanticOutputHash,
    );
    expect(computeBenchmarkSemanticOutputSummary(baseline).fieldHash).not.toBe(
      computeBenchmarkSemanticOutputSummary(changed).fieldHash,
    );
  });

  it("keeps field hashes stable while contract hashes change for reliability-state drift", () => {
    const baseline: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        citation_style: "apa7",
        reference_type: "article-journal",
        formatted_hash: "hash-1",
        fields: {
          title: "Example title",
        },
        parse_outcome: "high_confidence_parse",
        public_status: "ready",
        output_latency_ms: 10,
        duration_ms: 12,
        warnings: [],
      },
    ];
    const changed: BenchmarkPredictionRow[] = [
      {
        ...baseline[0]!,
        parse_outcome: "partial_parse_with_abstentions",
        public_status: "needs_review",
        abstained_fields: ["title"],
      },
    ];

    expect(computeBenchmarkSemanticOutputSummary(baseline).fieldHash).toBe(
      computeBenchmarkSemanticOutputSummary(changed).fieldHash,
    );
    expect(computeBenchmarkSemanticOutputSummary(baseline).contractHash).not.toBe(
      computeBenchmarkSemanticOutputSummary(changed).contractHash,
    );
  });
});
