# Phase 9: Dedup

## Purpose

Cluster references that describe the same work — by exact identity (normalized hash, DOI, canonical work key) and by near-duplicate text similarity (MinHash + LSH) — and label the clusters non-destructively for grouped output and review.

## Source

- `server/src/engine/phases/phase9Dedup.ts`
- Keys/hashes: `server/src/engine/ingestion/canonical.ts` (`buildNormalizedHash`, `buildCanonicalWorkKey`, `buildNearDupClusterId`, `normalizeDoiForKey`)

## Pipeline Position

`P8 Enrich → P9 Dedup → P10 Health`. Ninth module of the 17-module pipeline. Runs over the whole carrier batch at once (cross-reference clustering), after enrichment has had a chance to normalize identifiers.

## Inputs

- The full normalized/enriched `ReferenceCarrier[]`, each with `fields`, `raw`, `scoring.rawScore`, `splitMeta`, and (for parity backfill) `doiFastPath`/`ingestionMeta`. Gated by `ctx.options.dedup`.

## Outputs

Cluster metadata written onto carriers (no records removed):

- On every cluster member: `nearDupClusterId`, `duplicateGroupId`, `isDuplicateCandidate = true`.
- On non-primary members: `duplicateOf` (primary id), `duplicateReason`, and `publicStatus = 'needs_review'`.
- Also sets `carrier.normalizedHash` and `carrier.canonicalWorkKey` for every carrier, and backfills `ingestionMeta` via `ensureDownstreamParity` when missing.
- Stage `StageRunRecord` with per-method `methodCounts` (`doi_exact`, `normalized_hash`, `canonical_work_key`, `minhash_lsh`).

## Main Behavior

Clustering is built with a Union-Find (path compression + union by rank) over four successive passes; any pass can merge two carriers, and the transitive closure forms the final clusters:

1. **Pass 1 — normalized hash.** `buildNormalizedHash(raw)` buckets; identical raw-text hashes union.
2. **Pass 2 — DOI exact.** Carriers sharing a `normalizeDoiForKey` DOI union.
3. **Pass 3 — canonical work key.** `buildCanonicalWorkKey({doi, url, title, year, firstAuthorFamily})` buckets and unions — catches same-work records with differing punctuation/whitespace but no shared DOI.
4. **Pass 4 — MinHash + LSH (near-duplicate).** Dedup text (`"title firstAuthorFamily"`, lowercased and stripped to `[a-z0-9 ]`) is shingled (k=3 char shingles, inline FNV-1a), reduced to a 128-permutation MinHash signature, and indexed into 16 LSH bands of 8 rows. Carriers sharing any band bucket become candidate pairs; each unconnected candidate is confirmed only if its estimated Jaccard `≥ 0.85`, then unioned.

For each resulting cluster of ≥2 members: the **primary** is the member with the highest `scoring.rawScore`; a stable `nearDupClusterId` is derived from the members' canonical/normalized keys. Non-primaries are pointed at the primary, tagged with a `duplicateReason` (resolved per pair: `doi_exact` > `normalized_hash` > `canonical_work_key` > `minhash_lsh`), marked duplicate candidates, and demoted to `needs_review`.

## Gating & Parameters

- **Skip:** disabled entirely when `ctx.options.dedup` is false (records `skipped`). In `core_parse_fast` the execution policy sets `dedupMode: 'exact_canonical'`; `core_parse_full` uses `full_local` (all four passes including MinHash/LSH).
- **MinHash/LSH constants:** `NUM_PERMS = 128`, `NUM_BANDS = 16`, `ROWS_PER_BAND = 8`, `SHINGLE_K = 3`, `JACCARD_THRESHOLD = 0.85`. Permutations are deterministic (precomputed seeds + MurmurHash3 finalizer), so clustering is reproducible.
- Carriers whose dedup text is shorter than the shingle size, or that produce no shingles, are excluded from the MinHash pass (they can still cluster via passes 1–3).

## Notable Specifics

- **Non-destructive by contract:** the phase only groups and labels; it never deletes a carrier. Downstream rendering/export decides how to present duplicate groups.
- **Primary selection by quality, not order:** the highest-scoring member becomes the canonical representative, so the surviving record is the best-extracted one regardless of input position.
- **Status side-effect:** flagging a duplicate sets the member's `publicStatus` to `needs_review` here, before Phase 10 runs its own health classification.
- `ensureDownstreamParity` guarantees every carrier has `ingestionMeta` (DOI-list vs. text-derived) so later count-parity and reporting stages have complete metadata even for fast-path inputs.
