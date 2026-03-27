import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type {
  CitationReport,
  FailureCategory,
  FailureSource,
  ReportStatus,
  ReviewEvent,
} from '@shared/schema';
import {
  appendMigrationLog,
  getDataDir,
  readJsonlFile,
  readMigrationLog,
  resolveDataFile,
  stableFileMigrationKey,
  writeJsonlFile,
} from './persistence.js';
import { createPostgresPoolConfig, getUsableDatabaseUrl } from './databaseUrl.js';

export type { CitationReport, ReportStatus, FailureCategory, FailureSource };

const DATA_DIR = getDataDir();

const REPORTS_FILE = resolveDataFile('reports.v2.jsonl');
const LEGACY_REPORTS_FILE = path.join(DATA_DIR, 'reports.jsonl');
const MIGRATION_LOG_FILE = resolveDataFile('store-migrations.jsonl');

interface V1Report {
  id: string;
  timestamp: string;
  rawInput: string;
  detectedInputStyle: string;
  targetStyle: string;
  convertedOutput: string;
  userCategory: string;
  userNote?: string;
  status: 'open' | 'fixed' | 'rejected';
}

const CATEGORY_MAP: Record<string, FailureCategory> = {
  'Year missing or incorrect': 'year',
  'Author name incorrect': 'author',
  'Title missing or incorrect': 'title',
  'Journal / venue incorrect': 'venue',
  'Pages missing or incorrect': 'locator',
  'Wrong citation style detected': 'style-detection',
  'Other...': 'other',
};

const STATUS_MAP: Record<string, ReportStatus> = {
  open: 'pending',
  fixed: 'accepted',
  rejected: 'rejected',
};

interface GroupedReports {
  fingerprint: string;
  reports: CitationReport[];
  totalCount: number;
  category: string;
}

interface IReportStore {
  saveReport(report: CitationReport): Promise<CitationReport>;
  loadReports(): Promise<CitationReport[]>;
  getReportById(id: string): Promise<CitationReport | null>;
  updateReport(id: string, updates: Partial<CitationReport>): Promise<CitationReport | null>;
  deleteReports(ids: string[]): Promise<number>;
}

const reportRows = pgTable('citation_reports', {
  id: text('id').primaryKey(),
  fingerprint: text('fingerprint'),
  status: text('status').notNull(),
  payload: jsonb('payload').$type<CitationReport>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

const migrationRows = pgTable('store_migrations', {
  key: text('key').primaryKey(),
  sourcePath: text('source_path').notNull(),
  stats: jsonb('stats').$type<{ migrated: number; skipped: number; failed: number }>().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
});

function hydrateReport(report: CitationReport): CitationReport {
  return {
    ...report,
    reportCount: report.reportCount ?? 1,
    reviewEvents: report.reviewEvents ?? [],
  };
}

function mapLegacyReport(v1: V1Report): CitationReport {
  return {
    id: v1.id,
    source: 'user',
    originalText: v1.rawInput,
    detectedStyle: v1.detectedInputStyle || '',
    outputStyle: v1.targetStyle || '',
    convertedText: v1.convertedOutput,
    failureCategory: CATEGORY_MAP[v1.userCategory] ?? 'other',
    userNote: v1.userNote,
    status: STATUS_MAP[v1.status] ?? 'pending',
    createdAt: v1.timestamp,
    reportCount: 1,
    fingerprint: computeFingerprint(v1.rawInput),
    reviewEvents: [],
  };
}

class FileReportStore implements IReportStore {
  private migrationReady = false;
  private cachedReports: CitationReport[] | null = null;

  private cloneReport(report: CitationReport): CitationReport {
    return hydrateReport({
      ...report,
      failureCategories: report.failureCategories ? [...report.failureCategories] : undefined,
      reviewEvents: report.reviewEvents ? [...report.reviewEvents] : [],
    });
  }

  private readReports(): CitationReport[] {
    if (this.cachedReports) {
      return this.cachedReports.map((report) => this.cloneReport(report));
    }

    const rows = readJsonlFile<CitationReport>(REPORTS_FILE).map(hydrateReport);
    this.cachedReports = rows;
    return rows.map((report) => this.cloneReport(report));
  }

  private writeReports(rows: CitationReport[]): void {
    const hydratedRows = rows.map(hydrateReport);
    this.cachedReports = hydratedRows;
    writeJsonlFile(REPORTS_FILE, hydratedRows);
  }

  private ensureLegacyMigration(): void {
    if (this.migrationReady) return;
    this.migrationReady = true;

    if (!fs.existsSync(LEGACY_REPORTS_FILE) || fs.existsSync(REPORTS_FILE)) {
      return;
    }

    const migrationKey = stableFileMigrationKey(LEGACY_REPORTS_FILE);
    const existingLog = readMigrationLog(MIGRATION_LOG_FILE).find((entry) => entry.key === migrationKey);
    if (existingLog) return;

    const rawLines = fs.readFileSync(LEGACY_REPORTS_FILE, 'utf8').split('\n').filter(Boolean);
    const migrated: CitationReport[] = [];
    let failed = 0;

    for (const line of rawLines) {
      try {
        migrated.push(mapLegacyReport(JSON.parse(line) as V1Report));
      } catch (error) {
        failed += 1;
        console.warn('[reportStore] Skipping malformed legacy report row:', error instanceof Error ? error.message : String(error));
      }
    }

    this.writeReports(migrated);
    appendMigrationLog(MIGRATION_LOG_FILE, {
      key: migrationKey,
      sourcePath: LEGACY_REPORTS_FILE,
      completedAt: new Date().toISOString(),
      stats: {
        migrated: migrated.length,
        skipped: 0,
        failed,
      },
    });
  }

  async saveReport(report: CitationReport): Promise<CitationReport> {
    this.ensureLegacyMigration();
    const rows = this.readReports();

    if (report.fingerprint) {
      const existingIndex = rows.findIndex((candidate) => (
        candidate.fingerprint === report.fingerprint
        && (candidate.status === 'pending' || candidate.status === 'proposed')
      ));
      if (existingIndex >= 0) {
        const existing = rows[existingIndex];
        const merged: CitationReport = {
          ...existing,
          reportCount: (existing.reportCount ?? 1) + 1,
          userNote: report.userNote && report.userNote !== existing.userNote
            ? existing.userNote
              ? `${existing.userNote} | ${report.userNote}`
              : report.userNote
            : existing.userNote,
          failureCategories: Array.from(new Set([...(existing.failureCategories ?? [existing.failureCategory]), ...(report.failureCategories ?? [report.failureCategory])])),
          reviewEvents: existing.reviewEvents ?? [],
        };
        rows[existingIndex] = merged;
        this.writeReports(rows);
        return merged;
      }
    }

    const next = hydrateReport(report);
    rows.push(next);
    this.writeReports(rows);
    return next;
  }

  async loadReports(): Promise<CitationReport[]> {
    this.ensureLegacyMigration();
    return this.readReports();
  }

  async getReportById(id: string): Promise<CitationReport | null> {
    const rows = await this.loadReports();
    return rows.find((report) => report.id === id) ?? null;
  }

  async updateReport(id: string, updates: Partial<CitationReport>): Promise<CitationReport | null> {
    const rows = this.readReports();
    const index = rows.findIndex((report) => report.id === id);
    if (index === -1) return null;

    const current = rows[index];
    const merged = hydrateReport({
      ...current,
      ...updates,
      reviewEvents: updates.reviewEvents ?? current.reviewEvents ?? [],
    });
    rows[index] = merged;
    this.writeReports(rows);
    return merged;
  }

  async deleteReports(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const idSet = new Set(ids);
    const rows = await this.loadReports();
    const remaining = rows.filter((report) => !idSet.has(report.id));
    const deletedCount = rows.length - remaining.length;
    if (deletedCount > 0) {
      this.writeReports(remaining);
    }
    return deletedCount;
  }
}

class PostgresReportStore implements IReportStore {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle({ connection: createPostgresPoolConfig(connectionString) });
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = Promise.all([
        this.db.execute(sql`
          create table if not exists citation_reports (
            id text primary key,
            fingerprint text,
            status text not null,
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
    await this.backfillJsonl(REPORTS_FILE, (row) => row);
    await this.backfillJsonl(LEGACY_REPORTS_FILE, mapLegacyReport);
  }

  private async backfillJsonl(
    sourcePath: string,
    mapper: (row: any) => CitationReport,
  ): Promise<void> {
    if (!fs.existsSync(sourcePath)) return;

    const migrationKey = stableFileMigrationKey(sourcePath);
    const existing = await this.db.select()
      .from(migrationRows)
      .where(eq(migrationRows.key, migrationKey))
      .limit(1);
    if (existing[0]) return;

    const sourceRows = readJsonlFile<any>(sourcePath);
    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of sourceRows) {
      try {
        const report = hydrateReport(mapper(row));
        await this.db.insert(reportRows).values({
          id: report.id,
          fingerprint: report.fingerprint ?? null,
          status: report.status,
          payload: report,
          createdAt: new Date(report.createdAt),
          updatedAt: new Date(report.resolvedAt ?? report.createdAt),
        }).onConflictDoNothing();
        migrated += 1;
      } catch (error) {
        failed += 1;
        console.warn('[reportStore] Migration row failed:', error instanceof Error ? error.message : String(error));
      }
    }

    await this.db.insert(migrationRows).values({
      key: migrationKey,
      sourcePath,
      stats: { migrated, skipped, failed },
      completedAt: new Date(),
    }).onConflictDoNothing();
  }

  async saveReport(report: CitationReport): Promise<CitationReport> {
    await this.ensureReady();

    if (report.fingerprint) {
      const rows = await this.db.select()
        .from(reportRows)
        .where(eq(reportRows.fingerprint, report.fingerprint));
      const existing = rows
        .map((row) => hydrateReport(row.payload))
        .find((candidate) => candidate.status === 'pending' || candidate.status === 'proposed');
      if (existing) {
        const merged: CitationReport = {
          ...existing,
          reportCount: (existing.reportCount ?? 1) + 1,
          userNote: report.userNote && report.userNote !== existing.userNote
            ? existing.userNote
              ? `${existing.userNote} | ${report.userNote}`
              : report.userNote
            : existing.userNote,
          failureCategories: Array.from(new Set([...(existing.failureCategories ?? [existing.failureCategory]), ...(report.failureCategories ?? [report.failureCategory])])),
        };
        await this.updateReport(existing.id, merged);
        return merged;
      }
    }

    const next = hydrateReport(report);
    const now = new Date();
    await this.db.insert(reportRows).values({
      id: next.id,
      fingerprint: next.fingerprint ?? null,
      status: next.status,
      payload: next,
      createdAt: new Date(next.createdAt),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: reportRows.id,
      set: {
        fingerprint: next.fingerprint ?? null,
        status: next.status,
        payload: next,
        updatedAt: now,
      },
    });
    return next;
  }

  async loadReports(): Promise<CitationReport[]> {
    await this.ensureReady();
    const rows = await this.db.select().from(reportRows);
    return rows.map((row) => hydrateReport(row.payload));
  }

  async getReportById(id: string): Promise<CitationReport | null> {
    await this.ensureReady();
    const rows = await this.db.select().from(reportRows).where(eq(reportRows.id, id)).limit(1);
    return rows[0] ? hydrateReport(rows[0].payload) : null;
  }

  async updateReport(id: string, updates: Partial<CitationReport>): Promise<CitationReport | null> {
    await this.ensureReady();
    const current = await this.getReportById(id);
    if (!current) return null;

    const next = hydrateReport({
      ...current,
      ...updates,
      reviewEvents: updates.reviewEvents ?? current.reviewEvents ?? [],
    });
    await this.db.update(reportRows).set({
      fingerprint: next.fingerprint ?? null,
      status: next.status,
      payload: next,
      updatedAt: new Date(),
    }).where(eq(reportRows.id, id));
    return next;
  }

  async deleteReports(ids: string[]): Promise<number> {
    await this.ensureReady();
    if (ids.length === 0) return 0;
    const existing = await this.db.select({ id: reportRows.id })
      .from(reportRows)
      .where(inArray(reportRows.id, ids));
    if (existing.length === 0) return 0;
    await this.db.delete(reportRows).where(inArray(reportRows.id, ids));
    return existing.length;
  }
}

class ResilientReportStore implements IReportStore {
  private primary: IReportStore;
  private fallback: IReportStore;
  private usingFallback = false;

  constructor(primary: IReportStore, fallback: IReportStore) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private shouldFallback(error: any): boolean {
    if (error?.code === 'XX000' || error?.severity === 'FATAL') return true;
    const message = error instanceof Error ? error.message : String(error);
    return /Error connecting to database|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|connection/i.test(message);
  }

  private async runWithFallback<T>(operation: (store: IReportStore) => Promise<T>): Promise<T> {
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
      console.warn('[reportStore] Database unavailable, falling back to local report storage:', error instanceof Error ? error.message : String(error));
      return operation(this.fallback);
    }
  }

  async saveReport(report: CitationReport): Promise<CitationReport> {
    return this.runWithFallback((store) => store.saveReport(report));
  }

  async loadReports(): Promise<CitationReport[]> {
    return this.runWithFallback((store) => store.loadReports());
  }

  async getReportById(id: string): Promise<CitationReport | null> {
    return this.runWithFallback((store) => store.getReportById(id));
  }

  async updateReport(id: string, updates: Partial<CitationReport>): Promise<CitationReport | null> {
    return this.runWithFallback((store) => store.updateReport(id, updates));
  }

  async deleteReports(ids: string[]): Promise<number> {
    return this.runWithFallback((store) => store.deleteReports(ids));
  }
}

const databaseUrl = getUsableDatabaseUrl();

const fileReportStore = new FileReportStore();

const reportStore: IReportStore = databaseUrl
  ? new ResilientReportStore(new PostgresReportStore(databaseUrl), fileReportStore)
  : fileReportStore;

export function computeFingerprint(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

export function hashIP(ip: string): string {
  return createHash('sha256').update(`cite-report:${ip}`).digest('hex').slice(0, 16);
}

export async function saveReport(report: CitationReport): Promise<CitationReport> {
  return reportStore.saveReport(report);
}

export async function loadReports(): Promise<CitationReport[]> {
  return reportStore.loadReports();
}

export async function getReportById(id: string): Promise<CitationReport | null> {
  return reportStore.getReportById(id);
}

export async function updateReport(id: string, updates: Partial<CitationReport>): Promise<CitationReport | null> {
  return reportStore.updateReport(id, updates);
}

export async function deleteReports(ids: string[]): Promise<number> {
  return reportStore.deleteReports(ids);
}

export async function appendReviewEvent(id: string, event: ReviewEvent): Promise<CitationReport | null> {
  const report = await getReportById(id);
  if (!report) return null;
  return updateReport(id, {
    reviewEvents: [...(report.reviewEvents ?? []), event],
  });
}

export async function updateReportStatus(id: string, status: ReportStatus): Promise<boolean> {
  const updates: Partial<CitationReport> = { status };
  if (status === 'accepted' || status === 'rejected') {
    updates.resolvedAt = new Date().toISOString();
  }
  return (await updateReport(id, updates)) !== null;
}

export async function getGroupedReports(
  statusFilter?: ReportStatus,
): Promise<GroupedReports[]> {
  const reports = await loadReports();
  const filtered = statusFilter
    ? reports.filter((report) => report.status === statusFilter)
    : reports;

  const groups = new Map<string, CitationReport[]>();
  for (const report of filtered) {
    const key = report.fingerprint || report.id;
    const existing = groups.get(key) ?? [];
    existing.push(report);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([fingerprint, reportsInGroup]) => ({
      fingerprint,
      reports: reportsInGroup,
      totalCount: reportsInGroup.reduce((sum, report) => sum + (report.reportCount ?? 1), 0),
      category: reportsInGroup[0]?.failureCategory ?? 'other',
    }))
    .sort((left, right) => right.totalCount - left.totalCount);
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function checkRateLimit(ipHash: string): { allowed: boolean; remaining: number } {
  if (process.env.NODE_ENV !== 'production') {
    return { allowed: true, remaining: RATE_LIMIT_MAX };
  }

  const now = Date.now();
  const entry = rateLimitMap.get(ipHash);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ipHash, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

export function addToStressTest(rawInput: string): void {
  if (process.env.VERCEL) return;
  const curatedPath = path.resolve(process.cwd(), 'scripts/data/real_citations_curated.json');
  let curated: string[] = [];
  if (fs.existsSync(curatedPath)) {
    curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8')) as string[];
  }
  if (!curated.includes(rawInput)) {
    curated.push(rawInput);
    const dir = path.dirname(curatedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(curatedPath, JSON.stringify(curated, null, 2), 'utf8');
  }
}
