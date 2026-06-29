import type { FastifyInstance } from 'fastify';
import {
  buildMultipartPayload,
  finalizeReport,
  fetchWithTimeout,
  injectWithTimeout,
  printSummary,
  startMlService,
  writeReport,
} from './shared.js';

process.env.NODE_ENV ??= 'test';
process.env.PERSISTENCE_BACKEND ??= 'auto';
process.env.RATE_LIMIT_MAX ??= '1000';
process.env.RATE_LIMIT_WINDOW_MS ??= '60000';
process.env.SESSION_SECRET ??= 'security-harness-session-secret';
process.env.OPENAI_TIMEOUT_MS ??= '200';
process.env.CROSSREF_TIMEOUT_MS ??= '200';
process.env.OPENALEX_TIMEOUT_MS ??= '200';
process.env.RETRACTION_WATCH_TIMEOUT_MS ??= '200';
process.env.ML_SERVICE_TIMEOUT_MS ??= '200';

const [{ buildApp }, { resetRuntimeStore }, { env }] = await Promise.all([
  import('../../src/app.js'),
  import('../../src/runtime/persistence.js'),
  import('../../src/config.js'),
]);

const app = await buildApp();
let mlService: Awaited<ReturnType<typeof startMlService>> | null = null;

const checks: Array<{
  id: string;
  title: string;
  outcome: 'pass' | 'fail' | 'warn';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  evidence?: Record<string, unknown>;
}> = [];

try {
  const rng = createRng(0x5eeda11);

  const serverCases: Array<{
    id: string;
    title: string;
    request: Parameters<FastifyInstance['inject']>[0];
  }> = [
    {
      id: 'convert-invalid-shape',
      title: 'Server fuzz: invalid convert payload shape does not 500',
      request: {
        method: 'POST',
        url: '/v1/convert',
        payload: { sourceType: 'text', content: ['not-a-string'] },
      },
    },
    {
      id: 'convert-weird-unicode',
      title: 'Server fuzz: weird unicode convert payload does not 500',
      request: {
        method: 'POST',
        url: '/v1/convert',
        payload: {
          sourceType: 'text',
          content: randomWeirdString(rng, 180),
          outputStyle: 'apa7',
        },
      },
    },
    {
      id: 'convert-empty-json',
      title: 'Server fuzz: empty convert object does not 500',
      request: {
        method: 'POST',
        url: '/v1/convert',
        payload: {},
      },
    },
    {
      id: 'upload-malformed-multipart',
      title: 'Server fuzz: malformed multipart upload does not 500',
      request: {
        method: 'POST',
        url: '/v1/convert/upload',
        headers: {
          'content-type': 'multipart/form-data; boundary=bad-boundary',
        },
        payload: '--bad-boundary\r\nContent-Disposition: form-data; name="file"; filename="broken.txt"\r\n\r\nunterminated',
      },
    },
    {
      id: 'upload-oversized',
      title: 'Server fuzz: oversized upload is rejected without a 500',
      request: buildOversizedUploadRequest(env.UPLOAD_MAX_BYTES + 32),
    },
    {
      id: 'jobs-missing-id',
      title: 'Server fuzz: random job status probes do not 500',
      request: {
        method: 'GET',
        url: `/v1/jobs/${encodeURIComponent(randomWeirdString(rng, 48))}`,
      },
    },
    {
      id: 'export-random-id',
      title: 'Server fuzz: random export probes do not 500',
      request: {
        method: 'GET',
        url: `/v1/export/${encodeURIComponent(randomWeirdString(rng, 48))}/csv`,
      },
    },
    {
      id: 'events-random-id',
      title: 'Server fuzz: random SSE probes do not 500',
      request: {
        method: 'GET',
        url: `/v1/jobs/${encodeURIComponent(randomWeirdString(rng, 48))}/events`,
      },
    },
    {
      id: 'pro-enrich-invalid-body',
      title: 'Server fuzz: invalid pro-enrich body does not 500',
      request: {
        method: 'POST',
        url: `/v1/jobs/${encodeURIComponent(randomWeirdString(rng, 36))}/pro-enrich`,
        payload: { referenceIds: 'bad-shape' },
      },
    },
  ];

  for (const testCase of serverCases) {
    await runServerCase(app, checks, testCase.id, testCase.title, testCase.request);
  }

  mlService = await startMlService(import.meta.url);

  const mlCases: Array<{
    id: string;
    title: string;
    url: string;
    init: RequestInit;
  }> = [
    {
      id: 'ml-detect-style-wrong-shape',
      title: 'ML fuzz: detect-style rejects wrong shapes without 500',
      url: `${mlService.baseUrl}/v1/ml/detect-style`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: 'bad-shape' }),
      },
    },
    {
      id: 'ml-detect-style-weird-text',
      title: 'ML fuzz: detect-style handles weird unicode without 500',
      url: `${mlService.baseUrl}/v1/ml/detect-style`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: [randomWeirdString(rng, 220)] }),
      },
    },
    {
      id: 'ml-extract-mismatched-batch',
      title: 'ML fuzz: extract rejects mismatched batch lengths without 500',
      url: `${mlService.baseUrl}/v1/ml/extract`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          texts: ['one', 'two'],
          styles: ['apa7'],
        }),
      },
    },
    {
      id: 'ml-extract-over-batch-limit',
      title: 'ML fuzz: extract rejects oversize batch without 500',
      url: `${mlService.baseUrl}/v1/ml/extract`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          texts: Array.from({ length: 129 }, () => 'Smith, J. (2020). Example study.'),
          styles: Array.from({ length: 129 }, () => 'apa7'),
        }),
      },
    },
    {
      id: 'ml-classify-type-wrong-shape',
      title: 'ML fuzz: classify-type rejects wrong shapes without 500',
      url: `${mlService.baseUrl}/v1/ml/classify-type`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: { nested: true } }),
      },
    },
  ];

  for (const testCase of mlCases) {
    await runHttpCase(checks, testCase.id, testCase.title, testCase.url, testCase.init);
  }

  await runMultipartHttpCase(
    checks,
    'ml-pdf-random-bytes',
    'ML fuzz: ingest-pdf random bytes does not 500',
    `${mlService.baseUrl}/v1/ml/ingest-pdf`,
    'probe.pdf',
    'application/pdf',
    Buffer.from(randomWeirdString(rng, 1_024), 'utf8'),
  );

  await runMultipartHttpCase(
    checks,
    'ml-docx-random-bytes',
    'ML fuzz: ingest-docx random bytes does not 500',
    `${mlService.baseUrl}/v1/ml/ingest-docx`,
    'probe.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    Buffer.from(randomWeirdString(rng, 1_024), 'utf8'),
  );
} finally {
  await app.close();
  await resetRuntimeStore();
  if (mlService) {
    await mlService.stop();
  }
}

const report = finalizeReport(
  'Security Fuzz Harness',
  'Exercises malformed runtime and ML inputs to catch 5xx responses, hangs, and parser crashes before they reach production traffic.',
  checks,
);
const reportPaths = await writeReport(import.meta.url, report);
printSummary(report, reportPaths);

if (!report.passed) {
  process.exitCode = 1;
}

async function runServerCase(
  appInstance: FastifyInstance,
  targetChecks: typeof checks,
  id: string,
  title: string,
  request: Parameters<FastifyInstance['inject']>[0],
): Promise<void> {
  try {
    const response = await injectWithTimeout(
      `${request.method ?? 'GET'} ${request.url ?? '/'}`,
      appInstance.inject(request),
      5_000,
    );
    recordNonServerError(targetChecks, id, title, response.statusCode, {
      body: truncate(response.body),
    });
  } catch (error) {
    targetChecks.push({
      id,
      title,
      outcome: 'fail',
      severity: 'high',
      detail: error instanceof Error ? error.message : 'Server fuzz case threw unexpectedly.',
    });
  }
}

async function runHttpCase(
  targetChecks: typeof checks,
  id: string,
  title: string,
  url: string,
  init: RequestInit,
): Promise<void> {
  try {
    const response = await fetchWithTimeout(url, init, 5_000);
    const body = truncate(await response.text());
    recordNonServerError(targetChecks, id, title, response.status, { body });
  } catch (error) {
    targetChecks.push({
      id,
      title,
      outcome: 'fail',
      severity: 'high',
      detail: error instanceof Error ? error.message : 'HTTP fuzz case threw unexpectedly.',
    });
  }
}

async function runMultipartHttpCase(
  targetChecks: typeof checks,
  id: string,
  title: string,
  url: string,
  fileName: string,
  contentType: string,
  bytes: Buffer,
): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), fileName);

  await runHttpCase(targetChecks, id, title, url, {
    method: 'POST',
    body: form,
  });
}

function recordNonServerError(
  targetChecks: typeof checks,
  id: string,
  title: string,
  status: number,
  evidence: Record<string, unknown>,
): void {
  if (status >= 500) {
    targetChecks.push({
      id,
      title,
      outcome: 'fail',
      severity: 'high',
      detail: `Unexpected ${status} response under malformed input.`,
      evidence: {
        status,
        ...evidence,
      },
    });
    return;
  }

  targetChecks.push({
    id,
    title,
    outcome: 'pass',
    severity: 'info',
    detail: `Returned non-5xx status ${status}.`,
  });
}

function buildOversizedUploadRequest(sizeBytes: number): Parameters<FastifyInstance['inject']>[0] {
  const boundary = 'security-fuzz-boundary';
  const payload = buildMultipartPayload(boundary, [
    { name: 'outputStyle', value: 'apa7' },
    {
      name: 'file',
      fileName: 'oversized.txt',
      contentType: 'text/plain',
      value: Buffer.alloc(sizeBytes, 0x61),
    },
  ]);

  return {
    method: 'POST',
    url: '/v1/convert/upload',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  };
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

function randomWeirdString(rng: () => number, length: number): string {
  const alphabet = [
    'A',
    '9',
    ' ',
    '\n',
    '\r',
    '\t',
    '\u0000',
    '\u200b',
    '\u2028',
    '/',
    '\\',
    '%',
    '?',
    '&',
    '=',
    ';',
    ':',
    '<',
    '>',
    '"',
    "'",
    'Ω',
    'Ж',
    '中',
    '😀',
  ];

  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += alphabet[Math.floor(rng() * alphabet.length)] ?? 'X';
  }
  return output;
}

function truncate(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
