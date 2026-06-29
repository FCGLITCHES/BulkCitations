import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";

export default function Resources() {
  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface selection:bg-secondary-container selection:text-on-secondary-container min-h-screen flex flex-col">
      <LandingNavbar />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-12 md:py-16 flex-grow">
        {/* Hero Section */}
        <header className="mb-12 max-w-3xl">
          <h1 className="font-headline text-3xl sm:text-5xl md:text-6xl text-primary-container dark:text-blue-50 leading-[1.1] tracking-tight mb-6">
            Precision in Every Reference. <span className="italic text-outline dark:text-slate-400 font-normal">Expert Insights for Modern Scholars.</span>
          </h1>
        </header>

        {/* Bento Grid Highlights */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-24">
          {/* Featured Comparison Card */}
          <div className="md:col-span-8 bg-surface-container-lowest dark:bg-slate-900 vellum-shadow rounded-lg p-6 sm:p-10 flex flex-col justify-between relative overflow-hidden group border border-outline-variant/10 dark:border-slate-800">
            <div className="relative z-10">
              <div className="flex gap-3 mb-6">
                <span className="px-3 py-1 bg-primary-container/10 dark:bg-blue-900/40 text-primary-container dark:text-blue-300 text-[0.65rem] font-bold uppercase tracking-wider rounded-lg">Comparative Analysis</span>
                <span className="px-3 py-1 bg-surface-container dark:bg-slate-800 text-on-surface-variant dark:text-slate-400 text-[0.65rem] font-medium rounded-lg">12 Min Read</span>
              </div>
              <h2 className="font-headline text-3xl text-primary-container dark:text-blue-50 mb-4 group-hover:translate-x-1 transition-transform duration-300">Beyond Zotero & Mendeley: The Rise of High-Velocity Conversion</h2>
              <p className="text-on-surface-variant dark:text-slate-400 text-md max-w-xl mb-8 leading-relaxed">
                Why the legacy tools of yesterday are creating bottlenecks in today’s rapid publishing cycle. A quantitative study on BulkReferences vs Manual editing.
              </p>
              <a className="inline-flex items-center gap-2 text-primary-container dark:text-blue-400 font-bold group-hover:gap-4 transition-all" href="#">
                <span>Read the full analysis</span>
                <span className="material-symbols-outlined">arrow_forward</span>
              </a>
            </div>
            <div className="absolute right-0 bottom-0 w-1/3 h-full opacity-10 group-hover:opacity-20 transition-opacity">
              <img 
                className="w-full h-full object-cover" 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuB8r09k3MIcd-I8xVeGe82-WObHS8KAzTgV_xp50YriN-UXAAnlUgTBNHCvUa7a9Ao5gM7fWlsz-q9NI3MpBN15qf7s2361fiO3Q3mtYAmXp7SzB5-SlX3kVCublLtoN0ZgIHRXgunXeTxy7JnBdQfj2f-L976rBkGfPeEx4QuHk7s4snjypyystLZG2Lrc6xQVACcNeXROgYo88Ua98cvamINdhNGascrYfYoktpd3hLex4pmySKh8v7GbfkbFd6OYvUpk6TYuw4sI"
                alt="Library books"
              />
            </div>
          </div>

          {/* Side Feature: Reference Health */}
          <div className="md:col-span-4 bg-primary-container dark:bg-slate-900 text-white rounded-lg p-6 sm:p-8 flex flex-col justify-end relative overflow-hidden border border-outline-variant/10">
            <div className="absolute top-8 right-8 opacity-20">
              <span className="material-symbols-outlined text-6xl">clinical_notes</span>
            </div>
            <h3 className="font-headline text-2xl mb-3">Understanding Reference Health</h3>
            <p className="text-on-primary-container dark:text-blue-200 text-sm mb-6 leading-relaxed">
              Learn how our 'Ready, Review, Action' framework eliminates citation errors before they reach the publisher.
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                <span className="text-xs font-medium uppercase tracking-tighter">Ready: Verified Meta</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span className="text-xs font-medium uppercase tracking-tighter">Review: Needs Context</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-red-400"></span>
                <span className="text-xs font-medium uppercase tracking-tighter">Action: Missing Source</span>
              </div>
            </div>
          </div>
        </section>

        {/* Latest Resources List */}
        <section className="mb-24">
          <div className="flex justify-between items-end mb-12">
            <h2 className="font-headline text-3xl sm:text-4xl text-primary-container dark:text-blue-50">Latest Resources</h2>
            <div className="flex gap-4">
              <button className="p-2 border border-outline-variant dark:border-slate-800 rounded-full hover:bg-surface-container dark:hover:bg-slate-800 transition-all">
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button className="p-2 border border-outline-variant dark:border-slate-800 rounded-full hover:bg-surface-container dark:hover:bg-slate-800 transition-all">
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-10">
            {/* Article 1 */}
            <article className="group">
              <div className="aspect-[4/3] rounded-lg overflow-hidden mb-6 bg-surface-container dark:bg-slate-800 relative border border-outline-variant/10">
                <img 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuDrh8zcfx1qC5HK4dBC5HrIGfqCELo8X4Zp9Y_2tkVVpD9BGI2hWsFgbwgWG6_bWGgmZSqhShn6FJlBgONlId_wbrfVU3-XYn-jnu01TAeqlPF3t1xk9GD7Z89rxntlfHRoztb0EoRGz34lm_AaXqfJMYft8IZRGGr6Jbp8pj5SStkhoA_6vpMYZl0z5JUrPlselJo14w3ZB4anwmCYZqVCLH3ggS3QPxgxHtgAMaMoEvHKNq744SuFMzCKW5AgWZ_ne5PmVn1S2loj"
                  alt="Minimalist desk"
                />
                <div className="absolute top-4 left-4">
                  <span className="bg-white/90 dark:bg-slate-900/90 backdrop-blur px-3 py-1 rounded-full text-[0.65rem] font-bold text-primary-container dark:text-blue-300">TECHNICAL</span>
                </div>
              </div>
              <h3 className="font-headline text-xl text-primary-container dark:text-blue-100 mb-3 group-hover:text-blue-800 dark:group-hover:text-blue-300 transition-colors leading-snug">The Speed of Bulk Conversion vs Manual Editing</h3>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm line-clamp-3 mb-6">
                We timed researchers converting 500+ sources. The results were staggering—saving an average of 14 hours per thesis paper.
              </p>
              <a className="text-xs font-bold uppercase tracking-widest text-primary dark:text-blue-400 hover:underline underline-offset-8 transition-all" href="#">Read More</a>
            </article>

            {/* Article 2 */}
            <article className="group">
              <div className="aspect-[4/3] rounded-lg overflow-hidden mb-6 bg-surface-container dark:bg-slate-800 relative border border-outline-variant/10">
                <img 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAL_aix0pEjvKQfP1G8Wc-x6VfA-eTsjnMTk0fK-lPaS22R5hj8g3b1o5fmKXWyJ25TN8VCdcwgALR4QQPhbETsUcx4cU1h989N8EmA2qkog1a3nkjlkppzl_sO5doktLWXthOblF5JyiZNd3gjFWUXfHdfxgKQxHIgiol0WMsgYA465LtYX4_v_VOgGjqw6efnzO8LN-dRXZdbQ5S2h-mIn5uo6rfuWP83uaFp8FZTiZkj3zbpnH2feKNKwm-Wh9vrly6IdR6VizZg"
                  alt="Library staircase"
                />
                <div className="absolute top-4 left-4">
                  <span className="bg-white/90 dark:bg-slate-900/90 backdrop-blur px-3 py-1 rounded-full text-[0.65rem] font-bold text-primary-container dark:text-blue-300">GUIDE</span>
                </div>
              </div>
              <h3 className="font-headline text-xl text-primary-container dark:text-blue-100 mb-3 group-hover:text-blue-800 dark:group-hover:text-blue-300 transition-colors leading-snug">How to Export to BibTeX for your Thesis</h3>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm line-clamp-3 mb-6">
                A step-by-step guide to maintaining perfect LaTeX compatibility while using the Archivist workspace for management.
              </p>
              <a className="text-xs font-bold uppercase tracking-widest text-primary dark:text-blue-400 hover:underline underline-offset-8 transition-all" href="#">Read More</a>
            </article>

            {/* Article 3 */}
            <article className="group">
              <div className="aspect-[4/3] rounded-lg overflow-hidden mb-6 bg-surface-container dark:bg-slate-800 relative border border-outline-variant/10">
                <img 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCeeOn-p8-PjF7LhISR2qbFRIqwhuxk1nLQRsss_P7wtoQyOIP4GjGrt-pJfGKSr0GsbON6N62TkiWu-fXJN6SiWQdTt63N_QCfcTPJnIHijUGpC1m-q5tb2jzB0FPlqkp_DBSc-TAdPfLpJhklh8NIvlw6akA_4uLpggGM-ZjcJ9c9kGOTJ0I7nXajrZUnoIQ-IQE9Djyn2GeraJYY6pNfnEQBNhZuQxDUxn59vjxBiLiRQ70ezZs9JakM5IfOm0M58Qo61JgmmmJp"
                  alt="Fountain pen"
                />
                <div className="absolute top-4 left-4">
                  <span className="bg-white/90 dark:bg-slate-900/90 backdrop-blur px-3 py-1 rounded-full text-[0.65rem] font-bold text-primary-container dark:text-blue-300">OPINION</span>
                </div>
              </div>
              <h3 className="font-headline text-xl text-primary-container dark:text-blue-100 mb-3 group-hover:text-blue-800 dark:group-hover:text-blue-300 transition-colors leading-snug">Why Citation Generators Fail Researchers</h3>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm line-clamp-3 mb-6">
                The hidden cost of "free" generators: Inconsistent metadata and the nightmare of cross-referencing broken URLs.
              </p>
              <a className="text-xs font-bold uppercase tracking-widest text-primary dark:text-blue-400 hover:underline underline-offset-8 transition-all" href="#">Read More</a>
            </article>
          </div>
        </section>

        {/* Newsletter / CTA */}
        <section className="signature-cta rounded-lg p-8 sm:p-12 md:p-20 text-center relative overflow-hidden">
          <div className="relative z-10">
            <h2 className="font-headline text-4xl text-white mb-6">Stay Informed. <span className="italic font-normal opacity-80">Weekly Archival Updates.</span></h2>
            <p className="text-blue-100 max-w-xl mx-auto mb-10 text-lg">
              Join 12,000+ academics receiving curated research tips and software updates directly to their inbox.
            </p>
            <form className="flex flex-col sm:flex-row gap-4 max-w-lg mx-auto">
              <input 
                className="flex-grow bg-white/10 border-white/20 text-white placeholder:text-white/40 rounded-lg px-6 py-4 focus:ring-2 focus:ring-white/30 outline-none" 
                placeholder="academic@university.edu" 
                type="email"
              />
              <button className="bg-white text-primary-container font-bold px-8 py-4 rounded-lg hover:bg-blue-50 transition-colors shadow-xl">Subscribe</button>
            </form>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
