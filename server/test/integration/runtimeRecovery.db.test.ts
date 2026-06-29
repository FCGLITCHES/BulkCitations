import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTruthBackgroundJob } from '../../src/routes/admin-truth/backgroundJobs.js';
import { getTruthBackgroundDbJob, saveTruthBackgroundDbJob } from '../../src/routes/admin-truth/backgroundJobStore.js';
import { resumeTruthBackgroundJobs } from '../../src/routes/adminTruthRoutes.js';
import { resumeRuntimeJobs } from '../../src/jobs/runtime.js';
import {
  getApprovedTruth,
  getJob,
  resetRuntimeStore,
  saveJob,
  upsertApprovedTruthPayload,
} from '../../src/runtime/persistence.js';

describe('db-backed runtime recovery', () => {
  afterEach(async () => {
    await resetRuntimeStore();
  });

  it('resumes pending async conversion jobs from Postgres without Redis workers', async () => {
    const jobId = randomUUID();
    await saveJob({
      id: jobId,
      request: {
        sourceType: 'text',
        content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
        outputStyle: 'apa7',
      },
      executionMode: 'async',
      status: 'pending',
      createdAt: new Date().toISOString(),
      progress: {
        totalRefs: 0,
        processedRefs: 0,
        currentPhase: null,
        percentComplete: 0,
      },
      exports: {},
      events: [],
    });

    await resumeRuntimeJobs();

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const job = await getJob(jobId);
      if (job?.status === 'completed' || job?.status === 'partial') {
        expect(job.result?.references).toHaveLength(1);
        return;
      }
      if (job?.status === 'failed') {
        throw new Error(job.error?.message ?? `Recovered async job ${jobId} failed.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Recovered async job ${jobId} did not complete in time.`);
  }, 30_000);

  it('resumes approved-truth background jobs from Postgres without Redis workers', async () => {
    const first = await upsertApprovedTruthPayload({
      rawText: 'Row A. Smith, J. (2020). Example A.',
      expectedFields: { title: 'Example A', year: '2020' },
      datasetSplit: 'train',
      trustLevel: 'draft',
      rowStatus: 'draft',
    });
    const second = await upsertApprovedTruthPayload({
      rawText: 'Row B. Smith, J. (2021). Example B.',
      expectedFields: { title: 'Example B', year: '2021' },
      datasetSplit: 'train',
      trustLevel: 'draft',
      rowStatus: 'draft',
    });

    const job = createTruthBackgroundJob(
      'update',
      {},
      1,
      [first.id, second.id],
      null,
      {
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
      },
    );
    await saveTruthBackgroundDbJob(job);

    await resumeTruthBackgroundJobs();

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const current = await getTruthBackgroundDbJob(job.id);
      if (current?.status === 'completed') {
        expect(current.updatedCount).toBe(2);
        const updatedFirst = await getApprovedTruth(first.id);
        const updatedSecond = await getApprovedTruth(second.id);
        expect(updatedFirst?.trustLevel).toBe('reviewed');
        expect(updatedFirst?.rowStatus).toBe('reviewed');
        expect(updatedSecond?.trustLevel).toBe('reviewed');
        expect(updatedSecond?.rowStatus).toBe('reviewed');
        return;
      }
      if (current?.status === 'failed') {
        throw new Error(current.error ?? `Recovered truth background job ${job.id} failed.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Recovered truth background job ${job.id} did not complete in time.`);
  }, 30_000);
});
