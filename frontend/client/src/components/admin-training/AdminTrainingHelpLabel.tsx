import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AdminTrainingHelpLabel({
  htmlFor,
  label,
  help,
}: {
  htmlFor?: string;
  label: string;
  help: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
              aria-label={`${label} help`}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm text-xs leading-5">{help}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function renderDropdownHelp(
  intro: string,
  options: Array<{ label: string; description: string }>,
) {
  return (
    <div className="space-y-1.5">
      <p>{intro}</p>
      <div className="space-y-1">
        {options.map((option) => (
          <p key={option.label}>
            <span className="font-semibold">{option.label}:</span> {option.description}
          </p>
        ))}
      </div>
    </div>
  );
}
