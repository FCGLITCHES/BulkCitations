import { Webhook } from 'svix';

/**
 * Clerk delivers webhooks via Svix. Signing secrets are `whsec_` + key material (base64 or base64url).
 * The bundled `Webhook` constructor uses a strict base64 decoder that rejects some valid Clerk pastes
 * (whitespace, base64url). Decode with Node and pass raw key bytes (`format: 'raw'`).
 */
export function createSvixWebhookFromWhsec(rawSecret: string): Webhook {
  const cleaned = rawSecret.trim().replace(/^["']|["']$/g, '');
  if (!cleaned.startsWith('whsec_')) {
    throw new Error(
      'CLERK_WEBHOOK_SECRET must start with whsec_ (Clerk Dashboard → Webhooks → Signing secret).',
    );
  }

  const b64 = cleaned.slice(6).replace(/[\s\r\n\u200b]/g, '');
  if (b64.length === 0) {
    throw new Error('CLERK_WEBHOOK_SECRET is empty after whsec_; re-copy from Clerk.');
  }

  const preferUrl = b64.includes('-') || b64.includes('_');
  let buf = Buffer.from(b64, preferUrl ? 'base64url' : 'base64');
  if (buf.length === 0) {
    buf = Buffer.from(b64, preferUrl ? 'base64' : 'base64url');
  }
  if (buf.length === 0) {
    throw new Error(
      'Could not decode CLERK_WEBHOOK_SECRET; re-copy the Signing secret from Clerk (no spaces or line breaks).',
    );
  }

  return new Webhook(new Uint8Array(buf), { format: 'raw' });
}
