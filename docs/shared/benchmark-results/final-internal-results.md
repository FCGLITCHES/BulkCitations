# Final Internal Benchmark Results

Last verified on 2026-04-13.

> **As-of caveat (noted 2026-06-25):** the numbers on this page were generated on 2026-04-11/2026-04-13 and **predate the later enrichment-verification and field-recovery work**. They reflect the `heuristic-only` and `hybrid-ml` lanes with live enrichment off, and should be treated as a historical baseline, not current performance. Figures below are left **unmodified on purpose** — re-run the harness (see `methodology.md`) for up-to-date metrics before quoting them externally.

This page summarizes the benchmark artifacts that are currently checked into the repository. It is intentionally tied to specific files and generation timestamps, not to a moving notion of “latest in memory.”

## Current Canonical Artifacts

- Full corpus, `heuristic-only`
  - `benchmarks/grobid-pmc/results/full.summary.md`
  - generated at `2026-04-13T13:17:26.214Z`
- Full corpus, `hybrid-ml`
  - `benchmarks/grobid-pmc/results/full.hybrid-ml.summary.md`
  - generated at `2026-04-13T13:20:45.178Z`
- Pilot corpus, `heuristic-only`
  - `benchmarks/grobid-pmc/results/pilot.summary.md`
  - generated at `2026-04-11T17:22:54.177Z`
- Pilot corpus, `hybrid-ml`
  - `benchmarks/grobid-pmc/results/pilot.hybrid-ml.summary.md`
  - generated at `2026-04-11T17:26:47.297Z`

## Executive Summary

- The full checked-in benchmark passes contract sanity in both `heuristic-only` and `hybrid-ml`.
- The full checked-in benchmark still carries `3` warnings in both profiles.
- The full `hybrid-ml` lane currently matches the full `heuristic-only` quality metrics and only differs materially in throughput.
- The biggest quality liabilities remain:
  - `isbn`
  - noisy-style detection
  - noisy DOI recovery
  - conference and report handling in noisy data

## Full Corpus Results

### `heuristic-only` at `2026-04-13T13:17:26.214Z`

- Clean
  - Macro Soft F1: `0.9582`
  - Instance Soft F1: `0.9293`
  - Type Accuracy: `0.9878`
  - Style Accuracy: `0.9385`
  - Style Family Accuracy: `0.9772`
  - Throughput: `48.89 refs/sec`
- Noisy
  - Macro Soft F1: `0.8371`
  - Instance Soft F1: `0.6921`
  - Type Accuracy: `0.8299`
  - Style Accuracy: `0.6516`
  - Style Family Accuracy: `0.8067`
- Contract warnings are attached to field coverage for:
  - `isbn`
  - `siteName`
  - `conferenceTitle`

### `hybrid-ml` at `2026-04-13T13:20:45.178Z`

- Clean
  - Macro Soft F1: `0.9582`
  - Instance Soft F1: `0.9293`
  - Type Accuracy: `0.9878`
  - Style Accuracy: `0.9385`
  - Style Family Accuracy: `0.9772`
  - Throughput: `42.8 refs/sec`
- Noisy
  - Macro Soft F1: `0.8371`
  - Instance Soft F1: `0.6921`
  - Type Accuracy: `0.8299`
  - Style Accuracy: `0.6516`
  - Style Family Accuracy: `0.8067`

### Full Corpus Interpretation

- The current full `hybrid-ml` lane is not yet outperforming the deterministic benchmark lane on the checked-in benchmark metrics.
- The clean corpus is strong on type and family accuracy but still underperforms on style accuracy for ambiguous pairs.
- The noisy corpus is the real stress case and remains the main improvement target.

## Pilot Corpus Results

### `heuristic-only` at `2026-04-11T17:22:54.177Z`

- Clean
  - Macro Soft F1: `0.9606`
  - Instance Soft F1: `0.9283`
  - Type Accuracy: `0.995`
  - Style Accuracy: `0.9408`
  - Style Family Accuracy: `0.98`
  - Throughput: `126.36 refs/sec`
- Noisy
  - Macro Soft F1: `0.8412`
  - Instance Soft F1: `0.6667`
  - Type Accuracy: `0.7778`
  - Style Accuracy: `0.679`
  - Style Family Accuracy: `0.784`

### `hybrid-ml` at `2026-04-11T17:26:47.297Z`

- Clean
  - Macro Soft F1: `0.9606`
  - Instance Soft F1: `0.9283`
  - Type Accuracy: `0.995`
  - Style Accuracy: `0.9408`
  - Style Family Accuracy: `0.98`
  - Throughput: `111.31 refs/sec`
- Noisy
  - Macro Soft F1: `0.8412`
  - Instance Soft F1: `0.6667`
  - Type Accuracy: `0.7778`
  - Style Accuracy: `0.679`
  - Style Family Accuracy: `0.784`

## Highest-Priority Failure Themes

- `isbn` is the weakest clean full-corpus field with Soft F1 `0.32`.
- Noisy DOI recall is still materially lower than clean DOI recall.
- Style confusion remains concentrated around:
  - `apa7` versus `harvard-ctr`
  - `mla9` versus `chicago-notes-bib`
  - `unknown` fallbacks on APA and MLA examples
- Structural type confusion still creates downstream field stripping for:
  - `conferenceTitle`
  - `bookTitle`
  - `publisher`
  - `institution`

## How To Use This Page

- Use this page for status reporting and roadmap alignment.
- Use the stamped `*.summary.md` and `*.debug.*` files for detailed investigation.
- Use `methodology.md` for reproduction instructions and benchmark profile rules.
