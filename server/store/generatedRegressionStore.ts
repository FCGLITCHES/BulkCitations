import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PatternExportArtifact } from '@shared/schema';
import {
  appendMigrationLog,
  readJsonlFile,
  readMigrationLog,
  resolveDataFile,
  stableFileMigrationKey,
  writeJsonlFile,
} from './persistence.js';
import { getUsableDatabaseUrl } from './databaseUrl.js';

export interface RegressionFixture {
  id: string;
  description: string;
  expectedToFail?: boolean;
  references: string[];
  expectedDuplicateCount?: number;
  expectedUniqueCount?: number;
  expectedMergedTitle?: string;
  expectedMergedAuthors?: string[];
  expectedOutputText?: string;
  expectedReferenceType?: string;
  forbiddenOutputPatterns?: RegExp[];
}

export interface GeneratedRegressionFixtureRecord {
  id: string;
  sourceReportId: string;
  createdAt: string;
  generatedBy?: string;
  fixture?: RegressionFixture;
  skipped?: boolean;
  skipReason?: string;
  exportArtifact?: PatternExportArtifact;
}

interface GeneratedRegressionStorage {
  save(record: GeneratedRegressionFixtureRecord): Promise<GeneratedRegressionFixtureRecord>;
  list(): Promise<GeneratedRegressionFixtureRecord[]>;
}

const REGRESSION_FILE = resolveDataFile('generatedRegressionFixtures.v1.jsonl');
const MIGRATION_LOG_FILE = resolveDataFile('store-migrations.jsonl');

const regressionRows = pgTable('generated_regression_fixtures', {
  id: text('id').primaryKey(),
  sourceReportId: text('source_report_id').notNull(),
  skipped: boolean('skipped').notNull(),
  payload: jsonb('payload').$type<GeneratedRegressionFixtureRecord>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

const migrationRows = pgTable('store_migrations', {
  key: text('key').primaryKey(),
  sourcePath: text('source_path').notNull(),
  stats: jsonb('stats').$type<{ migrated: number; skipped: number; failed: number }>().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
});

function serializeFixture(record: GeneratedRegressionFixtureRecord): GeneratedRegressionFixtureRecord {
  return {
    ...record,
    fixture: record.fixture
      ? {
          ...record.fixture,
          forbiddenOutputPatterns: record.fixture.forbiddenOutputPatterns?.map((pattern) => new RegExp(pattern.source, pattern.flags)),
        }
      : undefined,
  };
}

class FileGeneratedRegressionStorage implements GeneratedRegressionStorage {
  async save(record: GeneratedRegressionFixtureRecord): Promise<GeneratedRegressionFixtureRecord> {
    const current = await this.list();
    const index = current.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      current[index] = serializeFixture(record);
    } else {
      current.push(serializeFixture(record));
    }
    writeJsonlFile(REGRESSION_FILE, current);
    return serializeFixture(record);
  }

  async list(): Promise<GeneratedRegressionFixtureRecord[]> {
    return readJsonlFile<GeneratedRegressionFixtureRecord>(REGRESSION_FILE).map(serializeFixture);
  }
}

class PostgresGeneratedRegressionStorage implements GeneratedRegressionStorage {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle(neon(connectionString));
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = Promise.all([
        this.db.execute(sql`
          create table if not exists generated_regression_fixtures (
            id text primary key,
            source_report_id text not null,
            skipped boolean not null,
            payload jsonb not null,
            created_at timestamptz not null,
            updated_at timestamptz not null
          )
        `),
        this.db.execute(sql`
          create table if not exists store_migrations (
            key text primary key,
            source_path text not null,
            stats jsonb not null,
            completed_at timestamptz not null
          )
        `),
      ]).then(() => undefined);
    }
    await this.ready;
    await this.backfillJsonl();
  }

  private async backfillJsonl(): Promise<void> {
    if (!fs.existsSync(REGRESSION_FILE)) return;
    const migrationKey = stableFileMigrationKey(REGRESSION_FILE);
    const existing = await this.db.select().from(migrationRows).where(eq(migrationRows.key, migrationKey)).limit(1);
    if (existing[0]) return;

    const rows = readJsonlFile<GeneratedRegressionFixtureRecord>(REGRESSION_FILE);
    let migrated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const next = serializeFixture(row);
        await this.db.insert(regressionRows).values({
          id: next.id,
          sourceReportId: next.sourceReportId,
          skipped: Boolean(next.skipped),
          payload: next,
          createdAt: new Date(next.createdAt),
          updatedAt: new Date(),
        }).onConflictDoNothing();
        migrated += 1;
      } catch (error) {
        failed += 1;
        console.warn('[generatedRegressionStore] Migration row failed:', error instanceof Error ? error.message : String(error));
      }
    }

    await this.db.insert(migrationRows).values({
      key: migrationKey,
      sourcePath: REGRESSION_FILE,
      completedAt: new Date(),
      stats: {
        migrated,
        skipped: 0,
        failed,
      },
    }).onConflictDoNothing();
  }

  async save(record: GeneratedRegressionFixtureRecord): Promise<GeneratedRegressionFixtureRecord> {
    await this.ensureReady();
    const next = serializeFixture(record);
    await this.db.insert(regressionRows).values({
      id: next.id,
      sourceReportId: next.sourceReportId,
      skipped: Boolean(next.skipped),
      payload: next,
      createdAt: new Date(next.createdAt),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: regressionRows.id,
      set: {
        sourceReportId: next.sourceReportId,
        skipped: Boolean(next.skipped),
        payload: next,
        updatedAt: new Date(),
      },
    });
    return next;
  }

  async list(): Promise<GeneratedRegressionFixtureRecord[]> {
    await this.ensureReady();
    const rows = await this.db.select().from(regressionRows);
    return rows.map((row) => serializeFixture(row.payload));
  }
}

const databaseUrl = getUsableDatabaseUrl();

const generatedRegressionStorage: GeneratedRegressionStorage = databaseUrl
  ? new PostgresGeneratedRegressionStorage(databaseUrl)
  : new FileGeneratedRegressionStorage();

export async function saveGeneratedRegressionFixture(record: GeneratedRegressionFixtureRecord): Promise<GeneratedRegressionFixtureRecord> {
  return generatedRegressionStorage.save(record);
}

export async function loadGeneratedRegressionFixtures(): Promise<GeneratedRegressionFixtureRecord[]> {
  return generatedRegressionStorage.list();
}
