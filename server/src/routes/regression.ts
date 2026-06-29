import type { FastifyInstance } from 'fastify';
import { listRegressionRuns, runRegressionSuites } from '../regression/runner.js';

export async function regressionRoute(app: FastifyInstance): Promise<void> {
  app.post('/regression/run', async (_req, reply) => {
    const result = await runRegressionSuites();
    return reply.status(200).send(result);
  });

  app.get('/regression/runs', async (_req, reply) => {
    return reply.status(200).send(listRegressionRuns());
  });
}
