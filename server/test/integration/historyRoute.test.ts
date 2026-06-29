import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

describe('history route (integration)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('treats the test harness identity as authenticated for the public session probe', async () => {
    app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      authenticated: true,
      configured: true,
      account: {
        id: 'test-user',
      },
    });
  });

  it('persists conversion history for an authenticated user through /v1/history', async () => {
    app = await buildApp();

    const emptySnapshot = {
      clientId: 'historyspec01',
      items: [],
    };

    await app.inject({
      method: 'PUT',
      url: '/v1/history',
      payload: emptySnapshot,
    });

    const snapshot = {
      clientId: 'historyspec01',
      items: [
        {
          id: 'history-item-1',
          originalText: 'Smith, J. (2024). Test input.',
          convertedText: 'Smith, J. (2024). Test output.',
          inputStyle: 'apa',
          outputStyle: 'mla',
          healthState: 'clean',
          timestamp: '2026-04-04T00:00:00.000Z',
        },
      ],
    };

    const saveRes = await app.inject({
      method: 'PUT',
      url: '/v1/history',
      payload: snapshot,
    });

    expect(saveRes.statusCode).toBe(200);
    expect(saveRes.json()).toMatchObject({
      items: snapshot.items,
    });

    const loadRes = await app.inject({
      method: 'GET',
      url: '/v1/history',
    });

    expect(loadRes.statusCode).toBe(200);
    expect(loadRes.json()).toMatchObject({
      items: snapshot.items,
    });
  });

  it('accepts large authenticated history snapshots without rejecting the request body', async () => {
    app = await buildApp();

    const largeText = 'Large history payload '.repeat(260);
    const snapshot = {
      clientId: 'historylarge01',
      items: Array.from({ length: 120 }, (_, index) => ({
        id: `history-large-${index + 1}`,
        originalText: `${largeText}${index + 1}`,
        convertedText: `${largeText}${index + 1} converted`,
        inputStyle: 'apa',
        outputStyle: 'mla',
        healthState: 'clean',
        timestamp: new Date(Date.UTC(2026, 3, 4, 0, index % 60, 0)).toISOString(),
      })),
    };

    const saveRes = await app.inject({
      method: 'PUT',
      url: '/v1/history',
      payload: snapshot,
    });

    expect(saveRes.statusCode).toBe(200);
    expect(saveRes.json()).toMatchObject({
      items: snapshot.items,
    });
  });
});
