import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface MigrationLogEntry {
  key: string;
  sourcePath: string;
  completedAt: string;
  stats: {
    migrated: number;
    skipped: number;
    failed: number;
  };
}

export function getDataDir(): string {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    const workerId = process.env.VITEST_POOL_ID ?? process.pid.toString();
    return path.resolve(process.cwd(), 'tmp', 'vitest-data', workerId);
  }
  return process.env.VERCEL
    ? '/tmp'
    : path.resolve(process.cwd(), 'data');
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function resolveDataFile(fileName: string): string {
  return path.join(ensureDataDir(), fileName);
}

export function stableFileMigrationKey(sourcePath: string): string {
  const normalized = path.resolve(sourcePath).toLowerCase();
  return `jsonl:${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

export function readJsonlFile<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch (error) {
        console.warn(`[persistence] Skipping malformed JSONL row in ${filePath}:`, error instanceof Error ? error.message : String(error));
        return [];
      }
    });
}

export function appendJsonlFile<T>(filePath: string, row: T): void {
  ensureDataDir();
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

export function writeJsonlFile<T>(filePath: string, rows: T[]): void {
  ensureDataDir();
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''),
    'utf8',
  );
}

export function readMigrationLog(filePath: string): MigrationLogEntry[] {
  return readJsonlFile<MigrationLogEntry>(filePath);
}

export function appendMigrationLog(filePath: string, entry: MigrationLogEntry): void {
  appendJsonlFile(filePath, entry);
}
