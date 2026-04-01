import { useCallback, useEffect, useRef, useState } from "react";

const AUTH_EVENT_NAME = "bulkreferences-admin-auth-changed";
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

type AdminLoginResult =
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

export function useAuth() {
  const initialSnapshot = readStoredSnapshot();
  const hasFreshSnapshot = isFreshSnapshot(initialSnapshot);
  const [isAdmin, setIsAdmin] = useState(hasFreshSnapshot ? initialSnapshot?.isAdmin ?? false : false);
  const [isConfigured, setIsConfigured] = useState(hasFreshSnapshot ? initialSnapshot?.isConfigured ?? true : true);
  const [account, setAccount] = useState<AdminSessionResponse["account"]>(hasFreshSnapshot ? initialSnapshot?.account ?? null : null);
  const [isInitialized, setIsInitialized] = useState(hasFreshSnapshot);
  const authStateRef = useRef({
    isAdmin: hasFreshSnapshot ? initialSnapshot?.isAdmin ?? false : false,
  });

  const applySessionState = useCallback((data: AdminSessionResponse) => {
    const nextIsAdmin = Boolean(data.authenticated);
    const nextIsConfigured = Boolean(data.configured ?? true);
    const nextAccount = data.account ?? null;

    authStateRef.current = { isAdmin: nextIsAdmin };
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
    authStateRef.current = { isAdmin: false };
    setIsAdmin(false);
    setAccount(null);
    clearStoredSnapshot();
  }, []);

  const refreshAuth = useCallback(async (options?: { keepalive?: boolean; silent?: boolean }) => {
    try {
      const response = await fetch("/api/admin/session", {
        credentials: "include",
        cache: "no-store",
        keepalive: options?.keepalive,
      });

      if (!response.ok) {
        throw new Error("Failed to load admin session");
      }

      const data = await response.json() as AdminSessionResponse;
      applySessionState(data);
    } catch {
      if (!options?.silent) {
        clearSessionState();
      }
    } finally {
      setIsInitialized(true);
    }
  }, [applySessionState, clearSessionState]);

  useEffect(() => {
    if (hasFreshSnapshot) {
      void refreshAuth({ silent: true });
    } else {
      void refreshAuth();
    }

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
        void refreshAuth({ silent: true });
        return;
      }

      clearSessionState();
      setIsInitialized(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && authStateRef.current.isAdmin) {
        void refreshAuth({ keepalive: true, silent: true });
      }
    };

    const handlePageHide = () => {
      if (authStateRef.current.isAdmin) {
        void refreshAuth({ keepalive: true, silent: true });
      }
    };

    window.addEventListener(AUTH_EVENT_NAME, handleAuthChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener(AUTH_EVENT_NAME, handleAuthChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [applySessionState, clearSessionState, hasFreshSnapshot, refreshAuth]);

  const login = useCallback(async (identifier: string, password: string): Promise<AdminLoginResult> => {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ identifier, password }),
    });

    const data = await response.json().catch(() => ({ message: "Login failed." })) as AdminSessionResponse & { message?: string };

    if (!response.ok) {
      return {
        success: false,
        message: data.message ?? "Login failed.",
      };
    }

    applySessionState({
      authenticated: true,
      configured: true,
      account: data?.account ?? null,
    });
    setIsInitialized(true);
    window.dispatchEvent(new Event(AUTH_EVENT_NAME));
    return { success: true };
  }, [applySessionState]);

  const logout = useCallback(async () => {
    clearSessionState();
    setIsInitialized(true);
    window.dispatchEvent(new Event(AUTH_EVENT_NAME));

    void fetch("/api/admin/logout", {
      method: "POST",
      credentials: "include",
      keepalive: true,
    }).catch(() => {
      // Ignore logout transport failures because local sign-out is already complete.
    });
  }, [clearSessionState]);

  return { isAdmin, isConfigured, isInitialized, account, login, logout, refreshAuth };
}
