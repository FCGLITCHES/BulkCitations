import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, BookCopy, LockKeyhole, Sparkles, UserRoundPlus } from "lucide-react";
import { useUserSession } from "@/hooks/use-user-session";

type ViewMode = "login" | "register";

export default function Login() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isConfigured, isInitialized, login, register } = useUserSession();
  const [view, setView] = useState<ViewMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isInitialized && isAuthenticated) {
      setLocation("/history");
    }
  }, [isAuthenticated, isInitialized, setLocation]);

  function resetMessages() {
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setIsPending(true);

    void (async () => {
      try {
        const result = view === "login"
          ? await login(email, password)
          : await register(name, email, password);

        if (!result.success) {
          setError(result.message);
          return;
        }

        setLocation("/history");
      } finally {
        setIsPending(false);
      }
    })();
  }

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,_rgba(206,228,255,0.65),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(255,218,180,0.35),_transparent_28%),linear-gradient(135deg,_#f7f3ec_0%,_#f4f8fb_52%,_#ebf1f6_100%)] text-slate-950">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <nav className="flex items-center justify-between rounded-full border border-slate-200/70 bg-white/78 px-5 py-3 shadow-sm backdrop-blur">
          <Link href="/">
            <span className="cursor-pointer font-headline text-xl font-black tracking-tight text-[#0f2747]">
              BulkReferences
            </span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            <Link href="/institutional-login" className="text-[#0f2747] transition hover:opacity-70">
              Institutional access
            </Link>
            <a href="/contact" className="text-[#0f2747] transition hover:opacity-70">
              Support
            </a>
          </div>
        </nav>

        <main className="flex flex-1 items-center py-10">
          <div className="grid w-full gap-8 lg:grid-cols-[1.08fr_0.92fr]">
            <section className="relative overflow-hidden rounded-[2rem] border border-[#11305a]/10 bg-[#102544] px-7 py-8 text-white shadow-[0_30px_90px_-38px_rgba(9,24,48,0.65)] sm:px-10 sm:py-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.17),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(255,177,102,0.16),_transparent_30%)]" />
              <div className="relative space-y-8">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-200">
                  <Sparkles className="h-4 w-4" />
                  Personal workspace
                </div>

                <div className="max-w-2xl space-y-4">
                  <h1 className="font-headline text-4xl font-black tracking-tight text-white sm:text-5xl">
                    Sign in to keep your citation work moving
                  </h1>
                  <p className="max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
                    Create an individual account for your conversion history and return to your workflow without juggling temp state across devices.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                      <LockKeyhole className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-white">Private account session</p>
                    <p className="mt-2 text-xs leading-6 text-slate-300">Your login is persisted server-side with secure cookies, not just a local-only toggle.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                      <BookCopy className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-white">History-first workflow</p>
                    <p className="mt-2 text-xs leading-6 text-slate-300">Jump straight into your archive after authentication instead of landing on a dead-end stub.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                      <UserRoundPlus className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-white">Institution-ready path</p>
                    <p className="mt-2 text-xs leading-6 text-slate-300">Need an organization-linked account instead? Move to the institutional login flow without leaving the site.</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200/70 bg-white/92 p-6 shadow-[0_24px_70px_-36px_rgba(25,28,31,0.28)] backdrop-blur sm:p-8">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setView("login");
                    resetMessages();
                  }}
                  className={`rounded-full px-4 py-2 font-semibold transition ${view === "login" ? "bg-[#102544] text-white shadow-sm" : "text-slate-600"}`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setView("register");
                    resetMessages();
                  }}
                  className={`rounded-full px-4 py-2 font-semibold transition ${view === "register" ? "bg-[#102544] text-white shadow-sm" : "text-slate-600"}`}
                >
                  Create account
                </button>
              </div>

              <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    {view === "login" ? "Account sign in" : "Create your workspace"}
                  </p>
                  <h2 className="mt-3 font-headline text-3xl font-black tracking-tight text-[#102544]">
                    {view === "login" ? "Welcome back" : "Start with a secure personal account"}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {view === "login"
                      ? "Use your email and password to continue into your BulkReferences workspace."
                      : "Create an individual account in one step and we will open your session immediately."}
                  </p>
                </div>

                {view === "register" && (
                  <label className="block space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Full name</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#102544] focus:bg-white"
                      placeholder="Jane Researcher"
                      autoComplete="name"
                    />
                  </label>
                )}

                <label className="block space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Email address</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#102544] focus:bg-white"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Password</span>
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#102544] focus:bg-white"
                    placeholder="At least 10 characters"
                    autoComplete={view === "login" ? "current-password" : "new-password"}
                  />
                </label>

                {!isConfigured && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    `APP_SESSION_SECRET` is missing, so public sign-in cannot be enabled yet.
                  </div>
                )}

                {error && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isPending || !isConfigured}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#102544_0%,#204878_100%)] px-4 py-4 text-sm font-bold text-white transition hover:translate-y-[-1px] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>
                    {isPending
                      ? (view === "login" ? "Signing you in..." : "Creating account...")
                      : (view === "login" ? "Open my workspace" : "Create account and continue")}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Need organization access?</p>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Team or university account holders should use the institutional login path so the account can be matched against an approved domain.
                </p>
                <Link
                  href="/institutional-login"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#102544] underline decoration-[#102544]/30 underline-offset-4"
                >
                  Continue to institutional login
                </Link>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
