import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config.js';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_MAX_CONNECTIONS,
  idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
  ...(env.DATABASE_SSL_MODE === 'disable'
    ? {}
    : {
        ssl: env.DATABASE_SSL_MODE === 'require'
          ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED }
          : undefined,
      }),
});

// Idle clients can still receive FATAL errors (e.g. Postgres 57P01 after Docker restart,
// Neon suspend, or admin terminate). Without this handler, the process crashes.
pool.on('error', (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err !== null && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  console.error('[db] PostgreSQL pool error:', message, code ? `(${code})` : '');
});

export const db = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}
