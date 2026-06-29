import { createHash } from 'node:crypto';
import type { ProcessedCitation, CanonicalAuthor } from '../engine/types/citation.js';
import type { StoredReport } from '../runtime/store.js';
import { getCitation } from '../runtime/persistence.js';

function fingerprintFor(raw: string): string {
  return createHash('sha256').update(raw.trim().toLowerCase()).digest('hex');
}

function authorToDisplay(author: CanonicalAuthor): string {
  if (author.literal?.trim()) {
    return author.literal.trim();
  }
  return author.given?.trim()
    ? `${author.family}, ${author.given.trim()}`
    : author.family;
}

function readStringField(value: { value: string | null } | undefined): string | undefined {
  return typeof value?.value === 'string' && value.value.trim() ? value.value : undefined;
}

function readNumberField(value: { value: number | null } | undefined): string | undefined {
  return typeof value?.value === 'number' ? String(value.value) : undefined;
}

function mapEngineReferenceTypeToAdmin(value: ProcessedCitation['referenceType'] | undefined): string | undefined {
  switch (value) {
    case 'article-journal':
      return 'journal';
    case 'book':
      return 'book';
    case 'book-chapter':
      return 'bookChapter';
    case 'conference-paper':
      return 'conference';
    case 'webpage':
      return 'website';
    case 'report':
      return 'report';
    case 'thesis':
      return 'thesis';
    case 'preprint':
      return 'preprint';
    case 'unknown':
    default:
      return 'other';
  }
}

function buildParsedReference(citation: ProcessedCitation | undefined): Record<string, unknown> | undefined {
  if (!citation) {
    return undefined;
  }

  const authors = citation.fields.authors.value?.map(authorToDisplay).filter(Boolean);
  const editors = citation.fields.editors.value?.map(authorToDisplay).filter(Boolean);

  return {
    ...(authors?.length ? { authors } : {}),
    ...(editors?.length ? { editors } : {}),
    ...(readStringField(citation.fields.title) ? { title: readStringField(citation.fields.title) } : {}),
    ...(readNumberField(citation.fields.year) ? { year: readNumberField(citation.fields.year) } : {}),
    ...(readStringField(citation.fields.journal) ? { journal: readStringField(citation.fields.journal) } : {}),
    ...(readStringField(citation.fields.volume) ? { volume: readStringField(citation.fields.volume) } : {}),
    ...(readStringField(citation.fields.issue) ? { issue: readStringField(citation.fields.issue) } : {}),
    ...(readStringField(citation.fields.pages) ? { pages: readStringField(citation.fields.pages) } : {}),
    ...(readStringField(citation.fields.doi) ? { doi: readStringField(citation.fields.doi) } : {}),
    ...(readStringField(citation.fields.publisher) ? { publisher: readStringField(citation.fields.publisher) } : {}),
    ...(readStringField(citation.fields.placeOfPublication)
      ? { placeOfPublication: readStringField(citation.fields.placeOfPublication) }
      : {}),
    ...(readStringField(citation.fields.url) ? { url: readStringField(citation.fields.url) } : {}),
    ...(readStringField(citation.fields.accessedDate)
      ? { accessed: readStringField(citation.fields.accessedDate) }
      : {}),
    ...(readStringField(citation.fields.bookTitle)
      ? { bookTitle: readStringField(citation.fields.bookTitle) }
      : {}),
    ...(readStringField(citation.fields.conferenceTitle)
      ? { conferenceTitle: readStringField(citation.fields.conferenceTitle) }
      : {}),
    ...(readStringField(citation.fields.reportNumber)
      ? { reportNumber: readStringField(citation.fields.reportNumber) }
      : {}),
    ...(readStringField(citation.fields.institution)
      ? { institution: readStringField(citation.fields.institution) }
      : {}),
    ...(readStringField(citation.fields.edition)
      ? { edition: readStringField(citation.fields.edition) }
      : {}),
    ...(readStringField(citation.fields.repository)
      ? { repository: readStringField(citation.fields.repository) }
      : {}),
    ...(readStringField(citation.fields.thesisType)
      ? { thesisType: readStringField(citation.fields.thesisType) }
      : {}),
  };
}

export function buildReportEngineSnapshot(
  citation: ProcessedCitation,
): Record<string, unknown> {
  return {
    engineVersion: 'v2',
    processingPath: {
      stagesRun: citation.stageLog.map((stage) => stage.stageId),
      partialResult: Boolean(citation.partialData),
      partialReasons: citation.partialData ? ['partial_extraction'] : [],
      extractorPathsUsed: citation.extractionMeta?.runMode ? [citation.extractionMeta.runMode] : [],
      fallbacksUsed: citation.healthWarnings.map((warning) => warning.code),
    },
    stageLogSummary: citation.stageLog.map((stage) => ({
      stageId: stage.stageId,
      status: stage.status,
      code: stage.code,
      message: stage.message,
    })),
    extractorPath: citation.extractionMeta?.runMode ?? 'hybrid',
    validationCodes: citation.healthWarnings.map((warning) => warning.code),
    qualityFlags: citation.healthReasons,
    splitContaminationFlags: citation.inputCleanup?.hints ?? [],
  };
}

/**
 * Builds a JSON payload compatible with the admin UI's `CitationReport` shape
 * from persisted report rows plus live citation context when available.
 */
export async function enrichStoredReport(stored: StoredReport): Promise<Record<string, unknown>> {
  let citation: ProcessedCitation | undefined;
  if (stored.jobId && stored.citationId) {
    citation = await getCitation(stored.jobId, stored.citationId);
  }

  const originalText = citation?.raw ?? '(citation unavailable — job may have expired)';
  const fallbackFingerprint = citation
    ? fingerprintFor(originalText)
    : fingerprintFor(`${stored.id}:${originalText}`);
  const parsedData = buildParsedReference(citation);
  const resolutionTrace = stored.resolutionTrace ?? {
    ...(stored.reviewState?.resolvedByCommit ? { resolvedByCommit: stored.reviewState.resolvedByCommit } : {}),
    ...(stored.reviewState?.resolvedByVersion ? { resolvedByVersion: stored.reviewState.resolvedByVersion } : {}),
    ...(stored.resolvedAt ? { resolvedAt: stored.resolvedAt } : {}),
  };

  return {
    id: stored.id,
    source: stored.source ?? 'user',
    originalText,
    detectedStyle: citation?.detectedStyle ?? 'unknown',
    outputStyle: citation?.outputStyle ?? 'unknown',
    ...(parsedData ? { parsedData } : {}),
    referenceType:
      stored.reviewState?.referenceType
      ?? mapEngineReferenceTypeToAdmin(citation?.referenceType),
    convertedText: citation?.renderedText ?? '',
    confidence:
      citation?.displayScore != null ? Math.min(1, Math.max(0, citation.displayScore / 100)) : undefined,
    failureCategory: stored.failureCategory,
    failureCategories: stored.failureCategories?.length ? stored.failureCategories : [stored.failureCategory],
    ...(stored.userNote != null ? { userNote: stored.userNote } : {}),
    status: stored.status,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    ...(stored.resolvedAt ? { resolvedAt: stored.resolvedAt } : {}),
    fingerprint: stored.fingerprint ?? fallbackFingerprint,
    reportCount: stored.reportCount ?? 1,
    ...(stored.reviewState?.fixType ? { fixType: stored.reviewState.fixType } : {}),
    ...(stored.reviewState?.proposedPattern ? { proposedPattern: stored.reviewState.proposedPattern } : {}),
    ...(stored.reviewState?.proposedStyleFix ? { proposedStyleFix: stored.reviewState.proposedStyleFix } : {}),
    ...(stored.correctedFields ? { correctedFields: stored.correctedFields } : {}),
    ...(stored.reviewState?.fieldApproval ? { fieldApproval: stored.reviewState.fieldApproval } : {}),
    ...(stored.reviewState?.failureTaxonomy ? { failureTaxonomy: stored.reviewState.failureTaxonomy } : {}),
    ...(stored.stageBlame ? { stageBlame: stored.stageBlame } : {}),
    ...(stored.reviewState?.duplicateDecision ? { duplicateDecision: stored.reviewState.duplicateDecision } : {}),
    engineSnapshot:
      stored.engineSnapshot
      ?? (citation ? buildReportEngineSnapshot(citation) : undefined),
    ...(stored.reviewState?.assigneeName ? { assigneeName: stored.reviewState.assigneeName } : {}),
    ...(stored.reviewState?.reviewEvents ? { reviewEvents: stored.reviewState.reviewEvents } : {}),
    ...(Object.keys(resolutionTrace).length > 0 ? { resolutionTrace } : {}),
    ...(stored.reviewState?.resolvedByCommit
      ? { resolvedByCommit: stored.reviewState.resolvedByCommit }
      : stored.resolutionTrace?.resolvedByCommit
        ? { resolvedByCommit: stored.resolutionTrace.resolvedByCommit }
        : {}),
    ...(stored.reviewState?.resolvedByVersion
      ? { resolvedByVersion: stored.reviewState.resolvedByVersion }
      : stored.resolutionTrace?.resolvedByVersion
        ? { resolvedByVersion: stored.resolutionTrace.resolvedByVersion }
        : {}),
    ...(citation
      ? {
          originalEngineOutput: {
            convertedText: citation.renderedText,
            ...(parsedData ? { parsedData } : {}),
            referenceType: mapEngineReferenceTypeToAdmin(citation.referenceType),
            confidence: Math.min(1, Math.max(0, citation.displayScore / 100)),
          },
        }
      : {}),
  };
}
