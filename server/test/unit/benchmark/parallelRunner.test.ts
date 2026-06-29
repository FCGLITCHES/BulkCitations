import { describe, expect, it } from "vitest";

import {
  createParallelBenchmarkAssignments,
  distributeParallelWarmupGroups,
  mergeWorkerPredictionChunks,
  resolveParallelWorkerRuntimeTuning,
  shouldUseParallelBenchmarkVariant,
} from "../../../src/benchmark/parallelRunner.js";
import type { BenchmarkManifestRow } from "../../../src/benchmark/types.js";

function createManifestGroup(
  recordId: string,
  size: number,
  options: {
    referenceType?: BenchmarkManifestRow["reference_type"];
  } = {},
): BenchmarkManifestRow[] {
  return Array.from({ length: size }, (_, index) => ({
    record_id: recordId,
    variant_id: `${recordId}-${index}`,
    variant_kind: "clean" as const,
    reference_type: options.referenceType ?? "article-journal",
    citation_style: "apa7" as const,
    formatted_string: `${recordId} ${index}`,
    formatted_hash: `${recordId}-${index}-hash`,
    noise_applied: [],
    source: "unit-test",
    source_url: "https://example.test",
    source_hash: `${recordId}-${index}-source`,
    language: "en",
    input_structure: "structured" as const,
    input_source_kind: "typed_manual" as const,
    expected_fields: {},
    required_fields: ["title"],
  }));
}

describe("parallel benchmark runner helpers", () => {
  it("keeps grouped rows contiguous across workers deterministically", () => {
    const assignments = createParallelBenchmarkAssignments(
      [
        createManifestGroup("group-a", 2),
        createManifestGroup("group-b", 5),
        createManifestGroup("group-c", 3),
        createManifestGroup("group-d", 1),
      ],
      2,
    );

    expect(assignments).toHaveLength(2);
    expect(assignments.map((assignment) => assignment.rowCount)).toEqual([6, 5]);
    expect(assignments[0]?.groups.map((group) => group[0]?.record_id)).toEqual([
      "group-b",
      "group-d",
    ]);
    expect(assignments[1]?.groups.map((group) => group[0]?.record_id)).toEqual([
      "group-a",
      "group-c",
    ]);
  });

  it("keeps all groups for the same record on the same worker", () => {
    const assignments = createParallelBenchmarkAssignments(
      [
        createManifestGroup("record-a", 2),
        createManifestGroup("record-b", 1),
        createManifestGroup("record-a", 3),
        createManifestGroup("record-c", 2),
      ],
      2,
    );

    const workerIdsForRecordA = assignments
      .flatMap((assignment) =>
        assignment.groups
          .filter((group) => group[0]?.record_id === "record-a")
          .map(() => assignment.workerIndex),
      );

    expect(new Set(workerIdsForRecordA)).toEqual(new Set([0]));
    expect(assignments.map((assignment) => assignment.rowCount)).toEqual([5, 3]);
  });

  it("does not merge distinct pre-coalesced chunks that happen to start with the same record", () => {
    const assignments = createParallelBenchmarkAssignments(
      [
        [
          ...createManifestGroup("record-a", 1),
          ...createManifestGroup("record-b", 1),
        ],
        [
          ...createManifestGroup("record-a", 1),
          ...createManifestGroup("record-c", 1),
        ],
      ],
      2,
    );

    expect(assignments).toHaveLength(2);
    expect(assignments.map((assignment) => assignment.rowCount)).toEqual([2, 2]);
    expect(assignments[0]?.groups[0]?.map((row) => row.record_id)).toEqual([
      "record-a",
      "record-b",
    ]);
    expect(assignments[1]?.groups[0]?.map((row) => row.record_id)).toEqual([
      "record-a",
      "record-c",
    ]);
  });

  it("forces worker-local runtime concurrency to one while preserving batch size", () => {
    expect(resolveParallelWorkerRuntimeTuning(null)).toBeNull();
    expect(
      resolveParallelWorkerRuntimeTuning({
        batchSize: 128,
        maxConcurrency: 5,
        fastLaneMulticoreMinRefs: 256,
      }),
    ).toEqual({
      batchSize: 128,
      maxConcurrency: 1,
      fastLaneMulticoreMinRefs: 256,
    });
  });

  it("distributes warmup groups across workers instead of duplicating them", () => {
    const warmupGroups = [
      createManifestGroup("warmup-a", 1),
      createManifestGroup("warmup-b", 1),
      createManifestGroup("warmup-c", 1),
      createManifestGroup("warmup-d", 1),
      createManifestGroup("warmup-e", 1),
    ];

    expect(
      distributeParallelWarmupGroups(warmupGroups, 3).map((bucket) =>
        bucket.map((group) => group[0]?.record_id),
      ),
    ).toEqual([
      ["warmup-a", "warmup-d"],
      ["warmup-b", "warmup-e"],
      ["warmup-c"],
    ]);
  });

  it("merges streamed worker prediction chunks in deterministic chunk order", () => {
    expect(mergeWorkerPredictionChunks([
      {
        chunkIndex: 2,
        predictions: [
          {
            record_id: "record-c",
            variant_id: "record-c:apa7:clean",
            citation_style: "apa7",
            reference_type: "article-journal",
            formatted_hash: "hash-c",
            fields: {},
            output_latency_ms: 3,
            duration_ms: 3,
            warnings: [],
          },
        ],
      },
      {
        chunkIndex: 0,
        predictions: [
          {
            record_id: "record-a",
            variant_id: "record-a:apa7:clean",
            citation_style: "apa7",
            reference_type: "article-journal",
            formatted_hash: "hash-a",
            fields: {},
            output_latency_ms: 1,
            duration_ms: 1,
            warnings: [],
          },
        ],
      },
      {
        chunkIndex: 1,
        predictions: [
          {
            record_id: "record-b",
            variant_id: "record-b:apa7:clean",
            citation_style: "apa7",
            reference_type: "article-journal",
            formatted_hash: "hash-b",
            fields: {},
            output_latency_ms: 2,
            duration_ms: 2,
            warnings: [],
          },
        ],
      },
    ]).map((row) => row.record_id)).toEqual([
      "record-a",
      "record-b",
      "record-c",
    ]);
  });

  it("only enables the parallel variant when worker capacity and thresholds allow it", () => {
    expect(
      shouldUseParallelBenchmarkVariant({
        benchmarkVariant: "grobid_compare",
        totalRows: 1000,
        runtimeTuning: {
          batchSize: 128,
          maxConcurrency: 5,
        },
        multicoreThreshold: 256,
      }),
    ).toBe(false);

    expect(
      shouldUseParallelBenchmarkVariant({
        benchmarkVariant: "parallel",
        totalRows: 200,
        runtimeTuning: {
          batchSize: 128,
          maxConcurrency: 5,
        },
        multicoreThreshold: 256,
      }),
    ).toBe(false);

    expect(
      shouldUseParallelBenchmarkVariant({
        benchmarkVariant: "parallel",
        totalRows: 300,
        runtimeTuning: {
          batchSize: 128,
          maxConcurrency: 1,
        },
        multicoreThreshold: 256,
      }),
    ).toBe(false);

    expect(
      shouldUseParallelBenchmarkVariant({
        benchmarkVariant: "parallel",
        totalRows: 300,
        runtimeTuning: {
          batchSize: 128,
          maxConcurrency: 5,
        },
        multicoreThreshold: 256,
      }),
    ).toBe(true);
  });
});
