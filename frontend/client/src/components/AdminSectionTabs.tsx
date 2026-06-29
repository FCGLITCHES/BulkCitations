import { Dna, ListChecks, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface AdminReviewTab {
  href: string;
  label: string;
  icon: LucideIcon;
  matches?: string[];
  startsWith?: string;
}

const tabs: AdminReviewTab[] = [
  {
    href: "/admin/review",
    label: "Curation",
    icon: ListChecks,
    matches: ["/admin/review", "/admin/training"],
  },
  {
    href: "/admin/review/bio",
    label: "BIO",
    icon: Dna,
    startsWith: "/admin/bio-training",
    matches: [
      "/admin/review/bio",
      "/admin/review/bio/tagging",
      "/admin/review/bio/training",
      "/admin/review/bio/runtime",
    ],
  },
];

export function AdminSectionTabs() {
  const [location] = useLocation();

  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1 dark:border-slate-800/60 dark:bg-[#121826]">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive =
          (tab.matches?.includes(location) ?? false) ||
          (tab.startsWith ? location.startsWith(tab.startsWith) : false) ||
          location === tab.href;

        return (
          <Link key={tab.href} href={tab.href}>
            <button
              type="button"
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-[#002147] text-white dark:bg-[#0f4fa8]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white",
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
