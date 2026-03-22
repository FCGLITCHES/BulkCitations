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

### 18. Verified authority matches now repair fields instead of only backfilling them

- Once strict resolution verifies the correct record, the enrich stage now treats that record as corrective authority for core bibliographic fields.
- Non-user extracted fields are now repaired when the verified authority record disagrees on:
  - authors
  - title
  - journal / conference / book venue
  - year
  - DOI / URL
  - volume / issue / pages
- Semantically equivalent variants are still preserved without being treated as errors, for example:
  - abbreviated vs expanded journal names
  - shortened vs expanded page spans
  - punctuation-only title differences

### 19. Resolution metadata now records which fields were actually applied from authority

- `resolution.appliedFields` was added so the engine can distinguish:
  - fields corrected or filled from verified authority
  - unresolved conflicts that still need manual review
- `validate` now reports authority-applied field changes as informational:
  - `authority_fields_applied`
- These are no longer treated like hard merge conflicts.

### 20. Dedup now preserves verified authority wins and revalidates merged citations

- Dedup base-citation selection now prefers:
  - verified resolution
  - authority-backed fields
  - stronger overall citation confidence
- Field-level duplicate merging now prefers the strongest field, not just the first non-empty one.
- Merged citations no longer concatenate all duplicate raw strings into one polluted `raw` blob.
- After dedup merges a canonical citation, it now reruns offline validation on the merged citation so stale pre-merge validation does not leak into scoring.
- This prevents duplicate-family collapse from undoing a verified enrich correction.

Why this was added:

- before this change, a duplicate family could contain one strong merged citation and several still-dirty duplicate members
- that made the family internally inconsistent and kept review/scoring pressure on records the engine had already effectively solved
- the right architecture is for dedup to act as canonicalization, not just clustering

## Current Measured Status

### Test status

- `npx vitest run server/engine/v2`
  - `12` test files passed
  - `90` tests passed
- `npm run check`
  - passed

### Additional targeted regression status

- `npx vitest run server/engine/v2/enrich-stage.test.ts server/engine/v2/enrich-validate-dedup.test.ts server/engine/v2/validation-false-positives.test.ts server/engine/v2/pipeline.test.ts`
  - `4` test files passed
  - `37` tests passed
- `npm run check`
  - passed after the enrich / validate / dedup architecture changes

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

### Latest phase-focused stress verification

Fixture:

- `D:\Coding\Citing\scripts\data\stress-batch-20260322-drug-ai-extended.txt`

Latest report:

- `D:\Coding\Citing\output\stress\20260322-074127Z-stress-batch-20260322-drug-ai-extended.json`

Counts in that report:

- `ready = 52`
- `worth_reviewing = 7`
- `action_needed = 1`
- verified citations = `51`
- citations with `resolution.appliedFields` = `51`
- citations with unresolved `resolution.conflictFields` = `0`

What this means:

- verified authority matches are now being applied into the canonical citation instead of only sitting in debug metadata
- no citations in the saved stress report are currently stuck in review because enrich preserved an authority conflict
- the remaining `worth_reviewing` items in this batch are still resolver / extractor misses, not validate / dedup regressions

### 21. Dedup now refuses structural merges when explicit DOIs disagree

- Two citations can no longer be structurally deduplicated if both contain explicit DOI values and those DOI values are different.
- This closes a high-confidence false-positive path where:
  - title
  - year
  - venue
  - pages
  looked similar enough to merge, even though the DOI evidence said they were different works.
- In practice this makes dedup more conservative in exactly the right place:
  - if DOI evidence agrees, merge is safe
  - if DOI evidence conflicts, merge is blocked

### 22. The site now has a raw-content v2 path instead of forcing client-side reference shaping

- The web input path no longer has to successfully split pasted text into a `references[]` array before conversion can begin when `v2` is selected.
- The site can now send the raw pasted blob through the legacy `/api/convert` bridge using `content`, and the bridge hands that raw text to the v2 pipeline.
- This matters because many paste failures were not engine failures at all; they were front-end pre-shaping failures where the UI tried to decide what counted as a valid reference block before the v2 pipeline saw the input.
- Internal canonical field guards were kept in place. The change was made at the transport boundary, not by weakening the engine’s typed citation model.

### 23. Enrich now isolates slow citations with a per-citation timeout guard

- `enrich` now applies a per-citation resolution deadline instead of relying only on the full-stage timeout budget.
- When a single citation stalls in provider lookup, that citation now degrades to:
  - `resolution.status = provider_error`
  instead of causing:
  - a full-stage enrich timeout
  - a partial batch with missing resolution metadata
- A timeout fallback is cached so repeated duplicate-style variants do not keep re-triggering the same hang.

Why this was added:

- the 500-reference enrich/validate/dedup stress batch exposed that one slow provider path could cause the entire `enrich` stage to timeout
- when that happened, `validate`, `dedup`, and `score` were all forced to work without the authority data they were designed to consume
- the right fix was not to loosen validation; it was to make `enrich` failure-local instead of batch-global

### 24. Dedup now hydrates duplicate-family members from the merged canonical record

- After dedup builds the merged canonical citation, duplicate members now inherit the strongest safe family fields:
  - authors
  - title
  - year
  - venue fields
  - DOI / URL
  - locator fields
- Hydrated duplicate members are revalidated before scoring.

Why this was added:

- previously dedup solved the family only halfway:
  - the merged record became strong
  - but duplicate members still carried stale partial fields
- this kept duplicate-family members in `worth_reviewing` even when the family already contained a verified canonical answer
- the architectural fix was to make dedup family-aware all the way through scoring

### 25. Score now treats clean provider failures as unresolved verification, not citation damage

- `score` now allows locally strong citations to stay `ready` when:
  - the citation is structurally clean
  - required fields are present
  - the only unresolved issue is provider failure or another benign unresolved verification status
- This logic is still blocked for:
  - malformed authors
  - protected-token corruption
  - missing required fields
  - hard merge conflicts
  - confirmed split contamination

Why this was added:

- provider failure is a systems problem, not automatically a citation-quality problem
- if the local parse is already strong, demoting the citation purely because Crossref or OpenAlex timed out makes the final bucket reflect network luck instead of citation quality
- the change was designed to make scoring more honest, not more permissive across the board

### 26. Latest 500-reference enrich/validate/dedup stress status

Fixture:

- `D:\Coding\Citing\scripts\data\stress-batch-20260322-enrich-validate-dedup-500.txt`

Latest completed report:

- `D:\Coding\Citing\output\stress\20260322-150300Z-stress-batch-20260322-enrich-validate-dedup-500.json`

Counts in that report:

- `ready = 487`
- `worth_reviewing = 4`
- `action_needed = 9`
- ready rate = `0.974`

What this means:

- the `>95% ready` target has been exceeded on this stress batch
- `enrich`, `validate`, and `dedup` are no longer the main systemic blockers on this dataset
- the remaining misses are mostly extractor corruption or genuinely sparse fragments, not authority-merge architecture failures

## What Still Needs Fixing

Deferred for later by request:

- ranked detect-family confusion analysis
- ranked source-type misclassification analysis
- ranked extraction field-loss analysis

### 1. Fix remaining `action_needed` citations

Current main remaining action-needed cases:

- malformed extractor outputs such as:
  - `Projector augmented-wave method`
  - fragmentary PRISMA forms like `: n71` / `b2535` / `e1000097`
- sparse variants still missing core fields such as year or venue for:
  - `lme4`
  - `MizAR`
- one contaminated corporate-author case:
  - `WE, Federation`

These are mostly extractor-side problems now.

### 2. Improve remaining `worth_reviewing` cases

Main patterns still left in review:

- provider-error or no-exact-match cases with locally strong structure but still slightly weak venue/year extraction on sparse variants
- book/software-like placeholder-venue records such as `CRC Handbook of Chemistry and Physics`
- conference-style variants where venue extraction still includes noise such as `Proceedings of the National Academy of Sciences 2005`
- remaining family members with extractor-side author collapse before dedup can fully recover them

## What We Need To Focus On Next

### Immediate focus

1. Treat the current `enrich` / `validate` / `dedup` architecture as stable enough for this stress family.
2. Shift the next wave of work toward extractor cleanup on the remaining `13` non-ready citations.
3. Keep using the same saved 500-reference fixture to measure whether extractor improvements actually reduce:
   - fragment titles
   - malformed authors
   - placeholder venue leakage
   - sparse-family year loss

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

This has now changed.

The next sequence should be:

1. Keep the current 500-reference enrich/validate/dedup fixture as the main regression benchmark.
2. Focus on extractor-side cleanup for the remaining fragmentary and malformed records.
3. Add targeted regressions for:
   - PRISMA fragment titles
   - `lme4` year-loss cases
   - `MizAR` venue/year sparsity
   - corporate-author contamination like `WE, Federation`
4. Recheck whether any remaining review items are truly unresolved versus just extractor-underconfident.

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
- we also crossed the newer `>95% ready` target on the 500-reference enrich/validate/dedup stress batch
- parser quality, institutional handling, and confidence calibration are much stronger
- `enrich` no longer needs to fail the full batch when one citation stalls
- `dedup` now strengthens duplicate-family members instead of leaving them as stale siblings
- `score` is now better aligned with citation quality rather than provider luck
- the latest extended drug-AI stress run reached:
  - `ready=52`
  - `worth_reviewing=7`
  - `action_needed=1`
  - report: `D:\Coding\Citing\output\stress\20260322-053229Z-stress-batch-20260322-drug-ai-extended.json`
- the latest 500-reference enrich/validate/dedup run reached:
  - `ready=487`
  - `worth_reviewing=4`
  - `action_needed=9`
  - report: `D:\Coding\Citing\output\stress\20260322-150300Z-stress-batch-20260322-enrich-validate-dedup-500.json`
- compact Vancouver author arrays now stay intact instead of being collapsed into fake surname/given pairs
- merged author/title/source blobs are now heavily demoted instead of receiving misleadingly high author confidence
- title-led websites no longer invent corporate authors or duplicate the year in rendered output
- page/journal conflict handling is more tolerant of:
  - abbreviated page ranges versus expanded ranges
  - `e`-prefixed page locators
  - article-number-like locators
  - parenthetical journal qualifiers such as `Aging (Albany NY)`

What is not fully closed yet:

- the remaining misses are now mostly extractor corruption or genuinely sparse fragments
- provider coverage/ranking is no longer the dominant blocker on the main 500-reference phase-focused batch
- a small set of extractor edge cases still needs targeted architectural cleanup
