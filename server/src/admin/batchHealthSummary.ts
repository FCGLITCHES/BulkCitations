import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  apiKeys as apiKeysTable,
  citations as citationsTable,
  organizations as organizationsTable,
  users as usersTable,
} from '../db/schema.js';
import type { ProcessedCitation } from '../engine/types/citation.js';
import {
  deleteBatchHealthSummary,
  getApiKey,
  getBatchHealthSummary,
  getJob,
  listBatchHealthSummaries,
  listJobs,
  listReportsByJobId,
  runtimePersistenceBackend,
  saveBatchHealthSummary,
  updateJob,
  type StoredBatchHealthSummary,
  type StoredJob,
  type StoredReport,
} from '../runtime/persistence.js';

const OPEN_REPORT_STATUSES = new Set<StoredReport['status']>(['pending', 'proposed']);
const NON_READY_CITATION_STATUSES = new Set<ProcessedCitation['publicStatus']>(['needs_action', 'needs_review']);
const pendingRebuilds = new Set<string>();

interface BatchOwner {
  ownerLabel: string;
  ownerType: StoredBatchHealthSummary['ownerType'];
}

interface BatchCitationState {
  id: string;
  index: number;
  raw: string;
  renderedText: string | null;
  publicStatus: ProcessedCitation['publicStatus'];
  updatedAt: string;
  createdAt: string;
  rawScore: number;
  failed: boolean;
  outputStyle: string | null;
}

function isOpenReport(report: StoredReport): boolean {
  return OPEN_REPORT_STATUSES.has(report.status);
}

function isNonReadyCitation(citation: { publicStatus: ProcessedCitation['publicStatus'] }): boolean {
  return NON_READY_CITATION_STATUSES.has(citation.publicStatus);
}

function toIsoOrNull(date: string | null | undefined): string | null {
  return date ?? null;
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestValue = -Infinity;

  for (const value of values) {
    if (!value) continue;
    const millis = new Date(value).getTime();
    if (Number.isNaN(millis)) continue;
    if (millis > latestValue) {
      latest = value;
      latestValue = millis;
    }
  }

  return latest;
}

function citationTimestamp(citation: ProcessedCitation, fallback: string): string {
  return citation.updatedAt ?? citation.createdAt ?? fallback;
}

function reportTimestamp(report: StoredReport): string {
  return report.updatedAt ?? report.createdAt;
}

function toBatchCitationState(
  citation: ProcessedCitation,
  fallbackCreatedAt: string,
): BatchCitationState {
  const createdAt = citation.createdAt ?? fallbackCreatedAt;
  return {
    id: citation.id,
    index: citation.index,
    raw: citation.raw,
    renderedText: citation.renderedText || null,
    publicStatus: citation.publicStatus,
    updatedAt: citation.updatedAt ?? createdAt,
    createdAt,
    rawScore: citation.rawScore ?? 0,
    failed: citation.status === 'error',
    outputStyle: citation.outputStyle ?? null,
  };
}

async function loadBatchCitations(job: StoredJob): Promise<BatchCitationState[]> {
  if (runtimePersistenceBackend === 'database') {
    const rows = await db
      .select({
        id: citationsTable.id,
        index: citationsTable.referenceIndex,
        raw: citationsTable.rawText,
        renderedText: citationsTable.renderedText,
        publicStatus: citationsTable.publicStatus,
        updatedAt: citationsTable.updatedAt,
        createdAt: citationsTable.createdAt,
        rawScore: citationsTable.rawScore,
        status: citationsTable.status,
        outputStyle: citationsTable.outputStyle,
      })
      .from(citationsTable)
      .where(eq(citationsTable.jobId, job.id))
      .orderBy(citationsTable.referenceIndex);

    if (rows.length > 0 || !(job.result?.references.length)) {
      return rows.map((row) => ({
        id: row.id,
        index: row.index,
        raw: row.raw,
        renderedText: row.renderedText ?? null,
        publicStatus: row.publicStatus as ProcessedCitation['publicStatus'],
        updatedAt: row.updatedAt?.toISOString() ?? row.createdAt?.toISOString() ?? job.createdAt,
        createdAt: row.createdAt?.toISOString() ?? job.createdAt,
        rawScore: row.rawScore ?? 0,
        failed: row.status === 'failed',
        outputStyle: row.outputStyle ?? null,
      }));
    }
  }

  return (job.result?.references ?? []).map((citation) =>
    toBatchCitationState(citation, job.createdAt),
  );
}

function latestRelevantSourceTimestamp(
  citations: BatchCitationState[],
  reports: StoredReport[],
): string | null {
  return maxIso([
    ...citations.map((citation) => citation.updatedAt),
    ...reports.map((report) => reportTimestamp(report)),
  ]);
}

async function resolveBatchOwner(job: StoredJob): Promise<BatchOwner> {
  const requestOptions =
    job.request.options && typeof job.request.options === 'object'
      ? job.request.options as Record<string, unknown>
      : null;

  const institutionName =
    typeof requestOptions?.institutionName === 'string' && requestOptions.institutionName.trim()
      ? requestOptions.institutionName.trim()
      : null;
  if (institutionName) {
    return {
      ownerLabel: institutionName,
      ownerType: 'institution',
    };
  }

  if (runtimePersistenceBackend === 'database') {
    if (job.orgId) {
      const [organization] = await db
        .select({
          name: organizationsTable.name,
        })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, job.orgId))
        .limit(1);
      if (organization?.name?.trim()) {
        return {
          ownerLabel: organization.name.trim(),
          ownerType: 'institution',
        };
      }
    }

    if (job.userId) {
      const [user] = await db
        .select({
          name: usersTable.name,
          email: usersTable.email,
        })
        .from(usersTable)
        .where(eq(usersTable.id, job.userId))
        .limit(1);
      if (user?.name?.trim()) {
        return {
          ownerLabel: user.name.trim(),
          ownerType: 'user',
        };
      }
      if (user?.email?.trim()) {
        return {
          ownerLabel: user.email.trim(),
          ownerType: 'user',
        };
      }
    }

    if (job.apiKeyId) {
      const [apiKey] = await db
        .select({
          id: apiKeysTable.id,
          name: apiKeysTable.name,
          keyPrefix: apiKeysTable.keyPrefix,
        })
        .from(apiKeysTable)
        .where(eq(apiKeysTable.id, job.apiKeyId))
        .limit(1);
      if (apiKey) {
        const label = apiKey.name?.trim() || `API key ${apiKey.keyPrefix}`;
        return {
          ownerLabel: label,
          ownerType: 'api_key',
        };
      }
    }
  }

  if (job.apiKeyId) {
    const apiKey = await getApiKey(job.apiKeyId);
    if (apiKey) {
      return {
        ownerLabel: apiKey.name.trim() || `API key ${apiKey.prefix}`,
        ownerType: 'api_key',
      };
    }
    return {
      ownerLabel: `API key ${job.apiKeyId.slice(0, 8)}`,
      ownerType: 'api_key',
    };
  }

  return {
    ownerLabel: 'Guest / Unknown',
    ownerType: 'guest',
  };
}

function buildJobResultSummary(
  job: StoredJob,
  citations: BatchCitationState[],
): NonNullable<StoredJob['result']>['summary'] | undefined {
  if (!job.result) return undefined;

  const total = citations.length;
  const rawScoreTotal = citations.reduce((sum, citation) => sum + citation.rawScore, 0);

  return {
    total,
    ready: citations.filter((citation) => citation.publicStatus === 'ready').length,
    needsReview: citations.filter((citation) => citation.publicStatus === 'needs_review').length,
    needsAction: citations.filter((citation) => citation.publicStatus === 'needs_action').length,
    failed: citations.filter((citation) => citation.failed).length,
    parseQuality: total === 0 ? 0 : Math.round(rawScoreTotal / total),
  };
}

async function buildBatchHealthSummary(
  job: StoredJob,
  citations: BatchCitationState[],
  reports: StoredReport[],
): Promise<StoredBatchHealthSummary> {
  const now = new Date().toISOString();
  const owner = await resolveBatchOwner(job);
  const openReports = reports.filter(isOpenReport);
  const openReportsByCitationId = new Map<string, StoredReport[]>();

  for (const report of openReports) {
    const citationReports = openReportsByCitationId.get(report.citationId) ?? [];
    citationReports.push(report);
    openReportsByCitationId.set(report.citationId, citationReports);
  }

  const readyCount = citations.filter((citation) => citation.publicStatus === 'ready').length;
  const needsReviewCount = citations.filter((citation) => citation.publicStatus === 'needs_review').length;
  const needsActionCount = citations.filter((citation) => citation.publicStatus === 'needs_action').length;
  const openPendingReportCount = openReports.filter((report) => report.status === 'pending').length;
  const openProposedReportCount = openReports.filter((report) => report.status === 'proposed').length;
  const openReportTotal = openReports.length;
  const flaggedCitationCount = citations.filter((citation) => {
    return isNonReadyCitation(citation) || (openReportsByCitationId.get(citation.id)?.length ?? 0) > 0;
  }).length;
  const hasPipelineFlags = needsActionCount > 0 || needsReviewCount > 0;
  const latestCitationAt = maxIso(
    citations
      .filter((citation) => isNonReadyCitation(citation))
      .map((citation) => citation.updatedAt ?? citation.createdAt ?? job.createdAt),
  );
  const latestOpenReportAt = maxIso(openReports.map((report) => reportTimestamp(report)));
  const latestActionableAt = maxIso([latestCitationAt, latestOpenReportAt]);

  let healthLabel: StoredBatchHealthSummary['healthLabel'] = 'Ready';
  if (needsActionCount > 0) {
    healthLabel = 'Action Needed';
  } else if (needsReviewCount > 0 || openReportTotal > 0) {
    healthLabel = 'Review';
  }

  let queueSource: StoredBatchHealthSummary['queueSource'] = 'none';
  if (hasPipelineFlags && openReportTotal > 0) {
    queueSource = 'both';
  } else if (openReportTotal > 0) {
    queueSource = 'reports_only';
  } else if (hasPipelineFlags) {
    queueSource = 'pipeline_only';
  }

  return {
    jobId: job.id,
    ownerLabel: owner.ownerLabel,
    ownerType: owner.ownerType,
    outputStyle: job.request.outputStyle ?? citations[0]?.outputStyle ?? null,
    createdAt: job.createdAt,
    latestActionableAt: toIsoOrNull(latestActionableAt),
    totalCitations: citations.length,
    flaggedCitationCount,
    counts: {
      ready: readyCount,
      needsReview: needsReviewCount,
      needsAction: needsActionCount,
    },
    openReportCounts: {
      pending: openPendingReportCount,
      proposed: openProposedReportCount,
      total: openReportTotal,
    },
    healthLabel,
    queueSource,
    inQueue: flaggedCitationCount > 0,
    lastSyncedAt: now,
  };
}

export async function rebuildBatchHealthSummary(
  jobId: string,
): Promise<StoredBatchHealthSummary | null> {
  const [job, reports] = await Promise.all([
    getJob(jobId),
    listReportsByJobId(jobId),
  ]);

  if (!job) {
    await deleteBatchHealthSummary(jobId);
    return null;
  }

  const citations = await loadBatchCitations(job);
  const nextJobSummary = buildJobResultSummary(job, citations);
  if (nextJobSummary) {
    await updateJob(jobId, (current) => {
      if (!current.result) return;
      current.result.summary = nextJobSummary;
    });
  }

  const summary = await buildBatchHealthSummary(job, citations, reports);
  try {
    await saveBatchHealthSummary(summary, { logErrors: false });
    return summary;
  } catch (error) {
    if (await shouldIgnoreMissingJobSummaryRace(jobId, error)) {
      await deleteBatchHealthSummary(jobId);
      return null;
    }
    logUnhandledBatchHealthSummarySaveFailure(jobId, error);
    throw error;
  }
}

function canQueueBatchHealthRebuilds(): boolean {
  return process.env.NODE_ENV !== 'test';
}

async function enqueueInProcessRebuild(jobId: string): Promise<void> {
  if (!jobId || pendingRebuilds.has(jobId)) return;

  pendingRebuilds.add(jobId);
  queueMicrotask(() => {
    void rebuildBatchHealthSummary(jobId).finally(() => {
      pendingRebuilds.delete(jobId);
    });
  });
}

export async function enqueueBatchHealthSummaryRebuild(jobId: string): Promise<void> {
  if (!jobId) return;

  await enqueueInProcessRebuild(jobId);
}

async function isBatchHealthSummaryStale(
  job: StoredJob,
  summary: StoredBatchHealthSummary,
  reports: StoredReport[],
): Promise<boolean> {
  const citations = await loadBatchCitations(job);
  const latestRelevantAt = latestRelevantSourceTimestamp(citations, reports);
  if (!latestRelevantAt) {
    return false;
  }
  return new Date(summary.lastSyncedAt).getTime() < new Date(latestRelevantAt).getTime();
}

async function repairMissingOrStaleBatchHealthSummaries(
  jobs: StoredJob[],
  summaries: StoredBatchHealthSummary[],
): Promise<void> {
  const jobIds = new Set(jobs.map((job) => job.id));
  const summaryByJobId = new Map(summaries.map((summary) => [summary.jobId, summary]));

  await Promise.all(
    summaries
      .filter((summary) => !jobIds.has(summary.jobId))
      .map((summary) => deleteBatchHealthSummary(summary.jobId)),
  );

  for (const job of jobs) {
    const summary = summaryByJobId.get(job.id);
    if (!summary) {
      await rebuildBatchHealthSummary(job.id);
      continue;
    }

    const reports = await listReportsByJobId(job.id);
    const stale = await isBatchHealthSummaryStale(job, summary, reports);
    if (!stale) {
      continue;
    }

    if (canQueueBatchHealthRebuilds()) {
      await enqueueBatchHealthSummaryRebuild(job.id);
    } else {
      await rebuildBatchHealthSummary(job.id);
    }
  }
}

export async function ensureBatchHealthSummaries(): Promise<StoredBatchHealthSummary[]> {
  const [jobs, summaries] = await Promise.all([
    listJobs(),
    listBatchHealthSummaries(),
  ]);
  await repairMissingOrStaleBatchHealthSummaries(jobs, summaries);

  return listBatchHealthSummaries();
}

export async function ensureBatchHealthSummary(jobId: string): Promise<StoredBatchHealthSummary | null> {
  const [job, summary, reports] = await Promise.all([
    getJob(jobId),
    getBatchHealthSummary(jobId),
    listReportsByJobId(jobId),
  ]);

  if (!job) {
    return null;
  }

  if (!summary) {
    return rebuildBatchHealthSummary(jobId);
  }

  if (await isBatchHealthSummaryStale(job, summary, reports)) {
    if (canQueueBatchHealthRebuilds()) {
      await enqueueBatchHealthSummaryRebuild(jobId);
      return summary;
    }
    return rebuildBatchHealthSummary(jobId);
  }

  return summary;
}

export async function listFlaggedCitationLineItems(
  jobId: string,
  cursor: number | null,
  limit: number,
): Promise<{
  citations: Array<{
    citationId: string;
    jobId: string;
    index: number;
    originalText: string;
    renderedPreview: string | null;
    publicStatus: ProcessedCitation['publicStatus'];
    latestTimestamp: string;
    linkedReports: Array<{
      id: string;
      citationId: string;
      status: 'pending' | 'proposed';
      source: string;
      createdAt: string;
      updatedAt: string;
      failureCategories: string[];
    }>;
  }>;
  totalFlaggedCitations: number;
  nextCursor: number | null;
}> {
  const [job, reports] = await Promise.all([
    getJob(jobId),
    listReportsByJobId(jobId),
  ]);

  if (!job) {
    return {
      citations: [],
      totalFlaggedCitations: 0,
      nextCursor: null,
    };
  }

  const citations = await loadBatchCitations(job);
  const openReports = reports.filter(isOpenReport);
  const openReportsByCitationId = new Map<string, StoredReport[]>();
  for (const report of openReports) {
    const citationReports = openReportsByCitationId.get(report.citationId) ?? [];
    citationReports.push(report);
    openReportsByCitationId.set(report.citationId, citationReports);
  }

  const flagged = citations
    .filter((citation) => {
      return isNonReadyCitation(citation) || (openReportsByCitationId.get(citation.id)?.length ?? 0) > 0;
    })
    .sort((left, right) => left.index - right.index);

  const offset = cursor == null
    ? 0
    : flagged.findIndex((citation) => citation.index > cursor);
  const start = offset < 0 ? flagged.length : offset;
  const slice = flagged.slice(start, start + limit);

  const citationItems = slice.map((citation) => {
    const linkedReports = (openReportsByCitationId.get(citation.id) ?? [])
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .map((report) => ({
        id: report.id,
        citationId: report.citationId,
        status: report.status as 'pending' | 'proposed',
        source: report.source ?? 'user',
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        failureCategories: report.failureCategories?.length
          ? report.failureCategories
          : [report.failureCategory],
      }));

    return {
      citationId: citation.id,
      jobId,
      index: citation.index,
      originalText: citation.raw,
      renderedPreview: citation.renderedText,
      publicStatus: citation.publicStatus,
      latestTimestamp: maxIso([
        citation.updatedAt,
        ...linkedReports.map((report) => report.updatedAt),
      ]) ?? job.createdAt,
      linkedReports,
    };
  });

  return {
    citations: citationItems,
    totalFlaggedCitations: flagged.length,
    nextCursor: slice.length === limit ? slice.at(-1)?.index ?? null : null,
  };
}

export async function scheduleBatchHealthSummaryRepairSweep(): Promise<void> {
  const [jobs, summaries] = await Promise.all([
    listJobs(),
    listBatchHealthSummaries(),
  ]);
  await repairMissingOrStaleBatchHealthSummaries(jobs, summaries);
}

export async function flushBatchHealthSummaryQueueForTests(): Promise<void> {
  await scheduleBatchHealthSummaryRepairSweep();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function listLatestBatchHealthSummaries(limit: number): Promise<StoredBatchHealthSummary[]> {
  const summaries = await ensureBatchHealthSummaries();
  return [...summaries]
    .sort((left, right) => {
      const leftTime = new Date(left.latestActionableAt ?? left.createdAt).getTime();
      const rightTime = new Date(right.latestActionableAt ?? right.createdAt).getTime();
      return rightTime - leftTime;
    })
    .slice(0, limit);
}

async function shouldIgnoreMissingJobSummaryRace(jobId: string, error: unknown): Promise<boolean> {
  if (!isBatchHealthSummaryJobForeignKeyRace(error)) {
    return false;
  }

  const job = await getJob(jobId);
  return !job;
}

function isBatchHealthSummaryJobForeignKeyRace(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('batch_health_summaries_job_id_jobs_id_fk')
    || message.includes('violates foreign key constraint');
}

function logUnhandledBatchHealthSummarySaveFailure(jobId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[batchHealthSummary] save failed for ${jobId}: ${message}`);
}
