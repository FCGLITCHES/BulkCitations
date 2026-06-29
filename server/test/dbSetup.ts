import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const TEST_DB_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000001';

process.env.NODE_ENV = 'test';
process.env.PERSISTENCE_BACKEND = 'database';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:5432/bulkreferences_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.PORT ??= '3001';
process.env.RATE_LIMIT_MAX ??= '100';
process.env.RATE_LIMIT_WINDOW_MS ??= '60000';
process.env.CROSSREF_TIMEOUT_MS ??= '200';
process.env.OPENALEX_TIMEOUT_MS ??= '200';
process.env.OPENAI_TIMEOUT_MS ??= '200';
process.env.RETRACTION_WATCH_TIMEOUT_MS ??= '200';
process.env.ML_SERVICE_TIMEOUT_MS ??= '200';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '..', 'src', 'db', 'migrations');

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function ensureTestDatabase(databaseUrl: string) {
  const target = new URL(databaseUrl);
  const databaseName = target.pathname.replace(/^\//, '');
  if (!databaseName) {
    throw new Error('DATABASE_URL must include a database name for DB-backed tests.');
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL!;
  await ensureTestDatabase(databaseUrl);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    const migrationDb = drizzle(pool);
    await migrate(migrationDb, { migrationsFolder });
    await pool.query(
      `
        INSERT INTO users (id, email, password_hash, name, tier, is_admin, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `,
      [
        TEST_DB_ADMIN_USER_ID,
        'test-admin@bulkreferences.local',
        'test-password-hash',
        'Test Admin',
        'pro',
        true,
      ],
    );
  } finally {
    await pool.end();
  }
}, 60_000);
