import type {
  BenchmarkCitationFieldGroup,
  BenchmarkEvaluationResult,
  BenchmarkInputProfile,
  BenchmarkPartitionSummary,
} from "./types.js";
import {
  evaluateRuntimeGuardrails,
  type BenchmarkRuntimeGuardrailOutcome,
} from "./runtimeGuardrails.js";

const MACRO_REGRESSION_EPSILON = 0.005;
const INSTANCE_REGRESSION_EPSILON = 0.01;
const TOPLINE_RATE_REGRESSION_EPSILON = 0.02;
const TOPLINE_CEILING_REGRESSION_EPSILON = 0.02;
const PROFILE_SOFT_INSTANCE_REGRESSION_EPSILON = 0.03;
const PROFILE_COMPLETENESS_REGRESSION_EPSILON = 0.03;
const PROFILE_FALSE_FILL_REGRESSION_EPSILON = 0.03;

export interface BenchmarkGateOutcome {
  failures: string[];
  warnings: string[];
  reports: string[];
  cleanPartition: BenchmarkPartitionSummary;
  runtimeGuardrails: BenchmarkRuntimeGuardrailOutcome;
  baseline?: {
    cleanMacroSoftF1: number;
    cleanInstanceSoftF1: number;
    macroSoftF1Delta: number;
    instanceSoftF1Delta: number;
    topline: {
      normalizedCitationExactMatchRateDelta: number;
      requiredFieldCompletenessDelta: number;
      falseFillRateDelta: number;
      acceptedWithoutEditRateDelta: number;
      meanNormalizedEditDistanceDelta: number;
      unsupportedFalseCommitRateDelta: number;
      abstainPrecisionDelta: number;
      abstainCoverageDelta: number;
      rawFalsePositiveRepairRateDelta: number | null;
    };
  };
}

export function evaluateBenchmarkGate(
  result: BenchmarkEvaluationResult,
  baseline?: BenchmarkEvaluationResult,
): BenchmarkGateOutcome {
  const clean = getCleanPartition(result);
  const failures: string[] = [...result.contract_sanity.failures];
  const warnings: string[] = [...result.contract_sanity.warnings];
  const reports: string[] = [];
  const runtimeGuardrails = evaluateRuntimeGuardrails(result.runtime_metrics);
  failures.push(...runtimeGuardrails.failures);
  warnings.push(...runtimeGuardrails.warnings);
  reports.push(...runtimeGuardrails.reports);

  if (clean.by_tier.soft.macro_field_f1 < result.thresholds.clean_macro_soft_f1_floor) {
    failures.push(
      `Clean macro soft F1 ${clean.by_tier.soft.macro_field_f1} below floor ${result.thresholds.clean_macro_soft_f1_floor}.`,
    );
  }
  if (clean.by_tier.soft.instance.f1 < result.thresholds.clean_instance_soft_f1_floor) {
    failures.push(
      `Clean instance soft F1 ${clean.by_tier.soft.instance.f1} below floor ${result.thresholds.clean_instance_soft_f1_floor}.`,
    );
  }
  for (const cell of clean.cell_soft_instance_f1) {
    if (cell.compared === 0) continue;
    if (cell.f1 < result.thresholds.per_cell_soft_f1_floor) {
      failures.push(
        `Cell ${cell.citation_style} × ${cell.reference_type} soft F1 ${cell.f1} below floor ${result.thresholds.per_cell_soft_f1_floor}.`,
      );
    }
  }
  appendToplineThresholdFindings(failures, warnings, reports, clean, result);

  if (!baseline) {
    return {
      failures,
      warnings,
      reports,
      cleanPartition: clean,
      runtimeGuardrails,
    };
  }

  const baselineClean = getCleanPartition(baseline);
  const macroSoftF1Delta = round(clean.by_tier.soft.macro_field_f1 - baselineClean.by_tier.soft.macro_field_f1, 4);
  const instanceSoftF1Delta = round(clean.by_tier.soft.instance.f1 - baselineClean.by_tier.soft.instance.f1, 4);
  const normalizedCitationExactMatchRateDelta = round(
    clean.topline.normalized_citation_exact_match_rate
      - baselineClean.topline.normalized_citation_exact_match_rate,
    4,
  );
  const requiredFieldCompletenessDelta = round(
    clean.topline.required_field_completeness - baselineClean.topline.required_field_completeness,
    4,
  );
  const falseFillRateDelta = round(
    clean.topline.false_fill_rate - baselineClean.topline.false_fill_rate,
    4,
  );
  const acceptedWithoutEditRateDelta = round(
    clean.topline.accepted_without_edit_rate - baselineClean.topline.accepted_without_edit_rate,
    4,
  );
  const meanNormalizedEditDistanceDelta = round(
    clean.topline.mean_normalized_edit_distance
      - baselineClean.topline.mean_normalized_edit_distance,
    4,
  );
  const unsupportedFalseCommitRateDelta = round(
    clean.topline.unsupported_false_commit_rate
      - baselineClean.topline.unsupported_false_commit_rate,
    4,
  );
  const abstainPrecisionDelta = round(
    clean.topline.abstain_precision - baselineClean.topline.abstain_precision,
    4,
  );
  const abstainCoverageDelta = round(
    clean.topline.abstain_coverage - baselineClean.topline.abstain_coverage,
    4,
  );
  const rawFalsePositiveRepairRateDelta = computeRawFalsePositiveRepairRateDelta(clean, baselineClean);

  if (macroSoftF1Delta < -MACRO_REGRESSION_EPSILON) {
    failures.push(
      `Clean macro soft F1 regressed by ${macroSoftF1Delta} versus baseline ${baselineClean.by_tier.soft.macro_field_f1}.`,
    );
  }
  if (instanceSoftF1Delta < -INSTANCE_REGRESSION_EPSILON) {
    failures.push(
      `Clean instance soft F1 regressed by ${instanceSoftF1Delta} versus baseline ${baselineClean.by_tier.soft.instance.f1}.`,
    );
  }
  if (
    clean.topline.normalized_citation_exact_match_compared > 0
    && baselineClean.topline.normalized_citation_exact_match_compared > 0
    && normalizedCitationExactMatchRateDelta < -TOPLINE_RATE_REGRESSION_EPSILON
  ) {
    warnings.push(
      `Clean normalized citation exact-match rate regressed by ${normalizedCitationExactMatchRateDelta} versus baseline ${baselineClean.topline.normalized_citation_exact_match_rate}.`,
    );
  }
  if (requiredFieldCompletenessDelta < -TOPLINE_RATE_REGRESSION_EPSILON) {
    failures.push(
      `Clean required-field completeness regressed by ${requiredFieldCompletenessDelta} versus baseline ${baselineClean.topline.required_field_completeness}.`,
    );
  }
  if (falseFillRateDelta > TOPLINE_CEILING_REGRESSION_EPSILON) {
    failures.push(
      `Clean false-fill rate increased by ${falseFillRateDelta} versus baseline ${baselineClean.topline.false_fill_rate}.`,
    );
  }
  if (acceptedWithoutEditRateDelta < -TOPLINE_RATE_REGRESSION_EPSILON) {
    failures.push(
      `Clean accepted-without-edit rate regressed by ${acceptedWithoutEditRateDelta} versus baseline ${baselineClean.topline.accepted_without_edit_rate}.`,
    );
  }
  if (
    clean.topline.mean_normalized_edit_distance_compared > 0
    && baselineClean.topline.mean_normalized_edit_distance_compared > 0
    && meanNormalizedEditDistanceDelta > TOPLINE_CEILING_REGRESSION_EPSILON
  ) {
    failures.push(
      `Clean mean normalized edit distance increased by ${meanNormalizedEditDistanceDelta} versus baseline ${baselineClean.topline.mean_normalized_edit_distance}.`,
    );
  }
  if (
    clean.topline.unsupported_false_commit_compared > 0
    && baselineClean.topline.unsupported_false_commit_compared > 0
    && unsupportedFalseCommitRateDelta > TOPLINE_CEILING_REGRESSION_EPSILON
  ) {
    failures.push(
      `Clean unsupported false-commit rate increased by ${unsupportedFalseCommitRateDelta} versus baseline ${baselineClean.topline.unsupported_false_commit_rate}.`,
    );
  }
  if (
    clean.topline.abstain_precision_compared > 0
    && baselineClean.topline.abstain_precision_compared > 0
    && abstainPrecisionDelta < -TOPLINE_RATE_REGRESSION_EPSILON
  ) {
    failures.push(
      `Clean abstain precision regressed by ${abstainPrecisionDelta} versus baseline ${baselineClean.topline.abstain_precision}.`,
    );
  }
  if (
    clean.topline.abstain_coverage_required > 0
    && baselineClean.topline.abstain_coverage_required > 0
    && abstainCoverageDelta < -TOPLINE_RATE_REGRESSION_EPSILON
  ) {
    failures.push(
      `Clean abstain coverage regressed by ${abstainCoverageDelta} versus baseline ${baselineClean.topline.abstain_coverage}.`,
    );
  }
  if (rawFalsePositiveRepairRateDelta != null && rawFalsePositiveRepairRateDelta < -TOPLINE_RATE_REGRESSION_EPSILON) {
    failures.push(
      `Clean raw false-positive repair rate regressed by ${rawFalsePositiveRepairRateDelta} versus baseline.`,
    );
  }
  appendInputProfileParityFailures(failures, clean, baselineClean);

  return {
    failures,
    warnings,
    reports,
    cleanPartition: clean,
    runtimeGuardrails,
    baseline: {
      cleanMacroSoftF1: baselineClean.by_tier.soft.macro_field_f1,
      cleanInstanceSoftF1: baselineClean.by_tier.soft.instance.f1,
      macroSoftF1Delta,
      instanceSoftF1Delta,
      topline: {
        normalizedCitationExactMatchRateDelta,
        requiredFieldCompletenessDelta,
        falseFillRateDelta,
        acceptedWithoutEditRateDelta,
        meanNormalizedEditDistanceDelta,
        unsupportedFalseCommitRateDelta,
        abstainPrecisionDelta,
        abstainCoverageDelta,
        rawFalsePositiveRepairRateDelta,
      },
    },
  };
}

export function getCleanPartition(result: BenchmarkEvaluationResult): BenchmarkPartitionSummary {
  const clean = result.partitions.find((partition) => partition.partition === "clean");
  if (!clean) {
    throw new Error("Missing clean partition in benchmark result.");
  }
  return clean;
}

function appendToplineThresholdFindings(
  failures: string[],
  warnings: string[],
  reports: string[],
  clean: BenchmarkPartitionSummary,
  result: BenchmarkEvaluationResult,
): void {
  if (
    clean.topline.normalized_citation_exact_match_compared > 0
    && clean.topline.normalized_citation_exact_match_rate
      < result.thresholds.normalized_citation_exact_match_floor
  ) {
    warnings.push(
      `Clean normalized citation exact-match rate ${clean.topline.normalized_citation_exact_match_rate} below floor ${result.thresholds.normalized_citation_exact_match_floor}.`,
    );
  }
  if (
    clean.topline.required_field_completeness
      < result.thresholds.required_field_completeness_floor
  ) {
    failures.push(
      `Clean required-field completeness ${clean.topline.required_field_completeness} below floor ${result.thresholds.required_field_completeness_floor}.`,
    );
  }
  if (clean.topline.false_fill_rate > result.thresholds.false_fill_rate_ceiling) {
    failures.push(
      `Clean false-fill rate ${clean.topline.false_fill_rate} above ceiling ${result.thresholds.false_fill_rate_ceiling}.`,
    );
  }
  if (
    clean.topline.accepted_without_edit_rate
      < result.thresholds.accepted_without_edit_rate_floor
  ) {
    failures.push(
      `Clean accepted-without-edit rate ${clean.topline.accepted_without_edit_rate} below floor ${result.thresholds.accepted_without_edit_rate_floor}.`,
    );
  }
  if (
    clean.topline.mean_normalized_edit_distance_compared > 0
    && clean.topline.mean_normalized_edit_distance
      > result.thresholds.mean_normalized_edit_distance_ceiling
  ) {
    failures.push(
      `Clean mean normalized edit distance ${clean.topline.mean_normalized_edit_distance} above ceiling ${result.thresholds.mean_normalized_edit_distance_ceiling}.`,
    );
  }
  if (
    clean.topline.unsupported_false_commit_compared > 0
    && clean.topline.unsupported_false_commit_rate
      > result.thresholds.unsupported_false_commit_rate_ceiling
  ) {
    failures.push(
      `Clean unsupported false-commit rate ${clean.topline.unsupported_false_commit_rate} above ceiling ${result.thresholds.unsupported_false_commit_rate_ceiling}.`,
    );
  }
  if (
    clean.topline.abstain_precision_compared > 0
    && clean.topline.abstain_precision < result.thresholds.abstain_precision_floor
  ) {
    failures.push(
      `Clean abstain precision ${clean.topline.abstain_precision} below floor ${result.thresholds.abstain_precision_floor}.`,
    );
  }
  if (
    clean.topline.abstain_coverage_required > 0
    && clean.topline.abstain_coverage < result.thresholds.abstain_coverage_floor
  ) {
    failures.push(
      `Clean abstain coverage ${clean.topline.abstain_coverage} below floor ${result.thresholds.abstain_coverage_floor}.`,
    );
  }
  appendCitationFieldQualityFindings(failures, warnings, reports, clean, result);
}

function appendCitationFieldQualityFindings(
  failures: string[],
  warnings: string[],
  reports: string[],
  clean: BenchmarkPartitionSummary,
  result: BenchmarkEvaluationResult,
): void {
  const hardGateGroups = new Set<BenchmarkCitationFieldGroup>(
    result.thresholds.citation_field_hard_gate_groups,
  );
  const warningGroups = new Set<BenchmarkCitationFieldGroup>(
    result.thresholds.citation_field_warning_groups.filter((group) => !hardGateGroups.has(group)),
  );

  for (const row of clean.citation_field_exactness) {
    const floor = result.thresholds.citation_field_exact_match_floor[row.group] ?? 0;
    if (hardGateGroups.has(row.group)) {
      if (row.compared < result.thresholds.citation_field_hard_gate_min_compared) {
        reports.push(
          `Citation field ${row.group} hard gate skipped due low compared count ${row.compared}/${result.thresholds.citation_field_hard_gate_min_compared}.`,
        );
        continue;
      }
      if (row.exact_match_rate < floor) {
        failures.push(
          `Clean citation field ${row.group} exact-match rate ${row.exact_match_rate} below hard floor ${floor}.`,
        );
      }
      continue;
    }

    if (warningGroups.has(row.group)) {
      if (row.compared < result.thresholds.citation_field_warning_min_compared) {
        reports.push(
          `Citation field ${row.group} warning check skipped due low compared count ${row.compared}/${result.thresholds.citation_field_warning_min_compared}.`,
        );
        continue;
      }
      if (row.exact_match_rate < floor) {
        warnings.push(
          `Clean citation field ${row.group} exact-match rate ${row.exact_match_rate} below warning floor ${floor}.`,
        );
      }
      continue;
    }

    reports.push(
      `Citation field ${row.group} exact-match rate observed at ${row.exact_match_rate} (${row.correct}/${row.compared}).`,
    );
  }

  const rawFalsePositive = computeRawFalsePositiveRepairRate(clean);
  if (rawFalsePositive.compared < result.thresholds.citation_field_raw_false_positive_repair_min_compared) {
    if (rawFalsePositive.compared > 0) {
      reports.push(
        `Raw false-positive repair hard gate skipped due low compared count ${rawFalsePositive.compared}/${result.thresholds.citation_field_raw_false_positive_repair_min_compared}.`,
      );
    }
    return;
  }
  if (
    rawFalsePositive.rate != null
    && rawFalsePositive.rate < result.thresholds.citation_field_raw_false_positive_repair_rate_floor
  ) {
    failures.push(
      `Raw false-positive repair rate ${rawFalsePositive.rate} below floor ${result.thresholds.citation_field_raw_false_positive_repair_rate_floor}.`,
    );
  }
}

function computeRawFalsePositiveRepairRate(
  partition: BenchmarkPartitionSummary,
): { compared: number; repaired: number; rate: number | null } {
  const compared = partition.citation_field_exactness.reduce(
    (sum, row) => sum + row.raw_false_positive_compared,
    0,
  );
  const repaired = partition.citation_field_exactness.reduce(
    (sum, row) => sum + row.raw_false_positive_repaired,
    0,
  );
  return {
    compared,
    repaired,
    rate: compared > 0 ? round(repaired / compared, 4) : null,
  };
}

function computeRawFalsePositiveRepairRateDelta(
  clean: BenchmarkPartitionSummary,
  baselineClean: BenchmarkPartitionSummary,
): number | null {
  const current = computeRawFalsePositiveRepairRate(clean);
  const baseline = computeRawFalsePositiveRepairRate(baselineClean);
  if (current.rate == null || baseline.rate == null) {
    return null;
  }
  return round(current.rate - baseline.rate, 4);
}

function appendInputProfileParityFailures(
  failures: string[],
  clean: BenchmarkPartitionSummary,
  baselineClean: BenchmarkPartitionSummary,
): void {
  const baselineByProfile = new Map(
    baselineClean.by_input_profile.map((row) => [row.input_profile, row] as const),
  );

  for (const currentProfile of clean.by_input_profile) {
    const baselineProfile = baselineByProfile.get(currentProfile.input_profile);
    if (!baselineProfile) {
      continue;
    }
    if (currentProfile.compared === 0 || baselineProfile.compared === 0) {
      continue;
    }

    const softInstanceDelta = round(
      currentProfile.soft_instance_f1 - baselineProfile.soft_instance_f1,
      4,
    );
    const completenessDelta = round(
      currentProfile.required_field_completeness
        - baselineProfile.required_field_completeness,
      4,
    );
    const falseFillDelta = round(
      currentProfile.false_fill_rate - baselineProfile.false_fill_rate,
      4,
    );

    if (softInstanceDelta < -PROFILE_SOFT_INSTANCE_REGRESSION_EPSILON) {
      failures.push(
        formatProfileRegression(
          currentProfile.input_profile,
          "soft instance F1",
          softInstanceDelta,
          baselineProfile.soft_instance_f1,
        ),
      );
    }
    if (completenessDelta < -PROFILE_COMPLETENESS_REGRESSION_EPSILON) {
      failures.push(
        formatProfileRegression(
          currentProfile.input_profile,
          "required-field completeness",
          completenessDelta,
          baselineProfile.required_field_completeness,
        ),
      );
    }
    if (falseFillDelta > PROFILE_FALSE_FILL_REGRESSION_EPSILON) {
      failures.push(
        formatProfileRegression(
          currentProfile.input_profile,
          "false-fill rate",
          falseFillDelta,
          baselineProfile.false_fill_rate,
          "increased",
        ),
      );
    }
  }
}

function formatProfileRegression(
  profile: BenchmarkInputProfile,
  metric: string,
  delta: number,
  baselineValue: number,
  verb: "regressed" | "increased" = "regressed",
): string {
  return `Input profile ${profile} ${metric} ${verb} by ${delta} versus baseline ${baselineValue}.`;
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}
