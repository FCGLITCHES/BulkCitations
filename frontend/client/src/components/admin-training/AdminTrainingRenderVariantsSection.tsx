import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { AdminTrainingWorkflowSection } from "./AdminTrainingWorkflowSection";
import { TRUTH_RENDER_VARIANT_STYLE_LABELS, TRUTH_RENDER_VARIANT_STYLE_ORDER } from "./constants";
import { normalizeWhitespace } from "./truthFieldHelpers";
import type {
  ApprovedTruthRenderVariant,
  TruthRenderVariantStyle,
} from "./types";

interface AdminTrainingRenderVariantsSectionProps {
  editing: boolean;
  renderVariantInputsDirty: boolean;
  variantEditorLocked: boolean;
  generateRenderVariantsPending: boolean;
  patchRenderVariantPending: boolean;
  approveRenderVariantPending: boolean;
  resetRenderVariantPending: boolean;
  rendererVersion?: string | null;
  renderVariantsLoading: boolean;
  renderVariantsError: boolean;
  renderVariantsErrorMessage: string;
  activeRenderVariantStyle: TruthRenderVariantStyle;
  onActiveRenderVariantStyleChange: (style: TruthRenderVariantStyle) => void;
  renderVariantsByStyle: Partial<Record<TruthRenderVariantStyle, ApprovedTruthRenderVariant>>;
  variantTextOverrides: Partial<Record<TruthRenderVariantStyle, string>>;
  variantNoteOverrides: Partial<Record<TruthRenderVariantStyle, string>>;
  onVariantTextChange: (style: TruthRenderVariantStyle, value: string) => void;
  onVariantNoteChange: (style: TruthRenderVariantStyle, value: string) => void;
  onGenerateAllVariants: () => void;
  onGenerateVariant: (style: TruthRenderVariantStyle) => void;
  onSaveVariant: (style: TruthRenderVariantStyle, renderedText: string, notes: string) => void;
  onToggleVariantApproval: (style: TruthRenderVariantStyle, approved: boolean) => void;
  onResetVariant: (style: TruthRenderVariantStyle) => void;
}

function renderVariantBadgeClass(kind: "generated" | "edited" | "approved" | "stale") {
  switch (kind) {
    case "generated":
      return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
    case "edited":
      return "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200";
    case "approved":
      return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
    case "stale":
      return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }
}

export function AdminTrainingRenderVariantsSection({
  editing,
  renderVariantInputsDirty,
  variantEditorLocked,
  generateRenderVariantsPending,
  patchRenderVariantPending,
  approveRenderVariantPending,
  resetRenderVariantPending,
  rendererVersion,
  renderVariantsLoading,
  renderVariantsError,
  renderVariantsErrorMessage,
  activeRenderVariantStyle,
  onActiveRenderVariantStyleChange,
  renderVariantsByStyle,
  variantTextOverrides,
  variantNoteOverrides,
  onVariantTextChange,
  onVariantNoteChange,
  onGenerateAllVariants,
  onGenerateVariant,
  onSaveVariant,
  onToggleVariantApproval,
  onResetVariant,
}: AdminTrainingRenderVariantsSectionProps) {
  return (
    <AdminTrainingWorkflowSection
      step="Step 5"
      title="Review rendered style variants"
      description="Generate the six derived style outputs only after the Expected fields and Expected type are saved."
    >
      <div className="grid gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Rendered style variants
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            These six linked outputs are generated from the Expected fields and Expected type above. They are gold-derived render variants for renderer review and augmentation only. They do not enter the current <code>style/core</code> freeze/export by default.
          </p>
        </div>

        {!editing ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Save this truth row first, then generate and review the six linked style variants here.
          </div>
        ) : null}

        {editing && renderVariantInputsDirty ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Save Expected fields and Expected type first. Changes there mark saved variants stale until you regenerate or re-approve them.
          </div>
        ) : null}

        {editing ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={variantEditorLocked || renderVariantInputsDirty || generateRenderVariantsPending}
                onClick={onGenerateAllVariants}
              >
                {generateRenderVariantsPending ? "Generating..." : "Generate all six variants"}
              </Button>
              <span className="text-xs text-slate-600 dark:text-slate-300">
                {rendererVersion
                  ? `Renderer version: ${rendererVersion}`
                  : "Variants use the current deterministic renderer version."}
              </span>
            </div>

            {renderVariantsLoading ? (
              <p className="text-sm text-slate-500">Loading linked style variants…</p>
            ) : renderVariantsError ? (
              <p className="text-sm text-red-600">{renderVariantsErrorMessage}</p>
            ) : (
              <Accordion
                type="single"
                collapsible
                value={activeRenderVariantStyle}
                onValueChange={(value) => {
                  if (value) {
                    onActiveRenderVariantStyleChange(value as TruthRenderVariantStyle);
                  }
                }}
                className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40"
              >
                {TRUTH_RENDER_VARIANT_STYLE_ORDER.map((style) => {
                  const item = renderVariantsByStyle[style];
                  const renderedText = variantTextOverrides[style] ?? item?.renderedText ?? "";
                  const notesValue = variantNoteOverrides[style] ?? item?.notes ?? "";
                  const generatedText = item?.generatedText ?? "";
                  const generatedDiffers =
                    item != null && normalizeWhitespace(generatedText) !== normalizeWhitespace(renderedText);
                  const itemExists = Boolean(item);
                  const canSaveVariant =
                    normalizeWhitespace(renderedText).length > 0 &&
                    (!item || renderedText !== item.renderedText || notesValue !== (item.notes ?? ""));

                  return (
                    <AccordionItem
                      key={style}
                      value={style}
                      className="border-b border-slate-200 px-4 last:border-b-0 dark:border-slate-800"
                    >
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex min-w-0 flex-1 flex-col items-start gap-2 pr-4 text-left">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {TRUTH_RENDER_VARIANT_STYLE_LABELS[style]}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5",
                                renderVariantBadgeClass(
                                  item?.sourceKind === "admin_authored" ? "edited" : "generated",
                                ),
                              )}
                            >
                              {item?.sourceKind === "admin_authored" ? "edited" : "generated"}
                            </span>
                            {item?.approvalStatus === "approved" ? (
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5",
                                  renderVariantBadgeClass("approved"),
                                )}
                              >
                                approved
                              </span>
                            ) : null}
                            {item?.stale ? (
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5",
                                  renderVariantBadgeClass("stale"),
                                )}
                              >
                                stale
                              </span>
                            ) : null}
                            <span className="text-slate-500 dark:text-slate-400">
                              {itemExists ? "augmentation lane" : "not generated yet"}
                            </span>
                          </div>
                        </div>
                      </AccordionTrigger>

                      <AccordionContent className="pt-1">
                        <div className="grid gap-3 pb-4">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={variantEditorLocked || renderVariantInputsDirty || generateRenderVariantsPending}
                              onClick={() => onGenerateVariant(style)}
                            >
                              {itemExists ? "Regenerate" : "Generate"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={variantEditorLocked || renderVariantInputsDirty || patchRenderVariantPending || !canSaveVariant}
                              onClick={() => onSaveVariant(style, renderedText, notesValue)}
                            >
                              Save edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={variantEditorLocked || renderVariantInputsDirty || approveRenderVariantPending || !itemExists}
                              onClick={() => onToggleVariantApproval(style, item?.approvalStatus !== "approved")}
                            >
                              {item?.approvalStatus === "approved" ? "Unapprove" : "Approve"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={variantEditorLocked || renderVariantInputsDirty || resetRenderVariantPending || !itemExists}
                              onClick={() => onResetVariant(style)}
                            >
                              Reset to generated
                            </Button>
                          </div>

                          <div className="grid gap-1">
                            <Label htmlFor={`truth-variant-${style}`}>Rendered output</Label>
                            <Textarea
                              id={`truth-variant-${style}`}
                              value={renderedText}
                              onChange={(e) => onVariantTextChange(style, e.target.value)}
                              rows={5}
                              placeholder={`Rendered ${TRUTH_RENDER_VARIANT_STYLE_LABELS[style]} citation`}
                              className="font-mono text-xs"
                              disabled={variantEditorLocked || renderVariantInputsDirty}
                            />
                          </div>

                          <div className="grid gap-1">
                            <Label htmlFor={`truth-variant-notes-${style}`}>Variant notes</Label>
                            <Input
                              id={`truth-variant-notes-${style}`}
                              value={notesValue}
                              onChange={(e) => onVariantNoteChange(style, e.target.value)}
                              placeholder="Optional notes for this variant"
                              disabled={variantEditorLocked || renderVariantInputsDirty}
                            />
                          </div>

                          {generatedDiffers ? (
                            <div className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70">
                              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                Latest generated baseline
                              </div>
                              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700 dark:text-slate-200">
                                {generatedText}
                              </pre>
                            </div>
                          ) : null}

                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {item
                              ? `Last updated ${new Date(item.updatedAt).toLocaleString()}${item.approvedBy ? ` by ${item.approvedBy}` : ""}.`
                              : "Generate this style from the Expected fields and Expected type above, then review and approve it here."}
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </>
        ) : null}
      </div>
    </AdminTrainingWorkflowSection>
  );
}
