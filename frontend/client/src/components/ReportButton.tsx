import { useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { submitCitationReport } from "@/lib/engine-api";

const CATEGORIES = [
  { value: "author", label: "Author name incorrect" },
  { value: "year", label: "Year missing or incorrect" },
  { value: "title", label: "Title missing or incorrect" },
  { value: "venue", label: "Venue / Journal incorrect" },
  { value: "locator", label: "Pages missing or incorrect" },
  { value: "style-detection", label: "Wrong citation style detected" },
  { value: "reference-type", label: "Wrong reference type" },
  { value: "other", label: "Other..." },
] as const;

export interface ReportButtonProps {
  jobId: string;
  citationId: string;
  rawInput: string;
  convertedOutput: string;
  reported?: boolean;
  onReported?: () => void;
}

export default function ReportButton({
  jobId,
  citationId,
  rawInput,
  convertedOutput,
  reported = false,
  onReported,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [userNote, setUserNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showOriginalInput, setShowOriginalInput] = useState(false);
  const includesOther = categories.includes("other");
  const { toast } = useToast();

  const toggleCategory = (value: string, checked: boolean | "indeterminate") => {
    setCategories((current) => {
      if (checked) {
        return current.includes(value) ? current : [...current, value];
      }
      return current.filter((entry) => entry !== value);
    });
  };

  const handleSubmit = async () => {
    if (categories.length === 0) return;
    setSubmitting(true);
    try {
      const extraNote = categories.length > 1
        ? `Selected categories: ${categories.join(", ")}`
        : "";
      const note = [extraNote, includesOther ? userNote.slice(0, 500) : ""]
        .filter(Boolean)
        .join("\n\n");

      await submitCitationReport({
        jobId,
        citationId,
        failureCategory: categories[0],
        ...(note ? { userNote: note } : {}),
      });
      setOpen(false);
      setCategories([]);
      setUserNote("");
      setShowOriginalInput(false);
      toast({
        title: "Report submitted",
        description: "Thanks. Your feedback has been saved.",
      });
      onReported?.();
    } catch (err) {
      console.error(err);
      toast({
        title: "Report failed",
        description: err instanceof Error ? err.message : "Failed to save report",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (reported) {
    return (
      <span className="text-xs text-destructive ml-1">Thanks — reported.</span>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            className="flex h-auto items-center gap-1.5 px-2 py-1.5 text-xs font-bold !text-red-600 transition-colors hover:bg-red-50 hover:!text-red-700 focus:ring-0 dark:!text-red-400 dark:hover:bg-red-950/40 dark:hover:!text-red-300"
            onClick={() => setOpen(true)}
            aria-label="Report an issue"
          >
            <Flag className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Report bad citation</span>
            <span className="sm:hidden">Wrong?</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Report an issue with this citation</p>
        </TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report an issue</DialogTitle>
            <DialogDescription className="sr-only">
              Provide feedback on a specific citation parsing or formatting error.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Converted Citation
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setShowOriginalInput((current) => !current)}
                >
                  {showOriginalInput ? "Hide original input" : "Show original input"}
                </Button>
              </div>
              <div className="bg-muted/50 rounded p-3 text-xs font-mono break-words max-h-32 overflow-y-auto">
                {convertedOutput}
              </div>
            </div>

            {showOriginalInput && (
              <div className="grid gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Original Input
                </Label>
                <div className="bg-muted/50 rounded p-3 text-xs font-mono break-words max-h-32 overflow-y-auto">
                  {rawInput}
                </div>
              </div>
            )}

            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Compare the converted citation with the original input before reporting.
            </div>

            <div className="grid gap-2">
              <Label>What is wrong? (select all that apply)</Label>
              <div className="grid gap-3 rounded-md border p-3">
                {CATEGORIES.map((c) => (
                  <label key={c.value} className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={categories.includes(c.value)}
                      onCheckedChange={(checked) => toggleCategory(c.value, checked)}
                      aria-label={c.label}
                    />
                    <span className="text-sm leading-5">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
            {includesOther && (
              <div className="grid gap-2">
                <Label htmlFor="report-note">Describe the issue</Label>
                <Textarea
                  id="report-note"
                  placeholder="e.g. 'should be conference, not venue / journal'"
                  value={userNote}
                  onChange={(e) => setUserNote(e.target.value.slice(0, 500))}
                  maxLength={500}
                  rows={3}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">{userNote.length}/500</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-blue-600 text-blue-700 hover:bg-blue-100 hover:text-blue-900 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/50 dark:hover:text-blue-100"
              onClick={handleSubmit}
              disabled={categories.length === 0 || submitting}
            >
              {submitting ? "Submitting..." : "Submit report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
