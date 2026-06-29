import { useAuth } from "@clerk/react";
import { useAuth as useWorkOSAuth } from "@workos-inc/authkit-react";
import React, { useRef, type ReactNode } from "react";
import { authDebug } from "@/lib/authDebug";
import { registerWorkOSSignOut } from "@/lib/workosSignOut";
import { USER_AUTH_SESSION_EVENT } from "@/lib/userAuthEvents";
import { clerkJwtTemplate } from "@/oauth/config";
import {
  prewarmOAuthAccessToken,
  setClerkAuthSessionHint,
  setClerkAuthTokenGetter,
  setWorkOSAuthTokenGetter,
  setWorkOSBridgeHint,
  setWorkOSBridgeInactive,
} from "@/oauth/runtime";

function ClerkOAuthSync() {
  const { isLoaded, getToken, userId, isSignedIn } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const lastSessionKeyRef = useRef<string | null>(null);

  React.useEffect(() => {
    if (!isLoaded) {
      authDebug("oauth-clerk", "not-loaded", {});
      setClerkAuthTokenGetter(null);
      setClerkAuthSessionHint(false, false);
      lastSessionKeyRef.current = null;
      return;
    }

    authDebug("oauth-clerk", "register", { isSignedIn, userId: userId ?? null });
    setClerkAuthSessionHint(true, Boolean(isSignedIn));
    setClerkAuthTokenGetter(async () => {
      const get = getTokenRef.current;
      if (clerkJwtTemplate) {
        const fromTemplate = await get({ template: clerkJwtTemplate }).catch(() => null);
        authDebug("oauth-clerk", "template-token", {
          template: clerkJwtTemplate,
          present: Boolean(fromTemplate),
        });
        return fromTemplate ?? null;
      }
      const defaultToken = (await get().catch(() => null)) ?? null;
      authDebug("oauth-clerk", "default-token", {
        present: Boolean(defaultToken),
      });
      return defaultToken;
    });

    if (isSignedIn && userId) {
      prewarmOAuthAccessToken(`clerk:${userId}`);
    }

    const sessionKey = `${Boolean(isSignedIn)}:${userId ?? ""}`;
    if (lastSessionKeyRef.current === null) {
      lastSessionKeyRef.current = sessionKey;
      return;
    }

    if (lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey;
      authDebug("oauth-clerk", "session-changed", { sessionKey });
      window.dispatchEvent(new Event(USER_AUTH_SESSION_EVENT));
    }

    return () => {
      setClerkAuthTokenGetter(null);
      setClerkAuthSessionHint(false, false);
    };
  }, [isLoaded, isSignedIn, userId]);

  return null;
}

function WorkOSOAuthSync() {
  const { getAccessToken, signOut, isLoading, user, organizationId } = useWorkOSAuth();
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const lastKeyRef = useRef<string | null>(null);

  React.useEffect(() => {
    setWorkOSBridgeHint(isLoading, Boolean(user?.id));
    authDebug("oauth-workos", "register", {
      isLoading,
      userId: user?.id ?? null,
      organizationId: organizationId ?? null,
    });

    setWorkOSAuthTokenGetter(async () => {
      if (isLoading) {
        return null;
      }
      try {
        return await getAccessTokenRef.current();
      } catch (err) {
        authDebug("oauth-workos", "getAccessToken:error", {
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    });

    registerWorkOSSignOut(async () => {
      await Promise.resolve(signOutRef.current({ returnTo: `${window.location.origin}/` }));
    });

    if (isLoading) {
      return () => {
        setWorkOSAuthTokenGetter(null);
        registerWorkOSSignOut(null);
        setWorkOSBridgeInactive();
      };
    }

    if (user?.id) {
      prewarmOAuthAccessToken(`workos:${user.id}:${organizationId ?? ""}`);
    }

    const sessionKey = `${user?.id ?? ""}:${organizationId ?? ""}`;
    if (lastKeyRef.current === null) {
      lastKeyRef.current = sessionKey;
      return () => {
        setWorkOSAuthTokenGetter(null);
        registerWorkOSSignOut(null);
        setWorkOSBridgeInactive();
      };
    }

    if (lastKeyRef.current !== sessionKey) {
      lastKeyRef.current = sessionKey;
      window.dispatchEvent(new Event(USER_AUTH_SESSION_EVENT));
    }

    return () => {
      setWorkOSAuthTokenGetter(null);
      registerWorkOSSignOut(null);
      setWorkOSBridgeInactive();
    };
  }, [isLoading, user?.id, organizationId]);

  return null;
}

export type OAuthRuntimeProviderProps = {
  children?: ReactNode;
  /** When false, WorkOS hooks are not mounted (no AuthKit parent). */
  workosEnabled: boolean;
};

/**
 * Single place that registers Clerk + WorkOS token getters and emits `USER_AUTH_SESSION_EVENT`
 * only when identity actually changes.
 */
export function OAuthRuntimeProvider({ children, workosEnabled }: OAuthRuntimeProviderProps) {
  return (
    <>
      <ClerkOAuthSync />
      {workosEnabled ? <WorkOSOAuthSync /> : null}
      {children ?? null}
    </>
  );
}
