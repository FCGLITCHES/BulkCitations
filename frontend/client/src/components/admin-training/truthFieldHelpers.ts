import {
  EXPECTED_FIELD_DEFINITION_BY_KEY,
  EXPECTED_FIELD_DEFINITIONS,
  EXPECTED_OUTPUT_FIELD_KEY,
  REQUIRED_EXPECTED_FIELDS_BY_TYPE,
  STYLE_PAIR_BY_STYLE,
} from "./constants";
import type {
  ApprovedTruthEditorDraftPayload,
  ApprovedTruthRow,
  TruthFieldValue,
} from "./types";

export function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function parseScalarValue(raw: string): string | number | boolean | null {
  const trimmed = normalizeWhitespace(raw);
  if (!trimmed) return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function toExpectedFieldValueString(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return normalizeWhitespace(item);
        }
        if (typeof item === "number" || typeof item === "boolean") {
          return String(item);
        }
        return "";
      })
      .filter(Boolean)
      .join(" | ");
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function buildBlankExpectedFieldValues(): Record<string, string> {
  return Object.fromEntries(EXPECTED_FIELD_DEFINITIONS.map((field) => [field.key, ""]));
}

export function expectedFieldsToFormValues(fields: Record<string, unknown>): Record<string, string> {
  return {
    ...buildBlankExpectedFieldValues(),
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, toExpectedFieldValueString(value)]),
    ),
  };
}

export function parseExpectedFieldFormValues(values: Record<string, string>): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.includes("|")) {
      const list = trimmed
        .split("|")
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
        .map((item) => parseScalarValue(item));
      if (list.length > 0) {
        parsed[key] = list;
      }
      continue;
    }
    parsed[key] = parseScalarValue(value);
  }
  return parsed;
}

export function normalizeFlatFieldValue(value: unknown): TruthFieldValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return typeof value === "string" ? normalizeWhitespace(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (
        item === null
        || typeof item === "string"
        || typeof item === "number"
        || typeof item === "boolean"
      ) {
        return typeof item === "string" ? normalizeWhitespace(item) : item;
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const literal = typeof record.literal === "string" ? normalizeWhitespace(record.literal) : "";
        if (literal) return literal;
        const family = typeof record.family === "string" ? normalizeWhitespace(record.family) : "";
        const given = typeof record.given === "string" ? normalizeWhitespace(record.given) : "";
        if (family && given) return `${family}, ${given}`;
        if (family) return family;
      }

      throw new Error("Expected fields must stay flat in training export v1.");
    });
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) {
      return normalizeFlatFieldValue(record.value);
    }
  }

  throw new Error("Expected fields must stay flat in training export v1.");
}

export function normalizeFlatExpectedFields(input: Record<string, unknown>): Record<string, TruthFieldValue> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, normalizeFlatFieldValue(value)]),
  );
}

export function toExpectedFieldsPreviewFromValues(values: Record<string, string>): string {
  try {
    return JSON.stringify(normalizeFlatExpectedFields(parseExpectedFieldFormValues(values)), null, 2);
  } catch {
    return "{}";
  }
}

export function buildCanonicalTruthFields(values: Record<string, string>): Record<string, TruthFieldValue> {
  return normalizeFlatExpectedFields(parseExpectedFieldFormValues(values));
}

export function expectedFieldKeysForRender(values: Record<string, string>): string[] {
  const baseKeys = EXPECTED_FIELD_DEFINITIONS
    .map((field) => field.key)
    .filter((key) => key !== EXPECTED_OUTPUT_FIELD_KEY);
  const extraKeys = Object.keys(values).filter(
    (key) => !EXPECTED_FIELD_DEFINITION_BY_KEY[key] && key !== EXPECTED_OUTPUT_FIELD_KEY,
  );
  return [...baseKeys, ...extraKeys];
}

export function missingRequiredExpectedFields(
  expectedType: string,
  values: Record<string, string>,
): string[] {
  const required = REQUIRED_EXPECTED_FIELDS_BY_TYPE[expectedType] ?? [];
  return required.filter((key) => !normalizeWhitespace(values[key] ?? ""));
}

export function buildBlankApprovedTruthEditorDraftPayload(): ApprovedTruthEditorDraftPayload {
  return {
    mode: "create",
    editingId: null,
    rawText: "",
    expectedFieldValues: buildBlankExpectedFieldValues(),
    engineRenderedOutput: "",
    enginePreviewWarnings: [],
    enginePreviewStale: false,
    expectedOutputDirty: false,
    expectedType: "",
    expectedStyle: "",
    provenance: "",
    pipelineMajor: "",
    datasetSplit: "",
    trustLevel: "draft",
    rowStatus: "draft",
    blockedReason: "",
    goldKind: "",
    adversarialPair: "",
    noiseProfile: "",
    approvalSource: "",
    reviewedBy: "",
    auditReasonCode: "manual_correction",
    notes: "",
  };
}

export function approvedTruthEditorDraftHasContent(payload: ApprovedTruthEditorDraftPayload): boolean {
  if (payload.mode === "edit") {
    return true;
  }

  if (
    normalizeWhitespace(payload.rawText).length > 0
    || normalizeWhitespace(payload.engineRenderedOutput).length > 0
    || normalizeWhitespace(payload.expectedType).length > 0
    || normalizeWhitespace(payload.expectedStyle).length > 0
    || normalizeWhitespace(payload.provenance).length > 0
    || normalizeWhitespace(payload.pipelineMajor).length > 0
    || payload.datasetSplit.length > 0
    || payload.trustLevel !== "draft"
    || payload.rowStatus !== "draft"
    || payload.blockedReason.length > 0
    || payload.goldKind.length > 0
    || normalizeWhitespace(payload.adversarialPair).length > 0
    || normalizeWhitespace(payload.noiseProfile).length > 0
    || payload.approvalSource.length > 0
    || normalizeWhitespace(payload.reviewedBy).length > 0
    || payload.auditReasonCode.length > 0
    || normalizeWhitespace(payload.notes).length > 0
    || payload.enginePreviewWarnings.length > 0
    || payload.enginePreviewStale
    || payload.expectedOutputDirty
  ) {
    return true;
  }

  return Object.values(payload.expectedFieldValues).some((value) => normalizeWhitespace(value).length > 0);
}

export function parseNoiseProfile(raw: string): string[] | null {
  const items = raw
    .split(",")
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

export function inferAdversarialPair(expectedStyle: string): string | null {
  return STYLE_PAIR_BY_STYLE[expectedStyle.trim().toLowerCase()] ?? null;
}

export function detectNoiseProfileFromRawText(rawText: string): string[] {
  const text = rawText.trim();
  if (!text) return [];
  const tags = new Set<string>();
  if (/\s{2,}|\t/u.test(text) || /\n{2,}/u.test(text)) {
    tags.add("spacing_damage");
  }
  if (/-\s*\n/u.test(text)) {
    tags.add("pdf_copy_artifact");
  }
  if (/[“”‘’]|[;:,.]{2,}/u.test(text)) {
    tags.add("punctuation_drift");
  }
  if (/[|¦�]/u.test(text) || /\b[0O][A-Za-z]{3,}\b/u.test(text)) {
    tags.add("ocr_like");
  }
  return [...tags];
}

export function formatNoiseProfile(value: string[] | null | undefined): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

export function stableStringifyVariantValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringifyVariantValue(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringifyVariantValue(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildRenderVariantInputFingerprint(input: {
  expectedType: string;
  expectedFieldValues: Record<string, string>;
}): string {
  return stableStringifyVariantValue({
    expectedType: normalizeWhitespace(input.expectedType) || null,
    canonicalTruth: buildCanonicalTruthFields(input.expectedFieldValues),
  });
}

export function savedTruthFieldsForRow(row: ApprovedTruthRow): Record<string, unknown> {
  return row.expectedFields ?? row.coreTruth ?? {};
}

export function truthRowNeedsAutomaticEnginePrefill(row: ApprovedTruthRow): boolean {
  const savedFields = savedTruthFieldsForRow(row);
  const meaningfulFieldCount = Object.keys(savedFields).filter(
    (key) => key !== EXPECTED_OUTPUT_FIELD_KEY,
  ).length;
  return meaningfulFieldCount === 0 && normalizeWhitespace(row.expectedType ?? "").length === 0;
}

export function truthRowIsSparse(row: ApprovedTruthRow): boolean {
  const expectedCount = Object.keys(row.expectedFields ?? {}).length;
  const coreCount = Object.keys(row.coreTruth ?? {}).length;
  return expectedCount <= 1 && coreCount <= 1;
}

export function truthRowHasEngineSeed(row: ApprovedTruthRow): boolean {
  return !truthRowIsSparse(row);
}
