import type { FastifyInstance } from 'fastify';
import type { AppError } from '../../src/engine/errors/index.js';
import type { StoredJob } from '../../src/runtime/store.js';
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

const [{ buildApp }, persistence, jobAccess, { env }, guardrails] = await Promise.all([
  import('../../src/app.js'),
  import('../../src/runtime/persistence.js'),
  import('../../src/runtime/jobAccess.js'),
  import('../../src/config.js'),
  import('../../src/runtime/guardrails.js'),
]);

const {
  consumeUsage,
  getUsageForDay,
  resetRuntimeStore,
  resetUsage,
  runtimePersistenceBackend,
  saveJob,
} = persistence;
const { buildJobAccessHeaders } = jobAccess;
const { enforceConcurrentJobLimit } = guardrails;

const checks: Array<{
  id: string;
  title: string;
  outcome: 'pass' | 'fail' | 'warn';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  evidence?: Record<string, unknown>;
}> = [];

const app = await buildApp();
let mlService: Awaited<ReturnType<typeof startMlService>> | null = null;

try {
  await runAsyncUploadTokenFlow(app);
  await runServerUploadLimit(app);
  await runFairnessScenarios(saveJob, enforceConcurrentJobLimit);
  await runUsageRaceScenario({
    consumeUsage,
    getUsageForDay,
    resetUsage,
    runtimePersistenceBackend,
  });

  mlService = await startMlService(import.meta.url);
  await runMlUploadLimit(`${mlService.baseUrl}/v1/ml/ingest-pdf`, 'ml-pdf-upload-limit');
  await runMlUploadLimit(`${mlService.baseUrl}/v1/ml/ingest-docx`, 'ml-docx-upload-limit');
} finally {
  await app.close();
  await resetRuntimeStore();
  if (mlService) {
    await mlService.stop();
  }
}

const report = finalizeReport(
  'Security Realistic Abuse Harness',
  'Runs production-like flows for async uploads, token polling, upload-size enforcement, and multi-tenant concurrency isolation.',
  checks,
);
const reportPaths = await writeReport(import.meta.url, report);
printSummary(report, reportPaths);

if (!report.passed) {
  process.exitCode = 1;
}

async function runAsyncUploadTokenFlow(appInstance: FastifyInstance): Promise<void> {
  const boundary = 'security-realistic-flow';
  const payload = buildMultipartPayload(boundary, [
    { name: 'outputStyle', value: 'apa7' },
    {
      name: 'file',
      fileName: 'references.txt',
      contentType: 'text/plain',
      value: Buffer.from(
        [
          'Smith, J. (2020). Example study. Journal of Examples, 12(3), 44-50.',
          'Doe, A. (2021). Follow-up study. Journal of Examples, 13(1), 10-18.',
        ].join('\n'),
        'utf8',
      ),
    },
  ]);

  const created = await injectWithTimeout(
    'POST /v1/convert/upload',
    appInstance.inject({
      method: 'POST',
      url: '/v1/convert/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    }),
    8_000,
  );

  if (created.statusCode !== 202) {
    checks.push({
      id: 'token-flow-create',
      title: 'Async upload returns a queued job plus access token',
      outcome: 'fail',
      severity: 'high',
      detail: `Expected 202 from async upload but received ${created.statusCode}.`,
      evidence: { body: truncate(created.body) },
    });
    return;
  }

  const createdBody = created.json() as { jobId?: string; jobAccessToken?: string };
  if (!createdBody.jobId || !createdBody.jobAccessToken) {
    checks.push({
      id: 'token-flow-token-missing',
      title: 'Async upload issues a reusable job access token',
      outcome: 'fail',
      severity: 'high',
      detail: 'Queued upload response did not include both jobId and jobAccessToken.',
      evidence: createdBody as Record<string, unknown>,
    });
    return;
  }

  const tokenHeaders = buildJobAccessHeaders(createdBody.jobAccessToken);
  const completed = await waitForTerminalJob(appInstance, createdBody.jobId, tokenHeaders);

  if (completed.statusCode !== 200) {
    checks.push({
      id: 'token-flow-poll',
      title: 'Token-only client can poll async job completion',
      outcome: 'fail',
      severity: 'high',
      detail: `Expected terminal polling to return 200 but received ${completed.statusCode}.`,
      evidence: { body: truncate(completed.body) },
    });
    return;
  }

  checks.push({
    id: 'token-flow-poll',
    title: 'Token-only client can poll async job completion',
    outcome: 'pass',
    severity: 'info',
    detail: 'Async job reached a terminal state through token-based polling.',
  });

  const exportResponse = await injectWithTimeout(
    'GET /v1/export/:jobId/csv',
    appInstance.inject({
      method: 'GET',
      url: `/v1/export/${createdBody.jobId}/csv`,
      headers: tokenHeaders,
    }),
    5_000,
  );

  if (exportResponse.statusCode === 200) {
    checks.push({
      id: 'token-flow-export',
      title: 'Token-only client can download an export after completion',
      outcome: 'pass',
      severity: 'info',
      detail: 'CSV export succeeded with only the job access token.',
    });
    return;
  }

  checks.push({
    id: 'token-flow-export',
    title: 'Token-only client can download an export after completion',
    outcome: 'fail',
    severity: 'high',
    detail: `Expected export download to succeed but received ${exportResponse.statusCode}.`,
    evidence: { body: truncate(exportResponse.body) },
  });
}

async function runServerUploadLimit(appInstance: FastifyInstance): Promise<void> {
  const oversizedBoundary = 'security-server-limit';
  const oversizedPayload = buildMultipartPayload(oversizedBoundary, [
    { name: 'outputStyle', value: 'apa7' },
    {
      name: 'file',
      fileName: 'oversized.txt',
      contentType: 'text/plain',
      value: Buffer.alloc(env.UPLOAD_MAX_BYTES + 1, 0x61),
    },
  ]);

  const response = await injectWithTimeout(
    'POST /v1/convert/upload oversized',
    appInstance.inject({
      method: 'POST',
      url: '/v1/convert/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${oversizedBoundary}`,
      },
      payload: oversizedPayload,
    }),
    8_000,
  );

  if (response.statusCode === 413) {
    checks.push({
      id: 'server-upload-limit',
      title: 'Server upload route enforces the configured byte ceiling',
      outcome: 'pass',
      severity: 'info',
      detail: `Oversized upload was rejected at ${env.UPLOAD_MAX_BYTES} bytes as expected.`,
    });
    return;
  }

  checks.push({
    id: 'server-upload-limit',
    title: 'Server upload route enforces the configured byte ceiling',
    outcome: 'fail',
    severity: 'high',
    detail: `Expected a 413 for oversized upload but received ${response.statusCode}.`,
    evidence: { body: truncate(response.body) },
  });
}

async function runMlUploadLimit(url: string, id: string): Promise<void> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([Buffer.alloc(env.UPLOAD_MAX_BYTES + 1, 0x61)], { type: 'application/octet-stream' }),
    'oversized.bin',
  );
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      body: form,
    },
    10_000,
  );

  if (response.status === 413) {
    checks.push({
      id,
      title: `ML upload route ${new URL(url).pathname} enforces the shared byte ceiling`,
      outcome: 'pass',
      severity: 'info',
      detail: `Oversized upload was rejected with 413 at ${env.UPLOAD_MAX_BYTES} bytes.`,
    });
    return;
  }

  checks.push({
    id,
    title: `ML upload route ${new URL(url).pathname} enforces the shared byte ceiling`,
    outcome: 'fail',
    severity: 'high',
    detail: `Expected a 413 for oversized upload but received ${response.status}.`,
    evidence: {
      status: response.status,
      body: truncate(await response.text()),
    },
  });
}

async function runFairnessScenarios(
  saveJobFn: typeof saveJob,
  enforceConcurrentJobLimitFn: typeof enforceConcurrentJobLimit,
): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await saveJobFn(buildActiveJob(`pro-tenant-a-${index}`, {
      userId: 'pro-tenant-a',
      tier: 'pro',
    }));
  }

  try {
    await enforceConcurrentJobLimitFn('pro', { userId: 'pro-tenant-b' });
    checks.push({
      id: 'pro-tier-fairness',
      title: 'One pro tenant cannot consume the entire shared async pool',
      outcome: 'pass',
      severity: 'info',
      detail: 'A second pro tenant can still admit work when another tenant saturates its own allocation.',
    });
  } catch (error) {
    const typed = error as AppError & { code?: string };
    checks.push({
      id: 'pro-tier-fairness',
      title: 'One pro tenant cannot consume the entire shared async pool',
      outcome: 'fail',
      severity: 'high',
      detail: 'A second pro tenant was blocked after another tenant filled the pro-tier async bucket.',
      evidence: {
        code: typed.code,
        message: typed.message,
      },
    });
  }

  for (let index = 0; index < 25; index += 1) {
    await saveJobFn(buildActiveJob(`b2b-tenant-a-${index}`, {
      orgId: 'org-a',
      tier: 'b2b',
    }));
  }

  try {
    await enforceConcurrentJobLimitFn('b2b', { orgId: 'org-b' });
    checks.push({
      id: 'b2b-scope-isolation',
      title: 'B2B async limits stay scoped per organization',
      outcome: 'pass',
      severity: 'info',
      detail: 'A second B2B organization can still admit work when another organization is at its local cap.',
    });
  } catch (error) {
    const typed = error as AppError & { code?: string };
    checks.push({
      id: 'b2b-scope-isolation',
      title: 'B2B async limits stay scoped per organization',
      outcome: 'fail',
      severity: 'medium',
      detail: 'B2B organization scoping behaved like a shared global pool unexpectedly.',
      evidence: {
        code: typed.code,
        message: typed.message,
      },
    });
  }
}

async function runUsageRaceScenario(deps: {
  consumeUsage: typeof consumeUsage;
  getUsageForDay: typeof getUsageForDay;
  resetUsage: typeof resetUsage;
  runtimePersistenceBackend: typeof runtimePersistenceBackend;
}): Promise<void> {
  const dayKey = '2099-01-01';
  const scope = { userId: 'race-test-user' };
  const increments = 64;
  await deps.resetUsage(dayKey, scope);

  await Promise.all(
    Array.from({ length: increments }, async () => {
      await deps.consumeUsage(1, dayKey, scope);
    }),
  );
  const total = await deps.getUsageForDay(dayKey, scope);

  if (total === increments) {
    checks.push({
      id: 'usage-race-atomicity',
      title: 'Usage metering resists lost-update race attempts',
      outcome: 'pass',
      severity: 'info',
      detail: `Concurrent increments produced ${total}/${increments} expected usage events (${deps.runtimePersistenceBackend} backend).`,
    });
    return;
  }

  checks.push({
    id: 'usage-race-atomicity',
    title: 'Usage metering resists lost-update race attempts',
    outcome: 'fail',
    severity: 'high',
    detail: `Concurrent usage increments lost updates (${total}/${increments}) on ${deps.runtimePersistenceBackend} backend.`,
    evidence: {
      backend: deps.runtimePersistenceBackend,
      expected: increments,
      actual: total,
    },
  });
}

function buildActiveJob(
  jobId: string,
  owner: Pick<StoredJob, 'userId' | 'orgId' | 'tier'>,
): StoredJob {
  return {
    id: jobId,
    request: {
      sourceType: 'doi_list',
      content: '10.1000/example',
      outputStyle: 'apa7',
    },
    ...(owner.userId ? { userId: owner.userId } : {}),
    ...(owner.orgId ? { orgId: owner.orgId } : {}),
    ...(owner.tier ? { tier: owner.tier } : {}),
    executionMode: 'async',
    status: 'processing',
    createdAt: new Date().toISOString(),
    progress: {
      totalRefs: 1,
      processedRefs: 0,
      currentPhase: 'ingestion',
      percentComplete: 5,
    },
    exports: {},
    events: [],
  };
}

async function waitForTerminalJob(
  appInstance: FastifyInstance,
  jobId: string,
  headers: Record<string, string>,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await injectWithTimeout(
      `GET /v1/jobs/${jobId}`,
      appInstance.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers,
      }),
      5_000,
    );
    if (response.statusCode !== 200) {
      return response;
    }

    const body = response.json() as { status?: string };
    if (body.status !== 'pending' && body.status !== 'processing') {
      return response;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Job ${jobId} did not reach a terminal state in time.`);
}

function truncate(value: string, maxLength = 320): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
