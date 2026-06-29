# Benchmark Methodology

Last verified on 2026-04-22.

> **As-of note (2026-06-25):** The grobid-pmc method below is still accurate and the documented `pnpm benchmark:*` commands all still resolve (corpus root is still `benchmarks/grobid-pmc/`, see `server/src/benchmark/paths.ts`; CLI entrypoints under `server/scripts/benchmark/`). Since this was last verified, a second, complementary measurement lane was added that this page does not yet cover — see "Real-input recovery lane (added since 2026-04-22)" at the end of this file. Numbers and gates in the grobid-pmc sections predate that lane and predate the enrichment / field-recovery work.

## Benchmark Workspace

The benchmark harness lives under `benchmarks/grobid-pmc/` and is separate from:

- approved-truth training governance
- targeted regression fixtures under `server/src/regression`

## Corpus Modes

- `pilot`
  - smaller checked-in corpus for fast iteration
- `full`
  - larger checked-in corpus for broader signal and final internal reporting

## Benchmark Profiles

- `heuristic-only`
  - CI-facing deterministic lane
  - ML helper stages and nondeterministic enrichers are kept off
- `hybrid-ml`
  - local production-like lane that allows the local `ml-service`
  - tracked separately and non-blocking
- `current-runtime`
  - diagnostic profile only
- `current-runtime-stable350`
  - same semantic engine as `current-runtime`
  - stability-first runtime envelope for sustained full parallel runs (reduced memory pressure and lower throughput variance)

## Runtime Contract Flags

The benchmark runner now accepts explicit runtime-contract flags instead of assuming grouped text input on the legacy profile:

- `--parseProfile=<current_runtime|core_parse_full|core_parse_fast|pro_overlay_enrich|debug_full>`
- `--sourceType=<text|doi_list>`
- `--hardwareProfile=<default|dev_default|benchmark_5600h|server_16c>`
- `--benchmarkVariant=<grobid_compare|parallel|diagnostic>`
- `--artifactDetail=<full|summary>`
- `--artifactNamespace=<stable_label>`
- `--slicePreset=<grobid_3500_citation_list|pathological_3001_3400>`
- `--sliceStart=<1-based row>`
- `--sliceEnd=<1-based row>`
- `--chunkSize=<positive integer>`
- `--maxConcurrency=<positive integer>`
- `--warmupRefs=<positive integer>`
- `--multicoreThreshold=<positive integer>`

Series-runner stability flags:

- `--iterations=<positive integer>`
- `--minThroughput=<positive number>`
- `--minP10Throughput=<positive number>`
- `--maxRssGiB=<positive number>`
- `--continueOnGateFailure=<true|false>`
- `--requireFieldHashStable=<true|false>`
- `--requireContractHashStable=<true|false>`
- `--requireGatePassAll=<true|false>`

Current defaults remain conservative:

- `parseProfile`: `current_runtime`
- `sourceType`: `text`
- `hardwareProfile`: `default`
- `benchmarkVariant`: `grobid_compare`

This is the first step toward honest GROBID-comparable runs. Performance work should use explicit `--parseProfile=core_parse_fast` rather than relying on the default benchmark lane.

Current fast-lane behavior:

- `core_parse_fast` now runs `shared_repair` and `normalization` inline in the batch lane
- this is an execution-shape change only; those phases still use the same semantic modules as `core_parse_full`
- benchmark comparisons should treat that lane as the same parser semantics with different orchestration, not as a second parser

Current hardware-profile behavior:

- `dev_default`
  - batch size `96`
  - max concurrency `3`
- `benchmark_5600h`
  - `grobid_compare`
    - batch size `192`
    - max concurrency `7`
    - warmup `192 refs`
  - `parallel`
    - batch size `256`
    - max concurrency `11`
    - warmup `256 refs`
- `server_16c`
  - batch size `160`
  - max concurrency `15`
  - warmup metadata `320 refs`

These hardware profiles currently do two different things depending on the benchmark variant:

- `grobid_compare`
  - tunes the existing in-process batch orchestrator
- `parallel`
  - starts a benchmark-only `worker_threads` pool
  - uses the hardware profile `maxConcurrency` as worker count
  - forces each worker's inner pipeline concurrency to `1` so the worker pool is the only multicore scheduler being measured

This means the `parallel` benchmark variant now measures real worker-thread execution for the existing parser semantics. The live orchestrator already has an env-gated in-process `core_parse_fast` worker path for large batches; the benchmark `parallel` variant is separate outer benchmark infrastructure used to measure higher-throughput worker scheduling against the same parser semantics.

The new explicit runtime-override flags are for exploratory tuning only:

- `--chunkSize`
- `--maxConcurrency`
- `--warmupRefs`
- `--multicoreThreshold`

They override the selected hardware profile for that run without changing parser semantics. Canonical claims should still come from the checked-in hardware profile plus namespaced median-of-3 runs.

Runtime-profile parity now goes through shared code instead of duplicated literals:

- `site_default`
  - resolves from the live environment defaults used by `createPipelineContext`
- `benchmark_5600h`
  - resolves from the same runtime-profile catalog used by the production fast lane
- `server_16c`
  - resolves from the same runtime-profile catalog used by the production fast lane

Worker scheduling parity now also goes through shared code:

- the benchmark parallel runner and the live `core_parse_fast` worker lane both use the same deterministic weight-balanced assignment helper
- benchmark workers and production fast-lane workers both force their inner pipeline runtime tuning through the same single-worker helper, so nested worker behavior no longer drifts silently between the two paths
- benchmark and profiling entrypoints now force `BULKREFERENCES_ISOLATED_RUNTIME=true`
  - Phase 4 override state stays in transient process memory during benchmark and profiling runs
  - DB-backed egress telemetry writes are bypassed during benchmark and profiling runs
  - canonical performance runs no longer depend on a reachable local Postgres instance just to read admin runtime override state

The benchmark runner now writes a `*.runtime_metrics.json` sidecar for every run. These metrics are the authoritative throughput numbers for perf comparisons:

- wall-clock timing is measured after hardware-profile warmup
- direct runs warm the in-process parser before timing starts
- parallel runs distribute warmup across workers and then measure worker wall clock, not summed per-citation durations
- evaluation summaries now surface `runtime_metrics.throughput_refs_per_sec` ahead of the legacy partition throughput field
- the sidecar now also records:
  - `cpu_user_ms`
  - `cpu_system_ms`
  - `provider_call_count`
  - `stage_totals_ms`
  - `worker_stats`
  - `slow_chunks`
  - `slow_rows`
  - `gc_stats`
  - `memory_stats`
  - `throughput_decay`

The first shared-feature extraction slice is now benchmark-validated under the namespaced `feature_shadow_smoke` run set:

- shared `CitationFeatures` now own the first-pass identifier and locator scans used by the Phase 4 heuristic extractor
- candidate-recall shadow comparison is captured only when diagnostics are enabled, so canonical `core_parse_fast` runs keep that guardrail out of the hot path
- verified 2026-04-22 results on `benchmark_5600h`:
  - `full_canonical` median-of-3 direct: `62.51 refs/sec`
  - `full_canonical` median-of-3 parallel: `274.54 refs/sec`
  - latest tuned full parallel single run: `271.44 refs/sec`
  - pathological parallel: `251.57 refs/sec`
  - `grobid_3500_citation_list` median-of-3 direct: `66.26 refs/sec`
  - `grobid_3500_citation_list` median-of-3 parallel: `265.88 refs/sec`
  - latest tuned pilot parallel single run: `315.06 refs/sec`
  - direct and parallel matched on both `field_hash` and `contract_hash` for the pathological and full mixed-corpus runs
  - the `grobid_3500_citation_list` median-of-3 direct and parallel series also kept both hashes stable across all three iterations
- the current non-blocking warnings on that slice remain:
  - `isbn` coverage `0.9244` on the full mixed corpus
  - `siteName` coverage `0.9457`
  - clean normalized citation exact-match rate below floor

Benchmark evaluation artifacts now carry both hash views:

- `field_hash`
  - normalized final field values only
- `contract_hash`
  - final fields plus type/style/outcome/reliability state
- `semantic_output_hash`
  - compatibility alias for the contract hash

Canonical performance claims must now come from namespaced median-of-3 runs, not from ad hoc latest files.

The important caveat on the Ryzen 5 5600H laptop is sustained-run decay:

- shorter pilot and pathological slices run materially faster than the full corpus
- the full-corpus benchmark is expected to take several minutes on this machine
- long silent periods during the full run are not, by themselves, evidence of a hang; use the stamped `runtime_metrics` sidecar and final semantic hash as the authoritative completion signal
- cross-machine comparisons should use the full-corpus `runtime_metrics` sidecar, not the shorter pilot or pathological windows

Artifact names are now namespaced when non-default benchmark variants, hardware profiles, or explicit artifact namespaces are supplied. This prevents quick, pathological, canonical, and GROBID-comparable runs from overwriting one another.

Slice-scoped runs are also namespaced. A pathological run like rows `3001-3400` writes to its own artifact prefix instead of overwriting the full-corpus latest files.

The benchmark now has two first-class named slice presets:

- `grobid_3500_citation_list`
  - resolves to rows `1-3500`
  - intended for GROBID-comparable citation-list runs
- `pathological_3001_3400`
  - resolves to rows `3001-3400`
  - intended for blocking regression coverage on the known hard window

Both presets write to their own artifact prefixes and record `slice_preset` in evaluation and debug metadata.

Use presets for CI and recurring diagnostics. Keep raw `--sliceStart/--sliceEnd` for ad hoc investigations.

Canonical benchmark namespaces currently used by the repo:

- `full_canonical`
  - full mixed corpus, release-facing product-core throughput
- `grobid_3500_citation_list`
  - first `3500` raw reference rows, GROBID-comparable throughput

The repository now exposes a median-of-3 runner for those canonical namespaces:

- `pnpm benchmark:canonical:direct`
- `pnpm benchmark:canonical:parallel`
- `pnpm benchmark:grobid3500:direct`
- `pnpm benchmark:grobid3500:parallel`
- `pnpm benchmark:sweep:parallel`
- `pnpm benchmark:stable350:parallel`

## Standard Commands

From the repository root:

- `pnpm benchmark:generate -- --mode=pilot --phase=harvest`
- `pnpm benchmark:generate -- --mode=pilot --phase=build`
- `pnpm benchmark:run -- --mode=pilot --profile=heuristic-only`
- `pnpm benchmark:evaluate -- --mode=pilot --profile=heuristic-only`
- `pnpm benchmark:gate -- --mode=pilot --profile=heuristic-only`
- `pnpm benchmark:baseline -- --mode=pilot --profile=heuristic-only --stamp=YYYY-MM-DD`
- `pnpm benchmark:run -- --mode=pilot --profile=current-runtime --parseProfile=core_parse_fast --sourceType=text --hardwareProfile=benchmark_5600h --benchmarkVariant=grobid_compare`
- `pnpm benchmark:evaluate -- --mode=pilot --profile=current-runtime --parseProfile=core_parse_fast --sourceType=text --hardwareProfile=benchmark_5600h --benchmarkVariant=grobid_compare`
- `pnpm benchmark:gate -- --mode=pilot --profile=current-runtime --hardwareProfile=benchmark_5600h --benchmarkVariant=grobid_compare`
- `pnpm benchmark:canonical:direct`
- `pnpm benchmark:canonical:parallel`
- `pnpm benchmark:grobid3500:direct`
- `pnpm benchmark:grobid3500:parallel`
- `pnpm benchmark:sweep:parallel`
- `pnpm benchmark:stable350:parallel`
- `pnpm benchmark:run -- --mode=full --profile=current-runtime --parseProfile=core_parse_fast --sourceType=text --hardwareProfile=benchmark_5600h --benchmarkVariant=diagnostic --sliceStart=3001 --sliceEnd=3400`
- `pnpm benchmark:evaluate -- --mode=full --profile=current-runtime --parseProfile=core_parse_fast --sourceType=text --hardwareProfile=benchmark_5600h --benchmarkVariant=diagnostic --sliceStart=3001 --sliceEnd=3400`
- `pnpm benchmark:pathological:run`
- `pnpm benchmark:pathological:evaluate`
- `pnpm benchmark:pathological:gate`
- `pnpm benchmark:pathological:parallel:run`
- `pnpm benchmark:pathological:parallel:evaluate`
- `pnpm benchmark:pathological:parallel:gate`

Replace `pilot` with `full` for the full corpus.

## Output Artifacts

Each evaluation produces:

- `*.latest.json`
  - compact machine-readable metrics
- `*.summary.md`
  - compact human summary
- `*.debug.json`
  - detailed diagnostic breakdown
- `*.debug.md`
  - short debug report for human investigation
- stamped `run`, `summary`, and `debug` snapshots
- evaluation metadata now carries:
  - `artifact_detail`
  - `artifact_namespace`
  - `slice_preset`
  - `semantic_output_hash`
  - `field_hash`
  - `contract_hash`
  - `slice_start`
  - `slice_end`
  - `slice_row_count`
  - `runtime_metrics`
- run-series additionally produces:
  - stamped `*.series_<timestamp>.json` files with `min/p10/median/max` throughput, max RSS, gate pass counts, and hash consistency

## Stability Target Contract

For local sustained `benchmark_5600h` full parallel validation, the stable target now uses repeat-run evidence instead of single-run peak evidence:

- default repeat window: `5` consecutive runs
- hash invariants:
  - identical `field_hash` across all runs
  - identical `contract_hash` across all runs
- throughput target:
  - `min refs/sec >= 350` (strict), or `p10 refs/sec >= 350` for exploratory tuning
- memory headroom target:
  - engineering target `RSS <= 2.75 GiB`
  - hard runtime guardrail still fails at `RSS > 3.0 GiB`
- gate expectation:
  - quality/runtime gate must pass for every run in the acceptance window

Use `pnpm benchmark:stable350:parallel` for the strict contract and `pnpm benchmark:sweep:parallel` to search worker/chunk combinations by worst-run throughput and max RSS, not best-run peak.

## Governance Rules

- CI must use checked-in corpus artifacts only.
- Any benchmark-driven engine fix still requires permanent regression coverage in the engine regression system.
- The benchmark folder is for broad quality measurement, not for replacing targeted regressions.

## Real-input recovery lane (added since 2026-04-22)

This section documents method that postdates the grobid-pmc content above. It is additive: the grobid-pmc lane still works as described.

The grobid-pmc corpus only emits clean `csl_rendered` strings, so it does not exercise the engine's real moat: recovering fields from *messy paste* (PDF copy-paste, OCR text, numbered-list paste). A separate real-input lane was added to measure recall under that degradation.

- Gold corpus: `datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl` (real references; `expected_fields` are the gold values).
- Input-degradation transforms live in `server/src/benchmark/realInputModes.ts`. Each is deterministic (sha256-seeded) and degrades only the *input string* — gold stays identical, so each measures recall under a specific real failure mode:
  - `pasted_pdf_copy` — hard line breaks at column-ish boundaries with some words hyphenated across the break (engine must reflow + de-hyphenate).
  - `ocr_like` — plausible single-character OCR substitutions on a fraction of characters.
  - `multiline_numbered` — numbered/bracketed list-item paste with light line wrapping (exercises enumerator stripping + reflow).
- Corpus generation: `server/scripts/benchmark/generate-real-input-corpus.ts`.
- Scorers / evaluation are run via the `server/scripts/eval-*.mts` harness scripts directly (e.g. `tsx server/scripts/eval-real-input.mts`), not via the `pnpm benchmark:*` aliases:
  - `eval-real-input.mts` reports two scorers side by side — STRICT (ASCII substring; honest floor but auto-fails non-Latin script and penalizes faithful-but-noisy extraction) and FAIR (Unicode/diacritic-insensitive, author family+initial aware, fuzzy ≥0.88 on long text fields). FAIR reflects the product design where the engine extracts faithfully and enrichment later resolves noise to canonical metadata.
  - `eval-real-input-diag.mts`, `eval-field-fails.mts`, `eval-enrichment.mts`, `eval-ocr-correct.mts`, `eval-isbn-probe.mts`, `eval-decompose.mts` are companion diagnostic probes over the same/related data.
- These scripts force `BULKREFERENCES_ISOLATED_RUNTIME=true` (same isolation contract as the canonical benchmark runs) and are read-only / safe to delete.

This lane is the source of the recent enrichment and field-recovery measurements; treat its numbers as separate from the grobid-pmc product-core throughput/quality numbers above.
