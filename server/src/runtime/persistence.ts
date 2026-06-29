/**
 * Unified persistence facade.
 *
 * Delegates every store operation to either the transient test backend
 * (store.ts) or the Postgres backend (dbStore.ts) based on the
 * explicit runtime persistence mode.
 *
 * Callers should `await` every call; the transient test branch returns
 * synchronously but `await` on a non-Promise is a harmless no-op.
 */

import * as memStore from './store.js';
import * as dbStore from './dbStore.js';
import { env } from '../config.js';
import { resolvePersistenceBackend } from './persistenceMode.js';
import { normalizeExpectedTruthFields } from '../training/truthFields.js';
import { legacyTrustToRowStatus } from '../training/truthCertification.js';
import { resetReportIpLimiter } from '../services/reportIpLimiter.js';

export { useDbStore } from './dbStore.js';

export const runtimePersistenceBackend = resolvePersistenceBackend({
  nodeEnv: env.NODE_ENV,
  configuredBackend: env.PERSISTENCE_BACKEND,
  databaseUrl: process.env.DATABASE_URL,
});

const useDb = runtimePersistenceBackend === 'database';
let approvedTruthRevision = 0;

function bumpApprovedTruthRevision(): void {
  approvedTruthRevision += 1;
}

export function getApprovedTruthRevision(): number {
  return approvedTruthRevision;
}

// Re-export types so consumers can import everything from one place
export type {
  ApprovedTruthEditorDraftPayload,
  StoredJob,
  StoredEvent,
  StoredJobStatus,
  StoredExport,
  StoredCorrection,
  StoredReport,
  StoredReviewEvent,
  StoredFieldApprovalDecision,
  StoredFieldApprovalMap,
  StoredReportDuplicateDecision,
  StoredReportResolutionTrace,
  StoredProposedPattern,
  StoredReportReviewState,
  StoredMutationOptions,
  StoredApiKey,
  StoredBatchHealthSummary,
  StoredAdminReferenceArchiveFilters,
  StoredAdminReferenceHealthLabel,
  StoredAdminReferenceArchiveItem,
  StoredAdminReferenceArchiveResult,
  StoredAdminReferenceOwnerType,
  StoredAdminReferenceStorageStatus,
  StoredCitationVersion,
  StoredCitationExtractionHistory,
  LearningQueueItem,
  StoredApprovedTruth,
  StoredApprovedTruthRenderVariant,
  StoredApprovedTruthEditorDraft,
  TruthApprovalSource,
  TruthDifficultyTier,
  TruthDatasetSplit,
  TruthGoldKind,
  TruthStyleEvaluationSuite,
  TruthStyleInferabilityTier,
  TruthRenderVariantApprovalStatus,
  TruthRenderVariantDatasetLane,
  TruthRenderVariantQualityTier,
  TruthRenderVariantSourceKind,
  TruthRenderVariantStyle,
  TruthTrustLevel,
  StoredEgressEvent,
  StoredEgressRollup,
} from './store.js';

/* ------------------------------------------------------------------ */
/*  Jobs                                                               */
/* ------------------------------------------------------------------ */

export const saveJob = useDb ? dbStore.saveJob : memStore.saveJob;
export const getJob = useDb ? dbStore.getJob : memStore.getJob;
export const updateJob = useDb ? dbStore.updateJob : memStore.updateJob;
export const listJobs = useDb ? dbStore.listJobs : memStore.listJobs;
export const appendJobEvent = useDb
  ? dbStore.appendJobEvent
  : memStore.appendJobEvent;
export const saveJobExport = useDb
  ? dbStore.saveJobExport
  : memStore.saveJobExport;
export const getJobExport = useDb
  ? dbStore.getJobExport
  : memStore.getJobExport;
export const listJobExports = useDb
  ? dbStore.listJobExports
  : memStore.listJobExports;
export const listActiveJobs = useDb
  ? dbStore.listActiveJobs
  : memStore.listActiveJobs;
export const listClaimableAsyncJobIds = useDb
  ? dbStore.listClaimableAsyncJobIds
  : async (_staleBefore: Date, _limit = 25): Promise<string[]> => [];
export const claimAsyncJobForProcessing = useDb
  ? dbStore.claimAsyncJobForProcessing
  : async (_id: string, _staleBefore: Date): Promise<memStore.StoredJob | undefined> => undefined;
export const countActiveJobsForNonB2bScope = useDb
  ? dbStore.countActiveJobsForNonB2bScope
  : memStore.countActiveJobsForNonB2bScope;
export const countActiveB2bJobsForScope = useDb
  ? dbStore.countActiveB2bJobsForScope
  : memStore.countActiveB2bJobsForScope;
export const countActiveB2bJobsGlobal = useDb
  ? dbStore.countActiveB2bJobsGlobal
  : memStore.countActiveB2bJobsGlobal;

export const deleteJob = useDb
  ? dbStore.deleteJob
  : async (_id: string): Promise<boolean> => false;

/* ------------------------------------------------------------------ */
/*  Citations                                                          */
/* ------------------------------------------------------------------ */

export const getCitation = useDb
  ? dbStore.getCitation
  : memStore.getCitation;
export const updateCitation = useDb
  ? dbStore.updateCitation
  : memStore.updateCitation;

/* ------------------------------------------------------------------ */
/*  Corrections                                                        */
/* ------------------------------------------------------------------ */

export const saveCorrection = useDb
  ? dbStore.saveCorrection
  : memStore.saveCorrection;
export const getCorrection = useDb
  ? dbStore.getCorrection
  : memStore.getCorrection;
export const listCorrections = useDb
  ? dbStore.listCorrections
  : memStore.listCorrections;
export const updateCorrection = useDb
  ? dbStore.updateCorrection
  : memStore.updateCorrection;

/* ------------------------------------------------------------------ */
/*  Reports                                                            */
/* ------------------------------------------------------------------ */

export const saveReport = useDb ? dbStore.saveReport : memStore.saveReport;
export const getReport = useDb ? dbStore.getReport : memStore.getReport;
export const listReports = useDb
  ? dbStore.listReports
  : memStore.listReports;
export const updateReport = useDb
  ? dbStore.updateReport
  : memStore.updateReport;
export const deleteReports = useDb
  ? dbStore.deleteReports
  : async (ids: string[]) => memStore.deleteReports(ids);
export const listReportsByJobId = useDb
  ? dbStore.listReportsByJobId
  : memStore.listReportsByJobId;

/* ------------------------------------------------------------------ */
/*  Batch health summaries                                             */
/* ------------------------------------------------------------------ */

export const saveBatchHealthSummary = useDb
  ? dbStore.saveBatchHealthSummary
  : memStore.saveBatchHealthSummary;
export const getBatchHealthSummary = useDb
  ? dbStore.getBatchHealthSummary
  : memStore.getBatchHealthSummary;
export const listBatchHealthSummaries = useDb
  ? dbStore.listBatchHealthSummaries
  : memStore.listBatchHealthSummaries;
export const deleteBatchHealthSummary = useDb
  ? dbStore.deleteBatchHealthSummary
  : memStore.deleteBatchHealthSummary;

export const listAdminReferenceArchive = useDb
  ? dbStore.listAdminReferenceArchive
  : memStore.listAdminReferenceArchive;

/* ------------------------------------------------------------------ */
/*  API Keys                                                           */
/* ------------------------------------------------------------------ */

export const saveApiKey = useDb ? dbStore.saveApiKey : memStore.saveApiKey;
export const getApiKey = useDb ? dbStore.getApiKey : memStore.getApiKey;
export const listApiKeys = useDb
  ? dbStore.listApiKeys
  : memStore.listApiKeys;
export const deleteApiKey = useDb
  ? dbStore.deleteApiKey
  : memStore.deleteApiKey;
export const getUserTier = useDb
  ? dbStore.getUserTier
  : memStore.getUserTier;

/* ------------------------------------------------------------------ */
/*  Citation Versions                                                  */
/* ------------------------------------------------------------------ */

export const saveCitationVersion = useDb
  ? dbStore.saveCitationVersion
  : memStore.saveCitationVersion;
export const appendCitationVersion = useDb
  ? dbStore.appendCitationVersion
  : memStore.appendCitationVersion;
export const listCitationVersions = useDb
  ? dbStore.listCitationVersions
  : memStore.listCitationVersions;
export const saveCitationExtractionHistory = useDb
  ? dbStore.saveCitationExtractionHistory
  : memStore.saveCitationExtractionHistory;
export const saveCitationExtractionHistoryBatch = useDb
  ? dbStore.saveCitationExtractionHistoryBatch
  : memStore.saveCitationExtractionHistoryBatch;
export const listCitationExtractionHistory = useDb
  ? dbStore.listCitationExtractionHistory
  : memStore.listCitationExtractionHistory;
export const listShadowExtractionHistory = useDb
  ? dbStore.listShadowExtractionHistory
  : memStore.listShadowExtractionHistory;

/* ------------------------------------------------------------------ */
/*  Usage                                                              */
/* ------------------------------------------------------------------ */

export const currentUsageDayKey = useDb
  ? dbStore.currentUsageDayKey
  : memStore.currentUsageDayKey;
export const getUsageForDay = useDb
  ? dbStore.getUsageForDay
  : memStore.getUsageForDay;
export const consumeUsage = useDb
  ? dbStore.consumeUsage
  : memStore.consumeUsage;
export const resetUsage = useDb ? dbStore.resetUsage : memStore.resetUsage;
export const getEnrichmentUsageForDay = useDb
  ? dbStore.getEnrichmentUsageForDay
  : memStore.getEnrichmentUsageForDay;
export const consumeEnrichmentUsage = useDb
  ? dbStore.consumeEnrichmentUsage
  : memStore.consumeEnrichmentUsage;

/* ------------------------------------------------------------------ */
/*  Learning Queue                                                     */
/* ------------------------------------------------------------------ */

export const saveLearningQueueItem = useDb
  ? dbStore.saveLearningQueueItem
  : memStore.saveLearningQueueItem;
export const listLearningQueue = useDb
  ? dbStore.listLearningQueue
  : memStore.listLearningQueue;
export const markLearningQueueItemsProcessed = useDb
  ? dbStore.markLearningQueueItemsProcessed
  : memStore.markLearningQueueItemsProcessed;
export const markLearningQueueItemsUnprocessed = useDb
  ? dbStore.markLearningQueueItemsUnprocessed
  : memStore.markLearningQueueItemsUnprocessed;
import * as truthDb from './approvedTruthStore.js';
import * as editorDraftDb from './adminEditorDraftStore.js';

function stableStringifyTruthValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringifyTruthValue(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringifyTruthValue(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildTruthRenderVariantFingerprint(input: {
  expectedFields: Record<string, unknown>;
  coreTruth?: Record<string, unknown> | null;
  expectedType?: string | null;
}): string {
  const canonicalTruth = normalizeExpectedTruthFields(input.coreTruth ?? input.expectedFields);
  return stableStringifyTruthValue({
    expectedType: input.expectedType ?? null,
    canonicalTruth,
  });
}

export async function listApprovedTruth(filters?: {
  trustLevel?: memStore.TruthTrustLevel;
  rowStatus?: memStore.TruthRowStatus;
  datasetSplit?: memStore.TruthDatasetSplit;
  datasetVersion?: string;
  limit?: number;
}): Promise<memStore.StoredApprovedTruth[]> {
  if (useDb) {
    return truthDb.listApprovedTruthDb(filters);
  }
  return Promise.resolve(memStore.listApprovedTruth(filters));
}

export async function getApprovedTruth(id: string): Promise<memStore.StoredApprovedTruth | null> {
  if (useDb) {
    return truthDb.getApprovedTruthDb(id);
  }
  return Promise.resolve(memStore.getApprovedTruth(id) ?? null);
}

export async function getApprovedTruthByInputHash(
  inputHash: string,
): Promise<memStore.StoredApprovedTruth | null> {
  if (useDb) {
    return truthDb.getApprovedTruthByInputHashDb(inputHash);
  }
  return Promise.resolve(
    memStore.listApprovedTruth({ limit: 50_000 }).find((row) => row.inputHash === inputHash) ?? null,
  );
}

export async function listApprovedTruthRenderVariants(
  truthRowId: string,
): Promise<memStore.StoredApprovedTruthRenderVariant[]> {
  if (useDb) {
    return truthDb.listApprovedTruthRenderVariantsDb(truthRowId);
  }
  return Promise.resolve(memStore.listApprovedTruthRenderVariants(truthRowId));
}

export async function getApprovedTruthRenderVariant(
  truthRowId: string,
  style: memStore.TruthRenderVariantStyle,
): Promise<memStore.StoredApprovedTruthRenderVariant | null> {
  if (useDb) {
    return truthDb.getApprovedTruthRenderVariantDb(truthRowId, style);
  }
  return Promise.resolve(memStore.getApprovedTruthRenderVariant(truthRowId, style) ?? null);
}

export async function upsertApprovedTruthRenderVariant(input: {
  id?: string;
  truthRowId: string;
  style: memStore.TruthRenderVariantStyle;
  generatedText: string;
  renderedText: string;
  sourceKind: memStore.TruthRenderVariantSourceKind;
  approvalStatus: memStore.TruthRenderVariantApprovalStatus;
  qualityTier: memStore.TruthRenderVariantQualityTier;
  datasetLane: memStore.TruthRenderVariantDatasetLane;
  rendererVersion: string;
  stale?: boolean;
  generatedAt?: string | Date | null;
  approvedAt?: string | Date | null;
  approvedBy?: string | null;
  notes?: string | null;
}): Promise<memStore.StoredApprovedTruthRenderVariant> {
  if (useDb) {
    return truthDb.upsertApprovedTruthRenderVariantDb(input);
  }
  const now = new Date().toISOString();
  const existing = memStore.getApprovedTruthRenderVariant(input.truthRowId, input.style);
  return Promise.resolve(
    memStore.upsertApprovedTruthRenderVariant({
      id: existing?.id ?? input.id ?? `${input.truthRowId}:${input.style}`,
      truthRowId: input.truthRowId,
      style: input.style,
      generatedText: input.generatedText,
      renderedText: input.renderedText,
      sourceKind: input.sourceKind,
      approvalStatus: input.approvalStatus,
      qualityTier: input.qualityTier,
      datasetLane: input.datasetLane,
      rendererVersion: input.rendererVersion,
      stale: input.stale ?? existing?.stale ?? false,
      generatedAt:
        input.generatedAt instanceof Date
          ? input.generatedAt.toISOString()
          : input.generatedAt ?? existing?.generatedAt ?? now,
      approvedAt:
        input.approvedAt instanceof Date
          ? input.approvedAt.toISOString()
          : input.approvedAt ?? null,
      approvedBy: input.approvedBy ?? null,
      notes: input.notes ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }),
  );
}

export async function markApprovedTruthRenderVariantsStale(truthRowId: string): Promise<number> {
  if (useDb) {
    return truthDb.markApprovedTruthRenderVariantsStaleDb(truthRowId);
  }
  return Promise.resolve(memStore.markApprovedTruthRenderVariantsStale(truthRowId));
}

export async function upsertApprovedTruthPayload(input: {
  id?: string;
  rawText: string;
  expectedFields: Record<string, unknown>;
  coreTruth?: Record<string, unknown> | null;
  overlayTruth?: Record<string, unknown> | null;
  expectedType?: string | null;
  expectedStyle?: string | null;
  provenance?: string | null;
  pipelineMajor?: number | null;
  datasetSplit?: memStore.TruthDatasetSplit | null;
  trustLevel?: memStore.TruthTrustLevel;
  rowStatus?: memStore.TruthRowStatus;
  blockedReason?: memStore.TruthBlockedReason | null;
  taskCertifications?: memStore.TruthTaskCertification[] | null;
  workId?: string | null;
  familyId?: string | null;
  variantId?: string | null;
  canonicalWorkKey?: string | null;
  nearDupClusterId?: string | null;
  datasetVersion?: string | null;
  inputProfile?: memStore.TruthInputProfile | null;
  styleInferabilityTier?: memStore.TruthStyleInferabilityTier | null;
  styleEvaluationSuite?: memStore.TruthStyleEvaluationSuite | null;
  isAdversarial?: boolean | null;
  difficultyTier?: memStore.TruthDifficultyTier | null;
  highImpact?: boolean | null;
  highImpactReason?: string | null;
  holdoutVersion?: string | null;
  inferabilityByField?: Record<string, memStore.TruthInferabilityTier> | null;
  goldKind?: memStore.TruthGoldKind | null;
  adversarialPair?: string | null;
  noiseProfile?: string[] | null;
  approvalSource?: memStore.TruthApprovalSource | null;
  reviewedBy?: string | null;
  notes?: string | null;
}): Promise<memStore.StoredApprovedTruth> {
  const nextInputHash = (await import('../training/truthHash.js')).hashInputForTruth(input.rawText);
  const previousById = input.id ? await getApprovedTruth(input.id) : null;
  const previousByHash = await getApprovedTruthByInputHash(nextInputHash);
  const staleTargetBefore =
    previousById && previousById.inputHash === nextInputHash
      ? previousById
      : previousByHash ?? previousById;
  const normalizedExpectedFields = normalizeExpectedTruthFields(input.expectedFields);
  const normalizedCoreTruth = input.coreTruth
    ? normalizeExpectedTruthFields(input.coreTruth)
    : normalizedExpectedFields;
  const normalizedOverlayTruth = input.overlayTruth
    ? normalizeExpectedTruthFields(input.overlayTruth)
    : null;

  if (useDb) {
    const row = await truthDb.upsertApprovedTruthDb({
      ...input,
      expectedFields: normalizedExpectedFields,
      coreTruth: normalizedCoreTruth,
      overlayTruth: normalizedOverlayTruth,
    });
    if (staleTargetBefore) {
      const beforeFingerprint = buildTruthRenderVariantFingerprint({
        expectedFields: staleTargetBefore.expectedFields,
        coreTruth: staleTargetBefore.coreTruth ?? null,
        expectedType: staleTargetBefore.expectedType ?? null,
      });
      const afterFingerprint = buildTruthRenderVariantFingerprint({
        expectedFields: normalizedExpectedFields,
        coreTruth: normalizedCoreTruth,
        expectedType: input.expectedType ?? staleTargetBefore.expectedType ?? null,
      });
      if (beforeFingerprint !== afterFingerprint) {
        await markApprovedTruthRenderVariantsStale(row.id);
      }
    }
    bumpApprovedTruthRevision();
    return row;
  }
  const now = new Date().toISOString();
  const { randomUUID } = await import('node:crypto');
  const inputHash = nextInputHash;
  if (input.id) {
    const cur = memStore.getApprovedTruth(input.id);
    if (cur) {
      const row: memStore.StoredApprovedTruth = {
        ...cur,
        inputHash,
        rawText: input.rawText,
        expectedFields: normalizedExpectedFields,
        coreTruth: normalizedCoreTruth,
        overlayTruth: normalizedOverlayTruth,
        expectedType: input.expectedType ?? null,
        expectedStyle: input.expectedStyle ?? null,
        provenance: input.provenance ?? null,
        pipelineMajor: input.pipelineMajor ?? null,
        datasetSplit: input.datasetSplit ?? null,
        trustLevel: input.trustLevel ?? cur.trustLevel,
        rowStatus: input.rowStatus ?? cur.rowStatus ?? legacyTrustToRowStatus(input.trustLevel ?? cur.trustLevel),
        blockedReason: input.blockedReason ?? cur.blockedReason ?? null,
        taskCertifications: input.taskCertifications ?? cur.taskCertifications ?? null,
        workId: input.workId ?? cur.workId ?? null,
        familyId: input.familyId ?? cur.familyId ?? null,
        variantId: input.variantId ?? cur.variantId ?? null,
        canonicalWorkKey: input.canonicalWorkKey ?? cur.canonicalWorkKey ?? null,
        nearDupClusterId: input.nearDupClusterId ?? cur.nearDupClusterId ?? null,
        datasetVersion: input.datasetVersion ?? cur.datasetVersion ?? null,
        inputProfile: input.inputProfile ?? cur.inputProfile ?? null,
        styleInferabilityTier: input.styleInferabilityTier ?? cur.styleInferabilityTier ?? null,
        styleEvaluationSuite: input.styleEvaluationSuite ?? cur.styleEvaluationSuite ?? null,
        isAdversarial: input.isAdversarial ?? cur.isAdversarial ?? null,
        difficultyTier: input.difficultyTier ?? cur.difficultyTier ?? null,
        highImpact: input.highImpact ?? cur.highImpact ?? null,
        highImpactReason: input.highImpactReason ?? cur.highImpactReason ?? null,
        holdoutVersion: input.holdoutVersion ?? cur.holdoutVersion ?? null,
        inferabilityByField: input.inferabilityByField ?? cur.inferabilityByField ?? null,
        goldKind: input.goldKind ?? cur.goldKind ?? null,
        adversarialPair: input.adversarialPair ?? cur.adversarialPair ?? null,
        noiseProfile: input.noiseProfile ?? cur.noiseProfile ?? null,
        approvalSource: input.approvalSource ?? cur.approvalSource ?? null,
        reviewedBy: input.reviewedBy ?? null,
        reviewedAt: input.reviewedBy ? now : (cur.reviewedAt ?? null),
        notes: input.notes ?? null,
        updatedAt: now,
      };
      const saved = memStore.upsertApprovedTruth(row);
      if (staleTargetBefore) {
        const beforeFingerprint = buildTruthRenderVariantFingerprint({
          expectedFields: staleTargetBefore.expectedFields,
          coreTruth: staleTargetBefore.coreTruth ?? null,
          expectedType: staleTargetBefore.expectedType ?? null,
        });
        const afterFingerprint = buildTruthRenderVariantFingerprint({
          expectedFields: normalizedExpectedFields,
          coreTruth: normalizedCoreTruth,
          expectedType: input.expectedType ?? cur.expectedType ?? null,
        });
        if (beforeFingerprint !== afterFingerprint) {
          memStore.markApprovedTruthRenderVariantsStale(saved.id);
        }
      }
      bumpApprovedTruthRevision();
      return saved;
    }
  }
  let id = input.id ?? randomUUID();
  for (const r of memStore.listApprovedTruth()) {
    if (r.inputHash === inputHash) {
      id = r.id;
      break;
    }
  }
  const row: memStore.StoredApprovedTruth = {
    id,
    inputHash,
    rawText: input.rawText,
    expectedFields: normalizedExpectedFields,
    coreTruth: normalizedCoreTruth,
    overlayTruth: normalizedOverlayTruth,
    expectedType: input.expectedType ?? null,
    expectedStyle: input.expectedStyle ?? null,
    provenance: input.provenance ?? null,
    pipelineMajor: input.pipelineMajor ?? null,
    datasetSplit: input.datasetSplit ?? null,
    trustLevel: input.trustLevel ?? 'draft',
    rowStatus: input.rowStatus ?? legacyTrustToRowStatus(input.trustLevel ?? 'draft'),
    blockedReason: input.blockedReason ?? null,
    taskCertifications: input.taskCertifications ?? null,
    workId: input.workId ?? null,
    familyId: input.familyId ?? null,
    variantId: input.variantId ?? null,
    canonicalWorkKey: input.canonicalWorkKey ?? null,
    nearDupClusterId: input.nearDupClusterId ?? null,
    datasetVersion: input.datasetVersion ?? null,
    inputProfile: input.inputProfile ?? null,
    styleInferabilityTier: input.styleInferabilityTier ?? null,
    styleEvaluationSuite: input.styleEvaluationSuite ?? null,
    isAdversarial: input.isAdversarial ?? null,
    difficultyTier: input.difficultyTier ?? null,
    highImpact: input.highImpact ?? null,
    highImpactReason: input.highImpactReason ?? null,
    holdoutVersion: input.holdoutVersion ?? null,
    inferabilityByField: input.inferabilityByField ?? null,
    goldKind: input.goldKind ?? null,
    adversarialPair: input.adversarialPair ?? null,
    noiseProfile: input.noiseProfile ?? null,
    approvalSource: input.approvalSource ?? null,
    reviewedBy: input.reviewedBy ?? null,
    reviewedAt: input.reviewedBy ? now : null,
    notes: input.notes ?? null,
    createdAt: memStore.getApprovedTruth(id)?.createdAt ?? now,
    updatedAt: now,
  };
  const saved = memStore.upsertApprovedTruth(row);
  if (staleTargetBefore) {
    const beforeFingerprint = buildTruthRenderVariantFingerprint({
      expectedFields: staleTargetBefore.expectedFields,
      coreTruth: staleTargetBefore.coreTruth ?? null,
      expectedType: staleTargetBefore.expectedType ?? null,
    });
    const afterFingerprint = buildTruthRenderVariantFingerprint({
      expectedFields: normalizedExpectedFields,
      coreTruth: normalizedCoreTruth,
      expectedType: input.expectedType ?? null,
    });
    if (beforeFingerprint !== afterFingerprint) {
      memStore.markApprovedTruthRenderVariantsStale(saved.id);
    }
  }
  bumpApprovedTruthRevision();
  return saved;
}

export async function deleteApprovedTruth(id: string): Promise<boolean> {
  if (useDb) {
    const deleted = await truthDb.deleteApprovedTruthDb(id);
    if (deleted) {
      bumpApprovedTruthRevision();
    }
    return deleted;
  }
  const deleted = memStore.deleteApprovedTruth(id);
  if (deleted) {
    bumpApprovedTruthRevision();
  }
  return deleted;
}

export async function getApprovedTruthEditorDraft(
  userId: string,
): Promise<memStore.StoredApprovedTruthEditorDraft | null> {
  if (useDb) {
    return editorDraftDb.getApprovedTruthEditorDraftDb(userId);
  }
  return Promise.resolve(memStore.getApprovedTruthEditorDraft(userId) ?? null);
}

export async function upsertApprovedTruthEditorDraft(input: {
  userId: string;
  payload: memStore.ApprovedTruthEditorDraftPayload;
}): Promise<memStore.StoredApprovedTruthEditorDraft> {
  if (useDb) {
    return editorDraftDb.upsertApprovedTruthEditorDraftDb(input);
  }
  const now = new Date().toISOString();
  const existing = memStore.getApprovedTruthEditorDraft(input.userId);
  return Promise.resolve(
    memStore.upsertApprovedTruthEditorDraft({
      id: existing?.id ?? `${input.userId}:approved-truth-editor`,
      userId: input.userId,
      payload: input.payload,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }),
  );
}

export async function deleteApprovedTruthEditorDraft(userId: string): Promise<boolean> {
  if (useDb) {
    return editorDraftDb.deleteApprovedTruthEditorDraftDb(userId);
  }
  return Promise.resolve(memStore.deleteApprovedTruthEditorDraft(userId));
}

export async function promoteLearningQueueRow(
  queueId: string,
  truth: {
    id?: string;
    rawText: string;
    expectedFields: Record<string, unknown>;
    coreTruth?: Record<string, unknown> | null;
    overlayTruth?: Record<string, unknown> | null;
    expectedType?: string | null;
    expectedStyle?: string | null;
    datasetSplit?: memStore.TruthDatasetSplit | null;
    trustLevel?: memStore.TruthTrustLevel;
    rowStatus?: memStore.TruthRowStatus;
    blockedReason?: memStore.TruthBlockedReason | null;
    taskCertifications?: memStore.TruthTaskCertification[] | null;
    workId?: string | null;
    familyId?: string | null;
    variantId?: string | null;
    canonicalWorkKey?: string | null;
    nearDupClusterId?: string | null;
    datasetVersion?: string | null;
    inputProfile?: memStore.TruthInputProfile | null;
    styleInferabilityTier?: memStore.TruthStyleInferabilityTier | null;
    styleEvaluationSuite?: memStore.TruthStyleEvaluationSuite | null;
    isAdversarial?: boolean | null;
    difficultyTier?: memStore.TruthDifficultyTier | null;
    highImpact?: boolean | null;
    highImpactReason?: string | null;
    holdoutVersion?: string | null;
    inferabilityByField?: Record<string, memStore.TruthInferabilityTier> | null;
    goldKind?: memStore.TruthGoldKind | null;
    adversarialPair?: string | null;
    noiseProfile?: string[] | null;
    approvalSource?: memStore.TruthApprovalSource | null;
    reviewedBy?: string | null;
    notes?: string | null;
    provenance?: string | null;
  },
): Promise<{ truth: memStore.StoredApprovedTruth } | null> {
  const {
    id,
    rawText,
    expectedFields,
    coreTruth,
    overlayTruth,
    ...rest
  } = truth;
  const normalizedTruth: Parameters<typeof memStore.promoteLearningQueueRowMem>[1] = {
    ...rest,
    ...(id ? { id } : {}),
    rawText,
    expectedFields: normalizeExpectedTruthFields(expectedFields),
    coreTruth: coreTruth
      ? normalizeExpectedTruthFields(coreTruth)
      : normalizeExpectedTruthFields(expectedFields),
    overlayTruth: overlayTruth ? normalizeExpectedTruthFields(overlayTruth) : null,
  };

  if (useDb) {
    const promoted = await truthDb.promoteLearningQueueRowDb(queueId, normalizedTruth);
    if (promoted) {
      bumpApprovedTruthRevision();
    }
    return promoted;
  }
  const promoted = memStore.promoteLearningQueueRowMem(queueId, normalizedTruth);
  if (promoted) {
    bumpApprovedTruthRevision();
  }
  return Promise.resolve(promoted);
}


/* ------------------------------------------------------------------ */
/*  Reset                                                              */
/* ------------------------------------------------------------------ */

export async function resetRuntimeStore(): Promise<void> {
  if (useDb) {
    await dbStore.resetRuntimeStore();
  } else {
    await memStore.resetRuntimeStore();
  }
  bumpApprovedTruthRevision();
  resetReportIpLimiter();
}

/* ------------------------------------------------------------------ */
/*  Egress telemetry                                                   */
/* ------------------------------------------------------------------ */

export const recordEgressEvent = useDb
  ? dbStore.recordEgressEvent
  : async (event: memStore.StoredEgressEvent): Promise<void> => {
    memStore.recordEgressEvent(event);
  };

export const rollupEgressDaily = useDb
  ? dbStore.rollupEgressDaily
  : async (delta: memStore.StoredEgressRollup): Promise<void> => {
    memStore.rollupEgressDaily(delta);
  };

export const rollupEgressMonthly = useDb
  ? dbStore.rollupEgressMonthly
  : async (delta: memStore.StoredEgressRollup): Promise<void> => {
    memStore.rollupEgressMonthly(delta);
  };

export const listEgressDaily = useDb
  ? dbStore.listEgressDaily
  : async (period: string): Promise<memStore.StoredEgressRollup[]> =>
    memStore.listEgressDaily(period);

export const listEgressMonthly = useDb
  ? dbStore.listEgressMonthly
  : async (period: string): Promise<memStore.StoredEgressRollup[]> =>
    memStore.listEgressMonthly(period);
