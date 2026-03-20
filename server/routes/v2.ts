import { Router } from 'express';
import { v2ConversionRequestSchema, v2ExportFormatSchema } from '@shared/schema';
import { createDefaultAdapters, processV2Conversion } from '../engine/v2/index.js';
import { buildSignedExportUrl, validateSignedExportUrl } from '../engine/v2/exportUrls.js';
import { v2JobStorage } from '../v2JobStorage.js';

const router = Router();
const adapters = createDefaultAdapters();
const AUTO_ASYNC_THRESHOLD = Number.parseInt(process.env.V2_AUTO_ASYNC_THRESHOLD ?? '75', 10);

function estimatedCitationCount(request: { sourceType: string; content: string }): number {
  if (request.sourceType === 'doi_list') {
    return request.content.split(/[\r?\n,;]+/).map((item) => item.trim()).filter(Boolean).length;
  }
  return Math.max(
    request.content.split(/\n\s*\n/).filter((part) => part.trim()).length,
    (request.content.match(/^\s*[\[\(]?\d+[\]\)\.]\s+\w/gm) ?? []).length,
    1,
  );
}

router.post('/convert', async (req, res) => {
  try {
    const request = v2ConversionRequestSchema.parse(req.body);
    const shouldAutoAsync = request.metadata?.disableAutoAsync !== true
      && request.metadata?.forceSync !== true
      && estimatedCitationCount(request) >= AUTO_ASYNC_THRESHOLD;

    if (shouldAutoAsync) {
      const job = await v2JobStorage.createQueuedJob(request);

      queueMicrotask(async () => {
        try {
          await v2JobStorage.markProcessing(job.id);
          const { response } = await processV2Conversion(request, { adapters, executionMode: 'async' });
          await v2JobStorage.completeJob(job.id, {
            ...response,
            job_id: job.id,
            exports: {
              txt: buildSignedExportUrl(job.id, 'txt'),
              bib: buildSignedExportUrl(job.id, 'bib'),
              ris: buildSignedExportUrl(job.id, 'ris'),
              csv: buildSignedExportUrl(job.id, 'csv'),
              docx: buildSignedExportUrl(job.id, 'docx'),
            },
          });
        } catch (error) {
          await v2JobStorage.failJob(job.id, error instanceof Error ? error.message : String(error));
        }
      });

      return res.status(202).json({
        job_id: job.id,
        status: job.status,
        executionMode: 'async',
        estimatedCitationCount: estimatedCitationCount(request),
      });
    }

    const { response } = await processV2Conversion(request, { adapters, executionMode: 'sync' });
    await v2JobStorage.saveJob(request, response);
    res.json(response);
  } catch (error) {
    res.status(400).json({
      message: 'Invalid v2 conversion request',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post('/jobs', async (req, res) => {
  try {
    const request = v2ConversionRequestSchema.parse(req.body);
    const job = await v2JobStorage.createQueuedJob(request);

    queueMicrotask(async () => {
      try {
        await v2JobStorage.markProcessing(job.id);
        const { response } = await processV2Conversion(request, { adapters, executionMode: 'async' });
        await v2JobStorage.completeJob(job.id, {
          ...response,
          job_id: job.id,
          exports: {
            txt: buildSignedExportUrl(job.id, 'txt'),
            bib: buildSignedExportUrl(job.id, 'bib'),
            ris: buildSignedExportUrl(job.id, 'ris'),
            csv: buildSignedExportUrl(job.id, 'csv'),
            docx: buildSignedExportUrl(job.id, 'docx'),
          },
        });
      } catch (error) {
        await v2JobStorage.failJob(job.id, error instanceof Error ? error.message : String(error));
      }
    });

    res.status(202).json({ job_id: job.id, status: job.status });
  } catch (error) {
    res.status(400).json({
      message: 'Invalid v2 job request',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get('/jobs/:jobId', async (req, res) => {
  const job = await v2JobStorage.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ message: 'v2 job not found' });
  }

  res.json({
    job_id: job.id,
    status: job.status,
    error: job.error,
    processed_at: job.response?.processed_at,
    result: job.response,
  });
});

router.get('/jobs/:jobId/export', async (req, res) => {
  try {
    const format = v2ExportFormatSchema.parse(req.query.format);
    const expires = Number.parseInt(String(req.query.expires ?? ''), 10);
    const signature = String(req.query.signature ?? '');
    if (!validateSignedExportUrl(req.params.jobId, format, expires, signature)) {
      return res.status(403).json({ message: 'Invalid or expired export URL' });
    }

    const job = await v2JobStorage.getJob(req.params.jobId);
    if (!job || !job.response) {
      return res.status(404).json({ message: 'v2 job not found' });
    }

    const file = await adapters.exportAdapter.generate(format, job.response);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  } catch (error) {
    res.status(400).json({
      message: 'Invalid v2 export request',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
