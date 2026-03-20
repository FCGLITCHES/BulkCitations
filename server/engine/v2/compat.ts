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
    const confidenceScore = Math.round((citation.quality?.overall ?? 0) * 100);
    const authorityData = toLegacyAuthorityData(citation);
    const inputStyle = citation.detectedStyle.value ?? request.inputStyle;

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
