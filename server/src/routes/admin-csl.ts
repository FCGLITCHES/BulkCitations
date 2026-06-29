import type { FastifyInstance } from 'fastify';
import { getCslCurrencyStatus } from '../admin/cslCurrency.js';

// GET /internal/admin/csl/status — CSL style currency for the admin dashboard ("are we
// behind upstream?"). Covered by the `internal.admin_general` authorization policy.
export async function adminCslRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { refresh?: string } }>('/admin/csl/status', async (req, reply) => {
    const status = await getCslCurrencyStatus({ forceRefresh: req.query.refresh === '1' });
    return reply.status(200).send(status);
  });
}
