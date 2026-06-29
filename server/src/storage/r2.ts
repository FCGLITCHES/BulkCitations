import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config.js';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });
  }
  return s3Client;
}

export interface UploadResult {
  key: string;
  url?: string;
}

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<UploadResult> {
  const input: PutObjectCommandInput = {
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  };
  await getS3Client().send(new PutObjectCommand(input));
  return { key };
}

export async function downloadFromR2(key: string): Promise<Buffer> {
  const response = await getS3Client().send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
  );
  if (!response.Body) throw new Error(`R2: empty body for key ${key}`);
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteFromR2(key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
  );
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key });
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
}

/**
 * R2 is available only when credentials are configured.
 * In development/test without credentials, operations are no-ops.
 */
export function isR2Available(): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}
