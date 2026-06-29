/**
 * Grant global admin in Postgres for an existing user row (matched by email).
 *
 * After you create a Clerk user and sign in once (so `users` + `identity_links` exist), run:
 *
 *   pnpm --dir server run set-admin -- you@example.com
 *
 * Requires repo-root `.env` with `DATABASE_URL` (same as the API).
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../src/db/connection.js';
import { users } from '../src/db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });

const emailRaw = process.argv[2]?.trim();
if (!emailRaw) {
  console.error('Usage: pnpm --dir server run set-admin -- <email>');
  process.exit(1);
}

const email = emailRaw.toLowerCase();

async function main() {
  const updated = await db
    .update(users)
    .set({ isAdmin: true, updatedAt: new Date() })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email });

  if (updated.length === 0) {
    console.error(
      `No user with email matching "${email}". Sign in once with Clerk so the account is synced, then retry.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('Admin granted:', updated[0]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDb();
  });
