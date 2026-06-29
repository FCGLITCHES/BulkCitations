import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

describe('GET /health', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('reports runtime mode details without requiring optional local dependencies', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      status: 'ok' | 'degraded';
      checks: Record<string, { status: 'ok' | 'error' | 'disabled'; required: boolean; configured: boolean }>;
      runtime: {
        nodeEnv: string;
        persistenceMode: string;
        persistenceBackend: string;
      };
    };

    expect(body.runtime.nodeEnv).toBe('test');
    expect(body.runtime.persistenceBackend).toBe('memory');
    expect(body.checks.postgres?.required).toBe(false);
    expect(body.checks.redis?.required).toBe(false);
  });
});
