import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerRoutes } from './routes.js';

describe('legacy /api/convert routing', () => {
  let server: Awaited<ReturnType<typeof registerRoutes>>;
  let baseUrl = '';

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it('routes /api/convert through v3 by default while keeping the legacy response shape', async () => {
    delete process.env.USE_V2_ENGINE;

    const response = await fetch(`${baseUrl}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        references: [
          'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
        ],
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrichWithAuthority: false,
        isPro: false,
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      convertedReferences: Array<{
        id: string;
        parsedData: { title?: string };
        healthState?: string;
        reportEngineSnapshot?: { engineVersion?: 'v1' | 'v2' | 'v3' };
      }>;
      engineVersion?: 'v1' | 'v2' | 'v3';
    };
    expect(payload.engineVersion).toBe('v3');
    expect(payload.convertedReferences).toHaveLength(1);
    expect(payload.convertedReferences[0].id).toMatch(/^\d+$/);
    expect(payload.convertedReferences[0].parsedData.title).toBeTruthy();
    expect(payload.convertedReferences[0].healthState).toBeTruthy();
    expect(payload.convertedReferences[0].reportEngineSnapshot?.engineVersion).toBe('v3');
  });

  it('accepts raw v2 content on /api/convert without requiring client-side reference splitting', async () => {
    const response = await fetch(`${baseUrl}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '14. Li Y, Zhang L, Wang Y, et al.: Generative deep learning enables the discovery of a potent and selective RIPK1 inhibitor. Nat Commun. 2022, 13: 10.1038/s41467-022-34692-w',
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrichWithAuthority: false,
        isPro: false,
        engineVersion: 'v2',
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      convertedReferences: Array<{ parsedData: { title?: string; doi?: string } }>;
      engineVersion?: 'v1' | 'v2' | 'v3';
    };
    expect(payload.engineVersion).toBe('v2');
    expect(payload.convertedReferences).toHaveLength(1);
    expect(payload.convertedReferences[0].parsedData.title).toBeTruthy();
    expect(payload.convertedReferences[0].parsedData.doi).toBeTruthy();
  });

  it('still supports the legacy v1 path when explicitly requested', async () => {
    const response = await fetch(`${baseUrl}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        references: [
          'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
          'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
        ],
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrichWithAuthority: false,
        isPro: false,
        engineVersion: 'v1',
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      convertedReferences: Array<{ id: string; parsedData: { title?: string } }>;
      clusters?: Array<{ members: Array<{ id: string }> }>;
      engineVersion?: 'v1' | 'v2' | 'v3';
    };
    expect(payload.engineVersion).toBe('v1');
    expect(payload.convertedReferences).toHaveLength(2);
    expect(payload.convertedReferences[0].parsedData.title).toBeTruthy();
    expect(payload.clusters?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('keeps the legacy v2 bridge responsive on larger batches', async () => {
    const references = Array.from(
      { length: 80 },
      (_, index) => `Smith, J. (${2020 + (index % 3)}). Example title ${index + 1}. Journal of Quality, 10(2), 11-19.`,
    );

    const response = await fetch(`${baseUrl}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        references,
        inputStyle: 'auto',
        outputStyle: 'apa',
        enrichWithAuthority: false,
        isPro: false,
        engineVersion: 'v2',
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      convertedReferences: Array<{ id: string; convertedText: string }>;
      engineVersion?: 'v1' | 'v2' | 'v3';
    };
    expect(payload.engineVersion).toBe('v2');
    expect(payload.convertedReferences).toHaveLength(80);
  });
});
