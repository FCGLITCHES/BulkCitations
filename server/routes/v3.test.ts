import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import v3Router from './v3.js';

describe('v3 routes', () => {
  let server: ReturnType<express.Express['listen']>;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v3', v3Router);

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

  it('returns a typed v3 envelope with field provenance and score adjustments', async () => {
    const response = await fetch(`${baseUrl}/api/v3/convert`, {
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
        debug: false,
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      engineVersion: 'v3';
      citations: Array<{
        contractVersion: number;
        fieldLocks?: Record<string, { class: string }>;
        fieldProvenance?: Record<string, { source: string }>;
        rawScore?: number;
        displayScore?: number;
        renderMetadata?: { contractVersion: number; renderSource: string };
      }>;
      processingPath?: { stagesRun?: string[]; contractVersions?: Record<string, number> };
    };

    expect(payload.engineVersion).toBe('v3');
    expect(payload.processingPath?.stagesRun).toEqual([
      'ingest',
      'split',
      'detect_style',
      'extract_fields',
      'parse_authors',
      'classify_type',
      'normalize',
      'enrich',
      'llm_repair',
      'dedup',
      'base_score',
      'authority_validate_and_adjust',
      'render',
    ]);
    expect(payload.processingPath?.contractVersions?.render).toBe(1);
    expect(payload.citations).toHaveLength(1);
    expect(payload.citations[0].contractVersion).toBe(1);
    expect(payload.citations[0].fieldLocks?.title).toBeTruthy();
    expect(payload.citations[0].fieldProvenance?.title?.source).toBeTruthy();
    expect(payload.citations[0].rawScore).toBeTypeOf('number');
    expect(payload.citations[0].displayScore).toBeTypeOf('number');
    expect(payload.citations[0].renderMetadata?.contractVersion).toBe(1);
  });

  it('preserves locked field values supplied through v3 metadata hydration', async () => {
    const rawCitation = 'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.';
    const response = await fetch(`${baseUrl}/api/v3/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'text',
        content: rawCitation,
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrich: false,
        dedup: true,
        group: false,
        debug: false,
        metadata: {
          fieldLocksByRaw: {
            [rawCitation]: {
              title: {
                class: 'verified',
                source: 'user_correction',
                locked: true,
                value: 'Locked Title',
              },
            },
          },
        },
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      citations: Array<{
        title?: { value?: string };
        fieldProvenance?: Record<string, { source: string }>;
        fieldLocks?: Record<string, { class: string; locked: boolean }>;
      }>;
    };

    expect(payload.citations).toHaveLength(1);
    expect(payload.citations[0].title?.value).toBe('Locked Title');
    expect(payload.citations[0].fieldProvenance?.title?.source).toBe('user_correction');
    expect(payload.citations[0].fieldLocks?.title?.class).toBe('verified');
    expect(payload.citations[0].fieldLocks?.title?.locked).toBe(true);
  });
});
