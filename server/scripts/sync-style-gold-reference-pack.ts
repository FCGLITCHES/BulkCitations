import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import {
  resolveGoldDatasetRoot,
  resolveRepositoryRoot,
  resolveStyleGoldOutputPath,
} from '../src/runtime/artifactPaths.js';
import {
  resolveEngineV2StyleCoreCuratedRoot,
  resolveEngineV2StyleCoreExportsRoot,
  resolveEngineV2StyleCoreSourcePacksRoot,
  resolveEngineV2StyleGoldExportPath,
  writeDatasetMirrorManifest,
} from '../src/training/datasetPaths.js';
import { effectiveRowStatus } from '../src/training/truthCertification.js';
import {
  buildGoldReferenceManifest,
  goldReferenceManifestCandidateCounts,
  goldReferenceManifestCandidateCountsFromRows,
  mapGoldReferenceGoldRowToApprovedTruth,
  mapGoldReferenceQuarantineRowToApprovedTruth,
  type GoldReferenceCurationReport,
  type GoldReferenceGoldAuditRow,
  type GoldReferenceQuarantineAuditRow,
  resolveGoldReferenceReportCreatedAt,
  resolveGoldReferenceReportDatasetVersion,
  resolveGoldReferenceReportGoldRows,
  resolveGoldReferenceReportInputFile,
  resolveGoldReferenceReportQuarantineRows,
} from '../src/training/styleGoldReferencePack.js';
import { writeFrozenGoldDatasetManifest } from '../src/training/styleGoldDatasetFreeze.js';
import { writeStyleGoldExport } from '../src/training/styleGoldExport.js';

interface CliOptions {
  packRoot: string;
  datasetVersion: string | null;
  replaceDatasetVersions: string[];
  reviewedBy: string;
  includeQuarantine: boolean;
}

function resolveDefaultPackRoot(repositoryRoot: string): string {
  const engineV2SourcePacksRoot = resolveEngineV2StyleCoreSourcePacksRoot();
  const candidates = [
    resolve(engineV2SourcePacksRoot, 'style_core_gold_reference_pack_fields'),
    resolve(engineV2SourcePacksRoot, 'style_core_gold_reference_pack'),
    'style_core_gold_reference_pack_fields',
    'style_core_gold_reference_pack',
  ];
  for (const candidate of candidates) {
    const path = resolve(repositoryRoot, candidate);
    if (existsSync(path)) {
      return path;
    }
  }
  return resolve(repositoryRoot, 'style_core_gold_reference_pack_fields');
}

function parseArgs(argv: string[]): CliOptions {
  const repositoryRoot = resolveRepositoryRoot();
  let packRoot = resolveDefaultPackRoot(repositoryRoot);
  let datasetVersion: string | null = null;
  const replaceDatasetVersions: string[] = [];
  let reviewedBy = 'system:style-gold-reference-pack';
  let includeQuarantine = true;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (token === '--pack-root') {
      packRoot = resolve(process.cwd(), argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (token === '--dataset-version') {
      datasetVersion = (argv[index + 1] ?? '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--replace-dataset-version') {
      const value = (argv[index + 1] ?? '').trim();
      if (value) {
        replaceDatasetVersions.push(value);
      }
      index += 1;
      continue;
    }
    if (token === '--reviewed-by') {
      reviewedBy = (argv[index + 1] ?? reviewedBy).trim() || reviewedBy;
      index += 1;
      continue;
    }
    if (token === '--no-quarantine') {
      includeQuarantine = false;
      continue;
    }
  }

  return {
    packRoot,
    datasetVersion,
    replaceDatasetVersions,
    reviewedBy,
    includeQuarantine,
  };
}

async function readNdjson<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8');
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function importRowsWithConcurrency<T>(
  rows: readonly T[],
  concurrency: number,
  worker: (row: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= rows.length) {
        return;
      }
      await worker(rows[currentIndex]!, currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => runWorker()),
  );
}

function resolvePackFile(packRoot: string, name: string): string {
  const path = resolve(packRoot, name);
  if (!existsSync(path)) {
    throw new Error(`Required pack file is missing: ${path}`);
  }
  return path;
}

async function removeDatasetArtifacts(
  goldDatasetRoot: string,
  datasetVersion: string,
): Promise<string[]> {
  const paths = [
    resolve(goldDatasetRoot, `${datasetVersion}.style-core.jsonl`),
    resolve(goldDatasetRoot, `${datasetVersion}.summary.json`),
    resolve(goldDatasetRoot, `${datasetVersion}.json`),
  ];

  await Promise.all(
    paths.map((path) => rm(path, { force: true })),
  );

  return paths;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/bulkreferences';
  process.env.PERSISTENCE_BACKEND ??= 'database';

  const {
    deleteApprovedTruth,
    listApprovedTruth,
    runtimePersistenceBackend,
    upsertApprovedTruthPayload,
  } = await import('../src/runtime/persistence.js');
  const { closeDb } = await import('../src/db/connection.js');

  if (runtimePersistenceBackend !== 'database') {
    throw new Error(`This sync requires the database backend. Resolved backend: ${runtimePersistenceBackend}.`);
  }

  if (!existsSync(options.packRoot)) {
    throw new Error(`Pack root was not found: ${options.packRoot}`);
  }

  const reportPath = resolvePackFile(options.packRoot, 'style_core_gold_curation_report.json');
  const fullAuditPath = resolvePackFile(options.packRoot, 'style_core_gold_full_audit.ndjson');
  const quarantinePath = resolvePackFile(options.packRoot, 'style_core_quarantine_review.ndjson');

  const report = JSON.parse(await readFile(reportPath, 'utf8')) as GoldReferenceCurationReport;
  const datasetVersion = options.datasetVersion ?? resolveGoldReferenceReportDatasetVersion(report);
  if (!datasetVersion) {
    throw new Error('Unable to resolve datasetVersion from arguments or curation report.');
  }

  const goldDatasetRoot = resolveGoldDatasetRoot();
  const engineV2CuratedRoot = resolveEngineV2StyleCoreCuratedRoot();
  const engineV2ExportsRoot = resolveEngineV2StyleCoreExportsRoot();
  const engineV2SourcePacksRoot = resolveEngineV2StyleCoreSourcePacksRoot();
  const packDirectoryName = basename(options.packRoot);
  const legacyReferencePackDestination = resolve(goldDatasetRoot, packDirectoryName);
  const engineV2ReferencePackDestination = resolve(engineV2SourcePacksRoot, packDirectoryName);
  const legacyDatasetStyleGoldPath = resolve(goldDatasetRoot, `${datasetVersion}.style-core.jsonl`);
  const engineV2DatasetStyleGoldPath = resolve(engineV2CuratedRoot, `${datasetVersion}.style-core.jsonl`);
  const legacyDatasetSummaryPath = resolve(goldDatasetRoot, `${datasetVersion}.summary.json`);
  const engineV2DatasetSummaryPath = resolve(engineV2CuratedRoot, `${datasetVersion}.summary.json`);
  const legacyCanonicalStyleGoldPath = resolveStyleGoldOutputPath();
  const engineV2CanonicalStyleGoldPath = resolveEngineV2StyleGoldExportPath();
  const now = new Date().toISOString();

  const goldAuditRows = await readNdjson<GoldReferenceGoldAuditRow>(fullAuditPath);
  const quarantineRows = options.includeQuarantine
    ? await readNdjson<GoldReferenceQuarantineAuditRow>(quarantinePath)
    : [];

  const goldPayloads = goldAuditRows.map((row) =>
    mapGoldReferenceGoldRowToApprovedTruth(row, {
      datasetVersion,
      reviewedBy: options.reviewedBy,
      certifiedAt: now,
    }),
  );
  const quarantinePayloads = quarantineRows.map((row) =>
    mapGoldReferenceQuarantineRowToApprovedTruth(row, {
      datasetVersion,
      reviewedBy: options.reviewedBy,
    }),
  );
  const importPayloads = [...quarantinePayloads, ...goldPayloads];

  await mkdir(goldDatasetRoot, { recursive: true });
  await mkdir(engineV2CuratedRoot, { recursive: true });
  await mkdir(engineV2ExportsRoot, { recursive: true });
  await mkdir(engineV2SourcePacksRoot, { recursive: true });
  await rm(legacyReferencePackDestination, { recursive: true, force: true });
  for (const knownPackDirectoryName of [
    'style_core_gold_reference_pack',
    'style_core_gold_reference_pack_fields',
  ]) {
    if (knownPackDirectoryName === packDirectoryName) {
      continue;
    }
    await rm(resolve(goldDatasetRoot, knownPackDirectoryName), {
      recursive: true,
      force: true,
    });
  }
  if (resolve(options.packRoot) !== resolve(engineV2ReferencePackDestination)) {
    await rm(engineV2ReferencePackDestination, { recursive: true, force: true });
    await cp(options.packRoot, engineV2ReferencePackDestination, { recursive: true });
  }
  await cp(engineV2ReferencePackDestination, legacyReferencePackDestination, { recursive: true });

  await importRowsWithConcurrency(importPayloads, 8, async (payload, index) => {
    await upsertApprovedTruthPayload({
      rawText: payload.rawText,
      expectedFields: payload.expectedFields,
      coreTruth: payload.coreTruth,
      expectedType: payload.expectedType,
      expectedStyle: payload.expectedStyle,
      provenance: payload.provenance,
      pipelineMajor: payload.pipelineMajor,
      datasetSplit: payload.datasetSplit,
      trustLevel: payload.trustLevel,
      rowStatus: payload.rowStatus,
      blockedReason: payload.blockedReason,
      taskCertifications: payload.taskCertifications,
      workId: payload.workId,
      familyId: payload.familyId,
      canonicalWorkKey: payload.canonicalWorkKey,
      nearDupClusterId: payload.nearDupClusterId,
      datasetVersion: payload.datasetVersion,
      holdoutVersion: payload.holdoutVersion,
      styleInferabilityTier: payload.styleInferabilityTier,
      styleEvaluationSuite: payload.styleEvaluationSuite,
      goldKind: payload.goldKind,
      adversarialPair: payload.adversarialPair,
      noiseProfile: payload.noiseProfile,
      isAdversarial: payload.isAdversarial,
      approvalSource: payload.approvalSource,
      reviewedBy: payload.reviewedBy,
      notes: payload.notes,
      variantId: payload.variantId,
    });

    if ((index + 1) % 1000 === 0 || index + 1 === importPayloads.length) {
      console.log(`Imported ${index + 1}/${importPayloads.length} pack rows`);
    }
  });

  let deletedReplacedRows = 0;
  const deletedArtifactPaths: string[] = [];
  for (const replaceDatasetVersion of options.replaceDatasetVersions) {
    const rows = await listApprovedTruth({
      datasetVersion: replaceDatasetVersion,
      limit: 50_000,
    });
    for (const row of rows) {
      const deleted = await deleteApprovedTruth(row.id);
      if (deleted) {
        deletedReplacedRows += 1;
      }
    }
    deletedArtifactPaths.push(
      ...(await removeDatasetArtifacts(goldDatasetRoot, replaceDatasetVersion)),
    );
  }

  const datasetRows = await listApprovedTruth({
    datasetVersion,
    limit: 50_000,
  });
  const datasetGoldRows = datasetRows.filter(
    (row) => row.trustLevel === 'gold' && effectiveRowStatus(row) !== 'quarantined',
  );
  const datasetQuarantineRows = datasetRows.filter(
    (row) => effectiveRowStatus(row) === 'quarantined',
  );

  const engineV2CanonicalExportSummary = await writeStyleGoldExport(
    datasetGoldRows,
    engineV2CanonicalStyleGoldPath,
    { datasetVersion },
  );
  const engineV2DatasetExportSummary = await writeStyleGoldExport(
    datasetGoldRows,
    engineV2DatasetStyleGoldPath,
    { datasetVersion },
  );
  await mkdir(dirname(legacyCanonicalStyleGoldPath), { recursive: true });
  await mkdir(dirname(legacyDatasetStyleGoldPath), { recursive: true });
  await cp(engineV2CanonicalStyleGoldPath, legacyCanonicalStyleGoldPath);
  await cp(engineV2DatasetStyleGoldPath, legacyDatasetStyleGoldPath);

  const manifestCandidates =
    report.gold_kind_counts || report.quarantine_kind_counts
      ? goldReferenceManifestCandidateCounts(report)
      : goldReferenceManifestCandidateCountsFromRows([
        ...goldAuditRows,
        ...quarantineRows,
      ]);
  const manifest = buildGoldReferenceManifest(datasetGoldRows, {
    datasetVersion,
    createdAt: now,
    candidates: manifestCandidates,
  });
  const manifestPath = await writeFrozenGoldDatasetManifest(manifest);
  const canonicalMirrorManifestPath = await writeDatasetMirrorManifest({
    source: engineV2CanonicalStyleGoldPath,
    mirror: legacyCanonicalStyleGoldPath,
    datasetVersion,
    createdAt: now,
  });
  const datasetMirrorManifestPath = await writeDatasetMirrorManifest({
    source: engineV2DatasetStyleGoldPath,
    mirror: legacyDatasetStyleGoldPath,
    datasetVersion,
    createdAt: now,
  });

  const summary = {
    ok: true,
    datasetVersion,
    packRoot: options.packRoot,
    reviewedBy: options.reviewedBy,
    includeQuarantine: options.includeQuarantine,
    replaceDatasetVersions: options.replaceDatasetVersions,
    report: {
      inputFile: resolveGoldReferenceReportInputFile(report),
      curationVersion: resolveGoldReferenceReportDatasetVersion(report),
      curationDate: resolveGoldReferenceReportCreatedAt(report),
      goldRows: resolveGoldReferenceReportGoldRows(report),
      quarantineRows: resolveGoldReferenceReportQuarantineRows(report),
    },
    imported: {
      goldRowsRead: goldAuditRows.length,
      quarantineRowsRead: quarantineRows.length,
      totalRowsImported: importPayloads.length,
      deletedReplacedRows,
      deletedArtifactPaths,
    },
    database: {
      datasetRows: datasetRows.length,
      goldRows: datasetGoldRows.length,
      quarantineRows: datasetQuarantineRows.length,
    },
    outputs: {
      referencePackDestination: engineV2ReferencePackDestination,
      legacyReferencePackDestination,
      canonicalStyleGoldJsonl: engineV2CanonicalExportSummary.outputPath,
      canonicalStyleGoldRows: engineV2CanonicalExportSummary.rowCount,
      canonicalStyleGoldMirrorJsonl: legacyCanonicalStyleGoldPath,
      canonicalMirrorManifestPath,
      datasetStyleGoldJsonl: engineV2DatasetExportSummary.outputPath,
      datasetStyleGoldRows: engineV2DatasetExportSummary.rowCount,
      datasetStyleGoldMirrorJsonl: legacyDatasetStyleGoldPath,
      datasetMirrorManifestPath,
      manifestPath,
      summaryPath: engineV2DatasetSummaryPath,
      legacySummaryPath: legacyDatasetSummaryPath,
    },
  };

  await writeFile(engineV2DatasetSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await cp(engineV2DatasetSummaryPath, legacyDatasetSummaryPath);
  console.log(JSON.stringify(summary, null, 2));

  await closeDb();
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
