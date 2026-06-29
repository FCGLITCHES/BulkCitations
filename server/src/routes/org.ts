import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { organizations, users } from '../db/schema.js';

/** Org-scoped routes for institutional admins (usage overview, defaults — expand as needed). */
export async function orgAdminRoute(app: FastifyInstance): Promise<void> {
  app.get('/org/context', async (req, reply) => {
    const userId = (req as { userId?: string }).userId;
    const orgScopeId = (req as { orgScopeId?: string }).orgScopeId;
    if (!userId || !orgScopeId) {
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Missing org scope.' });
    }

    const [user] = await db
      .select({ orgId: users.orgId, appRole: users.appRole, tier: users.tier })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [org] = await db
      .select({ id: organizations.id, name: organizations.name, tier: organizations.tier })
      .from(organizations)
      .where(eq(organizations.id, orgScopeId))
      .limit(1);

    return reply.status(200).send({
      userId,
      org: org ?? null,
      membership: {
        appRole: user?.appRole ?? null,
        userTier: user?.tier ?? 'free',
        orgMatchesUser: user?.orgId === orgScopeId,
      },
    });
  });
}
