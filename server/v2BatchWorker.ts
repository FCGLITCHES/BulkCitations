import { createDefaultAdapters, processV2Conversion } from './engine/v2/index.js';
import { buildSignedExportUrl } from './engine/v2/exportUrls.js';
import { v2JobStorage, type V2StoredJob } from './v2JobStorage.js';

let isRunning = false;
let pollingInterval: NodeJS.Timeout | null = null;
const adapters = createDefaultAdapters();
const SHOULD_LOG = !process.env.VITEST;

function logInfo(message: string) {
  if (SHOULD_LOG) console.info(message);
}

function logWarn(message: string) {
  if (SHOULD_LOG) console.warn(message);
}

function logError(message: string, error?: unknown) {
  if (SHOULD_LOG) console.error(message, error);
}

export interface WorkerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
}

export function startV2BatchWorker(options: WorkerOptions = {}) {
  const maxConcurrency = options.concurrency ?? 2;
  const pollMs = options.pollIntervalMs ?? 5000;
  
  if (isRunning) {
    logWarn('[v2BatchWorker] Worker is already running.');
    return;
  }
  
  isRunning = true;
  let activeJobs = 0;
  
  logInfo(`[v2BatchWorker] Starting batch worker (Concurrency: ${maxConcurrency}, Polling: ${pollMs}ms)`);

  const poll = async () => {
    if (!isRunning) return;
    
    try {
      if (activeJobs >= maxConcurrency) {
        return; // Wait until capacity frees up
      }

      // We only query exactly how many jobs we can process right now
      // Due to lack of locking, in a real multi-node architecture we might need `SELECT FOR UPDATE SKIP LOCKED`
      // but for this Node.js singleton worker, simple status pulling is fine.
      const availableCapacity = maxConcurrency - activeJobs;
      const { jobs } = await v2JobStorage.listAllJobs({ status: 'queued', limit: availableCapacity });
      
      for (const job of jobs) {
        if (activeJobs >= maxConcurrency) break;
        
        activeJobs++;
        // Fire and forget the processing so we can pick up other jobs immediately if concurrency allows
        processJob(job).finally(() => {
          activeJobs--;
        });
      }
    } catch (error) {
      logError('[v2BatchWorker] Failed to poll queue:', error);
    } finally {
      if (isRunning) {
        pollingInterval = setTimeout(poll, pollMs);
      }
    }
  };

  // Start polling
  poll();
}

export function stopV2BatchWorker() {
  isRunning = false;
  if (pollingInterval) {
    clearTimeout(pollingInterval);
    pollingInterval = null;
  }
  logInfo('[v2BatchWorker] Stopped batch worker.');
}

async function processJob(job: V2StoredJob) {
  try {
    await v2JobStorage.markProcessing(job.id);
    const { response } = await processV2Conversion(job.request, { adapters, executionMode: 'async' });
    
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
    
    console.info(`[v2BatchWorker] Completed job ${job.id}`);
  } catch (error) {
    logError(`[v2BatchWorker] Job ${job.id} failed:`, error);
    await v2JobStorage.failJob(job.id, error instanceof Error ? error.message : String(error));
  }
}
