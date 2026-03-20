import { Navbar } from "@/components/navbar";
import { FAQSection } from "@/components/faq-section";
import CitationConverter from "@/components/citation-converter";
import { SiteFooter } from "@/components/site-footer";
import { motion } from "framer-motion";
import { Sparkles, Shield, CheckCircle } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background font-sans">
      <Navbar />

      {/* Main Content */}
      <main className="w-full max-w-[1800px] mx-auto px-3 sm:px-4 py-4 sm:py-6 overflow-x-hidden">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-xl sm:rounded-2xl mb-4 sm:mb-6 bg-primary/5 dark:bg-primary/10 border border-primary/10 dark:border-primary/20 px-4 py-4 sm:px-6 sm:py-6 md:px-6 md:py-8"
        >
          <div className="relative text-center z-10">
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground mb-3 sm:mb-4 tracking-tight leading-tight"
            >
              <span className="text-gradient-brand">Format Citations</span> Instantly
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto font-medium"
            >
              Convert mixed-format references between APA, MLA, Harvard, Chicago, IEEE, and Vancouver.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="mt-3 sm:mt-4 flex items-center justify-center gap-2 flex-wrap text-xs sm:text-sm text-muted-foreground font-medium"
            >
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                <Sparkles className="h-3 w-3" /> Auto-detect
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 text-accent">
                <Shield className="h-3 w-3" /> Secure & Local
              </span>
              <span className="opacity-80 px-2 flex items-center gap-1.5">
                <CheckCircle className="h-3 w-3" /> Editable outputs
              </span>
            </motion.div>
          </div>
        </motion.div>

        {/* Citation Converter */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          id="converter"
        >
          <CitationConverter />
        </motion.div>

        {/* Features Section */}
        <section className="mt-16 sm:mt-24 mb-12 sm:mb-20">
          <motion.h3
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" as any }}
            transition={{ duration: 0.5 }}
            className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-foreground mb-10 sm:mb-14 tracking-tight px-2"
          >
            Why Choose BulkReferences?
          </motion.h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 md:gap-10">
            {[
              {
                title: "98%+ Parsing Accuracy",
                desc: "Powered by thousands of academic test cases to handle edge cases, missing fields, and messy data flawlessly.",
                icon: Sparkles,
                colorClass: "text-primary",
                bgClass: "bg-primary/10 group-hover:bg-primary/20",
                shadowClass: "hover:shadow-primary/10",
                lineClass: "bg-primary/70"
              },
              {
                title: "Paste 450+ at Once",
                desc: "Stop converting references one by one. Paste your entire bibliography and get a clean list back in seconds.",
                icon: CheckCircle,
                colorClass: "text-primary",
                bgClass: "bg-primary/10 group-hover:bg-primary/20",
                shadowClass: "hover:shadow-primary/10",
                lineClass: "bg-primary/70"
              },
              {
                title: "100% Private Processing",
                desc: "Your unpublished research stays entirely yours. We don't save your data to databases or train AI on your citations.",
                icon: Shield,
                colorClass: "text-primary",
                bgClass: "bg-primary/10 group-hover:bg-primary/20",
                shadowClass: "hover:shadow-primary/10",
                lineClass: "bg-primary/70"
              }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" as any }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ y: -5, transition: { duration: 0.2 } }}
                className={`group text-center p-6 sm:p-8 rounded-2xl border border-border bg-card hover:shadow-xl ${feature.shadowClass} transition-all duration-300 relative overflow-hidden`}
              >
                <div className={`absolute top-0 left-0 w-full h-1 ${feature.lineClass} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className={`w-14 h-14 ${feature.bgClass} rounded-xl flex items-center justify-center mx-auto mb-6 transition-colors duration-300`}>
                  <feature.icon className={`text-2xl ${feature.colorClass}`} />
                </div>
                <h4 className="text-xl font-semibold text-foreground mb-3 tracking-tight">{feature.title}</h4>
                <p className="text-muted-foreground text-base leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mb-16 sm:mb-24">
          <div className="container mx-auto px-4 text-center">
            <h3 className="text-xl font-bold text-muted-foreground/60 uppercase tracking-widest text-sm mb-8">Supported Styles</h3>
            <div className="flex flex-wrap justify-center gap-3 sm:gap-6 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
              {['APA 7th', 'MLA 9th', 'Harvard', 'Chicago 17th', 'IEEE', 'Vancouver'].map((style) => (
                <div key={style} className="px-4 py-2 rounded-full border border-border bg-card text-foreground font-semibold text-sm sm:text-base whitespace-nowrap">
                  {style}
                </div>
              ))}
            </div>
          </div>
        </section>

        <FAQSection />

        {/* How accurate is it? */}
        <motion.section
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="rounded-2xl border border-primary/20 bg-primary/5 dark:bg-primary/10 p-6 sm:p-8 md:p-12 mb-10 sm:mb-16 text-center"
        >
          <h3 className="text-2xl sm:text-3xl font-bold text-foreground mb-4 sm:mb-6 tracking-tight">How accurate is it?</h3>
          <div className="max-w-3xl mx-auto space-y-4 text-muted-foreground text-base sm:text-lg">
            <p className="leading-relaxed">
              The converter uses pattern-based parsing and style-specific rules validated against real citations.
              On benchmark sets of mixed-format references, it achieves high accuracy for journal articles, conference papers, and books.
            </p>
            <p className="leading-relaxed text-sm sm:text-base mt-6 text-foreground/80 bg-background/50 p-4 rounded-xl inline-block border border-border/50">
              <strong className="text-foreground font-semibold">Limitations:</strong> Truncated inputs, unusual formats, or non-Latin scripts may reduce accuracy.
              Per-citation warnings and the batch summary help you spot items that need manual review.
            </p>
          </div>
        </motion.section>
      </main>

      <SiteFooter />
    </div>
  );
}
