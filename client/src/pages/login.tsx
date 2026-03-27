import { Link } from "wouter";

export default function Login() {
  return (
    <div className="bg-surface text-on-background min-h-screen flex flex-col">
      {/* Minimal transactional nav */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200/15 dark:border-slate-800/15 shadow-sm">
        <div className="flex justify-between items-center px-6 py-4 max-w-full">
          <Link href="/">
            <span className="text-xl font-bold text-primary-container dark:text-blue-50 font-headline tracking-tight leading-none cursor-pointer">
              BulkReferences
            </span>
          </Link>
          <a href="/contact" className="text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors flex items-center gap-1 text-xs font-label uppercase tracking-widest">
            <span className="material-symbols-outlined text-base">help_outline</span>
            Support
          </a>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-grow flex items-center justify-center px-4 pt-24 pb-12">
        {/* Login Card */}
        <div className="w-full max-w-[440px] bg-surface-container-lowest dark:bg-slate-900 rounded-lg shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden border border-outline-variant/10 dark:border-slate-800">
          <div className="p-8 md:p-12">
            {/* Header */}
            <div className="mb-10 text-center">
              <h1 className="text-3xl font-bold text-primary-container dark:text-blue-50 mb-3 tracking-tight font-headline">
                Welcome back
              </h1>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm font-body">
                Sign in to access your archive and curated references.
              </p>
            </div>

            {/* Google SSO */}
            <div className="mb-8">
              <button className="w-full flex items-center justify-center gap-3 px-6 py-3 border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 hover:bg-surface-container-low dark:hover:bg-slate-700 transition-all rounded-lg">
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span className="text-on-surface dark:text-slate-200 font-semibold text-sm">Continue with Google</span>
              </button>
            </div>

            {/* Divider */}
            <div className="relative mb-8">
              <div aria-hidden="true" className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-outline-variant/30 dark:border-slate-700/50"></div>
              </div>
              <div className="relative flex justify-center text-xs font-label uppercase tracking-widest">
                <span className="bg-surface-container-lowest dark:bg-slate-900 px-4 text-on-surface-variant dark:text-slate-400">
                  or continue with email
                </span>
              </div>
            </div>

            {/* Form */}
            <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-on-surface-variant dark:text-slate-400 uppercase tracking-wider" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  placeholder="you@example.com"
                  className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant dark:border-slate-700 focus:border-primary-container dark:focus:border-blue-400 focus:ring-0 transition-all text-on-surface dark:text-white placeholder-slate-400 outline-none"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-bold text-on-surface-variant dark:text-slate-400 uppercase tracking-wider" htmlFor="password">
                    Password
                  </label>
                  <a className="text-xs text-primary-container dark:text-blue-400 hover:underline font-semibold" href="#">
                    Forgot password?
                  </a>
                </div>
                <input
                  id="password"
                  type="password"
                  name="password"
                  placeholder="••••••••"
                  className="w-full px-0 py-3 bg-transparent border-0 border-b-2 border-outline-variant dark:border-slate-700 focus:border-primary-container dark:focus:border-blue-400 focus:ring-0 transition-all text-on-surface dark:text-white placeholder-slate-400 outline-none"
                />
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full bg-primary-container text-white py-4 rounded-lg font-body font-bold text-sm tracking-wide shadow-md hover:bg-[#002f5f] active:scale-[0.98] transition-all"
                >
                  Sign In
                </button>
              </div>
            </form>

            {/* Sign up + institutional links */}
            <div className="mt-8 text-center space-y-3">
              <p className="text-on-surface-variant dark:text-slate-400 text-sm">
                Don't have an account?{" "}
                <a className="text-primary-container dark:text-blue-400 font-bold hover:underline" href="#">
                  Sign up
                </a>
              </p>
              <div className="border-t border-outline-variant/20 dark:border-slate-800 pt-3">
                <Link
                  href="/institutional-login"
                  className="text-xs text-on-surface-variant dark:text-slate-500 hover:text-primary-container dark:hover:text-blue-400 transition-colors underline underline-offset-4 cursor-pointer"
                >
                  Institutional / SSO Sign In
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative background blobs */}
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none opacity-40">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary-container/5 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary-container/10 rounded-full blur-[100px]"></div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-8 bg-transparent">
        <div className="flex flex-col md:flex-row justify-center items-center gap-6 w-full">
          <span className="text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">
            © {new Date().getFullYear()} BulkReferences. Preserving academic integrity.
          </span>
          <div className="flex gap-6">
            <a href="/privacy" className="text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-primary-container dark:hover:text-blue-300 hover:underline transition-all opacity-80 hover:opacity-100">
              Privacy Policy
            </a>
            <a href="#" className="text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-primary-container dark:hover:text-blue-300 hover:underline transition-all opacity-80 hover:opacity-100">
              Terms of Service
            </a>
            <a href="/contact" className="text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-primary-container dark:hover:text-blue-300 hover:underline transition-all opacity-80 hover:opacity-100">
              Support
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
