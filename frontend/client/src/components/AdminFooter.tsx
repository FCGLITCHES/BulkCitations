import { Link } from "wouter";
import { BrandLogo } from "@/components/BrandLogo";

export function AdminFooter() {
  return (
    <footer className="w-full bg-slate-50/50 dark:bg-slate-950/50 border-t border-slate-200/50 dark:border-slate-800/50 py-12 transition-colors">
      <div className="max-w-[1600px] mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-10" />
            <span className="font-headline italic text-primary-container dark:text-blue-50 text-xl font-bold">
              BulkReferences
            </span>
            <span className="px-2 py-0.5 rounded bg-primary-container/10 dark:bg-blue-900/30 text-[10px] font-black uppercase tracking-widest text-primary-container dark:text-blue-300 border border-primary-container/20 dark:border-blue-800/30">
              Admin Suite
            </span>
          </div>
          <p className="font-body text-[11px] text-slate-500 dark:text-slate-400">
            © {new Date().getFullYear()} CitoArchivist Digital Library Systems.
            Scholarly Precision Engineering.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
          {[
            { href: "/admin/dashboard", label: "Dashboard" },
            { href: "/admin/review", label: "Review" },
            { href: "/admin/review/bio", label: "BIO" },
            { href: "/admin/engine", label: "Engine" },
            { href: "/admin/data", label: "Data" },
            { href: "/admin/health", label: "Health" },
            { href: "/admin/settings", label: "Settings" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-primary-container dark:text-slate-500 dark:hover:text-blue-300 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              System Operational
            </span>
          </div>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block"></div>
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest hidden sm:block">
            v2.4.0-stable
          </span>
        </div>
      </div>
    </footer>
  );
}
