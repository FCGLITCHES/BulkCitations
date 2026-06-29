import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '../../db/connection.js';
import { truthBackgroundJobs as truthBackgroundJobsTable } from '../../db/schema.js';

import type { TruthBackgroundJob } from './backgroundJobs.js';

const TRUTH_BACKGROUND_JOB_LEASE_MS = 10 * 60 * 1000;
let truthBackgroundJobsTableEnsured = false;

async function ensureTruthBackgroundJobsTable(): Promise<void> {
  if (truthBackgroundJobsTableEnsured) {
    return;
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS truth_background_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      operation varchar(20) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pending',
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      error text,
      lease_owner varchar(120),
      lease_expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_truth_background_jobs_status_updated
      ON truth_background_jobs (status, updated_at);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_truth_background_jobs_lease_expires
      ON truth_background_jobs (lease_expires_at);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_truth_background_jobs_created
      ON truth_background_jobs (created_at);
  `);

  truthBackgroundJobsTableEnsured = true;
}

function leaseExpiryDate(): Date {
  return new Date(Date.now() + TRUTH_BACKGROUND_JOB_LEASE_MS);
}

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function rowToTruthBackgroundJob(
  row: typeof truthBackgroundJobsTable.$inferSelect,
): TruthBackgroundJob {
  const payload = (row.payload ?? {}) as Partial<TruthBackgroundJob>;
  return {
    id: row.id,
    operation: (payload.operation ?? row.operation) as TruthBackgroundJob['operation'],
    status: (row.status ?? payload.status ?? 'pending') as TruthBackgroundJob['status'],
    filters: (payload.filters ?? {}) as TruthBackgroundJob['filters'],
    certify: (payload.certify ?? null) as TruthBackgroundJob['certify'],
    update: (payload.update ?? null) as TruthBackgroundJob['update'],
    pageSize: payload.pageSize ?? 25,
    totalRows: payload.totalRows ?? 0,
    totalPages: payload.totalPages ?? 0,
    completedRows: payload.completedRows ?? 0,
    completedPages: payload.completedPages ?? 0,
    updatedCount: payload.updatedCount ?? 0,
    unchangedCount: payload.unchangedCount ?? 0,
    deletedCount: payload.deletedCount ?? 0,
    certifiedCount: payload.certifiedCount ?? 0,
    quarantinedCount: payload.quarantinedCount ?? 0,
    skippedCount: payload.skippedCount ?? 0,
    failedCount: payload.failedCount ?? 0,
    results: (payload.results ?? []) as TruthBackgroundJob['results'],
    recentResults: (payload.recentResults ?? []) as TruthBackgroundJob['recentResults'],
    recentCompletedPage: payload.recentCompletedPage ?? null,
    recentCompletedAt: payload.recentCompletedAt ?? null,
    rowIds: (payload.rowIds ?? []) as string[],
    createdAt: payload.createdAt ?? row.createdAt.toISOString(),
    startedAt: payload.startedAt ?? toIsoOrNull(row.startedAt),
    finishedAt: payload.finishedAt ?? toIsoOrNull(row.finishedAt),
    error: row.error ?? payload.error ?? null,
  };
}

function jobToRow(
  job: TruthBackgroundJob,
  existing?: typeof truthBackgroundJobsTable.$inferSelect | null,
) {
  const status = job.status;
  const keepLease = status === 'running';
  return {
    operation: job.operation,
    status,
    payload: job as unknown as Record<string, unknown>,
    error: job.error ?? null,
    leaseOwner: keepLease ? (existing?.leaseOwner ?? null) : null,
    leaseExpiresAt: keepLease ? leaseExpiryDate() : null,
    startedAt: job.startedAt ? new Date(job.startedAt) : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
    updatedAt: new Date(),
  };
}

export async function saveTruthBackgroundDbJob(job: TruthBackgroundJob): Promise<TruthBackgroundJob> {
  await ensureTruthBackgroundJobsTable();
  const row = {
    id: job.id,
    createdAt: new Date(job.createdAt),
    ...jobToRow(job),
  };
  const { id: _id, ...updates } = row;
  const [saved] = await db
    .insert(truthBackgroundJobsTable)
    .values(row)
    .onConflictDoUpdate({
      target: truthBackgroundJobsTable.id,
      set: updates,
    })
    .returning();
  if (!saved) {
    throw new Error(`Failed to persist truth background job ${job.id}.`);
  }
  return rowToTruthBackgroundJob(saved);
}

export async function getTruthBackgroundDbJob(id: string): Promise<TruthBackgroundJob | null> {
  await ensureTruthBackgroundJobsTable();
  const [row] = await db
    .select()
    .from(truthBackgroundJobsTable)
    .where(eq(truthBackgroundJobsTable.id, id))
    .limit(1);
  return row ? rowToTruthBackgroundJob(row) : null;
}

export async function updateTruthBackgroundDbJob(
  id: string,
  updater: (job: TruthBackgroundJob) => void,
): Promise<TruthBackgroundJob | null> {
  await ensureTruthBackgroundJobsTable();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(truthBackgroundJobsTable)
      .where(eq(truthBackgroundJobsTable.id, id))
      .limit(1);
    if (!current) {
      return null;
    }

    const next = rowToTruthBackgroundJob(current);
    updater(next);

    const [saved] = await tx
      .update(truthBackgroundJobsTable)
      .set(jobToRow(next, current))
      .where(eq(truthBackgroundJobsTable.id, id))
      .returning();
    return saved ? rowToTruthBackgroundJob(saved) : null;
  });
}

export async function claimTruthBackgroundDbJob(
  id: string,
  leaseOwner: string,
): Promise<TruthBackgroundJob | null> {
  await ensureTruthBackgroundJobsTable();
  const [claimed] = await db
    .update(truthBackgroundJobsTable)
    .set({
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date(),
      leaseOwner,
      leaseExpiresAt: leaseExpiryDate(),
    })
    .where(
      and(
        eq(truthBackgroundJobsTable.id, id),
        or(
          eq(truthBackgroundJobsTable.status, 'pending'),
          and(
            eq(truthBackgroundJobsTable.status, 'running'),
            or(
              isNull(truthBackgroundJobsTable.leaseExpiresAt),
              lt(truthBackgroundJobsTable.leaseExpiresAt, new Date()),
            ),
          ),
        ),
      ),
    )
    .returning();
  return claimed ? rowToTruthBackgroundJob(claimed) : null;
}

export async function listClaimableTruthBackgroundDbJobIds(limit: number): Promise<string[]> {
  await ensureTruthBackgroundJobsTable();
  const rows = await db
    .select({ id: truthBackgroundJobsTable.id })
    .from(truthBackgroundJobsTable)
    .where(
      or(
        eq(truthBackgroundJobsTable.status, 'pending'),
        and(
          eq(truthBackgroundJobsTable.status, 'running'),
          or(
            isNull(truthBackgroundJobsTable.leaseExpiresAt),
            lt(truthBackgroundJobsTable.leaseExpiresAt, new Date()),
          ),
        ),
      ),
    )
    .orderBy(asc(truthBackgroundJobsTable.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function pruneTruthBackgroundDbJobs(retentionLimit: number): Promise<void> {
  await ensureTruthBackgroundJobsTable();
  if (retentionLimit < 1) {
    const doomed = await db
      .select({ id: truthBackgroundJobsTable.id })
      .from(truthBackgroundJobsTable)
      .where(inArray(truthBackgroundJobsTable.status, ['completed', 'failed']));
    if (doomed.length === 0) {
      return;
    }
    await db
      .delete(truthBackgroundJobsTable)
      .where(inArray(truthBackgroundJobsTable.id, doomed.map((row) => row.id)));
    return;
  }

  const retained = await db
    .select({ id: truthBackgroundJobsTable.id })
    .from(truthBackgroundJobsTable)
    .where(inArray(truthBackgroundJobsTable.status, ['completed', 'failed']))
    .orderBy(desc(truthBackgroundJobsTable.finishedAt), desc(truthBackgroundJobsTable.createdAt))
    .limit(retentionLimit);
  const retainedIds = retained.map((row) => row.id);

  const doomed = await db
    .select({ id: truthBackgroundJobsTable.id })
    .from(truthBackgroundJobsTable)
    .where(inArray(truthBackgroundJobsTable.status, ['completed', 'failed']));
  const doomedIds = doomed
    .map((row) => row.id)
    .filter((id) => !retainedIds.includes(id));
  if (doomedIds.length === 0) {
    return;
  }
  await db
    .delete(truthBackgroundJobsTable)
    .where(inArray(truthBackgroundJobsTable.id, doomedIds));
}
