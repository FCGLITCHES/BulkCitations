import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";

export function LandingNavbar() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    if (nextTheme) {
      document.documentElement.classList.add("dark");
      localStorage.theme = 'dark';
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.theme = 'light';
    }
  };

  return (
    <nav className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200/15 dark:border-slate-800/15 shadow-sm top-0 sticky z-50 transition-colors">
      <div className="flex justify-between items-center w-full px-8 py-3 max-w-screen-2xl mx-auto">
        <div className="flex items-center">
          <Link href="/">
            <a className="text-xl font-bold tracking-tight text-blue-900 dark:text-blue-50 font-serif">BulkReferences</a>
          </Link>
        </div>
        {/* Right side controls & navigation */}
        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-6 items-center mr-2">
            <Link href="/">
              <a className="text-blue-900 dark:text-blue-400 font-bold border-b-2 border-blue-900 dark:border-blue-400 pb-1 text-sm">Home</a>
            </Link>
            <Link href="/history">
              <a className="text-slate-500 dark:text-slate-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors text-sm">History</a>
            </Link>
            <Link href="/prices">
              <a className="text-slate-500 dark:text-slate-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors text-sm">Prices</a>
            </Link>
            <Link href="/resources">
              <a className="text-slate-500 dark:text-slate-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors text-sm">Resources</a>
            </Link>
            <Link href="/api-docs">
              <a className="text-slate-500 dark:text-slate-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors text-sm">API</a>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative group hidden sm:block">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
              <input 
                className="pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800/50 rounded-full border-none focus:ring-2 focus:ring-blue-900 dark:focus:ring-blue-400 text-sm w-64 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 transition-colors" 
                placeholder="Search references..." 
                type="text"
              />
            </div>
            <button 
              onClick={toggleTheme}
              className="flex items-center justify-center w-8 h-8 rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-all"
              title="Toggle theme"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link href="/login">
              <a className="bg-primary-container dark:bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:opacity-90 duration-150 ease-in-out shadow-sm text-sm">
                Sign In
              </a>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
