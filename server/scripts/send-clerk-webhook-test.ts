/**
 * Sends a Svix-signed Clerk-style `user.deleted` webhook to the local API.
 *
 * Prerequisites:
 *   - Server running with CLERK_WEBHOOK_SECRET in repo-root `.env` (Clerk → Webhooks → Signing secret)
 *
 *   pnpm -C server test:webhook-clerk
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSvixWebhookFromWhsec } from '../src/auth/svixWebhook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });

const secret = process.env.CLERK_WEBHOOK_SECRET;
if (!secret || secret.trim() === '') {
  console.error('Set CLERK_WEBHOOK_SECRET in .env (Clerk → Webhooks → endpoint → Signing secret).');
  process.exit(1);
}

const base = (process.env.WEBHOOK_TEST_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

let wh;
try {
  wh = createSvixWebhookFromWhsec(secret);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const eventPayload = {
  object: 'event',
  type: 'user.deleted',
  data: {
    id: 'user_test_clerk_webhook',
    object: 'user',
    deleted: true,
  },
};

const bodyStr = JSON.stringify(eventPayload);
const msgId = `msg_${randomUUID()}`;
const ts = new Date();
const svixSignature = wh.sign(msgId, ts, bodyStr);

const res = await fetch(`${base}/webhooks/clerk`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'svix-id': msgId,
    'svix-timestamp': String(Math.floor(ts.getTime() / 1000)),
    'svix-signature': svixSignature,
  },
  body: bodyStr,
});

const text = await res.text();
console.log(`HTTP ${res.status}`, text);
process.exit(res.ok ? 0 : 1);
