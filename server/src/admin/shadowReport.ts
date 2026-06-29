import { FIELD_CONFIDENCE_THRESHOLDS, getFieldSchema, resolveSchemaStyle } from '../engine/mandatory-fields.js';
import { toHealthWarning, uniqueHealthWarnings } from '../engine/healthWarnings.js';
import { validateMandatoryField } from '../engine/healthRules.js';
import type {
  ExtractedFields,
  HealthWarning,
  ProcessedCitation,
  PublicStatus,
  ReferenceType,
} from '../engine/types/citation.js';
import { fieldOf, isTrustedFieldOrigin } from '../engine/types/field.js';
import type { StoredCitationExtractionHistory } from '../runtime/store.js';
import {
  EXTRACTED_FIELD_KEYS,
  createEmptyExtractedFields,
  hasFieldValue,
  isExtractedFieldKey,
  setExtractedField,
  type ExtractedFieldKey,
} from '../engine/utils/fields.js';

const SHADOW_REPORT_STAGE_ID = 'admin_shadow_report_projection';
const EXTRACTION_WARNING_CODES = new Set(['invalid_author_span']);

export interface ShadowReport {
  generatedAt: string;
  totalShadowRows: number;
  matchedCitations: number;
  missingCitationSnapshots: number;
  divergencesByField: Array<{
    field: ExtractedFieldKey;
    divergent: number;
    changed: number;
    added: number;
    removed: number;
  }>;
  averageSeverityByReferenceType: Array<{
    referenceType: ReferenceType;
    averageSeverityScore: number;
    count: number;
  }>;
  projectedHealthStateChanges: {
    changed: number;
    unchanged: number;
    transitions: Array<{
      from: PublicStatus;
      to: PublicStatus;
      count: number;
    }>;
  };
}

export function buildShadowReport(
  citations: ProcessedCitation[],
  shadowRows: StoredCitationExtractionHistory[],
): ShadowReport {
  const citationsById = new Map(citations.map((citation) => [citation.id, citation]));
  const divergenceByField = new Map<
    ExtractedFieldKey,
    { divergent: number; changed: number; added: number; removed: number }
  >();
  const severityByType = new Map<ReferenceType, { total: number; count: number }>();
  const transitionCounts = new Map<string, number>();

  let matchedCitations = 0;
  let missingCitationSnapshots = 0;
  let changedHealthStates = 0;

  for (const row of shadowRows) {
    const citation = citationsById.get(row.citationId);
    if (!citation) {
      missingCitationSnapshots += 1;
      continue;
    }

    const shadowDiff = row.shadowDiff;
    if (!shadowDiff) continue;

    matchedCitations += 1;

    for (const [field, status] of Object.entries(shadowDiff.perFieldDiff)) {
      if (!isExtractedFieldKey(field) || status === 'same') continue;
      const entry = divergenceByField.get(field) ?? {
        divergent: 0,
        changed: 0,
        added: 0,
        removed: 0,
      };
      entry.divergent += 1;
      if (status === 'changed') entry.changed += 1;
      if (status === 'added') entry.added += 1;
      if (status === 'removed') entry.removed += 1;
      divergenceByField.set(field, entry);
    }

    const severity = severityByType.get(citation.referenceType) ?? { total: 0, count: 0 };
    severity.total += shadowDiff.severityScore;
    severity.count += 1;
    severityByType.set(citation.referenceType, severity);

    const currentStatus = deriveExtractionStageStatus(citation);
    const projectedStatus = deriveProjectedMlStatus(citation, row);
    const transitionKey = `${currentStatus}->${projectedStatus}`;
    transitionCounts.set(transitionKey, (transitionCounts.get(transitionKey) ?? 0) + 1);
    if (currentStatus !== projectedStatus) {
      changedHealthStates += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalShadowRows: shadowRows.length,
    matchedCitations,
    missingCitationSnapshots,
    divergencesByField: [...divergenceByField.entries()]
      .map(([field, counts]) => ({
        field,
        divergent: counts.divergent,
        changed: counts.changed,
        added: counts.added,
        removed: counts.removed,
      }))
      .sort((left, right) => right.divergent - left.divergent || left.field.localeCompare(right.field)),
    averageSeverityByReferenceType: [...severityByType.entries()]
      .map(([referenceType, stats]) => ({
        referenceType,
        averageSeverityScore: Number((stats.total / stats.count).toFixed(3)),
        count: stats.count,
      }))
      .sort((left, right) => right.averageSeverityScore - left.averageSeverityScore),
    projectedHealthStateChanges: {
      changed: changedHealthStates,
      unchanged: matchedCitations - changedHealthStates,
      transitions: [...transitionCounts.entries()]
        .map(([transition, count]) => {
          const [from, to] = transition.split('->') as [PublicStatus, PublicStatus];
          return { from, to, count };
        })
        .sort((left, right) => right.count - left.count || left.from.localeCompare(right.from)),
    },
  };
}

function deriveExtractionStageStatus(citation: ProcessedCitation): PublicStatus {
  const warnings = filterExtractionStageWarnings(citation.healthWarnings);
  return decidePublicStatus({
    missingMandatory: citation.healthBreakdown.missingMandatory,
    invalidMandatory: citation.healthBreakdown.invalidMandatory,
    lowConfidenceMandatory: citation.healthBreakdown.lowConfidenceMandatory,
    warnings,
  });
}

function deriveProjectedMlStatus(
  citation: ProcessedCitation,
  row: StoredCitationExtractionHistory,
): PublicStatus {
  const schemaStyle = resolveSchemaStyle(citation.outputStyle, citation.detectedStyle);
  const schema = getFieldSchema(citation.referenceType, schemaStyle);
  const projectedFields = projectMlFields(citation, row);
  const touchedMandatoryFields = new Set(
    schema.mandatory.filter((field) => {
      const diff = row.shadowDiff?.perFieldDiff[field];
      return Boolean(
        diff && diff !== 'same'
        || row.fieldConfidences[field] !== undefined
        || row.uncertainFields.includes(field)
      );
    }),
  );

  const missingMandatory = new Set(citation.healthBreakdown.missingMandatory);
  const invalidMandatory = new Set(citation.healthBreakdown.invalidMandatory);
  const lowConfidenceMandatory = new Set(citation.healthBreakdown.lowConfidenceMandatory);
  const presentMandatory = new Set(citation.healthBreakdown.presentMandatory);

  for (const field of touchedMandatoryFields) {
    missingMandatory.delete(field);
    invalidMandatory.delete(field);
    lowConfidenceMandatory.delete(field);
    presentMandatory.delete(field);

    const projectedField = projectedFields[field];
    if (!hasFieldValue(projectedField)) {
      missingMandatory.add(field);
      continue;
    }

    const validation = validateMandatoryField(field, projectedField.value);
    if (!validation.valid) {
      invalidMandatory.add(field);
      continue;
    }

    presentMandatory.add(field);
    const threshold = FIELD_CONFIDENCE_THRESHOLDS[field] ?? 0.7;
    if (!isTrustedFieldOrigin(projectedField.origin) && projectedField.confidence < threshold) {
      lowConfidenceMandatory.add(field);
    }
  }

  return decidePublicStatus({
    missingMandatory: [...missingMandatory],
    invalidMandatory: [...invalidMandatory],
    lowConfidenceMandatory: [...lowConfidenceMandatory],
    warnings: buildProjectedWarnings(citation, row),
  });
}

function projectMlFields(
  citation: ProcessedCitation,
  row: StoredCitationExtractionHistory,
): ExtractedFields {
  const projected = structuredClone(citation.fields);
  const emptyFields = createEmptyExtractedFields(SHADOW_REPORT_STAGE_ID, 'ml_extraction');
  const touchedFields = new Set<ExtractedFieldKey>();

  for (const field of EXTRACTED_FIELD_KEYS) {
    const diffStatus = row.shadowDiff?.perFieldDiff[field];
    if (diffStatus && diffStatus !== 'same') touchedFields.add(field);
    if (row.fieldConfidences[field] !== undefined) touchedFields.add(field);
    if (row.uncertainFields.includes(field)) touchedFields.add(field);
  }

  for (const field of touchedFields) {
    const diffStatus = row.shadowDiff?.perFieldDiff[field];
    if (diffStatus === 'removed') {
      setExtractedField(projected, field, emptyFields[field]);
      continue;
    }

    const hasMlValue = Object.prototype.hasOwnProperty.call(row.shadowDiff?.mlFields ?? {}, field);
    const confidence = row.fieldConfidences[field] ?? projected[field].confidence;
    const uncertain = row.uncertainFields.includes(field);

    if (hasMlValue) {
      const nextValue = row.shadowDiff?.mlFields[field];
      setExtractedField(
        projected,
        field,
        fieldOf(
          nextValue as never,
          'ml_extraction',
          SHADOW_REPORT_STAGE_ID,
          confidence,
          {
            uncertain,
            previousValue: projected[field].value as never,
            previousSource: projected[field].source,
            previousOrigin: projected[field].origin,
          },
        ) as ExtractedFields[typeof field],
      );
      continue;
    }

    if (hasFieldValue(projected[field])) {
      setExtractedField(
        projected,
        field,
        fieldOf(
          projected[field].value as never,
          'ml_extraction',
          SHADOW_REPORT_STAGE_ID,
          confidence,
          {
            uncertain,
            previousValue: projected[field].value as never,
            previousSource: projected[field].source,
            previousOrigin: projected[field].origin,
          },
        ) as ExtractedFields[typeof field],
      );
    }
  }

  return projected;
}

function buildProjectedWarnings(
  citation: ProcessedCitation,
  row: StoredCitationExtractionHistory,
): HealthWarning[] {
  const preservedWarnings = filterExtractionStageWarnings(citation.healthWarnings)
    .filter((warning) => !isExtractionSpecificWarningCode(warning.code));
  const mlWarnings = [
    ...row.uncertainFields.map((field) => toHealthWarning(`uncertain_${field}`)),
    ...(hasInvalidAuthorSpan(row) ? [toHealthWarning('invalid_author_span', 'invalid author span')] : []),
  ];

  return uniqueHealthWarnings([...preservedWarnings, ...mlWarnings]);
}

function filterExtractionStageWarnings(warnings: HealthWarning[]): HealthWarning[] {
  return warnings.filter((warning) => !warning.code.startsWith('authority_') && !warning.code.startsWith('render_'));
}

function isExtractionSpecificWarningCode(code: string): boolean {
  return code.startsWith('uncertain_') || EXTRACTION_WARNING_CODES.has(code);
}

function hasInvalidAuthorSpan(row: StoredCitationExtractionHistory): boolean {
  return (row.entities ?? []).some((entity) => entity.field === 'authors' && entity.valid === false);
}

function decidePublicStatus(input: {
  missingMandatory: string[];
  invalidMandatory: string[];
  lowConfidenceMandatory: string[];
  warnings: HealthWarning[];
}): PublicStatus {
  if (
    input.missingMandatory.length > 0
    || input.invalidMandatory.length > 0
    || input.warnings.some((warning) => warning.severity === 'action')
  ) {
    return 'needs_action';
  }

  if (
    input.lowConfidenceMandatory.length > 0
    || input.warnings.some((warning) => warning.severity === 'review')
  ) {
    return 'needs_review';
  }

  return 'ready';
}
