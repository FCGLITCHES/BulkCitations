# Benchmark Results

This section summarizes the internal benchmark harness and points to the checked-in benchmark artifacts under `benchmarks/grobid-pmc/`.

> The curated numbers here are a **2026-04 historical baseline** (live enrichment off) that predates the later enrichment/field-recovery work. Re-run the harness for current metrics — see `methodology.md`.

## Contents

- `final-internal-results.md`
  - Curated summary of the checked-in `heuristic-only` / `hybrid-ml` benchmark results (with an as-of caveat).
- `methodology.md`
  - Corpus structure, benchmark profiles, commands, and artifact conventions.
  - Includes the repeat-run stability contract (`min/p10 throughput`, RSS headroom, hash/gate consistency) and the sweep/stable commands.

## Live Source Files

- `benchmarks/grobid-pmc/README.md`
- `benchmarks/grobid-pmc/corpus/*`
- `benchmarks/grobid-pmc/results/*`
- `server/scripts/benchmark/*`
