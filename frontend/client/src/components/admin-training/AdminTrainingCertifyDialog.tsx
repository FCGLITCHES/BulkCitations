import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { toast as dispatchToast } from "@/hooks/use-toast";

import {
  AdminTrainingHelpLabel as HelpLabel,
  renderDropdownHelp,
} from "./AdminTrainingHelpLabel";
import {
  CERTIFICATION_STATUS_OPTIONS,
  SCOPE_OPTIONS,
  TASK_OPTIONS,
  TRAINING_PACK_TARGET_OPTIONS,
} from "./constants";
import { formatAllFilteredTruthSelectionScope } from "./viewHelpers";
import type {
  AllFilteredTruthSelection,
  ApprovedTruthRow,
  TrainingPackTarget,
  TruthScope,
  TruthTask,
  TruthTaskCertificationStatus,
} from "./types";

interface AdminTrainingCertifyDialogProps {
  bulkCertifyDialogOpen: boolean;
  closeCertifyDialog: () => void;
  bulkCertifyIds: string[] | null;
  bulkCertifyAllFiltered: AllFilteredTruthSelection | null;
  bulkCertifyRowCount: number;
  bulkCertifyPageCount: number | null;
  certifyRow: ApprovedTruthRow | null;
  certifyTask: TruthTask;
  setCertifyTask: (value: TruthTask) => void;
  certifyScope: TruthScope;
  setCertifyScope: (value: TruthScope) => void;
  certifyPackTarget: TrainingPackTarget;
  setCertifyPackTarget: (value: TrainingPackTarget) => void;
  certifyStatus: TruthTaskCertificationStatus;
  setCertifyStatus: (value: TruthTaskCertificationStatus) => void;
  certifyBy: string;
  setCertifyBy: (value: string) => void;
  certifyRequiredPasses: number;
  setCertifyRequiredPasses: (value: number) => void;
  certifyCompletedPasses: number;
  setCertifyCompletedPasses: (value: number) => void;
  certifyDecisionHash: string;
  setCertifyDecisionHash: (value: string) => void;
  defaultTrainingPackTargetForTask: (
    task: TruthTask,
    scope: TruthScope,
  ) => TrainingPackTarget;
  certifyMutationPending: boolean;
  bulkCertifyMutationPending: boolean;
  startTruthBackgroundJobPending: boolean;
  onCertify: () => void;
  onBulkCertify: () => void;
  startAllFilteredTruthJob: (input: {
    operation: "certify";
    certify: {
      task: TruthTask;
      truthScope: TruthScope;
      packTarget: TrainingPackTarget;
      status: TruthTaskCertificationStatus;
      certifiedBy: string | null;
      requiredReviewPasses: number;
      completedReviewPasses: number;
      decisionHash: string | null;
    };
    closeCertifyDialogOnSuccess: boolean;
  }) => void;
  toast: typeof dispatchToast;
}

export function AdminTrainingCertifyDialog({
  bulkCertifyDialogOpen,
  closeCertifyDialog,
  bulkCertifyIds,
  bulkCertifyAllFiltered,
  bulkCertifyRowCount,
  bulkCertifyPageCount,
  certifyRow,
  certifyTask,
  setCertifyTask,
  certifyScope,
  setCertifyScope,
  certifyPackTarget,
  setCertifyPackTarget,
  certifyStatus,
  setCertifyStatus,
  certifyBy,
  setCertifyBy,
  certifyRequiredPasses,
  setCertifyRequiredPasses,
  certifyCompletedPasses,
  setCertifyCompletedPasses,
  certifyDecisionHash,
  setCertifyDecisionHash,
  defaultTrainingPackTargetForTask,
  certifyMutationPending,
  bulkCertifyMutationPending,
  startTruthBackgroundJobPending,
  onCertify,
  onBulkCertify,
  startAllFilteredTruthJob,
  toast,
}: AdminTrainingCertifyDialogProps) {
  return (
    <Dialog
      open={bulkCertifyDialogOpen}
      onOpenChange={(open) => !open && closeCertifyDialog()}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {bulkCertifyIds || bulkCertifyAllFiltered
              ? "Certify selected rows"
              : "Certify task scope"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {bulkCertifyIds || bulkCertifyAllFiltered
              ? "Certify the selected approved-truth rows for a shared task and truth scope using review-pass policy."
              : "Certify a row for a specific task and truth scope using review-pass policy."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <div className="font-semibold">
              {bulkCertifyIds || bulkCertifyAllFiltered
                ? "Selection"
                : "Row preview"}
            </div>
            {bulkCertifyIds || bulkCertifyAllFiltered ? (
              <>
                <div className="mt-1">
                  {bulkCertifyAllFiltered
                    ? `${bulkCertifyRowCount} approved-truth rows selected across ${bulkCertifyPageCount} ${bulkCertifyPageCount === 1 ? "page" : "pages"} (${formatAllFilteredTruthSelectionScope(bulkCertifyAllFiltered)}).`
                    : `${bulkCertifyRowCount} approved-truth rows selected.`}
                </div>
                {bulkCertifyIds ? (
                  <div className="mt-2 font-mono text-[10px] text-slate-500">
                    {bulkCertifyIds.slice(0, 3).join(", ")}
                    {bulkCertifyIds.length > 3 ? " ..." : ""}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="mt-1 line-clamp-3">
                  {certifyRow?.rawText ?? "—"}
                </div>
                <div className="mt-2 font-mono text-[10px] text-slate-500">
                  {certifyRow?.id ?? "—"}
                </div>
              </>
            )}
          </div>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="certify-task"
                label="Task"
                help={renderDropdownHelp(
                  "Choose one certification target per save action.",
                  TASK_OPTIONS,
                )}
              />
              <select
                id="certify-task"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={certifyTask}
                onChange={(e) => {
                  const nextTask = e.target.value as TruthTask;
                  setCertifyTask(nextTask);
                  setCertifyPackTarget(
                    defaultTrainingPackTargetForTask(nextTask, certifyScope),
                  );
                }}
              >
                {TASK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="certify-scope"
                label="Truth scope"
                help={renderDropdownHelp(
                  "Choose which truth scope this certification applies to.",
                  SCOPE_OPTIONS,
                )}
              />
              <select
                id="certify-scope"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={certifyScope}
                onChange={(e) => {
                  const nextScope = e.target.value as TruthScope;
                  setCertifyScope(nextScope);
                  setCertifyPackTarget(
                    defaultTrainingPackTargetForTask(certifyTask, nextScope),
                  );
                }}
              >
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="certify-pack-target"
                label="Push to build"
                help={renderDropdownHelp(
                  "Choose the staged pack this certified row should feed. The source row remains auditable while the pack becomes the build/live lane.",
                  TRAINING_PACK_TARGET_OPTIONS,
                )}
              />
              <select
                id="certify-pack-target"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={certifyPackTarget}
                onChange={(e) =>
                  setCertifyPackTarget(e.target.value as TrainingPackTarget)
                }
              >
                {TRAINING_PACK_TARGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="certify-status"
                label="Certification status"
                help={renderDropdownHelp(
                  "Choose whether this record stays in progress or becomes export-eligible.",
                  CERTIFICATION_STATUS_OPTIONS,
                )}
              />
              <select
                id="certify-status"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={certifyStatus}
                onChange={(e) =>
                  setCertifyStatus(
                    e.target.value as TruthTaskCertificationStatus,
                  )
                }
              >
                {CERTIFICATION_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="certify-by"
                label="Certified by"
                help="Reviewer identity for audit trail."
              />
              <Input
                id="certify-by"
                value={certifyBy}
                onChange={(e) => setCertifyBy(e.target.value)}
                placeholder="email or handle"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="certify-required-passes"
                label="Required review passes"
                help="Minimum completed passes required before certified status can be applied."
              />
              <Input
                id="certify-required-passes"
                type="number"
                min={1}
                max={5}
                value={String(certifyRequiredPasses)}
                onChange={(e) =>
                  setCertifyRequiredPasses(
                    Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                  )
                }
              />
            </div>
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="certify-completed-passes"
                label="Completed review passes"
                help="Use 1 for pass 1 and 2 for blind pass 2. Conflict between pass hashes auto-quarantines the row."
              />
              <Input
                id="certify-completed-passes"
                type="number"
                min={0}
                max={5}
                value={String(certifyCompletedPasses)}
                onChange={(e) =>
                  setCertifyCompletedPasses(
                    Math.max(0, Math.min(5, Number(e.target.value) || 0)),
                  )
                }
              />
            </div>
          </div>
          {certifyCompletedPasses >= 2 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Blind pass 2 mode: pass-1 labels are intentionally not shown
              here. Enter the pass-2 decision hash from your independent
              review.
            </div>
          ) : null}
          <div className="grid gap-1">
            <HelpLabel
              htmlFor="certify-decision-hash"
              label="Decision hash"
              help="Optional for pass 1. Required for blind pass 2 to compare independent decisions."
            />
            <Input
              id="certify-decision-hash"
              value={certifyDecisionHash}
              onChange={(e) => setCertifyDecisionHash(e.target.value)}
              placeholder={
                certifyCompletedPasses >= 2
                  ? "required for pass 2"
                  : "optional"
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={closeCertifyDialog}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              certifyMutationPending ||
              bulkCertifyMutationPending ||
              startTruthBackgroundJobPending
            }
            onClick={() => {
              if (bulkCertifyAllFiltered) {
                if (
                  certifyCompletedPasses >= 2 &&
                  !certifyDecisionHash.trim()
                ) {
                  toast({
                    title: "Decision hash required",
                    description:
                      "Decision hash is required for blind pass 2.",
                    variant: "destructive",
                  });
                  return;
                }
                void startAllFilteredTruthJob({
                  operation: "certify",
                  certify: {
                    task: certifyTask,
                    truthScope: certifyScope,
                    packTarget: certifyPackTarget,
                    status: certifyStatus,
                    certifiedBy: certifyBy.trim() || null,
                    requiredReviewPasses: certifyRequiredPasses,
                    completedReviewPasses: certifyCompletedPasses,
                    decisionHash: certifyDecisionHash.trim() || null,
                  },
                  closeCertifyDialogOnSuccess: true,
                });
                return;
              }
              if (bulkCertifyIds) {
                onBulkCertify();
                return;
              }
              onCertify();
            }}
          >
            {bulkCertifyIds || bulkCertifyAllFiltered
              ? bulkCertifyMutationPending
                ? "Certifying..."
                : startTruthBackgroundJobPending && bulkCertifyAllFiltered
                  ? "Starting..."
                  : bulkCertifyAllFiltered
                    ? "Certify selected pages"
                    : "Certify selected"
              : certifyMutationPending
                ? "Saving..."
                : "Save and stage certification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
