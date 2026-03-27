import { useCallback, useEffect, useState } from "react";

const AUTH_EVENT_NAME = "bulkreferences-admin-auth-changed";

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

export function useAuth() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isConfigured, setIsConfigured] = useState(true);
  const [account, setAccount] = useState<AdminSessionResponse["account"]>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const refreshAuth = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/session", {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load admin session");
      }

      const data = await response.json() as AdminSessionResponse;
      setIsAdmin(Boolean(data.authenticated));
      setIsConfigured(Boolean(data.configured ?? true));
      setAccount(data.account ?? null);
    } catch {
      setIsAdmin(false);
      setAccount(null);
    } finally {
      setIsInitialized(true);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();

    const handleAuthChange = () => {
      void refreshAuth();
    };

    window.addEventListener(AUTH_EVENT_NAME, handleAuthChange);
    return () => {
      window.removeEventListener(AUTH_EVENT_NAME, handleAuthChange);
    };
  }, [refreshAuth]);

  const login = useCallback(async (identifier: string, password: string): Promise<AdminLoginResult> => {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ identifier, password }),
    });

    const data = await response.json().catch(() => ({ message: "Login failed." })) as { message?: string };

    if (!response.ok) {
      return {
        success: false,
        message: data.message ?? "Login failed.",
      };
    }

    window.dispatchEvent(new Event(AUTH_EVENT_NAME));
    await refreshAuth();
    return { success: true };
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setIsAdmin(false);
      setAccount(null);
      window.dispatchEvent(new Event(AUTH_EVENT_NAME));
      void refreshAuth();
    }
  }, [refreshAuth]);

  return { isAdmin, isConfigured, isInitialized, account, login, logout, refreshAuth };
}
