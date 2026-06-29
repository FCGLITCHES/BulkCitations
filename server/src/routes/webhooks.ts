import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createSvixWebhookFromWhsec } from '../auth/svixWebhook.js';
import { WorkOS } from '@workos-inc/node';
import { and, eq } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/connection.js';
import { identityLinks, organizationIdentityLinks, users } from '../db/schema.js';
import { revokeSession, revokeTokenJti } from '../auth/revocation.js';

type ClerkEvent = {
  type: string;
  data: {
    id: string;
    [key: string]: unknown;
  };
};

type WorkOsEvent = {
  event: string;
  data: {
    id: string;
    [key: string]: unknown;
  };
};

function webhookRawBody(req: FastifyRequest, parsedBody: unknown): string {
  if (typeof req.rawBody === 'string' && req.rawBody.length > 0) {
    return req.rawBody;
  }
  return typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody ?? {});
}

export async function webhooksRoute(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/clerk', async (req, reply) => {
    if (!env.CLERK_WEBHOOK_SECRET) {
      return reply.status(503).send({ error: 'WEBHOOKS_DISABLED', message: 'Clerk webhooks are not configured.' });
    }

    const payload = await req.body;
    const rawBody = webhookRawBody(req, payload);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }

    let event: ClerkEvent;
    try {
      const wh = createSvixWebhookFromWhsec(env.CLERK_WEBHOOK_SECRET);
      event = wh.verify(rawBody, headers) as ClerkEvent;
    } catch {
      return reply.status(400).send({ error: 'INVALID_SIGNATURE', message: 'Clerk webhook signature verification failed.' });
    }

    if (event.type === 'user.deleted') {
      const externalId = event.data.id;
      const [link] = await db
        .select({ userId: identityLinks.userId })
        .from(identityLinks)
        .where(and(eq(identityLinks.provider, 'clerk'), eq(identityLinks.externalId, externalId)))
        .limit(1);

      if (link) {
        await db.delete(identityLinks).where(and(eq(identityLinks.provider, 'clerk'), eq(identityLinks.externalId, externalId)));
        // Optional: deprovision account access by clearing org association (more granular controls can follow).
        await db.update(users).set({ orgId: null }).where(eq(users.id, link.userId));
      }
    }

    return reply.status(200).send({ ok: true });
  });

  app.post('/webhooks/workos', async (req, reply) => {
    if (!env.WORKOS_WEBHOOK_SECRET) {
      return reply.status(503).send({ error: 'WEBHOOKS_DISABLED', message: 'WorkOS webhooks are not configured.' });
    }

    const payload = await req.body;
    const rawBody = webhookRawBody(req, payload);

    const sigHeader = (req.headers['workos-signature'] ?? req.headers['WorkOS-Signature']) as string | undefined;
    if (!sigHeader) {
      return reply.status(400).send({ error: 'MISSING_SIGNATURE', message: 'WorkOS signature header is missing.' });
    }

    let event: WorkOsEvent;
    try {
      const workos = new WorkOS(env.WORKOS_API_KEY ?? '');
      // SDK verifies with JSON.stringify(payload); must be the parsed object (same serialization as the wire body).
      let payloadRecord: Record<string, unknown>;
      if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
        payloadRecord = payload as Record<string, unknown>;
      } else {
        try {
          payloadRecord = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          return reply.status(400).send({ error: 'INVALID_JSON', message: 'Webhook body must be JSON.' });
        }
      }
      event = await (workos.webhooks as unknown as {
        constructEvent: (input: {
          payload: Record<string, unknown>;
          sigHeader: string;
          secret: string;
          tolerance?: number;
        }) => Promise<unknown>;
      }).constructEvent({
        payload: payloadRecord,
        sigHeader,
        secret: env.WORKOS_WEBHOOK_SECRET,
        tolerance: 180_000,
      }) as unknown as WorkOsEvent;
    } catch {
      return reply.status(400).send({ error: 'INVALID_SIGNATURE', message: 'WorkOS webhook signature verification failed.' });
    }

    if (event.event === 'user.deleted') {
      const externalId = event.data.id;
      const [link] = await db
        .select({ userId: identityLinks.userId })
        .from(identityLinks)
        .where(and(eq(identityLinks.provider, 'workos'), eq(identityLinks.externalId, externalId)))
        .limit(1);

      if (link) {
        await db.delete(identityLinks).where(and(eq(identityLinks.provider, 'workos'), eq(identityLinks.externalId, externalId)));
        await db.update(users).set({ orgId: null }).where(eq(users.id, link.userId));
      }
    }

    if (event.event === 'organization_membership.deleted') {
      const data = event.data as { userId?: unknown; user_id?: unknown; organizationId?: unknown; organization_id?: unknown };
      const externalUserId =
        (typeof data.userId === 'string' ? data.userId : typeof data.user_id === 'string' ? data.user_id : '').trim();
      const externalOrgId =
        (typeof data.organizationId === 'string' ? data.organizationId : typeof data.organization_id === 'string' ? data.organization_id : '').trim();
      if (!externalUserId) {
        return reply.status(200).send({ ok: true });
      }

      const [userLink] = await db
        .select({ userId: identityLinks.userId })
        .from(identityLinks)
        .where(and(eq(identityLinks.provider, 'workos'), eq(identityLinks.externalId, externalUserId)))
        .limit(1);

      if (!userLink) {
        return reply.status(200).send({ ok: true });
      }

      if (!externalOrgId) {
        await db.update(users).set({ orgId: null }).where(eq(users.id, userLink.userId));
        return reply.status(200).send({ ok: true });
      }

      const [orgLink] = await db
        .select({ organizationId: organizationIdentityLinks.organizationId })
        .from(organizationIdentityLinks)
        .where(and(eq(organizationIdentityLinks.provider, 'workos'), eq(organizationIdentityLinks.externalId, externalOrgId)))
        .limit(1);

      if (!orgLink) {
        return reply.status(200).send({ ok: true });
      }

      await db
        .update(users)
        .set({ orgId: null })
        .where(and(eq(users.id, userLink.userId), eq(users.orgId, orgLink.organizationId)));
    }

    if (event.event === 'token.revoked') {
      const jti = (event.data as { jti?: unknown }).jti;
      const exp = (event.data as { exp?: unknown }).exp;
      if (typeof jti === 'string' && jti.trim()) {
        await revokeTokenJti(jti, typeof exp === 'number' ? exp : undefined);
      }
    }

    if (event.event === 'session.revoked') {
      const sessionId = typeof event.data.id === 'string' ? event.data.id.trim() : '';
      if (sessionId) {
        await revokeSession(sessionId);
      }
    }

    return reply.status(200).send({ ok: true });
  });
}

