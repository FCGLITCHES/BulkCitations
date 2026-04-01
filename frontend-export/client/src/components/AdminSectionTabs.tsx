import { BarChart3, Inbox } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const tabs = [
  {
    href: "/admin/reports",
    label: "Reports",
    icon: Inbox,
  },
  {
    href: "/admin/analytics",
    label: "Analytics",
    icon: BarChart3,
  },
] as const;

export function AdminSectionTabs() {
  const [location] = useLocation();

  return (
    <div className="inline-flex rounded-xl border border-slate-200/70 bg-white/90 p-1 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/90">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.href === "/admin/reports"
          ? location === tab.href || location.startsWith("/admin/reports/")
          : location === tab.href;

        return (
          <Link key={tab.href} href={tab.href}>
            <button
              type="button"
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-slate-900 text-white shadow-sm dark:bg-blue-500 dark:text-slate-950"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          </Link>
        );
      })}
    </div>
  );
}
