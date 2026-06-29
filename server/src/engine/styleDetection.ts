import type { StyleDetectionPrediction } from '../ml/client.js';
import {
  EXACT_STYLES_BY_FAMILY,
  EXACT_STYLE_SIGNAL_WEIGHTS,
  FAMILY_DEFAULT_STYLE,
  FAMILY_SIGNAL_WEIGHTS,
  FAMILY_STRONG_SIGNALS,
  STYLE_FAMILY_BY_STYLE,
  type SignalWeightTable,
} from './styleDetectionWeights.js';
import type { StyleDetectionResult } from './types/carrier.js';
import type {
  CitationStyle,
  StyleFamilyCandidateScore,
  StyleCandidateScore,
  StyleCertaintyTier,
  StyleFamily,
  StyleSignalCode,
} from './types/citation.js';

/** End-anchored IEEE journal line: quoted title, vol./no./pp., trailing calendar year */
const LOCATOR_IEEE_SIGNATURE_RE =
  /"[^"]{4,}"\s*,?\s*.+?,\s*vol\.?\s*(?:\d+|\?),\s*(?:no\.?\s*[^,]+,\s*)?p{1,2}\.?\s*[A-Za-z]?\d[\w–-]*,\s*(?:19|20)\d{2}\.?$/iu;

const DOI_REGEX = /\b10\.\d{4,9}\/[^\s"'<>]+/iu;
const URL_REGEX = /\bhttps?:\/\/[^\s"'<>]+/iu;
const STYLE_YEAR_FRAGMENT = '(?:1[6-9]|20)\\d{2}';
const STYLE_YEAR_SUFFIX_FRAGMENT = `${STYLE_YEAR_FRAGMENT}[a-z]?`;
const STYLE_YEAR_REGEX = new RegExp(`\\b${STYLE_YEAR_SUFFIX_FRAGMENT}\\b`, 'u');
const STYLE_CONFERENCE_CUE_REGEX =
  /\b(?:conference|symposium|simp[oó]sio|workshop|congress|congreso|congresso|meeting|proceedings|proc\.?|anais|prosiding|jornadas|seminar|seminario|abstracts publication|abstracts|конференц\p{L}*|канферэнц\p{L}*)\b/iu;
const STYLE_BOOK_PUBLISHER_CUE_REGEX =
  /\b(?:press|publisher|publishing|university|routledge|springer|wiley|elsevier|gru[yü]ter|verlag|editora|editorial|dial[eé]tica|hanser|birkh[aä]user|apress|palgrave|peter\s+lang(?:\s+\p{L}+)?|british standards|智勝出版)\b/iu;
const STYLE_REPOSITORY_CUE_REGEX =
  /\b(?:Center for Open Science|Open Science Framework|OSF|Research Square(?: Platform LLC)?|SSRN|TechRxiv|Preprints(?:\.org)?|bioRxiv|medRxiv|arXiv|Elsevier BV)\b/iu;
const STYLE_RFC_WEB_CUE_REGEX = /\b(?:RFC Editor|Internet Engineering Task Force)\b/iu;
const SMART_QUOTES_REGEX = /[“”„‟«»]/g;
const SMART_APOSTROPHE_REGEX = /[‘’‚‛]/g;
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '\u2070': '0',
  '\u00B9': '1',
  '\u00B2': '2',
  '\u00B3': '3',
  '\u2074': '4',
  '\u2075': '5',
  '\u2076': '6',
  '\u2077': '7',
  '\u2078': '8',
  '\u2079': '9',
};

const STYLE_DETECTION_THRESHOLDS = {
  familyCommitConfidence: 0.67,
  familyCommitMargin: 0.1,
  signalGroupMinimum: 3,
  webKnownMediumConfidence: 0.85,
  familySmoothingDominantShare: 0.7,
  familySmoothingBoost: 0.05,
  familySmoothingCap: 0.85,
  exactSmoothingDominantShare: 0.8,
  exactSmoothingLeadingMarginTolerance: 0.03,
  exactSmoothingCandidateFloor: 0.58,
  exactCommitFamilyConfidence: 0.75,
  exactCommitStyleConfidence: 0.6,
  exactCommitStyleMargin: 0.12,
  certaintyHighFamilyConfidence: 0.85,
  certaintyHighStyleMargin: 0.18,
  identifierTailSignalShare: 0.8,
  identifierBackboneStripShare: 0.68,
  journalAbbrevRatio: 0.75,
} as const;

type SignalGroup =
  | 'enumerator'
  | 'author_lead'
  | 'author_count'
  | 'author_separator'
  | 'year'
  | 'title'
  | 'container'
  | 'editor_translator'
  | 'edition'
  | 'locator'
  | 'identifier'
  | 'capitalization'
  | 'punctuation'
  | 'web';

export interface StyleSignalSet {
  normalizedText: string;
  length: number;
  signalGroups: Set<SignalGroup>;
  matchedSignals: Set<StyleSignalCode>;
  likelyTitle: string;
}

interface FamilyScoringResult {
  candidates: StyleFamilyCandidateScore[];
  conflictDampened: boolean;
}

interface StyleDecision {
  family: StyleFamily;
  familyConfidence: number;
  familyMarginToRunnerUp: number;
  detectedStyle: CitationStyle;
  styleConfidence: number;
  styleMarginToRunnerUp: number;
  certaintyTier: StyleCertaintyTier;
  signalGroupCount: number;
  familyCandidates: StyleFamilyCandidateScore[];
  styleCandidates: StyleCandidateScore[];
  signals: StyleSignalCode[];
  conflictDampened: boolean;
}

interface MlTrustedStyleOverride {
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>;
  style: CitationStyle;
  familyConfidence: number;
  styleConfidence: number;
  styleMarginToRunnerUp: number;
  styleCandidates: StyleCandidateScore[];
}

interface StructuralFamilyGate {
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>;
  confidence: number;
  marginToRunnerUp: number;
}

interface FamilyScopedStyleOverride {
  style: CitationStyle;
  styleConfidence: number;
  styleMarginToRunnerUp: number;
}

export function detectCitationStyle(
  rawCitation: string,
  mlHint?: StyleDetectionPrediction | null,
): StyleDetectionResult {
  return promoteDominantExactStyle(
    rawCitation,
    applyMultiStyleFlag([detectCitationStyleCore(rawCitation, mlHint)], false)[0]!,
  );
}

export function detectCitationStyles(
  rawCitations: string[],
  mlHints: Array<StyleDetectionPrediction | null | undefined> = [],
): StyleDetectionResult[] {
  const decisions = rawCitations.map((rawCitation, index) =>
    detectCitationStyleCore(rawCitation, mlHints[index] ?? null),
  );
  return applyBatchSmoothing(decisions).map((result, index) =>
    promoteDominantExactStyle(rawCitations[index] ?? '', result),
  );
}

export function normalizeStyleInput(rawCitation: string): string {
  const normalized = rawCitation
    .normalize('NFKC')
    .replace(SMART_QUOTES_REGEX, '"')
    .replace(SMART_APOSTROPHE_REGEX, "'")
    .replace(/&amp;/giu, '&')
    .replace(
      /[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]/gu,
      (digit) => SUPERSCRIPT_DIGITS[digit] ?? digit,
    )
    .replace(/\s+/g, ' ')
    .trim();
  // Fold diacritics so copy-paste/OCR "non-ASCII" corruption (a->a-grave, e->e-acute)
  // cannot break the ASCII structural keywords the scorer matches ("Available",
  // "Proceedings", "Press"). This is style-detection only \u2014 Phase 4 extraction uses
  // its own input normalization, so extracted author/title accents are preserved.
  // No-op on the style DECISION for clean text: style markers are punctuation and
  // structure, not accented letters. Several commit profiles already fold here
  // (foldStyleDiacritics); this lifts that consistently to the base normalized text.
  // See docs/engine/field-ownership-map.md (noise-cliff).
  return foldStyleDiacritics(normalized);
}

function foldStyleDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '');
}

export function styleFamilyForStyle(style: CitationStyle): StyleFamily {
  if (style === 'auto' || style === 'unknown') {
    return 'unknown';
  }

  return STYLE_FAMILY_BY_STYLE[style];
}

export function representativeStyleForFamily(family: StyleFamily): CitationStyle {
  return FAMILY_DEFAULT_STYLE[family];
}

function detectCitationStyleCore(
  rawCitation: string,
  mlHint?: StyleDetectionPrediction | null,
): StyleDecision {
  const signals = extractStyleSignals(rawCitation);
  const minimumSignalCount = signals.signalGroups.size;
  const familyScoring = scoreStyleFamily(signals, mlHint);
  const sortedFamilyScores = [...familyScoring.candidates];
  const topFamily = sortedFamilyScores[0];
  const runnerUpFamily = sortedFamilyScores[1];
  const familyConfidence = topFamily?.score ?? 0;
  const familyMarginToRunnerUp = Math.max(0, familyConfidence - (runnerUpFamily?.score ?? 0));
  const structuredExactStyleOverride = resolveStructuredExactStyleOverride(signals);
  const trustedMlStyleOverride = resolveTrustedMlStyleOverride(signals, mlHint);
  const structuralFamilyGate = resolveStructuralFamilyGate(signals);
  const hasLeadingEnumerator = /^\s*(?:\[\d+\]|\d+[.)]|\(\d+\))\s+/u.test(rawCitation);
  const hasAmbiguousMixedEnumeratedFamilyConflict = hasAmbiguousEnumeratedMixedFamilyConflict(
    signals.normalizedText,
    signals.matchedSignals,
  );
  const suppressEnumeratedAuthorDateOverride =
    hasLeadingEnumerator &&
    structuredExactStyleOverride?.family === 'author_date' &&
    (familyScoring.conflictDampened || hasAmbiguousMixedEnumeratedFamilyConflict);
  const hasSafeVancouverNumericThesisOverride = hasVancouverEnumeratedThesisCommitProfile(
    signals.normalizedText,
    signals.matchedSignals,
  );

  if (hasSafeVancouverNumericThesisOverride) {
    const overrideStyleCandidates = scoreExactStyle(signals, 'numeric', mlHint);
    const gatedFamilyCandidates = upsertFamilyCandidateScore(sortedFamilyScores, 'numeric', 0.84);
    return {
      family: 'numeric',
      familyConfidence: Math.max(familyConfidence, 0.84),
      familyMarginToRunnerUp: Math.max(familyMarginToRunnerUp, 0.18),
      detectedStyle: 'vancouver',
      styleConfidence: Math.max(
        0.7,
        overrideStyleCandidates.find((candidate) => candidate.style === 'vancouver')?.score ?? 0,
      ),
      styleMarginToRunnerUp: Math.max(
        0.12,
        (overrideStyleCandidates.find((candidate) => candidate.style === 'vancouver')?.score ?? 0) -
          (overrideStyleCandidates.find((candidate) => candidate.style !== 'vancouver')?.score ??
            0),
      ),
      certaintyTier: resolveCertaintyTier(Math.max(familyConfidence, 0.84), 0.12, 'vancouver'),
      signalGroupCount: minimumSignalCount,
      familyCandidates: gatedFamilyCandidates,
      styleCandidates: overrideStyleCandidates.slice(0, 3),
      signals: [...signals.matchedSignals],
      conflictDampened: familyScoring.conflictDampened,
    };
  }

  if (familyScoring.conflictDampened && hasAmbiguousMixedEnumeratedFamilyConflict) {
    return {
      family: 'unknown',
      familyConfidence: capUnknownFamilyConfidence({
        familyConfidence,
        familyMarginToRunnerUp,
        minimumSignalCount,
        topFamilyKnown: topFamily?.family !== 'unknown',
      }),
      familyMarginToRunnerUp,
      detectedStyle: 'unknown',
      styleConfidence: 0,
      styleMarginToRunnerUp: 0,
      certaintyTier: 'low',
      signalGroupCount: minimumSignalCount,
      familyCandidates: sortedFamilyScores,
      styleCandidates: [],
      signals: [...signals.matchedSignals],
      conflictDampened: familyScoring.conflictDampened,
    };
  }

  if (
    structuredExactStyleOverride &&
    structuredExactStyleOverride.family === 'author_date' &&
    hasLeadingEnumerator &&
    !suppressEnumeratedAuthorDateOverride
  ) {
    const overrideStyleCandidates = scoreExactStyle(
      signals,
      structuredExactStyleOverride.family,
      mlHint,
    );
    return {
      family: structuredExactStyleOverride.family,
      familyConfidence: Math.max(familyConfidence, structuredExactStyleOverride.familyConfidence),
      familyMarginToRunnerUp: Math.max(
        familyMarginToRunnerUp,
        structuredExactStyleOverride.styleMarginToRunnerUp,
      ),
      detectedStyle: structuredExactStyleOverride.style,
      styleConfidence: structuredExactStyleOverride.styleConfidence,
      styleMarginToRunnerUp: structuredExactStyleOverride.styleMarginToRunnerUp,
      certaintyTier: resolveCertaintyTier(
        Math.max(familyConfidence, structuredExactStyleOverride.familyConfidence),
        structuredExactStyleOverride.styleMarginToRunnerUp,
        structuredExactStyleOverride.style,
      ),
      signalGroupCount: minimumSignalCount,
      familyCandidates: sortedFamilyScores,
      styleCandidates: overrideStyleCandidates.slice(0, 3),
      signals: [...signals.matchedSignals],
      conflictDampened: familyScoring.conflictDampened,
    };
  }

  if (
    structuredExactStyleOverride &&
    topFamily?.family === 'web_accessed' &&
    hasLeadingEnumerator
  ) {
    const overrideStyleCandidates = scoreExactStyle(
      signals,
      structuredExactStyleOverride.family,
      mlHint,
    );
    return {
      family: structuredExactStyleOverride.family,
      familyConfidence: Math.max(familyConfidence, structuredExactStyleOverride.familyConfidence),
      familyMarginToRunnerUp: Math.max(
        familyMarginToRunnerUp,
        structuredExactStyleOverride.styleMarginToRunnerUp,
      ),
      detectedStyle: structuredExactStyleOverride.style,
      styleConfidence: structuredExactStyleOverride.styleConfidence,
      styleMarginToRunnerUp: structuredExactStyleOverride.styleMarginToRunnerUp,
      certaintyTier: resolveCertaintyTier(
        Math.max(familyConfidence, structuredExactStyleOverride.familyConfidence),
        structuredExactStyleOverride.styleMarginToRunnerUp,
        structuredExactStyleOverride.style,
      ),
      signalGroupCount: minimumSignalCount,
      familyCandidates: sortedFamilyScores,
      styleCandidates: overrideStyleCandidates.slice(0, 3),
      signals: [...signals.matchedSignals],
      conflictDampened: familyScoring.conflictDampened,
    };
  }

  if (
    !topFamily ||
    topFamily.family === 'unknown' ||
    familyConfidence < STYLE_DETECTION_THRESHOLDS.familyCommitConfidence ||
    familyMarginToRunnerUp < STYLE_DETECTION_THRESHOLDS.familyCommitMargin ||
    minimumSignalCount < STYLE_DETECTION_THRESHOLDS.signalGroupMinimum
  ) {
    if (structuralFamilyGate) {
      const gatedFamilyCandidates = upsertFamilyCandidateScore(
        sortedFamilyScores,
        structuralFamilyGate.family,
        structuralFamilyGate.confidence,
      );
      const exactDecision = resolveExactStyleDecision({
        family: structuralFamilyGate.family,
        familyConfidence: structuralFamilyGate.confidence,
        signals,
        mlHint: mlHint ?? null,
        structuredExactStyleOverride:
          structuredExactStyleOverride?.family === structuralFamilyGate.family
            ? structuredExactStyleOverride
            : null,
      });

      return {
        family: structuralFamilyGate.family,
        familyConfidence: structuralFamilyGate.confidence,
        familyMarginToRunnerUp: structuralFamilyGate.marginToRunnerUp,
        detectedStyle: exactDecision.detectedStyle,
        styleConfidence: exactDecision.styleConfidence,
        styleMarginToRunnerUp: exactDecision.styleMarginToRunnerUp,
        certaintyTier: resolveCertaintyTier(
          structuralFamilyGate.confidence,
          exactDecision.styleMarginToRunnerUp,
          exactDecision.detectedStyle,
        ),
        signalGroupCount: minimumSignalCount,
        familyCandidates: gatedFamilyCandidates,
        styleCandidates: exactDecision.styleCandidates,
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }

    if (structuredExactStyleOverride && !suppressEnumeratedAuthorDateOverride) {
      const overrideStyleCandidates = scoreExactStyle(
        signals,
        structuredExactStyleOverride.family,
        mlHint,
      );
      return {
        family: structuredExactStyleOverride.family,
        familyConfidence: Math.max(familyConfidence, structuredExactStyleOverride.familyConfidence),
        familyMarginToRunnerUp: Math.max(
          familyMarginToRunnerUp,
          structuredExactStyleOverride.styleMarginToRunnerUp,
        ),
        detectedStyle: structuredExactStyleOverride.style,
        styleConfidence: structuredExactStyleOverride.styleConfidence,
        styleMarginToRunnerUp: structuredExactStyleOverride.styleMarginToRunnerUp,
        certaintyTier: resolveCertaintyTier(
          Math.max(familyConfidence, structuredExactStyleOverride.familyConfidence),
          structuredExactStyleOverride.styleMarginToRunnerUp,
          structuredExactStyleOverride.style,
        ),
        signalGroupCount: minimumSignalCount,
        familyCandidates: sortedFamilyScores,
        styleCandidates: overrideStyleCandidates.slice(0, 3),
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }

    if (trustedMlStyleOverride) {
      return {
        family: trustedMlStyleOverride.family,
        familyConfidence: Math.max(familyConfidence, trustedMlStyleOverride.familyConfidence),
        familyMarginToRunnerUp: Math.max(
          familyMarginToRunnerUp,
          trustedMlStyleOverride.styleMarginToRunnerUp,
        ),
        detectedStyle: trustedMlStyleOverride.style,
        styleConfidence: trustedMlStyleOverride.styleConfidence,
        styleMarginToRunnerUp: trustedMlStyleOverride.styleMarginToRunnerUp,
        certaintyTier: resolveCertaintyTier(
          Math.max(familyConfidence, trustedMlStyleOverride.familyConfidence),
          trustedMlStyleOverride.styleMarginToRunnerUp,
          trustedMlStyleOverride.style,
        ),
        signalGroupCount: minimumSignalCount,
        familyCandidates: sortedFamilyScores,
        styleCandidates: trustedMlStyleOverride.styleCandidates,
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }

    const degradedFamilyConfidence = capUnknownFamilyConfidence({
      familyConfidence,
      familyMarginToRunnerUp,
      minimumSignalCount,
      topFamilyKnown: topFamily?.family !== 'unknown',
    });

    return {
      family: 'unknown',
      familyConfidence: degradedFamilyConfidence,
      familyMarginToRunnerUp,
      detectedStyle: 'unknown',
      styleConfidence: 0,
      styleMarginToRunnerUp: 0,
      certaintyTier: 'low',
      signalGroupCount: minimumSignalCount,
      familyCandidates: sortedFamilyScores,
      styleCandidates: [],
      signals: [...signals.matchedSignals],
      conflictDampened: familyScoring.conflictDampened,
    };
  }

  if (topFamily.family === 'web_accessed') {
    if (shouldDowngradeSparseTruncatedWebReference(signals)) {
      return {
        family: 'unknown',
        familyConfidence: capUnknownFamilyConfidence({
          familyConfidence,
          familyMarginToRunnerUp,
          minimumSignalCount,
          topFamilyKnown: true,
        }),
        familyMarginToRunnerUp,
        detectedStyle: 'unknown',
        styleConfidence: 0,
        styleMarginToRunnerUp: 0,
        certaintyTier: 'low',
        signalGroupCount: minimumSignalCount,
        familyCandidates: sortedFamilyScores,
        styleCandidates: [],
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }

    if (structuralFamilyGate) {
      const gatedFamilyCandidates = upsertFamilyCandidateScore(
        sortedFamilyScores,
        structuralFamilyGate.family,
        structuralFamilyGate.confidence,
      );
      const familyAlignedStructuredOverride =
        structuredExactStyleOverride &&
        structuredExactStyleOverride.family === structuralFamilyGate.family
          ? structuredExactStyleOverride
          : null;
      const exactDecision = resolveExactStyleDecision({
        family: structuralFamilyGate.family,
        familyConfidence: structuralFamilyGate.confidence,
        signals,
        mlHint: mlHint ?? null,
        structuredExactStyleOverride: familyAlignedStructuredOverride,
      });

      return {
        family: structuralFamilyGate.family,
        familyConfidence: structuralFamilyGate.confidence,
        familyMarginToRunnerUp: structuralFamilyGate.marginToRunnerUp,
        detectedStyle: exactDecision.detectedStyle,
        styleConfidence: exactDecision.styleConfidence,
        styleMarginToRunnerUp: exactDecision.styleMarginToRunnerUp,
        certaintyTier: resolveCertaintyTier(
          structuralFamilyGate.confidence,
          exactDecision.styleMarginToRunnerUp,
          exactDecision.detectedStyle,
        ),
        signalGroupCount: minimumSignalCount,
        familyCandidates: gatedFamilyCandidates,
        styleCandidates: exactDecision.styleCandidates,
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }

    const hasExplicitWebAccessSignals =
      signals.matchedSignals.has('identifier_accessed_retrieved') ||
      signals.matchedSignals.has('web_url_without_scholarly_locators') ||
      signals.matchedSignals.has('cue_web_access');
    const shouldPreferHarvardTitleFirstOverride =
      structuredExactStyleOverride?.style === 'harvard-ctr' &&
      (hasHarvardTitleFirstAvailableAtProfile(signals.normalizedText) ||
        hasHarvardPatentAvailableAtProfile(signals.normalizedText));

    if (
      structuredExactStyleOverride &&
      (!hasExplicitWebAccessSignals || shouldPreferHarvardTitleFirstOverride)
    ) {
      const overrideStyleCandidates = scoreExactStyle(
        signals,
        structuredExactStyleOverride.family,
        mlHint,
      );
      return {
        family: structuredExactStyleOverride.family,
        familyConfidence: Math.max(familyConfidence, structuredExactStyleOverride.familyConfidence),
        familyMarginToRunnerUp: Math.max(
          familyMarginToRunnerUp,
          structuredExactStyleOverride.styleMarginToRunnerUp,
        ),
        detectedStyle: structuredExactStyleOverride.style,
        styleConfidence: structuredExactStyleOverride.styleConfidence,
        styleMarginToRunnerUp: structuredExactStyleOverride.styleMarginToRunnerUp,
        certaintyTier: resolveCertaintyTier(
          Math.max(familyConfidence, structuredExactStyleOverride.familyConfidence),
          structuredExactStyleOverride.styleMarginToRunnerUp,
          structuredExactStyleOverride.style,
        ),
        signalGroupCount: minimumSignalCount,
        familyCandidates: sortedFamilyScores,
        styleCandidates: overrideStyleCandidates.slice(0, 3),
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }

    if (trustedMlStyleOverride) {
      return {
        family: trustedMlStyleOverride.family,
        familyConfidence: Math.max(familyConfidence, trustedMlStyleOverride.familyConfidence),
        familyMarginToRunnerUp: Math.max(
          familyMarginToRunnerUp,
          trustedMlStyleOverride.styleMarginToRunnerUp,
        ),
        detectedStyle: trustedMlStyleOverride.style,
        styleConfidence: trustedMlStyleOverride.styleConfidence,
        styleMarginToRunnerUp: trustedMlStyleOverride.styleMarginToRunnerUp,
        certaintyTier: resolveCertaintyTier(
          Math.max(familyConfidence, trustedMlStyleOverride.familyConfidence),
          trustedMlStyleOverride.styleMarginToRunnerUp,
          trustedMlStyleOverride.style,
        ),
        signalGroupCount: minimumSignalCount,
        familyCandidates: sortedFamilyScores,
        styleCandidates: trustedMlStyleOverride.styleCandidates,
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }

    const fallbackStyle = resolveWebAccessedFallbackStyle(signals, mlHint);
    if (fallbackStyle) {
      return {
        family: fallbackStyle.family,
        familyConfidence,
        familyMarginToRunnerUp,
        detectedStyle: fallbackStyle.style,
        styleConfidence: fallbackStyle.styleConfidence,
        styleMarginToRunnerUp: fallbackStyle.styleMarginToRunnerUp,
        certaintyTier: resolveCertaintyTier(
          familyConfidence,
          fallbackStyle.styleMarginToRunnerUp,
          fallbackStyle.style,
        ),
        signalGroupCount: minimumSignalCount,
        familyCandidates: sortedFamilyScores,
        styleCandidates: fallbackStyle.styleCandidates,
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }

    return {
      family: 'web_accessed',
      familyConfidence,
      familyMarginToRunnerUp,
      detectedStyle: 'unknown',
      styleConfidence: 0,
      styleMarginToRunnerUp: 0,
      certaintyTier:
        familyConfidence >= STYLE_DETECTION_THRESHOLDS.webKnownMediumConfidence ? 'medium' : 'low',
      signalGroupCount: minimumSignalCount,
      familyCandidates: sortedFamilyScores,
      styleCandidates: [],
      signals: [...signals.matchedSignals],
      conflictDampened: familyScoring.conflictDampened,
    };
  }

  const committedFamily = topFamily.family as Exclude<StyleFamily, 'unknown' | 'web_accessed'>;
  const familyAlignedStructuredOverride =
    structuredExactStyleOverride && structuredExactStyleOverride.family === committedFamily
      ? structuredExactStyleOverride
      : null;
  const exactDecision = resolveExactStyleDecision({
    family: committedFamily,
    familyConfidence,
    signals,
    mlHint: mlHint ?? null,
    structuredExactStyleOverride: familyAlignedStructuredOverride,
  });

  if (structuralFamilyGate && structuralFamilyGate.family !== topFamily.family) {
    const gatedStructuredOverride =
      structuredExactStyleOverride &&
      structuredExactStyleOverride.family === structuralFamilyGate.family
        ? structuredExactStyleOverride
        : null;
    const gatedExactDecision = resolveExactStyleDecision({
      family: structuralFamilyGate.family,
      familyConfidence: structuralFamilyGate.confidence,
      signals,
      mlHint: mlHint ?? null,
      structuredExactStyleOverride: gatedStructuredOverride,
    });

    const shouldPreferGatedExactDecision =
      gatedExactDecision.detectedStyle !== 'unknown' &&
      (exactDecision.detectedStyle === 'unknown' ||
        (structuralFamilyGate.family === 'numeric' &&
          committedFamily !== 'numeric' &&
          hasVancouverPairwiseExactCommitProfile(signals)) ||
        (structuralFamilyGate.family === 'notes_bibliography' &&
          committedFamily !== 'notes_bibliography' &&
          (hasMlaPairwiseExactCommitProfile(signals) ||
            hasChicagoPairwiseExactCommitProfile(signals))) ||
        (structuralFamilyGate.family === 'author_date' &&
          committedFamily !== 'author_date' &&
          (hasApaPairwiseExactCommitProfile(signals) ||
            hasHarvardPairwiseExactCommitProfile(signals))));

    if (shouldPreferGatedExactDecision) {
      const gatedFamilyCandidates = upsertFamilyCandidateScore(
        sortedFamilyScores,
        structuralFamilyGate.family,
        structuralFamilyGate.confidence,
      );

      return {
        family: structuralFamilyGate.family,
        familyConfidence: structuralFamilyGate.confidence,
        familyMarginToRunnerUp: structuralFamilyGate.marginToRunnerUp,
        detectedStyle: gatedExactDecision.detectedStyle,
        styleConfidence: gatedExactDecision.styleConfidence,
        styleMarginToRunnerUp: gatedExactDecision.styleMarginToRunnerUp,
        certaintyTier: resolveCertaintyTier(
          structuralFamilyGate.confidence,
          gatedExactDecision.styleMarginToRunnerUp,
          gatedExactDecision.detectedStyle,
        ),
        signalGroupCount: minimumSignalCount,
        familyCandidates: gatedFamilyCandidates,
        styleCandidates: gatedExactDecision.styleCandidates,
        signals: [...signals.matchedSignals],
        conflictDampened: familyScoring.conflictDampened,
      };
    }
  }

  if (
    exactDecision.detectedStyle === 'unknown' &&
    trustedMlStyleOverride &&
    topFamily.family === trustedMlStyleOverride.family
  ) {
    return {
      family: trustedMlStyleOverride.family,
      familyConfidence,
      familyMarginToRunnerUp,
      detectedStyle: trustedMlStyleOverride.style,
      styleConfidence: trustedMlStyleOverride.styleConfidence,
      styleMarginToRunnerUp: trustedMlStyleOverride.styleMarginToRunnerUp,
      certaintyTier: resolveCertaintyTier(
        familyConfidence,
        trustedMlStyleOverride.styleMarginToRunnerUp,
        trustedMlStyleOverride.style,
      ),
      signalGroupCount: minimumSignalCount,
      familyCandidates: sortedFamilyScores,
      styleCandidates: trustedMlStyleOverride.styleCandidates,
      signals: [...signals.matchedSignals],
      conflictDampened: familyScoring.conflictDampened,
    };
  }

  return {
    family: topFamily.family,
    familyConfidence,
    familyMarginToRunnerUp,
    detectedStyle: exactDecision.detectedStyle,
    styleConfidence: exactDecision.styleConfidence,
    styleMarginToRunnerUp: exactDecision.styleMarginToRunnerUp,
    certaintyTier: resolveCertaintyTier(
      familyConfidence,
      exactDecision.styleMarginToRunnerUp,
      exactDecision.detectedStyle,
    ),
    signalGroupCount: minimumSignalCount,
    familyCandidates: sortedFamilyScores,
    styleCandidates: exactDecision.styleCandidates,
    signals: [...signals.matchedSignals],
    conflictDampened: familyScoring.conflictDampened,
  };
}

function resolveExactStyleDecision(input: {
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>;
  familyConfidence: number;
  signals: StyleSignalSet;
  mlHint?: StyleDetectionPrediction | null | undefined;
  structuredExactStyleOverride?: {
    family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>;
    style: CitationStyle;
    familyConfidence: number;
    styleConfidence: number;
    styleMarginToRunnerUp: number;
  } | null;
}): {
  detectedStyle: CitationStyle;
  styleConfidence: number;
  styleMarginToRunnerUp: number;
  styleCandidates: StyleCandidateScore[];
} {
  const styleCandidates = scoreExactStyle(input.signals, input.family, input.mlHint);
  const topStyle = styleCandidates[0];
  const runnerUpStyle = styleCandidates[1];
  const styleConfidence = topStyle?.score ?? 0;
  const styleMarginToRunnerUp = Math.max(0, styleConfidence - (runnerUpStyle?.score ?? 0));
  if (hasSparseMinimalVancouverStyleOverride(input.family, topStyle?.style, input.signals)) {
    return {
      detectedStyle: 'unknown',
      styleConfidence: 0,
      styleMarginToRunnerUp: 0,
      styleCandidates: styleCandidates.slice(0, 3),
    };
  }
  const hasChicagoPreferredNotesCommit =
    input.family === 'notes_bibliography' &&
    hasChicagoPreferredNotesCommitProfile(
      input.signals.normalizedText,
      input.signals.matchedSignals,
    );
  const commitExactStyle = canCommitExactStyle({
    family: input.family,
    style: topStyle?.style ?? 'unknown',
    familyConfidence: input.familyConfidence,
    styleConfidence,
    styleMarginToRunnerUp,
    signals: input.signals,
  });
  const strongNotesConflictOverride =
    input.family === 'notes_bibliography' &&
    topStyle?.style === 'chicago-notes-bib' &&
    !hasChicagoNotesBookSpine(input.signals.normalizedText) &&
    !hasChicagoNotesJournalSpine(input.signals.normalizedText) &&
    !hasChicagoNotesContainerSpine(input.signals.normalizedText) &&
    !hasChicagoNotesConferenceCommitProfile(input.signals.normalizedText) &&
    !hasChicagoQuotedContainerYearPagesCommitProfile(input.signals.normalizedText) &&
    !hasChicagoSparseQuotedYearPagesCommitProfile(input.signals.normalizedText) &&
    !hasChicagoPreferredNotesCommit &&
    (hasMlaPublisherCommaYearIdentifierProfile(input.signals.normalizedText) ||
      hasMlaQuotedRepositoryIdentifierCommitProfile(input.signals.normalizedText) ||
      hasMlaThesisIdentifierCommitProfile(input.signals.normalizedText) ||
      hasMlaQuotedTailCommitProfile(input.signals.normalizedText) ||
      hasMlaPreprintCommitProfile(input.signals.normalizedText))
      ? {
          style: 'mla9' as const,
          styleConfidence: Math.max(0.72, styleConfidence),
          styleMarginToRunnerUp: Math.max(0.16, styleMarginToRunnerUp),
        }
      : null;
  if (input.structuredExactStyleOverride && !strongNotesConflictOverride) {
    return {
      detectedStyle: input.structuredExactStyleOverride.style,
      styleConfidence: Math.max(
        input.structuredExactStyleOverride.styleConfidence,
        input.structuredExactStyleOverride.style === topStyle?.style ? styleConfidence : 0,
      ),
      styleMarginToRunnerUp: Math.max(
        input.structuredExactStyleOverride.styleMarginToRunnerUp,
        input.structuredExactStyleOverride.style === topStyle?.style ? styleMarginToRunnerUp : 0,
      ),
      styleCandidates: upsertStyleCandidateScore(
        styleCandidates,
        input.structuredExactStyleOverride.style,
        Math.max(
          input.structuredExactStyleOverride.styleConfidence,
          input.structuredExactStyleOverride.style === topStyle?.style ? styleConfidence : 0,
        ),
      ),
    };
  }
  const pairwiseOverride = !commitExactStyle
    ? resolveFamilyScopedExactStyleOverride(input.family, input.signals)
    : null;
  const ieeeQuotedInstitutionOverride =
    !commitExactStyle &&
    input.family === 'numeric' &&
    topStyle?.style === 'ieee' &&
    hasIeeeQuotedInstitutionalReportCommitProfile(
      input.signals.normalizedText,
      input.signals.matchedSignals,
    )
      ? {
          style: 'ieee' as const,
          styleConfidence: Math.max(styleConfidence, 0.68),
          styleMarginToRunnerUp: Math.max(styleMarginToRunnerUp, 0.08),
        }
      : null;
  const familyAlignedOverride =
    strongNotesConflictOverride ??
    (!commitExactStyle ? (pairwiseOverride ?? ieeeQuotedInstitutionOverride) : null);
  const canForceDominantStyleCommit = canForceDominantExactStyleCommit(
    topStyle?.style,
    input.signals,
  );
  const forceDominantStyleCommit =
    !commitExactStyle &&
    !familyAlignedOverride &&
    topStyle != null &&
    topStyle.style !== 'unknown' &&
    canForceDominantStyleCommit &&
    styleConfidence >= 0.85 &&
    styleMarginToRunnerUp >= 0.45;
  const detectedStyle = strongNotesConflictOverride
    ? strongNotesConflictOverride.style
    : commitExactStyle
      ? (topStyle?.style ?? 'unknown')
      : (familyAlignedOverride?.style ??
        (forceDominantStyleCommit ? (topStyle?.style ?? 'unknown') : 'unknown'));
  const effectiveStyleConfidence = strongNotesConflictOverride
    ? strongNotesConflictOverride.styleConfidence
    : commitExactStyle
      ? styleConfidence
      : (familyAlignedOverride?.styleConfidence ??
        (forceDominantStyleCommit ? styleConfidence : 0));
  const effectiveStyleMargin = strongNotesConflictOverride
    ? strongNotesConflictOverride.styleMarginToRunnerUp
    : commitExactStyle
      ? styleMarginToRunnerUp
      : (familyAlignedOverride?.styleMarginToRunnerUp ??
        (forceDominantStyleCommit ? styleMarginToRunnerUp : 0));

  return {
    detectedStyle,
    styleConfidence: effectiveStyleConfidence,
    styleMarginToRunnerUp: effectiveStyleMargin,
    styleCandidates:
      strongNotesConflictOverride != null
        ? upsertStyleCandidateScore(
            styleCandidates,
            strongNotesConflictOverride.style,
            strongNotesConflictOverride.styleConfidence,
          )
        : familyAlignedOverride != null
          ? upsertStyleCandidateScore(
              styleCandidates,
              familyAlignedOverride.style,
              familyAlignedOverride.styleConfidence,
            )
          : styleCandidates.slice(0, 3),
  };
}

function applyBatchSmoothing(decisions: StyleDecision[]): StyleDetectionResult[] {
  const multiStyle = detectMultiStyle(decisions);
  let smoothed = decisions;

  if (decisions.length >= 5 && !multiStyle) {
    smoothed = smoothFamilyConfidence(decisions);
    smoothed = smoothExactStyles(smoothed);
  }

  return applyMultiStyleFlag(smoothed, multiStyle);
}

function applyMultiStyleFlag(
  decisions: StyleDecision[],
  multiStyle: boolean,
): StyleDetectionResult[] {
  return decisions.map((decision) => {
    const primaryConfidence =
      decision.detectedStyle !== 'unknown' ? decision.styleConfidence : decision.familyConfidence;
    const secondary = decision.styleCandidates[1]
      ? {
          style: decision.styleCandidates[1].style,
          confidence: decision.styleCandidates[1].score,
        }
      : null;

    return {
      primary: {
        style: decision.detectedStyle,
        confidence: primaryConfidence,
      },
      secondary,
      family: decision.family,
      familyConfidence: decision.familyConfidence,
      styleConfidence: decision.styleConfidence,
      familyMarginToRunnerUp: decision.familyMarginToRunnerUp,
      styleMarginToRunnerUp: decision.styleMarginToRunnerUp,
      certaintyTier: decision.certaintyTier,
      familyCandidates: decision.familyCandidates,
      styleCandidates: decision.styleCandidates,
      signals: decision.signals,
      conflictDampened: decision.conflictDampened,
      isUnknown: decision.family === 'unknown',
      isMultiStyle: multiStyle,
    };
  });
}

function promoteDominantExactStyle(
  rawCitation: string,
  result: StyleDetectionResult,
): StyleDetectionResult {
  const signals = extractStyleSignals(rawCitation);
  const normalizedText = signals.normalizedText;
  const matchedSignals = signals.matchedSignals;

  if (
    result.family === 'numeric' &&
    result.primary.style === 'ieee' &&
    !hasIeeeBookSpine(normalizedText, matchedSignals) &&
    !hasRelaxedIeeeBookCommitProfile(normalizedText, matchedSignals) &&
    !hasIeeeEnumeratedBookDoiCommitProfile(normalizedText, matchedSignals) &&
    (hasVancouverConferencePagesCommitProfile(normalizedText, matchedSignals) ||
      hasVancouverEnumeratedSemicolonMonographCommitProfile(normalizedText, matchedSignals) ||
      hasVancouverEnumeratedThesisCommitProfile(normalizedText, matchedSignals) ||
      hasVancouverEnumeratedSemicolonIdentifierCommitProfile(normalizedText, matchedSignals) ||
      hasVancouverEnumeratedBareYearIdentifierCommitProfile(normalizedText, matchedSignals) ||
      hasVancouverEnumeratedQuotedPreprintCommitProfile(normalizedText, matchedSignals))
  ) {
    return {
      ...result,
      primary: {
        style: 'vancouver',
        confidence: Math.max(0.84, result.styleConfidence),
      },
      styleConfidence: Math.max(0.84, result.styleConfidence),
      styleMarginToRunnerUp: Math.max(0.18, result.styleMarginToRunnerUp),
      certaintyTier: resolveCertaintyTier(
        result.familyConfidence,
        Math.max(0.18, result.styleMarginToRunnerUp),
        'vancouver',
      ),
    };
  }

  if (result.primary.style !== 'unknown') {
    return result;
  }

  const topStyle = result.styleCandidates[0];
  if (!topStyle || topStyle.style === 'unknown') {
    return result;
  }

  const runnerUp = result.styleCandidates[1];
  const styleMarginToRunnerUp = Math.max(0, topStyle.score - (runnerUp?.score ?? 0));
  if (topStyle.score < 0.82 || styleMarginToRunnerUp < 0.35) {
    return result;
  }

  let promotedStyle: CitationStyle | null = null;
  let promotedFamily: StyleFamily | null = null;

  if (hasHarvardPatentAvailableAtProfile(normalizedText)) {
    promotedStyle = 'harvard-ctr';
    promotedFamily = 'author_date';
  } else if (hasChicagoPatentIssuedCommitProfile(normalizedText)) {
    promotedStyle = 'chicago-notes-bib';
    promotedFamily = 'notes_bibliography';
  }

  if (!promotedStyle && result.family === 'author_date') {
    if (topStyle.style === 'harvard-ctr' && hasHarvardPairwiseExactCommitProfile(signals)) {
      promotedStyle = 'harvard-ctr';
    } else if (topStyle.style === 'apa7' && hasApaPairwiseExactCommitProfile(signals)) {
      promotedStyle = 'apa7';
    } else if (
      topStyle.style === 'apa7' &&
      topStyle.score >= 0.98 &&
      (matchedSignals.has('year_parenthesized_after_authors') ||
        hasFrontParenthesizedYearLead(normalizedText)) &&
      matchedSignals.has('identifier_doi') &&
      !/\bAvailable at:/iu.test(normalizedText) &&
      (matchedSignals.has('cue_book_publisher') ||
        matchedSignals.has('cue_journal') ||
        matchedSignals.has('cue_conference'))
    ) {
      promotedStyle = 'apa7';
    }
  }

  if (!promotedStyle && result.family === 'numeric') {
    if (topStyle.style === 'vancouver' && hasVancouverPairwiseExactCommitProfile(signals)) {
      promotedStyle = 'vancouver';
    } else if (topStyle.style === 'ieee' && hasIeeePairwiseExactCommitProfile(signals)) {
      promotedStyle = 'ieee';
    }
  }

  if (!promotedStyle && result.family === 'notes_bibliography') {
    if (topStyle.style === 'mla9' && hasMlaPairwiseExactCommitProfile(signals)) {
      promotedStyle = 'mla9';
    } else if (
      topStyle.style === 'chicago-notes-bib' &&
      hasChicagoPairwiseExactCommitProfile(signals)
    ) {
      promotedStyle = 'chicago-notes-bib';
    }
  }

  if (!promotedStyle) {
    return result;
  }

  return {
    ...result,
    family: promotedFamily ?? result.family,
    primary: {
      style: promotedStyle,
      confidence: topStyle.score,
    },
    styleConfidence: topStyle.score,
    styleMarginToRunnerUp,
    certaintyTier: resolveCertaintyTier(
      result.familyConfidence,
      styleMarginToRunnerUp,
      promotedStyle,
    ),
  };
}

function smoothFamilyConfidence(decisions: StyleDecision[]): StyleDecision[] {
  const knownFamilies = decisions.filter(
    (decision) =>
      decision.family !== 'unknown' &&
      decision.familyConfidence >= STYLE_DETECTION_THRESHOLDS.familyCommitConfidence &&
      decision.signalGroupCount >= STYLE_DETECTION_THRESHOLDS.signalGroupMinimum,
  );
  if (knownFamilies.length === 0) {
    return decisions;
  }

  const dominant = dominantBucket(knownFamilies.map((decision) => decision.family));
  if (
    !dominant ||
    dominant.share < STYLE_DETECTION_THRESHOLDS.familySmoothingDominantShare ||
    dominant.value === 'unknown'
  ) {
    return decisions;
  }

  return decisions.map((decision) => {
    if (
      decision.family !== dominant.value ||
      decision.certaintyTier === 'high' ||
      decision.familyConfidence < STYLE_DETECTION_THRESHOLDS.familyCommitConfidence ||
      decision.signalGroupCount < STYLE_DETECTION_THRESHOLDS.signalGroupMinimum
    ) {
      return decision;
    }

    return {
      ...decision,
      familyConfidence: Math.min(
        STYLE_DETECTION_THRESHOLDS.familySmoothingCap,
        decision.familyConfidence + STYLE_DETECTION_THRESHOLDS.familySmoothingBoost,
      ),
    };
  });
}

function smoothExactStyles(decisions: StyleDecision[]): StyleDecision[] {
  const exactKnown = decisions.filter((decision) => decision.detectedStyle !== 'unknown');
  const dominant = dominantBucket(exactKnown.map((decision) => decision.detectedStyle));
  if (
    !dominant ||
    dominant.share < STYLE_DETECTION_THRESHOLDS.exactSmoothingDominantShare ||
    dominant.value === 'unknown' ||
    dominant.value === 'auto'
  ) {
    return decisions;
  }

  const dominantFamily = styleFamilyForStyle(dominant.value);

  return decisions.map((decision) => {
    if (
      decision.certaintyTier === 'high' ||
      decision.detectedStyle !== 'unknown' ||
      decision.family !== dominantFamily ||
      decision.familyConfidence < STYLE_DETECTION_THRESHOLDS.familyCommitConfidence ||
      decision.signalGroupCount < STYLE_DETECTION_THRESHOLDS.signalGroupMinimum
    ) {
      return decision;
    }

    const dominantCandidate = decision.styleCandidates.find(
      (candidate) => candidate.style === dominant.value,
    );
    const leadingCandidate = decision.styleCandidates[0];
    if (!dominantCandidate || !leadingCandidate) {
      return decision;
    }

    if (
      leadingCandidate.score - dominantCandidate.score >
        STYLE_DETECTION_THRESHOLDS.exactSmoothingLeadingMarginTolerance ||
      dominantCandidate.score < STYLE_DETECTION_THRESHOLDS.exactSmoothingCandidateFloor
    ) {
      return decision;
    }

    const runnerUpScore =
      decision.styleCandidates
        .filter((candidate) => candidate.style !== dominant.value)
        .map((candidate) => candidate.score)
        .sort((left, right) => right - left)[0] ?? 0;

    return {
      ...decision,
      detectedStyle: dominant.value,
      styleConfidence: dominantCandidate.score,
      styleMarginToRunnerUp: Math.max(
        STYLE_DETECTION_THRESHOLDS.exactCommitStyleMargin,
        dominantCandidate.score - runnerUpScore,
      ),
      certaintyTier: resolveCertaintyTier(
        decision.familyConfidence,
        Math.max(
          STYLE_DETECTION_THRESHOLDS.exactCommitStyleMargin,
          dominantCandidate.score - runnerUpScore,
        ),
        dominant.value,
      ),
    };
  });
}

function detectMultiStyle(decisions: StyleDecision[]): boolean {
  const exactStyles = decisions
    .map((decision) => decision.detectedStyle)
    .filter((style) => style !== 'unknown' && style !== 'auto');
  const exactEntropy = normalizedEntropy(exactStyles);
  if (exactEntropy > 0.7) {
    return true;
  }

  if (exactStyles.length >= 2) {
    return false;
  }

  const families = decisions
    .map((decision) => decision.family)
    .filter((family) => family !== 'unknown');
  return normalizedEntropy(families) > 0.7;
}

function normalizedEntropy(values: string[]): number {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  if (counts.size <= 1) {
    return 0;
  }

  const total = values.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / total;
    entropy -= probability * Math.log2(probability);
  }

  return entropy / Math.log2(counts.size);
}

function dominantBucket<T extends string>(values: T[]): { value: T; share: number } | null {
  if (values.length === 0) {
    return null;
  }

  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }

  return best ? { value: best, share: bestCount / values.length } : null;
}

function resolveCertaintyTier(
  familyConfidence: number,
  styleMarginToRunnerUp: number,
  detectedStyle: CitationStyle,
): StyleCertaintyTier {
  if (
    detectedStyle !== 'unknown' &&
    familyConfidence >= STYLE_DETECTION_THRESHOLDS.certaintyHighFamilyConfidence &&
    styleMarginToRunnerUp >= STYLE_DETECTION_THRESHOLDS.certaintyHighStyleMargin
  ) {
    return 'high';
  }
  if (
    detectedStyle !== 'unknown' &&
    familyConfidence >= STYLE_DETECTION_THRESHOLDS.exactCommitFamilyConfidence &&
    styleMarginToRunnerUp >= STYLE_DETECTION_THRESHOLDS.exactCommitStyleMargin
  ) {
    return 'medium';
  }
  return 'low';
}

function canCommitExactStyle(input: {
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>;
  style: CitationStyle;
  familyConfidence: number;
  styleConfidence: number;
  styleMarginToRunnerUp: number;
  signals: StyleSignalSet;
}): boolean {
  if (
    input.family === 'author_date' &&
    input.style === 'apa7' &&
    hasApaPairwiseExactCommitProfile(input.signals)
  ) {
    if (
      input.familyConfidence >= 0.72 &&
      input.styleConfidence >= 0.52 &&
      input.styleMarginToRunnerUp >= 0.02
    ) {
      return true;
    }
  }

  if (
    input.family === 'author_date' &&
    input.style === 'harvard-ctr' &&
    hasHarvardPairwiseExactCommitProfile(input.signals)
  ) {
    if (
      input.familyConfidence >= 0.72 &&
      input.styleConfidence >= 0.52 &&
      input.styleMarginToRunnerUp >= 0.02
    ) {
      return true;
    }
  }

  if (
    input.family === 'numeric' &&
    input.style === 'ieee' &&
    hasIeeePairwiseExactCommitProfile(input.signals)
  ) {
    if (
      input.familyConfidence >= 0.72 &&
      input.styleConfidence >= 0.52 &&
      input.styleMarginToRunnerUp >= 0.04
    ) {
      return true;
    }
  }

  if (
    input.family === 'numeric' &&
    input.style === 'vancouver' &&
    hasVancouverPairwiseExactCommitProfile(input.signals)
  ) {
    if (
      input.familyConfidence >= 0.72 &&
      input.styleConfidence >= 0.52 &&
      input.styleMarginToRunnerUp >= 0.04
    ) {
      return true;
    }
  }

  if (
    input.family === 'author_date' &&
    input.style === 'apa7' &&
    hasApaLooseJournalCommitProfile(input.signals.normalizedText, input.signals.matchedSignals)
  ) {
    if (
      input.familyConfidence >= 0.8 &&
      input.styleConfidence >= 0.6 &&
      input.styleMarginToRunnerUp >= 0.08
    ) {
      return true;
    }
  }

  if (
    input.family === 'notes_bibliography' &&
    input.style === 'mla9' &&
    hasMlaPairwiseExactCommitProfile(input.signals)
  ) {
    if (
      input.familyConfidence >= 0.72 &&
      input.styleConfidence >= 0.52 &&
      input.styleMarginToRunnerUp >= 0.04
    ) {
      return true;
    }
  }

  if (
    input.family === 'notes_bibliography' &&
    input.style === 'chicago-notes-bib' &&
    hasChicagoPairwiseExactCommitProfile(input.signals)
  ) {
    if (
      input.familyConfidence >= 0.72 &&
      input.styleConfidence >= 0.52 &&
      input.styleMarginToRunnerUp >= 0.04
    ) {
      return true;
    }
  }

  if (
    input.familyConfidence < STYLE_DETECTION_THRESHOLDS.exactCommitFamilyConfidence ||
    input.styleConfidence < STYLE_DETECTION_THRESHOLDS.exactCommitStyleConfidence ||
    input.styleMarginToRunnerUp < STYLE_DETECTION_THRESHOLDS.exactCommitStyleMargin
  ) {
    return false;
  }

  if (input.style === 'unknown' || input.style === 'auto') {
    return false;
  }

  switch (input.family) {
    case 'numeric':
      return canCommitNumericStyle(input.style, input.signals);
    case 'author_date':
      return canCommitAuthorDateStyle(input.style, input.signals);
    case 'notes_bibliography':
      return canCommitNotesBibliographyStyle(input.style, input.signals);
  }
}

function canCommitNumericStyle(style: CitationStyle, signals: StyleSignalSet): boolean {
  const matched = signals.matchedSignals;
  const text = signals.normalizedText;
  const backbone = stripTrailingIdentifierTail(text);

  if (style === 'ieee') {
    if (
      hasVancouverEnumeratedSemicolonMonographCommitProfile(text, matched) ||
      hasVancouverEnumeratedThesisCommitProfile(text, matched) ||
      hasVancouverEnumeratedSemicolonIdentifierCommitProfile(text, matched) ||
      hasVancouverEnumeratedQuotedPreprintCommitProfile(text, matched)
    ) {
      return false;
    }

    return (
      hasIeeeBookSpine(text, matched) ||
      hasRelaxedIeeeBookCommitProfile(text, matched) ||
      hasIeeeEnumeratedCommaYearDoiCommitProfile(text, matched) ||
      hasIeeeEnumeratedBookDoiCommitProfile(text, matched) ||
      hasIeeeQuotedInstitutionalReportCommitProfile(text, matched) ||
      hasIeeeOnlineReferenceCommitProfile(text, matched) ||
      hasStrongIeeeEnumeratedJournalSpine(text, matched) ||
      matched.has('locator_ieee_signature') ||
      (matched.has('quoted_title') &&
        matched.has('locator_vol') &&
        matched.has('locator_no') &&
        matched.has('locator_pp') &&
        matched.has('year_end_position'))
    );
  }

  if (style === 'vancouver') {
    if (
      hasStrongCanonicalVancouverJournalSpine(backbone) ||
      (hasMinimalVancouverJournalSpine(backbone) &&
        !hasSparseMinimalVancouverJournalSpine(backbone)) ||
      (matched.has('locator_semicolon_volume_issue_pages') &&
        matched.has('bracketed_enumerator') &&
        matched.has('cue_journal')) ||
      hasVancouverPlainSemicolonJournalSpine(backbone, matched) ||
      hasRelaxedVancouverCommitProfile(text, matched) ||
      hasVancouverEnumeratedSemicolonMonographCommitProfile(text, matched)
    ) {
      return true;
    }

    if (matched.has('ieee_incompatible_author_date_year_placement')) {
      return false;
    }

    return (
      hasBiomedicalVancouverCommitSignals(text, matched) ||
      hasVancouverConferencePublisherSpine(text, matched) ||
      hasVancouverEnumeratedInstitutionTailCommitProfile(text, matched) ||
      hasVancouverEnumeratedSemicolonMonographCommitProfile(text, matched) ||
      hasVancouverEnumeratedThesisCommitProfile(text, matched) ||
      hasVancouverEnumeratedSemicolonIdentifierCommitProfile(text, matched) ||
      hasVancouverEnumeratedBareYearIdentifierCommitProfile(text, matched) ||
      hasVancouverEnumeratedQuotedPreprintCommitProfile(text, matched) ||
      matched.has('year_repeated_conference')
    );
  }

  if (style === 'ama') {
    return (
      (matched.has('cue_in_container') && /\bIEEE\.?\s*$/iu.test(text)) ||
      (matched.has('author_surname_initials') &&
        matched.has('locator_vol') &&
        !matched.has('locator_semicolon_volume_issue_pages'))
    );
  }

  if (style === 'acs') {
    return matched.has('identifier_doi') && matched.has('locator_vol');
  }

  return false;
}

function canCommitAuthorDateStyle(style: CitationStyle, signals: StyleSignalSet): boolean {
  const matched = signals.matchedSignals;
  const text = signals.normalizedText;
  const backbone = stripTrailingIdentifierTail(text);
  const hasAmbiguousLead = matched.has('author_lead_ambiguous');
  const hasApaParenthesizedPunctuation =
    /\(\d{4}[a-z]?\)\.\s+/u.test(text) &&
    /,\s*(?:\d+|\?)(?:\((?:[^)]+|\?)\))?,\s*(?:pp?\.?\s*)?[A-Za-z]?\d/u.test(text);
  const hasApaBareYearPunctuation =
    /^[^"]{0,160},\s*\d{4}[a-z]?\.\s+/u.test(text) &&
    /,\s*(?:\d+|\?)(?:\((?:[^)]+|\?)\))?,\s*(?:pp?\.?\s*)?[A-Za-z]?\d/u.test(text);
  const hasApaIssueOnlyJournalSpine =
    matched.has('year_parenthesized_after_authors') &&
    !matched.has('quoted_title') &&
    (/,\s*(?:\d+|\?)(?:\((?:[^)]+|\?)\))(?:,\s*(?:pp?\.?\s*)?[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$/u.test(
      backbone,
    ) ||
      /,\s*(?:\d+|\?)\.?$/u.test(backbone));
  const hasApaLooseJournalProfile = hasApaLooseJournalCommitProfile(text, matched);
  const hasHarvardCtrProfile =
    (matched.has('year_parenthesized_after_authors') &&
      (matched.has('quoted_title') ||
        matched.has('cue_journal') ||
        matched.has('cue_book_publisher') ||
        matched.has('locator_pp') ||
        /\bAvailable at:/iu.test(text))) ||
    (matched.has('year_bare_after_authors') && !matched.has('year_parenthesized_after_authors'));

  if (style === 'apa7') {
    return (
      (!hasAmbiguousLead &&
        (hasApaParenthesizedPunctuation ||
          hasApaBareYearPunctuation ||
          hasApaIssueOnlyJournalSpine ||
          hasApaLooseJournalProfile ||
          hasApaFrontYearIdentifierCommitProfile(text, matched) ||
          hasApaFrontYearBookIdentifierCommitProfile(text, matched) ||
          hasApaCorporateMonographIdentifierCommitProfile(text, matched) ||
          hasApaPageOnlyJournalCommitProfile(text, matched) ||
          hasApaSparseContainerCommitProfile(text, matched) ||
          hasApaThesisBracketedCommitProfile(text, matched) ||
          hasApaLongAuthorLeadCommitProfile(text, matched))) ||
      hasApaConferenceCommitProfile(text, matched) ||
      hasApaBookCommitProfile(text, matched) ||
      hasApaJournalCommitProfile(text, matched)
    );
  }

  if (style === 'harvard-ctr') {
    return (
      hasHarvardCtrProfile ||
      hasHarvardBareYearJournalCommitProfile(text, matched) ||
      hasQuotedHarvardAvailableAtProfile(text, matched) ||
      hasHarvardPatentAvailableAtProfile(text) ||
      hasHarvardAvailableAtJournalCommitProfile(text, matched) ||
      hasHarvardAvailableAtBookCommitProfile(text, matched) ||
      hasHarvardCorporateReportCommitProfile(text, matched)
    );
  }

  if (style === 'chicago-author-date') {
    return /^[A-Z][\p{L}'-]+,\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)*\.\s+\d{4}\./u.test(text);
  }

  return false;
}

function hasExplicitAuthorDateLeadPunctuation(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (
    matchedSignals.has('author_separator_ampersand') ||
    matchedSignals.has('author_separator_semicolon') ||
    matchedSignals.has('author_separator_comma')
  ) {
    return true;
  }

  return (
    /^[^"]{0,180},\s*[\p{L}\p{N}]/u.test(text) ||
    /^[^"]{0,180}\.\s*\((?:19|20)\d{2}[a-z]?\)/u.test(text)
  );
}

function canForceDominantExactStyleCommit(
  style: CitationStyle | undefined,
  signals: StyleSignalSet,
): boolean {
  if (!style || style === 'unknown' || style === 'auto') {
    return false;
  }

  const text = signals.normalizedText;
  const matched = signals.matchedSignals;
  const stripped = stripTrailingIdentifierTail(text);

  switch (style) {
    case 'apa7':
      return (
        (hasExplicitAuthorDateLeadPunctuation(text, matched) &&
          (hasApaLooseJournalCommitProfile(text, matched) ||
            hasApaBareYearJournalCommitProfile(text, matched) ||
            hasApaPageOnlyJournalCommitProfile(text, matched) ||
            hasApaJournalCommitProfile(text, matched) ||
            hasApaSparseContainerCommitProfile(text, matched) ||
            hasApaThesisBracketedCommitProfile(text, matched) ||
            hasApaLongAuthorLeadCommitProfile(text, matched) ||
            hasApaFrontYearIdentifierCommitProfile(text, matched) ||
            hasApaFrontYearBookIdentifierCommitProfile(text, matched) ||
            hasApaCorporateMonographIdentifierCommitProfile(text, matched))) ||
        hasApaConferenceCommitProfile(text, matched) ||
        hasApaBookCommitProfile(text, matched)
      );
    case 'harvard-ctr':
      return (
        hasRelaxedHarvardCtrCommitProfile(signals) ||
        hasHarvardBareYearJournalCommitProfile(text, matched) ||
        hasQuotedHarvardAvailableAtProfile(text, matched) ||
        hasHarvardPatentAvailableAtProfile(text) ||
        hasHarvardAvailableAtJournalCommitProfile(text, matched) ||
        hasHarvardAvailableAtBookCommitProfile(text, matched) ||
        hasHarvardCorporateReportCommitProfile(text, matched)
      );
    case 'vancouver':
      return (
        hasStrongCanonicalVancouverJournalSpine(stripped) ||
        (hasMinimalVancouverJournalSpine(stripped) &&
          !hasSparseMinimalVancouverJournalSpine(stripped)) ||
        hasRelaxedVancouverCommitProfile(text, matched) ||
        hasVancouverEnumeratedInstitutionTailCommitProfile(text, matched) ||
        hasVancouverEnumeratedSemicolonMonographCommitProfile(text, matched) ||
        hasVancouverEnumeratedSemicolonIdentifierCommitProfile(text, matched) ||
        hasVancouverEnumeratedBareYearIdentifierCommitProfile(text, matched) ||
        hasVancouverEnumeratedQuotedPreprintCommitProfile(text, matched)
      );
    case 'ieee':
      return (
        hasIeeeBookSpine(text, matched) ||
        hasRelaxedIeeeBookCommitProfile(text, matched) ||
        hasIeeeEnumeratedCommaYearDoiCommitProfile(text, matched) ||
        hasIeeeEnumeratedBookDoiCommitProfile(text, matched) ||
        hasIeeeQuotedInstitutionalReportCommitProfile(text, matched) ||
        hasIeeeOnlineReferenceCommitProfile(text, matched) ||
        matched.has('locator_ieee_signature')
      );
    default:
      return false;
  }
}

function canCommitNotesBibliographyStyle(style: CitationStyle, signals: StyleSignalSet): boolean {
  const text = signals.normalizedText;
  const matched = signals.matchedSignals;

  if (style === 'mla9') {
    return (
      hasMlaWorksCitedJournalSpine(text) ||
      hasMlaWorksCitedJournalNoPagesSpine(text) ||
      hasMlaWorksCitedBookSpine(text) ||
      hasMlaWorksCitedBookUrlTailProfile(text) ||
      hasMlaPublisherCommaYearIdentifierProfile(text) ||
      hasMlaQuotedRepositoryIdentifierCommitProfile(text) ||
      hasMlaConferenceCommitProfile(text) ||
      hasMlaQuotedYearContainerCommitProfile(text) ||
      hasMlaQuotedTailCommitProfile(text) ||
      hasMlaPreprintCommitProfile(text) ||
      hasMlaThesisIdentifierCommitProfile(text)
    );
  }

  if (style === 'chicago-notes-bib') {
    return (
      hasChicagoNotesJournalSpine(text) ||
      hasChicagoNotesJournalNoPagesSpine(text) ||
      hasChicagoNotesBookSpine(text) ||
      hasChicagoNotesContainerSpine(text) ||
      hasChicagoNotesConferenceCommitProfile(text) ||
      hasChicagoSparseQuotedYearPagesCommitProfile(text) ||
      (matched.has('quoted_title') &&
        matched.has('cue_in_container') &&
        matched.has('cue_book_publisher')) ||
      hasChicagoQuotedTailCommitProfile(text) ||
      hasChicagoThesisCommitProfile(text) ||
      hasChicagoPreprintCommitProfile(text) ||
      hasChicagoWebpageCommitProfile(text)
    );
  }

  return false;
}

function hasApaJournalCommitProfile(text: string, matchedSignals: Set<StyleSignalCode>): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  return (
    matchedSignals.has('year_parenthesized_after_authors') &&
    matchedSignals.has('cue_journal') &&
    !matchedSignals.has('quoted_title') &&
    (matchedSignals.has('locator_volume_issue_pages') ||
      matchedSignals.has('locator_page_range_only')) &&
    /\(\d{4}[a-z]?\)\.\s+[^.]{4,220}\.\s+.+?,\s*(?:\d+|\?)(?:\((?:[^)]+|\?)\))?(?:,\s*(?:pp?\.?\s*)?[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$/u.test(
      backbone,
    )
  );
}

function hasHarvardAvailableAtJournalCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  return (
    matchedSignals.has('year_parenthesized_after_authors') &&
    matchedSignals.has('quoted_title') &&
    /\bAvailable at:/iu.test(text) &&
    (matchedSignals.has('locator_pp') ||
      matchedSignals.has('cue_journal') ||
      /\b(?:19|20)\d{2},\s*pp?\.\s*[A-Za-z]?\d/u.test(text))
  );
}

function hasHarvardAvailableAtBookCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  return (
    matchedSignals.has('year_parenthesized_after_authors') &&
    !matchedSignals.has('quoted_title') &&
    /\bAvailable at:/iu.test(text) &&
    (matchedSignals.has('cue_book_publisher') ||
      /\(\d{4}[a-z]?\)\s+[^.]{4,220}\.\s+[^.]{2,140}\.\s+Available at:/iu.test(backbone))
  );
}

function hasEnumeratedApaJournalCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (
    !matchedSignals.has('bracketed_enumerator') &&
    !matchedSignals.has('numeric_dot_enumerator') &&
    !matchedSignals.has('numeric_paren_enumerator') &&
    !matchedSignals.has('parenthesized_enumerator')
  ) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(stripLeadingEnumerator(text));
  return (
    !matchedSignals.has('quoted_title') &&
    matchedSignals.has('title_followed_by_period') &&
    (matchedSignals.has('locator_volume_issue_pages') ||
      matchedSignals.has('locator_page_range_only')) &&
    new RegExp(
      `^[^"]{2,120}\\(${STYLE_YEAR_SUFFIX_FRAGMENT}\\)\\.\\s+.+?\\.\\s+.+?,\\s*(?:\\d+|\\?)(?:\\((?:[^)]+|\\?)\\))?(?:,\\s*(?:pp?\\.?\\s*)?[A-Za-z]?\\d[\\w–-]*(?:\\s*[–-]\\s*\\d+)?)?\\.?$`,
      'iu',
    ).test(backbone)
  );
}

function hasEnumeratedHarvardJournalCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (
    !matchedSignals.has('bracketed_enumerator') &&
    !matchedSignals.has('numeric_dot_enumerator') &&
    !matchedSignals.has('numeric_paren_enumerator') &&
    !matchedSignals.has('parenthesized_enumerator')
  ) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(stripLeadingEnumerator(text));
  return (
    !matchedSignals.has('quoted_title') &&
    (matchedSignals.has('cue_journal') ||
      matchedSignals.has('cue_journal_abbrev') ||
      matchedSignals.has('locator_pp') ||
      matchedSignals.has('locator_volume_issue_pages')) &&
    new RegExp(
      `^[^"]{2,180},\\s*${STYLE_YEAR_SUFFIX_FRAGMENT}\\.\\s+.+?\\.\\s+.+?,\\s*(?:\\d+|\\?)(?:\\((?:[^)]+|\\?)\\))?(?:,\\s*(?:pp?\\.?\\s*)?[A-Za-z]?\\d[\\w–-]*(?:\\s*[–-]\\s*\\d+)?)?\\.?$`,
      'iu',
    ).test(backbone)
  );
}

function hasHarvardBareYearJournalCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (hasLeadingEnumerator(text) || /\bAvailable at:/iu.test(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  const hasInitialledHarvardLead =
    matchedSignals.has('year_bare_after_authors') &&
    /^[^"]{0,220},\s*[A-Z]\.(?:,\s*[A-Z]\.)*,\s*(?:19|20)\d{2}[a-z]?\.\s+/u.test(backbone);

  return (
    hasInitialledHarvardLead &&
    !matchedSignals.has('quoted_title') &&
    (matchedSignals.has('cue_journal') ||
      matchedSignals.has('cue_journal_abbrev') ||
      matchedSignals.has('locator_pp') ||
      matchedSignals.has('locator_volume_issue_pages')) &&
    new RegExp(
      `^[^"]{0,320},\\s*[A-Z]\\.(?:,\\s*[A-Z]\\.)*,\\s*${STYLE_YEAR_SUFFIX_FRAGMENT}\\.\\s+[^.]{4,320}\\.\\s+.+?,\\s*(?:\\d+|\\?)(?:\\((?:[^)]+|\\?)\\))?,\\s*(?:pp?\\.?\\s*)?[A-Za-z]?\\d[\\w–-]*(?:\\s*[–-]\\s*\\d+)?\\.?$`,
      'iu',
    ).test(backbone)
  );
}

function hasVancouverPlainSemicolonJournalSpine(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  return (
    matchedSignals.has('bracketed_enumerator') &&
    (matchedSignals.has('cue_journal') || matchedSignals.has('title_sentence_case')) &&
    /\b(?:19|20)\d{2};(?:\d+|\?)(?::[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$/u.test(text)
  );
}

function hasRelaxedVancouverCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  return (
    matchedSignals.has('bracketed_enumerator') &&
    matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !matchedSignals.has('quoted_title') &&
    (matchedSignals.has('cue_journal') ||
      matchedSignals.has('title_sentence_case') ||
      /^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?\s+[A-Z]\.?\s+/u.test(
        stripLeadingEnumerator(backbone),
      ))
  );
}

function hasApaLongAuthorLeadCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (hasLeadingEnumerator(text) || /\bAvailable at:/iu.test(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  const hasLongAuthorLead =
    /(?:,\s*){6,}/u.test(text) || /\s…\s/u.test(text) || matchedSignals.has('author_bucket_many');

  return (
    hasLongAuthorLead &&
    /\(\d{4}[a-z]?\)\.\s+/u.test(backbone) &&
    !matchedSignals.has('quoted_title') &&
    /^[^"]{0,720}\(\d{4}[a-z]?\)\.\s+[^.]{4,320}\.\s+[^.]{2,260}\.?$/iu.test(backbone)
  );
}

function hasMlaWorksCitedJournalNoPagesSpine(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  if (
    /"[^"]{4,}"\.?\s+.+?,\s*(?:19|20)\d{2},\s*[A-Za-zIVXLCDM]*\d[\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d+)?\.?$/iu.test(
      backbone,
    ) &&
    !/\bvol\.\s*(?:\d+|\?)/iu.test(backbone) &&
    !/\bno(?:s)?\.\s*[^,]+/iu.test(backbone) &&
    !/,\s*pp?\.\s*[A-Za-z]?\d/iu.test(backbone)
  ) {
    return false;
  }

  return /"[^"]{4,}"\.?[.,]?\s+.+?,\s*(?:vol\.\s*(?:\d+|\?)(?:,\s*no(?:s)?\.\s*[^,]+)?|no(?:s)?\.\s*[^,]+),\s*(?:19|20)\d{2}(?:,\s*(?:pp?\.\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)|,\s*(?:https?:\/\/|doi:\s*10\.|10\.)|(?:,\s*pp?\.\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\s*,\s*(?:https?:\/\/|doi:\s*10\.|10\.))|\.?$)/iu.test(
    backbone,
  );
}

function hasChicagoNotesJournalNoPagesSpine(text: string): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  if (/\bvol\.\s*\d+/iu.test(backbone)) {
    return false;
  }

  return /"[^"]{4,}(?:[.?!])?"\.?\s+.+?\s+\d+(?:,\s*no(?:s)?\.?\s*[^()]+)?\s*\((?:19|20)\d{2}\)\.?$/iu.test(
    backbone,
  );
}

function hasMlaConferenceCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  const hasQuotedConferenceCadence =
    /^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s*(?:1[6-9]|20)\d{2},\s*[^.]{6,320}(?:\.\s+[^.]{4,320})?/iu.test(
      backbone,
    ) ||
    /^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s*(?:1[6-9]|20)\d{2},\s*.+?\b(?:conference|proceedings|abstracts publication|symposium|congress|meeting|workshop)\b/iu.test(
      backbone,
    );
  const hasNestedQuotedConferenceCadence =
    /^[^"]{2,220}\.\s*".+\s*(?:1[6-9]|20)\d{2},\s*.+?\b(?:conference|proceedings|abstracts publication|symposium|congress|meeting|workshop)\b/iu.test(
      backbone,
    );
  return (
    STYLE_CONFERENCE_CUE_REGEX.test(backbone) &&
    (/^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s*(?:1[6-9]|20)\d{2},\s*[^.]{6,260}\.?$/iu.test(backbone) ||
      /^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s*(?:1[6-9]|20)\d{2},\s*International Conference on [^.]+/iu.test(
        backbone,
      ) ||
      hasQuotedConferenceCadence ||
      hasNestedQuotedConferenceCadence)
  );
}

function hasMlaQuotedTailCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text).trim();
  if (
    !/"/u.test(backbone) ||
    !/,\s*(?:1[6-9]|20)\d{2},\s*(?:(?:pp?\.\s*[^,]+,\s*)?(?:https?:\/\/|doi:\s*10\.|10\.))/iu.test(
      text,
    )
  ) {
    return false;
  }

  return (
    STYLE_BOOK_PUBLISHER_CUE_REGEX.test(backbone) ||
    STYLE_REPOSITORY_CUE_REGEX.test(backbone) ||
    /\bResearch Square(?: Platform LLC)?\b/iu.test(backbone) ||
    /\b(?:preprint|conference|proceedings|abstracts publication|symposium|workshop|congress|meeting)\b/iu.test(
      backbone,
    ) ||
    /\bvol\.\s*(?:\d+|\?)/iu.test(backbone) ||
    /\bno(?:s)?\.\s*[^,]+/iu.test(backbone) ||
    /,\s*pp?\.\s*[A-Za-z]?\d/u.test(backbone)
  );
}

function hasMlaQuotedYearContainerCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text)
    .replace(/\bhttps?:\/\/[^\s]*$/iu, '')
    .trim()
    .replace(/[.,;:\s]+$/u, '');
  const match = backbone.match(/^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s*(?:1[6-9]|20)\d{2},\s*(.+)$/iu);
  const tail = match?.[1]?.trim() ?? '';
  if (!tail || !/\p{L}/u.test(tail)) {
    return false;
  }

  return (
    !/^(?:[A-Za-zIVXLCDM]*\d[\w–-]*)(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d+)?\.?$/iu.test(tail) &&
    !/^.+?,\s*[A-Za-zIVXLCDM]*\d[\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d+)?\.?$/iu.test(tail)
  );
}

function hasChicagoNotesConferenceCommitProfile(text: string): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  return (
    /"[^"]{4,}(?:[.?!])?"\.?\s*Paper presented at\s+.+?\.\s*(?:19|20)\d{2}\.?$/iu.test(backbone) ||
    /"[^"]{4,}(?:[.?!])?"\.?\s*(?:19|20)\d{2},\s*[A-Za-zIVXLCDM]*\d[\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d+)?\.?$/iu.test(
      backbone,
    ) ||
    hasChicagoNotesContainerSpine(text)
  );
}

function hasChicagoQuotedTailCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  if (
    hasMlaPublisherCommaYearIdentifierProfile(text) ||
    hasMlaQuotedRepositoryIdentifierCommitProfile(text) ||
    hasMlaThesisIdentifierCommitProfile(text) ||
    /,\s*(?:1[6-9]|20)\d{2},\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(text)
  ) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text).trim();
  if (
    !/"/u.test(backbone) ||
    !/,\s*(?:1[6-9]|20)\d{2}\.?(?:\s*(?:https?:\/\/|doi:\s*10\.|10\.)|$)/iu.test(text)
  ) {
    return false;
  }

  if (
    /\bvol\.\s*(?:\d+|\?)/iu.test(backbone) ||
    /\bno(?:s)?\.\s*[^,]+/iu.test(backbone) ||
    /,\s*pp?\.\s*[A-Za-z]?\d/iu.test(backbone)
  ) {
    return false;
  }

  return (
    /\bIn\s+/iu.test(backbone) ||
    /\bPreprint,\s+/iu.test(backbone) ||
    STYLE_BOOK_PUBLISHER_CUE_REGEX.test(backbone) ||
    /\b(?:conference|proceedings|abstracts publication|symposium|workshop|congress|meeting)\b/iu.test(
      backbone,
    )
  );
}

function hasApaFrontYearIdentifierCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(text);
  return (
    (matchedSignals.has('year_parenthesized_after_authors') ||
      hasFrontParenthesizedYearLead(text)) &&
    hasAuthorLikeLeadBeforeFrontYear(text) &&
    hasPostYearTitleCadence(text) &&
    !matchedSignals.has('quoted_title') &&
    !/\bAvailable at:/iu.test(text) &&
    (matchedSignals.has('identifier_doi') || matchedSignals.has('identifier_url')) &&
    /\(\d{4}[a-z]?\)\.\s+/u.test(text) &&
    /^[^"]{2,240}\(\d{4}[a-z]?\)\.\s+[^.]{4,320}\.\s+[^.]{2,320}\.?$/iu.test(backbone)
  );
}

function hasApaFrontYearBookIdentifierCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(text);
  return (
    (matchedSignals.has('year_parenthesized_after_authors') ||
      hasFrontParenthesizedYearLead(text)) &&
    hasAuthorLikeLeadBeforeFrontYear(text) &&
    matchedSignals.has('cue_book_publisher') &&
    matchedSignals.has('identifier_doi') &&
    !/\bAvailable at:/iu.test(text) &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    /\(\d{4}[a-z]?\)\.\s+/u.test(text) &&
    /^[^"]{2,260}\(\d{4}[a-z]?\)\.\s+.+\.\s+[^.]{2,240}\.?$/iu.test(backbone)
  );
}

function hasApaCorporateMonographIdentifierCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(text).trim();
  const afterYear =
    backbone.match(/\((?:1[6-9]|20)\d{2}[a-z]?\)\.\s+(?<tail>.+)$/iu)?.groups?.tail?.trim() ?? '';
  const tailSegments = afterYear
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const publisherSegment = tailSegments.at(-1) ?? '';
  const titleSegment = tailSegments.slice(0, -1).join('. ').trim();
  const hasCorporatePublisherCue =
    STYLE_BOOK_PUBLISHER_CUE_REGEX.test(publisherSegment) ||
    /\b(?:commission|convention|fund|standards|survey|group|organization|organisation|council|committee|office|department|agency|library|repository)\b/iu.test(
      publisherSegment,
    );
  return (
    (matchedSignals.has('year_parenthesized_after_authors') ||
      hasFrontParenthesizedYearLead(text)) &&
    !matchedSignals.has('quoted_title') &&
    !/\bAvailable at:/iu.test(text) &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    (matchedSignals.has('identifier_doi') || matchedSignals.has('identifier_url')) &&
    !/,\s*(?:1[6-9]|20)\d{2},\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(text) &&
    (/^[^"]{2,260}\.\s*\((?:1[6-9]|20)\d{2}[a-z]?\)\.\s+[^.]{4,260}\.\s+[^.]{2,240}\.?$/iu.test(
      backbone,
    ) ||
      (titleSegment.length >= 4 && publisherSegment.length >= 2 && hasCorporatePublisherCue))
  );
}

function hasApaPatentTitleYearCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  return (
    !hasLeadingEnumerator(text) &&
    !matchedSignals.has('quoted_title') &&
    !/\bAvailable at:/iu.test(text) &&
    /\bPatent(?:\s+Application)?\s+No\.?\s*[A-Z]{2,}[A-Z0-9/-]{4,}\b/iu.test(text) &&
    /https?:\/\/(?:www\.)?patents\.google\.com\/patent\//iu.test(text) &&
    /^[^"]{4,360}\s+\(Patent(?:\s+Application)?\s+No\.?\s*[A-Z0-9/-]+\)\.\s*\((?:1[6-9]|20)\d{2}[a-z]?\)\.?$/iu.test(
      stripTerminalIdentifierTail(text),
    )
  );
}

function hasChicagoSparseQuotedYearPagesCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text)
    .replace(/\bhttps?:\/\/[^\s]*$/iu, '')
    .trim()
    .replace(/[.,;:\s]+$/u, '');
  return /^[^"]{2,360}\.\s*"[^"]{4,}"\.?\s*(?:1[6-9]|20)\d{2},\s*[A-Za-zIVXLCDM]*\d[\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d+)?\.?$/iu.test(
    backbone,
  );
}

function hasChicagoQuotedContainerYearPagesCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text)
    .replace(/\bhttps?:\/\/[^\s]*$/iu, '')
    .trim()
    .replace(/[.,;:\s]+$/u, '');
  return /^[^"]{2,360}\.\s*"[^"]{4,}"\.?\s+[^.]{2,260},\s*(?:1[6-9]|20)\d{2},\s*[A-Za-zIVXLCDM]*\d[\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d+)?\.?$/iu.test(
    backbone,
  );
}

function hasChicagoBookIdentifierTailCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text) || /"/u.test(text)) {
    return false;
  }

  return (
    hasChicagoNotesBookSpine(text) &&
    /^[^"]{2,360}\.\s+.+?\.\s+.+?,\s*(?:1[6-9]|20)\d{2}\.\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(
      text,
    )
  );
}

function hasChicagoSparseQuotedIdentifierPagesCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  return (
    /"[^"]{4,}"/u.test(text) &&
    /"[^"]{4,}"\.?\s*(?:1[6-9]|20)\d{2},\s*[A-Za-zIVXLCDM0-9][\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM0-9][\w–-]*)?\.?\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(
      text,
    ) &&
    !/\bvol\.\s*(?:\d+|\?)/iu.test(text) &&
    !/\bno(?:s)?\.\s*[^,]+/iu.test(text) &&
    !/,\s*pp?\.\s*[A-Za-z]?\d/iu.test(text)
  );
}

function hasIeeeBookSpine(text: string, matchedSignals: Set<StyleSignalCode>): boolean {
  const backbone = stripLeadingEnumerator(text);
  return (
    matchedSignals.has('bracketed_enumerator') &&
    matchedSignals.has('cue_book_publisher') &&
    !matchedSignals.has('quoted_title') &&
    matchedSignals.has('identifier_doi') &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    /,\s*(?:1[6-9]|20)\d{2}\.?(?:\s*(?:doi:\s*10\.|https?:\/\/|10\.|$))/iu.test(backbone)
  );
}

function hasIeeeQuotedInstitutionalReportCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (!matchedSignals.has('bracketed_enumerator') || !matchedSignals.has('identifier_doi')) {
    return false;
  }

  return (
    (/^.+?"[^"]{4,}"(?:,)?\s+[^,;]{4,220},\s*(?:1[6-9]|20)\d{2}\.?\s*(?:doi:\s*10\.|https?:\/\/|10\.)/iu.test(
      text,
    ) ||
      /^.+?"[^"]{4,}"(?:,)?\s+[^,;]{4,220},\s+[^,;]{4,220},\s*(?:1[6-9]|20)\d{2}\.?\s*(?:doi:\s*10\.|https?:\/\/|10\.)/iu.test(
        text,
      )) &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !matchedSignals.has('locator_ieee_signature') &&
    !/;\s*(?:1[6-9]|20)\d{2},\s*p{1,2}\.?\s*[A-Za-z]?\d/iu.test(text)
  );
}

function hasRelaxedIeeeBookCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripLeadingEnumerator(stripTrailingIdentifierTail(text))
    .replace(/\bdoi:?\s*$/iu, '')
    .replace(/\bhttps?:\/\/[^\s]*$/iu, '')
    .trim()
    .replace(/[.,;:\s]+$/u, '');
  return (
    matchedSignals.has('bracketed_enumerator') &&
    matchedSignals.has('identifier_doi') &&
    !matchedSignals.has('quoted_title') &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    (/,\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone) ||
      /^[^"]{2,120}\.\s+.+?\.\s+[^.]{2,180},\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone)) &&
    /\.\s+[^.]{3,180}$/u.test(backbone)
  );
}

function hasIeeeEnumeratedBookDoiCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripLeadingEnumerator(stripTrailingIdentifierTail(text)).trim();
  return (
    matchedSignals.has('bracketed_enumerator') &&
    matchedSignals.has('cue_book_publisher') &&
    matchedSignals.has('identifier_doi') &&
    !matchedSignals.has('quoted_title') &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !matchedSignals.has('locator_ieee_signature') &&
    !matchedSignals.has('locator_pp') &&
    /,\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone)
  );
}

function hasIeeePatentCommitProfile(text: string, matchedSignals: Set<StyleSignalCode>): boolean {
  return (
    matchedSignals.has('bracketed_enumerator') &&
    /\b(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)\d{6,}[A-Z0-9/-]*\b/iu.test(text) &&
    /https?:\/\/(?:www\.)?patents\.google\.com\/patent\//iu.test(text) &&
    (/\[(?:Online|Internet)\]/iu.test(text) || /\bAvailable:/iu.test(text))
  );
}

function hasApaLooseJournalCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  return (
    matchedSignals.has('year_parenthesized_after_authors') &&
    (matchedSignals.has('cue_journal') ||
      matchedSignals.has('cue_conference') ||
      /,\s*(?:\d+|\?),\s*[A-Za-z]?\d[\w–-]{3,}\.?$/iu.test(backbone)) &&
    !matchedSignals.has('quoted_title') &&
    (/\(\d{4}[a-z]?\)\.\s+.+?\.\s+.+?,\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/iu.test(
      backbone,
    ) ||
      /\(\d{4}[a-z]?\)\.\s+.+?\.\s+.+?,\s*(?:\d+|\?),\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/iu.test(
        backbone,
      ))
  );
}

function hasApaBareYearJournalCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  return (
    !hasLeadingEnumerator(text) &&
    matchedSignals.has('year_bare_after_authors') &&
    (matchedSignals.has('cue_journal') || matchedSignals.has('cue_journal_abbrev')) &&
    !matchedSignals.has('quoted_title') &&
    !/\bAvailable at:/iu.test(text) &&
    (matchedSignals.has('locator_volume_issue_pages') ||
      matchedSignals.has('locator_page_range_only') ||
      matchedSignals.has('locator_pp')) &&
    /^[^"]{0,320},\s*(?:19|20)\d{2}[a-z]?\.\s+[^.]{4,320}\.\s+.+?,\s*(?:\d+|\?)(?:\((?:[^)]+|\?)\))?,\s*(?:pp?\.?\s*)?[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/iu.test(
      backbone,
    )
  );
}

function hasApaPageOnlyJournalCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  const hasPeriodLeadPageOnlyTail =
    matchedSignals.has('year_parenthesized_after_authors') &&
    !matchedSignals.has('quoted_title') &&
    (matchedSignals.has('locator_page_range_only') || matchedSignals.has('locator_pp')) &&
    /^[^"]{0,180}\.\s*\(\d{4}[a-z]?\)\.\s+.+?\.\s+.+?,\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/iu.test(
      backbone,
    );
  const hasSimpleLocatorTail =
    matchedSignals.has('year_parenthesized_after_authors') &&
    !matchedSignals.has('quoted_title') &&
    (matchedSignals.has('locator_page_range_only') || matchedSignals.has('locator_pp')) &&
    /\(\d{4}[a-z]?\)\.\s+.+?,\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/iu.test(backbone);
  return (
    hasPeriodLeadPageOnlyTail ||
    hasSimpleLocatorTail ||
    (matchedSignals.has('year_parenthesized_after_authors') &&
      !matchedSignals.has('quoted_title') &&
      (matchedSignals.has('locator_page_range_only') || matchedSignals.has('locator_pp')) &&
      /\(\d{4}[a-z]?\)\.\s+.+?\.\s+.+?,\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/iu.test(
        backbone,
      ))
  );
}

export function extractStyleSignals(rawCitation: string): StyleSignalSet {
  const normalizedText = normalizeStyleInput(rawCitation);
  const citationText = stripLeadingEnumerator(normalizedText);
  const citationBackbone = stripTrailingIdentifierTail(citationText);
  const citationStructuralText = stripUrlAndAccessNoise(citationText);
  const citationLocatorBackbone = stripTrailingIdentifierTail(citationStructuralText);
  const matchedSignals = new Set<StyleSignalCode>();
  const signalGroups = new Set<SignalGroup>();
  const addSignal = (group: SignalGroup, code: StyleSignalCode, condition = true) => {
    if (!condition) {
      return;
    }
    signalGroups.add(group);
    matchedSignals.add(code);
  };

  const likelyTitle = guessLikelyTitle(citationText);
  const authorLead = extractAuthorLead(citationText);
  const firstYearIndex = citationStructuralText.search(STYLE_YEAR_REGEX);
  const yearNearLead =
    firstYearIndex >= 0 &&
    (firstYearIndex <= 90 || firstYearIndex <= citationStructuralText.length * 0.42);
  const preYearContainer = extractPreYearContainer(citationStructuralText, firstYearIndex);
  const enumeratorMatch =
    normalizedText.match(/^\s*(\[\d+\]|\d+\.\s+|\d+\)\s+|\(\d+\)\s+)/u)?.[1] ?? '';
  const hasLeadingEnumerator = enumeratorMatch.length > 0;
  const yearParenthesizedAfterAuthors =
    !hasLeadingEnumerator &&
    yearNearLead &&
    new RegExp(`^[^"]{0,120}\\(${STYLE_YEAR_SUFFIX_FRAGMENT}\\)`, 'u').test(citationStructuralText);
  const yearBareAfterAuthors =
    !hasLeadingEnumerator &&
    yearNearLead &&
    new RegExp(`^[^"]{0,120},?\\s*${STYLE_YEAR_SUFFIX_FRAGMENT}\\.`, 'u').test(
      citationStructuralText,
    ) &&
    !yearParenthesizedAfterAuthors;
  const yearEndPosition = new RegExp(`\\b${STYLE_YEAR_SUFFIX_FRAGMENT}\\b\\.?$`, 'u').test(
    citationStructuralText,
  );
  const authorYearLeadPattern =
    !hasLeadingEnumerator &&
    yearNearLead &&
    new RegExp(
      `^[^"]{0,90}(?:\\(${STYLE_YEAR_SUFFIX_FRAGMENT}\\)|,\\s*${STYLE_YEAR_SUFFIX_FRAGMENT}\\.)`,
      'u',
    ).test(citationStructuralText);
  const hasIeeeLocatorSignature = LOCATOR_IEEE_SIGNATURE_RE.test(citationText);
  const hasLabeledVolume = /(?:^|[;,\s])vol\.?\s*(?:\d+|\?)/iu.test(citationStructuralText);
  const hasLabeledIssue = /(?:^|[;,\s])no\.?\s*(?:\d+|\?|\d+[A-Za-z]?)/iu.test(
    citationStructuralText,
  );
  const hasLabeledPages = /(?:^|[;,\s])pp?\.?\s*[A-Za-z]?\d[\w–-]*/iu.test(citationStructuralText);
  const hasAuthorInitialsSurname = /^(?:[\p{Lu}]\.\s*){1,3}[\p{Lu}][\p{L}'-]+/u.test(authorLead);
  const hasAuthorSurnameInitials =
    /^[\p{Lu}][\p{L}'-]+(?:\s+(?:da|de|del|di|la|le|van|von|der))?(?:\s+[\p{Lu}][\p{L}'-]+)?\s+[\p{Lu}]{1,3}\b/u.test(
      authorLead,
    );
  const ieeeIncompatibleAuthorDateYearPlacement =
    !hasIeeeLocatorSignature &&
    !yearEndPosition &&
    (yearBareAfterAuthors || yearParenthesizedAfterAuthors || authorYearLeadPattern);
  const authorLeadAmbiguous =
    !/^"/u.test(citationText) &&
    tokenizeWords(authorLead).length >= 2 &&
    !hasAuthorInitialsSurname &&
    !hasAuthorSurnameInitials &&
    !/^(?:[A-Z][\p{L}&' -]{3,}|[A-Z][\p{L}'-]+,\s+[A-Z][\p{L}'-]+)/u.test(authorLead);

  addSignal('enumerator', 'bracketed_enumerator', /^\[\d+\]/u.test(enumeratorMatch));
  addSignal('enumerator', 'numeric_dot_enumerator', /^\d+\./u.test(enumeratorMatch));
  addSignal('enumerator', 'numeric_paren_enumerator', /^\d+\)/u.test(enumeratorMatch));
  addSignal('enumerator', 'parenthesized_enumerator', /^\(\d+\)/u.test(enumeratorMatch));

  addSignal('author_lead', 'quoted_title_lead', /^"/u.test(citationText));
  addSignal('author_lead', 'author_initials_surname', hasAuthorInitialsSurname);
  addSignal('author_lead', 'author_surname_initials', hasAuthorSurnameInitials);
  addSignal('author_lead', 'author_lead_ambiguous', authorLeadAmbiguous);
  addSignal('author_lead', 'author_year_lead', authorYearLeadPattern);

  const hasEtAl = /\bet al\.?/iu.test(citationText);
  const authorSeparator = detectAuthorSeparator(authorLead);
  const authorBucket = detectAuthorBucket(authorLead, authorSeparator, hasEtAl);
  addSignal('author_count', 'has_et_al', hasEtAl);
  addSignal('author_count', 'author_bucket_single', authorBucket === 'single');
  addSignal('author_count', 'author_bucket_few', authorBucket === 'few');
  addSignal('author_count', 'author_bucket_many', authorBucket === 'many');
  addSignal('author_separator', 'author_separator_comma', authorSeparator === 'comma');
  addSignal('author_separator', 'author_separator_semicolon', authorSeparator === 'semicolon');
  addSignal('author_separator', 'author_separator_and', authorSeparator === 'and');
  addSignal('author_separator', 'author_separator_ampersand', authorSeparator === 'ampersand');

  addSignal('year', 'year_parenthesized_after_authors', yearParenthesizedAfterAuthors);
  addSignal('year', 'year_bare_after_authors', yearBareAfterAuthors);
  addSignal('year', 'year_repeated_conference', repeatedConferenceYear(citationText));
  addSignal('year', 'year_end_position', yearEndPosition);
  addSignal(
    'year',
    'ieee_incompatible_author_date_year_placement',
    ieeeIncompatibleAuthorDateYearPlacement,
  );
  addSignal(
    'year',
    'year_early_position',
    firstYearIndex >= 0 && firstYearIndex <= citationStructuralText.length * 0.25,
  );
  addSignal(
    'year',
    'year_late_position',
    firstYearIndex >= 0 && firstYearIndex >= citationStructuralText.length * 0.75,
  );

  addSignal('title', 'quoted_title', /"[^"]{4,}"/u.test(citationText));
  addSignal(
    'title',
    'title_followed_by_period',
    /"[^"]{4,}"\./u.test(citationText) || /\)\.?\s+[^.]{4,120}\./u.test(citationText),
  );
  addSignal(
    'title',
    'title_followed_by_comma',
    /"[^"]{4,}",/u.test(citationText) ||
      /\)\.?\s+[^,]{4,120},\s+(?:In\b|[A-Z])/u.test(citationText),
  );
  addSignal('title', 'title_sentence_case', looksSentenceCase(likelyTitle));
  addSignal('title', 'title_title_case', looksTitleCase(likelyTitle));

  addSignal('container', 'cue_in_container', /\bIn\b/u.test(citationText));
  addSignal('container', 'cue_conference', STYLE_CONFERENCE_CUE_REGEX.test(citationText));
  addSignal(
    'container',
    'cue_journal',
    /\b(?:Journal|Review|Bulletin|Transactions|Quarterly|Annals)\b/iu.test(citationText),
  );
  addSignal('container', 'cue_journal_abbrev', looksJournalAbbrevLike(preYearContainer));
  addSignal('container', 'cue_book_publisher', STYLE_BOOK_PUBLISHER_CUE_REGEX.test(citationText));
  addSignal(
    'container',
    'cue_web_access',
    /\b(?:Accessed|Retrieved|Available at)\b/iu.test(citationText),
  );

  addSignal('editor_translator', 'marker_editor', /\bEds?\.?\b/u.test(citationText));
  addSignal('editor_translator', 'marker_translator', /\bTrans\.?\b/u.test(citationText));
  addSignal(
    'edition',
    'marker_edition',
    /\b(?:\d+(?:st|nd|rd|th)\s+ed\.|Rev\.\s+ed\.|Version\s+\d+)/iu.test(citationText),
  );

  addSignal('locator', 'locator_vol', hasLabeledVolume);
  addSignal('locator', 'locator_no', hasLabeledIssue);
  addSignal('locator', 'locator_pp', hasLabeledPages);
  addSignal('locator', 'locator_ieee_signature', hasIeeeLocatorSignature);
  addSignal(
    'locator',
    'locator_semicolon_volume_issue_pages',
    /;(?:\d+|\?)(?:\((?:[^)]+|\?)\))?:[A-Za-z]?\d[\w–-]*/u.test(citationLocatorBackbone),
  );
  addSignal(
    'locator',
    'locator_volume_issue_pages',
    /\b(?:\d+|\?)(?:\((?:[^)]+|\?)\))?,\s*(?:pp?\.?\s*)?[A-Za-z]?\d[\w–-]*/u.test(
      citationLocatorBackbone,
    ),
  );
  addSignal(
    'locator',
    'locator_year_comma_volume_colon_pages',
    /\b(?:19|20)\d{2}[a-z]?,\s*(?:\d+|\?)\s*:\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/u.test(
      citationLocatorBackbone,
    ),
  );
  addSignal(
    'locator',
    'locator_year_comma_volume_colon_identifier',
    /\b(?:19|20)\d{2}[a-z]?,\s*(?:\d+|\?)\s*:\s*10\.\d{4,9}\/[^\s"'<>]+\.?$/iu.test(citationText),
  );
  addSignal(
    'locator',
    'locator_page_range_only',
    /\b[A-Za-z]?\d{1,5}\s*[–-]\s*\d{1,5}\b/u.test(citationLocatorBackbone),
  );

  const doiMatch = citationText.match(DOI_REGEX)?.[0] ?? null;
  const urlMatch = citationText.match(URL_REGEX)?.[0] ?? null;
  const identifierStart = doiMatch
    ? citationText.indexOf(doiMatch)
    : urlMatch
      ? citationText.indexOf(urlMatch)
      : -1;
  const hasTrailingIdentifier = isTrailingIdentifierStart(
    citationText,
    identifierStart,
    STYLE_DETECTION_THRESHOLDS.identifierTailSignalShare,
  );
  addSignal('identifier', 'identifier_doi', doiMatch != null);
  addSignal('identifier', 'identifier_url', urlMatch != null);
  addSignal(
    'identifier',
    'identifier_accessed_retrieved',
    /\b(?:Accessed|Retrieved)\b/iu.test(citationText),
  );
  addSignal('identifier', 'identifier_at_end', hasTrailingIdentifier);
  addSignal(
    'identifier',
    'identifier_doi_tail_numeric',
    doiMatch != null &&
      hasTrailingIdentifier &&
      /\b(?:19|20)\d{2}[a-z]?,\s*(?:\d+|\?)\s*:/u.test(citationText),
  );

  addSignal(
    'capitalization',
    'capitalization_quoted_title_profile',
    /"[^"]{4,}"/u.test(citationText),
  );
  addSignal('capitalization', 'capitalization_heavy_titlecase', looksTitleCase(likelyTitle));
  addSignal('capitalization', 'capitalization_numeric_minimal', looksNumericMinimal(likelyTitle));

  if (citationText.length > 60) {
    const periodCount = (citationText.match(/\./g) ?? []).length;
    const commaCount = (citationText.match(/,/g) ?? []).length;
    addSignal('punctuation', 'punctuation_period_dense', periodCount >= 3);
    addSignal('punctuation', 'punctuation_comma_dense', commaCount >= 4);
    addSignal('punctuation', 'punctuation_mixed_cadence', periodCount >= 2 && commaCount >= 2);
  }

  const host = urlMatch ? safeUrlHost(urlMatch) : null;
  const hasScholarlyLocators =
    /\b(?:vol\.?|no\.?|pp?\.?)\b/iu.test(citationStructuralText) ||
    /;(?:\d+|\?)(?:\((?:[^)]+|\?)\))?:/u.test(citationLocatorBackbone);
  addSignal(
    'web',
    'web_url_without_scholarly_locators',
    Boolean(urlMatch && !doiMatch && !hasScholarlyLocators),
  );
  addSignal('web', 'web_host_like_container', Boolean(host && !/doi\.org$/iu.test(host)));

  return {
    normalizedText: citationText,
    length: citationText.length,
    signalGroups,
    matchedSignals,
    likelyTitle,
  };
}

/**
 * IEEE / IEEE-like journal references often fire both numeric locators (vol./no./pp.)
 * and notes-like title signals (quoted title + year at end). Raw family scores can be
 * close; after min–max normalization the top-two margin falls below the commit threshold.
 * A small additive boost keeps the numeric family separable without changing signal weights globally.
 */
function applyNumericIeeeJournalSpineBoost(
  rawScores: Map<StyleFamily, number>,
  signals: StyleSignalSet,
): void {
  const matched = signals.matchedSignals;
  /** APA/Harvard-style: year after authors, pages at end — not IEEE terminal-year layout */
  if (matched.has('ieee_incompatible_author_date_year_placement')) {
    return;
  }
  const hasSpine =
    matched.has('locator_ieee_signature') ||
    (matched.has('locator_vol') &&
      matched.has('locator_no') &&
      matched.has('locator_pp') &&
      (matched.has('year_end_position') || matched.has('year_late_position')));
  if (!hasSpine) {
    if (!hasIeeeBookSpine(signals.normalizedText, matched)) {
      return;
    }
  }

  rawScores.set('numeric', (rawScores.get('numeric') ?? 0) + 2.35);
  if (
    matched.has('locator_ieee_signature') &&
    (matched.has('bracketed_enumerator') ||
      matched.has('numeric_dot_enumerator') ||
      matched.has('numeric_paren_enumerator'))
  ) {
    rawScores.set('numeric', (rawScores.get('numeric') ?? 0) + 1.9);
    rawScores.set('notes_bibliography', (rawScores.get('notes_bibliography') ?? 0) - 1.1);
  }
}

/**
 * Disambiguate demo / curriculum references where IEEE-like vol./no./pp. signals
 * would otherwise steal MLA, or NLM `Year;Vol(Issue):` spines read as author-date.
 */
function applyCurriculumFormatFamilyBoosts(
  rawScores: Map<StyleFamily, number>,
  signals: StyleSignalSet,
): void {
  const t = signals.normalizedText;
  const m = signals.matchedSignals;

  if (hasMlaWorksCitedJournalSpine(t) || hasMlaWorksCitedJournalNoPagesSpine(t)) {
    rawScores.set('notes_bibliography', (rawScores.get('notes_bibliography') ?? 0) + 4.4);
    rawScores.set('numeric', (rawScores.get('numeric') ?? 0) - 3.6);
  }

  if (hasChicagoNotesJournalSpine(t)) {
    rawScores.set('notes_bibliography', (rawScores.get('notes_bibliography') ?? 0) + 4.1);
    rawScores.set('numeric', (rawScores.get('numeric') ?? 0) - 2.6);
  }

  if (
    hasMlaWorksCitedBookSpine(t) ||
    hasChicagoNotesBookSpine(t) ||
    hasChicagoNotesContainerSpine(t) ||
    hasMlaConferenceCommitProfile(t) ||
    hasMlaQuotedYearContainerCommitProfile(t) ||
    hasChicagoNotesConferenceCommitProfile(t) ||
    hasChicagoSparseQuotedYearPagesCommitProfile(t)
  ) {
    rawScores.set('notes_bibliography', (rawScores.get('notes_bibliography') ?? 0) + 4.3);
    rawScores.set('author_date', (rawScores.get('author_date') ?? 0) - 2.1);
    rawScores.set('web_accessed', (rawScores.get('web_accessed') ?? 0) - 1.9);
  }

  if (hasStrongIeeeEnumeratedJournalSpine(t, m)) {
    rawScores.set('numeric', (rawScores.get('numeric') ?? 0) + 3.2);
    rawScores.set('notes_bibliography', (rawScores.get('notes_bibliography') ?? 0) - 2.4);
  }

  // Vancouver / NLM journal spine: …Journal. 2019;380(14):1347-1358.
  if (
    (m.has('locator_semicolon_volume_issue_pages') && /\b\d{4};\d+\(\d+\):/u.test(t)) ||
    hasMinimalVancouverJournalSpine(stripTrailingIdentifierTail(t))
  ) {
    rawScores.set('numeric', (rawScores.get('numeric') ?? 0) + 3.9);
    rawScores.set('author_date', (rawScores.get('author_date') ?? 0) - 2.4);
  }

  if (hasVancouverConferencePublisherSpine(t, m)) {
    rawScores.set('numeric', (rawScores.get('numeric') ?? 0) + 3.5);
    rawScores.set('web_accessed', (rawScores.get('web_accessed') ?? 0) - 1.7);
    rawScores.set('author_date', (rawScores.get('author_date') ?? 0) - 1.4);
  }

  if (
    hasApaConferenceCommitProfile(t, m) ||
    hasApaBookCommitProfile(t, m) ||
    hasApaBareYearJournalCommitProfile(t, m) ||
    hasApaJournalCommitProfile(t, m) ||
    hasApaLooseJournalCommitProfile(t, m) ||
    hasApaSparseContainerCommitProfile(t, m) ||
    hasApaThesisBracketedCommitProfile(t, m) ||
    hasEnumeratedApaJournalCommitProfile(t, m) ||
    hasEnumeratedHarvardJournalCommitProfile(t, m) ||
    hasQuotedHarvardAvailableAtProfile(t, m) ||
    hasHarvardAvailableAtJournalCommitProfile(t, m) ||
    hasHarvardAvailableAtBookCommitProfile(t, m) ||
    hasHarvardCorporateReportCommitProfile(t, m)
  ) {
    rawScores.set('author_date', (rawScores.get('author_date') ?? 0) + 4.6);
    rawScores.set('web_accessed', (rawScores.get('web_accessed') ?? 0) - 3.1);
  }
}

/** Chicago notes/bib journal article: `Journal 25, no. 1 (2019): pages` — no `vol.` before the volume digit */
function applyChicagoNotesVsMlaExactBoost(
  rawScores: Map<CitationStyle, number>,
  signals: StyleSignalSet,
): void {
  const t = signals.normalizedText;
  if (hasChicagoNotesJournalSpine(t) || hasChicagoNotesJournalNoPagesSpine(t)) {
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) + 5.8);
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) - 2.8);
  }

  if (hasMlaWorksCitedJournalSpine(t) || hasMlaWorksCitedJournalNoPagesSpine(t)) {
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) + 4.6);
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) - 2.2);
  }

  if (hasMlaWorksCitedBookSpine(t)) {
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) + 4.8);
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) - 2.1);
  }

  if (hasMlaWorksCitedBookUrlTailProfile(t)) {
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) + 5.1);
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) - 2.5);
  }

  if (hasMlaConferenceCommitProfile(t)) {
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) + 5.2);
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) - 2.4);
  }

  if (hasMlaQuotedYearContainerCommitProfile(t)) {
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) + 4.9);
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) - 2.2);
  }

  if (
    hasMlaPublisherCommaYearIdentifierProfile(t) ||
    hasMlaQuotedRepositoryIdentifierCommitProfile(t) ||
    hasMlaThesisIdentifierCommitProfile(t) ||
    hasMlaQuotedTailCommitProfile(t) ||
    hasMlaPreprintCommitProfile(t)
  ) {
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) + 5.3);
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) - 2.9);
  }

  if (hasChicagoNotesBookSpine(t) || hasChicagoNotesContainerSpine(t)) {
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) + 5.1);
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) - 2.4);
  }

  if (hasChicagoNotesConferenceCommitProfile(t)) {
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) + 5.6);
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) - 2.8);
  }

  if (hasChicagoSparseQuotedYearPagesCommitProfile(t)) {
    rawScores.set('chicago-notes-bib', (rawScores.get('chicago-notes-bib') ?? 0) + 5.1);
    rawScores.set('mla9', (rawScores.get('mla9') ?? 0) - 2.1);
  }
}

/**
 * Minimal disambiguation for synthetic regression strings:
 * - Harvard CTR: `Smith, J., 2020. …` (initials + comma-year)
 * - Chicago author-date: `Smith, John. 2020. …` (given name + period-year)
 */
function applyAuthorDateHarvardChicagoExactBoost(
  rawScores: Map<CitationStyle, number>,
  signals: StyleSignalSet,
): void {
  const t = signals.normalizedText;
  const m = signals.matchedSignals;
  const hasHarvardParenthesizedQuoted = /\(\d{4}[a-z]?\)\s*"[^"]{4,}/u.test(t);
  const hasHarvardAvailableAt = /\bAvailable at:/iu.test(t);
  const hasHarvardParenthesizedPublisherTail =
    signals.matchedSignals.has('year_parenthesized_after_authors') &&
    signals.matchedSignals.has('cue_book_publisher') &&
    (hasHarvardAvailableAt || signals.matchedSignals.has('locator_pp'));
  if (/^[^"]{0,160}\(\d{4}[a-z]?\)\.\s+/u.test(t)) {
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) + 1.8);
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) - 0.7);
  }
  if (hasApaConferenceCommitProfile(t, m) || hasApaBookCommitProfile(t, m)) {
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) + 4.6);
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) - 2.8);
  }
  if (hasApaSparseContainerCommitProfile(t, m) || hasApaThesisBracketedCommitProfile(t, m)) {
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) + 4.2);
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) - 2.4);
  }
  if (hasApaBareYearJournalCommitProfile(t, m)) {
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) + 4.8);
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) - 2.8);
  }
  if (hasApaLooseJournalCommitProfile(t, m)) {
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) + 4.4);
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) - 2.3);
  }
  if (hasApaJournalCommitProfile(t, m)) {
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) + 4.2);
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) - 2.1);
  }
  if (hasHarvardParenthesizedQuoted && hasHarvardAvailableAt) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 7.2);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 5.2);
  }
  if (hasQuotedHarvardAvailableAtProfile(t, m) || hasHarvardAvailableAtJournalCommitProfile(t, m)) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 5.4);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 2.4);
  }
  if (hasHarvardAvailableAtBookCommitProfile(t, m)) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 6.4);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 4.6);
    rawScores.set('chicago-author-date', (rawScores.get('chicago-author-date') ?? 0) - 1.2);
  }
  if (hasHarvardBareYearJournalCommitProfile(t, m)) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 5.2);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 3.2);
  }
  if (hasHarvardCorporateReportCommitProfile(t, m)) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 5.8);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 3.6);
  }
  if (hasHarvardParenthesizedQuoted && /\bpp?\.\s*[A-Za-z]?\d/iu.test(t)) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 2.8);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 1.2);
  }
  if (hasHarvardParenthesizedPublisherTail) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 3.8);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 2.2);
  }
  if (/^[^"]{0,160},\s*\d{4}[a-z]?\.\s+/u.test(t) && !/\(\d{4}[a-z]?\)/u.test(t)) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 2.2);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 1.2);
  }
  if (/^[A-Za-z\s'-]+,\s+[A-Z]\.\s*,\s*\d{4}\./u.test(t)) {
    rawScores.set('harvard-ctr', (rawScores.get('harvard-ctr') ?? 0) + 2.4);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 1.1);
  }
  if (/^[A-Z][a-z]+,\s+[A-Z][a-z]+\.\s+\d{4}\./u.test(t)) {
    rawScores.set('chicago-author-date', (rawScores.get('chicago-author-date') ?? 0) + 2.8);
    rawScores.set('apa7', (rawScores.get('apa7') ?? 0) - 1.0);
  }
}

/** AMA conference proceedings: `In … (pp. …). IEEE.` — prefer AMA over Vancouver numeric */
function applyAmaVsVancouverConferenceBoost(
  rawScores: Map<CitationStyle, number>,
  signals: StyleSignalSet,
): void {
  const t = signals.normalizedText;
  const m = signals.matchedSignals;
  if (!m.has('cue_in_container')) {
    return;
  }
  if (!/\bIEEE\.?\s*$/iu.test(t.trim())) {
    return;
  }
  if (m.has('cue_conference') || /\bIn\s+\d{4}/iu.test(t)) {
    rawScores.set('ama', (rawScores.get('ama') ?? 0) + 4.2);
    rawScores.set('vancouver', (rawScores.get('vancouver') ?? 0) - 2.2);
  }
}

function applyVancouverMinimalJournalBoost(
  rawScores: Map<CitationStyle, number>,
  signals: StyleSignalSet,
): void {
  const backbone = stripTrailingIdentifierTail(signals.normalizedText);
  const hasConferenceSpine = hasVancouverConferencePublisherSpine(
    signals.normalizedText,
    signals.matchedSignals,
  );
  if (
    !hasStrongCanonicalVancouverJournalSpine(backbone) &&
    !(
      hasMinimalVancouverJournalSpine(backbone) && !hasSparseMinimalVancouverJournalSpine(backbone)
    ) &&
    !hasConferenceSpine
  ) {
    return;
  }
  if (signals.matchedSignals.has('quoted_title') && !hasConferenceSpine) {
    return;
  }

  rawScores.set('vancouver', (rawScores.get('vancouver') ?? 0) + 4.6);
  rawScores.set('ieee', (rawScores.get('ieee') ?? 0) - 2.4);
  rawScores.set('ama', (rawScores.get('ama') ?? 0) - 1.1);

  if (hasConferenceSpine) {
    rawScores.set('vancouver', (rawScores.get('vancouver') ?? 0) + 4.1);
    rawScores.set('ieee', (rawScores.get('ieee') ?? 0) - 1.8);
  }
}

function applyWebAccessedFamilyBoost(
  rawScores: Map<StyleFamily, number>,
  signals: StyleSignalSet,
): void {
  const matched = signals.matchedSignals;
  if (!matched.has('web_url_without_scholarly_locators')) {
    return;
  }
  const hasTruncatedUrl = /\.{3,}/u.test(signals.normalizedText);

  if (
    matched.has('locator_ieee_signature') ||
    matched.has('locator_semicolon_volume_issue_pages') ||
    matched.has('locator_year_comma_volume_colon_pages') ||
    matched.has('locator_year_comma_volume_colon_identifier') ||
    matched.has('cue_journal_abbrev') ||
    matched.has('quoted_title') ||
    hasHarvardTitleFirstAvailableAtProfile(signals.normalizedText)
  ) {
    return;
  }

  rawScores.set('author_date', (rawScores.get('author_date') ?? 0) - 1.6);
  if (!hasTruncatedUrl) {
    rawScores.set('web_accessed', (rawScores.get('web_accessed') ?? 0) + 2.8);
  }
}

function shouldDowngradeSparseTruncatedWebReference(signals: StyleSignalSet): boolean {
  const matched = signals.matchedSignals;
  if (!matched.has('identifier_url') || !matched.has('web_url_without_scholarly_locators')) {
    return false;
  }

  if (!/\.{3,}/u.test(signals.normalizedText)) {
    return false;
  }

  if (matched.has('identifier_accessed_retrieved') || matched.has('cue_web_access')) {
    return false;
  }

  if (
    matched.has('quoted_title') ||
    matched.has('cue_journal') ||
    matched.has('cue_book_publisher') ||
    matched.has('cue_conference') ||
    matched.has('locator_ieee_signature') ||
    matched.has('locator_semicolon_volume_issue_pages') ||
    matched.has('locator_year_comma_volume_colon_pages') ||
    matched.has('locator_year_comma_volume_colon_identifier') ||
    matched.has('year_parenthesized_after_authors') ||
    matched.has('year_bare_after_authors') ||
    matched.has('author_initials_surname') ||
    matched.has('author_surname_initials')
  ) {
    return false;
  }

  return matched.has('author_bucket_single') || matched.has('numeric_dot_enumerator');
}

function scoreStyleFamily(
  signals: StyleSignalSet,
  mlHint?: StyleDetectionPrediction | null,
): FamilyScoringResult {
  const rawScores = new Map<StyleFamily, number>();
  for (const family of Object.keys(FAMILY_SIGNAL_WEIGHTS) as Array<
    Exclude<StyleFamily, 'unknown'>
  >) {
    rawScores.set(
      family,
      scoreSignalWeights(signals.matchedSignals, FAMILY_SIGNAL_WEIGHTS[family]),
    );
  }

  applyNumericIeeeJournalSpineBoost(rawScores, signals);
  applyCurriculumFormatFamilyBoosts(rawScores, signals);
  applyWebAccessedFamilyBoost(rawScores, signals);
  applyMlFamilyHint(rawScores, signals, mlHint);
  const conflictDampened = applyConflictDampening(rawScores, signals);

  const normalized = normalizeScores(rawScores)
    .map(({ key, normalizedScore, rawScore }) => ({
      family: key as StyleFamily,
      rawScore,
      normalizedScore,
      confidence: normalizedScore * evidenceFactor(rawScore, 4.5),
    }))
    .sort((left, right) => right.confidence - left.confidence);

  return {
    candidates: normalized.map((candidate) => ({
      family: candidate.family,
      score: candidate.confidence,
    })),
    conflictDampened,
  };
}

function scoreExactStyle(
  signals: StyleSignalSet,
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>,
  mlHint?: StyleDetectionPrediction | null,
): StyleCandidateScore[] {
  const rawScores = new Map<CitationStyle, number>();
  const familyWeights = EXACT_STYLE_SIGNAL_WEIGHTS[family];
  for (const style of EXACT_STYLES_BY_FAMILY[family]) {
    // Keys come from EXACT_STYLES_BY_FAMILY only; optional row falls back to family weights via {}.
    const row = familyWeights[style as keyof typeof familyWeights] ?? {};
    rawScores.set(style, scoreSignalWeights(signals.matchedSignals, row));
  }

  applyMlStyleHint(rawScores, signals, mlHint);
  if (family === 'author_date') {
    applyAuthorDateHarvardChicagoExactBoost(rawScores, signals);
    applyAuthorDatePairwiseBoost(rawScores, signals);
  }
  if (family === 'notes_bibliography') {
    applyChicagoNotesVsMlaExactBoost(rawScores, signals);
    applyNotesBibliographyPairwiseBoost(rawScores, signals);
  }
  if (family === 'numeric') {
    applyAmaVsVancouverConferenceBoost(rawScores, signals);
    applyVancouverMinimalJournalBoost(rawScores, signals);
    applyIeeeBookBoost(rawScores, signals);
    applyNumericPairwiseBoost(rawScores, signals);
  }

  return normalizeScores(rawScores)
    .map(({ key, normalizedScore, rawScore }) => ({
      style: key,
      score: normalizedScore * evidenceFactor(rawScore, 3.2),
    }))
    .sort((left, right) => right.score - left.score);
}

function resolveWebAccessedFallbackStyle(
  signals: StyleSignalSet,
  mlHint?: StyleDetectionPrediction | null,
): {
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>;
  style: CitationStyle;
  styleConfidence: number;
  styleMarginToRunnerUp: number;
  styleCandidates: StyleCandidateScore[];
} | null {
  if (
    hasHarvardPatentAvailableAtProfile(signals.normalizedText) ||
    hasQuotedHarvardAvailableAtProfile(signals.normalizedText, signals.matchedSignals)
  ) {
    const styleCandidates = scoreExactStyle(signals, 'author_date', mlHint);
    const harvardCandidate = styleCandidates.find(
      (candidate) => candidate.style === 'harvard-ctr',
    ) ?? { style: 'harvard-ctr' as const, score: 0.62 };
    const runnerUpScore =
      styleCandidates
        .filter((candidate) => candidate.style !== 'harvard-ctr')
        .map((candidate) => candidate.score)
        .sort((left, right) => right - left)[0] ?? 0.34;
    const styleMarginToRunnerUp = Math.max(0.02, harvardCandidate.score - runnerUpScore);

    return {
      family: 'author_date',
      style: 'harvard-ctr',
      styleConfidence: Math.max(0.62, harvardCandidate.score),
      styleMarginToRunnerUp,
      styleCandidates:
        styleCandidates.length > 0
          ? styleCandidates.slice(0, 3)
          : [{ style: 'harvard-ctr', score: 0.62 }],
    };
  }

  if (hasChicagoPatentIssuedCommitProfile(signals.normalizedText)) {
    const styleCandidates = scoreExactStyle(signals, 'notes_bibliography', mlHint);
    const chicagoCandidate = styleCandidates.find(
      (candidate) => candidate.style === 'chicago-notes-bib',
    ) ?? { style: 'chicago-notes-bib' as const, score: 0.62 };
    const runnerUpScore =
      styleCandidates
        .filter((candidate) => candidate.style !== 'chicago-notes-bib')
        .map((candidate) => candidate.score)
        .sort((left, right) => right - left)[0] ?? 0.34;
    const styleMarginToRunnerUp = Math.max(0.02, chicagoCandidate.score - runnerUpScore);

    return {
      family: 'notes_bibliography',
      style: 'chicago-notes-bib',
      styleConfidence: Math.max(0.62, chicagoCandidate.score),
      styleMarginToRunnerUp,
      styleCandidates:
        styleCandidates.length > 0
          ? styleCandidates.slice(0, 3)
          : [{ style: 'chicago-notes-bib', score: 0.62 }],
    };
  }

  if (hasApaWebpageCommitProfile(signals.normalizedText, signals.matchedSignals)) {
    const styleCandidates = scoreExactStyle(signals, 'author_date', mlHint);
    const apaCandidate = styleCandidates.find((candidate) => candidate.style === 'apa7') ?? {
      style: 'apa7' as const,
      score: 0.64,
    };
    const runnerUpScore =
      styleCandidates
        .filter((candidate) => candidate.style !== 'apa7')
        .map((candidate) => candidate.score)
        .sort((left, right) => right - left)[0] ?? 0.34;
    const styleMarginToRunnerUp = Math.max(0.04, apaCandidate.score - runnerUpScore);

    return {
      family: 'author_date',
      style: 'apa7',
      styleConfidence: Math.max(0.64, apaCandidate.score),
      styleMarginToRunnerUp,
      styleCandidates:
        styleCandidates.length > 0
          ? styleCandidates.slice(0, 3)
          : [{ style: 'apa7', score: 0.64 }],
    };
  }

  if (hasMlaWebpageCommitProfile(signals.normalizedText)) {
    const styleCandidates = scoreExactStyle(signals, 'notes_bibliography', mlHint);
    const mlaCandidate = styleCandidates.find((candidate) => candidate.style === 'mla9') ?? {
      style: 'mla9' as const,
      score: 0.64,
    };
    const runnerUpScore =
      styleCandidates
        .filter((candidate) => candidate.style !== 'mla9')
        .map((candidate) => candidate.score)
        .sort((left, right) => right - left)[0] ?? 0.34;
    const styleMarginToRunnerUp = Math.max(0.04, mlaCandidate.score - runnerUpScore);

    return {
      family: 'notes_bibliography',
      style: 'mla9',
      styleConfidence: Math.max(0.64, mlaCandidate.score),
      styleMarginToRunnerUp,
      styleCandidates:
        styleCandidates.length > 0
          ? styleCandidates.slice(0, 3)
          : [{ style: 'mla9', score: 0.64 }],
    };
  }

  if (hasChicagoWebpageCommitProfile(signals.normalizedText)) {
    const styleCandidates = scoreExactStyle(signals, 'notes_bibliography', mlHint);
    const chicagoCandidate = styleCandidates.find(
      (candidate) => candidate.style === 'chicago-notes-bib',
    ) ?? { style: 'chicago-notes-bib' as const, score: 0.64 };
    const runnerUpScore =
      styleCandidates
        .filter((candidate) => candidate.style !== 'chicago-notes-bib')
        .map((candidate) => candidate.score)
        .sort((left, right) => right - left)[0] ?? 0.34;
    const styleMarginToRunnerUp = Math.max(0.04, chicagoCandidate.score - runnerUpScore);

    return {
      family: 'notes_bibliography',
      style: 'chicago-notes-bib',
      styleConfidence: Math.max(0.64, chicagoCandidate.score),
      styleMarginToRunnerUp,
      styleCandidates:
        styleCandidates.length > 0
          ? styleCandidates.slice(0, 3)
          : [{ style: 'chicago-notes-bib', score: 0.64 }],
    };
  }

  return null;
}

function applyIeeeBookBoost(rawScores: Map<CitationStyle, number>, signals: StyleSignalSet): void {
  if (
    !hasIeeeBookSpine(signals.normalizedText, signals.matchedSignals) &&
    !hasRelaxedIeeeBookCommitProfile(signals.normalizedText, signals.matchedSignals) &&
    !hasIeeeEnumeratedBookDoiCommitProfile(signals.normalizedText, signals.matchedSignals)
  ) {
    return;
  }

  rawScores.set('ieee', (rawScores.get('ieee') ?? 0) + 5.2);
  rawScores.set('vancouver', (rawScores.get('vancouver') ?? 0) - 2.6);
  rawScores.set('ama', (rawScores.get('ama') ?? 0) - 1.4);
}

function applyAuthorDatePairwiseBoost(
  rawScores: Map<CitationStyle, number>,
  signals: StyleSignalSet,
): void {
  if (hasApaWebpageCommitProfile(signals.normalizedText, signals.matchedSignals)) {
    adjustStyleScore(rawScores, 'apa7', 4.2);
    adjustStyleScore(rawScores, 'harvard-ctr', -2.2);
    adjustStyleScore(rawScores, 'chicago-author-date', -1.1);
    return;
  }

  if (hasApaPairwiseExactCommitProfile(signals)) {
    adjustStyleScore(rawScores, 'apa7', 3.8);
    adjustStyleScore(rawScores, 'harvard-ctr', -1.9);
    adjustStyleScore(rawScores, 'chicago-author-date', -1.1);
    return;
  }

  if (hasHarvardPairwiseExactCommitProfile(signals)) {
    adjustStyleScore(rawScores, 'harvard-ctr', 3.8);
    adjustStyleScore(rawScores, 'apa7', -1.9);
    adjustStyleScore(rawScores, 'chicago-author-date', -0.9);
  }
}

function applyNumericPairwiseBoost(
  rawScores: Map<CitationStyle, number>,
  signals: StyleSignalSet,
): void {
  if (hasVancouverEnumeratedWebpageCommitProfile(signals.normalizedText, signals.matchedSignals)) {
    adjustStyleScore(rawScores, 'vancouver', 4.2);
    adjustStyleScore(rawScores, 'ieee', -2.1);
    adjustStyleScore(rawScores, 'ama', -0.9);
    adjustStyleScore(rawScores, 'acs', -0.7);
    return;
  }

  if (hasIeeePairwiseExactCommitProfile(signals)) {
    adjustStyleScore(rawScores, 'ieee', 4.4);
    adjustStyleScore(rawScores, 'vancouver', -2.2);
    adjustStyleScore(rawScores, 'ama', -1.4);
    adjustStyleScore(rawScores, 'acs', -0.8);
    return;
  }

  if (hasVancouverPairwiseExactCommitProfile(signals)) {
    adjustStyleScore(rawScores, 'vancouver', 4.1);
    adjustStyleScore(rawScores, 'ieee', -2.0);
    adjustStyleScore(rawScores, 'ama', -0.8);
    adjustStyleScore(rawScores, 'acs', -0.6);
  }
}

function applyNotesBibliographyPairwiseBoost(
  rawScores: Map<CitationStyle, number>,
  signals: StyleSignalSet,
): void {
  if (
    hasChicagoPreferredNotesCommitProfile(
      signals.normalizedText,
      signals.matchedSignals,
    )
  ) {
    adjustStyleScore(rawScores, 'chicago-notes-bib', 4.2);
    adjustStyleScore(rawScores, 'mla9', -2.1);
    return;
  }

  if (hasMlaWebpageCommitProfile(signals.normalizedText)) {
    adjustStyleScore(rawScores, 'mla9', 4.2);
    adjustStyleScore(rawScores, 'chicago-notes-bib', -2.2);
    return;
  }

  if (
    hasMlaWorksCitedJournalSpine(signals.normalizedText) ||
    hasMlaWorksCitedJournalNoPagesSpine(signals.normalizedText)
  ) {
    adjustStyleScore(rawScores, 'mla9', 4.1);
    adjustStyleScore(rawScores, 'chicago-notes-bib', -2.1);
    return;
  }

  if (
    hasMlaPublisherCommaYearIdentifierProfile(signals.normalizedText) ||
    hasMlaQuotedRepositoryIdentifierCommitProfile(signals.normalizedText) ||
    hasMlaThesisIdentifierCommitProfile(signals.normalizedText) ||
    hasMlaQuotedTailCommitProfile(signals.normalizedText) ||
    hasMlaPreprintCommitProfile(signals.normalizedText)
  ) {
    adjustStyleScore(rawScores, 'mla9', 4.2);
    adjustStyleScore(rawScores, 'chicago-notes-bib', -2.2);
    return;
  }

  if (hasChicagoPairwiseExactCommitProfile(signals)) {
    adjustStyleScore(rawScores, 'chicago-notes-bib', 3.4);
    adjustStyleScore(rawScores, 'mla9', -1.7);
    return;
  }

  if (hasMlaPairwiseExactCommitProfile(signals)) {
    adjustStyleScore(rawScores, 'mla9', 3.4);
    adjustStyleScore(rawScores, 'chicago-notes-bib', -1.7);
  }
}

function adjustStyleScore(
  rawScores: Map<CitationStyle, number>,
  style: CitationStyle,
  delta: number,
): void {
  rawScores.set(style, (rawScores.get(style) ?? 0) + delta);
}

function resolveStructuralFamilyGate(signals: StyleSignalSet): StructuralFamilyGate | null {
  const text = signals.normalizedText;
  const matched = signals.matchedSignals;
  const stripped = stripTrailingIdentifierTail(text);
  const hasExplicitWebAccessSignals =
    matched.has('identifier_accessed_retrieved') ||
    matched.has('web_url_without_scholarly_locators') ||
    matched.has('cue_web_access');
  const hasScholarlySpineSignals =
    matched.has('quoted_title') ||
    matched.has('cue_in_container') ||
    matched.has('cue_conference') ||
    matched.has('cue_journal') ||
    matched.has('cue_journal_abbrev') ||
    matched.has('cue_book_publisher') ||
    matched.has('locator_ieee_signature') ||
    matched.has('locator_semicolon_volume_issue_pages') ||
    matched.has('locator_year_comma_volume_colon_pages') ||
    matched.has('locator_year_comma_volume_colon_identifier') ||
    matched.has('locator_vol') ||
    matched.has('locator_no') ||
    matched.has('locator_pp') ||
    matched.has('locator_page_range_only');
  const hasStrongAuthorDateFrontProfile =
    hasFrontParenthesizedYearLead(text) &&
    hasAuthorLikeLeadBeforeFrontYear(text) &&
    hasPostYearTitleCadence(text);
  const hasNumericEnumerator =
    matched.has('bracketed_enumerator') ||
    matched.has('numeric_dot_enumerator') ||
    matched.has('numeric_paren_enumerator');
  const hasEnumeratedPatentNumericProfile =
    hasNumericEnumerator &&
    (/\b(?:(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)[A-Z0-9/-]{5,}|patent)\b/iu.test(text) ||
      /\[Online\]/iu.test(text) ||
      /\bAvailable:\s*https?:\/\/[^\s]+/iu.test(text)) &&
    /\b(?:19|20)\d{2}\b/u.test(text);
  const hasEnumeratedThesisNumericProfile = hasVancouverEnumeratedThesisCommitProfile(
    text,
    matched,
  );

  if (hasStrongAuthorDateFrontProfile) {
    return {
      family: 'author_date',
      confidence: 0.84,
      marginToRunnerUp: 0.18,
    };
  }

  if (hasHarvardTitleFirstAvailableAtProfile(text)) {
    return {
      family: 'author_date',
      confidence: 0.78,
      marginToRunnerUp: 0.14,
    };
  }

  if (
    hasHarvardPatentAvailableAtProfile(text) ||
    hasQuotedHarvardAvailableAtProfile(text, matched) ||
    hasApaPatentTitleYearCommitProfile(text, matched)
  ) {
    return {
      family: 'author_date',
      confidence: 0.8,
      marginToRunnerUp: 0.16,
    };
  }

  if (hasExplicitWebAccessSignals && !hasScholarlySpineSignals) {
    return null;
  }

  if (hasEnumeratedPatentNumericProfile) {
    return {
      family: 'numeric',
      confidence: 0.8,
      marginToRunnerUp: 0.15,
    };
  }

  if (
    hasIeeeQuotedInstitutionalReportCommitProfile(text, matched) ||
    hasVancouverEnumeratedPatentNumberCommitProfile(text, matched) ||
    hasVancouverEnumeratedRepositoryIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedRfcWebCommitProfile(text, matched)
  ) {
    return {
      family: 'numeric',
      confidence: 0.84,
      marginToRunnerUp: 0.18,
    };
  }

  if (
    hasVancouverEnumeratedSemicolonIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedBareYearIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedQuotedPreprintCommitProfile(text, matched)
  ) {
    return {
      family: 'numeric',
      confidence: 0.84,
      marginToRunnerUp: 0.18,
    };
  }

  if (hasIeeeOnlineReferenceCommitProfile(text, matched)) {
    return {
      family: 'numeric',
      confidence: 0.84,
      marginToRunnerUp: 0.18,
    };
  }

  if (hasEnumeratedThesisNumericProfile) {
    return {
      family: 'numeric',
      confidence: 0.83,
      marginToRunnerUp: 0.18,
    };
  }

  const authorDateEvidence = countTrue([
    !hasLeadingEnumerator(text),
    matched.has('year_parenthesized_after_authors') || matched.has('year_bare_after_authors'),
    matched.has('author_year_lead') ||
      matched.has('author_initials_surname') ||
      matched.has('author_separator_ampersand') ||
      matched.has('author_separator_and'),
    matched.has('cue_journal') ||
      matched.has('cue_book_publisher') ||
      matched.has('quoted_title') ||
      /\bAvailable at:/iu.test(text),
  ]);
  const numericEvidence = countTrue([
    hasNumericEnumerator,
    matched.has('author_surname_initials') || matched.has('author_initials_surname'),
    matched.has('locator_semicolon_volume_issue_pages') ||
      matched.has('locator_ieee_signature') ||
      matched.has('locator_vol') ||
      matched.has('locator_pp') ||
      /;\s*(?:\d+|\?)(?:\((?:[^)]+|\?)\))?:(?:\s*)?[A-Za-z]?\d/u.test(stripped) ||
      /;\s*(?:19|20)\d{2},\s*p{1,2}\.?\s*[A-Za-z]?\d/iu.test(text),
    matched.has('year_end_position') || matched.has('identifier_doi'),
  ]);
  const notesEvidence = countTrue([
    !hasLeadingEnumerator(text),
    !matched.has('year_parenthesized_after_authors') && !matched.has('year_bare_after_authors'),
    matched.has('quoted_title') ||
      matched.has('cue_in_container') ||
      matched.has('cue_book_publisher'),
    matched.has('year_end_position') ||
      /\b(?:19|20)\d{2}\.?$/u.test(stripped) ||
      /\b(?:19|20)\d{2}\)\s*:\s*[A-Za-z]?\d/u.test(stripped),
  ]);

  if (numericEvidence >= 3) {
    return {
      family: 'numeric',
      confidence: numericEvidence >= 4 ? 0.82 : 0.76,
      marginToRunnerUp: numericEvidence >= 4 ? 0.18 : 0.12,
    };
  }

  if (authorDateEvidence >= 3) {
    return {
      family: 'author_date',
      confidence: authorDateEvidence >= 4 ? 0.8 : 0.74,
      marginToRunnerUp: authorDateEvidence >= 4 ? 0.16 : 0.11,
    };
  }

  if (notesEvidence >= 3) {
    return {
      family: 'notes_bibliography',
      confidence: notesEvidence >= 4 ? 0.78 : 0.72,
      marginToRunnerUp: notesEvidence >= 4 ? 0.14 : 0.1,
    };
  }

  return null;
}

function resolveFamilyScopedExactStyleOverride(
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>,
  signals: StyleSignalSet,
): FamilyScopedStyleOverride | null {
  switch (family) {
    case 'author_date':
      if (hasApaPairwiseExactCommitProfile(signals)) {
        return {
          style: 'apa7',
          styleConfidence: 0.66,
          styleMarginToRunnerUp: 0.1,
        };
      }
      if (hasHarvardPairwiseExactCommitProfile(signals)) {
        return {
          style: 'harvard-ctr',
          styleConfidence: 0.66,
          styleMarginToRunnerUp: 0.1,
        };
      }
      return null;
    case 'numeric':
      if (hasIeeePairwiseExactCommitProfile(signals)) {
        return {
          style: 'ieee',
          styleConfidence: 0.68,
          styleMarginToRunnerUp: 0.11,
        };
      }
      if (hasVancouverPairwiseExactCommitProfile(signals)) {
        return {
          style: 'vancouver',
          styleConfidence: 0.68,
          styleMarginToRunnerUp: 0.11,
        };
      }
      return null;
    case 'notes_bibliography':
      if (hasChicagoPairwiseExactCommitProfile(signals)) {
        return {
          style: 'chicago-notes-bib',
          styleConfidence: 0.64,
          styleMarginToRunnerUp: 0.1,
        };
      }
      if (hasMlaPairwiseExactCommitProfile(signals)) {
        return {
          style: 'mla9',
          styleConfidence: 0.64,
          styleMarginToRunnerUp: 0.1,
        };
      }
      return null;
  }
}

function upsertFamilyCandidateScore(
  candidates: StyleFamilyCandidateScore[],
  family: StyleFamily,
  score: number,
): StyleFamilyCandidateScore[] {
  const next = candidates
    .filter((candidate) => candidate.family !== family)
    .concat({ family, score });
  return next.sort((left, right) => right.score - left.score).slice(0, 4);
}

function upsertStyleCandidateScore(
  candidates: StyleCandidateScore[],
  style: CitationStyle,
  score: number,
): StyleCandidateScore[] {
  const next = candidates.filter((candidate) => candidate.style !== style).concat({ style, score });
  return next.sort((left, right) => right.score - left.score).slice(0, 3);
}

function countTrue(values: boolean[]): number {
  return values.filter(Boolean).length;
}

function scoreSignalWeights(
  matchedSignals: Set<StyleSignalCode>,
  table: SignalWeightTable,
): number {
  let total = 0;
  for (const [code, weight] of Object.entries(table) as Array<[StyleSignalCode, number]>) {
    if (matchedSignals.has(code)) {
      total += weight;
    }
  }
  return total;
}

function applyMlFamilyHint(
  rawScores: Map<StyleFamily, number>,
  signals: StyleSignalSet,
  mlHint?: StyleDetectionPrediction | null,
): void {
  if (!mlHint) {
    return;
  }

  const primaryFamily = styleFamilyForStyle(mlHint.primary.style);
  if (primaryFamily !== 'unknown' && isMlHintSafeForSignals(signals, mlHint.primary.style)) {
    rawScores.set(
      primaryFamily,
      (rawScores.get(primaryFamily) ?? 0) + Math.max(0.05, mlHint.primary.confidence * 0.25),
    );
  }

  if (mlHint.secondary && isMlHintSafeForSignals(signals, mlHint.secondary.style)) {
    const secondaryFamily = styleFamilyForStyle(mlHint.secondary.style);
    if (secondaryFamily !== 'unknown') {
      rawScores.set(
        secondaryFamily,
        (rawScores.get(secondaryFamily) ?? 0) + Math.max(0.03, mlHint.secondary.confidence * 0.12),
      );
    }
  }
}

function applyMlStyleHint(
  rawScores: Map<CitationStyle, number>,
  signals: StyleSignalSet,
  mlHint?: StyleDetectionPrediction | null,
): void {
  if (!mlHint) {
    return;
  }

  if (
    rawScores.has(mlHint.primary.style) &&
    isMlHintSafeForSignals(signals, mlHint.primary.style)
  ) {
    rawScores.set(
      mlHint.primary.style,
      (rawScores.get(mlHint.primary.style) ?? 0) + Math.max(0.04, mlHint.primary.confidence * 0.18),
    );
  }

  if (
    mlHint.secondary &&
    rawScores.has(mlHint.secondary.style) &&
    isMlHintSafeForSignals(signals, mlHint.secondary.style)
  ) {
    rawScores.set(
      mlHint.secondary.style,
      (rawScores.get(mlHint.secondary.style) ?? 0) +
        Math.max(0.02, mlHint.secondary.confidence * 0.1),
    );
  }
}

function isMlHintSafeForSignals(signals: StyleSignalSet, style: CitationStyle): boolean {
  const enumerated = /^\s*(?:\[\d+\]|\d+[.)]|\(\d+\))/u.test(signals.normalizedText);
  const hasThesisMarker =
    /\b(?:doctoral dissertation|phd thesis|master'?s thesis|dissertation|thesis)\b/iu.test(
      signals.normalizedText,
    );

  if (style === 'apa7') {
    return !enumerated || signals.matchedSignals.has('year_parenthesized_after_authors');
  }

  if (style === 'harvard-ctr') {
    return (
      !enumerated &&
      (hasHarvardBareYearJournalCommitProfile(signals.normalizedText, signals.matchedSignals) ||
        hasRelaxedHarvardCtrCommitProfile(signals) ||
        /\bAvailable at:/iu.test(signals.normalizedText) ||
        signals.matchedSignals.has('year_parenthesized_after_authors'))
    );
  }

  if (style === 'ieee') {
    return (
      !hasThesisMarker &&
      !hasVancouverConferencePublisherSpine(signals.normalizedText, signals.matchedSignals)
    );
  }

  return true;
}

function resolveTrustedMlStyleOverride(
  signals: StyleSignalSet,
  mlHint?: StyleDetectionPrediction | null,
): MlTrustedStyleOverride | null {
  if (!mlHint || mlHint.primary.style === 'unknown') {
    return null;
  }

  const primaryStyle = mlHint.primary.style;
  const family = styleFamilyForStyle(primaryStyle);
  if (family === 'unknown' || family === 'web_accessed') {
    return null;
  }

  const marginToRunnerUp = Math.max(
    0,
    mlHint.primary.confidence - (mlHint.secondary?.confidence ?? 0),
  );
  const styleCandidates: StyleCandidateScore[] = [
    {
      style: primaryStyle,
      score: mlHint.primary.confidence,
    },
  ];
  if (mlHint.secondary && styleFamilyForStyle(mlHint.secondary.style) === family) {
    styleCandidates.push({
      style: mlHint.secondary.style,
      score: mlHint.secondary.confidence,
    });
  }

  const enumerated = /^\s*(?:\[\d+\]|\d+[.)]|\(\d+\))/u.test(signals.normalizedText);
  if (!isMlHintSafeForSignals(signals, primaryStyle)) {
    return null;
  }

  if (
    primaryStyle === 'apa7' &&
    mlHint.primary.confidence >= 0.98 &&
    !enumerated &&
    !/\bAvailable at:/iu.test(signals.normalizedText)
  ) {
    return {
      family: 'author_date',
      style: 'apa7',
      familyConfidence: Math.max(0.84, mlHint.primary.confidence),
      styleConfidence: mlHint.primary.confidence,
      styleMarginToRunnerUp: Math.max(0.06, marginToRunnerUp),
      styleCandidates,
    };
  }

  if (
    primaryStyle === 'harvard-ctr' &&
    mlHint.primary.confidence >= 0.95 &&
    !enumerated &&
    /\bAvailable at:/iu.test(signals.normalizedText)
  ) {
    return {
      family: 'author_date',
      style: 'harvard-ctr',
      familyConfidence: Math.max(0.82, mlHint.primary.confidence),
      styleConfidence: mlHint.primary.confidence,
      styleMarginToRunnerUp: Math.max(0.05, marginToRunnerUp),
      styleCandidates,
    };
  }

  if (primaryStyle === 'ieee' && mlHint.primary.confidence >= 0.97 && enumerated) {
    return {
      family: 'numeric',
      style: 'ieee',
      familyConfidence: Math.max(0.84, mlHint.primary.confidence),
      styleConfidence: mlHint.primary.confidence,
      styleMarginToRunnerUp: Math.max(0.05, marginToRunnerUp),
      styleCandidates,
    };
  }

  if (
    primaryStyle === 'vancouver' &&
    mlHint.primary.confidence >= 0.95 &&
    enumerated &&
    hasVancouverPairwiseExactCommitProfile(signals)
  ) {
    return {
      family: 'numeric',
      style: 'vancouver',
      familyConfidence: Math.max(0.84, mlHint.primary.confidence),
      styleConfidence: mlHint.primary.confidence,
      styleMarginToRunnerUp: Math.max(0.05, marginToRunnerUp),
      styleCandidates,
    };
  }

  if (
    primaryStyle === 'mla9' &&
    mlHint.primary.confidence >= 0.94 &&
    !enumerated &&
    hasMlaPairwiseExactCommitProfile(signals)
  ) {
    return {
      family: 'notes_bibliography',
      style: 'mla9',
      familyConfidence: Math.max(0.82, mlHint.primary.confidence),
      styleConfidence: mlHint.primary.confidence,
      styleMarginToRunnerUp: Math.max(0.05, marginToRunnerUp),
      styleCandidates,
    };
  }

  if (
    primaryStyle === 'chicago-notes-bib' &&
    mlHint.primary.confidence >= 0.94 &&
    !enumerated &&
    hasChicagoPairwiseExactCommitProfile(signals)
  ) {
    return {
      family: 'notes_bibliography',
      style: 'chicago-notes-bib',
      familyConfidence: Math.max(0.82, mlHint.primary.confidence),
      styleConfidence: mlHint.primary.confidence,
      styleMarginToRunnerUp: Math.max(0.05, marginToRunnerUp),
      styleCandidates,
    };
  }

  return null;
}

function applyConflictDampening(
  rawScores: Map<StyleFamily, number>,
  signals: StyleSignalSet,
): boolean {
  const hasEnumeratedLead =
    signals.matchedSignals.has('bracketed_enumerator') ||
    signals.matchedSignals.has('numeric_dot_enumerator') ||
    signals.matchedSignals.has('numeric_paren_enumerator') ||
    signals.matchedSignals.has('parenthesized_enumerator');
  const hasAmbiguousMixedEnumeratedFamilyConflict = hasAmbiguousEnumeratedMixedFamilyConflict(
    signals.normalizedText,
    signals.matchedSignals,
  );
  if (
    hasStrongIeeeEnumeratedJournalSpine(signals.normalizedText, signals.matchedSignals) ||
    hasMlaWorksCitedJournalSpine(signals.normalizedText) ||
    hasChicagoNotesJournalSpine(signals.normalizedText) ||
    (hasMinimalVancouverJournalSpine(stripTrailingIdentifierTail(signals.normalizedText)) &&
      !hasSparseMinimalVancouverJournalSpine(
        stripTrailingIdentifierTail(signals.normalizedText),
      )) ||
    signals.matchedSignals.has('locator_ieee_signature') ||
    hasStrongCanonicalVancouverJournalSpine(stripTrailingIdentifierTail(signals.normalizedText)) ||
    (!hasEnumeratedLead &&
      (signals.matchedSignals.has('year_parenthesized_after_authors') ||
        signals.matchedSignals.has('year_bare_after_authors'))) ||
    hasAmbiguousMixedEnumeratedFamilyConflict
  ) {
    if (!hasAmbiguousMixedEnumeratedFamilyConflict) {
      return false;
    }
  }

  const strongFamilies = (
    Object.keys(FAMILY_STRONG_SIGNALS) as Array<Exclude<StyleFamily, 'unknown'>>
  ).filter((family) =>
    FAMILY_STRONG_SIGNALS[family].some((code) => signals.matchedSignals.has(code)),
  );

  if (strongFamilies.length < 2 && !hasAmbiguousMixedEnumeratedFamilyConflict) {
    return false;
  }

  const ranked = [...rawScores.entries()].sort((left, right) => right[1] - left[1]);
  const topFamily = ranked[0]?.[0];
  if (!topFamily) {
    return false;
  }

  rawScores.set(topFamily, (rawScores.get(topFamily) ?? 0) * 0.8);
  return true;
}

function normalizeScores<T extends string>(
  rawScores: Map<T, number>,
): Array<{ key: T; rawScore: number; normalizedScore: number }> {
  const entries = [...rawScores.entries()].map(
    ([key, rawScore]) => [key, Number.isFinite(rawScore) ? rawScore : 0] as const,
  );
  if (entries.length === 0) {
    return [];
  }

  const values = entries.map(([, rawScore]) => rawScore);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return entries.map(([key, rawScore]) => ({
    key,
    rawScore,
    normalizedScore: max === min ? (rawScore > 0 ? 1 : 0) : (rawScore - min) / (max - min),
  }));
}

function evidenceFactor(rawScore: number, saturationPoint: number): number {
  if (!Number.isFinite(rawScore) || !Number.isFinite(saturationPoint) || saturationPoint <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, rawScore / saturationPoint));
}

function capUnknownFamilyConfidence(input: {
  familyConfidence: number;
  familyMarginToRunnerUp: number;
  minimumSignalCount: number;
  topFamilyKnown: boolean;
}): number {
  if (!input.topFamilyKnown) {
    return Math.min(input.familyConfidence, 0.4);
  }

  const marginFactor =
    input.familyMarginToRunnerUp < STYLE_DETECTION_THRESHOLDS.familyCommitMargin
      ? input.familyMarginToRunnerUp / STYLE_DETECTION_THRESHOLDS.familyCommitMargin
      : 1;
  const signalFactor =
    input.minimumSignalCount < STYLE_DETECTION_THRESHOLDS.signalGroupMinimum
      ? input.minimumSignalCount / STYLE_DETECTION_THRESHOLDS.signalGroupMinimum
      : 1;

  return Math.max(
    0,
    Math.min(
      input.familyConfidence,
      STYLE_DETECTION_THRESHOLDS.familyCommitConfidence - 0.01,
      marginFactor,
      signalFactor,
    ),
  );
}

function extractAuthorLead(normalizedText: string): string {
  const quotedTitleIndex = normalizedText.indexOf('"');
  if (quotedTitleIndex > 0) {
    return normalizedText
      .slice(0, quotedTitleIndex)
      .replace(/[,\s]+$/u, '')
      .trim();
  }

  const yearIndex = normalizedText.search(STYLE_YEAR_REGEX);
  if (yearIndex > 0) {
    return normalizedText.slice(0, yearIndex).trim();
  }

  const firstPeriodIndex = normalizedText.indexOf('.');
  if (firstPeriodIndex > 0) {
    return normalizedText.slice(0, firstPeriodIndex + 1).trim();
  }

  return normalizedText.slice(0, Math.min(90, normalizedText.length)).trim();
}

function stripLeadingEnumerator(normalizedText: string): string {
  return normalizedText.replace(/^\s*(?:\[\d+\]|\d+[.)]|\(\d+\))(?:\s+|(?=\S))/u, '').trimStart();
}

function detectAuthorSeparator(
  authorLead: string,
): 'comma' | 'semicolon' | 'and' | 'ampersand' | 'none' {
  if (authorLead.includes(';')) {
    return 'semicolon';
  }
  if (authorLead.includes('&')) {
    return 'ampersand';
  }
  if (/\band\b/iu.test(authorLead)) {
    return 'and';
  }
  if (authorLead.includes(',')) {
    return 'comma';
  }
  return 'none';
}

function detectAuthorBucket(
  authorLead: string,
  separator: 'comma' | 'semicolon' | 'and' | 'ampersand' | 'none',
  hasEtAl: boolean,
): 'single' | 'few' | 'many' {
  if (hasEtAl) {
    return 'many';
  }

  const baseCount =
    separator === 'semicolon'
      ? authorLead.split(';').filter(Boolean).length
      : separator === 'ampersand'
        ? authorLead.split('&').filter(Boolean).length
        : separator === 'and'
          ? authorLead.split(/\band\b/iu).filter(Boolean).length
          : separator === 'comma'
            ? Math.max(1, authorLead.split(',').filter(Boolean).length - 1)
            : 1;

  if (baseCount >= 4) {
    return 'many';
  }
  if (baseCount >= 2) {
    return 'few';
  }
  return 'single';
}

function repeatedConferenceYear(normalizedText: string): boolean {
  const matches = [...normalizedText.matchAll(/\b((?:1[6-9]|20)\d{2})\b/gu)].map(
    (match) => match[1],
  );
  if (matches.length < 2) {
    return false;
  }

  return (
    matches.some((year, index) => matches.indexOf(year) !== index) ||
    (STYLE_CONFERENCE_CUE_REGEX.test(normalizedText) && matches.length >= 2)
  );
}

function hasLeadingEnumerator(normalizedText: string): boolean {
  return /^\s*(?:\[\d+\]|\d+[.)]|\(\d+\))(?:\s+|(?=\S))/u.test(normalizedText);
}

function hasMlaWorksCitedJournalSpine(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  return /"[^"]{4,}"[.,]?\s+.+?,\s*vol\.\s*(?:\d+|\?),\s*(?:no(?:s)?\.\s*[^,]+,\s*)?(?:19|20)\d{2},\s*pp?\.\s*[A-Za-z]?\d/iu.test(
    backbone,
  );
}

function hasMlaWorksCitedBookSpine(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  if (/\.\s*"?.{4,}"?\.?\s+In\s+/iu.test(backbone)) {
    return false;
  }

  return (
    /^[^"]{2,180}\.\s+.+?[.?!]\s+.+?,\s*(?:1[6-9]|20)\d{2}(?:,\s*(?:pp?\.)?|\s*$|,\s*(?:https?:\/\/|doi:\s*10\.|10\.))/iu.test(
      backbone,
    ) ||
    /^[^"]{2,180}\.\s+.+?\.\s+.+?,\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone) ||
    (STYLE_BOOK_PUBLISHER_CUE_REGEX.test(text) &&
      /^[^"]{2,240}\.\s+.+?[.?!]\s+.+?,\s*(?:1[6-9]|20)\d{2},\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(
        text,
      ))
  );
}

function hasMlaWorksCitedBookUrlTailProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  return (
    STYLE_BOOK_PUBLISHER_CUE_REGEX.test(text) &&
    /^[^"]{2,240}\.\s+.+?[.?!]\s+.+?,\s*(?:1[6-9]|20)\d{2},\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(
      text,
    )
  );
}

function hasChicagoNotesJournalSpine(text: string): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  if (/\bvol\.\s*\d+/iu.test(backbone)) {
    return false;
  }

  return /(?:^|[\s,])(?:\d+|\?)(?:,\s*no(?:s)?\.?\s*[^()]+)?\s*\((?:19|20)\d{2}\)\s*:\s*[A-Za-z]?\d/u.test(
    backbone,
  );
}

function hasChicagoNotesBookSpine(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  if (hasMlaPublisherCommaYearIdentifierProfile(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  return (
    /^[^"]{2,180}\.\s+.+?\.\s+.+?,\s*(?:1[6-9]|20)\d{2}(?:\.\s*(?:https?:\/\/|doi:\s*10\.|10\.)|\.?$)/iu.test(
      backbone,
    ) || /^[^"]{2,180}\.\s+.+?\.\s+.+?,\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone)
  );
}

function hasChicagoNotesContainerSpine(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  return /"[^"]{4,}(?:[.?!])?"\.?\s+In\s+.+?\.\s+.+?,\s*(?:19|20)\d{2}(?:\.|,\s*(?:pp?\.)?)/iu.test(
    backbone,
  );
}

function hasChicagoNotesChapterCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text);
  return /^[^"]{2,220}\.\s*".{4,}"\.?\s+In\s+.+?\.\s+.+?,\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(
    backbone,
  );
}

function hasStrongIeeeEnumeratedJournalSpine(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (!matchedSignals.has('bracketed_enumerator')) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(stripLeadingEnumerator(text));
  return (
    (matchedSignals.has('quoted_title') || /^[A-Z]\.\s*[A-Z][\p{L}'-]+/u.test(backbone)) &&
    (matchedSignals.has('locator_vol') ||
      matchedSignals.has('locator_no') ||
      matchedSignals.has('locator_pp') ||
      /\bdoi:\s*10\./iu.test(text)) &&
    /\b(?:19|20)\d{2}\b/u.test(backbone)
  );
}

function hasRelaxedHarvardCtrCommitProfile(signals: StyleSignalSet): boolean {
  const backbone = stripTrailingIdentifierTail(signals.normalizedText);
  return (
    signals.matchedSignals.has('year_parenthesized_after_authors') &&
    /\bAvailable at:/iu.test(signals.normalizedText) &&
    (signals.matchedSignals.has('quoted_title') ||
      signals.matchedSignals.has('cue_journal') ||
      signals.matchedSignals.has('cue_book_publisher') ||
      signals.matchedSignals.has('locator_pp') ||
      /^[^"]{2,220}\(\d{4}[a-z]?\)\s+[^.]{4,260}\.\s+[^.]{2,120}\.?$/iu.test(backbone) ||
      /^[^"]{2,220}\(\d{4}[a-z]?\)\s+[^.]{4,260}\.\s+[^.]{2,120}\.\s+Available at:/iu.test(
        signals.normalizedText,
      ))
  );
}

function hasHarvardThesisCommitProfile(signals: StyleSignalSet): boolean {
  if (hasApaThesisBracketedCommitProfile(signals.normalizedText, signals.matchedSignals)) {
    return false;
  }

  const normalizedText = foldStyleDiacritics(signals.normalizedText);
  const backbone = stripTrailingIdentifierTail(normalizedText);
  return (
    signals.matchedSignals.has('year_parenthesized_after_authors') &&
    /\b(?:doctoral dissertation|phd thesis|master'?s thesis|dissertation|thesis)\b/iu.test(
      backbone,
    ) &&
    (/\bAvailable at:/iu.test(normalizedText) ||
      /\b(?:universidade|university|universidad|institute|institut|school|faculty|faculdade)\b/iu.test(
        backbone,
      ))
  );
}

function hasHarvardCorporateReportCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  return (
    matchedSignals.has('year_parenthesized_after_authors') &&
    /\bAvailable at:/iu.test(text) &&
    !/\(\d{4}[a-z]?\)\.\s+/u.test(text) &&
    /^[^"]{2,220}\(\d{4}[a-z]?\)\s+.+\.\s+[^.]{2,220}\.\s+Available at:\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(
      text,
    )
  );
}

function hasHarvardTitleFirstAvailableAtProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  return /^[^"]{4,260}\s+\((?:19|20)\d{2}[a-z]?\)\s+[^.]{2,200}\.\s+Available at:\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(
    text,
  );
}

function hasApaPairwiseExactCommitProfile(signals: StyleSignalSet): boolean {
  const text = signals.normalizedText;
  const matched = signals.matchedSignals;
  const hasFrontYearLead =
    matched.has('year_parenthesized_after_authors') ||
    matched.has('year_bare_after_authors') ||
    hasFrontParenthesizedYearLead(text);
  const hasApaSupport =
    hasApaBareYearJournalCommitProfile(text, matched) ||
    hasApaJournalCommitProfile(text, matched) ||
    hasApaLooseJournalCommitProfile(text, matched) ||
    hasApaPageOnlyJournalCommitProfile(text, matched) ||
    hasApaSparseContainerCommitProfile(text, matched) ||
    hasApaThesisBracketedCommitProfile(text, matched) ||
    hasApaConferenceCommitProfile(text, matched) ||
    hasApaBookCommitProfile(text, matched) ||
    hasApaFrontYearIdentifierCommitProfile(text, matched) ||
    hasApaFrontYearBookIdentifierCommitProfile(text, matched) ||
    hasApaCorporateMonographIdentifierCommitProfile(text, matched) ||
    hasApaPatentTitleYearCommitProfile(text, matched) ||
    hasApaLongAuthorLeadCommitProfile(text, matched) ||
    /\bhttps?:\/\/(?:dx\.)?doi\.org\//iu.test(text);

  return (
    hasFrontYearLead &&
    (matched.has('author_separator_ampersand') ||
      (!matched.has('author_separator_and') &&
        !/\bAvailable at:/iu.test(text) &&
        !/\b(?:doctoral dissertation|phd thesis|master'?s thesis|dissertation|thesis)\b/iu.test(
          text,
        ) &&
        hasAuthorLikeLeadBeforeFrontYear(text) &&
        /\bhttps?:\/\/(?:dx\.)?doi\.org\//iu.test(text))) &&
    hasApaSupport
  );
}

function hasHarvardPairwiseExactCommitProfile(signals: StyleSignalSet): boolean {
  const text = signals.normalizedText;
  const matched = signals.matchedSignals;
  const hasFrontYearLead =
    matched.has('year_parenthesized_after_authors') ||
    matched.has('year_bare_after_authors') ||
    hasFrontParenthesizedYearLead(text);
  const hasHarvardSupport =
    hasRelaxedHarvardCtrCommitProfile(signals) ||
    hasHarvardBareYearJournalCommitProfile(text, matched) ||
    hasHarvardAvailableAtJournalCommitProfile(text, matched) ||
    hasHarvardAvailableAtBookCommitProfile(text, matched) ||
    hasHarvardCorporateReportCommitProfile(text, matched) ||
    hasHarvardPatentAvailableAtProfile(text) ||
    hasHarvardTitleFirstAvailableAtProfile(text) ||
    /\bAvailable at:/iu.test(text) ||
    /\bdoi:\s*10\./iu.test(text);

  return (
    hasHarvardSupport &&
    (hasHarvardBareYearJournalCommitProfile(text, matched) ||
      hasHarvardTitleFirstAvailableAtProfile(text) ||
      (hasFrontYearLead && (matched.has('author_separator_and') || /\bAvailable at:/iu.test(text))))
  );
}

function hasSparseMinimalVancouverStyleOverride(
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>,
  topStyle: CitationStyle | undefined,
  signals: StyleSignalSet,
): boolean {
  if (family !== 'numeric' || topStyle !== 'vancouver') {
    return false;
  }

  return hasSparseMinimalVancouverJournalSpine(stripTrailingIdentifierTail(signals.normalizedText));
}

function findFrontParenthesizedYearIndex(normalizedText: string): number {
  const stripped = stripLeadingEnumerator(normalizedText);
  const match = stripped.match(/\((?:19|20)\d{2}[a-z]?\)/iu);
  const index = match?.index ?? -1;
  if (index < 0) {
    return -1;
  }

  const maximumLeadLength = Math.min(240, Math.max(120, Math.floor(stripped.length * 0.55)));
  return index <= maximumLeadLength ? index : -1;
}

function hasFrontParenthesizedYearLead(normalizedText: string): boolean {
  return findFrontParenthesizedYearIndex(normalizedText) >= 0;
}

function hasAuthorLikeLeadBeforeFrontYear(normalizedText: string): boolean {
  const stripped = stripLeadingEnumerator(normalizedText);
  const yearIndex = findFrontParenthesizedYearIndex(normalizedText);
  if (yearIndex < 0) {
    return false;
  }

  const lead = stripped.slice(0, yearIndex).trim();
  return (
    /\bet al\./iu.test(lead) ||
    /\s&\s/u.test(lead) ||
    /\band\b/iu.test(lead) ||
    /,\s*[\p{Lu}](?:\.\s*[\p{Lu}])?\.?/u.test(lead) ||
    /\b[\p{Lu}][\p{L}'’-]+,\s*[\p{Lu}]/u.test(lead)
  );
}

function hasPostYearTitleCadence(normalizedText: string): boolean {
  const stripped = stripLeadingEnumerator(normalizedText);
  const yearMatch = stripped.match(/\((?:19|20)\d{2}[a-z]?\)\.\s+(?<tail>.+)$/iu);
  const tail = yearMatch?.groups?.tail?.trim();
  if (!tail) {
    return false;
  }

  return /^(?:["“]|[A-Z0-9][^.;]{3,260})(?:\.|$)/u.test(tail) && !/^\d+(?:\.\d+)?\s*$/u.test(tail);
}

function hasIeeeOnlinePatentCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (!matchedSignals.has('bracketed_enumerator')) {
    return false;
  }

  return (
    /\[Online\]/iu.test(text) &&
    /\bAvailable:\s*https?:\/\/[^\s]+/iu.test(text) &&
    /\b(?:(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)[A-Z0-9/-]{5,}|patent)\b/iu.test(text)
  );
}

function hasIeeeOnlineReferenceCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  return (
    matchedSignals.has('bracketed_enumerator') &&
    /\[Online\]/iu.test(text) &&
    /\bAvailable:\s*https?:\/\/[^\s]+/iu.test(text) &&
    (matchedSignals.has('quoted_title') || /\bRFC Editor\b/iu.test(text))
  );
}

function hasVancouverEnumeratedPatentNumberCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  const hasNumericEnumerator =
    matchedSignals.has('bracketed_enumerator') ||
    matchedSignals.has('numeric_dot_enumerator') ||
    matchedSignals.has('numeric_paren_enumerator');

  return (
    hasNumericEnumerator &&
    !matchedSignals.has('quoted_title') &&
    !matchedSignals.has('locator_ieee_signature') &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    /\b(?:US|EP|WO|CN|JP|GB|DE|FR|KR|CA|AU)[A-Z0-9/-]{5,}\b/iu.test(backbone) &&
    /,\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone)
  );
}

function hasIeeeEnumeratedCommaYearDoiCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  return (
    matchedSignals.has('bracketed_enumerator') &&
    matchedSignals.has('identifier_doi') &&
    !matchedSignals.has('locator_ieee_signature') &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !/\[Online\]/iu.test(text) &&
    /,\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone)
  );
}

function hasVancouverEnumeratedBareYearIdentifierCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  const hasNumericEnumerator =
    matchedSignals.has('bracketed_enumerator') ||
    matchedSignals.has('numeric_dot_enumerator') ||
    matchedSignals.has('numeric_paren_enumerator');

  return (
    hasNumericEnumerator &&
    matchedSignals.has('identifier_doi') &&
    !matchedSignals.has('quoted_title') &&
    !matchedSignals.has('locator_ieee_signature') &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    !/\[Online\]/iu.test(text) &&
    !/,\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone) &&
    (matchedSignals.has('author_surname_initials') ||
      matchedSignals.has('author_initials_surname') ||
      matchedSignals.has('author_lead_ambiguous') ||
      matchedSignals.has('author_bucket_many') ||
      matchedSignals.has('author_bucket_few') ||
      matchedSignals.has('author_bucket_single') ||
      matchedSignals.has('author_separator_comma') ||
      matchedSignals.has('has_et_al')) &&
    /\b(?:1[6-9]|20)\d{2}\.?$/u.test(backbone)
  );
}

function hasVancouverEnumeratedRepositoryIdentifierCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  const hasNumericEnumerator =
    matchedSignals.has('bracketed_enumerator') ||
    matchedSignals.has('numeric_dot_enumerator') ||
    matchedSignals.has('numeric_paren_enumerator');
  const hasRepositoryIdentifierCue =
    STYLE_REPOSITORY_CUE_REGEX.test(text) || /\b10\.(?:2139|21203|31219|2196|22541)\//iu.test(text);

  return (
    hasNumericEnumerator &&
    hasRepositoryIdentifierCue &&
    (matchedSignals.has('identifier_doi') || matchedSignals.has('identifier_url')) &&
    !matchedSignals.has('locator_ieee_signature') &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    !/\[Online\]/iu.test(text) &&
    /\b(?:1[6-9]|20)\d{2}\.?$/u.test(backbone)
  );
}

function hasVancouverEnumeratedRfcWebCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  const hasNumericEnumerator =
    matchedSignals.has('bracketed_enumerator') ||
    matchedSignals.has('numeric_dot_enumerator') ||
    matchedSignals.has('numeric_paren_enumerator');

  return (
    hasNumericEnumerator &&
    matchedSignals.has('identifier_url') &&
    !matchedSignals.has('quoted_title') &&
    !matchedSignals.has('locator_ieee_signature') &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    (STYLE_RFC_WEB_CUE_REGEX.test(text) ||
      /\bhttps?:\/\/(?:www\.)?rfc-editor\.org\//iu.test(text) ||
      /\bRFC\b/iu.test(text)) &&
    /(?:^|\.?\s)(?:RFC Editor|Internet Engineering Task Force)(?:,\s*Internet Engineering Task Force)?\s+(?:1[6-9]|20)\d{2}\.?$/iu.test(
      backbone,
    )
  );
}

function hasVancouverEnumeratedSemicolonIdentifierCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  const hasNumericEnumerator =
    matchedSignals.has('bracketed_enumerator') ||
    matchedSignals.has('numeric_dot_enumerator') ||
    matchedSignals.has('numeric_paren_enumerator');

  return (
    hasNumericEnumerator &&
    (matchedSignals.has('identifier_doi') || matchedSignals.has('identifier_url')) &&
    !matchedSignals.has('locator_ieee_signature') &&
    !/\[Online\]/iu.test(text) &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    (matchedSignals.has('author_surname_initials') ||
      matchedSignals.has('author_initials_surname') ||
      matchedSignals.has('author_lead_ambiguous') ||
      matchedSignals.has('author_bucket_many') ||
      matchedSignals.has('author_bucket_few') ||
      matchedSignals.has('author_bucket_single') ||
      matchedSignals.has('author_separator_comma') ||
      matchedSignals.has('has_et_al')) &&
    (/;\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone) ||
      /,\s*[^,.;]{4,260};\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone))
  );
}

function hasVancouverEnumeratedQuotedPreprintCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  const hasNumericEnumerator =
    matchedSignals.has('bracketed_enumerator') ||
    matchedSignals.has('numeric_dot_enumerator') ||
    matchedSignals.has('numeric_paren_enumerator');

  return (
    hasNumericEnumerator &&
    matchedSignals.has('quoted_title') &&
    (matchedSignals.has('identifier_doi') || matchedSignals.has('identifier_url')) &&
    !matchedSignals.has('locator_ieee_signature') &&
    !/\[Online\]/iu.test(text) &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    /\(\s*preprint\s*\)\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone)
  );
}

function hasIeeePairwiseExactCommitProfile(signals: StyleSignalSet): boolean {
  const text = signals.normalizedText;
  const matched = signals.matchedSignals;

  if (
    hasVancouverEnumeratedSemicolonMonographCommitProfile(text, matched) ||
    hasVancouverEnumeratedThesisCommitProfile(text, matched) ||
    hasVancouverEnumeratedPatentNumberCommitProfile(text, matched) ||
    hasVancouverEnumeratedRepositoryIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedRfcWebCommitProfile(text, matched)
  ) {
    return false;
  }

  return (
    hasIeeeOnlineReferenceCommitProfile(text, matched) ||
    hasIeeeQuotedInstitutionalReportCommitProfile(text, matched) ||
    hasRelaxedIeeeBookCommitProfile(text, matched) ||
    hasIeeeEnumeratedCommaYearDoiCommitProfile(text, matched) ||
    hasIeeeEnumeratedBookDoiCommitProfile(text, matched) ||
    hasIeeeOnlinePatentCommitProfile(text, matched) ||
    (matched.has('bracketed_enumerator') &&
      matched.has('quoted_title') &&
      (matched.has('locator_ieee_signature') ||
        matched.has('locator_vol') ||
        matched.has('locator_no') ||
        matched.has('locator_pp') ||
        /\[Online\]/iu.test(text) ||
        /\bdoi:\s*10\./iu.test(text)) &&
      !matched.has('locator_semicolon_volume_issue_pages'))
  );
}

function hasVancouverConferencePagesCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const hasNumericEnumerator =
    matchedSignals.has('bracketed_enumerator') ||
    matchedSignals.has('numeric_dot_enumerator') ||
    matchedSignals.has('numeric_paren_enumerator');

  return (
    hasNumericEnumerator &&
    (!matchedSignals.has('quoted_title') ||
      matchedSignals.has('cue_book_publisher') ||
      matchedSignals.has('has_et_al')) &&
    /;\s*(?:19|20)\d{2},\s*p{1,2}\.?\s*[A-Za-z]?\d/iu.test(text)
  );
}

function hasVancouverEnumeratedSemicolonMonographCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  return (
    (matchedSignals.has('bracketed_enumerator') ||
      matchedSignals.has('numeric_dot_enumerator') ||
      matchedSignals.has('numeric_paren_enumerator')) &&
    !matchedSignals.has('locator_ieee_signature') &&
    !/\[Online\]/iu.test(text) &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    (matchedSignals.has('author_surname_initials') ||
      matchedSignals.has('author_initials_surname') ||
      matchedSignals.has('author_lead_ambiguous') ||
      matchedSignals.has('author_bucket_many') ||
      matchedSignals.has('has_et_al') ||
      matchedSignals.has('author_bucket_single') ||
      matchedSignals.has('cue_book_publisher') ||
      /\b(?:annual report|report)\b/iu.test(backbone)) &&
    (/;\s*(?:1[6-9]|20)\d{2}(?:,\s*p{1,2}\.?\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$/iu.test(
      backbone,
    ) ||
      /,\s*[^,.;]{4,260};\s*(?:1[6-9]|20)\d{2}(?:,\s*p{1,2}\.?\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$/iu.test(
        backbone,
      ) ||
      /\b(?:dissertation|thesis)\.\s+[^,.;]{4,260},\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone) ||
      /^[^.]{2,280}\.\s+[^.;]{2,320}\.\s+[^.;]{2,240};\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone))
  );
}

function hasVancouverEnumeratedThesisCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const foldedText = foldStyleDiacritics(text);
  return (
    (matchedSignals.has('bracketed_enumerator') ||
      matchedSignals.has('numeric_dot_enumerator') ||
      matchedSignals.has('numeric_paren_enumerator')) &&
    !matchedSignals.has('quoted_title') &&
    !matchedSignals.has('locator_ieee_signature') &&
    (matchedSignals.has('identifier_doi') || matchedSignals.has('identifier_url')) &&
    /\b(?:dissertation|thesis)\b/iu.test(foldedText) &&
    /\b(?:universidade|university|universidad|institute|institut|school|faculty|faculdade|documentation centre|library)\b/iu.test(
      foldedText,
    ) &&
    /\b(?:dissertation|thesis)\.\s+[^,.;]{4,260},\s*(?:1[6-9]|20)\d{2}\.?(?:\s*(?:https?:\/\/[^\s]+|doi:\s*10\.[^\s]+|10\.[^\s]+))?$/iu.test(
      foldedText,
    )
  );
}

function hasVancouverPairwiseExactCommitProfile(signals: StyleSignalSet): boolean {
  const text = signals.normalizedText;
  const matched = signals.matchedSignals;
  const backbone = stripTrailingIdentifierTail(text);

  if (
    hasIeeeBookSpine(text, matched) ||
    hasRelaxedIeeeBookCommitProfile(text, matched) ||
    hasIeeeEnumeratedBookDoiCommitProfile(text, matched)
  ) {
    return false;
  }

  return (
    hasStrongCanonicalVancouverJournalSpine(backbone) ||
    (hasMinimalVancouverJournalSpine(backbone) &&
      !hasSparseMinimalVancouverJournalSpine(backbone)) ||
    hasVancouverPlainSemicolonJournalSpine(backbone, matched) ||
    hasRelaxedVancouverCommitProfile(text, matched) ||
    hasVancouverEnumeratedSemicolonMonographCommitProfile(text, matched) ||
    hasVancouverEnumeratedThesisCommitProfile(text, matched) ||
    hasVancouverEnumeratedPatentNumberCommitProfile(text, matched) ||
    hasVancouverEnumeratedSemicolonIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedBareYearIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedRepositoryIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedRfcWebCommitProfile(text, matched) ||
    hasVancouverEnumeratedQuotedPreprintCommitProfile(text, matched) ||
    hasVancouverConferencePublisherSpine(text, matched) ||
    hasVancouverEnumeratedInstitutionTailCommitProfile(text, matched) ||
    hasVancouverConferencePagesCommitProfile(text, matched)
  );
}

function hasMlaPreprintCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const hasPreprintPlatform =
    /\b(?:arXiv|bioRxiv|medRxiv|SSRN|preprint|Research Square(?: Platform LLC)?|TechRxiv|Preprints(?:\.org)?)\b/iu.test(
      text,
    ) ||
    /\btechrxiv\b/iu.test(text) ||
    /\bpreprints?\d{4,}\b/iu.test(text) ||
    STYLE_REPOSITORY_CUE_REGEX.test(text);

  return (
    hasPreprintPlatform &&
    (/^[^"]{2,260}\.\s+.+?\.\s+.+?,\s*(?:1[6-9]|20)\d{2}(?:,\s*(?:https?:\/\/|doi:\s*10\.|10\.)|\.?$)/iu.test(
      text,
    ) ||
      /^[^"]{2,260}\.\s*"[^"]{4,}"\.?\s+.+?,\s*(?:1[6-9]|20)\d{2}(?:,\s*(?:https?:\/\/|doi:\s*10\.|10\.)|\.?$)/iu.test(
        text,
      ))
  );
}

function hasMlaPublisherCommaYearIdentifierProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  return (
    !/"/u.test(text) &&
    !/\bPatent\b/iu.test(text) &&
    !/\bIn:\s+/iu.test(text) &&
    /^[^"]{2,240}\.\s+.+?[.?!]\s+.+?,\s*(?:1[6-9]|20)\d{2},\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(
      text,
    )
  );
}

function hasMlaQuotedRepositoryIdentifierCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(text).trim();
  return (
    /"/u.test(backbone) &&
    /,\s*(?:1[6-9]|20)\d{2},\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(text) &&
    (STYLE_REPOSITORY_CUE_REGEX.test(backbone) || /\b(?:repository|preprint)\b/iu.test(backbone))
  );
}

function hasMlaThesisIdentifierCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const foldedText = foldStyleDiacritics(text);
  return (
    !/"/u.test(foldedText) &&
    /(?:https?:\/\/|doi:\s*10\.|10\.)[^\s]+/iu.test(foldedText) &&
    /\b(?:doctoral dissertation|phd thesis|master'?s thesis|dissertation|thesis)\.?$/iu.test(
      foldedText,
    ) &&
    /^[^"]{2,360}\.\s+.+?\s*(?:1[6-9]|20)\d{2},\s*(?:https?:\/\/|doi:\s*10\.|10\.)[^\s]+\.?\s+.+?,\s*(?:doctoral dissertation|phd thesis|master'?s thesis|dissertation|thesis)\.?$/iu.test(
      foldedText,
    )
  );
}

function hasMlaPatentNumberIdentifierCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  return (
    !/"/u.test(text) &&
    !/\bAvailable at:/iu.test(text) &&
    /\bno\.\s*[A-Z]{2,}[A-Z0-9/-]{4,}\b/iu.test(text) &&
    /,\s*(?:1[6-9]|20)\d{2},\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(text)
  );
}

function hasMlaPairwiseExactCommitProfile(signals: StyleSignalSet): boolean {
  const text = signals.normalizedText;

  return (
    hasMlaWorksCitedJournalSpine(text) ||
    hasMlaWorksCitedJournalNoPagesSpine(text) ||
    hasMlaWorksCitedBookSpine(text) ||
    hasMlaWorksCitedBookUrlTailProfile(text) ||
    hasMlaPublisherCommaYearIdentifierProfile(text) ||
    hasMlaQuotedRepositoryIdentifierCommitProfile(text) ||
    hasMlaConferenceCommitProfile(text) ||
    hasMlaQuotedYearContainerCommitProfile(text) ||
    hasMlaQuotedTailCommitProfile(text) ||
    hasMlaPreprintCommitProfile(text) ||
    hasMlaThesisIdentifierCommitProfile(text) ||
    hasMlaPatentNumberIdentifierCommitProfile(text)
  );
}

function hasChicagoThesisCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTerminalIdentifierTail(foldStyleDiacritics(text));
  return /"[^"]{4,}(?:[.?!])?"\.?\s+(?:Dissertation|Thesis),\s+.+?,\s*(?:19|20)\d{2}\.?$/iu.test(
    backbone,
  );
}

function hasChicagoPreprintCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTerminalIdentifierTail(text);
  return (
    /\b(?:arXiv|bioRxiv|medRxiv|SSRN|preprint)\b/iu.test(text) &&
    /"[^"]{4,}(?:[.?!])?"\.?\s+.+?,\s*(?:19|20)\d{2}\.?$/iu.test(backbone)
  );
}

function hasChicagoPatentIssuedCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  const backbone = stripTerminalIdentifierTail(text);
  return (
    /\bPatent\s+(?:Application\s+No\.\s+)?[A-Z]{2,}[A-Z0-9/-]{4,},\s*issued\s*(?:19|20)\d{2}\.?$/iu.test(
      backbone,
    ) && /https?:\/\/(?:www\.)?patents\.google\.com\/patent\//iu.test(text)
  );
}

function hasChicagoWebpageCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  if (/\b(?:Available at:|Accessed|Retrieved|Web\.)\b/iu.test(text) || !URL_REGEX.test(text)) {
    return false;
  }

  const backbone = stripTerminalIdentifierTail(text).trim();
  const foldedBackbone = foldStyleDiacritics(backbone);
  const repeatedOwnerYearCadenceMatch = foldedBackbone.match(
    /^(?<author>[^."]{2,220})\.\s*"[^"]{4,}"\.?\s+[^,]{2,220},\s*(?<owner>[^,]{2,220}),\s*(?:1[6-9]|20)\d{2}\.?$/iu,
  );
  const repeatedOwnerYearCadenceAuthor = repeatedOwnerYearCadenceMatch?.groups?.author?.trim() ?? '';
  const repeatedOwnerYearCadenceOwner = repeatedOwnerYearCadenceMatch?.groups?.owner?.trim() ?? '';
  const repeatedOwnerYearCadence =
    repeatedOwnerYearCadenceMatch != null &&
    repeatedOwnerYearCadenceAuthor.length > 0 &&
    repeatedOwnerYearCadenceAuthor === repeatedOwnerYearCadenceOwner;
  const hasChicagoRfcDocumentCadence =
    /"/u.test(backbone) &&
    (STYLE_RFC_WEB_CUE_REGEX.test(text) ||
      /\bhttps?:\/\/(?:www\.)?rfc-editor\.org\//iu.test(text) ||
      /\bRFC\b/iu.test(text)) &&
    (/^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone) ||
      /^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s+RFC Editor,\s+[^.]{2,220},\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(
        backbone,
      ));
  const hasGeneralYearOnlyWebCadence =
    /"[^"]{4,}"/u.test(backbone) &&
    !STYLE_REPOSITORY_CUE_REGEX.test(backbone) &&
    (/^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s+[^.]{2,220},\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(backbone) ||
      /^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s+[^.]{2,220},\s+[^.]{2,220},\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(
        backbone,
      ));
  return (
    hasChicagoRfcDocumentCadence ||
    repeatedOwnerYearCadence ||
    (hasGeneralYearOnlyWebCadence && !hasMlaWebpageCommitProfile(text))
  );
}

function hasApaWebpageCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (hasLeadingEnumerator(text) || /\bAvailable at:/iu.test(text) || !URL_REGEX.test(text)) {
    return false;
  }

  const backbone = stripTerminalIdentifierTail(text).trim();
  const hasRfcLikeOrWebCue =
    STYLE_RFC_WEB_CUE_REGEX.test(text) ||
    /\bhttps?:\/\/(?:www\.)?rfc-editor\.org\//iu.test(text) ||
    matchedSignals.has('cue_web_access') ||
    matchedSignals.has('identifier_url');
  const corporateOwnerCadence =
    /^[^"]{2,220}\.\s*\((?:1[6-9]|20)\d{2}[a-z]?\)\.\s+.+?\.\s+[^.]{2,220}(?:\.\s+[^.]{2,220})?\.?$/iu.test(
      backbone,
    );
  const titleFirstCadence =
    /^.+?\.\s*\((?:1[6-9]|20)\d{2}[a-z]?\)\.\s+[^.]{2,220}(?:\.\s+[^.]{2,220})?\.?$/iu.test(
      backbone,
    ) && !hasAuthorLikeLeadBeforeFrontYear(text);

  return hasRfcLikeOrWebCue && (corporateOwnerCadence || titleFirstCadence);
}

function hasMlaWebpageCommitProfile(text: string): boolean {
  if (hasLeadingEnumerator(text) || !URL_REGEX.test(text) || /\bAvailable at:/iu.test(text)) {
    return false;
  }

  const backbone = stripTerminalIdentifierTail(text).trim();
  return (
    /"/u.test(backbone) &&
    !STYLE_REPOSITORY_CUE_REGEX.test(backbone) &&
    /^[^"]{2,220}\.\s*"[^"]{4,}"\.?\s+[^,]{2,220},\s*[^,]{2,220},\s*(?:1[6-9]|20)\d{2}\.?$/iu.test(
      backbone,
    )
  );
}

function hasVancouverEnumeratedWebpageCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTerminalIdentifierTail(stripLeadingEnumerator(text));
  const hasNumericEnumerator =
    matchedSignals.has('bracketed_enumerator') ||
    matchedSignals.has('numeric_dot_enumerator') ||
    matchedSignals.has('numeric_paren_enumerator');
  const siteTailMatch = backbone.match(
    /^(?<lead>.+)\.\s+(?<site>[^.]{2,220})\s+(?<year>(?:1[6-9]|20)\d{2})\.?$/iu,
  );

  return (
    hasNumericEnumerator &&
    matchedSignals.has('identifier_url') &&
    !matchedSignals.has('quoted_title') &&
    !matchedSignals.has('locator_ieee_signature') &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    !matchedSignals.has('locator_vol') &&
    !matchedSignals.has('locator_no') &&
    !matchedSignals.has('locator_pp') &&
    !STYLE_REPOSITORY_CUE_REGEX.test(text) &&
    siteTailMatch != null
  );
}

function hasHarvardPatentAvailableAtProfile(text: string): boolean {
  if (hasLeadingEnumerator(text)) {
    return false;
  }

  return (
    /^["“][^"“”]{4,}["”]\s+\((?:19|20)\d{2}[a-z]?\)\.\s+Available at:\s*https?:\/\/(?:www\.)?patents\.google\.com\/patent\//iu.test(
      text,
    ) ||
    /^["“][^"“”]{4,}["”]\s+\((?:19|20)\d{2}[a-z]?\)\.\s+Patent(?: Application No\.)?.+Available at:\s*https?:\/\/(?:www\.)?patents\.google\.com\/patent\//iu.test(
      text,
    ) ||
    /^["“][^"“”]{4,}["”]\s+\((?:19|20)\d{2}[a-z]?\)\.\s+Available at:\s*https?:\/\/(?:www\.)?patents\.google\.com\/patent\/[^\s]+\.?$/iu.test(
      text,
    )
  );
}

function hasChicagoPairwiseExactCommitProfile(signals: StyleSignalSet): boolean {
  const text = signals.normalizedText;
  const matched = signals.matchedSignals;

  return (
    hasChicagoNotesJournalSpine(text) ||
    hasChicagoNotesJournalNoPagesSpine(text) ||
    hasChicagoNotesBookSpine(text) ||
    hasChicagoNotesContainerSpine(text) ||
    hasChicagoNotesChapterCommitProfile(text) ||
    hasChicagoNotesConferenceCommitProfile(text) ||
    hasChicagoQuotedContainerYearPagesCommitProfile(text) ||
    hasChicagoSparseQuotedYearPagesCommitProfile(text) ||
    hasChicagoQuotedTailCommitProfile(text) ||
    hasChicagoThesisCommitProfile(text) ||
    hasChicagoPreprintCommitProfile(text) ||
    hasChicagoWebpageCommitProfile(text) ||
    hasChicagoPatentIssuedCommitProfile(text) ||
    (matched.has('quoted_title') &&
      matched.has('cue_in_container') &&
      matched.has('cue_book_publisher'))
  );
}

function hasChicagoPreferredNotesCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  return (
    hasChicagoQuotedContainerYearPagesCommitProfile(text) ||
    hasChicagoSparseQuotedYearPagesCommitProfile(text) ||
    hasChicagoSparseQuotedIdentifierPagesCommitProfile(text) ||
    hasChicagoBookIdentifierTailCommitProfile(text) ||
    hasChicagoQuotedTailCommitProfile(text) ||
    hasChicagoThesisCommitProfile(text) ||
    hasChicagoWebpageCommitProfile(text) ||
    hasChicagoPatentIssuedCommitProfile(text) ||
    (matchedSignals.has('quoted_title') &&
      matchedSignals.has('cue_in_container') &&
      matchedSignals.has('cue_book_publisher'))
  );
}

function resolveStructuredExactStyleOverride(signals: StyleSignalSet): {
  family: Exclude<StyleFamily, 'unknown' | 'web_accessed'>;
  style: CitationStyle;
  familyConfidence: number;
  styleConfidence: number;
  styleMarginToRunnerUp: number;
} | null {
  const text = signals.normalizedText;
  const matched = signals.matchedSignals;
  const stripped = stripTrailingIdentifierTail(text);

  if (
    hasRelaxedHarvardCtrCommitProfile(signals) ||
    hasHarvardThesisCommitProfile(signals) ||
    hasHarvardCorporateReportCommitProfile(text, matched) ||
    hasQuotedHarvardAvailableAtProfile(text, matched) ||
    hasHarvardPatentAvailableAtProfile(text) ||
    hasHarvardTitleFirstAvailableAtProfile(text) ||
    hasEnumeratedHarvardJournalCommitProfile(text, matched) ||
    hasHarvardBareYearJournalCommitProfile(text, matched)
  ) {
    return {
      family: 'author_date',
      style: 'harvard-ctr',
      familyConfidence: 0.82,
      styleConfidence: 0.66,
      styleMarginToRunnerUp: 0.08,
    };
  }

  if (
    hasApaBareYearJournalCommitProfile(text, matched) ||
    hasApaJournalCommitProfile(text, matched) ||
    hasApaLooseJournalCommitProfile(text, matched) ||
    hasApaPageOnlyJournalCommitProfile(text, matched) ||
    hasApaSparseContainerCommitProfile(text, matched) ||
    hasApaThesisBracketedCommitProfile(text, matched) ||
    hasEnumeratedApaJournalCommitProfile(text, matched) ||
    hasApaConferenceCommitProfile(text, matched) ||
    hasApaBookCommitProfile(text, matched) ||
    hasApaFrontYearIdentifierCommitProfile(text, matched) ||
    hasApaFrontYearBookIdentifierCommitProfile(text, matched) ||
    hasApaCorporateMonographIdentifierCommitProfile(text, matched) ||
    hasApaPatentTitleYearCommitProfile(text, matched) ||
    hasApaLongAuthorLeadCommitProfile(text, matched) ||
    hasApaWebpageCommitProfile(text, matched)
  ) {
    return {
      family: 'author_date',
      style: 'apa7',
      familyConfidence: 0.82,
      styleConfidence: 0.68,
      styleMarginToRunnerUp: 0.1,
    };
  }

  if (
    hasChicagoQuotedContainerYearPagesCommitProfile(text) ||
    hasChicagoSparseQuotedYearPagesCommitProfile(text) ||
    hasChicagoSparseQuotedIdentifierPagesCommitProfile(text) ||
    hasChicagoBookIdentifierTailCommitProfile(text)
  ) {
    return {
      family: 'notes_bibliography',
      style: 'chicago-notes-bib',
      familyConfidence: 0.81,
      styleConfidence: 0.67,
      styleMarginToRunnerUp: 0.1,
    };
  }

  if (hasChicagoPreferredNotesCommitProfile(text, matched)) {
    return {
      family: 'notes_bibliography',
      style: 'chicago-notes-bib',
      familyConfidence: 0.81,
      styleConfidence: 0.67,
      styleMarginToRunnerUp: 0.1,
    };
  }

  if (
    hasMlaWorksCitedJournalSpine(text) ||
    hasMlaWorksCitedJournalNoPagesSpine(text) ||
    hasMlaConferenceCommitProfile(text) ||
    hasMlaQuotedYearContainerCommitProfile(text) ||
    hasMlaWorksCitedBookSpine(text) ||
    hasMlaWorksCitedBookUrlTailProfile(text) ||
    hasMlaPublisherCommaYearIdentifierProfile(text) ||
    hasMlaQuotedRepositoryIdentifierCommitProfile(text) ||
    hasMlaQuotedTailCommitProfile(text) ||
    hasMlaPreprintCommitProfile(text) ||
    hasMlaThesisIdentifierCommitProfile(text) ||
    hasMlaPatentNumberIdentifierCommitProfile(text) ||
    hasMlaWebpageCommitProfile(text)
  ) {
    return {
      family: 'notes_bibliography',
      style: 'mla9',
      familyConfidence: 0.8,
      styleConfidence: 0.66,
      styleMarginToRunnerUp: 0.08,
    };
  }

  if (
    hasChicagoNotesJournalSpine(text) ||
    hasChicagoNotesBookSpine(text) ||
    hasChicagoNotesJournalNoPagesSpine(text) ||
    hasChicagoNotesChapterCommitProfile(text) ||
    hasChicagoNotesContainerSpine(text) ||
    hasChicagoNotesConferenceCommitProfile(text) ||
    hasChicagoQuotedContainerYearPagesCommitProfile(text) ||
    hasChicagoSparseQuotedYearPagesCommitProfile(text) ||
    hasChicagoQuotedTailCommitProfile(text) ||
    hasChicagoThesisCommitProfile(text) ||
    hasChicagoPreprintCommitProfile(text) ||
    hasChicagoWebpageCommitProfile(text) ||
    hasChicagoPatentIssuedCommitProfile(text)
  ) {
    return {
      family: 'notes_bibliography',
      style: 'chicago-notes-bib',
      familyConfidence: 0.8,
      styleConfidence: 0.66,
      styleMarginToRunnerUp: 0.08,
    };
  }

  if (
    hasRelaxedIeeeBookCommitProfile(text, matched) ||
    hasIeeeEnumeratedBookDoiCommitProfile(text, matched) ||
    hasIeeeBookSpine(text, matched)
  ) {
    return {
      family: 'numeric',
      style: 'ieee',
      familyConfidence: 0.82,
      styleConfidence: 0.68,
      styleMarginToRunnerUp: 0.1,
    };
  }

  if (
    hasRelaxedVancouverCommitProfile(text, matched) ||
    hasStrongCanonicalVancouverJournalSpine(stripped) ||
    (hasMinimalVancouverJournalSpine(stripped) &&
      !hasSparseMinimalVancouverJournalSpine(stripped)) ||
    hasVancouverEnumeratedSemicolonMonographCommitProfile(text, matched) ||
    hasVancouverEnumeratedThesisCommitProfile(text, matched) ||
    hasVancouverEnumeratedPatentNumberCommitProfile(text, matched) ||
    hasVancouverEnumeratedSemicolonIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedBareYearIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedRepositoryIdentifierCommitProfile(text, matched) ||
    hasVancouverEnumeratedRfcWebCommitProfile(text, matched) ||
    hasVancouverEnumeratedWebpageCommitProfile(text, matched) ||
    hasVancouverEnumeratedQuotedPreprintCommitProfile(text, matched) ||
    hasVancouverConferencePublisherSpine(text, matched) ||
    hasVancouverEnumeratedInstitutionTailCommitProfile(text, matched) ||
    hasVancouverConferencePagesCommitProfile(text, matched)
  ) {
    return {
      family: 'numeric',
      style: 'vancouver',
      familyConfidence: 0.8,
      styleConfidence: 0.66,
      styleMarginToRunnerUp: 0.08,
    };
  }

  if (
    !hasVancouverEnumeratedSemicolonMonographCommitProfile(text, matched) &&
    !hasVancouverEnumeratedThesisCommitProfile(text, matched) &&
    !hasVancouverEnumeratedSemicolonIdentifierCommitProfile(text, matched) &&
    !hasVancouverEnumeratedBareYearIdentifierCommitProfile(text, matched) &&
    !hasVancouverEnumeratedQuotedPreprintCommitProfile(text, matched) &&
    !hasVancouverConferencePagesCommitProfile(text, matched) &&
    (hasRelaxedIeeeBookCommitProfile(text, matched) ||
      hasIeeeEnumeratedCommaYearDoiCommitProfile(text, matched) ||
      hasIeeeEnumeratedBookDoiCommitProfile(text, matched) ||
      hasIeeePatentCommitProfile(text, matched) ||
      hasIeeeBookSpine(text, matched) ||
      hasIeeeQuotedInstitutionalReportCommitProfile(text, matched) ||
      hasIeeeOnlineReferenceCommitProfile(text, matched) ||
      hasIeeeOnlinePatentCommitProfile(text, matched) ||
      matched.has('locator_ieee_signature'))
  ) {
    return {
      family: 'numeric',
      style: 'ieee',
      familyConfidence: 0.8,
      styleConfidence: 0.66,
      styleMarginToRunnerUp: 0.08,
    };
  }

  return null;
}

function hasQuotedHarvardAvailableAtProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  return (
    (matchedSignals.has('year_parenthesized_after_authors') ||
      matchedSignals.has('quoted_title_lead')) &&
    matchedSignals.has('quoted_title') &&
    /\bAvailable at:/iu.test(text) &&
    /\((?:19|20)\d{2}[a-z]?\)/u.test(text)
  );
}

function guessLikelyTitle(normalizedText: string): string {
  const quotedTitle = normalizedText.match(/"([^"]{4,})"/u)?.[1];
  if (quotedTitle) {
    return quotedTitle.trim();
  }

  const afterParenthesizedYear = normalizedText.match(/\(\d{4}[a-z]?\)\.?\s+([^.;]{4,160})/u)?.[1];
  if (afterParenthesizedYear) {
    return afterParenthesizedYear.trim();
  }

  const afterBareYear = normalizedText.match(/\b\d{4}[a-z]?\.\s+([^.;]{4,160})/u)?.[1];
  if (afterBareYear) {
    return afterBareYear.trim();
  }

  const afterFirstPeriod = normalizedText.match(/^[^.]+\.\s+([^.;]{4,160})/u)?.[1];
  if (afterFirstPeriod) {
    return afterFirstPeriod.trim();
  }

  return normalizedText.slice(0, Math.min(80, normalizedText.length)).trim();
}

function hasCanonicalVancouverJournalSpine(text: string): boolean {
  return (
    /\b(?:19|20)\d{2}(?:\s+[A-Za-z]{3}\s+\d{1,2})?;(?:\d+|\?)(?:\((?:[^)]+|\?)\))?:[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/u.test(
      text,
    ) || /\b(?:19|20)\d{2}\s+[A-Za-z]{3}\s+\d{1,2};(?:\d+|\?)(?:\((?:[^)]+|\?)\))?:/u.test(text)
  );
}

function hasMinimalVancouverJournalSpine(text: string): boolean {
  return (
    /\b(?:19|20)\d{2};(?:\d+|\?)(?:\((?:[^)]+|\?)\))?(?::[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$/u.test(
      text,
    ) || /\b(?:19|20)\d{2}:\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?\.?$/u.test(text)
  );
}

function hasSparseMinimalVancouverJournalSpine(text: string): boolean {
  return (
    /\b(?:19|20)\d{2};(?:\d+|\?):[A-Za-z]?\d[\w-]*\.?$/u.test(text) &&
    !/\(\d+\)/u.test(text) &&
    !/[–-]/u.test(text) &&
    !/\b(?:doi:\s*10\.|10\.)/iu.test(text)
  );
}

function hasStrongCanonicalVancouverJournalSpine(text: string): boolean {
  return hasCanonicalVancouverJournalSpine(text) && !hasSparseMinimalVancouverJournalSpine(text);
}

function hasAmbiguousEnumeratedMixedFamilyConflict(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripLeadingEnumerator(stripTrailingIdentifierTail(text));
  return (
    (matchedSignals.has('bracketed_enumerator') ||
      matchedSignals.has('numeric_dot_enumerator') ||
      matchedSignals.has('numeric_paren_enumerator') ||
      matchedSignals.has('parenthesized_enumerator')) &&
    matchedSignals.has('author_separator_comma') &&
    matchedSignals.has('year_early_position') &&
    matchedSignals.has('cue_journal') &&
    (matchedSignals.has('locator_volume_issue_pages') ||
      matchedSignals.has('locator_page_range_only')) &&
    !matchedSignals.has('quoted_title') &&
    !matchedSignals.has('locator_ieee_signature') &&
    !matchedSignals.has('locator_semicolon_volume_issue_pages') &&
    /^[^"]{2,160}\(\d{4}[a-z]?\)\.\s+[^.]{4,260}\.\s+.+?,\s*(?:\d+|\?)(?:\((?:[^)]+|\?)\))?(?:,\s*(?:pp?\.?\s*)?[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$/iu.test(
      backbone,
    )
  );
}

function hasBiomedicalVancouverCommitSignals(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  return (
    (matchedSignals.has('locator_semicolon_volume_issue_pages') &&
      !hasSparseMinimalVancouverJournalSpine(backbone)) ||
    matchedSignals.has('locator_year_comma_volume_colon_pages') ||
    matchedSignals.has('locator_year_comma_volume_colon_identifier') ||
    (matchedSignals.has('identifier_doi_tail_numeric') &&
      (matchedSignals.has('cue_journal_abbrev') || matchedSignals.has('cue_journal')))
  );
}

function hasVancouverEnumeratedInstitutionTailCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  if (!matchedSignals.has('bracketed_enumerator') || !matchedSignals.has('identifier_doi')) {
    return false;
  }

  const backbone = stripTrailingIdentifierTail(stripLeadingEnumerator(text));
  return (
    !matchedSignals.has('locator_ieee_signature') &&
    (/,\s*[^,;]{4,260};\s*(?:1[6-9]|20)\d{2}\.?$/u.test(backbone) ||
      /,\s*[^,;]{4,260};\s*(?:1[6-9]|20)\d{2}\.?\s*(?:https?:\/\/|doi:\s*10\.|10\.)/iu.test(text) ||
      /\b(?:dissertation|thesis)\.\s+[^,;]{4,260},\s*(?:1[6-9]|20)\d{2}\.?(?:\s*(?:https?:\/\/|doi:\s*10\.|10\.)|$)/iu.test(
        text,
      ))
  );
}

function hasVancouverConferencePublisherSpine(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(stripLeadingEnumerator(text));
  const hasInitialLead =
    /^[\p{Lu}][\p{L}'-]+\s+[\p{Lu}](?:\.)?(?:,\s*[\p{Lu}][\p{L}'-]+\s+[\p{Lu}](?:\.)?)+\.?\s+/u.test(
      backbone,
    );
  const hasQuotedInstitutionTail =
    /,\s*[^,;]{0,80}"[^"]{2,120}"[^;]{0,80};\s*(?:19|20)\d{2}\.?$/u.test(backbone);
  const hasPublisherSpine =
    (matchedSignals.has('author_surname_initials') ||
      matchedSignals.has('author_initials_surname') ||
      (matchedSignals.has('author_lead_ambiguous') &&
        matchedSignals.has('author_separator_semicolon'))) &&
    /;\s*(?:19|20)\d{2}\.?$/u.test(backbone) &&
    (/\b(?:publishing|proceedings|conference|symposium|workshop|congress|meeting)\b/iu.test(
      backbone,
    ) ||
      matchedSignals.has('cue_conference') ||
      matchedSignals.has('cue_book_publisher') ||
      hasQuotedInstitutionTail);
  const hasFallbackConferenceCadence =
    matchedSignals.has('bracketed_enumerator') &&
    (matchedSignals.has('has_et_al') || matchedSignals.has('author_bucket_many')) &&
    matchedSignals.has('year_late_position') &&
    matchedSignals.has('identifier_doi') &&
    (!matchedSignals.has('quoted_title') || hasQuotedInstitutionTail) &&
    !matchedSignals.has('locator_ieee_signature');
  const hasInstitutionalTailCadence =
    matchedSignals.has('bracketed_enumerator') &&
    matchedSignals.has('identifier_doi') &&
    (!matchedSignals.has('quoted_title') || hasQuotedInstitutionTail) &&
    !matchedSignals.has('locator_ieee_signature') &&
    (hasInitialLead ||
      matchedSignals.has('author_lead_ambiguous') ||
      matchedSignals.has('author_surname_initials') ||
      matchedSignals.has('author_initials_surname')) &&
    /,\s*[^,.;]{6,260};\s*(?:19|20)\d{2}\.?$/u.test(backbone);
  return hasPublisherSpine || hasFallbackConferenceCadence || hasInstitutionalTailCadence;
}

function hasApaConferenceCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  const hasConferenceOrPresentationCue =
    matchedSignals.has('cue_conference') ||
    STYLE_CONFERENCE_CUE_REGEX.test(backbone) ||
    /\[(?:Poster|Presentation|Conference Paper|Paper)\]/iu.test(backbone) ||
    /\b(?:poster|presentation)\b/iu.test(backbone);
  return (
    (matchedSignals.has('year_parenthesized_after_authors') ||
      hasApaLongAuthorLeadCommitProfile(text, matchedSignals)) &&
    !matchedSignals.has('quoted_title') &&
    hasConferenceOrPresentationCue &&
    /^[^"]{2,220}\(\d{4}[a-z]?\)\.\s+[^.]{4,260}(?:\s*\[[^\]]+\])?\.\s+[^.]{2,260}(?:\.|$)/iu.test(
      backbone,
    )
  );
}

function hasApaBookCommitProfile(text: string, matchedSignals: Set<StyleSignalCode>): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  return (
    (matchedSignals.has('year_parenthesized_after_authors') ||
      hasApaLongAuthorLeadCommitProfile(text, matchedSignals)) &&
    !matchedSignals.has('quoted_title') &&
    matchedSignals.has('cue_book_publisher') &&
    /^[^"]{2,180}\(\d{4}[a-z]?\)\.\s+[^.]{4,220}\.\s+[^.]{2,120}\.?$/iu.test(backbone)
  );
}

function hasApaSparseContainerCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  const backbone = stripTrailingIdentifierTail(text);
  const segments = backbone
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const container = segments.at(-1) ?? '';
  const hasConferenceLikeContainer =
    STYLE_CONFERENCE_CUE_REGEX.test(container) ||
    (/\p{Lu}{4,}/u.test(container) && container.replace(/[^\p{L}]/gu, '').length >= 18);

  return (
    matchedSignals.has('year_parenthesized_after_authors') &&
    !matchedSignals.has('quoted_title') &&
    !/\bAvailable at:/iu.test(text) &&
    /^[^"]{0,220}\(\d{4}[a-z]?\)\.\s+[^.]{4,260}\.\s+[^.]{6,320}\.?$/iu.test(backbone) &&
    hasConferenceLikeContainer
  );
}

function hasApaThesisBracketedCommitProfile(
  text: string,
  matchedSignals: Set<StyleSignalCode>,
): boolean {
  return (
    matchedSignals.has('year_parenthesized_after_authors') &&
    !/\bAvailable at:/iu.test(text) &&
    /\[[^\]]*(?:dissertation|thesis|doctoral dissertation|master'?s thesis)[^\]]*\]/iu.test(text)
  );
}

function isTrailingIdentifierStart(
  normalizedText: string,
  identifierStart: number,
  minimumShare: number,
): boolean {
  return identifierStart >= 0 && identifierStart >= normalizedText.length * minimumShare;
}

function stripTrailingIdentifierTail(normalizedText: string): string {
  const doiMatch = normalizedText.match(DOI_REGEX)?.[0] ?? null;
  const urlMatch = normalizedText.match(URL_REGEX)?.[0] ?? null;
  const identifier = [doiMatch, urlMatch]
    .filter((value): value is string => value != null)
    .sort((left, right) => normalizedText.indexOf(left) - normalizedText.indexOf(right))[0];

  if (!identifier) {
    return normalizedText;
  }

  const identifierIndex = normalizedText.indexOf(identifier);
  if (
    !isTrailingIdentifierStart(
      normalizedText,
      identifierIndex,
      STYLE_DETECTION_THRESHOLDS.identifierBackboneStripShare,
    )
  ) {
    return normalizedText;
  }

  return normalizedText
    .slice(0, identifierIndex)
    .trim()
    .replace(/[.,;:\s]+$/u, '');
}

function stripTerminalIdentifierTail(normalizedText: string): string {
  return normalizedText
    .replace(/\s*https?:\/\/[^\s"'<>]+\.?$/iu, '')
    .replace(/\s*(?:doi:\s*)?10\.\d{4,9}\/[^\s"'<>]+\.?$/iu, '')
    .trim()
    .replace(/[.,;:\s]+$/u, '');
}

function stripAccessedRetrievedTail(normalizedText: string): string {
  return normalizedText
    .replace(/\s+\b(?:Accessed|Retrieved)\b[^.]*\.?$/iu, '')
    .trim()
    .replace(/[.,;:\s]+$/u, '');
}

function stripUrlAndAccessNoise(normalizedText: string): string {
  return stripAccessedRetrievedTail(normalizedText)
    .replace(/\bhttps?:\/\/[^\s"'<>]+/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPreYearContainer(normalizedText: string, firstYearIndex: number): string {
  if (firstYearIndex <= 0) {
    return '';
  }

  const beforeYear = normalizedText.slice(0, firstYearIndex).trim();
  const segments = beforeYear
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.at(-1) ?? '';
}

function looksJournalAbbrevLike(segment: string): boolean {
  const tokens = segment.match(/\b[\p{L}\p{M}.'’-]+\b/gu) ?? [];
  if (tokens.length < 2 || tokens.length > 6) {
    return false;
  }

  const abbreviationLike = tokens.filter((token) => {
    if (token.length <= 3) {
      return true;
    }
    if (token.endsWith('.')) {
      return true;
    }
    return /^[A-Z][a-z]{0,12}$/u.test(token);
  }).length;

  const hasMixedShortTokens = tokens.some((token) => token.length <= 4);
  return (
    abbreviationLike / tokens.length >= STYLE_DETECTION_THRESHOLDS.journalAbbrevRatio &&
    hasMixedShortTokens
  );
}

function looksSentenceCase(title: string): boolean {
  const words = tokenizeWords(title);
  if (words.length === 0) {
    return false;
  }

  const significantWords = words.filter((word) => word.length > 2);
  const capitalizedAfterFirst = significantWords.slice(1).filter(isTitleCaseWord).length;
  return (
    isTitleCaseWord(words[0] ?? '') &&
    capitalizedAfterFirst / Math.max(1, significantWords.length - 1) <= 0.35
  );
}

function looksTitleCase(title: string): boolean {
  const words = tokenizeWords(title).filter((word) => word.length > 2);
  if (words.length < 2) {
    return false;
  }

  const titleCaseWords = words.filter(isTitleCaseWord).length;
  return titleCaseWords / words.length >= 0.6;
}

function looksNumericMinimal(title: string): boolean {
  const words = tokenizeWords(title);
  if (words.length === 0) {
    return false;
  }

  const capitalizedAfterFirst = words.slice(1).filter(isTitleCaseWord).length;
  return capitalizedAfterFirst / Math.max(1, words.length - 1) <= 0.2;
}

function tokenizeWords(value: string): string[] {
  return value.match(/\b[\p{L}\p{N}'-]+\b/gu) ?? [];
}

function isTitleCaseWord(word: string): boolean {
  return /^[A-Z][a-z]/u.test(word);
}

function safeUrlHost(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}
