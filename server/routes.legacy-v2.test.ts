import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerRoutes } from './routes.js';

describe('legacy /api/convert routed through v2 engine', () => {
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

  it('keeps the legacy response shape with the default v1-safe bridge', async () => {
    delete process.env.USE_V2_ENGINE;

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
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      convertedReferences: Array<{ id: string; convertedText: string; parsedData: { title?: string } }>;
      clusters?: Array<{ members: Array<{ id: string }> }>;
    };
    expect(payload.convertedReferences).toHaveLength(2);
    expect(payload.convertedReferences[0].id).toMatch(/^\d+$/);
    expect(payload.convertedReferences[0].parsedData.title).toBeTruthy();
    expect(payload.clusters?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('keeps the legacy response shape when the v2 bridge is explicitly enabled', async () => {
    process.env.USE_V2_ENGINE = 'true';
    try {
      const response = await fetch(`${baseUrl}/api/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          references: [
            'Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N. and da Silva, V.L., 2022. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), pp.608-616.',
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
          convertedText: string;
          parsedData: { conferenceTitle?: string; title?: string };
          healthState?: 'clean' | 'review' | 'action_needed';
          healthReasons?: string[];
        }>;
      };
      expect(payload.convertedReferences).toHaveLength(1);
      expect(payload.convertedReferences[0].convertedText).toContain('Gomes');
      expect(payload.convertedReferences[0].convertedText).toContain('Kovaleski');
      expect(payload.convertedReferences[0].convertedText).toContain('Pagani');
      expect(payload.convertedReferences[0].parsedData.title).toContain('Machine learning applied to healthcare');
      expect(payload.convertedReferences[0].healthState).toBeTruthy();
      expect(Array.isArray(payload.convertedReferences[0].healthReasons)).toBe(true);
    } finally {
      delete process.env.USE_V2_ENGINE;
    }
  });

  it('does not time out on larger legacy v2 bridge batches', async () => {
    process.env.USE_V2_ENGINE = 'true';
    try {
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
        engineVersion?: 'v1' | 'v2';
      };
      expect(payload.engineVersion).toBe('v2');
      expect(payload.convertedReferences).toHaveLength(80);
    } finally {
      delete process.env.USE_V2_ENGINE;
    }
  });
});
