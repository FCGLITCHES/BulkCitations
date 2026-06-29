import type { FastifyInstance } from 'fastify';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { buildJobStatusResponse, getRuntimeOrPersistedJob } from '../jobs/runtime.js';
import { assertJobAccess } from '../runtime/jobAccess.js';
import { appendJobEvent, getJob, updateJob } from '../runtime/persistence.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function jobsRoute(app: FastifyInstance): Promise<void> {
  app.get('/jobs/:id', async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    assertValidJobId(jobId);
    const job = await getRuntimeOrPersistedJob(jobId);

    if (!job) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${jobId} was not found.`);
    }
    await assertJobAccess(req, job);

    return reply.status(200).send(buildJobStatusResponse(job));
  });

  app.get('/jobs/:id/stream', async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    assertValidJobId(jobId);
    const job = await getRuntimeOrPersistedJob(jobId);

    if (!job) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${jobId} was not found.`);
    }
    await assertJobAccess(req, job);

    const lastEventId = Number(req.headers['last-event-id'] ?? 0);
    const events = job.events.filter((event) => event.id > lastEventId);
    const payload = events.map((event) => (
      `id: ${event.id}\n` +
      `event: ${event.event}\n` +
      `data: ${JSON.stringify(event.data)}\n\n`
    )).join('');

    reply.header('content-type', 'text/event-stream; charset=utf-8');
    return reply.status(200).send(payload);
  });

  app.delete('/jobs/:id', async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    assertValidJobId(jobId);
    const job = await getJob(jobId);

    if (!job) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${jobId} was not found.`);
    }
    await assertJobAccess(req, job);

    if (job.status === 'completed' || job.status === 'partial' || job.status === 'failed') {
      return reply.status(200).send({
        jobId,
        status: job.status,
      });
    }

    await updateJob(jobId, (current) => {
      current.status = 'failed';
      current.completedAt = new Date().toISOString();
      current.error = {
        code: ErrorCode.JOB_TIMEOUT,
        message: 'Job was cancelled by request.',
      };
    });
    await appendJobEvent(jobId, {
      event: 'cancelled',
      data: {
        code: ErrorCode.JOB_TIMEOUT,
        message: 'Job was cancelled by request.',
      },
    });

    return reply.status(200).send({
      jobId,
      status: 'failed',
    });
  });
}

function assertValidJobId(jobId: string): void {
  if (UUID_REGEX.test(jobId)) return;
  throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Job id must be a valid UUID.');
}
