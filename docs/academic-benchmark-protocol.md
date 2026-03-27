# Academic Benchmark Protocol

This package is the internal, repeatable benchmark for validating citation-conversion quality with real references.

## What it contains

- `scripts/data/academic-benchmark-corpus-1000.json`
  Frozen corpus of 1,000 real citations sourced from Crossref.
- `scripts/generateAcademicBenchmarkCorpus.ts`
  Rebuilds the frozen corpus.
- `scripts/runAcademicBenchmark.ts`
  Runs the benchmark against the local v2 engine and writes the report.
- `output/academic-benchmark-1000-report.md`
  Business-facing benchmark summary.
- `output/academic-benchmark-1000-report.json`
  Machine-readable evidence bundle.

## Source mix

- 550 journal articles
- 150 conference papers
- 100 books
- 100 book chapters
- 50 reports
- 50 theses/dissertations

## Run it

```bash
pnpm run benchmark:academic:generate
pnpm run benchmark:academic
```

## Current evaluation design

- Real references only.
- Frozen metadata and frozen corpus date for auditability.
- Input strings rendered in common academic styles.
- Batch testing in groups of 50, 100, and 200.
- Repeated runs for consistency measurement.
- Percentage-based scoring for essential accuracy, field accuracy, completion, and consistency.

## When sharing externally

- Share the Markdown report with the JSON evidence bundle.
- Ask partners to rerun the same corpus before adding their own institution-specific samples.
- Keep the benchmark configuration unchanged if you want results to remain comparable over time.
