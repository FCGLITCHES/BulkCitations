import { env } from '../config.js';
import { getEffectiveMandatoryThreshold } from '../engine/confidenceCalibration.js';
import { validateMandatoryField } from '../engine/healthRules.js';
import { evaluateFieldSchema, getFieldSchema } from '../engine/mandatory-fields.js';
import type { ConvertResponse } from '../engine/types/api.js';
import type { CitationStyle } from '../engine/types/citation.js';
import type { ProcessedCitation } from '../engine/types/citation.js';
import type { ParseProfile } from '../engine/types/parseProfile.js';
import { createPipelineContext, runConvertPipeline } from '../pipeline/orchestrator.js';
import type { ExtractedFieldKey } from '../engine/utils/fields.js';
import { EXTRACTED_FIELD_KEYS, hasFieldValue } from '../engine/utils/fields.js';

export interface FixedBatchQualityReportOptions {
  label: string;
  expectedCount: number;
  outputStyle?: CitationStyle;
  parseProfile?: ParseProfile;
  includePerReference?: boolean;
}

export interface FixedBatchCitationSummary {
  index: number;
  title: string;
  referenceType: string;
  publicStatus: ProcessedCitation['publicStatus'];
  rawScore: number;
  displayScore: number;
  missingMandatory: string[];
  invalidMandatory: string[];
  lowConfidenceMandatory: string[];
  reasons: string[];
  fieldConfidences: Record<string, number>;
  uncertainFieldCount: number;
}

export interface FixedBatchQualityReport {
  label: string;
  referenceCount: number;
  expectedCount: number;
  summary: ConvertResponse['summary'];
  statusCounts: Record<'ready' | 'needs_review' | 'needs_action', number>;
  statusPercent: Record<'ready' | 'needs_review' | 'needs_action', number>;
  parseQuality: number;
  lowConfidenceMandatoryByField: Record<string, number>;
  missingMandatoryByField: Record<string, number>;
  invalidMandatoryByField: Record<string, number>;
  topHealthReasons: Record<string, number>;
  mandatoryFieldConfidence: Record<string, { count: number; min: number; max: number; avg: number }>;
  scoreStats: { min: number; max: number; avg: number };
  providerUsage: ConvertResponse['providerUsage'];
  perReference?: FixedBatchCitationSummary[];
  notReadyReferences?: FixedBatchCitationSummary[];
}

export async function buildFixedBatchQualityReport(
  content: string,
  options: FixedBatchQualityReportOptions,
): Promise<FixedBatchQualityReport> {
  const outputStyle = options.outputStyle ?? 'apa7';
  const ctx = createPipelineContext({
    outputStyle,
    options: {
      parseProfile: options.parseProfile ?? 'core_parse_full',
      llmFallback: env.ENABLE_LLM_FALLBACK,
      enablePdfCleanup: env.FEATURE_PDF_CLEANUP,
      pdfCleanupMode: 'full',
      feedbackLoop: false,
    },
    tenantContext: {
      skipApprovedTruthOverlays: true,
    },
  });

  const { response } = await runConvertPipeline(
    {
      sourceType: 'text',
      content,
      outputStyle,
    },
    ctx,
  );

  return summarizeConvertResponse(response, options);
}

export function summarizeConvertResponse(
  response: ConvertResponse,
  options: Pick<FixedBatchQualityReportOptions, 'label' | 'expectedCount' | 'includePerReference'>,
): FixedBatchQualityReport {
  const statusCounts = {
    ready: 0,
    needs_review: 0,
    needs_action: 0,
  } satisfies FixedBatchQualityReport['statusCounts'];

  const lowConfidenceByField = new Map<string, number>();
  const missingByField = new Map<string, number>();
  const invalidByField = new Map<string, number>();
  const reviewReasons = new Map<string, number>();

  const rows = response.references.map((citation, index) => summarizeCitation(citation, index));

  for (const row of rows) {
    statusCounts[row.publicStatus] += 1;
    for (const field of row.lowConfidenceMandatory) {
      lowConfidenceByField.set(field, (lowConfidenceByField.get(field) ?? 0) + 1);
    }
    for (const field of row.missingMandatory) {
      missingByField.set(field, (missingByField.get(field) ?? 0) + 1);
    }
    for (const field of row.invalidMandatory) {
      invalidByField.set(field, (invalidByField.get(field) ?? 0) + 1);
    }
    for (const reason of row.reasons) {
      reviewReasons.set(reason, (reviewReasons.get(reason) ?? 0) + 1);
    }
  }

  const total = response.references.length;
  const scoreValues = rows.map((row) => row.rawScore);

  const report: FixedBatchQualityReport = {
    label: options.label,
    referenceCount: total,
    expectedCount: options.expectedCount,
    summary: response.summary,
    statusCounts,
    statusPercent: {
      ready: pct(statusCounts.ready, total),
      needs_review: pct(statusCounts.needs_review, total),
      needs_action: pct(statusCounts.needs_action, total),
    },
    parseQuality: response.summary.parseQuality,
    lowConfidenceMandatoryByField: Object.fromEntries(sortedEntries(lowConfidenceByField)),
    missingMandatoryByField: Object.fromEntries(sortedEntries(missingByField)),
    invalidMandatoryByField: Object.fromEntries(sortedEntries(invalidByField)),
    topHealthReasons: Object.fromEntries(sortedEntries(reviewReasons).slice(0, 20)),
    mandatoryFieldConfidence: collectMandatoryConfidenceStats(response.references),
    scoreStats: {
      min: scoreValues.length > 0 ? round(Math.min(...scoreValues)) : 0,
      max: scoreValues.length > 0 ? round(Math.max(...scoreValues)) : 0,
      avg: scoreValues.length > 0
        ? round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length)
        : 0,
    },
    providerUsage: response.providerUsage,
    notReadyReferences: rows.filter((row) => row.publicStatus !== 'ready'),
  };

  if (options.includePerReference) {
    report.perReference = rows;
  }

  return report;
}

function summarizeCitation(citation: ProcessedCitation, index: number): FixedBatchCitationSummary {
  const schema = getFieldSchema(citation.referenceType, 'apa7');
  const evaluation = evaluateFieldSchema(citation.fields, schema);
  const lowConfidenceMandatory: string[] = [];
  const missingMandatory = [...evaluation.missingMandatory];
  const invalidMandatory: string[] = [];

  for (const field of evaluation.effectiveSchema.mandatory) {
    const fieldValue = citation.fields[field];
    if (!hasFieldValue(fieldValue)) continue;
    const validation = validateMandatoryField(field, fieldValue.value);
    if (!validation.valid) {
      invalidMandatory.push(String(field));
      continue;
    }
    const threshold = getEffectiveMandatoryThreshold(field, validation.valid);
    if (fieldValue.confidence < threshold) {
      lowConfidenceMandatory.push(String(field));
    }
  }

  const fieldConfidences = Object.fromEntries(
    EXTRACTED_FIELD_KEYS
      .filter((key) => hasFieldValue(citation.fields[key]))
      .map((key) => [key, round(citation.fields[key].confidence)]),
  );

  const uncertainFieldCount = EXTRACTED_FIELD_KEYS
    .filter((key) => citation.fields[key].uncertain).length;

  return {
    index,
    title: truncate(String(citation.fields.title.value ?? '')),
    referenceType: citation.referenceType,
    publicStatus: citation.publicStatus,
    rawScore: round(citation.rawScore),
    displayScore: round(citation.displayScore),
    missingMandatory,
    invalidMandatory,
    lowConfidenceMandatory,
    reasons: citation.healthReasons ?? [],
    fieldConfidences,
    uncertainFieldCount,
  };
}

function collectMandatoryConfidenceStats(citations: ProcessedCitation[]) {
  const buckets = new Map<string, { count: number; min: number; max: number; sum: number }>();

  for (const citation of citations) {
    const schema = getFieldSchema(citation.referenceType, 'apa7');
    for (const field of schema.mandatory) {
      const fieldValue = citation.fields[field as ExtractedFieldKey];
      if (!hasFieldValue(fieldValue)) continue;
      const key = String(field);
      const current = buckets.get(key) ?? { count: 0, min: 1, max: 0, sum: 0 };
      current.count += 1;
      current.min = Math.min(current.min, fieldValue.confidence);
      current.max = Math.max(current.max, fieldValue.confidence);
      current.sum += fieldValue.confidence;
      buckets.set(key, current);
    }
  }

  return Object.fromEntries(
    [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, stats]) => [field, {
        count: stats.count,
        min: round(stats.min),
        max: round(stats.max),
        avg: round(stats.sum / stats.count),
      }]),
  );
}

function sortedEntries(map: Map<string, number>) {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function pct(value: number, total: number) {
  if (total === 0) return 0;
  return round((value / total) * 100);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function truncate(value: string, max = 72) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
