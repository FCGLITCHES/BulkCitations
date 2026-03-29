import { createHash } from 'node:crypto';
import type { ParsedReference } from '@shared/schema';
import { computeFingerprint as computeReportFingerprint, loadReports } from '../../store/reportStore.js';
import { findBestTruthMatch, type TruthEntry } from '../../store/truthStore.js';
import { normalizeDoiValue, normalizeWhitespace } from './utils.js';

export type LlmFallbackAttemptErrorType =
  | 'timeout'
  | 'rate_limit'
  | 'invalid_json_response'
  | 'empty_response'
  | 'network_error'
  | 'token_limit_exceeded'
  | 'unexpected_runtime_error';

export interface LlmFallbackAttemptRecord {
  cacheKey: string;
  accepted: boolean;
  completedAt: string;
  errorType?: LlmFallbackAttemptErrorType;
}

export interface LlmFallbackClusterRecord {
  clusterKey: string;
  engineVersion: string;
  outputStyle: string;
  acceptedAt: string;
  fields: Partial<ParsedReference> & { referenceType?: string };
}

export interface LlmFallbackEligibilityContext {
  rawForCacheKey: string;
  outputStyle: string;
  engineVersion: string;
  userEdited?: boolean;
  adminApproved?: boolean;
  terminalVerificationNeeded?: boolean;
}

export interface LlmFallbackTruthState {
  truth: TruthEntry | null;
  newerReportExists: boolean;
  truthIsCurrent: boolean;
}

const PERSISTED_CLUSTER_FIELDS = new Set<keyof ParsedReference | 'referenceType'>([
  'authors',
  'title',
  'year',
  'publisher',
  'institution',
  'bookTitle',
  'conferenceTitle',
  'edition',
  'placeOfPublication',
  'referenceType',
]);

const attemptHistory = new Map<string, LlmFallbackAttemptRecord>();
const acceptedClusterStore = new Map<string, LlmFallbackClusterRecord>();
const inflightByCacheKey = new Map<string, Promise<unknown>>();
const inflightByClusterKey = new Map<string, Promise<unknown>>();

export function resetLlmFallbackPolicyForTests(): void {
  attemptHistory.clear();
  acceptedClusterStore.clear();
  inflightByCacheKey.clear();
  inflightByClusterKey.clear();
}

function normalizeKeyOnlyText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sanitizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function normalizeAuthorIdentity(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function extractTitlePrefix6(title: string | null | undefined): string {
  const tokens = normalizeWhitespace(title ?? '')
    .split(/\s+/)
    .map((token) => sanitizeToken(token))
    .filter(Boolean)
    .slice(0, 6);
  return tokens.join(' ');
}

export function computeFallbackCacheKey(rawText: string): string {
  return createHash('sha256')
    .update(normalizeKeyOnlyText(rawText))
    .digest('hex');
}

export function computeFallbackClusterKey(parsed: ParsedReference): string | null {
  const firstAuthorRaw = Array.isArray(parsed.authors) ? parsed.authors[0] : null;
  const firstAuthorLast = normalizeAuthorIdentity(
    typeof firstAuthorRaw === 'string'
      ? firstAuthorRaw.split(',')[0] ?? firstAuthorRaw
      : null,
  );
  const year = normalizeWhitespace(parsed.year ?? '').trim();
  const titlePrefix6 = extractTitlePrefix6(parsed.title ?? null);
  if (!firstAuthorLast || !year || !titlePrefix6) return null;
  return `${firstAuthorLast}::${year}::${titlePrefix6}`;
}

export function getPersistedClusterReuse(
  clusterKey: string | null,
  currentEngineVersion: string,
  currentOutputStyle: string,
): LlmFallbackClusterRecord | null {
  if (!clusterKey) return null;
  const existing = acceptedClusterStore.get(clusterKey);
  if (!existing) return null;
  if (existing.engineVersion !== currentEngineVersion || existing.outputStyle !== currentOutputStyle) {
    acceptedClusterStore.delete(clusterKey);
    return null;
  }
  return existing;
}

export function recordAcceptedClusterReuse(
  clusterKey: string | null,
  currentEngineVersion: string,
  currentOutputStyle: string,
  parsed: ParsedReference,
  referenceType: string,
): void {
  if (!clusterKey) return;
  const fields: Partial<ParsedReference> & { referenceType?: string } = { referenceType };
  for (const field of PERSISTED_CLUSTER_FIELDS) {
    if (field === 'referenceType') continue;
    const parsedField = field as keyof ParsedReference;
    const value = parsed[parsedField];
    if (value != null && (!(Array.isArray(value)) || value.length > 0)) {
      (fields as Partial<ParsedReference>)[parsedField] = value as never;
    }
  }
  acceptedClusterStore.set(clusterKey, {
    clusterKey,
    engineVersion: currentEngineVersion,
    outputStyle: currentOutputStyle,
    acceptedAt: new Date().toISOString(),
    fields,
  });
}

export function getFallbackAttemptHistory(cacheKey: string): LlmFallbackAttemptRecord | null {
  return attemptHistory.get(cacheKey) ?? null;
}

export function recordFallbackAttemptHistory(record: LlmFallbackAttemptRecord): void {
  attemptHistory.set(record.cacheKey, record);
}

export function canRetryFallbackAttempt(record: LlmFallbackAttemptRecord | null): boolean {
  return record?.errorType === 'unexpected_runtime_error';
}

export function isFieldStructurallyCorrupt(field: keyof ParsedReference, value: unknown): boolean {
  const normalized = normalizeWhitespace(
    Array.isArray(value) ? value.join(' ') : String(value ?? ''),
  );
  if (!normalized) return false;
  const containsIdentifier = /(https?:\/\/|doi:\s*10\.|10\.\d{4,}\/)/i.test(normalized);
  if (containsIdentifier && ['volume', 'issue', 'pages', 'journal', 'bookTitle', 'conferenceTitle', 'publisher', 'institution'].includes(field)) {
    return true;
  }
  if (field === 'edition') {
    return /\b(?:2nd|3rd|\d+(?:st|nd|rd|th)\s+ed\.?)\b.*\b(?:2nd|3rd|\d+(?:st|nd|rd|th)\s+ed\.?)\b/i.test(normalized);
  }
  return false;
}

export function applyClusterReuseFields(
  parsed: ParsedReference,
  clusterRecord: LlmFallbackClusterRecord | null,
): ParsedReference {
  if (!clusterRecord) return parsed;
  const next: ParsedReference = { ...parsed };
  for (const [field, value] of Object.entries(clusterRecord.fields) as Array<[keyof ParsedReference | 'referenceType', unknown]>) {
    if (field === 'referenceType') continue;
    const current = next[field];
    const emptyCurrent = current == null || (Array.isArray(current) ? current.length === 0 : normalizeWhitespace(String(current)).length === 0);
    if (emptyCurrent || isFieldStructurallyCorrupt(field, current)) {
      (next as Record<string, unknown>)[field] = value;
    }
  }
  return next;
}

export async function resolveTruthStateForFallback(context: LlmFallbackEligibilityContext): Promise<LlmFallbackTruthState> {
  const fingerprint = computeReportFingerprint(context.rawForCacheKey);
  const match = await findBestTruthMatch({
    fingerprint,
    outputStyle: context.outputStyle,
  });
  const truth = match?.matchType === 'fingerprint' ? match.truth : null;
  const reports = await loadReports();
  const newerReportExists = reports.some((report) => (
    report.fingerprint === fingerprint
    && new Date(report.createdAt).getTime() > new Date(truth?.validatedAt ?? 0).getTime()
  ));
  const staleByVersion = Boolean(
    truth?.staleAfterVersion
    && truth?.resolvedByVersion
    && truth.staleAfterVersion !== truth.resolvedByVersion
    && truth.staleAfterVersion === context.engineVersion,
  );
  const truthIsCurrent = Boolean(
    truth
    && !staleByVersion
    && !truth.staleReason
    && !newerReportExists
    && !context.adminApproved
  );
  return {
    truth,
    newerReportExists,
    truthIsCurrent,
  };
}

export function buildFallbackQueuePriority(params: {
  reportedBefore: boolean;
  userEdited: boolean;
  hardStructuralSuspicion: boolean;
  typePriority: boolean;
}): number {
  if (params.reportedBefore) return 1;
  if (params.userEdited) return 2;
  if (params.hardStructuralSuspicion) return 3;
  if (params.typePriority) return 4;
  return 5;
}

export function classifyLlmAttemptError(error: unknown): LlmFallbackAttemptErrorType {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  if (normalized.includes('timed out') || normalized.includes('timeout')) return 'timeout';
  if (normalized.includes('429') || normalized.includes('rate limit')) return 'rate_limit';
  if (normalized.includes('token') && normalized.includes('limit')) return 'token_limit_exceeded';
  if (normalized.includes('json')) return 'invalid_json_response';
  if (normalized.includes('empty response') || normalized.includes('no content')) return 'empty_response';
  if (normalized.includes('fetch') || normalized.includes('network') || normalized.includes('econn') || normalized.includes('enotfound')) {
    return 'network_error';
  }
  return 'unexpected_runtime_error';
}

export function buildSingleTargetIdentifierFingerprint(parsed: ParsedReference): string | null {
  const doi = parsed.doi ? normalizeDoiValue(parsed.doi) : null;
  if (doi) return `doi:${doi}`;
  const url = normalizeWhitespace(parsed.url ?? '').replace(/[)\].,;:]+$/g, '');
  return url || null;
}

export function getInflightCachePromise<T>(cacheKey: string): Promise<T> | null {
  return (inflightByCacheKey.get(cacheKey) as Promise<T> | undefined) ?? null;
}

export function setInflightCachePromise<T>(cacheKey: string, promise: Promise<T>): void {
  inflightByCacheKey.set(cacheKey, promise);
}

export function clearInflightCachePromise(cacheKey: string, promise: Promise<unknown>): void {
  if (inflightByCacheKey.get(cacheKey) === promise) {
    inflightByCacheKey.delete(cacheKey);
  }
}

export function getInflightClusterPromise<T>(clusterKey: string | null): Promise<T> | null {
  if (!clusterKey) return null;
  return (inflightByClusterKey.get(clusterKey) as Promise<T> | undefined) ?? null;
}

export function setInflightClusterPromise<T>(clusterKey: string | null, promise: Promise<T>): void {
  if (!clusterKey) return;
  inflightByClusterKey.set(clusterKey, promise);
}

export function clearInflightClusterPromise(clusterKey: string | null, promise: Promise<unknown>): void {
  if (!clusterKey) return;
  if (inflightByClusterKey.get(clusterKey) === promise) {
    inflightByClusterKey.delete(clusterKey);
  }
}
