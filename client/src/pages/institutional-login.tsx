import { FormEvent, useDeferredValue, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Building2, CircleCheck, Mail, Search, Shield } from "lucide-react";
import { useUserSession } from "@/hooks/use-user-session";

type InstitutionOption = {
  id: string;
  slug: string;
  name: string;
  domains: string[];
};

type AuthMode = "login" | "register";

export default function InstitutionalLogin() {
  const [, setLocation] = useLocation();
  const {
    isAuthenticated,
    isConfigured,
    isInitialized,
    loginInstitutional,
    registerInstitutional,
    requestInstitutionPartnership,
  } = useUserSession();
  const [mode, setMode] = useState<AuthMode>("login");
  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [contactName, setContactName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [notes, setNotes] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [isRequestPending, setIsRequestPending] = useState(false);

  useEffect(() => {
    if (isInitialized && isAuthenticated) {
      setLocation("/history");
    }
  }, [isAuthenticated, isInitialized, setLocation]);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        const query = deferredQuery.trim();
        const response = await fetch(`/api/auth/institutions${query ? `?q=${encodeURIComponent(query)}` : ""}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load institutions");
        }

        const data = await response.json() as { institutions?: InstitutionOption[] };
        if (!isActive) return;
        const nextInstitutions = data.institutions ?? [];
        setInstitutions(nextInstitutions);

        if (!selectedInstitutionId && nextInstitutions.length > 0) {
          setSelectedInstitutionId(nextInstitutions[0].id);
          setInstitutionName(nextInstitutions[0].name);
          return;
        }

        if (selectedInstitutionId && !nextInstitutions.some((institution) => institution.id === selectedInstitutionId)) {
          const fallback = nextInstitutions[0];
          setSelectedInstitutionId(fallback?.id ?? "");
          setInstitutionName(fallback?.name ?? institutionName);
        }
      } catch {
        if (!isActive) return;
        setInstitutions([]);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [deferredQuery, selectedInstitutionId]);

  const selectedInstitution = institutions.find((institution) => institution.id === selectedInstitutionId) ?? null;

  function chooseInstitution(institution: InstitutionOption) {
    setSelectedInstitutionId(institution.id);
    setInstitutionName(institution.name);
    setAuthError(null);
    setRequestError(null);
  }

  function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setIsAuthPending(true);

    if (!selectedInstitutionId) {
      setAuthError("Choose an institution before continuing.");
      setIsAuthPending(false);
      return;
    }

    void (async () => {
      try {
        const result = mode === "login"
          ? await loginInstitutional(email, password, selectedInstitutionId)
          : await registerInstitutional(name, email, password, selectedInstitutionId);

        if (!result.success) {
          setAuthError(result.message);
          return;
        }

        setLocation("/history");
      } finally {
        setIsAuthPending(false);
      }
    })();
  }

  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError(null);
    setRequestMessage(null);
    setIsRequestPending(true);

    void (async () => {
      try {
        const result = await requestInstitutionPartnership(contactName, workEmail, institutionName, notes);
        if (!result.success) {
          setRequestError(result.message);
          return;
        }

        setRequestMessage(result.message);
        setContactName("");
        setWorkEmail("");
        setNotes("");
      } finally {
        setIsRequestPending(false);
      }
    })();
  }

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_right,_rgba(184,223,255,0.55),_transparent_25%),radial-gradient(circle_at_bottom_left,_rgba(198,235,217,0.42),_transparent_30%),linear-gradient(160deg,_#edf6f2_0%,_#f6f2ea_45%,_#eef4fb_100%)] text-slate-950">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <nav className="flex items-center justify-between rounded-full border border-slate-200/70 bg-white/78 px-5 py-3 shadow-sm backdrop-blur">
          <Link href="/">
            <span className="cursor-pointer font-headline text-xl font-black tracking-tight text-[#143354]">
              BulkReferences
            </span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            <Link href="/login" className="text-[#143354] transition hover:opacity-70">
              Standard login
            </Link>
            <a href="/contact" className="text-[#143354] transition hover:opacity-70">
              Support
            </a>
          </div>
        </nav>

        <main className="flex flex-1 items-center py-10">
          <div className="grid w-full gap-8 lg:grid-cols-[1.02fr_0.98fr]">
            <section className="relative overflow-hidden rounded-[2rem] border border-emerald-950/10 bg-[#143354] px-7 py-8 text-white shadow-[0_30px_90px_-36px_rgba(13,35,64,0.6)] sm:px-10 sm:py-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.16),_transparent_26%),radial-gradient(circle_at_bottom_left,_rgba(107,227,184,0.18),_transparent_30%)]" />
              <div className="relative space-y-8">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-200">
                  <Shield className="h-4 w-4" />
                  Institution-linked access
                </div>

                <div className="space-y-4">
                  <h1 className="font-headline text-4xl font-black tracking-tight text-white sm:text-5xl">
                    Institutional accounts, matched to verified domains
                  </h1>
                  <p className="max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
                    Choose your institution, then sign in or create an institutional account with a matching work address. If your organization is not listed yet, send a partnership request from the same page.
                  </p>
                </div>

                <div className="rounded-[1.75rem] border border-white/10 bg-white/8 p-5 backdrop-blur">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">
                    Find your institution
                  </label>
                  <div className="relative mt-4">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/10 py-3.5 pl-11 pr-4 text-sm text-white outline-none placeholder:text-slate-300/70 focus:border-white/35"
                      placeholder="Oxford, MIT, Harvard..."
                    />
                  </div>

                  <div className="mt-4 grid gap-3">
                    {institutions.length > 0 ? institutions.slice(0, 6).map((institution) => {
                      const active = selectedInstitutionId === institution.id;
                      return (
                        <button
                          key={institution.id}
                          type="button"
                          onClick={() => chooseInstitution(institution)}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${active ? "border-emerald-300 bg-emerald-300/12 text-white" : "border-white/10 bg-white/6 text-slate-200 hover:border-white/30 hover:bg-white/10"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{institution.name}</p>
                              <p className="mt-1 text-xs text-slate-300">{institution.domains.join(", ")}</p>
                            </div>
                            {active && <CircleCheck className="h-4 w-4 flex-shrink-0 text-emerald-200" />}
                          </div>
                        </button>
                      );
                    }) : (
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/6 px-4 py-4 text-sm text-slate-300">
                        No institution matches that search yet. You can still request access below.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-[2rem] border border-slate-200/70 bg-white/92 p-6 shadow-[0_24px_70px_-36px_rgba(25,28,31,0.28)] backdrop-blur sm:p-8">
                <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setAuthError(null);
                    }}
                    className={`rounded-full px-4 py-2 font-semibold transition ${mode === "login" ? "bg-[#143354] text-white shadow-sm" : "text-slate-600"}`}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("register");
                      setAuthError(null);
                    }}
                    className={`rounded-full px-4 py-2 font-semibold transition ${mode === "register" ? "bg-[#143354] text-white shadow-sm" : "text-slate-600"}`}
                  >
                    Create institution account
                  </button>
                </div>

                <form className="mt-8 space-y-5" onSubmit={handleAuthSubmit}>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                      {mode === "login" ? "Institution member login" : "Institution member registration"}
                    </p>
                    <h2 className="mt-3 font-headline text-3xl font-black tracking-tight text-[#143354]">
                      {mode === "login" ? "Continue with your institution account" : "Create a verified institution-linked account"}
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {selectedInstitution
                        ? `Selected institution: ${selectedInstitution.name}. Use an email address from ${selectedInstitution.domains.join(", ")}.`
                        : "Choose an institution on the left, then continue with a matching work email."}
                    </p>
                  </div>

                  {mode === "register" && (
                    <label className="block space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Full name</span>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#143354] focus:bg-white"
                        placeholder="Alex Library Team"
                        autoComplete="name"
                      />
                    </label>
                  )}

                  <label className="block space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Institutional email</span>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#143354] focus:bg-white"
                        placeholder="name@university.edu"
                        autoComplete="email"
                      />
                    </div>
                  </label>

                  <label className="block space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Password</span>
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#143354] focus:bg-white"
                      placeholder="At least 10 characters"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                    />
                  </label>

                  {!isConfigured && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      `APP_SESSION_SECRET` is missing, so institutional sign-in cannot be enabled yet.
                    </div>
                  )}

                  {authError && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {authError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isAuthPending || !isConfigured}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#143354_0%,#1f6b6b_100%)] px-4 py-4 text-sm font-bold text-white transition hover:translate-y-[-1px] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>
                      {isAuthPending
                        ? (mode === "login" ? "Opening institution session..." : "Creating institution account...")
                        : (mode === "login" ? "Open institution workspace" : "Create account and continue")}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              </div>

              <div className="rounded-[2rem] border border-slate-200/70 bg-white/92 p-6 shadow-[0_24px_70px_-36px_rgba(25,28,31,0.28)] backdrop-blur sm:p-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Request partnership</p>
                  <h2 className="mt-3 font-headline text-3xl font-black tracking-tight text-[#143354]">
                    Not listed yet? Request institutional access
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    Submit a work contact and institution name. We store the request on the server so the team can review it even if email integrations are unavailable.
                  </p>
                </div>

                <form className="mt-8 space-y-5" onSubmit={handleRequestSubmit}>
                  <label className="block space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Contact name</span>
                    <input
                      value={contactName}
                      onChange={(event) => setContactName(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#143354] focus:bg-white"
                      placeholder="Jordan Systems Librarian"
                      autoComplete="name"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Work email</span>
                    <input
                      value={workEmail}
                      onChange={(event) => setWorkEmail(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#143354] focus:bg-white"
                      placeholder="jordan@library.edu"
                      autoComplete="email"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Institution name</span>
                    <div className="relative">
                      <Building2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={institutionName}
                        onChange={(event) => setInstitutionName(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#143354] focus:bg-white"
                        placeholder="Your university, lab, or library consortium"
                      />
                    </div>
                  </label>

                  <label className="block space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Notes</span>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className="min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#143354] focus:bg-white"
                      placeholder="Tell us which teams need access, or any procurement / rollout context."
                    />
                  </label>

                  {requestError && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {requestError}
                    </div>
                  )}

                  {requestMessage && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                      {requestMessage}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isRequestPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#143354]/12 bg-slate-950 px-4 py-4 text-sm font-bold text-white transition hover:translate-y-[-1px] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>{isRequestPending ? "Saving request..." : "Request institutional access"}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
