import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronDown,
  Menu,
  Moon,
  Sun,
  FileText,
  History,
  Info,
  LogIn,
  LogOut,
  LineChart,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { useUserSession } from "@/hooks/use-user-session";
import { buildAuthEntryUrl } from "@/lib/loginFlow";
import { BrandLogo } from "@/components/BrandLogo";

const ABOUT_LINKS = [
  { href: "/about", label: "Our Mission", icon: Info },
  { href: "/contact", label: "Contact", icon: Mail },
];

export function Navbar() {
  const [navOpen, setNavOpen] = useState(false);
  const [showAboutMenu, setShowAboutMenu] = useState(false);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const {
    isAdmin,
    isConfigured,
    isInitialized,
    account: adminAccount,
    logout,
  } = useAdminAuth();
  const {
    isAuthenticated: isUserAuthenticated,
    isInitialized: isUserInitialized,
    account: userAccount,
    logout: logoutUser,
  } = useUserSession();
  const [location, setLocation] = useLocation();
  const [isDark, setIsDark] = useState(false);
  const aboutMenuRef = useRef<HTMLDivElement>(null);
  const aboutMenuCloseTimeoutRef = useRef<number | null>(null);
  const adminMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isDarkMode =
      document.documentElement.classList.contains("dark") ||
      localStorage.getItem("theme") === "dark";
    setIsDark(isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    }
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

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);

    // Disable transitions for instant switch
    document.documentElement.classList.add("no-transitions");

    if (nextTheme) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }

    // Remove the class after the transition is suppressed
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  };

  const handleLogout = () => {
    void logout().finally(() => {
      setLocation("/adm1n");
    });
  };

  const handleUserLogout = () => {
    setShowUserMenu(false);
    void logoutUser().finally(() => {
      setLocation("/");
    });
  };

  const userNavLabel =
    userAccount?.institution?.name ??
    userAccount?.name?.split(" ")?.[0] ??
    "Account";

  const adminLabel =
    adminAccount?.name?.trim() || adminAccount?.username || "Administrator";
  const adminSubLabel =
    adminAccount?.email?.trim() ||
    (adminAccount?.username ? `@${adminAccount.username}` : "Admin session");
  const adminInitial = adminLabel.slice(0, 1).toUpperCase();
  const isAboutSectionActive = ABOUT_LINKS.some(
    ({ href }) => location === href,
  );
  const userSignInUrl = buildAuthEntryUrl({ flow: "user", mode: "sign-in" });

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
    <header className="bg-background/90 backdrop-blur-lg border-b border-border shadow-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center space-x-3 group min-w-0">
            <BrandLogo className="h-10" />
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-lg font-extrabold text-foreground tracking-tight truncate">
                BulkReferences
              </h1>
              <Badge
                variant="secondary"
                className="text-[10px] uppercase font-bold text-white bg-primary hover:bg-primary/90 hidden sm:inline-flex"
              >
                Beta
              </Badge>
            </div>
          </Link>

          <nav className="hidden md:flex items-center space-x-6">
            <Link
              href="/#converter"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              Converter
            </Link>
            <Link
              href="/history"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              History
            </Link>
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
                className={`flex items-center gap-1 text-sm font-medium transition-colors cursor-pointer ${
                  isAboutSectionActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-primary"
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
                  className="absolute left-1/2 top-full z-50 mt-3 w-44 -translate-x-1/2 rounded-[5px] border border-border bg-popover p-2 shadow-md"
                  role="menu"
                >
                  {ABOUT_LINKS.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className="block rounded-[5px] px-3 py-2 text-sm font-medium text-popover-foreground transition-colors hover:bg-muted"
                      onClick={() => setShowAboutMenu(false)}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {isInitialized && isAdmin ? (
              <>
                <Link
                  href="/admin/reports"
                  className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer"
                >
                  Admin Mode
                </Link>
                <div className="relative hidden xl:block" ref={adminMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowAdminMenu((open) => !open)}
                    className="flex items-center gap-3 rounded-full border border-slate-200/80 bg-white/85 px-2 py-1.5 shadow-sm transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700"
                  >
                    <div className="text-right min-w-0">
                      <div className="truncate max-w-[12rem] text-xs font-semibold text-foreground">
                        {adminLabel}
                      </div>
                      <div className="truncate max-w-[12rem] text-[11px] text-muted-foreground">
                        {adminSubLabel}
                      </div>
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container text-xs font-black uppercase tracking-wider text-white">
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
                        onClick={handleLogout}
                        className="mt-1 block w-full rounded-[5px] px-3 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
                      >
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : isUserInitialized && isUserAuthenticated ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowUserMenu((open) => !open)}
                  className="flex max-w-[12rem] items-center gap-2 rounded-full border border-border bg-muted/20 px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-primary"
                  aria-expanded={showUserMenu}
                  aria-haspopup="menu"
                >
                  <span className="truncate">{userNavLabel}</span>
                </button>
                {showUserMenu && (
                  <div
                    className="absolute right-0 z-50 mt-2 w-52 rounded-md border border-border bg-popover p-2 shadow-md"
                    role="menu"
                  >
                    <Link
                      href="/history"
                      className="block rounded-sm px-3 py-2 text-sm font-medium text-popover-foreground hover:bg-muted"
                      onClick={() => setShowUserMenu(false)}
                    >
                      History
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleUserLogout}
                      className="mt-1 block w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-popover-foreground hover:bg-muted"
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : isInitialized && isConfigured ? (
              <Link
                href={userSignInUrl}
                className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer border px-3 py-1.5 rounded-[5px] bg-muted/30"
              >
                Login
              </Link>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="rounded-full w-8 h-8 ml-2"
              title="Toggle theme"
            >
              {isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              <span className="sr-only">Toggle theme</span>
            </Button>
          </nav>

          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <div className="flex items-center gap-2 md:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="rounded-full w-8 h-8"
                title="Toggle theme"
              >
                {isDark ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
                <span className="sr-only">Toggle theme</span>
              </Button>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
            </div>
            <SheetContent side="right" className="w-[280px] pt-10">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation Menu</SheetTitle>
                <SheetDescription>
                  Access different sections of BulkReferences
                </SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-1">
                <Link
                  href="/#converter"
                  onClick={() => setNavOpen(false)}
                  className="flex items-center gap-3 text-sm font-medium hover:text-primary transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50"
                >
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  Converter
                </Link>
                <Link
                  href="/history"
                  onClick={() => setNavOpen(false)}
                  className="flex items-center gap-3 text-sm font-medium hover:text-primary transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50"
                >
                  <History className="w-4 h-4 text-muted-foreground" />
                  History
                </Link>
                <button
                  type="button"
                  onClick={() => setShowAboutMenu((open) => !open)}
                  className="flex items-center justify-between gap-3 py-3 px-2 text-sm font-medium transition-colors cursor-pointer rounded-md hover:bg-muted/50 hover:text-primary"
                  aria-expanded={showAboutMenu}
                >
                  <span className="flex items-center gap-3">
                    <Info className="w-4 h-4 text-muted-foreground" />
                    About
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${showAboutMenu ? "rotate-180" : ""}`}
                  />
                </button>
                {showAboutMenu && (
                  <div className="ml-2 flex flex-col gap-1 rounded-md border border-border bg-muted/20 p-2">
                    {ABOUT_LINKS.map(({ href, label, icon: Icon }) => (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => {
                          setShowAboutMenu(false);
                          setNavOpen(false);
                        }}
                        className="flex items-center gap-3 rounded-sm px-2 py-2 text-sm hover:bg-muted/50"
                      >
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        {label}
                      </Link>
                    ))}
                  </div>
                )}

                <div className="my-2 border-t border-border"></div>

                {isInitialized && isAdmin ? (
                  <>
                    <Link
                      href="/admin/reports"
                      onClick={() => setNavOpen(false)}
                      className="flex items-center gap-3 text-sm font-semibold text-primary hover:text-primary/80 transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50"
                    >
                      <LineChart className="w-4 h-4" />
                      Admin Mode
                    </Link>
                    <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
                      <div className="text-sm font-semibold text-foreground">
                        {adminLabel}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {adminSubLabel}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        handleLogout();
                        setNavOpen(false);
                      }}
                      className="flex items-center gap-3 text-sm font-medium text-destructive hover:text-destructive/80 transition-colors py-3 px-2 text-left cursor-pointer rounded-[5px] hover:bg-muted/50 w-full"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  </>
                ) : isUserInitialized && isUserAuthenticated ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowUserMenu((o) => !o)}
                      className="flex w-full items-center gap-3 rounded-md py-3 px-2 text-left text-sm font-medium hover:bg-muted/50"
                    >
                      <History className="w-4 h-4 text-muted-foreground" />
                      <span className="truncate">{userNavLabel}</span>
                    </button>
                    {showUserMenu && (
                      <div className="ml-2 flex flex-col gap-1 rounded-md border border-border bg-muted/20 p-2">
                        <Link
                          href="/history"
                          onClick={() => {
                            setNavOpen(false);
                            setShowUserMenu(false);
                          }}
                          className="rounded-sm px-2 py-2 text-sm hover:bg-muted/50"
                        >
                          History
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            handleUserLogout();
                            setNavOpen(false);
                          }}
                          className="rounded-sm px-2 py-2 text-left text-sm text-destructive hover:bg-muted/50"
                        >
                          Log out
                        </button>
                      </div>
                    )}
                  </>
                ) : isInitialized && isConfigured ? (
                  <Link
                    href={userSignInUrl}
                    onClick={() => setNavOpen(false)}
                    className="flex items-center gap-3 text-sm font-medium hover:text-primary transition-colors py-3 px-2 cursor-pointer rounded-[5px] hover:bg-muted/50"
                  >
                    <LogIn className="w-4 h-4 text-muted-foreground" />
                    Login
                  </Link>
                ) : null}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
