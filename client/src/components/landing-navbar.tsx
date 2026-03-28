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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [location] = useLocation();
  const { isAuthenticated, isInitialized, account, logout } = useUserSession();

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

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
    <nav className="bg-white/80 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200/20 dark:border-white/5 shadow-sm top-0 sticky z-50 transition-colors">
      <div className="w-full px-4 py-3 sm:px-6 lg:px-8 max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-3">
          {/* Logo — fixed left */}
          <div className="min-w-0 flex-1 md:w-40 md:flex-none">
            <Link
              href="/"
              className="text-xl font-bold tracking-tight text-[#002147] dark:text-slate-50 font-headline"
            >
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
          <div className="flex flex-shrink-0 items-center justify-end gap-2 md:min-w-[10rem] md:gap-3">
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-9 h-9 rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-all"
              title="Toggle theme"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="hidden md:flex md:items-center md:gap-3">
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
                    href="/login"
                    className="bg-primary-container dark:bg-primary-container text-white px-5 py-2 rounded-lg font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
                  >
                    Sign In
                  </Link>
                </>
              )}
            </div>
            <button
              type="button"
              aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              className="group flex h-10 w-10 items-center justify-center rounded-2xl bg-white/75 text-slate-700 shadow-sm transition-all hover:text-blue-900 dark:bg-slate-900/70 dark:text-slate-200 md:hidden"
            >
              <span className="relative h-4 w-5">
                <span
                  className={`absolute left-0 top-0 h-0.5 w-5 rounded-full bg-current transition-all duration-300 ${
                    isMobileMenuOpen ? "top-[7px] rotate-45" : ""
                  }`}
                />
                <span
                  className={`absolute left-0 top-[7px] h-0.5 w-5 rounded-full bg-current transition-all duration-300 ${
                    isMobileMenuOpen ? "opacity-0" : ""
                  }`}
                />
                <span
                  className={`absolute left-0 top-[14px] h-0.5 w-5 rounded-full bg-current transition-all duration-300 ${
                    isMobileMenuOpen ? "top-[7px] -rotate-45" : ""
                  }`}
                />
              </span>
            </button>
          </div>
        </div>

        <div
          className={`overflow-hidden transition-all duration-300 ease-out md:hidden ${
            isMobileMenuOpen ? "max-h-[32rem] opacity-100 pt-4" : "max-h-0 opacity-0"
          }`}
        >
          <div className="rounded-3xl bg-white/85 p-3 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:bg-slate-950/85">
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map(({ href, label }) => {
                const isActive = location === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`rounded-2xl px-4 py-3 font-body text-sm transition-colors ${
                      isActive
                        ? "bg-blue-950 text-white dark:bg-blue-500 dark:text-slate-950"
                        : "text-slate-600 hover:bg-slate-100 hover:text-blue-900 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>

            <div className="mt-3 pt-3">
              {isInitialized && isAuthenticated ? (
                <div className="flex flex-col gap-3">
                  <Link
                    href="/history"
                    className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {account?.institution ? account.institution.name : account?.name.split(" ")[0] ?? "Account"}
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="bg-primary-container dark:bg-primary-container text-white px-5 py-3 rounded-2xl font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Link
                    href="/login"
                    className="bg-primary-container dark:bg-primary-container text-center text-white px-5 py-3 rounded-2xl font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
                  >
                    Sign In
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
