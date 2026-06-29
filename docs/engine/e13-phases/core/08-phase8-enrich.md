# Phase 8: Enrich

## Purpose

Resolve a reference against external bibliographic providers (Crossref, OpenAlex, with Semantic Scholar as a last resort) and fold confirmed metadata back into the carrier under a governed, trust-aware overwrite policy.

## Source

- `server/src/engine/phases/phase8Enrich.ts`
- Providers: `server/src/services/crossref.ts`, `openalex.ts`, `semanticScholar.ts`
- Supporting: `server/src/engine/overwrite-policy.ts`, `doiVerification.ts`, `server/src/engine/ingestion/ocrFold.ts` (`recoverDoi`)

## Pipeline Position

`P7 Normalize → P8 Enrich → P9 Dedup`. Eighth module of the 17-module pipeline, immediately after normalization and before deduplication. Operates on the full carrier list and mutates each `ReferenceCarrier` in place.

## Inputs

- Normalized `ReferenceCarrier[]`, each carrying `fields` (`{value, source, confidence, origin}` per key), `type`, `doiFastPath`, and the run-scoped `PipelineContext` (provider-usage counters, stage log, latency budget, `options.enrich`).

## Outputs

- `carrier.fields` updated where a provider supplied a higher-trust value (new fills and gated overwrites).
- `carrier.enrichment` summary: `status` (`enriched | partial | skipped | error`), `crossrefHit`, `openalexHit`, `semanticScholarHit`, `fieldsEnriched[]`, `fieldsOverwritten[]`.
- `carrier.doiVerification` from `verifyDoiAgainstRecord` (status `verified | conflicted | unverified | absent`), consumed later by Phase 10 health.
- Per-carrier and stage-level `StageRunRecord`s, plus provider dead-letter details on failures. `ctx.providerUsage` call counts are incremented.

## Default-Off Reality

Phase 8 does nothing unless `ctx.options.enrich` is true, and that flag is gated twice over:

- **Kill-switch (`FEATURE_LIVE_ENRICH`, default `false`).** With it off — the production default — the `/convert` route never even checks the enrichment allowance: it hard-codes a denied allowance, so `options.enrich` stays `false` and Phase 8 short-circuits with a `skipped` stage record. No live Crossref/OpenAlex/Semantic Scholar traffic, no API spend, output is byte-identical to a no-enrichment run.
- **Tier/count allowance (only when the kill-switch is on).** `checkEnrichmentAllowance` decides per request after preflight (free tier is a small lifetime reference trial; bulk is Pro-only). When allowed, the route upgrades the parse profile to `core_parse_full_enrich` (`providers: 'overlay_only'`) so only enrichment is layered onto the normal full-convert behavior. A client cannot self-select an enriching profile to bypass the gate (`sanitizeOptions` clamps it).
- **Provider cache.** When the kill-switch is on, a persistent provider cache is enabled even in `queue_first` Redis mode so repeated DOIs do not re-bill (`shouldUseRedisProviderCaches`).

Document consumers should treat enrichment as **off by default**; everything below describes behavior only when it has been explicitly enabled.

## Main Behavior

For each carrier (run under `PIPELINE_MAX_CONCURRENCY`):

1. **Skip cases.** If the stage latency budget is already exhausted, or the carrier came in via the DOI fast-path (provider metadata already attached), it is recorded `skipped` and left untouched.
2. **Lookup key.** `resolveEnrichmentLookupFields` picks the lookup fields, then `buildProviderMemoKey` keys by normalized DOI, else by a hash of normalized title (+ URL). No key (no DOI, no title) means no lookup.
3. **OCR DOI recovery (lookup-only).** If the extractor found no DOI, `recoverDoi(carrier.raw)` attempts a grammar-constrained DOI candidate from raw text. It is injected into the *lookup* fields only (as a `regex_fallback`, conf 0.5) and is **never written to output** — only a provider-*confirmed* record flows back through the normal verified-application path, so a wrong recovery simply fails to resolve rather than corrupting the result.
4. **Provider calls.** Crossref and OpenAlex are queried in parallel (memoized per key, each capped by a per-job 50-call budget); results are wrapped, failures captured as dead-letter entries. The higher-confidence record drives `verifyDoiAgainstRecord`.
5. **Last resort.** Only if neither primary provider hit and nothing changed, Semantic Scholar `lookupLastResort` is consulted.
6. **Field application** (`applyProviderRecord` → `applyEnrichmentField`): values are coerced per field key (authors/editors to canonical form, year to a 4-digit number). An empty existing field is filled; an existing value is overwritten **only** when provider `confidence ≥ 0.85` (`ENRICHMENT_OVERWRITE_THRESHOLD`) *and* strictly greater than the current confidence. A provider value that merely *equals* an untrusted existing value upgrades that field to an `authority`-origin confirmation.

## Gating & Guardrails

- **Overwrite threshold:** `ENRICHMENT_OVERWRITE_THRESHOLD = 0.85`, and the provider must beat the existing confidence. Overwrites stash `previousValue`/`previousSource`/`previousOrigin`.
- **Admin protection:** fields with `source === 'admin_confirmed'` are never overwritten; a blocked attempt is counted and surfaced as `ENRICH_OVERWRITE_BLOCKED`.
- **`shouldApplyProviderField` precedence rules:** when the citation had no original DOI, sub-0.9 provider records are held back for risky keys — DOI and publisher are not written, a `doi.org` URL is suppressed, and a conference paper's existing `conferenceTitle` is not displaced by a provider `journal`. With an original DOI present, provider fields apply freely.
- **DOI verification:** `verifyDoiAgainstRecord` cross-checks title/year/container/volume/issue/locator/authors against the record; a real DOI mismatch yields `conflicted`, thin metadata yields `unverified`. This status feeds Phase 10 warnings, not the write decision.
- **Latency budget:** the phase respects `PIPELINE_STAGE_BUDGET_MS`; exceeding it mid-flight yields `partial`/`skipped` and an `ENRICH_CROSSREF_TIMEOUT` warning rather than blocking the pipeline.

## Notable Specifics

- The 50-call budget is per provider per job, shared across carriers via the memo maps, so a batch of duplicate DOIs costs a single lookup.
- Confirmation (value-equal) paths re-stamp the field as `enrichment_<provider>` / `authority` origin and count it in `fieldsEnriched` even though the value is unchanged — this is how a provider "blesses" a heuristic guess.
- `syncFieldUncertainty` is run after application so downstream confidence bookkeeping reflects the new field sources.
- Dead-letter entries (per carrier and a capped stage-level list) record provider, lookup key, status code, and message for observability when a provider lookup fails.
