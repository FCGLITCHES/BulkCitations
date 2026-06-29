import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  listApprovedTruth,
  listLearningQueue,
  resetRuntimeStore,
  saveLearningQueueItem,
  upsertApprovedTruthPayload,
} from '../../src/runtime/persistence.js';

const STYLE_BUNDLE_ROUTE_TEST_TIMEOUT_MS = 30_000;

function parseNdjson(body: string): Array<Record<string, unknown>> {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

function buildEvidenceSnapshot(rawText: string) {
  return {
    rawTextSnapshot: rawText,
    providerSnapshots: [],
    providerSnapshotHashes: [],
    normalizedEvidence: {},
    fieldJustifications: { title: 'manual review' },
    schemaVersion: 'v1',
    normalizationVersion: 'v1',
    reviewChecklistVersion: 'v1',
    decisionTimestamp: new Date().toISOString(),
  };
}

function buildTaskCertification(task: 'style' | 'authority_pack'): Array<Record<string, unknown>> {
  return [
    {
      task,
      truthScope: 'core',
      status: 'certified',
      certifiedAt: new Date().toISOString(),
      certifiedBy: 'reviewer@example.com',
      requiredReviewPasses: 1,
      completedReviewPasses: 1,
      pass1Hash: null,
      pass2Hash: null,
    },
  ];
}

function styleCertificationMetadata() {
  return {
    styleInferabilityTier: 'tier1_exact_direct',
    styleEvaluationSuite: 'supported_exact',
  };
}

async function waitForTruthBackgroundJob(
  app: FastifyInstance,
  jobId: string,
): Promise<{
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalRows: number;
  totalPages: number;
  completedRows: number;
  completedPages: number;
  updatedCount: number;
  deletedCount: number;
  certifiedCount: number;
  quarantinedCount: number;
  skippedCount: number;
  failedCount: number;
  recentResults: Array<{ id: string; status: string }>;
  recentCompletedPage: number | null;
  error?: string | null;
}> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/admin/approved-truth/background-bulk/${jobId}`,
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      status: 'pending' | 'running' | 'completed' | 'failed';
      totalRows: number;
      totalPages: number;
      completedRows: number;
      completedPages: number;
      updatedCount: number;
      deletedCount: number;
      certifiedCount: number;
      quarantinedCount: number;
      skippedCount: number;
      failedCount: number;
      recentResults: Array<{ id: string; status: string }>;
      recentCompletedPage: number | null;
      error?: string | null;
    };
    if (payload.status === 'completed' || payload.status === 'failed') {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Background job ${jobId} did not finish in time.`);
}

function applyArtifactOverrides(root: string): void {
  process.env.BULKREFERENCES_STYLE_GOLD_OUTPUT_PATH = resolve(root, 'training', 'style_gold.jsonl');
  process.env.BULKREFERENCES_GOLD_DATASET_ROOT = resolve(root, 'training', 'gold-datasets');
  process.env.BULKREFERENCES_STYLE_MODEL_ROOT = resolve(root, 'models', 'style-model');
  process.env.BULKREFERENCES_BIO_DATASET_ROOT = resolve(root, 'datasets', 'citation-bio');
  process.env.BULKREFERENCES_BIO_MODEL_ROOT = resolve(root, 'models');
  process.env.BULKREFERENCES_BENCHMARK_RESULTS_ROOT = resolve(root, 'benchmarks');
  process.env.BULKREFERENCES_STAGED_TRAINING_PACK_ROOT = resolve(root, 'staged-training-packs');
  process.env.BULKREFERENCES_PYTHON_BIO_TRAINING_SCRIPT_PATH = resolve(root, 'tools', 'train_bio_bundle_stub.py');
  process.env.BULKREFERENCES_PYTHON_BUNDLE_PROMOTION_SCRIPT_PATH = resolve(root, 'tools', 'promote_bundle_stub.py');
}

function clearArtifactOverrides(): void {
  delete process.env.BULKREFERENCES_STYLE_GOLD_OUTPUT_PATH;
  delete process.env.BULKREFERENCES_GOLD_DATASET_ROOT;
  delete process.env.BULKREFERENCES_STYLE_MODEL_ROOT;
  delete process.env.BULKREFERENCES_BIO_DATASET_ROOT;
  delete process.env.BULKREFERENCES_BIO_MODEL_ROOT;
  delete process.env.BULKREFERENCES_BENCHMARK_RESULTS_ROOT;
  delete process.env.BULKREFERENCES_STAGED_TRAINING_PACK_ROOT;
  delete process.env.BULKREFERENCES_PYTHON_BIO_TRAINING_SCRIPT_PATH;
  delete process.env.BULKREFERENCES_PYTHON_BUNDLE_PROMOTION_SCRIPT_PATH;
}

async function writeBioScriptStubs(root: string): Promise<void> {
  const toolsRoot = resolve(root, 'tools');
  await mkdir(toolsRoot, { recursive: true });

  await writeFile(
    resolve(toolsRoot, 'train_bio_bundle_stub.py'),
    `import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("jsonl")
parser.add_argument("--model-root", required=True)
parser.add_argument("--version", required=True)
args, _unknown = parser.parse_known_args()

dataset_path = Path(args.jsonl)
model_root = Path(args.model_root)
bundle_dir = model_root / "staged" / args.version
bundle_dir.mkdir(parents=True, exist_ok=True)
row_count = sum(1 for line in dataset_path.read_text(encoding="utf-8").splitlines() if line.strip())
metadata = {
    "modelVersion": args.version,
    "featureVersion": "plain-text-bio-v1",
    "bundleType": "token-classification",
    "bundleClass": "standard",
    "datasetTrack": "citation-bio-gold",
    "datasetSource": str(dataset_path),
    "datasetStats": {"total": row_count},
    "labels": ["O", "B-author", "I-author", "B-title", "I-title"],
}
(bundle_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
print(json.dumps({
    "ok": True,
    "bundleDir": str(bundle_dir),
    "modelVersion": args.version,
    "featureVersion": "plain-text-bio-v1",
    "datasetStats": {"total": row_count},
    "validation": {"valid": True},
}))
`,
    'utf8',
  );

  await writeFile(
    resolve(toolsRoot, 'promote_bundle_stub.py'),
    `import argparse
import json
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("version")
parser.add_argument("--model-root", required=True)
args, _unknown = parser.parse_known_args()

model_root = Path(args.model_root)
staged_dir = model_root / "staged" / args.version
promoted_dir = model_root / "promoted" / args.version
current_dir = model_root / "current"

if promoted_dir.exists():
    shutil.rmtree(promoted_dir)
if current_dir.exists():
    shutil.rmtree(current_dir)

promoted_dir.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(staged_dir, promoted_dir)
shutil.copytree(promoted_dir, current_dir)

print(json.dumps({
    "promoted": True,
    "version": args.version,
    "stagedDir": str(staged_dir),
    "promotedDir": str(promoted_dir),
    "currentDir": str(current_dir),
}))
`,
    'utf8',
  );
}

async function removePathWithRetries(path: string, retries = 5): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      const retryable = code === 'ENOTEMPTY' || code === 'EPERM' || code === 'EBUSY';
      if (!retryable || attempt === retries) {
        throw error;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50 * (attempt + 1)));
    }
  }
}

describe('admin training routes', () => {
  let app: FastifyInstance | null = null;
  let restoreStyleGold: string | null = null;
  let restoreCurrentStyleBundle: string | null = null;
  let currentStyleBundleExisted = false;
  let styleGoldExisted = false;
  let artifactOverrideRoot: string | null = null;

  beforeEach(async () => {
    artifactOverrideRoot = await mkdtemp(join(tmpdir(), 'bulkreferences-admin-training-'));
    applyArtifactOverrides(artifactOverrideRoot);
    await writeBioScriptStubs(artifactOverrideRoot);
  });

  afterEach(async () => {
    await resetRuntimeStore();
    const styleGoldPath = artifactOverrideRoot
      ? resolve(artifactOverrideRoot, 'training', 'style_gold.jsonl')
      : null;
    const currentStyleBundlePath = artifactOverrideRoot
      ? resolve(artifactOverrideRoot, 'models', 'style-model', 'current', 'style_model.json')
      : null;
    if (styleGoldExisted && restoreStyleGold != null) {
      await mkdir(dirname(styleGoldPath!), { recursive: true }).catch(() => undefined);
      await writeFile(styleGoldPath!, restoreStyleGold, 'utf8');
    } else if (styleGoldPath) {
      await rm(styleGoldPath, { force: true });
    }
    if (currentStyleBundleExisted && restoreCurrentStyleBundle != null) {
      await mkdir(dirname(currentStyleBundlePath!), { recursive: true }).catch(() => undefined);
      await writeFile(currentStyleBundlePath!, restoreCurrentStyleBundle, 'utf8');
    } else if (currentStyleBundlePath) {
      await rm(currentStyleBundlePath, { force: true });
    }
    if (artifactOverrideRoot) {
      await removePathWithRetries(artifactOverrideRoot);
    }
    clearArtifactOverrides();
    restoreStyleGold = null;
    restoreCurrentStyleBundle = null;
    currentStyleBundleExisted = false;
    styleGoldExisted = false;
    artifactOverrideRoot = null;
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('creates flat approved-truth rows, dedupes by normalized hash, and exports NDJSON', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: '  Smith,\nJ.   (2020). Example study.  ',
        expectedFields: {
          title: { value: ' Example study ' },
          year: { value: 2020 },
          authors: {
            value: [
              { family: 'Smith', given: 'Jane' },
              { literal: 'World Health Organization' },
            ],
          },
        },
        datasetSplit: 'train',
        trustLevel: 'gold',
        rowStatus: 'reviewed',
        taskCertifications: buildTaskCertification('authority_pack'),
        evidenceSnapshot: buildEvidenceSnapshot('Smith, J. (2020). Example study.'),
        goldKind: 'style_adversarial',
        adversarialPair: 'apa7_vs_harvard-ctr',
        noiseProfile: ['punctuation_drift', 'spacing_damage'],
        approvalSource: 'manual',
        reviewedBy: 'reviewer@example.com',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as {
      id: string;
      inputHash: string;
      expectedFields: Record<string, unknown>;
    };
    expect(created.expectedFields).toEqual({
      title: 'Example study',
      year: 2020,
      authors: ['Smith, Jane', 'World Health Organization'],
    });

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Example study.',
        expectedFields: {
          title: 'Example study revised',
        },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        taskCertifications: buildTaskCertification('authority_pack'),
        evidenceSnapshot: buildEvidenceSnapshot('Smith, J. (2020). Example study.'),
        goldKind: 'style_adversarial',
        adversarialPair: 'apa7_vs_harvard-ctr',
        noiseProfile: ['punctuation_drift', 'spacing_damage'],
        approvalSource: 'manual',
      },
    });

    expect(duplicateResponse.statusCode).toBe(201);
    const duplicate = duplicateResponse.json() as { id: string; inputHash: string };
    expect(duplicate.id).toBe(created.id);
    expect(duplicate.inputHash).toBe(created.inputHash);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth?certificationView=certified&page=1&limit=25',
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json() as {
      items: Array<{ id: string; expectedFields: Record<string, unknown> }>;
      total: number;
      totalPages: number;
    };
    expect(listPayload.total).toBe(1);
    expect(listPayload.totalPages).toBe(1);
    expect(listPayload.items[0]?.expectedFields).toEqual({
      title: 'Example study revised',
    });

    const exportResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false&task=authority_pack',
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers['content-disposition']).toBeUndefined();

    const lines = parseNdjson(exportResponse.body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      raw_text: 'Smith, J. (2020). Example study.',
      expected_fields: {
        title: 'Example study revised',
      },
      dataset_split: 'train',
      trust_level: 'reviewed',
      gold_kind: 'style_adversarial',
      adversarial_pair: 'apa7_vs_harvard-ctr',
      noise_profile: ['punctuation_drift', 'spacing_damage'],
      approval_source: 'manual',
    });
  });

  it('preserves dataset split through admin training export filters', async () => {
    app = await buildApp();

    const sharedPayload = {
      expectedFields: { title: 'Split smoke row' },
      expectedType: 'article-journal',
      expectedStyle: 'apa7',
      ...styleCertificationMetadata(),
      trustLevel: 'gold' as const,
      rowStatus: 'reviewed' as const,
      taskCertifications: buildTaskCertification('style'),
      goldKind: 'style_clean' as const,
    };

    const trainRawText =
      'Train, T. (2024). Split smoke train row. Journal of Split Smoke, 1(1), 1-2.';
    const trainCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        ...sharedPayload,
        rawText: trainRawText,
        datasetSplit: 'train',
        evidenceSnapshot: buildEvidenceSnapshot(trainRawText),
      },
    });
    expect(trainCreate.statusCode).toBe(201);

    const validationRawText =
      'Validation, V. (2024). Split smoke validation row. Journal of Split Smoke, 2(1), 3-4.';
    const validationCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        ...sharedPayload,
        rawText: validationRawText,
        datasetSplit: 'val',
        evidenceSnapshot: buildEvidenceSnapshot(validationRawText),
      },
    });
    expect(validationCreate.statusCode).toBe(201);

    const validationExport = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false&task=style&truthScope=core&datasetSplit=val',
    });

    expect(validationExport.statusCode).toBe(200);
    const validationLines = parseNdjson(validationExport.body);
    expect(validationLines).toHaveLength(1);
    expect(validationLines[0]).toMatchObject({
      raw_text: validationRawText,
      expected_style: 'apa7',
      dataset_split: 'val',
    });

    const trainExport = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false&task=style&truthScope=core&datasetSplit=train',
    });

    expect(trainExport.statusCode).toBe(200);
    const trainLines = parseNdjson(trainExport.body);
    expect(trainLines).toHaveLength(1);
    expect(trainLines[0]).toMatchObject({
      raw_text: trainRawText,
      expected_style: 'apa7',
      dataset_split: 'train',
    });
  });

  it('separates pending and certified approved-truth rows in the list view', async () => {
    app = await buildApp();

    const pendingResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Pending, P. (2024). Needs certification.',
        expectedFields: { title: 'Needs certification' },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        evidenceSnapshot: buildEvidenceSnapshot('Pending, P. (2024). Needs certification.'),
      },
    });
    expect(pendingResponse.statusCode).toBe(201);
    const pending = pendingResponse.json() as { id: string };

    const certifiedResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Certified, C. (2024). Ready for engine.',
        expectedFields: { title: 'Ready for engine' },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        taskCertifications: buildTaskCertification('style'),
        evidenceSnapshot: buildEvidenceSnapshot('Certified, C. (2024). Ready for engine.'),
      },
    });
    expect(certifiedResponse.statusCode).toBe(201);
    const certified = certifiedResponse.json() as { id: string };

    const pendingListResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth?page=1&limit=25',
    });
    expect(pendingListResponse.statusCode).toBe(200);
    const pendingList = pendingListResponse.json() as { total: number; items: Array<{ id: string }> };
    expect(pendingList.total).toBe(1);
    expect(pendingList.items.map((row) => row.id)).toEqual([pending.id]);

    const certifiedListResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth?certificationView=certified&page=1&limit=25',
    });
    expect(certifiedListResponse.statusCode).toBe(200);
    const certifiedList = certifiedListResponse.json() as { total: number; items: Array<{ id: string }> };
    expect(certifiedList.total).toBe(1);
    expect(certifiedList.items.map((row) => row.id)).toEqual([certified.id]);
  });

  it('dedupes admin approved-truth create against legacy numbered rows', async () => {
    app = await buildApp();

    const canonicalRaw =
      'Kumar, A., Kini, S. G., & Rathi, E. (2021). A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Reviews in Medicinal Chemistry, 21(18), 2788-2800.';
    const legacyNumberedRaw = `22. ${canonicalRaw}`;
    const legacy = await upsertApprovedTruthPayload({
      rawText: legacyNumberedRaw,
      expectedFields: { title: 'Legacy numbered row' },
      expectedStyle: 'apa7',
      trustLevel: 'reviewed',
      rowStatus: 'reviewed',
      approvalSource: 'manual',
    });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: canonicalRaw,
        expectedFields: {
          title: 'Canonical row',
        },
        expectedStyle: 'apa7',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        approvalSource: 'manual',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as {
      id: string;
      rawText: string;
      expectedFields: Record<string, unknown>;
    };
    expect(created.id).toBe(legacy.id);
    expect(created.rawText).toBe(canonicalRaw);
    expect(created.expectedFields).toEqual({
      title: 'Canonical row',
    });

    const rows = await listApprovedTruth({ limit: 25 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: legacy.id,
      rawText: canonicalRaw,
      expectedFields: {
        title: 'Canonical row',
      },
    });
  });

  it('autofills empty approved-truth rows from the local engine pipeline on first create', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText:
          'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
        expectedFields: {},
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as {
      expectedFields: Record<string, unknown>;
      coreTruth: Record<string, unknown>;
      expectedType: string | null;
      expectedStyle: string | null;
      pipelineMajor: number | null;
    };
    expect(created.expectedFields.title).toBe('A Mathematical Theory of Communication');
    expect(created.expectedFields.journal).toBe('Bell System Technical Journal');
    expect(created.expectedFields.year).toBe(1948);
    expect(created.coreTruth).toEqual(created.expectedFields);
    expect(created.expectedType).toBe('article-journal');
    expect(created.expectedStyle).toBe('apa7');
    expect(created.pipelineMajor).toBe(3);
  });

  it('requires audit reason for content-changing patches and records the reason', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Patch me.',
        expectedFields: {
          title: 'Patch me',
          year: '2020',
        },
        expectedStyle: 'apa7',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        approvalSource: 'manual',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string };

    const patchWithoutReason = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/approved-truth/${created.id}`,
      payload: {
        expectedFields: {
          title: 'Patched title',
          year: '2020',
        },
        reviewedBy: 'reviewer@example.com',
      },
    });
    expect(patchWithoutReason.statusCode).toBe(400);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/approved-truth/${created.id}`,
      payload: {
        expectedFields: {
          title: 'Patched title',
          year: '2020',
        },
        reviewedBy: 'reviewer@example.com',
        auditReasonCode: 'manual_correction',
      },
    });
    expect(patchResponse.statusCode).toBe(200);
    const patched = patchResponse.json() as {
      expectedFields: Record<string, unknown>;
      coreTruth: Record<string, unknown>;
      auditReasonCode?: string | null;
    };
    expect(patched.expectedFields).toEqual({
      title: 'Patched title',
      year: '2020',
    });
    expect(patched.coreTruth).toEqual({
      title: 'Patched title',
      year: '2020',
    });
    expect(patched.auditReasonCode).toBe('manual_correction');
  });

  it('syncs core truth from expected fields when drift exists', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Drift row.',
        expectedFields: {
          title: 'Drift row',
          year: '2020',
        },
        coreTruth: {
          title: 'Old core title',
          year: '2020',
        },
        expectedStyle: 'apa7',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        approvalSource: 'manual',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string; truthDrift?: { hasDrift?: boolean } };
    expect(created.truthDrift?.hasDrift).toBe(true);

    const syncResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/sync-core`,
      payload: {
        auditReasonCode: 'sync_expected_to_core',
        reviewedBy: 'reviewer@example.com',
      },
    });
    expect(syncResponse.statusCode).toBe(200);
    const synced = syncResponse.json() as {
      synced: boolean;
      truth: {
        coreTruth: Record<string, unknown>;
        expectedFields: Record<string, unknown>;
        auditReasonCode?: string | null;
        truthDrift?: { hasDrift?: boolean };
      };
    };
    expect(synced.synced).toBe(true);
    expect(synced.truth.coreTruth).toEqual(synced.truth.expectedFields);
    expect(synced.truth.auditReasonCode).toBe('sync_expected_to_core');
    expect(synced.truth.truthDrift?.hasDrift).toBe(false);
  });

  it('persists the approved-truth editor draft across reads until explicitly discarded', async () => {
    app = await buildApp();

    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/internal/admin/approved-truth/editor-draft',
      payload: {
        mode: 'edit',
        editingId: 'truth-row-123',
        rawText: 'Doe, J. (2024). Persistent draft example.',
        expectedFieldValues: {
          title: 'Persistent draft example',
          year: '2024',
          corrected_output: 'Doe, J. (2024). Persistent draft example.',
        },
        engineRenderedOutput: 'Doe, J. (2024). Persistent draft example.',
        enginePreviewWarnings: [],
        enginePreviewStale: false,
        expectedOutputDirty: false,
        expectedType: 'Journal Article',
        expectedStyle: 'APA 7th Edition',
        provenance: 'manual',
        pipelineMajor: '',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        blockedReason: '',
        goldKind: '',
        adversarialPair: '',
        noiseProfile: '',
        approvalSource: 'manual',
        reviewedBy: 'reviewer@example.com',
        notes: 'Persist this draft',
      },
    });

    expect(saveResponse.statusCode).toBe(200);
    const saved = saveResponse.json() as {
      durable: boolean;
      draft: {
        payload: {
          mode: 'create' | 'edit';
          rawText: string;
          expectedFieldValues: Record<string, string>;
          notes: string;
        };
      } | null;
    };
    expect(saved.draft?.payload.mode).toBe('edit');
    expect(saved.draft?.payload.rawText).toBe('Doe, J. (2024). Persistent draft example.');
    expect(saved.draft?.payload.expectedFieldValues.corrected_output).toBe(
      'Doe, J. (2024). Persistent draft example.',
    );
    expect(saved.draft?.payload.notes).toBe('Persist this draft');
    expect(typeof saved.durable).toBe('boolean');

    const getResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth/editor-draft',
    });
    expect(getResponse.statusCode).toBe(200);
    const loaded = getResponse.json() as {
      draft: {
        payload: {
          editingId?: string | null;
          expectedType: string;
        };
      } | null;
    };
    expect(loaded.draft?.payload.editingId).toBe('truth-row-123');
    expect(loaded.draft?.payload.expectedType).toBe('Journal Article');

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/internal/admin/approved-truth/editor-draft',
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({ ok: true, deleted: true });

    const getAfterDeleteResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth/editor-draft',
    });
    expect(getAfterDeleteResponse.statusCode).toBe(200);
    expect(getAfterDeleteResponse.json()).toMatchObject({ draft: null });
  });

  it('prefills approved-truth fields from the local engine pipeline', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/prefill',
      payload: {
        rawText:
          'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
        outputStyle: 'auto',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      expectedFields: Record<string, unknown>;
      coreTruth: Record<string, unknown>;
      expectedType: string | null;
      expectedStyle: string | null;
      pipelineMajor: number;
      referenceCount: number;
      usedReferenceIndex: number;
      fieldCount: number;
    };

    expect(payload.expectedFields.title).toBe('A Mathematical Theory of Communication');
    expect(payload.expectedFields.year).toBe(1948);
    expect(payload.expectedFields.journal).toBe('Bell System Technical Journal');
    expect(payload.expectedFields.authors).toEqual(['Shannon, C E']);
    expect(String(payload.expectedFields.corrected_output)).toContain('Shannon, C. E. (1948).');
    expect(String(payload.expectedFields.corrected_output)).toContain('Bell System Technical Journal');
    expect(payload.coreTruth).toEqual(payload.expectedFields);
    expect(payload.expectedType).toBe('article-journal');
    expect(payload.expectedStyle).toBe('apa7');
    expect(payload.pipelineMajor).toBe(3);
    expect(payload.referenceCount).toBe(1);
    expect(payload.usedReferenceIndex).toBe(0);
    expect(payload.fieldCount).toBeGreaterThanOrEqual(4);
  });

  it('prefills the reported conference citation without failing and includes the rendered output field', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/prefill',
      payload: {
        rawText:
          'Chiappa, C., Magni, J. F., Döll, C., & Le Gorrec, Y. (1998). Improvement of the robustness of an aircraft autopilot designed by an H∞ technique. In Proc Proc. CESA Conference.',
        outputStyle: 'auto',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      expectedFields: Record<string, unknown>;
      expectedType: string | null;
    };

    expect(payload.expectedType).toBe('conference-paper');
    expect(String(payload.expectedFields.corrected_output)).toContain('Chiappa, C., Magni, J. F., Döll, C., & Le Gorrec, Y. (1998).');
    expect(String(payload.expectedFields.corrected_output)).toContain('CESA Conference');
  });

  it('fills a truth row from Crossref DOI metadata', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/crossref-prefill',
      payload: {
        rawText: 'Smith, J. (2020). Placeholder citation. DOI: 10.1000/example-study',
        expectedFields: {},
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      expectedFields: Record<string, unknown>;
      coreTruth: Record<string, unknown>;
      expectedType: string | null;
      matchedDoi: string;
      fieldCount: number;
    };

    expect(payload.matchedDoi).toBe('10.1000/example-study');
    expect(payload.expectedType).toBe('article-journal');
    expect(payload.expectedFields.title).toBe('Example Study');
    expect(payload.expectedFields.doi).toBe('10.1000/example-study');
    expect(payload.expectedFields.journal).toBe('Journal of Examples');
    expect(payload.expectedFields.authors).toEqual(['Smith, J.']);
    expect(payload.coreTruth).toEqual(payload.expectedFields);
    expect(payload.fieldCount).toBeGreaterThanOrEqual(5);
  });

  it('renders an engine preview from approved-truth fields and style', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/render-preview',
      payload: {
        rawText:
          'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
        expectedFields: {
          authors: ['Shannon, C E'],
          title: 'A Mathematical Theory of Communication',
          year: 1948,
          journal: 'Bell System Technical Journal',
          volume: '27',
          issue: '3',
          pages: '379-423',
        },
        expectedType: 'article-journal',
        expectedStyle: 'apa7',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      renderedText: string;
      expectedStyle: string | null;
      expectedType: string | null;
      fieldCount: number;
      warningCodes: string[];
    };

    expect(payload.expectedStyle).toBe('apa7');
    expect(payload.expectedType).toBe('article-journal');
    expect(payload.fieldCount).toBeGreaterThanOrEqual(4);
    expect(payload.renderedText).toContain('Shannon, C. E. (1948).');
    expect(payload.renderedText).toContain('Bell System Technical Journal');
    expect(Array.isArray(payload.warningCodes)).toBe(true);
  });

  it('bulk refills approved-truth rows from the local engine pipeline and stores the result', async () => {
    app = await buildApp();

    const shannonCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText:
          'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
        expectedFields: { year: 1948 },
        coreTruth: { year: 1948 },
        expectedStyle: 'apa7',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(shannonCreate.statusCode).toBe(201);
    const shannonRow = shannonCreate.json() as { id: string };

    const bookCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText:
          'Greenblatt, Stephen. Introduction to Romeo and Juliet. The Norton Shakespeare. Ed. Stephen Greenblatt; Walter Cohen; Jean E. Howard and Katherine Eisaman Maus. London and New York: W. W. Norton; 1997; 865.',
        expectedFields: { year: '1997' },
        coreTruth: { year: '1997' },
        expectedStyle: 'mla9',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(bookCreate.statusCode).toBe(201);
    const bookRow = bookCreate.json() as { id: string };

    const bulkResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/prefill-bulk',
      payload: {
        ids: [shannonRow.id, bookRow.id],
      },
    });

    expect(bulkResponse.statusCode).toBe(200);
    const bulkPayload = bulkResponse.json() as {
      requestedCount: number;
      updatedCount: number;
      quarantinedCount: number;
      failedCount: number;
      results: Array<{ id: string; status: string; fieldCount: number }>;
    };
    expect(bulkPayload.requestedCount).toBe(2);
    expect(bulkPayload.updatedCount).toBe(2);
    expect(bulkPayload.quarantinedCount).toBe(0);
    expect(bulkPayload.failedCount).toBe(0);
    expect(bulkPayload.results.every((result) => result.status === 'updated')).toBe(true);
    expect(bulkPayload.results.every((result) => result.fieldCount > 1)).toBe(true);

    const shannonStored = await app.inject({
      method: 'GET',
      url: `/internal/admin/approved-truth/${shannonRow.id}`,
    });
    expect(shannonStored.statusCode).toBe(200);
    const shannonPayload = shannonStored.json() as {
      expectedFields: Record<string, unknown>;
      coreTruth: Record<string, unknown>;
      expectedStyle: string | null;
    };
    expect(shannonPayload.expectedFields.title).toBe('A Mathematical Theory of Communication');
    expect(shannonPayload.expectedFields.journal).toBe('Bell System Technical Journal');
    expect(shannonPayload.coreTruth).toEqual(shannonPayload.expectedFields);
    expect(shannonPayload.expectedStyle).toBe('apa7');

    const bookStored = await app.inject({
      method: 'GET',
      url: `/internal/admin/approved-truth/${bookRow.id}`,
    });
    expect(bookStored.statusCode).toBe(200);
    const bookPayload = bookStored.json() as {
      expectedFields: Record<string, unknown>;
      coreTruth: Record<string, unknown>;
      expectedStyle: string | null;
    };
    expect(bookPayload.expectedFields.year).toBe(1997);
    expect(Object.keys(bookPayload.expectedFields).length).toBeGreaterThan(1);
    expect(bookPayload.coreTruth).toEqual(bookPayload.expectedFields);
    expect(bookPayload.expectedStyle).toBe('mla9');
  });

  it('runs background Crossref fill for selected approved-truth rows and stores the result', async () => {
    app = await buildApp();

    const firstCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Placeholder citation. DOI: 10.1000/example-study',
        expectedFields: { year: 2020 },
        coreTruth: { year: 2020 },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(firstCreate.statusCode).toBe(201);
    const firstRow = firstCreate.json() as { id: string };

    const secondCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText:
          'Vaswani, A. et al. (2017). Attention Is All You Need. DOI: 10.1000/vaswani-2017-attention-is-all-you-need',
        expectedFields: { year: 2017 },
        coreTruth: { year: 2017 },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(secondCreate.statusCode).toBe(201);
    const secondRow = secondCreate.json() as { id: string };

    const skippedCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Greenblatt, Stephen. Introduction to Romeo and Juliet.',
        expectedFields: { year: '1997' },
        coreTruth: { year: '1997' },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(skippedCreate.statusCode).toBe(201);
    const skippedRow = skippedCreate.json() as { id: string };

    const jobStart = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/background-bulk',
      payload: {
        operation: 'crossref',
        ids: [firstRow.id, secondRow.id, skippedRow.id],
        pageSize: 2,
      },
    });

    expect(jobStart.statusCode).toBe(202);
    const jobPayload = jobStart.json() as { jobId: string };
    const job = await waitForTruthBackgroundJob(app, jobPayload.jobId);

    expect(job.status).toBe('completed');
    expect(job.totalRows).toBe(3);
    expect(job.updatedCount).toBe(2);
    expect(job.skippedCount).toBe(1);
    expect(job.failedCount).toBe(0);
    expect(job.recentCompletedPage).toBe(2);
    expect(job.recentResults).toHaveLength(1);
    expect(job.recentResults[0]?.id).toBe(skippedRow.id);

    const firstStored = await app.inject({
      method: 'GET',
      url: `/internal/admin/approved-truth/${firstRow.id}`,
    });
    expect(firstStored.statusCode).toBe(200);
    const firstPayload = firstStored.json() as { expectedFields: Record<string, unknown> };
    expect(firstPayload.expectedFields.title).toBe('Example Study');
    expect(firstPayload.expectedFields.doi).toBe('10.1000/example-study');
    expect(firstPayload.expectedFields.journal).toBe('Journal of Examples');

    const secondStored = await app.inject({
      method: 'GET',
      url: `/internal/admin/approved-truth/${secondRow.id}`,
    });
    expect(secondStored.statusCode).toBe(200);
    const secondPayload = secondStored.json() as {
      expectedFields: Record<string, unknown>;
      expectedType: string | null;
    };
    expect(secondPayload.expectedType).toBe('conference-paper');
    expect(secondPayload.expectedFields.conferenceTitle).toBe('Advances in Neural Information Processing Systems');
    expect(secondPayload.expectedFields.publisher).toBe('Curran Associates, Inc.');
  });

  it('bulk deletes approved-truth rows by selected ids', async () => {
    app = await buildApp();

    const firstCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Bulk delete row one.',
        expectedFields: { title: 'Bulk delete row one' },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(firstCreate.statusCode).toBe(201);
    const firstRow = firstCreate.json() as { id: string };

    const secondCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Bulk delete row two.',
        expectedFields: { title: 'Bulk delete row two' },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(secondCreate.statusCode).toBe(201);
    const secondRow = secondCreate.json() as { id: string };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/delete-bulk',
      payload: {
        ids: [firstRow.id, secondRow.id],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      requestedCount: number;
      deletedCount: number;
      failedCount: number;
      results: Array<{ id: string; status: string }>;
    };
    expect(payload.requestedCount).toBe(2);
    expect(payload.deletedCount).toBe(2);
    expect(payload.failedCount).toBe(0);
    expect(payload.results.every((result) => result.status === 'deleted')).toBe(true);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth',
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json() as { items: Array<{ id: string }> };
    expect(listPayload.items.some((row) => row.id === firstRow.id)).toBe(false);
    expect(listPayload.items.some((row) => row.id === secondRow.id)).toBe(false);
  });

  it('bulk certifies approved-truth rows and stores the certification state', async () => {
    app = await buildApp();

    const firstCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Bulk certify row one.',
        expectedFields: { title: 'Bulk certify row one' },
        expectedStyle: 'apa7',
        ...styleCertificationMetadata(),
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(firstCreate.statusCode).toBe(201);
    const firstRow = firstCreate.json() as { id: string };

    const secondCreate = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Bulk certify row two.',
        expectedFields: { title: 'Bulk certify row two' },
        expectedStyle: 'mla9',
        ...styleCertificationMetadata(),
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(secondCreate.statusCode).toBe(201);
    const secondRow = secondCreate.json() as { id: string };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/certify-bulk',
      payload: {
        ids: [firstRow.id, secondRow.id],
        task: 'style',
        truthScope: 'core',
        status: 'certified',
        certifiedBy: 'bulk-reviewer@example.com',
        requiredReviewPasses: 1,
        completedReviewPasses: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      requestedCount: number;
      certifiedCount: number;
      quarantinedCount: number;
      failedCount: number;
      results: Array<{ id: string; status: string }>;
    };
    expect(payload.requestedCount).toBe(2);
    expect(payload.certifiedCount).toBe(2);
    expect(payload.quarantinedCount).toBe(0);
    expect(payload.failedCount).toBe(0);
    expect(payload.results.every((result) => result.status === 'certified')).toBe(true);

    const storedResponse = await app.inject({
      method: 'GET',
      url: `/internal/admin/approved-truth/${firstRow.id}`,
    });
    expect(storedResponse.statusCode).toBe(200);
    const storedPayload = storedResponse.json() as {
      evidenceSnapshot: Record<string, unknown> | null;
      taskCertifications: Array<{
        task: string;
        truthScope: string;
        status: string;
        certifiedBy?: string | null;
      }> | null;
    };
    expect(storedPayload.evidenceSnapshot).not.toBeNull();
    expect(storedPayload.taskCertifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: 'style',
          truthScope: 'core',
          status: 'certified',
          certifiedBy: 'bulk-reviewer@example.com',
        }),
      ]),
    );
  });

  it('runs background engine refill across all filtered approved-truth pages', async () => {
    app = await buildApp();

    const citations = [
      {
        rawText:
          'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
        expectedStyle: 'apa7',
      },
      {
        rawText:
          'Greenblatt, Stephen. Introduction to Romeo and Juliet. The Norton Shakespeare. Ed. Stephen Greenblatt; Walter Cohen; Jean E. Howard and Katherine Eisaman Maus. London and New York: W. W. Norton; 1997; 865.',
        expectedStyle: 'mla9',
      },
      {
        rawText:
          'Tufte, Edward R. (1983). The Visual Display of Quantitative Information. Cheshire, CT: Graphics Press.',
        expectedStyle: 'apa7',
      },
    ];

    for (const citation of citations) {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/admin/approved-truth',
        payload: {
          rawText: citation.rawText,
          expectedFields: { year: 'seed-only' },
          coreTruth: { year: 'seed-only' },
          expectedStyle: citation.expectedStyle,
          datasetSplit: 'train',
          trustLevel: 'reviewed',
        },
      });
      expect(createResponse.statusCode).toBe(201);
    }

    const startResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/background-bulk',
      payload: {
        operation: 'prefill',
        pageSize: 2,
        filters: {
          trustLevel: 'reviewed',
          datasetSplit: 'train',
        },
      },
    });

    expect(startResponse.statusCode).toBe(202);
    const startPayload = startResponse.json() as { jobId: string; totalRows: number; totalPages: number };
    expect(startPayload.totalRows).toBe(3);
    expect(startPayload.totalPages).toBe(2);

    const finalJob = await waitForTruthBackgroundJob(app, startPayload.jobId);
    expect(finalJob.status).toBe('completed');
    expect(finalJob.completedPages).toBe(2);
    expect(finalJob.completedRows).toBe(3);
    expect(finalJob.updatedCount).toBe(3);
    expect(finalJob.quarantinedCount).toBe(0);
    expect(finalJob.failedCount).toBe(0);
    expect(finalJob.recentCompletedPage).toBe(2);
    expect(finalJob.recentResults).toHaveLength(1);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth?trustLevel=reviewed&datasetSplit=train&page=1&limit=25',
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json() as {
      items: Array<{ rawText: string; expectedFields: Record<string, unknown> }>;
    };
    const shannonRow = listPayload.items.find((row) => row.rawText.includes('A Mathematical Theory of Communication'));
    expect(shannonRow?.expectedFields.title).toBe('A Mathematical Theory of Communication');
    expect(shannonRow?.expectedFields.journal).toBe('Bell System Technical Journal');
  });
  it('runs background bulk jobs for a selected approved-truth page range', async () => {
    app = await buildApp();

    for (let index = 0; index < 5; index += 1) {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/admin/approved-truth',
        payload: {
          rawText: `Page range row ${index + 1}.`,
          expectedFields: { title: `Page range row ${index + 1}` },
          datasetSplit: 'train',
          trustLevel: 'reviewed',
        },
      });
      expect(createResponse.statusCode).toBe(201);
    }

    const firstPageResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth?trustLevel=reviewed&datasetSplit=train&page=1&limit=2',
    });
    expect(firstPageResponse.statusCode).toBe(200);
    const firstPagePayload = firstPageResponse.json() as { items: Array<{ id: string }> };
    const expectedRemainingIds = new Set(firstPagePayload.items.map((row) => row.id));

    const startResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/background-bulk',
      payload: {
        operation: 'delete',
        pageSize: 2,
        pageRange: {
          startPage: 2,
          endPage: 3,
        },
        filters: {
          trustLevel: 'reviewed',
          datasetSplit: 'train',
        },
      },
    });

    expect(startResponse.statusCode).toBe(202);
    const startPayload = startResponse.json() as { jobId: string; totalRows: number; totalPages: number };
    expect(startPayload.totalRows).toBe(3);
    expect(startPayload.totalPages).toBe(2);

    const finalJob = await waitForTruthBackgroundJob(app, startPayload.jobId);
    expect(finalJob.status).toBe('completed');
    expect(finalJob.completedPages).toBe(2);
    expect(finalJob.deletedCount).toBe(3);
    expect(finalJob.failedCount).toBe(0);

    const finalListResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth?trustLevel=reviewed&datasetSplit=train&page=1&limit=25',
    });
    expect(finalListResponse.statusCode).toBe(200);
    const finalListPayload = finalListResponse.json() as { total: number; items: Array<{ id: string }> };
    expect(finalListPayload.total).toBe(2);
    expect(new Set(finalListPayload.items.map((row) => row.id))).toEqual(expectedRemainingIds);
  });

  it('runs background delete across all filtered approved-truth pages', async () => {
    app = await buildApp();

    for (let index = 0; index < 5; index += 1) {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/admin/approved-truth',
        payload: {
          rawText: `Background delete row ${index + 1}.`,
          expectedFields: { title: `Background delete row ${index + 1}` },
          datasetSplit: 'train',
          trustLevel: 'reviewed',
        },
      });
      expect(createResponse.statusCode).toBe(201);
    }

    const startResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/background-bulk',
      payload: {
        operation: 'delete',
        pageSize: 2,
        filters: {
          trustLevel: 'reviewed',
          datasetSplit: 'train',
        },
      },
    });

    expect(startResponse.statusCode).toBe(202);
    const startPayload = startResponse.json() as { jobId: string; totalRows: number; totalPages: number };
    expect(startPayload.totalRows).toBe(5);
    expect(startPayload.totalPages).toBe(3);

    const finalJob = await waitForTruthBackgroundJob(app, startPayload.jobId);
    expect(finalJob.status).toBe('completed');
    expect(finalJob.completedPages).toBe(3);
    expect(finalJob.deletedCount).toBe(5);
    expect(finalJob.failedCount).toBe(0);
    expect(finalJob.recentCompletedPage).toBe(3);
    expect(finalJob.recentResults).toHaveLength(1);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/approved-truth?trustLevel=reviewed&datasetSplit=train&page=1&limit=25',
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload = listResponse.json() as { total: number; items: Array<{ id: string }> };
    expect(listPayload.total).toBe(0);
    expect(listPayload.items).toHaveLength(0);
  });

  it('runs background certification across all filtered approved-truth pages', async () => {
    app = await buildApp();

    let firstId = '';
    for (let index = 0; index < 4; index += 1) {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/admin/approved-truth',
        payload: {
          rawText: `Background certify row ${index + 1}.`,
          expectedFields: { title: `Background certify row ${index + 1}` },
          expectedStyle: index % 2 === 0 ? 'apa7' : 'mla9',
          ...styleCertificationMetadata(),
          datasetSplit: 'train',
          trustLevel: 'reviewed',
        },
      });
      expect(createResponse.statusCode).toBe(201);
      const row = createResponse.json() as { id: string };
      if (!firstId) {
        firstId = row.id;
      }
    }

    const startResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth/background-bulk',
      payload: {
        operation: 'certify',
        pageSize: 2,
        filters: {
          trustLevel: 'reviewed',
          datasetSplit: 'train',
        },
        certify: {
          task: 'style',
          truthScope: 'core',
          status: 'certified',
          certifiedBy: 'background-reviewer@example.com',
          requiredReviewPasses: 1,
          completedReviewPasses: 1,
        },
      },
    });

    expect(startResponse.statusCode).toBe(202);
    const startPayload = startResponse.json() as { jobId: string; totalRows: number; totalPages: number };
    expect(startPayload.totalRows).toBe(4);
    expect(startPayload.totalPages).toBe(2);

    const finalJob = await waitForTruthBackgroundJob(app, startPayload.jobId);
    expect(finalJob.status).toBe('completed');
    expect(finalJob.completedPages).toBe(2);
    expect(finalJob.certifiedCount).toBe(4);
    expect(finalJob.quarantinedCount).toBe(0);
    expect(finalJob.failedCount).toBe(0);
    expect(finalJob.recentCompletedPage).toBe(2);
    expect(finalJob.recentResults).toHaveLength(2);

    const storedResponse = await app.inject({
      method: 'GET',
      url: `/internal/admin/approved-truth/${firstId}`,
    });
    expect(storedResponse.statusCode).toBe(200);
    const storedPayload = storedResponse.json() as {
      taskCertifications: Array<{ task: string; truthScope: string; status: string; certifiedBy?: string | null }> | null;
      evidenceSnapshot: Record<string, unknown> | null;
    };
    expect(storedPayload.evidenceSnapshot).not.toBeNull();
    expect(storedPayload.taskCertifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: 'style',
          truthScope: 'core',
          status: 'certified',
          certifiedBy: 'background-reviewer@example.com',
        }),
      ]),
    );
  });

  it('enforces certified-only and quarantined export defaults', async () => {
    app = await buildApp();

    const uncertifiedResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Uncertified style row.',
        expectedFields: { title: 'Uncertified style row' },
        expectedStyle: 'apa7',
        ...styleCertificationMetadata(),
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(uncertifiedResponse.statusCode).toBe(201);

    const quarantinedResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Quarantined authority row.',
        expectedFields: { title: 'Quarantined authority row' },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'quarantined',
        blockedReason: 'needs_research',
      },
    });
    expect(quarantinedResponse.statusCode).toBe(201);

    const defaultExport = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false',
    });
    expect(defaultExport.statusCode).toBe(200);
    expect(parseNdjson(defaultExport.body)).toHaveLength(0);

    const uncertifiedAllowedExport = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false&certifiedOnly=false',
    });
    expect(uncertifiedAllowedExport.statusCode).toBe(200);
    const uncertifiedAllowedRows = parseNdjson(uncertifiedAllowedExport.body);
    expect(uncertifiedAllowedRows).toHaveLength(1);
    expect(uncertifiedAllowedRows[0]?.raw_text).toBe('Uncertified style row.');

    const quarantinedVisibleExport = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false&task=authority_pack&certifiedOnly=false&excludeQuarantined=false',
    });
    expect(quarantinedVisibleExport.statusCode).toBe(200);
    const quarantinedVisibleRows = parseNdjson(quarantinedVisibleExport.body);
    expect(quarantinedVisibleRows.some((row) => row.raw_text === 'Quarantined authority row.')).toBe(true);
  });

  it('promotes learning-queue rows into approved truth and records provenance on the queue item', async () => {
    app = await buildApp();

    const queueId = randomUUID();
    await saveLearningQueueItem({
      id: queueId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 10,
      processed: false,
      createdAt: new Date().toISOString(),
      trainingData: {
        rawInput: 'Doe, J. (2021). Queue example. Example Journal, 5(1), 10-12.',
      },
    });

    const promoteResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/learning-queue/${queueId}/promote`,
      payload: {
        expectedFields: {
          title: { value: ' Queue example ' },
          authors: {
            value: [{ family: 'Doe', given: 'Jane' }],
          },
          year: { value: 2021 },
        },
        datasetSplit: 'val',
        trustLevel: 'gold',
        rowStatus: 'reviewed',
        evidenceSnapshot: buildEvidenceSnapshot('Doe, J. (2021). Queue example. Example Journal, 5(1), 10-12.'),
        goldKind: 'style_clean',
        approvalSource: 'learning_queue',
        reviewedBy: 'reviewer@example.com',
        auditReasonCode: 'manual_correction',
      },
    });

    expect(promoteResponse.statusCode).toBe(200);
    const promoted = promoteResponse.json() as {
      truth: {
        id: string;
        expectedFields: Record<string, unknown>;
      };
    };
    expect(promoted.truth.expectedFields).toEqual({
      title: 'Queue example',
      authors: ['Doe, Jane'],
      year: 2021,
    });
    expect(promoted.truth.goldKind).toBe('style_clean');
    expect(promoted.truth.approvalSource).toBe('learning_queue');

    const queueRows = await listLearningQueue();
    const queueRow = queueRows.find((row) => row.id === queueId);
    expect(queueRow?.processed).toBe(true);
    expect(queueRow?.promotedToTruthId).toBe(promoted.truth.id);
  });

  it('groups duplicate learning-queue references and processes the full group after one promotion', async () => {
    app = await buildApp();

    const duplicateRaw =
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800.';
    const duplicateRawWithDoi =
      '22. Kumar A, Kini SG, Rathi E: A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021, 21:2788-800. 10.2174/1389557521666210401091147';
    const duplicateRawWithUrl =
      '22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800. Available at: https://example.org/kumar-admet';
    const firstQueueId = randomUUID();
    const secondQueueId = randomUUID();
    const thirdQueueId = randomUUID();

    await saveLearningQueueItem({
      id: firstQueueId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 1,
      processed: false,
      createdAt: '2026-04-23T00:00:00.000Z',
      trainingData: {
        rawInput: duplicateRawWithDoi,
      },
    });
    await saveLearningQueueItem({
      id: secondQueueId,
      citationId: '',
      jobId: '',
      source: 'user_edit',
      priority: 2,
      processed: false,
      createdAt: '2026-04-23T00:00:01.000Z',
      trainingData: {
        rawInput: duplicateRaw,
        fieldName: 'title',
        newValue:
          'A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery',
      },
    });
    await saveLearningQueueItem({
      id: thirdQueueId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 1,
      processed: false,
      createdAt: '2026-04-23T00:00:02.000Z',
      trainingData: {
        rawInput: duplicateRawWithUrl,
      },
    });

    const groupedQueueResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/learning-queue',
    });

    expect(groupedQueueResponse.statusCode).toBe(200);
    const groupedQueue = groupedQueueResponse.json() as Array<{
      id: string;
      duplicateCount?: number;
      groupedQueueIds?: string[];
      groupedSources?: string[];
      processed: boolean;
      trainingData: Record<string, unknown>;
    }>;
    expect(groupedQueue).toHaveLength(1);
    expect(groupedQueue[0]).toMatchObject({
      id: secondQueueId,
      duplicateCount: 3,
      groupedQueueIds: [secondQueueId, thirdQueueId, firstQueueId],
      groupedSources: ['user_edit', 'user_report'],
      processed: false,
      trainingData: {
        rawInput: duplicateRaw,
      },
    });

    const promoteResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/learning-queue/${secondQueueId}/promote`,
      payload: {
        expectedFields: {
          title: {
            value:
              'A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery',
          },
          authors: {
            value: [
              { family: 'Kumar', given: 'A' },
              { family: 'Kini', given: 'SG' },
              { family: 'Rathi', given: 'E' },
            ],
          },
        },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        approvalSource: 'learning_queue',
        reviewedBy: 'reviewer@example.com',
        auditReasonCode: 'manual_correction',
      },
    });

    expect(promoteResponse.statusCode).toBe(200);
    const promoted = promoteResponse.json() as {
      truth: { id: string };
    };

    const queueRows = await listLearningQueue();
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0]).toMatchObject({
      duplicateCount: 3,
      processed: true,
      promotedToTruthId: promoted.truth.id,
    });
    expect(queueRows[0]?.groupedQueueIds).toEqual(
      expect.arrayContaining([firstQueueId, secondQueueId, thirdQueueId]),
    );
    expect(queueRows[0]?.groupedQueueIds).toHaveLength(3);
    expect([firstQueueId, secondQueueId, thirdQueueId]).toContain(queueRows[0]?.id);
  });

  it('bulk promotes learning-queue rows with shared expected type and input style labels', async () => {
    app = await buildApp();

    const firstQueueId = randomUUID();
    const secondQueueId = randomUUID();
    await saveLearningQueueItem({
      id: firstQueueId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 3,
      processed: false,
      createdAt: '2026-04-23T00:00:00.000Z',
      trainingData: {
        rawInput: 'Smith A. Bulk queue title one. Journal A. 2020;1:1-2.',
        engineSnapshot: {
          fieldsPredicted: {
            title: 'Bulk queue title one',
            year: 2020,
          },
        },
      },
    });
    await saveLearningQueueItem({
      id: secondQueueId,
      citationId: '',
      jobId: '',
      source: 'user_edit',
      priority: 2,
      processed: false,
      createdAt: '2026-04-23T00:00:01.000Z',
      trainingData: {
        rawInput: 'Jones B. Bulk queue title two. Journal B. 2021;2:10-12.',
        engineSnapshot: {
          fieldsPredicted: {
            title: 'Bulk queue title two',
            year: 2021,
          },
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/learning-queue/promote-bulk',
      payload: {
        ids: [firstQueueId, secondQueueId],
        expectedType: 'article-journal',
        expectedStyle: 'vancouver',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        goldKind: 'style_clean',
        approvalSource: 'learning_queue',
        reviewedBy: 'reviewer@example.com',
        auditReasonCode: 'manual_correction',
        notes: 'bulk queue promote',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      requestedCount: number;
      promotedCount: number;
      quarantinedCount: number;
      failedCount: number;
      results: Array<{
        id: string;
        status: string;
        truthId?: string;
      }>;
    };
    expect(payload).toMatchObject({
      requestedCount: 2,
      promotedCount: 2,
      quarantinedCount: 0,
      failedCount: 0,
    });
    expect(payload.results.map((result) => result.status)).toEqual(['promoted', 'promoted']);

    const rows = await listApprovedTruth({ limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectedType: 'article-journal',
          expectedStyle: 'vancouver',
          expectedFields: expect.objectContaining({
            title: 'Bulk queue title one',
            year: 2020,
          }),
        }),
        expect.objectContaining({
          expectedType: 'article-journal',
          expectedStyle: 'vancouver',
          expectedFields: expect.objectContaining({
            title: 'Bulk queue title two',
            year: 2021,
          }),
        }),
      ]),
    );

    const queueRows = await listLearningQueue();
    expect(queueRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstQueueId,
          processed: true,
        }),
        expect.objectContaining({
          id: secondQueueId,
          processed: true,
        }),
      ]),
    );
  });

  it('bulk marks grouped learning-queue rows processed', async () => {
    app = await buildApp();

    const duplicateOneId = randomUUID();
    const duplicateTwoId = randomUUID();
    const uniqueId = randomUUID();
    await saveLearningQueueItem({
      id: duplicateOneId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 1,
      processed: false,
      createdAt: '2026-04-23T00:00:00.000Z',
      trainingData: {
        rawInput: '22. Bulk process duplicate one. Journal C. 2020;1:1-2. 10.1000/example-one',
      },
    });
    await saveLearningQueueItem({
      id: duplicateTwoId,
      citationId: '',
      jobId: '',
      source: 'user_edit',
      priority: 2,
      processed: false,
      createdAt: '2026-04-23T00:00:01.000Z',
      trainingData: {
        rawInput: 'Bulk process duplicate one. Journal C. 2020;1:1-2.',
      },
    });
    await saveLearningQueueItem({
      id: uniqueId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 1,
      processed: false,
      createdAt: '2026-04-23T00:00:02.000Z',
      trainingData: {
        rawInput: 'Bulk process unique row. Journal D. 2021;2:10-12.',
      },
    });

    const groupedResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/learning-queue',
    });

    expect(groupedResponse.statusCode).toBe(200);
    const groupedRows = groupedResponse.json() as Array<{
      id: string;
      duplicateCount?: number;
      processed: boolean;
    }>;
    expect(groupedRows).toHaveLength(2);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/learning-queue/process-bulk',
      payload: {
        ids: groupedRows.map((row) => row.id),
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      requestedCount: number;
      processedCount: number;
      failedCount: number;
      results: Array<{ id: string; status: string }>;
    };
    expect(payload).toMatchObject({
      requestedCount: 2,
      processedCount: 2,
      failedCount: 0,
    });
    expect(payload.results.every((result) => result.status === 'processed')).toBe(true);

    const queueRows = await listLearningQueue();
    expect(queueRows).toHaveLength(2);
    expect(queueRows.every((row) => row.processed)).toBe(true);
  });

  it('reverts grouped processed learning-queue rows to pending without deleting approved truth', async () => {
    app = await buildApp();

    const duplicateOneId = randomUUID();
    const duplicateTwoId = randomUUID();
    const truthId = randomUUID();
    await upsertApprovedTruthPayload({
      id: truthId,
      rawText: 'Processed duplicate reference. Journal C. 2020;1:1-2.',
      expectedFields: { title: 'Processed duplicate reference' },
      trustLevel: 'reviewed',
      rowStatus: 'reviewed',
      approvalSource: 'learning_queue',
    });
    await saveLearningQueueItem({
      id: duplicateOneId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 1,
      processed: true,
      promotedToTruthId: truthId,
      createdAt: '2026-04-23T00:00:00.000Z',
      trainingData: {
        rawInput: '1. Processed duplicate reference. Journal C. 2020;1:1-2. 10.1000/example-one',
      },
    });
    await saveLearningQueueItem({
      id: duplicateTwoId,
      citationId: '',
      jobId: '',
      source: 'user_edit',
      priority: 2,
      processed: true,
      promotedToTruthId: truthId,
      createdAt: '2026-04-23T00:00:01.000Z',
      trainingData: {
        rawInput: 'Processed duplicate reference. Journal C. 2020;1:1-2.',
      },
    });

    const groupedRows = await listLearningQueue();
    expect(groupedRows).toHaveLength(1);
    expect(groupedRows[0]).toMatchObject({
      processed: true,
      duplicateCount: 2,
      promotedToTruthId: truthId,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/learning-queue/revert-bulk',
      payload: {
        ids: [groupedRows[0]!.id],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      requestedCount: number;
      revertedCount: number;
      failedCount: number;
      results: Array<{ status: string }>;
    };
    expect(payload).toMatchObject({
      requestedCount: 1,
      revertedCount: 1,
      failedCount: 0,
    });
    expect(payload.results).toEqual([expect.objectContaining({ status: 'reverted' })]);

    const revertedQueueRows = await listLearningQueue();
    expect(revertedQueueRows).toHaveLength(1);
    expect(revertedQueueRows[0]).toMatchObject({
      processed: false,
      duplicateCount: 2,
      promotedToTruthId: null,
    });
    const approvedTruthRows = await listApprovedTruth({ limit: 25 });
    expect(approvedTruthRows.map((row) => row.id)).toContain(truthId);
  });

  it('merges numbered learning-queue promotion into an existing approved-truth row', async () => {
    app = await buildApp();

    const canonicalRaw =
      'Kumar, A., Kini, S. G., & Rathi, E. (2021). A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Reviews in Medicinal Chemistry, 21(18), 2788-2800.';
    const existing = await upsertApprovedTruthPayload({
      rawText: canonicalRaw,
      expectedFields: { title: 'Existing canonical row' },
      expectedStyle: 'apa7',
      trustLevel: 'reviewed',
      rowStatus: 'reviewed',
      approvalSource: 'manual',
    });

    const queueId = randomUUID();
    await saveLearningQueueItem({
      id: queueId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 1,
      processed: false,
      createdAt: '2026-04-23T00:00:00.000Z',
      trainingData: {
        rawInput: `22. ${canonicalRaw}`,
      },
    });

    const promoteResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/learning-queue/${queueId}/promote`,
      payload: {
        expectedFields: {
          title: {
            value:
              'A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery',
          },
        },
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        approvalSource: 'learning_queue',
        reviewedBy: 'reviewer@example.com',
        auditReasonCode: 'manual_correction',
      },
    });

    expect(promoteResponse.statusCode).toBe(200);
    const promoted = promoteResponse.json() as {
      truth: {
        id: string;
        rawText: string;
        expectedFields: Record<string, unknown>;
      };
    };
    expect(promoted.truth.id).toBe(existing.id);
    expect(promoted.truth.rawText).toBe(canonicalRaw);
    expect(promoted.truth.expectedFields).toEqual({
      title:
        'A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery',
    });

    const queueRows = await listLearningQueue();
    expect(queueRows[0]).toMatchObject({
      id: queueId,
      processed: true,
      promotedToTruthId: existing.id,
    });

    const rows = await listApprovedTruth({ limit: 25 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: existing.id,
      rawText: canonicalRaw,
      expectedFields: {
        title:
          'A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery',
      },
    });
  });

  it('autofills empty promoted learning-queue rows from the local engine pipeline on first approved-truth save', async () => {
    app = await buildApp();

    const queueId = randomUUID();
    await saveLearningQueueItem({
      id: queueId,
      citationId: '',
      jobId: '',
      source: 'user_report',
      priority: 10,
      processed: false,
      createdAt: new Date().toISOString(),
      trainingData: {
        rawInput:
          'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.',
      },
    });

    const promoteResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/learning-queue/${queueId}/promote`,
      payload: {
        expectedFields: {},
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        approvalSource: 'learning_queue',
        reviewedBy: 'reviewer@example.com',
        auditReasonCode: 'manual_correction',
      },
    });

    expect(promoteResponse.statusCode).toBe(200);
    const promoted = promoteResponse.json() as {
      truth: {
        expectedFields: Record<string, unknown>;
        coreTruth: Record<string, unknown>;
        expectedType: string | null;
        expectedStyle: string | null;
      };
    };
    expect(promoted.truth.expectedFields.title).toBe('A Mathematical Theory of Communication');
    expect(promoted.truth.expectedFields.journal).toBe('Bell System Technical Journal');
    expect(promoted.truth.expectedFields.year).toBe(1948);
    expect(promoted.truth.coreTruth).toEqual(promoted.truth.expectedFields);
    expect(promoted.truth.expectedType).toBe('article-journal');
    expect(promoted.truth.expectedStyle).toBe('apa7');
  });

  it('requires holdoutVersion for holdout split rows', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Holdout without version.',
        expectedFields: { title: 'Holdout without version' },
        datasetSplit: 'holdout',
        trustLevel: 'reviewed',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('holdoutVersion');
  });

  it('requires blockedReason when rowStatus is quarantined', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Quarantine without reason.',
        expectedFields: { title: 'Quarantine without reason' },
        trustLevel: 'reviewed',
        rowStatus: 'quarantined',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('blockedReason');
  });

  it('filters approved truth exports by style, gold kind, and adversarial pair', async () => {
    app = await buildApp();

    await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Example study.',
        expectedFields: { title: 'Example study' },
        expectedStyle: 'apa7',
        ...styleCertificationMetadata(),
        datasetSplit: 'train',
        trustLevel: 'gold',
        rowStatus: 'reviewed',
        taskCertifications: buildTaskCertification('style'),
        evidenceSnapshot: buildEvidenceSnapshot('Smith, J. (2020). Example study.'),
        goldKind: 'style_adversarial',
        adversarialPair: 'apa7_vs_harvard-ctr',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: '[1] Example numeric reference.',
        expectedFields: { title: 'Example numeric reference' },
        expectedStyle: 'vancouver',
        ...styleCertificationMetadata(),
        datasetSplit: 'train',
        trustLevel: 'gold',
        rowStatus: 'reviewed',
        taskCertifications: buildTaskCertification('style'),
        evidenceSnapshot: buildEvidenceSnapshot('[1] Example numeric reference.'),
        goldKind: 'style_clean',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false&expectedStyle=apa7&goldKind=style_adversarial&adversarialPair=apa7_vs_harvard-ctr',
    });

    expect(response.statusCode).toBe(200);
    const lines = parseNdjson(response.body);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.expected_style).toBe('apa7');
    expect(lines[0]?.gold_kind).toBe('style_adversarial');
    expect(lines[0]?.adversarial_pair).toBe('apa7_vs_harvard-ctr');
  });

  it('certifies task-scoped truth when lint and pass requirements are satisfied', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Certify me.',
        expectedFields: { title: 'Certify me', year: '2020' },
        expectedStyle: 'apa7',
        ...styleCertificationMetadata(),
        expectedType: 'article-journal',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        reviewedBy: 'reviewer@example.com',
        evidenceSnapshot: buildEvidenceSnapshot('Smith, J. (2020). Certify me.'),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string };

    const certifyResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/certify`,
      payload: {
        task: 'style',
        truthScope: 'core',
        status: 'certified',
        requiredReviewPasses: 1,
        completedReviewPasses: 1,
        certifiedBy: 'admin@example.com',
      },
    });

    expect(certifyResponse.statusCode).toBe(200);
    const certifyPayload = certifyResponse.json() as {
      ok: boolean;
      stagedPack?: { packTarget: string; stagedBundleId: string; rowCount: number };
      truth: { taskCertifications?: Array<Record<string, unknown>> };
    };
    expect(certifyPayload.ok).toBe(true);
    expect(certifyPayload.stagedPack).toMatchObject({
      packTarget: 'style_core_gold',
      rowCount: 1,
    });
    expect(
      certifyPayload.truth.taskCertifications?.some(
        (entry) =>
          entry.task === 'style'
          && entry.truthScope === 'core'
          && entry.status === 'certified'
          && entry.packTarget === 'style_core_gold'
          && typeof entry.stagedBundleId === 'string',
      ),
    ).toBe(true);

    const stagedPackResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/training-packs/approved_overlay_changes/build',
    });
    expect(stagedPackResponse.statusCode).toBe(200);
    const stagedPackPayload = stagedPackResponse.json() as {
      manifest: { packTarget: string; rowCount: number };
    };
    expect(stagedPackPayload.manifest).toMatchObject({
      packTarget: 'approved_overlay_changes',
      rowCount: 0,
    });
  });

  it('auto-quarantines rows when blind second-pass hashes conflict', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Conflict case.',
        expectedFields: { title: 'Conflict case', year: '2020' },
        expectedStyle: 'apa7',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        reviewedBy: 'reviewer@example.com',
        evidenceSnapshot: buildEvidenceSnapshot('Smith, J. (2020). Conflict case.'),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string };

    const pass1Response = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/certify`,
      payload: {
        task: 'field',
        truthScope: 'core',
        status: 'candidate',
        requiredReviewPasses: 2,
        completedReviewPasses: 1,
        decisionHash: 'pass-one-hash',
      },
    });
    expect(pass1Response.statusCode).toBe(200);

    const pass2Response = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/certify`,
      payload: {
        task: 'field',
        truthScope: 'core',
        status: 'candidate',
        requiredReviewPasses: 2,
        completedReviewPasses: 2,
        decisionHash: 'pass-two-hash',
      },
    });
    expect(pass2Response.statusCode).toBe(409);
    const pass2Payload = pass2Response.json() as {
      ok: boolean;
      reason: string;
      truth: { rowStatus?: string; blockedReason?: string };
    };
    expect(pass2Payload.ok).toBe(false);
    expect(pass2Payload.reason).toBe('review_conflict');
    expect(pass2Payload.truth.rowStatus).toBe('quarantined');
    expect(pass2Payload.truth.blockedReason).toBe('review_conflict');
  });

  it('hydrates an evidence snapshot during certification when the row has none yet', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Missing evidence.',
        expectedFields: { title: 'Missing evidence', year: '2020' },
        expectedStyle: 'apa7',
        ...styleCertificationMetadata(),
        datasetSplit: 'train',
        trustLevel: 'reviewed',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string };

    const certifyResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/certify`,
      payload: {
        task: 'style',
        truthScope: 'core',
        status: 'certified',
        requiredReviewPasses: 1,
        completedReviewPasses: 1,
      },
    });

    expect(certifyResponse.statusCode).toBe(200);
    const certifyPayload = certifyResponse.json() as {
      ok: boolean;
      truth: {
        evidenceSnapshot: Record<string, unknown> | null;
      };
    };
    expect(certifyPayload.ok).toBe(true);
    expect(certifyPayload.truth.evidenceSnapshot).not.toBeNull();
  });

  it('rejects core certification for overlay_only inferability fields', async () => {
    app = await buildApp();

    const rawText = 'Smith, J. (2020). Overlay-only field.';
    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText,
        expectedFields: { title: 'Overlay-only field', year: '2020' },
        expectedStyle: 'apa7',
        ...styleCertificationMetadata(),
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        inferabilityByField: {
          title: 'overlay_only',
        },
        evidenceSnapshot: buildEvidenceSnapshot(rawText),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string };

    const certifyResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/certify`,
      payload: {
        task: 'field',
        truthScope: 'core',
        status: 'certified',
        requiredReviewPasses: 1,
        completedReviewPasses: 1,
      },
    });

    expect(certifyResponse.statusCode).toBe(409);
    expect(certifyResponse.body).toContain('inferability_conflict');
  });

  it('supports datasetVersion filtering and reports freeze gate failures when quotas are unmet', async () => {
    app = await buildApp();

    const basePayload = {
      expectedFields: { title: 'Dataset version row', year: '2020' },
      expectedStyle: 'apa7',
      expectedType: 'article-journal',
      datasetSplit: 'train',
      trustLevel: 'gold',
      rowStatus: 'reviewed',
      taskCertifications: buildTaskCertification('style'),
      evidenceSnapshot: buildEvidenceSnapshot('Smith, J. (2020). Dataset version row.'),
      goldKind: 'style_clean',
      ...styleCertificationMetadata(),
    };

    const rowV1 = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Dataset version row A.',
        ...basePayload,
        datasetVersion: 'style-core-v1',
      },
    });
    expect(rowV1.statusCode).toBe(201);

    const rowV2 = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Smith, J. (2020). Dataset version row B.',
        ...basePayload,
        datasetVersion: 'style-core-v2',
      },
    });
    expect(rowV2.statusCode).toBe(201);

    const exportV1 = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false&task=style&truthScope=core&datasetVersion=style-core-v1',
    });
    expect(exportV1.statusCode).toBe(200);
    const linesV1 = parseNdjson(exportV1.body);
    expect(linesV1).toHaveLength(1);
    expect(linesV1[0]?.dataset_version).toBe('style-core-v1');

    const freezeListBefore = await app.inject({
      method: 'GET',
      url: '/internal/admin/gold-datasets',
    });
    expect(freezeListBefore.statusCode).toBe(200);
    const freezeListPayload = freezeListBefore.json() as { total: number };
    expect(freezeListPayload.total).toBe(0);

    const freezeResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/gold-datasets/freeze',
      payload: {
        datasetVersion: 'style-core-freeze-unmet',
      },
    });
    expect(freezeResponse.statusCode).toBe(409);
    const freezePayload = freezeResponse.json() as {
      ok: boolean;
      failures: Array<{ code: string }>;
    };
    expect(freezePayload.ok).toBe(false);
    expect(freezePayload.failures.some((entry) => entry.code === 'STYLE_CORE_TOTAL_MISMATCH')).toBe(true);

    const freezeGetMissing = await app.inject({
      method: 'GET',
      url: '/internal/admin/gold-datasets/style-core-freeze-unmet',
    });
    expect(freezeGetMissing.statusCode).toBe(404);
  });

  it('manages linked render variants separately from canonical style/core export', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/approved-truth',
      payload: {
        rawText: 'Shannon, C. E. (1948). A mathematical theory of communication. Bell System Technical Journal, 27(3), 379-423.',
        expectedFields: {
          authors: ['Shannon, Claude E.'],
          title: 'A mathematical theory of communication',
          journal: 'Bell System Technical Journal',
          year: '1948',
          volume: '27',
          issue: '3',
          pages: '379-423',
        },
        expectedType: 'article-journal',
        expectedStyle: 'apa7',
        datasetSplit: 'train',
        datasetVersion: 'render-variant-v1',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        taskCertifications: buildTaskCertification('style'),
        evidenceSnapshot: buildEvidenceSnapshot('Shannon, C. E. (1948). A mathematical theory of communication.'),
        goldKind: 'style_clean',
        ...styleCertificationMetadata(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string };

    const generateResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/render-variants/generate`,
      payload: {},
    });
    expect(generateResponse.statusCode).toBe(200);
    const generatedPayload = generateResponse.json() as {
      items: Array<{ style: string; sourceKind: string; approvalStatus: string; datasetLane: string }>;
    };
    expect(generatedPayload.items).toHaveLength(6);
    expect(new Set(generatedPayload.items.map((item) => item.style)).size).toBe(6);
    expect(generatedPayload.items.every((item) => item.sourceKind === 'generated')).toBe(true);
    expect(generatedPayload.items.every((item) => item.datasetLane === 'augmentation')).toBe(true);

    const patchVariantResponse = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/approved-truth/${created.id}/render-variants/ieee`,
      payload: {
        renderedText:
          '[1] C. E. Shannon, "A mathematical theory of communication," Bell System Technical Journal, vol. 27, no. 3, pp. 379-423, 1948.',
        notes: 'Admin corrected IEEE punctuation.',
      },
    });
    expect(patchVariantResponse.statusCode).toBe(200);

    const approveVariantResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/render-variants/ieee/approve`,
      payload: {
        approved: true,
        approvedBy: 'reviewer@example.com',
      },
    });
    expect(approveVariantResponse.statusCode).toBe(200);

    const listVariantsResponse = await app.inject({
      method: 'GET',
      url: `/internal/admin/approved-truth/${created.id}/render-variants`,
    });
    expect(listVariantsResponse.statusCode).toBe(200);
    const listVariantsPayload = listVariantsResponse.json() as {
      items: Array<{
        style: string;
        sourceKind: string;
        approvalStatus: string;
        renderedText: string;
        stale: boolean;
      }>;
    };
    const ieeeVariant = listVariantsPayload.items.find((item) => item.style === 'ieee');
    expect(ieeeVariant).toMatchObject({
      style: 'ieee',
      sourceKind: 'admin_authored',
      approvalStatus: 'approved',
      stale: false,
    });
    expect(ieeeVariant?.renderedText).toContain('[1] C. E. Shannon');

    const defaultVariantExport = await app.inject({
      method: 'GET',
      url: '/internal/admin/render-variant-export?download=false&datasetVersion=render-variant-v1',
    });
    expect(defaultVariantExport.statusCode).toBe(200);
    const defaultVariantLines = parseNdjson(defaultVariantExport.body);
    expect(defaultVariantLines).toHaveLength(1);
    expect(defaultVariantLines[0]).toMatchObject({
      truth_row_id: created.id,
      render_style: 'ieee',
      dataset_lane: 'augmentation',
      input_style_label: 'apa7',
      stale: false,
    });

    const canonicalExportResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-export?download=false&task=style&truthScope=core&datasetVersion=render-variant-v1',
    });
    expect(canonicalExportResponse.statusCode).toBe(200);
    const canonicalExportLines = parseNdjson(canonicalExportResponse.body);
    expect(canonicalExportLines).toHaveLength(1);
    expect(canonicalExportLines[0]?.expected_style).toBe('apa7');

    const patchCanonicalResponse = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/approved-truth/${created.id}`,
      payload: {
        rawText: 'Shannon, C. E. (1948). A mathematical theory of communication. Bell System Technical Journal, 27(3), 379-423.',
        expectedFields: {
          authors: ['Shannon, Claude E.'],
          title: 'The mathematical theory of communication',
          journal: 'Bell System Technical Journal',
          year: '1948',
          volume: '27',
          issue: '3',
          pages: '379-423',
        },
        coreTruth: {
          authors: ['Shannon, Claude E.'],
          title: 'The mathematical theory of communication',
          journal: 'Bell System Technical Journal',
          year: '1948',
          volume: '27',
          issue: '3',
          pages: '379-423',
        },
        expectedType: 'article-journal',
        expectedStyle: 'apa7',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        auditReasonCode: 'manual_correction',
      },
    });
    expect(patchCanonicalResponse.statusCode).toBe(200);

    const staleVariantExport = await app.inject({
      method: 'GET',
      url: '/internal/admin/render-variant-export?download=false&datasetVersion=render-variant-v1',
    });
    expect(staleVariantExport.statusCode).toBe(200);
    expect(parseNdjson(staleVariantExport.body)).toHaveLength(0);

    const staleVariantVisibleExport = await app.inject({
      method: 'GET',
      url: '/internal/admin/render-variant-export?download=false&datasetVersion=render-variant-v1&approvedOnly=false&includeStale=true',
    });
    expect(staleVariantVisibleExport.statusCode).toBe(200);
    const staleVariantLines = parseNdjson(staleVariantVisibleExport.body);
    expect(staleVariantLines).toHaveLength(6);
    expect(staleVariantLines.every((line) => line.stale === true)).toBe(true);

    const resetVariantResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/render-variants/ieee/reset`,
    });
    expect(resetVariantResponse.statusCode).toBe(200);
    const resetVariantPayload = resetVariantResponse.json() as {
      item: {
        renderedText: string;
        generatedText: string;
      };
    };
    expect(resetVariantPayload.item.generatedText).toContain('The mathematical theory of communication');
    expect(resetVariantPayload.item.renderedText).toContain('The mathematical theory of communication');

    const reapproveVariantResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/approved-truth/${created.id}/render-variants/ieee/approve`,
      payload: {
        approved: true,
        approvedBy: 'reviewer@example.com',
      },
    });
    expect(reapproveVariantResponse.statusCode).toBe(200);

    const exportAfterReset = await app.inject({
      method: 'GET',
      url: '/internal/admin/render-variant-export?download=false&datasetVersion=render-variant-v1',
    });
    expect(exportAfterReset.statusCode).toBe(200);
    const exportAfterResetLines = parseNdjson(exportAfterReset.body);
    expect(exportAfterResetLines).toHaveLength(1);
    expect(exportAfterResetLines[0]).toMatchObject({
      render_style: 'ieee',
      source_kind: 'generated',
      approval_status: 'approved',
      stale: false,
    });
  });

  it('reports training status and can build and promote a local style bundle from gold truth', async () => {
    app = await buildApp();
    const styleGoldPath = resolve(artifactOverrideRoot!, 'training', 'style_gold.jsonl');
    const currentStyleBundlePath = resolve(artifactOverrideRoot!, 'models', 'style-model', 'current', 'style_model.json');
    const benchmarkResultsRoot = resolve(artifactOverrideRoot!, 'benchmarks', 'local');
    styleGoldExisted = await readFile(styleGoldPath, 'utf8').then(() => true).catch(() => false);
    currentStyleBundleExisted = await readFile(currentStyleBundlePath, 'utf8').then(() => true).catch(() => false);
    restoreStyleGold = styleGoldExisted ? await readFile(styleGoldPath, 'utf8') : null;
    restoreCurrentStyleBundle = currentStyleBundleExisted ? await readFile(currentStyleBundlePath, 'utf8') : null;

    await mkdir(benchmarkResultsRoot, { recursive: true });
    await writeFile(
      resolve(benchmarkResultsRoot, 'full.current-runtime.full_canonical.parallel.benchmark_test.median_2026-04-22T17-30-06-292Z.json'),
      JSON.stringify(
        {
          benchmarkVariant: 'full_canonical.parallel',
          profile: 'full',
          hardwareProfile: 'benchmark_test',
          iterations: 3,
          throughput_refs_per_sec: {
            median: 79,
            best: 79.57,
            worst: 75.44,
          },
          field_hash_stable: true,
          contract_hash_stable: true,
        },
        null,
        2,
      ),
      'utf8',
    );

    const rows = [
      { rawText: 'Smith, J. A. (2020). Example study. Journal of Testing, 5(2), 10-12.', expectedStyle: 'apa7', title: 'Example study' },
      { rawText: 'Smith JA (2020) Example study. Journal of Testing. 5(2):10-12.', expectedStyle: 'harvard-ctr', title: 'Example study' },
      { rawText: '[1] J. Smith, \"Example study,\" Journal of Testing, vol. 5, no. 2, pp. 10-12, 2020.', expectedStyle: 'ieee', title: 'Example study' },
      { rawText: '1. Smith J. Example study. Journal of Testing. 2020;5(2):10-12.', expectedStyle: 'vancouver', title: 'Example study' },
      { rawText: 'Smith, Jane. “Example Study.” Journal of Testing 5.2 (2020): 10-12.', expectedStyle: 'mla9', title: 'Example Study' },
      { rawText: 'Smith, Jane. “Example Study.” Journal of Testing 5, no. 2 (2020): 10-12.', expectedStyle: 'chicago-notes-bib', title: 'Example Study' },
    ];

    for (const row of rows) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/admin/approved-truth',
        payload: {
          rawText: row.rawText,
          expectedFields: { title: row.title },
          expectedStyle: row.expectedStyle,
          ...styleCertificationMetadata(),
          datasetSplit: 'train',
          trustLevel: 'gold',
          rowStatus: 'reviewed',
          taskCertifications: buildTaskCertification('style'),
          evidenceSnapshot: buildEvidenceSnapshot(row.rawText),
          goldKind: 'style_clean',
        },
      });
      expect(response.statusCode).toBe(201);
    }

    const statusResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/training-status',
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload = statusResponse.json() as {
      truth: { total: number; byStyle: Record<string, number> };
      styleBundle: { stagedVersions: string[] };
      benchmark: {
        latestCanonicalParallel: {
          medianRefsPerSec: number | null;
          fieldHashStable: boolean | null;
          contractHashStable: boolean | null;
        } | null;
      } | null;
    };
    expect(statusPayload.truth.total).toBe(rows.length);
    expect(statusPayload.truth.byStyle.apa7).toBe(1);
    expect(statusPayload.benchmark?.latestCanonicalParallel?.medianRefsPerSec).toBe(79);
    expect(statusPayload.benchmark?.latestCanonicalParallel?.fieldHashStable).toBe(true);
    expect(statusPayload.benchmark?.latestCanonicalParallel?.contractHashStable).toBe(true);

    const buildResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/style-bundle/build',
      payload: { version: 'test-style-bundle-route' },
    });
    expect(buildResponse.statusCode).toBe(200);
    const buildPayload = buildResponse.json() as {
      version: string;
      exportSummary: { rowCount: number };
      trainer: { modelVersion: string; outputPath: string };
    };
    expect(buildPayload.version).toBe('test-style-bundle-route');
    expect(buildPayload.exportSummary.rowCount).toBe(rows.length);
    expect(buildPayload.trainer.modelVersion).toBe('test-style-bundle-route');

    const promoteResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/style-bundle/promote',
      payload: { version: 'test-style-bundle-route' },
    });
    expect(promoteResponse.statusCode).toBe(200);
    const promotePayload = promoteResponse.json() as {
      version: string;
      styleBundle: { current: { modelVersion: string | null } | null };
    };
    expect(promotePayload.version).toBe('test-style-bundle-route');
    expect(promotePayload.styleBundle.current?.modelVersion).toBe('test-style-bundle-route');
  }, STYLE_BUNDLE_ROUTE_TEST_TIMEOUT_MS);

  it('reports BIO training status, builds a staged BIO bundle, and promotes it once structural gates pass', async () => {
    app = await buildApp();
    const processedRoot = resolve(artifactOverrideRoot!, 'datasets', 'citation-bio', 'processed');
    const datasetFileName = 'citation_bio_v1_sample.jsonl';
    await mkdir(processedRoot, { recursive: true });
    await writeFile(
      resolve(processedRoot, datasetFileName),
      [
        JSON.stringify({
          id: 'ref_000001',
          raw_reference: 'Smith J, Doe A. Example Article. Journal of Testing. 2024;12(4):123-145. doi:10.1000/test',
          tokens: ['Smith', 'J', ',', 'Doe', 'A', '.', 'Example', 'Article', '.', 'Journal', 'of', 'Testing', '.', '2024', ';', '12', '(', '4', ')', ':', '123-145', '.', 'doi', ':', '10.1000/test'],
          bio_tags: ['B-author', 'I-author', 'I-author', 'I-author', 'I-author', 'O', 'B-title', 'I-title', 'O', 'B-journal', 'I-journal', 'I-journal', 'O', 'B-year', 'O', 'B-volume', 'O', 'B-issue', 'O', 'O', 'B-pages', 'O', 'O', 'O', 'B-doi'],
          dataset_split: 'train',
        }),
        JSON.stringify({
          id: 'ref_000002',
          raw_reference: 'World Health Organization. World malaria report 2023. Available at: https://example.org/report',
          tokens: ['World', 'Health', 'Organization', '.', 'World', 'malaria', 'report', '2023', '.', 'Available', 'at', ':', 'https://example.org/report'],
          bio_tags: ['B-author', 'I-author', 'I-author', 'O', 'B-title', 'I-title', 'I-title', 'I-title', 'O', 'O', 'O', 'O', 'B-url'],
          dataset_split: 'val',
        }),
      ].join('\n'),
      'utf8',
    );

    const statusResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/bio-training-status',
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload = statusResponse.json() as {
      datasets: {
        availableDatasets: Array<{ fileName: string; rowCount: number }>;
      };
      bundle: {
        stagedVersions: string[];
        current: { modelVersion: string | null; datasetSource: string | null } | null;
      };
    };
    expect(statusPayload.datasets.availableDatasets[0]?.fileName).toBe(datasetFileName);
    expect(statusPayload.datasets.availableDatasets[0]?.rowCount).toBe(2);
    expect(statusPayload.bundle.stagedVersions).toEqual([]);

    const buildResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/bio-bundle/build',
      payload: {
        version: 'test-bio-bundle-route',
        datasetFile: datasetFileName,
      },
    });
    expect(buildResponse.statusCode).toBe(200);
    const buildPayload = buildResponse.json() as {
      version: string;
      datasetFile: string;
      trainer: { modelVersion: string; datasetStats: { total: number } };
      bioBundle: { stagedVersions: string[] };
    };
    expect(buildPayload.version).toBe('test-bio-bundle-route');
    expect(buildPayload.datasetFile).toBe(datasetFileName);
    expect(buildPayload.trainer.modelVersion).toBe('test-bio-bundle-route');
    expect(buildPayload.trainer.datasetStats.total).toBe(2);
    expect(buildPayload.bioBundle.stagedVersions).toContain('test-bio-bundle-route');

    // Promotion now blocks ONLY on structural checks (valid BIO token-classifier with training
    // rows). The eval/shadow/benchmark checks are advisory under the manual-verification workflow,
    // so a freshly-built valid bundle promotes without shadow history.
    const promoteResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/bio-bundle/promote',
      payload: { version: 'test-bio-bundle-route' },
    });
    expect(promoteResponse.statusCode).toBe(200);

    const publishResponse = await app.inject({
      method: 'POST',
      url: '/internal/admin/bio-bundle/publish-gold',
      payload: {
        datasetFile: datasetFileName,
      },
    });
    expect(publishResponse.statusCode).toBe(409);
  }, STYLE_BUNDLE_ROUTE_TEST_TIMEOUT_MS);
});
