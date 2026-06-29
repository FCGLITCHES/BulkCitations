import { compareField } from "./evaluation.js";
import {
  canonicalizeBenchmarkFieldName,
  canonicalizeBenchmarkFieldList,
  flattenManifestFields,
  flattenPredictionFields,
  normalizeSoftText,
} from "./normalization.js";
import type {
  BenchmarkAdversarialPairAccuracy,
  BenchmarkContractSanityFieldCoverage,
  BenchmarkEvaluationResult,
  BenchmarkHardwareProfile,
  BenchmarkInputSourceKind,
  BenchmarkInputStructure,
  BenchmarkManifestRow,
  BenchmarkMode,
  BenchmarkPredictionRow,
  BenchmarkReferenceType,
  BenchmarkRunProfile,
  BenchmarkSlicePreset,
  BenchmarkStyle,
  BenchmarkTierSummary,
  BenchmarkVariant,
} from "./types.js";
import type { ParseProfile } from "../engine/types/parseProfile.js";
import type { ConvertRequest } from "../engine/types/api.js";

export type BenchmarkStructureClass = BenchmarkInputStructure;

const PRIORITY_FIELDS = [
  "authors",
  "title",
  "year",
  "journal/venue",
  "conferenceTitle",
  "bookTitle",
  "publisher",
  "institution",
  "doi",
  "url",
  "issn",
  "isbn",
  "patent",
  "siteName",
  "repository",
] as const;

export interface BenchmarkDebugSummary {
  generated_at: string;
  mode: BenchmarkMode;
  profile: BenchmarkRunProfile;
  parse_profile?: ParseProfile;
  source_type?: ConvertRequest["sourceType"];
  hardware_profile?: BenchmarkHardwareProfile;
  benchmark_variant?: BenchmarkVariant;
  slice_preset?: BenchmarkSlicePreset;
  semantic_output_hash?: string;
  slice_start?: number;
  slice_end?: number;
  slice_row_count?: number;
  clean_debug: {
    by_structure: Array<{
      structure_class: BenchmarkStructureClass;
      compared: number;
      soft_instance_f1: number;
      macro_soft_f1: number;
    }>;
    type_accuracy: {
      correct: number;
      compared: number;
      accuracy: number;
    };
    style_accuracy: {
      correct: number;
      compared: number;
      accuracy: number;
    };
    style_family_accuracy: {
      correct: number;
      compared: number;
      accuracy: number;
    };
    adversarial_pair_accuracy: BenchmarkAdversarialPairAccuracy[];
    adapter_coverage: BenchmarkContractSanityFieldCoverage[];
    contract_samples: Array<{
      variant_id: string;
      required_fields: string[];
      expected_keys: string[];
      predicted_keys: string[];
      missing_required_fields: string[];
    }>;
    priority_fields: Array<{
      field: string;
      soft_f1: number;
      tp: number;
      fp: number;
      fn: number;
      missing_expected: number;
      unsupported_predicted: number;
    }>;
    priority_cells: Array<{
      citation_style: BenchmarkStyle;
      reference_type: BenchmarkReferenceType;
      compared: number;
      soft_instance_f1: number;
    }>;
    style_mismatches: Array<{
      expected_style: BenchmarkStyle;
      detected_style: string;
      count: number;
    }>;
    style_failure_examples: Array<{
      expected_style: BenchmarkStyle;
      detected_style: string;
      examples: Array<{
        variant_id: string;
        reference_type: BenchmarkReferenceType;
        detected_type: string;
        formatted_string: string;
        warnings: string[];
      }>;
    }>;
    type_mismatches: Array<{
      expected_type: BenchmarkReferenceType;
      detected_type: string;
      count: number;
    }>;
    stripped_fields_by_type: Array<{
      detected_type: string;
      field: string;
      count: number;
    }>;
    field_failure_examples: Array<{
      field: string;
      examples: Array<{
        variant_id: string;
        citation_style: BenchmarkStyle;
        reference_type: BenchmarkReferenceType;
        detected_style: string;
        detected_type: string;
        formatted_string: string;
        expected_value: unknown;
        predicted_value: unknown;
        raw_predicted_value: unknown;
        reason_bucket: string;
        warnings: string[];
      }>;
    }>;
    sample_failures: Array<{
      variant_id: string;
      structure_class: BenchmarkStructureClass;
      input_source_kind: BenchmarkInputSourceKind;
      citation_style: BenchmarkStyle;
      reference_type: BenchmarkReferenceType;
      detected_style: string;
      detected_type: string;
      failed_required_fields: string[];
      formatted_string: string;
      expected_fields: Record<string, unknown>;
      predicted_fields: Record<string, unknown>;
      raw_predicted_fields: Record<string, unknown>;
      adapter_stripped_fields: string[];
      warnings: string[];
    }>;
  };
}

interface ScoredRow {
  row: BenchmarkManifestRow;
  prediction?: BenchmarkPredictionRow;
  structureClass: BenchmarkStructureClass;
  inputSourceKind: BenchmarkInputSourceKind;
  expectedFields: Record<string, unknown>;
  predictedFields: Record<string, unknown>;
  rawPredictedFields: Record<string, unknown>;
  requiredFields: string[];
  failedRequiredFields: string[];
}

export function classifyBenchmarkStructure(formatted: string): BenchmarkStructureClass {
  const normalized = normalizeSoftText(formatted);
  const hasYear = /\b(?:19|20)\d{2}\b/.test(formatted);
  const hasIdentifier =
    /\b(?:10\.\d{4,9}\/|doi|pmid|arxiv|isbn|issn|https?:\/\/|www\.)/i.test(formatted);
  const hasLocator =
    /\b(?:vol|volume|issue|no|pp|pages?)\b/i.test(formatted) || /\b\d+\s*[:;]\s*\d+(?:-\d+)?\b/.test(formatted);
  const hasCitationCadence =
    /[.;:]/.test(formatted) && /\b[A-Z][a-z]+/.test(formatted) && normalized.split(" ").length >= 6;

  const score = [hasYear, hasIdentifier || hasLocator, hasCitationCadence].filter(Boolean).length;
  return score >= 2 ? "structured" : "unstructured";
}

export function buildBenchmarkDebugSummary(
  manifest: BenchmarkManifestRow[],
  predictions: BenchmarkPredictionRow[],
  evaluation: BenchmarkEvaluationResult,
): BenchmarkDebugSummary {
  const predictionMap = new Map(predictions.map((prediction) => [prediction.variant_id, prediction] as const));
  const cleanRows = manifest
    .filter((row) => row.variant_kind === "clean")
    .map((row) => scoreRow(row, predictionMap.get(row.variant_id)));

  const missingExpectedCounts = new Map<string, number>();
  const unsupportedPredictedCounts = new Map<string, number>();
  const strippedFieldsByType = new Map<string, number>();

  for (const entry of cleanRows) {
    for (const [field, expected] of Object.entries(entry.expectedFields)) {
      if (expected == null) continue;
      if (!hasComparableValue(entry.predictedFields[field])) {
        missingExpectedCounts.set(field, (missingExpectedCounts.get(field) ?? 0) + 1);
      }
    }

    const detectedType = entry.prediction?.detected_type ?? entry.prediction?.reference_type ?? "missing";
    for (const field of entry.prediction?.adapter_stripped_fields ?? []) {
      unsupportedPredictedCounts.set(field, (unsupportedPredictedCounts.get(field) ?? 0) + 1);
      const key = `${detectedType}::${field}`;
      strippedFieldsByType.set(key, (strippedFieldsByType.get(key) ?? 0) + 1);
    }
  }

  const cleanPartition = evaluation.partitions.find((partition) => partition.partition === "clean");
  if (!cleanPartition) {
    throw new Error("Missing clean partition in benchmark evaluation.");
  }

  return {
    generated_at: evaluation.generated_at,
    mode: evaluation.mode,
    profile: evaluation.profile,
    ...(evaluation.parse_profile ? { parse_profile: evaluation.parse_profile } : {}),
    ...(evaluation.source_type ? { source_type: evaluation.source_type } : {}),
    ...(evaluation.hardware_profile ? { hardware_profile: evaluation.hardware_profile } : {}),
    ...(evaluation.benchmark_variant ? { benchmark_variant: evaluation.benchmark_variant } : {}),
    ...(evaluation.slice_preset ? { slice_preset: evaluation.slice_preset } : {}),
    ...(evaluation.semantic_output_hash ? { semantic_output_hash: evaluation.semantic_output_hash } : {}),
    ...(evaluation.slice_start != null ? { slice_start: evaluation.slice_start } : {}),
    ...(evaluation.slice_end != null ? { slice_end: evaluation.slice_end } : {}),
    ...(evaluation.slice_row_count != null ? { slice_row_count: evaluation.slice_row_count } : {}),
    clean_debug: {
      by_structure: buildStructureBreakdown(cleanRows),
      type_accuracy: cleanPartition.type_accuracy,
      style_accuracy: cleanPartition.style_accuracy,
      style_family_accuracy: cleanPartition.style_family_accuracy,
      adversarial_pair_accuracy: cleanPartition.adversarial_pair_accuracy,
      adapter_coverage: evaluation.contract_sanity.field_coverage,
      contract_samples: evaluation.contract_sanity.samples,
      priority_fields: buildPriorityFields(
        cleanPartition.by_tier.soft,
        missingExpectedCounts,
        unsupportedPredictedCounts,
      ),
      priority_cells: [...cleanPartition.cell_soft_instance_f1]
        .sort((left, right) => left.f1 - right.f1 || right.compared - left.compared)
        .slice(0, 12)
        .map((cell) => ({
          citation_style: cell.citation_style,
          reference_type: cell.reference_type,
          compared: cell.compared,
          soft_instance_f1: cell.f1,
        })),
      style_mismatches: cleanPartition.style_confusions.slice(0, 12),
      style_failure_examples: buildStyleFailureExamples(cleanRows, cleanPartition.style_confusions),
      type_mismatches: cleanPartition.type_confusions.slice(0, 12),
      stripped_fields_by_type: [...strippedFieldsByType.entries()]
        .map(([key, count]) => {
          const [detected_type, field] = key.split("::");
          return {
            detected_type: detected_type ?? "missing",
            field: field ?? "unknown",
            count,
          };
        })
        .sort((left, right) => right.count - left.count)
        .slice(0, 24),
      field_failure_examples: buildFieldFailureExamples(cleanRows),
      sample_failures: cleanRows
        .filter((entry) => entry.failedRequiredFields.length > 0)
        .sort(
          (left, right) =>
            right.failedRequiredFields.length - left.failedRequiredFields.length
            || left.row.variant_id.localeCompare(right.row.variant_id),
        )
        .slice(0, 20)
        .map((entry) => ({
          variant_id: entry.row.variant_id,
          structure_class: entry.structureClass,
          input_source_kind: entry.inputSourceKind,
          citation_style: entry.row.citation_style,
          reference_type: entry.row.reference_type,
          detected_style: entry.prediction?.detected_style ?? "missing",
          detected_type: entry.prediction?.detected_type ?? entry.prediction?.reference_type ?? "missing",
          failed_required_fields: entry.failedRequiredFields,
          formatted_string: entry.row.formatted_string,
          expected_fields: pickFields(entry.expectedFields, entry.requiredFields),
          predicted_fields: pickFields(entry.predictedFields, entry.requiredFields),
          raw_predicted_fields: pickFields(entry.rawPredictedFields, entry.requiredFields),
          adapter_stripped_fields: entry.prediction?.adapter_stripped_fields ?? [],
          warnings: entry.prediction?.warnings ?? [],
        })),
    },
  };
}

function buildStyleFailureExamples(
  rows: ScoredRow[],
  mismatches: Array<{
    expected_style: BenchmarkStyle;
    detected_style: string;
    count: number;
  }>,
): Array<{
  expected_style: BenchmarkStyle;
  detected_style: string;
  examples: Array<{
    variant_id: string;
    reference_type: BenchmarkReferenceType;
    detected_type: string;
    formatted_string: string;
    warnings: string[];
  }>;
}> {
  return mismatches.slice(0, 8).map((mismatch) => ({
    expected_style: mismatch.expected_style,
    detected_style: mismatch.detected_style,
    examples: rows
      .filter(
        (row) =>
          row.row.citation_style === mismatch.expected_style
          && (row.prediction?.detected_style ?? "missing") === mismatch.detected_style,
      )
      .slice(0, 4)
      .map((row) => ({
        variant_id: row.row.variant_id,
        reference_type: row.row.reference_type,
        detected_type: row.prediction?.detected_type ?? row.prediction?.reference_type ?? "missing",
        formatted_string: row.row.formatted_string,
        warnings: row.prediction?.warnings ?? [],
      })),
  }));
}

function scoreRow(
  row: BenchmarkManifestRow,
  prediction: BenchmarkPredictionRow | undefined,
): ScoredRow {
  const expectedFields = flattenManifestFields(row);
  const predictedFields = prediction ? flattenPredictionFields(prediction) : {};
  const rawPredictedFields = prediction?.raw_fields
    ? flattenRawBenchmarkFields(prediction.raw_fields, prediction.venue)
    : predictedFields;
  const requiredFields = canonicalizeBenchmarkFieldList(row.required_fields);
  const failedRequiredFields = requiredFields.filter(
    (field) => !compareField(field, predictedFields[field], expectedFields[field], "soft"),
  );
  const scored: ScoredRow = {
    row,
    structureClass: row.input_structure ?? classifyBenchmarkStructure(row.formatted_string),
    inputSourceKind: row.input_source_kind ?? "csl_rendered",
    expectedFields,
    predictedFields,
    rawPredictedFields,
    requiredFields,
    failedRequiredFields,
  };
  if (prediction) {
    scored.prediction = prediction;
  }
  return scored;
}

function buildStructureBreakdown(rows: ScoredRow[]): Array<{
  structure_class: BenchmarkStructureClass;
  compared: number;
  soft_instance_f1: number;
  macro_soft_f1: number;
}> {
  return (["structured", "unstructured"] as const).map((structureClass) => {
    const scoped = rows.filter((row) => row.structureClass === structureClass);
    const total = scoped.length;
    const successes = scoped.filter((row) => row.failedRequiredFields.length === 0).length;
    const softInstanceF1 = total > 0 ? round(successes / total, 4) : 0;

    const fieldScores = new Map<string, { tp: number; fp: number; fn: number }>();
    for (const row of scoped) {
      for (const [field, expected] of Object.entries(row.expectedFields)) {
        if (expected == null) continue;
        const matched = compareField(field, row.predictedFields[field], expected, "soft");
        const bucket = fieldScores.get(field) ?? { tp: 0, fp: 0, fn: 0 };
        if (matched) {
          bucket.tp += 1;
        } else if (row.predictedFields[field] != null) {
          bucket.fp += 1;
        } else {
          bucket.fn += 1;
        }
        fieldScores.set(field, bucket);
      }
    }

    const macroSoftF1 = fieldScores.size > 0
      ? round(
          [...fieldScores.values()]
            .map((score) => toF1(score.tp, score.fp, score.fn))
            .reduce((sum, score) => sum + score, 0) / fieldScores.size,
          4,
        )
      : 0;

    return {
      structure_class: structureClass,
      compared: total,
      soft_instance_f1: softInstanceF1,
      macro_soft_f1: macroSoftF1,
    };
  });
}

function buildPriorityFields(
  softTier: BenchmarkTierSummary,
  missingExpectedCounts: Map<string, number>,
  unsupportedPredictedCounts: Map<string, number>,
): Array<{
  field: string;
  soft_f1: number;
  tp: number;
  fp: number;
  fn: number;
  missing_expected: number;
  unsupported_predicted: number;
}> {
  return PRIORITY_FIELDS
    .map((field) => {
      const score = softTier.fields[field] ?? { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 };
      return {
        field,
        soft_f1: score.f1,
        tp: score.tp,
        fp: score.fp,
        fn: score.fn,
        missing_expected: missingExpectedCounts.get(field) ?? 0,
        unsupported_predicted: unsupportedPredictedCounts.get(field) ?? 0,
      };
    })
    .sort(
      (left, right) =>
        left.soft_f1 - right.soft_f1
        || right.missing_expected - left.missing_expected
        || right.unsupported_predicted - left.unsupported_predicted,
    );
}

function buildFieldFailureExamples(rows: ScoredRow[]): BenchmarkDebugSummary["clean_debug"]["field_failure_examples"] {
  return PRIORITY_FIELDS
    .map((field) => {
      const examples = rows
        .filter((entry) => hasComparableValue(entry.expectedFields[field]))
        .filter((entry) => !compareField(field, entry.predictedFields[field], entry.expectedFields[field], "soft"))
        .sort((left, right) => left.row.variant_id.localeCompare(right.row.variant_id))
        .slice(0, 5)
        .map((entry) => ({
          variant_id: entry.row.variant_id,
          citation_style: entry.row.citation_style,
          reference_type: entry.row.reference_type,
          detected_style: entry.prediction?.detected_style ?? "missing",
          detected_type: entry.prediction?.detected_type ?? entry.prediction?.reference_type ?? "missing",
          formatted_string: entry.row.formatted_string,
          expected_value: entry.expectedFields[field],
          predicted_value: entry.predictedFields[field],
          raw_predicted_value: entry.rawPredictedFields[field],
          reason_bucket: classifyFieldFailure(field, entry),
          warnings: entry.prediction?.warnings ?? [],
        }));
      return { field, examples };
    })
    .filter((entry) => entry.examples.length > 0);
}

function classifyFieldFailure(field: string, entry: ScoredRow): string {
  const predictedValue = entry.predictedFields[field];
  const rawPredictedValue = entry.rawPredictedFields[field];
  const detectedType = entry.prediction?.detected_type ?? entry.prediction?.reference_type ?? "missing";

  if (!hasComparableValue(predictedValue)) {
    if (detectedType !== entry.row.reference_type) {
      return "wrong_type_field";
    }
    if (["journal/venue", "conferenceTitle", "bookTitle", "publisher", "institution", "repository", "siteName"].includes(field)) {
      return "container_missing";
    }
    return "catastrophic_wrong_content";
  }

  if (field === "title") {
    const predictedText = stringifyComparable(predictedValue);
    const expectedText = stringifyComparable(entry.expectedFields[field]);
    if (/\b(?:10\.\d{4,9}\/|doi:|https?:\/\/)/i.test(predictedText)) {
      return "identifier_in_title";
    }
    if (normalizeSoftText(expectedText).startsWith(normalizeSoftText(predictedText))
      && normalizeSoftText(predictedText).length < normalizeSoftText(expectedText).length) {
      return "truncated_value";
    }
    return "catastrophic_wrong_content";
  }

  if (field === "authors") {
    if (detectedType !== entry.row.reference_type) {
      return "wrong_type_field";
    }
    if (looksLikeInitialsOnly(predictedValue, entry.expectedFields[field])) {
      return "author_initials_only";
    }
    return "author_wrong_span";
  }

  if (field === "year") {
    return classifyYearFailure(entry, rawPredictedValue ?? predictedValue);
  }

  if (detectedType !== entry.row.reference_type) {
    return "wrong_type_field";
  }

  return "catastrophic_wrong_content";
}

function classifyYearFailure(entry: ScoredRow, predictedValue: unknown): string {
  const predictedYear = String(predictedValue ?? "");
  const normalizedFormatted = normalizeSoftText(entry.row.formatted_string);
  if (predictedYear && entry.expectedFields.volume === predictedYear) {
    return "volume_or_issue_year_taken";
  }
  if (predictedYear && entry.expectedFields.issue === predictedYear) {
    return "volume_or_issue_year_taken";
  }
  if (predictedYear && /(accessed|retrieved|available at)/i.test(entry.row.formatted_string) && normalizedFormatted.includes(predictedYear)) {
    return "access_date_taken";
  }
  if (predictedYear && /\b(?:ed|edition)\b/i.test(entry.row.formatted_string)) {
    return "edition_year_taken";
  }
  return "publication_year_missed";
}

function looksLikeInitialsOnly(predicted: unknown, expected: unknown): boolean {
  const predictedText = stringifyComparable(predicted);
  const expectedText = stringifyComparable(expected);
  const predictedTokens = normalizeSoftText(predictedText).split(" ").filter(Boolean);
  const expectedTokens = normalizeSoftText(expectedText).split(" ").filter(Boolean);
  if (predictedTokens.length === 0 || expectedTokens.length === 0) return false;
  const predictedInitials = predictedTokens.filter((token) => token.length === 1);
  return predictedInitials.length > 0 && predictedTokens.length <= expectedTokens.length;
}

function pickFields(fields: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => key in fields)
      .map((key) => [key, fields[key]]),
  );
}

function flattenRawBenchmarkFields(
  rawFields: Record<string, unknown>,
  venue: unknown,
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(rawFields)) {
    if (!hasComparableValue(value)) continue;
    const canonicalField = canonicalizeBenchmarkFieldName(field);
    if (canonicalField === "journal/venue" && hasComparableValue(flattened["journal/venue"])) {
      continue;
    }
    flattened[canonicalField] = value;
  }
  if (!hasComparableValue(flattened["journal/venue"]) && hasComparableValue(venue)) {
    flattened["journal/venue"] = venue;
  }
  return flattened;
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

function toF1(tp: number, fp: number, fn: number): number {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}
