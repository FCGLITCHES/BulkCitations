import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { organizations, organizationIdentityLinks, users } from '../db/schema.js';
import { recordAuditEvent } from '../audit/recordAudit.js';
import { getCorrelationId } from '../runtime/requestContext.js';
import { canSendInboundEmail, escapeHtml, sendInboundEmail } from '../lib/inboundEmail.js';

const partnershipBodySchema = z.object({
  contactName: z.string().min(1).max(200),
  workEmail: z.string().email(),
  institutionName: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
});

function buildFallbackSessionAccount(
  userId: string,
  authProfile?: {
    email?: string;
    name?: string;
  },
) {
  const email = authProfile?.email?.trim().toLowerCase() ?? '';
  const name = authProfile?.name?.trim() || email || 'User';
  return {
    id: userId,
    name,
    email,
    accountType: 'individual' as const,
    institution: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null,
  };
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function authPublicRoute(app: FastifyInstance): Promise<void> {
  app.get('/auth/institutions', async (req, reply) => {
    const rawQ = (req.query as { q?: string }).q?.trim() ?? '';
    const safe = rawQ.replace(/[%_\\]/g, '').slice(0, 80);
    const pattern = safe ? `%${safe}%` : '%';

    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        domain: organizations.domain,
        workosExternalId: organizationIdentityLinks.externalId,
      })
      .from(organizations)
      .leftJoin(
        organizationIdentityLinks,
        and(
          eq(organizationIdentityLinks.organizationId, organizations.id),
          eq(organizationIdentityLinks.provider, 'workos'),
        ),
      )
      .where(
        safe
          ? or(ilike(organizations.name, pattern), ilike(organizations.domain, pattern))
          : sql`true`,
      )
      .orderBy(organizations.name)
      .limit(50);

    const seen = new Set<string>();
    const institutions = rows
      .filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      })
      .map((r) => {
        const domain = r.domain?.trim() ?? '';
        const slug = domain || r.id;
        const domains = domain ? domain.split(',').map((d) => d.trim()).filter(Boolean) : [];
        return {
          id: r.id,
          slug,
          name: r.name,
          domains: domains.length > 0 ? domains : domain ? [domain] : [],
          workosOrganizationId: r.workosExternalId?.trim() || null,
        };
      });

    return reply.status(200).send({ institutions });
  });

  app.post('/auth/institutions/request-partnership', async (req, reply) => {
    const parsed = partnershipBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid partnership request payload.',
      });
    }

    const { contactName, workEmail, institutionName, notes } = parsed.data;

    req.log.info(
      {
        authEvent: 'institution_partnership_request',
        institutionName,
        workEmailDomain: workEmail.includes('@') ? workEmail.split('@')[1]!.toLowerCase() : 'invalid',
        correlationId: getCorrelationId(),
      },
      'auth: partnership request received',
    );

    await recordAuditEvent({
      action: 'institution.partnership_request',
      resource: 'institutions/partnership',
      correlationId: getCorrelationId(),
      statusCode: 200,
      metadata: {
        contactName,
        workEmail: workEmail.toLowerCase(),
        institutionName,
        notes: notes ?? null,
      },
    });

    if (canSendInboundEmail()) {
      try {
        await sendInboundEmail({
          replyTo: workEmail,
          subject: `[BulkReferences] Institutional partnership request — ${institutionName}`,
          html: [
            `<p><strong>Contact:</strong> ${escapeHtml(contactName)} &lt;${escapeHtml(workEmail)}&gt;</p>`,
            `<p><strong>Institution:</strong> ${escapeHtml(institutionName)}</p>`,
            `<p><strong>Correlation ID:</strong> ${escapeHtml(getCorrelationId() ?? 'unknown')}</p>`,
            notes?.trim()
              ? `<hr /><pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(notes)}</pre>`
              : '',
          ].filter(Boolean).join('\n'),
        });
      } catch (error) {
        req.log.warn(
          { error: error instanceof Error ? error.message : String(error), correlationId: getCorrelationId() },
          'auth: partnership request email delivery failed',
        );
        return reply.status(502).send({
          message: 'Your request was recorded, but delivery failed. Please try again shortly or use the contact page.',
        });
      }
    }

    return reply.status(200).send({
      message: canSendInboundEmail()
        ? 'Your request has been recorded. Our team will follow up by email.'
        : 'Your request has been recorded. Our team will review it manually.',
    });
  });

  app.get('/auth/session', async (req, reply) => {
    const userId = (req as FastifyRequest & { userId?: string }).userId;
    const authProfile = (req as FastifyRequest & {
      authProfile?: {
        email?: string;
        name?: string;
      };
    }).authProfile;
    if (!userId) {
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
        account: buildFallbackSessionAccount(userId, authProfile),
      });
    }

    let row:
      | {
          id: string;
          email: string | null;
          name: string | null;
          orgId: string | null;
          createdAt: Date | null;
          updatedAt: Date | null;
          orgName: string | null;
        }
      | undefined;

    try {
      [row] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          orgId: users.orgId,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          orgName: organizations.name,
        })
        .from(users)
        .leftJoin(organizations, eq(users.orgId, organizations.id))
        .where(eq(users.id, userId))
        .limit(1);
    } catch (error) {
      req.log.warn(
        {
          err: error,
          userId,
          correlationId: getCorrelationId(),
        },
        'auth: session lookup failed, falling back to token profile',
      );
      return reply.status(200).send({
        authenticated: true,
        configured: true,
        account: buildFallbackSessionAccount(userId, authProfile),
      });
    }

    if (!row) {
      req.log.warn(
        { authEvent: 'session_user_missing', userId, correlationId: getCorrelationId() },
        'auth: session user row not found',
      );
      return reply.status(200).send({
        authenticated: true,
        configured: true,
        account: buildFallbackSessionAccount(userId, authProfile),
      });
    }

    const email = row.email ?? '';
    const accountType = row.orgId ? ('institutional' as const) : ('individual' as const);
    const institution = row.orgId && row.orgName
      ? {
          id: row.orgId,
          slug: row.orgName.toLowerCase().replace(/\s+/g, '-').slice(0, 80),
          name: row.orgName,
        }
      : null;

    return reply.status(200).send({
      authenticated: true,
      configured: true,
      account: {
        id: row.id,
        name: row.name?.trim() || email || 'User',
        email,
        accountType,
        institution,
        createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
        updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
        lastLoginAt: null,
      },
    });
  });
}
