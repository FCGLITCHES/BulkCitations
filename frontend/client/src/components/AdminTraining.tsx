import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { AdminShell } from "./AdminShell";
import { AdminSectionTabs } from "./AdminSectionTabs";
import {
  AdminRequestError,
  adminDownloadBlob,
  adminFetch,
} from "@/lib/admin-api";
import { ENGINE_OUTPUT_STYLE_OPTIONS } from "@/lib/engine-types";
import { toast as dispatchToast, useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminTrainingDisclosureSection } from "./admin-training/AdminTrainingDisclosureSection";
import { AdminTrainingBulkSelectionBar } from "./admin-training/AdminTrainingBulkSelectionBar";
import {
  AdminTrainingHelpLabel as HelpLabel,
  renderDropdownHelp,
} from "./admin-training/AdminTrainingHelpLabel";
import { AdminTrainingJsonPreview } from "./admin-training/AdminTrainingJsonPreview";
import { AdminTrainingRenderVariantsSection } from "./admin-training/AdminTrainingRenderVariantsSection";
import {
  AdminTrainingGuideDialog,
  type TrainingGuideSectionId,
} from "./admin-training/AdminTrainingGuideDialog";
import { AdminTrainingBulkUpdateDialog } from "./admin-training/AdminTrainingBulkUpdateDialog";
import { AdminTrainingCertifyDialog } from "./admin-training/AdminTrainingCertifyDialog";
import { AdminTrainingWorkflowSection } from "./admin-training/AdminTrainingWorkflowSection";
import {
  APPROVED_TRUTH_PAGE_SIZE,
  APPROVAL_SOURCE_OPTIONS,
  AUDIT_REASON_OPTIONS,
  BLOCKED_REASON_OPTIONS,
  cardClass,
  DATASET_SPLIT_OPTIONS,
  EXPECTED_FIELD_DEFINITION_BY_KEY,
  EXPECTED_FIELD_DEFINITIONS,
  EXPECTED_OUTPUT_FIELD_DEFINITION,
  EXPECTED_OUTPUT_FIELD_KEY,
  GOLD_KIND_OPTIONS,
  GOLD_REFERENCE_TYPE_OPTIONS,
  INPUT_PROFILE_OPTIONS,
  REQUIRED_EXPECTED_FIELDS_BY_TYPE,
  ROW_STATUS_OPTIONS,
  SCOPE_OPTIONS,
  STYLE_EVAL_SUITE_OPTIONS,
  TASK_OPTIONS,
  TRAINING_PACK_TARGET_OPTIONS,
  TRUTH_RENDER_VARIANT_STYLE_LABELS,
  TRUTH_RENDER_VARIANT_STYLE_ORDER,
  TRUST_LEVEL_OPTIONS,
} from "./admin-training/constants";
import {
  approvedTruthFiltersFromQueryKey,
  approvedTruthFiltersEqual,
  approvedTruthRowMatchesFilters,
  applyTruthBackgroundUpdateToRow,
  buildBulkUpdateCompletionDescription,
  buildBulkUpdateCompletionTitle,
  buildSelectedPrefillCompletionDescription,
  buildSelectedPrefillCompletionTitle,
  buildTruthBackgroundCompletionDescription,
  buildTruthBackgroundCompletionTitle,
  buildTruthBackgroundFailureDescription,
  buildTruthBackgroundHighlightSummary,
  buildTruthBackgroundLastSuccessfulPageDescription,
  buildTruthBackgroundPageProgressDescription,
  effectiveApprovedTruthRowStatus,
  formatTruthRowHighlightLabel,
  isApprovedTruthListQueryKey,
  reconcileApprovedTruthListCaches,
  TRUTH_ROW_HIGHLIGHT_DURATION_MS,
  truthBackgroundOperationLabel,
  truthResultHighlightTone,
} from "./admin-training/backgroundJobHelpers";
import {
  approvedTruthEditorDraftHasContent,
  buildBlankApprovedTruthEditorDraftPayload,
  buildBlankExpectedFieldValues,
  buildCanonicalTruthFields,
  buildRenderVariantInputFingerprint,
  detectNoiseProfileFromRawText,
  expectedFieldKeysForRender,
  expectedFieldsToFormValues,
  formatNoiseProfile,
  inferAdversarialPair,
  missingRequiredExpectedFields,
  normalizeFlatExpectedFields,
  normalizeWhitespace,
  parseExpectedFieldFormValues,
  parseNoiseProfile,
  parseScalarValue,
  savedTruthFieldsForRow,
  toExpectedFieldValueString,
  toExpectedFieldsPreviewFromValues,
  truthRowHasEngineSeed,
  truthRowIsSparse,
  truthRowNeedsAutomaticEnginePrefill,
} from "./admin-training/truthFieldHelpers";
import {
  buildAllFilteredTruthSelection,
  buildGovernanceSummary,
  defaultExpectedFieldsFromQueue,
  formatAllFilteredTruthSelectionScope,
  formatTruthDriftTooltip,
  normalizedRawInputFromQueue,
  truthDriftSummary,
  uniqueFrozenDatasetsByVersion,
  uniqueStrings,
  withLegacyOption,
} from "./admin-training/viewHelpers";
import type {
  ActiveTruthBackgroundJob,
  AllFilteredTruthSelection,
  ApprovedTruthBulkFilterPayload,
  ApprovedTruthEditorDraftRecord,
  ApprovedTruthEditorDraftPayload,
  ApprovedTruthEditorDraftResponse,
  ApprovedTruthListQueryKey,
  ApprovedTruthListResponse,
  ApprovedTruthRenderVariant,
  ApprovedTruthRow,
  FrozenGoldDatasetManifest,
  LearningQueueBulkProcessResponse,
  LearningQueueBulkPromoteResponse,
  LearningQueueBulkRevertResponse,
  LearningQueueRow,
  TrainingStatusResponse,
  TruthApprovalSource,
  TruthAuditReasonCode,
  TruthBackgroundBulkJobResponse,
  TruthBackgroundBulkOperation,
  TruthBackgroundOptimisticUpdate,
  TruthBlockedReason,
  TruthBulkCertifyResponse,
  TruthBulkDeleteResponse,
  TruthBulkPrefillResponse,
  TruthBulkResultRecord,
  TruthBulkResultStatus,
  TruthBulkUpdateResponse,
  TruthCrossrefPrefillResponse,
  TruthDatasetSplit,
  TruthDriftSummary,
  TruthFieldValue,
  TruthGoldKind,
  TruthInputProfile,
  TruthRenderPreviewResponse,
  TruthRenderVariantListResponse,
  TruthRenderVariantStyle,
  TruthRowHighlight,
  TruthRowStatus,
  TruthScope,
  TruthStyleEvaluationSuite,
  TruthTask,
  TruthTaskCertification,
  TruthTaskCertificationStatus,
  TruthTrustLevel,
  TruthPrefillResponse,
  TrainingPackTarget,
} from "./admin-training/types";
import { cn } from "@/lib/utils";

type ToastController = ReturnType<typeof dispatchToast>;
const AUTO_STYLE_BUNDLE_VERSION_PREFIX = "style-gb";

function buildAutoStyleBundleVersion(now = new Date()): string {
  return `${AUTO_STYLE_BUNDLE_VERSION_PREFIX}-${now.toISOString().replace(/[:.]/g, "-")}`;
}

function formatDatasetModifiedLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.valueOf())) {
    return createdAt;
  }
  return date.toLocaleString();
}

function formatBenchmarkThroughput(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function downloadBrowserBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildLearningQueueExportFilename(now = new Date()): string {
  return `learning-queue-inputs-${now.toISOString().replace(/[:.]/g, "-")}.txt`;
}

function buildLearningQueueExportText(rows: LearningQueueRow[]): string {
  return rows
    .map((row) => normalizedRawInputFromQueue(row.trainingData).trim())
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function defaultTrainingPackTargetForTask(
  task: TruthTask,
  scope: TruthScope,
): TrainingPackTarget {
  if (task === "overlay_learning" || scope === "overlay") {
    return "approved_overlay_changes";
  }
  if (task === "authority_pack") {
    return "authority_pack";
  }
  if (task === "field") {
    return "citation_bio_supervision";
  }
  return "style_core_gold";
}

function labelForTrainingPackTarget(packTarget: TrainingPackTarget): string {
  return (
    TRAINING_PACK_TARGET_OPTIONS.find((option) => option.value === packTarget)
      ?.label ?? packTarget
  );
}

function labelForTruthTask(task: TruthTask): string {
  return TASK_OPTIONS.find((option) => option.value === task)?.label ?? task;
}

function formatCertificationDestination(
  certification: TruthTaskCertification,
): string {
  const packTarget =
    certification.packTarget ??
    defaultTrainingPackTargetForTask(
      certification.task,
      certification.truthScope,
    );
  return `${labelForTrainingPackTarget(packTarget)} • ${labelForTruthTask(certification.task)} / ${certification.truthScope}`;
}

function certifiedDestinations(
  row: ApprovedTruthRow,
): TruthTaskCertification[] {
  return (row.taskCertifications ?? []).filter(
    (certification) => certification.status === "certified",
  );
}

export default function AdminTraining() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const truthBackgroundToastRef = useRef<ToastController | null>(null);
  const truthBackgroundLastAppliedPageRef = useRef<{
    jobId: string;
    completedPage: number;
  }>({
    jobId: "",
    completedPage: 0,
  });
  const [trustFilter, setTrustFilter] = useState<"" | TruthTrustLevel>("");
  const [splitFilter, setSplitFilter] = useState<"" | TruthDatasetSplit>("");
  const [rowStatusFilter, setRowStatusFilter] = useState<"" | TruthRowStatus>(
    "",
  );
  const [styleFilter, setStyleFilter] = useState("");
  const [goldKindFilter, setGoldKindFilter] = useState<TruthGoldKind | "">("");
  const [styleEvalSuiteFilter, setStyleEvalSuiteFilter] = useState<
    TruthStyleEvaluationSuite | ""
  >("");
  const [exportTask, setExportTask] = useState<TruthTask>("style");
  const [exportTruthScope, setExportTruthScope] = useState<TruthScope>("core");
  const [exportCertifiedOnly, setExportCertifiedOnly] = useState(true);
  const [exportExcludeQuarantined, setExportExcludeQuarantined] =
    useState(true);
  const [exportHoldoutVersion, setExportHoldoutVersion] = useState("");
  const [exportDatasetVersion, setExportDatasetVersion] = useState("");
  const [exportStyleEvaluationSuite, setExportStyleEvaluationSuite] = useState<
    TruthStyleEvaluationSuite | ""
  >("");
  const [queueShowProcessed, setQueueShowProcessed] = useState(false);
  const [truthShowCertified, setTruthShowCertified] = useState(false);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [truthPage, setTruthPage] = useState(1);
  const [truthPageJumpOpen, setTruthPageJumpOpen] = useState(false);
  const [truthPageJumpValue, setTruthPageJumpValue] = useState("");
  const [selectedTruthIds, setSelectedTruthIds] = useState<string[]>([]);
  const [allFilteredTruthSelection, setAllFilteredTruthSelection] =
    useState<AllFilteredTruthSelection | null>(null);
  const [activeTruthBackgroundJob, setActiveTruthBackgroundJob] =
    useState<ActiveTruthBackgroundJob | null>(null);
  const [truthRowHighlights, setTruthRowHighlights] = useState<
    Record<string, TruthRowHighlight>
  >({});
  const [truthHighlightSummary, setTruthHighlightSummary] = useState<
    string | null
  >(null);
  const [styleBundleVersion, setStyleBundleVersion] = useState(() =>
    buildAutoStyleBundleVersion(),
  );
  const [
    styleBundleVersionManuallyEdited,
    setStyleBundleVersionManuallyEdited,
  ] = useState(false);
  const [styleBundleDatasetVersion, setStyleBundleDatasetVersion] =
    useState("");
  const [freezeDatasetVersion, setFreezeDatasetVersion] = useState("");
  const [buildPackTarget, setBuildPackTarget] =
    useState<TrainingPackTarget>("style_core_gold");
  const [trainingGuideOpen, setTrainingGuideOpen] = useState(false);
  const [trainingGuideSection, setTrainingGuideSection] =
    useState<TrainingGuideSectionId>("overview");
  const [exportFiltersOpen, setExportFiltersOpen] = useState(false);
  const [trainingArtifactsOpen, setTrainingArtifactsOpen] = useState(false);
  const [approvedTruthFiltersOpen, setApprovedTruthFiltersOpen] =
    useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovedTruthRow | null>(null);
  const [activeRenderVariantStyle, setActiveRenderVariantStyle] =
    useState<TruthRenderVariantStyle>("apa7");
  const [editorGovernanceOpen, setEditorGovernanceOpen] = useState(false);
  const [editorJsonPreviewOpen, setEditorJsonPreviewOpen] = useState(false);
  const [formRawText, setFormRawText] = useState("");
  const [formExpectedFieldValues, setFormExpectedFieldValues] = useState<
    Record<string, string>
  >(() => buildBlankExpectedFieldValues());
  const [formEngineRenderedOutput, setFormEngineRenderedOutput] = useState("");
  const [formEnginePreviewWarnings, setFormEnginePreviewWarnings] = useState<
    string[]
  >([]);
  const [formEnginePreviewStale, setFormEnginePreviewStale] = useState(false);
  const [formExpectedOutputDirty, setFormExpectedOutputDirty] = useState(false);
  const [formShowMissingRequired, setFormShowMissingRequired] = useState(false);
  const [formExpectedType, setFormExpectedType] = useState("");
  const [formExpectedStyle, setFormExpectedStyle] = useState("");
  const [formProvenance, setFormProvenance] = useState("");
  const [formPipelineMajor, setFormPipelineMajor] = useState("");
  const [formDatasetSplit, setFormDatasetSplit] = useState<
    TruthDatasetSplit | ""
  >("");
  const [formTrustLevel, setFormTrustLevel] =
    useState<TruthTrustLevel>("draft");
  const [formRowStatus, setFormRowStatus] = useState<TruthRowStatus>("draft");
  const [formBlockedReason, setFormBlockedReason] = useState<
    TruthBlockedReason | ""
  >("");
  const [formGoldKind, setFormGoldKind] = useState<TruthGoldKind | "">("");
  const [formAdversarialPair, setFormAdversarialPair] = useState("");
  const [formNoiseProfile, setFormNoiseProfile] = useState("");
  const [formAdversarialPairTouched, setFormAdversarialPairTouched] =
    useState(false);
  const [formNoiseProfileTouched, setFormNoiseProfileTouched] = useState(false);
  const [formApprovalSource, setFormApprovalSource] = useState<
    TruthApprovalSource | ""
  >("");
  const [formReviewedBy, setFormReviewedBy] = useState("");
  const [formAuditReasonCode, setFormAuditReasonCode] = useState<
    TruthAuditReasonCode | ""
  >("manual_correction");
  const [formNotes, setFormNotes] = useState("");
  const [variantTextOverrides, setVariantTextOverrides] = useState<
    Partial<Record<TruthRenderVariantStyle, string>>
  >({});
  const [variantNoteOverrides, setVariantNoteOverrides] = useState<
    Partial<Record<TruthRenderVariantStyle, string>>
  >({});
  const [editorDraftSyncState, setEditorDraftSyncState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [editorDraftSavedAt, setEditorDraftSavedAt] = useState<string | null>(
    null,
  );
  const [restorableEditorDraft, setRestorableEditorDraft] =
    useState<ApprovedTruthEditorDraftRecord | null>(null);
  const [resumeEditorDraftPending, setResumeEditorDraftPending] =
    useState(false);
  const editorDraftHydratedRef = useRef(false);
  const editorDraftRequestCounterRef = useRef(0);
  const editorRawTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promoteRawTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [promoteItem, setPromoteItem] = useState<LearningQueueRow | null>(null);
  const [promoteGovernanceOpen, setPromoteGovernanceOpen] = useState(false);
  const [promoteJsonPreviewOpen, setPromoteJsonPreviewOpen] = useState(false);
  const [promoteRaw, setPromoteRaw] = useState("");
  const [promoteExpectedFieldValues, setPromoteExpectedFieldValues] = useState<
    Record<string, string>
  >(() => buildBlankExpectedFieldValues());
  const [promoteShowMissingRequired, setPromoteShowMissingRequired] =
    useState(false);
  const [promoteExpectedType, setPromoteExpectedType] = useState("");
  const [promoteExpectedStyle, setPromoteExpectedStyle] = useState("");
  const [promoteDatasetSplit, setPromoteDatasetSplit] = useState<
    TruthDatasetSplit | ""
  >("train");
  const [promoteTrust, setPromoteTrust] = useState<TruthTrustLevel>("reviewed");
  const [promoteRowStatus, setPromoteRowStatus] =
    useState<TruthRowStatus>("reviewed");
  const [promoteBlockedReason, setPromoteBlockedReason] = useState<
    TruthBlockedReason | ""
  >("");
  const [promoteGoldKind, setPromoteGoldKind] = useState<TruthGoldKind | "">(
    "",
  );
  const [promoteAdversarialPair, setPromoteAdversarialPair] = useState("");
  const [promoteNoiseProfile, setPromoteNoiseProfile] = useState("");
  const [promoteAdversarialPairTouched, setPromoteAdversarialPairTouched] =
    useState(false);
  const [promoteNoiseProfileTouched, setPromoteNoiseProfileTouched] =
    useState(false);
  const [promoteApprovalSource, setPromoteApprovalSource] = useState<
    TruthApprovalSource | ""
  >("learning_queue");
  const [promoteReviewedBy, setPromoteReviewedBy] = useState("");
  const [promoteAuditReasonCode, setPromoteAuditReasonCode] = useState<
    TruthAuditReasonCode | ""
  >("manual_correction");
  const [promoteNotes, setPromoteNotes] = useState("");
  const [bulkQueuePromoteIds, setBulkQueuePromoteIds] = useState<
    string[] | null
  >(null);
  const [bulkQueuePromoteGovernanceOpen, setBulkQueuePromoteGovernanceOpen] =
    useState(false);
  const [bulkQueuePromoteExpectedType, setBulkQueuePromoteExpectedType] =
    useState("");
  const [bulkQueuePromoteExpectedStyle, setBulkQueuePromoteExpectedStyle] =
    useState("");
  const [bulkQueuePromoteDatasetSplit, setBulkQueuePromoteDatasetSplit] =
    useState<TruthDatasetSplit | "">("train");
  const [bulkQueuePromoteTrust, setBulkQueuePromoteTrust] =
    useState<TruthTrustLevel>("reviewed");
  const [bulkQueuePromoteRowStatus, setBulkQueuePromoteRowStatus] =
    useState<TruthRowStatus>("reviewed");
  const [bulkQueuePromoteBlockedReason, setBulkQueuePromoteBlockedReason] =
    useState<TruthBlockedReason | "">("");
  const [bulkQueuePromoteGoldKind, setBulkQueuePromoteGoldKind] = useState<
    TruthGoldKind | ""
  >("");
  const [bulkQueuePromoteAdversarialPair, setBulkQueuePromoteAdversarialPair] =
    useState("");
  const [bulkQueuePromoteNoiseProfile, setBulkQueuePromoteNoiseProfile] =
    useState("");
  const [
    bulkQueuePromoteAdversarialPairTouched,
    setBulkQueuePromoteAdversarialPairTouched,
  ] = useState(false);
  const [bulkQueuePromoteApprovalSource, setBulkQueuePromoteApprovalSource] =
    useState<TruthApprovalSource | "">("learning_queue");
  const [bulkQueuePromoteReviewedBy, setBulkQueuePromoteReviewedBy] =
    useState("");
  const [bulkQueuePromoteAuditReasonCode, setBulkQueuePromoteAuditReasonCode] =
    useState<TruthAuditReasonCode | "">("manual_correction");
  const [bulkQueuePromoteNotes, setBulkQueuePromoteNotes] = useState("");

  const [certifyRow, setCertifyRow] = useState<ApprovedTruthRow | null>(null);
  const [certifyTask, setCertifyTask] = useState<TruthTask>("style");
  const [certifyScope, setCertifyScope] = useState<TruthScope>("core");
  const [certifyPackTarget, setCertifyPackTarget] =
    useState<TrainingPackTarget>("style_core_gold");
  const [certifyStatus, setCertifyStatus] =
    useState<TruthTaskCertificationStatus>("certified");
  const [certifyRequiredPasses, setCertifyRequiredPasses] = useState(1);
  const [certifyCompletedPasses, setCertifyCompletedPasses] = useState(1);
  const [certifyBy, setCertifyBy] = useState("");
  const [certifyDecisionHash, setCertifyDecisionHash] = useState("");
  const [bulkCertifyIds, setBulkCertifyIds] = useState<string[] | null>(null);
  const [bulkCertifyAllFiltered, setBulkCertifyAllFiltered] =
    useState<AllFilteredTruthSelection | null>(null);
  const [bulkUpdateIds, setBulkUpdateIds] = useState<string[] | null>(null);
  const [bulkUpdateAllFiltered, setBulkUpdateAllFiltered] =
    useState<AllFilteredTruthSelection | null>(null);
  const [bulkUpdateTrustLevel, setBulkUpdateTrustLevel] = useState<
    TruthTrustLevel | ""
  >("");
  const [bulkUpdateRowStatus, setBulkUpdateRowStatus] = useState<
    TruthRowStatus | ""
  >("");
  const [bulkUpdateBlockedReason, setBulkUpdateBlockedReason] = useState<
    TruthBlockedReason | ""
  >("");

  const truthTypeOptions = withLegacyOption(
    formExpectedType,
    GOLD_REFERENCE_TYPE_OPTIONS,
  );
  const truthStyleOptions = withLegacyOption(
    formExpectedStyle,
    ENGINE_OUTPUT_STYLE_OPTIONS,
  );
  const promoteTypeOptions = withLegacyOption(
    promoteExpectedType,
    GOLD_REFERENCE_TYPE_OPTIONS,
  );
  const promoteStyleOptions = withLegacyOption(
    promoteExpectedStyle,
    ENGINE_OUTPUT_STYLE_OPTIONS,
  );
  const bulkQueuePromoteTypeOptions = withLegacyOption(
    bulkQueuePromoteExpectedType,
    GOLD_REFERENCE_TYPE_OPTIONS,
  );
  const bulkQueuePromoteStyleOptions = withLegacyOption(
    bulkQueuePromoteExpectedStyle,
    ENGINE_OUTPUT_STYLE_OPTIONS,
  );
  const filterStyleOptions = withLegacyOption(
    styleFilter,
    ENGINE_OUTPUT_STYLE_OPTIONS,
  );
  const formExpectedFieldKeys = expectedFieldKeysForRender(
    formExpectedFieldValues,
  );
  const promoteExpectedFieldKeys = expectedFieldKeysForRender(
    promoteExpectedFieldValues,
  );
  const formMissingRequiredFields = missingRequiredExpectedFields(
    formExpectedType,
    formExpectedFieldValues,
  );
  const promoteMissingRequiredFields = missingRequiredExpectedFields(
    promoteExpectedType,
    promoteExpectedFieldValues,
  );
  const formExpectedOutputValue =
    formExpectedFieldValues[EXPECTED_OUTPUT_FIELD_KEY] ?? "";
  const expectedOutputMatchesEnginePreview =
    normalizeWhitespace(formExpectedOutputValue).length > 0 &&
    normalizeWhitespace(formExpectedOutputValue) ===
      normalizeWhitespace(formEngineRenderedOutput);
  const canRefreshEnginePreview =
    formRawText.trim().length > 0 && formExpectedStyle.trim().length > 0;
  const editorGovernanceSummary = buildGovernanceSummary({
    datasetSplit: formDatasetSplit,
    trustLevel: formTrustLevel,
    rowStatus: formRowStatus,
    blockedReason: formBlockedReason,
    goldKind: formGoldKind,
    approvalSource: formApprovalSource,
    adversarialPair: formAdversarialPair,
    noiseProfile: formNoiseProfile,
    reviewedBy: formReviewedBy,
  });
  const promoteGovernanceSummary = buildGovernanceSummary({
    datasetSplit: promoteDatasetSplit,
    trustLevel: promoteTrust,
    rowStatus: promoteRowStatus,
    blockedReason: promoteBlockedReason,
    goldKind: promoteGoldKind,
    approvalSource: promoteApprovalSource,
    adversarialPair: promoteAdversarialPair,
    noiseProfile: promoteNoiseProfile,
    reviewedBy: promoteReviewedBy,
  });
  const bulkQueuePromoteGovernanceSummary = buildGovernanceSummary({
    datasetSplit: bulkQueuePromoteDatasetSplit,
    trustLevel: bulkQueuePromoteTrust,
    rowStatus: bulkQueuePromoteRowStatus,
    blockedReason: bulkQueuePromoteBlockedReason,
    goldKind: bulkQueuePromoteGoldKind,
    approvalSource: bulkQueuePromoteApprovalSource,
    adversarialPair: bulkQueuePromoteAdversarialPair,
    noiseProfile: bulkQueuePromoteNoiseProfile,
    reviewedBy: bulkQueuePromoteReviewedBy,
  });
  const editorDraftQueryKey = [
    "/internal/admin/approved-truth/editor-draft",
  ] as const;
  const renderVariantFingerprint = buildRenderVariantInputFingerprint({
    expectedType: formExpectedType,
    expectedFieldValues: formExpectedFieldValues,
  });
  const savedRenderVariantFingerprint = editing
    ? buildRenderVariantInputFingerprint({
        expectedType: editing.expectedType ?? "",
        expectedFieldValues: expectedFieldsToFormValues(
          savedTruthFieldsForRow(editing),
        ),
      })
    : "";
  const renderVariantInputsDirty =
    Boolean(editing) &&
    renderVariantFingerprint !== savedRenderVariantFingerprint;

  const approvedTruthListQueryKey: ApprovedTruthListQueryKey = [
    "/internal/admin/approved-truth",
    trustFilter,
    splitFilter,
    rowStatusFilter,
    styleFilter,
    goldKindFilter,
    "",
    styleEvalSuiteFilter,
    truthShowCertified,
    truthPage,
  ];

  const listQuery = useQuery({
    queryKey: approvedTruthListQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (trustFilter) params.set("trustLevel", trustFilter);
      if (splitFilter) params.set("datasetSplit", splitFilter);
      if (rowStatusFilter) params.set("rowStatus", rowStatusFilter);
      if (styleFilter.trim()) params.set("expectedStyle", styleFilter.trim());
      if (goldKindFilter) params.set("goldKind", goldKindFilter);
      if (styleEvalSuiteFilter)
        params.set("styleEvaluationSuite", styleEvalSuiteFilter);
      params.set(
        "certificationView",
        truthShowCertified ? "certified" : "pending",
      );
      params.set("page", String(truthPage));
      params.set("limit", String(APPROVED_TRUTH_PAGE_SIZE));
      const qs = params.toString();
      return adminFetch<ApprovedTruthListResponse>(
        `/internal/admin/approved-truth${qs ? `?${qs}` : ""}`,
      );
    },
    placeholderData: (previousData) => previousData,
  });

  const statusQuery = useQuery({
    queryKey: ["/internal/admin/training-status"],
    queryFn: async () =>
      adminFetch<TrainingStatusResponse>("/internal/admin/training-status"),
    placeholderData: (previousData) => previousData,
  });

  const queueQuery = useQuery({
    queryKey: ["/internal/admin/learning-queue"],
    queryFn: async () =>
      adminFetch<LearningQueueRow[]>("/internal/admin/learning-queue"),
    placeholderData: (previousData) => previousData,
  });

  const frozenDatasetsQuery = useQuery({
    queryKey: ["/internal/admin/gold-datasets"],
    queryFn: async () =>
      adminFetch<{ items: FrozenGoldDatasetManifest[]; total: number }>(
        "/internal/admin/gold-datasets",
      ),
    placeholderData: (previousData) => previousData,
  });

  const editorDraftQuery = useQuery({
    queryKey: editorDraftQueryKey,
    queryFn: async () =>
      adminFetch<ApprovedTruthEditorDraftResponse>(
        "/internal/admin/approved-truth/editor-draft",
      ),
    retry: false,
    staleTime: 0,
  });

  const renderVariantsQuery = useQuery({
    queryKey: [
      "/internal/admin/approved-truth",
      editing?.id ?? null,
      "render-variants",
    ],
    queryFn: async () =>
      adminFetch<TruthRenderVariantListResponse>(
        `/internal/admin/approved-truth/${editing?.id}/render-variants`,
      ),
    enabled: editorOpen && Boolean(editing?.id),
  });

  const editorDraftDurable = editorDraftQuery.data?.durable;
  const editorDraftPersistenceBackend =
    editorDraftQuery.data?.persistenceBackend;
  const renderVariantItems = renderVariantsQuery.data?.items ?? [];
  const renderVariantStyleOrder = renderVariantsQuery.data?.styleOrder?.length
    ? renderVariantsQuery.data.styleOrder
    : TRUTH_RENDER_VARIANT_STYLE_ORDER;
  const renderVariantsErrorMessage =
    renderVariantsQuery.error instanceof Error
      ? renderVariantsQuery.error.message
      : "Failed to load linked style variants.";
  const renderVariantsByStyle = Object.fromEntries(
    renderVariantItems.map((item) => [item.style, item]),
  ) as Partial<Record<TruthRenderVariantStyle, ApprovedTruthRenderVariant>>;

  const setEditorFormFromDraftPayload = (
    payload: ApprovedTruthEditorDraftPayload,
    options: { editingRow?: ApprovedTruthRow | null; open?: boolean } = {},
  ) => {
    setEditing(options.editingRow ?? null);
    setFormRawText(payload.rawText);
    setFormExpectedFieldValues({
      ...buildBlankExpectedFieldValues(),
      ...payload.expectedFieldValues,
    });
    setFormEngineRenderedOutput(payload.engineRenderedOutput);
    setFormEnginePreviewWarnings(payload.enginePreviewWarnings);
    setFormEnginePreviewStale(payload.enginePreviewStale);
    setFormExpectedOutputDirty(payload.expectedOutputDirty);
    setFormShowMissingRequired(false);
    setFormExpectedType(payload.expectedType);
    setFormExpectedStyle(payload.expectedStyle);
    setFormProvenance(payload.provenance);
    setFormPipelineMajor(payload.pipelineMajor);
    setFormDatasetSplit(payload.datasetSplit);
    setFormTrustLevel(payload.trustLevel);
    setFormRowStatus(payload.rowStatus);
    setFormBlockedReason(payload.blockedReason);
    setFormGoldKind(payload.goldKind);
    setFormAdversarialPair(payload.adversarialPair);
    setFormNoiseProfile(payload.noiseProfile);
    setFormAdversarialPairTouched(false);
    setFormNoiseProfileTouched(false);
    setFormApprovalSource(payload.approvalSource);
    setFormReviewedBy(payload.reviewedBy);
    setFormAuditReasonCode(payload.auditReasonCode || "manual_correction");
    setFormNotes(payload.notes);
    if (options.open ?? true) {
      setEditorOpen(true);
    }
  };

  const buildCurrentEditorDraftPayload =
    (): ApprovedTruthEditorDraftPayload => ({
      mode: editing ? "edit" : "create",
      editingId: editing?.id ?? null,
      rawText: formRawText,
      expectedFieldValues: formExpectedFieldValues,
      engineRenderedOutput: formEngineRenderedOutput,
      enginePreviewWarnings: formEnginePreviewWarnings,
      enginePreviewStale: formEnginePreviewStale,
      expectedOutputDirty: formExpectedOutputDirty,
      expectedType: formExpectedType,
      expectedStyle: formExpectedStyle,
      provenance: formProvenance,
      pipelineMajor: formPipelineMajor,
      datasetSplit: formDatasetSplit,
      trustLevel: formTrustLevel,
      rowStatus: formRowStatus,
      blockedReason: formBlockedReason,
      goldKind: formGoldKind,
      adversarialPair: formAdversarialPair,
      noiseProfile: formNoiseProfile,
      approvalSource: formApprovalSource,
      reviewedBy: formReviewedBy,
      auditReasonCode: formAuditReasonCode,
      notes: formNotes,
    });

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorDraftSyncState("idle");
  };

  const resumeEditorDraft = async () => {
    if (!restorableEditorDraft) {
      return;
    }

    setResumeEditorDraftPending(true);
    try {
      let editingRow: ApprovedTruthRow | null = null;
      let resumeNotice: string | null = null;

      if (
        restorableEditorDraft.payload.mode === "edit" &&
        restorableEditorDraft.payload.editingId
      ) {
        try {
          editingRow = await adminFetch<ApprovedTruthRow>(
            `/internal/admin/approved-truth/${restorableEditorDraft.payload.editingId}`,
          );
        } catch (error) {
          if (error instanceof AdminRequestError && error.statusCode === 404) {
            resumeNotice =
              "The saved edit target no longer exists, so the draft was opened as a new truth row.";
          } else {
            resumeNotice =
              "The saved draft was opened, but the original truth row could not be reloaded.";
          }
        }
      }

      setEditorFormFromDraftPayload(restorableEditorDraft.payload, {
        editingRow,
      });
      setEditorDraftSavedAt(restorableEditorDraft.updatedAt);
      setEditorDraftSyncState("saved");
      setRestorableEditorDraft(null);

      if (resumeNotice) {
        toast({
          title: "Draft resumed",
          description: resumeNotice,
        });
      }
    } finally {
      setResumeEditorDraftPending(false);
    }
  };

  const discardEditorDraft = async (options: { close?: boolean } = {}) => {
    await adminFetch<{ ok: true; deleted: boolean }>(
      "/internal/admin/approved-truth/editor-draft",
      {
        method: "DELETE",
      },
    );
    setEditorDraftSavedAt(null);
    setEditorDraftSyncState("idle");
    setRestorableEditorDraft(null);
    editorDraftHydratedRef.current = true;
    await queryClient.invalidateQueries({ queryKey: editorDraftQueryKey });
    if (options.close) {
      setEditing(null);
      setFormShowMissingRequired(false);
      setEditorFormFromDraftPayload(
        buildBlankApprovedTruthEditorDraftPayload(),
        { open: false },
      );
      setEditorOpen(false);
    }
  };

  const clearEditorDraftState = () => {
    editorDraftRequestCounterRef.current += 1;
    setEditorDraftSavedAt(null);
    setEditorDraftSyncState("idle");
    queryClient.setQueryData<ApprovedTruthEditorDraftResponse>(
      editorDraftQueryKey,
      (current) => ({
        draft: null,
        persistenceBackend: current?.persistenceBackend ?? "memory",
        durable: current?.durable ?? false,
      }),
    );
  };

  const buildApprovedTruthFilterPayload =
    (): ApprovedTruthBulkFilterPayload => ({
      ...(trustFilter ? { trustLevel: trustFilter } : {}),
      ...(splitFilter ? { datasetSplit: splitFilter } : {}),
      ...(rowStatusFilter ? { rowStatus: rowStatusFilter } : {}),
      ...(goldKindFilter ? { goldKind: goldKindFilter } : {}),
      ...(styleFilter.trim() ? { expectedStyle: styleFilter.trim() } : {}),
      ...(styleEvalSuiteFilter
        ? { styleEvaluationSuite: styleEvalSuiteFilter }
        : {}),
      certificationView: truthShowCertified ? "certified" : "pending",
    });

  const clearTruthSelection = () => {
    setSelectedTruthIds([]);
    setAllFilteredTruthSelection(null);
  };

  const clearQueueSelection = () => {
    setSelectedQueueIds([]);
  };

  const invalidateTruth = () => {
    clearTruthSelection();
    clearQueueSelection();
    void queryClient.invalidateQueries({
      queryKey: ["/internal/admin/approved-truth"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["/internal/admin/learning-queue"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["/internal/admin/training-status"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["/internal/admin/gold-datasets"],
    });
  };

  const clearTruthRowHighlights = () => {
    setTruthRowHighlights({});
    setTruthHighlightSummary(null);
  };

  const setApprovedTruthCertificationView = (showCertified: boolean) => {
    setTruthShowCertified(showCertified);
    setTruthPage(1);
    clearTruthSelection();
    clearTruthRowHighlights();
  };

  const applyTruthRowHighlights = (
    operation: TruthBackgroundBulkOperation,
    results: TruthBulkResultRecord[],
  ) => {
    const nextHighlights: Record<string, TruthRowHighlight> = {};

    for (const result of results) {
      const tone = truthResultHighlightTone(operation, result.status);
      if (!tone) {
        continue;
      }
      nextHighlights[result.id] = {
        tone,
        operation,
        status: result.status,
        message: result.message,
        expiresAt: Date.now() + TRUTH_ROW_HIGHLIGHT_DURATION_MS,
      };
    }

    if (Object.keys(nextHighlights).length === 0) {
      return;
    }

    setTruthRowHighlights((current) => ({
      ...current,
      ...nextHighlights,
    }));
  };

  const updateFormExpectedFieldValue = (
    key: string,
    value: string,
    options: { source?: "user" | "system" } = {},
  ) => {
    setFormExpectedFieldValues((current) => ({
      ...current,
      [key]: value,
    }));
    if (key === EXPECTED_OUTPUT_FIELD_KEY) {
      setFormExpectedOutputDirty(options.source === "user");
      return;
    }
    setFormEnginePreviewStale(true);
  };

  const applyEditorRenderPreview = (
    preview: TruthRenderPreviewResponse,
    options: { seedExpectedOutput?: boolean } = {},
  ) => {
    const nextRenderedText = preview.renderedText.trim();
    const shouldSeedExpectedOutput = options.seedExpectedOutput ?? true;
    const currentExpectedOutput = normalizeWhitespace(
      formExpectedFieldValues[EXPECTED_OUTPUT_FIELD_KEY] ?? "",
    );

    setFormEngineRenderedOutput(nextRenderedText);
    setFormEnginePreviewWarnings(preview.warningCodes);
    setFormEnginePreviewStale(false);

    if (!shouldSeedExpectedOutput) {
      return;
    }

    if (!formExpectedOutputDirty || currentExpectedOutput.length === 0) {
      setFormExpectedFieldValues((current) => ({
        ...current,
        [EXPECTED_OUTPUT_FIELD_KEY]: nextRenderedText,
      }));
      setFormExpectedOutputDirty(false);
    }
  };

  const applyEditorPrefill = (prefill: TruthPrefillResponse) => {
    setFormExpectedFieldValues(
      expectedFieldsToFormValues(prefill.expectedFields),
    );
    setFormExpectedOutputDirty(false);
    setFormEngineRenderedOutput(prefill.renderedText.trim());
    setFormEnginePreviewWarnings(prefill.warnings);
    setFormEnginePreviewStale(false);
    if (prefill.expectedType) {
      setFormExpectedType(prefill.expectedType);
    }
    if (prefill.expectedStyle) {
      setFormExpectedStyle(prefill.expectedStyle);
    }
    setFormPipelineMajor(String(prefill.pipelineMajor));
  };

  async function runEditorEnginePrefillRequest(input: {
    rawText: string;
    outputStyle: string;
    successTitle?: string;
    emptyTitle?: string;
  }) {
    const prefill = await adminFetch<TruthPrefillResponse>(
      "/internal/admin/approved-truth/prefill",
      {
        method: "POST",
        body: JSON.stringify({
          rawText: input.rawText.trim(),
          outputStyle: input.outputStyle.trim() || "auto",
        }),
      },
    );
    applyEditorPrefill(prefill);
    const referenceNote =
      prefill.referenceCount > 1
        ? ` Seeded from citation ${prefill.usedReferenceIndex + 1} of ${prefill.referenceCount} detected references.`
        : "";
    toast({
      title:
        prefill.fieldCount > 0
          ? (input.successTitle ?? "Engine prefill applied")
          : (input.emptyTitle ?? "Engine prefill found no fields"),
      description:
        prefill.fieldCount > 0
          ? `Approved truth fields were seeded with ${prefill.fieldCount} populated values from the current local parser.${referenceNote}`
          : `The local parser did not return populated fields.${referenceNote}`,
      ...(prefill.fieldCount > 0 ? {} : { variant: "destructive" as const }),
    });
    return prefill;
  }

  async function runEditorRenderPreviewRequest(input: {
    rawText: string;
    expectedFields: Record<string, TruthFieldValue>;
    expectedType: string | null;
    expectedStyle: string;
    seedExpectedOutput?: boolean;
    suppressToast?: boolean;
  }) {
    const preview = await adminFetch<TruthRenderPreviewResponse>(
      "/internal/admin/approved-truth/render-preview",
      {
        method: "POST",
        body: JSON.stringify({
          rawText: input.rawText.trim(),
          expectedFields: input.expectedFields,
          expectedType: input.expectedType,
          expectedStyle: input.expectedStyle.trim() || "auto",
        }),
      },
    );
    applyEditorRenderPreview(preview, {
      seedExpectedOutput: input.seedExpectedOutput,
    });
    if (!input.suppressToast) {
      const warningNote =
        preview.warningCodes.length > 0 ? ` ${preview.warningCodes[0]}` : "";
      toast({
        title: "Engine output refreshed",
        description: `Generated preview output from ${preview.fieldCount} populated field${preview.fieldCount === 1 ? "" : "s"}.${warningNote}`,
      });
    }
    return preview;
  }

  const applyCrossrefEditorPrefill = (
    prefill: TruthCrossrefPrefillResponse,
  ) => {
    setFormExpectedFieldValues(
      expectedFieldsToFormValues(prefill.expectedFields),
    );
    setFormExpectedOutputDirty(false);
    if (prefill.expectedType) {
      setFormExpectedType(prefill.expectedType);
    }
    setFormEnginePreviewStale(true);
  };

  const prefillEditorMutation = useMutation({
    mutationFn: async () =>
      runEditorEnginePrefillRequest({
        rawText: formRawText,
        outputStyle: formExpectedStyle,
      }),
    onError: (error) => {
      toast({
        title: "Prefill failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not prefill this truth row.",
        variant: "destructive",
      });
    },
  });

  const crossrefEditorMutation = useMutation({
    mutationFn: async () =>
      adminFetch<TruthCrossrefPrefillResponse>(
        "/internal/admin/approved-truth/crossref-prefill",
        {
          method: "POST",
          body: JSON.stringify({
            rawText: formRawText.trim(),
            expectedFields: normalizeFlatExpectedFields(
              parseExpectedFieldFormValues(formExpectedFieldValues),
            ),
            provenance: formProvenance.trim() || null,
          }),
        },
      ),
    onSuccess: (prefill) => {
      applyCrossrefEditorPrefill(prefill);
      if (formExpectedStyle.trim()) {
        void runEditorRenderPreviewRequest({
          rawText: formRawText,
          expectedFields: normalizeFlatExpectedFields(prefill.expectedFields),
          expectedType:
            prefill.expectedType ?? (formExpectedType.trim() || null),
          expectedStyle: formExpectedStyle,
          suppressToast: true,
        }).catch(() => {
          setFormEnginePreviewStale(true);
        });
      }
      const warningNote =
        prefill.warnings.length > 0 ? ` ${prefill.warnings[0]}` : "";
      toast({
        title: "Crossref fill applied",
        description: `Replaced the approved truth fields with ${prefill.fieldCount} Crossref-backed values from DOI ${prefill.matchedDoi}.${warningNote}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Crossref fill failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not fill this truth row from Crossref.",
        variant: "destructive",
      });
    },
  });

  const renderPreviewEditorMutation = useMutation({
    mutationFn: async () =>
      runEditorRenderPreviewRequest({
        rawText: formRawText,
        expectedFields: normalizeFlatExpectedFields(
          parseExpectedFieldFormValues(formExpectedFieldValues),
        ),
        expectedType: formExpectedType.trim() || null,
        expectedStyle: formExpectedStyle,
      }),
    onError: (error) => {
      toast({
        title: "Engine output refresh failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not generate engine output from the current truth fields.",
        variant: "destructive",
      });
    },
  });

  const generateRenderVariantsMutation = useMutation({
    mutationFn: async (styles?: TruthRenderVariantStyle[]) => {
      if (!editing) {
        throw new Error(
          "Save this truth row before generating render variants.",
        );
      }
      return adminFetch<TruthRenderVariantListResponse>(
        `/internal/admin/approved-truth/${editing.id}/render-variants/generate`,
        {
          method: "POST",
          body: JSON.stringify(styles && styles.length > 0 ? { styles } : {}),
        },
      );
    },
    onSuccess: (payload, styles) => {
      invalidateTruth();
      setVariantTextOverrides((current) => {
        const next = { ...current };
        for (const style of styles ?? payload.styleOrder) {
          delete next[style];
        }
        return next;
      });
      setVariantNoteOverrides((current) => {
        const next = { ...current };
        for (const style of styles ?? payload.styleOrder) {
          delete next[style];
        }
        return next;
      });
      toast({
        title:
          styles && styles.length === 1
            ? "Variant regenerated"
            : "Six-style variants generated",
        description:
          styles && styles.length === 1
            ? `${TRUTH_RENDER_VARIANT_STYLE_LABELS[styles[0]]} was regenerated from the Expected fields and Expected type above.`
            : `Generated ${payload.items.length} linked render variants from the Expected fields and Expected type above.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Variant generation failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not generate style variants.",
        variant: "destructive",
      });
    },
  });

  const patchRenderVariantMutation = useMutation({
    mutationFn: async (input: {
      style: TruthRenderVariantStyle;
      renderedText: string;
      notes: string;
    }) => {
      if (!editing) {
        throw new Error("Save this truth row before editing render variants.");
      }
      const response = await adminFetch<{
        truthRowId: string;
        item: ApprovedTruthRenderVariant;
      }>(
        `/internal/admin/approved-truth/${editing.id}/render-variants/${input.style}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            renderedText: input.renderedText.trim(),
            notes: normalizeWhitespace(input.notes) || null,
          }),
        },
      );
      return response.item;
    },
    onSuccess: (item) => {
      invalidateTruth();
      setVariantTextOverrides((current) => {
        const next = { ...current };
        delete next[item.style];
        return next;
      });
      setVariantNoteOverrides((current) => {
        const next = { ...current };
        delete next[item.style];
        return next;
      });
      toast({
        title: "Variant saved",
        description: `${TRUTH_RENDER_VARIANT_STYLE_LABELS[item.style]} now uses the admin-authored render output.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Variant save failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not save this render variant.",
        variant: "destructive",
      });
    },
  });

  const approveRenderVariantMutation = useMutation({
    mutationFn: async (input: {
      style: TruthRenderVariantStyle;
      approved: boolean;
    }) => {
      if (!editing) {
        throw new Error(
          "Save this truth row before approving render variants.",
        );
      }
      const response = await adminFetch<{
        truthRowId: string;
        item: ApprovedTruthRenderVariant;
      }>(
        `/internal/admin/approved-truth/${editing.id}/render-variants/${input.style}/approve`,
        {
          method: "POST",
          body: JSON.stringify({
            approved: input.approved,
            approvedBy: formReviewedBy.trim() || null,
          }),
        },
      );
      return response.item;
    },
    onSuccess: (item, input) => {
      invalidateTruth();
      toast({
        title: input.approved ? "Variant approved" : "Variant unapproved",
        description: input.approved
          ? `${TRUTH_RENDER_VARIANT_STYLE_LABELS[item.style]} is now marked as approved gold-derived output.`
          : `${TRUTH_RENDER_VARIANT_STYLE_LABELS[item.style]} is no longer approved.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Variant approval failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not update variant approval.",
        variant: "destructive",
      });
    },
  });

  const resetRenderVariantMutation = useMutation({
    mutationFn: async (style: TruthRenderVariantStyle) => {
      if (!editing) {
        throw new Error(
          "Save this truth row before resetting render variants.",
        );
      }
      const response = await adminFetch<{
        truthRowId: string;
        item: ApprovedTruthRenderVariant;
      }>(
        `/internal/admin/approved-truth/${editing.id}/render-variants/${style}/reset`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      return response.item;
    },
    onSuccess: (item) => {
      invalidateTruth();
      setVariantTextOverrides((current) => {
        const next = { ...current };
        delete next[item.style];
        return next;
      });
      setVariantNoteOverrides((current) => {
        const next = { ...current };
        delete next[item.style];
        return next;
      });
      toast({
        title: "Variant reset",
        description: `${TRUTH_RENDER_VARIANT_STYLE_LABELS[item.style]} was restored to the latest generated output.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Variant reset failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not reset this render variant.",
        variant: "destructive",
      });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      if (selectedTruthIds.length < 2) {
        throw new Error("Select at least two approved truth rows first.");
      }
      return adminFetch<TruthBulkDeleteResponse>(
        "/internal/admin/approved-truth/delete-bulk",
        {
          method: "POST",
          body: JSON.stringify({ ids: selectedTruthIds }),
        },
      );
    },
    onSuccess: (result) => {
      invalidateTruth();
      const detail =
        result.failedCount > 0 ? ` ${result.failedCount} failed.` : "";
      toast({
        title: "Bulk delete complete",
        description: `Deleted ${result.deletedCount} approved-truth rows.${detail}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Bulk delete failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not delete the selected truth rows.",
        variant: "destructive",
      });
    },
  });

  const startTruthBackgroundJobMutation = useMutation({
    mutationFn: async (input: {
      operation: TruthBackgroundBulkOperation;
      ids?: string[];
      pageRange?: {
        startPage: number;
        endPage: number;
      };
      certify?: {
        task: TruthTask;
        truthScope: TruthScope;
        packTarget: TrainingPackTarget;
        status: TruthTaskCertificationStatus;
        certifiedBy: string | null;
        requiredReviewPasses: number;
        completedReviewPasses?: number;
        decisionHash: string | null;
      };
      update?: {
        trustLevel?: TruthTrustLevel;
        rowStatus?: TruthRowStatus;
        blockedReason?: TruthBlockedReason | null;
      };
    }) => {
      const hasIds = Boolean(input.ids && input.ids.length > 0);
      const payload = {
        operation: input.operation,
        ...(hasIds ? { ids: input.ids } : {}),
        ...(!hasIds
          ? {
              filters: buildApprovedTruthFilterPayload(),
              pageSize: APPROVED_TRUTH_PAGE_SIZE,
            }
          : {}),
        ...(input.pageRange ? { pageRange: input.pageRange } : {}),
        ...(input.certify ? { certify: input.certify } : {}),
        ...(input.update ? { update: input.update } : {}),
      };
      return adminFetch<TruthBackgroundBulkJobResponse>(
        "/internal/admin/approved-truth/background-bulk",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
  });

  async function startAllFilteredTruthJob(input: {
    operation: TruthBackgroundBulkOperation;
    ids?: string[];
    pageRangeOverride?: {
      startPage: number;
      endPage: number;
    };
    certify?: {
      task: TruthTask;
      truthScope: TruthScope;
      packTarget: TrainingPackTarget;
      status: TruthTaskCertificationStatus;
      certifiedBy: string | null;
      requiredReviewPasses: number;
      completedReviewPasses?: number;
      decisionHash: string | null;
    };
    update?: {
      trustLevel?: TruthTrustLevel;
      rowStatus?: TruthRowStatus;
      blockedReason?: TruthBlockedReason | null;
    };
    closeCertifyDialogOnSuccess?: boolean;
    closeBulkUpdateDialogOnSuccess?: boolean;
  }) {
    const normalizedIds = uniqueStrings(input.ids ?? []);
    const effectiveAllFilteredTruthSelection =
      normalizedIds.length === 0
        ? resolveAllFilteredTruthSelection(input.pageRangeOverride)
        : null;
    const activePageRange = effectiveAllFilteredTruthSelection
      ? {
          startPage: effectiveAllFilteredTruthSelection.pageStart,
          endPage: effectiveAllFilteredTruthSelection.pageEnd,
        }
      : undefined;
    const activePageProgress = effectiveAllFilteredTruthSelection
      ? {
          pageStart: effectiveAllFilteredTruthSelection.pageStart,
          pageEnd: effectiveAllFilteredTruthSelection.pageEnd,
          availableTotalPages:
            effectiveAllFilteredTruthSelection.availableTotalPages,
        }
      : undefined;
    try {
      if (!effectiveAllFilteredTruthSelection && normalizedIds.length === 0) {
        throw new Error("Select at least one approved truth row first.");
      }
      const job = await startTruthBackgroundJobMutation.mutateAsync({
        operation: input.operation,
        ...(normalizedIds.length > 0 ? { ids: normalizedIds } : {}),
        ...(activePageRange ? { pageRange: activePageRange } : {}),
        ...(input.certify ? { certify: input.certify } : {}),
        ...(input.update ? { update: input.update } : {}),
      });
      clearTruthSelection();
      if (input.closeCertifyDialogOnSuccess) {
        closeCertifyDialog();
      }
      if (input.closeBulkUpdateDialogOnSuccess) {
        closeBulkUpdateDialog();
      }
      truthBackgroundToastRef.current?.dismiss();
      const nextToast = toast({
        title: `${truthBackgroundOperationLabel(job.operation)} started`,
        description: buildTruthBackgroundPageProgressDescription(
          job,
          activePageProgress,
        ),
      });
      truthBackgroundToastRef.current = nextToast;
      truthBackgroundLastAppliedPageRef.current = {
        jobId: job.jobId,
        completedPage: 0,
      };
      setActiveTruthBackgroundJob({
        jobId: job.jobId,
        operation: job.operation,
        ...(input.update ? { update: { ...input.update } } : {}),
        ...(activePageProgress ? { pageProgress: activePageProgress } : {}),
      });
    } catch (error) {
      if (
        input.operation === "prefill" &&
        normalizedIds.length > 0 &&
        error instanceof AdminRequestError &&
        error.statusCode === 400
      ) {
        try {
          const result = await adminFetch<TruthBulkPrefillResponse>(
            "/internal/admin/approved-truth/prefill-bulk",
            {
              method: "POST",
              body: JSON.stringify({ ids: normalizedIds }),
            },
          );
          invalidateTruth();
          void queryClient.refetchQueries({
            queryKey: approvedTruthListQueryKey,
            exact: true,
          });
          void queryClient.refetchQueries({
            queryKey: ["/internal/admin/training-status"],
          });
          applyTruthRowHighlights("prefill", result.results);
          setTruthHighlightSummary(null);
          toast({
            title: buildSelectedPrefillCompletionTitle(result),
            description: buildSelectedPrefillCompletionDescription(result),
            ...(result.failedCount > 0
              ? { variant: "destructive" as const }
              : {}),
          });
          return;
        } catch (fallbackError) {
          toast({
            title: "Engine refill failed",
            description:
              fallbackError instanceof Error
                ? fallbackError.message
                : "Could not refill the selected approved-truth rows.",
            variant: "destructive",
          });
          return;
        }
      }

      toast({
        title: `${truthBackgroundOperationLabel(input.operation)} failed`,
        description:
          error instanceof Error
            ? error.message
            : "Could not start the approved-truth background job.",
        variant: "destructive",
      });
    }
  }

  async function runSelectedTruthPrefill(ids: string[]) {
    const normalizedIds = uniqueStrings(ids);
    if (normalizedIds.length === 0) {
      throw new Error("Select at least one approved truth row first.");
    }
    const result = await adminFetch<TruthBulkPrefillResponse>(
      "/internal/admin/approved-truth/prefill-bulk",
      {
        method: "POST",
        body: JSON.stringify({ ids: normalizedIds }),
      },
    );
    invalidateTruth();
    void queryClient.refetchQueries({
      queryKey: approvedTruthListQueryKey,
      exact: true,
    });
    void queryClient.refetchQueries({
      queryKey: ["/internal/admin/training-status"],
    });
    applyTruthRowHighlights("prefill", result.results);
    setTruthHighlightSummary(null);
    toast({
      title: buildSelectedPrefillCompletionTitle(result),
      description: buildSelectedPrefillCompletionDescription(result),
      ...(result.failedCount > 0 ? { variant: "destructive" as const } : {}),
    });
  }

  const bulkCertifyMutation = useMutation({
    mutationFn: async () => {
      if (!bulkCertifyIds || bulkCertifyIds.length < 2) {
        throw new Error("Select at least two approved truth rows first.");
      }
      if (certifyCompletedPasses >= 2 && !certifyDecisionHash.trim()) {
        throw new Error("Decision hash is required for blind pass 2.");
      }
      const result = await adminFetch<TruthBulkCertifyResponse>(
        "/internal/admin/approved-truth/certify-bulk",
        {
          method: "POST",
          body: JSON.stringify({
            ids: bulkCertifyIds,
            task: certifyTask,
            truthScope: certifyScope,
            packTarget: certifyPackTarget,
            status: certifyStatus,
            certifiedBy: certifyBy.trim() || null,
            requiredReviewPasses: certifyRequiredPasses,
            completedReviewPasses: certifyCompletedPasses,
            decisionHash: certifyDecisionHash.trim() || null,
          }),
        },
      );
      return { taskCount: 1, ...result };
    },
    onSuccess: (result) => {
      invalidateTruth();
      closeCertifyDialog();
      const detail =
        result.failedCount > 0
          ? ` ${result.failedCount} failed.`
          : result.quarantinedCount > 0
            ? ` ${result.quarantinedCount} quarantined.`
            : "";
      toast({
        title: "Bulk certification complete",
        description: `Certified ${result.certifiedCount} row-scope updates.${detail}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Bulk certification failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not certify the selected truth rows.",
        variant: "destructive",
      });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      if (!bulkUpdateIds || bulkUpdateIds.length < 1) {
        throw new Error("Select at least one approved truth row first.");
      }
      if (!bulkUpdateTrustLevel && !bulkUpdateRowStatus) {
        throw new Error("Choose at least one bulk field to update.");
      }
      if (bulkUpdateRowStatus === "quarantined" && !bulkUpdateBlockedReason) {
        throw new Error(
          "Blocked reason is required when row status is quarantined.",
        );
      }
      const result = await adminFetch<TruthBulkUpdateResponse>(
        "/internal/admin/approved-truth/update-bulk",
        {
          method: "POST",
          body: JSON.stringify({
            ids: bulkUpdateIds,
            ...(bulkUpdateTrustLevel
              ? { trustLevel: bulkUpdateTrustLevel }
              : {}),
            ...(bulkUpdateRowStatus ? { rowStatus: bulkUpdateRowStatus } : {}),
            ...(bulkUpdateRowStatus === "quarantined"
              ? { blockedReason: bulkUpdateBlockedReason || null }
              : {}),
          }),
        },
      );
      return result;
    },
    onSuccess: (result) => {
      invalidateTruth();
      closeBulkUpdateDialog();
      applyTruthRowHighlights("update", result.results);
      setTruthHighlightSummary(null);
      toast({
        title: buildBulkUpdateCompletionTitle(result),
        description: buildBulkUpdateCompletionDescription(result),
        ...(result.failedCount > 0 || result.quarantinedCount > 0
          ? { variant: "destructive" as const }
          : {}),
      });
    },
    onError: (error) => {
      toast({
        title: "Bulk update failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not update the selected truth rows.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!activeTruthBackgroundJob) {
      return;
    }

    let cancelled = false;

    const pollJob = async () => {
      try {
        const job = await adminFetch<TruthBackgroundBulkJobResponse>(
          `/internal/admin/approved-truth/background-bulk/${activeTruthBackgroundJob.jobId}`,
        );
        if (cancelled) {
          return;
        }

        const toastTitleBase = truthBackgroundOperationLabel(job.operation);
        const toastController = truthBackgroundToastRef.current;
        const lastAppliedPage = truthBackgroundLastAppliedPageRef.current;
        const absoluteRecentCompletedPage =
          job.recentCompletedPage !== null && job.recentCompletedPage > 0
            ? activeTruthBackgroundJob.pageProgress
              ? Math.min(
                  activeTruthBackgroundJob.pageProgress.pageEnd,
                  activeTruthBackgroundJob.pageProgress.pageStart +
                    job.recentCompletedPage -
                    1,
                )
              : job.recentCompletedPage
            : null;
        const lastSuccessfulPage =
          absoluteRecentCompletedPage ??
          (lastAppliedPage.jobId === job.jobId
            ? lastAppliedPage.completedPage
            : 0) ??
          0;
        if (toastController) {
          toastController.update({
            id: toastController.id,
            title:
              job.status === "completed"
                ? `${toastTitleBase} complete`
                : job.status === "failed"
                  ? `${toastTitleBase} failed`
                  : `${toastTitleBase} in progress`,
            description:
              job.status === "completed" || job.status === "failed"
                ? job.status === "failed"
                  ? buildTruthBackgroundFailureDescription({
                      message:
                        job.error ??
                        buildTruthBackgroundCompletionDescription(
                          job,
                          activeTruthBackgroundJob.pageProgress,
                        ),
                      lastSuccessfulPage,
                      pageProgress: activeTruthBackgroundJob.pageProgress,
                    })
                  : buildTruthBackgroundCompletionDescription(
                      job,
                      activeTruthBackgroundJob.pageProgress,
                    )
                : buildTruthBackgroundPageProgressDescription(
                    job,
                    activeTruthBackgroundJob.pageProgress,
                  ),
            ...(job.status === "failed"
              ? { variant: "destructive" as const }
              : {}),
          });
        }

        const recentPageReady =
          job.status === "running" &&
          absoluteRecentCompletedPage !== null &&
          absoluteRecentCompletedPage >
            (lastAppliedPage.jobId === job.jobId
              ? lastAppliedPage.completedPage
              : 0) &&
          job.recentResults.length > 0;

        if (recentPageReady) {
          applyTruthRowHighlights(job.operation, job.recentResults);
          setTruthHighlightSummary(
            buildTruthBackgroundHighlightSummary(
              job,
              activeTruthBackgroundJob.pageProgress,
            ),
          );
          truthBackgroundLastAppliedPageRef.current = {
            jobId: job.jobId,
            completedPage: absoluteRecentCompletedPage ?? 0,
          };
          if (absoluteRecentCompletedPage === truthPage) {
            void queryClient.invalidateQueries({
              queryKey: approvedTruthListQueryKey,
              exact: true,
            });
            void queryClient.refetchQueries({
              queryKey: approvedTruthListQueryKey,
              exact: true,
            });
          }
        }

        if (job.status === "completed" || job.status === "failed") {
          clearTruthSelection();
          if (
            job.status === "completed" &&
            (job.operation === "delete" || job.operation === "update")
          ) {
            reconcileApprovedTruthListCaches(queryClient, job, {
              update: activeTruthBackgroundJob.update,
            });
          }
          setActiveTruthBackgroundJob(null);
          void queryClient.invalidateQueries({
            queryKey: ["/internal/admin/approved-truth"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["/internal/admin/learning-queue"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["/internal/admin/training-status"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["/internal/admin/gold-datasets"],
          });
          void queryClient.refetchQueries({
            queryKey: approvedTruthListQueryKey,
            exact: true,
          });
          void queryClient.refetchQueries({
            queryKey: ["/internal/admin/training-status"],
          });

          const completedToastId = toastController?.id ?? null;
          const completionTitle = buildTruthBackgroundCompletionTitle(job);
          const completionDescription =
            job.status === "failed"
              ? buildTruthBackgroundFailureDescription({
                  message:
                    job.error ??
                    buildTruthBackgroundCompletionDescription(
                      job,
                      activeTruthBackgroundJob.pageProgress,
                    ),
                  lastSuccessfulPage,
                  pageProgress: activeTruthBackgroundJob.pageProgress,
                })
              : buildTruthBackgroundCompletionDescription(
                  job,
                  activeTruthBackgroundJob.pageProgress,
                );
          if (
            job.operation === "prefill" ||
            job.operation === "crossref" ||
            job.operation === "update"
          ) {
            applyTruthRowHighlights(job.operation, job.results);
          }
          setTruthHighlightSummary(
            job.status === "failed"
              ? buildTruthBackgroundLastSuccessfulPageDescription({
                  lastSuccessfulPage,
                  pageProgress: activeTruthBackgroundJob.pageProgress,
                })
              : buildTruthBackgroundCompletionDescription(
                  job,
                  activeTruthBackgroundJob.pageProgress,
                ),
          );
          truthBackgroundLastAppliedPageRef.current = {
            jobId: "",
            completedPage: 0,
          };
          if (completedToastId) {
            truthBackgroundToastRef.current?.dismiss();
            truthBackgroundToastRef.current = null;
          }
          toast({
            title: completionTitle,
            description: completionDescription,
            ...(job.status === "failed" || job.failedCount > 0
              ? { variant: "destructive" as const }
              : {}),
          });
          window.setTimeout(() => {
            if (!completedToastId) {
              return;
            }
            if (truthBackgroundToastRef.current?.id === completedToastId) {
              truthBackgroundToastRef.current.dismiss();
              truthBackgroundToastRef.current = null;
            }
          }, 3000);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Could not refresh approved-truth background progress.";
        const lastSuccessfulPage =
          truthBackgroundLastAppliedPageRef.current.completedPage;
        const failureDescription = buildTruthBackgroundFailureDescription({
          message,
          lastSuccessfulPage,
          pageProgress: activeTruthBackgroundJob.pageProgress,
        });
        if (truthBackgroundToastRef.current) {
          truthBackgroundToastRef.current.update({
            id: truthBackgroundToastRef.current.id,
            title: `${truthBackgroundOperationLabel(activeTruthBackgroundJob.operation)} failed`,
            description: failureDescription,
            variant: "destructive",
          });
        } else {
          toast({
            title: `${truthBackgroundOperationLabel(activeTruthBackgroundJob.operation)} failed`,
            description: failureDescription,
            variant: "destructive",
          });
        }
        const failedToastId = truthBackgroundToastRef.current?.id ?? null;
        if (failedToastId) {
          window.setTimeout(() => {
            if (truthBackgroundToastRef.current?.id === failedToastId) {
              truthBackgroundToastRef.current.dismiss();
              truthBackgroundToastRef.current = null;
            }
          }, 3000);
        }
        setActiveTruthBackgroundJob(null);
        setTruthHighlightSummary(
          buildTruthBackgroundLastSuccessfulPageDescription({
            lastSuccessfulPage,
            pageProgress: activeTruthBackgroundJob.pageProgress,
          }),
        );
        truthBackgroundLastAppliedPageRef.current = {
          jobId: "",
          completedPage: 0,
        };
        void queryClient.invalidateQueries({
          queryKey: ["/internal/admin/approved-truth"],
        });
        void queryClient.refetchQueries({
          queryKey: approvedTruthListQueryKey,
          exact: true,
        });
      }
    };

    void pollJob();
    const intervalId = window.setInterval(() => {
      void pollJob();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeTruthBackgroundJob,
    goldKindFilter,
    queryClient,
    rowStatusFilter,
    splitFilter,
    styleEvalSuiteFilter,
    styleFilter,
    toast,
    trustFilter,
    truthPage,
  ]);

  useEffect(() => {
    const entries = Object.entries(truthRowHighlights);
    if (entries.length === 0) {
      return;
    }

    const nextExpiry = Math.min(
      ...entries.map(([, highlight]) => highlight.expiresAt),
    );
    const timeoutMs = Math.max(0, nextExpiry - Date.now()) + 50;
    const timeoutId = window.setTimeout(() => {
      setTruthRowHighlights((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([, highlight]) => highlight.expiresAt > Date.now(),
          ),
        ),
      );
    }, timeoutMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [truthRowHighlights]);

  useEffect(() => {
    if (editorDraftHydratedRef.current || editorDraftQuery.isLoading) {
      return;
    }

    editorDraftHydratedRef.current = true;
    const storedDraft = editorDraftQuery.data?.draft;
    if (!storedDraft || editorOpen) {
      return;
    }
    setRestorableEditorDraft(storedDraft);
    setEditorDraftSavedAt(storedDraft.updatedAt);
    setEditorDraftSyncState("saved");
  }, [editorDraftQuery.data, editorDraftQuery.isLoading, editorOpen, toast]);

  useEffect(() => {
    if (!editorOpen || editorDraftQuery.isLoading) {
      return;
    }

    const payload = buildCurrentEditorDraftPayload();
    const shouldPersist = approvedTruthEditorDraftHasContent(payload);
    const hasStoredDraft = Boolean(editorDraftQuery.data?.draft);
    const timeoutId = window.setTimeout(() => {
      const requestId = ++editorDraftRequestCounterRef.current;

      if (!shouldPersist) {
        if (!hasStoredDraft) {
          setEditorDraftSavedAt(null);
          setEditorDraftSyncState("idle");
          return;
        }

        setEditorDraftSyncState("saving");
        void adminFetch<{ ok: true; deleted: boolean }>(
          "/internal/admin/approved-truth/editor-draft",
          {
            method: "DELETE",
          },
        )
          .then(() => {
            if (requestId !== editorDraftRequestCounterRef.current) {
              return;
            }
            setEditorDraftSavedAt(null);
            setEditorDraftSyncState("idle");
            queryClient.setQueryData<ApprovedTruthEditorDraftResponse>(
              editorDraftQueryKey,
              {
                draft: null,
                persistenceBackend: editorDraftPersistenceBackend ?? "memory",
                durable: editorDraftDurable ?? false,
              },
            );
          })
          .catch((error) => {
            if (requestId !== editorDraftRequestCounterRef.current) {
              return;
            }
            setEditorDraftSyncState("error");
            toast({
              title: "Draft autosave failed",
              description:
                error instanceof Error
                  ? error.message
                  : "Could not clear the saved approved-truth draft.",
              variant: "destructive",
            });
          });
        return;
      }

      setEditorDraftSyncState("saving");
      void adminFetch<ApprovedTruthEditorDraftResponse>(
        "/internal/admin/approved-truth/editor-draft",
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      )
        .then((response) => {
          if (requestId !== editorDraftRequestCounterRef.current) {
            return;
          }
          setEditorDraftSavedAt(
            response.draft?.updatedAt ?? new Date().toISOString(),
          );
          setEditorDraftSyncState("saved");
          queryClient.setQueryData(editorDraftQueryKey, response);
        })
        .catch((error) => {
          if (requestId !== editorDraftRequestCounterRef.current) {
            return;
          }
          setEditorDraftSyncState("error");
          toast({
            title: "Draft autosave failed",
            description:
              error instanceof Error
                ? error.message
                : "Could not persist the approved-truth editor draft.",
            variant: "destructive",
          });
        });
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    editorDraftDurable,
    editorDraftPersistenceBackend,
    editorDraftQuery.data?.draft,
    editorDraftQuery.isLoading,
    editorOpen,
    editing?.id,
    formAdversarialPair,
    formApprovalSource,
    formBlockedReason,
    formDatasetSplit,
    formEnginePreviewStale,
    formEnginePreviewWarnings,
    formEngineRenderedOutput,
    formExpectedFieldValues,
    formExpectedOutputDirty,
    formExpectedStyle,
    formExpectedType,
    formGoldKind,
    formNoiseProfile,
    formNotes,
    formPipelineMajor,
    formProvenance,
    formRawText,
    formAuditReasonCode,
    formReviewedBy,
    formRowStatus,
    formTrustLevel,
    queryClient,
    toast,
  ]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const expectedFields = buildCanonicalTruthFields(formExpectedFieldValues);
      const pipelineMajor = null;
      if (formRowStatus === "quarantined" && !formBlockedReason) {
        throw new Error(
          "Blocked reason is required when row status is quarantined.",
        );
      }
      if (formGoldKind === "style_adversarial" && !formAdversarialPair.trim()) {
        throw new Error(
          "Adversarial pair is required when gold kind is style_adversarial.",
        );
      }
      if (!formAuditReasonCode) {
        throw new Error("Audit reason is required for truth edits.");
      }
      return adminFetch<ApprovedTruthRow>("/internal/admin/approved-truth", {
        method: "POST",
        body: JSON.stringify({
          rawText: formRawText.trim(),
          expectedFields,
          expectedType: formExpectedType.trim() || null,
          expectedStyle: formExpectedStyle.trim() || null,
          provenance: formProvenance.trim() || null,
          pipelineMajor,
          datasetSplit: formDatasetSplit || null,
          trustLevel: formTrustLevel,
          rowStatus: formRowStatus,
          blockedReason: formBlockedReason || null,
          goldKind: formGoldKind || null,
          adversarialPair: formAdversarialPair.trim() || null,
          noiseProfile: parseNoiseProfile(formNoiseProfile),
          approvalSource: formApprovalSource || null,
          reviewedBy: formReviewedBy.trim() || null,
          auditReasonCode: formAuditReasonCode,
          notes: formNotes.trim() || null,
        }),
      });
    },
    onSuccess: (row) => {
      invalidateTruth();
      clearEditorDraftState();
      void discardEditorDraft().catch(() => undefined);
      openEdit(row);
      toast({
        title: "Saved",
        description:
          "Truth row created. You can review the six linked style variants below.",
      });
    },
    onError: (e) => {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Could not create row.",
        variant: "destructive",
      });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async () => {
      if (!editing) {
        throw new Error("Select a truth row before saving edits.");
      }
      const expectedFields = buildCanonicalTruthFields(formExpectedFieldValues);
      const pipelineMajor = editing.pipelineMajor ?? null;
      if (formRowStatus === "quarantined" && !formBlockedReason) {
        throw new Error(
          "Blocked reason is required when row status is quarantined.",
        );
      }
      if (formGoldKind === "style_adversarial" && !formAdversarialPair.trim()) {
        throw new Error(
          "Adversarial pair is required when gold kind is style_adversarial.",
        );
      }
      if (!formAuditReasonCode) {
        throw new Error("Audit reason is required for content edits.");
      }
      return adminFetch<ApprovedTruthRow>(
        `/internal/admin/approved-truth/${editing.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            rawText: formRawText.trim(),
            expectedFields,
            expectedType: formExpectedType.trim() || null,
            expectedStyle: formExpectedStyle.trim() || null,
            provenance: formProvenance.trim() || null,
            pipelineMajor,
            datasetSplit: formDatasetSplit || null,
            trustLevel: formTrustLevel,
            rowStatus: formRowStatus,
            blockedReason: formBlockedReason || null,
            goldKind: formGoldKind || null,
            adversarialPair: formAdversarialPair.trim() || null,
            noiseProfile: parseNoiseProfile(formNoiseProfile),
            approvalSource: formApprovalSource || null,
            reviewedBy: formReviewedBy.trim() || null,
            auditReasonCode: formAuditReasonCode,
            notes: formNotes.trim() || null,
          }),
        },
      );
    },
    onSuccess: (row) => {
      invalidateTruth();
      clearEditorDraftState();
      void discardEditorDraft().catch(() => undefined);
      openEdit(row);
      toast({
        title: "Updated",
        description:
          "Truth row saved. Linked style variants now use the latest Expected fields and Expected type.",
      });
    },
    onError: (e) => {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "Could not update row.",
        variant: "destructive",
      });
    },
  });

  const variantEditorLocked =
    !editing ||
    createMutation.isPending ||
    patchMutation.isPending ||
    prefillEditorMutation.isPending ||
    crossrefEditorMutation.isPending ||
    renderPreviewEditorMutation.isPending;

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return adminFetch<{ ok: true }>(`/internal/admin/approved-truth/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      invalidateTruth();
      toast({ title: "Deleted", description: "Truth row removed." });
    },
    onError: (e) => {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Could not delete row.",
        variant: "destructive",
      });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async () => {
      if (!promoteItem) return;
      const expectedFields = buildCanonicalTruthFields(
        promoteExpectedFieldValues,
      );
      if (promoteRowStatus === "quarantined" && !promoteBlockedReason) {
        throw new Error(
          "Blocked reason is required when row status is quarantined.",
        );
      }
      if (
        promoteGoldKind === "style_adversarial" &&
        !promoteAdversarialPair.trim()
      ) {
        throw new Error(
          "Adversarial pair is required when gold kind is style_adversarial.",
        );
      }
      if (!promoteAuditReasonCode) {
        throw new Error("Audit reason is required when promoting queue rows.");
      }
      return adminFetch<{ truth: ApprovedTruthRow }>(
        `/internal/admin/learning-queue/${promoteItem.id}/promote`,
        {
          method: "POST",
          body: JSON.stringify({
            rawText: promoteRaw.trim() || undefined,
            expectedFields,
            expectedType: promoteExpectedType.trim() || null,
            expectedStyle: promoteExpectedStyle.trim() || null,
            datasetSplit: promoteDatasetSplit || null,
            trustLevel: promoteTrust,
            rowStatus: promoteRowStatus,
            blockedReason: promoteBlockedReason || null,
            goldKind: promoteGoldKind || null,
            adversarialPair: promoteAdversarialPair.trim() || null,
            noiseProfile: parseNoiseProfile(promoteNoiseProfile),
            approvalSource: promoteApprovalSource || null,
            reviewedBy: promoteReviewedBy.trim() || null,
            auditReasonCode: promoteAuditReasonCode,
            notes: promoteNotes.trim() || null,
            provenance: "learning_queue",
          }),
        },
      );
    },
    onSuccess: () => {
      invalidateTruth();
      setPromoteItem(null);
      toast({
        title: "Promoted",
        description: "Queue row promoted to approved truth.",
      });
    },
    onError: (e) => {
      toast({
        title: "Promote failed",
        description: e instanceof Error ? e.message : "Could not promote row.",
        variant: "destructive",
      });
    },
  });

  const bulkQueueProcessMutation = useMutation({
    mutationFn: async () => {
      if (selectedQueueIds.length < 1) {
        throw new Error("Select at least one learning-queue row first.");
      }
      return adminFetch<LearningQueueBulkProcessResponse>(
        "/internal/admin/learning-queue/process-bulk",
        {
          method: "POST",
          body: JSON.stringify({ ids: selectedQueueIds }),
        },
      );
    },
    onSuccess: (result) => {
      invalidateTruth();
      const detail =
        result.failedCount > 0 ? ` ${result.failedCount} failed.` : "";
      toast({
        title: "Learning queue updated",
        description: `Marked ${result.processedCount} selected queue groups processed.${detail}`,
        ...(result.failedCount > 0 ? { variant: "destructive" as const } : {}),
      });
    },
    onError: (error) => {
      toast({
        title: "Bulk process failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not update the selected queue rows.",
        variant: "destructive",
      });
    },
  });

  const bulkQueueRevertMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length < 1) {
        throw new Error(
          "Select at least one processed learning-queue row first.",
        );
      }
      return adminFetch<LearningQueueBulkRevertResponse>(
        "/internal/admin/learning-queue/revert-bulk",
        {
          method: "POST",
          body: JSON.stringify({ ids }),
        },
      );
    },
    onSuccess: (result) => {
      invalidateTruth();
      const detail =
        result.failedCount > 0 ? ` ${result.failedCount} failed.` : "";
      toast({
        title: "Learning queue reverted",
        description: `Moved ${result.revertedCount} queue groups back to pending.${detail}`,
        ...(result.failedCount > 0 ? { variant: "destructive" as const } : {}),
      });
    },
    onError: (error) => {
      toast({
        title: "Revert failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not revert the selected queue rows.",
        variant: "destructive",
      });
    },
  });

  const bulkQueuePromoteMutation = useMutation({
    mutationFn: async () => {
      if (!bulkQueuePromoteIds || bulkQueuePromoteIds.length < 1) {
        throw new Error("Select at least one learning-queue row first.");
      }
      if (
        bulkQueuePromoteRowStatus === "quarantined" &&
        !bulkQueuePromoteBlockedReason
      ) {
        throw new Error(
          "Blocked reason is required when row status is quarantined.",
        );
      }
      if (
        bulkQueuePromoteGoldKind === "style_adversarial" &&
        !bulkQueuePromoteAdversarialPair.trim()
      ) {
        throw new Error(
          "Adversarial pair is required when gold kind is style_adversarial.",
        );
      }
      if (!bulkQueuePromoteAuditReasonCode) {
        throw new Error("Audit reason is required when promoting queue rows.");
      }
      return adminFetch<LearningQueueBulkPromoteResponse>(
        "/internal/admin/learning-queue/promote-bulk",
        {
          method: "POST",
          body: JSON.stringify({
            ids: bulkQueuePromoteIds,
            expectedType: bulkQueuePromoteExpectedType.trim() || null,
            expectedStyle: bulkQueuePromoteExpectedStyle.trim() || null,
            datasetSplit: bulkQueuePromoteDatasetSplit || null,
            trustLevel: bulkQueuePromoteTrust,
            rowStatus: bulkQueuePromoteRowStatus,
            blockedReason: bulkQueuePromoteBlockedReason || null,
            goldKind: bulkQueuePromoteGoldKind || null,
            adversarialPair: bulkQueuePromoteAdversarialPair.trim() || null,
            noiseProfile: parseNoiseProfile(bulkQueuePromoteNoiseProfile),
            approvalSource: bulkQueuePromoteApprovalSource || null,
            reviewedBy: bulkQueuePromoteReviewedBy.trim() || null,
            auditReasonCode: bulkQueuePromoteAuditReasonCode,
            notes: bulkQueuePromoteNotes.trim() || null,
            provenance: "learning_queue",
          }),
        },
      );
    },
    onSuccess: (result) => {
      invalidateTruth();
      closeBulkQueuePromoteDialog();
      const details = [
        result.quarantinedCount > 0
          ? `${result.quarantinedCount} quarantined.`
          : null,
        result.failedCount > 0 ? `${result.failedCount} failed.` : null,
      ]
        .filter(Boolean)
        .join(" ");
      toast({
        title: "Bulk promote complete",
        description: `Promoted ${result.promotedCount} queue groups.${details ? ` ${details}` : ""}`,
        ...(result.failedCount > 0 ? { variant: "destructive" as const } : {}),
      });
    },
    onError: (error) => {
      toast({
        title: "Bulk promote failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not promote the selected queue rows.",
        variant: "destructive",
      });
    },
  });

  const certifyMutation = useMutation({
    mutationFn: async () => {
      if (!certifyRow) {
        throw new Error("No row selected for certification.");
      }
      if (certifyCompletedPasses >= 2 && !certifyDecisionHash.trim()) {
        throw new Error("Decision hash is required for blind pass 2.");
      }
      const result = await adminFetch<{
        ok: boolean;
        reason?: string;
        truth: ApprovedTruthRow;
        stagedPack?: {
          packTarget: TrainingPackTarget;
          stagedBundleId: string;
          rowCount: number;
        } | null;
      }>(`/internal/admin/approved-truth/${certifyRow.id}/certify`, {
        method: "POST",
        body: JSON.stringify({
          task: certifyTask,
          truthScope: certifyScope,
          packTarget: certifyPackTarget,
          status: certifyStatus,
          certifiedBy: certifyBy.trim() || null,
          requiredReviewPasses: certifyRequiredPasses,
          completedReviewPasses: certifyCompletedPasses,
          decisionHash: certifyDecisionHash.trim() || null,
        }),
      });
      return { taskCount: 1, last: result };
    },
    onSuccess: (payload) => {
      invalidateTruth();
      closeCertifyDialog();
      toast({
        title: "Certification staged",
        description: payload.last.stagedPack
          ? `Pushed to ${payload.last.stagedPack.packTarget} (${payload.last.stagedPack.rowCount} staged rows).`
          : "Updated task scope for this row.",
      });
    },
    onError: (e) => {
      toast({
        title: "Certification failed",
        description: e instanceof Error ? e.message : "Could not certify row.",
        variant: "destructive",
      });
    },
  });

  const buildAuthorityPackMutation = useMutation({
    mutationFn: async () =>
      adminFetch<{
        version: string;
        sourceRows: number;
        doiExactHints: number;
        journalIssnHints: number;
      }>("/internal/admin/authority-pack/build", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (payload) => {
      invalidateTruth();
      toast({
        title: "Parser hints updated",
        description: `${payload.version} with ${payload.doiExactHints} DOI hints and ${payload.journalIssnHints} journal/ISSN hints.`,
      });
    },
    onError: (e) => {
      toast({
        title: "Parser hint update failed",
        description:
          e instanceof Error
            ? e.message
            : "Could not push reviewed hints to the parser.",
        variant: "destructive",
      });
    },
  });

  const buildSelectedTrainingPackMutation = useMutation({
    mutationFn: async () => {
      if (buildPackTarget === "style_core_gold") {
        const freezeTargetVersion =
          freezeDatasetVersion.trim() || styleBundleDatasetVersion.trim();
        return adminFetch<{
          ok: boolean;
          datasetVersion: string;
          reused: boolean;
          failures?: Array<{ code: string; message: string }>;
          manifest?: FrozenGoldDatasetManifest;
        }>("/internal/admin/gold-datasets/freeze", {
          method: "POST",
          body: JSON.stringify({
            ...(freezeTargetVersion
              ? { datasetVersion: freezeTargetVersion }
              : {}),
            includeHoldout: false,
            enforceDiversityGates: true,
          }),
        });
      }

      if (buildPackTarget === "authority_pack") {
        return adminFetch<{
          version: string;
          sourceRows: number;
          doiExactHints: number;
          journalIssnHints: number;
        }>("/internal/admin/authority-pack/build", {
          method: "POST",
          body: JSON.stringify({}),
        });
      }

      if (buildPackTarget === "citation_bio_supervision") {
        return adminFetch<{ export: { rowCount: number; outputPath: string } }>(
          "/internal/admin/bio-dataset/export-supervision",
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        );
      }

      return adminFetch<{
        ok: boolean;
        manifest: {
          packTarget: TrainingPackTarget;
          stagedBundleId: string;
          rowCount: number;
          outputPath: string;
        };
      }>(`/internal/admin/training-packs/${buildPackTarget}/build`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: (payload) => {
      invalidateTruth();
      if ("datasetVersion" in payload) {
        setFreezeDatasetVersion(payload.datasetVersion);
        setStyleBundleDatasetVersion(payload.datasetVersion);
        toast({
          title: payload.reused
            ? "Gold dataset already built"
            : "Gold dataset built",
          description: `${payload.datasetVersion}${payload.manifest ? ` (${payload.manifest.rowCount} rows)` : ""}`,
        });
        return;
      }
      if ("doiExactHints" in payload) {
        toast({
          title: "Authority pack built",
          description: `${payload.version} with ${payload.doiExactHints} DOI hints and ${payload.journalIssnHints} journal/ISSN hints.`,
        });
        return;
      }
      if ("export" in payload) {
        toast({
          title: "BIO supervision dataset exported",
          description: `${payload.export.rowCount} rows written to ${payload.export.outputPath}.`,
        });
        return;
      }
      toast({
        title: "Training pack staged",
        description: `${payload.manifest.stagedBundleId} (${payload.manifest.rowCount} rows).`,
      });
    },
    onError: (e) => {
      toast({
        title: "Training pack build failed",
        description:
          e instanceof Error
            ? e.message
            : "Could not build the selected training pack.",
        variant: "destructive",
      });
    },
  });

  const freezeStyleDatasetMutation = useMutation({
    mutationFn: async () => {
      const freezeTargetVersion =
        freezeDatasetVersion.trim() || styleBundleDatasetVersion.trim();
      return adminFetch<{
        ok: boolean;
        datasetVersion: string;
        reused: boolean;
        failures?: Array<{ code: string; message: string }>;
        manifest?: FrozenGoldDatasetManifest;
      }>("/internal/admin/gold-datasets/freeze", {
        method: "POST",
        body: JSON.stringify({
          ...(freezeTargetVersion
            ? { datasetVersion: freezeTargetVersion }
            : {}),
          includeHoldout: false,
          enforceDiversityGates: true,
        }),
      });
    },
    onSuccess: (payload) => {
      invalidateTruth();
      setFreezeDatasetVersion(payload.datasetVersion);
      setStyleBundleDatasetVersion(payload.datasetVersion);
      toast({
        title: payload.reused
          ? "Gold dataset already built"
          : "Gold dataset built",
        description: `${payload.datasetVersion}${payload.manifest ? ` (${payload.manifest.rowCount} rows)` : ""}`,
      });
    },
    onError: (e) => {
      toast({
        title: "Gold dataset build failed",
        description:
          e instanceof Error ? e.message : "Could not build the gold dataset.",
        variant: "destructive",
      });
    },
  });

  const buildStyleBundleMutation = useMutation({
    mutationFn: async () => {
      const nextStyleBundleVersion =
        styleBundleVersion.trim() || buildAutoStyleBundleVersion();
      const nextDatasetVersion = styleBundleDatasetVersion.trim();
      return adminFetch<{
        version: string;
        datasetVersion?: string | null;
        exportSummary: { rowCount: number };
      }>("/internal/admin/style-bundle/build", {
        method: "POST",
        body: JSON.stringify({
          version: nextStyleBundleVersion,
          ...(nextDatasetVersion ? { datasetVersion: nextDatasetVersion } : {}),
        }),
      });
    },
    onSuccess: (payload) => {
      invalidateTruth();
      setStyleBundleVersion(payload.version);
      setStyleBundleVersionManuallyEdited(false);
      if (payload.datasetVersion) {
        setStyleBundleDatasetVersion(payload.datasetVersion);
      }
      toast({
        title: "Style model trained",
        description: `${payload.version} trained from ${payload.exportSummary.rowCount} certified style/core rows${payload.datasetVersion ? ` (dataset ${payload.datasetVersion})` : ""}.`,
      });
    },
    onError: (e) => {
      toast({
        title: "Style model training failed",
        description:
          e instanceof Error ? e.message : "Could not train the style model.",
        variant: "destructive",
      });
    },
  });

  const promoteStyleBundleMutation = useMutation({
    mutationFn: async () => {
      if (!styleBundleVersion.trim()) {
        throw new Error(
          "Enter a staged style-bundle version before promoting.",
        );
      }
      return adminFetch<{
        version: string;
        styleBundle: { current: { modelVersion: string | null } | null };
      }>("/internal/admin/style-bundle/promote", {
        method: "POST",
        body: JSON.stringify({ version: styleBundleVersion.trim() }),
      });
    },
    onSuccess: (payload) => {
      invalidateTruth();
      toast({
        title: "Style model is now live",
        description:
          payload.styleBundle.current?.modelVersion ?? payload.version,
      });
    },
    onError: (e) => {
      toast({
        title: "Could not make the style model live",
        description:
          e instanceof Error
            ? e.message
            : "Could not switch the engine to the selected style model.",
        variant: "destructive",
      });
    },
  });

  function openCreate() {
    clearEditorDraftState();
    setVariantTextOverrides({});
    setVariantNoteOverrides({});
    setActiveRenderVariantStyle("apa7");
    setEditorGovernanceOpen(false);
    setEditorJsonPreviewOpen(false);
    setEditorFormFromDraftPayload(buildBlankApprovedTruthEditorDraftPayload());
  }

  function openEdit(row: ApprovedTruthRow) {
    const nextExpectedFieldValues = expectedFieldsToFormValues(
      savedTruthFieldsForRow(row),
    );
    clearEditorDraftState();
    setVariantTextOverrides({});
    setVariantNoteOverrides({});
    setActiveRenderVariantStyle("apa7");
    setEditorGovernanceOpen(
      Boolean(
        (row.datasetSplit ?? "").trim() ||
        row.trustLevel !== "reviewed" ||
        (row.rowStatus ?? "reviewed") !== "reviewed" ||
        (row.blockedReason ?? "").trim() ||
        (row.goldKind ?? "").trim() ||
        (row.approvalSource ?? "").trim() ||
        (row.adversarialPair ?? "").trim() ||
        formatNoiseProfile(row.noiseProfile).trim() ||
        (row.reviewedBy ?? "").trim(),
      ),
    );
    setEditorJsonPreviewOpen(false);
    setEditorFormFromDraftPayload(
      {
        mode: "edit",
        editingId: row.id,
        rawText: row.rawText,
        expectedFieldValues: nextExpectedFieldValues,
        engineRenderedOutput: "",
        enginePreviewWarnings: [],
        enginePreviewStale: false,
        expectedOutputDirty: false,
        expectedType: row.expectedType ?? "",
        expectedStyle: row.expectedStyle ?? "",
        provenance: row.provenance ?? "",
        pipelineMajor:
          row.pipelineMajor != null ? String(row.pipelineMajor) : "",
        datasetSplit: row.datasetSplit ?? "",
        trustLevel: row.trustLevel,
        rowStatus:
          row.rowStatus ?? (row.trustLevel === "draft" ? "draft" : "reviewed"),
        blockedReason: row.blockedReason ?? "",
        goldKind: row.goldKind ?? "",
        adversarialPair: row.adversarialPair ?? "",
        noiseProfile: formatNoiseProfile(row.noiseProfile),
        approvalSource: row.approvalSource ?? "",
        reviewedBy: row.reviewedBy ?? "",
        auditReasonCode: row.auditReasonCode ?? "manual_correction",
        notes: row.notes ?? "",
      },
      { editingRow: row },
    );
    if ((row.expectedStyle ?? "").trim()) {
      void runEditorRenderPreviewRequest({
        rawText: row.rawText,
        expectedFields: normalizeFlatExpectedFields(
          parseExpectedFieldFormValues(nextExpectedFieldValues),
        ),
        expectedType: row.expectedType ?? null,
        expectedStyle: row.expectedStyle ?? "",
        suppressToast: true,
      }).catch(() => {
        setFormEnginePreviewStale(true);
      });
    }
    if (truthRowNeedsAutomaticEnginePrefill(row) && row.rawText.trim()) {
      void runEditorEnginePrefillRequest({
        rawText: row.rawText,
        outputStyle: row.expectedStyle ?? "",
        successTitle: "Engine prefill applied automatically",
        emptyTitle: "Engine prefill found no fields",
      }).catch((error) => {
        toast({
          title: "Automatic engine prefill failed",
          description:
            error instanceof Error
              ? error.message
              : "Could not seed this sparse truth row from the local parser.",
          variant: "destructive",
        });
      });
    }
  }

  function openPromote(row: LearningQueueRow) {
    setPromoteItem(row);
    setPromoteGovernanceOpen(false);
    setPromoteJsonPreviewOpen(false);
    setPromoteRaw(normalizedRawInputFromQueue(row.trainingData));
    setPromoteExpectedFieldValues(
      defaultExpectedFieldsFromQueue(row.trainingData),
    );
    setPromoteShowMissingRequired(false);
    setPromoteExpectedType("");
    setPromoteExpectedStyle("");
    setPromoteDatasetSplit("train");
    setPromoteTrust("reviewed");
    setPromoteRowStatus("reviewed");
    setPromoteBlockedReason("");
    setPromoteGoldKind("");
    setPromoteAdversarialPair("");
    setPromoteNoiseProfile("");
    setPromoteAdversarialPairTouched(false);
    setPromoteNoiseProfileTouched(false);
    setPromoteApprovalSource("learning_queue");
    setPromoteReviewedBy("");
    setPromoteAuditReasonCode("manual_correction");
    setPromoteNotes("");
  }

  function resetBulkQueuePromoteForm() {
    setBulkQueuePromoteGovernanceOpen(false);
    setBulkQueuePromoteExpectedType("");
    setBulkQueuePromoteExpectedStyle("");
    setBulkQueuePromoteDatasetSplit("train");
    setBulkQueuePromoteTrust("reviewed");
    setBulkQueuePromoteRowStatus("reviewed");
    setBulkQueuePromoteBlockedReason("");
    setBulkQueuePromoteGoldKind("");
    setBulkQueuePromoteAdversarialPair("");
    setBulkQueuePromoteNoiseProfile("");
    setBulkQueuePromoteAdversarialPairTouched(false);
    setBulkQueuePromoteApprovalSource("learning_queue");
    setBulkQueuePromoteReviewedBy("");
    setBulkQueuePromoteAuditReasonCode("manual_correction");
    setBulkQueuePromoteNotes("");
  }

  function closeBulkQueuePromoteDialog() {
    setBulkQueuePromoteIds(null);
    resetBulkQueuePromoteForm();
  }

  function openBulkQueuePromoteDialog(ids: string[]) {
    setBulkQueuePromoteIds(ids);
    resetBulkQueuePromoteForm();
  }

  function resetCertifyForm(certifiedBy = "") {
    setCertifyTask("style");
    setCertifyScope("core");
    setCertifyPackTarget("style_core_gold");
    setCertifyStatus("certified");
    setCertifyRequiredPasses(1);
    setCertifyCompletedPasses(1);
    setCertifyBy(certifiedBy);
    setCertifyDecisionHash("");
  }

  function closeCertifyDialog() {
    setCertifyRow(null);
    setBulkCertifyIds(null);
    setBulkCertifyAllFiltered(null);
  }

  function openCertify(row: ApprovedTruthRow) {
    setBulkCertifyIds(null);
    setBulkCertifyAllFiltered(null);
    setCertifyRow(row);
    resetCertifyForm(row.reviewedBy ?? "");
  }

  function openBulkCertify(ids: string[]) {
    setCertifyRow(null);
    setBulkCertifyIds(ids);
    setBulkCertifyAllFiltered(null);
    resetCertifyForm("");
  }

  function openAllFilteredBulkCertify(selection: AllFilteredTruthSelection) {
    setCertifyRow(null);
    setBulkCertifyIds(null);
    setBulkCertifyAllFiltered(selection);
    resetCertifyForm("");
  }

  function resetBulkUpdateForm() {
    setBulkUpdateTrustLevel("");
    setBulkUpdateRowStatus("");
    setBulkUpdateBlockedReason("");
  }

  function closeBulkUpdateDialog() {
    setBulkUpdateIds(null);
    setBulkUpdateAllFiltered(null);
    resetBulkUpdateForm();
  }

  function openBulkUpdate(ids: string[]) {
    setBulkUpdateIds(ids);
    setBulkUpdateAllFiltered(null);
    resetBulkUpdateForm();
  }

  function openAllFilteredBulkUpdate(selection: AllFilteredTruthSelection) {
    setBulkUpdateIds(null);
    setBulkUpdateAllFiltered(selection);
    resetBulkUpdateForm();
  }

  async function handleExport() {
    try {
      const params = new URLSearchParams();
      params.set(
        "excludeHoldout",
        exportHoldoutVersion.trim() ? "false" : "true",
      );
      params.set("task", exportTask);
      params.set("truthScope", exportTruthScope);
      params.set("certifiedOnly", exportCertifiedOnly ? "true" : "false");
      params.set(
        "excludeQuarantined",
        exportExcludeQuarantined ? "true" : "false",
      );
      if (trustFilter) params.set("trustLevel", trustFilter);
      if (splitFilter) params.set("datasetSplit", splitFilter);
      if (rowStatusFilter) params.set("rowStatus", rowStatusFilter);
      if (styleFilter.trim()) params.set("expectedStyle", styleFilter.trim());
      if (goldKindFilter) params.set("goldKind", goldKindFilter);
      if (styleEvalSuiteFilter)
        params.set("styleEvaluationSuite", styleEvalSuiteFilter);
      if (exportHoldoutVersion.trim())
        params.set("holdoutVersion", exportHoldoutVersion.trim());
      if (exportDatasetVersion.trim())
        params.set("datasetVersion", exportDatasetVersion.trim());
      if (exportStyleEvaluationSuite)
        params.set("styleEvaluationSuite", exportStyleEvaluationSuite);
      const { blob, filename } = await adminDownloadBlob(
        `/internal/admin/training-export?${params.toString()}`,
      );
      downloadBrowserBlob(blob, filename ?? "training-export.jsonl");
      toast({
        title: "Export started",
        description: "NDJSON download should begin shortly.",
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description:
          e instanceof Error ? e.message : "Could not download export.",
        variant: "destructive",
      });
    }
  }

  function handleLearningQueueExport() {
    try {
      const exportText = buildLearningQueueExportText(queueFiltered);
      if (!exportText) {
        toast({
          title: "Nothing to export",
          description:
            "The current learning queue view has no references to export.",
        });
        return;
      }

      const exportedCount = exportText.split("\n\n").length;
      downloadBrowserBlob(
        new Blob([`${exportText}\n`], { type: "text/plain;charset=utf-8" }),
        buildLearningQueueExportFilename(),
      );
      toast({
        title: "Export started",
        description: `Downloaded ${exportedCount} learning queue references as TXT.`,
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description:
          e instanceof Error
            ? e.message
            : "Could not export learning queue references.",
        variant: "destructive",
      });
    }
  }

  const items = listQuery.data?.items ?? [];
  const truthTotal = listQuery.data?.total ?? 0;
  const truthTotalPages = listQuery.data?.totalPages ?? 0;
  const allFilteredTruthSelected = allFilteredTruthSelection !== null;
  const selectedTruthCount = allFilteredTruthSelected
    ? allFilteredTruthSelection.totalRows
    : selectedTruthIds.length;
  const selectedTruthIdSet = new Set(selectedTruthIds);
  const visibleTruthIds = items.map((row) => row.id);
  const totalTruthHighlightCount = Object.keys(truthRowHighlights).length;
  const allVisibleTruthIdsSelected =
    visibleTruthIds.length > 0 &&
    visibleTruthIds.every((id) => selectedTruthIdSet.has(id));
  const showSelectAllPagesOption =
    !allFilteredTruthSelected && truthTotal >= 2 && truthTotalPages > 1;
  const allVisibleTruthSelected =
    visibleTruthIds.length > 0 &&
    (allFilteredTruthSelected || allVisibleTruthIdsSelected);
  const queue = queueQuery.data ?? [];
  const queueRowById = new Map(queue.map((row) => [row.id, row]));
  const pendingQueueCount = queue.filter((row) => !row.processed).length;
  const processedQueueCount = queue.length - pendingQueueCount;
  const queueFiltered = queue
    .filter((q) => (queueShowProcessed ? q.processed : !q.processed))
    .sort((left, right) => {
      if (!queueShowProcessed) {
        return 0;
      }
      const leftProcessedAt = left.processedAt ?? left.createdAt;
      const rightProcessedAt = right.processedAt ?? right.createdAt;
      const processedCompare = rightProcessedAt.localeCompare(leftProcessedAt);
      return processedCompare !== 0
        ? processedCompare
        : left.id.localeCompare(right.id);
    });
  const queueSelectableRows = queueFiltered.filter((row) => !row.processed);
  const queueSelectableIds = queueSelectableRows.map((row) => row.id);
  const selectedQueueIdSet = new Set(selectedQueueIds);
  const selectedQueueRows = selectedQueueIds
    .map((id) => queueRowById.get(id))
    .filter((row): row is LearningQueueRow => Boolean(row));
  const selectedQueueUnderlyingCount = selectedQueueRows.reduce(
    (sum, row) => sum + (row.duplicateCount ?? 1),
    0,
  );
  const allVisibleQueueSelected =
    queueSelectableIds.length > 0 &&
    queueSelectableIds.every((id) => selectedQueueIdSet.has(id));
  const queueSelectionSummary =
    selectedQueueUnderlyingCount > selectedQueueRows.length
      ? `${selectedQueueRows.length} groups selected • ${selectedQueueUnderlyingCount} underlying refs`
      : `${selectedQueueRows.length} selected`;
  const bulkQueuePromoteRows = bulkQueuePromoteIds
    ? bulkQueuePromoteIds
        .map((id) => queueRowById.get(id))
        .filter((row): row is LearningQueueRow => Boolean(row))
    : [];
  const bulkQueuePromoteGroupCount = bulkQueuePromoteRows.length;
  const bulkQueuePromoteUnderlyingCount = bulkQueuePromoteRows.reduce(
    (sum, row) => sum + (row.duplicateCount ?? 1),
    0,
  );
  const bulkQueuePromoteDialogOpen = bulkQueuePromoteIds !== null;
  const trainingStatus = statusQuery.data;
  const benchmarkStatus =
    trainingStatus?.benchmark?.latestCanonicalParallel ?? null;
  const stagedStyleBundleVersions = uniqueStrings(
    trainingStatus?.styleBundle.stagedVersions ?? [],
  );
  const frozenDatasets = uniqueFrozenDatasetsByVersion(
    frozenDatasetsQuery.data?.items ?? [],
  );
  const editingSparseTruth = editing ? truthRowIsSparse(editing) : false;
  const bulkCertifyRowCount = bulkCertifyAllFiltered
    ? bulkCertifyAllFiltered.totalRows
    : (bulkCertifyIds?.length ?? 0);
  const bulkCertifyPageCount = bulkCertifyAllFiltered?.totalPages ?? null;
  const bulkCertifyDialogOpen =
    certifyRow !== null ||
    bulkCertifyIds !== null ||
    bulkCertifyAllFiltered !== null;

  useEffect(() => {
    if (frozenDatasets.length === 0) {
      setStyleBundleDatasetVersion("");
      return;
    }
    setStyleBundleDatasetVersion((current) => {
      if (!current.trim()) {
        return frozenDatasets[0].datasetVersion;
      }
      const hasCurrentDataset = frozenDatasets.some(
        (dataset) => dataset.datasetVersion === current,
      );
      return hasCurrentDataset ? current : frozenDatasets[0].datasetVersion;
    });
  }, [frozenDatasets]);

  const toggleTruthRowSelection = (rowId: string, checked: boolean) => {
    if (allFilteredTruthSelected) {
      if (checked) {
        return;
      }
      setAllFilteredTruthSelection(null);
      setSelectedTruthIds(visibleTruthIds.filter((id) => id !== rowId));
      return;
    }
    setSelectedTruthIds((current) => {
      if (checked) {
        return current.includes(rowId) ? current : [...current, rowId];
      }
      return current.filter((id) => id !== rowId);
    });
  };

  const toggleVisibleTruthSelection = () => {
    if (allVisibleTruthSelected) {
      clearTruthSelection();
      return;
    }
    setSelectedTruthIds(visibleTruthIds);
    setAllFilteredTruthSelection(null);
  };

  const toggleQueueRowSelection = (rowId: string, checked: boolean) => {
    setSelectedQueueIds((current) => {
      if (checked) {
        return current.includes(rowId) ? current : [...current, rowId];
      }
      return current.filter((id) => id !== rowId);
    });
  };

  const toggleVisibleQueueSelection = () => {
    if (allVisibleQueueSelected) {
      clearQueueSelection();
      return;
    }
    setSelectedQueueIds(queueSelectableIds);
  };

  const selectAllFilteredTruthRows = () => {
    if (truthTotal < 2 || truthTotalPages <= 1) {
      return;
    }
    setSelectedTruthIds([]);
    setAllFilteredTruthSelection(
      buildAllFilteredTruthSelection({
        availableTotalRows: truthTotal,
        availableTotalPages: truthTotalPages,
        pageSize: APPROVED_TRUTH_PAGE_SIZE,
      }),
    );
  };

  function resolveAllFilteredTruthSelection(pageRangeOverride?: {
    startPage: number;
    endPage: number;
  }): AllFilteredTruthSelection | null {
    const baseSelection =
      allFilteredTruthSelection ??
      (pageRangeOverride && truthTotalPages > 0
        ? buildAllFilteredTruthSelection({
            availableTotalRows: truthTotal,
            availableTotalPages: truthTotalPages,
            pageSize: APPROVED_TRUTH_PAGE_SIZE,
          })
        : null);

    if (!baseSelection) {
      return null;
    }

    if (!pageRangeOverride) {
      return baseSelection;
    }

    return buildAllFilteredTruthSelection({
      availableTotalRows: baseSelection.availableTotalRows,
      availableTotalPages: baseSelection.availableTotalPages,
      pageStart: pageRangeOverride.startPage,
      pageEnd: pageRangeOverride.endPage,
      pageSize: baseSelection.pageSize,
    });
  }

  const updateAllFilteredTruthPageRange = (
    startPage: number,
    endPage: number,
  ) => {
    setAllFilteredTruthSelection((current) => {
      if (!current) {
        return current;
      }
      return buildAllFilteredTruthSelection({
        availableTotalRows: current.availableTotalRows,
        availableTotalPages: current.availableTotalPages,
        pageStart: startPage,
        pageEnd: endPage,
        pageSize: current.pageSize,
      });
    });
  };

  const handleBulkQueuePromoteDialog = () => {
    if (selectedQueueIds.length < 1) {
      toast({
        title: "Nothing selected",
        description: "Select at least one pending learning-queue row first.",
        variant: "destructive",
      });
      return;
    }
    openBulkQueuePromoteDialog(selectedQueueIds);
  };

  const bulkActionBusy =
    bulkDeleteMutation.isPending ||
    bulkCertifyMutation.isPending ||
    bulkUpdateMutation.isPending ||
    startTruthBackgroundJobMutation.isPending ||
    activeTruthBackgroundJob !== null;
  const bulkQueueActionBusy =
    bulkQueueProcessMutation.isPending ||
    bulkQueuePromoteMutation.isPending ||
    bulkQueueRevertMutation.isPending;
  const bulkDeleteLabel = allFilteredTruthSelected
    ? startTruthBackgroundJobMutation.isPending &&
      activeTruthBackgroundJob === null
      ? "Starting..."
      : "Delete pages"
    : bulkDeleteMutation.isPending
      ? "Deleting..."
      : "Delete selected";
  const bulkPrefillLabel = allFilteredTruthSelected
    ? startTruthBackgroundJobMutation.isPending &&
      activeTruthBackgroundJob === null
      ? "Starting..."
      : "Refill pages"
    : startTruthBackgroundJobMutation.isPending &&
        activeTruthBackgroundJob === null
      ? "Starting..."
      : activeTruthBackgroundJob?.operation === "prefill"
        ? "Refilling..."
        : "Refill from engine";
  const bulkCrossrefLabel = allFilteredTruthSelected
    ? startTruthBackgroundJobMutation.isPending &&
      activeTruthBackgroundJob === null
      ? "Starting..."
      : "Crossref pages"
    : startTruthBackgroundJobMutation.isPending &&
        activeTruthBackgroundJob === null
      ? "Starting..."
      : activeTruthBackgroundJob?.operation === "crossref"
        ? "Crossref..."
        : "Crossref DOI";
  const bulkUpdateLabel = allFilteredTruthSelected
    ? "Set trust/status for pages"
    : "Set trust/status";
  const bulkCertifyLabel = allFilteredTruthSelected
    ? "Certify pages"
    : "Certify selected";
  const allFilteredTruthScope = allFilteredTruthSelection
    ? formatAllFilteredTruthSelectionScope(allFilteredTruthSelection)
    : `pages 1-${truthTotalPages} of ${truthTotalPages}`;

  const handleBulkDelete = (pageRangeOverride?: {
    startPage: number;
    endPage: number;
  }) => {
    const effectiveAllFilteredTruthSelection =
      resolveAllFilteredTruthSelection(pageRangeOverride);
    const effectiveAllFilteredTruthScope = effectiveAllFilteredTruthSelection
      ? formatAllFilteredTruthSelectionScope(effectiveAllFilteredTruthSelection)
      : allFilteredTruthScope;
    const effectiveSelectedTruthCount =
      effectiveAllFilteredTruthSelection?.totalRows ?? selectedTruthCount;
    const confirmationMessage = allFilteredTruthSelected
      ? `Delete ${effectiveSelectedTruthCount} approved-truth rows from ${effectiveAllFilteredTruthScope} matching the current filters? This cannot be undone.`
      : `Delete ${selectedTruthCount} selected approved-truth row${selectedTruthCount === 1 ? "" : "s"}? This cannot be undone.`;
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    if (allFilteredTruthSelected) {
      void startAllFilteredTruthJob({ operation: "delete", pageRangeOverride });
      return;
    }

    bulkDeleteMutation.mutate();
  };

  const handleBulkPrefill = (pageRangeOverride?: {
    startPage: number;
    endPage: number;
  }) => {
    const effectiveAllFilteredTruthSelection =
      resolveAllFilteredTruthSelection(pageRangeOverride);
    const effectiveAllFilteredTruthScope = effectiveAllFilteredTruthSelection
      ? formatAllFilteredTruthSelectionScope(effectiveAllFilteredTruthSelection)
      : allFilteredTruthScope;
    const effectiveSelectedTruthCount =
      effectiveAllFilteredTruthSelection?.totalRows ?? selectedTruthCount;
    const confirmationMessage = allFilteredTruthSelected
      ? `Refill expected/core truth from the current local parser for ${effectiveSelectedTruthCount} approved-truth rows from ${effectiveAllFilteredTruthScope} matching the current filters? This overwrites the stored expected/core truth fields for those rows.`
      : `Refill expected/core truth from the current local parser for ${selectedTruthCount} selected row${selectedTruthCount === 1 ? "" : "s"}? This overwrites the stored expected/core truth fields for those rows.`;
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    if (allFilteredTruthSelected) {
      void startAllFilteredTruthJob({
        operation: "prefill",
        pageRangeOverride,
      });
      return;
    }

    void runSelectedTruthPrefill(selectedTruthIds).catch((error) => {
      toast({
        title: "Engine refill failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not refill the selected approved-truth rows.",
        variant: "destructive",
      });
    });
  };

  const openTruthPageJump = () => {
    if (truthTotalPages <= 1) {
      return;
    }
    setTruthPageJumpValue(String(truthPage));
    setTruthPageJumpOpen(true);
  };

  const cancelTruthPageJump = () => {
    setTruthPageJumpOpen(false);
    setTruthPageJumpValue("");
  };

  const commitTruthPageJump = () => {
    if (truthTotalPages <= 0) {
      cancelTruthPageJump();
      return;
    }

    const requestedPage = Number.parseInt(truthPageJumpValue.trim(), 10);
    if (!Number.isFinite(requestedPage)) {
      cancelTruthPageJump();
      return;
    }

    const nextPage = Math.min(Math.max(requestedPage, 1), truthTotalPages);
    clearTruthSelection();
    setTruthPage(nextPage);
    setTruthPageJumpOpen(false);
    setTruthPageJumpValue("");
  };

  const handleBulkCrossref = (pageRangeOverride?: {
    startPage: number;
    endPage: number;
  }) => {
    const effectiveAllFilteredTruthSelection =
      resolveAllFilteredTruthSelection(pageRangeOverride);
    const effectiveAllFilteredTruthScope = effectiveAllFilteredTruthSelection
      ? formatAllFilteredTruthSelectionScope(effectiveAllFilteredTruthSelection)
      : allFilteredTruthScope;
    const effectiveSelectedTruthCount =
      effectiveAllFilteredTruthSelection?.totalRows ?? selectedTruthCount;
    const confirmationMessage = allFilteredTruthSelected
      ? `Replace the stored approved truth fields from Crossref DOI metadata for ${effectiveSelectedTruthCount} approved-truth rows from ${effectiveAllFilteredTruthScope} matching the current filters? Rows without a DOI will be skipped.`
      : `Replace the stored approved truth fields from Crossref DOI metadata for ${selectedTruthCount} selected row${selectedTruthCount === 1 ? "" : "s"}? Rows without a DOI will be skipped.`;
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    if (allFilteredTruthSelected) {
      void startAllFilteredTruthJob({
        operation: "crossref",
        pageRangeOverride,
      });
      return;
    }

    void startAllFilteredTruthJob({
      operation: "crossref",
      ids: selectedTruthIds,
    });
  };

  const handleBulkCertifyDialog = (pageRangeOverride?: {
    startPage: number;
    endPage: number;
  }) => {
    if (allFilteredTruthSelected) {
      const effectiveAllFilteredTruthSelection =
        resolveAllFilteredTruthSelection(pageRangeOverride);
      if (effectiveAllFilteredTruthSelection) {
        openAllFilteredBulkCertify(effectiveAllFilteredTruthSelection);
      }
      return;
    }

    openBulkCertify(selectedTruthIds);
  };

  const handleBulkUpdateDialog = (pageRangeOverride?: {
    startPage: number;
    endPage: number;
  }) => {
    if (allFilteredTruthSelected) {
      const effectiveAllFilteredTruthSelection =
        resolveAllFilteredTruthSelection(pageRangeOverride);
      if (effectiveAllFilteredTruthSelection) {
        openAllFilteredBulkUpdate(effectiveAllFilteredTruthSelection);
      }
      return;
    }

    openBulkUpdate(selectedTruthIds);
  };

  return (
    <AdminShell title="Review">
      <div>
        <div className="mb-6">
          <AdminSectionTabs />
        </div>
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Training &amp; gold data
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
              Curate approved truth and promote learning-queue rows.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTrainingGuideSection("overview");
                setTrainingGuideOpen(true);
              }}
            >
              <CircleHelp className="mr-2 h-4 w-4" />
              Page guide
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleExport()}
            >
              Download NDJSON export
            </Button>
            <Button type="button" onClick={openCreate}>
              Add truth row
            </Button>
          </div>
        </div>

        {restorableEditorDraft && !editorOpen ? (
          <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="font-semibold">
                Saved truth-row draft available
              </div>
              <div className="text-xs text-amber-800 dark:text-amber-200">
                {restorableEditorDraft.payload.mode === "edit"
                  ? "You have an unsaved edit draft for an approved-truth row."
                  : "You have an unsaved new truth-row draft."}{" "}
                Saved{" "}
                {new Date(restorableEditorDraft.updatedAt).toLocaleString()}.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={resumeEditorDraftPending}
                onClick={() => {
                  void discardEditorDraft().catch((error) => {
                    toast({
                      title: "Discard draft failed",
                      description:
                        error instanceof Error
                          ? error.message
                          : "Could not clear the saved approved-truth draft.",
                      variant: "destructive",
                    });
                  });
                }}
              >
                Discard saved draft
              </Button>
              <Button
                type="button"
                disabled={resumeEditorDraftPending}
                onClick={() => {
                  void resumeEditorDraft().catch((error) => {
                    toast({
                      title: "Resume draft failed",
                      description:
                        error instanceof Error
                          ? error.message
                          : "Could not reopen the saved approved-truth draft.",
                      variant: "destructive",
                    });
                  });
                }}
              >
                {resumeEditorDraftPending ? "Opening draft..." : "Resume draft"}
              </Button>
            </div>
          </div>
        ) : null}

        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Certified truth
            </div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {Object.values(
                trainingStatus?.truth.byTaskScope ?? {},
              ).reduce((sum, count) => sum + Number(count), 0)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {trainingStatus?.truth.total ?? 0} total · {trainingStatus?.truth.quarantined ?? 0} quarantined
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Parser hints
            </div>
            <div className="mt-1.5 truncate text-base font-semibold text-slate-900 dark:text-white">
              {trainingStatus?.authorityPack.version ?? "not pushed"}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {trainingStatus?.authorityPack.doiExactHints ?? 0} DOI · {trainingStatus?.authorityPack.journalIssnHints ?? 0} journal/ISSN
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Live style model
            </div>
            <div className="mt-1.5 truncate text-base font-semibold text-slate-900 dark:text-white">
              {trainingStatus?.styleBundle.current?.modelVersion ??
                "built-in bootstrap"}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              ML health:{" "}
              {trainingStatus?.mlHealth
                ? trainingStatus.mlHealth.healthy
                  ? "healthy"
                  : "degraded"
                : "unknown"}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Canonical benchmark
            </div>
            <div className="mt-1.5 truncate text-base font-semibold text-slate-900 dark:text-white">
              {benchmarkStatus
                ? `${formatBenchmarkThroughput(benchmarkStatus.medianRefsPerSec)} refs/sec`
                : "not run yet"}
            </div>
            <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
              {benchmarkStatus
                ? `${benchmarkStatus.fileName}`
                : "Runs once a benchmark result exists."}
            </div>
          </div>
        </section>

        <section className={cn(cardClass, "mb-6")}>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                How curation works
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Follow the four steps to take incoming fixes all the way to a
                published model.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTrainingGuideSection("overview");
                setTrainingGuideOpen(true);
              }}
            >
              <CircleHelp className="mr-2 h-4 w-4" />
              Tutorial
            </Button>
          </div>

          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                n: 1,
                title: "Review the queue",
                desc: "Triage incoming candidate rows that still need a decision.",
                action: (
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <a href="#learning-queue">Open queue ({pendingQueueCount})</a>
                  </Button>
                ),
              },
              {
                n: 2,
                title: "Approve truth",
                desc: "Promote reviewed rows into curated, approved truth.",
                action: (
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <a href="#approved-truth">Approve truth ({truthTotal})</a>
                  </Button>
                ),
              },
              {
                n: 3,
                title: "Validate & publish",
                desc: "Push parser hints, then validate and publish the model.",
                action: (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setTrainingArtifactsOpen(true)}
                  >
                    Validate &amp; publish
                  </Button>
                ),
              },
              {
                n: 4,
                title: "Export (optional)",
                desc: "Download an NDJSON slice for offline training when needed.",
                action: (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => void handleExport()}
                  >
                    Export NDJSON
                  </Button>
                ),
              },
            ].map((step) => (
              <li
                key={step.n}
                className="flex flex-col rounded-xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800/60 dark:bg-[#0c111b]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#002147] text-xs font-bold text-white dark:bg-[#0f4fa8]">
                    {step.n}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {step.title}
                  </h3>
                </div>
                <p className="mt-2 flex-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {step.desc}
                </p>
                <div className="mt-3">{step.action}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className={cn(cardClass, "mb-6")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Export filters and slices
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Optional — open only when exporting NDJSON or a training slice.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportFiltersOpen((open) => !open)}
            >
              {exportFiltersOpen
                ? "Hide export controls"
                : "Show export controls"}
            </Button>
          </div>
          {exportFiltersOpen ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-7">
              <div className="grid gap-1">
                <HelpLabel
                  htmlFor="export-task"
                  label="Export task"
                  help={renderDropdownHelp(
                    "Choose which certified task rows to export.",
                    TASK_OPTIONS,
                  )}
                />
                <select
                  id="export-task"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={exportTask}
                  onChange={(e) => setExportTask(e.target.value as TruthTask)}
                >
                  {TASK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <HelpLabel
                  htmlFor="export-scope"
                  label="Truth scope"
                  help={renderDropdownHelp(
                    "Choose which truth scope to export.",
                    SCOPE_OPTIONS,
                  )}
                />
                <select
                  id="export-scope"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={exportTruthScope}
                  onChange={(e) =>
                    setExportTruthScope(e.target.value as TruthScope)
                  }
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
                  htmlFor="export-holdout-version"
                  label="Holdout version"
                  help="Optional sealed holdout generation filter. Leave empty to export all non-holdout or filtered holdout rows."
                />
                <Input
                  id="export-holdout-version"
                  value={exportHoldoutVersion}
                  onChange={(e) => setExportHoldoutVersion(e.target.value)}
                  placeholder="optional"
                />
              </div>
              <div className="grid gap-1">
                <HelpLabel
                  htmlFor="export-dataset-version"
                  label="Dataset version"
                  help="Optional frozen dataset version filter for deterministic style bundle exports."
                />
                <Input
                  id="export-dataset-version"
                  value={exportDatasetVersion}
                  onChange={(e) => setExportDatasetVersion(e.target.value)}
                  placeholder="style-core-..."
                />
              </div>
              <div className="grid gap-1">
                <HelpLabel
                  htmlFor="export-style-suite"
                  label="Style eval suite"
                  help={renderDropdownHelp(
                    "Optional style-suite filter for export.",
                    STYLE_EVAL_SUITE_OPTIONS,
                  )}
                />
                <select
                  id="export-style-suite"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={exportStyleEvaluationSuite}
                  onChange={(e) =>
                    setExportStyleEvaluationSuite(
                      (e.target.value || "") as TruthStyleEvaluationSuite | "",
                    )
                  }
                >
                  <option value="">(all)</option>
                  {STYLE_EVAL_SUITE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={exportCertifiedOnly}
                  onChange={(e) => setExportCertifiedOnly(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Certified rows only
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={exportExcludeQuarantined}
                  onChange={(e) =>
                    setExportExcludeQuarantined(e.target.checked)
                  }
                  className="rounded border-slate-300"
                />
                Exclude quarantined rows
              </label>
            </div>
          ) : null}
        </section>

        <section className={cn(cardClass, "mb-6")}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Validate and publish
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Push reviewed parser hints. Advanced controls handle dataset
                  freezing, model training, and benchmarks.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={buildAuthorityPackMutation.isPending}
                  onClick={() => buildAuthorityPackMutation.mutate()}
                >
                  Push hints to parser
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTrainingArtifactsOpen((open) => !open)}
                >
                  {trainingArtifactsOpen
                    ? "Hide advanced publish"
                    : "Show advanced publish"}
                </Button>
              </div>
            </div>
            {trainingArtifactsOpen ? (
              <>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-5 xl:items-end">
                  <div className="grid min-w-0 gap-1 xl:[&_label]:whitespace-nowrap">
                    <HelpLabel
                      htmlFor="style-bundle-version"
                      label="New model version name"
                      help="Autogenerated model version used for training. You can edit it manually before training."
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        id="style-bundle-version"
                        className="h-10"
                        value={styleBundleVersion}
                        onChange={(e) => {
                          setStyleBundleVersionManuallyEdited(true);
                          setStyleBundleVersion(e.target.value);
                        }}
                        placeholder={buildAutoStyleBundleVersion()}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-10 shrink-0"
                        onClick={() => {
                          setStyleBundleVersion(buildAutoStyleBundleVersion());
                          setStyleBundleVersionManuallyEdited(false);
                        }}
                      >
                        Auto
                      </Button>
                    </div>
                  </div>
                  <div className="grid min-w-0 gap-1 xl:[&_label]:whitespace-nowrap">
                    <HelpLabel
                      htmlFor="style-bundle-dataset-version"
                      label="Gold dataset to train from"
                      help="Select the frozen dataset for style-model training. The list is sorted newest first."
                    />
                    <select
                      id="style-bundle-dataset-version"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={styleBundleDatasetVersion}
                      onChange={(e) =>
                        setStyleBundleDatasetVersion(e.target.value)
                      }
                      disabled={frozenDatasets.length === 0}
                    >
                      {frozenDatasets.length === 0 ? (
                        <option value="">No frozen datasets available</option>
                      ) : null}
                      {frozenDatasets.map((dataset) => (
                        <option
                          key={`${dataset.datasetVersion}:${dataset.manifestHash}`}
                          value={dataset.datasetVersion}
                        >
                          {`${dataset.datasetVersion} • ${formatDatasetModifiedLabel(dataset.createdAt)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid min-w-0 gap-1 xl:[&_label]:whitespace-nowrap">
                    <HelpLabel
                      label="Push reviewed hints to parser"
                      help="Updates DOI, journal, and ISSN lookup hints from reviewed rows so the parser can use them right away."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full"
                      disabled={buildAuthorityPackMutation.isPending}
                      onClick={() => buildAuthorityPackMutation.mutate()}
                    >
                      Push hints to parser
                    </Button>
                  </div>
                  <div className="grid min-w-0 gap-1 xl:col-span-2 xl:[&_label]:whitespace-nowrap">
                    <HelpLabel
                      label="Build pack and live model"
                      help="Choose which certified pack to build. Style model training still uses a frozen style/core gold dataset."
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={buildPackTarget}
                        onChange={(event) =>
                          setBuildPackTarget(
                            event.target.value as TrainingPackTarget,
                          )
                        }
                      >
                        {TRAINING_PACK_TARGET_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full"
                        disabled={buildSelectedTrainingPackMutation.isPending}
                        onClick={() =>
                          buildSelectedTrainingPackMutation.mutate()
                        }
                      >
                        {buildSelectedTrainingPackMutation.isPending
                          ? "Building..."
                          : "Build selected pack"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full"
                        disabled={buildStyleBundleMutation.isPending}
                        onClick={() => buildStyleBundleMutation.mutate()}
                      >
                        Train style model
                      </Button>
                      <Button
                        type="button"
                        className="h-10 w-full"
                        disabled={promoteStyleBundleMutation.isPending}
                        onClick={() => promoteStyleBundleMutation.mutate()}
                      >
                        Use this model in engine
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-950/40">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Benchmark throughput
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                        {formatBenchmarkThroughput(
                          benchmarkStatus?.medianRefsPerSec,
                        )}
                        <span className="ml-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                          refs/sec
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                        Latest canonical parallel benchmark artifact, used as
                        the admin-facing throughput reference.
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <div className="flex items-center justify-between gap-4">
                        <span>Best</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {formatBenchmarkThroughput(
                            benchmarkStatus?.bestRefsPerSec,
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Worst</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {formatBenchmarkThroughput(
                            benchmarkStatus?.worstRefsPerSec,
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Iterations</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {benchmarkStatus?.iterations ?? "n/a"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 text-xs text-slate-600 dark:text-slate-400 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60">
                      Field hash stable:{" "}
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {benchmarkStatus?.fieldHashStable === null ||
                        benchmarkStatus?.fieldHashStable === undefined
                          ? "n/a"
                          : benchmarkStatus.fieldHashStable
                            ? "yes"
                            : "no"}
                      </span>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60">
                      Contract hash stable:{" "}
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {benchmarkStatus?.contractHashStable === null ||
                        benchmarkStatus?.contractHashStable === undefined
                          ? "n/a"
                          : benchmarkStatus.contractHashStable
                            ? "yes"
                            : "no"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                    {benchmarkStatus
                      ? `${benchmarkStatus.fileName}${benchmarkStatus.recordedAt ? ` • ${formatDatasetModifiedLabel(benchmarkStatus.recordedAt)}` : ""}`
                      : "No canonical parallel benchmark artifact is available under the benchmark results root yet."}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-6">
                  <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                    <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                      Gold kinds
                    </div>
                    {Object.entries(trainingStatus?.truth.byGoldKind ?? {})
                      .length > 0 ? (
                      Object.entries(
                        trainingStatus?.truth.byGoldKind ?? {},
                      ).map(([key, count]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-3"
                        >
                          <span>{key}</span>
                          <span>{count}</span>
                        </div>
                      ))
                    ) : (
                      <div>None yet.</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                    <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                      Styles tagged
                    </div>
                    {Object.entries(trainingStatus?.truth.byStyle ?? {})
                      .length > 0 ? (
                      Object.entries(trainingStatus?.truth.byStyle ?? {}).map(
                        ([key, count]) => (
                          <div
                            key={key}
                            className="flex items-center justify-between gap-3"
                          >
                            <span>{key}</span>
                            <span>{count}</span>
                          </div>
                        ),
                      )
                    ) : (
                      <div>None yet.</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                    <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                      Row status
                    </div>
                    {Object.entries(trainingStatus?.truth.byRowStatus ?? {})
                      .length > 0 ? (
                      Object.entries(
                        trainingStatus?.truth.byRowStatus ?? {},
                      ).map(([key, count]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-3"
                        >
                          <span>{key}</span>
                          <span>{count}</span>
                        </div>
                      ))
                    ) : (
                      <div>None yet.</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                    <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                      Certified task scopes
                    </div>
                    {Object.entries(trainingStatus?.truth.byTaskScope ?? {})
                      .length > 0 ? (
                      Object.entries(
                        trainingStatus?.truth.byTaskScope ?? {},
                      ).map(([key, count]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-3"
                        >
                          <span>{key}</span>
                          <span>{count}</span>
                        </div>
                      ))
                    ) : (
                      <div>None yet.</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                    <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                      Staged style bundles
                    </div>
                    {stagedStyleBundleVersions.length ? (
                      stagedStyleBundleVersions.map((version) => (
                        <div key={version}>{version}</div>
                      ))
                    ) : (
                      <div>None staged.</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                    <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                      Frozen datasets
                    </div>
                    {frozenDatasets.length ? (
                      frozenDatasets.slice(0, 4).map((dataset) => (
                        <div
                          key={`${dataset.datasetVersion}:${dataset.manifestHash}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {dataset.datasetVersion}
                          </span>
                          <span>{dataset.rowCount}</span>
                        </div>
                      ))
                    ) : (
                      <div>None frozen.</div>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </section>

        <section
          id="approved-truth"
          className={cn(cardClass, "mb-6 scroll-mt-24")}
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Approved truth
              </h2>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {truthShowCertified
                  ? "Certified rows are ready for export and release checks."
                  : "Pending rows are the review queue for approved truth."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openCreate}
              >
                Add truth row
              </Button>
              <Button
                type="button"
                variant={truthShowCertified ? "outline" : "secondary"}
                size="sm"
                onClick={() => setApprovedTruthCertificationView(false)}
              >
                Pending review
              </Button>
              <Button
                type="button"
                variant={truthShowCertified ? "secondary" : "outline"}
                size="sm"
                onClick={() => setApprovedTruthCertificationView(true)}
              >
                Certified
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setApprovedTruthFiltersOpen((open) => !open)}
              >
                {approvedTruthFiltersOpen ? "Hide filters" : "More filters"}
              </Button>
            </div>
            {approvedTruthFiltersOpen ? (
              <div className="flex w-full flex-wrap gap-2">
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
                  value={trustFilter}
                  onChange={(e) => {
                    clearTruthSelection();
                    setTruthPage(1);
                    setTrustFilter(
                      (e.target.value || "") as "" | TruthTrustLevel,
                    );
                  }}
                >
                  <option value="">All trust levels</option>
                  <option value="draft">draft</option>
                  <option value="reviewed">reviewed</option>
                  <option value="gold">gold</option>
                </select>
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
                  value={splitFilter}
                  onChange={(e) => {
                    clearTruthSelection();
                    setTruthPage(1);
                    setSplitFilter(
                      (e.target.value || "") as "" | TruthDatasetSplit,
                    );
                  }}
                >
                  <option value="">All splits</option>
                  <option value="train">train</option>
                  <option value="val">val</option>
                  <option value="test">test</option>
                  <option value="holdout">holdout</option>
                </select>
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
                  value={rowStatusFilter}
                  onChange={(e) => {
                    clearTruthSelection();
                    setTruthPage(1);
                    setRowStatusFilter(
                      (e.target.value || "") as "" | TruthRowStatus,
                    );
                  }}
                >
                  <option value="">All row status</option>
                  {ROW_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
                  value={styleFilter}
                  onChange={(e) => {
                    clearTruthSelection();
                    setTruthPage(1);
                    setStyleFilter(e.target.value);
                  }}
                >
                  <option value="">All styles</option>
                  {filterStyleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
                  value={goldKindFilter}
                  onChange={(e) => {
                    clearTruthSelection();
                    setTruthPage(1);
                    setGoldKindFilter(
                      (e.target.value || "") as TruthGoldKind | "",
                    );
                  }}
                >
                  <option value="">All gold kinds</option>
                  {GOLD_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
                  value={styleEvalSuiteFilter}
                  onChange={(e) => {
                    clearTruthSelection();
                    setTruthPage(1);
                    setStyleEvalSuiteFilter(
                      (e.target.value || "") as TruthStyleEvaluationSuite | "",
                    );
                  }}
                >
                  <option value="">All style suites</option>
                  {STYLE_EVAL_SUITE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <label className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={truthShowCertified}
                    onChange={(e) =>
                      setApprovedTruthCertificationView(e.target.checked)
                    }
                    className="rounded border-slate-300"
                  />
                  Certified only
                </label>
              </div>
            ) : null}
            {!truthShowCertified &&
            (showSelectAllPagesOption ||
              allFilteredTruthSelected ||
              selectedTruthCount >= 2) ? (
              <AdminTrainingBulkSelectionBar
                showSelectAllPagesOption={showSelectAllPagesOption}
                canShowBulkActions={
                  allFilteredTruthSelected
                    ? selectedTruthCount >= 1
                    : selectedTruthCount >= 2
                }
                bulkActionBusy={bulkActionBusy}
                allFilteredSelection={allFilteredTruthSelection}
                onSelectAllPages={selectAllFilteredTruthRows}
                onApplyPageRange={updateAllFilteredTruthPageRange}
                deleteLabel={bulkDeleteLabel}
                refillLabel={bulkPrefillLabel}
                crossrefLabel={bulkCrossrefLabel}
                updateLabel={bulkUpdateLabel}
                certifyLabel={bulkCertifyLabel}
                onDelete={handleBulkDelete}
                onPrefill={handleBulkPrefill}
                onCrossref={handleBulkCrossref}
                onUpdate={handleBulkUpdateDialog}
                onCertify={handleBulkCertifyDialog}
                totalTruthHighlightCount={totalTruthHighlightCount}
                highlightSummary={truthHighlightSummary}
                onDismissHighlights={clearTruthRowHighlights}
              />
            ) : null}
          </div>

          {listQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : listQuery.isError ? (
            <p className="text-sm text-red-600">
              Failed to load approved truth.
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-500">
              No rows yet. Add a truth row or promote from the queue.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:bg-white/5 dark:text-slate-500">
                  <tr>
                    {!truthShowCertified ? (
                      <th className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={allVisibleTruthSelected}
                          onChange={toggleVisibleTruthSelection}
                          aria-label="Select all visible approved truth rows"
                          className="rounded border-slate-300"
                        />
                      </th>
                    ) : null}
                    <th className="px-3 py-2">Trust</th>
                    <th className="px-3 py-2">Row status</th>
                    <th className="px-3 py-2">Split</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Raw text</th>
                    <th className="px-3 py-2">Hash</th>
                    <th className="px-3 py-2 text-right">
                      {truthShowCertified ? "Sent to" : "Actions"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((row) => {
                    const drift = truthDriftSummary(row);
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          "transition-colors duration-300",
                          truthRowHighlights[row.id]?.tone === "success"
                            ? "bg-emerald-50/70 dark:bg-emerald-950/20"
                            : truthRowHighlights[row.id]?.tone === "failure"
                              ? "bg-rose-50/70 dark:bg-rose-950/20"
                              : "bg-white/80 dark:bg-slate-950/40",
                        )}
                      >
                        {!truthShowCertified ? (
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={
                                allFilteredTruthSelected ||
                                selectedTruthIdSet.has(row.id)
                              }
                              onChange={(e) =>
                                toggleTruthRowSelection(
                                  row.id,
                                  e.target.checked,
                                )
                              }
                              aria-label={`Select approved truth row ${row.id}`}
                              className="rounded border-slate-300"
                            />
                          </td>
                        ) : null}
                        <td className="px-3 py-2 font-semibold">
                          {row.trustLevel}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          <div>
                            {row.rowStatus ??
                              (row.trustLevel === "draft"
                                ? "draft"
                                : "reviewed")}
                          </div>
                          {row.blockedReason ? (
                            <div className="font-mono text-[10px] text-rose-600">
                              {row.blockedReason}
                            </div>
                          ) : null}
                          {drift ? (
                            <div
                              className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                              title={formatTruthDriftTooltip(drift)}
                            >
                              Drift {drift.mismatchCount}
                            </div>
                          ) : null}
                          {truthRowHighlights[row.id] ? (
                            <div
                              className={cn(
                                "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                                truthRowHighlights[row.id].tone === "success"
                                  ? "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                                  : "bg-rose-100/80 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
                              )}
                              title={
                                truthRowHighlights[row.id].message ?? undefined
                              }
                            >
                              {formatTruthRowHighlightLabel(
                                truthRowHighlights[row.id],
                              )}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          <div>{row.datasetSplit ?? "—"}</div>
                          {row.datasetVersion ? (
                            <div className="font-mono text-[10px] text-slate-500">
                              {row.datasetVersion}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          {row.goldKind ?? "—"}
                        </td>
                        <td className="max-w-md px-3 py-2">
                          <span className="line-clamp-2 text-slate-700 dark:text-slate-200">
                            {row.rawText}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
                          {row.inputHash.slice(0, 12)}…
                        </td>
                        <td className="px-3 py-2 text-right">
                          {truthShowCertified ? (
                            <div className="grid gap-1 text-right text-[10px] text-slate-600 dark:text-slate-300">
                              {certifiedDestinations(row).length > 0 ? (
                                certifiedDestinations(row).map(
                                  (certification) => (
                                    <span
                                      key={`${certification.task}:${certification.truthScope}:${certification.packTarget ?? "default"}`}
                                    >
                                      {formatCertificationDestination(
                                        certification,
                                      )}
                                      {certification.stagedBundleId ? (
                                        <span className="ml-1 font-mono text-slate-500">
                                          {certification.stagedBundleId.slice(
                                            0,
                                            8,
                                          )}
                                          …
                                        </span>
                                      ) : null}
                                    </span>
                                  ),
                                )
                              ) : (
                                <span>Certified pack pending</span>
                              )}
                            </div>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                onClick={() => openCertify(row)}
                              >
                                Certify
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                onClick={() => openEdit(row)}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 text-red-600 hover:text-red-700"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Delete this approved truth row?",
                                    )
                                  ) {
                                    deleteMutation.mutate(row.id);
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {truthTotal === 0
                ? truthShowCertified
                  ? "No certified approved-truth rows match these filters."
                  : "No pending approved-truth rows match these filters."
                : `Showing ${items.length} of ${truthTotal} rows.`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={truthPage <= 1}
                onClick={() => {
                  clearTruthSelection();
                  setTruthPage((current) => Math.max(1, current - 1));
                }}
              >
                Previous
              </Button>
              <div className="min-w-28 text-center font-medium text-slate-600 dark:text-slate-300">
                {truthPageJumpOpen && truthTotalPages > 1 ? (
                  <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
                    <span className="text-xs text-slate-500">Page</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      value={truthPageJumpValue}
                      onChange={(e) =>
                        setTruthPageJumpValue(
                          e.target.value.replace(/[^\d]/g, ""),
                        )
                      }
                      onBlur={commitTruthPageJump}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitTruthPageJump();
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelTruthPageJump();
                        }
                      }}
                      aria-label="Jump to approved-truth page"
                      className="w-12 border-0 bg-transparent px-0 text-center text-sm font-semibold text-slate-700 outline-none dark:text-slate-100"
                    />
                    <span className="text-sm text-slate-500">
                      / {truthTotalPages}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openTruthPageJump}
                    disabled={truthTotalPages <= 1}
                    className="rounded-md px-2 py-1 text-center font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:disabled:hover:bg-transparent dark:disabled:hover:text-slate-300"
                    title={
                      truthTotalPages > 1
                        ? "Click to jump to a page"
                        : undefined
                    }
                  >
                    Page {truthPage}
                    {truthTotalPages > 0 ? ` / ${truthTotalPages}` : ""}
                  </button>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={truthTotalPages === 0 || truthPage >= truthTotalPages}
                onClick={() => {
                  clearTruthSelection();
                  setTruthPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </section>

        <section id="learning-queue" className={cn(cardClass, "scroll-mt-24")}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Learning queue
              </h2>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Review pending candidates, then promote the useful ones into
                approved truth.
                {processedQueueCount > 0
                  ? ` ${processedQueueCount} processed items are available in history.`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={queueQuery.isLoading || queueFiltered.length === 0}
                onClick={handleLearningQueueExport}
              >
                Export TXT
              </Button>
              <Button
                type="button"
                variant={queueShowProcessed ? "secondary" : "outline"}
                size="sm"
                onClick={() => {
                  clearQueueSelection();
                  setQueueShowProcessed((current) => !current);
                }}
              >
                {queueShowProcessed ? "Show pending" : "Processed history"}
              </Button>
            </div>
          </div>

          {!queueShowProcessed && selectedQueueIds.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
              <span className="font-medium">{queueSelectionSummary}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkQueueActionBusy}
                onClick={clearQueueSelection}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkQueueActionBusy}
                onClick={() => bulkQueueProcessMutation.mutate()}
              >
                {bulkQueueProcessMutation.isPending
                  ? "Processing..."
                  : "Mark processed"}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={bulkQueueActionBusy}
                onClick={handleBulkQueuePromoteDialog}
              >
                {bulkQueuePromoteMutation.isPending
                  ? "Promoting..."
                  : "Promote selected"}
              </Button>
            </div>
          ) : null}

          {queueQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : queueQuery.isError ? (
            <p className="text-sm text-red-600">
              Failed to load learning queue.
            </p>
          ) : queueFiltered.length === 0 ? (
            <p className="text-sm text-slate-500">
              No queue items match this filter.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:bg-white/5 dark:text-slate-500">
                  <tr>
                    {!queueShowProcessed ? (
                      <th className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={allVisibleQueueSelected}
                          disabled={queueSelectableIds.length === 0}
                          onChange={toggleVisibleQueueSelection}
                          aria-label="Select visible learning queue rows"
                          className="rounded border-slate-300"
                        />
                      </th>
                    ) : null}
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Preview</th>
                    <th className="px-3 py-2 text-right">
                      {queueShowProcessed ? "Processed action" : "Actions"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {queueFiltered.map((q) => {
                    const preview = normalizedRawInputFromQueue(
                      q.trainingData,
                    ).slice(0, 120);
                    const groupedCount = q.duplicateCount ?? 1;
                    const groupedSources = q.groupedSources ?? [q.source];
                    return (
                      <tr
                        key={q.id}
                        className="bg-white/80 dark:bg-slate-950/40"
                      >
                        {!queueShowProcessed ? (
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedQueueIdSet.has(q.id)}
                              disabled={q.processed}
                              onChange={(e) =>
                                toggleQueueRowSelection(q.id, e.target.checked)
                              }
                              aria-label={`Select learning queue row ${q.id}`}
                              className="rounded border-slate-300"
                            />
                          </td>
                        ) : null}
                        <td className="px-3 py-2">
                          <div className="font-semibold">
                            {groupedSources.join(", ")}
                          </div>
                          {groupedCount > 1 ? (
                            <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                              {groupedCount} matching references grouped
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          {q.processed ? (
                            <span className="text-emerald-600">processed</span>
                          ) : (
                            <span className="text-amber-600">pending</span>
                          )}
                          {q.promotedToTruthId ? (
                            <span className="ml-1 font-mono text-[10px] text-slate-500">
                              → {q.promotedToTruthId.slice(0, 8)}…
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-md px-3 py-2 text-slate-700 dark:text-slate-200">
                          <span className="line-clamp-2">{preview || "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {queueShowProcessed ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={bulkQueueRevertMutation.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Move ${groupedCount} processed queue ${groupedCount === 1 ? "item" : "items"} back to pending? This clears the promoted truth link on the queue record only.`,
                                  )
                                ) {
                                  bulkQueueRevertMutation.mutate([q.id]);
                                }
                              }}
                            >
                              {bulkQueueRevertMutation.isPending
                                ? "Reverting..."
                                : "Revert to pending"}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={q.processed}
                              onClick={() => openPromote(q)}
                            >
                              Promote
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <AdminTrainingGuideDialog
        open={trainingGuideOpen}
        onOpenChange={setTrainingGuideOpen}
        section={trainingGuideSection}
        onSectionChange={setTrainingGuideSection}
      />

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (open) {
            setEditorOpen(true);
            return;
          }
          closeEditor();
        }}
      >
        <DialogContent
          className="max-h-[92dvh] w-[98vw] max-w-[1520px] overflow-y-auto"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            editorRawTextareaRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit truth row" : "New truth row"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Edit approved truth metadata and expected fields for certification
              and export.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <AdminTrainingWorkflowSection
              step="Step 1"
              title="Review the source citation"
              description="Start with the observed citation text. Engine and Crossref actions are helpers, not the source of truth."
            >
              <div className="grid gap-1">
                <HelpLabel
                  htmlFor="truth-raw"
                  label="Raw citation text"
                  help="The verbatim citation string being reviewed. This raw text is normalized, hashed, stored in approved truth, and exported for training and evaluation."
                />
                <Textarea
                  id="truth-raw"
                  ref={editorRawTextareaRef}
                  value={formRawText}
                  onChange={(e) => {
                    const nextRaw = e.target.value;
                    setFormRawText(nextRaw);
                    setFormEnginePreviewStale(true);
                    if (!formNoiseProfileTouched && !formNoiseProfile.trim()) {
                      const detected = detectNoiseProfileFromRawText(nextRaw);
                      if (detected.length > 0) {
                        setFormNoiseProfile(detected.join(", "));
                      }
                    }
                  }}
                  rows={4}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-slate-600">
                  {editingSparseTruth
                    ? "This row only shows the truth stored so far. Use Prefill from engine to seed the current local parser output before review."
                    : "Prefill from engine uses the local parser path only: heuristics plus local ML routing and repair, without provider enrichment or hosted OpenAI repair."}
                </p>
              </div>
            </AdminTrainingWorkflowSection>

            <AdminTrainingWorkflowSection
              step="Step 2"
              title="Confirm the truth fields"
              description="These admin-reviewed Expected fields are the canonical truth used by export, evaluation, and render-variant generation."
            >
              <div className="grid gap-1">
                <HelpLabel
                  label="Expected fields"
                  help='These admin-filled Expected fields are the truth source used for export and for the six rendered style variants below. Fill only fields you want to enforce. Leave a field blank and it will be excluded. Use "|" to separate multi-values such as authors.'
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFormShowMissingRequired((current) => !current)
                    }
                    disabled={!formExpectedType}
                  >
                    {formShowMissingRequired
                      ? "Hide missing required"
                      : "Highlight missing required"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFormExpectedFieldValues((current) =>
                        Object.fromEntries(
                          Object.entries(current).map(([key]) => [key, ""]),
                        ),
                      );
                      setFormEnginePreviewStale(true);
                      setFormExpectedOutputDirty(false);
                    }}
                  >
                    Clear field values
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      !canRefreshEnginePreview ||
                      prefillEditorMutation.isPending ||
                      crossrefEditorMutation.isPending ||
                      renderPreviewEditorMutation.isPending
                    }
                    onClick={() => renderPreviewEditorMutation.mutate()}
                  >
                    {renderPreviewEditorMutation.isPending
                      ? "Refreshing..."
                      : "Refresh engine output"}
                  </Button>
                  {formExpectedType ? (
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      Required for {formExpectedType}:{" "}
                      {(
                        REQUIRED_EXPECTED_FIELDS_BY_TYPE[formExpectedType] ?? []
                      ).join(", ") || "none"}
                    </span>
                  ) : null}
                </div>
                {formShowMissingRequired &&
                formMissingRequiredFields.length > 0 ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Missing required fields:{" "}
                    {formMissingRequiredFields.join(", ")}
                  </div>
                ) : null}
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-engine-output-preview"
                      label="Engine output preview"
                      help="Rendered by the current local engine from the structured truth fields and selected expected style. Refresh it after changing fields or style."
                    />
                    <Textarea
                      id="truth-engine-output-preview"
                      value={formEngineRenderedOutput}
                      readOnly
                      rows={5}
                      placeholder={
                        formExpectedStyle.trim()
                          ? "Run Prefill from engine, edit a reviewed row, or refresh the preview to see the engine output."
                          : "Select an expected style to generate the engine output preview."
                      }
                      className="font-mono text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-600 dark:text-slate-300">
                        {formEnginePreviewStale
                          ? "Preview is stale after field edits."
                          : formEngineRenderedOutput.trim()
                            ? "Preview is in sync with the last engine render."
                            : "No engine preview yet."}
                      </span>
                    </div>
                    {formEnginePreviewWarnings.length > 0 ? (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Engine preview warnings:{" "}
                        {formEnginePreviewWarnings.join(", ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-expected-output"
                      label={
                        EXPECTED_OUTPUT_FIELD_DEFINITION?.label ??
                        "Expected output"
                      }
                      help={
                        EXPECTED_OUTPUT_FIELD_DEFINITION?.help ??
                        "Final rendered citation string used for end-to-end comparison."
                      }
                    />
                    <Textarea
                      id="truth-expected-output"
                      value={formExpectedOutputValue}
                      onChange={(e) =>
                        updateFormExpectedFieldValue(
                          EXPECTED_OUTPUT_FIELD_KEY,
                          e.target.value,
                          {
                            source: "user",
                          },
                        )
                      }
                      placeholder={
                        EXPECTED_OUTPUT_FIELD_DEFINITION?.placeholder ??
                        "Final rendered citation text"
                      }
                      rows={5}
                      className="font-mono text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <span>
                        {formExpectedOutputDirty
                          ? "Admin-edited output is preserved until you overwrite it."
                          : "This field auto-seeds from the engine preview."}
                      </span>
                      {formEngineRenderedOutput.trim() &&
                      !expectedOutputMatchesEnginePreview ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => {
                            setFormExpectedFieldValues((current) => ({
                              ...current,
                              [EXPECTED_OUTPUT_FIELD_KEY]:
                                formEngineRenderedOutput,
                            }));
                            setFormExpectedOutputDirty(false);
                          }}
                        >
                          Use engine output
                        </Button>
                      ) : null}
                    </div>
                    {formEngineRenderedOutput.trim() &&
                    !expectedOutputMatchesEnginePreview ? (
                      <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                        Expected output currently differs from the latest engine
                        preview.
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {formExpectedFieldKeys.map((key) => {
                    const definition = EXPECTED_FIELD_DEFINITION_BY_KEY[key];
                    const value = formExpectedFieldValues[key] ?? "";
                    const isMissing =
                      formShowMissingRequired &&
                      formMissingRequiredFields.includes(key);
                    return (
                      <div
                        key={key}
                        className={cn(
                          "grid gap-1",
                          definition?.multiline
                            ? "sm:col-span-2 xl:col-span-3"
                            : undefined,
                        )}
                      >
                        <HelpLabel
                          htmlFor={`truth-field-${key}`}
                          label={definition?.label ?? key}
                          help={
                            definition?.help ??
                            "Expected output value for this field."
                          }
                        />
                        {definition?.multiline ? (
                          <Textarea
                            id={`truth-field-${key}`}
                            value={value}
                            onChange={(e) =>
                              updateFormExpectedFieldValue(
                                key,
                                e.target.value,
                                { source: "user" },
                              )
                            }
                            placeholder={definition.placeholder}
                            rows={4}
                            className={cn(
                              "text-xs",
                              isMissing
                                ? "border-amber-500 ring-1 ring-amber-300"
                                : undefined,
                            )}
                          />
                        ) : (
                          <Input
                            id={`truth-field-${key}`}
                            value={value}
                            onChange={(e) =>
                              updateFormExpectedFieldValue(
                                key,
                                e.target.value,
                                { source: "user" },
                              )
                            }
                            placeholder={
                              definition?.placeholder ?? "Enter value"
                            }
                            className={cn(
                              isMissing
                                ? "border-amber-500 ring-1 ring-amber-300"
                                : undefined,
                            )}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <AdminTrainingJsonPreview
                  open={editorJsonPreviewOpen}
                  onOpenChange={setEditorJsonPreviewOpen}
                  preview={toExpectedFieldsPreviewFromValues(
                    formExpectedFieldValues,
                  )}
                />
              </div>
            </AdminTrainingWorkflowSection>

            <AdminTrainingWorkflowSection
              step="Step 3"
              title="Set type and input style"
              description="Lock the citation family, the observed input style, and provenance before saving or generating linked variants."
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="truth-type"
                    label="Expected type"
                    help={renderDropdownHelp(
                      "Choose the citation family that best matches this row.",
                      truthTypeOptions.map((option) => ({
                        label: option.label,
                        description:
                          "Use this when the citation clearly belongs to this family.",
                      })),
                    )}
                  />
                  <select
                    id="truth-type"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={formExpectedType}
                    onChange={(e) => {
                      setFormExpectedType(e.target.value);
                      setFormEnginePreviewStale(true);
                    }}
                  >
                    <option value="">(none)</option>
                    {truthTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="truth-style"
                    label="Input style label"
                    help={renderDropdownHelp(
                      "Choose the reviewed style of the observed input citation.",
                      truthStyleOptions.map((option) => ({
                        label: option.label,
                        description:
                          "Use when this is the style the input citation already appears in and should be used for style evaluation/training.",
                      })),
                    )}
                  />
                  <select
                    id="truth-style"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={formExpectedStyle}
                    onChange={(e) => {
                      const nextStyle = e.target.value;
                      setFormExpectedStyle(nextStyle);
                      setFormEnginePreviewStale(true);
                      if (
                        !formAdversarialPairTouched &&
                        formGoldKind === "style_adversarial" &&
                        !formAdversarialPair.trim()
                      ) {
                        const inferredPair = inferAdversarialPair(nextStyle);
                        if (inferredPair) {
                          setFormAdversarialPair(inferredPair);
                        }
                      }
                    }}
                  >
                    <option value="">(none)</option>
                    {truthStyleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="truth-prov"
                    label="Provenance"
                    help="Optional source note. Use this for DOI URLs, provider references, or source context you want Crossref and review flows to use."
                  />
                  <Input
                    id="truth-prov"
                    value={formProvenance}
                    onChange={(e) => setFormProvenance(e.target.value)}
                    placeholder="doi:10..., https://doi.org/..., Crossref import, manual review"
                  />
                </div>
              </div>
            </AdminTrainingWorkflowSection>

            <AdminTrainingWorkflowSection
              step="Step 4"
              title="Governance and audit"
              description="Most reviews should not need this. Open it only when split, quarantine, audit, or gold-program metadata must be changed."
            >
              <AdminTrainingDisclosureSection
                open={editorGovernanceOpen}
                onOpenChange={setEditorGovernanceOpen}
                title="Advanced governance & audit"
                summary={editorGovernanceSummary}
              >
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-split"
                      label="Dataset split"
                      help={renderDropdownHelp(
                        "Choose where this row is used.",
                        DATASET_SPLIT_OPTIONS,
                      )}
                    />
                    <select
                      id="truth-split"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={formDatasetSplit}
                      onChange={(e) =>
                        setFormDatasetSplit(
                          (e.target.value || "") as TruthDatasetSplit | "",
                        )
                      }
                    >
                      <option value="">(none)</option>
                      {DATASET_SPLIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-trust"
                      label="Trust level"
                      help={renderDropdownHelp(
                        "Legacy marker only. Export rules use certification + row status.",
                        TRUST_LEVEL_OPTIONS,
                      )}
                    />
                    <select
                      id="truth-trust"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={formTrustLevel}
                      onChange={(e) =>
                        setFormTrustLevel(e.target.value as TruthTrustLevel)
                      }
                    >
                      {TRUST_LEVEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-row-status"
                      label="Row status"
                      help={renderDropdownHelp(
                        "Controls whether this row can be exported.",
                        ROW_STATUS_OPTIONS,
                      )}
                    />
                    <select
                      id="truth-row-status"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={formRowStatus}
                      onChange={(e) =>
                        setFormRowStatus(e.target.value as TruthRowStatus)
                      }
                    >
                      {ROW_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-blocked-reason"
                      label="Blocked reason"
                      help={renderDropdownHelp(
                        "Required only when Row status is Quarantined.",
                        BLOCKED_REASON_OPTIONS,
                      )}
                    />
                    <select
                      id="truth-blocked-reason"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={formBlockedReason}
                      onChange={(e) =>
                        setFormBlockedReason(
                          (e.target.value || "") as TruthBlockedReason | "",
                        )
                      }
                    >
                      <option value="">(none)</option>
                      {BLOCKED_REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-kind"
                      label="Gold kind"
                      help={renderDropdownHelp(
                        "Select the purpose of this row in the gold workflow.",
                        GOLD_KIND_OPTIONS,
                      )}
                    />
                    <select
                      id="truth-kind"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={formGoldKind}
                      onChange={(e) => {
                        const nextKind = (e.target.value || "") as
                          | TruthGoldKind
                          | "";
                        setFormGoldKind(nextKind);
                        if (
                          nextKind === "style_adversarial" &&
                          !formAdversarialPairTouched &&
                          !formAdversarialPair.trim()
                        ) {
                          const inferredPair =
                            inferAdversarialPair(formExpectedStyle);
                          if (inferredPair) {
                            setFormAdversarialPair(inferredPair);
                          }
                        }
                      }}
                    >
                      <option value="">(none)</option>
                      {GOLD_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-approval-source"
                      label="Approval source"
                      help={renderDropdownHelp(
                        "Select where this row came from.",
                        APPROVAL_SOURCE_OPTIONS,
                      )}
                    />
                    <select
                      id="truth-approval-source"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={formApprovalSource}
                      onChange={(e) =>
                        setFormApprovalSource(
                          (e.target.value || "") as TruthApprovalSource | "",
                        )
                      }
                    >
                      <option value="">(none)</option>
                      {APPROVAL_SOURCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-adversarial-pair"
                      label="Adversarial pair"
                      help="Use this only for reviewed confusion-pair style rows, such as apa7_vs_harvard-ctr, mla9_vs_chicago-notes-bib, or vancouver_vs_ieee. Leave empty for normal clean rows."
                    />
                    <Input
                      id="truth-adversarial-pair"
                      value={formAdversarialPair}
                      onChange={(e) => {
                        setFormAdversarialPairTouched(true);
                        setFormAdversarialPair(e.target.value);
                      }}
                      placeholder="apa7_vs_harvard-ctr"
                    />
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="truth-noise-profile"
                      label="Noise profile"
                      help="Comma-separated tags for the degradation applied to this citation, such as ocr_like, punctuation_drift, or spacing_damage. Use only for noisy-style or noisy-field examples."
                    />
                    <Input
                      id="truth-noise-profile"
                      value={formNoiseProfile}
                      onChange={(e) => {
                        setFormNoiseProfileTouched(true);
                        setFormNoiseProfile(e.target.value);
                      }}
                      placeholder="ocr_like, punctuation_drift"
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="truth-reviewed"
                    label="Reviewed by"
                    help="Human reviewer identity for audit trails. Use an email address or internal handle so the row can be traced back to the reviewer."
                  />
                  <Input
                    id="truth-reviewed"
                    value={formReviewedBy}
                    onChange={(e) => setFormReviewedBy(e.target.value)}
                    placeholder="email or handle"
                  />
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="truth-audit-reason"
                    label="Audit reason"
                    help={renderDropdownHelp(
                      "Required for content-changing edits. Select the reason code for this truth update.",
                      AUDIT_REASON_OPTIONS,
                    )}
                  />
                  <select
                    id="truth-audit-reason"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={formAuditReasonCode}
                    onChange={(e) =>
                      setFormAuditReasonCode(
                        (e.target.value || "") as TruthAuditReasonCode | "",
                      )
                    }
                  >
                    {AUDIT_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="truth-notes"
                    label="Notes"
                    help="Free-text review notes, caveats, or labeling rationale. Use this when a row is unusual, intentionally abstained, or part of a known adversarial family."
                  />
                  <Textarea
                    id="truth-notes"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </AdminTrainingDisclosureSection>
            </AdminTrainingWorkflowSection>

            <AdminTrainingRenderVariantsSection
              editing={Boolean(editing)}
              renderVariantInputsDirty={renderVariantInputsDirty}
              variantEditorLocked={variantEditorLocked}
              generateRenderVariantsPending={
                generateRenderVariantsMutation.isPending
              }
              patchRenderVariantPending={patchRenderVariantMutation.isPending}
              approveRenderVariantPending={
                approveRenderVariantMutation.isPending
              }
              resetRenderVariantPending={resetRenderVariantMutation.isPending}
              rendererVersion={
                renderVariantsQuery.data?.rendererVersion ?? null
              }
              renderVariantsLoading={renderVariantsQuery.isLoading}
              renderVariantsError={renderVariantsQuery.isError}
              renderVariantsErrorMessage={renderVariantsErrorMessage}
              activeRenderVariantStyle={activeRenderVariantStyle}
              onActiveRenderVariantStyleChange={(style) =>
                setActiveRenderVariantStyle(style as TruthRenderVariantStyle)
              }
              renderVariantsByStyle={renderVariantsByStyle}
              variantTextOverrides={variantTextOverrides}
              variantNoteOverrides={variantNoteOverrides}
              onVariantTextChange={(style, value) =>
                setVariantTextOverrides((current) => ({
                  ...current,
                  [style]: value,
                }))
              }
              onVariantNoteChange={(style, value) =>
                setVariantNoteOverrides((current) => ({
                  ...current,
                  [style]: value,
                }))
              }
              onGenerateAllVariants={() =>
                generateRenderVariantsMutation.mutate(undefined)
              }
              onGenerateVariant={(style) =>
                generateRenderVariantsMutation.mutate([
                  style as TruthRenderVariantStyle,
                ])
              }
              onSaveVariant={(style, renderedText, notes) =>
                patchRenderVariantMutation.mutate({
                  style: style as TruthRenderVariantStyle,
                  renderedText,
                  notes,
                })
              }
              onToggleVariantApproval={(style, approved) =>
                approveRenderVariantMutation.mutate({
                  style: style as TruthRenderVariantStyle,
                  approved,
                })
              }
              onResetVariant={(style) =>
                resetRenderVariantMutation.mutate(
                  style as TruthRenderVariantStyle,
                )
              }
            />
          </div>
          <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <div>
                {editorDraftSyncState === "saving"
                  ? "Autosaving draft to your admin account..."
                  : editorDraftSyncState === "saved"
                    ? `Draft saved${editorDraftSavedAt ? ` ${new Date(editorDraftSavedAt).toLocaleString()}` : ""}.`
                    : editorDraftSyncState === "error"
                      ? "Draft autosave failed."
                      : "Unsaved edits auto-save to your admin account."}
              </div>
              {editorDraftDurable === false ? (
                <div className="text-amber-700 dark:text-amber-300">
                  Current runtime is {editorDraftPersistenceBackend}-backed.
                  Drafts survive refresh while this server stays up, but not a
                  server restart.
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={
                  prefillEditorMutation.isPending ||
                  crossrefEditorMutation.isPending ||
                  !formRawText.trim()
                }
                onClick={() => prefillEditorMutation.mutate()}
              >
                {prefillEditorMutation.isPending
                  ? "Prefilling..."
                  : "Prefill from engine"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  prefillEditorMutation.isPending ||
                  crossrefEditorMutation.isPending ||
                  !formRawText.trim()
                }
                onClick={() => crossrefEditorMutation.mutate()}
              >
                {crossrefEditorMutation.isPending
                  ? "Filling..."
                  : "Fill from Crossref DOI"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={createMutation.isPending || patchMutation.isPending}
                onClick={() => {
                  void discardEditorDraft({ close: true }).catch((error) => {
                    toast({
                      title: "Discard draft failed",
                      description:
                        error instanceof Error
                          ? error.message
                          : "Could not clear the saved approved-truth draft.",
                      variant: "destructive",
                    });
                  });
                }}
              >
                Discard draft
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeEditor()}
              >
                Close
              </Button>
              <Button
                type="button"
                disabled={
                  createMutation.isPending ||
                  patchMutation.isPending ||
                  prefillEditorMutation.isPending ||
                  crossrefEditorMutation.isPending ||
                  !formAuditReasonCode
                }
                onClick={() => {
                  if (editing) patchMutation.mutate();
                  else createMutation.mutate();
                }}
              >
                {editing ? "Save changes" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminTrainingBulkUpdateDialog
        bulkUpdateIds={bulkUpdateIds}
        bulkUpdateAllFiltered={bulkUpdateAllFiltered}
        closeBulkUpdateDialog={closeBulkUpdateDialog}
        bulkUpdateTrustLevel={bulkUpdateTrustLevel}
        setBulkUpdateTrustLevel={setBulkUpdateTrustLevel}
        bulkUpdateRowStatus={bulkUpdateRowStatus}
        setBulkUpdateRowStatus={setBulkUpdateRowStatus}
        bulkUpdateBlockedReason={bulkUpdateBlockedReason}
        setBulkUpdateBlockedReason={setBulkUpdateBlockedReason}
        bulkUpdateMutationPending={bulkUpdateMutation.isPending}
        startTruthBackgroundJobPending={startTruthBackgroundJobMutation.isPending}
        onBulkUpdate={() => bulkUpdateMutation.mutate()}
        startAllFilteredTruthJob={startAllFilteredTruthJob}
      />

      <AdminTrainingCertifyDialog
        bulkCertifyDialogOpen={bulkCertifyDialogOpen}
        closeCertifyDialog={closeCertifyDialog}
        bulkCertifyIds={bulkCertifyIds}
        bulkCertifyAllFiltered={bulkCertifyAllFiltered}
        bulkCertifyRowCount={bulkCertifyRowCount}
        bulkCertifyPageCount={bulkCertifyPageCount}
        certifyRow={certifyRow}
        certifyTask={certifyTask}
        setCertifyTask={setCertifyTask}
        certifyScope={certifyScope}
        setCertifyScope={setCertifyScope}
        certifyPackTarget={certifyPackTarget}
        setCertifyPackTarget={setCertifyPackTarget}
        certifyStatus={certifyStatus}
        setCertifyStatus={setCertifyStatus}
        certifyBy={certifyBy}
        setCertifyBy={setCertifyBy}
        certifyRequiredPasses={certifyRequiredPasses}
        setCertifyRequiredPasses={setCertifyRequiredPasses}
        certifyCompletedPasses={certifyCompletedPasses}
        setCertifyCompletedPasses={setCertifyCompletedPasses}
        certifyDecisionHash={certifyDecisionHash}
        setCertifyDecisionHash={setCertifyDecisionHash}
        defaultTrainingPackTargetForTask={defaultTrainingPackTargetForTask}
        certifyMutationPending={certifyMutation.isPending}
        bulkCertifyMutationPending={bulkCertifyMutation.isPending}
        startTruthBackgroundJobPending={startTruthBackgroundJobMutation.isPending}
        onCertify={() => certifyMutation.mutate()}
        onBulkCertify={() => bulkCertifyMutation.mutate()}
        startAllFilteredTruthJob={startAllFilteredTruthJob}
        toast={toast}
      />

      <Dialog
        open={bulkQueuePromoteDialogOpen}
        onOpenChange={(open) => !open && closeBulkQueuePromoteDialog()}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Promote selected queue rows</DialogTitle>
            <DialogDescription className="sr-only">
              Promote multiple learning-queue rows into approved truth with
              shared type, style, and governance metadata.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <AdminTrainingWorkflowSection
              step="Step 1"
              title="Review the selection"
              description="Bulk promote keeps each queue row's detected field values and applies the shared metadata below across the selected queue groups."
            >
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <div className="font-semibold">Selection</div>
                <div className="mt-1">
                  {bulkQueuePromoteGroupCount} queue groups selected
                  {bulkQueuePromoteUnderlyingCount > bulkQueuePromoteGroupCount
                    ? ` (${bulkQueuePromoteUnderlyingCount} underlying references).`
                    : "."}
                </div>
                {bulkQueuePromoteRows.slice(0, 3).map((row) => (
                  <div
                    key={row.id}
                    className="mt-2 line-clamp-2 text-slate-600 dark:text-slate-300"
                  >
                    {normalizedRawInputFromQueue(row.trainingData) || "—"}
                  </div>
                ))}
                {bulkQueuePromoteRows.length > 3 ? (
                  <div className="mt-2 font-mono text-[10px] text-slate-500">
                    + {bulkQueuePromoteRows.length - 3} more selected queue rows
                  </div>
                ) : null}
              </div>
            </AdminTrainingWorkflowSection>

            <AdminTrainingWorkflowSection
              step="Step 2"
              title="Set shared type and input style"
              description="Use this when the selected queue rows should all receive the same citation family and observed input-style label."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="bulk-queue-promote-type"
                    label="Expected type"
                    help={renderDropdownHelp(
                      "Choose the citation family to apply across the selected queue rows.",
                      bulkQueuePromoteTypeOptions.map((option) => ({
                        label: option.label,
                        description:
                          "Use this when the selected citations all belong to this family.",
                      })),
                    )}
                  />
                  <select
                    id="bulk-queue-promote-type"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={bulkQueuePromoteExpectedType}
                    onChange={(e) =>
                      setBulkQueuePromoteExpectedType(e.target.value)
                    }
                  >
                    <option value="">(none)</option>
                    {bulkQueuePromoteTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="bulk-queue-promote-style"
                    label="Input style label"
                    help={renderDropdownHelp(
                      "Choose the observed style family to apply across the selected queue rows.",
                      bulkQueuePromoteStyleOptions.map((option) => ({
                        label: option.label,
                        description:
                          "Use when the selected citations all share this input style label.",
                      })),
                    )}
                  />
                  <select
                    id="bulk-queue-promote-style"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={bulkQueuePromoteExpectedStyle}
                    onChange={(e) => {
                      const nextStyle = e.target.value;
                      setBulkQueuePromoteExpectedStyle(nextStyle);
                      if (
                        !bulkQueuePromoteAdversarialPairTouched &&
                        bulkQueuePromoteGoldKind === "style_adversarial" &&
                        !bulkQueuePromoteAdversarialPair.trim()
                      ) {
                        const inferredPair = inferAdversarialPair(nextStyle);
                        if (inferredPair) {
                          setBulkQueuePromoteAdversarialPair(inferredPair);
                        }
                      }
                    }}
                  >
                    <option value="">(none)</option>
                    {bulkQueuePromoteStyleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </AdminTrainingWorkflowSection>

            <AdminTrainingWorkflowSection
              step="Step 3"
              title="Governance and audit"
              description="Use this when the selected queue rows should enter the same split, trust lane, or gold-program workflow."
            >
              <AdminTrainingDisclosureSection
                open={bulkQueuePromoteGovernanceOpen}
                onOpenChange={setBulkQueuePromoteGovernanceOpen}
                title="Advanced governance & audit"
                summary={bulkQueuePromoteGovernanceSummary}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="bulk-queue-promote-split"
                      label="Split"
                      help={renderDropdownHelp(
                        "Choose where these promoted rows should be used.",
                        DATASET_SPLIT_OPTIONS,
                      )}
                    />
                    <select
                      id="bulk-queue-promote-split"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bulkQueuePromoteDatasetSplit}
                      onChange={(e) =>
                        setBulkQueuePromoteDatasetSplit(
                          (e.target.value || "") as TruthDatasetSplit | "",
                        )
                      }
                    >
                      {DATASET_SPLIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="bulk-queue-promote-trust"
                      label="Trust"
                      help={renderDropdownHelp(
                        "Legacy marker only. Export rules use certification + row status.",
                        TRUST_LEVEL_OPTIONS,
                      )}
                    />
                    <select
                      id="bulk-queue-promote-trust"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bulkQueuePromoteTrust}
                      onChange={(e) =>
                        setBulkQueuePromoteTrust(
                          e.target.value as TruthTrustLevel,
                        )
                      }
                    >
                      {TRUST_LEVEL_OPTIONS.map((option) => (
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
                      htmlFor="bulk-queue-promote-row-status"
                      label="Row status"
                      help={renderDropdownHelp(
                        "Controls whether these rows can be exported.",
                        ROW_STATUS_OPTIONS,
                      )}
                    />
                    <select
                      id="bulk-queue-promote-row-status"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bulkQueuePromoteRowStatus}
                      onChange={(e) =>
                        setBulkQueuePromoteRowStatus(
                          e.target.value as TruthRowStatus,
                        )
                      }
                    >
                      {ROW_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="bulk-queue-promote-blocked-reason"
                      label="Blocked reason"
                      help={renderDropdownHelp(
                        "Required only when Row status is Quarantined.",
                        BLOCKED_REASON_OPTIONS,
                      )}
                    />
                    <select
                      id="bulk-queue-promote-blocked-reason"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bulkQueuePromoteBlockedReason}
                      onChange={(e) =>
                        setBulkQueuePromoteBlockedReason(
                          (e.target.value || "") as TruthBlockedReason | "",
                        )
                      }
                    >
                      <option value="">(none)</option>
                      {BLOCKED_REASON_OPTIONS.map((option) => (
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
                      htmlFor="bulk-queue-promote-kind"
                      label="Gold kind"
                      help={renderDropdownHelp(
                        "Select the purpose of these promoted rows.",
                        GOLD_KIND_OPTIONS,
                      )}
                    />
                    <select
                      id="bulk-queue-promote-kind"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bulkQueuePromoteGoldKind}
                      onChange={(e) => {
                        const nextKind = (e.target.value || "") as
                          | TruthGoldKind
                          | "";
                        setBulkQueuePromoteGoldKind(nextKind);
                        if (
                          nextKind === "style_adversarial" &&
                          !bulkQueuePromoteAdversarialPairTouched &&
                          !bulkQueuePromoteAdversarialPair.trim()
                        ) {
                          const inferredPair = inferAdversarialPair(
                            bulkQueuePromoteExpectedStyle,
                          );
                          if (inferredPair) {
                            setBulkQueuePromoteAdversarialPair(inferredPair);
                          }
                        }
                      }}
                    >
                      <option value="">(none)</option>
                      {GOLD_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="bulk-queue-promote-approval-source"
                      label="Approval source"
                      help={renderDropdownHelp(
                        "Select where these promoted rows came from.",
                        APPROVAL_SOURCE_OPTIONS,
                      )}
                    />
                    <select
                      id="bulk-queue-promote-approval-source"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bulkQueuePromoteApprovalSource}
                      onChange={(e) =>
                        setBulkQueuePromoteApprovalSource(
                          (e.target.value || "") as TruthApprovalSource | "",
                        )
                      }
                    >
                      <option value="">(none)</option>
                      {APPROVAL_SOURCE_OPTIONS.map((option) => (
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
                      htmlFor="bulk-queue-promote-adversarial-pair"
                      label="Adversarial pair"
                      help="Confusion-pair tag for hard style rows only, such as mla9_vs_chicago-notes-bib."
                    />
                    <Input
                      id="bulk-queue-promote-adversarial-pair"
                      value={bulkQueuePromoteAdversarialPair}
                      onChange={(e) => {
                        setBulkQueuePromoteAdversarialPairTouched(true);
                        setBulkQueuePromoteAdversarialPair(e.target.value);
                      }}
                      placeholder="mla9_vs_chicago-notes-bib"
                    />
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="bulk-queue-promote-noise-profile"
                      label="Noise profile"
                      help="Comma-separated degradation tags used when these promoted rows are part of a noisy dataset."
                    />
                    <Input
                      id="bulk-queue-promote-noise-profile"
                      value={bulkQueuePromoteNoiseProfile}
                      onChange={(e) =>
                        setBulkQueuePromoteNoiseProfile(e.target.value)
                      }
                      placeholder="spacing_damage, ocr_like"
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="bulk-queue-promote-reviewed"
                    label="Reviewed by"
                    help="Reviewer identity for the approval audit trail."
                  />
                  <Input
                    id="bulk-queue-promote-reviewed"
                    value={bulkQueuePromoteReviewedBy}
                    onChange={(e) =>
                      setBulkQueuePromoteReviewedBy(e.target.value)
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="bulk-queue-promote-audit-reason"
                    label="Audit reason"
                    help={renderDropdownHelp(
                      "Required for learning-queue promotion into approved truth.",
                      AUDIT_REASON_OPTIONS,
                    )}
                  />
                  <select
                    id="bulk-queue-promote-audit-reason"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={bulkQueuePromoteAuditReasonCode}
                    onChange={(e) =>
                      setBulkQueuePromoteAuditReasonCode(
                        (e.target.value || "") as TruthAuditReasonCode | "",
                      )
                    }
                  >
                    {AUDIT_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="bulk-queue-promote-notes"
                    label="Notes"
                    help="Optional review notes explaining why this shared bulk decision applies to the selected queue rows."
                  />
                  <Textarea
                    id="bulk-queue-promote-notes"
                    value={bulkQueuePromoteNotes}
                    onChange={(e) => setBulkQueuePromoteNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </AdminTrainingDisclosureSection>
            </AdminTrainingWorkflowSection>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeBulkQueuePromoteDialog}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                bulkQueuePromoteMutation.isPending ||
                !bulkQueuePromoteAuditReasonCode
              }
              onClick={() => bulkQueuePromoteMutation.mutate()}
            >
              {bulkQueuePromoteMutation.isPending
                ? "Promoting..."
                : "Promote selected"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={promoteItem !== null}
        onOpenChange={(open) => !open && setPromoteItem(null)}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            promoteRawTextareaRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Promote queue row</DialogTitle>
            <DialogDescription className="sr-only">
              Promote a learning queue item into approved truth with governance
              metadata.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <AdminTrainingWorkflowSection
              step="Step 1"
              title="Review the queued citation"
              description="Start from the raw citation text from the learning queue, then confirm the truth you want to promote."
            >
              <div className="grid gap-1">
                <HelpLabel
                  htmlFor="promote-raw"
                  label="Raw text"
                  help="The original citation text from the learning queue. Review and correct it before promoting the row into approved truth."
                />
                <Textarea
                  id="promote-raw"
                  ref={promoteRawTextareaRef}
                  value={promoteRaw}
                  onChange={(e) => {
                    const nextRaw = e.target.value;
                    setPromoteRaw(nextRaw);
                    if (
                      !promoteNoiseProfileTouched &&
                      !promoteNoiseProfile.trim()
                    ) {
                      const detected = detectNoiseProfileFromRawText(nextRaw);
                      if (detected.length > 0) {
                        setPromoteNoiseProfile(detected.join(", "));
                      }
                    }
                  }}
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>
            </AdminTrainingWorkflowSection>

            <AdminTrainingWorkflowSection
              step="Step 2"
              title="Confirm the truth fields"
              description="Review only the fields you want to enforce. Blank fields stay out of the promoted truth row."
            >
              <div className="grid gap-1">
                <HelpLabel
                  label="Expected fields"
                  help='Fill only fields you want to enforce. Leave blank fields out of expected output. Use "|" to separate multi-values.'
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPromoteShowMissingRequired((current) => !current)
                    }
                    disabled={!promoteExpectedType}
                  >
                    {promoteShowMissingRequired
                      ? "Hide missing required"
                      : "Highlight missing required"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPromoteExpectedFieldValues((current) =>
                        Object.fromEntries(
                          Object.entries(current).map(([key]) => [key, ""]),
                        ),
                      )
                    }
                  >
                    Clear field values
                  </Button>
                  {promoteExpectedType ? (
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      Required for {promoteExpectedType}:{" "}
                      {(
                        REQUIRED_EXPECTED_FIELDS_BY_TYPE[promoteExpectedType] ??
                        []
                      ).join(", ") || "none"}
                    </span>
                  ) : null}
                </div>
                {promoteShowMissingRequired &&
                promoteMissingRequiredFields.length > 0 ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Missing required fields:{" "}
                    {promoteMissingRequiredFields.join(", ")}
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  {promoteExpectedFieldKeys.map((key) => {
                    const definition = EXPECTED_FIELD_DEFINITION_BY_KEY[key];
                    const value = promoteExpectedFieldValues[key] ?? "";
                    const isMissing =
                      promoteShowMissingRequired &&
                      promoteMissingRequiredFields.includes(key);
                    return (
                      <div key={key} className="grid gap-1">
                        <HelpLabel
                          htmlFor={`promote-field-${key}`}
                          label={definition?.label ?? key}
                          help={
                            definition?.help ??
                            "Expected output value for this field."
                          }
                        />
                        <Input
                          id={`promote-field-${key}`}
                          value={value}
                          onChange={(e) =>
                            setPromoteExpectedFieldValues((current) => ({
                              ...current,
                              [key]: e.target.value,
                            }))
                          }
                          placeholder={definition?.placeholder ?? "Enter value"}
                          className={cn(
                            isMissing
                              ? "border-amber-500 ring-1 ring-amber-300"
                              : undefined,
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
                <AdminTrainingJsonPreview
                  open={promoteJsonPreviewOpen}
                  onOpenChange={setPromoteJsonPreviewOpen}
                  preview={toExpectedFieldsPreviewFromValues(
                    promoteExpectedFieldValues,
                  )}
                />
              </div>
            </AdminTrainingWorkflowSection>

            <AdminTrainingWorkflowSection
              step="Step 3"
              title="Set type and input style"
              description="Choose the citation family and observed input style before the row enters reviewed truth."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="promote-type"
                    label="Expected type"
                    help={renderDropdownHelp(
                      "Choose the citation family that best matches this promoted row.",
                      promoteTypeOptions.map((option) => ({
                        label: option.label,
                        description:
                          "Use this when the citation clearly belongs to this family.",
                      })),
                    )}
                  />
                  <select
                    id="promote-type"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={promoteExpectedType}
                    onChange={(e) => setPromoteExpectedType(e.target.value)}
                  >
                    <option value="">(none)</option>
                    {promoteTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="promote-style"
                    label="Input style label"
                    help={renderDropdownHelp(
                      "Choose the reviewed style of the observed input citation for this promoted row.",
                      promoteStyleOptions.map((option) => ({
                        label: option.label,
                        description:
                          "Use when this is the style the input citation already appears in and should be used for style evaluation/training.",
                      })),
                    )}
                  />
                  <select
                    id="promote-style"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={promoteExpectedStyle}
                    onChange={(e) => {
                      const nextStyle = e.target.value;
                      setPromoteExpectedStyle(nextStyle);
                      if (
                        !promoteAdversarialPairTouched &&
                        promoteGoldKind === "style_adversarial" &&
                        !promoteAdversarialPair.trim()
                      ) {
                        const inferredPair = inferAdversarialPair(nextStyle);
                        if (inferredPair) {
                          setPromoteAdversarialPair(inferredPair);
                        }
                      }
                    }}
                  >
                    <option value="">(none)</option>
                    {promoteStyleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </AdminTrainingWorkflowSection>

            <AdminTrainingWorkflowSection
              step="Step 4"
              title="Governance and audit"
              description="Use this only when promotion needs split, quarantine, audit, or gold-program metadata."
            >
              <AdminTrainingDisclosureSection
                open={promoteGovernanceOpen}
                onOpenChange={setPromoteGovernanceOpen}
                title="Advanced governance & audit"
                summary={promoteGovernanceSummary}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="promote-split"
                      label="Split"
                      help={renderDropdownHelp(
                        "Choose where this promoted row should be used.",
                        DATASET_SPLIT_OPTIONS,
                      )}
                    />
                    <select
                      id="promote-split"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promoteDatasetSplit}
                      onChange={(e) =>
                        setPromoteDatasetSplit(
                          (e.target.value || "") as TruthDatasetSplit | "",
                        )
                      }
                    >
                      {DATASET_SPLIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="promote-trust"
                      label="Trust"
                      help={renderDropdownHelp(
                        "Legacy marker only. Export rules use certification + row status.",
                        TRUST_LEVEL_OPTIONS,
                      )}
                    />
                    <select
                      id="promote-trust"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promoteTrust}
                      onChange={(e) =>
                        setPromoteTrust(e.target.value as TruthTrustLevel)
                      }
                    >
                      {TRUST_LEVEL_OPTIONS.map((option) => (
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
                      htmlFor="promote-row-status"
                      label="Row status"
                      help={renderDropdownHelp(
                        "Controls whether this row can be exported.",
                        ROW_STATUS_OPTIONS,
                      )}
                    />
                    <select
                      id="promote-row-status"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promoteRowStatus}
                      onChange={(e) =>
                        setPromoteRowStatus(e.target.value as TruthRowStatus)
                      }
                    >
                      {ROW_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="promote-blocked-reason"
                      label="Blocked reason"
                      help={renderDropdownHelp(
                        "Required only when Row status is Quarantined.",
                        BLOCKED_REASON_OPTIONS,
                      )}
                    />
                    <select
                      id="promote-blocked-reason"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promoteBlockedReason}
                      onChange={(e) =>
                        setPromoteBlockedReason(
                          (e.target.value || "") as TruthBlockedReason | "",
                        )
                      }
                    >
                      <option value="">(none)</option>
                      {BLOCKED_REASON_OPTIONS.map((option) => (
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
                      htmlFor="promote-kind"
                      label="Gold kind"
                      help={renderDropdownHelp(
                        "Select the purpose of this promoted row.",
                        GOLD_KIND_OPTIONS,
                      )}
                    />
                    <select
                      id="promote-kind"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promoteGoldKind}
                      onChange={(e) => {
                        const nextKind = (e.target.value || "") as
                          | TruthGoldKind
                          | "";
                        setPromoteGoldKind(nextKind);
                        if (
                          nextKind === "style_adversarial" &&
                          !promoteAdversarialPairTouched &&
                          !promoteAdversarialPair.trim()
                        ) {
                          const inferredPair =
                            inferAdversarialPair(promoteExpectedStyle);
                          if (inferredPair) {
                            setPromoteAdversarialPair(inferredPair);
                          }
                        }
                      }}
                    >
                      <option value="">(none)</option>
                      {GOLD_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="promote-approval-source"
                      label="Approval source"
                      help={renderDropdownHelp(
                        "Select where this promoted row came from.",
                        APPROVAL_SOURCE_OPTIONS,
                      )}
                    />
                    <select
                      id="promote-approval-source"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promoteApprovalSource}
                      onChange={(e) =>
                        setPromoteApprovalSource(
                          (e.target.value || "") as TruthApprovalSource | "",
                        )
                      }
                    >
                      <option value="">(none)</option>
                      {APPROVAL_SOURCE_OPTIONS.map((option) => (
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
                      htmlFor="promote-adversarial-pair"
                      label="Adversarial pair"
                      help="Confusion-pair tag for hard style rows only, such as mla9_vs_chicago-notes-bib."
                    />
                    <Input
                      id="promote-adversarial-pair"
                      value={promoteAdversarialPair}
                      onChange={(e) => {
                        setPromoteAdversarialPairTouched(true);
                        setPromoteAdversarialPair(e.target.value);
                      }}
                      placeholder="mla9_vs_chicago-notes-bib"
                    />
                  </div>
                  <div className="grid gap-1">
                    <HelpLabel
                      htmlFor="promote-noise-profile"
                      label="Noise profile"
                      help="Comma-separated degradation tags used when this promoted row is part of a noisy dataset."
                    />
                    <Input
                      id="promote-noise-profile"
                      value={promoteNoiseProfile}
                      onChange={(e) => {
                        setPromoteNoiseProfileTouched(true);
                        setPromoteNoiseProfile(e.target.value);
                      }}
                      placeholder="spacing_damage, ocr_like"
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="promote-reviewed"
                    label="Reviewed by"
                    help="Reviewer identity for the approval audit trail."
                  />
                  <Input
                    id="promote-reviewed"
                    value={promoteReviewedBy}
                    onChange={(e) => setPromoteReviewedBy(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="promote-audit-reason"
                    label="Audit reason"
                    help={renderDropdownHelp(
                      "Required for learning-queue promotion into approved truth.",
                      AUDIT_REASON_OPTIONS,
                    )}
                  />
                  <select
                    id="promote-audit-reason"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={promoteAuditReasonCode}
                    onChange={(e) =>
                      setPromoteAuditReasonCode(
                        (e.target.value || "") as TruthAuditReasonCode | "",
                      )
                    }
                  >
                    {AUDIT_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <HelpLabel
                    htmlFor="promote-notes"
                    label="Notes"
                    help="Optional review notes explaining corrections, uncertainty, or why the row belongs in a specific gold workflow category."
                  />
                  <Textarea
                    id="promote-notes"
                    value={promoteNotes}
                    onChange={(e) => setPromoteNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </AdminTrainingDisclosureSection>
            </AdminTrainingWorkflowSection>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPromoteItem(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={promoteMutation.isPending || !promoteAuditReasonCode}
              onClick={() => promoteMutation.mutate()}
            >
              Promote to reviewed truth
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
