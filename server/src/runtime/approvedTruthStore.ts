/**
 * Approved-truth persistence (Postgres). Used by admin routes and training export.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";
import {
  approvedTruth as approvedTruthTable,
  approvedTruthRenderVariants as approvedTruthRenderVariantsTable,
  activeLearningQueue as activeLearningQueueTable,
} from "../db/schema.js";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type {
  StoredApprovedTruth,
  StoredApprovedTruthRenderVariant,
  TruthApprovalSource,
  TruthBlockedReason,
  TruthDatasetSplit,
  TruthDifficultyTier,
  TruthGoldKind,
  TruthInferabilityTier,
  TruthInputProfile,
  TruthRenderVariantStyle,
  TruthRowStatus,
  TruthStyleEvaluationSuite,
  TruthStyleInferabilityTier,
  TruthTaskCertification,
  TruthTrustLevel,
} from "./store.js";
import { hashInputForTruth } from "../training/truthHash.js";
import type { TruthFieldValue } from "../training/truthFields.js";

function legacyTrustToRowStatus(trustLevel: TruthTrustLevel | null | undefined): TruthRowStatus {
  if (trustLevel === 'gold') return 'reviewed';
  if (trustLevel === 'reviewed') return 'reviewed';
  return 'draft';
}

function rowToStored(row: typeof approvedTruthTable.$inferSelect): StoredApprovedTruth {
  return {
    id: row.id,
    inputHash: row.inputHash,
    rawText: row.rawText,
    expectedFields: (row.expectedFields ?? {}) as Record<string, TruthFieldValue>,
    expectedType: row.expectedType ?? null,
    expectedStyle: row.expectedStyle ?? null,
    provenance: row.provenance ?? null,
    pipelineMajor: row.pipelineMajor ?? null,
    datasetSplit: (row.datasetSplit as TruthDatasetSplit | null) ?? null,
    trustLevel: (row.trustLevel as TruthTrustLevel) ?? "draft",
    rowStatus: (row.rowStatus as TruthRowStatus | null) ?? legacyTrustToRowStatus((row.trustLevel as TruthTrustLevel | null) ?? null),
    blockedReason: (row.blockedReason as TruthBlockedReason | null) ?? null,
    coreTruth: (row.coreTruth as Record<string, TruthFieldValue> | null) ?? (row.expectedFields as Record<string, TruthFieldValue>),
    overlayTruth: (row.overlayTruth as Record<string, TruthFieldValue> | null) ?? null,
    taskCertifications: (row.taskCertifications as TruthTaskCertification[] | null) ?? null,
    workId: row.workId ?? null,
    familyId: row.familyId ?? null,
    variantId: row.variantId ?? null,
    canonicalWorkKey: row.canonicalWorkKey ?? null,
    nearDupClusterId: row.nearDupClusterId ?? null,
    datasetVersion: row.datasetVersion ?? null,
    inputProfile: (row.inputProfile as TruthInputProfile | null) ?? null,
    styleInferabilityTier: (row.styleInferabilityTier as TruthStyleInferabilityTier | null) ?? null,
    styleEvaluationSuite: (row.styleEvaluationSuite as TruthStyleEvaluationSuite | null) ?? null,
    isAdversarial: row.isAdversarial ?? null,
    difficultyTier: (row.difficultyTier as TruthDifficultyTier | null) ?? null,
    highImpact: row.highImpact ?? null,
    highImpactReason: row.highImpactReason ?? null,
    holdoutVersion: row.holdoutVersion ?? null,
    inferabilityByField: (row.inferabilityByField as Record<string, TruthInferabilityTier> | null) ?? null,
    goldKind: (row.goldKind as TruthGoldKind | null) ?? null,
    adversarialPair: row.adversarialPair ?? null,
    noiseProfile: Array.isArray(row.noiseProfile) ? row.noiseProfile.map((value) => String(value)) : null,
    approvalSource: (row.approvalSource as TruthApprovalSource | null) ?? null,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

function rowToStoredRenderVariant(
  row: typeof approvedTruthRenderVariantsTable.$inferSelect,
): StoredApprovedTruthRenderVariant {
  return {
    id: row.id,
    truthRowId: row.truthRowId,
    style: row.style as TruthRenderVariantStyle,
    generatedText: row.generatedText,
    renderedText: row.renderedText,
    sourceKind: row.sourceKind as StoredApprovedTruthRenderVariant['sourceKind'],
    approvalStatus: row.approvalStatus as StoredApprovedTruthRenderVariant['approvalStatus'],
    qualityTier: row.qualityTier as StoredApprovedTruthRenderVariant['qualityTier'],
    datasetLane: row.datasetLane as StoredApprovedTruthRenderVariant['datasetLane'],
    rendererVersion: row.rendererVersion,
    stale: row.stale ?? false,
    generatedAt: row.generatedAt?.toISOString() ?? new Date().toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedBy: row.approvedBy ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function listApprovedTruthDb(filters?: {
  trustLevel?: TruthTrustLevel;
  rowStatus?: TruthRowStatus;
  datasetSplit?: TruthDatasetSplit;
  datasetVersion?: string;
  limit?: number;
}): Promise<StoredApprovedTruth[]> {
  const lim = Math.min(filters?.limit ?? 500, 50_000);
  const conditions = [];
  if (filters?.trustLevel) conditions.push(eq(approvedTruthTable.trustLevel, filters.trustLevel));
  if (filters?.rowStatus) conditions.push(eq(approvedTruthTable.rowStatus, filters.rowStatus));
  if (filters?.datasetSplit) conditions.push(eq(approvedTruthTable.datasetSplit, filters.datasetSplit));
  if (filters?.datasetVersion) conditions.push(eq(approvedTruthTable.datasetVersion, filters.datasetVersion));
  const base = db.select().from(approvedTruthTable).orderBy(desc(approvedTruthTable.updatedAt)).limit(lim);
  const rows = conditions.length ? await base.where(and(...conditions)) : await base;
  return rows.map(rowToStored);
}

export async function getApprovedTruthDb(id: string): Promise<StoredApprovedTruth | null> {
  const [row] = await db.select().from(approvedTruthTable).where(eq(approvedTruthTable.id, id)).limit(1);
  return row ? rowToStored(row) : null;
}

export async function getApprovedTruthByInputHashDb(
  inputHash: string,
): Promise<StoredApprovedTruth | null> {
  const [row] = await db
    .select()
    .from(approvedTruthTable)
    .where(eq(approvedTruthTable.inputHash, inputHash))
    .limit(1);
  return row ? rowToStored(row) : null;
}

export async function deleteApprovedTruthDb(id: string): Promise<boolean> {
  const res = await db.delete(approvedTruthTable).where(eq(approvedTruthTable.id, id)).returning({ id: approvedTruthTable.id });
  return res.length > 0;
}

export async function listApprovedTruthRenderVariantsDb(
  truthRowId: string,
): Promise<StoredApprovedTruthRenderVariant[]> {
  const rows = await db
    .select()
    .from(approvedTruthRenderVariantsTable)
    .where(eq(approvedTruthRenderVariantsTable.truthRowId, truthRowId))
    .orderBy(asc(approvedTruthRenderVariantsTable.style), asc(approvedTruthRenderVariantsTable.createdAt));
  return rows.map(rowToStoredRenderVariant);
}

export async function getApprovedTruthRenderVariantDb(
  truthRowId: string,
  style: TruthRenderVariantStyle,
): Promise<StoredApprovedTruthRenderVariant | null> {
  const [row] = await db
    .select()
    .from(approvedTruthRenderVariantsTable)
    .where(
      and(
        eq(approvedTruthRenderVariantsTable.truthRowId, truthRowId),
        eq(approvedTruthRenderVariantsTable.style, style),
      ),
    )
    .limit(1);
  return row ? rowToStoredRenderVariant(row) : null;
}

export async function upsertApprovedTruthRenderVariantDb(input: {
  id?: string;
  truthRowId: string;
  style: TruthRenderVariantStyle;
  generatedText: string;
  renderedText: string;
  sourceKind: StoredApprovedTruthRenderVariant['sourceKind'];
  approvalStatus: StoredApprovedTruthRenderVariant['approvalStatus'];
  qualityTier: StoredApprovedTruthRenderVariant['qualityTier'];
  datasetLane: StoredApprovedTruthRenderVariant['datasetLane'];
  rendererVersion: string;
  stale?: boolean;
  generatedAt?: string | Date | null;
  approvedAt?: string | Date | null;
  approvedBy?: string | null;
  notes?: string | null;
}): Promise<StoredApprovedTruthRenderVariant> {
  const now = new Date();
  const existing = await getApprovedTruthRenderVariantDb(input.truthRowId, input.style);
  const id = existing?.id ?? input.id ?? randomUUID();
  const generatedAt = input.generatedAt ? new Date(input.generatedAt) : existing ? new Date(existing.generatedAt) : now;
  const approvedAt = input.approvedAt ? new Date(input.approvedAt) : null;

  if (existing) {
    await db
      .update(approvedTruthRenderVariantsTable)
      .set({
        truthRowId: input.truthRowId,
        style: input.style,
        generatedText: input.generatedText,
        renderedText: input.renderedText,
        sourceKind: input.sourceKind,
        approvalStatus: input.approvalStatus,
        qualityTier: input.qualityTier,
        datasetLane: input.datasetLane,
        rendererVersion: input.rendererVersion,
        stale: input.stale ?? existing.stale,
        generatedAt,
        approvedAt,
        approvedBy: input.approvedBy ?? null,
        notes: input.notes ?? null,
        updatedAt: now,
      })
      .where(eq(approvedTruthRenderVariantsTable.id, existing.id));
    const updated = await getApprovedTruthRenderVariantDb(input.truthRowId, input.style);
    if (!updated) {
      throw new Error('approved_truth_render_variants update failed');
    }
    return updated;
  }

  await db.insert(approvedTruthRenderVariantsTable).values({
    id,
    truthRowId: input.truthRowId,
    style: input.style,
    generatedText: input.generatedText,
    renderedText: input.renderedText,
    sourceKind: input.sourceKind,
    approvalStatus: input.approvalStatus,
    qualityTier: input.qualityTier,
    datasetLane: input.datasetLane,
    rendererVersion: input.rendererVersion,
    stale: input.stale ?? false,
    generatedAt,
    approvedAt,
    approvedBy: input.approvedBy ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getApprovedTruthRenderVariantDb(input.truthRowId, input.style);
  if (!created) {
    throw new Error('approved_truth_render_variants insert failed');
  }
  return created;
}

export async function markApprovedTruthRenderVariantsStaleDb(
  truthRowId: string,
): Promise<number> {
  const result = await db
    .update(approvedTruthRenderVariantsTable)
    .set({
      stale: true,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(approvedTruthRenderVariantsTable.truthRowId, truthRowId),
        eq(approvedTruthRenderVariantsTable.stale, false),
      ),
    )
    .returning({ id: approvedTruthRenderVariantsTable.id });
  return result.length;
}

export async function deleteApprovedTruthRenderVariantsForTruthRowDb(
  truthRowId: string,
): Promise<number> {
  const result = await db
    .delete(approvedTruthRenderVariantsTable)
    .where(eq(approvedTruthRenderVariantsTable.truthRowId, truthRowId))
    .returning({ id: approvedTruthRenderVariantsTable.id });
  return result.length;
}

export async function reassignApprovedTruthRenderVariantsDb(input: {
  fromTruthRowId: string;
  toTruthRowId: string;
}): Promise<number> {
  if (input.fromTruthRowId === input.toTruthRowId) {
    return 0;
  }

  const sourceVariants = await listApprovedTruthRenderVariantsDb(input.fromTruthRowId);
  if (sourceVariants.length === 0) {
    return 0;
  }

  let movedCount = 0;
  for (const variant of sourceVariants) {
    const existingTarget = await getApprovedTruthRenderVariantDb(input.toTruthRowId, variant.style);
    if (!existingTarget) {
      await upsertApprovedTruthRenderVariantDb({
        ...variant,
        truthRowId: input.toTruthRowId,
      });
      movedCount += 1;
    }
  }

  await deleteApprovedTruthRenderVariantsForTruthRowDb(input.fromTruthRowId);
  return movedCount;
}

export async function upsertApprovedTruthDb(input: {
  id?: string;
  rawText: string;
  expectedFields: Record<string, TruthFieldValue>;
  coreTruth?: Record<string, TruthFieldValue> | null;
  overlayTruth?: Record<string, TruthFieldValue> | null;
  expectedType?: string | null;
  expectedStyle?: string | null;
  provenance?: string | null;
  pipelineMajor?: number | null;
  datasetSplit?: TruthDatasetSplit | null;
  trustLevel?: TruthTrustLevel;
  rowStatus?: TruthRowStatus;
  blockedReason?: TruthBlockedReason | null;
  taskCertifications?: TruthTaskCertification[] | null;
  workId?: string | null;
  familyId?: string | null;
  variantId?: string | null;
  canonicalWorkKey?: string | null;
  nearDupClusterId?: string | null;
  datasetVersion?: string | null;
  inputProfile?: TruthInputProfile | null;
  styleInferabilityTier?: TruthStyleInferabilityTier | null;
  styleEvaluationSuite?: TruthStyleEvaluationSuite | null;
  isAdversarial?: boolean | null;
  difficultyTier?: TruthDifficultyTier | null;
  highImpact?: boolean | null;
  highImpactReason?: string | null;
  holdoutVersion?: string | null;
  inferabilityByField?: Record<string, TruthInferabilityTier> | null;
  goldKind?: TruthGoldKind | null;
  adversarialPair?: string | null;
  noiseProfile?: string[] | null;
  approvalSource?: TruthApprovalSource | null;
  reviewedBy?: string | null;
  notes?: string | null;
}): Promise<StoredApprovedTruth> {
  if (input.id) {
    const [byId] = await db
      .select()
      .from(approvedTruthTable)
      .where(eq(approvedTruthTable.id, input.id))
      .limit(1);
    if (byId) {
      const newHash = hashInputForTruth(input.rawText);
      const now = new Date();
      const trustLevel = input.trustLevel ?? "draft";
      const rowStatus = input.rowStatus ?? legacyTrustToRowStatus(trustLevel);
      const [byHash] = await db
        .select()
        .from(approvedTruthTable)
        .where(and(eq(approvedTruthTable.inputHash, newHash), ne(approvedTruthTable.id, input.id)))
        .limit(1);
      const targetId = byHash?.id ?? input.id;
      await db
        .update(approvedTruthTable)
        .set({
          inputHash: newHash,
          rawText: input.rawText,
          expectedFields: input.expectedFields,
          coreTruth: input.coreTruth ?? input.expectedFields,
          overlayTruth: input.overlayTruth ?? null,
          expectedType: input.expectedType ?? null,
          expectedStyle: input.expectedStyle ?? null,
          provenance: input.provenance ?? null,
          pipelineMajor: input.pipelineMajor ?? null,
          datasetSplit: input.datasetSplit ?? null,
          trustLevel,
          rowStatus,
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
          reviewedAt: input.reviewedBy ? now : byId.reviewedAt,
          notes: input.notes ?? null,
          updatedAt: now,
        })
        .where(eq(approvedTruthTable.id, targetId));
      if (byHash && byId.id !== byHash.id) {
        await reassignApprovedTruthRenderVariantsDb({
          fromTruthRowId: byId.id,
          toTruthRowId: byHash.id,
        });
        await db.delete(approvedTruthTable).where(eq(approvedTruthTable.id, byId.id));
      }
      const u = await getApprovedTruthDb(targetId);
      if (!u) throw new Error("approved_truth update by id failed");
      return u;
    }
  }

  const inputHash = hashInputForTruth(input.rawText);
  const now = new Date();
  const trustLevel = input.trustLevel ?? "draft";
  const rowStatus = input.rowStatus ?? legacyTrustToRowStatus(trustLevel);
  const [existing] = await db
    .select()
    .from(approvedTruthTable)
    .where(eq(approvedTruthTable.inputHash, inputHash))
    .limit(1);

  if (existing) {
    await db
      .update(approvedTruthTable)
      .set({
        rawText: input.rawText,
        expectedFields: input.expectedFields,
        coreTruth: input.coreTruth ?? input.expectedFields,
        overlayTruth: input.overlayTruth ?? null,
        expectedType: input.expectedType ?? null,
        expectedStyle: input.expectedStyle ?? null,
        provenance: input.provenance ?? null,
        pipelineMajor: input.pipelineMajor ?? null,
        datasetSplit: input.datasetSplit ?? null,
        trustLevel,
        rowStatus,
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
        reviewedAt: input.reviewedBy ? now : existing.reviewedAt,
        notes: input.notes ?? null,
        updatedAt: now,
      })
      .where(eq(approvedTruthTable.id, existing.id));
    const u = await getApprovedTruthDb(existing.id);
    if (!u) throw new Error("approved_truth update read failed");
    return u;
  }

  const id = input.id ?? randomUUID();
  await db.insert(approvedTruthTable).values({
    id,
    inputHash,
    rawText: input.rawText,
    expectedFields: input.expectedFields,
    coreTruth: input.coreTruth ?? input.expectedFields,
    overlayTruth: input.overlayTruth ?? null,
    expectedType: input.expectedType ?? null,
    expectedStyle: input.expectedStyle ?? null,
    provenance: input.provenance ?? null,
    pipelineMajor: input.pipelineMajor ?? null,
    datasetSplit: input.datasetSplit ?? null,
    trustLevel,
    rowStatus,
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
    createdAt: now,
    updatedAt: now,
  });
  const created = await getApprovedTruthDb(id);
  if (!created) throw new Error("approved_truth insert read failed");
  return created;
}

export async function promoteLearningQueueRowDb(
  queueId: string,
  truth: {
    id?: string;
    rawText: string;
    expectedFields: Record<string, TruthFieldValue>;
    coreTruth?: Record<string, TruthFieldValue> | null;
    overlayTruth?: Record<string, TruthFieldValue> | null;
    expectedType?: string | null;
    expectedStyle?: string | null;
    datasetSplit?: TruthDatasetSplit | null;
    trustLevel?: TruthTrustLevel;
    rowStatus?: TruthRowStatus;
    blockedReason?: TruthBlockedReason | null;
    taskCertifications?: TruthTaskCertification[] | null;
    workId?: string | null;
    familyId?: string | null;
    variantId?: string | null;
    canonicalWorkKey?: string | null;
    nearDupClusterId?: string | null;
    datasetVersion?: string | null;
    inputProfile?: TruthInputProfile | null;
    styleInferabilityTier?: TruthStyleInferabilityTier | null;
    styleEvaluationSuite?: TruthStyleEvaluationSuite | null;
    isAdversarial?: boolean | null;
    difficultyTier?: TruthDifficultyTier | null;
    highImpact?: boolean | null;
    highImpactReason?: string | null;
    holdoutVersion?: string | null;
    inferabilityByField?: Record<string, TruthInferabilityTier> | null;
    goldKind?: TruthGoldKind | null;
    adversarialPair?: string | null;
    noiseProfile?: string[] | null;
    approvalSource?: TruthApprovalSource | null;
    reviewedBy?: string | null;
    notes?: string | null;
    provenance?: string | null;
  },
): Promise<{ truth: StoredApprovedTruth } | null> {
  const [row] = await db
    .select()
    .from(activeLearningQueueTable)
    .where(eq(activeLearningQueueTable.id, queueId))
    .limit(1);
  if (!row) return null;

  const stored = await upsertApprovedTruthDb({
    ...(truth.id ? { id: truth.id } : {}),
    rawText: truth.rawText,
    expectedFields: truth.expectedFields,
    coreTruth: truth.coreTruth ?? truth.expectedFields,
    overlayTruth: truth.overlayTruth ?? null,
    expectedType: truth.expectedType ?? null,
    expectedStyle: truth.expectedStyle ?? null,
    provenance: truth.provenance ?? "learning_queue",
    datasetSplit: truth.datasetSplit ?? null,
    trustLevel: truth.trustLevel ?? "reviewed",
    rowStatus: truth.rowStatus ?? legacyTrustToRowStatus(truth.trustLevel ?? 'reviewed'),
    blockedReason: truth.blockedReason ?? null,
    taskCertifications: truth.taskCertifications ?? null,
    workId: truth.workId ?? null,
    familyId: truth.familyId ?? null,
    variantId: truth.variantId ?? null,
    canonicalWorkKey: truth.canonicalWorkKey ?? null,
    nearDupClusterId: truth.nearDupClusterId ?? null,
    datasetVersion: truth.datasetVersion ?? null,
    inputProfile: truth.inputProfile ?? null,
    styleInferabilityTier: truth.styleInferabilityTier ?? null,
    styleEvaluationSuite: truth.styleEvaluationSuite ?? null,
    isAdversarial: truth.isAdversarial ?? null,
    difficultyTier: truth.difficultyTier ?? null,
    highImpact: truth.highImpact ?? null,
    highImpactReason: truth.highImpactReason ?? null,
    holdoutVersion: truth.holdoutVersion ?? null,
    inferabilityByField: truth.inferabilityByField ?? null,
    goldKind: truth.goldKind ?? null,
    adversarialPair: truth.adversarialPair ?? null,
    noiseProfile: truth.noiseProfile ?? null,
    approvalSource: truth.approvalSource ?? "learning_queue",
    reviewedBy: truth.reviewedBy ?? null,
    notes: truth.notes ?? null,
  });

  await db
    .update(activeLearningQueueTable)
    .set({
      processed: true,
      processedAt: new Date(),
      promotedToTruthId: stored.id,
    })
    .where(eq(activeLearningQueueTable.id, queueId));

  return { truth: stored };
}
