import type {
  AuthorityData,
  AuthorityStatus,
  CanonicalCitation,
  ConvertedReference,
  InsertReference,
  ReferenceType,
  V2ConversionResponse,
} from '@shared/schema';
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
    case 'missing_doi':
      return 'DOI missing';
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
  const reasons = citation.validationIssues.map((issue) => issue.message);
  const validationCodes = new Set(citation.validationIssues.map((issue) => issue.code));
  const qualityFlags = new Set(citation.quality?.flags ?? []);
  const missingRequired = citation.quality?.missingRequired ?? [];
  const score = citation.quality?.overall ?? 0;
  const grade = citation.quality?.grade ?? 'F';
  const hasReviewLevelValidation = [
    'placeholder_volume',
    'placeholder_journal',
    'venue_missing_for_conference',
    'weak_proceedings_venue',
    'initials_as_surname',
    'title_short_or_missing',
    'doi_invalid_shape',
    'pages_invalid_shape',
    'locator_missing_from_source',
  ].some((code) => validationCodes.has(code));

  for (const flag of qualityFlags) {
    const message = friendlyQualityFlag(flag);
    if (message && !reasons.includes(message)) reasons.push(message);
  }

  if (qualityFlags.has('retracted')) {
    return { state: 'action_needed', reasons };
  }

  if (
    missingRequired.length > 0
    || score < 0.2
    || validationCodes.has('connector_as_author')
    || qualityFlags.has('malformed_authors')
    || qualityFlags.has('author_parse_failed')
  ) {
    return { state: 'action_needed', reasons };
  }

  if (
    score < 0.5
    || (grade === 'C' && score < 0.6)
    || grade === 'F'
    || hasReviewLevelValidation
    || qualityFlags.has('placeholder_fields')
    || qualityFlags.has('review')
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
