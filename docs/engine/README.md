# Citation Engine

This section documents the live citation-processing pipeline (a citation **converter**, not a
generator) implemented in `server/src/pipeline/orchestrator.ts` and `server/src/engine/phases/*`.

## Contents

- [`system-assessment.md`](system-assessment.md)
  - Holistic, current read of the whole engine + ML + enrichment + infra. **Start here.**
- [`phase-index.md`](phase-index.md)
  - End-to-end map of all 17 live phases, plus the real runtime order.
- [`field-ownership-map.md`](field-ownership-map.md)
  - Which subsystem (deterministic / BIO / enrichment) owns each field, and why.
- [`phase4-refactor-seam.md`](phase4-refactor-seam.md)
  - The `DeterministicResolver` / `BioSpanProvider` seam (DOI slice live; rest types-only).
- [`noise-cleanup-enrichment-handoff.md`](noise-cleanup-enrichment-handoff.md)
  - The OCR/cleanup (P1) → enrichment (P8) handoff.
- [`public-launch-quality-system.md`](public-launch-quality-system.md)
  - Scoring (P10), health/confident-wrong flags, and the operator publish gate.
- [`engine-overview.md`](engine-overview.md)
  - Deep behavior reference (routing, scoring, render, recovery).
- `e13-phases/`
  - One page per phase or helper stage.
- [`engine_plan.md`](engine_plan.md)
  - Documentation roadmap (done-vs-pending).

## Engine Characteristics

- The pipeline is batch oriented; **17 phases** (P1–P13 plus `.8`/`.5` extension stages — see phase-index).
- Partial success is the default behavior; the count audit guarantees no silent drops.
- Shared repair, normalization, scoring, health classification, and rendering all participate in the final output contract.
- Execution shape is described by `parseProfile`, not by scattered route-local booleans.
- **Async is in-process** (`queueMicrotask` in `jobs/runtime.ts`); the old BullMQ queue was removed and Redis is now optional.
- The "intelligence" layers are gated by default: **Phase 4 ML routing** (`ML_PHASE4_MODE=heuristic`),
  **live enrichment** (`FEATURE_LIVE_ENRICH` off, + cache + budget), **LLM fallback**, and **PDF/OCR cleanup**
  (`FEATURE_PDF_CLEANUP` off for single refs) are all off in production today.
- The orchestrator supports:
  - a DOI fast path (resolves from the local Approved-Truth cache)
  - synchronous and asynchronous (in-process) execution
  - tier-aware runtime context
  - optional LLM fallback
  - optional enrichment and authority validation

## Parse Profiles

- `current_runtime`
  - compatibility profile
  - preserves the legacy option surface while the profile contract is phased in
- `core_parse_full`
  - deterministic core parser for normal product use
  - provider mutation stays off
- `core_parse_fast`
  - reserved for the batch-native fast lane and honest perf comparisons
  - now reuses the live `shared_repair` and `normalization` phases inline during batch execution instead of paying a later whole-array pass
  - benchmark-only runtime tuning now flows through the pipeline context instead of mutating global env, so hardware profiles can change batch size and concurrency without changing parser semantics
  - the benchmark `parallel` variant now runs the same parser semantics inside a benchmark-only worker-thread pool; this does not yet change the production route execution path
  - benchmark slice runs are now first-class, so pathological corpus windows can be measured and compared under the same profile contract without overwriting full-run artifacts
  - the pathological `3001-3400` window now has a named preset, `pathological_3001_3400`, so CI and recurring investigations can target the same quality-risk slice without repeating raw row bounds
  - the GROBID-comparable `3500`-row lane now also has a named preset, `grobid_3500_citation_list`, so citation-list throughput can be measured without reusing the full mixed-corpus latest artifacts
  - benchmark evaluation now emits both `field_hash` and `contract_hash`
    - `field_hash` is the normalized final-field view
    - `contract_hash` is the reliability/parity view and remains the compatibility alias behind `semantic_output_hash`
  - benchmark runs now emit richer wall-clock `runtime_metrics`, and those metrics are the authoritative throughput numbers for performance comparisons:
    - provider call count
    - stage totals
    - worker stats
    - slow chunks / slow rows
    - GC and memory snapshots
    - throughput decay
  - canonical benchmark claims now run under stable artifact namespaces and a median-of-3 wrapper:
    - `full_canonical`
    - `grobid_3500_citation_list`
  - the direct benchmark lane now applies the same hardware-profile warmup contract as the parallel lane instead of timing a cold start
  - the benchmark `parallel` lane now distributes warmup across workers instead of replaying the same warmup groups in every worker
  - Phase 3 now treats `core_parse_fast` as a deterministic style lane:
    - ML style hints are disabled by execution policy in `core_parse_fast`
    - high-confidence single-citation style detections skip ML hints even outside the fast lane, which removes avoidable latency on simple fixtures such as the Shannon regression case without changing the semantic style result
  - Phase 4 now treats `core_parse_fast` as a deterministic extraction lane as well:
    - ML extraction routing is disabled by execution policy in `core_parse_fast`
    - the fast lane stays on the heuristic extraction path even if the global Phase 4 ML mode is set to `primary` or `shadow`
    - this removes phase4 health, plan-selection, and ML-request overhead from the fast lane without changing shared extraction semantics
  - `core_parse_fast` now suppresses per-citation diagnostic stage logs and skips prebuilding extraction candidate envelopes:
    - carrier-level stage diagnostics remain available in `core_parse_full` and `debug_full`
    - top-level pipeline diagnostics still report the phase summaries needed by the API and benchmark harness
    - `shared_repair` still sees the same candidate semantics because it synthesizes the envelope on demand from the extracted carrier state
  - canonical benchmark claims should now be taken from the namespaced median artifacts rather than from ad hoc single-run latest files
  - on this 5600H laptop the full-corpus run is a sustained-load benchmark, not a quick smoke; it takes minutes and decays materially below shorter slices
  - the benchmark-only worker-thread lane remains distinct from the live orchestrator's env-gated in-process fast-lane worker path
  - runtime tuning is now first-class instead of implicit:
    - `site_default` resolves from the live environment defaults
    - `benchmark_5600h` and `server_16c` resolve from a shared runtime-profile catalog used by both the production fast lane and the benchmark harness
    - the current tuned `benchmark_5600h` parallel profile is:
      - batch size `256`
      - max concurrency `10`
      - warmup `256 refs`
  - production and benchmark worker scheduling now share the same deterministic weight-balanced assignment strategy
    - benchmark record bundles and live fast-lane batches are both assigned by the same load-balancing helper
    - worker-local inner pipeline concurrency is forced through the same single-worker runtime-tuning helper in both lanes
  - benchmark and profiling entrypoints now isolate Phase 4 runtime override state from Postgres-backed operational persistence
    - `BULKREFERENCES_ISOLATED_RUNTIME=true` is forced inside benchmark and profiling scripts
    - canonical perf runs no longer hang on an unavailable local database just to read the admin Phase 4 override row
    - DB-backed egress telemetry writes are also bypassed in that isolated runtime so current-runtime benchmark probes no longer block on operational telemetry persistence
  - phase4 now distinguishes two Springer chapter DOI ISBN cases:
    - simple modern `10.1007/978-..._<chapter>` DOIs are converted to the parent print ISBN when the Springer imprint context supports that preference
    - compound-suffix Springer chapter DOIs such as `_6-1` keep the embedded electronic ISBN instead of being decremented into the wrong print ISBN
    - legacy `10.1007/<isbn10>_chapter` DOIs fall back to a valid ISBN-13 derived from the DOI slug when the citation exposes no surface ISBN
  - proceedings-style ISBN-backed book chapters now keep their extracted `bookTitle` through routing and type classification:
    - the structural router prefers `book-chapter` over `conference-paper` when the container is already extracted as `bookTitle` and the record carries bookish evidence such as ISBN, a bookish publisher, or a `97…` DOI slug
    - Phase 6 now accepts that high-confidence `book-chapter` structural route instead of reclassifying the same record back to `conference-paper`
  - noisy placeholder-DOI books and noisy numeric conference publisher tails now have deterministic late recovery before they fall through to `unknown`:
    - relaxed DOI extraction now tolerates punctuation and Unicode noise around otherwise valid DOI slugs
    - placeholder DOI book recovery now preserves recovered author/title/publisher structure instead of collapsing the record into `unknown`
    - numeric conference tail recovery now replaces contaminated author spans with the clean recovered author list when that recovery is stronger than the initial author parse
  - the first one-pass extraction slice is now live inside Phase 4:
    - shared `CitationFeatures` now extract normalized raw text, quoted-title cues, year cues, and identifier spans for DOI, URL, PMID, arXiv, ISBN, ISSN, Handle, and patent ids
    - the heuristic extraction path consumes those shared features for its first identifier/locator scans instead of rescanning raw text inline
    - candidate-recall shadow comparison is now available in extraction metadata when diagnostics are enabled, so the new feature pass can be checked against the legacy candidate scans before later extraction logic is removed
    - `core_parse_fast` keeps the shadow path out of the hot lane when debug is off, so the new safety instrumentation does not become mandatory runtime overhead
  - the current verified feature-pass shadow benchmark slice on the Ryzen 5 5600H is:
    - `full_canonical` median-of-3 direct: `62.51 refs/sec`
    - `full_canonical` median-of-3 parallel: `274.54 refs/sec`
    - latest tuned full parallel single run: `271.44 refs/sec`
    - pathological parallel: `251.57 refs/sec`
    - `grobid_3500_citation_list` median-of-3 direct: `66.26 refs/sec`
    - `grobid_3500_citation_list` median-of-3 parallel: `265.88 refs/sec`
    - latest tuned pilot parallel single run: `315.06 refs/sec`
    - direct and parallel still match on both `field_hash` and `contract_hash`
  - these benchmark numbers are engine/benchmark-lane numbers, not the full
    pasted-site request path:
    - the public convert payload currently omits `parseProfile`, so the route
      default is `core_parse_full`
    - the benchmark commands explicitly select `core_parse_fast` and
      `benchmark_5600h`
    - pasted batches over the sync threshold use async job enqueueing, polling,
      job persistence, response serialization/hydration, and browser rendering
      in addition to parser execution
    - use `pnpm diagnostics:admin-throughput-gap -- --input <refs-file> --url <convert-url>`
      when comparing an exact pasted/admin batch with the benchmark lane
- `pro_overlay_enrich`
  - overlay/provider lane only
- `debug_full`
  - diagnostics-first profile

The current implementation slice centralizes these profiles in a shared execution-policy resolver. The resolver is now the source of truth for provider access, LLM fallback, debug mode, and the declared render/dedup/health modes that later milestones will enforce more deeply.

The fast-lane refactor must continue to preserve the single semantic engine rule:

- `core_parse_fast` may change execution shape
- `core_parse_fast` may not change shared-repair or normalization semantics
- batch execution must keep using the same phase modules that `core_parse_full` uses
- benchmark hardware profiles may change `batchSize` and `maxConcurrency`, but they may not change field semantics, abstain behavior, or repair/normalization outcomes

## Subsystems at a glance

- **Extraction (P4):** one ~25k-line heuristic monolith (`phase4Extract.ts`), being migrated incrementally
  behind the typed seam in `phase4/extractionContract.ts` (DOI slice live). Deterministic owns identifiers
  + locators; BIO (when promoted) owns author/title/journal spans.
- **Enrichment (P8):** Crossref/OpenAlex lookup, behind `FEATURE_LIVE_ENRICH`, with a provider cache and a
  per-request call budget; overwrites only at confidence ≥ 0.85 and never `admin_confirmed` (`canOverwrite`).
- **Scoring + health (P10):** `phase10Health.ts` — three-component score (field/format/structural) with the
  9-style guaranteed weights, plus the confident-wrong review flags.
- **Render (P12):** 9 first-class CSL renderers (APA, MLA, Chicago-AD, Vancouver, IEEE, Harvard-CTR,
  Chicago-notes-bib, AMA, ACS) + an APA fallback only for genuinely unknown styles.
- **Deploy:** backend on **Render**, frontend on **Vercel** (see `docs/SETUP-RUNBOOK.md`).

## Core Source Files

- `server/src/pipeline/orchestrator.ts`
- `server/src/pipeline/executionPolicy.ts`
- `server/src/pipeline/coreBatch.ts` / `fastLane.ts`
- `server/src/engine/phases/*.ts`
- `server/src/engine/types/*.ts`
- `server/src/engine/utils/*.ts`

## Related Documentation

- `../api/`
- `../shared/benchmark-results/`
- `../ml-system/`
