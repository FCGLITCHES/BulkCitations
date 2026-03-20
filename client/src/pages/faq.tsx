import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Quote } from "lucide-react";
import { Link } from "wouter";
import { SiteFooter } from "@/components/site-footer";

export default function FAQ() {
  const faqs = [
    {
      q: "What citation styles are supported?",
      a: "APA (7th), MLA (9th), Harvard, Chicago (17th), IEEE, and Vancouver. You can paste mixed-format references and convert them to any of these styles.",
    },
    {
      q: "How does auto-detection work?",
      a: "The converter analyzes patterns in your references (author format, year placement, punctuation) to guess the input style. If detection is uncertain, you'll see a warning and the output will be a best-guess stub.",
    },
    {
      q: "What if a reference fails or looks wrong?",
      a: "Per-citation warnings and the batch summary bar highlight items that may need manual review. Use the Report button to flag issues. We recommend reviewing flagged items before submission.",
    },
    {
      q: "Are my references stored?",
      a: "References are processed in memory and not permanently stored. See our Privacy page for details.",
    },
    {
      q: "Can I export to reference managers?",
      a: "Yes. Export as BibTeX or RIS to import into Zotero, Mendeley, EndNote, or similar tools.",
    },
    {
      q: "What formats can I paste?",
      a: "Paste references separated by blank lines or numbered (1., 2., 3.). The converter handles APA, MLA, Vancouver, IEEE, Chicago, and Harvard input formats.",
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-background/90 backdrop-blur-lg shadow-sm border-b border-border overflow-x-hidden sticky top-0 z-50 transition-colors duration-300">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center space-x-3 mb-8">
              <Link href="/">
                <div className="w-10 h-10 bg-gradient-brand rounded-xl flex items-center justify-center shadow-md hover:scale-105 transition-transform cursor-pointer">
                  <Quote className="text-white text-lg" />
                </div>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-foreground">BulkReferences</h1>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Frequently Asked Questions</p>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-2 sm:gap-4 shrink-0">
              <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">Home</Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-primary transition-colors">Privacy</Link>
              <Link href="/about" className="text-muted-foreground hover:text-primary transition-colors">About</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-8 sm:py-12 max-w-2xl overflow-x-hidden">
        <h2 className="text-2xl font-bold text-foreground mb-6">Frequently Asked Questions</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <h3 className="font-semibold text-foreground">{faq.q}</h3>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-muted-foreground">{faq.a}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
