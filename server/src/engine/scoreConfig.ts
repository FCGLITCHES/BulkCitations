import type { CitationStyle, ExtractedFields, ScoreBreakdown } from './types/citation.js';

export const SCORE_VERSION = 'v2.0';
export const GUARANTEED_DETECTION_CONFIDENCE = 0.75;

export const GUARANTEED_SCORING_STYLES = new Set<CitationStyle>([
  'apa7',
  'mla9',
  'chicago-author-date',
  'vancouver',
  'ieee',
  'harvard-ctr',
  'chicago-notes-bib',
  'ama',
  'acs',
]);

export const FALLBACK_SCORING_STYLES = new Set<CitationStyle>([]);

export const TITLE_CASE_ALL_CAPS_ALLOWLIST = new Set([
  'DNA',
  'RNA',
  'AI',
  'COVID',
  'CRISPR',
  'HIV',
  'SARS',
  'UNESCO',
  'WHO',
  'DOI',
  'URL',
  'API',
]);

export const RENDER_AFFECTING_FIELDS = new Set<keyof ExtractedFields>([
  'authors',
  'editors',
  'title',
  'year',
  'journal',
  'conferenceTitle',
  'bookTitle',
  'siteName',
  'repository',
  'publisher',
  'placeOfPublication',
  'institution',
  'thesisType',
  'volume',
  'issue',
  'pages',
  'articleNumber',
  'reportNumber',
  'pmid',
  'arxiv',
  'isbn',
  'issn',
  'handle',
  'patent',
  'edition',
  'accessedDate',
  'doi',
  'url',
]);

export function resolveScoreWeights(style: CitationStyle): {
  fieldWeight: number;
  formatWeight: number;
  structuralWeight: number;
} {
  if (GUARANTEED_SCORING_STYLES.has(style)) {
    return {
      fieldWeight: 0.4,
      formatWeight: 0.35,
      structuralWeight: 0.25,
    };
  }

  return {
    fieldWeight: 0.4,
    formatWeight: 0.25,
    structuralWeight: 0.35,
  };
}

export function createEmptyScoreBreakdown(
  input: {
    splitQualityFlag?: 'ok' | 'low' | 'sampled';
    rawDetectionConfidence?: number;
    effectiveDetectionConfidence?: number;
  } = {},
): ScoreBreakdown {
  const effectiveDetectionConfidence = input.effectiveDetectionConfidence ?? 0;
  const rawDetectionConfidence = input.rawDetectionConfidence ?? effectiveDetectionConfidence;

  return {
    fieldEvidenceScore: 0,
    contentCorrectnessScore: 0,
    cosmeticFormatScore: 0,
    formatCorrectnessScore: 0,
    structuralIntegrityScore: 0,
    fieldEvidence: {
      completeness: 0,
      avgMandatoryConfidence: 0,
    },
    formatScoringPath: 'fallback',
    formatSubscores: {
      authorFormatScore: 0,
      titleCaseScore: 0,
      punctuationScore: 0,
      fieldOrderScore: 0,
      spacingScore: 0,
      noDuplicatePunctScore: 0,
      containerFormatScore: 0,
    },
    semanticSegmentSubscores: {
      authorScore: 0,
      titleScore: 0,
      yearScore: 0,
      containerScore: 0,
      volumeScore: 0,
      issueScore: 0,
      locatorScore: 0,
      identifierScore: 0,
    },
    cosmeticSubscores: {
      titleCaseScore: 0,
      spacingScore: 0,
      noDuplicatePunctScore: 0,
      punctuationScore: 0,
    },
    structuralSubscores: {
      refTypeConfidenceScore: 0,
      noDuplicateFieldsScore: 0,
      noArtifactTokensScore: 0,
      noCorruptedContainerScore: 0,
      fieldBoundaryScore: 0,
      noDuplicateAuthorScore: 0,
      locatorConsistencyScore: 0,
    },
    penalties: [],
    authorityAdjustment: 0,
    diagnostics: {
      splitQualityFlag: input.splitQualityFlag ?? 'sampled',
      detectionConfidence: effectiveDetectionConfidence,
      rawDetectionConfidence,
      effectiveDetectionConfidence,
      formatScoringPathReason: 'style_fallback',
      rescoredAfterCorrection: false,
      scoreVersion: SCORE_VERSION,
    },
    rawScore: 0,
    displayScore: 0,
  };
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}
