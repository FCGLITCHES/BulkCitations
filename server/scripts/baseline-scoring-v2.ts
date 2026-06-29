/**
 * One-time pre-rollout parseQuality baseline capture for scoring v2.
 *
 * Reads the most recent completed or partial jobs, computes the current
 * average parseQuality, and writes a JSON snapshot artifact for rollout
 * comparison. This is an ops script, not runtime logic.
 *
 * Run:
 *   npx tsx scripts/baseline-scoring-v2.ts
 */

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJobs } from '../src/runtime/persistence.js';

const MAX_SAMPLE_SIZE = 1000;

async function main(): Promise<void> {
  const jobs = await listJobs();
  const completed = jobs
    .filter((job) => job.status === 'completed' || job.status === 'partial')
    .sort((left, right) => {
      const leftTime = Date.parse(left.completedAt ?? left.createdAt);
      const rightTime = Date.parse(right.completedAt ?? right.createdAt);
      return rightTime - leftTime;
    });

  const sample = completed.slice(0, MAX_SAMPLE_SIZE);
  const parseQualityBaseline = sample.length === 0
    ? 0
    : Math.round(
      sample.reduce((sum, job) => sum + (job.result?.summary.parseQuality ?? 0), 0) / sample.length,
    );

  const artifact = {
    capturedAt: new Date().toISOString(),
    sampleSize: sample.length,
    parseQualityBaseline,
    scoreVersion: 'pre-v2' as const,
  };

  const outputDirectory = fileURLToPath(new URL('../../docs/test-results', import.meta.url));
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `parse-quality-baseline-${artifact.capturedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    event: 'parse_quality_baseline_captured',
    outputFile,
    ...artifact,
  }, null, 2));
}

main().catch((error) => {
  console.error('Failed to capture parseQuality baseline:', error);
  process.exit(1);
});
