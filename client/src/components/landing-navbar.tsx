import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useUserSession } from "@/hooks/use-user-session";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/history", label: "History" },
  { href: "/prices", label: "Prices" },
  { href: "/resources", label: "Resources" },
  { href: "/api-docs", label: "API" },
  { href: "/about", label: "About" },
];

export function LandingNavbar() {
  const [isDark, setIsDark] = useState(false);
  const [location] = useLocation();
  const { isAuthenticated, isInitialized, account, logout } = useUserSession();

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    if (nextTheme) {
      document.documentElement.classList.add("dark");
      localStorage.theme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.theme = "light";
    }
  };

  const handleLogout = () => {
    void logout();
  };

  return (
    <nav className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200/15 dark:border-slate-800/15 shadow-sm top-0 sticky z-50 transition-colors">
      <div className="flex items-center w-full px-8 py-3 max-w-screen-2xl mx-auto">
        {/* Logo — fixed left */}
        <div className="w-40 flex-shrink-0">
          <Link href="/" className="text-xl font-bold tracking-tight text-blue-900 dark:text-blue-50 font-headline">
            BulkReferences
          </Link>
        </div>

        {/* Nav links — centred */}
        <div className="hidden md:flex flex-1 justify-center gap-7">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={`font-body text-sm transition-colors ${
                  isActive
                    ? "text-blue-900 dark:text-blue-400 font-bold border-b-2 border-blue-900 dark:border-blue-400 pb-1"
                    : "text-slate-500 dark:text-slate-400 hover:text-blue-800 dark:hover:text-blue-200"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right — theme toggle + Sign In */}
        <div className="min-w-[10rem] flex-shrink-0 flex items-center justify-end gap-3">
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-8 h-8 rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-all"
            title="Toggle theme"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {isInitialized && isAuthenticated ? (
            <>
              <Link
                href="/history"
                className="hidden lg:inline-flex max-w-[10rem] truncate text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300"
              >
                {account?.institution ? account.institution.name : account?.name.split(" ")[0] ?? "Account"}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="bg-primary-container dark:bg-primary-container text-white px-5 py-2 rounded-lg font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                href="/adm1n"
                className="hidden md:inline-flex text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 hover:text-blue-800 dark:hover:text-blue-200"
              >
                Admin
              </Link>
              <Link
                href="/login"
                className="bg-primary-container dark:bg-primary-container text-white px-5 py-2 rounded-lg font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
              >
                Sign In
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
