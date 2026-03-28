import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUserSession } from "@/hooks/use-user-session";
import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";

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
    document.title = "Sign In - BulkReferences";
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
    <div className="bg-surface text-on-background min-h-screen flex flex-col transition-colors">
      <LandingNavbar />

      <main className="flex-grow flex items-center justify-center px-4 py-12 md:py-20 relative z-10">
        <div className="w-full max-w-[440px] bg-surface-container-lowest rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all duration-500 hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)]">
          <div className="px-8 py-10 md:px-12 md:py-14">
            {/* Header Section */}
            <div className="mb-10 text-center">
              <h1 className="text-3xl font-bold text-primary-container dark:text-blue-50 mb-3 tracking-tight">
                {view === "login" ? "Welcome back" : "Join the Archive"}
              </h1>
              <p className="text-on-surface-variant text-sm font-body">
                {view === "login" 
                  ? "Access your individual archive and curated references." 
                  : "Create an account to keep your conversion history persistent."}
              </p>
            </div>

            {/* Social Login (Placeholder for illustration) */}
            <div className="space-y-4 mb-8">
              <button 
                type="button"
                className="w-full flex items-center justify-center gap-3 px-6 py-3 border border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low transition-all rounded-lg group"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"></path>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
                </svg>
                <span className="text-on-surface font-semibold text-sm">Continue with Google</span>
              </button>
            </div>

            {/* Divider */}
            <div className="relative mb-8">
              <div aria-hidden="true" class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-outline-variant/30"></div>
              </div>
              <div className="relative flex justify-center text-[10px] font-label uppercase tracking-widest">
                <span className="bg-surface-container-lowest px-4 text-on-surface-variant">or continue with email</span>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-error-container/20 border border-error/10 text-error text-sm rounded-lg">
                {error}
              </div>
            )}

            {!isConfigured && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg">
                `APP_SESSION_SECRET` is missing, so public sign-in is limited.
              </div>
            )}

            {/* Form */}
            <form className="space-y-6" onSubmit={handleSubmit}>
              {view === "register" && (
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="name">Full Name</label>
                  <input
                    className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                    id="name"
                    name="name"
                    placeholder="Jane Researcher"
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              )}
              
              <div className="space-y-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="email">Email</label>
                <input
                  className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                  id="email"
                  name="email"
                  placeholder="name@university.edu"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="password">Password</label>
                  {view === "login" && (
                    <a className="text-[11px] text-primary-container dark:text-blue-300 hover:underline font-semibold" href="#">Forgot?</a>
                  )}
                </div>
                <input
                  className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant focus:ring-0 focus:border-primary-container dark:focus:border-blue-300 transition-all text-on-surface placeholder-slate-400"
                  id="password"
                  name="password"
                  placeholder="••••••••"
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="pt-4">
                <button
                  disabled={isPending || !isConfigured}
                  className="w-full bg-gradient-to-br from-primary to-primary-container text-white py-4 rounded-lg font-bold text-sm tracking-wide shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  type="submit"
                >
                  {isPending 
                    ? (view === "login" ? "Authenticating..." : "Creating Account...") 
                    : (view === "login" ? "Sign In to Archive" : "Create My Account")}
                </button>
              </div>
            </form>

            {/* Signup Footer */}
            <div className="mt-10 text-center">
              <p className="text-on-surface-variant text-sm">
                {view === "login" ? "Don't have an account?" : "Already have an account?"}
                <button
                  type="button"
                  onClick={() => {
                    setView(view === "login" ? "register" : "login");
                    resetMessages();
                  }}
                  className="ml-2 text-primary-container dark:text-blue-300 font-bold hover:underline"
                >
                  {view === "login" ? "Sign up" : "Sign in"}
                </button>
              </p>
            </div>
            
            {/* Split switch to Institutional */}
            <div className="mt-6 pt-6 border-t border-outline-variant/20 text-center">
               <Link href="/institutional-login" className="text-xs font-semibold uppercase tracking-widest text-[#002147] dark:text-blue-200 hover:opacity-70 transition-opacity">
                Use Institutional Access
               </Link>
            </div>
          </div>
        </div>

        {/* Background Decorative Vellum (Subtle texture simulation) */}
        <div className="fixed inset-0 -z-0 overflow-hidden pointer-events-none opacity-40">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary-container/5 dark:bg-primary-container/10 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary-container/10 dark:bg-secondary-container/20 rounded-full blur-[100px]"></div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
