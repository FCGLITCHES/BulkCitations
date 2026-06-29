import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StoredApprovedTruth } from '../runtime/store.js';
import { resolveStyleGoldOutputPath } from '../runtime/artifactPaths.js';
import { effectiveRowStatus, isTaskCertified, withLegacyCertification } from './truthCertification.js';
import { SUPPORTED_STYLE_LABELS } from './styleGoldDatasetFreeze.js';

const ALLOWED_STYLE_GOLD_KINDS = new Set([
  'style_clean',
  'style_adversarial',
  'style_noisy',
  'overlay_accept',
]);

export interface StyleGoldExportSummary {
  outputPath: string;
  rowCount: number;
  styles: Record<string, number>;
  datasetVersion: string | null;
}

export interface StyleGoldExportFilters {
  datasetVersion?: string;
  includeHoldout?: boolean;
}

const SUPPORTED_STYLE_SET = new Set<string>(SUPPORTED_STYLE_LABELS);

export function filterStyleGoldRows(
  rows: StoredApprovedTruth[],
  filters?: StyleGoldExportFilters,
): StoredApprovedTruth[] {
  const includeHoldout = filters?.includeHoldout === true;
  const datasetVersion = filters?.datasetVersion?.trim() || null;

  return rows
    .map((row) => withLegacyCertification(row))
    .filter((row) =>
      effectiveRowStatus(row) !== 'quarantined'
      && isTaskCertified(row, 'style', 'core')
      && typeof row.expectedStyle === 'string'
      && row.expectedStyle.trim().length > 0
      && SUPPORTED_STYLE_SET.has(row.expectedStyle.trim())
      && (row.styleInferabilityTier === 'tier1_exact_direct' || row.styleInferabilityTier === 'tier2_exact_policy_resolved')
      && row.styleEvaluationSuite === 'supported_exact'
      && (!row.goldKind || ALLOWED_STYLE_GOLD_KINDS.has(row.goldKind))
      && (includeHoldout || row.datasetSplit !== 'holdout')
      && (!datasetVersion || row.datasetVersion === datasetVersion)
    );
}

export function toStyleGoldExportRow(row: StoredApprovedTruth): Record<string, unknown> {
  const coreTruth = row.coreTruth ?? row.expectedFields;
  return {
    raw_text: row.rawText,
    expected_fields: coreTruth,
    expected_type: row.expectedType ?? null,
    expected_style: row.expectedStyle ?? null,
    dataset_split: row.datasetSplit ?? null,
    trust_level: row.trustLevel,
    row_status: row.rowStatus ?? null,
    input_hash: row.inputHash,
    provenance: row.provenance ?? null,
    pipeline_major: row.pipelineMajor ?? null,
    gold_kind: row.goldKind ?? null,
    adversarial_pair: row.adversarialPair ?? null,
    noise_profile: row.noiseProfile ?? null,
    approval_source: row.approvalSource ?? null,
    work_id: row.workId ?? null,
    family_id: row.familyId ?? null,
    variant_id: row.variantId ?? null,
    dataset_version: row.datasetVersion ?? null,
    holdout_version: row.holdoutVersion ?? null,
  };
}

export async function writeStyleGoldExport(
  rows: StoredApprovedTruth[],
  outputPath = resolveStyleGoldOutputPath(),
  filters?: StyleGoldExportFilters,
): Promise<StyleGoldExportSummary> {
  const filtered = filterStyleGoldRows(rows, filters);
  const body = filtered.map((row) => JSON.stringify(toStyleGoldExportRow(row))).join('\n');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body.length > 0 ? `${body}\n` : '', 'utf8');

  const styles: Record<string, number> = {};
  for (const row of filtered) {
    const style = row.expectedStyle!;
    styles[style] = (styles[style] ?? 0) + 1;
  }

  return {
    outputPath,
    rowCount: filtered.length,
    styles,
    datasetVersion: filters?.datasetVersion?.trim() || null,
  };
}
