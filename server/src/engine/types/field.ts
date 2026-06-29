export type FieldSource =
  | 'ml_extraction'       // Phase 4: SciBERT+CRF
  | 'ml_author_ner'       // Phase 5: AffilGood
  | 'ml_type_classifier'  // Phase 6: DistilBERT
  | 'llm_fallback'        // Phase 6.5: GPT-5.4 nano
  | 'shared_repair'       // Phase 6.8: structural field repair
  | 'normalization'       // Phase 7
  | 'enrichment_crossref' // Phase 8
  | 'enrichment_openalex' // Phase 8
  | 'enrichment_semantic_scholar' // Phase 8 (last resort)
  | 'user_correction'     // Phase 13 (pending, not yet admin-confirmed)
  | 'admin_confirmed'     // Phase 13 (admin-approved, NEVER overwritable)
  | 'regex_fallback'      // any phase, ML unavailable
  | 'doi_resolution'      // Phase 1: DOI → metadata
  | 'ingestion';          // Phase 1: BibTeX/RIS structured input

export type FieldOrigin =
  | 'ml'
  | 'authority'
  | 'admin'
  | 'user_consensus'
  | 'heuristic'
  | 'ingestion';

export const SOURCE_ORIGIN: Record<FieldSource, FieldOrigin> = {
  ml_extraction: 'ml',
  ml_author_ner: 'ml',
  ml_type_classifier: 'ml',
  llm_fallback: 'ml',
  shared_repair: 'heuristic',
  normalization: 'heuristic',
  enrichment_crossref: 'authority',
  enrichment_openalex: 'authority',
  enrichment_semantic_scholar: 'authority',
  user_correction: 'heuristic',
  admin_confirmed: 'admin',
  regex_fallback: 'heuristic',
  doi_resolution: 'authority',
  ingestion: 'ingestion',
} as const;

const TRUSTED_ORIGINS = new Set<FieldOrigin>(['authority', 'admin', 'user_consensus']);

/**
 * Source priority order (higher index = higher authority).
 * Used by the overwrite guard to enforce the correction hierarchy.
 *
 * admin_confirmed > provider_enriched > model_extracted >
 * pending_user_correction > regex_fallback > empty
 */
export const SOURCE_PRIORITY: Record<FieldSource, number> = {
  ingestion: 1,
  regex_fallback: 2,
  ml_extraction: 3,
  ml_author_ner: 3,
  ml_type_classifier: 3,
  normalization: 4,
  shared_repair: 4,
  llm_fallback: 4,
  doi_resolution: 5,
  enrichment_crossref: 5,
  enrichment_openalex: 5,
  enrichment_semantic_scholar: 5,
  user_correction: 6,
  admin_confirmed: 7,
} as const;

export interface FieldValue<T> {
  value: T;
  confidence: number;       // 0.0–1.0
  source: FieldSource;
  origin: FieldOrigin;
  stageId: string;          // e.g. 'phase4_extraction'
  uncertain: boolean;       // true when confidence < per-field threshold
  previousValue?: T;        // before last write (audit trail)
  previousSource?: FieldSource;
  previousOrigin?: FieldOrigin;
}

export interface FieldValueOptions<T> {
  origin?: FieldOrigin;
  uncertain?: boolean;
  previousValue?: T;
  previousSource?: FieldSource;
  previousOrigin?: FieldOrigin;
}

export function fieldOf<T>(
  value: T,
  source: FieldSource,
  stageId: string,
  confidence = 1.0,
  options: FieldValueOptions<T> = {},
): FieldValue<T> {
  const origin = options.origin ?? getFieldOriginForSource(source);
  const normalizedConfidence = isTrustedFieldOrigin(origin)
    ? 1
    : clampConfidence(confidence);

  return {
    value,
    confidence: normalizedConfidence,
    source,
    origin,
    stageId,
    uncertain: options.uncertain ?? (!isTrustedFieldOrigin(origin) && normalizedConfidence < 0.7),
    ...(options.previousValue !== undefined ? { previousValue: options.previousValue } : {}),
    ...(options.previousSource ? { previousSource: options.previousSource } : {}),
    ...(options.previousOrigin ? { previousOrigin: options.previousOrigin } : {}),
  };
}

export function emptyField<T>(stageId: string, source: FieldSource = 'ml_extraction'): FieldValue<T | null> {
  return {
    value: null,
    confidence: 0,
    source,
    origin: getFieldOriginForSource(source),
    stageId,
    uncertain: true,
  };
}

/**
 * Overwrite guard — enforces the correction hierarchy.
 *
 * Returns true if `incoming` may overwrite `existing`:
 *   - admin_confirmed can NEVER be overwritten by anyone
 *   - provider_enriched (crossref/openalex) may overwrite model values
 *     only when incomingConfidence >= 0.85 AND > existing confidence
 *   - All other sources: incoming priority must be strictly higher
 */
export function canOverwrite<T>(
  existing: FieldValue<T>,
  incomingSource: FieldSource,
  incomingConfidence: number,
): boolean {
  // Rule 1: admin_confirmed is immutable
  if (existing.source === 'admin_confirmed') return false;

  // Rule 2: confidence-gated enrichment overwrite
  const isProviderSource =
    incomingSource === 'enrichment_crossref'
    || incomingSource === 'enrichment_openalex'
    || incomingSource === 'enrichment_semantic_scholar';
  if (isProviderSource) {
    return incomingConfidence >= 0.85 && incomingConfidence > existing.confidence;
  }

  // Rule 3: higher-priority source wins
  return SOURCE_PRIORITY[incomingSource] > SOURCE_PRIORITY[existing.source];
}

export function getFieldOriginForSource(source: FieldSource): FieldOrigin {
  return SOURCE_ORIGIN[source];
}

export function isTrustedFieldOrigin(origin: FieldOrigin): boolean {
  return TRUSTED_ORIGINS.has(origin);
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, confidence));
}
