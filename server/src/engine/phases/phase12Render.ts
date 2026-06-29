import { ErrorCode } from '../errors/index.js';
import { toHealthWarning, uniqueHealthWarnings } from '../healthWarnings.js';
import { getEffectiveFieldSchema, getFieldSchema, pickRequirementGroupField, resolveSchemaStyle } from '../mandatory-fields.js';
import {
  isValidArticleNumber,
  isValidDoi,
  isValidLocatorPages,
  isValidReportNumber,
  isValidUrl,
  validateMandatoryField,
} from '../healthRules.js';
import { TITLE_CASE_ALL_CAPS_ALLOWLIST } from '../scoreConfig.js';
import { addOrReplacePenalty, finalizeDisplayScore, finalizeRawScore, removePenalty, resolveFormatScoringPath } from '../scoringHelpers.js';
import { renderWithCsl } from './csl/engine.js';
import type { ReferenceCarrier, RenderAudit } from '../types/carrier.js';
import type { CanonicalAuthor, CitationStyle, ExtractedFields, HealthWarning } from '../types/citation.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { hasFieldValue } from '../utils/fields.js';
import { clearPlaceholderFields } from '../utils/placeholders.js';

const CONTRACT_VERSION = 2;
const STAGE_ID = 'phase12_rendering';

export class Phase12Render implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'rendering' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    let warningCount = 0;

    for (const carrier of carriers) {
        // Final gate: drop any field that is entirely a placeholder ("Journal",
        // "?", "vol", …). These can be introduced after phase-7 normalization by
        // locator/venue splitting, so clearing here guarantees no placeholder token
        // reaches the rendered output (or the format scores computed below).
        clearPlaceholderFields(carrier.fields, STAGE_ID);
        const style = ctx.outputStyle !== 'auto' && ctx.outputStyle !== 'unknown'
          ? ctx.outputStyle
          : carrier.styleResolution.effectiveStyleKnown
            ? carrier.styleResolution.effectiveStyle
            : resolveSchemaStyle(ctx.outputStyle, carrier.style.primary.style, carrier.style.family);
      const renderOutput = renderCitation(carrier, style);
      const text = renderOutput.text;
      const renderPlan = buildRenderPlan(carrier, style, renderOutput);
      const scoringPath = resolveFormatScoringPath(style);
      const assertionSummary = runAssertions(carrier, style, text);
      const semanticSegmentSubscores = computeSemanticSegmentSubscores(carrier, style, text, renderPlan, scoringPath.path);
      const contentCorrectnessScore = computeContentCorrectnessScore(renderPlan, semanticSegmentSubscores);
      const cosmeticSubscores = computeCosmeticSubscores(style, text, renderPlan);
      const cosmeticFormatScore = average([
        cosmeticSubscores.titleCaseScore,
        cosmeticSubscores.spacingScore,
        cosmeticSubscores.noDuplicatePunctScore,
        cosmeticSubscores.punctuationScore,
      ]);
      const formatSubscores = computeFormatSubscores(
        carrier,
        style,
        text,
        renderPlan,
        scoringPath.path,
        semanticSegmentSubscores,
        cosmeticSubscores,
      );
      const formatCorrectnessScore = contentCorrectnessScore * (1 - 0.15 * (1 - cosmeticFormatScore));
      const assessment = assessRenderedOutput(carrier, style, renderOutput, scoringPath.path);
      if (assessment.warningCodes.length > 0) warningCount += 1;

      const penalties = assessment.structurallyIncomplete
        ? addOrReplacePenalty(
          carrier.scoring.breakdown.penalties,
          'render_structurally_incomplete',
          assessment.penaltyPoints,
        )
        : removePenalty(carrier.scoring.breakdown.penalties, 'render_structurally_incomplete');
      const breakdown = {
        ...carrier.scoring.breakdown,
        contentCorrectnessScore,
        cosmeticFormatScore,
        formatCorrectnessScore,
        formatScoringPath: scoringPath.path,
        formatSubscores,
        semanticSegmentSubscores,
        cosmeticSubscores,
        penalties,
        diagnostics: {
          ...carrier.scoring.breakdown.diagnostics,
          splitQualityFlag: carrier.detection.splitQualityFlag,
          detectionConfidence: carrier.styleResolution.effectiveDetectionConfidence,
          rawDetectionConfidence: carrier.styleResolution.rawDetectionConfidence,
          effectiveDetectionConfidence: carrier.styleResolution.effectiveDetectionConfidence,
          formatScoringPathReason: scoringPath.reason,
        },
      };
      const rawScore = applyHeuristicConfidenceFloor(
        carrier,
        finalizeRawScore(breakdown, style),
        breakdown,
      );
      const displayScore = finalizeDisplayScore(rawScore, carrier.authority.scoreAdjustment);

      carrier.rendered = {
        text,
        warnings: assessment.warningCodes,
        assertionSummary,
        audit: renderOutput.audit,
      };
      carrier.outputLatencyMs = Date.now() - ctx.startedAt;
      carrier.scoring.rawScore = rawScore;
      carrier.scoring.displayScore = displayScore;
      carrier.scoring.breakdown = {
        ...breakdown,
        rawScore,
        displayScore,
      };
      applyRenderHealthDemotions(carrier, assessment.warnings);

      carrier.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: assessment.warningCodes.length > 0 ? 'warning' : 'success',
          durationMs: 0,
          ...(assessment.warningCodes.length > 0 ? { code: ErrorCode.RENDER_STYLE_UNSUPPORTED } : {}),
          message: 'Rendering completed.',
          details: {
            style,
            formatScoringPath: scoringPath.path,
            warningCodes: assessment.warningCodes,
            assertionSummary,
            contentCorrectnessScore,
            cosmeticFormatScore,
            formatCorrectnessScore,
            rawScore,
          },
        }),
      );
    }

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: warningCount > 0 ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        message: 'Phase 12 rendering completed.',
      }),
    );

    return carriers;
  }
}

export const phase12Render = new Phase12Render();

function applyHeuristicConfidenceFloor(
  carrier: ReferenceCarrier,
  rawScore: number,
  breakdown: ReferenceCarrier['scoring']['breakdown'],
): number {
  const runMode = carrier.extractionMeta?.runMode;
  const cameFromHeuristicPath = runMode === 'heuristic' || runMode === 'shadow';
  if (!cameFromHeuristicPath) {
    return rawScore;
  }

  const isHighIntegrityReadyCitation =
    carrier.publicStatus === 'ready'
    && breakdown.penalties.length === 0
    && breakdown.contentCorrectnessScore >= 0.98
    && breakdown.cosmeticFormatScore >= 0.98
    && breakdown.structuralIntegrityScore >= 0.95;

  return isHighIntegrityReadyCitation ? Math.max(rawScore, 97) : rawScore;
}

/* ═══════════════════════════════════════════════════════════════
   Render dispatch
   ═══════════════════════════════════════════════════════════════ */

function italicize(value: string): string {
  return `*${value}*`;
}

type RenderSegmentKind =
  | 'authors'
  | 'year'
  | 'title'
  | 'container'
  | 'locator'
  | 'volume'
  | 'issue'
  | 'pages'
  | 'articleNumber'
  | 'reportNumber'
  | 'accessedDate'
  | 'doi'
  | 'url'
  | 'identifier'
  | 'publisher_or_institution'
  | 'literal'
  | 'separator';

type RenderFieldKey = keyof ExtractedFields;
type RenderRequirement = 'mandatory' | 'preferred';

interface RenderEligibleField {
  key: RenderFieldKey;
  value: ExtractedFields[RenderFieldKey]['value'];
  requiredness: RenderRequirement;
}

interface SuppressedRenderField {
  key: RenderFieldKey;
  value: ExtractedFields[RenderFieldKey]['value'];
  requiredness: RenderRequirement;
  reason: string;
}

interface RenderSegment {
  kind: RenderSegmentKind;
  text: string;
  protected: boolean;
  semanticRole: RenderSegmentKind;
  styleNative: boolean;
  fieldKeys: RenderFieldKey[];
}

interface PlannedRenderSegment {
  kind: RenderSegmentKind;
  text: string;
  fieldKeys: RenderFieldKey[];
}

interface RenderPlan {
  segments: PlannedRenderSegment[];
  actualSegments: RenderSegment[];
  text: string;
  style: CitationStyle;
}

interface RenderOutput {
  text: string;
  segments: RenderSegment[];
  audit: RenderAudit;
  eligibleFields: RenderEligibleField[];
  suppressedFields: SuppressedRenderField[];
}

type EligibleFieldMap = Map<RenderFieldKey, RenderEligibleField>;

interface ReportPublisherSegmentOptions {
  organizationSeparator: string;
  suffix: string;
}

function renderCitation(carrier: ReferenceCarrier, style: CitationStyle): RenderOutput {
  const { eligibleFields, suppressedFields } = buildRenderEligibility(carrier, style);
  const eligibleFieldMap = new Map(eligibleFields.map((field) => [field.key, field] as const));
  let segments: RenderSegment[];

  switch (style) {
    case 'apa7':
      segments = renderApa(carrier, eligibleFieldMap);
      break;
    case 'mla9':
      segments = renderMla(carrier, eligibleFieldMap);
      break;
    case 'chicago-author-date':
      segments = renderChicagoAuthorDate(carrier, eligibleFieldMap);
      break;
    case 'vancouver':
      segments = renderVancouver(carrier, eligibleFieldMap);
      break;
    case 'ieee':
      segments = renderIeee(carrier, eligibleFieldMap);
      break;
    case 'harvard-ctr':
      segments = renderHarvardCtr(carrier, eligibleFieldMap);
      break;
    case 'ama':
      segments = renderAma(carrier, eligibleFieldMap);
      break;
    case 'acs':
      segments = renderAcs(carrier, eligibleFieldMap);
      break;
    case 'chicago-notes-bib':
      segments = renderChicagoNotesBib(carrier, eligibleFieldMap);
      break;
    default: {
      const cslResult = renderWithCsl(carrier, style);
      segments = cslResult
        ? buildSegmentsFromRenderedText(carrier, cslResult, eligibleFields)
        : renderApa(carrier, eligibleFieldMap);
      break;
    }
  }

  const finalizedSegments = appendMissingEligibleFields(segments, eligibleFields, carrier, style);
  const audit = buildRenderAudit(eligibleFields, suppressedFields, finalizedSegments);
  return {
    text: finalizeCitation(finalizedSegments.map((segment) => segment.text).join(' ')),
    segments: finalizedSegments,
    audit,
    eligibleFields,
    suppressedFields,
  };
}

function buildRenderEligibility(
  carrier: ReferenceCarrier,
  style: CitationStyle,
): { eligibleFields: RenderEligibleField[]; suppressedFields: SuppressedRenderField[] } {
  const schema = getFieldSchema(carrier.type.isUnknown ? 'unknown' : carrier.type.type, style);
  const effectiveSchema = getEffectiveFieldSchema(carrier.fields, schema);
  const requirements = new Map<RenderFieldKey, RenderRequirement>();

  for (const field of effectiveSchema.mandatory) {
    requirements.set(field, 'mandatory');
  }
  for (const field of effectiveSchema.preferred) {
    if (!requirements.has(field)) {
      requirements.set(field, 'preferred');
    }
  }
  for (const group of effectiveSchema.requireOneOf) {
    const resolvedField = pickRequirementGroupField(carrier.fields, group);
    if (!resolvedField) continue;
    const requiredness = group.severity;
    if (requirements.get(resolvedField) === 'mandatory') continue;
    requirements.set(resolvedField, requiredness);
  }

  const eligibleFields: RenderEligibleField[] = [];
  const suppressedFields: SuppressedRenderField[] = [];

  for (const [key, requiredness] of requirements.entries()) {
    const fieldValue = carrier.fields[key];
    if (!hasFieldValue(fieldValue)) continue;

    const validation = validateRenderableField(carrier, key);
    if (validation.valid) {
      eligibleFields.push({
        key,
        value: fieldValue.value,
        requiredness,
      });
    } else {
      suppressedFields.push({
        key,
        value: fieldValue.value,
        requiredness,
        reason: validation.reason ?? `invalid ${String(key)} value`,
      });
    }
  }

  for (const key of Object.keys(carrier.fields) as RenderFieldKey[]) {
    if (requirements.has(key)) continue;

    const fieldValue = carrier.fields[key];
    if (!hasFieldValue(fieldValue)) continue;

    const validation = validateRenderableField(carrier, key);
    if (!validation.valid) {
      suppressedFields.push({
        key,
        value: fieldValue.value,
        requiredness: 'preferred',
        reason: validation.reason ?? `invalid ${String(key)} value`,
      });
    }
  }

  return {
    eligibleFields: sortEligibleFields(eligibleFields),
    suppressedFields,
  };
}

function validateRenderableField(
  carrier: ReferenceCarrier,
  field: RenderFieldKey,
): { valid: boolean; reason?: string } {
  const validation = validateMandatoryField(field, carrier.fields[field].value);
  if (!validation.valid) {
    return validation;
  }

  if (field === 'doi') {
    if (carrier.doiVerification.status === 'conflicted') {
      return { valid: false, reason: 'DOI conflicted with provider metadata' };
    }

    if (
      carrier.doiVerification.status === 'absent'
      && /\bdoi:\s*https?:\/\/(?:dx\.)?doi\.org\//iu.test(carrier.raw)
    ) {
      return { valid: false, reason: 'malformed DOI URL wrapper suppressed' };
    }

    const url = cleanText(carrier.fields.url.value);
    if (carrier.doiVerification.status === 'unverified' && url && !isDoiUrl(url)) {
      return { valid: false, reason: 'unverified DOI suppressed in favor of canonical webpage URL' };
    }
  }

  if (field === 'url') {
    const url = cleanText(carrier.fields.url.value);
    if (!url) {
      return { valid: false, reason: 'invalid URL format' };
    }

    if (isDoiUrl(url) && (!carrier.fields.doi.value || carrier.doiVerification.status !== 'unverified')) {
      return { valid: false, reason: 'DOI-shaped URL suppressed without a matching unverified DOI field' };
    }
  }

  return { valid: true };
}

function sortEligibleFields(fields: RenderEligibleField[]): RenderEligibleField[] {
  const order: RenderFieldKey[] = [
    'authors',
    'editors',
    'year',
    'title',
    'journal',
    'conferenceTitle',
    'bookTitle',
    'siteName',
    'repository',
    'publisher',
    'institution',
    'placeOfPublication',
    'edition',
    'volume',
    'issue',
    'pages',
    'articleNumber',
    'reportNumber',
    'doi',
    'url',
    'isbn',
    'issn',
    'pmid',
    'arxiv',
    'handle',
    'patent',
    'accessedDate',
    'thesisType',
    'database',
  ];
  const orderMap = new Map(order.map((key, index) => [key, index]));
  return [...fields].sort((left, right) => {
    return (orderMap.get(left.key) ?? Number.MAX_SAFE_INTEGER)
      - (orderMap.get(right.key) ?? Number.MAX_SAFE_INTEGER);
  });
}

function buildSegmentsFromRenderedText(
  carrier: ReferenceCarrier,
  rendered: string,
  eligibleFields: RenderEligibleField[],
): RenderSegment[] {
  const fieldKeys = eligibleFields
    .filter((field) => renderContainsFieldToken(field.key, field.value, rendered))
    .map((field) => field.key);
  return rendered.trim()
    ? [{
      kind: 'literal',
      text: rendered,
      protected: false,
      semanticRole: 'literal',
      styleNative: false,
      fieldKeys,
    }]
    : [];
}

function buildRenderAudit(
  eligibleFields: RenderEligibleField[],
  suppressedFields: SuppressedRenderField[],
  segments: RenderSegment[],
): RenderAudit {
  const available = uniqueFieldKeys(eligibleFields.map((field) => field.key));
  const rendered = uniqueFieldKeys(segments.flatMap((segment) => segment.fieldKeys));
  const renderedSet = new Set(rendered);

  return {
    available,
    rendered,
    lost: available.filter((field) => !renderedSet.has(field)),
    suppressed: suppressedFields.map((field) => ({
      key: field.key,
      reason: field.reason,
    })),
  };
}

function appendMissingEligibleFields(
  segments: RenderSegment[],
  eligibleFields: RenderEligibleField[],
  carrier: ReferenceCarrier,
  style: CitationStyle,
): RenderSegment[] {
  const nextSegments = [...segments];
  const renderedFields = new Set(nextSegments.flatMap((segment) => segment.fieldKeys));
  const missingFields = eligibleFields.filter((field) => !renderedFields.has(field.key));
  const handledFields = new Set<RenderFieldKey>();

  const groupedArticleLocatorFallback = createArticleJournalLocatorFallbackSegment(
    missingFields,
    carrier,
  );
  if (groupedArticleLocatorFallback) {
    const insertAt = findContainerFallbackIndex(nextSegments);
    nextSegments.splice(insertAt, 0, groupedArticleLocatorFallback);
    for (const fieldKey of groupedArticleLocatorFallback.fieldKeys) {
      handledFields.add(fieldKey);
    }
  }

  for (const field of missingFields) {
    if (handledFields.has(field.key)) continue;

    const fallbackSegment = createFallbackSegment(field, carrier, style);
    if (!fallbackSegment) continue;

    if (isLocatorField(field.key)) {
      const insertAt = findContainerFallbackIndex(nextSegments);
      nextSegments.splice(insertAt, 0, fallbackSegment);
      continue;
    }

    if (field.key === 'reportNumber') {
      const insertAt = findReportFallbackIndex(nextSegments);
      nextSegments.splice(insertAt, 0, fallbackSegment);
      continue;
    }

    nextSegments.push(fallbackSegment);
  }

  return nextSegments;
}

function createArticleJournalLocatorFallbackSegment(
  missingFields: RenderEligibleField[],
  carrier: ReferenceCarrier,
): RenderSegment | null {
  if (carrier.type.type !== 'article-journal') {
    return null;
  }

  const volume = getMissingEligibleFieldValue(missingFields, 'volume');
  const issue = getMissingEligibleFieldValue(missingFields, 'issue');
  const pages = getMissingEligibleFieldValue(missingFields, 'pages');
  const articleNumber = getMissingEligibleFieldValue(missingFields, 'articleNumber');

  if (!volume && !issue && !pages && !articleNumber) {
    return null;
  }

  const text = formatArticleJournalLocatorFallback({
    ...(volume ? { volume } : {}),
    ...(issue ? { issue } : {}),
    ...(pages ? { pages } : {}),
    ...(articleNumber ? { articleNumber } : {}),
  });
  const cleaned = cleanText(text ?? null);
  if (!cleaned) return null;

  return {
    kind: 'locator',
    text: cleaned,
    protected: false,
    semanticRole: 'locator',
    styleNative: false,
    fieldKeys: uniqueFieldKeys(
      [
        volume ? 'volume' : null,
        issue ? 'issue' : null,
        pages ? 'pages' : null,
        articleNumber ? 'articleNumber' : null,
      ].filter((field): field is RenderFieldKey => Boolean(field)),
    ),
  };
}

function getMissingEligibleFieldValue(
  missingFields: RenderEligibleField[],
  key: RenderFieldKey,
): string | undefined {
  const field = missingFields.find((entry) => entry.key === key);
  return typeof field?.value === 'string' ? cleanText(field.value) : undefined;
}

function formatArticleJournalLocatorFallback(
  locators: {
    volume?: string;
    issue?: string;
    pages?: string;
    articleNumber?: string;
  },
): string | undefined {
  const lead = locators.volume
    ? `${locators.volume}${locators.issue ? `(${locators.issue})` : ''}`
    : locators.issue
      ? `(${locators.issue})`
      : undefined;
  const pages = formatPageRange(locators.pages ?? null);
  const trailing = pages ?? (locators.articleNumber ? `Article ${locators.articleNumber}` : undefined);

  if (lead && trailing) return `${lead}, ${trailing}.`;
  if (lead) return `${lead}.`;
  if (pages) return `${pages}.`;
  if (locators.articleNumber) return `Article ${locators.articleNumber}.`;
  return undefined;
}

function createFallbackSegment(
  field: RenderEligibleField,
  carrier: ReferenceCarrier,
  style: CitationStyle,
): RenderSegment | null {
  const text = formatFallbackField(field, carrier, style);
  const cleaned = cleanText(text ?? null);
  if (!cleaned) return null;

  const kind = kindForField(field.key);
  return {
    kind,
    text: cleaned,
    protected: kind === 'doi' || kind === 'url' || kind === 'identifier',
    semanticRole: kind,
    styleNative: false,
    fieldKeys: [field.key],
  };
}

function formatFallbackField(
  field: RenderEligibleField,
  carrier: ReferenceCarrier,
  style: CitationStyle,
): string | undefined {
  const value = field.value;
  switch (field.key) {
    case 'authors':
      return formatAuthors(carrier.fields.authors.value, style);
    case 'editors':
      return formatEditors(carrier.fields.editors.value, style);
    case 'year':
      return formatYear(carrier.fields.year.value, 'n.d.');
    case 'title':
      return formatTitleForRender(carrier.fields.title.value, style, 'Untitled reference');
    case 'volume':
      return typeof value === 'string' ? `vol. ${value}` : undefined;
    case 'issue':
      return typeof value === 'string'
        ? (style === 'vancouver' || style === 'ieee' ? `no. ${value}` : `issue ${value}`)
        : undefined;
    case 'pages':
      return typeof value === 'string' ? `pp. ${value}` : undefined;
    case 'articleNumber':
      return typeof value === 'string' ? `Article ${value}` : undefined;
    case 'reportNumber':
      return typeof value === 'string' ? `Report No. ${value}` : undefined;
    case 'doi':
      return typeof value === 'string'
        ? `https://doi.org/${value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}`
        : undefined;
    case 'url':
      return typeof value === 'string' ? value : undefined;
    case 'isbn':
      return typeof value === 'string' ? `ISBN ${value}` : undefined;
    case 'issn':
      return typeof value === 'string' ? `ISSN ${value}` : undefined;
    case 'pmid':
      return typeof value === 'string' ? `PMID ${value}` : undefined;
    case 'arxiv':
      return typeof value === 'string' ? `arXiv ${value}` : undefined;
    case 'handle':
      return typeof value === 'string' ? `Handle ${value}` : undefined;
    case 'accessedDate':
      return typeof value === 'string' ? `Accessed ${value}` : undefined;
    default:
      return typeof value === 'string' ? value : undefined;
  }
}

function findContainerFallbackIndex(segments: RenderSegment[]): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    if (
      segment.fieldKeys.some((key) => (
        key === 'journal'
        || key === 'conferenceTitle'
        || key === 'bookTitle'
        || key === 'siteName'
        || key === 'repository'
        || key === 'publisher'
        || key === 'institution'
        || isLocatorField(key)
      ))
    ) {
      return index + 1;
    }
  }

  return segments.length;
}

function findReportFallbackIndex(segments: RenderSegment[]): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    if (
      segment.fieldKeys.includes('title')
      || segment.fieldKeys.includes('publisher')
      || segment.fieldKeys.includes('institution')
    ) {
      return index + 1;
    }
  }

  return segments.length;
}

function isLocatorField(field: RenderFieldKey): boolean {
  return field === 'volume'
    || field === 'issue'
    || field === 'pages'
    || field === 'articleNumber'
    || field === 'reportNumber';
}

function kindForField(field: RenderFieldKey): RenderSegmentKind {
  switch (field) {
    case 'authors':
    case 'editors':
      return 'authors';
    case 'year':
      return 'year';
    case 'title':
      return 'title';
    case 'volume':
      return 'volume';
    case 'issue':
      return 'issue';
    case 'pages':
      return 'pages';
    case 'articleNumber':
      return 'articleNumber';
    case 'reportNumber':
      return 'reportNumber';
    case 'doi':
      return 'doi';
    case 'url':
      return 'url';
    case 'accessedDate':
      return 'accessedDate';
    case 'publisher':
    case 'institution':
      return 'publisher_or_institution';
    case 'journal':
    case 'conferenceTitle':
    case 'bookTitle':
    case 'siteName':
    case 'repository':
      return 'container';
    default:
      return 'literal';
  }
}

function pushOwnedSegment(
  segments: RenderSegment[],
  kind: RenderSegmentKind,
  text: string | undefined,
  fieldKeys: RenderFieldKey[] = [],
  protectedText = false,
  styleNative = true,
): void {
  const cleaned = cleanText(text ?? null);
  if (!cleaned) return;

  segments.push({
    kind,
    text: cleaned,
    protected: protectedText,
    semanticRole: kind,
    styleNative,
    fieldKeys: uniqueFieldKeys(fieldKeys),
  });
}

function ownedFieldKeys(eligibleFieldMap: EligibleFieldMap, ...keys: Array<RenderFieldKey | undefined>): RenderFieldKey[] {
  return uniqueFieldKeys(
    keys.filter((key): key is RenderFieldKey => Boolean(key) && eligibleFieldMap.has(key as RenderFieldKey)),
  );
}

function ownedLinkFieldKeys(
  eligibleFieldMap: EligibleFieldMap,
  carrier: ReferenceCarrier,
  link: string,
): RenderFieldKey[] {
  if (!isDoiUrl(link)) {
    return ownedFieldKeys(eligibleFieldMap, 'url');
  }

  const keys: RenderFieldKey[] = ['doi'];
  const sourceUrl = cleanText(carrier.fields.url.value);
  if (sourceUrl && normalizeComparableValue(sourceUrl) === normalizeComparableValue(link)) {
    keys.push('url');
  }

  return ownedFieldKeys(eligibleFieldMap, ...keys);
}

function buildReportPublisherSegment(
  carrier: ReferenceCarrier,
  eligibleFieldMap: EligibleFieldMap,
  options: ReportPublisherSegmentOptions,
): { text: string; fieldKeys: RenderFieldKey[] } | null {
  const place = cleanText(carrier.fields.placeOfPublication.value);
  const publisher = cleanText(carrier.fields.publisher.value);
  const institution = cleanText(carrier.fields.institution.value);

  const organizationParts: string[] = [];
  const fieldKeys: RenderFieldKey[] = [];

  if (publisher) {
    organizationParts.push(publisher);
    fieldKeys.push('publisher');
  }

  if (institution) {
    fieldKeys.push('institution');
    if (!publisher || !hasEquivalentComparableValue(publisher, institution)) {
      organizationParts.push(institution);
    }
  }

  if (organizationParts.length === 0) {
    return null;
  }

  if (place) {
    fieldKeys.push('placeOfPublication');
  }

  const body = place
    ? `${place}: ${organizationParts.join(options.organizationSeparator)}`
    : organizationParts.join(options.organizationSeparator);

  return {
    text: `${body}${options.suffix}`,
    fieldKeys: ownedFieldKeys(eligibleFieldMap, ...fieldKeys),
  };
}

function uniqueFieldKeys(keys: RenderFieldKey[]): RenderFieldKey[] {
  return [...new Set(keys)];
}

function isDoiUrl(value: string): boolean {
  return /https?:\/\/(?:dx\.)?doi\.org\//i.test(value);
}

function hasEquivalentComparableValue(left: string, right: string): boolean {
  return normalizeComparableValue(left) === normalizeComparableValue(right);
}

function normalizeComparableValue(value: string): string {
  return value.trim().replace(/[.,;:]+$/u, '').replace(/\/+$/u, '').replace(/\s+/gu, ' ').toLowerCase();
}

/* ═══════════════════════════════════════════════════════════════
   APA 7th Edition
   ═══════════════════════════════════════════════════════════════ */

function renderApa(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  const authors = formatAuthors(f.authors.value, 'apa7');
  const year = formatYear(f.year.value, 'n.d.');
  pushOwnedSegment(parts, 'authors', `${authors} (${year}).`, ownedFieldKeys(eligibleFieldMap, 'authors', 'year'));

  const title = formatTitleForRender(f.title.value, 'apa7', 'Untitled reference')!;

  switch (type) {
    case 'article-journal':
      pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
      break;

    case 'book': {
      const edition = cleanText(f.edition.value);
      pushOwnedSegment(
        parts,
        'title',
        edition ? `${italicize(title)} (${edition}).` : `${italicize(title)}.`,
        ownedFieldKeys(eligibleFieldMap, 'title', 'edition'),
      );
      break;
    }

    case 'book-chapter': {
      pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
      const editors = formatEditors(f.editors.value, 'apa7');
      const bookTitle = cleanText(f.bookTitle.value);
      if (bookTitle) {
        const parenItems: string[] = [];
        const edition = cleanText(f.edition.value);
        if (edition) parenItems.push(edition);
        const pages = formatPageRange(f.pages.value);
        if (pages) parenItems.push(`pp. ${pages}`);
        const paren = parenItems.length > 0 ? ` (${parenItems.join(', ')})` : '';
        pushOwnedSegment(
          parts,
          'container',
          editors
            ? `In ${editors}, ${italicize(bookTitle)}${paren}.`
            : `In ${italicize(bookTitle)}${paren}.`,
          ownedFieldKeys(eligibleFieldMap, 'editors', 'bookTitle', 'edition', 'pages'),
        );
      }
      break;
    }

    case 'thesis': {
      const thesisType = cleanText(f.thesisType.value);
      const institution = cleanText(f.institution.value);
      if (thesisType || institution) {
        pushOwnedSegment(
          parts,
          'title',
          `${italicize(title)} [${[thesisType, institution].filter(Boolean).join(', ')}].`,
          ownedFieldKeys(eligibleFieldMap, 'title', 'thesisType', 'institution'),
        );
      } else {
        pushOwnedSegment(parts, 'title', `${italicize(title)}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
      }
      break;
    }

    case 'conference-paper': {
      pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
      const conf = cleanText(f.conferenceTitle.value);
      if (conf) {
        const pages = formatPageRange(f.pages.value);
        const paren = pages ? ` (pp. ${pages})` : '';
        pushOwnedSegment(
          parts,
          'container',
          `In ${italicize(conf)}${paren}.`,
          ownedFieldKeys(eligibleFieldMap, 'conferenceTitle', 'pages'),
        );
      }
      break;
    }

    case 'report': {
      const reportNumber = cleanText(f.reportNumber.value);
      pushOwnedSegment(
        parts,
        'title',
        reportNumber ? `${italicize(title)} (${reportNumber}).` : `${italicize(title)}.`,
        ownedFieldKeys(eligibleFieldMap, 'title', 'reportNumber'),
      );
      break;
    }

    case 'patent':
      pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
      break;

    case 'webpage':
      pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
      break;

    case 'dataset':
    case 'preprint':
      pushOwnedSegment(parts, 'title', `${italicize(title)}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
      break;

    default:
      pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
      break;
  }

  switch (type) {
    case 'article-journal': {
      const journal = cleanText(f.journal.value);
      if (journal) {
        const volume = cleanText(f.volume.value);
        const issue = cleanText(f.issue.value);
        const pages = formatPageRange(f.pages.value);
        let venue = italicize(journal);
        if (volume) {
          venue += `, ${italicize(volume)}`;
          if (issue) venue += `(${issue})`;
        }
        if (pages) venue += `, ${pages}`;
        pushOwnedSegment(
          parts,
          'container',
          `${venue}.`,
          ownedFieldKeys(eligibleFieldMap, 'journal', 'volume', 'issue', 'pages'),
        );
      }
      break;
    }

    case 'book':
    case 'book-chapter':
    case 'conference-paper': {
      const publisher = cleanText(f.publisher.value);
      if (publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${publisher}.`, ownedFieldKeys(eligibleFieldMap, 'publisher'));
      }
      break;
    }

    case 'report': {
      const reportPublisher = buildReportPublisherSegment(
        carrier,
        eligibleFieldMap,
        { organizationSeparator: '; ', suffix: '.' },
      );
      if (reportPublisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', reportPublisher.text, reportPublisher.fieldKeys);
      }
      break;
    }

    case 'webpage': {
      const siteName = cleanText(f.siteName.value);
      if (siteName) {
        pushOwnedSegment(parts, 'container', `${siteName}.`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
      }
      break;
    }

    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution}.`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      if (patent) {
        pushOwnedSegment(parts, 'literal', `${patent}.`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      }
      break;
    }

    case 'thesis':
    case 'preprint':
    case 'dataset': {
      const repository = cleanText(f.repository.value);
      if (repository) {
        pushOwnedSegment(parts, 'container', `${repository}.`, ownedFieldKeys(eligibleFieldMap, 'repository'));
      }
      break;
    }
  }

  if (type === 'webpage') {
    const accessedDate = cleanText(f.accessedDate.value);
    const doi = cleanText(f.doi.value);
    const url = cleanText(f.url.value);
    if (!doi && accessedDate && url) {
      pushOwnedSegment(parts, 'url', `Retrieved ${accessedDate}, from ${url}`, ownedFieldKeys(eligibleFieldMap, 'accessedDate', 'url'), true);
    } else {
      const link = renderLink(carrier);
      if (link) {
        pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), link, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
      }
    }
  } else {
    const link = renderLink(carrier);
    if (link) {
      pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), link, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
    }
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   MLA 9th Edition
   ═══════════════════════════════════════════════════════════════ */

function renderMla(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  const authors = formatAuthors(f.authors.value, 'mla9');
  pushOwnedSegment(parts, 'authors', `${authors}.`, ownedFieldKeys(eligibleFieldMap, 'authors'));

  const title = formatTitleForRender(f.title.value, 'mla9', 'Untitled reference')!;

  if (type === 'article-journal' || type === 'book-chapter' || type === 'conference-paper') {
    pushOwnedSegment(parts, 'title', `"${title}."`, ownedFieldKeys(eligibleFieldMap, 'title'));
  } else {
    pushOwnedSegment(parts, 'title', `${italicize(title)}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
  }

  switch (type) {
    case 'article-journal': {
      const journal = cleanText(f.journal.value);
      if (journal) {
        pushOwnedSegment(parts, 'container', `${italicize(journal)},`, ownedFieldKeys(eligibleFieldMap, 'journal'));
      }
      break;
    }
    case 'book-chapter': {
      const bookTitle = cleanText(f.bookTitle.value);
      if (bookTitle) {
        pushOwnedSegment(parts, 'container', `${italicize(bookTitle)},`, ownedFieldKeys(eligibleFieldMap, 'bookTitle'));
      }
      const editors = formatEditors(f.editors.value, 'mla9');
      if (editors) {
        pushOwnedSegment(parts, 'literal', `edited by ${editors},`, ownedFieldKeys(eligibleFieldMap, 'editors'));
      }
      break;
    }
    case 'conference-paper': {
      const conf = cleanText(f.conferenceTitle.value);
      if (conf) {
        pushOwnedSegment(parts, 'container', `${italicize(conf)},`, ownedFieldKeys(eligibleFieldMap, 'conferenceTitle'));
      }
      break;
    }
    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution},`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      if (patent) {
        pushOwnedSegment(parts, 'literal', `${patent},`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      }
      break;
    }
    case 'webpage': {
      const siteName = cleanText(f.siteName.value);
      if (siteName) {
        pushOwnedSegment(parts, 'container', `${italicize(siteName)},`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
      }
      break;
    }
  }

  if (type === 'report') {
    const reportPublisher = buildReportPublisherSegment(
      carrier,
      eligibleFieldMap,
      { organizationSeparator: '; ', suffix: ',' },
    );
    if (reportPublisher) {
      pushOwnedSegment(parts, 'publisher_or_institution', reportPublisher.text, reportPublisher.fieldKeys);
    }
  } else if (type !== 'article-journal') {
    const publisher = cleanText(f.publisher.value);
    if (publisher) {
      pushOwnedSegment(parts, 'publisher_or_institution', `${publisher},`, ownedFieldKeys(eligibleFieldMap, 'publisher'));
    }
  }

  const edition = cleanText(f.edition.value);
  if (edition) {
    pushOwnedSegment(parts, 'literal', `${edition},`, ownedFieldKeys(eligibleFieldMap, 'edition'));
  }

  const volume = cleanText(f.volume.value);
  const issue = cleanText(f.issue.value);
  if (volume) {
    let vol = `vol. ${volume}`;
    if (issue) vol += `, no. ${issue}`;
    pushOwnedSegment(parts, 'volume', `${vol},`, ownedFieldKeys(eligibleFieldMap, 'volume', 'issue'));
  } else if (issue) {
    pushOwnedSegment(parts, 'issue', `no. ${issue},`, ownedFieldKeys(eligibleFieldMap, 'issue'));
  }

  const year = formatYear(f.year.value, 'n.d.');
  pushOwnedSegment(parts, 'year', `${year},`, ownedFieldKeys(eligibleFieldMap, 'year'));

  const pages = formatPageRange(f.pages.value);
  if (pages && type !== 'book-chapter') {
    pushOwnedSegment(parts, 'pages', `pp. ${pages}.`, ownedFieldKeys(eligibleFieldMap, 'pages'));
  }

  if (type === 'thesis') {
    const thesisType = cleanText(f.thesisType.value);
    const institution = cleanText(f.institution.value);
    if (thesisType) {
      pushOwnedSegment(parts, 'literal', `${thesisType}.`, ownedFieldKeys(eligibleFieldMap, 'thesisType'));
    }
    if (institution) {
      pushOwnedSegment(parts, 'publisher_or_institution', `${institution},`, ownedFieldKeys(eligibleFieldMap, 'institution'));
    }
  }

  if (type === 'preprint' || type === 'dataset') {
    const repository = cleanText(f.repository.value);
    if (repository) {
      pushOwnedSegment(parts, 'container', `${repository},`, ownedFieldKeys(eligibleFieldMap, 'repository'));
    }
  }

  if (type === 'report') {
    const reportNumber = cleanText(f.reportNumber.value);
    if (reportNumber) {
      pushOwnedSegment(parts, 'reportNumber', `${reportNumber},`, ownedFieldKeys(eligibleFieldMap, 'reportNumber'));
    }
  }

  const link = renderLink(carrier);
  if (link) {
    pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), link, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
  }

  if (type === 'webpage') {
    const accessedDate = cleanText(f.accessedDate.value);
    if (accessedDate) {
      pushOwnedSegment(parts, 'accessedDate', `Accessed ${accessedDate}.`, ownedFieldKeys(eligibleFieldMap, 'accessedDate'));
    }
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   Chicago Author-Date
   ═══════════════════════════════════════════════════════════════ */

function renderChicagoAuthorDate(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  const authors = formatAuthors(f.authors.value, 'chicago-author-date');
  const year = formatYear(f.year.value, 'n.d.');
  pushOwnedSegment(parts, 'authors', `${authors}. ${year}.`, ownedFieldKeys(eligibleFieldMap, 'authors', 'year'));

  const title = formatTitleForRender(f.title.value, 'chicago-author-date', 'Untitled reference')!;

  if (type === 'article-journal' || type === 'book-chapter' || type === 'conference-paper') {
    pushOwnedSegment(parts, 'title', `"${title}."`, ownedFieldKeys(eligibleFieldMap, 'title'));
  } else {
    pushOwnedSegment(parts, 'title', `${italicize(title)}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
  }

  switch (type) {
    case 'book-chapter': {
      const editors = formatEditors(f.editors.value, 'chicago-author-date');
      const bookTitle = cleanText(f.bookTitle.value);
      if (bookTitle && editors) {
        pushOwnedSegment(
          parts,
          'container',
          `In ${italicize(bookTitle)}, edited by ${editors}.`,
          ownedFieldKeys(eligibleFieldMap, 'bookTitle', 'editors'),
        );
      } else if (bookTitle) {
        pushOwnedSegment(parts, 'container', `In ${italicize(bookTitle)}.`, ownedFieldKeys(eligibleFieldMap, 'bookTitle'));
      }
      break;
    }
    case 'conference-paper': {
      const conf = cleanText(f.conferenceTitle.value);
      if (conf) {
        pushOwnedSegment(parts, 'container', `In ${italicize(conf)}.`, ownedFieldKeys(eligibleFieldMap, 'conferenceTitle'));
      }
      break;
    }
    case 'thesis': {
      const thesisType = cleanText(f.thesisType.value);
      const institution = cleanText(f.institution.value);
      if (thesisType) {
        pushOwnedSegment(parts, 'literal', `${thesisType},`, ownedFieldKeys(eligibleFieldMap, 'thesisType'));
      }
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution}.`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      break;
    }
    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution}.`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      if (patent) {
        pushOwnedSegment(parts, 'literal', `${patent}.`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      }
      break;
    }
  }

  if (type === 'article-journal') {
    const journal = cleanText(f.journal.value);
    if (journal) {
      let jstr = italicize(journal);
      const volume = cleanText(f.volume.value);
      const issue = cleanText(f.issue.value);
      const pagesVal = formatPageRange(f.pages.value);
      if (volume) {
        jstr += ` ${volume}`;
        if (issue) jstr += `, no. ${issue}`;
      }
      if (pagesVal) jstr += `: ${pagesVal}`;
      pushOwnedSegment(
        parts,
        'container',
        `${jstr}.`,
        ownedFieldKeys(eligibleFieldMap, 'journal', 'volume', 'issue', 'pages'),
      );
    }
  }

  const edition = cleanText(f.edition.value);
  if (edition) {
    pushOwnedSegment(parts, 'literal', `${edition}.`, ownedFieldKeys(eligibleFieldMap, 'edition'));
  }

  if (type === 'report') {
    const reportPublisher = buildReportPublisherSegment(
      carrier,
      eligibleFieldMap,
      { organizationSeparator: '; ', suffix: '.' },
    );
    if (reportPublisher) {
      pushOwnedSegment(parts, 'publisher_or_institution', reportPublisher.text, reportPublisher.fieldKeys);
    }
  } else if (type === 'book' || type === 'book-chapter') {
    const place = cleanText(f.placeOfPublication.value);
    const publisher = cleanText(f.publisher.value);
    if (place && publisher) {
      pushOwnedSegment(
        parts,
        'publisher_or_institution',
        `${place}: ${publisher}.`,
        ownedFieldKeys(eligibleFieldMap, 'placeOfPublication', 'publisher'),
      );
    } else if (publisher) {
      pushOwnedSegment(parts, 'publisher_or_institution', `${publisher}.`, ownedFieldKeys(eligibleFieldMap, 'publisher'));
    }
  }

  if (type === 'report') {
    const reportNumber = cleanText(f.reportNumber.value);
    if (reportNumber) {
      pushOwnedSegment(parts, 'reportNumber', `${reportNumber}.`, ownedFieldKeys(eligibleFieldMap, 'reportNumber'));
    }
  }

  if (type === 'preprint' || type === 'dataset') {
    const repository = cleanText(f.repository.value);
    if (repository) {
      pushOwnedSegment(parts, 'container', `${repository}.`, ownedFieldKeys(eligibleFieldMap, 'repository'));
    }
  }

  if (type === 'webpage') {
    const siteName = cleanText(f.siteName.value);
    if (siteName) {
      pushOwnedSegment(parts, 'container', `${siteName}.`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
    }
    const accessedDate = cleanText(f.accessedDate.value);
    if (accessedDate) {
      pushOwnedSegment(parts, 'accessedDate', `Accessed ${accessedDate}.`, ownedFieldKeys(eligibleFieldMap, 'accessedDate'));
    }
  }

  const link = renderLink(carrier);
  if (link) {
    pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), link, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   Vancouver
   ═══════════════════════════════════════════════════════════════ */

function renderVancouver(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  const authors = formatAuthors(f.authors.value, 'vancouver');
  pushOwnedSegment(parts, 'authors', `${authors}.`, ownedFieldKeys(eligibleFieldMap, 'authors'));

  const title = formatTitleForRender(f.title.value, 'vancouver', 'Untitled reference')!;
  pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));

  switch (type) {
    case 'book-chapter': {
      const editors = formatEditors(f.editors.value, 'vancouver');
      const bookTitle = cleanText(f.bookTitle.value);
      if (bookTitle && editors) {
        pushOwnedSegment(
          parts,
          'container',
          `In: ${editors}, editors. ${bookTitle}.`,
          ownedFieldKeys(eligibleFieldMap, 'editors', 'bookTitle'),
        );
      } else if (bookTitle) {
        pushOwnedSegment(parts, 'container', `In: ${bookTitle}.`, ownedFieldKeys(eligibleFieldMap, 'bookTitle'));
      }
      break;
    }
    case 'conference-paper': {
      const conf = cleanText(f.conferenceTitle.value);
      if (conf) {
        pushOwnedSegment(parts, 'container', `In: ${conf}.`, ownedFieldKeys(eligibleFieldMap, 'conferenceTitle'));
      }
      break;
    }
    case 'thesis': {
      const thesisType = cleanText(f.thesisType.value);
      const institution = cleanText(f.institution.value);
      if (thesisType) {
        pushOwnedSegment(parts, 'literal', `[${thesisType}].`, ownedFieldKeys(eligibleFieldMap, 'thesisType'));
      }
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution};`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      break;
    }
    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution}.`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      if (patent) {
        pushOwnedSegment(parts, 'literal', `${patent}.`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      }
      break;
    }
  }

  if (type === 'article-journal') {
    const journal = cleanText(f.journal.value);
    if (journal) {
      pushOwnedSegment(parts, 'container', `${journal}.`, ownedFieldKeys(eligibleFieldMap, 'journal'));
    }
  }

  if (type === 'report') {
    const reportPublisher = buildReportPublisherSegment(
      carrier,
      eligibleFieldMap,
      { organizationSeparator: '; ', suffix: ';' },
    );
    if (reportPublisher) {
      pushOwnedSegment(parts, 'publisher_or_institution', reportPublisher.text, reportPublisher.fieldKeys);
    }
  } else if (type === 'book' || type === 'book-chapter') {
    const place = cleanText(f.placeOfPublication.value);
    const publisher = cleanText(f.publisher.value);
    if (place && publisher) {
      pushOwnedSegment(
        parts,
        'publisher_or_institution',
        `${place}: ${publisher};`,
        ownedFieldKeys(eligibleFieldMap, 'placeOfPublication', 'publisher'),
      );
    } else if (publisher) {
      pushOwnedSegment(parts, 'publisher_or_institution', `${publisher};`, ownedFieldKeys(eligibleFieldMap, 'publisher'));
    }
  }

  const edition = cleanText(f.edition.value);
  if (edition) {
    pushOwnedSegment(parts, 'literal', `${edition}.`, ownedFieldKeys(eligibleFieldMap, 'edition'));
  }

  const year = formatYear(f.year.value, 'n.d.');
  const volume = cleanText(f.volume.value);
  const issue = cleanText(f.issue.value);
  const pages = formatPageRange(f.pages.value);
  if (volume || issue || pages) {
    let loc = '';
    if (volume) loc += volume;
    if (issue) loc += `(${issue})`;
    if (pages) loc += `:${pages}`;
    pushOwnedSegment(parts, 'volume', `${year};${loc}.`, ownedFieldKeys(eligibleFieldMap, 'year', 'volume', 'issue', 'pages'));
  } else {
    pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
  }

  if (type === 'report') {
    const reportNumber = cleanText(f.reportNumber.value);
    if (reportNumber) {
      pushOwnedSegment(parts, 'reportNumber', `Report No.: ${reportNumber}.`, ownedFieldKeys(eligibleFieldMap, 'reportNumber'));
    }
  }

  if (type === 'preprint' || type === 'dataset') {
    const repository = cleanText(f.repository.value);
    if (repository) {
      pushOwnedSegment(parts, 'container', `${repository}.`, ownedFieldKeys(eligibleFieldMap, 'repository'));
    }
  }

  if (type === 'webpage') {
    const siteName = cleanText(f.siteName.value);
    if (siteName) {
      pushOwnedSegment(parts, 'container', `${siteName}.`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
    }
    const accessedDate = cleanText(f.accessedDate.value);
    if (accessedDate) {
      pushOwnedSegment(parts, 'accessedDate', `[cited ${accessedDate}].`, ownedFieldKeys(eligibleFieldMap, 'accessedDate'));
    }
  }

  const link = renderLink(carrier);
  if (link) {
    pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), link, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   IEEE
   ═══════════════════════════════════════════════════════════════ */

function renderIeee(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  pushOwnedSegment(parts, 'authors', `${formatAuthors(f.authors.value, 'ieee')},`, ownedFieldKeys(eligibleFieldMap, 'authors'));

  const title = formatTitleForRender(f.title.value, 'ieee', 'Untitled reference')!;
  pushOwnedSegment(parts, 'title', `"${title},"`, ownedFieldKeys(eligibleFieldMap, 'title'));

  switch (type) {
    case 'article-journal': {
      const journal = cleanText(f.journal.value);
      if (journal) {
        pushOwnedSegment(parts, 'container', `${italicize(journal)},`, ownedFieldKeys(eligibleFieldMap, 'journal'));
      }
      const volume = cleanText(f.volume.value);
      const issue = cleanText(f.issue.value);
      const pages = formatPageRange(f.pages.value);
      if (volume) pushOwnedSegment(parts, 'volume', `vol. ${volume},`, ownedFieldKeys(eligibleFieldMap, 'volume'));
      if (issue) pushOwnedSegment(parts, 'issue', `no. ${issue},`, ownedFieldKeys(eligibleFieldMap, 'issue'));
      if (pages) pushOwnedSegment(parts, 'pages', `pp. ${pages},`, ownedFieldKeys(eligibleFieldMap, 'pages'));
      break;
    }
    case 'conference-paper': {
      const conf = cleanText(f.conferenceTitle.value);
      if (conf) {
        pushOwnedSegment(parts, 'container', `in ${italicize(conf)},`, ownedFieldKeys(eligibleFieldMap, 'conferenceTitle'));
      }
      const pages = formatPageRange(f.pages.value);
      if (pages) pushOwnedSegment(parts, 'pages', `pp. ${pages},`, ownedFieldKeys(eligibleFieldMap, 'pages'));
      break;
    }
    case 'book-chapter': {
      const bookTitle = cleanText(f.bookTitle.value);
      if (bookTitle) {
        pushOwnedSegment(parts, 'container', `in ${italicize(bookTitle)},`, ownedFieldKeys(eligibleFieldMap, 'bookTitle'));
      }
      const editors = formatEditors(f.editors.value, 'ieee');
      if (editors) {
        pushOwnedSegment(parts, 'literal', `edited by ${editors},`, ownedFieldKeys(eligibleFieldMap, 'editors'));
      }
      const pages = formatPageRange(f.pages.value);
      if (pages) pushOwnedSegment(parts, 'pages', `pp. ${pages},`, ownedFieldKeys(eligibleFieldMap, 'pages'));
      break;
    }
    case 'book': {
      const edition = cleanText(f.edition.value);
      if (edition) pushOwnedSegment(parts, 'literal', `${edition},`, ownedFieldKeys(eligibleFieldMap, 'edition'));
      const place = cleanText(f.placeOfPublication.value);
      const publisher = cleanText(f.publisher.value);
      if (place && publisher) {
        pushOwnedSegment(
          parts,
          'publisher_or_institution',
          `${place}: ${publisher},`,
          ownedFieldKeys(eligibleFieldMap, 'placeOfPublication', 'publisher'),
        );
      } else if (publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${publisher},`, ownedFieldKeys(eligibleFieldMap, 'publisher'));
      }
      break;
    }
    case 'thesis': {
      const thesisType = cleanText(f.thesisType.value);
      const institution = cleanText(f.institution.value);
      if (thesisType) pushOwnedSegment(parts, 'literal', `${thesisType},`, ownedFieldKeys(eligibleFieldMap, 'thesisType'));
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution},`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      break;
    }
    case 'report': {
      const reportPublisher = buildReportPublisherSegment(
        carrier,
        eligibleFieldMap,
        { organizationSeparator: '; ', suffix: ',' },
      );
      const reportNumber = cleanText(f.reportNumber.value);
      if (reportPublisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', reportPublisher.text, reportPublisher.fieldKeys);
      }
      if (reportNumber) {
        pushOwnedSegment(parts, 'reportNumber', `Report ${reportNumber},`, ownedFieldKeys(eligibleFieldMap, 'reportNumber'));
      }
      break;
    }
    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution},`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      if (patent) {
        pushOwnedSegment(parts, 'literal', `${patent},`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      }
      break;
    }
    case 'webpage': {
      const siteName = cleanText(f.siteName.value);
      if (siteName) {
        pushOwnedSegment(parts, 'container', `${siteName},`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
      }
      break;
    }
    case 'dataset':
    case 'preprint': {
      const repository = cleanText(f.repository.value);
      if (repository) {
        pushOwnedSegment(parts, 'container', `${repository},`, ownedFieldKeys(eligibleFieldMap, 'repository'));
      }
      break;
    }
  }

  const year = formatYear(f.year.value, 'n.d.');
  pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
  const link = renderLink(carrier);
  if (link) {
    pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), link, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
  }

  if (type === 'webpage') {
    const accessedDate = cleanText(f.accessedDate.value);
    if (accessedDate) {
      pushOwnedSegment(parts, 'accessedDate', `Accessed: ${accessedDate}.`, ownedFieldKeys(eligibleFieldMap, 'accessedDate'));
    }
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   Harvard CTR
   ═══════════════════════════════════════════════════════════════ */

function renderHarvardCtr(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  const authors = formatAuthors(f.authors.value, 'harvard-ctr');
  const year = formatYear(f.year.value, 'n.d.');
  pushOwnedSegment(parts, 'authors', `${authors} (${year})`, ownedFieldKeys(eligibleFieldMap, 'authors', 'year'));

  const title = formatTitleForRender(f.title.value, 'harvard-ctr', 'Untitled reference')!;
  pushOwnedSegment(parts, 'title', `'${title}',`, ownedFieldKeys(eligibleFieldMap, 'title'));

  switch (type) {
    case 'article-journal': {
      const journal = cleanText(f.journal.value);
      if (journal) {
        pushOwnedSegment(parts, 'container', `${italicize(journal)},`, ownedFieldKeys(eligibleFieldMap, 'journal'));
      }
      const volume = cleanText(f.volume.value);
      const issue = cleanText(f.issue.value);
      const pages = formatPageRange(f.pages.value);
      if (volume) pushOwnedSegment(parts, 'volume', `vol. ${volume},`, ownedFieldKeys(eligibleFieldMap, 'volume'));
      if (issue) pushOwnedSegment(parts, 'issue', `no. ${issue},`, ownedFieldKeys(eligibleFieldMap, 'issue'));
      if (pages) pushOwnedSegment(parts, 'pages', `pp. ${pages}.`, ownedFieldKeys(eligibleFieldMap, 'pages'));
      break;
    }
    case 'book': {
      const edition = cleanText(f.edition.value);
      if (edition) pushOwnedSegment(parts, 'literal', `${edition},`, ownedFieldKeys(eligibleFieldMap, 'edition'));
      const place = cleanText(f.placeOfPublication.value);
      const publisher = cleanText(f.publisher.value);
      if (place && publisher) {
        pushOwnedSegment(
          parts,
          'publisher_or_institution',
          `${place}: ${publisher}.`,
          ownedFieldKeys(eligibleFieldMap, 'placeOfPublication', 'publisher'),
        );
      } else if (publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${publisher}.`, ownedFieldKeys(eligibleFieldMap, 'publisher'));
      }
      break;
    }
    case 'book-chapter': {
      const editors = formatEditors(f.editors.value, 'harvard-ctr');
      const bookTitle = cleanText(f.bookTitle.value);
      if (editors) {
        pushOwnedSegment(parts, 'literal', `in ${editors} (eds.),`, ownedFieldKeys(eligibleFieldMap, 'editors'));
      }
      if (bookTitle) {
        pushOwnedSegment(parts, 'container', `${italicize(bookTitle)},`, ownedFieldKeys(eligibleFieldMap, 'bookTitle'));
      }
      const place = cleanText(f.placeOfPublication.value);
      const publisher = cleanText(f.publisher.value);
      if (place && publisher) {
        pushOwnedSegment(
          parts,
          'publisher_or_institution',
          `${place}: ${publisher},`,
          ownedFieldKeys(eligibleFieldMap, 'placeOfPublication', 'publisher'),
        );
      }
      const pages = formatPageRange(f.pages.value);
      if (pages) pushOwnedSegment(parts, 'pages', `pp. ${pages}.`, ownedFieldKeys(eligibleFieldMap, 'pages'));
      break;
    }
    case 'conference-paper': {
      const conf = cleanText(f.conferenceTitle.value);
      if (conf) {
        pushOwnedSegment(parts, 'container', `in ${italicize(conf)},`, ownedFieldKeys(eligibleFieldMap, 'conferenceTitle'));
      }
      const pages = formatPageRange(f.pages.value);
      if (pages) pushOwnedSegment(parts, 'pages', `pp. ${pages}.`, ownedFieldKeys(eligibleFieldMap, 'pages'));
      break;
    }
    case 'thesis': {
      const thesisType = cleanText(f.thesisType.value);
      const institution = cleanText(f.institution.value);
      if (thesisType) pushOwnedSegment(parts, 'literal', `${thesisType},`, ownedFieldKeys(eligibleFieldMap, 'thesisType'));
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution}.`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      break;
    }
    case 'report': {
      const reportPublisher = buildReportPublisherSegment(
        carrier,
        eligibleFieldMap,
        { organizationSeparator: '; ', suffix: ',' },
      );
      const reportNumber = cleanText(f.reportNumber.value);
      if (reportPublisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', reportPublisher.text, reportPublisher.fieldKeys);
      }
      if (reportNumber) {
        pushOwnedSegment(parts, 'reportNumber', `${reportNumber}.`, ownedFieldKeys(eligibleFieldMap, 'reportNumber'));
      }
      break;
    }
    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      if (institution) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${institution}.`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      }
      if (patent) {
        pushOwnedSegment(parts, 'literal', `${patent}.`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      }
      break;
    }
    case 'webpage': {
      const siteName = cleanText(f.siteName.value);
      if (siteName) {
        pushOwnedSegment(parts, 'container', `${siteName}.`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
      }
      break;
    }
    case 'dataset':
    case 'preprint': {
      const repository = cleanText(f.repository.value);
      if (repository) {
        pushOwnedSegment(parts, 'container', `${repository}.`, ownedFieldKeys(eligibleFieldMap, 'repository'));
      }
      break;
    }
  }

  const link = renderLink(carrier);
  if (link) {
    pushOwnedSegment(
      parts,
      kindForField(link.includes('doi.org/') ? 'doi' : 'url'),
      `Available at: ${link}.`,
      ownedLinkFieldKeys(eligibleFieldMap, carrier, link),
      true,
    );
  }

  if (type === 'webpage') {
    const accessedDate = cleanText(f.accessedDate.value);
    if (accessedDate) {
      pushOwnedSegment(parts, 'accessedDate', `Accessed ${accessedDate}.`, ownedFieldKeys(eligibleFieldMap, 'accessedDate'));
    }
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   AMA (numbered, Vancouver-like authors, abbreviated journal)
   ═══════════════════════════════════════════════════════════════ */

function renderAma(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  const authors = formatAuthors(f.authors.value, 'ama');
  pushOwnedSegment(parts, 'authors', `${authors}.`, ownedFieldKeys(eligibleFieldMap, 'authors'));

  const title = formatTitleForRender(f.title.value, 'ama', 'Untitled reference')!;
  if (type === 'book' || type === 'thesis' || type === 'preprint' || type === 'dataset') {
    pushOwnedSegment(parts, 'title', `${italicize(title)}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
  } else {
    pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
  }

  switch (type) {
    case 'book-chapter': {
      const editors = formatEditors(f.editors.value, 'vancouver');
      const bookTitle = cleanText(f.bookTitle.value);
      if (bookTitle && editors) {
        pushOwnedSegment(parts, 'container', `In: ${editors}, eds. ${italicize(bookTitle)}.`, ownedFieldKeys(eligibleFieldMap, 'editors', 'bookTitle'));
      } else if (bookTitle) {
        pushOwnedSegment(parts, 'container', `In: ${italicize(bookTitle)}.`, ownedFieldKeys(eligibleFieldMap, 'bookTitle'));
      }
      break;
    }
    case 'conference-paper': {
      const conf = cleanText(f.conferenceTitle.value);
      if (conf) {
        pushOwnedSegment(parts, 'container', `In: ${italicize(conf)}.`, ownedFieldKeys(eligibleFieldMap, 'conferenceTitle'));
      }
      break;
    }
    case 'thesis': {
      const thesisType = cleanText(f.thesisType.value);
      const institution = cleanText(f.institution.value);
      if (thesisType) pushOwnedSegment(parts, 'literal', `[${thesisType}].`, ownedFieldKeys(eligibleFieldMap, 'thesisType'));
      if (institution) pushOwnedSegment(parts, 'publisher_or_institution', `${institution};`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      break;
    }
    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      if (institution) pushOwnedSegment(parts, 'publisher_or_institution', `${institution}.`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      if (patent) pushOwnedSegment(parts, 'literal', `${patent}.`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      break;
    }
  }

  if (type === 'article-journal') {
    const journal = cleanText(f.journal.value);
    if (journal) {
      pushOwnedSegment(parts, 'container', `${italicize(journal)}.`, ownedFieldKeys(eligibleFieldMap, 'journal'));
    }
    const year = formatYear(f.year.value, 'n.d.');
    const volume = cleanText(f.volume.value);
    const issue = cleanText(f.issue.value);
    const pages = formatPageRange(f.pages.value);
    if (volume || issue || pages) {
      let loc = `${year}`;
      if (volume) loc += `;${volume}`;
      if (issue) loc += `(${issue})`;
      if (pages) loc += `:${pages}`;
      pushOwnedSegment(parts, 'volume', `${loc}.`, ownedFieldKeys(eligibleFieldMap, 'year', 'volume', 'issue', 'pages'));
    } else {
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
    }
  } else {
    if (type === 'book' || type === 'book-chapter') {
      const place = cleanText(f.placeOfPublication.value);
      const publisher = cleanText(f.publisher.value);
      if (place && publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${place}: ${publisher};`, ownedFieldKeys(eligibleFieldMap, 'placeOfPublication', 'publisher'));
      } else if (publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${publisher};`, ownedFieldKeys(eligibleFieldMap, 'publisher'));
      }
    }
    if (type === 'report') {
      const reportPublisher = buildReportPublisherSegment(
        carrier,
        eligibleFieldMap,
        { organizationSeparator: '; ', suffix: ';' },
      );
      if (reportPublisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', reportPublisher.text, reportPublisher.fieldKeys);
      }
      const reportNumber = cleanText(f.reportNumber.value);
      if (reportNumber) pushOwnedSegment(parts, 'reportNumber', `Report No.: ${reportNumber}.`, ownedFieldKeys(eligibleFieldMap, 'reportNumber'));
    }
    if (type === 'webpage') {
      const siteName = cleanText(f.siteName.value);
      if (siteName) pushOwnedSegment(parts, 'container', `${siteName}.`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
    }
    if (type === 'preprint' || type === 'dataset') {
      const repository = cleanText(f.repository.value);
      if (repository) pushOwnedSegment(parts, 'container', `${repository}.`, ownedFieldKeys(eligibleFieldMap, 'repository'));
    }
    const year = formatYear(f.year.value, 'n.d.');
    pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
  }

  if (type === 'webpage') {
    const accessedDate = cleanText(f.accessedDate.value);
    if (accessedDate) {
      pushOwnedSegment(parts, 'accessedDate', `Accessed ${accessedDate}.`, ownedFieldKeys(eligibleFieldMap, 'accessedDate'));
    }
  }

  const link = renderLink(carrier);
  if (link) {
    pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), link, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   ACS (American Chemical Society)
   "Author, A.; Author, B. Title. Journal Year, Vol, Pages."
   ═══════════════════════════════════════════════════════════════ */

function renderAcs(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  const authors = formatAuthors(f.authors.value, 'acs');
  pushOwnedSegment(parts, 'authors', `${authors}.`, ownedFieldKeys(eligibleFieldMap, 'authors'));

  const title = formatTitleForRender(f.title.value, 'acs', 'Untitled reference')!;
  if (type === 'book' || type === 'thesis' || type === 'preprint' || type === 'dataset') {
    pushOwnedSegment(parts, 'title', `${italicize(title)}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
  } else {
    pushOwnedSegment(parts, 'title', `${title}.`, ownedFieldKeys(eligibleFieldMap, 'title'));
  }

  switch (type) {
    case 'article-journal': {
      const journal = cleanText(f.journal.value);
      if (journal) {
        pushOwnedSegment(parts, 'container', `${italicize(journal)}`, ownedFieldKeys(eligibleFieldMap, 'journal'));
      }
      const year = formatYear(f.year.value, 'n.d.');
      const volume = cleanText(f.volume.value);
      const issue = cleanText(f.issue.value);
      const pages = formatPageRange(f.pages.value);
      const tail: string[] = [italicize(year)];
      if (volume) tail.push(`${italicize(volume)}${issue ? ` (${issue})` : ''}`);
      else if (issue) tail.push(`(${issue})`);
      if (pages) tail.push(pages);
      pushOwnedSegment(parts, 'volume', `${tail.join(', ')}.`, ownedFieldKeys(eligibleFieldMap, 'year', 'volume', 'issue', 'pages'));
      break;
    }
    case 'book-chapter': {
      const bookTitle = cleanText(f.bookTitle.value);
      const editors = formatEditors(f.editors.value, 'chicago-author-date');
      if (bookTitle) {
        pushOwnedSegment(parts, 'container', `In ${italicize(bookTitle)};`, ownedFieldKeys(eligibleFieldMap, 'bookTitle'));
      }
      if (editors) {
        pushOwnedSegment(parts, 'literal', `${editors}, Eds.;`, ownedFieldKeys(eligibleFieldMap, 'editors'));
      }
      const publisher = cleanText(f.publisher.value);
      const place = cleanText(f.placeOfPublication.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (place && publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${publisher}: ${place}, ${year}.`, ownedFieldKeys(eligibleFieldMap, 'publisher', 'placeOfPublication', 'year'));
      } else if (publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${publisher}, ${year}.`, ownedFieldKeys(eligibleFieldMap, 'publisher', 'year'));
      } else {
        pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      }
      break;
    }
    case 'conference-paper': {
      const conf = cleanText(f.conferenceTitle.value);
      if (conf) pushOwnedSegment(parts, 'container', `In ${italicize(conf)};`, ownedFieldKeys(eligibleFieldMap, 'conferenceTitle'));
      const year = formatYear(f.year.value, 'n.d.');
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'book': {
      const edition = cleanText(f.edition.value);
      if (edition) pushOwnedSegment(parts, 'literal', `${edition};`, ownedFieldKeys(eligibleFieldMap, 'edition'));
      const publisher = cleanText(f.publisher.value);
      const place = cleanText(f.placeOfPublication.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (place && publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${publisher}: ${place}, ${year}.`, ownedFieldKeys(eligibleFieldMap, 'publisher', 'placeOfPublication', 'year'));
      } else if (publisher) {
        pushOwnedSegment(parts, 'publisher_or_institution', `${publisher}, ${year}.`, ownedFieldKeys(eligibleFieldMap, 'publisher', 'year'));
      } else {
        pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      }
      break;
    }
    case 'thesis': {
      const thesisType = cleanText(f.thesisType.value);
      const institution = cleanText(f.institution.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (thesisType) pushOwnedSegment(parts, 'literal', `${thesisType},`, ownedFieldKeys(eligibleFieldMap, 'thesisType'));
      if (institution) pushOwnedSegment(parts, 'publisher_or_institution', `${institution},`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'report': {
      const reportPublisher = buildReportPublisherSegment(
        carrier,
        eligibleFieldMap,
        { organizationSeparator: '; ', suffix: ',' },
      );
      const reportNumber = cleanText(f.reportNumber.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (reportNumber) pushOwnedSegment(parts, 'reportNumber', `${reportNumber};`, ownedFieldKeys(eligibleFieldMap, 'reportNumber'));
      if (reportPublisher) pushOwnedSegment(parts, 'publisher_or_institution', reportPublisher.text, reportPublisher.fieldKeys);
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (patent) pushOwnedSegment(parts, 'literal', `${patent},`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      if (institution) pushOwnedSegment(parts, 'publisher_or_institution', `${institution},`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'webpage': {
      const siteName = cleanText(f.siteName.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (siteName) pushOwnedSegment(parts, 'container', `${siteName},`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'preprint':
    case 'dataset': {
      const repository = cleanText(f.repository.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (repository) pushOwnedSegment(parts, 'container', `${repository},`, ownedFieldKeys(eligibleFieldMap, 'repository'));
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    default: {
      const year = formatYear(f.year.value, 'n.d.');
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
  }

  const link = renderLink(carrier);
  if (link) {
    pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), link, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
  }

  if (type === 'webpage') {
    const accessedDate = cleanText(f.accessedDate.value);
    if (accessedDate) {
      pushOwnedSegment(parts, 'accessedDate', `(accessed ${accessedDate}).`, ownedFieldKeys(eligibleFieldMap, 'accessedDate'));
    }
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   Chicago Notes-Bibliography (full note style)
   First Last, "Title," Journal Vol, no. Issue (Year): Pages.
   ═══════════════════════════════════════════════════════════════ */

function renderChicagoNotesBib(carrier: ReferenceCarrier, eligibleFieldMap: EligibleFieldMap): RenderSegment[] {
  const f = carrier.fields;
  const type = carrier.type.type;
  const parts: RenderSegment[] = [];

  const authors = formatAuthors(f.authors.value, 'chicago-notes-bib');
  pushOwnedSegment(parts, 'authors', `${authors},`, ownedFieldKeys(eligibleFieldMap, 'authors'));

  const title = formatTitleForRender(f.title.value, 'chicago-notes-bib', 'Untitled reference')!;
  if (type === 'article-journal' || type === 'book-chapter' || type === 'conference-paper') {
    pushOwnedSegment(parts, 'title', `"${title},"`, ownedFieldKeys(eligibleFieldMap, 'title'));
  } else {
    pushOwnedSegment(parts, 'title', `${italicize(title)}`, ownedFieldKeys(eligibleFieldMap, 'title'));
  }

  switch (type) {
    case 'article-journal': {
      const journal = cleanText(f.journal.value);
      if (journal) {
        let jstr = italicize(journal);
        const volume = cleanText(f.volume.value);
        const issue = cleanText(f.issue.value);
        const pages = formatPageRange(f.pages.value);
        const year = formatYear(f.year.value, 'n.d.');
        if (volume) jstr += ` ${volume}`;
        if (issue) jstr += `, no. ${issue}`;
        jstr += ` (${year})`;
        if (pages) jstr += `: ${pages}`;
        pushOwnedSegment(
          parts,
          'container',
          `${jstr}.`,
          ownedFieldKeys(eligibleFieldMap, 'journal', 'volume', 'issue', 'year', 'pages'),
        );
      }
      break;
    }
    case 'book-chapter': {
      const bookTitle = cleanText(f.bookTitle.value);
      const editors = formatEditors(f.editors.value, 'chicago-author-date');
      if (bookTitle && editors) {
        pushOwnedSegment(parts, 'container', `in ${italicize(bookTitle)}, ed. ${editors}`, ownedFieldKeys(eligibleFieldMap, 'bookTitle', 'editors'));
      } else if (bookTitle) {
        pushOwnedSegment(parts, 'container', `in ${italicize(bookTitle)}`, ownedFieldKeys(eligibleFieldMap, 'bookTitle'));
      }
      const place = cleanText(f.placeOfPublication.value);
      const publisher = cleanText(f.publisher.value);
      const year = formatYear(f.year.value, 'n.d.');
      const pages = formatPageRange(f.pages.value);
      const pub = place && publisher ? `${place}: ${publisher}, ${year}` : publisher ? `${publisher}, ${year}` : year;
      pushOwnedSegment(parts, 'publisher_or_institution', `(${pub})${pages ? `, ${pages}` : ''}.`, ownedFieldKeys(eligibleFieldMap, 'placeOfPublication', 'publisher', 'year', 'pages'));
      break;
    }
    case 'conference-paper': {
      const conf = cleanText(f.conferenceTitle.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (conf) pushOwnedSegment(parts, 'container', `${italicize(conf)} (${year}).`, ownedFieldKeys(eligibleFieldMap, 'conferenceTitle', 'year'));
      else pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'book': {
      const edition = cleanText(f.edition.value);
      if (edition) pushOwnedSegment(parts, 'literal', `${edition}.`, ownedFieldKeys(eligibleFieldMap, 'edition'));
      const place = cleanText(f.placeOfPublication.value);
      const publisher = cleanText(f.publisher.value);
      const year = formatYear(f.year.value, 'n.d.');
      const pub = place && publisher ? `${place}: ${publisher}, ${year}` : publisher ? `${publisher}, ${year}` : year;
      pushOwnedSegment(parts, 'publisher_or_institution', `(${pub}).`, ownedFieldKeys(eligibleFieldMap, 'placeOfPublication', 'publisher', 'year'));
      break;
    }
    case 'thesis': {
      const thesisType = cleanText(f.thesisType.value);
      const institution = cleanText(f.institution.value);
      const year = formatYear(f.year.value, 'n.d.');
      const inner = [thesisType, institution].filter(Boolean).join(', ');
      pushOwnedSegment(parts, 'publisher_or_institution', `(${inner ? `${inner}, ` : ''}${year}).`, ownedFieldKeys(eligibleFieldMap, 'thesisType', 'institution', 'year'));
      break;
    }
    case 'report': {
      const reportPublisher = buildReportPublisherSegment(
        carrier,
        eligibleFieldMap,
        { organizationSeparator: '; ', suffix: '' },
      );
      const reportNumber = cleanText(f.reportNumber.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (reportNumber) pushOwnedSegment(parts, 'reportNumber', `${reportNumber}`, ownedFieldKeys(eligibleFieldMap, 'reportNumber'));
      const pub = reportPublisher ? `${reportPublisher.text}, ${year}` : year;
      pushOwnedSegment(parts, 'publisher_or_institution', `(${pub}).`, reportPublisher ? [...reportPublisher.fieldKeys, ...ownedFieldKeys(eligibleFieldMap, 'year')] : ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'patent': {
      const institution = cleanText(f.institution.value);
      const patent = cleanText(f.patent.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (patent) pushOwnedSegment(parts, 'literal', `${patent},`, ownedFieldKeys(eligibleFieldMap, 'patent'));
      if (institution) pushOwnedSegment(parts, 'publisher_or_institution', `${institution},`, ownedFieldKeys(eligibleFieldMap, 'institution'));
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'webpage': {
      const siteName = cleanText(f.siteName.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (siteName) pushOwnedSegment(parts, 'container', `${siteName},`, ownedFieldKeys(eligibleFieldMap, 'siteName'));
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    case 'preprint':
    case 'dataset': {
      const repository = cleanText(f.repository.value);
      const year = formatYear(f.year.value, 'n.d.');
      if (repository) pushOwnedSegment(parts, 'container', `${repository},`, ownedFieldKeys(eligibleFieldMap, 'repository'));
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
    default: {
      const year = formatYear(f.year.value, 'n.d.');
      pushOwnedSegment(parts, 'year', `${year}.`, ownedFieldKeys(eligibleFieldMap, 'year'));
      break;
    }
  }

  if (type === 'webpage') {
    const accessedDate = cleanText(f.accessedDate.value);
    if (accessedDate) {
      pushOwnedSegment(parts, 'accessedDate', `Accessed ${accessedDate}.`, ownedFieldKeys(eligibleFieldMap, 'accessedDate'));
    }
  }

  const link = renderLink(carrier);
  if (link) {
    pushOwnedSegment(parts, kindForField(link.includes('doi.org/') ? 'doi' : 'url'), `${link}.`, ownedLinkFieldKeys(eligibleFieldMap, carrier, link), true);
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════════════
   Author formatting (style-specific)
   ═══════════════════════════════════════════════════════════════ */

function formatAuthors(authors: CanonicalAuthor[], style: CitationStyle): string {
  if (authors.length === 0) return 'Unknown author';

  switch (style) {
    case 'apa7':
      return formatAuthorsApa(authors);
    case 'mla9':
      return formatAuthorsMla(authors);
    case 'vancouver':
      return formatAuthorsVancouver(authors);
    case 'chicago-author-date':
      return formatAuthorsChicago(authors);
    case 'ieee':
      return formatAuthorsIeee(authors);
    case 'harvard-ctr':
      return formatAuthorsHarvard(authors);
    case 'ama':
      return formatAuthorsAma(authors);
    case 'chicago-notes-bib':
      return formatAuthorsChicagoNotes(authors);
    case 'acs':
      return formatAuthorsAcs(authors);
    default:
      return formatAuthorsApa(authors);
  }
}

// AMA: Vancouver-like — "Family II, Family II" (no periods on initials), 7+ → first 6 et al.
function formatAuthorsAma(authors: CanonicalAuthor[]): string {
  const fmt = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    return `${a.family} ${toInitials(given)}`.trim();
  };

  if (authors.length > 6) {
    return authors.slice(0, 6).map(fmt).join(', ') + ', et al';
  }
  return authors.map(fmt).join(', ');
}

// Chicago notes-bibliography: first author "First Last", rest "First Last", joined with "and".
function formatAuthorsChicagoNotes(authors: CanonicalAuthor[]): string {
  const fmt = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    return `${given} ${a.family}`.trim();
  };

  if (authors.length === 1) return fmt(authors[0]!);
  if (authors.length <= 3) {
    const allButLast = authors.slice(0, -1).map(fmt).join(', ');
    return `${allButLast}, and ${fmt(authors[authors.length - 1]!)}`;
  }
  return `${fmt(authors[0]!)} et al.`;
}

// ACS: "Family, A. B.; Family, C. D." (periods + spaces on initials, semicolon-separated).
function formatAuthorsAcs(authors: CanonicalAuthor[]): string {
  const fmt = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    const initials = toApaInitials(given);
    return `${a.family}, ${initials}`.trim().replace(/,\s*$/, '');
  };

  return authors.map(fmt).join('; ');
}

function fmtAuthorApa(a: CanonicalAuthor): string {
  if (a.isCorporate && a.literal) return a.literal;
  const given = a.given ?? a.initials ?? '';
  const initials = toApaInitials(given);
  return `${a.family}, ${initials}`.trim().replace(/,\s*$/, '');
}

function formatAuthorsApa(authors: CanonicalAuthor[]): string {
  if (authors.length === 1) return fmtAuthorApa(authors[0]!);
  if (authors.length === 2) return `${fmtAuthorApa(authors[0]!)} & ${fmtAuthorApa(authors[1]!)}`;

  // APA7: list all authors for up to 20; for 21+, first 19, ellipsis, final author.
  // Use the single ellipsis glyph (…) — a spaced ". . ." is destroyed by the
  // punctuation cleanup in finalizeCitation (collapsing into "..").
  if (authors.length > 20) {
    const first19 = authors.slice(0, 19).map(fmtAuthorApa).join(', ');
    return `${first19}, … ${fmtAuthorApa(authors[authors.length - 1]!)}`;
  }

  const allButLast = authors.slice(0, -1).map(fmtAuthorApa).join(', ');
  return `${allButLast}, & ${fmtAuthorApa(authors[authors.length - 1]!)}`;
}

function formatAuthorsMla(authors: CanonicalAuthor[]): string {
  const fmtFirst = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    return `${a.family}, ${given}`.trim().replace(/,\s*$/, '');
  };
  const fmtSubsequent = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    return `${given} ${a.family}`.trim();
  };

  if (authors.length === 1) return fmtFirst(authors[0]!);
  if (authors.length === 2) return `${fmtFirst(authors[0]!)}, and ${fmtSubsequent(authors[1]!)}`;

  // MLA9: 3+ authors → first author, et al.
  return `${fmtFirst(authors[0]!)}, et al.`;
}

function formatAuthorsVancouver(authors: CanonicalAuthor[]): string {
  const fmt = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    return `${a.family} ${toInitials(given)}`.trim();
  };

  // Vancouver: ≤6 authors list all; 7+ → first 6, et al.
  if (authors.length > 6) {
    return authors.slice(0, 6).map(fmt).join(', ') + ', et al.';
  }
  return authors.map(fmt).join(', ');
}

function formatAuthorsChicago(authors: CanonicalAuthor[]): string {
  const fmtFirst = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    return `${a.family}, ${given}`.trim().replace(/,\s*$/, '');
  };
  const fmtSubsequent = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    return `${given} ${a.family}`.trim();
  };

  if (authors.length === 1) return fmtFirst(authors[0]!);

  if (authors.length <= 3) {
    const formatted = authors.map((a, i) => (i === 0 ? fmtFirst(a) : fmtSubsequent(a)));
    const allButLast = formatted.slice(0, -1).join(', ');
    return `${allButLast}, and ${formatted[formatted.length - 1]!}`;
  }

  // Chicago author-date: 4+ → first author et al.
  return `${fmtFirst(authors[0]!)} et al.`;
}

function formatAuthorsIeee(authors: CanonicalAuthor[]): string {
  const fmt = (a: CanonicalAuthor) => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    return `${toApaInitials(given)} ${a.family}`.trim();
  };

  if (authors.length === 1) return fmt(authors[0]!);
  if (authors.length === 2) return `${fmt(authors[0]!)} and ${fmt(authors[1]!)}`;
  return `${authors.slice(0, -1).map(fmt).join(', ')}, and ${fmt(authors[authors.length - 1]!)}`;
}

function formatAuthorsHarvard(authors: CanonicalAuthor[]): string {
  if (authors.length === 1) return fmtAuthorApa(authors[0]!);
  if (authors.length === 2) return `${fmtAuthorApa(authors[0]!)} and ${fmtAuthorApa(authors[1]!)}`;
  return `${fmtAuthorApa(authors[0]!)}, et al.`;
}

/* ═══════════════════════════════════════════════════════════════
   Editor formatting
   ═══════════════════════════════════════════════════════════════ */

function formatEditors(editors: CanonicalAuthor[], style: CitationStyle): string | undefined {
  if (!editors || editors.length === 0) return undefined;

  const fmt = (a: CanonicalAuthor): string => {
    if (a.isCorporate && a.literal) return a.literal;
    const given = a.given ?? a.initials ?? '';
    switch (style) {
      case 'vancouver':
        return `${a.family} ${toInitials(given)}`.trim();
      case 'apa7': {
        const initials = toApaInitials(given);
        return `${initials} ${a.family}`.trim();
      }
      default:
        return `${given} ${a.family}`.trim();
    }
  };

  if (style === 'apa7') {
    const suffix = editors.length === 1 ? 'Ed.' : 'Eds.';
    if (editors.length === 1) return `${fmt(editors[0]!)} (${suffix})`;
    const allButLast = editors.slice(0, -1).map(fmt).join(', ');
    return `${allButLast}, & ${fmt(editors[editors.length - 1]!)} (${suffix})`;
  }

  if (style === 'mla9') {
    if (editors.length === 1) return fmt(editors[0]!);
    const allButLast = editors.slice(0, -1).map(fmt).join(', ');
    return `${allButLast}, and ${fmt(editors[editors.length - 1]!)}`;
  }

  if (style === 'vancouver') {
    return editors.map(fmt).join(', ');
  }

  // chicago
  if (editors.length === 1) return fmt(editors[0]!);
  const allButLast = editors.slice(0, -1).map(fmt).join(', ');
  return `${allButLast}, and ${fmt(editors[editors.length - 1]!)}`;
}

/* ═══════════════════════════════════════════════════════════════
   Assertion checking
   ═══════════════════════════════════════════════════════════════ */

interface AssertionSummary {
  total: number;
  passed: number;
  failed: number;
}

function runAssertions(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  rendered: string,
): AssertionSummary {
  const checks: boolean[] = [
    assertAuthorFormat(carrier, style, rendered),
    assertYearPresent(carrier, rendered),
    assertDoiFormat(carrier, rendered),
    assertVenuePresent(carrier, rendered),
  ];

  const passed = checks.filter(Boolean).length;
  return { total: checks.length, passed, failed: checks.length - passed };
}

function assessRenderedOutput(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  renderOutput: RenderOutput,
  path: 'guaranteed' | 'fallback',
): {
  warningCodes: string[];
  warnings: HealthWarning[];
  structurallyIncomplete: boolean;
  penaltyPoints: number;
} {
  const warnings: HealthWarning[] = [];
  const rendered = renderOutput.text;
  const { audit, eligibleFields } = renderOutput;
  const lostFields = audit.lost;
  const locatorLost = lostFields.includes('pages')
    || lostFields.includes('articleNumber')
    || lostFields.includes('reportNumber');
  const doiLost = lostFields.includes('doi');

  if (!rendered.trim()) {
    warnings.push(toHealthWarning('render_output_empty_or_invalid', 'render output is empty or invalid'));
  }

  if (lostFields.length > 0) {
    warnings.push(toHealthWarning(
      'render_output_structurally_incomplete',
      `rendered citation omitted eligible fields: ${lostFields.join(', ')}`,
    ));
    for (const field of lostFields) {
      warnings.push(toHealthWarning(
        'render_eligible_field_omitted',
        `valid available field "${field}" was omitted from rendered output`,
      ));
    }
  }

  if (path === 'fallback') {
    warnings.push(toHealthWarning('render_style_fallback', `render output uses fallback formatting for style ${style}`));
  }

  if (locatorLost) {
    warnings.push(toHealthWarning('locator_lost_during_render', 'locator lost during render'));
  }

  if (doiLost) {
    warnings.push(toHealthWarning('doi_lost_during_render', 'DOI lost during render'));
  }

  if (!assertVenuePresent(carrier, rendered)) {
    warnings.push(toHealthWarning('venue_missing_in_render', 'venue missing from rendered output'));
  }

  const deduped = uniqueHealthWarnings(warnings);
  return {
    warningCodes: deduped.map((warning) => warning.code),
    warnings: deduped,
    structurallyIncomplete: lostFields.length > 0 || !rendered.trim(),
    penaltyPoints: calculateRenderOmissionPenalty(lostFields, eligibleFields),
  };
}

export function applyRenderHealthDemotions(
  carrier: ReferenceCarrier,
  warnings: HealthWarning[],
): void {
  if (warnings.length === 0) return;

  const nextWarnings = uniqueHealthWarnings([...carrier.health.warnings, ...warnings]);
  const nextReasons = [...carrier.health.reasons];
  let nextStatus = carrier.publicStatus;

  for (const warning of warnings) {
    if (warning.severity === 'action') {
      nextStatus = 'needs_action';
    } else if (warning.severity === 'review' && nextStatus === 'ready') {
      nextStatus = 'needs_review';
    }
    nextReasons.push(reasonForRenderWarning(warning));
  }

  carrier.publicStatus = nextStatus;
  carrier.health.publicStatus = nextStatus;
  carrier.health.warnings = nextWarnings;
  carrier.health.reasons = [...new Set(nextReasons)];
  if (warnings.some((warning) => warning.severity !== 'info')) {
    carrier.health.demotedBy = 'render';
  }
}

function assertAuthorFormat(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  rendered: string,
): boolean {
  const authors = carrier.fields.authors.value;
  if (authors.length === 0) return rendered.includes('Unknown author');
  return normalizeComparableText(rendered.slice(0, 120)).startsWith(normalizeComparableText(formatAuthors(authors, style)));
}

function assertYearPresent(carrier: ReferenceCarrier, rendered: string): boolean {
  const year = carrier.fields.year.value;
  if (year == null) return rendered.includes('n.d.');
  return rendered.includes(String(year));
}

function assertDoiFormat(carrier: ReferenceCarrier, rendered: string): boolean {
  const doi = carrier.fields.doi.value;
  if (!doi || carrier.doiVerification.status !== 'verified') return true;
  return renderedContainsDoi(rendered, doi);
}

function assertVenuePresent(carrier: ReferenceCarrier, rendered: string): boolean {
  if (carrier.type.isUnknown || carrier.type.type !== 'article-journal') return true;
  const journal = carrier.fields.journal.value;
  if (!journal) return false;
  return renderedContainsComparableText(rendered, journal);
}

function buildRenderPlan(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  renderOutput: RenderOutput,
): RenderPlan {
  const segments: PlannedRenderSegment[] = [];
  const eligibleFieldMap = new Map(renderOutput.eligibleFields.map((field) => [field.key, field] as const));

  pushPlannedRenderSegment(
    segments,
    'authors',
    formatAuthors(carrier.fields.authors.value, style),
    ownedFieldKeys(eligibleFieldMap, 'authors'),
  );
  if (carrier.fields.year.value != null) {
    pushPlannedRenderSegment(
      segments,
      'year',
      formatYear(carrier.fields.year.value, 'n.d.'),
      ownedFieldKeys(eligibleFieldMap, 'year'),
    );
  }
  pushPlannedRenderSegment(
    segments,
    'title',
    formatTitleForRender(carrier.fields.title.value, style, 'Untitled reference'),
    ownedFieldKeys(eligibleFieldMap, 'title'),
  );
  pushPlannedRenderSegment(
    segments,
    'container',
    firstContainerToken(carrier),
    ownedFieldKeys(eligibleFieldMap, 'journal', 'conferenceTitle', 'bookTitle', 'siteName', 'repository'),
  );
  pushPlannedRenderSegment(
    segments,
    'publisher_or_institution',
    cleanText(carrier.fields.publisher.value || carrier.fields.institution.value, '') ?? '',
    ownedFieldKeys(eligibleFieldMap, 'publisher', 'institution', 'placeOfPublication'),
  );
  pushPlannedRenderSegment(segments, 'volume', cleanText(carrier.fields.volume.value, '') ?? '', ownedFieldKeys(eligibleFieldMap, 'volume'));
  pushPlannedRenderSegment(segments, 'issue', cleanText(carrier.fields.issue.value, '') ?? '', ownedFieldKeys(eligibleFieldMap, 'issue'));
  pushPlannedRenderSegment(segments, 'pages', cleanText(carrier.fields.pages.value, '') ?? '', ownedFieldKeys(eligibleFieldMap, 'pages'));
  pushPlannedRenderSegment(
    segments,
    'articleNumber',
    cleanText(carrier.fields.articleNumber.value, '') ?? '',
    ownedFieldKeys(eligibleFieldMap, 'articleNumber'),
  );
  pushPlannedRenderSegment(
    segments,
    'reportNumber',
    cleanText(carrier.fields.reportNumber.value, '') ?? '',
    ownedFieldKeys(eligibleFieldMap, 'reportNumber'),
  );
  pushPlannedRenderSegment(segments, 'doi', cleanText(carrier.fields.doi.value, '') ?? '', ownedFieldKeys(eligibleFieldMap, 'doi'));
  pushPlannedRenderSegment(segments, 'url', cleanText(carrier.fields.url.value, '') ?? '', ownedFieldKeys(eligibleFieldMap, 'url'));

  return {
    segments,
    actualSegments: renderOutput.segments,
    text: renderOutput.text,
    style,
  };
}

function pushPlannedRenderSegment(
  segments: PlannedRenderSegment[],
  kind: RenderSegmentKind,
  text: string | undefined,
  fieldKeys: RenderFieldKey[],
): void {
  const cleaned = cleanText(text ?? null);
  if (!cleaned || fieldKeys.length === 0) return;
  segments.push({
    kind,
    text: cleaned,
    fieldKeys,
  });
}

function computeSemanticSegmentSubscores(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  rendered: string,
  plan: RenderPlan,
  path: 'guaranteed' | 'fallback',
): {
  authorScore: number;
  titleScore: number;
  yearScore: number;
  containerScore: number;
  volumeScore: number;
  issueScore: number;
  locatorScore: number;
  identifierScore: number;
} {
  return {
    authorScore: scoreAuthorFormat(carrier, style, rendered, path),
    titleScore: scoreTitleSegment(plan, rendered),
    yearScore: scoreYearSegment(plan, rendered),
    containerScore: scoreContainerSegment(carrier, style, rendered, path),
    volumeScore: scoreRenderPlanToken(plan, 'volume', rendered),
    issueScore: scoreRenderPlanToken(plan, 'issue', rendered),
    locatorScore: scoreLocatorSegment(carrier, rendered, plan),
    identifierScore: scoreIdentifierSegment(carrier, rendered, plan),
  };
}

function computeContentCorrectnessScore(
  plan: RenderPlan,
  semanticSegmentSubscores: {
    authorScore: number;
    titleScore: number;
    yearScore: number;
    containerScore: number;
    volumeScore: number;
    issueScore: number;
    locatorScore: number;
    identifierScore: number;
  },
): number {
  const weights: Array<{ key: keyof typeof semanticSegmentSubscores; weight: number; applicable: boolean }> = [
    { key: 'titleScore', weight: 0.28, applicable: hasRenderSegment(plan, 'title') },
    { key: 'authorScore', weight: 0.22, applicable: hasRenderSegment(plan, 'authors') },
    { key: 'yearScore', weight: 0.12, applicable: hasRenderSegment(plan, 'year') },
    { key: 'containerScore', weight: 0.14, applicable: hasRenderSegment(plan, 'container') },
    { key: 'volumeScore', weight: 0.08, applicable: hasRenderSegment(plan, 'volume') },
    { key: 'issueScore', weight: 0.06, applicable: hasRenderSegment(plan, 'issue') },
    {
      key: 'locatorScore',
      weight: 0.06,
      applicable: hasRenderSegment(plan, 'pages')
        || hasRenderSegment(plan, 'articleNumber')
        || hasRenderSegment(plan, 'reportNumber'),
    },
    {
      key: 'identifierScore',
      weight: 0.04,
      applicable: hasRenderSegment(plan, 'doi') || hasRenderSegment(plan, 'url'),
    },
  ];

  const active = weights.filter((entry) => entry.applicable);
  if (active.length === 0) return 1;

  const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0);
  return active.reduce((sum, entry) => {
    return sum + (semanticSegmentSubscores[entry.key] * (entry.weight / totalWeight));
  }, 0);
}

function computeCosmeticSubscores(
  style: CitationStyle,
  rendered: string,
  plan: RenderPlan,
): {
  titleCaseScore: number;
  spacingScore: number;
  noDuplicatePunctScore: number;
  punctuationScore: number;
} {
  const titleSegment = extractRenderedTitleText(plan.actualSegments);

  return {
    titleCaseScore: scoreTitleCase(titleSegment, style),
    spacingScore: scoreSpacing(rendered),
    noDuplicatePunctScore: scoreNoDuplicatePunctuation(rendered),
    punctuationScore: scorePunctuation(style, rendered),
  };
}

function computeFormatSubscores(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  rendered: string,
  plan: RenderPlan,
  path: 'guaranteed' | 'fallback',
  semanticSegmentSubscores: {
    authorScore: number;
    titleScore: number;
    yearScore: number;
    containerScore: number;
    volumeScore: number;
    issueScore: number;
    locatorScore: number;
    identifierScore: number;
  },
  cosmeticSubscores: {
    titleCaseScore: number;
    spacingScore: number;
    noDuplicatePunctScore: number;
    punctuationScore: number;
  },
): {
  authorFormatScore: number;
  titleCaseScore: number;
  punctuationScore: number;
  fieldOrderScore: number;
  spacingScore: number;
  noDuplicatePunctScore: number;
  containerFormatScore: number;
} {
  return {
    authorFormatScore: semanticSegmentSubscores.authorScore,
    titleCaseScore: cosmeticSubscores.titleCaseScore,
    punctuationScore: cosmeticSubscores.punctuationScore,
    fieldOrderScore: scoreFieldOrder(carrier, style, rendered, path),
    spacingScore: cosmeticSubscores.spacingScore,
    noDuplicatePunctScore: cosmeticSubscores.noDuplicatePunctScore,
    containerFormatScore: semanticSegmentSubscores.containerScore,
  };
}

function renderContainsFieldToken(
  field: keyof ReferenceCarrier['fields'],
  value: unknown,
  rendered: string,
): boolean {
  switch (field) {
    case 'doi':
      return renderedContainsDoi(rendered, value);
    case 'url':
      return renderedContainsUrl(rendered, value);
    case 'pages':
      return renderedContainsLocator(rendered, value);
    case 'articleNumber':
      return renderedContainsArticleNumber(rendered, value);
    case 'reportNumber':
      return renderedContainsReportNumber(rendered, value);
    case 'year':
      return typeof value === 'number' && new RegExp(`\\b${value}\\b`).test(rendered);
    case 'authors':
    case 'editors':
      return Array.isArray(value) && value.length > 0
        ? renderedContainsAuthor(rendered, value as CanonicalAuthor[])
        : true;
    default:
      return renderedContainsComparableText(rendered, value);
  }
}

function renderedContainsDoi(rendered: string, value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const canonical = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  if (!isValidDoi(canonical)) return false;
  return /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i.test(rendered)
    && rendered.toLowerCase().includes(canonical.toLowerCase());
}

function renderedContainsUrl(rendered: string, value: unknown): boolean {
  if (typeof value !== 'string') return true;
  if (!isValidUrl(value)) return false;

  try {
    const parsed = new URL(value);
    return rendered.toLowerCase().includes(parsed.host.toLowerCase())
      && rendered.toLowerCase().includes(parsed.pathname.toLowerCase());
  } catch {
    return false;
  }
}

function renderedContainsLocator(rendered: string, value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const normalized = normalizeLocator(value);
  if (!normalized || !isValidLocatorPages(normalized)) return false;
  return normalizeLocator(rendered).includes(normalized);
}

function renderedContainsArticleNumber(rendered: string, value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const normalized = normalizeLocator(value);
  if (!normalized || !isValidArticleNumber(normalized)) return false;
  return normalizeComparableText(rendered).includes(normalizeComparableText(normalized));
}

function renderedContainsReportNumber(rendered: string, value: unknown): boolean {
  if (typeof value !== 'string') return true;
  return isValidReportNumber(value)
    && normalizeComparableText(rendered).includes(normalizeComparableText(value));
}

function renderedContainsAuthor(rendered: string, authors: CanonicalAuthor[]): boolean {
  const first = authors[0];
  if (!first) return true;
  const token = first.literal?.trim() || first.family.trim();
  return token.length > 0 && normalizeComparableText(rendered).includes(normalizeComparableText(token));
}

function renderedContainsComparableText(rendered: string, value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const normalizedValue = normalizeComparableText(value);
  if (!normalizedValue) return true;
  return normalizeComparableText(rendered).includes(normalizedValue);
}

function scoreAuthorFormat(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  rendered: string,
  path: 'guaranteed' | 'fallback',
): number {
  const authors = carrier.fields.authors.value;
  if (authors.length === 0) return 1;

  if (path === 'guaranteed') {
    const expectedPrefix = normalizeComparableText(formatAuthors(authors, style));
    const actualPrefix = normalizeComparableText(rendered.slice(0, 120));
    return actualPrefix.startsWith(expectedPrefix) ? 1 : 0;
  }

  const first = authors[0]!;
  const family = normalizeComparableText(first.literal || first.family);
  if (!family || !normalizeComparableText(rendered.slice(0, 120)).includes(family)) return 0;
  if (authors.length > 1 && !/[,&;]|\band\b/i.test(rendered.slice(0, 120))) return 0;
  if (/[A-Z]\s+[a-z]/.test(rendered.slice(0, 80))) return 0.5;
  return 1;
}

function scoreTitleSegment(plan: RenderPlan, rendered: string): number {
  const title = getRenderSegment(plan, 'title')?.text;
  if (!title) return 1;
  return renderedContainsComparableText(rendered, title) ? 1 : 0;
}

function scoreYearSegment(plan: RenderPlan, rendered: string): number {
  const year = getRenderSegment(plan, 'year')?.text;
  if (!year) return 1;
  return rendered.includes(year) ? 1 : 0;
}

function scoreContainerSegment(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  rendered: string,
  path: 'guaranteed' | 'fallback',
): number {
  return scoreContainerFormat(carrier, style, rendered, path);
}

function scoreRenderPlanToken(
  plan: RenderPlan,
  kind: RenderSegmentKind,
  rendered: string,
): number {
  const segment = getRenderSegment(plan, kind);
  if (!segment) return 1;
  return renderedContainsComparableText(rendered, segment.text) ? 1 : 0;
}

function scoreLocatorSegment(
  carrier: ReferenceCarrier,
  rendered: string,
  plan: RenderPlan,
): number {
  const checks: number[] = [];

  for (const field of ['pages', 'articleNumber', 'reportNumber'] as const) {
    const segment = getSegmentForField(plan, field);
    if (!segment) continue;
    checks.push(renderContainsFieldToken(field, carrier.fields[field].value, rendered) ? 1 : 0);
  }

  if (checks.length === 0) return 1;
  return average(checks);
}

function scoreIdentifierSegment(
  carrier: ReferenceCarrier,
  rendered: string,
  plan: RenderPlan,
): number {
  const checks: number[] = [];

  if (getSegmentForField(plan, 'doi') && carrier.fields.doi.value) {
    checks.push(renderedContainsDoi(rendered, carrier.fields.doi.value) ? 1 : 0);
  }
  if (getSegmentForField(plan, 'url') && carrier.fields.url.value) {
    checks.push(renderedContainsUrl(rendered, carrier.fields.url.value) ? 1 : 0);
  }

  if (checks.length === 0) return 1;
  return average(checks);
}

function scoreTitleCase(title: string, style: CitationStyle): number {
  const normalizedTitle = cleanText(title, '') ?? '';
  if (!normalizedTitle) return 1;
  if (hasObviousTitleCorruption(normalizedTitle)) return 0;

  const expected = formatTitleForRender(normalizedTitle, style, normalizedTitle) ?? normalizedTitle;
  if (expected === normalizedTitle) return 1;

  if (normalizeComparableText(expected) === normalizeComparableText(normalizedTitle)) {
    return 1;
  }

  const similarity = tokenSimilarity(expected, normalizedTitle);
  if (similarity >= 0.95) return 1;
  if (similarity >= 0.8) return 0.5;
  return 0;
}

function scorePunctuation(style: CitationStyle, rendered: string): number {
  if (!rendered.trim()) return 0;
  const malformedCount = countMalformedPunctuation(buildCitationAnalysisStream(rendered));
  if (malformedCount > 1) return 0;
  if ((style === 'apa7' || style === 'harvard-ctr' || style === 'chicago-author-date') && !/\((?:\d{4}|n\.d\.)\)/i.test(rendered)) {
    return 0.5;
  }
  if (malformedCount === 1) return 0.5;
  return /[.,;:]/.test(rendered) ? 1 : 0.5;
}

function scoreFieldOrder(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  rendered: string,
  path: 'guaranteed' | 'fallback',
): number {
  const authorToken = firstAuthorToken(carrier.fields.authors.value);
  const titleToken = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : '';
  const yearToken = carrier.fields.year.value != null ? String(carrier.fields.year.value) : '';
  const containerToken = firstContainerToken(carrier);

  const expected = (
    style === 'vancouver' || style === 'ieee'
      ? [authorToken, titleToken, containerToken, yearToken]
      : [authorToken, yearToken, titleToken, containerToken]
  ).filter(Boolean);
  const indexes = expected.map((token) => normalizedIndexOf(rendered, token));

  if (indexes.some((index) => index < 0)) return path === 'fallback' ? 0.5 : 0;
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index]! < indexes[index - 1]!) return 0;
  }
  return 1;
}

export function scoreSpacing(rendered: string): number {
  const analysis = buildCitationAnalysisStream(rendered);
  const leadingTrailingViolations = (/^\s/.test(rendered) ? 1 : 0) + (/\s$/.test(rendered) ? 1 : 0);
  const doubleSpaceViolations = countMatches(analysis, / {2,}/g);
  const spaceBeforePunctuationViolations = countMatches(analysis, /\s+[.,;:]/g);
  const missingRequiredSpaceViolations = countMatches(analysis, /[.,;:](?=[A-Za-z0-9])/g);

  return average([
    ruleScoreFromCount(leadingTrailingViolations),
    ruleScoreFromCount(doubleSpaceViolations),
    ruleScoreFromCount(spaceBeforePunctuationViolations),
    ruleScoreFromCount(missingRequiredSpaceViolations),
  ]);
}

export function scoreNoDuplicatePunctuation(rendered: string): number {
  const malformedCount = countMalformedPunctuation(buildCitationAnalysisStream(rendered));
  return ruleScoreFromCount(malformedCount);
}

function scoreContainerFormat(
  carrier: ReferenceCarrier,
  style: CitationStyle,
  rendered: string,
  path: 'guaranteed' | 'fallback',
): number {
  const container = firstContainerToken(carrier);
  if (!container) return 1;

  if (path === 'fallback') {
    return renderedContainsComparableText(rendered, container) && /[,:;]/.test(rendered) ? 1 : 0.5;
  }

  if (!renderedContainsComparableText(rendered, container)) return 0;
  if (style === 'apa7' || style === 'mla9' || style === 'chicago-author-date' || style === 'harvard-ctr' || style === 'ieee') {
    return containsItalicizedText(rendered, container) || rendered.includes(container) ? 1 : 0.5;
  }
  return 1;
}

function getRenderSegment(plan: RenderPlan, kind: RenderSegmentKind): PlannedRenderSegment | undefined {
  return plan.segments.find((segment) => segment.kind === kind);
}

function hasRenderSegment(plan: RenderPlan, kind: RenderSegmentKind): boolean {
  return getRenderSegment(plan, kind) != null;
}

function getSegmentForField(plan: RenderPlan, field: RenderFieldKey): PlannedRenderSegment | undefined {
  return plan.segments.find((segment) => segment.fieldKeys.includes(field));
}

function getActualRenderedSegment(plan: RenderPlan, field: RenderFieldKey): RenderSegment | undefined {
  return plan.actualSegments.find((segment) => segment.fieldKeys.includes(field));
}

export function extractRenderedTitleText(
  segments: Array<{ text: string; fieldKeys: RenderFieldKey[] }>,
): string {
  return segments.find((segment) => segment.fieldKeys.includes('title'))?.text ?? '';
}

function calculateRenderOmissionPenalty(
  lostFields: RenderFieldKey[],
  eligibleFields: RenderEligibleField[],
): number {
  const requirementMap = new Map(eligibleFields.map((field) => [field.key, field.requiredness] as const));
  return lostFields.reduce((sum, field) => {
    const basePenalty = requirementMap.get(field) === 'mandatory' ? 3 : 2;
    const locatorBonus = isLocatorField(field) ? 2 : 0;
    const identifierBonus = field === 'doi' || field === 'url' ? 1 : 0;
    return sum + basePenalty + locatorBonus + identifierBonus;
  }, 0);
}

function buildCitationAnalysisStream(rendered: string): string {
  return rendered
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/https?:\/\/(?:dx\.)?doi\.org\/[^\s)]+/gi, 'URLTOKEN')
    .replace(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi, 'DOITOKEN')
    .replace(/https?:\/\/[^\s)]+/gi, 'URLTOKEN')
    .replace(/\b(?:[A-Z]\.\s*){1,4}(?=(?:[A-Z][a-z]|[A-Z]|$))/g, 'INITIALS')
    .replace(/\b(?:n\.d\.|pp?\.|vol\.|no\.)/gi, 'ABBR')
    .replace(/\b\d+\(\d+\):\d+(?:[-–]\d+)?\b/g, 'LOCATOR')
    .replace(/\s+/g, ' ')
    .trim();
}

function ruleScoreFromCount(count: number): number {
  if (count <= 0) return 1;
  if (count === 1) return 0.5;
  return 0;
}

function countMalformedPunctuation(analysis: string): number {
  return [
    countMatches(analysis, /,,/g),
    countMatches(analysis, /;;/g),
    countMatches(analysis, /::/g),
    countMatches(analysis, /\.\.(?!\.)/g),
    countMatches(analysis, /,\./g),
    countMatches(analysis, /\.;/g),
    countMatches(analysis, /:,/g),
    countMatches(analysis, /:\./g),
  ].reduce((sum, value) => sum + value, 0);
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function reasonForRenderWarning(warning: HealthWarning): string {
  switch (warning.code) {
    case 'render_output_empty_or_invalid':
      return 'render output is empty or invalid';
    case 'render_output_structurally_incomplete':
      return warning.message ?? 'render output is structurally incomplete';
    case 'render_eligible_field_omitted':
      return warning.message ?? 'eligible field omitted from rendered output';
    case 'render_style_fallback':
      return warning.message ?? 'render output used a fallback style formatter';
    case 'locator_lost_during_render':
      return 'locator lost during render';
    case 'doi_lost_during_render':
      return 'DOI lost during render';
    case 'venue_missing_in_render':
      return 'venue missing from rendered output';
    default:
      return warning.message ?? `render warning: ${warning.code}`;
  }
}

function firstAuthorToken(authors: CanonicalAuthor[]): string {
  const first = authors[0];
  if (!first) return '';
  return first.literal?.trim() || first.family.trim();
}

function firstContainerToken(carrier: ReferenceCarrier): string {
  return cleanText(
    carrier.fields.journal.value
      || carrier.fields.conferenceTitle.value
      || carrier.fields.bookTitle.value
      || carrier.fields.repository.value
      || carrier.fields.siteName.value,
    '',
  ) ?? '';
}

function containsItalicizedText(rendered: string, value: string): boolean {
  return rendered.includes(italicize(value)) || rendered.includes(`_${value}_`);
}

function normalizedIndexOf(rendered: string, token: string): number {
  const normalizedToken = normalizeComparableText(token);
  if (!normalizedToken) return -1;
  return normalizeComparableText(rendered).indexOf(normalizedToken);
}

function hasObviousTitleCorruption(title: string): boolean {
  const words = title.split(/\s+/).filter(Boolean);
  return words.some((word) => {
    const compact = word.replace(/[^A-Za-z]/g, '');
    return compact.length > 3
      && compact === compact.toUpperCase()
      && !TITLE_CASE_ALL_CAPS_ALLOWLIST.has(compact);
  });
}

function normalizeComparableText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = normalizeComparableText(left).split(' ').filter(Boolean);
  const rightTokens = normalizeComparableText(right).split(' ').filter(Boolean);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const overlap = [...leftSet].filter((token) => rightSet.has(token)).length;
  const precision = overlap / leftSet.size;
  const recall = overlap / rightSet.size;

  if (precision === 0 || recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function normalizeLocator(value: string): string {
  return value.replace(/[–—]/g, '-').replace(/\s+/g, '').toLowerCase();
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/* ═══════════════════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════════════════ */

function renderLink(carrier: ReferenceCarrier): string {
  const doi = cleanText(carrier.fields.doi.value);
  if (doi && carrier.doiVerification.status === 'verified') {
    return `https://doi.org/${doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}`;
  }

  const url = cleanText(carrier.fields.url.value);
  if (!url) return '';

  if (isDoiUrl(url) && (!doi || carrier.doiVerification.status !== 'unverified')) {
    return '';
  }

  if (doi && carrier.doiVerification.status !== 'unverified' && /(?:dx\.)?doi\.org\//i.test(url)) {
    return '';
  }

  return url;
}

function formatYear(value: number | null, fallback: string): string {
  return value != null ? String(value) : fallback;
}

function cleanText(value: string | null, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || fallback;
}

// Page ranges are stored on the field as canonical DATA (ASCII hyphen, full
// numbers). For DISPLAY we use an en-dash — the typographic convention for
// inclusive ranges in APA/MLA/Chicago/IEEE/Harvard. (Vancouver's hyphen +
// abbreviated end page is a separate, future per-style refinement; until then it
// keeps the en-dash it has always rendered, so this is behavior-preserving.)
function formatPageRange(value: string | null): string | undefined {
  const cleaned = cleanText(value);
  return cleaned === undefined ? undefined : cleaned.replace(/-/g, '–');
}

const TITLE_CASE_SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'nor',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'via',
  'vs',
]);

export function formatTitleForRender(
  value: string | null,
  style: CitationStyle,
  fallback?: string,
): string | undefined {
  const normalized = cleanText(value, fallback);
  if (!normalized) return normalized;

  switch (style) {
    case 'apa7':
    case 'harvard-ctr':
    case 'vancouver':
    case 'ieee':
    case 'ama':
      return applySentenceCaseTitle(normalized);
    case 'mla9':
    case 'chicago-author-date':
    case 'chicago-notes-bib':
    case 'acs':
      return applyTitleCaseTitle(normalized);
    default:
      return normalized;
  }
}

function applySentenceCaseTitle(value: string): string {
  let shouldCapitalize = true;
  const shouting = isShoutingTitle(value);

  return value.replace(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu, (word) => {
    if (shouldPreserveTitleToken(word, shouting)) {
      shouldCapitalize = false;
      return word;
    }

    const lower = word.toLocaleLowerCase();
    const nextWord = shouldCapitalize ? capitalizeWord(lower) : lower;
    shouldCapitalize = false;
    return nextWord;
  }).replace(/([:–—]\s*)(\p{L})/gu, (_, prefix: string, char: string) => {
    shouldCapitalize = false;
    return `${prefix}${char.toLocaleUpperCase()}`;
  });
}

function applyTitleCaseTitle(value: string): string {
  let wordIndex = 0;
  let capitalizeNext = true;
  const shouting = isShoutingTitle(value);

  return value.replace(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu, (word) => {
    const currentIndex = wordIndex;
    wordIndex += 1;

    if (shouldPreserveTitleToken(word, shouting)) {
      capitalizeNext = false;
      return word;
    }

    const lower = word.toLocaleLowerCase();
    const isSmallWord = TITLE_CASE_SMALL_WORDS.has(lower);
    const shouldCapitalizeWord = capitalizeNext || currentIndex === 0 || !isSmallWord;
    capitalizeNext = false;
    return shouldCapitalizeWord ? capitalizeWord(lower) : lower;
  }).replace(/([:–—]\s*)(\p{L})/gu, (_, prefix: string, char: string) => {
    capitalizeNext = false;
    return `${prefix}${char.toLocaleUpperCase()}`;
  });
}

/**
 * A "shouting" title is written entirely in capitals (e.g. a journal that prints
 * "PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT"). In that case the
 * all-caps-acronym heuristic in {@link shouldPreserveTitleToken} misfires on the
 * short words (WITH, THE, FOR, …), leaving them shouting while the long words get
 * cased — producing "Protein measurement WITH THE folin phenol reagent". When the
 * whole title is uppercase we cannot tell acronyms from prose, so we re-case every
 * word (the curated all-caps allowlist still protects DNA/RNA/PCR-style tokens).
 */
function isShoutingTitle(value: string): boolean {
  if (/\p{Ll}/u.test(value)) return false;
  const words = value.match(/\b[\p{L}][\p{L}'’-]*\b/gu) ?? [];
  if (words.length < 4) return false;
  return words.some((word) => word.replace(/[^\p{L}]/gu, '').length >= 5);
}

function shouldPreserveTitleToken(word: string, shouting = false): boolean {
  const compact = word.replace(/[^A-Za-z0-9]/g, '');
  if (!compact) return true;
  if (TITLE_CASE_ALL_CAPS_ALLOWLIST.has(compact.toUpperCase())) return true;
  if (/\d/.test(compact)) return true;
  if (/[a-z][A-Z]/.test(word) || /[A-Z][a-z]+[A-Z]/.test(word)) return true;
  // Short all-caps tokens read as acronyms (DNA, PCR) only inside a normally-cased
  // title. In a fully-shouting title every word is caps, so this rule would wrongly
  // freeze the small words — skip it and let them be cased like the rest.
  if (!shouting && compact === compact.toUpperCase() && compact.length <= 4) return true;
  return false;
}

function capitalizeWord(word: string): string {
  return word.length > 0 ? word.charAt(0).toLocaleUpperCase() + word.slice(1) : word;
}

function toInitials(value: string): string {
  return value
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function toApaInitials(value: string): string {
  return value
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + '.')
    .join(' ');
}

function finalizeCitation(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([.?!])\s*(https?:\/\/)/g, '$1 $2')
    .replace(/\.{2,}/g, '.')
    .replace(/,\./g, '.')
    .replace(/,\s*,/g, ',')
    .trim();
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
