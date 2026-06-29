import { GUARANTEED_SCORING_STYLES } from './scoreConfig.js';
import type {
  CitationStyle,
  CitationStyleResolution,
  EffectiveStyleSource,
} from './types/citation.js';

function isKnownStyle(style: CitationStyle): boolean {
  return style !== 'auto' && style !== 'unknown';
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const DEFAULT_EFFECTIVE_STYLE: CitationStyle = 'apa7';

export function resolveCitationStyleResolution(input: {
  requestedStyle: CitationStyle;
  detectedStyle: CitationStyle;
  detectionConfidence: number;
  detectedIsUnknown: boolean;
  detectedIsUncertain?: boolean;
  doiFastPath?: boolean;
}): CitationStyleResolution {
  const requestedExplicit = isKnownStyle(input.requestedStyle);
  const detectedKnown = isKnownStyle(input.detectedStyle);
  const effectiveStyle = requestedExplicit
    ? input.requestedStyle
    : detectedKnown
      ? input.detectedStyle
      : DEFAULT_EFFECTIVE_STYLE;

  const effectiveStyleSource: EffectiveStyleSource = input.doiFastPath
    ? 'doi_fast_path'
    : requestedExplicit
      ? 'requested'
      : detectedKnown
        ? 'detected'
        : 'default';
  const effectiveStyleKnown = isKnownStyle(effectiveStyle);
  const rawDetectionConfidence = clampConfidence(input.detectionConfidence);
  const guaranteedPath = effectiveStyleKnown && GUARANTEED_SCORING_STYLES.has(effectiveStyle);
  const effectiveDetectionConfidence = guaranteedPath
    ? Math.max(rawDetectionConfidence, 0.9)
    : rawDetectionConfidence;
  const inputStyleUncertain =
    Boolean(input.detectedIsUncertain) || input.detectedIsUnknown || rawDetectionConfidence < 0.65;

  return {
    requestedStyle: input.requestedStyle,
    detectedStyle: input.detectedStyle,
    effectiveStyle,
    effectiveStyleSource,
    rawDetectionConfidence,
    effectiveDetectionConfidence,
    inputStyleUncertain,
    effectiveStyleKnown,
  };
}
