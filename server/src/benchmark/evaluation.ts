import type {
  BenchmarkAccuracySummary,
  BenchmarkAdversarialPairAccuracy,
  BenchmarkArtifactDetail,
  BenchmarkCitationFieldGroup,
  BenchmarkContractSanity,
  BenchmarkHardwareProfile,
  BenchmarkEvaluationResult,
  BenchmarkFieldScore,
  BenchmarkRuntimeMetrics,
  BenchmarkVariant,
  BenchmarkManifestRow,
  BenchmarkMode,
  BenchmarkInputProfile,
  BenchmarkPartitionSummary,
  BenchmarkPredictionRow,
  BenchmarkReferenceType,
  BenchmarkParseOutcome,
  BenchmarkStyle,
  BenchmarkTier,
  BenchmarkTierSummary,
  BenchmarkNoiseType,
  BenchmarkRunProfile,
  BenchmarkSlicePreset,
  BenchmarkSliceRange,
  BenchmarkToplineMetrics,
  BenchmarkStyleFamily,
  BenchmarkStyleScope,
} from "./types.js";
import {
  BENCHMARK_ADVERSARIAL_STYLE_PAIRS,
  BENCHMARK_CITATION_FIELD_GROUPS,
  BENCHMARK_INPUT_PROFILES,
  BENCHMARK_REFERENCE_TYPES,
  BENCHMARK_STYLES,
  BENCHMARK_TIERS,
  benchmarkStyleFamily,
} from "./types.js";
import type { ParseProfile } from "../engine/types/parseProfile.js";
import type { ConvertRequest } from "../engine/types/api.js";
import {
  canonicalizeBenchmarkFieldList,
  flattenManifestFields,
  flattenPredictionFields,
  inferRequiredFields,
  normalizeSoftText,
  normalizeStrictText,
  normalizeBenchmarkValue,
} from "./normalization.js";
import { countUnsupportedPredictedFields } from "./integrity.js";

const MACRO_SOFT_F1_FLOOR = 0.84;
const INSTANCE_SOFT_F1_FLOOR = 0.55;
const PER_CELL_SOFT_F1_FLOOR = 0.75;
const TARGET_MACRO_SOFT_F1 = 0.9;
const BENCHMARK_SCORING_SPEC_VERSION = "grobid-soft-v3";
const FIELD_COVERAGE_HARD_FLOOR = 0.9;
const FIELD_COVERAGE_WARNING_FLOOR = 0.95;
const NORMALIZED_CITATION_EXACT_MATCH_FLOOR = 0.02;
const REQUIRED_FIELD_COMPLETENESS_FLOOR = 0.75;
const FALSE_FILL_RATE_CEILING = 0.3;
const ACCEPTED_WITHOUT_EDIT_RATE_FLOOR = 0.15;
const MEAN_NORMALIZED_EDIT_DISTANCE_CEILING = 0.7;
const UNSUPPORTED_FALSE_COMMIT_RATE_CEILING = 0.05;
const ABSTAIN_PRECISION_FLOOR = 0;
const ABSTAIN_COVERAGE_FLOOR = 0;
const CITATION_FIELD_EXACT_MATCH_FLOOR: Record<BenchmarkCitationFieldGroup, number> = {
  author: 0.7,
  title: 0.7,
  year: 0.8,
  source: 0.55,
  link: 0.7,
};
const CITATION_FIELD_HARD_GATE_GROUPS: BenchmarkCitationFieldGroup[] = ["year", "link"];
const CITATION_FIELD_WARNING_GROUPS: BenchmarkCitationFieldGroup[] = ["author", "title", "source"];
const CITATION_FIELD_HARD_GATE_MIN_COMPARED = 20;
const CITATION_FIELD_WARNING_MIN_COMPARED = 40;
const CITATION_FIELD_RAW_FALSE_POSITIVE_REPAIR_RATE_FLOOR = 0;
const CITATION_FIELD_RAW_FALSE_POSITIVE_REPAIR_MIN_COMPARED = 20;
const SUPPORTED_EXACT_STYLE_SET = new Set<string>(BENCHMARK_STYLES);

export function evaluateBenchmark(
  manifest: BenchmarkManifestRow[],
  predictions: BenchmarkPredictionRow[],
  mode: BenchmarkMode,
  profile: BenchmarkRunProfile = "heuristic-only",
  options: {
    artifactDetail?: BenchmarkArtifactDetail;
    parseProfile?: ParseProfile;
    sourceType?: ConvertRequest["sourceType"];
    hardwareProfile?: BenchmarkHardwareProfile;
    benchmarkVariant?: BenchmarkVariant;
    artifactNamespace?: string;
    slicePreset?: BenchmarkSlicePreset;
    semanticOutputHash?: string;
    fieldHash?: string;
    contractHash?: string;
    sliceRange?: BenchmarkSliceRange | null;
    runtimeMetrics?: BenchmarkRuntimeMetrics;
  } = {},
): BenchmarkEvaluationResult {
  const contractSanity = evaluateBenchmarkContractSanity(manifest, predictions);
  const predictionsByVariant = new Map(
    predictions.map((prediction) => [prediction.variant_id, prediction] as const),
  );

  const partitions = [
    buildPartition("clean", manifest.filter((row) => row.variant_kind === "clean"), predictionsByVariant),
    buildPartition("noisy", manifest.filter((row) => row.variant_kind === "noisy"), predictionsByVariant),
    buildPartition("combined", manifest, predictionsByVariant),
  ];

  const cleanSoftMacro = partitions[0]?.by_tier.soft.macro_field_f1 ?? 0;
  return {
    generated_at: new Date().toISOString(),
    mode,
    profile,
    ...(options.artifactDetail ? { artifact_detail: options.artifactDetail } : {}),
    ...(options.parseProfile ? { parse_profile: options.parseProfile } : {}),
    ...(options.sourceType ? { source_type: options.sourceType } : {}),
    ...(options.hardwareProfile ? { hardware_profile: options.hardwareProfile } : {}),
    ...(options.benchmarkVariant ? { benchmark_variant: options.benchmarkVariant } : {}),
    ...(options.artifactNamespace ? { artifact_namespace: options.artifactNamespace } : {}),
    ...(options.slicePreset ? { slice_preset: options.slicePreset } : {}),
    ...(options.semanticOutputHash ? { semantic_output_hash: options.semanticOutputHash } : {}),
    ...(options.fieldHash ? { field_hash: options.fieldHash } : {}),
    ...(options.contractHash ? { contract_hash: options.contractHash } : {}),
    ...(options.sliceRange
      ? {
          slice_start: options.sliceRange.startRow,
          slice_end: options.sliceRange.endRow,
          slice_row_count: options.sliceRange.endRow - options.sliceRange.startRow + 1,
        }
      : {}),
    scoring_spec_version: BENCHMARK_SCORING_SPEC_VERSION,
    thresholds: {
      clean_macro_soft_f1_floor: MACRO_SOFT_F1_FLOOR,
      clean_instance_soft_f1_floor: INSTANCE_SOFT_F1_FLOOR,
      per_cell_soft_f1_floor: PER_CELL_SOFT_F1_FLOOR,
      target_macro_soft_f1: TARGET_MACRO_SOFT_F1,
      normalized_citation_exact_match_floor: NORMALIZED_CITATION_EXACT_MATCH_FLOOR,
      required_field_completeness_floor: REQUIRED_FIELD_COMPLETENESS_FLOOR,
      false_fill_rate_ceiling: FALSE_FILL_RATE_CEILING,
      accepted_without_edit_rate_floor: ACCEPTED_WITHOUT_EDIT_RATE_FLOOR,
      mean_normalized_edit_distance_ceiling: MEAN_NORMALIZED_EDIT_DISTANCE_CEILING,
      unsupported_false_commit_rate_ceiling: UNSUPPORTED_FALSE_COMMIT_RATE_CEILING,
      abstain_precision_floor: ABSTAIN_PRECISION_FLOOR,
      abstain_coverage_floor: ABSTAIN_COVERAGE_FLOOR,
      citation_field_exact_match_floor: CITATION_FIELD_EXACT_MATCH_FLOOR,
      citation_field_hard_gate_groups: CITATION_FIELD_HARD_GATE_GROUPS,
      citation_field_warning_groups: CITATION_FIELD_WARNING_GROUPS,
      citation_field_hard_gate_min_compared: CITATION_FIELD_HARD_GATE_MIN_COMPARED,
      citation_field_warning_min_compared: CITATION_FIELD_WARNING_MIN_COMPARED,
      citation_field_raw_false_positive_repair_rate_floor:
        CITATION_FIELD_RAW_FALSE_POSITIVE_REPAIR_RATE_FLOOR,
      citation_field_raw_false_positive_repair_min_compared:
        CITATION_FIELD_RAW_FALSE_POSITIVE_REPAIR_MIN_COMPARED,
    },
    contract_sanity: contractSanity,
    partitions,
    target_status: cleanSoftMacro >= TARGET_MACRO_SOFT_F1 ? "pass" : "below_target",
    ...(options.runtimeMetrics ? { runtime_metrics: options.runtimeMetrics } : {}),
  };
}

export function evaluateBenchmarkContractSanity(
  manifest: BenchmarkManifestRow[],
  predictions: BenchmarkPredictionRow[],
): BenchmarkContractSanity {
  const predictionMap = new Map(predictions.map((prediction) => [prediction.variant_id, prediction] as const));
  const fieldCoverage = new Map<string, { expectedRows: number; predictedRows: number }>();
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const row of manifest) {
    const prediction = predictionMap.get(row.variant_id);
    const expectedFields = flattenManifestFields(row);
    const requiredFields = resolveRequiredFields(row);
    const predictedFields = flattenPredictionFields(
      prediction ?? {
        record_id: row.record_id,
        variant_id: row.variant_id,
        citation_style: row.citation_style,
        reference_type: "missing",
        formatted_hash: row.formatted_hash,
        fields: {},
        output_latency_ms: 0,
        duration_ms: 0,
        warnings: [],
      },
    );

    if (prediction && prediction.formatted_hash !== row.formatted_hash) {
      failures.push(
        `Formatted hash mismatch for ${row.variant_id}: prediction ${prediction.formatted_hash} vs manifest ${row.formatted_hash}.`,
      );
    }

    for (const [field, expectedValue] of Object.entries(expectedFields)) {
      if (!hasComparableValue(expectedValue)) continue;
      const current = fieldCoverage.get(field) ?? { expectedRows: 0, predictedRows: 0 };
      current.expectedRows += 1;
      if (hasComparableValue(predictedFields[field])) {
        current.predictedRows += 1;
      }
      fieldCoverage.set(field, current);
    }
  }
  const fieldCoverageRows = [...fieldCoverage.entries()]
    .map(([field, counts]) => {
      const coverage = counts.expectedRows > 0 ? counts.predictedRows / counts.expectedRows : 0;
      const hardFailure = coverage <= FIELD_COVERAGE_HARD_FLOOR;
      const warning = !hardFailure && coverage < FIELD_COVERAGE_WARNING_FLOOR;

      if (hardFailure) {
        failures.push(
          `Field ${field} prediction coverage ${round(coverage, 4)} is at or below the hard floor ${FIELD_COVERAGE_HARD_FLOOR}.`,
        );
      } else if (warning) {
        warnings.push(
          `Field ${field} prediction coverage ${round(coverage, 4)} is below the warning floor ${FIELD_COVERAGE_WARNING_FLOOR}.`,
        );
      }

      return {
        field,
        expected_rows: counts.expectedRows,
        predicted_non_empty_rows: counts.predictedRows,
        coverage: round(coverage, 4),
        hard_failure: hardFailure,
        warning,
      };
    })
    .sort((left, right) => right.expected_rows - left.expected_rows || left.field.localeCompare(right.field));

  const samples = manifest
    .map((row) => {
      const expectedFields = flattenManifestFields(row);
      const requiredFields = resolveRequiredFields(row);
      const prediction = predictionMap.get(row.variant_id);
      const predictedFields = prediction ? flattenPredictionFields(prediction) : {};
      const expectedKeys = Object.entries(expectedFields)
        .filter(([, value]) => hasComparableValue(value))
        .map(([field]) => field)
        .sort();
      const predictedKeys = Object.entries(predictedFields)
        .filter(([, value]) => hasComparableValue(value))
        .map(([field]) => field)
        .sort();
      const missingRequiredFields = requiredFields.filter((field) => !hasComparableValue(predictedFields[field]));
      return {
        variant_id: row.variant_id,
        required_fields: requiredFields,
        expected_keys: expectedKeys,
        predicted_keys: predictedKeys,
        missing_required_fields: missingRequiredFields,
      };
    })
    .filter((sample) => sample.missing_required_fields.length > 0)
    .slice(0, 12);

  return {
    failures,
    warnings,
    field_coverage: fieldCoverageRows,
    samples,
  };
}

function buildPartition(
  partition: BenchmarkPartitionSummary["partition"],
  rows: BenchmarkManifestRow[],
  predictionsByVariant: Map<string, BenchmarkPredictionRow>,
): BenchmarkPartitionSummary {
  const tierState = new Map<
    BenchmarkTier,
    {
      fieldCounts: Map<string, { tp: number; fp: number; fn: number }>;
      instance: { tp: number; fp: number; fn: number };
    }
  >();
  for (const tier of BENCHMARK_TIERS) {
    tierState.set(tier, {
      fieldCounts: new Map(),
      instance: { tp: 0, fp: 0, fn: 0 },
    });
  }

  const cellCounts = new Map<string, { tp: number; fp: number; fn: number; style: BenchmarkStyle; type: BenchmarkReferenceType }>();
  const styleCounts = new Map<BenchmarkStyle, { tp: number; fp: number; fn: number }>();
  const typeCounts = new Map<BenchmarkReferenceType, { tp: number; fp: number; fn: number }>();
  const noiseCounts = new Map<BenchmarkNoiseType, { tp: number; fp: number; fn: number }>();
  const inputProfileCounts = new Map<
    BenchmarkInputProfile,
    {
      tp: number;
      fp: number;
      fn: number;
      compared: number;
      requiredTotal: number;
      requiredPresent: number;
      missingRequired: number;
      predictedNonEmpty: number;
      falseFill: number;
      acceptedWithoutEdit: number;
      normalizedExactMatches: number;
      normalizedCompared: number;
      normalizedEditDistanceTotal: number;
      outcomes: Record<BenchmarkParseOutcome, number>;
    }
  >();
  const fieldCoverage = new Map<string, { expectedRows: number; predictedRows: number }>();
  const citationFieldExactnessCounts = new Map<
    BenchmarkCitationFieldGroup,
    {
      compared: number;
      correct: number;
      rawFalsePositiveCompared: number;
      rawFalsePositiveRepaired: number;
    }
  >(
    BENCHMARK_CITATION_FIELD_GROUPS.map((group) => [
      group,
      {
        compared: 0,
        correct: 0,
        rawFalsePositiveCompared: 0,
        rawFalsePositiveRepaired: 0,
      },
    ]),
  );
  const moveRepairCounts = new Map<string, { phaseId: string; reasonCode: string; total: number; success: number }>();
  const typeConfusionCounts = new Map<string, number>();
  const styleConfusionCounts = new Map<string, number>();
  const adversarialPairCounts = new Map<
    BenchmarkAdversarialPairAccuracy["pair_name"],
    { correct: number; compared: number }
  >(
    BENCHMARK_ADVERSARIAL_STYLE_PAIRS.map((pair) => [
      pair.pair_name,
      { correct: 0, compared: 0 },
    ]),
  );
  let typeCorrect = 0;
  let styleCorrect = 0;
  let styleFamilyCorrect = 0;
  let typeCompared = 0;
  let styleCompared = 0;
  let styleFamilyCompared = 0;
  let totalDurationMs = 0;
  let missingPredictionCount = 0;
  let missingExpectedFieldCount = 0;
  let unsupportedPredictedFieldCount = 0;
  let requiredFieldTotal = 0;
  let requiredFieldPresent = 0;
  let predictedNonEmptyFieldTotal = 0;
  let falseFillCount = 0;
  let acceptedWithoutEditCount = 0;
  let normalizedCitationExactMatches = 0;
  let normalizedCitationCompared = 0;
  let normalizedEditDistanceTotal = 0;
  let normalizedEditDistanceCompared = 0;
  let unsupportedFalseCommitCount = 0;
  let unsupportedFalseCommitCompared = 0;
  let abstainCompared = 0;
  let abstainTruePositive = 0;
  let abstainCoverageRequired = 0;

  for (const row of rows) {
    const prediction = predictionsByVariant.get(row.variant_id);
    const expectedFields = flattenManifestFields(row);
    const requiredFields = resolveRequiredFields(row);
    const predictedFields = prediction ? flattenPredictionFields(prediction) : {};
    const rawPredictedFields = prediction?.raw_fields
      ? flattenPredictionFields({
          ...prediction,
          fields: prediction.raw_fields,
        })
      : predictedFields;
    const inputProfile = classifyInputProfile(row);
    const profileCounts = getMutableProfileCounts(inputProfileCounts, inputProfile);
    updateCitationFieldExactness(
      citationFieldExactnessCounts,
      expectedFields,
      predictedFields,
      rawPredictedFields,
      row.formatted_string,
    );
    if (!prediction) {
      missingPredictionCount += 1;
    }
    if (prediction) {
      totalDurationMs += prediction.duration_ms;
      unsupportedPredictedFieldCount += countUnsupportedPredictedFields(prediction);
      typeCompared += 1;
      styleCompared += 1;
      styleFamilyCompared += 1;
      const detectedType = prediction.detected_type ?? prediction.reference_type;
      const detectedStyle = prediction.detected_style ?? "missing";
      const detectedStyleFamily = toDetectedStyleFamily(prediction);
      const expectedStyleFamily = benchmarkStyleFamily(row.citation_style);
      if (detectedType === row.reference_type) {
        typeCorrect += 1;
      } else {
        typeConfusionCounts.set(
          `${row.reference_type}::${detectedType}`,
          (typeConfusionCounts.get(`${row.reference_type}::${detectedType}`) ?? 0) + 1,
        );
      }
      if (detectedStyle === row.citation_style) {
        styleCorrect += 1;
      } else {
        styleConfusionCounts.set(
          `${row.citation_style}::${detectedStyle}`,
          (styleConfusionCounts.get(`${row.citation_style}::${detectedStyle}`) ?? 0) + 1,
        );
      }
      if (detectedStyleFamily === expectedStyleFamily) {
        styleFamilyCorrect += 1;
      }
      for (const pair of BENCHMARK_ADVERSARIAL_STYLE_PAIRS) {
        if (!pair.styles.some((style) => style === row.citation_style)) {
          continue;
        }
        const counts = adversarialPairCounts.get(pair.pair_name)!;
        counts.compared += 1;
        if (detectedStyle === row.citation_style) {
          counts.correct += 1;
        }
      }
    }
    const styleScope = toStyleScope(row.style_scope);
    if (styleScope !== "supported_exact") {
      unsupportedFalseCommitCompared += 1;
      if (isSupportedExactStyle(prediction?.detected_style)) {
        unsupportedFalseCommitCount += 1;
      }
    }

    for (const [field, expectedValue] of Object.entries(expectedFields)) {
      if (expectedValue == null) continue;
      const fieldCoverageCounts = fieldCoverage.get(field) ?? { expectedRows: 0, predictedRows: 0 };
      fieldCoverageCounts.expectedRows += 1;
      if (hasComparableValue(predictedFields[field])) {
        fieldCoverageCounts.predictedRows += 1;
      }
      fieldCoverage.set(field, fieldCoverageCounts);
      if (!hasComparableValue(predictedFields[field])) {
        missingExpectedFieldCount += 1;
      }
    }

    for (const tier of BENCHMARK_TIERS) {
      const state = tierState.get(tier)!;
      const instanceMatched = requiredFields.every((field) =>
        compareField(
          field,
          predictedFields[field],
          expectedFields[field],
          tier,
          row.formatted_string,
        ),
      );
      if (instanceMatched) {
        state.instance.tp += 1;
      } else {
        state.instance.fp += 1;
        state.instance.fn += 1;
      }

      for (const [field, expectedValue] of Object.entries(expectedFields)) {
        if (expectedValue == null) continue;
        const matched = compareField(field, predictedFields[field], expectedValue, tier, row.formatted_string);
        const counts = getMutableCounts(state.fieldCounts, field);
        if (matched) {
          counts.tp += 1;
        } else if (hasComparableValue(predictedFields[field])) {
          counts.fp += 1;
        } else {
          counts.fn += 1;
        }
      }
    }

    const softMatched = requiredFields.every((field) =>
      compareField(field, predictedFields[field], expectedFields[field], "soft", row.formatted_string),
    );
    const missingRequiredCount = requiredFields.filter((field) =>
      !compareField(field, predictedFields[field], expectedFields[field], "soft", row.formatted_string),
    ).length;
    const requiredPresentCount = requiredFields.filter((field) => hasComparableValue(predictedFields[field])).length;
    requiredFieldTotal += requiredFields.length;
    requiredFieldPresent += requiredPresentCount;
    profileCounts.compared += 1;
    profileCounts.requiredTotal += requiredFields.length;
    profileCounts.requiredPresent += requiredPresentCount;
    profileCounts.missingRequired += missingRequiredCount;
    const parseOutcome = deriveBenchmarkParseOutcome(
      prediction,
      missingRequiredCount,
    );
    profileCounts.outcomes[parseOutcome] += 1;
    const comparablePredictedFields = Object.entries(predictedFields).filter(
      ([field, value]) => field !== "firstAuthor" && hasComparableValue(value),
    );
    predictedNonEmptyFieldTotal += comparablePredictedFields.length;
    profileCounts.predictedNonEmpty += comparablePredictedFields.length;
    for (const [field] of comparablePredictedFields) {
      if (!hasComparableValue(expectedFields[field])) {
        falseFillCount += 1;
        profileCounts.falseFill += 1;
      }
    }
    const correctedOutput = row.corrected_output ?? row.formatted_string;
    const renderedText = prediction?.rendered_text;
    if (hasComparableValue(renderedText) && hasComparableValue(correctedOutput)) {
      const normalizedRendered = normalizeSoftText(String(renderedText));
      const normalizedCorrected = normalizeSoftText(correctedOutput);
      normalizedCitationCompared += 1;
      profileCounts.normalizedCompared += 1;
      if (normalizedRendered === normalizedCorrected) {
        normalizedCitationExactMatches += 1;
        profileCounts.normalizedExactMatches += 1;
      }
      const editDistance = normalizedEditDistance(normalizedRendered, normalizedCorrected);
      normalizedEditDistanceTotal += editDistance;
      normalizedEditDistanceCompared += 1;
      profileCounts.normalizedEditDistanceTotal += editDistance;
    }
    const abstained = parseOutcome !== "high_confidence_parse";
    const abstainRequired = missingRequiredCount > 0;
    if (abstained) {
      abstainCompared += 1;
      if (abstainRequired) {
        abstainTruePositive += 1;
      }
    }
    if (abstainRequired) {
      abstainCoverageRequired += 1;
    }
    if (isAcceptedWithoutEdit(prediction, parseOutcome, missingRequiredCount)) {
      acceptedWithoutEditCount += 1;
      profileCounts.acceptedWithoutEdit += 1;
    }
    const cellKey = `${row.citation_style}::${row.reference_type}`;
    const cell = cellCounts.get(cellKey) ?? {
      tp: 0,
      fp: 0,
      fn: 0,
      style: row.citation_style,
      type: row.reference_type,
    };
    if (softMatched) {
      cell.tp += 1;
      profileCounts.tp += 1;
      getMutableCounts(styleCounts, row.citation_style).tp += 1;
      getMutableCounts(typeCounts, row.reference_type).tp += 1;
      for (const noise of row.noise_applied) {
        getMutableCounts(noiseCounts, noise).tp += 1;
      }
    } else {
      cell.fp += 1;
      cell.fn += 1;
      profileCounts.fp += 1;
      profileCounts.fn += 1;
      getMutableCounts(styleCounts, row.citation_style).fp += 1;
      getMutableCounts(styleCounts, row.citation_style).fn += 1;
      getMutableCounts(typeCounts, row.reference_type).fp += 1;
      getMutableCounts(typeCounts, row.reference_type).fn += 1;
      for (const noise of row.noise_applied) {
        getMutableCounts(noiseCounts, noise).fp += 1;
        getMutableCounts(noiseCounts, noise).fn += 1;
      }
    }
    cellCounts.set(cellKey, cell);

    for (const move of prediction?.field_move_ledger ?? []) {
      const success = move.destinationField in expectedFields
        ? compareField(
            move.destinationField,
            predictedFields[move.destinationField],
            expectedFields[move.destinationField],
            "soft",
            row.formatted_string,
          )
        : false;
      const key = `${move.phaseId}::${move.reasonCode}`;
      const counts = moveRepairCounts.get(key) ?? {
        phaseId: move.phaseId,
        reasonCode: move.reasonCode,
        total: 0,
        success: 0,
      };
      counts.total += 1;
      if (success) {
        counts.success += 1;
      }
      moveRepairCounts.set(key, counts);
    }
  }

  return {
    partition,
    by_tier: Object.fromEntries(
      BENCHMARK_TIERS.map((tier) => [tier, finalizeTierSummary(tierState.get(tier)!)]),
    ) as Record<BenchmarkTier, BenchmarkTierSummary>,
    topline: buildToplineMetrics({
      rowCount: rows.length,
      normalizedCitationExactMatches,
      normalizedCitationCompared,
      requiredFieldPresent,
      requiredFieldTotal,
      falseFillCount,
      predictedNonEmptyFieldTotal,
      acceptedWithoutEditCount,
      normalizedEditDistanceTotal,
      normalizedEditDistanceCompared,
      unsupportedFalseCommitCount,
      unsupportedFalseCommitCompared,
      abstainTruePositive,
      abstainCompared,
      abstainCoverageRequired,
    }),
    citation_field_exactness: buildCitationFieldExactnessRows(citationFieldExactnessCounts),
    field_contract: buildFieldContractRows(
      fieldCoverage,
      tierState.get("strict")!,
      tierState.get("soft")!,
    ),
    cell_soft_instance_f1: BENCHMARK_STYLES.flatMap((style) =>
      BENCHMARK_REFERENCE_TYPES.map((referenceType) => {
        const cell = cellCounts.get(`${style}::${referenceType}`) ?? {
          tp: 0,
          fp: 0,
          fn: 0,
          style,
          type: referenceType,
        };
        const score = computeScore(cell.tp, cell.fp, cell.fn);
        return {
          citation_style: style,
          reference_type: referenceType,
          compared: cell.tp + cell.fn,
          f1: score.f1,
          below_threshold: score.f1 < PER_CELL_SOFT_F1_FLOOR,
        };
      }),
    ),
    by_input_profile: BENCHMARK_INPUT_PROFILES.map((input_profile) => {
      const counts = inputProfileCounts.get(input_profile) ?? {
        tp: 0,
        fp: 0,
        fn: 0,
        compared: 0,
        requiredTotal: 0,
        requiredPresent: 0,
        missingRequired: 0,
        predictedNonEmpty: 0,
        falseFill: 0,
        acceptedWithoutEdit: 0,
        normalizedExactMatches: 0,
        normalizedCompared: 0,
        normalizedEditDistanceTotal: 0,
        outcomes: {
          high_confidence_parse: 0,
          partial_parse_with_abstentions: 0,
          needs_action: 0,
        },
      };
      return {
        input_profile,
        compared: counts.compared,
        soft_instance_f1: computeScore(counts.tp, counts.fp, counts.fn).f1,
        high_confidence_parse_rate: counts.compared > 0
          ? round(counts.outcomes.high_confidence_parse / counts.compared, 4)
          : 0,
        partial_parse_with_abstentions_rate: counts.compared > 0
          ? round(counts.outcomes.partial_parse_with_abstentions / counts.compared, 4)
          : 0,
        needs_action_rate: counts.compared > 0
          ? round(counts.outcomes.needs_action / counts.compared, 4)
          : 0,
        abstain_rate: counts.requiredTotal > 0
          ? round(counts.missingRequired / counts.requiredTotal, 4)
          : 0,
        required_field_completeness: counts.requiredTotal > 0
          ? round(counts.requiredPresent / counts.requiredTotal, 4)
          : 0,
        false_fill_rate: counts.predictedNonEmpty > 0
          ? round(counts.falseFill / counts.predictedNonEmpty, 4)
          : 0,
        accepted_without_edit_rate: counts.compared > 0
          ? round(counts.acceptedWithoutEdit / counts.compared, 4)
          : 0,
        normalized_citation_exact_match_rate: counts.normalizedCompared > 0
          ? round(counts.normalizedExactMatches / counts.normalizedCompared, 4)
          : 0,
      };
    }),
    by_style: [...styleCounts.entries()].map(([citation_style, counts]) => ({
      citation_style,
      compared: counts.tp + counts.fn,
      soft_instance_f1: computeScore(counts.tp, counts.fp, counts.fn).f1,
    })),
    by_type: [...typeCounts.entries()].map(([reference_type, counts]) => ({
      reference_type,
      compared: counts.tp + counts.fn,
      soft_instance_f1: computeScore(counts.tp, counts.fp, counts.fn).f1,
    })),
    by_noise_type: [...noiseCounts.entries()].map(([noise_type, counts]) => ({
      noise_type,
      compared: counts.tp + counts.fn,
      soft_instance_f1: computeScore(counts.tp, counts.fp, counts.fn).f1,
    })),
    move_level_repairs: [...moveRepairCounts.values()]
      .sort((left, right) => right.total - left.total || left.reasonCode.localeCompare(right.reasonCode))
      .map((entry) => ({
        phase_id: entry.phaseId,
        reason_code: entry.reasonCode,
        total_repairs: entry.total,
        successful_repairs: entry.success,
        precision: entry.total > 0 ? round(entry.success / entry.total, 4) : 0,
      })),
    type_accuracy: {
      correct: typeCorrect,
      compared: typeCompared,
      accuracy: typeCompared > 0 ? round(typeCorrect / typeCompared, 4) : 0,
    },
    style_accuracy: {
      correct: styleCorrect,
      compared: styleCompared,
      accuracy: styleCompared > 0 ? round(styleCorrect / styleCompared, 4) : 0,
    },
    style_family_accuracy: computeAccuracySummary(styleFamilyCorrect, styleFamilyCompared),
    adversarial_pair_accuracy: BENCHMARK_ADVERSARIAL_STYLE_PAIRS.map((pair) => {
      const counts = adversarialPairCounts.get(pair.pair_name) ?? { correct: 0, compared: 0 };
      return {
        pair_name: pair.pair_name,
        styles: pair.styles,
        correct: counts.correct,
        compared: counts.compared,
        accuracy: counts.compared > 0 ? round(counts.correct / counts.compared, 4) : 0,
      };
    }),
    type_confusions: [...typeConfusionCounts.entries()]
      .map(([key, count]) => {
        const [expected_type, detected_type] = key.split("::");
        return {
          expected_type: expected_type as BenchmarkReferenceType,
          detected_type: detected_type ?? "missing",
          count,
        };
      })
      .sort((left, right) => right.count - left.count),
    style_confusions: [...styleConfusionCounts.entries()]
      .map(([key, count]) => {
        const [expected_style, detected_style] = key.split("::");
        return {
          expected_style: expected_style as BenchmarkStyle,
          detected_style: detected_style ?? "missing",
          count,
        };
      })
      .sort((left, right) => right.count - left.count),
    throughput_refs_per_sec: totalDurationMs > 0 ? round(rows.length / (totalDurationMs / 1000), 2) : 0,
    missing_prediction_count: missingPredictionCount,
    missing_expected_field_count: missingExpectedFieldCount,
    unsupported_predicted_field_count: unsupportedPredictedFieldCount,
  };
}

function resolveRequiredFields(row: BenchmarkManifestRow): string[] {
  return canonicalizeBenchmarkFieldList(inferRequiredFields(row));
}

function computeAccuracySummary(correct: number, compared: number): BenchmarkAccuracySummary {
  return {
    correct,
    compared,
    accuracy: compared > 0 ? round(correct / compared, 4) : 0,
  };
}

function buildToplineMetrics(input: {
  rowCount: number;
  normalizedCitationExactMatches: number;
  normalizedCitationCompared: number;
  requiredFieldPresent: number;
  requiredFieldTotal: number;
  falseFillCount: number;
  predictedNonEmptyFieldTotal: number;
  acceptedWithoutEditCount: number;
  normalizedEditDistanceTotal: number;
  normalizedEditDistanceCompared: number;
  unsupportedFalseCommitCount: number;
  unsupportedFalseCommitCompared: number;
  abstainTruePositive: number;
  abstainCompared: number;
  abstainCoverageRequired: number;
}): BenchmarkToplineMetrics {
  return {
    normalized_citation_exact_match_rate: input.normalizedCitationCompared > 0
      ? round(input.normalizedCitationExactMatches / input.normalizedCitationCompared, 4)
      : 0,
    normalized_citation_exact_match_compared: input.normalizedCitationCompared,
    required_field_completeness: input.requiredFieldTotal > 0
      ? round(input.requiredFieldPresent / input.requiredFieldTotal, 4)
      : 0,
    false_fill_rate: input.predictedNonEmptyFieldTotal > 0
      ? round(input.falseFillCount / input.predictedNonEmptyFieldTotal, 4)
      : 0,
    accepted_without_edit_rate: input.rowCount > 0
      ? round(input.acceptedWithoutEditCount / input.rowCount, 4)
      : 0,
    mean_normalized_edit_distance: input.normalizedEditDistanceCompared > 0
      ? round(input.normalizedEditDistanceTotal / input.normalizedEditDistanceCompared, 4)
      : 0,
    mean_normalized_edit_distance_compared: input.normalizedEditDistanceCompared,
    unsupported_false_commit_rate: input.unsupportedFalseCommitCompared > 0
      ? round(input.unsupportedFalseCommitCount / input.unsupportedFalseCommitCompared, 4)
      : 0,
    unsupported_false_commit_compared: input.unsupportedFalseCommitCompared,
    abstain_precision: input.abstainCompared > 0
      ? round(input.abstainTruePositive / input.abstainCompared, 4)
      : 1,
    abstain_precision_compared: input.abstainCompared,
    abstain_coverage: input.abstainCoverageRequired > 0
      ? round(input.abstainTruePositive / input.abstainCoverageRequired, 4)
      : 1,
    abstain_coverage_required: input.abstainCoverageRequired,
  };
}

const CITATION_FIELD_GROUP_KEYS: Record<BenchmarkCitationFieldGroup, readonly string[]> = {
  author: ["authors"],
  title: ["title"],
  year: ["year"],
  source: [
    "journal/venue",
    "journal",
    "conferenceTitle",
    "bookTitle",
    "publisher",
    "institution",
    "siteName",
    "repository",
  ],
  link: ["doi", "url"],
};

function updateCitationFieldExactness(
  countsByGroup: Map<
    BenchmarkCitationFieldGroup,
    {
      compared: number;
      correct: number;
      rawFalsePositiveCompared: number;
      rawFalsePositiveRepaired: number;
    }
  >,
  expectedFields: Record<string, unknown>,
  predictedFields: Record<string, unknown>,
  rawPredictedFields: Record<string, unknown>,
  formattedString: string,
): void {
  for (const group of BENCHMARK_CITATION_FIELD_GROUPS) {
    const groupCounts = countsByGroup.get(group);
    if (!groupCounts) continue;
    const keys = CITATION_FIELD_GROUP_KEYS[group];
    const expectedKeys = keys.filter((key) => hasComparableValue(expectedFields[key]));
    const predictedKeys = keys.filter((key) => hasComparableValue(predictedFields[key]));
    const rawPredictedKeys = keys.filter((key) => hasComparableValue(rawPredictedFields[key]));

    if (expectedKeys.length > 0) {
      groupCounts.compared += 1;
      if (
        expectedKeys.some((expectedKey) =>
          predictedKeys.some((predictedKey) =>
            compareField(
              expectedKey,
              predictedFields[predictedKey],
              expectedFields[expectedKey],
              "strict",
              formattedString,
            ),
          ),
        )
      ) {
        groupCounts.correct += 1;
      }
      continue;
    }

    if (rawPredictedKeys.length > 0) {
      groupCounts.rawFalsePositiveCompared += 1;
      if (predictedKeys.length === 0) {
        groupCounts.rawFalsePositiveRepaired += 1;
      }
    }
  }
}

function buildCitationFieldExactnessRows(
  countsByGroup: Map<
    BenchmarkCitationFieldGroup,
    {
      compared: number;
      correct: number;
      rawFalsePositiveCompared: number;
      rawFalsePositiveRepaired: number;
    }
  >,
): BenchmarkPartitionSummary["citation_field_exactness"] {
  return BENCHMARK_CITATION_FIELD_GROUPS.map((group) => {
    const counts = countsByGroup.get(group) ?? {
      compared: 0,
      correct: 0,
      rawFalsePositiveCompared: 0,
      rawFalsePositiveRepaired: 0,
    };
    return {
      group,
      exact_match_rate: counts.compared > 0 ? round(counts.correct / counts.compared, 4) : 0,
      compared: counts.compared,
      correct: counts.correct,
      raw_false_positive_repair_rate: counts.rawFalsePositiveCompared > 0
        ? round(counts.rawFalsePositiveRepaired / counts.rawFalsePositiveCompared, 4)
        : 0,
      raw_false_positive_compared: counts.rawFalsePositiveCompared,
      raw_false_positive_repaired: counts.rawFalsePositiveRepaired,
    };
  });
}

function buildFieldContractRows(
  fieldCoverage: Map<string, { expectedRows: number; predictedRows: number }>,
  strictTier: {
    fieldCounts: Map<string, { tp: number; fp: number; fn: number }>;
    instance: { tp: number; fp: number; fn: number };
  },
  softTier: {
    fieldCounts: Map<string, { tp: number; fp: number; fn: number }>;
    instance: { tp: number; fp: number; fn: number };
  },
) {
  return [...fieldCoverage.entries()]
    .map(([field, coverage]) => {
      const strictCounts = strictTier.fieldCounts.get(field) ?? { tp: 0, fp: 0, fn: 0 };
      const softCounts = softTier.fieldCounts.get(field) ?? { tp: 0, fp: 0, fn: 0 };
      const strictScore = computeScore(strictCounts.tp, strictCounts.fp, strictCounts.fn);
      const softScore = computeScore(softCounts.tp, softCounts.fp, softCounts.fn);
      return {
        field,
        expected_rows: coverage.expectedRows,
        predicted_non_empty_rows: coverage.predictedRows,
        coverage: coverage.expectedRows > 0 ? round(coverage.predictedRows / coverage.expectedRows, 4) : 0,
        exact_f1: strictScore.f1,
        canonical_f1: softScore.f1,
        exact_precision_non_abstained: strictScore.precision,
        canonical_precision_non_abstained: softScore.precision,
      };
    })
    .sort((left, right) => right.expected_rows - left.expected_rows || left.field.localeCompare(right.field));
}

function classifyInputProfile(row: BenchmarkManifestRow): BenchmarkInputProfile {
  if (row.input_source_kind === "pdf_copy") {
    return "pasted_pdf_copy";
  }
  if (row.input_source_kind === "numbered_block") {
    return "multiline_numbered";
  }
  if (row.input_source_kind === "raw_pasted" && row.variant_kind === "noisy") {
    return "ocr_like";
  }
  return row.variant_kind === "noisy" ? "structured_noisy" : "structured_clean";
}

function deriveBenchmarkParseOutcome(
  prediction: BenchmarkPredictionRow | undefined,
  missingRequiredCount: number,
): BenchmarkParseOutcome {
  if (
    prediction?.parse_outcome === "high_confidence_parse"
    || prediction?.parse_outcome === "partial_parse_with_abstentions"
    || prediction?.parse_outcome === "needs_action"
  ) {
    return prediction.parse_outcome;
  }

  if (prediction?.status === "error" || prediction?.public_status === "needs_action") {
    return "needs_action";
  }
  if (missingRequiredCount > 0 || prediction?.public_status === "needs_review") {
    return "partial_parse_with_abstentions";
  }
  return "high_confidence_parse";
}

function isAcceptedWithoutEdit(
  prediction: BenchmarkPredictionRow | undefined,
  parseOutcome: BenchmarkParseOutcome,
  missingRequiredCount: number,
): boolean {
  if (!prediction) {
    return false;
  }
  if (parseOutcome !== "high_confidence_parse") {
    return false;
  }
  if (missingRequiredCount > 0) {
    return false;
  }
  if (prediction.status === "error") {
    return false;
  }
  return prediction.public_status !== "needs_action" && prediction.public_status !== "needs_review";
}

function toStyleScope(scope: BenchmarkStyleScope | undefined): BenchmarkStyleScope {
  return scope ?? "supported_exact";
}

function isSupportedExactStyle(style: string | undefined): boolean {
  if (!style) {
    return false;
  }
  return SUPPORTED_EXACT_STYLE_SET.has(style);
}

function getMutableProfileCounts(
  map: Map<
    BenchmarkInputProfile,
    {
      tp: number;
      fp: number;
      fn: number;
      compared: number;
      requiredTotal: number;
      requiredPresent: number;
      missingRequired: number;
      predictedNonEmpty: number;
      falseFill: number;
      acceptedWithoutEdit: number;
      normalizedExactMatches: number;
      normalizedCompared: number;
      normalizedEditDistanceTotal: number;
      outcomes: Record<BenchmarkParseOutcome, number>;
    }
  >,
  key: BenchmarkInputProfile,
) {
  const current = map.get(key) ?? {
    tp: 0,
    fp: 0,
    fn: 0,
    compared: 0,
    requiredTotal: 0,
    requiredPresent: 0,
    missingRequired: 0,
    predictedNonEmpty: 0,
    falseFill: 0,
    acceptedWithoutEdit: 0,
    normalizedExactMatches: 0,
    normalizedCompared: 0,
    normalizedEditDistanceTotal: 0,
    outcomes: {
      high_confidence_parse: 0,
      partial_parse_with_abstentions: 0,
      needs_action: 0,
    },
  };
  map.set(key, current);
  return current;
}

function toDetectedStyleFamily(prediction: BenchmarkPredictionRow): BenchmarkStyleFamily {
  const explicitFamily = prediction.detected_style_family;
  if (
    explicitFamily === "author_date"
    || explicitFamily === "notes_bibliography"
    || explicitFamily === "numeric"
    || explicitFamily === "web_accessed"
    || explicitFamily === "unknown"
  ) {
    return explicitFamily;
  }
  return benchmarkStyleFamily(prediction.detected_style ?? "unknown");
}

export function compareField(
  field: string,
  predicted: unknown,
  expected: unknown,
  tier: BenchmarkTier,
  formattedString?: string,
): boolean {
  const normalizedExpected = normalizeBenchmarkValue(field, expected);
  const normalizedPredicted = normalizeBenchmarkValue(field, predicted);
  if (normalizedExpected == null) return true;
  if (normalizedPredicted == null) return false;

  if (field === "authors") {
    return compareAuthors(normalizedPredicted, normalizedExpected, formattedString);
  }
  if (field === "firstAuthor") {
    return compareFirstAuthor(normalizedPredicted, normalizedExpected);
  }
  if (["journal/venue", "journal", "conferenceTitle", "bookTitle"].includes(field)) {
    return compareContainerField(normalizedPredicted, normalizedExpected, tier);
  }
  if (field === "title") {
    return tokenJaccard(normalizedPredicted, normalizedExpected) >= 0.8;
  }
  if (field === "year") {
    return compareYear(normalizedPredicted, normalizedExpected);
  }
  if (["doi", "pmid", "arxiv", "isbn", "issn", "handle", "patent", "url"].includes(field)) {
    return compareExact(normalizedPredicted, normalizedExpected);
  }

  return compareByTier(normalizedPredicted, normalizedExpected, tier);
}

function compareAuthors(
  predicted: unknown,
  expected: unknown,
  formattedString?: string,
): boolean {
  const predictedValues = toStringArray(predicted);
  const expectedValues = toStringArray(expected);
  const predictedAuthors = predictedValues
    .map(parseAuthorIdentity)
    .filter((author): author is ParsedAuthorIdentity => author != null);
  const expectedAuthors = expectedValues
    .map(parseAuthorIdentity)
    .filter((author): author is ParsedAuthorIdentity => author != null);
  if (predictedAuthors.length === 0 || expectedAuthors.length === 0) return false;

  let matches = 0;
  const usedExpected = new Set<number>();
  for (const predictedAuthor of predictedAuthors) {
    const matchIndex = expectedAuthors.findIndex(
      (expectedAuthor, index) =>
        !usedExpected.has(index) && authorsAreCompatible(predictedAuthor, expectedAuthor),
    );
    if (matchIndex >= 0) {
      matches += 1;
      usedExpected.add(matchIndex);
    }
  }

  const union = predictedAuthors.length + expectedAuthors.length - matches;
  if (union > 0 && matches / union >= 0.7) {
    return true;
  }

  if (
    !hasExplicitAuthorCondensation(predictedValues)
    && !hasExplicitAuthorCondensation(formattedString ? [formattedString] : [])
  ) {
    return false;
  }

  return compareCondensedAuthors(predictedAuthors, expectedAuthors);
}

function compareFirstAuthor(predicted: unknown, expected: unknown): boolean {
  const predictedAuthor = parseAuthorIdentity(String(predicted ?? ""));
  const expectedAuthor = parseAuthorIdentity(String(expected ?? ""));
  if (!predictedAuthor || !expectedAuthor) return false;
  return authorsAreCompatible(predictedAuthor, expectedAuthor);
}

function compareYear(predicted: unknown, expected: unknown): boolean {
  const predictedValue = Number.parseInt(String(predicted), 10);
  const expectedValue = Number.parseInt(String(expected), 10);
  return Number.isFinite(predictedValue) && Number.isFinite(expectedValue)
    && Math.abs(predictedValue - expectedValue) <= 1;
}

function compareExact(predicted: unknown, expected: unknown): boolean {
  return JSON.stringify(predicted) === JSON.stringify(expected);
}

function compareByTier(
  predicted: unknown,
  expected: unknown,
  tier: BenchmarkTier,
): boolean {
  const predictedText = stringifyComparable(predicted);
  const expectedText = stringifyComparable(expected);
  switch (tier) {
    case "strict":
      return normalizeStrictText(predictedText) === normalizeStrictText(expectedText);
    case "soft":
      return normalizeSoftText(predictedText) === normalizeSoftText(expectedText);
    case "levenshtein":
      return normalizedLevenshtein(predictedText, expectedText) >= 0.8;
    case "ratcliff_obershelp":
      return ratcliffObershelp(predictedText, expectedText) >= 0.95;
  }
}

function finalizeTierSummary(state: {
  fieldCounts: Map<string, { tp: number; fp: number; fn: number }>;
  instance: { tp: number; fp: number; fn: number };
}): BenchmarkTierSummary {
  const fields = Object.fromEntries(
    [...state.fieldCounts.entries()].map(([field, counts]) => [
      field,
      computeScore(counts.tp, counts.fp, counts.fn),
    ]),
  );
  const macroFieldScores = Object.values(fields).map((score) => score.f1);
  return {
    fields,
    macro_field_f1: macroFieldScores.length > 0
      ? round(macroFieldScores.reduce((sum, score) => sum + score, 0) / macroFieldScores.length, 4)
      : 0,
    instance: computeScore(state.instance.tp, state.instance.fp, state.instance.fn),
    total_rows: state.instance.tp + state.instance.fn,
  };
}

function getMutableCounts<K>(
  map: Map<K, { tp: number; fp: number; fn: number }>,
  key: K,
): { tp: number; fp: number; fn: number } {
  const current = map.get(key) ?? { tp: 0, fp: 0, fn: 0 };
  map.set(key, current);
  return current;
}

function computeScore(tp: number, fp: number, fn: number): BenchmarkFieldScore {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    tp,
    fp,
    fn,
    precision: round(precision, 4),
    recall: round(recall, 4),
    f1: round(f1, 4),
  };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "")).filter(Boolean);
  }
  return typeof value === "string" ? [value] : [];
}

function tokenizeName(value: string): string[] {
  return normalizeSoftText(value).split(" ").filter(Boolean);
}

interface ParsedAuthorIdentity {
  family: string;
  familyCandidates: string[];
  givenTokens: string[];
  initials: string[];
}

const AUTHOR_PARTICLE_TOKENS = new Set([
  "da",
  "das",
  "de",
  "del",
  "della",
  "den",
  "der",
  "di",
  "do",
  "dos",
  "du",
  "ibn",
  "la",
  "le",
  "van",
  "von",
  "y",
]);

function parseAuthorIdentity(value: string): ParsedAuthorIdentity | null {
  const raw = sanitizeComparableAuthorDisplay(String(value ?? ""));
  const normalized = normalizeSoftText(raw);
  if (!normalized) return null;
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length === 0) return null;

  let family = "";
  let givenTokens: string[] = [];
  if (raw.includes(",")) {
    const [familyPartRaw, givenPartRaw = ""] = raw.split(",").map((part) => part.trim());
    const familyPart = normalizeSoftText(familyPartRaw);
    const givenPart = normalizeSoftText(givenPartRaw);
    family = familyPart;
    givenTokens = givenPart.split(" ").filter(Boolean);
  } else {
    family = parts[parts.length - 1] ?? "";
    givenTokens = parts.slice(0, -1);
  }

  const familyCandidates = [...new Set([
    family,
    ...buildAlternateFamilyCandidates(family, givenTokens),
  ].filter(Boolean))];

  return {
    family,
    familyCandidates,
    givenTokens,
    initials: givenTokens.map((token) => token[0] ?? "").filter(Boolean),
  };
}

function sanitizeComparableAuthorDisplay(value: string): string {
  return value
    .replace(/^\s*[….]+\s*/u, "")
    .replace(/\bet al\.?\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function authorsAreCompatible(
  predicted: ParsedAuthorIdentity,
  expected: ParsedAuthorIdentity,
): boolean {
  if (!predicted.family || !expected.family) return false;
  const familyCompatible = predicted.familyCandidates.some((candidate) =>
    expected.familyCandidates.includes(candidate),
  );
  if (!familyCompatible) return false;

  if (predicted.givenTokens.length === 0 || expected.givenTokens.length === 0) {
    return true;
  }

  if (predicted.givenTokens.join(" ") === expected.givenTokens.join(" ")) {
    return true;
  }

  if (sameTokenSet(predicted.givenTokens, expected.givenTokens)) {
    return true;
  }

  const sharedOrderedInitials = predicted.initials.filter(
    (initial, index) => expected.initials[index] === initial,
  );
  if (sharedOrderedInitials.length > 0) {
    return true;
  }

  return sameTokenSet(predicted.initials, expected.initials);
}

function hasExplicitAuthorCondensation(values: string[]): boolean {
  return values.some((value) => /…|\bet al\.?\b/iu.test(value));
}

function compareCondensedAuthors(
  predictedAuthors: ParsedAuthorIdentity[],
  expectedAuthors: ParsedAuthorIdentity[],
): boolean {
  if (
    predictedAuthors.length === 0
    || expectedAuthors.length <= predictedAuthors.length
  ) {
    return false;
  }

  const firstPredicted = predictedAuthors[0];
  const firstExpected = expectedAuthors[0];
  if (!firstPredicted || !firstExpected || !authorsAreCompatible(firstPredicted, firstExpected)) {
    return false;
  }

  let expectedIndex = 0;
  let matched = 0;
  for (const predictedAuthor of predictedAuthors) {
    let found = false;
    while (expectedIndex < expectedAuthors.length) {
      const expectedAuthor = expectedAuthors[expectedIndex];
      expectedIndex += 1;
      if (!expectedAuthor) {
        continue;
      }
      if (authorsAreCompatible(predictedAuthor, expectedAuthor)) {
        matched += 1;
        found = true;
        break;
      }
    }

    if (!found) {
      return false;
    }
  }

  return matched === predictedAuthors.length;
}

function compareContainerField(
  predicted: unknown,
  expected: unknown,
  tier: BenchmarkTier,
): boolean {
  if (compareByTier(predicted, expected, tier)) {
    return true;
  }

  const predictedText = stringifyComparable(predicted);
  const expectedText = stringifyComparable(expected);
  if (!predictedText || !expectedText) {
    return false;
  }

  return acronymsAreCompatible(predictedText, expectedText);
}

function buildAlternateFamilyCandidates(
  family: string,
  givenTokens: string[],
): string[] {
  const candidates = new Set<string>();
  const familyParts = family.split(" ").filter(Boolean);
  if (familyParts.length >= 2) {
    candidates.add(familyParts[familyParts.length - 1] ?? family);

    const strippedFamily = stripLeadingAuthorParticles(familyParts);
    if (strippedFamily.length > 0 && strippedFamily.join(" ") !== family) {
      candidates.add(strippedFamily.join(" "));
    }
  }

  const trailingParticleStart = findTrailingGivenParticleStart(givenTokens);
  if (trailingParticleStart >= 0) {
    const familySuffix = givenTokens.slice(trailingParticleStart).join(" ").trim();
    if (familySuffix) {
      candidates.add(`${familySuffix} ${family}`.trim());
      const strippedFamily = stripLeadingAuthorParticles(familyParts).join(" ").trim();
      if (strippedFamily && strippedFamily !== family) {
        candidates.add(`${familySuffix} ${strippedFamily}`.trim());
      }
    }
  }

  return [...candidates].filter(Boolean);
}

function sameTokenSet(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const leftSorted = [...left].sort().join(" ");
  const rightSorted = [...right].sort().join(" ");
  return leftSorted === rightSorted;
}

function stripLeadingAuthorParticles(parts: string[]): string[] {
  let index = 0;
  while (index < parts.length - 1 && AUTHOR_PARTICLE_TOKENS.has(parts[index] ?? "")) {
    index += 1;
  }
  return parts.slice(index);
}

function findTrailingGivenParticleStart(tokens: string[]): number {
  if (tokens.length === 0) {
    return -1;
  }

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index] ?? "";
    if (!AUTHOR_PARTICLE_TOKENS.has(token)) {
      continue;
    }

    const trailing = tokens.slice(index + 1);
    const trailingLooksLikeFamilyTail = trailing.length === 0
      || (
        trailing.length <= 3
        && trailing.every((entry) => entry.length > 1)
      );
    if (trailingLooksLikeFamilyTail) {
      return index;
    }
  }

  return -1;
}

function acronymsAreCompatible(left: string, right: string): boolean {
  const normalizedLeft = normalizeCompactText(left);
  const normalizedRight = normalizeCompactText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  const leftAcronyms = deriveContainerAcronyms(left);
  const rightAcronyms = deriveContainerAcronyms(right);
  return (
    leftAcronyms.some((acronym) => acronym === normalizedRight)
    || rightAcronyms.some((acronym) => acronym === normalizedLeft)
    || leftAcronyms.some((acronym) => rightAcronyms.includes(acronym))
  );
}

function deriveContainerAcronyms(value: string): string[] {
  const acronyms = new Set<string>();
  const normalized = normalizeStrictText(value);
  if (!normalized) {
    return [];
  }

  const parenthetical = [...normalized.matchAll(/\(([A-Z][A-Z0-9&./-]{2,18})\)/gu)]
    .map((match) => normalizeCompactText(match[1] ?? ""))
    .filter((entry) => entry.length >= 3);
  for (const entry of parenthetical) {
    acronyms.add(entry);
  }

  const tokens = normalized
    .replace(/[“”„‟«»]/gu, " ")
    .replace(/[‘’‚‛]/gu, " ")
    .split(/[^\p{L}\p{N}&./-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length > 0) {
    const derived = tokens
      .filter((token) => !CONTAINER_ACRONYM_STOP_WORDS.has(token.toLowerCase()))
      .map((token) => token[0] ?? "")
      .join("")
      .toUpperCase();
    if (derived.length >= 3) {
      acronyms.add(normalizeCompactText(derived));
    }

    const alreadyCompact = tokens.every((token) => token.length <= 10);
    if (alreadyCompact) {
      const compact = tokens
        .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase())
        .join("");
      if (compact.length >= 3) {
        acronyms.add(normalizeCompactText(compact));
      }
    }
  }

  return [...acronyms];
}

function normalizeCompactText(value: string): string {
  return value.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const CONTAINER_ACRONYM_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "de",
  "del",
  "der",
  "des",
  "di",
  "do",
  "for",
  "in",
  "la",
  "le",
  "of",
  "on",
  "the",
  "to",
  "und",
  "with",
]);

function tokenizeText(value: unknown): string[] {
  return normalizeSoftText(stringifyComparable(value)).split(" ").filter(Boolean);
}

function tokenJaccard(left: unknown, right: unknown): number {
  const leftSet = new Set(tokenizeText(left));
  const rightSet = new Set(tokenizeText(right));
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  const overlap = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return overlap / union;
}

function stringifyComparable(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyComparable(entry)).join(" ");
  }
  if (value == null) return "";
  return String(value);
}

function hasComparableValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((entry) => hasComparableValue(entry));
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function normalizedLevenshtein(left: string, right: string): number {
  const a = normalizeSoftText(left);
  const b = normalizeSoftText(right);
  if (!a && !b) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length, 1);
}

function normalizedEditDistance(left: string, right: string): number {
  const distance = levenshteinDistance(left, right);
  return distance / Math.max(left.length, right.length, 1);
}

function levenshteinDistance(left: string, right: string): number {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  );
  for (let index = 0; index <= left.length; index += 1) matrix[index]![0] = index;
  for (let index = 0; index <= right.length; index += 1) matrix[0]![index] = index;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  return matrix[left.length]![right.length]!;
}

function ratcliffObershelp(left: string, right: string): number {
  const a = normalizeSoftText(left);
  const b = normalizeSoftText(right);
  if (!a && !b) return 1;
  const matches = matchingCharacters(a, b);
  return (2 * matches) / Math.max(a.length + b.length, 1);
}

function matchingCharacters(left: string, right: string): number {
  const { length, leftIndex, rightIndex } = longestCommonSubstring(left, right);
  if (length === 0) return 0;
  return (
    length
    + matchingCharacters(left.slice(0, leftIndex), right.slice(0, rightIndex))
    + matchingCharacters(
      left.slice(leftIndex + length),
      right.slice(rightIndex + length),
    )
  );
}

function longestCommonSubstring(left: string, right: string): {
  length: number;
  leftIndex: number;
  rightIndex: number;
} {
  let bestLength = 0;
  let bestLeft = 0;
  let bestRight = 0;
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  );

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] !== right[j - 1]) continue;
      matrix[i]![j] = matrix[i - 1]![j - 1]! + 1;
      if (matrix[i]![j]! > bestLength) {
        bestLength = matrix[i]![j]!;
        bestLeft = i - bestLength;
        bestRight = j - bestLength;
      }
    }
  }

  return { length: bestLength, leftIndex: bestLeft, rightIndex: bestRight };
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}
