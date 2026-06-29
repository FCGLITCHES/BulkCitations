import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { recordAuditEvent } from '../audit/recordAudit.js';
import { getCorrelationId } from '../runtime/requestContext.js';
import { deleteApiKey, getUserTier, listApiKeys, saveApiKey } from '../runtime/persistence.js';

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  ownerUserId: z.string().uuid().optional(),
});

const listKeysQuerySchema = z.object({
  ownerUserId: z.string().uuid().optional(),
});

const deleteKeyParamsSchema = z.object({
  id: z.string().uuid(),
});

type AuthenticatedRequest = FastifyRequest & {
  userId?: string;
  isAdmin?: boolean;
  tier?: string;
};

function resolveEffectiveTier(tier: unknown): 'free' | 'pro' | 'b2b' {
  if (tier === 'b2b' || tier === 'pro') {
    return tier;
  }
  return 'free';
}

function requireAuthenticatedUser(req: AuthenticatedRequest): string {
  const userId = req.userId?.trim();
  if (!userId) {
    throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Authentication required.');
  }
  return userId;
}

export async function keysRoute(app: FastifyInstance): Promise<void> {
  app.post('/keys', async (req, reply) => {
    const request = req as AuthenticatedRequest;
    const actorUserId = requireAuthenticatedUser(request);
    const isAdmin = Boolean(request.isAdmin);
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'API key payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const requestedOwnerUserId = parsed.data.ownerUserId;
    const ownerUserId = requestedOwnerUserId ?? actorUserId;
    if (requestedOwnerUserId && requestedOwnerUserId !== actorUserId && !isAdmin) {
      void recordAuditEvent({
        actorUserId,
        action: 'api_key.create_denied',
        resource: '/v1/keys',
        correlationId: getCorrelationId(),
        statusCode: 403,
        metadata: {
          reason: 'cross_tenant_create',
          requestedOwnerUserId,
        },
      });
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Only administrators can create API keys for other users.');
    }

    const persistedOwnerTier = await getUserTier(ownerUserId);
    if (requestedOwnerUserId && requestedOwnerUserId !== actorUserId && isAdmin && !persistedOwnerTier) {
      void recordAuditEvent({
        actorUserId,
        action: 'api_key.create_denied',
        resource: '/v1/keys',
        correlationId: getCorrelationId(),
        statusCode: 404,
        metadata: {
          reason: 'owner_not_found',
          requestedOwnerUserId,
        },
      });
      throw new AppError(404, ErrorCode.NOT_FOUND, `Owner user ${ownerUserId} was not found.`);
    }

    const rawKey = `br_live_${randomBytes(18).toString('hex')}`;
    const record = {
      id: randomUUID(),
      userId: ownerUserId,
      name: parsed.data.name,
      prefix: rawKey.slice(0, 8),
      tier: persistedOwnerTier ?? resolveEffectiveTier(request.tier),
      rawKey,
      createdAt: new Date().toISOString(),
    };
    await saveApiKey(record);
    void recordAuditEvent({
      actorUserId,
      action: 'api_key.create',
      resource: '/v1/keys',
      resourceId: record.id,
      correlationId: getCorrelationId(),
      statusCode: 201,
      metadata: {
        ownerUserId,
        tier: record.tier,
        tierSource: persistedOwnerTier ? 'owner_account_policy' : 'request_identity_fallback',
      },
    });

    return reply.status(201).send(record);
  });

  app.get('/keys', async (req, reply) => {
    const request = req as AuthenticatedRequest;
    const actorUserId = requireAuthenticatedUser(request);
    const isAdmin = Boolean(request.isAdmin);
    const parsedQuery = listKeysQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'API key query is invalid.', {
        issues: parsedQuery.error.flatten(),
      });
    }

    const requestedOwnerUserId = parsedQuery.data.ownerUserId;
    if (requestedOwnerUserId && requestedOwnerUserId !== actorUserId && !isAdmin) {
      void recordAuditEvent({
        actorUserId,
        action: 'api_key.list_denied',
        resource: '/v1/keys',
        correlationId: getCorrelationId(),
        statusCode: 403,
        metadata: {
          reason: 'cross_tenant_list',
          requestedOwnerUserId,
        },
      });
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Only administrators can list API keys for other users.');
    }

    const ownerUserId = requestedOwnerUserId ?? (isAdmin ? undefined : actorUserId);
    const keys = await listApiKeys(ownerUserId);
    void recordAuditEvent({
      actorUserId,
      action: 'api_key.list',
      resource: '/v1/keys',
      correlationId: getCorrelationId(),
      statusCode: 200,
      metadata: {
        ownerScoped: Boolean(ownerUserId),
        ownerUserId: ownerUserId ?? null,
        resultCount: keys.length,
      },
    });
    return reply.status(200).send(keys);
  });

  app.delete('/keys/:id', async (req, reply) => {
    const request = req as AuthenticatedRequest;
    const actorUserId = requireAuthenticatedUser(request);
    const isAdmin = Boolean(request.isAdmin);
    const parsedParams = deleteKeyParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'API key id is invalid.', {
        issues: parsedParams.error.flatten(),
      });
    }
    const id = parsedParams.data.id;
    const removed = await deleteApiKey(id, isAdmin ? undefined : actorUserId);

    if (!removed) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `API key ${id} was not found.`);
    }
    void recordAuditEvent({
      actorUserId,
      action: 'api_key.delete',
      resource: '/v1/keys/:id',
      resourceId: id,
      correlationId: getCorrelationId(),
      statusCode: 200,
      metadata: {
        ownerScoped: !isAdmin,
      },
    });

    return reply.status(200).send({ id, deleted: true });
  });
}
