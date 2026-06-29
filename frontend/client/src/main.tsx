import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { Router, Route, Switch, useLocation } from "wouter";
import { ClerkProvider } from "@clerk/react";
import ScrollToTop from "./components/scroll-to-top";
import { BetaFeedbackBanner } from "./components/beta-feedback-banner";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "./components/ui/toaster";
import { AdminAuthProvider, useAdminAuth } from "./hooks/use-admin-auth";
import { UserSessionProvider } from "./hooks/use-user-session";
import { trackAnalyticsEvent } from "./lib/analytics";
import { AuthKitProvider } from "@workos-inc/authkit-react";
import { OAuthRuntimeProvider } from "./oauth/OAuthRuntimeProvider";
import { workosClientId, workosEnabled } from "./oauth/config";
import { getWorkOSAuthKitConnection } from "./oauth/workosConnection";
import { AuthStateSync } from "./providers/auth-state-sync";
import Home from "./pages/home";
import "./index.css";

const FAQ = lazy(() => import("./pages/faq"));
const Privacy = lazy(() => import("./pages/privacy"));
const About = lazy(() => import("./pages/about"));
const Contact = lazy(() => import("./pages/contact"));
const AdminReportQueue = lazy(() => import("./components/AdminReportQueue"));
const AdminReportDetail = lazy(() => import("./components/AdminReportDetail"));
const AdminAnalytics = lazy(() => import("./components/AdminAnalytics"));
const AdminDashboard = lazy(() => import("./components/AdminDashboard"));
const AdminSystemHealth = lazy(() => import("./components/AdminSystemHealth"));
const AdminDiagnostics = lazy(() => import("./components/AdminDiagnostics"));
const AdminSettings = lazy(() => import("./components/AdminSettings"));
const AdminReferences = lazy(() => import("./components/AdminReferences"));
const AdminTraining = lazy(() => import("./components/AdminTraining"));
const AdminBioTraining = lazy(() => import("./components/AdminBioTraining"));
const Login = lazy(() => import("./pages/login"));
const AdminLogin = lazy(() => import("./pages/admin-login"));
const AdminApprove = lazy(() => import("./pages/admin-approve"));
const HistoryPage = lazy(() => import("./pages/history"));
const Prices = lazy(() => import("./pages/prices"));
const Resources = lazy(() => import("./pages/resources"));
const ApiDocs = lazy(() => import("./pages/api-docs"));
const InstitutionalLogin = lazy(() => import("./pages/institutional-login"));
const NotFound = lazy(() => import("./pages/not-found"));

function RouteLoadingScreen({
  message = "Loading page...",
}: {
  message?: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center px-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, isInitialized } = useAdminAuth();
  const [, setLocation] = useLocation();

  const redirectingRef = React.useRef(false);

  React.useEffect(() => {
    if (!isInitialized || isAdmin) {
      redirectingRef.current = false;
      return;
    }
    if (redirectingRef.current) {
      return;
    }
    redirectingRef.current = true;
    setLocation("/adm1n", { replace: true });
  }, [isAdmin, isInitialized, setLocation]);

  if (!isInitialized) {
    return <RouteLoadingScreen message="Checking admin session..." />;
  }

  if (!isAdmin) {
    return <RouteLoadingScreen message="Redirecting to admin login..." />;
  }

  return <>{children}</>;
}

function AdminQueueRoute() {
  return (
    <RequireAdmin>
      <AdminReportQueue />
    </RequireAdmin>
  );
}

function AdminDetailRoute() {
  return (
    <RequireAdmin>
      <AdminReportDetail />
    </RequireAdmin>
  );
}

function AdminAnalyticsRoute() {
  return (
    <RequireAdmin>
      <AdminAnalytics />
    </RequireAdmin>
  );
}

function AdminDashboardRoute() {
  return (
    <RequireAdmin>
      <AdminDashboard />
    </RequireAdmin>
  );
}

function AdminHealthRoute() {
  return (
    <RequireAdmin>
      <AdminSystemHealth />
    </RequireAdmin>
  );
}

function AdminDiagnosticsRoute() {
  return (
    <RequireAdmin>
      <AdminDiagnostics />
    </RequireAdmin>
  );
}

function AdminSettingsRoute() {
  return (
    <RequireAdmin>
      <AdminSettings />
    </RequireAdmin>
  );
}

function AdminReferencesRoute() {
  return (
    <RequireAdmin>
      <AdminReferences />
    </RequireAdmin>
  );
}

function AdminTrainingRoute() {
  return (
    <RequireAdmin>
      <AdminTraining />
    </RequireAdmin>
  );
}

function AdminBioTrainingRoute() {
  return (
    <RequireAdmin>
      <AdminBioTraining />
    </RequireAdmin>
  );
}

/** Clerk path-routing used to leave users on /adm1n/dashboard; send them to the real admin app. */
function Adm1nDashboardRedirect() {
  const [, setLocation] = useLocation();

  React.useLayoutEffect(() => {
    setLocation("/admin/dashboard", { replace: true });
  }, [setLocation]);

  return <RouteLoadingScreen message="Opening dashboard…" />;
}

function AnalyticsRouteTracker() {
  const [location] = useLocation();

  React.useEffect(() => {
    if (location.startsWith("/admin")) return;
    if (location.startsWith("/login")) return;
    if (location.startsWith("/adm1n")) return;
    if (location.startsWith("/admin-login")) return;

    trackAnalyticsEvent("page_view", {
      surface: location === "/" ? "home" : "site",
      route: location,
    });
  }, [location]);

  return null;
}

function RouteChrome() {
  const [location] = useLocation();
  const isAdminSurface =
    location.startsWith("/admin") ||
    location.startsWith("/adm1n") ||
    location.startsWith("/admin-login");

  return isAdminSurface ? null : <BetaFeedbackBanner />;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container '#root' was not found.");
}

declare global {
  // eslint-disable-next-line no-var
  var __bulkreferences_root: ReactDOM.Root | undefined;
}

const root = globalThis.__bulkreferences_root ?? ReactDOM.createRoot(container);
globalThis.__bulkreferences_root = root;

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;
// A valid Clerk key is `pk_test_`/`pk_live_` + a long base64 host. An empty or placeholder key makes
// Clerk request a malformed host and fail with ERR_NAME_NOT_RESOLVED, white-screening the app — so
// guard it and render a clear message instead of failing cryptically.
const clerkKeyValid =
  typeof clerkPublishableKey === "string" &&
  /^pk_(test|live)_.{16,}$/.test(clerkPublishableKey);
if (!clerkKeyValid) {
  // eslint-disable-next-line no-console
  console.error(
    "[auth] VITE_CLERK_PUBLISHABLE_KEY is missing or invalid — Clerk cannot load. Set it in the " +
      "repo-root .env and RESTART the dev server (Vite reads env only at startup).",
  );
}
function AppTree() {
  return (
    <>
      <OAuthRuntimeProvider workosEnabled={workosEnabled} />
      <UserSessionProvider>
        <AdminAuthProvider>
          <QueryClientProvider client={queryClient}>
            <AuthStateSync />
            <Router>
              <ScrollToTop />
              <AnalyticsRouteTracker />
              <RouteChrome />
              <Suspense fallback={<RouteLoadingScreen />}>
                <Switch>
                  <Route path="/" component={Home} />
                  <Route path="/faq" component={FAQ} />
                  <Route path="/privacy" component={Privacy} />
                  <Route path="/about" component={About} />
                  <Route path="/contact" component={Contact} />
                  <Route path="/login" component={Login} />
                  <Route path="/adm1n/approve" component={AdminApprove} />
                  <Route
                    path="/adm1n/dashboard"
                    component={Adm1nDashboardRedirect}
                  />
                  <Route path="/adm1n/*?" component={AdminLogin} />
                  <Route path="/admin-login/*?" component={AdminLogin} />
                  <Route path="/history" component={HistoryPage} />
                  <Route path="/prices" component={Prices} />
                  <Route path="/resources" component={Resources} />
                  <Route path="/api-docs" component={ApiDocs} />
                  <Route
                    path="/institutional-login"
                    component={InstitutionalLogin}
                  />
                  <Route path="/admin" component={AdminDashboardRoute} />
                  <Route
                    path="/admin/dashboard"
                    component={AdminDashboardRoute}
                  />
                  <Route
                    path="/admin/review/reports"
                    component={AdminQueueRoute}
                  />
                  <Route
                    path="/admin/review/bio/tagging"
                    component={AdminBioTrainingRoute}
                  />
                  <Route
                    path="/admin/review/bio/training"
                    component={AdminBioTrainingRoute}
                  />
                  <Route
                    path="/admin/review/bio/runtime"
                    component={AdminBioTrainingRoute}
                  />
                  <Route
                    path="/admin/review/bio/review"
                    component={AdminBioTrainingRoute}
                  />
                  <Route
                    path="/admin/review/bio"
                    component={AdminBioTrainingRoute}
                  />
                  <Route path="/admin/review" component={AdminTrainingRoute} />
                  <Route
                    path="/admin/engine"
                    component={AdminDiagnosticsRoute}
                  />
                  <Route path="/admin/data" component={AdminReferencesRoute} />
                  <Route path="/admin/reports" component={AdminQueueRoute} />
                  <Route
                    path="/admin/analytics"
                    component={AdminAnalyticsRoute}
                  />
                  <Route
                    path="/admin/diagnostics"
                    component={AdminDiagnosticsRoute}
                  />
                  <Route path="/admin/health" component={AdminHealthRoute} />
                  <Route
                    path="/admin/settings/profile"
                    component={AdminSettingsRoute}
                  />
                  <Route
                    path="/admin/settings"
                    component={AdminSettingsRoute}
                  />
                  <Route
                    path="/admin/references"
                    component={AdminReferencesRoute}
                  />
                  <Route
                    path="/admin/training"
                    component={AdminTrainingRoute}
                  />
                  <Route
                    path="/admin/bio-training"
                    component={AdminBioTrainingRoute}
                  />
                  <Route
                    path="/admin/bio-training/tagging"
                    component={AdminBioTrainingRoute}
                  />
                  <Route
                    path="/admin/bio-training/training"
                    component={AdminBioTrainingRoute}
                  />
                  <Route
                    path="/admin/bio-training/runtime"
                    component={AdminBioTrainingRoute}
                  />
                  <Route
                    path="/admin/reports/:id"
                    component={AdminDetailRoute}
                  />
                  <Route component={NotFound} />
                </Switch>
              </Suspense>
            </Router>
            <Toaster />
          </QueryClientProvider>
        </AdminAuthProvider>
      </UserSessionProvider>
    </>
  );
}

const RootMode = import.meta.env.DEV ? React.Fragment : React.StrictMode;

function ClerkKeyMissingScreen() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#0b1120",
        color: "#e2e8f0",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 560, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
          Authentication isn&apos;t configured
        </h1>
        <p style={{ marginBottom: 16 }}>
          <code>VITE_CLERK_PUBLISHABLE_KEY</code> is missing or invalid, so Clerk can&apos;t load
          (you&apos;d see <code>ERR_NAME_NOT_RESOLVED</code> in the console).
        </p>
        <ol style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>
            Add <code>VITE_CLERK_PUBLISHABLE_KEY=pk_test_…</code> to the repo-root{" "}
            <code>.env</code>.
          </li>
          <li>
            <strong>Restart the dev server</strong> — Vite reads env only at startup.
          </li>
        </ol>
      </div>
    </div>
  );
}

root.render(
  <RootMode>
    {clerkKeyValid ? (
      <ClerkProvider
        publishableKey={clerkPublishableKey ?? ""}
        afterSignOutUrl="/"
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
      >
        {workosEnabled && workosClientId ? (
          <AuthKitProvider
            clientId={workosClientId}
            {...getWorkOSAuthKitConnection()}
            onRedirectCallback={({ state }) => {
              const returnTo =
                state &&
                typeof state === "object" &&
                state !== null &&
                "returnTo" in state
                  ? String((state as { returnTo?: unknown }).returnTo ?? "")
                  : "";
              if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
                window.location.assign(returnTo);
              }
            }}
          >
            <AppTree />
          </AuthKitProvider>
        ) : (
          <AppTree />
        )}
      </ClerkProvider>
    ) : (
      <ClerkKeyMissingScreen />
    )}
  </RootMode>,
);
