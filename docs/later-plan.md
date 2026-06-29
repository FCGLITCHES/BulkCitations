# Documentation Plan Hub

Last reviewed: 2026-06-25

> **Status (2026-06-25):** documentation structure below is in place and the domain plan links resolve. Several roadmap items have since landed in code: enrichment is enabled behind `FEATURE_LIVE_ENRICH`, the vestigial BullMQ queue layer was removed in favor of an in-process `queueMicrotask` async path, and the runtime engine is now a 17-phase pipeline under `server/src/engine/phases/`. The remaining cross-domain work below is still a roadmap. See `engine/system-assessment.md` for live status.

## Contents

- [Implemented Baseline](#implemented-baseline)
- [Domain Plan Index](#domain-plan-index)
- [Cross-Domain Future Work](#cross-domain-future-work)

## Implemented Baseline

- Documentation structure is now domain-first (`api`, `engine`, `frontend`, `governance`, `ml-system`, `operations`, `shared`).
- Engine phase docs are split into:
  - `engine/e13-phases/core`
  - `engine/e13-phases/extensions`
- ADRs were moved under `shared/decisions`.
- Model cards were moved under `ml-system/model-cards`.
- `docs/test-results` retention was enforced to first + latest per group.
- Legacy plan files were removed and replaced by domain plans.

## Domain Plan Index

- API: [api/api_plan.md](./api/api_plan.md)
- Engine: [engine/engine_plan.md](./engine/engine_plan.md)
- Frontend: [frontend/frontend_plan.md](./frontend/frontend_plan.md)
- Governance: [governance/governance_plan.md](./governance/governance_plan.md)
- ML System: [ml-system/ml_system_plan.md](./ml-system/ml_system_plan.md)
- Operations: [operations/operations_plan.md](./operations/operations_plan.md)
- Shared: [shared/shared_plan.md](./shared/shared_plan.md)

## Cross-Domain Future Work

- Keep every domain plan updated with:
  - a file-by-file implemented status
  - a file-by-file future segment
- Continue the batch-native parser program in order:
  - enforce `parseProfile` across the remaining route and benchmark surfaces
  - keep the new benchmark hardware-profile, canonical artifact namespace, and median-of-3 runner wiring aligned with the real parser architecture
  - keep the new `field_hash` / `contract_hash` benchmark contract stable while the `pathological_3001_3400` and `grobid_3500_citation_list` presets are used to drive permanent perf and quality regressions
  - keep the new Springer DOI ISBN regressions stable:
    - modern Springer chapter DOIs must keep emitting the parent print ISBN
    - compound-suffix Springer chapter DOIs such as `_6-1` must keep the embedded electronic ISBN unless later metadata proves a different parent ISBN
    - legacy Springer ISBN-10 chapter DOIs must keep emitting a valid non-empty ISBN fallback instead of dropping the field
    - the pathological slice ISBN coverage now clears the `0.9` floor, and proceedings-style ISBN-backed chapters now keep `bookTitle` through routing and type classification instead of being stripped after a false `conference-paper` classification
  - keep the new noisy-tail extraction regressions stable:
    - placeholder DOI books with truncated `https://doi.org/` tails must not fall back to `unknown` when title/publisher evidence is still recoverable
    - numeric conference publisher tails with DOI noise must keep the clean recovered author list instead of preserving contaminated author spans from the first parse
  - keep the deterministic Phase 3 fast-lane behavior stable:
    - `core_parse_fast` must not spend budget on ML style hints
    - strong single-citation deterministic style detections must keep skipping ML hints unless a later quality gate proves that the hint materially improves output
  - keep the deterministic Phase 4 fast-lane behavior stable:
    - `core_parse_fast` must not spend budget on Phase 4 ML routing or extraction calls
    - the fast lane must stay heuristic-only for extraction even if global Phase 4 ML rollout settings are changed for other profiles
    - the fast lane must keep carrier-level diagnostics minimal:
      - no per-citation stage-log accumulation in `core_parse_fast`
      - no eager phase4 candidate-envelope construction before `shared_repair`
      - top-level phase summaries remain the supported diagnostics surface for perf and route observability
  - keep the benchmark contract lock delivered in this slice:
      - canonical latest artifacts must live under explicit namespaces instead of ad hoc latest paths
      - canonical performance claims must come from the median-of-3 runner
      - `field_hash` and `contract_hash` must stay stable across direct/parallel parity work
      - provider call count must stay `0` in `core_parse_fast`
      - perf comparisons must use the richer `runtime_metrics` sidecar instead of partition-only throughput
      - the tuned `benchmark_5600h` parallel profile is now `chunkSize 256`, `maxConcurrency 10`, `warmupRefs 256`
      - exploratory benchmark tuning now has explicit CLI overrides for chunk size, worker count, warmup refs, and multicore threshold
      - the next real speed work remains extraction CPU cost and tuning the existing env-gated `core_parse_fast` worker path without weakening quality
  - keep the benchmark accounting contract stable:
      - direct runs must warm before timing
      - parallel runs must distribute warmup per worker
      - perf reporting must use wall-clock `runtime_metrics`, not summed per-citation durations
  - keep the benchmark-only worker-thread `parallel` lane as the outer throughput harness, and use it to tune the existing env-gated production `core_parse_fast` worker path once parity, recovery, and quality gates stay green
  - keep the new shared runtime-profile and worker-scheduling layer stable:
      - `site_default`, `benchmark_5600h`, and `server_16c` must keep resolving through the same runtime-profile catalog
      - production fast-lane workers and benchmark parallel workers must keep using the same deterministic weight-balanced assignment helper
      - worker-local inner concurrency must keep going through the same single-worker runtime-tuning helper
  - keep the first shared-feature extraction slice stable:
      - `CitationFeatures` now own the first-pass DOI, URL, PMID, arXiv, ISBN, ISSN, Handle, patent, year, and quoted-title scans used by the Phase 4 heuristic extractor
      - candidate-recall shadow comparison must remain available in diagnostics until later extraction layers move fully onto the shared feature pass
      - direct and parallel benchmark runs must keep matching on both `field_hash` and `contract_hash` as later extraction work moves from shadow mode into candidate generation and resolution
      - the next extraction milestone is to move candidate generation onto the shared feature object without reintroducing raw-text rescans in late helpers
  - keep the resolved benchmark validation surface stable:
      - the full mixed-corpus and pathological direct/parallel `feature_shadow_smoke` runs now complete and gate cleanly
      - do not reintroduce benchmark-path assumptions; use the actual full run/evaluate/gate commands as the source of truth for future scheduler or extraction changes
  - move the remaining late-product phases behind profile enforcement after the fast lane inlined `shared_repair` and `normalization`
  - then refactor extraction around shared feature passes
  - use the remaining full-corpus quality warnings on `isbn` coverage, `siteName` coverage, and normalized citation exact-match rate as the first protected quality targets before any extraction-speed rewrite ships
- Add a periodic docs integrity check to CI:
  - missing links
  - orphan markdown files
  - stale path references after refactors
- Keep benchmark and security artifact retention policy automated so old outputs do not accumulate.
- Add explicit owners for each domain plan to reduce drift between implementation and documentation.
