import { describe, expect, it } from "vitest";

import {
  buildBenchmarkRuntimeMetrics,
  computeThroughputDecay,
  countProviderCalls,
  createBenchmarkRuntimeTelemetryAccumulator,
  mergeSlowRows,
  mergeThroughputDecay,
  recordRuntimeTelemetry,
  topSlowRows,
} from "../../../src/benchmark/runtimeTelemetry.js";
import type { BenchmarkPredictionRow } from "../../../src/benchmark/types.js";

describe("benchmark runtime telemetry", () => {
  it("computes provider call totals and throughput decay from chunk telemetry", () => {
    const accumulator = createBenchmarkRuntimeTelemetryAccumulator();

    recordRuntimeTelemetry(accumulator, {
      providerUsage: {
        crossrefCalls: 1,
        openalexCalls: 2,
        semanticScholarCalls: 3,
        llmTokensUsed: 0,
        llmRepairCalls: 0,
        cacheHits: 0,
      },
      stageTimings: [
        {
          phaseId: "extraction",
          durationMs: 80,
          status: "success",
          budgetMs: 250,
          withinBudget: true,
        },
      ],
      chunkTelemetry: {
        chunkIndex: 0,
        rowCount: 100,
        wallClockMs: 1000,
        recordIds: ["a", "b"],
      },
    });
    recordRuntimeTelemetry(accumulator, {
      providerUsage: {
        crossrefCalls: 0,
        openalexCalls: 0,
        semanticScholarCalls: 0,
        llmTokensUsed: 0,
        cacheHits: 1,
      },
      stageTimings: [
        {
          phaseId: "extraction",
          durationMs: 120,
          status: "success",
          budgetMs: 250,
          withinBudget: true,
        },
      ],
      chunkTelemetry: {
        chunkIndex: 1,
        rowCount: 100,
        wallClockMs: 2000,
        recordIds: ["c", "d"],
      },
    });

    expect(countProviderCalls({
      crossrefCalls: 1,
      openalexCalls: 2,
      semanticScholarCalls: 3,
      llmTokensUsed: 999,
      cacheHits: 4,
    })).toBe(6);
    expect(accumulator.providerCallCount).toBe(6);
    expect(accumulator.stageTotalsMs).toEqual({
      extraction: 200,
    });
    expect(computeThroughputDecay(accumulator.chunkTelemetry)).toEqual({
      sample_count: 2,
      initial_refs_per_sec: 100,
      final_refs_per_sec: 50,
      decline_ratio: 0.5,
    });
    expect(mergeThroughputDecay([
      {
        sample_count: 2,
        initial_refs_per_sec: 100,
        final_refs_per_sec: 50,
        decline_ratio: 0.5,
      },
      {
        sample_count: 4,
        initial_refs_per_sec: 80,
        final_refs_per_sec: 60,
        decline_ratio: 0.25,
      },
    ])).toEqual({
      sample_count: 6,
      initial_refs_per_sec: 86.67,
      final_refs_per_sec: 56.67,
      decline_ratio: 0.3462,
    });
  });

  it("builds runtime metrics and surfaces the slowest prediction rows", () => {
    const accumulator = createBenchmarkRuntimeTelemetryAccumulator();
    accumulator.providerCallCount = 0;
    accumulator.stageTotalsMs = {
      extraction: 42,
    };
    accumulator.chunkTelemetry = [
      {
        chunkIndex: 0,
        rowCount: 2,
        wallClockMs: 100,
        recordIds: ["r1", "r2"],
      },
    ];
    const predictions: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        citation_style: "apa7",
        reference_type: "article-journal",
        formatted_hash: "hash-1",
        fields: {},
        output_latency_ms: 40,
        duration_ms: 30,
        warnings: [],
      },
      {
        record_id: "r2",
        variant_id: "r2:apa7:clean",
        citation_style: "apa7",
        reference_type: "book",
        formatted_hash: "hash-2",
        fields: {},
        output_latency_ms: 20,
        duration_ms: 60,
        warnings: [],
      },
    ];

    expect(topSlowRows(predictions)).toEqual([
      {
        variant_id: "r2:apa7:clean",
        record_id: "r2",
        duration_ms: 60,
        output_latency_ms: 20,
        reference_type: "book",
      },
      {
        variant_id: "r1:apa7:clean",
        record_id: "r1",
        duration_ms: 30,
        output_latency_ms: 40,
        reference_type: "article-journal",
      },
    ]);

    expect(buildBenchmarkRuntimeMetrics(
      {
        wallClockMs: 120,
        predictionCount: 2,
      },
      {
        cpuUserMs: 10,
        cpuSystemMs: 5,
        gcStats: {
          total_collections: 0,
          total_duration_ms: 0,
          max_pause_ms: 0,
        },
        memoryStats: {
          rss_start_bytes: 1024,
          rss_end_bytes: 2048,
          rss_peak_bytes: 4096,
          heap_used_start_bytes: 512,
          heap_used_end_bytes: 768,
          heap_used_peak_bytes: 1024,
        },
      },
      accumulator,
      predictions,
    )).toMatchObject({
      measurement_basis: "wall_clock",
      wall_clock_ms: 120,
      prediction_count: 2,
      throughput_refs_per_sec: 16.67,
      cpu_user_ms: 10,
      cpu_system_ms: 5,
      provider_call_count: 0,
      stage_totals_ms: {
        extraction: 42,
      },
      slow_chunks: [
        {
          chunk_index: 0,
          row_count: 2,
        },
      ],
      throughput_decay: {
        sample_count: 1,
        initial_refs_per_sec: null,
        final_refs_per_sec: null,
        decline_ratio: null,
      },
      worker_imbalance: {
        worker_count: 0,
        prediction_count_ratio: null,
        wall_clock_ratio: null,
        throughput_ratio: null,
      },
    });
  });

  it("merges precomputed slow rows deterministically without keeping full predictions", () => {
    const existing = [
      {
        variant_id: "r1:apa7:clean",
        record_id: "r1",
        duration_ms: 25,
        output_latency_ms: 10,
        reference_type: "article-journal",
      },
    ];
    const incoming = [
      {
        variant_id: "r2:apa7:clean",
        record_id: "r2",
        duration_ms: 20,
        output_latency_ms: 40,
        reference_type: "book",
      },
      {
        variant_id: "r0:apa7:clean",
        record_id: "r0",
        duration_ms: 40,
        output_latency_ms: 40,
        reference_type: "report",
      },
    ];

    expect(mergeSlowRows(existing, incoming, 2)).toEqual([
      {
        variant_id: "r0:apa7:clean",
        record_id: "r0",
        duration_ms: 40,
        output_latency_ms: 40,
        reference_type: "report",
      },
      {
        variant_id: "r2:apa7:clean",
        record_id: "r2",
        duration_ms: 20,
        output_latency_ms: 40,
        reference_type: "book",
      },
    ]);
  });
});
