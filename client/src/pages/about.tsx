import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";
import { ContactForm } from "@/components/contact-form";

export default function About() {
  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface selection:bg-primary-fixed-dim selection:text-on-primary-fixed min-h-screen flex flex-col overflow-x-hidden">
      <LandingNavbar />
      
      <main className="pt-32 pb-24 flex-grow">
        {/* Section 1: The Mission */}
        <section className="max-w-4xl mx-auto px-8 text-center mb-24">
          <h1 className="text-5xl md:text-6xl font-bold text-primary-container dark:text-blue-50 font-headline tracking-tight mb-8 leading-tight">
            Our Mission
          </h1>
          <p className="text-xl md:text-2xl text-on-surface-variant dark:text-slate-400 max-w-3xl mx-auto leading-relaxed font-headline italic">
            BulkReferences simplifies academic citations for researchers and students worldwide by automating the friction of manual formatting into a seamless, high-velocity experience.
          </p>
        </section>

        {/* Section 2: Why I Built This */}
        <section className="max-w-4xl mx-auto px-8 mb-24">
          <div className="bg-primary-container dark:bg-slate-900 text-white rounded-lg p-10 md:p-16 shadow-xl relative overflow-hidden border border-outline-variant/10">
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold font-headline mb-6">Why I Built This</h2>
              <div className="space-y-6 text-lg opacity-90 leading-relaxed">
                <p>
                  As a researcher, I spent more time wrestling with bibliography formatting than actually analyzing data. The tools available were either too bloated, too expensive, or just plain unreliable.
                </p>
                <p>
                  I built BulkReferences as a solo developer to solve my own frustration. My goal was to create a tool that stays out of your way—something lightweight, lightning-fast, and obsessively accurate. This isn't just software to me; it's a commitment to fellow students and academics who deserve a better way to cite.
                </p>
                <div className="pt-4 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-white">person</span>
                  </div>
                  <div>
                    <p className="font-bold font-headline">Solo Developer & Researcher</p>
                    <p className="text-sm opacity-70 italic font-body">Founder of BulkReferences</p>
                  </div>
                </div>
              </div>
            </div>
            {/* Subtle decorative element */}
            <div className="absolute -bottom-10 -right-10 opacity-10">
              <span className="material-symbols-outlined text-[200px]" style={{ fontVariationSettings: "'FILL' 1" }}>history_edu</span>
            </div>
          </div>
        </section>

        {/* Section 3: Core Values */}
        <section className="max-w-5xl mx-auto px-8 mb-24">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Privacy Card */}
            <div className="bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/10 dark:border-slate-800 rounded-lg p-8 shadow-sm">
              <div className="flex items-center gap-3 text-primary-container dark:text-blue-300 mb-4">
                <span className="material-symbols-outlined text-3xl">encrypted</span>
                <h3 className="text-xl font-bold font-headline">Privacy First</h3>
              </div>
              <p className="text-on-surface-variant dark:text-slate-400 leading-relaxed italic">
                Your research stays confidential. We use ephemeral processing that purges all data immediately after citation generation. No permanent databases, no tracking.
              </p>
            </div>
            {/* Accuracy Card */}
            <div className="bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/10 dark:border-slate-800 rounded-lg p-8 shadow-sm">
              <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 mb-4">
                <span className="material-symbols-outlined text-3xl">verified</span>
                <h3 className="text-xl font-bold font-headline text-primary-container dark:text-blue-50">Total Accuracy</h3>
              </div>
              <p className="text-on-surface-variant dark:text-slate-400 leading-relaxed italic">
                Our rigid pattern-matching engine is benchmarked against millions of permutations to ensure 99.8% parsing accuracy for Harvard, APA, and MLA standards.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4: Contact Me */}
        <section className="max-w-6xl mx-auto px-8 mb-24 lg:mb-32">
          <div className="bg-[#002147] text-white rounded-3xl p-10 md:p-16 border border-white/10 shadow-2xl relative overflow-hidden group">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-10">
              <div className="space-y-8">
                <div className="space-y-4">
                  <h2 className="text-4xl md:text-5xl font-bold font-headline tracking-tighter leading-none mb-2">Direct Collaboration</h2>
                  <p className="text-xl md:text-2xl text-blue-100/70 font-headline italic">
                    Feature requests, bug reports, or workflow feedback—your insights directly influence the next build.
                  </p>
                </div>
                
                <div className="space-y-6 text-lg text-slate-300 leading-relaxed font-body border-l-2 border-white/10 pl-8">
                  <p>
                    BulkReferences is maintained by a solo researcher dedicated to technical excellence. I personally review every message to ensure we're building the most robust citation engine in the academy.
                  </p>
                  <p>
                    Reaching our 99.8% accuracy milestone requires continuous feedback. Reach out and I'll get back to you within 24 hours.
                  </p>
                </div>

                <div className="pt-8 flex flex-wrap items-center gap-6">
                  <div className="flex -space-x-3">
                     {[1, 2, 3].map((i) => (
                       <div key={i} className="h-10 w-10 rounded-full border-2 border-[#002147] bg-blue-600 flex items-center justify-center text-xs font-bold ring-2 ring-white/10">
                         {String.fromCharCode(64 + i)}
                       </div>
                     ))}
                  </div>
                  <div className="text-sm">
                    <p className="font-bold font-headline">Join 500+ researchers</p>
                    <p className="opacity-60">Architecting better bibliographies together</p>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute -inset-1 bg-gradient-to-tr from-blue-600/30 to-emerald-500/30 rounded-2xl blur-2xl opacity-50 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="relative">
                   <ContactForm className="bg-white dark:bg-slate-900 border-none shadow-2xl" />
                </div>
              </div>
            </div>

            {/* Decorative background texture */}
            <div className="absolute -bottom-10 -left-10 opacity-[0.05] rotate-12 pointer-events-none select-none">
              <span className="material-symbols-outlined text-[400px]" style={{ fontVariationSettings: "'FILL' 1" }}>mail</span>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
