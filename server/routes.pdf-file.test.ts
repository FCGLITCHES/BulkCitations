import express from 'express';
import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import type { V2ConversionRequest } from '@shared/schema';
import { PDF_MAX_BYTES, getPdfErrorMessage } from './pdfProcessing.js';
import { registerRoutes } from './routes.js';
import { v2JobStorage } from './v2JobStorage.js';

const PDF_JOB_DIR = path.resolve(process.cwd(), 'tmp', 'pdfs', 'jobs');

async function createPdfBuffer(lines: string[], options?: { userPassword?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      userPassword: options?.userPassword,
      margin: 48,
    });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);

    if (lines.length === 0) {
      doc.addPage();
    } else {
      lines.forEach((line, index) => {
        doc.text(line);
        if (index < lines.length - 1) doc.moveDown();
      });
    }

    doc.end();
  });
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const server = await registerRoutes(app);
  let baseUrl = '';

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Could not determine test server address');
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  return { server, baseUrl };
}

async function stopServer(server: Awaited<ReturnType<typeof registerRoutes>>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function uploadPdf(baseUrl: string, fileName: string, buffer: Buffer, fields?: Record<string, string>) {
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName);
  for (const [key, value] of Object.entries(fields ?? {})) {
    formData.append(key, value);
  }

  return fetch(`${baseUrl}/api/convert-file`, {
    method: 'POST',
    body: formData,
  });
}

async function pollPdfJob(baseUrl: string, jobId: string, maxAttempts = 50) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/convert-file/jobs/${jobId}`);
    const payload = await response.json().catch(() => ({}));

    if (response.status === 404) {
      return { response, payload };
    }

    if ('convertedReferences' in (payload as Record<string, unknown>) || (payload as { status?: string }).status === 'failed') {
      return { response, payload };
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out polling PDF job ${jobId}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createQueuedPdfJob(options: {
  id?: string;
  tempPath: string;
  expiresAt: Date;
  originalFilename: string;
  markProcessingAt?: Date;
}) {
  const id = options.id ?? randomUUID();
  const request: V2ConversionRequest = {
    sourceType: 'pdf_file',
    content: options.tempPath,
    inputStyle: 'auto',
    outputStyle: 'apa',
    enrich: false,
    dedup: true,
    group: false,
    debug: false,
    metadata: {
      fileJob: true,
      tempPath: options.tempPath,
      originalFilename: options.originalFilename,
      byteSize: 1,
    },
  };

  await v2JobStorage.createQueuedJob(request, {
    id,
    expiresAt: options.expiresAt,
    metadata: {
      fileJob: true,
      tempPath: options.tempPath,
      originalFilename: options.originalFilename,
      byteSize: 1,
    },
  });

  if (options.markProcessingAt) {
    await v2JobStorage.markProcessing(id, { startedAt: options.markProcessingAt });
  }

  return id;
}

describe('PDF upload routes', () => {
  const openServers = new Set<Awaited<ReturnType<typeof registerRoutes>>>();

  afterEach(async () => {
    for (const server of openServers) {
      await stopServer(server);
    }
    openServers.clear();
  });

  it('queues native PDF uploads, polls them to completion, and deletes the temp file', async () => {
    const pdfBuffer = await createPdfBuffer([
      'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
    ]);
    const { server, baseUrl } = await startServer();
    openServers.add(server);

    const createResponse = await uploadPdf(baseUrl, 'success.pdf', pdfBuffer, {
      inputStyle: 'auto',
      outputStyle: 'apa',
    });
    expect(createResponse.status).toBe(202);
    const queued = await createResponse.json() as {
      job_id: string;
      status: string;
      executionMode: string;
      engineVersion: string;
      expiresAt: string;
    };
    expect(queued.status).toBe('queued');
    expect(queued.executionMode).toBe('async');
    expect(queued.engineVersion).toBe('v2');
    expect(typeof queued.expiresAt).toBe('string');

    const tempPath = path.join(PDF_JOB_DIR, `${queued.job_id}.pdf`);
    expect(await fileExists(tempPath)).toBe(true);

    const { response, payload } = await pollPdfJob(baseUrl, queued.job_id);
    expect(response.ok).toBe(true);
    expect((payload as { convertedReferences?: unknown[] }).convertedReferences).toHaveLength(1);
    expect((payload as { convertedReferences: Array<{ parsedData?: { title?: string } }> }).convertedReferences[0]?.parsedData?.title).toBeTruthy();
    expect(await fileExists(tempPath)).toBe(false);
  }, 120000);

  it('returns a stable encrypted-PDF failure code', async () => {
    const pdfBuffer = await createPdfBuffer([
      'Encrypted PDF content.',
    ], { userPassword: 'secret-password' });
    const { server, baseUrl } = await startServer();
    openServers.add(server);

    const createResponse = await uploadPdf(baseUrl, 'encrypted.pdf', pdfBuffer);
    expect(createResponse.status).toBe(202);
    const queued = await createResponse.json() as { job_id: string };

    const { response, payload } = await pollPdfJob(baseUrl, queued.job_id);
    expect(response.ok).toBe(true);
    expect((payload as { status?: string }).status).toBe('failed');
    expect((payload as { error?: { code?: string; message?: string } }).error?.code).toBe('pdf_encrypted');
    expect((payload as { error?: { message?: string } }).error?.message).toBe(getPdfErrorMessage('pdf_encrypted'));
  }, 120000);

  it('returns a stable corrupt-PDF failure code', async () => {
    const { server, baseUrl } = await startServer();
    openServers.add(server);

    const createResponse = await uploadPdf(baseUrl, 'corrupt.pdf', Buffer.from('not-a-valid-pdf'));
    expect(createResponse.status).toBe(202);
    const queued = await createResponse.json() as { job_id: string };

    const { payload } = await pollPdfJob(baseUrl, queued.job_id);
    expect((payload as { status?: string }).status).toBe('failed');
    expect((payload as { error?: { code?: string; message?: string } }).error?.code).toBe('pdf_corrupt');
    expect((payload as { error?: { message?: string } }).error?.message).toBe(getPdfErrorMessage('pdf_corrupt'));
  }, 120000);

  it('returns a stable no-text-PDF failure code', async () => {
    const pdfBuffer = await createPdfBuffer([]);
    const { server, baseUrl } = await startServer();
    openServers.add(server);

    const createResponse = await uploadPdf(baseUrl, 'blank.pdf', pdfBuffer);
    expect(createResponse.status).toBe(202);
    const queued = await createResponse.json() as { job_id: string };

    const { payload } = await pollPdfJob(baseUrl, queued.job_id);
    expect((payload as { status?: string }).status).toBe('failed');
    expect((payload as { error?: { code?: string; message?: string } }).error?.code).toBe('pdf_no_text');
    expect((payload as { error?: { message?: string } }).error?.message).toBe(getPdfErrorMessage('pdf_no_text'));
  }, 120000);

  it('rejects oversize PDF uploads before queueing', async () => {
    const { server, baseUrl } = await startServer();
    openServers.add(server);

    const response = await uploadPdf(baseUrl, 'too-large.pdf', Buffer.alloc(PDF_MAX_BYTES + 1, 0x20));
    expect(response.status).toBe(413);
    const payload = await response.json() as { code?: string; error?: string };
    expect(payload.code).toBe('pdf_too_large');
    expect(payload.error).toBe(getPdfErrorMessage('pdf_too_large'));
  });

  it('marks queued jobs with missing temp files as source_unavailable during startup recovery', async () => {
    const missingPath = path.join(PDF_JOB_DIR, `${randomUUID()}.pdf`);
    const jobId = await createQueuedPdfJob({
      tempPath: missingPath,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      originalFilename: 'missing-source.pdf',
    });

    const { server, baseUrl } = await startServer();
    openServers.add(server);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response = await fetch(`${baseUrl}/api/convert-file/jobs/${jobId}`);
    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      status?: string;
      error?: { code?: string; message?: string };
    };
    expect(payload.status).toBe('failed');
    expect(payload.error?.code).toBe('source_unavailable');
    expect(payload.error?.message).toBe(getPdfErrorMessage('source_unavailable'));
  });

  it('returns job_expired for expired jobs and removes their temp file', async () => {
    await mkdir(PDF_JOB_DIR, { recursive: true });
    const tempPath = path.join(PDF_JOB_DIR, `${randomUUID()}.pdf`);
    await writeFile(tempPath, Buffer.from('expired-placeholder'));
    const jobId = await createQueuedPdfJob({
      tempPath,
      expiresAt: new Date(Date.now() - 1_000),
      originalFilename: 'expired.pdf',
    });

    const { server, baseUrl } = await startServer();
    openServers.add(server);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response = await fetch(`${baseUrl}/api/convert-file/jobs/${jobId}`);
    expect(response.status).toBe(404);
    const payload = await response.json() as { code?: string; message?: string };
    expect(payload.code).toBe('job_expired');
    expect(payload.message).toBe(getPdfErrorMessage('job_expired'));
    expect(await fileExists(tempPath)).toBe(false);
  });

  it('re-enqueues stale processing jobs on startup', async () => {
    await mkdir(PDF_JOB_DIR, { recursive: true });
    const jobId = randomUUID();
    const tempPath = path.join(PDF_JOB_DIR, `${jobId}.pdf`);
    const pdfBuffer = await createPdfBuffer([
      'Doe, J. (2021). Async pipelines in practice. Journal of Systems, 3(1), 44-50.',
    ]);
    await writeFile(tempPath, pdfBuffer);
    await createQueuedPdfJob({
      id: jobId,
      tempPath,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      originalFilename: 'stale-processing.pdf',
      markProcessingAt: new Date(Date.now() - (2 * 60 * 1000 + 5_000)),
    });

    const { server, baseUrl } = await startServer();
    openServers.add(server);

    const { response, payload } = await pollPdfJob(baseUrl, jobId);
    expect(response.ok).toBe(true);
    expect((payload as { convertedReferences?: unknown[] }).convertedReferences).toHaveLength(1);
    expect(await fileExists(tempPath)).toBe(false);
  }, 120000);
});
