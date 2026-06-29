import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StoredApprovedTruth } from '../runtime/store.js';
import { resolveGoldDatasetRoot } from '../runtime/artifactPaths.js';
import { effectiveRowStatus, isTaskCertified, withLegacyCertification } from './truthCertification.js';

export const SUPPORTED_STYLE_LABELS = [
  'apa7',
  'harvard-ctr',
  'chicago-notes-bib',
  'vancouver',
  'ieee',
  'mla9',
] as const;

export const REQUIRED_ADVERSARIAL_PAIRS = [
  'apa7_vs_harvard-ctr',
  'mla9_vs_chicago-notes-bib',
  'vancouver_vs_ieee',
] as const;

export const STYLE_CLEAN_TARGET_PER_STYLE = 1000;
export const STYLE_NOISY_TARGET_PER_STYLE = 200;
export const ADVERSARIAL_TARGET_PER_PAIR = 300;
export const FROZEN_STYLE_CORE_TOTAL = 8100;
export const ADVERSARIAL_DIRECTIONAL_TARGET = Math.floor(ADVERSARIAL_TARGET_PER_PAIR / 2);
export const MIN_ADVERSARIAL_TYPE_DIVERSITY = 2;
export const MIN_NOISE_TAG_DIVERSITY = 2;
export const MIN_STYLE_CLEAN_TYPE_DIVERSITY = 3;
export const MAX_SINGLE_SOURCE_SHARE = 0.9;

const SUPPORTED_STYLE_SET = new Set<string>(SUPPORTED_STYLE_LABELS);
const REQUIRED_PAIR_SET = new Set<string>(REQUIRED_ADVERSARIAL_PAIRS);
const STYLE_CORE_ALLOWED_KINDS = new Set(['style_clean', 'style_adversarial', 'style_noisy']);

export interface GoldDatasetFreezeOptions {
  datasetVersion: string;
  includeHoldout: boolean;
  enforceDiversityGates: boolean;
}

export interface GoldDatasetFreezeFailure {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface GoldDatasetFreezeCandidateSummary {
  styleClean: number;
  styleAdversarial: number;
  styleNoisy: number;
}

export interface GoldDatasetFreezeSelectionSummary {
  styleClean: number;
  styleAdversarial: number;
  styleNoisy: number;
  total: number;
  byStyle: Record<string, number>;
  byPair: Record<string, number>;
  byPairDirectional: Record<string, Record<string, number>>;
  byPairTypeDiversity: Record<string, number>;
  byStyleNoisyTagDiversity: Record<string, number>;
  bySource: Record<string, number>;
  byStyleCleanTypeDiversity: Record<string, number>;
}

export interface GoldDatasetFreezeResult {
  options: GoldDatasetFreezeOptions;
  selectedRows: StoredApprovedTruth[];
  candidateSummary: GoldDatasetFreezeCandidateSummary;
  selectionSummary: GoldDatasetFreezeSelectionSummary;
  failures: GoldDatasetFreezeFailure[];
  warnings: GoldDatasetFreezeFailure[];
}

export interface FrozenGoldDatasetManifest {
  datasetVersion: string;
  createdAt: string;
  includeHoldout: boolean;
  enforceDiversityGates: boolean;
  rowCount: number;
  rowIds: string[];
  inputHashes: string[];
  composition: GoldDatasetFreezeSelectionSummary;
  candidates: GoldDatasetFreezeCandidateSummary;
  manifestHash: string;
}

function isFrozenGoldDatasetManifest(value: unknown): value is FrozenGoldDatasetManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.datasetVersion !== 'string' || record.datasetVersion.trim().length === 0) {
    return false;
  }
  if (typeof record.createdAt !== 'string' || record.createdAt.trim().length === 0) {
    return false;
  }
  if (typeof record.manifestHash !== 'string' || record.manifestHash.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(record.rowIds) || !Array.isArray(record.inputHashes)) {
    return false;
  }
  return true;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

function manifestFilePath(datasetVersion: string): string {
  return resolve(resolveGoldDatasetRoot(), `${datasetVersion}.json`);
}

function parsePairStyles(pair: string): [string, string] | null {
  const parts = pair.split('_vs_').map((value) => value.trim()).filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }
  return [parts[0]!, parts[1]!];
}

function rowSort(left: StoredApprovedTruth, right: StoredApprovedTruth): number {
  const updatedCompare = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }
  return left.id.localeCompare(right.id);
}

function firstN(rows: StoredApprovedTruth[], amount: number): StoredApprovedTruth[] {
  if (rows.length <= amount) {
    return rows;
  }
  return rows.slice(0, amount);
}

function countRowsByStyle(rows: StoredApprovedTruth[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const style = row.expectedStyle?.trim();
    if (!style) {
      continue;
    }
    counts[style] = (counts[style] ?? 0) + 1;
  }
  return counts;
}

function countRowsByPair(rows: StoredApprovedTruth[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const pair = row.adversarialPair?.trim();
    if (!pair) {
      continue;
    }
    counts[pair] = (counts[pair] ?? 0) + 1;
  }
  return counts;
}

function countPairDirectional(rows: StoredApprovedTruth[]): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const pair = row.adversarialPair?.trim();
    const style = row.expectedStyle?.trim();
    if (!pair || !style) {
      continue;
    }
    if (!counts[pair]) {
      counts[pair] = {};
    }
    counts[pair]![style] = (counts[pair]![style] ?? 0) + 1;
  }
  return counts;
}

function countPairTypeDiversity(rows: StoredApprovedTruth[]): Record<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const row of rows) {
    const pair = row.adversarialPair?.trim();
    const expectedType = row.expectedType?.trim();
    if (!pair || !expectedType) {
      continue;
    }
    if (!sets.has(pair)) {
      sets.set(pair, new Set<string>());
    }
    sets.get(pair)!.add(expectedType);
  }
  const result: Record<string, number> = {};
  for (const [pair, values] of sets) {
    result[pair] = values.size;
  }
  return result;
}

function countNoisyTagDiversity(rows: StoredApprovedTruth[]): Record<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const row of rows) {
    const style = row.expectedStyle?.trim();
    if (!style) {
      continue;
    }
    if (!sets.has(style)) {
      sets.set(style, new Set<string>());
    }
    for (const tag of row.noiseProfile ?? []) {
      const normalized = String(tag).trim();
      if (normalized) {
        sets.get(style)!.add(normalized);
      }
    }
  }
  const result: Record<string, number> = {};
  for (const [style, values] of sets) {
    result[style] = values.size;
  }
  return result;
}

function countSourceDistribution(rows: StoredApprovedTruth[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const source = (row.approvalSource ?? row.provenance ?? 'unknown').trim().toLowerCase() || 'unknown';
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

function countStyleCleanTypeDiversity(rows: StoredApprovedTruth[]): Record<string, number> {
  const styleToTypes = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.goldKind !== 'style_clean') {
      continue;
    }
    const style = row.expectedStyle?.trim();
    if (!style) {
      continue;
    }
    if (!styleToTypes.has(style)) {
      styleToTypes.set(style, new Set<string>());
    }
    const expectedType = row.expectedType?.trim();
    if (expectedType) {
      styleToTypes.get(style)!.add(expectedType);
    }
  }
  const result: Record<string, number> = {};
  for (const [style, types] of styleToTypes) {
    result[style] = types.size;
  }
  return result;
}

function makeSelectionSummary(rows: StoredApprovedTruth[]): GoldDatasetFreezeSelectionSummary {
  const styleCleanRows = rows.filter((row) => row.goldKind === 'style_clean');
  const styleAdversarialRows = rows.filter((row) => row.goldKind === 'style_adversarial');
  const styleNoisyRows = rows.filter((row) => row.goldKind === 'style_noisy');

  return {
    styleClean: styleCleanRows.length,
    styleAdversarial: styleAdversarialRows.length,
    styleNoisy: styleNoisyRows.length,
    total: rows.length,
    byStyle: countRowsByStyle(rows),
    byPair: countRowsByPair(styleAdversarialRows),
    byPairDirectional: countPairDirectional(styleAdversarialRows),
    byPairTypeDiversity: countPairTypeDiversity(styleAdversarialRows),
    byStyleNoisyTagDiversity: countNoisyTagDiversity(styleNoisyRows),
    bySource: countSourceDistribution(rows),
    byStyleCleanTypeDiversity: countStyleCleanTypeDiversity(rows),
  };
}

function addFailure(
  failures: GoldDatasetFreezeFailure[],
  code: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  failures.push({ code, message, ...(context ? { context } : {}) });
}

function selectRowsByStyle(
  rows: StoredApprovedTruth[],
  goldKind: 'style_clean' | 'style_noisy',
  targetPerStyle: number,
  failures: GoldDatasetFreezeFailure[],
): StoredApprovedTruth[] {
  const selected: StoredApprovedTruth[] = [];
  for (const style of SUPPORTED_STYLE_LABELS) {
    const bucket = rows
      .filter((row) => row.goldKind === goldKind && row.expectedStyle === style)
      .sort(rowSort);
    if (bucket.length < targetPerStyle) {
      addFailure(
        failures,
        `INSUFFICIENT_${goldKind.toUpperCase()}_${style.toUpperCase()}`,
        `Need ${targetPerStyle} ${goldKind} rows for style ${style}, found ${bucket.length}.`,
        { style, goldKind, required: targetPerStyle, found: bucket.length },
      );
      continue;
    }
    selected.push(...firstN(bucket, targetPerStyle));
  }
  return selected;
}

function selectAdversarialRows(
  rows: StoredApprovedTruth[],
  failures: GoldDatasetFreezeFailure[],
): StoredApprovedTruth[] {
  const selected: StoredApprovedTruth[] = [];
  for (const pair of REQUIRED_ADVERSARIAL_PAIRS) {
    const pairRows = rows
      .filter((row) => row.goldKind === 'style_adversarial' && row.adversarialPair === pair)
      .sort(rowSort);
    const parsed = parsePairStyles(pair);
    if (!parsed) {
      addFailure(
        failures,
        `INVALID_ADVERSARIAL_PAIR_${pair}`,
        `Adversarial pair ${pair} is malformed.`,
      );
      continue;
    }
    const [leftStyle, rightStyle] = parsed;
    const leftRows = pairRows.filter((row) => row.expectedStyle === leftStyle);
    const rightRows = pairRows.filter((row) => row.expectedStyle === rightStyle);
    if (leftRows.length < ADVERSARIAL_DIRECTIONAL_TARGET || rightRows.length < ADVERSARIAL_DIRECTIONAL_TARGET) {
      addFailure(
        failures,
        `ADVERSARIAL_DIRECTIONAL_COVERAGE_${pair.toUpperCase()}`,
        `Need at least ${ADVERSARIAL_DIRECTIONAL_TARGET} rows for each direction in ${pair}.`,
        {
          pair,
          requiredPerDirection: ADVERSARIAL_DIRECTIONAL_TARGET,
          leftStyle,
          leftCount: leftRows.length,
          rightStyle,
          rightCount: rightRows.length,
        },
      );
      continue;
    }

    const chosen = [
      ...firstN(leftRows, ADVERSARIAL_DIRECTIONAL_TARGET),
      ...firstN(rightRows, ADVERSARIAL_DIRECTIONAL_TARGET),
    ];
    if (chosen.length < ADVERSARIAL_TARGET_PER_PAIR) {
      addFailure(
        failures,
        `INSUFFICIENT_ADVERSARIAL_${pair.toUpperCase()}`,
        `Need ${ADVERSARIAL_TARGET_PER_PAIR} adversarial rows for pair ${pair}, found ${chosen.length}.`,
        { pair, required: ADVERSARIAL_TARGET_PER_PAIR, found: chosen.length },
      );
      continue;
    }
    selected.push(...firstN(chosen, ADVERSARIAL_TARGET_PER_PAIR));
  }
  return selected;
}

function styleCoreCandidateRows(
  rows: StoredApprovedTruth[],
  options: GoldDatasetFreezeOptions,
): StoredApprovedTruth[] {
  return rows
    .map((row) => withLegacyCertification(row))
    .filter((row) => effectiveRowStatus(row) !== 'quarantined')
    .filter((row) => isTaskCertified(row, 'style', 'core'))
    .filter((row) => typeof row.expectedStyle === 'string' && SUPPORTED_STYLE_SET.has(row.expectedStyle.trim()))
    .filter((row) => row.styleInferabilityTier === 'tier1_exact_direct' || row.styleInferabilityTier === 'tier2_exact_policy_resolved')
    .filter((row) => row.styleEvaluationSuite === 'supported_exact')
    .filter((row) => row.goldKind != null && STYLE_CORE_ALLOWED_KINDS.has(row.goldKind))
    .filter((row) => options.includeHoldout || row.datasetSplit !== 'holdout')
    .filter((row) => row.datasetVersion == null || row.datasetVersion === options.datasetVersion);
}

function buildCandidateSummary(rows: StoredApprovedTruth[]): GoldDatasetFreezeCandidateSummary {
  return {
    styleClean: rows.filter((row) => row.goldKind === 'style_clean').length,
    styleAdversarial: rows.filter((row) => row.goldKind === 'style_adversarial').length,
    styleNoisy: rows.filter((row) => row.goldKind === 'style_noisy').length,
  };
}

export function buildStyleCoreFreezeSelection(
  rows: StoredApprovedTruth[],
  options: GoldDatasetFreezeOptions,
): GoldDatasetFreezeResult {
  const failures: GoldDatasetFreezeFailure[] = [];
  const warnings: GoldDatasetFreezeFailure[] = [];
  const candidates = styleCoreCandidateRows(rows, options);
  const candidateSummary = buildCandidateSummary(candidates);

  const selectedStyleClean = selectRowsByStyle(candidates, 'style_clean', STYLE_CLEAN_TARGET_PER_STYLE, failures);
  const selectedStyleNoisy = selectRowsByStyle(candidates, 'style_noisy', STYLE_NOISY_TARGET_PER_STYLE, failures);
  const selectedStyleAdversarial = selectAdversarialRows(candidates, failures);

  const selectedRows = [...selectedStyleClean, ...selectedStyleAdversarial, ...selectedStyleNoisy];
  if (selectedRows.length !== FROZEN_STYLE_CORE_TOTAL) {
    addFailure(
      failures,
      'STYLE_CORE_TOTAL_MISMATCH',
      `Selected style/core rows must total ${FROZEN_STYLE_CORE_TOTAL}, found ${selectedRows.length}.`,
      { required: FROZEN_STYLE_CORE_TOTAL, found: selectedRows.length },
    );
  }

  for (const row of selectedRows) {
    if (row.datasetVersion && row.datasetVersion !== options.datasetVersion) {
      addFailure(
        failures,
        'DATASET_VERSION_CONFLICT',
        `Row ${row.id} is already sealed to datasetVersion ${row.datasetVersion}.`,
        { rowId: row.id, existingDatasetVersion: row.datasetVersion, targetDatasetVersion: options.datasetVersion },
      );
    }
  }

  const summary = makeSelectionSummary(selectedRows);
  if (options.enforceDiversityGates) {
    for (const pair of REQUIRED_ADVERSARIAL_PAIRS) {
      const typeDiversity = summary.byPairTypeDiversity[pair] ?? 0;
      if (typeDiversity < MIN_ADVERSARIAL_TYPE_DIVERSITY) {
        addFailure(
          failures,
          `PAIR_TYPE_DIVERSITY_${pair.toUpperCase()}`,
          `Adversarial pair ${pair} needs at least ${MIN_ADVERSARIAL_TYPE_DIVERSITY} distinct expectedType values.`,
          { pair, required: MIN_ADVERSARIAL_TYPE_DIVERSITY, found: typeDiversity },
        );
      }
    }
    for (const style of SUPPORTED_STYLE_LABELS) {
      const styleCleanTypeDiversity = summary.byStyleCleanTypeDiversity[style] ?? 0;
      if (styleCleanTypeDiversity < MIN_STYLE_CLEAN_TYPE_DIVERSITY) {
        addFailure(
          failures,
          `STYLE_CLEAN_TYPE_DIVERSITY_${style.toUpperCase()}`,
          `style_clean rows for ${style} need at least ${MIN_STYLE_CLEAN_TYPE_DIVERSITY} distinct expectedType values.`,
          { style, required: MIN_STYLE_CLEAN_TYPE_DIVERSITY, found: styleCleanTypeDiversity },
        );
      }
    }
    for (const style of SUPPORTED_STYLE_LABELS) {
      const noisyTagDiversity = summary.byStyleNoisyTagDiversity[style] ?? 0;
      if (noisyTagDiversity < MIN_NOISE_TAG_DIVERSITY) {
        addFailure(
          failures,
          `NOISE_PROFILE_DIVERSITY_${style.toUpperCase()}`,
          `style_noisy rows for ${style} need at least ${MIN_NOISE_TAG_DIVERSITY} distinct noise tags.`,
          { style, required: MIN_NOISE_TAG_DIVERSITY, found: noisyTagDiversity },
        );
      }
    }
    const sourceDistribution = Object.entries(summary.bySource);
    if (sourceDistribution.length > 0) {
      const top = sourceDistribution.sort((left, right) => right[1] - left[1])[0]!;
      const topShare = top[1] / Math.max(summary.total, 1);
      if (topShare > MAX_SINGLE_SOURCE_SHARE) {
        addFailure(
          failures,
          'SOURCE_BALANCE_THRESHOLD',
          `No single source may exceed ${Math.round(MAX_SINGLE_SOURCE_SHARE * 100)}% of frozen rows.`,
          { source: top[0], share: topShare, threshold: MAX_SINGLE_SOURCE_SHARE },
        );
      }
    }
  } else {
    warnings.push({
      code: 'DIVERSITY_GATES_SKIPPED',
      message: 'Diversity gates were explicitly skipped for this freeze run.',
    });
  }

  return {
    options,
    selectedRows,
    candidateSummary,
    selectionSummary: summary,
    failures,
    warnings,
  };
}

function hashManifest(manifest: Omit<FrozenGoldDatasetManifest, 'manifestHash'>): string {
  return createHash('sha256').update(stableStringify(manifest)).digest('hex');
}

export function createFrozenManifest(
  result: GoldDatasetFreezeResult,
  createdAt = new Date().toISOString(),
): FrozenGoldDatasetManifest {
  const base: Omit<FrozenGoldDatasetManifest, 'manifestHash'> = {
    datasetVersion: result.options.datasetVersion,
    createdAt,
    includeHoldout: result.options.includeHoldout,
    enforceDiversityGates: result.options.enforceDiversityGates,
    rowCount: result.selectedRows.length,
    rowIds: result.selectedRows.map((row) => row.id).sort(),
    inputHashes: result.selectedRows.map((row) => row.inputHash).sort(),
    composition: result.selectionSummary,
    candidates: result.candidateSummary,
  };
  return {
    ...base,
    manifestHash: hashManifest(base),
  };
}

export async function readFrozenGoldDatasetManifest(
  datasetVersion: string,
): Promise<FrozenGoldDatasetManifest | null> {
  const path = manifestFilePath(datasetVersion);
  if (!existsSync(path)) {
    return null;
  }
  const payload = JSON.parse(await readFile(path, 'utf8')) as FrozenGoldDatasetManifest;
  return payload;
}

export async function writeFrozenGoldDatasetManifest(
  manifest: FrozenGoldDatasetManifest,
): Promise<string> {
  const root = resolveGoldDatasetRoot();
  await mkdir(root, { recursive: true });
  const path = manifestFilePath(manifest.datasetVersion);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

export async function listFrozenGoldDatasetManifests(): Promise<FrozenGoldDatasetManifest[]> {
  const root = resolveGoldDatasetRoot();
  if (!existsSync(root)) {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const manifestsByVersion = new Map<string, FrozenGoldDatasetManifest>();
  for (const entry of entries) {
    if (
      !entry.isFile()
      || !entry.name.endsWith('.json')
      || entry.name.endsWith('.summary.json')
    ) {
      continue;
    }
    const path = resolve(root, entry.name);
    try {
      const payload = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (!isFrozenGoldDatasetManifest(payload)) {
        continue;
      }
      const existing = manifestsByVersion.get(payload.datasetVersion);
      if (!existing || payload.createdAt > existing.createdAt) {
        manifestsByVersion.set(payload.datasetVersion, payload);
      }
    } catch {
      // Ignore malformed manifest files to avoid blocking listing.
    }
  }
  const manifests = [...manifestsByVersion.values()];
  manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return manifests;
}

export function requiredAdversarialPair(pair: string | null | undefined): boolean {
  if (!pair) {
    return false;
  }
  return REQUIRED_PAIR_SET.has(pair);
}
