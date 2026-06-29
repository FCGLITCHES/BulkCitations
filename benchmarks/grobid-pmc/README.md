# Grobid-Style Citation Benchmark

This workspace contains the checked-in benchmark harness for the Node citation engine.

It is separate from:

- `approved_truth` and training exports
- the targeted regression fixtures under `server/src/regression`

## Layout

- `corpus/`
  - `pilot.manifest.json`
  - `pilot.formatted_strings.txt`
  - `pilot.noise_log.json`
  - `full.manifest.json`
  - `full.formatted_strings.txt`
  - `full.noise_log.json`
  - `raw_sources/`
- `styles/`
  - vendored CSL styles and `locales-en-US.xml`
- `manifest.schema.json`
  - checked-in contract for benchmark manifest rows
- `results/`
  - `pilot.baseline_YYYY-MM-DD.json`
  - `pilot.latest.json`
  - `pilot.summary.md`
  - `pilot.debug.json`
  - `pilot.debug.md`
  - `pilot.hybrid-ml.latest.json`
  - `pilot.hybrid-ml.summary.md`
  - `pilot.hybrid-ml.debug.json`
  - `pilot.hybrid-ml.debug.md`
  - `local/`
    - default destination for local benchmark run/evaluate/style-winloss artifacts

## Commands

From the repo root:

- `pnpm benchmark:generate -- --mode=pilot --phase=harvest`
- `pnpm benchmark:generate -- --mode=pilot --phase=build`
- `pnpm benchmark:run -- --mode=pilot --profile=heuristic-only`
- `pnpm benchmark:evaluate -- --mode=pilot --profile=heuristic-only`
- `pnpm benchmark:gate -- --mode=pilot --profile=heuristic-only`
- `pnpm benchmark:baseline -- --mode=pilot --profile=heuristic-only --stamp=YYYY-MM-DD`
- `pnpm benchmark:run -- --mode=pilot --profile=hybrid-ml`
- `pnpm benchmark:evaluate -- --mode=pilot --profile=hybrid-ml`

`full` mode uses the same commands with `--mode=full`.

`heuristic-only` is the default benchmark profile and the only profile used in CI. It forces:

- phase 4 extraction to heuristics
- ML-assisted helper stages off
- enrichment/provider lookups off
- authority validation off

`current-runtime` remains available only for diagnostics.

`hybrid-ml` is the production-like benchmark lane for local ML-assisted style and extraction behavior. It keeps benchmark-only nondeterministic enrichers disabled, but allows the local `ml-service` and runtime ML path to participate. It is tracked separately from `heuristic-only` and is non-blocking until the ML readiness thresholds are met.

`benchmark:evaluate` now writes:

- `*.latest.json`: compact metrics for gating
- `*.summary.md`: compact human summary
- `*.debug.json`: diagnostic breakdowns for improvement work
- `*.debug.md`: short debug report with weakest fields/cells and mismatch clusters
- `*.run_<timestamp>.json`: stamped result snapshot for that specific run
- `*.summary_<timestamp>.md`: stamped markdown summary for that specific run
- `*.debug_<timestamp>.json`: stamped debug snapshot for that specific run
- `*.debug_<timestamp>.md`: stamped debug markdown for that specific run

Outside CI, benchmark scripts now write live artifacts into `results/local/` by default so local validation does not dirty the checked-in benchmark snapshots. Use `BENCHMARK_RESULTS_DESTINATION=checked-in` when you intentionally want to refresh the checked-in `latest/summary/debug` files.

Evaluation results include:

- `scoring_spec_version`
- `profile`
- `contract_sanity`
- exact `style_accuracy`
- `style_family_accuracy`
- adversarial pair accuracy for:
  - `apa7` vs `harvard-ctr`
  - `mla9` vs `chicago-notes-bib`
  - `vancouver` vs `ieee`
- `input_structure` / `input_source_kind` coverage in debug output

`benchmark:gate` can also read:

- `--results=<path>`
- `--baseline=<path>`

If `--baseline` is omitted, the script uses the newest checked-in dated baseline for that mode when one exists.
Baselines are profile-aware, so `pilot.baseline_...json` and `pilot.hybrid-ml.baseline_...json` are separate histories.

## Current State

- The benchmark harness is implemented and runnable.
- `pilot` and `full` corpora are generated from checked-in artifacts.
- `pilot` and `full` both run in the deterministic `heuristic-only` profile.
- `hybrid-ml` is supported as a separate tracked profile for local ML-assisted runs.
- The current engine does **not** meet the Grobid-style thresholds on the pilot corpus.
- Patent and webpage coverage is supplemented by checked-in raw-source seed sets from:
  - Google Patents sitemap pages
  - RFC Editor index entries
- Full-mode generation now satisfies the hard per-type minimums, even though some types can still land below the ideal balanced target and emit warnings.

## Refresh Rules

- Live harvesting is manual/offline only and never part of CI.
- CI must use the checked-in corpus artifacts only.
- Any benchmark-driven engine fix must still add a permanent regression case under the existing regression system.

## Checked-In Raw Sources

`raw_sources/` includes:

- harvested API payloads for Crossref, Open Library, and arXiv
- `manual.seed.json` for curated edge cases
- `google-patents.seed.json` for real patent references
- `rfc-editor.webpage.seed.json` for real webpage references
