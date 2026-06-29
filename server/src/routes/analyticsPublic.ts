import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const analyticsEventSchema = z.object({
  event: z.enum([
    'page_view',
    'converter_started',
    'converter_completed',
    'converter_failed',
  ]),
  visitorId: z.string().trim().min(6).max(128),
  path: z.string().trim().min(1).max(512),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export async function analyticsPublicRoute(app: FastifyInstance): Promise<void> {
  app.post('/analytics/track', { logLevel: 'silent' }, async (req, reply) => {
    const parsed = analyticsEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid analytics payload.',
      });
    }

    if (app.log.level === 'debug') {
      req.log.debug(
        {
          event: parsed.data.event,
          path: parsed.data.path,
          visitorId: parsed.data.visitorId,
          metadata: parsed.data.metadata ?? {},
        },
        'public analytics event accepted',
      );
    }

    return reply.status(202).send({ ok: true });
  });
}
