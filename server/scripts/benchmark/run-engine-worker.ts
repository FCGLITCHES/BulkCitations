import { parentPort, workerData } from "node:worker_threads";

import {
  runBenchmarkGroupsWithTelemetry,
  withBenchmarkConsoleMuted,
} from "../../src/benchmark/runEngineCore.ts";
import {
  resolveParallelWorkerRuntimeTuning,
  type ParallelBenchmarkWorkerRequest,
} from "../../src/benchmark/parallelRunner.ts";
import { resolveBenchmarkRunProfile } from "../../src/benchmark/runProfile.ts";
import {
  buildBenchmarkRuntimeMetrics,
  createBenchmarkProcessTelemetryCollector,
} from "../../src/benchmark/runtimeTelemetry.ts";

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error("Benchmark worker must run under worker_threads.");
  }

  const request = workerData as ParallelBenchmarkWorkerRequest;
  const baseProfile = resolveBenchmarkRunProfile(
    request.profile,
    request.hardwareProfile,
    request.benchmarkVariant,
  );
  const runProfile = {
    ...baseProfile,
    runtimeTuning: resolveParallelWorkerRuntimeTuning(baseProfile.runtimeTuning),
  };

  try {
    const predictions = await withBenchmarkConsoleMuted(async () => {
      const telemetryCollector = createBenchmarkProcessTelemetryCollector();
      if (request.warmupGroups.length > 0) {
        await runBenchmarkGroupsWithTelemetry(request.warmupGroups, {
          runProfile,
          sourceType: request.sourceType,
          parseProfile: request.parseProfile,
          benchmarkVariant: request.benchmarkVariant,
          artifactDetail: request.artifactDetail,
          collectPredictions: false,
        });
      }

      const assignedStartedAt = Date.now();
      const assignedResult = await runBenchmarkGroupsWithTelemetry(request.assignedGroups, {
        runProfile,
        sourceType: request.sourceType,
        parseProfile: request.parseProfile,
        benchmarkVariant: request.benchmarkVariant,
        artifactDetail: request.artifactDetail,
        collectPredictions: false,
        onChunkComplete: async ({ chunkIndex, predictions }) => {
          parentPort.postMessage({
            type: "chunk",
            payload: {
              chunkIndex,
              predictions,
            },
          });
          telemetryCollector.sampleMemory();
        },
      });
      telemetryCollector.sampleMemory();
      const processTelemetry = telemetryCollector.stop();
      const runtimeMetrics = buildBenchmarkRuntimeMetrics(
        {
          wallClockMs: Date.now() - assignedStartedAt,
          predictionCount: request.assignedGroups.reduce(
            (sum, group) => sum + group.length,
            0,
          ),
        },
        processTelemetry,
        {
          ...assignedResult.telemetry,
          chunkTelemetry: assignedResult.telemetry.chunkTelemetry.map((chunk) => ({
            ...chunk,
            workerIndex: request.workerIndex,
          })),
        },
        [],
        {
          slowRows: assignedResult.slowRows,
        },
      );
      runtimeMetrics.worker_stats = [
        {
          worker_index: request.workerIndex,
          prediction_count: runtimeMetrics.prediction_count,
          group_count: request.assignedGroups.length,
          wall_clock_ms: runtimeMetrics.wall_clock_ms,
          throughput_refs_per_sec: runtimeMetrics.throughput_refs_per_sec,
          cpu_user_ms: runtimeMetrics.cpu_user_ms,
          cpu_system_ms: runtimeMetrics.cpu_system_ms,
          provider_call_count: runtimeMetrics.provider_call_count,
        },
      ];

      return {
        runtimeMetrics,
      };
    });

    parentPort.postMessage({
      type: "result",
      payload: {
        processedGroups: request.assignedGroups.length,
        runtimeMetrics: predictions.runtimeMetrics,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    parentPort.postMessage({
      type: "error",
      error: {
        message,
        ...(stack ? { stack } : {}),
      },
    });
    process.exitCode = 1;
  } finally {
    runProfile.restoreEnv();
  }
}

void main();
