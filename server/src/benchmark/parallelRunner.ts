import { Worker } from "node:worker_threads";

import type { ConvertRequest } from "../engine/types/api.js";
import type { ParseProfile } from "../engine/types/parseProfile.js";
import type { PipelineRuntimeTuning } from "../engine/types/pipeline.js";
import {
  createWeightedWorkerAssignments,
} from "../pipeline/workerScheduling.js";
import { resolveSingleWorkerRuntimeTuning } from "../pipeline/runtimeProfiles.js";
import type {
  BenchmarkArtifactDetail,
  BenchmarkHardwareProfile,
  BenchmarkManifestRow,
  BenchmarkPredictionRow,
  BenchmarkRunProfile,
  BenchmarkRuntimeMetrics,
  BenchmarkSlowChunk,
  BenchmarkSlowRow,
  BenchmarkVariant,
} from "./types.js";
import {
  mergeThroughputDecay,
} from "./runtimeTelemetry.js";
import { computeWorkerImbalance, emptyWorkerImbalance } from "./runtimeGuardrails.js";

export interface ParallelBenchmarkAssignment {
  workerIndex: number;
  rowCount: number;
  groups: BenchmarkManifestRow[][];
}

export interface ParallelBenchmarkWorkerRequest {
  workerIndex: number;
  assignedGroups: BenchmarkManifestRow[][];
  warmupGroups: BenchmarkManifestRow[][];
  profile: BenchmarkRunProfile;
  hardwareProfile: BenchmarkHardwareProfile;
  benchmarkVariant: BenchmarkVariant;
  sourceType: ConvertRequest["sourceType"];
  parseProfile: ParseProfile;
  artifactDetail: BenchmarkArtifactDetail;
}

interface ParallelBenchmarkWorkerResult {
  processedGroups: number;
  runtimeMetrics: BenchmarkRuntimeMetrics;
}

interface ParallelBenchmarkWorkerChunk {
  chunkIndex: number;
  predictions: BenchmarkPredictionRow[];
}

type ParallelBenchmarkWorkerMessage =
  | {
      type: "chunk";
      payload: ParallelBenchmarkWorkerChunk;
    }
  | {
      type: "result";
      payload: ParallelBenchmarkWorkerResult;
    }
  | {
      type: "error";
      error: {
        message: string;
        stack?: string;
      };
    };

export interface RunParallelBenchmarkGroupsInput {
  groups: BenchmarkManifestRow[][];
  profile: BenchmarkRunProfile;
  hardwareProfile: BenchmarkHardwareProfile;
  benchmarkVariant: BenchmarkVariant;
  sourceType: ConvertRequest["sourceType"];
  parseProfile: ParseProfile;
  artifactDetail: BenchmarkArtifactDetail;
  requestedWorkers: number;
  warmupGroups: BenchmarkManifestRow[][];
  abortSignal?: AbortSignal;
}

export interface RunParallelBenchmarkGroupsResult {
  predictions: BenchmarkPredictionRow[];
  runtimeMetrics: BenchmarkRuntimeMetrics;
}

export function shouldUseParallelBenchmarkVariant(input: {
  benchmarkVariant: BenchmarkVariant;
  totalRows: number;
  runtimeTuning: PipelineRuntimeTuning | null;
  multicoreThreshold: number | null;
}): boolean {
  if (input.benchmarkVariant !== "parallel") {
    return false;
  }

  const requestedWorkers = input.runtimeTuning?.maxConcurrency ?? 1;
  if (requestedWorkers <= 1) {
    return false;
  }

  const threshold = input.multicoreThreshold ?? 0;
  return input.totalRows >= threshold;
}

export function resolveParallelWorkerRuntimeTuning(
  runtimeTuning: PipelineRuntimeTuning | null,
): PipelineRuntimeTuning | null {
  return resolveSingleWorkerRuntimeTuning(runtimeTuning);
}

export function createParallelBenchmarkAssignments(
  groups: BenchmarkManifestRow[][],
  workerCount: number,
): ParallelBenchmarkAssignment[] {
  const bundledGroups = bundleBenchmarkGroupsByRecord(groups);
  return createWeightedWorkerAssignments(
    bundledGroups,
    workerCount,
    (bundle) => bundle.rowCount,
  ).map((assignment) => ({
    workerIndex: assignment.workerIndex,
    rowCount: assignment.totalWeight,
    groups: assignment.items
      .sort((left, right) => left.firstGroupIndex - right.firstGroupIndex)
      .flatMap((bundle) => bundle.groups),
  }));
}

interface BenchmarkGroupBundle {
  recordId: string;
  rowCount: number;
  firstGroupIndex: number;
  groups: BenchmarkManifestRow[][];
}

function bundleBenchmarkGroupsByRecord(
  groups: BenchmarkManifestRow[][],
): BenchmarkGroupBundle[] {
  const bundles = new Map<string, BenchmarkGroupBundle>();

  for (const [groupIndex, group] of groups.entries()) {
    const recordId = benchmarkAssignmentGroupKey(group);
    const existing = bundles.get(recordId);
    if (existing) {
      existing.groups.push(group);
      existing.rowCount += group.length;
      continue;
    }
    bundles.set(recordId, {
      recordId,
      rowCount: group.length,
      firstGroupIndex: groupIndex,
      groups: [group],
    });
  }

  return [...bundles.values()];
}

function benchmarkAssignmentGroupKey(group: BenchmarkManifestRow[]): string {
  return [...new Set(group.map((row) => row.record_id))].join("|") || "__missing_record__";
}

export function distributeParallelWarmupGroups(
  warmupGroups: BenchmarkManifestRow[][],
  workerCount: number,
): BenchmarkManifestRow[][][] {
  if (workerCount <= 0) {
    return [];
  }

  const buckets = Array.from({ length: workerCount }, () => [] as BenchmarkManifestRow[][]);
  for (const [index, group] of warmupGroups.entries()) {
    buckets[index % workerCount]?.push(group);
  }

  return buckets;
}

export function mergeWorkerPredictionChunks(
  chunks: ParallelBenchmarkWorkerChunk[],
): BenchmarkPredictionRow[] {
  return [...chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .flatMap((chunk) => chunk.predictions);
}

export async function runParallelBenchmarkGroups(
  input: RunParallelBenchmarkGroupsInput,
): Promise<BenchmarkPredictionRow[]> {
  const result = await runParallelBenchmarkGroupsWithMetrics(input);
  return result.predictions;
}

export async function runParallelBenchmarkGroupsWithMetrics(
  input: RunParallelBenchmarkGroupsInput,
): Promise<RunParallelBenchmarkGroupsResult> {
  const assignments = createParallelBenchmarkAssignments(
    input.groups,
    input.requestedWorkers,
  );
  if (assignments.length === 0) {
    return {
      predictions: [],
      runtimeMetrics: {
        measurement_basis: "wall_clock",
        wall_clock_ms: 0,
        prediction_count: 0,
        throughput_refs_per_sec: 0,
        cpu_user_ms: 0,
        cpu_system_ms: 0,
        provider_call_count: 0,
        stage_totals_ms: {},
        worker_stats: [],
        slow_chunks: [],
        slow_rows: [],
        gc_stats: {
          total_collections: 0,
          total_duration_ms: 0,
          max_pause_ms: 0,
        },
        memory_stats: {
          rss_start_bytes: 0,
          rss_end_bytes: 0,
          rss_peak_bytes: 0,
          heap_used_start_bytes: 0,
          heap_used_end_bytes: 0,
          heap_used_peak_bytes: 0,
        },
        throughput_decay: {
          sample_count: 0,
          initial_refs_per_sec: null,
          final_refs_per_sec: null,
          decline_ratio: null,
        },
        worker_imbalance: emptyWorkerImbalance(),
      },
    };
  }
  const warmupAssignments = distributeParallelWarmupGroups(input.warmupGroups, assignments.length);

  const workerScriptUrl = new URL("../../scripts/benchmark/run-engine-worker-bootstrap.mjs", import.meta.url);
  const workers: Worker[] = [];
  const workerPromises = assignments.map((assignment) => {
    const compactAssignedGroups = assignment.groups.map(compactGroupForWorker);
    const compactWarmupGroups = (warmupAssignments[assignment.workerIndex] ?? [])
      .map(compactGroupForWorker);
    const worker = new Worker(workerScriptUrl, {
      workerData: {
        workerIndex: assignment.workerIndex,
        assignedGroups: compactAssignedGroups,
        warmupGroups: compactWarmupGroups,
        profile: input.profile,
        hardwareProfile: input.hardwareProfile,
        benchmarkVariant: input.benchmarkVariant,
        sourceType: input.sourceType,
        parseProfile: input.parseProfile,
        artifactDetail: input.artifactDetail,
      } satisfies ParallelBenchmarkWorkerRequest,
    });
    workers.push(worker);
    return awaitWorkerResult(worker, assignment.workerIndex);
  });

  const abortHandler = () => {
    for (const worker of workers) {
      void worker.terminate();
    }
  };
  input.abortSignal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const workerResults = await Promise.all(workerPromises);
    const predictions = workerResults.flatMap((result) => result.predictions);
    const wallClockMs = workerResults.reduce((maxDuration, result) => {
      return Math.max(maxDuration, result.runtimeMetrics.wall_clock_ms);
    }, 0);
    const workerStats = workerResults.flatMap((result) => result.runtimeMetrics.worker_stats);
    return {
      predictions,
      runtimeMetrics: {
        measurement_basis: "wall_clock",
        wall_clock_ms: wallClockMs,
        prediction_count: predictions.length,
        throughput_refs_per_sec: wallClockMs > 0
          ? Math.round((predictions.length / (wallClockMs / 1000)) * 100) / 100
          : 0,
        cpu_user_ms: round(workerResults.reduce(
          (sum, result) => sum + result.runtimeMetrics.cpu_user_ms,
          0,
        ), 2),
        cpu_system_ms: round(workerResults.reduce(
          (sum, result) => sum + result.runtimeMetrics.cpu_system_ms,
          0,
        ), 2),
        provider_call_count: workerResults.reduce(
          (sum, result) => sum + result.runtimeMetrics.provider_call_count,
          0,
        ),
        stage_totals_ms: mergeStageTotals(workerResults.map((result) => result.runtimeMetrics.stage_totals_ms)),
        worker_stats: workerStats,
        slow_chunks: topSlowChunks(
          workerResults.flatMap((result) => result.runtimeMetrics.slow_chunks),
        ),
        slow_rows: topSlowRows(
          workerResults.flatMap((result) => result.runtimeMetrics.slow_rows),
        ),
        gc_stats: {
          total_collections: workerResults.reduce(
            (sum, result) => sum + result.runtimeMetrics.gc_stats.total_collections,
            0,
          ),
          total_duration_ms: round(workerResults.reduce(
            (sum, result) => sum + result.runtimeMetrics.gc_stats.total_duration_ms,
            0,
          ), 2),
          max_pause_ms: round(workerResults.reduce(
            (maxPause, result) => Math.max(maxPause, result.runtimeMetrics.gc_stats.max_pause_ms),
            0,
          ), 2),
        },
        memory_stats: {
          rss_start_bytes: workerResults.reduce(
            (maxRss, result) => Math.max(maxRss, result.runtimeMetrics.memory_stats.rss_start_bytes),
            0,
          ),
          rss_end_bytes: workerResults.reduce(
            (maxRss, result) => Math.max(maxRss, result.runtimeMetrics.memory_stats.rss_end_bytes),
            0,
          ),
          rss_peak_bytes: workerResults.reduce(
            (maxRss, result) => Math.max(maxRss, result.runtimeMetrics.memory_stats.rss_peak_bytes),
            0,
          ),
          heap_used_start_bytes: workerResults.reduce(
            (maxHeap, result) => Math.max(maxHeap, result.runtimeMetrics.memory_stats.heap_used_start_bytes),
            0,
          ),
          heap_used_end_bytes: workerResults.reduce(
            (maxHeap, result) => Math.max(maxHeap, result.runtimeMetrics.memory_stats.heap_used_end_bytes),
            0,
          ),
          heap_used_peak_bytes: workerResults.reduce(
            (maxHeap, result) => Math.max(maxHeap, result.runtimeMetrics.memory_stats.heap_used_peak_bytes),
            0,
          ),
        },
        throughput_decay: mergeThroughputDecay(
          workerResults.map((result) => result.runtimeMetrics.throughput_decay),
        ),
        worker_imbalance: computeWorkerImbalance(workerStats),
      },
    };
  } finally {
    input.abortSignal?.removeEventListener("abort", abortHandler);
    await Promise.allSettled(workers.map((worker) => worker.terminate()));
  }
}

function mergeStageTotals(stageTotalsList: Array<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const stageTotals of stageTotalsList) {
    for (const [phaseId, durationMs] of Object.entries(stageTotals)) {
      merged[phaseId] = round((merged[phaseId] ?? 0) + durationMs, 2);
    }
  }
  return merged;
}

function topSlowChunks(chunks: BenchmarkSlowChunk[], limit = 10): BenchmarkSlowChunk[] {
  return [...chunks]
    .sort((left, right) => right.wall_clock_ms - left.wall_clock_ms || left.chunk_index - right.chunk_index)
    .slice(0, limit);
}

function topSlowRows(rows: BenchmarkSlowRow[], limit = 20): BenchmarkSlowRow[] {
  return [...rows]
    .sort((left, right) => {
      const leftDuration = Math.max(left.duration_ms, left.output_latency_ms);
      const rightDuration = Math.max(right.duration_ms, right.output_latency_ms);
      return rightDuration - leftDuration || left.variant_id.localeCompare(right.variant_id);
    })
    .slice(0, limit);
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function awaitWorkerResult(
  worker: Worker,
  workerIndex: number,
): Promise<{
  predictions: BenchmarkPredictionRow[];
  processedGroups: number;
  runtimeMetrics: BenchmarkRuntimeMetrics;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let resultPayload: ParallelBenchmarkWorkerResult | null = null;
    const predictionChunks: ParallelBenchmarkWorkerChunk[] = [];

    const cleanup = (): void => {
      worker.removeAllListeners("message");
      worker.removeAllListeners("error");
      worker.removeAllListeners("exit");
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    worker.on("message", (message: ParallelBenchmarkWorkerMessage) => {
      if (settled) {
        return;
      }
      if (message.type === "chunk") {
        predictionChunks.push(message.payload);
        return;
      }
      if (message.type === "error") {
        fail(new Error(`Benchmark worker ${workerIndex} failed: ${message.error.message}`));
        return;
      }
      // The result message is the worker's final message; chunks are delivered
      // in order before it, so resolve now rather than waiting for the worker to
      // exit. Engine handles (e.g. a pooled Postgres connection) can keep a worker
      // thread alive after it has finished, which would otherwise hang Promise.all
      // and the entire run. Terminate the worker explicitly once we have results.
      resultPayload = message.payload;
      settled = true;
      cleanup();
      void worker.terminate();
      resolve({
        predictions: mergeWorkerPredictionChunks(predictionChunks),
        processedGroups: resultPayload.processedGroups,
        runtimeMetrics: resultPayload.runtimeMetrics,
      });
    });

    worker.once("error", (error) => {
      fail(new Error(`Benchmark worker ${workerIndex} crashed: ${error.message}`));
    });

    worker.once("exit", (code) => {
      if (settled) {
        return;
      }
      if (code !== 0) {
        fail(new Error(`Benchmark worker ${workerIndex} exited with code ${code}.`));
        return;
      }
      if (!resultPayload) {
        fail(new Error(`Benchmark worker ${workerIndex} exited without sending results.`));
        return;
      }
      settled = true;
      cleanup();
      resolve({
        predictions: mergeWorkerPredictionChunks(predictionChunks),
        processedGroups: resultPayload.processedGroups,
        runtimeMetrics: resultPayload.runtimeMetrics,
      });
    });
  });
}

function compactGroupForWorker(group: BenchmarkManifestRow[]): BenchmarkManifestRow[] {
  return group.map((row) => compactManifestRowForWorker(row));
}

function compactManifestRowForWorker(row: BenchmarkManifestRow): BenchmarkManifestRow {
  return {
    record_id: row.record_id,
    variant_id: row.variant_id,
    variant_kind: row.variant_kind,
    reference_type: row.reference_type,
    citation_style: row.citation_style,
    formatted_string: row.formatted_string,
    formatted_hash: row.formatted_hash,
    noise_applied: [],
    source: "",
    source_url: "",
    source_hash: "",
    language: row.language,
    input_structure: row.input_structure,
    input_source_kind: row.input_source_kind,
    expected_fields: {},
    required_fields: [],
    ...(row.style_scope ? { style_scope: row.style_scope } : {}),
    ...(row.corrected_output ? { corrected_output: row.corrected_output } : {}),
  };
}
