import { Card, CardContent } from "../components/ui/card";
import { Quote } from "lucide-react";
import { Link } from "wouter";

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-surface shadow-sm border-b border-border overflow-x-hidden">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center space-x-3 mb-8">
              <Link href="/">
                <div className="w-10 h-10 bg-gradient-brand rounded-xl flex items-center justify-center shadow-md hover:scale-105 transition-transform cursor-pointer">
                  <Quote className="text-white text-lg" />
                </div>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-foreground">BulkCitations</h1>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">About</p>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-2 sm:gap-4 shrink-0">
              <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">Home</Link>
              <Link href="/faq" className="text-muted-foreground hover:text-primary transition-colors">FAQ</Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-primary transition-colors">Privacy</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-8 sm:py-12 max-w-2xl overflow-x-hidden">
        <h2 className="text-2xl font-bold text-foreground mb-6">About BulkCitations</h2>
        <Card>
          <CardContent className="pt-6 space-y-4 text-muted-foreground">
            <p>
              BulkCitations helps researchers and students convert references between academic citation styles. Paste mixed-format references from different sources, and get clean output in APA, MLA, Harvard, Chicago, IEEE, or Vancouver.
            </p>
            <p>
              <strong className="text-foreground">Features.</strong> Auto-detection of input style, duplicate clustering, per-citation warnings, batch summary, and export to TXT, PDF, BibTeX, and RIS.
            </p>
            <p>
              <strong className="text-foreground">Accuracy.</strong> The converter uses pattern-based parsing and style-specific rules. On benchmark sets it achieves high accuracy for journal articles, conference papers, and books. Truncated or unusual inputs may need manual review.
            </p>
            <p>
              <strong className="text-foreground">Report an issue.</strong> Use the Report button on any citation to flag parsing or formatting problems. Your feedback helps improve the tool.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
