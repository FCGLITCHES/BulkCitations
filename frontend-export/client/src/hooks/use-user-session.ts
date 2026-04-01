import { useEffect, useState } from "react";

const USER_AUTH_EVENT_NAME = "bulkreferences-user-auth-changed";

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

async function readJson<T>(response: Response, fallbackMessage: string) {
  return response.json().catch(() => ({ message: fallbackMessage })) as Promise<T & { message?: string }>;
}

export function useUserSession() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isConfigured, setIsConfigured] = useState(true);
  const [account, setAccount] = useState<PublicSessionAccount | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  async function refreshSession() {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load account session");
      }

      const data = await response.json() as PublicSessionResponse;
      setIsAuthenticated(Boolean(data.authenticated));
      setIsConfigured(Boolean(data.configured ?? true));
      setAccount(data.account ?? null);
    } catch {
      setIsAuthenticated(false);
      setAccount(null);
    } finally {
      setIsInitialized(true);
    }
  }

  useEffect(() => {
    void refreshSession();

    const handleAuthChange = () => {
      void refreshSession();
    };

    window.addEventListener(USER_AUTH_EVENT_NAME, handleAuthChange);
    return () => {
      window.removeEventListener(USER_AUTH_EVENT_NAME, handleAuthChange);
    };
  }, []);

  async function completeAuthRequest(url: string, payload: unknown, fallbackMessage: string): Promise<ActionResult> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const data = await readJson<{ account?: PublicSessionAccount | null }>(response, fallbackMessage);
    if (!response.ok) {
      return {
        success: false,
        message: data.message ?? fallbackMessage,
      };
    }

    window.dispatchEvent(new Event(USER_AUTH_EVENT_NAME));
    await refreshSession();
    return {
      success: true,
      account: data.account ?? null,
    };
  }

  async function register(name: string, email: string, password: string) {
    return completeAuthRequest(
      "/api/auth/register",
      { name, email, password },
      "Could not create your account.",
    );
  }

  async function login(email: string, password: string) {
    return completeAuthRequest(
      "/api/auth/login",
      { email, password },
      "Login failed.",
    );
  }

  async function registerInstitutional(name: string, email: string, password: string, institutionId: string) {
    return completeAuthRequest(
      "/api/auth/institutional/register",
      { name, email, password, institutionId },
      "Could not create your institutional account.",
    );
  }

  async function loginInstitutional(email: string, password: string, institutionId?: string) {
    return completeAuthRequest(
      "/api/auth/institutional/login",
      { email, password, institutionId },
      "Institutional login failed.",
    );
  }

  async function requestInstitutionPartnership(contactName: string, workEmail: string, institutionName: string, notes: string) {
    const response = await fetch("/api/auth/institutions/request-partnership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
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
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setIsAuthenticated(false);
      setAccount(null);
      window.dispatchEvent(new Event(USER_AUTH_EVENT_NAME));
      void refreshSession();
    }
  }

  return {
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
  };
}
