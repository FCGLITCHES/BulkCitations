import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

describe('public intake routes (integration)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('accepts waitlist signups without a configured delivery backend', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/waitlist',
      payload: {
        email: 'student@example.edu',
        persona: 'student',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      message: expect.stringContaining('waitlist'),
    });
  });

  it('accepts public analytics events', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/analytics/track',
      payload: {
        event: 'page_view',
        visitorId: 'visitor_123456',
        path: '/prices',
        metadata: {
          route: '/prices',
          surface: 'site',
        },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      ok: true,
    });
  });
});
