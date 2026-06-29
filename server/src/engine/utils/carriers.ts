import { randomUUID } from 'node:crypto';
import type { RawBlock, SplitQualityFlag } from '../types/ingestion.js';
import type {
  CarrierDetection,
  ReferenceCarrier,
  StyleDetectionResult,
} from '../types/carrier.js';
import { createEmptyScoreBreakdown } from '../scoreConfig.js';
import { resolveCitationStyleResolution } from '../styleResolution.js';
import type { CitationStyle } from '../types/citation.js';
import { styleFamilyForStyle } from '../styleDetection.js';
import { createEmptyExtractedFields } from './fields.js';

export function buildReferenceCarrier(
  block: RawBlock,
  style: StyleDetectionResult,
  detectionMeta?: { confidence: number; sampled: boolean; splitQualityFlag: SplitQualityFlag },
  requestedStyle: CitationStyle = 'apa7',
): ReferenceCarrier {
  const normalizedStyle = normalizeStyleDetectionResult(style);
  const detection = resolveCarrierDetection(block, normalizedStyle, detectionMeta);
  const styleResolution = resolveCitationStyleResolution({
    requestedStyle,
    detectedStyle: normalizedStyle.primary.style,
    detectionConfidence: normalizedStyle.primary.confidence,
    detectedIsUnknown: normalizedStyle.isUnknown,
    detectedIsUncertain: normalizedStyle.isUnknown || normalizedStyle.primary.style === 'unknown' || normalizedStyle.certaintyTier !== 'high',
    doiFastPath: block.isDoiResolved,
  });
  const carrier: ReferenceCarrier = {
    id: randomUUID(),
    index: block.index,
    raw: block.text,
    ...(block.semanticGroupKey ? { semanticGroupKey: block.semanticGroupKey } : {}),
    outputLatencyMs: 0,
    ...(block.inputCleanup ? { inputCleanup: structuredClone(block.inputCleanup) } : {}),
    ...(block.formatMeta ? { ingestionMeta: structuredClone(block.formatMeta) } : {}),
    publicStatus: block.flags.includes('uncertain') ? 'needs_action' : 'needs_review',
    parseOutcome: block.flags.includes('uncertain')
      ? 'needs_action'
      : 'partial_parse_with_abstentions',
    status: 'ok',
    fields: block.resolvedFields ?? createEmptyExtractedFields('phase4_extraction'),
    style: normalizedStyle,
    styleResolution,
    detection,
    doiVerification: {
      status: 'absent',
      reasons: [],
    },
    type: {
      type: 'unknown',
      confidence: 0,
      isUnknown: true,
    },
    enrichment: {
      status: 'skipped',
      crossrefHit: false,
      openalexHit: false,
      semanticScholarHit: false,
      fieldsEnriched: [],
      fieldsOverwritten: [],
      cacheHits: 0,
    },
    scoring: {
      rawScore: 0,
      displayScore: 0,
      publicStatus: block.flags.length > 0 ? 'needs_action' : 'needs_review',
      breakdown: createEmptyScoreBreakdown({
        splitQualityFlag: detection.splitQualityFlag,
        rawDetectionConfidence: styleResolution.rawDetectionConfidence,
        effectiveDetectionConfidence: styleResolution.effectiveDetectionConfidence,
      }),
    },
    health: {
      publicStatus: block.flags.length > 0 ? 'needs_action' : 'needs_review',
      baseStatus: block.flags.length > 0 ? 'needs_action' : 'needs_review',
      reasons: [],
      breakdown: {
        missingMandatory: [],
        invalidMandatory: [],
        lowConfidenceMandatory: [],
        presentMandatory: [],
      },
      warnings: [],
      demotedBy: 'none',
    },
    healthEvidence: {
      spans: [],
      validSpanFields: [],
      invalidSpanFields: [],
      parserWarnings: [],
      warnings: [],
    },
    authority: {
      checked: false,
      flags: [],
      scoreAdjustment: 0,
      nextRecheckAt: new Date(0),
    },
    rendered: {
      text: '',
      warnings: [],
      audit: {
        available: [],
        rendered: [],
        lost: [],
        suppressed: [],
      },
    },
    splitMeta: {
      method: block.splitMethod,
      confidence: block.splitConfidence,
      blockLength: block.text.length,
      flags: block.flags,
    },
    stageLog: [],
    fieldMoveLedger: [],
    doiFastPath: block.isDoiResolved,
    normalizationMeta: {
      appliedRules: [],
    },
  };

  return sealCarrierStyle(carrier);
}

function resolveCarrierDetection(
  block: RawBlock,
  style: StyleDetectionResult,
  detectionMeta?: { confidence: number; sampled: boolean; splitQualityFlag: SplitQualityFlag },
): CarrierDetection {
  if (detectionMeta) {
    return {
      confidence: detectionMeta.confidence,
      splitQualityFlag: detectionMeta.splitQualityFlag,
      sampled: detectionMeta.sampled,
    };
  }

  return {
    confidence: style.primary.confidence,
    splitQualityFlag: block.flags.length > 0 ? 'low' : 'sampled',
    sampled: true,
  };
}

function normalizeStyleDetectionResult(style: StyleDetectionResult): StyleDetectionResult {
  const primaryStyle = style.primary?.style ?? 'unknown';
  const primaryConfidence = clamp01(style.primary?.confidence ?? 0);
  const inferredFamily = style.family ?? (
    style.isUnknown || primaryStyle === 'unknown' || primaryStyle === 'auto'
      ? 'unknown'
      : styleFamilyForStyle(primaryStyle)
  );
  const family = inferredFamily ?? 'unknown';
  const secondary = style.secondary
    ? {
      style: style.secondary.style,
      confidence: clamp01(style.secondary.confidence),
    }
    : null;
  const styleCandidates = style.styleCandidates?.length
    ? style.styleCandidates.slice(0, 3).map((candidate) => ({
      style: candidate.style,
      score: clamp01(candidate.score),
    }))
    : [
      ...(primaryStyle !== 'unknown' && primaryStyle !== 'auto'
        ? [{ style: primaryStyle, score: primaryConfidence }]
        : []),
      ...(secondary ? [{ style: secondary.style, score: secondary.confidence }] : []),
    ];
  const styleMarginToRunnerUp = style.styleMarginToRunnerUp
    ?? Math.max(0, primaryConfidence - (secondary?.confidence ?? 0));
  const familyConfidence = clamp01(
    style.familyConfidence
    ?? (family === 'unknown'
      ? primaryConfidence
      : Math.max(primaryConfidence, style.styleConfidence ?? 0)),
  );
  const familyCandidates = style.familyCandidates?.length
    ? style.familyCandidates
      .filter((candidate) => candidate.family !== 'unknown')
      .slice(0, 4)
      .map((candidate) => ({
        family: candidate.family,
        score: clamp01(candidate.score),
      }))
    : family === 'unknown'
      ? []
      : [{ family, score: familyConfidence }];
  const normalized: StyleDetectionResult = {
    primary: {
      style: primaryStyle,
      confidence: primaryConfidence,
    },
    secondary,
    family,
    familyConfidence,
    styleConfidence: clamp01(
      style.styleConfidence
      ?? (primaryStyle !== 'unknown' && primaryStyle !== 'auto' ? primaryConfidence : 0),
    ),
    familyMarginToRunnerUp: clamp01(style.familyMarginToRunnerUp ?? styleMarginToRunnerUp),
    styleMarginToRunnerUp: clamp01(styleMarginToRunnerUp),
    certaintyTier: style.certaintyTier
      ?? resolveFallbackCertaintyTier(primaryStyle, primaryConfidence, family),
    familyCandidates,
    styleCandidates,
    signals: style.signals ?? [],
    conflictDampened: Boolean(style.conflictDampened),
    isUnknown: style.isUnknown ?? family === 'unknown',
    isMultiStyle: style.isMultiStyle ?? false,
  };

  return normalized;
}

function resolveFallbackCertaintyTier(
  style: CitationStyle,
  confidence: number,
  family: StyleDetectionResult['family'],
): StyleDetectionResult['certaintyTier'] {
  if (family === 'unknown' || style === 'unknown' || style === 'auto') {
    return 'low';
  }
  if (confidence >= 0.85) {
    return 'high';
  }
  if (confidence >= 0.75) {
    return 'medium';
  }
  return 'low';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function sealCarrierStyle<T extends ReferenceCarrier>(carrier: T): T {
  const frozenStyle = Object.freeze(structuredClone(carrier.style));
  Object.defineProperty(carrier, 'style', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: frozenStyle,
  });
  return carrier;
}
