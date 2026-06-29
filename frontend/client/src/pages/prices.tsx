import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";

const PLANS = [
  {
    name: "Free",
    label: "Student",
    description: "Ideal for occasional papers and personal bibliographies.",
    priceNote: null,
    featured: false,
    buttonLabel: "Choose Plan",
    features: [
      "Up to 50 citations per month",
      "Basic citation styles (APA, MLA, CMS)",
      "Single workspace",
    ],
  },
  {
    name: "$12",
    label: "Researcher",
    description: "Or $99/year (Save 30%). For serious academic production.",
    priceNote: "/mo",
    featured: true,
    buttonLabel: "Choose Plan",
    features: [
      "Unlimited citations",
      "10,000+ citation styles",
      "Priority customer support",
      "Advanced export (BibTeX, RIS, PDF)",
    ],
  },
  {
    name: "Custom",
    label: "University",
    description: "Collaborative tools for departments and libraries.",
    priceNote: null,
    featured: false,
    buttonLabel: "Contact Sales",
    features: [
      "Shared workflows & team libraries",
      "Full API access for integrations",
      "SSO & Enterprise security",
    ],
  },
];

const COMPARISON_ROWS = [
  {
    feature: "Monthly Citations",
    free: "50",
    pro: "Unlimited",
    institutional: "Unlimited",
  },
  {
    feature: "Style Library",
    free: "Standard",
    pro: "Full (10k+)",
    institutional: "Custom Styles",
  },
  {
    feature: "Browser Extension",
    free: "check",
    pro: "check",
    institutional: "check",
  },
  {
    feature: "Bulk Upload",
    free: "-",
    pro: "check",
    institutional: "check",
  },
  {
    feature: "Team Collaboration",
    free: "-",
    pro: "-",
    institutional: "check",
  },
];

function ComparisonValue({ value }: { value: string }) {
  if (value === "check") {
    return <span className="material-symbols-outlined text-secondary-fixed-dim">check</span>;
  }

  return <span>{value === "-" ? "—" : value}</span>;
}

export default function Prices() {
  return (
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface selection:bg-primary-fixed selection:text-on-primary-fixed min-h-screen flex flex-col">
      <LandingNavbar />

      <main className="mx-auto flex w-full max-w-7xl flex-grow flex-col px-4 py-12 sm:px-6 sm:py-14 md:py-20 lg:px-8 lg:py-24">
        <header className="mx-auto mb-14 max-w-3xl text-center sm:mb-16 md:mb-20">
          <h1 className="mb-5 font-headline text-4xl font-bold leading-tight tracking-tight text-primary-container dark:text-blue-50 sm:text-5xl md:mb-6 md:text-6xl">
            Precision for every <span className="italic font-normal">reference.</span>
          </h1>
          <p className="text-base leading-relaxed text-on-surface-variant dark:text-slate-400 sm:text-lg">
            Choose the plan that fits your research velocity. From undergraduate essays to institutional archives, we provide the infrastructure for academic integrity.
          </p>
        </header>

        <section className="mb-20 grid grid-cols-1 gap-5 sm:gap-6 md:mb-24 md:grid-cols-3 lg:gap-8">
          {PLANS.map((plan) => (
            <div
              key={plan.label}
              className={
                plan.featured
                  ? "relative flex flex-col justify-between rounded-2xl bg-primary-container p-6 text-white shadow-2xl transition-all hover:translate-y-[-4px] sm:p-8"
                  : "flex flex-col justify-between rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 transition-all hover:translate-y-[-4px] dark:border-slate-800 dark:bg-slate-900 sm:p-8"
              }
            >
              {plan.featured ? (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary-container px-4 py-1 text-xs font-bold uppercase tracking-widest text-on-secondary-container dark:bg-emerald-600 dark:text-white">
                  Most Popular
                </div>
              ) : null}
              <div>
                <span
                  className={
                    plan.featured
                      ? "mb-6 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-white"
                      : "mb-6 inline-block rounded-full bg-surface-container px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary-container dark:bg-slate-800 dark:text-blue-300"
                  }
                >
                  {plan.label}
                </span>
                <h3 className={`mb-2 font-headline text-3xl font-bold ${plan.featured ? "" : "text-primary dark:text-blue-50"}`}>
                  {plan.name}
                  {plan.priceNote ? <span className="text-lg font-normal opacity-70"> {plan.priceNote}</span> : null}
                </h3>
                <p
                  className={`mb-8 text-sm ${plan.featured ? "text-white/70" : "italic text-on-surface-variant dark:text-slate-400"}`}
                >
                  {plan.description}
                </p>
                <ul className="mb-8 space-y-4">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      <span
                        className={`material-symbols-outlined text-lg ${plan.featured ? "material-symbols-filled text-white" : "text-secondary-fixed-dim"}`}
                      >
                        check_circle
                      </span>
                      <span className={plan.featured ? "" : "dark:text-slate-300"}>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                className={
                  plan.featured
                    ? "w-full rounded-lg bg-white py-4 text-sm font-bold uppercase tracking-wide text-primary-container transition-all duration-300 hover:bg-secondary-fixed"
                    : "w-full rounded-lg border-2 border-primary-container py-4 text-sm font-bold uppercase tracking-wide text-primary-container transition-all duration-300 hover:bg-primary-container hover:text-white dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-600 dark:hover:text-white"
                }
              >
                {plan.buttonLabel}
              </button>
            </div>
          ))}
        </section>

        <section className="mb-20 md:mb-24">
          <h2 className="mb-8 text-center font-headline text-3xl font-bold text-primary-container dark:text-blue-50 md:mb-12">
            Feature Breakdown
          </h2>

          <div className="space-y-4 md:hidden">
            {COMPARISON_ROWS.map((row) => (
              <div
                key={row.feature}
                className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="mb-4 font-headline text-lg font-bold text-primary dark:text-blue-50">{row.feature}</h3>
                <div className="space-y-3 text-sm text-on-surface-variant dark:text-slate-300">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Free</span>
                    <ComparisonValue value={row.free} />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Pro</span>
                    <ComparisonValue value={row.pro} />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Institutional</span>
                    <ComparisonValue value={row.institutional} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-lowest shadow-sm dark:border-slate-800 dark:bg-slate-900 md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container text-sm font-bold uppercase tracking-widest text-on-surface dark:bg-slate-800 dark:text-slate-100">
                    <th className="p-6">Feature</th>
                    <th className="p-6 text-center">Free</th>
                    <th className="p-6 text-center">Pro</th>
                    <th className="p-6 text-center">Institutional</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container text-sm text-on-surface-variant dark:divide-slate-800 dark:text-slate-400">
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.feature}>
                      <td className="p-6 font-medium text-primary dark:text-blue-50">{row.feature}</td>
                      <td className="p-6 text-center">
                        <ComparisonValue value={row.free} />
                      </td>
                      <td className="p-6 text-center">
                        <ComparisonValue value={row.pro} />
                      </td>
                      <td className="p-6 text-center">
                        <ComparisonValue value={row.institutional} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mb-20 grid items-center gap-8 overflow-hidden rounded-2xl border border-outline-variant/10 bg-primary-container p-5 text-white dark:bg-slate-900 sm:p-8 md:mb-24 md:grid-cols-2 md:gap-12 md:p-12">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl grayscale md:aspect-video">
            <img
              alt="Researcher working"
              className="h-full w-full object-cover opacity-60"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuB-o7OQjqu-8dw7Kh7emh3TnnUfuRmCsoE2VZl-qwKHKlVkCxu87o2kDtkGMYydty_yvjVj7n8AmMDv4hEfQexCKTlaeOYqK1YwEkC5Kj2HCKshkYfz99vqPfo3Oj8V-46HwrtJziIVGk-lmCxiNNdYoBsULekNRbh6cUUHfniKybEEpzfCMvM36r4KpFvuMYlNWmoWmZMdfkV1318f-4_w3lcrs0A2mB4sLN6TsC-e4r8UeuAq15fslgqEFJ9Xh29BpNO2bRnM1xXn"
            />
          </div>
          <div>
            <span
              className="material-symbols-outlined material-symbols-filled mb-5 block text-4xl text-blue-200 sm:text-5xl"
            >
              format_quote
            </span>
            <p className="mb-6 font-headline text-xl italic leading-relaxed sm:text-2xl sm:leading-relaxed">
              "Digital Archivist changed how I handle my dissertation. I used to spend hours fixing formatting, but now it's done in seconds. The Pro plan paid for itself in time saved within the first week."
            </p>
            <div>
              <h4 className="text-lg font-bold">Dr. Elena Rostova</h4>
              <p className="text-sm text-white/60">Postdoctoral Fellow, Heritage Studies</p>
            </div>
          </div>
        </section>

        <section className="mx-auto mb-20 w-full max-w-4xl md:mb-24">
          <h2 className="mb-8 text-center font-headline text-3xl font-bold text-primary-container dark:text-blue-50 md:mb-12">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            <div className="rounded-lg border border-outline-variant/5 bg-surface-container-low p-5 dark:bg-slate-900/50 sm:p-6">
              <h4 className="mb-2 flex items-center justify-between gap-4 font-bold text-primary dark:text-blue-50">
                <span>Can I change my plan later?</span>
                <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
              </h4>
              <p className="text-sm text-on-surface-variant dark:text-slate-400">
                Yes, you can upgrade or downgrade your plan at any time. Changes will be reflected in your next billing cycle.
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant/5 bg-surface-container-low p-5 dark:bg-slate-900/50 sm:p-6">
              <h4 className="mb-2 flex items-center justify-between gap-4 font-bold text-primary dark:text-blue-50">
                <span>Do you offer refunds?</span>
                <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
              </h4>
              <p className="text-sm text-on-surface-variant dark:text-slate-400">
                We offer a full 14-day money-back guarantee if you are not satisfied with our Pro or Institutional features.
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant/5 bg-surface-container-low p-5 dark:bg-slate-900/50 sm:p-6">
              <h4 className="mb-2 flex items-center justify-between gap-4 font-bold text-primary dark:text-blue-50">
                <span>How often are citation styles updated?</span>
                <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
              </h4>
              <p className="text-sm text-on-surface-variant dark:text-slate-400">
                Our database is updated weekly to ensure compliance with the latest manual editions of APA, MLA, Chicago, and thousands of niche journals.
              </p>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
