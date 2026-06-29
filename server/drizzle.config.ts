import { resolve } from 'node:path';
import { config } from 'dotenv';
import type { Config } from 'drizzle-kit';

const parsed = config({ path: resolve(__dirname, '..', '.env') }).parsed ?? {};
const url = parsed['DATABASE_URL'] || process.env['DATABASE_URL'] || '';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
} satisfies Config;
