import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import type { V2ConversionRequest, V2ConversionResponse } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { getUsableDatabaseUrl } from './store/databaseUrl.js';

export type V2JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface V2StoredJob {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  status: V2JobStatus;
  request: V2ConversionRequest;
  response?: V2ConversionResponse;
  error?: string;
}

export interface IV2JobStorage {
  saveJob(request: V2ConversionRequest, response: V2ConversionResponse): Promise<V2StoredJob>;
  createQueuedJob(request: V2ConversionRequest): Promise<V2StoredJob>;
  markProcessing(id: string): Promise<void>;
  completeJob(id: string, response: V2ConversionResponse): Promise<V2StoredJob | undefined>;
  failJob(id: string, error: string): Promise<void>;
  getJob(id: string): Promise<V2StoredJob | undefined>;
}

const v2JobsTable = pgTable('v2_jobs', {
  id: text('id').primaryKey(),
  status: text('status').$type<V2JobStatus>().notNull(),
  request: jsonb('request').$type<V2ConversionRequest>().notNull(),
  response: jsonb('response').$type<V2ConversionResponse | null>(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

class MemoryV2JobStorage implements IV2JobStorage {
  // NON-DURABLE: in-memory fallback only. Do not use in production.
  // Async job persistence requires Postgres/Drizzle path.
  private jobs = new Map<string, V2StoredJob>();

  async saveJob(request: V2ConversionRequest, response: V2ConversionResponse): Promise<V2StoredJob> {
    const now = new Date();
    const job: V2StoredJob = {
      id: response.job_id,
      createdAt: now,
      updatedAt: now,
      status: 'completed',
      request,
      response,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async createQueuedJob(request: V2ConversionRequest): Promise<V2StoredJob> {
    const now = new Date();
    const job: V2StoredJob = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      request,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async markProcessing(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, status: 'processing', updatedAt: new Date() });
  }

  async completeJob(id: string, response: V2ConversionResponse): Promise<V2StoredJob | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const completed: V2StoredJob = {
      ...job,
      status: 'completed',
      updatedAt: new Date(),
      response,
      error: undefined,
    };
    this.jobs.set(id, completed);
    return completed;
  }

  async failJob(id: string, error: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, status: 'failed', error, updatedAt: new Date() });
  }

  async getJob(id: string): Promise<V2StoredJob | undefined> {
    return this.jobs.get(id);
  }
}

class PostgresV2JobStorage implements IV2JobStorage {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle(neon(connectionString));
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.db.execute(sql`
        create table if not exists v2_jobs (
          id text primary key,
          status text not null,
          request jsonb not null,
          response jsonb,
          error text,
          created_at timestamptz not null,
          updated_at timestamptz not null
        )
      `).then(() => undefined);
    }
    await this.ready;
  }

  private rowToJob(row: typeof v2JobsTable.$inferSelect): V2StoredJob {
    return {
      id: row.id,
      status: row.status,
      request: row.request,
      response: row.response ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async saveJob(request: V2ConversionRequest, response: V2ConversionResponse): Promise<V2StoredJob> {
    await this.ensureReady();
    const now = new Date();
    await this.db.insert(v2JobsTable).values({
      id: response.job_id,
      status: 'completed',
      request,
      response,
      error: null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: v2JobsTable.id,
      set: {
        status: 'completed',
        request,
        response,
        error: null,
        updatedAt: now,
      },
    });
    return {
      id: response.job_id,
      createdAt: now,
      updatedAt: now,
      status: 'completed',
      request,
      response,
    };
  }

  async createQueuedJob(request: V2ConversionRequest): Promise<V2StoredJob> {
    await this.ensureReady();
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(v2JobsTable).values({
      id,
      status: 'queued',
      request,
      response: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      request,
    };
  }

  async markProcessing(id: string): Promise<void> {
    await this.ensureReady();
    await this.db.update(v2JobsTable).set({
      status: 'processing',
      updatedAt: new Date(),
    }).where(eq(v2JobsTable.id, id));
  }

  async completeJob(id: string, response: V2ConversionResponse): Promise<V2StoredJob | undefined> {
    await this.ensureReady();
    await this.db.update(v2JobsTable).set({
      status: 'completed',
      response,
      error: null,
      updatedAt: new Date(),
    }).where(eq(v2JobsTable.id, id));
    return this.getJob(id);
  }

  async failJob(id: string, error: string): Promise<void> {
    await this.ensureReady();
    await this.db.update(v2JobsTable).set({
      status: 'failed',
      error,
      updatedAt: new Date(),
    }).where(eq(v2JobsTable.id, id));
  }

  async getJob(id: string): Promise<V2StoredJob | undefined> {
    await this.ensureReady();
    const rows = await this.db.select().from(v2JobsTable).where(eq(v2JobsTable.id, id)).limit(1);
    const row = rows[0];
    return row ? this.rowToJob(row) : undefined;
  }
}

const databaseUrl = getUsableDatabaseUrl();

export const v2JobStorage: IV2JobStorage = databaseUrl
  ? new PostgresV2JobStorage(databaseUrl)
  : new MemoryV2JobStorage();
