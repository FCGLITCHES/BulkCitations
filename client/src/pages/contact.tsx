import { motion } from "framer-motion";
import { Mail, Sparkles, MessageSquare, ArrowRight, Check } from "lucide-react";
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
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-bold uppercase tracking-widest mb-6 border border-primary/20"
          >
            <MessageSquare className="h-4 w-4" />
            Support Center
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl sm:text-5xl font-extrabold text-foreground mb-6 tracking-tight"
          >
            Let's <span className="text-primary">Get in Touch</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            Have a feature request, found a bug, or just want to say hi? We're here to help.
          </motion.p>
        </div>

        <div className="grid lg:grid-cols-5 gap-12 items-start">
          {/* Left Column: Info & Details */}
          <div className="lg:col-span-2 space-y-8">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <div 
                className="bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/30 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer group active:scale-[0.98]"
                onClick={copyEmail}
              >
                <div className="p-8 space-y-6">
                  <div className="space-y-4">
                    <div className="w-12 h-12 rounded-xl bg-primary-container/10 dark:bg-blue-400/20 flex items-center justify-center text-primary-container dark:text-blue-400 group-hover:bg-primary-container/20 transition-colors">
                      {copied ? <Check className="h-6 w-6" /> : <Mail className="h-6 w-6" />}
                    </div>
                    <div className="space-y-2">
                       <h4 className="font-bold text-lg text-primary-container dark:text-blue-50">Official Email</h4>
                       <p className="text-on-surface-variant dark:text-slate-400 group-hover:text-primary-container dark:group-hover:text-blue-300 transition-colors">support@bulkreferences.com</p>
                    </div>
                    <p className="text-xs text-on-surface-variant/70 leading-tight">
                       Click to copy email. We aim to respond within 24-48 hours.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="p-8 rounded-3xl bg-surface-container/30 dark:bg-slate-900/50 border border-outline-variant/30"
            >
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
            </motion.div>
          </div>

          {/* Right Column: Component */}
          <div className="lg:col-span-3">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              <ContactForm />
            </motion.div>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
