import type {
  CanonicalCitation,
  CitationReviewBucket,
  V2ConversionRequest,
  V2ConversionResponse,
  V2FieldSource,
  V3Citation,
  V3ConversionResponse,
  V3FieldLock,
  V3FieldProvenance,
  V3FieldProvenanceEntry,
  V3MergeTraceEntry,
  V3RenderMetadata,
  V3ScoreContribution,
  V3ScoreFieldOrigin,
  V3StageContract,
  V3StageId,
} from '@shared/schema';
import { processV2Conversion } from '../v2/pipeline.js';

export const V3_STAGE_ORDER: V3StageId[] = [
  'ingest',
  'split',
  'detect_style',
  'extract_fields',
  'parse_authors',
  'classify_type',
  'normalize',
  'enrich',
  'llm_repair',
  'dedup',
  'base_score',
  'authority_validate_and_adjust',
  'render',
];

export const V3_CONTRACT_VERSIONS: Record<V3StageId, number> = {
  ingest: 1,
  split: 1,
  detect_style: 1,
  extract_fields: 1,
  parse_authors: 1,
  classify_type: 1,
  normalize: 1,
  enrich: 1,
  llm_repair: 1,
  dedup: 1,
  base_score: 1,
  authority_validate_and_adjust: 1,
  render: 1,
};

const CORE_FIELD_NAMES = [
  'authors',
  'title',
  'year',
  'journal',
  'volume',
  'issue',
  'pages',
  'doi',
  'publisher',
  'url',
  'conferenceTitle',
  'bookTitle',
  'institution',
  'edition',
  'editors',
  'editor',
  'thesisType',
  'repository',
] as const;

type CoreFieldName = typeof CORE_FIELD_NAMES[number];

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'F' {
  if (score >= 0.9) return 'A';
  if (score >= 0.8) return 'B';
  if (score >= 0.6) return 'C';
  return 'F';
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return normalizeWhitespace(String(value)).length > 0;
}

function sanitizeRawText(value: string): string {
  return normalizeWhitespace(value).replace(/[\r\n]+/g, ' ').trim();
}

function normalizeProviderName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function providerToAuthorityProvenance(provider: string | undefined): V3FieldProvenance {
  const normalized = normalizeProviderName(provider);
  if (normalized.includes('openalex')) return 'openalex';
  return 'crossref';
}

function fieldUsedLlmRepair(citation: CanonicalCitation, fieldName: string): boolean {
  return Boolean(citation.extraction?.llmFallbackFieldsImproved?.includes(fieldName));
}

function mapFieldSourceToProvenance(
  citation: CanonicalCitation,
  fieldName: string,
  source: V2FieldSource,
): V3FieldProvenance {
  if (fieldUsedLlmRepair(citation, fieldName)) return 'llm_fallback';

  switch (source) {
    case 'user':
      return 'user_correction';
    case 'authority':
      return providerToAuthorityProvenance(citation.resolution?.provider ?? citation.enrichment?.provider);
    case 'merged':
    case 'normalized':
    case 'extracted':
    default:
      return 'model';
  }
}

function toLockClass(source: V3FieldProvenance): V3FieldLock['class'] {
  if (source === 'user_correction' || source === 'crossref' || source === 'openalex') {
    return 'verified';
  }
  if (source === 'legacy_import_unverified') {
    return 'review_hold';
  }
  return 'unlocked';
}

function buildFieldLock(field: string, source: V3FieldProvenance): V3FieldLock {
  const lockClass = toLockClass(source);
  return {
    field,
    class: lockClass,
    source,
    locked: lockClass !== 'unlocked',
    reason: lockClass === 'verified'
      ? 'verified_provenance'
      : lockClass === 'review_hold'
        ? 'legacy_review_hold'
        : undefined,
  };
}

function stageContracts(): V3StageContract[] {
  return V3_STAGE_ORDER.map((stageId) => ({
    stageId,
    contractVersion: V3_CONTRACT_VERSIONS[stageId],
  }));
}

function buildFieldProvenance(citation: CanonicalCitation): Record<string, V3FieldProvenanceEntry> {
  const entries: Record<string, V3FieldProvenanceEntry> = {};
  const citationRecord = citation as unknown as Record<string, any>;

  for (const fieldName of CORE_FIELD_NAMES) {
    const field = citationRecord[fieldName];
    if (!field || typeof field !== 'object' || !('source' in field) || !('confidence' in field)) continue;

    const provenance = mapFieldSourceToProvenance(citation, fieldName, field.source);
    const lockClass = toLockClass(provenance);
    entries[fieldName] = {
      field: fieldName,
      source: provenance,
      confidence: typeof field.confidence === 'number' ? field.confidence : 0,
      lockClass,
      locked: lockClass !== 'unlocked',
    };
  }

  return entries;
}

function buildFieldLocks(
  fieldProvenance: Record<string, V3FieldProvenanceEntry>,
  request: V2ConversionRequest,
): Record<string, V3FieldLock> {
  const locks: Record<string, V3FieldLock> = {};
  const incomingLocks = request.metadata?.fieldLocks;

  for (const [field, entry] of Object.entries(fieldProvenance)) {
    locks[field] = buildFieldLock(field, entry.source);
  }

  if (incomingLocks && typeof incomingLocks === 'object') {
    for (const [field, rawLock] of Object.entries(incomingLocks as Record<string, unknown>)) {
      if (!rawLock || typeof rawLock !== 'object') continue;
      const source = typeof (rawLock as Record<string, unknown>).source === 'string'
        ? ((rawLock as Record<string, unknown>).source as V3FieldProvenance)
        : locks[field]?.source;
      if (!source) continue;

      const lockClass = typeof (rawLock as Record<string, unknown>).class === 'string'
        ? ((rawLock as Record<string, unknown>).class as V3FieldLock['class'])
        : toLockClass(source);
      locks[field] = {
        field,
        class: lockClass,
        source,
        locked: lockClass !== 'unlocked',
        reason: typeof (rawLock as Record<string, unknown>).reason === 'string'
          ? String((rawLock as Record<string, unknown>).reason)
          : locks[field]?.reason,
      };
    }
  }

  return locks;
}

function buildMergeTrace(
  citation: CanonicalCitation,
  fieldProvenance: Record<string, V3FieldProvenanceEntry>,
): Record<string, V3MergeTraceEntry> {
  const trace: Record<string, V3MergeTraceEntry> = {};
  const citationRecord = citation as unknown as Record<string, any>;

  for (const fieldName of CORE_FIELD_NAMES) {
    const field = citationRecord[fieldName];
    const provenance = fieldProvenance[fieldName]?.source ?? 'model';
    const mergedFrom = Array.isArray(field?.mergedFrom) ? field.mergedFrom : [];
    const origin: 'direct' | 'dedup_merge' = mergedFrom.length > 0 || citation.status === 'merged' ? 'dedup_merge' : 'direct';
    const winningCitationId = citation.status === 'duplicate'
      ? citation.duplicate?.duplicateOf ?? citation.id
      : citation.id;
    const losingCitationIds = mergedFrom.filter((id: string) => id !== winningCitationId);

    trace[fieldName] = {
      field: fieldName,
      winningCitationId,
      winningProvenance: provenance,
      losingCitationIds,
      losingProvenances: losingCitationIds.map(() => provenance),
      origin,
      improvedByMerge: origin === 'dedup_merge' && losingCitationIds.length > 0,
    };
  }

  return trace;
}

function buildScoreFieldOrigins(
  citation: CanonicalCitation,
  fieldProvenance: Record<string, V3FieldProvenanceEntry>,
  mergeTrace: Record<string, V3MergeTraceEntry>,
): Record<string, V3ScoreFieldOrigin> {
  const origins: Record<string, V3ScoreFieldOrigin> = {};
  const citationRecord = citation as unknown as Record<string, any>;

  for (const fieldName of CORE_FIELD_NAMES) {
    const field = citationRecord[fieldName];
    const provenance = fieldProvenance[fieldName]?.source ?? 'model';
    const contributions: V3ScoreContribution[] = [];
    const mergedFrom = Array.isArray(field?.mergedFrom) ? field.mergedFrom : [];
    const winnerId = mergeTrace[fieldName]?.winningCitationId ?? citation.id;

    contributions.push({
      citationId: winnerId,
      provenance,
      confidence: typeof field?.confidence === 'number' ? field.confidence : 0,
      origin: mergeTrace[fieldName]?.origin ?? 'direct',
    });

    for (const citationId of mergedFrom) {
      if (citationId === winnerId) continue;
      contributions.push({
        citationId,
        provenance,
        confidence: typeof field?.confidence === 'number' ? field.confidence : 0,
        origin: 'dedup_merge',
      });
    }

    origins[fieldName] = {
      field: fieldName,
      winningCitationId: winnerId,
      winningProvenance: provenance,
      contributions,
    };
  }

  return origins;
}

function bestAvailableText(citation: CanonicalCitation): string {
  const title = normalizeWhitespace(String(citation.title.value ?? ''));
  if (title) return title;

  const raw = sanitizeRawText(citation.raw);
  if (raw) return raw;

  return 'Citation unavailable.';
}

function buildRenderMetadata(citation: CanonicalCitation, formatted: string, warnings: string[]): V3RenderMetadata {
  let renderSource: V3RenderMetadata['renderSource'] = 'csl';
  if (citation.truth?.usedValidatedOutput) {
    renderSource = 'truth';
  } else if (formatted.startsWith('[Unresolved citation:')) {
    renderSource = 'fallback';
  }

  return {
    contractVersion: V3_CONTRACT_VERSIONS.render,
    renderSource,
    sanitized: Boolean(citation.rendered?.sanitized) || renderSource === 'fallback',
    warnings,
  };
}

function buildRenderedText(citation: CanonicalCitation): { formatted: string; warnings: string[]; renderMetadata: V3RenderMetadata } {
  const existing = normalizeWhitespace(citation.rendered?.formatted ?? '');
  const existingWarnings = [...(citation.rendered?.warnings ?? [])];
  const needsFallback = !existing || existing.startsWith('[Unresolved reference]') || existing.startsWith('[Unresolved citation:');
  const formatted = needsFallback
    ? `[Unresolved citation: ${citation.id}] ${bestAvailableText(citation)}`
    : existing;
  const warnings = needsFallback
    ? [...new Set([...existingWarnings, 'warning:v3_render_fallback'])]
    : existingWarnings;

  return {
    formatted,
    warnings,
    renderMetadata: buildRenderMetadata(citation, formatted, warnings),
  };
}

function hardAuthorityConflict(citation: CanonicalCitation): boolean {
  return Boolean((citation.resolution?.conflictFields?.length ?? 0) > 0);
}

function deriveAuthorityFlags(citation: CanonicalCitation): string[] {
  const flags: string[] = [];
  if (citation.enrichment?.retractedFlag || citation.quality?.flags?.includes('retracted')) {
    flags.push('retracted');
  }
  if (hardAuthorityConflict(citation)) {
    flags.push('authority_conflict');
  }
  switch (citation.resolution?.status) {
    case 'ambiguous_match':
      flags.push('authority_ambiguous_match');
      break;
    case 'provider_no_coverage':
      flags.push('authority_no_coverage');
      break;
    case 'provider_error':
      flags.push('authority_provider_unavailable');
      break;
    default:
      break;
  }
  if (citation.enrichment?.timedOut) {
    flags.push('authority_provider_unavailable');
  }
  return [...new Set(flags)];
}

function adjustAuthority(citation: CanonicalCitation): {
  rawScore: number;
  rawGrade: 'A' | 'B' | 'C' | 'F';
  rawBucket: CitationReviewBucket;
  displayScore: number;
  displayGrade: 'A' | 'B' | 'C' | 'F';
  displayBucket: CitationReviewBucket;
  authorityFlags: string[];
  authorityCheckedAt?: string;
  authorityAdjusted: boolean;
  authorityAdjustmentReasons: string[];
} {
  const rawScore = Number(citation.quality?.overall ?? 0);
  const rawGrade = citation.quality?.grade ?? gradeFromScore(rawScore);
  const rawBucket = citation.quality?.bucket ?? 'action_needed';
  const authorityFlags = deriveAuthorityFlags(citation);
  const reasons: string[] = [];

  if (authorityFlags.includes('authority_provider_unavailable')) {
    return {
      rawScore,
      rawGrade,
      rawBucket,
      displayScore: rawScore,
      displayGrade: rawGrade,
      displayBucket: rawBucket,
      authorityFlags,
      authorityCheckedAt: undefined,
      authorityAdjusted: false,
      authorityAdjustmentReasons: [],
    };
  }

  let displayScore = rawScore;
  let displayBucket = rawBucket;

  if (authorityFlags.includes('retracted')) {
    displayScore = Math.min(displayScore, 0.25);
    displayBucket = 'action_needed';
    reasons.push('retracted');
  } else if (authorityFlags.includes('authority_conflict')) {
    displayScore = Math.min(displayScore, 0.40);
    displayBucket = 'action_needed';
    reasons.push('authority_conflict');
  }

  const displayGrade = gradeFromScore(displayScore);
  return {
    rawScore,
    rawGrade,
    rawBucket,
    displayScore: Number(displayScore.toFixed(2)),
    displayGrade,
    displayBucket,
    authorityFlags,
    authorityCheckedAt: authorityFlags.length > 0 ? new Date().toISOString() : undefined,
    authorityAdjusted: Number(displayScore.toFixed(2)) !== Number(rawScore.toFixed(2)) || displayBucket !== rawBucket,
    authorityAdjustmentReasons: reasons,
  };
}

function upgradeCitation(citation: CanonicalCitation, request: V2ConversionRequest): V3Citation {
  const fieldProvenance = buildFieldProvenance(citation);
  const fieldLocks = buildFieldLocks(fieldProvenance, request);
  const mergeTrace = buildMergeTrace(citation, fieldProvenance);
  const scoreFieldOrigins = buildScoreFieldOrigins(citation, fieldProvenance, mergeTrace);
  const authority = adjustAuthority(citation);
  const rendered = buildRenderedText(citation);

  return {
    ...citation,
    rendered: {
      ...citation.rendered,
      outputStyle: citation.rendered?.outputStyle ?? request.outputStyle,
      formatted: rendered.formatted,
      warnings: rendered.warnings,
      sanitized: rendered.renderMetadata.sanitized,
    },
    contractVersion: 1,
    stageContracts: stageContracts(),
    fieldLocks,
    fieldProvenance,
    mergeTrace,
    rawScore: authority.rawScore,
    rawGrade: authority.rawGrade,
    rawBucket: authority.rawBucket,
    displayScore: authority.displayScore,
    displayGrade: authority.displayGrade,
    displayBucket: authority.displayBucket,
    scoreFieldOrigins,
    authorityFlags: authority.authorityFlags,
    authorityCheckedAt: authority.authorityCheckedAt,
    authorityAdjusted: authority.authorityAdjusted,
    authorityAdjustmentReasons: authority.authorityAdjustmentReasons,
    renderMetadata: rendered.renderMetadata,
  };
}

export function upgradeV2ResponseToV3(
  response: V2ConversionResponse,
  request: V2ConversionRequest,
  options?: {
    stagesRun?: V3StageId[];
    stageTimings?: V2ConversionResponse['processingPath']['stageTimings'];
    pipelineLog?: V2ConversionResponse['pipeline_log'];
    durationMs?: number;
    fallbacksUsed?: string[];
    partialResult?: boolean;
    partialReasons?: string[];
    contractVersions?: Record<V3StageId, number>;
  },
): V3ConversionResponse {
  const citations = response.citations.map((citation) => upgradeCitation(citation, request));

  return {
    ...response,
    engineVersion: 'v3',
    request,
    citations,
    processingPath: {
      stagesRun: options?.stagesRun ?? V3_STAGE_ORDER,
      contractVersions: options?.contractVersions ?? V3_CONTRACT_VERSIONS,
      fallbacksUsed: options?.fallbacksUsed ?? response.processingPath.fallbacksUsed,
      durationMs: options?.durationMs ?? response.processingPath.durationMs,
      partialResult: options?.partialResult ?? response.processingPath.partialResult,
      executionMode: response.processingPath.executionMode,
      partialReasons: options?.partialReasons ?? response.processingPath.partialReasons,
      stageTimings: options?.stageTimings ?? response.processingPath.stageTimings,
      slowestStages: options?.stageTimings
        ? [...options.stageTimings].sort((left, right) => right.durationMs - left.durationMs)
        : response.processingPath.slowestStages,
    },
    pipeline_log: options?.pipelineLog ?? response.pipeline_log,
    inputProfile: response.inputProfile,
  };
}

export async function processV3Conversion(
  request: V2ConversionRequest,
  options?: {
    executionMode?: 'sync' | 'async';
  },
) {
  const { response, adapters } = await processV2Conversion(request, options);
  return {
    response: upgradeV2ResponseToV3(response, request),
    adapters,
  };
}
