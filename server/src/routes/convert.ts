import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { recordAuditEvent } from '../audit/recordAudit.js';
import { phase1Ingest } from '../engine/phases/phase1Ingest.js';
import { attachAuditOrgContext } from '../middleware/auth.js';
import type { ConvertRequest } from '../engine/types/api.js';
import type { PipelineOptions } from '../engine/types/pipeline.js';
import {
  ENGINE_CITATION_STYLES,
  engineConvertSourceTypeSchema,
  engineCitationStyleSchema,
  engineParseProfileSchema,
} from '../engine/types/runtime-enums.js';
import { createPipelineDependencies } from '../pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../pipeline/orchestrator.js';
import { queueRuntimeJob, storeCompletedJob, type RuntimeJobOwner } from '../jobs/runtime.js';
import { issueJobAccessToken } from '../runtime/jobAccess.js';
import { emitEnrichmentBioCandidates } from '../training/enrichmentBioCandidates.js';
import {
  checkEnrichmentAllowance,
  consumeEnrichmentUse,
  type EnrichmentAllowance,
  enforceConcurrentJobLimit,
  enforceReferenceQuota,
  FREE_ENRICHMENT_LIFETIME_REFS,
  type RuntimeTier,
} from '../runtime/guardrails.js';
import { getCorrelationId } from '../runtime/requestContext.js';
import { CITATION_TEXT_INPUT_MAX_CHARS, JSON_BODY_LIMIT_BYTES } from './requestLimits.js';

const convertRequestSchema = z.object({
  sourceType: engineConvertSourceTypeSchema,
  content: z.string().min(1).max(CITATION_TEXT_INPUT_MAX_CHARS),
  outputStyle: engineCitationStyleSchema.optional(),
  options: z.object({
    parseProfile: engineParseProfileSchema.optional(),
    enrich: z.boolean().optional(),
    dedup: z.boolean().optional(),
    groupDuplicates: z.boolean().optional(),
    debug: z.boolean().optional(),
  }).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

interface TimingEntry {
  name: string;
  durationMs: number;
}

function adminGuardrailOpts(req: FastifyRequest) {
  const isAdmin = Boolean((req as FastifyRequest & { isAdmin?: boolean }).isAdmin);
  return { bypassQuota: isAdmin, bypassConcurrent: isAdmin };
}

function buildGuardrailScope(
  owner: RuntimeJobOwner,
  guard: ReturnType<typeof adminGuardrailOpts>,
): {
  bypassQuota?: boolean;
  bypassConcurrent?: boolean;
  userId?: string;
  orgId?: string;
  apiKeyId?: string;
} {
  return {
    ...(guard.bypassQuota ? { bypassQuota: true } : {}),
    ...(guard.bypassConcurrent ? { bypassConcurrent: true } : {}),
    ...(owner.userId ? { userId: owner.userId } : {}),
    ...(owner.orgId ? { orgId: owner.orgId } : {}),
    ...(owner.apiKeyId ? { apiKeyId: owner.apiKeyId } : {}),
  };
}

/** `optionalAuth` runs as a scoped `preHandler` before these routes (including multipart). */
function logAdminGuardrailBypass(
  req: FastifyRequest,
  methodPath: string,
  guard: { bypassQuota: boolean; bypassConcurrent: boolean },
): void {
  if (!guard.bypassQuota && !guard.bypassConcurrent) return;
  const userId = (req as FastifyRequest & { userId?: string }).userId ?? 'anonymous';
  req.log.debug({ userId, route: methodPath }, `[admin-bypass] activated for userId=${userId} on ${methodPath}`);
}

function emitGuardrailAuditEvent(
  req: FastifyRequest,
  route: string,
  error: AppError,
  tier: RuntimeTier,
  refCount: number,
  scope: {
    userId?: string;
    orgId?: string;
    apiKeyId?: string;
  },
): void {
  const actorUserId = (req as FastifyRequest & { userId?: string }).userId ?? null;
  void recordAuditEvent({
    actorUserId,
    action: 'guardrail.rejected',
    resource: route,
    correlationId: getCorrelationId(),
    statusCode: error.statusCode,
    metadata: {
      code: error.code,
      tier,
      refCount,
      scope,
      details: error.details ?? null,
    },
  });
}

async function enforceReferenceQuotaWithAudit(
  req: FastifyRequest,
  route: string,
  tier: RuntimeTier,
  refCount: number,
  scope: {
    bypassQuota?: boolean;
    bypassConcurrent?: boolean;
    userId?: string;
    orgId?: string;
    apiKeyId?: string;
  },
): Promise<void> {
  try {
    await enforceReferenceQuota(refCount, tier, scope);
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.QUOTA_EXCEEDED) {
      emitGuardrailAuditEvent(req, route, error, tier, refCount, scope);
    }
    throw error;
  }
}

async function enforceConcurrentWithAudit(
  req: FastifyRequest,
  route: string,
  tier: RuntimeTier,
  refCount: number,
  scope: {
    bypassQuota?: boolean;
    bypassConcurrent?: boolean;
    userId?: string;
    orgId?: string;
    apiKeyId?: string;
  },
): Promise<void> {
  try {
    await enforceConcurrentJobLimit(tier, scope);
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.CONCURRENT_JOB_LIMIT) {
      emitGuardrailAuditEvent(req, route, error, tier, refCount, scope);
    }
    throw error;
  }
}

export async function convertRoute(app: FastifyInstance): Promise<void> {
  app.post('/convert', { bodyLimit: JSON_BODY_LIMIT_BYTES }, async (req, reply) => {
    const emitServerTiming = diagnosticsRequested(req);
    const timingEntries: TimingEntry[] = [];
    const tier = resolveRequestTier(req);
    const guard = adminGuardrailOpts(req);
    logAdminGuardrailBypass(req, 'POST /convert', guard);
    const validationStarted = performance.now();
    const parsed = convertRequestSchema.safeParse(req.body);
    recordTiming(timingEntries, 'validation', validationStarted);

    if (!parsed.success) {
      if (emitServerTiming) addServerTiming(reply, timingEntries);
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'Convert request payload is invalid.',
        { issues: parsed.error.flatten() },
      );
    }

    const outputStyle = parsed.data.outputStyle ?? 'apa7';
    await measureTiming(timingEntries, 'audit_org', () => attachAuditOrgContext(req));
    const owner = resolveRuntimeJobOwner(req, tier);
    const guardrailScope = buildGuardrailScope(owner, guard);
    const enrichIdentity = {
      ...(owner.userId ? { userId: owner.userId } : {}),
      ...(owner.apiKeyId ? { apiKeyId: owner.apiKeyId } : {}),
    };
    // Enrichment is gated by reference count (free tier is a 10-reference lifetime trial; bulk is
    // Pro-only), so the allowance is decided AFTER preflight once the count is known. Preflight
    // runs without enrichment; `options`/`request.options` are upgraded below if allowed.
    let options = sanitizeOptions(parsed.data.options, false);
    const request: ConvertRequest = {
      sourceType: parsed.data.sourceType,
      content: parsed.data.content,
      outputStyle,
      ...(options ? { options } : {}),
      ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}),
    };

    const preflightCtx = createPipelineContext({
      outputStyle,
      options: {
        ...(options ?? {}),
        enablePdfCleanup: env.FEATURE_PDF_CLEANUP,
        pdfCleanupMode: 'full',
        llmFallback: env.ENABLE_LLM_FALLBACK,
      },
      tenantContext: {
        tier: tier === 'pro' || tier === 'b2b' ? tier : 'free',
        isAdmin: Boolean((req as FastifyRequest & { isAdmin?: boolean }).isAdmin),
        ...(owner.userId ? { userId: owner.userId } : {}),
        ...(owner.orgId ? { orgId: owner.orgId } : {}),
        ...(owner.apiKeyId ? { apiKeyId: owner.apiKeyId } : {}),
      },
    });
    const envelope = await measureTiming(
      timingEntries,
      'preflight_ingest',
      () => phase1Ingest.run({
        sourceType: request.sourceType,
        content: request.content,
      }, preflightCtx),
    );
    await measureTiming(
      timingEntries,
      'quota_check',
      () => enforceReferenceQuotaWithAudit(
        req,
        'POST /v1/convert',
        tier,
        envelope.estimatedCount,
        guardrailScope,
      ),
    );

    // Now the reference count is known, decide enrichment and upgrade the options if allowed.
    // Live enrichment is behind a kill-switch. With FEATURE_LIVE_ENRICH off (default), inline
    // Phase 8 enrichment never turns on regardless of tier, so production behavior stays
    // byte-identical to today (no live Crossref/OpenAlex traffic, no surprise API cost).
    const enrichAllowance = env.FEATURE_LIVE_ENRICH
      ? await measureTiming(timingEntries, 'enrich_allowance', () =>
          checkEnrichmentAllowance(tier, envelope.estimatedCount, enrichIdentity),
        )
      : ({ allowed: false, reason: 'over_limit', limit: FREE_ENRICHMENT_LIFETIME_REFS, used: 0, remaining: 0 } satisfies EnrichmentAllowance);
    if (enrichAllowance.allowed) {
      options = sanitizeOptions(parsed.data.options, true);
      if (options) request.options = options;
      if (tier !== 'pro' && tier !== 'b2b') {
        await consumeEnrichmentUse(envelope.estimatedCount, enrichIdentity);
      }
    }
    const enrichmentNotice = buildEnrichmentNotice(tier, enrichAllowance, envelope.estimatedCount);
    // Pro/b2b only: once live enrichment is allowed, also turn on post-health recovery so
    // needs_action references are auto-promoted to ready on a verified provider match.
    const enrichRecoveryEnabled = enrichAllowance.allowed && (tier === 'pro' || tier === 'b2b');
    // Carry the flag on the request so queued/async (bulk) jobs run recovery in the worker too
    // (the inline ctx below sets it explicitly).
    if (enrichRecoveryEnabled) {
      request.options = { ...(request.options ?? {}), enrichRecovery: true };
    }

    if (envelope.estimatedCount > env.PIPELINE_SYNC_THRESHOLD) {
      await measureTiming(
        timingEntries,
        'concurrency_check',
        () => enforceConcurrentWithAudit(
          req,
          'POST /v1/convert',
          tier,
          envelope.estimatedCount,
          guardrailScope,
        ),
      );
      const job = await measureTiming(
        timingEntries,
        'enqueue_job',
        () => queueRuntimeJob(request, owner),
      );
      app.log.info({
        jobId: job.jobId,
        estimatedCount: envelope.estimatedCount,
        detectedFormat: envelope.detectedFormat,
        structure: envelope.structure,
        normalizationMeta: envelope.normalizationMeta,
      }, 'Queued convert job');
      if (emitServerTiming) addServerTiming(reply, timingEntries);
      return reply.status(202).send({ ...job, enrichment: enrichmentNotice });
    }

    const ctx = createPipelineContext({
      outputStyle,
      options: {
        ...(options ?? {}),
        enablePdfCleanup: env.FEATURE_PDF_CLEANUP,
        pdfCleanupMode: 'full',
        llmFallback: env.ENABLE_LLM_FALLBACK,
        enrichRecovery: enrichRecoveryEnabled,
      },
      tenantContext: {
        tier: tier === 'pro' || tier === 'b2b' ? tier : 'free',
        isAdmin: Boolean((req as FastifyRequest & { isAdmin?: boolean }).isAdmin),
        ...(owner.userId ? { userId: owner.userId } : {}),
        ...(owner.orgId ? { orgId: owner.orgId } : {}),
        ...(owner.apiKeyId ? { apiKeyId: owner.apiKeyId } : {}),
      },
    });
    // Reuse the phase-1 ingest already computed during preflight (same input + same
    // phase-1-relevant options) so the pipeline does not re-normalize/re-detect the input.
    const precomputedIngest = { envelope, stageLog: preflightCtx.stageLog };
    const artifacts = await measureTiming(
      timingEntries,
      'pipeline',
      () => runConvertPipeline(request, ctx, createPipelineDependencies(), precomputedIngest),
    );
    await measureTiming(
      timingEntries,
      'store_completed_job',
      () => storeCompletedJob(request, artifacts, 'sync', owner, { deferPersistence: true }),
    );
    const { response } = artifacts;
    // Collect BIO-training candidates from any references enrichment auto-recovered (projectable
    // spans only, certification-gated). Best-effort — never fails the conversion.
    const recoveredIds = new Set(ctx.enrichmentRecovery?.recoveredCarrierIds ?? []);
    if (recoveredIds.size > 0) {
      await measureTiming(timingEntries, 'emit_enrichment_bio', () =>
        emitEnrichmentBioCandidates(
          response.references
            .filter((citation) => recoveredIds.has(citation.id))
            .map((citation) => ({
              rawText: citation.raw,
              fields: citation.fields,
              expectedType: citation.referenceType,
            })),
        ),
      );
    }
    const jobAccessToken = await measureTiming(
      timingEntries,
      'issue_job_access_token',
      () => issueJobAccessToken(response.jobId),
    );
    app.log.info({
      jobId: response.jobId,
      detectedFormat: envelope.detectedFormat,
      structure: envelope.structure,
      normalizationMeta: envelope.normalizationMeta,
      countAudit: response.countAudit,
      warnings: response.warnings,
      timings: timingEntries,
      stageTimings: response.processingPath.stageTimings,
      detectionTelemetry: response.diagnostics
        ?.find((entry) => entry.phaseId === 'detection_telemetry')
        ?.details,
    }, 'Completed synchronous convert request');
    if (emitServerTiming) addServerTiming(reply, timingEntries);
    return reply.status(200).send({
      ...response,
      jobAccessToken,
      enrichment: ctx.enrichmentRecovery
        ? {
            ...enrichmentNotice,
            recoveryAttempted: ctx.enrichmentRecovery.attempted,
            recovered: ctx.enrichmentRecovery.enriched,
            recoverySkipped: ctx.enrichmentRecovery.skipped,
          }
        : enrichmentNotice,
    });
  });

  app.post('/convert/upload', async (req, reply) => {
    const tier = resolveRequestTier(req);
    const guard = adminGuardrailOpts(req);
    logAdminGuardrailBypass(req, 'POST /convert/upload', guard);
    const { content, fields } = await readMultipartTextUpload(req);
    if (!content) {
      throw new AppError(400, ErrorCode.INGEST_EMPTY_INPUT, 'Uploaded file produced no usable text.');
    }

    const outputStyle = readMultipartValue(fields.outputStyle) ?? 'apa7';
    await attachAuditOrgContext(req);
    const owner = resolveRuntimeJobOwner(req, tier);
    const guardrailScope = buildGuardrailScope(owner, guard);
    const request: ConvertRequest = {
      sourceType: isDoiListContent(content) ? 'doi_list' : 'text',
      content,
      outputStyle: normalizeUploadStyle(outputStyle),
      options: {
        parseProfile: 'core_parse_full',
      },
    };

    const preflightCtx = createPipelineContext({
      outputStyle: request.outputStyle ?? 'apa7',
      options: {
        enablePdfCleanup: env.FEATURE_PDF_CLEANUP,
        pdfCleanupMode: 'full',
        llmFallback: env.ENABLE_LLM_FALLBACK,
      },
      tenantContext: {
        tier: tier === 'pro' || tier === 'b2b' ? tier : 'free',
        isAdmin: Boolean((req as FastifyRequest & { isAdmin?: boolean }).isAdmin),
        ...(owner.userId ? { userId: owner.userId } : {}),
        ...(owner.orgId ? { orgId: owner.orgId } : {}),
        ...(owner.apiKeyId ? { apiKeyId: owner.apiKeyId } : {}),
      },
    });
    const envelope = await phase1Ingest.run({
      sourceType: request.sourceType,
      content: request.content,
    }, preflightCtx);
    await enforceReferenceQuotaWithAudit(
      req,
      'POST /v1/convert/upload',
      tier,
      envelope.estimatedCount,
      guardrailScope,
    );
    await enforceConcurrentWithAudit(
      req,
      'POST /v1/convert/upload',
      tier,
      envelope.estimatedCount,
      guardrailScope,
    );

    const job = await queueRuntimeJob(request, owner);
    app.log.info({
      jobId: job.jobId,
      estimatedCount: envelope.estimatedCount,
      detectedFormat: envelope.detectedFormat,
      structure: envelope.structure,
      normalizationMeta: envelope.normalizationMeta,
    }, 'Queued upload convert job');
    return reply.status(202).send(job);
  });
}

function resolveRequestTier(req: FastifyRequest): RuntimeTier {
  const tier = (req as FastifyRequest & { tier?: unknown }).tier;
  return tier === 'anonymous' || tier === 'free' || tier === 'pro' || tier === 'b2b'
    ? tier
    : 'anonymous';
}

function resolveRuntimeJobOwner(req: FastifyRequest, tier: RuntimeTier): RuntimeJobOwner {
  const request = req as FastifyRequest & {
    userId?: string;
    auditOrgId?: string;
    apiKeyId?: string;
    isAdmin?: boolean;
  };
  const effectiveTier: RuntimeTier = request.isAdmin ? 'b2b' : tier;

  return {
    ...(request.userId ? { userId: request.userId } : {}),
    ...(request.auditOrgId ? { orgId: request.auditOrgId } : {}),
    ...(request.apiKeyId ? { apiKeyId: request.apiKeyId } : {}),
    tier: effectiveTier,
  };
}

/** User-facing notice describing whether enrichment ran and the free-trial state. */
function buildEnrichmentNotice(tier: RuntimeTier, allowance: EnrichmentAllowance, refCount: number): {
  applied: boolean;
  tier: 'pro' | 'free';
  reason: EnrichmentAllowance['reason'] | 'free_trial';
  freeReferencesUsed?: number;
  freeReferenceLimit?: number;
  freeReferencesRemaining?: number;
  message: string;
} {
  const paid = tier === 'pro' || tier === 'b2b';
  const limit = allowance.limit ?? FREE_ENRICHMENT_LIFETIME_REFS;
  if (allowance.allowed) {
    if (paid) {
      return { applied: true, tier: 'pro', reason: 'ok', message: 'Enrichment applied.' };
    }
    const usedAfter = allowance.used + refCount;
    return {
      applied: true,
      tier: 'free',
      reason: 'free_trial',
      freeReferencesUsed: usedAfter,
      freeReferenceLimit: limit,
      freeReferencesRemaining: Math.max(0, limit - usedAfter),
      message: `Enrichment is a Pro feature. You've used ${usedAfter} of your ${limit} free references — `
        + `upgrade to Pro for unlimited enrichment and bulk batches.`,
    };
  }
  if (allowance.reason === 'bulk') {
    return {
      applied: false,
      tier: 'free',
      reason: 'bulk',
      freeReferencesUsed: allowance.used,
      freeReferenceLimit: limit,
      freeReferencesRemaining: allowance.remaining ?? 0,
      message: `Bulk enrichment is a Pro feature. Your free trial has ${allowance.remaining ?? 0} of ${limit} `
        + `references left but this batch needs ${refCount}. Upgrade to Pro to enrich the whole batch.`,
    };
  }
  if (allowance.reason === 'over_limit') {
    return {
      applied: false,
      tier: 'free',
      reason: 'over_limit',
      freeReferencesUsed: allowance.used,
      freeReferenceLimit: limit,
      freeReferencesRemaining: 0,
      message: `You've used all ${limit} free enrichment references. Upgrade to Pro for unlimited enrichment.`,
    };
  }
  return {
    applied: false,
    tier: 'free',
    reason: 'no_identity',
    message: `Enrichment is a Pro feature. Sign in to use your ${limit} free reference enrichments, or upgrade to Pro.`,
  };
}

const SAFE_USER_PARSE_PROFILES = new Set(['core_parse_fast', 'core_parse_full']);

function sanitizeOptions(
  options: z.infer<typeof convertRequestSchema>['options'],
  enrichAllowed = false,
): Partial<PipelineOptions> | undefined {
  // Inline Phase 8 enrichment is tier-gated (see checkEnrichmentAllowance). When allowed, use
  // the full-parse-plus-enrichment profile so only enrichment is layered onto the normal
  // convert behavior. Otherwise the requested profile is honored only if it is a non-enriching
  // core lane, so a client cannot self-select an enrichment/overlay profile to bypass the gate.
  const requestedProfile = options?.parseProfile;
  const sanitized: Partial<PipelineOptions> = {
    parseProfile: enrichAllowed
      ? 'core_parse_full_enrich'
      : requestedProfile && SAFE_USER_PARSE_PROFILES.has(requestedProfile)
        ? requestedProfile
        : 'core_parse_full',
    enrich: enrichAllowed,
  };

  if (options?.dedup !== undefined) sanitized.dedup = options.dedup;
  if (options?.groupDuplicates !== undefined) sanitized.groupDuplicates = options.groupDuplicates;
  if (options?.debug !== undefined) sanitized.debug = options.debug;

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function diagnosticsRequested(req: FastifyRequest): boolean {
  const header = req.headers['x-bulkrefs-diagnostics'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return true;
  }
  return req.url.includes('diagnostics=timing');
}

async function measureTiming<T>(
  entries: TimingEntry[] | null,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    recordTiming(entries, name, started);
  }
}

function recordTiming(entries: TimingEntry[] | null, name: string, started: number): void {
  if (!entries) return;
  entries.push({
    name,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
  });
}

function addServerTiming(
  reply: FastifyReply,
  entries: TimingEntry[] | null,
): void {
  if (!entries || entries.length === 0) return;
  reply.header(
    'server-timing',
    entries
      .map((entry) => `${entry.name};dur=${entry.durationMs}`)
      .join(', '),
  );
}

function isDoiListContent(content: string): boolean {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^10\.\d{4,9}\/\S+$/i.test(line));
}

function normalizeUploadStyle(value: string): NonNullable<ConvertRequest['outputStyle']> {
  return engineCitationStyleSchema.safeParse(value).success
    ? value as NonNullable<ConvertRequest['outputStyle']>
    : 'apa7';
}

function readMultipartValue(field: unknown): string | undefined {
  const candidate = Array.isArray(field) ? field[0] : field;
  if (candidate && typeof candidate === 'object' && 'value' in candidate) {
    const value = (candidate as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

async function readMultipartTextUpload(
  req: FastifyRequest,
): Promise<{ content: string; fields: Record<string, unknown> }> {
  try {
    const file = await req.file();

    if (!file) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'A multipart file is required.');
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of file.file) {
      const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += nextChunk.byteLength;
      if (totalBytes > env.UPLOAD_MAX_BYTES) {
        throw new AppError(
          413,
          ErrorCode.INGEST_FILE_TOO_LARGE,
          `Uploaded file exceeded the ${env.UPLOAD_MAX_BYTES}-byte limit.`,
        );
      }
      chunks.push(nextChunk);
    }

    if (file.file.truncated) {
      throw new AppError(
        413,
        ErrorCode.INGEST_FILE_TOO_LARGE,
        `Uploaded file exceeded the ${env.UPLOAD_MAX_BYTES}-byte limit.`,
      );
    }

    return {
      content: Buffer.concat(chunks).toString('utf8'),
      fields: file.fields as Record<string, unknown>,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (isMalformedMultipartError(error)) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Malformed multipart upload.');
    }
    throw error;
  }
}

function isMalformedMultipartError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  const message = error.message.toLowerCase();
  return code === 'ERR_STREAM_PREMATURE_CLOSE'
    || message.includes('premature close')
    || message.includes('multipart')
    || message.includes('boundary');
}
