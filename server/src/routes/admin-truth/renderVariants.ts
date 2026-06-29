import { randomUUID } from "node:crypto";

import type { StoredApprovedTruthRenderVariant } from "../../runtime/persistence.js";
import { phase12Render } from "../../engine/phases/phase12Render.js";
import type { StoredApprovedTruth, TruthRenderVariantStyle } from "../../runtime/store.js";
import { effectiveRowStatus } from "../../training/truthCertification.js";
import { approvedTruthRenderVariantStyleValues } from "./schemas.js";

export type TruthRenderPreviewResult = {
  renderedText: string;
  expectedType: string | null;
  expectedStyle: string | null;
  warningCodes: string[];
  fieldCount: number;
};

export function listTruthRenderVariantStyles(
  styles?: readonly TruthRenderVariantStyle[],
): TruthRenderVariantStyle[] {
  const requested = styles?.length ? styles : approvedTruthRenderVariantStyleValues;
  return approvedTruthRenderVariantStyleValues.filter((style) => requested.includes(style));
}

export function buildTruthRenderVariantRendererVersion(
  pipelineMajor?: number | null,
  phase12ContractVersion: string | number = phase12Render.contractVersion,
) {
  return `pipeline-${pipelineMajor ?? 3}-phase12-${phase12ContractVersion}`;
}

export async function buildGeneratedTruthRenderVariant(input: {
  row: StoredApprovedTruth;
  style: TruthRenderVariantStyle;
  existing?: StoredApprovedTruthRenderVariant | null;
  phase12ContractVersion?: string | number;
  renderPreview: (payload: {
    rawText: string;
    expectedFields: Record<string, unknown>;
    expectedType: string | null;
    expectedStyle: TruthRenderVariantStyle;
  }) => Promise<TruthRenderPreviewResult>;
}): Promise<StoredApprovedTruthRenderVariant> {
  const preview = await input.renderPreview({
    rawText: input.row.rawText,
    expectedFields: input.row.expectedFields,
    expectedType: input.row.expectedType ?? null,
    expectedStyle: input.style,
  });
  const now = new Date().toISOString();
  const rendererVersion = buildTruthRenderVariantRendererVersion(
    input.row.pipelineMajor ?? null,
    input.phase12ContractVersion ?? phase12Render.contractVersion,
  );
  const existing = input.existing ?? null;
  const preserveAdminAuthored = existing?.sourceKind === "admin_authored";

  return {
    id: existing?.id ?? randomUUID(),
    truthRowId: input.row.id,
    style: input.style,
    generatedText: preview.renderedText,
    renderedText: preserveAdminAuthored ? existing.renderedText : preview.renderedText,
    sourceKind: preserveAdminAuthored ? existing.sourceKind : "generated",
    approvalStatus: preserveAdminAuthored ? existing.approvalStatus : "draft",
    qualityTier: existing?.qualityTier ?? "gold",
    datasetLane: existing?.datasetLane ?? "augmentation",
    rendererVersion,
    stale: preserveAdminAuthored ? existing.stale : false,
    generatedAt: now,
    approvedAt: preserveAdminAuthored ? existing.approvedAt ?? null : null,
    approvedBy: preserveAdminAuthored ? existing.approvedBy ?? null : null,
    notes: existing?.notes ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function exportRenderVariantRow(
  row: StoredApprovedTruth,
  variant: StoredApprovedTruthRenderVariant,
): Record<string, unknown> {
  return {
    truth_row_id: row.id,
    raw_text: row.rawText,
    expected_fields: row.coreTruth ?? row.expectedFields,
    expected_type: row.expectedType ?? undefined,
    input_style_label: row.expectedStyle ?? undefined,
    render_style: variant.style,
    rendered_text: variant.renderedText,
    generated_text: variant.generatedText,
    source_kind: variant.sourceKind,
    approval_status: variant.approvalStatus,
    quality_tier: variant.qualityTier,
    dataset_lane: variant.datasetLane,
    renderer_version: variant.rendererVersion,
    stale: variant.stale,
    generated_at: variant.generatedAt,
    approved_at: variant.approvedAt ?? undefined,
    approved_by: variant.approvedBy ?? undefined,
    notes: variant.notes ?? undefined,
    input_hash: row.inputHash,
    dataset_split: row.datasetSplit ?? undefined,
    row_status: effectiveRowStatus(row),
    blocked_reason: row.blockedReason ?? undefined,
    dataset_version: row.datasetVersion ?? undefined,
    holdout_version: row.holdoutVersion ?? undefined,
    work_id: row.workId ?? undefined,
    family_id: row.familyId ?? undefined,
    variant_id: row.variantId ?? undefined,
    canonical_work_key: row.canonicalWorkKey ?? undefined,
    near_dup_cluster_id: row.nearDupClusterId ?? undefined,
    provenance: row.provenance ?? undefined,
  };
}
