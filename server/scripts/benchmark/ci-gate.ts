import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { evaluateBenchmarkGate } from "../../src/benchmark/gating.js";
import {
  readBenchmarkArtifactNamespace,
  readBenchmarkHardwareProfile,
  readBenchmarkSliceSelection,
  readBenchmarkVariant,
} from "../../src/benchmark/executionOptions.js";
import { benchmarkArtifactPrefix, resolveBenchmarkPaths } from "../../src/benchmark/paths.js";
import { validateBenchmarkEvaluation } from "../../src/benchmark/schema.js";
import type { BenchmarkEvaluationResult, BenchmarkMode, BenchmarkRunProfile } from "../../src/benchmark/types.js";

async function main(): Promise<void> {
  const mode = readMode(process.argv);
  const profile = readProfile(process.argv);
  const hardwareProfile = readBenchmarkHardwareProfile(process.argv);
  const benchmarkVariant = readBenchmarkVariant(process.argv);
  const artifactNamespace = readBenchmarkArtifactNamespace(process.argv);
  const { sliceLabel } = readBenchmarkSliceSelection(process.argv);
  const pathOptions = {
    hardwareProfile,
    benchmarkVariant,
    artifactNamespace,
    sliceLabel,
  };
  const paths = resolveBenchmarkPaths(mode, profile, pathOptions);
  const resultsPath = readArg(process.argv, "--results") ?? paths.latestResultPath;
  const baselinePath = readArg(process.argv, "--baseline") ?? await findLatestBaselinePath(mode, profile, pathOptions);
  const result = validateBenchmarkEvaluation(
    JSON.parse(await readFile(resultsPath, "utf8")) as BenchmarkEvaluationResult,
    mode,
  );
  const baseline = baselinePath
    ? validateBenchmarkEvaluation(
        JSON.parse(await readFile(baselinePath, "utf8")) as BenchmarkEvaluationResult,
        mode,
      )
    : undefined;
  const gate = evaluateBenchmarkGate(result, baseline);

  if (gate.failures.length > 0) {
    process.stderr.write(`${gate.failures.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode,
        profile,
        status: "pass",
        macroSoftF1: gate.cleanPartition.by_tier.soft.macro_field_f1,
        instanceSoftF1: gate.cleanPartition.by_tier.soft.instance.f1,
        normalizedCitationExactMatchRate: gate.cleanPartition.topline.normalized_citation_exact_match_rate,
        requiredFieldCompleteness: gate.cleanPartition.topline.required_field_completeness,
        falseFillRate: gate.cleanPartition.topline.false_fill_rate,
        acceptedWithoutEditRate: gate.cleanPartition.topline.accepted_without_edit_rate,
        meanNormalizedEditDistance: gate.cleanPartition.topline.mean_normalized_edit_distance,
        unsupportedFalseCommitRate: gate.cleanPartition.topline.unsupported_false_commit_rate,
        abstainPrecision: gate.cleanPartition.topline.abstain_precision,
        abstainCoverage: gate.cleanPartition.topline.abstain_coverage,
        semanticOutputHash: result.semantic_output_hash,
        fieldHash: result.field_hash,
        contractHash: result.contract_hash,
        sliceStart: result.slice_start,
        sliceEnd: result.slice_end,
        sliceRowCount: result.slice_row_count,
        citationFieldExactness: Object.fromEntries(
          gate.cleanPartition.citation_field_exactness.map((entry) => [
            entry.group,
            {
              exactMatchRate: entry.exact_match_rate,
              correct: entry.correct,
              compared: entry.compared,
              rawFalsePositiveRepairRate: entry.raw_false_positive_repair_rate,
              rawFalsePositiveRepaired: entry.raw_false_positive_repaired,
              rawFalsePositiveCompared: entry.raw_false_positive_compared,
            },
          ]),
        ),
        warnings: gate.warnings,
        reports: gate.reports,
        runtimeGuardrails: gate.runtimeGuardrails,
        baselinePath,
        baselineDelta: gate.baseline,
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
  const value = match ? match.slice("--profile=".length) : undefined;
  if (value === "hybrid-ml") return "hybrid-ml";
  if (value === "current-runtime-stable350") return "current-runtime-stable350";
  if (value === "current-runtime") return "current-runtime";
  if (value === "site-faithful") return "site-faithful";
  return "heuristic-only";
}

function readArg(argv: string[], flag: string): string | null {
  const match = argv.find((entry) => entry.startsWith(`${flag}=`));
  return match ? match.slice(flag.length + 1) : null;
}

async function findLatestBaselinePath(
  mode: BenchmarkMode,
  profile: BenchmarkRunProfile,
  options: {
    hardwareProfile: ReturnType<typeof readBenchmarkHardwareProfile>;
    benchmarkVariant: ReturnType<typeof readBenchmarkVariant>;
    artifactNamespace: ReturnType<typeof readBenchmarkArtifactNamespace>;
  },
): Promise<string | null> {
  const paths = resolveBenchmarkPaths(mode, profile, options);
  const prefix = benchmarkArtifactPrefix(mode, profile, options);
  const files = await readdir(paths.checkedInResultsDir);
  const candidates = files
    .filter((file) => file.startsWith(`${prefix}.baseline_`) && file.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left));

  for (const candidate of candidates) {
    const baselinePath = path.join(paths.checkedInResultsDir, candidate);
    try {
      validateBenchmarkEvaluation(
        JSON.parse(await readFile(baselinePath, "utf8")) as BenchmarkEvaluationResult,
        mode,
      );
      return baselinePath;
    } catch {
      continue;
    }
  }

  return null;
}

void main();
