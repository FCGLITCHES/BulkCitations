import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  AdminTrainingHelpLabel as HelpLabel,
  renderDropdownHelp,
} from "./AdminTrainingHelpLabel";
import {
  BLOCKED_REASON_OPTIONS,
  ROW_STATUS_OPTIONS,
  TRUST_LEVEL_OPTIONS,
} from "./constants";
import { formatAllFilteredTruthSelectionScope } from "./viewHelpers";
import type {
  AllFilteredTruthSelection,
  TruthBlockedReason,
  TruthRowStatus,
  TruthTrustLevel,
} from "./types";

interface AdminTrainingBulkUpdateDialogProps {
  bulkUpdateIds: string[] | null;
  bulkUpdateAllFiltered: AllFilteredTruthSelection | null;
  closeBulkUpdateDialog: () => void;
  bulkUpdateTrustLevel: TruthTrustLevel | "";
  setBulkUpdateTrustLevel: (value: TruthTrustLevel | "") => void;
  bulkUpdateRowStatus: TruthRowStatus | "";
  setBulkUpdateRowStatus: (value: TruthRowStatus | "") => void;
  bulkUpdateBlockedReason: TruthBlockedReason | "";
  setBulkUpdateBlockedReason: (value: TruthBlockedReason | "") => void;
  bulkUpdateMutationPending: boolean;
  startTruthBackgroundJobPending: boolean;
  onBulkUpdate: () => void;
  startAllFilteredTruthJob: (input: {
    operation: "update";
    update: {
      trustLevel?: TruthTrustLevel;
      rowStatus?: TruthRowStatus;
      blockedReason?: TruthBlockedReason | null;
    };
    closeBulkUpdateDialogOnSuccess: boolean;
  }) => void;
}

export function AdminTrainingBulkUpdateDialog({
  bulkUpdateIds,
  bulkUpdateAllFiltered,
  closeBulkUpdateDialog,
  bulkUpdateTrustLevel,
  setBulkUpdateTrustLevel,
  bulkUpdateRowStatus,
  setBulkUpdateRowStatus,
  bulkUpdateBlockedReason,
  setBulkUpdateBlockedReason,
  bulkUpdateMutationPending,
  startTruthBackgroundJobPending,
  onBulkUpdate,
  startAllFilteredTruthJob,
}: AdminTrainingBulkUpdateDialogProps) {
  return (
    <Dialog
      open={bulkUpdateIds !== null || bulkUpdateAllFiltered !== null}
      onOpenChange={(open) => !open && closeBulkUpdateDialog()}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {bulkUpdateAllFiltered
              ? "Update trust/status for all filtered rows"
              : "Update trust/status"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Bulk update trust level and row status for the selected
            approved-truth rows.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <div className="font-semibold">Selection</div>
            <div className="mt-1">
              {bulkUpdateAllFiltered
                ? `${bulkUpdateAllFiltered.totalRows} approved-truth rows selected across ${bulkUpdateAllFiltered.totalPages} ${bulkUpdateAllFiltered.totalPages === 1 ? "page" : "pages"} (${formatAllFilteredTruthSelectionScope(bulkUpdateAllFiltered)}).`
                : `${bulkUpdateIds?.length ?? 0} approved-truth row${bulkUpdateIds?.length === 1 ? "" : "s"} selected.`}
            </div>
            {bulkUpdateIds ? (
              <div className="mt-2 font-mono text-[10px] text-slate-500">
                {bulkUpdateIds.slice(0, 3).join(", ")}
                {bulkUpdateIds.length > 3 ? " ..." : ""}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="bulk-update-trust"
                label="Trust level"
                help={renderDropdownHelp(
                  "Choose a new trust level, or leave it unchanged.",
                  TRUST_LEVEL_OPTIONS,
                )}
              />
              <select
                id="bulk-update-trust"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={bulkUpdateTrustLevel}
                onChange={(e) =>
                  setBulkUpdateTrustLevel(
                    (e.target.value || "") as TruthTrustLevel | "",
                  )
                }
              >
                <option value="">Leave unchanged</option>
                {TRUST_LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="bulk-update-status"
                label="Row status"
                help={renderDropdownHelp(
                  "Choose a new row status, or leave it unchanged.",
                  ROW_STATUS_OPTIONS,
                )}
              />
              <select
                id="bulk-update-status"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={bulkUpdateRowStatus}
                onChange={(e) => {
                  const nextStatus = (e.target.value || "") as
                    | TruthRowStatus
                    | "";
                  setBulkUpdateRowStatus(nextStatus);
                  if (nextStatus !== "quarantined") {
                    setBulkUpdateBlockedReason("");
                  }
                }}
              >
                <option value="">Leave unchanged</option>
                {ROW_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {bulkUpdateRowStatus === "quarantined" ? (
            <div className="grid gap-1">
              <HelpLabel
                htmlFor="bulk-update-blocked-reason"
                label="Blocked reason"
                help={renderDropdownHelp(
                  "Required when quarantining rows.",
                  BLOCKED_REASON_OPTIONS,
                )}
              />
              <select
                id="bulk-update-blocked-reason"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={bulkUpdateBlockedReason}
                onChange={(e) =>
                  setBulkUpdateBlockedReason(
                    (e.target.value || "") as TruthBlockedReason | "",
                  )
                }
              >
                <option value="">Select blocked reason</option>
                {BLOCKED_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="rounded-md border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
            Leave a field unchanged if you do not want to touch it. If you
            choose <span className="font-semibold">Quarantined</span>, a
            blocked reason is required.
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={closeBulkUpdateDialog}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              bulkUpdateMutationPending ||
              startTruthBackgroundJobPending ||
              (!bulkUpdateTrustLevel && !bulkUpdateRowStatus) ||
              (bulkUpdateRowStatus === "quarantined" &&
                !bulkUpdateBlockedReason)
            }
            onClick={() => {
              const updatePayload = {
                ...(bulkUpdateTrustLevel
                  ? { trustLevel: bulkUpdateTrustLevel }
                  : {}),
                ...(bulkUpdateRowStatus
                  ? { rowStatus: bulkUpdateRowStatus }
                  : {}),
                ...(bulkUpdateRowStatus === "quarantined"
                  ? { blockedReason: bulkUpdateBlockedReason || null }
                  : {}),
              };
              if (bulkUpdateAllFiltered) {
                void startAllFilteredTruthJob({
                  operation: "update",
                  update: updatePayload,
                  closeBulkUpdateDialogOnSuccess: true,
                });
                return;
              }
              onBulkUpdate();
            }}
          >
            {bulkUpdateAllFiltered
              ? startTruthBackgroundJobPending
                ? "Starting..."
                : "Update selected pages"
              : bulkUpdateMutationPending
                ? "Updating..."
                : "Update selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
