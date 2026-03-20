import { Card, CardContent } from "@/components/ui/card";
import { Quote, User, Rocket, Shield, Heart } from "lucide-react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { SiteFooter } from "@/components/site-footer";

export default function About() {
  return (
    <div className="min-h-screen bg-background font-sans flex flex-col">
      <Navbar />

      <main className="container mx-auto px-4 py-16 sm:py-24 max-w-4xl overflow-x-hidden">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl sm:text-5xl font-extrabold text-foreground mb-6 tracking-tight">
            About <span className="text-primary">BulkReferences</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Simplifying academic citations for researchers, students, and writers worldwide.
          </p>
        </motion.div>

        <div className="grid gap-12 sm:gap-16">
          {/* Mission Section */}
          <section className="grid md:grid-cols-2 gap-8 items-center">
            <div className="space-y-6">
              <h3 className="text-2xl font-bold flex items-center gap-3">
                <Rocket className="w-6 h-6 text-primary" />
                Our Mission
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                BulkReferences was born out of a simple frustration: academic citation is tedious. 
                Whether you're juggling a thesis or a quick paper, formatting dozens of references 
                manually is a waste of your most valuable asset—time.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                We provide a robust, pattern-based engine that instantly detects and converts mixed-format 
                references into clean, standardized outputs.
              </p>
            </div>
            <Card className="border-primary/10 bg-primary/5">
              <CardContent className="p-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">1</div>
                     <span className="font-semibold">Auto-detect input styles</span>
                  </div>
                  <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">2</div>
                     <span className="font-semibold">Batch process 450+ items</span>
                  </div>
                  <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">3</div>
                     <span className="font-semibold">Export to BibTeX & RIS</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Philosophy Section */}
          <section className="bg-muted/30 rounded-3xl p-8 sm:p-12 border border-border/50">
            <div className="max-w-3xl mx-auto text-center space-y-8">
              <Heart className="w-12 h-12 text-accent mx-auto" />
              <h3 className="text-3xl font-bold tracking-tight">Handcrafted with Care</h3>
              <p className="text-muted-foreground text-lg italic">
                "BulkReferences is a solo project, designed and developed by a single engineer who believes 
                that great tools should be fast, private, and beautiful. Every line of code, every parsing 
                rule, and every pixel is crafted to make your research workflow just a little bit easier."
              </p>
              <div className="flex items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-brand flex items-center justify-center text-white font-bold text-xl shadow-lg">
                  <User className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <p className="font-bold text-foreground">Solo Developer</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Creator of BulkReferences</p>
                </div>
              </div>
            </div>
          </section>

          {/* Core Values */}
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-6 space-y-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Shield className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-xl">Privacy First</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your references are your intellectual property. We process everything in-memory 
                  and never store your citations in our database. We respect your research privacy.
                </p>
              </CardContent>
            </Card>
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-6 space-y-4">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                  <Quote className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-xl">Accuracy Focused</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We use pattern-based parsing validated against thousands of real-world citation benchmarks 
                  to ensure your bibliography is as accurate as possible.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
