import { copyFile } from "node:fs/promises";

import {
  readBenchmarkHardwareProfile,
  readBenchmarkSliceSelection,
  readBenchmarkVariant,
} from "../../src/benchmark/executionOptions.js";
import { benchmarkBaselinePath, resolveBenchmarkPaths } from "../../src/benchmark/paths.js";
import type { BenchmarkMode, BenchmarkRunProfile } from "../../src/benchmark/types.js";

async function main(): Promise<void> {
  const mode = readMode(process.argv);
  const profile = readProfile(process.argv);
  const hardwareProfile = readBenchmarkHardwareProfile(process.argv);
  const benchmarkVariant = readBenchmarkVariant(process.argv);
  const { sliceLabel, slicePreset, sliceRange } = readBenchmarkSliceSelection(process.argv);
  const stamp = readArg(process.argv, "--stamp") ?? new Date().toISOString().slice(0, 10);
  const pathOptions = {
    hardwareProfile,
    benchmarkVariant,
    sliceLabel,
  };
  const paths = resolveBenchmarkPaths(mode, profile, pathOptions);
  const baselinePath = benchmarkBaselinePath(mode, profile, stamp, pathOptions);
  await copyFile(paths.latestResultPath, baselinePath);
  process.stdout.write(
    `${JSON.stringify(
      {
        mode,
        profile,
        hardwareProfile,
        benchmarkVariant,
        slicePreset,
        sliceStart: sliceRange?.startRow,
        sliceEnd: sliceRange?.endRow,
        baselinePath,
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
  return "heuristic-only";
}

function readArg(argv: string[], flag: string): string | null {
  const match = argv.find((entry) => entry.startsWith(`${flag}=`));
  return match ? match.slice(flag.length + 1) : null;
}

void main();
