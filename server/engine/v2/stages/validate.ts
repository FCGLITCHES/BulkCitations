// @ts-nocheck
import type { CanonicalCitation, ValidationIssue, ValidationMetadata } from '@shared/schema';
import { fetchCrossrefMetadata } from '../../doiEnrichment.js';
import type { V2Stage } from '../contracts.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createStageDiagnostic,
  logStructuredDebug,
  normalizeWhitespace,
  runWithTimeout,
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
import { isGroupAuthor } from '../../shared/citationSemantics.js';

const DOI_PATTERN = /^10\.\d{4,}\/\S+$/i;
const PAGE_PATTERN = /^[A-Za-z]?\d+(?:\s*[-–]\s*[A-Za-z]?\d+)?$/;
const CURRENT_YEAR = new Date().getFullYear();
function normalized(value: string | null | undefined): string {
  return normalizeWhitespace((value ?? '').toLowerCase());
}

function compareCrossrefField(citation: CanonicalCitation, field: string, crossrefValue: unknown): ValidationIssue | null {
  if (crossrefValue == null) return null;

  switch (field) {
    case 'title':
      if (citation.title.value && normalized(citation.title.value) !== normalized(String(crossrefValue))) {
        return {
          field,
          severity: 'warning',
          code: 'authority_mismatch',
          message: 'Extracted title does not match Crossref metadata.',
          extracted: citation.title.value,
          expected: crossrefValue,
        };
      }
      return null;
    case 'journal':
      if (citation.journal.value && normalized(citation.journal.value) !== normalized(String(crossrefValue))) {
        return {
          field,
          severity: 'warning',
          code: 'authority_mismatch',
          message: 'Extracted journal does not match Crossref metadata.',
          extracted: citation.journal.value,
          expected: crossrefValue,
        };
      }
      return null;
    case 'year': {
      const extracted = citation.year.value != null ? String(citation.year.value) : null;
      const expected = String(crossrefValue);
      if (extracted && extracted !== expected) {
        return {
          field,
          severity: 'warning',
          code: 'authority_mismatch',
          message: 'Extracted year does not match Crossref metadata.',
          extracted,
          expected,
        };
      }
      return null;
    }
    case 'volume':
    case 'issue':
    case 'pages': {
      const extracted = citation[field as 'volume' | 'issue' | 'pages'].value;
      if (extracted && normalized(extracted) !== normalized(String(crossrefValue))) {
        return {
          field,
          severity: 'info',
          code: 'authority_mismatch',
          message: `Extracted ${field} does not match Crossref metadata.`,
          extracted,
          expected: crossrefValue,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

function buildPlausibilityIssues(citation: CanonicalCitation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const journalActsAsVenue = citation.referenceType === 'journal'
    || (!citation.conferenceTitle.value && !citation.bookTitle.value);

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

  if (citation.authors.value.length === 0) {
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

  if (hasCanonicalMalformedAuthors(citation.authors.value)) {
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

  if (citation.authors.value.some((author) => Boolean(author.literal) && isGroupAuthor(author.literal ?? author.last))) {
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
    && ['journal', 'conference', 'bookChapter'].includes(citation.referenceType)
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

async function buildValidationResult(
  citation: CanonicalCitation,
  splitArtifact?: {
    cleanedChunk: string;
    contaminationFlags: string[];
    strippedRegions: Array<{ rule: string; rawText: string }>;
    chunkLength: number;
    lineCount: number;
  },
): Promise<{ issues: ValidationIssue[]; metadata: ValidationMetadata }> {
  const issues = [
    ...buildSplitContaminationIssues(citation, splitArtifact),
    ...buildPlausibilityIssues(citation),
  ];
  const mismatchFields = new Set<string>();
  let verificationAttempted = false;
  let authoritySource: string | undefined;

  if (citation.doi.value && DOI_PATTERN.test(citation.doi.value)) {
    verificationAttempted = true;
    authoritySource = 'crossref';

    try {
      const crossref = await runWithTimeout('crossref-verify', fetchCrossrefMetadata(citation.doi.value), 1200);
      if (!crossref) {
        issues.push({
          field: 'doi',
          severity: 'info',
          code: 'authority_no_match',
          message: 'Crossref verification did not find a matching DOI record.',
          extracted: citation.doi.value,
        });
      } else {
        const comparisons = [
          compareCrossrefField(citation, 'title', crossref.title),
          compareCrossrefField(citation, 'journal', crossref['container-title']),
          compareCrossrefField(citation, 'year', crossref.issued?.['date-parts']?.[0]?.[0]),
          compareCrossrefField(citation, 'volume', crossref.volume),
          compareCrossrefField(citation, 'issue', crossref.issue),
          compareCrossrefField(citation, 'pages', crossref.page),
        ].filter((issue): issue is ValidationIssue => Boolean(issue));

        for (const issue of comparisons) mismatchFields.add(issue.field ?? 'unknown');
        issues.push(...comparisons);
      }
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
      if (status === 404) {
        issues.push({
          field: 'doi',
          severity: 'info',
          code: 'authority_not_found',
          message: 'Crossref did not return a record for this DOI.',
          extracted: citation.doi.value,
        });
      } else if (status === 429) {
        issues.push({
          field: 'doi',
          severity: 'info',
          code: 'authority_rate_limited',
          message: 'Crossref rate limited this verification request.',
          extracted: citation.doi.value,
        });
      } else {
      issues.push({
        field: 'doi',
        severity: 'info',
        code: 'authority_lookup_error',
        message: error instanceof Error ? error.message : 'Crossref verification failed.',
        extracted: citation.doi.value,
      });
      }
    }
  }

  return {
    issues,
    metadata: {
      verificationAttempted,
      authoritySource,
      mismatchFields: [...mismatchFields],
    },
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
        const { issues, metadata } = await buildValidationResult(citation, splitArtifact);
        const hasError = issues.some((issue) => issue.severity === 'error');
        let nextCitation = {
          ...citation,
          validationIssues: issues,
          validation: metadata,
        };
        nextCitation = attachCitationDebug(nextCitation, 'validate', {
          issues,
          verificationAttempted: metadata.verificationAttempted,
          mismatchFields: metadata.mismatchFields,
          splitContaminationFlags: splitArtifact?.contaminationFlags ?? [],
          warningFlags: issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.code),
        }, context.debugEnabled);
        logStructuredDebug(context, 'validate', citations.length, nextCitation, {
          splitContaminationFlags: splitArtifact?.contaminationFlags ?? [],
          warningFlags: issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.code),
          selectionReason: undefined,
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
