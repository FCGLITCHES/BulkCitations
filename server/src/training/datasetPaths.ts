import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  resolveBioDatasetRoot,
  resolveGoldDatasetRoot,
  resolveRepositoryRoot,
  resolveStyleGoldOutputPath,
} from '../runtime/artifactPaths.js';

export interface DatasetMirrorManifestInput {
  source: string;
  mirror: string;
  datasetVersion: string;
  createdAt?: string;
}

export interface ResolvedDatasetPath {
  path: string;
  source: 'engine-v2' | 'legacy';
  warning: string | null;
}

function readOverride(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function warnLegacyDatasetFallback(message: string): void {
  console.warn(`[dataset-paths] ${message}`);
}

function resolveFirstExisting(
  engineV2Path: string,
  legacyPath: string,
  description: string,
): ResolvedDatasetPath {
  if (existsSync(engineV2Path)) {
    return {
      path: engineV2Path,
      source: 'engine-v2',
      warning: null,
    };
  }

  if (existsSync(legacyPath)) {
    const warning = `${description} is falling back to legacy path: ${legacyPath}`;
    warnLegacyDatasetFallback(warning);
    return {
      path: legacyPath,
      source: 'legacy',
      warning,
    };
  }

  return {
    path: engineV2Path,
    source: 'engine-v2',
    warning: null,
  };
}

export function resolveEngineV1DatasetRoot(): string {
  return readOverride('BULKREFERENCES_ENGINE_V1_DATASET_ROOT')
    ?? resolve(resolveRepositoryRoot(), 'datasets', 'engine-v1');
}

export function resolveEngineV2DatasetRoot(): string {
  return readOverride('BULKREFERENCES_ENGINE_V2_DATASET_ROOT')
    ?? resolve(resolveRepositoryRoot(), 'datasets', 'engine-v2');
}

export function resolveEngineV2StyleCoreRoot(): string {
  return resolve(resolveEngineV2DatasetRoot(), 'gold', 'style-core');
}

export function resolveEngineV2StyleCoreCuratedRoot(): string {
  return resolve(resolveEngineV2StyleCoreRoot(), 'curated');
}

export function resolveEngineV2StyleCoreQuarantineRoot(): string {
  return resolve(resolveEngineV2StyleCoreRoot(), 'quarantine');
}

export function resolveEngineV2StyleCoreSourcePacksRoot(): string {
  return resolve(resolveEngineV2StyleCoreRoot(), 'source-packs');
}

export function resolveEngineV2StyleCoreExportsRoot(): string {
  return resolve(resolveEngineV2StyleCoreRoot(), 'exports');
}

export function resolveEngineV2StyleGoldExportPath(): string {
  return readOverride('BULKREFERENCES_ENGINE_V2_STYLE_GOLD_EXPORT_PATH')
    ?? resolve(resolveEngineV2StyleCoreExportsRoot(), 'style_gold.jsonl');
}

export function resolveEngineV2CitationBioRoot(): string {
  return readOverride('BULKREFERENCES_ENGINE_V2_CITATION_BIO_ROOT')
    ?? resolve(resolveEngineV2DatasetRoot(), 'gold', 'citation-bio');
}

export function resolveEngineV2AuthorityRoot(): string {
  return readOverride('BULKREFERENCES_ENGINE_V2_AUTHORITY_ROOT')
    ?? resolve(resolveEngineV2DatasetRoot(), 'gold', 'authority');
}

export function resolveStyleGoldSourcePath(): ResolvedDatasetPath {
  return resolveFirstExisting(
    resolveEngineV2StyleGoldExportPath(),
    resolveStyleGoldOutputPath(),
    'style gold export',
  );
}

export function resolveGoldDatasetSourceRoot(): ResolvedDatasetPath {
  return resolveFirstExisting(
    resolveEngineV2StyleCoreCuratedRoot(),
    resolveGoldDatasetRoot(),
    'style-core curated dataset root',
  );
}

export function resolveCitationBioSourceRoot(): ResolvedDatasetPath {
  return resolveFirstExisting(
    resolveEngineV2CitationBioRoot(),
    resolveBioDatasetRoot(),
    'citation BIO dataset root',
  );
}

export async function writeDatasetMirrorManifest(
  input: DatasetMirrorManifestInput,
): Promise<string> {
  const sourceContent = await readFile(input.source);
  const manifest = {
    source: input.source,
    mirror: input.mirror,
    dataset_version: input.datasetVersion,
    created_at: input.createdAt ?? new Date().toISOString(),
    sha256: createHash('sha256').update(sourceContent).digest('hex'),
  };
  const manifestPath = `${input.mirror}.manifest.json`;
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}
