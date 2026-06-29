import { type ReactNode } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AdminTrainingDisclosureSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  summary: ReactNode;
  children: ReactNode;
}

export function AdminTrainingDisclosureSection({
  open,
  onOpenChange,
  title,
  summary,
  children,
}: AdminTrainingDisclosureSectionProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/30"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
        >
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300">{summary}</div>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {open ? "Hide" : "Show"}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
