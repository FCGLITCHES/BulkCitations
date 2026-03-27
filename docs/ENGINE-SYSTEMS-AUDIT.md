# Citation Engine Systems Audit

## Scope

This document is a practical audit of the citation engine as it exists today in this repo.

It covers:

- the active `v2` engine and its phases
- the legacy parser / renderer systems that still matter
- all scoring systems currently used
- the heuristic families used across ingest, split, extract, enrich, validate, dedup, score, and render
- the regex-heavy subsystems and where those patterns live
- the regression / test systems that protect real-world behavior
- the main pros, cons, and what should be fixed next

The active production path is the `v2` pipeline under `server/engine/v2/`. The older parser stack under `server/engine/` still matters because:

- it powers legacy paths
- `v2` adapters still reuse legacy parser behavior
- a lot of the style and structural heuristics still live there

## Executive Summary

The engine is no longer one parser with a formatter attached. It is now a staged system with:

1. input profiling
2. structural splitting
3. style detection
4. extraction with multiple competing heuristics
5. authority enrichment
6. normalization
7. validation
8. approved-truth reuse
9. duplicate-family merging
10. quality scoring and bucketing
11. rendering and post-render cleanup
12. response assembly and export generation

The biggest strengths are:

- much better real-world pasted-text handling than a simple parser
- explicit diagnostics instead of silent failure
- bounded repair instead of global hallucination
- strong regression emphasis on real-world batches

The biggest weaknesses are:

- logic is spread across many files, so behavior is hard to reason about end-to-end
- regex and heuristics are duplicated across legacy and `v2`
- thresholds are powerful but risky; small tuning changes can cause cross-suite regressions
- extraction remains the noisiest and most complex stage

## Top-Level System Map

### Active runtime path

The `v2` stage order in `server/engine/v2/config.ts` is:

1. `ingest`
2. `split`
3. `detect`
4. `extract`
5. `enrich`
6. `normalize`
7. `validate`
8. `truth`
9. `dedup`
10. `group` (disabled by default)
11. `score`
12. `render`
13. `respond`

### Runtime orchestration system

The orchestration layer in `server/engine/v2/pipeline.ts` provides:

- per-stage enable / disable control
- per-stage timeout policies
- stage-specific timeout scaling by work units
- stage isolation and item-level recovery
- partial-result handling
- fallback tracking
- job-level diagnostics and timings

### Legacy supporting systems

The legacy stack still matters:

- `server/engine/citationParser.ts`: legacy pre-normalization, style detection, style-specific parsing, dynamic patterns
- `server/engine/strictRenderer.ts`: style assertions, output cleanup, warning generation
- `shared/computeRulesScore.ts`: warning-to-score conversion
- `shared/confidence.ts`: final legacy confidence capping

## Engine Phases

### 1. Ingest

File: `server/engine/v2/stages/ingest.ts`

Purpose:

- validate the source path
- classify the input structure
- estimate citation count
- emit routing signals for downstream stages

Main systems in ingest:

- source-type handlers for `text`, `doi_list`, `bib`, `ris`, `pdf_base64`, `url`
- explicit schema detection for BibTeX, RIS, and DOI lists
- PDF extraction via `pdf-parse-new`
- URL article extraction via `jsdom` + `@mozilla/readability`
- profile classification into `structured`, `semi_structured`, `unstructured`, or `unknown`

Key heuristic signals:

- `numbered_lines`
- `author_line_starts`
- `doi_density`
- `doi_heavy`
- `book_tail_markers`
- `conference_tail_markers`
- `mixed_style_markers`
- `long_prose_lines`
- `footnote_markers`
- `ocr_noise_markers`
- `single_block`

Pros:

- clearly separates ingest-path problems from parsing problems
- gives downstream stages useful uncertainty hints
- blocks unsafe or oversized input early

Cons:

- profile signals are descriptive, not deeply ranked
- ingest classification can say "this looks noisy" but not yet "this specific later path should win"

What to fix:

- centralize profile-to-routing policy instead of scattering it across later stages
- make input-profile signals first-class in test snapshots so routing drift is visible

### 2. Split

Files:

- `server/engine/v2/stages/split.ts`
- `server/engine/v2/rawPdfCopy.ts`

Purpose:

- turn raw blobs into citation candidates
- preserve line-level evidence for later repair and validation

Core split systems:

- structural splitting for already structured sources
- opener scoring for pasted / OCR-like text
- artifact stripping for page headers, page numbers, and running titles
- bounded multiline joining
- secondary-boundary recovery for oversized single chunks
- LLM re-split fallback when structural recovery fails

Important constants:

- `OPENER_THRESHOLD = 0.58`
- `OVERSIZED_WORKING_CHUNK_CHARS = 800`
- `OVERSIZED_WORKING_CHUNK_LINES = 12`
- `SUSPECTED_MULTI_CITATION_CHARS = 2000`

Pros:

- one of the strongest parts of the system
- explicit contamination flags are very useful later
- avoids "all text becomes one citation" collapse better than the old engine

Cons:

- still vulnerable to pathological OCR and prose/reference mixtures
- author-only weak openers remain hard
- split and repair behavior is regex-dense and therefore hard to tune safely

What to fix:

- move split scoring weights into a single config object with commentary and tests
- add more permanent real-world fixtures for weak opener runs and prose/reference boundary confusion

### 3. Detect

File: `server/engine/v2/stages/detect.ts`

Purpose:

- infer a style when `inputStyle = auto`
- reduce confidence if ingest already signaled uncertainty

Detect does not do deep reranking; it mostly:

- asks the classifier adapter for `style + confidence`
- subtracts uncertainty penalties from ingest signals

Current uncertainty penalties:

- `mixed_style_markers`: `-0.12`
- `ocr_noise_markers`: `-0.12`
- `long_prose_lines`: `-0.06`
- `footnote_markers`: `-0.06`

Pros:

- simple and bounded
- avoids over-trusting noisy style detections

Cons:

- still effectively single-label detection
- does not preserve a strong ranked family list for downstream extraction

What to fix:

- return a ranked style family list, not just one label
- expose style ambiguity more explicitly to extraction

### 4. Extract

Files:

- `server/engine/v2/stages/extract.ts`
- `server/engine/v2/adapters.ts`
- `server/engine/v2/qualityRules.ts`
- `server/engine/citationParser.ts`

Purpose:

- recover canonical fields from each split candidate

This is the densest stage in the system.

It combines:

- prepared working chunks from split
- deterministic parsing
- year-anchored fallback parsing
- institutional/report heuristics
- `In:` source heuristics
- optional GROBID path
- optional LLM fallback path
- author parsing / cleanup
- parsed-field sanitization

Pros:

- highest coverage stage in the pipeline
- multiple competing candidate builders reduce single-path brittleness
- bounded repair keeps it safer than unconstrained rewriting

Cons:

- the hardest stage to understand and the easiest to accidentally destabilize
- extraction heuristics exist in both legacy parser code and `v2` adapters
- candidate scoring is powerful but not yet centrally documented in code

What to fix:

- unify legacy and `v2` parsing heuristics behind a shared catalog
- separate candidate generation from candidate scoring more cleanly
- add more test fixtures for adjacent-type confusion: report vs website, book vs chapter, journal vs conference

### 5. Enrich

File: `server/engine/v2/stages/enrich.ts`

Purpose:

- verify against authority providers
- merge high-confidence external metadata safely

Major systems:

- provider fan-out and ordering
- cache support
- DOI and URL evidence use
- authority-safe field merging
- conflict tracking
- provider coverage handling
- retraction flag propagation

Pros:

- adds verification instead of just formatting guesswork
- field-level merge rules are conservative
- conflict tracking is excellent for debugging

Cons:

- provider coverage varies heavily by citation type
- sync-batch budgets and rate limits can still distort behavior
- authority behavior is inherently unstable and must be regression-rerun carefully

What to fix:

- make provider ordering and local-only bypass rules more visible
- add stronger fixtures for provider-no-coverage cases that should still become locally ready

### 6. Normalize

File: `server/engine/v2/stages/normalize.ts`

Purpose:

- canonical cleanup without inventing new structure

Main normalization work:

- Unicode repair
- DOI normalization
- locator normalization
- title-case recovery for all-caps titles
- container-name normalization
- group-author normalization
- institution/publisher mapping for thesis/report cases
- bounded residual-artifact detection

Pros:

- intentionally conservative
- preserves repair provenance
- keeps cleanup separate from extraction

Cons:

- some semantic promotions are still mixed into normalization
- normalization policy is partly business logic, not just cleanup

What to fix:

- split pure normalization from semantic promotion rules
- add a "normalization-only diff" test snapshot to make accidental behavior growth obvious

### 7. Validate

File: `server/engine/v2/stages/validate.ts`

Purpose:

- generate diagnostics for plausibility, corruption, contamination, and missing required fields

Validation families:

- plausibility issues
- malformed author detection
- DOI / page-shape checks
- protected token corruption checks
- residual artifact checks
- embedded-reference-start detection
- split contamination confirmation / suspicion
- missing required venue / locator warnings

Pros:

- rich diagnostics
- validation output feeds later score and bucket decisions well
- catches silent corruption that old pipelines would miss

Cons:

- validation does not repair
- some heuristics are intentionally conservative and may leave good citations in review buckets

What to fix:

- classify validation issues into "must repair upstream" vs "safe to ignore downstream"
- consolidate issue-code documentation in one place

### 8. Truth

File: `server/engine/v2/stages/truth.ts`

Purpose:

- reuse approved truth records and approved validated output

Pros:

- strongest path when prior truth exists
- stable provenance
- can skip a lot of unnecessary risk

Cons:

- helps only for already-approved citation families
- truth coverage is sparse by definition

What to fix:

- improve tooling around truth creation and surfacing low-confidence truth opportunities

### 9. Dedup

File: `server/engine/v2/stages/dedup.ts`

Purpose:

- merge duplicate families
- hydrate weaker duplicates from stronger family members

Dedup systems:

- structural duplicate detection
- title / venue / pages / author overlap similarity
- base-citation strength ranking
- per-field merge strength selection
- confidence penalty when merged duplicates materially differ

Pros:

- good duplicate-family hydration
- explicit changed-field penalties are smart

Cons:

- same-title same-year neighbors still risky
- dedup is downstream enough that wrong merges can look "clean"

What to fix:

- add more edition / translation / conference-paper-vs-journal-version negative tests
- log duplicate-family explanations more compactly for easier human review

### 10. Group

File: `server/engine/v2/stages/group.ts`

Status:

- present but disabled by default

### 11. Score

File: `server/engine/v2/stages/score.ts`

Purpose:

- compute overall quality
- assign `ready`, `worth_reviewing`, or `action_needed`

This is the main operational quality gate. More detail is in the scoring section below.

### 12. Render

Files:

- `server/engine/v2/stages/render.ts`
- `server/engine/strictRenderer.ts`
- `server/engine/cslConverter.ts`

Purpose:

- render final citations through CSL
- post-clean punctuation and output style artifacts
- run style assertions

Pros:

- stable CSL-backed rendering
- post-render cleanup catches a lot of ugly output
- truth output can short-circuit risk

Cons:

- output is still limited by upstream canonical quality
- strict-render cleanup regexes are doing a lot of hidden work

What to fix:

- separate cosmetic cleanup from style-policy cleanup
- reduce dependence on cleanup after malformed upstream field combinations

### 13. Respond

File: `server/engine/v2/stages/respond.ts`

Purpose:

- build the response envelope
- emit stats, exports, timings, fallback history, and debug payloads

Pros:

- very good observability surface

Cons:

- debug payloads can get large

What to fix:

- add a compact debug mode for batch triage

## Scoring Systems

### 1. Split opener scoring

File: `server/engine/v2/rawPdfCopy.ts`

Current weights:

- valid numeric bibliography marker: `+0.40`
- author-like opener: `+0.35`
- year anchor present: `+0.25`
- previous artifact boundary: `+0.10`
- author opener + continuation + next-line year anchor: `+0.25`
- numeric lead with Vancouver tail: `+0.25`
- lowercase / connector lead: `-0.45`
- no year and fewer than 4 tokens: `-0.20`
- obvious continuation starters: `-0.15`

Decision rule:

- numbered markers always open a new citation
- otherwise boundary seeds can force new openings
- otherwise `openerConfidence >= 0.58`

Pros:

- intuitive and effective on real batches

Cons:

- weights are hand-tuned and fragile

Fix:

- make these weights data-driven and expose them in baseline snapshots

### 2. Detect uncertainty scoring

File: `server/engine/v2/stages/detect.ts`

System:

- adapter provides base style confidence
- ingest uncertainty subtracts a penalty

Pros:

- simple and honest

Cons:

- not rich enough for mixed-style batches

Fix:

- store top-N style candidates with margin

### 3. Extraction candidate scoring

File: `server/engine/v2/adapters.ts`

The extractor does not trust one parse branch. It scores multiple candidates:

- deterministic raw parse
- year-anchored fallback
- institutional heuristic
- `In:` source heuristic
- optional GROBID / LLM augmentations

Signals used in extraction candidate scoring include:

- `scoreCandidate(parsed, referenceType)`
- parser warning penalties
- rejected-candidate penalties
- bonus for strong author-parser modes
- style-signal bonuses from `getStyleSignalScore`
- split contamination penalties

Pros:

- better than one fixed parser

Cons:

- scoring policy is embedded in code and hard to inspect at a glance

Fix:

- move candidate-score explanations into a dedicated scorer module

### 4. Resolution acceptance scoring

File: `server/engine/v2/resolution.ts`

Resolution uses several scoring and acceptance gates:

- strict title matching with protected token preservation
- Jaccard title similarity for near-exact matches
- author surname evidence
- additional author matches
- venue token overlap
- locator compatibility
- DOI / URL evidence
- year compatibility and limited year tolerance for preprint-like cases
- source-type compatibility

Pros:

- much safer than fuzzy title-only matching

Cons:

- still complex enough that false negatives are possible for sparse citations

Fix:

- emit a compact score breakdown per accepted / rejected candidate in debug mode

### 5. Dedup scoring

File: `server/engine/v2/stages/dedup.ts`

Dedup computes:

- title similarity
- venue similarity
- page similarity
- author overlap
- citation strength
- field strength
- duplicate confidence penalties based on changed fields

Pros:

- good balance of family hydration and caution

Cons:

- difficult edge case: near-duplicate scholarly versions

Fix:

- introduce explicit "version family" handling instead of binary duplicate logic

### 6. Quality scoring and bucket assignment

File: `server/engine/v2/stages/score.ts`

The main quality score is built from:

- average of required field confidences
- small bonuses from expected fields
- penalties from structural validation issues
- caps for malformed authors, split contamination, missing required fields, conflicts, and protected-token corruption
- method penalties for hybrid / LLM paths
- enrichment / duplicate penalties and bonuses

Important bucket thresholds and rules:

- clean unresolved ready threshold: `0.83`
- local ready thresholds rely on high-confidence required fields
- missing required fields cap overall score to `0.59`
- confirmed split contamination caps overall score to `0.49`
- malformed authors cap overall score to `0.45`

Buckets:

- `ready`
- `worth_reviewing`
- `action_needed`

Pros:

- quality is not just "confidence"; it incorporates concrete failure modes

Cons:

- thresholds are powerful and therefore dangerous
- bucket logic is spread across many boolean checks

Fix:

- create a single policy table for score caps, thresholds, and bucket reasons
- freeze stage-level score baselines for real-world corpuses

### 7. Legacy rules score

File: `shared/computeRulesScore.ts`

Legacy scoring is much simpler:

- start at `100`
- `error:` warning string: `-20`
- `warning:` warning string: `-5`

Pros:

- trivial to understand

Cons:

- far too coarse for `v2` quality needs

Fix:

- keep only for legacy compatibility; do not expand it further

### 8. Legacy final confidence

File: `shared/confidence.ts`

Legacy confidence:

- starts from rules score
- clamps suspicious one-letter author surnames down to at most `80`
- caps final displayed score at `95`

Pros:

- stable for old routes

Cons:

- not field-aware enough for modern pipeline quality

Fix:

- phase out in favor of `v2` quality everywhere

## Heuristic Families

### Input profiling heuristics

Main file: `server/engine/v2/stages/ingest.ts`

These heuristics answer:

- what kind of input is this?
- how noisy is it?
- which later systems should be cautious?

### Bounded repair heuristics

Main files:

- `server/engine/v2/rawPdfCopy.ts`
- `server/engine/v2/stages/normalize.ts`

Key idea:

- repairs are allowed only in bounded spans or known artifact windows
- the engine tracks applied repairs, missed repairs, residual artifacts, and repair confidence

This is one of the best architectural choices in the repo.

### Protected token heuristics

Main files:

- `shared/referenceHealthHeuristics.ts`
- `server/engine/v2/resolution.ts`

Protected tokens include important names such as:

- `U-Net`
- `G*Power`
- `2−ΔΔCT`
- `PRISMA`
- `GLOBOCAN`
- `BMJ`
- `PLoS Medicine`
- `DROPS`

These heuristics prevent the engine from "normalizing away" identity-critical tokens.

### Placeholder and contamination heuristics

Main files:

- `server/engine/v2/qualityRules.ts`
- `shared/referenceHealthHeuristics.ts`

They catch:

- fake venue placeholders like `journal`
- placeholder locators
- author-field content leaks
- title DOI / URL leaks
- malformed author structures

### Truth heuristics

Main files:

- `server/engine/v2/stages/truth.ts`
- `server/engine/shared/truthResolver.ts`

Truth heuristics prefer approved prior data over reparsing when a stable match exists.

### Rendering cleanup heuristics

Main files:

- `server/engine/v2/stages/render.ts`
- `server/engine/strictRenderer.ts`

These fix:

- duplicate punctuation
- space-before-punctuation errors
- curly quotes and style-specific quote rules
- IEEE / Harvard / MLA output-specific formatting cleanup

## Regex Pattern Catalog

This repo has a lot of regex. The important point is not every literal pattern by itself, but the regex families and what subsystem they serve.

### A. Split and raw PDF-copy patterns

File: `server/engine/v2/rawPdfCopy.ts`

Pattern groups:

- opener patterns
  - numeric markers
  - surname + initials
  - surname + full name
  - organization / group author openers
  - Vancouver-style author runs
  - mixed author-order runs
- anchor patterns
  - year anchors
  - Vancouver tails
  - DOI / URL presence
- artifact patterns
  - page number artifacts
  - section headings
  - running titles
  - broken DOI / URL spans
  - token split artifacts
- boundary patterns
  - continuation starters
  - bibliographic signal patterns

Pros:

- strong real-world utility

Cons:

- very dense and easy to overfit

### B. Extraction and deterministic parse patterns

Files:

- `server/engine/v2/adapters.ts`
- `server/engine/citationParser.ts`

Pattern groups:

- style-detection patterns for APA, MLA, Harvard, Chicago, IEEE, Vancouver
- reference-type patterns for book, chapter, conference, thesis, report, website
- structured patterns for journal tails, book tails, place/publisher/year blocks
- thesis descriptor patterns
- `In:` source patterns
- website access / viewed / available-from patterns
- year extraction and DOI / URL extraction patterns

Pros:

- wide format coverage

Cons:

- duplicated intent between legacy and `v2`

### C. Quality and validation patterns

File: `server/engine/v2/qualityRules.ts`

Pattern groups:

- locator detection
- author contamination detection
- compact Vancouver author detection
- title DOI / URL leak stripping
- raw-source hints for missing expected fields

### D. Validation contamination and corruption patterns

File: `server/engine/v2/stages/validate.ts`

Pattern groups:

- DOI shape
- page shape
- DOI cluster detection
- year cluster detection
- embedded reference-start detection

### E. Resolution safety patterns

File: `server/engine/v2/resolution.ts`

Pattern groups:

- protected token preservation
- generic-venue rejection
- DOI extraction from URLs
- locator normalization and compatibility
- preprint / year-tolerance special handling

### F. Renderer cleanup and style assertion patterns

File: `server/engine/strictRenderer.ts`

Pattern groups:

- Markdown-link stripping
- DOI angle-bracket cleanup
- `et al.` cleanup
- quote normalization
- APA initial formatting
- Harvard quote conversion
- IEEE online-availability cleanup
- MLA volume / issue / pages label cleanup
- journal abbreviation expansion checks

### G. Shared citation health patterns

File: `shared/referenceHealthHeuristics.ts`

Pattern groups:

- protected title token preservation
- protected venue token preservation
- malformed author-shape checks
- invented placeholder venue checks

## Legacy Systems Still In Place

### Legacy parser

File: `server/engine/citationParser.ts`

Important legacy systems:

- token protection for domain-critical terms
- pre-normalization
- style detection by heuristic scoring
- dynamic pattern loading from `server/data/patterns.json`
- reference-type determination
- year recovery

Pros:

- broad and battle-tested

Cons:

- large file with many responsibilities
- harder to evolve safely than smaller `v2` modules

What to fix:

- split into smaller subsystems and migrate only the still-useful pieces into shared `v2` modules

### Dynamic pattern system

File: `server/engine/citationParser.ts`

This system loads regex extraction rules from `server/data/patterns.json` and hot-reloads them.

Pros:

- easy to extend without touching parser code

Cons:

- only applies to the legacy path today
- easy to create a false sense that all extraction is data-driven when most of it is not

What to fix:

- either retire it or promote it into a first-class shared extraction catalog

### Legacy strict renderer

File: `server/engine/strictRenderer.ts`

Important systems:

- style assertions by output style
- output cleanup
- inline highlight support
- warning generation used by legacy scoring

Pros:

- useful last-line defense

Cons:

- output cleanup is compensating for upstream weakness

What to fix:

- keep assertions, reduce cosmetic repair dependence

## Regression and Test Systems

This repo already has the right philosophy here.

### Core rule

If one real-world batch exposes a bug, the fix is not considered valid until companion real-world suites for the same engine path are rerun.

That means:

- shared-stage changes require broad cross-suite reruns
- split changes require rerunning raw/pasted/PDF-copy boundary suites
- threshold tuning must be treated like shared logic changes
- failing real-world cases should become permanent regressions

### Important test and corpus files

Key `v2` suites:

- `server/engine/v2/real-world-batches.test.ts`
- `server/engine/v2/real-world-450.test.ts`
- `server/engine/v2/regression-pack.test.ts`
- `server/engine/v2/chunked-ready-1000.test.ts`
- `server/engine/v2/rawPdfCopy.test.ts`
- `server/engine/v2/numbered-bibliography-split.test.ts`
- `server/engine/v2/split-contamination.test.ts`
- `server/engine/v2/validation-false-positives.test.ts`
- `server/engine/v2/style-source-regression.test.ts`
- `server/engine/v2/enrich-validate-dedup.test.ts`

Fixture/corpus files:

- `server/engine/v2/fixtures/realWorldBatchFixtures.ts`
- `server/engine/v2/fixtures/pdfCopyFixtures.ts`
- `server/engine/v2/fixtures/chunkedReadyCorpus.ts`
- `server/engine/v2/fixtures/operationalAccuracyCorpus.ts`
- `server/engine/v2/fixtures/stress500Corpus.ts`

Pros:

- the repo already leans toward real published citations instead of toy examples

Cons:

- not all heuristics are documented near their companion tests

What to fix:

- add a matrix mapping each stage to the suites that must rerun when it changes
- freeze more stage-level debug snapshots, not just end results

## Pros, Cons, and Recommended Fixes

### What is working well

- staged architecture is much better than one monolithic parser
- bounded repair is the right safety posture
- validation, truth, dedup, and scoring make quality explicit
- regression culture is strong and correctly biased toward real-world corpuses

### What is not working well

- too much behavior is encoded in scattered regex and threshold logic
- legacy and `v2` responsibilities overlap
- extraction candidate scoring is not transparent enough
- some cleanup logic still masks upstream structural weaknesses

### Fix first

1. Create a single policy doc or config module for thresholds, caps, and penalties.
2. Consolidate duplicated parsing heuristics between `citationParser.ts` and `v2/adapters.ts`.
3. Add stage-level score and routing baselines for real-world suites.
4. Centralize regex catalogs by subsystem so new patterns are added in one place.
5. Promote style detection from single-label confidence to ranked candidate families.

### Fix next

1. Separate semantic normalization from plain cleanup.
2. Improve negative duplicate tests for editions, translations, and version families.
3. Add richer debug output for resolution candidate scoring.
4. Shrink `citationParser.ts` into smaller modules or phase it out.

### Fix later

1. Revisit `group` stage and decide whether it should exist.
2. Replace ad hoc cleanup regexes with stronger upstream canonical guarantees where possible.
3. Make authority coverage policy more explicit by reference type.

## Bottom Line

The repo has evolved from a formatter into a real citation-processing engine with strong operational safeguards. The architecture is fundamentally sound, especially around split, validation, truth reuse, and real-world regression discipline.

The main problem is no longer lack of capability. It is complexity concentration:

- too many heuristics
- too many regex families
- too much overlap between old and new parsing logic
- too much policy encoded in thresholds that are easy to change and hard to reason about globally

If we keep the current regression discipline and spend the next cleanup pass on consolidation rather than adding more one-off heuristics, the engine should become much easier to maintain without losing accuracy.
