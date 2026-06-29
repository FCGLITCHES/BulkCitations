import { Mail, Sparkles, MessageSquare, ArrowRight } from "lucide-react";
import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";
import { ContactForm } from "@/components/contact-form";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function Contact() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copyEmail = () => {
    navigator.clipboard.writeText("support@bulkreferences.com");
    setCopied(true);
    toast({
      title: "Email Copied",
      description: "Support email has been copied to your clipboard.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-surface dark:bg-slate-950 font-body text-on-surface antialiased flex flex-col transition-colors">
      <LandingNavbar />

      <main className="container mx-auto px-4 py-16 sm:py-24 max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-foreground mb-6 tracking-tight">
            Let's <span className="text-primary">Get in Touch</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Got feedback, a bug to report, or an idea for how we could work together? We'd love to hear from you.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-12 items-start">
          {/* Left Column: Info & Details */}
          <div className="lg:col-span-2 space-y-8">
            <div>
              <div 
                className="bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/30 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer group active:scale-[0.98]"
                onClick={copyEmail}
              >
                <div className="px-8 pt-8 pb-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container/10 text-primary-container transition-colors group-hover:bg-primary-container/20 dark:bg-blue-400/20 dark:text-blue-400">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div className="space-y-0">
                      <h4 className="text-lg font-bold leading-none text-primary-container dark:text-blue-50">Email us</h4>
                      <p className="pt-1 text-on-surface-variant transition-colors group-hover:text-primary-container dark:text-slate-400 dark:group-hover:text-blue-300">
                        {copied ? "Copied to clipboard" : "support@bulkreferences.com"}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant/70 leading-tight">
                    Click to copy email. We aim to respond within 24-48 hours.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-8 rounded-3xl bg-surface-container/30 dark:bg-slate-900/50 border border-outline-variant/30">
              <h4 className="font-extrabold flex items-center gap-2 mb-4 text-primary-container dark:text-blue-50 text-xl">
                <Sparkles className="h-5 w-5 text-primary-container dark:text-blue-400" />
                Beta Feedback
              </h4>
              <p className="text-on-surface-variant dark:text-slate-400 leading-relaxed mb-6">
                BulkReferences is currently in Beta. Your feedback is extremely valuable to us. 
                Whether it's a small suggestion or a major bug report, every message helps 
                improve the tool for the academic community.
              </p>
              <div className="flex items-center gap-1.5 text-primary-container dark:text-blue-400 font-bold text-sm tracking-tight group cursor-default">
                 Handcrafted by a solo developer
                 <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

          {/* Right Column: Component */}
          <div className="lg:col-span-3">
            <div>
              <ContactForm />
            </div>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
