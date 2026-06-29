import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  resolveRepositoryRoot,
} from '../runtime/artifactPaths.js';
import type {
  StoredApprovedTruth,
  TruthScope,
  TruthTask,
} from '../runtime/store.js';
import {
  effectiveRowStatus,
  isTaskCertified,
  withLegacyCertification,
} from './truthCertification.js';

export const TRAINING_PACK_TARGETS = [
  'style_core_gold',
  'approved_overlay_changes',
  'citation_bio_supervision',
  'authority_pack',
  'render_variant_augmentation',
  'regression_fixtures',
] as const;

export type TrainingPackTarget = (typeof TRAINING_PACK_TARGETS)[number];

export interface StagedTrainingPackManifest {
  packTarget: TrainingPackTarget;
  stagedBundleId: string;
  outputPath: string;
  manifestPath: string;
  rowCount: number;
  createdAt: string;
  sha256: string;
}

export function defaultTrainingPackTargetForCertification(input: {
  task: TruthTask;
  truthScope: TruthScope;
}): TrainingPackTarget {
  if (input.task === 'overlay_learning' || input.truthScope === 'overlay') {
    return 'approved_overlay_changes';
  }
  if (input.task === 'authority_pack') {
    return 'authority_pack';
  }
  if (input.task === 'field') {
    return 'citation_bio_supervision';
  }
  return 'style_core_gold';
}

export function certificationMatchesPackTarget(input: {
  row: StoredApprovedTruth;
  packTarget: TrainingPackTarget;
}): boolean {
  const row = withLegacyCertification(input.row);
  if (effectiveRowStatus(row) === 'quarantined') {
    return false;
  }

  switch (input.packTarget) {
    case 'approved_overlay_changes':
      return isTaskCertified(row, 'overlay_learning', 'overlay')
        || isTaskCertified(row, 'field', 'overlay')
        || isTaskCertified(row, 'style', 'overlay')
        || isTaskCertified(row, 'authority_pack', 'overlay');
    case 'authority_pack':
      return isTaskCertified(row, 'authority_pack', 'core')
        || isTaskCertified(row, 'authority_pack', 'overlay');
    case 'citation_bio_supervision':
      return isTaskCertified(row, 'field', 'core')
        || isTaskCertified(row, 'field', 'overlay');
    case 'render_variant_augmentation':
      return isTaskCertified(row, 'style', 'core')
        || isTaskCertified(row, 'style', 'overlay');
    case 'regression_fixtures':
      return isTaskCertified(row, 'field', 'core')
        || isTaskCertified(row, 'overlay_learning', 'overlay');
    case 'style_core_gold':
    default:
      return isTaskCertified(row, 'style', 'core');
  }
}

function resolveStagedTrainingPackRoot(): string {
  return process.env.BULKREFERENCES_STAGED_TRAINING_PACK_ROOT?.trim()
    || resolve(resolveRepositoryRoot(), 'datasets', 'engine-v2', 'staged-builds');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

function packRow(row: StoredApprovedTruth, packTarget: TrainingPackTarget): Record<string, unknown> {
  const base = {
    truth_row_id: row.id,
    input_hash: row.inputHash,
    raw_text: row.rawText,
    expected_type: row.expectedType ?? null,
    expected_style: row.expectedStyle ?? null,
    dataset_split: row.datasetSplit ?? null,
    dataset_version: row.datasetVersion ?? null,
    gold_kind: row.goldKind ?? null,
    task_certifications: row.taskCertifications ?? [],
  };

  if (packTarget === 'approved_overlay_changes') {
    return {
      ...base,
      pack_target: packTarget,
      overlay_truth: row.overlayTruth ?? row.expectedFields,
      corrected_output:
        row.overlayTruth?.corrected_output
        ?? row.expectedFields.corrected_output
        ?? row.expectedFields.formatted_string
        ?? null,
    };
  }

  if (packTarget === 'authority_pack') {
    return {
      ...base,
      pack_target: packTarget,
      doi: row.expectedFields.doi ?? row.coreTruth?.doi ?? null,
      journal: row.expectedFields.journal ?? row.coreTruth?.journal ?? null,
      issn: row.expectedFields.issn ?? row.coreTruth?.issn ?? null,
      canonical_fields: row.coreTruth ?? row.expectedFields,
    };
  }

  return {
    ...base,
    pack_target: packTarget,
    expected_fields: packTarget === 'citation_bio_supervision'
      ? row.coreTruth ?? row.expectedFields
      : row.expectedFields,
    core_truth: row.coreTruth ?? row.expectedFields,
    overlay_truth: row.overlayTruth ?? null,
  };
}

export async function writeStagedTrainingPack(input: {
  packTarget: TrainingPackTarget;
  rows: StoredApprovedTruth[];
  now?: Date;
}): Promise<StagedTrainingPackManifest> {
  const createdAt = (input.now ?? new Date()).toISOString();
  const stagedBundleId = `${input.packTarget}-${createdAt.replace(/[:.]/g, '-').replace(/Z$/, 'Z')}`;
  const outputDir = resolve(resolveStagedTrainingPackRoot(), input.packTarget);
  const outputPath = resolve(outputDir, `${stagedBundleId}.jsonl`);
  const manifestPath = resolve(outputDir, `${stagedBundleId}.manifest.json`);
  const eligibleRows = input.rows
    .filter((row) => certificationMatchesPackTarget({ row, packTarget: input.packTarget }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const body = eligibleRows
    .map((row) => JSON.stringify(packRow(row, input.packTarget)))
    .join('\n');
  const content = body ? `${body}\n` : '';
  const sha256 = createHash('sha256').update(content).digest('hex');
  const manifest: StagedTrainingPackManifest = {
    packTarget: input.packTarget,
    stagedBundleId,
    outputPath,
    manifestPath,
    rowCount: eligibleRows.length,
    createdAt,
    sha256,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  await writeFile(manifestPath, `${stableStringify(manifest)}\n`, 'utf8');
  return manifest;
}
