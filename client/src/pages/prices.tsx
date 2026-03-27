import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";

export default function Prices() {
  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface selection:bg-primary-fixed selection:text-on-primary-fixed min-h-screen flex flex-col">
      <LandingNavbar />
      
      <main className="max-w-7xl mx-auto px-6 py-16 md:py-24 flex-grow">
        {/* Hero Section */}
        <header className="text-center mb-20 max-w-3xl mx-auto">
          <h1 className="font-headline text-5xl md:text-6xl font-bold tracking-tight text-primary-container dark:text-blue-50 mb-6 leading-tight">
            Precision for every <span className="italic font-normal">reference.</span>
          </h1>
          <p className="text-on-surface-variant dark:text-slate-400 text-lg leading-relaxed">
            Choose the plan that fits your research velocity. From undergraduate essays to institutional archives, we provide the infrastructure for academic integrity.
          </p>
        </header>

        {/* Pricing Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-32">
          {/* Free Tier */}
          <div className="bg-surface-container-lowest dark:bg-slate-900 rounded-lg p-8 flex flex-col justify-between transition-all hover:translate-y-[-4px] border border-outline-variant/10 dark:border-slate-800">
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-surface-container dark:bg-slate-800 text-primary-container dark:text-blue-300 text-xs font-bold tracking-widest uppercase mb-6">Student</span>
              <h3 className="font-headline text-3xl font-bold text-primary dark:text-blue-50 mb-2">Free</h3>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm mb-8 italic">Ideal for occasional papers and personal bibliographies.</p>
              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-secondary-fixed-dim text-lg">check_circle</span>
                  <span className="dark:text-slate-300">Up to 50 citations per month</span>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-secondary-fixed-dim text-lg">check_circle</span>
                  <span className="dark:text-slate-300">Basic citation styles (APA, MLA, CMS)</span>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-secondary-fixed-dim text-lg">check_circle</span>
                  <span className="dark:text-slate-300">Single workspace</span>
                </li>
              </ul>
            </div>
            <button className="w-full py-4 text-sm font-bold tracking-wide uppercase border-2 border-primary-container dark:border-blue-600 text-primary-container dark:text-blue-400 rounded-lg hover:bg-primary-container hover:text-white dark:hover:bg-blue-600 dark:hover:text-white transition-all duration-300">
              Choose Plan
            </button>
          </div>

          {/* Pro Tier */}
          <div className="bg-primary-container rounded-lg p-8 flex flex-col justify-between text-white relative shadow-2xl transition-all hover:translate-y-[-4px]">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-secondary-container dark:bg-emerald-600 text-on-secondary-container dark:text-white px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase">Most Popular</div>
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-white/10 text-white text-xs font-bold tracking-widest uppercase mb-6">Researcher</span>
              <h3 className="font-headline text-3xl font-bold mb-2">$12 <span className="text-lg font-normal opacity-70">/mo</span></h3>
              <p className="text-white/70 text-sm mb-8">Or $99/year (Save 30%). For serious academic production.</p>
              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <span>Unlimited citations</span>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <span>10,000+ citation styles</span>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <span>Priority customer support</span>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <span>Advanced export (BibTeX, RIS, PDF)</span>
                </li>
              </ul>
            </div>
            <button className="w-full py-4 text-sm font-bold tracking-wide uppercase bg-white text-primary-container rounded-lg hover:bg-secondary-fixed transition-all duration-300">
              Choose Plan
            </button>
          </div>

          {/* Institutional Tier */}
          <div className="bg-surface-container-lowest dark:bg-slate-900 rounded-lg p-8 flex flex-col justify-between transition-all hover:translate-y-[-4px] border border-outline-variant/10 dark:border-slate-800">
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-surface-container dark:bg-slate-800 text-primary-container dark:text-blue-300 text-xs font-bold tracking-widest uppercase mb-6">University</span>
              <h3 className="font-headline text-3xl font-bold text-primary dark:text-blue-50 mb-2">Custom</h3>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm mb-8 italic">Collaborative tools for departments and libraries.</p>
              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-secondary-fixed-dim text-lg">check_circle</span>
                  <span className="dark:text-slate-300">Shared workflows & team libraries</span>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-secondary-fixed-dim text-lg">check_circle</span>
                  <span className="dark:text-slate-300">Full API access for integrations</span>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <span className="material-symbols-outlined text-secondary-fixed-dim text-lg">check_circle</span>
                  <span className="dark:text-slate-300">SSO & Enterprise security</span>
                </li>
              </ul>
            </div>
            <button className="w-full py-4 text-sm font-bold tracking-wide uppercase border-2 border-primary-container dark:border-blue-600 text-primary-container dark:text-blue-400 rounded-lg hover:bg-primary-container hover:text-white dark:hover:bg-blue-600 dark:hover:text-white transition-all duration-300">
              Contact Sales
            </button>
          </div>
        </div>

        {/* Comparison Table */}
        <section className="mb-32">
          <h2 className="font-headline text-3xl font-bold text-primary-container dark:text-blue-50 mb-12 text-center">Feature Breakdown</h2>
          <div className="overflow-hidden bg-surface-container-lowest dark:bg-slate-900 rounded-lg shadow-sm border border-outline-variant/10 dark:border-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container dark:bg-slate-800 text-on-surface dark:text-slate-100 font-bold text-sm tracking-widest uppercase">
                    <th className="p-6">Feature</th>
                    <th className="p-6 text-center">Free</th>
                    <th className="p-6 text-center">Pro</th>
                    <th className="p-6 text-center">Institutional</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container dark:divide-slate-800 text-on-surface-variant dark:text-slate-400 text-sm">
                  <tr>
                    <td className="p-6 font-medium text-primary dark:text-blue-50">Monthly Citations</td>
                    <td className="p-6 text-center">50</td>
                    <td className="p-6 text-center">Unlimited</td>
                    <td className="p-6 text-center">Unlimited</td>
                   </tr>
                  <tr>
                    <td className="p-6 font-medium text-primary dark:text-blue-50">Style Library</td>
                    <td className="p-6 text-center">Standard</td>
                    <td className="p-6 text-center">Full (10k+)</td>
                    <td className="p-6 text-center">Custom Styles</td>
                  </tr>
                  <tr>
                    <td className="p-6 font-medium text-primary dark:text-blue-50">Browser Extension</td>
                    <td className="p-6 text-center"><span className="material-symbols-outlined text-secondary-fixed-dim">check</span></td>
                    <td className="p-6 text-center"><span className="material-symbols-outlined text-secondary-fixed-dim">check</span></td>
                    <td className="p-6 text-center"><span className="material-symbols-outlined text-secondary-fixed-dim">check</span></td>
                  </tr>
                  <tr>
                    <td className="p-6 font-medium text-primary dark:text-blue-50">Bulk Upload</td>
                    <td className="p-6 text-center">—</td>
                    <td className="p-6 text-center"><span className="material-symbols-outlined text-secondary-fixed-dim">check</span></td>
                    <td className="p-6 text-center"><span className="material-symbols-outlined text-secondary-fixed-dim">check</span></td>
                  </tr>
                  <tr>
                    <td className="p-6 font-medium text-primary dark:text-blue-50">Team Collaboration</td>
                    <td className="p-6 text-center">—</td>
                    <td className="p-6 text-center">—</td>
                    <td className="p-6 text-center"><span className="material-symbols-outlined text-secondary-fixed-dim">check</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Testimonial */}
        <section className="grid md:grid-cols-2 gap-12 items-center mb-32 bg-primary-container dark:bg-slate-900 rounded-lg overflow-hidden p-12 text-white border border-outline-variant/10">
          <div className="relative aspect-square md:aspect-video rounded-lg overflow-hidden grayscale">
            <img 
              alt="Researcher working" 
              className="object-cover w-full h-full opacity-60" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuB-o7OQjqu-8dw7Kh7emh3TnnUfuRmCsoE2VZl-qwKHKlVkCxu87o2kDtkGMYydty_yvjVj7n8AmMDv4hEfQexCKTlaeOYqK1YwEkC5Kj2HCKshkYfz99vqPfo3Oj8V-46HwrtJziIVGk-lmCxiNNdYoBsULekNRbh6cUUHfniKybEEpzfCMvM36r4KpFvuMYlNWmoWmZMdfkV1318f-4_w3lcrs0A2mB4sLN6TsC-e4r8UeuAq15fslgqEFJ9Xh29BpNO2bRnM1xXn"
            />
          </div>
          <div>
            <span className="material-symbols-outlined text-5xl text-blue-200 mb-6" style={{ fontVariationSettings: "'FILL' 1" }}>format_quote</span>
            <p className="font-headline text-2xl italic leading-relaxed mb-8">
              "Digital Archivist changed how I handle my dissertation. I used to spend hours fixing formatting, but now it's done in seconds. The Pro plan paid for itself in time saved within the first week."
            </p>
            <div>
              <h4 className="font-bold text-lg">Dr. Elena Rostova</h4>
              <p className="text-white/60 text-sm">Postdoctoral Fellow, Heritage Studies</p>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="max-w-4xl mx-auto mb-32">
          <h2 className="font-headline text-3xl font-bold text-primary-container dark:text-blue-50 mb-12 text-center">Frequently Asked Questions</h2>
          <div className="space-y-4">
            <div className="bg-surface-container-low dark:bg-slate-900/50 p-6 rounded-lg border border-outline-variant/5">
              <h4 className="font-bold text-primary dark:text-blue-50 mb-2 flex justify-between items-center">
                Can I change my plan later?
                <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
              </h4>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm">Yes, you can upgrade or downgrade your plan at any time. Changes will be reflected in your next billing cycle.</p>
            </div>
            <div className="bg-surface-container-low dark:bg-slate-900/50 p-6 rounded-lg border border-outline-variant/5">
              <h4 className="font-bold text-primary dark:text-blue-50 mb-2 flex justify-between items-center">
                Do you offer refunds?
                <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
              </h4>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm">We offer a full 14-day money-back guarantee if you are not satisfied with our Pro or Institutional features.</p>
            </div>
            <div className="bg-surface-container-low dark:bg-slate-900/50 p-6 rounded-lg border border-outline-variant/5">
              <h4 className="font-bold text-primary dark:text-blue-50 mb-2 flex justify-between items-center">
                How often are citation styles updated?
                <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
              </h4>
              <p className="text-on-surface-variant dark:text-slate-400 text-sm">Our database is updated weekly to ensure compliance with the latest manual editions of APA, MLA, Chicago, and thousands of niche journals.</p>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
