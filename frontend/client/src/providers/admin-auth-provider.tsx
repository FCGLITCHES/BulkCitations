import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useClerk } from "@clerk/react";
import { authDebug, authTokenMeta } from "@/lib/authDebug";
import {
  getAdminReadinessVersion,
  getAdminSessionProbeReadiness,
  getExternalAuthToken,
  subscribeAdminReadiness,
} from "@/oauth/runtime";
import { resolveApiUrl } from "@/lib/api-url";
import { workosEnabled } from "@/oauth/config";
import { ADMIN_AUTH_SESSION_EVENT, USER_AUTH_SESSION_EVENT } from "@/lib/userAuthEvents";

const WORKOS_CONFIGURED = workosEnabled;

const USER_AUTH_BRIDGE_DEBOUNCE_MS = 150;
const ADMIN_SILENT_PROBE_RETRY_DELAY_MS = 400;
const ADMIN_SILENT_PROBE_MAX_RETRIES = 8;
const ADMIN_SESSION_STORAGE_KEY = "bulkreferences-admin-session";
const ADMIN_SESSION_SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

type AdminSessionResponse = {
  authenticated?: boolean;
  configured?: boolean;
  account?: {
    id: string;
    name: string;
    username: string;
    email: string;
  } | null;
};

export type AdminLoginResult =
  | { success: true }
  | { success: false; message: string };

type AdminSessionSnapshot = {
  account: AdminSessionResponse["account"];
  isAdmin: boolean;
  isConfigured: boolean;
  lastValidatedAt: number;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredSnapshot(): AdminSessionSnapshot | null {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<AdminSessionSnapshot>;
    if (
      typeof parsed.isAdmin !== "boolean"
      || typeof parsed.isConfigured !== "boolean"
      || typeof parsed.lastValidatedAt !== "number"
    ) {
      return null;
    }

    return {
      account: parsed.account ?? null,
      isAdmin: parsed.isAdmin,
      isConfigured: parsed.isConfigured,
      lastValidatedAt: parsed.lastValidatedAt,
    };
  } catch {
    return null;
  }
}

function isFreshSnapshot(snapshot: AdminSessionSnapshot | null) {
  return Boolean(snapshot && (Date.now() - snapshot.lastValidatedAt) < ADMIN_SESSION_SNAPSHOT_MAX_AGE_MS);
}

function writeStoredSnapshot(snapshot: AdminSessionSnapshot) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage write failures and keep the in-memory session usable.
  }
}

function clearStoredSnapshot() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

type AuthFetchMeta = { reason?: string };

async function authFetch(url: string, init: RequestInit = {}, meta?: AuthFetchMeta): Promise<Response> {
  authDebug("admin-fetch", "start", { url, reason: meta?.reason });
  const headers = new Headers(init.headers ?? {});
  const token = await getExternalAuthToken();
  authDebug("admin-fetch", "token-for-request", { ...authTokenMeta(token), reason: meta?.reason });
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  } else if (!token) {
    authDebug("admin-fetch", "no-bearer-header", {
      reason: meta?.reason,
      note: "Server will return 401 for /internal/admin/session without valid JWT.",
    });
  }
  const response = await fetch(resolveApiUrl(url), {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  authDebug("admin-fetch", "response", { url, status: response.status, reason: meta?.reason });
  return response;
}

type AdminAuthContextValue = {
  isAdmin: boolean;
  isConfigured: boolean;
  isInitialized: boolean;
  account: AdminSessionResponse["account"];
  login: (identifier: string, password: string) => Promise<AdminLoginResult>;
  logout: () => Promise<void>;
  refreshAuth: (options?: {
    keepalive?: boolean;
    silent?: boolean;
    debugReason?: string;
  }) => Promise<void>;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);
type RefreshAuthFn = AdminAuthContextValue["refreshAuth"];

/**
 * Single source of truth for admin session. Must wrap any route that calls `useAdminAuth()`.
 * (Previously each hook call used isolated state, so navigating /adm1n ↔ /admin/dashboard reset state and caused redirect loops.)
 */
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const initialSnapshot = readStoredSnapshot();
  const hasFreshSnapshot = isFreshSnapshot(initialSnapshot);
  const [isAdmin, setIsAdmin] = useState(hasFreshSnapshot ? initialSnapshot?.isAdmin ?? false : false);
  const [isConfigured, setIsConfigured] = useState(hasFreshSnapshot ? initialSnapshot?.isConfigured ?? true : true);
  const [account, setAccount] = useState<AdminSessionResponse["account"]>(hasFreshSnapshot ? initialSnapshot?.account ?? null : null);
  /**
   * Keep admin routes gated until the first live auth probe completes.
   * A stale local snapshot can exist before Clerk token hydration; allowing
   * admin pages to mount early causes transient 401 noise and query failures.
   */
  const [isInitialized, setIsInitialized] = useState(false);
  const userAuthBridgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentProbeRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentProbeRetryCountRef = useRef(0);
  const refreshAuthRef = useRef<RefreshAuthFn | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const readinessVersion = useSyncExternalStore(
    subscribeAdminReadiness,
    getAdminReadinessVersion,
    getAdminReadinessVersion,
  );

  const { ready: authSdksReady, shouldSkipProbe } = useMemo(
    () => getAdminSessionProbeReadiness(WORKOS_CONFIGURED),
    [readinessVersion],
  );

  const applySessionState = useCallback((data: AdminSessionResponse) => {
    const nextIsAdmin = Boolean(data.authenticated);
    const nextIsConfigured = Boolean(data.configured ?? true);
    const nextAccount = data.account ?? null;

    setIsAdmin(nextIsAdmin);
    setIsConfigured(nextIsConfigured);
    setAccount(nextAccount);

    if (nextIsAdmin) {
      writeStoredSnapshot({
        account: nextAccount,
        isAdmin: nextIsAdmin,
        isConfigured: nextIsConfigured,
        lastValidatedAt: Date.now(),
      });
    } else {
      clearStoredSnapshot();
    }
  }, []);

  const clearSessionState = useCallback(() => {
    setIsAdmin(false);
    setIsConfigured(true);
    setAccount(null);
    clearStoredSnapshot();
  }, []);

  const clearSilentProbeRetry = useCallback(() => {
    silentProbeRetryCountRef.current = 0;
    if (silentProbeRetryTimerRef.current) {
      clearTimeout(silentProbeRetryTimerRef.current);
      silentProbeRetryTimerRef.current = null;
    }
  }, []);

  const scheduleSilentProbeRetry = useCallback((debugReason: string) => {
    if (silentProbeRetryTimerRef.current) {
      clearTimeout(silentProbeRetryTimerRef.current);
      silentProbeRetryTimerRef.current = null;
    }

    const nextAttempt = silentProbeRetryCountRef.current + 1;
    if (nextAttempt > ADMIN_SILENT_PROBE_MAX_RETRIES) {
      authDebug("admin-session", "silent-probe:max-retries", {
        retries: silentProbeRetryCountRef.current,
      });
      setIsConfigured(false);
      setIsInitialized(true);
      return;
    }

    silentProbeRetryCountRef.current = nextAttempt;
    setIsInitialized(false);

    silentProbeRetryTimerRef.current = setTimeout(() => {
      silentProbeRetryTimerRef.current = null;
      const { shouldSkipProbe: skip } = getAdminSessionProbeReadiness(WORKOS_CONFIGURED);
      if (skip) {
        clearSilentProbeRetry();
        clearSessionState();
        setIsConfigured(true);
        setIsInitialized(true);
        return;
      }

      void refreshAuthRef.current?.({
        silent: true,
        debugReason: `${debugReason}:retry-${nextAttempt}`,
      });
    }, ADMIN_SILENT_PROBE_RETRY_DELAY_MS);
  }, [clearSessionState, clearSilentProbeRetry]);

  const refreshAuth = useCallback(async (options?: { keepalive?: boolean; silent?: boolean; debugReason?: string }) => {
    if (refreshPromiseRef.current) {
      await refreshPromiseRef.current;
      return;
    }

    const refreshPromise = (async () => {
      let shouldFinalizeInitialization = true;
      authDebug("admin-session", "refreshAuth:start", {
        silent: Boolean(options?.silent),
        keepalive: Boolean(options?.keepalive),
        reason: options?.debugReason ?? "unspecified",
      });
      try {
        const response = await authFetch(
          "/internal/admin/session",
          {
            keepalive: options?.keepalive,
          },
          { reason: options?.debugReason },
        );

        if (response.status === 401) {
          authDebug("admin-session", "refreshAuth:401-unauthenticated", {
            silent: Boolean(options?.silent),
            reason: options?.debugReason,
            note: options?.silent
              ? "Silent mode: not clearing admin snapshot (expected before Clerk JWT is ready)."
              : "Clearing admin snapshot — no userId on server (missing/invalid JWT).",
          });
          if (!options?.silent) {
            clearSilentProbeRetry();
            clearSessionState();
          } else {
            shouldFinalizeInitialization = false;
            scheduleSilentProbeRetry(options?.debugReason ?? "silent-401");
          }
          return;
        }

        if (response.status === 403) {
          clearSilentProbeRetry();
          authDebug("admin-session", "refreshAuth:403", { reason: options?.debugReason });
          applySessionState({
            authenticated: false,
            configured: true,
            account: null,
          });
          return;
        }

        if (response.status >= 500) {
          authDebug("admin-session", "refreshAuth:retryable-http-error", {
            status: response.status,
            silent: Boolean(options?.silent),
            reason: options?.debugReason,
          });
          if (options?.silent) {
            shouldFinalizeInitialization = false;
            scheduleSilentProbeRetry(options?.debugReason ?? `silent-http-${response.status}`);
            return;
          }
          setIsConfigured(false);
          return;
        }

        if (!response.ok) {
          authDebug("admin-session", "refreshAuth:http-error", {
            status: response.status,
            reason: options?.debugReason,
          });
          throw new Error("Failed to load admin session");
        }

        const data = await response.json() as AdminSessionResponse;
        const cachedSnapshot = readStoredSnapshot();
        const shouldRetryPotentialFalseNegative =
          Boolean(options?.silent)
          && !Boolean(data.authenticated)
          && isFreshSnapshot(cachedSnapshot)
          && cachedSnapshot?.isAdmin === true;

        if (shouldRetryPotentialFalseNegative) {
          authDebug("admin-session", "refreshAuth:retrying-potential-false-negative", {
            reason: options?.debugReason,
          });
          shouldFinalizeInitialization = false;
          scheduleSilentProbeRetry(options?.debugReason ?? "silent-false-negative");
          return;
        }

        clearSilentProbeRetry();
        authDebug("admin-session", "refreshAuth:ok", {
          authenticated: Boolean(data.authenticated),
          reason: options?.debugReason,
        });
        applySessionState(data);
      } catch (err) {
        authDebug("admin-session", "refreshAuth:catch", {
          silent: Boolean(options?.silent),
          reason: options?.debugReason,
          message: err instanceof Error ? err.message : String(err),
        });
        if (options?.silent) {
          shouldFinalizeInitialization = false;
          scheduleSilentProbeRetry(options?.debugReason ?? "silent-catch");
        } else {
          clearSilentProbeRetry();
          clearSessionState();
        }
      } finally {
        if (shouldFinalizeInitialization) {
          setIsInitialized(true);
        }
      }
    })();

    refreshPromiseRef.current = refreshPromise;

    try {
      await refreshPromise;
    } finally {
      if (refreshPromiseRef.current === refreshPromise) {
        refreshPromiseRef.current = null;
      }
    }
  }, [applySessionState, clearSessionState, clearSilentProbeRetry, scheduleSilentProbeRetry]);

  useEffect(() => {
    refreshAuthRef.current = refreshAuth;
    return () => {
      refreshAuthRef.current = null;
    };
  }, [refreshAuth]);

  useEffect(() => {
    if (!authSdksReady) {
      authDebug("admin-session", "probe:waiting-for-clerk-workos", {
        workosConfigured: WORKOS_CONFIGURED,
      });
      return;
    }

    if (shouldSkipProbe) {
      authDebug("admin-session", "probe:skipped-no-idp-session", {});
      clearSessionState();
      setIsConfigured(true);
      setIsInitialized(true);
      return;
    }

    const snapshotNow = readStoredSnapshot();
    const freshNow = isFreshSnapshot(snapshotNow);
    /*
     * Initial probe must be silent: before Clerk finishes hydrating, getToken() can be null → 401.
     * Non-silent 401 clears local admin snapshot and feels like "refresh signed me out".
     */
    if (freshNow) {
      void refreshAuth({ silent: true, debugReason: "mount:revalidate-stale-snapshot" });
    } else {
      void refreshAuth({ silent: true, debugReason: "mount:cold" });
    }
  }, [authSdksReady, shouldSkipProbe, refreshAuth, clearSessionState]);

  useEffect(() => {
    const handleAuthChange = () => {
      const snapshot = readStoredSnapshot();

      if (isFreshSnapshot(snapshot)) {
        const nextSnapshot = snapshot as AdminSessionSnapshot;
        applySessionState({
          authenticated: nextSnapshot.isAdmin,
          configured: nextSnapshot.isConfigured,
          account: nextSnapshot.account,
        });
        setIsInitialized(true);
        void refreshAuth({ silent: true, debugReason: "admin-storage-event:fresh" });
        return;
      }

      clearSessionState();
      setIsInitialized(true);
    };

    const handleUserAuthBridge = () => {
      authDebug("admin-session", "USER_AUTH_SESSION_EVENT (debounced)", {});
      if (userAuthBridgeTimerRef.current) {
        clearTimeout(userAuthBridgeTimerRef.current);
      }
      userAuthBridgeTimerRef.current = setTimeout(() => {
        userAuthBridgeTimerRef.current = null;
        const { shouldSkipProbe: skip } = getAdminSessionProbeReadiness(WORKOS_CONFIGURED);
        if (skip) {
          authDebug("admin-session", "user-bridge:skipped-no-idp", {});
          return;
        }
        void refreshAuth({ silent: true, debugReason: "user-auth-session-event" });
      }, USER_AUTH_BRIDGE_DEBOUNCE_MS);
    };

    window.addEventListener(ADMIN_AUTH_SESSION_EVENT, handleAuthChange);
    window.addEventListener(USER_AUTH_SESSION_EVENT, handleUserAuthBridge);
    return () => {
      clearSilentProbeRetry();
      if (userAuthBridgeTimerRef.current) {
        clearTimeout(userAuthBridgeTimerRef.current);
      }
      window.removeEventListener(ADMIN_AUTH_SESSION_EVENT, handleAuthChange);
      window.removeEventListener(USER_AUTH_SESSION_EVENT, handleUserAuthBridge);
    };
  }, [applySessionState, clearSessionState, clearSilentProbeRetry, refreshAuth]);

  const login = useCallback(async (_identifier: string, _password: string): Promise<AdminLoginResult> => {
    window.location.assign("/adm1n");
    return { success: false, message: "Redirecting to sign in…" };
  }, []);

  const logout = useCallback(async () => {
    clearSessionState();
    setIsInitialized(true);
    window.dispatchEvent(new Event(ADMIN_AUTH_SESSION_EVENT));

    try {
      const token = await getExternalAuthToken();
      if (token) {
        await fetch(resolveApiUrl("/v1/auth/logout"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // ignore
    }

    await signOut().catch(() => {});
    window.dispatchEvent(new Event(USER_AUTH_SESSION_EVENT));
  }, [clearSessionState, signOut]);

  const value: AdminAuthContextValue = {
    isAdmin,
    isConfigured,
    isInitialized,
    account,
    login,
    logout,
    refreshAuth,
  };

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  }
  return ctx;
}
