import { createSecretKey } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { env } from '../config.js';
import type { StoredJob } from './store.js';
import { attachAuditOrgContext } from '../middleware/auth.js';

const JOB_ACCESS_HEADER = 'x-job-access-token';
const JOB_ACCESS_QUERY_KEY = 'jobAccessToken';
const JOB_ACCESS_AUDIENCE = 'engine-job-access';
const JOB_ACCESS_ISSUER = 'bulkreferences-engine';
const JOB_ACCESS_TTL = '7d';
const jobAccessSecret = createSecretKey(Buffer.from(env.SESSION_SECRET, 'utf8'));

type JobAccessRequest = FastifyRequest & {
  userId?: string;
  apiKeyId?: string;
  auditOrgId?: string;
};

export async function issueJobAccessToken(jobId: string): Promise<string> {
  return new SignJWT({ jobId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(JOB_ACCESS_AUDIENCE)
    .setIssuer(JOB_ACCESS_ISSUER)
    .setSubject(jobId)
    .setIssuedAt()
    .setExpirationTime(JOB_ACCESS_TTL)
    .sign(jobAccessSecret);
}

export async function assertJobAccess(
  req: FastifyRequest,
  job: StoredJob,
): Promise<void> {
  if (await requestOwnsJob(req as JobAccessRequest, job)) {
    return;
  }

  const accessToken = readJobAccessToken(req);
  if (accessToken && await verifyJobAccessToken(accessToken, job.id)) {
    return;
  }

  throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${job.id} was not found.`);
}

export function readJobAccessToken(req: FastifyRequest): string | null {
  const headerValue = req.headers[JOB_ACCESS_HEADER];
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  if (Array.isArray(headerValue) && typeof headerValue[0] === 'string' && headerValue[0].trim().length > 0) {
    return headerValue[0].trim();
  }

  const query = req.query as Record<string, unknown> | undefined;
  const queryValue = query?.[JOB_ACCESS_QUERY_KEY];
  return typeof queryValue === 'string' && queryValue.trim().length > 0
    ? queryValue.trim()
    : null;
}

export function buildJobAccessHeaders(jobAccessToken: string | null | undefined): Record<string, string> {
  return typeof jobAccessToken === 'string' && jobAccessToken.trim().length > 0
    ? { [JOB_ACCESS_HEADER]: jobAccessToken }
    : {};
}

async function requestOwnsJob(req: JobAccessRequest, job: StoredJob): Promise<boolean> {
  const requestUserId = req.userId?.trim();
  if (requestUserId && job.userId && requestUserId === job.userId) {
    return true;
  }

  const requestApiKeyId = req.apiKeyId?.trim();
  if (requestApiKeyId && job.apiKeyId && requestApiKeyId === job.apiKeyId) {
    return true;
  }

  await attachAuditOrgContext(req);
  const requestOrgId = req.auditOrgId?.trim();
  return Boolean(requestOrgId && job.orgId && requestOrgId === job.orgId);
}

async function verifyJobAccessToken(token: string, expectedJobId: string): Promise<boolean> {
  try {
    const verified = await jwtVerify(token, jobAccessSecret, {
      audience: JOB_ACCESS_AUDIENCE,
      issuer: JOB_ACCESS_ISSUER,
      subject: expectedJobId,
    });
    return verified.payload.jobId === expectedJobId;
  } catch {
    return false;
  }
}
