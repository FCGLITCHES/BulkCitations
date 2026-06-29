import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  TruthApprovalSource,
  TruthDatasetSplit,
  TruthGoldKind,
  TruthRowStatus,
  TruthTaskCertification,
  TruthTrustLevel,
} from '../src/runtime/store.js';
import { hashInputForTruth } from '../src/training/truthHash.js';

interface TrainingRow {
  raw_text: string;
  expected_fields: Record<string, unknown>;
  expected_type?: string | null;
  expected_style?: string | null;
  dataset_split?: TruthDatasetSplit | null;
  trust_level?: TruthTrustLevel | null;
  row_status?: TruthRowStatus | null;
  provenance?: string | null;
  pipeline_major?: number | null;
  gold_kind?: TruthGoldKind | null;
  adversarial_pair?: string | null;
  noise_profile?: string[] | null;
  approval_source?: TruthApprovalSource | null;
  work_id?: string | null;
  family_id?: string | null;
  variant_id?: string | null;
  dataset_version?: string | null;
  holdout_version?: string | null;
}

const DATASET_SPLITS = new Set<TruthDatasetSplit>(['train', 'val', 'test', 'holdout']);
const TRUST_LEVELS = new Set<TruthTrustLevel>(['draft', 'reviewed', 'gold']);
const ROW_STATUSES = new Set<TruthRowStatus>(['draft', 'reviewed', 'quarantined']);
const GOLD_KINDS = new Set<TruthGoldKind>([
  'style_clean',
  'style_adversarial',
  'style_noisy',
  'field_span',
  'authority_seed',
  'overlay_accept',
]);
const APPROVAL_SOURCES = new Set<TruthApprovalSource>(['manual', 'learning_queue', 'overlay_accept']);

function parseArgs(argv: string[]): {
  jsonlPath: string;
  reviewedBy: string;
  notes: string;
  styleCoreFrozen: boolean;
} {
  const positional: string[] = [];
  let reviewedBy = 'system:bootstrap-seed';
  let notes = 'Seeded from flat JSONL bootstrap fixture.';
  let styleCoreFrozen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (token === '--reviewed-by') {
      reviewedBy = argv[index + 1] ?? reviewedBy;
      index += 1;
      continue;
    }
    if (token === '--notes') {
      notes = argv[index + 1] ?? notes;
      index += 1;
      continue;
    }
    if (token === '--style-core-frozen') {
      styleCoreFrozen = true;
      continue;
    }
    positional.push(token);
  }

  const jsonlPath = positional[0];
  if (!jsonlPath) {
    throw new Error('Usage: tsx scripts/seed-approved-truth-from-jsonl.ts <path-to-jsonl> [--reviewed-by name] [--notes text]');
  }

  return {
    jsonlPath: resolve(process.cwd(), jsonlPath),
    reviewedBy,
    notes,
    styleCoreFrozen,
  };
}

function assertString(value: unknown, fieldName: string, lineNumber: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`line ${lineNumber}: ${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function parseOptionalString(
  value: unknown,
  fieldName: string,
  lineNumber: number,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`line ${lineNumber}: ${fieldName} must be a string or null`);
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOptionalDatasetSplit(
  value: unknown,
  lineNumber: number,
): TruthDatasetSplit | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !DATASET_SPLITS.has(value as TruthDatasetSplit)) {
    throw new Error(`line ${lineNumber}: dataset_split must be train, val, test, holdout, or null`);
  }
  return value as TruthDatasetSplit;
}

function parseOptionalTrustLevel(
  value: unknown,
  lineNumber: number,
): TruthTrustLevel | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !TRUST_LEVELS.has(value as TruthTrustLevel)) {
    throw new Error(`line ${lineNumber}: trust_level must be draft, reviewed, gold, or null`);
  }
  return value as TruthTrustLevel;
}

function parseOptionalRowStatus(
  value: unknown,
  lineNumber: number,
): TruthRowStatus | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !ROW_STATUSES.has(value as TruthRowStatus)) {
    throw new Error(`line ${lineNumber}: row_status must be draft, reviewed, quarantined, or null`);
  }
  return value as TruthRowStatus;
}

function parseOptionalPipelineMajor(
  value: unknown,
  lineNumber: number,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`line ${lineNumber}: pipeline_major must be an integer or null`);
  }
  return value;
}

function parseOptionalGoldKind(
  value: unknown,
  lineNumber: number,
): TruthGoldKind | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !GOLD_KINDS.has(value as TruthGoldKind)) {
    throw new Error(`line ${lineNumber}: gold_kind must be a supported truth gold kind or null`);
  }
  return value as TruthGoldKind;
}

function parseOptionalApprovalSource(
  value: unknown,
  lineNumber: number,
): TruthApprovalSource | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !APPROVAL_SOURCES.has(value as TruthApprovalSource)) {
    throw new Error(`line ${lineNumber}: approval_source must be manual, learning_queue, overlay_accept, or null`);
  }
  return value as TruthApprovalSource;
}

function parseOptionalStringArray(
  value: unknown,
  fieldName: string,
  lineNumber: number,
): string[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`line ${lineNumber}: ${fieldName} must be an array of strings or null`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function buildStyleCoreCertification(reviewedBy: string): TruthTaskCertification[] {
  return [
    {
      task: 'style',
      truthScope: 'core',
      status: 'certified',
      certifiedAt: new Date().toISOString(),
      certifiedBy: reviewedBy,
      requiredReviewPasses: 1,
      completedReviewPasses: 1,
      pass1Hash: null,
      pass2Hash: null,
    },
  ];
}

function parseRow(rawLine: string, lineNumber: number): TrainingRow {
  let payload: unknown;
  try {
    payload = JSON.parse(rawLine);
  } catch (error) {
    throw new Error(`line ${lineNumber}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`line ${lineNumber}: each JSONL row must be an object`);
  }

  const row = payload as Record<string, unknown>;
  const expectedFields = row.expected_fields;
  if (!expectedFields || typeof expectedFields !== 'object' || Array.isArray(expectedFields)) {
    throw new Error(`line ${lineNumber}: expected_fields must be an object`);
  }

  return {
    raw_text: assertString(row.raw_text, 'raw_text', lineNumber),
    expected_fields: expectedFields as Record<string, unknown>,
    expected_type: parseOptionalString(row.expected_type, 'expected_type', lineNumber),
    expected_style: parseOptionalString(row.expected_style, 'expected_style', lineNumber),
    dataset_split: parseOptionalDatasetSplit(row.dataset_split, lineNumber),
    trust_level: parseOptionalTrustLevel(row.trust_level, lineNumber),
    row_status: parseOptionalRowStatus(row.row_status, lineNumber),
    provenance: parseOptionalString(row.provenance, 'provenance', lineNumber),
    pipeline_major: parseOptionalPipelineMajor(row.pipeline_major, lineNumber),
    gold_kind: parseOptionalGoldKind(row.gold_kind, lineNumber),
    adversarial_pair: parseOptionalString(row.adversarial_pair, 'adversarial_pair', lineNumber),
    noise_profile: parseOptionalStringArray(row.noise_profile, 'noise_profile', lineNumber),
    approval_source: parseOptionalApprovalSource(row.approval_source, lineNumber),
    work_id: parseOptionalString(row.work_id, 'work_id', lineNumber),
    family_id: parseOptionalString(row.family_id, 'family_id', lineNumber),
    variant_id: parseOptionalString(row.variant_id, 'variant_id', lineNumber),
    dataset_version: parseOptionalString(row.dataset_version, 'dataset_version', lineNumber),
    holdout_version: parseOptionalString(row.holdout_version, 'holdout_version', lineNumber),
  };
}

async function main(): Promise<void> {
  const { jsonlPath, reviewedBy, notes, styleCoreFrozen } = parseArgs(process.argv.slice(2));
  process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/bulkreferences';
  process.env.PERSISTENCE_BACKEND ??= 'database';

  const { closeDb } = await import('../src/db/connection.js');

  try {
    const persistence = await import('../src/runtime/persistence.js');
    const {
      listApprovedTruth,
      runtimePersistenceBackend,
      upsertApprovedTruthPayload,
    } = persistence;

    if (runtimePersistenceBackend !== 'database') {
      throw new Error(
        `Approved truth seeding requires the database backend. Resolved backend: ${runtimePersistenceBackend}.`,
      );
    }

    const content = await readFile(jsonlPath, 'utf8');
    const lines = content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    const existingRows = await listApprovedTruth({ limit: 50_000 });
    const existingHashes = new Set(existingRows.map((row) => row.inputHash));

    let created = 0;
    let updated = 0;
    let reviewedRows = 0;
    let goldRows = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const lineNumber = index + 1;
      const row = parseRow(lines[index] ?? '', lineNumber);
      const trustLevel = row.trust_level ?? 'draft';
      const rowStatus = row.row_status ?? (trustLevel === 'draft' ? 'draft' : 'reviewed');
      const inputHash = hashInputForTruth(row.raw_text);
      const rowReviewedBy =
        trustLevel === 'draft'
          ? null
          : reviewedBy;
      const taskCertifications = styleCoreFrozen
        ? buildStyleCoreCertification(reviewedBy)
        : null;

      await upsertApprovedTruthPayload({
        rawText: row.raw_text,
        expectedFields: row.expected_fields,
        coreTruth: row.expected_fields,
        expectedType: row.expected_type ?? null,
        expectedStyle: row.expected_style ?? null,
        provenance: row.provenance ?? 'bootstrap_fixture',
        pipelineMajor: row.pipeline_major ?? null,
        datasetSplit: row.dataset_split ?? null,
        trustLevel,
        rowStatus,
        holdoutVersion: row.holdout_version ?? null,
        taskCertifications,
        workId: row.work_id ?? null,
        familyId: row.family_id ?? null,
        variantId: row.variant_id ?? null,
        datasetVersion: row.dataset_version ?? null,
        styleInferabilityTier: styleCoreFrozen ? 'tier2_exact_policy_resolved' : null,
        styleEvaluationSuite: styleCoreFrozen ? 'supported_exact' : null,
        goldKind: row.gold_kind ?? null,
        adversarialPair: row.adversarial_pair ?? null,
        noiseProfile: row.noise_profile ?? null,
        approvalSource: row.approval_source ?? null,
        reviewedBy: rowReviewedBy,
        notes,
      });

      if (existingHashes.has(inputHash)) {
        updated += 1;
      } else {
        existingHashes.add(inputHash);
        created += 1;
      }

      if (trustLevel === 'reviewed') {
        reviewedRows += 1;
      }
      if (trustLevel === 'gold') {
        goldRows += 1;
      }
    }

    const finalRows = await listApprovedTruth({ limit: 50_000 });
    console.log(
      JSON.stringify(
        {
          ok: true,
          sourcePath: jsonlPath,
          created,
          updated,
          totalRows: finalRows.length,
          reviewedRows,
          goldRows,
          reviewedBy,
          styleCoreFrozen,
        },
        null,
        2,
      ),
    );
  } finally {
    await closeDb();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
