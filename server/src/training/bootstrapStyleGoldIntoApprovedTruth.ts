import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../config.js';
import {
  runtimePersistenceBackend,
  upsertApprovedTruthPayload,
  type TruthDatasetSplit,
  type TruthTrustLevel,
} from '../runtime/persistence.js';
import type { TruthRowStatus } from '../runtime/store.js';
import { resolveGoldDatasetRoot, resolveStyleGoldOutputPath } from '../runtime/artifactPaths.js';

interface StyleGoldJsonlRow {
  raw_text?: unknown;
  expected_fields?: unknown;
  expected_type?: unknown;
  expected_style?: unknown;
  dataset_split?: unknown;
  trust_level?: unknown;
  row_status?: unknown;
  provenance?: unknown;
  pipeline_major?: unknown;
  gold_kind?: unknown;
  adversarial_pair?: unknown;
  noise_profile?: unknown;
  approval_source?: unknown;
}

const ALLOWED_DATASET_SPLITS: ReadonlySet<TruthDatasetSplit> = new Set([
  'train',
  'val',
  'test',
  'holdout',
]);

const ALLOWED_TRUST_LEVELS: ReadonlySet<TruthTrustLevel> = new Set([
  'draft',
  'reviewed',
  'gold',
]);

const ALLOWED_ROW_STATUSES: ReadonlySet<TruthRowStatus> = new Set([
  'draft',
  'reviewed',
  'quarantined',
]);

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== null);
  return normalized.length > 0 ? normalized : null;
}

function asDatasetSplit(value: unknown): TruthDatasetSplit | null {
  const normalized = asString(value);
  if (!normalized || !ALLOWED_DATASET_SPLITS.has(normalized as TruthDatasetSplit)) {
    return null;
  }
  return normalized as TruthDatasetSplit;
}

function asTrustLevel(value: unknown): TruthTrustLevel {
  const normalized = asString(value);
  if (!normalized || !ALLOWED_TRUST_LEVELS.has(normalized as TruthTrustLevel)) {
    return 'reviewed';
  }
  return normalized as TruthTrustLevel;
}

function asRowStatus(value: unknown, trustLevel: TruthTrustLevel): TruthRowStatus {
  const normalized = asString(value);
  if (normalized && ALLOWED_ROW_STATUSES.has(normalized as TruthRowStatus)) {
    return normalized as TruthRowStatus;
  }
  if (trustLevel === 'draft') {
    return 'draft';
  }
  return 'reviewed';
}

function asInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  return value;
}

function shouldBootstrapTransientTestApprovedTruth(): boolean {
  if (runtimePersistenceBackend !== 'memory') {
    return false;
  }
  if (env.NODE_ENV !== 'test') {
    return false;
  }
  const raw = process.env.BULKREFERENCES_BOOTSTRAP_STYLE_GOLD;
  if (!raw) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

async function resolveBootstrapSourcePath(): Promise<string> {
  const defaultPath = resolveStyleGoldOutputPath();
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  const datasetRoot = resolveGoldDatasetRoot();
  if (!existsSync(datasetRoot)) {
    return defaultPath;
  }

  try {
    const entries = await readFileListing(datasetRoot);
    return entries[0] ?? defaultPath;
  } catch {
    return defaultPath;
  }
}

async function readFileListing(datasetRoot: string): Promise<string[]> {
  const entries = await readdir(datasetRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.style-core.jsonl'))
    .map((entry) => resolve(datasetRoot, entry.name))
    .sort((left, right) => right.localeCompare(left));
}

export async function bootstrapStyleGoldIntoApprovedTruth(): Promise<{
  loaded: number;
  skipped: number;
  path: string;
} | null> {
  if (!shouldBootstrapTransientTestApprovedTruth()) {
    return null;
  }

  const styleGoldPath = await resolveBootstrapSourcePath();
  if (!existsSync(styleGoldPath)) {
    return {
      loaded: 0,
      skipped: 0,
      path: styleGoldPath,
    };
  }

  const content = await readFile(styleGoldPath, 'utf8');
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  let loaded = 0;
  let skipped = 0;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      skipped += 1;
      continue;
    }

    const row = parsed as StyleGoldJsonlRow;
    const rawText = asString(row.raw_text);
    const expectedFields = asObject(row.expected_fields);
    if (!rawText || !expectedFields) {
      skipped += 1;
      continue;
    }

    const trustLevel = asTrustLevel(row.trust_level);
    const rowStatus = asRowStatus(row.row_status, trustLevel);

    await upsertApprovedTruthPayload({
      rawText,
      expectedFields,
      expectedType: asString(row.expected_type),
      expectedStyle: asString(row.expected_style),
      datasetSplit: asDatasetSplit(row.dataset_split),
      trustLevel,
      rowStatus,
      provenance: asString(row.provenance) ?? 'style_gold_bootstrap',
      pipelineMajor: asInteger(row.pipeline_major),
      goldKind: asString(row.gold_kind) as
        | 'style_clean'
        | 'style_adversarial'
        | 'style_noisy'
        | 'field_span'
        | 'authority_seed'
        | 'overlay_accept'
        | null,
      adversarialPair: asString(row.adversarial_pair),
      noiseProfile: asStringArray(row.noise_profile),
      approvalSource: (asString(row.approval_source) as 'manual' | 'learning_queue' | 'overlay_accept' | null),
      reviewedBy: trustLevel === 'draft' ? null : 'system:style-gold-bootstrap',
      notes: 'Auto-loaded from style_gold.jsonl for transient test runs.',
    });

    loaded += 1;
  }

  return {
    loaded,
    skipped,
    path: styleGoldPath,
  };
}
