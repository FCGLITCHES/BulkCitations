import { cp, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { listApprovedTruth } from '../src/runtime/persistence.js';
import {
  writeStyleGoldExport,
} from '../src/training/styleGoldExport.js';
import { resolveStyleGoldOutputPath } from '../src/runtime/artifactPaths.js';
import {
  resolveEngineV2StyleGoldExportPath,
  writeDatasetMirrorManifest,
} from '../src/training/datasetPaths.js';

async function main(): Promise<void> {
  const explicitOutputPath = process.argv[2];
  const outputPath = explicitOutputPath ?? resolveEngineV2StyleGoldExportPath();
  const rows = await listApprovedTruth({ trustLevel: 'gold', limit: 50_000 });
  const summary = await writeStyleGoldExport(rows, outputPath);
  let mirror: { outputPath: string; manifestPath: string } | null = null;
  if (!explicitOutputPath) {
    const mirrorPath = resolveStyleGoldOutputPath();
    await mkdir(dirname(mirrorPath), { recursive: true });
    await cp(outputPath, mirrorPath);
    const manifestPath = await writeDatasetMirrorManifest({
      source: outputPath,
      mirror: mirrorPath,
      datasetVersion: 'style-gold-approved-truth-export',
    });
    mirror = {
      outputPath: mirrorPath,
      manifestPath,
    };
  }
  console.log(JSON.stringify({
    ok: true,
    ...summary,
    mirror,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
