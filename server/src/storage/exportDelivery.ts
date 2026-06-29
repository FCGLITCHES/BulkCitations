import { env } from '../config.js';
import type { StoredExport } from '../runtime/store.js';
import { getPresignedDownloadUrl, isR2Available, uploadToR2 } from './r2.js';

export async function finalizeExportDelivery(jobId: string, artifact: StoredExport): Promise<StoredExport> {
  const sizeBytes = artifact.sizeBytes ?? resolveExportSizeBytes(artifact.content);
  const withSize = {
    ...artifact,
    sizeBytes,
    delivery: artifact.delivery ?? 'inline',
  } satisfies StoredExport;

  if (!shouldOffloadExport(withSize)) {
    return withSize;
  }

  const content = withSize.content;
  if (content == null) {
    return refreshSignedExport(withSize);
  }

  const storageKey = `exports/${jobId}/${withSize.fileName}`;
  await uploadToR2(storageKey, content, withSize.contentType);
  const signedUrl = await getPresignedDownloadUrl(storageKey, env.EXPORT_R2_SIGNED_URL_TTL_SECONDS);
  const { content: _content, ...withoutInlineContent } = withSize;

  return {
    ...withoutInlineContent,
    delivery: 'signed_url',
    storageKey,
    downloadUrl: signedUrl,
    expiresAt: new Date(Date.now() + env.EXPORT_R2_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function refreshSignedExport(artifact: StoredExport): Promise<StoredExport> {
  if (artifact.delivery !== 'signed_url' || !artifact.storageKey) {
    return artifact;
  }

  const signedUrl = await getPresignedDownloadUrl(artifact.storageKey, env.EXPORT_R2_SIGNED_URL_TTL_SECONDS);
  return {
    ...artifact,
    downloadUrl: signedUrl,
    expiresAt: new Date(Date.now() + env.EXPORT_R2_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

function shouldOffloadExport(artifact: StoredExport): boolean {
  return env.EXPORT_R2_OFFLOAD_ENABLED
    && isR2Available()
    && (artifact.sizeBytes ?? 0) >= env.EXPORT_R2_OFFLOAD_THRESHOLD_BYTES;
}

function resolveExportSizeBytes(content: StoredExport['content']): number {
  if (typeof content === 'string') {
    return Buffer.byteLength(content);
  }
  if (Buffer.isBuffer(content)) {
    return content.byteLength;
  }
  return 0;
}
