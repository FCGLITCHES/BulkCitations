import type { ReferenceCarrier } from '../types/carrier.js';
import { syncFieldUncertainty } from '../fieldConfidence.js';
import { rescoreCarrierAfterCorrection } from '../rescoring.js';
import { fieldOf } from '../types/field.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import {
  getApprovedTruthRevision,
  getCitation,
  listApprovedTruth,
  listCorrections,
  listLearningQueue,
} from '../../runtime/persistence.js';
import type { StoredApprovedTruth, TruthScope } from '../../runtime/store.js';
import type { TruthFieldValue } from '../../training/truthFields.js';
import { isExtractedFieldKey } from '../utils/fields.js';
import { parseAuthorSegment } from '../utils/authors.js';
import { hashInputForTruth } from '../../training/truthHash.js';
import { effectiveRowStatus, isTaskCertified, withLegacyCertification } from '../../training/truthCertification.js';
import { hashAdminTruthRawText } from '../../admin/adminTruthRawText.js';
import type { ReferenceType } from '../types/citation.js';
import { normalizeLearningQueueRawInputForGrouping } from '../../runtime/learningQueueGroups.js';

const CONTRACT_VERSION = 1;
const STAGE_ID = 'phase13_feedback_loop';
const CERTIFIED_APPROVED_TRUTH_CACHE_TTL_MS = 5 * 60 * 1000;

let certifiedApprovedTruthCache: {
  expiresAtMs: number;
  map: Map<string, CertifiedApprovedTruthMatch>;
  revision: number;
} | null = null;
let certifiedApprovedTruthInflight: {
  promise: Promise<Map<string, CertifiedApprovedTruthMatch>>;
  revision: number;
} | null = null;

export class Phase13FeedbackLoop implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'feedback_loop' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    let appliedCount = 0;

    // Load approved corrections from persistence
    const corrections = await listCorrections();
    const approved = corrections.filter((c) => c.status === 'approved');

    // Build lookup: citationId -> approved corrections
    const correctionMap = new Map<string, typeof approved>();
    for (const correction of approved) {
      const existing = correctionMap.get(correction.citationId) ?? [];
      existing.push(correction);
      correctionMap.set(correction.citationId, existing);
    }
    const consensusMap = await buildConsensusCorrections(approved);
    const approvedTruthMap = await buildCertifiedApprovedTruthMap();

    // Load active learning insights
    const learningQueue = await listLearningQueue();
    const processedInsights = learningQueue.filter((item) => item.processed);

    // Build lookup: raw text hash -> training data for pattern matching
    const insightPatterns = new Map<string, Record<string, unknown>>();
    for (const item of processedInsights) {
      if (item.trainingData?.rawTextHash && typeof item.trainingData.rawTextHash === 'string') {
        insightPatterns.set(item.trainingData.rawTextHash, item.trainingData);
      } else if (typeof item.trainingData?.rawInput === 'string') {
        insightPatterns.set(hashInputForTruth(item.trainingData.rawInput), item.trainingData);
      }
    }

    for (const carrier of carriers) {
      // Apply direct corrections if this citation has been corrected before
      const carrierCorrections = correctionMap.get(carrier.id);
      if (carrierCorrections && carrierCorrections.length > 0) {
        const changedFields = new Set<string>();
        for (const correction of carrierCorrections) {
          applyCorrection(carrier, correction.fieldName, correction.newValue);
          changedFields.add(correction.fieldName);
          appliedCount++;
        }
        await rescoreCarrierAfterCorrection(carrier, ctx, changedFields);

        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: 0,
            message: `Applied ${carrierCorrections.length} approved correction(s).`,
          }),
        );
        continue;
      }

      // Check if active learning has insights for similar references
      const rawHash = hashInputForTruth(carrier.raw);
      const approvedTruth = findCertifiedApprovedTruthForCarrier(approvedTruthMap, carrier);
      if (approvedTruth) {
        appliedCount += await applyCertifiedApprovedTruthToCarrier(carrier, approvedTruth, ctx);
        continue;
      }

      const insight = insightPatterns.get(rawHash);
      if (insight) {
        const changedFields = applyLearningInsight(carrier, insight);
        appliedCount += changedFields.size;
        await rescoreCarrierAfterCorrection(carrier, ctx, changedFields);

        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: 0,
            message: 'Applied active learning insight from training data.',
          }),
        );
        continue;
      }

      const consensus = consensusMap.get(normalizeCitationFingerprint(carrier.raw));
      if (consensus && consensus.length > 0) {
        const changedFields = new Set<string>();
        for (const entry of consensus) {
          applyCorrection(carrier, entry.fieldName, entry.newValue, 'user_consensus');
          changedFields.add(entry.fieldName);
          appliedCount += 1;
        }
        await rescoreCarrierAfterCorrection(carrier, ctx, changedFields);

        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: 0,
            message: `Applied ${consensus.length} consensus correction(s).`,
          }),
        );
        continue;
      }

      carrier.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: 'success',
          durationMs: 0,
          message: 'No feedback corrections applicable.',
        }),
      );
    }

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: appliedCount > 0 ? 'success' : 'success',
        durationMs: Date.now() - startedAt,
        message: appliedCount > 0
          ? `Phase 13 applied ${appliedCount} feedback correction(s).`
          : 'Phase 13 completed with no applicable feedback.',
      }),
    );

    return carriers;
  }
}

export const phase13FeedbackLoop = new Phase13FeedbackLoop();

export async function applyCertifiedApprovedTruthOverlays(
  carriers: ReferenceCarrier[],
  ctx: PipelineContext,
): Promise<number> {
  const approvedTruthMap = await buildCertifiedApprovedTruthMap();
  const groupedTruthLookupCache = new Map<string, CertifiedApprovedTruthMatch | null>();
  let appliedCount = 0;

  for (const carrier of carriers) {
    const approvedTruth = findCertifiedApprovedTruthForCarrier(
      approvedTruthMap,
      carrier,
      groupedTruthLookupCache,
    );
    if (!approvedTruth) {
      carrier.stageLog.push(
        stageRecord({
          phaseId: 'feedback_loop',
          status: 'success',
          durationMs: 0,
          message: 'No certified approved truth overlay applicable.',
        }),
      );
      continue;
    }

    appliedCount += await applyCertifiedApprovedTruthToCarrier(carrier, approvedTruth, ctx);
  }

  return appliedCount;
}

interface CertifiedApprovedTruthMatch {
  row: StoredApprovedTruth;
  truthScope: TruthScope;
}

async function buildCertifiedApprovedTruthMap(): Promise<Map<string, CertifiedApprovedTruthMatch>> {
  const revision = getApprovedTruthRevision();
  const now = Date.now();
  if (
    certifiedApprovedTruthCache
    && certifiedApprovedTruthCache.revision === revision
    && certifiedApprovedTruthCache.expiresAtMs > now
  ) {
    return certifiedApprovedTruthCache.map;
  }

  if (certifiedApprovedTruthInflight?.revision === revision) {
    return certifiedApprovedTruthInflight.promise;
  }

  const promise = loadCertifiedApprovedTruthMapFromStore().then((map) => {
    certifiedApprovedTruthCache = {
      expiresAtMs: Date.now() + CERTIFIED_APPROVED_TRUTH_CACHE_TTL_MS,
      map,
      revision,
    };
    return map;
  }).finally(() => {
    if (certifiedApprovedTruthInflight?.revision === revision) {
      certifiedApprovedTruthInflight = null;
    }
  });

  certifiedApprovedTruthInflight = { promise, revision };
  return promise;
}

export async function prewarmCertifiedApprovedTruthCache(): Promise<{
  entryCount: number;
  revision: number;
}> {
  const map = await buildCertifiedApprovedTruthMap();
  return {
    entryCount: map.size,
    revision: getApprovedTruthRevision(),
  };
}

async function loadCertifiedApprovedTruthMapFromStore(): Promise<Map<string, CertifiedApprovedTruthMatch>> {
  // Isolated runtime (benchmark/profiling scripts) bypasses DB-backed operational
  // reads — same policy as egress telemetry and the Phase 4 override row. This keeps
  // perf runs from loading the full approved_truth table and from holding the pg pool
  // open after the run (which otherwise leaves the process hanging on exit). Production
  // never sets BULKREFERENCES_ISOLATED_RUNTIME, so live overlay behavior is unchanged.
  if (process.env.BULKREFERENCES_ISOLATED_RUNTIME === 'true') {
    return new Map<string, CertifiedApprovedTruthMatch>();
  }

  const rows = await listApprovedTruth({ limit: 50_000 });
  const map = new Map<string, CertifiedApprovedTruthMatch>();

  for (const rawRow of rows) {
    const row = withLegacyCertification(rawRow);
    if (effectiveRowStatus(row) === 'quarantined') {
      continue;
    }

    const truthScope = certifiedTruthScope(row);
    if (!truthScope) {
      continue;
    }

    const keys = new Set([
      row.inputHash,
      hashInputForTruth(row.rawText),
      hashAdminTruthRawText(row.rawText),
    ]);
    const groupedKey = certifiedApprovedTruthGroupHash(row.rawText);
    if (groupedKey) {
      keys.add(groupedKey);
    }
    const match = { row, truthScope };
    for (const key of keys) {
      const existing = map.get(key);
      if (!existing || approvedTruthPrecedence(match) > approvedTruthPrecedence(existing)) {
        map.set(key, match);
      }
    }
  }

  return map;
}

function findCertifiedApprovedTruthForCarrier(
  approvedTruthMap: Map<string, CertifiedApprovedTruthMatch>,
  carrier: ReferenceCarrier,
  groupedTruthLookupCache?: Map<string, CertifiedApprovedTruthMatch | null>,
): CertifiedApprovedTruthMatch | null {
  const exactMatch = approvedTruthMap.get(hashInputForTruth(carrier.raw))
    ?? approvedTruthMap.get(hashAdminTruthRawText(carrier.raw))
    ?? null;
  if (exactMatch) {
    return exactMatch;
  }

  const groupLookupKey = normalizeCertifiedTruthLookupCacheKey(carrier.raw);
  const cachedGroupMatch = groupedTruthLookupCache?.get(groupLookupKey);
  if (cachedGroupMatch !== undefined) {
    return cachedGroupMatch;
  }

  const groupMatch = approvedTruthMap.get(certifiedApprovedTruthGroupHash(carrier.raw) ?? '') ?? null;
  groupedTruthLookupCache?.set(groupLookupKey, groupMatch);
  return groupMatch;
}

function certifiedApprovedTruthGroupHash(rawText: string): string | null {
  const normalized = normalizeLearningQueueRawInputForGrouping(rawText);
  return normalized ? hashInputForTruth(normalized) : null;
}

function normalizeCertifiedTruthLookupCacheKey(rawText: string): string {
  return rawText
    .normalize('NFKC')
    .replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

async function applyCertifiedApprovedTruthToCarrier(
  carrier: ReferenceCarrier,
  approvedTruth: CertifiedApprovedTruthMatch,
  ctx: PipelineContext,
): Promise<number> {
  const changedFields = applyCertifiedApprovedTruth(carrier, approvedTruth, ctx);
  await rescoreCarrierAfterCorrection(carrier, ctx, changedFields);
  applyCertifiedApprovedTruthRenderedOutput(carrier, approvedTruth, ctx);

  carrier.stageLog.push(
    stageRecord({
      phaseId: 'feedback_loop',
      status: 'success',
      durationMs: 0,
      message: 'Applied certified approved truth overlay.',
      details: {
        truthId: approvedTruth.row.id,
        truthScope: approvedTruth.truthScope,
      },
    }),
  );

  return Math.max(changedFields.size, 1);
}

function certifiedTruthScope(row: StoredApprovedTruth): TruthScope | null {
  if (
    row.overlayTruth
    && Object.keys(row.overlayTruth).length > 0
    && (
      isTaskCertified(row, 'overlay_learning', 'overlay')
      || isTaskCertified(row, 'field', 'overlay')
      || isTaskCertified(row, 'style', 'overlay')
      || isTaskCertified(row, 'authority_pack', 'overlay')
    )
  ) {
    return 'overlay';
  }

  if (
    isTaskCertified(row, 'field', 'core')
    || isTaskCertified(row, 'style', 'core')
    || isTaskCertified(row, 'authority_pack', 'core')
    || isTaskCertified(row, 'overlay_learning', 'core')
  ) {
    return 'core';
  }

  return null;
}

function approvedTruthPrecedence(match: CertifiedApprovedTruthMatch): number {
  const trustRank: Record<StoredApprovedTruth['trustLevel'], number> = {
    draft: 0,
    reviewed: 1,
    gold: 2,
  };
  const scopeRank = match.truthScope === 'overlay' ? 10 : 0;
  return scopeRank + trustRank[match.row.trustLevel];
}

function applyCertifiedApprovedTruth(
  carrier: ReferenceCarrier,
  match: CertifiedApprovedTruthMatch,
  ctx: PipelineContext,
): Set<string> {
  const scopedFields = truthFieldsForScope(match);
  const changedFields = new Set<string>();

  for (const [fieldName, value] of Object.entries(scopedFields)) {
    if (fieldName === 'corrected_output' || !isExtractedFieldKey(fieldName)) {
      continue;
    }
    applyCorrection(carrier, fieldName, truthFieldValueForCarrier(fieldName, value), 'admin');
    changedFields.add(fieldName);
  }

  const referenceType = normalizeApprovedTruthReferenceType(match.row.expectedType);
  if (referenceType) {
    carrier.type = {
      type: referenceType,
      confidence: 1,
      isUnknown: false,
    };
    carrier.structuralRouting = {
      type: referenceType,
      confidence: 1,
      source: 'approved_truth',
      reasonCodes: [`approved_truth_${match.truthScope}_certified_exact_raw_match`],
    };
  }

  if (
    match.row.expectedStyle
    && match.row.expectedStyle !== 'auto'
    && match.row.expectedStyle !== 'unknown'
    && (ctx.outputStyle === 'auto' || ctx.outputStyle === 'unknown')
  ) {
    carrier.style.primary.style = match.row.expectedStyle as typeof carrier.style.primary.style;
    carrier.style.primary.confidence = 1;
    carrier.style.styleConfidence = 1;
  }

  return changedFields;
}

function truthFieldsForScope(match: CertifiedApprovedTruthMatch): Record<string, TruthFieldValue> {
  return match.truthScope === 'overlay'
    ? match.row.overlayTruth ?? {}
    : match.row.coreTruth ?? match.row.expectedFields;
}

function truthFieldValueForCarrier(fieldName: string, value: TruthFieldValue): unknown {
  if (fieldName === 'authors' || fieldName === 'editors') {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => typeof entry === 'string' ? parseAuthorSegment(entry) : []);
    }
    if (typeof value === 'string') {
      return parseAuthorSegment(value);
    }
  }
  return value;
}

function applyCertifiedApprovedTruthRenderedOutput(
  carrier: ReferenceCarrier,
  match: CertifiedApprovedTruthMatch,
  ctx: PipelineContext,
): void {
  const scopedFields = truthFieldsForScope(match);
  const correctedOutput = firstString(scopedFields.corrected_output) ?? firstString(scopedFields.formatted_string);
  if (!correctedOutput) {
    return;
  }

  const expectedStyle = match.row.expectedStyle?.trim();
  const outputStyle = ctx.outputStyle;
  if (
    expectedStyle
    && expectedStyle !== 'auto'
    && expectedStyle !== 'unknown'
    && outputStyle !== 'auto'
    && outputStyle !== 'unknown'
    && expectedStyle !== outputStyle
  ) {
    return;
  }

  carrier.rendered.text = correctedOutput;
  carrier.rendered.warnings = carrier.rendered.warnings.filter((warning) => warning !== 'render_empty');
}

function firstString(value: TruthFieldValue | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry.trim();
      }
    }
  }
  return null;
}

function normalizeApprovedTruthReferenceType(value: string | null | undefined): ReferenceType | null {
  switch (value) {
    case 'article-journal':
    case 'book':
    case 'book-chapter':
    case 'thesis':
    case 'conference-paper':
    case 'webpage':
    case 'report':
    case 'patent':
    case 'preprint':
      return value;
    default:
      return null;
  }
}

function applyCorrection(
  carrier: ReferenceCarrier,
  fieldName: string,
  newValue: unknown,
  mode: 'admin' | 'user_consensus' | 'heuristic' = 'admin',
): void {
  const fields = carrier.fields as unknown as Record<
    string,
    { value: unknown; source: string; stageId: string; confidence: number; uncertain: boolean }
  >;
  const field = fields[fieldName];
  if (!field || !isExtractedFieldKey(fieldName)) return;

  fields[fieldName] = fieldOf(
    newValue,
    mode === 'admin' ? 'admin_confirmed' : 'user_correction',
    STAGE_ID,
    mode === 'heuristic' ? 0.82 : 1,
    {
      origin: mode === 'heuristic' ? 'heuristic' : mode,
      uncertain: mode === 'heuristic',
      previousValue: field.value,
      previousSource: field.source as never,
      previousOrigin: (field as { origin?: unknown }).origin as never,
    },
  );
  syncFieldUncertainty(carrier.fields);
}

function applyLearningInsight(
  carrier: ReferenceCarrier,
  insight: Record<string, unknown>,
): Set<string> {
  const changedFields = new Set<string>();
  const corrections = normalizeLearningCorrections(insight);
  if (!corrections) return changedFields;

  for (const [fieldName, value] of Object.entries(corrections)) {
    if (value !== undefined && value !== null) {
      applyCorrection(carrier, fieldName, value, 'heuristic');
      changedFields.add(fieldName);
    }
  }

  return changedFields;
}

function normalizeLearningCorrections(insight: Record<string, unknown>): Record<string, unknown> | null {
  if (insight.corrections && typeof insight.corrections === 'object' && !Array.isArray(insight.corrections)) {
    return insight.corrections as Record<string, unknown>;
  }
  if (typeof insight.fieldName === 'string' && isExtractedFieldKey(insight.fieldName) && insight.newValue !== undefined) {
    return { [insight.fieldName]: insight.newValue };
  }
  return null;
}

async function buildConsensusCorrections(
  approved: Array<{ id: string; jobId: string; citationId: string; fieldName: string; newValue: unknown }>,
): Promise<Map<string, Array<{ fieldName: string; newValue: unknown }>>> {
  const groups = new Map<string, {
    fingerprint: string;
    fieldName: string;
    newValue: unknown;
    correctionIds: Set<string>;
    userIds: Set<string>;
  }>();

  for (const correction of approved) {
    const citation = await getCitation(correction.jobId, correction.citationId);
    if (!citation) continue;

    const fingerprint = normalizeCitationFingerprint(citation.raw);
    const valueKey = normalizeConsensusValue(correction.newValue);
    const groupKey = `${fingerprint}|${correction.fieldName}|${valueKey}`;
    const existing = groups.get(groupKey) ?? {
      fingerprint,
      fieldName: correction.fieldName,
      newValue: correction.newValue,
      correctionIds: new Set<string>(),
      userIds: new Set<string>(),
    };

    existing.correctionIds.add(correction.id);
    const userId = (correction as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.trim()) {
      existing.userIds.add(userId.trim());
    }

    groups.set(groupKey, existing);
  }

  const consensus = new Map<string, Array<{ fieldName: string; newValue: unknown }>>();
  for (const entry of groups.values()) {
    const hasRequiredApprovals = entry.correctionIds.size >= 3;
    const hasRequiredUsers = entry.userIds.size === 0 || entry.userIds.size >= 2;
    if (!hasRequiredApprovals || !hasRequiredUsers) continue;

    const current = consensus.get(entry.fingerprint) ?? [];
    current.push({ fieldName: entry.fieldName, newValue: entry.newValue });
    consensus.set(entry.fingerprint, current);
  }

  return consensus;
}

function normalizeCitationFingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeConsensusValue(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLowerCase();
  return JSON.stringify(value);
}

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
): StageRunRecord {
  return {
    stageId: STAGE_ID,
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}
