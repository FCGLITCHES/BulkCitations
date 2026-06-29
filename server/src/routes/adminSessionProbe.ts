import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { identityLinks, users } from '../db/schema.js';

type AuthedRequest = FastifyRequest & {
  userId?: string;
  isAdmin?: boolean;
  authProfile?: {
    email?: string;
    name?: string;
    username?: string;
  };
};

function isSyntheticExternalEmail(value: string | null | undefined): boolean {
  return Boolean(value?.trim().toLowerCase().endsWith('@external.invalid'));
}

/**
 * Admin UI session probe — must use **requireAuth only** (not requireAdmin).
 * Otherwise a signed-in non-admin receives 403 and the SPA cannot tell "logged in but not staff"
 * from "bad JWT" (401).
 */
export async function adminSessionProbeRoute(app: FastifyInstance): Promise<void> {
  app.get('/admin/session', async (req, reply) => {
    const r = req as AuthedRequest;
    const userId = r.userId;
    if (!userId) {
      return reply.status(401).send({
        authenticated: false,
        configured: true,
        message: 'Authentication required.',
      });
    }

    if (!r.isAdmin) {
      return reply.status(200).send({
        authenticated: false,
        configured: true,
        account: null,
      });
    }

    if (!looksLikeUuid(userId)) {
      return reply.status(200).send({
        authenticated: true,
        configured: true,
        account: buildFallbackAdminAccount(userId, r.authProfile),
      });
    }

    try {
      const [row] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      let email = row?.email ?? '';
      if (isSyntheticExternalEmail(email)) {
        const [linkedIdentity] = await db
          .select({ email: identityLinks.email })
          .from(identityLinks)
          .where(eq(identityLinks.userId, userId))
          .limit(1);
        if (linkedIdentity?.email?.trim()) {
          email = linkedIdentity.email.trim().toLowerCase();
        }
      }
      if (!email && r.authProfile?.email?.trim()) {
        email = r.authProfile.email.trim().toLowerCase();
      }
      const name = row?.name?.trim() || r.authProfile?.name?.trim() || email || 'Administrator';
      const username = email.includes('@')
        ? email.split('@')[0]!
        : r.authProfile?.username?.trim() || 'admin';

      return reply.status(200).send({
        authenticated: true,
        configured: true,
        account: {
          id: userId,
          email,
          name,
          username,
        },
      });
    } catch (error) {
      req.log.warn(
        {
          err: error,
          userId,
        },
        'admin session probe fell back to token profile after DB lookup failure',
      );
      return reply.status(200).send({
        authenticated: true,
        configured: true,
        account: buildFallbackAdminAccount(userId, r.authProfile),
      });
    }
  });
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildFallbackAdminAccount(
  userId: string,
  authProfile?: AuthedRequest['authProfile'],
) {
  const email = authProfile?.email?.trim().toLowerCase() ?? '';
  const name = authProfile?.name?.trim() || email || 'Administrator';
  const username = authProfile?.username?.trim()
    || (email.includes('@') ? email.split('@')[0] ?? 'admin' : userId);

  return {
    id: userId,
    email,
    name,
    username,
  };
}
