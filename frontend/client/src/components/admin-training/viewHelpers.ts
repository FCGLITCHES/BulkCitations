import type {
  AllFilteredTruthSelection,
  ApprovedTruthRow,
  FrozenGoldDatasetManifest,
  TruthDriftSummary,
  TruthTrustLevel,
  TruthRowStatus,
} from "./types";
import { stripLeadingNumbering } from "@shared/stripNumbering";
import { APPROVED_TRUTH_PAGE_SIZE } from "./constants";
import {
  buildBlankExpectedFieldValues,
  expectedFieldsToFormValues,
  normalizeFlatExpectedFields,
  normalizeWhitespace,
} from "./truthFieldHelpers";

export function withLegacyOption(
  value: string,
  options: Array<{ value: string; label: string }>,
) {
  const normalizedValue = value.trim();
  if (!normalizedValue || options.some((option) => option.value === normalizedValue)) {
    return options;
  }
  return [...options, { value: normalizedValue, label: `${normalizedValue} (legacy)` }];
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function uniqueFrozenDatasetsByVersion(
  datasets: FrozenGoldDatasetManifest[],
): FrozenGoldDatasetManifest[] {
  const byVersion = new Map<string, FrozenGoldDatasetManifest>();
  for (const dataset of datasets) {
    const key = dataset.datasetVersion.trim();
    if (!key) continue;
    const existing = byVersion.get(key);
    if (!existing || dataset.createdAt > existing.createdAt) {
      byVersion.set(key, dataset);
    }
  }
  return [...byVersion.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function buildGovernanceSummary(input: {
  datasetSplit: string;
  trustLevel: TruthTrustLevel;
  rowStatus: TruthRowStatus;
  blockedReason: string;
  goldKind: string;
  approvalSource: string;
  adversarialPair: string;
  noiseProfile: string;
  reviewedBy: string;
}) {
  const labels: string[] = [];
  if (input.rowStatus && input.rowStatus !== "reviewed") {
    labels.push(input.rowStatus);
  }
  if (input.blockedReason) {
    labels.push(input.blockedReason);
  }
  if (input.datasetSplit) {
    labels.push(input.datasetSplit);
  }
  if (input.goldKind) {
    labels.push(input.goldKind);
  }
  if (input.approvalSource) {
    labels.push(input.approvalSource);
  }
  if (normalizeWhitespace(input.adversarialPair).length > 0) {
    labels.push("adversarial");
  }
  if (normalizeWhitespace(input.noiseProfile).length > 0) {
    labels.push("noisy");
  }
  if (normalizeWhitespace(input.reviewedBy).length > 0) {
    labels.push("reviewed");
  }
  if (input.trustLevel !== "reviewed") {
    labels.push(`trust:${input.trustLevel}`);
  }
  return labels.length > 0 ? labels.join(" • ") : "Optional dataset, governance, and audit metadata";
}

export function truthDriftSummary(row: ApprovedTruthRow): TruthDriftSummary | null {
  const drift = row.truthDrift ?? null;
  if (!drift || !drift.hasDrift || drift.mismatchCount <= 0) {
    return null;
  }
  return drift;
}

export function formatTruthDriftTooltip(drift: TruthDriftSummary | null): string {
  if (!drift) {
    return "No expected/core drift.";
  }
  const parts: string[] = [];
  if (drift.valueMismatches.length > 0) {
    parts.push(`Value mismatch: ${drift.valueMismatches.join(", ")}`);
  }
  if (drift.missingInCore.length > 0) {
    parts.push(`Missing in core: ${drift.missingInCore.join(", ")}`);
  }
  if (drift.extraInCore.length > 0) {
    parts.push(`Extra in core: ${drift.extraInCore.join(", ")}`);
  }
  return parts.join(" | ");
}

export function defaultExpectedFieldsFromQueue(td: Record<string, unknown>): Record<string, string> {
  const snap = td.engineSnapshot as { fieldsPredicted?: unknown } | undefined;
  if (snap?.fieldsPredicted && typeof snap.fieldsPredicted === "object" && snap.fieldsPredicted !== null) {
    try {
      return expectedFieldsToFormValues(
        normalizeFlatExpectedFields(snap.fieldsPredicted as Record<string, unknown>),
      );
    } catch {
      return buildBlankExpectedFieldValues();
    }
  }
  return buildBlankExpectedFieldValues();
}

export function rawInputFromQueue(td: Record<string, unknown>): string {
  const raw = td.rawInput;
  return typeof raw === "string" ? raw : "";
}

export function normalizedRawInputFromQueue(td: Record<string, unknown>): string {
  return stripLeadingNumbering(rawInputFromQueue(td));
}

export function buildAllFilteredTruthSelection(input: {
  availableTotalRows: number;
  availableTotalPages: number;
  pageStart?: number;
  pageEnd?: number;
  pageSize?: number;
}): AllFilteredTruthSelection {
  const availableTotalRows = Math.max(0, input.availableTotalRows);
  const pageSize = Math.max(1, input.pageSize ?? APPROVED_TRUTH_PAGE_SIZE);
  const availableTotalPages =
    input.availableTotalPages > 0
      ? input.availableTotalPages
      : availableTotalRows === 0
        ? 0
        : Math.ceil(availableTotalRows / pageSize);

  if (availableTotalPages === 0) {
    return {
      totalRows: 0,
      totalPages: 0,
      pageStart: 1,
      pageEnd: 1,
      availableTotalRows,
      availableTotalPages: 0,
      pageSize,
    };
  }

  const rawStart = input.pageStart ?? 1;
  const rawEnd = input.pageEnd ?? availableTotalPages;
  const pageStart = Math.min(Math.max(Math.min(rawStart, rawEnd), 1), availableTotalPages);
  const pageEnd = Math.min(Math.max(Math.max(rawStart, rawEnd), pageStart), availableTotalPages);
  const startIndex = (pageStart - 1) * pageSize;
  const endIndex = Math.min(availableTotalRows, pageEnd * pageSize);

  return {
    totalRows: Math.max(0, endIndex - startIndex),
    totalPages: pageEnd - pageStart + 1,
    pageStart,
    pageEnd,
    availableTotalRows,
    availableTotalPages,
    pageSize,
  };
}

export function formatAllFilteredTruthSelectionScope(selection: AllFilteredTruthSelection): string {
  if (selection.pageStart === selection.pageEnd) {
    return `page ${selection.pageStart} of ${selection.availableTotalPages}`;
  }
  return `pages ${selection.pageStart}-${selection.pageEnd} of ${selection.availableTotalPages}`;
}

export function buildAllFilteredTruthSelectionSummary(selection: AllFilteredTruthSelection): string {
  const pageLabel = selection.totalPages === 1 ? "page" : "pages";
  return `${selection.totalRows} rows selected across ${selection.totalPages} ${pageLabel} (${formatAllFilteredTruthSelectionScope(selection)})`;
}
