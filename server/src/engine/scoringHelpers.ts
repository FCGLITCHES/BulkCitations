import type { CitationStyle, ScoreBreakdown, ScorePenalty } from './types/citation.js';
import { clampScore, GUARANTEED_SCORING_STYLES, resolveScoreWeights } from './scoreConfig.js';

export function addOrReplacePenalty(
  penalties: ScorePenalty[],
  code: string,
  points: number,
): ScorePenalty[] {
  const next = penalties.filter((penalty) => penalty.code !== code);
  next.push({ code, points });
  return next;
}

export function removePenalty(penalties: ScorePenalty[], code: string): ScorePenalty[] {
  return penalties.filter((penalty) => penalty.code !== code);
}

export function resolveFormatScoringPath(style: CitationStyle): {
  path: 'guaranteed' | 'fallback';
  reason: 'style_guaranteed' | 'style_fallback' | 'low_detection_confidence';
} {
  if (!GUARANTEED_SCORING_STYLES.has(style)) {
    return { path: 'fallback', reason: 'style_fallback' };
  }

  return { path: 'guaranteed', reason: 'style_guaranteed' };
}

export function finalizeRawScore(breakdown: ScoreBreakdown, style: CitationStyle): number {
  const { fieldWeight, formatWeight, structuralWeight } = resolveScoreWeights(style);
  const penaltyTotal = breakdown.penalties.reduce((sum, penalty) => sum + penalty.points, 0);

  return clampScore(
    100 *
      (fieldWeight * breakdown.fieldEvidenceScore +
        formatWeight * breakdown.formatCorrectnessScore +
        structuralWeight * breakdown.structuralIntegrityScore) -
      penaltyTotal,
  );
}

export function finalizeDisplayScore(rawScore: number, authorityAdjustment: number): number {
  return clampScore(rawScore + authorityAdjustment);
}
