/**
 * Pre-rollout baseline measurement script.
 *
 * Reads all completed jobs from the persistence layer and computes:
 * - Correction rate per formatConfidence bucket
 * - Format confidence distribution histogram
 *
 * Run: npx tsx scripts/baseline-detection.ts
 */

import 'dotenv/config';
import { listJobs, listCorrections } from '../src/runtime/persistence.js';

interface BucketStats {
  bucket: string;
  jobCount: number;
  correctionCount: number;
  correctionRate: number;
}

const BUCKETS = [
  { label: '0.00–0.20', min: 0, max: 0.2 },
  { label: '0.20–0.40', min: 0.2, max: 0.4 },
  { label: '0.40–0.60', min: 0.4, max: 0.6 },
  { label: '0.60–0.80', min: 0.6, max: 0.8 },
  { label: '0.80–1.00', min: 0.8, max: 1.01 },
];

async function main() {
  console.log('=== Pre-Rollout Baseline Measurement ===\n');

  const allJobs = await listJobs();
  const completedJobs = allJobs.filter(
    (j) => j.status === 'completed' || j.status === 'partial',
  );
  console.log(`Total jobs: ${allJobs.length}`);
  console.log(`Completed/partial jobs: ${completedJobs.length}`);

  const allCorrections = await listCorrections();
  console.log(`Total corrections: ${allCorrections.length}\n`);

  const correctionsByJob = new Map<string, number>();
  for (const c of allCorrections) {
    correctionsByJob.set(c.jobId, (correctionsByJob.get(c.jobId) ?? 0) + 1);
  }

  const formatDistribution = new Map<string, number>();
  const bucketData: Array<{ bucket: string; confidence: number; jobId: string; corrections: number }> = [];

  for (const job of completedJobs) {
    if (!job.result?.references) continue;

    const refs = job.result.references;
    const avgConfidence =
      refs.length > 0
        ? refs.reduce((sum, r) => sum + (r.rawScore / 100), 0) / refs.length
        : 0;

    const format = refs[0]?.detectedStyle ?? 'unknown';
    formatDistribution.set(format, (formatDistribution.get(format) ?? 0) + 1);

    const corrections = correctionsByJob.get(job.id) ?? 0;
    bucketData.push({ bucket: '', confidence: avgConfidence, jobId: job.id, corrections });
  }

  console.log('--- Format Confidence Distribution ---');
  const bucketStats: BucketStats[] = BUCKETS.map((b) => {
    const inBucket = bucketData.filter((d) => d.confidence >= b.min && d.confidence < b.max);
    const jobCount = inBucket.length;
    const correctionCount = inBucket.reduce((s, d) => s + d.corrections, 0);
    const correctionRate = jobCount > 0 ? correctionCount / jobCount : 0;

    return {
      bucket: b.label,
      jobCount,
      correctionCount,
      correctionRate,
    };
  });

  console.table(bucketStats);

  console.log('\n--- Detected Format Histogram ---');
  const sortedFormats = [...formatDistribution.entries()].sort((a, b) => b[1] - a[1]);
  for (const [format, count] of sortedFormats) {
    const bar = '#'.repeat(Math.min(50, Math.round(count / Math.max(1, completedJobs.length) * 50)));
    console.log(`  ${format.padEnd(25)} ${String(count).padStart(5)} ${bar}`);
  }

  console.log('\n--- Summary ---');
  const totalCorrections = bucketData.reduce((s, d) => s + d.corrections, 0);
  const totalJobs = bucketData.length;
  console.log(`Jobs analyzed:                ${totalJobs}`);
  console.log(`Total corrections:            ${totalCorrections}`);
  console.log(`Overall correction rate:      ${totalJobs > 0 ? (totalCorrections / totalJobs).toFixed(4) : 'N/A'}`);
  console.log(`Corrections per 1000 jobs:    ${totalJobs > 0 ? ((totalCorrections / totalJobs) * 1000).toFixed(1) : 'N/A'}`);
}

main().catch((err) => {
  console.error('Baseline measurement failed:', err);
  process.exit(1);
});
