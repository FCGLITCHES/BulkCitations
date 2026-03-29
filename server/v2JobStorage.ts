import { randomUUID } from 'node:crypto';
import type { ConversionResponse, V2ConversionRequest, V2ConversionResponse } from '@shared/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createPostgresPoolConfig, getUsableDatabaseUrl } from './store/databaseUrl.js';

export type V2JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface V2StoredJob {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  status: V2JobStatus;
  request: V2ConversionRequest;
  response?: V2ConversionResponse;
  legacyResponse?: ConversionResponse;
  error?: string;
  errorCode?: string;
  expiresAt?: Date;
  startedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface CreateQueuedJobOptions {
  id?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface SaveJobOptions {
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
  legacyResponse?: ConversionResponse;
}

export interface MarkProcessingOptions {
  startedAt?: Date;
}

export interface CompleteJobOptions {
  legacyResponse?: ConversionResponse;
}

export interface IV2JobStorage {
  saveJob(request: V2ConversionRequest, response: V2ConversionResponse, options?: SaveJobOptions): Promise<V2StoredJob>;
  createQueuedJob(request: V2ConversionRequest, options?: CreateQueuedJobOptions): Promise<V2StoredJob>;
  markProcessing(id: string, options?: MarkProcessingOptions): Promise<void>;
  completeJob(id: string, response: V2ConversionResponse, options?: CompleteJobOptions): Promise<V2StoredJob | undefined>;
  failJob(id: string, error: string, errorCode?: string): Promise<void>;
  getJob(id: string): Promise<V2StoredJob | undefined>;
  listJobsByStatus(statuses: V2JobStatus[]): Promise<V2StoredJob[]>;
}

const v2JobsTable = pgTable('v2_jobs', {
  id: text('id').primaryKey(),
  status: text('status').$type<V2JobStatus>().notNull(),
  request: jsonb('request').$type<V2ConversionRequest>().notNull(),
  response: jsonb('response').$type<V2ConversionResponse | null>(),
  legacyResponse: jsonb('legacy_response').$type<ConversionResponse | null>(),
  error: text('error'),
  errorCode: text('error_code'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

class MemoryV2JobStorage implements IV2JobStorage {
  // NON-DURABLE: in-memory fallback only. Do not use in production.
  // Async job persistence requires Postgres/Drizzle path.
  private jobs = new Map<string, V2StoredJob>();

  async saveJob(request: V2ConversionRequest, response: V2ConversionResponse, options: SaveJobOptions = {}): Promise<V2StoredJob> {
    const now = new Date();
    const job: V2StoredJob = {
      id: response.job_id,
      createdAt: now,
      updatedAt: now,
      status: 'completed',
      request,
      response,
      legacyResponse: options.legacyResponse,
      expiresAt: options.expiresAt,
      metadata: options.metadata,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async createQueuedJob(request: V2ConversionRequest, options: CreateQueuedJobOptions = {}): Promise<V2StoredJob> {
    const now = new Date();
    const job: V2StoredJob = {
      id: options.id ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      request,
      expiresAt: options.expiresAt,
      metadata: options.metadata,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async markProcessing(id: string, options: MarkProcessingOptions = {}): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, {
      ...job,
      status: 'processing',
      startedAt: options.startedAt ?? new Date(),
      updatedAt: new Date(),
    });
  }

  async completeJob(id: string, response: V2ConversionResponse, options: CompleteJobOptions = {}): Promise<V2StoredJob | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const completed: V2StoredJob = {
      ...job,
      status: 'completed',
      updatedAt: new Date(),
      response,
      legacyResponse: options.legacyResponse ?? job.legacyResponse,
      error: undefined,
      errorCode: undefined,
    };
    this.jobs.set(id, completed);
    return completed;
  }

  async failJob(id: string, error: string, errorCode?: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, {
      ...job,
      status: 'failed',
      error,
      errorCode,
      updatedAt: new Date(),
    });
  }

  async getJob(id: string): Promise<V2StoredJob | undefined> {
    return this.jobs.get(id);
  }

  async listJobsByStatus(statuses: V2JobStatus[]): Promise<V2StoredJob[]> {
    const wanted = new Set(statuses);
    return [...this.jobs.values()].filter((job) => wanted.has(job.status));
  }
}

class PostgresV2JobStorage implements IV2JobStorage {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle({ connection: createPostgresPoolConfig(connectionString) });
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.db.execute(sql`
          create table if not exists v2_jobs (
            id text primary key,
            status text not null,
            request jsonb not null,
            response jsonb,
            legacy_response jsonb,
            error text,
            error_code text,
            expires_at timestamptz,
            started_at timestamptz,
            metadata jsonb,
            created_at timestamptz not null,
            updated_at timestamptz not null
          )
        `);
        await this.db.execute(sql`alter table v2_jobs add column if not exists legacy_response jsonb`);
        await this.db.execute(sql`alter table v2_jobs add column if not exists error_code text`);
        await this.db.execute(sql`alter table v2_jobs add column if not exists expires_at timestamptz`);
        await this.db.execute(sql`alter table v2_jobs add column if not exists started_at timestamptz`);
        await this.db.execute(sql`alter table v2_jobs add column if not exists metadata jsonb`);
      })().then(() => undefined);
    }
    await this.ready;
  }

  private rowToJob(row: typeof v2JobsTable.$inferSelect): V2StoredJob {
    return {
      id: row.id,
      status: row.status,
      request: row.request,
      response: row.response ?? undefined,
      legacyResponse: row.legacyResponse ?? undefined,
      error: row.error ?? undefined,
      errorCode: row.errorCode ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      startedAt: row.startedAt ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async saveJob(request: V2ConversionRequest, response: V2ConversionResponse, options: SaveJobOptions = {}): Promise<V2StoredJob> {
    await this.ensureReady();
    const now = new Date();
    await this.db.insert(v2JobsTable).values({
      id: response.job_id,
      status: 'completed',
      request,
      response,
      legacyResponse: options.legacyResponse ?? null,
      error: null,
      errorCode: null,
      expiresAt: options.expiresAt ?? null,
      startedAt: null,
      metadata: options.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: v2JobsTable.id,
      set: {
        status: 'completed',
        request,
        response,
        legacyResponse: options.legacyResponse ?? null,
        error: null,
        errorCode: null,
        expiresAt: options.expiresAt ?? null,
        startedAt: null,
        metadata: options.metadata ?? null,
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
      legacyResponse: options.legacyResponse,
      expiresAt: options.expiresAt,
      metadata: options.metadata,
    };
  }

  async createQueuedJob(request: V2ConversionRequest, options: CreateQueuedJobOptions = {}): Promise<V2StoredJob> {
    await this.ensureReady();
    const now = new Date();
    const id = options.id ?? randomUUID();
    await this.db.insert(v2JobsTable).values({
      id,
      status: 'queued',
      request,
      response: null,
      legacyResponse: null,
      error: null,
      errorCode: null,
      expiresAt: options.expiresAt ?? null,
      startedAt: null,
      metadata: options.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      request,
      expiresAt: options.expiresAt,
      metadata: options.metadata,
    };
  }

  async markProcessing(id: string, options: MarkProcessingOptions = {}): Promise<void> {
    await this.ensureReady();
    await this.db.update(v2JobsTable).set({
      status: 'processing',
      startedAt: options.startedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(eq(v2JobsTable.id, id));
  }

  async completeJob(id: string, response: V2ConversionResponse, options: CompleteJobOptions = {}): Promise<V2StoredJob | undefined> {
    await this.ensureReady();
    await this.db.update(v2JobsTable).set({
      status: 'completed',
      response,
      legacyResponse: options.legacyResponse ?? null,
      error: null,
      errorCode: null,
      updatedAt: new Date(),
    }).where(eq(v2JobsTable.id, id));
    return this.getJob(id);
  }

  async failJob(id: string, error: string, errorCode?: string): Promise<void> {
    await this.ensureReady();
    await this.db.update(v2JobsTable).set({
      status: 'failed',
      error,
      errorCode: errorCode ?? null,
      updatedAt: new Date(),
    }).where(eq(v2JobsTable.id, id));
  }

  async getJob(id: string): Promise<V2StoredJob | undefined> {
    await this.ensureReady();
    const rows = await this.db.select().from(v2JobsTable).where(eq(v2JobsTable.id, id)).limit(1);
    const row = rows[0];
    return row ? this.rowToJob(row) : undefined;
  }

  async listJobsByStatus(statuses: V2JobStatus[]): Promise<V2StoredJob[]> {
    await this.ensureReady();
    if (statuses.length === 0) return [];
    const rows = await this.db.select().from(v2JobsTable).where(inArray(v2JobsTable.status, statuses));
    return rows.map((row) => this.rowToJob(row));
  }
}

class ResilientV2JobStorage implements IV2JobStorage {
  private primary: IV2JobStorage;
  private fallback: IV2JobStorage;
  private usingFallback = false;

  constructor(primary: IV2JobStorage, fallback: IV2JobStorage) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private shouldFallback(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Error connecting to database|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|connection/i.test(message);
  }

  private async runWithFallback<T>(operation: (store: IV2JobStorage) => Promise<T>): Promise<T> {
    if (this.usingFallback) {
      return operation(this.fallback);
    }

    try {
      return await operation(this.primary);
    } catch (error) {
      if (!this.shouldFallback(error)) {
        throw error;
      }
      this.usingFallback = true;
      console.warn('[v2JobStorage] Database unavailable, falling back to memory job storage:', error instanceof Error ? error.message : String(error));
      return operation(this.fallback);
    }
  }

  async saveJob(request: V2ConversionRequest, response: V2ConversionResponse, options?: SaveJobOptions): Promise<V2StoredJob> {
    return this.runWithFallback((store) => store.saveJob(request, response, options));
  }

  async createQueuedJob(request: V2ConversionRequest, options?: CreateQueuedJobOptions): Promise<V2StoredJob> {
    return this.runWithFallback((store) => store.createQueuedJob(request, options));
  }

  async markProcessing(id: string, options?: MarkProcessingOptions): Promise<void> {
    await this.runWithFallback((store) => store.markProcessing(id, options));
  }

  async completeJob(id: string, response: V2ConversionResponse, options?: CompleteJobOptions): Promise<V2StoredJob | undefined> {
    return this.runWithFallback((store) => store.completeJob(id, response, options));
  }

  async failJob(id: string, error: string, errorCode?: string): Promise<void> {
    await this.runWithFallback((store) => store.failJob(id, error, errorCode));
  }

  async getJob(id: string): Promise<V2StoredJob | undefined> {
    return this.runWithFallback((store) => store.getJob(id));
  }

  async listJobsByStatus(statuses: V2JobStatus[]): Promise<V2StoredJob[]> {
    return this.runWithFallback((store) => store.listJobsByStatus(statuses));
  }
}

const databaseUrl = getUsableDatabaseUrl();

export const v2JobStorage: IV2JobStorage = databaseUrl
  ? new ResilientV2JobStorage(new PostgresV2JobStorage(databaseUrl), new MemoryV2JobStorage())
  : new MemoryV2JobStorage();
