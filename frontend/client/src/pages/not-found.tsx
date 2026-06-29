import { Link } from "wouter";
import { BookOpen, Home, Search } from "lucide-react";
import { LandingNavbar } from "@/components/landing-navbar";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface dark:text-slate-100 antialiased h-[100dvh] overflow-hidden flex flex-col">
      <LandingNavbar />

      <main className="w-full flex-1 flex items-center justify-center px-4 py-4 sm:px-6 sm:py-6">
        <div className="max-w-xl mx-auto text-center py-4 sm:py-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-5">
            <BookOpen className="h-8 w-8 text-primary-container dark:text-blue-300" />
          </div>

          <div className="mb-3 flex flex-col items-center">
            <span className="text-[6rem] sm:text-[7.5rem] font-headline font-bold leading-none tracking-tighter text-primary-container/10 dark:text-blue-200/10 select-none" aria-hidden="true">
              404
            </span>
            <h1 className="mt-4 text-2xl sm:text-3xl font-headline font-bold text-primary-container dark:text-blue-50">
              Page not found
            </h1>
          </div>

          <p className="text-on-surface-variant dark:text-slate-400 text-sm sm:text-base mb-6 max-w-md mx-auto leading-relaxed">
            The page you&apos;re looking for doesn&apos;t exist or has been moved. Let us help you find your way back.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              asChild
              className="bg-primary-container dark:bg-primary-container text-white px-6 py-3 rounded-[5px] font-body font-medium hover:bg-[#002f5f] dark:hover:bg-[#002f5f] transition-colors duration-150 text-sm tracking-wide"
            >
              <Link href="/">
                <Home className="h-4 w-4 mr-2" />
                Go to Home
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-6 py-3 rounded-[5px] font-body font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 text-sm tracking-wide"
            >
              <Link href="/resources">
                <Search className="h-4 w-4 mr-2" />
                Browse Resources
              </Link>
            </Button>
          </div>

          <div className="mt-8 pt-5 border-t border-slate-200/60 dark:border-slate-800/60">
            <p className="text-xs text-muted-foreground mb-3">Quick links</p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <Link href="/faq" className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors">
                FAQ
              </Link>
              <Link href="/prices" className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors">
                Prices
              </Link>
              <Link href="/about" className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors">
                About
              </Link>
              <Link href="/contact" className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors">
                Contact
              </Link>
              <Link href="/api-docs" className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary-container dark:hover:text-blue-200 transition-colors">
                API Docs
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
