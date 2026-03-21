import type {
  AuthorityData,
  AuthorityStatus,
  CanonicalCitation,
  ConvertedReference,
  InsertReference,
  ReferenceType,
  V2ConversionResponse,
} from '@shared/schema';
import {
  getProtectedContainerCorruptionReasons,
  getProtectedTitleCorruptionReasons,
  hasInventedPlaceholderVenue,
  hasMalformedAuthorShape,
} from '@shared/referenceHealthHeuristics';
import { canonicalToParsedReference, canonicalReferenceTypeToParsed } from './utils.js';
import { computeWorkKey } from '../../utils/workKey.js';
import { hasAuthorInitialsOnly } from '../../utils/authorResolution.js';

function friendlyQualityFlag(flag: string): string | null {
  switch (flag) {
    case 'malformed_authors':
    case 'author_parse_failed':
      return 'Author parsing looks malformed';
    case 'placeholder_fields':
      return 'Placeholder or suspicious venue fields present';
    case 'unverified':
      return 'Authority verification found mismatched fields';
    case 'retracted':
      return 'Citation is flagged as retracted';
    case 'review':
      return 'Validation or rendering warnings are present';
    default:
      return null;
  }
}

function mapLegacyHealth(citation: CanonicalCitation): {
  state: 'clean' | 'review' | 'action_needed';
  reasons: string[];
} {
  const reasons = citation.validationIssues
    .filter((issue) => issue.severity !== 'info')
    .map((issue) => issue.message);
  const validationCodes = new Set(citation.validationIssues.map((issue) => issue.code));
  const qualityFlags = new Set(citation.quality?.flags ?? []);
  const missingRequired = citation.quality?.missingRequired ?? [];
  const score = citation.quality?.overall ?? 0;
  const parsed = canonicalToParsedReference(citation);
  const actionReasons = [
    ...(validationCodes.has('connector_as_author') ? ['A conjunction token was parsed as an author'] : []),
    ...(validationCodes.has('author_structure_unstable') ? ['Author structure still looks unstable'] : []),
    ...(validationCodes.has('initials_as_surname') ? ['An author surname field contains initials only'] : []),
    ...(validationCodes.has('locator_missing_from_source') ? ['A locator present in the source was not preserved'] : []),
    ...(qualityFlags.has('malformed_authors') ? ['Author parsing looks malformed'] : []),
    ...(qualityFlags.has('author_parse_failed') ? ['Author parsing looks malformed'] : []),
    ...(hasMalformedAuthorShape(parsed.authors) ? ['Author parsing looks malformed'] : []),
    ...(hasInventedPlaceholderVenue(parsed, citation.raw) ? ['Placeholder venue text appears to have been invented by the parser'] : []),
    ...getProtectedTitleCorruptionReasons(citation.raw, parsed.title),
    ...getProtectedContainerCorruptionReasons(citation.raw, parsed),
  ];

  for (const flag of qualityFlags) {
    const message = friendlyQualityFlag(flag);
    if (message && !reasons.includes(message)) reasons.push(message);
  }

  if (actionReasons.length > 0) {
    return { state: 'action_needed', reasons: [...new Set([...actionReasons, ...reasons])] };
  }

  if (
    missingRequired.length > 0
    || score < 0.75
    || qualityFlags.has('placeholder_fields')
    || qualityFlags.has('review')
    || qualityFlags.has('retracted')
    || citation.validationIssues.some((issue) => issue.severity !== 'info')
  ) {
    return { state: 'review', reasons };
  }

  return { state: 'clean', reasons };
}

function mapAuthorityStatus(citation: CanonicalCitation): AuthorityStatus {
  const status = citation.enrichment?.status;
  if (!status) return 'none';
  if (status === 'skipped') return 'skipped';
  if (status === 'fetched') return 'fetched';
  if (status === 'no_match') return 'no_match';
  return 'error';
}

function toLegacyAuthorityData(citation: CanonicalCitation): AuthorityData | undefined {
  if (citation.enrichment?.status !== 'fetched') return undefined;
  return {
    title: citation.enrichment.matchedTitle ?? citation.title.value ?? '',
    authors: citation.enrichment.matchedAuthors ?? citation.authors.value.map((author) => author.literal || `${author.last}${author.first ? `, ${author.first}` : ''}`),
    journal: citation.journal.value ?? '',
    url: citation.enrichment.url,
  };
}

function mapWarnings(citation: CanonicalCitation): string[] {
  const validationWarnings = citation.validationIssues.map((issue) => `${issue.severity}:${issue.code}`);
  const renderWarnings = citation.rendered?.warnings ?? [];
  return [...validationWarnings, ...renderWarnings];
}

function buildReportEngineSnapshot(citation: CanonicalCitation, response: V2ConversionResponse): ConvertedReference['reportEngineSnapshot'] {
  const splitContaminationFlags = response.debug?.enabled
    ? (citation.stageDebug?.split?.contaminationFlags as string[] | undefined) ?? []
    : citation.validationIssues
        .map((issue) => issue.code)
        .filter((code) => (
          code.startsWith('header_bleed_')
          || code.startsWith('doi_orphan_')
          || code.startsWith('multiline_truncation_')
          || code.startsWith('page_artifact_')
          || code.startsWith('oversized_chunk_')
        ));

  return {
    engineVersion: 'v2',
    processingPath: {
      stagesRun: response.processingPath.stagesRun,
      fallbacksUsed: response.processingPath.fallbacksUsed,
      extractorPathsUsed: response.processingPath.extractorPathsUsed,
      partialResult: response.processingPath.partialResult,
      partialReasons: response.processingPath.partialReasons,
    },
    stageLogSummary: citation.stageLog.map((entry) => ({
      stageId: entry.stageId,
      status: entry.status,
      code: entry.code,
      message: entry.message,
    })),
    extractorPath: citation.extraction?.extractorPath,
    validationCodes: citation.validationIssues.map((issue) => issue.code),
    qualityFlags: citation.quality?.flags ?? [],
    splitContaminationFlags,
    inputProfile: response.inputProfile,
    truthProvenance: citation.truth?.truthApplied
      ? {
          truthApplied: true,
          truthId: citation.truth.truthId,
          truthMatchType: citation.truth.truthMatchType,
          appliedFields: citation.truth.appliedFields,
          usedValidatedOutput: citation.truth.usedValidatedOutput,
          staleTruth: citation.truth.staleTruth,
        }
      : { truthApplied: false },
  };
}

export interface LegacyCompatRecord {
  uiData: Omit<ConvertedReference, 'id'>;
  storageData: InsertReference;
}

export function mapV2ResponseToLegacyRecords(
  response: V2ConversionResponse,
  request: { inputStyle: string; outputStyle: string },
): Array<LegacyCompatRecord & { sourceId: string }> {
  return response.citations
    .filter((citation) => citation.status !== 'merged')
    .map((citation) => {
    const parsedData = canonicalToParsedReference(citation);
    const referenceType = canonicalReferenceTypeToParsed(citation.referenceType);
    const warnings = mapWarnings(citation);
    const authorityStatus = mapAuthorityStatus(citation);
    const authorityData = toLegacyAuthorityData(citation);
    const inputStyle = citation.detectedStyle.value ?? request.inputStyle;
    const health = mapLegacyHealth(citation);
    const confidenceScore = Math.round((citation.quality?.overall ?? 0) * 100);
    const debug = response.debug?.enabled
      ? {
          extractionPath: citation.extraction?.extractorPath ?? 'deterministic',
          splitMethod: citation.split?.method ?? 'structural',
          fallbacksUsed: [
            ...(citation.split?.fallbackUsed ? ['split:fallback'] : []),
            ...(citation.extraction?.fallbackUsed ? ['extract:fallback'] : []),
            ...(citation.extraction?.rejectedCandidates ?? []).filter((candidate) => candidate === 'llm_cap_reached'),
          ],
          splitConfidence: citation.split?.confidence ?? 1,
          detectedStyle: citation.detectedStyle.value ?? 'unknown',
        }
      : undefined;

    return {
      sourceId: citation.id,
      uiData: {
        originalText: citation.raw,
        convertedText: citation.rendered?.formatted ?? citation.raw,
        referenceType,
        parsedData,
        inputStyle,
        outputStyle: request.outputStyle,
        warnings,
        confidence: {
          score: confidenceScore,
          breakdown: {
            rules: confidenceScore,
          },
          isSuspicious: false,
        },
        authorityData,
        authorityStatus,
        styleDetectionFailed: request.inputStyle === 'auto' && !citation.detectedStyle.value,
        assertionSummary: citation.rendered?.assertionSummary,
        assertionHighlights: citation.rendered?.assertionHighlights,
        healthState: health.state,
        healthReasons: health.reasons,
        authorInitialsOnly: hasAuthorInitialsOnly(parsedData),
        truthProvenance: citation.truth?.truthApplied
          ? {
              truthApplied: true,
              truthId: citation.truth.truthId,
              truthMatchType: citation.truth.truthMatchType,
              appliedFields: citation.truth.appliedFields,
              usedValidatedOutput: citation.truth.usedValidatedOutput,
              staleTruth: citation.truth.staleTruth,
            }
          : { truthApplied: false },
        reportEngineSnapshot: buildReportEngineSnapshot(citation, response),
        debug,
      },
      storageData: {
        originalText: citation.raw,
        inputStyle,
        outputStyle: request.outputStyle,
        parsedData,
        convertedText: citation.rendered?.formatted ?? citation.raw,
        referenceType: referenceType as ReferenceType,
        confidenceScore,
        workKey: computeWorkKey(parsedData),
        authorityStatus,
      },
    };
    });
}
