import { mkdir, readFile, writeFile } from "node:fs/promises";

import { assertManifestFormattedAlignment } from "../../src/benchmark/integrity.js";
import {
  readBenchmarkArtifactDetail,
  readBenchmarkArtifactNamespace,
  readBenchmarkHardwareProfile,
  readBenchmarkParseProfile,
  readBenchmarkRuntimeOverrides,
  readBenchmarkSliceSelection,
  readBenchmarkSourceType,
  readBenchmarkVariant,
} from "../../src/benchmark/executionOptions.js";
import { resolveBenchmarkPaths } from "../../src/benchmark/paths.js";
import {
  buildBenchmarkExecutionPlan,
  coalesceBenchmarkExecutionGroups,
  groupManifestRows,
  runBenchmarkGroupsWithTelemetry,
  withBenchmarkConsoleMuted,
} from "../../src/benchmark/runEngineCore.js";
import {
  runParallelBenchmarkGroupsWithMetrics,
  shouldUseParallelBenchmarkVariant,
} from "../../src/benchmark/parallelRunner.js";
import { resolveBenchmarkRunProfile } from "../../src/benchmark/runProfile.js";
import {
  applyBenchmarkSlice,
  assertSlicedBenchmarkAlignment,
  describeBenchmarkSlice,
} from "../../src/benchmark/selection.js";
import { computeBenchmarkSemanticOutputSummary } from "../../src/benchmark/semanticHash.js";
import {
  buildBenchmarkRuntimeMetrics,
  createBenchmarkProcessTelemetryCollector,
} from "../../src/benchmark/runtimeTelemetry.js";
import {
  validateBenchmarkManifest,
  validateBenchmarkPredictions,
  validateBenchmarkRuntimeMetrics,
} from "../../src/benchmark/schema.js";
import type {
  BenchmarkManifestRow,
  BenchmarkMode,
  BenchmarkPredictionRow,
  BenchmarkRunProfile,
  BenchmarkRuntimeMetrics,
} from "../../src/benchmark/types.js";

process.env.BULKREFERENCES_ISOLATED_RUNTIME ??= "true";

async function main(): Promise<void> {
  const mode = readMode(process.argv);
  const profile = readProfile(process.argv);
  const sourceType = readBenchmarkSourceType(process.argv);
  const parseProfile = readBenchmarkParseProfile(process.argv);
  const hardwareProfile = readBenchmarkHardwareProfile(process.argv);
  const benchmarkVariant = readBenchmarkVariant(process.argv);
  const artifactDetail = readBenchmarkArtifactDetail(process.argv);
  const runtimeOverrides = readBenchmarkRuntimeOverrides(process.argv);
  const artifactNamespace = readBenchmarkArtifactNamespace(process.argv);
  const { sliceLabel, slicePreset, sliceRange } = readBenchmarkSliceSelection(process.argv);
  const abortController = new AbortController();
  const cleanupSignalHandlers = installAbortSignalHandlers(abortController);
  const paths = resolveBenchmarkPaths(mode, profile, {
    hardwareProfile,
    benchmarkVariant,
    artifactNamespace,
    sliceLabel,
  });
  const manifest = validateBenchmarkManifest(
    JSON.parse(await readFile(paths.manifestPath, "utf8")) as BenchmarkManifestRow[],
    mode,
  );
  const inputs = (await readFile(paths.formattedStringsPath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  assertManifestFormattedAlignment(manifest, inputs);
  const scopedManifest = applyBenchmarkSlice(manifest, sliceRange);
  const scopedInputs = applyBenchmarkSlice(inputs, sliceRange);
  assertSlicedBenchmarkAlignment(scopedManifest, scopedInputs, sliceRange);

  const runProfile = resolveBenchmarkRunProfile(
    profile,
    hardwareProfile,
    benchmarkVariant,
    runtimeOverrides,
  );
  const groupedRows = groupManifestRows(scopedManifest);
  const executionOptions = {
    runProfile,
    sourceType,
    parseProfile,
    benchmarkVariant,
    artifactDetail,
    abortSignal: abortController.signal,
  } as const;
  const executionPlan = buildBenchmarkExecutionPlan(
    groupedRows,
    runProfile.hardwareWarmupRefs,
    executionOptions,
  );
  const executionGroups = executionPlan.executionGroups;
  const warmupExecutionGroups = executionPlan.warmupExecutionGroups;
  const manifestIndex = new Map(scopedManifest.map((row, index) => [row.variant_id, index] as const));
  let predictions: BenchmarkPredictionRow[] = [];
  let runtimeMetrics: BenchmarkRuntimeMetrics = {
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
  };

  try {
    predictions = await withBenchmarkConsoleMuted(async () => {
      if (shouldUseParallelBenchmarkVariant({
        benchmarkVariant,
        totalRows: scopedManifest.length,
        runtimeTuning: runProfile.runtimeTuning,
        multicoreThreshold: runProfile.multicoreThreshold,
      })) {
        const parallelResult = await runParallelBenchmarkGroupsWithMetrics({
          groups: executionGroups,
          profile,
          hardwareProfile: runProfile.hardwareProfile,
          benchmarkVariant,
          sourceType,
          parseProfile,
          artifactDetail,
          requestedWorkers: runProfile.runtimeTuning?.maxConcurrency ?? 1,
          warmupGroups: warmupExecutionGroups,
          abortSignal: abortController.signal,
        });
        runtimeMetrics = parallelResult.runtimeMetrics;
        return parallelResult.predictions;
      }

      if (warmupExecutionGroups.length > 0) {
        await runBenchmarkGroupsWithTelemetry(warmupExecutionGroups, executionOptions);
      }

      const telemetryCollector = createBenchmarkProcessTelemetryCollector();
      const startedAt = Date.now();
      const directResult = await runBenchmarkGroupsWithTelemetry(executionGroups, executionOptions);
      telemetryCollector.sampleMemory();
      runtimeMetrics = buildBenchmarkRuntimeMetrics(
        {
          wallClockMs: Date.now() - startedAt,
          predictionCount: directResult.predictions.length,
        },
        telemetryCollector.stop(),
        directResult.telemetry,
        directResult.predictions,
      );
      runtimeMetrics.worker_stats = [
        {
          worker_index: 0,
          prediction_count: directResult.predictions.length,
          group_count: executionGroups.length,
          wall_clock_ms: runtimeMetrics.wall_clock_ms,
          throughput_refs_per_sec: runtimeMetrics.throughput_refs_per_sec,
          cpu_user_ms: runtimeMetrics.cpu_user_ms,
          cpu_system_ms: runtimeMetrics.cpu_system_ms,
          provider_call_count: runtimeMetrics.provider_call_count,
        },
      ];
      return directResult.predictions;
    });
  } finally {
    runProfile.restoreEnv();
    cleanupSignalHandlers();
  }

  const validatedPredictions = validateBenchmarkPredictions(
    predictions.sort(
      (left, right) =>
        (manifestIndex.get(left.variant_id) ?? Number.MAX_SAFE_INTEGER)
        - (manifestIndex.get(right.variant_id) ?? Number.MAX_SAFE_INTEGER),
    ),
    mode,
  );
  const semanticOutput = computeBenchmarkSemanticOutputSummary(validatedPredictions);
  const validatedRuntimeMetrics = validateBenchmarkRuntimeMetrics(runtimeMetrics);
  await mkdir(paths.resultsDir, { recursive: true });
  await writeFile(paths.parserOutputPath, JSON.stringify(validatedPredictions, null, 2), "utf8");
  await writeFile(paths.runtimeMetricsPath, JSON.stringify(validatedRuntimeMetrics, null, 2), "utf8");
  process.stdout.write(
    `${JSON.stringify(
        {
          mode,
          profile,
          artifactDetail,
          sourceType,
          parseProfile,
        hardwareProfile: runProfile.hardwareProfile,
        benchmarkVariant,
        ...(artifactNamespace ? { artifactNamespace } : {}),
        ...(Object.keys(runtimeOverrides).length === 0 ? {} : { runtimeOverrides }),
        semanticOutputHash: semanticOutput.semanticOutputHash,
        fieldHash: semanticOutput.fieldHash,
        contractHash: semanticOutput.contractHash,
        ...(slicePreset ? { slicePreset } : {}),
        ...(sliceRange
          ? {
              sliceStart: sliceRange.startRow,
              sliceEnd: sliceRange.endRow,
              sliceRows: scopedManifest.length,
              sliceDescription: describeBenchmarkSlice(sliceRange),
            }
          : {}),
        runtimeTuning: runProfile.runtimeTuning,
        runtimeMetrics: validatedRuntimeMetrics,
        parserOutputPath: paths.parserOutputPath,
        runtimeMetricsPath: paths.runtimeMetricsPath,
        predictions: validatedPredictions.length,
      },
      null,
      2,
    )}\n`,
  );
}

function readMode(argv: string[]): BenchmarkMode {
  const match = argv.find((entry) => entry.startsWith("--mode="));
  return match?.slice("--mode=".length) === "pilot" ? "pilot" : "full";
}

function readProfile(argv: string[]): BenchmarkRunProfile {
  const match = argv.find((entry) => entry.startsWith("--profile="));
  const value = match?.slice("--profile=".length);
  if (value === "hybrid-ml") {
    return "hybrid-ml";
  }
  if (value === "current-runtime-stable350") {
    return "current-runtime-stable350";
  }
  if (value === "current-runtime") {
    return "current-runtime";
  }
  if (value === "site-faithful") {
    return "site-faithful";
  }
  return "heuristic-only";
}

function installAbortSignalHandlers(controller: AbortController): () => void {
  const onAbortSignal = (signal: NodeJS.Signals) => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`Benchmark run aborted by ${signal}.`));
    }
  };

  process.on("SIGINT", onAbortSignal);
  process.on("SIGTERM", onAbortSignal);

  return () => {
    process.off("SIGINT", onAbortSignal);
    process.off("SIGTERM", onAbortSignal);
  };
}

// One-shot benchmark CLI: force a clean exit once the run completes and artifacts
// are written. Without this, module-level pooled handles (Postgres/Redis) keep the
// event loop alive and the process hangs indefinitely after finishing its work,
// piling up zombie processes that starve later runs of CPU.
main().then(
  () => {
    process.exit(0);
  },
  (error: unknown) => {
    // Log defensively: util.inspect on some rejection values crashes on Node 24
    // ("Cannot read properties of undefined (reading 'value')"), which would otherwise mask the
    // real benchmark error behind a logging crash. Print the stack/string form instead.
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  },
);
