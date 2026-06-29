import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ChevronRight,
  Cpu,
  Database,
  FileCheck2,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { BrandLogo } from "@/components/BrandLogo";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: string[];
  startsWith?: string;
}

const PRIMARY_NAV: NavItem[] = [
  {
    href: "/admin/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    match: ["/admin", "/admin/dashboard"],
  },
  {
    href: "/admin/review",
    label: "Review",
    icon: FileCheck2,
    startsWith: "/admin/review",
    match: ["/admin/training", "/admin/reports", "/admin/bio-training"],
  },
  {
    href: "/admin/engine",
    label: "Engine",
    icon: Cpu,
    startsWith: "/admin/engine",
    match: ["/admin/diagnostics"],
  },
  {
    href: "/admin/data",
    label: "History",
    icon: Database,
    startsWith: "/admin/data",
    match: ["/admin/references", "/admin/analytics"],
  },
  { href: "/admin/health", label: "Health", icon: Activity },
];

/** A right-aligned value row, modeled on the account balances in the reference design. */
export interface SidebarStat {
  label: string;
  value: string;
  /** Visual accent for the leading dot. */
  tone?: "neutral" | "positive" | "warning" | "info";
}

export interface SidebarStatGroup {
  label: string;
  items: SidebarStat[];
}

const TONE_DOT: Record<NonNullable<SidebarStat["tone"]>, string> = {
  neutral: "bg-slate-400 dark:bg-slate-500",
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
  info: "bg-sky-400",
};

interface AdminShellProps {
  title: string;
  subtitle?: string;
  /** Optional content rendered on the right of the page header (toggles, actions). */
  headerActions?: React.ReactNode;
  /** Live value groups rendered in the sidebar, mirroring the account lists in the design. */
  sidebarStats?: SidebarStatGroup[];
  /** When true, the page fills exactly one viewport on large screens (no page scroll). */
  fitViewport?: boolean;
  children: React.ReactNode;
}

function isItemActive(item: NavItem, location: string) {
  if (item.match?.includes(location)) return true;
  if (item.startsWith && location.startsWith(item.startsWith)) return true;
  return location === item.href;
}

const COLLAPSE_KEY = "admin-sidebar-collapsed";

const footerBtnBase =
  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors";
const footerBtnIdle =
  "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white";

export function AdminShell({
  title,
  subtitle,
  headerActions,
  sidebarStats,
  fitViewport = false,
  children,
}: AdminShellProps) {
  const [location, setLocation] = useLocation();
  const { account, logout } = useAdminAuth();
  const [isDark, setIsDark] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  });

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const toggleDarkMode = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.add("no-transitions");
    document.documentElement.classList.toggle("dark", next);
    requestAnimationFrame(() =>
      document.documentElement.classList.remove("no-transitions"),
    );
  };

  const handleLogout = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    void logout().finally(() => {
      setLocation("/adm1n");
      setIsLoggingOut(false);
    });
  };

  const adminLabel = account?.name?.trim() || account?.username || "Administrator";
  const adminSubLabel =
    account?.email?.trim() ||
    (account?.username ? `@${account.username}` : "Admin session");
  const adminInitial = adminLabel.slice(0, 1).toUpperCase();

  /** rail = collapsed icon-only sidebar (desktop only). The mobile drawer is always expanded. */
  const renderSidebar = (rail: boolean) => (
    <div className="flex h-full flex-col px-3 py-4">
      {/* Brand — clicking the logo returns to the main site */}
      <Link
        href="/"
        className={cn(
          "mb-3 flex min-w-0 items-center gap-2",
          rail ? "justify-center px-0" : "px-3",
        )}
        title="Back to BulkReferences"
      >
        <BrandLogo className="h-7 shrink-0" />
        {!rail && (
          <>
            <span className="truncate font-headline text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
              BulkReferences
            </span>
            <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#0f4fa8] dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-sky-300">
              Admin
            </span>
          </>
        )}
      </Link>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item, location);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={rail ? item.label : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl py-2.5 text-sm font-semibold transition-colors",
                rail ? "justify-center px-0" : "px-3",
                active
                  ? "bg-[#002147] text-white dark:bg-[#0f4fa8]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white",
              )}
            >
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  active ? "text-white" : "text-slate-400 dark:text-slate-500",
                )}
                strokeWidth={2}
              />
              {!rail && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Live value groups (hidden in the rail) */}
      {!rail && sidebarStats && sidebarStats.length > 0 ? (
        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2">
          {sidebarStats.map((group) => (
            <div key={group.label}>
              <div className="mb-1 flex items-center gap-1.5 px-3">
                <ChevronRight className="h-3 w-3 text-slate-400 dark:text-slate-600" />
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {group.label}
                </span>
              </div>
              <div className="flex flex-col">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-1.5"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        TONE_DOT[item.tone ?? "neutral"],
                      )}
                    />
                    <span className="truncate text-[13px] font-medium text-slate-600 dark:text-slate-300">
                      {item.label}
                    </span>
                    <span className="ml-auto text-[13px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Footer: settings, help, theme, account */}
      <div className="mt-5 flex flex-col gap-0.5 border-t border-slate-200/70 pt-4 dark:border-slate-800/60">
        <Link
          href="/admin/settings"
          title={rail ? "Settings" : undefined}
          className={cn(
            footerBtnBase,
            rail ? "justify-center px-0" : "",
            location.startsWith("/admin/settings") &&
              !location.startsWith("/admin/settings/profile")
              ? "bg-slate-100 text-slate-900 dark:bg-white/5 dark:text-white"
              : footerBtnIdle,
          )}
        >
          <Settings className="h-[18px] w-[18px] shrink-0 text-slate-400 dark:text-slate-500" />
          {!rail && <span>Settings</span>}
        </Link>
        <a
          href="/contact"
          title={rail ? "Get Help" : undefined}
          className={cn(footerBtnBase, footerBtnIdle, rail && "justify-center px-0")}
        >
          <HelpCircle className="h-[18px] w-[18px] shrink-0 text-slate-400 dark:text-slate-500" />
          {!rail && <span>Get Help</span>}
        </a>
        <button
          type="button"
          onClick={toggleDarkMode}
          title={rail ? (isDark ? "Light mode" : "Dark mode") : undefined}
          className={cn(footerBtnBase, footerBtnIdle, rail && "justify-center px-0")}
        >
          {isDark ? (
            <Sun className="h-[18px] w-[18px] shrink-0 text-slate-400 dark:text-slate-500" />
          ) : (
            <Moon className="h-[18px] w-[18px] shrink-0 text-slate-400 dark:text-slate-500" />
          )}
          {!rail && <span>{isDark ? "Light mode" : "Dark mode"}</span>}
        </button>

        {/* Account — click to open profile */}
        <div
          className={cn(
            "mt-2 flex items-center gap-1 border-t border-slate-200/70 pt-3 dark:border-slate-800/60",
            rail && "flex-col",
          )}
        >
          <Link
            href="/admin/settings/profile"
            title={rail ? adminLabel : undefined}
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-white/5",
              rail ? "justify-center" : "flex-1",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#002147] text-xs font-black uppercase tracking-wider text-white">
              {adminInitial}
            </span>
            {!rail && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                  {adminLabel}
                </span>
                <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">
                  {adminSubLabel}
                </span>
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/20 dark:hover:text-red-400"
            aria-label="Sign out"
            title={isLoggingOut ? "Signing out…" : "Sign out"}
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#0a0e16] dark:text-slate-100",
        fitViewport ? "min-h-[100dvh] lg:h-screen lg:overflow-hidden" : "min-h-[100dvh]",
      )}
    >
      {/* Desktop sidebar — fixed so it always floats in view while the page scrolls */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-slate-200/80 bg-white transition-[width] duration-200 lg:block dark:border-slate-800/60 dark:bg-[#0c111b]",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        {renderSidebar(collapsed)}
        {/* Collapse / expand handle on the border */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="absolute -right-3 top-20 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 dark:border-slate-700 dark:bg-[#161c2a] dark:text-slate-400 dark:hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-slate-200/80 bg-white shadow-2xl dark:border-slate-800/60 dark:bg-[#0c111b]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {renderSidebar(false)}
          </aside>
        </div>
      ) : null}

      {/* Content — padded to clear the fixed sidebar */}
      <div
        className={cn(
          "transition-[padding] duration-200",
          collapsed ? "lg:pl-[72px]" : "lg:pl-64",
          fitViewport && "lg:h-screen lg:overflow-hidden",
        )}
      >
        <main
          className={cn(
            "min-w-0 px-5 pt-5 sm:px-8 lg:px-10",
            fitViewport
              ? "pb-5 lg:flex lg:h-screen lg:flex-col lg:overflow-hidden"
              : "pb-16",
          )}
        >
          {/* Page header */}
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 lg:hidden dark:hover:bg-white/5"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            </div>
            {headerActions ? (
              <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
            ) : null}
          </div>

          {fitViewport ? (
            <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">{children}</div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

/** Card primitive matching the reference design's panels. */
export function AdminCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Card header row: title on the left, optional "view all" link on the right. */
export function AdminCardHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">
        {title}
      </h3>
      {action ? (
        <Link
          href={action.href}
          className="flex items-center gap-0.5 text-xs font-semibold text-slate-400 transition-colors hover:text-[#002147] dark:text-slate-500 dark:hover:text-sky-300"
        >
          {action.label}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
