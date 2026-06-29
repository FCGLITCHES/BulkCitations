import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AdminTrainingWorkflowSectionProps {
  step: string;
  title: string;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function AdminTrainingWorkflowSection({
  step,
  title,
  description,
  className,
  children,
}: AdminTrainingWorkflowSectionProps) {
  return (
    <section className={cn("space-y-3 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800", className)}>
      <div className="space-y-1">
        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
          {step}
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          {description ? (
            <div className="text-xs leading-5 text-slate-600 dark:text-slate-300">{description}</div>
          ) : null}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
