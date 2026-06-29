import { redisTtl } from '../redis/keys.js';

export class RevocationBackendUnavailableError extends Error {
  constructor(message = 'Revocation backend is unavailable.') {
    super(message);
    this.name = 'RevocationBackendUnavailableError';
  }
}

type RevocationStore = Map<string, number>;

const revokedTokenJtis: RevocationStore = new Map();
const revokedSessionIds: RevocationStore = new Map();

export async function isTokenJtiRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  return isRevoked(revokedTokenJtis, jti);
}

export async function isSessionRevoked(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false;
  return isRevoked(revokedSessionIds, sessionId);
}

export async function revokeTokenJti(jti: string, expiresAtEpochSeconds?: number): Promise<void> {
  if (!jti) return;
  revoke(revokedTokenJtis, jti, expiresAtEpochSeconds);
}

export async function revokeSession(sessionId: string, expiresAtEpochSeconds?: number): Promise<void> {
  if (!sessionId) return;
  revoke(revokedSessionIds, sessionId, expiresAtEpochSeconds);
}

function resolveRevocationTtl(expiresAtEpochSeconds: number | undefined): number {
  if (!expiresAtEpochSeconds) {
    return redisTtl.authRevocation;
  }

  const secondsUntilExpiry = Math.max(1, Math.ceil(expiresAtEpochSeconds - (Date.now() / 1000)));
  // Safety buffer to absorb clock skew and eviction races.
  return secondsUntilExpiry + 30;
}

function revoke(store: RevocationStore, key: string, expiresAtEpochSeconds?: number): void {
  cleanupExpired(store);
  const ttlSeconds = resolveRevocationTtl(expiresAtEpochSeconds);
  store.set(key, Date.now() + (ttlSeconds * 1000));
}

function isRevoked(store: RevocationStore, key: string): boolean {
  cleanupExpired(store);
  const expiresAtMs = store.get(key);
  if (!expiresAtMs) {
    return false;
  }
  if (expiresAtMs <= Date.now()) {
    store.delete(key);
    return false;
  }
  return true;
}

function cleanupExpired(store: RevocationStore): void {
  const now = Date.now();
  for (const [key, expiresAtMs] of store.entries()) {
    if (expiresAtMs <= now) {
      store.delete(key);
    }
  }
}

export function resetRevocationStateForTests(): void {
  revokedTokenJtis.clear();
  revokedSessionIds.clear();
}
