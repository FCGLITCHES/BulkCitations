import { FormEvent, useDeferredValue, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth as useWorkOSAuth } from "@workos-inc/authkit-react";
import { useUserSession } from "@/hooks/use-user-session";
import { LandingNavbar } from "@/components/landing-navbar";
import { AdminFooter } from "@/components/AdminFooter";
import { resolveApiUrl } from "@/lib/api-url";
import { workosClientId, workosEnabled } from "@/oauth/config";

type InstitutionOption = {
  id: string;
  slug: string;
  name: string;
  domains: string[];
  workosOrganizationId?: string | null;
};

function InstitutionalLoginWithWorkOS() {
  const [, setLocation] = useLocation();
  const { signIn, isLoading: workOSLoading } = useWorkOSAuth();
  const {
    isAuthenticated,
    isInitialized,
    requestInstitutionPartnership,
  } = useUserSession();

  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isRequestPending, setIsRequestPending] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isInitialized && isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, isInitialized, setLocation]);

  useEffect(() => {
    let isActive = true;
    void (async () => {
      try {
        const query = deferredQuery.trim();
        const response = await fetch(
          resolveApiUrl(`/v1/auth/institutions${query ? `?q=${encodeURIComponent(query)}` : ""}`),
          {
            credentials: "include",
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error();
        const data = await response.json() as { institutions?: InstitutionOption[] };
        if (!isActive) return;
        setInstitutions(data.institutions ?? []);
      } catch {
        if (!isActive) return;
        setInstitutions([]);
      }
    })();
    return () => { isActive = false; };
  }, [deferredQuery]);

  const selected = institutions.find((i) => i.id === selectedInstitutionId);

  const handleWorkOSSignIn = async () => {
    setAuthError(null);
    try {
      await signIn({
        state: { returnTo: "/" },
        ...(selected?.workosOrganizationId
          ? { organizationId: selected.workosOrganizationId }
          : {}),
        ...(emailHint.trim() ? { loginHint: emailHint.trim() } : {}),
      });
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not start institutional sign-in.");
    }
  };

  const handleRequestPartnership = async (event: FormEvent) => {
    event.preventDefault();
    setIsRequestPending(true);
    setRequestMessage(null);
    try {
      const result = await requestInstitutionPartnership(
        "Interested User",
        emailHint.trim() || "request@institution.edu",
        searchQuery || "New Institution",
        "Requested via institutional login page",
      );
      setRequestMessage(result.message);
    } finally {
      setIsRequestPending(false);
    }
  };

  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface dark:text-slate-100 antialiased overflow-x-hidden min-h-screen flex flex-col transition-colors">
      <LandingNavbar />

      <main className="flex-grow flex flex-col items-center justify-center px-6 relative py-20">
        <div className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.06] z-0">
          <div className="institutional-login-texture absolute inset-0" />
        </div>

        <div className="fixed inset-0 -z-0 overflow-hidden pointer-events-none opacity-40">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary-container/5 dark:bg-primary-container/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary-container/10 dark:bg-secondary-container/20 rounded-full blur-[100px]" />
        </div>

        <div className="w-full max-w-[440px] z-10 my-auto">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-primary-container dark:text-blue-50 mb-3 tracking-tight">
              Institutional access
            </h1>
            <p className="text-on-surface-variant text-sm font-body">
              Universities and labs sign in with WorkOS (SSO). This is separate from individual Clerk accounts.
            </p>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-8 md:p-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative space-y-8">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4 font-label">
                Step 1: Find your institution (optional)
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">account_balance</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-surface-container-low border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 rounded-lg transition-all font-body placeholder:text-outline/60 text-on-surface"
                  placeholder="Search (e.g. Oxford, MIT...)"
                />
              </div>

              {searchQuery.trim().length > 0 && institutions.length > 0 && (
                <div className="mt-4 space-y-2">
                  {institutions.slice(0, 5).map((inst) => (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => setSelectedInstitutionId(inst.id)}
                      className={`w-full p-3 text-left rounded-lg transition-colors border ${
                        selectedInstitutionId === inst.id
                          ? "bg-primary-container text-white border-transparent"
                          : "bg-surface-container-low border-outline-variant hover:bg-surface-container text-on-surface"
                      }`}
                    >
                      <div className="font-bold">{inst.name}</div>
                      <div className="text-xs opacity-70">{inst.domains.join(", ") || "—"}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2 font-label">
                Work email (optional hint)
              </label>
              <input
                type="email"
                value={emailHint}
                onChange={(e) => setEmailHint(e.target.value)}
                className="w-full px-4 py-3 bg-surface-container-low border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 rounded-lg transition-all text-sm"
                placeholder="you@university.edu"
              />
            </div>

            {authError && (
              <div className="text-error text-sm font-medium bg-error-container/20 p-4 rounded-lg border border-error/10">
                {authError}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleWorkOSSignIn()}
              disabled={workOSLoading}
              className="w-full py-3 bg-[#002147] text-white rounded-lg font-bold text-base shadow-lg hover:shadow-primary-container/20 transition-all flex items-center justify-center gap-3 disabled:opacity-60"
            >
              <span>{workOSLoading ? "Loading…" : "Continue with WorkOS SSO"}</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>

            <p className="text-center text-[11px] text-on-surface-variant leading-relaxed">
              Wrong place?{" "}
              <Link href="/login?flow=user" className="font-semibold text-primary-container dark:text-blue-200 hover:underline">
                Individual sign-in (Clerk)
              </Link>
              {" · "}
              <Link href="/adm1n" className="font-semibold text-primary-container dark:text-blue-200 hover:underline">
                Admin sign-in
              </Link>
            </p>

            <div className="my-8 flex items-center gap-6">
              <div className="h-[1px] flex-1 bg-outline-variant/30" />
              <span className="text-outline text-xs font-bold uppercase tracking-widest bg-surface-container-lowest px-2 font-label">Or</span>
              <div className="h-[1px] flex-1 bg-outline-variant/30" />
            </div>

            <form onSubmit={handleRequestPartnership} className="space-y-4">
              <p className="text-sm text-on-surface-variant">
                Request a partnership if your school is not listed yet.
              </p>
              <button
                type="submit"
                disabled={isRequestPending}
                className="w-full py-2.5 text-primary-container font-bold text-sm tracking-wide uppercase hover:opacity-80 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 border border-outline-variant/40 rounded-lg"
              >
                {isRequestPending ? "Submitting…" : "Request institutional partnership"}
              </button>
              {requestMessage && (
                <div className="text-secondary text-sm font-medium mt-2 text-center">
                  {requestMessage}
                </div>
              )}
            </form>
          </div>
        </div>
      </main>

      <AdminFooter />
    </div>
  );
}

export default function InstitutionalLogin() {
  if (!workosEnabled || !workosClientId) {
    return (
      <div className="bg-surface dark:bg-slate-950 min-h-screen flex flex-col">
        <LandingNavbar />
        <main className="flex-grow flex items-center justify-center px-6 py-20">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold text-primary-container">Institutional SSO is temporarily disabled</h1>
            <p className="text-on-surface-variant text-sm">
              WorkOS sign-in is turned off for this environment while Clerk authentication is being stabilized. Individual and admin access continue through Clerk.
            </p>
            <Link href="/login?flow=user" className="inline-block text-primary-container font-semibold hover:underline">
              Back to individual sign-in
            </Link>
          </div>
        </main>
        <AdminFooter />
      </div>
    );
  }

  return <InstitutionalLoginWithWorkOS />;
}
