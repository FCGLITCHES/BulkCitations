import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AdminTrainingJsonPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: string;
}

export function AdminTrainingJsonPreview({
  open,
  onOpenChange,
  preview,
}: AdminTrainingJsonPreviewProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <span>View JSON payload</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {open ? "Hide" : "Show"}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-slate-200 p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono">
            {preview}
          </pre>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
