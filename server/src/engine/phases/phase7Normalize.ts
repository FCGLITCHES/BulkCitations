import { auditMandatoryFields } from '../mandatory-fields.js';
import { calibrateStructurallyValidFieldConfidences } from '../confidenceCalibration.js';
import { syncFieldUncertainty } from '../fieldConfidence.js';
import { isValidCanonicalAuthor } from '../healthRules.js';
import type { ReferenceCarrier } from '../types/carrier.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { hasFieldValue, rewriteField } from '../utils/fields.js';
import { clearPlaceholderFields as clearPlaceholderFieldsInPlace } from '../utils/placeholders.js';
import { CONFERENCE_CUE_REGEX } from '../utils/type-classification.js';

const CONTRACT_VERSION = 1;
export const PHASE7_NORMALIZATION_STAGE_ID = 'phase7_normalization';

export interface NormalizeApplyOptions {
  suppressContextStageLog?: boolean;
}

export interface NormalizeStats {
  carrierWarnings: number;
  durationMs: number;
}

export class Phase7Normalize implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'normalization' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const result = await this.apply(carriers, ctx);
    return result.carriers;
  }

  async apply(
    carriers: ReferenceCarrier[],
    ctx: PipelineContext,
    options: NormalizeApplyOptions = {},
  ): Promise<{ carriers: ReferenceCarrier[]; stats: NormalizeStats }> {
    const startedAt = Date.now();
    const captureCarrierDiagnostics = ctx.executionPolicy.debugMode !== 'off';
    let carrierWarnings = 0;

    for (const carrier of carriers) {
      const appliedRules = carrier.normalizationMeta?.appliedRules ?? [];

      clearPlaceholderFields(carrier, appliedRules);
      correctPlaceholderConferenceType(carrier);
      normalizeStringField(carrier, 'doi', normalizeDoi, 'doi_normalize', appliedRules);
      normalizeStringField(carrier, 'url', normalizeUrl, 'url_normalize', appliedRules);
      normalizeStringField(carrier, 'pages', normalizePages, 'page_range_normalize', appliedRules);
      normalizeStringField(carrier, 'volume', normalizeVolume, 'volume_normalize', appliedRules);
      normalizeStringField(carrier, 'issue', normalizeIssue, 'issue_normalize', appliedRules);
      normalizeStringField(carrier, 'edition', normalizeEdition, 'edition_normalize', appliedRules);
      normalizeTitleText(carrier, appliedRules);
      normalizeJournalText(carrier, appliedRules);
      normalizeAuthors(carrier, appliedRules);
      normalizeYear(carrier, appliedRules);
      calibrateStructurallyValidFieldConfidences(carrier.fields);
      syncFieldUncertainty(carrier.fields);

      const mandatoryFieldCheck = auditMandatoryFields({
        fields: carrier.fields,
        referenceType: carrier.type.type,
        requestedStyle: ctx.outputStyle !== 'auto' && ctx.outputStyle !== 'unknown'
          ? ctx.outputStyle
          : carrier.styleResolution.effectiveStyleKnown
            ? carrier.styleResolution.effectiveStyle
            : ctx.outputStyle,
        detectedStyle: carrier.style.primary.style,
        detectedStyleFamily: carrier.style.family,
      });
      const missingMandatoryFields = mandatoryFieldCheck.missingMandatory.map(String);
      if (missingMandatoryFields.length > 0) {
        carrierWarnings += 1;
      }

      carrier.normalizationMeta = { appliedRules, mandatoryFieldCheck };
      if (captureCarrierDiagnostics) {
        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: missingMandatoryFields.length > 0 ? 'warning' : 'success',
            durationMs: 0,
            message: missingMandatoryFields.length > 0
              ? `Normalization confirmed mandatory schema for ${mandatoryFieldCheck.referenceType}/${mandatoryFieldCheck.schemaStyle} and found missing mandatory fields.`
              : `Normalization confirmed mandatory schema for ${mandatoryFieldCheck.referenceType}/${mandatoryFieldCheck.schemaStyle}.`,
            details: {
              appliedRuleCount: appliedRules.length,
              schemaStyle: mandatoryFieldCheck.schemaStyle,
              referenceType: mandatoryFieldCheck.referenceType,
              missingMandatoryFields,
              missingMandatoryCount: missingMandatoryFields.length,
              mandatoryFieldCount: mandatoryFieldCheck.mandatory.length,
              preferredFieldCount: mandatoryFieldCheck.preferred.length,
            },
          }),
        );
      }
    }

    const stats: NormalizeStats = {
      carrierWarnings,
      durationMs: Date.now() - startedAt,
    };

    if (!options.suppressContextStageLog) {
      ctx.stageLog.push(createNormalizationSummaryRecord(stats));
    }

    return { carriers, stats };
  }
}

export const phase7Normalize = new Phase7Normalize();

export function createNormalizationSummaryRecord(
  stats: NormalizeStats,
): StageRunRecord {
  return stageRecord({
    phaseId: 'normalization',
    status: stats.carrierWarnings > 0 ? 'warning' : 'success',
    durationMs: stats.durationMs,
    message: stats.carrierWarnings > 0
      ? `Phase 7 normalization completed with ${stats.carrierWarnings} references still missing mandatory fields.`
      : 'Phase 7 normalization completed and confirmed mandatory field coverage.',
  });
}

function normalizeStringField(
  carrier: ReferenceCarrier,
  field: 'doi' | 'url' | 'pages' | 'edition' | 'volume' | 'issue',
  normalizer: (value: string) => string,
  rule: string,
  appliedRules: NonNullable<ReferenceCarrier['normalizationMeta']>['appliedRules'],
): void {
  const existing = carrier.fields[field];
  if (!hasFieldValue(existing) || typeof existing.value !== 'string') return;

  const normalized = normalizer(existing.value);
  if (normalized === existing.value) return;

  appliedRules.push({ field, before: existing.value, after: normalized, rule });
  carrier.fields[field] = rewriteField(
    existing,
    field,
    normalized,
    'normalization',
    PHASE7_NORMALIZATION_STAGE_ID,
    Math.max(existing.confidence, 0.85),
  );
}

function clearPlaceholderFields(
  carrier: ReferenceCarrier,
  appliedRules: NonNullable<ReferenceCarrier['normalizationMeta']>['appliedRules'],
): void {
  clearPlaceholderFieldsInPlace(carrier.fields, PHASE7_NORMALIZATION_STAGE_ID, (field, before) => {
    appliedRules.push({ field, before, after: null, rule: 'placeholder_clear' });
  });
}

/**
 * A reference is only typed `conference-paper` when there is real conference
 * evidence. When the type was driven purely by a placeholder container ("Journal,
 * ?") — which placeholder clearing has just removed — and the raw text carries no
 * conference cue, the conference label is bogus. Re-derive it from what actually
 * remains: a journal -> article, a book container -> chapter, otherwise a standalone
 * titled work -> book (so the title italicizes instead of rendering bare).
 */
function correctPlaceholderConferenceType(carrier: ReferenceCarrier): void {
  if (carrier.type.type !== 'conference-paper') return;
  if (hasFieldValue(carrier.fields.conferenceTitle)) return;
  if (CONFERENCE_CUE_REGEX.test(carrier.raw)) return;

  const nextType = hasFieldValue(carrier.fields.journal)
    ? 'article-journal'
    : hasFieldValue(carrier.fields.bookTitle)
      ? 'book-chapter'
      : 'book';

  carrier.type = { type: nextType, confidence: carrier.type.confidence, isUnknown: false };
}

function normalizeTitleText(
  carrier: ReferenceCarrier,
  appliedRules: NonNullable<ReferenceCarrier['normalizationMeta']>['appliedRules'],
): void {
  normalizeMarkupTextField(carrier, 'title', 0.84, 'title_text_normalize', appliedRules);
}

function normalizeJournalText(
  carrier: ReferenceCarrier,
  appliedRules: NonNullable<ReferenceCarrier['normalizationMeta']>['appliedRules'],
): void {
  normalizeMarkupTextField(carrier, 'journal', 0.84, 'journal_text_normalize', appliedRules);
}

function normalizeMarkupTextField(
  carrier: ReferenceCarrier,
  field: 'title' | 'journal',
  minConfidence: number,
  rule: string,
  appliedRules: NonNullable<ReferenceCarrier['normalizationMeta']>['appliedRules'],
): void {
  const existing = carrier.fields[field];
  if (!hasFieldValue(existing) || typeof existing.value !== 'string') return;
  const original = existing.value;
  let normalized = stripInlineMarkup(original).trim().replace(/\s+/g, ' ');
  if (field === 'journal') normalized = trimContainerEdges(normalized);

  if (normalized === original || !normalized) return;
  appliedRules.push({ field, before: original, after: normalized, rule });
  carrier.fields[field] = rewriteField(
    existing,
    field,
    normalized,
    'normalization',
    PHASE7_NORMALIZATION_STAGE_ID,
    Math.max(existing.confidence, minConfidence),
  );
}

/**
 * Crossref/OpenAlex titles and container names arrive with inline HTML markup
 * (`<i>ab initio</i>`, `<b>lme4</b>`, `<tt>edgeR</tt>`, `<sub>`/`<sup>`) that is
 * frequently glued to the surrounding words ("for<i>ab initio</i>total-energy").
 * Replace tags with a space so glued words separate, decode the handful of HTML
 * entities that show up, then let the caller collapse the whitespace.
 */
/**
 * Trims container debris a failed structured parse leaves on the journal field: a
 * leading stray quote/paren and a trailing "? (" / "(" fragment (a "?" placeholder
 * volume plus the opening paren of "(year)"). E.g. `" Lecture notes in computer
 * science ? (` -> `Lecture notes in computer science`. Real names are untouched.
 */
function trimContainerEdges(value: string): string {
  return value
    .replace(/^[\s"'“”(]+/u, '')
    .replace(/[\s,;]*\??\s*\(\s*$/u, '')
    .replace(/[\s"'“”]+$/u, '')
    .trim();
}

function stripInlineMarkup(value: string): string {
  return value
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/giu, "'")
    .replace(/&nbsp;/giu, ' ');
}

function normalizeAuthors(
  carrier: ReferenceCarrier,
  appliedRules: NonNullable<ReferenceCarrier['normalizationMeta']>['appliedRules'],
): void {
  if (!hasFieldValue(carrier.fields.authors)) return;
  const before = JSON.stringify(carrier.fields.authors.value);
  const normalized = carrier.fields.authors.value.map((author) => ({
    ...author,
    family: author.family.trim(),
    given: author.given?.trim() ?? null,
    initials: author.initials?.trim() ?? null,
    ...(author.literal ? { literal: author.literal.trim() } : {}),
  })).filter((author) => isValidCanonicalAuthor(author));
  const after = JSON.stringify(normalized);
  if (before === after) return;

  appliedRules.push({ field: 'authors', before: carrier.fields.authors.value, after: normalized, rule: 'author_normalize' });
  carrier.fields.authors = rewriteField(
    carrier.fields.authors,
    'authors',
    normalized,
    'normalization',
    PHASE7_NORMALIZATION_STAGE_ID,
    Math.max(carrier.fields.authors.confidence, 0.84),
  );
}

function normalizeYear(
  carrier: ReferenceCarrier,
  appliedRules: NonNullable<ReferenceCarrier['normalizationMeta']>['appliedRules'],
): void {
  const existing = carrier.fields.year;
  if (existing.value == null) return;
  const text = String(existing.value);
  const match = text.match(/((?:19|20)\d{2})/);
  if (!match) return;

  const normalized = Number(match[1]);
  if (normalized === existing.value) return;
  appliedRules.push({ field: 'year', before: existing.value, after: normalized, rule: 'year_normalize' });
  carrier.fields.year = rewriteField(
    existing,
    'year',
    normalized,
    'normalization',
    PHASE7_NORMALIZATION_STAGE_ID,
    Math.max(existing.confidence, 0.9),
  );
}

function normalizeDoi(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
}

function normalizeUrl(value: string): string {
  return value
    .replace(/^http:\s+\/\//i, 'http://')
    .replace(/^https:\s+\/\//i, 'https://')
    .replace(/\s+/g, '')
    .replace(/[.)]+$/g, '');
}

function normalizePages(value: string): string {
  // Canonical DATA form: ASCII hyphen, full page numbers. The en-dash (or
  // Vancouver-style abbreviation) is a per-style PRESENTATION concern applied at
  // render, not stored on the field — storing it here made the field mismatch the
  // hyphenated gold on every range. Mirror of normalizePages in phase4Extract.ts.
  const normalized = value
    .replace(/^[\[(]\s*/u, '')              // strip a wrapping "[" / "(" (e.g. "[45-67]")
    .replace(/\s*[\])]$/u, '')              // strip a wrapping "]" / ")"
    .replace(/^(pp?|pages?)\.?\s*/i, '')    // strip a "pp." / "p." / "pages" prefix
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.,;:\s]+|[.,;:\s]+$/gu, '') // strip stray leading/trailing punctuation
    .trim();
  const numericMatch = normalized.match(/^(?<start>\d+)-(?<end>\d+)$/u);
  const g = numericMatch?.groups;
  if (!g) {
    return normalized;
  }

  const start = g.start;
  const end = g.end;
  if (start === undefined || end === undefined) {
    return normalized;
  }
  if (end.length >= start.length) {
    return `${start}-${end}`;
  }

  const prefix = start.slice(0, start.length - end.length);
  return `${start}-${prefix}${end}`;
}

// Strip wrapping brackets/parens and leading/trailing stray punctuation from a locator value.
function stripLocatorWrappers(value: string): string {
  return value
    .trim()
    .replace(/^[\[(\s]+/u, '')
    .replace(/[\])\s.,;:]+$/u, '')
    .trim();
}

function normalizeVolume(value: string): string {
  // Drop a "vol."/"v."/"#" label and any wrapping brackets ("[12]" -> "12", "vol. 5" -> "5").
  return stripLocatorWrappers(stripLocatorWrappers(value).replace(/^(?:vol\.?|volume|v\.|#)\s*/i, ''));
}

function normalizeIssue(value: string): string {
  // Drop a "no."/"iss."/"issue"/"#" label and any wrapping brackets ("(3)" -> "3", "no. 4" -> "4").
  return stripLocatorWrappers(stripLocatorWrappers(value).replace(/^(?:no\.?|iss\.?|issue|number|#)\s*/i, ''));
}

function normalizeEdition(value: string): string {
  const lower = value.trim().toLowerCase();
  if (/^\d+(st|nd|rd|th)$/.test(lower)) return `${lower} ed.`;
  if (lower === 'second') return '2nd ed.';
  if (lower === 'third') return '3rd ed.';
  return value.trim();
}

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
): StageRunRecord {
  return {
    stageId: PHASE7_NORMALIZATION_STAGE_ID,
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}
