import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db/connection.js';
import { env } from '../../../src/config.js';
import * as externalAuthModule from '../../../src/auth/externalAuth.js';
import {
  ExternalIdentityResolutionError,
  matchesAdminEmailAllowlist,
  optionalAuth,
  requireAuth,
  resolveExternalIdentity,
} from '../../../src/middleware/auth.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalAuthMode = env.AUTH_MODE;
const originalPersistenceBackend = env.PERSISTENCE_BACKEND;

afterEach(() => {
  vi.restoreAllMocks();
  process.env.NODE_ENV = originalNodeEnv;
  env.AUTH_MODE = originalAuthMode;
  env.PERSISTENCE_BACKEND = originalPersistenceBackend;
});

describe('matchesAdminEmailAllowlist', () => {
  it('matches an explicitly allowed email', () => {
    expect(
      matchesAdminEmailAllowlist(
        'Admin@Example.com',
        ['admin@example.com'],
        [],
      ),
    ).toBe(true);
  });

  it('matches an allowed domain', () => {
    expect(
      matchesAdminEmailAllowlist(
        'staff@bulkreferences.com',
        [],
        ['bulkreferences.com'],
      ),
    ).toBe(true);
  });

  it('does not match a non-allowlisted email', () => {
    expect(
      matchesAdminEmailAllowlist(
        'user@example.org',
        ['admin@example.com'],
        ['bulkreferences.com'],
      ),
    ).toBe(false);
  });
});

describe('resolveExternalIdentity', () => {
  it('fails closed instead of downgrading identity when database-backed resolution is unavailable', async () => {
    const originalBackend = env.PERSISTENCE_BACKEND;
    env.PERSISTENCE_BACKEND = 'database';

    const selectSpy = vi.spyOn(db, 'select').mockImplementation((() => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    }) as never);

    await expect(resolveExternalIdentity({
      authSource: 'clerk',
      userId: 'user_admin_123',
      tier: 'free',
      isAdmin: false,
      emailVerified: true,
      email: 'api@bulkreferences.com',
    })).rejects.toBeInstanceOf(ExternalIdentityResolutionError);

    selectSpy.mockRestore();
    env.PERSISTENCE_BACKEND = originalBackend;
  });

  it('keeps ephemeral fallback behavior when database persistence is not the configured backend', async () => {
    const originalBackend = env.PERSISTENCE_BACKEND;
    env.PERSISTENCE_BACKEND = 'auto';

    const selectSpy = vi.spyOn(db, 'select').mockImplementation((() => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    }) as never);

    await expect(resolveExternalIdentity({
      authSource: 'clerk',
      userId: 'user_admin_123',
      tier: 'pro',
      isAdmin: false,
      emailVerified: true,
      email: 'api@bulkreferences.com',
    })).resolves.toMatchObject({
      userId: 'clerk:user_admin_123',
      tier: 'pro',
      isAdmin: false,
      profile: {
        email: 'api@bulkreferences.com',
      },
    });

    selectSpy.mockRestore();
    env.PERSISTENCE_BACKEND = originalBackend;
  });
});

describe('session probe identity fallback', () => {
  it('keeps /internal/admin/session available with JWT-backed admin identity when DB identity resolution is unavailable', async () => {
    process.env.NODE_ENV = 'development';
    env.AUTH_MODE = 'hybrid';
    env.PERSISTENCE_BACKEND = 'database';

    const app = Fastify();
    app.addHook('preHandler', requireAuth);
    app.get('/internal/admin/session', async (req, reply) => reply.send({
      userId: (req as typeof req & { userId?: string }).userId ?? null,
      isAdmin: (req as typeof req & { isAdmin?: boolean }).isAdmin ?? false,
      authProfile: (req as typeof req & {
        authProfile?: {
          email?: string;
          name?: string;
          username?: string;
        };
      }).authProfile ?? null,
    }));

    vi.spyOn(externalAuthModule, 'verifyExternalAccessToken').mockResolvedValue({
      authSource: 'clerk',
      userId: 'user_admin_123',
      tier: 'free',
      isAdmin: true,
      emailVerified: true,
      email: 'api@bulkreferences.com',
      displayName: 'Admin User',
      username: 'api',
    });
    vi.spyOn(db, 'select').mockImplementation((() => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    }) as never);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/admin/session',
      headers: {
        authorization: 'Bearer a.b.c',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      userId: 'clerk:user_admin_123',
      isAdmin: true,
      authProfile: {
        email: 'api@bulkreferences.com',
        name: 'Admin User',
        provider: 'clerk',
        username: 'api',
      },
    });

    await app.close();
  });

  it('keeps /v1/auth/session available with JWT-backed identity when DB identity resolution is unavailable', async () => {
    process.env.NODE_ENV = 'development';
    env.AUTH_MODE = 'hybrid';
    env.PERSISTENCE_BACKEND = 'database';

    const app = Fastify();
    app.addHook('onRequest', optionalAuth);
    app.get('/v1/auth/session', async (req, reply) => reply.send({
      userId: (req as typeof req & { userId?: string }).userId ?? null,
      isAdmin: (req as typeof req & { isAdmin?: boolean }).isAdmin ?? false,
      authProfile: (req as typeof req & {
        authProfile?: {
          email?: string;
          name?: string;
          username?: string;
        };
      }).authProfile ?? null,
    }));

    vi.spyOn(externalAuthModule, 'verifyExternalAccessToken').mockResolvedValue({
      authSource: 'clerk',
      userId: 'user_123',
      tier: 'pro',
      isAdmin: false,
      emailVerified: true,
      email: 'user@example.com',
      displayName: 'User Example',
      username: 'user',
    });
    vi.spyOn(db, 'select').mockImplementation((() => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    }) as never);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: {
        authorization: 'Bearer a.b.c',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      userId: 'clerk:user_123',
      isAdmin: false,
      authProfile: {
        email: 'user@example.com',
        name: 'User Example',
        provider: 'clerk',
        username: 'user',
      },
    });

    await app.close();
  });

  it('still fails closed for non-probe routes when DB identity resolution is unavailable', async () => {
    process.env.NODE_ENV = 'development';
    env.AUTH_MODE = 'hybrid';
    env.PERSISTENCE_BACKEND = 'database';

    const app = Fastify();
    app.addHook('preHandler', requireAuth);
    app.get('/v1/keys', async (_req, reply) => reply.send({ ok: true }));

    vi.spyOn(externalAuthModule, 'verifyExternalAccessToken').mockResolvedValue({
      authSource: 'clerk',
      userId: 'user_123',
      tier: 'free',
      isAdmin: false,
      emailVerified: true,
      email: 'user@example.com',
    });
    vi.spyOn(db, 'select').mockImplementation((() => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    }) as never);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: {
        authorization: 'Bearer a.b.c',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      authReason: 'external_identity_resolution_unavailable',
    });

    await app.close();
  });
});
