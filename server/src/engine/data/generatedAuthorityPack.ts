import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReferenceType } from '../types/citation.js';
import { normalizeDoi } from '../identifierUtils.js';
import type { StoredApprovedTruth } from '../../runtime/store.js';
import {
  effectiveRowStatus,
  isTaskCertified,
  precedenceFromLegacyTrust,
  withLegacyCertification,
} from '../../training/truthCertification.js';

export interface GeneratedAuthorityDoiHint {
  doi: string;
  typeHint: ReferenceType | null;
  publisherHint: string | null;
  conferenceTitleHint: string | null;
  truthId: string;
  trustLevel: StoredApprovedTruth['trustLevel'];
  goldKind: StoredApprovedTruth['goldKind'] | null;
}

export interface GeneratedJournalIssnHint {
  journal: string;
  issn: string;
  truthId: string;
  trustLevel: StoredApprovedTruth['trustLevel'];
  goldKind: StoredApprovedTruth['goldKind'] | null;
}

export interface GeneratedAuthorityPackBundle {
  version: string;
  generatedAt: string;
  doiExactHints: GeneratedAuthorityDoiHint[];
  journalIssnHints: GeneratedJournalIssnHint[];
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_GENERATED_AUTHORITY_PACK_PATH = resolve(
  moduleDir,
  '../../../data/generated/authority-pack.json',
);
const EMPTY_GENERATED_AUTHORITY_PACK: GeneratedAuthorityPackBundle = {
  version: 'generated-authority-pack.empty',
  generatedAt: '',
  doiExactHints: [],
  journalIssnHints: [],
};

let cachedBundle: GeneratedAuthorityPackBundle | null = null;

export function buildGeneratedAuthorityPack(
  rows: StoredApprovedTruth[],
  version = buildGeneratedAuthorityPackVersion(),
  generatedAt = new Date().toISOString(),
): GeneratedAuthorityPackBundle {
  const doiExactHints = new Map<string, GeneratedAuthorityDoiHint>();
  const journalIssnHints = new Map<string, GeneratedJournalIssnHint>();

  for (const rawRow of rows) {
    const row = withLegacyCertification(rawRow);
    if (effectiveRowStatus(row) === 'quarantined') {
      continue;
    }
    if (!isTaskCertified(row, 'authority_pack', 'core')) {
      continue;
    }

    const doi = extractTruthDoi(row);
    if (doi) {
      const nextHint: GeneratedAuthorityDoiHint = {
        doi,
        typeHint: normalizeReferenceType(row.expectedType),
        publisherHint: truthFieldText(row, 'publisher'),
        conferenceTitleHint: truthFieldText(row, 'conferenceTitle'),
        truthId: row.id,
        trustLevel: row.trustLevel,
        goldKind: row.goldKind ?? null,
      };
      const existing = doiExactHints.get(doi);
      if (!existing || precedenceFromLegacyTrust(nextHint.trustLevel) >= precedenceFromLegacyTrust(existing.trustLevel)) {
        doiExactHints.set(doi, nextHint);
      }
    }

    const journal = truthFieldText(row, 'journal') ?? truthFieldText(row, 'journal/venue');
    const issn = truthFieldText(row, 'issn');
    if (journal && issn) {
      const key = normalizeJournalHintKey(journal);
      const nextHint: GeneratedJournalIssnHint = {
        journal,
        issn,
        truthId: row.id,
        trustLevel: row.trustLevel,
        goldKind: row.goldKind ?? null,
      };
      const existing = journalIssnHints.get(key);
      if (!existing || precedenceFromLegacyTrust(nextHint.trustLevel) >= precedenceFromLegacyTrust(existing.trustLevel)) {
        journalIssnHints.set(key, nextHint);
      }
    }
  }

  return {
    version,
    generatedAt,
    doiExactHints: [...doiExactHints.values()].sort((left, right) => left.doi.localeCompare(right.doi)),
    journalIssnHints: [...journalIssnHints.values()].sort((left, right) => left.journal.localeCompare(right.journal)),
  };
}

export function buildGeneratedAuthorityPackVersion(date = new Date()): string {
  return `${date.toISOString().slice(0, 10)}.generated-authority-pack.v1`;
}

export function loadGeneratedAuthorityPack(): GeneratedAuthorityPackBundle {
  if (cachedBundle) {
    return cachedBundle;
  }

  for (const candidate of resolveGeneratedAuthorityPackCandidates()) {
    if (!candidate || !existsSync(candidate)) {
      continue;
    }
    try {
      const payload = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<GeneratedAuthorityPackBundle>;
      cachedBundle = {
        version: typeof payload.version === 'string' ? payload.version : EMPTY_GENERATED_AUTHORITY_PACK.version,
        generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : '',
        doiExactHints: Array.isArray(payload.doiExactHints) ? payload.doiExactHints.map(normalizeDoiHint).filter(Boolean) as GeneratedAuthorityDoiHint[] : [],
        journalIssnHints: Array.isArray(payload.journalIssnHints) ? payload.journalIssnHints.map(normalizeJournalHint).filter(Boolean) as GeneratedJournalIssnHint[] : [],
      };
      return cachedBundle;
    } catch {
      continue;
    }
  }

  cachedBundle = EMPTY_GENERATED_AUTHORITY_PACK;
  return cachedBundle;
}

export function lookupGeneratedAuthorityDoiHint(doi: string | undefined): GeneratedAuthorityDoiHint | null {
  const normalizedDoi = normalizeDoi(doi ?? undefined);
  if (!normalizedDoi) {
    return null;
  }
  return loadGeneratedAuthorityPack().doiExactHints.find((entry) => entry.doi === normalizedDoi) ?? null;
}

// The lookup previously did a linear `.find()` that re-normalized every pack entry
// on every call (O(pack size) per reference). The pack is immutable once loaded, so
// build a normalized-key -> issn Map once and reuse it. First-match-wins is preserved
// by only setting a key the first time it is seen (entries are sorted, matching the
// original `.find()` order), keeping output identical.
let cachedJournalIssnLookup:
  | { bundle: GeneratedAuthorityPackBundle; map: Map<string, string> }
  | null = null;

function journalIssnLookupMap(bundle: GeneratedAuthorityPackBundle): Map<string, string> {
  if (cachedJournalIssnLookup?.bundle === bundle) {
    return cachedJournalIssnLookup.map;
  }
  const map = new Map<string, string>();
  for (const entry of bundle.journalIssnHints) {
    const key = normalizeJournalHintKey(entry.journal);
    if (!map.has(key)) {
      map.set(key, entry.issn);
    }
  }
  cachedJournalIssnLookup = { bundle, map };
  return map;
}

export function lookupGeneratedJournalIssnHint(journal: string | undefined): string | null {
  if (!journal) {
    return null;
  }
  const key = normalizeJournalHintKey(journal);
  return journalIssnLookupMap(loadGeneratedAuthorityPack()).get(key) ?? null;
}

export function currentGeneratedAuthorityPackVersion(): string {
  return loadGeneratedAuthorityPack().version;
}

export function resolveGeneratedAuthorityPackCandidates(): string[] {
  return [
    process.env.LOCAL_AUTHORITY_PACK_PATH ?? '',
    resolve(process.cwd(), 'server/data/generated/authority-pack.json'),
    resolve(process.cwd(), 'data/generated/authority-pack.json'),
    DEFAULT_GENERATED_AUTHORITY_PACK_PATH,
  ].filter(Boolean);
}

export async function writeGeneratedAuthorityPack(
  bundle: GeneratedAuthorityPackBundle,
  filePath = DEFAULT_GENERATED_AUTHORITY_PACK_PATH,
): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  resetGeneratedAuthorityPackCache();
  return filePath;
}

export function resetGeneratedAuthorityPackCache(): void {
  cachedBundle = null;
}

function extractTruthDoi(row: StoredApprovedTruth): string | null {
  const source = row.coreTruth ?? row.expectedFields;
  const fieldDoi = source.doi;
  if (typeof fieldDoi === 'string') {
    return normalizeDoi(fieldDoi);
  }
  if (Array.isArray(fieldDoi)) {
    const firstString = fieldDoi.find((value) => typeof value === 'string');
    if (typeof firstString === 'string') {
      return normalizeDoi(firstString);
    }
  }

  const fieldUrl = source.url;
  if (typeof fieldUrl === 'string') {
    const urlDoi = normalizeDoi(fieldUrl);
    if (urlDoi) {
      return urlDoi;
    }
  }

  return normalizeDoi(row.rawText);
}

function truthFieldText(row: StoredApprovedTruth, field: string): string | null {
  const source = row.coreTruth ?? row.expectedFields;
  const value = source[field];
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (Array.isArray(value)) {
    const firstString = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return typeof firstString === 'string' ? firstString.trim() : null;
  }
  return null;
}

function normalizeReferenceType(value: string | null | undefined): ReferenceType | null {
  switch (value) {
    case 'article-journal':
    case 'book':
    case 'book-chapter':
    case 'thesis':
    case 'conference-paper':
    case 'webpage':
    case 'report':
    case 'patent':
    case 'dataset':
    case 'preprint':
    case 'unknown':
      return value;
    default:
      return null;
  }
}

// Pure normalization, called repeatedly with recurring journal names (and twice per
// lookupIssnByJournalTitle call). Memoize with a bounded cache — parity-safe since the
// function is deterministic.
const journalHintKeyCache = new Map<string, string>();
function normalizeJournalHintKey(value: string): string {
  const cached = journalHintKeyCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const result = value
    .normalize('NFKC')
    .replace(/&amp;/giu, '&')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (journalHintKeyCache.size >= 20000) {
    journalHintKeyCache.clear();
  }
  journalHintKeyCache.set(value, result);
  return result;
}

function normalizeDoiHint(value: unknown): GeneratedAuthorityDoiHint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const entry = value as Partial<GeneratedAuthorityDoiHint>;
  const doi = normalizeDoi(typeof entry.doi === 'string' ? entry.doi : undefined);
  if (!doi) {
    return null;
  }
  return {
    doi,
    typeHint: normalizeReferenceType(entry.typeHint ?? null),
    publisherHint: typeof entry.publisherHint === 'string' && entry.publisherHint.trim().length > 0 ? entry.publisherHint.trim() : null,
    conferenceTitleHint: typeof entry.conferenceTitleHint === 'string' && entry.conferenceTitleHint.trim().length > 0 ? entry.conferenceTitleHint.trim() : null,
    truthId: typeof entry.truthId === 'string' ? entry.truthId : 'generated',
    trustLevel: entry.trustLevel === 'gold' || entry.trustLevel === 'reviewed' ? entry.trustLevel : 'reviewed',
    goldKind: entry.goldKind ?? null,
  };
}

function normalizeJournalHint(value: unknown): GeneratedJournalIssnHint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const entry = value as Partial<GeneratedJournalIssnHint>;
  const journal = typeof entry.journal === 'string' ? entry.journal.trim() : '';
  const issn = typeof entry.issn === 'string' ? entry.issn.trim() : '';
  if (!journal || !issn) {
    return null;
  }
  return {
    journal,
    issn,
    truthId: typeof entry.truthId === 'string' ? entry.truthId : 'generated',
    trustLevel: entry.trustLevel === 'gold' || entry.trustLevel === 'reviewed' ? entry.trustLevel : 'reviewed',
    goldKind: entry.goldKind ?? null,
  };
}
