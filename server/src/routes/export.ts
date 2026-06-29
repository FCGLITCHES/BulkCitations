import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { ensureJobExport } from '../jobs/runtime.js';
import { assertJobAccess } from '../runtime/jobAccess.js';
import { getJob } from '../runtime/persistence.js';

const formatSchema = z.enum(['txt', 'bib', 'ris', 'csv', 'docx']);

export async function exportRoute(app: FastifyInstance): Promise<void> {
  app.get('/export/:jobId/:format', async (req, reply) => {
    const params = req.params as { jobId: string; format: string };
    const formatResult = formatSchema.safeParse(params.format);

    if (!formatResult.success) {
      throw new AppError(400, ErrorCode.EXPORT_FORMAT_UNSUPPORTED, `Unsupported export format ${params.format}.`);
    }

    const job = await getJob(params.jobId);
    if (!job) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${params.jobId} was not found.`);
    }
    await assertJobAccess(req, job);

    if (!job.result) {
      throw new AppError(404, ErrorCode.EXPORT_NOT_FOUND, `Job ${params.jobId} has no completed exportable result yet.`);
    }

    const artifact = await ensureJobExport(params.jobId, formatResult.data);
    if (!artifact) {
      throw new AppError(404, ErrorCode.EXPORT_NOT_FOUND, `Export ${formatResult.data} is unavailable for job ${params.jobId}.`);
    }

    if (artifact.delivery === 'signed_url' && artifact.downloadUrl) {
      return reply.status(200).send({
        delivery: 'signed_url',
        downloadUrl: artifact.downloadUrl,
        fileName: artifact.fileName,
        contentType: artifact.contentType,
        expiresAt: artifact.expiresAt,
      });
    }

    if (artifact.content == null) {
      throw new AppError(404, ErrorCode.EXPORT_NOT_FOUND, `Export ${formatResult.data} is unavailable for direct download.`);
    }

    reply.header('content-type', artifact.contentType);
    reply.header('content-disposition', `attachment; filename="${artifact.fileName}"`);
    return reply.status(200).send(artifact.content);
  });
}
