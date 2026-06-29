import type { FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import { eq } from 'drizzle-orm';
import { revokeTokenJti } from '../auth/revocation.js';
import { looksLikeJwt } from '../auth/externalAuth.js';
import { db } from '../db/connection.js';
import { sessions } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

export async function authRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/logout',
    { preHandler: requireAuth },
    async (req, reply) => {
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (bearerToken && looksLikeJwt(bearerToken)) {
        try {
          const decoded = decodeJwt(bearerToken);
          const jti = typeof decoded.jti === 'string' ? decoded.jti : undefined;
          const exp = typeof decoded.exp === 'number' ? decoded.exp : undefined;
          if (jti) {
            await revokeTokenJti(jti, exp);
          }
        } catch {
          // ignore decode errors after requireAuth
        }
      } else if (bearerToken) {
        try {
          await db.delete(sessions).where(eq(sessions.id, bearerToken));
        } catch {
          // Best-effort session removal (e.g. test DB layout).
        }
      }

      return reply.status(200).send({ ok: true });
    },
  );
}
