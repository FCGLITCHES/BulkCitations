import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { env } from '../config.js';
import { recordAuditEvent } from '../audit/recordAudit.js';
import { getCorrelationId } from '../runtime/requestContext.js';

const bodySchema = z.object({
  token: z.string().min(1),
});

export async function adminApproveRoute(app: FastifyInstance): Promise<void> {
  app.post('/admin/approve', async (req, reply) => {
    const actorUserId = (req as { userId?: string }).userId ?? null;
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      void recordAuditEvent({
        actorUserId,
        action: 'admin.approve.invalid_payload',
        resource: '/internal/admin/approve',
        correlationId: getCorrelationId(),
        statusCode: 400,
      });
      return reply.status(400).send({ message: 'Invalid request body.' });
    }

    const secret = env.ADMIN_APPROVAL_JWT_SECRET?.trim();
    if (!secret) {
      void recordAuditEvent({
        actorUserId,
        action: 'admin.approve.unconfigured',
        resource: '/internal/admin/approve',
        correlationId: getCorrelationId(),
        statusCode: 503,
      });
      return reply.status(503).send({
        message: 'Admin approval links are not configured (ADMIN_APPROVAL_JWT_SECRET).',
      });
    }

    let email: string;
    try {
      const { payload } = await jwtVerify(
        parsed.data.token,
        new TextEncoder().encode(secret),
        { algorithms: ['HS256'] },
      );
      if (payload.purpose !== 'admin_approve') {
        return reply.status(400).send({ message: 'Invalid approval token.' });
      }
      const raw = typeof payload.email === 'string' ? payload.email : '';
      email = raw.trim().toLowerCase();
      if (!email) {
        return reply.status(400).send({ message: 'Invalid approval token.' });
      }
    } catch {
      void recordAuditEvent({
        actorUserId,
        action: 'admin.approve.invalid_token',
        resource: '/internal/admin/approve',
        correlationId: getCorrelationId(),
        statusCode: 400,
      });
      return reply.status(400).send({ message: 'Invalid or expired approval token.' });
    }

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isAdmin: users.isAdmin,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const row = rows[0];
    if (!row) {
      void recordAuditEvent({
        actorUserId,
        action: 'admin.approve.user_not_found',
        resource: '/internal/admin/approve',
        correlationId: getCorrelationId(),
        statusCode: 404,
        metadata: {
          email,
        },
      });
      return reply.status(404).send({
        message:
          'No account found for this email. Sign in once so your profile exists, then retry the approval link.',
      });
    }

    if (row.isAdmin) {
      void recordAuditEvent({
        actorUserId,
        action: 'admin.approve.already_admin',
        resource: '/internal/admin/approve',
        resourceId: row.id,
        correlationId: getCorrelationId(),
        statusCode: 200,
        metadata: {
          email: row.email,
        },
      });
      return reply.status(200).send({
        alreadyApproved: true,
        account: {
          name: row.name ?? undefined,
          username: row.email,
        },
      });
    }

    await db
      .update(users)
      .set({ isAdmin: true, updatedAt: new Date() })
      .where(eq(users.id, row.id));

    void recordAuditEvent({
      actorUserId,
      action: 'admin.approve.granted',
      resource: '/internal/admin/approve',
      resourceId: row.id,
      correlationId: getCorrelationId(),
      statusCode: 200,
      metadata: {
        email: row.email,
      },
    });

    return reply.status(200).send({
      alreadyApproved: false,
      account: {
        name: row.name ?? undefined,
        username: row.email,
      },
    });
  });
}
