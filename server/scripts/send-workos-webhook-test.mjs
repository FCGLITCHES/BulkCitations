/**
 * Sends a signed WorkOS-style `user.deleted` webhook to the local API.
 *
 * Prerequisites:
 *   - Server running (`pnpm dev` in server/) with WORKOS_WEBHOOK_SECRET set (same as in .env)
 *   - Optional: WORKOS_API_KEY (defaults to placeholder; only used to construct the WorkOS client)
 *
 * Usage (from repo root):
 *   pnpm -C server exec node scripts/send-workos-webhook-test.mjs
 *
 * Override target:
 *   WEBHOOK_TEST_URL=http://127.0.0.1:3001 pnpm -C server exec node scripts/send-workos-webhook-test.mjs
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkOS } from '@workos-inc/node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });

const secret = process.env.WORKOS_WEBHOOK_SECRET;
if (!secret || secret.trim() === '') {
  console.error('Set WORKOS_WEBHOOK_SECRET in .env (use the signing secret from the WorkOS webhook endpoint).');
  process.exit(1);
}

const base = (process.env.WEBHOOK_TEST_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const workos = new WorkOS(process.env.WORKOS_API_KEY ?? 'sk_test_placeholder');

/** Minimal payload matching WorkOS webhook JSON (snake_case). */
const eventPayload = {
  id: 'event_test_local',
  event: 'user.deleted',
  data: {
    object: 'user',
    id: 'user_test_workos_webhook',
    email: 'local-test@example.com',
    email_verified: false,
    first_name: 'Local',
    last_name: 'Test',
    profile_picture_url: null,
    metadata: {},
    last_sign_in_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    external_id: null,
  },
  created_at: new Date().toISOString(),
};

const bodyStr = JSON.stringify(eventPayload);
const ts = Date.now();
const sig = await workos.webhooks.computeSignature(ts, eventPayload, secret);

const res = await fetch(`${base}/webhooks/workos`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'workos-signature': `t=${ts}, v1=${sig}`,
  },
  body: bodyStr,
});

const text = await res.text();
console.log(`HTTP ${res.status}`, text);
process.exit(res.ok ? 0 : 1);
