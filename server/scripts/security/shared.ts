import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export type HarnessOutcome = 'pass' | 'fail' | 'warn';
export type HarnessSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface HarnessCheck {
  id: string;
  title: string;
  outcome: HarnessOutcome;
  severity: HarnessSeverity;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface HarnessReport {
  harness: string;
  createdAt: string;
  passed: boolean;
  summary: string;
  checks: HarnessCheck[];
}

export interface MlServiceHandle {
  baseUrl: string;
  logs(): { stdout: string; stderr: string };
  stop(): Promise<void>;
}

interface ReportPaths {
  jsonPath: string;
  markdownPath: string;
}

interface MultipartTextPart {
  name: string;
  value: string;
}

interface MultipartFilePart {
  name: string;
  fileName: string;
  contentType: string;
  value: Buffer;
}

type MultipartPart = MultipartTextPart | MultipartFilePart;

const MAX_LOG_CHARS = 12_000;
const DEFAULT_ML_SERVICE_STARTUP_TIMEOUT_MS = 75_000;

type ArtifactDestination = 'checked-in' | 'local';

export function repoRootFromMeta(metaUrl: string): string {
  return fileURLToPath(new URL('../../..', metaUrl));
}

export function reportDirectoryFromMeta(metaUrl: string): string {
  const canonicalDir = fileURLToPath(new URL('../../../docs/test-results/security', metaUrl));
  return readArtifactDestination(process.env.SECURITY_REPORT_DESTINATION) === 'local'
    ? path.join(canonicalDir, 'local')
    : canonicalDir;
}

export function finalizeReport(
  harness: string,
  summary: string,
  checks: HarnessCheck[],
): HarnessReport {
  return {
    harness,
    createdAt: new Date().toISOString(),
    passed: checks.every((check) => check.outcome !== 'fail'),
    summary,
    checks,
  };
}

export async function writeReport(
  metaUrl: string,
  report: HarnessReport,
): Promise<ReportPaths> {
  const outputDir = reportDirectoryFromMeta(metaUrl);
  await mkdir(outputDir, { recursive: true });

  const timestamp = report.createdAt.replace(/[:.]/g, '-');
  const slug = report.harness.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  const jsonPath = path.join(outputDir, `${slug}-${timestamp}.json`);
  const markdownPath = path.join(outputDir, `${slug}-${timestamp}.md`);

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderMarkdown(report), 'utf8');

  return { jsonPath, markdownPath };
}

export function printSummary(report: HarnessReport, paths: ReportPaths): void {
  const failed = report.checks.filter((check) => check.outcome === 'fail').length;
  const warned = report.checks.filter((check) => check.outcome === 'warn').length;

  process.stdout.write(
    [
      `Harness: ${report.harness}`,
      `Created: ${report.createdAt}`,
      `Passed: ${String(report.passed)}`,
      `Checks: ${report.checks.length}`,
      `Failures: ${failed}`,
      `Warnings: ${warned}`,
      `Summary: ${report.summary}`,
      `JSON: ${paths.jsonPath}`,
      `Markdown: ${paths.markdownPath}`,
      '',
    ].join('\n'),
  );
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 5_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function waitFor<T>(
  label: string,
  task: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await task();
    if (result !== null) {
      return result;
    }
    await delay(intervalMs);
  }

  throw new Error(`${label} did not complete within ${timeoutMs}ms.`);
}

export async function startMlService(metaUrl: string): Promise<MlServiceHandle> {
  const repoRoot = repoRootFromMeta(metaUrl);
  const port = 18_000 + Math.floor(Math.random() * 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const startupTimeoutMs = readMlServiceStartupTimeoutMs();

  let stdout = '';
  let stderr = '';
  const child = spawn(
    'python',
    ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'ml-service', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk: Buffer | string) => {
    stdout = appendLog(stdout, chunk);
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderr = appendLog(stderr, chunk);
  });

  try {
    await waitFor(
      'ML service startup',
      async () => {
        if (child.exitCode !== null) {
          throw new Error(`ML service exited early with code ${child.exitCode}.\n${stderr || stdout}`);
        }

        try {
          const response = await fetchWithTimeout(`${baseUrl}/v1/ml/health`, {}, 1_000);
          if (response.ok) {
            return true;
          }
        } catch {
          // Ignore until timeout.
        }

        return null;
      },
      startupTimeoutMs,
      250,
    );
  } catch (error) {
    await stopChild(child);
    const startupLogs = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
    if (error instanceof Error && startupLogs) {
      throw new Error(`${error.message}\n${startupLogs}`);
    }
    throw error;
  }

  return {
    baseUrl,
    logs() {
      return { stdout, stderr };
    },
    async stop() {
      await stopChild(child);
    },
  };
}

export function readMlServiceStartupTimeoutMs(): number {
  return parsePositiveIntEnv(
    process.env.SECURITY_ML_STARTUP_TIMEOUT_MS,
    DEFAULT_ML_SERVICE_STARTUP_TIMEOUT_MS,
  );
}

export async function injectWithTimeout<T>(
  label: string,
  task: Promise<T>,
  timeoutMs = 5_000,
): Promise<T> {
  return Promise.race([
    task,
    delay(timeoutMs).then(() => {
      throw new Error(`${label} timed out after ${timeoutMs}ms.`);
    }),
  ]);
}

export function buildMultipartPayload(boundary: string, parts: MultipartPart[]): Buffer {
  const buffers: Buffer[] = [];

  for (const part of parts) {
    buffers.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    if ('fileName' in part) {
      buffers.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.fileName}"\r\n`,
          'utf8',
        ),
      );
      buffers.push(Buffer.from(`Content-Type: ${part.contentType}\r\n\r\n`, 'utf8'));
      buffers.push(part.value);
      buffers.push(Buffer.from('\r\n', 'utf8'));
      continue;
    }

    buffers.push(
      Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`, 'utf8'),
    );
  }

  buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(buffers);
}

function appendLog(current: string, chunk: Buffer | string): string {
  return `${current}${chunk.toString()}`.slice(-MAX_LOG_CHARS);
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readArtifactDestination(value: string | undefined): ArtifactDestination {
  if (value === 'checked-in' || value === 'local') {
    return value;
  }

  return isCiEnvironment() ? 'checked-in' : 'local';
}

function isCiEnvironment(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

async function stopChild(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill();
  const exitRace = Promise.race([
    once(child, 'exit'),
    delay(5_000).then(() => 'timeout'),
  ]);
  const result = await exitRace;
  if (result === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

function renderMarkdown(report: HarnessReport): string {
  const lines = [
    `# ${report.harness}`,
    '',
    `- Created: ${report.createdAt}`,
    `- Passed: ${report.passed ? 'yes' : 'no'}`,
    `- Summary: ${report.summary}`,
    '',
    '## Checks',
    '',
  ];

  for (const check of report.checks) {
    lines.push(`- [${check.outcome.toUpperCase()}][${check.severity}] ${check.title}`);
    lines.push(`  - ${check.detail}`);
    if (check.evidence && Object.keys(check.evidence).length > 0) {
      lines.push('  - Evidence:');
      lines.push('```json');
      lines.push(JSON.stringify(check.evidence, null, 2));
      lines.push('```');
    }
  }

  lines.push('');
  return lines.join('\n');
}
