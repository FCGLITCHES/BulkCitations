import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveCitationBioSourceRoot,
  resolveEngineV2StyleGoldExportPath,
  resolveStyleGoldSourcePath,
  writeDatasetMirrorManifest,
} from '../../../src/training/datasetPaths.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('datasetPaths', () => {
  it('prefers engine-v2 style gold exports over legacy mirrors', async () => {
    const root = resolve(tmpdir(), `dataset-paths-${Date.now()}`);
    const v2Path = resolve(root, 'v2', 'style_gold.jsonl');
    const legacyPath = resolve(root, 'legacy', 'style_gold.jsonl');
    await mkdir(resolve(root, 'v2'), { recursive: true });
    await mkdir(resolve(root, 'legacy'), { recursive: true });
    await writeFile(v2Path, '{"raw_text":"v2","expected_fields":{}}\n', 'utf8');
    await writeFile(legacyPath, '{"raw_text":"legacy","expected_fields":{}}\n', 'utf8');

    process.env.BULKREFERENCES_ENGINE_V2_STYLE_GOLD_EXPORT_PATH = v2Path;
    process.env.BULKREFERENCES_STYLE_GOLD_OUTPUT_PATH = legacyPath;

    const resolved = resolveStyleGoldSourcePath();

    expect(resolveEngineV2StyleGoldExportPath()).toBe(v2Path);
    expect(resolved).toEqual({
      path: v2Path,
      source: 'engine-v2',
      warning: null,
    });
  });

  it('falls back to legacy BIO root with an explicit warning', async () => {
    const root = resolve(tmpdir(), `dataset-paths-bio-${Date.now()}`);
    const legacyPath = resolve(root, 'legacy-bio');
    await mkdir(legacyPath, { recursive: true });

    process.env.BULKREFERENCES_ENGINE_V2_CITATION_BIO_ROOT = resolve(root, 'missing-v2-bio');
    process.env.BULKREFERENCES_BIO_DATASET_ROOT = legacyPath;

    const resolved = resolveCitationBioSourceRoot();

    expect(resolved.path).toBe(legacyPath);
    expect(resolved.source).toBe('legacy');
    expect(resolved.warning).toContain('falling back to legacy path');
  });

  it('writes mirror manifests with source hashes', async () => {
    const root = resolve(tmpdir(), `dataset-manifest-${Date.now()}`);
    const sourcePath = resolve(root, 'source.jsonl');
    const mirrorPath = resolve(root, 'mirror.jsonl');
    await mkdir(root, { recursive: true });
    await writeFile(sourcePath, '{"raw_text":"source"}\n', 'utf8');
    await writeFile(mirrorPath, '{"raw_text":"source"}\n', 'utf8');

    const manifestPath = await writeDatasetMirrorManifest({
      source: sourcePath,
      mirror: mirrorPath,
      datasetVersion: 'style-core-gold-auto-curated-v2-fields',
      createdAt: '2026-04-24T00:00:00.000Z',
    });

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>;
    expect(manifest.source).toBe(sourcePath);
    expect(manifest.mirror).toBe(mirrorPath);
    expect(manifest.dataset_version).toBe('style-core-gold-auto-curated-v2-fields');
    expect(manifest.created_at).toBe('2026-04-24T00:00:00.000Z');
    expect(manifest.sha256).toHaveLength(64);
  });
});
