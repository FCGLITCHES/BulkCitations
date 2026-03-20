import { createHmac } from 'node:crypto';
import type { V2ExportFormat } from '@shared/schema';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_SECRET = 'dev-only-v2-export-secret';

function getSecret(): string {
  return process.env.V2_EXPORT_SIGNING_SECRET || process.env.SESSION_SECRET || DEFAULT_SECRET;
}

export function buildSignedExportUrl(jobId: string, format: V2ExportFormat, now = Date.now()): string {
  const expires = now + DEFAULT_TTL_MS;
  const payload = `${jobId}:${format}:${expires}`;
  const signature = createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `/api/v2/jobs/${jobId}/export?format=${format}&expires=${expires}&signature=${signature}`;
}

export function validateSignedExportUrl(jobId: string, format: V2ExportFormat, expires: number, signature: string): boolean {
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  const expected = createHmac('sha256', getSecret()).update(`${jobId}:${format}:${expires}`).digest('hex');
  return signature === expected;
}
