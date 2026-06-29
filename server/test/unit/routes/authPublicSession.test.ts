import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db/connection.js';
import { authPublicRoute } from '../../../src/routes/authPublic.js';

describe('authPublicRoute /auth/session', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns fallback account when session DB lookup fails', async () => {
    const app = Fastify();

    app.addHook('onRequest', async (req) => {
      const request = req as typeof req & {
        userId?: string;
        authProfile?: {
          email?: string;
          name?: string;
        };
      };
      request.userId = '00000000-0000-0000-0000-000000000002';
      request.authProfile = {
        email: 'user@example.com',
        name: 'User Name',
      };
    });

    await app.register(authPublicRoute, { prefix: '/v1' });

    vi.spyOn(db, 'select').mockImplementation((() => {
      throw Object.assign(new Error('relation "users" does not exist'), { code: '42P01' });
    }) as never);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      authenticated: true,
      configured: true,
      account: {
        id: '00000000-0000-0000-0000-000000000002',
        email: 'user@example.com',
        name: 'User Name',
      },
    });

    await app.close();
  });
});
