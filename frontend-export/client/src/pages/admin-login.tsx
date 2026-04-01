import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { LandingNavbar } from "@/components/landing-navbar";
import { AdminFooter } from "@/components/AdminFooter";

type ViewMode = "login" | "request";

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const { isAdmin, isConfigured, isInitialized, account, login } = useAuth();
  const [view, setView] = useState<ViewMode>("login");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [requestName, setRequestName] = useState("");
  const [requestUsername, setRequestUsername] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestPassword, setRequestPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoginPending, setIsLoginPending] = useState(false);
  const [isRequestPending, setIsRequestPending] = useState(false);

  useEffect(() => {
    document.title = "Admin Access - BulkReferences";
    if (isInitialized && isAdmin) {
      setLocation("/admin/dashboard");
    }
  }, [isAdmin, isInitialized, setLocation]);

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoginPending(true);

    void (async () => {
      try {
        const result = await login(loginIdentifier, loginPassword);
        if (!result.success) {
          setError(result.message);
          return;
        }

        setLocation("/admin/dashboard");
      } finally {
        setIsLoginPending(false);
      }
    })();
  }

  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsRequestPending(true);

    void (async () => {
      try {
        const response = await fetch("/api/admin/request-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: requestName,
            username: requestUsername,
            email: requestEmail,
            password: requestPassword,
          }),
        });

        const payload = await response.json().catch(() => ({ message: "Request failed." })) as { message?: string };
        if (!response.ok) {
          setError(payload.message ?? "Request failed.");
          return;
        }

        setSuccess(payload.message ?? "Your request was submitted.");
        setView("login");
        setRequestName("");
        setRequestUsername("");
        setRequestEmail("");
        setRequestPassword("");
      } finally {
        setIsRequestPending(false);
      }
    })();
  }

  return (
    <div className="bg-surface text-on-background min-h-screen flex flex-col transition-colors">
      <LandingNavbar />

      <main className="flex-grow flex items-center justify-center px-4 py-12 md:py-20 relative z-10">
        <div className="w-full max-w-[440px] bg-surface-container-lowest rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="px-8 py-10 md:px-12 md:py-14">
            {/* Header Section */}
            <div className="mb-10 text-center">
              <h1 className="text-3xl font-bold text-primary-container dark:text-blue-50 mb-3 tracking-tight">
                Admin Portal
              </h1>
              <p className="text-on-surface-variant text-sm font-body">
                {view === "login" 
                  ? "Approved admin access and dashboard tools." 
                  : "Request restricted access to administrative systems."}
              </p>
            </div>

            {/* View Switcher Tabs */}
            <div className="flex bg-surface-container-low rounded-lg p-1 mb-8">
              <button
                onClick={() => { setView("login"); setError(null); setSuccess(null); }}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${view === "login" ? "bg-surface-container-lowest text-primary-container shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setView("request"); setError(null); setSuccess(null); }}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${view === "request" ? "bg-surface-container-lowest text-primary-container shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
              >
                Request
              </button>
            </div>

            {/* Status Messages */}
            {error && (
              <div className="mb-6 p-4 bg-error-container/20 border border-error/10 text-error text-sm rounded-lg">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg">
                {success}
              </div>
            )}
            {!isConfigured && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg">
                `ADMIN_SESSION_SECRET` is missing. Admin access is disabled.
              </div>
            )}

            {/* Forms */}
            {view === "login" ? (
              <form className="space-y-6" onSubmit={handleLoginSubmit}>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="identifier">Identifier</label>
                  <input
                    className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                    id="identifier"
                    placeholder="Username or email"
                    required
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="password">Password</label>
                  <input
                    className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                <div className="pt-4">
                  <button
                    disabled={isLoginPending || !isConfigured}
                    className="w-full bg-[#002147] text-white py-4 rounded-lg font-bold text-sm tracking-wide shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    type="submit"
                  >
                    {isLoginPending ? "Authenticating..." : "Enter Portal"}
                  </button>
                </div>
              </form>
            ) : (
              <form className="space-y-6" onSubmit={handleRequestSubmit}>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="req-name">Full Name</label>
                  <input
                    className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                    id="req-name"
                    placeholder="Jane Archivist"
                    required
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="req-user">Username</label>
                  <input
                    className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                    id="req-user"
                    placeholder="archivist_01"
                    required
                    value={requestUsername}
                    onChange={(e) => setRequestUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="req-email">Work Email</label>
                  <input
                    className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                    id="req-email"
                    type="email"
                    placeholder="you@bulkreferences.com"
                    required
                    value={requestEmail}
                    onChange={(e) => setRequestEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="req-pass">Create Password</label>
                  <input
                    className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                    id="req-pass"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={requestPassword}
                    onChange={(e) => setRequestPassword(e.target.value)}
                  />
                </div>
                <div className="pt-4">
                  <button
                    disabled={isRequestPending || !isConfigured}
                    className="w-full bg-[#002147] text-white py-4 rounded-lg font-bold text-sm tracking-wide shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    type="submit"
                  >
                    {isRequestPending ? "Submitting..." : "Submit Request"}
                  </button>
                </div>
              </form>
            )}

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-outline-variant/20 text-center">
              <p className="text-[11px] text-on-surface-variant italic mb-4 px-4 leading-relaxed">
                Approved admins are redirected immediately. Requests are reviewed by the security team.
              </p>
              <Link href="/login" className="text-xs font-semibold uppercase tracking-widest text-primary-container dark:text-blue-200 hover:opacity-70 transition-opacity">
                Return to Public Portal
              </Link>
            </div>
          </div>
        </div>

        {/* Background Decorative elements */}
        <div className="fixed inset-0 -z-0 overflow-hidden pointer-events-none opacity-40">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary-container/5 dark:bg-primary-container/10 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary-container/10 dark:bg-secondary-container/20 rounded-full blur-[100px]"></div>
        </div>
      </main>
      <AdminFooter />
    </div>
  );
}
