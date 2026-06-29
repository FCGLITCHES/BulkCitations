import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  requestEngineProEnrichApply,
  requestEngineProEnrich,
  requestEngineProEnrichPreview,
  submitCitationReport,
  type EngineProEnrichCitationProposal,
  type EngineProEnrichFieldProposal,
  type EngineProEnrichPreviewResponse,
} from "@/lib/engine-api";
import type {
  EngineDuplicateGroup,
  EngineProcessedCitation,
  EngineResultModel,
  EngineStageRunRecord,
} from "@/lib/engine-types";
import { mapEngineReferenceTypeToShared, mapEngineStyleToShared } from "@/lib/engine-adapters";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown } from "lucide-react";
import PortableOutput, {
  type AssertionSummary,
  type ConvertedReference,
  type DuplicateGroup,
  type ParsedReference,
  type ReportPayload,
} from "./PortableOutput";

interface ReferenceOutputProps {
  result: EngineResultModel;
  groupDuplicates?: boolean;
  autoCheckPro?: boolean;
  onError: (error: string) => void;
}

type ProReferencePreviewState =
  | { status: "idle" }
  | { status: "loading"; selectionKey: string }
  | { status: "ready"; selectionKey: string; response: EngineProEnrichPreviewResponse }
  | { status: "error"; selectionKey: string; message: string };

type ProReferenceLookupState =
  | {
      status: "loading";
      missingFields: string[];
    }
  | {
      status: "ready";
      missingFields: string[];
      proposal: EngineProEnrichCitationProposal | null;
      message?: string;
      selectedFields: Record<string, boolean>;
      preview: ProReferencePreviewState;
      appliedSelectionKey: string | null;
      isApplying?: boolean;
    }
  | {
      status: "error";
      missingFields: string[];
      message: string;
    };

interface JobScopedEntries<T> {
  jobId: string;
  entries: Record<string, T>;
}

type BulkProStatus =
  | { status: "idle" }
  | { status: "loading"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

interface ActiveToastHandle {
  id: string;
  dismiss: () => void;
  update: (props: {
    title?: ReactNode;
    description?: ReactNode;
    variant?: "default" | "destructive";
    duration?: number;
  }) => void;
}

export default function ReferenceOutput({
  result,
  groupDuplicates = true,
  autoCheckPro = false,
  onError,
}: ReferenceOutputProps) {
  const { toast } = useToast();
  const [jobCitationUpdates, setJobCitationUpdates] = useState<JobScopedEntries<EngineProcessedCitation>>({
    jobId: result.jobId,
    entries: {},
  });
  const citationUpdates = jobCitationUpdates.jobId === result.jobId ? jobCitationUpdates.entries : {};
  const effectiveCitations = useMemo(
    () => result.references.map((citation) => citationUpdates[citation.id] ?? citation),
    [citationUpdates, result.references],
  );
  const bulkEligibleCitations = useMemo(
    () => effectiveCitations.filter(isBulkProEligibleCitation),
    [effectiveCitations],
  );
  const bulkEligibleCitationIds = useMemo(
    () => new Set(bulkEligibleCitations.map((citation) => citation.id)),
    [bulkEligibleCitations],
  );
  const basePortableReferences = useMemo(
    () => effectiveCitations.map(mapEngineCitationToPortable),
    [effectiveCitations],
  );
  const portableReferences = basePortableReferences;
  const portableById = new Map(basePortableReferences.map((reference) => [reference.id, reference]));
  const portableDuplicateGroups = groupDuplicates
    ? result.duplicateGroups
        .map((group) => mapDuplicateGroup(group, portableById))
        .filter((group): group is DuplicateGroup => Boolean(group))
    : [];
  const engineById = new Map(effectiveCitations.map((citation) => [citation.id, citation]));
  const [jobProReferenceLookups, setJobProReferenceLookups] = useState<JobScopedEntries<ProReferenceLookupState>>({
    jobId: result.jobId,
    entries: {},
  });
  const proReferenceLookups = jobProReferenceLookups.jobId === result.jobId ? jobProReferenceLookups.entries : {};
  const [jobBulkProState, setJobBulkProState] = useState<{ jobId: string; state: BulkProStatus }>({
    jobId: result.jobId,
    state: { status: "idle" },
  });
  const bulkProState = jobBulkProState.jobId === result.jobId ? jobBulkProState.state : { status: "idle" as const };
  const bulkToastRef = useRef<ActiveToastHandle | null>(null);
  const bulkScoreToastTimerRef = useRef<number | null>(null);

  const updateProReferenceLookups = (
    updater: (current: Record<string, ProReferenceLookupState>) => Record<string, ProReferenceLookupState>,
  ) => {
    setJobProReferenceLookups((current) => ({
      jobId: result.jobId,
      entries: updater(current.jobId === result.jobId ? current.entries : {}),
    }));
  };

  const updateBulkProState = (next: BulkProStatus | ((current: BulkProStatus) => BulkProStatus)) => {
    setJobBulkProState((current) => {
      const scopedCurrent = current.jobId === result.jobId ? current.state : { status: "idle" as const };
      return {
        jobId: result.jobId,
        state: typeof next === "function" ? next(scopedCurrent) : next,
      };
    });
  };

  const mergeUpdatedCitations = (updatedCitations: EngineProcessedCitation[]) => {
    if (updatedCitations.length === 0) {
      return;
    }

    setJobCitationUpdates((current) => {
      const nextEntries = {
        ...(current.jobId === result.jobId ? current.entries : {}),
      };
      for (const citation of updatedCitations) {
        nextEntries[citation.id] = citation;
      }
      return {
        jobId: result.jobId,
        entries: nextEntries,
      };
    });
  };

  const clearBulkScoreToastTimer = () => {
    if (bulkScoreToastTimerRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(bulkScoreToastTimerRef.current);
      bulkScoreToastTimerRef.current = null;
    }
  };

  const announceBulkToast = (
    title: string,
    description: string,
    variant: "default" | "destructive" = "default",
    duration = 20_000,
  ) => {
    if (bulkToastRef.current) {
      bulkToastRef.current.update({
        title,
        description,
        variant,
        duration,
      });
      return;
    }

    bulkToastRef.current = toast({
      title,
      description,
      variant,
      duration,
    }) as ActiveToastHandle;
  };

  const dismissBulkToastSoon = () => {
    if (!bulkToastRef.current || typeof window === "undefined") {
      return;
    }

    const activeToast = bulkToastRef.current;
    window.setTimeout(() => {
      activeToast.dismiss();
      if (bulkToastRef.current?.id === activeToast.id) {
        bulkToastRef.current = null;
      }
    }, 1800);
  };

  const announceReferenceToast = (
    title: string,
    description: string,
    variant: "default" | "destructive" = "default",
    duration = 8_000,
  ) => {
    toast({
      title,
      description,
      variant,
      duration,
    });
  };

  const handleReport = async (payload: ReportPayload) => {
    const citationId = payload.citationId;
    if (!citationId) {
      onError("Could not determine which citation to report.");
      return;
    }

    try {
      const extraNote = payload.categories.length > 1
        ? `Selected categories: ${payload.categories.join(", ")}`
        : "";
      const note = [extraNote, payload.userNote?.slice(0, 500) ?? ""]
        .filter(Boolean)
        .join("\n\n");

      await submitCitationReport({
        jobId: result.jobId,
        citationId,
        failureCategory: payload.categories[0] ?? "other",
        ...(note ? { userNote: note } : {}),
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to submit report");
    }
  };

  const requestPreview = async (
    citationId: string,
    proposal: EngineProEnrichCitationProposal,
    selectedFields: Record<string, boolean>,
  ) => {
    const previewFields = buildSelectedPreviewFields(proposal, selectedFields);
    if (Object.keys(previewFields).length === 0) {
      updateProReferenceLookups((current) => {
        const entry = current[citationId];
        if (!entry || entry.status !== "ready") {
          return current;
        }

        return {
          ...current,
          [citationId]: {
            ...entry,
            preview: { status: "idle" },
          },
        };
      });
      return;
    }

    const selectionKey = buildPreviewSelectionKey(previewFields);
    updateProReferenceLookups((current) => {
      const entry = current[citationId];
      if (!entry || entry.status !== "ready") {
        return current;
      }

      return {
        ...current,
        [citationId]: {
          ...entry,
          preview: { status: "loading", selectionKey },
        },
      };
    });

    try {
      const response = await requestEngineProEnrichPreview(result.jobId, {
        citationId,
        fields: previewFields,
      });
      updateProReferenceLookups((current) => {
        const entry = current[citationId];
        if (
          !entry
          || entry.status !== "ready"
          || entry.preview.status !== "loading"
          || entry.preview.selectionKey !== selectionKey
        ) {
          return current;
        }

        return {
          ...current,
          [citationId]: {
            ...entry,
            preview: {
              status: "ready",
              selectionKey,
              response,
            },
          },
        };
      });
    } catch (error) {
      updateProReferenceLookups((current) => {
        const entry = current[citationId];
        if (
          !entry
          || entry.status !== "ready"
          || entry.preview.status !== "loading"
          || entry.preview.selectionKey !== selectionKey
        ) {
          return current;
        }

        return {
          ...current,
          [citationId]: {
            ...entry,
            preview: {
              status: "error",
              selectionKey,
              message: error instanceof Error ? error.message : "Failed to generate a corrected reference preview.",
            },
          },
        };
      });
    }
  };

  const handleProLookup = async (citationId: string) => {
    const citation = engineById.get(citationId);
    const missingFields = citation ? getMissingFields(citation) : [];

    updateProReferenceLookups((current) => {
      if (current[citationId]?.status === "loading") {
        return current;
      }

      return {
        ...current,
        [citationId]: {
          status: "loading",
          missingFields,
        },
      };
    });

    try {
      const response = await requestEngineProEnrich(result.jobId, [citationId]);
      const citationProposal = response.proposals.find((proposal) => proposal.citationId === citationId) ?? null;

      if (!citationProposal || citationProposal.fields.length === 0) {
        updateProReferenceLookups((current) => ({
          ...current,
          [citationId]: {
            status: "ready",
            missingFields,
            proposal: null,
            message: "Pro searched all supported fields but did not find a stronger correction for this citation yet.",
            selectedFields: {},
            preview: { status: "idle" },
            appliedSelectionKey: null,
          },
        }));
        return;
      }

      const appliedSelectedFields = citation
        ? buildAppliedSelectedFields(citation, citationProposal.fields)
        : {};
      const hasAppliedSelection = Object.values(appliedSelectedFields).some(Boolean);
      const selectedFields = hasAppliedSelection
        ? appliedSelectedFields
        : buildDefaultSelectedFields(citationProposal.fields);
      const appliedSelectionKey = hasAppliedSelection
        ? buildSelectionKeyFromProposal(citationProposal, appliedSelectedFields)
        : null;
      updateProReferenceLookups((current) => ({
        ...current,
        [citationId]: {
          status: "ready",
          missingFields,
          proposal: citationProposal,
          selectedFields,
          preview: { status: "idle" },
          appliedSelectionKey,
        },
      }));

      await requestPreview(citationId, citationProposal, selectedFields);
    } catch (error) {
      updateProReferenceLookups((current) => ({
        ...current,
        [citationId]: {
          status: "error",
          missingFields,
          message: error instanceof Error ? error.message : "Failed to search this citation with Pro.",
        },
      }));
    }
  };

  const commitSelectedOverlay = async (
    citationId: string,
    selectedFields: Record<string, boolean>,
  ) => {
    const current = proReferenceLookups[citationId];
    if (!current || current.status !== "ready" || !current.proposal) {
      return;
    }

    const overlayFields = buildSelectedPreviewFields(current.proposal, selectedFields);
    const selectionKey = Object.keys(overlayFields).length > 0
      ? buildPreviewSelectionKey(overlayFields)
      : null;

    updateProReferenceLookups((existing) => ({
      ...existing,
      [citationId]: {
        ...current,
        selectedFields,
        isApplying: true,
      },
    }));

    try {
      const selectedFieldCount = Object.keys(overlayFields).length;
      announceReferenceToast(
        selectedFieldCount === 0
          ? "Pro: restoring original reference"
          : "Pro: applying corrected reference",
        selectedFieldCount === 0
          ? "Removing accepted Pro overlays and restoring the original engine output."
          : `Saving ${selectedFieldCount} selected Pro field${selectedFieldCount === 1 ? "" : "s"} as the live reference, then recomputing confidence and readiness.`,
        "default",
        15_000,
      );
      const response = await requestEngineProEnrichApply(result.jobId, {
        overlays: [
          {
            citationId,
            fields: overlayFields,
          },
        ],
      });
      mergeUpdatedCitations(response.updatedCitations);
      updateProReferenceLookups((existing) => {
        const entry = existing[citationId];
        if (!entry || entry.status !== "ready") {
          return existing;
        }

        return {
          ...existing,
          [citationId]: {
            ...entry,
            selectedFields,
            appliedSelectionKey: selectionKey,
            isApplying: false,
            preview: selectionKey ? entry.preview : { status: "idle" },
          },
        };
      });
      const updatedCitation = response.updatedCitations[0];
      announceReferenceToast(
        selectionKey ? "Pro: corrected reference saved" : "Pro: original reference restored",
        updatedCitation
          ? `Output is now ${updatedCitation.publicStatus.replace(/_/g, " ")} with score ${Math.round(updatedCitation.rawScore)}/100.`
          : "The live reference was updated successfully.",
      );
    } catch (error) {
      updateProReferenceLookups((existing) => {
        const entry = existing[citationId];
        if (!entry || entry.status !== "ready") {
          return existing;
        }

        return {
          ...existing,
          [citationId]: {
            ...entry,
            isApplying: false,
            preview: entry.preview.status === "error"
              ? entry.preview
              : {
                  status: "error",
                  selectionKey: buildPreviewSelectionKey(overlayFields),
                  message: error instanceof Error ? error.message : "Failed to apply the corrected reference.",
                },
          },
        };
      });
      announceReferenceToast(
        "Pro: reference update failed",
        error instanceof Error ? error.message : "Failed to apply the corrected reference.",
        "destructive",
        15_000,
      );
      onError(error instanceof Error ? error.message : "Failed to apply the corrected reference.");
    }
  };

  const toggleProFieldSelection = (citationId: string, field: string) => {
    const current = proReferenceLookups[citationId];
    if (!current || current.status !== "ready" || !current.proposal) {
      return;
    }

    const nextSelectedFields = {
      ...current.selectedFields,
      [field]: !current.selectedFields[field],
    };

    updateProReferenceLookups((existing) => ({
      ...existing,
      [citationId]: {
        ...current,
        selectedFields: nextSelectedFields,
      },
    }));

    void requestPreview(citationId, current.proposal, nextSelectedFields);
  };

  const setProFieldSelectionMode = (
    citationId: string,
    mode: "all" | "fills" | "none",
  ) => {
    const current = proReferenceLookups[citationId];
    if (!current || current.status !== "ready" || !current.proposal) {
      return;
    }

    const nextSelectedFields =
      mode === "all"
        ? buildDefaultSelectedFields(current.proposal.fields)
        : mode === "fills"
          ? buildMissingOnlySelectedFields(current.proposal.fields)
          : buildClearedSelectedFields(current.proposal.fields);

    updateProReferenceLookups((existing) => ({
      ...existing,
      [citationId]: {
        ...current,
        selectedFields: nextSelectedFields,
      },
    }));

    void requestPreview(citationId, current.proposal, nextSelectedFields);
  };

  const handleDynamicProAction = async (citationId: string) => {
    const current = proReferenceLookups[citationId];
    if (!current || current.status !== "ready" || !current.proposal) {
      return;
    }

    const currentSelectionKey = buildSelectionKeyFromProposal(current.proposal, current.selectedFields);
    if (current.appliedSelectionKey && !currentSelectionKey) {
      await commitSelectedOverlay(citationId, current.selectedFields);
      return;
    }

    if (current.appliedSelectionKey && current.appliedSelectionKey === currentSelectionKey) {
      const clearedSelection = buildClearedSelectedFields(current.proposal.fields);
      await commitSelectedOverlay(citationId, clearedSelection);
      return;
    }

    await commitSelectedOverlay(citationId, current.selectedFields);
  };

  const handleBulkCheckWithPro = async () => {
    if (bulkEligibleCitations.length === 0) {
      return;
    }

    updateBulkProState({
      status: "loading",
      message: "Checking only references that still need review or action, then applying the strongest available corrections.",
    });
    announceBulkToast(
      "Pro: checking authoritative metadata",
      `Scanning ${bulkEligibleCitations.length} reference${bulkEligibleCitations.length === 1 ? "" : "s"} that still need review or action.`,
    );

    try {
      const response = await requestEngineProEnrich(
        result.jobId,
        bulkEligibleCitations.map((citation) => citation.id),
      );
      const proposals = response.proposals.filter((proposal) => proposal.fields.length > 0);

      if (proposals.length === 0) {
        updateBulkProState({
          status: "success",
          message: "Pro checked the review/action references but did not find stronger metadata to apply.",
        });
        announceBulkToast(
          "Pro: no stronger metadata found",
          "The review/action check completed, but there were no fields worth filling or replacing.",
        );
        dismissBulkToastSoon();
        return;
      }

      const overlayFieldCount = proposals.reduce((sum, proposal) => sum + proposal.fields.length, 0);
      announceBulkToast(
        "Pro: filling and replacing fields",
        `Applying ${overlayFieldCount} field update${overlayFieldCount === 1 ? "" : "s"} across ${proposals.length} reference${proposals.length === 1 ? "" : "s"}.`,
      );

      const lookupEntries: Record<string, ProReferenceLookupState> = {};
      const overlays = proposals.map((proposal) => {
        const selectedFields = buildDefaultSelectedFields(proposal.fields);
        const currentCitation = engineById.get(proposal.citationId);
        lookupEntries[proposal.citationId] = {
          status: "ready",
          missingFields: currentCitation ? getMissingFields(currentCitation) : [],
          proposal,
          selectedFields,
          preview: { status: "idle" },
          appliedSelectionKey: null,
          isApplying: true,
        };

        return {
          citationId: proposal.citationId,
          fields: buildSelectedPreviewFields(proposal, selectedFields),
        };
      });

      updateProReferenceLookups((current) => ({
        ...current,
        ...lookupEntries,
      }));

      clearBulkScoreToastTimer();
      if (typeof window !== "undefined") {
        bulkScoreToastTimerRef.current = window.setTimeout(() => {
          announceBulkToast(
            "Pro: updating confidence and readiness",
            `Recomputing health, readiness, and output scores for ${proposals.length} corrected reference${proposals.length === 1 ? "" : "s"}.`,
          );
          bulkScoreToastTimerRef.current = null;
        }, 250);
      }

      const applyResponse = await requestEngineProEnrichApply(result.jobId, {
        overlays,
      });
      clearBulkScoreToastTimer();
      mergeUpdatedCitations(applyResponse.updatedCitations);
      updateProReferenceLookups((current) => {
        const next = { ...current };
        for (const proposal of proposals) {
          const entry = next[proposal.citationId];
          if (!entry || entry.status !== "ready") {
            continue;
          }

          next[proposal.citationId] = {
            ...entry,
            isApplying: false,
            appliedSelectionKey: buildSelectionKeyFromProposal(proposal, entry.selectedFields),
          };
        }
        return next;
      });

      updateBulkProState({
        status: "success",
        message: `Applied ${applyResponse.appliedFieldCount} Pro field update${applyResponse.appliedFieldCount === 1 ? "" : "s"} across ${applyResponse.updatedCitations.length} reference${applyResponse.updatedCitations.length === 1 ? "" : "s"}.`,
      });
      announceBulkToast(
        "Pro: batch correction complete",
        `Saved ${applyResponse.appliedFieldCount} field update${applyResponse.appliedFieldCount === 1 ? "" : "s"}, refreshed confidence, and updated the live output.`,
      );
      dismissBulkToastSoon();
    } catch (error) {
      clearBulkScoreToastTimer();
      updateBulkProState({
        status: "error",
        message: error instanceof Error ? error.message : "Bulk Pro check failed.",
      });
      updateProReferenceLookups((current) => {
        const next = { ...current };
        for (const [citationId, lookup] of Object.entries(next)) {
          if (lookup.status === "ready" && lookup.isApplying) {
            next[citationId] = {
              ...lookup,
              isApplying: false,
            };
          }
        }
        return next;
      });
      announceBulkToast(
        "Pro: batch correction failed",
        error instanceof Error ? error.message : "Bulk Pro check failed.",
        "destructive",
      );
      onError(error instanceof Error ? error.message : "Bulk Pro check failed.");
    }
  };

  // Pro auto-check: when the toggle is on, run the bulk check once per conversion result for every
  // reference still flagged needs_review / needs_action, then auto-apply the confident fixes. Fires
  // once per jobId (so re-renders / status changes don't re-trigger it) and never while one is running.
  const autoCheckedJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoCheckPro) return;
    if (autoCheckedJobIdRef.current === result.jobId) return;
    if (bulkEligibleCitations.length === 0) return;
    if (bulkProState.status === "loading") return;
    autoCheckedJobIdRef.current = result.jobId;
    void handleBulkCheckWithPro();
    // handleBulkCheckWithPro closes over current state and is re-created each render; we intentionally
    // gate on jobId via the ref rather than depending on the callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckPro, result.jobId, bulkEligibleCitations.length, bulkProState.status]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-[#0b1530]">Pro batch repair</p>
            <p className="text-xs leading-5 text-slate-600">
              Bulk check scans only references marked needs review or needs action, replaces weaker fields when stronger metadata is found, and reruns health and score on the saved citation.
            </p>
            <p className="text-xs text-slate-500">
              {bulkEligibleCitations.length} of {effectiveCitations.length} reference{effectiveCitations.length === 1 ? "" : "s"} currently need Pro review.
            </p>
            {bulkProState.status !== "idle" ? (
              <p
                className={`text-xs ${
                  bulkProState.status === "error"
                    ? "text-rose-700"
                    : bulkProState.status === "loading"
                      ? "text-sky-700"
                      : "text-emerald-700"
                }`}
              >
                {bulkProState.message}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            size="sm"
            className="bg-[#002147] text-white hover:bg-[#001730]"
            disabled={bulkProState.status === "loading" || bulkEligibleCitations.length === 0}
            onClick={() => void handleBulkCheckWithPro()}
          >
            {bulkProState.status === "loading"
              ? "Checking batch with Pro..."
              : bulkEligibleCitations.length === 0
                ? "No review/action references"
                : "Bulk check with Pro"}
          </Button>
        </div>
      </section>

      <PortableOutput
        convertedReferences={portableReferences}
        duplicateGroups={portableDuplicateGroups}
        engineVersion="v3"
        groupDuplicates={groupDuplicates}
        isPro
        onError={onError}
        onReport={handleReport}
        renderExtractedFields={(reference) => {
          const citation = engineById.get(reference.id);
          return citation ? <ExtractedFieldsPanel citation={citation} /> : null;
        }}
        renderReferenceInsights={(reference) => {
          const citation = engineById.get(reference.id);
          if (!citation) return null;
          const lookup = proReferenceLookups[reference.id];
          if (!bulkEligibleCitationIds.has(reference.id) && !lookup) return null;

          return (
            <ProReferenceAssistCallout
              citation={citation}
              reference={reference}
              lookup={lookup}
              onLookup={() => void handleProLookup(reference.id)}
              onToggleField={(field) => toggleProFieldSelection(reference.id, field)}
              onSelectAll={() => setProFieldSelectionMode(reference.id, "all")}
              onSelectMissing={() => setProFieldSelectionMode(reference.id, "fills")}
              onClearSelection={() => setProFieldSelectionMode(reference.id, "none")}
              onAction={() => void handleDynamicProAction(reference.id)}
            />
          );
        }}
      />
    </div>
  );
}

function ExtractionRepairPath({ citation }: { citation: EngineProcessedCitation }) {
  const phase4 = describePhase4ExtractionPath(citation);
  const phase65 = describePhase65LlmPath(citation.stageLog);

  return (
    <div className="rounded-xl border border-primary-container/15 bg-primary-container/5 px-3 py-3 dark:bg-slate-900/40">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-primary-container dark:text-blue-300">
        Extraction and repair path
      </div>
      <ul className="space-y-2 text-xs text-on-surface dark:text-slate-200">
        <li>
          <span className="font-semibold text-on-surface-variant dark:text-slate-400">Phase 4 (fields): </span>
          {phase4}
        </li>
        {citation.extractionMeta?.mlError ? (
          <li className="text-amber-700 dark:text-amber-300">
            ML service note: {citation.extractionMeta.mlError.message} ({citation.extractionMeta.mlError.code})
          </li>
        ) : null}
        <li>
          <span className="font-semibold text-on-surface-variant dark:text-slate-400">Phase 6.5 (repair): </span>
          {phase65}
        </li>
      </ul>
    </div>
  );
}

function describePhase4ExtractionPath(citation: EngineProcessedCitation): string {
  if (citation.doiFastPath) {
    return "DOI fast path — metadata from resolution; Phase 4 ML/heuristic extraction was not used.";
  }
  const meta = citation.extractionMeta;
  if (!meta) {
    return "No Phase 4 extraction record on this citation (unusual; fields may still be valid).";
  }
  switch (meta.runMode) {
    case "ml":
      return "ML extraction service produced the primary field values.";
    case "shadow":
      return "Shadow mode — ML ran for comparison; displayed fields follow heuristics.";
    case "heuristic":
      return "Heuristic extraction — ML was not used for the visible field values (fallback or routing).";
    default:
      return `runMode: ${String((meta as { runMode?: string }).runMode)}`;
  }
}

const GUARANTEED_SCORING_STYLES = new Set([
  "apa7",
  "mla9",
  "chicago-author-date",
  "vancouver",
  "ieee",
  "harvard-ctr",
]);

function resolveScoreWeightsForTooltip(style: string): { field: number; format: number; structural: number } {
  if (GUARANTEED_SCORING_STYLES.has(style)) {
    return { field: 0.4, format: 0.35, structural: 0.25 };
  }
  return { field: 0.4, format: 0.25, structural: 0.35 };
}

function pct01(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function describePhase65LlmPath(stageLog: EngineStageRunRecord[]): string {
  const entry = stageLog.find((e) => e.phaseId === "llm_fallback");
  if (!entry) {
    return "Not applied — missing/low-confidence fields did not trigger repair for this citation.";
  }
  const src = entry.details?.source;
  if (src === "llm") {
    return "Repairs applied via the LLM (OpenAI) for missing or weak fields.";
  }
  if (src === "heuristic") {
    return "Repairs applied via heuristics (LLM unavailable or returned low confidence).";
  }
  return entry.message ?? "Repair step ran; see stage trace below.";
}

function ExtractedFieldsPanel({ citation }: { citation: EngineProcessedCitation }) {
  const fieldRows = buildFieldRows(citation);
  const scoreRows = buildScoreRows(citation);
  const penalties = citation.scoreBreakdown.penalties;
  const cleanupSummary = citation.inputCleanup ? describeInputCleanup(citation.inputCleanup) : null;

  return (
    <div className="mb-4">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <ChevronDown className="mr-2 h-3 w-3" />
            View extracted fields
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3">
          <ExtractionRepairPath citation={citation} />

          {cleanupSummary ? (
            <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/70 px-3 py-3 dark:bg-slate-950/50">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-outline dark:text-slate-500">
                PDF-Copy Cleanup
              </div>
              <div className="text-xs text-on-surface-variant dark:text-slate-300">
                {cleanupSummary}
              </div>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            {fieldRows.map((row) => (
              <div
                key={row.label}
                className="rounded-xl border border-outline-variant/10 bg-surface-container-low/70 px-3 py-3 dark:bg-slate-950/50"
              >
                <div className="mb-1 text-[10px] font-semibold text-outline dark:text-slate-500">
                  {row.label}
                </div>
                <div className="break-words text-sm text-on-surface dark:text-slate-200">
                  {row.value}
                </div>
              </div>
            ))}
          </div>

          <TooltipProvider delayDuration={200}>
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low/70 px-3 py-3 dark:bg-slate-950/50">
              <div className="mb-2 text-[10px] font-semibold text-outline dark:text-slate-500">
                Quality Score
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {scoreRows.map((row) => (
                  <Tooltip key={row.label}>
                    <TooltipTrigger asChild>
                      <div className="cursor-help rounded-lg border border-outline-variant/10 bg-surface px-3 py-2 transition-colors hover:border-primary/20 dark:bg-slate-900/70">
                        <div className="text-[10px] font-semibold text-outline dark:text-slate-500">
                          {row.label}
                        </div>
                        <div className="mt-1 text-sm text-on-surface dark:text-slate-200">
                          {row.value}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="center"
                      className="max-w-xs whitespace-pre-wrap border-outline-variant/30 bg-popover px-3 py-2 text-left text-xs leading-relaxed text-popover-foreground"
                    >
                      {row.tooltip}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
              {penalties.length > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="mt-3 cursor-help rounded-lg border border-outline-variant/10 bg-surface px-3 py-3 transition-colors hover:border-primary/20 dark:bg-slate-900/70">
                      <div className="mb-2 text-[10px] font-semibold text-outline dark:text-slate-500">
                        Applied Penalties
                      </div>
                      <ul className="space-y-1 text-xs text-on-surface-variant dark:text-slate-400">
                        {penalties.map((penalty) => (
                          <li key={penalty.code}>
                            {humanizePenaltyCode(penalty.code)} • -{penalty.points}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="center"
                    className="max-w-xs whitespace-pre-wrap border-outline-variant/30 bg-popover px-3 py-2 text-left text-xs leading-relaxed text-popover-foreground"
                  >
                    {`Penalty points are subtracted from the weighted score.\nTotal: −${penalties.reduce((s, p) => s + p.points, 0)} pts\n\n${penalties.map((p) => `${humanizePenaltyCode(p.code)}: −${p.points} pts`).join("\n")}`}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </TooltipProvider>

          {citation.authorityFlags.length > 0 && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3">
              <div className="mb-2 text-[10px] font-semibold text-red-200">
                Authority Flags
              </div>
              <ul className="space-y-1 text-xs text-red-100">
                {citation.authorityFlags.map((flag, index) => (
                  <li key={`${flag.type}-${index}`}>
                    {flag.type.replace(/_/g, " ")} • {flag.source}
                    {flag.details ? ` • ${flag.details}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low/70 px-3 py-3 dark:bg-slate-950/50">
            <div className="mb-2 text-[10px] font-semibold text-outline dark:text-slate-500">
              Stage Trace
            </div>
            <div className="space-y-2">
              {citation.stageLog.length > 0 ? (
                citation.stageLog.map((entry) => (
                  <div
                    key={`${citation.id}-${entry.stageId}-${entry.phaseId}`}
                    className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant dark:text-slate-400"
                  >
                    <span className="font-semibold text-on-surface dark:text-slate-200">
                      {entry.phaseId.replace(/_/g, " ")}
                    </span>
                    <span className="rounded-full bg-surface-container px-2 py-0.5 uppercase tracking-wide">
                      {entry.status}
                    </span>
                    <span>{entry.durationMs}ms</span>
                    {entry.message && <span>• {entry.message}</span>}
                  </div>
                ))
              ) : (
                <div className="text-xs text-on-surface-variant dark:text-slate-400">
                  No stage diagnostics were emitted for this citation.
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function mapEngineCitationToPortable(citation: EngineProcessedCitation): ConvertedReference {
  return {
    id: citation.id,
    originalText: citation.raw,
    convertedText: citation.renderedText || citation.raw,
    inputStyle: mapEngineStyleToShared(citation.detectedStyle),
    outputStyle: mapEngineStyleToShared(citation.effectiveStyle),
    effectiveStyle: citation.effectiveStyle,
    referenceType: mapEngineReferenceTypeToShared(citation.referenceType),
    parsedData: mapParsedData(citation),
    confidence: {
      score: citation.rawScore,
    },
    styleDetectionFailed: citation.effectiveStyle === "unknown" || citation.effectiveStyle === "auto",
    inputStyleUncertain: citation.inputStyleUncertain,
    doiVerificationStatus: citation.doiVerification.status,
    warnings: [
      ...citation.renderedWarnings,
      ...citation.healthWarnings.map((warning) => `${warning.severity}: ${warning.code}`),
    ],
    healthState: mapHealthState(citation.publicStatus),
    healthReasons: citation.healthReasons?.length > 0 ? citation.healthReasons : buildHealthReasons(citation),
    assertionSummary: buildAssertionSummary(citation),
    reportEngineSnapshot: {
      engineVersion: "v3",
      extractorPath: citation.stageLog.map((entry) => entry.stageId).join(" -> ") || undefined,
      stageLogSummary: citation.stageLog.map((entry) => ({
        stageId: entry.stageId,
        status:
          entry.status === "error"
            ? "error"
            : entry.status === "warning"
              ? "warning"
              : "info",
        message: entry.message ?? `${entry.phaseId} ${entry.status}`,
        code: entry.code,
      })),
      processingPath: {
        partialResult: citation.publicStatus !== "ready",
        stagesRun: citation.stageLog.map((entry) => entry.stageId),
        fallbacksUsed: [],
        partialReasons: citation.healthReasons?.length > 0 ? citation.healthReasons : citation.renderedWarnings,
      },
      validationCodes: citation.stageLog
        .map((entry) => entry.code)
        .filter((code): code is string => Boolean(code)),
      qualityFlags: [
        ...citation.renderedWarnings,
        ...citation.healthWarnings.map((warning) => warning.code),
      ],
      splitContaminationFlags: [],
    },
  };
}

function buildHealthReasons(citation: EngineProcessedCitation) {
  const reasons = new Set<string>();

  for (const missingField of getMissingFields(citation)) {
    reasons.add(`Missing ${missingField}`);
  }

  for (const warning of citation.renderedWarnings) {
    reasons.add(humanizeWarning(warning));
  }

  if (citation.publicStatus === "ready" && reasons.size === 0) {
    reasons.add("All core citation details were found.");
  }

  return [...reasons];
}

function getMissingFields(citation: EngineProcessedCitation) {
  const missing = new Set<string>();
  const referenceType = mapEngineReferenceTypeToShared(citation.referenceType);
  const hasAuthors = (citation.fields.authors?.value?.length ?? 0) > 0;
  const hasTitle = Boolean(stringOrUndefined(citation.fields.title?.value));
  const hasYear = Boolean(citation.fields.year?.value);
  const hasVenue = Boolean(
    stringOrUndefined(citation.fields.journal?.value)
    || stringOrUndefined(citation.fields.conferenceTitle?.value)
    || stringOrUndefined(citation.fields.bookTitle?.value)
    || stringOrUndefined(citation.fields.siteName?.value),
  );
  const hasPublisher = Boolean(stringOrUndefined(citation.fields.publisher?.value));
  const hasInstitution = Boolean(stringOrUndefined(citation.fields.institution?.value));
  const hasLocator = Boolean(
    stringOrUndefined(citation.fields.pages?.value)
    || stringOrUndefined(citation.fields.articleNumber?.value)
    || stringOrUndefined(citation.fields.reportNumber?.value),
  );
  const hasDoi = Boolean(stringOrUndefined(citation.fields.doi?.value));
  const hasUrl = Boolean(stringOrUndefined(citation.fields.url?.value));
  const hasVolume = Boolean(stringOrUndefined(citation.fields.volume?.value));

  if (!hasAuthors && referenceType !== "website") missing.add("author");
  if (!hasTitle) missing.add("title");
  if (!hasYear && referenceType !== "website") missing.add("year");

  if (referenceType === "journal" || referenceType === "conference") {
    if (!hasVenue) missing.add("venue");
  }

  if (referenceType === "book" && !hasPublisher) missing.add("publisher");
  if (referenceType === "thesis" && !hasInstitution) missing.add("institution");
  if (referenceType === "website" && !hasUrl) missing.add("URL");
  if (referenceType === "journal" && !hasVolume && !hasDoi) missing.add("volume");
  if ((referenceType === "journal" || referenceType === "conference" || referenceType === "bookChapter") && !hasLocator) {
    if (!(referenceType === "journal" && hasDoi && !hasVolume)) {
      missing.add("locator");
    }
  }

  return [...missing];
}

function buildAssertionSummary(citation: EngineProcessedCitation): AssertionSummary {
  const checks = [
    { id: "rendered-text", description: "Rendered citation text is present.", passed: Boolean(citation.renderedText.trim()), severity: "error" as const },
    { id: "authors", description: "Author information is present.", passed: (citation.fields.authors?.value?.length ?? 0) > 0 || mapEngineReferenceTypeToShared(citation.referenceType) === "website", severity: "error" as const },
    { id: "title", description: "Title is present.", passed: Boolean(stringOrUndefined(citation.fields.title?.value)), severity: "error" as const },
    { id: "year", description: "Year is present.", passed: Boolean(citation.fields.year?.value) || mapEngineReferenceTypeToShared(citation.referenceType) === "website", severity: "warning" as const },
    { id: "venue", description: "Venue or source is present when applicable.", passed: hasVenueForRules(citation), severity: "warning" as const },
    { id: "locator", description: "Locator is present when applicable.", passed: hasLocatorForRules(citation), severity: "warning" as const },
    { id: "identifier", description: "DOI or URL is available when present in the source.", passed: hasIdentifierForRules(citation), severity: "warning" as const },
    { id: "style-detection", description: "Effective output style was resolved.", passed: citation.effectiveStyle !== "unknown" && citation.effectiveStyle !== "auto", severity: "warning" as const },
    { id: "warnings", description: "No blocking render warnings remain.", passed: citation.renderedWarnings.length === 0, severity: "error" as const },
    { id: "status", description: "Citation is not blocked for manual repair.", passed: citation.publicStatus !== "needs_action", severity: "error" as const },
  ];

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.length - passed;
  const failedCritical = checks.filter((check) => !check.passed && check.severity === "error").length;

  return {
    total: checks.length,
    passed,
    failed,
    failedCritical,
    details: checks,
  };
}

function mapDuplicateGroup(
  group: EngineDuplicateGroup,
  referencesById: Map<string, ConvertedReference>,
): DuplicateGroup | null {
  const members = group.memberIds
    .map((memberId) => referencesById.get(memberId))
    .filter((reference): reference is ConvertedReference => Boolean(reference));

  if (members.length < 2) {
    return null;
  }

  return {
    groupId: group.groupId,
    primaryId: group.primaryId,
    members,
    method: group.method,
  };
}

function mapParsedData(citation: EngineProcessedCitation): ParsedReference {
  return {
    authors: citation.fields.authors?.value?.map((author) => (
      author.literal
        ? author.literal
        : { given: author.given ?? undefined, family: author.family ?? undefined }
    )),
    title: stringOrUndefined(citation.fields.title?.value),
    year: numberOrStringOrUndefined(citation.fields.year?.value),
    journal: stringOrUndefined(citation.fields.journal?.value),
    conferenceTitle: stringOrUndefined(citation.fields.conferenceTitle?.value),
    bookTitle: stringOrUndefined(citation.fields.bookTitle?.value),
    publisher: stringOrUndefined(citation.fields.publisher?.value),
    institution: stringOrUndefined(citation.fields.institution?.value),
    volume: stringOrUndefined(citation.fields.volume?.value),
    issue: stringOrUndefined(citation.fields.issue?.value),
    pages: stringOrUndefined(citation.fields.pages?.value),
    url: stringOrUndefined(citation.fields.url?.value),
    editor: undefined,
    ["article-number"]: stringOrUndefined(citation.fields.articleNumber?.value),
  };
}

function hasVenueForRules(citation: EngineProcessedCitation) {
  const referenceType = mapEngineReferenceTypeToShared(citation.referenceType);
  if (referenceType === "website") return true;
  return Boolean(
    stringOrUndefined(citation.fields.journal?.value)
    || stringOrUndefined(citation.fields.conferenceTitle?.value)
    || stringOrUndefined(citation.fields.bookTitle?.value)
    || stringOrUndefined(citation.fields.siteName?.value)
    || stringOrUndefined(citation.fields.publisher?.value),
  );
}

function hasLocatorForRules(citation: EngineProcessedCitation) {
  const referenceType = mapEngineReferenceTypeToShared(citation.referenceType);
  if (!["journal", "conference", "bookChapter"].includes(referenceType)) {
    return true;
  }

  const hasOnlineFirstDoiFallback = referenceType === "journal"
    && Boolean(stringOrUndefined(citation.fields.doi?.value))
    && !stringOrUndefined(citation.fields.volume?.value);
  if (hasOnlineFirstDoiFallback) {
    return true;
  }

  return Boolean(
    stringOrUndefined(citation.fields.pages?.value)
    || stringOrUndefined(citation.fields.articleNumber?.value)
    || stringOrUndefined(citation.fields.reportNumber?.value),
  );
}

function hasIdentifierForRules(citation: EngineProcessedCitation) {
  const hasVerifiedDoi = citation.doiVerification.status === "verified"
    && Boolean(stringOrUndefined(citation.fields.doi?.value));
  const rawUrl = stringOrUndefined(citation.fields.url?.value);
  const hasRenderableUrl = Boolean(
    rawUrl
    && (!/doi\.org\//i.test(rawUrl) || citation.doiVerification.status === "verified"),
  );
  return Boolean(
    hasVerifiedDoi
    || hasRenderableUrl
    || !/doi|https?:\/\//i.test(citation.raw),
  );
}

function humanizeWarning(warning: string) {
  const normalized = warning.replace(/^(warning|error):\s*/i, "").trim();

  if (/missing[_\s-]?author/i.test(normalized)) return "Missing author";
  if (/missing[_\s-]?year/i.test(normalized)) return "Missing year";
  if (/missing[_\s-]?title/i.test(normalized)) return "Missing title";
  if (/missing[_\s-]?(journal|venue)/i.test(normalized)) return "Missing venue / journal";
  if (/missing[_\s-]?(page|locator|article)/i.test(normalized)) return "Missing locator";
  if (/missing[_\s-]?publisher/i.test(normalized)) return "Missing publisher";
  if (/authority[_\s-]?unconfirmed|no[_\s-]?match/i.test(normalized)) return "Could not confirm against external source";
  if (/style[_\s-]?detection/i.test(normalized)) return "Citation style detection needs review";

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function mapHealthState(status: EngineProcessedCitation["publicStatus"]) {
  if (status === "needs_action") return "action_needed";
  if (status === "needs_review") return "review";
  return "clean";
}

function buildFieldRows(citation: EngineProcessedCitation) {
  const authors = readAuthorList(citation);
  const venueOrJournal = readFieldValue(
    citation.fields.journal?.value
      ?? citation.fields.conferenceTitle?.value
      ?? citation.fields.bookTitle?.value
      ?? citation.fields.siteName?.value
      ?? citation.fields.publisher?.value,
  );
  const locator = readFieldValue(
    citation.fields.pages?.value
      ?? citation.fields.articleNumber?.value
      ?? citation.fields.reportNumber?.value,
  );

  return [
    { label: "Authors", value: authors || "Not resolved" },
    { label: "Title", value: readFieldValue(citation.fields.title?.value) },
    { label: "Year", value: readFieldValue(citation.fields.year?.value) },
    { label: "Output latency", value: `${citation.outputLatencyMs} ms` },
    { label: "Venue / Journal", value: venueOrJournal },
    { label: "Volume / Issue", value: joinParts(readFieldValue(citation.fields.volume?.value), readFieldValue(citation.fields.issue?.value)) },
    { label: "Locator", value: locator },
    { label: "DOI / URL", value: joinParts(readFieldValue(citation.fields.doi?.value), readFieldValue(citation.fields.url?.value)) },
    { label: "Publisher / Institution", value: joinParts(readFieldValue(citation.fields.publisher?.value), readFieldValue(citation.fields.institution?.value)) },
  ].filter((row) => row.value !== "Not available");
}

function buildScoreRows(citation: EngineProcessedCitation) {
  const b = citation.scoreBreakdown;
  const w = resolveScoreWeightsForTooltip(citation.effectiveStyle);
  const penaltyTotal = b.penalties.reduce((sum, p) => sum + p.points, 0);
  const fieldPts = 100 * w.field * b.fieldEvidenceScore;
  const formatPts = 100 * w.format * b.formatCorrectnessScore;
  const structPts = 100 * w.structural * b.structuralIntegrityScore;
  const blended = fieldPts + formatPts + structPts;

  const fmtSubs = b.formatSubscores;
  const semSubs = b.semanticSegmentSubscores;
  const cosmeticSubs = b.cosmeticSubscores;
  const stSubs = b.structuralSubscores;

  const fmtValues = [
    fmtSubs.authorFormatScore,
    fmtSubs.titleCaseScore,
    fmtSubs.punctuationScore,
    fmtSubs.fieldOrderScore,
    fmtSubs.spacingScore,
    fmtSubs.noDuplicatePunctScore,
    fmtSubs.containerFormatScore,
  ];
  const fmtLabels = [
    "Author format",
    "Title case",
    "Punctuation",
    "Field order",
    "Spacing",
    "No duplicate punct",
    "Container format",
  ];
  const fmtBreakdown = fmtLabels.map((l, i) => `  ${l}: ${pct01(fmtValues[i])}`);
  const fmtWeak = fmtLabels.filter((_, i) => fmtValues[i] < 0.72).map((l, i) => {
    const idx = fmtLabels.indexOf(l);
    return `  ✗ ${l}: ${pct01(fmtValues[idx])}`;
  });

  const semValues = [
    semSubs.authorScore,
    semSubs.titleScore,
    semSubs.yearScore,
    semSubs.containerScore,
    semSubs.locatorOrIdentifierScore,
  ];
  const semLabels = [
    "Authors",
    "Title",
    "Year",
    "Container",
    "Locator / identifier",
  ];
  const semBreakdown = semLabels.map((label, index) => `  ${label}: ${pct01(semValues[index])}`);

  const cosmeticValues = [
    cosmeticSubs.titleCaseScore,
    cosmeticSubs.spacingScore,
    cosmeticSubs.noDuplicatePunctScore,
    cosmeticSubs.punctuationScore,
  ];
  const cosmeticLabels = [
    "Title case",
    "Spacing",
    "No duplicate punctuation",
    "Punctuation sanity",
  ];
  const cosmeticBreakdown = cosmeticLabels.map((label, index) => `  ${label}: ${pct01(cosmeticValues[index])}`);

  const stValues = [
    stSubs.refTypeConfidenceScore,
    stSubs.noDuplicateFieldsScore,
    stSubs.noArtifactTokensScore,
    stSubs.noCorruptedContainerScore,
    stSubs.fieldBoundaryScore,
    stSubs.noDuplicateAuthorScore,
    stSubs.locatorConsistencyScore,
  ];
  const stLabels = [
    "Ref-type confidence",
    "No duplicate fields",
    "No artifact tokens",
    "No corrupted container",
    "Field boundaries",
    "No duplicate authors",
    "Locator consistency",
  ];
  const stBreakdown = stLabels.map((l, i) => `  ${l}: ${pct01(stValues[i])}`);
  const stWeak = stLabels.filter((_, i) => stValues[i] < 0.72).map((l) => {
    const idx = stLabels.indexOf(l);
    return `  ✗ ${l}: ${pct01(stValues[idx])}`;
  });
  const stAvg = stValues.reduce((s, v) => s + v, 0) / stValues.length;

  const missing = [...citation.healthBreakdown.missingMandatory];
  const invalid = [...citation.healthBreakdown.invalidMandatory];
  const lowConf = [...citation.healthBreakdown.lowConfidenceMandatory];
  const present = [...citation.healthBreakdown.presentMandatory];
  const totalMandatory = present.length + missing.length + invalid.length;

  return [
    {
      label: "Raw Score",
      value: `${citation.rawScore}%`,
      tooltip: [
        `Weighted sum of 3 components minus penalties, clamped 0–100.`,
        ``,
        `Field evidence (${pct01(b.fieldEvidenceScore)}) × ${(w.field * 100).toFixed(0)}% = ${fieldPts.toFixed(1)} pts`,
        `Format correctness (${pct01(b.formatCorrectnessScore)}) × ${(w.format * 100).toFixed(0)}% = ${formatPts.toFixed(1)} pts`,
        `Structural integrity (${pct01(b.structuralIntegrityScore)}) × ${(w.structural * 100).toFixed(0)}% = ${structPts.toFixed(1)} pts`,
        `Combined = ${blended.toFixed(1)} pts`,
        penaltyTotal > 0 ? `Penalties = −${penaltyTotal} pts` : `No penalties`,
        `→ Raw ≈ ${Math.max(0, Math.min(100, blended - penaltyTotal)).toFixed(1)}%`,
      ].join("\n"),
    },
    {
      label: "Display Score",
      value: `${citation.displayScore}%`,
      tooltip: [
        `Raw score adjusted for authority verification.`,
        ``,
        `Raw: ${citation.rawScore}%`,
        `Authority adjustment: ${b.authorityAdjustment >= 0 ? "+" : ""}${b.authorityAdjustment}`,
        `→ Display = ${citation.displayScore}%`,
        ``,
        b.authorityAdjustment > 0
          ? `Positive: CrossRef/OpenAlex confirmed key fields.`
          : b.authorityAdjustment < 0
            ? `Negative: authority data contradicts extracted fields.`
            : `No adjustment — authority data matched or was unavailable.`,
      ].join("\n"),
    },
      {
        label: "Field Evidence",
        value: formatUnitScore(b.fieldEvidenceScore),
        tooltip: [
          `Formula: (completeness + avg confidence) / 2`,
          `= (${pct01(b.fieldEvidence.completeness)} + ${pct01(b.fieldEvidence.avgMandatoryConfidence)}) / 2 = ${pct01(b.fieldEvidenceScore)}`,
          ``,
          `Weight in raw score: ${(w.field * 100).toFixed(0)}%`,
          `Contribution: ${pct01(b.fieldEvidenceScore)} × ${(w.field * 100).toFixed(0)}% = ${fieldPts.toFixed(1)} pts`,
        ``,
        `Completeness (${pct01(b.fieldEvidence.completeness)}):`,
        `  ${present.length} of ${totalMandatory} mandatory fields present`,
        missing.length > 0 ? `  Missing: ${missing.join(", ")}` : null,
        invalid.length > 0 ? `  Invalid: ${invalid.join(", ")}` : null,
        ``,
        `Avg confidence (${pct01(b.fieldEvidence.avgMandatoryConfidence)}):`,
        `  Average extraction confidence across ${totalMandatory} mandatory fields`,
        lowConf.length > 0 ? `  Low-confidence: ${lowConf.join(", ")}` : `  All above threshold`,
        missing.length > 0 ? `  Missing fields count as 0% confidence` : null,
      ].filter(Boolean).join("\n"),
    },
    {
      label: "Content Correctness",
      value: formatUnitScore(b.contentCorrectnessScore),
      tooltip: [
        `Semantic match score for the rendered citation.`,
        `This checks whether the rendered output preserves the citation's authors, title, year, container, and locator / identifier segments.`,
        ``,
        `Result: ${pct01(b.contentCorrectnessScore)}`,
        ``,
        `Segment scores:`,
        ...semBreakdown,
      ].join("\n"),
    },
    {
      label: "Cosmetic Format",
      value: formatUnitScore(b.cosmeticFormatScore),
      tooltip: [
        `Cosmetic polish score for the rendered output.`,
        `This is separated from semantic correctness so minor spacing or casing issues do not tank an otherwise correct citation.`,
        ``,
        `Result: ${pct01(b.cosmeticFormatScore)}`,
        ``,
        `Subscores:`,
        ...cosmeticBreakdown,
      ].join("\n"),
    },
    {
      label: "Format Correctness",
      value: formatUnitScore(b.formatCorrectnessScore),
      tooltip: [
        `Formula: content correctness × (1 - 0.15 × (1 - cosmetic format))`,
        `= ${pct01(b.contentCorrectnessScore)} × (1 - 0.15 × (1 - ${pct01(b.cosmeticFormatScore)}))`,
        `= ${pct01(b.formatCorrectnessScore)}`,
        ``,
        `Weight in raw score: ${(w.format * 100).toFixed(0)}%`,
        `Contribution: ${pct01(b.formatCorrectnessScore)} × ${(w.format * 100).toFixed(0)}% = ${formatPts.toFixed(1)} pts`,
        `Scoring path: ${b.formatScoringPath}`,
        ``,
        `Legacy diagnostic sub-checks (compatibility view):`,
        ...fmtBreakdown,
        ...(fmtWeak.length > 0 ? [``, `Weak (< 72%):`, ...fmtWeak] : []),
      ].join("\n"),
    },
    {
      label: "Structural Integrity",
      value: formatUnitScore(b.structuralIntegrityScore),
      tooltip: [
        `Formula: average of 7 structural checks`,
        `= (${stValues.map((v) => pct01(v)).join(" + ")}) / 7`,
        `= ${pct01(stAvg)}`,
        ``,
        `Weight in raw score: ${(w.structural * 100).toFixed(0)}%`,
        `Contribution: ${pct01(b.structuralIntegrityScore)} × ${(w.structural * 100).toFixed(0)}% = ${structPts.toFixed(1)} pts`,
        ``,
        `Each check:`,
        ...stBreakdown,
        ...(stWeak.length > 0 ? [``, `Weak (< 72%):`, ...stWeak] : []),
      ].join("\n"),
    },
    {
      label: "Mandatory Completeness",
      value: formatUnitScore(b.fieldEvidence.completeness),
      tooltip: [
        `How many mandatory fields are present for "${citation.referenceType}".`,
        `Preferred fields contribute at half weight.`,
        ``,
        `${present.length} of ${totalMandatory} mandatory fields present = ${pct01(b.fieldEvidence.completeness)}`,
        ``,
        present.length > 0 ? `Present (✓): ${present.join(", ")}` : null,
        missing.length > 0 ? `Missing (✗): ${missing.join(", ")}` : `Nothing missing.`,
        invalid.length > 0 ? `Invalid (⚠): ${invalid.join(", ")}` : null,
      ].filter(Boolean).join("\n"),
    },
    {
      label: "Mandatory Confidence",
      value: formatUnitScore(b.fieldEvidence.avgMandatoryConfidence),
      tooltip: [
        `Average extraction confidence across ${totalMandatory} mandatory fields.`,
        `Missing/invalid fields count as 0% confidence.`,
        ``,
        `Result: ${pct01(b.fieldEvidence.avgMandatoryConfidence)}`,
        ``,
        lowConf.length > 0 ? `Below threshold: ${lowConf.join(", ")}` : `All fields above confidence threshold.`,
        missing.length > 0 ? `Counted as 0%: ${missing.join(", ")} (missing)` : null,
        invalid.length > 0 ? `Counted as 0%: ${invalid.join(", ")} (invalid)` : null,
      ].filter(Boolean).join("\n"),
    },
      {
        label: "Format Path",
        value: `${b.formatScoringPath} • ${humanizePathReason(b.diagnostics.formatScoringPathReason)}`,
      tooltip: b.formatScoringPath === "guaranteed"
        ? `"${citation.effectiveStyle}" used the guaranteed scoring path because the effective output style is a fully supported style.`
        : `"${citation.effectiveStyle}" used the fallback format scoring path. Reason: ${humanizePathReason(b.diagnostics.formatScoringPathReason)}.`,
      },
      {
        label: "Input Style",
        value: `${humanizeStyleFamily(citation.detectedStyleFamily)} • ${citation.detectedStyle === "unknown" ? "exact unresolved" : citation.detectedStyle}`,
        tooltip: [
          `Family-first input style detection.`,
          ``,
          `Detected family: ${humanizeStyleFamily(citation.detectedStyleFamily)}`,
          `Detected exact style: ${citation.detectedStyle}`,
          `Family confidence: ${pct01(citation.familyConfidence)}`,
          `Style confidence: ${pct01(citation.styleConfidence)}`,
          `Family margin: ${pct01(citation.familyMarginToRunnerUp)}`,
          `Style margin: ${pct01(citation.styleMarginToRunnerUp)}`,
          `Certainty tier: ${citation.certaintyTier}`,
          `Conflict dampened: ${citation.conflictDampened ? "yes" : "no"}`,
          ``,
          citation.familyCandidates.length > 0
            ? `Family candidates: ${citation.familyCandidates.map((candidate) => `${humanizeStyleFamily(candidate.family)} ${pct01(candidate.score)}`).join(" • ")}`
            : `Family candidates: none`,
          citation.styleSignals.length > 0
            ? `Matched signals: ${citation.styleSignals.map(humanizeStyleSignal).join(", ")}`
            : `Matched signals: none`,
          citation.styleCandidates.length > 0
            ? `Candidates: ${citation.styleCandidates.map((candidate) => `${candidate.style} ${pct01(candidate.score)}`).join(" • ")}`
            : `Candidates: none`,
        ].join("\n"),
      },
      {
        label: "Detection Confidence",
        value: `${Math.round(b.diagnostics.rawDetectionConfidence * 100)}% → ${Math.round(b.diagnostics.effectiveDetectionConfidence * 100)}%`,
        tooltip: [
          `Raw vs effective style-detection confidence.`,
          ``,
          `Raw detection confidence: ${Math.round(b.diagnostics.rawDetectionConfidence * 100)}%`,
          `Effective detection confidence: ${Math.round(b.diagnostics.effectiveDetectionConfidence * 100)}%`,
          ``,
          citation.inputStyleUncertain
            ? citation.detectedStyleFamily === "unknown"
              ? `Input family detection remained uncertain, but the effective style could still be fixed by the request or DOI fast path.`
              : `Input style family was resolved, but exact style remained conservative or unresolved.`
            : `Input auto-detection and effective style resolution were aligned.`,
        ].join("\n"),
      },
    {
      label: "Split Quality",
      value: b.diagnostics.splitQualityFlag,
      tooltip: b.diagnostics.splitQualityFlag === "ok"
        ? `Block splitting was clean — each reference was isolated correctly.`
        : b.diagnostics.splitQualityFlag === "low"
          ? `Low split quality — some references may have been merged or split incorrectly, reducing scoring accuracy.`
          : `Sampled — not all blocks were evaluated for split quality.`,
    },
    {
      label: "Rescored",
      value: b.diagnostics.rescoredAfterCorrection ? "Yes" : "No",
      tooltip: b.diagnostics.rescoredAfterCorrection
        ? `Scores were recalculated after a user correction was applied.`
        : `Original scores — no user corrections have triggered a rescore.`,
    },
    {
      label: "Score Version",
      value: b.diagnostics.scoreVersion,
      tooltip: `Scoring algorithm version. Different versions may weight components differently.`,
    },
  ];
}

function readAuthorList(citation: EngineProcessedCitation) {
  const authors = citation.fields.authors?.value ?? [];
  if (authors.length === 0) return "Not available";
  return authors
    .map((author) => author.literal || [author.family, author.given].filter(Boolean).join(", "))
    .filter(Boolean)
    .join("; ");
}

function readFieldValue(value: unknown) {
  if (value == null) return "Not available";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "Not available";
  }
  return String(value);
}

function joinParts(left: string, right: string) {
  if (left === "Not available" && right === "Not available") return "Not available";
  if (left === "Not available") return right;
  if (right === "Not available") return left;
  return `${left} • ${right}`;
}

function stringOrUndefined(value: string | null | undefined) {
  return value == null || value === "" ? undefined : value;
}

function numberOrStringOrUndefined(value: number | null | undefined) {
  return value == null ? undefined : String(value);
}

function formatUnitScore(value: number) {
  return `${Math.round(value * 100)}%`;
}

function humanizePenaltyCode(code: string) {
  return code.replace(/[_-]+/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}

function humanizeStyleFamily(family: EngineProcessedCitation["detectedStyleFamily"]) {
  switch (family) {
    case "author_date":
      return "Author-date";
    case "numeric":
      return "Numeric";
    case "notes_bibliography":
      return "Notes / bibliography";
    case "web_accessed":
      return "Web / accessed";
    default:
      return "Unknown";
  }
}

function humanizeStyleSignal(signal: EngineProcessedCitation["styleSignals"][number]) {
  return signal.replace(/_/g, " ");
}

function humanizePathReason(reason: EngineProcessedCitation["scoreBreakdown"]["diagnostics"]["formatScoringPathReason"]) {
  switch (reason) {
    case "style_guaranteed":
      return "strict style checks";
    case "style_fallback":
      return "fallback style checks";
    case "low_detection_confidence":
      return "fallback due to low detection confidence";
    default:
      return reason;
  }
}

function describeInputCleanup(cleanup: NonNullable<EngineProcessedCitation["inputCleanup"]>) {
  if (!cleanup.lookedLikePdfCopy) {
    return null;
  }

  const actions = cleanup.hints
    .filter((hint) =>
      hint === "fixed_eol_hyphens"
      || hint === "merged_soft_breaks"
      || hint === "stripped_pdf_artifacts",
    )
    .map((hint) => {
      switch (hint) {
        case "fixed_eol_hyphens":
          return "fixed line-end hyphenation";
        case "merged_soft_breaks":
          return "merged soft line breaks";
        case "stripped_pdf_artifacts":
          return "stripped standalone PDF artifacts";
        default:
          return hint;
      }
    });

  const actionText = actions.length > 0 ? actions.join(", ") : "evaluated PDF-copy cleanup heuristics";

  if (cleanup.cleanupApplied) {
    return `Input was cleaned as PDF copy before detection and splitting: ${actionText}.`;
  }

  return `PDF-copy cleanup was evaluated but baseline splitting was kept (${cleanup.decisionReason ?? "no meaningful gain"}).`;
}

interface ProReferenceAssistCalloutProps {
  citation: EngineProcessedCitation;
  reference: ConvertedReference;
  lookup?: ProReferenceLookupState;
  onLookup: () => void;
  onToggleField: (field: string) => void;
  onSelectAll: () => void;
  onSelectMissing: () => void;
  onClearSelection: () => void;
  onAction: () => void;
}

const PRO_FIELD_LABELS: Partial<Record<EngineProEnrichFieldProposal["field"], string>> = {
  authors: "Authors",
  title: "Title",
  year: "Year",
  journal: "Journal",
  volume: "Volume",
  issue: "Issue",
  pages: "Pages",
  doi: "DOI",
  publisher: "Publisher",
  placeOfPublication: "Place of publication",
  url: "URL",
  conferenceTitle: "Conference",
  bookTitle: "Book title",
  institution: "Institution",
  edition: "Edition",
  editors: "Editors",
  thesisType: "Thesis type",
  repository: "Repository",
  articleNumber: "Article number",
  accessedDate: "Accessed date",
  siteName: "Site name",
  database: "Database",
  reportNumber: "Report number",
};

function ProReferenceAssistCallout({
  citation,
  reference,
  lookup,
  onLookup,
  onToggleField,
  onSelectAll,
  onSelectMissing,
  onClearSelection,
  onAction,
}: ProReferenceAssistCalloutProps) {
  const missingFields = lookup?.missingFields ?? getMissingFields(citation);
  const selectedProposalCount = lookup?.status === "ready" && lookup.proposal
    ? lookup.proposal.fields.filter((proposal) => lookup.selectedFields[proposal.field]).length
    : 0;
  const preview = lookup?.status === "ready" ? lookup.preview : { status: "idle" as const };
  const actionLabel = lookup?.status === "ready" ? "Check again with Pro" : "Check with Pro";
  const readyPreviewResponse = preview.status === "ready" ? preview.response : null;
  const leadMessage = buildProAssistLead(missingFields, lookup);
  const currentSelectionKey = lookup?.status === "ready" && lookup.proposal
    ? buildSelectionKeyFromProposal(lookup.proposal, lookup.selectedFields)
    : null;
  const hasSelectedFields = selectedProposalCount > 0;
  const actionState = resolveProActionState(
    lookup?.status === "ready" ? lookup : undefined,
    currentSelectionKey,
    Boolean(readyPreviewResponse),
  );
  const hasAppliedCorrection = Boolean(lookup?.status === "ready" && lookup.appliedSelectionKey);

  return (
    <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/70 px-3 py-3 text-[#0b1530]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              Pro Reference Repair
            </div>
            {hasAppliedCorrection ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Live corrected output
              </span>
            ) : null}
          </div>
          <p className="text-sm leading-6 text-slate-700">{leadMessage}</p>
          {missingFields.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {missingFields.map((field) => (
                <span
                  key={field}
                  className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800"
                >
                  Missing {formatMissingFieldLabel(field)}
                </span>
              ))}
            </div>
          ) : null}
          {lookup?.status === "loading" ? (
            <p className="text-xs text-sky-700">
              Searching Crossref, OpenAlex, and Semantic Scholar across all supported citation fields.
            </p>
          ) : null}
          {lookup?.status === "ready" && !lookup.proposal && lookup.message ? (
            <p className="text-xs text-slate-700">{lookup.message}</p>
          ) : null}
          {lookup?.status === "error" ? (
            <p className="text-xs text-rose-700">{lookup.message}</p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-sky-300 bg-white text-sky-700 hover:bg-sky-100"
          disabled={lookup?.status === "loading"}
          onClick={onLookup}
        >
          {lookup?.status === "loading" ? "Checking..." : actionLabel}
        </Button>
      </div>

      {lookup?.status === "ready" && lookup.proposal ? (
        <div className="mt-4 border-t border-sky-200 pt-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>{lookup.proposal.fields.length} Pro suggestion{lookup.proposal.fields.length === 1 ? "" : "s"}</span>
              <span aria-hidden="true">•</span>
              <span>{selectedProposalCount} selected</span>
              {hasAppliedCorrection ? (
                <>
                  <span aria-hidden="true">•</span>
                  <span>saved to the current output</span>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                onClick={onSelectAll}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                onClick={onSelectMissing}
              >
                Missing only
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                onClick={onClearSelection}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {lookup.proposal.fields.map((proposal) => {
              const fieldLabel = formatProFieldLabel(proposal.field);
              const isSelected = Boolean(lookup.selectedFields[proposal.field]);
              return (
                <label
                  key={proposal.field}
                  className={`flex gap-3 rounded-xl border px-3 py-2 ${
                    isSelected
                      ? "border-sky-200 bg-white"
                      : "border-sky-100 bg-white/70"
                  }`}
                >
                  <Checkbox
                    checked={isSelected}
                    className="mt-0.5 border-sky-400 data-[state=checked]:bg-sky-700 data-[state=checked]:text-white"
                    onCheckedChange={() => onToggleField(proposal.field)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{fieldLabel}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          proposal.changeKind === "fill"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {proposal.changeKind === "fill" ? "Fill missing field" : "Replace existing field"}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {formatOverlayProvider(proposal.provider)} {Math.round(proposal.confidence * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 break-words text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">
                      {formatProFieldValue(proposal.proposedValue)}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                      Current {formatProFieldValue(proposal.currentValue)}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Current Reference
                </div>
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                  live output
                </span>
              </div>
              <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
                {reference.convertedText}
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-emerald-200 bg-emerald-50/75 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  Corrected Preview
                </div>
                {selectedProposalCount > 0 ? (
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-700">
                    {selectedProposalCount} selected field{selectedProposalCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              {preview.status === "loading" ? (
                <p className="mt-2 text-sm text-emerald-800">Refreshing the corrected preview…</p>
              ) : null}
              {preview.status === "error" ? (
                <p className="mt-2 text-sm text-rose-700">{preview.message}</p>
              ) : null}
              {readyPreviewResponse ? (
                <div className="mt-2 space-y-2">
                  <p className="break-words whitespace-pre-wrap text-sm leading-6 text-slate-800 [overflow-wrap:anywhere]">
                    {readyPreviewResponse.renderedText}
                  </p>
                  {readyPreviewResponse.warningCodes.length > 0 ? (
                    <p className="text-xs text-amber-700">
                      Preview warnings: {readyPreviewResponse.warningCodes.map(humanizePenaltyCode).join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {preview.status === "idle" ? (
                <p className="mt-2 text-sm text-slate-600">
                  {hasSelectedFields
                    ? "Preparing the corrected preview for the selected fields."
                    : "Select at least one suggestion to preview the fully corrected citation before you save it."}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-sky-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-600">
              Toggle the fields you trust, preview the full citation, and save that mix as the live reference. Clearing every field restores the original engine output.
            </p>
            <Button
              type="button"
              size="sm"
              className="bg-[#002147] text-white hover:bg-[#001730]"
              disabled={actionState.disabled}
              onClick={onAction}
            >
              {actionState.label}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildDefaultSelectedFields(
  fields: EngineProEnrichFieldProposal[],
): Record<string, boolean> {
  return Object.fromEntries(fields.map((proposal) => [proposal.field, true]));
}

function buildMissingOnlySelectedFields(
  fields: EngineProEnrichFieldProposal[],
): Record<string, boolean> {
  return Object.fromEntries(
    fields.map((proposal) => [proposal.field, proposal.changeKind === "fill"]),
  );
}

function buildClearedSelectedFields(
  fields: EngineProEnrichFieldProposal[],
): Record<string, boolean> {
  return Object.fromEntries(fields.map((proposal) => [proposal.field, false]));
}

function buildSelectedPreviewFields(
  proposal: EngineProEnrichCitationProposal,
  selectedFields: Record<string, boolean>,
): Record<string, unknown> {
  return Object.fromEntries(
    proposal.fields
      .filter((fieldProposal) => selectedFields[fieldProposal.field])
      .map((fieldProposal) => [fieldProposal.field, fieldProposal.proposedValue]),
  );
}

function buildPreviewSelectionKey(fields: Record<string, unknown>): string {
  return JSON.stringify(
    Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildSelectionKeyFromProposal(
  proposal: EngineProEnrichCitationProposal,
  selectedFields: Record<string, boolean>,
): string | null {
  const previewFields = buildSelectedPreviewFields(proposal, selectedFields);
  return Object.keys(previewFields).length > 0
    ? buildPreviewSelectionKey(previewFields)
    : null;
}

function buildAppliedSelectedFields(
  citation: EngineProcessedCitation,
  proposals: EngineProEnrichFieldProposal[],
): Record<string, boolean> {
  return Object.fromEntries(
    proposals.map((proposal) => [
      proposal.field,
      proFieldValuesMatch(proposal.field, citation.fields[proposal.field]?.value, proposal.proposedValue),
    ]),
  );
}

function resolveProActionState(
  lookup: Extract<ProReferenceLookupState, { status: "ready" }> | undefined,
  currentSelectionKey: string | null,
  hasReadyPreview: boolean,
) {
  if (!lookup || !lookup.proposal) {
    return {
      label: "Use corrected reference",
      disabled: true,
    };
  }

  const selectionMatchesApplied = Boolean(
    currentSelectionKey
    && lookup.appliedSelectionKey
    && currentSelectionKey === lookup.appliedSelectionKey,
  );
  const wantsRestore = Boolean(lookup.appliedSelectionKey && !currentSelectionKey);

  if (lookup.isApplying) {
    return {
      label: wantsRestore || selectionMatchesApplied
        ? "Restoring original reference..."
        : lookup.appliedSelectionKey
          ? "Updating corrected reference..."
          : "Using corrected reference...",
      disabled: true,
    };
  }

  if (wantsRestore || selectionMatchesApplied) {
    return {
      label: "Restore original reference",
      disabled: false,
    };
  }

  if (!currentSelectionKey) {
    return {
      label: "Select fields to preview",
      disabled: true,
    };
  }

  return {
    label: lookup.appliedSelectionKey ? "Update corrected reference" : "Use corrected reference",
    disabled: !hasReadyPreview,
  };
}

function proFieldValuesMatch(
  field: EngineProEnrichFieldProposal["field"],
  currentValue: unknown,
  proposedValue: unknown,
): boolean {
  return JSON.stringify(normalizeComparableProValue(field, currentValue))
    === JSON.stringify(normalizeComparableProValue(field, proposedValue));
}

function isBulkProEligibleCitation(citation: EngineProcessedCitation): boolean {
  return citation.publicStatus === "needs_review" || citation.publicStatus === "needs_action";
}

function normalizeComparableProValue(
  field: EngineProEnrichFieldProposal["field"],
  value: unknown,
): unknown {
  if (field === "year") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const match = value.trim().match(/\b\d{4}\b/u);
      return match ? Number(match[0]) : null;
    }
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      return entry;
    });
  }

  return value;
}

function buildProAssistLead(
  missingFields: string[],
  lookup?: ProReferenceLookupState,
): string {
  if (lookup?.status === "ready" && lookup.proposal) {
    return "Pro searched all supported citation fields for this reference. Select missing-field fills or explicit replacements, then preview the fully corrected citation before you apply it.";
  }

  if (lookup?.status === "ready" && !lookup.proposal) {
    return "Pro checked all supported citation fields for this reference but did not find a stronger correction yet.";
  }

  if (lookup?.status === "error") {
    return "Pro could not finish the metadata check for this reference. You can retry the search without leaving the citation view.";
  }

  if (missingFields.length > 0) {
    return "This reference is missing extracted fields. Pro can search all supported fields, suggest targeted fixes, and let you choose which values to fill or replace.";
  }

  return "Use Pro to scan this reference across all supported fields, surface possible metadata issues, and preview a corrected citation before replacing the current one.";
}

function formatMissingFieldLabel(field: string): string {
  switch (field) {
    case "author":
      return "Author";
    case "title":
      return "Title";
    case "year":
      return "Year";
    case "venue":
      return "Venue";
    case "publisher":
      return "Publisher";
    case "institution":
      return "Institution";
    case "locator":
      return "Locator";
    case "volume":
      return "Volume";
    default:
      return field;
  }
}

function formatProFieldLabel(field: EngineProEnrichFieldProposal["field"]): string {
  return PRO_FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, " $1").replace(/^\w/, (char) => char.toUpperCase());
}

function formatProFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    const rendered = value
      .map((entry) => formatProFieldValue(entry))
      .filter((entry) => entry !== "Missing");
    return rendered.length > 0 ? rendered.join("; ") : "Missing";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    return value.trim() || "Missing";
  }

  if (value && typeof value === "object") {
    const author = value as {
      literal?: unknown;
      family?: unknown;
      given?: unknown;
    };
    if (typeof author.literal === "string" && author.literal.trim()) {
      return author.literal.trim();
    }

    const parts = [
      typeof author.family === "string" ? author.family.trim() : "",
      typeof author.given === "string" ? author.given.trim() : "",
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(", ");
    }
  }

  return "Missing";
}

function formatOverlayProvider(provider: EngineProEnrichFieldProposal["provider"]): string {
  switch (provider) {
    case "crossref":
      return "Crossref";
    case "openalex":
      return "OpenAlex";
    case "semantic_scholar":
      return "Semantic Scholar";
    default:
      return provider;
  }
}
