import { fileURLToPath } from "node:url";
import path from "node:path";

import type {
  BenchmarkHardwareProfile,
  BenchmarkMode,
  BenchmarkRunProfile,
  BenchmarkVariant,
} from "./types.js";

const BENCHMARK_ROOT = path.resolve(
  fileURLToPath(new URL("../../../benchmarks/grobid-pmc", import.meta.url)),
);

type BenchmarkResultsDestination = "checked-in" | "local";

export interface BenchmarkPaths {
  root: string;
  corpusDir: string;
  rawSourcesDir: string;
  stylesDir: string;
  checkedInResultsDir: string;
  resultsDir: string;
  artifactDestination: BenchmarkResultsDestination;
  profile: BenchmarkRunProfile;
  artifactPrefix: string;
  manifestSchemaPath: string;
  manifestPath: string;
  formattedStringsPath: string;
  noiseLogPath: string;
  parserOutputPath: string;
  runtimeMetricsPath: string;
  latestResultPath: string;
  latestSummaryPath: string;
  latestDebugPath: string;
  latestDebugSummaryPath: string;
}

export interface BenchmarkPathOptions {
  hardwareProfile?: BenchmarkHardwareProfile;
  benchmarkVariant?: BenchmarkVariant;
  artifactNamespace?: string;
  sliceLabel?: string;
}

export function resolveBenchmarkPaths(
  mode: BenchmarkMode,
  profile: BenchmarkRunProfile = "heuristic-only",
  options: BenchmarkPathOptions = {},
): BenchmarkPaths {
  const corpusDir = path.join(BENCHMARK_ROOT, "corpus");
  const checkedInResultsDir = path.join(BENCHMARK_ROOT, "results");
  const artifactDestination = readBenchmarkResultsDestination();
  const resultsDir = artifactDestination === "local"
    ? path.join(checkedInResultsDir, "local")
    : checkedInResultsDir;
  const artifactPrefix = benchmarkArtifactPrefix(mode, profile, options);
  return {
    root: BENCHMARK_ROOT,
    corpusDir,
    rawSourcesDir: path.join(corpusDir, "raw_sources"),
    stylesDir: path.join(BENCHMARK_ROOT, "styles"),
    checkedInResultsDir,
    resultsDir,
    artifactDestination,
    profile,
    artifactPrefix,
    manifestSchemaPath: path.join(BENCHMARK_ROOT, "manifest.schema.json"),
    manifestPath: path.join(corpusDir, `${mode}.manifest.json`),
    formattedStringsPath: path.join(corpusDir, `${mode}.formatted_strings.txt`),
    noiseLogPath: path.join(corpusDir, `${mode}.noise_log.json`),
    parserOutputPath: path.join(resultsDir, `${artifactPrefix}.parser_output.json`),
    runtimeMetricsPath: path.join(resultsDir, `${artifactPrefix}.runtime_metrics.json`),
    latestResultPath: path.join(resultsDir, `${artifactPrefix}.latest.json`),
    latestSummaryPath: path.join(resultsDir, `${artifactPrefix}.summary.md`),
    latestDebugPath: path.join(resultsDir, `${artifactPrefix}.debug.json`),
    latestDebugSummaryPath: path.join(resultsDir, `${artifactPrefix}.debug.md`),
  };
}

export function benchmarkArtifactPrefix(
  mode: BenchmarkMode,
  profile: BenchmarkRunProfile,
  options: BenchmarkPathOptions = {},
): string {
  const profilePrefix = profile === "heuristic-only" ? mode : `${mode}.${profile}`;
  const suffixes = [
    options.artifactNamespace ?? null,
    options.benchmarkVariant && options.benchmarkVariant !== "grobid_compare"
      ? options.benchmarkVariant
      : null,
    options.hardwareProfile && options.hardwareProfile !== "default"
      ? options.hardwareProfile
      : null,
    options.sliceLabel ?? null,
  ].filter(
    (value): value is string =>
      value != null,
  );

  return suffixes.length > 0
    ? `${profilePrefix}.${suffixes.join(".")}`
    : profilePrefix;
}

export function benchmarkBaselinePath(
  mode: BenchmarkMode,
  profile: BenchmarkRunProfile,
  stamp: string,
  options: BenchmarkPathOptions = {},
): string {
  const resultsDir = resolveBenchmarkPaths(mode, profile, options).checkedInResultsDir;
  const prefix = benchmarkArtifactPrefix(mode, profile, options);
  return path.join(resultsDir, `${prefix}.baseline_${stamp}.json`);
}

export interface BenchmarkRunArtifactPaths {
  resultPath: string;
  summaryPath: string;
  debugPath: string;
  debugSummaryPath: string;
}

export function benchmarkRunArtifactPaths(
  mode: BenchmarkMode,
  profile: BenchmarkRunProfile,
  stamp: string,
  options: BenchmarkPathOptions = {},
): BenchmarkRunArtifactPaths {
  const safeStamp = sanitizeBenchmarkStamp(stamp);
  const resultsDir = resolveBenchmarkPaths(mode, profile, options).resultsDir;
  const prefix = benchmarkArtifactPrefix(mode, profile, options);
  return {
    resultPath: path.join(resultsDir, `${prefix}.run_${safeStamp}.json`),
    summaryPath: path.join(resultsDir, `${prefix}.summary_${safeStamp}.md`),
    debugPath: path.join(resultsDir, `${prefix}.debug_${safeStamp}.json`),
    debugSummaryPath: path.join(resultsDir, `${prefix}.debug_${safeStamp}.md`),
  };
}

function sanitizeBenchmarkStamp(stamp: string): string {
  return stamp.replace(/[:.]/g, "-");
}

function readBenchmarkResultsDestination(): BenchmarkResultsDestination {
  const configured = process.env.BENCHMARK_RESULTS_DESTINATION;
  if (configured === "checked-in" || configured === "local") {
    return configured;
  }

  return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
    ? "checked-in"
    : "local";
}
