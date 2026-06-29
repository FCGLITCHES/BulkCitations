import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { enqueueBatchHealthSummaryRebuild } from '../../src/admin/batchHealthSummary.js';
import type { ConvertResponse } from '../../src/engine/types/api.js';
import { saveCitationExtractionHistory } from '../../src/runtime/persistence.js';
import { resetRuntimeStore, updateCitation } from '../../src/runtime/persistence.js';
import {
  createMissingPagesCitation,
  createRetractedCitation,
  createSingleCitation,
  createSingleDoiCitation,
  flushAdminReviewQueue,
} from '../helpers/adminReviewTestHelpers.js';

describe('feedback, admin, keys, and regression routes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await resetRuntimeStore();
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('preserves admin confirmed fields when a citation is reprocessed', async () => {
    app = await buildApp();
    const convert = await createSingleCitation(app);
    const citation = convert.references[0]!;

    const correctionResponse = await app.inject({
      method: 'POST',
      url: '/v1/corrections',
      headers: jobAccessHeaders(convert.jobAccessToken),
      payload: {
        jobId: convert.jobId,
        citationId: citation.id,
        fieldName: 'title',
        newValue: 'Admin locked title',
      },
    });
    expect(correctionResponse.statusCode).toBe(201);
    const correction = correctionResponse.json() as { id: string };

    const approvalResponse = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/corrections/${correction.id}`,
      payload: {
        status: 'approved',
      },
    });

    expect(approvalResponse.statusCode).toBe(200);
    const approved = approvalResponse.json() as {
      citation: ConvertResponse['references'][number];
    };
    expect(approved.citation.fields.title.value).toBe('Admin locked title');
    expect(approved.citation.fields.title.source).toBe('admin_confirmed');

    const reprocessResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/reprocess/${citation.id}`,
    });

    expect(reprocessResponse.statusCode).toBe(200);
    const reprocessed = reprocessResponse.json() as ConvertResponse['references'][number];
    expect(reprocessed.fields.title.value).toBe('Admin locked title');
    expect(reprocessed.fields.title.source).toBe('admin_confirmed');
  });

  it('rescales citation scores after an approved admin correction', async () => {
    app = await buildApp();
    const convert = await createMissingPagesCitation(app);
    const citation = convert.references[0]!;
    const startingRawScore = citation.rawScore;

    const correctionResponse = await app.inject({
      method: 'POST',
      url: '/v1/corrections',
      headers: jobAccessHeaders(convert.jobAccessToken),
      payload: {
        jobId: convert.jobId,
        citationId: citation.id,
        fieldName: 'pages',
        newValue: '44-50',
      },
    });
    expect(correctionResponse.statusCode).toBe(201);
    const correction = correctionResponse.json() as { id: string };

    const approvalResponse = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/corrections/${correction.id}`,
      payload: {
        status: 'approved',
      },
    });

    expect(approvalResponse.statusCode).toBe(200);
    const approved = approvalResponse.json() as {
      citation: ConvertResponse['references'][number];
    };

    expect(approved.citation.fields.pages.value).toBe('44-50');
    expect(approved.citation.fields.pages.source).toBe('admin_confirmed');
    expect(typeof approved.citation.rawScore).toBe('number');
    expect(approved.citation.rawScore).not.toBeNaN();
    expect(approved.citation.rawScore).not.toBe(startingRawScore);
    expect(approved.citation.scoreBreakdown.diagnostics.rescoredAfterCorrection).toBe(true);
  });

  it('syncs reports-only batches across the review queue and reference archive', async () => {
    app = await buildApp();
    const convert = await createSingleCitation(app);
    const citation = convert.references[0]!;
    await flushAdminReviewQueue();

    const initialArchive = await app.inject({
      method: 'GET',
      url: '/internal/admin/references',
    });
    expect(initialArchive.statusCode).toBe(200);
    const initialArchiveBody = initialArchive.json() as {
      references: Array<{
        citationId: string;
        jobId: string;
        healthLabel: string;
        storageStatus: string;
        openReportCounts: { total: number };
      }>;
    };
    expect(
      initialArchiveBody.references.find((reference) => reference.citationId === citation.id),
    ).toMatchObject({
      citationId: citation.id,
      jobId: convert.jobId,
      healthLabel: 'Ready',
      storageStatus: 'active',
      openReportCounts: { total: 0 },
    });

    const reportResponse = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: {
        'x-forwarded-for': '203.0.113.45',
        ...jobAccessHeaders(convert.jobAccessToken),
      },
      payload: {
        jobId: convert.jobId,
        citationId: citation.id,
        failureCategory: 'metadata_mismatch',
        userNote: 'The title needs review.',
      },
    });

    expect(reportResponse.statusCode).toBe(201);
    const report = reportResponse.json() as { id: string };
    await flushAdminReviewQueue();

    const queueResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/review-queue',
    });
    expect(queueResponse.statusCode).toBe(200);
    const queue = queueResponse.json() as {
      batches: Array<{
        jobId: string;
        healthLabel: string;
        queueSource: string;
        flaggedCitationCount: number;
        openReportCounts: { total: number };
      }>;
      total: number;
    };
    expect(queue.total).toBe(1);
    expect(queue.batches[0]).toMatchObject({
      jobId: convert.jobId,
      healthLabel: 'Review',
      queueSource: 'reports_only',
      flaggedCitationCount: 1,
      openReportCounts: { total: 1 },
    });

    const citationsResponse = await app.inject({
      method: 'GET',
      url: `/internal/admin/review-queue/${convert.jobId}/citations`,
    });
    expect(citationsResponse.statusCode).toBe(200);
    const citationsPayload = citationsResponse.json() as {
      citations: Array<{
        citationId: string;
        linkedReports: Array<{ id: string }>;
      }>;
      totalFlaggedCitations: number;
    };
    expect(citationsPayload.totalFlaggedCitations).toBe(1);
    expect(citationsPayload.citations[0]).toMatchObject({
      citationId: citation.id,
      linkedReports: [{ id: report.id }],
    });

    const archiveResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/references',
    });
    expect(archiveResponse.statusCode).toBe(200);
    const archive = archiveResponse.json() as {
      references: Array<{
        citationId: string;
        jobId: string;
        healthLabel: string;
        openReportCounts: { total: number };
      }>;
    };
    expect(archive.references.find((reference) => reference.citationId === citation.id)).toMatchObject({
      citationId: citation.id,
      jobId: convert.jobId,
      healthLabel: 'Review',
      openReportCounts: { total: 1 },
    });

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/reports/${report.id}`,
      payload: {
        status: 'accepted',
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    await flushAdminReviewQueue();

    const clearedQueueResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/review-queue',
    });
    expect(clearedQueueResponse.statusCode).toBe(200);
    const clearedQueue = clearedQueueResponse.json() as {
      batches: Array<{ jobId: string }>;
      total: number;
    };
    expect(clearedQueue.total).toBe(0);
    expect(clearedQueue.batches.find((batch) => batch.jobId === convert.jobId)).toBeUndefined();

    const clearedArchiveResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/references',
    });
    expect(clearedArchiveResponse.statusCode).toBe(200);
    const clearedArchive = clearedArchiveResponse.json() as {
      references: Array<{
        citationId: string;
        jobId: string;
        healthLabel: string;
        storageStatus: string;
        openReportCounts: { total: number };
      }>;
    };
    expect(
      clearedArchive.references.find((reference) => reference.citationId === citation.id),
    ).toMatchObject({
      citationId: citation.id,
      jobId: convert.jobId,
      healthLabel: 'Ready',
      storageStatus: 'active',
      openReportCounts: { total: 0 },
    });

    const learningQueue = await app.inject({
      method: 'GET',
      url: '/internal/admin/learning-queue',
    });
    expect(learningQueue.statusCode).toBe(200);
    expect((learningQueue.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it('keeps non-ready batches queued after the last linked report is closed', async () => {
    app = await buildApp();
    const convert = await createSingleCitation(app);
    const citation = convert.references[0]!;

    await updateCitation(convert.jobId, citation.id, (current) => {
      current.publicStatus = 'needs_action';
    });
    await enqueueBatchHealthSummaryRebuild(convert.jobId);
    await flushAdminReviewQueue();

    const reportResponse = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: {
        'x-forwarded-for': '203.0.113.46',
        ...jobAccessHeaders(convert.jobAccessToken),
      },
      payload: {
        jobId: convert.jobId,
        citationId: citation.id,
        failureCategory: 'validation_mismatch',
      },
    });
    expect(reportResponse.statusCode).toBe(201);
    const report = reportResponse.json() as { id: string };
    await flushAdminReviewQueue();

    const mixedQueueResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/review-queue',
    });
    expect(mixedQueueResponse.statusCode).toBe(200);
    const mixedQueue = mixedQueueResponse.json() as {
      batches: Array<{
        jobId: string;
        healthLabel: string;
        queueSource: string;
        openReportCounts: { total: number };
      }>;
    };
    expect(mixedQueue.batches.find((batch) => batch.jobId === convert.jobId)).toMatchObject({
      jobId: convert.jobId,
      healthLabel: 'Action Needed',
      queueSource: 'both',
      openReportCounts: { total: 1 },
    });

    const resolveResponse = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/reports/${report.id}`,
      payload: {
        status: 'accepted',
      },
    });
    expect(resolveResponse.statusCode).toBe(200);
    await flushAdminReviewQueue();

    const pipelineOnlyQueueResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/review-queue',
    });
    expect(pipelineOnlyQueueResponse.statusCode).toBe(200);
    const pipelineOnlyQueue = pipelineOnlyQueueResponse.json() as {
      batches: Array<{
        jobId: string;
        healthLabel: string;
        queueSource: string;
        inQueue: boolean;
        openReportCounts: { total: number };
      }>;
    };
    expect(pipelineOnlyQueue.batches.find((batch) => batch.jobId === convert.jobId)).toMatchObject({
      jobId: convert.jobId,
      healthLabel: 'Action Needed',
      queueSource: 'pipeline_only',
      inQueue: true,
      openReportCounts: { total: 0 },
    });

    const archiveResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/references',
    });
    expect(archiveResponse.statusCode).toBe(200);
    const archive = archiveResponse.json() as {
      references: Array<{
        citationId: string;
        jobId: string;
        healthLabel: string;
        openReportCounts: { total: number };
      }>;
    };
    expect(archive.references.find((reference) => reference.citationId === citation.id)).toMatchObject({
      citationId: citation.id,
      jobId: convert.jobId,
      healthLabel: 'Action Needed',
      openReportCounts: { total: 0 },
    });
  });

  it('filters the reference archive by batch and health label', async () => {
    app = await buildApp();
    const readyJob = await createSingleCitation(app);
    const actionJob = await createSingleCitation(app);
    const actionCitation = actionJob.references[0]!;

    await updateCitation(actionJob.jobId, actionCitation.id, (current) => {
      current.publicStatus = 'needs_action';
    });
    await enqueueBatchHealthSummaryRebuild(actionJob.jobId);
    await flushAdminReviewQueue();

    const archiveResponse = await app.inject({
      method: 'GET',
      url: `/internal/admin/references?healthLabel=Action%20Needed&jobQuery=${actionJob.jobId}`,
    });

    expect(archiveResponse.statusCode).toBe(200);
    const archive = archiveResponse.json() as {
      references: Array<{
        citationId: string;
        jobId: string;
        healthLabel: string;
      }>;
      total: number;
    };

    expect(archive.total).toBe(1);
    expect(archive.references).toEqual([
      expect.objectContaining({
        citationId: actionCitation.id,
        jobId: actionJob.jobId,
        healthLabel: 'Action Needed',
      }),
    ]);

    expect(archive.references.some((reference) => reference.jobId === readyJob.jobId)).toBe(false);
  });

  it('computes summary.parseQuality from rawScore instead of displayScore', async () => {
    app = await buildApp();
    const response = await createRetractedCitation(app);
    const citation = response.references[0]!;

    expect(response.summary.parseQuality).toBe(citation.rawScore);
  });

  it('surfaces shadow divergence and projected health changes in the admin report', async () => {
    app = await buildApp();
    const convert = await createSingleDoiCitation(app);
    const citation = convert.references[0]!;

    await saveCitationExtractionHistory({
      id: randomUUID(),
      citationId: citation.id,
      jobId: convert.jobId,
      runMode: 'shadow',
      modelVersion: 'mock-crf',
      featureVersion: 'mock-features',
      styleUsed: 'apa',
      overallConfidence: 0.88,
      fieldConfidences: { year: 0.94 },
      uncertainFields: [],
      entities: [],
      shadowDiff: {
        baselineFields: {
          title: 'Example study',
          year: 2020,
          journal: 'Journal of Examples',
        },
        mlFields: {
          title: 'Example study',
          journal: 'Journal of Examples',
        },
        perFieldDiff: {
          year: 'removed',
        },
        severityScore: 0.25,
      },
      timestamp: new Date().toISOString(),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/admin/shadow-report',
    });

    expect(response.statusCode).toBe(200);
    const report = response.json() as {
      totalShadowRows: number;
      divergencesByField: Array<{ field: string; divergent: number }>;
      projectedHealthStateChanges: {
        changed: number;
        transitions: Array<{ from: string; to: string; count: number }>;
      };
    };

    expect(report.totalShadowRows).toBe(1);
    expect(report.divergencesByField[0]).toMatchObject({ field: 'year', divergent: 1 });
    expect(report.projectedHealthStateChanges.changed).toBe(1);
    expect(report.projectedHealthStateChanges.transitions).toContainEqual({
      from: 'ready',
      to: 'needs_action',
      count: 1,
    });
  });

  it('creates, lists, and deletes API keys', async () => {
    app = await buildApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: {
        name: 'Regression key',
        tier: 'pro',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string; rawKey: string };
    expect(created.rawKey.startsWith('br_live_')).toBe(true);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/v1/keys',
    });
    expect(listResponse.statusCode).toBe(200);
    expect((listResponse.json() as Array<{ id: string }>).map((item) => item.id)).toContain(created.id);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/keys/${created.id}`,
    });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it('runs the regression suites and publishes a markdown report', async () => {
    app = await buildApp();

    const runResponse = await app.inject({
      method: 'POST',
      url: '/internal/regression/run',
    });

    expect(runResponse.statusCode).toBe(200);
    const run = runResponse.json() as {
      totalCases: number;
      outputFile: string;
      results: Array<{ passed: boolean }>;
    };

    expect(run.totalCases).toBeGreaterThanOrEqual(9);
    expect(run.results.every((result) => result.passed)).toBe(true);
    await access(run.outputFile);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/internal/regression/runs',
    });
    expect(listResponse.statusCode).toBe(200);
    expect((listResponse.json() as Array<{ outputFile: string }>)[0]?.outputFile).toBe(run.outputFile);
  });
});

function jobAccessHeaders(jobAccessToken: string | undefined): Record<string, string> {
  return jobAccessToken
    ? { 'x-job-access-token': jobAccessToken }
    : {};
}
