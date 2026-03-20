import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import v2Router from './v2.js';

describe('v2 routes', () => {
  let server: ReturnType<express.Express['listen']>;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v2', v2Router);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Could not determine test server address');
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it('converts citations and exposes export endpoints for the stored job', async () => {
    const convertResponse = await fetch(`${baseUrl}/api/v2/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'text',
        content: 'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: true,
        group: false,
        debug: true,
      }),
    });

    expect(convertResponse.ok).toBe(true);
    const payload = await convertResponse.json() as {
      job_id: string;
      exports: { txt: string };
      citations: Array<{ rendered?: { formatted?: string } }>;
      processingPath?: { executionMode?: string; extractorPathsUsed?: string[] };
      debug?: { enabled?: boolean; citations?: Array<{ stages?: Record<string, unknown> }> };
    };
    expect(payload.job_id).toBeTruthy();
    expect(payload.citations.length).toBe(1);
    expect(payload.processingPath?.executionMode).toBe('sync');
    expect(payload.processingPath?.extractorPathsUsed?.length).toBeGreaterThan(0);
    expect(payload.debug?.enabled).toBe(true);
    expect(payload.debug?.citations?.[0]?.stages?.extract).toBeTruthy();

    const exportResponse = await fetch(`${baseUrl}${payload.exports.txt}`);
    expect(exportResponse.ok).toBe(true);
    const exportText = await exportResponse.text();
    expect(exportText).toContain('Smith');
  });

  it('creates async jobs and allows polling plus docx export', async () => {
    const createResponse = await fetch(`${baseUrl}/api/v2/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'text',
        content: 'Doe, J. (2021). Async pipelines in practice. Journal of Systems, 3(1), 44-50.',
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: true,
        group: false,
      }),
    });

    expect(createResponse.status).toBe(202);
    const queued = await createResponse.json() as { job_id: string; status: string };
    expect(queued.status).toBe('queued');

    let polled: { status: string; result?: { exports: { docx: string }; processingPath?: { executionMode?: string } } } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pollResponse = await fetch(`${baseUrl}/api/v2/jobs/${queued.job_id}`);
      expect(pollResponse.ok).toBe(true);
      polled = await pollResponse.json() as { status: string; result?: { exports: { docx: string }; processingPath?: { executionMode?: string } } };
      if (polled.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(polled?.status).toBe('completed');
    expect(polled?.result?.processingPath?.executionMode).toBe('async');
    expect(polled?.result?.exports.docx).toContain('format=docx');

    const exportResponse = await fetch(`${baseUrl}${polled!.result!.exports.docx}`);
    expect(exportResponse.ok).toBe(true);
    expect(exportResponse.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('auto-switches large v2 convert requests onto async jobs', async () => {
    const content = Array.from({ length: 80 }, (_, index) => `Smith, J. (${2020 + (index % 3)}). Example title ${index + 1}. Journal of Quality, 10(2), 11-19.`).join('\n\n');
    const response = await fetch(`${baseUrl}/api/v2/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'text',
        content,
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: true,
        group: false,
      }),
    });

    expect(response.status).toBe(202);
    const payload = await response.json() as { job_id: string; status: string; executionMode?: string; estimatedCitationCount?: number };
    expect(payload.job_id).toBeTruthy();
    expect(payload.status).toBe('queued');
    expect(payload.executionMode).toBe('async');
    expect(payload.estimatedCitationCount).toBeGreaterThanOrEqual(75);
  });
});
