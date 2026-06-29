import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import type { AllFilteredTruthSelection } from "./types";

interface AdminTrainingBulkSelectionBarProps {
  showSelectAllPagesOption: boolean;
  canShowBulkActions: boolean;
  bulkActionBusy: boolean;
  allFilteredSelection: AllFilteredTruthSelection | null;
  onSelectAllPages: () => void;
  onApplyPageRange: (startPage: number, endPage: number) => void;
  deleteLabel: string;
  refillLabel: string;
  crossrefLabel: string;
  updateLabel: string;
  certifyLabel: string;
  onDelete: (pageRangeOverride?: { startPage: number; endPage: number }) => void;
  onPrefill: (pageRangeOverride?: { startPage: number; endPage: number }) => void;
  onCrossref: (pageRangeOverride?: { startPage: number; endPage: number }) => void;
  onUpdate: (pageRangeOverride?: { startPage: number; endPage: number }) => void;
  onCertify: (pageRangeOverride?: { startPage: number; endPage: number }) => void;
  totalTruthHighlightCount: number;
  highlightSummary?: string | null;
  onDismissHighlights: () => void;
}

export function AdminTrainingBulkSelectionBar({
  showSelectAllPagesOption,
  canShowBulkActions,
  bulkActionBusy,
  allFilteredSelection,
  onSelectAllPages,
  onApplyPageRange,
  deleteLabel,
  refillLabel,
  crossrefLabel,
  updateLabel,
  certifyLabel,
  onDelete,
  onPrefill,
  onCrossref,
  onUpdate,
  onCertify,
  totalTruthHighlightCount,
  highlightSummary,
  onDismissHighlights,
}: AdminTrainingBulkSelectionBarProps) {
  const [pageStartInput, setPageStartInput] = useState("");
  const [pageEndInput, setPageEndInput] = useState("");

  useEffect(() => {
    if (!allFilteredSelection) {
      setPageStartInput("");
      setPageEndInput("");
      return;
    }
    setPageStartInput(String(allFilteredSelection.pageStart));
    setPageEndInput(String(allFilteredSelection.pageEnd));
  }, [
    allFilteredSelection?.pageStart,
    allFilteredSelection?.pageEnd,
    allFilteredSelection?.availableTotalPages,
  ]);

  const parsedRangeStart = Number.parseInt(pageStartInput, 10);
  const parsedRangeEnd = Number.parseInt(pageEndInput, 10);
  const pageRangeInputValid =
    Boolean(allFilteredSelection) &&
    Number.isFinite(parsedRangeStart) &&
    Number.isFinite(parsedRangeEnd) &&
    parsedRangeStart >= 1 &&
    parsedRangeEnd >= 1 &&
    parsedRangeStart <= (allFilteredSelection?.availableTotalPages ?? 0) &&
    parsedRangeEnd <= (allFilteredSelection?.availableTotalPages ?? 0);
  const pageRangeDirty =
    Boolean(allFilteredSelection) &&
    (String(allFilteredSelection?.pageStart ?? "") !== pageStartInput
      || String(allFilteredSelection?.pageEnd ?? "") !== pageEndInput);
  const hasInvalidPendingPageRange = Boolean(allFilteredSelection) && pageRangeDirty && !pageRangeInputValid;

  const applyPageRange = () => {
    if (!allFilteredSelection || !pageRangeInputValid) {
      return;
    }
    onApplyPageRange(parsedRangeStart, parsedRangeEnd);
  };

  const pendingPageRangeOverride =
    allFilteredSelection && pageRangeInputValid && pageRangeDirty
      ? {
          startPage: parsedRangeStart,
          endPage: parsedRangeEnd,
        }
      : undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {showSelectAllPagesOption ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={bulkActionBusy}
            onClick={onSelectAllPages}
          >
            Select all pages
          </Button>
        ) : null}
        {canShowBulkActions ? (
          <>
            {allFilteredSelection ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                <span className="font-medium">Pages</span>
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={bulkActionBusy}
                  value={pageStartInput}
                  onChange={(e) => setPageStartInput(e.target.value.replace(/[^\d]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyPageRange();
                    }
                  }}
                  aria-label="Bulk action start page"
                  className="h-8 w-14 rounded border border-slate-200 bg-transparent px-2 text-center text-sm text-slate-700 outline-none dark:border-slate-700 dark:text-slate-100"
                />
                <span>to</span>
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={bulkActionBusy}
                  value={pageEndInput}
                  onChange={(e) => setPageEndInput(e.target.value.replace(/[^\d]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyPageRange();
                    }
                  }}
                  aria-label="Bulk action end page"
                  className="h-8 w-14 rounded border border-slate-200 bg-transparent px-2 text-center text-sm text-slate-700 outline-none dark:border-slate-700 dark:text-slate-100"
                />
                <span className="text-slate-500">of {allFilteredSelection.availableTotalPages}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={bulkActionBusy || !pageRangeInputValid || !pageRangeDirty}
                  onClick={applyPageRange}
                >
                  Apply range
                </Button>
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkActionBusy || hasInvalidPendingPageRange}
              onClick={() => onDelete(pendingPageRangeOverride)}
            >
              {deleteLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkActionBusy || hasInvalidPendingPageRange}
              onClick={() => onPrefill(pendingPageRangeOverride)}
            >
              {refillLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkActionBusy || hasInvalidPendingPageRange}
              onClick={() => onCrossref(pendingPageRangeOverride)}
            >
              {crossrefLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkActionBusy || hasInvalidPendingPageRange}
              onClick={() => onUpdate(pendingPageRangeOverride)}
            >
              {updateLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={bulkActionBusy || hasInvalidPendingPageRange}
              onClick={() => onCertify(pendingPageRangeOverride)}
            >
              {certifyLabel}
            </Button>
          </>
        ) : null}
      </div>

      {totalTruthHighlightCount > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
          <span>{highlightSummary ?? "Bulk result highlights are active for the latest bulk action."}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onDismissHighlights}>
            Dismiss highlights
          </Button>
        </div>
      ) : null}
    </>
  );
}
