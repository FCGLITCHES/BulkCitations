import { LandingNavbar } from "@/components/landing-navbar";
import { LandingFooter } from "@/components/landing-footer";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

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
    <div className="bg-surface dark:bg-slate-950 font-body text-on-surface dark:text-slate-100 min-h-screen flex flex-col transition-colors">
      <LandingNavbar />

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
      <LandingFooter />
    </div>
  );
}
