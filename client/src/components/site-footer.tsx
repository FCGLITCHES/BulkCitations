import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Quote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const personaOptions = [
  { value: "student", label: "Student" },
  { value: "researcher", label: "Researcher" },
  { value: "educator", label: "Educator" },
  { value: "developer", label: "Developer" },
  { value: "team", label: "Team" },
] as const;

export function SiteFooter() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [persona, setPersona] = useState<(typeof personaOptions)[number]["value"]>("student");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleWaitlistSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, persona }),
      });

      if (!response.ok) throw new Error("Waitlist signup failed");

      setEmail("");
      setPersona("student");
      toast({
        title: "You're on the waitlist",
        description: "We'll keep you posted with thoughtful updates as the product grows.",
      });
    } catch {
      toast({
        title: "Could not join waitlist",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <footer className="bg-background dark:bg-secondary text-foreground dark:text-secondary-foreground py-6 sm:py-7 border-t border-border dark:border-primary/10 overflow-x-hidden mt-auto">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="px-1 py-1 sm:px-2">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-primary-container rounded-xl flex items-center justify-center shadow-md shadow-primary/15">
                  <Quote className="text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base sm:text-lg">BulkReferences</span>
                  <Badge
                    variant="secondary"
                    className="text-[9px] px-1.5 py-0 uppercase font-bold text-white bg-primary hidden sm:inline-flex"
                  >
                    Beta
                  </Badge>
                </div>
              </div>
              <p className="text-sm sm:text-[15px] leading-6 text-muted-foreground dark:text-secondary-foreground/78 max-w-lg">
                Making academic citations simple and accurate for researchers worldwide.
              </p>
              <div className="h-4 sm:h-5" />

              <div className="rounded-2xl bg-muted/50 dark:bg-black/10 px-4 py-4 sm:px-5">
                <h4 className="font-semibold mb-2.5 text-xs uppercase tracking-[0.16em] text-primary/90">Waitlist</h4>
                <p className="text-sm leading-5 text-muted-foreground dark:text-secondary-foreground/80 mb-3">
                  Join other students and researchers getting thoughtful updates, smoother workflows, and product improvements made for real academic work.
                </p>
                <form onSubmit={handleWaitlistSubmit} className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    className="border-white/10 bg-background/95 text-foreground placeholder:text-muted-foreground"
                  />
                  <select
                    value={persona}
                    onChange={(e) => setPersona(e.target.value as typeof persona)}
                    className="h-10 rounded-md border border-white/10 bg-background/95 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
                  >
                    {personaOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" disabled={isSubmitting} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    {isSubmitting ? "Joining..." : "Join"}
                  </Button>
                </form>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 lg:min-w-[520px] lg:max-w-[560px]">
              <div className="rounded-2xl bg-muted/50 dark:bg-black/10 px-4 py-4">
                <h4 className="font-semibold mb-2.5 text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-secondary-foreground/60">Support</h4>
                <ul className="space-y-2.5 text-sm text-foreground/88 dark:text-secondary-foreground/88">
                  <li>
                    <Link href="/faq" className="inline-flex hover:text-primary transition-colors">
                      FAQ
                    </Link>
                  </li>
                  <li>
                    <Link href="/about" className="inline-flex hover:text-primary transition-colors">
                      About
                    </Link>
                  </li>
                  <li>
                    <Link href="/contact" className="inline-flex hover:text-primary transition-colors">
                      Contact Us
                    </Link>
                  </li>
                  <li>
                    <Link href="/contact" className="inline-flex hover:text-primary transition-colors">
                      Report an Issue
                    </Link>
                  </li>
                </ul>
              </div>
              <div className="rounded-2xl bg-muted/50 dark:bg-black/10 px-4 py-4">
                <h4 className="font-semibold mb-2.5 text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-secondary-foreground/60">Legal</h4>
                <ul className="space-y-2.5 text-sm text-foreground/88 dark:text-secondary-foreground/88">
                  <li>
                    <Link href="/privacy" className="inline-flex hover:text-primary transition-colors">
                      Privacy Policy
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        <Separator className="my-6 border-border dark:border-secondary-foreground/20" />
        <div className="text-center text-sm text-muted-foreground dark:text-secondary-foreground/70">
          <p>&copy; 2026 BulkReferences. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
