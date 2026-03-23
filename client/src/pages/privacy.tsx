import { Card, CardContent } from "@/components/ui/card";
import { Navbar } from "@/components/navbar";
import { SiteFooter } from "@/components/site-footer";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background font-sans flex flex-col">
      <Navbar />
...
      <main className="container mx-auto px-3 sm:px-4 py-8 sm:py-12 max-w-2xl overflow-x-hidden">
        <h2 className="text-2xl font-bold text-foreground mb-6">Privacy Policy</h2>
        <Card>
          <CardContent className="pt-6 space-y-4 text-muted-foreground">
            <p>
              <strong className="text-foreground">Data processing.</strong> References you paste are processed in memory to convert citation styles. They are not permanently stored on our servers.
            </p>
            <p>
              <strong className="text-foreground">Anonymous analytics.</strong> We may store lightweight usage events such as page views, converter attempts, completion counts, and approximate country from standard hosting headers. These analytics do not include your raw citation text.
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
      <SiteFooter />
    </div>
  );
}
