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

### 11. Duplicate-family scoring no longer over-demotes clean parses

- Citations marked as part of a duplicate family no longer automatically drop into `worth_reviewing`.
- When local quality is `>= 0.85`, duplicate-family citations can now remain `ready`.
- This prevents the duplicate marker from overriding an otherwise clean parse.

### 12. Pre-parse mojibake cleanup now protects extractor input

- Common UTF-8/CP1252 mojibake is now repaired before extractor parsing begins.
- This protects:
  - diacritics in names such as `López`, `Fernández`, and `Ramírez`
  - page ranges such as `113â€“730`
  - acronym-led institutional authors such as `IBM Research Team`
- This was added as an additive pre-normalization step rather than a parser replacement, so the existing extraction stack stays intact while receiving cleaner input.

### 13. Colon-led Vancouver parsing is now first-class

- The extractor and classifier now recognize compact references shaped like:
  - `Author A, Author B: Title. Journal. 2021, 55:1947-99. DOI`
- The Vancouver parser now splits:
  - author block
  - title
  - journal
  - year
  - volume
  - locator
- This fixed the main failure mode in the drug-discovery / AI stress batch, where the old parser was swallowing the title and venue into the author field.

### 14. Expected-field checks are now source-aware

- Journal citations are no longer punished for missing `issue` or `locator` fields unless the raw source actually suggests those fields were present.
- DOI-only tails such as:
  - `2022, 13:10.1038/...`
  no longer trigger false `locator_missing_from_source` warnings.

### 15. Verified-merge conflicts are now normalized before being treated as hard errors

- Equivalent journal venue strings are now treated as compatible when they differ only by abbreviation or expansion:
  - `Artif Intell Rev` vs `Artificial Intelligence Review`
  - `Nat Med` vs `Nature Medicine`
- Equivalent locator/page strings are now treated as compatible when they differ only by shortened page ranges:
  - `1947-99` vs `1947-1999`
  - `1351-63` vs `1351-1363`
- Title conflicts are no longer raised for punctuation-only differences such as:
  - straight vs curly apostrophes
  - hyphen vs en dash / figure dash

### 16. Resolver now rejects source-type-incompatible candidates

- Non-unknown citations are no longer allowed to verify against clearly incompatible external records such as:
  - journal parse -> preprint candidate
  - journal parse -> chapter candidate
- This prevents exact-title matches from being accepted when the external record is for the wrong publication type.

### 17. DOI-verified online-first placeholders can now be upgraded

- When a journal citation only carries a provisional locator like `1-10`, has no extracted volume/issue, and the verified DOI record supplies the final volume/issue/pages, the authority pages are now promoted.
- This avoids treating early-online placeholder locators as hard conflicts when the DOI record is clearly more authoritative.

## Current Measured Status

### Test status

- `npx vitest run server/engine/v2`
  - `11` test files passed
  - `62` tests passed
- `npm run check`
  - passed

### Additional targeted regression status

- `npx vitest run server/engine/v2/adapters.test.ts server/engine/v2/utils.test.ts server/engine/v2/validation-false-positives.test.ts server/engine/v2/enrich-stage.test.ts server/engine/v2/resolution.test.ts`
  - `5` test files passed
  - `47` tests passed
- `npm run check`
  - passed after the drug/AI stress-batch fixes

### Drug / AI stress batch results

Fixture:

- `D:\Coding\Citing\scripts\data\stress-batch-20260322-drug-ai.txt`

Latest report:

- `D:\Coding\Citing\output\stress\20260322-045657Z-stress-batch-20260322-drug-ai.json`

Counts in that report:

- `ready = 26`
- `worth_reviewing = 33`
- `action_needed = 1`

Main structural improvements that drove this:

- colon-led Vancouver parsing rescue
- truncated mojibake repair for broken years / locators
- DOI hyphen-wrap repair
- source-aware expected field logic
- equivalence-aware merge conflict handling
- source-type compatibility hard rejection
- online-first locator promotion on DOI verification

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
- `drug-ai #32`
  - truncated reference:
    - `Bate A, Hobbiger SF: Artificial intelligence, real-world automation and the safety of medicines . Drug Saf.`
  - this is genuinely too sparse for strict resolution because year / final locator / DOI are absent
  - the right structural next step is a softer incomplete-journal fallback bucket, not forced verification

### 3. Improve remaining `worth_reviewing` cases

Main patterns still left in review:

- article-number / issue-less journals
  - especially journals where issue is genuinely absent
- `Information Research` style locators such as `paper 872`
- a few conference / book-like citations that remain slightly under the ready threshold
- some edge-case title/venue confidence outcomes on synthetic references
- compact Vancouver references that are structurally clean but still need more reliable promotion to `ready` when local evidence is strong
- author-field false positives where a merged blob still contains title / venue / year / DOI content and must be demoted earlier in extraction
- mixed-encoding PDF/OCR noise outside the current UTF-8/CP1252 repair pass
  - especially cases where the source text has already lost byte-level information before ingestion

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
6. Remaining encoding-noise coverage
   - validate that the new pre-parse mojibake cleanup fully covers acronym-led group authors and PDF-derived diacritic corruption on larger mixed batches
7. Confidence calibration for author parsing
   - reward clean compact Vancouver author lists
   - heavily demote author strings that leak title/source metadata
8. Render/report observability
   - include rendered output in stress artifacts so duplicated-year regressions can be traced from the saved JSON instead of reproduced manually

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
- compact-Vancouver author confidence regression
- author-content-leak false-positive regression
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
- the latest extended drug-AI stress run reached:
  - `ready=52`
  - `worth_reviewing=7`
  - `action_needed=1`
  - report: `D:\Coding\Citing\output\stress\20260322-053229Z-stress-batch-20260322-drug-ai-extended.json`
- compact Vancouver author arrays now stay intact instead of being collapsed into fake surname/given pairs
- merged author/title/source blobs are now heavily demoted instead of receiving misleadingly high author confidence
- title-led websites no longer invent corporate authors or duplicate the year in rendered output
- page/journal conflict handling is more tolerant of:
  - abbreviated page ranges versus expanded ranges
  - `e`-prefixed page locators
  - article-number-like locators
  - parenthetical journal qualifiers such as `Aging (Albany NY)`

What is not fully closed yet:

- one genuinely truncated citation still remains action-needed:
  - `Bate A, Hobbiger SF: Artificial intelligence, real-world automation and the safety of medicines . Drug Saf.`
- the remaining `worth_reviewing` items are mostly true `no_exact_external_match` cases rather than parser corruption
- a small set of extractor edge cases still needs targeted architectural cleanup
