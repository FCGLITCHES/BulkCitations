import { fieldOf, type FieldSource, type FieldValue } from './types/field.js';

export const ENRICHMENT_OVERWRITE_THRESHOLD = 0.85;
export const LLM_FULL_FILL_CONFIDENCE_THRESHOLD = 0.85;

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function hasProviderValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function enrichmentSource(provider: 'crossref' | 'openalex' | 'semantic_scholar'): FieldSource {
  return `enrichment_${provider}` as FieldSource;
}

export function isAdminProtected(field: FieldValue<unknown> | undefined | null): boolean {
  return field?.source === 'admin_confirmed';
}

export function applyEnrichmentField<T>(
  existing: FieldValue<T>,
  providerValue: T,
  providerConfidence: number,
  provider: 'crossref' | 'openalex' | 'semantic_scholar',
  stageId: string,
): FieldValue<T> {
  if (isAdminProtected(existing) || !hasProviderValue(providerValue)) return existing;

  const confidence = clampConfidence(providerConfidence);

  if (existing.value === null || existing.value === undefined) {
    return fieldOf(providerValue, enrichmentSource(provider), stageId, confidence);
  }

  if (confidence >= ENRICHMENT_OVERWRITE_THRESHOLD && confidence > existing.confidence) {
    return {
      ...fieldOf(providerValue, enrichmentSource(provider), stageId, confidence),
      previousValue: existing.value,
      previousSource: existing.source,
      previousOrigin: existing.origin,
    };
  }

  return existing;
}

export function canLLMOverwrite(
  existing: FieldValue<unknown> | undefined,
  llmReferenceConfidence: number,
): boolean {
  if (!existing) return true;
  if (isAdminProtected(existing)) return false;
  if (clampConfidence(llmReferenceConfidence) >= LLM_FULL_FILL_CONFIDENCE_THRESHOLD) return true;
  return existing.value === null || existing.value === undefined;
}
