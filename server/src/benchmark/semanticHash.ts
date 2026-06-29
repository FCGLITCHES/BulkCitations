import { createHash } from "node:crypto";

import type { BenchmarkPredictionRow } from "./types.js";

interface BenchmarkSemanticOutputSummary {
  semanticOutputHash: string;
  fieldHash: string;
  contractHash: string;
}

export function computeBenchmarkSemanticOutputSummary(
  predictions: BenchmarkPredictionRow[],
): BenchmarkSemanticOutputSummary {
  const fieldRows: Array<Record<string, unknown> & { variant_id: string }> = predictions
    .map(toFieldHashRow)
    .sort((left, right) => left.variant_id.localeCompare(right.variant_id));
  const contractRows: Array<Record<string, unknown> & { variant_id: string }> = predictions
    .map(toContractHashRow)
    .sort((left, right) => left.variant_id.localeCompare(right.variant_id));
  const fieldHash = hashCanonicalRows(fieldRows);
  const contractHash = hashCanonicalRows(contractRows);

  return {
    semanticOutputHash: contractHash,
    fieldHash,
    contractHash,
  };
}

function toFieldHashRow(
  prediction: BenchmarkPredictionRow,
): Record<string, unknown> & { variant_id: string } {
  return {
    variant_id: prediction.variant_id,
    fields: canonicalizeJsonValue(prediction.fields),
  };
}

function toContractHashRow(
  prediction: BenchmarkPredictionRow,
): Record<string, unknown> & { variant_id: string } {
  const contractRow = {
    variant_id: prediction.variant_id,
    reference_type: prediction.reference_type,
    fields: prediction.fields,
    adapter_stripped_fields: prediction.adapter_stripped_fields,
    detected_style: prediction.detected_style,
    detected_style_family: prediction.detected_style_family,
    detected_type: prediction.detected_type,
    parse_outcome: prediction.parse_outcome,
    public_status: prediction.public_status,
    status: prediction.status,
    warnings: prediction.warnings,
    abstained_fields: prediction.abstained_fields,
    health_reason_codes: prediction.health_reason_codes,
    missing_mandatory_fields: prediction.missing_mandatory_fields,
    invalid_mandatory_fields: prediction.invalid_mandatory_fields,
    low_confidence_mandatory_fields: prediction.low_confidence_mandatory_fields,
  } satisfies Record<string, unknown> & { variant_id: string };

  return canonicalizeJsonValue(contractRow) as Record<string, unknown> & { variant_id: string };
}

function hashCanonicalRows(rows: Array<Record<string, unknown> & { variant_id: string }>): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJsonValue(entry)]),
    );
  }

  return value;
}
