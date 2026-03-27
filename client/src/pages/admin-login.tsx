import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, CheckCircle2, KeyRound, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,_rgba(174,199,246,0.34),_transparent_28%),linear-gradient(135deg,_#f8f9fb_0%,_#edf1f5_55%,_#e6ebf0_100%)] text-slate-950">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <nav className="flex items-center justify-between rounded-full border border-slate-200/80 bg-white/75 px-5 py-3 shadow-sm backdrop-blur">
          <Link href="/">
            <span className="cursor-pointer font-headline text-xl font-black tracking-tight text-[#001b3d]">
              BulkReferences
            </span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            <span className="hidden sm:inline">Admin Portal</span>
            <a href="/admin-login" className="text-[#002147] transition hover:opacity-70">
              Easy link
            </a>
            <a href="/contact" className="text-[#002147] transition hover:opacity-70">
              Support
            </a>
          </div>
        </nav>

        <main className="flex flex-1 items-center py-10">
          <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="relative overflow-hidden rounded-[2rem] border border-slate-200/70 bg-[#001329] px-7 py-8 text-white shadow-[0_30px_80px_-32px_rgba(0,18,43,0.55)] sm:px-10 sm:py-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(174,199,246,0.28),_transparent_35%),radial-gradient(circle_at_bottom_left,_rgba(194,233,201,0.18),_transparent_30%)]" />
              <div className="relative space-y-8">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-200">
                  <ShieldCheck className="h-4 w-4" />
                  Restricted route: /adm1n
                </div>

                <div className="max-w-2xl space-y-4">
                  <h1 className="font-headline text-4xl font-black tracking-tight text-white sm:text-5xl">
                    The Digital Archivist
                  </h1>
                  <p className="max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
                    This portal is reserved for approved BulkReferences administrators. New admins can request access here, and the request is routed to <span className="font-semibold text-white">support@bulkreferences.com</span> for approval before dashboard access is granted.
                  </p>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
                    Direct admin entry: /adm1n or /admin-login
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                      <UserPlus className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-white">1. Request access</p>
                    <p className="mt-2 text-xs leading-6 text-slate-300">Create your admin profile with a work email, username, and password.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                      <Mail className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-white">2. Await approval</p>
                    <p className="mt-2 text-xs leading-6 text-slate-300">The approval request is sent directly to the contact inbox for review.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-white">3. Enter dashboard</p>
                    <p className="mt-2 text-xs leading-6 text-slate-300">Approved admins can sign in and reach the reporting dashboard immediately.</p>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 p-5 backdrop-blur">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">Current session</p>
                  <p className="mt-3 text-sm text-slate-200">
                    {account
                      ? `Signed in as ${account.name} (@${account.username}).`
                      : "No active admin session detected."}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200/70 bg-white/92 p-6 shadow-[0_24px_70px_-36px_rgba(25,28,31,0.28)] backdrop-blur sm:p-8">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setView("login");
                    setError(null);
                    setSuccess(null);
                  }}
                  className={`rounded-full px-4 py-2 font-semibold transition ${view === "login" ? "bg-[#002147] text-white shadow-sm" : "text-slate-600"}`}
                >
                  Approved admin sign in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setView("request");
                    setError(null);
                    setSuccess(null);
                  }}
                  className={`rounded-full px-4 py-2 font-semibold transition ${view === "request" ? "bg-[#002147] text-white shadow-sm" : "text-slate-600"}`}
                >
                  Request admin access
                </button>
              </div>

              <div className="mt-8">
                {view === "login" ? (
                  <form className="space-y-6" onSubmit={handleLoginSubmit}>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Admin Sign In</p>
                      <h2 className="mt-3 font-headline text-3xl font-black tracking-tight text-[#001b3d]">
                        Access the dashboard
                      </h2>
                      <p className="mt-3 text-sm leading-7 text-slate-600">
                        Sign in with your approved admin username or email and the password you created during the request step.
                      </p>
                    </div>

                    <label className="block space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Email or username</span>
                      <input
                        value={loginIdentifier}
                        onChange={(event) => setLoginIdentifier(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#002147] focus:bg-white"
                        placeholder="archivist_id_01 or you@company.com"
                        autoComplete="username"
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Secure password</span>
                      <input
                        value={loginPassword}
                        onChange={(event) => setLoginPassword(event.target.value)}
                        type="password"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#002147] focus:bg-white"
                        placeholder="••••••••••••"
                        autoComplete="current-password"
                      />
                    </label>

                    {!isConfigured && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        `ADMIN_SESSION_SECRET` is missing, so admin sign-in cannot be enabled yet.
                      </div>
                    )}

                    {error && (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                      </div>
                    )}

                    {success && (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {success}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isLoginPending || !isConfigured}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#000a1e_0%,#002147_100%)] px-4 py-4 text-sm font-bold text-white transition hover:translate-y-[-1px] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span>{isLoginPending ? "Authenticating..." : "Authenticate session"}</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <form className="space-y-5" onSubmit={handleRequestSubmit}>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Admin Access Request</p>
                      <h2 className="mt-3 font-headline text-3xl font-black tracking-tight text-[#001b3d]">
                        Create a pending admin account
                      </h2>
                      <p className="mt-3 text-sm leading-7 text-slate-600">
                        Your account stays locked until the request is approved by the BulkReferences team through the contact inbox.
                      </p>
                    </div>

                    <label className="block space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Full name</span>
                      <input
                        value={requestName}
                        onChange={(event) => setRequestName(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#002147] focus:bg-white"
                        placeholder="Jane Archivist"
                        autoComplete="name"
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Admin username</span>
                      <input
                        value={requestUsername}
                        onChange={(event) => setRequestUsername(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#002147] focus:bg-white"
                        placeholder="archivist_id_01"
                        autoComplete="username"
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Work email</span>
                      <input
                        value={requestEmail}
                        onChange={(event) => setRequestEmail(event.target.value)}
                        type="email"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#002147] focus:bg-white"
                        placeholder="you@bulkreferences.com"
                        autoComplete="email"
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Create password</span>
                      <input
                        value={requestPassword}
                        onChange={(event) => setRequestPassword(event.target.value)}
                        type="password"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#002147] focus:bg-white"
                        placeholder="At least 10 characters"
                        autoComplete="new-password"
                      />
                    </label>

                    {error && (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                      </div>
                    )}

                    {success && (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {success}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isRequestPending || !isConfigured}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#000a1e_0%,#002147_100%)] px-4 py-4 text-sm font-bold text-white transition hover:translate-y-[-1px] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span>{isRequestPending ? "Submitting request..." : "Request admin approval"}</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </form>
                )}
              </div>

              <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                  <p className="leading-7">
                    After approval, admins are sent back here to sign in and are redirected into the protected dashboard.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
