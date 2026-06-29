import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from 'zod';
import { env } from '../config.js';
import { AppError, ErrorCode } from "../engine/errors/index.js";
import { createPipelineDependencies } from '../pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../pipeline/orchestrator.js';
import {
  deleteApprovedTruth,
  deleteApprovedTruthEditorDraft,
  getApprovedTruth,
  getApprovedTruthEditorDraft,
  getApprovedTruthRenderVariant,
  listApprovedTruth,
  listApprovedTruthRenderVariants,
  listLearningQueue,
  listShadowExtractionHistory,
  markLearningQueueItemsProcessed,
  markLearningQueueItemsUnprocessed,
  upsertApprovedTruthRenderVariant,
  promoteLearningQueueRow,
  runtimePersistenceBackend,
  type ApprovedTruthEditorDraftPayload,
  type StoredApprovedTruthEditorDraft,
  type StoredApprovedTruthRenderVariant,
  upsertApprovedTruthPayload,
  upsertApprovedTruthEditorDraft,
} from "../runtime/persistence.js";
import type { CitationStyle, ProcessedCitation } from '../engine/types/citation.js';
import type { ConvertRequest } from '../engine/types/api.js';
import type {
  StoredApprovedTruth,
  TruthDatasetSplit,
  TruthRenderVariantStyle,
  TruthTaskCertification,
  TruthTrustLevel,
} from "../runtime/store.js";
import {
  EXTRACTED_FIELD_KEYS,
  createEmptyExtractedFields,
  hasFieldValue,
  isExtractedFieldKey,
} from '../engine/utils/fields.js';
import { fieldOf } from '../engine/types/field.js';
import { buildReferenceCarrier } from '../engine/utils/carriers.js';
import { parseAuthorSegment } from '../engine/utils/authors.js';
import { phase10Health } from '../engine/phases/phase10Health.js';
import { phase12Render } from '../engine/phases/phase12Render.js';
import {
  buildGeneratedAuthorityPack,
  loadGeneratedAuthorityPack,
  writeGeneratedAuthorityPack,
} from '../engine/data/generatedAuthorityPack.js';
import {
  resolveBenchmarkResultsRoot,
  resolveBioDatasetRoot,
  resolveBioModelRoot,
  resolveGoldDatasetRoot,
  resolvePythonBioTrainingScriptPath,
  resolvePythonBundlePromotionScriptPath,
  resolvePythonPromotionScriptPath,
  resolvePythonTrainingScriptPath,
  resolveMlServiceRoot,
  resolveStyleGoldOutputPath,
  resolveStyleModelRoot,
} from '../runtime/artifactPaths.js';
import { writeStyleGoldExport } from '../training/styleGoldExport.js';
import { writeBioSupervisionExport } from '../training/bioSupervisionExport.js';
import { getRankedQueue, persistSubmission, validateSpans } from '../training/bioReviewQueue.js';
import { runInboxTriage } from '../training/bioReviewTriage.js';
import { normalizeExpectedTruthFields, type TruthFieldValue } from '../training/truthFields.js';
import {
  defaultTrainingPackTargetForCertification,
  TRAINING_PACK_TARGETS,
  writeStagedTrainingPack,
  type TrainingPackTarget,
} from '../training/trainingPackStaging.js';
import { HttpMLClient } from '../ml/client.js';
import {
  buildDecisionHash,
  effectiveRowStatus,
  evaluateCertificationLint,
  hasSplitLeakage,
  isTaskCertified,
  legacyTrustToRowStatus,
  setTaskCertification,
  withLegacyCertification,
} from '../training/truthCertification.js';
import {
  ADVERSARIAL_TARGET_PER_PAIR,
  buildStyleCoreFreezeSelection,
  createFrozenManifest,
  FROZEN_STYLE_CORE_TOTAL,
  listFrozenGoldDatasetManifests,
  readFrozenGoldDatasetManifest,
  REQUIRED_ADVERSARIAL_PAIRS,
  STYLE_CLEAN_TARGET_PER_STYLE,
  STYLE_NOISY_TARGET_PER_STYLE,
  SUPPORTED_STYLE_LABELS,
  writeFrozenGoldDatasetManifest,
} from '../training/styleGoldDatasetFreeze.js';
import { engineCitationStyleSchema } from '../engine/types/runtime-enums.js';
import { crossrefService, type ProviderRecord } from '../services/crossref.js';
import { normalizeDoi } from '../engine/identifierUtils.js';
import { recordAuditEvent } from '../audit/recordAudit.js';
import { getCorrelationId } from '../runtime/requestContext.js';
import {
  applyTruthBackgroundJobCounts,
  createTruthBackgroundJob,
  loadApprovedTruthRowsForFilters,
  mapTruthBackgroundPageResults,
  normalizeApprovedTruthFilters,
  pruneTruthBackgroundJobs,
  sliceApprovedTruthRowsForPageRange,
  summarizeTruthBackgroundJob,
  truthBackgroundJobs,
  truthBackgroundOperationConcurrency,
  type ApprovedTruthListFilters,
  type TruthBackgroundJob,
  type TruthBackgroundRowResult,
  type TruthCertifyRowResult,
  type TruthCrossrefRowResult,
  type TruthDeleteRowResult,
  type TruthPrefillRowResult,
  type TruthUpdateRowResult,
} from './admin-truth/backgroundJobs.js';
import {
  findApprovedTruthByAdminRawText,
  normalizeAdminTruthRawText,
} from '../admin/adminTruthRawText.js';
import {
  claimTruthBackgroundDbJob,
  getTruthBackgroundDbJob,
  listClaimableTruthBackgroundDbJobIds,
  pruneTruthBackgroundDbJobs,
  saveTruthBackgroundDbJob,
  updateTruthBackgroundDbJob,
} from './admin-truth/backgroundJobStore.js';
import {
  approvedTruthRenderVariantStyleSchema,
  buildBioBundleSchema,
  approvedTruthRenderVariantStyleValues,
  buildStyleBundleSchema,
  certifyTruthSchema,
  createTruthSchema,
  freezeStyleGoldDatasetSchema,
  learningQueueBulkProcessSchema,
  learningQueueBulkPromoteSchema,
  patchTruthSchema,
  promoteSchema,
  promoteBioBundleSchema,
  promoteStyleBundleSchema,
  styleBundleVersionSchema,
  syncCoreTruthSchema,
  taskSchema,
  truthAuditReasonSchema,
  truthBackgroundBulkSchema,
  truthBulkCertifySchema,
  truthBulkCrossrefSchema,
  truthBulkDeleteSchema,
  truthBulkFilterSchema,
  truthBulkPrefillSchema,
  truthBulkUpdatePayloadSchema,
  truthBulkUpdateSchema,
  truthCrossrefPrefillSchema,
  truthEditorDraftPayloadSchema,
  truthPrefillSchema,
  truthRenderPreviewSchema,
  truthRenderVariantApproveSchema,
  truthRenderVariantGenerateSchema,
  truthRenderVariantPatchSchema,
  truthScopeSchema,
  trainingPackTargetSchema,
  type BulkTruthUpdateInput,
  type CertifyTruthInput,
  type LearningQueueBulkPromoteInput,
  type TrainingPackTargetOption,
  type TruthAuditReasonCode,
  type TruthBackgroundBulkOperation,
  type TruthBackgroundPageRangeInput,
  type TruthBulkFilterInput,
  type TruthEditorDraftInput,
  type TruthScopeOption,
  type TruthTaskOption,
} from './admin-truth/schemas.js';
import {
  buildGeneratedTruthRenderVariant,
  buildTruthRenderVariantRendererVersion,
  exportRenderVariantRow,
  listTruthRenderVariantStyles,
} from './admin-truth/renderVariants.js';

const TRUTH_SCAN_LIMIT = 50_000;
const GOLD_BIO_BUNDLE_VERSION = 'GOLD-BIO-Tagging-Dataset';

const bioReviewSubmitSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  raw_text: z.string().min(1),
  entity_fields: z.array(z.string()).default([]),
  entity_starts: z.array(z.number().int()).default([]),
  entity_ends: z.array(z.number().int()).default([]),
  expected_type: z.string().nullish(),
  stratum: z.string().optional(),
  dataset_split: z.string().optional(),
});
const BIO_ADMIN_BUILD_EPOCHS = 40;
const BIO_BUNDLE_BUILD_TIMEOUT_MS = 900_000;

function requireAdminUserId(req: FastifyRequest): string {
  const userId = (req as FastifyRequest & { userId?: string }).userId;
  if (!userId) {
    throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Authentication required.');
  }
  return userId;
}

function serializeTruthEditorDraftResponse(draft: StoredApprovedTruthEditorDraft | null) {
  return {
    draft,
    persistenceBackend: runtimePersistenceBackend,
    durable: runtimePersistenceBackend === 'database',
  };
}

function detectTruthPrefillSourceType(rawText: string): ConvertRequest['sourceType'] {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^10\.\d{4,9}\/\S+$/i.test(line))
    ? 'doi_list'
    : 'text';
}

function pickTruthPrefillReference(references: ProcessedCitation[]): ProcessedCitation | null {
  if (references.length === 0) {
    return null;
  }
  return [...references].sort((left, right) => {
    const duplicateRank = Number(Boolean(left.duplicateOf)) - Number(Boolean(right.duplicateOf));
    if (duplicateRank !== 0) {
      return duplicateRank;
    }
    if (right.displayScore !== left.displayScore) {
      return right.displayScore - left.displayScore;
    }
    return left.index - right.index;
  })[0] ?? null;
}

function buildTruthPrefillFields(citation: ProcessedCitation): Record<string, TruthFieldValue> {
  const populated: Record<string, unknown> = {};
  for (const key of EXTRACTED_FIELD_KEYS) {
    const field = citation.fields[key];
    if (!hasFieldValue(field)) {
      continue;
    }
    populated[key] = field.value;
  }
  if (citation.renderedText.trim()) {
    populated.corrected_output = citation.renderedText.trim();
  }
  return normalizeExpectedTruthFields(populated);
}

function normalizePrefillStyle(style: CitationStyle): CitationStyle | null {
  return style === 'auto' || style === 'unknown' ? null : style;
}

function resolveTruthPrefillOutputStyle(expectedStyle: string | null | undefined): CitationStyle {
  const parsed = engineCitationStyleSchema.safeParse(expectedStyle ?? 'auto');
  return parsed.success ? parsed.data : 'auto';
}

const TRUTH_PREVIEW_STAGE_ID = 'admin_truth_preview';

function truthFieldValueToString(value: TruthFieldValue | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => truthFieldValueToString(entry as TruthFieldValue))
      .filter((entry): entry is string => Boolean(entry))
      .join('; ');
    return joined.trim().length > 0 ? joined : null;
  }
  return null;
}

function truthFieldValueToNumber(value: TruthFieldValue | undefined): number | null {
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

function truthFieldValueToAuthors(value: TruthFieldValue | undefined) {
  const inputs = Array.isArray(value) ? value : value != null ? [value] : [];
  return inputs.flatMap((entry) => {
    if (typeof entry !== 'string') {
      return [];
    }
    return parseAuthorSegment(entry);
  });
}

function setTruthPreviewFieldValue(
  fields: ReturnType<typeof createEmptyExtractedFields>,
  key: keyof ReturnType<typeof createEmptyExtractedFields>,
  value: ReturnType<typeof truthFieldValueToString> | ReturnType<typeof truthFieldValueToNumber> | ReturnType<typeof truthFieldValueToAuthors>,
): void {
  if (key === 'authors' || key === 'editors') {
    if (!Array.isArray(value) || value.length === 0) {
      return;
    }
    (fields as unknown as Record<string, unknown>)[key] = fieldOf(value, 'admin_confirmed', TRUTH_PREVIEW_STAGE_ID, 1, {
      uncertain: false,
    });
    return;
  }

  if (value === null || value === undefined || typeof value === 'object') {
    return;
  }

  (fields as unknown as Record<string, unknown>)[key] = fieldOf(value as string | number | boolean, 'admin_confirmed', TRUTH_PREVIEW_STAGE_ID, 1, {
    uncertain: false,
  });
}

function applyTruthPreviewExpectedField(
  fields: ReturnType<typeof createEmptyExtractedFields>,
  expectedType: string | null,
  key: string,
  value: TruthFieldValue,
): void {
  if (key === 'corrected_output') {
    return;
  }

  if (key === 'journal/venue') {
    const targetKey = expectedType === 'conference-paper' ? 'conferenceTitle' : 'journal';
    setTruthPreviewFieldValue(fields, targetKey, truthFieldValueToString(value));
    return;
  }

  if (key === 'venue') {
    setTruthPreviewFieldValue(fields, 'conferenceTitle', truthFieldValueToString(value));
    return;
  }

  if (key === 'authors' || key === 'editors') {
    setTruthPreviewFieldValue(fields, key, truthFieldValueToAuthors(value));
    return;
  }

  if (key === 'year') {
    setTruthPreviewFieldValue(fields, 'year', truthFieldValueToNumber(value));
    return;
  }

  if (!isExtractedFieldKey(key)) {
    return;
  }

  setTruthPreviewFieldValue(fields, key, truthFieldValueToString(value));
}

async function runTruthRenderPreview(input: {
  rawText: string;
  expectedFields: Record<string, unknown>;
  expectedType: string | null;
  expectedStyle: CitationStyle;
}): Promise<{
  renderedText: string;
  expectedType: string | null;
  expectedStyle: CitationStyle | null;
  warningCodes: string[];
  fieldCount: number;
}> {
  if (input.expectedStyle === 'auto' || input.expectedStyle === 'unknown') {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'Select an expected style before generating an engine output preview.',
    );
  }

  const normalizedExpectedFields = normalizeExpectedTruthFields(input.expectedFields);
  const extractedFields = createEmptyExtractedFields(TRUTH_PREVIEW_STAGE_ID, 'admin_confirmed');

  for (const [key, value] of Object.entries(normalizedExpectedFields)) {
    applyTruthPreviewExpectedField(extractedFields, input.expectedType, key, value);
  }

  const fieldCount = Object.entries(extractedFields).filter(([, field]) => hasFieldValue(field)).length;
  if (fieldCount === 0) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'Add at least one populated truth field before generating an engine output preview.',
    );
  }

  const carrier = buildReferenceCarrier(
    {
      index: 0,
      text: input.rawText.trim(),
      splitMethod: 'uncertain',
      splitConfidence: 1,
      isDoiResolved: false,
      flags: [],
      resolvedFields: extractedFields,
    },
    {
      primary: { style: input.expectedStyle, confidence: 1 },
      secondary: null,
      family: 'unknown',
      familyConfidence: 1,
      styleConfidence: 1,
      familyMarginToRunnerUp: 1,
      styleMarginToRunnerUp: 1,
      certaintyTier: 'high',
      familyCandidates: [],
      styleCandidates: [{ style: input.expectedStyle, score: 1 }],
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
    input.expectedStyle,
  );
  carrier.type = {
    type: (input.expectedType ?? 'unknown') as typeof carrier.type.type,
    confidence: input.expectedType ? 1 : 0,
    isUnknown: !input.expectedType || input.expectedType === 'unknown',
  };
  carrier.publicStatus = 'ready';
  carrier.parseOutcome = 'high_confidence_parse';

  const ctx = createPipelineContext({
    outputStyle: input.expectedStyle,
    options: {
      enablePdfCleanup: env.FEATURE_PDF_CLEANUP,
      pdfCleanupMode: 'full',
    },
    tenantContext: {
      tier: 'b2b',
      isAdmin: true,
    },
  });

  await phase10Health.run([carrier], ctx);
  await phase12Render.run([carrier], ctx);

  return {
    renderedText: carrier.rendered.text.trim(),
    expectedType: carrier.type.type === 'unknown' ? input.expectedType : carrier.type.type,
    expectedStyle: input.expectedStyle,
    warningCodes: [...carrier.rendered.warnings],
    fieldCount,
  };
}

async function runTruthPrefill(
  rawText: string,
  outputStyle: CitationStyle,
): Promise<{
  expectedFields: Record<string, TruthFieldValue>;
  coreTruth: Record<string, TruthFieldValue>;
  expectedType: string | null;
  expectedStyle: CitationStyle | null;
  pipelineMajor: number;
  publicStatus: string;
  renderedText: string;
  referenceCount: number;
  usedReferenceIndex: number;
  fieldCount: number;
  warnings: string[];
}> {
  const request: ConvertRequest = {
    sourceType: detectTruthPrefillSourceType(rawText),
    content: rawText,
    outputStyle,
  };
  const ctx = createPipelineContext({
    outputStyle,
    options: {
      enablePdfCleanup: env.FEATURE_PDF_CLEANUP,
      pdfCleanupMode: 'full',
    },
    tenantContext: {
      tier: 'b2b',
      isAdmin: true,
    },
  });
  const artifacts = await runConvertPipeline(request, ctx, createPipelineDependencies());
  const citation = pickTruthPrefillReference(artifacts.response.references);
  if (!citation) {
    throw new AppError(
      409,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'Engine could not produce a citation candidate for truth prefill.',
    );
  }

  const expectedFields = buildTruthPrefillFields(citation);
  const fieldCount = Object.keys(expectedFields).length;
  if (fieldCount === 0) {
    throw new AppError(
      409,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'Engine could not extract populated fields for truth prefill.',
    );
  }

  const referenceCount = artifacts.response.references.length;
  const warnings =
    referenceCount > 1
      ? [`Prefill selected one citation from ${referenceCount} detected references.`]
      : [];

  return {
    expectedFields,
    coreTruth: expectedFields,
    expectedType: citation.referenceType === 'unknown' ? null : citation.referenceType,
    expectedStyle: normalizePrefillStyle(citation.detectedStyle),
    pipelineMajor: citation.pipelineMajor,
    publicStatus: citation.publicStatus,
    renderedText: citation.renderedText,
    referenceCount,
    usedReferenceIndex: citation.index,
    fieldCount,
    warnings,
  };
}

const DOI_CANDIDATE_REGEX = /(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/giu;

function trimTrailingDoiPunctuation(value: string): string {
  return value.replace(/[)\].,;:]+$/u, '');
}

function normalizeEditableTruthFields(input: Record<string, unknown>): Record<string, TruthFieldValue> {
  try {
    return normalizeExpectedTruthFields(input);
  } catch {
    return {};
  }
}

function hasMeaningfulTruthFields(input: Record<string, unknown> | null | undefined): boolean {
  const normalized = normalizeEditableTruthFields(input ?? {});
  return Object.entries(normalized).some(([key, value]) => {
    if (key === 'corrected_output' || key === 'formatted_string') {
      return false;
    }
    return truthFieldValueToString(value) !== null;
  });
}

async function resolveInitialApprovedTruthSeed(input: {
  rawText: string;
  expectedFields: Record<string, unknown>;
  coreTruth?: Record<string, unknown> | null;
  expectedType?: string | null;
  expectedStyle?: string | null;
  pipelineMajor?: number | null;
}): Promise<{
  expectedFields: Record<string, TruthFieldValue>;
  coreTruth: Record<string, TruthFieldValue>;
  expectedType: string | null;
  expectedStyle: string | null;
  pipelineMajor: number | null;
  seededFromEngine: boolean;
}> {
  const normalizedExpectedFields = normalizeEditableTruthFields(input.expectedFields);
  const normalizedCoreTruth = normalizeEditableTruthFields(input.coreTruth ?? normalizedExpectedFields);
  const hasExpectedFields = hasMeaningfulTruthFields(normalizedExpectedFields);
  const hasCoreTruth = hasMeaningfulTruthFields(normalizedCoreTruth);

  if (hasExpectedFields || hasCoreTruth) {
    const resolvedExpectedFields = hasExpectedFields ? normalizedExpectedFields : normalizedCoreTruth;
    const resolvedCoreTruth = hasCoreTruth ? normalizedCoreTruth : resolvedExpectedFields;
    return {
      expectedFields: resolvedExpectedFields,
      coreTruth: resolvedCoreTruth,
      expectedType: input.expectedType ?? null,
      expectedStyle: input.expectedStyle ?? null,
      pipelineMajor: input.pipelineMajor ?? null,
      seededFromEngine: false,
    };
  }

  const prefill = await runTruthPrefill(
    input.rawText,
    resolveTruthPrefillOutputStyle(input.expectedStyle ?? null),
  );

  return {
    expectedFields: prefill.expectedFields,
    coreTruth: prefill.coreTruth,
    expectedType: input.expectedType ?? prefill.expectedType ?? null,
    expectedStyle: input.expectedStyle ?? prefill.expectedStyle ?? null,
    pipelineMajor: input.pipelineMajor ?? prefill.pipelineMajor ?? null,
    seededFromEngine: true,
  };
}

function resolveCrossrefDoiCandidate(
  rawText: string,
  expectedFields: Record<string, unknown>,
  provenance?: string | null,
): string | null {
  const candidates = [
    provenance?.trim() || null,
    typeof expectedFields.doi === 'string' ? expectedFields.doi : null,
    typeof expectedFields.url === 'string' ? expectedFields.url : null,
    rawText,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const direct = normalizeDoi(trimTrailingDoiPunctuation(candidate));
    if (direct) {
      return direct;
    }

    DOI_CANDIDATE_REGEX.lastIndex = 0;
    const matches = candidate.matchAll(DOI_CANDIDATE_REGEX);
    for (const match of matches) {
      const normalized = normalizeDoi(trimTrailingDoiPunctuation(match[1] ?? ''));
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function mapCrossrefRecordToTruthFields(record: ProviderRecord): {
  expectedFields: Record<string, unknown>;
  expectedType: string | null;
  warnings: string[];
} {
  const expectedFields: Record<string, unknown> = {};
  const warnings: string[] = [];
  const expectedType = record.referenceType ?? null;

  if (Array.isArray(record.authors) && record.authors.length > 0) {
    expectedFields.authors = record.authors;
  } else if (record.fields.authors !== undefined) {
    expectedFields.authors = record.fields.authors;
  }

  const title = record.fields.title;
  if (title !== undefined) {
    expectedFields.title = title;
  }
  const year = record.fields.year;
  if (year !== undefined) {
    expectedFields.year = year;
  }
  const doi = record.fields.doi;
  if (doi !== undefined) {
    expectedFields.doi = doi;
  }
  const url = record.fields.url;
  if (url !== undefined) {
    expectedFields.url = url;
  }
  const publisher = record.fields.publisher;
  if (publisher !== undefined) {
    expectedFields.publisher = publisher;
  }
  const volume = record.fields.volume;
  if (volume !== undefined) {
    expectedFields.volume = volume;
  }
  const issue = record.fields.issue;
  if (issue !== undefined) {
    expectedFields.issue = issue;
  }
  const pages = record.fields.pages;
  if (pages !== undefined) {
    expectedFields.pages = pages;
  }
  const issn = record.fields.issn;
  if (issn !== undefined) {
    expectedFields.issn = issn;
  }
  const isbn = record.fields.isbn;
  if (isbn !== undefined) {
    expectedFields.isbn = isbn;
  }

  const venueCandidate = (record.fields as Record<string, unknown>)['venue'];
  const containerTitle =
    typeof record.fields.journal === 'string'
      ? record.fields.journal
      : typeof venueCandidate === 'string'
        ? venueCandidate
        : null;

  if (containerTitle) {
    if (expectedType === 'conference-paper') {
      expectedFields.conferenceTitle = containerTitle;
      expectedFields['journal/venue'] = containerTitle;
    } else if (expectedType === 'book-chapter') {
      expectedFields.bookTitle = containerTitle;
    } else if (expectedType === 'article-journal') {
      expectedFields.journal = containerTitle;
      expectedFields['journal/venue'] = containerTitle;
    } else {
      expectedFields['journal/venue'] = containerTitle;
      warnings.push('Crossref matched the DOI but did not return a strong reference type mapping.');
    }
  }

  return { expectedFields, expectedType, warnings };
}

async function runCrossrefTruthPrefill(
  rawText: string,
  existingExpectedFields: Record<string, unknown>,
  provenance?: string | null,
): Promise<{
  expectedFields: Record<string, TruthFieldValue>;
  coreTruth: Record<string, TruthFieldValue>;
  expectedType: string | null;
  matchedDoi: string;
  fieldCount: number;
  warnings: string[];
}> {
  const matchedDoi = resolveCrossrefDoiCandidate(rawText, existingExpectedFields, provenance);
  if (!matchedDoi) {
    throw new AppError(
      409,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'No DOI was found in the current truth row. Add a DOI first, then retry Crossref fill.',
    );
  }

  const record = await crossrefService.resolveDoi(matchedDoi);
  if (!record) {
    throw new AppError(
      404,
      ErrorCode.NOT_FOUND,
      `Crossref did not return metadata for DOI ${matchedDoi}.`,
    );
  }

  const mapped = mapCrossrefRecordToTruthFields(record);
  const replaced = normalizeExpectedTruthFields({
    ...mapped.expectedFields,
    doi: record.fields.doi ?? matchedDoi,
    ...(record.fields.url ? {} : { url: `https://doi.org/${record.fields.doi ?? matchedDoi}` }),
  });
  const fieldCount = Object.keys(replaced).length;

  return {
    expectedFields: replaced,
    coreTruth: replaced,
    expectedType: mapped.expectedType,
    matchedDoi,
    fieldCount,
    warnings: mapped.warnings,
  };
}

const STYLE_CLEAN_TARGET_TOTAL = STYLE_CLEAN_TARGET_PER_STYLE * SUPPORTED_STYLE_LABELS.length;
const STYLE_NOISY_TARGET_TOTAL = STYLE_NOISY_TARGET_PER_STYLE * SUPPORTED_STYLE_LABELS.length;
const STYLE_ADVERSARIAL_TARGET_TOTAL = ADVERSARIAL_TARGET_PER_PAIR * REQUIRED_ADVERSARIAL_PAIRS.length;
const STYLE_CLEAN_CANDIDATE_TARGET = 15_000;
const STYLE_ADVERSARIAL_CANDIDATE_TARGET = 2_250;
const STYLE_NOISY_CANDIDATE_TARGET = 3_000;
type TruthBackgroundJobSummary = ReturnType<typeof summarizeTruthBackgroundJob>;
const truthBackgroundWorkerId = `truth-background-${process.pid}`;
const activeTruthBackgroundJobs = new Set<string>();

function usesPersistentTruthBackgroundJobs(): boolean {
  return runtimePersistenceBackend === 'database';
}

async function saveTruthBackgroundJobState(job: TruthBackgroundJob): Promise<TruthBackgroundJob> {
  if (usesPersistentTruthBackgroundJobs()) {
    return saveTruthBackgroundDbJob(job);
  }
  truthBackgroundJobs.set(job.id, job);
  return job;
}

async function loadTruthBackgroundJobSummary(jobId: string): Promise<TruthBackgroundJobSummary | null> {
  if (usesPersistentTruthBackgroundJobs()) {
    const job = await getTruthBackgroundDbJob(jobId);
    return job ? summarizeTruthBackgroundJob(job) : null;
  }

  const job = truthBackgroundJobs.get(jobId);
  return job ? summarizeTruthBackgroundJob(job) : null;
}

async function updateTruthBackgroundJobState(
  jobId: string,
  updater: (job: TruthBackgroundJob) => void,
): Promise<TruthBackgroundJob | null> {
  if (usesPersistentTruthBackgroundJobs()) {
    return updateTruthBackgroundDbJob(jobId, updater);
  }

  const current = truthBackgroundJobs.get(jobId);
  if (!current) {
    return null;
  }
  updater(current);
  truthBackgroundJobs.set(jobId, current);
  return current;
}

async function beginTruthBackgroundJobProcessing(jobId: string): Promise<TruthBackgroundJob | null> {
  if (usesPersistentTruthBackgroundJobs()) {
    return claimTruthBackgroundDbJob(jobId, truthBackgroundWorkerId);
  }

  const job = truthBackgroundJobs.get(jobId);
  if (!job) {
    return null;
  }
  if (job.status === 'completed' || job.status === 'failed') {
    return job;
  }
  if (job.status !== 'running') {
    job.status = 'running';
    job.startedAt = job.startedAt ?? new Date().toISOString();
  }
  truthBackgroundJobs.set(jobId, job);
  return job;
}

async function pruneCompletedTruthBackgroundJobs(): Promise<void> {
  if (usesPersistentTruthBackgroundJobs()) {
    await pruneTruthBackgroundDbJobs(24);
    return;
  }
  pruneTruthBackgroundJobs();
}

async function processTruthBackgroundJob(jobId: string): Promise<void> {
  if (activeTruthBackgroundJobs.has(jobId)) {
    return;
  }
  activeTruthBackgroundJobs.add(jobId);

  try {
    let job = await beginTruthBackgroundJobProcessing(jobId);
    if (!job) {
      return;
    }

    for (let pageIndex = job.completedPages; pageIndex < job.totalPages; pageIndex += 1) {
      const start = pageIndex * job.pageSize;
      const pageIds = job.rowIds.slice(start, start + job.pageSize);
      const currentJob = job;

      const pageResults = await mapTruthBackgroundPageResults(
        pageIds,
        truthBackgroundOperationConcurrency(currentJob.operation),
        async (id) => runTruthBackgroundJobOperation(currentJob, id),
      );
      const completedAt = new Date().toISOString();

      const updated = await updateTruthBackgroundJobState(jobId, (current) => {
        current.status = 'running';
        current.startedAt = current.startedAt ?? new Date().toISOString();
        for (const result of pageResults) {
          current.results.push(result);
          applyTruthBackgroundJobCounts(current, result);
        }
        current.completedRows += pageIds.length;
        current.completedPages = pageIndex + 1;
        current.recentResults = pageResults;
        current.recentCompletedPage = pageIndex + 1;
        current.recentCompletedAt = completedAt;
      });
      if (!updated) {
        return;
      }
      job = updated;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }

    await updateTruthBackgroundJobState(jobId, (current) => {
      current.status = 'completed';
      current.finishedAt = new Date().toISOString();
      current.error = null;
    });
    await pruneCompletedTruthBackgroundJobs();
  } catch (error) {
    await updateTruthBackgroundJobState(jobId, (current) => {
      current.status = 'failed';
      current.finishedAt = new Date().toISOString();
      current.error = error instanceof Error ? error.message : 'Background approved-truth bulk job failed.';
    });
    await pruneCompletedTruthBackgroundJobs();
  } finally {
    activeTruthBackgroundJobs.delete(jobId);
  }
}

export async function resumeTruthBackgroundJobs(): Promise<void> {
  if (!usesPersistentTruthBackgroundJobs()) {
    return;
  }
  const ids = await listClaimableTruthBackgroundDbJobIds(25);
  for (const jobId of ids) {
    queueMicrotask(() => {
      void processTruthBackgroundJob(jobId);
    });
  }
}

export async function runTruthBackgroundJobOperation(
  job: TruthBackgroundJob,
  id: string,
): Promise<TruthBackgroundRowResult> {
  if (job.operation === 'prefill') {
    return prefillApprovedTruthRow(id);
  }

  if (job.operation === 'crossref') {
    return crossrefApprovedTruthRow(id);
  }

  if (job.operation === 'delete') {
    return deleteApprovedTruthRow(id);
  }

  if (job.operation === 'update') {
    return updateApprovedTruthRow(id, job.update as BulkTruthUpdateInput);
  }

  return certifyApprovedTruthRow(id, job.certify as CertifyTruthInput);
}

function exportRow(
  t: StoredApprovedTruth,
  options: {
    truthScope: 'core' | 'overlay';
    task: 'style' | 'field' | 'authority_pack' | 'overlay_learning';
  },
): Record<string, unknown> {
  const row = withLegacyCertification(t);
  const scopedFields = options.truthScope === 'overlay'
    ? row.overlayTruth ?? {}
    : row.coreTruth ?? row.expectedFields;
  const correctedOutput =
    typeof scopedFields.corrected_output === 'string' && scopedFields.corrected_output.trim()
      ? scopedFields.corrected_output.trim()
      : typeof scopedFields.formatted_string === 'string' && scopedFields.formatted_string.trim()
        ? scopedFields.formatted_string.trim()
        : undefined;
  return {
    raw_text: row.rawText,
    expected_fields: scopedFields,
    expected_type: row.expectedType ?? undefined,
    expected_style: row.expectedStyle ?? undefined,
    corrected_output: correctedOutput,
    input_hash: row.inputHash,
    dataset_split: row.datasetSplit ?? undefined,
    trust_level: row.trustLevel,
    row_status: effectiveRowStatus(row),
    blocked_reason: row.blockedReason ?? undefined,
    provenance: row.provenance ?? undefined,
    pipeline_major: row.pipelineMajor ?? undefined,
    gold_kind: row.goldKind ?? undefined,
    adversarial_pair: row.adversarialPair ?? undefined,
    noise_profile: row.noiseProfile ?? undefined,
    approval_source: row.approvalSource ?? undefined,
    style_inferability_tier: row.styleInferabilityTier ?? undefined,
    style_evaluation_suite: row.styleEvaluationSuite ?? undefined,
    is_adversarial: row.isAdversarial ?? undefined,
    difficulty_tier: row.difficultyTier ?? undefined,
    task: options.task,
    truth_scope: options.truthScope,
    work_id: row.workId ?? undefined,
    family_id: row.familyId ?? undefined,
    variant_id: row.variantId ?? undefined,
    canonical_work_key: row.canonicalWorkKey ?? undefined,
    near_dup_cluster_id: row.nearDupClusterId ?? undefined,
    dataset_version: row.datasetVersion ?? undefined,
    holdout_version: row.holdoutVersion ?? undefined,
  };
}

const AUDIT_REASON_NOTE_PREFIX = "[audit_reason]";
const AUDIT_REASON_NOTE_REGEX = /^\[audit_reason\]\s+code=([a-z0-9_:-]+)\b/giu;
const TRUTH_AUDIT_REASON_SET = new Set<string>(truthAuditReasonSchema.options);

function appendAuditReasonToNotes(
  notes: string | null | undefined,
  auditReasonCode: TruthAuditReasonCode | null | undefined,
  actor: string | null | undefined,
): string | null {
  const normalizedNotes = notes?.trim() || "";
  if (!auditReasonCode) {
    return normalizedNotes || null;
  }

  const actorLabel = actor?.trim() || "unknown";
  const line = `${AUDIT_REASON_NOTE_PREFIX} code=${auditReasonCode} actor=${actorLabel} at=${new Date().toISOString()}`;
  const nextNotes = normalizedNotes ? `${normalizedNotes}\n\n${line}` : line;
  if (nextNotes.length > 8000) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      "Notes are too long after appending audit reason metadata.",
    );
  }
  return nextNotes;
}

function extractLatestAuditReasonCode(notes: string | null | undefined): TruthAuditReasonCode | null {
  if (!notes?.trim()) {
    return null;
  }
  const matches = [...notes.matchAll(AUDIT_REASON_NOTE_REGEX)];
  const latest = matches[matches.length - 1]?.[1];
  if (!latest || !TRUTH_AUDIT_REASON_SET.has(latest)) {
    return null;
  }
  return latest as TruthAuditReasonCode;
}

interface TruthDriftSummary {
  hasDrift: boolean;
  mismatchCount: number;
  missingInCore: string[];
  extraInCore: string[];
  valueMismatches: string[];
}

function normalizeTruthFieldRecord(
  value: Record<string, unknown> | null | undefined,
): Record<string, TruthFieldValue> {
  if (!value) {
    return {};
  }
  try {
    return normalizeExpectedTruthFields(value);
  } catch {
    return {};
  }
}

function buildTruthDriftSummary(row: Pick<StoredApprovedTruth, "expectedFields" | "coreTruth">): TruthDriftSummary {
  const expected = normalizeTruthFieldRecord(row.expectedFields ?? {});
  const core = normalizeTruthFieldRecord((row.coreTruth ?? row.expectedFields ?? {}) as Record<string, unknown>);
  const missingInCore: string[] = [];
  const extraInCore: string[] = [];
  const valueMismatches: string[] = [];
  const allKeys = new Set([...Object.keys(expected), ...Object.keys(core)]);

  for (const key of [...allKeys].sort((left, right) => left.localeCompare(right))) {
    const hasExpected = Object.prototype.hasOwnProperty.call(expected, key);
    const hasCore = Object.prototype.hasOwnProperty.call(core, key);
    if (hasExpected && !hasCore) {
      missingInCore.push(key);
      continue;
    }
    if (!hasExpected && hasCore) {
      extraInCore.push(key);
      continue;
    }
    if (JSON.stringify(expected[key]) !== JSON.stringify(core[key])) {
      valueMismatches.push(key);
    }
  }

  const mismatchCount = missingInCore.length + extraInCore.length + valueMismatches.length;
  return {
    hasDrift: mismatchCount > 0,
    mismatchCount,
    missingInCore,
    extraInCore,
    valueMismatches,
  };
}

function withTruthQualityMeta(row: StoredApprovedTruth) {
  const normalized = withLegacyCertification(row);
  return {
    ...normalized,
    truthDrift: buildTruthDriftSummary(normalized),
    auditReasonCode: extractLatestAuditReasonCode(normalized.notes ?? null),
  };
}

function resolveAuditActor(req: FastifyRequest, reviewedBy: string | null | undefined): string {
  const normalizedReviewer = reviewedBy?.trim();
  if (normalizedReviewer) {
    return normalizedReviewer;
  }
  return (req as FastifyRequest & { userId?: string }).userId ?? "unknown";
}

function resolveAuditActorUserId(req: FastifyRequest): string | null {
  const userId = (req as FastifyRequest & { userId?: string }).userId;
  if (!userId) {
    return null;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(userId)
    ? userId
    : null;
}

function emitTruthGovernanceAuditEvent(
  req: FastifyRequest,
  action: string,
  statusCode: number,
  metadata?: Record<string, unknown>,
): void {
  const actorUserId = resolveAuditActorUserId(req);
  void recordAuditEvent({
    ...(actorUserId ? { actorUserId } : {}),
    action,
    resource: '/internal/admin/approved-truth',
    correlationId: getCorrelationId(),
    statusCode,
    ...(metadata ? { metadata } : {}),
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeAuditComparableTruthRecord(
  value: Record<string, unknown> | null | undefined,
): Record<string, TruthFieldValue> {
  const normalized = normalizeTruthFieldRecord(value);
  return Object.fromEntries(
    Object.keys(normalized)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, normalized[key] as TruthFieldValue]),
  );
}

function isContentChangingPatch(
  existing: StoredApprovedTruth,
  patch: z.infer<typeof patchTruthSchema>,
): boolean {
  if (patch.rawText !== undefined && patch.rawText.trim() !== existing.rawText) {
    return true;
  }
  if (patch.expectedType !== undefined && (patch.expectedType ?? null) !== (existing.expectedType ?? null)) {
    return true;
  }
  if (patch.expectedStyle !== undefined && (patch.expectedStyle ?? null) !== (existing.expectedStyle ?? null)) {
    return true;
  }
  if (patch.overlayTruth !== undefined) {
    const currentOverlay = existing.overlayTruth ?? null;
    if (stableStringify(patch.overlayTruth ?? null) !== stableStringify(currentOverlay)) {
      return true;
    }
  }
  if (patch.expectedFields !== undefined) {
    const nextExpected = normalizeAuditComparableTruthRecord(patch.expectedFields);
    const currentExpected = normalizeAuditComparableTruthRecord(existing.expectedFields);
    if (stableStringify(nextExpected) !== stableStringify(currentExpected)) {
      return true;
    }
  }
  if (patch.coreTruth !== undefined) {
    const nextCore = normalizeAuditComparableTruthRecord(patch.coreTruth ?? {});
    const currentCore = normalizeAuditComparableTruthRecord(
      (existing.coreTruth ?? existing.expectedFields ?? {}) as Record<string, unknown>,
    );
    if (stableStringify(nextCore) !== stableStringify(currentCore)) {
      return true;
    }
  }
  return false;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function ensureRowStatusAndBlockedReason(
  rowStatus: StoredApprovedTruth['rowStatus'] | undefined,
  blockedReason: StoredApprovedTruth['blockedReason'] | null | undefined,
): void {
  if (rowStatus === 'quarantined' && !blockedReason) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'blockedReason is required when rowStatus is quarantined.',
    );
  }
  if (rowStatus !== 'quarantined' && blockedReason) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'blockedReason can only be set when rowStatus is quarantined.',
    );
  }
}

function ensureHoldoutVersion(
  datasetSplit: TruthDatasetSplit | null | undefined,
  holdoutVersion: string | null | undefined,
): void {
  const normalizedHoldoutVersion = holdoutVersion?.trim() || null;
  if (datasetSplit === 'holdout' && !normalizedHoldoutVersion) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'holdoutVersion is required when datasetSplit is holdout.',
    );
  }
  if (datasetSplit !== 'holdout' && normalizedHoldoutVersion) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'holdoutVersion can only be set when datasetSplit is holdout.',
    );
  }
}

function normalizeTaskCertifications(
  taskCertifications: TruthTaskCertification[] | null | undefined,
): TruthTaskCertification[] | null {
  if (!taskCertifications) {
    return null;
  }
  return taskCertifications.map((entry) => ({
    task: entry.task,
    truthScope: entry.truthScope,
    status: entry.status,
    certifiedAt: entry.certifiedAt ?? null,
    certifiedBy: entry.certifiedBy ?? null,
    requiredReviewPasses: entry.requiredReviewPasses,
    completedReviewPasses: entry.completedReviewPasses,
    pass1Hash: entry.pass1Hash ?? null,
    pass2Hash: entry.pass2Hash ?? null,
  }));
}

function hasCertifiedTask(taskCertifications: TruthTaskCertification[] | null | undefined): boolean {
  return (taskCertifications ?? []).some((entry) => entry.status === 'certified');
}

async function prefillApprovedTruthRow(id: string): Promise<TruthPrefillRowResult> {
  const existing = await getApprovedTruth(id);
  if (!existing) {
    return {
      id,
      status: 'failed',
      fieldCount: 0,
      message: 'Approved truth row not found.',
    };
  }

  try {
    const prefill = await runTruthPrefill(
      existing.rawText,
      resolveTruthPrefillOutputStyle(existing.expectedStyle ?? null),
    );
    const nextExpectedType = existing.expectedType ?? prefill.expectedType ?? null;
    const nextExpectedStyle = existing.expectedStyle ?? prefill.expectedStyle ?? null;
    const nextPipelineMajor = prefill.pipelineMajor ?? existing.pipelineMajor ?? null;
    const existingExpectedFields = normalizeExpectedTruthFields(existing.expectedFields ?? {});
    const existingCoreTruth = normalizeExpectedTruthFields(
      (existing.coreTruth ?? existing.expectedFields ?? {}) as Record<string, unknown>,
    );
    const unchanged =
      JSON.stringify(existingExpectedFields) === JSON.stringify(prefill.expectedFields)
      && JSON.stringify(existingCoreTruth) === JSON.stringify(prefill.coreTruth)
      && (existing.expectedType ?? null) === nextExpectedType
      && (existing.expectedStyle ?? null) === nextExpectedStyle
      && (existing.pipelineMajor ?? null) === nextPipelineMajor;

    if (unchanged) {
      return {
        id,
        status: 'unchanged',
        fieldCount: prefill.fieldCount,
        message: 'Engine output matched the truth already stored for this row.',
      };
    }

    let updated = await upsertApprovedTruthPayload({
      id: existing.id,
      rawText: existing.rawText,
      expectedFields: prefill.expectedFields,
      coreTruth: prefill.coreTruth,
      overlayTruth: existing.overlayTruth ?? null,
      expectedType: nextExpectedType,
      expectedStyle: nextExpectedStyle,
      provenance: existing.provenance ?? null,
      pipelineMajor: nextPipelineMajor,
      datasetSplit: existing.datasetSplit ?? null,
      trustLevel: existing.trustLevel,
      rowStatus: existing.rowStatus ?? legacyTrustToRowStatus(existing.trustLevel),
      blockedReason: existing.blockedReason ?? null,
      taskCertifications: existing.taskCertifications ?? null,
      workId: existing.workId ?? null,
      familyId: existing.familyId ?? null,
      variantId: existing.variantId ?? null,
      canonicalWorkKey: existing.canonicalWorkKey ?? null,
      nearDupClusterId: existing.nearDupClusterId ?? null,
      datasetVersion: existing.datasetVersion ?? null,
      inputProfile: existing.inputProfile ?? null,
      styleInferabilityTier: existing.styleInferabilityTier ?? null,
      styleEvaluationSuite: existing.styleEvaluationSuite ?? null,
      isAdversarial: existing.isAdversarial ?? null,
      difficultyTier: existing.difficultyTier ?? null,
      highImpact: existing.highImpact ?? null,
      highImpactReason: existing.highImpactReason ?? null,
      holdoutVersion: existing.holdoutVersion ?? null,
      inferabilityByField: existing.inferabilityByField ?? null,
      goldKind: existing.goldKind ?? null,
      adversarialPair: existing.adversarialPair ?? null,
      noiseProfile: existing.noiseProfile ?? null,
      approvalSource: existing.approvalSource ?? null,
      reviewedBy: existing.reviewedBy ?? null,
      notes: existing.notes ?? null,
    });
    let status: TruthPrefillRowResult['status'] = 'updated';
    let message: string | undefined;

    if (hasCertifiedTask(updated.taskCertifications)) {
      const lintIssues = await collectLintIssuesForCertifiedRow(withLegacyCertification(updated));
      if (lintIssues.length > 0) {
        updated = await quarantineRow(updated, lintIssues[0]?.blockedReason ?? 'needs_research');
        status = 'quarantined';
        message = lintIssues[0]?.message;
      }
    }

    return {
      id,
      status,
      fieldCount: prefill.fieldCount,
      ...(message ? { message } : {}),
    };
  } catch (error) {
    return {
      id,
      status: 'failed',
      fieldCount: 0,
      message: error instanceof Error ? error.message : 'Bulk truth prefill failed for this row.',
    };
  }
}

async function crossrefApprovedTruthRow(id: string): Promise<TruthCrossrefRowResult> {
  const existing = await getApprovedTruth(id);
  if (!existing) {
    return {
      id,
      status: 'failed',
      fieldCount: 0,
      message: 'Approved truth row not found.',
    };
  }

  try {
    const prefill = await runCrossrefTruthPrefill(
      existing.rawText,
      existing.expectedFields ?? {},
      existing.provenance ?? null,
    );
    let updated = await upsertApprovedTruthPayload({
      id: existing.id,
      rawText: existing.rawText,
      expectedFields: prefill.expectedFields,
      coreTruth: prefill.coreTruth,
      overlayTruth: existing.overlayTruth ?? null,
      expectedType: prefill.expectedType ?? existing.expectedType ?? null,
      expectedStyle: existing.expectedStyle ?? null,
      provenance: existing.provenance ?? null,
      pipelineMajor: existing.pipelineMajor ?? null,
      datasetSplit: existing.datasetSplit ?? null,
      trustLevel: existing.trustLevel,
      rowStatus: existing.rowStatus ?? legacyTrustToRowStatus(existing.trustLevel),
      blockedReason: existing.blockedReason ?? null,
      taskCertifications: existing.taskCertifications ?? null,
      workId: existing.workId ?? null,
      familyId: existing.familyId ?? null,
      variantId: existing.variantId ?? null,
      canonicalWorkKey: existing.canonicalWorkKey ?? null,
      nearDupClusterId: existing.nearDupClusterId ?? null,
      datasetVersion: existing.datasetVersion ?? null,
      inputProfile: existing.inputProfile ?? null,
      styleInferabilityTier: existing.styleInferabilityTier ?? null,
      styleEvaluationSuite: existing.styleEvaluationSuite ?? null,
      isAdversarial: existing.isAdversarial ?? null,
      difficultyTier: existing.difficultyTier ?? null,
      highImpact: existing.highImpact ?? null,
      highImpactReason: existing.highImpactReason ?? null,
      holdoutVersion: existing.holdoutVersion ?? null,
      inferabilityByField: existing.inferabilityByField ?? null,
      goldKind: existing.goldKind ?? null,
      adversarialPair: existing.adversarialPair ?? null,
      noiseProfile: existing.noiseProfile ?? null,
      approvalSource: existing.approvalSource ?? null,
      reviewedBy: existing.reviewedBy ?? null,
      notes: existing.notes ?? null,
    });
    let status: TruthCrossrefRowResult['status'] = 'updated';
    let message: string | undefined;

    if (hasCertifiedTask(updated.taskCertifications)) {
      const lintIssues = await collectLintIssuesForCertifiedRow(withLegacyCertification(updated));
      if (lintIssues.length > 0) {
        updated = await quarantineRow(updated, lintIssues[0]?.blockedReason ?? 'needs_research');
        status = 'quarantined';
        message = lintIssues[0]?.message;
      }
    }

    return {
      id,
      status,
      fieldCount: prefill.fieldCount,
      doi: prefill.matchedDoi,
      ...(message ? { message } : {}),
    };
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 409) {
      return {
        id,
        status: 'skipped',
        fieldCount: 0,
        message: error.message,
      };
    }

    return {
      id,
      status: 'failed',
      fieldCount: 0,
      message: error instanceof Error ? error.message : 'Bulk Crossref fill failed for this row.',
    };
  }
}

async function deleteApprovedTruthRow(id: string): Promise<TruthDeleteRowResult> {
  const deleted = await deleteApprovedTruth(id);
  if (deleted) {
    return { id, status: 'deleted' };
  }

  return {
    id,
    status: 'failed',
    message: 'Approved truth row not found.',
  };
}

async function certifyApprovedTruthRow(
  id: string,
  certificationInput: CertifyTruthInput,
): Promise<TruthCertifyRowResult> {
  const existing = await getApprovedTruth(id);
  if (!existing) {
    return {
      id,
      status: 'failed',
      message: 'Approved truth row not found.',
    };
  }

  try {
    const result = await applyTruthCertification(existing, certificationInput);
    if (!result.ok) {
      return {
        id,
        status: 'quarantined',
        message: result.message,
      };
    }

    return {
      id,
      status: 'certified',
      packTarget: result.stagedPack?.packTarget,
      stagedBundleId: result.stagedPack?.stagedBundleId,
      message: result.stagedPack
        ? `Staged into ${result.stagedPack.packTarget} (${result.stagedPack.rowCount} rows).`
        : undefined,
    };
  } catch (error) {
    return {
      id,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Bulk certification failed for this row.',
    };
  }
}

async function updateApprovedTruthRow(
  id: string,
  update: BulkTruthUpdateInput,
): Promise<TruthUpdateRowResult> {
  const existing = await getApprovedTruth(id);
  if (!existing) {
    return {
      id,
      status: 'failed',
      message: 'Approved truth row not found.',
    };
  }

  const nextTrustLevel = update.trustLevel ?? existing.trustLevel;
  const nextRowStatus =
    update.rowStatus
    ?? existing.rowStatus
    ?? legacyTrustToRowStatus(nextTrustLevel);
  const nextBlockedReason =
    update.rowStatus === undefined
      ? (existing.blockedReason ?? null)
      : update.rowStatus === 'quarantined'
        ? (update.blockedReason ?? null)
        : null;

  if (
    nextTrustLevel === existing.trustLevel
    && nextRowStatus === (existing.rowStatus ?? legacyTrustToRowStatus(existing.trustLevel))
    && nextBlockedReason === (existing.blockedReason ?? null)
  ) {
    return {
      id,
      status: 'unchanged',
      message: 'No trust or row-status changes were needed.',
    };
  }

  try {
    ensureRowStatusAndBlockedReason(nextRowStatus, nextBlockedReason);
    const updated = await upsertApprovedTruthPayload({
      id: existing.id,
      rawText: existing.rawText,
      expectedFields: existing.expectedFields,
      coreTruth: existing.coreTruth ?? null,
      overlayTruth: existing.overlayTruth ?? null,
      expectedType: existing.expectedType ?? null,
      expectedStyle: existing.expectedStyle ?? null,
      provenance: existing.provenance ?? null,
      pipelineMajor: existing.pipelineMajor ?? null,
      datasetSplit: existing.datasetSplit ?? null,
      trustLevel: nextTrustLevel,
      rowStatus: nextRowStatus,
      blockedReason: nextBlockedReason,
      taskCertifications: existing.taskCertifications ?? null,
      workId: existing.workId ?? null,
      familyId: existing.familyId ?? null,
      variantId: existing.variantId ?? null,
      canonicalWorkKey: existing.canonicalWorkKey ?? null,
      nearDupClusterId: existing.nearDupClusterId ?? null,
      datasetVersion: existing.datasetVersion ?? null,
      inputProfile: existing.inputProfile ?? null,
      styleInferabilityTier: existing.styleInferabilityTier ?? null,
      styleEvaluationSuite: existing.styleEvaluationSuite ?? null,
      isAdversarial: existing.isAdversarial ?? null,
      difficultyTier: existing.difficultyTier ?? null,
      highImpact: existing.highImpact ?? null,
      highImpactReason: existing.highImpactReason ?? null,
      holdoutVersion: existing.holdoutVersion ?? null,
      inferabilityByField: existing.inferabilityByField ?? null,
      goldKind: existing.goldKind ?? null,
      adversarialPair: existing.adversarialPair ?? null,
      noiseProfile: existing.noiseProfile ?? null,
      approvalSource: existing.approvalSource ?? null,
      reviewedBy: existing.reviewedBy ?? null,
      notes: existing.notes ?? null,
    });
    if (hasCertifiedTask(updated.taskCertifications)) {
      const lintIssues = await collectLintIssuesForCertifiedRow(withLegacyCertification(updated));
      if (lintIssues.length > 0) {
        await quarantineRow(updated, lintIssues[0]?.blockedReason ?? 'needs_research');
        return {
          id,
          status: 'quarantined',
          message: lintIssues[0]?.message ?? 'Certified row failed lint checks and was quarantined.',
        };
      }
    }

    return {
      id,
      status: 'updated',
      message: 'Trust and row status were updated.',
    };
  } catch (error) {
    return {
      id,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Bulk update failed for this row.',
    };
  }
}

function ensureSplitSealed(
  existing: StoredApprovedTruth | null,
  nextDatasetSplit: TruthDatasetSplit | null | undefined,
  nextHoldoutVersion: string | null | undefined,
): void {
  if (!existing) {
    return;
  }
  if (existing.datasetSplit && nextDatasetSplit && existing.datasetSplit !== nextDatasetSplit) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'datasetSplit is sealed once assigned. Create a new row for a different split.',
    );
  }
  void nextHoldoutVersion;
}

function ensureDatasetVersionSealed(
  existing: StoredApprovedTruth | null,
  nextDatasetVersion: string | null | undefined,
): void {
  if (!existing) {
    return;
  }
  const currentVersion = existing.datasetVersion ?? null;
  const incomingVersion = nextDatasetVersion ?? null;
  if (currentVersion && incomingVersion && currentVersion !== incomingVersion) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'datasetVersion is sealed once assigned. Create a new row to target a different frozen dataset version.',
    );
  }
  if (currentVersion && !incomingVersion) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'datasetVersion cannot be unset once assigned.',
    );
  }
}

function ensureAdversarialPairConsistency(
  goldKind: StoredApprovedTruth['goldKind'] | null | undefined,
  adversarialPair: string | null | undefined,
  expectedStyle: string | null | undefined,
): void {
  const normalizedPair = adversarialPair?.trim() || null;
  const normalizedStyle = expectedStyle?.trim() || null;
  if (goldKind === 'style_adversarial') {
    if (!normalizedPair) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'adversarialPair is required when goldKind is style_adversarial.',
      );
    }
    if (!REQUIRED_ADVERSARIAL_PAIRS.includes(normalizedPair as (typeof REQUIRED_ADVERSARIAL_PAIRS)[number])) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        `adversarialPair must be one of: ${REQUIRED_ADVERSARIAL_PAIRS.join(', ')}.`,
      );
    }
    const pairStyles = normalizedPair.split('_vs_').map((value) => value.trim()).filter(Boolean);
    if (pairStyles.length !== 2) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'adversarialPair must follow the format styleA_vs_styleB.',
      );
    }
    if (normalizedStyle && !pairStyles.includes(normalizedStyle)) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        `expectedStyle ${normalizedStyle} is not part of adversarialPair ${normalizedPair}.`,
      );
    }
  }
}

async function quarantineRow(
  row: StoredApprovedTruth,
  blockedReason: StoredApprovedTruth['blockedReason'],
): Promise<StoredApprovedTruth> {
  return upsertApprovedTruthPayload({
    id: row.id,
    rawText: row.rawText,
    expectedFields: row.expectedFields,
    coreTruth: row.coreTruth ?? null,
    overlayTruth: row.overlayTruth ?? null,
    expectedType: row.expectedType ?? null,
    expectedStyle: row.expectedStyle ?? null,
    provenance: row.provenance ?? null,
    pipelineMajor: row.pipelineMajor ?? null,
    datasetSplit: row.datasetSplit ?? null,
    trustLevel: row.trustLevel,
    rowStatus: 'quarantined',
    blockedReason: blockedReason ?? 'needs_research',
    taskCertifications: row.taskCertifications ?? null,
    workId: row.workId ?? null,
    familyId: row.familyId ?? null,
    variantId: row.variantId ?? null,
    canonicalWorkKey: row.canonicalWorkKey ?? null,
    nearDupClusterId: row.nearDupClusterId ?? null,
    datasetVersion: row.datasetVersion ?? null,
    inputProfile: row.inputProfile ?? null,
    styleInferabilityTier: row.styleInferabilityTier ?? null,
    styleEvaluationSuite: row.styleEvaluationSuite ?? null,
    isAdversarial: row.isAdversarial ?? null,
    difficultyTier: row.difficultyTier ?? null,
    highImpact: row.highImpact ?? null,
    highImpactReason: row.highImpactReason ?? null,
    holdoutVersion: row.holdoutVersion ?? null,
    inferabilityByField: row.inferabilityByField ?? null,
    goldKind: row.goldKind ?? null,
    adversarialPair: row.adversarialPair ?? null,
    noiseProfile: row.noiseProfile ?? null,
    approvalSource: row.approvalSource ?? null,
    reviewedBy: row.reviewedBy ?? null,
    notes: row.notes ?? null,
  });
}

async function collectLintIssuesForCertifiedRow(
  row: StoredApprovedTruth,
): Promise<ReturnType<typeof evaluateCertificationLint>> {
  const certifiedScopes = new Set<TruthScopeOption>();
  for (const certification of row.taskCertifications ?? []) {
    if (certification.status === 'certified') {
      certifiedScopes.add(certification.truthScope as TruthScopeOption);
    }
  }
  const lintIssues = [...certifiedScopes]
    .flatMap((truthScope) => evaluateCertificationLint(row, truthScope));
  if (certifiedScopes.size > 0) {
    const allRows = await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT });
    if (hasSplitLeakage(row, allRows)) {
      lintIssues.push({
        blockedReason: 'split_leakage',
        code: 'WORK_CLUSTER_SPLIT_LEAKAGE',
        message: 'canonicalWorkKey/workId/familyId/nearDupClusterId appears in multiple dataset splits.',
      });
    }
  }
  return lintIssues;
}

type ApplyTruthCertificationResult =
  | {
      ok: true;
      truth: StoredApprovedTruth;
      stagedPack?: {
        packTarget: TrainingPackTarget;
        stagedBundleId: string;
        rowCount: number;
      } | null;
    }
  | {
      ok: false;
      reason: 'review_conflict' | 'lint_failed';
      message: string;
      details: Record<string, unknown>;
      lintIssues?: ReturnType<typeof evaluateCertificationLint>;
      truth: StoredApprovedTruth;
    };

async function applyTruthCertification(
  existing: StoredApprovedTruth,
  data: CertifyTruthInput,
): Promise<ApplyTruthCertificationResult> {
  const row = withLegacyCertification(existing);
  const now = new Date().toISOString();
  const current = row.taskCertifications ?? [];
  const found = current.find((entry) => entry.task === data.task && entry.truthScope === data.truthScope) ?? null;

  const completedReviewPasses = data.completedReviewPasses ?? found?.completedReviewPasses ?? 0;
  const requiredReviewPassesBase = data.requiredReviewPasses ?? found?.requiredReviewPasses ?? 1;
  const requiredReviewPasses = requiredReviewPassesBase;
  const defaultDecisionHash = buildDecisionHash(row, data.truthScope);
  const incomingDecisionHash = data.decisionHash ?? null;

  if (completedReviewPasses >= 2 && !found?.pass1Hash) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'Blind pass 2 requires a previously stored pass-1 decision hash.',
    );
  }

  const pass1Hash = completedReviewPasses >= 1
    ? (found?.pass1Hash ?? incomingDecisionHash ?? defaultDecisionHash)
    : (found?.pass1Hash ?? null);
  const pass2Hash = completedReviewPasses >= 2
    ? (incomingDecisionHash ?? null)
    : (found?.pass2Hash ?? null);

  if (completedReviewPasses >= 2 && pass1Hash && pass2Hash && pass1Hash !== pass2Hash) {
    const quarantined = await quarantineRow(row, 'review_conflict');

    return {
      ok: false,
      reason: 'review_conflict',
      message: 'Blind pass 1 and pass 2 decision hashes do not match. Row was quarantined.',
      details: {
        blockedReason: 'review_conflict',
      },
      truth: quarantined,
    };
  }

  if (data.status === 'certified') {
    if (completedReviewPasses < requiredReviewPasses) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'Certification requires completedReviewPasses to meet requiredReviewPasses.',
      );
    }

    const allRows = await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT });
    const lintIssues = evaluateCertificationLint(row, data.truthScope);
    if (hasSplitLeakage(row, allRows)) {
      lintIssues.push({
        blockedReason: 'split_leakage',
        code: 'WORK_CLUSTER_SPLIT_LEAKAGE',
        message: 'canonicalWorkKey/workId/familyId/nearDupClusterId appears in multiple dataset splits.',
      });
    }
    if (lintIssues.length > 0) {
      const quarantined = await quarantineRow(row, lintIssues[0]?.blockedReason ?? 'needs_research');
      return {
        ok: false,
        reason: 'lint_failed',
        message: lintIssues[0]?.message ?? 'Certification lint failed; row was quarantined.',
        details: {
          blockedReason: lintIssues[0]?.blockedReason ?? 'needs_research',
          lintIssues,
        },
        lintIssues,
        truth: quarantined,
      };
    }
  }

  const packTarget = data.packTarget
    ?? defaultTrainingPackTargetForCertification({
      task: data.task,
      truthScope: data.truthScope,
    });

  const nextCertification: TruthTaskCertification = {
    task: data.task,
    truthScope: data.truthScope,
    status: data.status,
    certifiedAt: data.status === 'certified' ? now : null,
    certifiedBy: data.status === 'certified' ? (data.certifiedBy ?? row.reviewedBy ?? 'admin') : null,
    requiredReviewPasses,
    completedReviewPasses,
    pass1Hash,
    pass2Hash,
    packTarget: data.status === 'certified' ? packTarget : null,
    stagedBundleId: found?.stagedBundleId ?? null,
    stagedAt: found?.stagedAt ?? null,
  };

  const updated = await upsertApprovedTruthPayload({
    id: row.id,
    rawText: row.rawText,
    expectedFields: row.expectedFields,
    coreTruth: row.coreTruth ?? null,
    overlayTruth: row.overlayTruth ?? null,
    expectedType: row.expectedType ?? null,
    expectedStyle: row.expectedStyle ?? null,
    provenance: row.provenance ?? null,
    pipelineMajor: row.pipelineMajor ?? null,
    datasetSplit: row.datasetSplit ?? null,
    trustLevel: row.trustLevel,
    rowStatus: row.rowStatus === 'quarantined' ? 'reviewed' : (row.rowStatus ?? 'reviewed'),
    blockedReason: row.rowStatus === 'quarantined' ? null : (row.blockedReason ?? null),
    taskCertifications: setTaskCertification(row, nextCertification),
    workId: row.workId ?? null,
    familyId: row.familyId ?? null,
    variantId: row.variantId ?? null,
    canonicalWorkKey: row.canonicalWorkKey ?? null,
    nearDupClusterId: row.nearDupClusterId ?? null,
    datasetVersion: row.datasetVersion ?? null,
    inputProfile: row.inputProfile ?? null,
    styleInferabilityTier: row.styleInferabilityTier ?? null,
    styleEvaluationSuite: row.styleEvaluationSuite ?? null,
    isAdversarial: row.isAdversarial ?? null,
    difficultyTier: row.difficultyTier ?? null,
    highImpact: row.highImpact ?? null,
    highImpactReason: row.highImpactReason ?? null,
    holdoutVersion: row.holdoutVersion ?? null,
    inferabilityByField: row.inferabilityByField ?? null,
    goldKind: row.goldKind ?? null,
    adversarialPair: row.adversarialPair ?? null,
    noiseProfile: row.noiseProfile ?? null,
    approvalSource: row.approvalSource ?? null,
    reviewedBy: row.reviewedBy ?? null,
    notes: row.notes ?? null,
  });

  if (data.status !== 'certified') {
    return {
      ok: true,
      truth: updated,
      stagedPack: null,
    };
  }

  const stagedManifest = await writeStagedTrainingPack({
    packTarget,
    rows: await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT }),
  });
  const stagedCertification: TruthTaskCertification = {
    ...nextCertification,
    stagedBundleId: stagedManifest.stagedBundleId,
    stagedAt: stagedManifest.createdAt,
  };
  const stagedTruth = await upsertApprovedTruthPayload({
    id: updated.id,
    rawText: updated.rawText,
    expectedFields: updated.expectedFields,
    coreTruth: updated.coreTruth ?? null,
    overlayTruth: updated.overlayTruth ?? null,
    expectedType: updated.expectedType ?? null,
    expectedStyle: updated.expectedStyle ?? null,
    provenance: updated.provenance ?? null,
    pipelineMajor: updated.pipelineMajor ?? null,
    datasetSplit: updated.datasetSplit ?? null,
    trustLevel: updated.trustLevel,
    rowStatus: updated.rowStatus ?? 'reviewed',
    blockedReason: updated.blockedReason ?? null,
    taskCertifications: setTaskCertification(updated, stagedCertification),
    workId: updated.workId ?? null,
    familyId: updated.familyId ?? null,
    variantId: updated.variantId ?? null,
    canonicalWorkKey: updated.canonicalWorkKey ?? null,
    nearDupClusterId: updated.nearDupClusterId ?? null,
    datasetVersion: updated.datasetVersion ?? null,
    inputProfile: updated.inputProfile ?? null,
    styleInferabilityTier: updated.styleInferabilityTier ?? null,
    styleEvaluationSuite: updated.styleEvaluationSuite ?? null,
    isAdversarial: updated.isAdversarial ?? null,
    difficultyTier: updated.difficultyTier ?? null,
    highImpact: updated.highImpact ?? null,
    highImpactReason: updated.highImpactReason ?? null,
    holdoutVersion: updated.holdoutVersion ?? null,
    inferabilityByField: updated.inferabilityByField ?? null,
    goldKind: updated.goldKind ?? null,
    adversarialPair: updated.adversarialPair ?? null,
    noiseProfile: updated.noiseProfile ?? null,
    approvalSource: updated.approvalSource ?? null,
    reviewedBy: updated.reviewedBy ?? null,
    notes: updated.notes ?? null,
  });

  return {
    ok: true,
    truth: stagedTruth,
    stagedPack: {
      packTarget,
      stagedBundleId: stagedManifest.stagedBundleId,
      rowCount: stagedManifest.rowCount,
    },
  };
}

function buildDatasetVersion(date = new Date()): string {
  return `style-core-${date.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')}`;
}

function buildFreezeStatusCode(result: ReturnType<typeof buildStyleCoreFreezeSelection>): number {
  return result.failures.length > 0 ? 409 : 200;
}

export function registerAdminTruthRoutes(app: FastifyInstance): void {
  app.post("/admin/approved-truth/prefill", async (req, reply) => {
    const parsed = truthPrefillSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid truth prefill payload.", {
        issues: parsed.error.flatten(),
      });
    }

    const prefill = await runTruthPrefill(parsed.data.rawText, parsed.data.outputStyle);
    return reply.status(200).send(prefill);
  });

  app.post("/admin/approved-truth/crossref-prefill", async (req, reply) => {
    const parsed = truthCrossrefPrefillSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid Crossref prefill payload.", {
        issues: parsed.error.flatten(),
      });
    }

    const prefill = await runCrossrefTruthPrefill(
      parsed.data.rawText,
      parsed.data.expectedFields,
      parsed.data.provenance ?? null,
    );
    return reply.status(200).send(prefill);
  });

  app.post("/admin/approved-truth/render-preview", async (req, reply) => {
    const parsed = truthRenderPreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid truth render preview payload.", {
        issues: parsed.error.flatten(),
      });
    }

    const preview = await runTruthRenderPreview({
      rawText: parsed.data.rawText,
      expectedFields: parsed.data.expectedFields,
      expectedType: parsed.data.expectedType ?? null,
      expectedStyle: parsed.data.expectedStyle,
    });
    return reply.status(200).send(preview);
  });

  app.post("/admin/approved-truth/prefill-bulk", async (req, reply) => {
    const parsed = truthBulkPrefillSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'Invalid bulk truth prefill payload.',
        {
          issues: parsed.error.flatten(),
        },
      );
    }

    const ids = [...new Set(parsed.data.ids)];
    const results: TruthPrefillRowResult[] = [];
    for (const id of ids) {
      results.push(await prefillApprovedTruthRow(id));
    }

    const updatedCount = results.filter((result) => result.status === 'updated').length;
    const unchangedCount = results.filter((result) => result.status === 'unchanged').length;
    const quarantinedCount = results.filter((result) => result.status === 'quarantined').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    return reply.status(200).send({
      requestedCount: ids.length,
      updatedCount,
      unchangedCount,
      quarantinedCount,
      failedCount,
      results,
    });
  });

  app.post("/admin/approved-truth/crossref-bulk", async (req, reply) => {
    const parsed = truthBulkCrossrefSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'Invalid bulk Crossref fill payload.',
        {
          issues: parsed.error.flatten(),
        },
      );
    }

    const ids = [...new Set(parsed.data.ids)];
    const results: TruthCrossrefRowResult[] = [];
    for (const id of ids) {
      results.push(await crossrefApprovedTruthRow(id));
    }

    const updatedCount = results.filter((result) => result.status === 'updated').length;
    const quarantinedCount = results.filter((result) => result.status === 'quarantined').length;
    const skippedCount = results.filter((result) => result.status === 'skipped').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    return reply.status(200).send({
      requestedCount: ids.length,
      updatedCount,
      quarantinedCount,
      skippedCount,
      failedCount,
      results,
    });
  });

  app.post("/admin/approved-truth/update-bulk", async (req, reply) => {
    const parsed = truthBulkUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'Invalid bulk approved-truth update payload.',
        {
          issues: parsed.error.flatten(),
        },
      );
    }

    const ids = [...new Set(parsed.data.ids)];
    const updateInput: BulkTruthUpdateInput = {
      ...(parsed.data.trustLevel ? { trustLevel: parsed.data.trustLevel } : {}),
      ...(parsed.data.rowStatus ? { rowStatus: parsed.data.rowStatus } : {}),
      ...(parsed.data.blockedReason !== undefined ? { blockedReason: parsed.data.blockedReason } : {}),
    };
    const results: TruthUpdateRowResult[] = [];
    for (const id of ids) {
      results.push(await updateApprovedTruthRow(id, updateInput));
    }

    const updatedCount = results.filter((result) => result.status === 'updated').length;
    const unchangedCount = results.filter((result) => result.status === 'unchanged').length;
    const quarantinedCount = results.filter((result) => result.status === 'quarantined').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    return reply.status(200).send({
      requestedCount: ids.length,
      updatedCount,
      unchangedCount,
      quarantinedCount,
      failedCount,
      results,
    });
  });

  app.post("/admin/approved-truth/delete-bulk", async (req, reply) => {
    const parsed = truthBulkDeleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'Invalid bulk truth delete payload.',
        {
          issues: parsed.error.flatten(),
        },
      );
    }

    const ids = [...new Set(parsed.data.ids)];
    const results: TruthDeleteRowResult[] = [];
    for (const id of ids) {
      results.push(await deleteApprovedTruthRow(id));
    }

    const deletedCount = results.filter((result) => result.status === 'deleted').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    return reply.status(200).send({
      requestedCount: ids.length,
      deletedCount,
      failedCount,
      results,
    });
  });

  app.post('/admin/approved-truth/background-bulk', async (req, reply) => {
    const parsed = truthBackgroundBulkSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid truth background job payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const filters = normalizeApprovedTruthFilters(parsed.data.filters);
    const selectedIds = parsed.data.ids ? [...new Set(parsed.data.ids)] : null;
    const filteredRows = selectedIds
      ? (await Promise.all(selectedIds.map((id) => getApprovedTruth(id)))).filter(
          (row): row is StoredApprovedTruth => Boolean(row),
        )
      : await loadApprovedTruthRowsForFilters(filters);
    const rows = selectedIds
      ? filteredRows
      : sliceApprovedTruthRowsForPageRange(
          filteredRows,
          parsed.data.pageSize,
          (parsed.data.pageRange as TruthBackgroundPageRangeInput | null | undefined) ?? null,
        );
    if (rows.length < 1) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        parsed.data.pageRange
          ? 'No approved-truth rows fall within the selected page range.'
          : 'Select at least one approved-truth row before starting a background bulk job.',
      );
    }

    const job = createTruthBackgroundJob(
      parsed.data.operation,
      filters,
      parsed.data.pageSize,
      rows.map((row) => row.id),
      parsed.data.operation === 'certify' ? (parsed.data.certify as CertifyTruthInput) : null,
      parsed.data.operation === 'update' ? (parsed.data.update as BulkTruthUpdateInput) : null,
    );

    if (usesPersistentTruthBackgroundJobs()) {
      await saveTruthBackgroundJobState(job);
      queueMicrotask(() => {
        void processTruthBackgroundJob(job.id);
      });
    } else {
      truthBackgroundJobs.set(job.id, job);
      queueMicrotask(() => {
        void processTruthBackgroundJob(job.id);
      });
    }

    return reply.status(202).send(summarizeTruthBackgroundJob(job));
  });

  app.get('/admin/approved-truth/background-bulk/:jobId', async (req, reply) => {
    const jobId = (req.params as { jobId: string }).jobId;
    const inMemoryJob = truthBackgroundJobs.get(jobId);
    if (inMemoryJob) {
      return reply.status(200).send(summarizeTruthBackgroundJob(inMemoryJob));
    }

    const persistedJob = await loadTruthBackgroundJobSummary(jobId);
    if (persistedJob) {
      return reply.status(200).send(persistedJob);
    }

    throw new AppError(404, ErrorCode.NOT_FOUND, 'Approved-truth background job not found.');
  });

  app.get('/admin/approved-truth/editor-draft', async (req, reply) => {
    const userId = requireAdminUserId(req);
    const draft = await getApprovedTruthEditorDraft(userId);
    return reply.status(200).send(serializeTruthEditorDraftResponse(draft));
  });

  app.put('/admin/approved-truth/editor-draft', async (req, reply) => {
    const userId = requireAdminUserId(req);
    const parsed = truthEditorDraftPayloadSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid approved-truth editor draft payload.', {
        issues: parsed.error.flatten(),
      });
    }
    const draft = await upsertApprovedTruthEditorDraft({
      userId,
      payload: parsed.data as ApprovedTruthEditorDraftPayload,
    });
    return reply.status(200).send(serializeTruthEditorDraftResponse(draft));
  });

  app.delete('/admin/approved-truth/editor-draft', async (req, reply) => {
    const userId = requireAdminUserId(req);
    const deleted = await deleteApprovedTruthEditorDraft(userId);
    return reply.status(200).send({
      ok: true as const,
      deleted,
      persistenceBackend: runtimePersistenceBackend,
      durable: runtimePersistenceBackend === 'database',
    });
  });

  app.get("/admin/approved-truth", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const certificationView = q.certificationView ?? "certified";
    if (certificationView !== "pending" && certificationView !== "certified") {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        "certificationView must be pending or certified.",
      );
    }
    const filters: ApprovedTruthListFilters = normalizeApprovedTruthFilters({
      trustLevel: q.trustLevel as TruthTrustLevel | undefined,
      datasetSplit: q.datasetSplit as TruthDatasetSplit | undefined,
      rowStatus: q.rowStatus as StoredApprovedTruth['rowStatus'] | undefined,
      goldKind: q.goldKind as NonNullable<StoredApprovedTruth['goldKind']> | undefined,
      expectedStyle: q.expectedStyle,
      adversarialPair: q.adversarialPair,
      datasetVersion: q.datasetVersion,
      styleEvaluationSuite:
        q.styleEvaluationSuite as NonNullable<StoredApprovedTruth['styleEvaluationSuite']> | undefined,
      certificationView,
    });
    const page = parsePositiveInt(q.page, 1);
    const limit = Math.min(parsePositiveInt(q.limit, 25), 100);
    const rows = await loadApprovedTruthRowsForFilters(filters);
    const start = (page - 1) * limit;
    const items = rows.slice(start, start + limit).map((row) => withTruthQualityMeta(row));
    return reply.status(200).send({
      items,
      page,
      limit,
      total: rows.length,
      totalPages: rows.length === 0 ? 0 : Math.ceil(rows.length / limit),
    });
  });

  app.get("/admin/approved-truth/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await getApprovedTruth(id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Approved truth row not found.");
    }
    return reply.status(200).send(withTruthQualityMeta(row));
  });

  app.get('/admin/approved-truth/:id/render-variants', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await getApprovedTruth(id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Approved truth row not found.');
    }
    const items = await listApprovedTruthRenderVariants(row.id);
    return reply.status(200).send({
      truthRowId: row.id,
      items,
      styleOrder: approvedTruthRenderVariantStyleValues,
      rendererVersion: buildTruthRenderVariantRendererVersion(row.pipelineMajor ?? null),
    });
  });

  app.post('/admin/approved-truth/:id/render-variants/generate', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await getApprovedTruth(id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Approved truth row not found.');
    }
    const parsed = truthRenderVariantGenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid render-variant generation payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const styles = listTruthRenderVariantStyles(parsed.data.styles);
    const items: StoredApprovedTruthRenderVariant[] = [];
    for (const style of styles) {
      const existing = await getApprovedTruthRenderVariant(row.id, style);
      const nextVariant = await buildGeneratedTruthRenderVariant({
        row,
        style,
        existing,
        phase12ContractVersion: phase12Render.contractVersion,
        renderPreview: runTruthRenderPreview,
      });
      const saved = await upsertApprovedTruthRenderVariant(nextVariant);
      items.push(saved);
    }

    return reply.status(200).send({
      truthRowId: row.id,
      items,
      styleOrder: approvedTruthRenderVariantStyleValues,
      rendererVersion: buildTruthRenderVariantRendererVersion(row.pipelineMajor ?? null),
    });
  });

  app.patch('/admin/approved-truth/:id/render-variants/:style', async (req, reply) => {
    const params = req.params as { id: string; style: TruthRenderVariantStyle };
    const row = await getApprovedTruth(params.id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Approved truth row not found.');
    }
    const style = approvedTruthRenderVariantStyleSchema.parse(params.style);
    const parsed = truthRenderVariantPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid render-variant patch payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const existing = await getApprovedTruthRenderVariant(row.id, style);
    const baseline =
      existing ??
      (await buildGeneratedTruthRenderVariant({
        row,
        style,
        phase12ContractVersion: phase12Render.contractVersion,
        renderPreview: runTruthRenderPreview,
      }));
    const now = new Date().toISOString();
    const saved = await upsertApprovedTruthRenderVariant({
      id: baseline.id,
      truthRowId: row.id,
      style,
      generatedText: baseline.generatedText,
      renderedText: parsed.data.renderedText,
      sourceKind: 'admin_authored',
      approvalStatus: baseline.approvalStatus === 'approved' ? 'reviewed' : baseline.approvalStatus === 'draft' ? 'reviewed' : baseline.approvalStatus,
      qualityTier: baseline.qualityTier,
      datasetLane: baseline.datasetLane,
      rendererVersion: baseline.rendererVersion,
      stale: false,
      generatedAt: baseline.generatedAt,
      approvedAt: null,
      approvedBy: null,
      notes: parsed.data.notes ?? baseline.notes ?? null,
    });

    return reply.status(200).send({
      truthRowId: row.id,
      item: {
        ...saved,
        updatedAt: now,
      },
    });
  });

  app.post('/admin/approved-truth/:id/render-variants/:style/approve', async (req, reply) => {
    const params = req.params as { id: string; style: TruthRenderVariantStyle };
    const row = await getApprovedTruth(params.id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Approved truth row not found.');
    }
    const style = approvedTruthRenderVariantStyleSchema.parse(params.style);
    const parsed = truthRenderVariantApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid render-variant approval payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const existing = await getApprovedTruthRenderVariant(row.id, style);
    if (!existing) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Render variant not found. Generate it first.');
    }

    const approved = parsed.data.approved ?? true;
    const now = new Date().toISOString();
    const saved = await upsertApprovedTruthRenderVariant({
      ...existing,
      approvalStatus: approved ? 'approved' : 'reviewed',
      stale: approved ? false : existing.stale,
      approvedAt: approved ? now : null,
      approvedBy: approved ? parsed.data.approvedBy ?? resolveAuditActor(req, null) : null,
      notes: existing.notes ?? null,
    });

    return reply.status(200).send({
      truthRowId: row.id,
      item: saved,
    });
  });

  app.post('/admin/approved-truth/:id/render-variants/:style/reset', async (req, reply) => {
    const params = req.params as { id: string; style: TruthRenderVariantStyle };
    const row = await getApprovedTruth(params.id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Approved truth row not found.');
    }
    const style = approvedTruthRenderVariantStyleSchema.parse(params.style);
    const existing = await getApprovedTruthRenderVariant(row.id, style);
    const generated = await buildGeneratedTruthRenderVariant({
      row,
      style,
      existing,
      phase12ContractVersion: phase12Render.contractVersion,
      renderPreview: runTruthRenderPreview,
    });
    const saved = await upsertApprovedTruthRenderVariant({
      ...generated,
      renderedText: generated.generatedText,
      sourceKind: 'generated',
      approvalStatus: 'draft',
      stale: false,
      approvedAt: null,
      approvedBy: null,
    });

    return reply.status(200).send({
      truthRowId: row.id,
      item: saved,
    });
  });

  app.post("/admin/approved-truth", async (req, reply) => {
    const parsed = createTruthSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid approved truth payload.", {
        issues: parsed.error.flatten(),
      });
    }
    const d = parsed.data;
    const rawText = normalizeAdminTruthRawText(d.rawText);
    const allRows = await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT });
    const existingByRawText = findApprovedTruthByAdminRawText(allRows, rawText);
    const initialSeed = await resolveInitialApprovedTruthSeed({
      rawText,
      expectedFields: d.expectedFields,
      coreTruth: d.coreTruth ?? null,
      expectedType: d.expectedType ?? null,
      expectedStyle: d.expectedStyle ?? null,
      pipelineMajor: d.pipelineMajor ?? null,
    });
    const notesWithAudit = appendAuditReasonToNotes(
      d.notes ?? null,
      d.auditReasonCode ?? null,
      resolveAuditActor(req, d.reviewedBy ?? null),
    );
    const rowStatus = d.rowStatus ?? legacyTrustToRowStatus(d.trustLevel ?? 'draft');
    const normalizedTaskCertifications = normalizeTaskCertifications(d.taskCertifications);
    ensureRowStatusAndBlockedReason(rowStatus, d.blockedReason ?? null);
    ensureHoldoutVersion(d.datasetSplit ?? null, d.holdoutVersion ?? null);
    ensureSplitSealed(existingByRawText, d.datasetSplit ?? null, null);
    ensureDatasetVersionSealed(existingByRawText, d.datasetVersion ?? null);
    ensureAdversarialPairConsistency(
      d.goldKind ?? null,
      d.adversarialPair ?? null,
      initialSeed.expectedStyle,
    );
    let row: StoredApprovedTruth;
    try {
      row = await upsertApprovedTruthPayload({
        ...(existingByRawText?.id ? { id: existingByRawText.id } : {}),
        rawText,
        expectedFields: initialSeed.expectedFields,
        coreTruth: initialSeed.coreTruth,
        overlayTruth: d.overlayTruth ?? null,
        expectedType: initialSeed.expectedType,
        expectedStyle: initialSeed.expectedStyle,
        provenance: d.provenance ?? null,
        pipelineMajor: initialSeed.pipelineMajor,
        datasetSplit: d.datasetSplit ?? null,
        holdoutVersion: d.holdoutVersion ?? null,
        trustLevel: d.trustLevel ?? "draft",
        rowStatus,
        blockedReason: d.blockedReason ?? null,
        taskCertifications: normalizedTaskCertifications,
        workId: d.workId ?? null,
        familyId: d.familyId ?? null,
        variantId: d.variantId ?? null,
        canonicalWorkKey: d.canonicalWorkKey ?? null,
        nearDupClusterId: d.nearDupClusterId ?? null,
        datasetVersion: d.datasetVersion ?? null,
        inputProfile: d.inputProfile ?? null,
        styleInferabilityTier: d.styleInferabilityTier ?? null,
        styleEvaluationSuite: d.styleEvaluationSuite ?? null,
        isAdversarial: d.isAdversarial ?? null,
        difficultyTier: d.difficultyTier ?? null,
        highImpact: d.highImpact ?? null,
        highImpactReason: d.highImpactReason ?? null,
        inferabilityByField: d.inferabilityByField ?? null,
        goldKind: d.goldKind ?? null,
        adversarialPair: d.adversarialPair ?? null,
        noiseProfile: d.noiseProfile ?? null,
        approvalSource: d.approvalSource ?? null,
        reviewedBy: d.reviewedBy ?? null,
        notes: notesWithAudit,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, error.message);
      }
      throw error;
    }
    if (hasCertifiedTask(row.taskCertifications)) {
      const lintIssues = await collectLintIssuesForCertifiedRow(withLegacyCertification(row));
      if (lintIssues.length > 0) {
        const quarantined = await quarantineRow(row, lintIssues[0]?.blockedReason ?? 'needs_research');
        return reply.status(409).send({
          ok: false as const,
          reason: 'lint_failed',
          lintIssues,
          truth: withTruthQualityMeta(quarantined),
        });
      }
    }
    return reply.status(201).send(withTruthQualityMeta(row));
  });

  app.patch("/admin/approved-truth/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = patchTruthSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid patch payload.", {
        issues: parsed.error.flatten(),
      });
    }
    const normalizedPatchRawText =
      typeof parsed.data.rawText === 'string' && parsed.data.rawText.trim().length > 0
        ? normalizeAdminTruthRawText(parsed.data.rawText)
        : null;
    let existing = await getApprovedTruth(id);
    if (!existing && normalizedPatchRawText) {
      existing = findApprovedTruthByAdminRawText(
        await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT }),
        normalizedPatchRawText,
      );
    }
    if (!existing) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Approved truth row not found.");
    }
    const contentChangingPatch = isContentChangingPatch(existing, parsed.data);
    if (contentChangingPatch && !parsed.data.auditReasonCode) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        "auditReasonCode is required for content-changing truth edits.",
      );
    }
    const mergedRawText =
      parsed.data.rawText !== undefined ? (normalizedPatchRawText ?? existing.rawText) : existing.rawText;
    const merged = { ...existing, ...parsed.data, rawText: mergedRawText };
    const notesWithAudit = appendAuditReasonToNotes(
      merged.notes ?? null,
      parsed.data.auditReasonCode ?? null,
      resolveAuditActor(req, merged.reviewedBy ?? null),
    );
    const nextExpectedFields = merged.expectedFields ?? existing.expectedFields;
    const nextCoreTruth =
      parsed.data.coreTruth !== undefined
        ? parsed.data.coreTruth
        : parsed.data.expectedFields !== undefined
          ? nextExpectedFields
          : (existing.coreTruth ?? existing.expectedFields ?? null);
    const mergedStatus = merged.rowStatus ?? existing.rowStatus ?? legacyTrustToRowStatus((merged.trustLevel ?? existing.trustLevel) as TruthTrustLevel);
    const mergedBlockedReason = merged.blockedReason ?? existing.blockedReason ?? null;
    const mergedTaskCertifications = normalizeTaskCertifications(
      merged.taskCertifications ?? existing.taskCertifications ?? null,
    );
    ensureRowStatusAndBlockedReason(mergedStatus, mergedBlockedReason);
    ensureHoldoutVersion((merged.datasetSplit ?? existing.datasetSplit) ?? null, (merged.holdoutVersion ?? existing.holdoutVersion) ?? null);
    ensureSplitSealed(
      existing,
      (merged.datasetSplit ?? existing.datasetSplit) ?? null,
      (merged.holdoutVersion ?? existing.holdoutVersion) ?? null,
    );
    ensureDatasetVersionSealed(
      existing,
      (merged.datasetVersion ?? existing.datasetVersion) ?? null,
    );
    ensureAdversarialPairConsistency(
      (merged.goldKind ?? existing.goldKind) ?? null,
      (merged.adversarialPair ?? existing.adversarialPair) ?? null,
      (merged.expectedStyle ?? existing.expectedStyle) ?? null,
    );
    let row: StoredApprovedTruth;
    try {
      row = await upsertApprovedTruthPayload({
        id: merged.id,
        rawText: mergedRawText,
        expectedFields: nextExpectedFields,
        coreTruth: nextCoreTruth,
        overlayTruth: merged.overlayTruth ?? existing.overlayTruth ?? null,
        expectedType: merged.expectedType ?? null,
        expectedStyle: merged.expectedStyle ?? null,
        provenance: merged.provenance ?? null,
        pipelineMajor: merged.pipelineMajor ?? null,
        datasetSplit: merged.datasetSplit ?? null,
        trustLevel: merged.trustLevel ?? existing.trustLevel,
        rowStatus: mergedStatus,
        blockedReason: mergedBlockedReason,
        taskCertifications: mergedTaskCertifications,
        workId: merged.workId ?? existing.workId ?? null,
        familyId: merged.familyId ?? existing.familyId ?? null,
        variantId: merged.variantId ?? existing.variantId ?? null,
        canonicalWorkKey: merged.canonicalWorkKey ?? existing.canonicalWorkKey ?? null,
        nearDupClusterId: merged.nearDupClusterId ?? existing.nearDupClusterId ?? null,
        datasetVersion: merged.datasetVersion ?? existing.datasetVersion ?? null,
        inputProfile: merged.inputProfile ?? existing.inputProfile ?? null,
        styleInferabilityTier: merged.styleInferabilityTier ?? existing.styleInferabilityTier ?? null,
        styleEvaluationSuite: merged.styleEvaluationSuite ?? existing.styleEvaluationSuite ?? null,
        isAdversarial: merged.isAdversarial ?? existing.isAdversarial ?? null,
        difficultyTier: merged.difficultyTier ?? existing.difficultyTier ?? null,
        highImpact: merged.highImpact ?? existing.highImpact ?? null,
        highImpactReason: merged.highImpactReason ?? existing.highImpactReason ?? null,
        holdoutVersion: merged.holdoutVersion ?? existing.holdoutVersion ?? null,
        inferabilityByField: merged.inferabilityByField ?? existing.inferabilityByField ?? null,
        goldKind: merged.goldKind ?? existing.goldKind ?? null,
        adversarialPair: merged.adversarialPair ?? existing.adversarialPair ?? null,
        noiseProfile: merged.noiseProfile ?? existing.noiseProfile ?? null,
        approvalSource: merged.approvalSource ?? existing.approvalSource ?? null,
        reviewedBy: merged.reviewedBy ?? null,
        notes: notesWithAudit,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, error.message);
      }
      throw error;
    }
    if (hasCertifiedTask(row.taskCertifications)) {
      const lintIssues = await collectLintIssuesForCertifiedRow(withLegacyCertification(row));
      if (lintIssues.length > 0) {
        const quarantined = await quarantineRow(row, lintIssues[0]?.blockedReason ?? 'needs_research');
        return reply.status(409).send({
          ok: false as const,
          reason: 'lint_failed',
          lintIssues,
          truth: withTruthQualityMeta(quarantined),
        });
      }
    }
    return reply.status(200).send(withTruthQualityMeta(row));
  });

  app.post("/admin/approved-truth/:id/sync-core", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = syncCoreTruthSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid sync-core payload.", {
        issues: parsed.error.flatten(),
      });
    }

    const existing = await getApprovedTruth(id);
    if (!existing) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Approved truth row not found.");
    }

    const drift = buildTruthDriftSummary(existing);
    if (!drift.hasDrift) {
      return reply.status(200).send({
        synced: false as const,
        truth: withTruthQualityMeta(existing),
      });
    }

    const nextReviewedBy = parsed.data.reviewedBy ?? existing.reviewedBy ?? null;
    const notesWithAudit = appendAuditReasonToNotes(
      parsed.data.notes ?? existing.notes ?? null,
      parsed.data.auditReasonCode,
      resolveAuditActor(req, nextReviewedBy),
    );

    const row = await upsertApprovedTruthPayload({
      id: existing.id,
      rawText: existing.rawText,
      expectedFields: existing.expectedFields,
      coreTruth: existing.expectedFields,
      overlayTruth: existing.overlayTruth ?? null,
      expectedType: existing.expectedType ?? null,
      expectedStyle: existing.expectedStyle ?? null,
      provenance: existing.provenance ?? null,
      pipelineMajor: existing.pipelineMajor ?? null,
      datasetSplit: existing.datasetSplit ?? null,
      trustLevel: existing.trustLevel,
      rowStatus: existing.rowStatus ?? legacyTrustToRowStatus(existing.trustLevel),
      blockedReason: existing.blockedReason ?? null,
      taskCertifications: normalizeTaskCertifications(existing.taskCertifications),
      workId: existing.workId ?? null,
      familyId: existing.familyId ?? null,
      variantId: existing.variantId ?? null,
      canonicalWorkKey: existing.canonicalWorkKey ?? null,
      nearDupClusterId: existing.nearDupClusterId ?? null,
      datasetVersion: existing.datasetVersion ?? null,
      inputProfile: existing.inputProfile ?? null,
      styleInferabilityTier: existing.styleInferabilityTier ?? null,
      styleEvaluationSuite: existing.styleEvaluationSuite ?? null,
      isAdversarial: existing.isAdversarial ?? null,
      difficultyTier: existing.difficultyTier ?? null,
      highImpact: existing.highImpact ?? null,
      highImpactReason: existing.highImpactReason ?? null,
      holdoutVersion: existing.holdoutVersion ?? null,
      inferabilityByField: existing.inferabilityByField ?? null,
      goldKind: existing.goldKind ?? null,
      adversarialPair: existing.adversarialPair ?? null,
      noiseProfile: existing.noiseProfile ?? null,
      approvalSource: existing.approvalSource ?? null,
      reviewedBy: nextReviewedBy,
      notes: notesWithAudit,
    });

    if (hasCertifiedTask(row.taskCertifications)) {
      const lintIssues = await collectLintIssuesForCertifiedRow(withLegacyCertification(row));
      if (lintIssues.length > 0) {
        const quarantined = await quarantineRow(row, lintIssues[0]?.blockedReason ?? "needs_research");
        return reply.status(409).send({
          ok: false as const,
          reason: "lint_failed",
          lintIssues,
          truth: withTruthQualityMeta(quarantined),
        });
      }
    }

    return reply.status(200).send({
      synced: true as const,
      truth: withTruthQualityMeta(row),
    });
  });

  app.delete("/admin/approved-truth/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ok = await deleteApprovedTruth(id);
    if (!ok) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Approved truth row not found.");
    }
    return reply.status(200).send({ ok: true as const });
  });

  app.get('/admin/gold-datasets', async (_req, reply) => {
    const manifests = await listFrozenGoldDatasetManifests();
    return reply.status(200).send({
      items: manifests,
      total: manifests.length,
      root: resolveGoldDatasetRoot(),
    });
  });

  app.get('/admin/gold-datasets/:datasetVersion', async (req, reply) => {
    const datasetVersion = (req.params as { datasetVersion: string }).datasetVersion;
    const manifest = await readFrozenGoldDatasetManifest(datasetVersion);
    if (!manifest) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Frozen gold dataset not found.');
    }
    return reply.status(200).send(manifest);
  });

  app.post('/admin/gold-datasets/freeze', async (req, reply) => {
    const parsed = freezeStyleGoldDatasetSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid style gold dataset freeze payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const datasetVersion = parsed.data.datasetVersion ?? buildDatasetVersion();
    const existing = await readFrozenGoldDatasetManifest(datasetVersion);
    if (existing) {
      return reply.status(200).send({
        ok: true as const,
        reused: true as const,
        datasetVersion,
        manifest: existing,
      });
    }

    const freezeResult = buildStyleCoreFreezeSelection(
      await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT }),
      {
        datasetVersion,
        includeHoldout: parsed.data.includeHoldout,
        enforceDiversityGates: parsed.data.enforceDiversityGates,
      },
    );
    if (freezeResult.candidateSummary.styleClean < STYLE_CLEAN_CANDIDATE_TARGET) {
      freezeResult.warnings.push({
        code: 'CANDIDATE_POOL_STYLE_CLEAN_BELOW_TARGET',
        message: `style_clean candidate pool is below target (${freezeResult.candidateSummary.styleClean}/${STYLE_CLEAN_CANDIDATE_TARGET}).`,
      });
    }
    if (freezeResult.candidateSummary.styleAdversarial < STYLE_ADVERSARIAL_CANDIDATE_TARGET) {
      freezeResult.warnings.push({
        code: 'CANDIDATE_POOL_STYLE_ADVERSARIAL_BELOW_TARGET',
        message: `style_adversarial candidate pool is below target (${freezeResult.candidateSummary.styleAdversarial}/${STYLE_ADVERSARIAL_CANDIDATE_TARGET}).`,
      });
    }
    if (freezeResult.candidateSummary.styleNoisy < STYLE_NOISY_CANDIDATE_TARGET) {
      freezeResult.warnings.push({
        code: 'CANDIDATE_POOL_STYLE_NOISY_BELOW_TARGET',
        message: `style_noisy candidate pool is below target (${freezeResult.candidateSummary.styleNoisy}/${STYLE_NOISY_CANDIDATE_TARGET}).`,
      });
    }

    if (freezeResult.failures.length > 0) {
      return reply.status(buildFreezeStatusCode(freezeResult)).send({
        ok: false as const,
        datasetVersion,
        targets: {
          styleCleanPerStyle: STYLE_CLEAN_TARGET_PER_STYLE,
          styleNoisyPerStyle: STYLE_NOISY_TARGET_PER_STYLE,
          adversarialPerPair: ADVERSARIAL_TARGET_PER_PAIR,
          styleCleanTotal: STYLE_CLEAN_TARGET_TOTAL,
          styleNoisyTotal: STYLE_NOISY_TARGET_TOTAL,
          styleAdversarialTotal: STYLE_ADVERSARIAL_TARGET_TOTAL,
          frozenTotal: FROZEN_STYLE_CORE_TOTAL,
          candidateStyleClean: STYLE_CLEAN_CANDIDATE_TARGET,
          candidateStyleAdversarial: STYLE_ADVERSARIAL_CANDIDATE_TARGET,
          candidateStyleNoisy: STYLE_NOISY_CANDIDATE_TARGET,
          supportedStyles: SUPPORTED_STYLE_LABELS,
          requiredPairs: REQUIRED_ADVERSARIAL_PAIRS,
        },
        candidateSummary: freezeResult.candidateSummary,
        selectionSummary: freezeResult.selectionSummary,
        failures: freezeResult.failures,
        warnings: freezeResult.warnings,
      });
    }

    for (const row of freezeResult.selectedRows) {
      if (row.datasetVersion && row.datasetVersion !== datasetVersion) {
        throw new AppError(
          409,
          ErrorCode.INPUT_VALIDATION_FAILED,
          `Row ${row.id} already belongs to frozen dataset version ${row.datasetVersion}.`,
        );
      }
    }

    for (const row of freezeResult.selectedRows) {
      await upsertApprovedTruthPayload({
        id: row.id,
        rawText: row.rawText,
        expectedFields: row.expectedFields,
        coreTruth: row.coreTruth ?? null,
        overlayTruth: row.overlayTruth ?? null,
        expectedType: row.expectedType ?? null,
        expectedStyle: row.expectedStyle ?? null,
        provenance: row.provenance ?? null,
        pipelineMajor: row.pipelineMajor ?? null,
        datasetSplit: row.datasetSplit ?? null,
        trustLevel: row.trustLevel,
        rowStatus: row.rowStatus ?? legacyTrustToRowStatus(row.trustLevel),
        blockedReason: row.blockedReason ?? null,
        taskCertifications: row.taskCertifications ?? null,
        workId: row.workId ?? null,
        familyId: row.familyId ?? null,
        variantId: row.variantId ?? null,
        canonicalWorkKey: row.canonicalWorkKey ?? null,
        nearDupClusterId: row.nearDupClusterId ?? null,
        datasetVersion,
        inputProfile: row.inputProfile ?? null,
        styleInferabilityTier: row.styleInferabilityTier ?? null,
        styleEvaluationSuite: row.styleEvaluationSuite ?? null,
        isAdversarial: row.isAdversarial ?? null,
        difficultyTier: row.difficultyTier ?? null,
        highImpact: row.highImpact ?? null,
        highImpactReason: row.highImpactReason ?? null,
        holdoutVersion: row.holdoutVersion ?? null,
        inferabilityByField: row.inferabilityByField ?? null,
        goldKind: row.goldKind ?? null,
        adversarialPair: row.adversarialPair ?? null,
        noiseProfile: row.noiseProfile ?? null,
        approvalSource: row.approvalSource ?? null,
        reviewedBy: row.reviewedBy ?? null,
        notes: row.notes ?? null,
      });
    }

    const manifest = createFrozenManifest(freezeResult);
    const manifestPath = await writeFrozenGoldDatasetManifest(manifest);
    return reply.status(201).send({
      ok: true as const,
      reused: false as const,
      datasetVersion,
      manifest,
      manifestPath,
    });
  });

  app.get("/admin/training-export", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const trustLevel = q.trustLevel as TruthTrustLevel | undefined;
    const datasetSplit = q.datasetSplit as TruthDatasetSplit | undefined;
    const rowStatus = q.rowStatus && q.rowStatus !== 'null'
      ? q.rowStatus as NonNullable<StoredApprovedTruth['rowStatus']>
      : undefined;
    const goldKind = q.goldKind ?? undefined;
    const expectedStyle = q.expectedStyle ?? undefined;
    const adversarialPair = q.adversarialPair ?? undefined;
    const datasetVersion = q.datasetVersion ?? undefined;
    const styleEvaluationSuite = q.styleEvaluationSuite ?? undefined;
    const task = q.task ?? 'style';
    const truthScope = q.truthScope ?? 'core';
    if (!taskSchema.options.includes(task as (typeof taskSchema)['options'][number])) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid task filter.');
    }
    if (!truthScopeSchema.options.includes(truthScope as (typeof truthScopeSchema)['options'][number])) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid truthScope filter.');
    }
    const certifiedOnly = q.certifiedOnly !== 'false';
    const excludeQuarantined = q.excludeQuarantined !== 'false';
    const holdoutVersion = q.holdoutVersion ?? undefined;
    const excludeHoldout = q.excludeHoldout !== "false";
    const shouldDownload = q.download !== "false";
    let rows = await listApprovedTruth({
      ...(trustLevel ? { trustLevel } : {}),
      ...(rowStatus ? { rowStatus } : {}),
      ...(datasetSplit ? { datasetSplit } : {}),
      ...(datasetVersion ? { datasetVersion } : {}),
      limit: TRUTH_SCAN_LIMIT,
    });
    rows = rows.map((row) => withLegacyCertification(row));
    if (goldKind) {
      rows = rows.filter((row) => row.goldKind === goldKind);
    }
    if (expectedStyle) {
      rows = rows.filter((row) => row.expectedStyle === expectedStyle);
    }
    if (adversarialPair) {
      rows = rows.filter((row) => row.adversarialPair === adversarialPair);
    }
    if (styleEvaluationSuite) {
      rows = rows.filter((row) => row.styleEvaluationSuite === styleEvaluationSuite);
    }
    if (excludeQuarantined) {
      rows = rows.filter((row) => effectiveRowStatus(row) !== 'quarantined');
    }
    if (excludeHoldout) {
      rows = rows.filter((r) => r.datasetSplit !== "holdout");
    }
    if (holdoutVersion) {
      rows = rows.filter((row) => row.holdoutVersion === holdoutVersion);
    }
    if (certifiedOnly) {
      rows = rows.filter((row) => isTaskCertified(row, task as TruthTaskOption, truthScope as TruthScopeOption));
    }
    rows = rows.filter((row) => !hasSplitLeakage(row, rows));

    const lines = rows.map((r) => JSON.stringify(exportRow(r, {
      task: task as TruthTaskOption,
      truthScope: truthScope as TruthScopeOption,
    })));
    const body = `${lines.join('\n')}\n`;
    const response = reply.header("Content-Type", "application/x-ndjson; charset=utf-8");
    if (shouldDownload) {
      response.header("Content-Disposition", "attachment; filename=\"training-export.jsonl\"");
    }
    emitTruthGovernanceAuditEvent(req, 'truth.export.training', 200, {
      rowCount: rows.length,
      task,
      truthScope,
      certifiedOnly,
      excludeQuarantined,
      excludeHoldout,
      shouldDownload,
    });
    return response.status(200).send(body);
  });

  app.get('/admin/render-variant-export', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const datasetVersion = q.datasetVersion ?? undefined;
    const datasetSplit = q.datasetSplit as TruthDatasetSplit | undefined;
    const rowStatus = q.rowStatus && q.rowStatus !== 'null'
      ? q.rowStatus as NonNullable<StoredApprovedTruth['rowStatus']>
      : undefined;
    const renderStyle = q.renderStyle as TruthRenderVariantStyle | undefined;
    const approvalStatus = q.approvalStatus as StoredApprovedTruthRenderVariant['approvalStatus'] | undefined;
    const datasetLane = q.datasetLane ?? 'augmentation';
    const excludeQuarantined = q.excludeQuarantined !== 'false';
    const excludeHoldout = q.excludeHoldout !== 'false';
    const includeStale = q.includeStale === 'true';
    const approvedOnly = q.approvedOnly !== 'false';
    const shouldDownload = q.download !== 'false';

    if (renderStyle && !approvedTruthRenderVariantStyleSchema.options.includes(renderStyle)) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid renderStyle filter.');
    }
    if (approvalStatus && !['draft', 'reviewed', 'approved'].includes(approvalStatus)) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid approvalStatus filter.');
    }
    if (datasetLane !== 'augmentation') {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid datasetLane filter.');
    }

    let rows = await listApprovedTruth({
      ...(rowStatus ? { rowStatus } : {}),
      ...(datasetSplit ? { datasetSplit } : {}),
      ...(datasetVersion ? { datasetVersion } : {}),
      limit: TRUTH_SCAN_LIMIT,
    });
    rows = rows.map((row) => withLegacyCertification(row));

    if (excludeQuarantined) {
      rows = rows.filter((row) => effectiveRowStatus(row) !== 'quarantined');
    }
    if (excludeHoldout) {
      rows = rows.filter((row) => row.datasetSplit !== 'holdout');
    }
    rows = rows.filter((row) => !hasSplitLeakage(row, rows));

    const exportedVariants: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const variants = await listApprovedTruthRenderVariants(row.id);
      for (const variant of variants) {
        if (variant.datasetLane !== datasetLane) {
          continue;
        }
        if (renderStyle && variant.style !== renderStyle) {
          continue;
        }
        if (approvalStatus && variant.approvalStatus !== approvalStatus) {
          continue;
        }
        if (approvedOnly && variant.approvalStatus !== 'approved') {
          continue;
        }
        if (!includeStale && variant.stale) {
          continue;
        }
        exportedVariants.push(exportRenderVariantRow(row, variant));
      }
    }

    const body = exportedVariants.map((entry) => JSON.stringify(entry)).join('\n');
    const response = reply.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    if (shouldDownload) {
      response.header('Content-Disposition', 'attachment; filename="render-variant-export.jsonl"');
    }
    emitTruthGovernanceAuditEvent(req, 'truth.export.render_variants', 200, {
      rowCount: rows.length,
      variantCount: exportedVariants.length,
      includeStale,
      approvedOnly,
      datasetLane,
      shouldDownload,
    });
    return response.status(200).send(body.length > 0 ? `${body}\n` : '');
  });

  app.get('/admin/training-status', async (_req, reply) => {
    const rows = await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT });
    const authorityPack = loadGeneratedAuthorityPack();
    const styleBundleStatus = await readStyleBundleStatus();
    const benchmarkStatus = await readBenchmarkStatus();
    const mlHealth = await readMlHealth();

    return reply.status(200).send({
      truth: buildTruthStats(rows),
      authorityPack: {
        version: authorityPack.version,
        generatedAt: authorityPack.generatedAt || null,
        doiExactHints: authorityPack.doiExactHints.length,
        journalIssnHints: authorityPack.journalIssnHints.length,
      },
      styleBundle: styleBundleStatus,
      benchmark: benchmarkStatus,
      mlHealth,
    });
  });

  app.get('/admin/training-packs', async (_req, reply) => {
    return reply.status(200).send({
      items: TRAINING_PACK_TARGETS.map((packTarget) => ({
        packTarget,
        buildable: true,
      })),
    });
  });

  app.post('/admin/training-packs/:packTarget/build', async (req, reply) => {
    const parsed = trainingPackTargetSchema.safeParse((req.params as { packTarget?: unknown }).packTarget);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid training pack target.', {
        issues: parsed.error.flatten(),
      });
    }

    const manifest = await writeStagedTrainingPack({
      packTarget: parsed.data as TrainingPackTargetOption,
      rows: await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT }),
    });

    return reply.status(200).send({
      ok: true,
      manifest,
    });
  });

  app.get('/admin/bio-training-status', async (_req, reply) => {
    const bioDatasets = await readBioDatasetStatus();
    const bioBundle = await readBioBundleStatus();
    const mlHealth = await readMlHealth();

    return reply.status(200).send({
      datasets: bioDatasets,
      bundle: bioBundle,
      mlHealth,
    });
  });

  app.post('/admin/authority-pack/build', async (_req, reply) => {
    const rows = await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT });
    const eligibleRows = rows
      .map((row) => withLegacyCertification(row))
      .filter((row) => effectiveRowStatus(row) !== 'quarantined')
      .filter((row) => isTaskCertified(row, 'authority_pack', 'core'));
    if (eligibleRows.length === 0) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        'No certified authority_pack/core approved-truth rows are available for authority-pack generation.',
      );
    }

    const bundle = buildGeneratedAuthorityPack(eligibleRows);
    const path = await writeGeneratedAuthorityPack(bundle);

    return reply.status(200).send({
      ok: true as const,
      version: bundle.version,
      generatedAt: bundle.generatedAt,
      sourceRows: eligibleRows.length,
      doiExactHints: bundle.doiExactHints.length,
      journalIssnHints: bundle.journalIssnHints.length,
      path,
    });
  });

  app.post('/admin/style-bundle/build', async (req, reply) => {
    const parsed = buildStyleBundleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid style-bundle build payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const requestedDatasetVersion = parsed.data.datasetVersion?.trim() || null;
    const requestedManifest = requestedDatasetVersion
      ? await readFrozenGoldDatasetManifest(requestedDatasetVersion)
      : null;
    if (requestedDatasetVersion && !requestedManifest) {
      throw new AppError(
        404,
        ErrorCode.NOT_FOUND,
        `Frozen gold dataset ${requestedDatasetVersion} was not found. Freeze it before building the style bundle.`,
      );
    }

    const datasetVersion = requestedDatasetVersion ?? null;
    const rows = await listApprovedTruth({
      ...(datasetVersion ? { datasetVersion } : {}),
      limit: TRUTH_SCAN_LIMIT,
    });
    const exportSummary = await writeStyleGoldExport(
      rows,
      resolveStyleGoldOutputPath(),
      {
        ...(datasetVersion ? { datasetVersion } : {}),
        includeHoldout: parsed.data.includeHoldout,
      },
    );
    if (exportSummary.rowCount === 0) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        `No certified style/core rows${datasetVersion ? ` for datasetVersion=${datasetVersion}` : ''} are available for style-bundle training.`,
      );
    }

    const version = parsed.data.version ?? buildStyleBundleVersion();
    const trainerOutput = await runPythonJsonCommand(
      [
        resolvePythonTrainingScriptPath(),
        exportSummary.outputPath,
        '--model-root',
        resolveStyleModelRoot(),
        '--version',
        version,
      ],
      { cwd: resolveMlServiceRoot() },
    );

    return reply.status(200).send({
      ok: true as const,
      version,
      datasetVersion,
      exportSummary,
      trainer: trainerOutput,
      styleBundle: await readStyleBundleStatus(),
    });
  });

  app.post('/admin/style-bundle/promote', async (req, reply) => {
    const parsed = promoteStyleBundleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid style-bundle promote payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const output = await runPythonTextCommand(
      [
        resolvePythonPromotionScriptPath(),
        parsed.data.version,
        '--model-root',
        resolveStyleModelRoot(),
      ],
      { cwd: resolveMlServiceRoot() },
    );

    return reply.status(200).send({
      ok: true as const,
      version: parsed.data.version,
      targetPath: output.trim(),
      styleBundle: await readStyleBundleStatus(),
      mlHealth: await readMlHealth(),
    });
  });

  app.post('/admin/bio-bundle/build', async (req, reply) => {
    const parsed = buildBioBundleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid bio-bundle build payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const buildResult = await buildBioBundleArtifact({
      version: parsed.data.version ?? null,
      datasetFile: parsed.data.datasetFile ?? null,
    });

    return reply.status(200).send({
      ok: true as const,
      version: buildResult.version,
      datasetFile: buildResult.selectedDataset.fileName,
      trainer: buildResult.trainerOutput,
      datasets: await readBioDatasetStatus(),
      bioBundle: await readBioBundleStatus(),
      mlHealth: await readMlHealth(),
    });
  });

  app.post('/admin/bio-dataset/export-supervision', async (_req, reply) => {
    const exportResult = await exportBioSupervisionDataset();
    return reply.status(200).send({
      ok: true as const,
      export: exportResult,
      datasets: await readBioDatasetStatus(),
    });
  });

  app.post('/admin/bio-bundle/publish-gold', async (req, reply) => {
    const parsed = buildBioBundleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid bio-bundle gold publish payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const buildResult = await buildBioBundleArtifact({
      version: parsed.data.version ?? GOLD_BIO_BUNDLE_VERSION,
      datasetFile: parsed.data.datasetFile ?? null,
    });
    const promotion = await promoteBioBundleArtifact(buildResult.version);

    return reply.status(200).send({
      ok: true as const,
      version: buildResult.version,
      datasetFile: buildResult.selectedDataset.fileName,
      trainer: buildResult.trainerOutput,
      promotion,
      datasets: await readBioDatasetStatus(),
      bioBundle: await readBioBundleStatus(),
      mlHealth: await readMlHealth(),
    });
  });

  app.post('/admin/bio-bundle/promote', async (req, reply) => {
    const parsed = promoteBioBundleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid bio-bundle promote payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const output = await promoteBioBundleArtifact(parsed.data.version);

    return reply.status(200).send({
      ok: true as const,
      version: parsed.data.version,
      promotion: output,
      bioBundle: await readBioBundleStatus(),
      mlHealth: await readMlHealth(),
    });
  });

  app.get('/admin/bio-review/queue', async (req, reply) => {
    const limitRaw = (req.query as { limit?: string } | undefined)?.limit;
    const limit = Math.min(Math.max(Number(limitRaw) || 25, 1), 100);
    const queue = await getRankedQueue(limit);
    return reply.status(200).send({
      ok: true as const,
      total: queue.total,
      returned: queue.items.length,
      items: queue.items,
    });
  });

  app.post('/admin/bio-review/submit', async (req, reply) => {
    const parsed = bioReviewSubmitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid bio review submission.', {
        issues: parsed.error.flatten(),
      });
    }
    if (parsed.data.decision === 'approve') {
      const spanError = validateSpans(parsed.data);
      if (spanError) {
        throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, `Invalid span: ${spanError}`);
      }
    }
    const result = await persistSubmission(parsed.data);
    if (result.outcome === 'not_found') {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Review item not found in the queue.');
    }
    return reply.status(200).send({ ok: true as const, ...result });
  });

  app.post('/admin/bio-review/triage', async (_req, reply) => {
    const result = await runInboxTriage(new HttpMLClient());
    return reply.status(200).send({ ok: true as const, ...result });
  });

  app.post('/admin/approved-truth/:id/certify', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = certifyTruthSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid certify payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const existing = await getApprovedTruth(id);
    if (!existing) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Approved truth row not found.');
    }
    const result = await applyTruthCertification(existing, parsed.data);
    if (!result.ok) {
      emitTruthGovernanceAuditEvent(req, 'truth.certify.single_rejected', 409, {
        id,
        task: parsed.data.task,
        truthScope: parsed.data.truthScope,
        status: parsed.data.status,
        reason: result.reason,
      });
      return reply.status(409).send(result);
    }

    emitTruthGovernanceAuditEvent(req, 'truth.certify.single', 200, {
      id,
      task: parsed.data.task,
      truthScope: parsed.data.truthScope,
      status: parsed.data.status,
    });
    return reply.status(200).send(result);
  });

  app.post('/admin/approved-truth/certify-bulk', async (req, reply) => {
    const parsed = truthBulkCertifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid bulk certify payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const ids = [...new Set(parsed.data.ids)];
    const certificationInput: CertifyTruthInput = {
      task: parsed.data.task,
      truthScope: parsed.data.truthScope,
      status: parsed.data.status,
      certifiedBy: parsed.data.certifiedBy ?? null,
      requiredReviewPasses: parsed.data.requiredReviewPasses,
      completedReviewPasses: parsed.data.completedReviewPasses,
      decisionHash: parsed.data.decisionHash ?? null,
    };
    const results: TruthCertifyRowResult[] = [];
    for (const id of ids) {
      results.push(await certifyApprovedTruthRow(id, certificationInput));
    }

    const certifiedCount = results.filter((result) => result.status === 'certified').length;
    const quarantinedCount = results.filter((result) => result.status === 'quarantined').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    emitTruthGovernanceAuditEvent(req, 'truth.certify.bulk', 200, {
      requestedCount: ids.length,
      certifiedCount,
      quarantinedCount,
      failedCount,
      task: certificationInput.task,
      truthScope: certificationInput.truthScope,
      status: certificationInput.status,
    });

    return reply.status(200).send({
      requestedCount: ids.length,
      certifiedCount,
      quarantinedCount,
      failedCount,
      results,
    });
  });

  app.post('/admin/learning-queue/process-bulk', async (req, reply) => {
    const parsed = learningQueueBulkProcessSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid bulk learning-queue process payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const ids = [...new Set(parsed.data.ids)];
    const queueById = new Map((await listLearningQueue()).map((item) => [item.id, item]));
    const results: Array<{
      id: string;
      status: 'processed' | 'failed';
      message?: string;
    }> = [];

    for (const id of ids) {
      const queue = queueById.get(id);
      if (!queue) {
        results.push({
          id,
          status: 'failed',
          message: 'Learning queue item not found.',
        });
        continue;
      }

      const groupedQueueIds = [...new Set(queue.groupedQueueIds ?? [queue.id])];
      try {
        const updatedCount = await markLearningQueueItemsProcessed(
          groupedQueueIds,
          queue.promotedToTruthId ?? null,
        );
        results.push({
          id,
          status: 'processed',
          ...(updatedCount > 1
            ? { message: `Marked ${updatedCount} grouped learning-queue rows processed.` }
            : {}),
        });
      } catch (error) {
        results.push({
          id,
          status: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'Could not mark the selected learning-queue rows processed.',
        });
      }
    }

    const processedCount = results.filter((result) => result.status === 'processed').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    emitTruthGovernanceAuditEvent(req, 'truth.learning_queue.process_bulk', 200, {
      requestedCount: ids.length,
      processedCount,
      failedCount,
    });

    return reply.status(200).send({
      requestedCount: ids.length,
      processedCount,
      failedCount,
      results,
    });
  });

  app.post('/admin/learning-queue/revert-bulk', async (req, reply) => {
    const parsed = learningQueueBulkProcessSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid bulk learning-queue revert payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const ids = [...new Set(parsed.data.ids)];
    const queueById = new Map((await listLearningQueue()).map((item) => [item.id, item]));
    const results: Array<{
      id: string;
      status: 'reverted' | 'failed';
      message?: string;
    }> = [];

    for (const id of ids) {
      const queue = queueById.get(id);
      if (!queue) {
        results.push({
          id,
          status: 'failed',
          message: 'Learning-queue row not found.',
        });
        continue;
      }

      const groupedQueueIds = [...new Set(queue.groupedQueueIds ?? [queue.id])];
      try {
        const updatedCount = await markLearningQueueItemsUnprocessed(groupedQueueIds);
        results.push({
          id,
          status: 'reverted',
          ...(updatedCount > 1
            ? { message: `Reverted ${updatedCount} grouped learning-queue rows to pending.` }
            : {}),
        });
      } catch (error) {
        results.push({
          id,
          status: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'Could not revert the selected learning-queue rows.',
        });
      }
    }

    const revertedCount = results.filter((result) => result.status === 'reverted').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    emitTruthGovernanceAuditEvent(req, 'truth.learning_queue.revert_bulk', 200, {
      requestedCount: ids.length,
      revertedCount,
      failedCount,
    });

    return reply.status(200).send({
      requestedCount: ids.length,
      revertedCount,
      failedCount,
      results,
    });
  });

  app.post('/admin/learning-queue/promote-bulk', async (req, reply) => {
    const parsed = learningQueueBulkPromoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, 'Invalid bulk learning-queue promote payload.', {
        issues: parsed.error.flatten(),
      });
    }

    const bulkInput: LearningQueueBulkPromoteInput = parsed.data;
    const ids = [...new Set(bulkInput.ids)];
    const queueById = new Map((await listLearningQueue()).map((item) => [item.id, item]));
    let approvedTruthRows = await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT });
    const notesWithAudit = appendAuditReasonToNotes(
      bulkInput.notes ?? null,
      bulkInput.auditReasonCode,
      resolveAuditActor(req, bulkInput.reviewedBy ?? null),
    );
    const promoteRowStatus =
      bulkInput.rowStatus ?? legacyTrustToRowStatus(bulkInput.trustLevel ?? 'reviewed');
    const results: Array<{
      id: string;
      status: 'promoted' | 'quarantined' | 'failed';
      truthId?: string;
      message?: string;
    }> = [];

    for (const id of ids) {
      const queue = queueById.get(id);
      if (!queue) {
        results.push({
          id,
          status: 'failed',
          message: 'Learning queue item not found.',
        });
        continue;
      }

      const sourceRawText = typeof queue.trainingData.rawInput === 'string' ? queue.trainingData.rawInput : '';
      const rawText = normalizeAdminTruthRawText(sourceRawText);
      if (!rawText) {
        results.push({
          id,
          status: 'failed',
          message: 'rawText is required when queue item has no rawInput.',
        });
        continue;
      }

      const existingByHash = findApprovedTruthByAdminRawText(approvedTruthRows, rawText);

      try {
        ensureRowStatusAndBlockedReason(promoteRowStatus, bulkInput.blockedReason ?? null);
        ensureHoldoutVersion(bulkInput.datasetSplit ?? null, null);
        ensureSplitSealed(existingByHash ?? null, bulkInput.datasetSplit ?? null, null);
        ensureDatasetVersionSealed(existingByHash ?? null, null);

        const initialSeed = await resolveInitialApprovedTruthSeed({
          rawText,
          expectedFields: expectedFieldsFromLearningQueueTrainingData(queue.trainingData),
          coreTruth: null,
          expectedType: bulkInput.expectedType ?? null,
          expectedStyle: bulkInput.expectedStyle ?? null,
          pipelineMajor: null,
        });

        ensureAdversarialPairConsistency(
          bulkInput.goldKind ?? null,
          bulkInput.adversarialPair ?? null,
          initialSeed.expectedStyle,
        );

        const promotedResult = await promoteLearningQueueRow(id, {
          ...(existingByHash?.id ? { id: existingByHash.id } : {}),
          rawText,
          expectedFields: initialSeed.expectedFields,
          coreTruth: initialSeed.coreTruth,
          overlayTruth: null,
          expectedType: initialSeed.expectedType,
          expectedStyle: initialSeed.expectedStyle,
          datasetSplit: bulkInput.datasetSplit ?? null,
          trustLevel: bulkInput.trustLevel ?? 'reviewed',
          rowStatus: promoteRowStatus,
          blockedReason: bulkInput.blockedReason ?? null,
          taskCertifications: null,
          goldKind: bulkInput.goldKind ?? null,
          adversarialPair: bulkInput.adversarialPair ?? null,
          noiseProfile: bulkInput.noiseProfile ?? null,
          approvalSource: bulkInput.approvalSource ?? 'learning_queue',
          reviewedBy: bulkInput.reviewedBy ?? null,
          notes: notesWithAudit,
          provenance: bulkInput.provenance ?? null,
        });

        if (!promotedResult) {
          results.push({
            id,
            status: 'failed',
            message: 'Learning queue item not found.',
          });
          continue;
        }

        const promoted = withTruthQualityMeta(promotedResult.truth);
        const promotedSnapshot = upsertApprovedTruthSnapshot(approvedTruthRows, promoted);
        const lintIssues = evaluateCertificationLint(promoted, 'core');
        if (hasSplitLeakage(promoted, promotedSnapshot)) {
          lintIssues.push({
            blockedReason: 'split_leakage',
            code: 'WORK_CLUSTER_SPLIT_LEAKAGE',
            message: 'canonicalWorkKey/workId/familyId/nearDupClusterId appears in multiple dataset splits.',
          });
        }

        if (lintIssues.length > 0) {
          const quarantined = await quarantineRow(
            promoted,
            lintIssues[0]?.blockedReason ?? 'needs_research',
          );
          approvedTruthRows = upsertApprovedTruthSnapshot(promotedSnapshot, quarantined);
          results.push({
            id,
            status: 'quarantined',
            truthId: quarantined.id,
            message: lintIssues[0]?.message ?? 'Promotion lint failed; row was quarantined.',
          });
          continue;
        }

        approvedTruthRows = promotedSnapshot;
        const groupedQueueIds = (queue.groupedQueueIds ?? []).filter((groupedId) => groupedId !== id);
        if (groupedQueueIds.length > 0) {
          await markLearningQueueItemsProcessed(groupedQueueIds, promoted.id);
        }

        results.push({
          id,
          status: effectiveRowStatus(promoted) === 'quarantined' ? 'quarantined' : 'promoted',
          truthId: promoted.id,
        });
      } catch (error) {
        results.push({
          id,
          status: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'Could not promote the selected learning-queue row.',
        });
      }
    }

    const promotedCount = results.filter((result) => result.status === 'promoted').length;
    const quarantinedCount = results.filter((result) => result.status === 'quarantined').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    emitTruthGovernanceAuditEvent(req, 'truth.promote.learning_queue_bulk', 200, {
      requestedCount: ids.length,
      promotedCount,
      quarantinedCount,
      failedCount,
      expectedType: bulkInput.expectedType ?? null,
      expectedStyle: bulkInput.expectedStyle ?? null,
      datasetSplit: bulkInput.datasetSplit ?? null,
      rowStatus: promoteRowStatus,
    });

    return reply.status(200).send({
      requestedCount: ids.length,
      promotedCount,
      quarantinedCount,
      failedCount,
      results,
    });
  });

  app.post("/admin/learning-queue/:id/promote", async (req, reply) => {
    const queueId = (req.params as { id: string }).id;
    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "Invalid promote payload.", {
        issues: parsed.error.flatten(),
      });
    }
    const queue = (await listLearningQueue()).find((i) => i.id === queueId);
    if (!queue) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Learning queue item not found.");
    }
    const sourceRawText =
      parsed.data.rawText?.trim()
      ?? (typeof queue.trainingData.rawInput === "string" ? queue.trainingData.rawInput : "");
    const rawText = normalizeAdminTruthRawText(sourceRawText);
    if (!rawText) {
      throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, "rawText is required when queue item has no rawInput.");
    }
    if (!parsed.data.auditReasonCode) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        "auditReasonCode is required when promoting learning-queue rows into approved truth.",
      );
    }
    const notesWithAudit = appendAuditReasonToNotes(
      parsed.data.notes ?? null,
      parsed.data.auditReasonCode ?? null,
      resolveAuditActor(req, parsed.data.reviewedBy ?? null),
    );
    let result: { truth: StoredApprovedTruth } | null;
    const promoteRowStatus = parsed.data.rowStatus ?? legacyTrustToRowStatus(parsed.data.trustLevel ?? "reviewed");
    const normalizedTaskCertifications = normalizeTaskCertifications(parsed.data.taskCertifications);
    const existingByHash = findApprovedTruthByAdminRawText(
      await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT }),
      rawText,
    );
    ensureRowStatusAndBlockedReason(promoteRowStatus, parsed.data.blockedReason ?? null);
    ensureHoldoutVersion(parsed.data.datasetSplit ?? null, null);
    ensureSplitSealed(existingByHash ?? null, parsed.data.datasetSplit ?? null, null);
    ensureDatasetVersionSealed(existingByHash ?? null, null);
    const initialSeed = await resolveInitialApprovedTruthSeed({
      rawText,
      expectedFields: parsed.data.expectedFields,
      coreTruth: parsed.data.coreTruth ?? null,
      expectedType: parsed.data.expectedType ?? null,
      expectedStyle: parsed.data.expectedStyle ?? null,
      pipelineMajor: null,
    });
    ensureAdversarialPairConsistency(
      parsed.data.goldKind ?? null,
      parsed.data.adversarialPair ?? null,
      initialSeed.expectedStyle,
    );
    try {
      result = await promoteLearningQueueRow(queueId, {
        ...(existingByHash?.id ? { id: existingByHash.id } : {}),
        rawText,
        expectedFields: initialSeed.expectedFields,
        coreTruth: initialSeed.coreTruth,
        overlayTruth: parsed.data.overlayTruth ?? null,
        expectedType: initialSeed.expectedType,
        expectedStyle: initialSeed.expectedStyle,
        datasetSplit: parsed.data.datasetSplit ?? null,
        trustLevel: parsed.data.trustLevel ?? "reviewed",
        rowStatus: promoteRowStatus,
        blockedReason: parsed.data.blockedReason ?? null,
        taskCertifications: normalizedTaskCertifications,
        goldKind: parsed.data.goldKind ?? null,
        adversarialPair: parsed.data.adversarialPair ?? null,
        noiseProfile: parsed.data.noiseProfile ?? null,
        approvalSource: parsed.data.approvalSource ?? "learning_queue",
        reviewedBy: parsed.data.reviewedBy ?? null,
        notes: notesWithAudit,
        provenance: parsed.data.provenance ?? null,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new AppError(400, ErrorCode.INPUT_VALIDATION_FAILED, error.message);
      }
      throw error;
    }
    if (!result) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Learning queue item not found.");
    }
    const promoted = withTruthQualityMeta(result.truth);
    const lintIssues = evaluateCertificationLint(promoted, 'core');
    if (hasSplitLeakage(promoted, await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT }))) {
      lintIssues.push({
        blockedReason: 'split_leakage',
        code: 'WORK_CLUSTER_SPLIT_LEAKAGE',
        message: 'canonicalWorkKey/workId/familyId/nearDupClusterId appears in multiple dataset splits.',
      });
    }
    if (lintIssues.length > 0) {
      const quarantined = await quarantineRow(promoted, lintIssues[0]?.blockedReason ?? 'needs_research');
      emitTruthGovernanceAuditEvent(req, 'truth.promote.learning_queue_rejected', 409, {
        queueId,
        truthId: promoted.id,
        reason: 'promotion_lint_failed',
      });
      return reply.status(409).send({
        ok: false as const,
        reason: 'promotion_lint_failed',
        lintIssues,
        truth: withTruthQualityMeta(quarantined),
      });
    }
    emitTruthGovernanceAuditEvent(req, 'truth.promote.learning_queue', 200, {
      queueId,
      truthId: promoted.id,
      datasetSplit: promoted.datasetSplit ?? null,
      rowStatus: effectiveRowStatus(promoted),
    });
    const groupedQueueIds = (queue.groupedQueueIds ?? []).filter((id) => id !== queueId);
    if (groupedQueueIds.length > 0) {
      await markLearningQueueItemsProcessed(groupedQueueIds, promoted.id);
    }
    return reply.status(200).send({ truth: promoted });
  });
}

function buildTruthStats(rows: StoredApprovedTruth[]) {
  const byTrustLevel: Record<string, number> = {};
  const byRowStatus: Record<string, number> = {};
  const byDatasetSplit: Record<string, number> = {};
  const byStyle: Record<string, number> = {};
  const byGoldKind: Record<string, number> = {};
  const byAdversarialPair: Record<string, number> = {};
  const byTaskScope: Record<string, number> = {};
  const byDatasetVersion: Record<string, number> = {};
  const byStyleEvalSuite: Record<string, number> = {};
  const byStyleInferabilityTier: Record<string, number> = {};

  for (const row of rows) {
    const normalized = withLegacyCertification(row);
    byTrustLevel[row.trustLevel] = (byTrustLevel[row.trustLevel] ?? 0) + 1;
    const rowStatus = effectiveRowStatus(normalized) ?? 'draft';
    byRowStatus[rowStatus] = (byRowStatus[rowStatus] ?? 0) + 1;
    if (row.datasetSplit) {
      byDatasetSplit[row.datasetSplit] = (byDatasetSplit[row.datasetSplit] ?? 0) + 1;
    }
    if (row.expectedStyle) {
      byStyle[row.expectedStyle] = (byStyle[row.expectedStyle] ?? 0) + 1;
    }
    if (row.goldKind) {
      byGoldKind[row.goldKind] = (byGoldKind[row.goldKind] ?? 0) + 1;
    }
    if (row.adversarialPair) {
      byAdversarialPair[row.adversarialPair] = (byAdversarialPair[row.adversarialPair] ?? 0) + 1;
    }
    if (row.datasetVersion) {
      byDatasetVersion[row.datasetVersion] = (byDatasetVersion[row.datasetVersion] ?? 0) + 1;
    }
    if (row.styleEvaluationSuite) {
      byStyleEvalSuite[row.styleEvaluationSuite] = (byStyleEvalSuite[row.styleEvaluationSuite] ?? 0) + 1;
    }
    if (row.styleInferabilityTier) {
      byStyleInferabilityTier[row.styleInferabilityTier] = (byStyleInferabilityTier[row.styleInferabilityTier] ?? 0) + 1;
    }
    for (const certification of normalized.taskCertifications ?? []) {
      if (certification.status === 'certified') {
        const key = `${certification.task}:${certification.truthScope}`;
        byTaskScope[key] = (byTaskScope[key] ?? 0) + 1;
      }
    }
  }

  return {
    total: rows.length,
    gold: rows.filter((row) => row.trustLevel === 'gold').length,
    reviewed: rows.filter((row) => row.trustLevel === 'reviewed').length,
    draft: rows.filter((row) => row.trustLevel === 'draft').length,
    quarantined: rows.filter((row) => effectiveRowStatus(row) === 'quarantined').length,
    byTrustLevel,
    byRowStatus,
    byDatasetSplit,
    byStyle,
    byGoldKind,
    byAdversarialPair,
    byDatasetVersion,
    byStyleEvalSuite,
    byStyleInferabilityTier,
    byTaskScope,
  };
}

function buildStyleBundleVersion(date = new Date()): string {
  return `style-gb-${date.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')}`;
}

function buildBioBundleVersion(date = new Date()): string {
  return `bio-gb-${date.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')}`;
}

async function resolveBioTrainingDataset(requestedDatasetFile: string | null) {
  const datasetStatus = await readBioDatasetStatus();

  if (requestedDatasetFile) {
    const match = datasetStatus.availableDatasets.find((dataset) => dataset.fileName === requestedDatasetFile);
    if (!match) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `BIO dataset ${requestedDatasetFile} was not found.`);
    }
    // A holdout/eval set (e.g. real_corpus_gold_v1, all `holdout`) has no train rows;
    // training it exits with "No train rows available". Reject up front with a clear
    // 400 instead of surfacing the trainer's raw 500.
    if (match.trainRowCount === 0) {
      throw new AppError(
        400,
        ErrorCode.INPUT_VALIDATION_FAILED,
        `BIO dataset "${requestedDatasetFile}" has no train-split rows (it looks like a holdout/eval set). `
          + 'Pick a dataset that contains `train` rows (e.g. a real_train_*.jsonl).',
      );
    }
    return match;
  }

  // Auto-select: the newest dataset that actually has train rows (availableDatasets is
  // sorted newest-first), skipping holdout/eval-only sets so the default build trains
  // on something usable instead of 500-ing.
  const trainable = datasetStatus.availableDatasets.find((dataset) => dataset.trainRowCount > 0) ?? null;
  if (!trainable) {
    throw new AppError(
      400,
      ErrorCode.INPUT_VALIDATION_FAILED,
      datasetStatus.availableDatasets.length === 0
        ? 'No BIO datasets are available. Generate or copy a processed BIO JSONL dataset first.'
        : 'No BIO dataset with `train`-split rows is available. The processed datasets are holdout/eval only — '
          + 'add a dataset with `train` rows (see #2 below) before building a bundle.',
    );
  }
  return trainable;
}

async function buildBioBundleArtifact(input: {
  datasetFile?: string | null;
  version?: string | null;
}) {
  if (!input.datasetFile?.trim()) {
    await exportBioSupervisionDataset();
  }
  const selectedDataset = await resolveBioTrainingDataset(input.datasetFile?.trim() || null);
  const version = input.version?.trim() || buildBioBundleVersion();
  const trainerOutput = await runPythonJsonCommand(
    [
      resolvePythonBioTrainingScriptPath(),
      selectedDataset.path,
      '--model-root',
      resolveBioModelRoot(),
      '--version',
      version,
      '--epochs',
      String(BIO_ADMIN_BUILD_EPOCHS),
    ],
    {
      cwd: resolveMlServiceRoot(),
      timeoutMs: BIO_BUNDLE_BUILD_TIMEOUT_MS,
    },
  );

  return {
    version,
    selectedDataset,
    trainerOutput,
  };
}

// #2 (bigger fix, not done here): the default "build with no dataset" path exports
// approved-truth into approved_truth_supervision.jsonl and then trains on it — but
// those rows carry the approved-truth row's own dataset_split, which today is
// `reviewed`/`holdout`, NOT `train`. So this export currently yields 0 train rows and
// the build still can't use it. To make the admin's reviewed corpus trainable, assign
// a `train` split here (e.g. hold out a deterministic val/test slice by canonicalWorkKey
// and mark the rest `train`) inside writeBioSupervisionExport, OR have the default build
// prefer the newest real_train_*.jsonl. Until then, pick a real_train_*.jsonl explicitly.
async function exportBioSupervisionDataset() {
  return writeBioSupervisionExport({
    approvedTruthRows: await listApprovedTruth({ limit: TRUTH_SCAN_LIMIT }),
    learningQueueItems: await listLearningQueue(),
    outputPath: resolve(resolveBioDatasetRoot(), 'processed', 'approved_truth_supervision.jsonl'),
  });
}

function expectedFieldsFromLearningQueueTrainingData(
  trainingData: Record<string, unknown>,
): Record<string, unknown> {
  const engineSnapshot =
    trainingData.engineSnapshot && typeof trainingData.engineSnapshot === 'object'
      ? (trainingData.engineSnapshot as { fieldsPredicted?: unknown })
      : null;
  if (
    engineSnapshot?.fieldsPredicted
    && typeof engineSnapshot.fieldsPredicted === 'object'
    && !Array.isArray(engineSnapshot.fieldsPredicted)
  ) {
    return engineSnapshot.fieldsPredicted as Record<string, unknown>;
  }
  return {};
}

function upsertApprovedTruthSnapshot(
  rows: StoredApprovedTruth[],
  row: StoredApprovedTruth,
): StoredApprovedTruth[] {
  const index = rows.findIndex((candidate) => candidate.id === row.id);
  if (index === -1) {
    return [row, ...rows];
  }
  const nextRows = [...rows];
  nextRows[index] = row;
  return nextRows;
}

async function promoteBioBundleArtifact(version: string) {
  const gate = await evaluateBioPromotionGate(version);
  if (!gate.pass) {
    throw new AppError(
      409,
      ErrorCode.INPUT_VALIDATION_FAILED,
      'BIO bundle promotion gates did not pass.',
      { gate },
    );
  }
  return runPythonJsonCommand(
    [
      resolvePythonBundlePromotionScriptPath(),
      version,
      '--model-root',
      resolveBioModelRoot(),
    ],
    { cwd: resolveMlServiceRoot() },
  );
}

async function evaluateBioPromotionGate(version: string) {
  const modelRoot = resolveBioModelRoot();
  const bundleDir = resolve(modelRoot, 'staged', version);
  const metadata = await readBundleFile(resolve(bundleDir, 'metadata.json'));
  const featureManifest = await readJsonRecord(resolve(bundleDir, 'feature_manifest.json'));
  const validation = await runBundleValidationGate(bundleDir);
  const shadowHistory = await listShadowExtractionHistory();
  const benchmarkStatus = await readBenchmarkStatus();
  const datasetStats = metadata && typeof metadata === 'object'
    ? (metadata as { datasetStats?: Record<string, unknown> }).datasetStats
    : null;
  // Minimal promotion gate for the single-admin, manual-verification workflow: the gold is
  // hand-verified in Review, so human review IS the quality gate. We hard-block ONLY on "is this a
  // structurally valid BIO bundle trained on data?" — promoting a corrupt/empty/wrong-type bundle
  // would break live extraction. The automated-eval checks (held-out val/test split, shadow-
  // extraction history, benchmark artifact) are kept as ADVISORY (reported, non-blocking) because
  // manual verification replaces the automated holdout eval. Set them blocking again only if you
  // move to an unattended retraining loop.
  const checks = [
    {
      name: 'bundle_validation',
      advisory: false,
      pass: validation.valid === true,
      details: validation,
    },
    {
      name: 'bundle_is_bio_token_classifier',
      advisory: false,
      pass: metadata?.bundleType === 'token-classification'
        && featureManifest?.labelSchema === 'BIO',
      details: { bundleType: metadata?.bundleType, labelSchema: featureManifest?.labelSchema },
    },
    {
      name: 'has_training_data',
      advisory: false,
      pass: Number(datasetStats?.rows_total ?? 0) > 0,
      details: datasetStats ?? {},
    },
    {
      name: 'offline_holdout_eval_present',
      advisory: true,
      pass: Number(datasetStats?.rows_val ?? 0) > 0 && Number(datasetStats?.rows_test ?? 0) > 0,
      details: datasetStats ?? {},
    },
    {
      name: 'phase4_shadow_history_present',
      advisory: true,
      pass: shadowHistory.some((entry) => entry.modelVersion === version && entry.shadowDiff),
      details: {
        matchingRows: shadowHistory.filter((entry) => entry.modelVersion === version && entry.shadowDiff).length,
      },
    },
    {
      name: 'engine_benchmark_artifact_present',
      advisory: true,
      pass: Boolean(benchmarkStatus),
      details: benchmarkStatus ?? {},
    },
  ];

  return {
    version,
    bundleDir,
    // Promotion blocks only on the non-advisory (structural) checks; advisory ones are reported.
    pass: checks.filter((check) => !check.advisory).every((check) => check.pass),
    checks,
  };
}

async function runBundleValidationGate(bundleDir: string): Promise<Record<string, unknown>> {
  try {
    return await runPythonJsonCommand(
      [resolve(resolveMlServiceRoot(), 'tools', 'validate_bundle.py'), bundleDir],
      { cwd: resolveMlServiceRoot() },
    );
  } catch (error) {
    const details = error instanceof AppError
      ? error.details as Record<string, unknown> | undefined
      : undefined;
    const stdout = typeof details?.stdout === 'string' ? details.stdout : '';
    try {
      return JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      return {
        valid: false,
        errors: [
          error instanceof Error ? error.message : 'Bundle validation command failed.',
        ],
      };
    }
  }
}

async function readJsonRecord(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readStyleBundleStatus() {
  const modelRoot = resolveStyleModelRoot();
  const currentPath = resolve(modelRoot, 'current', 'style_model.json');
  const stagedRoot = resolve(modelRoot, 'staged');

  const current = await readBundleFile(currentPath);
  const stagedVersions = await listDirectoryNames(stagedRoot);

  return {
    modelRoot,
    current,
    stagedVersions,
  };
}

async function readBioBundleStatus() {
  const modelRoot = resolveBioModelRoot();

  return {
    modelRoot,
    current: await readBundleFile(resolve(modelRoot, 'current', 'metadata.json')),
    stagedVersions: await listDirectoryNames(resolve(modelRoot, 'staged')),
    promotedVersions: await listDirectoryNames(resolve(modelRoot, 'promoted')),
  };
}

// Counts rows the trainer would actually train on: `train` split, or no split set
// (the trainer treats unsplit rows as train). Holdout/val/test/eval rows do not
// count — a dataset of only those (e.g. real_corpus_gold_v1, all `holdout`) yields
// zero train rows, which makes the trainer exit with "No train rows available".
function countBioTrainRows(content: string): number {
  let trainRows = 0;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const split = (JSON.parse(trimmed) as { dataset_split?: string }).dataset_split;
      if (!split || split === 'train') trainRows += 1;
    } catch {
      // Unparseable line — ignore for the train-row tally.
    }
  }
  return trainRows;
}

async function readBioDatasetStatus() {
  const datasetRoot = resolveBioDatasetRoot();
  const processedRoot = resolve(datasetRoot, 'processed');
  const availableDatasets = existsSync(processedRoot)
    ? await Promise.all(
      (await readdir(processedRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl'))
        .map(async (entry) => {
          const path = resolve(processedRoot, entry.name);
          const [content, fileStats] = await Promise.all([
            readFile(path, 'utf8'),
            stat(path),
          ]);

          return {
            fileName: entry.name,
            path,
            rowCount: content.split(/\r?\n/).filter((line) => line.trim().length > 0).length,
            trainRowCount: countBioTrainRows(content),
            sizeBytes: fileStats.size,
            updatedAt: fileStats.mtime.toISOString(),
          };
        }),
    )
    : [];

  availableDatasets.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return {
    datasetRoot,
    processedRoot,
    availableDatasets,
  };
}

async function readBenchmarkStatus() {
  const resultsRoot = resolveBenchmarkResultsRoot();
  const searchRoots = [...new Set([resultsRoot, resolve(resultsRoot, 'local')])];
  const candidateFiles: Array<{
    fileName: string;
    path: string;
    mtimeMs: number;
    score: number;
  }> = [];

  for (const root of searchRoots) {
    if (!existsSync(root)) {
      continue;
    }

    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
        continue;
      }

      const score = scoreBenchmarkArtifact(entry.name);
      if (score < 0) {
        continue;
      }

      const path = resolve(root, entry.name);
      const fileStats = await stat(path);
      candidateFiles.push({
        fileName: entry.name,
        path,
        mtimeMs: fileStats.mtimeMs,
        score,
      });
    }
  }

  candidateFiles.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.mtimeMs - left.mtimeMs;
  });

  const selected = candidateFiles[0];
  if (!selected) {
    return null;
  }

  try {
    const payload = JSON.parse(await readFile(selected.path, 'utf8')) as Record<string, unknown>;
    const throughput = normalizeBenchmarkThroughput(payload);

    return {
      latestCanonicalParallel: {
        fileName: selected.fileName,
        path: selected.path,
        sourceKind: selected.fileName.includes('.median_')
          ? 'median'
          : selected.fileName.endsWith('.latest.json')
            ? 'latest'
            : 'artifact',
        benchmarkVariant: typeof payload.benchmarkVariant === 'string' ? payload.benchmarkVariant : null,
        profile: typeof payload.profile === 'string' ? payload.profile : null,
        hardwareProfile: typeof payload.hardwareProfile === 'string' ? payload.hardwareProfile : null,
        recordedAt: resolveBenchmarkRecordedAt(payload, selected.mtimeMs),
        iterations: typeof payload.iterations === 'number'
          ? payload.iterations
          : Array.isArray(payload.runs)
            ? payload.runs.length
            : null,
        targetStatus: typeof payload.target_status === 'string' ? payload.target_status : null,
        fieldHashStable: typeof payload.field_hash_stable === 'boolean' ? payload.field_hash_stable : null,
        contractHashStable: typeof payload.contract_hash_stable === 'boolean' ? payload.contract_hash_stable : null,
        medianRefsPerSec: throughput?.median ?? null,
        bestRefsPerSec: throughput?.best ?? null,
        worstRefsPerSec: throughput?.worst ?? null,
      },
      availableArtifacts: candidateFiles.slice(0, 6).map((file) => ({
        fileName: file.fileName,
        path: file.path,
      })),
    };
  } catch {
    return {
      latestCanonicalParallel: null,
      availableArtifacts: candidateFiles.slice(0, 6).map((file) => ({
        fileName: file.fileName,
        path: file.path,
      })),
    };
  }
}

async function readBundleFile(path: string) {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const payload = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const labelsFromArray = Array.isArray(payload.labels)
      ? payload.labels.filter((label): label is string => typeof label === 'string')
      : [];
    const labelsFromMap = !labelsFromArray.length
      && typeof payload.id2label === 'object'
      && payload.id2label !== null
      ? Object.values(payload.id2label as Record<string, unknown>)
        .filter((label): label is string => typeof label === 'string')
      : [];

    return {
      path,
      modelVersion: typeof payload.modelVersion === 'string' ? payload.modelVersion : null,
      featureVersion: typeof payload.featureVersion === 'string' ? payload.featureVersion : null,
      generatedAt: typeof payload.generatedAt === 'string'
        ? payload.generatedAt
        : typeof payload.promotedAt === 'string'
          ? payload.promotedAt
          : null,
      bundleType: typeof payload.bundleType === 'string' ? payload.bundleType : null,
      bundleClass: typeof payload.bundleClass === 'string' ? payload.bundleClass : null,
      datasetTrack: typeof payload.datasetTrack === 'string' ? payload.datasetTrack : null,
      datasetSource: typeof payload.datasetSource === 'string' ? payload.datasetSource : null,
      datasetStats: typeof payload.datasetStats === 'object' && payload.datasetStats !== null
        ? payload.datasetStats as Record<string, unknown>
        : null,
      labels: labelsFromArray.length > 0 ? labelsFromArray : labelsFromMap,
    };
  } catch {
    return {
      path,
      modelVersion: null,
      featureVersion: null,
      generatedAt: null,
      bundleType: null,
      bundleClass: null,
      datasetTrack: null,
      datasetSource: null,
      datasetStats: null,
      labels: [],
    };
  }
}

async function listDirectoryNames(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
}

function scoreBenchmarkArtifact(fileName: string): number {
  const normalized = fileName.toLowerCase();
  if (!normalized.includes('parallel') || !normalized.endsWith('.json')) {
    return -1;
  }

  let score = 0;
  if (normalized.includes('full_canonical.parallel')) {
    score += 100;
  } else if (normalized.includes('canonical.parallel')) {
    score += 90;
  } else {
    score += 20;
  }

  if (normalized.includes('.median_')) {
    score += 15;
  }
  if (normalized.endsWith('.latest.json')) {
    score += 10;
  }
  if (normalized.includes('current-runtime')) {
    score += 5;
  }
  if (normalized.includes('local')) {
    score += 2;
  }

  return score;
}

function normalizeBenchmarkThroughput(payload: Record<string, unknown>) {
  const direct = payload.throughput_refs_per_sec;
  if (typeof direct === 'number') {
    return {
      median: direct,
      best: direct,
      worst: direct,
    };
  }

  if (typeof direct === 'object' && direct !== null) {
    const throughput = direct as Record<string, unknown>;
    const median = typeof throughput.median === 'number' ? throughput.median : null;
    const best = typeof throughput.best === 'number' ? throughput.best : median;
    const worst = typeof throughput.worst === 'number' ? throughput.worst : median;
    if (median !== null || best !== null || worst !== null) {
      return {
        median,
        best,
        worst,
      };
    }
  }

  const runtimeMetrics = typeof payload.runtime_metrics === 'object' && payload.runtime_metrics !== null
    ? payload.runtime_metrics as Record<string, unknown>
    : null;
  const runtimeThroughput = runtimeMetrics?.throughput_refs_per_sec;
  if (typeof runtimeThroughput === 'number') {
    return {
      median: runtimeThroughput,
      best: runtimeThroughput,
      worst: runtimeThroughput,
    };
  }

  return null;
}

function resolveBenchmarkRecordedAt(payload: Record<string, unknown>, fallbackMtimeMs: number): string {
  const candidates = [
    payload.recordedAt,
    payload.completedAt,
    payload.finishedAt,
    payload.endedAt,
    payload.generatedAt,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return new Date(fallbackMtimeMs).toISOString();
}

async function readMlHealth() {
  try {
    return await new HttpMLClient().health();
  } catch (error) {
    return {
      status: 'unavailable' as const,
      message: error instanceof Error ? error.message : 'ML health unavailable.',
    };
  }
}

async function runPythonJsonCommand(
  args: string[],
  options: { cwd: string; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const stdout = await runPythonTextCommand(args, options);
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new AppError(
      500,
      ErrorCode.INTERNAL_ERROR,
      'Python command returned non-JSON output.',
      { stdout },
    );
  }
}

async function runPythonTextCommand(
  args: string[],
  options: { cwd: string; timeoutMs?: number },
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pythonPath = process.env.PYTHONPATH
    ? `${options.cwd}${process.platform === 'win32' ? ';' : ':'}${process.env.PYTHONPATH}`
    : options.cwd;

  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn('python', args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timeout = setTimeout(() => {
      if (!finished) {
        child.kill();
        reject(
          new AppError(504, ErrorCode.INTERNAL_ERROR, 'Python command timed out.', {
            args: [basename(args[0] ?? 'python'), ...args.slice(1)],
          }),
        );
      }
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      reject(
        new AppError(500, ErrorCode.INTERNAL_ERROR, `Python command failed to start: ${error.message}`, {
          args: [basename(args[0] ?? 'python'), ...args.slice(1)],
        }),
      );
    });
    child.on('close', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }
      reject(
        new AppError(500, ErrorCode.INTERNAL_ERROR, 'Python command failed.', {
          args: [basename(args[0] ?? 'python'), ...args.slice(1)],
          code,
          stdout: stdout.trim() || undefined,
          stderr: stderr.trim() || undefined,
        }),
      );
    });
  });
}
