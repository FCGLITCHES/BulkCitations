import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  getCitation,
  listApprovedTruth,
  resetRuntimeStore,
  upsertApprovedTruthPayload,
  updateCitation,
} from '../../src/runtime/persistence.js';
import { enqueueBatchHealthSummaryRebuild } from '../../src/admin/batchHealthSummary.js';
import { closeDb } from '../../src/db/connection.js';
import { closeRedis } from '../../src/redis/client.js';
import {
  createMissingPagesCitation,
  createSingleCitation,
  flushAdminReviewQueue,
} from '../helpers/adminReviewTestHelpers.js';

describe('DB-backed admin review persistence', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    await flushAdminReviewQueue();
    await resetRuntimeStore();
  });

  afterAll(async () => {
    await closeDb();
    await closeRedis();
  });

  it('persists approved corrections and preserves admin-confirmed fields across reprocess in database mode', async () => {
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
      payload: { status: 'approved' },
    });
    expect(approvalResponse.statusCode).toBe(200);

    await flushAdminReviewQueue();

    await app.close();
    app = await buildApp();

    const reprocessResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/reprocess/${citation.id}`,
    });
    expect(reprocessResponse.statusCode).toBe(200);

    const persistedCitation = await getCitation(convert.jobId, citation.id);
    expect(persistedCitation?.fields.title.value).toBe('Admin locked title');
    expect(persistedCitation?.fields.title.source).toBe('admin_confirmed');
  });

  it('does not overwrite an existing approved-truth row during correction approval or reprocess', async () => {
    app = await buildApp();
    const convert = await createSingleCitation(app);
    const citation = convert.references[0]!;

    await upsertApprovedTruthPayload({
      rawText: citation.raw,
      expectedFields: {
        title: 'Curated approved truth title',
        year: citation.fields.year.value,
      },
      expectedType: citation.referenceType,
      expectedStyle: citation.outputStyle,
      trustLevel: 'reviewed',
      approvalSource: 'manual',
      reviewedBy: 'admin',
      notes: 'Curated directly in approved truth.',
    });

    const correctionResponse = await app.inject({
      method: 'POST',
      url: '/v1/corrections',
      headers: jobAccessHeaders(convert.jobAccessToken),
      payload: {
        jobId: convert.jobId,
        citationId: citation.id,
        fieldName: 'title',
        newValue: 'Citation-only admin correction',
      },
    });
    expect(correctionResponse.statusCode).toBe(201);
    const correction = correctionResponse.json() as { id: string };

    const approvalResponse = await app.inject({
      method: 'PATCH',
      url: `/internal/admin/corrections/${correction.id}`,
      payload: { status: 'approved' },
    });
    expect(approvalResponse.statusCode).toBe(200);

    const reprocessResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/reprocess/${citation.id}`,
    });
    expect(reprocessResponse.statusCode).toBe(200);

    const approvedTruth = await listApprovedTruth({ limit: 20 });
    const curatedRow = approvedTruth.find((entry) => entry.rawText === citation.raw);
    expect(curatedRow?.expectedFields.title).toBe('Curated approved truth title');
    expect(curatedRow?.reviewedBy).toBe('admin');
    expect(curatedRow?.approvalSource).toBe('manual');
  });

  it('persists report assignment and comment history across app reloads', async () => {
    app = await buildApp();
    const convert = await createSingleCitation(app);
    const citation = convert.references[0]!;

    const reportResponse = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: {
        'x-forwarded-for': '203.0.113.50',
        ...jobAccessHeaders(convert.jobAccessToken),
      },
      payload: {
        jobId: convert.jobId,
        citationId: citation.id,
        failureCategory: 'title',
        userNote: 'Needs a closer review.',
      },
    });
    expect(reportResponse.statusCode).toBe(201);
    const createdReport = reportResponse.json() as { id: string };

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/internal/admin/reports/${createdReport.id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json() as { updatedAt: string };

    const assignResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/reports/${createdReport.id}/assign`,
      payload: {
        actor: 'admin',
        assigneeName: 'Casey Reviewer',
        expectedUpdatedAt: detail.updatedAt,
      },
    });
    expect(assignResponse.statusCode).toBe(200);
    const assignedReport = assignResponse.json() as { report: { updatedAt: string } };

    const commentResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/reports/${createdReport.id}/comments`,
      payload: {
        actor: 'admin',
        message: 'Confirmed and queued for follow-up.',
        expectedUpdatedAt: assignedReport.report.updatedAt,
      },
    });
    expect(commentResponse.statusCode).toBe(200);

    await app.close();
    app = await buildApp();

    const reloadedDetail = await app.inject({
      method: 'GET',
      url: `/internal/admin/reports/${createdReport.id}`,
    });
    expect(reloadedDetail.statusCode).toBe(200);
    const reloaded = reloadedDetail.json() as {
      assigneeName?: string;
      reviewEvents?: Array<{ type: string; message?: string }>;
    };

    expect(reloaded.assigneeName).toBe('Casey Reviewer');
    expect(reloaded.reviewEvents?.map((event) => event.type)).toEqual(['assign', 'comment']);
    expect(reloaded.reviewEvents?.[1]?.message).toBe('Confirmed and queued for follow-up.');
  });

  it('resolves a report into approved truth and updates the citation when validation succeeds', async () => {
    app = await buildApp();
    const convert = await createMissingPagesCitation(app);
    const citation = convert.references[0]!;

    const reportResponse = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: {
        'x-forwarded-for': '203.0.113.51',
        ...jobAccessHeaders(convert.jobAccessToken),
      },
      payload: {
        jobId: convert.jobId,
        citationId: citation.id,
        failureCategory: 'locator',
      },
    });
    expect(reportResponse.statusCode).toBe(201);
    const report = reportResponse.json() as { id: string };

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/internal/admin/reports/${report.id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json() as { updatedAt: string };

    const resolveResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/reports/${report.id}/resolve`,
      payload: {
        actor: 'admin',
        expectedUpdatedAt: detail.updatedAt,
        saveAsTruth: true,
        fixType: 'renderer-fix',
        correctedFields: {
          pages: '44-50',
        },
        fieldApproval: {
          pages: {
            approved: true,
            value: '44-50',
          },
        },
        failureTaxonomy: ['locator_gap'],
        stageBlame: ['render'],
        duplicateDecision: 'not_applicable',
      },
    });
    expect(resolveResponse.statusCode).toBe(200);

    const updatedCitation = await getCitation(convert.jobId, citation.id);
    expect(updatedCitation?.fields.pages.value).toBe('44-50');
    expect(updatedCitation?.fields.pages.source).toBe('admin_confirmed');

    const approvedTruth = await listApprovedTruth({ limit: 20 });
    expect(approvedTruth.some((entry) => entry.rawText === citation.raw && entry.provenance === 'admin_resolution')).toBe(true);
  });

  it('returns 409 when a report resolve uses a stale expectedUpdatedAt value', async () => {
    app = await buildApp();
    const convert = await createSingleCitation(app);
    const citation = convert.references[0]!;

    const reportResponse = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: {
        'x-forwarded-for': '203.0.113.52',
        ...jobAccessHeaders(convert.jobAccessToken),
      },
      payload: {
        jobId: convert.jobId,
        citationId: citation.id,
        failureCategory: 'title',
      },
    });
    expect(reportResponse.statusCode).toBe(201);
    const report = reportResponse.json() as { id: string };

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/internal/admin/reports/${report.id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json() as { updatedAt: string };

    const assignResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/reports/${report.id}/assign`,
      payload: {
        actor: 'admin',
        assigneeName: 'Jordan Reviewer',
        expectedUpdatedAt: detail.updatedAt,
      },
    });
    expect(assignResponse.statusCode).toBe(200);

    const staleResolveResponse = await app.inject({
      method: 'POST',
      url: `/internal/admin/reports/${report.id}/resolve`,
      payload: {
        actor: 'admin',
        expectedUpdatedAt: detail.updatedAt,
        saveAsTruth: false,
        fixType: 'renderer-fix',
        failureTaxonomy: [],
        stageBlame: [],
        duplicateDecision: 'not_applicable',
      },
    });
    expect(staleResolveResponse.statusCode).toBe(409);
  });

  it('keeps queue and archive summaries synced for report-only, pipeline-only, and mixed batches', async () => {
    app = await buildApp();

    const reportOnlyJob = await createSingleCitation(app);
    const reportOnlyCitation = reportOnlyJob.references[0]!;
    const pipelineOnlyJob = await createSingleCitation(app);
    const pipelineOnlyCitation = pipelineOnlyJob.references[0]!;
    const mixedJob = await createSingleCitation(app);
    const mixedCitation = mixedJob.references[0]!;

    await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: {
        'x-forwarded-for': '203.0.113.53',
        ...jobAccessHeaders(reportOnlyJob.jobAccessToken),
      },
      payload: {
        jobId: reportOnlyJob.jobId,
        citationId: reportOnlyCitation.id,
        failureCategory: 'title',
      },
    });

    await updateCitation(pipelineOnlyJob.jobId, pipelineOnlyCitation.id, (current) => {
      current.publicStatus = 'needs_action';
    });
    await enqueueBatchHealthSummaryRebuild(pipelineOnlyJob.jobId);

    await updateCitation(mixedJob.jobId, mixedCitation.id, (current) => {
      current.publicStatus = 'needs_action';
    });
    await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: {
        'x-forwarded-for': '203.0.113.54',
        ...jobAccessHeaders(mixedJob.jobAccessToken),
      },
      payload: {
        jobId: mixedJob.jobId,
        citationId: mixedCitation.id,
        failureCategory: 'validation',
      },
    });

    await flushAdminReviewQueue();

    const queueResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/review-queue',
    });
    expect(queueResponse.statusCode).toBe(200);
    const queue = queueResponse.json() as {
      batches: Array<{ jobId: string; queueSource: string; healthLabel: string }>;
    };

    expect(queue.batches.find((batch) => batch.jobId === reportOnlyJob.jobId)).toMatchObject({
      queueSource: 'reports_only',
      healthLabel: 'Review',
    });
    expect(queue.batches.find((batch) => batch.jobId === pipelineOnlyJob.jobId)).toMatchObject({
      queueSource: 'pipeline_only',
      healthLabel: 'Action Needed',
    });
    expect(queue.batches.find((batch) => batch.jobId === mixedJob.jobId)).toMatchObject({
      queueSource: 'both',
      healthLabel: 'Action Needed',
    });

    const archiveResponse = await app.inject({
      method: 'GET',
      url: '/internal/admin/references',
    });
    expect(archiveResponse.statusCode).toBe(200);
    const archive = archiveResponse.json() as {
      references: Array<{ citationId: string; jobId: string; healthLabel: string; openReportCounts: { total: number } }>;
    };

    expect(archive.references.find((reference) => reference.citationId === reportOnlyCitation.id)).toMatchObject({
      citationId: reportOnlyCitation.id,
      jobId: reportOnlyJob.jobId,
      healthLabel: 'Review',
      openReportCounts: { total: 1 },
    });
    expect(archive.references.find((reference) => reference.citationId === pipelineOnlyCitation.id)).toMatchObject({
      citationId: pipelineOnlyCitation.id,
      jobId: pipelineOnlyJob.jobId,
      healthLabel: 'Action Needed',
      openReportCounts: { total: 0 },
    });
    expect(archive.references.find((reference) => reference.citationId === mixedCitation.id)).toMatchObject({
      citationId: mixedCitation.id,
      jobId: mixedJob.jobId,
      healthLabel: 'Action Needed',
      openReportCounts: { total: 1 },
    });
  });

  it('filters the DB-backed reference archive by batch and health label', async () => {
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
      references: Array<{ citationId: string; jobId: string; healthLabel: string }>;
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
});

function jobAccessHeaders(jobAccessToken: string | undefined): Record<string, string> {
  return jobAccessToken
    ? { 'x-job-access-token': jobAccessToken }
    : {};
}
