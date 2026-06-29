import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

describe('auth contract (integration)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('allows logout when authenticated (test harness identity)', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: {
        authorization: 'Bearer test-session',
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok?: boolean }).ok).toBe(true);
  });

  it('accepts logout without Authorization in NODE_ENV=test (harness treats requests as authenticated)', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows admin metrics read in test mode', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/internal/admin/phase4-mode',
      headers: {
        authorization: 'Bearer test',
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
