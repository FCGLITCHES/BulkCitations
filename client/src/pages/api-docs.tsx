import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";

export default function ApiDocs() {
  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface selection:bg-primary-fixed selection:text-on-primary-fixed min-h-screen flex flex-col">
      <LandingNavbar />
      
      <main className="relative flex-grow">
        {/* Hero Section */}
        <section className="pt-24 pb-32 px-8 overflow-hidden">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
            <div className="lg:col-span-7 space-y-8">
              <div className="flex flex-col gap-2">
                <h1 className="font-headline text-5xl md:text-7xl font-bold text-primary-container dark:text-blue-50 leading-tight tracking-tight">
                  Integrate High-Accuracy Citation Conversion into your Platform
                </h1>
                <p className="text-amber-700 dark:text-amber-400 font-bold tracking-widest uppercase text-xs">
                  Coming Soon • Private Beta Q2 2026
                </p>
              </div>
              <p className="text-xl text-on-surface-variant dark:text-slate-400 max-w-2xl leading-relaxed">
                The BulkReferences Business API provides institutional-grade bibliographic processing. Build seamless research workflows with our proprietary accuracy engine.
              </p>
              <div className="flex flex-wrap gap-4 pt-4">
                <a className="px-8 py-4 bg-primary-container dark:bg-primary-container text-white rounded-lg font-bold text-lg shadow-lg hover:bg-[#002f5f] transition-all flex items-center gap-2 group" href="#waitlist">
                  Join Waitlist
                  <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
                </a>
                <a className="px-8 py-4 border border-outline-variant dark:border-slate-800 text-primary-container dark:text-blue-400 rounded-lg font-bold text-lg hover:bg-surface-container dark:hover:bg-slate-800 transition-all" href="#">
                  View Documentation
                </a>
              </div>
            </div>
            {/* API Visual Representation */}
            <div className="lg:col-span-5 relative">
              <div className="bg-primary-container dark:bg-slate-800 p-1 rounded-lg shadow-2xl rotate-1">
                <div className="bg-slate-950 rounded-lg p-6 overflow-hidden font-mono text-sm leading-relaxed text-blue-200">
                  <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-500/50"></div>
                    <span className="ml-2 text-slate-500 text-xs text-left">POST /v1/convert</span>
                  </div>
                  <pre className="overflow-x-auto text-left"><code><span className="text-slate-500">{`{`}</span>
  <span className="text-blue-400">"status"</span>: <span className="text-emerald-400">"success"</span>,
  <span className="text-blue-400">"data"</span>: {`{`}
    <span className="text-blue-400">"citation"</span>: <span className="text-amber-200">"Smith, J. (2024)..."</span>,
    <span className="text-blue-400">"confidence"</span>: <span className="text-emerald-400">0.998</span>,
    <span className="text-blue-400">"metadata"</span>: {`{`}
      <span className="text-blue-400">"doi"</span>: <span className="text-amber-200">"10.1038/s41586-024"</span>
    {`}`}
  {`}`}
<span className="text-slate-500">{`}`}</span></code></pre>
                </div>
              </div>
              <div className="absolute -z-10 -top-12 -right-12 w-64 h-64 bg-primary-fixed dark:bg-blue-900/20 rounded-full blur-3xl opacity-30"></div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 bg-surface-container-low dark:bg-slate-900/50">
          <div className="max-w-7xl mx-auto px-8">
            <div className="mb-16">
              <h2 className="font-headline text-3xl md:text-4xl font-bold text-primary-container dark:text-blue-50 mb-4">Precision Engineering for Institutions</h2>
              <p className="text-on-surface-variant dark:text-slate-400 max-w-xl">Reliable infrastructure built for the scale of modern academic repositories and publishing houses.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="md:col-span-2 lg:col-span-2 bg-surface-container-lowest dark:bg-slate-900 p-8 rounded-lg border border-outline-variant/10 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="material-symbols-outlined text-4xl text-primary-container dark:text-blue-400 mb-6">api</span>
                  <h3 className="text-2xl font-bold text-primary-container dark:text-blue-50 mb-3">RESTful Architecture</h3>
                  <p className="text-on-surface-variant dark:text-slate-400 italic">Standardized endpoints designed for developers. Seamlessly integrate into Python, JS, or Ruby environments with minimal overhead.</p>
                </div>
                 <div className="mt-8 pt-6 border-t border-surface-container dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary-container dark:text-blue-300">JSON Output Optimized</span>
                </div>
              </div>
              <div className="bg-surface-container-lowest dark:bg-slate-900 p-8 rounded-lg border border-outline-variant/10 dark:border-slate-800 shadow-sm">
                <span className="material-symbols-outlined text-4xl text-primary-container dark:text-blue-400 mb-6">speed</span>
                <h3 className="text-xl font-bold text-primary-container dark:text-blue-50 mb-3">High Uptime</h3>
                <p className="text-on-surface-variant dark:text-slate-400 text-sm italic">99.9% SLA guaranteed for Enterprise partners, ensuring your research tools never stop.</p>
              </div>
              <div className="bg-primary-container dark:bg-slate-900 p-8 rounded-lg border border-outline-variant/10 dark:border-slate-800 shadow-lg text-white">
                <span className="material-symbols-outlined text-4xl text-blue-200 mb-6">rocket_launch</span>
                <h3 className="text-xl font-bold mb-3">Bulk Power</h3>
                <p className="text-blue-100 text-sm">Process thousands of references per minute without compromising accuracy or speed.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Waitlist Section */}
        <section className="py-32 px-8" id="waitlist">
          <div className="max-w-4xl mx-auto">
            <div className="bg-surface-container-lowest dark:bg-slate-900 rounded-lg p-12 md:p-16 shadow-2xl relative overflow-hidden border border-outline-variant/10 dark:border-slate-800 text-center">
              <h2 className="font-headline text-4xl md:text-5xl font-bold text-primary-container dark:text-blue-50 mb-6">Institutional Early Access</h2>
              <p className="text-on-surface-variant dark:text-slate-400 text-lg max-w-xl mx-auto mb-10">
                Join the waitlist to receive documentation and developer keys before the public launch. Priority given to academic and research institutions.
              </p>
              <form className="max-w-md mx-auto space-y-4 text-left">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-primary-container dark:text-blue-300 pl-1">Institution</label>
                  <input className="w-full px-4 py-3 bg-surface-container dark:bg-slate-800 rounded-lg border-b-2 border-transparent focus:border-primary-container focus:ring-0 outline-none transition-all dark:text-white" placeholder="Stanford University" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-primary-container dark:text-blue-300 pl-1">Email</label>
                  <input className="w-full px-4 py-3 bg-surface-container dark:bg-slate-800 rounded-lg border-b-2 border-transparent focus:border-primary-container focus:ring-0 outline-none transition-all dark:text-white" placeholder="name@scholar.edu" type="email" />
                </div>
                <button className="w-full py-4 bg-primary-container dark:bg-primary-container text-white font-bold rounded-lg shadow-md hover:bg-[#002f5f] active:scale-[0.98] transition-all">Join Waitlist</button>
              </form>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
