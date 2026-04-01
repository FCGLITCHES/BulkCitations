import type { CanonicalCitation, V2ConversionRequest, V3FieldLock } from '@shared/schema';
import { createFieldValue, normalizeWhitespace } from '../v2/utils.js';

export const LOCKABLE_FIELDS = [
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

type LockableField = typeof LOCKABLE_FIELDS[number];

export interface V3RuntimeFieldLock extends V3FieldLock {
  value?: unknown;
}

function normalizeRaw(value: string): string {
  return normalizeWhitespace(value);
}

function normalizeIncomingLock(field: string, rawLock: unknown): V3RuntimeFieldLock | null {
  if (!rawLock || typeof rawLock !== 'object') return null;
  const source = typeof (rawLock as Record<string, unknown>).source === 'string'
    ? String((rawLock as Record<string, unknown>).source)
    : 'model';
  const lockClass = typeof (rawLock as Record<string, unknown>).class === 'string'
    ? String((rawLock as Record<string, unknown>).class)
    : 'verified';
  const locked = typeof (rawLock as Record<string, unknown>).locked === 'boolean'
    ? Boolean((rawLock as Record<string, unknown>).locked)
    : lockClass !== 'unlocked';

  if (!locked) return null;

  return {
    field,
    class: lockClass as V3FieldLock['class'],
    source: source as V3FieldLock['source'],
    locked,
    value: (rawLock as Record<string, unknown>).value,
    reason: typeof (rawLock as Record<string, unknown>).reason === 'string'
      ? String((rawLock as Record<string, unknown>).reason)
      : undefined,
  };
}

export function initializeRuntimeFieldLocks(
  citations: CanonicalCitation[],
  request: V2ConversionRequest,
): Record<string, Record<string, V3FieldLock>> {
  const locksByCitationId: Record<string, Record<string, V3RuntimeFieldLock>> = {};
  const rawMetadata = request.metadata ?? {};
  const byCitationId = rawMetadata.fieldLocksByCitationId;
  const byRaw = rawMetadata.fieldLocksByRaw;

  for (const citation of citations) {
    const localLocks: Record<string, V3RuntimeFieldLock> = {};
    const citationSpecificLocks = byCitationId && typeof byCitationId === 'object'
      ? (byCitationId as Record<string, unknown>)[citation.id]
      : undefined;
    const rawSpecificLocks = byRaw && typeof byRaw === 'object'
      ? (byRaw as Record<string, unknown>)[normalizeRaw(citation.raw)]
      : undefined;

    for (const candidate of [citationSpecificLocks, rawSpecificLocks]) {
      if (!candidate || typeof candidate !== 'object') continue;
      for (const field of LOCKABLE_FIELDS) {
        const normalized = normalizeIncomingLock(field, (candidate as Record<string, unknown>)[field]);
        if (normalized) {
          localLocks[field] = normalized;
        }
      }
    }

    locksByCitationId[citation.id] = localLocks;
  }

  return locksByCitationId;
}

export function applyRuntimeFieldLocks(
  previousCitations: CanonicalCitation[],
  nextCitations: CanonicalCitation[],
  locksByCitationId: Record<string, Record<string, V3RuntimeFieldLock>>,
): CanonicalCitation[] {
  const previousById = new Map(previousCitations.map((citation) => [citation.id, citation]));

  return nextCitations.map((citation) => {
    const previous = previousById.get(citation.id);
    const locks = locksByCitationId[citation.id];
    if (!previous || !locks || Object.keys(locks).length === 0) return citation;

    const patched = { ...citation } as Record<string, any>;
    for (const field of LOCKABLE_FIELDS) {
      const runtimeLock = locks[field];
      if (!runtimeLock?.locked) continue;
      if (runtimeLock.value !== undefined) {
        const previousField = previous[field];
        const fieldSource = runtimeLock.source === 'user_correction'
          ? 'user'
          : runtimeLock.source === 'crossref' || runtimeLock.source === 'openalex'
            ? 'authority'
            : 'extracted';
        patched[field] = createFieldValue(
          runtimeLock.value as never,
          fieldSource,
          previousField?.confidence ?? 1,
          'v3_lock',
        );
        continue;
      }
      patched[field] = previous[field];
    }

    return patched as CanonicalCitation;
  });
}
