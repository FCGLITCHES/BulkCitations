import { getEffectiveMandatoryThreshold, isFieldStructurallyValidated } from './confidenceCalibration.js';
import type { ExtractedFields } from './types/citation.js';
import { isTrustedFieldOrigin } from './types/field.js';
import { EXTRACTED_FIELD_KEYS } from './utils/fields.js';

export function isFieldUncertain<K extends keyof ExtractedFields>(
  key: K,
  field: ExtractedFields[K],
): boolean {
  if (isTrustedFieldOrigin(field.origin)) return false;
  const structurallyValidated = isFieldStructurallyValidated(key, field.value);
  return field.confidence < getEffectiveMandatoryThreshold(key, structurallyValidated);
}

export function syncFieldUncertainty(fields: ExtractedFields): ExtractedFields {
  for (const key of EXTRACTED_FIELD_KEYS) {
    fields[key].uncertain = isFieldUncertain(key, fields[key]);
  }
  return fields;
}
