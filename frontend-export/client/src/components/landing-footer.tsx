import { Link } from "wouter";

export function LandingFooter() {
  return (
    <footer className="bg-white dark:bg-slate-950 w-full py-12 border-t border-slate-100 dark:border-slate-800/20 relative z-10">
      <div className="max-w-screen-2xl mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex flex-col gap-2">
          <span className="font-headline italic text-primary-container dark:text-blue-50 text-xl font-bold">BulkReferences</span>
          <p className="font-body text-xs text-slate-500 dark:text-slate-400">© {new Date().getFullYear()} BulkReferences. Precision in Every Reference.</p>
        </div>
        <div className="flex gap-8">
          <Link href="/support" className="font-body text-xs text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors opacity-80 hover:opacity-100 duration-300">
            Support
          </Link>
          <Link href="/contact" className="font-body text-xs text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors opacity-80 hover:opacity-100 duration-300">
            Contact
          </Link>
          <Link href="/privacy" className="font-body text-xs text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors opacity-80 hover:opacity-100 duration-300">
            Privacy
          </Link>
          <Link href="/admin-login" className="font-body text-xs text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors opacity-80 hover:opacity-100 duration-300">
            Admin
          </Link>
          <Link href="/terms" className="font-body text-xs text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors opacity-80 hover:opacity-100 duration-300">
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
}
