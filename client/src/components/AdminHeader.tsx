import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

export function AdminHeader() {
  const [location, setLocation] = useLocation();
  const { account, logout } = useAuth();
  const [isDark, setIsDark] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  
  const notificationsRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);

    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setShowAccountMenu(false);
      }
    };

    // Close mobile menu on resize if above md breakpoint
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
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
    { href: "/admin/dashboard", label: "Dashboard", match: ["/admin/dashboard", "/admin"] },
    { href: "/admin/analytics", label: "Analytics" },
    { href: "/history", label: "References" },
    { href: "/admin/reports", label: "Failure Queue", startsWith: "/admin/reports" },
    { href: "/admin/health", label: "System Health" },
    { href: "/admin/settings", label: "Settings" },
  ];

  const adminLabel = account?.name?.trim() || account?.username || "Administrator";
  const adminSubLabel = account?.email?.trim() || (account?.username ? `@${account.username}` : "Administrator session");
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

  return (
    <header className="fixed top-0 w-full z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200/50 dark:border-slate-800/50 shadow-sm font-body">
      <div className="flex items-center w-full px-8 h-16 max-w-none mx-auto relative">
        {/* Left Side: Brand */}
        <div className="flex-1 flex items-center min-w-0">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-xl font-bold text-slate-900 dark:text-slate-100 font-headline cursor-pointer truncate">BulkReferences</span>
            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 text-[9px] font-black uppercase tracking-widest text-[#002147] dark:text-blue-300 border border-slate-200 dark:border-slate-800/80">Beta</span>
          </Link>
        </div>

        {/* Center: Navigation (Hidden on mobile) */}
        <nav className="hidden md:flex items-center gap-6 justify-center flex-shrink-0">
          {navLinks.map((link) => {
            const isActive = link.startsWith 
              ? location.startsWith(link.href) 
              : link.match 
                ? link.match.includes(location) 
                : location === link.href;

            return (
              <Link key={link.href} href={link.href}>
                <a className={cn(
                  "text-xs cursor-pointer uppercase tracking-widest px-2 py-1.5 relative rounded-md transition-colors",
                  isActive 
                    ? "bg-slate-900 text-white font-black dark:bg-blue-500 dark:text-slate-950" 
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white font-bold"
                )}>
                  {link.label}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* Right Side: Tools & Profile */}
        <div className="flex-1 flex items-center gap-2 md:gap-4 justify-end">
          {/* Notifications */}
          <div className="relative" ref={notificationsRef}>
            <button 
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowAccountMenu(false);
              }}
              className="h-10 w-10 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-900 rounded-full transition-all relative group"
            >
              <span className="material-symbols-outlined text-on-surface-variant dark:text-slate-400 group-hover:text-primary transition-colors">notifications</span>
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-slate-950" />
            </button>
            
            {showNotifications && (
              <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-4 z-50 animate-in fade-in zoom-in slide-in-from-top-2 duration-200">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-bold text-sm text-primary dark:text-slate-200">Alerts & Notifications</h4>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">2 New</span>
                </div>
                <div className="space-y-3">
                  <div className="p-3 bg-red-50 dark:bg-red-950/20 border-l-4 border-red-500 rounded-r-lg">
                    <p className="text-xs font-bold text-red-900 dark:text-red-300">Failure Queue Alert</p>
                    <p className="text-[11px] text-red-700 dark:text-red-400 mt-1">12 new citations failed validation in the logic engine.</p>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border-l-4 border-blue-500 rounded-r-lg">
                    <p className="text-xs font-bold text-blue-900 dark:text-blue-300">System Performance</p>
                    <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-1">Latency spike detected in DOI resolution provider.</p>
                  </div>
                </div>
                <button className="w-full mt-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition-colors border-t border-slate-100 dark:border-slate-800 pt-3">
                  Dismiss All
                </button>
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
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{adminLabel}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{adminSubLabel}</p>
                </div>
                
                <Link href="/admin/settings">
                  <a className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                    <span className="material-symbols-outlined text-lg">person</span>
                    Profile Details
                  </a>
                </Link>
                <Link href="/admin/settings">
                  <a className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                    <span className="material-symbols-outlined text-lg">settings</span>
                    System Settings
                  </a>
                </Link>
                <button 
                  type="button"
                  onClick={toggleDarkMode}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">{isDark ? "light_mode" : "dark_mode"}</span>
                  {isDark ? "Classic Light" : "Scholar Dark"}
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                <button 
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-lg">{isLoggingOut ? "hourglass_top" : "logout"}</span>
                  {isLoggingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            )}
          </div>

          {/* Mobile Menu Trigger (Moved to right) */}
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
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
              const isActive = link.startsWith 
                ? location.startsWith(link.href) 
                : link.match 
                  ? link.match.includes(location) 
                  : location === link.href;

              return (
                <Link key={link.href} href={link.href}>
                  <a 
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all",
                      isActive 
                        ? "bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100" 
                        : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    )}
                  >
                    <span>{link.label}</span>
                    {isActive && <span className="material-symbols-outlined text-sm">chevron_right</span>}
                  </a>
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
