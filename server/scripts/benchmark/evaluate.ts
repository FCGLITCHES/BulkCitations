import { mkdir, readFile, writeFile } from "node:fs/promises";

import { buildBenchmarkDebugSummary } from "../../src/benchmark/debug.js";
import { evaluateBenchmark } from "../../src/benchmark/evaluation.js";
import {
  readBenchmarkArtifactDetail,
  readBenchmarkArtifactNamespace,
  readBenchmarkHardwareProfile,
  readBenchmarkParseProfile,
  readBenchmarkSliceSelection,
  readBenchmarkSourceType,
  readBenchmarkVariant,
} from "../../src/benchmark/executionOptions.js";
import {
  benchmarkRunArtifactPaths,
  resolveBenchmarkPaths,
} from "../../src/benchmark/paths.js";
import {
  applyBenchmarkSlice,
} from "../../src/benchmark/selection.js";
import { computeBenchmarkSemanticOutputSummary } from "../../src/benchmark/semanticHash.js";
import {
  validateBenchmarkEvaluation,
  validateBenchmarkManifest,
  validateBenchmarkPredictions,
  validateBenchmarkRuntimeMetrics,
} from "../../src/benchmark/schema.js";
import type {
  BenchmarkEvaluationResult,
  BenchmarkManifestRow,
  BenchmarkMode,
  BenchmarkPredictionRow,
  BenchmarkRunProfile,
  BenchmarkRuntimeMetrics,
} from "../../src/benchmark/types.js";

async function main(): Promise<void> {
  const mode = readMode(process.argv);
  const profile = readProfile(process.argv);
  const sourceType = readBenchmarkSourceType(process.argv);
  const parseProfile = readBenchmarkParseProfile(process.argv);
  const hardwareProfile = readBenchmarkHardwareProfile(process.argv);
  const benchmarkVariant = readBenchmarkVariant(process.argv);
  const artifactDetail = readBenchmarkArtifactDetail(process.argv);
  const artifactNamespace = readBenchmarkArtifactNamespace(process.argv);
  const { sliceLabel, slicePreset, sliceRange } = readBenchmarkSliceSelection(process.argv);
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
  const scopedManifest = applyBenchmarkSlice(manifest, sliceRange);
  const predictions = validateBenchmarkPredictions(
    JSON.parse(await readFile(paths.parserOutputPath, "utf8")) as BenchmarkPredictionRow[],
    mode,
  );
  const runtimeMetrics = await readRuntimeMetrics(paths.runtimeMetricsPath);
  const semanticOutput = computeBenchmarkSemanticOutputSummary(predictions);
  const result = validateBenchmarkEvaluation(
    evaluateBenchmark(scopedManifest, predictions, mode, profile, {
      artifactDetail,
      sourceType,
      parseProfile,
      hardwareProfile,
      benchmarkVariant,
      ...(artifactNamespace ? { artifactNamespace } : {}),
      slicePreset,
      semanticOutputHash: semanticOutput.semanticOutputHash,
      fieldHash: semanticOutput.fieldHash,
      contractHash: semanticOutput.contractHash,
      sliceRange,
      ...(runtimeMetrics ? { runtimeMetrics } : {}),
    }),
    mode,
  );
  const debug = artifactDetail === "full"
    ? buildBenchmarkDebugSummary(scopedManifest, predictions, result)
    : {
        generated_at: result.generated_at,
        mode: result.mode,
        profile: result.profile,
        artifact_detail: artifactDetail,
        omitted: true,
        reason: "Summary artifact mode skips heavy debug payload generation.",
      };
  const runArtifacts = benchmarkRunArtifactPaths(mode, profile, result.generated_at, {
    hardwareProfile,
    benchmarkVariant,
    artifactNamespace,
    sliceLabel,
  });
  const summary = renderSummary(result);
  const debugSummary = artifactDetail === "full"
    ? renderDebugSummary(debug as ReturnType<typeof buildBenchmarkDebugSummary>)
    : renderSummaryDebugPlaceholder(result, artifactDetail);

  await mkdir(paths.resultsDir, { recursive: true });
  await writeFile(paths.latestResultPath, JSON.stringify(result, null, 2), "utf8");
  await writeFile(paths.latestSummaryPath, summary, "utf8");
  await writeFile(paths.latestDebugPath, JSON.stringify(debug, null, 2), "utf8");
  await writeFile(paths.latestDebugSummaryPath, debugSummary, "utf8");
  await writeFile(runArtifacts.resultPath, JSON.stringify(result, null, 2), "utf8");
  await writeFile(runArtifacts.summaryPath, summary, "utf8");
  await writeFile(runArtifacts.debugPath, JSON.stringify(debug, null, 2), "utf8");
  await writeFile(runArtifacts.debugSummaryPath, debugSummary, "utf8");
  process.stdout.write(
    `${JSON.stringify(
      {
        ...result,
        run_artifacts: runArtifacts,
      },
      null,
      2,
    )}\n`,
  );
}

function renderSummary(result: BenchmarkEvaluationResult): string {
  const clean = result.partitions.find((partition) => partition.partition === "clean");
  const noisy = result.partitions.find((partition) => partition.partition === "noisy");
  const measuredThroughput = result.runtime_metrics?.throughput_refs_per_sec ?? clean?.throughput_refs_per_sec ?? 0;
  const measuredWallClockMs = result.runtime_metrics?.wall_clock_ms;
  const lines = [
    "# Grobid-Style Benchmark Summary",
    "",
    `- Generated At: ${result.generated_at}`,
    `- Mode: ${result.mode}`,
    `- Profile: ${result.profile}`,
    ...(result.artifact_detail ? [`- Artifact Detail: ${result.artifact_detail}`] : []),
    ...(result.parse_profile ? [`- Parse Profile: ${result.parse_profile}`] : []),
    ...(result.source_type ? [`- Source Type: ${result.source_type}`] : []),
    ...(result.hardware_profile ? [`- Hardware Profile: ${result.hardware_profile}`] : []),
    ...(result.benchmark_variant ? [`- Benchmark Variant: ${result.benchmark_variant}`] : []),
    ...(result.artifact_namespace ? [`- Artifact Namespace: ${result.artifact_namespace}`] : []),
    ...(result.slice_preset ? [`- Slice Preset: ${result.slice_preset}`] : []),
    ...(result.semantic_output_hash ? [`- Semantic Output Hash: ${result.semantic_output_hash}`] : []),
    ...(result.field_hash ? [`- Field Hash: ${result.field_hash}`] : []),
    ...(result.contract_hash ? [`- Contract Hash: ${result.contract_hash}`] : []),
    ...(result.runtime_metrics
      ? [
          `- Measured Throughput (refs/sec): ${measuredThroughput}`,
          `- Measured Wall Clock (ms): ${measuredWallClockMs ?? 0}`,
        ]
      : []),
    ...(result.slice_start != null && result.slice_end != null
      ? [`- Slice Rows: ${result.slice_start}-${result.slice_end} (${result.slice_row_count ?? 0} rows)`]
      : []),
    `- Scoring Spec: ${result.scoring_spec_version}`,
    `- Target Status: ${result.target_status}`,
    "",
    "## Contract Sanity",
    "",
    `- Hard Failures: ${result.contract_sanity.failures.length}`,
    `- Warnings: ${result.contract_sanity.warnings.length}`,
    "",
    "## Metric Legend",
    "",
    "- `tp` (true positives): expected field matches that the engine got right.",
    "- `fp` (false positives): field values the engine predicted but that did not match the expected field.",
    "- `fn` (false negatives): expected field values the engine missed or failed to match.",
    "- `precision`: of the values predicted for a field, how many were correct.",
    "- `recall`: of the values expected for a field, how many were recovered.",
    "- `f1`: harmonic mean of precision and recall; use this as the main per-field score.",
    "",
    "## Clean",
    "",
    `- Macro Soft F1: ${clean?.by_tier.soft.macro_field_f1 ?? 0}`,
    `- Instance Soft F1: ${clean?.by_tier.soft.instance.f1 ?? 0}`,
    `- Type Accuracy: ${clean?.type_accuracy.accuracy ?? 0} (${clean?.type_accuracy.correct ?? 0}/${clean?.type_accuracy.compared ?? 0})`,
    `- Style Accuracy: ${clean?.style_accuracy.accuracy ?? 0} (${clean?.style_accuracy.correct ?? 0}/${clean?.style_accuracy.compared ?? 0})`,
    `- Style Family Accuracy: ${clean?.style_family_accuracy.accuracy ?? 0} (${clean?.style_family_accuracy.correct ?? 0}/${clean?.style_family_accuracy.compared ?? 0})`,
    `- Throughput (refs/sec): ${measuredThroughput}`,
    `- Normalized Citation Exact-Match Rate: ${clean?.topline.normalized_citation_exact_match_rate ?? 0} (${clean?.topline.normalized_citation_exact_match_compared ?? 0} compared)`,
    `- Required-Field Completeness: ${clean?.topline.required_field_completeness ?? 0}`,
    `- False-Fill Rate: ${clean?.topline.false_fill_rate ?? 0}`,
    `- Accepted-Without-Edit Rate: ${clean?.topline.accepted_without_edit_rate ?? 0}`,
    `- Mean Normalized Edit Distance: ${clean?.topline.mean_normalized_edit_distance ?? 0} (${clean?.topline.mean_normalized_edit_distance_compared ?? 0} compared)`,
    `- Unsupported False-Commit Rate: ${clean?.topline.unsupported_false_commit_rate ?? 0} (${clean?.topline.unsupported_false_commit_compared ?? 0} compared)`,
    `- Abstain Precision: ${clean?.topline.abstain_precision ?? 0} (${clean?.topline.abstain_precision_compared ?? 0} compared)`,
    `- Abstain Coverage: ${clean?.topline.abstain_coverage ?? 0} (${clean?.topline.abstain_coverage_required ?? 0} required)`,
    "",
    "### Clean Adversarial Pair Accuracy",
    "",
    "| Pair | Styles | Accuracy | Correct | Compared |",
    "| --- | --- | --- | --- | --- |",
    ...renderAdversarialPairRows(clean?.adversarial_pair_accuracy ?? []),
    "",
    "### Clean Soft Field Metrics",
    "",
    "| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...renderFieldScoreRows(clean?.by_tier.soft.fields ?? {}),
    "",
    "### Clean Field Contract",
    "",
    "| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...renderFieldContractRows(clean?.field_contract ?? []),
    "",
    "### Clean Citation Field Exactness",
    "",
    "| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...renderCitationFieldExactnessRows(clean?.citation_field_exactness ?? []),
    "",
    "### Clean Input Profiles",
    "",
    "| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...renderInputProfileRows(clean?.by_input_profile ?? []),
    "",
    "### Clean Move-Level Repairs",
    "",
    "| Phase | Reason | Total Repairs | Successful Repairs | Precision |",
    "| --- | --- | --- | --- | --- |",
    ...renderMoveRepairRows(clean?.move_level_repairs ?? []),
    "",
    "## Noisy",
    "",
    `- Macro Soft F1: ${noisy?.by_tier.soft.macro_field_f1 ?? 0}`,
    `- Instance Soft F1: ${noisy?.by_tier.soft.instance.f1 ?? 0}`,
    `- Type Accuracy: ${noisy?.type_accuracy.accuracy ?? 0} (${noisy?.type_accuracy.correct ?? 0}/${noisy?.type_accuracy.compared ?? 0})`,
    `- Style Accuracy: ${noisy?.style_accuracy.accuracy ?? 0} (${noisy?.style_accuracy.correct ?? 0}/${noisy?.style_accuracy.compared ?? 0})`,
    `- Style Family Accuracy: ${noisy?.style_family_accuracy.accuracy ?? 0} (${noisy?.style_family_accuracy.correct ?? 0}/${noisy?.style_family_accuracy.compared ?? 0})`,
    `- Normalized Citation Exact-Match Rate: ${noisy?.topline.normalized_citation_exact_match_rate ?? 0} (${noisy?.topline.normalized_citation_exact_match_compared ?? 0} compared)`,
    `- Required-Field Completeness: ${noisy?.topline.required_field_completeness ?? 0}`,
    `- False-Fill Rate: ${noisy?.topline.false_fill_rate ?? 0}`,
    `- Accepted-Without-Edit Rate: ${noisy?.topline.accepted_without_edit_rate ?? 0}`,
    `- Mean Normalized Edit Distance: ${noisy?.topline.mean_normalized_edit_distance ?? 0} (${noisy?.topline.mean_normalized_edit_distance_compared ?? 0} compared)`,
    `- Unsupported False-Commit Rate: ${noisy?.topline.unsupported_false_commit_rate ?? 0} (${noisy?.topline.unsupported_false_commit_compared ?? 0} compared)`,
    `- Abstain Precision: ${noisy?.topline.abstain_precision ?? 0} (${noisy?.topline.abstain_precision_compared ?? 0} compared)`,
    `- Abstain Coverage: ${noisy?.topline.abstain_coverage ?? 0} (${noisy?.topline.abstain_coverage_required ?? 0} required)`,
    "",
    "### Noisy Soft Field Metrics",
    "",
    "| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...renderFieldScoreRows(noisy?.by_tier.soft.fields ?? {}),
    "",
    "### Noisy Field Contract",
    "",
    "| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...renderFieldContractRows(noisy?.field_contract ?? []),
    "",
    "### Noisy Citation Field Exactness",
    "",
    "| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...renderCitationFieldExactnessRows(noisy?.citation_field_exactness ?? []),
    "",
    "### Noisy Input Profiles",
    "",
    "| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...renderInputProfileRows(noisy?.by_input_profile ?? []),
    "",
    "### Noisy Move-Level Repairs",
    "",
    "| Phase | Reason | Total Repairs | Successful Repairs | Precision |",
    "| --- | --- | --- | --- | --- |",
    ...renderMoveRepairRows(noisy?.move_level_repairs ?? []),
    "",
    "## Cells Below Threshold",
    "",
    "| Style | Type | Soft Instance F1 | Compared |",
    "| --- | --- | --- | --- |",
    ...(
      clean?.cell_soft_instance_f1
        .filter((cell) => cell.below_threshold)
        .map((cell) => `| ${cell.citation_style} | ${cell.reference_type} | ${cell.f1} | ${cell.compared} |`)
      ?? []
    ),
    "",
    "## Contract Sanity Failures",
    "",
    ...(result.contract_sanity.failures.length > 0
      ? result.contract_sanity.failures.map((failure) => `- ${failure}`)
      : ["- None"]),
    "",
  ];
  return lines.join("\n");
}

function renderDebugSummary(debug: ReturnType<typeof buildBenchmarkDebugSummary>): string {
  const lines = [
    "# Grobid-Style Benchmark Debug",
    "",
    `- Mode: ${debug.mode}`,
    `- Profile: ${debug.profile}`,
    ...(("parse_profile" in debug && debug.parse_profile) ? [`- Parse Profile: ${String(debug.parse_profile)}`] : []),
    ...(("source_type" in debug && debug.source_type) ? [`- Source Type: ${String(debug.source_type)}`] : []),
    ...(("hardware_profile" in debug && debug.hardware_profile) ? [`- Hardware Profile: ${String(debug.hardware_profile)}`] : []),
    ...(("benchmark_variant" in debug && debug.benchmark_variant) ? [`- Benchmark Variant: ${String(debug.benchmark_variant)}`] : []),
    ...(("artifact_namespace" in debug && debug.artifact_namespace)
      ? [`- Artifact Namespace: ${String(debug.artifact_namespace)}`]
      : []),
    ...(("semantic_output_hash" in debug && debug.semantic_output_hash)
      ? [`- Semantic Output Hash: ${String(debug.semantic_output_hash)}`]
      : []),
    ...(("field_hash" in debug && debug.field_hash)
      ? [`- Field Hash: ${String(debug.field_hash)}`]
      : []),
    ...(("contract_hash" in debug && debug.contract_hash)
      ? [`- Contract Hash: ${String(debug.contract_hash)}`]
      : []),
    ...(("slice_start" in debug && "slice_end" in debug && debug.slice_start != null && debug.slice_end != null)
      ? [`- Slice Rows: ${String(debug.slice_start)}-${String(debug.slice_end)} (${String(debug.slice_row_count ?? 0)} rows)`]
      : []),
    "",
    "## Metric Legend",
    "",
    "- `tp` (true positives): expected field matches that the engine got right.",
    "- `fp` (false positives): field values the engine predicted but that did not match the expected field.",
    "- `fn` (false negatives): expected field values the engine missed or failed to match.",
    "- `precision`: of the values predicted for a field, how many were correct.",
    "- `recall`: of the values expected for a field, how many were recovered.",
    "- `f1`: harmonic mean of precision and recall; use this as the main per-field score.",
    "",
    "## Contract Coverage",
    "",
    "| Field | Expected Rows | Predicted Non-Empty Rows | Coverage | Hard Failure | Warning |",
    "| --- | --- | --- | --- | --- | --- |",
    ...debug.clean_debug.adapter_coverage.map((entry) =>
      `| ${entry.field} | ${entry.expected_rows} | ${entry.predicted_non_empty_rows} | ${entry.coverage} | ${entry.hard_failure} | ${entry.warning} |`,
    ),
    "",
    "## Contract Samples",
    "",
    "| Variant | Required Fields | Expected Keys | Predicted Keys | Missing Required |",
    "| --- | --- | --- | --- | --- |",
    ...debug.clean_debug.contract_samples.map((entry) =>
      `| ${entry.variant_id} | ${entry.required_fields.join(", ")} | ${entry.expected_keys.join(", ")} | ${entry.predicted_keys.join(", ")} | ${entry.missing_required_fields.join(", ")} |`,
    ),
    "",
    "## Clean Structure Breakdown",
    "",
    "| Structure | Compared | Soft Instance F1 | Macro Soft F1 |",
    "| --- | --- | --- | --- |",
    ...debug.clean_debug.by_structure.map((entry) =>
      `| ${entry.structure_class} | ${entry.compared} | ${entry.soft_instance_f1} | ${entry.macro_soft_f1} |`,
    ),
    "",
    "## Priority Fields",
    "",
    "| Field | Soft F1 (balanced score) | Missing Expected | Unsupported Predicted | TP (matched expected) | FP (wrong predicted) | FN (missed expected) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...debug.clean_debug.priority_fields.map((entry) =>
      `| ${entry.field} | ${entry.soft_f1} | ${entry.missing_expected} | ${entry.unsupported_predicted} | ${entry.tp} | ${entry.fp} | ${entry.fn} |`,
    ),
    "",
    "## Accuracy",
    "",
    `- Type Accuracy: ${debug.clean_debug.type_accuracy.accuracy} (${debug.clean_debug.type_accuracy.correct}/${debug.clean_debug.type_accuracy.compared})`,
    `- Style Accuracy: ${debug.clean_debug.style_accuracy.accuracy} (${debug.clean_debug.style_accuracy.correct}/${debug.clean_debug.style_accuracy.compared})`,
    `- Style Family Accuracy: ${debug.clean_debug.style_family_accuracy.accuracy} (${debug.clean_debug.style_family_accuracy.correct}/${debug.clean_debug.style_family_accuracy.compared})`,
    "",
    "## Adversarial Pair Accuracy",
    "",
    "| Pair | Styles | Accuracy | Correct | Compared |",
    "| --- | --- | --- | --- | --- |",
    ...renderAdversarialPairRows(debug.clean_debug.adversarial_pair_accuracy),
    "",
    "## Priority Cells",
    "",
    "| Style | Type | Compared | Soft Instance F1 |",
    "| --- | --- | --- | --- |",
    ...debug.clean_debug.priority_cells.map((entry) =>
      `| ${entry.citation_style} | ${entry.reference_type} | ${entry.compared} | ${entry.soft_instance_f1} |`,
    ),
    "",
    "## Top Style Mismatches",
    "",
    "| Expected | Detected | Count |",
    "| --- | --- | --- |",
    ...debug.clean_debug.style_mismatches.map((entry) =>
      `| ${entry.expected_style} | ${entry.detected_style} | ${entry.count} |`,
    ),
    "",
    "## Style Failure Examples",
    "",
    ...debug.clean_debug.style_failure_examples.flatMap((entry) => [
      `### ${entry.expected_style} -> ${entry.detected_style}`,
      "",
      "| Variant | Type | Detected Type | Warnings | Citation |",
      "| --- | --- | --- | --- | --- |",
      ...entry.examples.map((example) =>
        `| ${example.variant_id} | ${example.reference_type} | ${example.detected_type} | ${example.warnings.join(", ")} | ${renderValue(example.formatted_string)} |`,
      ),
      "",
    ]),
    "",
    "## Top Type Mismatches",
    "",
    "| Expected | Detected | Count |",
    "| --- | --- | --- |",
    ...debug.clean_debug.type_mismatches.map((entry) =>
      `| ${entry.expected_type} | ${entry.detected_type} | ${entry.count} |`,
    ),
    "",
    "## Stripped Fields By Detected Type",
    "",
    "| Detected Type | Field | Count |",
    "| --- | --- | --- |",
    ...debug.clean_debug.stripped_fields_by_type.map((entry) =>
      `| ${entry.detected_type} | ${entry.field} | ${entry.count} |`,
    ),
    "",
    "## Field Failure Examples",
    "",
    ...debug.clean_debug.field_failure_examples.flatMap((entry) => [
      `### ${entry.field}`,
      "",
      "| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...entry.examples.map((example) =>
        `| ${example.variant_id} | ${renderValue(example.expected_value)} | ${renderValue(example.predicted_value)} | ${renderValue(example.raw_predicted_value)} | ${example.detected_type} | ${example.detected_style} | ${example.reason_bucket} |`,
      ),
      "",
    ]),
    "## Sample Failures",
    "",
    "| Variant | Structure | Source Kind | Style | Type | Detected Style | Detected Type | Missing Fields | Stripped Fields |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...debug.clean_debug.sample_failures.map((entry) =>
      `| ${entry.variant_id} | ${entry.structure_class} | ${entry.input_source_kind} | ${entry.citation_style} | ${entry.reference_type} | ${entry.detected_style} | ${entry.detected_type} | ${entry.failed_required_fields.join(", ")} | ${entry.adapter_stripped_fields.join(", ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

function renderValue(value: unknown): string {
  const rendered = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  return rendered.replace(/\|/g, "\\|");
}

function renderFieldScoreRows(
  fields: Record<string, BenchmarkEvaluationResult["partitions"][number]["by_tier"]["soft"]["fields"][string]>,
): string[] {
  return Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, score]) =>
      `| ${field} | ${score.tp} | ${score.fp} | ${score.fn} | ${score.precision} | ${score.recall} | ${score.f1} |`,
    );
}

function renderFieldContractRows(
  rows: BenchmarkEvaluationResult["partitions"][number]["field_contract"],
): string[] {
  if (rows.length === 0) {
    return ["| none | 0 | 0 | 0 | 0 | 0 | 0 | 0 |"];
  }

  return rows.map((row) =>
    `| ${row.field} | ${row.coverage} | ${row.exact_f1} | ${row.canonical_f1} | ${row.exact_precision_non_abstained} | ${row.canonical_precision_non_abstained} | ${row.expected_rows} | ${row.predicted_non_empty_rows} |`,
  );
}

function renderCitationFieldExactnessRows(
  rows: BenchmarkEvaluationResult["partitions"][number]["citation_field_exactness"],
): string[] {
  if (rows.length === 0) {
    return ["| none | 0 | 0 | 0 | 0 | 0 | 0 |"];
  }

  return rows.map((row) =>
    `| ${row.group} | ${row.exact_match_rate} | ${row.correct} | ${row.compared} | ${row.raw_false_positive_repair_rate} | ${row.raw_false_positive_repaired} | ${row.raw_false_positive_compared} |`,
  );
}

function renderInputProfileRows(
  rows: BenchmarkEvaluationResult["partitions"][number]["by_input_profile"],
): string[] {
  if (rows.length === 0) {
    return ["| none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |"];
  }

  return rows.map((row) =>
    `| ${row.input_profile} | ${row.compared} | ${row.soft_instance_f1} | ${row.high_confidence_parse_rate} | ${row.partial_parse_with_abstentions_rate} | ${row.needs_action_rate} | ${row.abstain_rate} | ${row.required_field_completeness} | ${row.false_fill_rate} | ${row.accepted_without_edit_rate} | ${row.normalized_citation_exact_match_rate} |`,
  );
}

function renderMoveRepairRows(
  rows: BenchmarkEvaluationResult["partitions"][number]["move_level_repairs"],
): string[] {
  if (rows.length === 0) {
    return ["| none | none | 0 | 0 | 0 |"];
  }

  return rows.map((row) =>
    `| ${row.phase_id} | ${row.reason_code} | ${row.total_repairs} | ${row.successful_repairs} | ${row.precision} |`,
  );
}

function renderAdversarialPairRows(
  pairs: BenchmarkEvaluationResult["partitions"][number]["adversarial_pair_accuracy"],
): string[] {
  if (pairs.length === 0) {
    return ["| none | none | 0 | 0 | 0 |"];
  }
  return pairs.map((pair) =>
    `| ${pair.pair_name} | ${pair.styles.join(" vs ")} | ${pair.accuracy} | ${pair.correct} | ${pair.compared} |`,
  );
}

function renderSummaryDebugPlaceholder(
  result: BenchmarkEvaluationResult,
  artifactDetail: "full" | "summary",
): string {
  return [
    "# Grobid-Style Benchmark Debug",
    "",
    `- Mode: ${result.mode}`,
    `- Profile: ${result.profile}`,
    `- Artifact Detail: ${artifactDetail}`,
    "",
    "Summary artifact mode was used; verbose debug payloads were skipped to reduce memory and serialization overhead.",
  ].join("\n");
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

async function readRuntimeMetrics(path: string): Promise<BenchmarkRuntimeMetrics | null> {
  try {
    return validateBenchmarkRuntimeMetrics(
      JSON.parse(await readFile(path, "utf8")) as BenchmarkRuntimeMetrics,
    );
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

void main();
