import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";
import { ContactForm } from "@/components/contact-form";

export default function About() {
  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface selection:bg-primary-fixed-dim selection:text-on-primary-fixed min-h-screen flex flex-col overflow-x-hidden">
      <LandingNavbar />
      
      <main className="pt-32 pb-24 flex-grow">
        {/* Section 1: The Mission */}
        <section className="max-w-4xl mx-auto px-8 text-center mb-16">
          <h1 className="text-3xl md:text-4xl font-bold text-primary-container dark:text-blue-50 font-headline tracking-tight mb-4 leading-tight">
            Our Mission
          </h1>
        </section>

        {/* Section 2: Why I Built This */}
        <section className="max-w-4xl mx-auto px-8 mb-16">
          <div className="bg-primary-container dark:bg-slate-900 text-white rounded-lg p-8 md:p-12 shadow-xl relative overflow-hidden border border-outline-variant/10">
            <div className="relative z-10">
              <h2 className="text-2xl md:text-3xl font-bold font-headline mb-4">Why I Built This</h2>
              <div className="space-y-4 text-base opacity-90 leading-relaxed font-body">
                <p>
                  As a researcher, I spent more time wrestling with bibliography formatting than actually analyzing data. The tools available were either too bloated, too expensive, or just plain unreliable.
                </p>
                <p>
                  I built BulkReferences as a solo developer to solve my own frustration. My goal was to create a tool that stays out of your way—something lightweight, lightning-fast, and obsessively accurate.
                </p>
                <div className="pt-4 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-sm">person</span>
                  </div>
                  <div>
                    <p className="font-bold font-headline text-sm">Solo Developer & Researcher</p>
                    <p className="text-xs opacity-70 italic font-body">Founder of BulkReferences</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Core Values */}
        <section className="max-w-5xl mx-auto px-8 mb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/10 rounded-lg p-6 shadow-sm">
              <div className="flex items-center gap-3 text-primary-container dark:text-blue-300 mb-2">
                <span className="material-symbols-outlined text-2xl">encrypted</span>
                <h3 className="text-lg font-bold font-headline">Privacy First</h3>
              </div>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm leading-relaxed italic">
                Your research stays confidential. We use ephemeral processing that purges all data immediately after citation generation.
              </p>
            </div>
            <div className="bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/10 rounded-lg p-6 shadow-sm">
              <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 mb-2">
                <span className="material-symbols-outlined text-2xl">verified</span>
                <h3 className="text-lg font-bold font-headline text-primary-container dark:text-blue-50">Total Accuracy</h3>
              </div>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm leading-relaxed italic">
                Our rigid pattern-matching engine ensures 99.8% parsing accuracy for Harvard, APA, and MLA standards.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4: Contact Us */}
        <section className="max-w-4xl mx-auto px-8 mb-16 lg:mb-24">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold font-headline text-primary-container dark:text-blue-50 mb-2">Get in Touch</h2>
            <p className="text-on-surface-variant dark:text-slate-400 text-sm max-w-xl mx-auto">
              Have a feature request, bug report, or workflow feedback? I'd love to hear from you.
            </p>
          </div>
          
          <div className="bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/20 rounded-3xl p-8 md:p-12 shadow-xl hover:shadow-2xl transition-all duration-500">
            <ContactForm />
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
