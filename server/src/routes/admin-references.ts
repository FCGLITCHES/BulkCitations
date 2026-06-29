import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { listAdminReferenceArchive } from '../runtime/persistence.js';

const referencesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  healthLabel: z.enum(['Ready', 'Review', 'Action Needed']).optional(),
  storageStatus: z.enum(['active', 'duplicate', 'failed']).optional(),
  ownerType: z.enum(['institution', 'user', 'api_key', 'guest']).optional(),
  ownerQuery: z.string().trim().max(200).optional(),
  jobQuery: z.string().trim().max(200).optional(),
});

export async function adminReferencesRoute(app: FastifyInstance): Promise<void> {
  app.get('/admin/references', async (req, reply) => {
    const parsed = referencesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Reference archive query is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const payload = await listAdminReferenceArchive({
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      ...(parsed.data.healthLabel ? { healthLabel: parsed.data.healthLabel } : {}),
      ...(parsed.data.storageStatus ? { storageStatus: parsed.data.storageStatus } : {}),
      ...(parsed.data.ownerType ? { ownerType: parsed.data.ownerType } : {}),
      ...(parsed.data.ownerQuery ? { ownerQuery: parsed.data.ownerQuery } : {}),
      ...(parsed.data.jobQuery ? { jobQuery: parsed.data.jobQuery } : {}),
    });

    return reply.status(200).send({
      references: payload.references,
      total: payload.total,
    });
  });
}
