import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db/connection.js';
import { adminSessionProbeRoute } from '../../../src/routes/adminSessionProbe.js';

describe('adminSessionProbeRoute', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to token profile when DB lookups fail', async () => {
    const app = Fastify();

    app.addHook('preHandler', async (req) => {
      const request = req as typeof req & {
        userId?: string;
        isAdmin?: boolean;
        authProfile?: {
          email?: string;
          name?: string;
          username?: string;
        };
      };

      request.userId = '00000000-0000-0000-0000-000000000001';
      request.isAdmin = true;
      request.authProfile = {
        email: 'admin@example.com',
        name: 'Admin User',
        username: 'admin',
      };
    });

    await app.register(adminSessionProbeRoute, { prefix: '/internal' });

    vi.spyOn(db, 'select').mockImplementation((() => {
      throw Object.assign(new Error('relation "users" does not exist'), { code: '42P01' });
    }) as never);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/admin/session',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      configured: true,
      account: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'admin@example.com',
        name: 'Admin User',
        username: 'admin',
      },
    });

    await app.close();
  });
});
