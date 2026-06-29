import { listJobs, updateJob } from './persistence.js';

export interface CleanupResult {
  cleanedJobs: number;
  removedExports: number;
}

export interface AuthorityRecheckResult {
  reviewedCitations: number;
  flaggedCitations: number;
}

export async function cleanupRuntimeArtifacts(olderThanMs = 24 * 60 * 60 * 1000): Promise<CleanupResult> {
  const cutoff = Date.now() - olderThanMs;
  let cleanedJobs = 0;
  let removedExports = 0;

  for (const job of await listJobs()) {
    const completedAt = job.completedAt ? Date.parse(job.completedAt) : 0;
    if (Number.isNaN(completedAt) || completedAt > cutoff) continue;

    removedExports += Object.keys(job.exports).length;
    await updateJob(job.id, (current) => {
      current.exports = {};
      delete current.textExport;
    });
    cleanedJobs += 1;
  }

  return {
    cleanedJobs,
    removedExports,
  };
}

export async function recheckAuthorityFlags(): Promise<AuthorityRecheckResult> {
  let reviewedCitations = 0;
  let flaggedCitations = 0;

  for (const job of await listJobs()) {
    for (const citation of job.result?.references ?? []) {
      reviewedCitations += 1;
      const haystack = `${citation.raw} ${citation.fields.title.value ?? ''}`.toLowerCase();
      if (
        citation.authorityFlags.length > 0 ||
        haystack.includes('retracted') ||
        haystack.includes('expression of concern')
      ) {
        flaggedCitations += 1;
      }
    }
  }

  return {
    reviewedCitations,
    flaggedCitations,
  };
}
