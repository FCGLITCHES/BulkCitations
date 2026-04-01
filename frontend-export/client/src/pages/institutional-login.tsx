import { FormEvent, useDeferredValue, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUserSession } from "@/hooks/use-user-session";
import { LandingNavbar } from "@/components/landing-navbar";
import { AdminFooter } from "@/components/AdminFooter";

type InstitutionOption = {
  id: string;
  slug: string;
  name: string;
  domains: string[];
};

export default function InstitutionalLogin() {
  const [, setLocation] = useLocation();
  const {
    isAuthenticated,
    isInitialized,
    loginInstitutional,
    requestInstitutionPartnership,
  } = useUserSession();

  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [isRequestPending, setIsRequestPending] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);

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

  const handleAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    setIsAuthPending(true);

    if (!selectedInstitutionId && institutions.length > 0) {
      setAuthError("Please select your institution from the search results first.");
      setIsAuthPending(false);
      return;
    }

    try {
      const result = await loginInstitutional(email, password, selectedInstitutionId || institutions[0]?.id);
      if (!result.success) {
        setAuthError(result.message);
      } else {
        setLocation("/history");
      }
    } finally {
      setIsAuthPending(false);
    }
  };

  const handleRequestPartnership = async () => {
    setIsRequestPending(true);
    setRequestMessage(null);
    try {
      const result = await requestInstitutionPartnership(
        "Interested User",
        email || "request@institution.edu",
        searchQuery || "New Institution",
        "Requested via login page"
      );
      if (result.success) {
        setRequestMessage("Partnership request sent successfully!");
      }
    } finally {
      setIsRequestPending(false);
    }
  };

  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface dark:text-slate-100 antialiased overflow-x-hidden min-h-screen flex flex-col transition-colors">
      {/* TopNavBar (Shared) */}
      <LandingNavbar />

      {/* Main Content Shell */}
      <main className="flex-grow flex flex-col items-center justify-center px-6 relative py-20">
        {/* Academic Background Texture */}
        <div className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.06] z-0">
          <div className="absolute inset-0" style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuBGqPKKmAu_ZcWLhJOUmYhJ60SDUI3xSGfgn9Wx47AWD3TiCmZfp03GrJEzrlZgo7-uCwZC7NsP7i_0I9TB3DSm2zFJWUw0fft232Y0b0IQsimCyme-57hmlM35TaJGt7S_Nh3KqyS8uudDOSu_ENWQN3SbzuvfLRSqPhz3GZHOysvbmyHIYWk7d5Rs69-uUJUQ_U6YJMokthv6Mh8E6Wil6Eb-0SAkWYchtMq8gYt41kFeEhp4OiJgVwCCPciN6KssTnr0-cK5sz7w')" }}></div>
        </div>

        {/* Decorative Gradients */}
        <div className="fixed inset-0 -z-0 overflow-hidden pointer-events-none opacity-40">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary-container/5 dark:bg-primary-container/10 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary-container/10 dark:bg-secondary-container/20 rounded-full blur-[100px]"></div>
        </div>

        <div className="w-full max-w-[440px] z-10 my-auto">
          {/* Compact Header */}
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-primary-container dark:text-blue-50 mb-3 tracking-tight">Institutional Access</h1>
            <p className="text-on-surface-variant text-sm font-body">Access your university archive and curated references.</p>
          </div>

          {/* Login Card */}
          <div className="bg-surface-container-lowest rounded-xl p-8 md:p-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative">
            {/* Section 1: Institutional Selection */}
            <div className="space-y-8">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4 font-label">
                  Step 1: Locate Your University
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">account_balance</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-surface-container-low border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 rounded-lg transition-all font-body placeholder:text-outline/60 text-on-surface"
                    placeholder="Search for your institution (e.g. Oxford, MIT...)"
                  />
                </div>

                {/* Institution Search Results */}
                {searchQuery.trim().length > 0 && institutions.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {institutions.slice(0, 3).map((inst) => (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={() => setSelectedInstitutionId(inst.id)}
                        className={`w-full p-3 text-left rounded-lg transition-colors border ${selectedInstitutionId === inst.id ? "bg-primary-container text-white border-transparent" : "bg-surface-container-low border-outline-variant hover:bg-surface-container text-on-surface"}`}
                      >
                        <div className="font-bold">{inst.name}</div>
                        <div className="text-xs opacity-70">{inst.domains.join(", ")}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Partner Logos Row */}
              <div className="flex flex-wrap items-center justify-center gap-8 py-4 opacity-70 grayscale hover:grayscale-0 transition-all">
                <img className="h-8 object-contain" alt="Oxford" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBbfllXkHc96-lyL_f6SWbMc17SbjvhA-uM3bEJU9FgaCkwH75yfoj6hDZfIxYFsQGjS52-NIS896_MBPLMUBpu04GFwVFspt9yTmwu0s3vYFVgbayz3v_1YdNoIEOmehPiKIgbB81MlKdrVISFKNDmEzkipSB9NPPpToFzLp_FLwbXA9rgp8pzREBbboODafcRuSNHWbzmGOCbxk1uW65x8bP1-AXVSzXTkA54mhAClyF0lo7uPhiINZxXeK4p28hYFS75YPlAdwD6" />
                <img className="h-6 object-contain" alt="MIT" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBnUnUwwzvct1MPISTj21f8O6dijr0gFn_4BXZv1wwU7veE6wBLsptuHBinQkmBwX5gH6Psw7Kkl4OiueX9dJoct5QTf55h8a1DuIsibIWY7TjoS-2L5TB6QSQ_MTmprhcMCsm0s_CQgKnbWJR4UZKl6ifJMf_wCYdib_0tZXwLHKs9sNl4zBaaeNYTZQ9kK_hXkHP8RuXOwN7dTmZopCfORye7cwaJULpyU8iz_HYs4e4z1r7zYagbTHZ61RVWepGsz2Jcr1HVeRYK" />
                <img className="h-8 object-contain" alt="Harvard" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAfUhXeKLdX11RmlVDoYqMS5QeUNC9asGdieUX5Ow1TV9Yq7Tc7tObIAD6p2jOwdOYBAhL6hQSbHcBMUFIsEre9pktdMQU2j_JCLluhyWoedsXEZH9UTONUspfOw4-ziOD6t24hpqeEaHrqfNr1GCDr9R6Ou5uJKm52f5HGFuD1406I9GPpspbKnAUZxTcTcAoEzC4xs0T350cMWoG-CwmAkjrgt_1AXwUAc8PUCFS6c86P8Jb_dNdPZp73T0IqeNtvS8sXqunnRNgR" />
              </div>

              <button className="w-full py-3 bg-[#002147] text-white rounded-lg font-bold text-base shadow-lg hover:shadow-primary-container/20 transition-all flex items-center justify-center gap-3">
                <span>Sign In with Institutional SSO</span>
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>

              <div className="text-center">
                <button 
                  onClick={() => setSearchQuery("")}
                  className="text-primary-container font-medium hover:underline text-sm font-label decoration-2 underline-offset-4"
                >
                  Can't find your institution?
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="my-12 flex items-center gap-6">
              <div className="h-[1px] flex-1 bg-outline-variant/30"></div>
              <span className="text-outline text-xs font-bold uppercase tracking-widest bg-surface-container-lowest px-2 font-label">Or</span>
              <div className="h-[1px] flex-1 bg-outline-variant/30"></div>
            </div>

            {/* Section 2: Email Login */}
            <form onSubmit={handleAuthSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4 font-label">
                  Login with Institutional Email
                </label>
                <p className="text-xs text-on-surface-variant mb-4 -mt-2">
                  Use this for manual verification if your institution hasn't enabled Single Sign-On.
                </p>
                <div className="space-y-4">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">alternate_email</span>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-surface-container-low border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 rounded-lg transition-all font-body placeholder:text-outline/60 text-on-surface"
                      placeholder="name@university.edu"
                    />
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">lock</span>
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-surface-container-low border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 rounded-lg transition-all font-body placeholder:text-outline/60 text-on-surface"
                      placeholder="Institutional Password"
                    />
                  </div>
                </div>
              </div>

              {authError && (
                <div className="text-error text-sm font-medium bg-error-container/20 p-4 rounded-lg border border-error/10">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={isAuthPending}
                className="w-full py-2.5 bg-secondary-container text-on-secondary-container rounded-lg font-semibold text-sm hover:bg-secondary-fixed transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isAuthPending ? "Verifying..." : "Verify via Email"}
              </button>
            </form>

            {/* Tertiary Action */}
            <div className="mt-12 pt-8 border-t border-surface-container flex flex-col items-center gap-4">
              <p className="text-sm text-on-surface-variant italic">New to BulkReferences?</p>
              <button
                onClick={handleRequestPartnership}
                disabled={isRequestPending}
                className="text-primary-container font-bold text-sm tracking-wide uppercase hover:opacity-80 transition-opacity flex items-center gap-2 disabled:opacity-50"
              >
                {isRequestPending ? "Requesting..." : "Request Institutional Partnership"}
                <span className="material-symbols-outlined text-sm">open_in_new</span>
              </button>
              {requestMessage && (
                <div className="text-secondary text-sm font-medium mt-2">
                  {requestMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>


      {/* Decorative Corner Visual */}
      <div className="fixed bottom-0 right-0 p-8 opacity-10 pointer-events-none hidden lg:block">
        <span className="material-symbols-outlined text-9xl text-primary-container" style={{ fontVariationSettings: "'wght' 100" }}>history_edu</span>
      </div>
      <AdminFooter />
    </div>
  );
}
