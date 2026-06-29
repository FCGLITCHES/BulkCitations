import { ErrorCode } from '../errors/index.js';
import {
  evaluateFieldSchema,
  getFieldSchema,
  pickRequirementGroupField,
  resolveSchemaStyle,
  type EffectiveFieldSchema,
  type FieldRequirementGroup,
} from '../mandatory-fields.js';
import { getEffectiveMandatoryThreshold } from '../confidenceCalibration.js';
import { toHealthWarning, uniqueHealthWarnings } from '../healthWarnings.js';
import {
  isValidDoi,
  isValidLocatorPages,
  isValidReportNumber,
  validateMandatoryField,
} from '../healthRules.js';
import { addOrReplacePenalty } from '../scoringHelpers.js';
import type { ReferenceCarrier } from '../types/carrier.js';
import type { CanonicalAuthor, ExtractedFields, HealthWarning, ScorePenalty } from '../types/citation.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { isTrustedFieldOrigin } from '../types/field.js';
import { hasFieldValue, resolveEquivalentFieldKey } from '../utils/fields.js';

const CONTRACT_VERSION = 2;
const STAGE_ID = 'phase10_health_validation';
const TYPE_UNKNOWN_CONFIDENCE_THRESHOLD = 0.6;

const FIELD_CONTENT_WARNING_CODES = new Set([
  'invalid_author_span',
  'overlapping_spans',
  'unclosed_bio_sequence',
  'missing_required_ml_span',
]);

export class Phase10Health implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'health_validation' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    let warningCount = 0;

    for (const carrier of carriers) {
      const schemaStyle = ctx.outputStyle !== 'auto' && ctx.outputStyle !== 'unknown'
        ? ctx.outputStyle
        : carrier.styleResolution.effectiveStyleKnown
          ? carrier.styleResolution.effectiveStyle
          : resolveSchemaStyle(ctx.outputStyle, carrier.style.primary.style, carrier.style.family);
      const validationReferenceType = carrier.type.isUnknown || carrier.type.confidence < TYPE_UNKNOWN_CONFIDENCE_THRESHOLD
        ? 'unknown'
        : carrier.type.type;
      const schema = getFieldSchema(validationReferenceType, schemaStyle);
      const evaluation = evaluateFieldSchema(carrier.fields, schema);
      const warnings = buildCarrierWarnings(
        carrier,
        evaluation.effectiveSchema.mandatory.length === 0
          && evaluation.effectiveSchema.requireOneOf.every((group) => group.severity !== 'mandatory'),
      );
      const missingMandatory: string[] = [];
      const invalidMandatory: string[] = [];
      const lowConfidenceMandatory: string[] = [];
      const presentMandatory: string[] = [];
      const reasons: string[] = [];

      for (const field of evaluation.effectiveSchema.mandatory) {
        const label = String(field);
        const resolvedField = resolveEquivalentFieldKey(carrier.fields, field);
        const fieldValue = carrier.fields[resolvedField];
        const present = hasMandatoryPresence(carrier, resolvedField);

        if (!present) {
          missingMandatory.push(label);
          reasons.push(`missing mandatory field: ${field}`);
          if (shouldWarnMissingRequiredMlSpan(carrier, resolvedField)) {
            warnings.push(toHealthWarning(
              'missing_required_ml_span',
              `ML field ${String(resolvedField)} did not have a valid BIO span.`,
            ));
          }
          continue;
        }

        const validation = validateMandatoryField(resolvedField, fieldValue.value);
        if (!validation.valid) {
          invalidMandatory.push(label);
          reasons.push(validation.reason ?? `invalid mandatory field: ${field}`);
          continue;
        }

        presentMandatory.push(label);
        const threshold = getEffectiveMandatoryThreshold(resolvedField, validation.valid);
        if (!isTrustedFieldOrigin(fieldValue.origin) && fieldValue.confidence < threshold) {
          lowConfidenceMandatory.push(label);
          reasons.push(`low confidence in ${field}`);
        }
      }

      for (const group of evaluation.effectiveSchema.requireOneOf.filter((candidate) => candidate.severity === 'mandatory')) {
        evaluateRequirementGroupValidation({
          carrier,
          group,
          missingMandatory,
          invalidMandatory,
          lowConfidenceMandatory,
          presentMandatory,
          reasons,
        });
      }

      if (evaluation.missingPreferred.length > 0) {
        warnings.push(toHealthWarning(
          'missing_preferred_fields',
          `preferred fields missing: ${evaluation.missingPreferred.join(', ')}`,
        ));
      }

      warnings.push(...detectImplausiblePresentFields(carrier));

      const dedupedWarnings = uniqueHealthWarnings(warnings);
      for (const warning of dedupedWarnings) {
        if (warning.severity === 'info') continue;
        reasons.push(reasonForWarning(warning));
      }

      const publicStatus = decidePublicStatus({
        missingMandatory,
        invalidMandatory,
        lowConfidenceMandatory,
        warnings: dedupedWarnings,
      });
      if (publicStatus !== 'ready') warningCount += 1;

      const fieldEvidence = computeFieldEvidenceScore(
        carrier,
        evaluation.effectiveSchema,
        missingMandatory,
        invalidMandatory,
      );
      const structuralSubscores = computeStructuralSubscores(carrier);
      const structuralIntegrityScore = average([
        structuralSubscores.refTypeConfidenceScore,
        structuralSubscores.noDuplicateFieldsScore,
        structuralSubscores.noArtifactTokensScore,
        structuralSubscores.noCorruptedContainerScore,
        structuralSubscores.fieldBoundaryScore,
        structuralSubscores.noDuplicateAuthorScore,
        structuralSubscores.locatorConsistencyScore,
      ]);
      const penalties = computePhase10Penalties(carrier);

      carrier.scoring.publicStatus = publicStatus;
      carrier.scoring.rawScore = 0;
      carrier.scoring.displayScore = 0;
      carrier.scoring.breakdown = {
        ...carrier.scoring.breakdown,
        fieldEvidenceScore: fieldEvidence.score,
        structuralIntegrityScore,
        fieldEvidence: {
          completeness: fieldEvidence.completeness,
          avgMandatoryConfidence: fieldEvidence.avgMandatoryConfidence,
        },
        structuralSubscores,
        penalties,
        authorityAdjustment: carrier.authority.scoreAdjustment,
        rawScore: 0,
        displayScore: 0,
        diagnostics: {
          ...carrier.scoring.breakdown.diagnostics,
          splitQualityFlag: carrier.detection.splitQualityFlag,
          detectionConfidence: carrier.styleResolution.effectiveDetectionConfidence,
          rawDetectionConfidence: carrier.styleResolution.rawDetectionConfidence,
          effectiveDetectionConfidence: carrier.styleResolution.effectiveDetectionConfidence,
        },
      };

      carrier.health = {
        publicStatus,
        baseStatus: publicStatus,
        reasons: [...new Set(reasons)],
        breakdown: {
          missingMandatory,
          invalidMandatory,
          lowConfidenceMandatory,
          presentMandatory,
        },
        warnings: dedupedWarnings,
        demotedBy: 'none',
      };
      carrier.publicStatus = publicStatus;

      carrier.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: publicStatus === 'ready' ? 'success' : 'warning',
          durationMs: 0,
          ...(publicStatus === 'ready' ? {} : { code: ErrorCode.SCORE_HEURISTIC_USED }),
          message: `Health validation assigned ${publicStatus}.`,
          details: {
            schemaStyle,
            validationReferenceType,
            missingMandatory,
            invalidMandatory,
            lowConfidenceMandatory,
            missingPreferred: evaluation.missingPreferred,
            warningCodes: dedupedWarnings.map((warning) => warning.code),
            fieldEvidenceScore: fieldEvidence.score,
            structuralIntegrityScore,
          },
        }),
      );
    }

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: warningCount > 0 ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        ...(warningCount > 0 ? { code: ErrorCode.SCORE_HEURISTIC_USED } : {}),
        message: warningCount > 0
          ? `Phase 10 health validation flagged ${warningCount} references.`
          : 'Phase 10 health validation completed.',
      }),
    );

    return carriers;
  }
}

export const phase10Health = new Phase10Health();

function buildCarrierWarnings(
  carrier: ReferenceCarrier,
  schemaWithoutMandatoryFields: boolean,
): HealthWarning[] {
  const warnings: HealthWarning[] = [...carrier.healthEvidence.warnings];

  for (const flag of carrier.splitMeta.flags) {
    if (flag === 'uncertain') warnings.push(toHealthWarning('uncertain_split_block', 'split boundary remains uncertain'));
    if (flag === 'too_short') warnings.push(toHealthWarning('split_block_too_short', 'split block may be truncated'));
    if (flag === 'too_long') warnings.push(toHealthWarning('split_block_too_long', 'split block may contain multiple citations'));
    if (flag === 'metadata_mismatch') warnings.push(toHealthWarning('authority_metadata_mismatch', 'metadata mismatch remains unresolved'));
  }

  if (!carrier.styleResolution.effectiveStyleKnown && carrier.style.family === 'unknown') {
    warnings.push(toHealthWarning('style_unknown', 'effective citation style remains unknown'));
  } else if (carrier.styleResolution.inputStyleUncertain) {
    warnings.push(toHealthWarning(
      'input_style_uncertain',
      carrier.style.family === 'unknown'
        ? 'input style detection remained uncertain, but output style is fixed'
        : 'input style family was resolved, but exact style remained ambiguous',
    ));
  }
  if (carrier.type.isUnknown) warnings.push(toHealthWarning('type_unknown', 'reference type remains uncertain'));
  if (carrier.detection.splitQualityFlag === 'low') {
    warnings.push(toHealthWarning('low_split_quality', 'input split quality is low — citation boundaries may be inaccurate'));
  }
  if (
    carrier.styleResolution.rawDetectionConfidence < 0.6
    && !shouldSuppressUncertainDetectionWarning(carrier)
  ) {
    warnings.push(toHealthWarning('uncertain_detection', 'input format detection confidence is low'));
  }
  if (carrier.detection.sampled) {
    warnings.push(toHealthWarning('sampled_detection', 'format detection was sampled — not all input was analyzed'));
  }
  if (carrier.inputCleanup?.cleanupApplied) {
    warnings.push(toHealthWarning('pdf_copy_cleanup_applied', 'PDF copy cleanup heuristics were applied before detection and splitting'));
  }
  if (schemaWithoutMandatoryFields) {
    warnings.push(toHealthWarning('schema_without_mandatory_fields', 'schema resolved without mandatory fields'));
  }
  if (carrier.doiVerification.status === 'conflicted') {
    warnings.push(toHealthWarning('doi_conflicted', 'DOI metadata conflicted with the extracted citation fields'));
  }
  if (carrier.doiVerification.status === 'unverified') {
    warnings.push(toHealthWarning('doi_unverified', 'DOI could not be verified against provider metadata'));
  }
  if (carrier.enrichment.mismatch) {
    warnings.push(toHealthWarning(
      'enrichment_mismatch',
      `a provider match was withheld because it conflicts with the citation (${carrier.enrichment.mismatch.reasons.join('; ')})`,
    ));
  }

  return uniqueHealthWarnings(warnings);
}

function shouldSuppressUncertainDetectionWarning(carrier: ReferenceCarrier): boolean {
  if (!carrier.styleResolution.effectiveStyleKnown) {
    return false;
  }

  return carrier.styleResolution.effectiveStyleSource === 'requested'
    || carrier.styleResolution.effectiveStyleSource === 'doi_fast_path';
}

function hasMandatoryPresence(
  carrier: ReferenceCarrier,
  field: keyof ReferenceCarrier['fields'],
): boolean {
  const fieldValue = carrier.fields[field];
  if (!hasFieldValue(fieldValue)) return false;
  if (isIntrinsicPresenceField(field)) return true;
  if (carrier.healthEvidence.validSpanFields.includes(field)) return true;
  if (isTrustedFieldOrigin(fieldValue.origin)) return true;
  if (
    fieldValue.origin === 'heuristic'
    && (
      fieldValue.stageId === 'phase4_extraction'
      || fieldValue.stageId === 'phase6_8_shared_repair'
    )
  ) {
    if (field === 'authors' && carrier.healthEvidence.invalidSpanFields.includes('authors')) {
      return false;
    }
    return true;
  }
  return fieldValue.origin === 'ingestion' && carrier.ingestionMeta?.structure === 'structured';
}

// Patterns that should never appear inside a person/author name — their presence
// means an adjacent field (year, page locator, DOI, URL, volume) was mis-segmented
// INTO the author span. High-precision: real names do not contain these.
const AUTHOR_LEAK_PATTERN = /\b(?:19|20)\d{2}\b|10\.\d{4,}|https?:\/\/|\d+\s*[-–]\s*\d+|\bvol\.?\s*\d/i;
const AUTHOR_SWALLOW_MAX_LEN = 50;

function authorEntryText(author: CanonicalAuthor): string {
  if (typeof author === 'string') return author;
  return author.literal ?? [author.family, author.given].filter(Boolean).join(' ');
}

// Catches the engine's "confident-but-wrong" blind spot: fields that ARE present
// (so they pass hasMandatoryPresence and would otherwise read as `ready`) but whose
// value is structurally implausible. Only inspects untrusted heuristic values and
// only flags clear-cut errors, so it surfaces a review flag without false-positiving
// on correct output. Reliability over confident silence.
function detectImplausiblePresentFields(carrier: ReferenceCarrier): HealthWarning[] {
  const warnings: HealthWarning[] = [];

  const authors = carrier.fields.authors;
  if (hasFieldValue(authors) && Array.isArray(authors.value) && !isTrustedFieldOrigin(authors.origin)) {
    for (const author of authors.value as CanonicalAuthor[]) {
      const text = authorEntryText(author).trim();
      if (text.length > AUTHOR_SWALLOW_MAX_LEN || AUTHOR_LEAK_PATTERN.test(text)) {
        warnings.push(toHealthWarning(
          'suspect_author_value',
          `author value looks mis-segmented (carries a year/locator/identifier or is implausibly long): "${text.slice(0, 60)}"`,
        ));
        break;
      }
    }
  }

  if (carrier.authorListIncomplete && hasFieldValue(authors) && Array.isArray(authors.value) && authors.value.length > 0) {
    warnings.push(toHealthWarning(
      'author_list_incomplete',
      'author list was truncated with "et al." — additional authors were omitted at the source',
    ));
  }

  const pages = carrier.fields.pages;
  if (hasFieldValue(pages) && typeof pages.value === 'string' && !isTrustedFieldOrigin(pages.origin)) {
    const range = pages.value.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range && Number(range[1]) > Number(range[2])) {
      warnings.push(toHealthWarning(
        'suspect_locator_value',
        `page range start exceeds end: "${pages.value}"`,
      ));
    }
  }

  return warnings;
}

function shouldWarnMissingRequiredMlSpan(
  carrier: ReferenceCarrier,
  field: keyof ReferenceCarrier['fields'],
): boolean {
  const fieldValue = carrier.fields[field];
  return carrier.extractionMeta?.runMode === 'ml'
    && Boolean(carrier.extractionMeta?.bio)
    && hasFieldValue(fieldValue)
    && fieldValue.source === 'ml_extraction'
    && !carrier.healthEvidence.validSpanFields.includes(field);
}

function isIntrinsicPresenceField(field: keyof ReferenceCarrier['fields']): boolean {
  return field === 'url'
    || field === 'doi'
    || field === 'pmid'
    || field === 'arxiv'
    || field === 'isbn'
    || field === 'issn'
    || field === 'handle'
    || field === 'patent'
    || field === 'accessedDate';
}

function decidePublicStatus(input: {
  missingMandatory: string[];
  invalidMandatory: string[];
  lowConfidenceMandatory: string[];
  warnings: HealthWarning[];
}): ReferenceCarrier['publicStatus'] {
  if (
    input.missingMandatory.length > 0 ||
    input.invalidMandatory.length > 0 ||
    input.warnings.some((warning) => warning.severity === 'action')
  ) {
    return 'needs_action';
  }

  if (
    input.lowConfidenceMandatory.length > 0 ||
    input.warnings.some((warning) => warning.severity === 'review')
  ) {
    return 'needs_review';
  }

  return 'ready';
}

function computeFieldEvidenceScore(
  carrier: ReferenceCarrier,
  schema: EffectiveFieldSchema,
  missingMandatory: string[],
  invalidMandatory: string[],
): {
  score: number;
  completeness: number;
  avgMandatoryConfidence: number;
} {
  const mandatoryGroups = schema.requireOneOf.filter((group) => group.severity === 'mandatory');
  const preferredGroups = schema.requireOneOf.filter((group) => group.severity === 'preferred');
  const mandatoryUnitCount = schema.mandatory.length + mandatoryGroups.length;
  const preferredUnitCount = schema.preferred.length + preferredGroups.length;

  if (mandatoryUnitCount === 0 && preferredUnitCount === 0) {
    return {
      score: 0,
      completeness: 0,
      avgMandatoryConfidence: 0,
    };
  }

  const preferredPresentValid = schema.preferred.filter((field) => {
    const fieldValue = carrier.fields[field];
    if (!hasFieldValue(fieldValue)) return false;
    return validateMandatoryField(field, fieldValue.value).valid;
  }).length;
  const preferredGroupPresentValid = preferredGroups.filter((group) => {
    const resolvedField = pickRequirementGroupField(carrier.fields, group);
    if (!resolvedField) return false;
    return validateMandatoryField(resolvedField, carrier.fields[resolvedField].value).valid;
  }).length;

  const weightedDenominator = mandatoryUnitCount + (preferredUnitCount * 0.5);
  const validMandatoryCount = mandatoryUnitCount - missingMandatory.length - invalidMandatory.length;
  const completeness = weightedDenominator === 0
    ? 0
    : (validMandatoryCount + ((preferredPresentValid + preferredGroupPresentValid) * 0.5)) / weightedDenominator;

  const avgMandatoryConfidence = average([
    ...schema.mandatory.map((field) => {
      const label = String(field);
      if (missingMandatory.includes(label) || invalidMandatory.includes(label)) return 0;
      const resolvedField = resolveEquivalentFieldKey(carrier.fields, field);
      return carrier.fields[resolvedField].confidence;
    }),
    ...mandatoryGroups.map((group) => {
      if (missingMandatory.includes(group.label) || invalidMandatory.includes(group.label)) return 0;
      const resolvedField = pickRequirementGroupField(carrier.fields, group);
      if (!resolvedField) return 0;
      return carrier.fields[resolvedField].confidence;
    }),
  ]);

  return {
    score: average([completeness, avgMandatoryConfidence]),
    completeness,
    avgMandatoryConfidence,
  };
}

function evaluateRequirementGroupValidation(input: {
  carrier: ReferenceCarrier;
  group: FieldRequirementGroup;
  missingMandatory: string[];
  invalidMandatory: string[];
  lowConfidenceMandatory: string[];
  presentMandatory: string[];
  reasons: string[];
}): void {
  const resolvedField = pickRequirementGroupField(input.carrier.fields, input.group);

  if (!resolvedField) {
    input.missingMandatory.push(input.group.label);
    input.reasons.push(`missing mandatory field: ${input.group.label}`);
    return;
  }

  const validation = validateMandatoryField(resolvedField, input.carrier.fields[resolvedField].value);
  if (!validation.valid) {
    input.invalidMandatory.push(input.group.label);
    input.reasons.push(validation.reason ?? `invalid mandatory field: ${input.group.label}`);
    return;
  }

  input.presentMandatory.push(input.group.label);
  const fieldValue = input.carrier.fields[resolvedField];
  const threshold = getEffectiveMandatoryThreshold(resolvedField, validation.valid);
  if (!isTrustedFieldOrigin(fieldValue.origin) && fieldValue.confidence < threshold) {
    input.lowConfidenceMandatory.push(input.group.label);
    input.reasons.push(`low confidence in ${input.group.label}`);
  }
}

function computeStructuralSubscores(
  carrier: ReferenceCarrier,
): {
  refTypeConfidenceScore: number;
  noDuplicateFieldsScore: number;
  noArtifactTokensScore: number;
  noCorruptedContainerScore: number;
  fieldBoundaryScore: number;
  noDuplicateAuthorScore: number;
  locatorConsistencyScore: number;
} {
  return {
    refTypeConfidenceScore: carrier.type.isUnknown
      ? 0
      : clampUnit(carrier.type.confidence),
    noDuplicateFieldsScore: scoreDuplicateFields(carrier.fields),
    noArtifactTokensScore: scoreArtifactTokens(carrier.healthEvidence.warnings),
    noCorruptedContainerScore: scoreContainerCorruption(carrier.fields),
    fieldBoundaryScore: scoreFieldBoundaries(carrier.fields),
    noDuplicateAuthorScore: scoreDuplicateAuthors(carrier.fields.authors.value),
    locatorConsistencyScore: scoreLocatorConsistency(carrier.fields),
  };
}

function computePhase10Penalties(carrier: ReferenceCarrier): ScorePenalty[] {
  let penalties: ScorePenalty[] = [];

  if (carrier.status === 'error') penalties = addOrReplacePenalty(penalties, 'citation_error_state', 20);
  if (carrier.splitMeta.flags.includes('uncertain')) penalties = addOrReplacePenalty(penalties, 'split_uncertain', 10);
  if (carrier.splitMeta.flags.includes('too_short')) penalties = addOrReplacePenalty(penalties, 'split_too_short', 5);
  if (carrier.type.isUnknown) penalties = addOrReplacePenalty(penalties, 'reference_type_unknown', 6);
  if (!carrier.styleResolution.effectiveStyleKnown && carrier.style.family === 'unknown') {
    penalties = addOrReplacePenalty(penalties, 'style_unknown', 4);
  }

  return penalties;
}

function scoreDuplicateFields(fields: ExtractedFields): number {
  const doi = typeof fields.doi.value === 'string' ? normalizeDoi(fields.doi.value) : '';
  const url = typeof fields.url.value === 'string' ? fields.url.value.trim() : '';
  if (doi && url && normalizeDoi(url) === doi) {
    return 0.75;
  }

  const candidates: Array<[keyof ExtractedFields, string]> = [
    ['title', normalizeComparableText(fields.title.value)],
    ['journal', normalizeComparableText(fields.journal.value)],
    ['conferenceTitle', normalizeComparableText(fields.conferenceTitle.value)],
    ['bookTitle', normalizeComparableText(fields.bookTitle.value)],
    ['publisher', normalizeComparableText(fields.publisher.value)],
    ['institution', normalizeComparableText(fields.institution.value)],
    ['repository', normalizeComparableText(fields.repository.value)],
    ['siteName', normalizeComparableText(fields.siteName.value)],
  ].filter((entry): entry is [keyof ExtractedFields, string] => Boolean(entry[1]));

  const duplicates = new Map<string, Array<keyof ExtractedFields>>();
  for (const [field, value] of candidates) {
    const existing = duplicates.get(value) ?? [];
    existing.push(field);
    duplicates.set(value, existing);
  }

  const repeated = [...duplicates.values()].filter((fieldsForValue) => fieldsForValue.length > 1);
  if (repeated.length === 0) return 1;
  if (repeated.some((fieldsForValue) => fieldsForValue.length > 2) || repeated.length > 1) return 0;
  return 0.5;
}

function scoreArtifactTokens(warnings: HealthWarning[]): number {
  const artifactWarnings = warnings.filter((warning) => FIELD_CONTENT_WARNING_CODES.has(warning.code));
  if (artifactWarnings.some((warning) => warning.severity === 'action')) return 0;
  if (artifactWarnings.some((warning) => warning.severity === 'review')) return 0.5;
  return 1;
}

function scoreContainerCorruption(fields: ExtractedFields): number {
  let minor = 0;

  for (const value of [
    fields.journal.value,
    fields.bookTitle.value,
    fields.conferenceTitle.value,
    fields.repository.value,
    fields.siteName.value,
  ]) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) continue;

    if (/\b(?:19|20)\d{2}\b/.test(text) || /\bpp?\.?\s*[A-Z]?\d+/i.test(text) || /\b\d+\s*[-–]\s*\d+\b/.test(text) || /\b\d+\(\d+\)/.test(text)) {
      return 0;
    }
    if (/[,.;:]{2,}/.test(text) || /\s{2,}/.test(text) || /\d$/.test(text)) {
      minor += 1;
    }
  }

  if (minor >= 2) return 0;
  if (minor === 1) return 0.5;
  return 1;
}

function scoreFieldBoundaries(fields: ExtractedFields): number {
  let minor = 0;
  const title = typeof fields.title.value === 'string' ? fields.title.value.trim() : '';
  const authorFamilies = fields.authors.value.map((author) => normalizeComparableText(author.family || author.literal || ''));

  if (fields.authors.value.some((author) => /\d/.test([author.family, author.given, author.literal].filter(Boolean).join(' ')))) {
    return 0;
  }
  if (title && (/https?:\/\//i.test(title) || /\b10\.\d{4,9}\//i.test(title) || /\bpp?\.?\s*\d+/i.test(title) || /\b\d+\(\d+\)/.test(title))) {
    return 0;
  }
  if (
    typeof fields.journal.value === 'string' &&
    /\b\d+\s*[-–]\s*\d+\b/.test(fields.journal.value)
  ) {
    return 0;
  }
  if (title && typeof fields.year.value === 'number' && new RegExp(`\\b${fields.year.value}\\b`).test(title)) {
    minor += 1;
  }
  if (title && authorFamilies.some((family) => family && normalizeComparableText(title) === family)) {
    minor += 1;
  }

  if (minor >= 2) return 0;
  if (minor === 1) return 0.5;
  return 1;
}

function scoreDuplicateAuthors(authors: CanonicalAuthor[]): number {
  const counts = new Map<string, number>();

  for (const author of authors) {
    const key = normalizeComparableText(author.literal || `${author.family}|${author.given ?? ''}`);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const duplicates = [...counts.values()].filter((count) => count > 1);
  if (duplicates.length === 0) return 1;
  if (duplicates.length === 1 && duplicates[0] === 2) return 0.5;
  return 0;
}

function scoreLocatorConsistency(
  fields: ExtractedFields,
): number {
  const pageValue = typeof fields.pages.value === 'string' ? fields.pages.value.trim() : '';
  const articleValue = typeof fields.articleNumber.value === 'string' ? fields.articleNumber.value.trim() : '';
  const reportValue = typeof fields.reportNumber.value === 'string' ? fields.reportNumber.value.trim() : '';
  const locator = pageValue || articleValue || reportValue;

  if (!locator) {
    return 1;
  }

  if (pageValue || articleValue) {
    if (isValidLocatorPages(locator)) return 1;
    if (/\d/.test(locator)) return 0.5;
    return 0;
  }

  if (reportValue) {
    return isValidReportNumber(reportValue) ? 1 : 0;
  }

  return 1;
}

function reasonForWarning(warning: HealthWarning): string {
  switch (warning.code) {
    case 'uncertain_split_block':
      return 'split boundary remains uncertain';
    case 'split_block_too_short':
      return 'split block may be truncated';
    case 'split_block_too_long':
      return 'split block may contain multiple citations';
    case 'style_unknown':
      return 'effective citation style remains unknown';
    case 'input_style_uncertain':
      return 'input style detection remained uncertain';
    case 'type_unknown':
      return 'reference type remains uncertain';
    case 'invalid_author_span':
      return 'invalid author span detected';
    case 'schema_without_mandatory_fields':
      return 'schema resolved without mandatory fields';
    case 'low_split_quality':
      return 'input split quality is low';
    case 'uncertain_detection':
      return 'input format detection confidence is low';
    case 'sampled_detection':
      return 'input format detection was sampled';
    case 'pdf_copy_cleanup_applied':
      return 'pdf copy cleanup was applied before splitting';
    case 'doi_conflicted':
      return 'DOI metadata conflicted with extracted citation fields';
    case 'doi_unverified':
      return 'DOI could not be verified against provider metadata';
    case 'missing_preferred_fields':
      return warning.message ?? 'preferred fields remain missing';
    default:
      return warning.message ?? `warning: ${warning.code}`;
  }
}

function normalizeComparableText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDoi(value: string): string {
  const trimmed = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  return isValidDoi(trimmed) ? trimmed.toLowerCase() : '';
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
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
