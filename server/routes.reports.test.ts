import { randomUUID } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CitationReport } from '@shared/schema';
import { registerRoutes } from './routes.js';
import { computeFingerprint, saveReport } from './store/reportStore.js';
import { getTruth } from './store/truthStore.js';

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });

  expect(response.ok).toBe(true);
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return String(setCookie).split(';', 1)[0] ?? '';
}

function buildReport(overrides: Partial<CitationReport> = {}): CitationReport {
  const originalText = overrides.originalText
    ?? `Smith, J. (2020). Broken title ${randomUUID()}. Broken Journal, 1(1), 10-12. https://doi.org/10.5555/${randomUUID()}`;

  return {
    id: overrides.id ?? randomUUID(),
    source: overrides.source ?? 'user',
    originalText,
    detectedStyle: overrides.detectedStyle ?? 'apa',
    outputStyle: overrides.outputStyle ?? 'apa',
    parsedData: overrides.parsedData ?? {
      authors: ['Smith, J.'],
      title: 'Broken title',
      year: '2020',
      journal: 'Broken Journal',
      volume: '1',
      issue: '1',
      pages: '10-12',
      doi: `10.5555/${randomUUID()}`,
    },
    referenceType: overrides.referenceType ?? 'journal',
    convertedText: overrides.convertedText ?? 'Broken output',
    confidence: overrides.confidence ?? 38,
    failureCategory: overrides.failureCategory ?? 'title',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    fingerprint: overrides.fingerprint ?? computeFingerprint(originalText),
    reportCount: overrides.reportCount ?? 1,
    reviewEvents: overrides.reviewEvents ?? [],
    originalEngineOutput: overrides.originalEngineOutput ?? {
      convertedText: overrides.convertedText ?? 'Broken output',
      parsedData: overrides.parsedData ?? {
        authors: ['Smith, J.'],
        title: 'Broken title',
        year: '2020',
        journal: 'Broken Journal',
        volume: '1',
        issue: '1',
        pages: '10-12',
        doi: `10.5555/${randomUUID()}`,
      },
      referenceType: overrides.referenceType ?? 'journal',
      confidence: overrides.confidence ?? 38,
    },
    ...overrides,
  };
}

describe('report truth persistence', () => {
  let server: Awaited<ReturnType<typeof registerRoutes>>;
  let baseUrl = '';
  let adminCookie = '';

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = 'codex-admin-test';
    process.env.ADMIN_SESSION_SECRET = 'codex-admin-secret';

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    server = await registerRoutes(app);

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

    adminCookie = await login(baseUrl);
  });

  afterAll(async () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it('auto-saves approved field corrections as truth during resolve', async () => {
    const report = await saveReport(buildReport({
      originalText: `Smith, J. (2020). Broken title ${randomUUID()}. Broken Journal, 1(1), 10-12. https://doi.org/10.5555/resolve-${randomUUID()}`,
      parsedData: {
        authors: ['Smith, J.'],
        title: 'Broken title',
        year: '2020',
        journal: 'Broken Journal',
        volume: '1',
        issue: '1',
        pages: '10-12',
        doi: `10.5555/resolve-${randomUUID()}`,
      },
    }));

    const response = await fetch(`${baseUrl}/api/reports/${report.id}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        fixType: 'parser-logic',
        correctedFields: {
          title: 'Approved title',
          journal: 'Approved Journal',
          year: 2020,
          doi: report.parsedData?.doi,
        },
        fieldApproval: {
          title: { approved: true, value: 'Approved title' },
          journal: { approved: true, value: 'Approved Journal' },
          year: { approved: true, value: 2020 },
          doi: { approved: true, value: report.parsedData?.doi },
        },
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as { report: CitationReport };
    expect(payload.report.truthId).toBeTruthy();
    expect(payload.report.finalApprovedOutput).toContain('Approved title');
    expect(payload.report.finalApprovedOutput).toContain('Approved Journal');

    const truth = await getTruth(report.originalText, report.outputStyle);
    expect(truth?.truthId).toBe(payload.report.truthId);
    expect(truth?.correctedFields?.title).toBe('Approved title');
    expect(truth?.validatedOutput).toContain('Approved title');
  });

  it('persists existing approved truth data during accept', async () => {
    const finalApprovedOutput = 'Smith, J. (2021). Accepted title. Accepted Journal, 2(3), 44-52.';
    const report = await saveReport(buildReport({
      originalText: `Smith, J. (2021). Accepted title ${randomUUID()}. Accepted Journal, 2(3), 44-52. https://doi.org/10.5555/accept-${randomUUID()}`,
      parsedData: {
        authors: ['Smith, J.'],
        title: 'Accepted title',
        year: '2021',
        journal: 'Accepted Journal',
        volume: '2',
        issue: '3',
        pages: '44-52',
        doi: `10.5555/accept-${randomUUID()}`,
      },
      correctedFields: {
        title: 'Accepted title',
        journal: 'Accepted Journal',
        year: 2021,
      },
      fieldApproval: {
        title: { approved: true, value: 'Accepted title' },
        journal: { approved: true, value: 'Accepted Journal' },
        year: { approved: true, value: 2021 },
      },
      finalApprovedOutput,
    }));

    const response = await fetch(`${baseUrl}/api/reports/${report.id}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        verifiedBy: 'admin',
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as { report: CitationReport };
    expect(payload.report.truthId).toBeTruthy();
    expect(payload.report.finalApprovedOutput).toBe(finalApprovedOutput);

    const truth = await getTruth(report.originalText, report.outputStyle);
    expect(truth?.truthId).toBe(payload.report.truthId);
    expect(truth?.validatedOutput).toBe(finalApprovedOutput);
    expect(truth?.correctedFields?.journal).toBe('Accepted Journal');
  });
});
