import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/react";
import { ChevronDown, Moon, Sun } from "lucide-react";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { useUserSession } from "@/hooks/use-user-session";
import { buildAuthEntryUrl } from "@/lib/loginFlow";
import { workosEnabled } from "@/oauth/config";
import { BrandLogo } from "@/components/BrandLogo";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/history", label: "History" },
  { href: "/prices", label: "Prices" },
  { href: "/resources", label: "Resources" },
  { href: "/api-docs", label: "API" },
];

const ABOUT_LINKS = [
  { href: "/about", label: "Our Mission" },
  { href: "/contact", label: "Contact" },
];

export function LandingNavbar() {
  const { isLoaded: isClerkLoaded, isSignedIn: isClerkSignedIn } = useAuth();
  const { user: clerkUser } = useUser();
  const [isDark, setIsDark] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showAboutMenu, setShowAboutMenu] = useState(false);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [location, setLocation] = useLocation();
  const {
    isAdmin,
    isInitialized: isAdminInitialized,
    account: adminAccount,
    logout: logoutAdmin,
  } = useAdminAuth();
  const { isAuthenticated, isInitialized, account, logout } = useUserSession();
  const aboutMenuRef = useRef<HTMLDivElement>(null);
  const aboutMenuCloseTimeoutRef = useRef<number | null>(null);
  const adminMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));

    const handleClickOutside = (event: MouseEvent) => {
      if (
        aboutMenuRef.current &&
        !aboutMenuRef.current.contains(event.target as Node)
      ) {
        setShowAboutMenu(false);
      }
      if (
        adminMenuRef.current &&
        !adminMenuRef.current.contains(event.target as Node)
      ) {
        setShowAdminMenu(false);
      }
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      if (aboutMenuCloseTimeoutRef.current !== null) {
        window.clearTimeout(aboutMenuCloseTimeoutRef.current);
      }
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setShowAboutMenu(false);
    setShowAdminMenu(false);
    setShowUserMenu(false);
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
    setShowUserMenu(false);
    void logout();
  };

  const handleAdminLogout = () => {
    void logoutAdmin().finally(() => {
      setLocation("/adm1n");
    });
  };

  const adminLabel =
    adminAccount?.name?.trim() || adminAccount?.username || "Administrator";
  const adminSubLabel =
    adminAccount?.email?.trim() ||
    (adminAccount?.username ? `@${adminAccount.username}` : "Admin session");
  const showAdminSession = isAdminInitialized && isAdmin;
  const showUserSession = !showAdminSession && isInitialized && isAuthenticated;
  const showClerkSession =
    !showAdminSession && !showUserSession && isClerkLoaded && isClerkSignedIn;

  const userAccountName = account?.name?.trim() ?? "";
  const userAccountEmail = account?.email?.trim() ?? "";
  const userDisplayTitle =
    account?.institution?.name?.trim() ||
    userAccountName ||
    userAccountEmail ||
    "Signed in account";
  const userLabelShort =
    account?.institution?.name?.trim() ||
    (userAccountName && !userAccountName.includes("@")
      ? userAccountName.split(" ")[0]
      : "") ||
    "Account";
  const clerkEmail =
    clerkUser?.primaryEmailAddress?.emailAddress?.trim() ||
    clerkUser?.emailAddresses?.[0]?.emailAddress?.trim() ||
    "";
  const clerkName =
    clerkUser?.fullName?.trim() || clerkUser?.firstName?.trim() || "";
  const clerkLabel = clerkName || "Account";
  const clerkSubLabel =
    clerkEmail ||
    clerkUser?.username?.trim() ||
    clerkUser?.id ||
    "Clerk account";
  const hasClerkIdentity = isClerkLoaded && isClerkSignedIn;
  const adminDisplayLabel = hasClerkIdentity ? clerkLabel : adminLabel;
  const adminDisplaySubLabel = hasClerkIdentity ? clerkSubLabel : adminSubLabel;
  const adminInitial = adminDisplayLabel.slice(0, 1).toUpperCase();
  const isAboutSectionActive = ABOUT_LINKS.some(
    ({ href }) => location === href,
  );
  const userSignInUrl = buildAuthEntryUrl({ flow: "user", mode: "sign-in" });
  const adminSignInUrl = buildAuthEntryUrl({ flow: "admin", mode: "sign-in" });

  const openAboutMenu = () => {
    if (aboutMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(aboutMenuCloseTimeoutRef.current);
      aboutMenuCloseTimeoutRef.current = null;
    }
    setShowAboutMenu(true);
  };

  const closeAboutMenu = () => {
    if (aboutMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(aboutMenuCloseTimeoutRef.current);
    }

    aboutMenuCloseTimeoutRef.current = window.setTimeout(() => {
      setShowAboutMenu(false);
      aboutMenuCloseTimeoutRef.current = null;
    }, 180);
  };

  return (
    <nav className="bg-white/80 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200/20 dark:border-white/5 shadow-sm top-0 sticky z-50">
      <div className="w-full px-4 py-3 sm:px-6 lg:px-8 max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-3">
          {/* Logo — fixed left */}
          <div className="min-w-0 flex-1 md:w-40 md:flex-none">
            <Link href="/" className="flex items-center gap-2 group">
              <BrandLogo className="h-9" />
              <span className="text-xl font-bold tracking-tight text-[#002147] dark:text-slate-50 font-headline whitespace-nowrap">
                BulkReferences
              </span>
              <span className="px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-[9px] font-black uppercase tracking-widest text-[#002147] dark:text-blue-300 border border-blue-100 dark:border-blue-800/50">
                Beta
              </span>
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
            <div
              className="relative"
              ref={aboutMenuRef}
              onMouseEnter={openAboutMenu}
              onMouseLeave={closeAboutMenu}
            >
              <button
                type="button"
                onClick={() => {
                  if (showAboutMenu) {
                    setShowAboutMenu(false);
                    return;
                  }

                  openAboutMenu();
                }}
                className={`flex items-center gap-1 font-body text-sm transition-colors ${
                  isAboutSectionActive
                    ? "text-blue-900 dark:text-blue-400 font-bold border-b-2 border-blue-900 dark:border-blue-400 pb-1"
                    : "text-slate-500 dark:text-slate-400 hover:text-blue-800 dark:hover:text-blue-200"
                }`}
                aria-expanded={showAboutMenu}
                aria-haspopup="menu"
              >
                About
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${showAboutMenu ? "rotate-180" : ""}`}
                />
              </button>
              {showAboutMenu && (
                <div
                  className="absolute left-1/2 top-full z-50 mt-3 w-44 -translate-x-1/2 rounded-[5px] border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-950"
                  role="menu"
                >
                  {ABOUT_LINKS.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className="block rounded-[5px] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                      onClick={() => setShowAboutMenu(false)}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right — theme toggle + Sign In */}
          <div className="flex flex-shrink-0 items-center justify-end gap-2 md:min-w-[10rem] md:gap-3">
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-9 h-9 rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-all"
              title="Toggle theme"
            >
              {isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <div className="hidden md:flex md:items-center md:gap-2 lg:gap-3">
              {showAdminSession ? (
                <div className="relative" ref={adminMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowAdminMenu((open) => !open)}
                    className="flex items-center gap-3 rounded-full border border-slate-200/80 bg-white/85 px-2 py-1.5 shadow-sm transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700"
                  >
                    <div className="hidden min-w-0 text-right lg:block">
                      <div className="truncate max-w-[12rem] text-xs font-semibold text-[#002147] dark:text-slate-100">
                        {adminDisplayLabel}
                      </div>
                      <div className="truncate max-w-[12rem] text-[11px] text-slate-600 dark:text-slate-300">
                        {adminDisplaySubLabel}
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
              ) : showUserSession ? (
                <div className="relative hidden md:block" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowUserMenu((open) => !open)}
                    className="flex max-w-[10rem] items-center gap-2 rounded-full border border-slate-200/80 bg-white/85 px-3 py-1.5 text-left text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-700"
                    aria-expanded={showUserMenu}
                    aria-haspopup="menu"
                    aria-label="Open account menu"
                    title="Account"
                  >
                    <span className="truncate">{userLabelShort}</span>
                  </button>
                  {showUserMenu && (
                    <div
                      className="absolute right-0 z-50 mt-2 w-52 rounded-[5px] border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-950"
                      role="menu"
                    >
                      <div className="mb-1 border-b border-slate-200 px-3 pb-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <span className="block truncate font-semibold text-slate-700 dark:text-slate-200">
                          {userLabelShort}
                        </span>
                        <span
                          className="block truncate"
                          title={userDisplayTitle}
                        >
                          {userDisplayTitle}
                        </span>
                      </div>
                      <Link
                        href="/history"
                        className="block rounded-[5px] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                        onClick={() => setShowUserMenu(false)}
                      >
                        History
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="mt-1 block w-full rounded-[5px] px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                      >
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              ) : showClerkSession ? (
                <div className="relative hidden md:block" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowUserMenu((open) => !open)}
                    className="flex max-w-[10rem] items-center gap-2 rounded-full border border-slate-200/80 bg-white/85 px-3 py-1.5 text-left text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-700"
                    aria-expanded={showUserMenu}
                    aria-haspopup="menu"
                    aria-label="Open account menu"
                    title="Account"
                  >
                    <span className="truncate">{clerkLabel}</span>
                  </button>
                  {showUserMenu && (
                    <div
                      className="absolute right-0 z-50 mt-2 w-52 rounded-[5px] border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-950"
                      role="menu"
                    >
                      <div className="mb-1 border-b border-slate-200 px-3 pb-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <span className="block truncate font-semibold text-slate-700 dark:text-slate-200">
                          {clerkLabel}
                        </span>
                        <span className="block truncate" title={clerkSubLabel}>
                          {clerkSubLabel}
                        </span>
                      </div>
                      <Link
                        href={adminSignInUrl}
                        className="block rounded-[5px] px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                        onClick={() => setShowUserMenu(false)}
                      >
                        Admin sign-in
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="mt-1 block w-full rounded-[5px] px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                      >
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {workosEnabled ? (
                    <Link
                      href="/institutional-login"
                      className="hidden lg:inline-flex text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors whitespace-nowrap"
                    >
                      Institution
                    </Link>
                  ) : null}
                  <Link
                    href={userSignInUrl}
                    className="bg-primary-container dark:bg-primary-container text-white px-5 py-2 rounded-[5px] font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
                  >
                    Sign In
                  </Link>
                </>
              )}
            </div>
            <button
              type="button"
              aria-label={
                isMobileMenuOpen
                  ? "Close navigation menu"
                  : "Open navigation menu"
              }
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
            isMobileMenuOpen
              ? "max-h-[32rem] opacity-100 pt-4"
              : "max-h-0 opacity-0"
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
              <button
                type="button"
                onClick={() => setShowAboutMenu((open) => !open)}
                className={`flex items-center justify-between rounded-2xl px-4 py-3 font-body text-sm transition-colors ${
                  isAboutSectionActive
                    ? "bg-blue-950 text-white dark:bg-blue-500 dark:text-slate-950"
                    : "text-slate-600 hover:bg-slate-100 hover:text-blue-900 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                }`}
                aria-expanded={showAboutMenu}
              >
                <span>About</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${showAboutMenu ? "rotate-180" : ""}`}
                />
              </button>
              {showAboutMenu && (
                <div className="ml-4 flex flex-col gap-1">
                  {ABOUT_LINKS.map(({ href, label }) => {
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
                        onClick={() => {
                          setShowAboutMenu(false);
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-3 pt-3">
              {isAdminInitialized && isAdmin ? (
                <div className="flex flex-col gap-3">
                  <Link
                    href="/admin/dashboard"
                    className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-left dark:border-slate-800 dark:bg-slate-900/80"
                  >
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {adminDisplayLabel}
                    </div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {adminDisplaySubLabel}
                    </div>
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
                  <button
                    type="button"
                    onClick={() => setShowUserMenu((o) => !o)}
                    className="rounded-2xl bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {userLabelShort}
                    <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
                      {showUserMenu ? "Tap to hide menu" : "Account menu"}
                    </span>
                  </button>
                  {showUserMenu && (
                    <div className="flex flex-col gap-1 rounded-2xl border border-slate-200/80 bg-white/90 p-2 dark:border-slate-800 dark:bg-slate-950/90">
                      <Link
                        href="/history"
                        className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                        onClick={() => {
                          setShowUserMenu(false);
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        History
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          handleLogout();
                          setIsMobileMenuOpen(false);
                        }}
                        className="rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                      >
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              ) : showClerkSession ? (
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setShowUserMenu((open) => !open)}
                    className="rounded-2xl bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {clerkLabel}
                    <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
                      {clerkSubLabel}
                    </span>
                  </button>
                  {showUserMenu && (
                    <div className="flex flex-col gap-1 rounded-2xl border border-slate-200/80 bg-white/90 p-2 dark:border-slate-800 dark:bg-slate-950/90">
                      <Link
                        href={adminSignInUrl}
                        className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                        onClick={() => {
                          setShowUserMenu(false);
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        Admin sign-in
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          handleLogout();
                          setIsMobileMenuOpen(false);
                        }}
                        className="rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                      >
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {workosEnabled ? (
                    <Link
                      href="/institutional-login"
                      className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-center text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200"
                    >
                      Institutional access
                    </Link>
                  ) : null}
                  <Link
                    href={userSignInUrl}
                    className="bg-primary-container dark:bg-primary-container text-center text-white px-5 py-3 rounded-[5px] font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide whitespace-nowrap"
                  >
                    Sign In (individual)
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
