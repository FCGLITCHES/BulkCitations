/**
 * Postgres-backed persistence layer via Drizzle ORM.
 * Drop-in async alternative to the in-memory store (./store.ts).
 */

import { db } from '../db/connection.js';
import {
  jobs as jobsTable,
  citations as citationsTable,
  citationReports as citationReportsTable,
  batchHealthSummaries as batchHealthSummariesTable,
  userCorrections as userCorrectionsTable,
  apiKeys as apiKeysTable,
  organizations as organizationsTable,
  users as usersTable,
  citationVersions as citationVersionsTable,
  citationExtractionHistory as citationExtractionHistoryTable,
  usage as usageTable,
  activeLearningQueue as activeLearningQueueTable,
  egressRequests as egressRequestsTable,
  egressRollupsDaily as egressRollupsDailyTable,
  egressRollupsMonthly as egressRollupsMonthlyTable,
} from '../db/schema.js';
import { eq, desc, and, asc, sql, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { resolvePersistenceBackend } from './persistenceMode.js';
import type {
  StoredJob,
  StoredEvent,
  StoredJobStatus,
  StoredExport,
  StoredCorrection,
  StoredFieldApprovalMap,
  StoredProposedPattern,
  StoredReport,
  StoredReportDuplicateDecision,
  StoredReviewEvent,
  StoredReportReviewState,
  StoredMutationOptions,
  StoredApiKey,
  StoredAdminReferenceArchiveFilters,
  StoredAdminReferenceArchiveItem,
  StoredAdminReferenceArchiveResult,
  StoredAdminReferenceOwnerType,
  StoredBatchHealthSummary,
  StoredCitationVersion,
  StoredCitationExtractionHistory,
  LearningQueueItem,
  StoredEgressEvent,
  StoredEgressRollup,
  UsageScope,
} from './store.js';
import type { ExportFormat } from '../engine/types/api.js';
import type { ProcessedCitation } from '../engine/types/citation.js';
import { PersistenceConflictError } from './persistenceErrors.js';
import { groupLearningQueueItems } from './learningQueueGroups.js';

/* ------------------------------------------------------------------ */
/*  Environment guard                                                  */
/* ------------------------------------------------------------------ */

export function useDbStore(): boolean {
  const nodeEnv = process.env.NODE_ENV === 'production'
    ? 'production'
    : process.env.NODE_ENV === 'test'
      ? 'test'
      : 'development';
  return resolvePersistenceBackend({
    nodeEnv,
    configuredBackend: (process.env.PERSISTENCE_BACKEND as 'auto' | 'database' | undefined) ?? 'auto',
    databaseUrl: process.env.DATABASE_URL,
  }) === 'database';
}

/* ------------------------------------------------------------------ */
/*  Internal helpers: StoredJob ↔ DB row mapping                       */
/* ------------------------------------------------------------------ */

/**
 * Rich job data that doesn't map 1-to-1 with top-level columns is
 * serialised into the `summary` JSONB column as a single blob.
 * Top-level scalar columns (status, totalRefs …) are kept in their
 * own columns for indexing and filtering.
 */
interface JobJsonBlob {
  result?: StoredJob['result'] | undefined;
  events: StoredEvent[];
  textExport?: string | undefined;
  exports: StoredJob['exports'];
  error?: StoredJob['error'] | undefined;
  progress?: StoredJob['progress'] | undefined;
}

type StoredTier = NonNullable<StoredJob['tier']>;

function normalizeStoredTier(value: unknown): StoredTier {
  if (value === 'anonymous' || value === 'free' || value === 'pro' || value === 'b2b') {
    return value;
  }
  return 'free';
}

function jobToRow(job: StoredJob) {
  const tier = normalizeStoredTier(job.tier);
  const blob: JobJsonBlob = {
    result: job.result,
    events: job.events,
    textExport: job.textExport,
    exports: job.exports,
    error: job.error,
    progress: job.progress,
  };

  return {
    id: job.id,
    userId: job.userId ?? null,
    orgId: job.orgId ?? null,
    apiKeyId: job.apiKeyId ?? null,
    status: job.status,
    executionMode: job.executionMode,
    sourceType: job.request.sourceType,
    outputStyle: job.request.outputStyle ?? 'apa7',
    options: job.request as unknown as Record<string, unknown>,
    summary: blob as unknown as Record<string, unknown>,
    tier,
    totalRefs: job.progress?.totalRefs ?? 0,
    processedRefs: job.progress?.processedRefs ?? 0,
    currentPhase: job.progress?.currentPhase ?? null,
    createdAt: new Date(job.createdAt),
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
    idempotencyKey: job.request.idempotencyKey ?? null,
  };
}

function rowToJob(row: typeof jobsTable.$inferSelect): StoredJob {
  const blob = (row.summary ?? {}) as Partial<JobJsonBlob>;
  const request = (row.options ?? {}) as StoredJob['request'];
  const tier = normalizeStoredTier(row.tier);

  return {
    id: row.id,
    request,
    ...(row.userId != null && { userId: row.userId }),
    ...(row.orgId != null && { orgId: row.orgId }),
    ...(row.apiKeyId != null && { apiKeyId: row.apiKeyId }),
    tier,
    executionMode: (row.executionMode ?? 'sync') as 'sync' | 'async',
    status: (row.status ?? 'pending') as StoredJobStatus,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    exports: blob.exports ?? {},
    events: blob.events ?? [],
    ...(row.completedAt != null && { completedAt: row.completedAt.toISOString() }),
    ...(blob.progress != null && { progress: blob.progress }),
    ...(blob.result != null && { result: blob.result }),
    ...(blob.textExport != null && { textExport: blob.textExport }),
    ...(blob.error != null && { error: blob.error }),
  };
}

function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized.toISOString();
}

function errMsg(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];
    if (err.cause instanceof Error && err.cause.message.trim()) {
      parts.push(`cause: ${err.cause.message}`);
    }
    const message = parts.filter((part) => part.trim()).join(' | ').trim();
    return message || inspect(err, { depth: 2, breakLength: 120 });
  }

  if (err && typeof err === 'object') {
    const record = err as { message?: unknown; detail?: unknown; code?: unknown };
    const parts = [
      typeof record.message === 'string' ? record.message : '',
      typeof record.detail === 'string' ? record.detail : '',
      record.code != null ? `code: ${String(record.code)}` : '',
    ].filter((part) => part.trim());

    if (parts.length > 0) {
      return parts.join(' | ');
    }

    return inspect(err, { depth: 2, breakLength: 120 });
  }

  const message = String(err).trim();
  return message || 'Unknown persistence error';
}

type DbWriter = Pick<typeof db, 'insert' | 'delete'>;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const CITATION_PROJECTION_UPSERT_CHUNK_SIZE = 100;
const ASYNC_CITATION_PROJECTION_MIN_REFS = 250;

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function rowToStoredReviewState(value: unknown): StoredReportReviewState | undefined {
  const record = asJsonRecord(value);
  if (!record) {
    return undefined;
  }

  const reviewState: StoredReportReviewState = {};
  if (typeof record.assigneeName === 'string') {
    reviewState.assigneeName = record.assigneeName;
  }
  if (Array.isArray(record.reviewEvents)) {
    reviewState.reviewEvents = record.reviewEvents as StoredReviewEvent[];
  }
  const fieldApproval = asJsonRecord(record.fieldApproval);
  if (fieldApproval) {
    reviewState.fieldApproval = fieldApproval as StoredFieldApprovalMap;
  }
  const failureTaxonomy = asStringArray(record.failureTaxonomy);
  if (failureTaxonomy) {
    reviewState.failureTaxonomy = failureTaxonomy;
  }
  if (typeof record.duplicateDecision === 'string') {
    reviewState.duplicateDecision = record.duplicateDecision as StoredReportDuplicateDecision;
  }
  if (typeof record.fixType === 'string') {
    reviewState.fixType = record.fixType as NonNullable<StoredReportReviewState['fixType']>;
  }
  if (typeof record.referenceType === 'string') {
    reviewState.referenceType = record.referenceType;
  }
  const proposedPattern = asJsonRecord(record.proposedPattern);
  if (proposedPattern) {
    reviewState.proposedPattern = proposedPattern as unknown as StoredProposedPattern;
  }
  if (typeof record.proposedStyleFix === 'string') {
    reviewState.proposedStyleFix = record.proposedStyleFix;
  }
  if (typeof record.resolvedByCommit === 'string') {
    reviewState.resolvedByCommit = record.resolvedByCommit;
  }
  if (typeof record.resolvedByVersion === 'string') {
    reviewState.resolvedByVersion = record.resolvedByVersion;
  }
  return Object.keys(reviewState).length > 0 ? reviewState : undefined;
}

function reportReviewStateToRow(
  value: StoredReportReviewState | undefined,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  return {
    ...(value.assigneeName ? { assigneeName: value.assigneeName } : {}),
    ...(value.reviewEvents ? { reviewEvents: value.reviewEvents } : {}),
    ...(value.fieldApproval ? { fieldApproval: value.fieldApproval } : {}),
    ...(value.failureTaxonomy ? { failureTaxonomy: value.failureTaxonomy } : {}),
    ...(value.duplicateDecision ? { duplicateDecision: value.duplicateDecision } : {}),
    ...(value.fixType ? { fixType: value.fixType } : {}),
    ...(value.referenceType ? { referenceType: value.referenceType } : {}),
    ...(value.proposedPattern ? { proposedPattern: value.proposedPattern } : {}),
    ...(value.proposedStyleFix ? { proposedStyleFix: value.proposedStyleFix } : {}),
    ...(value.resolvedByCommit ? { resolvedByCommit: value.resolvedByCommit } : {}),
    ...(value.resolvedByVersion ? { resolvedByVersion: value.resolvedByVersion } : {}),
  };
}

function citationStorageStatus(citation: ProcessedCitation): 'active' | 'duplicate' | 'failed' {
  if (citation.status === 'error') {
    return 'failed';
  }
  if (citation.duplicateOf) {
    return 'duplicate';
  }
  return 'active';
}

function citationToProjectionRow(
  job: StoredJob,
  citation: ProcessedCitation,
): typeof citationsTable.$inferInsert {
  const createdAt = citation.createdAt ?? job.createdAt;
  const updatedAt = citation.updatedAt ?? createdAt;

  return {
    id: citation.id,
    jobId: job.id,
    batchId: null,
    userId: job.userId ?? null,
    referenceIndex: citation.index,
    rawText: citation.raw,
    referenceType: citation.referenceType,
    detectedStyle: citation.detectedStyle,
    outputStyle: citation.outputStyle,
    pipelineMajor: citation.pipelineMajor,
    publicStatus: citation.publicStatus,
    status: citationStorageStatus(citation),
    duplicateOf: citation.duplicateOf ?? null,
    fields: citation.fields as unknown as Record<string, unknown>,
    rawScore: citation.rawScore,
    displayScore: citation.displayScore,
    authorityFlags: citation.authorityFlags as unknown as Record<string, unknown>[],
    authorityCheckedAt: null,
    renderedText: citation.renderedText,
    renderedWarnings: citation.renderedWarnings,
    stageLog: citation.stageLog as unknown as Record<string, unknown>[],
    splitMeta: citation.inputCleanup
      ? (citation.inputCleanup as unknown as Record<string, unknown>)
      : null,
    extractionMeta: citation.extractionMeta
      ? (citation.extractionMeta as unknown as Record<string, unknown>)
      : null,
    enrichmentMeta: null,
    normalizationMeta: null,
    provenanceMeta: {
      detectedStyleFamily: citation.detectedStyleFamily,
      styleResolution: citation.styleResolution,
      doiVerification: citation.doiVerification,
      familyConfidence: citation.familyConfidence,
      styleConfidence: citation.styleConfidence,
      familyMarginToRunnerUp: citation.familyMarginToRunnerUp,
      styleMarginToRunnerUp: citation.styleMarginToRunnerUp,
      certaintyTier: citation.certaintyTier,
      styleCandidates: citation.styleCandidates,
      familyCandidates: citation.familyCandidates,
      styleSignals: citation.styleSignals,
      conflictDampened: citation.conflictDampened,
      healthReasons: citation.healthReasons,
      healthBreakdown: citation.healthBreakdown,
      healthWarnings: citation.healthWarnings,
      scoreBreakdown: citation.scoreBreakdown,
      status: citation.status,
      error: citation.error ?? null,
      partialData: citation.partialData ?? null,
      outputLatencyMs: citation.outputLatencyMs,
      doiFastPath: citation.doiFastPath ?? false,
      isDuplicateCandidate: citation.isDuplicateCandidate ?? false,
      normalizedHash: citation.normalizedHash ?? null,
      canonicalWorkKey: citation.canonicalWorkKey ?? null,
      nearDupClusterId: citation.nearDupClusterId ?? null,
    },
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  };
}

async function syncProjectedCitations(
  writer: DbWriter,
  job: StoredJob,
): Promise<void> {
  if (!job.result) {
    await writer.delete(citationsTable).where(eq(citationsTable.jobId, job.id));
    return;
  }

  const citationRows = job.result.references.map((citation) =>
    citationToProjectionRow(job, citation),
  );
  const citationIds = citationRows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string');

  if (citationIds.length === 0) {
    await writer.delete(citationsTable).where(eq(citationsTable.jobId, job.id));
    return;
  }

  await writer
    .delete(citationsTable)
    .where(and(eq(citationsTable.jobId, job.id), notInArray(citationsTable.id, citationIds)));

  for (let index = 0; index < citationRows.length; index += CITATION_PROJECTION_UPSERT_CHUNK_SIZE) {
    await writer
      .insert(citationsTable)
      .values(citationRows.slice(index, index + CITATION_PROJECTION_UPSERT_CHUNK_SIZE))
      .onConflictDoUpdate({
        target: citationsTable.id,
        set: citationProjectionExcludedUpdates,
      });
  }
}

const citationProjectionExcludedUpdates = {
  jobId: sql`excluded.job_id`,
  batchId: sql`excluded.batch_id`,
  userId: sql`excluded.user_id`,
  referenceIndex: sql`excluded.reference_index`,
  rawText: sql`excluded.raw_text`,
  referenceType: sql`excluded.reference_type`,
  detectedStyle: sql`excluded.detected_style`,
  outputStyle: sql`excluded.output_style`,
  pipelineMajor: sql`excluded.pipeline_major`,
  publicStatus: sql`excluded.public_status`,
  status: sql`excluded.status`,
  duplicateOf: sql`excluded.duplicate_of`,
  fields: sql`excluded.fields`,
  rawScore: sql`excluded.raw_score`,
  displayScore: sql`excluded.display_score`,
  authorityFlags: sql`excluded.authority_flags`,
  authorityCheckedAt: sql`excluded.authority_checked_at`,
  renderedText: sql`excluded.rendered_text`,
  renderedWarnings: sql`excluded.rendered_warnings`,
  stageLog: sql`excluded.stage_log`,
  splitMeta: sql`excluded.split_meta`,
  extractionMeta: sql`excluded.extraction_meta`,
  enrichmentMeta: sql`excluded.enrichment_meta`,
  normalizationMeta: sql`excluded.normalization_meta`,
  provenanceMeta: sql`excluded.provenance_meta`,
  createdAt: sql`excluded.created_at`,
  updatedAt: sql`excluded.updated_at`,
};

/* ------------------------------------------------------------------ */
/*  Jobs                                                               */
/* ------------------------------------------------------------------ */

export async function saveJob(job: StoredJob): Promise<void> {
  try {
    const row = jobToRow(job);
    const { id: _id, ...updates } = row;
    const deferProjection = shouldDeferCitationProjection(job);
    await db.transaction(async (tx) => {
      await tx.insert(jobsTable).values(row).onConflictDoUpdate({
        target: jobsTable.id,
        set: updates,
      });
      if (!deferProjection) {
        await syncProjectedCitations(tx, job);
      }
    });
    if (deferProjection) {
      void syncProjectedCitationsForJob(job);
    }
  } catch (err) {
    console.error('[dbStore] saveJob failed:', errMsg(err));
    throw new Error(`Failed to save job ${job.id}: ${errMsg(err)}`);
  }
}

function shouldDeferCitationProjection(job: StoredJob): boolean {
  return Boolean(
    job.result
    && (job.status === 'completed' || job.status === 'partial')
    && job.result.references.length >= ASYNC_CITATION_PROJECTION_MIN_REFS,
  );
}

async function syncProjectedCitationsForJob(job: StoredJob): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await syncProjectedCitations(tx, job);
    });
  } catch (err) {
    console.error('[dbStore] async citation projection sync failed:', errMsg(err));
  }
}

export async function getJob(id: string): Promise<StoredJob | undefined> {
  try {
    const rows = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .limit(1);
    return rows[0] ? rowToJob(rows[0]) : undefined;
  } catch (err) {
    console.error('[dbStore] getJob failed:', errMsg(err));
    throw new Error(`Failed to get job ${id}: ${errMsg(err)}`);
  }
}

export async function updateJob(
  id: string,
  updater: (job: StoredJob) => void,
): Promise<StoredJob | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, id))
        .limit(1);
      if (!rows[0]) return undefined;

      const job = rowToJob(rows[0]);
      updater(job);

      const { id: _pk, ...updates } = jobToRow(job);
      await tx.update(jobsTable).set(updates).where(eq(jobsTable.id, id));
      return job;
    });
  } catch (err) {
    console.error('[dbStore] updateJob failed:', errMsg(err));
    throw new Error(`Failed to update job ${id}: ${errMsg(err)}`);
  }
}

export async function listJobs(): Promise<StoredJob[]> {
  try {
    const rows = await db
      .select()
      .from(jobsTable)
      .orderBy(desc(jobsTable.createdAt));
    return rows.map(rowToJob);
  } catch (err) {
    console.error('[dbStore] listJobs failed:', errMsg(err));
    throw new Error(`Failed to list jobs: ${errMsg(err)}`);
  }
}

export async function deleteJob(id: string): Promise<boolean> {
  try {
    const deleted = await db
      .delete(jobsTable)
      .where(eq(jobsTable.id, id))
      .returning({ id: jobsTable.id });
    return deleted.length > 0;
  } catch (err) {
    console.error('[dbStore] deleteJob failed:', errMsg(err));
    throw new Error(`Failed to delete job ${id}: ${errMsg(err)}`);
  }
}

export async function appendJobEvent(
  jobId: string,
  event: Omit<StoredEvent, 'id'>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ summary: jobsTable.summary })
        .from(jobsTable)
        .where(eq(jobsTable.id, jobId))
        .limit(1);
      if (!rows[0]) return;

      const blob = (rows[0].summary ?? {}) as Partial<JobJsonBlob>;
      const events = blob.events ?? [];
      events.push({ id: events.length + 1, ...event });
      blob.events = events;

      await tx
        .update(jobsTable)
        .set({ summary: blob as unknown as Record<string, unknown> })
        .where(eq(jobsTable.id, jobId));
    });
  } catch (err) {
    console.error('[dbStore] appendJobEvent failed:', errMsg(err));
    throw new Error(`Failed to append event to job ${jobId}: ${errMsg(err)}`);
  }
}

export async function saveJobExport(
  jobId: string,
  artifact: StoredExport,
): Promise<void> {
  await updateJob(jobId, (job) => {
    job.exports[artifact.format] = artifact;
  });
}

export async function getJobExport(
  jobId: string,
  format: ExportFormat,
): Promise<StoredExport | undefined> {
  const job = await getJob(jobId);
  return job?.exports[format];
}

export async function listJobExports(jobId: string): Promise<StoredExport[]> {
  const job = await getJob(jobId);
  if (!job) return [];
  return Object.values(job.exports).filter(
    (a): a is StoredExport => a != null,
  );
}

export async function listActiveJobs(): Promise<StoredJob[]> {
  try {
    const rows = await db
      .select()
      .from(jobsTable)
      .where(sql`${jobsTable.status} IN ('pending', 'processing')`)
      .orderBy(desc(jobsTable.createdAt));
    return rows.map(rowToJob);
  } catch (err) {
    console.error('[dbStore] listActiveJobs failed:', errMsg(err));
    throw new Error(`Failed to list active jobs: ${errMsg(err)}`);
  }
}

export async function listClaimableAsyncJobIds(
  staleBefore: Date,
  limit = 25,
): Promise<string[]> {
  try {
    const rows = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(
        eq(jobsTable.executionMode, 'async'),
        or(
          eq(jobsTable.status, 'pending'),
          and(
            eq(jobsTable.status, 'processing'),
            or(
              isNull(jobsTable.startedAt),
              lt(jobsTable.startedAt, staleBefore),
            ),
          ),
        ),
      ))
      .orderBy(asc(jobsTable.createdAt))
      .limit(limit);
    return rows.map((row) => row.id);
  } catch (err) {
    console.error('[dbStore] listClaimableAsyncJobIds failed:', errMsg(err));
    throw new Error(`Failed to list claimable async jobs: ${errMsg(err)}`);
  }
}

export async function claimAsyncJobForProcessing(
  id: string,
  staleBefore: Date,
): Promise<StoredJob | undefined> {
  try {
    const rows = await db
      .update(jobsTable)
      .set({
        status: 'processing',
        startedAt: new Date(),
        currentPhase: 'ingestion',
      })
      .where(and(
        eq(jobsTable.id, id),
        eq(jobsTable.executionMode, 'async'),
        or(
          eq(jobsTable.status, 'pending'),
          and(
            eq(jobsTable.status, 'processing'),
            or(
              isNull(jobsTable.startedAt),
              lt(jobsTable.startedAt, staleBefore),
            ),
          ),
        ),
      ))
      .returning();
    return rows[0] ? rowToJob(rows[0]) : undefined;
  } catch (err) {
    console.error('[dbStore] claimAsyncJobForProcessing failed:', errMsg(err));
    throw new Error(`Failed to claim async job ${id}: ${errMsg(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Citations (within job result JSONB)                                */
/* ------------------------------------------------------------------ */

export async function getCitation(
  jobId: string,
  citationId: string,
): Promise<ProcessedCitation | undefined> {
  const job = await getJob(jobId);
  return job?.result?.references.find((c) => c.id === citationId);
}

export async function updateCitation(
  jobId: string,
  citationId: string,
  updater: (citation: ProcessedCitation) => void,
): Promise<ProcessedCitation | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, jobId))
        .limit(1);
      if (!rows[0]) return undefined;

      const job = rowToJob(rows[0]);
      if (!job.result) return undefined;

      const idx = job.result.references.findIndex((c) => c.id === citationId);
      if (idx < 0) return undefined;

      const citation = structuredClone(job.result.references[idx]!);
      updater(citation);
      const now = new Date().toISOString();
      citation.createdAt ??= now;
      citation.updatedAt = now;
      job.result.references[idx] = citation;

      const { summary } = jobToRow(job);
      await tx
        .update(jobsTable)
        .set({ summary })
        .where(eq(jobsTable.id, jobId));
      await syncProjectedCitations(tx, job);

      return citation;
    });
  } catch (err) {
    console.error('[dbStore] updateCitation failed:', errMsg(err));
    throw new Error(`Failed to update citation ${citationId}: ${errMsg(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Corrections                                                        */
/* ------------------------------------------------------------------ */

function rowToCorrection(
  r: typeof userCorrectionsTable.$inferSelect,
  fallbackJobId?: string | null,
): StoredCorrection {
  return {
    id: r.id,
    jobId: r.jobId ?? fallbackJobId ?? '',
    citationId: r.citationId ?? '',
    ...(r.userId ? { userId: r.userId } : {}),
    fieldName: r.fieldName,
    oldValue: r.oldValue,
    newValue: r.newValue,
    status: (r.status ?? 'pending') as StoredCorrection['status'],
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? r.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function saveCorrection(
  correction: StoredCorrection,
): Promise<void> {
  try {
    if (correction.jobId && correction.citationId) {
      await db.transaction(async (tx) => {
        await ensureProjectedCitationExists(tx, {
          citationId: correction.citationId,
          jobId: correction.jobId,
        });
      });
    }

    await db.insert(userCorrectionsTable).values({
      id: correction.id,
      jobId: correction.jobId || null,
      citationId: correction.citationId || null,
      userId: correction.userId ?? null,
      fieldName: correction.fieldName,
      oldValue: correction.oldValue as Record<string, unknown>,
      newValue: correction.newValue as Record<string, unknown>,
      status: correction.status,
      createdAt: new Date(correction.createdAt),
      updatedAt: new Date(correction.updatedAt),
    });
  } catch (err) {
    console.error('[dbStore] saveCorrection failed:', errMsg(err));
    throw new Error(
      `Failed to save correction ${correction.id}: ${errMsg(err)}`,
    );
  }
}

export async function getCorrection(
  id: string,
): Promise<StoredCorrection | undefined> {
  try {
    const rows = await db
      .select({
        correction: userCorrectionsTable,
        jobId: citationsTable.jobId,
      })
      .from(userCorrectionsTable)
      .leftJoin(
        citationsTable,
        eq(userCorrectionsTable.citationId, citationsTable.id),
      )
      .where(eq(userCorrectionsTable.id, id))
      .limit(1);

    if (!rows[0]) return undefined;
    return rowToCorrection(rows[0].correction, rows[0].jobId);
  } catch (err) {
    console.error('[dbStore] getCorrection failed:', errMsg(err));
    throw new Error(`Failed to get correction ${id}: ${errMsg(err)}`);
  }
}

export async function listCorrections(): Promise<StoredCorrection[]> {
  try {
    const rows = await db
      .select({
        correction: userCorrectionsTable,
        jobId: citationsTable.jobId,
      })
      .from(userCorrectionsTable)
      .leftJoin(
        citationsTable,
        eq(userCorrectionsTable.citationId, citationsTable.id),
      )
      .orderBy(desc(userCorrectionsTable.createdAt));

    return rows.map((r) => rowToCorrection(r.correction, r.jobId));
  } catch (err) {
    console.error('[dbStore] listCorrections failed:', errMsg(err));
    throw new Error(`Failed to list corrections: ${errMsg(err)}`);
  }
}

export async function updateCorrection(
  id: string,
  updater: (correction: StoredCorrection) => void,
): Promise<StoredCorrection | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          correction: userCorrectionsTable,
          jobId: citationsTable.jobId,
        })
        .from(userCorrectionsTable)
        .leftJoin(
          citationsTable,
          eq(userCorrectionsTable.citationId, citationsTable.id),
        )
        .where(eq(userCorrectionsTable.id, id))
        .limit(1);

      if (!rows[0]) return undefined;

      const correction = rowToCorrection(rows[0].correction, rows[0].jobId);
      updater(correction);
      correction.updatedAt = new Date().toISOString();

      await tx
        .update(userCorrectionsTable)
        .set({
          jobId: correction.jobId || null,
          userId: correction.userId ?? null,
          fieldName: correction.fieldName,
          oldValue: correction.oldValue as Record<string, unknown>,
          newValue: correction.newValue as Record<string, unknown>,
          status: correction.status,
          updatedAt: new Date(correction.updatedAt),
        })
        .where(eq(userCorrectionsTable.id, id));

      return correction;
    });
  } catch (err) {
    console.error('[dbStore] updateCorrection failed:', errMsg(err));
    throw new Error(`Failed to update correction ${id}: ${errMsg(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Reports                                                            */
/* ------------------------------------------------------------------ */

function rowToReport(
  r: typeof citationReportsTable.$inferSelect,
): StoredReport {
  const report: StoredReport = {
    id: r.id,
    jobId: r.jobId ?? '',
    citationId: r.citationId ?? '',
    failureCategory: r.failureCategory,
    status: (r.status ?? 'pending') as StoredReport['status'],
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? r.createdAt?.toISOString() ?? new Date().toISOString(),
    ...(r.userNote != null && { userNote: r.userNote }),
  };

  if (r.userId) {
    report.userId = r.userId;
  }
  if (r.source) {
    report.source = r.source as NonNullable<StoredReport['source']>;
  }
  if (r.failureCategories?.length) {
    report.failureCategories = r.failureCategories;
  }
  if (r.correctedFields) {
    report.correctedFields = r.correctedFields as Record<string, unknown>;
  }
  const stageBlame = asStringArray(r.stageBlame);
  if (stageBlame) {
    report.stageBlame = stageBlame;
  }
  if (asJsonRecord(r.resolutionTrace)) {
    report.resolutionTrace = r.resolutionTrace as NonNullable<StoredReport['resolutionTrace']>;
  }
  const reviewState = rowToStoredReviewState(r.reviewState);
  if (reviewState) {
    report.reviewState = reviewState;
  }
  if (r.engineSnapshot) {
    report.engineSnapshot = r.engineSnapshot as Record<string, unknown>;
  }
  if (r.fingerprint) {
    report.fingerprint = r.fingerprint;
  }
  if (r.reportCount != null) {
    report.reportCount = r.reportCount;
  }
  if (r.resolvedAt) {
    report.resolvedAt = r.resolvedAt.toISOString();
  }

  return report;
}

export async function saveReport(report: StoredReport): Promise<void> {
  try {
    await db.insert(citationReportsTable).values({
      id: report.id,
      jobId: report.jobId || null,
      citationId: report.citationId || null,
      userId: report.userId ?? null,
      source: report.source ?? 'user',
      failureCategory: report.failureCategory,
      failureCategories: report.failureCategories ?? [report.failureCategory],
      userNote: report.userNote ?? null,
      status: report.status,
      fingerprint: report.fingerprint ?? null,
      reportCount: report.reportCount ?? 1,
      engineSnapshot: report.engineSnapshot ?? null,
      stageBlame: report.stageBlame ?? null,
      correctedFields: report.correctedFields ?? null,
      resolutionTrace: report.resolutionTrace ?? null,
      reviewState: reportReviewStateToRow(report.reviewState),
      createdAt: new Date(report.createdAt),
      updatedAt: new Date(report.updatedAt),
      resolvedAt: report.resolvedAt ? new Date(report.resolvedAt) : null,
    });
  } catch (err) {
    console.error('[dbStore] saveReport failed:', errMsg(err));
    throw new Error(`Failed to save report ${report.id}: ${errMsg(err)}`);
  }
}

export async function getReport(
  id: string,
): Promise<StoredReport | undefined> {
  try {
    const rows = await db
      .select()
      .from(citationReportsTable)
      .where(eq(citationReportsTable.id, id))
      .limit(1);

    if (!rows[0]) return undefined;
    return rowToReport(rows[0]);
  } catch (err) {
    console.error('[dbStore] getReport failed:', errMsg(err));
    throw new Error(`Failed to get report ${id}: ${errMsg(err)}`);
  }
}

export async function listReports(): Promise<StoredReport[]> {
  try {
    const rows = await db
      .select()
      .from(citationReportsTable)
      .orderBy(desc(citationReportsTable.updatedAt), desc(citationReportsTable.createdAt));

    return rows.map((row) => rowToReport(row));
  } catch (err) {
    console.error('[dbStore] listReports failed:', errMsg(err));
    throw new Error(`Failed to list reports: ${errMsg(err)}`);
  }
}

function activeJobStatusFilter() {
  return inArray(jobsTable.status, ['pending', 'processing']);
}

export async function countActiveJobsForNonB2bScope(
  tier: 'anonymous' | 'free' | 'pro',
  scope: { userId?: string; apiKeyId?: string },
): Promise<number> {
  const scopeFilter = scope.userId
    ? eq(jobsTable.userId, scope.userId)
    : scope.apiKeyId
      ? eq(jobsTable.apiKeyId, scope.apiKeyId)
      : and(sql`${jobsTable.userId} IS NULL`, sql`${jobsTable.apiKeyId} IS NULL`);

  const rows = await db
    .select({
      total: sql<number>`COUNT(*)`,
    })
    .from(jobsTable)
    .where(and(activeJobStatusFilter(), eq(jobsTable.tier, tier), scopeFilter));

  return Number(rows[0]?.total ?? 0);
}

export async function countActiveB2bJobsForScope(
  scope: { orgId?: string; userId?: string; apiKeyId?: string },
): Promise<number> {
  const scopeFilter = scope.orgId
    ? eq(jobsTable.orgId, scope.orgId)
    : scope.userId
      ? eq(jobsTable.userId, scope.userId)
      : scope.apiKeyId
        ? eq(jobsTable.apiKeyId, scope.apiKeyId)
        : and(
            sql`${jobsTable.orgId} IS NULL`,
            sql`${jobsTable.userId} IS NULL`,
            sql`${jobsTable.apiKeyId} IS NULL`,
          );

  const rows = await db
    .select({
      total: sql<number>`COUNT(*)`,
    })
    .from(jobsTable)
    .where(and(activeJobStatusFilter(), eq(jobsTable.tier, 'b2b'), scopeFilter));

  return Number(rows[0]?.total ?? 0);
}

export async function countActiveB2bJobsGlobal(): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COUNT(*)`,
    })
    .from(jobsTable)
    .where(and(activeJobStatusFilter(), eq(jobsTable.tier, 'b2b')));

  return Number(rows[0]?.total ?? 0);
}

export async function listReportsByJobId(jobId: string): Promise<StoredReport[]> {
  try {
    const rows = await db
      .select()
      .from(citationReportsTable)
      .where(eq(citationReportsTable.jobId, jobId))
      .orderBy(desc(citationReportsTable.updatedAt), desc(citationReportsTable.createdAt));

    return rows.map((row) => rowToReport(row));
  } catch (err) {
    console.error('[dbStore] listReportsByJobId failed:', errMsg(err));
    throw new Error(`Failed to list reports for job ${jobId}: ${errMsg(err)}`);
  }
}

export async function deleteReports(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    const deleted = await db
      .delete(citationReportsTable)
      .where(inArray(citationReportsTable.id, ids))
      .returning({ id: citationReportsTable.id });
    return deleted.length;
  } catch (err) {
    console.error('[dbStore] deleteReports failed:', errMsg(err));
    throw new Error(`Failed to delete reports: ${errMsg(err)}`);
  }
}

export async function updateReport(
  id: string,
  updater: (report: StoredReport) => void,
  options?: StoredMutationOptions,
): Promise<StoredReport | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(citationReportsTable)
        .where(eq(citationReportsTable.id, id))
        .limit(1);

      if (!rows[0]) return undefined;

      const report = rowToReport(rows[0]);
      if (options?.expectedUpdatedAt && report.updatedAt !== options.expectedUpdatedAt) {
        throw new PersistenceConflictError(
          `Report ${id} has changed since it was loaded.`,
          report.updatedAt,
        );
      }
      updater(report);
      report.updatedAt = new Date().toISOString();
      const resolvedAt =
        report.status === 'accepted' || report.status === 'rejected' || report.status === 'duplicate'
          ? (report.resolvedAt ?? new Date().toISOString())
          : null;

      await tx
        .update(citationReportsTable)
        .set({
          jobId: report.jobId || null,
          citationId: report.citationId || null,
          userId: report.userId ?? null,
          source: report.source ?? 'user',
          failureCategory: report.failureCategory,
          failureCategories: report.failureCategories ?? [report.failureCategory],
          userNote: report.userNote ?? null,
          status: report.status,
          fingerprint: report.fingerprint ?? null,
          reportCount: report.reportCount ?? 1,
          engineSnapshot: report.engineSnapshot ?? null,
          stageBlame: report.stageBlame ?? null,
          correctedFields: report.correctedFields ?? null,
          resolutionTrace: report.resolutionTrace ?? null,
          reviewState: reportReviewStateToRow(report.reviewState),
          updatedAt: new Date(report.updatedAt),
          resolvedAt: resolvedAt ? new Date(resolvedAt) : null,
        })
        .where(eq(citationReportsTable.id, id));

      return {
        ...report,
        ...(resolvedAt ? { resolvedAt } : {}),
      };
    });
  } catch (err) {
    if (err instanceof PersistenceConflictError) {
      throw err;
    }
    console.error('[dbStore] updateReport failed:', errMsg(err));
    throw new Error(`Failed to update report ${id}: ${errMsg(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Batch health summaries                                             */
/* ------------------------------------------------------------------ */

function rowToBatchHealthSummary(
  row: typeof batchHealthSummariesTable.$inferSelect,
): StoredBatchHealthSummary {
  return {
    jobId: row.jobId,
    ownerLabel: row.ownerLabel,
    ownerType: row.ownerType as StoredBatchHealthSummary['ownerType'],
    outputStyle: row.outputStyle ?? null,
    createdAt: row.createdAt.toISOString(),
    latestActionableAt: row.latestActionableAt?.toISOString() ?? null,
    totalCitations: row.totalCitations ?? 0,
    flaggedCitationCount: row.flaggedCitationCount ?? 0,
    counts: {
      ready: row.readyCount ?? 0,
      needsReview: row.needsReviewCount ?? 0,
      needsAction: row.needsActionCount ?? 0,
    },
    openReportCounts: {
      pending: row.openPendingReportCount ?? 0,
      proposed: row.openProposedReportCount ?? 0,
      total: row.openReportTotal ?? 0,
    },
    healthLabel: row.healthLabel as StoredBatchHealthSummary['healthLabel'],
    queueSource: row.queueSource as StoredBatchHealthSummary['queueSource'],
    inQueue: row.inQueue ?? false,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}

export async function saveBatchHealthSummary(
  summary: StoredBatchHealthSummary,
  options: { logErrors?: boolean } = {},
): Promise<StoredBatchHealthSummary> {
  try {
    const row = {
      jobId: summary.jobId,
      ownerLabel: summary.ownerLabel,
      ownerType: summary.ownerType,
      outputStyle: summary.outputStyle ?? null,
      createdAt: new Date(summary.createdAt),
      latestActionableAt: summary.latestActionableAt ? new Date(summary.latestActionableAt) : null,
      totalCitations: summary.totalCitations,
      flaggedCitationCount: summary.flaggedCitationCount,
      readyCount: summary.counts.ready,
      needsReviewCount: summary.counts.needsReview,
      needsActionCount: summary.counts.needsAction,
      openPendingReportCount: summary.openReportCounts.pending,
      openProposedReportCount: summary.openReportCounts.proposed,
      openReportTotal: summary.openReportCounts.total,
      healthLabel: summary.healthLabel,
      queueSource: summary.queueSource,
      inQueue: summary.inQueue,
      lastSyncedAt: new Date(summary.lastSyncedAt),
    };
    const { jobId: _jobId, ...updates } = row;
    await db.insert(batchHealthSummariesTable).values(row).onConflictDoUpdate({
      target: batchHealthSummariesTable.jobId,
      set: updates,
    });
    return summary;
  } catch (err) {
    if (options.logErrors !== false) {
      console.error('[dbStore] saveBatchHealthSummary failed:', errMsg(err));
    }
    throw new Error(`Failed to save batch health summary ${summary.jobId}: ${errMsg(err)}`);
  }
}

async function ensureProjectedCitationExists(
  tx: DbTransaction,
  input: {
    citationId: string;
    jobId: string;
  },
): Promise<void> {
  const existingRows = await tx
    .select({ id: citationsTable.id })
    .from(citationsTable)
    .where(eq(citationsTable.id, input.citationId))
    .limit(1);
  if (existingRows[0]) {
    return;
  }

  const jobRows = await tx
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, input.jobId))
    .limit(1);
  const jobRow = jobRows[0];
  if (!jobRow) {
    throw new Error(
      `Cannot create citation projection for version ${input.citationId}: job ${input.jobId} is missing.`,
    );
  }

  const job = rowToJob(jobRow);
  const citation = job.result?.references.find((entry) => entry.id === input.citationId);
  if (!citation) {
    throw new Error(
      `Cannot create citation projection for version ${input.citationId}: citation is missing from job ${input.jobId}.`,
    );
  }

  const row = citationToProjectionRow(job, citation);
  const { id: _id, ...updates } = row;
  await tx.insert(citationsTable).values(row).onConflictDoUpdate({
    target: citationsTable.id,
    set: updates,
  });
}

export async function getBatchHealthSummary(
  jobId: string,
): Promise<StoredBatchHealthSummary | undefined> {
  try {
    const rows = await db
      .select()
      .from(batchHealthSummariesTable)
      .where(eq(batchHealthSummariesTable.jobId, jobId))
      .limit(1);
    return rows[0] ? rowToBatchHealthSummary(rows[0]) : undefined;
  } catch (err) {
    console.error('[dbStore] getBatchHealthSummary failed:', errMsg(err));
    throw new Error(`Failed to get batch health summary ${jobId}: ${errMsg(err)}`);
  }
}

export async function listBatchHealthSummaries(): Promise<StoredBatchHealthSummary[]> {
  try {
    const rows = await db
      .select()
      .from(batchHealthSummariesTable)
      .orderBy(desc(batchHealthSummariesTable.latestActionableAt), desc(batchHealthSummariesTable.createdAt));
    return rows.map((row) => rowToBatchHealthSummary(row));
  } catch (err) {
    console.error('[dbStore] listBatchHealthSummaries failed:', errMsg(err));
    throw new Error(`Failed to list batch health summaries: ${errMsg(err)}`);
  }
}

export async function deleteBatchHealthSummary(jobId: string): Promise<boolean> {
  try {
    const deleted = await db
      .delete(batchHealthSummariesTable)
      .where(eq(batchHealthSummariesTable.jobId, jobId))
      .returning({ jobId: batchHealthSummariesTable.jobId });
    return deleted.length > 0;
  } catch (err) {
    console.error('[dbStore] deleteBatchHealthSummary failed:', errMsg(err));
    throw new Error(`Failed to delete batch health summary ${jobId}: ${errMsg(err)}`);
  }
}

function referenceHealthLabel(
  publicStatus: StoredAdminReferenceArchiveItem['publicStatus'],
  openReportTotal: number,
): StoredAdminReferenceArchiveItem['healthLabel'] {
  if (publicStatus === 'needs_action') {
    return 'Action Needed';
  }
  if (publicStatus === 'needs_review' || openReportTotal > 0) {
    return 'Review';
  }
  return 'Ready';
}

function resolveArchiveOwner(row: {
  requestPayload: Record<string, unknown> | null;
  orgName: string | null;
  userName: string | null;
  userEmail: string | null;
  apiKeyName: string | null;
  apiKeyPrefix: string | null;
  jobUserId: string | null;
  jobOrgId: string | null;
  jobApiKeyId: string | null;
}): {
  ownerLabel: string;
  ownerType: StoredAdminReferenceOwnerType;
} {
  const requestOptions = asJsonRecord(row.requestPayload?.options);
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

  if (row.orgName?.trim()) {
    return {
      ownerLabel: row.orgName.trim(),
      ownerType: 'institution',
    };
  }

  if (row.userName?.trim()) {
    return {
      ownerLabel: row.userName.trim(),
      ownerType: 'user',
    };
  }

  if (row.userEmail?.trim()) {
    return {
      ownerLabel: row.userEmail.trim(),
      ownerType: 'user',
    };
  }

  if (row.jobUserId) {
    return {
      ownerLabel: `User ${row.jobUserId.slice(0, 8)}`,
      ownerType: 'user',
    };
  }

  if (row.apiKeyName?.trim()) {
    return {
      ownerLabel: row.apiKeyName.trim(),
      ownerType: 'api_key',
    };
  }

  if (row.apiKeyPrefix?.trim()) {
    return {
      ownerLabel: `API key ${row.apiKeyPrefix.trim()}`,
      ownerType: 'api_key',
    };
  }

  if (row.jobApiKeyId) {
    return {
      ownerLabel: `API key ${row.jobApiKeyId.slice(0, 8)}`,
      ownerType: 'api_key',
    };
  }

  if (row.jobOrgId) {
    return {
      ownerLabel: `Institution ${row.jobOrgId.slice(0, 8)}`,
      ownerType: 'institution',
    };
  }

  return {
    ownerLabel: 'Guest / Unknown',
    ownerType: 'guest',
  };
}

function matchesReferenceArchiveFilters(
  row: StoredAdminReferenceArchiveItem,
  filters: StoredAdminReferenceArchiveFilters,
): boolean {
  if (filters.healthLabel && row.healthLabel !== filters.healthLabel) {
    return false;
  }
  if (filters.storageStatus && row.storageStatus !== filters.storageStatus) {
    return false;
  }
  if (filters.ownerType && row.ownerType !== filters.ownerType) {
    return false;
  }

  const ownerQuery = filters.ownerQuery?.trim().toLowerCase();
  if (ownerQuery && !row.ownerLabel.toLowerCase().includes(ownerQuery)) {
    return false;
  }

  const jobQuery = filters.jobQuery?.trim().toLowerCase();
  if (jobQuery && !row.jobId.toLowerCase().includes(jobQuery)) {
    return false;
  }

  return true;
}

function normalizeArchiveStorageStatus(
  value: string | null | undefined,
): StoredAdminReferenceArchiveItem['storageStatus'] {
  if (value === 'duplicate' || value === 'failed') {
    return value;
  }
  return 'active';
}

export async function listAdminReferenceArchive(
  filters: StoredAdminReferenceArchiveFilters,
): Promise<StoredAdminReferenceArchiveResult> {
  try {
    const hasArchivePostFilters = Boolean(
      filters.healthLabel
      || filters.ownerType
      || filters.ownerQuery?.trim()
      || filters.jobQuery?.trim()
      || filters.storageStatus,
    );

    if (!hasArchivePostFilters) {
      const [{ total: totalRaw } = { total: 0 }] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(citationsTable);
      const citationRows = await db
        .select({
          citationId: citationsTable.id,
          jobId: citationsTable.jobId,
          referenceIndex: citationsTable.referenceIndex,
          rawText: citationsTable.rawText,
          referenceType: citationsTable.referenceType,
          detectedStyle: citationsTable.detectedStyle,
          outputStyle: citationsTable.outputStyle,
          publicStatus: citationsTable.publicStatus,
          storageStatus: citationsTable.status,
          renderedText: citationsTable.renderedText,
          citationCreatedAt: citationsTable.createdAt,
          citationUpdatedAt: citationsTable.updatedAt,
          jobCreatedAt: jobsTable.createdAt,
          requestPayload: jobsTable.options,
          jobUserId: jobsTable.userId,
          jobOrgId: jobsTable.orgId,
          jobApiKeyId: jobsTable.apiKeyId,
          userName: usersTable.name,
          userEmail: usersTable.email,
          orgName: organizationsTable.name,
          apiKeyName: apiKeysTable.name,
          apiKeyPrefix: apiKeysTable.keyPrefix,
        })
        .from(citationsTable)
        .leftJoin(jobsTable, eq(citationsTable.jobId, jobsTable.id))
        .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
        .leftJoin(organizationsTable, eq(jobsTable.orgId, organizationsTable.id))
        .leftJoin(apiKeysTable, eq(jobsTable.apiKeyId, apiKeysTable.id))
        .orderBy(desc(citationsTable.createdAt), desc(citationsTable.referenceIndex))
        .limit(filters.limit)
        .offset(filters.offset);

      const citationIds = citationRows.map((row) => row.citationId);
      const openReportCounts = new Map<
        string,
        {
          pending: number;
          proposed: number;
          total: number;
          latestUpdatedAt: string | null;
        }
      >();

      if (citationIds.length > 0) {
        const openReportRows = await db
          .select({
            citationId: citationReportsTable.citationId,
            pendingCount:
              sql<number>`SUM(CASE WHEN ${citationReportsTable.status} = 'pending' THEN 1 ELSE 0 END)`,
            proposedCount:
              sql<number>`SUM(CASE WHEN ${citationReportsTable.status} = 'proposed' THEN 1 ELSE 0 END)`,
            latestUpdatedAt: sql<Date | null>`MAX(${citationReportsTable.updatedAt})`,
          })
          .from(citationReportsTable)
          .where(
            and(
              inArray(citationReportsTable.citationId, citationIds),
              sql`${citationReportsTable.status} IN ('pending', 'proposed')`,
            ),
          )
          .groupBy(citationReportsTable.citationId);

        for (const row of openReportRows) {
          if (!row.citationId) {
            continue;
          }
          const pending = Number(row.pendingCount ?? 0);
          const proposed = Number(row.proposedCount ?? 0);
          openReportCounts.set(row.citationId, {
            pending,
            proposed,
            total: pending + proposed,
            latestUpdatedAt: toIsoTimestamp(row.latestUpdatedAt),
          });
        }
      }

      return {
        references: citationRows.map<StoredAdminReferenceArchiveItem>((row) => {
          const owner = resolveArchiveOwner({
            requestPayload: asJsonRecord(row.requestPayload),
            orgName: row.orgName ?? null,
            userName: row.userName ?? null,
            userEmail: row.userEmail ?? null,
            apiKeyName: row.apiKeyName ?? null,
            apiKeyPrefix: row.apiKeyPrefix ?? null,
            jobUserId: row.jobUserId ?? null,
            jobOrgId: row.jobOrgId ?? null,
            jobApiKeyId: row.jobApiKeyId ?? null,
          });
          const createdAt =
            row.citationCreatedAt?.toISOString() ??
            row.jobCreatedAt?.toISOString() ??
            new Date().toISOString();
          const updatedAt = row.citationUpdatedAt?.toISOString() ?? createdAt;
          const reports = openReportCounts.get(row.citationId) ?? {
            pending: 0,
            proposed: 0,
            total: 0,
            latestUpdatedAt: null,
          };
          const latestActivityAt =
            reports.latestUpdatedAt &&
            new Date(reports.latestUpdatedAt).getTime() > new Date(updatedAt).getTime()
              ? reports.latestUpdatedAt
              : updatedAt;

          return {
            citationId: row.citationId,
            jobId: row.jobId ?? '',
            referenceIndex: row.referenceIndex,
            ownerLabel: owner.ownerLabel,
            ownerType: owner.ownerType,
            outputStyle: row.outputStyle ?? null,
            detectedStyle: row.detectedStyle ?? null,
            referenceType: row.referenceType ?? null,
            publicStatus: (row.publicStatus ?? 'needs_review') as StoredAdminReferenceArchiveItem['publicStatus'],
            storageStatus: normalizeArchiveStorageStatus(row.storageStatus),
            healthLabel: referenceHealthLabel(
              (row.publicStatus ?? 'needs_review') as StoredAdminReferenceArchiveItem['publicStatus'],
              reports.total,
            ),
            rawText: row.rawText,
            renderedText: row.renderedText ?? null,
            batchCreatedAt: row.jobCreatedAt?.toISOString() ?? createdAt,
            createdAt,
            updatedAt,
            latestActivityAt,
            openReportCounts: {
              pending: reports.pending,
              proposed: reports.proposed,
              total: reports.total,
            },
          };
        }),
        total: Number(totalRaw ?? 0),
      };
    }

    const citationRows = await db
      .select({
        citationId: citationsTable.id,
        jobId: citationsTable.jobId,
        referenceIndex: citationsTable.referenceIndex,
        rawText: citationsTable.rawText,
        referenceType: citationsTable.referenceType,
        detectedStyle: citationsTable.detectedStyle,
        outputStyle: citationsTable.outputStyle,
        publicStatus: citationsTable.publicStatus,
        storageStatus: citationsTable.status,
        renderedText: citationsTable.renderedText,
        citationCreatedAt: citationsTable.createdAt,
        citationUpdatedAt: citationsTable.updatedAt,
        jobCreatedAt: jobsTable.createdAt,
        requestPayload: jobsTable.options,
        jobUserId: jobsTable.userId,
        jobOrgId: jobsTable.orgId,
        jobApiKeyId: jobsTable.apiKeyId,
        userName: usersTable.name,
        userEmail: usersTable.email,
        orgName: organizationsTable.name,
        apiKeyName: apiKeysTable.name,
        apiKeyPrefix: apiKeysTable.keyPrefix,
      })
      .from(citationsTable)
      .leftJoin(jobsTable, eq(citationsTable.jobId, jobsTable.id))
      .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
      .leftJoin(organizationsTable, eq(jobsTable.orgId, organizationsTable.id))
      .leftJoin(apiKeysTable, eq(jobsTable.apiKeyId, apiKeysTable.id))
      .orderBy(desc(citationsTable.createdAt), desc(citationsTable.referenceIndex));

    const citationIds = citationRows.map((row) => row.citationId);
    const openReportCounts = new Map<
      string,
      {
        pending: number;
        proposed: number;
        total: number;
        latestUpdatedAt: string | null;
      }
    >();

    if (citationIds.length > 0) {
      const openReportRows = await db
        .select({
          citationId: citationReportsTable.citationId,
          pendingCount:
            sql<number>`SUM(CASE WHEN ${citationReportsTable.status} = 'pending' THEN 1 ELSE 0 END)`,
          proposedCount:
            sql<number>`SUM(CASE WHEN ${citationReportsTable.status} = 'proposed' THEN 1 ELSE 0 END)`,
          latestUpdatedAt: sql<Date | null>`MAX(${citationReportsTable.updatedAt})`,
        })
        .from(citationReportsTable)
        .where(
          and(
            inArray(citationReportsTable.citationId, citationIds),
            sql`${citationReportsTable.status} IN ('pending', 'proposed')`,
          ),
        )
        .groupBy(citationReportsTable.citationId);

      for (const row of openReportRows) {
        if (!row.citationId) {
          continue;
        }
        const pending = Number(row.pendingCount ?? 0);
        const proposed = Number(row.proposedCount ?? 0);
        openReportCounts.set(row.citationId, {
          pending,
          proposed,
          total: pending + proposed,
          latestUpdatedAt: toIsoTimestamp(row.latestUpdatedAt),
        });
      }
    }

    const references = citationRows
      .map<StoredAdminReferenceArchiveItem>((row) => {
        const owner = resolveArchiveOwner({
          requestPayload: asJsonRecord(row.requestPayload),
          orgName: row.orgName ?? null,
          userName: row.userName ?? null,
          userEmail: row.userEmail ?? null,
          apiKeyName: row.apiKeyName ?? null,
          apiKeyPrefix: row.apiKeyPrefix ?? null,
          jobUserId: row.jobUserId ?? null,
          jobOrgId: row.jobOrgId ?? null,
          jobApiKeyId: row.jobApiKeyId ?? null,
        });
        const createdAt =
          row.citationCreatedAt?.toISOString() ??
          row.jobCreatedAt?.toISOString() ??
          new Date().toISOString();
        const updatedAt = row.citationUpdatedAt?.toISOString() ?? createdAt;
        const reports = openReportCounts.get(row.citationId) ?? {
          pending: 0,
          proposed: 0,
          total: 0,
          latestUpdatedAt: null,
        };
        const latestActivityAt =
          reports.latestUpdatedAt &&
          new Date(reports.latestUpdatedAt).getTime() > new Date(updatedAt).getTime()
            ? reports.latestUpdatedAt
            : updatedAt;

        return {
          citationId: row.citationId,
          jobId: row.jobId ?? '',
          referenceIndex: row.referenceIndex,
          ownerLabel: owner.ownerLabel,
          ownerType: owner.ownerType,
          outputStyle: row.outputStyle ?? null,
          detectedStyle: row.detectedStyle ?? null,
          referenceType: row.referenceType ?? null,
          publicStatus: (row.publicStatus ?? 'needs_review') as StoredAdminReferenceArchiveItem['publicStatus'],
          storageStatus: normalizeArchiveStorageStatus(row.storageStatus),
          healthLabel: referenceHealthLabel(
            (row.publicStatus ?? 'needs_review') as StoredAdminReferenceArchiveItem['publicStatus'],
            reports.total,
          ),
          rawText: row.rawText,
          renderedText: row.renderedText ?? null,
          batchCreatedAt: row.jobCreatedAt?.toISOString() ?? createdAt,
          createdAt,
          updatedAt,
          latestActivityAt,
          openReportCounts: {
            pending: reports.pending,
            proposed: reports.proposed,
            total: reports.total,
          },
        };
      })
      .filter((row) => matchesReferenceArchiveFilters(row, filters))
      .sort((left, right) => {
        const latestDifference =
          new Date(right.latestActivityAt).getTime() - new Date(left.latestActivityAt).getTime();
        if (latestDifference !== 0) {
          return latestDifference;
        }
        const createdDifference =
          new Date(right.batchCreatedAt).getTime() - new Date(left.batchCreatedAt).getTime();
        if (createdDifference !== 0) {
          return createdDifference;
        }
        return left.referenceIndex - right.referenceIndex;
      });

    return {
      references: references.slice(filters.offset, filters.offset + filters.limit),
      total: references.length,
    };
  } catch (err) {
    console.error('[dbStore] listAdminReferenceArchive failed:', errMsg(err));
    throw new Error(`Failed to list admin reference archive: ${errMsg(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  API Keys                                                           */
/*                                                                     */
/*  Raw keys are stored as SHA-256 hashes and cannot be retrieved.     */
/* ------------------------------------------------------------------ */

function normalizeAccountTier(value: unknown): 'free' | 'pro' | 'b2b' {
  if (value === 'pro' || value === 'b2b') {
    return value;
  }
  return 'free';
}

export async function getUserTier(userId: string): Promise<'free' | 'pro' | 'b2b' | null> {
  try {
    const [row] = await db
      .select({ tier: usersTable.tier })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!row) {
      return null;
    }
    return normalizeAccountTier(row.tier);
  } catch (err) {
    console.error('[dbStore] getUserTier failed:', errMsg(err));
    throw new Error(`Failed to load user tier for ${userId}: ${errMsg(err)}`);
  }
}

export async function saveApiKey(apiKey: StoredApiKey): Promise<void> {
  try {
    if (!apiKey.userId?.trim()) {
      throw new Error('saveApiKey requires a non-empty owner userId.');
    }
    const keyHash = createHash('sha256').update(apiKey.rawKey).digest('hex');

    await db.insert(apiKeysTable).values({
      id: apiKey.id,
      userId: apiKey.userId,
      keyHash,
      keyPrefix: apiKey.prefix,
      name: apiKey.name,
      tier: apiKey.tier,
      createdAt: new Date(apiKey.createdAt),
    });
  } catch (err) {
    console.error('[dbStore] saveApiKey failed:', errMsg(err));
    throw new Error(`Failed to save API key ${apiKey.id}: ${errMsg(err)}`);
  }
}

export async function getApiKey(
  id: string,
): Promise<StoredApiKey | undefined> {
  try {
    const rows = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, id))
      .limit(1);
    if (!rows[0]) return undefined;

    const r = rows[0];
    return {
      id: r.id,
      userId: r.userId,
      name: r.name ?? '',
      prefix: r.keyPrefix,
      tier: (r.tier ?? 'free') as StoredApiKey['tier'],
      rawKey: '',
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  } catch (err) {
    console.error('[dbStore] getApiKey failed:', errMsg(err));
    throw new Error(`Failed to get API key ${id}: ${errMsg(err)}`);
  }
}

export async function listApiKeys(userId?: string): Promise<StoredApiKey[]> {
  try {
    const rows = userId
      ? await db
          .select()
          .from(apiKeysTable)
          .where(eq(apiKeysTable.userId, userId))
          .orderBy(desc(apiKeysTable.createdAt))
      : await db
          .select()
          .from(apiKeysTable)
          .orderBy(desc(apiKeysTable.createdAt));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.name ?? '',
      prefix: r.keyPrefix,
      tier: (r.tier ?? 'free') as StoredApiKey['tier'],
      rawKey: '',
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.error('[dbStore] listApiKeys failed:', errMsg(err));
    throw new Error(`Failed to list API keys: ${errMsg(err)}`);
  }
}

export async function deleteApiKey(id: string, userId?: string): Promise<boolean> {
  try {
    const filters = userId
      ? and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, userId))
      : eq(apiKeysTable.id, id);
    const deleted = await db
      .delete(apiKeysTable)
      .where(filters)
      .returning({ id: apiKeysTable.id });
    return deleted.length > 0;
  } catch (err) {
    console.error('[dbStore] deleteApiKey failed:', errMsg(err));
    throw new Error(`Failed to delete API key ${id}: ${errMsg(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Citation Versions                                                  */
/* ------------------------------------------------------------------ */

export async function saveCitationVersion(
  version: StoredCitationVersion,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await ensureProjectedCitationExists(tx, {
        citationId: version.citationId,
        jobId: version.jobId,
      });
      await tx.insert(citationVersionsTable).values({
        id: version.id,
        citationId: version.citationId,
        versionNum: version.versionNumber,
        fields: version.fields as unknown as Record<string, unknown>,
        changeSource: version.source,
        changedAt: new Date(version.createdAt),
      });
    });
  } catch (err) {
    console.error('[dbStore] saveCitationVersion failed:', errMsg(err));
    throw new Error(
      `Failed to save citation version ${version.id}: ${errMsg(err)}`,
    );
  }
}

export async function appendCitationVersion(
  input: Omit<StoredCitationVersion, 'versionNumber'>,
): Promise<StoredCitationVersion> {
  try {
    return await db.transaction(async (tx) => {
      await ensureProjectedCitationExists(tx, {
        citationId: input.citationId,
        jobId: input.jobId,
      });
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.citationId}, 0))`,
      );

      const rows = await tx
        .select({
          maxVersion: sql<number>`coalesce(max(${citationVersionsTable.versionNum}), 0)`.as('maxVersion'),
        })
        .from(citationVersionsTable)
        .where(eq(citationVersionsTable.citationId, input.citationId))
        .limit(1);

      const currentMax = Number(rows[0]?.maxVersion ?? 0);
      const nextVersionNumber = Number.isFinite(currentMax) ? currentMax + 1 : 1;
      const nextVersion: StoredCitationVersion = {
        ...input,
        versionNumber: nextVersionNumber,
      };

      await tx.insert(citationVersionsTable).values({
        id: nextVersion.id,
        citationId: nextVersion.citationId,
        versionNum: nextVersion.versionNumber,
        fields: nextVersion.fields as unknown as Record<string, unknown>,
        changeSource: nextVersion.source,
        changedAt: new Date(nextVersion.createdAt),
      });

      return nextVersion;
    });
  } catch (err) {
    console.error('[dbStore] appendCitationVersion failed:', errMsg(err));
    throw new Error(
      `Failed to append citation version ${input.id}: ${errMsg(err)}`,
    );
  }
}

export async function listCitationVersions(
  citationId: string,
): Promise<StoredCitationVersion[]> {
  try {
    const rows = await db
      .select({
        version: citationVersionsTable,
        jobId: citationsTable.jobId,
      })
      .from(citationVersionsTable)
      .leftJoin(
        citationsTable,
        eq(citationVersionsTable.citationId, citationsTable.id),
      )
      .where(eq(citationVersionsTable.citationId, citationId))
      .orderBy(citationVersionsTable.versionNum);

    return rows.map(({ version: r, jobId }) => ({
      id: r.id,
      citationId: r.citationId ?? '',
      jobId: jobId ?? '',
      versionNumber: r.versionNum,
      fields: r.fields as ProcessedCitation['fields'],
      source: r.changeSource ?? '',
      createdAt: r.changedAt?.toISOString() ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.error('[dbStore] listCitationVersions failed:', errMsg(err));
    throw new Error(
      `Failed to list citation versions for ${citationId}: ${errMsg(err)}`,
    );
  }
}

export async function saveCitationExtractionHistory(
  entry: StoredCitationExtractionHistory,
): Promise<void> {
  try {
    await db.insert(citationExtractionHistoryTable).values(citationExtractionHistoryToRow(entry));
  } catch (err) {
    console.error('[dbStore] saveCitationExtractionHistory failed:', errMsg(err));
    throw new Error(
      `Failed to save citation extraction history ${entry.id}: ${errMsg(err)}`,
    );
  }
}

export async function saveCitationExtractionHistoryBatch(
  entries: StoredCitationExtractionHistory[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db
      .insert(citationExtractionHistoryTable)
      .values(entries.map(citationExtractionHistoryToRow));
  } catch (err) {
    console.error('[dbStore] saveCitationExtractionHistoryBatch failed:', errMsg(err));
    throw new Error(
      `Failed to save ${entries.length} citation extraction history record(s): ${errMsg(err)}`,
    );
  }
}

function citationExtractionHistoryToRow(entry: StoredCitationExtractionHistory) {
  return {
    id: entry.id,
    citationId: entry.citationId,
    jobId: entry.jobId ?? null,
    runMode: entry.runMode,
    modelVersion: entry.modelVersion,
    featureVersion: entry.featureVersion,
    styleUsed: entry.styleUsed,
    overallConfidence: entry.overallConfidence,
    fieldConfidences: entry.fieldConfidences as Record<string, unknown>,
    uncertainFields: entry.uncertainFields,
    entities: entry.entities as unknown as Record<string, unknown>[] | null,
    bio: entry.bio as unknown as Record<string, unknown> | null,
    shadowDiff: entry.shadowDiff as unknown as Record<string, unknown> | null,
    mlError: entry.mlError as unknown as Record<string, unknown> | null,
    createdAt: new Date(entry.timestamp),
  };
}

export async function listCitationExtractionHistory(
  citationId: string,
): Promise<StoredCitationExtractionHistory[]> {
  try {
    const rows = await db
      .select()
      .from(citationExtractionHistoryTable)
      .where(eq(citationExtractionHistoryTable.citationId, citationId))
      .orderBy(citationExtractionHistoryTable.createdAt);

    return rows.map((row) => {
      const entry: StoredCitationExtractionHistory = {
        id: row.id,
        citationId: row.citationId,
        modelVersion: row.modelVersion,
        featureVersion: row.featureVersion,
        styleUsed: row.styleUsed,
        overallConfidence: row.overallConfidence,
        fieldConfidences: (row.fieldConfidences ?? {}) as Record<string, number>,
        uncertainFields: (row.uncertainFields ?? []) as StoredCitationExtractionHistory['uncertainFields'],
        runMode: row.runMode as StoredCitationExtractionHistory['runMode'],
        timestamp: row.createdAt?.toISOString() ?? new Date().toISOString(),
      };

      if (row.jobId) {
        entry.jobId = row.jobId;
      }
      if (row.entities) {
        entry.entities = row.entities as NonNullable<StoredCitationExtractionHistory['entities']>;
      }
      if (row.bio) {
        entry.bio = row.bio as NonNullable<StoredCitationExtractionHistory['bio']>;
      }
      if (row.shadowDiff) {
        entry.shadowDiff = row.shadowDiff as NonNullable<StoredCitationExtractionHistory['shadowDiff']>;
      }
      if (row.mlError) {
        entry.mlError = row.mlError as NonNullable<StoredCitationExtractionHistory['mlError']>;
      }

      return entry;
    });
  } catch (err) {
    console.error('[dbStore] listCitationExtractionHistory failed:', errMsg(err));
    throw new Error(
      `Failed to list citation extraction history for ${citationId}: ${errMsg(err)}`,
    );
  }
}

export async function listShadowExtractionHistory(): Promise<StoredCitationExtractionHistory[]> {
  try {
    const rows = await db
      .select()
      .from(citationExtractionHistoryTable)
      .where(eq(citationExtractionHistoryTable.runMode, 'shadow'))
      .orderBy(citationExtractionHistoryTable.createdAt);

    return rows
      .map((row) => {
        const entry: StoredCitationExtractionHistory = {
          id: row.id,
          citationId: row.citationId,
          modelVersion: row.modelVersion,
          featureVersion: row.featureVersion,
          styleUsed: row.styleUsed,
          overallConfidence: row.overallConfidence,
          fieldConfidences: (row.fieldConfidences ?? {}) as Record<string, number>,
          uncertainFields: (row.uncertainFields ?? []) as StoredCitationExtractionHistory['uncertainFields'],
          runMode: row.runMode as StoredCitationExtractionHistory['runMode'],
          timestamp: row.createdAt?.toISOString() ?? new Date().toISOString(),
        };

        if (row.jobId) {
          entry.jobId = row.jobId;
        }
        if (row.entities) {
          entry.entities = row.entities as NonNullable<StoredCitationExtractionHistory['entities']>;
        }
        if (row.bio) {
          entry.bio = row.bio as NonNullable<StoredCitationExtractionHistory['bio']>;
        }
        if (row.shadowDiff) {
          entry.shadowDiff = row.shadowDiff as NonNullable<StoredCitationExtractionHistory['shadowDiff']>;
        }
        if (row.mlError) {
          entry.mlError = row.mlError as NonNullable<StoredCitationExtractionHistory['mlError']>;
        }

        return entry;
      })
      .filter((entry) => entry.shadowDiff);
  } catch (err) {
    console.error('[dbStore] listShadowExtractionHistory failed:', errMsg(err));
    throw new Error(`Failed to list shadow extraction history: ${errMsg(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Usage                                                              */
/*                                                                     */
/*  The in-memory store tracks global usage (no per-user breakdown).   */
/*  In the DB we represent this as rows with NULL userId.  A real      */
/*  production deployment would pass userId through the call-site.     */
/* ------------------------------------------------------------------ */

export function currentUsageDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function getUsageForDay(
  dayKey = currentUsageDayKey(),
  scope?: UsageScope,
): Promise<number> {
  try {
    const resolvedScope = resolveUsageScope(scope);
    const rows = await db
      .select({
        total: sql<number>`COALESCE(SUM(${usageTable.refCount}), 0)`,
      })
      .from(usageTable)
      .where(and(
        eq(usageTable.period, dayKey),
        eq(usageTable.scopeType, resolvedScope.scopeType),
        eq(usageTable.scopeKey, resolvedScope.scopeKey),
      ));

    return Number(rows[0]?.total ?? 0);
  } catch (err) {
    console.error('[dbStore] getUsageForDay failed:', errMsg(err));
    throw new Error(`Failed to get usage for ${dayKey}: ${errMsg(err)}`);
  }
}

export async function consumeUsage(
  refCount: number,
  dayKey = currentUsageDayKey(),
  scope?: UsageScope,
): Promise<number> {
  try {
    const resolvedScope = resolveUsageScope(scope);
    const rows = await db
      .insert(usageTable)
      .values({
        period: dayKey,
        scopeType: resolvedScope.scopeType,
        scopeKey: resolvedScope.scopeKey,
        refCount,
        ...(resolvedScope.userId ? { userId: resolvedScope.userId } : {}),
        ...(resolvedScope.orgId ? { orgId: resolvedScope.orgId } : {}),
        ...(resolvedScope.apiKeyId ? { apiKeyId: resolvedScope.apiKeyId } : {}),
      })
      .onConflictDoUpdate({
        target: [usageTable.period, usageTable.scopeType, usageTable.scopeKey],
        set: {
          refCount: sql`${usageTable.refCount} + ${refCount}`,
          jobCount: sql`${usageTable.jobCount}`,
        },
      })
      .returning({
        refCount: usageTable.refCount,
      });

    return Number(rows[0]?.refCount ?? refCount);
  } catch (err) {
    console.error('[dbStore] consumeUsage failed:', errMsg(err));
    throw new Error(`Failed to consume usage: ${errMsg(err)}`);
  }
}

export async function resetUsage(
  dayKey = currentUsageDayKey(),
  scope?: UsageScope,
): Promise<void> {
  try {
    const resolvedScope = resolveUsageScope(scope);
    await db
      .delete(usageTable)
      .where(and(
        eq(usageTable.period, dayKey),
        eq(usageTable.scopeType, resolvedScope.scopeType),
        eq(usageTable.scopeKey, resolvedScope.scopeKey),
      ));
  } catch (err) {
    console.error('[dbStore] resetUsage failed:', errMsg(err));
    throw new Error(`Failed to reset usage for ${dayKey}: ${errMsg(err)}`);
  }
}

export async function getEnrichmentUsageForDay(
  dayKey = currentUsageDayKey(),
  scope?: UsageScope,
): Promise<number> {
  try {
    const resolvedScope = resolveUsageScope(scope);
    const rows = await db
      .select({ total: sql<number>`COALESCE(SUM(${usageTable.enrichCount}), 0)` })
      .from(usageTable)
      .where(and(
        eq(usageTable.period, dayKey),
        eq(usageTable.scopeType, resolvedScope.scopeType),
        eq(usageTable.scopeKey, resolvedScope.scopeKey),
      ));
    return Number(rows[0]?.total ?? 0);
  } catch (err) {
    console.error('[dbStore] getEnrichmentUsageForDay failed:', errMsg(err));
    throw new Error(`Failed to get enrichment usage for ${dayKey}: ${errMsg(err)}`);
  }
}

export async function consumeEnrichmentUsage(
  amount = 1,
  dayKey = currentUsageDayKey(),
  scope?: UsageScope,
): Promise<number> {
  try {
    const resolvedScope = resolveUsageScope(scope);
    const rows = await db
      .insert(usageTable)
      .values({
        period: dayKey,
        scopeType: resolvedScope.scopeType,
        scopeKey: resolvedScope.scopeKey,
        enrichCount: amount,
        ...(resolvedScope.userId ? { userId: resolvedScope.userId } : {}),
        ...(resolvedScope.orgId ? { orgId: resolvedScope.orgId } : {}),
        ...(resolvedScope.apiKeyId ? { apiKeyId: resolvedScope.apiKeyId } : {}),
      })
      .onConflictDoUpdate({
        target: [usageTable.period, usageTable.scopeType, usageTable.scopeKey],
        set: { enrichCount: sql`${usageTable.enrichCount} + ${amount}` },
      })
      .returning({ enrichCount: usageTable.enrichCount });
    return Number(rows[0]?.enrichCount ?? amount);
  } catch (err) {
    console.error('[dbStore] consumeEnrichmentUsage failed:', errMsg(err));
    throw new Error(`Failed to consume enrichment usage: ${errMsg(err)}`);
  }
}

function resolveUsageScope(scope?: UsageScope): {
  scopeType: 'global' | 'org' | 'user' | 'api_key';
  scopeKey: string;
  userId?: string;
  orgId?: string;
  apiKeyId?: string;
} {
  if (scope?.orgId) {
    return {
      scopeType: 'org',
      scopeKey: scope.orgId,
      orgId: scope.orgId,
    };
  }
  if (scope?.userId) {
    return {
      scopeType: 'user',
      scopeKey: scope.userId,
      userId: scope.userId,
    };
  }
  if (scope?.apiKeyId) {
    return {
      scopeType: 'api_key',
      scopeKey: scope.apiKeyId,
      apiKeyId: scope.apiKeyId,
    };
  }

  return {
    scopeType: 'global',
    scopeKey: 'global',
  };
}

/* ------------------------------------------------------------------ */
/*  Learning Queue                                                     */
/* ------------------------------------------------------------------ */

export async function saveLearningQueueItem(
  item: LearningQueueItem,
): Promise<void> {
  try {
    await db.insert(activeLearningQueueTable).values({
      id: item.id,
      citationId: item.citationId || null,
      source: item.source,
      priority: item.priority,
      trainingData: item.trainingData as Record<string, unknown>,
      processed: item.processed,
      promotedToTruthId: item.promotedToTruthId ?? null,
      createdAt: new Date(item.createdAt),
    });
  } catch (err) {
    console.error('[dbStore] saveLearningQueueItem failed:', errMsg(err));
    throw new Error(
      `Failed to save learning queue item ${item.id}: ${errMsg(err)}`,
    );
  }
}

export async function listLearningQueue(): Promise<LearningQueueItem[]> {
  try {
    const rows = await db
      .select({
        item: activeLearningQueueTable,
        jobId: citationsTable.jobId,
      })
      .from(activeLearningQueueTable)
      .leftJoin(
        citationsTable,
        eq(activeLearningQueueTable.citationId, citationsTable.id),
      )
      .orderBy(desc(activeLearningQueueTable.priority));

    return groupLearningQueueItems(rows.map(({ item: r, jobId }) => ({
      id: r.id,
      citationId: r.citationId ?? '',
      jobId: jobId ?? '',
      source: (r.source ?? 'user_edit') as LearningQueueItem['source'],
      priority: r.priority ?? 0,
      trainingData: (r.trainingData ?? {}) as Record<string, unknown>,
      processed: r.processed ?? false,
      processedAt: r.processedAt?.toISOString() ?? null,
      promotedToTruthId: r.promotedToTruthId ?? null,
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    })));
  } catch (err) {
    console.error('[dbStore] listLearningQueue failed:', errMsg(err));
    throw new Error(`Failed to list learning queue: ${errMsg(err)}`);
  }
}

export async function markLearningQueueItemsProcessed(
  ids: readonly string[],
  promotedToTruthId?: string | null,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  try {
    await db
      .update(activeLearningQueueTable)
      .set({
        processed: true,
        processedAt: new Date(),
        promotedToTruthId: promotedToTruthId ?? null,
      })
      .where(inArray(activeLearningQueueTable.id, [...ids]));
    return ids.length;
  } catch (err) {
    console.error('[dbStore] markLearningQueueItemsProcessed failed:', errMsg(err));
    throw new Error(`Failed to update learning queue items: ${errMsg(err)}`);
  }
}

export async function markLearningQueueItemsUnprocessed(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  try {
    await db
      .update(activeLearningQueueTable)
      .set({
        processed: false,
        processedAt: null,
        promotedToTruthId: null,
      })
      .where(inArray(activeLearningQueueTable.id, [...ids]));
    return ids.length;
  } catch (err) {
    console.error('[dbStore] markLearningQueueItemsUnprocessed failed:', errMsg(err));
    throw new Error(`Failed to revert learning queue items: ${errMsg(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Reset (testing / seeding)                                          */
/* ------------------------------------------------------------------ */

export async function resetRuntimeStore(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE
        active_learning_queue,
        citation_extraction_history,
        citation_versions,
        user_corrections,
        citation_reports,
        batch_health_summaries,
        usage,
        api_keys,
        egress_rollups_daily,
        egress_rollups_monthly,
        egress_requests,
        jobs,
        approved_truth_editor_drafts,
        approved_truth
      CASCADE`,
  );
}

/* ------------------------------------------------------------------ */
/*  Egress telemetry                                                   */
/* ------------------------------------------------------------------ */

export async function recordEgressEvent(event: StoredEgressEvent): Promise<void> {
  await db.insert(egressRequestsTable).values({
    id: event.id,
    correlationId: event.correlationId,
    provider: event.provider,
    route: event.route,
    method: event.method,
    status: event.status,
    requestBodyBytes: event.requestBodyBytes,
    responseBodyBytes: event.responseBodyBytes,
    latencyMs: event.latencyMs,
    cacheHit: event.cacheHit,
    createdAt: new Date(event.createdAt),
  });
}

export async function rollupEgressDaily(delta: StoredEgressRollup): Promise<void> {
  await db
    .insert(egressRollupsDailyTable)
    .values({
      period: delta.period,
      provider: delta.provider,
      route: delta.route,
      calls: delta.calls,
      cacheHits: delta.cacheHits,
      requestBodyBytes: delta.requestBodyBytes,
      responseBodyBytes: delta.responseBodyBytes,
    })
    .onConflictDoUpdate({
      target: [
        egressRollupsDailyTable.period,
        egressRollupsDailyTable.provider,
        egressRollupsDailyTable.route,
      ],
      set: {
        calls: sql`${egressRollupsDailyTable.calls} + ${delta.calls}`,
        cacheHits: sql`${egressRollupsDailyTable.cacheHits} + ${delta.cacheHits}`,
        requestBodyBytes: sql`${egressRollupsDailyTable.requestBodyBytes} + ${delta.requestBodyBytes}`,
        responseBodyBytes: sql`${egressRollupsDailyTable.responseBodyBytes} + ${delta.responseBodyBytes}`,
      },
    });
}

export async function rollupEgressMonthly(delta: StoredEgressRollup): Promise<void> {
  await db
    .insert(egressRollupsMonthlyTable)
    .values({
      period: delta.period,
      provider: delta.provider,
      route: delta.route,
      calls: delta.calls,
      cacheHits: delta.cacheHits,
      requestBodyBytes: delta.requestBodyBytes,
      responseBodyBytes: delta.responseBodyBytes,
    })
    .onConflictDoUpdate({
      target: [
        egressRollupsMonthlyTable.period,
        egressRollupsMonthlyTable.provider,
        egressRollupsMonthlyTable.route,
      ],
      set: {
        calls: sql`${egressRollupsMonthlyTable.calls} + ${delta.calls}`,
        cacheHits: sql`${egressRollupsMonthlyTable.cacheHits} + ${delta.cacheHits}`,
        requestBodyBytes: sql`${egressRollupsMonthlyTable.requestBodyBytes} + ${delta.requestBodyBytes}`,
        responseBodyBytes: sql`${egressRollupsMonthlyTable.responseBodyBytes} + ${delta.responseBodyBytes}`,
      },
    });
}

export async function listEgressDaily(period: string): Promise<StoredEgressRollup[]> {
  const rows = await db
    .select()
    .from(egressRollupsDailyTable)
    .where(eq(egressRollupsDailyTable.period, period));
  return rows.map((r) => ({
    period: r.period,
    provider: r.provider,
    route: r.route,
    calls: r.calls ?? 0,
    cacheHits: r.cacheHits ?? 0,
    requestBodyBytes: r.requestBodyBytes ?? 0,
    responseBodyBytes: r.responseBodyBytes ?? 0,
  }));
}

export async function listEgressMonthly(period: string): Promise<StoredEgressRollup[]> {
  const rows = await db
    .select()
    .from(egressRollupsMonthlyTable)
    .where(eq(egressRollupsMonthlyTable.period, period));
  return rows.map((r) => ({
    period: r.period,
    provider: r.provider,
    route: r.route,
    calls: r.calls ?? 0,
    cacheHits: r.cacheHits ?? 0,
    requestBodyBytes: r.requestBodyBytes ?? 0,
    responseBodyBytes: r.responseBodyBytes ?? 0,
  }));
}
