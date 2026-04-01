import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

export function FAQSection() {
  const faqs = [
    {
      q: "What citation styles are supported?",
      a: "APA (7th), MLA (9th), Harvard, Chicago (17th), IEEE, and Vancouver. You can paste mixed-format references and convert them to any of these styles.",
    },
    {
      q: "How does auto-detection work?",
      a: "The converter analyzes patterns in your references (author format, year placement, punctuation) to guess the input style. If detection is uncertain, you'll see a warning.",
    },
    {
      q: "What if a reference fails or looks wrong?",
      a: "Per-citation warnings and the batch summary bar highlight items that may need review. Use the Report button to flag issues.",
    },
    {
      q: "Are my references stored?",
      a: "Raw references are processed in memory and are not permanently stored. We may collect anonymous usage analytics such as page views, country, and converter attempts so we can improve reliability and speed.",
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
    <section id="faq" className="py-16 bg-muted/30">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="flex items-center justify-center gap-3 mb-10">
          <HelpCircle className="h-6 w-6 text-primary" />
          <h2 className="text-3xl font-extrabold text-foreground tracking-tight">Frequently Asked Questions</h2>
        </div>
        
        <Accordion type="single" collapsible className="w-full bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
          {faqs.map((faq, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="px-6 border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
              <AccordionTrigger className="text-left font-bold text-foreground py-6 hover:no-underline">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground pb-6 leading-relaxed">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
