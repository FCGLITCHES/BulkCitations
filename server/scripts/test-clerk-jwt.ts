/**
 * Calls a JWT-protected route with a real Clerk session token (not the literal "YOUR_CLERK_JWT").
 *
 * Get a token from the browser (Clerk session) or `await clerk.session?.getToken()` in your app,
 * then:
 *
 *   set CLERK_TEST_JWT=<paste token>
 *   pnpm -C server test:clerk-jwt
 *
 * Or pass as the first argument (PowerShell): pnpm -C server exec tsx scripts/test-clerk-jwt.ts "<token>"
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });

const token = process.argv[2] ?? process.env.CLERK_TEST_JWT;
if (!token || token === 'YOUR_CLERK_JWT' || token.trim() === '') {
  console.error(
    'Set CLERK_TEST_JWT in the environment or pass the JWT as the first argument.\n' +
      'Do not use the placeholder text YOUR_CLERK_JWT — paste a real Clerk session token.',
  );
  process.exit(1);
}

const base = (process.env.WEBHOOK_TEST_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

const res = await fetch(`${base}/v1/keys`, {
  headers: {
    authorization: `Bearer ${token.trim()}`,
  },
});

const text = await res.text();
console.log(`HTTP ${res.status}`, text.slice(0, 500));
process.exit(res.ok ? 0 : 1);
