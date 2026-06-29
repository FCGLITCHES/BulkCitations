import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { SignIn, SignUp, useAuth } from "@clerk/react";
import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";
import {
  buildAuthEntryUrl,
  defaultRedirectForFlow,
  parseLoginFlow,
  parseLoginMode,
  readSafeRedirect,
  shouldUseAdminPortal,
} from "@/lib/loginFlow";
import { workosEnabled } from "@/oauth/config";

function getPostLoginPath(search: string): string {
  return readSafeRedirect(search) ?? defaultRedirectForFlow(parseLoginFlow(search));
}

export default function Login() {
  const [location, setLocation] = useLocation();
  const [entryRedirect, setEntryRedirect] = useState<"admin" | "institutional" | null>(null);
  const search = typeof window !== "undefined" ? window.location.search : "";
  const afterAuthPath = getPostLoginPath(search);
  const authMode = parseLoginMode(search);
  const isSignUpMode = authMode === "sign-up";
  const { isLoaded: isClerkLoaded, isSignedIn } = useAuth();
  const postSignInRedirectDone = useRef(false);
  const userSignInUrl = buildAuthEntryUrl({ flow: "user", mode: "sign-in", redirect: afterAuthPath });
  const userSignUpUrl = buildAuthEntryUrl({ flow: "user", mode: "sign-up", redirect: afterAuthPath });

  useEffect(() => {
    if (location.startsWith("/login")) {
      postSignInRedirectDone.current = false;
    }
  }, [location, workosEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const query = window.location.search;
    if (shouldUseAdminPortal(query)) {
      setEntryRedirect("admin");
      window.location.replace("/adm1n");
      return;
    }
    if (parseLoginFlow(query) === "institutional") {
      if (workosEnabled) {
        setEntryRedirect("institutional");
        window.location.replace("/institutional-login");
      }
    }
  }, [location]);

  useEffect(() => {
    document.title = isSignUpMode
      ? "Sign up · Individual account – BulkReferences"
      : "Sign in · Individual account – BulkReferences";
    if (entryRedirect) {
      return;
    }
    if (!isClerkLoaded || !isSignedIn) {
      postSignInRedirectDone.current = false;
      return;
    }
    if (postSignInRedirectDone.current) {
      return;
    }
    postSignInRedirectDone.current = true;
    setLocation(afterAuthPath);
  }, [afterAuthPath, entryRedirect, isClerkLoaded, isSignedIn, isSignUpMode, setLocation]);

  if (entryRedirect) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-4 text-sm text-on-surface-variant">
        {entryRedirect === "admin"
          ? "Redirecting to administrator sign-in…"
          : "Redirecting to institutional access…"}
      </div>
    );
  }

  return (
    <div className="bg-surface text-on-background min-h-screen flex flex-col transition-colors">
      <LandingNavbar />

      <main className="relative z-10 flex flex-grow items-center justify-center px-4 py-12 md:py-20">
        <div className="w-full max-w-[480px] overflow-hidden rounded-xl bg-surface-container-lowest shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="px-4 py-8 md:px-8 md:py-10">
            <div className="mb-6 text-center">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary-container/90 dark:text-blue-300/90">
                Individual account · Clerk
              </p>
              <h1 className="mb-3 text-2xl font-bold tracking-tight text-primary-container dark:text-blue-50 md:text-3xl">
                {isSignUpMode ? "Create account" : "Sign in"}
              </h1>
              <p className="text-sm text-on-surface-variant">
                Personal access uses Clerk on its own path. Administrator access uses a separate Clerk entrypoint with its own authorization gate.
              </p>
            </div>

            <div className="flex min-h-[320px] items-center justify-center">
              {!isClerkLoaded ? (
                <p className="text-sm text-on-surface-variant">Loading…</p>
              ) : isSignedIn ? (
                <p className="text-sm text-on-surface-variant">Opening your account…</p>
              ) : isSignUpMode ? (
                <SignUp
                  routing="hash"
                  forceRedirectUrl={afterAuthPath}
                  signInUrl={userSignInUrl}
                />
              ) : (
                <SignIn
                  routing="hash"
                  forceRedirectUrl={afterAuthPath}
                  signUpForceRedirectUrl={afterAuthPath}
                  signUpUrl={userSignUpUrl}
                />
              )}
            </div>

            <div className="mt-8 space-y-3 border-t border-outline-variant/20 pt-6 text-center">
              <p className="px-2 text-[11px] leading-relaxed text-on-surface-variant">
                Need a different access path?
              </p>
              <div className="flex flex-col items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest sm:flex-row sm:gap-4">
                {workosEnabled ? (
                  <>
                    <Link
                      href="/institutional-login"
                      className="text-primary-container transition-opacity hover:opacity-80 dark:text-blue-200"
                    >
                      Institutional (WorkOS)
                    </Link>
                    <span className="hidden text-outline-variant sm:inline" aria-hidden>
                      ·
                    </span>
                  </>
                ) : null}
                <Link
                  href={buildAuthEntryUrl({ flow: "admin", mode: "sign-in" })}
                  className="text-primary-container transition-opacity hover:opacity-80 dark:text-blue-200"
                >
                  Administrator
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden opacity-40">
          <div className="absolute left-[-10%] top-[-10%] h-[40%] w-[40%] rounded-full bg-primary-container/5 blur-[120px] dark:bg-primary-container/10" />
          <div className="absolute bottom-[-10%] right-[-10%] h-[30%] w-[30%] rounded-full bg-secondary-container/10 blur-[100px] dark:bg-secondary-container/20" />
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
