import { resolveSchemaStyle } from './mandatory-fields.js';
import { phase10Health } from './phases/phase10Health.js';
import { applyRenderHealthDemotions, phase12Render } from './phases/phase12Render.js';
import { RENDER_AFFECTING_FIELDS } from './scoreConfig.js';
import { finalizeDisplayScore, finalizeRawScore } from './scoringHelpers.js';
import type { ReferenceCarrier, StyleDetectionResult } from './types/carrier.js';
import type { ProcessedCitation } from './types/citation.js';
import type { PhaseId, PipelineContext } from './types/pipeline.js';
import { toHealthWarning } from './healthWarnings.js';
import { buildReferenceCarrier } from './utils/carriers.js';
import { EXTRACTED_FIELD_KEYS, hasFieldValue } from './utils/fields.js';

const RENDER_AFFECTING_FIELD_NAMES = new Set<string>([...RENDER_AFFECTING_FIELDS].map(String));

export async function rescoreCarrierAfterCorrection(
  carrier: ReferenceCarrier,
  ctx: PipelineContext,
  changedFields: Iterable<string>,
): Promise<void> {
  const changed = [...changedFields];
  const shouldRerender = changed.some((field) => isRenderAffectingField(field));
  const priorRenderWarnings = [...carrier.rendered.warnings];

  await phase10Health.run([carrier], ctx);

  if (shouldRerender) {
    await phase12Render.run([carrier], ctx);
  } else if (priorRenderWarnings.length > 0) {
    applyRenderHealthDemotions(
      carrier,
      priorRenderWarnings.map((code) => toHealthWarning(code)),
    );
  }

  const style =
    ctx.outputStyle !== 'auto' && ctx.outputStyle !== 'unknown'
      ? ctx.outputStyle
      : resolveSchemaStyle(ctx.outputStyle, carrier.style.primary.style, carrier.style.family);
  const rawScore = shouldRerender
    ? carrier.scoring.rawScore
    : finalizeRawScore(carrier.scoring.breakdown, style);
  const displayScore = finalizeDisplayScore(rawScore, carrier.authority.scoreAdjustment);

  carrier.scoring.rawScore = rawScore;
  carrier.scoring.displayScore = displayScore;
  carrier.scoring.breakdown = {
    ...carrier.scoring.breakdown,
    rawScore,
    displayScore,
    diagnostics: {
      ...carrier.scoring.breakdown.diagnostics,
      rescoredAfterCorrection: true,
    },
  };
}

export function isRenderAffectingField(fieldName: string): boolean {
  return RENDER_AFFECTING_FIELD_NAMES.has(fieldName);
}

export function hydrateCarrierFromProcessedCitation(citation: ProcessedCitation): ReferenceCarrier {
  const style: StyleDetectionResult = {
    primary: {
      style: citation.detectedStyle,
      confidence: citation.rawDetectionConfidence,
    },
    secondary: null,
    family: citation.detectedStyleFamily,
    familyConfidence: citation.familyConfidence,
    styleConfidence: citation.styleConfidence,
    familyMarginToRunnerUp: citation.familyMarginToRunnerUp,
    styleMarginToRunnerUp: citation.styleMarginToRunnerUp,
    certaintyTier: citation.certaintyTier,
    familyCandidates: structuredClone(citation.familyCandidates),
    styleCandidates: structuredClone(citation.styleCandidates),
    signals: structuredClone(citation.styleSignals),
    conflictDampened: citation.conflictDampened,
    isUnknown: citation.detectedStyleFamily === 'unknown',
    isMultiStyle: false,
  };
  const carrier = buildReferenceCarrier(
    {
      index: citation.index,
      text: citation.raw,
      splitMethod: 'uncertain',
      splitConfidence: citation.scoreBreakdown.diagnostics.detectionConfidence,
      isDoiResolved: false,
      flags: [],
    },
    style,
    {
      confidence: citation.rawDetectionConfidence,
      sampled: citation.scoreBreakdown.diagnostics.splitQualityFlag === 'sampled',
      splitQualityFlag: citation.scoreBreakdown.diagnostics.splitQualityFlag,
    },
    citation.outputStyle,
  );

  carrier.id = citation.id;
  carrier.publicStatus = citation.publicStatus;
  carrier.status = citation.status;
  carrier.fields = structuredClone(citation.fields);
  carrier.styleResolution = structuredClone(citation.styleResolution);
  carrier.doiVerification = structuredClone(citation.doiVerification);
  carrier.type = {
    type: citation.referenceType,
    confidence: citation.scoreBreakdown.structuralSubscores.refTypeConfidenceScore,
    isUnknown: citation.referenceType === 'unknown',
  };
  carrier.scoring = {
    rawScore: citation.rawScore,
    displayScore: citation.displayScore,
    publicStatus: citation.publicStatus,
    breakdown: structuredClone(citation.scoreBreakdown),
  };
  carrier.health = {
    publicStatus: citation.publicStatus,
    baseStatus: citation.publicStatus,
    reasons: [...citation.healthReasons],
    breakdown: structuredClone(citation.healthBreakdown),
    warnings: structuredClone(citation.healthWarnings),
    demotedBy: 'none',
  };
  carrier.healthEvidence.validSpanFields = EXTRACTED_FIELD_KEYS.filter((field) =>
    hasFieldValue(carrier.fields[field]),
  );
  carrier.authority = {
    checked: citation.authorityFlags.length > 0,
    flags: structuredClone(citation.authorityFlags),
    scoreAdjustment: citation.scoreBreakdown.authorityAdjustment,
    nextRecheckAt: new Date(),
  };
  carrier.rendered = {
    text: citation.renderedText,
    warnings: [...citation.renderedWarnings],
  };
  carrier.stageLog = structuredClone(citation.stageLog);
  if (citation.error) {
    carrier.error = {
      ...structuredClone(citation.error),
      phase: citation.error.phase as PhaseId,
    };
  }
  if (citation.partialData) carrier.partialData = structuredClone(citation.partialData);
  return carrier;
}

export function applyCarrierToProcessedCitation(
  citation: ProcessedCitation,
  carrier: ReferenceCarrier,
): void {
  citation.publicStatus = carrier.publicStatus;
  citation.status = carrier.status;
  if (carrier.error) {
    citation.error = {
      ...structuredClone(carrier.error),
      phase: carrier.error.phase,
    };
  }
  citation.fields = structuredClone(carrier.fields);
  citation.referenceType = carrier.type.type;
  citation.detectedStyleFamily = carrier.style.family;
  citation.detectedStyle = carrier.style.primary.style;
  citation.familyConfidence = carrier.style.familyConfidence;
  citation.styleConfidence = carrier.style.styleConfidence;
  citation.familyMarginToRunnerUp = carrier.style.familyMarginToRunnerUp;
  citation.styleMarginToRunnerUp = carrier.style.styleMarginToRunnerUp;
  citation.certaintyTier = carrier.style.certaintyTier;
  citation.styleCandidates = structuredClone(carrier.style.styleCandidates);
  citation.styleSignals = structuredClone(carrier.style.signals);
  citation.effectiveStyle = carrier.styleResolution.effectiveStyle;
  citation.effectiveStyleSource = carrier.styleResolution.effectiveStyleSource;
  citation.inputStyleUncertain = carrier.styleResolution.inputStyleUncertain;
  citation.rawDetectionConfidence = carrier.styleResolution.rawDetectionConfidence;
  citation.effectiveDetectionConfidence = carrier.styleResolution.effectiveDetectionConfidence;
  citation.styleResolution = structuredClone(carrier.styleResolution);
  citation.doiVerification = structuredClone(carrier.doiVerification);
  citation.rawScore = carrier.scoring.rawScore;
  citation.displayScore = carrier.scoring.displayScore;
  citation.scoreBreakdown = structuredClone(carrier.scoring.breakdown);
  citation.healthReasons = [...carrier.health.reasons];
  citation.healthBreakdown = structuredClone(carrier.health.breakdown);
  citation.healthWarnings = structuredClone(carrier.health.warnings);
  citation.authorityFlags = structuredClone(carrier.authority.flags);
  citation.renderedText = carrier.rendered.text;
  citation.renderedWarnings = [...carrier.rendered.warnings];
  citation.stageLog = structuredClone(carrier.stageLog);
}
