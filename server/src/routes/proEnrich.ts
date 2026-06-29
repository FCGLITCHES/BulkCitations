import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enqueueBatchHealthSummaryRebuild } from '../admin/batchHealthSummary.js';
import { env } from '../config.js';
import { AppError, ErrorCode } from '../engine/errors/index.js';
import { phase10Health } from '../engine/phases/phase10Health.js';
import { phase12Render } from '../engine/phases/phase12Render.js';
import {
  applyCarrierToProcessedCitation,
  hydrateCarrierFromProcessedCitation,
  rescoreCarrierAfterCorrection,
} from '../engine/rescoring.js';
import type { CitationStyle, ExtractedFields, ProcessedCitation } from '../engine/types/citation.js';
import { fieldOf } from '../engine/types/field.js';
import { buildReferenceCarrier } from '../engine/utils/carriers.js';
import type { ProviderRecord } from '../services/crossref.js';
import { crossrefService } from '../services/crossref.js';
import { openAlexService } from '../services/openalex.js';
import { semanticScholarService } from '../services/semanticScholar.js';
import {
  appendCitationVersion,
  appendJobEvent,
  getCitation,
  getJob,
  listCitationVersions,
  saveLearningQueueItem,
  upsertApprovedTruthPayload,
  updateCitation,
} from '../runtime/persistence.js';
import { assertJobAccess } from '../runtime/jobAccess.js';
import {
  cloneExtractedFields,
  EXTRACTED_FIELD_KEYS,
  isExtractedFieldKey,
  setExtractedField,
} from '../engine/utils/fields.js';
import { createPipelineContext } from '../pipeline/orchestrator.js';

const proposalSchema = z.object({
  referenceIds: z.array(z.string().min(1)).max(250).optional(),
});

const previewSchema = z.object({
  citationId: z.string().min(1),
  fields: z.record(z.unknown()).refine(
    (fields) => Object.keys(fields).length > 0,
    'Select at least one Pro field before requesting a corrected preview.',
  ),
});

const acceptSchema = z.object({
  overlays: z.array(
    z.object({
      citationId: z.string().min(1),
      fields: z.record(z.unknown()),
      reviewedBy: z.string().max(120).optional(),
      optInTraining: z.boolean().optional(),
    }),
  ).min(1),
});

const applySchema = z.object({
  overlays: z.array(
    z.object({
      citationId: z.string().min(1),
      fields: z.record(z.unknown()).default({}),
      reviewedBy: z.string().max(120).optional(),
      optInTraining: z.boolean().optional(),
    }),
  ).min(1),
});

type OverlayProvider = 'crossref' | 'openalex' | 'semantic_scholar';

interface OverlayFieldProposal {
  field: keyof ExtractedFields;
  currentValue: unknown;
  proposedValue: unknown;
  provider: OverlayProvider;
  confidence: number;
  changeKind: 'fill' | 'overwrite';
}

const PRO_ENRICH_PREVIEW_STAGE_ID = 'pro_enrich_preview';
const PRO_ENRICH_APPLY_STAGE_ID = 'pro_enrich_apply';
const PRO_ENRICH_BASELINE_SOURCE = 'before_pro_overlay_apply_original';
const PRO_ENRICH_SNAPSHOT_SOURCE = 'before_pro_overlay_apply_snapshot';
const PRO_ENRICH_APPLIED_SOURCE = 'after_pro_overlay_apply';
const PRO_ENRICH_LOOKUP_CONCURRENCY = 6;
const PRO_ENRICH_APPLY_CONCURRENCY = 6;
type ProEnrichJobResult = NonNullable<NonNullable<Awaited<ReturnType<typeof getJob>>>['result']>;
type ProEnrichCitation = ProEnrichJobResult['references'][number];

export async function proEnrichRoute(app: FastifyInstance): Promise<void> {
  app.post('/jobs/:id/pro-enrich', async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    const parsed = proposalSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Pro enrichment payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const job = await getJob(jobId);
    if (!job?.result) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${jobId} was not found.`);
    }
    await assertJobAccess(req, job);

    const requestedIds = new Set(parsed.data.referenceIds ?? []);
    const references = job.result.references.filter((citation) =>
      requestedIds.size === 0 || requestedIds.has(citation.id),
    );

    const proposals = (
      await mapWithConcurrencyLimit(references, PRO_ENRICH_LOOKUP_CONCURRENCY, async (citation) => {
        const overlayFields = await buildOverlayFields(citation.fields);
        if (overlayFields.length === 0) {
          return null;
        }

        return {
          citationId: citation.id,
          referenceType: citation.referenceType,
          detectedStyle: citation.detectedStyle,
          fields: overlayFields,
        };
      })
    ).filter((proposal): proposal is NonNullable<typeof proposal> => Boolean(proposal));

    await appendJobEvent(jobId, {
      event: 'pro_overlay_generated',
      data: {
        proposalCount: proposals.length,
        referenceIds: proposals.map((proposal) => proposal.citationId),
      },
    });

    return reply.status(200).send({
      jobId,
      proposalCount: proposals.length,
      proposals,
    });
  });

  app.post('/jobs/:id/pro-enrich/preview', async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    const parsed = previewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Pro enrichment preview payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const job = await getJob(jobId);
    if (!job?.result) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${jobId} was not found.`);
    }
    await assertJobAccess(req, job);

    const citation = job.result.references.find((entry) => entry.id === parsed.data.citationId);
    if (!citation) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Citation ${parsed.data.citationId} was not found for job ${jobId}.`);
    }

    const preview = await buildOverlayPreview(citation, parsed.data.fields);

    return reply.status(200).send({
      jobId,
      citationId: citation.id,
      ...preview,
    });
  });

  app.post('/jobs/:id/pro-enrich/accept', async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Overlay acceptance payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const job = await getJob(jobId);
    if (!job?.result) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${jobId} was not found.`);
    }
    await assertJobAccess(req, job);

    let acceptedFieldCount = 0;
    for (const overlay of parsed.data.overlays) {
      const citation = job.result.references.find((entry) => entry.id === overlay.citationId);
      if (!citation) {
        throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Citation ${overlay.citationId} was not found for job ${jobId}.`);
      }

      const fieldNames = Object.keys(overlay.fields);
      acceptedFieldCount += fieldNames.length;
      await saveLearningQueueItem({
        id: randomUUID(),
        citationId: citation.id,
        jobId,
        source: 'user_edit',
        priority: 3,
        trainingData: {
          rawInput: citation.raw,
          overlayAccepted: true,
          overlayFields: overlay.fields,
          overlayFieldNames: fieldNames,
          reviewedBy: overlay.reviewedBy ?? null,
          eligibleForTraining: overlay.optInTraining === true,
          publicStatus: citation.publicStatus,
          engineSnapshot: {
            fieldsPredicted: citation.fields,
            extractionMeta: citation.extractionMeta ?? null,
            engineVersion: 'engine_3.0.0',
          },
        },
        processed: false,
        createdAt: new Date().toISOString(),
      });
      await appendJobEvent(jobId, {
        event: 'pro_overlay_accept',
        data: {
          citationId: citation.id,
          fieldNames,
          reviewedBy: overlay.reviewedBy ?? null,
        },
      });
    }

    return reply.status(200).send({
      jobId,
      acceptedOverlays: parsed.data.overlays.length,
      acceptedFieldCount,
      queuedForReview: true,
    });
  });

  app.post('/jobs/:id/pro-enrich/apply', async (req, reply) => {
    const jobId = (req.params as { id: string }).id;
    const parsed = applySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Pro enrichment apply payload is invalid.', {
        issues: parsed.error.flatten(),
      });
    }

    const job = await getJob(jobId);
    if (!job?.result) {
      throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Job ${jobId} was not found.`);
    }
    await assertJobAccess(req, job);

    const appliedCitations = await mapWithConcurrencyLimit(
      parsed.data.overlays,
      PRO_ENRICH_APPLY_CONCURRENCY,
      async (overlay) => {
        const rescoredCitation = await applyOverlayToCitation(jobId, overlay);
        if (!rescoredCitation) {
          throw new AppError(404, ErrorCode.JOB_NOT_FOUND, `Citation ${overlay.citationId} was not found for job ${jobId}.`);
        }
        return rescoredCitation;
      },
    );
    const updatedCitations = appliedCitations;
    const appliedFieldCount = parsed.data.overlays.reduce(
      (sum, overlay) => sum + Object.keys(overlay.fields).length,
      0,
    );

    await enqueueBatchHealthSummaryRebuild(jobId);

    return reply.status(200).send({
      jobId,
      appliedOverlays: parsed.data.overlays.length,
      appliedFieldCount,
      queuedForReview: true,
      updatedCitations,
    });
  });
}

async function buildOverlayPreview(
  citation: ProEnrichCitation,
  selectedFields: Record<string, unknown>,
): Promise<{
  renderedText: string;
  warningCodes: string[];
  selectedFieldCount: number;
}> {
  const previewFields = await resolveOverlayBaseFields(citation);
  const previewFieldMap = previewFields as Record<keyof ExtractedFields, ExtractedFields[keyof ExtractedFields]>;
  let selectedFieldCount = 0;

  for (const [key, value] of Object.entries(selectedFields)) {
    if (!isExtractedFieldKey(key)) {
      continue;
    }

    const nextField = coerceOverlayField(key, value);
    if (!nextField) {
      continue;
    }

    previewFieldMap[key] = nextField;
    selectedFieldCount += 1;
  }

  if (selectedFieldCount === 0) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'Select at least one valid Pro field before requesting a corrected preview.',
    );
  }

  const requestedStyle = resolveOverlayPreviewStyle(citation.effectiveStyle, citation.detectedStyle);
  const carrier = buildReferenceCarrier(
    {
      index: 0,
      text: citation.raw.trim(),
      splitMethod: 'uncertain',
      splitConfidence: 1,
      isDoiResolved: false,
      flags: [],
      resolvedFields: previewFields,
    },
    {
      primary: { style: requestedStyle, confidence: 1 },
      secondary: null,
      family: 'unknown',
      familyConfidence: 1,
      styleConfidence: 1,
      familyMarginToRunnerUp: 1,
      styleMarginToRunnerUp: 1,
      certaintyTier: 'high',
      familyCandidates: [],
      styleCandidates: [{ style: requestedStyle, score: 1 }],
      signals: [],
      conflictDampened: false,
      isUnknown: false,
      isMultiStyle: false,
    },
    {
      confidence: 1,
      sampled: true,
      splitQualityFlag: 'sampled',
    },
    requestedStyle,
  );

  carrier.type = {
    type: citation.referenceType,
    confidence: 1,
    isUnknown: citation.referenceType === 'unknown',
  };
  carrier.publicStatus = 'ready';
  carrier.parseOutcome = 'high_confidence_parse';

  const ctx = createPipelineContext({
    outputStyle: requestedStyle,
    options: {
      enablePdfCleanup: env.FEATURE_PDF_CLEANUP,
      pdfCleanupMode: 'full',
    },
    tenantContext: {
      tier: 'pro',
      isAdmin: false,
    },
  });

  await phase10Health.run([carrier], ctx);
  await phase12Render.run([carrier], ctx);

  return {
    renderedText: carrier.rendered.text.trim(),
    warningCodes: [...carrier.rendered.warnings],
    selectedFieldCount,
  };
}

async function applyOverlayToCitation(
  jobId: string,
  overlay: z.infer<typeof applySchema>['overlays'][number],
): Promise<ProcessedCitation | undefined> {
  const citation = await getCitation(jobId, overlay.citationId);
  if (!citation) {
    return undefined;
  }

  const baselineFields = await ensureOverlayBaselineFields(jobId, citation);
  await saveCitationVersionSnapshot(jobId, citation, PRO_ENRICH_SNAPSHOT_SOURCE);

  const nextFields = cloneExtractedFields(baselineFields);
  for (const [key, value] of Object.entries(overlay.fields)) {
    if (!isExtractedFieldKey(key)) {
      continue;
    }

    const nextField = coerceOverlayField(key, value, PRO_ENRICH_APPLY_STAGE_ID);
    if (!nextField) {
      continue;
    }

    setExtractedField(nextFields, key, nextField as ExtractedFields[typeof key]);
  }

  const changedFields = EXTRACTED_FIELD_KEYS.filter((field) => {
    const currentField = citation.fields[field];
    const nextField = nextFields[field];
    return (
      currentField.source !== nextField.source
      || currentField.origin !== nextField.origin
      || currentField.stageId !== nextField.stageId
      || currentField.uncertain !== nextField.uncertain
      || !valuesEqual(currentField.value, nextField.value)
    );
  });

  if (changedFields.length === 0) {
    return citation;
  }

  const updated = await updateCitation(jobId, overlay.citationId, (current) => {
    current.fields = cloneExtractedFields(nextFields);
  });
  if (!updated) {
    return undefined;
  }

  const rescoredCarrier = hydrateCarrierFromProcessedCitation(updated);
  const rescoreCtx = createPipelineContext({
    jobId,
    outputStyle: updated.outputStyle,
  });
  await rescoreCarrierAfterCorrection(rescoredCarrier, rescoreCtx, changedFields);
  const rescored = await updateCitation(jobId, overlay.citationId, (current) => {
    applyCarrierToProcessedCitation(current, rescoredCarrier);
  });
  if (!rescored) {
    return undefined;
  }

  await saveCitationVersionSnapshot(jobId, rescored, PRO_ENRICH_APPLIED_SOURCE);
  await appendJobEvent(jobId, {
    event: 'pro_overlay_applied',
    data: {
      citationId: rescored.id,
      fieldNames: changedFields,
      selectedFieldNames: Object.keys(overlay.fields),
      reviewedBy: overlay.reviewedBy ?? null,
      publicStatus: rescored.publicStatus,
      rawScore: rescored.rawScore,
      displayScore: rescored.displayScore,
    },
  });

  if (Object.keys(overlay.fields).length > 0) {
    await queueOverlayLearningItem(jobId, rescored, overlay);
  }
  await persistOverlayAcceptedTruth(rescored, overlay);

  return rescored;
}

async function buildOverlayFields(fields: ExtractedFields): Promise<OverlayFieldProposal[]> {
  const providerCandidates = await lookupOverlayRecords(fields);
  const bestByField = new Map<keyof ExtractedFields, OverlayFieldProposal>();

  for (const candidate of providerCandidates) {
    for (const field of EXTRACTED_FIELD_KEYS) {
      const proposedValue = candidate.record.fields[field];
      if (proposedValue == null || valuesEqual(proposedValue, fields[field].value)) {
        continue;
      }

      const proposal: OverlayFieldProposal = {
        field,
        currentValue: structuredClone(fields[field].value),
        proposedValue: structuredClone(proposedValue),
        provider: candidate.provider,
        confidence: candidate.record.confidence,
        changeKind: hasComparableValue(fields[field].value) ? 'overwrite' : 'fill',
      };
      const current = bestByField.get(field);
      if (!current || current.confidence < proposal.confidence) {
        bestByField.set(field, proposal);
      }
    }
  }

  return [...bestByField.values()].sort((left, right) =>
    right.confidence - left.confidence || left.field.localeCompare(right.field),
  );
}

async function lookupOverlayRecords(
  fields: ExtractedFields,
): Promise<Array<{ provider: OverlayProvider; record: ProviderRecord }>> {
  const [crossrefRecord, openalexRecord] = await Promise.all([
    crossrefService.lookup(fields),
    openAlexService.lookup(fields),
  ]);
  const results: Array<{ provider: OverlayProvider; record: ProviderRecord }> = [];

  if (crossrefRecord) {
    results.push({ provider: 'crossref', record: crossrefRecord });
  }
  if (openalexRecord) {
    results.push({ provider: 'openalex', record: openalexRecord });
  }

  if (results.length === 0) {
    const semanticScholarRecord = await semanticScholarService.lookupLastResort(fields);
    if (semanticScholarRecord) {
      results.push({ provider: 'semantic_scholar', record: semanticScholarRecord });
    }
  }

  return results;
}

function hasComparableValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return value != null;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function coerceOverlayField(
  field: keyof ExtractedFields,
  value: unknown,
  stageId = PRO_ENRICH_PREVIEW_STAGE_ID,
): ExtractedFields[keyof ExtractedFields] | null {
  if (field === 'authors' || field === 'editors') {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }

    return fieldOf(value, 'user_correction', stageId, 1, {
      origin: 'user_consensus',
      uncertain: false,
    }) as ExtractedFields[typeof field];
  }

  if (field === 'year') {
    const numericValue = coerceOverlayYear(value);
    if (numericValue == null) {
      return null;
    }

    return fieldOf(numericValue, 'user_correction', stageId, 1, {
      origin: 'user_consensus',
      uncertain: false,
    }) as ExtractedFields[typeof field];
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return fieldOf(trimmed, 'user_correction', stageId, 1, {
    origin: 'user_consensus',
    uncertain: false,
  }) as ExtractedFields[typeof field];
}

async function resolveOverlayBaseFields(citation: ProEnrichCitation): Promise<ExtractedFields> {
  const versions = await listCitationVersions(citation.id);
  const baselineVersion = versions
    .filter((version) => version.source === PRO_ENRICH_BASELINE_SOURCE)
    .sort((left, right) => left.versionNumber - right.versionNumber)[0];

  return baselineVersion
    ? cloneExtractedFields(baselineVersion.fields)
    : cloneExtractedFields(citation.fields);
}

async function ensureOverlayBaselineFields(
  jobId: string,
  citation: ProcessedCitation,
): Promise<ExtractedFields> {
  const versions = await listCitationVersions(citation.id);
  const baselineVersion = versions
    .filter((version) => version.source === PRO_ENRICH_BASELINE_SOURCE)
    .sort((left, right) => left.versionNumber - right.versionNumber)[0];

  if (baselineVersion) {
    return cloneExtractedFields(baselineVersion.fields);
  }

  await saveCitationVersionSnapshot(jobId, citation, PRO_ENRICH_BASELINE_SOURCE);
  return cloneExtractedFields(citation.fields);
}

async function saveCitationVersionSnapshot(
  jobId: string,
  citation: ProcessedCitation,
  source: string,
): Promise<void> {
  await appendCitationVersion({
    id: randomUUID(),
    citationId: citation.id,
    jobId,
    fields: cloneExtractedFields(citation.fields),
    source,
    createdAt: new Date().toISOString(),
  });
}

async function queueOverlayLearningItem(
  jobId: string,
  citation: ProcessedCitation,
  overlay: z.infer<typeof applySchema>['overlays'][number],
): Promise<void> {
  const fieldNames = Object.keys(overlay.fields);
  await saveLearningQueueItem({
    id: randomUUID(),
    citationId: citation.id,
    jobId,
    source: 'user_edit',
    priority: 3,
    trainingData: {
      rawInput: citation.raw,
      overlayAccepted: true,
      overlayFields: overlay.fields,
      overlayFieldNames: fieldNames,
      reviewedBy: overlay.reviewedBy ?? null,
      eligibleForTraining: overlay.optInTraining === true,
      publicStatus: citation.publicStatus,
      engineSnapshot: {
        fieldsPredicted: citation.fields,
        extractionMeta: citation.extractionMeta ?? null,
        engineVersion: 'engine_3.0.0',
      },
    },
    processed: false,
    createdAt: new Date().toISOString(),
  });
}

async function persistOverlayAcceptedTruth(
  citation: ProcessedCitation,
  overlay: z.infer<typeof applySchema>['overlays'][number],
): Promise<void> {
  const expectedFields = buildApprovedTruthFieldsFromCitation(citation);
  const overlayTruth = buildOverlayTruthFields(citation, overlay.fields);

  await upsertApprovedTruthPayload({
    rawText: citation.raw,
    expectedFields,
    coreTruth: expectedFields,
    overlayTruth,
    expectedType: citation.referenceType === 'unknown' ? null : citation.referenceType,
    expectedStyle: resolveOverlayPreviewStyle(citation.outputStyle, citation.effectiveStyle),
    provenance: buildOverlayTruthProvenance(citation.id),
    pipelineMajor: 3,
    datasetSplit: null,
    trustLevel: 'gold',
    rowStatus: 'reviewed',
    goldKind: 'overlay_accept',
    approvalSource: 'overlay_accept',
    reviewedBy: overlay.reviewedBy ?? null,
  });
}

function buildApprovedTruthFieldsFromCitation(
  citation: ProcessedCitation,
): Record<string, unknown> {
  const populated: Record<string, unknown> = {};
  for (const key of EXTRACTED_FIELD_KEYS) {
    const field = citation.fields[key];
    if (!field || field.value == null || !hasComparableValue(field.value)) {
      continue;
    }
    populated[key] = structuredClone(field.value);
  }

  if (citation.renderedText.trim()) {
    populated.corrected_output = citation.renderedText.trim();
  }

  return populated;
}

function buildOverlayTruthFields(
  citation: ProcessedCitation,
  selectedFields: Record<string, unknown>,
): Record<string, unknown> {
  const overlayTruth: Record<string, unknown> = {};

  for (const [key] of Object.entries(selectedFields)) {
    if (!isExtractedFieldKey(key)) {
      continue;
    }

    const field = citation.fields[key];
    if (!field || field.value == null || !hasComparableValue(field.value)) {
      continue;
    }

    overlayTruth[key] = structuredClone(field.value);
  }

  if (citation.renderedText.trim()) {
    overlayTruth.corrected_output = citation.renderedText.trim();
  }

  return overlayTruth;
}

function buildOverlayTruthProvenance(citationId: string): string {
  const base = `pro_overlay:${citationId}`;
  return base.length <= 50 ? base : base.slice(0, 50);
}

function coerceOverlayYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const match = value.trim().match(/\b\d{4}\b/u);
    if (match) {
      return Number(match[0]);
    }
  }

  return null;
}

function resolveOverlayPreviewStyle(
  effectiveStyle: string | null | undefined,
  detectedStyle?: string | null | undefined,
): CitationStyle {
  if (effectiveStyle && effectiveStyle !== 'auto' && effectiveStyle !== 'unknown') {
    return effectiveStyle as CitationStyle;
  }

  if (detectedStyle && detectedStyle !== 'auto' && detectedStyle !== 'unknown') {
    return detectedStyle as CitationStyle;
  }

  return 'apa7';
}

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  };

  await Promise.all(Array.from({ length: safeLimit }, () => runWorker()));
  return results;
}
