/**
 * OAuth / API access token runtime (Clerk primary, WorkOS institutional fallback).
 * All API calls that need a Bearer token should use `getOAuthAccessToken()`.
 */
import { authDebug, authTokenMeta } from "@/lib/authDebug";

type TokenGetter = () => Promise<string | null>;

let clerkTokenGetter: TokenGetter | null = null;
let workosTokenGetter: TokenGetter | null = null;

let clerkLoaded = false;
let clerkSignedIn = false;

let workosBridgeReported = false;
let workosLoading = true;
let workosHasUser = false;
let oauthPrewarmSessionKey: string | null = null;
let oauthPrewarmPromise: Promise<string | null> | null = null;
const TOKEN_GETTER_TIMEOUT_MS = 2_500;

const readinessListeners = new Set<() => void>();
let readinessVersion = 0;

function bumpReadiness(): void {
  readinessVersion += 1;
  for (const cb of readinessListeners) {
    cb();
  }
}

export function subscribeOAuthReadiness(cb: () => void): () => void {
  readinessListeners.add(cb);
  return () => {
    readinessListeners.delete(cb);
  };
}

/** @deprecated Use subscribeOAuthReadiness */
export const subscribeAdminReadiness = subscribeOAuthReadiness;

export function getOAuthReadinessVersion(): number {
  return readinessVersion;
}

/** @deprecated Use getOAuthReadinessVersion */
export const getAdminReadinessVersion = getOAuthReadinessVersion;

export function setWorkosBridgeHint(loading: boolean, hasUser: boolean): void {
  workosBridgeReported = true;
  workosLoading = loading;
  workosHasUser = hasUser;
  bumpReadiness();
}

export function setWorkosBridgeInactive(): void {
  workosBridgeReported = false;
  workosLoading = true;
  workosHasUser = false;
  bumpReadiness();
}

/** @deprecated */
export const setWorkOSBridgeHint = setWorkosBridgeHint;
/** @deprecated */
export const setWorkOSBridgeInactive = setWorkosBridgeInactive;

export function getAdminSessionProbeReadiness(workosConfigured: boolean): {
  ready: boolean;
  shouldSkipProbe: boolean;
} {
  const { ready, hasAnyIdpSession } = getOAuthProbeReadiness(workosConfigured);
  return {
    ready,
    shouldSkipProbe: ready && !hasAnyIdpSession,
  };
}

export function getPublicSessionProbeReadiness(workosConfigured: boolean): {
  ready: boolean;
  hasAnyIdpSession: boolean;
} {
  return getOAuthProbeReadiness(workosConfigured);
}

function getOAuthProbeReadiness(workosConfigured: boolean): {
  ready: boolean;
  hasAnyIdpSession: boolean;
} {
  const clerkReady = clerkLoaded;
  const workosReady = !workosConfigured || (workosBridgeReported && !workosLoading);
  const ready = clerkReady && workosReady;

  return {
    ready,
    hasAnyIdpSession: clerkSignedIn || (workosConfigured && workosHasUser),
  };
}

export function getOAuthRuntimeSnapshot() {
  return {
    clerkLoaded,
    clerkSignedIn,
    hasClerkGetter: Boolean(clerkTokenGetter),
    hasWorkosGetter: Boolean(workosTokenGetter),
    workosBridgeReported,
    workosLoading,
    workosHasUser,
  };
}

/** @deprecated */
export const getExternalAuthDebugSnapshot = getOAuthRuntimeSnapshot;

if (typeof window !== "undefined" && import.meta.env.DEV) {
  (
    window as unknown as {
      __bulkreferencesGetOAuthRuntimeSnapshot?: typeof getOAuthRuntimeSnapshot;
    }
  ).__bulkreferencesGetOAuthRuntimeSnapshot = getOAuthRuntimeSnapshot;
}

function setClerkTokenGetter(getter: TokenGetter | null): void {
  clerkTokenGetter = getter;
}

function setWorkosTokenGetter(getter: TokenGetter | null): void {
  workosTokenGetter = getter;
}

/** @deprecated */
export const setClerkAuthTokenGetter = setClerkTokenGetter;
/** @deprecated */
export const setWorkOSAuthTokenGetter = setWorkosTokenGetter;

export function setClerkSessionHint(loaded: boolean, signedIn: boolean): void {
  clerkLoaded = loaded;
  clerkSignedIn = signedIn;
  bumpReadiness();
}

/** @deprecated */
export const setClerkAuthSessionHint = setClerkSessionHint;

export async function getOAuthAccessToken(): Promise<string | null> {
  authDebug("oauth", "getOAuthAccessToken:start", getOAuthRuntimeSnapshot());

  if (clerkTokenGetter) {
    try {
      const token = await resolveTokenGetterWithTimeout("clerk", clerkTokenGetter);
      authDebug("oauth", "clerk:getter-returned", authTokenMeta(token));
      if (token) {
        return token;
      }
    } catch (err) {
      authDebug("oauth", "clerk:getter-threw", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    authDebug("oauth", "clerk:no-getter-yet", {});
  }

  if (clerkLoaded && clerkSignedIn) {
    authDebug("oauth", "skip-workos:clerk-active-no-jwt-yet", {
      note: "Avoid WorkOS client refresh (CORS) while Clerk session exists.",
    });
    return null;
  }

  if (workosTokenGetter) {
    authDebug("oauth", "workos:invoking-getter", {});
    try {
      const w = await resolveTokenGetterWithTimeout("workos", workosTokenGetter);
      authDebug("oauth", "workos:getter-returned", authTokenMeta(w));
      return w;
    } catch (err) {
      authDebug("oauth", "workos:getter-threw", {
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  authDebug("oauth", "getOAuthAccessToken:end-null", {});
  return null;
}

async function resolveTokenGetterWithTimeout(
  provider: "clerk" | "workos",
  getter: TokenGetter,
): Promise<string | null> {
  let timeoutId: number | null = null;
  try {
    return await Promise.race([
      getter(),
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => {
          authDebug("oauth", `${provider}:getter-timeout`, {
            timeoutMs: TOKEN_GETTER_TIMEOUT_MS,
          });
          resolve(null);
        }, TOKEN_GETTER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

/** Legacy name — same as {@link getOAuthAccessToken} */
export const getExternalAuthToken = getOAuthAccessToken;

export async function waitForOAuthAccessToken(
  timeoutMs = 2_500,
  intervalMs = 100,
): Promise<string | null> {
  const immediate = await getOAuthAccessToken();
  if (immediate) {
    return immediate;
  }

  const startedAt = Date.now();
  return new Promise((resolve) => {
    let timeoutId: number | null = null;
    let intervalId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      unsubscribe();
    };

    const finish = (token: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(token);
    };

    const probe = () => {
      void getOAuthAccessToken()
        .then((token) => {
          if (token || Date.now() - startedAt >= timeoutMs) {
            finish(token);
          }
        })
        .catch(() => {
          if (Date.now() - startedAt >= timeoutMs) {
            finish(null);
          }
        });
    };

    const unsubscribe = subscribeOAuthReadiness(probe);
    intervalId = window.setInterval(probe, intervalMs);
    timeoutId = window.setTimeout(() => finish(null), timeoutMs);
    probe();
  });
}

export function prewarmOAuthAccessToken(sessionKey: string | null | undefined): void {
  const normalizedSessionKey = sessionKey?.trim() ?? "";
  if (!normalizedSessionKey) {
    return;
  }
  if (oauthPrewarmSessionKey === normalizedSessionKey && oauthPrewarmPromise) {
    return;
  }

  oauthPrewarmSessionKey = normalizedSessionKey;

  const nextPrewarm = getOAuthAccessToken()
    .then((token) => {
      authDebug("oauth", "prewarm:resolved", {
        sessionKey: normalizedSessionKey,
        ...authTokenMeta(token),
      });
      return token;
    })
    .catch((err) => {
      authDebug("oauth", "prewarm:error", {
        sessionKey: normalizedSessionKey,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    })
    .finally(() => {
      if (oauthPrewarmPromise === nextPrewarm) {
        oauthPrewarmPromise = null;
      }
    });

  oauthPrewarmPromise = nextPrewarm;
}
