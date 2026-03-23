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
    <div className="inline-flex rounded-xl border border-border/70 bg-muted/30 p-1">
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
                "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
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
