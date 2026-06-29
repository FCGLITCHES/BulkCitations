import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readBenchmarkArtifactDetail,
  readBenchmarkArtifactNamespace,
  readBenchmarkHardwareProfile,
  readBenchmarkRuntimeOverrides,
  readBenchmarkSliceSelection,
  readBenchmarkVariant,
} from "../../src/benchmark/executionOptions.js";
import { resolveBenchmarkPaths } from "../../src/benchmark/paths.js";
import type {
  BenchmarkEvaluationResult,
  BenchmarkMode,
  BenchmarkRunProfile,
} from "../../src/benchmark/types.js";

const SERVER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const TSX_CLI_PATH = path.join(SERVER_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

interface RunSeriesOptions {
  minThroughput: number | null;
  minP10Throughput: number | null;
  maxRssGiB: number | null;
  continueOnGateFailure: boolean;
  requireFieldHashStable: boolean;
  requireContractHashStable: boolean;
  requireGatePassAll: boolean;
}

interface BenchmarkSeriesRun {
  iteration: number;
  throughput_refs_per_sec: number;
  wall_clock_ms: number;
  rss_peak_bytes: number;
  heap_used_peak_bytes: number;
  gc_max_pause_ms: number;
  field_hash?: string;
  contract_hash?: string;
  semantic_output_hash?: string;
  result_path?: string;
  gate_passed: boolean;
  gate_error?: string;
}

async function main(): Promise<void> {
  const mode = readMode(process.argv);
  const profile = readProfile(process.argv);
  const hardwareProfile = readBenchmarkHardwareProfile(process.argv);
  const benchmarkVariant = readBenchmarkVariant(process.argv);
  const artifactDetail = readBenchmarkArtifactDetail(process.argv);
  const runtimeOverrides = readBenchmarkRuntimeOverrides(process.argv);
  const artifactNamespace = readBenchmarkArtifactNamespace(process.argv);
  const { sliceLabel } = readBenchmarkSliceSelection(process.argv);
  const iterations = readIterations(process.argv);
  const options = readSeriesOptions(process.argv);
  const sharedArgs = process.argv.slice(2).filter((entry) => !isSeriesOnlyFlag(entry));
  const runs: BenchmarkSeriesRun[] = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    await execTsx("scripts/benchmark/run-engine.ts", sharedArgs);
    const evaluation = await execTsxJson<BenchmarkEvaluationResult & {
      run_artifacts?: { resultPath?: string };
    }>("scripts/benchmark/evaluate.ts", sharedArgs);

    let gatePassed = true;
    let gateError: string | undefined;
    try {
      await execTsx("scripts/benchmark/ci-gate.ts", sharedArgs);
    } catch (error) {
      gatePassed = false;
      gateError = error instanceof Error ? error.message : String(error);
      if (!options.continueOnGateFailure) {
        throw error;
      }
    }

    runs.push({
      iteration,
      throughput_refs_per_sec: evaluation.runtime_metrics?.throughput_refs_per_sec ?? 0,
      wall_clock_ms: evaluation.runtime_metrics?.wall_clock_ms ?? 0,
      rss_peak_bytes: evaluation.runtime_metrics?.memory_stats.rss_peak_bytes ?? 0,
      heap_used_peak_bytes: evaluation.runtime_metrics?.memory_stats.heap_used_peak_bytes ?? 0,
      gc_max_pause_ms: evaluation.runtime_metrics?.gc_stats.max_pause_ms ?? 0,
      field_hash: evaluation.field_hash,
      contract_hash: evaluation.contract_hash,
      semantic_output_hash: evaluation.semantic_output_hash,
      result_path: evaluation.run_artifacts?.resultPath,
      gate_passed: gatePassed,
      ...(gateError ? { gate_error: gateError } : {}),
    });
  }

  const throughputs = runs.map((run) => run.throughput_refs_per_sec);
  const sortedThroughputs = [...throughputs].sort((left, right) => left - right);
  const medianThroughput = quantile(sortedThroughputs, 0.5);
  const p10Throughput = quantile(sortedThroughputs, 0.1);
  const bestThroughput = sortedThroughputs[sortedThroughputs.length - 1] ?? 0;
  const worstThroughput = sortedThroughputs[0] ?? 0;

  const rssPeaks = runs.map((run) => run.rss_peak_bytes);
  const maxRssBytes = Math.max(...rssPeaks, 0);
  const maxRssGiB = bytesToGiB(maxRssBytes);

  const fieldHashStats = summarizeHashes(runs.map((run) => run.field_hash));
  const contractHashStats = summarizeHashes(runs.map((run) => run.contract_hash));
  const semanticHashStats = summarizeHashes(runs.map((run) => run.semantic_output_hash));
  const gatePassCount = runs.filter((run) => run.gate_passed).length;
  const gateFailCount = runs.length - gatePassCount;
  const thresholdFailures = evaluateSeriesThresholds({
    options,
    throughput: {
      min: worstThroughput,
      p10: p10Throughput,
      median: medianThroughput,
      max: bestThroughput,
    },
    maxRssGiB,
    fieldHashStable: fieldHashStats.stable,
    contractHashStable: contractHashStats.stable,
    gatePassCount,
    iterations,
  });

  const summary = {
    mode,
    profile,
    hardwareProfile,
    benchmarkVariant,
    artifactDetail,
    ...(Object.keys(runtimeOverrides).length === 0 ? {} : { runtimeOverrides }),
    artifactNamespace,
    sliceLabel,
    iterations,
    throughput_refs_per_sec: {
      min: worstThroughput,
      p10: p10Throughput,
      median: medianThroughput,
      max: bestThroughput,
    },
    rss_peak_gib: {
      max: maxRssGiB,
      min: bytesToGiB(Math.min(...rssPeaks, maxRssBytes)),
    },
    gate: {
      pass_count: gatePassCount,
      fail_count: gateFailCount,
      pass_rate: round(iterations > 0 ? gatePassCount / iterations : 0, 4),
    },
    field_hash_stable: fieldHashStats.stable,
    contract_hash_stable: contractHashStats.stable,
    semantic_output_hash_stable: semanticHashStats.stable,
    hash_consistency: {
      field_hash: fieldHashStats,
      contract_hash: contractHashStats,
      semantic_output_hash: semanticHashStats,
    },
    thresholds: {
      ...(options.minThroughput == null ? {} : { min_throughput: options.minThroughput }),
      ...(options.minP10Throughput == null ? {} : { min_p10_throughput: options.minP10Throughput }),
      ...(options.maxRssGiB == null ? {} : { max_rss_gib: options.maxRssGiB }),
      require_field_hash_stable: options.requireFieldHashStable,
      require_contract_hash_stable: options.requireContractHashStable,
      require_gate_pass_all: options.requireGatePassAll,
      continue_on_gate_failure: options.continueOnGateFailure,
    },
    threshold_failures: thresholdFailures,
    runs,
  };

  const paths = resolveBenchmarkPaths(mode, profile, {
    hardwareProfile,
    benchmarkVariant,
    artifactNamespace,
    sliceLabel,
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summaryPath = path.join(paths.resultsDir, `${paths.artifactPrefix}.series_${stamp}.json`);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        ...summary,
        summary_path: summaryPath,
      },
      null,
      2,
    )}\n`,
  );

  if (thresholdFailures.length > 0) {
    throw new Error(thresholdFailures.join("\n"));
  }
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
  return "heuristic-only";
}

function readIterations(argv: string[]): number {
  const rawValue = argv.find((entry) => entry.startsWith("--iterations="))?.slice("--iterations=".length);
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : 3;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Benchmark run series requires --iterations to be a positive integer.");
  }
  return parsed;
}

function readSeriesOptions(argv: string[]): RunSeriesOptions {
  return {
    minThroughput: readPositiveNumberFlag(argv, "--minThroughput="),
    minP10Throughput: readPositiveNumberFlag(argv, "--minP10Throughput="),
    maxRssGiB: readPositiveNumberFlag(argv, "--maxRssGiB="),
    continueOnGateFailure: readBooleanFlag(argv, "--continueOnGateFailure=", false),
    requireFieldHashStable: readBooleanFlag(argv, "--requireFieldHashStable=", false),
    requireContractHashStable: readBooleanFlag(argv, "--requireContractHashStable=", false),
    requireGatePassAll: readBooleanFlag(argv, "--requireGatePassAll=", false),
  };
}

function readPositiveNumberFlag(argv: string[], flag: string): number | null {
  const rawValue = argv.find((entry) => entry.startsWith(flag))?.slice(flag.length);
  if (rawValue == null) {
    return null;
  }
  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag.slice(2, -1)} must be a positive number.`);
  }
  return parsed;
}

function readBooleanFlag(argv: string[], flag: string, defaultValue: boolean): boolean {
  const rawValue = argv.find((entry) => entry.startsWith(flag))?.slice(flag.length);
  if (rawValue == null) {
    return defaultValue;
  }
  if (rawValue === "true" || rawValue === "1") {
    return true;
  }
  if (rawValue === "false" || rawValue === "0") {
    return false;
  }
  throw new Error(`${flag.slice(2, -1)} must be true/false (or 1/0).`);
}

function isSeriesOnlyFlag(entry: string): boolean {
  return entry.startsWith("--iterations=")
    || entry.startsWith("--minThroughput=")
    || entry.startsWith("--minP10Throughput=")
    || entry.startsWith("--maxRssGiB=")
    || entry.startsWith("--continueOnGateFailure=")
    || entry.startsWith("--requireFieldHashStable=")
    || entry.startsWith("--requireContractHashStable=")
    || entry.startsWith("--requireGatePassAll=");
}

function quantile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0] ?? 0;
  }

  const clamped = Math.min(Math.max(percentile, 0), 1);
  const rank = (sortedValues.length - 1) * clamped;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sortedValues[lowerIndex] ?? 0;
  const upper = sortedValues[upperIndex] ?? lower;
  if (lowerIndex === upperIndex) {
    return round(lower, 2);
  }
  const ratio = rank - lowerIndex;
  return round(lower + (upper - lower) * ratio, 2);
}

function summarizeHashes(hashes: Array<string | undefined>): {
  stable: boolean;
  unique_count: number;
  values: string[];
  dominant_hash: string | null;
  dominant_count: number;
} {
  const filtered = hashes.filter((value): value is string => Boolean(value));
  const counts = new Map<string, number>();
  for (const value of filtered) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values = [...counts.keys()].sort();
  let dominantHash: string | null = null;
  let dominantCount = 0;
  for (const value of values) {
    const count = counts.get(value) ?? 0;
    if (count > dominantCount) {
      dominantHash = value;
      dominantCount = count;
    }
  }
  return {
    stable: values.length <= 1,
    unique_count: values.length,
    values,
    dominant_hash: dominantHash,
    dominant_count: dominantCount,
  };
}

function evaluateSeriesThresholds(input: {
  options: RunSeriesOptions;
  throughput: {
    min: number;
    p10: number;
    median: number;
    max: number;
  };
  maxRssGiB: number;
  fieldHashStable: boolean;
  contractHashStable: boolean;
  gatePassCount: number;
  iterations: number;
}): string[] {
  const failures: string[] = [];
  if (input.options.minThroughput != null && input.throughput.min < input.options.minThroughput) {
    failures.push(
      `Series minimum throughput ${input.throughput.min} refs/sec below required ${input.options.minThroughput} refs/sec.`,
    );
  }
  if (input.options.minP10Throughput != null && input.throughput.p10 < input.options.minP10Throughput) {
    failures.push(
      `Series p10 throughput ${input.throughput.p10} refs/sec below required ${input.options.minP10Throughput} refs/sec.`,
    );
  }
  if (input.options.maxRssGiB != null && input.maxRssGiB > input.options.maxRssGiB) {
    failures.push(
      `Series max RSS ${input.maxRssGiB} GiB above required ceiling ${input.options.maxRssGiB} GiB.`,
    );
  }
  if (input.options.requireFieldHashStable && !input.fieldHashStable) {
    failures.push("Series field hash drift detected across runs.");
  }
  if (input.options.requireContractHashStable && !input.contractHashStable) {
    failures.push("Series contract hash drift detected across runs.");
  }
  if (input.options.requireGatePassAll && input.gatePassCount !== input.iterations) {
    failures.push(
      `Series gate pass count ${input.gatePassCount}/${input.iterations} did not satisfy all-runs pass requirement.`,
    );
  }
  return failures;
}

function bytesToGiB(bytes: number): number {
  return round(bytes / (1024 ** 3), 3);
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

async function execTsx(scriptPath: string, args: string[]): Promise<void> {
  await execTsxJson(scriptPath, args);
}

async function execTsxJson<T>(scriptPath: string, args: string[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI_PATH, scriptPath, ...args],
      {
        cwd: SERVER_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      reject(error);
    });
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Command failed with exit code ${code}.`));
        return;
      }
      try {
        const jsonText = extractTrailingJson(stdout);
        resolve(JSON.parse(jsonText) as T);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse benchmark script output for ${scriptPath}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  });
}

// One-shot CLI: force clean exit so pooled handles don't keep the process alive
// after the series completes (see run-engine.ts for the same rationale).
main().then(
  () => {
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

function extractTrailingJson(stdout: string): string {
  const trimmed = stdout.trim();
  const lastBlockStart = trimmed.lastIndexOf("\n{");
  if (lastBlockStart >= 0) {
    return trimmed.slice(lastBlockStart + 1);
  }
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace >= 0) {
    return trimmed.slice(firstBrace);
  }
  throw new Error("Benchmark script did not emit JSON output.");
}
