import { PerformanceObserver, type PerformanceEntry } from "node:perf_hooks";

import type { ProviderUsage, ProcessingPath } from "../engine/types/pipeline.js";
import type {
  BenchmarkGcStats,
  BenchmarkMemoryStats,
  BenchmarkPredictionRow,
  BenchmarkRuntimeMetrics,
  BenchmarkSlowChunk,
  BenchmarkSlowRow,
  BenchmarkThroughputDecay,
} from "./types.js";
import { emptyWorkerImbalance } from "./runtimeGuardrails.js";

export interface BenchmarkChunkTelemetry {
  chunkIndex: number;
  workerIndex?: number;
  rowCount: number;
  wallClockMs: number;
  recordIds: string[];
}

export interface BenchmarkProcessTelemetry {
  cpuUserMs: number;
  cpuSystemMs: number;
  gcStats: BenchmarkGcStats;
  memoryStats: BenchmarkMemoryStats;
}

export interface BenchmarkRuntimeTelemetryAccumulator {
  providerCallCount: number;
  stageTotalsMs: Record<string, number>;
  chunkTelemetry: BenchmarkChunkTelemetry[];
}

export function createBenchmarkRuntimeTelemetryAccumulator(): BenchmarkRuntimeTelemetryAccumulator {
  return {
    providerCallCount: 0,
    stageTotalsMs: {},
    chunkTelemetry: [],
  };
}

export function createBenchmarkProcessTelemetryCollector(): {
  sampleMemory: () => void;
  stop: () => BenchmarkProcessTelemetry;
} {
  const cpuStart = process.cpuUsage();
  const memoryStart = process.memoryUsage();
  let rssPeakBytes = memoryStart.rss;
  let heapUsedPeakBytes = memoryStart.heapUsed;
  let gcStats: BenchmarkGcStats = {
    total_collections: 0,
    total_duration_ms: 0,
    max_pause_ms: 0,
  };

  const observer = createGcObserver((entry) => {
    gcStats = updateGcStats(gcStats, entry);
  });

  return {
    sampleMemory: () => {
      const usage = process.memoryUsage();
      rssPeakBytes = Math.max(rssPeakBytes, usage.rss);
      heapUsedPeakBytes = Math.max(heapUsedPeakBytes, usage.heapUsed);
    },
    stop: () => {
      observer?.disconnect();
      const cpu = process.cpuUsage(cpuStart);
      const memoryEnd = process.memoryUsage();
      rssPeakBytes = Math.max(rssPeakBytes, memoryEnd.rss);
      heapUsedPeakBytes = Math.max(heapUsedPeakBytes, memoryEnd.heapUsed);
      return {
        cpuUserMs: round(cpu.user / 1000, 2),
        cpuSystemMs: round(cpu.system / 1000, 2),
        gcStats: {
          total_collections: gcStats.total_collections,
          total_duration_ms: round(gcStats.total_duration_ms, 2),
          max_pause_ms: round(gcStats.max_pause_ms, 2),
        },
        memoryStats: {
          rss_start_bytes: memoryStart.rss,
          rss_end_bytes: memoryEnd.rss,
          rss_peak_bytes: rssPeakBytes,
          heap_used_start_bytes: memoryStart.heapUsed,
          heap_used_end_bytes: memoryEnd.heapUsed,
          heap_used_peak_bytes: heapUsedPeakBytes,
        },
      };
    },
  };
}

export function recordRuntimeTelemetry(
  accumulator: BenchmarkRuntimeTelemetryAccumulator,
  input: {
    providerUsage: ProviderUsage;
    stageTimings: ProcessingPath["stageTimings"];
    chunkTelemetry: BenchmarkChunkTelemetry;
  },
): void {
  accumulator.providerCallCount += countProviderCalls(input.providerUsage);
  mergeStageTotals(accumulator.stageTotalsMs, input.stageTimings);
  accumulator.chunkTelemetry.push(input.chunkTelemetry);
}

export function countProviderCalls(providerUsage: ProviderUsage): number {
  return providerUsage.crossrefCalls
    + providerUsage.openalexCalls
    + providerUsage.semanticScholarCalls;
}

export function mergeStageTotals(
  target: Record<string, number>,
  stageTimings: ProcessingPath["stageTimings"],
): void {
  for (const stage of stageTimings) {
    target[stage.phaseId] = round((target[stage.phaseId] ?? 0) + stage.durationMs, 2);
  }
}

export function topSlowChunks(
  chunks: BenchmarkChunkTelemetry[],
  limit = 10,
): BenchmarkSlowChunk[] {
  return [...chunks]
    .sort((left, right) => right.wallClockMs - left.wallClockMs || left.chunkIndex - right.chunkIndex)
    .slice(0, limit)
    .map((chunk) => ({
      chunk_index: chunk.chunkIndex,
      ...(chunk.workerIndex == null ? {} : { worker_index: chunk.workerIndex }),
      row_count: chunk.rowCount,
      wall_clock_ms: round(chunk.wallClockMs, 2),
      throughput_refs_per_sec: chunk.wallClockMs > 0
        ? round(chunk.rowCount / (chunk.wallClockMs / 1000), 2)
        : 0,
      record_ids: [...chunk.recordIds],
    }));
}

export function topSlowRows(
  predictions: BenchmarkPredictionRow[],
  limit = 20,
): BenchmarkSlowRow[] {
  return [...predictions]
    .sort((left, right) => {
      const leftDuration = Math.max(left.duration_ms, left.output_latency_ms);
      const rightDuration = Math.max(right.duration_ms, right.output_latency_ms);
      return rightDuration - leftDuration || left.variant_id.localeCompare(right.variant_id);
    })
    .slice(0, limit)
    .map((prediction) => ({
      variant_id: prediction.variant_id,
      record_id: prediction.record_id,
      duration_ms: round(prediction.duration_ms, 2),
      output_latency_ms: round(prediction.output_latency_ms, 2),
      reference_type: prediction.reference_type,
    }));
}

export function mergeSlowRows(
  existing: BenchmarkSlowRow[],
  incoming: BenchmarkSlowRow[],
  limit = 20,
): BenchmarkSlowRow[] {
  return [...existing, ...incoming]
    .sort((left, right) => {
      const leftDuration = Math.max(left.duration_ms, left.output_latency_ms);
      const rightDuration = Math.max(right.duration_ms, right.output_latency_ms);
      return rightDuration - leftDuration || left.variant_id.localeCompare(right.variant_id);
    })
    .slice(0, limit);
}

export function computeThroughputDecay(
  chunks: BenchmarkChunkTelemetry[],
): BenchmarkThroughputDecay {
  if (chunks.length < 2) {
    return {
      sample_count: chunks.length,
      initial_refs_per_sec: null,
      final_refs_per_sec: null,
      decline_ratio: null,
    };
  }

  const ordered = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const splitIndex = Math.max(1, Math.floor(ordered.length / 2));
  const initial = throughputForChunks(ordered.slice(0, splitIndex));
  const final = throughputForChunks(ordered.slice(splitIndex));
  const declineRatio = initial > 0 ? Math.max(0, (initial - final) / initial) : 0;

  return {
    sample_count: ordered.length,
    initial_refs_per_sec: round(initial, 2),
    final_refs_per_sec: round(final, 2),
    decline_ratio: round(declineRatio, 4),
  };
}

export function mergeThroughputDecay(
  values: BenchmarkThroughputDecay[],
): BenchmarkThroughputDecay {
  const sampleCount = values.reduce((sum, value) => sum + value.sample_count, 0);
  const comparable = values.filter(
    (value) =>
      value.sample_count > 0
      && value.initial_refs_per_sec != null
      && value.final_refs_per_sec != null,
  );

  if (comparable.length === 0) {
    return {
      sample_count: sampleCount,
      initial_refs_per_sec: null,
      final_refs_per_sec: null,
      decline_ratio: null,
    };
  }

  const totalWeight = comparable.reduce(
    (sum, value) => sum + Math.max(1, value.sample_count),
    0,
  );
  const initial = comparable.reduce(
    (sum, value) => sum + (value.initial_refs_per_sec ?? 0) * Math.max(1, value.sample_count),
    0,
  ) / totalWeight;
  const final = comparable.reduce(
    (sum, value) => sum + (value.final_refs_per_sec ?? 0) * Math.max(1, value.sample_count),
    0,
  ) / totalWeight;
  const declineRatio = initial > 0 ? Math.max(0, (initial - final) / initial) : 0;

  return {
    sample_count: sampleCount,
    initial_refs_per_sec: round(initial, 2),
    final_refs_per_sec: round(final, 2),
    decline_ratio: round(declineRatio, 4),
  };
}

export function buildBenchmarkRuntimeMetrics(
  base: {
    wallClockMs: number;
    predictionCount: number;
  },
  telemetry: BenchmarkProcessTelemetry,
  accumulator: BenchmarkRuntimeTelemetryAccumulator,
  predictions: BenchmarkPredictionRow[],
  options: {
    slowRows?: BenchmarkSlowRow[];
  } = {},
): BenchmarkRuntimeMetrics {
  return {
    measurement_basis: "wall_clock",
    wall_clock_ms: round(base.wallClockMs, 2),
    prediction_count: base.predictionCount,
    throughput_refs_per_sec: base.wallClockMs > 0
      ? round(base.predictionCount / (base.wallClockMs / 1000), 2)
      : 0,
    cpu_user_ms: telemetry.cpuUserMs,
    cpu_system_ms: telemetry.cpuSystemMs,
    provider_call_count: accumulator.providerCallCount,
    stage_totals_ms: accumulator.stageTotalsMs,
    worker_stats: [],
    slow_chunks: topSlowChunks(accumulator.chunkTelemetry),
    slow_rows: options.slowRows ?? topSlowRows(predictions),
    gc_stats: telemetry.gcStats,
    memory_stats: telemetry.memoryStats,
    throughput_decay: computeThroughputDecay(accumulator.chunkTelemetry),
    worker_imbalance: emptyWorkerImbalance(),
  };
}

function throughputForChunks(chunks: BenchmarkChunkTelemetry[]): number {
  const totalRows = chunks.reduce((sum, chunk) => sum + chunk.rowCount, 0);
  const totalMs = chunks.reduce((sum, chunk) => sum + chunk.wallClockMs, 0);
  return totalMs > 0 ? totalRows / (totalMs / 1000) : 0;
}

function updateGcStats(
  current: BenchmarkGcStats,
  entry: PerformanceEntry,
): BenchmarkGcStats {
  return {
    total_collections: current.total_collections + 1,
    total_duration_ms: current.total_duration_ms + entry.duration,
    max_pause_ms: Math.max(current.max_pause_ms, entry.duration),
  };
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function createGcObserver(
  onEntry: (entry: PerformanceEntry) => void,
): PerformanceObserver | null {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        onEntry(entry);
      }
    });
    observer.observe({ entryTypes: ["gc"] });
    return observer;
  } catch {
    return null;
  }
}
