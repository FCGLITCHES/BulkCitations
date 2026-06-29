import { describe, expect, it } from "vitest";

import {
  computeWorkerImbalance,
  emptyWorkerImbalance,
  evaluateRuntimeGuardrails,
} from "../../../src/benchmark/runtimeGuardrails.js";

describe("benchmark runtime guardrails", () => {
  it("computes worker imbalance ratios from worker stats", () => {
    expect(computeWorkerImbalance([
      {
        worker_index: 0,
        prediction_count: 100,
        group_count: 10,
        wall_clock_ms: 1000,
        throughput_refs_per_sec: 100,
        cpu_user_ms: 400,
        cpu_system_ms: 50,
        provider_call_count: 0,
      },
      {
        worker_index: 1,
        prediction_count: 80,
        group_count: 8,
        wall_clock_ms: 1500,
        throughput_refs_per_sec: 60,
        cpu_user_ms: 350,
        cpu_system_ms: 40,
        provider_call_count: 0,
      },
    ])).toEqual({
      worker_count: 2,
      prediction_count_ratio: 1.25,
      wall_clock_ratio: 1.5,
      throughput_ratio: 1.6667,
    });

    expect(emptyWorkerImbalance(1)).toEqual({
      worker_count: 1,
      prediction_count_ratio: null,
      wall_clock_ratio: null,
      throughput_ratio: null,
    });
  });

  it("flags runtime ceilings when memory, decay, or imbalance exceed the configured guardrails", () => {
    const outcome = evaluateRuntimeGuardrails({
      measurement_basis: "wall_clock",
      wall_clock_ms: 1000,
      prediction_count: 100,
      throughput_refs_per_sec: 100,
      cpu_user_ms: 400,
      cpu_system_ms: 50,
      provider_call_count: 0,
      stage_totals_ms: {},
      worker_stats: [],
      slow_chunks: [],
      slow_rows: [],
      gc_stats: {
        total_collections: 4,
        total_duration_ms: 12,
        max_pause_ms: 300,
      },
      memory_stats: {
        rss_start_bytes: 1024,
        rss_end_bytes: 2048,
        rss_peak_bytes: 4 * 1024 * 1024 * 1024,
        heap_used_start_bytes: 512,
        heap_used_end_bytes: 768,
        heap_used_peak_bytes: 1024,
      },
      throughput_decay: {
        sample_count: 4,
        initial_refs_per_sec: 100,
        final_refs_per_sec: 70,
        decline_ratio: 0.3,
      },
      worker_imbalance: {
        worker_count: 2,
        prediction_count_ratio: 1.1,
        wall_clock_ratio: 2.4,
        throughput_ratio: 1.2,
      },
    });

    expect(outcome.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/RSS peak/i),
        expect.stringMatching(/GC max pause/i),
        expect.stringMatching(/throughput decay/i),
        expect.stringMatching(/wall-clock imbalance/i),
      ]),
    );
    expect(outcome.reports).toHaveLength(1);
  });
});
