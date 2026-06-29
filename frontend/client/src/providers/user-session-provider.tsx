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
import { useAuth } from "@clerk/react";
import {
  getExternalAuthToken,
  getPublicSessionProbeReadiness,
  subscribeOAuthReadiness,
  getOAuthReadinessVersion,
} from "@/oauth/runtime";
import { workosEnabled } from "@/oauth/config";
import { resolveApiUrl } from "@/lib/api-url";
import { signOutWorkOSSession } from "@/lib/workosSignOut";
import { USER_AUTH_SESSION_EVENT } from "@/lib/userAuthEvents";

const WORKOS_CONFIGURED = workosEnabled;
const USER_SESSION_STORAGE_KEY = "bulkreferences-user-session";
const USER_SESSION_SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type PublicSessionAccount = {
  id: string;
  name: string;
  email: string;
  accountType: "individual" | "institutional";
  institution: {
    id: string;
    slug: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type PublicSessionResponse = {
  authenticated?: boolean;
  configured?: boolean;
  account?: PublicSessionAccount | null;
};

type ActionResult =
  | { success: true; account: PublicSessionAccount | null }
  | { success: false; message: string };

type PublicSessionSnapshot = {
  isAuthenticated: boolean;
  isConfigured: boolean;
  account: PublicSessionAccount | null;
  lastValidatedAt: number;
};

type UserSessionContextValue = {
  isAuthenticated: boolean;
  isConfigured: boolean;
  isInitialized: boolean;
  account: PublicSessionAccount | null;
  refreshSession: (options?: { silent?: boolean; debugReason?: string }) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<ActionResult>;
  login: (email: string, password: string) => Promise<ActionResult>;
  registerInstitutional: (
    name: string,
    email: string,
    password: string,
    institutionId: string,
  ) => Promise<ActionResult>;
  loginInstitutional: (email: string, password: string, institutionId?: string) => Promise<ActionResult>;
  requestInstitutionPartnership: (
    contactName: string,
    workEmail: string,
    institutionName: string,
    notes: string,
  ) => Promise<{ success: true; message: string } | { success: false; message: string }>;
  logout: () => Promise<void>;
};

const UserSessionContext = createContext<UserSessionContextValue | null>(null);

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJson<T>(response: Response, fallbackMessage: string) {
  return response.json().catch(() => ({ message: fallbackMessage })) as Promise<T & { message?: string }>;
}

function readStoredSnapshot(): PublicSessionSnapshot | null {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(USER_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PublicSessionSnapshot>;
    if (
      typeof parsed.isAuthenticated !== "boolean"
      || typeof parsed.isConfigured !== "boolean"
      || typeof parsed.lastValidatedAt !== "number"
    ) {
      return null;
    }

    return {
      isAuthenticated: parsed.isAuthenticated,
      isConfigured: parsed.isConfigured,
      account: parsed.account ?? null,
      lastValidatedAt: parsed.lastValidatedAt,
    };
  } catch {
    return null;
  }
}

function isFreshSnapshot(snapshot: PublicSessionSnapshot | null) {
  return Boolean(snapshot && (Date.now() - snapshot.lastValidatedAt) < USER_SESSION_SNAPSHOT_MAX_AGE_MS);
}

function writeStoredSnapshot(snapshot: PublicSessionSnapshot) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(USER_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage write failures and keep in-memory state authoritative.
  }
}

function clearStoredSnapshot() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(USER_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = await getExternalAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(resolveApiUrl(url), { ...init, headers, credentials: "include", cache: "no-store" });
}

export function UserSessionProvider({ children }: { children: ReactNode }) {
  const { signOut: clerkSignOut } = useAuth();
  const initialSnapshot = readStoredSnapshot();
  const hasFreshSnapshot = isFreshSnapshot(initialSnapshot);
  const [isAuthenticated, setIsAuthenticated] = useState(hasFreshSnapshot ? initialSnapshot?.isAuthenticated ?? false : false);
  const [isConfigured, setIsConfigured] = useState(hasFreshSnapshot ? initialSnapshot?.isConfigured ?? true : true);
  const [account, setAccount] = useState<PublicSessionAccount | null>(hasFreshSnapshot ? initialSnapshot?.account ?? null : null);
  const [isInitialized, setIsInitialized] = useState(hasFreshSnapshot);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  useSyncExternalStore(
    subscribeOAuthReadiness,
    getOAuthReadinessVersion,
    getOAuthReadinessVersion,
  );

  const { ready: authReadyForSessionProbe } = getPublicSessionProbeReadiness(WORKOS_CONFIGURED);

  const applySessionState = useCallback((data: PublicSessionResponse) => {
    const nextIsAuthenticated = Boolean(data.authenticated);
    const nextIsConfigured = Boolean(data.configured ?? true);
    const nextAccount = data.account ?? null;

    setIsAuthenticated(nextIsAuthenticated);
    setIsConfigured(nextIsConfigured);
    setAccount(nextAccount);

    if (nextIsAuthenticated) {
      writeStoredSnapshot({
        isAuthenticated: nextIsAuthenticated,
        isConfigured: nextIsConfigured,
        account: nextAccount,
        lastValidatedAt: Date.now(),
      });
      return;
    }

    clearStoredSnapshot();
  }, []);

  const clearSessionState = useCallback(() => {
    setIsAuthenticated(false);
    setIsConfigured(true);
    setAccount(null);
    clearStoredSnapshot();
  }, []);

  const refreshSession = useCallback(async (options?: { silent?: boolean; debugReason?: string }) => {
    if (refreshPromiseRef.current) {
      await refreshPromiseRef.current;
      return;
    }

    const refreshPromise = (async () => {
      try {
        const response = await authFetch("/v1/auth/session");

        if (response.status === 401) {
          if (!options?.silent) {
            clearSessionState();
          }
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to load account session (${options?.debugReason ?? "refresh"})`);
        }

        const data = (await response.json()) as PublicSessionResponse;
        applySessionState(data);
      } catch {
        if (!options?.silent) {
          clearSessionState();
        }
      } finally {
        setIsInitialized(true);
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
  }, [applySessionState, clearSessionState]);

  useEffect(() => {
    if (!authReadyForSessionProbe) {
      return;
    }

    const snapshot = readStoredSnapshot();
    if (isFreshSnapshot(snapshot)) {
      const nextSnapshot = snapshot as PublicSessionSnapshot;
      applySessionState({
        authenticated: nextSnapshot.isAuthenticated,
        configured: nextSnapshot.isConfigured,
        account: nextSnapshot.account,
      });
      setIsInitialized(true);
      void refreshSession({ silent: true, debugReason: "mount:fresh-snapshot" });
      return;
    }

    void refreshSession({ silent: true, debugReason: "mount:cold" });
  }, [applySessionState, authReadyForSessionProbe, refreshSession]);

  useEffect(() => {
    const handleAuthChange = () => {
      const snapshot = readStoredSnapshot();

      if (isFreshSnapshot(snapshot)) {
        const nextSnapshot = snapshot as PublicSessionSnapshot;
        applySessionState({
          authenticated: nextSnapshot.isAuthenticated,
          configured: nextSnapshot.isConfigured,
          account: nextSnapshot.account,
        });
        setIsInitialized(true);
        void refreshSession({ silent: true, debugReason: "auth-event:fresh-snapshot" });
        return;
      }

      const { ready, hasAnyIdpSession } = getPublicSessionProbeReadiness(WORKOS_CONFIGURED);
      if (ready && !hasAnyIdpSession) {
        clearSessionState();
        setIsInitialized(true);
        return;
      }

      void refreshSession({ silent: true, debugReason: "auth-event" });
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== USER_SESSION_STORAGE_KEY) {
        return;
      }

      const snapshot = readStoredSnapshot();
      if (!snapshot) {
        clearSessionState();
        setIsInitialized(true);
        return;
      }

      applySessionState({
        authenticated: snapshot.isAuthenticated,
        configured: snapshot.isConfigured,
        account: snapshot.account,
      });
      setIsInitialized(true);
    };

    window.addEventListener(USER_AUTH_SESSION_EVENT, handleAuthChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(USER_AUTH_SESSION_EVENT, handleAuthChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [applySessionState, clearSessionState, refreshSession]);

  const completeAuthRequest = useCallback(async (
    url: string,
    payload: unknown,
    fallbackMessage: string,
  ): Promise<ActionResult> => {
    const response = await authFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await readJson<{ account?: PublicSessionAccount | null }>(response, fallbackMessage);
    if (!response.ok) {
      return {
        success: false,
        message: data.message ?? fallbackMessage,
      };
    }

    await refreshSession({ silent: true, debugReason: `mutation:${url}` });
    window.dispatchEvent(new Event(USER_AUTH_SESSION_EVENT));
    return {
      success: true,
      account: data.account ?? null,
    };
  }, [refreshSession]);

  const register = useCallback((name: string, email: string, password: string) => {
    return completeAuthRequest(
      "/v1/auth/register",
      { name, email, password },
      "Could not create your account.",
    );
  }, [completeAuthRequest]);

  const login = useCallback((email: string, password: string) => {
    return completeAuthRequest(
      "/v1/auth/login",
      { email, password },
      "Login failed.",
    );
  }, [completeAuthRequest]);

  const registerInstitutional = useCallback((
    name: string,
    email: string,
    password: string,
    institutionId: string,
  ) => {
    return completeAuthRequest(
      "/v1/auth/institutional/register",
      { name, email, password, institutionId },
      "Could not create your institutional account.",
    );
  }, [completeAuthRequest]);

  const loginInstitutional = useCallback((email: string, password: string, institutionId?: string) => {
    return completeAuthRequest(
      "/v1/auth/institutional/login",
      { email, password, institutionId },
      "Institutional login failed.",
    );
  }, [completeAuthRequest]);

  const requestInstitutionPartnership = useCallback(async (
    contactName: string,
    workEmail: string,
    institutionName: string,
    notes: string,
  ) => {
    const response = await authFetch("/v1/auth/institutions/request-partnership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactName, workEmail, institutionName, notes }),
    });

    const data = await readJson<{ request?: { id: string } }>(response, "Could not submit your partnership request.");
    if (!response.ok) {
      return {
        success: false as const,
        message: data.message ?? "Could not submit your partnership request.",
      };
    }

    return {
      success: true as const,
      message: data.message ?? "Your partnership request has been saved.",
    };
  }, []);

  const logout = useCallback(async () => {
    clearSessionState();
    setIsInitialized(true);

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
    } finally {
      await signOutWorkOSSession();
      await clerkSignOut().catch(() => {});
      window.dispatchEvent(new Event(USER_AUTH_SESSION_EVENT));
    }
  }, [clearSessionState, clerkSignOut]);

  const value = useMemo<UserSessionContextValue>(() => ({
    isAuthenticated,
    isConfigured,
    isInitialized,
    account,
    refreshSession,
    register,
    login,
    registerInstitutional,
    loginInstitutional,
    requestInstitutionPartnership,
    logout,
  }), [
    account,
    isAuthenticated,
    isConfigured,
    isInitialized,
    login,
    loginInstitutional,
    logout,
    refreshSession,
    register,
    registerInstitutional,
    requestInstitutionPartnership,
  ]);

  return <UserSessionContext.Provider value={value}>{children}</UserSessionContext.Provider>;
}

export function useUserSession() {
  const ctx = useContext(UserSessionContext);
  if (!ctx) {
    throw new Error("useUserSession must be used within a UserSessionProvider");
  }
  return ctx;
}
