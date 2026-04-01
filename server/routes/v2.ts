import { Router } from 'express';
import { v2ConversionRequestSchema, v2ExportFormatSchema } from '@shared/schema';
import { createDefaultAdapters, processV2Conversion } from '../engine/v2/index.js';
import { buildSignedExportUrl, validateSignedExportUrl } from '../engine/v2/exportUrls.js';
import { v2JobStorage } from '../v2JobStorage.js';
import { recanonicalizeFromParsed } from '../engine/v2/utils.js';
import { scoreCitation } from '../engine/v2/stages/score.js';
import { validateCitationOffline } from '../engine/v2/stages/validate.js';

const router = Router();
// ... existing router setup ...
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

router.patch('/jobs/:jobId/citations/:index', async (req, res) => {
  const { jobId, index } = req.params;
  const citationIndex = Number.parseInt(index, 10);
  
  try {
    const job = await v2JobStorage.getJob(jobId);
    if (!job || !job.response?.citations) {
      return res.status(404).json({ message: 'Job or citations not found' });
    }
    
    const existing = job.response.citations[citationIndex];
    if (!existing) {
      return res.status(404).json({ message: 'Citation index out of bounds' });
    }

    // 1. Sync the manual edits into the canonical structure
    const updatedCanonical = recanonicalizeFromParsed(req.body, existing, 'manual-correction');
    
    // 2. Re-run Quality & Validation gates
    updatedCanonical.quality = scoreCitation(updatedCanonical);
    const { issues, metadata } = await validateCitationOffline(updatedCanonical);
    updatedCanonical.validationIssues = issues;
    updatedCanonical.validation = metadata;

    // 3. Mark as manually corrected for audit
    updatedCanonical.is_manually_corrected = true;

    // 4. Save back to storage
    const updatedJob = await v2JobStorage.updateJobCitation(jobId, citationIndex, updatedCanonical);
    
    res.json({
      job_id: jobId,
      status: updatedJob?.status,
      citation: updatedCanonical
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to update citation',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
