import { env } from '../config.js';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import {
  consumeEnrichmentUsage,
  consumeUsage,
  countActiveB2bJobsForScope,
  countActiveB2bJobsGlobal,
  countActiveJobsForNonB2bScope,
  getEnrichmentUsageForDay,
  getUsageForDay,
} from './persistence.js';

// Inline Phase 8 enrichment is a Pro feature. Free/anonymous identities get a one-time trial of
// up to 10 enriched references TOTAL (lifetime, not per day); paid tiers are unlimited. Bulk
// enrichment (a batch larger than the remaining free allowance) is Pro-only. The lifetime
// counter reuses the date-scoped usage ledger via a fixed sentinel period.
export const FREE_ENRICHMENT_LIFETIME_REFS = 10;
const ENRICHMENT_LIFETIME_PERIOD = '1970-01-01';

const DAILY_REF_LIMITS = {
  anonymous: 10,
  free: 50,
  pro: 10_000,
  b2b: env.B2B_DAILY_REF_LIMIT,
} as const;

const CONCURRENT_JOB_LIMITS = {
  anonymous: 1,
  free: 2,
  pro: 10,
  b2b: env.B2B_ORG_CONCURRENT_JOB_LIMIT,
} as const;

export type RuntimeTier = keyof typeof DAILY_REF_LIMITS;

export async function enforceReferenceQuota(
  refCount: number,
  tier: RuntimeTier = 'free',
  opts?: {
    bypassQuota?: boolean;
    userId?: string;
    orgId?: string;
    apiKeyId?: string;
  },
): Promise<void> {
  if (opts?.bypassQuota) {
    return;
  }

  const limit = DAILY_REF_LIMITS[tier];
  const usageScope = {
    ...(tier === 'b2b' && opts?.orgId ? { orgId: opts.orgId } : {}),
    ...(tier !== 'b2b' && opts?.userId ? { userId: opts.userId } : {}),
    ...(tier !== 'b2b' && !opts?.userId && opts?.apiKeyId ? { apiKeyId: opts.apiKeyId } : {}),
    ...(tier === 'b2b' && !opts?.orgId && opts?.userId ? { userId: opts.userId } : {}),
    ...(tier === 'b2b' && !opts?.orgId && !opts?.userId && opts?.apiKeyId ? { apiKeyId: opts.apiKeyId } : {}),
  };
  const currentUsage = await getUsageForDay(undefined, usageScope);

  if (currentUsage + refCount > limit) {
    throw new AppError(
      429,
      ErrorCode.QUOTA_EXCEEDED,
      `Daily quota exceeded for ${tier} tier.`,
      {
        tier,
        limit,
        attempted: refCount,
        currentUsage,
      },
    );
  }

  await consumeUsage(refCount, undefined, usageScope);
}

export type EnrichmentAllowanceReason = 'ok' | 'no_identity' | 'over_limit' | 'bulk';
export interface EnrichmentAllowance {
  allowed: boolean;
  reason: EnrichmentAllowanceReason;
  /** null = unlimited (paid tiers). */
  limit: number | null;
  used: number;
  /** null = unlimited (paid tiers). */
  remaining: number | null;
}

/**
 * Whether inline enrichment is permitted for a request of `refCount` references. Pro/b2b are
 * unlimited; free/anonymous get a lifetime trial of FREE_ENRICHMENT_LIFETIME_REFS references and
 * a batch larger than their remaining allowance is treated as bulk (Pro-only).
 */
export async function checkEnrichmentAllowance(
  tier: RuntimeTier,
  refCount: number,
  opts?: { userId?: string; apiKeyId?: string },
): Promise<EnrichmentAllowance> {
  if (tier === 'pro' || tier === 'b2b') {
    return { allowed: true, reason: 'ok', limit: null, used: 0, remaining: null };
  }
  const scope = enrichmentScope(opts);
  if (!scope) {
    return { allowed: false, reason: 'no_identity', limit: FREE_ENRICHMENT_LIFETIME_REFS, used: 0, remaining: 0 };
  }
  const used = await getEnrichmentUsageForDay(ENRICHMENT_LIFETIME_PERIOD, scope);
  const remaining = Math.max(0, FREE_ENRICHMENT_LIFETIME_REFS - used);
  if (remaining <= 0) {
    return { allowed: false, reason: 'over_limit', limit: FREE_ENRICHMENT_LIFETIME_REFS, used, remaining: 0 };
  }
  if (refCount > remaining) {
    return { allowed: false, reason: 'bulk', limit: FREE_ENRICHMENT_LIFETIME_REFS, used, remaining };
  }
  return { allowed: true, reason: 'ok', limit: FREE_ENRICHMENT_LIFETIME_REFS, used, remaining };
}

/** Record `refCount` free-tier enriched references against the lifetime trial (no-op for paid). */
export async function consumeEnrichmentUse(
  refCount: number,
  opts?: { userId?: string; apiKeyId?: string },
): Promise<void> {
  const scope = enrichmentScope(opts);
  if (!scope) return;
  await consumeEnrichmentUsage(refCount, ENRICHMENT_LIFETIME_PERIOD, scope);
}

function enrichmentScope(opts?: { userId?: string; apiKeyId?: string }):
  | { userId: string }
  | { apiKeyId: string }
  | undefined {
  if (opts?.userId) return { userId: opts.userId };
  if (opts?.apiKeyId) return { apiKeyId: opts.apiKeyId };
  return undefined;
}

export async function enforceConcurrentJobLimit(
  tier: RuntimeTier = 'free',
  opts?: {
    bypassConcurrent?: boolean;
    userId?: string;
    orgId?: string;
    apiKeyId?: string;
  },
): Promise<void> {
  if (opts?.bypassConcurrent) {
    return;
  }

  if (tier === 'b2b') {
    const scopeKey = resolveB2bScopeKey(opts);
    const [scopedActiveJobs, globalActiveJobs] = await Promise.all([
      countActiveB2bJobsForScope({
        ...(opts?.orgId ? { orgId: opts.orgId } : {}),
        ...(opts?.userId ? { userId: opts.userId } : {}),
        ...(opts?.apiKeyId ? { apiKeyId: opts.apiKeyId } : {}),
      }),
      countActiveB2bJobsGlobal(),
    ]);
    const orgLimit = CONCURRENT_JOB_LIMITS.b2b;
    const globalLimit = env.B2B_GLOBAL_CONCURRENT_JOB_LIMIT;

    if (scopedActiveJobs >= orgLimit) {
      throw new AppError(
        429,
        ErrorCode.CONCURRENT_JOB_LIMIT,
        `Maximum ${orgLimit} concurrent async jobs for this organization.`,
        {
          tier,
          limit: orgLimit,
          activeJobs: scopedActiveJobs,
          scope: scopeKey,
        },
      );
    }

    if (globalActiveJobs >= globalLimit) {
      throw new AppError(
        429,
        ErrorCode.CONCURRENT_JOB_LIMIT,
        `Maximum ${globalLimit} concurrent async jobs across all B2B organizations.`,
        {
          tier,
          limit: globalLimit,
          activeJobs: globalActiveJobs,
          scope: 'b2b_global',
        },
      );
    }

    return;
  }

  const limit = CONCURRENT_JOB_LIMITS[tier];
  const scopeKey = resolveNonB2bScopeKey(opts);
  const tierActiveJobs = await countActiveJobsForNonB2bScope(tier, {
    ...(opts?.userId ? { userId: opts.userId } : {}),
    ...(opts?.apiKeyId ? { apiKeyId: opts.apiKeyId } : {}),
  });

  if (tierActiveJobs >= limit) {
    throw new AppError(
      429,
      ErrorCode.CONCURRENT_JOB_LIMIT,
      `Maximum ${limit} concurrent async jobs for ${tier} tier.`,
      {
        tier,
        limit,
        activeJobs: tierActiveJobs,
        scope: scopeKey,
      },
    );
  }
}

function resolveNonB2bScopeKey(input: {
  userId?: string;
  apiKeyId?: string;
} | undefined): string {
  if (input?.userId) return `user:${input.userId}`;
  if (input?.apiKeyId) return `apiKey:${input.apiKeyId}`;
  return 'anonymous:shared';
}

function resolveB2bScopeKey(input: {
  userId?: string;
  orgId?: string;
  apiKeyId?: string;
} | undefined): string {
  if (input?.orgId) return `org:${input.orgId}`;
  if (input?.userId) return `user:${input.userId}`;
  if (input?.apiKeyId) return `apiKey:${input.apiKeyId}`;
  return 'b2b:unscoped';
}
