import { env } from '../config.js';
import {
  FIELD_CONFIDENCE_THRESHOLDS,
  FIELD_CONFIDENCE_THRESHOLDS_VALIDATED,
} from './mandatory-fields.js';
import { validateMandatoryField } from './healthRules.js';
import type { ExtractedFields } from './types/citation.js';
import type { PipelineContext } from './types/pipeline.js';
import { EXTRACTED_FIELD_KEYS, hasFieldValue, type ExtractedFieldKey } from './utils/fields.js';
import { isTrustedFieldOrigin } from './types/field.js';

const LEGACY_RECOVERY_CONFIDENCE_CAP = 0.82;
const LEGACY_RECOVERY_CONFIDENCE_FLOOR = 0.55;

export function isLlmFallbackEnabled(): boolean {
  return env.ENABLE_LLM_FALLBACK;
}

export function getLlmRepairBudget(ctx: PipelineContext): number {
  if (ctx.tenantContext.isAdmin) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (ctx.tenantContext.tier === 'pro' || ctx.tenantContext.tier === 'b2b') {
    return env.LLM_REPAIR_BUDGET_PRO;
  }

  return env.LLM_REPAIR_BUDGET_FREE;
}

export function getRemainingLlmRepairBudget(ctx: PipelineContext): number {
  return Math.max(0, getLlmRepairBudget(ctx) - ctx.providerUsage.llmRepairCalls);
}

export function canUseHostedLlmRepair(ctx: PipelineContext): boolean {
  if (!isLlmFallbackEnabled()) {
    return false;
  }

  return getRemainingLlmRepairBudget(ctx) > 0;
}

export function isFieldStructurallyValidated(
  field: ExtractedFieldKey,
  value: ExtractedFields[ExtractedFieldKey]['value'],
): boolean {
  return validateMandatoryField(field, value).valid;
}

export function getEffectiveMandatoryThreshold(
  field: ExtractedFieldKey,
  structurallyValidated: boolean,
): number {
  const base = FIELD_CONFIDENCE_THRESHOLDS[field] ?? 0.7;

  if (!structurallyValidated) {
    return base;
  }

  return FIELD_CONFIDENCE_THRESHOLDS_VALIDATED[field] ?? base;
}

/**
 * When fallback repair recovers a structurally valid value, raise confidence to the
 * mandatory threshold floor instead of clamping below Phase 10 gates.
 */
export function calibrateRecoveredFieldConfidence(
  field: ExtractedFieldKey,
  value: ExtractedFields[ExtractedFieldKey]['value'],
  referenceConfidence: number,
): number {
  const raw = Math.max(
    LEGACY_RECOVERY_CONFIDENCE_FLOOR,
    referenceConfidence - 0.03,
  );

  if (!isFieldStructurallyValidated(field, value)) {
    return Math.min(LEGACY_RECOVERY_CONFIDENCE_CAP, raw);
  }

  const floor = FIELD_CONFIDENCE_THRESHOLDS[field] ?? 0.7;
  return Math.min(1, Math.max(raw, floor));
}

/** Align heuristic/ML field confidence with validated Phase 10 gates after normalization. */
export function calibrateStructurallyValidFieldConfidences(fields: ExtractedFields): void {
  for (const key of EXTRACTED_FIELD_KEYS) {
    const field = fields[key];
    if (!hasFieldValue(field) || isTrustedFieldOrigin(field.origin)) continue;
    if (!isFieldStructurallyValidated(key, field.value)) continue;

    const floor = getEffectiveMandatoryThreshold(key, true);
    if (field.confidence < floor) {
      field.confidence = floor;
    }
  }
}
