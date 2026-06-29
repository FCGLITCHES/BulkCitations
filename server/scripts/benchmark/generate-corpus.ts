import { mkdir } from "node:fs/promises";

import { buildBenchmarkCorpus, harvestBenchmarkSources } from "../../src/benchmark/corpus.js";
import { resolveBenchmarkPaths } from "../../src/benchmark/paths.js";
import { validateBenchmarkManifest } from "../../src/benchmark/schema.js";
import type { BenchmarkMode } from "../../src/benchmark/types.js";

async function main(): Promise<void> {
  const mode = readMode(process.argv);
  const phase = readArg(process.argv, "--phase") ?? "build";
  const paths = resolveBenchmarkPaths(mode);

  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.corpusDir, { recursive: true });
  await mkdir(paths.rawSourcesDir, { recursive: true });
  await mkdir(paths.resultsDir, { recursive: true });

  if (phase === "harvest") {
    await harvestBenchmarkSources(mode);
    process.stdout.write(
      `${JSON.stringify({ mode, phase, rawSourcesDir: paths.rawSourcesDir }, null, 2)}\n`,
    );
    return;
  }

  const realInputModes =
    process.argv.includes("--realInputModes") || readArg(process.argv, "--realInputModes") === "true";
  const result = await buildBenchmarkCorpus(mode, { realInputModes });
  validateBenchmarkManifest(result.manifest, mode);
  const bySourceKind: Record<string, number> = {};
  for (const row of result.manifest) {
    bySourceKind[row.input_source_kind] = (bySourceKind[row.input_source_kind] ?? 0) + 1;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode,
        phase,
        realInputModes,
        manifestPath: paths.manifestPath,
        formattedStringsPath: paths.formattedStringsPath,
        noiseLogPath: paths.noiseLogPath,
        manifestRows: result.manifest.length,
        cleanRows: result.manifest.filter((row) => row.variant_kind === "clean").length,
        noisyRows: result.manifest.filter((row) => row.variant_kind === "noisy").length,
        bySourceKind,
        warnings: result.warnings,
      },
      null,
      2,
    )}\n`,
  );
}

function readMode(argv: string[]): BenchmarkMode {
  const value = readArg(argv, "--mode");
  return value === "pilot" ? "pilot" : "full";
}

function readArg(argv: string[], flag: string): string | null {
  const match = argv.find((entry) => entry.startsWith(`${flag}=`));
  return match ? match.slice(flag.length + 1) : null;
}

void main();
