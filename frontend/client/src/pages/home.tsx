import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";
import CitationConverter from "@/components/citation-converter";

export default function Home() {
  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface dark:text-slate-100 antialiased min-h-screen flex flex-col">
      {/* TopNavBar */}
      <LandingNavbar />

      {/* Main Workspace Canvas */}
      <main className="w-full flex-grow p-4 sm:p-8 bg-surface dark:bg-slate-950 max-w-[1600px] mx-auto">
        <div className="w-full max-w-none mx-auto px-4 sm:px-6 mb-24">
          <header className="mb-10 text-center max-w-3xl mx-auto mt-6 sm:mt-10">
            <h1 className="font-headline text-3xl sm:text-5xl font-bold tracking-tight text-primary-container dark:text-blue-50 leading-none mb-4">Bulk Reference Parser</h1>
            <p className="text-on-surface-variant dark:text-slate-400 text-base sm:text-lg">Convert messy bibliographies into precision-formatted citations. Paste your raw text or drop your source files below.</p>
          </header>

          <div className="pt-2 sm:pt-4 w-full">
            <CitationConverter />
          </div>

        </div>
      </main>

      {/* Footer */}
      <LandingFooter />
    </div>
  );
}
