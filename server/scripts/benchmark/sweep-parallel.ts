import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readBenchmarkArtifactDetail,
  readBenchmarkHardwareProfile,
  readBenchmarkSliceSelection,
  readBenchmarkVariant,
} from "../../src/benchmark/executionOptions.js";
import { resolveBenchmarkPaths } from "../../src/benchmark/paths.js";
import type {
  BenchmarkMode,
  BenchmarkRunProfile,
} from "../../src/benchmark/types.js";

const SERVER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const TSX_CLI_PATH = path.join(SERVER_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

interface BenchmarkSeriesSummary {
  throughput_refs_per_sec?: {
    min?: number;
    p10?: number;
    median?: number;
    max?: number;
  };
  rss_peak_gib?: {
    max?: number;
  };
  gate?: {
    pass_count?: number;
    fail_count?: number;
  };
  field_hash_stable?: boolean;
  contract_hash_stable?: boolean;
  threshold_failures?: string[];
  summary_path?: string;
}

interface SweepResultRow {
  worker_count: number;
  chunk_size: number;
  throughput_min_refs_per_sec: number;
  throughput_p10_refs_per_sec: number;
  throughput_median_refs_per_sec: number;
  throughput_max_refs_per_sec: number;
  rss_peak_max_gib: number;
  field_hash_stable: boolean;
  contract_hash_stable: boolean;
  gate_pass_count: number;
  gate_fail_count: number;
  stable: boolean;
  threshold_failures: string[];
  summary_path?: string;
}

async function main(): Promise<void> {
  const mode = readMode(process.argv);
  const profile = readProfile(process.argv);
  const benchmarkVariant = readBenchmarkVariant(process.argv);
  if (benchmarkVariant !== "parallel") {
    throw new Error("Parallel sweep requires --benchmarkVariant=parallel.");
  }
  const hardwareProfile = readBenchmarkHardwareProfile(process.argv);
  const artifactDetail = readBenchmarkArtifactDetail(process.argv);
  const iterations = readIterations(process.argv);
  const workers = readPositiveIntegerList(process.argv, "--workers=", [8, 9, 10, 11]);
  const chunkSizes = readPositiveIntegerList(process.argv, "--chunkSizes=", [64, 128, 256, 512]);
  const namespacePrefix = readNamespacePrefix(process.argv);
  const { sliceLabel } = readBenchmarkSliceSelection(process.argv);

  const baseArgs = process.argv
    .slice(2)
    .filter((entry) => !isSweepOnlyFlag(entry))
    .filter((entry) => !entry.startsWith("--artifactNamespace="))
    .filter((entry) => !entry.startsWith("--maxConcurrency="))
    .filter((entry) => !entry.startsWith("--chunkSize="))
    .filter((entry) => !entry.startsWith("--iterations="))
    .filter((entry) => !entry.startsWith("--continueOnGateFailure="))
    .filter((entry) => !entry.startsWith("--requireFieldHashStable="))
    .filter((entry) => !entry.startsWith("--requireContractHashStable="))
    .filter((entry) => !entry.startsWith("--requireGatePassAll="))
    .filter((entry) => !entry.startsWith("--minThroughput="))
    .filter((entry) => !entry.startsWith("--minP10Throughput="))
    .filter((entry) => !entry.startsWith("--maxRssGiB="));

  const rows: SweepResultRow[] = [];
  for (const workerCount of workers) {
    for (const chunkSize of chunkSizes) {
      const runNamespace = `${namespacePrefix}_w${workerCount}_b${chunkSize}`;
      const runArgs = [
        ...baseArgs,
        `--iterations=${iterations}`,
        `--artifactNamespace=${runNamespace}`,
        `--maxConcurrency=${workerCount}`,
        `--chunkSize=${chunkSize}`,
        "--continueOnGateFailure=true",
      ];
      const summary = await execTsxJson<BenchmarkSeriesSummary>(
        "scripts/benchmark/run-series.ts",
        runArgs,
      );
      const gatePassCount = summary.gate?.pass_count ?? 0;
      const gateFailCount = summary.gate?.fail_count ?? 0;
      const stable = Boolean(
        summary.field_hash_stable
        && summary.contract_hash_stable
        && gateFailCount === 0,
      );
      rows.push({
        worker_count: workerCount,
        chunk_size: chunkSize,
        throughput_min_refs_per_sec: summary.throughput_refs_per_sec?.min ?? 0,
        throughput_p10_refs_per_sec: summary.throughput_refs_per_sec?.p10 ?? 0,
        throughput_median_refs_per_sec: summary.throughput_refs_per_sec?.median ?? 0,
        throughput_max_refs_per_sec: summary.throughput_refs_per_sec?.max ?? 0,
        rss_peak_max_gib: summary.rss_peak_gib?.max ?? 0,
        field_hash_stable: Boolean(summary.field_hash_stable),
        contract_hash_stable: Boolean(summary.contract_hash_stable),
        gate_pass_count: gatePassCount,
        gate_fail_count: gateFailCount,
        stable,
        threshold_failures: summary.threshold_failures ?? [],
        ...(summary.summary_path ? { summary_path: summary.summary_path } : {}),
      });
    }
  }

  const ranked = [...rows].sort((left, right) => {
    if (left.stable !== right.stable) {
      return left.stable ? -1 : 1;
    }
    if (left.throughput_min_refs_per_sec !== right.throughput_min_refs_per_sec) {
      return right.throughput_min_refs_per_sec - left.throughput_min_refs_per_sec;
    }
    if (left.throughput_p10_refs_per_sec !== right.throughput_p10_refs_per_sec) {
      return right.throughput_p10_refs_per_sec - left.throughput_p10_refs_per_sec;
    }
    if (left.rss_peak_max_gib !== right.rss_peak_max_gib) {
      return left.rss_peak_max_gib - right.rss_peak_max_gib;
    }
    return left.worker_count - right.worker_count || left.chunk_size - right.chunk_size;
  });

  const winner = ranked[0] ?? null;
  const sweepSummary = {
    generated_at: new Date().toISOString(),
    mode,
    profile,
    benchmark_variant: benchmarkVariant,
    hardware_profile: hardwareProfile,
    artifact_detail: artifactDetail,
    iterations,
    workers,
    chunk_sizes: chunkSizes,
    namespace_prefix: namespacePrefix,
    row_count: rows.length,
    winner,
    rows: ranked,
  };

  const paths = resolveBenchmarkPaths(mode, profile, {
    hardwareProfile,
    benchmarkVariant,
    artifactNamespace: namespacePrefix,
    sliceLabel,
  });
  await mkdir(paths.resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sweepPath = path.join(paths.resultsDir, `${paths.artifactPrefix}.sweep_${stamp}.json`);
  await writeFile(sweepPath, JSON.stringify(sweepSummary, null, 2), "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        ...sweepSummary,
        sweep_path: sweepPath,
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
  return "heuristic-only";
}

function readIterations(argv: string[]): number {
  const rawValue = argv.find((entry) => entry.startsWith("--iterations="))?.slice("--iterations=".length);
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : 3;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Benchmark sweep requires --iterations to be a positive integer.");
  }
  return parsed;
}

function readPositiveIntegerList(
  argv: string[],
  flag: string,
  fallback: number[],
): number[] {
  const rawValue = argv.find((entry) => entry.startsWith(flag))?.slice(flag.length);
  if (!rawValue) {
    return fallback;
  }

  const parsed = rawValue
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (parsed.length === 0) {
    throw new Error(`${flag.slice(2, -1)} requires at least one positive integer.`);
  }
  return [...new Set(parsed)];
}

function readNamespacePrefix(argv: string[]): string {
  const rawValue = argv.find((entry) => entry.startsWith("--namespacePrefix="))
    ?.slice("--namespacePrefix=".length);
  const value = rawValue?.trim() || "parallel_sweep";
  if (!/^[a-z0-9_]+$/u.test(value)) {
    throw new Error("Sweep namespace prefix must use lowercase letters, numbers, and underscores.");
  }
  return value;
}

function isSweepOnlyFlag(entry: string): boolean {
  return entry.startsWith("--workers=")
    || entry.startsWith("--chunkSizes=")
    || entry.startsWith("--namespacePrefix=");
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

void main();
