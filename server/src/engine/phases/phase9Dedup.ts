import type { ReferenceCarrier } from '../types/carrier.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import {
  buildCanonicalWorkKey,
  buildNearDupClusterId,
  buildNormalizedHash,
  normalizeDoiForKey,
} from '../ingestion/canonical.js';

const CONTRACT_VERSION = 1;
const STAGE_ID = 'phase9_deduplication';

// ── MinHash + LSH parameters ──────────────────────────────────────────────────
const NUM_PERMS = 128;
const NUM_BANDS = 16;
const ROWS_PER_BAND = 8; // NUM_PERMS / NUM_BANDS
const JACCARD_THRESHOLD = 0.85;
const SHINGLE_K = 3;

// ── FNV-1a (32-bit) ──────────────────────────────────────────────────────────

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── Permutation seeds (precomputed, deterministic) ────────────────────────────
// Each seed feeds a MurmurHash3-style finalizer to simulate an independent
// hash permutation for MinHash.

const PERM_SEEDS: Uint32Array = /* @__PURE__ */ (() => {
  const seeds = new Uint32Array(NUM_PERMS);
  for (let i = 0; i < NUM_PERMS; i++) {
    let s = Math.imul(i + 1, 0x9e3779b9) >>> 0;
    s ^= s >>> 16;
    s = Math.imul(s, 0x85ebca6b);
    s ^= s >>> 13;
    seeds[i] = s >>> 0;
  }
  return seeds;
})();

// ── Permuted hash (MurmurHash3 32-bit finalizer with seed XOR) ───────────────

function permutedHash(value: number, seed: number): number {
  let h = value ^ seed;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// ── Shingling ─────────────────────────────────────────────────────────────────
// Inline FNV-1a on 3 consecutive char-codes to avoid substring allocations.

function buildShingleHashes(text: string): Set<number> {
  const hashes = new Set<number>();
  const end = text.length - SHINGLE_K;
  for (let i = 0; i <= end; i++) {
    let h = 0x811c9dc5;
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ text.charCodeAt(i + 1), 0x01000193);
    h = Math.imul(h ^ text.charCodeAt(i + 2), 0x01000193);
    hashes.add(h >>> 0);
  }
  return hashes;
}

// ── MinHash signature ─────────────────────────────────────────────────────────

function computeSignature(shingleHashes: Set<number>): Uint32Array {
  const sig = new Uint32Array(NUM_PERMS).fill(0xffffffff);
  for (const sh of shingleHashes) {
    for (let i = 0; i < NUM_PERMS; i++) {
      const h = permutedHash(sh, PERM_SEEDS[i]!);
      if (h < sig[i]!) sig[i] = h;
    }
  }
  return sig;
}

// ── LSH band hashing ─────────────────────────────────────────────────────────
// Hashes each band (8 consecutive signature rows) into a 32-bit bucket key.
// The band index is mixed in so identical rows in different bands don't collide.

function computeBandHashes(sig: Uint32Array): Uint32Array {
  const out = new Uint32Array(NUM_BANDS);
  for (let band = 0; band < NUM_BANDS; band++) {
    let h = 0x811c9dc5;
    h = Math.imul(h ^ band, 0x01000193);
    const offset = band * ROWS_PER_BAND;
    for (let r = 0; r < ROWS_PER_BAND; r++) {
      const v = sig[offset + r]!;
      h = Math.imul(h ^ (v & 0xff), 0x01000193);
      h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
      h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
      h = Math.imul(h ^ (v >>> 24), 0x01000193);
    }
    out[band] = h >>> 0;
  }
  return out;
}

// ── Jaccard estimation from two MinHash signatures ────────────────────────────

function estimateJaccard(a: Uint32Array, b: Uint32Array): number {
  let agree = 0;
  for (let i = 0; i < NUM_PERMS; i++) {
    if (a[i] === b[i]) agree++;
  }
  return agree / NUM_PERMS;
}

// ── Union-Find (path compression + union by rank) ─────────────────────────────

class UnionFind {
  private parent = new Map<string, string>();
  private rnk = new Map<string, number>();

  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rnk.set(x, 0);
    }
  }

  find(x: string): string {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(x: string, y: string): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    const rankX = this.rnk.get(rx)!;
    const rankY = this.rnk.get(ry)!;
    if (rankX < rankY) {
      this.parent.set(rx, ry);
    } else if (rankX > rankY) {
      this.parent.set(ry, rx);
    } else {
      this.parent.set(ry, rx);
      this.rnk.set(rx, rankX + 1);
    }
  }

  connected(x: string, y: string): boolean {
    return this.find(x) === this.find(y);
  }

  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const arr = out.get(root);
      if (arr) arr.push(id);
      else out.set(root, [id]);
    }
    return out;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeDoi(value: string | null): string | null {
  return normalizeDoiForKey(value);
}

function buildDedupText(carrier: ReferenceCarrier): string {
  const title =
    typeof carrier.fields.title.value === 'string'
      ? carrier.fields.title.value
      : '';
  const authors = carrier.fields.authors.value;
  const firstFamily =
    Array.isArray(authors) && authors.length > 0 ? (authors[0]!.family ?? '') : '';

  return `${title} ${firstFamily}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstAuthorFamily(carrier: ReferenceCarrier): string | null {
  const authors = carrier.fields.authors.value;
  if (!Array.isArray(authors) || authors.length === 0) {
    return null;
  }
  const first = authors[0];
  if (!first) {
    return null;
  }
  return first.family ?? first.literal ?? null;
}

function sharesDoi(a: ReferenceCarrier, b: ReferenceCarrier): boolean {
  const da = normalizeDoi(a.fields.doi.value);
  const db = normalizeDoi(b.fields.doi.value);
  return !!da && da === db;
}

function sharesNormalizedHash(a: ReferenceCarrier, b: ReferenceCarrier): boolean {
  return typeof a.normalizedHash === 'string'
    && a.normalizedHash.length > 0
    && a.normalizedHash === b.normalizedHash;
}

function sharesCanonicalWorkKey(a: ReferenceCarrier, b: ReferenceCarrier): boolean {
  return typeof a.canonicalWorkKey === 'string'
    && a.canonicalWorkKey.length > 0
    && a.canonicalWorkKey === b.canonicalWorkKey;
}

function duplicateReasonForPair(
  carrier: ReferenceCarrier,
  primary: ReferenceCarrier,
): Exclude<ReferenceCarrier['duplicateReason'], undefined> {
  if (sharesDoi(carrier, primary)) {
    return 'doi_exact';
  }
  if (sharesNormalizedHash(carrier, primary)) {
    return 'normalized_hash';
  }
  if (sharesCanonicalWorkKey(carrier, primary)) {
    return 'canonical_work_key';
  }
  return 'minhash_lsh';
}

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
): StageRunRecord {
  return { stageId: STAGE_ID, contractVersion: CONTRACT_VERSION, ...record };
}

// ── Phase 9: Duplicate Clustering ─────────────────────────────────────────────

export class Phase9Dedup
  implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]>
{
  readonly phaseId = 'deduplication' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(
    carriers: ReferenceCarrier[],
    ctx: PipelineContext,
  ): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();

    if (!ctx.options.dedup) {
      ctx.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: 'skipped',
          durationMs: Date.now() - startedAt,
          message: 'Phase 9 deduplication disabled by request options.',
        }),
      );
      return carriers;
    }

    for (const carrier of carriers) {
      ensureDownstreamParity(carrier);
      carrier.normalizedHash = buildNormalizedHash(carrier.raw);
      carrier.canonicalWorkKey = buildCanonicalWorkKey({
        doi: carrier.fields.doi.value,
        url: carrier.fields.url.value,
        title: carrier.fields.title.value,
        year: carrier.fields.year.value,
        firstAuthorFamily: firstAuthorFamily(carrier),
      });
    }

    const uf = new UnionFind();
    const byId = new Map<string, ReferenceCarrier>();
    for (const c of carriers) {
      uf.add(c.id);
      byId.set(c.id, c);
    }

    // ── Pass 1: DOI exact-match ───────────────────────────────────────────────
    const normalizedHashBuckets = new Map<string, string[]>();
    for (const c of carriers) {
      const hash = c.normalizedHash;
      if (!hash) continue;
      const bucket = normalizedHashBuckets.get(hash);
      if (bucket) bucket.push(c.id);
      else normalizedHashBuckets.set(hash, [c.id]);
    }
    for (const ids of normalizedHashBuckets.values()) {
      for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!);
    }

    // ── Pass 2: DOI exact-match ───────────────────────────────────────────────
    const doiBuckets = new Map<string, string[]>();
    for (const c of carriers) {
      const doi = normalizeDoi(c.fields.doi.value);
      if (!doi) continue;
      const bucket = doiBuckets.get(doi);
      if (bucket) bucket.push(c.id);
      else doiBuckets.set(doi, [c.id]);
    }
    for (const ids of doiBuckets.values()) {
      for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!);
    }

    // ── Pass 3: canonical work keys ───────────────────────────────────────────
    const canonicalWorkBuckets = new Map<string, string[]>();
    for (const c of carriers) {
      const key = c.canonicalWorkKey;
      if (!key) continue;
      const bucket = canonicalWorkBuckets.get(key);
      if (bucket) bucket.push(c.id);
      else canonicalWorkBuckets.set(key, [c.id]);
    }
    for (const ids of canonicalWorkBuckets.values()) {
      for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!);
    }

    // ── Pass 4: MinHash + LSH ─────────────────────────────────────────────────
    const sigs = new Map<string, Uint32Array>();
    for (const c of carriers) {
      const text = buildDedupText(c);
      if (text.length < SHINGLE_K) continue;
      const shingles = buildShingleHashes(text);
      if (shingles.size === 0) continue;
      sigs.set(c.id, computeSignature(shingles));
    }

    // Index signatures into LSH band buckets
    const bandTables: Array<Map<number, string[]>> = Array.from(
      { length: NUM_BANDS },
      () => new Map(),
    );
    for (const [id, sig] of sigs) {
      const bands = computeBandHashes(sig);
      for (let band = 0; band < NUM_BANDS; band++) {
      const key = bands[band]!;
      const table = bandTables[band]!;
      const bucket = table.get(key);
      if (bucket) bucket.push(id);
      else table.set(key, [id]);
      }
    }

    // Collect candidate pairs (at least one shared band bucket)
    const candidates = new Set<string>();
    for (let band = 0; band < NUM_BANDS; band++) {
      for (const ids of bandTables[band]!.values()) {
        if (ids.length < 2) continue;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i]!;
            const b = ids[j]!;
            const lo = a < b ? a : b;
            const hi = a < b ? b : a;
            candidates.add(`${lo}\0${hi}`);
          }
        }
      }
    }

    // Verify each candidate pair against Jaccard threshold
    for (const pair of candidates) {
      const sep = pair.indexOf('\0');
      const idA = pair.slice(0, sep);
      const idB = pair.slice(sep + 1);
      if (uf.connected(idA, idB)) continue;
      if (estimateJaccard(sigs.get(idA)!, sigs.get(idB)!) >= JACCARD_THRESHOLD) {
        uf.union(idA, idB);
      }
    }

    // ── Mark duplicates (non-destructive) ─────────────────────────────────────
    let duplicateCount = 0;
    const methodCounts: Record<Exclude<ReferenceCarrier['duplicateReason'], undefined>, number> = {
      doi_exact: 0,
      normalized_hash: 0,
      canonical_work_key: 0,
      minhash_lsh: 0,
    };

    for (const memberIds of uf.groups().values()) {
      if (memberIds.length < 2) continue;

      const members = memberIds.map((id) => byId.get(id)!);

      // Primary = highest raw quality score
      const primary = members.reduce((best, c) =>
        c.scoring.rawScore > best.scoring.rawScore ? c : best,
      );
      const clusterSeed = members.map((member) => member.canonicalWorkKey ?? member.normalizedHash ?? member.id);
      const nearDupClusterId = buildNearDupClusterId(clusterSeed);

      primary.nearDupClusterId = nearDupClusterId;
      primary.duplicateGroupId = nearDupClusterId;
      primary.isDuplicateCandidate = true;

      for (const member of members) {
        if (member.id === primary.id) continue;

        member.duplicateOf = primary.id;
        member.nearDupClusterId = nearDupClusterId;
        member.duplicateGroupId = nearDupClusterId;
        const duplicateReason = duplicateReasonForPair(member, primary);
        member.duplicateReason = duplicateReason;
        member.isDuplicateCandidate = true;
        member.publicStatus = 'needs_review';
        methodCounts[duplicateReason] += 1;
        duplicateCount++;
      }
    }

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: duplicateCount > 0 ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        message:
          duplicateCount > 0
            ? `Phase 9 flagged ${duplicateCount} duplicate candidates.`
            : 'Phase 9 found no duplicates.',
        details: {
          methodCounts,
        },
      }),
    );

    return carriers;
  }
}

export const phase9Dedup = new Phase9Dedup();

function ensureDownstreamParity(carrier: ReferenceCarrier): void {
  if (carrier.ingestionMeta) return;

  if (carrier.doiFastPath) {
    carrier.ingestionMeta = {
      sourceType: 'doi_list',
      structure: 'structured',
      detectedFormat: 'doi_list',
      formatConfidence: 1,
    };
    return;
  }

  carrier.ingestionMeta = {
    sourceType: 'text',
    structure: 'unknown',
    detectedFormat: 'unknown',
    formatConfidence: Math.min(0.7, Math.max(0.2, carrier.splitMeta.confidence)),
  };
}
