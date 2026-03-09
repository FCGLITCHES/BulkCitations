import { Card, CardContent } from "../components/ui/card";
import { Quote } from "lucide-react";
import { Link } from "wouter";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-surface shadow-sm border-b border-border overflow-x-hidden">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center space-x-3">
              <Link href="/">
                <div className="w-10 h-10 bg-gradient-brand rounded-xl flex items-center justify-center shadow-md hover:scale-105 transition-transform cursor-pointer">
                  <Quote className="text-white text-lg" />
                </div>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-foreground">BulkCitations</h1>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Privacy Policy</p>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-2 sm:gap-4 shrink-0">
              <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">Home</Link>
              <Link href="/faq" className="text-muted-foreground hover:text-primary transition-colors">FAQ</Link>
              <Link href="/about" className="text-muted-foreground hover:text-primary transition-colors">About</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-8 sm:py-12 max-w-2xl overflow-x-hidden">
        <h2 className="text-2xl font-bold text-foreground mb-6">Privacy Policy</h2>
        <Card>
          <CardContent className="pt-6 space-y-4 text-muted-foreground">
            <p>
              <strong className="text-foreground">Data processing.</strong> References you paste are processed in memory to convert citation styles. They are not permanently stored on our servers.
            </p>
            <p>
              <strong className="text-foreground">No account required.</strong> The core conversion workflow does not require sign-up. If you use optional features that involve storage (e.g. saved projects), that data will be handled according to this policy.
            </p>
            <p>
              <strong className="text-foreground">Third parties.</strong> We do not sell or share your reference data with third parties. Optional authority lookups (e.g. to validate journal metadata) may involve external APIs; see our FAQ for details.
            </p>
            <p>
              <strong className="text-foreground">Cookies.</strong> We may use minimal cookies for session or preferences. You can disable cookies in your browser if preferred.
            </p>
            <p>
              <strong className="text-foreground">Updates.</strong> We may update this policy. Continued use of the service after changes constitutes acceptance.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
