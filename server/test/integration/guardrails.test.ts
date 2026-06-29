import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { env } from '../../src/config.js';
import { resetRuntimeStore, saveJob } from '../../src/runtime/persistence.js';

describe('runtime guardrails and error envelopes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await resetRuntimeStore();
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('rejects requests that exceed the daily reference quota', async () => {
    app = await buildApp();
    const largePayload = {
      sourceType: 'doi_list',
      content: Array.from({ length: 10 }, (_, index) => `10.1000/quota-study-${index + 1}`).join('\n'),
      outputStyle: 'apa7',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: largePayload,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'doi_list',
        content: '10.1000/quota-overflow-study',
        outputStyle: 'apa7',
      },
    });

    expect(second.statusCode).toBe(429);
    const body = second.json() as { error: string; message: string };
    expect(body.error).toBe('QUOTA_EXCEEDED');
    expect(typeof body.message).toBe('string');
  });

  it('rejects async requests when the concurrent job cap is already reached', async () => {
    app = await buildApp();

    await saveJob({
      id: 'pending-1',
      request: {
        sourceType: 'doi_list',
        content: '10.1000/a',
        outputStyle: 'apa7',
      },
      tier: 'anonymous',
      executionMode: 'async',
      status: 'pending',
      createdAt: new Date().toISOString(),
      exports: {},
      events: [],
    });
    await saveJob({
      id: 'pending-2',
      request: {
        sourceType: 'doi_list',
        content: '10.1000/b',
        outputStyle: 'apa7',
      },
      tier: 'anonymous',
      executionMode: 'async',
      status: 'processing',
      createdAt: new Date().toISOString(),
      exports: {},
      events: [],
    });

    const boundary = '----bulkreferences-concurrent-boundary';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="outputStyle"',
      '',
      'apa7',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="references.txt"',
      'Content-Type: text/plain',
      '',
      '10.1000/concurrent-overflow-study',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody,
    });

    expect(response.statusCode).toBe(429);
    expect((response.json() as { error: string }).error).toBe('CONCURRENT_JOB_LIMIT');
  });

  it('keeps the error response envelope consistent across validation and not-found failures', async () => {
    app = await buildApp();

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/convert',
      payload: {
        sourceType: 'text',
        content: '',
      },
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/jobs/missing-job',
    });

    for (const response of [invalid, missing]) {
      expect(response.statusCode >= 400).toBe(true);
      const body = response.json() as { error?: string; message?: string };
      expect(typeof body.error).toBe('string');
      expect(typeof body.message).toBe('string');
    }
  });

  it('rejects uploads that exceed the configured multipart size limit', async () => {
    app = await buildApp();

    const boundary = '----bulkreferences-upload-limit-boundary';
    const oversizedBody = 'x'.repeat(env.UPLOAD_MAX_BYTES + 1);
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="outputStyle"',
      '',
      'apa7',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="references.txt"',
      'Content-Type: text/plain',
      '',
      oversizedBody,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody,
    });

    expect(response.statusCode).toBe(413);
    expect((response.json() as { error: string }).error).toBe('INGEST_FILE_TOO_LARGE');
  });

  it('normalizes malformed multipart uploads into a client validation error instead of a 500', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/convert/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=bad-boundary',
      },
      payload: '--bad-boundary\r\nContent-Disposition: form-data; name="file"; filename="broken.txt"\r\n\r\nunterminated',
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toBe('INPUT_VALIDATION_FAILED');
  });
});
