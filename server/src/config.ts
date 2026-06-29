import { z } from 'zod';

/** Dev-only default; production must set `SESSION_SECRET` in the host environment (never commit real secrets). */
export const DEV_SESSION_SECRET_PLACEHOLDER = 'dev-session-secret-change-in-production';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3111),
  PERSISTENCE_BACKEND: z.enum(['auto', 'database']).default('auto'),
  CORS_ALLOWED_ORIGINS: z.string().default('https://bulkreferences.com,https://www.bulkreferences.com,http://localhost:3000,http://localhost:2397'),

  // Database
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/bulkreferences'),
  DATABASE_SSL_MODE: z.enum(['disable', 'prefer', 'require']).default('prefer'),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.string().default('true').transform((v) => v === 'true' || v === '1'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).default(20),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1).default(30_000),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1).default(5_000),

  // Redis — optional integration/cache URL. The core runtime no longer requires Redis.
  REDIS_URL: z.string().optional(),
  /** Upstash **Redis** connection URL (same as REDIS_URL; prefer pooled `rediss://` from Upstash dashboard). */
  UPSTASH_REDIS_URL: z.string().optional(),
  /** Upstash REST (HTTP) — does not replace the ioredis TCP client; consumed via `getUpstashRest()`. */
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  REDIS_PROVIDER: z.enum(['auto', 'redis', 'upstash']).default('auto'),
  /**
   * queue_first: keep Redis usage minimal — Redis-backed rate limits, provider caches, and the
   *   report-IP limiter stay off (the provider cache is only forced on by FEATURE_LIVE_ENRICH).
   * balanced: also enable Redis-backed rate limits and provider caches.
   * (Auth revocation no longer uses Redis — it runs in-process via in-memory Maps.)
   */
  REDIS_USAGE_MODE: z.enum(['queue_first', 'balanced']).default('queue_first'),

  // OpenAI (LLM repair / Phase 6.5 fallback)
  OPENAI_API_KEY: z.string().optional(),
  /** Chat Completions model id (e.g. gpt-5.4-nano). */
  OPENAI_MODEL: z.string().default('gpt-5.4-nano'),

  // Cloudflare R2
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().default('bulkreferences'),
  R2_PUBLIC_URL: z.string().optional(),
  EXPORT_R2_OFFLOAD_ENABLED: z.string().default('false').transform((v) => v === 'true' || v === '1'),
  EXPORT_R2_OFFLOAD_THRESHOLD_BYTES: z.coerce.number().int().min(0).default(100_000),
  EXPORT_R2_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).default(3_600),

  // ML service
  ML_SERVICE_URL: z.string().default('http://localhost:8123'),
  ML_SERVICE_TIMEOUT_MS: z.coerce.number().default(25_000),
  ML_ADMIN_SECRET: z.string().optional(),
  ML_PHASE4_MODE: z.enum(['heuristic', 'shadow', 'primary']).default('heuristic'),
  ML_PHASE4_PRIMARY_FRACTION: z.coerce.number().min(0).max(1).default(0.1),
  ML_PHASE4_SHADOW_FRACTION: z.coerce.number().min(0).max(1).default(1),
  ML_CB_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(10),
  ML_CB_COOLDOWN_MS: z.coerce.number().int().min(1).default(60_000),
  ML_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).default(4),
  ML_MAX_QUEUE_DEPTH: z.coerce.number().int().min(0).default(32),
  ML_QUEUE_WAIT_TIMEOUT_MS: z.coerce.number().int().min(0).default(250),
  ML_HEALTH_POLL_MS: z.coerce.number().int().min(1).default(30_000),

  // External APIs
  /** Optional; Crossref works without it. Improves rate limits when set (mailto in requests). */
  CROSSREF_EMAIL: z.string().optional(),
  CROSSREF_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(300),
  CROSSREF_TIMEOUT_MS: z.coerce.number().default(3_000),
  CROSSREF_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
  CROSSREF_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(250),
  OPENALEX_TIMEOUT_MS: z.coerce.number().default(3_000),
  OPENALEX_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
  OPENALEX_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(250),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(8_000),
  RETRACTION_WATCH_TIMEOUT_MS: z.coerce.number().default(2_000),
  /** Semantic Scholar Graph API (Phase 8 last-resort enrichment); optional x-api-key header. */
  SEMANTIC_SCHOLAR_API_KEY: z.string().optional(),

  /** Resend.com — contact form (`POST /api/contact`). */
  RESEND_API_KEY: z.string().optional(),
  CONTACT_EMAIL_TO: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  /** Max citation reports per IP per UTC day (`POST .../reports`). */
  REPORT_LIMIT_PER_IP: z.coerce.number().int().min(1).default(10),

  // Auth
  SESSION_SECRET: z.string().default(DEV_SESSION_SECRET_PLACEHOLDER),
  AUTH_MODE: z.enum(['internal', 'hybrid', 'external']).default('internal'),
  AUTH_ALLOW_LEGACY_SESSIONS: z.string().default('true').transform((v) => v === 'true' || v === '1'),
  /** After this instant (ISO 8601), legacy DB sessions are rejected (JWT + API keys unaffected). */
  AUTH_LEGACY_SESSION_SUNSET_AT: z.string().optional(),
  AUTH_ALLOW_API_KEYS: z.string().default('true').transform((v) => v === 'true' || v === '1'),
  /** Cookie name for legacy session id (if not using Bearer). */
  SESSION_COOKIE_NAME: z.string().default('br_session'),
  AUTH_JWT_AUDIENCES: z.string().optional(),
  CLERK_JWT_ISSUER: z.string().optional(),
  CLERK_JWKS_URL: z.string().optional(),
  CLERK_JWT_AUDIENCE: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  WORKOS_JWT_ISSUER: z.string().optional(),
  WORKOS_JWKS_URL: z.string().optional(),
  WORKOS_JWT_AUDIENCE: z.string().optional(),
  WORKOS_API_KEY: z.string().optional(),
  /** Same client id as `VITE_WORKOS_CLIENT_ID` — used by WorkOS browser auth proxy. */
  WORKOS_CLIENT_ID: z.string().optional(),

  // Webhooks (Clerk / WorkOS)
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  WORKOS_WEBHOOK_SECRET: z.string().optional(),

  /** HS256 secret for signed `POST /internal/admin/approve` tokens (magic admin grant links). */
  ADMIN_APPROVAL_JWT_SECRET: z.string().optional(),
  /** Dev-only fallback allowlist for admin emails when local DB is unavailable. */
  DEV_ADMIN_EMAIL_ALLOWLIST: z.string().optional(),
  /** Dev-only fallback allowlist for admin email domains when local DB is unavailable. */
  DEV_ADMIN_DOMAIN_ALLOWLIST: z.string().optional(),

  /** If set, `X-Break-Glass-Secret` can satisfy `requireAdmin` for emergency access (use sparingly). */
  BREAK_GLASS_SECRET: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).default(2_000_000),
  TRUST_PROXY_CIDRS: z.string().default('loopback, linklocal, uniquelocal'),

  // Pipeline
  PIPELINE_BATCH_SIZE: z.coerce.number().default(64),
  PIPELINE_MAX_CONCURRENCY: z.coerce.number().default(4),
  PIPELINE_FAST_WORKERS_ENABLED: z.string().default('true').transform((v) => v === 'true' || v === '1'),
  PIPELINE_FAST_MULTICORE_MIN_REFS: z.coerce.number().int().min(1).default(256),
  PIPELINE_SYNC_THRESHOLD: z.coerce.number().default(500),
  PIPELINE_STAGE_BUDGET_MS: z.coerce.number().int().min(1).default(250),
  B2B_DAILY_REF_LIMIT: z.coerce.number().int().min(1).default(50_000),
  B2B_ORG_CONCURRENT_JOB_LIMIT: z.coerce.number().int().min(1).default(25),
  B2B_GLOBAL_CONCURRENT_JOB_LIMIT: z.coerce.number().int().min(1).default(100),

  // Feature flags
  /** Reserved for future OIDC rollout gating (0–100; 0 = off). Not yet wired to auth middleware. */
  FEATURE_AUTH_CANARY_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
  FEATURE_SCORED_DETECTOR: z.string().default('false').transform((v) => v === 'true' || v === '1'),
  /**
   * Live Phase 8 enrichment kill-switch. Default OFF: no live Crossref/OpenAlex/SemanticScholar
   * traffic and inline enrichment never turns on, regardless of tier (production stays byte-identical
   * to today). When ON, the existing tier-gated enrichment allowance applies and the persistent
   * provider cache is enabled (even in queue_first Redis mode) so repeated DOIs do not re-bill.
   */
  FEATURE_LIVE_ENRICH: z.string().default('false').transform((v) => v === 'true' || v === '1'),
  FEATURE_PDF_CLEANUP: z.string().default('true').transform((v) => v === 'true' || v === '1'),
  PDF_CLEANUP_MIN_IMPROVEMENT_DELTA: z.coerce.number().min(0).default(0.01),
  PDF_CLEANUP_MAX_CANDIDATE_LENGTH: z.coerce.number().int().min(1).default(200_000),
  PDF_CLEANUP_BLOCK_COUNT_DIVERGENCE_RATIO: z.coerce.number().min(0).default(0.2),
  ENABLE_LLM_FALLBACK: z.string().default('true').transform((v) => v === 'true' || v === '1'),
  LLM_REPAIR_BUDGET_FREE: z.coerce.number().int().min(0).default(10),
  LLM_REPAIR_BUDGET_PRO: z.coerce.number().int().min(0).default(50),
});

export type Env = z.infer<typeof envSchema>;

export interface JwtProviderConfig {
  name: 'clerk' | 'workos';
  issuer: string;
  jwksUrl: string;
  audiences: string[];
}

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${missing}`);
  }
  if (result.data.NODE_ENV === 'production') {
    const secret = result.data.SESSION_SECRET;
    const explicit = process.env.SESSION_SECRET;
    if (
      !secret
      || secret === DEV_SESSION_SECRET_PLACEHOLDER
      || explicit === ''
      || explicit === DEV_SESSION_SECRET_PLACEHOLDER
    ) {
      throw new Error(
        'SESSION_SECRET must be set to a strong random value in production (the dev default is not allowed). '
          + 'In Render: open your Web Service → Environment → add `SESSION_SECRET` (Environment → Generate if available, or run `openssl rand -hex 32` and paste). '
          + 'Redeploy after saving. Optional: see `render.yaml` in this repo for Blueprint `generateValue` setup.',
      );
    }

    const redisUrl = result.data.REDIS_URL?.trim() ?? '';
    const upstashRedisUrl = result.data.UPSTASH_REDIS_URL?.trim() ?? '';
    if (redisUrl && upstashRedisUrl && redisUrl !== upstashRedisUrl) {
      throw new Error(
        'REDIS_URL and UPSTASH_REDIS_URL are both set but do not match. Use one canonical Redis TCP URL when Redis-backed integrations are enabled.',
      );
    }
  }
  return result.data;
}

export const env = loadEnv();

export function parseCsvEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseEmailDomain(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    return null;
  }
  const domain = trimmed.split('@')[1]?.trim().toLowerCase() ?? '';
  return domain || null;
}

export const corsAllowedOrigins = parseCsvEnv(env.CORS_ALLOWED_ORIGINS);
export const resolvedRedisUrl = (env.UPSTASH_REDIS_URL?.trim() || env.REDIS_URL?.trim() || '');
export const devAdminEmailAllowlist = parseCsvEnv(env.DEV_ADMIN_EMAIL_ALLOWLIST).map((entry) => entry.toLowerCase());
export const devAdminDomainAllowlist = Array.from(new Set([
  ...parseCsvEnv(env.DEV_ADMIN_DOMAIN_ALLOWLIST).map((entry) => entry.toLowerCase()),
  ...(env.NODE_ENV === 'development'
    ? [parseEmailDomain(env.CONTACT_EMAIL_TO), parseEmailDomain(env.CROSSREF_EMAIL)].filter((entry): entry is string => Boolean(entry))
    : []),
]));

export const jwtProviders: JwtProviderConfig[] = [
  env.CLERK_JWT_ISSUER && env.CLERK_JWKS_URL
    ? {
        name: 'clerk',
        issuer: env.CLERK_JWT_ISSUER,
        jwksUrl: env.CLERK_JWKS_URL,
        audiences: parseCsvEnv(env.CLERK_JWT_AUDIENCE ?? env.AUTH_JWT_AUDIENCES),
      }
    : null,
  env.WORKOS_JWT_ISSUER && env.WORKOS_JWKS_URL
    ? {
        name: 'workos',
        issuer: env.WORKOS_JWT_ISSUER,
        jwksUrl: env.WORKOS_JWKS_URL,
        audiences: parseCsvEnv(env.WORKOS_JWT_AUDIENCE ?? env.AUTH_JWT_AUDIENCES),
      }
    : null,
].filter((provider): provider is JwtProviderConfig => provider != null);

export function isQueueFirstRedisMode(): boolean {
  return env.REDIS_USAGE_MODE === 'queue_first';
}

export function shouldUseRedisBackedRateLimits(): boolean {
  return env.NODE_ENV === 'production' && !isQueueFirstRedisMode();
}

export function shouldUseRedisProviderCaches(): boolean {
  // When live enrichment is enabled, keep the persistent provider cache on even in
  // queue_first mode so repeated DOIs do not re-bill Crossref/OpenAlex (cost-safety).
  if (env.FEATURE_LIVE_ENRICH) {
    return true;
  }
  return !isQueueFirstRedisMode();
}

export function shouldUseRedisReportIpLimiter(): boolean {
  return env.NODE_ENV !== 'test'
    && !isQueueFirstRedisMode()
    && Boolean(resolvedRedisUrl.trim());
}

if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
  if (env.AUTH_MODE === 'internal' && jwtProviders.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[bulkreferences] AUTH_MODE is "internal" but Clerk/WorkOS JWKS env vars are set. '
        + 'Bearer JWT validation is disabled; set AUTH_MODE=hybrid (or external) so /internal/* and /v1/* accept Clerk/WorkOS tokens. See .env.example.',
    );
  }
  if (env.AUTH_MODE !== 'internal' && jwtProviders.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[bulkreferences] AUTH_MODE is not "internal" but no JWT issuers (CLERK_JWKS_URL / WORKOS_JWKS_URL) are configured. External JWT auth will fail until JWKS is set.',
    );
  }
}
