import type {
  ConvertedReference,
  ReferenceAdminReviewPayload,
  ReferenceAnalyticsPayload,
  ReferenceExportPayload,
  ReferenceReviewPayload,
} from '@shared/schema';

function buildReviewPayload(reference: ConvertedReference): ReferenceReviewPayload {
  return {
    healthState: reference.healthState ?? 'review',
    healthReasons: reference.healthReasons ?? [],
    confidence: reference.confidence,
    authorityStatus: reference.authorityStatus,
    assertionSummary: reference.assertionSummary,
    assertionHighlights: reference.assertionHighlights,
    styleDetectionFailed: Boolean(reference.styleDetectionFailed),
    authorInitialsOnly: Boolean(reference.authorInitialsOnly),
    truthProvenance: reference.truthProvenance,
  };
}

function buildAdminReviewPayload(reference: ConvertedReference): ReferenceAdminReviewPayload {
  return {
    warnings: reference.warnings ?? [],
    engineSnapshot: reference.reportEngineSnapshot,
    debug: reference.debug,
  };
}

function buildExportPayload(reference: ConvertedReference): ReferenceExportPayload {
  return {
    workKey: reference.workKey,
    outputStyle: reference.outputStyle,
    referenceType: reference.referenceType,
    convertedText: reference.convertedText,
    parsedData: reference.parsedData,
  };
}

function buildAnalyticsPayload(reference: ConvertedReference): ReferenceAnalyticsPayload {
  return {
    engineVersion: reference.reportEngineSnapshot?.engineVersion,
    healthState: reference.healthState,
    confidenceScore: reference.confidence?.score,
    warningCount: reference.warnings?.length ?? 0,
    styleDetectionFailed: Boolean(reference.styleDetectionFailed),
    authorityStatus: reference.authorityStatus,
    partialResult: Boolean(reference.reportEngineSnapshot?.processingPath?.partialResult),
    extractorPath: reference.reportEngineSnapshot?.extractorPath,
    truthApplied: Boolean(reference.truthProvenance?.truthApplied),
  };
}

export function attachReferencePayloads<T extends ConvertedReference>(reference: T): T {
  return {
    ...reference,
    review: buildReviewPayload(reference),
    adminReview: buildAdminReviewPayload(reference),
    exportPayload: buildExportPayload(reference),
    analyticsPayload: buildAnalyticsPayload(reference),
  };
}
