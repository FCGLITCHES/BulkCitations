import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { JobCreatedResponse, JobStatusResponse } from '../../src/engine/types/api.js';
import { resetRuntimeStore } from '../../src/runtime/persistence.js';
import { upsertApprovedTruthPayload } from '../../src/runtime/persistence.js';

describe('async jobs and export routes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await resetRuntimeStore();
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('queues upload batches, exposes polling state, and replays SSE events', async () => {
    app = await buildApp();

    const boundary = '----bulkreferences-stream-boundary';
    const fileContents = [
      '10.1000/author-2020-study-1',
      '10.1000/author-2021-study-2',
      '10.1000/author-2022-study-3',
    ].join('\n');
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="outputStyle"',
      '',
      'apa7',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="references.txt"',
      'Content-Type: text/plain',
      '',
      fileContents,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const convertResponse = await app.inject({
      method: 'POST',
      url: '/v1/convert/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody,
    });

    expect(convertResponse.statusCode).toBe(202);
    const created = convertResponse.json() as JobCreatedResponse;

    const completed = await waitForJob(app, created.jobId, created.jobAccessToken);
    expect(completed.executionMode).toBe('async');
    expect(completed.status === 'completed' || completed.status === 'partial').toBe(true);
    expect(completed.executionProfile).toBe('core_parse_full');
    expect(completed.coreParseLatencyMs).toBeGreaterThanOrEqual(0);
    expect(completed.overlay).toEqual({
      status: 'not_requested',
      jobId: null,
      providerLatencyMs: null,
    });
    expect(completed.references).toHaveLength(3);

    const streamResponse = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${created.jobId}/stream`,
      headers: jobAccessHeaders(created.jobAccessToken),
    });

    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers['content-type']).toContain('text/event-stream');
    expect(streamResponse.body).toContain('event: queued');
    expect(streamResponse.body).toContain('event: complete');
  });

  it('accepts uploads asynchronously and lazily generates exports', async () => {
    app = await buildApp();

    const boundary = '----bulkreferences-boundary';
    const fileContents = 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="outputStyle"',
      '',
      'apa7',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="references.txt"',
      'Content-Type: text/plain',
      '',
      fileContents,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/v1/convert/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody,
    });

    expect(uploadResponse.statusCode).toBe(202);
    const created = uploadResponse.json() as JobCreatedResponse;
    const completed = await waitForJob(app, created.jobId, created.jobAccessToken);

    expect(completed.references).toHaveLength(1);

    const exportResponse = await app.inject({
      method: 'GET',
      url: `/v1/export/${created.jobId}/csv`,
      headers: jobAccessHeaders(created.jobAccessToken),
    });

    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers['content-type']).toContain('text/csv');
    expect(exportResponse.body).toContain('"id","status","type"');
  });

  it('rejects anonymous job access without the issued job token', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content: 'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
        outputStyle: 'apa7',
      },
    });

    expect(response.statusCode).toBe(200);
    const convert = response.json() as JobStatusResponse & { jobAccessToken?: string };

    const unauthorizedJob = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${convert.jobId}`,
    });
    expect(unauthorizedJob.statusCode).toBe(404);

    const unauthorizedExport = await app.inject({
      method: 'GET',
      url: `/v1/export/${convert.jobId}/txt`,
    });
    expect(unauthorizedExport.statusCode).toBe(404);

    const authorizedJob = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${convert.jobId}`,
      headers: jobAccessHeaders(convert.jobAccessToken),
    });
    expect(authorizedJob.statusCode).toBe(200);
  });

  it('returns a conservative partial parse when one DOI local cache entry is missing', async () => {
    app = await buildApp();
    await upsertApprovedTruthPayload({
      rawText: '10.1000/good-2020-study',
      expectedFields: {
        doi: '10.1000/good-2020-study',
        title: 'Good study',
        authors: ['Smith, J.'],
        year: 2020,
        journal: 'Journal of Examples',
        volume: '12',
        issue: '3',
        pages: '44-50',
      },
      expectedType: 'article-journal',
      trustLevel: 'gold',
      reviewedBy: 'integration-test',
      provenance: 'approved_truth_seed',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'doi_list',
        content: [
          '10.1000/good-2020-study',
          '10.1000/unresolved-2021-study',
        ].join('\n'),
        outputStyle: 'apa7',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as JobStatusResponse & {
      status: 'success' | 'partial' | 'failed';
      failedIndices: number[];
    };

    expect(body.status).toBe('success');
    expect(body.summary?.failed).toBe(0);
    expect(body.references).toHaveLength(2);
    expect(body.references?.[0]?.fields.title.value).toBe('Good study');
    expect(body.references?.[1]?.status).toBe('ok');
    expect(body.references?.[1]?.parseOutcome).toBe('needs_action');
    expect(body.references?.[1]?.publicStatus).toBe('needs_action');
    expect(body.references?.[1]?.fields.doi.value).toBe('10.1000/unresolved-2021-study');
  });
});

async function waitForJob(
  app: FastifyInstance,
  jobId: string,
  jobAccessToken?: string,
): Promise<JobStatusResponse> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}`,
      headers: jobAccessHeaders(jobAccessToken),
    });
    const body = response.json() as JobStatusResponse;

    if (body.status !== 'pending' && body.status !== 'processing') {
      return body;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Job ${jobId} did not complete in time.`);
}

function jobAccessHeaders(jobAccessToken: string | undefined): Record<string, string> {
  return jobAccessToken
    ? { 'x-job-access-token': jobAccessToken }
    : {};
}
