import { describe, expect, it } from "vitest";

import {
  buildBenchmarkExecutionPlan,
  coalesceBenchmarkExecutionGroups,
  groupManifestRows,
  selectWarmupGroups,
} from "../../../src/benchmark/runEngineCore.js";
import type { BenchmarkManifestRow } from "../../../src/benchmark/types.js";
import { resolveBenchmarkRunProfile } from "../../../src/benchmark/runProfile.js";

function createManifestRow(
  variantId: string,
  recordId: string,
  variantKind: "clean" | "noisy",
): BenchmarkManifestRow {
  return {
    record_id: recordId,
    variant_id: variantId,
    variant_kind: variantKind,
    reference_type: "article-journal",
    citation_style: "apa7",
    formatted_string: `${variantId} formatted`,
    formatted_hash: `${variantId}-hash`,
    noise_applied: [],
    source: "unit-test",
    source_url: "https://example.test",
    source_hash: `${variantId}-source-hash`,
    language: "en",
    input_structure: "structured",
    input_source_kind: "typed_manual",
    expected_fields: {},
    required_fields: ["title"],
  };
}

describe("runEngineCore helpers", () => {
  it("groups manifest rows by record id and variant kind while preserving row order", () => {
    const manifest = [
      createManifestRow("row-a-clean-1", "row-a", "clean"),
      createManifestRow("row-a-clean-2", "row-a", "clean"),
      createManifestRow("row-a-noisy-1", "row-a", "noisy"),
      createManifestRow("row-b-clean-1", "row-b", "clean"),
    ];

    const groups = groupManifestRows(manifest);

    expect(groups).toHaveLength(3);
    expect(groups[0]?.map((row) => row.variant_id)).toEqual([
      "row-a-clean-1",
      "row-a-clean-2",
    ]);
    expect(groups[1]?.map((row) => row.variant_id)).toEqual(["row-a-noisy-1"]);
    expect(groups[2]?.map((row) => row.variant_id)).toEqual(["row-b-clean-1"]);
  });

  it("selects deterministic warmup groups by reference budget", () => {
    const groups = [
      [
        createManifestRow("row-a-clean-1", "row-a", "clean"),
        createManifestRow("row-a-clean-2", "row-a", "clean"),
      ],
      [createManifestRow("row-b-clean-1", "row-b", "clean")],
      [
        createManifestRow("row-c-clean-1", "row-c", "clean"),
        createManifestRow("row-c-clean-2", "row-c", "clean"),
        createManifestRow("row-c-clean-3", "row-c", "clean"),
      ],
    ];

    expect(selectWarmupGroups(groups, 0)).toEqual([]);
    expect(selectWarmupGroups(groups, 2).map((group) => group[0]?.record_id)).toEqual(["row-a"]);
    expect(selectWarmupGroups(groups, 3).map((group) => group[0]?.record_id)).toEqual([
      "row-a",
      "row-b",
    ]);
  });

  it("coalesces fast-lane direct benchmark groups into citation-list sized requests", () => {
    const groups = [
      [createManifestRow("row-a-clean-1", "row-a", "clean")],
      [createManifestRow("row-b-clean-1", "row-b", "clean")],
      [
        createManifestRow("row-c-clean-1", "row-c", "clean"),
        createManifestRow("row-c-clean-2", "row-c", "clean"),
      ],
      [createManifestRow("row-d-clean-1", "row-d", "clean")],
    ];
    const runProfile = resolveBenchmarkRunProfile("heuristic-only", "benchmark_5600h");

    try {
      expect(
        coalesceBenchmarkExecutionGroups(groups, {
          runProfile: {
            ...runProfile,
            runtimeTuning: {
              batchSize: 3,
              maxConcurrency: 5,
              fastLaneMulticoreMinRefs: 4,
            },
            multicoreThreshold: 4,
          },
          sourceType: "text",
          parseProfile: "core_parse_fast",
          benchmarkVariant: "grobid_compare",
        }).map((group) => group.map((row) => row.variant_id)),
      ).toEqual([
        ["row-a-clean-1", "row-b-clean-1", "row-c-clean-1", "row-c-clean-2"],
        ["row-d-clean-1"],
      ]);
    } finally {
      runProfile.restoreEnv();
    }
  });

  it("keeps same-record groups together when coalescing fast benchmark execution", () => {
    const groups = [
      [createManifestRow("row-a-clean-1", "row-a", "clean")],
      [createManifestRow("row-b-clean-1", "row-b", "clean")],
      [createManifestRow("row-a-noisy-1", "row-a", "noisy")],
      [createManifestRow("row-c-clean-1", "row-c", "clean")],
    ];
    const runProfile = resolveBenchmarkRunProfile("heuristic-only", "benchmark_5600h");

    try {
      expect(
        coalesceBenchmarkExecutionGroups(groups, {
          runProfile: {
            ...runProfile,
            runtimeTuning: {
              batchSize: 2,
              maxConcurrency: 5,
              fastLaneMulticoreMinRefs: 2,
            },
            multicoreThreshold: 2,
          },
          sourceType: "text",
          parseProfile: "core_parse_fast",
          benchmarkVariant: "grobid_compare",
        }).map((group) => group.map((row) => row.variant_id)),
      ).toEqual([
        ["row-a-clean-1", "row-a-noisy-1"],
        ["row-b-clean-1", "row-c-clean-1"],
      ]);
    } finally {
      runProfile.restoreEnv();
    }
  });

  it("coalesces fast-lane groups for parallel worker execution too", () => {
    const groups = [
      [createManifestRow("row-a-clean-1", "row-a", "clean")],
      [createManifestRow("row-b-clean-1", "row-b", "clean")],
      [createManifestRow("row-a-noisy-1", "row-a", "noisy")],
      [createManifestRow("row-c-clean-1", "row-c", "clean")],
    ];
    const runProfile = resolveBenchmarkRunProfile("heuristic-only", "benchmark_5600h");

    try {
      expect(
        coalesceBenchmarkExecutionGroups(groups, {
          runProfile: {
            ...runProfile,
            runtimeTuning: {
              batchSize: 2,
              maxConcurrency: 5,
              fastLaneMulticoreMinRefs: 2,
            },
            multicoreThreshold: 2,
          },
          sourceType: "text",
          parseProfile: "core_parse_fast",
          benchmarkVariant: "parallel",
        }).map((group) => group.map((row) => row.variant_id)),
      ).toEqual([
        ["row-a-clean-1", "row-a-noisy-1"],
        ["row-b-clean-1", "row-c-clean-1"],
      ]);
      expect(
        coalesceBenchmarkExecutionGroups(groups, {
          runProfile,
          sourceType: "text",
          parseProfile: "core_parse_full",
          benchmarkVariant: "parallel",
        }),
      ).toEqual(groups);
    } finally {
      runProfile.restoreEnv();
    }
  });

  it("keeps parallel fast benchmark groups raw until worker-local execution", () => {
    const groups = [
      [createManifestRow("row-a-clean-1", "row-a", "clean")],
      [createManifestRow("row-b-clean-1", "row-b", "clean")],
      [createManifestRow("row-c-clean-1", "row-c", "clean")],
    ];
    const runProfile = resolveBenchmarkRunProfile("heuristic-only", "benchmark_5600h");

    try {
      const plan = buildBenchmarkExecutionPlan(groups, 2, {
        runProfile: {
          ...runProfile,
          runtimeTuning: {
            batchSize: 2,
            maxConcurrency: 5,
            fastLaneMulticoreMinRefs: 2,
          },
          multicoreThreshold: 2,
        },
        sourceType: "text",
        parseProfile: "core_parse_fast",
        benchmarkVariant: "parallel",
      });

      expect(plan.executionGroups.map((group) => group.map((row) => row.variant_id))).toEqual([
        ["row-a-clean-1"],
        ["row-b-clean-1"],
        ["row-c-clean-1"],
      ]);
      expect(plan.warmupExecutionGroups.map((group) => group.map((row) => row.variant_id))).toEqual([
        ["row-a-clean-1"],
        ["row-b-clean-1"],
      ]);
    } finally {
      runProfile.restoreEnv();
    }
  });

  it("uses the same coalesced execution plan for warmup and direct benchmark runs", () => {
    const groups = [
      [createManifestRow("row-a-clean-1", "row-a", "clean")],
      [createManifestRow("row-b-clean-1", "row-b", "clean")],
      [
        createManifestRow("row-c-clean-1", "row-c", "clean"),
        createManifestRow("row-c-clean-2", "row-c", "clean"),
      ],
      [createManifestRow("row-d-clean-1", "row-d", "clean")],
    ];
    const runProfile = resolveBenchmarkRunProfile("heuristic-only", "benchmark_5600h");

    try {
      const plan = buildBenchmarkExecutionPlan(groups, 3, {
        runProfile: {
          ...runProfile,
          runtimeTuning: {
            batchSize: 3,
            maxConcurrency: 5,
            fastLaneMulticoreMinRefs: 4,
          },
          multicoreThreshold: 4,
        },
        sourceType: "text",
        parseProfile: "core_parse_fast",
        benchmarkVariant: "grobid_compare",
      });

      expect(plan.executionGroups.map((group) => group.map((row) => row.variant_id))).toEqual([
        ["row-a-clean-1", "row-b-clean-1", "row-c-clean-1", "row-c-clean-2"],
        ["row-d-clean-1"],
      ]);
      expect(plan.warmupExecutionGroups.map((group) => group.map((row) => row.variant_id))).toEqual([
        ["row-a-clean-1", "row-b-clean-1", "row-c-clean-1", "row-c-clean-2"],
      ]);
    } finally {
      runProfile.restoreEnv();
    }
  });
});
