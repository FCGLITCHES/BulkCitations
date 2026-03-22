# Strict Resolution Progress - 2026-03-22

## Goal

Stabilize the v2 citation engine so the stress harness:

- always writes a new timestamped report file
- classifies citations into `ready`, `worth_reviewing`, and `action_needed`
- uses strict external resolution instead of first-hit enrichment
- surfaces debug data that explains why a citation landed in a given bucket
- improves systematically at the parser / resolver / scorer level rather than via citation-by-citation patches

## What Has Been Fixed

### 1. Strict-resolution architecture is in place

- Stage order was moved to:
  - `ingest -> split -> detect -> extract -> enrich(resolve) -> normalize -> validate -> truth -> dedup -> group -> score -> render -> respond`
- `enrich` now owns networked resolution.
- `validate` now reads resolution results instead of doing its own provider fetches.
- `resolution` metadata was added with strict status handling:
  - `verified`
  - `verified_with_year_tolerance`
  - `no_exact_match`
  - `ambiguous_match`
  - `insufficient_evidence`
  - `provider_no_coverage`
  - `provider_error`
  - `skipped_duplicate`

### 2. Timestamped stress reports were added

- Stress harness now writes a new file on every run under:
  - `D:\Coding\Citing\output\stress`
- Saved batch fixture:
  - `D:\Coding\Citing\scripts\data\stress-batch-20260321.txt`
- Report includes:
  - raw citation
  - parsed fields
  - merged fields
  - missing fields
  - validation codes
  - bucket and bucket reasons
  - diagnosis summary
  - stage debug payloads

### 3. Title/author resolution became stricter

- Title matching now uses normalized title comparison with protected-token preservation.
- Protected tokens such as `U-Net`, `PRISMA`, `GLOBOCAN`, `BMJ`, and `GPT-5.1` are preserved and used as hard rejection signals when corrupted.
- Candidate acceptance requires:
  - title acceptance
  - first-author or group-author agreement
  - compatible year logic
  - explicit ambiguity handling

### 4. Provider behavior was improved

- External provider search now uses query evidence instead of title-only search:
  - title
  - author surname or group-author literal
  - year
  - venue
  - source type
- Provider clients now include throttling and retry/backoff behavior to reduce `429` failures.
- Crossref search was upgraded away from naive title-only usage toward bibliographic/author-aware querying.
- PubMed search now includes author/year evidence when available.
- OpenAlex search now uses tighter query construction and polite-pool metadata.

### 5. Provider-error poisoning was fixed

- A single provider failure no longer forces the final resolution status to `provider_error` if another provider completed successfully.
- This stopped provider failures from collapsing otherwise valid citations into review-only outcomes.

### 6. Group-author and institutional parsing improved

- Better detection for:
  - acronym-led organizations like `UN Women`, `NHS England`
  - single-token organizations like `OpenAI`, `MATLAB`, `OECD`
  - two-word institutional authors like `United Nations`
- Institutional extractor improved for:
  - reports
  - guidelines
  - handbooks
  - website-like references
  - edition/version metadata separation

### 7. Unicode / name parsing fixes were added

- Better handling for:
  - diacritics
  - apostrophes
  - particles
  - hyphenated surnames
  - dotted initials
  - compacted given names like `ReubenM.`
- Added author-blob splitting for joined full names like:
  - `Reuben M. Baron and David A. Kenny`

### 8. False positives were reduced

- Fixed protected-token venue corruption false positives for titles like:
  - `BMJ-style article locators ...`
- Stable institutional authors no longer get noisy `truncated_group_author` warnings.

### 9. Confidence scoring bugs were fixed

- Fixed a major bug where nearly every author string could be penalized as if it ended in a single-letter tail.
- Institutional author confidence was raised for clean report / website / handbook-style citations.
- Institutional publisher / institution confidence was raised where the parsed value is clearly organizational.
- This was the main change that unlocked the large jump in `ready` outcomes.

### 10. Local-ready path was fixed

- Report / book / website citations are now allowed to become `ready` on a clean local parse when exact provider coverage is absent, instead of being artificially capped below the threshold.

## Current Measured Status

### Test status

- `npx vitest run server/engine/v2`
  - `11` test files passed
  - `62` tests passed
- `npm run check`
  - passed

### Latest saved batch results

Latest completed report:

- `D:\Coding\Citing\output\stress\20260321-204752Z-stress-batch-20260321.json`

Counts in that report:

- `ready = 228`
- `worth_reviewing = 26`
- `action_needed = 6`
- ready rate = `0.8769`
- average confidence = `0.91`

Important caveat:

- The latest completed report still shows `enrich:stage-error` in `processingPath`.
- The enrich stage timed out right at the batch boundary and the pipeline fell back.
- That means the saved counts above are real for parsing/scoring, but the report does **not yet** contain a fully completed strict-resolution payload for the whole batch.
- In other words:
  - parsing/scoring improvements are real
  - but the latest saved report is not yet the final authority for resolution-status distribution

## What Still Needs Fixing

### 1. Finish a full enrich-complete batch run

This is the most important remaining task.

Why:

- the latest completed reports hit the enrich timeout boundary
- `resolution` is missing from the saved output for those runs
- provider stats in the report are therefore incomplete / empty

What needs to happen:

- rerun the full stress harness with the larger enrich timeout budget
- confirm the report finishes without:
  - `fallbacksUsed: ["enrich:stage-error"]`
  - `partialResult: true`
- confirm the saved report contains:
  - `resolution.status`
  - `provider`
  - `matchStrategy`
  - non-empty provider summary counts

### 2. Fix remaining `action_needed` citations

Current main remaining action-needed cases:

- `#23` low-quality edge case around arXiv identifier handling in a journal-style citation
- `#51` missing `publisher` for:
  - `Cochrane handbook for systematic reviews of interventions`
- `#88` and `#177`
  - batch header lines, not true citations
  - should ideally be filtered or discarded earlier
- `#100`
  - `MATLAB. Version 9.9.0 (R2020b)...`
  - extractor still misses title / venue shape for software-style references
- `#114`
  - `National Academies of Sciences, Engineering, and Medicine...`
  - extractor still drops the title in this book/report-like format

### 3. Improve remaining `worth_reviewing` cases

Main patterns still left in review:

- article-number / issue-less journals
  - especially journals where issue is genuinely absent
- `Information Research` style locators such as `paper 872`
- a few conference / book-like citations that remain slightly under the ready threshold
- some edge-case title/venue confidence outcomes on synthetic references

## What We Need To Focus On Next

### Immediate focus

1. Complete one true enrich-finished full batch run and save that report.
2. Verify the strict-resolution output is preserved in the JSON artifact.
3. Inspect real resolution distributions:
   - verified
   - no_exact_match
   - provider_no_coverage
   - provider_error
   - insufficient_evidence
4. Tune the remaining review/action cases from patterns, not individual references.

### Next parser/extractor focus

1. Software references
   - `MATLAB`, `R`, versioned tools, language runtimes
2. Book/report title retention
   - especially National Academies / National Academies Press patterns
3. Handbook/manual publisher inference
   - especially known institutional handbooks like Cochrane
4. Better non-citation line rejection
   - headings such as `Here is Batch 2 ...`
5. Locator policy improvements
   - `paper 872`
   - issue-less article-number journals

## What I Wanted To Fix Next Before The Interrupted Run

This was the exact next sequence I was working toward:

1. Finish a full batch run with an explicit high enrich timeout so resolution data is actually present in the report.
2. Confirm provider stats in the report are populated.
3. Inspect which citations are truly `verified` versus locally-ready-only.
4. Patch the remaining extractor misses:
   - `MATLAB`
   - `National Academies ...`
   - `Cochrane handbook ...`
5. Revisit the remaining review bucket once strict-resolution stats are visible.

## Key Files Changed So Far

- `D:\Coding\Citing\server\engine\shared\citationSemantics.ts`
- `D:\Coding\Citing\server\engine\v2\resolution.ts`
- `D:\Coding\Citing\server\engine\v2\contracts.ts`
- `D:\Coding\Citing\server\engine\v2\adapters.ts`
- `D:\Coding\Citing\server\engine\v2\qualityRules.ts`
- `D:\Coding\Citing\server\engine\v2\pipeline.ts`
- `D:\Coding\Citing\server\engine\v2\stages\enrich.ts`
- `D:\Coding\Citing\server\engine\v2\stages\validate.ts`
- `D:\Coding\Citing\server\engine\v2\stages\score.ts`
- `D:\Coding\Citing\shared\referenceHealthHeuristics.ts`
- `D:\Coding\Citing\scripts\stressV2.ts`
- `D:\Coding\Citing\scripts\data\stress-batch-20260321.txt`

## Regression Coverage Added

- author parsing / diacritics / group-author handling
- author-tail confidence bug regression
- institutional extractor regressions
- protected-token false positives
- report-ready local scoring path
- enrich-stage query-evidence plumbing
- deterministic pipeline test to avoid accidental live-network dependence

## Practical Bottom Line

What is already true:

- the engine is materially better than it was at the start of this work
- we crossed the `>85% ready` target on the saved stress batch from the scoring/parsing side
- parser quality, institutional handling, and confidence calibration are much stronger

What is not fully closed yet:

- we still need one full enrich-complete batch artifact so the saved report shows true strict-resolution results instead of a timeout fallback
- a small set of extractor edge cases still needs targeted architectural cleanup
