import { Link } from "wouter";
import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";

export default function InstitutionalLogin() {
  return (
    <div className="bg-surface font-body text-on-surface min-h-screen flex flex-col antialiased overflow-x-hidden">
      {/* TopNavBar (Shared Component) */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md shadow-sm border-b border-slate-200/15">
        <div className="flex justify-between items-center px-8 h-20 max-w-full">
          <Link href="/">
            <div className="text-2xl font-bold tracking-tighter text-[#002147] dark:text-blue-50 font-headline cursor-pointer">
              Digital Archivist
            </div>
          </Link>
          <div className="hidden md:flex items-center space-x-10">
            <a className="text-slate-500 dark:text-slate-400 font-medium hover:text-[#002147] dark:hover:text-blue-200 transition-colors font-body" href="#">Research</a>
            <a className="text-slate-500 dark:text-slate-400 font-medium hover:text-[#002147] dark:hover:text-blue-200 transition-colors font-body" href="#">Library</a>
            <a className="text-slate-500 dark:text-slate-400 font-medium hover:text-[#002147] dark:hover:text-blue-200 transition-colors font-body" href="#">Help</a>
          </div>
          <button className="bg-primary-container text-white px-6 py-2.5 rounded-lg font-medium text-sm scale-95 active:opacity-80 transition-transform">
            Institutional Access
          </button>
        </div>
      </nav>
      
      <main className="flex-grow pt-32 pb-20 flex flex-col items-center justify-center px-6 relative">
        {/* Academic Background Texture (Decorative) */}
        <div className="fixed inset-0 pointer-events-none opacity-[0.03] -z-10">
          <div 
            className="absolute inset-0" 
            style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuBGqPKKmAu_ZcWLhJOUmYhJ60SDUI3xSGfgn9Wx47AWD3TiCmZfp03GrJEzrlZgo7-uCwZC7NsP7i_0I9TB3DSm2zFJWUw0fft232Y0b0IQsimCyme-57hmlM35TaJGt7S_Nh3KqyS8uudDOSu_ENWQN3SbzuvfLRSqPhz3GZHOysvbmyHIYWk7d5Rs69-uUJUQ_U6YJMokthv6Mh8E6Wil6Eb-0SAkWYchtMq8gYt41kFeEhp4OiJgVwCCPciN6KssTnr0-cK5sz7w')" }}
          ></div>
        </div>

        <div className="w-full max-w-2xl z-10">
          {/* Header Section */}
          <div className="text-center mb-12">
            <h1 className="font-headline text-4xl md:text-5xl text-primary-container dark:text-blue-50 font-bold tracking-tight mb-4 leading-tight">
              Preserving Knowledge through <br className="hidden md:block" /> Institutional Partnership
            </h1>
            <p className="text-on-surface-variant dark:text-slate-400 text-lg max-w-lg mx-auto font-light leading-relaxed">
              Access the global repository of scholarly assets. Please identify your home institution to proceed.
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-surface-container-lowest dark:bg-slate-900 rounded-lg p-10 md:p-16 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-none border border-outline-variant/10 dark:border-slate-800 relative">
            {/* Section 1: Institutional Selection */}
            <div className="space-y-8">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 mb-4 font-label">
                  Step 1: Locate Your University
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">account_balance</span>
                  <input 
                    className="w-full pl-12 pr-4 py-4 bg-surface-container dark:bg-slate-800 border-0 border-b-2 border-transparent focus:border-primary-container dark:focus:border-blue-400 focus:ring-0 rounded-lg transition-all font-body placeholder:text-outline/60 text-primary-container dark:text-blue-50" 
                    placeholder="Search for your institution (e.g. Oxford, MIT...)" 
                    type="text"
                  />
                </div>
              </div>

              {/* Partner Logos Row */}
              <div className="flex flex-wrap items-center justify-center gap-8 py-4 opacity-70 grayscale hover:grayscale-0 transition-all">
                <img className="h-8 object-contain dark:invert dark:opacity-75" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBbfllXkHc96-lyL_f6SWbMc17SbjvhA-uM3bEJU9FgaCkwH75yfoj6hDZfIxYFsQGjS52-NIS896_MBPLMUBpu04GFwVFspt9yTmwu0s3vYFVgbayz3v_1YdNoIEOmehPiKIgbB81MlKdrVISFKNDmEzkipSB9NPPpToFzLp_FLwbXA9rgp8pzREBbboODafcRuSNHWbzmGOCbxk1uW65x8bP1-AXVSzXTkA54mhAClyF0lo7uPhiINZxXeK4p28hYFS75YPlAdwD6" alt="Oxford" />
                <img className="h-6 object-contain dark:invert dark:opacity-75" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBnUnUwwzvct1MPISTj21f8O6dijr0gFn_4BXZv1wwU7veE6wBLsptuHBinQkmBwX5gH6Psw7Kkl4OiueX9dJoct5QTf55h8a1DuIsibIWY7TjoS-2L5TB6QSQ_MTmprhcMCsm0s_CQgKnbWJR4UZKl6ifJMf_wCYdib_0tZXwLHKs9sNl4zBaaeNYTZQ9kK_hXkHP8RuXOwN7dTmZopCfORye7cwaJULpyU8iz_HYs4e4z1r7zYagbTHZ61RVWepGsz2Jcr1HVeRYK" alt="MIT" />
                <img className="h-8 object-contain dark:invert dark:opacity-75" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAfUhXeKLdX11RmlVDoYqMS5QeUNC9asGdieUX5Ow1TV9Yq7Tc7tObIAD6p2jOwdOYBAhL6hQSbHcBMUFIsEre9pktdMQU2j_JCLluhyWoedsXEZH9UTONUspfOw4-ziOD6t24hpqeEaHrqfNr1GCDr9R6Ou5uJKm52f5HGFuD1406I9GPpspbKnAUZxTcTcAoEzC4xs0T350cMWoG-CwmAkjrgt_1AXwUAc8PUCFS6c86P8Jb_dNdPZp73T0IqeNtvS8sXqunnRNgR" alt="Harvard" />
              </div>

              <button className="w-full py-5 bg-primary-container text-white rounded-lg font-bold text-lg shadow-lg hover:bg-[#002f5f] transition-all flex items-center justify-center gap-3">
                <span>Sign In with Institutional SSO</span>
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>

              <div className="text-center">
                <a className="text-primary-container dark:text-blue-400 font-medium hover:underline text-sm font-label decoration-2 underline-offset-4" href="#">
                  Can't find your institution?
                </a>
              </div>
            </div>

            {/* Divider */}
            <div className="my-12 flex items-center gap-6">
              <div className="h-[1px] flex-1 bg-outline-variant/30"></div>
              <span className="text-outline text-xs font-bold uppercase tracking-widest bg-surface-container-lowest dark:bg-slate-900 px-2 font-label">Or</span>
              <div className="h-[1px] flex-1 bg-outline-variant/30"></div>
            </div>

            {/* Section 2: Email Login */}
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 mb-4 font-label">
                  Login with Institutional Email
                </label>
                <p className="text-xs text-on-surface-variant dark:text-slate-400 mb-4 -mt-2">
                  Use this for manual verification if your institution hasn't enabled Single Sign-On.
                </p>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">alternate_email</span>
                  <input 
                    className="w-full pl-12 pr-4 py-4 bg-surface-container dark:bg-slate-800 border-0 border-b-2 border-transparent focus:border-primary-container dark:focus:border-blue-400 rounded-lg transition-all font-body placeholder:text-outline/60 text-primary-container dark:text-blue-50" 
                    placeholder="name@university.edu" 
                    type="email"
                  />
                </div>
              </div>
              <button className="w-full py-4 bg-secondary-container dark:bg-emerald-900/30 text-on-secondary-container dark:text-emerald-400 rounded-lg font-semibold hover:bg-secondary-fixed dark:hover:bg-emerald-900/50 transition-colors flex items-center justify-center gap-2">
                Verify via Email
              </button>
            </div>

            {/* Tertiary Action */}
            <div className="mt-12 pt-8 border-t border-surface-container dark:border-slate-800 flex flex-col items-center gap-4">
              <p className="text-sm text-on-surface-variant dark:text-slate-500 italic">New to Digital Archivist?</p>
              <button className="text-primary-container dark:text-blue-400 font-bold text-sm tracking-wide uppercase hover:opacity-80 transition-opacity flex items-center gap-2">
                Request Institutional Partnership
                <span className="material-symbols-outlined text-sm">open_in_new</span>
              </button>
            </div>
          </div>
        </div>

        {/* Decorative Corner Visual */}
        <div className="fixed bottom-0 right-0 p-8 opacity-10 pointer-events-none hidden lg:block -z-10">
          <span className="material-symbols-outlined text-9xl text-primary-container dark:text-blue-400" style={{ fontVariationSettings: "'wght' 100" }}>history_edu</span>
        </div>
      </main>

      {/* Footer (Shared Component) */}
      <footer className="bg-[#f8f9fb] dark:bg-slate-900 w-full py-12 border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-6 font-inter text-sm tracking-wide">
          <div className="text-lg font-black text-[#002147] dark:text-blue-50 font-headline">Digital Archivist</div>
          <div className="flex gap-8 text-slate-500 dark:text-slate-400">
            <a className="hover:text-[#002147] dark:hover:text-blue-300 transition-all hover:translate-y-[-1px]" href="#">Privacy Policy</a>
            <a className="hover:text-[#002147] dark:hover:text-blue-300 transition-all hover:translate-y-[-1px]" href="#">Terms of Service</a>
            <a className="hover:text-[#002147] dark:hover:text-blue-300 transition-all hover:translate-y-[-1px]" href="#">University Partners</a>
            <a className="hover:text-[#002147] dark:hover:text-blue-300 transition-all hover:translate-y-[-1px]" href="#">Support</a>
          </div>
          <div className="text-slate-400 dark:text-slate-600 text-xs">
            © {new Date().getFullYear()} Digital Archivist Institutional Suite. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
