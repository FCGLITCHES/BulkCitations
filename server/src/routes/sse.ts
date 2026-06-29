import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { buildJobStatusResponse, getRuntimeJobSnapshot, getRuntimeOrPersistedJob } from '../jobs/runtime.js';
import { assertJobAccess } from '../runtime/jobAccess.js';
import { getJob, type StoredEvent } from '../runtime/persistence.js';

function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function sseRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/jobs/:jobId/events',
    async (req: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
      const { jobId } = req.params;
      const job = await getRuntimeOrPersistedJob(jobId);

      if (!job) {
        throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${jobId} was not found.`);
      }
      await assertJobAccess(req, job);

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      let lastEventId = job.events[job.events.length - 1]?.id ?? 0;

      const sendProgress = async () => {
        const fresh = await getRuntimeOrPersistedJob(jobId);
        if (!fresh) return;

        const newEvents: StoredEvent[] = [];
        for (const ev of fresh.events) {
          if (ev.id > lastEventId) {
            newEvents.push(ev);
            lastEventId = ev.id;
          }
        }

        writeSse(reply, 'progress', {
          ...buildJobStatusResponse(fresh),
          ...(newEvents.length ? { newEvents } : {}),
        });
      };

      await sendProgress();

      if (
        job.status === 'completed' ||
        job.status === 'partial' ||
        job.status === 'failed'
      ) {
        writeSse(reply, 'complete', buildJobStatusResponse(job));
        reply.raw.end();
        return;
      }

      const interval = setInterval(() => {
        void (async () => {
          const runtimeCurrent = getRuntimeJobSnapshot(jobId);
          if (runtimeCurrent) {
            await sendProgress();
            writeSse(reply, 'complete', buildJobStatusResponse(runtimeCurrent));
            clearInterval(interval);
            reply.raw.end();
            return;
          }

          const current = await getJob(jobId);
          if (!current) {
            clearInterval(interval);
            reply.raw.end();
            return;
          }

          await sendProgress();

          if (
            current.status === 'completed' ||
            current.status === 'partial' ||
            current.status === 'failed'
          ) {
            writeSse(reply, 'complete', buildJobStatusResponse(current));
            clearInterval(interval);
            reply.raw.end();
          }
        })();
      }, 2000);

      req.raw.on('close', () => {
        clearInterval(interval);
      });
    },
  );
}
