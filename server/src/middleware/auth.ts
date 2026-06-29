import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import { eq, and, gt } from 'drizzle-orm';
import { devAdminDomainAllowlist, devAdminEmailAllowlist, env } from '../config.js';
import { db } from '../db/connection.js';
import { sessions, apiKeys, users, identityLinks, organizations } from '../db/schema.js';
import { ErrorCode } from '../engine/errors/index.js';
import {
  ExternalAuthValidationError,
  type ExternalAuthIdentity,
  looksLikeJwt,
  verifyExternalAccessToken,
} from '../auth/externalAuth.js';
import { ensureOrganizationForExternal } from '../auth/organizationLinks.js';
import { RevocationBackendUnavailableError, isSessionRevoked } from '../auth/revocation.js';
import { getCorrelationId } from '../runtime/requestContext.js';
import { resolvePersistenceBackend } from '../runtime/persistenceMode.js';

/**
 * Auth precedence (highest first): external JWT Bearer → API key (`X-API-Key`) → legacy session (Bearer non-JWT or session cookie).
 * Legacy sessions honor `AUTH_LEGACY_SESSION_SUNSET_AT` when set.
 */

/** Resolve identity before `@fastify/rate-limit` so `requestIsAdminBypassingLimits` works in `allowList`. */
export function shouldRunOptionalAuthBeforeRateLimit(reqUrl: string): boolean {
  const path = (reqUrl.split('?')[0] ?? '').replace(/\/$/, '') || '/';
  return (
    path.startsWith('/v1/')
    || path.startsWith('/api/engine/')
    || path.startsWith('/api/contact')
    || path.startsWith('/user_management/')
  );
}

export function requestIsAdminBypassingLimits(req: FastifyRequest): boolean {
  return Boolean((req as FastifyRequest & { isAdmin?: boolean }).isAdmin);
}

function legacySessionEffective(): boolean {
  if (!env.AUTH_ALLOW_LEGACY_SESSIONS) {
    return false;
  }
  const raw = env.AUTH_LEGACY_SESSION_SUNSET_AT?.trim();
  if (!raw) {
    return true;
  }
  const t = Date.parse(raw);
  if (Number.isNaN(t)) {
    return true;
  }
  return Date.now() < t;
}

function readSessionCookie(req: FastifyRequest): string | null {
  const name = env.SESSION_COOKIE_NAME.replace(/[^a-z0-9_-]/gi, '') || 'br_session';
  const raw = req.headers.cookie;
  if (!raw) {
    return null;
  }
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'i'));
  const value = match?.[1]?.trim();
  return value ? decodeURIComponent(value) : null;
}

function testAuthUserId() {
  return currentResolvedPersistenceBackend() === 'database'
    ? '00000000-0000-0000-0000-000000000001'
    : 'test-user';
}

function currentResolvedPersistenceBackend() {
  return resolvePersistenceBackend({
    nodeEnv: env.NODE_ENV,
    configuredBackend: env.PERSISTENCE_BACKEND,
    databaseUrl: process.env.DATABASE_URL,
  });
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
}

function isTestSessionProbePath(req: FastifyRequest): boolean {
  const path = (req.url.split('?')[0] ?? '').replace(/\/$/, '') || '/';
  return path === '/v1/auth/session';
}

function isSessionProbePath(req: FastifyRequest): boolean {
  const path = (req.url.split('?')[0] ?? '').replace(/\/$/, '') || '/';
  return path === '/v1/auth/session' || path === '/internal/admin/session';
}

function logRevocationBackendUnavailable(req: FastifyRequest, reason: string): void {
  req.log.error(
    {
      securityEvent: 'auth.revocation_backend_unavailable',
      reason,
      path: req.url,
      correlationId: getCorrelationId(),
    },
    'auth: revocation backend unavailable; failing closed',
  );
}

function logSessionProbeIdentityFallback(
  req: FastifyRequest,
  identity: ExternalIdentity,
  reason: string,
): void {
  req.log.warn(
    {
      authEvent: 'session_probe_ephemeral_identity_fallback',
      authSource: identity.authSource,
      externalUserId: identity.userId,
      path: req.url,
      reason,
      correlationId: getCorrelationId(),
    },
    'auth: session probe fell back to JWT-backed identity after external identity resolution failure',
  );
}

function shouldUseSessionProbeIdentityFallback(req: FastifyRequest): boolean {
  return isSessionProbePath(req);
}

/**
 * Extracts and validates the caller identity from a request.
 * Supports external JWT, API key, and legacy session (Bearer or cookie).
 *
 * On success, attaches `req.userId`, `req.tier`, `req.isAdmin` to the request.
 * On failure, sends 401 and halts processing.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    const disabled = firstHeaderValue(req.headers['x-test-auth-disabled']) === '1';
    if (disabled) {
      return reply.status(401).send({
        error: ErrorCode.UNAUTHORIZED,
        message: 'Authentication required.',
        authReason: 'test_auth_disabled',
      });
    }

    const requestedRole = firstHeaderValue(req.headers['x-test-auth-role'])?.trim().toLowerCase();
    const role = requestedRole === 'admin' || requestedRole === 'b2b' || requestedRole === 'pro' || requestedRole === 'free'
      ? requestedRole
      : 'admin';
    const isAdmin = role === 'admin';
    const tier = role === 'b2b' || role === 'pro' || role === 'free'
      ? role
      : 'pro';

    (req as FastifyRequest & { userId: string; tier: string; isAdmin: boolean }).userId = testAuthUserId();
    (req as FastifyRequest & { tier: string }).tier = tier;
    (req as FastifyRequest & { isAdmin: boolean }).isAdmin = isAdmin;
    return;
  }

  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const path = (req.url.split('?')[0] ?? '').replace(/\/$/, '') || '/';
  const isAdminSessionProbe = path === '/internal/admin/session';
  if (isAdminSessionProbe && env.NODE_ENV === 'development') {
    req.log.info(
      {
        authProbe: true,
        hasAuthorizationHeader: Boolean(authHeader),
        bearerPresent: Boolean(bearerToken),
        bearerLen: bearerToken?.length ?? 0,
        authMode: env.AUTH_MODE,
        correlationId: getCorrelationId(),
      },
      'auth: admin session probe (incoming)',
    );
  }

  if (bearerToken && env.AUTH_MODE !== 'internal' && looksLikeJwt(bearerToken)) {
    let externalIdentity: ExternalAuthIdentity | null = null;
    try {
      externalIdentity = await verifyExternalAccessToken(bearerToken);
    } catch (error) {
      if (error instanceof ExternalAuthValidationError && error.reason === 'audience_mismatch') {
        return reply.status(401).send({
          error: ErrorCode.AUTH_AUDIENCE_MISMATCH,
          message: 'Token audience is invalid for this API.',
          authReason: 'audience_mismatch',
        });
      }
      if (
        (error instanceof ExternalAuthValidationError && error.reason === 'revocation_backend_unavailable')
        || error instanceof RevocationBackendUnavailableError
      ) {
        logRevocationBackendUnavailable(
          req,
          error instanceof Error ? error.message : 'revocation_backend_unavailable',
        );
        return reply.status(503).send({
          error: ErrorCode.AUTH_BACKEND_UNAVAILABLE,
          message: 'Authentication is temporarily unavailable. Please retry shortly.',
          authReason: 'revocation_backend_unavailable',
        });
      }
      throw error;
    }
    if (externalIdentity) {
      let resolved: Awaited<ReturnType<typeof resolveExternalIdentity>>;
      try {
        resolved = await resolveExternalIdentity(externalIdentity);
      } catch (error) {
        if (error instanceof ExternalIdentityResolutionError) {
          if (shouldUseSessionProbeIdentityFallback(req)) {
            const fallback = buildSessionProbeFallbackIdentity(externalIdentity);
            logSessionProbeIdentityFallback(req, externalIdentity, error.message);
            applyAuthIdentity(req, fallback.userId, fallback.tier, fallback.isAdmin, undefined, fallback.profile);
            return;
          }
          req.log.error(
            {
              securityEvent: 'auth.external_identity_resolution_unavailable',
              path,
              correlationId: getCorrelationId(),
            },
            'auth: external identity resolution unavailable; failing closed',
          );
          return reply.status(503).send({
            error: ErrorCode.AUTH_BACKEND_UNAVAILABLE,
            message: 'Authentication is temporarily unavailable. Please retry shortly.',
            authReason: 'external_identity_resolution_unavailable',
          });
        }
        throw error;
      }
      applyAuthIdentity(req, resolved.userId, resolved.tier, resolved.isAdmin, undefined, resolved.profile);
      return;
    }

    try {
      const decoded = decodeJwt(bearerToken);
      const expSec = typeof decoded.exp === 'number' ? decoded.exp : null;
      if (expSec != null && expSec * 1000 < Date.now()) {
        req.log.warn(
          {
            authEvent: 'access_token_expired',
            correlationId: getCorrelationId(),
          },
          'auth: bearer JWT expired',
        );
        return reply
          .status(401)
          .header(
            'WWW-Authenticate',
            'Bearer error="invalid_token", error_description="The access token expired"',
          )
          .send({
            error: 'UNAUTHORIZED',
            message: 'Access token expired.',
            authReason: 'access_token_expired',
          });
      }
      req.log.warn(
        {
          authEvent: 'jwt_rejected',
          iss: typeof decoded.iss === 'string' ? decoded.iss : undefined,
          correlationId: getCorrelationId(),
        },
        'auth: bearer JWT not accepted (wrong key, revoked, or unknown issuer)',
      );
    } catch {
      req.log.warn(
        { authEvent: 'jwt_malformed', correlationId: getCorrelationId() },
        'auth: bearer token is not a valid JWT',
      );
    }

    if (env.AUTH_MODE === 'external' && !env.AUTH_ALLOW_LEGACY_SESSIONS) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authentication required. Provide a valid external Bearer token or X-API-Key header.',
        authReason: 'jwt_invalid',
      });
    }
  }

  if (env.AUTH_ALLOW_API_KEYS) {
    const apiKeyIdentity = await resolveApiKeyIdentity(req.headers['x-api-key']);
    if (apiKeyIdentity) {
      applyAuthIdentity(req, apiKeyIdentity.userId, apiKeyIdentity.tier, apiKeyIdentity.isAdmin, apiKeyIdentity.apiKeyId);
      return;
    }
  }

  const cookieSession = readSessionCookie(req);
  const attemptedLegacy =
    (bearerToken && !looksLikeJwt(bearerToken)) || Boolean(cookieSession && !looksLikeJwt(cookieSession));

  if (!legacySessionEffective()) {
    if (env.AUTH_ALLOW_LEGACY_SESSIONS && attemptedLegacy) {
      return reply.status(401).send({
        error: 'LEGACY_AUTH_SUNSET',
        message:
          'Legacy session authentication has ended. Sign in with your identity provider or use an API key.',
      });
    }
  } else {
    if (bearerToken && !looksLikeJwt(bearerToken)) {
      let sessionIdentity: Awaited<ReturnType<typeof resolveLegacySessionIdentity>> = null;
      try {
        sessionIdentity = await resolveLegacySessionIdentity(bearerToken);
      } catch (error) {
        if (error instanceof RevocationBackendUnavailableError) {
          logRevocationBackendUnavailable(req, error.message);
          return reply.status(503).send({
            error: ErrorCode.AUTH_BACKEND_UNAVAILABLE,
            message: 'Authentication is temporarily unavailable. Please retry shortly.',
            authReason: 'revocation_backend_unavailable',
          });
        }
        throw error;
      }
      if (sessionIdentity) {
        applyAuthIdentity(req, sessionIdentity.userId, sessionIdentity.tier, sessionIdentity.isAdmin);
        return;
      }
    }
    if (cookieSession && !looksLikeJwt(cookieSession)) {
      let sessionIdentity: Awaited<ReturnType<typeof resolveLegacySessionIdentity>> = null;
      try {
        sessionIdentity = await resolveLegacySessionIdentity(cookieSession);
      } catch (error) {
        if (error instanceof RevocationBackendUnavailableError) {
          logRevocationBackendUnavailable(req, error.message);
          return reply.status(503).send({
            error: ErrorCode.AUTH_BACKEND_UNAVAILABLE,
            message: 'Authentication is temporarily unavailable. Please retry shortly.',
            authReason: 'revocation_backend_unavailable',
          });
        }
        throw error;
      }
      if (sessionIdentity) {
        applyAuthIdentity(req, sessionIdentity.userId, sessionIdentity.tier, sessionIdentity.isAdmin);
        return;
      }
    }
  }

  req.log.warn(
    {
      authEvent: 'no_valid_credentials',
      hadBearer: Boolean(bearerToken),
      correlationId: getCorrelationId(),
    },
    'auth: no valid bearer, API key, or legacy session',
  );

  return reply.status(401).send({
    error: 'UNAUTHORIZED',
    message: 'Authentication required. Provide a Bearer token or X-API-Key header.',
    authReason: 'credentials_missing',
  });
}

/**
 * Optional auth — attaches identity if credentials are present but does NOT
 * reject if missing. Used for routes that work both authenticated and anonymous.
 */
export async function optionalAuth(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    if (isTestSessionProbePath(req)) {
      (req as FastifyRequest & { userId: string; tier: string; isAdmin: boolean }).userId = testAuthUserId();
      (req as FastifyRequest & { tier: string }).tier = 'free';
      (req as FastifyRequest & { isAdmin: boolean }).isAdmin = false;
    }
    return;
  }

  try {
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (bearerToken && env.AUTH_MODE !== 'internal' && looksLikeJwt(bearerToken)) {
      const externalIdentity = await verifyExternalAccessToken(bearerToken);
      if (externalIdentity) {
        let resolved: Awaited<ReturnType<typeof resolveExternalIdentity>>;
        try {
          resolved = await resolveExternalIdentity(externalIdentity);
        } catch (error) {
          if (
            error instanceof ExternalIdentityResolutionError
            && shouldUseSessionProbeIdentityFallback(req)
          ) {
            const fallback = buildSessionProbeFallbackIdentity(externalIdentity);
            logSessionProbeIdentityFallback(req, externalIdentity, error.message);
            applyAuthIdentity(req, fallback.userId, fallback.tier, fallback.isAdmin, undefined, fallback.profile);
            return;
          }
          throw error;
        }
        applyAuthIdentity(req, resolved.userId, resolved.tier, resolved.isAdmin, undefined, resolved.profile);
        return;
      }
    }

    if (env.AUTH_ALLOW_API_KEYS) {
      const apiKeyIdentity = await resolveApiKeyIdentity(req.headers['x-api-key']);
      if (apiKeyIdentity) {
        applyAuthIdentity(req, apiKeyIdentity.userId, apiKeyIdentity.tier, apiKeyIdentity.isAdmin, apiKeyIdentity.apiKeyId);
        return;
      }
    }

    const cookieSession = readSessionCookie(req);
    if (legacySessionEffective()) {
      if (bearerToken && !looksLikeJwt(bearerToken)) {
        const sessionIdentity = await resolveLegacySessionIdentity(bearerToken);
        if (sessionIdentity) {
          applyAuthIdentity(req, sessionIdentity.userId, sessionIdentity.tier, sessionIdentity.isAdmin);
          return;
        }
      }
      if (cookieSession && !looksLikeJwt(cookieSession)) {
        const sessionIdentity = await resolveLegacySessionIdentity(cookieSession);
        if (sessionIdentity) {
          applyAuthIdentity(req, sessionIdentity.userId, sessionIdentity.tier, sessionIdentity.isAdmin);
          return;
        }
      }
    }
  } catch {
    // Silent — optionalAuth never blocks the request
  }
}

async function resolveLegacySessionIdentity(sessionId: string): Promise<{
  userId: string;
  tier: string;
  isAdmin: boolean;
} | null> {
  if (await isSessionRevoked(sessionId)) {
    return null;
  }

  const [session] = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!session) {
    return null;
  }

  const [user] = await db
    .select({ tier: users.tier, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    return null;
  }

  return {
    userId: session.userId,
    tier: user.tier ?? 'free',
    isAdmin: user.isAdmin ?? false,
  };
}

type ExternalIdentity = NonNullable<Awaited<ReturnType<typeof verifyExternalAccessToken>>>;
type ExternalAuthProfile = {
  provider: ExternalIdentity['authSource'];
  email?: string;
  name?: string;
  username?: string;
};

type ResolvedExternalIdentity = {
  userId: string;
  tier: string;
  isAdmin: boolean;
  profile?: ExternalAuthProfile;
};

export class ExternalIdentityResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalIdentityResolutionError';
  }
}

async function syncExternalOrgFromIdentity(userId: string, identity: ExternalIdentity): Promise<void> {
  if (!identity.orgId?.trim()) {
    return;
  }
  const internalOrgId = await ensureOrganizationForExternal(identity.authSource, identity.orgId);
  await db
    .update(users)
    .set({ orgId: internalOrgId, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

type UserAuthRecord = {
  id: string;
  email: string | null;
  tier: string;
  isAdmin: boolean;
};

function normalizeExternalEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function isSyntheticExternalEmail(value: string | null | undefined): boolean {
  return Boolean(normalizeExternalEmail(value)?.endsWith('@external.invalid'));
}

function tierRank(value: string | null | undefined): number {
  switch (value) {
    case 'b2b':
      return 2;
    case 'pro':
      return 1;
    default:
      return 0;
  }
}

function resolveEffectiveTier(userTier: string | null | undefined, orgTier: string | null | undefined): 'free' | 'pro' | 'b2b' {
  if (userTier === 'b2b' || orgTier === 'b2b') {
    return 'b2b';
  }
  if (userTier === 'pro' || orgTier === 'pro') {
    return 'pro';
  }
  return 'free';
}

function shouldUseDevelopmentAdminFallback(): boolean {
  return env.NODE_ENV === 'development' && currentResolvedPersistenceBackend() !== 'database';
}

export function matchesAdminEmailAllowlist(
  email: string | null | undefined,
  emailAllowlist: string[],
  domainAllowlist: string[],
): boolean {
  const normalized = normalizeExternalEmail(email);
  if (!normalized) {
    return false;
  }

  if (emailAllowlist.includes(normalized)) {
    return true;
  }

  const domain = normalized.split('@')[1] ?? '';
  return Boolean(domain) && domainAllowlist.includes(domain);
}

export function isDevelopmentAdminEmail(email: string | null | undefined): boolean {
  if (!shouldUseDevelopmentAdminFallback()) {
    return false;
  }

  return matchesAdminEmailAllowlist(email, devAdminEmailAllowlist, devAdminDomainAllowlist);
}

async function loadUserAuthRecord(userId: string): Promise<UserAuthRecord | null> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      tier: users.tier,
      isAdmin: users.isAdmin,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return null;
  }

  return {
    ...user,
    tier: user.tier ?? 'free',
    isAdmin: user.isAdmin ?? false,
  };
}

async function loadUserAuthRow(userId: string): Promise<{ userId: string; tier: string; isAdmin: boolean }> {
  const user = await loadUserAuthRecord(userId);

  return {
    userId,
    tier: user?.tier ?? 'free',
    isAdmin: user?.isAdmin ?? false,
  };
}

async function loadUserAuthRecordByEmail(email: string): Promise<UserAuthRecord | null> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      tier: users.tier,
      isAdmin: users.isAdmin,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    return null;
  }

  return {
    ...user,
    tier: user.tier ?? 'free',
    isAdmin: user.isAdmin ?? false,
  };
}

async function syncIdentityLinkEmail(
  provider: ExternalIdentity['authSource'],
  externalId: string,
  email: string,
): Promise<void> {
  await db
    .update(identityLinks)
    .set({ email })
    .where(and(eq(identityLinks.provider, provider), eq(identityLinks.externalId, externalId)));
}

async function reconcileLinkedExternalIdentity(
  linkedUserId: string,
  provider: ExternalIdentity['authSource'],
  externalId: string,
  email: string,
): Promise<{ userId: string; tier: string; isAdmin: boolean }> {
  await syncIdentityLinkEmail(provider, externalId, email);

  const linkedUser = await loadUserAuthRecord(linkedUserId);
  if (!linkedUser) {
    return loadUserAuthRow(linkedUserId);
  }

  const linkedEmail = normalizeExternalEmail(linkedUser.email);
  if (linkedEmail === email) {
    return loadUserAuthRow(linkedUserId);
  }

  const linkedUserLooksSynthetic = !linkedEmail || isSyntheticExternalEmail(linkedEmail);
  const canonicalUser = await loadUserAuthRecordByEmail(email);

  if (canonicalUser && canonicalUser.id !== linkedUserId && linkedUserLooksSynthetic) {
    const nextTier = tierRank(canonicalUser.tier) > tierRank(linkedUser.tier)
      ? canonicalUser.tier
      : linkedUser.tier;
    const nextIsAdmin = Boolean(linkedUser.isAdmin || canonicalUser.isAdmin);
    if (nextTier !== linkedUser.tier || nextIsAdmin !== linkedUser.isAdmin) {
      await db
        .update(users)
        .set({
          ...(nextTier !== linkedUser.tier ? { tier: nextTier } : {}),
          ...(nextIsAdmin !== linkedUser.isAdmin ? { isAdmin: nextIsAdmin } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, linkedUserId));
    }
    return loadUserAuthRow(linkedUserId);
  }

  if (linkedUserLooksSynthetic) {
    await db
      .update(users)
      .set({ email, updatedAt: new Date() })
      .where(eq(users.id, linkedUserId));
  }

  return loadUserAuthRow(linkedUserId);
}

/**
 * DB is authoritative for long-lived staff; verified Clerk/WorkOS JWT claims can also grant admin
 * (e.g. `is_admin` / `https://bulkreferences.com/is_admin` in a JWT template) without a migration.
 */
function mergeExternalAuthRow(
  row: { userId: string; tier: string; isAdmin: boolean },
  identity: ExternalIdentity,
): ResolvedExternalIdentity {
  const fallbackAdmin = isDevelopmentAdminEmail(identity.email);
  return {
    ...row,
    isAdmin: Boolean(row.isAdmin || identity.isAdmin || fallbackAdmin),
    profile: buildExternalAuthProfile(identity),
  };
}

function buildEphemeralExternalIdentity(identity: ExternalIdentity): ResolvedExternalIdentity {
  return {
    userId: `${identity.authSource}:${identity.userId}`,
    tier: identity.tier,
    isAdmin: Boolean(identity.isAdmin || isDevelopmentAdminEmail(identity.email)),
    profile: buildExternalAuthProfile(identity),
  };
}

function buildSessionProbeFallbackIdentity(identity: ExternalIdentity): ResolvedExternalIdentity {
  const fallback = buildEphemeralExternalIdentity(identity);
  if (env.NODE_ENV !== 'development') {
    return fallback;
  }

  return {
    ...fallback,
    isAdmin: Boolean(
      fallback.isAdmin
      || matchesAdminEmailAllowlist(identity.email, devAdminEmailAllowlist, devAdminDomainAllowlist),
    ),
  };
}

export async function resolveExternalIdentity(identity: ExternalIdentity): Promise<{
  userId: string;
  tier: string;
  isAdmin: boolean;
  profile?: ExternalAuthProfile;
}> {
  const provider = identity.authSource;
  const externalId = identity.userId;
  const email = normalizeExternalEmail(identity.email);
  const canLinkByVerifiedEmail =
    Boolean(email)
    && (identity.authSource === 'workos' || identity.emailVerified === true);

  try {
    const [link] = await db
      .select({ userId: identityLinks.userId })
      .from(identityLinks)
      .where(and(eq(identityLinks.provider, provider), eq(identityLinks.externalId, externalId)))
      .limit(1);

    if (link) {
      const resolvedRow = canLinkByVerifiedEmail && email
        ? await reconcileLinkedExternalIdentity(link.userId, provider, externalId, email)
        : await loadUserAuthRow(link.userId);
      await syncExternalOrgFromIdentity(resolvedRow.userId, identity);
      return mergeExternalAuthRow(resolvedRow, identity);
    }

    const [existing] = canLinkByVerifiedEmail && email
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      : [];

    if (existing) {
      await db.insert(identityLinks).values({
        provider,
        externalId,
        userId: existing.id,
        ...(email ? { email } : {}),
      });
      await syncExternalOrgFromIdentity(existing.id, identity);
      return mergeExternalAuthRow(await loadUserAuthRow(existing.id), identity);
    }

    const syntheticEmail = canLinkByVerifiedEmail && email
      ? email
      : `${provider}_${externalId}@external.invalid`;
    const syntheticHash = createHash('sha256')
      .update(`external:${provider}:${externalId}`)
      .digest('hex');

    const [created] = await db
      .insert(users)
      .values({
        email: syntheticEmail,
        name: identity.displayName ?? identity.email ?? null,
        passwordHash: `external:${syntheticHash}`,
        tier: identity.tier,
        isAdmin: identity.isAdmin,
      })
      .returning({ id: users.id });

    if (!created) {
      throw new Error('Failed to create user for external identity.');
    }

    await db.insert(identityLinks).values({
      provider,
      externalId,
      userId: created.id,
      ...(email ? { email } : {}),
    });
    await syncExternalOrgFromIdentity(created.id, identity);
    return mergeExternalAuthRow(await loadUserAuthRow(created.id), identity);
  } catch (error) {
    const fallbackError = isExternalIdentityFallbackError(error);
    const allowEphemeralFallback = currentResolvedPersistenceBackend() !== 'database';

    if (allowEphemeralFallback && (env.NODE_ENV !== 'production' || fallbackError)) {
      return buildEphemeralExternalIdentity(identity);
    }

    if (fallbackError) {
      throw new ExternalIdentityResolutionError(
        'External identity resolution is temporarily unavailable.',
      );
    }

    throw error;
  }
}

async function resolveApiKeyIdentity(rawKey: unknown): Promise<{
  userId: string;
  tier: string;
  isAdmin: boolean;
  apiKeyId: string;
} | null> {
  if (typeof rawKey !== 'string' || rawKey.length === 0) {
    return null;
  }

  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const [key] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      isActive: apiKeys.isActive,
      rateLimit: apiKeys.rateLimit,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)))
    .limit(1);

  if (!key) {
    return null;
  }

  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id));

  const [user] = await db
    .select({
      tier: users.tier,
      isAdmin: users.isAdmin,
      orgTier: organizations.tier,
    })
    .from(users)
    .leftJoin(organizations, eq(users.orgId, organizations.id))
    .where(eq(users.id, key.userId))
    .limit(1);

  return {
    userId: key.userId,
    tier: resolveEffectiveTier(user?.tier, user?.orgTier),
    isAdmin: user?.isAdmin ?? false,
    apiKeyId: key.id,
  };
}

function applyAuthIdentity(
  req: FastifyRequest,
  userId: string,
  tier: string,
  isAdmin: boolean,
  apiKeyId?: string,
  profile?: ExternalAuthProfile,
): void {
  (req as FastifyRequest & { userId: string; tier: string; isAdmin: boolean }).userId = userId;
  (req as FastifyRequest & { tier: string }).tier = tier;
  (req as FastifyRequest & { isAdmin: boolean }).isAdmin = isAdmin;
  if (apiKeyId) {
    (req as FastifyRequest & { apiKeyId: string }).apiKeyId = apiKeyId;
  }
  if (profile) {
    (req as FastifyRequest & { authProfile: ExternalAuthProfile }).authProfile = profile;
  }
}

/**
 * Middleware that requires the authenticated user to have `is_admin = true`.
 * Must be used AFTER `requireAuth`.
 */
export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const secret = req.headers['x-break-glass-secret'];
  if (
    env.BREAK_GLASS_SECRET
    && typeof secret === 'string'
    && secret === env.BREAK_GLASS_SECRET
  ) {
    req.log.warn({ url: req.url }, 'Break-glass admin bypass');
    return;
  }

  if (!(req as FastifyRequest & { isAdmin?: boolean }).isAdmin) {
    req.log.warn(
      {
        authEvent: 'admin_forbidden',
        userId: (req as FastifyRequest & { userId?: string }).userId,
        correlationId: getCorrelationId(),
      },
      'auth: user is not an administrator',
    );
    return reply.status(403).send({
      error: 'FORBIDDEN',
      message: 'Admin access required.',
      authReason: 'not_admin',
    });
  }
}

/**
 * Institutional org manager: may access org-scoped routes only (not global `/internal` admin).
 */
export async function requireOrgAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = (req as FastifyRequest & { userId?: string }).userId;
  if (!userId) {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
  }

  const [row] = await db
    .select({ appRole: users.appRole, orgId: users.orgId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (row?.appRole !== 'org_admin' || !row.orgId) {
    return reply.status(403).send({
      error: 'FORBIDDEN',
      message: 'Organization admin access required.',
    });
  }

  (req as FastifyRequest & { orgScopeId: string }).orgScopeId = row.orgId;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function attachAuditOrgContext(req: FastifyRequest): Promise<void> {
  const userId = (req as FastifyRequest & { userId?: string }).userId;
  if (!userId || !looksLikeUuid(userId)) {
    return;
  }

  try {
    const [row] = await db
      .select({ orgId: users.orgId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const r = req as FastifyRequest & { auditOrgId?: string };
    if (row?.orgId) {
      r.auditOrgId = row.orgId;
    } else {
      delete r.auditOrgId;
    }
  } catch (error) {
    req.log.warn(
      {
        err: error,
        userId,
        correlationId: getCorrelationId(),
      },
      'auth: failed to attach audit org context (non-blocking)',
    );
  }
}

function buildExternalAuthProfile(identity: ExternalIdentity): ExternalAuthProfile {
  const email = normalizeExternalEmail(identity.email) ?? undefined;
  const displayName = identity.displayName?.trim()
    || identity.username?.trim()
    || email
    || `${identity.authSource} user`;
  const username = identity.username?.trim()
    || (email?.includes('@') ? email.split('@')[0] : undefined)
    || identity.userId;

  return {
    provider: identity.authSource,
    ...(email ? { email } : {}),
    ...(displayName ? { name: displayName } : {}),
    ...(username ? { username } : {}),
  };
}

function isExternalIdentityFallbackError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? String(error.code ?? '') : '';
  const message = 'message' in error ? String(error.message ?? '') : '';

  const connectionOrAvailabilityError = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    '57P01',
    '57P03',
  ].includes(code) || /connect|database|postgres|pool/i.test(message);

  if (connectionOrAvailabilityError) {
    return true;
  }

  // In development, missing/partial migrations should not hard-fail external JWT auth.
  // Fall back to token-claims identity so admin tooling can still bootstrap.
  if (env.NODE_ENV !== 'production') {
    if (['42P01', '42703', '42P07'].includes(code)) {
      return true;
    }
    if (
      /relation .* does not exist/i.test(message)
      || /column .* does not exist/i.test(message)
      || /no such table/i.test(message)
      || /sqlite/i.test(message)
    ) {
      return true;
    }
  }

  return false;
}
