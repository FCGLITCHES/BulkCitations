import { useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

const CATEGORIES = [
  "Year missing or incorrect",
  "Author name incorrect",
  "Title missing or incorrect",
  "Journal / venue incorrect",
  "Pages missing or incorrect",
  "Wrong citation style detected",
  "Other...",
] as const;

export interface ReportButtonProps {
  refId: string;
  rawInput: string;
  detectedInputStyle: string;
  targetStyle: string;
  convertedOutput: string;
  reported?: boolean;
  onReported?: () => void;
}

export default function ReportButton({
  refId,
  rawInput,
  detectedInputStyle,
  targetStyle,
  convertedOutput,
  reported = false,
  onReported,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [userNote, setUserNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!category) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput,
          detectedInputStyle,
          targetStyle,
          convertedOutput,
          userCategory: category === "Other..." ? "Other..." : category,
          userNote: category === "Other..." ? userNote.slice(0, 300) : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to submit report");
      }
      setOpen(false);
      setCategory("");
      setUserNote("");
      onReported?.();
    } catch (err) {
      console.error(err);
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
            size="sm"
            className="text-xs sm:text-sm h-8 px-3 sm:h-9 sm:px-4 text-red-600 hover:bg-red-100 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-950/50 dark:hover:text-red-200"
            onClick={() => setOpen(true)}
            aria-label="Report an issue"
          >
            <Flag className="h-4 w-4 mr-1.5" />
            Report bad citation
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Report an issue</p>
        </TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report an issue</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="report-category">What is wrong? (required)</Label>
              <Select value={category} onValueChange={setCategory} required>
                <SelectTrigger id="report-category">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {category === "Other..." && (
              <div className="grid gap-2">
                <Label htmlFor="report-note">Describe the issue</Label>
                <Textarea
                  id="report-note"
                  placeholder="Optional description..."
                  value={userNote}
                  onChange={(e) => setUserNote(e.target.value.slice(0, 300))}
                  maxLength={300}
                  rows={3}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">{userNote.length}/300</p>
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
              disabled={!category || submitting}
            >
              {submitting ? "Submitting..." : "Submit report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
