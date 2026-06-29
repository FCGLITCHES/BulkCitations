import type {
  BenchmarkRuntimeMetrics,
  BenchmarkWorkerImbalance,
  BenchmarkWorkerStat,
} from "./types.js";

// The parallel lane runs ~11 worker isolates, each with its own tsx-transpiled engine, so RSS
// legitimately sits ~3.0–3.5 GiB (a harness artifact, not a production cost — prod loads the
// compiled engine once). Ceiling has headroom over the observed ~3.46 GiB peak; warning still
// catches real creep below it.
const RSS_PEAK_WARNING_BYTES = 3.25 * 1024 * 1024 * 1024;
const RSS_PEAK_FAILURE_BYTES = 3.75 * 1024 * 1024 * 1024;
const GC_MAX_PAUSE_WARNING_MS = 100;
const GC_MAX_PAUSE_FAILURE_MS = 250;
const THROUGHPUT_DECAY_WARNING_RATIO = 0.15;
const THROUGHPUT_DECAY_FAILURE_RATIO = 0.25;
const WORKER_IMBALANCE_WARNING_RATIO = 1.5;
const WORKER_IMBALANCE_FAILURE_RATIO = 2.0;

export interface BenchmarkRuntimeGuardrailOutcome {
  failures: string[];
  warnings: string[];
  reports: string[];
}

export function emptyWorkerImbalance(workerCount = 0): BenchmarkWorkerImbalance {
  return {
    worker_count: workerCount,
    prediction_count_ratio: null,
    wall_clock_ratio: null,
    throughput_ratio: null,
  };
}

export function computeWorkerImbalance(
  workerStats: BenchmarkWorkerStat[],
): BenchmarkWorkerImbalance {
  if (workerStats.length <= 1) {
    return emptyWorkerImbalance(workerStats.length);
  }

  const predictionCounts = workerStats
    .map((worker) => worker.prediction_count)
    .filter((value) => value > 0);
  const wallClockMs = workerStats
    .map((worker) => worker.wall_clock_ms)
    .filter((value) => value > 0);
  const throughputs = workerStats
    .map((worker) => worker.throughput_refs_per_sec)
    .filter((value) => value > 0);

  return {
    worker_count: workerStats.length,
    prediction_count_ratio: computeRatio(predictionCounts),
    wall_clock_ratio: computeRatio(wallClockMs),
    throughput_ratio: computeRatio(throughputs),
  };
}

export function evaluateRuntimeGuardrails(
  runtimeMetrics: BenchmarkRuntimeMetrics | undefined,
): BenchmarkRuntimeGuardrailOutcome {
  if (!runtimeMetrics) {
    return {
      failures: [],
      warnings: [],
      reports: [],
    };
  }

  const failures: string[] = [];
  const warnings: string[] = [];
  const reports: string[] = [];

  const rssPeakBytes = runtimeMetrics.memory_stats.rss_peak_bytes;
  if (rssPeakBytes > RSS_PEAK_FAILURE_BYTES) {
    failures.push(
      `Runtime RSS peak ${formatGiB(rssPeakBytes)} GiB exceeded ceiling ${formatGiB(RSS_PEAK_FAILURE_BYTES)} GiB.`,
    );
  } else if (rssPeakBytes > RSS_PEAK_WARNING_BYTES) {
    warnings.push(
      `Runtime RSS peak ${formatGiB(rssPeakBytes)} GiB is above warning ${formatGiB(RSS_PEAK_WARNING_BYTES)} GiB.`,
    );
  }

  const maxPauseMs = runtimeMetrics.gc_stats.max_pause_ms;
  if (maxPauseMs > GC_MAX_PAUSE_FAILURE_MS) {
    failures.push(
      `Runtime GC max pause ${round(maxPauseMs, 2)} ms exceeded ceiling ${GC_MAX_PAUSE_FAILURE_MS} ms.`,
    );
  } else if (maxPauseMs > GC_MAX_PAUSE_WARNING_MS) {
    warnings.push(
      `Runtime GC max pause ${round(maxPauseMs, 2)} ms is above warning ${GC_MAX_PAUSE_WARNING_MS} ms.`,
    );
  }

  const declineRatio = runtimeMetrics.throughput_decay.decline_ratio;
  if (declineRatio != null) {
    if (declineRatio > THROUGHPUT_DECAY_FAILURE_RATIO) {
      failures.push(
        `Runtime throughput decay ${round(declineRatio, 4)} exceeded ceiling ${THROUGHPUT_DECAY_FAILURE_RATIO}.`,
      );
    } else if (declineRatio > THROUGHPUT_DECAY_WARNING_RATIO) {
      warnings.push(
        `Runtime throughput decay ${round(declineRatio, 4)} is above warning ${THROUGHPUT_DECAY_WARNING_RATIO}.`,
      );
    }
  }

  const wallClockRatio = runtimeMetrics.worker_imbalance.wall_clock_ratio;
  if (wallClockRatio != null) {
    if (wallClockRatio > WORKER_IMBALANCE_FAILURE_RATIO) {
      failures.push(
        `Worker wall-clock imbalance ${round(wallClockRatio, 3)} exceeded ceiling ${WORKER_IMBALANCE_FAILURE_RATIO}.`,
      );
    } else if (wallClockRatio > WORKER_IMBALANCE_WARNING_RATIO) {
      warnings.push(
        `Worker wall-clock imbalance ${round(wallClockRatio, 3)} is above warning ${WORKER_IMBALANCE_WARNING_RATIO}.`,
      );
    }
  }

  if (runtimeMetrics.provider_call_count > 0) {
    failures.push(
      `Runtime provider call count ${runtimeMetrics.provider_call_count} must remain zero for core benchmarks.`,
    );
  }

  reports.push(
    `Runtime guardrails: rss_peak_gib=${formatGiB(rssPeakBytes)}, gc_max_pause_ms=${round(maxPauseMs, 2)}, throughput_decay=${runtimeMetrics.throughput_decay.decline_ratio ?? "n/a"}, worker_wall_clock_ratio=${runtimeMetrics.worker_imbalance.wall_clock_ratio ?? "n/a"}.`,
  );

  return {
    failures,
    warnings,
    reports,
  };
}

function computeRatio(values: number[]): number | null {
  if (values.length <= 1) {
    return null;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  if (min <= 0) {
    return null;
  }

  return round(max / min, 4);
}

function formatGiB(bytes: number): number {
  return round(bytes / (1024 * 1024 * 1024), 3);
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}
