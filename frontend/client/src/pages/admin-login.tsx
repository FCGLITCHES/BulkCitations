import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { LandingNavbar } from "@/components/landing-navbar";
import { AdminFooter } from "@/components/AdminFooter";
import { buildAuthEntryUrl, parseLoginMode, readSafeRedirect } from "@/lib/loginFlow";
import { workosEnabled } from "@/oauth/config";

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const authMode = parseLoginMode(search);
  const isSignUpMode = authMode === "sign-up";
  const afterAuthPath = readSafeRedirect(search) ?? "/admin/dashboard";
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { isAdmin, isConfigured, isInitialized, refreshAuth } = useAdminAuth();
  const [signingOut, setSigningOut] = useState(false);
  const adminSignInUrl = buildAuthEntryUrl({ flow: "admin", mode: "sign-in", redirect: afterAuthPath });
  const adminSignUpUrl = buildAuthEntryUrl({ flow: "admin", mode: "sign-up", redirect: afterAuthPath });

  useEffect(() => {
    document.title = isSignUpMode
      ? "Admin sign up - BulkReferences"
      : "Admin sign in - BulkReferences";
    if (isInitialized && isAdmin) {
      setLocation(afterAuthPath);
    }
  }, [afterAuthPath, isAdmin, isInitialized, isSignUpMode, setLocation]);

  const handleSignOutForAdmin = () => {
    setSigningOut(true);
    void signOut({ redirectUrl: window.location.href }).finally(() => {
      setSigningOut(false);
    });
  };

  const showClerkSignIn = clerkLoaded && !isSignedIn;
  const waitForAdminProbe = clerkLoaded && isSignedIn && !isInitialized;
  const signedInProbeUnavailable = clerkLoaded && isSignedIn && isInitialized && !isAdmin && !isConfigured;
  const signedInNotAdmin = clerkLoaded && isSignedIn && isInitialized && !isAdmin && isConfigured;
  const redirectingAdmin = clerkLoaded && isSignedIn && isInitialized && isAdmin;

  return (
    <div className="bg-surface text-on-background min-h-screen flex flex-col transition-colors">
      <LandingNavbar />

      <main className="flex-grow flex items-center justify-center px-4 py-12 md:py-20 relative z-10">
        <div className="w-full max-w-[440px] bg-surface-container-lowest rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="px-4 py-8 md:px-8 md:py-10">
            <div className="mb-6 text-center">
              <h1 className="text-2xl md:text-3xl font-bold text-primary-container dark:text-blue-50 mb-2 tracking-tight">
                {isSignUpMode ? "Admin sign up" : "Admin sign in"}
              </h1>
              <p className="text-on-surface-variant text-sm font-body">
                {isSignUpMode
                  ? "Create the Clerk account you use for staff access. Admin authorization is checked separately after sign-up, so only approved administrator accounts can open the dashboard."
                  : "Sign in with your Clerk administrator account. Admin access uses its own Clerk entrypoint and only approved administrator accounts can open the dashboard."}
              </p>
            </div>

            {!isConfigured && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg">
                Admin session verification is temporarily unavailable or not fully configured. Keep this tab open and retry once the API is stable if sign-in succeeds but the dashboard does not load.
              </div>
            )}

            <div className="flex justify-center min-h-[280px] flex-col items-center">
              {/*
                Clerk's <SignIn /> redirects immediately when a session already exists, which felt like
                "Admin link signed me in". Only mount it when there is no Clerk session; otherwise gate
                with sign-out so admins can use a dedicated account.
                Hash routing avoids /adm1n/... URL segments conflicting with wouter.
              */}
              {!clerkLoaded ? (
                <p className="text-sm text-on-surface-variant">Loading…</p>
              ) : redirectingAdmin ? (
                <p className="text-sm text-on-surface-variant">Opening dashboard…</p>
              ) : waitForAdminProbe ? (
                <p className="text-sm text-on-surface-variant">Checking administrator access…</p>
              ) : signedInProbeUnavailable ? (
                <div className="w-full space-y-4 text-center">
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Admin access could not be verified yet because the session check is temporarily unavailable. This is not being treated as a wrong-account result.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void refreshAuth({ silent: false, debugReason: "admin-login:manual-retry" });
                    }}
                    className="rounded-[5px] bg-[#002147] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#001634]"
                  >
                    Retry access check
                  </button>
                </div>
              ) : signedInNotAdmin ? (
                <div className="w-full space-y-4 text-center">
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    {isSignUpMode
                      ? "This Clerk account has been created and signed in, but the API has not resolved administrator access for it yet. If this email should be staff, complete the admin approval step, then return to the admin portal."
                      : "This Clerk account is signed in, but the API did not resolve administrator access for the current profile. Sign out first, then sign in with your approved admin Clerk account."}
                  </p>
                  <button
                    type="button"
                    disabled={signingOut}
                    onClick={handleSignOutForAdmin}
                    className="rounded-[5px] bg-[#002147] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#001634] disabled:opacity-60"
                  >
                    {signingOut ? "Signing out…" : "Sign out and use admin account"}
                  </button>
                </div>
              ) : showClerkSignIn ? isSignUpMode ? (
                <SignUp
                  routing="hash"
                  forceRedirectUrl={afterAuthPath}
                  signInUrl={adminSignInUrl}
                />
              ) : (
                <SignIn
                  routing="hash"
                  forceRedirectUrl={afterAuthPath}
                  signUpForceRedirectUrl={afterAuthPath}
                  signUpUrl={adminSignUpUrl}
                />
              ) : null}
            </div>

            <div className="mt-8 pt-6 border-t border-outline-variant/20 text-center space-y-3">
              <p className="text-[11px] text-on-surface-variant px-2 leading-relaxed">
                If you are not an administrator, use{" "}
                <Link
                  href={buildAuthEntryUrl({ flow: "user", mode: "sign-in" })}
                  className="font-semibold text-primary-container dark:text-blue-200 hover:underline"
                >
                  individual sign-in
                </Link>
                {workosEnabled ? (
                  <>
                    {" "}or{" "}
                    <Link href="/institutional-login" className="font-semibold text-primary-container dark:text-blue-200 hover:underline">
                      institutional SSO
                    </Link>
                  </>
                ) : null}
                .
              </p>
            </div>
          </div>
        </div>

        <div className="fixed inset-0 -z-0 overflow-hidden pointer-events-none opacity-40">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary-container/5 dark:bg-primary-container/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary-container/10 dark:bg-secondary-container/20 rounded-full blur-[100px]" />
        </div>
      </main>
      <AdminFooter />
    </div>
  );
}
