import fs from 'node:fs';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type {
  ApprovedCanonicalFields,
  ApprovedTruthEntry,
  ParsedReference,
  TruthAlias,
  TruthMatchType,
} from '@shared/schema';
import { computeWorkKey } from '../utils/workKey.js';
import { computeFingerprint as computeReportFingerprint } from './reportStore.js';
import {
  appendMigrationLog,
  getDataDir,
  readJsonlFile,
  readMigrationLog,
  resolveDataFile,
  stableFileMigrationKey,
  writeJsonlFile,
} from './persistence.js';
import { getUsableDatabaseUrl } from './databaseUrl.js';

export type TruthEntry = ApprovedTruthEntry;

export interface TruthLookupCandidate {
  fingerprint?: string;
  doi?: string | null;
  workKey?: string | null;
  outputStyle?: string;
}

const LEGACY_TRUTH_FILE = path.join(getDataDir(), 'truthStore.v1.jsonl');
const TRUTH_FILE = resolveDataFile('truthStore.v2.jsonl');
const MIGRATION_LOG_FILE = resolveDataFile('store-migrations.jsonl');

const truthRows = pgTable('approved_truth_versions', {
  truthId: text('truth_id').primaryKey(),
  truthFamilyId: text('truth_family_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  outputStyle: text('output_style').notNull(),
  validatedAt: timestamp('validated_at', { withTimezone: true }).notNull(),
  isActive: boolean('is_active').notNull(),
  payload: jsonb('payload').$type<ApprovedTruthEntry>().notNull(),
});

const truthAliasRows = pgTable('truth_aliases', {
  truthId: text('truth_id').notNull(),
  truthFamilyId: text('truth_family_id').notNull(),
  aliasType: text('alias_type').$type<TruthMatchType>().notNull(),
  aliasValue: text('alias_value').notNull(),
  isActive: boolean('is_active').notNull(),
});

const migrationRows = pgTable('store_migrations', {
  key: text('key').primaryKey(),
  sourcePath: text('source_path').notNull(),
  stats: jsonb('stats').$type<{ migrated: number; skipped: number; failed: number }>().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
});

interface TruthStorage {
  saveTruth(entry: Omit<TruthEntry, 'validatedAt' | 'truthId' | 'truthFamilyId' | 'aliases'> & {
    truthId?: string;
    truthFamilyId?: string;
    aliases?: TruthAlias[];
    validatedAt?: string;
  }): Promise<TruthEntry>;
  listTruths(): Promise<TruthEntry[]>;
}

function canonicalToParsedReference(fields?: ApprovedCanonicalFields): ParsedReference | undefined {
  if (!fields) return undefined;
  return {
    authors: fields.authors?.map((author) => author.literal || (author.first ? `${author.last}, ${author.first}` : author.last)),
    title: fields.title ?? undefined,
    year: fields.year != null ? String(fields.year) : undefined,
    journal: fields.journal ?? undefined,
    volume: fields.volume ?? undefined,
    issue: fields.issue ?? undefined,
    pages: fields.pages ?? undefined,
    doi: fields.doi ?? undefined,
    publisher: fields.publisher ?? undefined,
    url: fields.url ?? undefined,
    conferenceTitle: fields.conferenceTitle ?? undefined,
    bookTitle: fields.bookTitle ?? undefined,
    institution: fields.institution ?? undefined,
    edition: fields.edition ?? undefined,
    editor: fields.editor ?? undefined,
  };
}

function normalizeAliasValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function buildAliases(entry: {
  fingerprint: string;
  correctedFields?: ApprovedCanonicalFields;
  originalEngineOutput?: TruthEntry['originalEngineOutput'];
  aliases?: TruthAlias[];
}): TruthAlias[] {
  const parsed = canonicalToParsedReference(entry.correctedFields) ?? entry.originalEngineOutput?.parsedData;
  const doi = normalizeAliasValue(entry.correctedFields?.doi ?? parsed?.doi ?? null);
  const workKey = parsed ? normalizeAliasValue(computeWorkKey(parsed)) : null;

  const aliases: TruthAlias[] = [
    { aliasType: 'fingerprint', aliasValue: entry.fingerprint },
    ...(doi ? [{ aliasType: 'doi' as const, aliasValue: doi }] : []),
    ...(workKey ? [{ aliasType: 'workKey' as const, aliasValue: workKey }] : []),
    ...(entry.aliases ?? []),
  ];

  const unique = new Map<string, TruthAlias>();
  for (const alias of aliases) {
    unique.set(`${alias.aliasType}:${alias.aliasValue}`, alias);
  }
  return Array.from(unique.values());
}

function hydrateTruth(entry: TruthEntry): TruthEntry {
  return {
    ...entry,
    aliases: buildAliases(entry),
  };
}

function mapLegacyTruth(entry: any): TruthEntry {
  const fingerprint = entry.fingerprint ?? computeReportFingerprint(entry.originalText ?? '');
  const truthId = `legacy-${crypto.createHash('sha256').update(`${fingerprint}:${entry.outputStyle ?? 'apa'}`).digest('hex').slice(0, 16)}`;
  return hydrateTruth({
    truthId,
    truthFamilyId: `family-${fingerprint}`,
    fingerprint,
    originalText: entry.originalText,
    outputStyle: entry.outputStyle,
    validatedOutput: entry.validatedOutput,
    validatedBy: entry.validatedBy,
    validatedAt: entry.validatedAt ?? new Date().toISOString(),
    correctedFields: entry.correctedFields,
    fieldApproval: entry.fieldApproval,
    failureTaxonomy: entry.failureTaxonomy,
    stageBlame: entry.stageBlame,
    duplicateDecision: entry.duplicateDecision,
    originalEngineOutput: entry.originalEngineOutput,
    resolvedByCommit: entry.resolvedByCommit,
    resolvedByVersion: entry.resolvedByVersion,
    staleAfterVersion: entry.staleAfterVersion,
    staleReason: entry.staleReason,
    aliases: entry.aliases,
    sourceReportId: entry.sourceReportId,
  });
}

class FileTruthStore implements TruthStorage {
  private migrationReady = false;

  private ensureLegacyMigration(): void {
    if (this.migrationReady) return;
    this.migrationReady = true;

    if (!fs.existsSync(LEGACY_TRUTH_FILE) || fs.existsSync(TRUTH_FILE)) {
      return;
    }

    const migrationKey = stableFileMigrationKey(LEGACY_TRUTH_FILE);
    const existingLog = readMigrationLog(MIGRATION_LOG_FILE).find((item) => item.key === migrationKey);
    if (existingLog) return;

    const migrated = readJsonlFile<any>(LEGACY_TRUTH_FILE).map(mapLegacyTruth);
    writeJsonlFile(TRUTH_FILE, migrated);
    appendMigrationLog(MIGRATION_LOG_FILE, {
      key: migrationKey,
      sourcePath: LEGACY_TRUTH_FILE,
      completedAt: new Date().toISOString(),
      stats: {
        migrated: migrated.length,
        skipped: 0,
        failed: 0,
      },
    });
  }

  async saveTruth(entry: Omit<TruthEntry, 'validatedAt' | 'truthId' | 'truthFamilyId' | 'aliases'> & {
    truthId?: string;
    truthFamilyId?: string;
    aliases?: TruthAlias[];
    validatedAt?: string;
  }): Promise<TruthEntry> {
    this.ensureLegacyMigration();
    const truths = await this.listTruths();

    const aliases = buildAliases({
      fingerprint: entry.fingerprint,
      correctedFields: entry.correctedFields,
      originalEngineOutput: entry.originalEngineOutput,
      aliases: entry.aliases,
    });

    const existingFamily = truths.find((truth) => truth.aliases?.some((alias) => (
      aliases.some((candidate) => candidate.aliasType === alias.aliasType && candidate.aliasValue === alias.aliasValue)
    )));

    const next = hydrateTruth({
      ...entry,
      truthId: entry.truthId ?? randomUUID(),
      truthFamilyId: entry.truthFamilyId ?? existingFamily?.truthFamilyId ?? `family-${entry.fingerprint}`,
      validatedAt: entry.validatedAt ?? new Date().toISOString(),
      aliases,
    });

    truths.push(next);
    writeJsonlFile(TRUTH_FILE, truths);
    return next;
  }

  async listTruths(): Promise<TruthEntry[]> {
    this.ensureLegacyMigration();
    return readJsonlFile<TruthEntry>(TRUTH_FILE).map(mapLegacyTruth);
  }
}

class PostgresTruthStore implements TruthStorage {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle(neon(connectionString));
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = Promise.all([
        this.db.execute(sql`
          create table if not exists approved_truth_versions (
            truth_id text primary key,
            truth_family_id text not null,
            fingerprint text not null,
            output_style text not null,
            validated_at timestamptz not null,
            is_active boolean not null,
            payload jsonb not null
          )
        `),
        this.db.execute(sql`
          create table if not exists truth_aliases (
            truth_id text not null,
            truth_family_id text not null,
            alias_type text not null,
            alias_value text not null,
            is_active boolean not null
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
    await this.backfillJsonl(TRUTH_FILE);
    await this.backfillJsonl(LEGACY_TRUTH_FILE);
  }

  private async backfillJsonl(sourcePath: string): Promise<void> {
    if (!fs.existsSync(sourcePath)) return;
    const migrationKey = stableFileMigrationKey(sourcePath);
    const existing = await this.db.select().from(migrationRows).where(eq(migrationRows.key, migrationKey)).limit(1);
    if (existing[0]) return;

    const rows = readJsonlFile<any>(sourcePath);
    let migrated = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const truth = mapLegacyTruth(row);
        await this.insertTruth(truth);
        migrated += 1;
      } catch (error) {
        failed += 1;
        console.warn('[truthStore] Migration row failed:', error instanceof Error ? error.message : String(error));
      }
    }

    await this.db.insert(migrationRows).values({
      key: migrationKey,
      sourcePath,
      stats: { migrated, skipped: 0, failed },
      completedAt: new Date(),
    }).onConflictDoNothing();
  }

  private async insertTruth(truth: TruthEntry): Promise<void> {
    await this.db.insert(truthRows).values({
      truthId: truth.truthId,
      truthFamilyId: truth.truthFamilyId,
      fingerprint: truth.fingerprint,
      outputStyle: truth.outputStyle,
      validatedAt: new Date(truth.validatedAt),
      isActive: true,
      payload: truth,
    }).onConflictDoNothing();

    if (truth.aliases?.length) {
      for (const alias of truth.aliases) {
        await this.db.insert(truthAliasRows).values({
          truthId: truth.truthId,
          truthFamilyId: truth.truthFamilyId,
          aliasType: alias.aliasType,
          aliasValue: alias.aliasValue,
          isActive: true,
        }).onConflictDoNothing();
      }
    }
  }

  async saveTruth(entry: Omit<TruthEntry, 'validatedAt' | 'truthId' | 'truthFamilyId' | 'aliases'> & {
    truthId?: string;
    truthFamilyId?: string;
    aliases?: TruthAlias[];
    validatedAt?: string;
  }): Promise<TruthEntry> {
    await this.ensureReady();

    const aliases = buildAliases({
      fingerprint: entry.fingerprint,
      correctedFields: entry.correctedFields,
      originalEngineOutput: entry.originalEngineOutput,
      aliases: entry.aliases,
    });

    const aliasValues = aliases.map((alias) => alias.aliasValue);
    const aliasRows = aliasValues.length > 0
      ? await this.db.select().from(truthAliasRows).where(inArray(truthAliasRows.aliasValue, aliasValues))
      : [];
    const existingFamilyId = entry.truthFamilyId ?? aliasRows[0]?.truthFamilyId ?? `family-${entry.fingerprint}`;

    await this.db.update(truthRows).set({ isActive: false }).where(eq(truthRows.truthFamilyId, existingFamilyId));
    await this.db.update(truthAliasRows).set({ isActive: false }).where(eq(truthAliasRows.truthFamilyId, existingFamilyId));

    const next = hydrateTruth({
      ...entry,
      truthId: entry.truthId ?? randomUUID(),
      truthFamilyId: existingFamilyId,
      validatedAt: entry.validatedAt ?? new Date().toISOString(),
      aliases,
    });

    await this.insertTruth(next);
    return next;
  }

  async listTruths(): Promise<TruthEntry[]> {
    await this.ensureReady();
    const rows = await this.db.select().from(truthRows);
    return rows.map((row) => mapLegacyTruth(row.payload)).sort((left, right) => (
      right.validatedAt.localeCompare(left.validatedAt)
    ));
  }
}

const databaseUrl = getUsableDatabaseUrl();

const truthStorage: TruthStorage = databaseUrl
  ? new PostgresTruthStore(databaseUrl)
  : new FileTruthStore();

export async function loadTruths(): Promise<TruthEntry[]> {
  return truthStorage.listTruths();
}

export async function listActiveTruths(): Promise<TruthEntry[]> {
  const truths = await loadTruths();
  const activeByFamily = new Map<string, TruthEntry>();

  for (const truth of truths.sort((left, right) => right.validatedAt.localeCompare(left.validatedAt))) {
    if (!activeByFamily.has(truth.truthFamilyId)) {
      activeByFamily.set(truth.truthFamilyId, truth);
    }
  }

  return Array.from(activeByFamily.values());
}

export async function saveTruth(entry: Omit<TruthEntry, 'validatedAt' | 'truthId' | 'truthFamilyId' | 'aliases'> & {
  truthId?: string;
  truthFamilyId?: string;
  aliases?: TruthAlias[];
  validatedAt?: string;
}): Promise<TruthEntry> {
  return truthStorage.saveTruth(entry);
}

function isStale(truth: TruthEntry): boolean {
  return Boolean(truth.staleAfterVersion && truth.resolvedByVersion && truth.staleAfterVersion !== truth.resolvedByVersion);
}

function specificityScore(matchType: TruthMatchType): number {
  switch (matchType) {
    case 'fingerprint':
      return 3;
    case 'doi':
      return 2;
    case 'workKey':
      return 1;
    default:
      return 0;
  }
}

export async function findBestTruthMatch(candidate: TruthLookupCandidate): Promise<{
  truth: TruthEntry;
  matchType: TruthMatchType;
} | null> {
  const truths = await listActiveTruths();
  const matches: Array<{ truth: TruthEntry; matchType: TruthMatchType }> = [];

  for (const truth of truths) {
    const aliases = truth.aliases ?? buildAliases(truth);
    if (candidate.fingerprint && aliases.some((alias) => alias.aliasType === 'fingerprint' && alias.aliasValue === candidate.fingerprint)) {
      matches.push({ truth, matchType: 'fingerprint' });
      continue;
    }
    if (candidate.doi && aliases.some((alias) => alias.aliasType === 'doi' && alias.aliasValue === normalizeAliasValue(candidate.doi))) {
      matches.push({ truth, matchType: 'doi' });
      continue;
    }
    if (candidate.workKey && aliases.some((alias) => alias.aliasType === 'workKey' && alias.aliasValue === normalizeAliasValue(candidate.workKey))) {
      matches.push({ truth, matchType: 'workKey' });
    }
  }

  if (matches.length === 0) return null;

  matches.sort((left, right) => {
    const specificityDelta = specificityScore(right.matchType) - specificityScore(left.matchType);
    if (specificityDelta !== 0) return specificityDelta;

    const leftStyleFit = left.truth.outputStyle === candidate.outputStyle && !isStale(left.truth) ? 1 : 0;
    const rightStyleFit = right.truth.outputStyle === candidate.outputStyle && !isStale(right.truth) ? 1 : 0;
    if (rightStyleFit !== leftStyleFit) return rightStyleFit - leftStyleFit;

    return right.truth.validatedAt.localeCompare(left.truth.validatedAt);
  });

  return matches[0] ?? null;
}

export async function getTruth(originalText: string, outputStyle: string): Promise<TruthEntry | undefined> {
  const match = await findBestTruthMatch({
    fingerprint: computeReportFingerprint(originalText),
    outputStyle,
  });
  if (!match) return undefined;
  if (match.matchType !== 'fingerprint') return undefined;
  return match.truth.outputStyle === outputStyle ? match.truth : undefined;
}

export function computeFingerprint(text: string): string {
  return computeReportFingerprint(text);
}
