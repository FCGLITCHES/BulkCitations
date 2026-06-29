import { createLocalJWKSet, jwtVerify, type JWTPayload, type JWTVerifyResult } from 'jose';
import { env, jwtProviders, type JwtProviderConfig } from '../config.js';
import { RevocationBackendUnavailableError, isSessionRevoked, isTokenJtiRevoked } from './revocation.js';
import { instrumentedFetch } from '../services/instrumentedFetch.js';

export interface ExternalAuthIdentity {
  userId: string;
  tier: 'free' | 'pro' | 'b2b';
  isAdmin: boolean;
  email?: string;
  displayName?: string;
  username?: string;
  /** Prefer explicit `email_verified` from Clerk; WorkOS enterprise SSO is treated as verified. */
  emailVerified: boolean;
  orgId?: string;
  authSource: 'clerk' | 'workos';
  jti?: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const CLERK_USER_HYDRATION_TTL_MS = 5 * 60 * 1000;
const ADMIN_ROLE_MARKERS = new Set(['admin', 'administrator', 'superadmin', 'super_admin']);

type JwksCacheEntry = {
  fetchedAtMs: number;
  keyFn: ReturnType<typeof createLocalJWKSet>;
};

const jwksCache = new Map<string, JwksCacheEntry>();
const jwksRefreshInFlight = new Set<string>();
const clerkIdentityCache = new Map<string, {
  fetchedAtMs: number;
  email?: string;
  emailVerified: boolean;
  isAdmin: boolean;
  tier?: ExternalAuthIdentity['tier'];
  displayName?: string;
  username?: string;
}>();

export type ExternalAuthFailureReason = 'audience_mismatch' | 'revocation_backend_unavailable';

export class ExternalAuthValidationError extends Error {
  constructor(
    readonly reason: ExternalAuthFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalAuthValidationError';
  }
}

export async function verifyExternalAccessToken(token: string): Promise<ExternalAuthIdentity | null> {
  if (env.AUTH_MODE === 'internal' || jwtProviders.length === 0) {
    return null;
  }

  let sawAudienceMismatch = false;
  for (const provider of jwtProviders) {
    try {
      const keyFn = await getJwks(provider, token);
      if (!keyFn) {
        continue;
      }

      const verified = await verifyJwtForProvider(token, keyFn, provider);

      if (await isTokenJtiRevoked(verified.payload.jti)) {
        throw new Error('Token has been revoked.');
      }

      const sid = readStringClaim(verified.payload, ['sid']);
      if (await isSessionRevoked(sid)) {
        throw new Error('Session has been revoked.');
      }

      const identity = mapPayloadToIdentity(provider, verified);
      return provider.name === 'clerk'
        ? await maybeHydrateClerkIdentity(identity)
        : identity;
    } catch (error) {
      if (error instanceof RevocationBackendUnavailableError) {
        throw new ExternalAuthValidationError(
          'revocation_backend_unavailable',
          error.message,
        );
      }
      if (isAudienceClaimValidationError(error)) {
        sawAudienceMismatch = true;
      }
      continue;
    }
  }

  if (sawAudienceMismatch) {
    throw new ExternalAuthValidationError(
      'audience_mismatch',
      'The token audience did not match the configured API audience.',
    );
  }

  return null;
}

export function looksLikeJwt(value: string): boolean {
  return value.split('.').length === 3;
}

async function getJwks(provider: JwtProviderConfig, token: string): Promise<ReturnType<typeof createLocalJWKSet> | null> {
  const cached = jwksCache.get(provider.jwksUrl);
  const isFresh = cached ? (Date.now() - cached.fetchedAtMs) < JWKS_TTL_MS : false;

  if (!cached) {
    return fetchAndCacheJwks(provider);
  }

  if (!isFresh) {
    // Serve stale keys but refresh in the background.
    triggerJwksRefresh(provider);
  }

  // If the token kid is unknown, refresh in the background and fail closed.
  const kid = readJwtKid(token);
  if (kid && !isFresh) {
    // We already triggered refresh above; keep serving stale keys for non-kid errors.
  }

  return async (protectedHeader, tokenForKey) => {
    try {
      return await cached.keyFn(protectedHeader, tokenForKey);
    } catch (err) {
      // If we couldn't find a matching key, trigger a refresh and fail this request.
      triggerJwksRefresh(provider);
      throw err;
    }
  };
}

async function fetchAndCacheJwks(
  provider: JwtProviderConfig,
): Promise<ReturnType<typeof createLocalJWKSet> | null> {
  try {
    const response = await instrumentedFetch({
      provider: 'other',
      route: '/auth/jwks',
      method: 'GET',
      url: provider.jwksUrl,
      headers: { accept: 'application/json' },
      timeoutMs: 3_000,
      retryAttempts: 2,
      expectedContentTypes: ['application/json'],
    });
    if (!response.ok) {
      return null;
    }
    const jwks = await response.json() as { keys?: unknown[] };
    if (!jwks || !Array.isArray(jwks.keys)) {
      return null;
    }

    const keyFn = createLocalJWKSet(jwks as never);
    jwksCache.set(provider.jwksUrl, {
      fetchedAtMs: Date.now(),
      keyFn,
    });
    return keyFn;
  } catch {
    return null;
  }
}

function mapPayloadToIdentity(
  provider: JwtProviderConfig,
  verified: JWTVerifyResult,
): ExternalAuthIdentity {
  const payload = verified.payload;
  const displayName = selectPayloadDisplayName(payload);
  const username = readStringClaim(payload, ['preferred_username', 'username']);
  const orgId = readStringClaim(payload, ['org_id', 'organization_id']);
  const tier = normalizeTier(
    readStringClaim(payload, [
      'https://bulkreferences.com/tier',
      'tier',
      'plan',
    ]),
  );

  return {
    userId: payload.sub ?? '',
    tier,
    isAdmin: readBooleanClaim(payload, [
      'https://bulkreferences.com/is_admin',
      'is_admin',
      'admin',
    ]) || readRoleClaim(payload, ['roles', 'role', 'appRole']),
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(username ? { username } : {}),
    emailVerified:
      provider.name === 'workos'
        ? true
        : readBooleanClaim(payload, ['email_verified']),
    ...(orgId ? { orgId } : {}),
    authSource: provider.name,
    ...(typeof payload.jti === 'string' ? { jti: payload.jti } : {}),
  };
}

async function maybeHydrateClerkIdentity(identity: ExternalAuthIdentity): Promise<ExternalAuthIdentity> {
  const secret = env.CLERK_SECRET_KEY?.trim();
  if (identity.authSource !== 'clerk' || !secret) {
    return identity;
  }

  const cached = clerkIdentityCache.get(identity.userId);
  if (cached && (Date.now() - cached.fetchedAtMs) < CLERK_USER_HYDRATION_TTL_MS) {
    return {
      ...identity,
      ...(cached.email ? { email: cached.email } : {}),
      ...(cached.displayName ? { displayName: cached.displayName } : {}),
      ...(cached.username ? { username: cached.username } : {}),
      emailVerified: identity.emailVerified || cached.emailVerified,
      isAdmin: identity.isAdmin || cached.isAdmin,
      tier: cached.tier ?? identity.tier,
    };
  }

  try {
    const response = await instrumentedFetch({
      provider: 'other',
      route: '/clerk/users/:id',
      method: 'GET',
      url: `https://api.clerk.com/v1/users/${encodeURIComponent(identity.userId)}`,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${secret}`,
      },
      expectedContentTypes: ['application/json'],
    });

    if (!response.ok) {
      return identity;
    }

    const user = await response.json() as ClerkUserResponse;
    const hydrated = extractClerkUserTraits(user);

    clerkIdentityCache.set(identity.userId, {
      fetchedAtMs: Date.now(),
      ...(hydrated.email ? { email: hydrated.email } : {}),
      emailVerified: hydrated.emailVerified,
      isAdmin: hydrated.isAdmin,
      ...(hydrated.tier ? { tier: hydrated.tier } : {}),
      ...(hydrated.displayName ? { displayName: hydrated.displayName } : {}),
      ...(hydrated.username ? { username: hydrated.username } : {}),
    });

    return {
      ...identity,
      ...(hydrated.email ? { email: hydrated.email } : {}),
      ...(hydrated.displayName ? { displayName: hydrated.displayName } : {}),
      ...(hydrated.username ? { username: hydrated.username } : {}),
      emailVerified: identity.emailVerified || hydrated.emailVerified,
      isAdmin: identity.isAdmin || hydrated.isAdmin,
      tier: hydrated.tier ?? identity.tier,
    };
  } catch {
    return identity;
  }
}

function normalizeTier(value: string | undefined): ExternalAuthIdentity['tier'] {
  return value === 'pro' || value === 'b2b' ? value : 'free';
}

type ClerkUserResponse = {
  primary_email_address_id?: string | null;
  primaryEmailAddressId?: string | null;
  email_addresses?: ClerkEmailAddressRecord[];
  emailAddresses?: ClerkEmailAddressRecord[];
  first_name?: string | null;
  firstName?: string | null;
  last_name?: string | null;
  lastName?: string | null;
  full_name?: string | null;
  fullName?: string | null;
  username?: string | null;
  public_metadata?: Record<string, unknown> | null;
  publicMetadata?: Record<string, unknown> | null;
  private_metadata?: Record<string, unknown> | null;
  privateMetadata?: Record<string, unknown> | null;
  unsafe_metadata?: Record<string, unknown> | null;
  unsafeMetadata?: Record<string, unknown> | null;
};

type ClerkEmailAddressRecord = {
  id?: string | null;
  email_address?: string | null;
  emailAddress?: string | null;
  verification?: {
    status?: string | null;
  } | null;
};

export function selectPrimaryClerkEmail(user: ClerkUserResponse): {
  email?: string;
  verified: boolean;
} | null {
  const addresses = Array.isArray(user.email_addresses)
    ? user.email_addresses
    : Array.isArray(user.emailAddresses)
      ? user.emailAddresses
      : [];
  if (addresses.length === 0) {
    return null;
  }

  const primaryId = user.primary_email_address_id ?? user.primaryEmailAddressId ?? null;
  const selected = addresses.find((entry) => entry.id === primaryId) ?? addresses[0] ?? null;
  if (!selected) {
    return null;
  }

  const email = normalizeEmail(selected.email_address ?? selected.emailAddress ?? undefined);
  if (!email) {
    return null;
  }

  return {
    email,
    verified: selected.verification?.status === 'verified',
  };
}

type ClerkUserTraits = {
  email?: string;
  emailVerified: boolean;
  isAdmin: boolean;
  tier?: ExternalAuthIdentity['tier'];
  displayName?: string;
  username?: string;
};

export function extractClerkUserTraits(user: ClerkUserResponse): ClerkUserTraits {
  const primaryEmail = selectPrimaryClerkEmail(user);
  const username = normalizeText(user.username ?? undefined) ?? undefined;
  const displayName = selectClerkDisplayName(user, primaryEmail?.email);
  const metadataRecords = collectClerkMetadata(user);
  const tier = readClerkTier(metadataRecords);

  return {
    ...(primaryEmail?.email ? { email: primaryEmail.email } : {}),
    emailVerified: primaryEmail?.verified ?? false,
    isAdmin: readClerkAdminFlag(metadataRecords),
    ...(tier ? { tier } : {}),
    ...(displayName ? { displayName } : {}),
    ...(username ? { username } : {}),
  };
}

function selectClerkDisplayName(user: ClerkUserResponse, email?: string): string | undefined {
  const fullName = normalizeText(user.full_name ?? user.fullName ?? undefined);
  if (fullName) {
    return fullName;
  }

  const firstName = normalizeText(user.first_name ?? user.firstName ?? undefined);
  const lastName = normalizeText(user.last_name ?? user.lastName ?? undefined);
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (combined) {
    return combined;
  }

  const username = normalizeText(user.username ?? undefined);
  if (username) {
    return username;
  }

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    return normalizedEmail.split('@')[0] ?? normalizedEmail;
  }

  return undefined;
}

function collectClerkMetadata(user: ClerkUserResponse): Array<Record<string, unknown>> {
  // `unsafe_metadata` is intentionally excluded because clients can mutate it.
  // Admin/tier decisions must come from trusted metadata only.
  return [
    user.public_metadata,
    user.publicMetadata,
    user.private_metadata,
    user.privateMetadata,
  ].filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readClerkAdminFlag(records: Array<Record<string, unknown>>): boolean {
  for (const record of records) {
    if (readMetadataBoolean(record, ['is_admin', 'isAdmin', 'admin'])) {
      return true;
    }

    const role = readMetadataString(record, ['role', 'appRole']);
    if (role && ADMIN_ROLE_MARKERS.has(role)) {
      return true;
    }

    if (readMetadataRoleList(record, ['roles', 'permissions']).some((roleName) => ADMIN_ROLE_MARKERS.has(roleName))) {
      return true;
    }
  }

  return false;
}

function readClerkTier(records: Array<Record<string, unknown>>): ExternalAuthIdentity['tier'] | undefined {
  for (const record of records) {
    const tier = normalizeTier(readMetadataString(record, ['tier', 'plan']));
    if (tier !== 'free') {
      return tier;
    }
    const explicitFree = readMetadataString(record, ['tier', 'plan']);
    if (explicitFree === 'free') {
      return 'free';
    }
  }

  return undefined;
}

function readMetadataBoolean(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }
  }

  return false;
}

function readMetadataString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const normalized = normalizeText(value);
      if (normalized) {
        return normalized.toLowerCase();
      }
    }
  }

  return undefined;
}

function readMetadataRoleList(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  return [];
}

function normalizeEmail(value: string | undefined | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function normalizeText(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readStringClaim(payload: JWTPayload, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readBooleanClaim(payload: JWTPayload, keys: string[]): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0') return false;
    }
  }

  return false;
}

function readRoleClaim(payload: JWTPayload, claimKeys: string[]): boolean {
  for (const claimKey of claimKeys) {
    const value = payload[claimKey];
    if (Array.isArray(value)) {
      if (value.some((entry) => typeof entry === 'string' && ADMIN_ROLE_MARKERS.has(entry.trim().toLowerCase()))) {
        return true;
      }
      continue;
    }
    if (typeof value === 'string') {
      if (value.split(',').map((entry) => entry.trim().toLowerCase()).some((entry) => ADMIN_ROLE_MARKERS.has(entry))) {
        return true;
      }
    }
  }
  return false;
}

function selectPayloadDisplayName(payload: JWTPayload): string | undefined {
  const direct = readStringClaim(payload, ['name', 'full_name']);
  if (direct) {
    return direct;
  }

  const firstName = readStringClaim(payload, ['given_name', 'first_name']);
  const lastName = readStringClaim(payload, ['family_name', 'last_name']);
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
  return combined || undefined;
}

function readJwtKid(token: string): string | null {
  try {
    const headerB64 = token.split('.')[0];
    if (!headerB64) return null;
    const json = Buffer.from(headerB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { kid?: unknown };
    return typeof parsed.kid === 'string' ? parsed.kid : null;
  } catch {
    return null;
  }
}

function triggerJwksRefresh(provider: JwtProviderConfig): void {
  if (jwksRefreshInFlight.has(provider.jwksUrl)) return;
  jwksRefreshInFlight.add(provider.jwksUrl);

  void (async () => {
    try {
      await fetchAndCacheJwks(provider);
    } catch {
      // best-effort background refresh
    } finally {
      jwksRefreshInFlight.delete(provider.jwksUrl);
    }
  })();
}

export async function verifyJwtForProvider(
  token: string,
  keyFn: ReturnType<typeof createLocalJWKSet>,
  provider: JwtProviderConfig,
): Promise<JWTVerifyResult> {
  const issuerCandidates = buildIssuerCandidates(provider.issuer);
  const baseOptions = {
    issuer: issuerCandidates.length === 1 ? issuerCandidates[0]! : issuerCandidates,
  };

  if (provider.audiences.length === 0) {
    return jwtVerify(token, keyFn, baseOptions);
  }

  return jwtVerify(token, keyFn, {
    ...baseOptions,
    audience: provider.audiences,
  });
}

function buildIssuerCandidates(issuer: string): string[] {
  const withoutTrailingSlash = issuer.replace(/\/+$/u, '');
  const withTrailingSlash = withoutTrailingSlash ? `${withoutTrailingSlash}/` : issuer;
  return Array.from(new Set([issuer, withoutTrailingSlash, withTrailingSlash].filter(Boolean)));
}

function isAudienceClaimValidationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? String(error.code ?? '') : '';
  const claim = 'claim' in error ? String(error.claim ?? '') : '';
  return code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'aud';
}
