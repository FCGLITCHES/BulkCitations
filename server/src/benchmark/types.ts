import type { ReferenceType } from "../engine/types/citation.js";
import type { TruthFieldValue } from "../training/truthFields.js";
import type { ParseProfile } from "../engine/types/parseProfile.js";
import type { ConvertRequest } from "../engine/types/api.js";

export const BENCHMARK_MODES = ["pilot", "full"] as const;
export type BenchmarkMode = (typeof BENCHMARK_MODES)[number];

export const BENCHMARK_REFERENCE_TYPES = [
  "article-journal",
  "conference-paper",
  "book",
  "book-chapter",
  "preprint",
  "thesis",
  "report",
  "patent",
  "webpage",
] as const satisfies readonly ReferenceType[];
export type BenchmarkReferenceType = (typeof BENCHMARK_REFERENCE_TYPES)[number];

export const BENCHMARK_STYLES = [
  "apa7",
  "harvard-ctr",
  "chicago-notes-bib",
  "vancouver",
  "ieee",
  "mla9",
] as const;
export type BenchmarkStyle = (typeof BENCHMARK_STYLES)[number];

export const BENCHMARK_STYLE_FAMILIES = [
  "author_date",
  "notes_bibliography",
  "numeric",
  "web_accessed",
  "unknown",
] as const;
export type BenchmarkStyleFamily = (typeof BENCHMARK_STYLE_FAMILIES)[number];

export const BENCHMARK_STYLE_SCOPES = [
  "supported_exact",
  "unsupported_exact",
  "family_only",
  "unknown_or_ood",
  "not_citation_like",
] as const;
export type BenchmarkStyleScope = (typeof BENCHMARK_STYLE_SCOPES)[number];

export const BENCHMARK_INPUT_STRUCTURES = [
  "structured",
  "unstructured",
] as const;
export type BenchmarkInputStructure = (typeof BENCHMARK_INPUT_STRUCTURES)[number];

export const BENCHMARK_INPUT_SOURCE_KINDS = [
  "csl_rendered",
  "raw_pasted",
  "pdf_copy",
  "numbered_block",
  "typed_manual",
] as const;
export type BenchmarkInputSourceKind = (typeof BENCHMARK_INPUT_SOURCE_KINDS)[number];

export const BENCHMARK_INPUT_PROFILES = [
  "doi_list",
  "structured_clean",
  "structured_noisy",
  "pasted_pdf_copy",
  "multiline_numbered",
  "ocr_like",
] as const;
export type BenchmarkInputProfile = (typeof BENCHMARK_INPUT_PROFILES)[number];

export const BENCHMARK_PARSE_OUTCOMES = [
  "high_confidence_parse",
  "partial_parse_with_abstentions",
  "needs_action",
] as const;
export type BenchmarkParseOutcome = (typeof BENCHMARK_PARSE_OUTCOMES)[number];

export const BENCHMARK_RUN_PROFILES = [
  "heuristic-only",
  "hybrid-ml",
  "current-runtime",
  "current-runtime-stable350",
  "site-faithful",
] as const;
export type BenchmarkRunProfile = (typeof BENCHMARK_RUN_PROFILES)[number];

export const BENCHMARK_HARDWARE_PROFILES = [
  "default",
  "dev_default",
  "benchmark_5600h",
  "server_16c",
] as const;
export type BenchmarkHardwareProfile = (typeof BENCHMARK_HARDWARE_PROFILES)[number];

export const BENCHMARK_VARIANTS = [
  "grobid_compare",
  "parallel",
  "diagnostic",
] as const;
export type BenchmarkVariant = (typeof BENCHMARK_VARIANTS)[number];

export const BENCHMARK_ARTIFACT_DETAILS = [
  "full",
  "summary",
] as const;
export type BenchmarkArtifactDetail = (typeof BENCHMARK_ARTIFACT_DETAILS)[number];

export interface BenchmarkRuntimeOverrides {
  chunkSize?: number;
  maxConcurrency?: number;
  warmupRefs?: number;
  multicoreThreshold?: number;
}

export interface BenchmarkGcStats {
  total_collections: number;
  total_duration_ms: number;
  max_pause_ms: number;
}

export interface BenchmarkMemoryStats {
  rss_start_bytes: number;
  rss_end_bytes: number;
  rss_peak_bytes: number;
  heap_used_start_bytes: number;
  heap_used_end_bytes: number;
  heap_used_peak_bytes: number;
}

export interface BenchmarkThroughputDecay {
  sample_count: number;
  initial_refs_per_sec: number | null;
  final_refs_per_sec: number | null;
  decline_ratio: number | null;
}

export interface BenchmarkWorkerStat {
  worker_index: number;
  prediction_count: number;
  group_count: number;
  wall_clock_ms: number;
  throughput_refs_per_sec: number;
  cpu_user_ms: number;
  cpu_system_ms: number;
  provider_call_count: number;
}

export interface BenchmarkWorkerImbalance {
  worker_count: number;
  prediction_count_ratio: number | null;
  wall_clock_ratio: number | null;
  throughput_ratio: number | null;
}

export interface BenchmarkSlowChunk {
  chunk_index: number;
  worker_index?: number;
  row_count: number;
  wall_clock_ms: number;
  throughput_refs_per_sec: number;
  record_ids: string[];
}

export interface BenchmarkSlowRow {
  variant_id: string;
  record_id: string;
  duration_ms: number;
  output_latency_ms: number;
  reference_type: string;
}

export interface BenchmarkRuntimeMetrics {
  measurement_basis: "wall_clock";
  wall_clock_ms: number;
  prediction_count: number;
  throughput_refs_per_sec: number;
  cpu_user_ms: number;
  cpu_system_ms: number;
  provider_call_count: number;
  stage_totals_ms: Record<string, number>;
  worker_stats: BenchmarkWorkerStat[];
  slow_chunks: BenchmarkSlowChunk[];
  slow_rows: BenchmarkSlowRow[];
  gc_stats: BenchmarkGcStats;
  memory_stats: BenchmarkMemoryStats;
  throughput_decay: BenchmarkThroughputDecay;
  worker_imbalance: BenchmarkWorkerImbalance;
}

export const BENCHMARK_SLICE_PRESETS = [
  "grobid_3500_citation_list",
  "pathological_3001_3400",
] as const;
export type BenchmarkSlicePreset = (typeof BENCHMARK_SLICE_PRESETS)[number];

export interface BenchmarkSliceRange {
  startRow: number;
  endRow: number;
}

export const BENCHMARK_ADVERSARIAL_STYLE_PAIRS = [
  {
    pair_name: "apa7_vs_harvard-ctr",
    styles: ["apa7", "harvard-ctr"] as const,
  },
  {
    pair_name: "mla9_vs_chicago-notes-bib",
    styles: ["mla9", "chicago-notes-bib"] as const,
  },
  {
    pair_name: "vancouver_vs_ieee",
    styles: ["vancouver", "ieee"] as const,
  },
] as const;

export type BenchmarkAdversarialStylePairName =
  (typeof BENCHMARK_ADVERSARIAL_STYLE_PAIRS)[number]["pair_name"];

export interface BenchmarkAccuracySummary {
  correct: number;
  compared: number;
  accuracy: number;
}

export interface BenchmarkAdversarialPairAccuracy {
  pair_name: BenchmarkAdversarialStylePairName;
  styles: readonly [BenchmarkStyle, BenchmarkStyle];
  correct: number;
  compared: number;
  accuracy: number;
}

export const BENCHMARK_TIERS = [
  "strict",
  "soft",
  "levenshtein",
  "ratcliff_obershelp",
] as const;
export type BenchmarkTier = (typeof BENCHMARK_TIERS)[number];

export const BENCHMARK_NOISE_TYPES = [
  "bare_identifier",
  "alternate_identifier_format",
  "odd_punctuation",
  "non_ascii",
  "style_specific_quirk",
  "fake_plausible_id",
] as const;
export type BenchmarkNoiseType = (typeof BENCHMARK_NOISE_TYPES)[number];

export interface BenchmarkBaseRecord {
  recordId: string;
  referenceType: BenchmarkReferenceType;
  source: string;
  sourceUrl: string;
  sourceHash: string;
  language: string;
  inputStructure: BenchmarkInputStructure;
  inputSourceKind: BenchmarkInputSourceKind;
  expectedFields: Record<string, TruthFieldValue>;
  cslItem: Record<string, unknown>;
}

export interface BenchmarkManifestRow {
  record_id: string;
  variant_id: string;
  variant_kind: "clean" | "noisy";
  reference_type: BenchmarkReferenceType;
  citation_style: BenchmarkStyle;
  formatted_string: string;
  formatted_hash: string;
  noise_applied: BenchmarkNoiseType[];
  source: string;
  source_url: string;
  source_hash: string;
  language: string;
  input_structure: BenchmarkInputStructure;
  input_source_kind: BenchmarkInputSourceKind;
  expected_fields: Record<string, TruthFieldValue>;
  required_fields: string[];
  style_scope?: BenchmarkStyleScope;
  corrected_output?: string;
}

export interface BenchmarkPredictionRow {
  record_id: string;
  variant_id: string;
  citation_style: BenchmarkStyle;
  reference_type: string;
  formatted_hash: string;
  fields: Record<string, TruthFieldValue>;
  raw_fields?: Record<string, TruthFieldValue>;
  adapter_stripped_fields?: string[];
  venue?: TruthFieldValue;
  detected_style?: string;
  detected_style_family?: string;
  detected_type?: string;
  parse_outcome?: BenchmarkParseOutcome;
  public_status?: string;
  status?: string;
  abstained_fields?: string[];
  health_reason_codes?: string[];
  missing_mandatory_fields?: string[];
  invalid_mandatory_fields?: string[];
  low_confidence_mandatory_fields?: string[];
  field_move_ledger?: Array<{
    phaseId: string;
    reasonCode: string;
    sourceField: string;
    destinationField: string;
    action: "set" | "clear" | "mutate" | "restore";
    previousValue: unknown;
    nextValue: unknown;
    beforeConfidence: number | null;
    afterConfidence: number | null;
  }>;
  rendered_text?: string;
  output_latency_ms: number;
  duration_ms: number;
  warnings: string[];
}

export interface BenchmarkFieldScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface BenchmarkTierSummary {
  fields: Record<string, BenchmarkFieldScore>;
  macro_field_f1: number;
  instance: BenchmarkFieldScore;
  total_rows: number;
}

export interface BenchmarkToplineMetrics {
  normalized_citation_exact_match_rate: number;
  normalized_citation_exact_match_compared: number;
  required_field_completeness: number;
  false_fill_rate: number;
  accepted_without_edit_rate: number;
  mean_normalized_edit_distance: number;
  mean_normalized_edit_distance_compared: number;
  unsupported_false_commit_rate: number;
  unsupported_false_commit_compared: number;
  abstain_precision: number;
  abstain_precision_compared: number;
  abstain_coverage: number;
  abstain_coverage_required: number;
}

export const BENCHMARK_CITATION_FIELD_GROUPS = [
  "author",
  "title",
  "year",
  "source",
  "link",
] as const;
export type BenchmarkCitationFieldGroup = (typeof BENCHMARK_CITATION_FIELD_GROUPS)[number];

export interface BenchmarkCitationFieldExactness {
  group: BenchmarkCitationFieldGroup;
  exact_match_rate: number;
  compared: number;
  correct: number;
  raw_false_positive_repair_rate: number;
  raw_false_positive_compared: number;
  raw_false_positive_repaired: number;
}

export interface BenchmarkPartitionSummary {
  partition: "clean" | "noisy" | "combined";
  by_tier: Record<BenchmarkTier, BenchmarkTierSummary>;
  topline: BenchmarkToplineMetrics;
  citation_field_exactness: BenchmarkCitationFieldExactness[];
  field_contract: Array<{
    field: string;
    expected_rows: number;
    predicted_non_empty_rows: number;
    coverage: number;
    exact_f1: number;
    canonical_f1: number;
    exact_precision_non_abstained: number;
    canonical_precision_non_abstained: number;
  }>;
  cell_soft_instance_f1: Array<{
    citation_style: BenchmarkStyle;
    reference_type: BenchmarkReferenceType;
    compared: number;
    f1: number;
    below_threshold: boolean;
  }>;
  by_input_profile: Array<{
    input_profile: BenchmarkInputProfile;
    compared: number;
    soft_instance_f1: number;
    high_confidence_parse_rate: number;
    partial_parse_with_abstentions_rate: number;
    needs_action_rate: number;
    abstain_rate: number;
    required_field_completeness: number;
    false_fill_rate: number;
    accepted_without_edit_rate: number;
    normalized_citation_exact_match_rate: number;
  }>;
  by_style: Array<{ citation_style: BenchmarkStyle; compared: number; soft_instance_f1: number }>;
  by_type: Array<{ reference_type: BenchmarkReferenceType; compared: number; soft_instance_f1: number }>;
  by_noise_type: Array<{ noise_type: BenchmarkNoiseType; compared: number; soft_instance_f1: number }>;
  move_level_repairs: Array<{
    phase_id: string;
    reason_code: string;
    total_repairs: number;
    successful_repairs: number;
    precision: number;
  }>;
  type_accuracy: BenchmarkAccuracySummary;
  style_accuracy: BenchmarkAccuracySummary;
  style_family_accuracy: BenchmarkAccuracySummary;
  adversarial_pair_accuracy: BenchmarkAdversarialPairAccuracy[];
  type_confusions: Array<{
    expected_type: BenchmarkReferenceType;
    detected_type: string;
    count: number;
  }>;
  style_confusions: Array<{
    expected_style: BenchmarkStyle;
    detected_style: string;
    count: number;
  }>;
  throughput_refs_per_sec: number;
  missing_prediction_count: number;
  missing_expected_field_count: number;
  unsupported_predicted_field_count: number;
}

export interface BenchmarkContractSanityFieldCoverage {
  field: string;
  expected_rows: number;
  predicted_non_empty_rows: number;
  coverage: number;
  hard_failure: boolean;
  warning: boolean;
}

export interface BenchmarkContractSanitySample {
  variant_id: string;
  required_fields: string[];
  expected_keys: string[];
  predicted_keys: string[];
  missing_required_fields: string[];
}

export interface BenchmarkContractSanity {
  failures: string[];
  warnings: string[];
  field_coverage: BenchmarkContractSanityFieldCoverage[];
  samples: BenchmarkContractSanitySample[];
}

export interface BenchmarkEvaluationResult {
  generated_at: string;
  mode: BenchmarkMode;
  profile: BenchmarkRunProfile;
  artifact_detail?: BenchmarkArtifactDetail;
  parse_profile?: ParseProfile;
  source_type?: ConvertRequest["sourceType"];
  hardware_profile?: BenchmarkHardwareProfile;
  benchmark_variant?: BenchmarkVariant;
  artifact_namespace?: string;
  slice_preset?: BenchmarkSlicePreset;
  semantic_output_hash?: string;
  field_hash?: string;
  contract_hash?: string;
  slice_start?: number;
  slice_end?: number;
  slice_row_count?: number;
  scoring_spec_version: string;
  thresholds: {
    clean_macro_soft_f1_floor: number;
    clean_instance_soft_f1_floor: number;
    per_cell_soft_f1_floor: number;
    target_macro_soft_f1: number;
    normalized_citation_exact_match_floor: number;
    required_field_completeness_floor: number;
    false_fill_rate_ceiling: number;
    accepted_without_edit_rate_floor: number;
    mean_normalized_edit_distance_ceiling: number;
    unsupported_false_commit_rate_ceiling: number;
    abstain_precision_floor: number;
    abstain_coverage_floor: number;
    citation_field_exact_match_floor: Record<BenchmarkCitationFieldGroup, number>;
    citation_field_hard_gate_groups: BenchmarkCitationFieldGroup[];
    citation_field_warning_groups: BenchmarkCitationFieldGroup[];
    citation_field_hard_gate_min_compared: number;
    citation_field_warning_min_compared: number;
    citation_field_raw_false_positive_repair_rate_floor: number;
    citation_field_raw_false_positive_repair_min_compared: number;
  };
  contract_sanity: BenchmarkContractSanity;
  partitions: BenchmarkPartitionSummary[];
  target_status: "pass" | "below_target";
  runtime_metrics?: BenchmarkRuntimeMetrics;
}

export function benchmarkStyleFamily(style: string | BenchmarkStyle): BenchmarkStyleFamily {
  switch (style) {
    case "apa7":
    case "harvard-ctr":
      return "author_date";
    case "chicago-notes-bib":
    case "mla9":
      return "notes_bibliography";
    case "vancouver":
    case "ieee":
      return "numeric";
    default:
      return "unknown";
  }
}
