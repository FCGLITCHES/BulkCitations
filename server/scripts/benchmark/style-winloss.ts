import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveBenchmarkPaths } from "../../src/benchmark/paths.js";
import {
  validateBenchmarkManifest,
  validateBenchmarkPredictions,
} from "../../src/benchmark/schema.js";
import type {
  BenchmarkManifestRow,
  BenchmarkMode,
  BenchmarkPredictionRow,
} from "../../src/benchmark/types.js";

interface WinLossBucket {
  compared: number;
  model_wins: number;
  model_losses: number;
  both_correct: number;
  both_incorrect: number;
}

interface WinLossRow extends WinLossBucket {
  key: string;
  model_net: number;
  model_win_rate: number;
}

interface StyleWinLossResult {
  generated_at: string;
  mode: BenchmarkMode;
  compared: number;
  model_wins: number;
  model_losses: number;
  both_correct: number;
  both_incorrect: number;
  model_net: number;
  model_win_rate: number;
  by_reference_type: WinLossRow[];
  by_style: WinLossRow[];
}

async function main(): Promise<void> {
  const mode = readMode(process.argv);
  const heuristicPath = readArg(process.argv, "--heuristic-results")
    ?? resolveBenchmarkPaths(mode, "heuristic-only").parserOutputPath;
  const hybridPath = readArg(process.argv, "--hybrid-results")
    ?? resolveBenchmarkPaths(mode, "hybrid-ml").parserOutputPath;
  const manifestPath = readArg(process.argv, "--manifest")
    ?? resolveBenchmarkPaths(mode, "heuristic-only").manifestPath;

  const manifest = validateBenchmarkManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as BenchmarkManifestRow[],
    mode,
  );
  const heuristicPredictions = validateBenchmarkPredictions(
    JSON.parse(await readFile(heuristicPath, "utf8")) as BenchmarkPredictionRow[],
    mode,
  );
  const hybridPredictions = validateBenchmarkPredictions(
    JSON.parse(await readFile(hybridPath, "utf8")) as BenchmarkPredictionRow[],
    mode,
  );

  const heuristicByVariant = new Map(
    heuristicPredictions.map((row) => [row.variant_id, row] as const),
  );
  const hybridByVariant = new Map(
    hybridPredictions.map((row) => [row.variant_id, row] as const),
  );
  const byType = new Map<string, WinLossBucket>();
  const byStyle = new Map<string, WinLossBucket>();
  const totals: WinLossBucket = {
    compared: 0,
    model_wins: 0,
    model_losses: 0,
    both_correct: 0,
    both_incorrect: 0,
  };

  for (const row of manifest) {
    const heuristic = heuristicByVariant.get(row.variant_id);
    const hybrid = hybridByVariant.get(row.variant_id);
    if (!heuristic || !hybrid) {
      continue;
    }

    const expectedStyle = row.citation_style;
    const heuristicStyle = heuristic.detected_style ?? "missing";
    const hybridStyle = hybrid.detected_style ?? "missing";
    const heuristicCorrect = heuristicStyle === expectedStyle;
    const hybridCorrect = hybridStyle === expectedStyle;

    applyWinLoss(totals, hybridCorrect, heuristicCorrect);
    applyWinLoss(getMutableBucket(byType, row.reference_type), hybridCorrect, heuristicCorrect);
    applyWinLoss(getMutableBucket(byStyle, row.citation_style), hybridCorrect, heuristicCorrect);
  }

  const result: StyleWinLossResult = {
    generated_at: new Date().toISOString(),
    mode,
    compared: totals.compared,
    model_wins: totals.model_wins,
    model_losses: totals.model_losses,
    both_correct: totals.both_correct,
    both_incorrect: totals.both_incorrect,
    model_net: totals.model_wins - totals.model_losses,
    model_win_rate: totals.compared > 0
      ? round(totals.model_wins / totals.compared, 4)
      : 0,
    by_reference_type: toWinLossRows(byType),
    by_style: toWinLossRows(byStyle),
  };

  const resultsDir = resolveBenchmarkPaths(mode, "heuristic-only").resultsDir;
  const resultPath = path.join(resultsDir, `${mode}.style_winloss.latest.json`);
  const summaryPath = path.join(resultsDir, `${mode}.style_winloss.summary.md`);
  await mkdir(resultsDir, { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(summaryPath, renderSummary(result), "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        ...result,
        resultPath,
        summaryPath,
      },
      null,
      2,
    )}\n`,
  );
}

function applyWinLoss(bucket: WinLossBucket, hybridCorrect: boolean, heuristicCorrect: boolean): void {
  bucket.compared += 1;
  if (hybridCorrect && !heuristicCorrect) {
    bucket.model_wins += 1;
    return;
  }
  if (!hybridCorrect && heuristicCorrect) {
    bucket.model_losses += 1;
    return;
  }
  if (hybridCorrect && heuristicCorrect) {
    bucket.both_correct += 1;
    return;
  }
  bucket.both_incorrect += 1;
}

function getMutableBucket(map: Map<string, WinLossBucket>, key: string): WinLossBucket {
  const current = map.get(key) ?? {
    compared: 0,
    model_wins: 0,
    model_losses: 0,
    both_correct: 0,
    both_incorrect: 0,
  };
  map.set(key, current);
  return current;
}

function toWinLossRows(map: Map<string, WinLossBucket>): WinLossRow[] {
  return [...map.entries()]
    .map(([key, bucket]) => ({
      key,
      ...bucket,
      model_net: bucket.model_wins - bucket.model_losses,
      model_win_rate: bucket.compared > 0 ? round(bucket.model_wins / bucket.compared, 4) : 0,
    }))
    .sort((left, right) =>
      right.model_net - left.model_net
      || right.model_wins - left.model_wins
      || right.compared - left.compared
      || left.key.localeCompare(right.key),
    );
}

function renderSummary(result: StyleWinLossResult): string {
  const lines = [
    "# Style Model vs Rule Win/Loss",
    "",
    `- Generated At: ${result.generated_at}`,
    `- Mode: ${result.mode}`,
    `- Compared: ${result.compared}`,
    `- Model Wins: ${result.model_wins}`,
    `- Model Losses: ${result.model_losses}`,
    `- Model Net: ${result.model_net}`,
    `- Model Win Rate: ${result.model_win_rate}`,
    "",
    "## By Reference Type",
    "",
    "| Reference Type | Compared | Model Wins | Model Losses | Model Net | Model Win Rate | Both Correct | Both Incorrect |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...renderRows(result.by_reference_type),
    "",
    "## By Citation Style",
    "",
    "| Style | Compared | Model Wins | Model Losses | Model Net | Model Win Rate | Both Correct | Both Incorrect |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...renderRows(result.by_style),
    "",
  ];
  return lines.join("\n");
}

function renderRows(rows: WinLossRow[]): string[] {
  if (rows.length === 0) {
    return ["| none | 0 | 0 | 0 | 0 | 0 | 0 | 0 |"];
  }
  return rows.map((row) =>
    `| ${row.key} | ${row.compared} | ${row.model_wins} | ${row.model_losses} | ${row.model_net} | ${row.model_win_rate} | ${row.both_correct} | ${row.both_incorrect} |`,
  );
}

function readMode(argv: string[]): BenchmarkMode {
  const match = argv.find((entry) => entry.startsWith("--mode="));
  return match?.slice("--mode=".length) === "pilot" ? "pilot" : "full";
}

function readArg(argv: string[], flag: string): string | null {
  const match = argv.find((entry) => entry.startsWith(`${flag}=`));
  return match ? match.slice(flag.length + 1) : null;
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

void main();
