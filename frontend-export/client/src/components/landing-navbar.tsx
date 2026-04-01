import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import { Moon, Sun } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
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
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [location, setLocation] = useLocation();
  const {
    isAdmin,
    isInitialized: isAdminInitialized,
    account: adminAccount,
    logout: logoutAdmin,
  } = useAuth();
  const { isAuthenticated, isInitialized, account, logout } = useUserSession();
  const adminMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));

    const handleClickOutside = (event: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(event.target as Node)) {
        setShowAdminMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setShowAdminMenu(false);
  }, [location]);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);

    // Disable transitions for instant switch
    document.documentElement.classList.add("no-transitions");

    if (nextTheme) {
      document.documentElement.classList.add("dark");
      localStorage.theme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.theme = "light";
    }

    // Remove the class after the transition is suppressed
    requestAnimationFrame(() => {
        document.documentElement.classList.remove("no-transitions");
    });
  };

  const handleLogout = () => {
    void logout();
  };

  const handleAdminLogout = () => {
    void logoutAdmin().finally(() => {
      setLocation("/adm1n");
    });
  };

  const adminLabel = adminAccount?.name?.trim() || adminAccount?.username || "Administrator";
  const adminSubLabel = adminAccount?.email?.trim() || (adminAccount?.username ? `@${adminAccount.username}` : "Admin session");
  const adminInitial = adminLabel.slice(0, 1).toUpperCase();

  return (
    <nav className="bg-white/80 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200/20 dark:border-white/5 shadow-sm top-0 sticky z-50">
      <div className="w-full px-4 py-3 sm:px-6 lg:px-8 max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-3">
          {/* Logo — fixed left */}
          <div className="min-w-0 flex-1 md:w-40 md:flex-none">
            <Link
              href="/"
              className="flex items-center gap-2 group"
            >
              <span className="text-xl font-bold tracking-tight text-[#002147] dark:text-slate-50 font-headline whitespace-nowrap">BulkReferences</span>
              <span className="px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-[9px] font-black uppercase tracking-widest text-[#002147] dark:text-blue-300 border border-blue-100 dark:border-blue-800/50">Beta</span>
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
              {isAdminInitialized && isAdmin ? (
                <>
                  <div className="relative hidden xl:block" ref={adminMenuRef}>
                    <button
                      type="button"
                      onClick={() => setShowAdminMenu((open) => !open)}
                      className="flex items-center gap-3 rounded-full border border-slate-200/80 bg-white/85 px-2 py-1.5 shadow-sm transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700"
                    >
                      <div className="text-right min-w-0">
                        <div className="truncate max-w-[12rem] text-xs font-semibold text-[#002147] dark:text-slate-100">
                          {adminLabel}
                        </div>
                        <div className="truncate max-w-[12rem] text-[11px] text-slate-600 dark:text-slate-300">
                          {adminSubLabel}
                        </div>
                      </div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#002147] text-xs font-black uppercase tracking-wider text-white">
                        {adminInitial}
                      </div>
                    </button>
                    {showAdminMenu && (
                      <div className="absolute right-0 mt-2 w-52 rounded-[5px] border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-950">
                        <Link
                          href="/admin/dashboard"
                          className="block rounded-[5px] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                          Admin Dashboard
                        </Link>
                        <Link
                          href="/admin/settings"
                          className="mt-1 block rounded-[5px] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                          Settings
                        </Link>
                        <button
                          type="button"
                          onClick={handleAdminLogout}
                          className="mt-1 block w-full rounded-[5px] px-3 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
                        >
                          Sign Out
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : isInitialized && isAuthenticated ? (
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
                    className="bg-primary-container dark:bg-primary-container text-white px-5 py-2 rounded-[5px] font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="bg-primary-container dark:bg-primary-container text-white px-5 py-2 rounded-[5px] font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
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
              {isAdminInitialized && isAdmin ? (
                <div className="flex flex-col gap-3">
                  <Link
                    href="/admin/dashboard"
                    className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-left dark:border-slate-800 dark:bg-slate-900/80"
                  >
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{adminLabel}</div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{adminSubLabel}</div>
                  </Link>
                  <button
                    type="button"
                    onClick={handleAdminLogout}
                    className="bg-[#002147] text-white px-5 py-3 rounded-[5px] font-body font-medium hover:bg-[#001634] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
                  >
                    Logout
                  </button>
                </div>
              ) : isInitialized && isAuthenticated ? (
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
                    className="bg-primary-container dark:bg-primary-container text-white px-5 py-3 rounded-[5px] font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Link
                    href="/login"
                    className="bg-primary-container dark:bg-primary-container text-center text-white px-5 py-3 rounded-[5px] font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
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
