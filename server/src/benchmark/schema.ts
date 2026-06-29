import { z } from "zod";

import {
  BENCHMARK_INPUT_SOURCE_KINDS,
  BENCHMARK_ARTIFACT_DETAILS,
  BENCHMARK_HARDWARE_PROFILES,
  BENCHMARK_CITATION_FIELD_GROUPS,
  BENCHMARK_INPUT_PROFILES,
  BENCHMARK_INPUT_STRUCTURES,
  BENCHMARK_MODES,
  BENCHMARK_NOISE_TYPES,
  BENCHMARK_PARSE_OUTCOMES,
  BENCHMARK_REFERENCE_TYPES,
  BENCHMARK_RUN_PROFILES,
  BENCHMARK_SLICE_PRESETS,
  BENCHMARK_STYLE_FAMILIES,
  BENCHMARK_STYLE_SCOPES,
  BENCHMARK_STYLES,
  BENCHMARK_TIERS,
  BENCHMARK_VARIANTS,
  type BenchmarkEvaluationResult,
  type BenchmarkManifestRow,
  type BenchmarkMode,
  type BenchmarkPredictionRow,
  type BenchmarkRuntimeMetrics,
} from "./types.js";
import { ENGINE_PARSE_PROFILES } from "../engine/types/parseProfile.js";

const truthScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const truthFieldValueSchema = z.union([truthScalarSchema, z.array(truthScalarSchema)]);

export const benchmarkManifestRowSchema = z.object({
  record_id: z.string().min(1),
  variant_id: z.string().min(1),
  variant_kind: z.enum(["clean", "noisy"]),
  reference_type: z.enum(BENCHMARK_REFERENCE_TYPES),
  citation_style: z.enum(BENCHMARK_STYLES),
  formatted_string: z.string().min(1),
  formatted_hash: z.string().min(1),
  noise_applied: z.array(z.enum(BENCHMARK_NOISE_TYPES)),
  source: z.string().min(1),
  source_url: z.string().min(1),
  source_hash: z.string().min(1),
  language: z.string().min(1),
  input_structure: z.enum(BENCHMARK_INPUT_STRUCTURES),
  input_source_kind: z.enum(BENCHMARK_INPUT_SOURCE_KINDS),
  expected_fields: z.record(z.string(), truthFieldValueSchema),
  required_fields: z.array(z.string().min(1)),
  style_scope: z.enum(BENCHMARK_STYLE_SCOPES).optional(),
  corrected_output: z.string().min(1).optional(),
});

export const benchmarkManifestSchema = z.array(benchmarkManifestRowSchema);

export const benchmarkPredictionRowSchema = z.object({
  record_id: z.string().min(1),
  variant_id: z.string().min(1),
  citation_style: z.enum(BENCHMARK_STYLES),
  reference_type: z.string().min(1),
  formatted_hash: z.string().min(1),
  fields: z.record(z.string(), truthFieldValueSchema),
  raw_fields: z.record(z.string(), truthFieldValueSchema).optional(),
  adapter_stripped_fields: z.array(z.string()).optional(),
  venue: truthFieldValueSchema.optional(),
  detected_style: z.string().optional(),
  detected_style_family: z.enum(BENCHMARK_STYLE_FAMILIES).optional(),
  detected_type: z.string().optional(),
  parse_outcome: z.enum(BENCHMARK_PARSE_OUTCOMES).optional(),
  public_status: z.string().optional(),
  status: z.string().optional(),
  abstained_fields: z.array(z.string()).optional(),
  health_reason_codes: z.array(z.string()).optional(),
  missing_mandatory_fields: z.array(z.string()).optional(),
  invalid_mandatory_fields: z.array(z.string()).optional(),
  low_confidence_mandatory_fields: z.array(z.string()).optional(),
  field_move_ledger: z.array(
    z.object({
      phaseId: z.string().min(1),
      reasonCode: z.string().min(1),
      sourceField: z.string().min(1),
      destinationField: z.string().min(1),
      action: z.enum(["set", "clear", "mutate", "restore"]),
      previousValue: z.unknown(),
      nextValue: z.unknown(),
      beforeConfidence: z.number().min(0).max(1).nullable(),
      afterConfidence: z.number().min(0).max(1).nullable(),
    }),
  ).optional(),
  rendered_text: z.string().optional(),
  output_latency_ms: z.number().finite().nonnegative(),
  duration_ms: z.number().finite().nonnegative(),
  warnings: z.array(z.string()),
});

export const benchmarkPredictionsSchema = z.array(benchmarkPredictionRowSchema);

export const benchmarkRuntimeMetricsSchema = z.object({
  measurement_basis: z.literal("wall_clock"),
  wall_clock_ms: z.number().finite().nonnegative(),
  prediction_count: z.number().int().nonnegative(),
  throughput_refs_per_sec: z.number().finite().nonnegative(),
  cpu_user_ms: z.number().finite().nonnegative(),
  cpu_system_ms: z.number().finite().nonnegative(),
  provider_call_count: z.number().int().nonnegative(),
  stage_totals_ms: z.record(z.string(), z.number().finite().nonnegative()),
  worker_stats: z.array(
    z.object({
      worker_index: z.number().int().nonnegative(),
      prediction_count: z.number().int().nonnegative(),
      group_count: z.number().int().nonnegative(),
      wall_clock_ms: z.number().finite().nonnegative(),
      throughput_refs_per_sec: z.number().finite().nonnegative(),
      cpu_user_ms: z.number().finite().nonnegative(),
      cpu_system_ms: z.number().finite().nonnegative(),
      provider_call_count: z.number().int().nonnegative(),
    }),
  ),
  slow_chunks: z.array(
    z.object({
      chunk_index: z.number().int().nonnegative(),
      worker_index: z.number().int().nonnegative().optional(),
      row_count: z.number().int().positive(),
      wall_clock_ms: z.number().finite().nonnegative(),
      throughput_refs_per_sec: z.number().finite().nonnegative(),
      record_ids: z.array(z.string().min(1)),
    }),
  ),
  slow_rows: z.array(
    z.object({
      variant_id: z.string().min(1),
      record_id: z.string().min(1),
      duration_ms: z.number().finite().nonnegative(),
      output_latency_ms: z.number().finite().nonnegative(),
      reference_type: z.string().min(1),
    }),
  ),
  gc_stats: z.object({
    total_collections: z.number().int().nonnegative(),
    total_duration_ms: z.number().finite().nonnegative(),
    max_pause_ms: z.number().finite().nonnegative(),
  }),
  memory_stats: z.object({
    rss_start_bytes: z.number().int().nonnegative(),
    rss_end_bytes: z.number().int().nonnegative(),
    rss_peak_bytes: z.number().int().nonnegative(),
    heap_used_start_bytes: z.number().int().nonnegative(),
    heap_used_end_bytes: z.number().int().nonnegative(),
    heap_used_peak_bytes: z.number().int().nonnegative(),
  }),
  throughput_decay: z.object({
    sample_count: z.number().int().nonnegative(),
    initial_refs_per_sec: z.number().finite().nonnegative().nullable(),
    final_refs_per_sec: z.number().finite().nonnegative().nullable(),
    decline_ratio: z.number().finite().min(0).max(1).nullable(),
  }),
  worker_imbalance: z.object({
    worker_count: z.number().int().nonnegative(),
    prediction_count_ratio: z.number().finite().positive().nullable(),
    wall_clock_ratio: z.number().finite().positive().nullable(),
    throughput_ratio: z.number().finite().positive().nullable(),
  }),
});

const benchmarkFieldScoreSchema = z.object({
  tp: z.number().int().nonnegative(),
  fp: z.number().int().nonnegative(),
  fn: z.number().int().nonnegative(),
  precision: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  f1: z.number().min(0).max(1),
});

const benchmarkTierSummarySchema = z.object({
  fields: z.record(z.string(), benchmarkFieldScoreSchema),
  macro_field_f1: z.number().min(0).max(1),
  instance: benchmarkFieldScoreSchema,
  total_rows: z.number().int().nonnegative(),
});

const benchmarkToplineMetricsSchema = z.object({
  normalized_citation_exact_match_rate: z.number().min(0).max(1),
  normalized_citation_exact_match_compared: z.number().int().nonnegative(),
  required_field_completeness: z.number().min(0).max(1),
  false_fill_rate: z.number().min(0).max(1),
  accepted_without_edit_rate: z.number().min(0).max(1),
  mean_normalized_edit_distance: z.number().min(0).max(1),
  mean_normalized_edit_distance_compared: z.number().int().nonnegative(),
  unsupported_false_commit_rate: z.number().min(0).max(1),
  unsupported_false_commit_compared: z.number().int().nonnegative(),
  abstain_precision: z.number().min(0).max(1),
  abstain_precision_compared: z.number().int().nonnegative(),
  abstain_coverage: z.number().min(0).max(1),
  abstain_coverage_required: z.number().int().nonnegative(),
});

const benchmarkCitationFieldExactnessSchema = z.object({
  group: z.enum(BENCHMARK_CITATION_FIELD_GROUPS),
  exact_match_rate: z.number().min(0).max(1),
  compared: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  raw_false_positive_repair_rate: z.number().min(0).max(1),
  raw_false_positive_compared: z.number().int().nonnegative(),
  raw_false_positive_repaired: z.number().int().nonnegative(),
});

const benchmarkPartitionSummarySchema = z.object({
  partition: z.enum(["clean", "noisy", "combined"]),
  by_tier: z.record(z.enum(BENCHMARK_TIERS), benchmarkTierSummarySchema),
  topline: benchmarkToplineMetricsSchema.default({
    normalized_citation_exact_match_rate: 0,
    normalized_citation_exact_match_compared: 0,
    required_field_completeness: 0,
    false_fill_rate: 0,
    accepted_without_edit_rate: 0,
    mean_normalized_edit_distance: 0,
    mean_normalized_edit_distance_compared: 0,
    unsupported_false_commit_rate: 0,
    unsupported_false_commit_compared: 0,
    abstain_precision: 1,
    abstain_precision_compared: 0,
    abstain_coverage: 1,
    abstain_coverage_required: 0,
  }),
  citation_field_exactness: z.array(benchmarkCitationFieldExactnessSchema).default([]),
  field_contract: z.array(
    z.object({
      field: z.string().min(1),
      expected_rows: z.number().int().nonnegative(),
      predicted_non_empty_rows: z.number().int().nonnegative(),
      coverage: z.number().min(0).max(1),
      exact_f1: z.number().min(0).max(1),
      canonical_f1: z.number().min(0).max(1),
      exact_precision_non_abstained: z.number().min(0).max(1),
      canonical_precision_non_abstained: z.number().min(0).max(1),
    }),
  ),
  cell_soft_instance_f1: z.array(
    z.object({
      citation_style: z.enum(BENCHMARK_STYLES),
      reference_type: z.enum(BENCHMARK_REFERENCE_TYPES),
      compared: z.number().int().nonnegative(),
      f1: z.number().min(0).max(1),
      below_threshold: z.boolean(),
    }),
  ),
  by_input_profile: z.array(
    z.object({
      input_profile: z.enum(BENCHMARK_INPUT_PROFILES),
      compared: z.number().int().nonnegative(),
      soft_instance_f1: z.number().min(0).max(1),
      high_confidence_parse_rate: z.number().min(0).max(1),
      partial_parse_with_abstentions_rate: z.number().min(0).max(1),
      needs_action_rate: z.number().min(0).max(1),
      abstain_rate: z.number().min(0).max(1),
      required_field_completeness: z.number().min(0).max(1).default(0),
      false_fill_rate: z.number().min(0).max(1).default(0),
      accepted_without_edit_rate: z.number().min(0).max(1).default(0),
      normalized_citation_exact_match_rate: z.number().min(0).max(1).default(0),
    }),
  ),
  by_style: z.array(
    z.object({
      citation_style: z.enum(BENCHMARK_STYLES),
      compared: z.number().int().nonnegative(),
      soft_instance_f1: z.number().min(0).max(1),
    }),
  ),
  by_type: z.array(
    z.object({
      reference_type: z.enum(BENCHMARK_REFERENCE_TYPES),
      compared: z.number().int().nonnegative(),
      soft_instance_f1: z.number().min(0).max(1),
    }),
  ),
  by_noise_type: z.array(
    z.object({
      noise_type: z.enum(BENCHMARK_NOISE_TYPES),
      compared: z.number().int().nonnegative(),
      soft_instance_f1: z.number().min(0).max(1),
    }),
  ),
  move_level_repairs: z.array(
    z.object({
      phase_id: z.string().min(1),
      reason_code: z.string().min(1),
      total_repairs: z.number().int().nonnegative(),
      successful_repairs: z.number().int().nonnegative(),
      precision: z.number().min(0).max(1),
    }),
  ),
  type_accuracy: z.object({
    correct: z.number().int().nonnegative(),
    compared: z.number().int().nonnegative(),
    accuracy: z.number().min(0).max(1),
  }),
  style_accuracy: z.object({
    correct: z.number().int().nonnegative(),
    compared: z.number().int().nonnegative(),
    accuracy: z.number().min(0).max(1),
  }),
  style_family_accuracy: z.object({
    correct: z.number().int().nonnegative(),
    compared: z.number().int().nonnegative(),
    accuracy: z.number().min(0).max(1),
  }).default({
    correct: 0,
    compared: 0,
    accuracy: 0,
  }),
  adversarial_pair_accuracy: z.array(
    z.object({
      pair_name: z.string().min(1),
      styles: z.tuple([z.enum(BENCHMARK_STYLES), z.enum(BENCHMARK_STYLES)]),
      correct: z.number().int().nonnegative(),
      compared: z.number().int().nonnegative(),
      accuracy: z.number().min(0).max(1),
    }),
  ).default([]),
  type_confusions: z.array(
    z.object({
      expected_type: z.enum(BENCHMARK_REFERENCE_TYPES),
      detected_type: z.string().min(1),
      count: z.number().int().nonnegative(),
    }),
  ),
  style_confusions: z.array(
    z.object({
      expected_style: z.enum(BENCHMARK_STYLES),
      detected_style: z.string().min(1),
      count: z.number().int().nonnegative(),
    }),
  ),
  throughput_refs_per_sec: z.number().nonnegative(),
  missing_prediction_count: z.number().int().nonnegative(),
  missing_expected_field_count: z.number().int().nonnegative(),
  unsupported_predicted_field_count: z.number().int().nonnegative(),
});

const benchmarkContractSanitySchema = z.object({
  failures: z.array(z.string()),
  warnings: z.array(z.string()),
  field_coverage: z.array(
    z.object({
      field: z.string().min(1),
      expected_rows: z.number().int().nonnegative(),
      predicted_non_empty_rows: z.number().int().nonnegative(),
      coverage: z.number().min(0).max(1),
      hard_failure: z.boolean(),
      warning: z.boolean(),
    }),
  ),
  samples: z.array(
    z.object({
      variant_id: z.string().min(1),
      required_fields: z.array(z.string().min(1)),
      expected_keys: z.array(z.string().min(1)),
      predicted_keys: z.array(z.string().min(1)),
      missing_required_fields: z.array(z.string().min(1)),
    }),
  ),
});

export const benchmarkEvaluationSchema = z.object({
  generated_at: z.string().min(1),
  mode: z.enum(BENCHMARK_MODES),
  profile: z.enum(BENCHMARK_RUN_PROFILES).default("heuristic-only"),
  artifact_detail: z.enum(BENCHMARK_ARTIFACT_DETAILS).optional(),
  parse_profile: z.enum(ENGINE_PARSE_PROFILES).optional(),
  source_type: z.enum(["text", "doi_list"]).optional(),
  hardware_profile: z.enum(BENCHMARK_HARDWARE_PROFILES).optional(),
  benchmark_variant: z.enum(BENCHMARK_VARIANTS).optional(),
  artifact_namespace: z.string().min(1).optional(),
  slice_preset: z.enum(BENCHMARK_SLICE_PRESETS).optional(),
  semantic_output_hash: z.string().min(1).optional(),
  field_hash: z.string().min(1).optional(),
  contract_hash: z.string().min(1).optional(),
  slice_start: z.number().int().positive().optional(),
  slice_end: z.number().int().positive().optional(),
  slice_row_count: z.number().int().positive().optional(),
  scoring_spec_version: z.string().min(1),
  thresholds: z.object({
    clean_macro_soft_f1_floor: z.number().min(0).max(1),
    clean_instance_soft_f1_floor: z.number().min(0).max(1),
    per_cell_soft_f1_floor: z.number().min(0).max(1),
    target_macro_soft_f1: z.number().min(0).max(1),
    normalized_citation_exact_match_floor: z.number().min(0).max(1).default(0),
    required_field_completeness_floor: z.number().min(0).max(1).default(0),
    false_fill_rate_ceiling: z.number().min(0).max(1).default(1),
    accepted_without_edit_rate_floor: z.number().min(0).max(1).default(0),
    mean_normalized_edit_distance_ceiling: z.number().min(0).max(1).default(1),
    unsupported_false_commit_rate_ceiling: z.number().min(0).max(1).default(1),
    abstain_precision_floor: z.number().min(0).max(1).default(0),
    abstain_coverage_floor: z.number().min(0).max(1).default(0),
    citation_field_exact_match_floor: z.object({
      author: z.number().min(0).max(1).default(0),
      title: z.number().min(0).max(1).default(0),
      year: z.number().min(0).max(1).default(0),
      source: z.number().min(0).max(1).default(0),
      link: z.number().min(0).max(1).default(0),
    }).default({
      author: 0,
      title: 0,
      year: 0,
      source: 0,
      link: 0,
    }),
    citation_field_hard_gate_groups: z.array(z.enum(BENCHMARK_CITATION_FIELD_GROUPS)).default(["year", "link"]),
    citation_field_warning_groups: z.array(z.enum(BENCHMARK_CITATION_FIELD_GROUPS)).default([
      "author",
      "title",
      "source",
    ]),
    citation_field_hard_gate_min_compared: z.number().int().nonnegative().default(20),
    citation_field_warning_min_compared: z.number().int().nonnegative().default(40),
    citation_field_raw_false_positive_repair_rate_floor: z.number().min(0).max(1).default(0),
    citation_field_raw_false_positive_repair_min_compared: z.number().int().nonnegative().default(20),
  }),
  contract_sanity: benchmarkContractSanitySchema,
  partitions: z.array(benchmarkPartitionSummarySchema),
  target_status: z.enum(["pass", "below_target"]),
  runtime_metrics: benchmarkRuntimeMetricsSchema.optional(),
});

export function validateBenchmarkManifest(
  value: unknown,
  mode: BenchmarkMode,
): BenchmarkManifestRow[] {
  const parsed = benchmarkManifestSchema.parse(value, {
    errorMap: (_issue, ctx) => ({
      message: `Invalid ${mode} benchmark manifest: ${ctx.defaultError}`,
    }),
  });
  return parsed.map((row) => {
    const normalized: BenchmarkManifestRow = {
      record_id: row.record_id,
      variant_id: row.variant_id,
      variant_kind: row.variant_kind,
      reference_type: row.reference_type,
      citation_style: row.citation_style,
      formatted_string: row.formatted_string,
      formatted_hash: row.formatted_hash,
      noise_applied: row.noise_applied,
      source: row.source,
      source_url: row.source_url,
      source_hash: row.source_hash,
      language: row.language,
      input_structure: row.input_structure,
      input_source_kind: row.input_source_kind,
      expected_fields: row.expected_fields,
      required_fields: row.required_fields,
    };
    if (row.style_scope !== undefined) normalized.style_scope = row.style_scope;
    if (row.corrected_output !== undefined) normalized.corrected_output = row.corrected_output;
    return normalized;
  });
}

export function validateBenchmarkPredictions(
  value: unknown,
  mode: BenchmarkMode,
): BenchmarkPredictionRow[] {
  const parsed = benchmarkPredictionsSchema.parse(value, {
    errorMap: (_issue, ctx) => ({
      message: `Invalid ${mode} benchmark predictions: ${ctx.defaultError}`,
    }),
  });
  return parsed.map((row) => {
    const normalized: BenchmarkPredictionRow = {
      record_id: row.record_id,
      variant_id: row.variant_id,
      citation_style: row.citation_style,
      reference_type: row.reference_type,
      formatted_hash: row.formatted_hash,
      fields: row.fields,
      output_latency_ms: row.output_latency_ms,
      duration_ms: row.duration_ms,
      warnings: row.warnings,
    };
    if (row.raw_fields !== undefined) normalized.raw_fields = row.raw_fields;
    if (row.adapter_stripped_fields !== undefined) {
      normalized.adapter_stripped_fields = row.adapter_stripped_fields;
    }
    if (row.venue !== undefined) normalized.venue = row.venue;
    if (row.detected_style !== undefined) normalized.detected_style = row.detected_style;
    if (row.detected_style_family !== undefined) {
      normalized.detected_style_family = row.detected_style_family;
    }
    if (row.detected_type !== undefined) normalized.detected_type = row.detected_type;
    if (row.parse_outcome !== undefined) normalized.parse_outcome = row.parse_outcome;
    if (row.public_status !== undefined) normalized.public_status = row.public_status;
    if (row.status !== undefined) normalized.status = row.status;
    if (row.abstained_fields !== undefined) normalized.abstained_fields = row.abstained_fields;
    if (row.health_reason_codes !== undefined) {
      normalized.health_reason_codes = row.health_reason_codes;
    }
    if (row.missing_mandatory_fields !== undefined) {
      normalized.missing_mandatory_fields = row.missing_mandatory_fields;
    }
    if (row.invalid_mandatory_fields !== undefined) {
      normalized.invalid_mandatory_fields = row.invalid_mandatory_fields;
    }
    if (row.low_confidence_mandatory_fields !== undefined) {
      normalized.low_confidence_mandatory_fields = row.low_confidence_mandatory_fields;
    }
    if (row.field_move_ledger !== undefined) {
      normalized.field_move_ledger = row.field_move_ledger.map((entry) => ({
        phaseId: entry.phaseId,
        reasonCode: entry.reasonCode,
        sourceField: entry.sourceField,
        destinationField: entry.destinationField,
        action: entry.action,
        previousValue: entry.previousValue ?? null,
        nextValue: entry.nextValue ?? null,
        beforeConfidence: entry.beforeConfidence,
        afterConfidence: entry.afterConfidence,
      }));
    }
    if (row.rendered_text !== undefined) normalized.rendered_text = row.rendered_text;
    return normalized;
  });
}

export function validateBenchmarkEvaluation(
  value: unknown,
  mode: BenchmarkMode,
): BenchmarkEvaluationResult {
  return benchmarkEvaluationSchema.parse(value, {
    errorMap: (_issue, ctx) => ({
      message: `Invalid ${mode} benchmark evaluation result: ${ctx.defaultError}`,
    }),
  }) as BenchmarkEvaluationResult;
}

export function validateBenchmarkRuntimeMetrics(
  value: unknown,
): BenchmarkRuntimeMetrics {
  return benchmarkRuntimeMetricsSchema.parse(value) as BenchmarkRuntimeMetrics;
}
