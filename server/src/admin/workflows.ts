import { randomUUID } from 'node:crypto';
import type { ConvertRequest } from '../engine/types/api.js';
import type {
  CanonicalAuthor,
  ProcessedCitation,
  ExtractedFields,
} from '../engine/types/citation.js';
import {
  applyCarrierToProcessedCitation,
  hydrateCarrierFromProcessedCitation,
  rescoreCarrierAfterCorrection,
} from '../engine/rescoring.js';
import { fieldOf } from '../engine/types/field.js';
import { EXTRACTED_FIELD_KEYS, isExtractedFieldKey, setExtractedField, type ExtractedFieldKey } from '../engine/utils/fields.js';
import { createPipelineDependencies } from '../pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../pipeline/orchestrator.js';
import {
  appendCitationVersion,
  getCitation,
  saveCitationExtractionHistory,
  listJobs,
  listApprovedTruth,
  type StoredCorrection,
  type StoredFieldApprovalMap,
  type StoredReport,
  type StoredJob,
  updateCitation,
  upsertApprovedTruthPayload,
} from '../runtime/persistence.js';
import { enqueueBatchHealthSummaryRebuild } from './batchHealthSummary.js';
import {
  findApprovedTruthByAdminRawText,
  normalizeAdminTruthRawText,
} from './adminTruthRawText.js';

export async function findJobByCitationId(citationId: string): Promise<StoredJob | undefined> {
  const jobs = await listJobs();
  return jobs.find((job) => job.result?.references.some((citation) => citation.id === citationId));
}

export interface ReportResolutionInput {
  saveAsTruth: boolean;
  correctedFields?: Record<string, unknown>;
  fieldApproval?: StoredFieldApprovalMap;
}

const ADMIN_TO_ENGINE_REFERENCE_TYPE: Record<string, ProcessedCitation['referenceType']> = {
  journal: 'article-journal',
  book: 'book',
  bookChapter: 'book-chapter',
  conference: 'conference-paper',
  website: 'webpage',
  report: 'report',
  thesis: 'thesis',
  preprint: 'preprint',
  other: 'unknown',
};

function normalizeAdminAuthor(author: unknown): CanonicalAuthor | null {
  if (!author || typeof author !== 'object' || Array.isArray(author)) {
    return null;
  }

  const value = author as {
    first?: unknown;
    last?: unknown;
    initials?: unknown;
    literal?: unknown;
    orcid?: unknown;
  };
  const literal = typeof value.literal === 'string' && value.literal.trim()
    ? value.literal.trim()
    : undefined;
  const family = typeof value.last === 'string' && value.last.trim()
    ? value.last.trim()
    : literal;

  if (!family) {
    return null;
  }

  return {
    family,
    given: typeof value.first === 'string' && value.first.trim() ? value.first.trim() : null,
    initials: typeof value.initials === 'string' && value.initials.trim() ? value.initials.trim() : null,
    ...(literal ? { literal } : {}),
    ...(typeof value.orcid === 'string' && value.orcid.trim() ? { orcid: value.orcid.trim() } : {}),
    isCorporate: Boolean(literal),
  };
}

function coerceReportFieldValue(fieldName: string, rawValue: unknown): unknown {
  if (fieldName === 'referenceType') {
    return typeof rawValue === 'string' ? (ADMIN_TO_ENGINE_REFERENCE_TYPE[rawValue] ?? 'unknown') : 'unknown';
  }

  if (fieldName === 'year') {
    if (typeof rawValue === 'number') return rawValue;
    if (typeof rawValue === 'string') {
      const match = rawValue.match(/\b((?:19|20)\d{2})\b/);
      return match ? Number(match[1]) : rawValue.trim();
    }
  }

  if ((fieldName === 'authors' || fieldName === 'editors') && Array.isArray(rawValue)) {
    return rawValue.map(normalizeAdminAuthor).filter((author): author is CanonicalAuthor => author != null);
  }

  return typeof rawValue === 'string' ? rawValue.trim() : rawValue;
}

export async function approveCorrection(correction: StoredCorrection): Promise<ProcessedCitation | undefined> {
  const citation = await getCitation(correction.jobId, correction.citationId);
  if (!citation) return undefined;
  if (!isExtractedFieldKey(correction.fieldName)) {
    throw new Error(`Unsupported correction field: ${correction.fieldName}`);
  }
  const fieldName: ExtractedFieldKey = correction.fieldName;

  await saveVersion(correction.jobId, citation, 'before_admin_approval');

  const correctedValue = coerceCorrectionValue(fieldName, correction.newValue);
  const updated = await updateCitation(correction.jobId, correction.citationId, (current) => {
    const nextFields = structuredClone(current.fields) as ExtractedFields;

    if (fieldName === 'year' && typeof correctedValue === 'number') {
      nextFields.year = fieldOf(correctedValue, 'admin_confirmed', 'admin_approval', 1);
    } else if ((fieldName === 'authors' || fieldName === 'editors') && Array.isArray(correctedValue)) {
      setExtractedField(
        nextFields,
        fieldName,
        fieldOf(correctedValue, 'admin_confirmed', 'admin_approval', 1) as ExtractedFields[typeof fieldName],
      );
    } else if (typeof correctedValue === 'string') {
      setExtractedField(
        nextFields,
        fieldName,
        fieldOf(correctedValue, 'admin_confirmed', 'admin_approval', 1) as ExtractedFields[typeof fieldName],
      );
    }

    current.fields = nextFields;
  });

  if (!updated) return undefined;

  const rescoredCarrier = hydrateCarrierFromProcessedCitation(updated);
  const rescoreCtx = createPipelineContext({
    jobId: correction.jobId,
    outputStyle: updated.outputStyle,
  });
  await rescoreCarrierAfterCorrection(rescoredCarrier, rescoreCtx, [correction.fieldName]);
  const rescored = await updateCitation(correction.jobId, correction.citationId, (current) => {
    applyCarrierToProcessedCitation(current, rescoredCarrier);
  });
  if (!rescored) return undefined;

  await saveVersion(correction.jobId, rescored, 'after_admin_approval');
  await persistApprovedTruth(rescored, 'admin_resolution');
  await syncJobAggregates(correction.jobId);
  return rescored;
}

export async function reprocessCitation(citationId: string): Promise<ProcessedCitation | undefined> {
  const job = await findJobByCitationId(citationId);
  if (!job?.result) return undefined;

  const existing = job.result.references.find((citation) => citation.id === citationId);
  if (!existing) return undefined;

  await saveVersion(job.id, existing, 'before_reprocess');

  const request: ConvertRequest = {
    sourceType: /^\s*10\.\d{4,9}\//i.test(existing.raw) ? 'doi_list' : 'text',
    content: existing.raw,
    outputStyle: existing.outputStyle,
  };
  const ctx = createPipelineContext({
    jobId: randomUUID(),
    outputStyle: existing.outputStyle,
  });
  const artifacts = await runConvertPipeline(request, ctx, createPipelineDependencies());
  const rerun = structuredClone(artifacts.response.references[0]);
  if (!rerun) return undefined;

  for (const key of EXTRACTED_FIELD_KEYS) {
    const field = existing.fields[key];
    if (field.source === 'admin_confirmed') {
      setExtractedField(rerun.fields, key, structuredClone(field) as ExtractedFields[typeof key]);
    }
  }

  const updated = await updateCitation(job.id, citationId, (current) => {
    current.publicStatus = rerun.publicStatus;
    current.status = rerun.status;
    if (rerun.error) {
      current.error = rerun.error;
    } else {
      delete current.error;
    }
    if (rerun.partialData) {
      current.partialData = rerun.partialData;
    } else {
      delete current.partialData;
    }
    current.referenceType = rerun.referenceType;
    current.detectedStyle = rerun.detectedStyle;
    current.outputStyle = rerun.outputStyle;
    current.fields = rerun.fields;
    current.rawScore = rerun.rawScore;
    current.displayScore = rerun.displayScore;
    current.scoreBreakdown = rerun.scoreBreakdown;
    current.healthReasons = rerun.healthReasons;
    current.healthBreakdown = rerun.healthBreakdown;
    current.healthWarnings = rerun.healthWarnings;
    current.authorityFlags = rerun.authorityFlags;
    current.renderedText = rerun.renderedText;
    current.renderedWarnings = rerun.renderedWarnings;
    if (rerun.extractionMeta) {
      current.extractionMeta = rerun.extractionMeta;
    } else {
      delete current.extractionMeta;
    }
    current.stageLog = rerun.stageLog;
  });

  if (!updated) return undefined;

  await saveVersion(job.id, updated, 'after_reprocess');
  if (updated.extractionMeta) {
    await saveCitationExtractionHistory({
      id: randomUUID(),
      citationId: updated.id,
      jobId: job.id,
      ...structuredClone(updated.extractionMeta),
    });
  }
  await persistApprovedTruth(updated, 'validated_ml_fix');
  await syncJobAggregates(job.id);
  return updated;
}

export async function applyReportResolution(
  report: StoredReport,
  input: ReportResolutionInput,
): Promise<ProcessedCitation | undefined> {
  if (!report.jobId || !report.citationId) {
    return undefined;
  }

  const citation = await getCitation(report.jobId, report.citationId);
  if (!citation) {
    return undefined;
  }

  const approvedEntries = Object.entries(input.fieldApproval ?? {}).filter(([, decision]) => {
    return Boolean(decision?.approved);
  });

  if (approvedEntries.length === 0) {
    if (input.saveAsTruth) {
      await persistApprovedTruth(citation, 'admin_resolution');
    }
    return citation;
  }

  await saveVersion(report.jobId, citation, 'before_report_resolution');

  const updated = await updateCitation(report.jobId, report.citationId, (current) => {
    const nextFields = structuredClone(current.fields) as ExtractedFields;

    for (const [fieldName, decision] of approvedEntries) {
      if (fieldName !== 'referenceType' && !isExtractedFieldKey(fieldName)) {
        throw new Error(`Unsupported report-resolution field: ${fieldName}`);
      }

      const nextValue = coerceReportFieldValue(
        fieldName,
        decision?.value ?? input.correctedFields?.[fieldName],
      );

      if (fieldName === 'referenceType') {
        current.referenceType = nextValue as ProcessedCitation['referenceType'];
        continue;
      }

      if (fieldName === 'year' && typeof nextValue === 'number') {
        nextFields.year = fieldOf(nextValue, 'admin_confirmed', 'admin_report_resolution', 1);
        continue;
      }

      if ((fieldName === 'authors' || fieldName === 'editors') && Array.isArray(nextValue)) {
        setExtractedField(
          nextFields,
          fieldName,
          fieldOf(nextValue, 'admin_confirmed', 'admin_report_resolution', 1) as ExtractedFields[typeof fieldName],
        );
        continue;
      }

      if (typeof nextValue === 'string') {
        setExtractedField(
          nextFields,
          fieldName,
          fieldOf(nextValue, 'admin_confirmed', 'admin_report_resolution', 1) as ExtractedFields[typeof fieldName],
        );
      }
    }

    current.fields = nextFields;
  });

  if (!updated) {
    return undefined;
  }

  const rescoredCarrier = hydrateCarrierFromProcessedCitation(updated);
  const changedFields = approvedEntries.map(([fieldName]) => fieldName);
  if (changedFields.includes('referenceType')) {
    rescoredCarrier.type.type = updated.referenceType;
    changedFields.push('title');
  }

  const rescoreCtx = createPipelineContext({
    jobId: report.jobId,
    outputStyle: updated.outputStyle,
  });
  await rescoreCarrierAfterCorrection(rescoredCarrier, rescoreCtx, changedFields);
  const rescored = await updateCitation(report.jobId, report.citationId, (current) => {
    applyCarrierToProcessedCitation(current, rescoredCarrier);
  });
  if (!rescored) {
    return undefined;
  }

  await saveVersion(report.jobId, rescored, 'after_report_resolution');
  if (input.saveAsTruth) {
    await persistApprovedTruth(rescored, 'admin_resolution');
  }
  await syncJobAggregates(report.jobId);
  return rescored;
}

async function saveVersion(jobId: string, citation: ProcessedCitation, source: string): Promise<void> {
  await appendCitationVersion({
    id: randomUUID(),
    citationId: citation.id,
    jobId,
    fields: structuredClone(citation.fields),
    source,
    createdAt: new Date().toISOString(),
  });
}

async function syncJobAggregates(jobId: string): Promise<void> {
  await enqueueBatchHealthSummaryRebuild(jobId);
}

async function persistApprovedTruth(
  citation: ProcessedCitation,
  provenance: 'admin_resolution' | 'validated_ml_fix',
): Promise<void> {
  if (citation.publicStatus !== 'ready') {
    return;
  }

  const rawText = normalizeAdminTruthRawText(citation.raw);
  const existingApprovedTruth = findApprovedTruthByAdminRawText(
    await listApprovedTruth({ limit: 50_000 }),
    rawText,
  );
  if (existingApprovedTruth) {
    return;
  }

  const expectedFields = Object.fromEntries(
    Object.entries(citation.fields).map(([key, value]) => [key, value?.value ?? null]),
  );

  await upsertApprovedTruthPayload({
    rawText,
    expectedFields,
    expectedType: citation.referenceType,
    expectedStyle: citation.outputStyle,
    provenance,
    pipelineMajor: citation.pipelineMajor,
    reviewedBy: provenance === 'admin_resolution' ? 'admin' : 'system',
    notes: citation.healthReasons.join('; ') || null,
    trustLevel: 'reviewed',
  });
}

function coerceCorrectionValue(fieldName: string, rawValue: unknown): unknown {
  if (fieldName === 'year') {
    if (typeof rawValue === 'number') return rawValue;
    if (typeof rawValue === 'string') {
      const match = rawValue.match(/\b((?:19|20)\d{2})\b/);
      return match ? Number(match[1]) : rawValue;
    }
  }

  if ((fieldName === 'authors' || fieldName === 'editors') && Array.isArray(rawValue)) {
    return rawValue;
  }

  return typeof rawValue === 'string' ? rawValue.trim() : rawValue;
}
