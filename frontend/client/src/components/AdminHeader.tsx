import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { BrandLogo } from "@/components/BrandLogo";

export function AdminHeader() {
  const [location, setLocation] = useLocation();
  const { account, logout } = useAdminAuth();
  const [isDark, setIsDark] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);
  const [openMobileNavGroup, setOpenMobileNavGroup] = useState<string | null>(
    null,
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const notificationsRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);

    const handleClickOutside = (event: MouseEvent) => {
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
      if (
        accountRef.current &&
        !accountRef.current.contains(event.target as Node)
      ) {
        setShowAccountMenu(false);
      }
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenNavGroup(null);
      }
    };

    // Close mobile menu on resize if above md breakpoint
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
        setOpenMobileNavGroup(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const toggleDarkMode = () => {
    const newDark = !isDark;
    setIsDark(newDark);

    // Disable transitions for instant switch
    document.documentElement.classList.add("no-transitions");

    if (newDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Remove the class after the transition is suppressed
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  };

  const navLinks = [
    {
      href: "/admin/dashboard",
      label: "Dashboard",
      match: ["/admin/dashboard", "/admin"],
    },
  ];

  const secondaryNavLinks = [
    {
      href: "/admin/engine",
      label: "Engine",
      startsWith: "/admin/engine",
      match: ["/admin/diagnostics"],
    },
    {
      href: "/admin/data",
      label: "Data",
      startsWith: "/admin/data",
      match: ["/admin/references", "/admin/analytics"],
    },
    { href: "/admin/health", label: "Health" },
  ];

  const navGroups = [
    {
      id: "review",
      label: "Review",
      icon: "fact_check",
      links: [
        {
          href: "/admin/review",
          label: "Needs action",
          description: "Fast review path for launch-blocking work.",
          startsWith: "/admin/review",
          match: ["/admin/training"],
        },
        {
          href: "/admin/review#learning-queue",
          label: "Learning queue",
          description:
            "Incoming candidate rows that still need review or promotion.",
          startsWith: "/admin/review",
        },
        {
          href: "/admin/review#approved-truth",
          label: "Approved truth",
          description: "Curated truth rows, certification, and export state.",
          startsWith: "/admin/review",
        },
        {
          href: "/admin/review/reports",
          label: "Reports",
          description: "User reports and action-needed citations.",
          startsWith: "/admin/reports",
          match: ["/admin/review/reports"],
        },
        {
          href: "/admin/review/bio",
          label: "BIO",
          description: "BIO datasets, tagging, bundle training, and runtime.",
          startsWith: "/admin/bio-training",
          match: [
            "/admin/review/bio",
            "/admin/review/bio/tagging",
            "/admin/review/bio/training",
            "/admin/review/bio/runtime",
          ],
        },
        {
          href: "/admin/data",
          label: "History",
          description: "Stored reference archive and past batch outcomes.",
          startsWith: "/admin/data",
          match: ["/admin/references"],
        },
      ],
    },
  ];

  const adminLabel =
    account?.name?.trim() || account?.username || "Administrator";
  const adminSubLabel =
    account?.email?.trim() ||
    (account?.username ? `@${account.username}` : "Administrator session");
  const adminInitial = adminLabel.slice(0, 1).toUpperCase();

  const handleLogout = () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    void logout().finally(() => {
      setShowAccountMenu(false);
      setLocation("/adm1n");
      setIsLoggingOut(false);
    });
  };

  const isNavLinkActive = (link: {
    href: string;
    match?: string[];
    startsWith?: string;
  }) => {
    if (link.match?.includes(location)) return true;
    if (link.startsWith) return location.startsWith(link.startsWith);
    return location === link.href;
  };

  const isNavGroupActive = (group: (typeof navGroups)[number]) =>
    group.links.some((link) => isNavLinkActive(link));

  return (
    <header className="fixed top-0 w-full z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200/50 dark:border-slate-800/50 shadow-sm font-body">
      <div className="flex items-center w-full px-8 h-16 max-w-none mx-auto relative">
        {/* Left Side: Brand */}
        <div className="flex-1 flex items-center min-w-0">
          <Link href="/" className="flex items-center gap-2 group">
            <BrandLogo className="h-9" />
            <span className="text-xl font-bold text-slate-900 dark:text-slate-100 font-headline cursor-pointer truncate">
              BulkReferences
            </span>
            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 text-[9px] font-black uppercase tracking-widest text-[#002147] dark:text-blue-300 border border-slate-200 dark:border-slate-800/80">
              Beta
            </span>
          </Link>
        </div>

        {/* Center: Navigation (Hidden on mobile) */}
        <nav
          ref={navRef}
          className="hidden md:flex items-center gap-2 justify-center flex-shrink-0 xl:gap-3"
        >
          {navLinks.map((link) => {
            const isActive = isNavLinkActive(link);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-xs cursor-pointer uppercase tracking-widest px-2 py-1.5 relative rounded-md transition-colors",
                  isActive
                    ? "bg-slate-900 text-white font-black dark:bg-blue-500 dark:text-slate-950"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white font-bold",
                )}
              >
                {link.label}
              </Link>
            );
          })}
          {navGroups.map((group) => {
            const isActive = isNavGroupActive(group);
            const isOpen = openNavGroup === group.id;

            return (
              <div key={group.id} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setOpenNavGroup(isOpen ? null : group.id);
                    setShowNotifications(false);
                    setShowAccountMenu(false);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-widest transition-colors",
                    isActive
                      ? "bg-slate-900 font-black text-white dark:bg-blue-500 dark:text-slate-950"
                      : "font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
                  )}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                >
                  <span>{group.label}</span>
                  <span className="material-symbols-outlined text-base leading-none">
                    {isOpen ? "expand_less" : "expand_more"}
                  </span>
                </button>

                {isOpen && (
                  <div className="absolute left-1/2 z-50 mt-2 w-72 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl animate-in fade-in zoom-in slide-in-from-top-2 duration-200 dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-1 flex items-center gap-2 px-3 py-2">
                      <span className="material-symbols-outlined text-lg text-[#0f4fa8] dark:text-blue-300">
                        {group.icon}
                      </span>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        {group.label}
                      </p>
                    </div>
                    {group.links.map((link) => {
                      const linkActive = isNavLinkActive(link);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setOpenNavGroup(null)}
                          className={cn(
                            "block rounded-lg px-3 py-2.5 transition-colors",
                            linkActive
                              ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
                              : "text-slate-700 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
                          )}
                        >
                          <span className="block text-xs font-black uppercase tracking-widest">
                            {link.label}
                          </span>
                          <span className="mt-1 block text-[11px] font-semibold normal-case tracking-normal text-slate-500 dark:text-slate-400">
                            {link.description}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {secondaryNavLinks.map((link) => {
            const isActive = isNavLinkActive(link);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-xs cursor-pointer uppercase tracking-widest px-2 py-1.5 relative rounded-md transition-colors",
                  isActive
                    ? "bg-slate-900 text-white font-black dark:bg-blue-500 dark:text-slate-950"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white font-bold",
                )}
              >
                {link.label}
              </Link>
            );
          })}
          <Link
            href="/admin/settings"
            className={cn(
              "text-xs cursor-pointer uppercase tracking-widest px-2 py-1.5 relative rounded-md transition-colors",
              location.startsWith("/admin/settings")
                ? "bg-slate-900 text-white font-black dark:bg-blue-500 dark:text-slate-950"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white font-bold",
            )}
          >
            Settings
          </Link>
        </nav>

        {/* Right Side: Tools & Profile */}
        <div className="flex-1 flex items-center gap-2 md:gap-4 justify-end">
          {/* Notifications */}
          <div className="relative" ref={notificationsRef}>
            <button
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowAccountMenu(false);
                setOpenNavGroup(null);
              }}
              className="h-10 w-10 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-900 rounded-full transition-all relative group"
            >
              <span className="material-symbols-outlined text-on-surface-variant dark:text-slate-400 group-hover:text-primary transition-colors">
                notifications
              </span>
            </button>

            {showNotifications && (
              <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-4 z-50 animate-in fade-in zoom-in slide-in-from-top-2 duration-200">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-bold text-sm text-primary dark:text-slate-200">
                    Notifications
                  </h4>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">
                    Admin
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  This panel is reserved for live operational alerts. Use
                  Review, Engine, Data, and Health for current status until
                  notifications are wired to real backend events.
                </div>
              </div>
            )}
          </div>

          {/* Account Menu */}
          <div className="relative" ref={accountRef}>
            <button
              type="button"
              onClick={() => {
                setShowAccountMenu(!showAccountMenu);
                setShowNotifications(false);
                setOpenNavGroup(null);
              }}
              className="flex items-center gap-3 rounded-full bg-white/50 px-2 h-10 transition-all hover:bg-slate-100 dark:bg-slate-900/50 dark:hover:bg-slate-900"
            >
              <div className="hidden min-w-0 text-right xl:block">
                <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-slate-900 dark:text-slate-100">
                  Signed In
                </p>
                <p className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {adminLabel}
                </p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#002147] text-xs font-black uppercase tracking-wider text-white shadow-sm">
                {adminInitial}
              </div>
            </button>

            {showAccountMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in slide-in-from-top-2 duration-200">
                <div className="px-3 py-2 mb-1 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {adminLabel}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {adminSubLabel}
                  </p>
                </div>

                <Link
                  href="/admin/settings/profile"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">
                    person
                  </span>
                  Profile Details
                </Link>
                <Link
                  href="/admin/settings"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">
                    settings
                  </span>
                  System Settings
                </Link>
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">
                    {isDark ? "light_mode" : "dark_mode"}
                  </span>
                  {isDark ? "Classic Light" : "Scholar Dark"}
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-lg">
                    {isLoggingOut ? "hourglass_top" : "logout"}
                  </span>
                  {isLoggingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            )}
          </div>

          {/* Mobile Menu Trigger (Moved to right) */}
          <button
            onClick={() => {
              setIsMobileMenuOpen(!isMobileMenuOpen);
              setOpenNavGroup(null);
              setOpenMobileNavGroup(null);
            }}
            className="flex md:hidden h-10 w-10 items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-900 rounded-full transition-all group"
          >
            <span className="material-symbols-outlined text-slate-600 dark:text-slate-400 group-hover:text-primary">
              {isMobileMenuOpen ? "close" : "menu"}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Dropdown */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-16 left-0 w-full bg-white dark:bg-slate-950 border-b border-slate-200/50 dark:border-slate-800/50 shadow-xl z-40 animate-in fade-in slide-in-from-top-1 duration-200">
          <nav className="flex flex-col p-4 gap-2">
            {navLinks.map((link) => {
              const isActive = isNavLinkActive(link);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all",
                    isActive
                      ? "bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50",
                  )}
                >
                  <span>{link.label}</span>
                  {isActive && (
                    <span className="material-symbols-outlined text-sm">
                      chevron_right
                    </span>
                  )}
                </Link>
              );
            })}
            {navGroups.map((group) => {
              const isOpen = openMobileNavGroup === group.id;
              const isActive = isNavGroupActive(group);

              return (
                <div key={group.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenMobileNavGroup(isOpen ? null : group.id)
                    }
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl p-4 text-sm font-bold uppercase tracking-widest transition-all",
                      isActive
                        ? "bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                        : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900/50",
                    )}
                    aria-expanded={isOpen}
                  >
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-base">
                        {group.icon}
                      </span>
                      {group.label}
                    </span>
                    <span className="material-symbols-outlined text-sm">
                      {isOpen ? "expand_less" : "expand_more"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 pl-4">
                      {group.links.map((link) => {
                        const linkActive = isNavLinkActive(link);

                        return (
                          <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => {
                              setIsMobileMenuOpen(false);
                              setOpenMobileNavGroup(null);
                            }}
                            className={cn(
                              "flex items-center justify-between rounded-xl p-4 text-sm font-bold uppercase tracking-widest transition-all",
                              linkActive
                                ? "bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                                : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900/50",
                            )}
                          >
                            <span>{link.label}</span>
                            {linkActive && (
                              <span className="material-symbols-outlined text-sm">
                                chevron_right
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {secondaryNavLinks.map((link) => {
              const isActive = isNavLinkActive(link);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all",
                    isActive
                      ? "bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50",
                  )}
                >
                  <span>{link.label}</span>
                  {isActive && (
                    <span className="material-symbols-outlined text-sm">
                      chevron_right
                    </span>
                  )}
                </Link>
              );
            })}
            <Link
              href="/admin/settings"
              onClick={() => setIsMobileMenuOpen(false)}
              className={cn(
                "flex items-center justify-between p-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all",
                location.startsWith("/admin/settings")
                  ? "bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50",
              )}
            >
              <span>Settings</span>
              {location.startsWith("/admin/settings") && (
                <span className="material-symbols-outlined text-sm">
                  chevron_right
                </span>
              )}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
