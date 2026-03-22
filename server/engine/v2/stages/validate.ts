import type { CanonicalCitation, ValidationIssue, ValidationMetadata } from '@shared/schema';
import {
  getProtectedContainerCorruptionReasons,
  getProtectedTitleCorruptionReasons,
} from '@shared/referenceHealthHeuristics';
import type { V2Stage } from '../contracts.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createStageDiagnostic,
  logStructuredDebug,
  normalizeDoiValue,
  normalizeWhitespace,
} from '../utils.js';
import {
  getMissingRequiredFields,
  hasCanonicalMalformedAuthors,
  isLocatorLike,
  isPlaceholderValue,
  looksWeakConferenceVenue,
  rawSuggestsDroppedLocator,
} from '../qualityRules.js';
import { OVERSIZED_CHUNK_CHARS, OVERSIZED_CHUNK_LINES } from './split.js';
import { isGroupAuthor, normalizeGroupAuthor } from '../../shared/citationSemantics.js';

const DOI_PATTERN = /^10\.\d{4,}\/\S+$/i;
const PAGE_PATTERN = /^[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?$/;
const CURRENT_YEAR = new Date().getFullYear();
const DOI_CLUSTER_PATTERN = /(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,}\/\S+/gi;
const YEAR_CLUSTER_PATTERN = /(?:\(|\[)(?:19|20)\d{2}[a-z]?(?:\)|\])/gi;
const EMBEDDED_REFERENCE_START_PATTERN = /[A-Z][\p{L}'’.-]+,\s+[A-Z][^()]{0,40}\(\d{4}[a-z]?\)/gu;

function normalized(value: string | null | undefined): string {
  return normalizeWhitespace((value ?? '').toLowerCase());
}

function hasEmbeddedReferenceStart(value: string | null | undefined): boolean {
  const raw = value ?? '';
  if (!raw) return false;

  for (const match of raw.matchAll(EMBEDDED_REFERENCE_START_PATTERN)) {
    if ((match.index ?? 0) > 0) {
      return true;
    }
  }

  return false;
}

function countDistinctDoiClusters(value: string): number {
  return new Set(
    [...value.matchAll(DOI_CLUSTER_PATTERN)]
      .map((match) => normalizeDoiValue(match[0] ?? ''))
      .filter(Boolean),
  ).size;
}

function countYearClusters(value: string): number {
  return [...value.matchAll(YEAR_CLUSTER_PATTERN)].length;
}

function buildPlausibilityIssues(citation: CanonicalCitation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const journalActsAsVenue = citation.referenceType === 'journal'
    || (!citation.conferenceTitle.value && !citation.bookTitle.value);
  const missingRequired = new Set(getMissingRequiredFields(citation));
  const authorsRequired = missingRequired.has('authors');

  const titleWordCount = citation.title.value ? citation.title.value.split(/\s+/).filter(Boolean).length : 0;
  if (!citation.title.value) {
    issues.push({
      field: 'title',
      severity: 'warning',
      code: 'title_short_or_missing',
      message: 'Title is missing.',
      extracted: citation.title.value,
    });
  } else if (titleWordCount < 2 && !/[A-Z0-9][.:]/.test(citation.title.value)) {
    issues.push({
      field: 'title',
      severity: 'info',
      code: 'title_short_or_missing',
      message: 'Title is unusually short and may need review.',
      extracted: citation.title.value,
    });
  }

  if (citation.year.value != null && (citation.year.value < 1000 || citation.year.value > CURRENT_YEAR)) {
    issues.push({
      field: 'year',
      severity: 'error',
      code: 'year_out_of_range',
      message: 'Year falls outside the accepted range.',
      extracted: citation.year.value,
      expected: `<= ${CURRENT_YEAR}`,
    });
  }

  if (citation.doi.value && !DOI_PATTERN.test(citation.doi.value)) {
    issues.push({
      field: 'doi',
      severity: 'warning',
      code: 'doi_invalid_shape',
      message: 'DOI does not match the expected DOI pattern.',
      extracted: citation.doi.value,
    });
  }

  if (citation.pages.value && !isLocatorLike(citation.pages.value) && !PAGE_PATTERN.test(citation.pages.value)) {
    issues.push({
      field: 'pages',
      severity: 'info',
      code: 'pages_invalid_shape',
      message: 'Pages do not look like a page range or article locator.',
      extracted: citation.pages.value,
    });
  }

  if (citation.authors.value.length === 0 && authorsRequired) {
    issues.push({
      field: 'authors',
      severity: 'error',
      code: 'authors_missing',
      message: 'No authors were extracted.',
    });
  } else if (citation.authors.value.length > 50) {
    issues.push({
      field: 'authors',
      severity: 'warning',
      code: 'authors_unusually_many',
      message: 'Author count exceeds the plausible range.',
      extracted: citation.authors.value.length,
      expected: '1-50',
    });
  }

  if (citation.authors.value.some((author) => /^[A-Z](?:\.\s*[A-Z])*\.?$/i.test(author.last))) {
    issues.push({
      field: 'authors',
      severity: 'warning',
      code: 'initials_as_surname',
      message: 'One or more authors appear to have initials stored as a surname.',
    });
  }

  if (citation.authors.value.some((author) => /^(and|&|et)$/i.test(author.last.trim()))) {
    issues.push({
      field: 'authors',
      severity: 'error',
      code: 'connector_as_author',
      message: 'A conjunction token was parsed as an author.',
    });
  }

  if (citation.authors.value.length > 0 && hasCanonicalMalformedAuthors(citation.authors.value)) {
    issues.push({
      field: 'authors',
      severity: 'error',
      code: 'author_structure_unstable',
      message: 'Author structure still looks unstable after parsing and should be corrected upstream.',
    });
  }

  if (citation.extraction?.rejectedCandidates?.some((candidate) => candidate.includes('alternating'))) {
    issues.push({
      field: 'authors',
      severity: 'info',
      code: 'alternating_surname_given_tokens',
      message: 'Author names were normalized from a compact alternating token pattern.',
    });
  }

  if (citation.authors.value.some((author) => {
    const literal = normalizeWhitespace(author.literal ?? '');
    return Boolean(literal)
      && isGroupAuthor(literal)
      && normalizeGroupAuthor(literal) !== literal;
  })) {
    issues.push({
      field: 'authors',
      severity: 'info',
      code: 'truncated_group_author',
      message: 'Group-author formatting was normalized and should be reviewed.',
    });
  }

  if (citation.volume.value && ['journal', 'conference'].includes(citation.referenceType) && isPlaceholderValue(citation.volume.value)) {
    issues.push({
      field: 'volume',
      severity: 'warning',
      code: 'placeholder_volume',
      message: 'Volume contains a placeholder value rather than a real locator.',
      extracted: citation.volume.value,
    });
  }

  if (citation.journal.value && journalActsAsVenue && isPlaceholderValue(citation.journal.value)) {
    issues.push({
      field: 'journal',
      severity: 'warning',
      code: 'placeholder_journal',
      message: 'Journal/venue contains a placeholder value rather than a real source.',
      extracted: citation.journal.value,
    });
  }

  if (citation.referenceType === 'conference') {
    const venue = normalized(citation.conferenceTitle.value ?? citation.bookTitle.value ?? citation.journal.value ?? '');
    if (venue && looksWeakConferenceVenue(venue)) {
      issues.push({
        field: 'conferenceTitle',
        severity: 'info',
        code: 'weak_proceedings_venue',
        message: 'Conference citation venue looks weak or incomplete.',
        extracted: citation.conferenceTitle.value ?? citation.bookTitle.value ?? citation.journal.value,
      });
    }
  }

  if (citation.referenceType === 'conference' && !citation.conferenceTitle.value && !citation.bookTitle.value && !citation.journal.value) {
    issues.push({
      field: 'conferenceTitle',
      severity: 'warning',
      code: 'venue_missing_for_conference',
      message: 'Conference citation is missing a conference or book venue field.',
    });
  }

  for (const missingField of getMissingRequiredFields(citation)) {
    if (missingField === 'venue') {
      issues.push({
        field: 'journal',
        severity: 'error',
        code: 'missing_required_venue',
        message: 'A required source/venue field is missing for this reference type.',
      });
    }
  }

  if (
    rawSuggestsDroppedLocator(citation.raw)
    && ['journal', 'conference', 'chapter'].includes(citation.referenceType)
    && !isLocatorLike(citation.pages.value)
  ) {
    issues.push({
      field: 'pages',
      severity: 'warning',
      code: 'locator_missing_from_source',
      message: 'The raw citation appears to contain pages or an article locator that was not preserved.',
      extracted: citation.pages.value,
    });
  }

  return issues;
}

function buildProtectedTokenIssues(citation: CanonicalCitation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const reason of getProtectedTitleCorruptionReasons(citation.raw, citation.title.value)) {
    issues.push({
      field: 'title',
      severity: 'error',
      code: 'protected_title_token_corrupted',
      message: reason,
      extracted: citation.title.value,
    });
  }

  for (const reason of getProtectedContainerCorruptionReasons(citation.raw, {
    journal: citation.journal.value ?? undefined,
    conferenceTitle: citation.conferenceTitle.value ?? undefined,
    bookTitle: citation.bookTitle.value ?? undefined,
  }, citation.title.value)) {
    issues.push({
      field: citation.referenceType === 'conference' ? 'conferenceTitle' : citation.referenceType === 'chapter' ? 'bookTitle' : 'journal',
      severity: 'error',
      code: 'protected_venue_token_corrupted',
      message: reason,
      extracted: citation.conferenceTitle.value ?? citation.bookTitle.value ?? citation.journal.value,
    });
  }

  return issues;
}

function buildReferenceSignatureIssues(citation: CanonicalCitation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const title = citation.title.value ?? '';
  const venue = citation.conferenceTitle.value ?? citation.bookTitle.value ?? citation.journal.value ?? citation.publisher.value ?? '';
  const doiClusters = countDistinctDoiClusters(citation.raw);
  const yearClusters = countYearClusters(citation.raw);

  if (hasEmbeddedReferenceStart(title)) {
    issues.push({
      field: 'title',
      severity: 'error',
      code: 'embedded_reference_start_in_title',
      message: 'Title appears to contain the start of a second reference.',
      extracted: title,
    });
  }

  if (hasEmbeddedReferenceStart(venue)) {
    issues.push({
      field: citation.referenceType === 'conference' ? 'conferenceTitle' : citation.referenceType === 'chapter' ? 'bookTitle' : 'journal',
      severity: 'error',
      code: 'embedded_reference_start_in_venue',
      message: 'Venue field appears to contain the start of a second reference.',
      extracted: venue,
    });
  }

  if (doiClusters >= 2) {
    issues.push({
      field: 'raw',
      severity: 'error',
      code: 'multiple_doi_clusters',
      message: 'Raw citation contains multiple DOI clusters and likely includes more than one reference.',
      extracted: doiClusters,
    });
  }

  if (yearClusters >= 2) {
    issues.push({
      field: 'raw',
      severity: 'error',
      code: 'multiple_year_anchor_clusters',
      message: 'Raw citation contains multiple year-anchor clusters and likely includes more than one reference.',
      extracted: yearClusters,
    });
  }

  return issues;
}

function buildSplitContaminationIssues(citation: CanonicalCitation, splitArtifact?: {
  cleanedChunk: string;
  contaminationFlags: string[];
  strippedRegions: Array<{ rule: string; rawText: string }>;
  chunkLength: number;
  lineCount: number;
}): ValidationIssue[] {
  if (!splitArtifact || splitArtifact.contaminationFlags.length === 0) return [];

  const issues: ValidationIssue[] = [];

  for (const flag of splitArtifact.contaminationFlags) {
    switch (flag) {
      case 'header_bleed_suspected': {
        const confirmed = splitArtifact.strippedRegions.some((region) => ['header_bleed', 'running_title'].includes(region.rule));
        issues.push({
          field: 'raw',
          severity: 'warning',
          code: confirmed ? 'header_bleed_confirmed' : 'header_bleed_suspected',
          message: confirmed
            ? 'Split stage removed header-like text from this citation chunk before extraction.'
            : 'Split stage suspects header-like text contaminated this citation chunk.',
          extracted: splitArtifact.strippedRegions.map((region) => region.rawText),
        });
        break;
      }
      case 'page_artifact_present': {
        const confirmed = splitArtifact.strippedRegions.some((region) => region.rule === 'page_number' || /\b\d+\s+of\s+\d+\b/i.test(region.rawText));
        issues.push({
          field: 'raw',
          severity: 'warning',
          code: confirmed ? 'page_artifact_confirmed' : 'page_artifact_suspected',
          message: confirmed
            ? 'Split stage removed page or running-artifact text from this citation chunk.'
            : 'Split stage suspects page or running-artifact text contaminated this citation chunk.',
          extracted: splitArtifact.strippedRegions.map((region) => region.rawText),
        });
        break;
      }
      case 'multiline_truncation_suspected': {
        const confirmed =
          /(?:[,;:]\s*|\b(?:and|&|et al\.?)\s*)$/i.test(splitArtifact.cleanedChunk)
          || citation.authors.value.length === 0
          || !citation.title.value;
        issues.push({
          field: 'authors',
          severity: 'warning',
          code: confirmed ? 'multiline_truncation_confirmed' : 'multiline_truncation_suspected',
          message: confirmed
            ? 'Citation text still looks truncated after split-stage multiline repair.'
            : 'Split stage suspects multiline truncation in this citation chunk.',
          extracted: splitArtifact.cleanedChunk,
        });
        break;
      }
      case 'doi_orphan': {
        const confirmed =
          /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,}\/\S+$/i.test(splitArtifact.cleanedChunk)
          || citation.authors.value.length === 0
          || !citation.title.value;
        issues.push({
          field: 'doi',
          severity: 'warning',
          code: confirmed ? 'doi_orphan_confirmed' : 'doi_orphan_suspected',
          message: confirmed
            ? 'Citation chunk resolved to a DOI-orphan shape instead of a complete reference.'
            : 'Split stage suspects this chunk is a DOI-only orphan.',
          extracted: splitArtifact.cleanedChunk,
        });
        break;
      }
      case 'oversized_chunk': {
        const confirmed = splitArtifact.chunkLength > OVERSIZED_CHUNK_CHARS || splitArtifact.lineCount > OVERSIZED_CHUNK_LINES;
        issues.push({
          field: 'raw',
          severity: 'warning',
          code: confirmed ? 'oversized_chunk_confirmed' : 'oversized_chunk_suspected',
          message: confirmed
            ? 'Citation chunk remains oversized after split-stage recovery and should be reviewed.'
            : 'Split stage suspects this citation chunk is oversized for a single reference.',
          extracted: {
            chunkLength: splitArtifact.chunkLength,
            lineCount: splitArtifact.lineCount,
          },
          expected: {
            maxChunkLength: OVERSIZED_CHUNK_CHARS,
            maxLineCount: OVERSIZED_CHUNK_LINES,
          },
        });
        break;
      }
      default:
        break;
    }
  }

  return issues;
}

function buildResolutionIssues(citation: CanonicalCitation): ValidationIssue[] {
  const resolution = citation.resolution;
  if (!resolution) return [];

  const issues: ValidationIssue[] = [];

  switch (resolution.status) {
    case 'insufficient_evidence':
      issues.push({
        field: 'raw',
        severity: 'error',
        code: 'parse_too_sparse',
        message: 'Citation did not provide enough title and author evidence for strict external resolution.',
        extracted: resolution.queryEvidence,
      });
      break;
    case 'ambiguous_match':
      issues.push({
        field: 'raw',
        severity: 'warning',
        code: 'ambiguous_external_match',
        message: 'Multiple strict external candidates tied and no single match was accepted.',
        extracted: resolution.rejectedReasons,
      });
      break;
    case 'no_exact_match':
      issues.push({
        field: 'raw',
        severity: 'info',
        code: 'no_exact_external_match',
        message: 'No exact external title match was accepted for this citation.',
      });
      break;
    case 'provider_no_coverage':
      issues.push({
        field: 'raw',
        severity: 'info',
        code: 'provider_no_coverage',
        message: 'Configured external providers did not appear to cover this citation type reliably.',
      });
      break;
    case 'provider_error': {
      const rateLimited = resolution.rejectedReasons.some((reason) => /\b429\b|\brate limit/i.test(reason));
      issues.push({
        field: 'raw',
        severity: 'info',
        code: rateLimited ? 'authority_rate_limited' : 'provider_resolution_error',
        message: rateLimited
          ? 'External resolution was rate limited by a provider.'
          : 'External resolution encountered a provider error.',
        extracted: resolution.rejectedReasons,
      });
      break;
    }
    case 'verified_with_year_tolerance':
      issues.push({
        field: 'year',
        severity: 'info',
        code: 'resolution_year_tolerance_applied',
        message: 'External resolution accepted a preprint-like year shift within +/-1 year.',
        extracted: {
          extracted: citation.year.value,
          resolved: resolution.acceptedCandidate?.year,
        },
      });
      break;
    default:
      break;
  }

  if (resolution.conflictFields.length > 0) {
    issues.push({
      field: 'raw',
      severity: 'error',
      code: 'resolved_field_conflict',
      message: 'Verified external fields conflicted with extracted values and were preserved for review.',
      extracted: resolution.conflictFields,
    });
  }

  if ((resolution.appliedFields?.length ?? 0) > 0) {
    issues.push({
      field: 'raw',
      severity: 'info',
      code: 'authority_fields_applied',
      message: 'Verified external metadata supplied corrected or missing fields.',
      extracted: resolution.appliedFields,
    });
  }

  return issues;
}

function buildValidationMetadata(citation: CanonicalCitation): ValidationMetadata {
  const resolution = citation.resolution;
  return {
    verificationAttempted: Boolean(resolution && !['insufficient_evidence', 'skipped_duplicate'].includes(resolution.status)),
    authoritySource: resolution?.provider,
    mismatchFields: resolution?.conflictFields ?? [],
  };
}

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const deduped: ValidationIssue[] = [];

  for (const issue of issues) {
    const key = [
      issue.field ?? '',
      issue.severity,
      issue.code,
      issue.message,
      JSON.stringify(issue.extracted ?? null),
      JSON.stringify(issue.expected ?? null),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
}

export async function validateCitationOffline(
  citation: CanonicalCitation,
  splitArtifact?: {
    cleanedChunk: string;
    contaminationFlags: string[];
    strippedRegions: Array<{ rule: string; rawText: string }>;
    chunkLength: number;
    lineCount: number;
  },
): Promise<{ issues: ValidationIssue[]; metadata: ValidationMetadata }> {
  const issues = dedupeIssues([
    ...buildSplitContaminationIssues(citation, splitArtifact),
    ...buildReferenceSignatureIssues(citation),
    ...buildProtectedTokenIssues(citation),
    ...buildPlausibilityIssues(citation),
    ...buildResolutionIssues(citation),
  ]);

  return {
    issues,
    metadata: buildValidationMetadata(citation),
  };
}

export function createValidateStage(): V2Stage {
  return {
    id: 'validate',
    async run(context) {
      const startedAt = Date.now();
      const citations: CanonicalCitation[] = [];

      for (const citation of context.citations) {
        const splitArtifact = context.splitArtifactsByCitationId[citation.id];
        const { issues, metadata } = await validateCitationOffline(citation, splitArtifact);
        const hasError = issues.some((issue) => issue.severity === 'error');
        let nextCitation: CanonicalCitation = {
          ...citation,
          validationIssues: issues,
          validation: metadata,
        };
        nextCitation = attachCitationDebug(nextCitation, 'validate', {
          issues,
          verificationAttempted: metadata.verificationAttempted,
          authoritySource: metadata.authoritySource,
          mismatchFields: metadata.mismatchFields,
          resolutionStatus: citation.resolution?.status,
          splitContaminationFlags: splitArtifact?.contaminationFlags ?? [],
          warningFlags: issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.code),
        }, context.debugEnabled);
        logStructuredDebug(context, 'validate', citations.length, nextCitation, {
          splitContaminationFlags: splitArtifact?.contaminationFlags ?? [],
          warningFlags: issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.code),
          selectionReason: citation.resolution?.status,
          selectedBranch: undefined,
          authorParserMode: citation.extraction?.authorParserMode,
        });

        citations.push(addCitationStageLog(
          nextCitation,
          createStageDiagnostic(
            'validate',
            hasError ? 'warning' : 'success',
            issues.length > 0 ? `Validation produced ${issues.length} issue(s).` : 'Validation passed without issues.',
            {
              issueCount: issues.length,
              verificationAttempted: metadata.verificationAttempted,
              authoritySource: metadata.authoritySource,
              mismatchFields: metadata.mismatchFields,
            },
          ),
        ));
      }

      return {
        ...context,
        citations,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            validate: {
              citationCount: citations.length,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'validate',
            'success',
            `Validated ${citations.length} citation(s).`,
            { citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
